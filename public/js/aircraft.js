// Killstreak hardware: the strike jet, the UAV drone, and the rugged
// tactical tablet you pull out to call in an airstrike. All built from
// primitives in code. No real lights are used (emissive materials only),
// so spawning them never changes the scene's light count.

import * as THREE from 'three';

const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b7178, metalness: 0.55, roughness: 0.45 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.4, roughness: 0.6 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.9, roughness: 0.1, emissive: 0x0a1420 });
const burnerMat = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false });

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Strike fighter, nose toward -Z, ~15 m long.
export function makeJet() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 11, 6, 12), hullMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 12), hullMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.4;
  g.add(nose);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  canopy.scale.set(0.9, 0.8, 2.4);
  canopy.position.set(0, 0.55, -4);
  g.add(canopy);
  // Swept delta wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(5.5, 3.2);
  wingShape.lineTo(5.5, 4.4);
  wingShape.lineTo(0, 5.4);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.15, bevelEnabled: false });
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.rotation.x = Math.PI / 2;
    wing.scale.x = side;
    wing.position.set(side * 0.5, -0.1, -2);
    wing.castShadow = true;
    g.add(wing);
    const tail = new THREE.Mesh(wingGeo, hullMat);
    tail.rotation.x = Math.PI / 2;
    tail.scale.set(side * 0.45, 0.45, 1);
    tail.position.set(side * 0.4, 0, 4);
    g.add(tail);
    // twin canted fins
    const fin = part(new THREE.BoxGeometry(0.12, 2.2, 2.4), hullMat, side * 0.9, 1.2, 4.6);
    fin.rotation.z = -side * 0.35;
    g.add(fin);
    // ordnance under the wings
    for (const wx of [2, 3.6]) {
      const bomb = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.4, 4, 8), darkMat);
      bomb.rotation.x = Math.PI / 2;
      bomb.position.set(side * wx, -0.45, 0.6);
      g.add(bomb);
    }
  }
  const burner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 12, 1, true), burnerMat);
  burner.rotation.x = Math.PI / 2;
  burner.position.z = 7.6;
  g.add(burner);
  return g;
}

export function makeBomb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.3, 4, 8), darkMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.35, 0.3), darkMat);
    fin.rotation.z = (i * Math.PI) / 2;
    fin.position.z = 0.75;
    fin.translateY(0.2);
    g.add(fin);
  }
  return g;
}

// MQ-style reconnaissance drone, nose toward -Z.
export function makeUav() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 5, 6, 10), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.5 }));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const wing = part(new THREE.BoxGeometry(14, 0.08, 1), hullMat, 0, 0.2, -0.3);
  g.add(wing);
  for (const s of [-1, 1]) {
    const v = part(new THREE.BoxGeometry(0.06, 1, 0.8), hullMat, s * 0.6, 0.45, 2.6);
    v.rotation.z = s * 0.6;
    g.add(v);
    g.add(part(new THREE.SphereGeometry(0.12, 6, 6), redLightMat, s * 7, 0.2, -0.3));
  }
  const ball = part(new THREE.SphereGeometry(0.35, 12, 10), darkMat, 0, -0.4, -2);
  g.add(ball);
  const prop = part(new THREE.BoxGeometry(1.6, 0.05, 0.12), darkMat, 0, 0, 3.1);
  g.add(prop);
  g.userData.prop = prop;
  g.userData.blink = g.children.filter((c) => c.material === redLightMat);
  return g;
}

// Rugged tactical tablet held in both gloved hands; the screen shows a
// live-looking satellite map (drawn into `screenCanvas` by the caller).
export function makeTablet(screenCanvas) {
  const g = new THREE.Group();
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.8 });
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x4a4f36, roughness: 0.9 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.95 });
  g.add(part(new THREE.BoxGeometry(0.3, 0.2, 0.018), caseMat, 0, 0, 0));
  for (const [x, y] of [[-0.15, 0.1], [0.15, 0.1], [-0.15, -0.1], [0.15, -0.1]]) {
    g.add(part(new THREE.BoxGeometry(0.04, 0.04, 0.03), bumperMat, x, y, 0));
  }
  const tex = new THREE.CanvasTexture(screenCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.165), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.0095;
  g.add(screen);
  g.userData.screenTexture = tex;
  // Gloved hands gripping the sides
  for (const s of [-1, 1]) {
    const hand = new THREE.Group();
    hand.add(part(new THREE.BoxGeometry(0.06, 0.1, 0.05), gloveMat, 0, 0, -0.01));
    for (let f = 0; f < 4; f++) hand.add(part(new THREE.CapsuleGeometry(0.009, 0.03, 2, 6), gloveMat, -s * 0.03, 0.035 - f * 0.022, 0.018));
    hand.add(part(new THREE.CapsuleGeometry(0.012, 0.04, 2, 6), gloveMat, -s * 0.02, 0.05, 0.02));
    const sleeve = part(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x4b5a35, roughness: 0.95 }), s * 0.05, -0.12, 0.18);
    sleeve.rotation.x = 1.1;
    hand.add(sleeve);
    hand.position.set(s * 0.165, -0.02, 0);
    g.add(hand);
  }
  return g;
}
