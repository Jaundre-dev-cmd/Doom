/**
 * DOOM-clone game server.
 *
 * Responsibilities:
 *  - Serves the static client (public/) over plain HTTP.
 *  - Runs a WebSocket relay that keeps connected players in sync:
 *    positions, shots, hits, kills, health, spawns and respawns.
 *  - For the Zombies co-op map, also *simulates* the zombies themselves
 *    (spawning, chasing, melee, round progression) — this is the one
 *    place the server does more than relay, because AI needs a single
 *    source of truth that every connected player agrees on.
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

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Keep these in sync with public/js/constants.js.
const WEAPON_IDS = ['pistol', 'shotgun', 'chaingun', 'rocket', 'ak47'];
const SKIN_IDS = ['red', 'blue', 'olive', 'desert', 'black', 'gold'];
const ACCENT_IDS = ['black', 'white', 'crimson', 'tan'];
const HEADGEAR_IDS = ['none', 'helmet', 'cap'];
const MAP_IDS = ['forest', 'techbase', 'zombies'];
const MAP_MODES = { forest: 'pvp', techbase: 'pvp', zombies: 'zombies' };
const DEFAULT_MAP = 'forest';

// Zombies mode tuning — keep in sync with public/js/constants.js.
const ZOMBIE_SPAWN_POINTS = [
  { x: -55, z: -55 },
  { x: 55, z: -55 },
  { x: -55, z: 55 },
  { x: 55, z: 55 },
  { x: 0, z: -70 },
  { x: 0, z: 70 },
  { x: -70, z: 0 },
  { x: 70, z: 0 },
];
const ZOMBIE_BASE_HEALTH = 100;
const ZOMBIE_HEALTH_PER_ROUND = 25;
const ZOMBIE_SPEED = 2.4;
const ZOMBIE_DAMAGE = 10;
const ZOMBIE_ATTACK_RANGE = 1.5;
const ZOMBIE_ATTACK_COOLDOWN_MS = 1000;
const ZOMBIES_PER_ROUND_BASE = 4;
const ZOMBIES_PER_ROUND_INCREMENT = 2;
const ROUND_INTERMISSION_MS = 8000;
const FIRST_ROUND_DELAY_MS = 5000;
const ZOMBIE_TICK_MS = 120;

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
    res.end(JSON.stringify({ port: PORT, localAddresses: getLocalIPv4Addresses() }));
    return;
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
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

// Zombies mode state — only used when MAP_MODES[activeMap] === 'zombies'.
const zombies = new Map(); // id -> zombie state
let nextZombieId = 1;
let zombieRound = 0;
let zombieTickInterval = null;
let roundTimer = null;

function nextSpawn() {
  const spawn = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
  spawnIndex += 1;
  return spawn;
}

function playerList() {
  return Array.from(players.values());
}

// Shared by player-vs-player hits and zombie melee attacks. `killerId` is
// a player id for a PvP kill (awards score + a 'kill' broadcast), or null
// for a zombie-caused death (just health + respawn, no score).
function damagePlayer(target, damage, killerId) {
  if (target.health <= 0) return;

  target.health = Math.max(0, target.health - damage);
  broadcast({ type: 'health', id: target.id, health: target.health });

  if (target.health === 0) {
    if (killerId !== null) {
      const killer = players.get(killerId);
      if (killer) {
        killer.score += 1;
        broadcast({ type: 'kill', killerId: killer.id, killerScore: killer.score, victimId: target.id });
      }
    }

    setTimeout(() => {
      const respawn = nextSpawn();
      target.x = respawn.x;
      target.y = 0;
      target.z = respawn.z;
      target.health = 100;
      broadcast({ type: 'respawn', id: target.id, x: target.x, z: target.z, health: target.health });
    }, 1500);
  }
}

// --- Zombies AI --------------------------------------------------------

function spawnZombieRound() {
  zombieRound += 1;
  const count = ZOMBIES_PER_ROUND_BASE + (zombieRound - 1) * ZOMBIES_PER_ROUND_INCREMENT;
  const health = ZOMBIE_BASE_HEALTH + (zombieRound - 1) * ZOMBIE_HEALTH_PER_ROUND;

  for (let i = 0; i < count; i++) {
    const spawn = ZOMBIE_SPAWN_POINTS[Math.floor(Math.random() * ZOMBIE_SPAWN_POINTS.length)];
    const id = `z${nextZombieId++}`;
    zombies.set(id, { id, x: spawn.x, z: spawn.z, health, maxHealth: health, lastAttack: 0 });
  }

  broadcast({ type: 'roundStart', round: zombieRound, zombieCount: count });
  console.log(`[zombies] Round ${zombieRound} started: ${count} zombies at ${health} HP each.`);
}

function maybeStartNextRound() {
  if (zombies.size > 0 || players.size === 0) return;
  broadcast({ type: 'roundClear', round: zombieRound, nextInMs: ROUND_INTERMISSION_MS });
  console.log(`[zombies] Round ${zombieRound} cleared. Next round in ${ROUND_INTERMISSION_MS / 1000}s.`);
  clearTimeout(roundTimer);
  roundTimer = setTimeout(spawnZombieRound, ROUND_INTERMISSION_MS);
}

function zombieTick() {
  if (zombies.size === 0) return;

  const dt = ZOMBIE_TICK_MS / 1000;
  const alivePlayers = Array.from(players.values()).filter((pl) => pl.health > 0);
  const now = Date.now();
  const updates = [];

  for (const zombie of zombies.values()) {
    if (alivePlayers.length > 0) {
      let nearest = alivePlayers[0];
      let nearestDist = Infinity;
      for (const pl of alivePlayers) {
        const d = Math.hypot(pl.x - zombie.x, pl.z - zombie.z);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = pl;
        }
      }

      if (nearestDist > ZOMBIE_ATTACK_RANGE) {
        const dx = nearest.x - zombie.x;
        const dz = nearest.z - zombie.z;
        const len = Math.hypot(dx, dz) || 1;
        zombie.x += (dx / len) * ZOMBIE_SPEED * dt;
        zombie.z += (dz / len) * ZOMBIE_SPEED * dt;
      } else if (now - zombie.lastAttack > ZOMBIE_ATTACK_COOLDOWN_MS) {
        zombie.lastAttack = now;
        damagePlayer(nearest, ZOMBIE_DAMAGE, null);
      }
    }

    updates.push({ id: zombie.id, x: zombie.x, z: zombie.z, health: zombie.health });
  }

  broadcast({ type: 'zombieTick', zombies: updates });
}

function startZombieMode() {
  if (zombieTickInterval !== null) return; // already running
  zombieTickInterval = setInterval(zombieTick, ZOMBIE_TICK_MS);
  roundTimer = setTimeout(spawnZombieRound, FIRST_ROUND_DELAY_MS);
  console.log(`[zombies] Mode started. Round 1 begins in ${FIRST_ROUND_DELAY_MS / 1000}s.`);
}

function stopZombieMode() {
  if (zombieTickInterval !== null) {
    clearInterval(zombieTickInterval);
    zombieTickInterval = null;
  }
  clearTimeout(roundTimer);
  roundTimer = null;
  zombies.clear();
  zombieRound = 0;
}

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

function broadcast(message, exclude) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  ws.playerId = null; // not assigned until the client's 'join' message arrives

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
      if (msg.type !== 'join') return;

      const id = nextId++;
      const spawn = nextSpawn();

      if (activeMap === null) {
        activeMap = MAP_IDS.includes(msg.mapPreference) ? msg.mapPreference : DEFAULT_MAP;
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
      };

      players.set(id, player);
      ws.playerId = id;

      if (MAP_MODES[activeMap] === 'zombies') startZombieMode();

      ws.send(
        JSON.stringify({
          type: 'welcome',
          id,
          self: player,
          players: playerList(),
          map: activeMap,
          zombies: Array.from(zombies.values()),
          zombieRound,
        })
      );
      broadcast({ type: 'join', player }, ws);

      console.log(`[+] ${player.name} connected (id ${id}, map ${activeMap}). Total players: ${players.size}`);
      return;
    }

    const p = players.get(ws.playerId);
    if (!p) return;

    switch (msg.type) {
      case 'update': {
        if (typeof msg.x === 'number' && typeof msg.z === 'number' && typeof msg.angle === 'number') {
          p.x = msg.x;
          p.z = msg.z;
          p.angle = msg.angle;
          if (typeof msg.y === 'number') p.y = msg.y; // jetpack height, optional for older clients
          broadcast({ type: 'update', id: p.id, x: p.x, y: p.y, z: p.z, angle: p.angle }, ws);
        }
        break;
      }

      case 'shoot': {
        broadcast({ type: 'shoot', id: p.id, x: p.x, z: p.z, angle: p.angle }, ws);
        break;
      }

      case 'hit': {
        const target = players.get(msg.targetId);
        if (!target || target.id === p.id || target.health <= 0) return;
        const damage = Math.min(100, Math.max(1, Number(msg.damage) || 20));
        damagePlayer(target, damage, p.id);
        break;
      }

      case 'zombieHit': {
        const zombie = zombies.get(msg.targetId);
        if (!zombie || zombie.health <= 0) return;

        const damage = Math.min(300, Math.max(1, Number(msg.damage) || 20));
        zombie.health = Math.max(0, zombie.health - damage);
        broadcast({ type: 'zombieHealth', id: zombie.id, health: zombie.health });

        if (zombie.health === 0) {
          zombies.delete(zombie.id);
          broadcast({ type: 'zombieDeath', id: zombie.id, killerId: p.id });
          maybeStartNextRound();
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.playerId !== null) {
      players.delete(ws.playerId);
      broadcast({ type: 'leave', id: ws.playerId });
      console.log(`[-] Player ${ws.playerId} disconnected. Total players: ${players.size}`);
      if (players.size === 0) {
        activeMap = null; // next match's first joiner picks fresh
        stopZombieMode();
        console.log('  All players left — map will be re-selected by the next joiner.');
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
