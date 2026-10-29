// Rendering performance layer, applied to a freshly built world before
// the match starts:
//
//  - Graphics quality presets (pixel ratio, shadows, light budget, post FX).
//  - Static batching: thousands of individual static meshes (walls,
//    beams, crates, rocks, ...) are merged per material and per map chunk,
//    cutting draw calls by an order of magnitude while keeping frustum
//    culling useful.
//  - BVH-accelerated raycasting (three-mesh-bvh) so hitscan shots and
//    grenade line-of-sight checks against the merged world stay cheap.
//  - A fixed-size light pool: maps place dozens of lamp "anchors", but
//    only the few nearest the camera get a real PointLight. The number of
//    lights never changes at runtime, so shaders never recompile mid-game
//    (adding/removing a light in Three.js forces every material to
//    recompile — the hitch you used to get on every rocket explosion).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const QUALITY_PRESETS = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, softShadows: false, lights: 1, grass: 0.35, postFx: false, antialias: false, shadowRange: 35 },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, softShadows: false, lights: 2, grass: 0.65, postFx: false, antialias: true, shadowRange: 36 },
  // Ultra adds screen-space ambient occlusion (N8AO) and bloom: contact
  // shadows where trees meet the ground, under rocks, in building corners.
  high: { pixelRatio: 1, shadows: true, shadowMapSize: 2048, softShadows: false, lights: 3, grass: 1, postFx: false, antialias: true, shadowRange: 46 },
  ultra: { pixelRatio: 1.5, shadows: true, shadowMapSize: 4096, softShadows: true, lights: 5, grass: 1.4, postFx: true, ao: 'half', bloom: true, antialias: true, shadowRange: 60 },
};

export function getQualityPreset(name) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
}

// --- Static batching -------------------------------------------------------

const CHUNK_SIZE = 48;

function isBatchable(mesh) {
  if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return false;
  if (Array.isArray(mesh.material) || mesh.material.transparent) return false;
  if (mesh.name === 'skydome' || mesh.userData.noBatch) return false;
  const geo = mesh.geometry;
  if (!geo.attributes.position || !geo.attributes.normal || geo.morphAttributes.position) return false;
  // Anything hanging off a dynamic parent (animated NPCs, the beacon
  // spotlight rig, ...) has to stay a separate object.
  for (let p = mesh.parent; p; p = p.parent) {
    if (p.userData.dynamic) return false;
  }
  return true;
}

