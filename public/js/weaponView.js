// First-person weapon viewmodels: metal-shaded primitive meshes attached
// to the camera, built with more individual parts (sights, trigger guard,
// magazine, stock, ammo belt, etc.) than a bare body+barrel block, to read
// more like a real gun silhouette.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { buildAK } from './weapons/models/ak.js';
import { buildWeaponObject } from './weapons/build.js';
import { WeaponMaterials } from './weapons/materials.js';
import { hasProceduralWeapon, firstPersonWeapon, weaponNodes } from './weaponModels.js';

// Real .glb models (ported from the open-source Tiny Strike project — see
// public/assets/weapons/LICENSE for full attribution). Each is loaded once
// and cached; every equip after that clones the cached template, so
// switching weapons back and forth never re-fetches or re-parses the file.
const GLB_PATHS = {
  pistol: 'assets/weapons/glock.glb',
  ak47: 'assets/weapons/ak47.glb',
  m4a1: 'assets/weapons/m4a1.glb',
  mp5: 'assets/weapons/mp5.glb',
  awp: 'assets/weapons/awp.glb',
};

const gltfLoader = new GLTFLoader();
const glbTemplateCache = new Map(); // weaponKey -> Promise<THREE.Object3D>

function loadGlbTemplate(weaponKey) {
  if (!glbTemplateCache.has(weaponKey)) {
    const promise = gltfLoader.loadAsync(GLB_PATHS[weaponKey]).then((gltf) => gltf.scene);
    glbTemplateCache.set(weaponKey, promise);
  }
  return glbTemplateCache.get(weaponKey);
}

function metalMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35, ...extra });
}

// ---------------------------------------------------------------------------
// First-person hands: a real skinned arm+hand model instead of a pair of
// boxes. npc-arms-ct.glb is Tiny Strike's own viewmodel arm — a body-stripped,
// CC0 (Quaternius) right forearm with a full finger skeleton (knuckle and
// fingertip bones per finger, two thumb bones) — see
// public/assets/weapons/LICENSE for attribution. It is loaded once, and every
// equip clones its skeleton (SkeletonUtils.clone, so each weapon gets its own
// posable bones without re-fetching or re-parsing the file).
//
// The per-family position/rotation/grip-curl numbers below are ported from
// Tiny Strike's src/weapons/viewmodel.js (same MIT/ISC chain as
// public/js/weapons/, see public/js/weapons/LICENSE), which derived them by
// measuring this exact arm asset against this exact weapon convention
// (meters, origin at the grip, muzzle along -Z). ak47/m4a1/mp5/awp/pistol use
// the real .glb files Tiny Strike authored to that convention, so those
// numbers transfer directly. shotgun/chaingun/rocket are this project's own
// procedural models, which were not authored grip-at-origin, so they get a
// hand-placed override tuned to sit on each model's own grip instead.
const ARMS_PATH = 'assets/weapons/npc-arms-ct.glb';
let armsTemplatePromise = null;

function loadArmsTemplate() {
  if (!armsTemplatePromise) {
    armsTemplatePromise = gltfLoader.loadAsync(ARMS_PATH).then((gltf) => {
      const grip = gltf.scene.getObjectByName('VM_Grip');
      if (!grip) throw new Error('npc-arms-ct.glb has no VM_Grip root');
      return grip;
    });
  }
  return armsTemplatePromise;
}

// Measured off npc-arms-ct.glb: the authored fist is life-size (a 288 x 320 x
// 330 mm stylised hand) and reads as a catcher's mitt next to a real-scale
// gun, so it's scaled down to a gloved-human-hand size and re-seated so its
// fist centre — not the arm's root bone — lands on the grip.
const NPC_ARM_SCALE = 0.221;

