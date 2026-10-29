// Forest Outpost main buildings: a clean, modern industrial / research
// facility (38 x 38 m, ~13.3 m to the parapet coping).
//
//   - Reinforced concrete plinth, steel portal frame, ribbed insulated
//     metal-panel cladding with dark trim bands, a continuous clerestory
//     window ribbon, parapet + coping, scuppers/downpipes, wall packs.
//   - Four 11 x 5.5 m entrances (one centred per side) with steel frames,
//     guide channels and rolled-up shutter housings.
//   - Interior: polished concrete floor, two L-shaped mezzanines (NW and SE
//     corners, deck at 5 m) each reached by a steel stair, pallet racks,
//     workbench, cabinets, generator skid, crates.
//   - Exterior two-flight steel stair (east face) up to a walkable flat roof
//     with HVAC units.
//
// All materials are module-level singletons (shared across the three
// buildings) so the static batcher merges them into a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Dimensions (local metres; building centred on origin, ground y = 0)
// ---------------------------------------------------------------------------
const H = 19; // outer face of cladding (half size)
const DOOR = 5.5; // half door width (11 m)
const DOOR_H = 5.5;
const ROOF_Y = 12.45; // top of roof deck (walkable)
const PARAPET = 13.15;
const MEZZ_Y = 5.0;
const FLOOR_Y = 0.06;

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
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

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, metres, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Trapezoidal rib profile, 3 ribs per metre (h in 0..1 over one period).
function ribHeight(p) {
  if (p < 0.14) return 1;
  if (p < 0.24) return 1 - (p - 0.14) / 0.1;
  if (p < 0.9) {
    // shallow stiffening micro-ribs in the pan
    const q = (p - 0.24) / 0.66;
    return 0.06 * Math.max(0, Math.sin(q * Math.PI * 3)) ** 8;
  }
  return (p - 0.9) / 0.1;
}

function makeRibTextures() {
  const S = 256;
  const col = canvas(S, S);
  const nrm = canvas(S, S);
  const cc = col.getContext('2d');
  const nc = nrm.getContext('2d');
  const ci = cc.createImageData(S, S);
  const ni = nc.createImageData(S, S);
  const r = rng(7);
  const period = S / 3;
  for (let x = 0; x < S; x++) {
    const p0 = (x % period) / period;
    const p1 = ((x + 1) % period) / period;
    const h0 = ribHeight(p0);
    const h1 = ribHeight(p1);
    const dh = (h1 - h0) * 3.2;
    const len = Math.hypot(dh, 1);
    const nx = -dh / len;
    const nz = 1 / len;
    const shade = 228 - Math.abs(dh) * 22 + (h0 > 0.9 ? 6 : 0);
    // faint panel joint every metre
    const joint = x === 0 || x === S - 1 ? -40 : 0;
    for (let y = 0; y < S; y++) {
      const i = (y * S + x) * 4;
      const n = (r() - 0.5) * 5;
      const v = Math.max(0, Math.min(255, shade + joint + n));
      ci.data[i] = ci.data[i + 1] = ci.data[i + 2] = v;
      ci.data[i + 3] = 255;
      ni.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      ni.data[i + 1] = 128;
      ni.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      ni.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0);
  nc.putImageData(ni, 0, 0);
  return { map: tex(col, 1), normal: tex(nrm, 1, false) };
}

function makeConcreteTexture(seed, base, size, metres, joints) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // soft mottling
  for (let i = 0; i < 60; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = size * (0.05 + r() * 0.18);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const l = r() < 0.5 ? '0,0,0' : '255,255,255';
    grd.addColorStop(0, `rgba(${l},${0.025 + r() * 0.03})`);
    grd.addColorStop(1, `rgba(${l},0)`);
    g.fillStyle = grd;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  }
  // aggregate speckle
  for (let i = 0; i < size * size * 0.06; i++) {
    const v = Math.floor(90 + r() * 120);
    g.fillStyle = `rgba(${v},${v},${v - 4},${0.12 + r() * 0.2})`;
    const s = r() < 0.9 ? 1 : 2;
    g.fillRect(r() * size, r() * size, s, s);
  }
  if (joints) {
    g.fillStyle = 'rgba(40,40,40,0.55)';
    g.fillRect(0, 0, size, 2);
    g.fillRect(0, 0, 2, size);
  }
  return tex(c, metres);
}

function makeWoodTexture() {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const r = rng(31);
  g.fillStyle = '#d9b98c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const y = r() * S;
    const v = r();
    g.strokeStyle = `rgba(${v < 0.5 ? '120,80,40' : '240,215,170'},${0.12 + r() * 0.18})`;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5);
    g.stroke();
  }
  // plank seams
  g.fillStyle = 'rgba(70,45,20,0.5)';
  for (let k = 0; k < 4; k++) g.fillRect(0, k * (S / 4), S, 2);
  return tex(c, 1.2);
}

function makeGratingTexture() {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f32';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#7d8489';
  for (let k = 0; k < 4; k++) g.fillRect(k * 16, 0, 4, S);
  g.fillStyle = '#5f666b';
  for (let k = 0; k < 2; k++) g.fillRect(0, k * 32, S, 3);
  return tex(c, 0.25);
}

