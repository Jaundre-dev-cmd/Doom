import * as THREE from 'three';
import { Network } from './network.js';
import { LocalPlayer } from './localPlayer.js';
import { buildWorld } from './world.js';
import { createPlayerModel } from './playerModel.js';
import { createWeaponView } from './weaponView.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Bulletproof modulo/lerp angle wrap-around solver
function lerpAngle(a, b, t) {
  const diff = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + diff * t;
}

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
  NETWORK_SEND_INTERVAL_MS,
  ROCKET_SPEED,
  ROCKET_MAX_RANGE,
  ROCKET_EXPLOSION_RADIUS,
  ROCKET_COLLISION_RADIUS,
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
const healthBarFillEl = document.getElementById('health-bar-fill');
const weaponNameEl = document.getElementById('weapon-name');
const secretsValueEl = document.getElementById('secrets-value');
const playersListEl = document.getElementById('players-list');
const bannerEl = document.getElementById('banner');
const crosshair = document.getElementById('crosshair');
const damageFlash = document.getElementById('damage-flash');
const clickOverlay = document.getElementById('click-overlay');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');
const squadCountEl = document.getElementById('squad-count');
const compassStrip = document.getElementById('compass-strip');
const pingValueEl = document.getElementById('ping-value');
const pingBarsEl = document.getElementById('ping-bars');
const ammoMagEl = document.getElementById('ammo-mag');
const ammoReserveEl = document.getElementById('ammo-reserve');
const weaponIconEl = document.getElementById('weapon-icon');
const flyingIndicatorEl = document.getElementById('flying-indicator');
const inventoryOverlay = document.getElementById('inventory-overlay');
const inventoryCloseButton = document.getElementById('inventory-close');
const inventoryListEl = document.getElementById('inventory-list');
const helpOverlay = document.getElementById('help-overlay');
const helpCloseButton = document.getElementById('help-close');
const zombieHudEl = document.getElementById('zombie-hud');
const roundValueEl = document.getElementById('round-value');
const zombiesRemainingValueEl = document.getElementById('zombies-remaining-value');
const zombieKillsValueEl = document.getElementById('zombie-kills-value');

const WEAPONS_STATS = {
  pistol: {
    damage: 28,
    firerate: 45,
    precision: 85,
    auto: false,
    desc: "Reliable semi-automatic tactical sidearm. Low recoil and solid baseline accuracy."
  },
  shotgun: {
    damage: 90,
    firerate: 15,
    precision: 20,
    auto: false,
    desc: "Heavy pump-action shotgun. Fires a cluster of devastating high-velocity pellets at close range."
  },
  chaingun: {
    damage: 12,
    firerate: 100,
    precision: 65,
    auto: true,
    desc: "Rapid-fire multi-barrel machine gun. Holds down a wall of suppressing fire with high recoil."
  },
  rocket: {
    damage: 82,
    firerate: 12,
    precision: 75,
    auto: false,
    desc: "Heavy-ordinance missile platform. Fires explosive projectiles that deal massive area-of-effect damage."
  },
  ak47: {
    damage: 32,
    firerate: 95,
    precision: 55,
    auto: true,
    desc: "High-power automatic assault rifle. Extreme stopping power but heavy muzzle rise under sustained fire."
  },
  m4a1: {
    damage: 25,
    firerate: 80,
    precision: 75,
    auto: true,
    desc: "Tactical silenced carbine. Highly accurate, compact, and extremely controllable."
  },
  mp5: {
    damage: 15,
    firerate: 90,
    precision: 60,
    auto: true,
    desc: "Submachine gun with integrated suppressor. Blazing fast fire rate with zero visual flash."
  },
  awp: {
    damage: 100,
    firerate: 8,
    precision: 100,
    auto: false,
    desc: "High-caliber heavy sniper rifle. Deals devastating damage with pin-point accuracy. Scopes on right-click!"
  }
};

// --- Lobby selection state ----------------------------------------------
let selectedWeapon = WEAPON_ORDER[0];
let selectedSkin = SKIN_ORDER[0];
let selectedAccent = ACCENT_ORDER[0];
let selectedHeadgear = HEADGEAR_ORDER[0];
let selectedMap = MAP_ORDER[0];
let lobbyPreviewRenderer = null;
let lobbyPreviewScene = null;
let lobbyPreviewCamera = null;
let lobbyPreviewModel = null;
let lobbyPreviewLastFrame = 0;

function updateLobbyCharacterPreview() {
  const stage = document.getElementById('operator-preview-stage');
  const loadoutEl = document.getElementById('operator-preview-loadout');
  if (!stage || !loadoutEl) return;

  const skin = SKINS.find((item) => item.id === selectedSkin);
  const accent = ACCENTS.find((item) => item.id === selectedAccent);
  const headgear = HEADGEAR.find((item) => item.id === selectedHeadgear);
  const weapon = WEAPONS[selectedWeapon];
  if (!skin || !accent || !headgear || !weapon) {
    throw new Error('Unable to render the selected operator loadout.');
  }

  if (!lobbyPreviewRenderer) {
    try {
      lobbyPreviewScene = new THREE.Scene();
      lobbyPreviewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
      lobbyPreviewCamera.position.set(1.6, 1.8, -4.1);
      lobbyPreviewCamera.lookAt(0, 1, 0);

      lobbyPreviewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      lobbyPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      lobbyPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      lobbyPreviewRenderer.domElement.setAttribute('aria-label', '3D preview of the selected operator');
      stage.replaceChildren(lobbyPreviewRenderer.domElement);

      lobbyPreviewScene.add(new THREE.HemisphereLight(0xe7edf4, 0x282a2c, 2.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(-3, 5, -4);
      lobbyPreviewScene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xe5bd64, 1.2);
      rimLight.position.set(3, 2, 3);
      lobbyPreviewScene.add(rimLight);

      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.68, 0.12, 32),
        new THREE.MeshStandardMaterial({ color: 0x343536, metalness: 0.55, roughness: 0.55 })
      );
      platform.position.y = -0.08;
      lobbyPreviewScene.add(platform);

      const resizePreview = () => {
        if (!lobbyPreviewRenderer || !lobbyPreviewCamera) return;
        const { width, height } = stage.getBoundingClientRect();
        if (width <= 0 || height <= 0) return;
        lobbyPreviewRenderer.setSize(width, height, false);
        lobbyPreviewCamera.aspect = width / height;
        lobbyPreviewCamera.updateProjectionMatrix();
      };
      new ResizeObserver(resizePreview).observe(stage);
      resizePreview();

      lobbyPreviewRenderer.setAnimationLoop((time) => {
        if (!lobbyPreviewScene || lobby.classList.contains('hidden')) return;
        const delta = lobbyPreviewLastFrame ? Math.min((time - lobbyPreviewLastFrame) / 1000, 0.05) : 0;
        lobbyPreviewLastFrame = time;
        if (lobbyPreviewModel) {
          lobbyPreviewModel.group.rotation.y = Math.sin(time / 1800) * 0.16;
          lobbyPreviewModel.animate(delta, false);
        }
        lobbyPreviewRenderer.render(lobbyPreviewScene, lobbyPreviewCamera);
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      stage.textContent = `Character preview unavailable: ${detail}`;
      stage.classList.add('preview-error');
      console.error('Failed to initialize the lobby character preview:', error);
      return;
    }
  }

  if (lobbyPreviewModel) {
    lobbyPreviewScene.remove(lobbyPreviewModel.group);
    lobbyPreviewModel.dispose();
  }
  lobbyPreviewModel = createPlayerModel(skin.color, '', { accentColor: accent.color, headgear: selectedHeadgear });
  const nameTag = lobbyPreviewModel.group.children.find((child) => child.isSprite);
  if (nameTag) nameTag.visible = false;
  lobbyPreviewScene.add(lobbyPreviewModel.group);
  loadoutEl.textContent = `${weapon.name} · ${headgear.name}`;
}

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function buildLobbyCards() {
  const weaponIcons = {
    pistol: '🔫',
    shotgun: '💥',
    chaingun: '⚙',
    rocket: '🚀',
    ak47: '🔫',
    m4a1: '🎯',
    mp5: '🔫',
    awp: '🔭',
  };

  weaponCardsEl.innerHTML = '';
  for (const key of WEAPON_ORDER) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card weapon-card' + (key === selectedWeapon ? ' selected' : '');
    const icon = document.createElement('span');
    icon.className = 'weapon-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = weaponIcons[key] || '▰';
    const label = document.createElement('span');
    label.className = 'weapon-card-label';
    label.textContent = WEAPONS[key].name;
    card.append(icon, label);
    card.addEventListener('click', () => {
      selectedWeapon = key;
      buildLobbyCards();
      updateLobbyCharacterPreview();
    });
    weaponCardsEl.appendChild(card);
  }
  updateArmoryStatsPanel();

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
      updateLobbyCharacterPreview();
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
      updateLobbyCharacterPreview();
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
      updateLobbyCharacterPreview();
    });
    headgearCardsEl.appendChild(card);
  }

  mapCardsEl.innerHTML = '';
  for (const key of MAP_ORDER) {
    const m = MAPS[key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `card map-card map-${key}` + (key === selectedMap ? ' selected' : '');
    const title = document.createElement('span');
    title.className = 'map-card-title';
    title.textContent = m.name;
    const description = document.createElement('span');
    description.className = 'map-card-description';
    description.textContent = m.description;
    card.append(title, description);
    card.addEventListener('click', () => {
      selectedMap = key;
      buildLobbyCards();
    });
    mapCardsEl.appendChild(card);
  }
}
buildLobbyCards();

// --- Input ----------------------------------------------------------------
const input = { forward: false, backward: false, left: false, right: false, sprint: false, spaceHeld: false };
let isFireHeld = false;
let weaponIndex = 0;
let cheatBuffer = '';
let inventoryOpen = false;
let helpOpen = false;

// Double-tap-to-toggle-flight state, for Space specifically (F has no
// other purpose, so it toggles flight on a single press — no double-tap
// needed there).
let lastSpaceTapTime = -Infinity;
const DOUBLE_TAP_WINDOW_MS = 300;

const CHEAT_MESSAGES = {
  iddqd: 'DEGREELESSNESS MODE ON',
  idkfa: 'ARMS DEALER MODE — EVERYTHING YOU NEED',
  idclip: 'NO CLIPPING MODE ON',
};

