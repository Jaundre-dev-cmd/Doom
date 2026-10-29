// Forest Outpost: timber ranger cabins, observation watchtowers and campsites.
//
// Everything is built from a handful of shared materials (created once per
// module) with small procedural canvas textures + normal maps. Each building
// bakes its pieces into one merged mesh per material (plus one merged glass
// mesh), so a cabin costs ~15 draw calls before the global static batcher.
// Gameplay data (collidables / walkable surfaces) is pushed in world space.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from './vegetationUtils.js';

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

// Tileable value noise with separate x / y periods (for stretched grain).
function vn(x, y, px, py, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// fn(x, y, rgbOut) -> height (0..1). Returns { map, normal }.
function makeTex(w, h, fn, { strength = 2, repeatU = 1, repeatV = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const hts = new Float32Array(w * h);
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      hts[i] = fn(x, y, rgb);
      img.data[i * 4] = Math.max(0, Math.min(255, rgb[0]));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, rgb[1]));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, rgb[2]));
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const nc = document.createElement('canvas');
  nc.width = w;
  nc.height = h;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = hts[y * w + ((x + 1) % w)] - hts[y * w + ((x - 1 + w) % w)];
      const dy = hts[((y + 1) % h) * w + x] - hts[((y - 1 + h) % h) * w + x];
      let nx = -dx * strength;
      let ny = dy * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = (nx * inv * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 2] = (inv * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const wrap = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatU, repeatV);
    t.anisotropy = 8;
    return t;
  };
  return { map: wrap(c, true), normal: wrap(nc, false) };
}

let _T = null;
function textures() {
  if (_T) return _T;
  // Horizontal shiplap cladding: 12 boards over a 2.4 m tile (0.2 m boards).
  const clad = makeTex(512, 480, (x, y, o) => {
    const board = Math.floor(y / 40);
    const fy = (y % 40) / 40;
    const xx = (x + board * 131) % 512;
    const tone = 0.86 + 0.14 * hash2(board, 3, 77);
    const streak = vn((xx * 3) / 512, (y * 240) / 480, 3, 240, 11 + board);
    const fine = vn((xx * 12) / 512, (y * 120) / 480, 12, 120, 29);
    const fig = vn((xx * 2) / 512, (y * 24) / 480, 2, 24, 5 + board);
    const ring = Math.abs(Math.sin(fig * 9 + fy * 0.8));
    const ringDark = ring > 0.975 ? 0.94 : 1;
    let shade = 1;
    if (fy < 0.05) shade = 0.32;
    else if (fy < 0.16) shade = 0.32 + ((fy - 0.05) / 0.11) * 0.68;
    if (fy > 0.95) shade *= 1.06;
    const g = (0.84 + 0.1 * streak + 0.06 * fine) * ringDark * tone * shade;
    o[0] = 236 * g;
    o[1] = 206 * g;
    o[2] = 170 * g;
    const lap = fy < 0.05 ? 0 : 0.35 + 0.65 * fy;
    return lap + (streak - 0.5) * 0.05;
  }, { strength: 2.4, repeatU: 1 / 2.4, repeatV: 1 / 2.4 });

  // Structural timber (glulam): soft, low-contrast grain.
  const timber = makeTex(256, 256, (x, y, o) => {
    const a = vn((x * 6) / 256, (y * 48) / 256, 6, 48, 41);
    const b = vn((x * 24) / 256, (y * 24) / 256, 24, 24, 43);
    const g = 0.86 + 0.09 * a + 0.05 * b;
    o[0] = 228 * g;
    o[1] = 196 * g;
    o[2] = 156 * g;
    return a * 0.3 + b * 0.2;
  }, { strength: 1.2, repeatU: 1 / 1.5, repeatV: 1 / 1.5 });

  // Smooth-poured concrete with fine aggregate.
  const concrete = makeTex(256, 256, (x, y, o) => {
    const n = vn((x * 8) / 256, (y * 8) / 256, 8, 8, 61) * 0.6 + vn((x * 32) / 256, (y * 32) / 256, 32, 32, 62) * 0.4;
    const s = hash2(x, y, 63);
    let v = 165 + (n - 0.5) * 26;
    let h = 0.5 + (n - 0.5) * 0.2;
    if (s > 0.985) { v -= 35; h -= 0.3; } else if (s > 0.96) v += 14;
    o[0] = v;
    o[1] = v - 1;
    o[2] = v - 4;
    return h;
  }, { strength: 1.6, repeatU: 1 / 2, repeatV: 1 / 2 });

  // Coursed ashlar stone (chimneys, footings).
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const cuts = [0];
    let p = 0;
    while (p < 256) {
      p += 52 + Math.floor(hash2(r, cuts.length, 91) * 70);
      cuts.push(Math.min(p, 256));
    }
    if (256 - cuts[cuts.length - 2] < 40 && cuts.length > 2) cuts.splice(cuts.length - 2, 1);
    rows.push(cuts);
  }
  const stone = makeTex(256, 256, (x, y, o) => {
    const r = Math.floor(y / 64);
    const fy = y % 64;
    const xs = (x + r * 37) % 256;
    const cuts = rows[r];
    let k = 0;
    while (k < cuts.length - 1 && xs >= cuts[k + 1]) k++;
    const ex = Math.min(xs - cuts[k], cuts[k + 1] - xs);
    const ey = Math.min(fy, 63 - fy);
    const edge = Math.min(ex, ey);
    const n = vn((x * 16) / 256, (y * 16) / 256, 16, 16, 93);
    const tone = 0.82 + 0.22 * hash2(r, k, 95);
    if (edge < 3) {
      o[0] = 120; o[1] = 116; o[2] = 110;
      return 0.05;
    }
    const bevel = Math.min(1, (edge - 3) / 6);
    const v = (0.8 + 0.2 * n) * tone;
    const warm = hash2(k, r, 97) * 12;
    o[0] = 172 * v + warm;
    o[1] = 166 * v + warm * 0.6;
    o[2] = 156 * v;
    return 0.25 + 0.55 * bevel + n * 0.2;
  }, { strength: 3, repeatU: 1 / 1.2, repeatV: 1 / 1.2 });

  // Canvas weave.
  const canvas = makeTex(128, 128, (x, y, o) => {
    const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.94 : 1.0;
    const m = vn((x * 4) / 128, (y * 4) / 128, 4, 4, 121);
    const g = weave * (0.9 + 0.1 * m);
    o[0] = 225 * g;
    o[1] = 220 * g;
    o[2] = 200 * g;
    return weave === 1 ? 0.6 : 0.4;
  }, { strength: 1.5, repeatU: 1 / 0.5, repeatV: 1 / 0.5 });

  // Bark (cylinder UVs: u around, v along the log).
  const bark = makeTex(256, 256, (x, y, o) => {
    const f = vn((x * 20) / 256, (y * 3) / 256, 20, 3, 141);
    const f2 = vn((x * 48) / 256, (y * 12) / 256, 48, 12, 143);
    const v = f * 0.7 + f2 * 0.3;
    const crack = v < 0.36 ? 0.45 : 1;
    const g = (0.7 + 0.4 * v) * crack;
    o[0] = 98 * g;
    o[1] = 80 * g;
    o[2] = 64 * g;
    return v * crack;
  }, { strength: 3, repeatU: 2, repeatV: 1 });

  // Sawn end grain (circle UVs centred at 0.5).
  const endgrain = makeTex(128, 128, (x, y, o) => {
    const d = Math.hypot(x - 64, y - 64) / 64;
    const n = vn((x * 6) / 128, (y * 6) / 128, 6, 6, 151);
    const ring = 0.88 + 0.12 * Math.sin((d * 14 + n * 1.5) * Math.PI);
    const rim = d > 0.9 ? 0.45 : 1;
    o[0] = 214 * ring * rim;
    o[1] = 178 * ring * rim;
    o[2] = 130 * ring * rim;
    return ring * 0.5;
  }, { strength: 1, repeatU: 1, repeatV: 1 });

  _T = { clad, timber, concrete, stone, canvas, bark, endgrain };
  return _T;
}

// ---------------------------------------------------------------------------
// Materials (shared across every building of this module)
// ---------------------------------------------------------------------------

function std(opts) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.userData.noWeathering = true;
  return m;
}