// rot/scale per weapon family; pos is pre-solved (grip - R*S*fistCenter) for
// the four grip-at-origin families. See the module comment above.
const NPC_ARM_POSES = {
  rifle: { pos: [-0.00661, -0.00731, 0.02467], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
  smg: { pos: [-0.00660, -0.01078, 0.02399], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
  sniper: { pos: [-0.00998, -0.00500, 0.02564], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
  pistol: { pos: [-0.00996, -0.01854, 0.03216], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
};

const NPC_ARM_FAMILY = {
  ak47: 'rifle',
  m4a1: 'rifle',
  mp5: 'smg',
  awp: 'sniper',
  pistol: 'pistol',
  // No Tiny Strike equivalent for these three — held like rifles (two-handed,
  // same grip rake/curl), with their own hand-placed seat below since their
  // models aren't authored grip-at-origin.
  shotgun: 'rifle',
  chaingun: 'rifle',
  rocket: 'rifle',
};

// Hand-placed seats for the procedural (non grip-at-origin) weapons, tuned
// against where each one's own grip/handle geometry actually sits (see the
// box positions in buildWeaponMesh above).
const NPC_ARM_POSE_OVERRIDE = {
  shotgun: { pos: [0.01, -0.06, -0.37], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
  chaingun: { pos: [0.015, -0.11, -0.05], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
  rocket: { pos: [-0.01, 0.01, 0.02], rot: [-0.300, 0.524, 0], scale: NPC_ARM_SCALE },
};

// Finger curl closes the authored (nearly-straight) hand onto the grip; long
// guns curl just enough to stay visually connected (full curl reads as a
// fist parked beside the gun), pistols keep the full wrap since the fist
// under the slide is the weapon's whole contact patch.
const NPC_ARM_GRIP = {
  rifle: { curl: [0.35, 0.20, 0.12], thumb: [0.15, 0.05, 0.10] },
  smg: { curl: [0.35, 0.20, 0.12], thumb: [0.15, 0.05, 0.10] },
  sniper: { curl: [0.35, 0.20, 0.12], thumb: [0.15, 0.05, 0.10] },
  pistol: { curl: [1.20, 0.50, 0.30], thumb: [0.35, 0.10, 0.30] },
};

// Bone names as actually exported in this file's skeleton (Blender's own
// ".R" mirror-naming convention — verified against npc-arms-ct.glb directly;
// Tiny Strike's own source comments a no-dot "Index1R" convention that does
// not match the shipped asset).
const NPC_FINGER_CHAINS = [
  ['Index1.R', 'Index2.R', 'Index3.R'],
  ['Middle1.R', 'Middle2.R', 'Middle3.R'],
  ['Pinky1.R', 'Pinky2.R', 'Pinky3.R'],
];

/** Close the cloned hand's fingers onto the grip. Absolute, never cumulative. */
function applyArmGrip(arms, family) {
  const spec = NPC_ARM_GRIP[family] || NPC_ARM_GRIP.rifle;
  const bones = new Map();
  arms.traverse((o) => {
    if (o.isBone) bones.set(o.name, o);
  });
  const rest = (bone, axis) => {
    const key = 'armRest' + axis;
    if (bone.userData[key] === undefined) bone.userData[key] = bone.rotation[axis];
    return bone.userData[key];
  };
  for (const chain of NPC_FINGER_CHAINS) {
    for (let i = 0; i < chain.length; i++) {
      const bone = bones.get(chain[i]);
      if (!bone) continue;
      bone.rotation.x = rest(bone, 'x') - (spec.curl[i] || 0);
    }
  }
  const t1 = bones.get('Thumb1.R');
  const t2 = bones.get('Thumb2.R');
  if (t1) {
    t1.rotation.x = rest(t1, 'x') - (spec.thumb[0] || 0);
    t1.rotation.z = rest(t1, 'z') + (spec.thumb[1] || 0);
  }
  if (t2) t2.rotation.x = rest(t2, 'x') - (spec.thumb[2] || 0);
  arms.updateMatrixWorld(true);
}

// Builds this weapon's held arm. Returns null (never throws) on any failure
// so a missing/corrupt arm asset falls back to the old box hands instead of
// leaving the viewmodel without hands at all.
async function buildArms(weaponKey) {
  let template;
  try {
    template = await loadArmsTemplate();
  } catch (err) {
    console.warn('[weapons] failed to load npc-arms-ct.glb, using box-hand fallback:', err);
    return null;
  }
  try {
    const arms = cloneSkeleton(template);
    arms.name = 'vm-arms-' + weaponKey;
    arms.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    const family = NPC_ARM_FAMILY[weaponKey] || 'rifle';
    const override = hasProceduralWeapon(weaponKey) ? null : NPC_ARM_POSE_OVERRIDE[weaponKey];
    const pose = override || NPC_ARM_POSES[family] || NPC_ARM_POSES.rifle;
    arms.position.fromArray(pose.pos);
    arms.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    arms.scale.setScalar(pose.scale);
    applyArmGrip(arms, family);
    return arms;
  } catch (err) {
    console.warn('[weapons] failed to pose arms for ' + weaponKey + ', using box-hand fallback:', err);
    return null;
  }
}

// Last-resort fallback hands (two boxes) — used only if npc-arms-ct.glb fails
// to load or clone, so a network hiccup never leaves the viewmodel with no
// hands at all.
function buildFallbackHands(weaponKey) {
  const handsGroup = new THREE.Group();
  handsGroup.name = 'hands-fallback';
  const handMat = new THREE.MeshStandardMaterial({ color: 0xe0b894, roughness: 0.8 });

  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.12), handMat);
  if (weaponKey === 'pistol') {
    rightHand.position.set(0, -0.15, 0.08);
  } else if (weaponKey === 'rocket') {
    rightHand.position.set(0, 0.0, 0.0);
  } else if (weaponKey === 'awp') {
    rightHand.position.set(0.03, -0.16, -0.05);
  } else if (weaponKey === 'ak47' || weaponKey === 'm4a1') {
    rightHand.position.set(0.02, -0.14, -0.05);
  } else if (weaponKey === 'mp5') {
    rightHand.position.set(0.02, -0.12, 0.05);
  } else {
    rightHand.position.set(0, -0.12, 0.0);
  }
  handsGroup.add(rightHand);

  if (weaponKey !== 'pistol') {
    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.12), handMat);
    if (weaponKey === 'rocket') {
      leftHand.position.set(-0.06, 0.04, -0.3);
    } else if (weaponKey === 'awp') {
      leftHand.position.set(-0.04, -0.08, -0.45);
    } else if (weaponKey === 'ak47' || weaponKey === 'm4a1') {
      leftHand.position.set(-0.03, -0.07, -0.42);
    } else if (weaponKey === 'mp5') {
      leftHand.position.set(-0.03, -0.05, -0.32);
    } else if (weaponKey === 'shotgun') {
      leftHand.position.set(-0.02, -0.06, -0.35);
    } else {
      leftHand.position.set(-0.02, -0.06, -0.3);
    }
    handsGroup.add(leftHand);
  }

  if (GLB_PATHS[weaponKey]) {
    const glbScale = VIEWMODEL_TRANSFORMS[weaponKey]?.scale || 1;
    handsGroup.scale.setScalar(1 / glbScale);
  }
  return handsGroup;
}

// Exported so world.js can reuse it to build a small "what this station
// sells" icon on top of buy stations/upgrade benches.
export function buildWeaponMesh(weaponKey) {
  const group = new THREE.Group();

  switch (weaponKey) {
    case 'pistol': {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.32), metalMat(0x3a3a3a));
      slide.position.set(0, 0.07, -0.05);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.1, 0.22), metalMat(0x555555));
      frame.position.set(0, 0, 0.0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), metalMat(0x1c1c1c));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.07, -0.26);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), metalMat(0x2a2a2a, { roughness: 0.8, metalness: 0.1 }));
      grip.position.set(0, -0.15, 0.08);
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 10, Math.PI), metalMat(0x333333));
      triggerGuard.rotation.z = Math.PI;
      triggerGuard.position.set(0, -0.035, -0.01);
      const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.07), metalMat(0x222222));
      magazine.position.set(0, -0.28, 0.08);
      const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.015), metalMat(0x111111));
      frontSight.position.set(0, 0.13, -0.19);
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.02), metalMat(0x111111));
      rearSight.position.set(0, 0.13, 0.08);
      group.add(slide, frame, barrel, grip, triggerGuard, magazine, frontSight, rearSight);
      break;
    }

    case 'shotgun': {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.3), metalMat(0x4a3a28, { metalness: 0.3 }));
      receiver.position.set(0, 0.02, -0.2);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), metalMat(0x2a2a2a));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.05, -0.5);
      const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), metalMat(0x3a3a3a));
      magTube.rotation.x = Math.PI / 2;
      magTube.position.set(0, -0.02, -0.48);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.16), metalMat(0x2b2118, { roughness: 0.75 }));
      pump.position.set(0, -0.015, -0.42);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.32), metalMat(0x4a3a28, { roughness: 0.7, metalness: 0.1 }));
      stock.rotation.x = -0.12;
      stock.position.set(0, -0.08, 0.32);
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), metalMat(0x2b2118, { roughness: 0.75 }));
      foregrip.position.set(0, -0.1, 0.0);
      group.add(receiver, barrel, magTube, pump, stock, foregrip);
      break;
    }

    case 'chaingun': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.4), metalMat(0x4d4d4d));
      body.position.z = -0.05;
      const barrelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), metalMat(0x2a2a2a));
      barrelHub.rotation.x = Math.PI / 2;
      barrelHub.position.set(0, 0, -0.3);
      group.add(body, barrelHub);
      for (const [dx, dz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06], [0, -0.085]]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), metalMat(0x1f1f1f));
        bar.rotation.x = Math.PI / 2;
        bar.position.set(dx, dz, -0.4);
        group.add(bar);
      }
      // Ammo belt feeding in from the side.
      for (let i = 0; i < 6; i++) {
        const link = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.03), metalMat(0xb8860b, { metalness: 0.8, roughness: 0.3 }));
        link.position.set(0.14 + i * 0.001, 0.02 - i * 0.025, -0.05 + i * 0.015);
        group.add(link);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), metalMat(0x2a2a2a, { roughness: 0.8 }));
      handle.position.set(0, -0.18, 0.12);
      group.add(handle);
      break;
    }

    case 'ak47': {
      // Lightweight stand-in silhouette — used only for the buy-station
      // icon, so it stays cheap. The actual held viewmodel uses the real
      // procedurally modelled geometry (see buildProceduralAK below).
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.5), metalMat(0x3a3a3a, { metalness: 0.5 }));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35, 8), metalMat(0x1c1c1c));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.4);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.3), metalMat(0x6b4a2e, { roughness: 0.6, metalness: 0 }));
      stock.rotation.x = -0.15;
      stock.position.set(0, -0.06, 0.35);
      const mag = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.28, 8), metalMat(0x3a3a3a, { metalness: 0.4 }));
      mag.rotation.x = Math.PI * 0.42;
      mag.position.set(0, -0.18, -0.1);
      group.add(receiver, barrel, stock, mag);
      break;
    }

    case 'm4a1': {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.45), metalMat(0x2a2a2a, { metalness: 0.5 }));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.3), metalMat(0x333333));
      rail.position.set(0, 0.08, -0.3);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), metalMat(0x1c1c1c));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.05, -0.45);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), metalMat(0x1c1c1c, { roughness: 0.6 }));
      stock.position.set(0, -0.02, 0.32);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.07), metalMat(0x2a2a2a, { metalness: 0.4 }));
      mag.rotation.x = -0.25;
      mag.position.set(0, -0.2, -0.05);
      group.add(receiver, rail, barrel, stock, mag);
      break;
    }

    case 'mp5': {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.3), metalMat(0x2e2e2e, { metalness: 0.5 }));
      const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 8), metalMat(0x1c1c1c));
      handguard.rotation.x = Math.PI / 2;
      handguard.position.set(0, -0.01, -0.28);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.18), metalMat(0x1c1c1c, { roughness: 0.6 }));
      stock.position.set(0, -0.01, 0.26);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.06), metalMat(0x2a2a2a, { metalness: 0.4 }));
      mag.position.set(0, -0.16, -0.02);
      group.add(receiver, handguard, stock, mag);
      break;
    }

    case 'awp': {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), metalMat(0x2a332a, { metalness: 0.3 }));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 10), metalMat(0x1a1a1a));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.55);
      const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10), metalMat(0x111111));
      scopeTube.rotation.x = Math.PI / 2;
      scopeTube.position.set(0, 0.13, -0.15);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.3), metalMat(0x2a332a, { roughness: 0.7, metalness: 0.1 }));
      stock.position.set(0, -0.03, 0.35);
      group.add(receiver, barrel, scopeTube, stock);
      break;
    }

    case 'rocket': {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 12), metalMat(0x3a4a3a, { roughness: 0.6 }));
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0, -0.2);
      const frontCone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 12), metalMat(0x2a332a));
      frontCone.rotation.x = -Math.PI / 2;
      frontCone.position.set(0, 0, -0.66);
      const backCap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.08, 12), metalMat(0x222222));
      backCap.rotation.x = Math.PI / 2;
      backCap.position.set(0, 0, 0.26);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.22), metalMat(0x1a1a1a));
      sight.position.set(0, 0.14, -0.1);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 10, Math.PI), metalMat(0x1a1a1a));
      handle.rotation.set(0, 0, Math.PI);
      handle.position.set(0, 0.02, 0.0);
      const shoulderStock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.18), metalMat(0x2a332a, { roughness: 0.8, metalness: 0.1 }));
      shoulderStock.position.set(0, -0.02, 0.16);
      group.add(tube, frontCone, backCap, sight, handle, shoulderStock);
      break;
    }

    default:
      break;
  }

  return group;
}

