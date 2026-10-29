// Forest Outpost landmarks: a galvanised steel fire-lookout / comms tower,
// sandbag fighting positions and ruined stone chapel walls.
//
// Everything is built from a handful of shared, module-level materials with
// small procedural canvas textures (+ normal maps) so the static batcher can
// merge each material into very few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- Small utilities ---------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise on a size x size grid with `cells` lattice cells.
function valueNoise(size, cells, rand) {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const a = lat[y0 * cells + x0];
      const b = lat[y0 * cells + x1];
      const c = lat[y1 * cells + x0];
      const d = lat[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function fbm(size, rand, octaves = [[4, 0.5], [8, 0.3], [32, 0.2]]) {
  const out = new Float32Array(size * size);
  for (const [cells, w] of octaves) {
    const n = valueNoise(size, cells, rand);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
  }
  return out;
}

// Builds a colour texture + normal map from per-pixel functions.
// colorFn(i, x, y) -> [r,g,b,(a)] 0..255; height: Float32Array 0..1.
function makeTextures(size, colorFn, height, strength = 2, alpha = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const col = colorFn(i, x, y);
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = alpha ? col[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  let normalMap = null;
  if (height) {
    const nc = document.createElement('canvas');
    nc.width = nc.height = size;
    const nctx = nc.getContext('2d');
    const nimg = nctx.createImageData(size, size);
    const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
        const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        nimg.data[i + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);
    normalMap = new THREE.CanvasTexture(nc);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = 4;
  }
  return { map, normalMap };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const mix = (a, b, t) => a + (b - a) * t;

// Box with UVs scaled to world metres (texture tile = `tile` metres).
function boxGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each).
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

function addBox(parent, mat, w, h, d, x, y, z, { tile = 1, ry = 0, cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _m4 = new THREE.Matrix4();

// Box-section member from point a to point b. Its cross-section w (local x,
// close to `ref`) by d. `ox`, `oz` offset the section from the centre line.
function member(parent, mat, a, b, w, d, { ref = _X, ox = 0, oz = 0, cast = true, tile = 1 } = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  let r = ref;
  if (Math.abs(dir.dot(r)) > 0.9) r = Math.abs(dir.dot(_Y)) > 0.9 ? _Z : _Y;
  const xA = r.clone().addScaledVector(dir, -r.dot(dir)).normalize();
  const zA = new THREE.Vector3().crossVectors(xA, dir);
  const g = boxGeo(w, len, d, tile);
  if (ox || oz) g.translate(ox, 0, oz);
  const mesh = new THREE.Mesh(g, mat);
  mesh.quaternion.setFromRotationMatrix(_m4.makeBasis(xA, dir, zA));
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Local -> world for a group placed at (x, z) rotated by `angle` about Y.
function toWorld(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (lx, lz) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
}

function std(params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.noWeathering = true;
  return m;
}

// --- Shared materials (built lazily, once) -------------------------------------

let M = null;
function materials() {
  if (M) return M;
  const r = rng(7311);
  const S = 256;

  // Galvanised steel: mottled zinc spangle, very fine normal noise.
  const spangle = fbm(S, r, [[16, 0.55], [48, 0.3], [128, 0.15]]);
  const galvTex = makeTextures(S, (i) => {
    const v = 168 + (spangle[i] - 0.5) * 34;
    return [v - 2, v + 2, v + 5];
  }, spangle, 0.6);

  // Bar grating (galvanised): bearing bars along v, cross rods along u.
  const gr = new Float32Array(128 * 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const bar = x % 16 < 3 ? 1 : 0;
      const rod = y % 32 < 3 ? 0.8 : 0;
      gr[y * 128 + x] = Math.max(bar, rod);
    }
  }
  const gratingTex = makeTextures(128, (i) => {
    const v = gr[i] > 0 ? 150 + gr[i] * 20 : 38;
    return [v, v + 2, v + 4];
  }, gr, 3);

  // Concrete: light, fine aggregate.
  const cn = fbm(S, r, [[6, 0.4], [32, 0.3], [128, 0.3]]);
  const concTex = makeTextures(S, (i) => {
    const speck = r() < 0.03 ? -22 : r() < 0.03 ? 14 : 0;
    const v = 150 + (cn[i] - 0.5) * 30 + speck;
    return [v, v - 2, v - 7];
  }, cn, 1.2);

  // Ribbed steel cladding (painted forest green), ribs along v.
  const rib = new Float32Array(S * S);
  const ribN = fbm(S, r, [[32, 1]]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = (x % 64) / 64;
      const prof = p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0;
      rib[y * S + x] = prof + ribN[y * S + x] * 0.03;
    }
  }
  const cladTex = makeTextures(S, (i) => {
    const v = rib[i];
    return [62 + v * 10, 78 + v * 10, 62 + v * 8];
  }, rib, 3);

  // Standing-seam roof (charcoal), seams along v.
  const seam = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = (x % 128) / 128;
      seam[y * S + x] = p < 0.04 ? 1 : 0;
    }
  }
  const roofTex = makeTextures(S, (i) => {
    const v = 56 + seam[i] * 14 + (ribN[i] - 0.5) * 6;
    return [v, v + 2, v + 4];
  }, seam, 2.5);

  // Burlap weave (sandbags).
  const bw = new Float32Array(128 * 128);
  const bn = fbm(128, r, [[8, 0.6], [32, 0.4]]);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const cx = x % 8;
      const cy = y % 8;
      const over = ((x >> 3) + (y >> 3)) % 2 === 0;
      const warp = Math.sin((cx / 8) * Math.PI);
      const weft = Math.sin((cy / 8) * Math.PI);
      bw[y * 128 + x] = (over ? warp * 0.7 + weft * 0.3 : weft * 0.7 + warp * 0.3) * 0.85 + bn[y * 128 + x] * 0.15;
    }
  }
  const burlapTex = makeTextures(128, (i) => {
    const v = bw[i];
    const n = (bn[i] - 0.5) * 30;
    return [clamp255(112 + v * 34 + n), clamp255(100 + v * 30 + n), clamp255(76 + v * 22 + n * 0.7)];
  }, bw, 2.2);

  // Timber grain (stakes).
  const wn = fbm(S, r, [[4, 0.5], [16, 0.5]]);
  const woodTex = makeTextures(S, (i, x, y) => {
    const g = Math.sin(x * 0.35 + wn[i] * 18) * 0.5 + 0.5;
    const v = 92 + g * 26 + (wn[i] - 0.5) * 20;
    return [v, v * 0.78, v * 0.55];
  }, wn, 1.5);

  // Dressed stone face: warm limestone with chisel marks.
  const sn = fbm(S, r, [[4, 0.35], [16, 0.35], [64, 0.2], [128, 0.1]]);
  const chisel = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      chisel[i] = sn[i] + Math.sin((x + y * 0.4) * 0.9 + sn[i] * 6) * 0.04;
    }
  }
  const stoneTex = makeTextures(S, (i) => {
    const v = 158 + (sn[i] - 0.5) * 80;
    const pit = r() < 0.012 ? -35 : 0;
    return [clamp255(v + pit), clamp255(v - 9 + pit), clamp255(v - 24 + pit)];
  }, chisel, 3);

  // Lime mortar.
  const mn = fbm(128, r, [[16, 0.5], [64, 0.5]]);
  const mortarTex = makeTextures(128, (i) => {
    const v = 112 + (mn[i] - 0.5) * 40;
    return [v, v - 5, v - 14];
  }, mn, 2);

  // Moss blotches (alpha tested).
  const mb = fbm(S, r, [[4, 0.5], [16, 0.3], [64, 0.2]]);
  const mossTex = makeTextures(S, (i, x, y) => {
    const dx = x / S - 0.5;
    const dy = y / S - 0.5;
    const fall = 1 - Math.hypot(dx, dy) * 2.2;
    const a = mb[i] * 0.9 + fall * 0.6 > 0.72 ? 255 : 0;
    const v = mb[i];
    return [40 + v * 40, 62 + v * 55, 24 + v * 20, a];
  }, mb, 2, true);

  // Ivy: scattered leaves on transparent canvas.
  const ivyCanvas = document.createElement('canvas');
  ivyCanvas.width = ivyCanvas.height = S;
  const ictx = ivyCanvas.getContext('2d');
  ictx.strokeStyle = 'rgb(70,58,40)';
  ictx.lineWidth = 2;
  for (let k = 0; k < 6; k++) {
    ictx.beginPath();
    let px = 30 + r() * 196;
    let py = 0;
    ictx.moveTo(px, py);
    while (py < S * (0.5 + r() * 0.5)) {
      px += (r() - 0.5) * 22;
      py += 12 + r() * 10;
      ictx.lineTo(px, py);
      for (let l = 0; l < 2; l++) {
        const lx = px + (r() - 0.5) * 26;
        const ly = py + (r() - 0.5) * 18;
        const s = 7 + r() * 7;
        const gch = 70 + r() * 50;
        ictx.fillStyle = `rgb(${30 + r() * 20},${gch},${25 + r() * 20})`;
        ictx.save();
        ictx.translate(lx, ly);
        ictx.rotate(r() * Math.PI * 2);
        ictx.beginPath();
        ictx.moveTo(0, -s);
        ictx.quadraticCurveTo(s, -s * 0.2, 0, s);
        ictx.quadraticCurveTo(-s, -s * 0.2, 0, -s);
        ictx.fill();
        ictx.restore();
      }
    }
    ictx.stroke();
  }
  const ivyTex = new THREE.CanvasTexture(ivyCanvas);
  ivyTex.colorSpace = THREE.SRGBColorSpace;

  // Dirt patch (alpha tested) under sandbags / rubble.
  const dn = fbm(S, r, [[4, 0.5], [16, 0.3], [64, 0.2]]);
  const dirtTex = makeTextures(S, (i, x, y) => {
    const fall = 1 - Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
    const a = dn[i] * 0.7 + fall * 0.8 > 0.62 ? 255 : 0;
    const v = 70 + (dn[i] - 0.5) * 40;
    return [v + 8, v - 2, v - 16, a];
  }, dn, 1.5, true);

  M = {
    galv: std({ color: 0xffffff, map: galvTex.map, normalMap: galvTex.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), metalness: 0.55, roughness: 0.42 }),
    galvDark: std({ color: 0x9a9fa3, map: galvTex.map, metalness: 0.5, roughness: 0.5 }),
    grating: std({ color: 0xffffff, map: gratingTex.map, normalMap: gratingTex.normalMap, metalness: 0.45, roughness: 0.55 }),
    concrete: std({ color: 0xffffff, map: concTex.map, normalMap: concTex.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 }),
    clad: std({ color: 0xffffff, map: cladTex.map, normalMap: cladTex.normalMap, metalness: 0.25, roughness: 0.55 }),
    frame: std({ color: 0x3b4044, metalness: 0.5, roughness: 0.4 }),
    trim: std({ color: 0xd9d8d2, metalness: 0.2, roughness: 0.5 }),
    roof: std({ color: 0xffffff, map: roofTex.map, normalMap: roofTex.normalMap, metalness: 0.45, roughness: 0.48, side: THREE.DoubleSide }),
    ceiling: std({ color: 0xc9c5ba, roughness: 0.85 }),
    glass: (() => {
      const g = new THREE.MeshPhysicalMaterial({ color: 0x9fb4bd, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
      g.userData.noWeathering = true;
      return g;
    })(),
    beacon: std({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 3.2, roughness: 0.3 }),
    white: std({ color: 0xe9e8e3, metalness: 0.1, roughness: 0.45 }),
    black: std({ color: 0x1d1f21, metalness: 0.2, roughness: 0.6 }),
    yellow: std({ color: 0xd8a924, metalness: 0.2, roughness: 0.5 }),
    burlap: [0xffffff, 0xe8e2d4, 0xd6d2c6].map((c) => std({ color: c, map: burlapTex.map, normalMap: burlapTex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.97 })),
    wood: std({ color: 0xffffff, map: woodTex.map, normalMap: woodTex.normalMap, roughness: 0.85 }),
    corrugated: std({ color: 0x8f9497, map: galvTex.map, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide }),
    stone: std({ color: 0xffffff, map: stoneTex.map, normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, vertexColors: true }),
    mortar: std({ color: 0xffffff, map: mortarTex.map, normalMap: mortarTex.normalMap, roughness: 0.97 }),
    moss: std({ color: 0xffffff, map: mossTex.map, normalMap: mossTex.normalMap, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }),
    mossCap: std({ color: 0x5d7436, map: mossTex.map, roughness: 1 }),
    ivy: std({ color: 0xffffff, map: ivyTex, alphaTest: 0.45, roughness: 0.8, side: THREE.DoubleSide }),
    dirt: std({ color: 0xffffff, map: dirtTex.map, alphaTest: 0.5, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }),
  };
  return M;
}