let _M = null;
function mats() {
  if (_M) return _M;
  const T = textures();
  const glow = std({ color: 0xfff3dc, emissive: 0xffd49a, emissiveIntensity: 2.4, roughness: 0.4 });
  glow.userData.noShadow = true;
  const ember = std({ color: 0x3a0d04, emissive: 0xff5a14, emissiveIntensity: 3.2, roughness: 0.9 });
  ember.userData.noShadow = true;
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fb6c0, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.3,
    side: THREE.DoubleSide, depthWrite: false,
  });
  glass.userData.noWeathering = true;
  glass.userData.noShadow = true;
  _M = {
    concrete: std({ map: T.concrete.map, normalMap: T.concrete.normal, color: 0xdedbd4, roughness: 0.9 }),
    stone: std({ map: T.stone.map, normalMap: T.stone.normal, color: 0xffffff, roughness: 0.86 }),
    rock: std({ map: T.concrete.map, normalMap: T.concrete.normal, color: 0x8f8a80, roughness: 0.95 }),
    trim: std({ color: 0x2c2e30, roughness: 0.55, metalness: 0.05 }),
    frame: std({ color: 0x1c1e20, roughness: 0.38, metalness: 0.55 }),
    steel: std({ color: 0x3a3d40, roughness: 0.42, metalness: 0.7 }),
    galv: std({ color: 0x80868a, roughness: 0.35, metalness: 0.75 }),
    timber: std({ map: T.timber.map, normalMap: T.timber.normal, color: 0xae8f6e, roughness: 0.72 }),
    deck: std({ map: T.clad.map, normalMap: T.clad.normal, color: 0x98836b, roughness: 0.8 }),
    ceiling: std({ map: T.clad.map, normalMap: T.clad.normal, color: 0xd9c4a0, roughness: 0.75 }),
    door: std({ color: 0x3b4a3a, roughness: 0.5 }),
    glass,
    glow,
    ember,
    ash: std({ color: 0x2b2826, roughness: 1 }),
    soil: std({ color: 0x4a3d30, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    canvas: std({ map: T.canvas.map, normalMap: T.canvas.normal, color: 0x7e7d58, roughness: 0.95, side: THREE.DoubleSide }),
    canvasDark: std({ map: T.canvas.map, normalMap: T.canvas.normal, color: 0x55563c, roughness: 0.95, side: THREE.DoubleSide }),
    canvasTan: std({ map: T.canvas.map, normalMap: T.canvas.normal, color: 0xb7a67e, roughness: 0.95, side: THREE.DoubleSide }),
    rope: std({ color: 0xcfc3a0, roughness: 0.9 }),
    bark: std({ map: T.bark.map, normalMap: T.bark.normal, color: 0xffffff, roughness: 0.95 }),
    endgrain: std({ map: T.endgrain.map, normalMap: T.endgrain.normal, color: 0xffffff, roughness: 0.85 }),
    fabric: std({ color: 0x46503a, roughness: 0.95 }),
    linen: std({ color: 0xcfc8b4, roughness: 0.9 }),
    crate: std({ map: T.timber.map, normalMap: T.timber.normal, color: 0x6c7650, roughness: 0.7 }),
    coolerBody: std({ color: 0x2e5b78, roughness: 0.45 }),
    coolerLid: std({ color: 0xe6e5df, roughness: 0.5 }),
    paper: std({ color: 0xdcd2b2, roughness: 0.9 }),
    brass: std({ color: 0xb48f58, roughness: 0.35, metalness: 0.85 }),
    red: std({ color: 0x8e2b22, roughness: 0.5 }),
  };
  return _M;
}

const _cladCache = new Map();
function cladMat(hex) {
  if (!_cladCache.has(hex)) {
    const T = textures();
    // Lift the spec colour towards a clean natural cedar so the boards read as wood.
    const c = new THREE.Color(hex).lerp(new THREE.Color(0xffe2c0), 0.38);
    _cladCache.set(hex, std({ map: T.clad.map, normalMap: T.clad.normal, color: c, roughness: 0.78 }));
  }
  return _cladCache.get(hex);
}
const _roofCache = new Map();
function roofMat(hex) {
  if (!_roofCache.has(hex)) {
    const c = new THREE.Color(hex).lerp(new THREE.Color(0x34363a), 0.55);
    _roofCache.set(hex, std({ color: c, roughness: 0.42, metalness: 0.6 }));
  }
  return _roofCache.get(hex);
}

// ---------------------------------------------------------------------------
// Geometry kit: bakes every piece into building-local space, merges per material
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

// Planar (box-projected) UVs in metres from the baked positions, so textures
// line up across separately built pieces.
function planarUV(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) {
      uv[i * 2] = p.getX(i);
      uv[i * 2 + 1] = p.getZ(i);
    } else if (ax >= az) {
      uv[i * 2] = p.getZ(i);
      uv[i * 2 + 1] = p.getY(i);
    } else {
      uv[i * 2] = p.getX(i);
      uv[i * 2 + 1] = p.getY(i);
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

class Kit {
  constructor() {
    this.buckets = new Map();
    this.m = new THREE.Matrix4();
    this.stack = [];
  }
  push(x, y, z, ry = 0, rx = 0, rz = 0) {
    this.stack.push(this.m);
    const t = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s);
    this.m = this.m.clone().multiply(t);
  }
  pop() {
    this.m = this.stack.pop();
  }
  add(geo, mat, { local = null, uv = 'planar' } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (local) g.applyMatrix4(local);
    g.applyMatrix4(this.m);
    if (uv === 'planar') planarUV(g);
    g.clearGroups();
    let b = this.buckets.get(mat);
    if (!b) this.buckets.set(mat, (b = []));
    b.push(g);
    return g;
  }
  // Box by centre, with optional rotation (radians, 'YXZ').
  box(w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
    const local = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s);
    return this.add(new THREE.BoxGeometry(w, h, d), mat, { local });
  }
  // Box spanning two corners (axis-aligned in the current frame).
  span(x0, y0, z0, x1, y1, z1, mat) {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, mat);
  }
  // Square-ish member between two points. sx/sz = cross-section.
  beam(ax, ay, az, bx, by, bz, sx, sz, mat, uv = 'planar') {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    const local = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, _s);
    return this.add(new THREE.BoxGeometry(sx, len, sz), mat, { local, uv });
  }
  rod(ax, ay, az, bx, by, bz, r, mat, seg = 6) {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    const local = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, _s);
    return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1, true), mat, { local, uv: 'own' });
  }
  cyl(rt, rb, h, seg, x, y, z, mat, rx = 0, ry = 0, rz = 0, uv = 'own') {
    const local = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s);
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, { local, uv });
  }
  // A sawn log lying along local X (bark sides + end-grain caps).
  log(len, r, x, y, z, ry = 0, M) {
    this.push(x, y, z, ry);
    this.add(new THREE.CylinderGeometry(r, r * 1.02, len, 10, 1, true), M.bark, {
      local: new THREE.Matrix4().makeRotationZ(Math.PI / 2), uv: 'own',
    });
    for (const s of [-1, 1]) {
      const local = new THREE.Matrix4().compose(_v.set((s * len) / 2, 0, 0), _q.setFromEuler(_e.set(0, (s * Math.PI) / 2, 0)), _s);
      this.add(new THREE.CircleGeometry(r * 0.99, 10), M.endgrain, { local, uv: 'own' });
    }
    this.pop();
  }
  // Triangle / polygon prism from a 2D outline (in the XY plane), extruded along +Z.
  prism(points, depth, x, y, z, mat, ry = 0) {
    const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const local = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s);
    return this.add(geo, mat, { local });
  }
  finish(group) {
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      const shadow = !mat.userData.noShadow && !mat.transparent;
      mesh.castShadow = shadow;
      mesh.receiveShadow = !mat.transparent;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

// Local -> world transform for gameplay data (group rotated by `angle`).
function makeToWorld(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
}

// Row of collision circles between two local points.
function circleRow(collidables, toW, ax, az, bx, bz, radius, spacing, extra = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [wx, wz] = toW(ax + (bx - ax) * t, az + (bz - az) * t);
    collidables.push({ x: wx, z: wz, radius, ...extra });
  }
}

// ---------------------------------------------------------------------------
// Shared architectural pieces
// ---------------------------------------------------------------------------

// Gable roof with standing-seam metal, timber soffit/ceiling, fascia, gutters,
// barge boards and ridge cap. Ridge runs along local Z; `hw` is the half-span
// to the wall line where the underside sits at `eave`.
function gableRoof(kit, M, roof, { hw, eave, pitch, ovh, z0, z1, thick = 0.12, gutters = true, ceiling = true }) {
  const tanA = Math.tan(pitch);
  const cosA = Math.cos(pitch);
  const sinA = Math.sin(pitch);
  const s = hw + ovh;
  const slopeLen = s / cosA + 0.04;
  const L = z1 - z0;
  const zc = (z0 + z1) / 2;
  const yU = (ax) => eave + (hw - ax) * tanA;
  const ribs = Math.max(2, Math.round((L - 0.3) / 0.48));
  for (const side of [-1, 1]) {
    const xm = s / 2;
    const cx = side * (xm + (sinA * thick) / 2);
    const cy = yU(xm) + (cosA * thick) / 2;
    kit.push(cx, cy, 0, 0, 0, -side * pitch);
    kit.box(slopeLen, thick, L, 0, 0, zc, roof);
    for (let i = 0; i <= ribs; i++) {
      const rz = z0 + 0.15 + ((L - 0.3) * i) / ribs;
      kit.box(slopeLen, 0.045, 0.028, 0, thick / 2 + 0.022, rz, roof);
    }
    // Ridge flashing.
    kit.box(0.24, 0.03, L + 0.02, side * (-slopeLen / 2 + 0.1), thick / 2 + 0.06, zc, roof);
    // Timber soffit / ceiling lining.
    if (ceiling) kit.box(slopeLen - 0.02, 0.02, L - 0.02, 0, -thick / 2 - 0.011, zc, M.ceiling);
    kit.pop();
  }
  const yTopEdge = yU(s) + thick / cosA;
  const yRidgeTop = yU(0) + thick / cosA;
  // Fascia + gutter + barge boards.
  for (const side of [-1, 1]) {
    kit.box(0.04, 0.22, L + 0.04, side * (s + 0.02), yTopEdge - 0.1, zc, M.trim);
    if (gutters) {
      kit.box(0.13, 0.02, L + 0.04, side * (s + 0.105), yTopEdge - 0.2, zc, M.galv);
      kit.box(0.02, 0.11, L + 0.04, side * (s + 0.17), yTopEdge - 0.145, zc, M.galv);
      for (const ez of [z0 - 0.01, z1 + 0.01]) kit.box(0.15, 0.12, 0.01, side * (s + 0.1), yTopEdge - 0.15, ez, M.galv);
    }
    for (const ez of [z0 - 0.02, z1 + 0.02]) {
      kit.beam(side * (s + 0.04), yTopEdge - 0.1, ez, 0, yRidgeTop - 0.1 + 0.02, ez, 0.24, 0.04, M.trim);
    }
  }
  return { yU, yTopEdge, yRidgeTop, s };
}