window.addEventListener('keydown', (e) => {
  if (killCamActive) return;
  setKey(e.code, true);

  // Flight: unlimited, no fuel. Space does double duty — hold it to climb
  // while already flying, double-tap it to toggle flying on/off. F always
  // toggles flying on a single press (it has no other job, so there's no
  // tap/double-tap ambiguity to resolve there). `e.repeat` guards against
  // the browser's key-repeat firing this dozens of times while held.
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault(); // stop Space from scrolling the page
    if (running && localPlayer) {
      const now = performance.now();
      if (now - lastSpaceTapTime < DOUBLE_TAP_WINDOW_MS) {
        localPlayer.flying = !localPlayer.flying;
        lastSpaceTapTime = -Infinity; // consumed, so a third quick tap doesn't re-toggle again
      } else {
        lastSpaceTapTime = now;
      }
    }
  }
  if (e.code === 'KeyF' && !e.repeat && running && localPlayer) {
    localPlayer.flying = !localPlayer.flying;
  }

  // Quick-switch straight to the rocket launcher — a faster way to reach
  // it than cycling through 1-8/scroll (every weapon is already equippable).
  if (e.code === 'KeyT' && !e.repeat && running && localPlayer) {
    switchWeapon(WEAPON_ORDER.indexOf('rocket'));
  }

  if (!running) return;

  if (e.code === 'Tab') {
    e.preventDefault();
    toggleInventory();
    return;
  }

  if (e.code === 'KeyI' && !e.repeat && running && localPlayer) {
    e.preventDefault();
    toggleHelp();
    return;
  }

  if (e.code === 'KeyU' && !e.repeat && running && localPlayer) {
    e.preventDefault();
    toggleWeapons();
    return;
  }

  const pointerLocked = renderer && document.pointerLockElement === renderer.domElement;

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
window.addEventListener('keyup', (e) => {
  if (killCamActive) {
    for (const key in input) {
      if (typeof input[key] === 'boolean') input[key] = false;
    }
    return;
  }
  setKey(e.code, false);
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
      // Held state only, for "climb while flying" — the toggle-on/off
      // part (double-tap) is handled separately in the keydown listener,
      // which needs e.repeat/timing info this generic dispatcher doesn't have.
      input.spaceHeld = value;
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
    case 'Digit5':
      if (value) switchWeapon(4);
      break;
    case 'Digit6':
      if (value) switchWeapon(5);
      break;
    case 'Digit7':
      if (value) switchWeapon(6);
      break;
    case 'Digit8':
      if (value) switchWeapon(7);
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

// Async because real .glb weapons (AK-47, M4A1, MP5, AWP) have to be
// fetched and parsed the first time they're equipped — see weaponView.js.
// Callers don't need to await this; it updates the viewmodel whenever the
// load finishes. The `requestedIndex` guard discards a stale load if the
// player switches weapons again before this one finishes loading.
async function switchWeapon(index) {
  if (index < 0 || index >= WEAPON_ORDER.length || !camera || !localPlayer) return;
  
  // Scope out immediately if we switch weapons
  if (isScoped) {
    isScoped = false;
    targetFov = 75;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    const scopeEl = document.getElementById('sniper-scope');
    if (scopeEl) scopeEl.classList.add('hidden');
    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl) crosshairEl.classList.remove('hidden');
  }

  const key = WEAPON_ORDER[index];
  weaponIndex = index;
  const requestedIndex = index;
  const newView = await createWeaponView(key);
  if (weaponIndex !== requestedIndex || !camera) return; // superseded by another switch (or match ended) meanwhile
  if (myWeaponView) camera.remove(myWeaponView);
  myWeaponView = newView;
  camera.add(myWeaponView);
  if (myWeaponView) {
    myWeaponView.visible = !(isScoped && key === 'awp');
  }
}

// clickOverlay click event removed so we handle lock in document mousedown to support right-click during aiming lock seamlessly

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (killCamActive) return;
  if (renderer && document.pointerLockElement === renderer.domElement && localPlayer) {
    localPlayer.rotateYaw(e.movementX, MOUSE_SENSITIVITY);
    localPlayer.rotatePitch(e.movementY, MOUSE_SENSITIVITY, MAX_PITCH);
  }
});

document.addEventListener('mousedown', (e) => {
  if (killCamActive) return;
  // If pointer lock is already active, handle firing/scoping actions
  if (renderer && document.pointerLockElement === renderer.domElement) {
    if (e.button === 0) {
      isFireHeld = true;
      shoot();
    } else if (e.button === 2) {
      // Aim with any gun!
      isScoped = true;
      const isSniper = (WEAPON_ORDER[weaponIndex] === 'awp');
      targetFov = isSniper ? 15 : 40; // Sniper gets deep zoom, other weapons get iron-sights zoom

      const scopeEl = document.getElementById('sniper-scope');
      if (isSniper && scopeEl) {
        scopeEl.classList.remove('hidden');
      }

      if (myWeaponView) {
        myWeaponView.visible = !isSniper; // Hide for sniper overlay, keep visible for ADS
      }

      const crosshairEl = document.getElementById('crosshair');
      if (crosshairEl) {
        crosshairEl.classList.add('hidden'); // Hide center crosshair to focus on physical gun sights
      }
    }
  } else {
    // If pointer lock is not active, allow left/right clicks on the canvas to lock it
    if (renderer && (e.target === renderer.domElement || e.target.id === 'click-overlay' || e.target.closest('#click-overlay'))) {
      renderer.domElement.requestPointerLock();
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (killCamActive) return;
  if (e.button === 0) {
    isFireHeld = false;
  } else if (e.button === 2) {
    // Release sniper scope zoom
    if (isScoped) {
      isScoped = false;
      targetFov = 75; // Return to wide view
      const scopeEl = document.getElementById('sniper-scope');
      if (scopeEl) scopeEl.classList.add('hidden');
      if (myWeaponView) myWeaponView.visible = true;
      const crosshairEl = document.getElementById('crosshair');
      if (crosshairEl) crosshairEl.classList.remove('hidden');
    }
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = renderer && document.pointerLockElement === renderer.domElement;
  clickOverlay.classList.toggle('hidden', !!locked);
  if (!locked) {
    isFireHeld = false;
    // Release zoom if pointer lock is lost
    if (isScoped) {
      isScoped = false;
      targetFov = 75;
      if (camera) {
        camera.fov = 75;
        camera.updateProjectionMatrix();
      }
      const scopeEl = document.getElementById('sniper-scope');
      if (scopeEl) scopeEl.classList.add('hidden');
      if (myWeaponView) myWeaponView.visible = true;
      const crosshairEl = document.getElementById('crosshair');
      if (crosshairEl) crosshairEl.classList.remove('hidden');
    }
  }
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
// A nod to classic Doom's "Secrets: x/y" stat — purely a discovery
// bragging-right, no currency attached to it.
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

// --- Inventory overlay (Tab) ---------------------------------------------
// Every weapon is already unlocked and fully kitted out for everyone —
// this is just a quick-switch list, not a shop.
function toggleInventory() {
  if (!localPlayer) return;
  if (helpOpen) toggleHelp(); // Close help if open
  if (weaponsOpen) toggleWeapons(); // Close weapons if open
  inventoryOpen = !inventoryOpen;

  if (inventoryOpen) {
    renderInventory();
    inventoryOverlay.classList.remove('hidden');
    clickOverlay.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    inventoryOverlay.classList.add('hidden');
    clickOverlay.classList.remove('hidden');
  }
}

inventoryCloseButton.addEventListener('click', () => {
  if (inventoryOpen) toggleInventory();
});

// --- Help & Controls overlay (i) ----------------------------------------
function toggleHelp() {
  if (!localPlayer) return;
  if (inventoryOpen) toggleInventory(); // Close inventory if open
  if (weaponsOpen) toggleWeapons(); // Close weapons if open
  helpOpen = !helpOpen;

  if (helpOpen) {
    helpOverlay.classList.remove('hidden');
    clickOverlay.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    helpOverlay.classList.add('hidden');
    clickOverlay.classList.remove('hidden');
  }
}

helpCloseButton.addEventListener('click', () => {
  if (helpOpen) toggleHelp();
});

// Short category tag shown on each weapon card — purely cosmetic labeling,
// doesn't affect gameplay stats.
const WEAPON_TAGS = {
  pistol: 'SIDEARM',
  shotgun: 'SHOTGUN',
  chaingun: 'LMG',
  rocket: 'HEAVY',
  ak47: 'RIFLE',
  m4a1: 'RIFLE',
  mp5: 'SMG',
  awp: 'SNIPER',
};

function renderInventory() {
  inventoryListEl.innerHTML = WEAPON_ORDER.map((key, i) => {
    const w = WEAPONS[key];
    const equipped = i === weaponIndex;

    return `
      <li class="${equipped ? 'equipped' : ''}" data-index="${i}">
        <div class="inv-item-top">
          <span class="inv-item-tag">${WEAPON_TAGS[key] || ''}</span>
          ${equipped ? '<span class="inv-badge equipped">EQUIPPED</span>' : '<span class="inv-badge owned">READY</span>'}
        </div>
        <div class="inv-item-name">${w.name}</div>
      </li>`;
  }).join('');

  for (const li of inventoryListEl.querySelectorAll('li')) {
    li.addEventListener('click', () => {
      switchWeapon(Number(li.dataset.index));
      toggleInventory();
    });
  }
}

// --- Home Page (Lobby) Tab Switching & Armory Stats -------------------
const navButtons = document.querySelectorAll('.nav-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    tabPanels.forEach(panel => panel.classList.remove('active'));
    const targetId = btn.dataset.tab;
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  });
});

function updateArmoryStatsPanel() {
  const stats = WEAPONS_STATS[selectedWeapon];
  if (!stats) return;
  
  const nameEl = document.getElementById('stat-weapon-name');
  const barDmgEl = document.getElementById('stat-bar-damage');
  const valDmgEl = document.getElementById('stat-val-damage');
  const barRateEl = document.getElementById('stat-bar-firerate');
  const valRateEl = document.getElementById('stat-val-firerate');
  const barPrecEl = document.getElementById('stat-bar-precision');
  const valPrecEl = document.getElementById('stat-val-precision');
  const valAutoEl = document.getElementById('stat-val-auto');
  const descEl = document.getElementById('stat-weapon-desc');
  
  if (nameEl) nameEl.textContent = WEAPONS[selectedWeapon].name;
  if (barDmgEl) barDmgEl.style.width = `${stats.damage}%`;
  if (valDmgEl) valDmgEl.textContent = stats.damage;
  if (barRateEl) barRateEl.style.width = `${stats.firerate}%`;
  if (valRateEl) valRateEl.textContent = stats.firerate;
  if (barPrecEl) barPrecEl.style.width = `${stats.precision}%`;
  if (valPrecEl) valPrecEl.textContent = stats.precision;
  if (valAutoEl) valAutoEl.textContent = stats.auto ? 'YES' : 'NO';
  if (descEl) descEl.textContent = stats.desc;
}

// --- Right-Click Scoping & Tracer State ------------------------------
let isScoped = false;
let targetFov = 75;
let weaponsOpen = false;
const tracers = [];

// --- AAA Visual Effects (VFX) System ---------------------------------
let cameraShake = 0;
let muzzleFlashLight = null;
let activeParticles = [];
let activeDecals = [];
const MAX_DECALS = 40;
let staticMeshes = [];

let sparkGeometry = null;
let sparkMaterial = null;
let bloodGeometry = null;
let bloodMaterial = null;
let jetpackGeometry = null;
let jetpackMaterial = null;
let decalGeometry = null;
let decalMaterial = null;

let hitmarkerEl = null;
let hitmarkerTimeout = null;

function initSharedVFX() {
  if (sparkGeometry) return; // already initialized
  
  sparkGeometry = new THREE.BoxGeometry(0.04, 0.04, 0.04);
  sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa11,
    toneMapped: false, // emissive/bright bypasses tone mapper
  });
  
  bloodGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  bloodMaterial = new THREE.MeshBasicMaterial({
    color: 0x990000,
  });

  jetpackGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  jetpackMaterial = new THREE.MeshBasicMaterial({
    color: 0x00d0ff,
    toneMapped: false,
  });

  decalGeometry = new THREE.PlaneGeometry(0.08, 0.08);
  decalMaterial = new THREE.MeshBasicMaterial({
    color: 0x111111,
    side: THREE.DoubleSide,
    depthWrite: false, // reduces Z-fighting issues
    transparent: true,
    opacity: 0.85
  });
  
  hitmarkerEl = document.getElementById('hitmarker');
}