// Builds the real procedurally modelled AK-47 — true-to-life AKM dimensions,
// a stamped-sheet receiver, gas tube, 30-round curved magazine, all authored
// as geometry (ported from the open-source Tiny Strike project; see
// public/js/weapons/). Used only if the baked ak47.glb fails to load. No
// shared procedural PBR texture library is supplied (that's a separate,
// much larger subsystem this project doesn't have), so WeaponMaterials
// falls back to its own plain metal/wood/polymer materials — the geometry
// is the real thing; the shading is simplified.
function buildProceduralAK() {
  try {
    const model = buildAK();
    const mats = new WeaponMaterials(null);
    const object = buildWeaponObject(model, mats, { viewmodel: true });
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; // a viewmodel living at the camera shouldn't cast scene shadows
      o.frustumCulled = false;
    });
    return object;
  } catch (err) {
    console.warn('[weapons] procedural AK-47 build failed, using fallback silhouette:', err);
    return buildWeaponMesh('ak47');
  }
}

// Loads a real .glb model for weapons that have one. Falls back to the
// procedural AK (ak47 only) or the simple silhouette if the fetch/parse
// ever fails — a network hiccup or a missing file should never crash the
// game, just show a plainer gun.
async function buildGlbWeapon(weaponKey) {
  try {
    const template = await loadGlbTemplate(weaponKey);
    const instance = template.clone(true);
    instance.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.frustumCulled = false;
    });
    return instance;
  } catch (err) {
    console.warn(`[weapons] failed to load ${weaponKey}.glb, using fallback:`, err);
    return weaponKey === 'ak47' ? buildProceduralAK() : buildWeaponMesh(weaponKey);
  }
}