// Window or door opening detail in a wall frame: outer face at z = 0, wall
// interior towards -z (thickness t). u = position along the wall.
function openingTrim(kit, M, { c, w, lo, hi, t, door = false, glass = null }) {
  const l = c - w / 2;
  const r = c + w / 2;
  // Jamb liners (reveal).
  kit.span(l, lo, -t, l + 0.025, hi, 0, M.trim);
  kit.span(r - 0.025, lo, -t, r, hi, 0, M.trim);
  kit.span(l, hi - 0.025, -t, r, hi, 0, M.trim);
  // Exterior casing + head drip cap.
  const cw = 0.09;
  kit.span(l - cw, door ? lo : lo, 0, l, hi + cw, 0.025, M.trim);
  kit.span(r, door ? lo : lo, 0, r + cw, hi + cw, 0.025, M.trim);
  kit.span(l - cw - 0.02, hi, 0, r + cw + 0.02, hi + cw, 0.03, M.trim);
  kit.span(l - cw - 0.04, hi + cw, 0, r + cw + 0.04, hi + cw + 0.025, 0.06, M.frame);
  if (door) {
    kit.span(l, lo - 0.02, -t, r, lo + 0.02, 0.04, M.steel); // threshold
    return;
  }
  // Interior stool + exterior sloped sill.
  kit.span(l - 0.04, lo - 0.03, -t - 0.04, r + 0.04, lo, -t + 0.04, M.trim);
  kit.box(w + 0.26, 0.045, 0.2, c, lo - 0.02, 0.04, M.trim, -0.08);
  // Aluminium frame (set into the reveal) + glass.
  const fz = -0.06;
  const f = 0.055;
  kit.span(l + 0.025, lo, fz - 0.05, l + 0.025 + f, hi - 0.025, fz + 0.03, M.frame);
  kit.span(r - 0.025 - f, lo, fz - 0.05, r - 0.025, hi - 0.025, fz + 0.03, M.frame);
  kit.span(l + 0.025, hi - 0.025 - f, fz - 0.05, r - 0.025, hi - 0.025, fz + 0.03, M.frame);
  kit.span(l + 0.025, lo, fz - 0.05, r - 0.025, lo + f, fz + 0.03, M.frame);
  if (w > 0.85) kit.span(c - 0.025, lo, fz - 0.04, c + 0.025, hi - 0.025, fz + 0.02, M.frame);
  if (hi - lo > 0.9) kit.span(l + 0.025, lo + (hi - lo) * 0.62 - 0.02, fz - 0.04, r - 0.025, lo + (hi - lo) * 0.62 + 0.02, fz + 0.02, M.frame);
  if (glass) {
    const g = new THREE.PlaneGeometry(w - 0.1, hi - lo - 0.08);
    g.translate(c, (lo + hi) / 2, fz - 0.01);
    g.applyMatrix4(kit.m);
    glass.push(g);
  }
}

// Wall with rectangular openings in a frame (outer face z = 0, interior -z).
function wallWithOpenings(kit, mat, { u0, u1, y0, y1, t, openings }) {
  const ops = [...openings].sort((a, b) => a.c - b.c);
  let cur = u0;
  for (const o of ops) {
    const a = o.c - o.w / 2;
    const b = o.c + o.w / 2;
    if (a > cur + 0.001) kit.span(cur, y0, -t, a, y1, 0, mat);
    if (o.hi < y1) kit.span(a, o.hi, -t, b, y1, 0, mat);
    if (o.lo > y0) kit.span(a, y0, -t, b, o.lo, 0, mat);
    cur = b;
  }
  if (u1 > cur + 0.001) kit.span(cur, y0, -t, u1, y1, 0, mat);
}

function finishGlass(group, glassGeos, M) {
  if (!glassGeos.length) return;
  const g = mergeGeometries(glassGeos, false);
  for (const x of glassGeos) x.dispose();
  const mesh = new THREE.Mesh(g, M.glass);
  mesh.renderOrder = 2;
  group.add(mesh);
}

// ---------------------------------------------------------------------------
// 1. Timber ranger cabin
// ---------------------------------------------------------------------------

