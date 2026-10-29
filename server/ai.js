/**
 * Server-side AI: combat bots and survival zombies.
 *
 * Everything here respects the map's real geometry (worldGeo.js): bots only
 * see and shoot what they have a clear line of sight to, tracers stop at the
 * wall they hit, and both bots and zombies walk A* paths around buildings,
 * trees and rocks instead of through them.
 *
 * Bots behave like players: they notice enemies in their field of view (or
 * hear gunfire / get shot), take a moment to react, turn at a human speed,
 * and their aim settles the longer they track a target. Rifles fire in
 * bursts, everything reloads. When they lose sight of someone they push to
 * the last known position, search the area, then go back to patrolling.
 *
 * Zombies come in waves: shambling walkers and (from round 2) sprinting
 * runners. They spawn out of everyone's sight, path toward the nearest
 * living player, crowd around without overlapping, and attack with a short
 * wind-up that clients animate.
 */

const { getGeo } = require('./worldGeo');

const BOT_TICK_MS = 60;
const ZOMBIE_TICK_MS = 100;

// Server-side weapon handling (bots don't run the client's raycasts).
//   accuracy: base chance a settled shot connects at short range
//   burst:    [min, max] rounds per trigger pull (1 = semi-auto)
//   prefer:   distance the bot tries to fight at
const BOT_WEAPONS = {
  pistol: { damage: 24, cooldown: 330, range: 55, accuracy: 0.6, mag: 17, reload: 1700, burst: [1, 1], prefer: 14 },
  shotgun: { damage: 70, cooldown: 900, range: 20, accuracy: 0.8, mag: 7, reload: 2600, burst: [1, 1], prefer: 7, falloff: 1.6 },
  chaingun: { damage: 13, cooldown: 85, range: 65, accuracy: 0.42, mag: 100, reload: 4200, burst: [10, 22], prefer: 22 },
  rocket: { damage: 90, cooldown: 1800, range: 70, accuracy: 0.55, mag: 1, reload: 2500, burst: [1, 1], prefer: 25 },
  ak47: { damage: 27, cooldown: 110, range: 90, accuracy: 0.5, mag: 30, reload: 2400, burst: [3, 6], prefer: 26 },
  m4a1: { damage: 24, cooldown: 90, range: 90, accuracy: 0.55, mag: 30, reload: 2200, burst: [3, 5], prefer: 26 },
  mp5: { damage: 19, cooldown: 75, range: 55, accuracy: 0.5, mag: 30, reload: 2000, burst: [4, 8], prefer: 15 },
  awp: { damage: 110, cooldown: 1500, range: 160, accuracy: 0.72, mag: 5, reload: 3200, burst: [1, 1], prefer: 45 },
};

// Zombie waves — tuned for 1–4 players.
const ZOMBIE = {
  walker: { speed: [1.1, 1.7], health: 1, damage: 18, reach: 1.55, windup: 520 },
  runner: { speed: [4.4, 5.4], health: 0.7, damage: 12, reach: 1.45, windup: 360 },
  attackCooldown: 1150,
  baseHealth: 110,
  healthPerRound: 30,
  intermission: 10000,
  firstDelay: 6000,
};

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const round1 = (n) => Math.round(n * 10) / 10;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Yaw convention shared with the client: forward = (-sin a, -cos a).
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