// Per-weapon viewmodel placement (camera-relative position + scale).
//
// The previous version used one hardcoded offset (0.35, -0.3, -0.6) for
// every weapon. At a 75-degree FOV, that puts the near end of anything
// wider than a pencil only ~0.35 units from the camera — do the math
// (angular size = 2*atan(radius / distance)) and a 0.1-radius barrel at
// that distance already subtends ~32 degrees, a third of the whole
// horizontal field of view. That's the actual cause of guns rendering as
// a huge, dark, undetailed mass: the camera was nearly inside the mesh.
// Real .glb models are true 1-meter scale (an AWP is 1.15 m long) and are
// additionally scaled down here, on top of being pushed back.
const VIEWMODEL_TRANSFORMS = {
  pistol: { position: [0.22, -0.19, -0.5], scale: 1.3 },
  shotgun: { position: [0.26, -0.24, -0.95], scale: 1 },
  chaingun: { position: [0.26, -0.26, -1.0], scale: 1 },
  rocket: { position: [0.24, -0.22, -1.1], scale: 1 },
  ak47: { position: [0.26, -0.22, -0.95], scale: 0.6 },
  m4a1: { position: [0.26, -0.22, -0.95], scale: 0.6 },
  mp5: { position: [0.26, -0.2, -0.75], scale: 0.7 },
  awp: { position: [0.26, -0.2, -1.15], scale: 0.55 },
};