export function makeForestCabin(x, z, collidables, spec = {}) {
  const M = mats();
  const side = spec.doorSide || 'south';
  const angle = { south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 }[side] ?? 0;
  const turned = side === 'west' || side === 'east';
  // Local frame: door on +Z. Keep the world footprint at width (X) x depth (Z).
  const W = turned ? spec.depth || 5 : spec.width || 6;
  const D = turned ? spec.width || 6 : spec.depth || 5;
  const hw = W / 2;
  const hd = D / 2;
  const T = 0.16; // wall thickness
  const FLOOR = 0.22;
  const EAVE = 2.75;
  const PITCH = THREE.MathUtils.degToRad(28);
  const PORCH = 1.7;
  const clad = cladMat(spec.wallColor ?? 0x8a7458);
  const roof = roofMat(spec.roofColor ?? 0x5a3a2a);

  const group = new THREE.Group();
  group.name = 'forest-cabin';
  const kit = new Kit();
  const glass = [];
  const toW = makeToWorld(x, z, angle);

  // --- Foundation plinth (ring, open at the door) + floor.
  const pe = 0.06;
  kit.span(-hw - pe, 0, -hd - pe, hw + pe, 0.3, -hd + T, M.concrete);
  kit.span(-hw - pe, 0, -hd + T, -hw + T, 0.3, hd - T, M.concrete);
  kit.span(hw - T, 0, -hd + T, hw + pe, 0.3, hd - T, M.concrete);
  kit.span(-hw - pe, 0, hd - T, -0.55, 0.3, hd + pe, M.concrete);
  kit.span(0.55, 0, hd - T, hw + pe, 0.3, hd + pe, M.concrete);
  kit.span(-hw + T, 0.02, -hd + T, hw - T, FLOOR, hd - T, M.deck);
  // Interior skirting (hides the plinth line).
  kit.span(-hw + T, FLOOR, -hd + T, hw - T, FLOOR + 0.12, -hd + T + 0.02, M.trim);
  kit.span(-hw + T, FLOOR, -hd + T, -hw + T + 0.02, FLOOR + 0.12, hd - T, M.trim);
  kit.span(hw - T - 0.02, FLOOR, -hd + T, hw - T, FLOOR + 0.12, hd - T, M.trim);
  for (const sx of [-1, 1]) kit.span(sx * 0.56, FLOOR, hd - T - 0.02, sx * (hw - T), FLOOR + 0.12, hd - T, M.trim);

  // --- Walls (each built in its own frame: outer face z=0, u along the wall).
  const winLo = 1.0;
  const winHi = 2.15;
  const frontWinC = hw * 0.62;
  const frontOpen = [
    { c: 0, w: 1.1, lo: FLOOR, hi: 2.32, door: true },
    { c: frontWinC, w: 1.0, lo: winLo, hi: winHi },
  ];
  const sideWinZ = -0.2;
  const backWinC = 0.15;
  const chimX = hw * 0.5;
  const walls = [
    // [frame x, z, rotY, u0, u1, openings]
    [0, hd, 0, -hw, hw, frontOpen],
    [0, -hd, Math.PI, -hw, hw, [{ c: -backWinC, w: 0.75, lo: 1.3, hi: winHi }]],
    [hw, 0, Math.PI / 2, -hd + T, hd - T, [{ c: -sideWinZ, w: 1.2, lo: winLo, hi: winHi }]],
    [-hw, 0, -Math.PI / 2, -hd + T, hd - T, [{ c: sideWinZ, w: 1.2, lo: winLo, hi: winHi }]],
  ];
  for (const [fx, fz, ry, u0, u1, ops] of walls) {
    kit.push(fx, 0, fz, ry);
    wallWithOpenings(kit, clad, { u0, u1, y0: 0.2, y1: EAVE, t: T, openings: ops });
    for (const o of ops) openingTrim(kit, M, { ...o, t: T, glass });
    kit.pop();
  }
  // Gable infill (front + back), clad.
  const rise = hw * Math.tan(PITCH);
  const tri = [[-hw, 0], [hw, 0], [0, rise]];
  kit.prism(tri, T, 0, EAVE, hd - T, clad);
  kit.prism(tri, T, 0, EAVE, -hd, clad);
  // Gable louvre vent (front + back).
  for (const [fz, ry] of [[hd, 0], [-hd, Math.PI]]) {
    kit.push(0, EAVE + rise * 0.42, fz, ry);
    kit.span(-0.34, -0.22, 0, 0.34, 0.22, 0.03, M.trim);
    for (let i = 0; i < 4; i++) kit.box(0.6, 0.02, 0.08, 0, -0.15 + i * 0.1, 0.05, M.frame, -0.6);
    kit.pop();
  }
  // Corner boards.
  const cbH = EAVE - 0.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.box(0.14, cbH, 0.03, sx * (hw - 0.07), 0.2 + cbH / 2, sz * (hd + 0.015), M.trim);
      kit.box(0.03, cbH, 0.14, sx * (hw + 0.015), 0.2 + cbH / 2, sz * (hd - 0.07), M.trim);
    }
  }
  // Eave frieze board under the soffit on the long walls.
  for (const sx of [-1, 1]) kit.box(0.03, 0.16, D, sx * (hw + 0.015), EAVE - 0.06, 0, M.trim);

  // --- Roof (ridge along Z, gable over the porch).
  const zFront = hd + PORCH + 0.2;
  const zBack = -hd - 0.45;
  const R = gableRoof(kit, M, roof, { hw, eave: EAVE, pitch: PITCH, ovh: 0.42, z0: zBack, z1: zFront });

  // Downpipes at the back corners.
  for (const sx of [-1, 1]) {
    const gx = sx * (R.s + 0.1);
    const gz = -hd - 0.25;
    const top = R.yTopEdge - 0.2;
    kit.rod(gx, top, gz, gx, top - 0.25, gz, 0.04, M.galv);
    kit.rod(gx, top - 0.25, gz, sx * (hw + 0.07), top - 0.55, gz, 0.04, M.galv);
    kit.rod(sx * (hw + 0.07), top - 0.55, gz, sx * (hw + 0.07), 0.12, gz, 0.04, M.galv);
    kit.rod(sx * (hw + 0.07), 0.12, gz, sx * (hw + 0.07), 0.12, gz - 0.25, 0.04, M.galv);
  }

  // --- Porch: deck, steps, posts, timber gable truss, railings.
  const DECK = 0.24;
  const pz0 = hd;
  const pz1 = hd + PORCH;
  kit.span(-hw, 0.05, pz0, hw, DECK, pz1, M.deck);
  kit.span(-hw - 0.02, 0.0, pz1 - 0.02, hw + 0.02, DECK - 0.02, pz1 + 0.03, M.timber); // rim joist
  kit.span(-hw - 0.03, 0.0, pz0, -hw + 0.02, DECK - 0.02, pz1, M.timber);
  kit.span(hw - 0.02, 0.0, pz0, hw + 0.03, DECK - 0.02, pz1, M.timber);
  kit.span(-0.85, 0.0, pz1, 0.85, 0.16, pz1 + 0.3, M.deck);
  kit.span(-0.85, 0.0, pz1 + 0.3, 0.85, 0.08, pz1 + 0.6, M.deck);
  kit.span(-0.87, 0.0, pz1, -0.83, 0.17, pz1 + 0.62, M.timber);
  kit.span(0.83, 0.0, pz1, 0.87, 0.17, pz1 + 0.62, M.timber);

  const postX = hw - 0.12;
  const postZ = pz1 - 0.15;
  const beamTop = R.yU(hw - 0.02);
  for (const sx of [-1, 1]) {
    kit.span(sx * postX - 0.1, DECK, postZ - 0.1, sx * postX + 0.1, DECK + 0.06, postZ + 0.1, M.steel);
    kit.box(0.16, beamTop - 0.22 - DECK - 0.06, 0.16, sx * postX, (beamTop - 0.22 + DECK + 0.06) / 2, postZ, M.timber);
    // Eave beam from the wall to past the post.
    kit.span(sx * postX - 0.07, beamTop - 0.22, hd - 0.05, sx * postX + 0.07, beamTop, zFront - 0.12, M.timber);
    // Knee braces.
    kit.beam(sx * postX, beamTop - 0.85, postZ, sx * postX, beamTop - 0.2, postZ - 0.65, 0.09, 0.09, M.timber);
    kit.beam(sx * postX, beamTop - 0.85, postZ, sx * (postX - 0.65), beamTop - 0.2, postZ, 0.09, 0.09, M.timber);
  }
  // Tie beam + king post + ridge beam + struts across the porch gable.
  kit.span(-postX - 0.07, beamTop - 0.24, postZ - 0.07, postX + 0.07, beamTop - 0.02, postZ + 0.07, M.timber);
  const ridgeUnder = R.yU(0);
  kit.span(-0.08, ridgeUnder - 0.3, hd - 0.05, 0.08, ridgeUnder - 0.01, zFront - 0.1, M.timber);
  kit.span(-0.07, beamTop - 0.02, postZ - 0.07, 0.07, ridgeUnder - 0.3, postZ + 0.07, M.timber);
  for (const sx of [-1, 1]) {
    kit.beam(sx * hw * 0.55, beamTop - 0.02, postZ, sx * 0.07, beamTop + (ridgeUnder - beamTop) * 0.62, postZ, 0.11, 0.1, M.timber);
  }
  // Porch railings (sides + either side of the steps).
  const railY = DECK + 0.9;
  const rail = (ax, az, bx, bz) => {
    kit.beam(ax, railY, az, bx, railY, bz, 0.06, 0.12, M.timber);
    kit.beam(ax, DECK + 0.12, az, bx, DECK + 0.12, bz, 0.05, 0.08, M.timber);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.round(len / 0.13));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      kit.box(0.035, railY - DECK - 0.15, 0.035, px, (railY + DECK + 0.15) / 2, pz, M.frame);
    }
  };
  for (const sx of [-1, 1]) {
    rail(sx * postX, hd + 0.05, sx * postX, postZ - 0.08);
    rail(sx * (postX - 0.08), postZ, sx * 0.9, postZ);
    kit.box(0.1, railY - DECK + 0.03, 0.1, sx * 0.9, (railY + DECK) / 2, postZ, M.timber);
    circleRow(collidables, toW, sx * postX, hd + 0.3, sx * postX, postZ, 0.12, 0.45, { maxY: 1.1 });
    circleRow(collidables, toW, sx * postX, postZ, sx * 1.0, postZ, 0.12, 0.45, { maxY: 1.1 });
  }
  // Porch bench under the lamp.
  const benchX = -(0.55 + hw) / 2 - 0.15;
  kit.span(benchX - 0.5, DECK + 0.4, hd + 0.18, benchX + 0.5, DECK + 0.45, hd + 0.55, M.timber);
  for (const bx of [-0.42, 0.42]) kit.span(benchX + bx - 0.03, DECK, hd + 0.2, benchX + bx + 0.03, DECK + 0.4, hd + 0.53, M.frame);

  // --- Door: open leaf swung inside against the wall.
  kit.push(0, 0, hd, 0);
  const leafH = 2.32 - FLOOR - 0.02;
  kit.box(0.05, leafH, 1.02, -0.52, FLOOR + leafH / 2 + 0.01, -T - 0.53, M.door);
  kit.box(0.06, 0.03, 0.3, -0.52, FLOOR + leafH * 0.75, -T - 0.53, M.frame);
  kit.box(0.02, leafH * 0.55, 0.08, -0.49, FLOOR + leafH * 0.6, -T - 0.95, M.frame);
  kit.cyl(0.018, 0.018, 0.14, 6, -0.47, FLOOR + 1.0, -T - 0.95, M.steel, Math.PI / 2);
  for (const hy of [0.25, leafH - 0.25]) kit.box(0.04, 0.12, 0.06, -0.54, FLOOR + hy, -T - 0.02, M.frame);
  // Wall lamp (left of the door) + house number plate.
  const lampU = -(0.55 + 0.09 + 0.22);
  kit.box(0.12, 0.2, 0.04, lampU, 2.05, 0.045, M.frame);
  kit.box(0.04, 0.04, 0.16, lampU, 2.1, 0.13, M.frame);
  kit.cyl(0.07, 0.11, 0.12, 12, lampU, 2.1, 0.24, M.frame);
  kit.cyl(0.085, 0.085, 0.03, 12, lampU, 2.03, 0.24, M.glow);
  kit.pop();
  const lamp = new THREE.PointLight(0xffc98a, 1.6, 8, 1.5);
  lamp.position.set(lampU, 1.85, hd + 0.4);
  group.add(lamp);

  // --- Exterior stone chimney against the back wall.
  const chimTop = R.yU(chimX) + 1.25;
  kit.push(chimX, 0, -hd, 0);
  kit.span(-0.5, 0, -0.62, 0.5, 1.9, 0, M.stone);
  kit.box(1.08, 0.06, 0.68, 0, 1.93, -0.31, M.concrete);
  kit.add(taperGeo(1.0, 0.62, 0.62, 0.42, 0.7), M.stone, { local: new THREE.Matrix4().makeTranslation(0, 1.96, -0.31) });
  kit.span(-0.31, 2.66, -0.52, 0.31, chimTop, -0.1, M.stone);
  kit.box(0.72, 0.08, 0.5, 0, chimTop + 0.04, -0.31, M.concrete);
  kit.cyl(0.09, 0.09, 0.35, 10, 0, chimTop + 0.25, -0.31, M.steel);
  kit.cyl(0.17, 0.17, 0.03, 10, 0, chimTop + 0.47, -0.31, M.steel);
  kit.pop();
  {
    const [cx, cz] = toW(chimX, -hd - 0.33);
    collidables.push({ x: cx, z: cz, radius: 0.55 });
  }

  // --- Interior.
  // Bunk bed along the back wall (left).
  const bx0 = -hw + T + 0.02;
  const bx1 = bx0 + 2.0;
  const bz0 = -hd + T + 0.02;
  const bz1 = bz0 + 0.9;
  for (const px of [bx0 + 0.04, bx1 - 0.04]) {
    for (const pz of [bz0 + 0.04, bz1 - 0.04]) kit.box(0.07, 1.75, 0.07, px, FLOOR + 0.875, pz, M.timber);
  }
  for (const ly of [0.38, 1.28]) {
    kit.span(bx0, FLOOR + ly, bz0, bx1, FLOOR + ly + 0.1, bz0 + 0.05, M.timber);
    kit.span(bx0, FLOOR + ly, bz1 - 0.05, bx1, FLOOR + ly + 0.1, bz1, M.timber);
    kit.span(bx0 + 0.05, FLOOR + ly + 0.1, bz0 + 0.05, bx1 - 0.05, FLOOR + ly + 0.24, bz1 - 0.05, M.fabric);
    kit.span(bx0 + 0.1, FLOOR + ly + 0.24, bz0 + 0.12, bx0 + 0.45, FLOOR + ly + 0.32, bz1 - 0.12, M.linen);
    kit.span(bx0 + 0.9, FLOOR + ly + 0.24, bz0 + 0.06, bx1 - 0.06, FLOOR + ly + 0.27, bz1 - 0.04, M.canvasDark);
  }
  kit.span(bx0, FLOOR + 1.62, bz1 - 0.05, bx1, FLOOR + 1.68, bz1, M.timber); // guard rail
  for (let i = 0; i < 4; i++) kit.box(0.04, 0.04, 0.05, bx1 - 0.2, FLOOR + 0.5 + i * 0.32, bz1 + 0.04, M.timber);
  kit.box(0.04, 1.5, 0.05, bx1 - 0.38, FLOOR + 0.8, bz1 + 0.04, M.timber);
  kit.box(0.04, 1.5, 0.05, bx1 - 0.02, FLOOR + 0.8, bz1 + 0.04, M.timber);
  circleRow(collidables, toW, bx0 + 0.45, (bz0 + bz1) / 2, bx1 - 0.45, (bz0 + bz1) / 2, 0.45, 0.55);

  // Wood stove + flue into the chimney.
  const sx0 = chimX;
  const sz0 = -hd + T + 0.45;
  kit.box(0.55, 0.55, 0.5, sx0, FLOOR + 0.45, sz0, M.steel);
  for (const lx of [-0.22, 0.22]) for (const lz of [-0.18, 0.18]) kit.box(0.04, 0.18, 0.04, sx0 + lx, FLOOR + 0.09, sz0 + lz, M.steel);
  kit.box(0.28, 0.16, 0.02, sx0, FLOOR + 0.45, sz0 + 0.26, M.ember);
  kit.box(0.34, 0.22, 0.02, sx0, FLOOR + 0.45, sz0 + 0.255, M.frame);
  kit.span(sx0 - 0.4, FLOOR, sz0 - 0.4, sx0 + 0.4, FLOOR + 0.03, sz0 + 0.55, M.stone);
  kit.cyl(0.075, 0.075, 0.9, 10, sx0, FLOOR + 1.17, sz0, M.steel);
  kit.rod(sx0, FLOOR + 1.6, sz0, sx0, FLOOR + 1.6, -hd, 0.075, M.steel, 10);
  {
    const [wx, wz] = toW(sx0, sz0);
    collidables.push({ x: wx, z: wz, radius: 0.42 });
  }

  // Table under the right-hand window, bench + chair, a few items.
  const tx = hw - T - 0.5;
  const tz = -sideWinZ - 0.1;
  kit.span(tx - 0.4, FLOOR + 0.72, tz - 0.65, tx + 0.4, FLOOR + 0.76, tz + 0.65, M.timber);
  for (const lx of [-0.34, 0.34]) for (const lz of [-0.58, 0.58]) kit.box(0.05, 0.72, 0.05, tx + lx, FLOOR + 0.36, tz + lz, M.frame);
  kit.span(tx - 0.95, FLOOR + 0.43, tz - 0.6, tx - 0.65, FLOOR + 0.47, tz + 0.6, M.timber);
  for (const lz of [-0.5, 0.5]) kit.span(tx - 0.83, FLOOR, tz + lz - 0.02, tx - 0.77, FLOOR + 0.43, tz + lz + 0.02, M.frame);
  kit.span(tx - 0.3, FLOOR + 0.76, tz - 0.4, tx + 0.15, FLOOR + 0.765, tz + 0.05, M.paper);
  kit.box(0.3, 0.16, 0.18, tx + 0.12, FLOOR + 0.84, tz + 0.4, M.fabric);
  kit.box(0.02, 0.18, 0.02, tx + 0.22, FLOOR + 1.0, tz + 0.4, M.frame);
  kit.cyl(0.04, 0.035, 0.1, 8, tx - 0.15, FLOOR + 0.81, tz + 0.3, M.coolerLid);
  kit.cyl(0.05, 0.05, 0.16, 8, tx + 0.15, FLOOR + 0.84, tz - 0.4, M.brass);
  kit.cyl(0.035, 0.035, 0.08, 8, tx + 0.15, FLOOR + 0.94, tz - 0.4, M.glow);
  {
    const [wx, wz] = toW(tx - 0.2, tz);
    collidables.push({ x: wx, z: wz, radius: 0.6 });
  }

  // Shelving unit on the left wall by the door.
  const shx = -hw + T + 0.2;
  const shz0 = hd - T - 1.1;
  const shz1 = hd - T - 0.1;
  for (const pz of [shz0, shz1]) kit.span(shx - 0.2, FLOOR, pz - 0.02, shx + 0.2, FLOOR + 1.9, pz + 0.02, M.timber);
  for (let i = 0; i < 5; i++) kit.span(shx - 0.2, FLOOR + 0.1 + i * 0.44, shz0, shx + 0.2, FLOOR + 0.13 + i * 0.44, shz1, M.timber);
  const goods = [
    [0, 0.25, 0.3, 0.22, M.crate], [0, 0.6, 0.22, 0.18, M.coolerLid],
    [1, 0.2, 0.18, 0.3, M.red], [1, 0.55, 0.3, 0.2, M.fabric], [1, 0.82, 0.12, 0.25, M.paper],
    [2, 0.3, 0.4, 0.15, M.paper], [2, 0.75, 0.2, 0.28, M.coolerBody],
    [3, 0.35, 0.3, 0.12, M.canvas], [3, 0.7, 0.18, 0.2, M.brass],
  ];
  for (const [lvl, zz, len, h, mat] of goods) {
    kit.box(0.3, h, len, shx, FLOOR + 0.13 + lvl * 0.44 + h / 2, shz0 + zz, mat);
  }
  circleRow(collidables, toW, shx, shz0 + 0.2, shx, shz1 - 0.2, 0.28, 0.6);

  // --- Wall collision (circle rows, door gap on the front wall).
  const wr = 0.35;
  const sp = 0.55;
  circleRow(collidables, toW, -hw + 0.1, -hd + 0.08, hw - 0.1, -hd + 0.08, wr, sp);
  circleRow(collidables, toW, -hw + 0.08, -hd + 0.1, -hw + 0.08, hd - 0.1, wr, sp);
  circleRow(collidables, toW, hw - 0.08, -hd + 0.1, hw - 0.08, hd - 0.1, wr, sp);
  circleRow(collidables, toW, -hw + 0.1, hd - 0.08, -0.92, hd - 0.08, wr, sp);
  circleRow(collidables, toW, 0.92, hd - 0.08, hw - 0.1, hd - 0.08, wr, sp);
  for (const sx of [-1, 1]) {
    const [px, pz] = toW(sx * postX, postZ);
    collidables.push({ x: px, z: pz, radius: 0.16 });
  }
  {
    const [bxw, bzw] = toW(benchX, hd + 0.37);
    collidables.push({ x: bxw, z: bzw, radius: 0.3, maxY: 0.8 });
  }

  kit.finish(group);
  finishGlass(group, glass, M);
  group.rotation.y = angle;
  group.position.set(x, 0, z);
  return group;
}