// --- Lookout / communications tower --------------------------------------------

const T_BASE = 4.2; // leg half-spacing at ground
const T_TOP = 2.6; // leg half-spacing at the cab floor
const CAB_Y = 20;
const DECK_Y = 10;
const hwAt = (y) => T_BASE + (T_TOP - T_BASE) * (y / CAB_Y);

// Straight guard rail (posts, top rail, knee rail, toe board) from p0 to p1.
function guardRail(parent, mat, x0, z0, x1, z1, y, { posts = true } = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(len / 1.5));
  if (posts) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      addBox(parent, mat, 0.05, 1.05, 0.05, mix(x0, x1, t), y + 0.525, mix(z0, z1, t), { cast: false });
    }
  }
  const a = V(x0, y + 1.05, z0);
  const b = V(x1, y + 1.05, z1);
  member(parent, mat, a, b, 0.05, 0.05, { cast: false });
  member(parent, mat, V(x0, y + 0.55, z0), V(x1, y + 0.55, z1), 0.035, 0.035, { cast: false });
  member(parent, mat, V(x0, y + 0.06, z0), V(x1, y + 0.06, z1), 0.12, 0.012, { cast: false, ref: _Y });
}

export function makeLookoutTower(x, z, collidables, walkableSurfaces) {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'lookout-tower';
  const col = (lx, lz, radius, minY, maxY) => {
    const c = { x: x + lx, z: z + lz, radius };
    if (minY !== undefined) c.minY = minY;
    if (maxY !== undefined) c.maxY = maxY;
    collidables.push(c);
  };
  const rect = (x0, x1, z0, z1, y) => walkableSurfaces.push({ type: 'rect', x: x + (x0 + x1) / 2, z: z + (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, y });
  const colLine = (x0, z0, x1, z1, radius, spacing, minY, maxY) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) col(mix(x0, x1, i / n), mix(z0, z1, i / n), radius, minY, maxY);
  };

  // ---- Footings: concrete piers with base plates and anchor bolts.
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const boltGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6);
  for (const [sx, sz] of corners) {
    const px = sx * T_BASE;
    const pz = sz * T_BASE;
    addBox(g, m.concrete, 1.2, 0.8, 1.2, px, 0.25, pz, { tile: 1.2 });
    addBox(g, m.concrete, 1.0, 0.08, 1.0, px, 0.67, pz, { tile: 1.2 }); // chamfer cap
    addBox(g, m.galvDark, 0.55, 0.035, 0.55, px, 0.725, pz, { cast: false });
    for (const [bx, bz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const b = new THREE.Mesh(boltGeo, m.galvDark);
      b.position.set(px + bx * 0.2, 0.77, pz + bz * 0.2);
      g.add(b);
    }
    col(px, pz, 0.75, undefined, 0.71);
  }
  // Concrete apron at the stair entrance.
  addBox(g, m.concrete, 3.0, 0.1, 2.2, 0, 0.0, -3.0, { tile: 1.5 });

  // ---- Legs (angle sections) and lattice bracing.
  const legPt = (sx, sz, y) => V(sx * hwAt(y), y, sz * hwAt(y));
  for (const [sx, sz] of corners) {
    const a = legPt(sx, sz, 0.74);
    const b = legPt(sx, sz, CAB_Y - 0.05);
    member(g, m.galv, a, b, 0.025, 0.26, { ox: 0, oz: -sz * 0.12 });
    member(g, m.galv, a, b, 0.26, 0.025, { ox: -sx * 0.12, oz: 0 });
    // Leg collision in 5 m bands (legs taper inwards).
    for (let y0 = 0; y0 < CAB_Y; y0 += 5) {
      const hw = hwAt(y0 + 2.5);
      col(sx * hw, sz * hw, 0.3, y0 === 0 ? undefined : y0, y0 + 5);
    }
  }
  const levels = [0.74, 5, DECK_Y, 15, CAB_Y - 0.05];
  // Faces: list leg corner pairs.
  const faces = [
    { a: [-1, -1], b: [1, -1], name: 's' },
    { a: [1, -1], b: [1, 1], name: 'e' },
    { a: [1, 1], b: [-1, 1], name: 'n' },
    { a: [-1, 1], b: [-1, -1], name: 'w' },
  ];
  for (const f of faces) {
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i];
      const big = y === DECK_Y || i === levels.length - 1;
      if (!(f.name === 's' && i === 0)) {
        member(g, big ? m.galvDark : m.galv, legPt(...f.a, y), legPt(...f.b, y), big ? 0.22 : 0.08, big ? 0.1 : 0.08, { ref: _Y });
      }
      // Gusset plates at the leg nodes.
      if (i > 0 && i < levels.length - 1) {
        for (const c of [f.a, f.b]) {
          const p = legPt(...c, y);
          const n = f.name === 's' || f.name === 'n' ? 'z' : 'x';
          const toward = legPt(...(c === f.a ? f.b : f.a), y).sub(p).normalize().multiplyScalar(0.2);
          addBox(g, m.galvDark, n === 'x' ? 0.015 : 0.42, 0.42, n === 'x' ? 0.42 : 0.015, p.x + toward.x, y, p.z + toward.z, { cast: false });
        }
      }
      if (i === levels.length - 1) break;
      const y1 = levels[i + 1];
      if (f.name === 's' && i === 0) {
        // Stair portal: no diagonals at the entrance, a stiff portal beam
        // and knee braces instead.
        const pb = 2.6;
        member(g, m.galvDark, legPt(...f.a, pb), legPt(...f.b, pb), 0.22, 0.1, { ref: _Y });
        member(g, m.galv, legPt(...f.a, pb - 1.2), legPt(...f.a, pb).lerp(legPt(...f.b, pb), 0.18), 0.08, 0.08);
        member(g, m.galv, legPt(...f.b, pb - 1.2), legPt(...f.b, pb).lerp(legPt(...f.a, pb), 0.18), 0.08, 0.08);
        member(g, m.galv, legPt(...f.a, pb), legPt(...f.b, y1), 0.08, 0.08);
        member(g, m.galv, legPt(...f.b, pb), legPt(...f.a, y1), 0.08, 0.08);
        continue;
      }
      member(g, m.galv, legPt(...f.a, y), legPt(...f.b, y1), 0.08, 0.08);
      member(g, m.galv, legPt(...f.b, y), legPt(...f.a, y1), 0.075, 0.075);
      const ym = (y + y1) / 2;
      member(g, m.galv, legPt(...f.a, ym), legPt(...f.b, ym), 0.06, 0.06, { ref: _Y });
    }
  }

  // ---- Stair core: switchback steel stairs inside the tower.
  // Flights run along Z between z=-1.3 and z=+1.3; landings beyond.
  const CX = 1.3; // core half-width
  const CZ = 2.55; // core half-length (to landing ends)
  const LZ = 1.3; // flight ends
  const RISE = 2.5;
  const STEPS = 12;
  const FW = 1.2;
  // Core corner columns.
  for (const [sx, sz] of corners) {
    member(g, m.galvDark, V(sx * CX, 0.05, sz * CZ), V(sx * CX, CAB_Y + 1.1, sz * CZ), 0.12, 0.12);
  }
  const nFlights = Math.round(CAB_Y / RISE);
  for (let k = 0; k < nFlights; k++) {
    const y0 = k * RISE;
    const y1 = y0 + RISE;
    const up = k % 2 === 0; // even flights climb south -> north on the east half
    const xc = up ? 0.65 : -0.65;
    const zLow = up ? -LZ : LZ;
    const zHigh = up ? LZ : -LZ;
    const dz = Math.sign(zHigh - zLow);
    const run = Math.abs(zHigh - zLow);
    walkableSurfaces.push({ type: 'ramp', x1: x + xc, z1: z + zLow, x2: x + xc, z2: z + zHigh, width: FW, y1: y0, y2: y1, steps: STEPS });
    // Treads (grating with a yellow nosing).
    for (let s = 1; s <= STEPS; s++) {
      const za = zLow + dz * ((s - 1) / STEPS) * run;
      const zb = zLow + dz * (s / STEPS) * run;
      const ty = y0 + (s * RISE) / STEPS;
      addBox(g, m.grating, FW - 0.08, 0.04, Math.abs(zb - za) + 0.03, xc, ty - 0.02, (za + zb) / 2, { tile: 0.5, cast: false });
      addBox(g, m.yellow, FW - 0.08, 0.042, 0.03, xc, ty - 0.02, za + dz * 0.015, { cast: false });
    }
    // Stringers (channels) and handrails.
    for (const side of [-1, 1]) {
      const sxp = xc + side * (FW / 2 - 0.02);
      member(g, m.galvDark, V(sxp, y0 - 0.12, zLow - dz * 0.05), V(sxp, y1 - 0.12, zHigh + dz * 0.05), 0.04, 0.24, { ref: _X });
      const ra = V(sxp, y0 + 0.95, zLow);
      const rb = V(sxp, y1 + 0.95, zHigh);
      member(g, m.galv, ra, rb, 0.045, 0.045, { cast: false });
      member(g, m.galv, V(sxp, y0 + 0.5, zLow), V(sxp, y1 + 0.5, zHigh), 0.03, 0.03, { cast: false });
      for (const t of [0.05, 0.5, 0.95]) {
        const pz = mix(zLow, zHigh, t);
        const py = mix(y0, y1, t);
        addBox(g, m.galv, 0.045, 0.95, 0.045, sxp, py + 0.475, pz, { cast: false });
      }
    }
    // Landing at the top of this flight (intermediate ones only; the deck
    // and cab floor serve as landings at 10 m and 20 m).
    const north = zHigh > 0;
    const lz0 = north ? LZ : -CZ;
    const lz1 = north ? CZ : -LZ;
    if (y1 !== DECK_Y && y1 !== CAB_Y) {
      rect(-CX, CX, lz0, lz1, y1);
      addBox(g, m.grating, CX * 2, 0.05, lz1 - lz0, 0, y1 - 0.025, (lz0 + lz1) / 2, { tile: 0.5 });
      addBox(g, m.galvDark, CX * 2, 0.16, 0.08, 0, y1 - 0.13, north ? CZ : -CZ);
      addBox(g, m.galvDark, CX * 2, 0.16, 0.08, 0, y1 - 0.13, north ? LZ : -LZ);
      // Landing guard rails (end + both sides).
      const ze = north ? CZ : -CZ;
      guardRail(g, m.galv, -CX, ze, CX, ze, y1);
      guardRail(g, m.galv, -CX, lz0, -CX, lz1, y1, { posts: false });
      guardRail(g, m.galv, CX, lz0, CX, lz1, y1, { posts: false });
      // Ties from the landing to the tower legs at 5 m / 15 m.
      if (Math.abs(y1 - 5) < 0.01 || Math.abs(y1 - 15) < 0.01) {
        for (const [sx, sz] of corners) member(g, m.galv, V(sx * CX, y1 - 0.1, sz * CZ), legPt(sx, sz, y1 - 0.1), 0.08, 0.08, { ref: _Y });
      }
    }
  }
  // Core collision. Side walls along the flights (full height), centre
  // divider between the two flights, north end wall.
  const top = CAB_Y + 1.15;
  colLine(-CX, -LZ, -CX, CZ, 0.08, 0.45, 0.3, top);
  colLine(CX, -LZ, CX, CZ, 0.08, 0.45, 0.3, top);
  colLine(0, -LZ + 0.15, 0, LZ, 0.08, 0.45, 0.3, top);
  colLine(-CX, CZ, CX, CZ, 0.08, 0.45, 0.3, top);
  // South landings: walls except at the ground entry, the 10 m deck and
  // the 20 m cab (y ranges chosen so players standing on those levels pass).
  for (const sx of [-1, 1]) {
    colLine(sx * CX, -CZ, sx * CX, -LZ - 0.2, 0.08, 0.45, 0.3, DECK_Y);
    colLine(sx * CX, -CZ, sx * CX, -LZ - 0.2, 0.08, 0.45, DECK_Y + 1.9, CAB_Y);
  }
  colLine(-CX, -CZ, CX, -CZ, 0.08, 0.45, 1.9, DECK_Y);
  colLine(-CX, -CZ, CX, -CZ, 0.08, 0.45, DECK_Y + 1.9, CAB_Y);
  // At the cab the up-flight below is open: guard the hatch edge.
  colLine(0.1, -LZ, CX, -LZ, 0.08, 0.4, CAB_Y, top);
  guardRail(g, m.galv, 0, -LZ, CX, -LZ, CAB_Y);
  // Hatch guard rails around the stairwell at deck and cab levels.
  for (const yy of [DECK_Y, CAB_Y]) {
    guardRail(g, m.galv, -CX, -LZ, -CX, CZ, yy);
    guardRail(g, m.galv, CX, yy === DECK_Y ? -LZ : -LZ, CX, CZ, yy);
    guardRail(g, m.galv, -CX, CZ, CX, CZ, yy);
  }

  // ---- Mid platform at 10 m: grating deck inside the legs.
  const D = 3.25;
  const deckParts = [
    [-D, -CX, -D, D],
    [CX, D, -D, D],
    [-CX, CX, -D, -LZ],
    [-CX, CX, CZ, D],
  ];
  for (const [x0, x1, z0, z1] of deckParts) {
    rect(x0, x1, z0, z1, DECK_Y);
    addBox(g, m.grating, x1 - x0, 0.05, z1 - z0, (x0 + x1) / 2, DECK_Y - 0.025, (z0 + z1) / 2, { tile: 0.5 });
  }
  // Deck joists.
  for (const zz of [-2.2, 0, 2.2]) for (const s of [-1, 1]) addBox(g, m.galvDark, D - CX, 0.18, 0.1, s * (D + CX) / 2, DECK_Y - 0.14, zz);
  for (const s of [-1, 1]) {
    guardRail(g, m.galv, -D, s * D, D, s * D, DECK_Y);
    guardRail(g, m.galv, s * D, -D, s * D, D, DECK_Y);
    colLine(-D, s * D, D, s * D, 0.08, 0.5, DECK_Y, DECK_Y + 1.15);
    colLine(s * D, -D, s * D, D, 0.08, 0.5, DECK_Y, DECK_Y + 1.15);
  }

  // ---- Lookout cab at 20 m with a wrap-around catwalk.
  const C = 2.9; // cab wall half-size
  const W = 4.1; // catwalk half-size
  const cabParts = [
    [-W, -CX, -W, W],
    [CX, W, -W, W],
    [-CX, CX, -W, -LZ],
    [-CX, CX, CZ, W],
  ];
  for (const [x0, x1, z0, z1] of cabParts) {
    rect(x0, x1, z0, z1, CAB_Y);
    addBox(g, m.grating, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, CAB_Y - 0.03, (z0 + z1) / 2, { tile: 0.5 });
  }
  // Floor framing + edge channel + knee braces from the legs to the catwalk.
  for (const s of [-1, 1]) {
    addBox(g, m.galvDark, 2 * W, 0.22, 0.12, 0, CAB_Y - 0.17, s * W);
    addBox(g, m.galvDark, 0.12, 0.22, 2 * W, s * W, CAB_Y - 0.17, 0);
    addBox(g, m.galvDark, 2 * W, 0.22, 0.1, 0, CAB_Y - 0.17, s * T_TOP);
    addBox(g, m.galvDark, 0.1, 0.22, 2 * W, s * T_TOP, CAB_Y - 0.17, 0);
  }
  for (const [sx, sz] of corners) {
    const base = legPt(sx, sz, CAB_Y - 2.4);
    member(g, m.galv, base, V(sx * W, CAB_Y - 0.25, sz * T_TOP), 0.09, 0.09);
    member(g, m.galv, base, V(sx * T_TOP, CAB_Y - 0.25, sz * W), 0.09, 0.09);
  }
  for (const s of [-1, 1]) {
    guardRail(g, m.galv, -W, s * W, W, s * W, CAB_Y);
    guardRail(g, m.galv, s * W, -W, s * W, W, CAB_Y);
    colLine(-W, s * W, W, s * W, 0.08, 0.5, CAB_Y, CAB_Y + 1.15);
    colLine(s * W, -W, s * W, W, 0.08, 0.5, CAB_Y, CAB_Y + 1.15);
  }

  // Cab walls: 1 m ribbed lower panel, continuous window band, header.
  const SILL = CAB_Y + 1.0;
  const HEAD = CAB_Y + 2.3;
  const EAVE = CAB_Y + 2.6;
  const DOOR = 0.55; // door half-width (east wall, centred)
  const glassGeos = [];
  const pane = (w, h, cx, cy, cz, ry) => {
    const p = new THREE.PlaneGeometry(w, h);
    p.rotateY(ry);
    p.translate(cx, cy, cz);
    glassGeos.push(p);
  };
  // Each wall described along its tangent u in [-C, C]; normal side s.
  const wallDefs = [
    { axis: 'z', s: -1 }, // south wall at z=-C, runs along x
    { axis: 'z', s: 1 },
    { axis: 'x', s: -1 }, // west wall at x=-C, runs along z
    { axis: 'x', s: 1, door: true }, // east wall with door
  ];
  for (const wd of wallDefs) {
    const along = (u, y, d = 0) => (wd.axis === 'z' ? [u, y, wd.s * (C + d)] : [wd.s * (C + d), y, u]);
    const box = (len, h, thick, u, y, d = 0, mat = m.clad) => {
      const [px, py, pz] = along(u, y, d);
      if (wd.axis === 'z') addBox(g, mat, len, h, thick, px, py, pz, { tile: 1 });
      else addBox(g, mat, thick, h, len, px, py, pz, { tile: 1 });
    };
    const segs = wd.door ? [[-C, -DOOR], [DOOR, C]] : [[-C, C]];
    for (const [u0, u1] of segs) {
      box(u1 - u0, SILL - CAB_Y, 0.1, (u0 + u1) / 2, (CAB_Y + SILL) / 2);
      box(u1 - u0 + 0.04, 0.06, 0.24, (u0 + u1) / 2, SILL + 0.03, 0, m.trim); // sill
      // Glazing between mullions.
      const n = Math.max(1, Math.round((u1 - u0) / 1.4));
      for (let i = 0; i < n; i++) {
        const a = mix(u0, u1, i / n);
        const b = mix(u0, u1, (i + 1) / n);
        const [px, , pz] = along((a + b) / 2, 0);
        pane(b - a - 0.06, HEAD - SILL - 0.06, px, (SILL + HEAD) / 2 + 0.03, pz, wd.axis === 'z' ? 0 : Math.PI / 2);
        box(0.07, HEAD - SILL, 0.12, a, (SILL + HEAD) / 2 + 0.03, 0, m.frame);
      }
      box(0.07, HEAD - SILL, 0.12, u1, (SILL + HEAD) / 2 + 0.03, 0, m.frame);
      // Horizontal transom (opening vent line).
      box(u1 - u0, 0.05, 0.1, (u0 + u1) / 2, HEAD - 0.42, 0, m.frame);
    }
    // Header band over full length (above the door too).
    box(2 * C + 0.1, EAVE - HEAD, 0.12, 0, (HEAD + EAVE) / 2, 0, m.clad);
    box(2 * C + 0.1, 0.05, 0.13, 0, HEAD + 0.025, 0, m.frame);
    if (wd.door) {
      // Door frame and an open door leaf swung back against the wall.
      box(0.08, HEAD - CAB_Y, 0.14, -DOOR, (CAB_Y + HEAD) / 2, 0, m.frame);
      box(0.08, HEAD - CAB_Y, 0.14, DOOR, (CAB_Y + HEAD) / 2, 0, m.frame);
      box(2 * DOOR, 0.3, 0.12, 0, HEAD - 0.15 + 0.0, 0, m.clad);
      const leaf = new THREE.Group();
      addBox(leaf, m.clad, 0.05, 1.0, 1.0, 0, 0.55, 0.5);
      for (const [hh, yy] of [[0.05, 1.075], [0.05, 2.0]]) addBox(leaf, m.frame, 0.06, hh, 1.0, 0, yy, 0.5);
      for (const zz of [0.025, 0.975]) addBox(leaf, m.frame, 0.06, 0.95, 0.05, 0, 1.55, zz);
      addBox(leaf, m.frame, 0.07, 0.04, 0.12, 0.05, 1.0, 0.85);
      leaf.position.set(C + 0.08, CAB_Y, DOOR);
      g.add(leaf);
      pane(0.9, 0.88, C + 0.08, CAB_Y + 1.54, DOOR + 0.5, Math.PI / 2);
    }
    // Collision: walls with a door gap on the east side.
    if (wd.door) {
      colLine(C, -C, C, -DOOR - 0.15, 0.15, 0.35, CAB_Y, EAVE);
      colLine(C, DOOR + 0.15, C, C, 0.15, 0.35, CAB_Y, EAVE);
    } else if (wd.axis === 'z') {
      colLine(-C, wd.s * C, C, wd.s * C, 0.15, 0.35, CAB_Y, EAVE);
    } else {
      colLine(wd.s * C, -C, wd.s * C, C, 0.15, 0.35, CAB_Y, EAVE);
    }
  }
  // Corner posts.
  for (const [sx, sz] of corners) addBox(g, m.frame, 0.14, EAVE - CAB_Y, 0.14, sx * C, (CAB_Y + EAVE) / 2, sz * C);
  // Ceiling, fascia, gutters and hipped standing-seam roof.
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * C, 2 * C), m.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = EAVE - 0.02;
  g.add(ceil);
  const R = 3.55;
  const roofGeo = new THREE.ConeGeometry(R * Math.SQRT2, 1.0, 4, 1, false, Math.PI / 4);
  const uv = roofGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 2);
  const roof = new THREE.Mesh(roofGeo, m.roof);
  roof.position.y = EAVE + 0.15 + 0.5;
  roof.castShadow = true;
  g.add(roof);
  for (const s of [-1, 1]) {
    addBox(g, m.trim, 2 * R + 0.06, 0.2, 0.05, 0, EAVE + 0.1, s * R);
    addBox(g, m.trim, 0.05, 0.2, 2 * R + 0.06, s * R, EAVE + 0.1, 0);
    addBox(g, m.frame, 2 * R + 0.1, 0.08, 0.1, 0, EAVE + 0.02, s * (R + 0.06));
    addBox(g, m.frame, 0.1, 0.08, 2 * R + 0.1, s * (R + 0.06), EAVE + 0.02, 0);
  }
  // Downpipes at two corners.
  for (const [sx, sz] of [[1, 1], [-1, -1]]) {
    addBox(g, m.frame, 0.07, EAVE - CAB_Y, 0.07, sx * (R - 0.1), (CAB_Y + EAVE) / 2, sz * (R + 0.06), { cast: false });
  }
  // Fire-finder pedestal and map table in the north-west corner.
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 10), m.frame);
  ped.position.set(-2.1, CAB_Y + 0.5, 2.1);
  g.add(ped);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), m.galv);
  disc.position.set(-2.1, CAB_Y + 1.03, 2.1);
  g.add(disc);
  col(-2.1, 2.1, 0.45, CAB_Y, CAB_Y + 1.1);

  // ---- Antenna mast with dish, panel antennas and red aviation beacon.
  const mBase = EAVE + 0.6;
  const mTop = CAB_Y + 10.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, mTop - mBase, 10), m.galv);
  mast.position.y = (mBase + mTop) / 2;
  mast.castShadow = true;
  g.add(mast);
  for (const yy of [mBase + 2.2, mBase + 4.5]) {
    addBox(g, m.galv, 1.6, 0.05, 0.05, 0, yy, 0, { cast: false });
    for (const s of [-1, 1]) {
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 1.6, 5), m.white);
      whip.position.set(s * 0.78, yy + 0.8, 0);
      g.add(whip);
    }
  }
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const p = new THREE.Group();
    addBox(p, m.white, 0.28, 1.3, 0.1, 0, 0, 0.25);
    addBox(p, m.galv, 0.05, 0.05, 0.22, 0, 0.4, 0.11, { cast: false });
    addBox(p, m.galv, 0.05, 0.05, 0.22, 0, -0.4, 0.11, { cast: false });
    p.position.y = mBase + 1.1;
    p.rotation.y = a;
    g.add(p);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), m.white);
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, mBase + 3.4, -0.75);
  g.add(dish);
  addBox(g, m.galv, 0.05, 0.05, 0.6, 0, mBase + 3.4, -0.35, { cast: false });
  const bHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), m.black);
  bHouse.position.y = mTop + 0.05;
  g.add(bHouse);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.beacon);
  lamp.position.y = mTop + 0.1;
  g.add(lamp);
  // Obstruction lamps on the roof corners.
  for (const [sx, sz] of corners) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), m.beacon);
    l.position.set(sx * (R - 0.05), EAVE + 0.27, sz * (R - 0.05));
    g.add(l);
  }

  // Merged glass (one transparent draw call).
  const glass = new THREE.Mesh(mergeGeometries(glassGeos, false), m.glass);
  glass.renderOrder = 2;
  g.add(glass);

  g.position.set(x, 0, z);
  return g;
}

