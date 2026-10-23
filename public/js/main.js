import * as THREE from 'three';
import { Network } from './network.js';
import { LocalPlayer } from './localPlayer.js';
import { buildWorld } from './world.js';
import { createPlayerModel } from './playerModel.js';
import { createWeaponView } from './weaponView.js';
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
  SECRET_REWARD,
  KILL_REWARD,
  ZOMBIE_KILL_REWARD,
  BUY_STATIONS,
  UPGRADE_BENCHES,
  INTERACT_RADIUS,
  MOUSE_SENSITIVITY,
  MAX_PITCH,
  NETWORK_SEND_INTERVAL_MS,
} from './constants.js';

// --- DOM references ---------------------------------------------------
const lobby = document.getElementById('lobby');
const lobbyForm = document.getElementById('lobby-form');
const nameInput = document.getElementById('player-name');
const serverInput = document.getElementById('server-address');
const connectionInfoEl = document.getElementById('connection-info');
const statusEl = document.getElementById('lobby-status');
const weaponCardsEl = document.getElementById('weapon-cards');
const skinSwatchesEl = document.getElementById('skin-swatches');
const accentSwatchesEl = document.getElementById('accent-swatches');
const headgearCardsEl = document.getElementById('headgear-cards');
const mapCardsEl = document.getElementById('map-cards');

const gameContainer = document.getElementById('game-container');
const hud = document.getElementById('hud');
const healthValueEl = document.getElementById('health-value');
const weaponNameEl = document.getElementById('weapon-name');
const secretsValueEl = document.getElementById('secrets-value');
const playersListEl = document.getElementById('players-list');
const bannerEl = document.getElementById('banner');
const crosshair = document.getElementById('crosshair');
const damageFlash = document.getElementById('damage-flash');
const clickOverlay = document.getElementById('click-overlay');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');
const moneyValueEl = document.getElementById('money-value');
const fuelBarFillEl = document.getElementById('fuel-bar-fill');
const interactPromptEl = document.getElementById('interact-prompt');
const inventoryOverlay = document.getElementById('inventory-overlay');
const inventoryMoneyEl = document.getElementById('inventory-money');
const inventoryListEl = document.getElementById('inventory-list');
const zombieHudEl = document.getElementById('zombie-hud');
const roundValueEl = document.getElementById('round-value');
const zombiesRemainingValueEl = document.getElementById('zombies-remaining-value');
const zombieKillsValueEl = document.getElementById('zombie-kills-value');

// --- Lobby selection state ----------------------------------------------
let selectedWeapon = WEAPON_ORDER[0];
let selectedSkin = SKIN_ORDER[0];
let selectedAccent = ACCENT_ORDER[0];
let selectedHeadgear = HEADGEAR_ORDER[0];
let selectedMap = MAP_ORDER[0];

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function buildLobbyCards() {
  weaponCardsEl.innerHTML = '';
  for (const key of WEAPON_ORDER) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (key === selectedWeapon ? ' selected' : '');
    card.textContent = WEAPONS[key].name;
    card.addEventListener('click', () => {
      selectedWeapon = key;
      buildLobbyCards();
    });
    weaponCardsEl.appendChild(card);
  }

  skinSwatchesEl.innerHTML = '';
  for (const skin of SKINS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (skin.id === selectedSkin ? ' selected' : '');
    sw.style.background = hex(skin.color);
    sw.title = skin.name;
    sw.addEventListener('click', () => {
      selectedSkin = skin.id;
      buildLobbyCards();
    });
    skinSwatchesEl.appendChild(sw);
  }

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
}
buildLobbyCards();

// --- Input ----------------------------------------------------------------
const input = { forward: false, backward: false, left: false, right: false, sprint: false, jump: false, jetpack: false };
let isFireHeld = false;
let weaponIndex = 0;
let cheatBuffer = '';
let currentNearby = null; // the buy station / upgrade bench currently in range, if any
let inventoryOpen = false;

const CHEAT_MESSAGES = {
  iddqd: 'DEGREELESSNESS MODE ON',
  idkfa: 'ARMS DEALER MODE — EVERYTHING YOU NEED',
  idclip: 'NO CLIPPING MODE ON',
};

