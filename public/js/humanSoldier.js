// Realistic human soldier for players and bots.
//
// Built from two real assets (see assets/characters/LICENSE.md):
//   - a rigged, textured soldier body (Mixamo "Vanguard"): uniform, armour,
//     gloves and boots on a 49-bone skeleton with idle / walk / run clips.
//     Its sci-fi helmet is stripped off at load time;
//   - a photo-scanned human head (Lee Perry-Smith) in its place, tinted to
//     one of several skin tones, with ballistic glasses, a neck gaiter and
//     headgear (helmet, helmet + NVG, cap, beanie) fitted to the real skull.
// On top of the animation, each frame:
//   - both arms are solved with two-bone IK onto the weapon's grip points,
//     so the soldier actually holds whatever gun they carry, and the fingers
//     close around it;
//   - the spine and head bend to follow the player's aim pitch;
//   - crouching drops the hips and re-solves the legs so the feet stay planted;
//   - the armour and fabric are recoloured to the player's camo.
// The returned object has the same interface as playerModel.js's procedural
// soldier, so every caller (game, killcam, lobby, operator preview) uses it.
// The same rig also builds realistic zombies (createHumanZombie, below).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = 'assets/characters/soldier.glb';
const HEAD_DIR = 'assets/characters/head/';
const TARGET_HEIGHT = 1.8;
// Where the scanned head's neck base sits relative to the rig's Head bone
// (head frame: +Y up the neck, -Z toward the face).
export const HEAD_OFFSET = new THREE.Vector3(0, 0.006, -0.008);
// Real head height (crown to the bottom of the scanned neck), metres.
const HEAD_HEIGHT = 0.3;

let base = null;
let loading = null;

// The body rig wears a sci-fi helmet; strip every triangle skinned to the
// head so a real (photo-scanned) human head can sit on the neck instead.
function stripHelmet(scene) {
  const drop = [];
  scene.traverse((o) => {
    if (/visor/i.test(o.name) && o.isMesh) drop.push(o);
    if (!o.isSkinnedMesh || /visor/i.test(o.name)) return;
    const g = o.geometry;
    const headJoints = new Set(o.skeleton.bones.map((b, i) => (/Head/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    const headW = new Float32Array(si.count);
    for (let v = 0; v < si.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (headJoints.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      headW[v] = w;
    }
    const idx = g.index.array;
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (headW[idx[t]] > 0.5 && headW[idx[t + 1]] > 0.5 && headW[idx[t + 2]] > 0.5) continue;
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    g.setIndex(keep);
  });
  for (const o of drop) o.removeFromParent();
}

function loadHead() {
  const tl = new THREE.TextureLoader();
  const tex = (file, srgb) =>
    tl.loadAsync(HEAD_DIR + file).then((t) => {
      t.flipY = true; // the scan's UVs run bottom-up (unlike the body's glTF textures)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  return Promise.all([
    new GLTFLoader().loadAsync(HEAD_DIR + 'LeePerrySmith.glb'),
    tex('Map-COL.jpg', true),
    tex('Infinite-Level_02_Tangent_SmoothUV.jpg', false),
  ]).then(([gltf, map, normalMap]) => {
    let mesh = null;
    gltf.scene.traverse((o) => {
      if (o.isMesh && !mesh) mesh = o;
    });
    const g = mesh.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const sc = HEAD_HEIGHT / (bb.max.y - bb.min.y);
    // Origin at the bottom-centre of the neck, metres.
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(sc, sc, sc);
    // The scan runs down to the shoulders; keep the head and a neck column
    // that tucks into the uniform's collar.
    const pos = g.attributes.position;
    const outside = (v) => {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v) - NECK.z;
      return y < NECK.top && x * x + z * z > NECK.r * NECK.r;
    };
    const idx = g.index.array;
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (outside(idx[t]) || outside(idx[t + 1]) || outside(idx[t + 2])) continue;
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    g.setIndex(keep);
    g.computeBoundingSphere();
    return { geometry: g, map, normalMap };
  });
}

// Wraparound ballistic glasses (head-mesh space: +Z is the face). The scan
// was captured with closed eyes; operators wear eye pro anyway.
let glassesGeo = null;
const glassesMat = new THREE.MeshStandardMaterial({ color: 0x3a4650, metalness: 1, roughness: 0.06, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 });
export const NECK = { top: 0.12, r: 0.066, z: -0.012 };
export const GLASSES = { y: 0.203, z: -0.004, r: 0.089 };
function makeGlasses() {
  if (!glassesGeo) {
    glassesGeo = {
      // A band of a sphere: curves around the face both ways like real wraparounds.
      lens: new THREE.SphereGeometry(GLASSES.r, 24, 4, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.19, 0.36),
      arm: new THREE.BoxGeometry(0.005, 0.008, 0.085),
    };
  }
  const g = new THREE.Group();
  g.position.set(0, GLASSES.y, GLASSES.z);
  g.add(new THREE.Mesh(glassesGeo.lens, glassesMat));
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(glassesGeo.arm, frameMat);
    arm.position.set(sx * GLASSES.r * 0.8, 0.004, GLASSES.z + 0.005);
    g.add(arm);
  }
  return g;
}

// --- Headgear fitted to the scanned head (mesh space: +Y up, +Z face) ----------
const gearGeo = {};
function gg(key, make) {
  return gearGeo[key] || (gearGeo[key] = make());
}
function part(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

// Neck gaiter: bridges the scanned neck into the uniform's collar.
function gaiterGeo() {
  return gg('gaiter', () => new THREE.CylinderGeometry(NECK.r + 0.004, NECK.r + 0.016, 0.085, 18, 1, true));
}

// kind: 'helmet' | 'nvg' | 'cap' | 'beanie'; mats: { shell, gear }
function buildHeadgear(kind, mats) {
  const g = new THREE.Group();
  const shell = mats.shell;
  shell.side = THREE.DoubleSide; // the open shells are seen from below and behind
  const gear = mats.gear;
  gear.side = THREE.DoubleSide;
  const black = gg('blackMat', () => new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.7 }));
  if (kind === 'helmet' || kind === 'nvg') {
    // High-cut ballistic helmet: a dome tilted so the brow edge sits above
    // the eyes and the back drops over the occiput, cut high over the ears.
    const dome = part(
      gg('dome', () => new THREE.SphereGeometry(0.118, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)),
      shell, 0, 0.214, -0.014, -0.3
    );
    dome.scale.set(0.94, 0.9, 1.05);
    g.add(dome);
    // Side accessory rails, front shroud, rear counterweight pouch, top patch.
    const rail = gg('rail', () => new THREE.BoxGeometry(0.012, 0.022, 0.1));
    for (const sx of [-1, 1]) {
      g.add(part(rail, gear, sx * 0.108, 0.222, -0.01, -0.3, 0, sx * 0.12));
    }
    g.add(part(gg('shroud', () => new THREE.BoxGeometry(0.05, 0.035, 0.016)), black, 0, 0.268, 0.1, -0.55));
    g.add(part(gg('pouch', () => new THREE.BoxGeometry(0.075, 0.05, 0.028)), gear, 0, 0.222, -0.13, 0.35));
    g.add(part(gg('patch', () => new THREE.BoxGeometry(0.05, 0.004, 0.06)), gear, 0, 0.322, -0.01));
    if (kind === 'nvg') {
      // Mount arm and dual tubes flipped down in front of the eyes.
      g.add(part(gg('nvgArm', () => new THREE.BoxGeometry(0.026, 0.05, 0.018)), black, 0, 0.243, 0.118, -0.2));
      g.add(part(gg('nvgBridge', () => new THREE.BoxGeometry(0.07, 0.026, 0.03)), black, 0, 0.214, 0.132));
      const tube = gg('nvgTube', () => new THREE.CylinderGeometry(0.016, 0.019, 0.06, 14));
      for (const sx of [-1, 1]) g.add(part(tube, black, sx * 0.031, 0.207, 0.15, Math.PI / 2));
    }
  } else if (kind === 'cap') {
    const crown = part(gg('capCrown', () => new THREE.SphereGeometry(0.104, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), shell, 0, 0.222, -0.012, -0.04);
    crown.scale.set(0.95, 0.8, 1.04);
    g.add(crown);
    const brim = part(gg('capBrim', () => new THREE.CylinderGeometry(0.08, 0.08, 0.01, 20, 1, false, -Math.PI / 2, Math.PI)), shell, 0, 0.226, 0.07, 0.22);
    brim.scale.z = 0.95;
    g.add(brim);
  } else if (kind === 'beanie') {
    const b = part(gg('beanie', () => new THREE.SphereGeometry(0.106, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), gear, 0, 0.215, -0.014, -0.22);
    b.scale.set(0.95, 0.98, 1.05);
    g.add(b);
    const cuff = part(gg('beanieCuff', () => new THREE.TorusGeometry(0.098, 0.012, 6, 32)), gear, 0, 0.205, -0.014, Math.PI / 2 - 0.22);
    cuff.scale.set(0.95, 1.05, 1);
    g.add(cuff);
  }
  return g;
}

// A few natural skin tones; the scan's own albedo is the lightest.
const SKIN_TONES = [0xffffff, 0xf2e2d4, 0xd8bfaa, 0xa88e7c, 0x76604f];
const headMaterials = new Map();
function headMaterial(tone) {
  if (!headMaterials.has(tone)) {
    headMaterials.set(
      tone,
      new THREE.MeshStandardMaterial({
        map: base.head.map,
        normalMap: base.head.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        color: SKIN_TONES[tone],
        roughness: 0.58,
        metalness: 0,
      })
    );
  }
  return headMaterials.get(tone);
}

export function preloadHumanSoldier() {
  if (!loading) {
    loading = Promise.all([new GLTFLoader().loadAsync(MODEL_URL), loadHead()])
      .then(([gltf, head]) => {
        stripHelmet(gltf.scene);
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const height = box.max.y - box.min.y;
        let bodyMaterial = null;
        gltf.scene.traverse((o) => {
          if (o.isSkinnedMesh && o.material?.map && !bodyMaterial && /body/i.test(o.material.name)) bodyMaterial = o.material;
        });
        base = {
          scene: gltf.scene,
          clips: gltf.animations,
          scale: TARGET_HEIGHT / height,
          bodyMaterial,
          head,
        };
        return base;
      })
      .catch((err) => {
        console.warn('[soldier] realistic character failed to load, using the procedural one:', err);
        return null;
      });
  }
  return loading;
}

export function humanSoldierReady() {
  return !!base;
}

// --- Camo uniforms ------------------------------------------------------------
// The body atlas holds painted armour plates (tan, with red stripes), olive
// fabric, a black undersuit and grey metal fittings. Plates and fabric take
// the player's camo, modulated by the atlas's own shading so seams, scuffs and
// straps still read; black cloth and metal hardware keep their original look.
const uniformCache = new Map();

// Returns the shading multiplier for pixels that should take camo, or -1.
function camoShade(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 48) return -1; // black undersuit, gloves, boots
  if (b > r + 6) return -1; // blue-grey metal fittings
  const lum = r * 0.3 + g * 0.59 + b * 0.11;
  if (g > r * 0.95 && g > b) return Math.min(0.85, (lum / 80) * 0.62); // olive fabric: darker camo
  if (r > g * 1.6) return 0.92; // red stripes: painted over
  return Math.min(1.15, lum / 175); // tan plates (chips/scuffs come out darker)
}

export function soldierMaterialFor(skin, camoCanvasFn) {
  if (!base?.bodyMaterial) return null;
  const key = skin?.id || 'default';
  if (uniformCache.has(key)) return uniformCache.get(key);
  const src = base.bodyMaterial;
  const mat = src.clone();
  try {
    const img = src.map.image;
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const camo = camoCanvasFn ? camoCanvasFn(skin, 512) : null;
    const cdata = camo ? camo.getContext('2d').getImageData(0, 0, camo.width, camo.height) : null;
    const cw = camo ? camo.width : 1;
    const ch = camo ? camo.height : 1;
    const solid = new THREE.Color(skin?.color ?? 0x4b5a35);
    const d = data.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const shade = camoShade(r, g, b);
        if (shade < 0) continue;
        let cr;
        let cg;
        let cb;
        if (cdata) {
          const j = (((y * 3) % ch) * cw + ((x * 3) % cw)) * 4; // camo tiled ~3x across the atlas
          cr = cdata.data[j];
          cg = cdata.data[j + 1];
          cb = cdata.data[j + 2];
        } else {
          cr = solid.r * 255;
          cg = solid.g * 255;
          cb = solid.b * 255;
        }
        // Fade in from the black edges so seams don't get a hard outline.
        const k = Math.min(1, (Math.max(r, g, b) - 48) / 30);
        d[i] = Math.min(255, cr * shade * k + r * (1 - k));
        d[i + 1] = Math.min(255, cg * shade * k + g * (1 - k));
        d[i + 2] = Math.min(255, cb * shade * k + b * (1 - k));
      }
    }
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = src.map.flipY;
    tex.wrapS = src.map.wrapS;
    tex.wrapT = src.map.wrapT;
    tex.anisotropy = 4;
    mat.map = tex;
  } catch (err) {
    console.warn('[soldier] camo recolour failed, tinting instead:', err);
    mat.color = new THREE.Color(skin?.color ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.45);
  }
  uniformCache.set(key, mat);
  return mat;
}

