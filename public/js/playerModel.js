// A visible representation of another player: an articulated soldier
// (pelvis, spine, head, jointed legs with knees, arms solved with two-bone
// IK so both hands actually hold the weapon), wearing a camo uniform,
// plate carrier, pouches, backpack, gloves, boots and optional headgear.
//
// The upper body follows the player's aim pitch, the legs walk with a
// knee-bending gait, there is a crouch pose, and a death fall. Separate
// invisible hitboxes for head / torso / legs drive hit-zone damage.
//
// The same builder also produces the fallback zombie (`isZombie: true`).

import * as THREE from 'three';
import { hasProceduralWeapon, thirdPersonWeapon, weaponNodes } from './weaponModels.js';
import { preloadHumanSoldier, humanSoldierReady, createHumanSoldier, soldierMaterialFor, createHumanZombie } from './humanSoldier.js';

// Start loading the realistic soldier right away; until it arrives (or if it
// ever fails) the procedural soldier below is used.
preloadHumanSoldier().then((ok) => ok && window.dispatchEvent(new Event('soldier-ready')));

// --- Camouflage textures ---------------------------------------------------

const camoCache = new Map();

function camoRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeCamoCanvas(skin, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const pal = skin.palette || [`#${skin.color.toString(16).padStart(6, '0')}`];
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, size, size);
  const rand = camoRand(skin.id.length * 977 + size);
  const wrap = (fn) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy);
  };

  if (skin.camo === 'digital') {
    const px = size / 32;
    for (let layer = 1; layer < pal.length; layer++) {
      ctx.fillStyle = pal[layer];
      for (let i = 0; i < 70; i++) {
        let x = Math.floor(rand() * 32);
        let y = Math.floor(rand() * 32);
        const len = 3 + Math.floor(rand() * 8);
        for (let k = 0; k < len; k++) {
          ctx.fillRect(((x + 32) % 32) * px, ((y + 32) % 32) * px, px, px);
          if (rand() < 0.5) x += rand() < 0.5 ? 1 : -1;
          else y += rand() < 0.5 ? 1 : -1;
        }
      }
    }
  } else if (skin.camo === 'tiger') {
    for (let layer = 1; layer < pal.length; layer++) {
      ctx.fillStyle = pal[layer];
      for (let i = 0; i < 9; i++) {
        const y = rand() * size;
        const thick = 4 + rand() * 10;
        wrap((ox, oy) => {
          ctx.beginPath();
          ctx.moveTo(ox, oy + y);
          for (let x = 0; x <= size; x += size / 8) ctx.lineTo(ox + x, oy + y + Math.sin(x * 0.05 + i) * 8 - thick / 2 + (rand() - 0.5) * 6);
          for (let x = size; x >= 0; x -= size / 8) ctx.lineTo(ox + x, oy + y + Math.sin(x * 0.05 + i) * 8 + thick / 2 + (rand() - 0.5) * 6);
          ctx.fill();
        });
      }
    }
  } else if (skin.camo === 'woodland') {
    for (let layer = 1; layer < pal.length; layer++) {
      ctx.fillStyle = pal[layer];
      const blobs = layer === pal.length - 1 ? 14 : 22;
      for (let i = 0; i < blobs; i++) {
        const cx = rand() * size;
        const cy = rand() * size;
        const r = size * (0.04 + rand() * 0.07);
        const pts = 9;
        const radii = Array.from({ length: pts }, () => r * (0.55 + rand() * 0.9));
        const stretch = 1 + rand() * 1.4;
        wrap((ox, oy) => {
          ctx.beginPath();
          for (let k = 0; k <= pts; k++) {
            const a = (k / pts) * Math.PI * 2;
            const rr = radii[k % pts];
            const x = ox + cx + Math.cos(a) * rr * stretch;
            const y = oy + cy + Math.sin(a) * rr;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        });
      }
    }
  }

  // Fabric weave noise so solid colours don't look like plastic.
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 18 + (((i / 4) % 2) - 0.5) * 6;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function uniformMaterial(skin) {
  if (camoCache.has(skin.id)) return camoCache.get(skin.id);
  const tex = new THREE.CanvasTexture(makeCamoCanvas(skin));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
  camoCache.set(skin.id, mat);
  return mat;
}

// --- Name tags -------------------------------------------------------------

function makeNameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.userData = { canvas, ctx, texture, color };
  drawName(sprite, name);
  return sprite;
}