window.addEventListener('keydown', (e) => {
  setKey(e.code, true);
  if (!running) return;

  if (e.code === 'Tab') {
    e.preventDefault();
    toggleInventory();
    return;
  }

  const pointerLocked = renderer && document.pointerLockElement === renderer.domElement;

  if (e.code === 'KeyE' && pointerLocked) {
    tryInteract();
  }

  if (pointerLocked && /^[a-z]$/i.test(e.key)) {
    cheatBuffer = (cheatBuffer + e.key.toLowerCase()).slice(-6);
    for (const code of Object.keys(CHEAT_MESSAGES)) {
      if (cheatBuffer.endsWith(code)) {
        showBanner(CHEAT_MESSAGES[code], 2000);
        cheatBuffer = '';
        break;
      }
    }
  }
});
window.addEventListener('keyup', (e) => setKey(e.code, false));

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
      input.jump = value;
      break;
    case 'KeyF':
      input.jetpack = value;
      break;
    case 'Digit1':
      if (value) switchWeapon(0);
      break;
    case 'Digit2':
      if (value) switchWeapon(1);
      break;
    case 'Digit3':
      if (value) switchWeapon(2);
      break;
    case 'Digit4':
      if (value) switchWeapon(3);
      break;
    default:
      break;
  }
}

