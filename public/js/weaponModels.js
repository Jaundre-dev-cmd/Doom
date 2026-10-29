// Realistic procedural weapon models (see weapons/), built once per weapon
// and cloned wherever they're needed: clones share geometry and materials,
// so a soldier carrying a gun costs draw calls, not memory.
//
//   firstPersonWeapon(id) -> full-detail clone for the viewmodel
//   thirdPersonWeapon(id) -> merged low-draw-call clone for soldiers' hands
//   weaponNodes(id)       -> the model's named points (muzzle, sight, grips...)
//
// Everything is real scale in metres, origin at the shooting hand's grip,
// bore down -Z.

import { buildWeaponModel, PROCEDURAL_WEAPON_IDS } from './weapons/catalogue.js';
import { buildWeaponObject, collapseWeaponObject, resolveParts } from './weapons/build.js';
import { WeaponMaterials } from './weapons/materials.js';
import { WEAPON_SURFACE_LIBRARY } from './weapons/surfaces.js';
import { WEAPON_ORDER } from './constants.js';

const materials = new WeaponMaterials(WEAPON_SURFACE_LIBRARY);
const templates = new Map(); // id -> { object, nodes } | null
const thirdPerson = new Map(); // id -> THREE.Group | null

export function hasProceduralWeapon(id) {
  return PROCEDURAL_WEAPON_IDS.includes(id);
}

function template(id) {
  if (templates.has(id)) return templates.get(id);
  let entry = null;
  try {
    const model = buildWeaponModel(id);
    if (model) {
      const object = buildWeaponObject(model, materials, { viewmodel: true });
      entry = { object, nodes: model.nodes };
    }
  } catch (err) {
    console.warn(`[weapons] procedural ${id} failed to build:`, err);
  }
  templates.set(id, entry);
  return entry;
}

export function weaponNodes(id) {
  return template(id)?.nodes ?? null;
}

export function firstPersonWeapon(id) {
  const entry = template(id);
  if (!entry) return null;
  const copy = entry.object.clone(true);
  copy.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = false;
  });
  copy.userData.parts = resolveParts(copy);
  return copy;
}

export function thirdPersonWeapon(id) {
  if (!thirdPerson.has(id)) {
    const entry = template(id);
    let merged = null;
    if (entry) {
      try {
        merged = collapseWeaponObject(entry.object, materials);
      } catch (err) {
        console.warn(`[weapons] third-person collapse failed for ${id}:`, err);
        merged = entry.object;
      }
    }
    thirdPerson.set(id, merged);
  }
  const source = thirdPerson.get(id);
  if (!source) return null;
  const copy = source.clone(true);
  copy.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
  });
  return copy;
}

// Builds every weapon in the background while the player sits in the menu,
// one per idle slice, so equipping a gun mid-match never stalls a frame.
export function prewarmWeapons() {
  const queue = [...WEAPON_ORDER];
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    template(id);
    thirdPersonWeapon(id);
    idle(next);
  };
  idle(next);
}
