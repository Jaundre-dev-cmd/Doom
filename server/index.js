/**
 * DOOM-clone game server.
 *
 * Responsibilities:
 *  - Serves the static client (public/) over plain HTTP.
 *  - Runs a WebSocket relay that keeps connected players in sync:
 *    positions, shots, hits, kills, health, spawns and respawns.
 *  - Simulates all AI (ai.js): combat bots and, on survival maps, the
 *    zombie waves — AI needs a single source of truth that every connected
 *    player agrees on. The AI knows the map's real geometry (worldGeo.js,
 *    uploaded once by a client and cached) so it can't see, shoot or walk
 *    through walls.
 *
 * This is intentionally a thin relay rather than a fully authoritative
 * server (no anti-cheat for player-vs-player damage, no server-side
 * player physics) — appropriate for friends playing together, not for a
 * competitive/public deployment. Zombie AI is the one exception, and it's
 * fully server-owned specifically so flight/positions can't be faked.
 *
 * Map selection: the match's map is "locked in" from whichever player's
 * join message arrives first after the server starts (or after the last
 * player leaves). There's no lobby/voting system — this mirrors how the
 * rest of this project works (one friend hosts, the other joins).
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { createAI } = require('./ai');
const { getGeo, setGeoFromClient } = require('./worldGeo');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

// Keep these in sync with public/js/constants.js.
const WEAPON_IDS = ['pistol', 'shotgun', 'chaingun', 'rocket', 'ak47', 'm4a1', 'mp5', 'awp'];
const SKIN_IDS = ['woodland', 'desert', 'multicam', 'urban', 'arctic', 'tiger', 'gold', 'black', 'navy', 'red'];
const ACCENT_IDS = ['black', 'white', 'crimson', 'tan', 'olive', 'coyote'];
const HEADGEAR_IDS = ['none', 'helmet', 'nvg', 'cap', 'beanie'];
const DAMAGE_SOURCES = [...WEAPON_IDS, 'grenade', 'airstrike', 'melee'];
const RESPAWN_DELAY_MS = 6500; // keep in sync with public/js/constants.js
const MAP_IDS = ['forest', 'techbase', 'zombies', 'deadwoods'];
const MAP_MODES = { forest: 'pvp', techbase: 'pvp', zombies: 'pvp', deadwoods: 'zombies' };
const NIGHT_MAPS = ['deadwoods'];
const DEFAULT_MAP = 'forest';

// Real, reachable LAN addresses for this machine — so the client can show
// the actual address to share instead of relying on a human to find it.
const VIRTUAL_ADAPTER_PATTERN = /vEthernet|WSL|Virtual|VPN|Hyper-V|Loopback|VMware|Tailscale/i;

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const [name, iface] of Object.entries(nets)) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address, likelyVirtual: VIRTUAL_ADAPTER_PATTERN.test(name) });
      }
    }
  }
  addresses.sort((a, b) => Number(a.likelyVirtual) - Number(b.likelyVirtual));
  return addresses;
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  if (req.url === '/api/server-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        port: PORT,
        localAddresses: getLocalIPv4Addresses(),
        // Which map the current match is locked to (null = none running),
        // so the lobby can tell you before you deploy.
        activeMap,
        realPlayers: playerList().filter((pl) => !pl.isBot).length,
      })
    );
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') {
    urlPath = '/index.html';
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

// Centers of the four quadrants — valid spawn points on any map, since
// every map shares the same world footprint (keep in sync with constants.js).
const SPAWN_POINTS = [
  { x: -90, z: -90 },
  { x: 90, z: -90 },
  { x: -90, z: 90 },
  { x: 90, z: 90 },
];

const players = new Map(); // id -> player state
let nextId = 1;
let spawnIndex = 0;
let activeMap = null; // locked in by the first player to join
let friendlyFire = true; // locked in by the first player to join, defaults to true (FFA)

function nextSpawn() {
  const spawn = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
  spawnIndex += 1;
  return spawn;
}

// Respawn at the spawn point farthest from every living enemy, with a
// little jitter so two players never land on exactly the same spot.
function safeSpawnFor(target) {
  const enemies = playerList().filter(
    (pl) => pl.id !== target.id && pl.health > 0 && (friendlyFire || pl.team !== target.team)
  );
  let best = nextSpawn();
  let bestScore = -Infinity;
  for (const sp of SPAWN_POINTS) {
    let nearest = Infinity;
    for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.x - sp.x, e.z - sp.z));
    const score = nearest + Math.random() * 10;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  const pt = { x: best.x + (Math.random() - 0.5) * 6, z: best.z + (Math.random() - 0.5) * 6 };
  const geo = activeMap ? getGeo(activeMap) : null;
  if (geo && !geo.isWalkable(pt.x, pt.z)) return geo.randomPointNear(best.x, best.z, 8) || best;
  return pt;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function playerList() {
  return Array.from(players.values());
}

// Shared by player-vs-player hits, explosives, bots and zombie melee.
// `killerId` is a player id (PvP), a 'zombie_<id>' string, or null.
// `info` describes the hit: { weapon, zone ('head'|'body'|'legs'), distance }.
// Every client receives the attacker on each 'health' message (for damage
// direction indicators) and the full kill details on 'kill' (kill feed and
// killcam), so everybody can see exactly who shot whom, with what.
function damagePlayer(target, damage, killerId, info = {}) {
  if (target.health <= 0) return;

  target.health = Math.max(0, target.health - damage);
  target.lastDamaged = Date.now();
  const attacker = typeof killerId === 'number' ? players.get(killerId) : null;
  if (target.isBot && attacker) ai.onBotDamaged(target, attacker);
  broadcast({
    type: 'health',
    id: target.id,
    health: target.health,
    attackerId: killerId,
    ax: attacker ? round1(attacker.x) : null,
    az: attacker ? round1(attacker.z) : null,
    zone: info.zone || 'body',
  });

  if (target.health > 0) return;

  target.deaths = (target.deaths || 0) + 1;
  const killer = typeof killerId === 'number' ? players.get(killerId) : null;
  const suicide = killer && killer.id === target.id;
  if (killer && !suicide) killer.score += 1;
  if (suicide) target.score = Math.max(0, target.score - 1);
  broadcast({
    type: 'kill',
    killerId: killer ? killer.id : killerId,
    killerScore: killer ? killer.score : 0,
    killerHealth: killer ? killer.health : 0,
    victimId: target.id,
    victimDeaths: target.deaths,
    victimScore: target.score,
    weapon: info.weapon || (killer ? killer.weapon : 'zombie'),
    headshot: info.zone === 'head',
    distance: killer && !suicide ? round1(Math.hypot(killer.x - target.x, killer.z - target.z, (killer.y || 0) - (target.y || 0))) : 0,
    x: round1(target.x),
    y: round1(target.y || 0),
    z: round1(target.z),
  });

  setTimeout(() => {
    if (!players.has(target.id)) return;
    const respawn = safeSpawnFor(target);
    target.x = respawn.x;
    target.y = 0;
    target.z = respawn.z;
    target.health = 100;
    broadcast({ type: 'respawn', id: target.id, x: target.x, z: target.z, health: target.health });
  }, RESPAWN_DELAY_MS);
}

// --- AI (bots + zombies, see ai.js) -------------------------------------

const ai = createAI({
  players,
  broadcast: (m) => broadcast(m),
  damagePlayer,
  activeMap: () => activeMap,
  mode: () => MAP_MODES[activeMap] || 'pvp',
  night: () => NIGHT_MAPS.includes(activeMap),
  friendlyFire: () => friendlyFire,
});

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------

// Puts a connection into the running match (creating it — map, bots — if
// this is the first real player). Used by the lobby when everyone is ready
// and directly for anyone joining a match already in progress.
function enterMatch(ws, msg) {
  const id = nextId++;
  const spawn = nextSpawn();

  if (activeMap === null) {
    activeMap = MAP_IDS.includes(msg.mapPreference) ? msg.mapPreference : DEFAULT_MAP;
    // Default to true (Free For All / Friendly fire enabled) unless explicitly configured otherwise
    friendlyFire = msg.friendlyFire !== false && msg.friendlyFire !== 'false' && msg.friendlyFire !== 0 && msg.friendlyFire !== '0';
  }

  const player = {
    id,
    name: String(msg.name || `Player ${id}`).slice(0, 16),
    weapon: WEAPON_IDS.includes(msg.weapon) ? msg.weapon : 'pistol',
    skin: SKIN_IDS.includes(msg.skin) ? msg.skin : 'red',
    accent: ACCENT_IDS.includes(msg.accent) ? msg.accent : 'black',
    headgear: HEADGEAR_IDS.includes(msg.headgear) ? msg.headgear : 'none',
    x: spawn.x,
    y: 0, // height above ground — lets other clients render jetpack flight correctly
    z: spawn.z,
    angle: 0,
    health: 100,
    score: 0,
    deaths: 0,
    team: Number(msg.team) === 2 ? 2 : 1,
  };

  players.set(id, player);
  ws.playerId = id;

  if (MAP_MODES[activeMap] === 'zombies') ai.startZombies();

  // Spawn requested AI Bots if this is the first real player joining!
  const realPlayersCount = Array.from(players.values()).filter(p => !p.isBot).length;
  if (realPlayersCount === 1) {
    const allyBotsCount = Math.min(10, Math.max(0, Number(msg.allyBotsCount) || 0));
    const enemyBotsCount = Math.min(10, Math.max(0, Number(msg.enemyBotsCount) || 0));

    console.log(`[bots] Spawning requested matches: ${allyBotsCount} Allies and ${enemyBotsCount} Enemies.`);

    // Spawn Ally Bots
    for (let i = 0; i < allyBotsCount; i++) {
      const bId = nextId++;
      const bSpawn = safeSpawnFor({ id: bId, team: 1 });
      const botPlayer = {
        id: bId,
        name: `[BOT] Ally ${String.fromCharCode(65 + i)}`,
        isBot: true,
        team: 1, // Allies
        weapon: WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)],
        skin: 'navy',
        accent: 'white',
        headgear: i % 2 === 0 ? 'helmet' : 'none',
        x: bSpawn.x,
        y: 0,
        z: bSpawn.z,
        angle: 0,
        health: 100,
        score: 0,
        deaths: 0,
        lastShot: 0,
      };
      players.set(bId, botPlayer);
    }

    // Spawn Enemy Bots
    for (let i = 0; i < enemyBotsCount; i++) {
      const bId = nextId++;
      const bSpawn = safeSpawnFor({ id: bId, team: 1 });
      const botPlayer = {
        id: bId,
        name: `[BOT] Enemy ${String.fromCharCode(88 - i)}`, // Enemy X, W, V...
        isBot: true,
        team: 2, // Enemies
        weapon: WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)],
        skin: 'red',
        accent: 'crimson',
        headgear: i % 2 === 1 ? 'cap' : 'none',
        x: bSpawn.x,
        y: 0,
        z: bSpawn.z,
        angle: 0,
        health: 100,
        score: 0,
        deaths: 0,
        lastShot: 0,
      };
      players.set(bId, botPlayer);
    }

    if (allyBotsCount > 0 || enemyBotsCount > 0) ai.startBots();
  }

  ws.send(
    JSON.stringify({
      type: 'welcome',
      id,
      self: player,
      players: playerList(),
      map: activeMap,
      friendlyFire: friendlyFire,
      zombies: ai.zombieList(),
      zombieRound: ai.zombieRound(),
      // The client uploads the map's collision geometry if we don't have
      // this exact version yet (see worldGeo.js).
      geoVersion: getGeo(activeMap)?.version ?? null,
    })
  );
  broadcast({ type: 'join', player }, ws);

  console.log(`[+] ${player.name} connected (id ${id}, map ${activeMap}). Total players: ${players.size}`);
}

// ---------------------------------------------------------------------------
// Pre-game lobby
// ---------------------------------------------------------------------------
// When no match is running, players who deploy wait here: everyone sees who
// is in (name, loadout, ready state) and the match starts once every player
// has readied up (after a short countdown). The first player in is the host —
// their map and bot settings are used. Joining while a match is running goes
// straight into that match.

const LOBBY_COUNTDOWN_MS = 4000;
const lobby = new Map(); // ws -> { lid, msg, ready, joinedAt }
let lobbySeq = 1;
let lobbyCountdown = null; // { endsAt, timer }

function lobbyHost() {
  let host = null;
  for (const [ws, m] of lobby) if (!host || m.joinedAt < host[1].joinedAt) host = [ws, m];
  return host;
}

function lobbyState() {
  const host = lobbyHost();
  const hostMsg = host ? host[1].msg : {};
  return {
    type: 'lobbyState',
    hostId: host ? host[1].lid : null,
    map: MAP_IDS.includes(hostMsg.mapPreference) ? hostMsg.mapPreference : DEFAULT_MAP,
    bots: {
      ally: Math.min(10, Math.max(0, Number(hostMsg.allyBotsCount) || 0)),
      enemy: Math.min(10, Math.max(0, Number(hostMsg.enemyBotsCount) || 0)),
    },
    countdownMs: lobbyCountdown ? Math.max(0, lobbyCountdown.endsAt - Date.now()) : null,
    players: [...lobby.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        lid: m.lid,
        name: String(m.msg.name || 'Player').slice(0, 16),
        weapon: WEAPON_IDS.includes(m.msg.weapon) ? m.msg.weapon : 'pistol',
        skin: SKIN_IDS.includes(m.msg.skin) ? m.msg.skin : 'woodland',
        accent: ACCENT_IDS.includes(m.msg.accent) ? m.msg.accent : 'black',
        headgear: HEADGEAR_IDS.includes(m.msg.headgear) ? m.msg.headgear : 'none',
        team: Number(m.msg.team) === 2 ? 2 : 1,
        ready: m.ready,
        host: host && m.lid === host[1].lid,
      })),
  };
}

function broadcastLobby() {
  const state = lobbyState();
  for (const [ws, m] of lobby) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...state, you: m.lid }));
  }
}

function cancelCountdown() {
  if (lobbyCountdown) {
    clearTimeout(lobbyCountdown.timer);
    lobbyCountdown = null;
  }
}

function checkLobbyReady() {
  const everyoneReady = lobby.size > 0 && [...lobby.values()].every((m) => m.ready);
  if (!everyoneReady) {
    cancelCountdown();
  } else if (!lobbyCountdown) {
    lobbyCountdown = { endsAt: Date.now() + LOBBY_COUNTDOWN_MS, timer: setTimeout(launchLobby, LOBBY_COUNTDOWN_MS) };
  }
  broadcastLobby();
}

function launchLobby() {
  lobbyCountdown = null;
  const members = [...lobby.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  if (!members.length || !members.every(([, m]) => m.ready)) return broadcastLobby();
  lobby.clear();
  console.log(`[lobby] All ${members.length} player(s) ready — starting the match.`);
  // Host first: their join sets the map and spawns the bots.
  for (const [ws, m] of members) {
    if (ws.readyState === WebSocket.OPEN) enterMatch(ws, m.msg);
  }
}

function matchRunning() {
  return playerList().some((pl) => !pl.isBot);
}

const wss = new WebSocketServer({ server: httpServer });

function broadcast(message, exclude) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      client.send(data);
    }
  }
}

// Heartbeat: drop connections that stop answering pings (crashed or frozen
// tabs, dropped Wi-Fi), so a dead client can't keep the match — and its map
// lock — alive forever.
setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      console.log(`[-] Dropping unresponsive connection (player ${client.playerId})`);
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 5000);

wss.on('connection', (ws) => {
  ws.playerId = null; // not assigned until the client's 'join' message arrives
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed messages
    }

    // First message from any connection must be 'join' — it carries the
    // player's name and loadout, and (for the first joiner only) which
    // map the match will use.
    if (ws.playerId === null) {
      if (msg.type === 'join') {
        if (matchRunning()) {
          enterMatch(ws, msg); // match in progress: jump straight in
        } else {
          lobby.set(ws, { lid: lobbySeq++, msg, ready: false, joinedAt: Date.now() });
          console.log(`[lobby] ${String(msg.name || "Player").slice(0, 16)} joined the lobby (${lobby.size} waiting).`);
          checkLobbyReady();
        }
        return;
      }
      const entry = lobby.get(ws);
      if (!entry) return;
      if (msg.type === 'ready') {
        entry.ready = !!msg.ready;
        checkLobbyReady();
      } else if (msg.type === 'lobbyUpdate') {
        // Loadout changes while waiting (the host may also change the map).
        for (const k of ['weapon', 'skin', 'accent', 'headgear', 'team', 'name']) if (k in msg) entry.msg[k] = msg[k];
        if (lobbyHost()?.[0] === ws && 'mapPreference' in msg) entry.msg.mapPreference = msg.mapPreference;
        broadcastLobby();
      }
      return;
    }

    const p = players.get(ws.playerId);
    if (!p) return;

    switch (msg.type) {
      case 'update': {
        if (typeof msg.x === 'number' && typeof msg.z === 'number' && typeof msg.angle === 'number') {
          if (p.health <= 0) break; // dead players don't move
          p.moving = Math.hypot(msg.x - p.x, msg.z - p.z) > 0.01;
          p.x = msg.x;
          p.z = msg.z;
          p.angle = msg.angle;
          if (typeof msg.y === 'number') p.y = msg.y;
          if (WEAPON_IDS.includes(msg.weapon)) p.weapon = msg.weapon;
          if (typeof msg.pitch === 'number') p.pitch = msg.pitch;
          p.crouching = !!msg.c;

          broadcast({
            type: 'update',
            id: p.id,
            x: p.x,
            y: p.y,
            z: p.z,
            angle: p.angle,
            pitch: typeof msg.pitch === 'number' ? msg.pitch : 0,
            weapon: p.weapon,
            c: p.crouching ? 1 : 0,
            s: typeof msg.s === 'number' ? Math.min(20, Math.max(0, msg.s)) : 0,
            f: msg.f ? 1 : 0,
          }, ws);
        }
        break;
      }

      case 'ping': {
        if (typeof msg.t === 'number') ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
      }

      case 'shoot': {
        // Origin + per-pellet end points, so every client draws the
        // shooter's real tracer paths (capped and sanitised).
        const isPoint = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
        const ends = Array.isArray(msg.ends) ? msg.ends.filter(isPoint).slice(0, 12) : [];
        ai.onNoise(p);
        broadcast({
          type: 'shoot',
          id: p.id,
          weapon: p.weapon,
          o: isPoint(msg.o) ? msg.o : [p.x, (p.y || 0) + 1.5, p.z],
          ends,
        }, ws);
        break;
      }

      case 'grenade': {
        const nums = [msg.x, msg.y, msg.z, msg.vx, msg.vy, msg.vz, msg.fuse];
        if (nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          broadcast({
            type: 'grenade',
            id: String(msg.gid || '').slice(0, 24),
            ownerId: p.id,
            x: msg.x, y: msg.y, z: msg.z, vx: msg.vx, vy: msg.vy, vz: msg.vz,
            fuse: Math.min(5000, Math.max(0, msg.fuse)),
          }, ws);
        }
        break;
      }

      // Killstreaks: relayed to everyone else (the caller's client runs
      // its own copy and is authoritative for the airstrike's damage).
      case 'uav': {
        broadcast({ type: 'uav', ownerId: p.id, team: p.team }, ws);
        break;
      }

      case 'airstrike': {
        const nums = [msg.x, msg.z, msg.dx, msg.dz];
        if (nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          broadcast({ type: 'airstrike', ownerId: p.id, x: msg.x, z: msg.z, dx: msg.dx, dz: msg.dz }, ws);
        }
        break;
      }

      case 'selfHit': {
        // Your own grenade/rocket. Counts as a suicide, not a kill.
        const damage = Math.min(200, Math.max(1, Number(msg.damage) || 0));
        const weapon = DAMAGE_SOURCES.includes(msg.weapon) ? msg.weapon : 'grenade';
        damagePlayer(p, damage, p.id, { weapon, zone: 'body' });
        break;
      }

      case 'rocket': {
        const nums = [msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz];
        if (nums.every((n) => typeof n === 'number')) {
          broadcast({ type: 'rocket', id: p.id, x: msg.x, y: msg.y, z: msg.z, dx: msg.dx, dy: msg.dy, dz: msg.dz }, ws);
        }
        break;
      }

      case 'explosion': {
        if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.z === 'number') {
          broadcast({
            type: 'explosion',
            id: p.id,
            x: msg.x, y: msg.y, z: msg.z,
            kind: ['grenade', 'airstrike'].includes(msg.kind) ? msg.kind : 'rocket',
            gid: msg.gid ? String(msg.gid).slice(0, 24) : undefined,
          }, ws);
        }
        break;
      }

      case 'hit': {
        const target = players.get(msg.targetId);
        if (!target || target.id === p.id || target.health <= 0 || p.health <= 0) return;
        if (!friendlyFire && target.team === p.team) return; // Prevent friendly-fire unless friendlyFire is enabled
        const damage = Math.min(300, Math.max(1, Number(msg.damage) || 20));
        const zone = ['head', 'body', 'legs'].includes(msg.zone) ? msg.zone : 'body';
        const weapon = DAMAGE_SOURCES.includes(msg.weapon) ? msg.weapon : p.weapon;
        damagePlayer(target, damage, p.id, { weapon, zone });
        break;
      }

      case 'zombieHit': {
        if (typeof msg.targetId !== 'string') return;
        ai.damageZombie(msg.targetId, Math.min(300, Math.max(1, Number(msg.damage) || 20)), p.id);
        break;
      }

      case 'worldGeo': {
        // Collision geometry for the running map (sent once per new version).
        if (msg.map !== activeMap || typeof msg.version !== 'string') break;
        if (getGeo(activeMap)?.version === msg.version) break;
        setGeoFromClient(activeMap, msg.c, Number(msg.bounds), msg.version.slice(0, 64));
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (lobby.has(ws)) {
      lobby.delete(ws);
      checkLobbyReady();
    }
    if (ws.playerId !== null) {
      players.delete(ws.playerId);
      broadcast({ type: 'leave', id: ws.playerId });
      console.log(`[-] Player ${ws.playerId} disconnected. Total players: ${players.size}`);
      
      const realPlayersRemaining = Array.from(players.values()).filter(p => !p.isBot).length;
      if (realPlayersRemaining === 0) {
        // Clear all AI bots out of the players list
        for (const p of players.values()) {
          if (p.isBot) broadcast({ type: 'leave', id: p.id });
        }
        for (const [id, p] of players.entries()) {
          if (p.isBot) players.delete(id);
        }
        
        activeMap = null; // next match's first joiner picks fresh
        friendlyFire = true;
        ai.stopZombies();
        ai.stopBots();
        console.log('  All real players left — map and AI bots cleared.');
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error (player ${ws.playerId}):`, err.message);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  const localAddresses = getLocalIPv4Addresses();

  console.log('='.repeat(60));
  console.log('  DOOM-clone server is running');
  console.log('='.repeat(60));
  console.log(`  On this machine:        http://localhost:${PORT}`);
  if (localAddresses.length > 0) {
    for (const { name, address, likelyVirtual } of localAddresses) {
      const note = likelyVirtual ? ' (virtual adapter — probably not reachable by a friend)' : '';
      console.log(`  ${name}: http://${address}:${PORT}${note}`);
    }
  } else {
    console.log('  Could not detect a LAN address — check your network connection.');
  }
  console.log('  For the internet, see README.md (port forwarding).');
  console.log('  (The lobby screen also shows these addresses automatically.)');
  console.log('='.repeat(60));
});

// Health regeneration: after 5s without taking damage, living players
// recover health gradually (server-side, so every client agrees on it).
const REGEN_DELAY_MS = 5000;
const REGEN_PER_TICK = 8;
setInterval(() => {
  const now = Date.now();
  for (const pl of players.values()) {
    if (pl.health <= 0 || pl.health >= 100) continue;
    if (now - (pl.lastDamaged || 0) < REGEN_DELAY_MS) continue;
    pl.health = Math.min(100, pl.health + REGEN_PER_TICK);
    broadcast({ type: 'health', id: pl.id, health: pl.health, attackerId: null });
  }
}, 400);
