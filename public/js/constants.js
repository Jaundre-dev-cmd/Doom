// Shared gameplay constants for the 3D client, server, and the
// loadout/map lobby.

export const WORLD_SIZE = 240; // world is a WORLD_SIZE x WORLD_SIZE square centered at the origin

export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const MOVE_SPEED = 6;          // units/sec at full acceleration
export const SPRINT_MULTIPLIER = 1.6;
export const ACCELERATION = 30;       // units/sec^2
export const FRICTION = 18;           // units/sec^2
export const JUMP_SPEED = 6.5;
export const GRAVITY = 18;
export const MOUSE_SENSITIVITY = 0.0022;
export const MAX_PITCH = Math.PI / 2 - 0.05;
export const NETWORK_SEND_INTERVAL_MS = 50; // ~20 updates/sec

// Jetpack: hold the key to thrust upward against gravity, draining fuel;
// fuel regenerates whenever you're not thrusting. Net accel while
// thrusting is JETPACK_ACCEL - GRAVITY, so it must exceed GRAVITY to climb.
export const JETPACK_ACCEL = 30;
export const JETPACK_MAX_VY = 9;
export const JETPACK_FUEL_MAX = 100;
export const JETPACK_FUEL_DRAIN_PER_SEC = 28;
export const JETPACK_FUEL_REGEN_PER_SEC = 16;

// Corners of the (now much bigger) map — valid spawn points on every map,
// since all maps share the same WORLD_SIZE ground footprint.
export const SPAWN_POINTS = [
  { x: -90, z: -90 },
  { x: 90, z: -90 },
  { x: -90, z: 90 },
  { x: 90, z: 90 },
];

// Skins are solid color variants, not textured camo — a deliberate scope
// choice: real camo/decal textures would need an actual art pipeline.
export const SKINS = [
  { id: 'red', name: 'Crimson', color: 0xc0392b },
  { id: 'blue', name: 'Navy', color: 0x2980b9 },
  { id: 'olive', name: 'Olive Drab', color: 0x556b2f },
  { id: 'desert', name: 'Desert Tan', color: 0xc2a878 },
  { id: 'black', name: 'Shadow', color: 0x2c2c2c },
  { id: 'gold', name: 'Gold', color: 0xf1c40f },
];
export const SKIN_ORDER = SKINS.map((s) => s.id);

// Accent color applies to boots/vest trim — a second customization slot
// on top of the main skin color.
export const ACCENTS = [
  { id: 'black', name: 'Black', color: 0x1c1c1c },
  { id: 'white', name: 'White', color: 0xe8e8e8 },
  { id: 'crimson', name: 'Crimson', color: 0xa93226 },
  { id: 'tan', name: 'Tan', color: 0xc2a878 },
];
export const ACCENT_ORDER = ACCENTS.map((a) => a.id);

// Headgear is a simple primitive attachment, not a modeled/textured item.
export const HEADGEAR = [
  { id: 'none', name: 'Bare Head' },
  { id: 'helmet', name: 'Helmet' },
  { id: 'cap', name: 'Cap' },
];
export const HEADGEAR_ORDER = HEADGEAR.map((h) => h.id);

// Economy: kills (and the hidden secret) pay out money, spent at buy
// stations (unlock a weapon for the rest of the match) and an upgrade
// bench (boost a weapon you already own). Money and purchases are
// tracked locally per client, not by the server — consistent with this
// project's existing thin-relay, no-anti-cheat design (the server
// already trusts each client's self-reported hit damage the same way).
export const STARTING_MONEY = 500;
export const KILL_REWARD = 500;
export const SECRET_REWARD = 250;
export const INTERACT_RADIUS = 3.5; // how close you must stand to a station/bench

export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    damage: 20,
    fireCooldownMs: 300,
    pellets: 1,
    spread: 0,
    auto: false,
    price: 0, // starting weapon — always owned
    upgradeCost: 1500,
    upgradeDamageMultiplier: 1.6,
    upgradeFireRateMultiplier: 0.85,
  },
  shotgun: {
    name: 'Shotgun',
    damage: 12,
    fireCooldownMs: 800,
    pellets: 6,
    spread: 0.12,
    auto: false,
    price: 1000,
    upgradeCost: 2000,
    upgradeDamageMultiplier: 1.5,
    upgradeFireRateMultiplier: 0.8,
  },
  chaingun: {
    name: 'Chaingun',
    damage: 9,
    fireCooldownMs: 110,
    pellets: 1,
    spread: 0.035,
    auto: true,
    price: 1500,
    upgradeCost: 2500,
    upgradeDamageMultiplier: 1.4,
    upgradeFireRateMultiplier: 0.75,
  },
  rocket: {
    name: 'Rocket Launcher',
    damage: 65,
    fireCooldownMs: 1100,
    pellets: 1,
    spread: 0,
    auto: false,
    price: 3000,
    upgradeCost: 3500,
    upgradeDamageMultiplier: 1.5,
    upgradeFireRateMultiplier: 0.8,
  },
  ak47: {
    name: 'AK-47',
    // Real procedurally modelled geometry (ported from the open-source Tiny
    // Strike project — see public/js/weapons/) at true-to-life AKM
    // dimensions, not a simple primitive assembly like the other weapons.
    damage: 24,
    fireCooldownMs: 100, // ~600 RPM
    pellets: 1,
    spread: 0.045,
    auto: true,
    procedural: true, // tells weaponView.js to use the ported AK builder
    price: 2000,
    upgradeCost: 2800,
    upgradeDamageMultiplier: 1.35,
    upgradeFireRateMultiplier: 0.85,
  },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'chaingun', 'rocket', 'ak47'];

