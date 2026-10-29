import * as THREE from 'three';
import { Network } from './network.js';
import { LocalPlayer, queryCollidables } from './localPlayer.js';
import { buildWorld } from './world.js';
import { createPlayerModel, createZombieModel, makeCamoCanvas } from './playerModel.js';
import { humanSoldierReady, prepareZombieAssets } from './humanSoldier.js';
import { createWeaponView, weaponFired, updateWeaponParts } from './weaponView.js';
import { prewarmWeapons } from './weaponModels.js';
import { weaponImage, generateWeaponImages, createWeaponTurntable } from './weaponRenders.js';
import { createLineup } from './pregameLobby.js';
import { GrenadeSystem, createHeldGrenade, blastFalloff } from './grenades.js';
import { getQualityPreset, batchStaticMeshes, collectRaycastTargets, LightPool, createPostFx } from './perf.js';
import * as sfx from './audio.js';
import { Viewmodel, WEAPON_FOV_PRESETS } from './viewmodel.js';
import { makeJet, makeBomb, makeUav, makeTablet } from './aircraft.js';
import {
  WEAPONS,
  WEAPON_ORDER,
  SKINS,
  SKIN_ORDER,
  ACCENTS,
  ACCENT_ORDER,
  HEADGEAR,
  HEADGEAR_ORDER,
  MAPS,
  MAP_ORDER,
  SECRET_AREA,
  MOUSE_SENSITIVITY,
  MAX_PITCH,
  MOVE_SPEED,
  NETWORK_SEND_INTERVAL_MS,
  INTERPOLATION_DELAY_MS,
  RESPAWN_DELAY_MS,
  PLAYER_EYE_HEIGHT,
  PLAYER_CROUCH_EYE_HEIGHT,
  ROCKET_SPEED,
  ROCKET_MAX_RANGE,
  ROCKET_EXPLOSION_RADIUS,
  ROCKET_COLLISION_RADIUS,
  GRENADE_FUSE_MS,
  GRENADE_THROW_SPEED,
  GRENADE_BLAST_RADIUS,
  GRENADE_DAMAGE,
  GRENADES_PER_LIFE,
  HEADSHOT_MULTIPLIER,
  LIMB_MULTIPLIER,
} from './constants.js';

// Shortest-path angle interpolation (handles the -PI/PI wrap).
function lerpAngle(a, b, t) {
  const diff = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

const $ = (id) => document.getElementById(id);

// --- DOM references ---------------------------------------------------
const lobby = $('lobby');
const lobbyForm = $('lobby-form');
const nameInput = $('player-name');
const serverInput = $('server-address');
const connectionInfoEl = $('connection-info');
const statusEl = $('lobby-status');
const weaponCardsEl = $('weapon-cards');
const skinSwatchesEl = $('skin-swatches');
const accentSwatchesEl = $('accent-swatches');
const headgearCardsEl = $('headgear-cards');
const mapCardsEl = $('map-cards');

const gameContainer = $('game-container');
const hud = $('hud');
const healthValueEl = $('health-value');
const healthBarFillEl = $('health-bar-fill');
const weaponNameEl = $('weapon-name');
const secretsValueEl = $('secrets-value');
const playersListEl = $('players-list');
const bannerEl = $('banner');
const crosshair = $('crosshair');
const hitmarkerEl = $('hitmarker');
const damageFlash = $('damage-flash');
const clickOverlay = $('click-overlay');
const minimap = $('minimap');
const minimapCtx = minimap.getContext('2d');
const squadCountEl = $('squad-count');
const compassStrip = $('compass-strip');
const pingValueEl = $('ping-value');
const pingBarsEl = $('ping-bars');
const ammoMagEl = $('ammo-mag');
const ammoReserveEl = $('ammo-reserve');
const weaponIconEl = $('weapon-icon');
const flyingIndicatorEl = $('flying-indicator');
const inventoryOverlay = $('inventory-overlay');
const inventoryCloseButton = $('inventory-close');
const inventoryListEl = $('inventory-list');
const helpOverlay = $('help-overlay');
const helpCloseButton = $('help-close');
const weaponsOverlay = $('weapons-overlay');
const weaponsCloseButton = $('weapons-close');
const weaponsManifestoGrid = $('weapons-manifesto-grid');
const zombieHudEl = $('zombie-hud');
const roundValueEl = $('round-value');
const zombiesRemainingValueEl = $('zombies-remaining-value');
const zombieKillsValueEl = $('zombie-kills-value');
const sniperScopeEl = $('sniper-scope');
const killfeedEl = $('killfeed');
const damageIndicatorsEl = $('damage-indicators');
const grenadeWarningEl = $('grenade-warning');
const reloadIndicatorEl = $('reload-indicator');
const reloadBarEl = $('reload-bar');
const stanceEl = $('stance-indicator');
const grenadeCountEl = $('grenade-count');
const fpsCounterEl = $('fps-counter');
const killNotifyEl = $('kill-notify');
const killcamOverlayEl = $('killcam-overlay');

const WEAPON_DESCRIPTIONS = {
  pistol: 'Reliable semi-automatic sidearm. Fast handling, accurate first shot, low recoil.',
  shotgun: 'Pump-action shotgun. Nine pellets per shell — devastating up close, useless at range.',
  chaingun: 'Rotary machine gun. A 100-round belt of suppressing fire; long reload, heavy spread.',
  rocket: 'Shoulder-fired launcher. A real travelling projectile with a big blast radius — mind the splash.',
  ak47: 'High-calibre assault rifle. Hits hard with strong vertical recoil — pull down to control it.',
  m4a1: 'Suppressed carbine. Accurate and controllable, and its shots don\'t reveal you on enemy radar.',
  mp5: 'Suppressed SMG. Very fast fire rate and handling, falls off at range. Silent on radar.',
  awp: 'Bolt-action sniper. One-shot headshots; wildly inaccurate unless scoped and standing still.',
};

function weaponStats(key) {
  const w = WEAPONS[key];
  const clamp = (v) => Math.max(4, Math.min(100, Math.round(v)));
  return {
    damage: clamp((w.damage * w.pellets) / 1.3),
    firerate: clamp(6000 / w.fireCooldownMs),
    precision: clamp(100 - w.spread * 450 - w.spread * w.adsSpread * 1500),
    auto: w.auto,
    desc: WEAPON_DESCRIPTIONS[key] || '',
  };
}

// --- Settings ------------------------------------------------------------
const settings = {
  sensitivity: 1,
  adsSensitivity: 0.85,
  fov: 90, // horizontal degrees, measured like Call of Duty
  weaponFov: 'default',
  adsFov: 'affected',
  quality: 'high',
  rawInput: true,
  invertY: false,
  showFps: false,
};

try {
  Object.assign(settings, JSON.parse(localStorage.getItem('doom.settings') || '{}'));
} catch {
  // Storage unavailable — defaults are fine.
}

function saveSettings() {
  try {
    localStorage.setItem('doom.settings', JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function bindSettingsUI() {
  const ranges = [
    ['set-sensitivity', 'sensitivity', 2],
    ['set-ads-sensitivity', 'adsSensitivity', 2],
    ['set-fov', 'fov', 0],
  ];
  for (const [id, key, digits] of ranges) {
    const el = $(id);
    const valEl = $(`${id}-val`);
    if (!el) continue;
    const paint = () => {
      const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
      el.style.setProperty('--fill', `${pct}%`);
      if (valEl) valEl.textContent = Number(el.value).toFixed(digits);
    };
    el.value = settings[key];
    paint();
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      paint();
      saveSettings();
    });
  }
  const checks = [
    ['set-raw-input', 'rawInput'],
    ['set-invert-y', 'invertY'],
    ['set-show-fps', 'showFps'],
  ];
  for (const [id, key] of checks) {
    const el = $(id);
    if (!el) continue;
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
    });
  }
  const selects = [
    ['set-quality', 'quality'],
    ['set-weapon-fov', 'weaponFov'],
    ['set-ads-fov', 'adsFov'],
  ];
  for (const [id, key] of selects) {
    const el = $(id);
    if (!el) continue;
    el.value = settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.value;
      saveSettings();
      if (key === 'weaponFov') viewmodel?.setFov(WEAPON_FOV_PRESETS[settings.weaponFov] || WEAPON_FOV_PRESETS.default);
    });
  }
}
bindSettingsUI();

// The FOV setting is horizontal degrees on a 16:9 screen (how Call of
// Duty measures it); Three.js cameras take vertical FOV.
function verticalFov(horizontalDeg) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontalDeg) / 2) * (9 / 16)));
}

// --- Lobby selection state ----------------------------------------------
let selectedWeapon = 'ak47';
let selectedSkin = SKIN_ORDER[0];
let selectedAccent = ACCENT_ORDER[0];
let selectedHeadgear = 'helmet';
let selectedMap = MAP_ORDER[0];

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

const swatchImages = new Map();
function skinSwatchBackground(skin) {
  if (!skin.camo) return hex(skin.color);
  if (!swatchImages.has(skin.id)) swatchImages.set(skin.id, `url(${makeCamoCanvas(skin, 96).toDataURL()}) center/cover`);
  return swatchImages.get(skin.id);
}

function buildLobbyCards() {
  weaponCardsEl.innerHTML = '';
  for (const key of WEAPON_ORDER) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (key === selectedWeapon ? ' selected' : '');
    const img = weaponImage(key);
    if (img) {
      // A real render of the weapon model.
      card.classList.add('has-image');
      card.innerHTML = `<img class="weapon-render" src="${img.shaded}" alt="" /><span class="weapon-card-name">${WEAPONS[key].name}<small>${WEAPON_TAGS[key] || ''}</small></span>`;
    } else {
      card.textContent = WEAPONS[key].name;
    }
    card.addEventListener('click', () => {
      selectedWeapon = key;
      buildLobbyCards();
    });
    weaponCardsEl.appendChild(card);
  }
  updateArmoryStatsPanel();

  skinSwatchesEl.innerHTML = '';
  for (const skin of SKINS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (skin.id === selectedSkin ? ' selected' : '');
    sw.style.background = skinSwatchBackground(skin);
    sw.title = skin.name;
    sw.addEventListener('click', () => {
      selectedSkin = skin.id;
      buildLobbyCards();
    });
    skinSwatchesEl.appendChild(sw);
  }
  const skinNameEl = $('skin-name');
  if (skinNameEl) skinNameEl.textContent = (SKINS.find((s) => s.id === selectedSkin) || SKINS[0]).name;

  accentSwatchesEl.innerHTML = '';
  for (const accent of ACCENTS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (accent.id === selectedAccent ? ' selected' : '');
    sw.style.background = hex(accent.color);
    sw.title = accent.name;
    sw.addEventListener('click', () => {
      selectedAccent = accent.id;
      buildLobbyCards();
    });
    accentSwatchesEl.appendChild(sw);
  }

  headgearCardsEl.innerHTML = '';
  for (const gear of HEADGEAR) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (gear.id === selectedHeadgear ? ' selected' : '');
    card.textContent = gear.name;
    card.addEventListener('click', () => {
      selectedHeadgear = gear.id;
      buildLobbyCards();
    });
    headgearCardsEl.appendChild(card);
  }

  mapCardsEl.innerHTML = '';
  for (const key of MAP_ORDER) {
    const m = MAPS[key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card map-card' + (key === selectedMap ? ' selected' : '');
    card.style.background = `linear-gradient(135deg, ${hex(m.sky)}, ${hex(m.groundColor)})`;
    card.innerHTML = `${m.name}<span>${m.description}</span>`;
    card.addEventListener('click', () => {
      selectedMap = key;
      buildLobbyCards();
    });
    mapCardsEl.appendChild(card);
  }
  operatorPreview.refresh();
}

function updateArmoryStatsPanel() {
  armoryTurntable.show(selectedWeapon);
  const w = WEAPONS[selectedWeapon];
  const specs = $('stat-weapon-specs');
  if (specs) {
    specs.textContent = `${WEAPON_TAGS[selectedWeapon] || ''} · ${w.mag} RND · ${Math.round(60000 / w.fireCooldownMs)} RPM · ${(w.reloadMs / 1000).toFixed(1)}s RELOAD`;
  }
  const stats = weaponStats(selectedWeapon);
  const set = (id, fn) => {
    const el = $(id);
    if (el) fn(el);
  };
  set('stat-weapon-name', (el) => (el.textContent = WEAPONS[selectedWeapon].name));
  set('stat-bar-damage', (el) => (el.style.width = `${stats.damage}%`));
  set('stat-val-damage', (el) => (el.textContent = stats.damage));
  set('stat-bar-firerate', (el) => (el.style.width = `${stats.firerate}%`));
  set('stat-val-firerate', (el) => (el.textContent = stats.firerate));
  set('stat-bar-precision', (el) => (el.style.width = `${stats.precision}%`));
  set('stat-val-precision', (el) => (el.textContent = stats.precision));
  set('stat-val-auto', (el) => (el.textContent = stats.auto ? 'YES' : 'NO'));
  set('stat-weapon-desc', (el) => (el.textContent = stats.desc));
}

// --- Armory 3D turntable ---------------------------------------------------
const armoryTurntable = createWeaponTurntable($('armory-preview'));

// --- Operator 3D preview (lobby) ----------------------------------------
// A small separate renderer showing your soldier with the chosen camo,
// accent, headgear and starting weapon, slowly turning on a stage.
const operatorPreview = (() => {
  const canvas = $('operator-preview');
  let renderer = null;
  let scene = null;
  let cam = null;
  let model = null;
  let built = '';
  let angle = Math.PI * 0.85;

  function init() {
    if (renderer || !canvas) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    cam.position.set(0, 1.25, 5.2);
    cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xc8d4e0, 0x2a2620, 0.9));
    const key = new THREE.DirectionalLight(0xffe6c8, 2.6);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb0ff, 2.2);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.ShadowMaterial({ opacity: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  function refresh() {
    if (!canvas) return;
    init();
    const sig = `${selectedSkin}|${selectedAccent}|${selectedHeadgear}|${selectedWeapon}`;
    if (sig === built) return;
    built = sig;
    if (model) {
      scene.remove(model.group);
      model.dispose();
    }
    const skin = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];
    const accent = ACCENTS.find((a) => a.id === selectedAccent) || ACCENTS[0];
    model = createPlayerModel(skin, localStorage.getItem('doom.playerName') || '', { accentColor: accent.color, headgear: selectedHeadgear, weapon: selectedWeapon });
    model.setNameVisible(false);
    model.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(model.group);
  }

  window.addEventListener('soldier-ready', () => {
    built = '';
    refresh();
  });

  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!renderer || !model || lobby.classList.contains('hidden') || !canvas.offsetParent) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    }
    angle += dt * 0.45;
    model.setPosition(0, 0, 0, angle);
    model.setPitch(Math.sin(now / 1400) * 0.15);
    model.animate(dt, false, false, 0);
    renderer.render(scene, cam);
  }
  requestAnimationFrame(tick);
  return { refresh };
})();

// --- Input ----------------------------------------------------------------
const input = { forward: false, backward: false, left: false, right: false, sprint: false, spaceHeld: false, crouchHeld: false };
let isFireHeld = false;
let isAds = false;
let weaponIndex = 0;
let cheatBuffer = '';
let inventoryOpen = false;
let helpOpen = false;
let weaponsOpen = false;

const CHEAT_MESSAGES = {
  iddqd: 'DEGREELESSNESS MODE ON',
  idkfa: 'ARMS DEALER MODE — EVERYTHING YOU NEED',
  helpme: 'CHEAT',
  idclip: 'NO CLIPPING MODE ON',
};

function pointerLocked() {
  return !!renderer && document.pointerLockElement === renderer.domElement;
}

function canAct() {
  return running && localPlayer && !dead && !inventoryOpen && !helpOpen && !weaponsOpen && !tablet;
}

function clearInput() {
  for (const key in input) input[key] = false;
  isFireHeld = false;
  isAds = false;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  // Ctrl+T cheat. Browsers reserve Ctrl+T (new tab); the page only gets
  // it while fullscreen with the keyboard locked (see requestLock), so
  // typing HELPME in-game does the same thing as a fallback.
  if (e.ctrlKey && e.code === 'KeyT') {
    e.preventDefault();
    if (running && !dead) activateCheats();
    return;
  }
  if (!running) return;

  if (e.code === 'Tab') {
    e.preventDefault();
    if (!dead) toggleInventory();
    return;
  }
  if (dead) return;
  if (sat.active || tablet) {
    if (e.code === 'KeyX' && !e.repeat) exitSatView();
    return;
  }
  setKey(e.code, true);
  if (e.repeat) return;

  if (e.code === 'KeyZ') callUav();
  if (e.code === 'KeyX') openTablet();

  if (e.code === 'Space' && localPlayer && !localPlayer.flying) localPlayer.jump();
  if (e.code === 'KeyC' && localPlayer && !localPlayer.flying) localPlayer.crouching = !localPlayer.crouching;
  if (e.code === 'KeyF' && localPlayer) {
    localPlayer.flying = !localPlayer.flying;
    if (localPlayer.flying) localPlayer.crouching = false;
  }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG') startCook();
  if (e.code === 'KeyT') switchWeapon(WEAPON_ORDER.indexOf('rocket'));
  if (e.code === 'KeyI') toggleHelp();
  if (e.code === 'KeyL' && flashlight) {
    flashlight.visible = !flashlight.visible;
    sfx.playSwitch?.();
  }
  if (e.code === 'KeyU') toggleWeapons();

  if (pointerLocked() && /^[a-z]$/i.test(e.key)) {
    cheatBuffer = (cheatBuffer + e.key.toLowerCase()).slice(-6);
    for (const code of Object.keys(CHEAT_MESSAGES)) {
      if (cheatBuffer.endsWith(code)) {
        if (code === 'helpme') activateCheats();
        else showBanner(CHEAT_MESSAGES[code], 2000);
        cheatBuffer = '';
        break;
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  setKey(e.code, false);
  if (e.code === 'KeyG') releaseGrenade();
});

function setKey(code, value) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      input.forward = value;
      break;
    case 'KeyS':
    case 'ArrowDown':
      input.backward = value;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      input.left = value;
      break;
    case 'KeyD':
    case 'ArrowRight':
      input.right = value;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      input.sprint = value;
      break;
    case 'Space':
      input.spaceHeld = value;
      break;
    case 'KeyC':
      input.crouchHeld = value;
      break;
    default:
      if (value && /^Digit[1-8]$/.test(code)) switchWeapon(Number(code.slice(5)) - 1);
      break;
  }
}

document.addEventListener('wheel', (e) => {
  if (!pointerLocked() || dead) return;
  if (sat.active) {
    sat.height = THREE.MathUtils.clamp(sat.height + e.deltaY * 0.15, 90, 320);
    return;
  }
  const dir = e.deltaY > 0 ? 1 : -1;
  switchWeapon((weaponIndex + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length);
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

// Weapon sway from mouse motion (viewmodel lags slightly behind the view).
let vmSwayX = 0;
let vmSwayY = 0;

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked() || !localPlayer || dead) return;
  let mx = e.movementX;
  let my = e.movementY;
  // Some browsers emit a huge bogus delta when the pointer lock re-centres.
  if (Math.abs(mx) > 600 || Math.abs(my) > 600) return;
  if (sat.active) {
    // Pan the satellite view (faster when zoomed out).
    const k = sat.height * 0.0011 * settings.sensitivity;
    sat.x = THREE.MathUtils.clamp(sat.x + mx * k, -world.bounds, world.bounds);
    sat.z = THREE.MathUtils.clamp(sat.z + my * k, -world.bounds, world.bounds);
    return;
  }
  if (settings.invertY) my = -my;
  const adsScale = adsProgress > 0.5 ? settings.adsSensitivity * (camera.fov / verticalFov(settings.fov)) : 1;
  const sens = MOUSE_SENSITIVITY * settings.sensitivity * adsScale;
  localPlayer.rotateYaw(mx, sens);
  localPlayer.rotatePitch(my, sens, MAX_PITCH);
  // Pulling down while firing counts against the recoil to recover.
  if (my > 0 && recoilDebt > 0) recoilDebt = Math.max(0, recoilDebt - my * sens);
  vmSwayX = THREE.MathUtils.clamp(vmSwayX + mx * 0.00005, -0.05, 0.05);
  vmSwayY = THREE.MathUtils.clamp(vmSwayY + my * 0.00005, -0.05, 0.05);
});

