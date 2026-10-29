// Forest Outpost scenery: realistic ground material, instanced forest
// (pines, broadleaf trees, bushes, rocks, fallen logs), wind-blown grass
// meadows and a dense treeline beyond the playable boundary.
//
// Everything that repeats is a THREE.InstancedMesh, so the whole forest
// renders in roughly a dozen draw calls regardless of tree count — the
// previous version built every tree out of 4 separate meshes (~1,400
// draw calls, doubled again by the shadow pass), which was the main
// source of lag on this map.

import * as THREE from 'three';

import { hash2, valueNoise, fbm, makeRng, canvasTexture } from './vegetationUtils.js';
import { createTreeKit } from './foliage.js';
import { createGroundKit } from './groundcover.js';
export { makeGrassMeadows } from './groundcover.js';

// --- Ground textures --------------------------------------------------------


// Draws `fn(ctx, x, y)` at (x, y) and at its wrapped copies so strokes near
// the edge continue on the opposite side (keeps the texture tileable).
function drawWrapped(size, x, y, fn) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px < -40 || py < -40 || px > size + 40 || py > size + 40) continue;
      fn(px, py);
    }
  }
}

// Forest-floor grass: mottled base, thousands of individual blade strokes,
// clover and the odd dead leaf. Also returns a height field for the normal map.
function makeGrassDetail(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 8, (y / size) * 8, 8, 11, 5);
      const n2 = fbm((x / size) * 32, (y / size) * 32, 32, 29, 2);
      const i = (y * size + x) * 4;
      img.data[i] = 46 + n * 40 + n2 * 14;
      img.data[i + 1] = 66 + n * 52 + n2 * 18;
      img.data[i + 2] = 30 + n * 18;
      img.data[i + 3] = 255;
      height[y * size + x] = n * 0.4 + n2 * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);

  const rand = makeRng(77);
  const blades = Math.round(size * size * 0.045);
  ctx.lineCap = 'round';
  for (let i = 0; i < blades; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 3 + rand() * 9 * (size / 1024);
    const ang = -Math.PI / 2 + (rand() - 0.5) * 1.4;
    const light = rand();
    const r = Math.round(50 + light * 70 + (rand() < 0.08 ? 60 : 0));
    const g = Math.round(80 + light * 85);
    const b = Math.round(28 + light * 30);
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 + rand() * 0.5})`;
    ctx.lineWidth = 0.8 + rand() * 1.2;
    drawWrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  // Dead leaves / twigs
  for (let i = 0; i < size * 0.6; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 2 + rand() * 4;
    ctx.fillStyle = `rgba(${110 + rand() * 50},${80 + rand() * 30},${40 + rand() * 20},${0.5 + rand() * 0.4})`;
    drawWrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, s, s * 0.45, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return { canvas, height };
}

// Packed forest-floor dirt with small stones, roots and leaf litter.
function makeDirtDetail(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 6, (y / size) * 6, 6, 5, 5);
      const n2 = fbm((x / size) * 48, (y / size) * 48, 48, 9, 2);
      const i = (y * size + x) * 4;
      img.data[i] = 88 + n * 50 + n2 * 22;
      img.data[i + 1] = 70 + n * 38 + n2 * 18;
      img.data[i + 2] = 50 + n * 26 + n2 * 12;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const rand = makeRng(5);
  for (let i = 0; i < size * 1.2; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 1 + rand() * 3.5 * (size / 1024);
    const shade = 90 + rand() * 80;
    ctx.fillStyle = `rgba(${shade},${shade * 0.92},${shade * 0.82},0.8)`;
    drawWrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, s, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  for (let i = 0; i < size * 0.8; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 2 + rand() * 5;
    ctx.fillStyle = `rgba(${120 + rand() * 60},${70 + rand() * 40},${30 + rand() * 20},0.75)`;
    drawWrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, s, s * 0.5, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return canvas;
}

function heightToNormalMap(height, size, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Macro mask covering the play area: R = bare dirt amount (trails,
// trampled clearings), G = brightness variation, B = dry/yellowed grass.
function makeMacroMask(size, extent, trails, clearings) {
  const pathCanvas = document.createElement('canvas');
  pathCanvas.width = pathCanvas.height = size;
  const pctx = pathCanvas.getContext('2d');
  pctx.fillStyle = '#000';
  pctx.fillRect(0, 0, size, size);
  const toPx = (v) => (v / extent + 0.5) * size;
  pctx.filter = `blur(${Math.max(2, size / 220)}px)`;
  pctx.strokeStyle = '#fff';
  pctx.lineCap = 'round';
  pctx.lineJoin = 'round';
  for (const trail of trails) {
    pctx.lineWidth = (trail.width / extent) * size;
    pctx.beginPath();
    trail.points.forEach(([x, z], i) => (i ? pctx.lineTo(toPx(x), toPx(z)) : pctx.moveTo(toPx(x), toPx(z))));
    pctx.stroke();
  }
  for (const c of clearings) {
    const g = pctx.createRadialGradient(toPx(c.x), toPx(c.z), 0, toPx(c.x), toPx(c.z), (c.r / extent) * size);
    g.addColorStop(0, `rgba(255,255,255,${c.strength ?? 0.9})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    pctx.fillStyle = g;
    pctx.fillRect(0, 0, size, size);
  }
  const paths = pctx.getImageData(0, 0, size, size).data;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      const edgeNoise = fbm(u * 40, v * 40, 1 << 20, 3, 3);
      const patch = fbm(u * 9, v * 9, 1 << 20, 41, 4);
      const path = paths[i] / 255;
      // Under dense tree stands (same density field forest.js plants
      // trees with) the floor is soil and needle litter, not lawn.
      const wx = (u - 0.5) * extent;
      const wz = (v - 0.5) * extent;
      const stand = fbm((wx + 500) * 0.02, (wz + 500) * 0.02, 1 << 20, 7, 3);
      const floorLitter = Math.max(0, (stand - 0.42) * 2.2) * (0.6 + edgeNoise * 0.5);
      const dirt = Math.min(1, Math.max(0, path * (0.75 + edgeNoise * 0.6) + Math.max(0, patch - 0.68) * 2.2 + floorLitter));
      img.data[i] = dirt * 255;
      img.data[i + 1] = (0.25 + fbm(u * 14, v * 14, 1 << 20, 23, 4) * 0.75) * 255;
      img.data[i + 2] = Math.max(0, fbm(u * 6, v * 6, 1 << 20, 61, 3) - 0.45) * 2 * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = canvasTexture(canvas, { srgb: false });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  // Canvas row = world z (see toPx above); the shader samples with
  // uv.y = z / extent + 0.5, so the image must not be flipped.
  tex.flipY = false;
  return tex;
}