function drawName(sprite, name) {
  const { ctx, canvas, texture, color } = sprite.userData;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 26px "Rajdhani", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(name, canvas.width / 2, 40);
  ctx.fillStyle = color;
  ctx.fillText(name, canvas.width / 2, 40);
  texture.needsUpdate = true;
}

// --- Geometry helpers ------------------------------------------------------

const _up = new THREE.Vector3(0, 1, 0);

// A capsule-ish limb segment stretched between two points.
function limbBetween(a, b, radius, material) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius), 4, 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, b.clone().sub(a).normalize());
  mesh.castShadow = true;
  return mesh;
}

// Analytic two-bone IK: returns the elbow position for a shoulder S
// reaching for target T with segment lengths l1/l2, bending toward `pole`.
function solveElbow(S, T, l1, l2, pole) {
  const toT = T.clone().sub(S);
  const d = Math.min(toT.length(), l1 + l2 - 0.001);
  const dir = toT.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return S.clone().add(dir.multiplyScalar(a)).add(p.multiplyScalar(h));
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Third-person weapon models, built along -Z. Returns the group plus hand
// grip points (in aim-pivot space) and the muzzle offset.
const GUN_SPECS = {
  pistol: { len: 0.2, barrel: 0.02, grips: [[0.02, -0.1, -0.36], [-0.02, -0.11, -0.34]], pos: [0.0, -0.06, -0.4], hold: 'pistol' },
  shotgun: { len: 0.95, barrel: 0.022, grips: [[0.1, -0.13, -0.18], [0.08, -0.1, -0.52]], pos: [0.11, -0.07, -0.22], pump: true },
  chaingun: { len: 0.9, barrel: 0.05, grips: [[0.12, -0.15, -0.16], [0.06, -0.14, -0.45]], pos: [0.12, -0.08, -0.2], heavy: true },
  rocket: { len: 1.1, barrel: 0.07, grips: [[0.15, -0.1, -0.12], [0.12, -0.08, -0.48]], pos: [0.16, 0.02, -0.05], tube: true },
  ak47: { len: 0.88, barrel: 0.015, grips: [[0.1, -0.14, -0.18], [0.08, -0.1, -0.5]], pos: [0.11, -0.07, -0.22], mag: 'curved' },
  m4a1: { len: 0.84, barrel: 0.016, grips: [[0.1, -0.14, -0.18], [0.08, -0.1, -0.48]], pos: [0.11, -0.07, -0.22], mag: 'straight', suppressor: true },
  mp5: { len: 0.6, barrel: 0.014, grips: [[0.1, -0.14, -0.16], [0.08, -0.1, -0.4]], pos: [0.1, -0.07, -0.2], mag: 'curved' },
  awp: { len: 1.15, barrel: 0.016, grips: [[0.1, -0.14, -0.18], [0.08, -0.1, -0.52]], pos: [0.11, -0.06, -0.22], scope: true },
};

const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.45, metalness: 0.75 });
const gunPolymer = new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.7, metalness: 0.1 });
const gunWood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.6, metalness: 0 });
const tubeOlive = new THREE.MeshStandardMaterial({ color: 0x4d5534, roughness: 0.75, metalness: 0.2 });
const flashMat = new THREE.SpriteMaterial({ color: 0xffc070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

function buildGun(key) {
  const spec = GUN_SPECS[key] || GUN_SPECS.ak47;
  const g = new THREE.Group();
  const L = spec.len;
  if (spec.tube) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrel, spec.barrel, L, 12), tubeOlive);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -L * 0.3;
    g.add(tube);
    g.add(box(0.05, 0.12, 0.06, gunPolymer, 0, -0.09, -0.1));
    g.add(box(0.04, 0.05, 0.12, gunMetal, 0.06, 0.05, -0.3));
  } else if (spec.hold === 'pistol') {
    g.add(box(0.035, 0.05, L, gunMetal, 0, 0, -L / 2));
    g.add(box(0.03, 0.11, 0.05, gunPolymer, 0, -0.07, -0.03));
  } else {
    const wood = key === 'ak47';
    // receiver
    g.add(box(0.055, 0.08, L * 0.38, gunMetal, 0, 0, -L * 0.3));
    // handguard
    g.add(box(0.05, 0.065, L * 0.3, wood ? gunWood : gunPolymer, 0, -0.005, -L * 0.62));
    // barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrel, spec.barrel, L * 0.32, 8), gunMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -L * 0.88);
    g.add(barrel);
    if (spec.suppressor) {
      const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), gunPolymer);
      sup.rotation.x = Math.PI / 2;
      sup.position.set(0, 0.01, -L * 1.06);
      g.add(sup);
    }
    // stock
    g.add(box(0.045, 0.09, L * 0.28, wood ? gunWood : gunPolymer, 0, -0.025, L * 0.08));
    // pistol grip
    const grip = box(0.04, 0.1, 0.045, wood ? gunWood : gunPolymer, 0, -0.08, -L * 0.18);
    grip.rotation.x = 0.25;
    g.add(grip);
    if (spec.mag) {
      const mag = box(0.035, 0.16, 0.06, gunMetal, 0, -0.11, -L * 0.37);
      mag.rotation.x = spec.mag === 'curved' ? -0.3 : -0.08;
      g.add(mag);
    }
    if (spec.pump) g.add(box(0.06, 0.06, 0.18, gunPolymer, 0, -0.04, -L * 0.62));
    if (spec.heavy) {
      g.add(box(0.12, 0.12, 0.16, gunMetal, 0.0, -0.08, -L * 0.25));
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, L * 0.5, 6), gunMetal);
        b.rotation.x = Math.PI / 2;
        b.position.set(Math.cos(i) * 0.03, Math.sin(i) * 0.03, -L * 0.75);
        g.add(b);
      }
    }
    if (spec.scope) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 10), gunPolymer);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.07, -L * 0.3);
      g.add(scope);
    } else {
      g.add(box(0.03, 0.03, 0.06, gunMetal, 0, 0.055, -L * 0.3));
    }
  }
  g.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -L * (spec.suppressor ? 1.14 : spec.tube ? 0.85 : 1.04));
  g.add(muzzle);
  const flash = new THREE.Sprite(flashMat);
  flash.scale.setScalar(0.35);
  flash.visible = false;
  muzzle.add(flash);
  g.position.set(...spec.pos);
  return { group: g, spec, muzzle, flash };
}