function requestLock() {
  if (!renderer) return;
  const el = renderer.domElement;
  // Fullscreen + keyboard lock lets the game receive Ctrl+T / Ctrl+W
  // instead of the browser opening or closing tabs (Chrome/Edge).
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement
      .requestFullscreen()
      .then(() => navigator.keyboard?.lock?.(['KeyT', 'KeyW', 'KeyN']))
      .catch(() => {});
  }
  try {
    const p = el.requestPointerLock(settings.rawInput ? { unadjustedMovement: true } : undefined);
    if (p && p.catch) p.catch(() => el.requestPointerLock());
  } catch {
    el.requestPointerLock();
  }
}

document.addEventListener('mousedown', (e) => {
  sfx.initAudio();
  if (!running) return;
  if (pointerLocked()) {
    if (dead) return;
    if (sat.active) {
      if (e.button === 0) confirmAirstrike();
      else if (e.button === 2) exitSatView();
      return;
    }
    if (tablet) return;
    if (e.button === 0) {
      isFireHeld = true;
      tryFire(true);
    } else if (e.button === 2) {
      isAds = true;
    }
  } else if (renderer && (e.target === renderer.domElement || e.target.closest?.('#click-overlay'))) {
    requestLock();
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) isFireHeld = false;
  else if (e.button === 2) isAds = false;
});

document.addEventListener('pointerlockchange', () => {
  const locked = pointerLocked();
  clickOverlay.classList.toggle('hidden', locked || !running || inventoryOpen || helpOpen || weaponsOpen);
  if (!locked) {
    isFireHeld = false;
    isAds = false;
    if (sat.active || tablet) exitSatView();
  }
});

window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postFx?.setSize(window.innerWidth, window.innerHeight);
  viewmodel?.resize(camera.aspect);
  if (satCamera) {
    satCamera.aspect = camera.aspect;
    satCamera.updateProjectionMatrix();
  }
});

// --- Cheap HUD writes ---------------------------------------------------------
// The HUD updates every frame; writing an unchanged value to the DOM still
// costs a style/layout pass, so these only touch the page when it changed.
const _hudCache = new WeakMap();
function hudSet(el, key, value, apply) {
  if (!el) return;
  let c = _hudCache.get(el);
  if (!c) _hudCache.set(el, (c = {}));
  if (c[key] === value) return;
  c[key] = value;
  apply(el, value);
}
const setText = (el, v) => hudSet(el, 'text', String(v), (e, x) => (e.textContent = x));
const setStyle = (el, prop, v) => hudSet(el, 's:' + prop, v, (e, x) => (e.style[prop] = x));
const setData = (el, name, v) => hudSet(el, 'd:' + name, v, (e, x) => (e.dataset[name] = x));
const setVar = (el, name, v) => hudSet(el, 'v:' + name, v, (e, x) => e.style.setProperty(name, x));

// --- Banner / notifications ---------------------------------------------
let bannerHideTimeout = null;
function showBanner(text, durationMs = 2500) {
  bannerEl.textContent = text;
  bannerEl.style.opacity = '1';
  clearTimeout(bannerHideTimeout);
  bannerHideTimeout = setTimeout(() => {
    bannerEl.style.opacity = '0';
  }, durationMs);
}

let killNotifyTimeout = null;
function notifyKill(text, headshot = false) {
  if (!killNotifyEl) return;
  killNotifyEl.textContent = text;
  killNotifyEl.classList.remove('show', 'headshot');
  void killNotifyEl.offsetWidth;
  killNotifyEl.classList.add('show');
  killNotifyEl.classList.toggle('headshot', headshot);
  clearTimeout(killNotifyTimeout);
  killNotifyTimeout = setTimeout(() => killNotifyEl.classList.remove('show'), 1800);
}

let damageFlashLevel = 0;
function flashDamage(amount = 0.45) {
  damageFlashLevel = Math.min(0.85, damageFlashLevel + amount);
}

let hitmarkerTimeout = null;
function flashHitmarker(kind = 'body') {
  if (!hitmarkerEl) return;
  hitmarkerEl.classList.remove('active', 'headshot', 'kill');
  void hitmarkerEl.offsetWidth;
  hitmarkerEl.classList.add('active');
  if (kind === 'head') hitmarkerEl.classList.add('headshot');
  if (kind === 'kill') hitmarkerEl.classList.add('kill');
  sfx.playHitmarker(kind);
  clearTimeout(hitmarkerTimeout);
  hitmarkerTimeout = setTimeout(() => hitmarkerEl.classList.remove('active', 'headshot', 'kill'), kind === 'kill' ? 350 : 140);
}

function showDamageIndicator(ax, az) {
  if (!damageIndicatorsEl || !localPlayer) return;
  const yaw = Math.atan2(-(ax - localPlayer.x), -(az - localPlayer.z));
  const rel = lerpAngle(0, yaw - localPlayer.angle, 1);
  const el = document.createElement('div');
  el.className = 'dmg-ind';
  el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  damageIndicatorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// --- Secret area ------------------------------------------------------
let secretFound = false;
function checkSecretArea() {
  if (secretFound || !localPlayer) return;
  const { x0, z0, x1, z1 } = SECRET_AREA;
  if (localPlayer.x >= x0 && localPlayer.x <= x1 && localPlayer.z >= z0 && localPlayer.z <= z1) {
    secretFound = true;
    secretsValueEl.textContent = '1';
    showBanner('A secret is revealed!');
  }
}

// --- Overlays (inventory / help / weapons dictionary) ---------------------
function setOverlay(which) {
  const was = { inventory: inventoryOpen, help: helpOpen, weapons: weaponsOpen }[which];
  inventoryOpen = helpOpen = weaponsOpen = false;
  if (!was) {
    if (which === 'inventory') inventoryOpen = true;
    if (which === 'help') helpOpen = true;
    if (which === 'weapons') weaponsOpen = true;
  }
  inventoryOverlay.classList.toggle('hidden', !inventoryOpen);
  helpOverlay.classList.toggle('hidden', !helpOpen);
  weaponsOverlay.classList.toggle('hidden', !weaponsOpen);
  const anyOpen = inventoryOpen || helpOpen || weaponsOpen;
  if (inventoryOpen) renderInventory();
  if (weaponsOpen) renderWeaponsManifesto();
  if (anyOpen) {
    clearInput();
    clickOverlay.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    clickOverlay.classList.remove('hidden');
  }
}
const toggleInventory = () => localPlayer && setOverlay('inventory');
const toggleHelp = () => localPlayer && setOverlay('help');
const toggleWeapons = () => localPlayer && setOverlay('weapons');
inventoryCloseButton.addEventListener('click', () => inventoryOpen && toggleInventory());
helpCloseButton.addEventListener('click', () => helpOpen && toggleHelp());
weaponsCloseButton?.addEventListener('click', () => weaponsOpen && toggleWeapons());

const WEAPON_TAGS = {
  pistol: 'SIDEARM',
  shotgun: 'SHOTGUN',
  chaingun: 'LMG',
  rocket: 'LAUNCHER',
  ak47: 'ASSAULT RIFLE',
  m4a1: 'CARBINE',
  mp5: 'SMG',
  awp: 'SNIPER',
};

function renderInventory() {
  inventoryListEl.innerHTML = WEAPON_ORDER.map((key, i) => {
    const equipped = i === weaponIndex;
    const ammo = ammoFor(key);
    return `
      <li class="${equipped ? 'equipped' : ''}" data-index="${i}">
        <div class="inv-item-top">
          <span class="inv-item-tag">${WEAPON_TAGS[key] || ''}</span>
          ${equipped ? '<span class="inv-badge equipped">EQUIPPED</span>' : `<span class="inv-badge owned">${ammo.mag}/${ammo.reserve}</span>`}
        </div>
        ${weaponImage(key) ? `<img class="inv-render" src="${weaponImage(key).shaded}" alt="" />` : ''}
        <div class="inv-item-name">${WEAPONS[key].name}</div>
      </li>`;
  }).join('');
  for (const li of inventoryListEl.querySelectorAll('li')) {
    li.addEventListener('click', () => {
      switchWeapon(Number(li.dataset.index));
      toggleInventory();
    });
  }
}

function renderWeaponsManifesto() {
  if (!weaponsManifestoGrid) return;
  weaponsManifestoGrid.innerHTML = WEAPON_ORDER.map((key, i) => {
    const w = WEAPONS[key];
    const stats = weaponStats(key);
    const bar = (label, v) => `
          <div class="weapon-info-stat-row">
            <span>${label}</span>
            <div class="weapon-info-stat-bar-bg"><div class="weapon-info-stat-bar-fill" style="width: ${v}%"></div></div>
            <strong>${v}</strong>
          </div>`;
    return `
      <div class="weapon-info-item ${i === weaponIndex ? 'equipped' : ''}" data-index="${i}">
        <div>
          ${weaponImage(key) ? `<img class="inv-render" src="${weaponImage(key).shaded}" alt="" />` : ''}
          <div class="weapon-info-name">${w.name}</div>
          <div class="weapon-info-tag">${WEAPON_TAGS[key] || 'FIREARM'} · ${w.mag} RND · ${(w.reloadMs / 1000).toFixed(1)}s RELOAD</div>
          <div class="weapon-info-desc">${stats.desc}</div>
        </div>
        <div class="weapon-info-stats">
          ${bar('Damage', stats.damage)}${bar('Fire Rate', stats.firerate)}${bar('Accuracy', stats.precision)}
          <div class="weapon-info-stat-row"><span>Auto-Fire</span><strong>${stats.auto ? 'YES' : 'NO'}</strong></div>
        </div>
      </div>`;
  }).join('');
  for (const item of weaponsManifestoGrid.querySelectorAll('.weapon-info-item')) {
    item.addEventListener('click', () => {
      switchWeapon(Number(item.dataset.index));
      toggleWeapons();
    });
  }
}

// Lobby tab switching
const navButtons = document.querySelectorAll('.nav-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    navButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tabPanels.forEach((panel) => panel.classList.remove('active'));
    $(btn.dataset.tab)?.classList.add('active');
  });
});

// --- Three.js state --------------------------------------------------
let renderer = null;
let camera = null;
let scene = null;
let world = null;
let localPlayer = null;
let network = null;
let myId = null;
let myWeaponView = null;
let remotePlayers = {}; // id -> { data, model, buffer, ... }
let zombieEntities = {}; // id -> { data, model }
let currentMapMode = 'pvp';
let running = false;
let friendlyFireEnabled = true;
let staticMeshes = [];
let lightPool = null;
let postFx = null;
let grenades = null;
let quality = getQualityPreset(settings.quality);
let sunOffset = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

// --- VFX ----------------------------------------------------------------
let cameraShake = 0;
let muzzleFlashLight = null;
let activeParticles = [];
let activeDecals = [];
let activeSprites = [];
const tracers = [];
const MAX_DECALS = 60;

const vfx = {};
function initSharedVFX() {
  if (vfx.spark) return;
  vfx.spark = new THREE.BoxGeometry(0.035, 0.035, 0.035);
  vfx.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb040, toneMapped: false });
  vfx.bloodMat = new THREE.MeshBasicMaterial({ color: 0x7a0000 });
  vfx.dustMat = new THREE.MeshBasicMaterial({ color: 0x6b5a45 });
  vfx.debrisMat = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 1 });
  vfx.jetMat = new THREE.MeshBasicMaterial({ color: 0x00d0ff, toneMapped: false });
  vfx.decal = new THREE.PlaneGeometry(0.07, 0.07);
  vfx.decalMat = new THREE.MeshBasicMaterial({ color: 0x0d0d0d, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  vfx.scorch = new THREE.CircleGeometry(1, 20);
  vfx.tracer = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true);
  vfx.tracer.rotateX(Math.PI / 2);
  vfx.tracer.translate(0, 0, 0.5);

  // Soft round sprite texture for smoke and fire.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  vfx.soft = new THREE.CanvasTexture(c);
}

function spawnParticles(point, normal, kind = 'spark', count = 8) {
  initSharedVFX();
  const mat = kind === 'blood' ? vfx.bloodMat : kind === 'dust' ? vfx.dustMat : kind === 'debris' ? vfx.debrisMat : vfx.sparkMat;
  const right = Math.abs(normal.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  const side = new THREE.Vector3().crossVectors(normal, up).normalize();
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(vfx.spark, mat);
    mesh.position.copy(point);
    if (kind === 'debris') mesh.scale.setScalar(2 + Math.random() * 3);
    scene.add(mesh);
    const speed = kind === 'debris' ? 6 + Math.random() * 8 : kind === 'blood' ? 1 + Math.random() * 2 : 1 + Math.random() * 4;
    const velocity = normal.clone().multiplyScalar(speed);
    const spread = kind === 'debris' ? 6 : kind === 'blood' ? 1.5 : 2.6;
    velocity.addScaledVector(up, (Math.random() - 0.5) * spread);
    velocity.addScaledVector(side, (Math.random() - 0.5) * spread);
    activeParticles.push({
      mesh,
      velocity,
      life: 0,
      maxLife: kind === 'debris' ? 1 + Math.random() : 0.2 + Math.random() * 0.3,
      gravity: kind === 'spark' ? 16 : 12,
      shrink: kind !== 'debris',
    });
  }
}

function spawnJetpackParticles(point) {
  initSharedVFX();
  const mesh = new THREE.Mesh(vfx.spark, vfx.jetMat);
  mesh.position.copy(point);
  scene.add(mesh);
  activeParticles.push({
    mesh,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, -Math.random() * 4.5 - 2.5, (Math.random() - 0.5) * 1.5),
    life: 0,
    maxLife: Math.random() * 0.15 + 0.1,
    gravity: 4,
    shrink: true,
  });
}

function addDecal(mesh) {
  scene.add(mesh);
  activeDecals.push(mesh);
  if (activeDecals.length > MAX_DECALS) {
    const oldest = activeDecals.shift();
    scene.remove(oldest);
    if (oldest.userData.ownMaterial) oldest.material.dispose();
  }
}

const _dummy = new THREE.Object3D();
function spawnBulletDecal(point, normal) {
  initSharedVFX();
  const mesh = new THREE.Mesh(vfx.decal, vfx.decalMat);
  mesh.position.copy(point).addScaledVector(normal, 0.004);
  _dummy.position.copy(mesh.position);
  _dummy.lookAt(mesh.position.clone().add(normal));
  mesh.quaternion.copy(_dummy.quaternion);
  mesh.rotateZ(Math.random() * Math.PI);
  addDecal(mesh);
}

function spawnScorch(point) {
  initSharedVFX();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0b0a09, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const mesh = new THREE.Mesh(vfx.scorch, mat);
  mesh.userData.ownMaterial = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(point.x, Math.max(0.02, point.y - 0.05), point.z);
  mesh.scale.setScalar(1.6 + Math.random() * 0.6);
  addDecal(mesh);
}

function spawnSprite(pos, { color, additive = false, vel = new THREE.Vector3(), size = 1, grow = 1, life = 1, opacity = 1, drag = 0.6, rise = 0 }) {
  initSharedVFX();
  const mat = new THREE.SpriteMaterial({
    map: vfx.soft,
    color,
    transparent: true,
    depthWrite: false,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: !additive,
  });
  mat.rotation = Math.random() * Math.PI * 2;
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(pos);
  sprite.scale.setScalar(size);
  scene.add(sprite);
  activeSprites.push({ sprite, vel: vel.clone(), size, grow, life: 0, maxLife: life, opacity, drag, rise });
}

function updateSprites(dt) {
  for (let i = activeSprites.length - 1; i >= 0; i--) {
    const s = activeSprites[i];
    s.life += dt;
    if (s.life >= s.maxLife) {
      scene.remove(s.sprite);
      s.sprite.material.dispose();
      activeSprites.splice(i, 1);
      continue;
    }
    const t = s.life / s.maxLife;
    s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
    s.vel.y += s.rise * dt;
    s.sprite.position.addScaledVector(s.vel, dt);
    s.sprite.scale.setScalar(s.size * (1 + s.grow * Math.sqrt(t)));
    s.sprite.material.opacity = s.opacity * (1 - t) * Math.min(1, s.life * 20);
  }
}

function updateParticles(dt) {
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      activeParticles.splice(i, 1);
      continue;
    }
    p.velocity.y -= p.gravity * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    if (p.mesh.position.y < 0.02) {
      p.mesh.position.y = 0.02;
      p.velocity.multiplyScalar(0.3);
    }
    if (p.shrink) p.mesh.scale.setScalar(Math.max(0.01, 1 - p.life / p.maxLife));
  }
}

function spawnTracer(p1, p2, color = 0xffc070) {
  if (!scene) return;
  initSharedVFX();
  const dist = p1.distanceTo(p2);
  if (dist < 0.5) return;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(vfx.tracer, mat);
  mesh.position.copy(p1);
  mesh.lookAt(p2);
  // A short streak travelling along the path, like a real tracer round.
  const streak = Math.min(dist, 6);
  mesh.scale.set(1, 1, streak);
  scene.add(mesh);
  tracers.push({ mesh, from: p1.clone(), dir: p2.clone().sub(p1).normalize(), dist, streak, travelled: 0, speed: 420 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.travelled += t.speed * dt;
    if (t.travelled - t.streak >= t.dist) {
      scene.remove(t.mesh);
      t.mesh.material.dispose();
      tracers.splice(i, 1);
      continue;
    }
    const head = Math.min(t.dist, t.travelled);
    const tail = Math.max(0, t.travelled - t.streak);
    t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
    t.mesh.scale.z = Math.max(0.01, head - tail);
  }
}

function addShake(amount) {
  cameraShake = Math.min(1.5, cameraShake + amount);
}

// --- Explosions (rockets + grenades) ---------------------------------------
function spawnExplosionVfx(point, kind = 'rocket') {
  const p = point.clone();
  p.y = Math.max(p.y, 0.15);
  const big = kind === 'grenade' ? 1 : kind === 'airstrike' ? 1.6 : 1.15;
  for (let i = 0; i < 6; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(5 * big);
    spawnSprite(p, { color: i < 2 ? 0xfff0c0 : 0xff8a2a, additive: true, vel: v, size: 1.6 * big, grow: 2.2, life: 0.35 + Math.random() * 0.2, drag: 4 });
  }
  for (let i = 0; i < 10; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, 0.3 + Math.random() * 0.7, Math.random() - 0.5).multiplyScalar(4 * big);
    const shade = 0x58 + Math.floor(Math.random() * 0x22);
    spawnSprite(p, { color: (shade << 16) | (shade << 8) | (shade - 6), vel: v, size: 1.4 * big, grow: 3, life: 2.2 + Math.random() * 1.6, opacity: 0.75, drag: 1.4, rise: 0.8 });
  }
  spawnParticles(p, new THREE.Vector3(0, 1, 0), 'debris', 14);
  spawnParticles(p, new THREE.Vector3(0, 1, 0), 'spark', 14);
  if (point.y < 0.6) spawnScorch(point);
  lightPool?.flash(p.clone().setY(p.y + 1), 0xff9a40, 30, 26, 0.45);
  sfx.playExplosion(p);
  if (camera) {
    const d = camera.position.distanceTo(p);
    addShake(Math.max(0, 1.3 - d / 22));
  }
}

function isOccluded(from, to) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  if (dist < 0.3) return false;
  raycaster.set(from, dir.normalize());
  raycaster.near = 0;
  raycaster.far = dist - 0.25;
  raycaster.firstHitOnly = true;
  const hit = raycaster.intersectObjects(staticMeshes, false).length > 0;
  raycaster.firstHitOnly = false;
  return hit;
}

function chestOf(data, crouching) {
  return new THREE.Vector3(data.x, (data.y || 0) + (crouching ? 0.75 : 1.15), data.z);
}