function createAI(ctx) {
  const { players, broadcast, damagePlayer } = ctx;
  const geo = () => (ctx.activeMap() ? getGeo(ctx.activeMap()) : null);

  // =========================================================================
  // Bots
  // =========================================================================
  let botTimer = null;
  let tickNo = 0;
  const noises = []; // recent gunfire { x, z, at, id }

  function startBots() {
    if (botTimer) return;
    botTimer = setInterval(botTick, BOT_TICK_MS);
    console.log('[bots] AI started.');
  }

  function stopBots() {
    if (!botTimer) return;
    clearInterval(botTimer);
    botTimer = null;
    noises.length = 0;
    console.log('[bots] AI stopped.');
  }

  function brain(bot) {
    if (!bot.ai) {
      bot.ai = {
        state: 'patrol',
        path: null,
        pathGoal: null,
        repathAt: 0,
        targetId: null,
        lastSeen: null,
        lastSeenAt: 0,
        reactUntil: 0,
        aimError: 1,
        ammo: (BOT_WEAPONS[bot.weapon] || BOT_WEAPONS.pistol).mag,
        reloadUntil: 0,
        burstLeft: 0,
        nextShotAt: 0,
        strafeDir: 1,
        strafeUntil: 0,
        investigate: null,
        searchUntil: 0,
        skill: rand(0.75, 1.1),
        wasDead: false,
        perceiveOffset: randInt(0, 2),
      };
    }
    return bot.ai;
  }

  function isEnemy(bot, other) {
    if (other.id === bot.id || other.health <= 0) return false;
    if (ctx.mode() === 'zombies') return false; // bots fight the horde, not players
    if (ctx.friendlyFire()) return true;
    return other.team !== bot.team;
  }

  // Candidate targets: enemy players/bots, plus zombies in survival.
  function botTargets(bot) {
    const list = [];
    for (const p of players.values()) {
      if (isEnemy(bot, p)) list.push({ kind: 'player', id: p.id, x: p.x, y: p.y || 0, z: p.z, crouching: p.crouching, moving: p.moving, ref: p });
    }
    if (ctx.mode() === 'zombies') {
      for (const z of zombies.values()) {
        if (z.health > 0 && z.spawned) list.push({ kind: 'zombie', id: z.id, x: z.x, y: 0, z: z.z, crouching: false, moving: z.speedNow > 0.3, ref: z });
      }
    }
    return list;
  }

  const eyeOf = (e) => ({ x: e.x, y: (e.y || 0) + (e.crouching ? 1.05 : 1.55), z: e.z });
  const chestOf = (e) => ({ x: e.x, y: (e.y || 0) + (e.crouching ? 0.8 : 1.2), z: e.z });
  const headOf = (e) => ({ x: e.x, y: (e.y || 0) + (e.crouching ? 1.1 : 1.62), z: e.z });

  function canSee(bot, t, g, sightRange) {
    const dx = t.x - bot.x;
    const dz = t.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > sightRange) return false;
    // Field of view ~140°, but anyone right next to you is noticed.
    if (dist > 6) {
      const off = Math.abs(wrapAngle(yawTo(bot.x, bot.z, t.x, t.z) - bot.angle));
      if (off > 1.22) return false;
    }
    if (!g) return false; // no geometry yet: never shoot blind through walls
    const eye = eyeOf(bot);
    return g.lineOfSight(eye, chestOf(t)) || g.lineOfSight(eye, headOf(t));
  }

  function setPath(bot, ai, g, goal, now) {
    ai.pathGoal = { x: goal.x, z: goal.z };
    ai.path = g ? g.findPath(bot, goal) : [{ x: goal.x, z: goal.z }];
    ai.repathAt = now + rand(900, 1500);
  }

  // Walk along the current path; returns true while moving.
  function followPath(bot, ai, g, speed, dt, faceMove) {
    if (!ai.path || !ai.path.length) return false;
    let wp = ai.path[0];
    let d = Math.hypot(wp.x - bot.x, wp.z - bot.z);
    while (d < 0.6 && ai.path.length > 1) {
      ai.path.shift();
      wp = ai.path[0];
      d = Math.hypot(wp.x - bot.x, wp.z - bot.z);
    }
    if (d < 0.6) {
      ai.path = null;
      return false;
    }
    const step = Math.min(d, speed * dt);
    bot.x += ((wp.x - bot.x) / d) * step;
    bot.z += ((wp.z - bot.z) / d) * step;
    if (faceMove) turnToward(bot, yawTo(bot.x, bot.z, wp.x, wp.z), dt, 5);
    return true;
  }

  function turnToward(bot, yaw, dt, rate) {
    const diff = wrapAngle(yaw - bot.angle);
    const max = rate * dt;
    bot.angle = wrapAngle(bot.angle + Math.max(-max, Math.min(max, diff)));
    return Math.abs(diff);
  }

  function botTick() {
    const dt = BOT_TICK_MS / 1000;
    const now = Date.now();
    tickNo++;
    const g = geo();
    const night = ctx.night();
    const sightRange = night ? 55 : 95;
    if (process.env.AI_DEBUG && tickNo % 80 === 0) {
      const bots = [...players.values()].filter((b) => b.isBot);
      const fmt = (b) => `${b.name}:${b.ai?.state || '-'}@${b.x.toFixed(0)},${b.z.toFixed(0)} hp${b.health}${g && !g.isWalkable(b.x, b.z) ? ' BLOCKED' : ''}`;
      console.log('[ai]', bots.map(fmt).join(' | '));
    }
    while (noises.length && now - noises[0].at > 2500) noises.shift();

    for (const bot of players.values()) {
      if (!bot.isBot) continue;
      const ai = brain(bot);
      if (bot.health <= 0) {
        ai.wasDead = true;
        continue;
      }
      if (ai.wasDead) {
        // Fresh life: full mag, forget everything.
        ai.wasDead = false;
        ai.state = 'patrol';
        ai.path = null;
        ai.targetId = null;
        ai.lastSeen = null;
        ai.ammo = (BOT_WEAPONS[bot.weapon] || BOT_WEAPONS.pistol).mag;
        ai.reloadUntil = 0;
        if (g && !g.isWalkable(bot.x, bot.z)) {
          const free = g.randomPointNear(bot.x, bot.z, 8);
          if (free) Object.assign(bot, free);
        }
      }
      const tuning = BOT_WEAPONS[bot.weapon] || BOT_WEAPONS.pistol;

      // --- Perception (every 3rd tick, staggered between bots) ---
      let target = null;
      const targets = botTargets(bot);
      const cur = targets.find((t) => t.id === ai.targetId);
      if ((tickNo + ai.perceiveOffset) % 3 === 0 || !cur) {
        let best = null;
        let bestScore = Infinity;
        for (const t of targets) {
          if (!canSee(bot, t, g, sightRange)) continue;
          const dist = Math.hypot(t.x - bot.x, t.z - bot.z);
          const score = dist * (t.id === ai.targetId ? 0.6 : 1); // stick with the current target
          if (score < bestScore) {
            bestScore = score;
            best = t;
          }
        }
        ai.visible = best;
      } else if (cur && ai.visible?.id === cur.id) {
        ai.visible = cur; // refresh position
      } else if (!cur) {
        ai.visible = null;
      }
      target = ai.visible || null;

      if (target) {
        if (target.id !== ai.targetId) {
          ai.targetId = target.id;
          // Human reaction time; faster if we were already expecting trouble.
          const alert = ai.state === 'chase' || ai.state === 'search' || now - ai.lastSeenAt < 3000;
          ai.reactUntil = now + (alert ? rand(180, 320) : rand(320, 620)) / ai.skill;
          ai.aimError = 1;
        }
        ai.lastSeen = { x: target.x, z: target.z };
        ai.lastSeenAt = now;
        ai.state = 'engage';
      } else if (ai.state === 'engage') {
        ai.state = 'chase';
        ai.path = null;
      }

      // Gunfire nearby or being shot turns the bot toward the noise.
      if (!target && ai.state !== 'chase') {
        for (const n of noises) {
          if (n.id === bot.id) continue;
          const src = players.get(n.id);
          if (src && !isEnemy(bot, src)) continue;
          const d = Math.hypot(n.x - bot.x, n.z - bot.z);
          if (d < (n.loud ? 70 : 40)) {
            ai.investigate = { x: n.x, z: n.z };
            ai.state = 'investigate';
            ai.path = null;
          }
        }
      }

      // --- Decide movement ---
      let moving = false;
      let speed = 3.4;
      const reloading = now < ai.reloadUntil;
      if (ai.state === 'engage' && target) {
        const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
        const desiredYaw = yawTo(bot.x, bot.z, target.x, target.z);
        const aimOff = turnToward(bot, desiredYaw, dt, 7 * ai.skill);
        bot.pitch = Math.atan2(chestOf(target).y - eyeOf(bot).y, Math.max(0.1, dist));

        if (dist > tuning.prefer * 1.35 || dist > tuning.range * 0.9) {
          // Close the distance along a real path.
          if (!ai.path || now > ai.repathAt) setPath(bot, ai, g, target, now);
          moving = followPath(bot, ai, g, speed * 0.85, dt, false);
          bot.crouching = false;
        } else if (target.kind === 'zombie' ? dist < 7 : dist < tuning.prefer * 0.45) {
          // Too close for this weapon (or a zombie in our face): back off.
          moving = strafe(bot, ai, g, desiredYaw + Math.PI, speed * 0.6, dt);
        } else {
          // In range: strafe / crouch-peek like a player.
          if (now > ai.strafeUntil) {
            ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
            ai.strafeUntil = now + rand(700, 1900);
            bot.crouching = bot.weapon === 'awp' ? Math.random() < 0.7 : Math.random() < 0.3;
            ai.holdStill = Math.random() < (bot.weapon === 'awp' ? 0.7 : 0.25);
          }
          if (!ai.holdStill && !bot.crouching) {
            moving = strafe(bot, ai, g, desiredYaw + (Math.PI / 2) * ai.strafeDir, speed * 0.55, dt);
            if (!moving) ai.strafeDir *= -1;
          }
        }
        ai.path = moving && ai.path ? ai.path : null;

        // Aim settles while tracking; moving (us or them) spoils it.
        const settle = 1 - Math.exp(-dt / (0.55 / ai.skill));
        ai.aimError += (0 - ai.aimError) * settle;
        if (moving) ai.aimError = Math.max(ai.aimError, 0.35);
        if (aimOff > 0.25) ai.aimError = Math.max(ai.aimError, Math.min(1, aimOff));

        tryShoot(bot, ai, tuning, target, dist, aimOff, g, now, moving);
      } else {
        bot.crouching = false;
        let goal = null;
        if (ai.state === 'chase') {
          goal = ai.lastSeen;
          speed = 4.6;
          if (!goal || now - ai.lastSeenAt > 9000) {
            ai.state = 'search';
            ai.searchUntil = now + rand(5000, 9000);
            goal = null;
          }
        } else if (ai.state === 'investigate') {
          goal = ai.investigate;
          speed = 4.2;
        }
        if (ai.state === 'search') {
          if (now > ai.searchUntil) ai.state = 'patrol';
          else if (!ai.path && g) {
            const c = ai.lastSeen || bot;
            goal = g.randomPointNear(c.x, c.z, 14);
          }
        }
        if (ai.state === 'patrol' && !ai.path && g) {
          // Survival: stay with the squad. Otherwise wander between random
          // reachable spots, favouring the map centre.
          const lead = ctx.mode() === 'zombies' ? [...players.values()].find((p) => !p.isBot && p.health > 0) : null;
          goal = lead ? g.randomPointNear(lead.x, lead.z, 9) : g.randomPointNear(bot.x * 0.6, bot.z * 0.6, 45);
        }
        if (goal && (!ai.path || now > ai.repathAt || Math.hypot(goal.x - ai.pathGoal?.x, goal.z - ai.pathGoal?.z) > 3)) {
          setPath(bot, ai, g, goal, now);
        }
        moving = followPath(bot, ai, g, ai.state === 'patrol' ? 2.6 : speed, dt, true);
        if (!moving && ai.state === 'investigate') {
          ai.state = 'search';
          ai.searchUntil = now + rand(3000, 6000);
          ai.lastSeen = ai.investigate;
        }
        bot.pitch = (bot.pitch || 0) * 0.9;
        // Top up the magazine between fights.
        if (!reloading && ai.ammo < tuning.mag * 0.5) startReload(bot, ai, tuning, now);
      }

      if (g) Object.assign(bot, g.resolve(bot.x, bot.z, 0.4, 0));
      else {
        bot.x = Math.max(-105, Math.min(105, bot.x));
        bot.z = Math.max(-105, Math.min(105, bot.z));
      }
      bot.moving = moving;

      broadcast({
        type: 'update',
        id: bot.id,
        x: bot.x,
        y: bot.y || 0,
        z: bot.z,
        angle: bot.angle,
        pitch: bot.pitch || 0,
        weapon: bot.weapon || 'pistol',
        c: bot.crouching ? 1 : 0,
        s: moving ? speed : 0,
      });
    }
  }

  function strafe(bot, ai, g, yaw, speed, dt) {
    const nx = bot.x - Math.sin(yaw) * speed * dt;
    const nz = bot.z - Math.cos(yaw) * speed * dt;
    // Peek ahead: don't strafe into walls or off ledges of the nav grid.
    const ax = bot.x - Math.sin(yaw) * 0.9;
    const az = bot.z - Math.cos(yaw) * 0.9;
    if (g && !g.isWalkable(ax, az)) return false;
    bot.x = nx;
    bot.z = nz;
    return true;
  }

  function startReload(bot, ai, tuning, now) {
    ai.reloadUntil = now + tuning.reload;
    ai.ammo = tuning.mag;
    ai.burstLeft = 0;
  }

  function tryShoot(bot, ai, tuning, target, dist, aimOff, g, now, moving) {
    if (now < ai.reactUntil || now < ai.reloadUntil || now < ai.nextShotAt) return;
    if (dist > tuning.range || aimOff > 0.2 || !g) return;
    if (ai.ammo <= 0) return startReload(bot, ai, tuning, now);

    if (ai.burstLeft <= 0) ai.burstLeft = randInt(tuning.burst[0], tuning.burst[1]);
    ai.burstLeft--;
    ai.ammo--;
    ai.nextShotAt = now + tuning.cooldown * rand(0.95, 1.15);
    if (ai.burstLeft <= 0 && tuning.burst[1] > 1) ai.nextShotAt += rand(220, 650); // pause between bursts

    const eye = eyeOf(bot);
    const muzzle = { x: eye.x - Math.sin(bot.angle) * 0.5, y: eye.y - 0.12, z: eye.z - Math.cos(bot.angle) * 0.5 };
    // Accuracy: weapon × distance falloff × how settled the aim is × motion.
    const falloff = Math.max(0.08, 1 - Math.pow(dist / tuning.range, tuning.falloff || 1.15));
    let p = tuning.accuracy * falloff * (1 - ai.aimError * 0.85) * ai.skill;
    if (target.crouching) p *= 0.82;
    if (target.moving) p *= 0.8;
    if (moving) p *= 0.7;
    if (bot.crouching) p *= 1.12;
    if (ctx.night() && target.kind === 'player' && dist > 25) p *= 0.75;
    p = Math.min(0.92, p);

    const headChance = 0.06 + 0.16 * (1 - ai.aimError) * (target.kind === 'zombie' ? 1.4 : 1);
    const zoneRoll = Math.random();
    const zone = zoneRoll < headChance ? 'head' : zoneRoll < headChance + 0.22 ? 'legs' : 'body';
    const aimPt = zone === 'head' ? headOf(target) : zone === 'legs' ? { x: target.x, y: (target.y || 0) + 0.6, z: target.z } : chestOf(target);
    const hit = Math.random() < p && g.lineOfSight(muzzle, aimPt);

    // Tracer end: the target, or a miss that flies past — clipped at the
    // first wall/tree it meets, so nothing ever visibly passes through.
    let end = aimPt;
    if (!hit) {
      const miss = 0.5 + Math.random() * 1.6;
      const far = { x: aimPt.x + (Math.random() - 0.5) * miss, y: aimPt.y + (Math.random() - 0.45) * miss, z: aimPt.z + (Math.random() - 0.5) * miss };
      const dir = { x: far.x - muzzle.x, y: far.y - muzzle.y, z: far.z - muzzle.z };
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const ext = Math.min(tuning.range, len + 25) / len;
      end = g.raycast(muzzle, { x: muzzle.x + dir.x * ext, y: muzzle.y + dir.y * ext, z: muzzle.z + dir.z * ext });
    }
    broadcast({
      type: 'shoot',
      id: bot.id,
      weapon: bot.weapon,
      o: [round1(muzzle.x), round1(muzzle.y), round1(muzzle.z)],
      ends: [[round1(end.x), round1(end.y), round1(end.z)]],
    });
    noises.push({ x: bot.x, z: bot.z, at: now, id: bot.id, loud: true });

    if (!hit) return;
    const mult = zone === 'head' ? 2.2 : zone === 'legs' ? 0.8 : 1;
    const dmg = Math.round(tuning.damage * mult * (tuning.falloff ? Math.max(0.35, falloff) : 1));
    if (target.kind === 'zombie') damageZombie(target.id, dmg, bot.id);
    else damagePlayer(target.ref, dmg, bot.id, { weapon: bot.weapon, zone });
  }

  // A player fired: bots in earshot react.
  function onNoise(shooter) {
    noises.push({ x: shooter.x, z: shooter.z, at: Date.now(), id: shooter.id, loud: true });
  }

  // A bot was shot: it knows roughly where from, and reacts quickly.
  function onBotDamaged(bot, attacker) {
    if (!bot.isBot || !attacker || attacker.id === bot.id) return;
    const ai = brain(bot);
    if (ai.state === 'engage') return;
    ai.investigate = { x: attacker.x, z: attacker.z };
    ai.lastSeen = { x: attacker.x, z: attacker.z };
    ai.lastSeenAt = Date.now();
    ai.state = 'chase';
    ai.path = null;
    bot.angle = yawTo(bot.x, bot.z, attacker.x, attacker.z) + rand(-0.4, 0.4);
  }

  // =========================================================================
  // Zombies
  // =========================================================================
  const zombies = new Map();
  let nextZombieId = 1;
  let round = 0;
  let toSpawn = 0;
  let nextSpawnAt = 0;
  let zombieTimer = null;
  let roundTimer = null;
  let roundActive = false;

  function startZombies() {
    if (zombieTimer) return;
    zombieTimer = setInterval(zombieTick, ZOMBIE_TICK_MS);
    roundTimer = setTimeout(startRound, ZOMBIE.firstDelay);
    console.log(`[zombies] Survival started — first wave in ${ZOMBIE.firstDelay / 1000}s.`);
  }

  function stopZombies() {
    clearInterval(zombieTimer);
    zombieTimer = null;
    clearTimeout(roundTimer);
    roundTimer = null;
    zombies.clear();
    round = 0;
    toSpawn = 0;
    roundActive = false;
  }

  function humans() {
    return [...players.values()].filter((p) => p.health > 0);
  }

  function startRound() {
    round++;
    const realPlayers = [...players.values()].filter((p) => !p.isBot).length || 1;
    toSpawn = Math.min(90, Math.round((6 + round * 5) * (0.75 + 0.25 * realPlayers)));
    roundActive = true;
    nextSpawnAt = Date.now() + 1500;
    broadcast({ type: 'roundStart', round, zombieCount: toSpawn });
    console.log(`[zombies] Wave ${round}: ${toSpawn} zombies.`);
  }

  function maxAlive() {
    const realPlayers = [...players.values()].filter((p) => !p.isBot).length || 1;
    return Math.min(26, 9 + realPlayers * 4 + Math.min(6, round));
  }

  // Somewhere 28–60 m from a living player, walkable, and out of everyone's
  // sight — zombies shamble in from the dark, they don't pop in.
  function findSpawn() {
    const g = geo();
    const alive = humans();
    if (!alive.length) return null;
    for (let k = 0; k < 30; k++) {
      const anchor = alive[Math.floor(Math.random() * alive.length)];
      const a = Math.random() * Math.PI * 2;
      const d = rand(28, 60);
      const x = anchor.x + Math.cos(a) * d;
      const z = anchor.z + Math.sin(a) * d;
      if (g) {
        if (Math.abs(x) > g.bounds - 3 || Math.abs(z) > g.bounds - 3 || !g.isWalkable(x, z)) continue;
        const pt = { x, y: 1.4, z };
        let seen = false;
        for (const p of alive) {
          const dist = Math.hypot(p.x - x, p.z - z);
          if (dist < 24) {
            seen = true;
            break;
          }
          if (!p.isBot && dist < 70 && g.lineOfSight({ x: p.x, y: (p.y || 0) + 1.6, z: p.z }, pt)) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
      } else if (Math.abs(x) > 110 || Math.abs(z) > 110) continue;
      return { x, z };
    }
    return null;
  }

  function spawnZombie() {
    const spot = findSpawn();
    if (!spot) return false;
    const runnerChance = round < 2 ? 0 : Math.min(0.45, 0.12 + (round - 2) * 0.07);
    const kind = Math.random() < runnerChance ? 'runner' : 'walker';
    const def = ZOMBIE[kind];
    const health = Math.round((ZOMBIE.baseHealth + (round - 1) * ZOMBIE.healthPerRound) * def.health);
    const id = `z${nextZombieId++}`;
    const z = {
      id,
      kind,
      seed: Math.floor(Math.random() * 1e6),
      x: spot.x,
      z: spot.z,
      angle: Math.random() * Math.PI * 2,
      health,
      maxHealth: health,
      speed: rand(def.speed[0], def.speed[1]),
      speedNow: 0,
      path: null,
      repathAt: 0,
      targetId: null,
      attackAt: 0,
      lastAttack: 0,
      spawned: true,
    };
    zombies.set(id, z);
    broadcast({ type: 'zombieSpawn', zombie: snapshot(z) });
    return true;
  }

  function snapshot(z) {
    return { id: z.id, kind: z.kind, seed: z.seed, x: round1(z.x), z: round1(z.z), a: Math.round(z.angle * 100) / 100, health: z.health, maxHealth: z.maxHealth };
  }

  function zombieTick() {
    const now = Date.now();
    const dt = ZOMBIE_TICK_MS / 1000;
    const g = geo();

    if (roundActive && toSpawn > 0 && now >= nextSpawnAt && zombies.size < maxAlive()) {
      if (spawnZombie()) toSpawn--;
      nextSpawnAt = now + rand(500, 1600) / Math.min(3, 1 + round * 0.15);
    }

    const alive = humans();
    const list = [...zombies.values()];
    const updates = [];
    for (const z of list) {
      if (z.health <= 0) continue;
      // Nearest living player/bot.
      let target = null;
      let td = Infinity;
      for (const p of alive) {
        const d = Math.hypot(p.x - z.x, p.z - z.z);
        if (d < td) {
          td = d;
          target = p;
        }
      }
      let moving = false;
      const def = ZOMBIE[z.kind];
      if (target) {
        if (z.attackAt) {
          // Wind-up finished: does the swipe connect?
          if (now >= z.attackAt) {
            z.attackAt = 0;
            z.lastAttack = now;
            if (td <= def.reach + 0.55) damagePlayer(target, def.damage, 'zombie_' + z.id, { weapon: 'zombie', zone: 'body' });
          }
          z.angle = yawTo(z.x, z.z, target.x, target.z);
        } else if (td <= def.reach) {
          z.angle = yawTo(z.x, z.z, target.x, target.z);
          if (now - z.lastAttack > ZOMBIE.attackCooldown) {
            z.attackAt = now + def.windup;
            broadcast({ type: 'zombieAttack', id: z.id });
          }
        } else {
          // Straight at them when nothing's in the way, otherwise path.
          const direct = !g || (td < 30 && g.clearWalk(z.x, z.z, target.x, target.z));
          let tx = target.x;
          let tz = target.z;
          if (!direct) {
            const goalMoved = !z.pathGoal || Math.hypot(z.pathGoal.x - target.x, z.pathGoal.z - target.z) > 3;
            if (!z.path || now > z.repathAt || goalMoved) {
              z.path = g.findPath(z, target, 25000);
              z.pathGoal = { x: target.x, z: target.z };
              z.repathAt = now + rand(900, 1600);
            }
            if (z.path && z.path.length) {
              while (z.path.length > 1 && Math.hypot(z.path[0].x - z.x, z.path[0].z - z.z) < 0.7) z.path.shift();
              tx = z.path[0].x;
              tz = z.path[0].z;
            }
          } else {
            z.path = null;
          }
          const d = Math.hypot(tx - z.x, tz - z.z) || 1;
          // Walkers lurch: speed surges and stalls with their gait.
          const gait = z.kind === 'walker' ? 0.75 + 0.45 * Math.sin(now / 380 + z.seed) : 1;
          const step = Math.min(d, z.speed * gait * dt);
          z.x += ((tx - z.x) / d) * step;
          z.z += ((tz - z.z) / d) * step;
          const want = yawTo(z.x, z.z, tx, tz);
          z.angle = wrapAngle(z.angle + Math.max(-0.5, Math.min(0.5, wrapAngle(want - z.angle))));
          moving = true;
        }
      }
      // Crowd: keep personal space so the horde doesn't merge into one body.
      for (const o of list) {
        if (o === z || o.health <= 0) continue;
        const dx = z.x - o.x;
        const dz = z.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < 0.7 * 0.7) {
          const d = Math.sqrt(d2);
          z.x += (dx / d) * (0.7 - d) * 0.5;
          z.z += (dz / d) * (0.7 - d) * 0.5;
        }
      }
      if (g) Object.assign(z, g.resolve(z.x, z.z, 0.35, 0));
      z.speedNow = moving ? z.speed : 0;
      updates.push({ id: z.id, x: round1(z.x), z: round1(z.z), a: Math.round(z.angle * 100) / 100, s: round1(z.speedNow), at: z.attackAt ? 1 : 0 });
    }
    if (updates.length) broadcast({ type: 'zombieTick', zombies: updates });

    if (roundActive && toSpawn === 0 && zombies.size === 0 && players.size > 0) {
      roundActive = false;
      broadcast({ type: 'roundClear', round, nextInMs: ZOMBIE.intermission });
      console.log(`[zombies] Wave ${round} cleared.`);
      clearTimeout(roundTimer);
      roundTimer = setTimeout(startRound, ZOMBIE.intermission);
    }
  }

  function damageZombie(id, damage, killerId) {
    const z = zombies.get(id);
    if (!z || z.health <= 0) return;
    z.health = Math.max(0, z.health - damage);
    broadcast({ type: 'zombieHealth', id: z.id, health: z.health });
    if (z.health === 0) {
      zombies.delete(z.id);
      const killer = players.get(killerId);
      if (killer) killer.score += 1;
      broadcast({ type: 'zombieDeath', id: z.id, killerId, killerScore: killer ? killer.score : 0 });
    }
  }

  return {
    startBots,
    stopBots,
    onNoise,
    onBotDamaged,
    startZombies,
    stopZombies,
    damageZombie,
    zombieList: () => [...zombies.values()].map(snapshot),
    zombieRound: () => round,
  };
}

module.exports = { createAI, BOT_TICK_MS };