// Frustum-like tapered box (chimney shoulder): bottom w0 x d0, top w1 x d1, height h.
function taperGeo(w0, d0, w1, d1, h) {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * (top ? w1 : w0));
    p.setZ(i, p.getZ(i) * (top ? d1 : d0));
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// 2. Observation watchtower
// ---------------------------------------------------------------------------

export function makeForestWatchtower(x, z, collidables, walkableSurfaces) {
  const M = mats();
  const roof = roofMat(0x3a3430);
  const clad = cladMat(0x7a6248);
  const group = new THREE.Group();
  group.name = 'forest-watchtower';
  const kit = new Kit();
  const toW = makeToWorld(x, z, 0);

  const P = 2.4; // post line
  const E = 2.9; // platform half size
  const PLAT = 6.0;
  const LAND = 3.0;
  const SW = 1.2; // stair width
  const F1 = -0.65; // flight 1 centre x (up toward -z)
  const F2 = 0.65; // flight 2 centre x (up toward +z)
  const ZS = 2.2; // stair south end
  const ZN = -0.8; // stair north end / landing edge
  const STEPS = 15;

  // Footings + posts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.span(sx * P - 0.38, -0.2, sz * P - 0.38, sx * P + 0.38, 0.3, sz * P + 0.38, M.concrete);
      kit.span(sx * P - 0.16, 0.3, sz * P - 0.16, sx * P + 0.16, 0.45, sz * P + 0.16, M.steel);
      kit.box(0.28, 5.15, 0.28, sx * P, 0.45 + 5.15 / 2, sz * P, M.timber);
      const [wx, wz] = toW(sx * P, sz * P);
      collidables.push({ x: wx, z: wz, radius: 0.32 });
    }
  }
  // Stair base pad.
  kit.span(-1.35, -0.1, ZS - 0.1, 0.05, 0.05, ZS + 1.0, M.concrete);

  // Girts (y = 3) and cross-bracing, set just outside the post faces.
  const o = 0.17;
  for (const sz of [-1, 1]) kit.span(-P - 0.2, LAND - 0.2, sz * (P + o) - 0.05, P + 0.2, LAND, sz * (P + o) + 0.05, M.timber);
  for (const sx of [-1, 1]) kit.span(sx * (P + o) - 0.05, LAND - 0.2, -P - 0.2, sx * (P + o) + 0.05, LAND, P + 0.2, M.timber);
  const brace = (ax, ay, az, bx, by, bz) => kit.beam(ax, ay, az, bx, by, bz, 0.09, 0.14, M.timber);
  const tiers = [[0.55, LAND - 0.2], [LAND, 5.55]];
  for (const [y0, y1] of tiers) {
    // North face (z = -P) and east/west faces: full X.
    brace(-P, y0, -P - o - 0.05, P, y1, -P - o - 0.05);
    brace(P, y0, -P - o + 0.05, -P, y1, -P - o + 0.05);
    for (const sx of [-1, 1]) {
      brace(sx * (P + o + 0.05), y0, -P, sx * (P + o + 0.05), y1, P);
      brace(sx * (P + o - 0.05), y0, P, sx * (P + o - 0.05), y1, -P);
    }
  }
  // South face: X above the landing, a single diagonal below (stair entrance).
  brace(-P, LAND, P + o + 0.05, P, 5.55, P + o + 0.05);
  brace(P, LAND, P + o - 0.05, -P, 5.55, P + o - 0.05);
  brace(P, 0.55, P + o, 0.15, LAND - 0.2, P + o);

  // --- Platform framing + deck (with stair hatch over flight 2).
  for (const sz of [-1, 1]) kit.span(-E, PLAT - 0.4, sz * P - 0.11, E, PLAT - 0.1, sz * P + 0.11, M.timber);
  for (const sx of [-1, 1]) kit.span(sx * E - 0.06, PLAT - 0.35, -E, sx * E + 0.06, PLAT - 0.1, E, M.timber);
  for (const jx of [-2.35, -1.75, -1.15, -0.55, 1.75, 2.35]) kit.span(jx - 0.04, PLAT - 0.3, -E, jx + 0.04, PLAT - 0.1, E, M.timber);
  for (const jx of [-0.06, 1.36]) kit.span(jx - 0.04, PLAT - 0.3, -E, jx + 0.04, PLAT - 0.1, E, M.timber);
  for (const jx of [0.65]) kit.span(jx - 0.04, PLAT - 0.3, -E, jx + 0.04, PLAT - 0.1, -0.02, M.timber);
  kit.span(-0.02, PLAT - 0.3, -0.06, 1.32, PLAT - 0.1, 0.02, M.timber);
  const hatch = { x0: -0.02, x1: 1.32, z0: 0.0, z1: ZS };
  const deckRects = [
    [-E, hatch.x0, -E, E],
    [hatch.x1, E, -E, E],
    [hatch.x0, hatch.x1, -E, hatch.z0],
    [hatch.x0, hatch.x1, hatch.z1, E],
  ];
  for (const [x0, x1, z0, z1] of deckRects) {
    kit.span(x0, PLAT - 0.1, z0, x1, PLAT, z1, M.deck);
    const [cx, cz] = toW((x0 + x1) / 2, (z0 + z1) / 2);
    walkableSurfaces.push({ type: 'rect', x: cx, z: cz, width: x1 - x0, depth: z1 - z0, y: PLAT });
  }

  // --- Stairs: two flights + landing.
  const flight = (xc, z1, z2, y1, y2) => {
    const dir = Math.sign(z2 - z1);
    const run = Math.abs(z2 - z1);
    const td = run / STEPS;
    const rise = (y2 - y1) / STEPS;
    for (let k = 1; k <= STEPS; k++) {
      const za = z1 + dir * (k - 1) * td;
      const zb = z1 + dir * k * td;
      const top = y1 + k * rise;
      kit.span(xc - SW / 2 + 0.04, top - 0.05, Math.min(za, zb) - 0.02, xc + SW / 2 - 0.04, top, Math.max(za, zb) + 0.02, M.deck);
      // Steel tread bracket under the nosing.
      kit.span(xc - SW / 2 + 0.04, top - 0.09, Math.min(za, zb) + 0.02, xc + SW / 2 - 0.04, top - 0.05, Math.max(za, zb) - 0.02, M.steel);
    }
    for (const sx of [-1, 1]) {
      const sxp = xc + sx * (SW / 2 + 0.02);
      kit.beam(sxp, y1 - 0.12, z1, sxp, y2 - 0.12, z2, 0.06, 0.3, M.timber);
      // Handrail + balusters.
      kit.beam(sxp, y1 + 0.95, z1, sxp, y2 + 0.95, z2, 0.05, 0.07, M.timber);
      kit.beam(sxp, y1 + 0.5, z1, sxp, y2 + 0.5, z2, 0.03, 0.04, M.steel);
      for (let k = 0; k <= STEPS; k += 3) {
        const zz = z1 + dir * k * td;
        const yy = y1 + k * rise;
        kit.box(0.06, 1.0, 0.06, sxp, yy + 0.45, zz, M.timber);
      }
      // Collision along the stringer (follows the stair height).
      for (let k = 0; k <= STEPS; k += 1) {
        const zz = z1 + dir * k * td;
        if (dir > 0 && zz > ZS - 0.4) continue; // let players step off sideways at the top
        const yy = y1 + k * rise;
        const [wx, wz] = toW(xc + sx * (SW / 2 + 0.05), zz);
        collidables.push({ x: wx, z: wz, radius: 0.08, minY: yy - 0.3, maxY: yy + 1.1 });
      }
    }
  };
  flight(F1, ZS, ZN, 0, LAND);
  flight(F2, ZN, ZS, LAND, PLAT);
  walkableSurfaces.push(Object.assign({ type: 'ramp' }, rampW(toW, F1, ZS, F1, ZN, SW, 0, LAND, STEPS)));
  walkableSurfaces.push(Object.assign({ type: 'ramp' }, rampW(toW, F2, ZN, F2, ZS, SW, LAND, PLAT, STEPS)));

  // Landing.
  const LX = 1.3;
  const LZ0 = -2.3;
  kit.span(-LX, LAND - 0.08, LZ0, LX, LAND, ZN, M.deck);
  kit.span(-P, LAND - 0.3, ZN - 0.12, P, LAND - 0.08, ZN, M.timber);
  kit.span(-P, LAND - 0.3, LZ0, P, LAND - 0.08, LZ0 + 0.12, M.timber);
  {
    const [cx, cz] = toW(0, (LZ0 + ZN) / 2);
    walkableSurfaces.push({ type: 'rect', x: cx, z: cz, width: LX * 2, depth: ZN - LZ0, y: LAND });
  }
  const guard = (ax, az, bx, bz, y) => {
    kit.beam(ax, y + 1.0, az, bx, y + 1.0, bz, 0.07, 0.07, M.timber);
    kit.beam(ax, y + 0.5, az, bx, y + 0.5, bz, 0.03, 0.04, M.steel);
    kit.box(0.07, 1.0, 0.07, ax, y + 0.5, az, M.timber);
    kit.box(0.07, 1.0, 0.07, bx, y + 0.5, bz, M.timber);
  };
  guard(-LX, LZ0, LX, LZ0, LAND);
  guard(-LX, LZ0, -LX, ZN, LAND);
  guard(LX, LZ0, LX, ZN, LAND);
  circleRow(collidables, toW, -LX, LZ0 - 0.05, LX, LZ0 - 0.05, 0.1, 0.45, { minY: LAND - 0.2, maxY: LAND + 1.1 });
  circleRow(collidables, toW, -LX - 0.05, LZ0, -LX - 0.05, ZN, 0.1, 0.45, { minY: LAND - 0.2, maxY: LAND + 1.1 });
  circleRow(collidables, toW, LX + 0.05, LZ0, LX + 0.05, ZN, 0.1, 0.45, { minY: LAND - 0.2, maxY: LAND + 1.1 });

  // Hatch guard (sides + far end) at platform level.
  guard(hatch.x0, hatch.z0, hatch.x1, hatch.z0, PLAT);
  circleRow(collidables, toW, hatch.x0, hatch.z0 - 0.05, hatch.x1, hatch.z0 - 0.05, 0.1, 0.45, { minY: PLAT + 0.3, maxY: PLAT + 1.3 });
  for (const hx of [hatch.x0 - 0.03, hatch.x1 + 0.03]) {
    circleRow(collidables, toW, hx, hatch.z0, hx, ZS - 0.4, 0.08, 0.45, { minY: PLAT - 0.1, maxY: PLAT + 1.2 });
  }

  // --- Observation hut: half-walls, corner posts, roof.
  const HUT = 2.45;
  const cap = PLAT + 1.02;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) kit.box(0.18, HUT, 0.18, sx * (E - 0.1), PLAT + HUT / 2, sz * (E - 0.1), M.timber);
    // Half walls (clad outside, ceiling-tone lining inside) + cap rail.
    kit.span(-E, PLAT, sx * E - 0.03, E, cap, sx * E + 0.03, clad);
    kit.span(sx * E - 0.03, PLAT, -E, sx * E + 0.03, cap, E, clad);
    kit.span(-E - 0.04, cap, sx * E - 0.08, E + 0.04, cap + 0.05, sx * E + 0.08, M.timber);
    kit.span(sx * E - 0.08, cap, -E - 0.04, sx * E + 0.08, cap + 0.05, E + 0.04, M.timber);
    kit.span(-E - 0.02, PLAT - 0.12, sx * E - 0.05, E + 0.02, PLAT + 0.08, sx * E + 0.05, M.trim);
    kit.span(sx * E - 0.05, PLAT - 0.12, -E - 0.02, sx * E + 0.05, PLAT + 0.08, E + 0.02, M.trim);
    // Top plates.
    kit.span(-E - 0.05, PLAT + HUT - 0.2, sx * (E - 0.1) - 0.09, E + 0.05, PLAT + HUT, sx * (E - 0.1) + 0.09, M.timber);
    kit.span(sx * (E - 0.1) - 0.09, PLAT + HUT - 0.2, -E - 0.05, sx * (E - 0.1) + 0.09, PLAT + HUT, E + 0.05, M.timber);
  }
  circleRow(collidables, toW, -E + 0.05, -E + 0.05, E - 0.05, -E + 0.05, 0.12, 0.5, { minY: PLAT - 0.4, maxY: PLAT + 1.4 });
  circleRow(collidables, toW, -E + 0.05, E - 0.05, E - 0.05, E - 0.05, 0.12, 0.5, { minY: PLAT - 0.4, maxY: PLAT + 1.4 });
  circleRow(collidables, toW, -E + 0.05, -E + 0.05, -E + 0.05, E - 0.05, 0.12, 0.5, { minY: PLAT - 0.4, maxY: PLAT + 1.4 });
  circleRow(collidables, toW, E - 0.05, -E + 0.05, E - 0.05, E - 0.05, 0.12, 0.5, { minY: PLAT - 0.4, maxY: PLAT + 1.4 });

  // Roof: ridge along Z so the timber gable faces the stair side.
  const RR = gableRoof(kit, M, roof, {
    hw: E - 0.1, eave: PLAT + HUT, pitch: THREE.MathUtils.degToRad(24), ovh: 0.4, z0: -E - 0.35, z1: E + 0.35,
  });
  // Exposed ridge beam + king posts at the gable ends.
  kit.span(-0.08, RR.yU(0) - 0.26, -E - 0.3, 0.08, RR.yU(0) - 0.01, E + 0.3, M.timber);
  for (const ez of [-(E - 0.1), E - 0.1]) {
    kit.span(-0.07, PLAT + HUT, ez - 0.07, 0.07, RR.yU(0) - 0.26, ez + 0.07, M.timber);
    for (const sx of [-1, 1]) kit.beam(sx * 1.4, PLAT + HUT, ez, sx * 0.07, PLAT + HUT + (RR.yU(0) - PLAT - HUT) * 0.6, ez, 0.1, 0.1, M.timber);
  }

  // Fire-finder pedestal + small map table on the deck.
  kit.cyl(0.08, 0.12, 1.05, 10, -1.2, PLAT + 0.525, 1.4, M.steel);
  kit.cyl(0.36, 0.36, 0.05, 20, -1.2, PLAT + 1.07, 1.4, M.paper);
  kit.add(new THREE.TorusGeometry(0.37, 0.025, 6, 24), M.brass, {
    local: new THREE.Matrix4().compose(_v.set(-1.2, PLAT + 1.1, 1.4), _q.setFromEuler(_e.set(Math.PI / 2, 0, 0)), _s), uv: 'own',
  });
  kit.box(0.04, 0.12, 0.5, -1.2, PLAT + 1.16, 1.4, M.brass);
  kit.span(-2.6, PLAT + 0.75, -2.6, -1.4, PLAT + 0.8, -1.9, M.timber);
  for (const [lx, lz] of [[-2.55, -2.55], [-1.45, -2.55], [-2.55, -1.95], [-1.45, -1.95]]) kit.box(0.05, 0.75, 0.05, lx, PLAT + 0.375, lz, M.frame);
  kit.span(-2.4, PLAT + 0.8, -2.5, -1.7, PLAT + 0.805, -2.0, M.paper);
  kit.box(0.2, 0.08, 0.12, -1.6, PLAT + 0.84, -2.2, M.fabric);
  for (const [lx, lz, r] of [[-1.2, 1.4, 0.4], [-2.0, -2.25, 0.45]]) {
    const [wx, wz] = toW(lx, lz);
    collidables.push({ x: wx, z: wz, radius: r, minY: PLAT - 0.2, maxY: PLAT + 1.5 });
  }

  kit.finish(group);
  group.position.set(x, 0, z);
  return group;
}

