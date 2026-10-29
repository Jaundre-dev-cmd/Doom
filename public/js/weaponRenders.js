// Pictures of the real weapon models, for the UI.
//
// Every gun is photographed once from its right side (ejection port side,
// muzzle pointing right) under studio lighting, giving:
//   shaded     — a full-colour render for the armory, loadout and dictionary
//   silhouette — a crisp white cut-out for HUD icons, kill feed and killcam
// Images are generated in the background while the player is in the menu,
// and `weapon-images-ready` is dispatched on window as each one finishes.
//
// Also provides the armory turntable: a slowly rotating, studio-lit 3D view
// of the selected weapon.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { firstPersonWeapon } from './weaponModels.js';
import { WEAPON_ORDER } from './constants.js';

const images = new Map(); // id -> { shaded, silhouette }
let renderer = null;
let scene = null;
let envTexture = null;

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(720, 270);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  envTexture = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xfff2e0, 3);
  key.position.set(2, 3, -1);
  const rim = new THREE.DirectionalLight(0xa8c8ff, 1.6);
  rim.position.set(-1, 1, 2);
  scene.add(key, rim, new THREE.HemisphereLight(0xdde6f0, 0x303030, 0.6));
}

// Orthographic side-on camera framing the gun's bounding box.
function frame(object, aspect) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let w = size.z * 1.08;
  let h = size.y * 1.12;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01, 10);
  cam.position.set(center.x + 3, center.y, center.z);
  cam.lookAt(center);
  return cam;
}

const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

function photograph(id) {
  ensureRenderer();
  const gun = firstPersonWeapon(id);
  if (!gun) return null;
  scene.add(gun);
  const cam = frame(gun, 720 / 270);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  const shaded = renderer.domElement.toDataURL('image/png');
  scene.overrideMaterial = silhouetteMat;
  renderer.render(scene, cam);
  const silhouette = renderer.domElement.toDataURL('image/png');
  scene.overrideMaterial = null;
  scene.remove(gun);
  return { shaded, silhouette };
}

export function weaponImage(id) {
  return images.get(id) || null;
}

// Renders the guns one per idle slice (the selected one first).
export function generateWeaponImages(first) {
  const queue = [first, ...WEAPON_ORDER.filter((id) => id !== first)].filter(Boolean);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    if (!images.has(id)) {
      try {
        const result = photograph(id);
        if (result) {
          images.set(id, result);
          window.dispatchEvent(new CustomEvent('weapon-images-ready', { detail: { id } }));
        }
      } catch (err) {
        console.warn(`[weapons] could not render image for ${id}:`, err);
      }
    }
    idle(next);
  };
  idle(next);
}

// --- Armory turntable --------------------------------------------------------

export function createWeaponTurntable(canvas) {
  if (!canvas) return { show() {} };
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Scene();
  s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  s.environmentIntensity = 0.85;
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(2, 3, 1);
  const rim = new THREE.DirectionalLight(0x9ec4ff, 1.8);
  rim.position.set(-2, 1, -2);
  s.add(key, rim);
  const pivot = new THREE.Group();
  s.add(pivot);
  const cam = new THREE.PerspectiveCamera(26, 2, 0.01, 20);
  let current = null;
  let shown = '';
  let angle = 0.6;
  let last = performance.now();

  function show(id) {
    if (id === shown) return;
    shown = id;
    if (current) pivot.remove(current);
    current = firstPersonWeapon(id);
    if (!current) return;
    // Centre the gun on the pivot and frame it.
    const box = new THREE.Box3().setFromObject(current);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    current.position.sub(center);
    pivot.add(current);
    const radius = size.length() / 2;
    cam.position.set(0, radius * 0.3, radius / Math.tan(THREE.MathUtils.degToRad(13)) * 0.72);
    cam.lookAt(0, 0, 0);
  }

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!current || !canvas.offsetParent) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * r.getPixelRatio()) || canvas.height !== Math.floor(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
    angle += dt * 0.5;
    pivot.rotation.y = angle;
    pivot.rotation.x = Math.sin(now / 2600) * 0.08;
    r.render(s, cam);
  }
  requestAnimationFrame(tick);
  return { show };
}
