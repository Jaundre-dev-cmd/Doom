// Builds the Three.js scene for a chosen map. Everything is primitive
// geometry (cones, cylinders, boxes, instanced planes for grass) built in
// code — no external model or texture files to source, license, or ship.

import * as THREE from 'three';
import { WORLD_SIZE, MAPS, BUY_STATIONS, UPGRADE_BENCHES, SPAWN_POINTS } from './constants.js';
import { buildWeaponMesh } from './weaponView.js';

// Deterministic pseudo-random generator (no dependency, reproducible map).
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function isNearAnyPoint(x, z, points, radius) {
  for (const p of points) {
    if (Math.hypot(x - p.x, z - p.z) < radius) return true;
  }
  return false;
}

function getKeepClearPoints() {
  return [...BUY_STATIONS, ...UPGRADE_BENCHES, ...SPAWN_POINTS];
}

// A gradient sky (horizon color at the bottom, sky color at the top)
// instead of one flat background color — reads far less like "standing
// inside a colored box." Built from vertex colors on a big inverted
// sphere, so it needs no custom shader.
function makeSkyDome(topColor, bottomColor, radius = 400) {
  const geometry = new THREE.SphereGeometry(radius, 24, 16);
  const top = new THREE.Color(topColor);
  const bottom = new THREE.Color(bottomColor);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / radius + 0.15, 0, 1);
    const c = bottom.clone().lerp(top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geometry, material);
}

// Procedural speckled surface texture (ground, concrete, bark, ...) —
// breaks up a flat color into something with actual surface detail,
// without needing an external image file.
function makeSpeckleTexture({ base, speck, size = 256, count = 3500, repeat = 40 }) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.fillStyle = speck;
    const r = 0.4 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

// Vertical streaky bark texture for tree trunks.
function makeBarkTexture(base = '#5b3a22', size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let x = 0; x < size; x += 3) {
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.08 + Math.random() * 0.18})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x + (Math.random() - 0.5) * 2, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return texture;
}

// --- Trees: a trunk plus a layered, tapering canopy (3 stacked cones)
// instead of one cone, with a slight natural lean and size variation. ---
function makeTree(x, z, rand, materials) {
  const group = new THREE.Group();

  const trunkHeight = 2.2 + rand() * 1.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, trunkHeight, 8), materials.trunk);
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  group.add(trunk);

  let y = trunkHeight * 0.55;
  let radius = 1.5 + rand() * 0.5;
  for (let i = 0; i < 3; i++) {
    const h = 1.6 - i * 0.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 8), materials.canopy[i]);
    cone.position.y = y + h / 2;
    cone.castShadow = true;
    group.add(cone);
    y += h * 0.55;
    radius *= 0.72;
  }

  const scale = 0.85 + rand() * 0.4;
  group.position.set(x, 0, z);
  group.rotation.z = (rand() - 0.5) * 0.08;
  group.scale.setScalar(scale);
  return { group, radius: 0.5 * scale };
}

// --- Rocks: a small irregular cluster of 2-4 low-poly boulders instead
// of one perfect dodecahedron, for a more natural formation. ---
function makeRockCluster(x, z, rand, material) {
  const group = new THREE.Group();
  const count = 2 + Math.floor(rand() * 3);
  let maxR = 0;

  for (let i = 0; i < count; i++) {
    const size = 0.5 + rand() * 0.9;
    maxR = Math.max(maxR, size);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), material);
    rock.position.set((rand() - 0.5) * 1.2, size * 0.4, (rand() - 0.5) * 1.2);
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  group.position.set(x, 0, z);
  return { group, radius: maxR * 1.3 };
}