// The ground textures are painted pixel-by-pixel in JavaScript, which used to
// freeze the page for seconds on every deploy. They're 512² except on Ultra,
// and cached so later matches reuse them instantly.
const groundTextureCache = new Map();

function groundTextures(size, extent, trails, clearings) {
  if (!groundTextureCache.has(size)) {
    const grass = makeGrassDetail(size);
    groundTextureCache.set(size, {
      grassTex: canvasTexture(grass.canvas),
      dirtTex: canvasTexture(makeDirtDetail(size)),
      normalTex: canvasTexture(heightToNormalMap(grass.height, size, 6), { srgb: false }),
      macroTex: makeMacroMask(size > 512 ? 1024 : 384, extent, trails, clearings),
    });
  }
  return groundTextureCache.get(size);
}

export function makeForestGround({ quality, trails, clearings, extent = 260, visualSize = 1000 }) {
  const detailSize = quality.grass > 1.2 ? 1024 : 512;
  const { grassTex, dirtTex, normalTex, macroTex } = groundTextures(detailSize, extent, trails, clearings);

  // One detail tile every 3.5m.
  const tiles = visualSize / 3.5;
  for (const t of [grassTex, dirtTex, normalTex]) t.repeat.set(tiles, tiles);

  const material = new THREE.MeshStandardMaterial({
    map: grassTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.96,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dirtMap = { value: dirtTex };
    shader.uniforms.macroMap = { value: macroTex };
    shader.uniforms.macroExtent = { value: extent };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float macroExtent;\nvarying vec2 vMacroUv;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMacroUv = (modelMatrix * vec4(transformed, 1.0)).xz / macroExtent + 0.5;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D dirtMap;\nuniform sampler2D macroMap;\nvarying vec2 vMacroUv;')
      .replace(
        '#include <map_fragment>',
        `
        vec4 grassNear = texture2D(map, vMapUv);
        vec4 grassFar = texture2D(map, vMapUv * 0.131 + 0.37);
        vec3 grassC = mix(grassNear.rgb, grassFar.rgb, 0.35);
        vec3 dirtC = mix(texture2D(dirtMap, vMapUv * 0.71).rgb, texture2D(dirtMap, vMapUv * 0.097).rgb, 0.3);
        vec4 macro = texture2D(macroMap, vMacroUv);
        vec3 groundC = mix(grassC, dirtC, smoothstep(0.15, 0.85, macro.r));
        groundC *= 0.78 + 0.44 * macro.g;
        groundC = mix(groundC, groundC * vec3(1.22, 1.08, 0.62), macro.b * (1.0 - macro.r) * 0.7);
        diffuseColor.rgb *= groundC;
        `
      );
  };

  const geometry = new THREE.PlaneGeometry(visualSize, visualSize, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

// --- Placement --------------------------------------------------------------
// Where things go (and their collision) is decided here; how they look is up
// to foliage.js (trees, bushes) and groundcover.js (rocks, logs, clutter).
export function makeForest({ half, rand, collidables, isBlocked, quality, windUniform }) {
  const group = new THREE.Group();
  group.name = 'forest';
  const trees = createTreeKit({ quality, windUniform });
  const ground = createGroundKit({ quality, windUniform });

  // Playable forest: clustered stands rather than uniform scatter, which
  // reads far more like real woodland and creates lanes to fight through.
  const inner = half - 4;
  let placed = 0;
  const contacts = []; // [x, z, radius] for ground contact shadows
  for (let i = 0; i < 2600 && placed < 420; i++) {
    const x = (rand() - 0.5) * 2 * inner;
    const z = (rand() - 0.5) * 2 * inner;
    const density = fbm((x + 500) * 0.02, (z + 500) * 0.02, 1 << 20, 7, 3);
    if (rand() > density * density * 2.2) continue;
    if (isBlocked(x, z, 2.5)) continue;
    if (rand() < 0.68) {
      const scale = 1.05 + rand() * 0.6;
      trees.addPine(x, z, scale, rand);
      contacts.push([x, z, 1.15 * scale]);
      collidables.push({ x, z, radius: 0.32 * scale + 0.05 });
    } else {
      const scale = 0.85 + rand() * 0.35;
      trees.addBroadleaf(x, z, scale, rand);
      contacts.push([x, z, 1.5 * scale]);
      collidables.push({ x, z, radius: 0.38 * scale + 0.05 });
    }
    placed++;
  }

  // Undergrowth (decorative, soft — no collision).
  for (let i = 0; i < 520; i++) {
    const x = (rand() - 0.5) * 2 * inner;
    const z = (rand() - 0.5) * 2 * inner;
    if (isBlocked(x, z, 1.2)) continue;
    trees.addBush(x, z, 0.5 + rand() * 0.8, rand);
  }

  // Boulders: hard cover.
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 2 * inner;
    const z = (rand() - 0.5) * 2 * inner;
    if (isBlocked(x, z, 2)) continue;
    const s = 0.6 + rand() * 1.3;
    ground.addRock(x, z, s, rand);
    contacts.push([x, z, s * 1.55]);
    collidables.push({ x, z, radius: s * 1.05, maxY: s * 1.1 });
  }

  // Fallen logs: low cover you can vault with a jump.
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * 2 * inner;
    const z = (rand() - 0.5) * 2 * inner;
    const len = 4 + rand() * 5;
    if (isBlocked(x, z, len / 2 + 1)) continue;
    const rot = rand() * Math.PI;
    ground.addLog(x, z, len, rot, rand);
    const steps = Math.ceil(len / 0.8);
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps - 0.5) * len;
      collidables.push({ x: x + Math.cos(rot) * t, z: z - Math.sin(rot) * t, radius: 0.32, maxY: 0.55 });
    }
  }

  ground.scatterClutter({ half, rand, isBlocked });

  // Treeline beyond the boundary: dense, no collision (unreachable), turns
  // the map edge into a forest wall fading into the fog.
  const ringCount = Math.round(900 * Math.min(1.2, 0.5 + quality.grass * 0.5));
  for (let i = 0; i < ringCount; i++) {
    const a = rand() * Math.PI * 2;
    const r = half + 2 + Math.pow(rand(), 0.7) * 90;
    let x = Math.cos(a) * r;
    let z = Math.sin(a) * r;
    if (Math.abs(x) < half + 2 && Math.abs(z) < half + 2) {
      if (Math.abs(x) > Math.abs(z)) x = Math.sign(x) * (half + 2 + rand() * 8);
      else z = Math.sign(z) * (half + 2 + rand() * 8);
    }
    if (rand() < 0.8) trees.addPine(x, z, 1.2 + rand() * 0.8, rand);
    else trees.addBroadleaf(x, z, 1 + rand() * 0.4, rand);
  }

  group.add(trees.build(), ground.build(), makeContactShadows(contacts));
  return group;
}

// Soft darkening of the ground where trunks and boulders meet it — the
// ambient occlusion that makes objects sit IN the ground rather than on it.
function makeContactShadows(contacts) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const alpha = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: alpha,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, contacts.length);
  const m = new THREE.Matrix4();
  contacts.forEach(([x, z, r], i) => {
    m.makeScale(r, 1, r);
    m.setPosition(x, 0.02, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.noRaycast = true;
  mesh.renderOrder = 1;
  return mesh;
}