// Local explosive: visuals + damage resolution (this client is
// authoritative for its own rockets and grenades).
function detonateExplosive(point, kind, gid) {
  spawnExplosionVfx(point, kind);
  const radius = kind === 'grenade' ? GRENADE_BLAST_RADIUS : kind === 'airstrike' ? 10 : ROCKET_EXPLOSION_RADIUS;
  const maxDamage = kind === 'grenade' ? GRENADE_DAMAGE : kind === 'airstrike' ? 180 : WEAPONS.rocket.damage;
  const origin = point.clone();
  origin.y += 0.3;

  let hitSomeone = false;
  for (const t of shootableEntities()) {
    const chest = chestOf(t.data, t.crouching);
    const f = blastFalloff(origin.distanceTo(chest), radius) * (isOccluded(origin, chest) ? 0.15 : 1);
    const damage = Math.round(maxDamage * f);
    if (damage < 1) continue;
    hitSomeone = true;
    if (t.isZombie) network.sendZombieHit(t.data.id, damage);
    else network.sendHit(t.data.id, damage, kind, 'body');
  }
  if (hitSomeone) flashHitmarker('body');

  if (!dead) {
    const me = chestOf(localPlayer, localPlayer.crouching);
    const f = blastFalloff(origin.distanceTo(me), radius) * (isOccluded(origin, me) ? 0.15 : 1);
    const damage = Math.round(maxDamage * f * 0.8);
    if (damage >= 1) network.sendSelfHit(damage, kind);
  }
  network.sendExplosion(point.x, point.y, point.z, kind, gid);
}

// --- Rockets --------------------------------------------------------------
let activeRockets = [];

function buildRocketMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.06, 0.32, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a5034, roughness: 0.6, metalness: 0.3 })
  );
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.3, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.9, toneMapped: false })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 0.34;
  group.add(flame);
  return group;
}

function spawnRocket(origin, dir, isLocal) {
  const mesh = buildRocketMesh();
  mesh.position.copy(origin);
  mesh.lookAt(origin.clone().add(dir));
  scene.add(mesh);
  activeRockets.push({ mesh, pos: origin.clone(), dir: dir.clone().normalize(), traveled: 0, isLocal, smokeT: 0 });
}

function findStaticImpact(from, to) {
  for (const c of queryCollidables(world, to.x, to.z)) {
    const dx = to.x - c.x;
    const dz = to.z - c.z;
    const minDist = c.radius + ROCKET_COLLISION_RADIUS;
    if (dx * dx + dz * dz > minDist * minDist) continue;
    if (to.y >= (c.minY ?? -Infinity) && to.y <= (c.maxY ?? Infinity)) return to.clone();
  }
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len > 0) {
    raycaster.set(from, dir.normalize());
    raycaster.near = 0;
    raycaster.far = len;
    raycaster.firstHitOnly = true;
    const hits = raycaster.intersectObjects(staticMeshes, false);
    raycaster.firstHitOnly = false;
    if (hits.length) return hits[0].point.clone();
  }
  if (to.y <= 0) return new THREE.Vector3(to.x, 0, to.z);
  return null;
}

function updateRockets(dt) {
  for (let i = activeRockets.length - 1; i >= 0; i--) {
    const r = activeRockets[i];
    const stepDist = ROCKET_SPEED * dt;
    const to = r.pos.clone().addScaledVector(r.dir, stepDist);
    let impact = null;
    if (r.isLocal) {
      const hitboxes = shootableEntities().flatMap((t) => t.hitboxes);
      raycaster.set(r.pos, r.dir);
      raycaster.near = 0;
      raycaster.far = stepDist;
      const hits = raycaster.intersectObjects(hitboxes, false);
      if (hits.length) impact = hits[0].point.clone();
    }
    if (!impact) impact = findStaticImpact(r.pos, to);
    r.traveled += stepDist;
    r.smokeT -= dt;
    if (r.smokeT <= 0) {
      r.smokeT = 0.03;
      spawnSprite(r.pos, { color: 0x8a8580, size: 0.35, grow: 4, life: 1.2, opacity: 0.5, drag: 1, rise: 0.4 });
    }

    if (impact || r.traveled >= ROCKET_MAX_RANGE) {
      // Remote rockets are cosmetic: the shooter's 'explosion' message
      // places the real blast.
      if (impact && r.isLocal) detonateExplosive(impact, 'rocket');
      scene.remove(r.mesh);
      activeRockets.splice(i, 1);
      continue;
    }
    r.pos.copy(to);
    r.mesh.position.copy(to);
  }
}