// --- Grass: thousands of cross-billboard blades via GPU instancing (two
// instanced planes per blade, crossed 90 degrees) — cheap to render in
// bulk, purely decorative (no collision). ---
function makeGrassField(half, rand, count = 6000) {
  const group = new THREE.Group();

  const bladeGeoA = new THREE.PlaneGeometry(0.22, 0.6);
  bladeGeoA.translate(0, 0.3, 0);
  const bladeGeoB = bladeGeoA.clone();
  bladeGeoB.rotateY(Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, side: THREE.DoubleSide, roughness: 1 });
  const meshA = new THREE.InstancedMesh(bladeGeoA, material, count);
  const meshB = new THREE.InstancedMesh(bladeGeoB, material, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * (half * 2 - 6);
    const z = (rand() - 0.5) * (half * 2 - 6);
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(0.7 + rand() * 0.8);
    dummy.updateMatrix();
    meshA.setMatrixAt(i, dummy.matrix);
    meshB.setMatrixAt(i, dummy.matrix);
  }
  meshA.instanceMatrix.needsUpdate = true;
  meshB.instanceMatrix.needsUpdate = true;

  group.add(meshA, meshB);
  return group;
}

// --- Buy stations / upgrade bench kiosks, with a 3D icon of what they sell. --
function makeKiosk(x, z, trimColor, weaponKeyForIcon) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.1, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x2d3139, metalness: 0.4, roughness: 0.5 })
  );
  base.position.y = 0.55;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.08, 1.1),
    new THREE.MeshStandardMaterial({ color: trimColor, emissive: trimColor, emissiveIntensity: 0.5 })
  );
  trim.position.y = 1.12;
  group.add(trim);

  if (weaponKeyForIcon) {
    const icon = buildWeaponMesh(weaponKeyForIcon);
    icon.scale.setScalar(1.8);
    icon.position.y = 1.55;
    icon.rotation.y = Math.PI / 4;
    group.add(icon);
  } else {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.07, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xf1c40f, emissiveIntensity: 0.6 })
    );
    ring.position.y = 1.55;
    group.add(ring);
  }

  group.position.set(x, 0, z);
  return group;
}

