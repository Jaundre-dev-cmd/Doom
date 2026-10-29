# DOOM Clone — Tactical Warfare (v3.0)

A browser-based 3D multiplayer military shooter with a full main menu
(operator customisation with a live 3D preview, armory, settings, map
select). You play it directly between machines on your own network, with
no third-party relay or tunnel service involved.

## What's in v3.0

- **Rendering**: [Three.js](https://threejs.org) 0.170 (loaded from a CDN,
  no build step).
  - ACES tone mapping and a physically-based atmospheric sky with
    image-based lighting.
  - Soft shadows that follow the player.
  - Optional bloom/film-grade post-processing on Ultra.
- **Performance**:
  - **Static batching:** thousands of static meshes are merged per material and map chunk.
  - **Instancing:** the whole forest is GPU-instanced.
  - **Light pool:** dozens of map lamps are served by a small fixed set of real lights, so shaders never recompile mid-match.
  - **Fast hit detection:** shots and blast checks raycast against a BVH ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)).
  - **Graphics presets:** Low, Medium, High and Ultra.
- **Forest Outpost rework**:
  - **Ground:** a blended grass/dirt/leaf-litter surface with normal mapping, dirt trails between points of interest, and trampled clearings.
  - **Vegetation:** pines, broadleaf trees and undergrowth, plus wind-blown grass meadows.
  - **Cover:** boulders, and fallen logs you can vault.
  - **Boundary:** a dense treeline fading into the fog in place of the old wall.
- **Movement**:
  - Weighty acceleration, sprint (forward only, lowers the weapon) and a realistic jump.
  - **Crouch** (C): slower, quieter, more accurate.
  - Head bob, landing dip, strafe lean.
  - Flight is still there on F.
- **Aiming and gunplay**:
  - **Mouse input:** raw input (no OS acceleration), adjustable sensitivity, ADS sensitivity and FOV.
  - **Aim down sights:** right click, with per-weapon zoom, sights lined up on the weapon and a red-dot reticle.
  - **Recoil:** per-weapon vertical/horizontal recoil with recovery.
  - **Spread:** hip-fire spread grows when moving or jumping and shrinks when crouched, shown live by a dynamic crosshair.
  - **Damage:** headshots ×2.2, limbs ×0.8, damage falls off with range.
  - **Ammo:** magazines and reloading (R), scavenging a magazine on each kill.