// --- Weapons: ammo, reload, firing, recoil ----------------------------------
const ammoState = {};
function ammoFor(key) {
  if (!ammoState[key]) ammoState[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
  return ammoState[key];
}
function resetAmmo() {
  for (const key of Object.keys(ammoState)) delete ammoState[key];
}

let lastShotTime = -Infinity;
let raiseUntil = 0; // weapon switch: can't fire until raised
let reload = null; // { key, start, end }
let recoilT = 0;
let recoilDebt = 0;
let recoilRecovering = false;
let viewPunch = 0;
let spreadBloom = 0;
let adsProgress = 0;
let sprintT = 0;
let bobPhase = 0;
let bobAmp = 0;
let cameraDip = 0;
let strafeRoll = 0;
let autoReloadAt = 0;

function currentKey() {
  return WEAPON_ORDER[weaponIndex];
}

function currentSpread(w) {
  const speedFrac = Math.min(1, localPlayer.speed / MOVE_SPEED);
  const ads = adsProgress > 0.6;
  let s = w.spread * (ads ? w.adsSpread : 1);
  s *= 1 + speedFrac * (ads ? 0.6 : 1.3);
  if (ads) s += speedFrac * (currentKey() === 'awp' ? 0.03 : 0.004);
  if (!localPlayer.onGround && !localPlayer.flying) s = s * 2.5 + 0.02;
  if (localPlayer.crouching && localPlayer.onGround) s *= 0.7;
  s += spreadBloom * (ads ? 0.4 : 1);
  return s;
}

function coneDirection(forward, spread) {
  if (spread <= 0) return forward.clone();
  const r = Math.tan(spread) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return forward.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
}

function startReload() {
  if (!canAct() || reload) return;
  const key = currentKey();
  const w = WEAPONS[key];
  const ammo = ammoFor(key);
  if (ammo.mag >= w.mag) return;
  if (ammo.reserve <= 0) {
    showBanner('NO RESERVE AMMO — SWITCH WEAPONS', 1500);
    return;
  }
  const now = performance.now();
  reload = { key, start: now, end: now + w.reloadMs };
  sfx.playReload(w.reloadMs);
  reloadIndicatorEl?.classList.remove('hidden');
}

function updateReload(now) {
  if (!reload) return;
  if (reload.key !== currentKey() || dead) {
    reload = null;
    reloadIndicatorEl?.classList.add('hidden');
    return;
  }
  const t = (now - reload.start) / (reload.end - reload.start);
  setStyle(reloadBarEl, 'width', `${Math.min(100, Math.round(t * 100))}%`);
  if (now >= reload.end) {
    const w = WEAPONS[reload.key];
    const ammo = ammoFor(reload.key);
    const take = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    reload = null;
    reloadIndicatorEl?.classList.add('hidden');
  }
}

function tryFire(fromClick) {
  if (!canAct() || !camera) return;
  const key = currentKey();
  const w = WEAPONS[key];
  const now = performance.now();
  if (!w.auto && !fromClick) return;
  if (now < raiseUntil || reload || cooking || sprintT > 0.35) return;
  if (now - lastShotTime < w.fireCooldownMs) return;
  const ammo = ammoFor(key);
  if (ammo.mag <= 0) {
    if (fromClick) sfx.playDryFire();
    startReload();
    return;
  }
  lastShotTime = now;
  ammo.mag -= 1;
  if (ammo.mag === 0) autoReloadAt = now + 250;
  fireWeapon(key, w, now);
}

function applyRecoil(w) {
  const [v, h] = w.recoil;
  let m = 1;
  if (adsProgress > 0.5) m *= 0.75;
  if (localPlayer.crouching) m *= 0.8;
  const kick = v * m * (0.85 + Math.random() * 0.3);
  localPlayer.pitch = Math.min(MAX_PITCH, localPlayer.pitch + kick);
  localPlayer.angle += (Math.random() - 0.45) * 2 * h * m;
  recoilDebt += kick;
  recoilRecovering = false;
  viewPunch += kick * 0.8;
  recoilT = 1;
  spreadBloom = Math.min(w.spread * 1.5, spreadBloom + w.spread * (w.auto ? 0.3 : 0.5));
}

function muzzleWorldPosition() {
  const m = myWeaponView?.userData.muzzle;
  if (m && viewmodel) {
    // Project the muzzle through the weapon camera, then back out through
    // the world camera, so tracers start exactly where the barrel is drawn.
    const ndc = m.getWorldPosition(new THREE.Vector3()).project(viewmodel.camera);
    const p = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    return origin.add(p.sub(origin).normalize().multiplyScalar(0.7));
  }
  const p = camera.getWorldPosition(new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const ads = adsProgress;
  return p.addScaledVector(right, 0.2 * (1 - ads)).addScaledVector(down, 0.14 * (1 - ads) + 0.05 * ads).addScaledVector(fwd, 0.6);
}

const v3 = (p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100];

function fireWeapon(key, w, now) {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const muzzle = muzzleWorldPosition();
  sfx.playGunshot(key);
  if (muzzleFlashLight && key !== 'm4a1' && key !== 'mp5') muzzleFlashLight.intensity = 5;
  addShake(key === 'awp' || key === 'rocket' ? 0.45 : key === 'shotgun' ? 0.35 : 0.08);
  const spread = currentSpread(w);
  applyRecoil(w);
  viewmodel.muzzleFlash(key);
  kickViewmodel(w, key);
  weaponFired(myWeaponView);
  const ejectDelay = key === 'shotgun' ? 380 : key === 'awp' ? 650 : 0;
  const vel = new THREE.Vector3(localPlayer.vx, 0, localPlayer.vz);
  if (ejectDelay) setTimeout(() => scene && viewmodel.ejectShell(scene, camera, key, vel), ejectDelay);
  else viewmodel.ejectShell(scene, camera, key, vel);
  if (key !== 'm4a1' && key !== 'mp5') {
    spawnSprite(muzzle, { color: 0x9a958e, size: 0.08, grow: 5, life: 0.9, opacity: 0.22, drag: 2, rise: 0.5, vel: forward.clone().multiplyScalar(1.5) });
  }

  if (key === 'rocket') {
    spawnRocket(origin.clone().addScaledVector(forward, 0.6), forward, true);
    network.sendShoot(v3(muzzle), []);
    network.sendRocket(origin.x, origin.y, origin.z, forward.x, forward.y, forward.z);
    recordShot(myId, key, v3(muzzle), [], now);
    return;
  }

  const damageByTarget = new Map();
  const targets = shootableEntities();
  const hitboxes = targets.flatMap((t) => t.hitboxes);
  const ends = [];

  for (let i = 0; i < w.pellets; i++) {
    const dir = coneDirection(forward, spread);
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = 500;
    const targetHits = raycaster.intersectObjects(hitboxes, false);
    raycaster.firstHitOnly = true;
    const envHits = raycaster.intersectObjects(staticMeshes, false);
    raycaster.firstHitOnly = false;
    const targetHit = targetHits[0];
    const envHit = envHits[0];
    let endpoint = origin.clone().addScaledVector(dir, 400);

    if (targetHit && (!envHit || targetHit.distance < envHit.distance)) {
      const ud = targetHit.object.userData;
      const isZombie = ud.zombieId !== undefined;
      const id = isZombie ? ud.zombieId : ud.playerId;
      const zone = ud.zone || 'body';
      const zoneMult = zone === 'head' ? HEADSHOT_MULTIPLIER : zone === 'legs' ? LIMB_MULTIPLIER : 1;
      // Damage falls off past the weapon's effective range (to 55%).
      const falloff = THREE.MathUtils.clamp(1 - (targetHit.distance - w.range * 0.5) / w.range, 0.55, 1);
      const k = `${isZombie ? 'z' : 'p'}:${id}`;
      const entry = damageByTarget.get(k) || { isZombie, id, damage: 0, zone: 'legs' };
      entry.damage += w.damage * zoneMult * falloff;
      if (zone === 'head' || (zone === 'body' && entry.zone === 'legs')) entry.zone = zone;
      damageByTarget.set(k, entry);
      endpoint = targetHit.point.clone();
      spawnParticles(endpoint, dir.clone().negate(), 'blood', zone === 'head' ? 14 : 8);
    } else if (envHit) {
      endpoint = envHit.point.clone();
      const normal = envHit.face ? envHit.face.normal.clone().transformDirection(envHit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      const isGround = envHit.object.name === 'ground' || normal.y > 0.8;
      spawnParticles(endpoint, normal, isGround ? 'dust' : 'spark', isGround ? 6 : 7);
      if (isGround) spawnSprite(endpoint, { color: 0x8a7a62, size: 0.25, grow: 3, life: 0.8, opacity: 0.6, drag: 3, rise: 0.3, vel: normal.clone().multiplyScalar(1.2) });
      spawnBulletDecal(endpoint, normal);
    }
    if (i < 6) spawnTracer(muzzle, endpoint, key === 'awp' ? 0xfff2c0 : 0xffc070);
    ends.push(v3(endpoint));
  }

  network.sendShoot(v3(muzzle), ends);
  recordShot(myId, key, v3(muzzle), ends, now);

  let best = null;
  for (const entry of damageByTarget.values()) {
    const damage = Math.round(entry.damage);
    if (entry.isZombie) network.sendZombieHit(entry.id, damage);
    else network.sendHit(entry.id, damage, key, entry.zone);
    if (!best || entry.zone === 'head') best = entry.zone;
  }
  if (best) flashHitmarker(best === 'head' ? 'head' : 'body');
}

// Everything the local player can currently damage, with its hitboxes.
function shootableEntities() {
  const list = [];
  if (currentMapMode === 'zombies') {
    for (const z of Object.values(zombieEntities)) {
      if (z.data.health > 0 && !z.dead) list.push({ isZombie: true, data: z.data, hitboxes: z.model.hitboxes || [z.model.hitbox], crouching: false });
    }
  }
  for (const rp of Object.values(remotePlayers)) {
    if (rp.data.health <= 0 || rp.model.dying) continue;
    if (!friendlyFireEnabled && rp.data.team === localPlayer.team) continue;
    list.push({ isZombie: false, data: rp.render || rp.data, hitboxes: rp.model.hitboxes, crouching: rp.crouching, id: rp.data.id });
  }
  return list;
}

// Async because real .glb weapons load on first equip (cached after).
async function switchWeapon(index) {
  if (index < 0 || index >= WEAPON_ORDER.length || !camera || !localPlayer || dead) return;
  if (index === weaponIndex && myWeaponView) return;
  const key = WEAPON_ORDER[index];
  weaponIndex = index;
  reload = null;
  reloadIndicatorEl?.classList.add('hidden');
  raiseUntil = performance.now() + 450;
  raiseT = 1;
  sfx.playSwitch();
  const requestedIndex = index;
  const newView = await createWeaponView(key);
  if (weaponIndex !== requestedIndex || !camera) return;
  myWeaponView = newView;
  viewmodel.setWeapon(myWeaponView);
}
let raiseT = 0;

// --- Grenades -------------------------------------------------------------
let grenadesLeft = GRENADES_PER_LIFE;
let cooking = null; // { start }
let heldGrenade = null;
let grenadeLowerT = 0;
let grenadeSeq = 0;

function startCook() {
  if (!canAct() || cooking || grenadesLeft <= 0) {
    if (grenadesLeft <= 0 && canAct()) showBanner('NO GRENADES LEFT', 1000);
    return;
  }
  reload = null;
  reloadIndicatorEl?.classList.add('hidden');
  cooking = { start: performance.now() };
  sfx.playPinPull();
  if (!heldGrenade) heldGrenade = createHeldGrenade();
  heldGrenade.position.set(0.22, -0.2, -0.42);
  viewmodel.camera.add(heldGrenade);
}

function releaseGrenade() {
  if (!cooking) return;
  throwGrenade(Math.max(0, GRENADE_FUSE_MS - (performance.now() - cooking.start)), 1);
}

function throwGrenade(fuseMs, strength) {
  cooking = null;
  heldGrenade?.removeFromParent();
  grenadesLeft -= 1;
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const pos = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, 0.45).addScaledVector(right, 0.18);
  pos.y -= 0.12;
  const dir = forward.clone();
  dir.y += 0.2;
  dir.normalize();
  const vel = dir.multiplyScalar(GRENADE_THROW_SPEED * strength).add(new THREE.Vector3(localPlayer.vx, Math.max(0, localPlayer.vy), localPlayer.vz));
  const gid = `${myId}-${++grenadeSeq}-${Math.floor(Math.random() * 1e5)}`;
  grenades.spawn({ id: gid, ownerId: myId, pos, vel, fuseMs, isLocal: true });
  network.sendGrenade(gid, pos, vel, fuseMs);
  grenadeLowerT = 1;
}

function updateGrenades(dt, now) {
  if (cooking && now - cooking.start >= GRENADE_FUSE_MS) throwGrenade(0, 0.1); // cooked too long
  if (heldGrenade && cooking) {
    // Pin pulled: the grenade bobs in hand, tension rising as the fuse burns.
    const t = (now - cooking.start) / GRENADE_FUSE_MS;
    heldGrenade.position.set(0.22 + Math.sin(now / 90) * 0.003 * t, -0.2, -0.42);
  }
  for (const g of grenades.update(dt)) {
    if (g.isLocal) detonateExplosive(g.pos, 'grenade', g.id);
    else spawnExplosionVfx(g.pos, 'grenade');
  }
  let danger = false;
  if (!dead) {
    for (const g of grenades.active) {
      if (g.pos.distanceTo(new THREE.Vector3(localPlayer.x, localPlayer.y + 0.5, localPlayer.z)) < GRENADE_BLAST_RADIUS + 1.5) danger = true;
    }
  }
  grenadeWarningEl?.classList.toggle('hidden', !danger);
}

// --- Remote players -----------------------------------------------------
function isAlly(data) {
  return !friendlyFireEnabled && localPlayer && data.team === localPlayer.team;
}

function addRemotePlayer(p) {
  if (remotePlayers[p.id]) return;
  const skin = SKINS.find((s) => s.id === p.skin) || SKINS[0];
  const accent = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
  const ally = isAlly(p);
  const model = createPlayerModel(skin, p.name, {
    accentColor: accent.color,
    headgear: p.headgear || 'none',
    weapon: p.weapon || 'ak47',
    nameColor: ally ? '#7fc8ff' : '#ff8a7a',
  });
  model.setNameStyle(ally ? '#7fc8ff' : '#ff8a7a', ally);
  model.setOwner('playerId', p.id);
  model.setPosition(p.x, p.y || 0, p.z, p.angle || 0);
  if (p.health <= 0) model.setVisible(false);
  scene.add(model.group);
  const now = performance.now();
  remotePlayers[p.id] = {
    data: { ...p, y: p.y || 0 },
    model,
    weapon: p.weapon || 'ak47',
    buffer: [{ t: now, x: p.x, y: p.y || 0, z: p.z, a: p.angle || 0, p: p.pitch || 0 }],
    render: { id: p.id, x: p.x, y: p.y || 0, z: p.z },
    crouching: false,
    flying: false,
    speed: 0,
    stepDist: 0,
    lastShotAt: -Infinity,
    replay: false,
  };
}

function removeRemotePlayer(id) {
  const rp = remotePlayers[id];
  if (!rp) return;
  scene?.remove(rp.model.group);
  rp.model.dispose();
  delete remotePlayers[id];
}

// Draws each remote player INTERPOLATION_DELAY_MS in the past, blending
// between the two network snapshots around that time — smooth motion
// instead of 30 hard teleports per second.
function interpolateRemote(rp, renderT) {
  const b = rp.buffer;
  if (!b.length) return;
  let s;
  if (renderT >= b[b.length - 1].t) {
    s = b[b.length - 1];
  } else if (renderT <= b[0].t) {
    s = b[0];
  } else {
    let k = b.length - 2;
    while (k > 0 && b[k].t > renderT) k--;
    const a = b[k];
    const c = b[k + 1];
    const t = (renderT - a.t) / Math.max(1, c.t - a.t);
    s = {
      x: a.x + (c.x - a.x) * t,
      y: a.y + (c.y - a.y) * t,
      z: a.z + (c.z - a.z) * t,
      a: lerpAngle(a.a, c.a, t),
      p: a.p + (c.p - a.p) * t,
    };
  }
  const prev = rp.render;
  const moved = Math.hypot(s.x - prev.x, s.z - prev.z);
  rp.stepDist += moved;
  rp.render = { id: rp.data.id, x: s.x, y: s.y, z: s.z };
  rp.model.setPosition(s.x, s.y, s.z, s.a);
  rp.model.setPitch(s.p);
}

function pushSnapshot(rp, msg) {
  const now = performance.now();
  rp.buffer.push({ t: now, x: msg.x, y: msg.y || 0, z: msg.z, a: msg.angle, p: msg.pitch || 0 });
  while (rp.buffer.length > 2 && now - rp.buffer[1].t > 1000) rp.buffer.shift();
}

// --- Zombies (survival mode) ----------------------------------------------
// The server simulates the horde (server/ai.js); here each zombie is a
// realistic infected human that smoothly follows the server's positions,
// groans as it closes in, lunges when the server says it attacks, and leaves
// its body behind for a few seconds when it dies.
function addZombie(z) {
  if (zombieEntities[z.id]) return zombieEntities[z.id];
  const model = createZombieModel({ id: z.id, kind: z.kind || 'walker', seed: z.seed || 0 });
  model.setOwner?.('zombieId', z.id);
  const angle = z.a ?? z.angle ?? 0;
  model.setPosition(z.x, 0, z.z, angle);
  scene.add(model.group);
  const e = {
    data: { id: z.id, x: z.x, z: z.z, angle, health: z.health ?? 100, maxHealth: z.maxHealth ?? 100, kind: z.kind || 'walker' },
    target: { x: z.x, z: z.z, a: angle },
    model,
    speed: 0,
    attacking: false,
    dead: false,
    nextGroan: performance.now() + 800 + Math.random() * 4000,
    scared: false,
  };
  zombieEntities[z.id] = e;
  return e;
}

function removeZombie(id) {
  const z = zombieEntities[id];
  if (!z) return;
  scene?.remove(z.model.group);
  z.model.dispose();
  delete zombieEntities[id];
}

function killZombie(id) {
  const z = zombieEntities[id];
  if (!z || z.dead) return;
  z.data.health = 0;
  z.dead = true;
  z.speed = 0;
  z.attacking = false;
  z.model.die?.();
  sfx.playZombieDeath?.(zombiePos(z));
  setTimeout(() => {
    if (zombieEntities[id] === z) removeZombie(id);
  }, 6000);
}

function zombiePos(z) {
  return { x: z.data.x, y: 1.5, z: z.data.z };
}

let lastStingerAt = 0;

// Per frame: glide toward the server position, animate, and make noise.
function updateZombies(dt, now) {
  const k = Math.min(1, dt * 10);
  let nearest = Infinity;
  for (const z of Object.values(zombieEntities)) {
    if (!z.dead) {
      z.data.x += (z.target.x - z.data.x) * k;
      z.data.z += (z.target.z - z.data.z) * k;
      z.data.angle += Math.atan2(Math.sin(z.target.a - z.data.angle), Math.cos(z.target.a - z.data.angle)) * Math.min(1, dt * 8);
      z.model.setPosition(z.data.x, 0, z.data.z, z.data.angle);
      const d = Math.hypot(z.data.x - localPlayer.x, z.data.z - localPlayer.z);
      nearest = Math.min(nearest, d);
      if (d < 45 && now > z.nextGroan) {
        sfx.playZombieGroan?.(zombiePos(z), z.data.kind, d < 8 ? 1.2 : 1);
        z.nextGroan = now + (z.data.kind === 'runner' ? 2200 + Math.random() * 3500 : 3500 + Math.random() * 6500);
      }
      // A sprinter bursting out of the dark right at you gets a stinger.
      if (!z.scared && z.data.kind === 'runner' && d < 9 && !dead) {
        z.scared = true;
        if (now - lastStingerAt > 25000) {
          sfx.playStinger?.();
          lastStingerAt = now;
          addShake(0.08);
        }
      }
    }
    z.model.animate(dt, z.speed, z.attacking);
  }
  return nearest;
}

function updateZombiesHud() {
  if (currentMapMode !== 'zombies') return;
  zombiesRemainingValueEl.textContent = `Zombies: ${Object.values(zombieEntities).filter((z) => !z.dead).length}`;
  zombieKillsValueEl.textContent = `Your kills: ${localPlayer.zombieKills}`;
}

// --- HUD ----------------------------------------------------------------
const ICON_PATHS = {
  pistol: 'M3 12h36l3-4h20v7H44l-2 4H32v2h-7v11l-9 2-4-9v-6H3V12z',
  shotgun: 'M1 15h44v5H30v3h-6v8h-7l-2-8v-3H1zm44-2h18v8H45z',
  chaingun: 'M2 12h20v12H2zm20-3h8v18h-8zm8 4h26v10H30zm26-2h8v14h-8z',
  rocket: 'M4 14h16v8H4zm16-4h24l12 8-12 8H20z',
  ak47: 'M2 14h10l3 4h20l6-6h20v5H44l-4 5H28v7h-7l-3-7H12z',
  m4a1: 'M6 15h32l4-5h18v5H44v4H34v8h-8l-3-8H6z',
  mp5: 'M4 16h30l4-5h20v6H40v3H30v8h-8l-2-8H4z',
  awp: 'M1 16h48v4H28v2h-5v8h-6l-2-8v-2H1zm48-6h14v12H49z',
  grenade: 'M30 6h8v4h-8zM26 10h16l4 6v12l-6 6H28l-6-6V16zM40 4l10 4-2 3-9-3z',
  zombie: 'M22 6h24l6 10v10l-6 6H22l-6-6V16zm4 10v4h5v-4zm11 0v4h5v-4zM27 28h14v-3H27z',
  airstrike: 'M4 17l14-3 6-9h4l-3 9h16l6-5h4l-3 8 3 8h-4l-6-5H25l3 9h-4l-6-9-14-3z',
};
function weaponIcon(key) {
  const img = WEAPONS[key] ? weaponImage(key) : null;
  if (img) return `<img src="${img.silhouette}" alt="" />`;
  const d = ICON_PATHS[key] || ICON_PATHS.zombie;
  return `<svg viewBox="0 0 68 36" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

let shownWeaponKey = null;
let scoreboardHtml = '';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function updateWeaponHud() {
  const key = currentKey();
  if (shownWeaponKey !== key) {
    shownWeaponKey = key;
    weaponIconEl.innerHTML = weaponIcon(key);
  }
  setText(weaponNameEl, WEAPONS[key].name.toUpperCase());
  const ammo = ammoFor(key);
  setText(ammoMagEl, ammo.mag);
  setText(ammoReserveEl, ammo.reserve);
  ammoMagEl.classList.toggle('low', ammo.mag <= Math.ceil(WEAPONS[key].mag * 0.25));
  setText(grenadeCountEl, grenadesLeft);
}

const COMPASS_PX = 3.2;
const COMPASS_MAJORS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const compassTicks = [];

function buildCompass() {
  if (!compassStrip || compassStrip.childElementCount) return;
  for (let deg = -360; deg <= 720; deg += 15) {
    const norm = ((deg % 360) + 360) % 360;
    const major = COMPASS_MAJORS[norm];
    const el = document.createElement('div');
    el.className = 'compass-tick' + (major ? ' major' : '');
    el.style.left = `${deg * COMPASS_PX}px`;
    const label = document.createElement('span');
    label.textContent = major || String(norm);
    el.appendChild(label);
    compassStrip.appendChild(el);
    if (major) compassTicks.push({ deg, el });
  }
}

function updateCompass(angle) {
  let heading = ((-angle * 180) / Math.PI) % 360;
  if (heading < 0) heading += 360;
  setStyle(compassStrip, 'transform', `translateX(${(-heading * COMPASS_PX).toFixed(1)}px)`);
  let best = null;
  let bestDist = Infinity;
  for (const tick of compassTicks) {
    const dist = Math.abs(tick.deg - heading);
    if (dist < bestDist) {
      bestDist = dist;
      best = tick;
    }
  }
  for (const tick of compassTicks) tick.el.classList.toggle('active', tick === best && bestDist < 23);
}

function updateScoreboard() {
  const all = [{ name: localPlayer.name, score: localPlayer.score, deaths: localPlayer.deaths, you: true, ally: true }];
  for (const rp of Object.values(remotePlayers)) {
    all.push({ name: rp.data.name, score: rp.data.score || 0, deaths: rp.data.deaths || 0, you: false, ally: isAlly(rp.data) });
  }
  all.sort((a, b) => b.score - a.score || a.deaths - b.deaths);
  const html = all
    .map(
      (p) =>
        `<li class="${p.you ? 'you' : ''} ${p.ally ? 'ally' : 'enemy'}"><span class="squad-name"><i class="squad-dot"></i>${escapeHtml(p.name)}${p.you ? ' (you)' : ''}</span><span class="squad-score">${p.score}<small> / ${p.deaths}</small></span></li>`
    )
    .join('');
  if (html !== scoreboardHtml) {
    scoreboardHtml = html;
    playersListEl.innerHTML = html;
  }
  setText(squadCountEl, 'K / D');
}

function addKillfeed(msg) {
  if (!killfeedEl) return;
  const nameOf = (id) => {
    if (id === myId) return localPlayer.name;
    if (typeof id === 'string' && id.startsWith('zombie_')) return 'Mutant';
    return remotePlayers[id]?.data.name || 'World';
  };
  const teamClass = (id) => (id === myId || (remotePlayers[id] && isAlly(remotePlayers[id].data)) ? 'kf-team-ally' : 'kf-team-enemy');
  const suicide = msg.killerId === msg.victimId;
  const li = document.createElement('li');
  li.className = 'kf-item' + (msg.killerId === myId || msg.victimId === myId ? ' kf-you' : '');
  li.innerHTML =
    (suicide ? '' : `<span class="kf-killer ${teamClass(msg.killerId)}">${escapeHtml(nameOf(msg.killerId))}</span>`) +
    `<span class="kf-weapon">${weaponIcon(msg.weapon)}</span>` +
    (msg.headshot ? '<span class="kf-headshot">HS</span>' : '') +
    `<span class="kf-victim ${teamClass(msg.victimId)}">${escapeHtml(nameOf(msg.victimId))}</span>`;
  killfeedEl.appendChild(li);
  while (killfeedEl.children.length > 6) killfeedEl.firstChild.remove();
  setTimeout(() => li.classList.add('kf-out'), 6000);
  setTimeout(() => li.remove(), 6400);
}

// --- Radar -----------------------------------------------------------------
// Static layer (structures + obstacles) is rendered once to an offscreen
// canvas; each frame just blits it — previously thousands of obstacle
// dots were redrawn every frame. Enemies only show up on radar when they
// fire an unsuppressed weapon, like a real military shooter.
const RADAR_PX_PER_UNIT = 2;
let radarLayer = null;
let currentRadarRange = 100;

function buildRadarLayer() {
  const size = 240 * RADAR_PX_PER_UNIT;
  radarLayer = document.createElement('canvas');
  radarLayer.width = radarLayer.height = size;
  const ctx = radarLayer.getContext('2d');
  const toPx = (v) => (v + 120) * RADAR_PX_PER_UNIT;
  ctx.fillStyle = 'rgba(160, 175, 190, 0.28)';
  for (const c of world.collidables) {
    const r = Math.max(1, c.radius * RADAR_PX_PER_UNIT);
    ctx.fillRect(toPx(c.x) - r / 2, toPx(c.z) - r / 2, r, r);
  }
  for (const s of world.structures || []) {
    ctx.fillStyle = 'rgba(240, 160, 48, 0.07)';
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.3)';
    ctx.lineWidth = 1;
    const x = toPx(s.x - s.w / 2);
    const y = toPx(s.z - s.d / 2);
    ctx.fillRect(x, y, s.w * RADAR_PX_PER_UNIT, s.d * RADAR_PX_PER_UNIT);
    ctx.strokeRect(x, y, s.w * RADAR_PX_PER_UNIT, s.d * RADAR_PX_PER_UNIT);
  }
}

function renderMinimap(dt) {
  const size = minimap.width;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  currentRadarRange = THREE.MathUtils.lerp(currentRadarRange, adsProgress > 0.5 ? 60 : 100, Math.min(1, 6 * dt));
  const scale = r / currentRadarRange;
  const px = localPlayer.x;
  const pz = localPlayer.z;
  const ctx = minimapCtx;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, size, size);

  if (radarLayer) {
    ctx.save();
    ctx.translate(cx - (px + 120) * scale, cy - (pz + 120) * scale);
    ctx.scale(scale / RADAR_PX_PER_UNIT, scale / RADAR_PX_PER_UNIT);
    ctx.drawImage(radarLayer, 0, 0);
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(240, 160, 48, 0.12)';
  ctx.lineWidth = 1;
  for (const ringR of [r * 0.33, r * 0.66]) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  const now = performance.now();
  const sweep = ((now / 1000) * 1.6) % (Math.PI * 2);
  const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep - 0.7, cx, cy) : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(240,160,48,0)');
    grad.addColorStop(0.11, 'rgba(240,160,48,0.14)');
    grad.addColorStop(0.111, 'rgba(240,160,48,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const drawArrow = (x, z, angle, color, s = 1) => {
    const sx = cx + (x - px) * scale;
    const sy = cy + (z - pz) * scale;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -6 * s);
    ctx.lineTo(4.5 * s, 5 * s);
    ctx.lineTo(0, 2 * s);
    ctx.lineTo(-4.5 * s, 5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  for (const rp of Object.values(remotePlayers)) {
    if (rp.data.health <= 0) continue;
    const pos = rp.render;
    if (isAlly(rp.data)) {
      drawArrow(pos.x, pos.z, rp.data.angle || 0, '#4fb3ff', 0.9);
    } else {
      const since = now - rp.lastShotAt;
      if (since < 2500) {
        ctx.fillStyle = `rgba(231, 76, 60, ${1 - since / 2500})`;
        ctx.beginPath();
        ctx.arc(cx + (pos.x - px) * scale, cy + (pos.z - pz) * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (const z of Object.values(zombieEntities)) {
    if (z.data.health <= 0) continue;
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(cx + (z.data.x - px) * scale - 2, cy + (z.data.z - pz) * scale - 2, 4, 4);
  }
  for (const g of grenades?.active || []) {
    ctx.fillStyle = '#ffcc33';
    ctx.beginPath();
    ctx.arc(cx + (g.pos.x - px) * scale, cy + (g.pos.z - pz) * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // UAV sweeps: enemy positions at the last ping, fading until the next.
  for (const ping of uavPings) {
    const age = (now - ping.t) / UAV_PING_MS;
    if (age > 1.2) continue;
    ctx.fillStyle = `rgba(255, 70, 50, ${Math.max(0.15, 1 - age * 0.8)})`;
    ctx.beginPath();
    ctx.arc(cx + (ping.x - px) * scale, cy + (ping.z - pz) * scale, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // You + view cone
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-localPlayer.angle);
  const fovGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 0.45);
  fovGrad.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  fovGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = fovGrad;
  const fovA = (camera.fov * camera.aspect * Math.PI) / 180 / 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r * 0.45, -Math.PI / 2 - fovA, -Math.PI / 2 + fovA);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(4.5, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-4.5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.font = '700 11px "Rajdhani", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0a030';
  ctx.fillText('N', cx, cy - r + 12);
  ctx.restore();

  ctx.strokeStyle = 'rgba(240, 160, 48, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// --- History recording (for the killcam) --------------------------------
// Every ~33ms we snapshot every player's transform, and every shot fired
// (by anyone) is logged with its origin and impact points. On death the
// killcam replays the last few seconds of the actual match from the
// killer's eyes: every soldier where they really were, every tracer that
// was really fired, and your own body going down.
const HISTORY_MS = 7000;
let history = [];
let shotLog = [];
let lastHistoryAt = 0;

function recordHistory(now) {
  if (now - lastHistoryAt < 33) return;
  lastHistoryAt = now;
  const p = {};
  p[myId] = { x: localPlayer.x, y: localPlayer.y, z: localPlayer.z, a: localPlayer.angle, p: localPlayer.pitch, w: currentKey(), c: localPlayer.crouching };
  for (const [id, rp] of Object.entries(remotePlayers)) {
    if (rp.data.health <= 0) continue;
    p[id] = { x: rp.render.x, y: rp.render.y, z: rp.render.z, a: rp.model.group.rotation.y, p: rp.data.pitch || 0, w: rp.weapon, c: rp.crouching, s: rp.speed };
  }
  for (const [id, z] of Object.entries(zombieEntities)) {
    p[`zombie_${id}`] = { x: z.data.x, y: 0, z: z.data.z, a: z.data.angle || 0, p: 0, w: 'zombie', c: false };
  }
  history.push({ t: now, p });
  while (history.length && now - history[0].t > HISTORY_MS) history.shift();
}

function recordShot(id, weapon, o, ends, t = performance.now()) {
  shotLog.push({ t, id, weapon, o, ends });
  while (shotLog.length && t - shotLog[0].t > HISTORY_MS) shotLog.shift();
}

function sampleHistory(id, ts) {
  const key = String(id);
  if (!history.length) return null;
  let k = history.length - 1;
  if (ts >= history[k].t) return history[k].p[key] || null;
  k = 0;
  while (k < history.length - 2 && history[k + 1].t <= ts) k++;
  const a = history[k].p[key];
  const b = history[k + 1]?.p[key];
  if (!a || !b) return a || b || null;
  const t = THREE.MathUtils.clamp((ts - history[k].t) / Math.max(1, history[k + 1].t - history[k].t), 0, 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    a: lerpAngle(a.a, b.a, t),
    p: a.p + (b.p - a.p) * t,
    w: b.w,
    c: t < 0.5 ? a.c : b.c,
    s: b.s,
  };
}

// --- Death + killcam ----------------------------------------------------
const DEATH_FALL_MS = 1100;
const REPLAY_NORMAL_MS = 2900; // replayed at 1x
const REPLAY_SLOWMO_SRC_MS = 700; // final moments, replayed at 0.4x
const REPLAY_SLOWMO_RATE = 0.4;
const REPLAY_TOTAL_MS = REPLAY_NORMAL_MS + REPLAY_SLOWMO_SRC_MS / REPLAY_SLOWMO_RATE;

let dead = false;
let death = null; // { t, msg, killerId, deathPos, replay: {...} }
let killCamWeaponView = null;
let currentKillCamWeaponKey = null;
let killCamRecoilT = 0;

async function updateKillCamWeapon(weaponKey) {
  if (currentKillCamWeaponKey === weaponKey) return;
  currentKillCamWeaponKey = weaponKey;
  killCamWeaponView = null;
  viewmodel?.setWeapon(null);
  if (weaponKey && weaponKey !== 'zombie') {
    const view = await createWeaponView(weaponKey);
    if (camera && death?.replay && currentKillCamWeaponKey === weaponKey) {
      killCamWeaponView = view;
      viewmodel.setWeapon(killCamWeaponView);
    }
  }
}

function startDeath(msg) {
  dead = true;
  streak = 0;
  exitSatView();
  if (tabletMesh) tabletMesh.removeFromParent();
  tablet = null;
  clearInput();
  reload = null;
  reloadIndicatorEl?.classList.add('hidden');
  if (cooking) throwGrenade(Math.max(0, GRENADE_FUSE_MS - (performance.now() - cooking.start)), 0.05); // dropped live grenade
  const now = performance.now();
  const killerId = msg.killerId;
  const killerIsPlayer = typeof killerId === 'number' && killerId !== myId && remotePlayers[killerId];
  const hasHistory = killerIsPlayer && msg.weapon !== 'airstrike' && history.some((h) => h.p[String(killerId)]);
  death = {
    t: now,
    msg,
    killerId,
    deathPos: new THREE.Vector3(localPlayer.x, localPlayer.y, localPlayer.z),
    startYaw: localPlayer.angle,
    startPitch: localPlayer.pitch,
    replay: null,
    canReplay: hasHistory,
    replayStarted: false,
    lastTs: 0,
    victimModel: null,
    victimDown: false,
  };
  if (myWeaponView) myWeaponView.visible = false;
  crosshair.classList.add('hidden');
  sniperScopeEl.classList.add('hidden');
  const killerName = killerId === myId ? 'yourself' : killerIsPlayer ? remotePlayers[killerId].data.name : typeof killerId === 'string' ? 'a Mutant' : 'the environment';
  notifyKill(`KILLED BY ${String(killerName).toUpperCase()}`, msg.headshot);
  if (document.pointerLockElement) document.exitPointerLock();

  // Killer card
  const set = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  set('kc-killer-name', killerId === myId ? 'SELF-INFLICTED' : String(killerName).toUpperCase());
  const kcIcon = $('kc-weapon-icon');
  if (kcIcon) kcIcon.innerHTML = weaponIcon(msg.weapon);
  set('kc-weapon-name', (WEAPONS[msg.weapon]?.name || { grenade: 'Frag Grenade', airstrike: 'Airstrike' }[msg.weapon] || 'Claws').toUpperCase());
  set('kc-distance', `${Math.round(msg.distance || 0)}m`);
  set('kc-killer-health', killerId === myId ? '—' : String(Math.round(msg.killerHealth ?? 0)));
  $('kc-headshot')?.classList.toggle('hidden', !msg.headshot);
}

function beginReplay(now) {
  death.replayStarted = true;
  killcamOverlayEl.classList.remove('hidden');
  const title = $('killcam-title');
  if (death.canReplay) {
    const tEnd = death.t;
    death.replay = { start: now, srcStart: tEnd - REPLAY_NORMAL_MS - REPLAY_SLOWMO_SRC_MS, srcEnd: tEnd };
    death.lastTs = death.replay.srcStart;
    if (title) title.textContent = 'KILLCAM';
    const killer = remotePlayers[death.killerId];
    if (killer) killer.model.group.visible = false;
    // A copy of you, replaying your last moments, so you can see exactly
    // where you were standing when you got shot.
    const skin = SKINS.find((s) => s.id === selectedSkin) || SKINS[0];
    const accent = ACCENTS.find((a) => a.id === selectedAccent) || ACCENTS[0];
    death.victimModel = createPlayerModel(skin, localPlayer.name, { accentColor: accent.color, headgear: selectedHeadgear, weapon: currentKey(), nameColor: '#ffd36b' });
    death.victimModel.setNameStyle('#ffd36b', true);
    scene.add(death.victimModel.group);
    for (const rp of Object.values(remotePlayers)) rp.replay = true;
  } else {
    if (title) title.textContent = currentMapMode === 'zombies' ? 'OVERRUN' : 'YOU DIED';
  }
}

function endKillcam() {
  if (!death) return;
  if (death.victimModel) {
    scene?.remove(death.victimModel.group);
    death.victimModel.dispose();
  }
  for (const rp of Object.values(remotePlayers)) {
    if (rp.replay) {
      rp.replay = false;
      rp.model.group.visible = rp.data.health > 0;
    }
  }
  killCamWeaponView = null;
  viewmodel?.setWeapon(myWeaponView);
  currentKillCamWeaponKey = null;
  killcamOverlayEl.classList.add('hidden');
  death = null;
}

function replaySourceTime(e) {
  const r = death.replay;
  if (e < REPLAY_NORMAL_MS) return r.srcStart + e;
  return Math.min(r.srcEnd, r.srcStart + REPLAY_NORMAL_MS + (e - REPLAY_NORMAL_MS) * REPLAY_SLOWMO_RATE);
}

function updateDeathCamera(now, dt) {
  const since = now - death.t;
  const respawnIn = Math.max(0, (death.t + RESPAWN_DELAY_MS - now) / 1000);
  const respawnEl = $('respawn-timer');
  if (respawnEl) respawnEl.textContent = `RESPAWN IN ${respawnIn.toFixed(1)}`;

  if (since < DEATH_FALL_MS) {
    // First-person collapse, turning toward whoever shot you.
    const t = since / DEATH_FALL_MS;
    const ease = 1 - Math.pow(1 - Math.min(1, t * 1.4), 3);
    let yaw = death.startYaw;
    const killer = remotePlayers[death.killerId];
    if (killer) yaw = lerpAngle(death.startYaw, Math.atan2(-(killer.render.x - death.deathPos.x), -(killer.render.z - death.deathPos.z)), ease);
    camera.position.set(death.deathPos.x, death.deathPos.y + THREE.MathUtils.lerp(localPlayer.standHeight, 0.3, ease), death.deathPos.z);
    camera.rotation.set(THREE.MathUtils.lerp(death.startPitch, 0.1, ease), yaw, ease * 1.1);
    damageFlashLevel = Math.max(damageFlashLevel, 0.7);
    return;
  }
  if (!death.replayStarted) beginReplay(now);

  if (!death.replay) {
    // No replay available: slow orbit around where you fell.
    const t = (since - DEATH_FALL_MS) / 1000;
    const p = death.deathPos;
    camera.position.set(p.x + Math.sin(t * 0.4) * 7, p.y + 3.2, p.z + Math.cos(t * 0.4) * 7);
    camera.rotation.set(0, 0, 0);
    camera.lookAt(p.x, p.y + 0.5, p.z);
    const bar = $('killcam-bar');
    if (bar) bar.style.width = `${Math.min(100, ((since - DEATH_FALL_MS) / (RESPAWN_DELAY_MS - DEATH_FALL_MS)) * 100)}%`;
    return;
  }

  const e = Math.min(REPLAY_TOTAL_MS, now - death.replay.start);
  const ts = replaySourceTime(e);
  const slow = e >= REPLAY_NORMAL_MS;
  const bar = $('killcam-bar');
  if (bar) bar.style.width = `${(e / REPLAY_TOTAL_MS) * 100}%`;
  const timeEl = $('killcam-time');
  if (timeEl) timeEl.textContent = slow ? 'SLOW-MO ×0.4' : `-${((death.replay.srcEnd - ts) / 1000).toFixed(1)}s`;

  // Killer's eyes
  const k = sampleHistory(death.killerId, ts);
  if (k) {
    camera.position.set(k.x, k.y + (k.c ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT), k.z);
    camera.rotation.set(k.p, k.a, 0);
    if (k.w) updateKillCamWeapon(k.w);
  }
  killCamRecoilT = Math.max(0, killCamRecoilT - dt * 6);
  if (killCamWeaponView) {
    const [bx, by, bz] = killCamWeaponView.userData.basePosition || [0.3, -0.25, -0.9];
    killCamWeaponView.position.set(bx, by, bz + killCamRecoilT * 0.07);
    killCamWeaponView.rotation.x = killCamRecoilT * 0.06;
  }

  // Everyone else where they really were
  for (const [id, rp] of Object.entries(remotePlayers)) {
    if (Number(id) === death.killerId) continue;
    const s = sampleHistory(id, ts);
    rp.model.group.visible = !!s;
    if (s) {
      rp.model.setPosition(s.x, s.y, s.z, s.a);
      rp.model.setPitch(s.p);
      rp.model.animate(dt * (slow ? REPLAY_SLOWMO_RATE : 1), (s.s || 0) > 0.4, s.c, s.s || 0);
    }
  }
  const me = sampleHistory(myId, ts);
  if (me && death.victimModel) {
    death.victimModel.setPosition(me.x, me.y, me.z, me.a);
    death.victimModel.setPitch(me.p);
    if (!death.victimDown && ts >= death.replay.srcEnd - 30) {
      death.victimDown = true;
      death.victimModel.die();
    }
    death.victimModel.animate(dt * (slow ? REPLAY_SLOWMO_RATE : 1), false, me.c, 0);
  }

  // Replay every shot fired in this slice of time
  for (const shot of shotLog) {
    if (shot.t <= death.lastTs || shot.t > ts) continue;
    const isKiller = shot.id === death.killerId;
    const o = new THREE.Vector3(...shot.o);
    if (isKiller) {
      killCamRecoilT = 1;
      viewmodel.muzzleFlash(shot.weapon);
      sfx.playGunshot(shot.weapon);
      if (muzzleFlashLight) muzzleFlashLight.intensity = 5;
    } else {
      sfx.playGunshot(shot.weapon, o);
    }
    for (const end of shot.ends.slice(0, 6)) {
      const endV = new THREE.Vector3(...end);
      spawnTracer(isKiller ? camera.position.clone().add(new THREE.Vector3(0, -0.12, 0)) : o, endV, 0xffc070);
      if (me && endV.distanceTo(new THREE.Vector3(me.x, me.y + 1, me.z)) < 1.2) spawnParticles(endV, new THREE.Vector3(0, 1, 0), 'blood', 8);
    }
  }
  death.lastTs = ts;
}

// --- Killstreaks: UAV and tablet-called airstrike ---------------------------
// Earned by consecutive kills in one life and kept until used:
//   3 kills -> UAV (Z): a recon drone circles the map; every 2 seconds it
//              pings every enemy onto your (and your team's) radar.
//   5 kills -> Airstrike (X): pull out a rugged tablet, which opens a live
//              satellite feed of the battlefield. Pan/zoom to a target and
//              confirm; a strike jet screams over and drops a stick of six
//              bombs, each one falling on a real ballistic arc.
let viewmodel = null;
let satCamera = null;
const sat = { active: false, x: 0, z: 0, height: 200, enteredAt: 0, locked: false };
const satFocus = new THREE.Vector3();
let tablet = null; // { t, phase: 'raise' | 'up' | 'lower' }
let tabletMesh = null;
let tabletCanvas = null;
let streak = 0;
const streaks = { uav: 0, airstrike: 0 };
const UAV_KILLS = 3;
const AIRSTRIKE_KILLS = 5;
const UAV_DURATION_MS = 30000;
const UAV_PING_MS = 2000;
const AIRSTRIKE_SPEED = 120;
const AIRSTRIKE_ALT = 60;
const BOMB_COUNT = 6;
const BOMB_SPACING = 7;
const BOMB_FALL_MS = Math.sqrt((2 * AIRSTRIKE_ALT) / 20) * 1000; // g = 20
let uavUntil = 0;
let enemyUavUntil = 0;
let uavPings = [];
let lastUavPing = 0;
let drones = [];
let airstrikes = [];
let savedFogDensity = null;

const ksCountEl = $('ks-count');
const ksUavEl = $('ks-uav');
const ksAirEl = $('ks-airstrike');
const uavIndicatorEl = $('uav-indicator');
const satOverlayEl = $('sat-overlay');
const satMarkersEl = $('sat-markers');
const satCtx = satMarkersEl?.getContext('2d');

function resetKillstreaks() {
  streak = 0;
  streaks.uav = 0;
  streaks.airstrike = 0;
  uavUntil = 0;
  enemyUavUntil = 0;
  uavPings = [];
  drones = [];
  airstrikes = [];
  sat.active = false;
  tablet = null;
  tabletMesh = null;
}

function onStreakKill() {
  if (dead) return;
  streak += 1;
  if (streak === UAV_KILLS) {
    streaks.uav += 1;
    showBanner('UAV READY — PRESS Z', 2600);
    sfx.playRadio('confirm');
  }
  if (streak === AIRSTRIKE_KILLS) {
    streaks.airstrike += 1;
    showBanner('AIRSTRIKE READY — PRESS X', 2600);
    sfx.playRadio('confirm');
  }
}

// Cheat: every killstreak, full ammo and grenades.
function activateCheats() {
  streaks.uav += 1;
  streaks.airstrike += 1;
  for (const key of WEAPON_ORDER) {
    const ammo = ammoFor(key);
    ammo.mag = WEAPONS[key].mag;
    ammo.reserve = WEAPONS[key].reserve;
  }
  grenadesLeft = Math.max(grenadesLeft, GRENADES_PER_LIFE);
  showBanner('CHEAT ACTIVATED — UAV [Z] + AIRSTRIKE [X] READY, MAX AMMO', 3000);
  sfx.playRadio('confirm');
}

function spawnDrone() {
  const mesh = makeUav();
  scene.add(mesh);
  drones.push({ mesh, until: performance.now() + UAV_DURATION_MS, angle: Math.random() * Math.PI * 2 });
}

function callUav() {
  if (!canAct() || streaks.uav <= 0) return;
  streaks.uav -= 1;
  uavUntil = performance.now() + UAV_DURATION_MS;
  lastUavPing = 0;
  spawnDrone();
  network.send({ type: 'uav' });
  sfx.playRadio('uav');
  showBanner('UAV ONLINE', 2000);
}

function onRemoteUav(msg) {
  if (!scene || msg.ownerId === myId) return;
  spawnDrone();
  const owner = remotePlayers[msg.ownerId];
  if (owner && isAlly(owner.data)) {
    uavUntil = performance.now() + UAV_DURATION_MS;
    lastUavPing = 0;
    showBanner('FRIENDLY UAV ONLINE', 2000);
    sfx.playRadio('uav');
  } else {
    enemyUavUntil = performance.now() + UAV_DURATION_MS;
    showBanner('ENEMY UAV OVERHEAD', 2200);
    sfx.playRadio('enemy');
  }
}

// --- Tablet + satellite view ---
function drawTabletScreen() {
  const c = tabletCanvas;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#071108';
  ctx.fillRect(0, 0, c.width, c.height);
  if (radarLayer) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.filter = 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(2) brightness(1.4)';
    ctx.drawImage(radarLayer, 96, 0, 320, 320);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(120,255,140,0.25)';
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(96 + i * 40, 0);
    ctx.lineTo(96 + i * 40, 320);
    ctx.moveTo(96, i * 40);
    ctx.lineTo(416, i * 40);
    ctx.stroke();
  }
  const px = 96 + ((localPlayer.x + 120) / 240) * 320;
  const pz = ((localPlayer.z + 120) / 240) * 320;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px, pz, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9dffae';
  ctx.font = '16px monospace';
  ctx.fillText('SAT LINK', 8, 24);
  ctx.fillText('ESTABLISHING', 8, 44);
  ctx.fillStyle = '#ff6a50';
  ctx.fillText('AIRSTRIKE', 8, 300);
  tabletMesh.userData.screenTexture.needsUpdate = true;
}

function openTablet() {
  if (!canAct() || streaks.airstrike <= 0 || cooking || tablet) return;
  isAds = false;
  isFireHeld = false;
  reload = null;
  reloadIndicatorEl?.classList.add('hidden');
  if (!tabletMesh) {
    tabletCanvas = document.createElement('canvas');
    tabletCanvas.width = 512;
    tabletCanvas.height = 320;
    tabletMesh = makeTablet(tabletCanvas);
  }
  drawTabletScreen();
  viewmodel.camera.add(tabletMesh);
  tablet = { t: 0, phase: 'raise' };
  sfx.playRadio('beep');
}

function updateTablet(dt) {
  if (!tablet || !tabletMesh) return;
  if (tablet.phase === 'raise') {
    tablet.t = Math.min(1, tablet.t + dt / 0.55);
    if (tablet.t >= 1) {
      tablet.phase = 'up';
      enterSatView();
    }
  } else if (tablet.phase === 'lower') {
    tablet.t = Math.max(0, tablet.t - dt / 0.4);
    if (tablet.t <= 0) {
      tabletMesh.removeFromParent();
      tablet = null;
      return;
    }
  }
  const e = tablet.t * tablet.t * (3 - 2 * tablet.t);
  tabletMesh.position.set(0, THREE.MathUtils.lerp(-0.55, -0.075, e), THREE.MathUtils.lerp(-0.42, -0.34, e));
  tabletMesh.rotation.set(THREE.MathUtils.lerp(-1.0, -0.2, e), 0, THREE.MathUtils.lerp(0.25, 0, e));
}

function enterSatView() {
  if (dead || !scene) return;
  const fwdX = -Math.sin(localPlayer.angle);
  const fwdZ = -Math.cos(localPlayer.angle);
  sat.active = true;
  sat.locked = false;
  sat.height = 210;
  sat.x = THREE.MathUtils.clamp(localPlayer.x + fwdX * 35, -world.bounds, world.bounds);
  sat.z = THREE.MathUtils.clamp(localPlayer.z + fwdZ * 35, -world.bounds, world.bounds);
  sat.enteredAt = performance.now();
  satOverlayEl.classList.remove('hidden', 'locked', 'boot');
  void satOverlayEl.offsetWidth;
  satOverlayEl.classList.add('boot');
  document.body.classList.add('sat-mode');
  renderer.domElement.style.filter = 'grayscale(1) sepia(0.5) hue-rotate(55deg) saturate(1.4) contrast(1.45) brightness(1.1)';
  if (scene.fog && 'density' in scene.fog) {
    savedFogDensity = scene.fog.density;
    scene.fog.density = 0.0007; // uniform only — no shader recompile
  }
  sfx.playRadio('beep');
}

function exitSatView() {
  if (sat.active) {
    sat.active = false;
    satOverlayEl.classList.add('hidden');
    document.body.classList.remove('sat-mode');
    if (renderer) renderer.domElement.style.filter = '';
    if (scene?.fog && savedFogDensity !== null) scene.fog.density = savedFogDensity;
    savedFogDensity = null;
  }
  if (tablet) tablet.phase = 'lower';
}

function strikeDirection() {
  let dx = sat.x - localPlayer.x;
  let dz = sat.z - localPlayer.z;
  const len = Math.hypot(dx, dz);
  if (len < 5) {
    dx = -Math.sin(localPlayer.angle);
    dz = -Math.cos(localPlayer.angle);
  } else {
    dx /= len;
    dz /= len;
  }
  return { dx, dz };
}

function confirmAirstrike() {
  if (!sat.active || sat.locked || streaks.airstrike <= 0) return;
  sat.locked = true;
  satOverlayEl.classList.add('locked');
  streaks.airstrike -= 1;
  const { dx, dz } = strikeDirection();
  network.send({ type: 'airstrike', x: sat.x, z: sat.z, dx, dz });
  startAirstrike(sat.x, sat.z, dx, dz, true);
  sfx.playRadio('confirm');
  showBanner('AIRSTRIKE INBOUND', 2500);
  setTimeout(() => sat.active && sat.locked && exitSatView(), 750);
}

function startAirstrike(x, z, dx, dz, isLocal) {
  if (!scene) return;
  const now = performance.now();
  const t0 = now + 3300; // jet over the target
  const jet = makeJet();
  jet.visible = false;
  scene.add(jet);
  const dir = new THREE.Vector3(dx, 0, dz).normalize();
  const bombs = [];
  for (let k = 0; k < BOMB_COUNT; k++) {
    const off = (k - (BOMB_COUNT - 1) / 2) * BOMB_SPACING;
    const ti = t0 + (off / AIRSTRIKE_SPEED) * 1000;
    bombs.push({ p: new THREE.Vector3(x + dir.x * off, 0, z + dir.z * off), ti, tr: ti - BOMB_FALL_MS, mesh: null, done: false });
  }
  airstrikes.push({ jet, dir, t0, x, z, bombs, isLocal });
  const dist = Math.hypot(x - localPlayer.x, z - localPlayer.z);
  sfx.playJetFlyby((t0 - now) / 1000, THREE.MathUtils.clamp(1.2 - dist / 220, 0.35, 1));
}

function updateKillstreaks(dt, now) {
  // Drones circle high over the map
  for (let i = drones.length - 1; i >= 0; i--) {
    const d = drones[i];
    if (now > d.until) {
      d.mesh.removeFromParent();
      drones.splice(i, 1);
      continue;
    }
    d.angle += dt * 0.11;
    const pos = new THREE.Vector3(Math.cos(d.angle) * 80, 105, Math.sin(d.angle) * 80);
    const tangent = new THREE.Vector3(-Math.sin(d.angle), 0, Math.cos(d.angle));
    d.mesh.position.copy(pos);
    d.mesh.lookAt(pos.clone().sub(tangent));
    d.mesh.rotateZ(-0.25);
    if (d.mesh.userData.prop) d.mesh.userData.prop.rotation.z += dt * 60;
    for (const b of d.mesh.userData.blink || []) b.visible = Math.floor(now / 700) % 2 === 0;
  }

  // Strike jets and their bombs
  for (let i = airstrikes.length - 1; i >= 0; i--) {
    const s = airstrikes[i];
    const target = new THREE.Vector3(s.x, AIRSTRIKE_ALT, s.z);
    const jp = target.clone().addScaledVector(s.dir, (-AIRSTRIKE_SPEED * (s.t0 - now)) / 1000);
    s.jet.visible = Math.abs(s.t0 - now) < 4200;
    s.jet.position.copy(jp);
    s.jet.lookAt(jp.clone().sub(s.dir));
    s.jet.rotateZ(Math.sin(now / 900) * 0.05);
    let allDone = true;
    for (const b of s.bombs) {
      if (b.done) continue;
      allDone = false;
      if (now >= b.tr && !b.mesh) {
        b.mesh = makeBomb();
        scene.add(b.mesh);
      }
      if (b.mesh) {
        const tau = (now - b.tr) / 1000;
        const pos = b.p.clone().addScaledVector(s.dir, (-AIRSTRIKE_SPEED * (b.ti - now)) / 1000);
        pos.y = Math.max(0, AIRSTRIKE_ALT - 10 * tau * tau);
        const vel = s.dir.clone().multiplyScalar(AIRSTRIKE_SPEED).setY(-20 * tau);
        b.mesh.position.copy(pos);
        b.mesh.lookAt(pos.clone().sub(vel));
      }
      if (now >= b.ti) {
        b.done = true;
        b.mesh?.removeFromParent();
        // The caller's client is authoritative for damage, like rockets;
        // everyone else gets the explosions over the network.
        if (s.isLocal) detonateExplosive(new THREE.Vector3(b.p.x, 0.2, b.p.z), 'airstrike');
      }
    }
    if (allDone && now > s.t0 + 4500) {
      s.jet.removeFromParent();
      airstrikes.splice(i, 1);
    }
  }

  // UAV radar sweeps
  if (now < uavUntil && now - lastUavPing > UAV_PING_MS) {
    lastUavPing = now;
    uavPings = Object.values(remotePlayers)
      .filter((rp) => rp.data.health > 0 && !isAlly(rp.data))
      .map((rp) => ({ x: rp.render.x, z: rp.render.z, t: now }));
    for (const z of Object.values(zombieEntities)) uavPings.push({ x: z.data.x, z: z.data.z, t: now });
  }

  // HUD
  setText(ksCountEl, streak);
  setData(ksUavEl, 'state', now < uavUntil ? 'active' : streaks.uav > 0 ? 'ready' : 'locked');
  setData(ksAirEl, 'state', streaks.airstrike > 0 ? 'ready' : 'locked');
  if (uavIndicatorEl) {
    const friendly = now < uavUntil;
    const enemy = now < enemyUavUntil;
    uavIndicatorEl.classList.toggle('hidden', !friendly && !enemy);
    uavIndicatorEl.classList.toggle('enemy', enemy && !friendly);
    setText(uavIndicatorEl, friendly ? `UAV ONLINE  ${Math.ceil((uavUntil - now) / 1000)}s` : 'ENEMY UAV OVERHEAD');
  }
}

function updateSatView(now) {
  satCamera.position.set(sat.x, sat.height, sat.z);
  satCamera.lookAt(sat.x, 0, sat.z);
  satCamera.updateMatrixWorld();
  if (!satCtx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (satMarkersEl.width !== w || satMarkersEl.height !== h) {
    satMarkersEl.width = w;
    satMarkersEl.height = h;
  }
  satCtx.clearRect(0, 0, w, h);
  const toScreen = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(satCamera);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  };

  // Strike corridor preview
  const { dx, dz } = strikeDirection();
  const half = ((BOMB_COUNT - 1) / 2) * BOMB_SPACING + 5;
  const a = toScreen(sat.x - dx * half, 0, sat.z - dz * half);
  const b = toScreen(sat.x + dx * half, 0, sat.z + dz * half);
  const r = Math.abs(toScreen(sat.x + 10, 0, sat.z).x - toScreen(sat.x, 0, sat.z).x);
  satCtx.save();
  satCtx.strokeStyle = 'rgba(255, 90, 60, 0.35)';
  satCtx.lineWidth = r * 1.4;
  satCtx.lineCap = 'round';
  satCtx.beginPath();
  satCtx.moveTo(a.x, a.y);
  satCtx.lineTo(b.x, b.y);
  satCtx.stroke();
  satCtx.setLineDash([10, 8]);
  satCtx.lineWidth = 2;
  satCtx.strokeStyle = 'rgba(255, 140, 110, 0.9)';
  satCtx.beginPath();
  satCtx.moveTo(a.x, a.y);
  satCtx.lineTo(b.x, b.y);
  satCtx.stroke();
  satCtx.restore();

  // Thermal contacts
  let hostiles = 0;
  satCtx.font = '12px "Share Tech Mono", monospace';
  for (const rp of Object.values(remotePlayers)) {
    if (rp.data.health <= 0) continue;
    const ally = isAlly(rp.data);
    if (!ally) hostiles++;
    const p = toScreen(rp.render.x, rp.render.y + 1, rp.render.z);
    satCtx.fillStyle = ally ? '#5bbcff' : '#ff4433';
    satCtx.beginPath();
    satCtx.moveTo(p.x, p.y - 7);
    satCtx.lineTo(p.x + 7, p.y);
    satCtx.lineTo(p.x, p.y + 7);
    satCtx.lineTo(p.x - 7, p.y);
    satCtx.closePath();
    satCtx.fill();
    satCtx.fillText(ally ? rp.data.name : 'HOSTILE', p.x + 10, p.y + 4);
  }
  for (const z of Object.values(zombieEntities)) {
    hostiles++;
    const p = toScreen(z.data.x, 1, z.data.z);
    satCtx.fillStyle = '#ff4433';
    satCtx.fillRect(p.x - 4, p.y - 4, 8, 8);
  }
  const me = toScreen(localPlayer.x, localPlayer.y + 1, localPlayer.z);
  satCtx.fillStyle = '#ffffff';
  satCtx.beginPath();
  satCtx.arc(me.x, me.y, 6, 0, Math.PI * 2);
  satCtx.fill();
  satCtx.fillText('YOU', me.x + 9, me.y + 4);

  const set = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  set('sat-grid', `${String(Math.round(sat.x + 500)).padStart(4, '0')} ${String(Math.round(500 - sat.z)).padStart(4, '0')}`);
  set('sat-alt', `${Math.round(sat.height * 12)}m`);
  set('sat-hdg', `${String(Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360)).padStart(3, '0')}°`);
  set('sat-hostiles', hostiles);
  set('sat-clock', new Date().toISOString().slice(11, 19) + 'Z');
}

// --- Match start/stop ---------------------------------------------------
let fpsFrames = 0;
let fpsTime = 0;

// --- Night survival atmosphere ---------------------------------------------
// Dead Woods is played at night: a weapon-mounted flashlight (L toggles it),
// lightning with rolling thunder, distant screams, a horror sound bed that
// tightens as the dead close in, and a heartbeat when they're on you.
let flashlight = null;
let nextLightningAt = 0;
let nextScreamAt = 0;
let nextHeartbeatAt = 0;

function setupNight(msg) {
  flashlight = null;
  document.body.classList.toggle('night-mode', !!world.night);
  if (!world.night) return;
  flashlight = new THREE.SpotLight(0xfff1dc, 55, 48, 0.42, 0.5, 1.4);
  flashlight.position.set(0.18, -0.12, 0.1);
  flashlight.target.position.set(0.05, -0.08, -1);
  if (quality.shadows && quality.lights >= 3) {
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.set(512, 512);
    flashlight.shadow.camera.near = 0.3;
    flashlight.shadow.bias = -0.0006;
  }
  camera.add(flashlight, flashlight.target);
  const now = performance.now();
  nextLightningAt = now + 12000 + Math.random() * 15000;
  nextScreamAt = now + 25000 + Math.random() * 30000;
  if (MAPS[msg.map]?.mode === 'zombies') {
    sfx.initAudio();
    sfx.startHorrorAmbience?.();
  }
}

function updateNight(dt, now, nearestZombie) {
  // Tension follows how close (and how many) the dead are.
  const count = Object.values(zombieEntities).filter((z) => !z.dead).length;
  const close = Number.isFinite(nearestZombie) ? THREE.MathUtils.clamp(1 - nearestZombie / 30, 0, 1) : 0;
  sfx.setHorrorIntensity?.(Math.min(1, close * 0.8 + Math.min(1, count / 20) * 0.3));
  if (!dead && now > nextHeartbeatAt && (localPlayer.health < 40 || nearestZombie < 7)) {
    const rate = localPlayer.health < 25 || nearestZombie < 3 ? 1.6 : 1.1;
    sfx.playHeartbeat?.(rate);
    nextHeartbeatAt = now + 900 / rate;
  }
  if (now > nextLightningAt) {
    const dist = Math.random();
    world.lightning(1.1 - dist * 0.6);
    sfx.playThunder?.(dist);
    if (Math.random() < 0.4) setTimeout(() => world?.lightning?.(0.6), 140 + Math.random() * 200);
    nextLightningAt = now + 18000 + Math.random() * 35000;
  }
  if (now > nextScreamAt) {
    const a = Math.random() * Math.PI * 2;
    sfx.playScream?.({ x: localPlayer.x + Math.cos(a) * 80, y: 2, z: localPlayer.z + Math.sin(a) * 80 }, true);
    nextScreamAt = now + 40000 + Math.random() * 60000;
  }
}

// The server's AI needs the map's solid geometry so bots and zombies can't
// see, shoot or walk through walls. Uploaded once per map version.
function uploadWorldGeo(msg) {
  const c = world.collidables.map((o) => [
    Math.round(o.x * 100) / 100,
    Math.round(o.z * 100) / 100,
    Math.round(o.radius * 100) / 100,
    Number.isFinite(o.minY) ? Math.round(o.minY * 100) / 100 : null,
    Number.isFinite(o.maxY) ? Math.round(o.maxY * 100) / 100 : null,
  ]);
  let h = 2166136261;
  for (const e of c) for (const v of e) h = Math.imul(h ^ Math.round((v ?? 999) * 100), 16777619);
  const version = `${c.length}-${(h >>> 0).toString(36)}`;
  if (msg.geoVersion === version) return;
  network?.send({ type: 'worldGeo', map: msg.map, version, bounds: world.bounds, c });
}

function startMatch(msg, name) {
  myId = msg.id;
  currentMapMode = MAPS[msg.map]?.mode || 'pvp';
  friendlyFireEnabled = !!msg.friendlyFire;
  quality = getQualityPreset(settings.quality);
  history = [];
  shotLog = [];
  dead = false;
  death = null;
  adsProgress = 0;
  recoilDebt = 0;
  grenadesLeft = GRENADES_PER_LIFE;
  cooking = null;

  const built = buildWorld(msg.map, { quality });
  scene = built.scene;
  world = built;

  renderer = new THREE.WebGLRenderer({ antialias: quality.antialias && !quality.postFx, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = quality.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  // The sun's shadow map is re-rendered every other frame, not every frame:
  // it halves the cost of the (foliage-heavy) shadow pass and is invisible.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setSize(window.innerWidth, window.innerHeight);
  gameContainer.innerHTML = '';
  gameContainer.appendChild(renderer.domElement);

  // Performance passes on the finished static world (before any dynamic
  // objects are added).
  batchStaticMeshes(scene);
  lightPool = new LightPool(scene, quality.lights, 2);
  staticMeshes = collectRaycastTargets(scene);
  if (world.envScene) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(world.envScene, 0, 0.1, 5000).texture;
    scene.environmentIntensity = world.night ? 0.22 : msg.map === 'forest' ? 0.55 : 0.35;
    pmrem.dispose();
  }
  sunOffset = world.sun.position.clone();
  grenades = new GrenadeSystem({ scene, world });

  camera = new THREE.PerspectiveCamera(verticalFov(settings.fov), window.innerWidth / window.innerHeight, 0.05, 600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // The held weapon is drawn by its own renderer pass (see viewmodel.js).
  viewmodel = new Viewmodel(camera.aspect);
  viewmodel.setFov(WEAPON_FOV_PRESETS[settings.weaponFov] || WEAPON_FOV_PRESETS.default);
  const isForestMap = msg.map === 'forest';
  viewmodel.setLighting(
    world.night
      ? { sky: 0x4a5a7a, ground: 0x14160f, environment: scene.environment, environmentIntensity: 0.35, keyIntensity: 1.1 }
      : {
          sky: isForestMap ? 0xbcd4e6 : msg.map === 'zombies' ? 0x8a4a40 : 0xb0bcc6,
          ground: isForestMap ? 0x3b4a2a : 0x3a3a3d,
          environment: scene.environment,
          environmentIntensity: msg.map === 'zombies' ? 0.2 : 0.6,
          keyIntensity: msg.map === 'zombies' ? 1.2 : 2.4,
        }
  );
  viewmodel.setSunDirection(world.sun.position.clone().normalize());
  satCamera = new THREE.PerspectiveCamera(32, camera.aspect, 1, 1200);
  satCamera.up.set(0, 0, -1);
  resetKillstreaks();
  muzzleFlashLight = new THREE.PointLight(0xffaa44, 0, 10, 1.5);
  muzzleFlashLight.position.set(0.2, -0.15, -0.8);
  camera.add(muzzleFlashLight);

  postFx = null;
  if (quality.postFx) {
    const r = renderer;
    createPostFx(renderer, scene, camera, quality)
      .then((fx) => {
        if (renderer === r) postFx = fx;
      })
      .catch((err) => console.warn('[perf] post FX unavailable:', err));
  }

  setupNight(msg);
  // Paint the zombie skins now (behind the loading screen), not on first spawn.
  if (currentMapMode === 'zombies' && humanSoldierReady()) prepareZombieAssets();
  uploadWorldGeo(msg);

  localPlayer = new LocalPlayer(msg.self.x, msg.self.z, msg.self.angle || 0);
  localPlayer.name = name;
  localPlayer.health = msg.self.health;
  localPlayer.score = msg.self.score;
  localPlayer.deaths = msg.self.deaths || 0;
  localPlayer.team = msg.self.team;

  initSharedVFX();
  resetAmmo();
  weaponIndex = Math.max(0, WEAPON_ORDER.indexOf(msg.self.weapon));
  myWeaponView = null;
  const startingWeaponIndex = weaponIndex;
  createWeaponView(WEAPON_ORDER[weaponIndex]).then((view) => {
    if (weaponIndex !== startingWeaponIndex || !camera) return;
    myWeaponView = view;
    viewmodel.setWeapon(myWeaponView);
  });

  remotePlayers = {};
  for (const p of msg.players) if (p.id !== myId) addRemotePlayer(p);

  zombieEntities = {};
  localPlayer.zombieKills = 0;
  if (currentMapMode === 'zombies') {
    for (const z of msg.zombies || []) addZombie(z);
    roundValueEl.textContent = msg.zombieRound ? `WAVE ${msg.zombieRound}` : 'GET READY';
    zombieHudEl.classList.remove('hidden');
  } else {
    zombieHudEl.classList.add('hidden');
  }

  buildRadarLayer();
  secretFound = false;
  secretsValueEl.textContent = '0';
  shownWeaponKey = null;
  scoreboardHtml = '';
  pingValueEl.textContent = '--';
  if (killfeedEl) killfeedEl.innerHTML = '';
  fpsCounterEl?.classList.toggle('hidden', !settings.showFps);

  lobby.classList.add('hidden');
  hud.classList.remove('hidden');
  gameContainer.classList.remove('hidden');
  clickOverlay.classList.remove('hidden');
  crosshair.classList.remove('hidden');
  minimap.classList.remove('hidden');

  // Compile every shader up front so the first seconds of play don't hitch.
  camera.position.set(localPlayer.x, localPlayer.eyeHeight, localPlayer.z);
  renderer.compile(scene, camera);

  lastTime = performance.now();
  running = true;
  requestAnimationFrame(loop);
}

function endMatch() {
  running = false;
  exitSatView();
  viewmodel?.clearShells();
  if (document.pointerLockElement) document.exitPointerLock();
  endKillcam();
  dead = false;
  lobby.classList.remove('hidden');
  hud.classList.add('hidden');
  gameContainer.classList.add('hidden');
  clickOverlay.classList.add('hidden');
  crosshair.classList.remove('hidden');
  minimap.classList.add('hidden');
  inventoryOverlay.classList.add('hidden');
  helpOverlay.classList.add('hidden');
  weaponsOverlay.classList.add('hidden');
  sniperScopeEl.classList.add('hidden');
  inventoryOpen = helpOpen = weaponsOpen = false;
  zombieHudEl.classList.add('hidden');
  sfx.stopHorrorAmbience?.();
  document.body.classList.remove('night-mode');
  flashlight = null;

  if (scene) {
    for (const id of Object.keys(remotePlayers)) removeRemotePlayer(Number(id));
    for (const id of Object.keys(zombieEntities)) removeZombie(id);
    for (const r of activeRockets) scene.remove(r.mesh);
    for (const p of activeParticles) scene.remove(p.mesh);
    for (const d of activeDecals) scene.remove(d);
    for (const s of activeSprites) scene.remove(s.sprite);
    for (const t of tracers) scene.remove(t.mesh);
    grenades?.clear();
  }
  activeRockets = [];
  activeParticles = [];
  activeDecals = [];
  activeSprites = [];
  tracers.length = 0;
  staticMeshes = [];
  muzzleFlashLight = null;
  lightPool = null;
  postFx?.dispose();
  postFx = null;
  if (renderer) {
    renderer.dispose();
    gameContainer.innerHTML = '';
  }
  renderer = null;
  camera = null;
  scene = null;
}

// --- Pre-game lobby -------------------------------------------------------
// Everyone who deploys waits here: the lineup shows each player's soldier
// with their gun, name, and ready state; the match starts when all are ready.
const pregameEl = $('pregame');
let lineup = null;
let pgReady = false;
let pgCountdownEnd = 0;
let leavingLobby = false;

function showPregame() {
  lobby.classList.add('hidden');
  pregameEl.classList.remove('hidden');
  if (!lineup) lineup = createLineup($('pregame-stage'), $('pregame-plates'));
  lineup.setActive(true);
  pgReady = false;
  pgCountdownEnd = 0;
  renderPregameWeapons();
  updateReadyButton();
}

function hidePregame() {
  if (pregameEl.classList.contains('hidden')) return;
  pregameEl.classList.add('hidden');
  lineup?.setActive(false);
  if (!running) lobby.classList.remove('hidden');
}

function updatePregame(msg) {
  if (pregameEl.classList.contains('hidden')) return;
  lineup.setPlayers(msg.players, msg.you);
  const host = msg.players.find((p) => p.host);
  const bots = msg.bots.ally + msg.bots.enemy;
  $('pg-map').textContent = (MAPS[msg.map]?.name || msg.map).toUpperCase();
  $('pg-meta').textContent = `HOST ${(host?.name || '—').toUpperCase()} · ${msg.players.length} PLAYER${msg.players.length === 1 ? '' : 'S'} · ${bots} AI BOT${bots === 1 ? '' : 'S'}`;
  const ready = msg.players.filter((p) => p.ready).length;
  $('pg-ready-count').textContent = `${ready}/${msg.players.length}`;
  const me = msg.players.find((p) => p.lid === msg.you);
  if (me) pgReady = me.ready;
  pgCountdownEnd = msg.countdownMs === null ? 0 : performance.now() + msg.countdownMs;
  $('pg-hint').textContent =
    ready === msg.players.length ? 'Everyone is ready — deploying.' : `Waiting for ${msg.players.length - ready} player${msg.players.length - ready === 1 ? '' : 's'} to ready up.`;
  updateReadyButton();
}

function updateReadyButton() {
  const btn = $('pg-ready');
  btn.textContent = pgReady ? 'READY ✓' : 'READY UP';
  btn.classList.toggle('is-ready', pgReady);
}

function renderPregameWeapons() {
  const wrap = $('pg-weapons');
  wrap.innerHTML = '';
  for (const key of WEAPON_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = key === selectedWeapon ? 'selected' : '';
    const img = weaponImage(key);
    b.innerHTML = (img ? `<img src="${img.shaded}" alt="" />` : '') + WEAPONS[key].name;
    b.addEventListener('click', () => {
      selectedWeapon = key;
      network?.send({ type: 'lobbyUpdate', weapon: key });
      renderPregameWeapons();
      buildLobbyCards();
    });
    wrap.appendChild(b);
  }
}

$('pg-ready').addEventListener('click', () => {
  pgReady = !pgReady;
  network?.send({ type: 'ready', ready: pgReady });
  sfx.initAudio();
  sfx.playRadio(pgReady ? 'confirm' : 'beep');
  updateReadyButton();
});
$('pg-leave').addEventListener('click', () => {
  leavingLobby = true;
  network?.ws?.close();
  hidePregame();
});
setInterval(() => {
  const el = $('pg-countdown');
  if (!pgCountdownEnd || pregameEl.classList.contains('hidden')) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `MATCH STARTS IN ${Math.max(0, Math.ceil((pgCountdownEnd - performance.now()) / 1000))}`;
}, 100);

// --- Loading screen -------------------------------------------------------
let loadingEl = null;
function showLoading(mapName) {
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.style.cssText =
      'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
      'background:radial-gradient(ellipse at center,#1a1f24,#050709);color:#e8eae5;font-family:"Barlow Condensed","Rajdhani",sans-serif;letter-spacing:0.25em';
    document.body.appendChild(loadingEl);
  }
  loadingEl.innerHTML =
    `<div style="font-size:14px;color:#f2a33a">DEPLOYING</div><div style="font-size:42px;font-weight:700">${escapeHtml(String(mapName).toUpperCase())}</div>` +
    '<div style="font-size:12px;color:#a6acaf">BUILDING TERRAIN, VEGETATION AND LIGHTING…</div>';
  loadingEl.style.display = 'flex';
}
function hideLoading() {
  if (loadingEl) loadingEl.style.display = 'none';
}

// --- Connection flow --------------------------------------------------
lobbyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  sfx.initAudio();
  let address = serverInput.value.trim();
  const name = (nameInput.value.trim() || 'Player').slice(0, 16);
  if (!address) {
    statusEl.textContent = 'Enter a server address first.';
    return;
  }
  if (address.startsWith('http://')) address = 'ws://' + address.slice(7);
  else if (address.startsWith('https://')) address = 'wss://' + address.slice(8);
  if (!/^wss?:\/\//i.test(address)) address = 'ws://' + address;
  address = address.replace(/\/+$/, '');
  statusEl.textContent = 'Connecting...';

  network = new Network({
    onLobbyState: (msg) => updatePregame(msg),
    onWelcome: (msg) => {
      hidePregame();
      // Building a map takes a few seconds; show a loading screen first
      // (two frames so it actually paints) instead of a frozen lobby.
      showLoading(MAPS[msg.map]?.name || msg.map);
      // Start after the loading screen has painted (two frames). Background
      // tabs don't run animation frames, so a timer backs it up — otherwise
      // a player who alt-tabbed during the lobby countdown would never load.
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        try {
          startMatch(msg, name);
        } finally {
          hideLoading();
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(begin));
      setTimeout(begin, 150);
    },
    onPong: (msg) => {
      if (typeof msg.t !== 'number') return;
      const ms = Math.max(0, Math.round(performance.now() - msg.t));
      pingValueEl.textContent = `${ms}ms`;
      pingBarsEl.dataset.bars = String(ms < 45 ? 4 : ms < 90 ? 3 : ms < 160 ? 2 : 1);
    },
    onJoin: (p) => {
      if (p.id !== myId && scene) addRemotePlayer(p);
    },
    onLeave: (id) => removeRemotePlayer(id),
    onUpdate: (msg) => {
      const rp = remotePlayers[msg.id];
      if (!rp) return;
      pushSnapshot(rp, msg);
      rp.data.x = msg.x;
      rp.data.y = msg.y || 0;
      rp.data.z = msg.z;
      rp.data.angle = msg.angle;
      if (typeof msg.pitch === 'number') rp.data.pitch = msg.pitch;
      rp.crouching = !!msg.c;
      rp.flying = !!msg.f;
      rp.speed = typeof msg.s === 'number' ? msg.s : rp.speed;
      if (msg.weapon && msg.weapon !== rp.weapon) {
        rp.weapon = msg.weapon;
        rp.data.weapon = msg.weapon;
        rp.model.setWeapon(msg.weapon);
      }
    },
    onRocket: (msg) => {
      if (!scene) return;
      spawnRocket(new THREE.Vector3(msg.x, msg.y, msg.z), new THREE.Vector3(msg.dx, msg.dy, msg.dz), false);
    },
    onGrenade: (msg) => {
      if (!scene || msg.ownerId === myId) return;
      grenades.spawn({
        id: msg.id,
        ownerId: msg.ownerId,
        pos: new THREE.Vector3(msg.x, msg.y, msg.z),
        vel: new THREE.Vector3(msg.vx, msg.vy, msg.vz),
        fuseMs: msg.fuse,
        isLocal: false,
      });
    },
    onUav: (msg) => running && onRemoteUav(msg),
    onAirstrike: (msg) => {
      if (running && msg.ownerId !== myId) startAirstrike(msg.x, msg.z, msg.dx, msg.dz, false);
    },
    onExplosion: (msg) => {
      if (!scene) return;
      if (msg.kind === 'grenade' && msg.gid) {
        const g = grenades.findById(msg.gid);
        if (g) grenades.remove(g);
      }
      spawnExplosionVfx(new THREE.Vector3(msg.x, msg.y, msg.z), msg.kind);
    },
    onShoot: (msg) => {
      if (!scene || msg.id === myId) return;
      const rp = remotePlayers[msg.id];
      const weapon = msg.weapon || rp?.weapon || 'ak47';
      let origin = Array.isArray(msg.o) ? new THREE.Vector3(...msg.o) : null;
      if (rp) {
        rp.lastShotAt = WEAPONS[weapon] && (weapon === 'm4a1' || weapon === 'mp5') ? rp.lastShotAt : performance.now();
        if (rp.model.group.visible) {
          rp.model.muzzleFlash();
          origin = rp.model.muzzle.getWorldPosition(new THREE.Vector3());
        }
      }
      if (!origin) return;
      sfx.playGunshot(weapon, origin);
      const ends = Array.isArray(msg.ends) ? msg.ends : [];
      for (const end of ends.slice(0, 6)) spawnTracer(origin, new THREE.Vector3(...end), 0xffc070);
      if (!dead) recordShot(msg.id, weapon, v3(origin), ends);
    },
    onHealth: (msg) => {
      if (!running) return; // match still loading
      if (msg.id === myId) {
        const prev = localPlayer.health;
        localPlayer.health = msg.health;
        if (msg.health < prev) {
          flashDamage(Math.min(0.6, (prev - msg.health) / 60));
          sfx.playHurt();
          addShake(0.15);
          const attacker = remotePlayers[msg.attackerId];
          const ax = attacker ? attacker.render.x : msg.ax;
          const az = attacker ? attacker.render.z : msg.az;
          if (typeof ax === 'number' && msg.attackerId !== myId) showDamageIndicator(ax, az);
        }
      } else if (remotePlayers[msg.id]) {
        remotePlayers[msg.id].data.health = msg.health;
      }
    },
    onKill: (msg) => {
      if (!running) return; // match still loading
      addKillfeed(msg);
      if (msg.killerId === myId) localPlayer.score = msg.killerScore;
      else if (remotePlayers[msg.killerId]) remotePlayers[msg.killerId].data.score = msg.killerScore;
      if (msg.victimId === myId) {
        localPlayer.deaths = msg.victimDeaths ?? localPlayer.deaths + 1;
        localPlayer.score = msg.victimScore ?? localPlayer.score;
        startDeath(msg);
        return;
      }
      const victim = remotePlayers[msg.victimId];
      if (victim) {
        victim.data.health = 0;
        victim.data.deaths = msg.victimDeaths;
        if (typeof msg.victimScore === 'number') victim.data.score = msg.victimScore;
        victim.model.die();
      }
      if (msg.killerId === myId && msg.victimId !== myId) {
        if (msg.weapon !== 'airstrike') onStreakKill(); // streak rewards don't chain
        flashHitmarker('kill');
        notifyKill(`${msg.headshot ? 'HEADSHOT  ' : 'ELIMINATED  '}${(victim?.data.name || '').toUpperCase()}`, msg.headshot);
        // Scavenge a magazine from the body.
        const ammo = ammoFor(currentKey());
        ammo.reserve = Math.min(WEAPONS[currentKey()].reserve, ammo.reserve + WEAPONS[currentKey()].mag);
      }
    },
    onRespawn: (msg) => {
      if (!running) return; // match still loading
      if (msg.id === myId) {
        endKillcam();
        dead = false;
        localPlayer.x = msg.x;
        localPlayer.z = msg.z;
        localPlayer.y = 0;
        localPlayer.vy = 0;
        localPlayer.vx = localPlayer.vz = 0;
        localPlayer.crouching = false;
        localPlayer.flying = false;
        localPlayer.health = msg.health;
        grenadesLeft = GRENADES_PER_LIFE;
        resetAmmo();
        damageFlashLevel = 0;
        if (myWeaponView) myWeaponView.visible = true;
        crosshair.classList.remove('hidden');
        clickOverlay.classList.remove('hidden');
        raiseUntil = performance.now() + 450;
        raiseT = 1;
      } else if (remotePlayers[msg.id]) {
        const rp = remotePlayers[msg.id];
        rp.data.x = msg.x;
        rp.data.z = msg.z;
        rp.data.y = 0;
        rp.data.health = msg.health;
        rp.buffer = [{ t: performance.now(), x: msg.x, y: 0, z: msg.z, a: rp.data.angle || 0, p: 0 }];
        rp.render = { id: msg.id, x: msg.x, y: 0, z: msg.z };
        rp.model.setPosition(msg.x, 0, msg.z, rp.data.angle || 0);
        rp.model.setVisible(true);
        if (rp.replay) rp.model.group.visible = false;
      }
    },
    onRoundStart: (msg) => {
      if (!running) return;
      roundValueEl.textContent = `WAVE ${msg.round || 1}`;
      showBanner(`WAVE ${msg.round || 1} — THEY'RE COMING`, 3200);
      sfx.playRoundStart?.(msg.round || 1);
    },
    onRoundClear: (msg) => {
      if (!running) return;
      showBanner(`WAVE ${msg.round || ''} SURVIVED — NEXT WAVE IN ${Math.round((msg.nextInMs || 10000) / 1000)}s`, 4000);
      sfx.playRoundClear?.();
    },
    onZombieSpawn: (msg) => {
      if (!running || !msg.zombie) return;
      addZombie(msg.zombie);
      updateZombiesHud();
    },
    onZombieTick: (msg) => {
      if (!running) return; // match still loading
      for (const z of msg.zombies) {
        const e = zombieEntities[z.id] || addZombie(z);
        if (e.dead) continue;
        e.target.x = z.x;
        e.target.z = z.z;
        e.target.a = z.a ?? e.target.a;
        e.speed = z.s ?? 0;
        e.attacking = !!z.at;
      }
      updateZombiesHud();
    },
    onZombieAttack: (msg) => {
      const z = zombieEntities[msg.id];
      if (!running || !z || z.dead) return;
      z.model.attack?.();
      sfx.playZombieAttack?.(zombiePos(z));
    },
    onZombieHealth: (msg) => {
      if (!running) return; // match still loading
      const z = zombieEntities[msg.id];
      if (!z) return;
      z.data.health = msg.health;
      sfx.playZombieHit?.(zombiePos(z));
    },
    onZombieDeath: (msg) => {
      if (!running) return; // match still loading
      killZombie(msg.id);
      if (msg.killerId === myId) {
        localPlayer.zombieKills += 1;
        if (typeof msg.killerScore === 'number') localPlayer.score = msg.killerScore;
        onStreakKill();
        flashHitmarker('kill');
      }
      updateZombiesHud();
    },
    onDisconnect: () => {
      statusEl.textContent = leavingLobby ? '' : 'Disconnected from server.';
      leavingLobby = false;
      hidePregame();
      endMatch();
    },
  });

  try {
    const playerTeam = Number($('player-team')?.value || 1);
    const friendlyFireSetting = $('friendly-fire') ? $('friendly-fire').value === '1' : true;
    await network.connect(address, {
      name,
      weapon: selectedWeapon,
      skin: selectedSkin,
      accent: selectedAccent,
      headgear: selectedHeadgear,
      mapPreference: selectedMap,
      allyBotsCount: Number($('ally-bots')?.value || 0),
      enemyBotsCount: Number($('enemy-bots')?.value || 0),
      team: playerTeam,
      friendlyFire: friendlyFireSetting,
    });
    statusEl.textContent = '';
    // Wait in the pre-game lobby; the server sends 'welcome' (and we drop
    // into the match) once everyone is ready — or right away if a match is
    // already running.
    if (!running) showPregame();
    try {
      localStorage.setItem('doom.playerName', name);
      localStorage.setItem('doom.serverAddress', address);
      localStorage.setItem('doom.weapon', selectedWeapon);
      localStorage.setItem('doom.skin', selectedSkin);
      localStorage.setItem('doom.accent', selectedAccent);
      localStorage.setItem('doom.headgear', selectedHeadgear);
      localStorage.setItem('doom.map', selectedMap);
      localStorage.setItem('doom.playerTeam', String(playerTeam));
      localStorage.setItem('doom.friendlyFire', friendlyFireSetting ? '1' : '0');
    } catch {
      // Storage can be unavailable (private browsing, etc.) — not critical.
    }
  } catch {
    statusEl.innerHTML =
      `Could not reach <code>${escapeHtml(address)}</code>. Check: the host's server is ` +
      `running (<code>npm start</code>), the address matches exactly (including ` +
      `the port), you're both on the same Wi-Fi or the port is forwarded, and ` +
      `Windows Firewall isn't blocking Node.js.`;
  }
});

