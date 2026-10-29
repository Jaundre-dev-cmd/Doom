// Ground cover for the Forest Outpost: boulders, fallen logs, small
// clutter (stones, twigs, cones, leaf litter, ferns, flowers, mushrooms)
// and grass meadows.
//
// createGroundKit() is the contract forest.js uses:
//   addRock(x, z, s, rand)        a boulder of size s (~0.6-1.9); forest.js adds
//                                 collision { radius: s * 1.05, maxY: s * 1.1 }
//   addLog(x, z, len, rot, rand)  a fallen log lying along angle rot (rotation
//                                 about Y); forest.js adds a row of collision
//                                 circles of radius 0.32, maxY 0.55
//   scatterClutter({ half, rand, isBlocked })  purely decorative small detail
//   build() -> THREE.Group
// makeGrassMeadows(...) builds the grass.
//
// Everything is instanced (about 15 draw calls in total). Rocks and logs use
// high-resolution procedural geometry and procedural shaders (stone grain,
// cracks, lichen, moss on upward faces, bark furrows, end-grain rings);
// grass, litter, ferns and flowers are alpha-tested cards drawn on canvases.

import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, valueNoise, makeRng, _m, compose } from './vegetationUtils.js';

// --- Small helpers ------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy),
    l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy),
    sz
  );
}

function fbm3(x, y, z, seed, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += noise3(x, y, z, seed + i * 31) * a;
    n += a;
    x *= 2.03; y *= 2.03; z *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

function smin(a, b, k) {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

// Collects instances (matrix, optional colour, optional per-instance tile
// offset) and builds one InstancedMesh.
class Batch {
  constructor(geometry, material, opts = {}) {
    this.geometry = geometry;
    this.material = material;
    this.opts = opts;
    this.mats = [];
    this.cols = [];
    this.tiles = [];
  }
  add(matrix, color, tile) {
    this.mats.push(...matrix.elements);
    if (color) this.cols.push(color.r, color.g, color.b);
    if (tile) this.tiles.push(tile[0], tile[1]);
  }
  get count() {
    return this.mats.length / 16;
  }
  build() {
    const n = this.count;
    if (!n) return null;
    const geo = this.geometry;
    if (this.opts.tiled) {
      geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(this.tiles), 2));
    }
    const mesh = new THREE.InstancedMesh(geo, this.material, n);
    mesh.instanceMatrix.array.set(this.mats);
    mesh.instanceMatrix.needsUpdate = true;
    if (this.cols.length === n * 3) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols), 3);
    }
    mesh.castShadow = !!this.opts.castShadow;
    mesh.receiveShadow = this.opts.receiveShadow !== false;
    mesh.userData.noRaycast = !!this.opts.noRaycast;
    mesh.name = this.opts.name || '';
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox?.();
    return mesh;
  }
}

// --- Shared GLSL ----------------------------------------------------------------

const GLSL_NOISE = /* glsl */ `
float gc_hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gc_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gc_hash(i), gc_hash(i + vec3(1, 0, 0)), f.x), mix(gc_hash(i + vec3(0, 1, 0)), gc_hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(gc_hash(i + vec3(0, 0, 1)), gc_hash(i + vec3(1, 0, 1)), f.x), mix(gc_hash(i + vec3(0, 1, 1)), gc_hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float gc_fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * gc_noise(p);
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

// Screen-space bump from a procedural height (same maths as three's bump map).
const GLSL_BUMP = /* glsl */ `
vec3 gc_bump(vec3 n, float h, float faceDir) {
  vec3 sp = -vViewPosition;
  vec3 sx = dFdx(sp);
  vec3 sy = dFdy(sp);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}
`;

// World position / world normal varyings for instanced meshes.
const VERT_WORLD = /* glsl */ `
  vec4 gcW = vec4(transformed, 1.0);
  vec3 gcN = objectNormal;
  #ifdef USE_INSTANCING
    gcW = instanceMatrix * gcW;
    gcN = mat3(instanceMatrix) * gcN;
    vSeed = instanceMatrix[3].xyz * 0.37;
  #else
    vSeed = vec3(0.0);
  #endif
  gcW = modelMatrix * gcW;
  vWPos = gcW.xyz;
  vWNrm = normalize(mat3(modelMatrix) * gcN);
  vOPos = transformed;
