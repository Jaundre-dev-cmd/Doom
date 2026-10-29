// Performance pass for instanced vegetation.
//
// The vegetation builders produce one InstancedMesh per plant type spanning
// the whole map. Such a mesh is never frustum-culled (its bounds cover
// everything), so every tree, grass tuft and pebble on the map was drawn every
// frame — and again in the shadow pass. This splits each one into spatial
// chunks, so off-screen chunks are culled, and hides small detail beyond a
// distance at which the fog would swallow it anyway.

import * as THREE from 'three';

const CHUNK = 64; // metres

function splitInstancedMesh(mesh, keepEvery = 1, chunk = CHUNK) {
  const n = mesh.count;
  const buckets = new Map();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i += keepEvery) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const key = `${Math.floor(p.x / chunk)}:${Math.floor(p.z / chunk)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }

  const geo = mesh.geometry;
  const instancedAttrs = Object.entries(geo.attributes).filter(([, a]) => a.isInstancedBufferAttribute);
  const chunks = [];
  for (const indices of buckets.values()) {
    // Per-instance geometry attributes (atlas tiles, phases...) must be
    // sliced too; everything else is shared with the original.
    let g = geo;
    if (instancedAttrs.length) {
      g = new THREE.BufferGeometry();
      g.setIndex(geo.index);
      for (const [name, a] of Object.entries(geo.attributes)) {
        if (!a.isInstancedBufferAttribute) {
          g.setAttribute(name, a);
          continue;
        }
        const out = new a.array.constructor(indices.length * a.itemSize);
        indices.forEach((src, k) => out.set(a.array.subarray(src * a.itemSize, (src + 1) * a.itemSize), k * a.itemSize));
        g.setAttribute(name, new THREE.InstancedBufferAttribute(out, a.itemSize, a.normalized, a.meshPerAttribute));
      }
      g.boundingBox = geo.boundingBox;
      g.boundingSphere = geo.boundingSphere;
    }
    const c = new THREE.InstancedMesh(g, mesh.material, indices.length);
    indices.forEach((src, k) => {
      mesh.getMatrixAt(src, m);
      c.setMatrixAt(k, m);
    });
    if (mesh.instanceColor) {
      const col = new THREE.Color();
      indices.forEach((src, k) => {
        mesh.getColorAt(src, col);
        c.setColorAt(k, col);
      });
      c.instanceColor.needsUpdate = true;
    }
    c.instanceMatrix.needsUpdate = true;
    c.name = mesh.name;
    c.castShadow = mesh.castShadow;
    c.receiveShadow = mesh.receiveShadow;
    c.customDepthMaterial = mesh.customDepthMaterial;
    c.customDistanceMaterial = mesh.customDistanceMaterial;
    c.renderOrder = mesh.renderOrder;
    c.userData = { ...mesh.userData };
    c.onBeforeRender = mesh.onBeforeRender;
    c.computeBoundingSphere();
    chunks.push(c);
  }
  return chunks;
}

/**
 * @param {THREE.Object3D} root   group containing vegetation InstancedMeshes
 * @param {(mesh) => {cull?: number, lodMin?: number, lodMax?: number, chunk?: number,
 *                    keepEvery?: number, shadow?: boolean}} classify
 *   cull    hide beyond this distance (0 = never)
 *   lodMax  full-detail copy: shown only while the chunk centre is closer than this
 *   lodMin  light copy: shown only once the chunk centre is at least this far
 * @returns {Array<THREE.Mesh>}   chunks with a cull distance (for updateCulling)
 */
export function chunkVegetation(root, classify) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isInstancedMesh && o.count > 0) meshes.push(o);
  });
  const culled = [];
  for (const mesh of meshes) {
    const rule = classify(mesh);
    const parent = mesh.parent;
    const chunks = splitInstancedMesh(mesh, rule.keepEvery || 1, rule.chunk || CHUNK);
    for (const c of chunks) {
      if (rule.shadow === false) c.castShadow = false;
      c.userData.cullDistance = rule.cull || 0;
      c.userData.lodMin = rule.lodMin || 0;
      c.userData.lodMax = rule.lodMax || 0;
      if (rule.cull || rule.lodMin || rule.lodMax) culled.push(c);
      parent.add(c);
    }
    parent.remove(mesh);
  }
  return culled;
}

const _c = new THREE.Vector3();
export function updateCulling(chunks, cameraPos) {
  for (const c of chunks) {
    const s = c.boundingSphere;
    const u = c.userData;
    const d2 = _c.copy(s.center).setY(cameraPos.y).distanceToSquared(cameraPos);
    if (u.lodMax) {
      c.visible = d2 < u.lodMax * u.lodMax;
    } else {
      const far = u.cullDistance + s.radius;
      c.visible = (!u.lodMin || d2 >= u.lodMin * u.lodMin) && (!u.cullDistance || d2 < far * far);
    }
  }
}
