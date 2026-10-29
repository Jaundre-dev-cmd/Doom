// Shared helpers for procedural vegetation: tileable noise, a seeded RNG,
// geometry jitter/shading/merging, materials, and an instanced-mesh builder.

import * as THREE from 'three';

// --- Noise ------------------------------------------------------------------

export function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Tileable value noise: lattice coordinates wrap at `period`.
export function valueNoise(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x, y, period, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, period, seed + i * 17) * amp;
    norm += amp;
    x *= 2;
    y *= 2;
    period *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}


export function canvasTexture(canvas, { srgb = true, repeat = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  return tex;
}

// --- Vegetation geometry ----------------------------------------------------

// Displace vertices by a hash of their (rounded) position so duplicated
// seam vertices move together and the mesh doesn't tear.
export function jitter(geometry, amount, seed) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 100);
    const ky = Math.round(y * 100);
    const kz = Math.round(z * 100);
    pos.setXYZ(
      i,
      x + (hash2(kx, ky + kz * 7, seed) - 0.5) * amount,
      y + (hash2(ky, kz + kx * 3, seed + 1) - 0.5) * amount * 0.6,
      z + (hash2(kz, kx + ky * 5, seed + 2) - 0.5) * amount
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Fake ambient occlusion: darken vertices that are low/inside a crown.
export function shadeByHeight(geometry, minY, maxY, dark = 0.45) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - minY) / (maxY - minY), 0, 1);
    const radial = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / 2.2);
    const s = dark + (1 - dark) * (0.55 * t + 0.45 * radial);
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function mergeSimple(geometries) {
  // Minimal non-indexed merge (position/normal/color) for small vegetation meshes.
  const parts = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
    else col.fill(1, o * 3, (o + g.attributes.position.count) * 3);
    o += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();
  return merged;
}

export function makePineCanopy(layers, seed) {
  const parts = [];
  let y = 2.6;
  let radius = 2.5;
  let h = 3.4;
  for (let i = 0; i < layers; i++) {
    const cone = new THREE.ConeGeometry(radius, h, 11, 3, true);
    cone.translate(0, y + h / 2, 0);
    jitter(cone, 0.45, seed + i * 13);
    parts.push(cone);
    y += h * 0.52;
    radius *= 0.78;
    h *= 0.9;
  }
  const merged = mergeSimple(parts);
  shadeByHeight(merged, 2.6, y + h, 0.4);
  return merged;
}

export function makeBroadleafCrown(seed) {
  const rand = makeRng(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const r = 1.4 + rand() * 0.9;
    const blob = new THREE.IcosahedronGeometry(r, 1);
    const a = (i / 6) * Math.PI * 2;
    blob.scale(1, 0.8, 1);
    blob.translate(Math.cos(a) * 1.3 * rand(), 5.2 + rand() * 1.8, Math.sin(a) * 1.3 * rand());
    jitter(blob, 0.5, seed + i);
    parts.push(blob);
  }
  const top = new THREE.IcosahedronGeometry(1.8, 1);
  top.translate(0, 7.2, 0);
  jitter(top, 0.5, seed + 99);
  parts.push(top);
  const merged = mergeSimple(parts);
  shadeByHeight(merged, 4, 8.5, 0.45);
  return merged;
}

export function makeBarkMaterial() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a3626';
  ctx.fillRect(0, 0, size, size);
  const rand = makeRng(3);
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    ctx.strokeStyle = `rgba(${rand() < 0.5 ? '20,14,8' : '120,98,74'},${0.15 + rand() * 0.35})`;
    ctx.lineWidth = 1 + rand() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, -5);
    ctx.bezierCurveTo(x + (rand() - 0.5) * 8, size * 0.3, x + (rand() - 0.5) * 8, size * 0.7, x + (rand() - 0.5) * 6, size + 5);
    ctx.stroke();
  }
  const tex = canvasTexture(canvas);
  tex.repeat.set(2, 3);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: 0xbfb2a6 });
}

export function makeFoliageMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
}

// --- Placement --------------------------------------------------------------

export class InstanceBuilder {
  constructor(geometry, material, { castShadow = true, receiveShadow = true, noRaycast = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.items = [];
    this.opts = { castShadow, receiveShadow, noRaycast };
  }
  add(matrix, color) {
    this.items.push({ matrix: matrix.clone(), color: color ? color.clone() : null });
  }
  build() {
    if (this.items.length === 0) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.items.length);
    this.items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = this.opts.castShadow;
    mesh.receiveShadow = this.opts.receiveShadow;
    mesh.userData.noRaycast = this.opts.noRaycast;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    return mesh;
  }
}

export const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

export function compose(x, y, z, rotY, sx, sy = sx, sz = sx, tiltX = 0, tiltZ = 0) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(tiltX, rotY, tiltZ));
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

// Build the whole forest. `isBlocked(x, z, r)` returns true where nothing