// --- Sandbag fighting position ---------------------------------------------------

const BAG_L = 0.62;
const BAG_W = 0.34;
const BAG_H = 0.17;
let bagGeos = null;
function sandbagGeometries() {
  if (bagGeos) return bagGeos;
  bagGeos = [];
  for (let v = 0; v < 4; v++) {
    const r = rng(91 + v * 17);
    const geo = new THREE.SphereGeometry(1, 12, 7);
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    const lump = [r(), r(), r(), r()].map((k) => (k - 0.5) * 0.25);
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i);
      const ny = p.getY(i);
      const nz = p.getZ(i);
      let px = Math.sign(nx) * Math.pow(Math.abs(nx), 0.32) * (BAG_L / 2);
      let py = Math.sign(ny) * Math.pow(Math.abs(ny), 0.7) * (BAG_H / 2);
      let pz = Math.sign(nz) * Math.pow(Math.abs(nz), 0.38) * (BAG_W / 2);
      const u = px / (BAG_L / 2);
      // Tied / folded end: pinch the +x end.
      if (u > 0.7) {
        const k = 1 - ((u - 0.7) / 0.3) * 0.35;
        py *= k;
        pz *= mix(1, k, 0.6);
      }
      // Flatten the underside so bags bed onto each other; settle the top.
      if (py < 0) py *= 0.55;
      else py *= 1 + lump[0] * Math.cos(u * 3) + lump[1] * (pz / (BAG_W / 2));
      px *= 1 + lump[2] * 0.08;
      pz *= 1 + lump[3] * 0.1 * Math.sin(u * 2.5);
      p.setXYZ(i, px, py, pz);
      uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 2.5);
    }
    geo.computeVertexNormals();
    bagGeos.push(geo);
  }
  return bagGeos;
}