function collectStaticMeshes() {
  staticMeshes = [];
  scene.traverse((obj) => {
    // Only collect static, opaque world meshes. Exclude skies, helpers, or players
    if (obj.isMesh && obj.name !== 'skydome' && !obj.userData.playerId && !obj.userData.zombieId && obj.parent !== camera) {
      staticMeshes.push(obj);
    }
  });
  console.log(`[VFX] Compiled ${staticMeshes.length} static meshes for physics raycasting.`);
}

function spawnParticles(point, normal, color, count = 8, isBlood = false) {
  initSharedVFX();
  const geom = isBlood ? bloodGeometry : sparkGeometry;
  const mat = isBlood ? bloodMaterial : sparkMaterial;

  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(point);
    scene.add(mesh);

    // Initial velocity: spray out along the normal, with random spread
    const velocity = normal.clone().multiplyScalar(Math.random() * (isBlood ? 2.5 : 4.5) + 1.0);
    const right = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.x) > 0.9) right.set(0, 1, 0);
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();
    const rightVec = new THREE.Vector3().crossVectors(normal, up).normalize();

    const spread = isBlood ? 1.5 : 2.8;
    velocity.addScaledVector(up, (Math.random() - 0.5) * spread);
    velocity.addScaledVector(rightVec, (Math.random() - 0.5) * spread);

    activeParticles.push({
      mesh: mesh,
      velocity: velocity,
      life: 0,
      maxLife: Math.random() * 0.3 + 0.2, // 0.2 to 0.5s
      gravity: isBlood ? 12.0 : 16.0,
    });
  }
}

function spawnJetpackParticles(point) {
  initSharedVFX();
  const mesh = new THREE.Mesh(jetpackGeometry, jetpackMaterial);
  mesh.position.copy(point);
  scene.add(mesh);

  // Spray downward and outward
  const velocity = new THREE.Vector3(
    (Math.random() - 0.5) * 1.5,
    -Math.random() * 4.5 - 2.5,
    (Math.random() - 0.5) * 1.5
  );

  activeParticles.push({
    mesh: mesh,
    velocity: velocity,
    life: 0,
    maxLife: Math.random() * 0.15 + 0.1,
    gravity: 4.0,
  });
}

function spawnBulletDecal(point, normal) {
  initSharedVFX();
  const mesh = new THREE.Mesh(decalGeometry, decalMaterial);
  // Place decal on face, nudged slightly along normal to prevent visual flickering
  mesh.position.copy(point).addScaledVector(normal, 0.006);

  // Orient decal plane parallel to the hit surface normal
  const dummy = new THREE.Object3D();
  dummy.position.copy(mesh.position);
  dummy.lookAt(mesh.position.clone().add(normal));
  mesh.quaternion.copy(dummy.quaternion);

  scene.add(mesh);
  activeDecals.push(mesh);

  if (activeDecals.length > MAX_DECALS) {
    const oldest = activeDecals.shift();
    scene.remove(oldest);
  }
}

function updateParticles(dt) {
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      activeParticles.splice(i, 1);
    } else {
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      // Shrink over lifetime
      const scale = Math.max(0.01, 1 - p.life / p.maxLife);
      p.mesh.scale.set(scale, scale, scale);
    }
  }
}

function flashHitmarker() {
  if (!hitmarkerEl) hitmarkerEl = document.getElementById('hitmarker');
  if (!hitmarkerEl) return;

  hitmarkerEl.classList.remove('active');
  void hitmarkerEl.offsetWidth; // force browser reflow to restart animation
  hitmarkerEl.classList.add('active');

  if (hitmarkerTimeout) clearTimeout(hitmarkerTimeout);
  hitmarkerTimeout = setTimeout(() => {
    hitmarkerEl.classList.remove('active');
  }, 100);
}

const weaponsOverlay = document.getElementById('weapons-overlay');
const weaponsCloseButton = document.getElementById('weapons-close');
const weaponsManifestoGrid = document.getElementById('weapons-manifesto-grid');

