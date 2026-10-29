// Shared gameplay constants for the 3D client, server, and the
// loadout/map lobby.

export const WORLD_SIZE = 240; // world is a WORLD_SIZE x WORLD_SIZE square centered at the origin

export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_CROUCH_EYE_HEIGHT = 1.12;
export const PLAYER_RADIUS = 0.4;
export const MOVE_SPEED = 5.2;        // units/sec at full acceleration (~jogging pace)
export const SPRINT_MULTIPLIER = 1.55;
export const CROUCH_SPEED_MULTIPLIER = 0.5;
export const ADS_SPEED_MULTIPLIER = 0.65;
export const ACCELERATION = 14;       // units/sec^2 — lower = more weight/inertia
export const FRICTION = 11;           // units/sec^2
export const AIR_CONTROL = 0.25;      // fraction of ground acceleration available mid-air
export const GRAVITY = 20;
export const JUMP_VELOCITY = 6.4;     // ~1m jump apex, a realistic standing jump
export const MOUSE_SENSITIVITY = 0.0022; // radians per mouse count at sensitivity 1.0
export const MAX_PITCH = Math.PI / 2 - 0.05;
export const NETWORK_SEND_INTERVAL_MS = 33; // ~30 updates/sec

// Remote players are drawn this far in the past and interpolated between
// network snapshots, so they move smoothly instead of teleporting 30x/sec.
export const INTERPOLATION_DELAY_MS = 100;
export const RESPAWN_DELAY_MS = 6500; // keep in sync with server/index.js
export const KILLCAM_DURATION_MS = 5500;

// Free flight: unlimited, no fuel, toggled with F. While on, gravity is
// suspended: Space climbs, C descends, releasing both hovers.
export const FLY_SPEED = 10;

// Rocket launcher: unlike every other weapon (instant hitscan), this one
// is a real traveling projectile that flies out from the camera and
// detonates in an area-of-effect explosion wherever it ends up.
export const ROCKET_SPEED = 45; // units/sec
export const ROCKET_MAX_RANGE = 140; // fizzles out with no explosion past this
export const ROCKET_EXPLOSION_RADIUS = 7; // splash damage falls off to 0 at this distance
export const ROCKET_COLLISION_RADIUS = 0.15; // a little forgiveness against thin obstacles

// Frag grenades: real bouncing projectiles with a cookable fuse.
export const GRENADE_FUSE_MS = 3200;
export const GRENADE_THROW_SPEED = 17;
export const GRENADE_RADIUS = 0.08;
export const GRENADE_BLAST_RADIUS = 8;
export const GRENADE_DAMAGE = 140; // at the centre; falls off with distance and is blocked by walls
export const GRENADES_PER_LIFE = 2;

// Hit-zone damage multipliers (head / arms+legs; torso is 1.0).
export const HEADSHOT_MULTIPLIER = 2.2;
export const LIMB_MULTIPLIER = 0.8;

// Corners of the map — valid spawn points on every map, since all maps
// share the same WORLD_SIZE ground footprint.
export const SPAWN_POINTS = [
  { x: -90, z: -90 },
  { x: 90, z: -90 },
  { x: -90, z: 90 },
  { x: 90, z: 90 },
];

// Skins: solid colours plus procedurally-generated camouflage patterns
// (`camo` names a pattern drawn by playerModel.js's makeCamoTexture; the
// palette is [base, blotch1, blotch2, blotch3]). Keep ids in sync with
// server/index.js.
export const SKINS = [
  { id: 'woodland', name: 'Woodland Camo', color: 0x4b5a35, camo: 'woodland', palette: ['#4b5a35', '#2e3a22', '#6b6440', '#1c1f17'] },
  { id: 'desert', name: 'Desert Camo', color: 0xc2a878, camo: 'woodland', palette: ['#c8b083', '#a4875a', '#8a6f4a', '#e0cfa6'] },
  { id: 'multicam', name: 'Multi-Terrain', color: 0x7d7556, camo: 'woodland', palette: ['#8a805d', '#5d6b45', '#a39469', '#4a3d2c'] },
  { id: 'urban', name: 'Urban Digital', color: 0x6d7378, camo: 'digital', palette: ['#7a8085', '#55595e', '#9ea3a6', '#33363a'] },
  { id: 'arctic', name: 'Arctic Digital', color: 0xd8dde0, camo: 'digital', palette: ['#dfe4e6', '#b5bcc0', '#8e979c', '#f6f8f9'] },
  { id: 'tiger', name: 'Tiger Stripe', color: 0x5b6a3a, camo: 'tiger', palette: ['#6a7a44', '#1d2213', '#8a7a4a', '#3c4a26'] },
  { id: 'gold', name: 'Gold Elite', color: 0xc9a227, camo: 'digital', palette: ['#c9a227', '#a07f17', '#e6c75a', '#7a5f10'] },
  { id: 'black', name: 'Shadow Ops', color: 0x23262a },
  { id: 'navy', name: 'Navy', color: 0x1f3550 },
  { id: 'red', name: 'Crimson', color: 0x8c2a22 },
];
export const SKIN_ORDER = SKINS.map((s) => s.id);