export function buildWorld(mapId) {
  const def = MAPS[mapId] || MAPS.forest;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(def.sky); // fallback behind the sky dome
  scene.add(makeSkyDome(def.sky, def.fogColor));
  scene.fog = new THREE.FogExp2(def.fogColor, def.fogDensity);

  // Hemisphere light (sky color from above, ground-bounce color from
  // below) reads far more like real outdoor/indoor ambient light than a
  // single flat ambient term.
  scene.add(new THREE.HemisphereLight(def.sky, def.groundColor, 0.8));

  // Flat, colorless safety-net fill light: guarantees every map has some
  // minimum visibility, no matter how dark its themed palette is or how
  // aggressively tone mapping compresses it. Prevents a repeat of a map
  // rendering as a literal solid-black screen.
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const sun = new THREE.DirectionalLight(def.sun, 0.9);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  // The zombies map reuses the techbase terrain, so its darker, grimier
  // `groundColor` tint (applied below) is what differentiates it visually
  // from the regular Techbase Arena — no separate texture needed.
  const groundSpeckle =
    def.terrain === 'techbase'
      ? makeSpeckleTexture({ base: '#54585e', speck: '#2e3136', repeat: 48 })
      : makeSpeckleTexture({ base: '#4a7c3f', speck: '#5a9a4a', repeat: 48 });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshStandardMaterial({ map: groundSpeckle, color: def.groundColor, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const collidables = [];
  const half = WORLD_SIZE / 2;
  const keepClear = getKeepClearPoints();
  const rand = makeRng(def.terrain === 'techbase' ? 4242 : 1337);

  if (def.terrain === 'techbase') {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4b5560, roughness: 0.7, metalness: 0.2 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.3 });

    const crateSpots = [
      [-45, -20], [45, -20], [-45, 20], [45, 20],
      [0, -55], [0, 55], [-70, 0], [70, 0],
      [-20, -40], [20, 40], [-60, -40], [60, 40],
    ];
    for (const [x, z] of crateSpots) {
      if (isNearAnyPoint(x, z, keepClear, 6)) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), crateMat);
      mesh.position.set(x, 0.7, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      collidables.push({ x, z, radius: 1.0 });
    }

    for (let i = 0; i < 16; i++) {
      const x = (rand() - 0.5) * (WORLD_SIZE - 20);
      const z = (rand() - 0.5) * (WORLD_SIZE - 20);
      if (isNearAnyPoint(x, z, keepClear, 6)) continue;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 0.6), slabMat);
      slab.position.set(x, 1.1, z);
      slab.rotation.y = rand() * Math.PI;
      slab.castShadow = true;
      slab.receiveShadow = true;
      scene.add(slab);
      collidables.push({ x, z, radius: 2 });
    }

    // Techbase-terrain maps stay bare concrete by design — no grass field
    // here, unlike the forest terrain below. The zombies map adds flickering
    // emergency lights for atmosphere.
    if (def.mode === 'zombies') {
      // Spread lights out to the spawn corners too (±90), not just the
      // middle of the map, so nobody spawns in total darkness.
      const lightSpots = [
        [-40, -40], [40, -40], [-40, 40], [40, 40], [0, 0],
        [-90, -90], [90, -90], [-90, 90], [90, 90],
      ];
      for (const [x, z] of lightSpots) {
        const light = new THREE.PointLight(0xff5533, 1.8, 50);
        light.position.set(x, 3, z);
        scene.add(light);
      }
    }
  } else {
    const trunkMat = new THREE.MeshStandardMaterial({ map: makeBarkTexture(), roughness: 0.95 });
    const canopyMats = [0x2e5c2e, 0x356b35, 0x3d7a3d].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
    // Smooth shading (not flatShading) reads as weathered stone rather
    // than a faceted low-poly "gem" look.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777066, roughness: 1 });
    const treeMaterials = { trunk: trunkMat, canopy: canopyMats };

    const treeCount = 220;
    for (let i = 0; i < treeCount; i++) {
      const x = (rand() - 0.5) * (WORLD_SIZE - 10);
      const z = (rand() - 0.5) * (WORLD_SIZE - 10);
      if (isNearAnyPoint(x, z, keepClear, 7)) continue;
      const t = makeTree(x, z, rand, treeMaterials);
      scene.add(t.group);
      collidables.push({ x, z, radius: t.radius });
    }

    const rockCount = 30;
    for (let i = 0; i < rockCount; i++) {
      const x = (rand() - 0.5) * (WORLD_SIZE - 20);
      const z = (rand() - 0.5) * (WORLD_SIZE - 20);
      if (isNearAnyPoint(x, z, keepClear, 7)) continue;
      const r = makeRockCluster(x, z, rand, rockMat);
      scene.add(r.group);
      collidables.push({ x, z, radius: r.radius });
    }

    scene.add(makeGrassField(half, makeRng(99)));
  }

  // Buy stations: blue trim, topped with a 3D icon of the weapon they sell.
  for (const station of BUY_STATIONS) {
    const kiosk = makeKiosk(station.x, station.z, 0x2980b9, station.weapon);
    scene.add(kiosk);
    collidables.push({ x: station.x, z: station.z, radius: 1.1 });
  }

  // Upgrade bench: gold trim, topped with a glowing ring instead of a gun.
  for (const bench of UPGRADE_BENCHES) {
    const kiosk = makeKiosk(bench.x, bench.z, 0xf1c40f, null);
    scene.add(kiosk);
    collidables.push({ x: bench.x, z: bench.z, radius: 1.1 });
  }

  // Boundary walls so players can't wander off the (much bigger) world.
  const wallHeight = 5;
  const wallMat = new THREE.MeshStandardMaterial({
    color: def.terrain === 'techbase' ? 0x333840 : 0x6b5a3a,
    roughness: 0.9,
  });
  const wallDefs = [
    [0, -half, WORLD_SIZE, 1],
    [0, half, WORLD_SIZE, 1],
    [-half, 0, 1, WORLD_SIZE],
    [half, 0, 1, WORLD_SIZE],
  ];
  for (const [x, z, w, d] of wallDefs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
    wall.position.set(x, wallHeight / 2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  return { scene, collidables, bounds: half - 1.5 };
}