`;

const VARYINGS = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec3 vOPos;\nvarying vec3 vSeed;\n';

// No back-face normal flip: thin cards are lit as one surface.
const NORMAL_NOFLIP = 'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;';

// --- Stone ------------------------------------------------------------------

function makeStoneMaterial({ small = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.55 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS + GLSL_NOISE + GLSL_BUMP + (small ? '#define GC_SMALL\n' : ''))
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 sp = vWPos;
        float camD = length(vViewPosition);
        float nearF = 1.0 - smoothstep(6.0, 28.0, camD);
        vec3 wp = sp + vec3(0.0, 0.0, 0.0);
        vec3 warp = vec3(gc_noise(sp * 0.8 + 3.0), gc_noise(sp * 0.8 + 7.0), gc_noise(sp * 0.8 + 11.0)) - 0.5;
        float big = gc_fbm(sp * 0.42 + vSeed);
        float mid = gc_noise(sp * 3.3 + vSeed);
        float grain = gc_noise(sp * 21.0);
        float fine = gc_noise(sp * 57.0);
        // Base rock: weathered grey-brown granite, darker mottles, warm iron staining.
        vec3 stoneA = vec3(0.095, 0.085, 0.070);
        vec3 stoneB = vec3(0.215, 0.195, 0.165);
        vec3 stone = mix(stoneA, stoneB, smoothstep(0.22, 0.78, big));
        stone = mix(stone, stone * vec3(1.18, 1.0, 0.80), smoothstep(0.55, 0.85, gc_noise(sp * 0.7 + vSeed + 5.0)));
        stone *= 0.80 + 0.28 * mid + 0.16 * (grain - 0.5) * (0.4 + nearF);
        // Granite speckles: dark mica and pale feldspar crystals.
        stone = mix(stone, stone * 0.45, smoothstep(0.80, 0.93, fine) * 0.8);
        stone = mix(stone, vec3(0.26, 0.25, 0.235), smoothstep(0.82, 0.95, gc_noise(sp * 43.0 + 5.3)) * 0.55);
        // Cracks: thin ridged-noise lines with a little domain warp.
        float cr = 1.0 - abs(gc_noise(sp * vec3(2.2, 3.0, 2.2) + warp * 1.2 + vSeed) * 2.0 - 1.0);
        float crack = smoothstep(0.978, 0.997, cr) * smoothstep(0.55, 0.72, gc_noise(sp * 0.6 + vSeed + 13.0));
        float cr2 = 1.0 - abs(gc_noise(sp * 6.0 + warp * 2.0 + 9.0) * 2.0 - 1.0);
        crack = max(crack, smoothstep(0.982, 0.997, cr2) * 0.5 * nearF);
        // Moss on upward-facing surfaces (and creeping up from the ground).
        float groundBand = 1.0 - smoothstep(0.0, 0.4, sp.y);
        float mn = gc_fbm(sp * 1.35 + vSeed + 5.0);
        float mossM = vWNrm.y * 0.95 + (mn - 0.5) * 1.25 + (gc_noise(sp * 9.0) - 0.5) * 0.3 + groundBand * 0.25;
        #ifdef GC_SMALL
          float moss = smoothstep(0.55, 0.8, mossM) * 0.6;
        #else
          float moss = smoothstep(0.42, 0.62, mossM + (gc_noise(sp * 14.0) - 0.5) * 0.18);
        #endif
        float mossSpeck = gc_noise(sp * 26.0) * 0.6 + gc_noise(sp * 71.0) * 0.4;
        vec3 mossC = mix(vec3(0.036, 0.052, 0.012), vec3(0.095, 0.120, 0.026), mossSpeck);
        float mossV = gc_noise(sp * 2.2 + 2.0);
        mossC = mix(mossC, vec3(0.120, 0.125, 0.032), smoothstep(0.55, 0.85, mossV) * 0.7);
        mossC = mix(mossC, vec3(0.020, 0.032, 0.012), smoothstep(0.45, 0.15, mossV) * 0.5);
        // Lichen crusts: pale grey-green blotches and the odd ochre one.
        float lf = gc_fbm(sp * 2.6 + vSeed + 11.0);
        float lichen = smoothstep(0.64, 0.70, lf) * (1.0 - moss);
        vec3 lichenC = mix(vec3(0.24, 0.25, 0.19), vec3(0.30, 0.22, 0.07), step(0.8, gc_noise(sp * 1.1 + 4.0)));
        stone = mix(stone, lichenC * (0.8 + 0.4 * fine), lichen * 0.55);
        // Speckled tiny lichen dots everywhere.
        stone = mix(stone, vec3(0.22, 0.23, 0.18), smoothstep(0.86, 0.93, gc_noise(sp * 31.0 + 2.0)) * 0.5 * (1.0 - moss));
        stone *= 1.0 - crack * 0.35;
        mossC *= 0.75 + 0.5 * gc_noise(sp * 140.0) * nearF + 0.25 * (1.0 - nearF);
        vec3 col = mix(stone, mossC, moss);
        // Contact darkening near the ground.
        #ifdef GC_SMALL
          col *= mix(0.62, 1.0, smoothstep(-0.02, 0.1, sp.y));
        #else
          col *= mix(0.38, 1.0, smoothstep(-0.05, 0.55, sp.y));
        #endif
        diffuseColor.rgb *= col;
        float gcH = big * 0.35 + mid * 0.45 + gc_noise(sp * 7.0) * 0.25 + grain * 0.12 * nearF - crack * (1.0 - moss) * 0.12 + moss * (mossSpeck * 0.5 + 0.2);
        float gcMoss = moss;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.86 + 0.12 * mid, 1.0, gcMoss);'
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = gc_bump(normal, gcH * ' + (small ? '0.006' : '0.03') + ', faceDirection);'
      );
  };
  mat.customProgramCacheKey = () => (small ? 'gc-stone-small' : 'gc-stone');
  return mat;
}

// Boulder geometry: sphere carved by a few smooth plane cuts (blocky
// jointed granite) plus multi-octave 3D noise, then normalised so that the
// max horizontal radius is 1, the top is at y = 1 and ~30% sits below y = 0.
function makeBoulderGeometry(seed, detail, { cuts = 4, k = 0.22, aspect = [1, 0.8, 1], amp = 0.42, flatTop = 0 }) {
  const rand = makeRng(seed * 7919 + 13);
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const planes = [];
  for (let i = 0; i < cuts; i++) {
    const a = rand() * Math.PI * 2;
    const y = (rand() - 0.3) * 1.2;
    const n = new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize();
    planes.push({ n, h: 0.68 + rand() * 0.24 });
  }
  if (flatTop) planes.push({ n: new THREE.Vector3((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize(), h: flatTop });
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    let r = 1 + (fbm3(d.x * 1.2 + 9, d.y * 1.2, d.z * 1.2, seed, 3) - 0.5) * amp;
    for (const p of planes) {
      const c = d.dot(p.n);
      if (c > 0.02) r = smin(r, p.h / c, k);
    }
    // Weathering: medium bumps, erosion grooves and fine roughness.
    r *= 1 + (fbm3(d.x * 3.6, d.y * 3.6, d.z * 3.6, seed + 5, 3) - 0.5) * 0.11;
    const groove = 1 - Math.abs(noise3(d.x * 2.2 + 4, d.y * 3.5, d.z * 2.2, seed + 9) * 2 - 1);
    r *= 1 - Math.pow(groove, 6) * 0.04;
    r *= 1 + (noise3(d.x * 11, d.y * 11, d.z * 11, seed + 3) - 0.5) * 0.022;
    pos.setXYZ(i, d.x * r * aspect[0], d.y * r * aspect[1], d.z * r * aspect[2]);
  }
  // Squash the underside (it's buried) and normalise.
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const yG = bb.min.y + 0.3 * (bb.max.y - bb.min.y);
  const ky = 1 / (bb.max.y - yG);
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
  for (let i = 0; i < pos.count; i++) {
    let y = (pos.getY(i) - yG) * ky;
    if (y < -0.2) y = -0.2 + (y + 0.2) * 0.5;
    pos.setXYZ(i, pos.getX(i) / maxR, y, pos.getZ(i) / maxR);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makePebbleGeometry() {
  let geo = new THREE.IcosahedronGeometry(1, 1);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = 1 + (fbm3(x * 1.3, y * 1.3, z * 1.3, 77, 2) - 0.5) * 0.6;
    pos.setXYZ(i, x * r, y * r * 0.55 + 0.25, z * r * 0.85);
  }
  geo.computeVertexNormals();
  return geo;
}

// --- Wood (logs, twigs) -----------------------------------------------------

function makeWoodMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.55 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS + 'attribute float aWood;\nvarying float vWood;\n')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_WORLD + 'vWood = aWood;\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS + 'varying float vWood;\n' + GLSL_NOISE + GLSL_BUMP)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 o = vOPos;
        float s = vSeed.x + vSeed.z * 1.7;
        float th = atan(o.z, o.y);
        vec2 bc = vec2(th * 0.3, o.x);
        float camD = length(vViewPosition);
        float nearF = 1.0 - smoothstep(5.0, 22.0, camD);
        // Bark: long plates separated by deep, branching furrows.
        float wv = gc_noise(vec3(bc.x * 2.0, bc.y * 0.35, s)) - 0.5;
        float n1 = gc_noise(vec3(bc.x * 16.0 + wv * 1.2, bc.y * 0.55, s + 3.0));
        float furrow = smoothstep(0.62, 0.88, 1.0 - abs(n1 * 2.0 - 1.0));
        float n2 = gc_noise(vec3(bc.x * 34.0, bc.y * 1.2, s + 7.0));
        furrow = max(furrow, smoothstep(0.86, 0.97, 1.0 - abs(n2 * 2.0 - 1.0)) * 0.6);
        float cross_ = smoothstep(0.90, 0.99, 1.0 - abs(gc_noise(vec3(bc.x * 7.0, bc.y * 3.2, s + 11.0)) * 2.0 - 1.0)) * smoothstep(0.35, 0.6, gc_noise(vec3(bc.x * 4.0, bc.y * 1.5, s + 2.0)));
        float plateN = gc_noise(vec3(bc.x * 40.0, bc.y * 6.0, s + 1.0));
        float plateBig = gc_noise(vec3(bc.x * 5.0, bc.y * 0.9, s + 15.0));
        vec3 plate = mix(vec3(0.085, 0.055, 0.034), vec3(0.19, 0.13, 0.085), plateN * 0.6 + plateBig * 0.4);
        float weather = smoothstep(0.35, 0.75, gc_fbm(vec3(bc * vec2(2.0, 0.5), s + 21.0)));
        plate = mix(plate, vec3(0.15, 0.135, 0.115) * (0.8 + 0.4 * plateN), weather * 0.35);
        vec3 bark = mix(plate, vec3(0.025, 0.018, 0.013), max(furrow, cross_) * 0.9);
        float barkH = (1.0 - furrow) * 0.8 - cross_ * 0.6 + plateBig * 0.3 + plateN * 0.2 * nearF;
        // End grain / broken wood: growth rings, radial checks, rotten heart.
        float isWood = step(0.5, vWood);
        float rn = clamp(vWood - 1.0, 0.0, 1.0);
        float rings = fract(rn * 12.0 + gc_noise(vec3(th * 1.5, rn * 2.0, s)) * 0.8);
        float ringLine = smoothstep(0.75, 0.95, rings);
        vec3 woodC = mix(vec3(0.27, 0.18, 0.10), vec3(0.17, 0.11, 0.06), ringLine);
        float grey = smoothstep(0.3, 0.7, gc_noise(vec3(th * 2.0, rn * 4.0, s + 4.0)));
        woodC = mix(woodC, vec3(0.15, 0.135, 0.115), grey * 0.45 + smoothstep(0.75, 1.0, rn) * 0.3);
        float chk = smoothstep(0.93, 0.985, 1.0 - abs(gc_noise(vec3(th * 7.0, rn * 1.2, s + 9.0)) * 2.0 - 1.0)) * step(0.12, rn);
        woodC *= 1.0 - chk * 0.75;
        woodC = mix(woodC, vec3(0.07, 0.045, 0.03), smoothstep(0.18, 0.0, rn) * 0.8);
        // Splintered surface along the broken fibres.
        float fibre = gc_noise(vec3(o.y * 40.0, o.z * 40.0, o.x * 4.0));
        woodC *= 0.85 + 0.3 * fibre;
        float woodH = -ringLine * 0.3 - chk * 0.8 + fibre * 0.3;
        vec3 col = mix(bark, woodC, isWood);
        // Moss on top of the log.
        float mn = gc_fbm(vWPos * 1.5 + vec3(s));
        float mossM = vWNrm.y + (mn - 0.5) * 1.3 + (gc_noise(vWPos * 8.0) - 0.5) * 0.3;
        float moss = smoothstep(0.42, 0.68, mossM) * (1.0 - isWood * 0.75);
        float mossSpeck = gc_noise(vWPos * 30.0);
        vec3 mossC = mix(vec3(0.028, 0.048, 0.010), vec3(0.085, 0.115, 0.022), mossSpeck);
        col = mix(col, mossC, moss);
        // Lichen spots on bark.
        float lich = smoothstep(0.7, 0.76, gc_fbm(vWPos * 3.4 + 2.0)) * (1.0 - isWood) * (1.0 - moss);
        col = mix(col, vec3(0.22, 0.24, 0.17), lich * 0.7);
        col *= mix(0.45, 1.0, smoothstep(-0.02, 0.14, vWPos.y));
        diffuseColor.rgb *= col;
        float gcH = mix(barkH, woodH, isWood) + moss * mossSpeck * 0.3;
        float gcMoss = moss;
        `
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.88, 1.0, gcMoss);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = gc_bump(normal, gcH * 0.014, faceDirection);');
  };
  mat.customProgramCacheKey = () => 'gc-wood';
  return mat;
}