- **Realistic weapons**: every gun is a detailed procedural model built to real-world dimensions from hundreds of real parts.
  - **The guns:** Glock pistol, Remington 870-style pump shotgun with a side-saddle, XM556 microgun with a belt-fed ammo can, RPG-7 with a PGO-7 optic and PG-7V warhead, AK-47, M4A1-S with a red dot, MP5, and an AWP with a full scope.
  - **Surfaces:** shaders show worn bright edges, grime in crevices and occlusion in recesses, plus fine surface grain (parkerized steel, anodised aluminium, stippled polymer, wood grain).
  - **Moving parts:** slides and bolts cycle, the shotgun pump and AWP bolt work after each shot, minigun barrels spin up, magazines drop out on reload, and the RPG warhead disappears after firing.
  - **Aiming:** optics (M4A1 red dot, microgun reflex) put the reticle on the eye axis; iron-sighted guns (Glock, M870, AK-47, MP5, RPG-7) were tuned one by one in the weapon lab (`?ads=1`) so the front post sits in the rear notch on the aim point.
  - **UI:** the armory shows a studio render of every gun plus a rotating 3D model; the HUD, kill feed, killcam, loadout and weapons dictionary use images rendered from the real models.
  - **Third person:** other soldiers carry the same models, merged for performance.
  - **Credits:** the M4A1, AK-47, MP5, AWP and pistol models come from [Tiny Strike](https://github.com/guyz/tinystrike) / Claude-of-Duty (MIT/ISC, see `public/js/weapons/LICENSE`); the shotgun, minigun and RPG were built for this project on the same parts library.
  - **Dev tool:** `/weapon-lab.html?w=<id>` renders any gun from four angles.
- **CoD-style weapon view**:
  - **Separate rendering:** the gun is drawn in its own pass with its own field of view (Weapon FOV: Narrow/Default/Wide), so it never clips into walls and never stretches at high FOV.
  - **FOV settings:** FOV is horizontal like Call of Duty (60–120, default 90), with an ADS FOV option (Affected/Independent).
  - **Lighting:** the gun is lit by the real sun direction and darkens in shade or indoors.
  - **Firing effects:** muzzle flash with a light, muzzle smoke, and brass that ejects and bounces on the ground.
  - **Animation:** spring-physics recoil, look sway and strafe tilt, figure-eight walk bob, ADS swing-in, tactical-sprint pose, and a multi-stage reload (mag out / mag in / charge).
  - **Walls:** the muzzle lifts and the gun pulls back when you're close to a wall.
- **Killstreaks** (kept until used, earned per life):
  - **UAV** (3 kills, Z): a drone circles the map and pings every enemy onto your team's radar every 2 s for 30 s. Enemies see "ENEMY UAV OVERHEAD".
  - **Airstrike** (5 kills, X): pull out a rugged tablet, which opens a live satellite feed. Pan with the mouse, zoom with the scroll wheel, see thermal contacts and the bomb corridor, then click to confirm. A strike jet flies over and drops six bombs on real ballistic arcs. Everyone sees and hears the jet.
- **Frag grenades** (G): hold to cook, release to throw.
  - Real bouncing/rolling physics off ground, trees, walls and obstacles.
  - Blast damage is blocked by cover.
  - On-screen warning when a grenade lands near you; you can kill yourself with one.
- **Killcam and kill feed**:
  - **Kill feed:** every client sees every kill — killer, weapon, headshot, victim.
  - **Damage indicators:** a red arc on screen points to whoever is shooting you.
  - **Killcam:** on death you go down in first person turned toward your killer, then watch a replay of the last seconds from the killer's eyes.
  - **The replay is the real match:** every soldier is where they actually were and every tracer that was actually fired is shown, your own body drops, and the final moment plays in slow-mo.
  - **Killer card:** name, weapon, distance and the killer's remaining health.
- **Soldiers**:
  - Jointed bodies with knees and elbows, arms that hold the weapon (two-bone IK), and a plate carrier, pouches, backpack, boots and gloves.
  - Camo uniforms: woodland, desert, multi-terrain, urban/arctic digital, tiger stripe, gold, plus solid colours.
  - Headgear: helmet, helmet + NVG, cap or beanie.
  - Animation: upper body follows the player's aim, crouch pose, death fall.
- **Smooth multiplayer**: 30 Hz updates. Remote players are interpolated 100 ms behind real time, so they glide instead of teleporting.
- **Realistic rules**:
  - **Health:** regenerates after 5 s out of combat.
  - **Spawns:** you spawn away from enemies.
  - **Radar:** enemies only show up when they fire an unsuppressed weapon (the M4A1-S and MP5 stay hidden).
  - **Footsteps:** positional; crouching makes you silent.
- **Audio**: synthesised, spatialised sound for gunshots (distance-muffled), explosions, footsteps, reloads, hitmarkers, grenade pins. There are no audio files to license.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Sprint |
| Space | Jump (climb while flying) |
| C | Crouch toggle (descend while flying) |
| F | Toggle flight |
| Mouse / Left click | Aim / fire |
| Right click | Aim down sights (AWP: scope) |
| R | Reload |
| G | Frag grenade (hold to cook, release to throw) |
| 1–8 / scroll | Switch weapon |
| T | Rocket launcher |
| Z | UAV (3-kill streak) |
| X | Airstrike tablet / satellite view (5-kill streak) |
| Ctrl+T (or type HELPME) | Cheat: grants a UAV + airstrike, max ammo and grenades. Ctrl+T only reaches the game in fullscreen (Chrome/Edge); HELPME works everywhere |
| Tab / I / U | Loadout / help / weapons dictionary |

## Maps

- **Forest Outpost** (PvP): reworked forest with three overgrown factories,
  watchtowers, a climbable tower, campsites, ruins and cabins.
- **Ironvale Industrial** (PvP): a factory district with enterable
  warehouses, a workers' village with animated residents, and a
  multi-level city street.
- **Outbreak Facility**: the industrial district re-themed with red
  emergency lighting.
- **Dead Woods** (zombie survival): the forest at night — moonlight, thick
  fog, firelight, lightning and a horror soundscape. Waves of realistic
  zombies (shambling walkers, and sprinting runners from wave 2) spawn out of
  sight and hunt you down. Your weapon has a flashlight (L toggles it).
  Ally bots fight the horde with you.

The match's map is locked in by whichever player deploys first. AI bots
(allies/enemies) can be added from the lobby.

### AI

Bots and zombies are simulated on the server (`server/ai.js`) against the
map's real collision geometry (`server/worldGeo.js`). The first client in a
match uploads the geometry and the server caches it in `server/geo-cache/`.
Bots only see and shoot through clear lines of sight, and their missed
tracers stop at walls. Both bots and zombies walk A* paths around buildings,
trees and rocks. Bots react with a human delay, turn at a human speed, settle
their aim while tracking, fire rifles in bursts and reload. When they lose you
they push to where they last saw you, search, then patrol. They also react to
gunfire and to being shot.

## Honest scope

- **No AAA art assets:** soldiers, trees and buildings are built from code; they are not photo-scanned assets. The AK-47, M4A1-S, MP5 and AWP first-person models are real `.glb` models from the open-source [Tiny Strike](https://github.com/guyz/tinystrike) project (see `public/assets/weapons/LICENSE`).
- **No anti-cheat:** hit damage is reported by the shooter's client, not validated by the server. Fine for friends, not tamper-proof.
- **AI stays on the ground:** bots and zombies don't climb towers or use upper floors.
- **No real Call of Duty assets:** no assets, maps or content from Call of Duty were used.

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
        ├── localPlayer.js  Local player physics: movement, jump, crouch, collision grid
        ├── forest.js       Forest Outpost ground, instanced forest, grass
        ├── perf.js         Quality presets, static batching, BVH, light pool, post FX
        ├── grenades.js     Frag grenade physics
        ├── viewmodel.js    First-person weapon pass: weapon FOV, lighting, muzzle flash, brass
        ├── aircraft.js     Strike jet, bombs, UAV drone, tactical tablet
        ├── weaponModels.js Builds/caches the procedural guns (first- and third-person)
        └── weapons/        Procedural weapon library: parts, models/, surfaces.js (wear shaders)
        ├── audio.js        Procedural positional audio
        ├── world.js        Builds the 3D scene for a chosen map
        ├── playerModel.js  Visible representation of other players
        ├── weaponView.js   First-person weapon viewmodels
        ├── network.js      WebSocket client wrapper
        └── main.js         Lobby logic, game loop, shooting, HUD, wiring
```

## Customizing

- **Weapons/skins/maps**: edit the definitions in `public/js/constants.js`
  (`WEAPONS`, `SKINS`, `MAPS`, flight/rocket tuning, etc).
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
