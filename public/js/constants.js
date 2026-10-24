// Shared gameplay constants for the 3D client, server, and the
// loadout/map lobby.

export const WORLD_SIZE = 240; // world is a WORLD_SIZE x WORLD_SIZE square centered at the origin

export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const MOVE_SPEED = 6;          // units/sec at full acceleration
export const SPRINT_MULTIPLIER = 1.6;
export const ACCELERATION = 30;       // units/sec^2
export const FRICTION = 18;           // units/sec^2
export const GRAVITY = 18;
export const MOUSE_SENSITIVITY = 0.0022;
export const MAX_PITCH = Math.PI / 2 - 0.05;
export const NETWORK_SEND_INTERVAL_MS = 50; // ~20 updates/sec

// Free flight: unlimited, no fuel. A double-tap of Space (or a single
// press of F) toggles it on/off — see main.js's keydown handler. While
// on, gravity is suspended entirely: holding Space climbs at this rate;
// releasing it just hovers (no fuel to run out, no height cap).
export const FLY_SPEED = 10;

// Rocket launcher: unlike every other weapon (instant hitscan), this one
// is a real traveling projectile that flies out from the camera and
// detonates in an area-of-effect explosion wherever it ends up — a wall,
// the ground, or a hit target — rather than resolving damage the instant
// you click. See the rocket/explosion handling in main.js.
export const ROCKET_SPEED = 45; // units/sec
export const ROCKET_MAX_RANGE = 140; // fizzles out with no explosion past this
export const ROCKET_EXPLOSION_RADIUS = 7; // splash damage falls off to 0 at this distance
export const ROCKET_COLLISION_RADIUS = 0.15; // a little forgiveness against thin obstacles

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

// Every weapon is unlocked and fully kitted out for every player from the
// moment they spawn — no economy, no buy stations, no upgrade bench, no
// grind. Stats below are what used to be each weapon's purchasable
// "upgraded" tier; that tier is just the weapon's stats now.
export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    damage: 32,
    fireCooldownMs: 255,
    pellets: 1,
    spread: 0,
    auto: false,
  },
  shotgun: {
    name: 'Shotgun',
    damage: 18,
    fireCooldownMs: 640,
    pellets: 6,
    spread: 0.12,
    auto: false,
  },
  chaingun: {
    name: 'Chaingun',
    damage: 13,
    fireCooldownMs: 83,
    pellets: 1,
    spread: 0.035,
    auto: true,
  },
  rocket: {
    name: 'Rocket Launcher',
    damage: 98,
    fireCooldownMs: 880,
    pellets: 1,
    spread: 0,
    auto: false,
  },
  ak47: {
    name: 'AK-47',
    // Real .glb model (ported from the open-source Tiny Strike project —
    // see public/js/weapons/ and public/assets/weapons/LICENSE) at
    // true-to-life AKM proportions, not a primitive-box assembly like the
    // other starter weapons.
    damage: 32,
    fireCooldownMs: 85,
    pellets: 1,
    spread: 0.045,
    auto: true,
  },
  m4a1: {
    name: 'M4A1-S',
    // Also a real .glb model — see ak47's comment above.
    damage: 30,
    fireCooldownMs: 128,
    pellets: 1,
    spread: 0.03,
    auto: true,
  },
  mp5: {
    name: 'MP5',
    // Also a real .glb model — see ak47's comment above.
    damage: 10,
    fireCooldownMs: 68, // very fast SMG
    pellets: 1,
    spread: 0.05,
    auto: true,
  },
  awp: {
    name: 'AWP',
    // Also a real .glb model — see ak47's comment above. A proper sniper
    // archetype: devastating, slow, and precise.
    damage: 119,
    fireCooldownMs: 1275,
    pellets: 1,
    spread: 0.004,
    auto: false,
  },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'chaingun', 'rocket', 'ak47', 'm4a1', 'mp5', 'awp'];

// Three maps, all built from primitive geometry (no external model/
// texture files to source, license, or ship). `terrain` selects which
// scenery generator world.js uses; `mode` selects pvp deathmatch vs
// zombies co-op survival.
export const MAPS = {
  forest: {
    id: 'forest',
    name: 'Forest Outpost',
    description: 'Deathmatch combat in open woodland.',
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
    name: 'Ironvale Industrial',
    description: 'Factories, a workers village, and a multi-level city district.',
    mode: 'pvp',
    terrain: 'techbase',
    sky: 0x8294a2,
    fogColor: 0x98a3a8,
    fogDensity: 0.0045,
    groundColor: 0x686d70,
    ambient: 0x66757e,
    sun: 0xffefd1,
  },
  zombies: {
    id: 'zombies',
    name: 'Outbreak Facility',
    description: 'Deathmatch combat inside a moody horror-red research base.',
    mode: 'pvp',
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
// notification — a nod to the original Doom games' intermission
// "Secrets: x/y" stat.
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
export const ZOMBIE_TICK_MS = 120; // ~8Hz server AI tick
