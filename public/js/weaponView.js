// First-person weapon viewmodels: metal-shaded primitive meshes attached
// to the camera, built with more individual parts (sights, trigger guard,
// magazine, stock, ammo belt, etc.) than a bare body+barrel block, to read
// more like a real gun silhouette.

import * as THREE from 'three';
import { buildAK } from './weapons/models/ak.js';
import { buildWeaponObject } from './weapons/build.js';
import { WeaponMaterials } from './weapons/materials.js';

function metalMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35, ...extra });
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
// public/js/weapons/). No shared procedural PBR texture library is supplied
// (that's a separate, much larger subsystem this project doesn't have), so
// WeaponMaterials falls back to its own plain metal/wood/polymer materials —
// the geometry is the real thing; the shading is simplified.
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
    // A bug deep in ~6000 lines of ported code should never crash the game —
    // fall back to the simple silhouette instead.
    console.warn('[weapons] procedural AK-47 build failed, using fallback silhouette:', err);
    return buildWeaponMesh('ak47');
  }
}

export function createWeaponView(weaponKey) {
  const group = new THREE.Group();
  group.position.set(0.35, -0.3, -0.6);
  group.add(weaponKey === 'ak47' ? buildProceduralAK() : buildWeaponMesh(weaponKey));
  group.userData.weaponKey = weaponKey;
  return group;
}