export function batchStaticMeshes(scene) {
  scene.updateMatrixWorld(true);
  const buckets = new Map();

  scene.traverse((obj) => {
    if (!isBatchable(obj)) return;
    const geo = obj.geometry;
    const attrs = Object.keys(geo.attributes).sort().join(',');
    obj.getWorldPosition(_v);
    const chunk = `${Math.floor(_v.x / CHUNK_SIZE)}:${Math.floor(_v.z / CHUNK_SIZE)}`;
    const key = `${obj.material.uuid}|${obj.castShadow ? 1 : 0}${obj.receiveShadow ? 1 : 0}|${attrs}|${geo.index ? 'i' : 'n'}|${chunk}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(obj);
  });

  let before = 0;
  let after = 0;
  for (const meshes of buckets.values()) {
    before += meshes.length;
    if (meshes.length < 2) {
      after += 1;
      continue;
    }
    const geometries = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      g.clearGroups();
      return g;
    });
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) {
      after += meshes.length;
      continue;
    }
    const source = meshes[0];
    const batched = new THREE.Mesh(merged, source.material);
    batched.castShadow = source.castShadow;
    batched.receiveShadow = source.receiveShadow;
    batched.matrixAutoUpdate = false;
    batched.userData.batched = true;
    scene.add(batched);
    for (const m of meshes) m.removeFromParent();
    after += 1;
  }
  console.log(`[perf] Static batching: ${before} meshes -> ${after} draw calls.`);
}

const _v = new THREE.Vector3();

// Static meshes that bullets/grenades can collide with, each with a BVH.
export function collectRaycastTargets(scene, exclude) {
  const targets = [];
  scene.traverse((obj) => {
    if (!obj.isMesh || obj.isSkinnedMesh) return;
    if (obj.name === 'skydome' || obj.userData.noRaycast) return;
    if (obj.userData.playerId !== undefined || obj.userData.zombieId !== undefined) return;
    if (exclude && exclude(obj)) return;
    if (obj.material && obj.material.transparent && obj.material.opacity < 0.05) return;
    if (!obj.geometry.boundsTree) obj.geometry.computeBoundsTree();
    targets.push(obj);
  });
  return targets;
}

// --- Light pool ----------------------------------------------------------

export class LightPool {
  constructor(scene, size, fxSlots = 2) {
    this.anchors = [];
    // Pull every point light the map placed out of the scene and keep it
    // only as an anchor description.
    const found = [];
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      if (obj.isPointLight) found.push(obj);
    });
    for (const light of found) {
      const pos = light.getWorldPosition(new THREE.Vector3());
      this.anchors.push({
        pos,
        color: light.color.clone(),
        intensity: light.intensity,
        distance: light.distance || 30,
        decay: light.decay,
      });
      light.removeFromParent();
      light.dispose?.();
    }

    this.slots = [];
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 1.5);
      light.castShadow = false;
      scene.add(light);
      this.slots.push({ light, anchor: null, fade: 0 });
    }

    // Lights reserved for transient effects (explosions, rocket engines).
    this.fx = [];
    for (let i = 0; i < fxSlots; i++) {
      const light = new THREE.PointLight(0xff8833, 0, 18, 2);
      scene.add(light);
      this.fx.push({ light, life: 0, maxLife: 0, peak: 0, follow: null });
    }
    this._timer = 0;
    console.log(`[perf] Light pool: ${this.anchors.length} map lights served by ${size} real lights.`);
  }

  // Momentary light flash (explosion, grenade) — reuses the oldest slot.
  flash(position, color, intensity, distance, duration) {
    let slot = this.fx[0];
    for (const s of this.fx) if (s.life <= 0 || s.life < slot.life) slot = s;
    slot.light.position.copy(position);
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.peak = intensity;
    slot.life = duration;
    slot.maxLife = duration;
    slot.follow = null;
    return slot;
  }

  update(dt, cameraPos) {
    for (const s of this.fx) {
      if (s.life > 0) {
        s.life -= dt;
        if (s.follow) s.light.position.copy(s.follow.position);
        s.light.intensity = Math.max(0, s.peak * (s.life / s.maxLife));
      } else {
        s.light.intensity = 0;
      }
    }

    this._timer -= dt;
    if (this._timer <= 0 && this.anchors.length > 0) {
      this._timer = 0.25;
      // Rank anchors by how much they could matter to what we see.
      const ranked = this.anchors
        .map((a) => ({ a, score: a.pos.distanceToSquared(cameraPos) / (a.distance * a.distance) }))
        .filter((e) => e.score < 4)
        .sort((x, y) => x.score - y.score)
        .slice(0, this.slots.length)
        .map((e) => e.a);
      const keep = new Set(ranked);
      const free = this.slots.filter((s) => !s.anchor || !keep.has(s.anchor));
      const assigned = new Set(this.slots.filter((s) => s.anchor && keep.has(s.anchor)).map((s) => s.anchor));
      for (const anchor of ranked) {
        if (assigned.has(anchor)) continue;
        const slot = free.shift();
        if (!slot) break;
        slot.anchor = anchor;
        slot.fade = 0;
        slot.light.position.copy(anchor.pos);
        slot.light.color.copy(anchor.color);
        slot.light.distance = anchor.distance;
        slot.light.decay = anchor.decay;
      }
      for (const slot of free) slot.anchor = null;
    }

    for (const slot of this.slots) {
      const target = slot.anchor ? 1 : 0;
      slot.fade += (target - slot.fade) * Math.min(1, dt * 5);
      slot.light.intensity = slot.anchor ? slot.anchor.intensity * slot.fade : slot.light.intensity * (1 - Math.min(1, dt * 5));
    }
  }
}

// --- Post-processing (Ultra only) -------------------------------------------

export async function createPostFx(renderer, scene, camera, preset = QUALITY_PRESETS.ultra) {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
    import('three/addons/postprocessing/ShaderPass.js'),
  ]);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  let ao = null;
  if (preset.ao) {
    try {
      const { N8AOPass } = await import('n8ao');
      ao = new N8AOPass(scene, camera, size.x, size.y);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = preset.ao === 'half';
      ao.configuration.gammaCorrection = false; // OutputPass handles it
      ao.configuration.aoSamples = preset.ao === 'half' ? 12 : 16;
      composer.addPass(ao);
    } catch (err) {
      console.warn('[perf] ambient occlusion unavailable:', err);
      ao = null;
    }
  }
  if (!ao) composer.addPass(new RenderPass(scene, camera));
  if (preset.bloom) {
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  // Film-style finish: subtle vignette, contrast and grain.
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
        float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          c.rgb = mix(vec3(dot(c.rgb, vec3(0.299,0.587,0.114))), c.rgb, 0.92);
          c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
          float v = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5)));
          c.rgb *= mix(0.72, 1.0, v);
          c.rgb += (rand(vUv * 731.0 + uTime) - 0.5) * 0.025;
          gl_FragColor = c;
        }`,
    })
  );
  return {
    render(dt) {
      composer.passes[composer.passes.length - 1].uniforms.uTime.value += dt;
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    setPixelRatio(pr) {
      composer.setPixelRatio(pr);
    },
    dispose() {
      target.dispose();
      composer.dispose?.();
    },
  };
}