function toggleWeapons() {
  if (!localPlayer) return;
  if (helpOpen) toggleHelp();
  if (inventoryOpen) toggleInventory();
  weaponsOpen = !weaponsOpen;

  if (weaponsOpen) {
    renderWeaponsManifesto();
    weaponsOverlay.classList.remove('hidden');
    clickOverlay.classList.add('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    weaponsOverlay.classList.add('hidden');
    clickOverlay.classList.remove('hidden');
  }
}

if (weaponsCloseButton) {
  weaponsCloseButton.addEventListener('click', () => {
    if (weaponsOpen) toggleWeapons();
  });
}

function renderWeaponsManifesto() {
  if (!weaponsManifestoGrid) return;
  weaponsManifestoGrid.innerHTML = WEAPON_ORDER.map((key, i) => {
    const w = WEAPONS[key];
    const stats = WEAPONS_STATS[key];
    const equipped = i === weaponIndex;

    return `
      <div class="weapon-info-item ${equipped ? 'equipped' : ''}" data-index="${i}">
        <div>
          <div class="weapon-info-name">${w.name}</div>
          <div class="weapon-info-tag">${WEAPON_TAGS[key] || 'FIREARM'}</div>
          <div class="weapon-info-desc">${stats.desc}</div>
        </div>
        <div class="weapon-info-stats">
          <div class="weapon-info-stat-row">
            <span>Damage</span>
            <div class="weapon-info-stat-bar-bg"><div class="weapon-info-stat-bar-fill" style="width: ${stats.damage}%"></div></div>
            <strong>${stats.damage}</strong>
          </div>
          <div class="weapon-info-stat-row">
            <span>Fire Rate</span>
            <div class="weapon-info-stat-bar-bg"><div class="weapon-info-stat-bar-fill" style="width: ${stats.firerate}%"></div></div>
            <strong>${stats.firerate}</strong>
          </div>
          <div class="weapon-info-stat-row">
            <span>Accuracy</span>
            <div class="weapon-info-stat-bar-bg"><div class="weapon-info-stat-bar-fill" style="width: ${stats.precision}%"></div></div>
            <strong>${stats.precision}</strong>
          </div>
          <div class="weapon-info-stat-row">
            <span>Auto-Fire</span>
            <strong>${stats.auto ? 'YES' : 'NO'}</strong>
          </div>
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

function spawnTracer(p1, p2, color = 0xffaa00) {
  if (!scene) return;
  const distance = p1.distanceTo(p2);
  const geometry = new THREE.CylinderGeometry(0.015, 0.015, distance, 4);
  geometry.rotateX(Math.PI / 2);
  
  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.8
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.lookAt(p2);
  scene.add(mesh);
  
  tracers.push({
    mesh: mesh,
    spawnTime: performance.now(),
    duration: 150
  });
}

function updateTracers() {
  const now = performance.now();
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    const age = now - t.spawnTime;
    if (age >= t.duration) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      tracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = 0.8 * (1 - age / t.duration);
    }
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

let mutantGltfBase = null;
let friendlyFireEnabled = true;
let playerHistory = []; // Sliding history buffer: array of { t, players }
let shotHistory = []; // Sliding history of shots: array of { t, id, weapon }
let killCamActive = false;
let killCamStartTime = 0;
const killCamDuration = 10000; // 10 seconds of playback
let killCamKillerId = null;
let killCamFrames = []; // Frames of interest for the playback
let killCamDeathPos = null; // Vec3 of player's death position for zombie/suicide orbit camera
let killCamWeaponView = null;
let currentKillCamWeaponKey = null;
let lastProcessedPlaybackTime = 0;
let killCamRecoilT = 0;
let adsProgress = 0; // 0 = hipfire, 1 = fully aimed down sights
const gltfLoader = new GLTFLoader();

gltfLoader.load('assets/characters/Mutant/3ndh7d9e7hez.gltf', (gltf) => {
  mutantGltfBase = gltf;
  console.log('[Zombies] Mutant 3D Model with animations loaded successfully!');
}, undefined, (err) => {
  console.error('[Zombies] Failed to load Mutant GLTF:', err);
});

let lastShotTime = -Infinity;
let recoilT = 0;
let bobPhase = 0;
let bobAmp = 0;

// --- Shooting -------------------------------------------------------------
function shoot() {
  if (!localPlayer || !network || !camera) return;

  const weaponKey = WEAPON_ORDER[weaponIndex];
  const weapon = WEAPONS[weaponKey];
  const now = performance.now();
  if (now - lastShotTime < weapon.fireCooldownMs) return;
  lastShotTime = now;
  spendRound(weaponKey);

  // Record shoot event in shot history
  if (!killCamActive) {
    shotHistory.push({ t: now, id: myId, weapon: weaponKey });
    while (shotHistory.length > 0 && now - shotHistory[0].t > 10000) {
      shotHistory.shift();
    }
  }

  const origin = camera.getWorldPosition(new THREE.Vector3());
  const baseDir = camera.getWorldDirection(new THREE.Vector3());

  // Trigger muzzle flash light
  if (muzzleFlashLight) {
    muzzleFlashLight.intensity = 6.0;
  }

  // Set camera screen shake based on weapon category
  cameraShake = Math.min(1.0, cameraShake + (weaponKey === 'awp' ? 0.6 : (weaponKey === 'shotgun' ? 0.45 : 0.18)));

  // The rocket launcher doesn't resolve damage instantly like every other
  // weapon — it spawns a real traveling projectile (see spawnRocket/
  // updateRockets below) that only explodes once it actually reaches
  // something.
  if (weaponKey === 'rocket') {
    spawnRocket(origin, baseDir, true);
    network.sendShoot();
    network.sendRocket(origin.x, origin.y, origin.z, baseDir.x, baseDir.y, baseDir.z);
    recoilT = 1;
    return;
  }

  const damageByTargetId = new Map();

  for (let i = 0; i < weapon.pellets; i++) {
    const dir = baseDir.clone();
    
    // Scoping/aiming with ANY weapon removes all random spread (or reduces it to perfect laser-like accuracy)
    const activeSpread = isScoped ? 0 : weapon.spread;
    if (activeSpread > 0) {
      dir.x += (Math.random() - 0.5) * activeSpread;
      dir.y += (Math.random() - 0.5) * activeSpread;
      dir.z += (Math.random() - 0.5) * activeSpread;
      dir.normalize();
    }

    raycaster.set(origin, dir);
    raycaster.far = 120;

    // Build target list of shootable entities.
    // If we are in zombies mode, zombies are always shootable.
    // Remote players and bots are also shootable if friendlyFireEnabled is true (default in FFA) or on opposite team.
    const targets = [];
    if (currentMapMode === 'zombies') {
      targets.push(...Object.values(zombieEntities).filter((z) => z.data.health > 0));
    }
    targets.push(...Object.values(remotePlayers).filter((rp) => rp.data.health > 0 && (friendlyFireEnabled || rp.data.team !== localPlayer.team)));

    const targetHitboxes = targets.map((t) => t.model.hitbox);
    const targetHits = raycaster.intersectObjects(targetHitboxes, false);
    const environmentHits = raycaster.intersectObjects(staticMeshes, true);

    let closestTargetDistance = Infinity;
    let closestTargetHit = null;
    if (targetHits.length > 0) {
      closestTargetHit = targetHits[0];
      closestTargetDistance = targetHits[0].distance;
    }

    let closestEnvDistance = Infinity;
    let closestEnvHit = null;
    if (environmentHits.length > 0) {
      closestEnvHit = environmentHits[0];
      closestEnvDistance = environmentHits[0].distance;
    }

    let endpoint = origin.clone().add(dir.clone().multiplyScalar(100));

    if (closestTargetDistance < closestEnvDistance) {
      // Hit a dynamic player/zombie target!
      const isZombie = closestTargetHit.object.userData.zombieId !== undefined;
      const targetId = isZombie ? closestTargetHit.object.userData.zombieId : closestTargetHit.object.userData.playerId;
      const key = `${isZombie ? 'zombie' : 'player'}:${targetId}`;
      damageByTargetId.set(key, (damageByTargetId.get(key) || 0) + weapon.damage);
      endpoint.copy(closestTargetHit.point);

      // Spawn bloody splash spraying back slightly or straight up
      const normal = new THREE.Vector3(0, 1, 0);
      spawnParticles(closestTargetHit.point, normal, 0xaa0000, 10, true);
      flashHitmarker();
    } else if (closestEnvHit) {
      // Hit a static wall/obstacle!
      endpoint.copy(closestEnvHit.point);

      // Transform local face normal into world space
      const normal = closestEnvHit.face
        ? closestEnvHit.face.normal.clone().transformDirection(closestEnvHit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);

      // Spawn bright spark particles along the face normal
      spawnParticles(closestEnvHit.point, normal, 0xffaa11, 8, false);

      // Spawn bullet hole decal on the wall
      spawnBulletDecal(closestEnvHit.point, normal);
    }

    // Spawn a beautiful 3D bullet tracer line
    let tracerColor = 0xffaa00; // default yellow/amber
    if (weaponKey === 'awp') {
      tracerColor = 0x00f0ff; // vibrant cyan for sniper!
    } else if (weaponKey === 'm4a1' || weaponKey === 'mp5') {
      tracerColor = 0x55ff77; // tactical light green for silenced weapons
    }
    
    // Calculate custom muzzle-offset for tracer origin
    let tracerOrigin = origin.clone();
    if (!isScoped) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
      tracerOrigin.add(right.multiplyScalar(0.22)).add(down.multiplyScalar(0.18));
    } else if (weaponKey !== 'awp') {
      // In ADS mode, tracers originate closer to the center since the gun is aligned
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
      tracerOrigin.add(down.multiplyScalar(0.15));
    }
    
    spawnTracer(tracerOrigin, endpoint, tracerColor);
  }

  network.sendShoot();
  for (const [key, damage] of damageByTargetId) {
    const [type, targetIdStr] = key.split(':');
    const targetId = Number(targetIdStr);
    if (type === 'zombie') {
      network.sendZombieHit(targetId, damage);
    } else {
      network.sendHit(targetId, damage);
    }
  }

  recoilT = 1;
}

// --- Rocket launcher: real projectile + area explosion ---------------------
// Everything else in this game is hitscan (instant hit, resolved the
// moment you click). The rocket is the one exception: it's a visible
// projectile that actually flies through the world at ROCKET_SPEED and
// only deals damage — in a radius, with falloff by distance — once it
// hits something. A rocket you fire is "local" (it's the authority on
// what it hits and reports hits/the explosion over the network); a
// rocket reported by another player is purely cosmetic here — it just
// flies until it hits static world geometry, since the shooter's own
// client already reported the real impact point via 'explosion'.
let activeRockets = [];
let activeExplosions = [];
const EXPLOSION_DURATION = 0.45; // seconds

function buildRocketMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a3f44,
    roughness: 0.5,
    metalness: 0.4,
    emissive: 0x552200,
    emissiveIntensity: 0.4,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), mat);
  body.rotation.x = Math.PI / 2; // capsule's long axis is Y by default; point it along local Z (forward)
  group.add(body);

  const glow = new THREE.PointLight(0xff8833, 1.8, 7, 2);
  glow.position.z = 0.25; // trails slightly behind the nose, like an engine flare
  group.add(glow);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.22, 6),
    new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85 })
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 0.32;
  group.add(flame);

  return group;
}

function spawnRocket(origin, dir, isLocal) {
  const mesh = buildRocketMesh();
  mesh.position.copy(origin);
  mesh.lookAt(origin.clone().add(dir));
  scene.add(mesh);
  activeRockets.push({ mesh, pos: origin.clone(), dir: dir.clone().normalize(), traveled: 0, isLocal });
}

// Static-geometry impact test shared by local and remote rockets: a
// coarse circle+Y-range check against the same `world.collidables` list
// the local player collides with, plus the ground plane at y = 0.
function findStaticImpact(point) {
  for (const c of world.collidables) {
    const dx = point.x - c.x;
    const dz = point.z - c.z;
    const minDist = c.radius + ROCKET_COLLISION_RADIUS;
    if (dx * dx + dz * dz > minDist * minDist) continue;
    const minY = c.minY ?? -Infinity;
    const maxY = c.maxY ?? Infinity;
    if (point.y >= minY && point.y <= maxY) return point.clone();
  }
  if (point.y <= 0) return new THREE.Vector3(point.x, 0, point.z);
  return null;
}

function updateRockets(dt) {
  for (let i = activeRockets.length - 1; i >= 0; i--) {
    const r = activeRockets[i];
    const stepDist = ROCKET_SPEED * dt;
    const to = r.pos.clone().addScaledVector(r.dir, stepDist);
    let impact = null;

    // Only a local rocket can hit a living target — a remote rocket is
    // cosmetic, and the shooter's own 'explosion' message is what tells
    // every client the real impact point.
    if (r.isLocal) {
      const targets =
        currentMapMode === 'zombies'
          ? Object.values(zombieEntities).filter((z) => z.data.health > 0)
          : Object.values(remotePlayers).filter((rp) => rp.data.health > 0 && (friendlyFireEnabled || rp.data.team !== localPlayer.team));
      raycaster.set(r.pos, r.dir);
      raycaster.far = stepDist;
      const hits = raycaster.intersectObjects(targets.map((t) => t.model.hitbox), false);
      if (hits.length > 0) impact = hits[0].point.clone();
    }

    if (!impact) impact = findStaticImpact(to);

    r.traveled += stepDist;

    if (impact) {
      detonateRocket(r, impact);
      scene.remove(r.mesh);
      activeRockets.splice(i, 1);
      continue;
    }

    if (r.traveled >= ROCKET_MAX_RANGE) {
      scene.remove(r.mesh);
      activeRockets.splice(i, 1);
      continue;
    }

    r.pos.copy(to);
    r.mesh.position.copy(to);
  }
}

function detonateRocket(rocket, point) {
  spawnExplosion(point);
  if (!rocket.isLocal) return;

  const weapon = WEAPONS.rocket;
  const targets = [];
  if (currentMapMode === 'zombies') {
    for (const z of Object.values(zombieEntities).filter((z) => z.data.health > 0)) {
      targets.push({ entity: z, isZombie: true });
    }
  }
  for (const rp of Object.values(remotePlayers).filter((rp) => rp.data.health > 0 && (friendlyFireEnabled || rp.data.team !== localPlayer.team))) {
    targets.push({ entity: rp, isZombie: false });
  }

  for (const t of targets) {
    const ent = t.entity;
    const centerY = (ent.data.y || 0) + 0.92; // roughly chest height — see playerModel.js's hitbox offset
    const dist = point.distanceTo(new THREE.Vector3(ent.data.x, centerY, ent.data.z));
    if (dist > ROCKET_EXPLOSION_RADIUS) continue;
    const damage = Math.max(1, Math.round(weapon.damage * (1 - dist / ROCKET_EXPLOSION_RADIUS)));
    if (t.isZombie) {
      network.sendZombieHit(ent.data.id, damage);
    } else {
      network.sendHit(ent.data.id, damage);
    }
  }

  network.sendExplosion(point.x, point.y, point.z);
}

function spawnExplosion(point) {
  const group = new THREE.Group();
  group.position.copy(point);

  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  group.add(blast);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  group.add(core);

  const flash = new THREE.PointLight(0xff8833, 6, 18, 2);
  group.add(flash);

  scene.add(group);
  activeExplosions.push({ group, blast, core, flash, age: 0 });
}

function updateExplosions(dt) {
  for (let i = activeExplosions.length - 1; i >= 0; i--) {
    const ex = activeExplosions[i];
    ex.age += dt;
    const t = Math.min(1, ex.age / EXPLOSION_DURATION);

    ex.blast.scale.setScalar(THREE.MathUtils.lerp(0.2, ROCKET_EXPLOSION_RADIUS * 0.85, Math.min(1, t * 1.6)));
    ex.blast.material.opacity = 0.9 * (1 - t);
    ex.core.scale.setScalar(THREE.MathUtils.lerp(0.4, 2.2, t));
    ex.core.material.opacity = Math.max(0, 1 - t * 2.2);
    ex.flash.intensity = 6 * (1 - t);

    if (ex.age >= EXPLOSION_DURATION) {
      scene.remove(ex.group);
      activeExplosions.splice(i, 1);
    }
  }
}

function updateWeaponBob(dt) {
  if (killCamActive) {
    if (!killCamWeaponView) return;
    killCamRecoilT = Math.max(0, killCamRecoilT - dt * 6);
    const [baseX, baseY, baseZ] = killCamWeaponView.userData.basePosition || [0.3, -0.25, -0.9];
    killCamWeaponView.position.set(baseX, baseY, baseZ + killCamRecoilT * 0.08);
    return;
  }

  if (!myWeaponView) return;
  const target = localPlayer.isMoving ? 1 : 0;
  bobAmp += (target - bobAmp) * Math.min(1, dt * 8);
  if (localPlayer.isMoving) bobPhase += dt * (input.sprint ? 12 : 8);
  recoilT = Math.max(0, recoilT - dt * 6);

  // Smoothly update ADS progress based on whether we are currently scoped with a non-sniper weapon
  const isSniper = (WEAPON_ORDER[weaponIndex] === 'awp');
  const targetAds = (isScoped && !isSniper) ? 1.0 : 0.0;
  adsProgress = THREE.MathUtils.lerp(adsProgress, targetAds, 14 * dt);

  // Heavily dampen viewmodel bobbing while Aiming Down Sights (ADS)
  const bx = Math.sin(bobPhase) * 0.03 * bobAmp * (1 - adsProgress * 0.85);
  const by = Math.abs(Math.sin(bobPhase)) * 0.02 * bobAmp * (1 - adsProgress * 0.85);
  
  const [baseX, baseY, baseZ] = myWeaponView.userData.basePosition || [0.3, -0.25, -0.9];

  // Target ADS coordinates (perfect center alignment for Iron Sights/Scope)
  const targetX = 0.0;
  const targetY = -0.15;
  const targetZ = -0.7; // Slide slightly closer to eye depth

  // Blend from hip-fire position to ADS position based on adsProgress
  const currentX = THREE.MathUtils.lerp(baseX, targetX, adsProgress);
  const currentY = THREE.MathUtils.lerp(baseY, targetY, adsProgress);
  const currentZ = THREE.MathUtils.lerp(baseZ, targetZ, adsProgress);

  myWeaponView.position.set(currentX + bx, currentY + by, currentZ + recoilT * 0.08);
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
function createMutantZombieModel(z) {
  // If the model hasn't loaded yet, fall back gracefully to the original blocky zombie
  if (!mutantGltfBase) {
    return createPlayerModel(0x4a5a3a, 'Zombie', { isZombie: true });
  }

  // Clone the character model skeleton and hierarchy
  const clonedGroup = SkeletonUtils.clone(mutantGltfBase.scene);

  // Auto-scale the model so its vertical size matches the game standard height
  const box = new THREE.Box3().setFromObject(clonedGroup);
  const size = new THREE.Vector3();
  box.getSize(size);
  const targetHeight = 1.95; // slightly larger/taller than players to feel intimidating!
  const scaleFactor = targetHeight / (size.y || 1);
  clonedGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);

  // Enable dynamic shadows on all nested meshes
  clonedGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      // Ensure materials are responsive to lighting
      if (child.material) {
        child.material.roughness = 0.85;
      }
    }
  });

  // Create local skeletal animation mixer
  let mixer = null;
  let action = null;
  if (mutantGltfBase.animations && mutantGltfBase.animations.length > 0) {
    mixer = new THREE.AnimationMixer(clonedGroup);
    // Mixamo animations are typically embedded at index 0. Play it continuously
    action = mixer.clipAction(mutantGltfBase.animations[0]);
    action.play();
  }

  // Bounding box hitbox for precision shooting raycasting
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.85, 0.9),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  // Center the hitbox at chest height
  hitbox.position.y = 0.92;
  clonedGroup.add(hitbox);

  return {
    group: clonedGroup,
    hitbox,
    setPosition(x, y, z, angle) {
      clonedGroup.position.set(x, y || 0, z);
      clonedGroup.rotation.y = angle || 0;
    },
    animate(dt, moving) {
      if (mixer) {
        // Adjust animation speed slightly based on movement delta to look organic
        mixer.update(dt);
      }
    },
    dispose() {
      clonedGroup.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      hitbox.geometry.dispose();
      hitbox.material.dispose();
    }
  };
}

function addZombie(z) {
  const model = createMutantZombieModel(z);
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

// --- HUD ----------------------------------------------------------------
// Magazine | reserve shown on the weapon panel. Shooting still never
// runs dry — when a mag and its reserve are spent, both restock — so the
// readout moves without changing how the guns fire.
const AMMO_SPEC = {
  pistol: { mag: 12, reserve: 36 },
  shotgun: { mag: 8, reserve: 32 },
  chaingun: { mag: 80, reserve: 200 },
  rocket: { mag: 1, reserve: 4 },
  ak47: { mag: 30, reserve: 90 },
  m4a1: { mag: 30, reserve: 90 },
  mp5: { mag: 30, reserve: 120 },
  awp: { mag: 5, reserve: 20 },
};
const WEAPON_ICONS = {
  pistol: '<svg viewBox="0 0 68 36"><path fill="#f4f4f4" d="M3 12h36l3-4h20v7H44l-2 4H32v2h-7v11l-9 2-4-9v-6H3V12z"/></svg>',
  shotgun: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M1 15h44v5H30v3h-6v8h-7l-2-8v-3H1zm44-2h18v8H45z"/></svg>',
  chaingun: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M2 12h20v12H2zm20-3h8v18h-8zm8 4h26v10H30zm26-2h8v14h-8z"/></svg>',
  rocket: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M4 14h16v8H4zm16-4h24l12 8-12 8H20z"/></svg>',
  ak47: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M2 14h10l3 4h20l6-6h20v5H44l-4 5H28v7h-7l-3-7H12z"/></svg>',
  m4a1: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M6 15h32l4-5h18v5H44v4H34v8h-8l-3-8H6z"/></svg>',
  mp5: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M4 16h30l4-5h20v6H40v3H30v8h-8l-2-8H4z"/></svg>',
  awp: '<svg viewBox="0 0 68 36"><path fill="#f2f2f2" d="M1 16h48v4H28v2h-5v8h-6l-2-8v-2H1zm48-6h14v12H49z"/></svg>',
};
const ammoState = {};
let shownWeaponKey = null;
let scoreboardHtml = '';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function ammoFor(key) {
  const spec = AMMO_SPEC[key] || AMMO_SPEC.pistol;
  if (!ammoState[key]) ammoState[key] = { mag: spec.mag, reserve: spec.reserve };
  return ammoState[key];
}

function spendRound(key) {
  const spec = AMMO_SPEC[key] || AMMO_SPEC.pistol;
  const ammo = ammoFor(key);
  if (ammo.mag <= 0) {
    const take = Math.min(spec.mag, ammo.reserve);
    if (take <= 0) {
      ammo.mag = spec.mag;
      ammo.reserve = spec.reserve;
    } else {
      ammo.reserve -= take;
      ammo.mag = take;
    }
  }
  ammo.mag -= 1;
}

function updateWeaponHud() {
  const key = WEAPON_ORDER[weaponIndex];
  if (shownWeaponKey !== key) {
    shownWeaponKey = key;
    weaponIconEl.innerHTML = WEAPON_ICONS[key] || WEAPON_ICONS.pistol;
  }
  weaponNameEl.textContent = WEAPONS[key].name.toUpperCase();
  const ammo = ammoFor(key);
  ammoMagEl.textContent = ammo.mag;
  ammoReserveEl.textContent = ammo.reserve;
}

// Heading tape. Yaw 0 looks toward -Z, which this radar treats as north,
// and positive yaw turns right, so compass degrees match the player angle.
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

function updateCompass() {
  let heading = ((localPlayer.angle * 180) / Math.PI) % 360;
  if (heading < 0) heading += 360;
  compassStrip.style.transform = `translateX(${-heading * COMPASS_PX}px)`;
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

// Kills only — health lives in the vitals panel. Squad count is filled
// slots over a 4-player roster, matching the panel in the HUD reference.
function updateScoreboard() {
  const all = [{ name: localPlayer.name, score: localPlayer.score, you: true }];
  for (const rp of Object.values(remotePlayers)) {
    all.push({ name: rp.data.name, score: rp.data.score || 0, you: false });
  }
  all.sort((a, b) => b.score - a.score);

  const html = all
    .map(
      (p) =>
        `<li class="${p.you ? 'you' : ''}"><span class="squad-name"><i class="squad-dot"></i>${escapeHtml(p.name)}${p.you ? ' (you)' : ''}</span><span class="squad-score">${p.score}</span></li>`
    )
    .join('');
  if (html !== scoreboardHtml) {
    scoreboardHtml = html;
    playersListEl.innerHTML = html;
  }
  squadCountEl.textContent = `${all.length}/${Math.max(4, all.length)}`;
}

// Player-centered, north-up radar. 100 units of world space is the drawn
// radius (the "100m" label). -Z is north, so world +z draws downward.
const RADAR_RANGE = 100;

function renderMinimap() {
  const size = minimap.width;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const scale = r / RADAR_RANGE;

  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.save();
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, r, 0, Math.PI * 2);
  minimapCtx.clip();

  minimapCtx.fillStyle = '#0c1018';
  minimapCtx.fillRect(0, 0, size, size);

  minimapCtx.strokeStyle = 'rgba(240, 160, 48, 0.28)';
  minimapCtx.lineWidth = 1;
  for (const ringR of [r * 0.33, r * 0.66, r]) {
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, ringR, 0, Math.PI * 2);
    minimapCtx.stroke();
  }

  minimapCtx.strokeStyle = 'rgba(240, 160, 48, 0.16)';
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, cy - r);
  minimapCtx.lineTo(cx, cy + r);
  minimapCtx.moveTo(cx - r, cy);
  minimapCtx.lineTo(cx + r, cy);
  minimapCtx.stroke();

  minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const inner = i % 6 === 0 ? r - 7 : r - 4;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    minimapCtx.lineTo(cx + Math.sin(a) * (r - 1), cy - Math.cos(a) * (r - 1));
    minimapCtx.stroke();
  }

  function blip(x, z, color, s) {
    const dx = x - localPlayer.x;
    const dz = z - localPlayer.z;
    if (dx * dx + dz * dz > RADAR_RANGE * RADAR_RANGE) return;
    const sx = cx + dx * scale;
    const sy = cy + dz * scale;
    minimapCtx.fillStyle = color;
    minimapCtx.fillRect(sx - s / 2, sy - s / 2, s, s);
  }

  for (const c of world.collidables) blip(c.x, c.z, 'rgba(220, 226, 232, 0.72)', 3.5);
  for (const rp of Object.values(remotePlayers)) {
    if (rp.data.health <= 0) continue;
    blip(rp.data.x, rp.data.z, '#f4f7fb', 5);
  }
  for (const z of Object.values(zombieEntities)) {
    if (z.data.health <= 0) continue;
    blip(z.data.x, z.data.z, '#d5f5c8', 4);
  }

  // You stay at the center. angle 0 faces -Z (up on the canvas); turning
  // right increases angle, which rotate(-angle) applies to an upward triangle.
  minimapCtx.save();
  minimapCtx.translate(cx, cy);
  minimapCtx.rotate(-localPlayer.angle);
  minimapCtx.fillStyle = '#ffffff';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -7);
  minimapCtx.lineTo(4.5, 5.5);
  minimapCtx.lineTo(-4.5, 5.5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();

  minimapCtx.font = '700 11px Segoe UI, sans-serif';
  minimapCtx.textAlign = 'center';
  minimapCtx.textBaseline = 'middle';
  minimapCtx.fillStyle = '#f0a030';
  minimapCtx.fillText('N', cx, cy - r + 14);
  minimapCtx.fillStyle = 'rgba(236, 236, 236, 0.8)';
  minimapCtx.fillText('E', cx + r - 12, cy);
  minimapCtx.fillText('S', cx, cy + r - 12);
  minimapCtx.fillText('W', cx - r + 12, cy);

  minimapCtx.restore();

  minimapCtx.strokeStyle = 'rgba(240, 160, 48, 0.85)';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, r, 0, Math.PI * 2);
  minimapCtx.stroke();
}

// --- Kill Cam Playback --------------------------------------------------
async function updateKillCamWeapon(weaponKey) {
  if (currentKillCamWeaponKey === weaponKey) return;
  currentKillCamWeaponKey = weaponKey;

  if (killCamWeaponView) {
    if (camera) camera.remove(killCamWeaponView);
    killCamWeaponView = null;
  }

  if (weaponKey && weaponKey !== 'zombie') {
    const view = await createWeaponView(weaponKey);
    // Double check that we are still in kill cam, spectating the same weapon, and camera is active
    if (camera && killCamActive && currentKillCamWeaponKey === weaponKey) {
      killCamWeaponView = view;
      camera.add(killCamWeaponView);
    }
  }
}

function triggerKillCam(killerId) {
  killCamActive = true;
  killCamStartTime = performance.now();
  killCamKillerId = killerId;
  killCamFrames = [];

  // Determine killer name
  let trackingName = 'Someone';
  if (killerId !== null && killerId !== undefined) {
    if (killerId === myId) {
      trackingName = (localPlayer && localPlayer.name) ? localPlayer.name : 'You';
    } else if (remotePlayers[killerId]) {
      trackingName = remotePlayers[killerId].data.name || 'Someone';
    } else if (typeof killerId === 'string' && killerId.startsWith('zombie_')) {
      trackingName = 'Mutant Zombie';
    }
  }

  // Populate frames for killer
  if (killerId !== null && killerId !== undefined && playerHistory.length > 0) {
    for (const entry of playerHistory) {
      if (entry && entry.players && entry.players[killerId]) {
        killCamFrames.push({
          t: entry.t,
          ...entry.players[killerId]
        });
      }
    }
  }

  // Set title
  const titleEl = document.getElementById('killcam-title');
  if (titleEl) {
    const safeName = (trackingName || 'Someone').toString().toUpperCase();
    if (killerId !== null && killerId !== undefined && killCamFrames.length > 0) {
      titleEl.innerHTML = `KILL CAM - SPECTATING <span style="color: #ffaa00;">${safeName}</span>`;
    } else if (currentMapMode === 'zombies') {
      titleEl.innerHTML = `ZOMBIE INFESTATION CAM - WATCHING DEFEAT`;
    } else {
      titleEl.innerHTML = `ACCIDENT CAM - WATCHING DEFEAT`;
    }
  }

  // Set death position if no killer frame sequence is available (zombie or environment)
  if (killerId === null || killCamFrames.length === 0) {
    if (localPlayer) {
      killCamDeathPos = new THREE.Vector3(localPlayer.x, localPlayer.y, localPlayer.z);
    } else {
      killCamDeathPos = new THREE.Vector3(0, 0, 0);
    }
    killCamFrames = [];
    lastProcessedPlaybackTime = 0;
  } else {
    killCamDeathPos = null;
    lastProcessedPlaybackTime = killCamFrames[0].t;
  }

  // Show Kill Cam overlay
  const overlayEl = document.getElementById('killcam-overlay');
  if (overlayEl) overlayEl.classList.remove('hidden');

  // Hide weapon model
  if (myWeaponView) myWeaponView.visible = false;
  
  // Exit scope if scoped
  if (isScoped) {
    isScoped = false;
    targetFov = 75; // Return to wide view
    const scopeEl = document.getElementById('sniper-scope');
    if (scopeEl) scopeEl.classList.add('hidden');
    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl) crosshairEl.classList.remove('hidden');
  }

  // Clear current local inputs
  for (const key in input) {
    if (typeof input[key] === 'boolean') input[key] = false;
  }
}

function stopKillCam() {
  killCamActive = false;
  killCamKillerId = null;
  killCamFrames = [];
  killCamDeathPos = null;

  if (killCamWeaponView) {
    camera.remove(killCamWeaponView);
    killCamWeaponView = null;
  }
  currentKillCamWeaponKey = null;

  // Hide Kill Cam overlay
  const overlayEl = document.getElementById('killcam-overlay');
  if (overlayEl) overlayEl.classList.add('hidden');

  // Restore weapon model
  if (myWeaponView) myWeaponView.visible = !isScoped;
}

// --- Match start/stop ---------------------------------------------------
function startMatch(msg, name) {
  myId = msg.id;
  currentMapMode = MAPS[msg.map]?.mode || 'pvp';
  friendlyFireEnabled = !!msg.friendlyFire;

  // Clear sliding history buffers to avoid stale data
  playerHistory = [];
  shotHistory = [];
  killCamActive = false;
  killCamFrames = [];
  killCamDeathPos = null;
  killCamWeaponView = null;
  currentKillCamWeaponKey = null;
  adsProgress = 0;

  const built = buildWorld(msg.map);
  scene = built.scene;
  world = built;

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // A small light attached to the camera so the held weapon is always
  // reasonably lit, regardless of which way the world's sun is facing or
  // how dark a map's theme is (e.g. the Zombies map). Low intensity and a
  // short falloff distance mean it only noticeably affects things right
  // in front of the camera (the viewmodel), not the wider scene.
  const viewmodelLight = new THREE.PointLight(0xffffff, 0.8, 4, 2);
  viewmodelLight.position.set(0.2, 0.1, 0.3);
  camera.add(viewmodelLight);

  // Muzzle flash point light at front of weapon barrel
  muzzleFlashLight = new THREE.PointLight(0xffaa44, 0, 10, 1.5);
  muzzleFlashLight.position.set(0.2, -0.15, -0.6);
  camera.add(muzzleFlashLight);

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
  localPlayer.team = msg.self.team;

  // Initialize shared VFX resources and compile static meshes for collision physics
  initSharedVFX();
  collectStaticMeshes();

  weaponIndex = Math.max(0, WEAPON_ORDER.indexOf(msg.self.weapon));
  // Fire-and-forget: don't block entering the match on the weapon file
  // loading — the gun pops into your hand a moment after you spawn in,
  // rather than delaying the whole match start.
  myWeaponView = null;
  const startingWeaponIndex = weaponIndex;
  createWeaponView(WEAPON_ORDER[weaponIndex]).then((view) => {
    if (weaponIndex !== startingWeaponIndex || !camera) return; // switched already, or match ended
    myWeaponView = view;
    camera.add(myWeaponView);
  });

  remotePlayers = {};
  for (const p of msg.players) {
    if (p.id !== myId) addRemotePlayer(p);
  }

  zombieEntities = {};
  localPlayer.zombieKills = 0;
  if (currentMapMode === 'zombies') {
    for (const z of msg.zombies || []) addZombie(z);
    roundValueEl.textContent = `SURVIVAL ACTIVE`;
    zombieHudEl.classList.remove('hidden');
  } else {
    zombieHudEl.classList.add('hidden');
  }

  secretFound = false;
  secretsValueEl.textContent = '0';
  for (const key of Object.keys(ammoState)) delete ammoState[key];
  shownWeaponKey = null;
  scoreboardHtml = '';
  pingValueEl.textContent = '--';

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
  crosshair.classList.remove('hidden'); // make sure crosshair is unhidden for next match
  minimap.classList.add('hidden');
  inventoryOverlay.classList.add('hidden');
  inventoryOpen = false;
  helpOverlay.classList.add('hidden');
  helpOpen = false;
  zombieHudEl.classList.add('hidden');

  for (const id of Object.keys(remotePlayers)) removeRemotePlayer(Number(id));
  for (const id of Object.keys(zombieEntities)) removeZombie(id);
  for (const r of activeRockets) scene.remove(r.mesh);
  activeRockets = [];
  for (const ex of activeExplosions) scene.remove(ex.group);
  activeExplosions = [];

  // VFX Cleanup
  for (const p of activeParticles) scene.remove(p.mesh);
  activeParticles = [];
  for (const d of activeDecals) scene.remove(d);
  activeDecals = [];
  staticMeshes = [];
  muzzleFlashLight = null;

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

  let address = serverInput.value.trim();
  const name = (nameInput.value.trim() || 'Player').slice(0, 16);

  if (!address) {
    statusEl.textContent = 'Enter a server address first.';
    return;
  }

  // Gracefully auto-normalize address protocols to WebSockets
  if (address.startsWith('http://')) {
    address = 'ws://' + address.slice(7);
  } else if (address.startsWith('https://')) {
    address = 'wss://' + address.slice(8);
  }
  if (!/^wss?:\/\//i.test(address)) {
    address = 'ws://' + address;
  }
  // Strip trailing slashes
  address = address.replace(/\/+$/, '');

  statusEl.textContent = 'Connecting...';

  network = new Network({
    onWelcome: (msg) => startMatch(msg, name),
    onPong: (msg) => {
      if (typeof msg.t !== 'number') return;
      const ms = Math.max(0, Math.round(performance.now() - msg.t));
      pingValueEl.textContent = `${ms}ms`;
      const bars = ms < 45 ? 4 : ms < 90 ? 3 : ms < 160 ? 2 : 1;
      pingBarsEl.dataset.bars = String(bars);
    },
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
        if (typeof msg.pitch === 'number') rp.data.pitch = msg.pitch;
        if (msg.weapon) rp.data.weapon = msg.weapon;
        rp.model.setPosition(msg.x, msg.y || 0, msg.z, msg.angle);
        rp.model.setAirborne((msg.y || 0) > 0.15);
      }
    },
    onRocket: (msg) => {
      // A remote player's rocket — purely cosmetic here (see spawnRocket's
      // comment): it just flies until it hits static world geometry, since
      // the shooter's own 'explosion' message carries the real impact point.
      if (!scene) return;
      spawnRocket(new THREE.Vector3(msg.x, msg.y, msg.z), new THREE.Vector3(msg.dx, msg.dy, msg.dz), false);
    },
    onExplosion: (msg) => {
      if (!scene) return;
      spawnExplosion(new THREE.Vector3(msg.x, msg.y, msg.z));
    },
    onShoot: (msg) => {
      // Draw gorgeous glowing 3D tracer bullet trails for bots and remote players!
      if (!scene || msg.id === myId) return;

      // Record shot history
      if (!killCamActive) {
        const rp = remotePlayers[msg.id];
        const wKey = rp ? rp.data.weapon : 'pistol';
        shotHistory.push({ t: performance.now(), id: msg.id, weapon: wKey });
        while (shotHistory.length > 0 && performance.now() - shotHistory[0].t > 10000) {
          shotHistory.shift();
        }
      }

      const remote = remotePlayers[msg.id];
      if (remote) {
        // Calculate tracer starting position (approx chest height/muzzle)
        const startY = (remote.data.y || 0) + 0.95;
        const tracerOrigin = new THREE.Vector3(msg.x, startY, msg.z);
        
        // Calculate target point based on looking direction (yaw angle)
        const dir = new THREE.Vector3(-Math.sin(msg.angle), 0, -Math.cos(msg.angle));
        const tracerEnd = tracerOrigin.clone().add(dir.multiplyScalar(60));
        
        // Choose tracer color based on bot type / player skin
        let tracerColor = 0xffaa00; // default yellow/amber
        if (remote.data.name && remote.data.name.includes('Ally')) {
          tracerColor = 0x00f0ff; // allies get high-tech cyan
        } else if (remote.data.name && remote.data.name.includes('Enemy')) {
          tracerColor = 0xff3300; // enemies get hostile red
        }
        
        spawnTracer(tracerOrigin, tracerEnd, tracerColor);
      }
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
      } else if (remotePlayers[msg.killerId]) {
        remotePlayers[msg.killerId].data.score = msg.killerScore;
      }

      if (msg.victimId === myId) {
        showBanner(`${killerName} fragged you!`);
        triggerKillCam(msg.killerId);
      }
      else if (msg.killerId === myId) showBanner(`You fragged ${victimName}!`);
    },
    onRespawn: (msg) => {
      if (msg.id === myId) {
        localPlayer.x = msg.x;
        localPlayer.z = msg.z;
        localPlayer.y = 0;
        localPlayer.vy = 0;
        localPlayer.health = msg.health;
        stopKillCam();
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
      roundValueEl.textContent = `SURVIVAL ACTIVE`;
      showBanner(`ZOMBIES DETECTED`, 2200);
    },
    onRoundClear: (msg) => {
      showBanner(`Wave cleared! Respawning fresh horde...`, 3000);
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
      if (msg.killerId === myId) localPlayer.zombieKills += 1;
      updateZombiesHud();
    },
    onDisconnect: () => {
      statusEl.textContent = 'Disconnected from server.';
      endMatch();
    },
  });

  try {
    const allyBotsSelect = document.getElementById('ally-bots');
    const enemyBotsSelect = document.getElementById('enemy-bots');
    const playerTeamSelect = document.getElementById('player-team');
    const friendlyFireSelect = document.getElementById('friendly-fire');
    const allyBotsCount = allyBotsSelect ? Number(allyBotsSelect.value) : 0;
    const enemyBotsCount = enemyBotsSelect ? Number(enemyBotsSelect.value) : 0;
    const playerTeam = playerTeamSelect ? Number(playerTeamSelect.value) : 1;
    const friendlyFireSetting = friendlyFireSelect ? (friendlyFireSelect.value === '1') : false;

    await network.connect(address, {
      name,
      weapon: selectedWeapon,
      skin: selectedSkin,
      accent: selectedAccent,
      headgear: selectedHeadgear,
      mapPreference: selectedMap,
      allyBotsCount,
      enemyBotsCount,
      team: playerTeam,
      friendlyFire: friendlyFireSetting,
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
      localStorage.setItem('doom.playerTeam', String(playerTeam));
      localStorage.setItem('doom.friendlyFire', friendlyFireSetting ? '1' : '0');
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
let lastPingSent = 0;

function loop(now) {
  if (!running) return;

  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // Record current state of all players into sliding history buffer (last 10 seconds)
  if (!killCamActive && localPlayer) {
    const playersState = {};
    // Record local player
    playersState[myId] = {
      x: localPlayer.x,
      y: localPlayer.y,
      z: localPlayer.z,
      angle: localPlayer.angle,
      pitch: localPlayer.pitch,
      weapon: WEAPON_ORDER[weaponIndex]
    };
    // Record remote players and bots
    for (const [id, rp] of Object.entries(remotePlayers)) {
      playersState[id] = {
        x: rp.data.x,
        y: rp.data.y,
        z: rp.data.z,
        angle: rp.data.angle,
        pitch: rp.data.pitch || 0,
        weapon: rp.data.weapon || 'pistol'
      };
    }
    // Record zombie entities so we can spectate them as well if they kill us!
    for (const [id, z] of Object.entries(zombieEntities)) {
      playersState['zombie_' + id] = {
        x: z.data.x,
        y: 0,
        z: z.data.z,
        angle: z.data.angle || 0,
        pitch: 0,
        weapon: 'zombie' // zombie weapon identifier
      };
    }

    playerHistory.push({
      t: now,
      players: playersState
    });

    // Prune entries older than 10 seconds
    while (playerHistory.length > 0 && now - playerHistory[0].t > 10000) {
      playerHistory.shift();
    }
  }

  world?.update?.(dt);

  // Pause gameplay input while the inventory or help screen is open, but keep rendering
  // (the world stays visible behind the overlay).
  if (!inventoryOpen && !helpOpen && !weaponsOpen && !killCamActive) {
    localPlayer.update(dt, input, world);
    checkSecretArea();

    if (isFireHeld && WEAPONS[WEAPON_ORDER[weaponIndex]].auto) {
      shoot();
    }
  }

  // Handle smooth FOV zoom lerping for scoped aiming
  if (camera) {
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 14 * dt);
      camera.updateProjectionMatrix();
    }
  }

  // Handle subtle breathing sway when scoped
  let swayX = 0;
  let swayY = 0;
  if (isScoped) {
    const time = now / 1000;
    swayX = Math.sin(time * 2.5) * 0.0018; // vertical breath cycle
    swayY = Math.cos(time * 1.8) * 0.0012; // horizontal breath cycle
  }

  // Decay muzzle flash light intensity over time
  if (muzzleFlashLight && muzzleFlashLight.intensity > 0) {
    muzzleFlashLight.intensity = Math.max(0, muzzleFlashLight.intensity - dt * 45.0);
  }

  // Decay and calculate screen camera shake
  cameraShake = Math.max(0, cameraShake - dt * 5.0);
  let shakeX = 0;
  let shakeY = 0;
  let shakeZ = 0;
  if (cameraShake > 0) {
    shakeX = (Math.random() - 0.5) * cameraShake * 0.038;
    shakeY = (Math.random() - 0.5) * cameraShake * 0.038;
    shakeZ = (Math.random() - 0.5) * cameraShake * 0.024; // Hollywood-style screen roll shake
  }

  if (killCamActive) {
    const elapsed = now - killCamStartTime;
    const progress = Math.min(1, elapsed / killCamDuration);

    // Update linear progress bar
    const barEl = document.getElementById('killcam-bar');
    if (barEl) barEl.style.width = `${progress * 100}%`;

    // Update timer text
    const timeEl = document.getElementById('killcam-time');
    if (timeEl) {
      const remaining = Math.max(0, (killCamDuration - elapsed) / 1000);
      timeEl.textContent = `00:00:${remaining.toFixed(2).replace('.', ':')}`;
    }

    if (killCamKillerId !== null && killCamFrames.length > 0) {
      // PLAYBACK KILLER PERSPECTIVE OR LIVE SPECTATING
      const playbackTargetTime = killCamFrames[0].t + elapsed;
      const lastFrameTime = killCamFrames[killCamFrames.length - 1].t;

      if (playbackTargetTime <= lastFrameTime) {
        // --- 1. PLAYBACK HISTORY ---
        let frameA = killCamFrames[0];
        let frameB = killCamFrames[killCamFrames.length - 1];

        for (let i = 0; i < killCamFrames.length - 1; i++) {
          if (playbackTargetTime >= killCamFrames[i].t && playbackTargetTime <= killCamFrames[i + 1].t) {
            frameA = killCamFrames[i];
            frameB = killCamFrames[i + 1];
            break;
          }
        }

        let t = 0;
        if (frameB.t !== frameA.t) {
          t = (playbackTargetTime - frameA.t) / (frameB.t - frameA.t);
          t = Math.max(0, Math.min(1, t));
        }

        // Check for shot events in shotHistory during this playback tick
        for (const shot of shotHistory) {
          if (shot.id === killCamKillerId && shot.t > lastProcessedPlaybackTime && shot.t <= playbackTargetTime) {
            // Trigger weapon recoil
            killCamRecoilT = 1.0;
            // Trigger muzzle flash light
            if (muzzleFlashLight) {
              muzzleFlashLight.intensity = 18.0;
              muzzleFlashLight.position.copy(camera.position);
            }
            // Also spawn particles/spark flash at camera position facing forward for visual flare
            const forwardDir = new THREE.Vector3();
            camera.getWorldDirection(forwardDir);
            const sparkPos = camera.position.clone().add(forwardDir.multiplyScalar(0.8));
            spawnParticles(sparkPos, forwardDir, 0xffaa11, 4, false);
          }
        }

        // Update the spectated player's active weapon model dynamically!
        if (frameA.weapon) {
          updateKillCamWeapon(frameA.weapon);
        }

        // Safe coordinates to prevent any NaNs
        const fAx = typeof frameA.x === 'number' ? frameA.x : 0;
        const fBx = typeof frameB.x === 'number' ? frameB.x : 0;
        const fAy = typeof frameA.y === 'number' ? frameA.y : 0;
        const fBy = typeof frameB.y === 'number' ? frameB.y : 0;
        const fAz = typeof frameA.z === 'number' ? frameA.z : 0;
        const fBz = typeof frameB.z === 'number' ? frameB.z : 0;

        const camX = THREE.MathUtils.lerp(fAx, fBx, t);
        const camY = THREE.MathUtils.lerp(fAy, fBy, t) + 1.6; // eye height
        const camZ = THREE.MathUtils.lerp(fAz, fBz, t);

        const fAangle = typeof frameA.angle === 'number' ? frameA.angle : 0;
        const fBangle = typeof frameB.angle === 'number' ? frameB.angle : 0;
        const fApitch = typeof frameA.pitch === 'number' ? frameA.pitch : 0;
        const fBpitch = typeof frameB.pitch === 'number' ? frameB.pitch : 0;

        // Interpolate angles smoothly with wrap-around
        const camAngle = lerpAngle(fAangle, fBangle, t);
        const camPitch = THREE.MathUtils.lerp(fApitch, fBpitch, t);

        camera.position.set(camX, camY, camZ);
        camera.rotation.y = camAngle;
        camera.rotation.x = camPitch;
        camera.rotation.z = 0;
      } else {
        // --- 2. TRANSITION TO LIVE SPECTATING ---
        let spectatingSuccess = false;

        if (typeof killCamKillerId === 'string' && killCamKillerId.startsWith('zombie_')) {
          // Live Spectating a Zombie
          const zombieId = Number(killCamKillerId.replace('zombie_', ''));
          const z = zombieEntities[zombieId];
          if (z) {
            const camX = typeof z.data.x === 'number' ? z.data.x : 0;
            const camZ = typeof z.data.z === 'number' ? z.data.z : 0;
            const camAngle = typeof z.data.angle === 'number' ? z.data.angle : 0;
            camera.position.set(camX, 1.6, camZ);
            camera.rotation.y = camAngle;
            camera.rotation.x = 0;
            camera.rotation.z = 0;
            updateKillCamWeapon('zombie');
            spectatingSuccess = true;
          }
        } else {
          // Live Spectating a Player or Bot
          const rp = remotePlayers[killCamKillerId];
          if (rp) {
            const camX = typeof rp.data.x === 'number' ? rp.data.x : 0;
            const camY = (typeof rp.data.y === 'number' ? rp.data.y : 0) + 1.6;
            const camZ = typeof rp.data.z === 'number' ? rp.data.z : 0;
            const camAngle = typeof rp.data.angle === 'number' ? rp.data.angle : 0;
            const camPitch = typeof rp.data.pitch === 'number' ? rp.data.pitch : 0;
            camera.position.set(camX, camY, camZ);
            camera.rotation.y = camAngle;
            camera.rotation.x = camPitch;
            camera.rotation.z = 0;
            updateKillCamWeapon(rp.data.weapon || 'pistol');
            spectatingSuccess = true;
          }
        }

        if (!spectatingSuccess) {
          // Fallback to static orbit on last recorded frame
          const lastFrame = killCamFrames[killCamFrames.length - 1];
          const camX = typeof lastFrame.x === 'number' ? lastFrame.x : 0;
          const camY = (typeof lastFrame.y === 'number' ? lastFrame.y : 0) + 1.6;
          const camZ = typeof lastFrame.z === 'number' ? lastFrame.z : 0;
          const camAngle = typeof lastFrame.angle === 'number' ? lastFrame.angle : 0;
          const camPitch = typeof lastFrame.pitch === 'number' ? lastFrame.pitch : 0;

          camera.position.set(camX, camY, camZ);
          camera.rotation.y = camAngle;
          camera.rotation.x = camPitch;
          camera.rotation.z = 0;
          if (lastFrame.weapon) {
            updateKillCamWeapon(lastFrame.weapon);
          }
        }
      }
      lastProcessedPlaybackTime = playbackTargetTime;
    } else if (killCamDeathPos) {
      // ORBIT CAMERA PERSPECTIVE
      const slowTime = (elapsed / 1000) * 0.4; // slow motion orbit speed
      const orbitRadius = 8.0;
      const camX = killCamDeathPos.x + Math.sin(slowTime) * orbitRadius;
      const camY = killCamDeathPos.y + 3.0 + Math.sin(slowTime * 0.5) * 1.5;
      const camZ = killCamDeathPos.z + Math.cos(slowTime) * orbitRadius;

      camera.position.set(camX, camY, camZ);
      camera.lookAt(new THREE.Vector3(killCamDeathPos.x, killCamDeathPos.y + 0.8, killCamDeathPos.z));
    }
  } else {
    camera.position.set(localPlayer.x, localPlayer.eyeHeight, localPlayer.z);
    camera.rotation.y = localPlayer.angle + swayY + shakeY;
    camera.rotation.x = localPlayer.pitch + swayX + shakeX;
    camera.rotation.z = shakeZ; // Apply screen roll
  }

  // Spawn visual jetpack flames if flying
  if (localPlayer.flying && (input.spaceHeld || localPlayer.vy > 0 || localPlayer.isMoving)) {
    const footPos = new THREE.Vector3(localPlayer.x, localPlayer.y + 0.15, localPlayer.z);
    footPos.x += (Math.random() - 0.5) * 0.25;
    footPos.z += (Math.random() - 0.5) * 0.25;
    spawnJetpackParticles(footPos);
  }

  // Spawn visual jetpack flames for airborne remote players/bots
  for (const rp of Object.values(remotePlayers)) {
    if ((rp.data.y || 0) > 0.15 && rp.moving) {
      const footPos = new THREE.Vector3(rp.data.x, rp.data.y + 0.15, rp.data.z);
      footPos.x += (Math.random() - 0.5) * 0.25;
      footPos.z += (Math.random() - 0.5) * 0.25;
      spawnJetpackParticles(footPos);
    }
  }

  updateWeaponBob(dt);
  updateRockets(dt);
  updateExplosions(dt);
  updateTracers();
  updateParticles(dt);

  for (const rp of Object.values(remotePlayers)) {
    rp.model.animate(dt, rp.moving);
  }
  for (const z of Object.values(zombieEntities)) {
    z.model.animate(dt, z.moving);
  }

  if (!inventoryOpen && !helpOpen && !weaponsOpen && now - lastNetworkSend > NETWORK_SEND_INTERVAL_MS) {
    network.sendUpdate(
      localPlayer.x,
      localPlayer.y,
      localPlayer.z,
      localPlayer.angle,
      localPlayer.pitch,
      WEAPON_ORDER[weaponIndex]
    );
    lastNetworkSend = now;
  }
  if (now - lastPingSent > 1000) {
    lastPingSent = now;
    network.send({ type: 'ping', t: now });
  }

  renderer.render(scene, camera);
  renderMinimap();

  const healthPct = Math.max(0, Math.min(100, localPlayer.health));
  healthValueEl.textContent = Math.round(healthPct);
  healthBarFillEl.style.width = `${healthPct}%`;
  // Green when healthy, shifting to red as health drops — a glance at the
  // bar's color tells you how much trouble you're in without reading the number.
  healthBarFillEl.style.background =
    healthPct > 50
      ? 'linear-gradient(90deg, #2fce62, #8dff73)'
      : healthPct > 25
        ? 'linear-gradient(90deg, #e88812, #ffe14a)'
        : 'linear-gradient(90deg, #c0392b, #e74c3c)';
  flyingIndicatorEl.classList.toggle('hidden', !localPlayer.flying);
  updateCompass();
  updateWeaponHud();
  updateScoreboard();
  if (currentMapMode === 'zombies') updateZombiesHud();

  requestAnimationFrame(loop);
}

buildCompass();

// --- Remembered settings + live server address detection -----------------
try {
  const savedName = localStorage.getItem('doom.playerName');
  const savedAddress = localStorage.getItem('doom.serverAddress');
  const savedWeapon = localStorage.getItem('doom.weapon');
  const savedSkin = localStorage.getItem('doom.skin');
  const savedAccent = localStorage.getItem('doom.accent');
  const savedHeadgear = localStorage.getItem('doom.headgear');
  const savedMap = localStorage.getItem('doom.map');
  const savedTeam = localStorage.getItem('doom.playerTeam');
  const savedFriendlyFire = localStorage.getItem('doom.friendlyFire');

  if (savedName) nameInput.value = savedName;
  if (savedAddress) serverInput.value = savedAddress;
  if (savedWeapon && WEAPON_ORDER.includes(savedWeapon)) selectedWeapon = savedWeapon;
  if (savedSkin && SKIN_ORDER.includes(savedSkin)) selectedSkin = savedSkin;
  if (savedAccent && ACCENT_ORDER.includes(savedAccent)) selectedAccent = savedAccent;
  if (savedHeadgear && HEADGEAR_ORDER.includes(savedHeadgear)) selectedHeadgear = savedHeadgear;
  if (savedMap && MAP_ORDER.includes(savedMap)) selectedMap = savedMap;

  const playerTeamSelect = document.getElementById('player-team');
  if (savedTeam && playerTeamSelect) playerTeamSelect.value = savedTeam;

  const friendlyFireSelect = document.getElementById('friendly-fire');
  if (savedFriendlyFire && friendlyFireSelect) friendlyFireSelect.value = savedFriendlyFire;
} catch (e) {
  console.warn("Storage access failed:", e);
}

// Fallback for address if empty/unset
if (!serverInput.value) {
  serverInput.value = `ws://${location.hostname || 'localhost'}:3000`;
}

// Always build cards outside of storage try-catch so failures in storage do not block rendering!
buildLobbyCards();
updateLobbyCharacterPreview();

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