export function makeSandbagBarricade(x, z, angle, collidables) {
  const m = materials();
  const geos = sandbagGeometries();
  const g = new THREE.Group();
  g.name = 'sandbags';
  const r = rng(Math.floor((x * 73.1 + z * 19.7) * 10) >>> 0);
  const LEN = 4.0;
  const ARC_R = 9; // gentle curve, ends swept forward (-z is the enemy side)
  const arcZ = (u) => -(u * u) / (2 * ARC_R);
  const arcYaw = (u) => Math.atan(u / ARC_R);
  const COURSE = 0.145;
  // Rows per course (z offsets, front = negative z). Battered front face.
  const rows = [
    [-0.36, 0, 0.36],
    [-0.34, 0.02, 0.36],
    [-0.27, 0.08],
    [-0.25, 0.1],
    [-0.2, 0.14],
    [-0.15, 0.18],
    [-0.1],
  ];
  let topY = 0;
  rows.forEach((zs, c) => {
    const y = c * COURSE + BAG_H * 0.28;
    topY = y + BAG_H * 0.55;
    const odd = c % 2 === 1;
    const n = odd ? 6 : 7;
    const start = odd ? -(n - 1) * 0.3 : -(n - 1) * 0.3;
    zs.forEach((rz, ri) => {
      for (let i = 0; i < n; i++) {
        let u = start + i * 0.6 + (ri % 2 ? 0.08 : 0);
        u += (r() - 0.5) * 0.04;
        if (Math.abs(u) > LEN / 2 - 0.12 - 0.07 * Math.max(0, c - 1)) continue;
        const bag = new THREE.Mesh(geos[Math.floor(r() * geos.length)], m.burlap[Math.floor(r() * 3)]);
        const yaw = arcYaw(u);
        bag.position.set(u + Math.sin(yaw) * rz, y + (r() - 0.5) * 0.015, arcZ(u) + Math.cos(yaw) * rz + (r() - 0.5) * 0.03);
        bag.rotation.set((r() - 0.5) * 0.06, yaw + (r() - 0.5) * 0.08 + (r() < 0.5 ? Math.PI : 0), (r() - 0.5) * 0.06);
        bag.castShadow = true;
        bag.receiveShadow = true;
        g.add(bag);
      }
    });
  });
  // Timber pickets on the friendly side with a short corrugated revetment
  // sheet, plus a tie wire rail.
  const stakes = [-1.55, -0.1, 1.35];
  for (const u of stakes) {
    const yaw = arcYaw(u);
    const sz = arcZ(u) + 0.62;
    addBox(g, m.wood, 0.08, 1.15, 0.08, u + Math.sin(yaw) * 0.62, 0.52, sz, { ry: yaw, tile: 0.5 });
  }
  // Corrugated sheet (sine profile) between the two left pickets.
  const sheetW = 1.4;
  const sheetH = 0.75;
  const sg = new THREE.PlaneGeometry(sheetW, sheetH, 28, 1);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin((sp.getX(i) / 0.076) * Math.PI) * 0.018);
  sg.computeVertexNormals();
  const sheet = new THREE.Mesh(sg, m.corrugated);
  const su = -0.83;
  sheet.position.set(su, sheetH / 2 + 0.02, arcZ(su) + 0.56);
  sheet.rotation.set(-0.08, arcYaw(su), 0);
  sheet.castShadow = true;
  g.add(sheet);
  // Trampled dirt underneath.
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(LEN + 1.4, 2.4), m.dirt);
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, 0.012, -0.15);
  dirt.receiveShadow = true;
  g.add(dirt);

  g.rotation.y = angle;
  g.position.set(x, 0, z);

  const W = toWorld(x, z, angle);
  for (let u = -LEN / 2 + 0.3; u <= LEN / 2 - 0.3 + 1e-6; u += 0.5) {
    const p = W(u, arcZ(u) + 0.02);
    collidables.push({ x: p.x, z: p.z, radius: 0.5, maxY: topY });
  }
  return g;
}