// Fallen log lying along +X, centred on the origin, radius ~0.29 at
// mid-length. One end is broken and splintered, the other rough-sawn/rotted.
function makeLogGeometry(L, seed, radial, perMeter) {
  const rand = makeRng(seed * 131 + 7);
  const pos = [];
  const wood = [];
  const idx = [];
  const R0 = 0.285 + rand() * 0.02;
  const oval = rand() * Math.PI;
  const endA = 0.16; // jag depth of the broken end (+X)
  const endB = 0.06; // rough end (-X)
  const jagA = (j) => {
    const a = (j / radial) * Math.PI * 2;
    const spikes = Math.pow(noise3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0, seed + 41), 1.5);
    const teeth = hash3(j, 3, 1, seed) * 0.35;
    return (spikes * 0.75 + teeth) * endA;
  };
  const jagB = (j) => hash3(j, 5, 2, seed) * endB + noise3(j * 0.4, 0, 0, seed + 3) * endB;
  const radiusAt = (x, a) => {
    const t = x / L + 0.5;
    let r = R0 * (1.07 - 0.14 * t);
    r *= 1 + (fbm3(x * 0.35, Math.cos(a) * 0.8, Math.sin(a) * 0.8, seed + 11, 3) - 0.5) * 0.16;
    r *= 1 + 0.05 * Math.cos(2 * a + oval);
    // Longitudinal bark ridges in the silhouette.
    const rg = 1 - Math.abs(noise3(Math.cos(a) * 3 + 2, Math.sin(a) * 3, x * 0.5, seed + 13) * 2 - 1);
    r *= 1 - Math.pow(rg, 4) * 0.045;
    return r;
  };
  const bendY = (x) => (noise3(x * 0.25, 0, 0, seed + 21) - 0.5) * 0.06;
  const bendZ = (x) => (noise3(x * 0.2, 5, 0, seed + 23) - 0.5) * 0.18;

  // Ring x positions: the end rings are jagged, interior rings uniform.
  const inner = Math.max(4, Math.ceil(L * perMeter));
  const xs = [];
  const x0 = -L / 2 + 0.12;
  const x1 = L / 2 - 0.3;
  for (let i = 0; i <= inner; i++) xs.push(x0 + (i / inner) * (x1 - x0));
  const rings = []; // array of arrays of vertex indices
  const pushV = (x, y, z, w) => {
    pos.push(x, y, z);
    wood.push(w);
    return pos.length / 3 - 1;
  };
  const ringAt = (getX, rScale = 1) => {
    const ring = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const x = getX(j);
      const r = radiusAt(x, a) * rScale;
      ring.push(pushV(x, bendY(x) + Math.cos(a) * r, bendZ(x) + Math.sin(a) * r, 0));
    }
    return ring;
  };
  rings.push(ringAt((j) => -L / 2 + jagB(j), 0.97));
  for (const x of xs) rings.push(ringAt(() => x));
  // A splintered taper towards the broken end.
  rings.push(ringAt((j) => L / 2 - 0.3 + (0.3 - jagA(j)) * 0.5, 0.985));
  rings.push(ringAt((j) => L / 2 - jagA(j), 0.95));
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      idx.push(a[j], b[j], a[j1], a[j1], b[j], b[j1]);
    }
  }
  // End caps (separate vertices so they get their own normals + wood flag).
  const cap = (ring, sign, jag, depth) => {
    const fr = [1, 0.72, 0.45, 0.2];
    const rows = [];
    let cx = 0;
    for (const vi of ring) cx += pos[vi * 3];
    cx /= ring.length;
    const cy = bendY(cx);
    const cz = bendZ(cx);
    for (let k = 0; k < fr.length; k++) {
      const row = [];
      for (let j = 0; j < radial; j++) {
        const vi = ring[j];
        const px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2];
        const f = fr[k];
        let x = px;
        if (k > 0) {
          // Splinters: interior fibres stick out unevenly on the broken end.
          const sp = hash3(j, k, 7, seed) * depth + noise3(j * 0.5, k, 0, seed + 51) * depth;
          x = cx + sign * (jag ? sp - depth * 0.5 : -depth * 0.3 * (1 - f));
        }
        row.push(pushV(x, cy + (py - cy) * f, cz + (pz - cz) * f, 1 + f));
      }
      rows.push(row);
    }
    const c = pushV(cx + sign * (jag ? depth * 0.4 : -0.02), cy, cz, 1.0);
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k], b = rows[k + 1];
      for (let j = 0; j < radial; j++) {
        const j1 = (j + 1) % radial;
        if (sign > 0) idx.push(a[j], a[j1], b[j], a[j1], b[j1], b[j]);
        else idx.push(a[j], b[j], a[j1], a[j1], b[j], b[j1]);
      }
    }
    const last = rows[rows.length - 1];
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      if (sign > 0) idx.push(last[j], last[j1], c);
      else idx.push(last[j], c, last[j1]);
    }
  };
  cap(rings[0], -1, false, 0.05);
  cap(rings[rings.length - 1], 1, true, 0.06);

  let trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 1));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();

  // Branch stubs.
  const parts = [trunk];
  const stubs = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < stubs; i++) {
    const x = (rand() - 0.5) * (L - 1.4);
    const a = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 1.1); // around the top/sides
    const len = 0.18 + rand() * 0.22;
    const rb = 0.05 + rand() * 0.03;
    const g = new THREE.CylinderGeometry(rb * 0.6, rb, len + 0.2, 8, 2);
    g.deleteAttribute('uv');
    const n = g.attributes.normal;
    const p = g.attributes.position;
    const w = new Float32Array(p.count);
    for (let v = 0; v < p.count; v++) {
      if (n.getY(v) > 0.99 && p.getY(v) > 0) w[v] = 1 + Math.hypot(p.getX(v), p.getZ(v)) / (rb * 0.6);
      // Ragged broken tip.
      if (p.getY(v) > 0) p.setY(v, p.getY(v) + (hash3(v, i, 3, seed) - 0.5) * 0.06);
    }
    g.setAttribute('aWood', new THREE.BufferAttribute(w, 1));
    g.translate(0, (len + 0.2) / 2, 0);
    // Orient: radial direction at angle a, leaning towards +/-X.
    const dir = new THREE.Vector3((rand() - 0.5) * 1.2, Math.cos(a), Math.sin(a)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    const r = radiusAt(x, a) * 0.7;
    g.translate(x, bendY(x) + Math.cos(a) * r, bendZ(x) + Math.sin(a) * r);
    g.computeVertexNormals();
    parts.push(g);
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g : g)), false);
  merged.computeBoundingSphere();
  return merged;
}