function rampW(toW, x1, z1, x2, z2, width, y1, y2, steps) {
  const [wx1, wz1] = toW(x1, z1);
  const [wx2, wz2] = toW(x2, z2);
  return { x1: wx1, z1: wz1, x2: wx2, z2: wz2, width, y1, y2, steps };
}

// ---------------------------------------------------------------------------
// 3. Campsite
// ---------------------------------------------------------------------------

// Ridge "wall" tent (military style). Local: length along Z, door on +Z.
function ridgeTent(kit, M, { x, z, ry, len = 2.5, wid = 2.0, wallH = 0.45, H = 1.55, mat }) {
  kit.push(x, 0, z, ry);
  const hw = wid / 2;
  const hl = len / 2;
  const t = 0.02;
  // Ground sheet.
  kit.span(-hw - 0.05, 0.005, -hl - 0.05, hw + 0.05, 0.02, hl + 0.05, M.canvasDark);
  // Walls + roof panels.
  for (const sx of [-1, 1]) {
    kit.span(sx * hw - t / 2, 0.02, -hl, sx * hw + t / 2, wallH, hl, mat);
    kit.beam(sx * (hw + 0.12), wallH - 0.05, 0, 0, H, 0, t, len + 0.24, mat);
    // Valance strip + eave reinforcement.
    kit.span(sx * hw - 0.015, 0.02, -hl, sx * hw + 0.015, 0.12, hl, M.canvasDark);
  }
  kit.span(-0.07, H - 0.01, -hl - 0.12, 0.07, H + 0.03, hl + 0.12, M.canvasDark);
  // Back end wall.
  const end = [[-hw, 0], [hw, 0], [hw, wallH], [0, H], [-hw, wallH]];
  kit.prism(end, t, 0, 0.02, -hl - t / 2, mat);
  // Front: one closed door flap, the other rolled up and tied at the eave.
  kit.prism([[-hw, 0], [0, 0], [0, H], [-hw, wallH]], t, 0, 0.02, hl - t / 2, mat);
  kit.prism([[0.62, 0], [hw, 0], [hw, wallH], [0.62, wallH + (hw - 0.62) * ((H - wallH) / hw)]], t, 0, 0.02, hl - t / 2, mat);
  kit.add(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8), mat, {
    local: new THREE.Matrix4().compose(_v.set(0.31, H - 0.42, hl + 0.06), _q.setFromEuler(_e.set(0, 0, Math.PI / 2 - Math.atan2(H - wallH, hw))), _s), uv: 'own',
  });
  kit.box(0.04, 0.2, 0.02, 0.1, H - 0.25, hl + 0.06, M.rope);
  kit.box(0.04, 0.2, 0.02, 0.52, H - 0.5, hl + 0.06, M.rope);
  // Poles.
  for (const pz of [-hl - 0.03, hl + 0.03]) kit.cyl(0.025, 0.025, H + 0.15, 6, 0, (H + 0.15) / 2, pz, M.steel);
  kit.cyl(0.02, 0.02, len + 0.3, 6, 0, H + 0.04, 0, M.steel, Math.PI / 2);
  // Guy lines + pegs: ridge ends and the four eave corners.
  const peg = (px, pz) => {
    kit.box(0.03, 0.12, 0.03, px, 0.05, pz, M.steel);
    kit.box(0.08, 0.02, 0.02, px, 0.11, pz, M.steel);
  };
  for (const sz of [-1, 1]) {
    const pz = sz * (hl + 1.1);
    kit.rod(0, H + 0.12, sz * (hl + 0.05), 0, 0.1, pz, 0.006, M.rope, 4);
    peg(0, pz);
    for (const sx of [-1, 1]) {
      const ax = sx * (hw + 0.1);
      const az = sz * (hl - 0.05);
      const px = sx * (hw + 0.85);
      const pz2 = sz * (hl + 0.35);
      kit.rod(ax, wallH, az, px, 0.1, pz2, 0.006, M.rope, 4);
      peg(px, pz2);
      // Wall-bottom pegs.
      peg(sx * (hw + 0.06), sz * (hl - 0.3));
    }
  }
  kit.pop();
}