// --- Zombie skin and clothes --------------------------------------------------
// Each look is painted once on a canvas from the real textures and shared by
// every zombie that uses it (3 faces, 3 uniforms). Blood is painted twice with
// the same random sequence: into the colour map, and into a small roughness
// map so fresh blood reads wet and glossy under a flashlight.
const ZOMBIE_LOOKS = 3;
const zombieHeads = [];
const zombieBodies = [];

function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise on a `cells` grid, sampled at u,v in 0..1.
function valueNoise(rand, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % cells) + cells) % cells;
    const y0 = ((yi % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells;
    const y1 = (y0 + 1) % cells;
    const a = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * fx;
    const b = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * fx;
    return a + (b - a) * fy;
  };
}

// Samples fn(u, v) on a size² grid. The noise is smooth, so the texture
// loops read it at half resolution instead of evaluating it for every pixel.
const FIELD = 512;
function noiseField(fn) {
  const f = new Float32Array(FIELD * FIELD);
  for (let y = 0; y < FIELD; y++) for (let x = 0; x < FIELD; x++) f[y * FIELD + x] = fn(x / FIELD, y / FIELD);
  return f;
}

// Blood painters (texture pixel coordinates). `paint` maps 'fresh' / 'dried'
// to a fill colour: deep reds for the albedo, dark / mid greys for roughness.
function bloodBlob(ctx, paint, kind, x, y, r, alpha, rand, stretchY = 1) {
  const pts = 11;
  const grad = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
  grad.addColorStop(0, paint[kind]);
  grad.addColorStop(0.65, paint[kind]);
  grad.addColorStop(1, paint[kind].replace('rgb(', 'rgba(').replace(')', ',0)'));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let k = 0; k <= pts; k++) {
    const a = (k / pts) * Math.PI * 2;
    const rr = r * (0.6 + rand() * 0.55);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * stretchY;
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// A run of blood that thins as it trickles down, ending in a bead.
function bloodDrip(ctx, paint, kind, x, y, len, w, alpha, rand) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = ctx.fillStyle = paint[kind];
  ctx.lineCap = 'round';
  let px = x;
  let py = y;
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const nx = px + (rand() - 0.5) * w * 0.9;
    const ny = y + (len * i) / steps;
    ctx.lineWidth = w * (1 - (i / steps) * 0.65);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    px = nx;
    py = ny;
  }
  ctx.beginPath();
  ctx.arc(px, py, w * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function bloodSpatter(ctx, paint, kind, x, y, spread, n, size, rand) {
  ctx.fillStyle = paint[kind];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = spread * Math.pow(rand(), 0.7);
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.3 + rand()) * (1 - (d / spread) * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const ALBEDO_PAINT = { fresh: 'rgb(72,8,6)', dried: 'rgb(44,15,11)', dark: 'rgb(17,8,7)' };
const ROUGH_PAINT = { fresh: 'rgb(78,78,78)', dried: 'rgb(140,140,140)', dark: 'rgb(120,120,120)' };
// The uniform's blood is mostly soaked in and dried: browner, less glossy.
const CLOTH_PAINT = { fresh: 'rgb(56,14,10)', dried: 'rgb(40,20,14)', dark: 'rgb(22,12,9)' };
const CLOTH_ROUGH = { fresh: 'rgb(130,130,130)', dried: 'rgb(200,200,200)', dark: 'rgb(180,180,180)' };

function canvasTexture(c, like, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = like.flipY;
  t.wrapS = like.wrapS;
  t.wrapT = like.wrapT;
  t.anisotropy = 4;
  return t;
}

// Face layout of the scan's colour map (1024² pixels, flipY false).
const FACE_UV = { eyes: [[445, 303], [568, 303]], mouth: [510, 480], chin: [505, 595], neck: [505, 720] };
// Per look: skin tint (ashen grey-green, grey-blue corpse, jaundiced) and decay tone.
const ZOMBIE_SKIN = [
  { tint: [0.78, 0.84, 0.72], decay: [72, 58, 44], bruise: [78, 52, 70] },
  { tint: [0.8, 0.83, 0.86], decay: [60, 54, 62], bruise: [70, 46, 72] },
  { tint: [0.84, 0.84, 0.64], decay: [86, 78, 40], bruise: [82, 56, 52] },
];

function paintHeadBlood(ctx, paint, look, seed) {
  const rand = seededRand(seed);
  const [mx, my] = FACE_UV.mouth;
  const [cx, cy] = FACE_UV.chin;
  // Gore round the mouth: blackened, crusted, with fresh blood on top.
  bloodBlob(ctx, paint, 'dried', mx, my + 26, 62, 0.65, rand, 0.8);
  bloodBlob(ctx, paint, 'dark', mx, my + 2, 52, 0.92, rand, 0.42);
  bloodBlob(ctx, paint, 'fresh', mx + (rand() - 0.5) * 30, my + 44, 20, 0.5, rand, 0.9);
  bloodSpatter(ctx, paint, 'dark', mx, my + 6, 70, 40, 7, rand);
  // Runs from the lips over the chin and down the throat.
  const runs = 7 + Math.floor(rand() * 4);
  for (let i = 0; i < runs; i++) {
    const x = mx - 55 + rand() * 110;
    bloodDrip(ctx, paint, rand() < 0.5 ? 'fresh' : 'dried', x, my + 10, 110 + rand() * 230, 8 + rand() * 12, 0.85, rand);
  }
  bloodBlob(ctx, paint, 'dried', cx, cy + 10, 85, 0.7, rand, 0.8);
  bloodBlob(ctx, paint, 'dried', FACE_UV.neck[0] + (rand() - 0.5) * 60, FACE_UV.neck[1], 105, 0.45, rand, 1.2);
  bloodSpatter(ctx, paint, 'fresh', mx, my - 30, 190, 70, 5, rand);
  bloodSpatter(ctx, paint, 'dried', mx, cy, 260, 50, 6, rand);
  if (look === 0) {
    // Scalp gash with blood run down the forehead.
    bloodBlob(ctx, paint, 'dark', 600, 165, 34, 0.9, rand, 0.35);
    bloodBlob(ctx, paint, 'fresh', 600, 168, 24, 0.9, rand, 0.4);
    for (let i = 0; i < 3; i++) bloodDrip(ctx, paint, 'dried', 585 + rand() * 30, 170, 90 + rand() * 60, 7 + rand() * 5, 0.8, rand);
  } else if (look === 1) {
    // Nosebleed from both nostrils.
    for (const x of [492, 528]) bloodDrip(ctx, paint, 'fresh', x, 432, 52, 12, 0.9, rand);
  } else {
    // Bite wound torn out of the side of the neck; bloody tears from the eyes.
    bloodBlob(ctx, paint, 'dried', 345, 690, 95, 0.75, rand);
    bloodBlob(ctx, paint, 'dark', 345, 690, 48, 1, rand, 0.7);
    bloodBlob(ctx, paint, 'fresh', 340, 694, 28, 1, rand, 0.7);
    for (let i = 0; i < 4; i++) bloodDrip(ctx, paint, 'fresh', 320 + rand() * 50, 720, 120 + rand() * 120, 10 + rand() * 8, 0.9, rand);
    for (const [ex, ey] of FACE_UV.eyes) bloodDrip(ctx, paint, 'dried', ex + (rand() - 0.5) * 20, ey + 22, 120 + rand() * 60, 7, 0.75, rand);
  }
}

function zombieHeadMaterial(look) {
  if (zombieHeads[look]) return zombieHeads[look];
  const src = base.head.map;
  const img = src.image;
  const w = img.width;
  const h = img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const sk = ZOMBIE_SKIN[look];
  const rand = seededRand(1000 + look * 77);
  const n1 = valueNoise(rand, 9);
  const n2 = valueNoise(rand, 26);
  const n3 = valueNoise(rand, 70);
  const ss = THREE.MathUtils.smoothstep;
  // Mottled lividity: blotchy darkening, then patches of rot and bruising.
  const nMain = noiseField((u, v) => n1(u, v) * 0.55 + n2(u, v) * 0.3 + n3(u, v) * 0.15);
  const nFine = noiseField((u, v) => n3(u + 0.5, v));
  const nBruise = noiseField((u, v) => ss(n1(u + 0.37, v + 0.21) * 0.7 + n2(u, v + 0.5) * 0.3, 0.55, 0.85) * 0.55);
  const sx = w / 1024;
  for (let y = 0; y < h; y++) {
    const fy = Math.floor((y * FIELD) / h) * FIELD;
    const py = y / sx;
    for (let x = 0; x < w; x++) {
      const j = fy + Math.floor((x * FIELD) / w);
      const i = (y * w + x) * 4;
      const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      // Drained of colour: mostly grey, a little of the original blush left.
      let r = (lum * 0.8 + d[i] * 0.2) * sk.tint[0] * 0.74;
      let g = (lum * 0.8 + d[i + 1] * 0.2) * sk.tint[1] * 0.74;
      let b = (lum * 0.8 + d[i + 2] * 0.2) * sk.tint[2] * 0.74;
      const n = nMain[j];
      const mottle = 1 - (n - 0.45) * 0.8 - (nFine[j] - 0.5) * 0.12;
      r *= mottle;
      g *= mottle;
      b *= mottle;
      const rot = ss(n, 0.54, 0.78) * 0.7;
      const bruise = nBruise[j];
      r += (sk.decay[0] - r) * rot + (sk.bruise[0] - r) * bruise;
      g += (sk.decay[1] - g) * rot + (sk.bruise[1] - g) * bruise;
      b += (sk.decay[2] - b) * rot + (sk.bruise[2] - b) * bruise;
      let dark = 0;
      if (py > 240 && py < 520) {
        // Sunken, dark-ringed eye sockets; the lids almost black where they
        // part around the eyeball.
        const px = x / sx;
        let sock = 0;
        let lid = 0;
        for (const [ex, ey] of FACE_UV.eyes) {
          const dx = (px - ex) / 58;
          const dy = (py - ey - 4) / 38;
          sock = Math.max(sock, 1 - ss(dx * dx + dy * dy, 0.15, 1));
          const gx = (px - ex) / 40;
          const gy = (py - ey) / 15;
          lid = Math.max(lid, 1 - ss(gx * gx + gy * gy, 0.3, 1));
        }
        // Lips blackened and drawn back.
        const lx = (px - FACE_UV.mouth[0]) / 66;
        const ly = (py - FACE_UV.mouth[1]) / 24;
        const lip = 1 - ss(lx * lx + ly * ly, 0.2, 1);
        dark = Math.max(sock * 0.6, lip * 0.75, lid * 0.88);
      }
      r += (52 - r) * dark;
      g += (36 - g) * dark;
      b += (48 - b) * dark;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(data, 0, 0);
  // Dark veins showing through on the temples and throat.
  const vr = seededRand(3000 + look);
  ctx.strokeStyle = 'rgba(36,30,52,0.4)';
  ctx.lineCap = 'round';
  for (const [vx, vy, spread] of [[330, 260, 90], [690, 260, 90], [430, 760, 140], [600, 760, 140]]) {
    for (let k = 0; k < 4; k++) {
      let px = (vx + (vr() - 0.5) * spread) * sx;
      let py = (vy + (vr() - 0.5) * spread) * sx;
      ctx.lineWidth = (1.5 + vr() * 2) * sx;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let s = 0; s < 7; s++) {
        px += (vr() - 0.5) * 34 * sx;
        py += (vr() - 0.3) * 30 * sx;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.scale(sx, sx);
  paintHeadBlood(ctx, ALBEDO_PAINT, look, 500 + look);
  ctx.restore();

  // Roughness: waxy dead skin, glossy where the blood is fresh.
  const rc = document.createElement('canvas');
  rc.width = rc.height = 256;
  const rctx = rc.getContext('2d');
  rctx.fillStyle = 'rgb(160,160,160)';
  rctx.fillRect(0, 0, 256, 256);
  rctx.scale(0.25, 0.25);
  paintHeadBlood(rctx, ROUGH_PAINT, look, 500 + look);

  const mat = new THREE.MeshStandardMaterial({
    map: canvasTexture(c, src, true),
    roughnessMap: canvasTexture(rc, src, false),
    normalMap: base.head.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 1,
    metalness: 0,
  });
  zombieHeads[look] = mat;
  return mat;
}

// Filthy, blood-soaked version of the body atlas: armour plates and fabric
// faded to grimy greys and browns, black cloth lifted to dirty charcoal,
// caked mud, then large stains, splashes and runs of blood.
function paintBodyBlood(ctx, paint, look) {
  const rand = seededRand(7000 + look * 31);
  const stains = 16 + look * 5;
  for (let i = 0; i < stains; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    bloodBlob(ctx, paint, rand() < 0.3 ? 'fresh' : 'dried', x, y, 20 + rand() * 55, 0.5 + rand() * 0.35, rand, 0.7 + rand() * 0.8);
    if (rand() < 0.6) {
      for (let k = 0; k < 3; k++) bloodDrip(ctx, paint, 'dried', x + (rand() - 0.5) * 50, y, 50 + rand() * 120, 6 + rand() * 8, 0.75, rand);
    }
    if (rand() < 0.5) bloodSpatter(ctx, paint, 'fresh', x, y, 90, 25, 4, rand);
  }
}

function zombieBodyMaterial(look) {
  if (zombieBodies[look]) return zombieBodies[look];
  const src = base.bodyMaterial;
  const mat = src.clone();
  try {
    const img = src.map.image;
    const w = img.width;
    const h = img.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;
    const rand = seededRand(9000 + look * 13);
    const n1 = valueNoise(rand, 12);
    const n2 = valueNoise(rand, 40);
    const n3 = valueNoise(rand, 140);
    const nMain = noiseField((u, v) => n1(u, v) * 0.6 + n2(u, v) * 0.4);
    const nFine = noiseField(n3);
    // Faded fabric colour per look: drab olive, dusty grey, stained khaki.
    const cloth = [[80, 78, 62], [74, 74, 72], [90, 80, 62]][look];
    for (let y = 0; y < h; y++) {
      const fy = Math.floor((y * FIELD) / h) * FIELD;
      for (let x = 0; x < w; x++) {
        const j = fy + Math.floor((x * FIELD) / w);
        const i = (y * w + x) * 4;
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];
        const max = Math.max(r, g, b);
        const lum = r * 0.3 + g * 0.59 + b * 0.11;
        if (max < 48) {
          // Black undersuit: dusty charcoal.
          r = g = b = 22 + lum * 0.6;
          r += 6;
          g += 4;
        } else if (b > r + 6) {
          // Metal fittings: dulled.
          r = g = b = lum * 0.6;
        } else {
          // Plates and fabric: drab cloth shaded by the atlas's own detail.
          const s = Math.min(1.1, lum / 170) * (g > r * 0.95 ? 0.7 : 1);
          r = cloth[0] * s;
          g = cloth[1] * s;
          b = cloth[2] * s;
        }
        // Grime everywhere, caked mud in patches, fine fibre noise.
        const n = nMain[j];
        const grime = 0.78 + (nFine[j] - 0.5) * 0.25 - (n - 0.5) * 0.35;
        r *= grime;
        g *= grime;
        b *= grime;
        const mud = THREE.MathUtils.smoothstep(n, 0.52, 0.7) * 0.8;
        r += (58 - r) * mud;
        g += (46 - g) * mud;
        b += (32 - b) * mud;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    }
    ctx.putImageData(data, 0, 0);
    const sx = w / 1024;
    ctx.save();
    ctx.scale(sx, sx);
    paintBodyBlood(ctx, CLOTH_PAINT, look);
    ctx.restore();
    const rc = document.createElement('canvas');
    rc.width = rc.height = 256;
    const rctx = rc.getContext('2d');
    rctx.fillStyle = 'rgb(240,240,240)';
    rctx.fillRect(0, 0, 256, 256);
    rctx.scale(0.25, 0.25);
    paintBodyBlood(rctx, CLOTH_ROUGH, look);
    mat.map = canvasTexture(c, src.map, true);
    mat.roughnessMap = canvasTexture(rc, src.map, false);
    mat.roughness = 1;
  } catch (err) {
    console.warn('[zombie] uniform repaint failed, tinting instead:', err);
    mat.color = new THREE.Color(0x6a5e4c);
  }
  zombieBodies[look] = mat;
  return mat;
}

// Dead eyes: milky, clouded corneas over a bloodshot yellowed sclera. A very
// faint emissive keeps a dull sheen in the dark; the wet, low-roughness
// surface catches a flashlight.
let eyeAssets = null;
function zombieEyes() {
  if (eyeAssets) return eyeAssets;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(150,140,112)';
  ctx.fillRect(0, 0, 128, 64);
  const rand = seededRand(42);
  ctx.strokeStyle = 'rgba(130,20,18,0.7)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 26; i++) {
    // Veins creep in from the edges toward the iris (front at u = 0.25).
    let x = 32 + (rand() < 0.5 ? -1 : 1) * (14 + rand() * 18);
    let y = 32 + (rand() - 0.5) * 40;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (32 - x) * 0.18 + (rand() - 0.5) * 4;
      y += (32 - y) * 0.18 + (rand() - 0.5) * 4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const iris = ctx.createRadialGradient(32, 32, 0, 32, 32, 11);
  iris.addColorStop(0, 'rgb(176,180,176)');
  iris.addColorStop(0.35, 'rgb(146,154,154)');
  iris.addColorStop(0.8, 'rgb(104,112,110)');
  iris.addColorStop(1, 'rgba(96,94,80,0)');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(32, 32, 11, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.22,
    metalness: 0,
    emissive: 0xb8c4c0,
    emissiveMap: tex,
    emissiveIntensity: 0.035,
  });
  eyeAssets = { geo: new THREE.SphereGeometry(ZOMBIE_EYE.r, 18, 12), mat };
  return eyeAssets;
}
// Eyeballs in head-mesh space: centred under the bulge of each closed lid
// (the scan's face is slightly off-centre), sunk so ~2 mm shows past the lid.
export const ZOMBIE_EYE = { x: [-0.028, 0.018], y: 0.2135, z: 0.0738 - 0.006, r: 0.011, open: 0.5, depth: 0.72 };

// Pre-paint every zombie look (avoids a hitch when the first ones spawn).
// Returns the shared materials: [{ head, body }] per look.
export function prepareZombieAssets() {
  if (!base) return [];
  zombieEyes();
  return Array.from({ length: ZOMBIE_LOOKS }, (_, k) => ({ head: zombieHeadMaterial(k), body: zombieBodyMaterial(k) }));
}

// --- Bone helpers ---------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rf = new THREE.Vector3();
const _rt = new THREE.Vector3();

// Rotate a bone so that the world-space direction `from` becomes `to`.
function rotateBoneWorld(bone, from, to) {
  _q.setFromUnitVectors(_rf.copy(from).normalize(), _rt.copy(to).normalize());
  bone.getWorldQuaternion(_q2);
  bone.parent.getWorldQuaternion(_pq);
  _q2.premultiply(_q); // new world rotation
  bone.quaternion.copy(_pq.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

// Apply a world-space rotation (axis/angle) to a bone.
function rotateBoneAxis(bone, axisWorld, angle) {
  _q.setFromAxisAngle(axisWorld, angle);
  bone.getWorldQuaternion(_q2);
  bone.parent.getWorldQuaternion(_pq);
  _q2.premultiply(_q);
  bone.quaternion.copy(_pq.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

// Two-bone IK: upper → lower → end reaches `target`, elbow/knee toward `pole`.
// Allocation-free (module scratch vectors): it runs for every arm every frame.
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
function solveLimb(upper, lower, end, target, pole) {
  upper.getWorldPosition(_S);
  lower.getWorldPosition(_E);
  end.getWorldPosition(_W);
  const l1 = _S.distanceTo(_E);
  const l2 = _E.distanceTo(_W);
  _dir.copy(target).sub(_S);
  const d = Math.max(1e-4, Math.min(_dir.length(), (l1 + l2) * 0.999));
  _dir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.copy(pole).addScaledVector(_dir, -pole.dot(_dir)).normalize();
  _y.copy(_S).addScaledVector(_dir, a).addScaledVector(_p, h); // desired elbow
  rotateBoneWorld(upper, _x.copy(_E).sub(_S), _y.sub(_S));
  lower.getWorldPosition(_E);
  end.getWorldPosition(_W);
  _y.copy(_S).addScaledVector(_dir, d).sub(_E); // desired forearm
  rotateBoneWorld(lower, _x.copy(_W).sub(_E), _y);
}

// Curl the fingers (0 = open hand, 1 = fist).
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
function poseFingers(bones, side, curl) {
  for (const f of FINGERS) {
    for (let k = 1; k <= 3; k++) {
      const b = bones[`${side}Hand${f}${k}`];
      if (b) b.rotation.x = curl * (k === 1 ? 0.9 : 1.1);
    }
  }
  const t = bones[`${side}HandThumb1`];
  if (t) t.rotation.z = (side === 'Right' ? -1 : 1) * curl * 0.5;
}

// --- Shared rig: animated body, scanned head on a head tracker, hitboxes --------
// Hitbox shapes are shared by every character (only their transforms differ).
const hitGeo = {};
const sharedHitMat = new THREE.MeshBasicMaterial();

// o: material (body), faceMaterial, hitMaterial. Returns the parts plus
// track(), which moves the head tracker and hitboxes onto the bones.
function buildRig(o) {
  const root = new THREE.Group();
  const body = SkeletonUtils.clone(base.scene);
  body.scale.setScalar(base.scale);
  body.rotation.y = Math.PI; // the rig faces +Z; the game's forward is -Z
  root.add(body);

  const bones = {};
  body.traverse((n) => {
    if (n.isBone) bones[n.name.replace(/^mixamorig:?/, '')] = n;
    if (n.isSkinnedMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
      n.frustumCulled = false;
      if (o.material && n.material?.name === base.bodyMaterial?.name) n.material = o.material;
    }
  });

  // The Head bone's axes are arbitrary (the rig was converted from Z-up), so
  // record its rest orientation relative to the character: the head tracker
  // then carries only the animated delta, in the character's own frame
  // (+Y up, -Z forward).
  root.updateMatrixWorld(true);
  const headRest = bones.Head.getWorldQuaternion(new THREE.Quaternion()).invert();

  const mixer = new THREE.AnimationMixer(body);
  const clip = (n) => base.clips.find((c) => c.name === n);
  const actions = {};
  for (const n of ['Idle', 'Walk', 'Run']) {
    const c = clip(n);
    if (!c) continue;
    const a = mixer.clipAction(c);
    a.play();
    a.setEffectiveWeight(n === 'Idle' ? 1 : 0);
    actions[n] = a;
  }
  mixer.update(Math.random() * 2);

  // Head-follower for the scanned head, headgear and the head hitbox.
  const headTracker = new THREE.Group();
  root.add(headTracker);
  const headInner = new THREE.Group();
  headInner.rotation.y = Math.PI;
  headTracker.add(headInner);
  const face = new THREE.Mesh(base.head.geometry, o.faceMaterial);
  face.position.set(HEAD_OFFSET.x, HEAD_OFFSET.y, HEAD_OFFSET.z);
  face.rotation.x = 0.1; // the scan looks slightly upward; level the gaze
  face.castShadow = true;
  face.receiveShadow = true;
  headInner.add(face);

  // Hitboxes (invisible, raycastable).
  const hitMat = o.hitMaterial || sharedHitMat;
  const headBox = new THREE.Mesh(hitGeo.head || (hitGeo.head = new THREE.BoxGeometry(0.3, 0.32, 0.3)), hitMat);
  headBox.userData.zone = 'head';
  const bodyBox = new THREE.Mesh(hitGeo.body || (hitGeo.body = new THREE.BoxGeometry(0.58, 0.66, 0.46)), hitMat);
  bodyBox.userData.zone = 'body';
  const legBox = new THREE.Mesh(hitGeo.legs || (hitGeo.legs = new THREE.BoxGeometry(0.46, 0.95, 0.4)), hitMat);
  legBox.userData.zone = 'legs';
  const hitboxes = [headBox, bodyBox, legBox];
  for (const h of hitboxes) {
    h.visible = false;
    root.add(h);
  }

  // Head tracker + hitboxes follow the (animated, IK-adjusted) bones.
  function track() {
    bones.Head.getWorldPosition(_a);
    headTracker.position.copy(root.worldToLocal(_c.copy(_a)));
    bones.Head.getWorldQuaternion(_q2).multiply(headRest);
    root.getWorldQuaternion(_pq);
    headTracker.quaternion.copy(_pq.invert().multiply(_q2));
    headBox.position.copy(root.worldToLocal(_a.add(_b.set(0, 0.11, 0))));
    bones.Spine2.getWorldPosition(_c);
    bodyBox.position.copy(root.worldToLocal(_c));
    bones.Hips.getWorldPosition(_c);
    root.worldToLocal(_c);
    legBox.scale.y = Math.max(0.4, _c.y / 0.95);
    legBox.position.set(0, _c.y / 2, 0);
  }

  return { root, body, bones, mixer, actions, headTracker, face, headBox, bodyBox, legBox, hitboxes, track };
}

/**
 * @param {object} o
 *   name, nameSprite, gunFactory(key) -> { group, muzzle, flash, gripR:Vector3, gripL:Vector3 }
 *   material (camo body material), headgear (kind), headgearMats { shell, gear },
 *   skinTone (0..4), glasses (default true), hitMaterial
 */
export function createHumanSoldier(o) {
  const tone = Number.isInteger(o.skinTone) ? o.skinTone : Math.floor(Math.random() * SKIN_TONES.length);
  const rig = buildRig({ ...o, faceMaterial: headMaterial(THREE.MathUtils.clamp(tone, 0, SKIN_TONES.length - 1)) });
  const { root, bones, mixer, actions, face, hitboxes, bodyBox } = rig;

  // The weapon hangs off an aim pivot at chest height that pitches with aim.
  const aim = new THREE.Group();
  root.add(aim);
  let gun = null;
  const gripR = new THREE.Object3D();
  const gripL = new THREE.Object3D();
  aim.add(gripR, gripL);

  function setWeapon(key) {
    if (gun) gun.group.removeFromParent();
    gun = o.gunFactory(key);
    if (!gun) return;
    aim.add(gun.group);
    gripR.position.copy(gun.gripR);
    gripL.position.copy(gun.gripL);
  }

  if (o.glasses !== false) face.add(makeGlasses());
  // Neck gaiter: bridges the scanned neck into the uniform's collar.
  const gaiter = new THREE.Mesh(
    gaiterGeo(),
    gg('gaiterMat', () => new THREE.MeshStandardMaterial({ color: 0x2c2f27, roughness: 0.95, side: THREE.DoubleSide }))
  );
  gaiter.position.set(0, 0.03, NECK.z);
  gaiter.castShadow = true;
  face.add(gaiter);
  if (o.headgear && o.headgear !== 'none') face.add(buildHeadgear(o.headgear, o.headgearMats));

  if (o.nameSprite) {
    o.nameSprite.position.y = 2.15;
    root.add(o.nameSprite);
  }

  let pitch = 0;
  let crouchT = 0;
  let speedSmoothed = 0;
  let deathT = -1;
  let flashT = 0;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function update(dt, crouching, speed) {
    // --- 1. animation (legs/body motion) ---
    speedSmoothed += (speed - speedSmoothed) * Math.min(1, dt * 8);
    const walkW = THREE.MathUtils.smoothstep(speedSmoothed, 0.3, 1.6) * (1 - THREE.MathUtils.smoothstep(speedSmoothed, 4.2, 6));
    const runW = THREE.MathUtils.smoothstep(speedSmoothed, 4.2, 6);
    if (actions.Idle) actions.Idle.setEffectiveWeight(Math.max(0, 1 - walkW - runW));
    if (actions.Walk) {
      actions.Walk.setEffectiveWeight(walkW);
      actions.Walk.timeScale = THREE.MathUtils.clamp(speedSmoothed / 1.6, 0.6, 1.8);
    }
    if (actions.Run) {
      actions.Run.setEffectiveWeight(runW);
      actions.Run.timeScale = THREE.MathUtils.clamp(speedSmoothed / 6, 0.7, 1.4);
    }
    mixer.update(dt);
    root.updateMatrixWorld(true);

    right.set(1, 0, 0).applyQuaternion(root.quaternion);
    fwd.set(0, 0, -1).applyQuaternion(root.quaternion);

    // --- 2. crouch: drop the hips, keep the feet planted ---
    crouchT += ((crouching ? 1 : 0) - crouchT) * Math.min(1, dt * 10);
    if (crouchT > 0.01 && bones.Hips) {
      const footL = bones.LeftFoot.getWorldPosition(new THREE.Vector3());
      const footR = bones.RightFoot.getWorldPosition(new THREE.Vector3());
      const drop = 0.42 * crouchT;
      const hp = bones.Hips.getWorldPosition(new THREE.Vector3());
      hp.y -= drop;
      hp.addScaledVector(fwd, -0.12 * crouchT);
      bones.Hips.position.copy(bones.Hips.parent.worldToLocal(hp));
      bones.Hips.updateMatrixWorld(true);
      const knee = fwd.clone().multiplyScalar(1).add(new THREE.Vector3(0, 0.2, 0));
      solveLimb(bones.LeftUpLeg, bones.LeftLeg, bones.LeftFoot, footL, knee.clone().addScaledVector(right, -0.25));
      solveLimb(bones.RightUpLeg, bones.RightLeg, bones.RightFoot, footR, knee.clone().addScaledVector(right, 0.25));
      rotateBoneAxis(bones.Spine, right, -0.22 * crouchT);
    }

    // --- 3. torso follows aim; rifle stance turns the shoulders slightly ---
    const stanceTwist = 0.18;
    rotateBoneAxis(bones.Spine, up, stanceTwist * 0.5);
    for (const n of ['Spine1', 'Spine2']) {
      rotateBoneAxis(bones[n], up, stanceTwist * 0.25);
      rotateBoneAxis(bones[n], right, pitch * 0.28);
    }
    rotateBoneAxis(bones.Neck, up, -stanceTwist);
    rotateBoneAxis(bones.Head, right, pitch * 0.25);

    // --- 4. weapon at the shoulders, arms solved onto its grips ---
    const shoulderR = bones.RightArm.getWorldPosition(new THREE.Vector3());
    const shoulderL = bones.LeftArm.getWorldPosition(new THREE.Vector3());
    const mid = shoulderR.clone().add(shoulderL).multiplyScalar(0.5);
    aim.position.copy(root.worldToLocal(mid));
    aim.rotation.set(pitch, 0, 0);
    aim.updateMatrixWorld(true);
    if (gun) {
      const tR = gripR.getWorldPosition(new THREE.Vector3());
      const tL = gripL.getWorldPosition(new THREE.Vector3());
      const elbowPoleR = right.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, -1, 0));
      const elbowPoleL = right.clone().multiplyScalar(-0.7).add(new THREE.Vector3(0, -1, 0));
      solveLimb(bones.RightArm, bones.RightForeArm, bones.RightHand, tR, elbowPoleR);
      solveLimb(bones.LeftArm, bones.LeftForeArm, bones.LeftHand, tL, elbowPoleL);
      // Hands: fingers wrap the pistol grip (pointing down/forward) and cup
      // the handguard (pointing across/up).
      const gunFwd = tmp.set(0, 0, -1).applyQuaternion(aim.getWorldQuaternion(_q2)).clone();
      const gunDown = new THREE.Vector3(0, -1, 0).applyQuaternion(_q2);
      const handDirR = bones.RightHandMiddle1
        ? bones.RightHandMiddle1.getWorldPosition(new THREE.Vector3()).sub(bones.RightHand.getWorldPosition(_a))
        : null;
      if (handDirR) rotateBoneWorld(bones.RightHand, handDirR, gunDown.clone().multiplyScalar(0.8).addScaledVector(gunFwd, 0.6));
      const handDirL = bones.LeftHandMiddle1
        ? bones.LeftHandMiddle1.getWorldPosition(new THREE.Vector3()).sub(bones.LeftHand.getWorldPosition(_a))
        : null;
      if (handDirL) rotateBoneWorld(bones.LeftHand, handDirL, gunFwd.clone().multiplyScalar(0.7).addScaledVector(right, 0.5).addScaledVector(gunDown, 0.2));
      poseFingers(bones, 'Right', 0.85);
      poseFingers(bones, 'Left', 0.7);
    }

    // --- 5. trackers: headgear + hitboxes follow the bones ---
    rig.track();
  }

  return {
    group: root,
    hitbox: bodyBox,
    hitboxes,
    get muzzle() {
      return gun ? gun.muzzle : aim;
    },
    setOwner(key, id) {
      for (const h of hitboxes) h.userData[key] = id;
    },
    setPosition(x, y, z, angle) {
      root.position.set(x, y || 0, z);
      root.rotation.y = angle || 0;
    },
    setPitch(p) {
      pitch = THREE.MathUtils.clamp(p || 0, -1.1, 1.1);
    },
    setWeapon,
    setName(n) {
      o.setName?.(n);
    },
    setNameStyle(color, always) {
      o.setNameStyle?.(color, always);
    },
    setNameVisible(v) {
      if (o.nameSprite) o.nameSprite.visible = v;
    },
    setVisible(v) {
      root.visible = v;
      if (v) {
        deathT = -1;
        root.rotation.x = 0;
        root.rotation.z = 0;
      }
    },
    setAirborne() {},
    die() {
      deathT = 0;
    },
    get dying() {
      return deathT >= 0;
    },
    muzzleFlash() {
      if (!gun?.flash) return;
      flashT = 0.06;
      gun.flash.visible = true;
      gun.flash.material.rotation = Math.random() * Math.PI;
    },
    animate(dt, moving, crouching = false, speed = null) {
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0 && gun?.flash) gun.flash.visible = false;
      }
      if (deathT >= 0) {
        // Knees buckle, then the body tips back onto the ground.
        deathT += dt;
        const t = Math.min(1, deathT / 0.7);
        root.rotation.x = t * t * 1.45;
        root.position.y = Math.max(0, root.position.y);
        if (deathT > 4) root.visible = false;
        return;
      }
      update(dt, crouching, speed ?? (moving ? 4 : 0));
    },
    dispose() {
      mixer.stopAllAction();
      o.nameSprite?.userData.texture?.dispose();
    },
  };
}

// --- Zombies -------------------------------------------------------------------
// A dead, rotting human on the same rig: no gun or gear, a decayed face with
// clouded eyes, a filthy blood-soaked uniform, and a procedural layer over the
// idle / walk / run clips:
//   - walker: hunched, swaying, lurching gait (the walk clip surges and drags
//     so it never settles into a rhythm), one or both arms reaching forward;
//   - runner: the run clip leaning hard forward with arms flailing ahead;
//   - attack: wind up, then a two-handed lunging swipe (~0.5 s);
//   - death: knees buckle and the body pitches over (forward, or sometimes
//     back) and lies still before it is hidden.
const ATTACK_TIME = 0.5;

/**
 * @param {object} o  kind: 'walker' | 'runner', seed (integer; picks the look
 *   and the personality), hitMaterial
 */
export function createHumanZombie(o = {}) {
  const runner = o.kind === 'runner';
  const seed = Number.isFinite(o.seed) ? Math.abs(Math.floor(o.seed)) : Math.floor(Math.random() * 1e9);
  const rand = seededRand(seed * 7919 + 13);
  const rig = buildRig({
    material: zombieBodyMaterial(Math.floor(seed / ZOMBIE_LOOKS) % ZOMBIE_LOOKS),
    faceMaterial: zombieHeadMaterial(seed % ZOMBIE_LOOKS),
    hitMaterial: o.hitMaterial,
  });
  const { root, bones, mixer, actions, face, hitboxes, bodyBox } = rig;
  root.rotation.order = 'YXZ'; // the death fall pitches in the zombie's own frame

  const eyes = zombieEyes();
  for (const x of ZOMBIE_EYE.x) {
    const eye = new THREE.Mesh(eyes.geo, eyes.mat);
    eye.position.set(x, ZOMBIE_EYE.y, ZOMBIE_EYE.z);
    eye.scale.set(1, ZOMBIE_EYE.open, ZOMBIE_EYE.depth); // heavy lids, sunk in the socket
    face.add(eye);
  }
  // A filthy, blood-crusted rag where the scanned neck meets the collar.
  const rag = new THREE.Mesh(
    gaiterGeo(),
    gg('zombieRagMat', () => new THREE.MeshStandardMaterial({ color: 0x2b1e17, roughness: 1, side: THREE.DoubleSide }))
  );
  rag.position.set(0, 0.026, NECK.z);
  rag.scale.set(1.04, 0.85, 1.04);
  face.add(rag);

  // Personality, fixed by the seed.
  const gaitRate = 0.8 + rand() * 0.45;
  const limp = 0.3 + rand() * 0.35;
  const tilt = (rand() - 0.5) * 0.7; // head lolls to one side
  const reachY = (rand() - 0.5) * 0.14;
  const pick = rand();
  // Which arms reach out (walkers sometimes drag one limp arm); by side.
  const reach = { right: runner || pick < 0.65 || pick >= 0.85, left: runner || pick < 0.85 };
  const fallDir = rand() < 0.75 ? -1 : 1; // forward (face down) or backward
  const phase = rand() * 20;
  if (actions.Idle) actions.Idle.timeScale = 0.55;

  let t = phase;
  let speedS = 0;
  let attackT = -1;
  let deathT = -1;
  let lift = 0; // raises the fallen body so it rests on the ground
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const shoulder = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const footL = new THREE.Vector3();
  const footR = new THREE.Vector3();
  const bodyUp = new THREE.Vector3();
  const bodyFwd = new THREE.Vector3();
  const ss = THREE.MathUtils.smoothstep;
  const ARMS = [
    { side: 1, reach: reach.right, arm: bones.RightArm, fore: bones.RightForeArm, hand: bones.RightHand },
    { side: -1, reach: reach.left, arm: bones.LeftArm, fore: bones.LeftForeArm, hand: bones.LeftHand },
  ];
  const CONTACT = ['Head', 'Spine2', 'Hips', 'LeftHand', 'RightHand', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'].map((n) => bones[n]);

  // buckle: 0 alive .. 1 knees fully given way (death).
  function update(dt, speed, buckle) {
    t += dt;
    // --- 1. clips: shambling walk / sprint / swaying idle ---
    speedS += (speed - speedS) * Math.min(1, dt * 5);
    const move = ss(speedS, 0.1, 0.7) * (1 - buckle);
    if (runner && actions.Run) {
      actions.Run.setEffectiveWeight(move);
      actions.Run.timeScale = THREE.MathUtils.clamp(speedS / 5.5, 0.55, 1.3) * (1 + 0.12 * Math.sin(t * 3.1));
      if (actions.Walk) actions.Walk.setEffectiveWeight(0);
    } else if (actions.Walk) {
      // Surge then drag: an uneven, limping lurch instead of a steady stride.
      const surge = Math.max(0, Math.sin(t * 2.4 * gaitRate));
      actions.Walk.setEffectiveWeight(move);
      actions.Walk.timeScale = THREE.MathUtils.clamp(speedS / 1.6, 0.35, 1) * (1 - limp + limp * 1.8 * surge);
      if (actions.Run) actions.Run.setEffectiveWeight(0);
    }
    if (actions.Idle) actions.Idle.setEffectiveWeight(1 - move);
    mixer.update(dt);
    root.updateMatrixWorld(true);
    const yaw = root.rotation.y;
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));

    // --- 2. death: knees give way, hips drop, feet stay planted ---
    if (buckle > 0) {
      // In the body's own frame: the root may already be pitching over.
      bodyUp.set(0, 1, 0).applyQuaternion(root.quaternion);
      bodyFwd.set(0, 0, -1).applyQuaternion(root.quaternion);
      bones.LeftFoot.getWorldPosition(footL);
      bones.RightFoot.getWorldPosition(footR);
      bones.Hips.getWorldPosition(tmp);
      tmp.addScaledVector(bodyUp, -0.45 * buckle);
      tmp.addScaledVector(bodyFwd, 0.08 * buckle * fallDir);
      bones.Hips.position.copy(bones.Hips.parent.worldToLocal(tmp));
      bones.Hips.updateMatrixWorld(true);
      pole.copy(bodyFwd).addScaledVector(bodyUp, 0.2).addScaledVector(right, -0.25);
      solveLimb(bones.LeftUpLeg, bones.LeftLeg, bones.LeftFoot, footL, pole);
      pole.addScaledVector(right, 0.5);
      solveLimb(bones.RightUpLeg, bones.RightLeg, bones.RightFoot, footR, pole);
    }

    // --- 3. posture: hunched, swaying, head lolling with sudden twitches ---
    let wind = 0;
    let swipe = 0;
    if (attackT >= 0) {
      const a = attackT / ATTACK_TIME;
      wind = ss(a, 0, 0.3) * (1 - ss(a, 0.3, 0.55));
      swipe = ss(a, 0.3, 0.55) * (1 - ss(a, 0.75, 1));
    }
    const hunch = ((runner ? 0.6 + move * 0.25 : 0.55) + swipe * 0.4 - wind * 0.2) * (deathT >= 0 ? 0 : 1);
    rotateBoneAxis(bones.Spine, right, -hunch * 0.4);
    rotateBoneAxis(bones.Spine1, right, -hunch * 0.35);
    rotateBoneAxis(bones.Spine2, right, -hunch * 0.25);
    const sway = Math.sin(t * (runner ? 3 : 1.6) * gaitRate) * (runner ? 0.05 : 0.1) * (1 - buckle);
    rotateBoneAxis(bones.Spine, fwd, sway);
    const twitch = Math.pow(Math.max(0, Math.sin(t * 0.83 + phase)), 30) * 0.45;
    rotateBoneAxis(bones.Neck, right, hunch * 0.5);
    rotateBoneAxis(bones.Head, fwd, deathT >= 0 ? Math.sign(tilt || 1) * 0.9 : tilt + Math.sin(t * 0.9) * 0.12 - sway * 0.6 + twitch);
    rotateBoneAxis(bones.Head, up, Math.sin(t * 0.53) * 0.18 - twitch * 0.5);

    // --- 4. arms: reaching / flailing / swiping, solved with IK ---
    if (deathT < 0) {
      for (const A of ARMS) {
        const side = A.side;
        const w = A.reach ? 1 : Math.max(wind, swipe);
        if (w < 0.01) continue; // this arm hangs limp with the clip
        A.arm.getWorldPosition(shoulder);
        if (runner) {
          target.copy(shoulder)
            .addScaledVector(fwd, 0.46 + 0.14 * Math.sin(t * 7.3 * gaitRate + side * 2))
            .addScaledVector(up, -0.16 + 0.1 * Math.sin(t * 5.1 + side * 1.7))
            .addScaledVector(right, side * (0.1 + 0.07 * Math.sin(t * 6.2 + side)));
        } else {
          target.copy(shoulder)
            .addScaledVector(fwd, 0.5 + 0.05 * Math.sin(t * 1.7 + side))
            .addScaledVector(up, reachY - 0.1 + 0.05 * Math.sin(t * 2.1 + side * 2))
            .addScaledVector(right, side * 0.06);
        }
        if (wind > 0) {
          // Claws raised beside the head...
          tmp.copy(shoulder).addScaledVector(up, 0.3).addScaledVector(fwd, 0.12).addScaledVector(right, side * 0.24);
          target.lerp(tmp, wind);
        }
        if (swipe > 0) {
          // ...then raked down and across in front of the chest.
          tmp.copy(shoulder).addScaledVector(fwd, 0.64).addScaledVector(up, -0.32).addScaledVector(right, -side * 0.14);
          target.lerp(tmp, swipe);
        }
        if (w < 1) target.lerp(A.hand.getWorldPosition(tmp), 1 - w);
        pole.copy(right).multiplyScalar(side * 0.6).setY(-1);
        solveLimb(A.arm, A.fore, A.hand, target, pole);
      }
    }
    // Hands half-clenched into claws, tightening on the swipe.
    poseFingers(bones, 'Right', 0.3 + swipe * 0.4 + 0.12 * Math.sin(t * 2.7));
    poseFingers(bones, 'Left', 0.3 + swipe * 0.4 + 0.12 * Math.sin(t * 2.3 + 1));

    // --- 5. head tracker + hitboxes ---
    rig.track();
  }

  return {
    group: root,
    hitbox: bodyBox,
    hitboxes,
    kind: runner ? 'runner' : 'walker',
    setOwner(key, id) {
      for (const h of hitboxes) h.userData[key] = id;
    },
    setPosition(x, y, z, angle) {
      root.position.set(x, (y || 0) + lift, z);
      root.rotation.y = angle || 0;
    },
    setVisible(v) {
      root.visible = v;
      if (v && deathT >= 0) {
        deathT = -1;
        root.rotation.x = 0;
        root.position.y -= lift;
        lift = 0;
      }
    },
    attack() {
      if (deathT < 0 && attackT < 0) attackT = 0;
    },
    get attacking() {
      return attackT >= 0;
    },
    die() {
      if (deathT < 0) deathT = 0;
      attackT = -1;
    },
    get dying() {
      return deathT >= 0;
    },
    // speed: m/s along the ground; attacking: keep swiping while true.
    animate(dt, speed = 0, attacking = false) {
      if (deathT >= 0) {
        deathT += dt;
        if (deathT < 1.2) {
          // Knees give way, then the legs go slack as the body hits the ground.
          update(dt, 0, ss(deathT, 0, 0.4) * (1 - 0.85 * ss(deathT, 0.55, 0.95)));
          const f = THREE.MathUtils.clamp((deathT - 0.15) / 0.7, 0, 1);
          root.rotation.x = fallDir * f * f * 1.45;
          // Rest on the ground: the lowest joint stays a body's half-thickness up.
          const groundY = root.position.y - lift;
          root.position.y = groundY;
          root.updateMatrixWorld(true);
          let low = Infinity;
          for (const b of CONTACT) low = Math.min(low, b.getWorldPosition(tmp).y);
          lift = Math.max(0, groundY + 0.1 - low);
          root.position.y = groundY + lift;
        }
        if (deathT > 5) root.visible = false;
        return;
      }
      if (attacking && attackT < 0) attackT = 0;
      if (attackT >= 0) {
        attackT += dt;
        if (attackT >= ATTACK_TIME) attackT = -1;
      }
      update(dt, speed || 0, 0);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.body);
    },
  };
}