// Thin crooked branch lying along +X (length ~1), resting on y = 0.
function makeTwigGeometry() {
  const pos = [];
  const wood = [];
  const idx = [];
  const tube = (pts, r0, r1, radial) => {
    const base = pos.length / 3;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const nx = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      const s = new THREE.Vector3().crossVectors(nx, up).normalize();
      const u = new THREE.Vector3().crossVectors(s, nx).normalize();
      const r = r0 + (r1 - r0) * (i / (pts.length - 1));
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        pos.push(p.x + (u.x * Math.cos(a) + s.x * Math.sin(a)) * r, p.y + (u.y * Math.cos(a) + s.y * Math.sin(a)) * r, p.z + (u.z * Math.cos(a) + s.z * Math.sin(a)) * r);
        wood.push(0);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * radial + j;
        const b = base + i * radial + ((j + 1) % radial);
        idx.push(a, a + radial, b, b, a + radial, b + radial);
      }
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  tube([V(-0.5, 0.022, 0), V(-0.2, 0.02, 0.03), V(0.1, 0.018, -0.02), V(0.5, 0.012, 0.04)], 0.022, 0.009, 6);
  tube([V(-0.15, 0.02, 0.02), V(0.0, 0.03, 0.13), V(0.12, 0.02, 0.25)], 0.011, 0.004, 4);
  tube([V(0.18, 0.017, -0.01), V(0.28, 0.035, -0.1), V(0.33, 0.02, -0.18)], 0.008, 0.003, 4);
  tube([V(-0.38, 0.02, 0.0), V(-0.42, 0.05, -0.09)], 0.009, 0.004, 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- Small solid props (vertex coloured) ------------------------------------

function makePineConeGeometry() {
  const pts = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = 0.028 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.002;
    pts.push(new THREE.Vector2(r, t * 0.085));
  }
  const g = new THREE.LatheGeometry(pts, 8);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let v = 0; v < p.count; v++) {
    const ring = Math.round((p.getY(v) / 0.085) * n);
    const seg = Math.round(((Math.atan2(p.getZ(v), p.getX(v)) + Math.PI) / (Math.PI * 2)) * 8);
    const bump = (ring + seg) % 2 === 0 ? 1.28 : 0.85;
    p.setX(v, p.getX(v) * bump);
    p.setZ(v, p.getZ(v) * bump);
    const c = (ring + seg) % 2 === 0 ? 1 : 0.55;
    col[v * 3] = 0.16 * c;
    col[v * 3 + 1] = 0.085 * c;
    col[v * 3 + 2] = 0.04 * c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.rotateZ(Math.PI / 2);
  g.translate(0.04, 0.026, 0);
  g.computeVertexNormals();
  return g;
}

function makeMushroomGeometry() {
  const one = (h, capR, x, z, tilt) => {
    const stem = new THREE.CylinderGeometry(capR * 0.22, capR * 0.3, h, 6, 1, true);
    stem.translate(0, h / 2, 0);
    const prof = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const a = t * Math.PI * 0.5;
      prof.push(new THREE.Vector2(Math.sin(a) * capR + 0.0001, Math.cos(a) * capR * 0.55));
    }
    prof.reverse();
    prof.unshift(new THREE.Vector2(capR * 0.25, -capR * 0.08));
    const cap = new THREE.LatheGeometry(prof, 8);
    cap.translate(0, h, 0);
    const parts = [stem, cap].map((g) => {
      g.deleteAttribute('uv');
      const p = g.attributes.position;
      const c = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const isCap = g === cap;
        const y = p.getY(v) - h;
        let r = 0.55, gg = 0.5, b = 0.42;
        if (isCap) {
          if (y < capR * 0.02) { r = 0.6; gg = 0.55; b = 0.45; } // gills
          else { const t = y / (capR * 0.55); r = 0.42 - t * 0.2; gg = 0.24 - t * 0.12; b = 0.12 - t * 0.06; }
        }
        c[v * 3] = r; c[v * 3 + 1] = gg; c[v * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.rotateZ(tilt);
      g.translate(x, 0, z);
      return g;
    });
    return parts;
  };
  const parts = [...one(0.07, 0.035, 0, 0, 0.05), ...one(0.05, 0.026, 0.05, 0.03, -0.2), ...one(0.035, 0.018, -0.03, 0.04, 0.25)];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// --- Canvas atlases -----------------------------------------------------------

// Turns a canvas with transparent background into a mipmapped texture whose
// transparent texels carry the colour of their nearest opaque neighbour
// (prevents the dark fringe alpha-tested cards get from black texels).
function atlasTexture(canvas, dilatePasses = 6) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const data = new Uint8ClampedArray(src);
  let filled = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] > 8) {
      filled[i] = 1;
      sr += src[i * 4]; sg += src[i * 4 + 1]; sb += src[i * 4 + 2]; sn++;
    }
  }
  for (let pass = 0; pass < dilatePasses; pass++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nb) {
          if (j >= 0 && filled[j]) { r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; c++; }
        }
        if (c) {
          data[i * 4] = r / c; data[i * 4 + 1] = g / c; data[i * 4 + 2] = b / c;
          next[i] = 1;
        }
      }
    }
    filled = next;
  }
  const mr = sn ? sr / sn : 60, mg = sn ? sg / sn : 70, mb = sn ? sb / sn : 30;
  for (let i = 0; i < w * h; i++) {
    if (!filled[i]) { data[i * 4] = mr; data[i * 4 + 1] = mg; data[i * 4 + 2] = mb; }
    if (src[i * 4 + 3] <= 8) data[i * 4 + 3] = 0;
  }
  // Flip so that v = 0 is the bottom of the canvas.
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// One grass blade as a tapered, curved filled shape (base at bx,by).
function drawBlade(ctx, bx, by, height, lean, width, col, rand, darkBase = 0.38) {
  const tx = bx + lean * height;
  const ty = by - height * (1 - Math.abs(lean) * 0.25);
  const cx = bx + lean * height * 0.25 + (rand() - 0.5) * 10;
  const cy = by - height * 0.62;
  const steps = 10;
  const left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * tx;
    const y = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy + t * t * ty;
    const dx = 2 * (1 - t) * (cx - bx) + 2 * t * (tx - cx);
    const dy = 2 * (1 - t) * (cy - by) + 2 * t * (ty - cy);
    const l = Math.hypot(dx, dy) || 1;
    const w = width * Math.pow(1 - t, 0.85) * (0.3 + 0.7 * Math.min(1, t * 4)) * 0.5 + 0.2;
    left.push([x - (dy / l) * w, y + (dx / l) * w]);
    right.push([x + (dy / l) * w, y - (dx / l) * w]);
  }
  const grad = ctx.createLinearGradient(bx, by, tx, ty);
  const [r, g, b] = col;
  const root = rgb(52 * darkBase + r * 0.12, 64 * darkBase + g * 0.12, 26 * darkBase + b * 0.12, 0);
  grad.addColorStop(0, root);
  grad.addColorStop(0.02 + rand() * 0.12, rgb(52 * darkBase + r * 0.15, 64 * darkBase + g * 0.15, 26 * darkBase + b * 0.15));
  grad.addColorStop(0.3, rgb(r * 0.72, g * 0.74, b * 0.7));
  grad.addColorStop(1, rgb(Math.min(255, r * 1.18), Math.min(255, g * 1.15), Math.min(255, b * 1.1)));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  return { tx, ty, cx, cy, bx, by };
}