// --- Player model ------------------------------------------------------------

export function createPlayerModel(skinDef, name, options = {}) {
  const { accentColor = 0x2b2b2b, headgear = 'none', isZombie = false, nameColor = '#ffffff', weapon = 'ak47' } = options;
  const skin = typeof skinDef === 'object' ? skinDef : { id: `solid-${skinDef}`, color: skinDef };
  if (!isZombie && humanSoldierReady()) return createRealisticSoldier(skin, name, options);

  const group = new THREE.Group();
  const uniform = isZombie
    ? new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.95 })
    : uniformMaterial(skin);
  const skinTone = new THREE.MeshStandardMaterial({ color: isZombie ? 0x7a8a6a : 0xc99a78, roughness: 0.75 });
  const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentColor).multiplyScalar(0.85), roughness: 0.85 });
  const vestMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.color).lerp(new THREE.Color(0x2a2a24), 0.55), roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x1e1a16, roughness: 0.8 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.color).lerp(new THREE.Color(0x30332a), 0.4), roughness: 0.7, metalness: 0.1 });

  const STAND_HIP = 0.95;
  const THIGH = 0.45;
  const SHIN = 0.44;

  // Pelvis: root of legs and spine. Lowered for crouch.
  const pelvis = new THREE.Group();
  pelvis.position.y = STAND_HIP;
  group.add(pelvis);
  pelvis.add(box(0.34, 0.16, 0.2, uniform, 0, 0, 0));
  pelvis.add(box(0.36, 0.05, 0.22, gearMat, 0, 0.07, 0)); // belt

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, -0.04, 0);
    pelvis.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, THIGH - 0.12, 4, 8), uniform);
    thigh.position.y = -THIGH / 2;
    thigh.castShadow = true;
    hip.add(thigh);
    // thigh pocket
    hip.add(box(0.05, 0.12, 0.1, uniform, side * 0.08, -THIGH * 0.55, 0));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    knee.add(box(0.12, 0.09, 0.08, gearMat, 0, 0, -0.06)); // knee pad
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, SHIN - 0.14, 4, 8), uniform);
    shin.position.y = -SHIN / 2;
    shin.castShadow = true;
    knee.add(shin);
    const boot = box(0.11, 0.1, 0.27, bootMat, 0, -SHIN + 0.0, -0.05);
    knee.add(boot);
    legs.push({ hip, knee });
  }

  // Spine: torso, vest, backpack, head, arms and weapon.
  const spine = new THREE.Group();
  spine.position.y = 0.06;
  pelvis.add(spine);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.26, 4, 10), uniform);
  chest.scale.set(1.15, 1, 0.72);
  chest.position.y = 0.3;
  chest.castShadow = true;
  spine.add(chest);
  if (!isZombie) {
    // Plate carrier with magazine pouches and a radio.
    spine.add(box(0.38, 0.36, 0.08, vestMat, 0, 0.3, -0.12));
    spine.add(box(0.38, 0.36, 0.07, vestMat, 0, 0.3, 0.12));
    for (const x of [-0.11, 0, 0.11]) spine.add(box(0.085, 0.12, 0.06, gearMat, x, 0.2, -0.18));
    spine.add(box(0.06, 0.13, 0.05, gearMat, -0.16, 0.42, -0.16));
    spine.add(box(0.3, 0.38, 0.16, gearMat, 0, 0.3, 0.24)); // backpack
    spine.add(box(0.26, 0.08, 0.1, vestMat, 0, 0.52, 0.27)); // bedroll
  }

  const neck = new THREE.Group();
  neck.position.y = 0.55;
  spine.add(neck);
  neck.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), skinTone));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skinTone);
  head.scale.set(0.92, 1.08, 1);
  head.position.y = 0.14;
  head.castShadow = true;
  neck.add(head);
  if (isZombie) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    for (const dx of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeMat);
      eye.position.set(dx, 0.16, -0.1);
      neck.add(eye);
    }
  } else {
    // Face detail: brows/visor band shading and ears.
    neck.add(box(0.15, 0.025, 0.02, new THREE.MeshStandardMaterial({ color: 0x3a2a20 }), 0, 0.18, -0.1));
    for (const s of [-1, 1]) neck.add(box(0.02, 0.05, 0.03, skinTone, s * 0.105, 0.14, 0));
    addHeadgear(neck, headgear, helmetMat, gearMat);
  }

  // Aim pivot at shoulder height: arms and weapon pitch with the aim.
  const aim = new THREE.Group();
  aim.position.y = 0.47;
  spine.add(aim);
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), uniform);
    shoulder.position.set(s * 0.2, 0, 0.01);
    aim.add(shoulder);
  }

  let gun = null;
  let armMeshes = [];
  function buildArms(grips) {
    for (const m of armMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    armMeshes = [];
    const UPPER = 0.3;
    const LOWER = 0.31;
    const hands = grips || [
      [0.22, -0.05, -0.62],
      [-0.22, -0.05, -0.62],
    ];
    const sides = [1, -1];
    hands.forEach((t, i) => {
      const side = sides[i];
      const S = new THREE.Vector3(side * 0.2, 0, 0.01);
      const T = new THREE.Vector3(...t);
      const E = solveElbow(S, T, UPPER, LOWER, new THREE.Vector3(side * 0.7, -1, 0.3));
      const upper = limbBetween(S, E, 0.06, uniform);
      const lower = limbBetween(E, T, 0.05, uniform);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), isZombie ? skinTone : gearMat);
      hand.position.copy(T);
      for (const m of [upper, lower, hand]) {
        aim.add(m);
        armMeshes.push(m);
      }
    });
  }

  function setWeapon(key) {
    if (isZombie) return;
    if (gun) {
      gun.group.removeFromParent();
      // Realistic weapon clones share geometry with every other soldier's copy.
      if (!gun.shared) gun.group.traverse((m) => m.isMesh && m.geometry.dispose());
    }
    const real = hasProceduralWeapon(key) ? thirdPersonWeapon(key) : null;
    if (real) {
      const nodes = weaponNodes(key);
      // The model's origin is the shooting hand's grip: put it in the right hand.
      const R = key === 'pistol' ? new THREE.Vector3(0.03, -0.1, -0.34) : new THREE.Vector3(0.1, -0.12, -0.18);
      real.position.copy(R);
      real.traverse((m) => {
        if (m.isMesh) m.userData.sharedWeapon = true;
      });
      aim.add(real);
      const muzzle = new THREE.Object3D();
      muzzle.position.fromArray(nodes.muzzle);
      real.add(muzzle);
      const flash = new THREE.Sprite(flashMat);
      flash.scale.setScalar(0.35);
      flash.visible = false;
      muzzle.add(flash);
      const gl = nodes.gripL?.pos || [-0.02, 0.0, -0.3];
      const L = R.clone().add(new THREE.Vector3(...gl));
      gun = { group: real, muzzle, flash, spec: {}, shared: true };
      buildArms([
        [R.x, R.y - 0.02, R.z + 0.02],
        [L.x, L.y - 0.02, L.z],
      ]);
      return;
    }
    gun = buildGun(key);
    aim.add(gun.group);
    const [px, py, pz] = gun.spec.pos;
    // Grip points are authored in aim space relative to the default
    // rifle position; shift them with the gun.
    const base = GUN_SPECS.ak47.pos;
    buildArms(gun.spec.grips.map(([x, y, z]) => [x + (gun.spec.hold === 'pistol' ? 0 : px - base[0]), y + (gun.spec.hold === 'pistol' ? 0 : py - base[1]), z + (gun.spec.hold === 'pistol' ? 0 : pz - base[2])]));
  }
  if (isZombie) buildArms(null);
  else setWeapon(weapon);

  // Hitboxes (invisible but raycastable). Slightly generous for latency.
  const hitMat = new THREE.MeshBasicMaterial();
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), hitMat);
  headBox.position.y = 0.15;
  headBox.userData.zone = 'head';
  neck.add(headBox);
  const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.66, 0.5), hitMat);
  bodyBox.position.y = 0.26;
  bodyBox.userData.zone = 'body';
  spine.add(bodyBox);
  const legBox = new THREE.Mesh(new THREE.BoxGeometry(0.46, STAND_HIP, 0.4), hitMat);
  legBox.position.y = -STAND_HIP / 2;
  legBox.userData.zone = 'legs';
  pelvis.add(legBox);
  const hitboxes = [headBox, bodyBox, legBox];
  for (const h of hitboxes) h.visible = false;

  const nameSprite = makeNameSprite(name, nameColor);
  nameSprite.position.y = 2.15;
  group.add(nameSprite);

  group.traverse((o) => {
    if (o.isMesh) o.receiveShadow = false;
  });

  let walkPhase = 0;
  let crouchT = 0;
  let pitch = 0;
  let flashT = 0;
  let deathT = -1;
  let speedSmoothed = 0;

  return {
    group,
    hitbox: bodyBox,
    hitboxes,
    get muzzle() {
      return gun ? gun.muzzle : aim;
    },
    setOwner(key, id) {
      for (const h of hitboxes) h.userData[key] = id;
    },
    setPosition(x, y, z, angle) {
      group.position.set(x, y || 0, z);
      group.rotation.y = angle || 0;
    },
    setPitch(p) {
      pitch = THREE.MathUtils.clamp(p || 0, -1.2, 1.2);
    },
    setWeapon,
    setName(newName) {
      drawName(nameSprite, newName);
    },
    setNameStyle(color, alwaysVisible) {
      nameSprite.userData.color = color;
      nameSprite.material.depthTest = !alwaysVisible;
      drawName(nameSprite, name);
    },
    setNameVisible(v) {
      nameSprite.visible = v;
    },
    setVisible(visible) {
      group.visible = visible;
      if (visible) {
        deathT = -1;
        group.rotation.x = 0;
        group.rotation.z = 0;
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
      if (!gun) return;
      flashT = 0.06;
      gun.flash.visible = true;
      gun.flash.material.rotation = Math.random() * Math.PI;
    },
    // Called every render frame. `speed` is horizontal speed in units/sec,
    // `crouching` a boolean from the network.
    animate(dt, moving, crouching = false, speed = null) {
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0 && gun) gun.flash.visible = false;
      }

      if (deathT >= 0) {
        // Crumple: knees give, then the body tips backwards to the ground.
        deathT += dt;
        const t = Math.min(1, deathT / 0.7);
        const ease = t * t;
        group.rotation.x = ease * 1.45;
        pelvis.position.y = THREE.MathUtils.lerp(STAND_HIP, 0.35, Math.min(1, deathT / 0.4));
        legs[0].knee.rotation.x = legs[1].knee.rotation.x = -0.9 * Math.min(1, deathT / 0.35);
        aim.rotation.x = -0.6 * t;
        if (deathT > 4) group.visible = false;
        return;
      }

      const effectiveSpeed = speed ?? (moving || isZombie ? 4 : 0);
      speedSmoothed += (effectiveSpeed - speedSmoothed) * Math.min(1, dt * 8);
      const walking = speedSmoothed > 0.4;
      crouchT += ((crouching ? 1 : 0) - crouchT) * Math.min(1, dt * 10);

      const stride = Math.min(1, speedSmoothed / 5.2);
      if (walking) walkPhase += dt * (4.5 + speedSmoothed * 1.2) * (crouching ? 0.7 : 1);
      else walkPhase += (Math.round(walkPhase / Math.PI) * Math.PI - walkPhase) * Math.min(1, dt * 6);

      const swing = Math.sin(walkPhase) * 0.55 * stride;
      for (let i = 0; i < 2; i++) {
        const leg = legs[i];
        const phase = walkPhase + i * Math.PI;
        const s = i === 0 ? swing : -swing;
        // Knees bend most while the leg swings forward (passing phase).
        const bend = Math.max(0, Math.sin(phase + 0.9)) * 0.9 * stride;
        const crouchHip = 1.25;
        const crouchKnee = -2.0;
        leg.hip.rotation.x = THREE.MathUtils.lerp(s, crouchHip + s * 0.4, crouchT);
        leg.knee.rotation.x = THREE.MathUtils.lerp(-bend, crouchKnee - bend * 0.3, crouchT);
      }
      const bob = Math.abs(Math.cos(walkPhase)) * 0.035 * stride;
      pelvis.position.y = THREE.MathUtils.lerp(STAND_HIP, 0.58, crouchT) - bob;
      legBox.scale.y = THREE.MathUtils.lerp(1, 0.62, crouchT);
      legBox.position.y = (-STAND_HIP / 2) * legBox.scale.y;

      // Upper body: spine leans into the aim, the rest comes from the
      // shoulders so the weapon points where the player is looking.
      const lean = isZombie ? 0.35 : 0.08 + crouchT * 0.15 + stride * 0.06;
      spine.rotation.x = -lean + pitch * 0.35;
      spine.rotation.y = Math.sin(walkPhase) * 0.06 * stride;
      aim.rotation.x = pitch * 0.65 + lean * 0.8;
      neck.rotation.x = pitch * 0.25 + lean * 0.5;
    },
    dispose() {
<<<<<<< HEAD
      group.traverse((o) => {
        if (o.isMesh && o.geometry && !o.userData.sharedWeapon) o.geometry.dispose();
      });
      nameSprite.userData.texture.dispose();
      nameSprite.material.dispose();
=======
      group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.map?.dispose();
            material.dispose();
          }
        }
      });
