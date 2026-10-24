# DOOM Clone — 3D

A browser-based 3D multiplayer shooter with a Call-of-Duty-style lobby
(pick a weapon, a skin, and a map, then deploy) — played directly between
two machines on your own network, no third-party relay or tunnel service
involved.

- **Rendering**: real 3D via [Three.js](https://threejs.org) (loaded from
  a CDN, no build step or bundler) — an actual scene graph, WebGL
  rendering, lighting and shadows, not a 2D raycasting trick.
- **Maps**: three maps, each 240x240 units, built from code (no external
  model/texture files to source, license, or ship):
  - **Forest Outpost** (PvP) — ~220 layered-canopy trees, clustered rock
    formations, and a dense instanced grass field.
  - **Techbase Arena** (PvP) — a dim concrete facility with crate and
    slab cover.
  - **Outbreak Facility** (co-op Zombies) — the same enclosed arena
    layout, re-themed with red emergency lighting, where you and your
    friend fight off endless rounds of server-simulated zombies instead
    of each other. See "Zombies mode" below.
  - The match's map is locked in by whichever player deploys first;
    anyone who joins after that plays on the already-chosen map.
- **Lobby**: pick your starting weapon, your skin, accent color, and
  headgear (a solid color / simple shape — not a textured camo pattern or
  a modeled cosmetic item, see "Honest scope" below), and your preferred
  map before deploying.
- **Players are visible**: other players render as an articulated
  low-poly humanoid (torso, head, swinging arms and legs, built from
  real body proportions — not a single capsule) in their chosen skin and
  accent colors with optional headgear, a name tag that always faces the
  camera, and a visible jetpack flame while airborne.
- **Controls**: WASD **or the arrow keys** both work for movement. Press
  `Q` to cycle between mines, bear traps, and laser traps, then `G` to
  place one. Traps trigger server-side when an opponent or zombie gets
  close; each player can have up to five active traps.