// --- Ruined stone chapel wall ----------------------------------------------------

export function makeStoneRuin(x, z, angle, collidables) {
  const m = materials();
  const g = new THREE.Group();
  g.name = 'stone-ruin';
  const r = rng(Math.floor(Math.abs(x * 31.7 + z * 7.3) * 10) + 5);
  const W = toWorld(x, z, angle);
  const COURSE = 0.34;
  const T = 0.62; // wall thickness
  const JOINT = 0.04;
  const stoneGeos = [];
  const mortarGeos = [];
  const tops = []; // block tops for moss

  const tint = new THREE.Color();
  // Adds a dressed block (centre, size) with per-block tint + UV offset.
  const block = (cx, cy, cz, sx, sy, sz, rot = null) => {
    const geo = boxGeo(sx, sy, sz, 0.9);
    const uv = geo.attributes.uv;
    const ou = r();
    const ov = r();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + ou, uv.getY(i) + ov);
    const k = 0.7 + r() * 0.32;
    const warm = r();
    tint.setRGB(k * (0.98 + warm * 0.04), k * (0.95 + r() * 0.04), k * (0.86 + (1 - warm) * 0.1));
    const cols = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      cols[i * 3] = tint.r;
      cols[i * 3 + 1] = tint.g;
      cols[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
    geo.translate(cx, cy, cz);
    stoneGeos.push(geo);
  };
  const mortar = (cx, cy, cz, sx, sy, sz) => {
    const geo = boxGeo(sx, sy, sz, 0.8);
    geo.translate(cx, cy, cz);
    mortarGeos.push(geo);
  };

  // Build a wall along a local axis. `heightAt(u)` gives the broken top;
  // `opening(u, y)` returns true for voids (window/door).
  const wall = ({ u0, u1, axis, at, heightAt, opening = () => false, breaks = [], seed = 0 }) => {
    const cols = []; // for collision
    const nC = Math.ceil(Math.max(...Array.from({ length: 40 }, (_, i) => heightAt(mix(u0, u1, i / 39)))) / COURSE);
    for (let c = 0; c < nC; c++) {
      const y0 = c * COURSE;
      const yc = y0 + COURSE / 2;
      // Block joints for this course (staggered), forced at opening jambs.
      const cuts = [u0];
      let u = u0 + (c % 2 ? 0.25 + r() * 0.2 : 0.45 + r() * 0.3);
      while (u < u1 - 0.2) {
        cuts.push(u);
        u += 0.45 + r() * 0.4;
      }
      for (const b of breaks) if (b > u0 && b < u1) cuts.push(b);
      cuts.push(u1);
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        if (b - a < 0.12) continue;
        const um = (a + b) / 2;
        const h = heightAt(um) + (r() - 0.5) * 0.25;
        if (yc > h) continue;
        if (opening(um, yc)) continue;
        // Occasional missing face stone on upper courses.
        if (c > 2 && r() < 0.03) continue;
        const pos = axis === 'x' ? [um, yc, at] : [at, yc, um];
        const size = axis === 'x' ? [b - a - JOINT, COURSE - JOINT, T + (r() - 0.5) * 0.03] : [T + (r() - 0.5) * 0.03, COURSE - JOINT, b - a - JOINT];
        block(pos[0] + (axis === 'z' ? (r() - 0.5) * 0.02 : 0), pos[1], pos[2] + (axis === 'x' ? (r() - 0.5) * 0.02 : 0), ...size);
        const msize = axis === 'x' ? [b - a, COURSE, T - 0.06] : [T - 0.06, COURSE, b - a];
        mortar(pos[0], pos[1], pos[2], ...msize);
        tops.push({ pos, size, top: y0 + COURSE, c, axis });
      }
    }
    for (let u = u0 + 0.3; u <= u1 - 0.2; u += 0.55) cols.push(u);
    for (const u of cols) {
      const p = axis === 'x' ? W(u, at) : W(at, u);
      collidables.push({ x: p.x, z: p.z, radius: 0.38, maxY: Math.max(0.3, heightAt(u) - 0.1) });
    }
    void seed;
  };

  // Back (east-west) wall with a broken arched window.
  const AX = 0.6; // arch centre
  const AR = 0.62; // arch radius (clear opening half-width)
  const SPRING = 2.45;
  const SILL = 1.0;
  const backH = (u) => {
    // Gable-ish remnant around the window, collapsing towards both ends.
    const peak = 4.4 - Math.abs(u - 0.7) * 0.35;
    const left = u < -1.6 ? mix(2.2, 3.6, (u + 4) / 2.4) : 99;
    const right = u > 2.1 ? mix(3.6, 1.0, (u - 2.1) / 1.9) : 99;
    return Math.min(peak, left, right);
  };
  const archOuter = AR + 0.36;
  const backOpening = (u, y) => {
    if (Math.abs(u - AX) < AR && y > SILL && y < SPRING) return true;
    if (y >= SPRING - 0.01 && Math.hypot(u - AX, y - SPRING) < archOuter + 0.02) return true;
    return false;
  };
  wall({ u0: -4, u1: 4, axis: 'x', at: -1.65, heightAt: backH, opening: backOpening, breaks: [AX - AR, AX + AR, AX - archOuter, AX + archOuter] });
  // Arch ring (voussoirs) and the mortar spandrel behind it.
  const nV = 9;
  for (let i = 0; i < nV; i++) {
    const a0 = (i / nV) * Math.PI;
    const a1 = ((i + 1) / nV) * Math.PI;
    const am = (a0 + a1) / 2;
    const rm = (AR + archOuter) / 2;
    const len = (archOuter - AR) - JOINT;
    const wid = rm * (a1 - a0) - JOINT;
    if (i === nV - 1) continue; // keystone side broken away
    block(AX + Math.cos(am) * rm, SPRING + Math.sin(am) * rm, -1.65, len, wid, T + 0.04, new THREE.Euler(0, 0, am));
  }
  {
    const sh = new THREE.Shape();
    const L = AX - archOuter - 0.05;
    const Rr = AX + archOuter + 0.05;
    sh.moveTo(L, SPRING);
    sh.lineTo(L, SPRING + archOuter + 0.25);
    sh.lineTo(Rr, SPRING + archOuter + 0.25);
    sh.lineTo(Rr, SPRING);
    sh.absarc(AX, SPRING, AR + 0.01, 0, Math.PI, false);
    sh.lineTo(L, SPRING);
    const eg = new THREE.ExtrudeGeometry(sh, { depth: T - 0.06, bevelEnabled: false, curveSegments: 16 });
    eg.translate(0, 0, -1.65 - (T - 0.06) / 2);
    const uv = eg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.8, uv.getY(i) / 0.8);
    mortarGeos.push(eg);
  }
  // Projecting sill and jamb dressing for the window.
  block(AX, SILL - 0.06, -1.65 + 0.03, 2 * AR + 0.3, 0.12, T + 0.14);

  // West side wall (runs along z), tall at the back corner, broken low.
  wall({ u0: -1.35, u1: 1.9, axis: 'z', at: -3.69, heightAt: (u) => mix(3.0, 0.7, (u + 1.35) / 3.25) - (u > 0.2 && u < 0.9 ? 0.6 : 0) });
  // Front remnant with a doorway, east end just a foundation course.
  wall({ u0: -4, u1: -1.1, axis: 'x', at: 1.9, heightAt: (u) => mix(1.3, 0.55, (u + 4) / 2.9) });
  wall({ u0: 0.6, u1: 4, axis: 'x', at: 1.9, heightAt: (u) => (u < 1.6 ? 0.75 : 0.36) });
  wall({ u0: -1.35, u1: 1.6, axis: 'z', at: 3.69, heightAt: (u) => (u < -0.6 ? 0.8 : 0.36) });
  // Plinth course (projecting base) under the back wall.
  for (let u = -3.8; u < 3.9; u += 0.8) block(u + 0.38, 0.08, -1.65, 0.78, 0.16, T + 0.16);

  // Fallen blocks and rubble, mostly in front of / beside the back wall.
  const fallen = [
    [1.6, -0.6, 0.62, 0.34, 0.6, true],
    [2.3, -0.2, 0.7, 0.34, 0.6, true],
    [2.0, -0.9, 0.5, 0.3, 0.5, false],
    [3.2, 0.4, 0.6, 0.34, 0.55, true],
    [-2.6, 0.2, 0.55, 0.32, 0.5, true],
    [-1.8, 0.9, 0.48, 0.3, 0.45, false],
    [0.8, 0.5, 0.42, 0.28, 0.4, false],
    [4.6, -1.0, 0.6, 0.32, 0.55, true],
    [-4.6, -0.6, 0.5, 0.3, 0.5, false],
    [2.7, -0.55, 0.4, 0.3, 0.42, false],
    [1.3, 2.6, 0.55, 0.32, 0.5, true],
    [-0.4, -0.9, 0.36, 0.26, 0.36, false],
  ];
  for (const [fx, fz, sx, sy, sz, big] of fallen) {
    const rot = new THREE.Euler((r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.6);
    block(fx, sy * 0.38, fz, sx, sy, sz, rot);
    if (big) {
      const p = W(fx, fz);
      collidables.push({ x: p.x, z: p.z, radius: 0.42, maxY: sy * 0.8 });
    }
  }
  // Stacked collapse: two blocks resting on each other against the wall.
  block(2.8, 0.17, -1.05, 0.7, 0.34, 0.55, new THREE.Euler(0, 0.2, 0));
  block(2.75, 0.5, -1.15, 0.6, 0.32, 0.5, new THREE.Euler(0.1, -0.3, 0.25));
  collidables.push({ ...W(2.8, -1.1), radius: 0.45, maxY: 0.7 });
  // Small rubble chips.
  for (let i = 0; i < 26; i++) {
    const fx = (r() - 0.5) * 8.5;
    const fz = -0.9 + r() * 2.6;
    const s = 0.1 + r() * 0.16;
    block(fx, s * 0.3, fz, s * 1.4, s, s, new THREE.Euler(r(), r() * 3, r()));
  }
  // Worn flagstone floor patches inside.
  for (let i = 0; i < 14; i++) {
    const fx = -3.1 + r() * 6.4;
    const fz = -1.0 + r() * 2.6;
    block(fx, 0.015, fz, 0.5 + r() * 0.3, 0.05, 0.4 + r() * 0.25, new THREE.Euler(0, (r() - 0.5) * 0.15, 0));
  }

  const stoneMesh = new THREE.Mesh(mergeGeometries(stoneGeos, false), m.stone);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  g.add(stoneMesh);
  const mortarMesh = new THREE.Mesh(mergeGeometries(mortarGeos.map((q) => (q.index ? q.toNonIndexed() : q)), false), m.mortar);
  mortarMesh.receiveShadow = true;
  g.add(mortarMesh);

  // Moss caps on the exposed top stones.
  const mossGeos = [];
  for (const t of tops) {
    // Only the highest stone in its column, and not every one.
    const covered = tops.some((o) => o !== t && o.axis === t.axis && o.c === t.c + 1 && Math.abs(o.pos[t.axis === 'x' ? 0 : 2] - t.pos[t.axis === 'x' ? 0 : 2]) < (t.size[t.axis === 'x' ? 0 : 2] + o.size[t.axis === 'x' ? 0 : 2]) / 2 - 0.05 && Math.abs(o.pos[t.axis === 'x' ? 2 : 0] - t.pos[t.axis === 'x' ? 2 : 0]) < 0.1);
    if (covered || r() < 0.35) continue;
    const pg = new THREE.PlaneGeometry(t.size[0] + 0.08, t.size[2] + 0.08);
    pg.rotateX(-Math.PI / 2);
    pg.rotateY(r() * 0.3);
    pg.translate(t.pos[0], t.top + 0.012, t.pos[2]);
    const uv = pg.attributes.uv;
    const ou = r() * 0.5;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + ou, uv.getY(i) * 0.5 + ou);
    mossGeos.push(pg);
  }
  if (mossGeos.length) {
    const moss = new THREE.Mesh(mergeGeometries(mossGeos, false), m.moss);
    moss.receiveShadow = true;
    g.add(moss);
  }
  // Ivy curtains hanging off the high parts of the back wall and side wall.
  const ivyGeos = [];
  const ivySpots = [[-2.6, -1], [-0.6, 1], [1.9, 1], [2.6, -1], [-3.2, 1]];
  for (const [u, side] of ivySpots) {
    const h = backH(u);
    const hh = Math.min(h - 0.2, 1.4 + r() * 0.9);
    const pg = new THREE.PlaneGeometry(0.9 + r() * 0.5, hh);
    if (side < 0) pg.rotateY(Math.PI);
    pg.translate(u, h - hh / 2 + 0.05, -1.65 + side * (T / 2 + 0.03));
    ivyGeos.push(pg);
  }
  {
    const pg = new THREE.PlaneGeometry(1.0, 1.5);
    pg.rotateY(-Math.PI / 2);
    pg.translate(-3.69 - T / 2 - 0.03, 2.1, -0.9);
    ivyGeos.push(pg);
  }
  const ivy = new THREE.Mesh(mergeGeometries(ivyGeos, false), m.ivy);
  ivy.castShadow = true;
  g.add(ivy);
  // Grounding dirt.
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.6), m.dirt);
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(0, 0.01, 0.1);
  dirt.receiveShadow = true;
  g.add(dirt);

  g.rotation.y = angle;
  g.position.set(x, 0, z);
  return g;
}