// Accent color applies to boots/gloves/vest trim.
export const ACCENTS = [
  { id: 'black', name: 'Black', color: 0x1c1c1c },
  { id: 'white', name: 'White', color: 0xe8e8e8 },
  { id: 'crimson', name: 'Crimson', color: 0xa93226 },
  { id: 'tan', name: 'Tan', color: 0xc2a878 },
  { id: 'olive', name: 'Olive', color: 0x4f5634 },
  { id: 'coyote', name: 'Coyote', color: 0x81613c },
];
export const ACCENT_ORDER = ACCENTS.map((a) => a.id);

export const HEADGEAR = [
  { id: 'none', name: 'Bare Head' },
  { id: 'helmet', name: 'Combat Helmet' },
  { id: 'nvg', name: 'Helmet + NVG' },
  { id: 'cap', name: 'Patrol Cap' },
  { id: 'beanie', name: 'Beanie' },
];
export const HEADGEAR_ORDER = HEADGEAR.map((h) => h.id);

// Every weapon is unlocked for every player from the moment they spawn.
//   recoil:    [vertical kick, horizontal jitter] in radians per shot
//   spread:    hip-fire cone half-angle in radians (grows while moving or
//              in the air, shrinks while crouched — see main.js)
//   adsSpread: multiplier applied to spread while aiming down sights
//   adsFov:    camera field of view while aiming down sights
export const WEAPONS = {
  pistol: {
    name: 'Glock 17', damage: 32, fireCooldownMs: 160, pellets: 1, spread: 0.022, adsSpread: 0.15, auto: false,
    recoil: [0.016, 0.006], mag: 12, reserve: 48, reloadMs: 1400, adsFov: 62, range: 90,
  },
  shotgun: {
    name: 'M870 Tactical', damage: 17, fireCooldownMs: 820, pellets: 9, spread: 0.075, adsSpread: 0.75, auto: false,
    recoil: [0.06, 0.012], mag: 8, reserve: 32, reloadMs: 2600, adsFov: 64, range: 45,
  },
  chaingun: {
    name: 'XM556 Microgun', damage: 15, fireCooldownMs: 75, pellets: 1, spread: 0.045, adsSpread: 0.45, auto: true,
    recoil: [0.008, 0.008], mag: 100, reserve: 200, reloadMs: 4200, adsFov: 62, range: 140,
  },
  rocket: {
    name: 'RPG-7', damage: 120, fireCooldownMs: 1100, pellets: 1, spread: 0, adsSpread: 0, auto: false,
    recoil: [0.08, 0.01], mag: 1, reserve: 4, reloadMs: 2800, adsFov: 58, range: 140,
  },
  ak47: {
    // Real .glb model (ported from the open-source Tiny Strike project —
    // see public/js/weapons/ and public/assets/weapons/LICENSE).
    name: 'AK-47', damage: 34, fireCooldownMs: 100, pellets: 1, spread: 0.03, adsSpread: 0.12, auto: true,
    recoil: [0.014, 0.007], mag: 30, reserve: 90, reloadMs: 2400, adsFov: 55, range: 200,
  },
  m4a1: {
    name: 'M4A1-S', damage: 29, fireCooldownMs: 90, pellets: 1, spread: 0.024, adsSpread: 0.1, auto: true,
    recoil: [0.010, 0.005], mag: 30, reserve: 90, reloadMs: 2100, adsFov: 55, range: 200,
  },
  mp5: {
    name: 'MP5', damage: 22, fireCooldownMs: 70, pellets: 1, spread: 0.026, adsSpread: 0.18, auto: true,
    recoil: [0.007, 0.005], mag: 30, reserve: 120, reloadMs: 1900, adsFov: 60, range: 110,
  },
  awp: {
    // A proper sniper archetype: devastating and slow, precise only when scoped.
    name: 'AWP', damage: 115, fireCooldownMs: 1450, pellets: 1, spread: 0.06, adsSpread: 0.0, auto: false,
    recoil: [0.07, 0.01], mag: 5, reserve: 25, reloadMs: 3300, adsFov: 14, range: 400,
  },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'chaingun', 'rocket', 'ak47', 'm4a1', 'mp5', 'awp'];

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
MAPS.deadwoods = {
  id: 'deadwoods',
  name: 'Dead Woods',
  description: 'Night-time zombie survival in the forest. Waves of the dead, one flashlight. Hold out.',
  mode: 'zombies',
  terrain: 'forest',
  night: true,
  sky: 0x0b1120,
  fogColor: 0x070a10,
  fogDensity: 0.028,
  groundColor: 0x1c2416,
  ambient: 0x223044,
  sun: 0x9fb6e6,
};
export const MAP_ORDER = ['forest', 'techbase', 'zombies', 'deadwoods'];
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