// --- Per-frame updates ----------------------------------------------------
function updateCombat(dt, now) {
  const key = currentKey();
  const w = WEAPONS[key];

  if (isFireHeld && w.auto) tryFire(false);
  if (autoReloadAt && now >= autoReloadAt) {
    autoReloadAt = 0;
    startReload();
  }
  updateReload(now);

  // Recoil recovery: once you stop firing, the view settles back down
  // most (not all) of the way, like a real rifle returning to the shoulder.
  if (recoilDebt > 0 && now - lastShotTime > w.fireCooldownMs + 90) {
    if (!recoilRecovering) {
      recoilRecovering = true;
      recoilDebt *= 0.75;
    }
    const rec = Math.min(recoilDebt, recoilDebt * Math.min(1, dt * 9) + dt * 0.01);
    localPlayer.pitch -= rec;
    recoilDebt -= rec;
  }
  spreadBloom = Math.max(0, spreadBloom - dt * w.spread * 4);
  viewPunch *= Math.exp(-dt * 14);
}

// --- Viewmodel animation ----------------------------------------------------
// Spring-driven, so every motion has weight and settles naturally:
// recoil kicks the gun back and up with a little random roll, looking
// around makes it lag behind the view, strafing tilts it, walking moves
// it in a figure-eight, jumping/landing make it float and dip, aiming
// swings it in to the sights, reloading tilts it in with jolts for mag
// out / mag in / charging handle, and it pulls up and back near walls.
const vmSpring = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  rot: new THREE.Vector3(),
  rvel: new THREE.Vector3(),
};
let vmTilt = 0;
let wallT = 0;
let probeTimer = 0;