>>>>>>> 3838b3c14c840553ef3b32b1d6ab5b1aa3ec9bef
    },
  };
}

function addHeadgear(neck, kind, helmetMat, gearMat) {
  if (kind === 'helmet' || kind === 'nvg') {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.138, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    shell.position.set(0, 0.165, 0.005);
    shell.scale.set(1, 0.95, 1.08);
    shell.castShadow = true;
    neck.add(shell);
    neck.add(box(0.29, 0.03, 0.27, helmetMat, 0, 0.15, 0.005)); // rim
    neck.add(box(0.04, 0.035, 0.12, gearMat, 0.13, 0.2, 0)); // rail
    neck.add(box(0.04, 0.035, 0.12, gearMat, -0.13, 0.2, 0));
    if (kind === 'nvg') {
      neck.add(box(0.05, 0.05, 0.04, gearMat, 0, 0.24, -0.13)); // mount
      for (const s of [-1, 1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.09, 10), gearMat);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(s * 0.035, 0.22, -0.18);
        neck.add(tube);
      }
    }
  } else if (kind === 'cap') {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), helmetMat);
    crown.position.y = 0.17;
    neck.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 14), helmetMat);
    brim.scale.z = 0.7;
    brim.position.set(0, 0.17, -0.12);
    neck.add(brim);
  } else if (kind === 'beanie') {
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), gearMat);
    beanie.position.y = 0.165;
    beanie.scale.y = 1.1;
    neck.add(beanie);
  }
}