// Buy stations (unlock a weapon) and an upgrade bench (boost one you
// own), placed as real 3D kiosks in the world. world.js keeps the ground
// near these coordinates clear of trees/rocks/crates.
export const BUY_STATIONS = [
  { id: 'buy-shotgun', weapon: 'shotgun', x: -25, z: 0 },
  { id: 'buy-chaingun', weapon: 'chaingun', x: 25, z: 0 },
  { id: 'buy-rocket', weapon: 'rocket', x: 0, z: -25 },
  { id: 'buy-ak47', weapon: 'ak47', x: -25, z: -25 },
];
export const UPGRADE_BENCHES = [{ id: 'bench-main', x: 0, z: 25 }];

// Three maps, all built from primitive geometry (no external model/
// texture files to source, license, or ship). `terrain` selects which
// scenery generator world.js uses; `mode` selects pvp deathmatch vs
// zombies co-op survival.
export const MAPS = {
  forest: {
    id: 'forest',
    name: 'Forest Outpost',
    description: 'Open woodland — trees, grass, and rock cover.',
    mode: 'pvp',
    terrain: 'forest',
    sky: 0x8fc7ff,
    fogColor: 0x9fd0ff,
    fogDensity: 0.006,
    groundColor: 0x4a7c3f,
    ambient: 0x8899aa,
    sun: 0xfff3d6,
  },
  techbase: {
    id: 'techbase',
    name: 'Techbase Arena',
    description: 'A dim concrete facility with metal crate cover.',
    mode: 'pvp',
    terrain: 'techbase',
    sky: 0x1b2430,
    fogColor: 0x1b2430,
    fogDensity: 0.01,
    groundColor: 0x555a60,
    ambient: 0x334455,
    sun: 0xaad4ff,
  },
  zombies: {
    id: 'zombies',
    name: 'Outbreak Facility',
    description: 'Co-op survival — fend off endless rounds of zombies.',
    mode: 'zombies',
    terrain: 'techbase',
    // Moody dark-red horror palette — but not literally near-black, which
    // (combined with realistic tone mapping) rendered as an unplayable
    // solid-black screen. Still clearly distinct from forest's blue sky
    // and techbase's dim industrial blue; red is exclusive to this map.
    sky: 0x2a1014,
    fogColor: 0x3a1818,
    fogDensity: 0.012,
    groundColor: 0x3a3a3d,
    ambient: 0x7a3030,
    sun: 0xff6644,
  },
};
export const MAP_ORDER = ['forest', 'techbase', 'zombies'];
export const DEFAULT_MAP = 'forest';

// A hidden area (world-space box) that awards a one-time "secret found"
// notification and a money bonus — tracked separately from kills, a nod
// to the original Doom games' intermission "Secrets: x/y" stat.
export const SECRET_AREA = { x0: -4, z0: -4, x1: 4, z1: 4 };

// Zombies mode (co-op survival): round-based AI simulated server-side so
// every connected player sees the exact same zombies, regardless of who
// hosts — the server is the single source of truth for zombie state.
export const ZOMBIE_SPAWN_POINTS = [
  { x: -55, z: -55 },
  { x: 55, z: -55 },
  { x: -55, z: 55 },
  { x: 55, z: 55 },
  { x: 0, z: -70 },
  { x: 0, z: 70 },
  { x: -70, z: 0 },
  { x: 70, z: 0 },
];
export const ZOMBIE_BASE_HEALTH = 100;
export const ZOMBIE_HEALTH_PER_ROUND = 25;
export const ZOMBIE_SPEED = 2.4; // units/sec
export const ZOMBIE_DAMAGE = 10;
export const ZOMBIE_ATTACK_RANGE = 1.5;
export const ZOMBIE_ATTACK_COOLDOWN_MS = 1000;
export const ZOMBIES_PER_ROUND_BASE = 4;
export const ZOMBIES_PER_ROUND_INCREMENT = 2;
export const ROUND_INTERMISSION_MS = 8000;
export const ZOMBIE_KILL_REWARD = 100;
export const ZOMBIE_TICK_MS = 120; // ~8Hz server AI tick
