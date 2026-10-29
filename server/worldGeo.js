/**
 * Server-side knowledge of the map's solid geometry, so AI (bots and
 * zombies) can't see, shoot or walk through walls.
 *
 * The client builds every map from a fixed seed, and its physics already
 * describes all solid things as vertical cylinders ("collidables": trees,
 * rocks, wall segments — { x, z, radius, minY?, maxY? }). The first client in
 * a match uploads that list (see main.js), and it's cached on disk per map so
 * later matches have it from the first tick.
 *
 * Provides:
 *  - lineOfSight(a, b): does a 3D segment pass any obstacle?
 *  - raycast(a, b): first obstacle hit along the segment (for tracers);
 *  - findPath(from, to): A* over a 1 m navigation grid with the agent's
 *    clearance baked in, smoothed to straight runs;
 *  - resolve(x, z, r, y): push a moving agent out of obstacles.
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'geo-cache');
const HASH_CELL = 4; // spatial hash for obstacle queries
const NAV_CELL = 0.5; // navigation grid resolution (m)
const AGENT_RADIUS = 0.36;
// Wall segments are chains of overlapping circles; widen them a little for
// sight tests so a ray can't thread the tiny gaps between two circles.
const SIGHT_PAD = 0.14;

class WorldGeo {
  constructor(map, collidables, bounds) {
    this.map = map;
    this.bounds = bounds;
    // Only things that matter at standing height for ground agents/sight.
    this.obs = collidables
      .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && c.radius > 0)
      .map((c) => ({ x: c.x, z: c.z, r: c.radius, minY: c.minY ?? -1e9, maxY: c.maxY ?? 1e9 }));
    this.hash = new Map();
    for (let i = 0; i < this.obs.length; i++) {
      const o = this.obs[i];
      const x0 = Math.floor((o.x - o.r - SIGHT_PAD) / HASH_CELL);
      const x1 = Math.floor((o.x + o.r + SIGHT_PAD) / HASH_CELL);
      const z0 = Math.floor((o.z - o.r - SIGHT_PAD) / HASH_CELL);
      const z1 = Math.floor((o.z + o.r + SIGHT_PAD) / HASH_CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const k = gx * 100003 + gz;
          let list = this.hash.get(k);
          if (!list) this.hash.set(k, (list = []));
          list.push(i);
        }
      }
    }
    this.stamp = new Uint32Array(this.obs.length);
    this.stampId = 1;
    this.buildNavGrid();
  }

  cell(x, z) {
    return this.hash.get(Math.floor(x / HASH_CELL) * 100003 + Math.floor(z / HASH_CELL));
  }

  // --- Sight ------------------------------------------------------------------

  // Distance along a→b (0..1) of the first obstacle the segment hits, or -1.
  raycastT(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (++this.stampId >= 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    const id = this.stampId;
    let best = -1;
    const steps = Math.max(1, Math.ceil(len / (HASH_CELL * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const list = this.cell(ax + dx * t, az + dz * t);
      if (!list) continue;
      for (const i of list) {
        if (this.stamp[i] === id) continue;
        this.stamp[i] = id;
        const o = this.obs[i];
        // 2D segment–circle intersection (entry point).
        const r = o.r + SIGHT_PAD;
        const fx = ax - o.x;
        const fz = az - o.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-9) continue;
        const b = 2 * (fx * dx + fz * dz);
        const c = fx * fx + fz * fz - r * r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        let tHit = (-b - sq) / (2 * a);
        const tExit = (-b + sq) / (2 * a);
        if (tExit < 0 || tHit > 1) continue;
        if (tHit < 0) tHit = 0; // starts inside (e.g. hugging a wall)
        // Height of the ray while inside the cylinder.
        const y0 = ay + dy * tHit;
        const y1 = ay + dy * Math.min(1, tExit);
        if (Math.max(y0, y1) < o.minY || Math.min(y0, y1) > o.maxY) continue;
        if (best < 0 || tHit < best) best = tHit;
      }
    }
    return best;
  }

  lineOfSight(a, b) {
    return this.raycastT(a.x, a.y, a.z, b.x, b.y, b.z) < 0;
  }

  // Point where a→b first hits something (or b itself).
  raycast(a, b) {
    const t = this.raycastT(a.x, a.y, a.z, b.x, b.y, b.z);
    if (t < 0) return { hit: false, x: b.x, y: b.y, z: b.z };
    return { hit: true, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  // --- Movement ---------------------------------------------------------------

  // Push a ground agent (feet at y, ~1.7 m tall) out of any obstacle.
  resolve(x, z, r, y = 0) {
    for (let iter = 0; iter < 3; iter++) {
      const list = this.cell(x, z);
      if (!list) break;
      let moved = false;
      for (const i of list) {
        const o = this.obs[i];
        if (y + 1.7 <= o.minY || y + 0.05 >= o.maxY) continue;
        const dx = x - o.x;
        const dz = z - o.z;
        const min = r + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const push = min - d + 0.001;
        x += (dx / d) * push;
        z += (dz / d) * push;
        moved = true;
      }
      if (!moved) break;
    }
    const b = this.bounds;
    return { x: Math.max(-b, Math.min(b, x)), z: Math.max(-b, Math.min(b, z)) };
  }

  // --- Navigation -------------------------------------------------------------

  buildNavGrid() {
    const b = this.bounds;
    this.navN = Math.ceil((2 * b) / NAV_CELL);
    const n = this.navN;
    this.blocked = new Uint8Array(n * n);
    for (const o of this.obs) {
      // Ground agents only care about obstacles at body height.
      if (o.maxY <= 0.05 || o.minY >= 1.7) continue;
      const rr = o.r + AGENT_RADIUS;
      const gx0 = Math.max(0, Math.floor((o.x - rr + b) / NAV_CELL));
      const gx1 = Math.min(n - 1, Math.floor((o.x + rr + b) / NAV_CELL));
      const gz0 = Math.max(0, Math.floor((o.z - rr + b) / NAV_CELL));
      const gz1 = Math.min(n - 1, Math.floor((o.z + rr + b) / NAV_CELL));
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cx = (gx + 0.5) * NAV_CELL - b;
          const cz = (gz + 0.5) * NAV_CELL - b;
          // Cell centre within the inflated circle (slightly generous).
          if ((cx - o.x) ** 2 + (cz - o.z) ** 2 < rr * rr) this.blocked[gz * n + gx] = 1;
        }
      }
    }
    this.gScore = new Float32Array(n * n);
    this.came = new Int32Array(n * n);
    this.visit = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
    this.searchId = 0;
  }

  toCell(x, z) {
    const n = this.navN;
    const gx = Math.max(0, Math.min(n - 1, Math.floor((x + this.bounds) / NAV_CELL)));
    const gz = Math.max(0, Math.min(n - 1, Math.floor((z + this.bounds) / NAV_CELL)));
    return gz * n + gx;
  }

  cellCenter(i) {
    const n = this.navN;
    return { x: ((i % n) + 0.5) * NAV_CELL - this.bounds, z: (Math.floor(i / n) + 0.5) * NAV_CELL - this.bounds };
  }

  isWalkable(x, z) {
    return !this.blocked[this.toCell(x, z)];
  }

  nearestFree(i, maxRing = 6) {
    if (!this.blocked[i]) return i;
    const n = this.navN;
    const gx = i % n;
    const gz = Math.floor(i / n);
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = gx + dx;
          const z = gz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          if (!this.blocked[z * n + x]) return z * n + x;
        }
      }
    }
    return -1;
  }

  // Straight walk between two points clear of obstacles (grid supercover).
  clearWalk(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (NAV_CELL * 0.4)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (this.blocked[this.toCell(ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
    }
    return true;
  }

  // A* with octile moves (no corner cutting); returns world waypoints
  // (excluding the start), or null if unreachable within the budget.
  findPath(from, to, maxExpand = 40000) {
    const n = this.navN;
    const start = this.nearestFree(this.toCell(from.x, from.z));
    const goal = this.nearestFree(this.toCell(to.x, to.z));
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: to.x, z: to.z }];
    if (this.clearWalk(from.x, from.z, to.x, to.z)) return [{ x: to.x, z: to.z }];

    const id = ++this.searchId;
    const gxG = goal % n;
    const gzG = Math.floor(goal / n);
    const h = (i) => {
      const dx = Math.abs((i % n) - gxG);
      const dz = Math.abs(Math.floor(i / n) - gzG);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const heap = new MinHeap();
    this.gScore[start] = 0;
    this.visit[start] = id;
    this.came[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % n;
      const cz = Math.floor(cur / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const ni = z * n + x;
          if (this.blocked[ni] || this.closed[ni] === id) continue;
          if (dx && dz && (this.blocked[cz * n + x] || this.blocked[z * n + cx])) continue;
          const g = this.gScore[cur] + (dx && dz ? 1.4142 : 1);
          if (this.visit[ni] === id && g >= this.gScore[ni]) continue;
          this.visit[ni] = id;
          this.gScore[ni] = g;
          this.came[ni] = cur;
          heap.push(ni, g + h(ni));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = this.came[c]) cells.push(c);
    cells.reverse();
    // String-pull: keep only the waypoints needed to walk straight runs.
    const pts = cells.map((c) => this.cellCenter(c));
    pts[pts.length - 1] = { x: to.x, z: to.z };
    const out = [];
    let anchor = { x: from.x, z: from.z };
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clearWalk(anchor.x, anchor.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }

  // A random walkable point near (x, z).
  randomPointNear(x, z, radius) {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (Math.abs(px) < this.bounds - 2 && Math.abs(pz) < this.bounds - 2 && this.isWalkable(px, pz)) return { x: px, z: pz };
    }
    return null;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, p) {
    const a = this.items;
    const q = this.prio;
    let i = a.length;
    a.push(item);
    q.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= p) break;
      a[i] = a[parent];
      q[i] = q[parent];
      i = parent;
    }
    a[i] = item;
    q[i] = p;
  }
  pop() {
    const a = this.items;
    const q = this.prio;
    const top = a[0];
    const lastItem = a.pop();
    const lastP = q.pop();
    if (a.length) {
      let i = 0;
      const len = a.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && q[c + 1] < q[c]) c++;
        if (q[c] >= lastP) break;
        a[i] = a[c];
        q[i] = q[c];
        i = c;
      }
      a[i] = lastItem;
      q[i] = lastP;
    }
    return top;
  }
}

// --- Cache ----------------------------------------------------------------------

const geos = new Map(); // map id -> WorldGeo

function cachePath(map) {
  return path.join(CACHE_DIR, `${map.replace(/[^a-z0-9_-]/gi, '')}.json`);
}

function getGeo(map) {
  if (geos.has(map)) return geos.get(map);
  try {
    const data = JSON.parse(fs.readFileSync(cachePath(map), 'utf8'));
    const geo = new WorldGeo(map, unpack(data.c), data.bounds);
    geo.version = data.version;
    geos.set(map, geo);
    console.log(`[geo] Loaded ${geo.obs.length} obstacles for '${map}' from cache.`);
    return geo;
  } catch {
    return null;
  }
}

function unpack(c) {
  return c.map(([x, z, r, minY, maxY]) => ({ x, z, radius: r, minY: minY ?? undefined, maxY: maxY ?? undefined }));
}

// Accept a client's upload: [[x, z, r, minY|null, maxY|null], ...].
function setGeoFromClient(map, packed, bounds, version) {
  if (!Array.isArray(packed) || packed.length > 60000 || !(bounds > 10 && bounds < 1000)) return null;
  const clean = packed
    .filter((e) => Array.isArray(e) && e.length >= 3 && e.slice(0, 3).every(Number.isFinite))
    .map(([x, z, r, minY, maxY]) => [x, z, r, Number.isFinite(minY) ? minY : null, Number.isFinite(maxY) ? maxY : null]);
  const t0 = Date.now();
  const geo = new WorldGeo(map, unpack(clean), bounds);
  geo.version = version;
  geos.set(map, geo);
  console.log(`[geo] '${map}': ${geo.obs.length} obstacles, nav grid ${geo.navN}² built in ${Date.now() - t0} ms.`);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(map), JSON.stringify({ version, bounds, c: clean }));
  } catch (err) {
    console.warn('[geo] Could not write cache:', err.message);
  }
  return geo;
}

module.exports = { getGeo, setGeoFromClient, WorldGeo };