// Placement for the realistic procedural models (real scale, grip-at-origin,
// same convention as the .glb files above).
// Iron-sight aiming, per weapon: `relief` = eye distance behind the rear
// sight, `dy` = eye height above the model's rear-sight node. Each was tuned
// in /weapon-lab.html?w=<id>&ads=1 until the front post sat in the rear
// notch on the aim point (AK: over the top cover hump; MP5: just over the
// drum, front post inside the hood; shotgun: bead on the receiver line).
const IRON_SIGHTS = {
  pistol: { relief: 0.3, dy: 0.002 },
  ak47: { relief: 0.2, dy: 0.023 },
  mp5: { relief: 0.12, dy: 0.013 },
  shotgun: { relief: 0.16, dy: 0.005 },
  rocket: { relief: 0.13, dy: 0.004 },
};

// Full size and close to the eye, like a Call of Duty viewmodel; `yaw`
// cants the muzzle in toward the centre of the screen at the hip.
const PROCEDURAL_TRANSFORMS = {
  pistol: { position: [0.085, -0.085, -0.26], scale: 1, yaw: 0.05 },
  shotgun: { position: [0.125, -0.075, -0.32], scale: 1, yaw: 0.06 },
  chaingun: { position: [0.15, -0.07, -0.36], scale: 1, yaw: 0.06 },
  rocket: { position: [0.17, -0.11, -0.22], scale: 1, yaw: 0.06 },
  ak47: { position: [0.13, -0.115, -0.35], scale: 1, yaw: 0.06 },
  m4a1: { position: [0.13, -0.135, -0.3], scale: 1, yaw: 0.06 },
  mp5: { position: [0.12, -0.125, -0.27], scale: 1, yaw: 0.06 },
  awp: { position: [0.13, -0.15, -0.3], scale: 1, yaw: 0.05 },
};
const DEFAULT_TRANSFORM = { position: [0.3, -0.25, -0.9], scale: 1 };