// --- Realistic soldier (humanSoldier.js) -------------------------------------
// Grip of the shooting hand relative to the shoulder line (aim pivot):
// right of centre, below the shoulders, a little forward — the stock then
// sits in the shoulder pocket.
const SHOULDER_GRIP = new THREE.Vector3(0.12, -0.2, -0.16);
const PISTOL_GRIP = new THREE.Vector3(0.04, -0.17, -0.4);

function createRealisticSoldier(skin, name, options) {
  const { accentColor = 0x2b2b2b, headgear = 'none', nameColor = '#ffffff', weapon = 'ak47' } = options;
  const nameSprite = makeNameSprite(name, nameColor);
  const helmetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.color).lerp(new THREE.Color(0x30332a), 0.4), roughness: 0.7, metalness: 0.1 });
  const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentColor).multiplyScalar(0.85), roughness: 0.85 });

  const gunFactory = (key) => {
    const real = hasProceduralWeapon(key) ? thirdPersonWeapon(key) : null;
    if (!real) return null;
    const nodes = weaponNodes(key);
    const R = (key === 'pistol' ? PISTOL_GRIP : SHOULDER_GRIP).clone();
    real.position.copy(R);
    real.traverse((m) => {
      if (m.isMesh) m.userData.sharedWeapon = true;
    });
    const muzzle = new THREE.Object3D();
    muzzle.position.fromArray(nodes.muzzle);
    real.add(muzzle);
    const flash = new THREE.Sprite(flashMat);
    flash.scale.setScalar(0.35);
    flash.visible = false;
    muzzle.add(flash);
    const gl = nodes.gripL?.pos || [-0.02, 0.0, -0.3];
    return {
      group: real,
      muzzle,
      flash,
      // Wrist targets sit just behind/below the grip points (the hand bone's
      // origin is the wrist, not the palm).
      gripR: R.clone().add(new THREE.Vector3(0.01, -0.03, 0.06)),
      gripL: R.clone().add(new THREE.Vector3(...gl)).add(new THREE.Vector3(-0.02, -0.05, 0.03)),
    };
  };

  const model = createHumanSoldier({
    nameSprite,
    material: soldierMaterialFor(skin, skin.camo ? makeCamoCanvas : null),
    gunFactory,
    headgear,
    headgearMats: { shell: helmetMat, gear: gearMat },
    // Same face on every client: the skin tone follows the player's name.
    skinTone: [...(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 5,
    setName: (n) => drawName(nameSprite, n),
    setNameStyle: (color, always) => {
      nameSprite.userData.color = color;
      nameSprite.material.depthTest = !always;
      drawName(nameSprite, name);
    },
  });
  model.setWeapon(weapon);
  return model;
}

// --- Zombies -------------------------------------------------------------------
// The realistic rotting human (humanSoldier.js) once the character assets
// are loaded, otherwise the procedural zombie above behind the same interface:
//   { group, hitbox, hitboxes, setOwner, setPosition(x, y, z, angle),
//     animate(dt, speed m/s, attacking), attack(), die(), dying,
//     setVisible(v), dispose() }
// kind: 'walker' | 'runner'; seed picks the look and personality (defaults to
// the id, so every client sees the same zombie).
export function createZombieModel({ id = 0, kind = 'walker', seed } = {}) {
  const s = Number.isFinite(seed) ? seed : [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  let model;
  if (humanSoldierReady()) {
    model = createHumanZombie({ kind, seed: s });
  } else {
    const m = createPlayerModel(0x4a5a3a, 'Zombie', { isZombie: true });
    m.setNameVisible(false);
    model = {
      group: m.group,
      hitbox: m.hitbox,
      hitboxes: m.hitboxes,
      kind,
      setOwner: m.setOwner,
      setPosition: m.setPosition,
      setVisible: m.setVisible,
      attack() {},
      die: m.die,
      get dying() {
        return m.dying;
      },
      animate(dt, speed = 0) {
        m.animate(dt, speed > 0.3, false, speed);
      },
      dispose: m.dispose,
    };
  }
  model.setOwner('zombieId', id);
  return model;
}