export function makeForestCampsite(x, z, collidables) {
  const M = mats();
  const group = new THREE.Group();
  group.name = 'forest-campsite';
  const kit = new Kit();
  const angle = (hash2(Math.round(x), Math.round(z), 7) - 0.5) * 1.2;
  const toW = makeToWorld(x, z, angle);

  // Trodden earth around the fire.
  kit.add(new THREE.CircleGeometry(2.0, 28), M.soil, {
    local: new THREE.Matrix4().compose(_v.set(0.2, 0.015, 0.4), _q.setFromEuler(_e.set(-Math.PI / 2, 0, 0)), _s),
  });

  // --- Fire pit: ring of stones, ash bed, crossed logs, embers.
  const fx = 0.2;
  const fz = 0.5;
  const stones = 12;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const r = 0.55 + (hash2(i, 1, 33) - 0.5) * 0.05;
    const geo = new THREE.IcosahedronGeometry(0.15, 1);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const n = 0.85 + 0.3 * hash2(Math.round(p.getX(k) * 100), Math.round(p.getY(k) * 100) + Math.round(p.getZ(k) * 37), i);
      p.setXYZ(k, p.getX(k) * n * 1.25, p.getY(k) * n * 0.7, p.getZ(k) * n);
    }
    geo.computeVertexNormals();
    kit.add(geo, M.rock, {
      local: new THREE.Matrix4().compose(_v.set(fx + Math.cos(a) * r, 0.06, fz + Math.sin(a) * r), _q.setFromEuler(_e.set(0, -a + hash2(i, 2, 33), 0)), _s),
    });
  }
  kit.add(new THREE.CircleGeometry(0.46, 18), M.ash, {
    local: new THREE.Matrix4().compose(_v.set(fx, 0.03, fz), _q.setFromEuler(_e.set(-Math.PI / 2, 0, 0)), _s),
  });
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 4) + 0.3;
    kit.push(fx, 0.12 + (i % 2) * 0.09, fz, a, 0, 0.08 * ((i % 2) * 2 - 1));
    kit.add(new THREE.CylinderGeometry(0.055, 0.06, 0.7, 7, 1, true), M.bark, { local: new THREE.Matrix4().makeRotationZ(Math.PI / 2), uv: 'own' });
    kit.pop();
  }
  for (let i = 0; i < 9; i++) {
    const a = hash2(i, 5, 44) * Math.PI * 2;
    const r = hash2(i, 6, 44) * 0.28;
    kit.box(0.08, 0.04, 0.06, fx + Math.cos(a) * r, 0.05, fz + Math.sin(a) * r, M.ember, 0, a, 0);
  }
  for (let i = 0; i < 3; i++) kit.cyl(0.0, 0.07 - i * 0.01, 0.28 - i * 0.05, 6, fx + (i - 1) * 0.08, 0.2, fz + (i % 2) * 0.05, M.ember);
  // Cooking tripod + pot.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    kit.rod(fx + Math.cos(a) * 0.62, 0.0, fz + Math.sin(a) * 0.62, fx, 1.05, fz, 0.015, M.steel, 5);
  }
  kit.rod(fx, 1.05, fz, fx, 0.62, fz, 0.004, M.steel, 4);
  kit.cyl(0.13, 0.11, 0.18, 12, fx, 0.52, fz, M.steel);
  const fire = new THREE.PointLight(0xff7a2a, 3.2, 11, 1.3);
  fire.position.set(fx, 0.55, fz);
  group.add(fire);
  {
    const [wx, wz] = toW(fx, fz);
    collidables.push({ x: wx, z: wz, radius: 0.6, maxY: 1.0 });
  }

  // --- Tents.
  ridgeTent(kit, M, { x: -1.35, z: -1.45, ry: 0.35, mat: M.canvas });
  ridgeTent(kit, M, { x: 1.75, z: -1.25, ry: -0.45, len: 2.3, wid: 1.8, H: 1.45, mat: M.canvasTan });
  for (const [tx, tz, ry, hl] of [[-1.35, -1.45, 0.35, 1.25], [1.75, -1.25, -0.45, 1.15]]) {
    const dx = Math.sin(ry);
    const dz = Math.cos(ry);
    for (const t of [-0.6, 0.0, 0.6]) {
      const [wx, wz] = toW(tx + dx * t * hl, tz + dz * t * hl);
      collidables.push({ x: wx, z: wz, radius: 0.95 });
    }
  }

  // --- Log benches (half-logs on stumps).
  const bench = (bx, bz, ry) => {
    kit.push(bx, 0, bz, ry);
    for (const sx of [-0.55, 0.55]) {
      kit.add(new THREE.CylinderGeometry(0.15, 0.17, 0.3, 9, 1, true), M.bark, { local: new THREE.Matrix4().makeTranslation(sx, 0.15, 0), uv: 'own' });
      kit.add(new THREE.CircleGeometry(0.15, 9), M.endgrain, {
        local: new THREE.Matrix4().compose(_v.set(sx, 0.3, 0), _q.setFromEuler(_e.set(-Math.PI / 2, 0, 0)), _s), uv: 'own',
      });
    }
    // Half log: flat top, bark below.
    const half = new THREE.CylinderGeometry(0.18, 0.18, 1.6, 12, 1, true, Math.PI / 2, Math.PI);
    kit.add(half, M.bark, { local: new THREE.Matrix4().compose(_v.set(0, 0.32, 0), _q.setFromEuler(_e.set(0, 0, Math.PI / 2)), _s), uv: 'own' });
    kit.span(-0.8, 0.31, -0.18, 0.8, 0.33, 0.18, M.timber);
    kit.pop();
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (const t of [-0.55, 0.55]) {
      const [wx, wz] = toW(bx + c * t, bz - s * t);
      collidables.push({ x: wx, z: wz, radius: 0.3, maxY: 0.45 });
    }
  };
  bench(-1.2, 1.6, 0.6);
  bench(1.75, 1.3, -0.7);

  // --- Supply crate (lid ajar) + cooler.
  kit.push(0.9, 0, 2.3, 0.2);
  kit.span(-0.45, 0.0, -0.25, 0.45, 0.48, 0.25, M.crate);
  for (const ex of [-0.44, 0.44]) for (const ez of [-0.24, 0.24]) kit.box(0.035, 0.49, 0.035, ex, 0.245, ez, M.frame);
  kit.span(-0.46, 0.2, -0.26, 0.46, 0.24, 0.26, M.steel);
  kit.box(0.92, 0.05, 0.52, 0, 0.53, 0.02, M.crate, -0.12);
  for (const ex of [-0.48, 0.48]) kit.box(0.04, 0.05, 0.16, ex, 0.32, 0, M.frame);
  kit.pop();
  kit.push(2.25, 0, 0.0, -0.9);
  kit.span(-0.32, 0.0, -0.22, 0.32, 0.36, 0.22, M.coolerBody);
  kit.span(-0.34, 0.36, -0.24, 0.34, 0.42, 0.24, M.coolerLid);
  kit.span(-0.12, 0.42, -0.03, 0.12, 0.45, 0.03, M.frame);
  kit.pop();
  for (const [lx, lz] of [[0.9, 2.3], [2.25, 0.0]]) {
    const [wx, wz] = toW(lx, lz);
    collidables.push({ x: wx, z: wz, radius: 0.45, maxY: 0.6 });
  }

  // --- Gear rack: two A-frames + top bar, with a pack, jerrycan, lantern, rope.
  kit.push(0.15, 0, -2.6, 0.05);
  for (const sx of [-0.8, 0.8]) {
    kit.rod(sx, 0, -0.3, sx, 1.4, 0, 0.035, M.timber, 6);
    kit.rod(sx, 0, 0.3, sx, 1.4, 0, 0.035, M.timber, 6);
  }
  kit.rod(-0.95, 1.38, 0, 0.95, 1.38, 0, 0.035, M.timber, 6);
  kit.rod(-0.8, 0.5, 0, 0.8, 0.5, 0, 0.025, M.timber, 6);
  kit.box(0.42, 0.55, 0.22, -0.4, 0.98, 0.1, M.fabric);
  kit.box(0.36, 0.2, 0.06, -0.4, 0.88, 0.23, M.canvasDark);
  kit.box(0.44, 0.1, 0.24, -0.4, 1.3, 0.1, M.canvasDark);
  kit.box(0.34, 0.42, 0.16, 0.45, 0.21, 0.25, M.crate);
  kit.cyl(0.07, 0.07, 0.1, 10, 0.25, 1.08, 0, M.brass);
  kit.cyl(0.05, 0.05, 0.12, 10, 0.25, 1.19, 0, M.glow);
  kit.cyl(0.06, 0.05, 0.04, 10, 0.25, 1.27, 0, M.brass);
  kit.add(new THREE.TorusGeometry(0.16, 0.035, 6, 16), M.rope, {
    local: new THREE.Matrix4().compose(_v.set(0.65, 1.15, 0.02), _q.identity(), _s), uv: 'own',
  });
  kit.pop();
  {
    const [wx, wz] = toW(0.15, -2.6);
    collidables.push({ x: wx, z: wz, radius: 0.55 });
    const [wx2, wz2] = toW(-0.6, -2.6);
    collidables.push({ x: wx2, z: wz2, radius: 0.35 });
    const [wx3, wz3] = toW(0.9, -2.6);
    collidables.push({ x: wx3, z: wz3, radius: 0.35 });
  }

  // --- Split firewood stack.
  for (let i = 0; i < 7; i++) {
    const row = i < 4 ? 0 : 1;
    const k = row === 0 ? i : i - 4;
    kit.log(0.75, 0.07, -0.6 + (row === 0 ? 0 : 0.07), 0.07 + row * 0.13, 2.3 + (k - 1.5) * 0.15, 0.05, M);
  }

  kit.finish(group);
  group.rotation.y = angle;
  group.position.set(x, 0, z);
  return group;
}