function makeSignTexture(name) {
  const c = canvas(1024, 142);
  const g = c.getContext('2d');
  g.fillStyle = '#1b2329';
  g.fillRect(0, 0, 1024, 142);
  g.fillStyle = '#d7a521';
  g.fillRect(0, 0, 22, 142);
  g.fillRect(0, 132, 1024, 10);
  g.fillStyle = '#eef2f4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 84;
  const label = String(name || 'FACILITY').toUpperCase();
  do {
    g.font = `600 ${size}px "Segoe UI", Arial, sans-serif`;
    size -= 2;
  } while (g.measureText(label).width > 900 && size > 30);
  g.fillText(label, 522, 62);
  g.font = '500 20px "Segoe UI", Arial, sans-serif';
  g.fillStyle = '#9fb0ba';
  g.fillText('FOREST OUTPOST  ·  RESEARCH & PROCESSING', 522, 113);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Shared materials (created once)
// ---------------------------------------------------------------------------
let M = null;
function std(params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.noWeathering = true;
  return m;
}
function materials() {
  if (M) return M;
  const rib = makeRibTextures();
  const concTex = makeConcreteTexture(3, '#c9c8c2', 256, 2, false);
  const floorTex = makeConcreteTexture(11, '#cfcfcb', 512, 6, true);
  const deckTex = makeConcreteTexture(19, '#c2c3c0', 256, 3, false);
  const nrmScale = new THREE.Vector2(0.9, 0.9);
  M = {
    clad: std({ color: 0x737f78, map: rib.map, normalMap: rib.normal, normalScale: nrmScale, roughness: 0.52, metalness: 0.35 }),
    roof: std({ color: 0x9da2a3, map: rib.map, normalMap: rib.normal, normalScale: nrmScale, roughness: 0.6, metalness: 0.3 }),
    liner: std({ color: 0xc4c8c6, map: rib.map, normalMap: rib.normal, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.6, metalness: 0.15 }),
    trim: std({ color: 0x2c3134, roughness: 0.42, metalness: 0.6 }),
    frame: std({ color: 0x24282b, roughness: 0.35, metalness: 0.7 }),
    steel: std({ color: 0x4a545c, roughness: 0.48, metalness: 0.55 }),
    concrete: std({ color: 0xa8a8a2, map: concTex, roughness: 0.9, metalness: 0 }),
    floor: std({ color: 0x9a9d9b, map: floorTex, roughness: 0.34, metalness: 0.02 }),
    deck: std({ color: 0x8d9090, map: deckTex, roughness: 0.72, metalness: 0.05 }),
    grating: std({ color: 0xffffff, map: makeGratingTexture(), roughness: 0.55, metalness: 0.6 }),
    accent: std({ color: 0xd2a019, roughness: 0.45, metalness: 0.25 }),
    paintBlue: std({ color: 0x2c5672, roughness: 0.42, metalness: 0.35 }),
    rackOrange: std({ color: 0xc8611c, roughness: 0.45, metalness: 0.35 }),
    cabinet: std({ color: 0xbfc3c3, roughness: 0.4, metalness: 0.3 }),
    hvac: std({ color: 0xb8bcbc, roughness: 0.38, metalness: 0.45 }),
    wood: std({ color: 0xffffff, map: makeWoodTexture(), roughness: 0.78, metalness: 0 }),
    carton: std({ color: 0xb8916a, roughness: 0.85, metalness: 0 }),
    wrap: std({ color: 0xd8dcdc, roughness: 0.3, metalness: 0.05 }),
    rubber: std({ color: 0x1b1c1e, roughness: 0.8, metalness: 0 }),
    lamp: std({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 2.4, roughness: 0.3 }),
    wallLamp: std({ color: 0xffffff, emissive: 0xffe0ad, emissiveIntensity: 2.6, roughness: 0.3 }),
    screen: std({ color: 0x0e1a22, emissive: 0x3d8fb8, emissiveIntensity: 1.1, roughness: 0.2 }),
    indicator: std({ color: 0x113311, emissive: 0x33ff66, emissiveIntensity: 1.6, roughness: 0.3 }),
  };
  M.glass = new THREE.MeshStandardMaterial({
    color: 0x9fb6c2,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  M.glass.userData.noWeathering = true;
  return M;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
// BoxGeometry with UVs in metres so every material keeps a constant texel density.
function bgeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

function B(parent, mat, x0, x1, y0, y1, z0, z1, shadow = true) {
  const m = new THREE.Mesh(bgeo(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const _m4 = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// Box of cross-section w x h running from a to b.
function beam(parent, mat, ax, ay, az, bx, by, bz, w, h) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const m = new THREE.Mesh(bgeo(w, h, len), mat);
  _m4.lookAt(_b, _a, _up);
  m.quaternion.setFromRotationMatrix(_m4);
  m.position.addVectors(_a, _b).multiplyScalar(0.5);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, mat, x, y0, y1, z, r, seg = 12, rTop = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, y1 - y0, seg), mat);
  m.position.set(x, (y0 + y1) / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
export function makeForestStation(x, z, collidables, walkableSurfaces, name) {
  const mt = materials();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.name = 'forestStation';
  const glassGeos = [];

  // --- gameplay helpers (local coords -> world) ---
  const col = (lx, lz, radius, minY, maxY) => {
    const c = { x: x + lx, z: z + lz, radius };
    if (minY !== undefined) c.minY = minY;
    if (maxY !== undefined) c.maxY = maxY;
    collidables.push(c);
  };
  const colLine = (x0, z0, x1, z1, radius, spacing, minY, maxY) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      col(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius, minY, maxY);
    }
  };
  const rect = (x0, x1, z0, z1, y) => {
    walkableSurfaces.push({
      type: 'rect',
      x: x + (Math.min(x0, x1) + Math.max(x0, x1)) / 2,
      z: z + (Math.min(z0, z1) + Math.max(z0, z1)) / 2,
      width: Math.abs(x1 - x0),
      depth: Math.abs(z1 - z0),
      y,
    });
  };
  const ramp = (x1, z1, y1, x2, z2, y2, width, steps) => {
    walkableSurfaces.push({ type: 'ramp', x1: x + x1, z1: z + z1, y1, x2: x + x2, z2: z + z2, y2, width, steps });
  };

  // ======================================================================
  // Floor, aprons, roof deck
  // ======================================================================
  B(g, mt.floor, -18.7, 18.7, 0, FLOOR_Y, -18.7, 18.7, false);
  // painted aisle lines (door-to-door cross)
  for (const s of [-1, 1]) {
    for (const [a0, a1] of [[-18.4, -5.6], [5.6, 18.4]]) {
      B(g, mt.accent, s * 5.6 - 0.05, s * 5.6 + 0.05, FLOOR_Y, FLOOR_Y + 0.012, a0, a1, false);
      B(g, mt.accent, a0, a1, FLOOR_Y, FLOOR_Y + 0.012, s * 5.6 - 0.05, s * 5.6 + 0.05, false);
    }
  }
  B(g, mt.roof, -18.7, 18.7, 12.3, ROOF_Y, -18.7, 18.7);
  rect(-18.7, 18.7, -18.7, 18.7, ROOF_Y);

  // ======================================================================
  // Walls (one sub-group per side, outer face at local z = +H)
  // ======================================================================
  const sides = [
    { theta: 0, sign: true, pipes: [-12.67, 12.67], lights: [-9, 9], manDoor: -11, bollards: true, gap: null },
    { theta: Math.PI / 2, sign: false, pipes: [-12.67], lights: [-9, 9], manDoor: -11, bollards: false, gap: [3.6, 6.6] },
    { theta: Math.PI, sign: true, pipes: [-12.67, 12.67], lights: [-9, 9], manDoor: 11, bollards: true, gap: null },
    { theta: -Math.PI / 2, sign: false, pipes: [-12.67, 12.67], lights: [-9, 9], manDoor: -11, bollards: true, gap: null },
  ];
  let signMat = null;
  for (const sd of sides) {
    const sg = new THREE.Group();
    sg.rotation.y = sd.theta;
    g.add(sg);
    const cos = Math.cos(sd.theta);
    const sin = Math.sin(sd.theta);
    const toB = (xl, zl) => [xl * cos + zl * sin, -xl * sin + zl * cos];

    // ring element: runs from xl = -zOut to xl = zIn so the corners interlock.
    const ring = (mat, zIn, zOut, y0, y1, gaps = []) => {
      let segs = [[-zOut, zIn]];
      for (const [ga, gb] of gaps) {
        const out = [];
        for (const [a, b] of segs) {
          if (gb <= a || ga >= b) out.push([a, b]);
          else {
            if (ga > a) out.push([a, ga]);
            if (gb < b) out.push([gb, b]);
          }
        }
        segs = out;
      }
      for (const [a, b] of segs) if (b - a > 0.01) B(sg, mat, a, b, y0, y1, zIn, zOut);
    };

    const doorGap = [[-DOOR, DOOR]];
    const md = sd.manDoor;
    // plinth + cladding + liner
    ring(mt.concrete, 18.55, 19.15, 0, 0.9, [...doorGap, [md - 0.62, md + 0.62]]);
    ring(mt.clad, 18.7, 19.0, 0.9, 8.4, [[-DOOR - 0.35, DOOR + 0.35]]);
    B(sg, mt.clad, -DOOR - 0.35, DOOR + 0.35, 5.9, 8.4, 18.7, 19.0);
    ring(mt.liner, 18.6, 18.7, 0.9, 8.4, [[-DOOR - 0.35, DOOR + 0.35], [md - 0.62, md + 0.62]]);
    B(sg, mt.liner, -DOOR - 0.35, DOOR + 0.35, 5.9, 8.4, 18.6, 18.7);
    // trim bands framing the clerestory ribbon
    ring(mt.trim, 18.62, 19.08, 8.4, 8.7);
    ring(mt.trim, 18.62, 19.08, 10.4, 10.7);
    // clerestory glazing: mullions + one glass pane per side
    const nM = 24;
    for (let i = 0; i <= nM; i++) {
      const mx = -18.7 + (37.4 * i) / nM;
      B(sg, mt.frame, mx - 0.04, mx + 0.04, 8.7, 10.4, 18.74, 19.0, false);
    }
    B(sg, mt.frame, -18.7, 18.7, 9.53, 9.57, 18.8, 18.98, false); // transom
    const pane = new THREE.PlaneGeometry(37.4, 1.7);
    pane.applyMatrix4(new THREE.Matrix4().makeRotationY(sd.theta).multiply(new THREE.Matrix4().makeTranslation(0, 9.55, 18.88)));
    glassGeos.push(pane);
    // upper cladding, parapet, coping, parapet inner flashing
    ring(mt.clad, 18.7, 19.0, 10.7, ROOF_Y);
    const pg = sd.gap ? [sd.gap] : [];
    ring(mt.clad, 18.7, 19.0, ROOF_Y, PARAPET, pg);
    ring(mt.trim, 18.55, 19.12, PARAPET, PARAPET + 0.15, pg);
    ring(mt.trim, 18.35, 18.7, ROOF_Y, ROOF_Y + 0.06, pg); // roof-side gutter/upstand
    // corner flashing
    B(sg, mt.trim, -19.08, -18.9, 0.9, PARAPET, 18.9, 19.08, false);

    // interior portal-frame columns (I-sections)
    for (const cx of [-18.35, -12.67, -6.15, 6.15, 12.67]) {
      const y1 = 12.1;
      B(sg, mt.steel, cx - 0.18, cx + 0.18, FLOOR_Y, y1, 18.52, 18.58);
      B(sg, mt.steel, cx - 0.18, cx + 0.18, FLOOR_Y, y1, 18.18, 18.24);
      B(sg, mt.steel, cx - 0.02, cx + 0.02, FLOOR_Y, y1, 18.24, 18.52);
      B(sg, mt.trim, cx - 0.26, cx + 0.26, FLOOR_Y, FLOOR_Y + 0.03, 18.12, 18.6, false); // base plate
    }

    // ---- main entrance ----
    for (const s of [-1, 1]) {
      // jamb
      B(sg, mt.trim, s * DOOR, s * (DOOR + 0.35), 0, 5.9, 18.55, 19.06);
      // kick guard
      B(sg, mt.accent, s * (DOOR - 0.02), s * (DOOR + 0.37), 0, 1.0, 18.5, 19.1);
      // shutter guide channel
      B(sg, mt.frame, s * DOOR, s * (DOOR + 0.22), 0.0, 5.9, 19.06, 19.22);
      if (sd.bollards) {
        cyl(sg, mt.accent, s * 6.5, 0, 1.1, 19.8, 0.13, 10);
        cyl(sg, mt.trim, s * 6.5, 1.1, 1.14, 19.8, 0.14, 10, 0.1);
        const [bx, bz] = toB(s * 6.5, 19.8);
        col(bx, bz, 0.16);
      }
    }
    B(sg, mt.trim, -DOOR - 0.35, DOOR + 0.35, DOOR_H, 5.9, 18.55, 19.06); // header beam
    // roller-shutter housing (rolled up)
    B(sg, mt.clad, -DOOR - 0.45, DOOR + 0.45, 5.9, 6.75, 19.0, 19.72);
    B(sg, mt.trim, -DOOR - 0.5, DOOR + 0.5, 6.75, 6.82, 18.98, 19.78, false);
    for (const s of [-1, 1]) B(sg, mt.trim, s * (DOOR + 0.45), s * (DOOR + 0.52), 5.88, 6.75, 19.0, 19.75, false);
    B(sg, mt.frame, -DOOR, DOOR, 5.32, 5.5, 19.08, 19.18, false); // shutter bottom rail peeking out
    // threshold + apron
    B(sg, mt.trim, -DOOR, DOOR, 0, 0.065, 18.55, 19.15, false);
    B(sg, mt.concrete, -7.2, 7.2, 0, 0.05, 19.15, 22.6, false);

    // ---- personnel door ----
    B(sg, mt.trim, md - 0.62, md + 0.62, 0, 2.42, 18.98, 19.08, false); // frame
    B(sg, mt.paintBlue, md - 0.5, md + 0.5, 0.1, 2.3, 19.0, 19.12, false); // leaf
    B(sg, mt.frame, md + 0.3, md + 0.42, 1.0, 1.06, 19.12, 19.18, false); // handle
    B(sg, mt.trim, md - 0.95, md + 0.95, 2.62, 2.72, 19.0, 20.1); // canopy
    B(sg, mt.wallLamp, md - 0.25, md + 0.25, 2.59, 2.62, 19.4, 19.6, false);
    B(sg, mt.concrete, md - 0.85, md + 0.85, 0, 0.12, 19.15, 20.2, false); // step

    // ---- wall packs ----
    for (const lx of sd.lights) {
      B(sg, mt.trim, lx - 0.2, lx + 0.2, 6.15, 6.45, 19.0, 19.28, false);
      B(sg, mt.wallLamp, lx - 0.16, lx + 0.16, 6.12, 6.15, 19.03, 19.25, false);
    }

    // ---- scuppers + downpipes ----
    for (const px of sd.pipes) {
      B(sg, mt.trim, px - 0.22, px + 0.22, 12.0, 12.55, 19.0, 19.32); // hopper
      cyl(sg, mt.trim, px, 0.25, 12.0, 19.17, 0.075, 8);
      B(sg, mt.trim, px - 0.1, px + 0.1, 0.12, 0.28, 19.05, 19.45, false); // shoe
      for (const by of [3.2, 6.4, 9.6]) B(sg, mt.frame, px - 0.12, px + 0.12, by, by + 0.05, 19.0, 19.26, false);
    }

    // ---- signage ----
    if (sd.sign) {
      if (!signMat) {
        const st = makeSignTexture(name);
        signMat = new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1 });
        signMat.userData.noWeathering = true;
      }
      B(sg, mt.trim, -4.7, 4.7, 6.92, 8.3, 19.0, 19.08, false);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 1.28), signMat);
      sign.position.set(0, 7.61, 19.1);
      sg.add(sign);
    }

    // ---- wall collision (gap for the main door; up to roof deck only) ----
    const segs = [[-H, -DOOR - 0.35], [DOOR + 0.35, H]];
    for (const [a, b] of segs) {
      const [ax, az] = toB(a, 18.85);
      const [bx, bz] = toB(b, 18.85);
      colLine(ax, az, bx, bz, 0.35, 0.6, undefined, 12.3);
    }
    // parapet (only blocks players standing on the roof)
    const pSegs = sd.gap ? [[-H, sd.gap[0] - 0.1], [sd.gap[1] + 0.1, H]] : [[-H, H]];
    for (const [a, b] of pSegs) {
      const [ax, az] = toB(a, 18.85);
      const [bx, bz] = toB(b, 18.85);
      colLine(ax, az, bx, bz, 0.25, 0.6, 12.2, 15);
    }
  }
  // merged clerestory glass (one transparent draw call per building)
  const glass = new THREE.Mesh(mergeGeometries(glassGeos, false), mt.glass);
  glass.renderOrder = 2;
  g.add(glass);

  // ======================================================================
  // Roof structure (rafters span X at these Z), purlins, ceiling lights
  // ======================================================================
  const rafterZ = [-12.67, -6.15, 6.15, 12.67];
  for (const rz of rafterZ) {
    B(g, mt.steel, -18.6, 18.6, 11.4, 11.45, rz - 0.17, rz + 0.17);
    B(g, mt.steel, -18.6, 18.6, 12.05, 12.1, rz - 0.17, rz + 0.17);
    B(g, mt.steel, -18.6, 18.6, 11.45, 12.05, rz - 0.02, rz + 0.02);
  }
  for (let i = 0; i <= 12; i++) {
    const px = -18.2 + (36.4 * i) / 12;
    B(g, mt.steel, px - 0.05, px + 0.05, 12.1, 12.3, -18.6, 18.6, false);
  }
  for (const lz of [-9.4, 0, 9.4]) {
    for (const lx of [-12.5, -4.2, 4.2, 12.5]) {
      B(g, mt.trim, lx - 1.1, lx + 1.1, 10.6, 10.72, lz - 0.17, lz + 0.17, false);
      B(g, mt.lamp, lx - 1.04, lx + 1.04, 10.58, 10.6, lz - 0.12, lz + 0.12, false);
      for (const s of [-1, 1]) B(g, mt.frame, lx + s * 0.8 - 0.01, lx + s * 0.8 + 0.01, 10.72, 12.1, lz - 0.01, lz + 0.01, false);
    }
  }
  for (const [lx, lz] of [[-9.5, -4.7], [9.5, 4.7], [-9.5, 9.4], [9.5, -9.4]]) {
    const L = new THREE.PointLight(0xf1f5ff, 3.0, 26, 1.2);
    L.position.set(lx, 10.2, lz);
    g.add(L);
  }

  // ======================================================================
  // Roof top: HVAC units, exhaust fans, hatch
  // ======================================================================
  const hvac = (cx, cz, w, d, h) => {
    B(g, mt.trim, cx - w / 2 + 0.1, cx + w / 2 - 0.1, ROOF_Y, ROOF_Y + 0.25, cz - d / 2 + 0.1, cz + d / 2 - 0.1); // curb
    B(g, mt.hvac, cx - w / 2, cx + w / 2, ROOF_Y + 0.25, ROOF_Y + h, cz - d / 2, cz + d / 2);
    B(g, mt.trim, cx - w / 2 + 0.2, cx + w / 2 - 0.2, ROOF_Y + 0.5, ROOF_Y + h - 0.3, cz + d / 2, cz + d / 2 + 0.03, false); // grille
    const nf = Math.max(1, Math.round(w / 1.6));
    for (let i = 0; i < nf; i++) {
      const fx = cx - w / 2 + (w * (i + 0.5)) / nf;
      cyl(g, mt.trim, fx, ROOF_Y + h, ROOF_Y + h + 0.18, cz, 0.62, 16);
      cyl(g, mt.frame, fx, ROOF_Y + h + 0.18, ROOF_Y + h + 0.22, cz, 0.12, 8);
    }
    colLine(cx - w / 2 + 0.6, cz, cx + w / 2 - 0.6, cz, Math.max(d / 2, 0.6), 1.0, 12.2, 15);
  };
  hvac(-7, -2, 4.2, 2.0, 1.7);
  hvac(7.5, 9, 3.2, 1.8, 1.5);
  // duct from unit 1 into the roof
  B(g, mt.hvac, -4.9, -2.5, ROOF_Y + 0.6, ROOF_Y + 1.3, -2.4, -1.6);
  B(g, mt.hvac, -2.5, -1.7, ROOF_Y, ROOF_Y + 1.3, -2.4, -1.6);
  col(-3.6, -2, 0.6, 12.2, 15);
  for (const [ex, ez] of [[10, -10], [-11, 10]]) {
    cyl(g, mt.hvac, ex, ROOF_Y, ROOF_Y + 0.7, ez, 0.45, 14);
    cyl(g, mt.trim, ex, ROOF_Y + 0.7, ROOF_Y + 0.95, ez, 0.62, 14, 0.15);
    col(ex, ez, 0.6, 12.2, 15);
  }
  B(g, mt.trim, -14, -12.8, ROOF_Y, ROOF_Y + 0.45, 12, 13.2); // hatch
  B(g, mt.accent, -14.05, -12.75, ROOF_Y + 0.45, ROOF_Y + 0.5, 11.95, 13.25, false);
  col(-13.4, 12.6, 0.8, 12.2, 15);

  // ======================================================================
  // Mezzanines (NW, mirrored to SE) + interior stairs
  // ======================================================================
  const lampsUnderMezz = [];
  for (const s of [1, -1]) {
    const P = (lx, lz) => [s * lx, s * lz];
    const BM = (mat, x0, x1, y0, y1, z0, z1, shadow = true) => B(g, mat, Math.min(s * x0, s * x1), Math.max(s * x0, s * x1), y0, y1, Math.min(s * z0, s * z1), Math.max(s * z0, s * z1), shadow);
    const RM = (x0, x1, z0, z1, y) => rect(s * x0, s * x1, s * z0, s * z1, y);
    const CL = (x0, z0, x1, z1, r, sp, minY, maxY) => colLine(s * x0, s * z0, s * x1, s * z1, r, sp, minY, maxY);
    const C = (lx, lz, r, minY, maxY) => col(s * lx, s * lz, r, minY, maxY);

    // decks (A along north wall, B along west wall in NW frame)
    BM(mt.deck, -18.7, -6.2, MEZZ_Y - 0.25, MEZZ_Y, -18.7, -10.5);
    BM(mt.deck, -18.7, -10.5, MEZZ_Y - 0.25, MEZZ_Y, -10.5, -6.2);
    RM(-18.7, -6.2, -18.7, -10.5, MEZZ_Y);
    RM(-18.7, -10.5, -10.5, -6.2, MEZZ_Y);
    // edge + secondary beams
    const by0 = MEZZ_Y - 0.6;
    const by1 = MEZZ_Y - 0.25;
    BM(mt.steel, -10.5, -6.2, by0, by1, -10.7, -10.5);
    BM(mt.steel, -6.4, -6.2, by0, by1, -18.6, -10.5);
    BM(mt.steel, -10.7, -10.5, by0, by1, -10.5, -6.2);
    BM(mt.steel, -18.6, -10.5, by0, by1, -6.4, -6.2);
    BM(mt.steel, -18.6, -6.4, by0 + 0.1, by1, -14.7, -14.5);
    BM(mt.steel, -14.7, -14.5, by0 + 0.1, by1, -18.6, -6.4);
    BM(mt.steel, -10.9, -10.7, by0 + 0.1, by1, -18.6, -10.7);
    // columns
    for (const [cx, cz] of [[-6.5, -10.8], [-10.8, -10.8], [-10.8, -6.5], [-14.6, -6.5], [-14.6, -10.8], [-6.5, -14.6], [-10.8, -14.6]]) {
      BM(mt.steel, cx - 0.15, cx + 0.15, FLOOR_Y, by0, cz - 0.15, cz + 0.15);
      BM(mt.trim, cx - 0.25, cx + 0.25, FLOOR_Y, FLOOR_Y + 0.03, cz - 0.25, cz + 0.25, false);
      C(cx, cz, 0.3);
    }
    // under-deck lights
    for (const [lx, lz] of [[-12.7, -16.6], [-8.4, -16.6], [-16.6, -12.7], [-16.6, -8.4]]) {
      BM(mt.lamp, lx - 0.5, lx + 0.5, by1 - 0.04, by1, lz - 0.5, lz + 0.5, false);
    }
    lampsUnderMezz.push(P(-12.6, -12.6));

    // guard rails (yellow), toe plates
    const rail = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / 1.5));
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const hw = 0.03;
      const seg = (y0, y1, mat, half = hw) => along
        ? BM(mat, Math.min(x0, x1), Math.max(x0, x1), y0, y1, z0 - half, z0 + half, false)
        : BM(mat, x0 - half, x0 + half, y0, y1, Math.min(z0, z1), Math.max(z0, z1), false);
      seg(MEZZ_Y + 1.02, MEZZ_Y + 1.08, mt.accent, 0.035);
      seg(MEZZ_Y + 0.52, MEZZ_Y + 0.56, mt.accent, 0.02);
      seg(MEZZ_Y, MEZZ_Y + 0.12, mt.accent, 0.008);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = x0 + (x1 - x0) * t;
        const pz = z0 + (z1 - z0) * t;
        BM(mt.accent, px - 0.03, px + 0.03, MEZZ_Y, MEZZ_Y + 1.05, pz - 0.03, pz + 0.03, false);
      }
    };
    rail(-10.5, -10.5, -8.95, -10.5);
    rail(-7.05, -10.5, -6.2, -10.5);
    rail(-6.2, -10.5, -6.2, -18.65);
    rail(-10.5, -10.5, -10.5, -6.2);
    rail(-10.5, -6.2, -18.65, -6.2);
    const rMin = MEZZ_Y - 0.4;
    const rMax = MEZZ_Y + 1.4;
    CL(-10.5, -10.5, -9.25, -10.5, 0.2, 0.45, rMin, rMax);
    CL(-6.75, -10.5, -6.2, -10.5, 0.2, 0.45, rMin, rMax);
    CL(-6.2, -10.5, -6.2, -18.6, 0.2, 0.5, rMin, rMax);
    CL(-10.5, -10.5, -10.5, -6.2, 0.2, 0.5, rMin, rMax);
    CL(-10.5, -6.2, -18.6, -6.2, 0.2, 0.5, rMin, rMax);

    // ---- stair (runs from z=-2.3 up to the deck edge at z=-10.5, x=-8) ----
    const sx = -8;
    const zLo = -2.3;
    const zHi = -10.5;
    const n = 26;
    const rise = MEZZ_Y / n;
    const run = (zHi - zLo) / n; // negative
    for (let i = 0; i < n; i++) {
      const zc = zLo + run * (i + 0.5);
      const top = rise * (i + 1);
      BM(mt.grating, sx - 0.85, sx + 0.85, top - 0.05, top, zc - 0.17, zc + 0.17, false);
      const zn = zLo + run * i; // nosing (front edge)
      BM(mt.accent, sx - 0.85, sx + 0.85, top - 0.05, top + 0.004, zn - 0.025 * Math.sign(run), zn + 0.025 * Math.sign(run), false);
    }
    for (const side of [-1, 1]) {
      const xs = sx + side * 0.9;
      const [ax, az] = P(xs, zLo);
      const [bx, bz] = P(xs, zHi);
      beam(g, mt.steel, ax, 0.02, az, bx, MEZZ_Y - 0.15, bz, 0.08, 0.32); // stringer
      beam(g, mt.accent, ax, 1.0, az, bx, MEZZ_Y + 1.05, bz, 0.05, 0.05); // handrail
      for (const t of [0.04, 0.35, 0.67, 0.98]) {
        const pz = zLo + (zHi - zLo) * t;
        const py = MEZZ_Y * t;
        BM(mt.accent, xs - 0.025, xs + 0.025, py, py + 1.02, pz - 0.025, pz + 0.025, false);
      }
      // side collision doubles as the handrail and keeps ground players out from under the flight
      for (let t = 0.12; t <= 1.0001; t += 0.06) {
        const pz = zLo + (zHi - zLo) * t;
        C(sx + side * 1.05, pz, 0.15, undefined, MEZZ_Y * t + 1.2);
      }
    }
    // landing post at the bottom of the rails + closure under the high end
    CL(sx - 0.7, zHi - 0.12, sx + 0.7, zHi - 0.12, 0.2, 0.35, undefined, MEZZ_Y - 0.6);
    {
      const [lx1, lz1] = P(sx, zLo);
      const [lx2, lz2] = P(sx, zHi);
      ramp(lx1, lz1, 0, lx2, lz2, MEZZ_Y, 1.7, n);
    }

    // ---- mezzanine props ----
    // control desk with monitors (against the north wall)
    BM(mt.cabinet, -17.2, -13.8, MEZZ_Y, MEZZ_Y + 0.74, -18.55, -17.75);
    BM(mt.trim, -17.25, -13.75, MEZZ_Y + 0.74, MEZZ_Y + 0.78, -18.6, -17.7, false);
    for (const mx of [-16.6, -15.5, -14.4]) {
      BM(mt.trim, mx - 0.42, mx + 0.42, MEZZ_Y + 0.95, MEZZ_Y + 1.48, -18.42, -18.36, false);
      BM(mt.screen, mx - 0.39, mx + 0.39, MEZZ_Y + 0.98, MEZZ_Y + 1.45, -18.36, -18.35, false);
      BM(mt.trim, mx - 0.04, mx + 0.04, MEZZ_Y + 0.78, MEZZ_Y + 0.95, -18.45, -18.38, false);
    }
    CL(-17, -18.1, -14, -18.1, 0.5, 0.75, MEZZ_Y - 0.4, MEZZ_Y + 2);
    // storage shelving along the west wall
    BM(mt.steel, -18.6, -18.0, MEZZ_Y, MEZZ_Y + 2.1, -14.2, -11.2);
    for (const sy of [0.5, 1.1, 1.7]) BM(mt.carton, -18.55, -18.05, MEZZ_Y + sy, MEZZ_Y + sy + 0.4, -14.0, -11.4, false);
    CL(-18.3, -14, -18.3, -11.4, 0.4, 0.8, MEZZ_Y - 0.4, MEZZ_Y + 2.5);
    // crate stack on wing B
    BM(mt.wood, -14.6, -13.4, MEZZ_Y, MEZZ_Y + 1.2, -9.2, -8.0);
    BM(mt.wood, -16.2, -15.0, MEZZ_Y, MEZZ_Y + 1.0, -9.0, -8.0);
    BM(mt.wood, -14.4, -13.6, MEZZ_Y + 1.2, MEZZ_Y + 2.0, -9.0, -8.2);
    CL(-15.6, -8.6, -14, -8.6, 0.75, 0.8, MEZZ_Y - 0.4, MEZZ_Y + 2.5);

    // ---- under-mezzanine props ----
    // lockers along the north wall
    for (let i = 0; i < 8; i++) {
      const lx = -17.6 + i * 0.5;
      BM(mt.paintBlue, lx, lx + 0.48, FLOOR_Y, 1.95, -18.55, -18.05);
      BM(mt.trim, lx + 0.06, lx + 0.42, 1.6, 1.66, -18.05, -18.03, false);
    }
    CL(-17.4, -18.2, -13.8, -18.2, 0.45, 0.6);
    // pallet of drums
    BM(mt.wood, -17.2, -15.8, FLOOR_Y, 0.2, -14.4, -13.0);
    for (const [dx, dz] of [[-16.85, -14.05], [-16.15, -14.05], [-16.85, -13.35], [-16.15, -13.35]]) {
      const [wx, wz] = P(dx, dz);
      cyl(g, mt.paintBlue, wx, 0.2, 1.08, wz, 0.3, 14);
      cyl(g, mt.trim, wx, 1.08, 1.1, wz, 0.27, 14);
    }
    C(-16.5, -13.7, 1.0);
    // IBC tote
    BM(mt.wrap, -13.2, -12.1, FLOOR_Y + 0.15, 1.2, -18.4, -17.3);
    BM(mt.frame, -13.25, -12.05, FLOOR_Y, FLOOR_Y + 0.15, -18.45, -17.25);
    for (const [ix, iz] of [[-13.22, -18.42], [-12.08, -18.42], [-13.22, -17.28], [-12.08, -17.28]]) BM(mt.frame, ix - 0.02, ix + 0.02, FLOOR_Y, 1.22, iz - 0.02, iz + 0.02, false);
    C(-12.65, -17.85, 0.8);
  }
  for (const [lx, lz] of lampsUnderMezz) {
    const L = new THREE.PointLight(0xf1f5ff, 1.4, 12, 1.4);
    L.position.set(lx, MEZZ_Y - 0.8, lz);
    g.add(L);
  }

  // ======================================================================
  // Ground-floor props
  // ======================================================================
  // Pallet rack: along u from u0 to u1 (bays of 3 m), fixed coordinate v, axis 'x' or 'z'
  const rack = (axis, u0, u1, v, seed) => {
    const r = rng(seed);
    const P2 = (u, w) => (axis === 'x' ? [u, w] : [w, u]);
    const box = (mat, ua, ub, y0, y1, va, vb, sh = true) => {
      const [xa, za] = P2(ua, va);
      const [xb, zb] = P2(ub, vb);
      B(g, mat, Math.min(xa, xb), Math.max(xa, xb), y0, y1, Math.min(za, zb), Math.max(za, zb), sh);
    };
    const bays = Math.round((u1 - u0) / 3);
    const bw = (u1 - u0) / bays;
    for (let i = 0; i <= bays; i++) {
      const u = u0 + i * bw;
      for (const dv of [-0.55, 0.55]) box(mt.paintBlue, u - 0.05, u + 0.05, FLOOR_Y, 4.3, v + dv - 0.05, v + dv + 0.05);
      for (const by of [1.2, 2.6]) box(mt.paintBlue, u - 0.03, u + 0.03, by, by + 0.04, v - 0.5, v + 0.5, false);
    }
    for (const ly of [1.5, 3.0]) {
      for (const dv of [-0.55, 0.55]) box(mt.rackOrange, u0, u1, ly - 0.14, ly, v + dv - 0.04, v + dv + 0.04);
      box(mt.grating, u0, u1, ly - 0.02, ly, v - 0.5, v + 0.5, false);
    }
    for (let i = 0; i < bays; i++) {
      for (const [ly, cap] of [[FLOOR_Y, 1.25], [1.5, 1.3], [3.0, 1.1]]) {
        for (const k of [0, 1]) {
          if (r() < 0.18) continue;
          const uc = u0 + i * bw + bw * (0.27 + k * 0.46);
          box(mt.wood, uc - 0.6, uc + 0.6, ly, ly + 0.14, v - 0.5, v + 0.5);
          const hgt = 0.6 + r() * (cap - 0.7);
          box(r() < 0.5 ? mt.wrap : mt.carton, uc - 0.55, uc + 0.55, ly + 0.14, ly + 0.14 + hgt, v - 0.45, v + 0.45);
        }
      }
    }
    const [ax, az] = P2(u0 + 0.4, v);
    const [bx, bz] = P2(u1 - 0.4, v);
    colLine(ax, az, bx, bz, 0.62, 0.8);
  };
  rack('x', 8.0, 17.0, -17.85, 5);
  rack('z', -15.8, -6.8, 17.85, 9);

  // Workbench + pegboard (SW, west wall)
  B(g, mt.wood, -18.5, -17.6, 0.9, 0.96, 7.6, 10.8);
  B(g, mt.cabinet, -18.45, -17.7, FLOOR_Y, 0.88, 9.6, 10.75);
  for (const lz of [7.7, 9.5]) for (const lx of [-18.42, -17.7]) B(g, mt.trim, lx - 0.03, lx + 0.03, FLOOR_Y, 0.9, lz - 0.03, lz + 0.03, false);
  B(g, mt.trim, -18.55, -18.5, 1.2, 2.4, 7.6, 10.8, false);
  B(g, mt.paintBlue, -18.5, -18.47, 1.25, 2.35, 7.65, 10.75, false);
  B(g, mt.trim, -17.9, -17.6, 0.96, 1.2, 8.0, 8.35);
  B(g, mt.screen, -18.4, -18.0, 0.96, 1.26, 9.9, 10.5, false);
  colLine(-18.05, 7.8, -18.05, 10.6, 0.5, 0.7);

  // Electrical cabinets (SW, south wall)
  for (let i = 0; i < 5; i++) {
    const cx = -17.6 + i * 1.0;
    B(g, mt.cabinet, cx, cx + 0.96, FLOOR_Y, 2.1, 17.95, 18.55);
    B(g, mt.trim, cx + 0.84, cx + 0.88, 0.9, 1.3, 17.93, 17.95, false);
    B(g, mt.indicator, cx + 0.1, cx + 0.18, 1.8, 1.86, 17.93, 17.95, false);
  }
  B(g, mt.trim, -17.65, -12.6, 2.1, 2.16, 17.9, 18.6, false);
  colLine(-17.2, 18.25, -13.0, 18.25, 0.45, 0.6);

  // Generator / compressor skid (SW)
  {
    const gx = -12.5;
    const gz = 11.5;
    B(g, mt.trim, gx - 1.9, gx + 1.9, FLOOR_Y, 0.25, gz - 0.95, gz + 0.95);
    B(g, mt.paintBlue, gx - 1.8, gx + 1.8, 0.25, 2.0, gz - 0.85, gz + 0.85);
    B(g, mt.trim, gx - 1.82, gx + 1.82, 2.0, 2.06, gz - 0.87, gz + 0.87, false);
    for (const s of [-1, 1]) {
      B(g, mt.trim, gx - 1.4, gx + 0.2, 0.6, 1.7, gz + s * 0.86 - 0.01, gz + s * 0.86 + 0.01, false); // louvre panel
      B(g, mt.cabinet, gx + 0.6, gx + 1.5, 1.0, 1.7, gz + s * 0.86 - 0.01, gz + s * 0.86 + 0.01, false);
    }
    cyl(g, mt.steel, gx - 1.2, 2.0, 3.1, gz, 0.12, 10);
    cyl(g, mt.trim, gx - 1.2, 3.1, 3.2, gz, 0.15, 10);
    colLine(gx - 1.3, gz, gx + 1.3, gz, 1.05, 0.9);
  }

  // Crate clusters for cover (NE and SW inner corners)
  for (const [cx, cz, sd] of [[9.0, -9.0, 3], [-9.2, 8.8, 4]]) {
    const r = rng(sd);
    B(g, mt.wood, cx - 0.7, cx + 0.7, FLOOR_Y, FLOOR_Y + 1.4, cz - 0.7, cz + 0.7);
    B(g, mt.wood, cx + 0.8, cx + 2.0, FLOOR_Y, FLOOR_Y + 1.2, cz - 0.9 + r() * 0.4, cz + 0.3 + r() * 0.4);
    B(g, mt.wood, cx - 0.5, cx + 0.5, FLOOR_Y + 1.4, FLOOR_Y + 2.4, cz - 0.5, cz + 0.5);
    B(g, mt.wood, cx - 0.9, cx + 0.6, FLOOR_Y, FLOOR_Y + 0.15, cz + 0.9, cz + 2.1);
    B(g, mt.wrap, cx - 0.85, cx + 0.55, FLOOR_Y + 0.15, FLOOR_Y + 1.05, cz + 0.95, cz + 2.05);
    col(cx, cz, 1.0);
    col(cx + 1.4, cz - 0.1, 0.75);
    col(cx - 0.15, cz + 1.5, 0.75);
  }

  // ======================================================================
  // Exterior stair to the roof (east face, north half)
  // ======================================================================
  {
    const L1 = 20.15; // lane 1 centre (next to the wall), flight 1: ground -> landing
    const L2 = 21.85; // lane 2 centre, flight 2: landing -> roof
    const zA = -6.6; // south end of flights
    const zB = -16.9; // north end of flights (landing edge)
    const yL = 6.2;
    const n = 32;
    const flight = (lx, y0, y1, zFrom, zTo) => {
      const rs = (y1 - y0) / n;
      const rn = (zTo - zFrom) / n;
      for (let i = 0; i < n; i++) {
        const zc = zFrom + rn * (i + 0.5);
        const top = y0 + rs * (i + 1);
        B(g, mt.grating, lx - 0.78, lx + 0.78, top - 0.05, top, zc - Math.abs(rn) / 2 - 0.02, zc + Math.abs(rn) / 2 + 0.02, false);
        const zn = zFrom + rn * i;
        B(g, mt.accent, lx - 0.78, lx + 0.78, top - 0.05, top + 0.004, zn - 0.025, zn + 0.025, false);
      }
      for (const s of [-1, 1]) {
        const xs = lx + s * 0.82;
        beam(g, mt.steel, xs, y0 - 0.15, zFrom, xs, y1 - 0.15, zTo, 0.08, 0.32);
        if (!(lx === L1 && s < 0)) {
          beam(g, mt.accent, xs, y0 + 1.0, zFrom, xs, y1 + 1.0, zTo, 0.05, 0.05);
          for (const t of [0.03, 0.34, 0.66, 0.97]) {
            const pz = zFrom + (zTo - zFrom) * t;
            const py = y0 + (y1 - y0) * t;
            B(g, mt.accent, xs - 0.025, xs + 0.025, py, py + 1.0, pz - 0.025, pz + 0.025, false);
          }
        }
      }
    };
    flight(L1, 0, yL, zA, zB);
    flight(L2, yL, ROOF_Y, zB, zA);
    ramp(L1, zA, 0, L1, zB, yL, 1.5, n);
    ramp(L2, zB, yL, L2, zA, ROOF_Y, 1.5, n);

    // landings
    const landing = (x0, x1, z0, z1, y) => {
      B(g, mt.grating, x0, x1, y - 0.06, y, z0, z1, false);
      B(g, mt.steel, x0, x1, y - 0.3, y - 0.06, z0, z0 + 0.12);
      B(g, mt.steel, x0, x1, y - 0.3, y - 0.06, z1 - 0.12, z1);
      rect(x0, x1, z0, z1, y);
    };
    landing(19.3, 22.7, -19.3, -16.9, yL);
    landing(18.6, 22.7, -6.6, -3.6, ROOF_Y);
    // landing guard rails (visual + collision)
    const hRail = (x0, z0, x1, z1, y) => {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const seg = (ya, yb, h) => (alongX
        ? B(g, mt.accent, Math.min(x0, x1), Math.max(x0, x1), ya, yb, z0 - h, z0 + h, false)
        : B(g, mt.accent, x0 - h, x0 + h, ya, yb, Math.min(z0, z1), Math.max(z0, z1), false));
      seg(y + 1.0, y + 1.06, 0.03);
      seg(y + 0.5, y + 0.54, 0.02);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const k = Math.max(1, Math.ceil(len / 1.4));
      for (let i = 0; i <= k; i++) {
        const px = x0 + ((x1 - x0) * i) / k;
        const pz = z0 + ((z1 - z0) * i) / k;
        B(g, mt.accent, px - 0.025, px + 0.025, y, y + 1.03, pz - 0.025, pz + 0.025, false);
      }
      colLine(x0, z0, x1, z1, 0.15, 0.4, y - 0.5, y + 2);
    };
    hRail(19.3, -19.3, 22.7, -19.3, yL);
    hRail(22.7, -19.3, 22.7, -16.9, yL);
    hRail(19.1, -3.6, 22.7, -3.6, ROOF_Y);
    hRail(22.7, -6.6, 22.7, -3.6, ROOF_Y);
    hRail(19.1, -6.6, 20.95, -6.6, ROOF_Y);

    // structure: posts + wall brackets
    for (const [px, pz, top] of [[22.65, -19.25, yL], [22.65, -16.95, yL], [19.35, -19.25, yL], [22.65, -11.75, yL + (ROOF_Y - yL) * ((-11.75 - zB) / (zA - zB))], [22.65, -6.65, ROOF_Y], [20.95, -11.75, yL * ((-11.75 - zA) / (zB - zA))]]) {
      B(g, mt.steel, px - 0.08, px + 0.08, 0, top - 0.3, pz - 0.08, pz + 0.08);
      B(g, mt.concrete, px - 0.25, px + 0.25, 0, 0.12, pz - 0.25, pz + 0.25, false);
      col(px, pz, 0.15);
    }
    for (const bz of [-3.75, -6.45]) beam(g, mt.steel, 19.05, ROOF_Y - 2.4, bz, 22.6, ROOF_Y - 0.32, bz, 0.1, 0.12);

    // collision: rail between the lanes (flight 1 handrail + keeps ground players from walking under it)
    for (let zz = zA - 0.25; zz >= zB - 0.05; zz -= 0.45) {
      const t1 = (zA - zz) / (zA - zB);
      const h1 = yL * t1;
      const h2 = yL + (ROOF_Y - yL) * (1 - t1);
      col(21.0, zz, 0.12, undefined, h1 + 1.6);
      col(21.0, zz, 0.12, h2 - 0.5, h2 + 1.8);
      col(22.7, zz, 0.12, h2 - 0.5, h2 + 1.8);
    }
    colLine(19.45, zB + 0.1, 20.85, zB + 0.1, 0.18, 0.35, undefined, yL - 0.4);
  }

  // ======================================================================
  // Exterior: condenser units on the north side
  // ======================================================================
  for (const cx of [8.5, 11.0]) {
    B(g, mt.concrete, cx - 1.05, cx + 1.05, 0, 0.15, -21.3, -19.9, false);
    B(g, mt.hvac, cx - 0.95, cx + 0.95, 0.15, 1.35, -21.15, -20.05);
    B(g, mt.trim, cx - 0.75, cx + 0.75, 0.3, 1.2, -21.16, -21.15, false);
    cyl(g, mt.trim, cx, 1.35, 1.4, -20.6, 0.42, 14);
    col(cx, -20.6, 1.0);
  }
  B(g, mt.trim, 7.6, 11.9, 1.6, 1.72, -19.25, -19.0, false); // refrigerant line cover

  return g;
}