// Async because a real .glb has to be fetched and parsed the first time a
// weapon is equipped (cached after that — see loadGlbTemplate). Callers
// don't need to await this if they don't want to block on it; the weapon
// just pops in a frame or two after the fetch resolves.
export async function createWeaponView(weaponKey) {
  const group = new THREE.Group();
  group.userData.weaponKey = weaponKey;

  // Realistic procedural model first; the old .glb / primitive models are
  // only a fallback if a procedural build ever fails.
  let model = hasProceduralWeapon(weaponKey) ? firstPersonWeapon(weaponKey) : null;
  const nodes = model ? weaponNodes(weaponKey) : null;
  if (!model) model = GLB_PATHS[weaponKey] ? await buildGlbWeapon(weaponKey) : buildWeaponMesh(weaponKey);
  group.add(model);
  group.userData.gun = model;
  if (nodes) setupWeaponAnimation(model, nodes, weaponKey);

  // Real skinned arm+hand (fingers, wrist, sleeve) instead of two boxes —
  // see the module comment above buildArms for why these numbers are what
  // they are. Falls back to the old box hands if the asset can't load.
  const arms = (await buildArms(weaponKey)) || buildFallbackHands(weaponKey);
  group.add(arms);

  const transform = (nodes && PROCEDURAL_TRANSFORMS[weaponKey]) || VIEWMODEL_TRANSFORMS[weaponKey] || DEFAULT_TRANSFORM;

  // Aim-down-sights placement: centre the gun horizontally and bring its
  // top edge (iron sights / optic rail) onto the line of sight, so the
  // sights actually sit on the crosshair instead of one generic offset.
  const bounds = new THREE.Box3().setFromObject(model, true);
  const s = transform.scale;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  group.userData.adsPosition = [-cx * s, -bounds.max.y * s - 0.034, transform.position[2] + 0.04];

  // Anchor points for effects: the muzzle (front of the barrel, near the
  // top where the bore sits) and the ejection port (right side of the
  // receiver), both in group-local space.
  const h = bounds.max.y - bounds.min.y;
  const muzzle = new THREE.Object3D();
  const ejector = new THREE.Object3D();
  if (nodes) {
    // The model knows exactly where its bore, ejection port and sight line are.
    muzzle.position.fromArray(nodes.muzzle);
    ejector.position.fromArray(nodes.eject || nodes.muzzle);
    const sight = nodes.sight || nodes.ironSight;
    const iron = IRON_SIGHTS[weaponKey];
    if (iron && nodes.ironSight) {
      // Iron sights: rear notch and front post lined up on the eye axis.
      const r = nodes.ironSight;
      group.userData.adsPosition = [-r[0] * s, -(r[1] + iron.dy) * s, -iron.relief - r[2] * s];
      group.userData.ironSights = true;
    } else if (sight) {
      // Optics: sight line on the eye axis, ~11 cm of eye relief.
      group.userData.adsPosition = [-sight[0] * s, -sight[1] * s, -0.11 - sight[2] * s];
    }
    group.userData.baseYaw = transform.yaw || 0;
  } else {
    muzzle.position.set(cx, bounds.max.y - h * 0.3, bounds.min.z);
    ejector.position.set(bounds.max.x, bounds.max.y - h * 0.28, THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, 0.55));
  }
  group.add(muzzle, ejector);
  group.userData.muzzle = muzzle;
  group.userData.ejector = ejector;

  group.position.set(...transform.position);
  group.scale.setScalar(transform.scale);
  // Read back by main.js's walk-bob/recoil animation, which offsets from
  // this base rather than overwriting it with a hardcoded position.
  group.userData.basePosition = transform.position;

  return group;
}