function drawSeedHead(ctx, b, rand, col) {
  // Oat/foxtail-like head along the last part of the stalk.
  const n = 7 + Math.floor(rand() * 7);
  for (let i = 0; i < n; i++) {
    const t = 0.8 + (i / n) * 0.2;
    const x = (1 - t) * (1 - t) * b.bx + 2 * (1 - t) * t * b.cx + t * t * b.tx;
    const y = (1 - t) * (1 - t) * b.by + 2 * (1 - t) * t * b.cy + t * t * b.ty;
    const side = i % 2 ? 1 : -1;
    ctx.fillStyle = rgb(col[0] * (0.8 + rand() * 0.4), col[1] * (0.8 + rand() * 0.4), col[2] * (0.8 + rand() * 0.3));
    ctx.beginPath();
    ctx.ellipse(x + side * 2.5, y, 2 + rand() * 1.2, 5 + rand() * 3, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 1024x1024 grass atlas: four 512x512 tuft variants.
function makeGrassAtlas() {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rand = makeRng(4242);
  const variants = [
    { blades: 170, hMin: 170, hMax: 470, dry: 0.07, seeds: 0, width: [3, 6], spread: 'flat' },
    { blades: 190, hMin: 110, hMax: 320, dry: 0.12, seeds: 0, width: [2.5, 5], spread: 'flat' },
    { blades: 150, hMin: 150, hMax: 430, dry: 0.3, seeds: 14, width: [2.5, 4.5], spread: 'flat' },
    { blades: 120, hMin: 190, hMax: 480, dry: 0.12, seeds: 8, width: [3.5, 7], spread: 'clump' },
  ];
  variants.forEach((v, k) => {
    const ox = (k % 2) * 512;
    const oy = Math.floor(k / 2) * 512;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + 4, oy + 4, 504, 504);
    ctx.clip();
    const blades = [];
    for (let i = 0; i < v.blades + v.seeds; i++) {
      const g = v.spread === 'flat' ? (rand() - 0.5) * 2 * 0.86 : (rand() + rand() + rand() - 1.5) / 1.5;
      const bx = ox + 256 + g * (v.spread === 'flat' ? 220 : 150);
      const off = (bx - ox - 256) / 220;
      const isSeed = i >= v.blades;
      const height = isSeed ? v.hMax * (0.9 + rand() * 0.12) : v.hMin + (v.hMax - v.hMin) * Math.pow(rand(), 0.8) * (1 - Math.abs(off) * 0.35);
      let lean = off * 0.35 + (rand() - 0.5) * 0.5;
      const tipX = bx + lean * height;
      if (tipX < ox + 14) lean = (ox + 14 - bx) / height;
      if (tipX > ox + 498) lean = (ox + 498 - bx) / height;
      blades.push({ bx, height, lean, isSeed, depth: rand() });
    }
    blades.sort((a, b) => a.depth - b.depth);
    for (const b of blades) {
      let col;
      if (b.isSeed || rand() < v.dry) {
        const l = 0.8 + rand() * 0.4;
        col = [168 * l, 150 * l, 88 * l];
      } else {
        const l = 0.65 + rand() * 0.55 + b.depth * 0.15;
        const yel = rand();
        col = [(58 + yel * 45) * l, (100 + yel * 25) * l, (30 + yel * 10) * l];
      }
      const width = b.isSeed ? 2.2 : v.width[0] + rand() * (v.width[1] - v.width[0]);
      const shade = 0.75 + b.depth * 0.25;
      const bl = drawBlade(ctx, b.bx, oy + 508 - rand() * 10, b.height, b.lean, width, col.map((c) => c * shade), rand, 0.55);
      if (b.isSeed) drawSeedHead(ctx, bl, rand, [150, 128, 80]);
      // Subtle midrib highlight on wider blades.
      if (!b.isSeed && width > 5 && rand() < 0.5) {
        ctx.strokeStyle = 'rgba(200,220,150,0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(bl.bx, bl.by - b.height * 0.2);
        ctx.quadraticCurveTo(bl.cx, bl.cy, bl.tx, bl.ty);
        ctx.stroke();
      }
    }
    ctx.restore();
  });
  return atlasTexture(canvas, 8);
}

function drawLeafShape(ctx, x, y, size, ang, col, lobed, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = rgb(col[0], col[1], col[2]);
  ctx.beginPath();
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    let r = Math.abs(Math.sin(t / 2)) ** 0.9;
    if (lobed) r *= 0.75 + 0.25 * Math.abs(Math.sin(t * 3.5));
    const px = Math.cos(t) * size;
    const py = Math.sin(t) * size * 0.45 * r + Math.sin(t) * size * 0.08;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // Midrib + curl shading
  ctx.strokeStyle = rgb(col[0] * 0.6, col[1] * 0.55, col[2] * 0.5, 0.7);
  ctx.lineWidth = Math.max(0.6, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(-size * 1.15, 0);
  ctx.lineTo(size * 0.9, 0);
  ctx.stroke();
  ctx.fillStyle = rgb(0, 0, 0, 0.12 + rand() * 0.15);
  ctx.beginPath();
  ctx.ellipse(0, size * 0.18, size * 0.85, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function blobPath(ctx, cx, cy, r, rand, wob = 0.3) {
  ctx.beginPath();
  const n = 28;
  const ph = [rand() * 6, rand() * 6, rand() * 6];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wob * (0.5 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.2 * Math.sin(a * 9 + ph[2])));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// 1024x1024 clutter atlas (256px grid). Returned rects are in UV space with
// v = 0 at the bottom: [u0, v0, du, dv].
function makeClutterAtlas() {
  const S = 1024;
  const T = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rand = makeRng(9191);
  const uv = (col, row, w = 1, h = 1) => [(col * T) / S, 1 - ((row + h) * T) / S, (w * T) / S, (h * T) / S];
  const clipTile = (col, row, w = 1, h = 1) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * T + 3, row * T + 3, w * T - 6, h * T - 6);
    ctx.clip();
  };

  // Leaf litter tiles.
  const leafPalettes = [
    [[105, 72, 44], [128, 92, 58], [84, 60, 40], [140, 108, 70], [70, 52, 38], [118, 76, 46]],
    [[122, 98, 66], [100, 78, 52], [148, 122, 84], [82, 64, 46], [126, 90, 56]],
    [[150, 128, 76], [162, 140, 88], [122, 100, 62], [104, 82, 54], [90, 70, 48]],
  ];
  const makeClusters = (cx, cy) => {
    const out = [[cx, cy, 70]];
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2;
      const d = 30 + rand() * 45;
      out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, 25 + rand() * 30]);
    }
    return out;
  };
  const litter = (col, row, pal, lobed, count) => {
    clipTile(col, row);
    const cx = col * T + T / 2, cy = row * T + T / 2;
    const clusters = makeClusters(cx, cy);
    for (let i = 0; i < count; i++) {
      const cl = clusters[Math.floor(rand() * clusters.length)];
      const r = cl[2] * Math.pow(rand(), 0.7);
      const a = rand() * Math.PI * 2;
      const x = cl[0] + Math.cos(a) * r, y = cl[1] + Math.sin(a) * r;
      const c = pal[Math.floor(rand() * pal.length)];
      const l = 0.7 + rand() * 0.45;
      drawLeafShape(ctx, x, y, 5 + rand() * 6, rand() * 6.28, c.map((v) => v * l), lobed && rand() < 0.6, rand);
    }
    ctx.restore();
  };
  litter(0, 0, leafPalettes[0], true, 300);
  litter(1, 0, leafPalettes[1], false, 320);
  litter(0, 3, leafPalettes[2], false, 280);

  // Needle litter.
  const needles = (col, row, twigs) => {
    clipTile(col, row);
    const cx = col * T + T / 2, cy = row * T + T / 2;
    ctx.lineCap = 'round';
    const clusters = makeClusters(cx, cy);
    for (let i = 0; i < 3200; i++) {
      const cl = clusters[Math.floor(rand() * clusters.length)];
      const r = cl[2] * Math.pow(rand(), 0.6);
      const a = rand() * Math.PI * 2;
      const x = cl[0] + Math.cos(a) * r, y = cl[1] + Math.sin(a) * r;
      const ang = rand() * Math.PI;
      const len = 5 + rand() * 8;
      const l = 0.6 + rand() * 0.6;
      ctx.strokeStyle = rand() < 0.25 ? rgb(100 * l, 88 * l, 70 * l) : rgb(128 * l, 88 * l, 56 * l);
      ctx.lineWidth = 0.7 + rand() * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5);
      ctx.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5);
      ctx.stroke();
    }
    if (twigs) {
      for (let i = 0; i < 9; i++) {
        const x = cx + (rand() - 0.5) * 150, y = cy + (rand() - 0.5) * 150;
        const ang = rand() * Math.PI;
        const len = 20 + rand() * 30;
        ctx.strokeStyle = rgb(70, 50, 35);
        ctx.lineWidth = 1.2 + rand() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  needles(2, 0, false);
  needles(1, 3, true);

  // Moss patch.
  {
    clipTile(3, 0);
    const cx = 3 * T + T / 2, cy = T / 2;
    const clusters = makeClusters(cx, cy);
    for (const cl of clusters) {
      ctx.fillStyle = rgb(50, 70, 24);
      blobPath(ctx, cl[0], cl[1], cl[2] * 0.6, rand, 0.45);
      ctx.fill();
    }
    for (let i = 0; i < 7000; i++) {
      const cl = clusters[Math.floor(rand() * clusters.length)];
      const r = cl[2] * Math.pow(rand(), 0.55);
      const a = rand() * Math.PI * 2;
      const l = 0.55 + rand() * 0.8;
      ctx.fillStyle = rand() < 0.15 ? rgb(95 * l, 100 * l, 40 * l) : rgb(52 * l, 82 * l, 22 * l);
      ctx.fillRect(cl[0] + Math.cos(a) * r, cl[1] + Math.sin(a) * r, 1.2 + rand() * 2, 1.2 + rand() * 2);
    }
    ctx.restore();
  }

  // Clover patch (flat).
  {
    clipTile(2, 3);
    const cx = 2 * T + T / 2, cy = 3 * T + T / 2;
    for (let i = 0; i < 70; i++) {
      const r = 95 * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const s = 6 + rand() * 4;
      const l = 0.7 + rand() * 0.5;
      for (let k = 0; k < 3; k++) {
        const la = rand() * 6 + (k * Math.PI * 2) / 3;
        ctx.fillStyle = rgb(50 * l, 95 * l, 30 * l);
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(la) * s * 0.8, y + Math.sin(la) * s * 0.8, s * 0.75, s * 0.65, la, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(210,230,190,0.35)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(la) * s * 0.8, y + Math.sin(la) * s * 0.8, s * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Fern fronds (256x512, base at the bottom).
  const fern = (col, light) => {
    clipTile(col, 1, 1, 2);
    const bx = col * T + T / 2;
    const by = 3 * T - 6;
    const top = T + 10;
    const len = by - top;
    const curve = (t) => bx + Math.sin(t * 2.2) * 10;
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const t = 0.06 + (i / 26) * 0.92;
      const y = by - t * len;
      const x = curve(t);
      const pl = 112 * Math.pow(1 - t, 0.75) * Math.min(1, (t + 0.05) * 4);
      for (const side of [-1, 1]) {
        const ang = side * (1.05 - t * 0.25);
        const ex = x + Math.sin(ang) * pl;
        const ey = y - Math.cos(ang) * pl * 0.55 - pl * 0.12;
        const pin = Math.max(3, Math.floor(pl / 7));
        for (let k = 0; k < pin; k++) {
          const u = k / pin;
          const px = x + (ex - x) * u;
          const py = y + (ey - y) * u;
          const w = (1 - u * 0.75) * 6.2;
          const l = light * (0.75 + rand() * 0.35) * (0.85 + t * 0.3);
          ctx.fillStyle = rgb(62 * l, 112 * l, 30 * l);
          ctx.beginPath();
          ctx.ellipse(px, py, w * 0.7, w, ang + 0.3 * side, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = rgb(70 * light, 90 * light, 35 * light);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const y = by - t * len;
      if (i === 0) ctx.moveTo(curve(t), y);
      else ctx.lineTo(curve(t), y);
    }
    ctx.stroke();
    ctx.restore();
  };
  fern(0, 1);
  fern(1, 0.82);

  // Flower cards (256x256, stems from the bottom).
  const flowers = (col, row, kind) => {
    clipTile(col, row);
    const ox = col * T, oy = row * T;
    const n = kind === 'daisy' ? 9 : kind === 'butter' ? 11 : kind === 'bell' ? 8 : 8;
    // A few leaves at the base.
    for (let i = 0; i < 14; i++) {
      const bx = ox + 128 + (rand() - 0.5) * 150;
      drawBlade(ctx, bx, oy + 252, 40 + rand() * 60, (rand() - 0.5) * 0.9, 5, [60, 105, 35], rand, 0.5);
    }
    for (let i = 0; i < n; i++) {
      const bx = ox + 128 + (rand() - 0.5) * 170;
      const h = 90 + rand() * 140;
      const lean = (rand() - 0.5) * 0.3;
      const b = drawBlade(ctx, bx, oy + 252, h, lean, 2.2, [70, 110, 40], rand, 0.6);
      const x = b.tx, y = b.ty;
      if (kind === 'daisy') {
        const r = 10 + rand() * 5;
        for (let p = 0; p < 14; p++) {
          const a = (p / 14) * Math.PI * 2;
          ctx.fillStyle = rgb(235, 235, 225);
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.32, r * 0.5, r * 0.13, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgb(225, 175, 30);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.26, r * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'butter') {
        const r = 6 + rand() * 3;
        ctx.fillStyle = rgb(245, 200, 20);
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * Math.PI * 2 + rand();
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.3, r * 0.5, r * 0.36, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgb(200, 150, 10);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'bell') {
        // Purple spike (lupin / foxglove-ish).
        for (let k = 0; k < 12; k++) {
          const t = k / 12;
          const yy = y + t * 55;
          const l = 0.75 + rand() * 0.4;
          ctx.fillStyle = rgb(120 * l, 70 * l, 175 * l);
          ctx.beginPath();
          ctx.ellipse(x + (k % 2 ? 4 : -4) * (1 - t * 0.3) + lean * t * 20, yy, 4.5 - t * 1.5, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Clover / campion heads: pink-red globes.
        const r = 7 + rand() * 4;
        for (let k = 0; k < 20; k++) {
          const a = rand() * Math.PI * 2;
          const rr = r * Math.sqrt(rand());
          const l = 0.75 + rand() * 0.4;
          ctx.fillStyle = rgb(205 * l, 85 * l, 120 * l);
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  };
  flowers(2, 1, 'daisy');
  flowers(3, 1, 'butter');
  flowers(2, 2, 'bell');
  flowers(3, 2, 'clover');

  return {
    texture: atlasTexture(canvas, 6),
    tiles: {
      leaves: [uv(0, 0), uv(1, 0), uv(0, 3)],
      needles: [uv(2, 0), uv(1, 3)],
      moss: uv(3, 0),
      clover: uv(2, 3),
      fern: [uv(0, 1, 1, 2), uv(1, 1, 1, 2)],
      flowers: [uv(2, 1), uv(3, 1), uv(2, 2), uv(3, 2)],
    },
  };
}

// Material for alpha-tested cards (grass, litter, ferns, flowers): per-
// instance atlas offset, wind sway, mip-aware alpha so thin blades don't
// vanish in the distance, distance fade (vertices collapse -> no overdraw),
// and lighting without back-face normal flips.
function makeCardMaterial(map, windUniform, { fadeFar = 80, sway = 1, texSize = 1024, alphaTest = 0.45 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: !location.search.includes('gcA'),
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const fadeU = { value: fadeFar };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform || { value: 0 };
    shader.uniforms.uFadeFar = fadeU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uFadeFar;\nattribute vec2 aTile;\nvarying float vCardH;\n')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vCardH = position.y;
        #ifdef USE_INSTANCING
          vec3 iPos = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
          float camDist = distance(iPos.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uFadeFar * 0.72, uFadeFar, camDist);
          float hgt = max(position.y, 0.0);
          float t = uWindTime;
          float gust = 0.55 + 0.45 * sin(t * 0.45 + iPos.x * 0.045 + iPos.z * 0.03);
          float sw = sin(t * 1.7 + iPos.x * 0.31 + iPos.z * 0.23) * 0.65 + sin(t * 3.3 + iPos.x * 1.13 + iPos.z * 0.71) * 0.25;
          vec3 windW = vec3(0.9, 0.0, 0.42) * (sw * gust + 0.35 * gust) * ${(0.16 * sway).toFixed(3)};
          float s2 = dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
          vec3 windL = transpose(mat3(instanceMatrix)) * windW / s2;
          transformed += windL * hgt * hgt * 2.2;
          transformed *= fade;
        #endif`
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv += aTile;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCardH;\n')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec2 tdx = dFdx(vMapUv * ${texSize.toFixed(1)});
          vec2 tdy = dFdy(vMapUv * ${texSize.toFixed(1)});
          float lod = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
          diffuseColor.a *= 1.0 + lod * 0.18;
          ${location.search.includes('gcB') ? 'diffuseColor.rgb = vec3(1.0, 0.0, 0.0);' : ''}
        }`
      )
      .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP);
  };
  mat.customProgramCacheKey = () => `gc-card-${fadeFar}-${sway}-${texSize}`;
  return mat;
}

// Card geometries: positions + up-biased normals + uv scaled to a tile size.
function cardGeometry(quads, tileW, tileH) {
  const pos = [], nor = [], uvs = [], idx = [];
  for (const q of quads) {
    // q: { p: [[x,y,z] x (cols*rows)], cols, rows, n: [nx,ny,nz] }
    const base = pos.length / 3;
    for (let r = 0; r < q.rows; r++) {
      for (let c = 0; c < q.cols; c++) {
        const p = q.p[r * q.cols + c];
        pos.push(p[0], p[1], p[2]);
        const n = new THREE.Vector3(q.n[0], q.n[1], q.n[2]).normalize();
        nor.push(n.x, n.y, n.z);
        uvs.push((c / (q.cols - 1)) * tileW, (r / (q.rows - 1)) * tileH);
      }
    }
    for (let r = 0; r < q.rows - 1; r++) {
      for (let c = 0; c < q.cols - 1; c++) {
        const a = base + r * q.cols + c;
        idx.push(a, a + 1, a + q.cols, a + 1, a + q.cols + 1, a + q.cols);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Crossed vertical cards with a slight outward bow; `segs` height rows.
function crossedCards(count, w, h, segs, tileW, tileH, bow = 0.05) {
  const quads = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI + 0.3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const nx = -dz, nz = dx;
    const p = [];
    for (let r = 0; r <= segs; r++) {
      const t = r / segs;
      const out = bow * t * t;
      for (let c = 0; c < 2; c++) {
        const s = (c - 0.5) * w * (1 + t * 0.15);
        p.push([dx * s + nx * out, h * t, dz * s + nz * out]);
      }
    }
    quads.push({ p, cols: 2, rows: segs + 1, n: [nx * 0.25, 1, nz * 0.25] });
  }
  return cardGeometry(quads, tileW, tileH);
}

function flatCard(tileW, tileH) {
  const p = [[-0.5, 0, 0.5], [0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5]];
  return cardGeometry([{ p, cols: 2, rows: 2, n: [0, 1, 0] }], tileW, tileH);
}

// Fern: arching fronds radiating from the centre.
function fernGeometry(tileW, tileH) {
  const quads = [];
  const rand = makeRng(55);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.5;
    const L = 0.55 + rand() * 0.3;
    const elev = 0.9 + rand() * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const w = 0.13;
    const p = [];
    const segs = 4;
    for (let r = 0; r <= segs; r++) {
      const t = r / segs;
      const d = L * t;
      const y = L * elev * (0.95 * t - 0.8 * t * t) + 0.02;
      const roll = 0.25 * t;
      for (let c = 0; c < 2; c++) {
        const s = (c - 0.5) * 2 * w;
        p.push([dx * d + px * s, y + s * roll, dz * d + pz * s]);
      }
    }
    quads.push({ p, cols: 2, rows: segs + 1, n: [dx * 0.3, 1, dz * 0.3] });
  }
  return cardGeometry(quads, tileW, tileH);
}

// --- Rocks, logs, clutter -----------------------------------------------------

export function createGroundKit({ quality, windUniform }) {
  const q = quality || { grass: 1, shadows: true };
  const hi = q.grass >= 1;
  const rockDetail = q.grass >= 1 ? 15 : q.grass >= 0.6 ? 11 : 8;
  const stoneMat = makeStoneMaterial();
  const pebbleMat = makeStoneMaterial({ small: true });
  const woodMat = makeWoodMaterial();
  const shadows = !!q.shadows;

  const rockVariants = [
    { cuts: 3, k: 0.32, aspect: [1, 0.8, 0.9], amp: 0.55 },
    { cuts: 5, k: 0.2, aspect: [1.15, 0.72, 0.9], amp: 0.45, flatTop: 0.7 },
    { cuts: 3, k: 0.28, aspect: [1.3, 0.55, 1], amp: 0.5 },
    { cuts: 4, k: 0.3, aspect: [0.95, 0.95, 0.8], amp: 0.6 },
  ].map((v, i) => new Batch(makeBoulderGeometry(101 + i * 17, rockDetail, v), stoneMat, { castShadow: shadows, name: 'boulders' }));

  const logLens = [4.5, 6.5, 8.5];
  const logBatches = logLens.map((L, i) => new Batch(makeLogGeometry(L, 7 + i * 3, hi ? 30 : 18, hi ? 5 : 3), woodMat, { castShadow: shadows, name: 'logs' }));

  const rocks = [];
  const logs = [];
  const color = new THREE.Color();

  return {
    addRock(x, z, s, rand) {
      const v = Math.floor(rand() * rockVariants.length) % rockVariants.length;
      const g = 0.85 + rand() * 0.3;
      const warm = rand();
      color.setRGB(g * (1 + warm * 0.08), g, g * (1 - warm * 0.1));
      const sx = s * (0.86 + rand() * 0.12);
      const sz = s * (0.86 + rand() * 0.12);
      const sy = s * (0.62 + rand() * 0.42);
      const sink = rand() * 0.18 * sy;
      rockVariants[v].add(compose(x, -sink, z, rand() * 6.28, sx, sy, sz, (rand() - 0.5) * 0.14, (rand() - 0.5) * 0.14), color);
      rocks.push({ x, z, s });
    },
    addLog(x, z, len, rot, rand) {
      let best = 0;
      for (let i = 1; i < logLens.length; i++) if (Math.abs(logLens[i] - len) < Math.abs(logLens[best] - len)) best = i;
      const sx = len / logLens[best];
      const g = 0.85 + rand() * 0.3;
      color.setRGB(g, g * (0.96 + rand() * 0.06), g * (0.9 + rand() * 0.1));
      // Lie partially sunk: radius ~0.29 -> top ~0.53 (collision maxY 0.55).
      const flip = rand() < 0.5 ? Math.PI : 0;
      logBatches[best].add(compose(x, 0.235, z, rot + flip, sx, 1, 1, 0, (rand() - 0.5) * 0.02), color);
      logs.push({ x, z, len, rot });
    },
    scatterClutter({ half, rand, isBlocked }) {
      this._clutter = buildClutter({ half, rand, isBlocked, quality: q, windUniform, rocks, logs, pebbleMat, woodMat, shadows });
    },
    build() {
      const group = new THREE.Group();
      group.name = 'groundcover';
      for (const b of [...rockVariants, ...logBatches]) {
        const mesh = b.build();
        if (mesh) group.add(mesh);
      }
      if (this._clutter) for (const m of this._clutter) group.add(m);
      return group;
    },
  };
}

function treeDensityAt(x, z) {
  // Same field forest.js uses to cluster trees.
  const d = fbm((x + 500) * 0.02, (z + 500) * 0.02, 1 << 20, 7, 3);
  return Math.min(1, d * d * 2.2);
}

function buildClutter({ half, rand: seedRand, isBlocked, quality, windUniform, rocks, logs, pebbleMat, woodMat, shadows }) {
  const rand = makeRng(((seedRand() * 4294967296) >>> 0) ^ 0x68e31da4);
  const qs = Math.min(1.25, Math.max(0.35, quality.grass));
  const inner = half - 2;
  const atlas = makeClutterAtlas();
  const cardMat = makeCardMaterial(atlas.texture, windUniform, { fadeFar: 70 + qs * 25, sway: 0.6 });
  const T = 0.25;

  const litter = new Batch(flatCard(T, T), cardMat, { tiled: true, noRaycast: true, name: 'litter' });
  const ferns = new Batch(fernGeometry(T, T * 2), cardMat, { tiled: true, noRaycast: true, name: 'ferns' });
  const flowers = new Batch(crossedCards(2, 0.36, 0.36, 1, T, T, 0.02), cardMat, { tiled: true, noRaycast: true, name: 'flowers' });
  const pebbles = new Batch(makePebbleGeometry(), pebbleMat, { noRaycast: true, name: 'pebbles' });
  const twigs = new Batch(makeTwigGeometry(), woodMat, { noRaycast: true, name: 'twigs' });
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  const cones = new Batch(makePineConeGeometry(), propMat, { noRaycast: true, name: 'cones' });
  const shrooms = new Batch(makeMushroomGeometry(), propMat, { noRaycast: true, name: 'mushrooms' });

  const c = new THREE.Color();
  const randPos = () => [(rand() - 0.5) * 2 * inner, (rand() - 0.5) * 2 * inner];
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  let layer = 0;
  const litterY = () => 0.012 + (layer++ % 7) * 0.0025;

  // Leaf / needle litter patches: heavier under the canopy.
  for (let i = 0, n = Math.round(3600 * qs); i < n * 6 && litter.count < n; i++) {
    const [x, z] = randPos();
    const td = treeDensityAt(x, z);
    if (rand() > 0.03 + td * td * 1.1) continue;
    if (isBlocked(x, z, 0.6, true)) continue;
    const pine = fbm(x * 0.05 + 40, z * 0.05, 1 << 20, 71, 2) > 0.5;
    const tile = pine ? pick(atlas.tiles.needles) : pick(atlas.tiles.leaves);
    const s = 0.55 + rand() * 0.75;
    const l = 0.85 + rand() * 0.25;
    litter.add(compose(x, litterY(), z, rand() * 6.28, s, 1, s * (0.8 + rand() * 0.4)), c.setRGB(l, l, l), tile);
  }
  // Moss + litter skirts around rocks and logs.
  for (const r of rocks) {
    for (let k = 0; k < 4; k++) {
      const a = rand() * 6.28;
      const d = r.s * (0.7 + rand() * 0.5);
      const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      const tile = rand() < 0.35 ? atlas.tiles.moss : pick(atlas.tiles.leaves);
      const s = 0.7 + rand() * 0.8;
      litter.add(compose(x, litterY(), z, rand() * 6.28, s), c.setRGB(1, 1, 1), tile);
    }
    // Small stones that have broken off.
    for (let k = 0; k < 8; k++) {
      const a = rand() * 6.28;
      const d = r.s * (0.85 + rand() * 0.6);
      const ps = 0.04 + Math.pow(rand(), 2) * 0.22 * r.s;
      const g = 0.8 + rand() * 0.35;
      pebbles.add(compose(r.x + Math.cos(a) * d, -ps * 0.25, r.z + Math.sin(a) * d, rand() * 6.28, ps, ps, ps, rand() * 0.4, rand() * 0.4), c.setRGB(g, g * 0.98, g * 0.94));
    }
    if (rand() < 0.6) {
      const a = rand() * 6.28;
      const d = r.s * (0.9 + rand() * 0.3);
      ferns.add(compose(r.x + Math.cos(a) * d, 0, r.z + Math.sin(a) * d, rand() * 6.28, 0.8 + rand() * 0.6), c.setRGB(1, 1, 1), pick(atlas.tiles.fern));
    }
  }
  for (const lg of logs) {
    const n = Math.round(lg.len * 1.2);
    for (let k = 0; k < n; k++) {
      const t = (rand() - 0.5) * lg.len;
      const side = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.4);
      const x = lg.x + Math.cos(lg.rot) * t + Math.sin(lg.rot) * side;
      const z = lg.z - Math.sin(lg.rot) * t + Math.cos(lg.rot) * side;
      const r = rand();
      if (r < 0.4) litter.add(compose(x, litterY(), z, rand() * 6.28, 0.6 + rand() * 0.7), c.setRGB(1, 1, 1), rand() < 0.5 ? atlas.tiles.moss : pick(atlas.tiles.leaves));
      else if (r < 0.62) ferns.add(compose(x, 0, z, rand() * 6.28, 0.7 + rand() * 0.6), c.setRGB(1, 1, 1), pick(atlas.tiles.fern));
      else if (r < 0.82) {
        const tint = rand();
        c.setRGB(1 + tint * 0.4, 1 - tint * 0.2, 1 - tint * 0.4);
        shrooms.add(compose(x, 0, z, rand() * 6.28, 0.8 + rand() * 0.9), c);
      } else {
        const ps = 0.05 + rand() * 0.1;
        pebbles.add(compose(x, -ps * 0.2, z, rand() * 6.28, ps), c.setRGB(1, 1, 1));
      }
    }
  }
  // Ferns: under the canopy in drifts.
  for (let i = 0, n = Math.round(1700 * qs); i < n * 6 && ferns.count < n; i++) {
    const [x, z] = randPos();
    const td = treeDensityAt(x, z);
    const drift = fbm(x * 0.07, z * 0.07 + 90, 1 << 20, 83, 2);
    if (rand() > td * smooth(0.4, 0.62, drift) * 1.6) continue;
    if (isBlocked(x, z, 0.8, true)) continue;
    const s = 0.65 + rand() * 0.75;
    const l = 0.8 + rand() * 0.35;
    ferns.add(compose(x, 0, z, rand() * 6.28, s, s * (0.8 + rand() * 0.4), s), c.setRGB(l * 0.95, l, l * 0.85), pick(atlas.tiles.fern));
  }
  // Flowers: clustered in sunny meadows.
  for (let i = 0, n = Math.round(2600 * qs); i < n * 6 && flowers.count < n; i++) {
    const [x, z] = randPos();
    const open = 1 - treeDensityAt(x, z);
    const patch = fbm(x * 0.09 + 13, z * 0.09, 1 << 20, 97, 2);
    if (rand() > open * open * smooth(0.48, 0.66, patch) * 1.5) continue;
    if (isBlocked(x, z, 0.3, true)) continue;
    const kind = Math.floor(valueNoise(x * 0.05, z * 0.05, 1 << 20, 5) * 4.99) % 4;
    const tile = rand() < 0.75 ? atlas.tiles.flowers[kind] : pick(atlas.tiles.flowers);
    const s = 0.75 + rand() * 0.6;
    flowers.add(compose(x, 0, z, rand() * 6.28, s), c.setRGB(1, 1, 1), tile);
  }
  // Clover patches in meadows.
  for (let i = 0, placed = 0, n = Math.round(600 * qs); i < n * 4 && placed < n; i++) {
    const [x, z] = randPos();
    if (rand() > (1 - treeDensityAt(x, z)) * 0.7) continue;
    if (isBlocked(x, z, 0.5, true)) continue;
    const s = 0.5 + rand() * 0.6;
    litter.add(compose(x, litterY(), z, rand() * 6.28, s), c.setRGB(1, 1, 1), atlas.tiles.clover);
    placed++;
  }
  // Pebbles everywhere (also on trails, but not inside buildings).
  for (let i = 0, n = Math.round(1700 * qs); i < n; i++) {
    const [x, z] = randPos();
    if (isBlocked(x, z, 0.2, true) && rand() < 0.75) continue;
    const ps = 0.025 + Math.pow(rand(), 3) * 0.16;
    const g = 0.75 + rand() * 0.45;
    pebbles.add(compose(x, -ps * 0.25, z, rand() * 6.28, ps, ps * (0.8 + rand() * 0.4), ps, rand() * 0.5, rand() * 0.5), c.setRGB(g, g * 0.97, g * 0.92));
  }
  // Fallen branches and twigs.
  for (let i = 0, n = Math.round(1100 * qs); i < n * 3 && twigs.count < n; i++) {
    const [x, z] = randPos();
    if (rand() > 0.2 + treeDensityAt(x, z)) continue;
    if (isBlocked(x, z, 0.5, true)) continue;
    const s = 0.35 + Math.pow(rand(), 1.6) * 1.5;
    const g = 0.8 + rand() * 0.4;
    twigs.add(compose(x, 0, z, rand() * 6.28, s, s, s, 0, 0), c.setRGB(g, g * 0.95, g * 0.9));
  }
  // Pine cones in clusters under conifer-ish stands.
  for (let i = 0, n = Math.round(550 * qs); i < n * 4 && cones.count < n; i++) {
    const [x, z] = randPos();
    if (rand() > treeDensityAt(x, z) * 1.2) continue;
    if (isBlocked(x, z, 0.3, true)) continue;
    const k = 1 + Math.floor(rand() * 4);
    for (let j = 0; j < k; j++) {
      const s = 0.8 + rand() * 0.5;
      const g = 0.8 + rand() * 0.45;
      cones.add(compose(x + (rand() - 0.5) * 0.8, 0, z + (rand() - 0.5) * 0.8, rand() * 6.28, s, s, s, (rand() - 0.5) * 0.3, 0), c.setRGB(g, g, g));
    }
  }
  // Mushrooms in damp shady spots.
  for (let i = 0, n = Math.round(260 * qs); i < n * 4 && shrooms.count < n; i++) {
    const [x, z] = randPos();
    if (rand() > treeDensityAt(x, z) * 0.9) continue;
    if (isBlocked(x, z, 0.3, true)) continue;
    const tint = rand() < 0.12 ? 1 : rand() * 0.3;
    c.setRGB(1 + tint * 0.9, 1 - tint * 0.45, 1 - tint * 0.6);
    shrooms.add(compose(x, 0, z, rand() * 6.28, 0.8 + rand() * 1.0), c);
  }

  const out = [];
  for (const b of [litter, ferns, flowers, pebbles, twigs, cones, shrooms]) {
    const m = b.build();
    if (!m) continue;
    m.castShadow = false;
    m.receiveShadow = shadows;
    m.userData.noRaycast = true;
    out.push(m);
  }
  return out;
}

// --- Grass ------------------------------------------------------------------

export function makeGrassMeadows({ half, rand: seedRand, isBlocked, quality, windUniform }) {
  const q = quality || { grass: 1, shadows: true };
  // The caller's RNG may have a short period (world.js uses a 233280-period
  // LCG), which stacks many tufts on identical spots; use a full-period one.
  const rand = makeRng(((seedRand() * 4294967296) >>> 0) ^ 0x2545f491);
  const target = Math.round(70000 * q.grass);
  const tex = makeGrassAtlas();
  const material = makeCardMaterial(tex, windUniform, { fadeFar: 55 + 35 * Math.min(1.4, q.grass), sway: 1, alphaTest: 0.42 });
  material.roughness = 0.85;
  const geometry = crossedCards(3, 0.85, 0.56, 1, 0.5, 0.5, 0.0);
  const tiles = [[0, 0.5], [0.5, 0.5], [0, 0], [0.5, 0]];
  const batch = new Batch(geometry, material, { tiled: true, noRaycast: true, name: 'grass' });
  const color = new THREE.Color();
  const inner = half - 1.5;
  for (let tries = 0; tries < target * 8 && batch.count < target; tries++) {
    const x = (rand() - 0.5) * 2 * inner;
    const z = (rand() - 0.5) * 2 * inner;
    const open = 1 - treeDensityAt(x, z);
    const meadow = fbm((x + 300) * 0.035, (z + 300) * 0.035, 1 << 20, 19, 3);
    const clump = valueNoise(x * 0.55, z * 0.55, 1 << 20, 31);
    let p = 0.05 + Math.min(1, 1.35 * Math.pow(open, 1.4)) * (0.45 + 0.55 * smooth(0.3, 0.6, meadow));
    p *= 0.7 + clump * 0.5;
    if (rand() > p) continue;
    if (isBlocked(x, z, 0.3, true)) continue;
    const dry = clamp01((fbm(x * 0.023 + 7, z * 0.023, 1 << 20, 61, 3) - 0.45) * 2.6);
    const lush = smooth(0.35, 0.65, meadow) * open;
    const r = rand();
    let tile;
    if (r < 0.08 + dry * 0.4) tile = tiles[2];
    else if (r < 0.45) tile = tiles[1];
    else if (r < 0.82) tile = tiles[0];
    else tile = tiles[3];
    const s = 0.7 + rand() * 0.45 + lush * 0.3;
    const sy = s * (0.75 + rand() * 0.45) * (0.75 + lush * 0.4);
    compose(x, -0.05, z, rand() * 6.28, s, sy, s, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12);
    const b = 0.82 + rand() * 0.3 + (valueNoise(x * 0.15, z * 0.15, 1 << 20, 3) - 0.5) * 0.25;
    color.setRGB(b * (1 + dry * 0.15), b * (1 + dry * 0.03), b * (1 - dry * 0.2));
    batch.add(_m, color, tile);
  }
  const mesh = batch.build();
  if (!mesh) return new THREE.Group();
  mesh.castShadow = false;
  mesh.receiveShadow = !!q.shadows;
  mesh.userData.noRaycast = true;
  mesh.name = 'grass-meadows';

  return mesh;
}