document.addEventListener('wheel', (e) => {
  if (!renderer || document.pointerLockElement !== renderer.domElement) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  switchWeapon((weaponIndex + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length);
});

function switchWeapon(index) {
  if (index < 0 || index >= WEAPON_ORDER.length || !camera || !localPlayer) return;
  const key = WEAPON_ORDER[index];
  if (!localPlayer.ownedWeapons.includes(key)) {
    showBanner(`${WEAPONS[key].name} not purchased yet`, 1200);
    return;
  }
  weaponIndex = index;
  if (myWeaponView) camera.remove(myWeaponView);
  myWeaponView = createWeaponView(key);
  camera.add(myWeaponView);
}

// Applies the upgrade bench's damage/fire-rate multipliers, if this
// weapon has been upgraded.
function getWeaponStats(weaponKey) {
  const base = WEAPONS[weaponKey];
  if (!localPlayer?.weaponUpgrades[weaponKey]) return base;
  return {
    ...base,
    damage: Math.round(base.damage * base.upgradeDamageMultiplier),
    fireCooldownMs: Math.round(base.fireCooldownMs * base.upgradeFireRateMultiplier),
  };
}

clickOverlay.addEventListener('click', () => {
  renderer?.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
  if (renderer && document.pointerLockElement === renderer.domElement && localPlayer) {
    localPlayer.rotateYaw(e.movementX, MOUSE_SENSITIVITY);
    localPlayer.rotatePitch(e.movementY, MOUSE_SENSITIVITY, MAX_PITCH);
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && renderer && document.pointerLockElement === renderer.domElement) {
    isFireHeld = true;
    shoot();
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) isFireHeld = false;
});

document.addEventListener('pointerlockchange', () => {
  const locked = renderer && document.pointerLockElement === renderer.domElement;
  clickOverlay.classList.toggle('hidden', !!locked);
  if (!locked) isFireHeld = false;
});

window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Banner (secrets, frags, cheat codes) ---------------------------------
let bannerHideTimeout = null;
function showBanner(text, durationMs = 2500) {
  bannerEl.textContent = text;
  bannerEl.style.opacity = '1';
  clearTimeout(bannerHideTimeout);
  bannerHideTimeout = setTimeout(() => {
    bannerEl.style.opacity = '0';
  }, durationMs);
}

function flashDamage() {
  damageFlash.style.opacity = '0.45';
  setTimeout(() => {
    damageFlash.style.opacity = '0';
  }, 200);
}

// --- Secret area ------------------------------------------------------
let secretFound = false;
function checkSecretArea() {
  if (secretFound || !localPlayer) return;
  const { x0, z0, x1, z1 } = SECRET_AREA;
  if (localPlayer.x >= x0 && localPlayer.x <= x1 && localPlayer.z >= z0 && localPlayer.z <= z1) {
    secretFound = true;
    secretsValueEl.textContent = '1';
    localPlayer.money += SECRET_REWARD;
    showBanner(`A secret is revealed! +$${SECRET_REWARD}`);
  }
}

// --- Buy stations & upgrade bench ----------------------------------------
// Money and purchases are tracked locally on `localPlayer` — see the
// economy note in constants.js for why that's an intentional simplicity
// choice, not an oversight.
function findNearbyInteractable() {
  if (!localPlayer) return null;
  for (const station of BUY_STATIONS) {
    if (Math.hypot(localPlayer.x - station.x, localPlayer.z - station.z) < INTERACT_RADIUS) {
      return { type: 'buy', station };
    }
  }
  for (const bench of UPGRADE_BENCHES) {
    if (Math.hypot(localPlayer.x - bench.x, localPlayer.z - bench.z) < INTERACT_RADIUS) {
      return { type: 'upgrade', bench };
    }
  }
  return null;
}

function updateInteractPrompt() {
  currentNearby = findNearbyInteractable();
  if (!currentNearby) {
    interactPromptEl.classList.add('hidden');
    return;
  }

  if (currentNearby.type === 'buy') {
    const weapon = WEAPONS[currentNearby.station.weapon];
    if (localPlayer.ownedWeapons.includes(currentNearby.station.weapon)) {
      interactPromptEl.textContent = `${weapon.name} — already owned`;
    } else {
      const afford = localPlayer.money >= weapon.price ? '' : ' (not enough money)';
      interactPromptEl.textContent = `[E] Buy ${weapon.name} — $${weapon.price}${afford}`;
    }
  } else {
    const key = WEAPON_ORDER[weaponIndex];
    const weapon = WEAPONS[key];
    if (localPlayer.weaponUpgrades[key]) {
      interactPromptEl.textContent = `${weapon.name} — already upgraded`;
    } else {
      const afford = localPlayer.money >= weapon.upgradeCost ? '' : ' (not enough money)';
      interactPromptEl.textContent = `[E] Upgrade ${weapon.name} — $${weapon.upgradeCost}${afford}`;
    }
  }
  interactPromptEl.classList.remove('hidden');
}

function tryInteract() {
  if (!currentNearby || !localPlayer) return;

  if (currentNearby.type === 'buy') {
    const weaponKey = currentNearby.station.weapon;
    if (localPlayer.ownedWeapons.includes(weaponKey)) return;
    const price = WEAPONS[weaponKey].price;
    if (localPlayer.money < price) {
      showBanner('Not enough money!', 1200);
      return;
    }
    localPlayer.money -= price;
    localPlayer.ownedWeapons.push(weaponKey);
    showBanner(`${WEAPONS[weaponKey].name} purchased!`, 1800);
  } else {
    const key = WEAPON_ORDER[weaponIndex];
    if (localPlayer.weaponUpgrades[key]) return;
    const weapon = WEAPONS[key];
    if (localPlayer.money < weapon.upgradeCost) {
      showBanner('Not enough money!', 1200);
      return;
    }
    localPlayer.money -= weapon.upgradeCost;
    localPlayer.weaponUpgrades[key] = true;
    showBanner(`${weapon.name} upgraded!`, 1800);
  }
}

// --- Inventory overlay (Tab) ---------------------------------------------
function toggleInventory() {
  if (!localPlayer) return;
  inventoryOpen = !inventoryOpen;

  if (inventoryOpen) {
    renderInventory();
    inventoryOverlay.classList.remove('hidden');
    clickOverlay.classList.add('hidden');
    interactPromptEl.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    inventoryOverlay.classList.add('hidden');
    clickOverlay.classList.remove('hidden');
  }
}

function renderInventory() {
  inventoryMoneyEl.textContent = localPlayer.money;
  inventoryListEl.innerHTML = WEAPON_ORDER.map((key, i) => {
    const w = WEAPONS[key];
    const owned = localPlayer.ownedWeapons.includes(key);
    const upgraded = !!localPlayer.weaponUpgrades[key];
    const equipped = i === weaponIndex;
    const status = owned ? (upgraded ? 'Upgraded' : 'Owned') : `Locked — $${w.price}`;
    return `<li class="${equipped ? 'equipped' : ''}${owned ? '' : ' locked'}" data-index="${i}"><strong>${w.name}</strong><span>${status}</span></li>`;
  }).join('');

  for (const li of inventoryListEl.querySelectorAll('li')) {
    li.addEventListener('click', () => {
      const i = Number(li.dataset.index);
      if (localPlayer.ownedWeapons.includes(WEAPON_ORDER[i])) {
        switchWeapon(i);
        toggleInventory();
      }
    });
  }
}

// --- Three.js state --------------------------------------------------
let renderer = null;
let camera = null;
let scene = null;
let world = null;
let localPlayer = null;
let network = null;
let myId = null;
let myWeaponView = null;
let remotePlayers = {}; // id -> { data, model }
let zombieEntities = {}; // id -> { data, model }
let currentMapMode = 'pvp'; // 'pvp' or 'zombies', set from the locked-in map
let running = false;
const raycaster = new THREE.Raycaster();

let lastShotTime = -Infinity;
let recoilT = 0;
let bobPhase = 0;
let bobAmp = 0;

// --- Shooting -------------------------------------------------------------
function shoot() {
  if (!localPlayer || !network || !camera) return;

  const weapon = getWeaponStats(WEAPON_ORDER[weaponIndex]);
  const now = performance.now();
  if (now - lastShotTime < weapon.fireCooldownMs) return;
  lastShotTime = now;

  const origin = camera.getWorldPosition(new THREE.Vector3());
  const baseDir = camera.getWorldDirection(new THREE.Vector3());
  const damageByTargetId = new Map();

  for (let i = 0; i < weapon.pellets; i++) {
    const dir = baseDir.clone();
    if (weapon.spread > 0) {
      dir.x += (Math.random() - 0.5) * weapon.spread;
      dir.y += (Math.random() - 0.5) * weapon.spread;
      dir.z += (Math.random() - 0.5) * weapon.spread;
      dir.normalize();
    }

    raycaster.set(origin, dir);
    raycaster.far = 120;

    // Zombies mode has no friendly fire: only zombies are valid targets.
    // PvP maps only ever target other players.
    const targets =
      currentMapMode === 'zombies'
        ? Object.values(zombieEntities).filter((z) => z.data.health > 0)
        : Object.values(remotePlayers).filter((rp) => rp.data.health > 0);

    const hits = raycaster.intersectObjects(targets.map((t) => t.model.hitbox), false);
    if (hits.length > 0) {
      const targetId = hits[0].object.userData.playerId ?? hits[0].object.userData.zombieId;
      damageByTargetId.set(targetId, (damageByTargetId.get(targetId) || 0) + weapon.damage);
    }
  }

  network.sendShoot();
  for (const [targetId, damage] of damageByTargetId) {
    if (currentMapMode === 'zombies') {
      network.sendZombieHit(targetId, damage);
    } else {
      network.sendHit(targetId, damage);
    }
  }

  recoilT = 1;
}

function updateWeaponBob(dt) {
  if (!myWeaponView) return;
  const target = localPlayer.isMoving ? 1 : 0;
  bobAmp += (target - bobAmp) * Math.min(1, dt * 8);
  if (localPlayer.isMoving) bobPhase += dt * (input.sprint ? 12 : 8);
  recoilT = Math.max(0, recoilT - dt * 6);

  const bx = Math.sin(bobPhase) * 0.03 * bobAmp;
  const by = Math.abs(Math.sin(bobPhase)) * 0.02 * bobAmp;
  myWeaponView.position.set(0.35 + bx, -0.3 + by, -0.6 + recoilT * 0.08);
}

// --- Remote players -----------------------------------------------------
function addRemotePlayer(p) {
  const skin = SKINS.find((s) => s.id === p.skin) || SKINS[0];
  const accent = ACCENTS.find((a) => a.id === p.accent) || ACCENTS[0];
  const model = createPlayerModel(skin.color, p.name, { accentColor: accent.color, headgear: p.headgear || 'none' });
  model.hitbox.userData.playerId = p.id;
  model.setPosition(p.x, p.y || 0, p.z, p.angle || 0);
  model.setAirborne((p.y || 0) > 0.15);
  scene.add(model.group);
  remotePlayers[p.id] = { data: { ...p, y: p.y || 0 }, model, moving: false };
}

function removeRemotePlayer(id) {
  const rp = remotePlayers[id];
  if (!rp) return;
  scene.remove(rp.model.group);
  rp.model.dispose();
  delete remotePlayers[id];
}

// --- Zombies (co-op mode) -------------------------------------------------
function addZombie(z) {
  const model = createPlayerModel(0x4a5a3a, 'Zombie', { isZombie: true });
  model.hitbox.userData.zombieId = z.id;
  model.setPosition(z.x, 0, z.z, 0);
  scene.add(model.group);
  zombieEntities[z.id] = { data: { ...z }, model, moving: true };
}

function removeZombie(id) {
  const z = zombieEntities[id];
  if (!z) return;
  scene.remove(z.model.group);
  z.model.dispose();
  delete zombieEntities[id];
}

function updateZombiesHud() {
  if (currentMapMode !== 'zombies') return;
  zombiesRemainingValueEl.textContent = `Zombies: ${Object.keys(zombieEntities).length}`;
  zombieKillsValueEl.textContent = `Your kills: ${localPlayer.zombieKills}`;
}

// --- HUD / scoreboard ---------------------------------------------------
function updateScoreboard() {
  const all = [{ name: localPlayer.name, health: localPlayer.health, score: localPlayer.score, you: true }];
  for (const rp of Object.values(remotePlayers)) {
    all.push({ name: rp.data.name, health: rp.data.health, score: rp.data.score || 0, you: false });
  }
  all.sort((a, b) => b.score - a.score);

  playersListEl.innerHTML = all
    .map((p) => `<li class="${p.you ? 'you' : ''}">${p.name}${p.you ? ' (you)' : ''} — ${p.score} kills — ${Math.max(0, Math.round(p.health))} HP</li>`)
    .join('');
}

function renderMinimap() {
  const half = world.bounds + 1.5;
  const scale = minimap.width / (half * 2);
  minimapCtx.fillStyle = '#1b1b1b';
  minimapCtx.fillRect(0, 0, minimap.width, minimap.height);

  minimapCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  for (const c of world.collidables) {
    minimapCtx.beginPath();
    minimapCtx.arc((c.x + half) * scale, (c.z + half) * scale, Math.max(1, c.radius * scale), 0, Math.PI * 2);
    minimapCtx.fill();
  }

  for (const rp of Object.values(remotePlayers)) {
    if (rp.data.health <= 0) continue;
    minimapCtx.fillStyle = '#e74c3c';
    minimapCtx.beginPath();
    minimapCtx.arc((rp.data.x + half) * scale, (rp.data.z + half) * scale, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  for (const z of Object.values(zombieEntities)) {
    if (z.data.health <= 0) continue;
    minimapCtx.fillStyle = '#8bc34a';
    minimapCtx.beginPath();
    minimapCtx.arc((z.data.x + half) * scale, (z.data.z + half) * scale, 2, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  minimapCtx.fillStyle = '#fff';
  minimapCtx.beginPath();
  minimapCtx.arc((localPlayer.x + half) * scale, (localPlayer.z + half) * scale, 3, 0, Math.PI * 2);
  minimapCtx.fill();
}

// --- Match start/stop ---------------------------------------------------
function startMatch(msg, name) {
  myId = msg.id;
  currentMapMode = MAPS[msg.map]?.mode || 'pvp';

  const built = buildWorld(msg.map);
  scene = built.scene;
  world = built;

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft shadow edges instead of jagged hard ones
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // real contrast/highlight rolloff instead of flat, washed-out default colors
  renderer.toneMappingExposure = 1.05;
  renderer.setSize(window.innerWidth, window.innerHeight);
  gameContainer.innerHTML = '';
  gameContainer.appendChild(renderer.domElement);

  localPlayer = new LocalPlayer(msg.self.x, msg.self.z, msg.self.angle || 0);
  localPlayer.name = name;
  localPlayer.health = msg.self.health;
  localPlayer.score = msg.self.score;

  weaponIndex = Math.max(0, WEAPON_ORDER.indexOf(msg.self.weapon));
  localPlayer.ownedWeapons = [WEAPON_ORDER[weaponIndex]]; // your lobby pick is free; the rest must be bought
  myWeaponView = createWeaponView(WEAPON_ORDER[weaponIndex]);
  camera.add(myWeaponView);

  remotePlayers = {};
  for (const p of msg.players) {
    if (p.id !== myId) addRemotePlayer(p);
  }

  zombieEntities = {};
  localPlayer.zombieKills = 0;
  if (currentMapMode === 'zombies') {
    for (const z of msg.zombies || []) addZombie(z);
    roundValueEl.textContent = `ROUND ${msg.zombieRound || 1}`;
    zombieHudEl.classList.remove('hidden');
  } else {
    zombieHudEl.classList.add('hidden');
  }

  secretFound = false;
  secretsValueEl.textContent = '0';

  lobby.classList.add('hidden');
  hud.classList.remove('hidden');
  gameContainer.classList.remove('hidden');
  clickOverlay.classList.remove('hidden');
  crosshair.classList.remove('hidden');
  minimap.classList.remove('hidden');

  lastTime = performance.now();
  running = true;
  requestAnimationFrame(loop);
}

function endMatch() {
  running = false;
  if (document.pointerLockElement) document.exitPointerLock();

  lobby.classList.remove('hidden');
  hud.classList.add('hidden');
  gameContainer.classList.add('hidden');
  clickOverlay.classList.add('hidden');
  crosshair.classList.add('hidden');
  minimap.classList.add('hidden');
  interactPromptEl.classList.add('hidden');
  inventoryOverlay.classList.add('hidden');
  inventoryOpen = false;
  zombieHudEl.classList.add('hidden');

  for (const id of Object.keys(remotePlayers)) removeRemotePlayer(Number(id));
  for (const id of Object.keys(zombieEntities)) removeZombie(id);
  if (renderer) {
    renderer.dispose();
    gameContainer.innerHTML = '';
  }
  renderer = null;
  camera = null;
  scene = null;
}

// --- Connection flow --------------------------------------------------
lobbyForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const address = serverInput.value.trim();
  const name = (nameInput.value.trim() || 'Player').slice(0, 16);

  if (!address) {
    statusEl.textContent = 'Enter a server address first.';
    return;
  }

  statusEl.textContent = 'Connecting...';

  network = new Network({
    onWelcome: (msg) => startMatch(msg, name),
    onJoin: (p) => {
      if (p.id !== myId && scene) addRemotePlayer(p);
    },
    onLeave: (id) => removeRemotePlayer(id),
    onUpdate: (msg) => {
      const rp = remotePlayers[msg.id];
      if (rp) {
        const movedDist = Math.hypot(msg.x - rp.data.x, msg.z - rp.data.z);
        rp.moving = movedDist > 0.02;
        rp.data.x = msg.x;
        rp.data.y = msg.y || 0;
        rp.data.z = msg.z;
        rp.data.angle = msg.angle;
        rp.model.setPosition(msg.x, msg.y || 0, msg.z, msg.angle);
        rp.model.setAirborne((msg.y || 0) > 0.15);
      }
    },
    onShoot: () => {
      // Reserved for remote muzzle-flash / sound effects.
    },
    onHealth: (msg) => {
      if (msg.id === myId) {
        localPlayer.health = msg.health;
        flashDamage();
      } else if (remotePlayers[msg.id]) {
        remotePlayers[msg.id].data.health = msg.health;
        if (msg.health <= 0) remotePlayers[msg.id].model.setVisible(false);
      }
    },
    onKill: (msg) => {
      const killerName = msg.killerId === myId ? localPlayer.name : remotePlayers[msg.killerId]?.data.name || 'Someone';
      const victimName = msg.victimId === myId ? localPlayer.name : remotePlayers[msg.victimId]?.data.name || 'someone';

      if (msg.killerId === myId) {
        localPlayer.score = msg.killerScore;
        localPlayer.money += KILL_REWARD;
      } else if (remotePlayers[msg.killerId]) {
        remotePlayers[msg.killerId].data.score = msg.killerScore;
      }

      if (msg.victimId === myId) showBanner(`${killerName} fragged you!`);
      else if (msg.killerId === myId) showBanner(`You fragged ${victimName}!`);
    },
    onRespawn: (msg) => {
      if (msg.id === myId) {
        localPlayer.x = msg.x;
        localPlayer.z = msg.z;
        localPlayer.y = 0;
        localPlayer.vy = 0;
        localPlayer.health = msg.health;
      } else if (remotePlayers[msg.id]) {
        const rp = remotePlayers[msg.id];
        rp.data.x = msg.x;
        rp.data.z = msg.z;
        rp.data.y = 0;
        rp.data.health = msg.health;
        rp.model.setPosition(msg.x, 0, msg.z, rp.data.angle || 0);
        rp.model.setAirborne(false);
        rp.model.setVisible(true);
      }
    },
    onRoundStart: (msg) => {
      roundValueEl.textContent = `ROUND ${msg.round}`;
      showBanner(`ROUND ${msg.round}`, 2200);
    },
    onRoundClear: (msg) => {
      showBanner(`Round ${msg.round} cleared! Next round in ${Math.round(msg.nextInMs / 1000)}s`, 3000);
    },
    onZombieTick: (msg) => {
      for (const z of msg.zombies) {
        const existing = zombieEntities[z.id];
        if (existing) {
          const dx = z.x - existing.data.x;
          const dz = z.z - existing.data.z;
          const movedDist = Math.hypot(dx, dz);
          existing.moving = movedDist > 0.01;
          // Face the direction of travel (yaw 0 looks toward -Z, so the
          // forward vector is (-sin(yaw), -cos(yaw)) — solve for yaw).
          const angle = movedDist > 0.01 ? Math.atan2(-dx, -dz) : existing.data.angle || 0;
          existing.data.x = z.x;
          existing.data.z = z.z;
          existing.data.health = z.health;
          existing.data.angle = angle;
          existing.model.setPosition(z.x, 0, z.z, angle);
        } else {
          addZombie(z);
        }
      }
      updateZombiesHud();
    },
    onZombieHealth: (msg) => {
      if (zombieEntities[msg.id]) zombieEntities[msg.id].data.health = msg.health;
    },
    onZombieDeath: (msg) => {
      removeZombie(msg.id);
      if (msg.killerId === myId) {
        localPlayer.money += ZOMBIE_KILL_REWARD;
        localPlayer.zombieKills += 1;
      }
      updateZombiesHud();
    },
    onDisconnect: () => {
      statusEl.textContent = 'Disconnected from server.';
      endMatch();
    },
  });

  try {
    await network.connect(address, {
      name,
      weapon: selectedWeapon,
      skin: selectedSkin,
      accent: selectedAccent,
      headgear: selectedHeadgear,
      mapPreference: selectedMap,
    });
    statusEl.textContent = '';

    try {
      localStorage.setItem('doom.playerName', name);
      localStorage.setItem('doom.serverAddress', address);
      localStorage.setItem('doom.weapon', selectedWeapon);
      localStorage.setItem('doom.skin', selectedSkin);
      localStorage.setItem('doom.accent', selectedAccent);
      localStorage.setItem('doom.headgear', selectedHeadgear);
      localStorage.setItem('doom.map', selectedMap);
    } catch {
      // Storage can be unavailable (private browsing, etc.) — not critical.
    }
  } catch {
    const safeAddress = address.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    statusEl.innerHTML =
      `Could not reach <code>${safeAddress}</code>. Check: the host's server is ` +
      `running (<code>npm start</code>), the address matches exactly (including ` +
      `the port), you're both on the same Wi-Fi or the port is forwarded, and ` +
      `Windows Firewall isn't blocking Node.js.`;
  }
});

// --- Main loop --------------------------------------------------------
let lastTime = performance.now();
let lastNetworkSend = 0;

function loop(now) {
  if (!running) return;

  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // Pause gameplay input while the inventory is open, but keep rendering
  // (the world stays visible behind the overlay).
  if (!inventoryOpen) {
    localPlayer.update(dt, input, world);
    checkSecretArea();
    updateInteractPrompt();

    if (isFireHeld && WEAPONS[WEAPON_ORDER[weaponIndex]].auto) {
      shoot();
    }
  }

  camera.position.set(localPlayer.x, localPlayer.eyeHeight, localPlayer.z);
  camera.rotation.y = localPlayer.angle;
  camera.rotation.x = localPlayer.pitch;

  updateWeaponBob(dt);

  for (const rp of Object.values(remotePlayers)) {
    rp.model.animate(dt, rp.moving);
  }
  for (const z of Object.values(zombieEntities)) {
    z.model.animate(dt, z.moving);
  }

  if (!inventoryOpen && now - lastNetworkSend > NETWORK_SEND_INTERVAL_MS) {
    network.sendUpdate(localPlayer.x, localPlayer.y, localPlayer.z, localPlayer.angle);
    lastNetworkSend = now;
  }

  renderer.render(scene, camera);
  renderMinimap();

  healthValueEl.textContent = Math.max(0, Math.round(localPlayer.health));
  moneyValueEl.textContent = localPlayer.money;
  fuelBarFillEl.style.width = `${Math.max(0, Math.min(100, localPlayer.jetpackFuel))}%`;
  const upgraded = localPlayer.weaponUpgrades[WEAPON_ORDER[weaponIndex]];
  weaponNameEl.textContent = WEAPONS[WEAPON_ORDER[weaponIndex]].name + (upgraded ? ' (Upgraded)' : '');
  updateScoreboard();
  if (currentMapMode === 'zombies') updateZombiesHud();

  requestAnimationFrame(loop);
}

// --- Remembered settings + live server address detection -----------------
try {
  const savedName = localStorage.getItem('doom.playerName');
  const savedAddress = localStorage.getItem('doom.serverAddress');
  const savedWeapon = localStorage.getItem('doom.weapon');
  const savedSkin = localStorage.getItem('doom.skin');
  const savedAccent = localStorage.getItem('doom.accent');
  const savedHeadgear = localStorage.getItem('doom.headgear');
  const savedMap = localStorage.getItem('doom.map');

  if (savedName) nameInput.value = savedName;
  serverInput.value = savedAddress || `ws://${location.hostname || 'localhost'}:3000`;
  if (savedWeapon && WEAPON_ORDER.includes(savedWeapon)) selectedWeapon = savedWeapon;
  if (savedSkin && SKIN_ORDER.includes(savedSkin)) selectedSkin = savedSkin;
  if (savedAccent && ACCENT_ORDER.includes(savedAccent)) selectedAccent = savedAccent;
  if (savedHeadgear && HEADGEAR_ORDER.includes(savedHeadgear)) selectedHeadgear = savedHeadgear;
  if (savedMap && MAP_ORDER.includes(savedMap)) selectedMap = savedMap;
  buildLobbyCards();
} catch {
  serverInput.value = `ws://${location.hostname || 'localhost'}:3000`;
}

(async function showConnectionInfo() {
  try {
    const res = await fetch('/api/server-info');
    const info = await res.json();

    const lines = [`<strong>This server's address(es):</strong>`];
    lines.push(`<code>ws://localhost:${info.port}</code> (same machine only)`);
    for (const { name, address, likelyVirtual } of info.localAddresses) {
      const note = likelyVirtual
        ? ` — <em>${name}, likely not reachable by a friend</em>`
        : ` — ${name}, use this for a friend on your Wi-Fi`;
      lines.push(`<code>ws://${address}:${info.port}</code>${note}`);
    }
    connectionInfoEl.innerHTML = lines.join('<br />');
  } catch {
    connectionInfoEl.textContent = "Couldn't detect this server's address automatically — see README.md.";
  }
})();