- **Weapons**: Pistol, Shotgun (multi-pellet spread), Chaingun (hold to
  fire), Rocket Launcher, and a real **AK-47** — switch with `1`-`5` or
  the scroll wheel. Your lobby pick is free; the rest must be bought
  in-match. The AK's geometry is ported from the open-source
  [Tiny Strike](https://github.com/guyz/tinystrike) project (MIT) — a
  true-to-life AKM model (stamped receiver, gas tube, curved 30-round
  magazine, correct real-world dimensions), not a simple box-and-cylinder
  assembly like the other four. See `public/js/weapons/LICENSE` for full
  attribution; it's rendered with simplified fallback materials since the
  much larger baked-texture system it was originally built against isn't
  part of this project.
- **Economy**: kills (and the hidden secret) pay out money. Spend it at
  **buy stations** (3D kiosks scattered on the map) to unlock the other
  weapons, or at the **upgrade bench** to boost your currently equipped
  weapon's damage and fire rate. Walk up to one and press `E`.
- **Inventory**: press `Tab` to open your loadout — see what you own,
  what's locked and its price, and click an owned weapon to equip it.
- **Jetpack**: hold `F` to thrust upward against gravity on a limited,
  regenerating fuel tank (shown as a bar at the bottom of the HUD) — fly
  around the map, Call-of-Duty-exo-suit style.
- **Movement**: WASD with acceleration/friction for a weighted feel,
  Space to jump (with real gravity), Shift to sprint, mouse-look.
- **Scoring**: kills are tracked server-side and shown as a live,
  rank-sorted scoreboard; a banner announces frags as they happen.
- **Quality of life**: your name, server address, and loadout are
  remembered in your browser (`localStorage`) between visits.
- **Easter eggs**: a hidden area to find (tracked separately from kills,
  like the original games' "Secrets" stat, and worth a money bonus),
  plus classic Doom cheat-code nods — type `IDDQD`, `IDKFA`, or `IDCLIP`
  while playing for a nostalgic banner (cosmetic only, by design).
- **Multiplayer**: a small Node.js server relays player positions
  (including height, so jetpack flight is visible to others), shots,
  hits, kills and respawns between connected browsers over WebSockets.
  Trap placement, proximity triggers, and trap damage are also handled by
  the server so every connected player sees the same trap state.

## Zombies mode

Pick **Outbreak Facility** in the map selector for co-op survival instead
of PvP:

- Zombies are fully **simulated by the server** (not any one player's
  computer), so everyone sees the exact same zombies in the exact same
  places — this is the one part of the game where the server does more
  than relay messages, specifically so positions can't be faked.
- Rounds escalate: each round has more zombies with more health than the
  last. Clearing a round starts an 8-second intermission before the next.
- Zombies path straight toward the nearest living player and melee them
  on contact — there's no line-of-sight check, so don't expect them to
  respect cover; this is a deliberately simple AI, not a pathfinding engine.
- No friendly fire — your shots only ever hit zombies on this map.
- The same money/buy-station/upgrade-bench economy works here too, so
  your zombie kills fund better weapons just like in PvP.
- There's no down-and-revive mechanic, perks, Pack-a-Punch, or a Mystery
  Box — dying just respawns you, same as in PvP. This is a genuine
  round-based horde mode, not a feature-complete recreation of a specific
  Call of Duty Zombies map.

## Honest scope (read this before expecting a AAA game)

This is a real, working 3D multiplayer shooter — not a mockup — but it
is not, and was never going to be, an actual copy of Call of Duty:

- **Character models are articulated low-poly primitives** (a boxy torso,
  a sphere head, cylinder limbs with real human proportions and a basic
  walk-cycle animation) — not detailed, textured, or facially animated
  human models. Realistic human characters require an actual 3D art
  pipeline (modeling, rigging, skinning, animating in software like
  Blender) — far beyond what code alone can produce, and this project has
  no way to download or license pre-made character assets.
- **Trees, rocks, and grass are procedurally built from primitive
  geometry** (layered cones, clustered dodecahedra, thousands of
  GPU-instanced billboard blades) using real-world proportions and
  structure as a reference — not photo-scanned or textured foliage assets.
- **Skins, accents, and headgear are solid colors / simple primitive
  shapes** (e.g. a helmet is a half-sphere), not textured camouflage
  patterns or modeled cosmetic items.
- **Weapon viewmodels are more detailed primitive assemblies** (triggers,
  sights, magazines, stocks, ammo belts) than before, which reads as more
  gun-like — but they're still built from boxes/cylinders/cones, not
  textured 3D-scanned firearm models.
- **No real Call of Duty assets, maps, or content were used or copied** —
  everything here is built from primitive geometry in code. Using actual
  COD assets would be a copyright violation.
- **The economy (money, buy stations, upgrades, inventory) is tracked
  locally per client**, not validated by the server — consistent with
  this project's existing "thin relay, no anti-cheat" design (the server
  already trusts each client's self-reported hit damage the same way).
  Fine for friends playing together; not tamper-proof.
- **No killstreaks, perks, prestige, battle pass, or other meta-progression
  systems** — this is a straightforward deathmatch-plus-economy loop.
- The map is chosen by whoever deploys first (see above) — there's no
  lobby voting system.

What you *do* get: real 3D terrain you can walk around in (at 5.76x the
previous map's area), trees/rocks/crates you physically collide with,
grass fields, jumping and jetpack flight, visible teammates/opponents
with actual limbs in colors you chose, a working buy/upgrade economy, an
inventory screen, a proper pre-match loadout screen, and working
multiplayer kill tracking — a genuine small-scale FPS, built honestly.

## 1. Install

Requires [Node.js](https://nodejs.org) (v18+) and a modern browser
(Chrome, Edge, or Firefox from the last couple of years — the page uses
an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
to load Three.js, which older browsers don't support). From this folder:

```
npm install
```

## 2. Run the server

One of you (the "host") starts the server:

```
npm start
```

You'll see:

```
DOOM-clone server is running
  On this machine:        http://localhost:3000
  Wi-Fi: http://192.168.x.x:3000
```

Open `http://localhost:3000` in your own browser to confirm it works —
the lobby screen will also show you this same address automatically, so
you don't have to copy it from the terminal.

## 3. Playing on the same network (easiest)

1. On the host laptop, find the Wi-Fi address shown above (also shown
   live on the lobby screen under "This server's address(es)").
2. Your friend opens a browser and goes to `http://<that address>:3000`.
3. Both of you set your name, weapon, skin, and map preference, then
   click **DEPLOY**.

## 4. Playing over the internet (two different networks)

This requires forwarding a port on the host's router so traffic from
the internet can reach the host laptop.

1. **Find the host's local IP** (shown on the lobby screen, e.g.
   `192.168.1.23`).
2. **Give the host laptop a static local IP** (recommended) via the
   router's DHCP reservation settings, or Windows network adapter
   settings — otherwise the forwarded port may stop pointing at the
   right machine if the IP changes.
3. **Log into the router's admin page** (commonly `192.168.1.1` or
   `192.168.0.1` — check the sticker on the router, or run `ipconfig`
   and look at "Default Gateway").
4. **Find "Port Forwarding" / "Virtual Server" / "NAT forwarding"**.
5. **Add a rule**: forward external TCP port `3000` to the host laptop's
   local IP, port `3000`.
6. **Find the host's public IP**: visit
   [whatismyipaddress.com](https://whatismyipaddress.com).
7. **Allow the app through Windows Firewall** if prompted (first run).
8. Your friend opens `http://<host-public-IP>:3000` in their browser.

**Notes:**
- Some ISPs use CGNAT, which makes port forwarding not work no matter
  how correctly it's configured — there's no router-side fix for that.
- The host's public IP can change over time unless you pay for a static
  one.

## Project structure

```
doom/
├── package.json
├── README.md
├── server/
│   └── index.js          Node HTTP + WebSocket relay server
└── public/                Client (served as static files)
    ├── index.html          Lobby UI + HUD markup, loads Three.js via CDN
    ├── css/style.css
    └── js/
        ├── constants.js    Weapons, skins, maps, movement tuning
        ├── localPlayer.js  Local player physics: movement, gravity, collision
        ├── world.js        Builds the 3D scene for a chosen map
        ├── playerModel.js  Visible representation of other players
        ├── weaponView.js   First-person weapon viewmodels
        ├── network.js      WebSocket client wrapper
        └── main.js         Lobby logic, game loop, shooting, HUD, wiring
```

## Customizing

- **Weapons/skins/maps/prices/economy**: edit the definitions in
  `public/js/constants.js` (`WEAPONS`, `SKINS`, `MAPS`, `BUY_STATIONS`,
  `UPGRADE_BENCHES`, `STARTING_MONEY`, `KILL_REWARD`, jetpack tuning, etc).
- **Map layout**: edit `public/js/world.js` (tree/rock/grass/crate
  placement, counts, colors, fog, lighting).
- **Character model**: edit `public/js/playerModel.js` (body proportions,
  colors, walk-cycle speed).
- **Spawn points**: `SPAWN_POINTS` in both `public/js/constants.js` and
  `server/index.js` — keep them in sync.

## Known limitations (by design, kept simple for friends playing together)

- No anti-cheat: the server trusts client-reported positions. Fine for a
  private match, not suitable for a public/competitive deployment.
- No persistence: scores/health reset when the server restarts.
- Built for a handful of players (4 spawn points are defined); more can
  connect, but spawn points will start repeating.
- Requires an internet connection to load Three.js from its CDN on first
  load (it's cached by the browser after that).
