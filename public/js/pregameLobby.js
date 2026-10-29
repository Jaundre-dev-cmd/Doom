// Pre-game lobby lineup: every player in the lobby stands on a lit stage as
// their own soldier (camo, accent, headgear) holding their chosen weapon, with
// a name plate (name, ready state, host, weapon) that tracks the model.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPlayerModel } from './playerModel.js';
import { SKINS, ACCENTS, WEAPONS } from './constants.js';

export function createLineup(canvas, platesEl) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  scene.fog = new THREE.Fog(0x07090b, 9, 22);
  scene.add(new THREE.HemisphereLight(0x9fb4c8, 0x1a1712, 0.5));
  const key = new THREE.DirectionalLight(0xffe6c8, 2.4);
  key.position.set(2.5, 6, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2, near: 1, far: 20 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 2.2);
  rim.position.set(-4, 3, -5);
  scene.add(rim);
  const warm = new THREE.DirectionalLight(0xf2a33a, 1.2);
  warm.position.set(5, 1.5, -3);
  scene.add(warm);

  // Stage: dark floor, glowing pad under each soldier, back wall.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.55, metalness: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 12),
    new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.9 })
  );
  wall.position.set(0, 6, -6);
  scene.add(wall);
  const padGeo = new THREE.RingGeometry(0.42, 0.55, 48);
  padGeo.rotateX(-Math.PI / 2);
  const camera = new THREE.PerspectiveCamera(32, 2, 0.1, 60);

  let slots = []; // { lid, model, pad, plate, sig, x }
  let you = null;
  let last = performance.now();
  let active = false;

  function makePlate() {
    const el = document.createElement('div');
    el.className = 'pg-plate';
    platesEl.appendChild(el);
    return el;
  }

  let lastPlayers = null;
  // The realistic soldier streams in after the page loads; rebuild with it.
  window.addEventListener('soldier-ready', () => {
    for (const s of slots) s.sig = '';
    if (lastPlayers) setPlayers(lastPlayers, you);
  });

  function setPlayers(players, youLid) {
    you = youLid;
    lastPlayers = players;
    // You stand in the centre, everyone else alternates left/right.
    const ordered = [...players].sort((a, b) => (a.lid === youLid ? -1 : b.lid === youLid ? 1 : a.lid - b.lid));
    const positions = ordered.map((_, i) => (i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 1.45));
    const keep = new Set(ordered.map((p) => p.lid));
    for (const s of slots) {
      if (!keep.has(s.lid)) {
        scene.remove(s.model.group, s.pad);
        s.model.dispose();
        s.plate.remove();
      }
    }
    slots = ordered.map((p, i) => {
      let s = slots.find((x) => x.lid === p.lid && keep.has(x.lid));
      const sig = `${p.skin}|${p.accent}|${p.headgear}|${p.weapon}`;
      if (!s || s.sig !== sig) {
        if (s) {
          scene.remove(s.model.group);
          s.model.dispose();
        }
        const skin = SKINS.find((k) => k.id === p.skin) || SKINS[0];
        const accent = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
        const model = createPlayerModel(skin, p.name, { accentColor: accent.color, headgear: p.headgear, weapon: p.weapon });
        model.setNameVisible(false);
        model.group.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
          }
        });
        scene.add(model.group);
        if (!s) {
          const pad = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: 0x6f7a84, transparent: true, opacity: 0.7, toneMapped: false }));
          scene.add(pad);
          s = { lid: p.lid, pad, plate: makePlate(), phase: Math.random() * 6 };
        }
        s.model = model;
        s.sig = sig;
      }
      s.x = positions[i];
      s.data = p;
      s.pad.position.set(s.x, 0.01, 0);
      s.pad.material.color.set(p.ready ? 0x3ddc84 : p.lid === youLid ? 0xf2a33a : 0x6f7a84);
      const w = WEAPONS[p.weapon]?.name || p.weapon;
      s.plate.className = 'pg-plate' + (p.ready ? ' ready' : '') + (p.lid === youLid ? ' you' : '');
      s.plate.innerHTML =
        `<div class="pg-name">${p.host ? '<span class="pg-host" title="Host">★</span>' : ''}${escape(p.name)}</div>` +
        `<div class="pg-weapon">${escape(w)}</div>` +
        `<div class="pg-status">${p.ready ? 'READY' : 'NOT READY'}</div>`;
      return s;
    });
    halfSpan = Math.max(...positions.map(Math.abs)) + 0.9;
    frame();
  }

  // Pull the camera back far enough to fit everyone across the screen.
  let halfSpan = 1;
  function frame() {
    const span = Math.max(2.4, halfSpan * 2);
    const dist = Math.max(5.2, span / (2 * Math.tan(THREE.MathUtils.degToRad(32 / 2)) * camera.aspect) + 1.5);
    camera.position.set(0, 1.45, dist);
    camera.lookAt(0, 1.0, 0);
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const v = new THREE.Vector3();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!active) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      frame();
    }
    for (const s of slots) {
      s.phase += dt;
      // Facing the camera, weapon at low ready, a little idle sway.
      // Three-quarter pose so the weapon reads in profile; outer soldiers turn in.
      s.model.setPosition(s.x, 0, 0, Math.PI + 0.55 + Math.sin(s.phase * 0.5) * 0.06 + (s.x ? -Math.sign(s.x) * 0.2 : 0));
      s.model.setPitch(-0.12 + Math.sin(s.phase * 1.3) * 0.02);
      s.model.animate(dt, false, false, 0);
      v.set(s.x, 2.05, 0).project(camera);
      s.plate.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  return {
    setPlayers,
    setActive(a) {
      active = a;
    },
  };
}