function kickViewmodel(w, key) {
  const ads = adsProgress;
  const heavy = key === 'awp' || key === 'shotgun' || key === 'rocket';
  const k = w.recoil[0];
  const aimDamp = 1 - ads * 0.6;
  vmSpring.vel.z += (heavy ? 1.1 : 0.45 + k * 20) * (1 - ads * 0.3);
  vmSpring.vel.y += (heavy ? 0.25 : 0.06) * aimDamp;
  vmSpring.rvel.x += (heavy ? 5 : 1.2 + k * 90) * aimDamp;
  vmSpring.rvel.y += (Math.random() - 0.5) * (heavy ? 1.5 : 0.8) * aimDamp;
  vmSpring.rvel.z += (Math.random() - 0.5) * (heavy ? 3 : 1.6) * aimDamp;
}

function stepSpring(x, v, k, c, dt) {
  // semi-implicit Euler: a = -k*x - c*v
  v.addScaledVector(x, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
  x.addScaledVector(v, dt);
}

// Light/wall probes (a couple of BVH raycasts, a few times a second).
function probeEnvironment(dt) {
  probeTimer -= dt;
  if (probeTimer > 0 || !staticMeshes.length) return;
  probeTimer = 0.12;
  const origin = camera.getWorldPosition(new THREE.Vector3());
  // In the sun or in shade/indoors?
  raycaster.set(origin, world.sun.position.clone().normalize());
  raycaster.near = 0.3;
  raycaster.far = 150;
  raycaster.firstHitOnly = true;
  const shaded = raycaster.intersectObjects(staticMeshes, false).length > 0;
  viewmodel.exposureTarget = shaded ? 0.28 : 1;
  // Wall right in front of the muzzle?
  raycaster.set(origin, camera.getWorldDirection(new THREE.Vector3()));
  raycaster.near = 0;
  raycaster.far = 1.1;
  const hit = raycaster.intersectObjects(staticMeshes, false)[0];
  raycaster.firstHitOnly = false;
  raycaster.near = 0;
  wallTarget = hit ? THREE.MathUtils.clamp((1.1 - hit.distance) / 0.7, 0, 1) : 0;
}
let wallTarget = 0;

function updateViewmodel(dt, now) {
  const key = currentKey();
  const isSniper = key === 'awp';
  const target = isAds && !localPlayer.isSprinting && !reload && !cooking && !tablet && wallT < 0.5 ? 1 : 0;
  adsProgress += (target - adsProgress) * Math.min(1, dt * (key === 'awp' ? 9 : 12));
  const ads = adsProgress * adsProgress * (3 - 2 * adsProgress);

  const moving = localPlayer.isMoving && localPlayer.onGround;
  bobAmp += ((moving ? Math.min(1, localPlayer.speed / 4) : 0) - bobAmp) * Math.min(1, dt * 8);
  if (moving) bobPhase += dt * (localPlayer.isSprinting ? 13 : localPlayer.crouching ? 6 : 9);
  sprintT += ((localPlayer.isSprinting ? 1 : 0) - sprintT) * Math.min(1, dt * 9);
  recoilT = Math.max(0, recoilT - dt * 9);
  raiseT = Math.max(0, raiseT - dt * 2.4);
  const lowering = cooking || tablet;
  grenadeLowerT = lowering ? Math.min(1, grenadeLowerT + dt * 5) : Math.max(0, grenadeLowerT - dt * 3);
  vmSwayX *= Math.exp(-dt * 7);
  vmSwayY *= Math.exp(-dt * 7);
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  vmTilt += (strafe - vmTilt) * Math.min(1, dt * 6);
  probeEnvironment(dt);
  wallT += (wallTarget - wallT) * Math.min(1, dt * 8);

  stepSpring(vmSpring.pos, vmSpring.vel, 160, 14, dt);
  stepSpring(vmSpring.rot, vmSpring.rvel, 200, 16, dt);

  // Reload: tilt in, jolt on mag out, jolt on mag in, rack, tilt out.
  let reloadEnv = 0;
  if (reload) {
    const t = Math.min(1, (now - reload.start) / (reload.end - reload.start));
    reloadEnv = THREE.MathUtils.smoothstep(t, 0, 0.18) * (1 - THREE.MathUtils.smoothstep(t, 0.82, 1));
    if (!reload.s1 && t > 0.3) {
      reload.s1 = true;
      vmSpring.rvel.x -= 2.2;
      vmSpring.vel.y -= 0.35;
    }
    if (!reload.s2 && t > 0.62) {
      reload.s2 = true;
      vmSpring.rvel.x += 3.2;
      vmSpring.vel.y += 0.45;
    }
    if (!reload.s3 && t > 0.84) {
      reload.s3 = true;
      vmSpring.rvel.z += 2.5;
      vmSpring.vel.z += 0.5;
    }
  }

  const view = myWeaponView;
  if (view) {
    const [bx, by, bz] = view.userData.basePosition || [0.3, -0.25, -0.9];
    const [ax, ay, az] = view.userData.adsPosition || [0, -0.15, -0.7];
    const free = 1 - ads * 0.88; // how much loose motion survives while aiming
    const t = now / 1000;

    let x = THREE.MathUtils.lerp(bx, ax, ads);
    let y = THREE.MathUtils.lerp(by, ay, ads);
    let z = THREE.MathUtils.lerp(bz, az, ads);
    let rx = 0;
    let ry = (view.userData.baseYaw || 0) * (1 - ads);
    let rz = 0;

    // Figure-eight walk bob + idle breathing
    const bobK = bobAmp * free * (localPlayer.isSprinting ? 1.6 : 1);
    x += Math.sin(bobPhase) * 0.011 * bobK;
    y += -Math.abs(Math.cos(bobPhase)) * 0.01 * bobK + Math.sin(t * 1.7) * 0.0016 * free;
    rz += Math.sin(bobPhase) * 0.018 * bobK;
    ry += Math.cos(bobPhase) * 0.01 * bobK;
    rx += Math.sin(t * 1.7) * 0.004 * free;

    // Look sway (gun lags behind the view) and strafe tilt
    x -= vmSwayX * 0.6 * free;
    y += vmSwayY * 0.6 * free;
    ry += vmSwayX * 2.2 * free;
    rx += vmSwayY * 1.6 * free;
    rz -= vmTilt * 0.07 * free;
    x -= vmTilt * 0.008 * free;

    // Airborne float / landing dip
    if (!localPlayer.onGround && !localPlayer.flying) y += THREE.MathUtils.clamp(-localPlayer.vy * 0.004, -0.025, 0.03) * free;
    y -= cameraDip * 0.3;

    // ADS swing-in roll
    rz -= Math.sin(ads * Math.PI) * 0.06;

    // Crouch: gun tucks in slightly
    if (localPlayer.crouching) {
      x -= 0.008 * free;
      y -= 0.006 * free;
      rz += 0.04 * free;
    }

    // Tactical sprint: weapon canted and swung across the chest
    x += sprintT * 0.05;
    y -= sprintT * 0.05;
    z += sprintT * 0.03;
    rx -= sprintT * 0.32;
    ry += sprintT * 0.7;
    rz += sprintT * 0.3;

    // Reload pose
    y -= reloadEnv * 0.07;
    x -= reloadEnv * 0.03;
    rz += reloadEnv * 0.62;
    rx += reloadEnv * 0.22;
    ry -= reloadEnv * 0.18;

    // Close to a wall: muzzle up, gun pulled back
    z += wallT * 0.12;
    y -= wallT * 0.04;
    rx += wallT * 0.75;

    // Weapon switch raise and grenade/tablet lower
    y -= raiseT * raiseT * 0.35;
    rx -= raiseT * 0.6;
    rz += raiseT * 0.3;
    y -= grenadeLowerT * 0.45;
    rx -= grenadeLowerT * 0.4;

    // Springs (recoil + impulses)
    view.position.set(x + vmSpring.pos.x, y + vmSpring.pos.y, z + vmSpring.pos.z);
    view.rotation.set(rx + vmSpring.rot.x, ry + vmSpring.rot.y, rz + vmSpring.rot.z);
    const scoped = isSniper && adsProgress > 0.85;
    view.visible = !scoped && !dead;
    sniperScopeEl.classList.toggle('hidden', !scoped || dead);
  }

  if (view) {
    updateWeaponParts(view, dt, {
      reloadT: reload ? Math.min(1, (now - reload.start) / (reload.end - reload.start)) : null,
      magEmpty: ammoFor(key).mag <= 0,
      spinning: isFireHeld && key === 'chaingun' && canAct(),
    });
  }

  // Weapon FOV narrows slightly in ADS so the sights read larger, like CoD.
  viewmodel.setCameraFov(THREE.MathUtils.lerp(viewmodel.baseFov, viewmodel.baseFov * 0.82, ads));
  updateTablet(dt);
}

function updateCamera(dt, now) {
  const w = WEAPONS[currentKey()];
  if (localPlayer.landingImpact > 0.25) {
    cameraDip = Math.max(cameraDip, localPlayer.landingImpact * 0.14);
    sfx.playLanding(localPlayer.landingImpact);
  }
  localPlayer.landingImpact = 0;
  cameraDip = Math.max(0, cameraDip - dt * 0.6);

  cameraShake = Math.max(0, cameraShake - dt * 4);
  const shake = cameraShake * cameraShake;
  const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  strafeRoll += (-strafe * 0.012 - strafeRoll) * Math.min(1, dt * 6);

  const ads = adsProgress;
  const bobScale = (1 - ads * 0.8) * bobAmp;
  const headBobY = Math.sin(bobPhase * 2) * 0.028 * bobScale;
  const headBobX = Math.sin(bobPhase) * 0.018 * bobScale;
  const right = { x: Math.cos(localPlayer.angle), z: -Math.sin(localPlayer.angle) };
  // Idle breathing sway while aiming (stronger when scoped with a sniper,
  // steadier when crouched).
  const breath = ads * (currentKey() === 'awp' ? 0.0022 : 0.0008) * (localPlayer.crouching ? 0.5 : 1);
  const t = now / 1000;

  camera.position.set(
    localPlayer.x + right.x * headBobX,
    localPlayer.eyeHeight + headBobY - cameraDip,
    localPlayer.z + right.z * headBobX
  );
  camera.rotation.set(
    localPlayer.pitch + viewPunch + Math.sin(t * 1.3) * breath + (Math.random() - 0.5) * shake * 0.04,
    localPlayer.angle + Math.cos(t * 0.9) * breath + (Math.random() - 0.5) * shake * 0.04,
    strafeRoll + (Math.random() - 0.5) * shake * 0.03
  );

  const baseFov = verticalFov(settings.fov) + sprintT * 4;
  // Weapons' adsFov values are zoom factors relative to a base of 80.
  const zoom = w.adsFov / 80;
  const adsFov = Math.min(baseFov, (settings.adsFov === 'independent' ? verticalFov(90) : verticalFov(settings.fov)) * zoom);
  const fov = THREE.MathUtils.lerp(baseFov, adsFov, ads);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // Dynamic crosshair: the gap shows your real current bullet spread.
  const spread = currentSpread(w);
  const gapPx = (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (window.innerHeight / 2) + 3;
  setVar(crosshair, '--spread', `${Math.min(90, gapPx).toFixed(0)}px`);
  crosshair.classList.toggle('hidden', dead || ads > 0.35 || sprintT > 0.5 || !!tablet);
  // Holographic red-dot reticle while aiming (the AWP has its own scope).
  // Only for optics — iron sights are aimed with the real front post.
  const optic = currentKey() !== 'awp' && !myWeaponView?.userData.ironSights;
  setStyle(adsDot, 'opacity', !dead && optic ? Math.max(0, (ads - 0.6) / 0.4).toFixed(2) : '0');
}

const adsDot = document.createElement('div');
adsDot.style.cssText =
  'position:fixed;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;' +
  'background:#ff2a1a;box-shadow:0 0 4px 1px rgba(255,40,20,.85);pointer-events:none;z-index:20;opacity:0;';
document.body.appendChild(adsDot);

let footstepDist = 0;
let lastPos = { x: 0, z: 0 };
function updateFootsteps() {
  const moved = Math.hypot(localPlayer.x - lastPos.x, localPlayer.z - lastPos.z);
  lastPos = { x: localPlayer.x, z: localPlayer.z };
  if (!localPlayer.onGround || localPlayer.flying || moved > 3) return;
  footstepDist += moved;
  const stride = localPlayer.isSprinting ? 2.6 : 2.0;
  if (footstepDist > stride) {
    footstepDist = 0;
    sfx.playFootstep(null, localPlayer.crouching ? 0.3 : localPlayer.isSprinting ? 1 : 0.6, localPlayer.y > 0.3 ? 'metal' : 'grass');
  }
  for (const rp of Object.values(remotePlayers)) {
    if (rp.stepDist > 2.3) {
      rp.stepDist = 0;
      if (rp.crouching || rp.flying || rp.data.health <= 0) continue;
      const pos = new THREE.Vector3(rp.render.x, rp.render.y, rp.render.z);
      if (pos.distanceTo(camera.position) < 35) sfx.playFootstep(pos, rp.speed > 6 ? 1.1 : 0.8, rp.render.y > 0.3 ? 'metal' : 'grass');
    }
  }
}

function updateHud(dt, now) {
  const healthPct = Math.max(0, Math.min(100, localPlayer.health));
  setText(healthValueEl, Math.round(healthPct));
  setStyle(healthBarFillEl, 'width', `${Math.round(healthPct)}%`);
  setStyle(healthBarFillEl, 'background',
    healthPct > 50 ? 'linear-gradient(90deg, #2fce62, #8dff73)' : healthPct > 25 ? 'linear-gradient(90deg, #e88812, #ffe14a)' : 'linear-gradient(90deg, #c0392b, #e74c3c)');
  // Persistent red vignette at low health plus fading hit flashes.
  damageFlashLevel = Math.max(0, damageFlashLevel - dt * 1.2);
  const lowHealth = dead ? 0.6 : healthPct < 40 ? ((40 - healthPct) / 40) * 0.55 : 0;
  setStyle(damageFlash, 'opacity', Math.max(lowHealth, damageFlashLevel).toFixed(2));

  flyingIndicatorEl.classList.toggle('hidden', !localPlayer.flying);
  if (stanceEl) {
    setData(stanceEl, 'stance', localPlayer.flying ? 'fly' : !localPlayer.onGround ? 'airborne' : localPlayer.crouching ? 'crouch' : localPlayer.isSprinting ? 'sprint' : 'stand');
  }
  updateCompass(death?.replay ? camera.rotation.y : localPlayer.angle);
  updateWeaponHud();
  updateScoreboard();
  if (currentMapMode === 'zombies') updateZombiesHud();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    if (fpsCounterEl && settings.showFps) fpsCounterEl.textContent = `${Math.round(fpsFrames / fpsTime)} FPS`;
    fpsFrames = 0;
    fpsTime = 0;
  }
}

// --- Main loop --------------------------------------------------------
let lastTime = performance.now();
let lastNetworkSend = 0;
let lastPingSent = 0;

// Dynamic resolution: if the frame rate sags, render at a lower resolution
// (and as a last resort drop post-processing); scale back up when there's
// headroom. Keeps the game smooth on weaker GPUs without touching settings.
let perfTime = 0;
let shadowFrame = 0;
let perfFrames = 0;
function adaptResolution(frameSeconds) {
  perfTime += frameSeconds;
  perfFrames++;
  if (perfTime < 1.5) return;
  const fps = perfFrames / perfTime;
  perfTime = 0;
  perfFrames = 0;
  const max = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  const min = Math.min(0.55, max);
  let pr = renderer.getPixelRatio();
  if (fps < 48 && pr > min + 0.01) pr = Math.max(min, pr - 0.15);
  else if (fps < 40 && postFx) {
    postFx.dispose();
    postFx = null;
    console.info('[perf] post-processing disabled to keep the frame rate up');
    return;
  } else if (fps > 58 && pr < max - 0.01) pr = Math.min(max, pr + 0.1);
  else return;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  postFx?.setPixelRatio(pr);
  postFx?.setSize(window.innerWidth, window.innerHeight);
}

function loop(now) {
  if (!running) return;
  now = performance.now(); // one clock for everything (rAF timestamps can lag performance.now())
  adaptResolution(Math.max(0, now - lastTime) / 1000);
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

  world.update?.(dt, sat.active ? satCamera.position : camera.position);

  if (!dead) {
    recordHistory(now);
    if (canAct()) {
      localPlayer.aiming = isAds;
      const moveInput = { ...input, sprint: input.sprint && !isFireHeld && !isAds && !reload };
      localPlayer.update(dt, moveInput, world);
      checkSecretArea();
      updateCombat(dt, now);
    }
    updateViewmodel(dt, now);
    updateCamera(dt, now);
    updateFootsteps();
  } else if (death) {
    updateDeathCamera(now, dt);
  }

  // Remote players: interpolated, unless the killcam is replaying them.
  const renderT = now - INTERPOLATION_DELAY_MS;
  for (const rp of Object.values(remotePlayers)) {
    if (rp.replay) continue;
    interpolateRemote(rp, renderT);
    rp.model.animate(dt, rp.speed > 0.4, rp.crouching, rp.speed);
    if (rp.flying && rp.speed > 0.2) {
      spawnJetpackParticles(new THREE.Vector3(rp.render.x + (Math.random() - 0.5) * 0.25, rp.render.y + 0.15, rp.render.z + (Math.random() - 0.5) * 0.25));
    }
  }
  const nearestZombie = updateZombies(dt, now);
  if (world.night) updateNight(dt, now, nearestZombie);
  if (!dead && localPlayer.flying && (input.spaceHeld || localPlayer.isMoving)) {
    spawnJetpackParticles(new THREE.Vector3(localPlayer.x + (Math.random() - 0.5) * 0.25, localPlayer.y + 0.15, localPlayer.z + (Math.random() - 0.5) * 0.25));
  }

  updateRockets(dt);
  updateGrenades(dt, now);
  updateTracers(dt);
  updateParticles(dt);
  updateSprites(dt);
  if (muzzleFlashLight) muzzleFlashLight.intensity = Math.max(0, muzzleFlashLight.intensity - dt * 60);

  viewmodel.update(dt, camera, world, (pos, strength) => sfx.playShellTink(pos, strength));
  updateKillstreaks(dt, now);
  if (sat.active) updateSatView(now);

  // Shadow camera and light pool follow the viewer.
  const focus = sat.active ? satFocus.set(sat.x, 0, sat.z) : camera.position;
  const texel = (2 * (quality.shadowRange || 50)) / (quality.shadowMapSize || 2048);
  const sx = Math.round(focus.x / texel) * texel;
  const sz = Math.round(focus.z / texel) * texel;
  world.sun.target.position.set(sx, 0, sz);
  world.sun.position.set(sx + sunOffset.x, sunOffset.y, sz + sunOffset.z);
  lightPool?.update(dt, focus);
  sfx.setListener(focus, camera.getWorldDirection(new THREE.Vector3()));

  if (!dead && now - lastNetworkSend > NETWORK_SEND_INTERVAL_MS) {
    network.sendUpdate(localPlayer.x, localPlayer.y, localPlayer.z, localPlayer.angle, localPlayer.pitch, currentKey(), {
      crouching: localPlayer.crouching,
      speed: Math.round(localPlayer.speed * 10) / 10,
      flying: localPlayer.flying,
    });
    lastNetworkSend = now;
  }
  if (now - lastPingSent > 1000) {
    lastPingSent = now;
    network.send({ type: 'ping', t: now });
  }

  shadowFrame = (shadowFrame + 1) % 2;
  if (shadowFrame === 0) renderer.shadowMap.needsUpdate = true;
  if (sat.active) {
    renderer.render(scene, satCamera);
  } else {
    if (postFx) postFx.render(dt);
    else renderer.render(scene, camera);
    viewmodel.render(renderer);
  }
  renderMinimap(dt);
  updateHud(dt, now);

  requestAnimationFrame(loop);
}

buildCompass();

// --- Remembered settings + live server address detection -----------------
try {
  const saved = (k) => localStorage.getItem(k);
  if (saved('doom.playerName')) nameInput.value = saved('doom.playerName');
  if (saved('doom.serverAddress')) serverInput.value = saved('doom.serverAddress');
  if (WEAPON_ORDER.includes(saved('doom.weapon'))) selectedWeapon = saved('doom.weapon');
  if (SKIN_ORDER.includes(saved('doom.skin'))) selectedSkin = saved('doom.skin');
  if (ACCENT_ORDER.includes(saved('doom.accent'))) selectedAccent = saved('doom.accent');
  if (HEADGEAR_ORDER.includes(saved('doom.headgear'))) selectedHeadgear = saved('doom.headgear');
  if (MAP_ORDER.includes(saved('doom.map'))) selectedMap = saved('doom.map');
  if (saved('doom.playerTeam') && $('player-team')) $('player-team').value = saved('doom.playerTeam');
  if (saved('doom.friendlyFire') && $('friendly-fire')) $('friendly-fire').value = saved('doom.friendlyFire');
} catch (e) {
  console.warn('Storage access failed:', e);
}

if (!serverInput.value) serverInput.value = `ws://${location.hostname || 'localhost'}:${location.port || 3000}`;

buildLobbyCards();
// Build the detailed gun models in the background while you're in the menu,
// and photograph each one for the armory / HUD icons.
prewarmWeapons();
generateWeaponImages(selectedWeapon);
window.addEventListener('weapon-images-ready', () => {
  buildLobbyCards();
  shownWeaponKey = null; // refresh the HUD weapon icon
});

// The server locks the map to the first player in; anyone joining after that
// plays the map already running. Say so in the lobby instead of silently
// dropping you onto a different map than the one you picked.
let serverActiveMap = null;
let serverRealPlayers = 0;
function updateMapLockNotice() {
  const el = document.getElementById('map-lock-notice') || (() => {
    const n = document.createElement('div');
    n.id = 'map-lock-notice';
    n.style.cssText = 'margin:0.5rem 0;padding:0.55rem 0.8rem;border-left:3px solid #f2a33a;background:rgba(242,163,58,0.1);font-size:0.85rem;line-height:1.35';
    mapCardsEl.parentElement.insertBefore(n, mapCardsEl);
    return n;
  })();
  if (!serverActiveMap || serverRealPlayers === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const running = MAPS[serverActiveMap]?.name || serverActiveMap;
  el.innerHTML =
    serverActiveMap === selectedMap
      ? `A match is running on <b>${running}</b> (${serverRealPlayers} player${serverRealPlayers === 1 ? '' : 's'}) — you'll join it.`
      : `A match is already running on <b>${running}</b> (${serverRealPlayers} player${serverRealPlayers === 1 ? '' : 's'}), so you'll join <b>${running}</b>, not ${MAPS[selectedMap]?.name}. ` +
        `To play ${MAPS[selectedMap]?.name}, close every other game tab/window (or restart the server) and wait a few seconds.`;
}
mapCardsEl.addEventListener('click', () => setTimeout(updateMapLockNotice, 0));
setInterval(async () => {
  if (lobby.classList.contains('hidden')) return;
  try {
    const info = await (await fetch('/api/server-info')).json();
    serverActiveMap = info.activeMap;
    serverRealPlayers = info.realPlayers || 0;
    updateMapLockNotice();
  } catch {
    // server unreachable — the connect error explains it
  }
}, 3000);

(async function showConnectionInfo() {
  try {
    const res = await fetch('/api/server-info');
    const info = await res.json();
    serverActiveMap = info.activeMap;
    serverRealPlayers = info.realPlayers || 0;
    updateMapLockNotice();
    const lines = [`<strong>This server's address(es):</strong>`];
    lines.push(`<code>ws://localhost:${info.port}</code> (same machine only)`);
    for (const { name, address, likelyVirtual } of info.localAddresses) {
      const note = likelyVirtual ? ` — <em>${name}, likely not reachable by a friend</em>` : ` — ${name}, use this for a friend on your Wi-Fi`;
      lines.push(`<code>ws://${address}:${info.port}</code>${note}`);
    }
    connectionInfoEl.innerHTML = lines.join('<br />');
  } catch {
    connectionInfoEl.textContent = "Couldn't detect this server's address automatically — see README.md.";
  }
})();