// --- Moving parts -------------------------------------------------------------
// Slide / bolt / pump cycling, minigun barrel spin, magazine drop on reload,
// and the RPG warhead leaving the tube.
const CYCLE_SPEED = { pistol: 16, ak47: 22, m4a1: 22, mp5: 24, chaingun: 30, shotgun: 2.6, awp: 1.7, rocket: 4 };

function setupWeaponAnimation(gun, nodes, weaponKey) {
  const parts = gun.userData.parts || {};
  const anim = { key: weaponKey, nodes, parts, rest: new Map(), cycle: 0, spin: 0, spinVel: 0 };
  for (const p of Object.values(parts)) anim.rest.set(p, p.position.clone());
  // Re-pivot the minigun's barrel cluster onto its own axis so it can spin.
  if (parts.barrels && nodes.barrelAxis) {
    const [ax, ay] = nodes.barrelAxis;
    for (const child of parts.barrels.children) {
      child.position.x -= ax;
      child.position.y -= ay;
    }
    parts.barrels.position.x += ax;
    parts.barrels.position.y += ay;
    anim.rest.set(parts.barrels, parts.barrels.position.clone());
  }
  gun.userData.anim = anim;
}

export function weaponFired(view) {
  const anim = view?.userData.gun?.userData.anim;
  if (!anim) return;
  anim.cycle = 1;
  anim.spinVel = Math.max(anim.spinVel, 45);
}

/**
 * @param {object} state { reloadT: 0..1 | null, magEmpty: bool, spinning: bool }
 */
export function updateWeaponParts(view, dt, state) {
  const anim = view?.userData.gun?.userData.anim;
  if (!anim) return;
  const { parts, nodes, rest } = anim;
  anim.cycle = Math.max(0, anim.cycle - dt * (CYCLE_SPEED[anim.key] || 20));
  // Back fast, return a touch slower: a real recoil stroke.
  const p = 1 - anim.cycle;
  const stroke = anim.cycle > 0 ? (p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65) : 0;
  const cyclers = [
    [parts.slide, nodes.slideTravel || [0, 0, 0.022]],
    [parts.bolt, nodes.boltTravel || [0, 0, 0.06]],
    [parts.charging, nodes.chargeTravel || [0, 0, 0]],
    [parts.pump, nodes.pumpTravel || [0, 0, 0.09]],
  ];
  for (const [part, travel] of cyclers) {
    if (!part) continue;
    const r = rest.get(part);
    part.position.set(r.x + travel[0] * stroke, r.y + travel[1] * stroke, r.z + travel[2] * stroke);
  }

  if (parts.barrels) {
    if (state.spinning) anim.spinVel = Math.max(anim.spinVel, 40);
    anim.spinVel *= Math.exp(-dt * 1.6);
    parts.barrels.rotation.z += anim.spinVel * dt;
  }

  if (parts.magazine) {
    const r = rest.get(parts.magazine);
    const drop = nodes.magDrop || [0, -0.4, 0];
    let k = 0;
    const t = state.reloadT;
    if (t !== null && t !== undefined) {
      if (t < 0.25) k = 0;
      else if (t < 0.42) k = (t - 0.25) / 0.17; // mag out
      else if (t < 0.55) k = 1;
      else if (t < 0.68) k = 1 - (t - 0.55) / 0.13; // fresh mag in
    }
    const e = k * k;
    parts.magazine.position.set(r.x + drop[0] * e, r.y + drop[1] * e, r.z + drop[2] * e);
    parts.magazine.visible = k < 0.98;
  }

  if (parts.warhead) parts.warhead.visible = !state.magEmpty || (state.reloadT ?? 0) > 0.6;
}
