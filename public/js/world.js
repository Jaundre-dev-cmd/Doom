// Builds the Three.js scene for a chosen map. Everything is primitive
// geometry (cones, cylinders, boxes, instanced planes for grass) built in
// code — no external model or texture files to source, license, or ship.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WORLD_SIZE, MAPS, SPAWN_POINTS } from './constants.js';

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
  return [...SPAWN_POINTS];
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
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'skydome';
  return mesh;
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
function makeGrassBladeGeometry(width, height) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -width / 2, 0, 0,
    width / 2, 0, 0,
    width * 0.32, height * 0.62, 0,
    -width * 0.32, height * 0.62, 0,
    0, height, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

function makeGrassField(half, rand, count = 6000) {
  const group = new THREE.Group();

  const bladeGeoA = makeGrassBladeGeometry(0.22, 0.6);
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

function makeGrassPatch(cx, cz, width, depth, rand, count = 700, clearWidth = 0, clearDepth = 0) {
  const group = new THREE.Group();
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x517345, roughness: 1 });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lawnMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.045;
  lawn.receiveShadow = true;
  group.add(lawn);

  const bladeGeoA = makeGrassBladeGeometry(0.16, 0.38);
  const bladeGeoB = bladeGeoA.clone();
  bladeGeoB.rotateY(Math.PI / 2);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x4d793f, side: THREE.DoubleSide, roughness: 1 });
  const meshA = new THREE.InstancedMesh(bladeGeoA, bladeMat, count);
  const meshB = new THREE.InstancedMesh(bladeGeoB, bladeMat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let bladeX;
    let bladeZ;
    do {
      bladeX = (rand() - 0.5) * width;
      bladeZ = (rand() - 0.5) * depth;
    } while (clearWidth > 0 && Math.abs(bladeX) < clearWidth / 2 && Math.abs(bladeZ) < clearDepth / 2);
    dummy.position.set(bladeX, 0.055, bladeZ);
    dummy.rotation.y = rand() * Math.PI;
    dummy.scale.setScalar(0.6 + rand() * 0.8);
    dummy.updateMatrix();
    meshA.setMatrixAt(i, dummy.matrix);
    meshB.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.27 + rand() * 0.05, 0.34 + rand() * 0.18, 0.28 + rand() * 0.12);
    meshA.setColorAt(i, color);
    meshB.setColorAt(i, color);
  }
  meshA.instanceMatrix.needsUpdate = true;
  meshB.instanceMatrix.needsUpdate = true;
  meshA.instanceColor.needsUpdate = true;
  meshB.instanceColor.needsUpdate = true;
  group.add(meshA, meshB);
  group.position.set(cx, 0, cz);
  return group;
}

function makeDeciduousTree(x, z, rand, collidables) {
  const group = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: makeBarkTexture('#60452f', 48), roughness: 1 });
  const leafColors = [0x3e6c37, 0x4a7b3f, 0x557f43, 0x356332];
  const trunkHeight = 3.7 + rand() * 1.2;
  addBox(group, new THREE.CylinderGeometry(0.25, 0.42, trunkHeight, 9), bark, 0, trunkHeight / 2, 0);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + rand() * 0.5;
    const branch = addBox(group, new THREE.CylinderGeometry(0.09, 0.17, 2.1, 7), bark, Math.sin(angle) * 0.62, trunkHeight - 0.2, Math.cos(angle) * 0.62);
    branch.rotation.z = Math.sin(angle) * 0.75;
    branch.rotation.x = Math.cos(angle) * 0.75;
  }
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2 + rand() * 0.35;
    const radius = 1.15 + rand() * 0.55;
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 2),
      new THREE.MeshStandardMaterial({ color: leafColors[i % leafColors.length], roughness: 0.88 })
    );
    leaves.position.set(Math.sin(angle) * (0.7 + rand()), trunkHeight + 0.45 + rand() * 1.15, Math.cos(angle) * (0.7 + rand()));
    leaves.scale.y = 0.85 + rand() * 0.35;
    leaves.castShadow = true;
    group.add(leaves);
  }
  group.position.set(x, 0, z);
  collidables.push({ x, z, radius: 0.55 });
  return group;
}

// Adds a line of circular collision points along a wall segment — our
// collision system (localPlayer.js) only understands circles, so a
// rectangular wall is approximated as a row of overlapping circles, with
// a usable gap left wherever a door should be. This is the same technique
// already used for every other obstacle on the map.
function addWallCollision(
  collidables,
  x1,
  z1,
  x2,
  z2,
  radius = 0.35,
  spacing = 0.6,
  minY = -Infinity,
  maxY = Infinity
) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    collidables.push({ x: x1 + dx * t, z: z1 + dz * t, radius, minY, maxY });
  }
}

function addSolidRectCollision(collidables, x, z, width, depth, spacing = 1.2) {
  const hw = width / 2;
  const hd = depth / 2;
  addWallCollision(collidables, x - hw, z - hd, x + hw, z - hd, 0.5, spacing);
  addWallCollision(collidables, x - hw, z + hd, x + hw, z + hd, 0.5, spacing);
  addWallCollision(collidables, x - hw, z - hd, x - hw, z + hd, 0.5, spacing);
  addWallCollision(collidables, x + hw, z - hd, x + hw, z + hd, 0.5, spacing);
}

function addBox(group, geometry, material, x, y, z, { cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  group.add(mesh);
  return mesh;
}

// A real walled building — four walls (one with a walk-through doorway),
// a hip roof, and a couple of windows — not just a prop you walk around.
// Pushes its own wall collision into `collidables` so players can't walk
// through the walls, only through the door gap.
function makeHouse(x, z, collidables, opts = {}) {
  const {
    width = 6,
    depth = 5,
    wallHeight = 2.6,
    doorSide = 'south', // 'north' | 'south' | 'east' | 'west'
    doorWidth = 1.9,
    wallColor = 0x8a7458,
    roofColor = 0x5a3a2a,
  } = opts;

  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe4dfd2, roughness: 0.8 });
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1 });
  const porchMat = new THREE.MeshStandardMaterial({ color: 0x81715e, roughness: 0.95 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x1a2a33,
    roughness: 0.25,
    metalness: 0.1,
    emissive: 0x334455,
    emissiveIntensity: 0.2,
  });

  const hw = width / 2;
  const hd = depth / 2;
  const wallThickness = 0.2;

  const foundation = addBox(
    group,
    new THREE.BoxGeometry(width + 0.35, 0.28, depth + 0.35),
    foundationMat,
    0,
    0.14,
    0
  );
  foundation.receiveShadow = true;

  function addWallBox(cx, cz, w, d) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
    mesh.position.set(cx, wallHeight / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Each wall is defined by its world-space endpoints (for collision) and
  // center/size (for the mesh). The door side gets split into two shorter
  // segments with a gap between them instead of one solid wall.
  const walls = [
    { side: 'north', x1: -hw, z1: -hd, x2: hw, z2: -hd, axis: 'x' },
    { side: 'south', x1: -hw, z1: hd, x2: hw, z2: hd, axis: 'x' },
    { side: 'west', x1: -hw, z1: -hd, x2: -hw, z2: hd, axis: 'z' },
    { side: 'east', x1: hw, z1: -hd, x2: hw, z2: hd, axis: 'z' },
  ];

  for (const wall of walls) {
    const full = wall.axis === 'x' ? width : depth;
    if (wall.side === doorSide) {
      const seg = (full - doorWidth) / 2;
      const midX = (wall.x1 + wall.x2) / 2;
      const midZ = (wall.z1 + wall.z2) / 2;
      if (wall.axis === 'x') {
        addWallBox(wall.x1 + seg / 2, midZ, seg, wallThickness);
        addWallBox(wall.x2 - seg / 2, midZ, seg, wallThickness);
        addWallCollision(collidables, x + wall.x1, z + midZ, x + wall.x1 + seg, z + midZ, 0.24, 0.5);
        addWallCollision(collidables, x + wall.x2 - seg, z + midZ, x + wall.x2, z + midZ, 0.24, 0.5);
      } else {
        addWallBox(midX, wall.z1 + seg / 2, wallThickness, seg);
        addWallBox(midX, wall.z2 - seg / 2, wallThickness, seg);
        addWallCollision(collidables, x + midX, z + wall.z1, x + midX, z + wall.z1 + seg, 0.24, 0.5);
        addWallCollision(collidables, x + midX, z + wall.z2 - seg, x + midX, z + wall.z2, 0.24, 0.5);
      }
    } else {
      const cx = (wall.x1 + wall.x2) / 2;
      const cz = (wall.z1 + wall.z2) / 2;
      addWallBox(cx, cz, wall.axis === 'x' ? width : wallThickness, wall.axis === 'x' ? wallThickness : depth);
      addWallCollision(collidables, x + wall.x1, z + wall.z1, x + wall.x2, z + wall.z2, 0.24, 0.5);
    }
  }

  // Simple hip roof (a 4-sided cone, rotated 45 degrees to sit square).
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(hw, hd) * 1.2, 1.8, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = wallHeight + 0.9;
  roof.castShadow = true;
  group.add(roof);

  // A couple of windows for visual interest (flush with the east/west walls).
  for (const side of [1, -1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
    win.position.set(side * (hw + 0.011), wallHeight * 0.55, 0);
    win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(win);

    const sill = addBox(group, new THREE.BoxGeometry(0.18, 0.1, 1.08), trimMat, side * (hw + 0.08), wallHeight * 0.33, 0);
    sill.rotation.y = 0;
  }


  // Front details make the doorway read as an actual home rather than a
  // missing wall segment: porch slab, lintel, posts, small canopy and step.
  const frontIsX = doorSide === 'north' || doorSide === 'south';
  const frontSign = doorSide === 'south' || doorSide === 'east' ? 1 : -1;
  const doorwayOffset = frontIsX
    ? new THREE.Vector3(0, 0, frontSign * (hd + 0.04))
    : new THREE.Vector3(frontSign * (hw + 0.04), 0, 0);
  const porch = addBox(
    group,
    new THREE.BoxGeometry(frontIsX ? 2.8 : 1.25, 0.16, frontIsX ? 1.25 : 2.8),
    porchMat,
    doorwayOffset.x + (frontIsX ? 0 : frontSign * 0.58),
    0.16,
    doorwayOffset.z + (frontIsX ? frontSign * 0.58 : 0)
  );
  porch.receiveShadow = true;

  const lintel = addBox(
    group,
    new THREE.BoxGeometry(frontIsX ? doorWidth + 0.35 : 0.16, 0.14, frontIsX ? 0.16 : doorWidth + 0.35),
    trimMat,
    doorwayOffset.x,
    2.25,
    doorwayOffset.z
  );
  lintel.castShadow = true;

  const canopy = addBox(
    group,
    new THREE.BoxGeometry(frontIsX ? 2.45 : 1.2, 0.14, frontIsX ? 1.2 : 2.45),
    roofMat,
    doorwayOffset.x + (frontIsX ? 0 : frontSign * 0.5),
    2.35,
    doorwayOffset.z + (frontIsX ? frontSign * 0.5 : 0)
  );
  canopy.rotation[frontIsX ? 'x' : 'z'] = frontSign * 0.09;

  for (const side of [-1, 1]) {
    const px = frontIsX ? side * 1.0 : doorwayOffset.x + frontSign * 0.9;
    const pz = frontIsX ? doorwayOffset.z + frontSign * 0.9 : side * 1.0;
    addBox(group, new THREE.CylinderGeometry(0.07, 0.09, 2.1, 8), trimMat, px, 1.18, pz);
  }

  // Chimney and gutters add a domestic silhouette that contrasts strongly
  // with the neighboring factory blocks.
  addBox(group, new THREE.BoxGeometry(0.55, 1.65, 0.55), new THREE.MeshStandardMaterial({ color: 0x6d5141, roughness: 1 }), -hw * 0.55, wallHeight + 1.15, 0);
  for (const side of [-1, 1]) {
    addBox(group, new THREE.CylinderGeometry(0.055, 0.055, width + 0.25, 6), trimMat, 0, wallHeight + 0.18, side * (hd + 0.12)).rotation.z = Math.PI / 2;
  }

  // Furnished interior. Keeping the center aisle open makes the rooms useful
  // during play, while furniture around the walls makes looking through or
  // walking through the doorway feel like entering a lived-in home.
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x72513a, roughness: 0.88 });
  const fabricMat = new THREE.MeshStandardMaterial({ color: opts.fabricColor || 0x526779, roughness: 0.96 });
  const beddingMat = new THREE.MeshStandardMaterial({ color: 0xd2c9b7, roughness: 1 });
  const applianceMat = new THREE.MeshStandardMaterial({ color: 0xc5c6c0, roughness: 0.65, metalness: 0.18 });
  const rugMat = new THREE.MeshStandardMaterial({ color: opts.rugColor || 0x784b42, roughness: 1 });

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(2.2, width * 0.42), 1.65), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.295, 0.2);
  group.add(rug);

  // Bed and nightstand in the back corner.
  addBox(group, new THREE.BoxGeometry(1.65, 0.42, 2.05), woodMat, -hw + 1.08, 0.5, -hd + 1.25);
  addBox(group, new THREE.BoxGeometry(1.48, 0.22, 1.82), beddingMat, -hw + 1.08, 0.79, -hd + 1.25);
  addBox(group, new THREE.BoxGeometry(0.52, 0.52, 0.52), woodMat, -hw + 2.25, 0.55, -hd + 0.48);

  // Compact kitchen run and fridge along the opposite wall.
  addBox(group, new THREE.BoxGeometry(2.15, 0.88, 0.55), woodMat, hw - 1.25, 0.72, -hd + 0.42);
  addBox(group, new THREE.BoxGeometry(0.72, 1.75, 0.68), applianceMat, hw - 0.5, 1.16, -hd + 1.25);
  addBox(group, new THREE.BoxGeometry(2.18, 0.08, 0.62), applianceMat, hw - 1.25, 1.19, -hd + 0.42);

  // Sofa, coffee table and a warm ceiling light.
  addBox(group, new THREE.BoxGeometry(2.0, 0.58, 0.72), fabricMat, hw - 1.25, 0.65, hd - 0.65);
  addBox(group, new THREE.BoxGeometry(2.0, 0.62, 0.18), fabricMat, hw - 1.25, 1.02, hd - 0.94);
  addBox(group, new THREE.BoxGeometry(1.15, 0.33, 0.6), woodMat, 0, 0.48, 0.35);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe4af, emissive: 0xffc46c, emissiveIntensity: 1.25 });
  addBox(group, new THREE.SphereGeometry(0.12, 10, 8), bulbMat, 0, wallHeight - 0.18, 0, { cast: false });

  // The door is visibly open against the inside wall, matching the actual
  // collision gap instead of presenting a fake closed surface.
  const doorMat = new THREE.MeshStandardMaterial({ color: opts.doorColor || 0x594536, roughness: 0.82 });
  const openDoor = addBox(group, new THREE.BoxGeometry(doorWidth, 2.05, 0.1), doorMat, 0, 1.31, 0);
  if (frontIsX) {
    openDoor.position.set(-doorWidth * 0.43, 1.31, doorwayOffset.z - frontSign * 0.5);
    openDoor.rotation.y = Math.PI / 2.8;
  } else {
    openDoor.position.set(doorwayOffset.x - frontSign * 0.5, 1.31, -doorWidth * 0.43);
    openDoor.rotation.y = Math.PI / 2 - Math.PI / 2.8;
  }

  collidables.push(
    { x: x - hw + 1.08, z: z - hd + 1.25, radius: 0.85 },
    { x: x + hw - 1.25, z: z - hd + 0.42, radius: 0.85 },
    { x: x + hw - 1.25, z: z + hd - 0.72, radius: 0.9 },
    { x, z: z + 0.35, radius: 0.45 }
  );

  group.position.set(x, 0, z);
  return group;
}

// Industrial buildings are assembled as accessible shells, not solid boxes.
// A wide loading-door opening creates useful combat routes while the remaining
// walls participate in the same collision system as the houses.
function makeIndustrialHall(x, z, collidables, opts = {}) {
  const {
    width = 28,
    depth = 22,
    height = 7,
    doorSide = 'south',
    wallColor = 0x70767a,
    accentColor = 0xd08b2f,
    sawtooth = false,
    label = 'WORKS',
  } = opts;
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.8, metalness: 0.12 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x30363b, roughness: 0.48, metalness: 0.65 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x7699a6, emissive: 0x182a31, emissiveIntensity: 0.25, roughness: 0.22, metalness: 0.25 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x414447, roughness: 0.95 });
  const hw = width / 2;
  const hd = depth / 2;
  const wallThickness = 0.35;
  const doorWidth = Math.min(7, width * 0.33);
  const doorHeight = 4.5;

  addBox(group, new THREE.BoxGeometry(width, 0.22, depth), floorMat, 0, 0.11, 0);

  const sides = [
    { name: 'north', axis: 'x', fixed: -hd, length: width },
    { name: 'south', axis: 'x', fixed: hd, length: width },
    { name: 'west', axis: 'z', fixed: -hw, length: depth },
    { name: 'east', axis: 'z', fixed: hw, length: depth },
  ];
  for (const side of sides) {
    const isX = side.axis === 'x';
    if (side.name === doorSide) {
      const segment = (side.length - doorWidth) / 2;
      for (const sign of [-1, 1]) {
        const along = sign * (doorWidth / 2 + segment / 2);
        addBox(
          group,
          new THREE.BoxGeometry(isX ? segment : wallThickness, height, isX ? wallThickness : segment),
          wallMat,
          isX ? along : side.fixed,
          height / 2,
          isX ? side.fixed : along
        );
      }
      addBox(
        group,
        new THREE.BoxGeometry(isX ? doorWidth : wallThickness, height - doorHeight, isX ? wallThickness : doorWidth),
        wallMat,
        isX ? 0 : side.fixed,
        doorHeight + (height - doorHeight) / 2,
        isX ? side.fixed : 0
      );
      if (isX) {
        addWallCollision(collidables, x - hw, z + side.fixed, x - doorWidth / 2, z + side.fixed);
        addWallCollision(collidables, x + doorWidth / 2, z + side.fixed, x + hw, z + side.fixed);
      } else {
        addWallCollision(collidables, x + side.fixed, z - hd, x + side.fixed, z - doorWidth / 2);
        addWallCollision(collidables, x + side.fixed, z + doorWidth / 2, x + side.fixed, z + hd);
      }

      // Safety-yellow loading-door frame and striped threshold.
      for (const sign of [-1, 1]) {
        addBox(
          group,
          new THREE.BoxGeometry(isX ? 0.22 : wallThickness + 0.12, doorHeight, isX ? wallThickness + 0.12 : 0.22),
          accentMat,
          isX ? sign * doorWidth / 2 : side.fixed,
          doorHeight / 2,
          isX ? side.fixed : sign * doorWidth / 2
        );
      }
    } else {
      addBox(
        group,
        new THREE.BoxGeometry(isX ? side.length : wallThickness, height, isX ? wallThickness : side.length),
        wallMat,
        isX ? 0 : side.fixed,
        height / 2,
        isX ? side.fixed : 0
      );
      if (isX) addWallCollision(collidables, x - hw, z + side.fixed, x + hw, z + side.fixed);
      else addWallCollision(collidables, x + side.fixed, z - hd, x + side.fixed, z + hd);
    }
  }

  // Steel roof with optional north-light sawtooth profile.
  if (sawtooth) {
    const bays = 4;
    for (let i = 0; i < bays; i++) {
      const roof = addBox(group, new THREE.BoxGeometry(width / bays + 0.2, 0.28, depth + 0.5), steelMat, -hw + (i + 0.5) * width / bays, height + 0.75, 0);
      roof.rotation.z = -0.16;
      const clerestory = addBox(group, new THREE.BoxGeometry(0.18, 1.4, depth - 1), glassMat, -hw + i * width / bays + 0.35, height + 0.65, 0);
      clerestory.castShadow = false;
    }
  } else {
    addBox(group, new THREE.BoxGeometry(width + 0.7, 0.38, depth + 0.7), steelMat, 0, height + 0.19, 0);
  }

  // Raised seams break up the large walls like real corrugated cladding and
  // give the buildings readable scale at street level.
  for (let px = -hw + 1.2; px < hw; px += 2.2) {
    if (doorSide !== 'north') addBox(group, new THREE.BoxGeometry(0.07, height - 0.45, 0.1), steelMat, px, height / 2, -hd - 0.19);
    if (doorSide !== 'south') addBox(group, new THREE.BoxGeometry(0.07, height - 0.45, 0.1), steelMat, px, height / 2, hd + 0.19);
  }
  for (let pz = -hd + 1.2; pz < hd; pz += 2.2) {
    if (doorSide !== 'west') addBox(group, new THREE.BoxGeometry(0.1, height - 0.45, 0.07), steelMat, -hw - 0.19, height / 2, pz);
    if (doorSide !== 'east') addBox(group, new THREE.BoxGeometry(0.1, height - 0.45, 0.07), steelMat, hw + 0.19, height / 2, pz);
  }

  // Interior steel portal frames and stored pallets make each enterable hall
  // useful as an indoor route instead of an empty shell.
  for (const frameX of [-hw * 0.62, 0, hw * 0.62]) {
    for (const frameZ of [-hd + 0.55, hd - 0.55]) {
      addBox(group, new THREE.BoxGeometry(0.22, height - 0.3, 0.22), steelMat, frameX, (height - 0.3) / 2, frameZ);
    }
    addBox(group, new THREE.BoxGeometry(0.22, 0.22, depth - 1), steelMat, frameX, height - 0.35, 0);
  }
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x775535, roughness: 0.96 });
  const cartonMat = new THREE.MeshStandardMaterial({ color: 0x8b7356, roughness: 0.94 });
  for (const [px, pz] of [[-hw + 2.2, hd - 2], [hw - 2.3, -hd + 2]]) {
    for (let layer = 0; layer < 3; layer++) {
      addBox(group, new THREE.BoxGeometry(1.65, 0.1, 1.15), palletMat, px, 0.1 + layer * 0.68, pz);
      addBox(group, new THREE.BoxGeometry(1.35, 0.55, 0.95), cartonMat, px, 0.43 + layer * 0.68, pz);
    }
    collidables.push({ x: x + px, z: z + pz, radius: 1.05 });
  }

  // Regular high windows, roof vents and a simple sign board.
  for (let i = -1; i <= 1; i++) {
    const win = addBox(group, new THREE.BoxGeometry(2.5, 1.05, 0.08), glassMat, i * width * 0.22, height * 0.67, -hd - 0.02, { cast: false });
    win.receiveShadow = false;
  }
  for (const offset of [-width * 0.24, width * 0.24]) {
    addBox(group, new THREE.CylinderGeometry(0.7, 0.82, 0.7, 12), steelMat, offset, height + 0.7, 0);
    addBox(group, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), accentMat, offset, height + 1.18, 0);
  }

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 128;
  const signCtx = signCanvas.getContext('2d');
  signCtx.fillStyle = '#202428';
  signCtx.fillRect(0, 0, 512, 128);
  signCtx.strokeStyle = '#d08b2f';
  signCtx.lineWidth = 10;
  signCtx.strokeRect(5, 5, 502, 118);
  signCtx.fillStyle = '#ece7d9';
  signCtx.font = 'bold 58px sans-serif';
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillText(label, 256, 67);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide })
  );
  sign.position.set(0, height - 1.1, -hd - 0.2);
  group.add(sign);

  group.position.set(x, 0, z);
  return group;
}

function makeStorageTank(x, z, collidables, opts = {}) {
  const { radius = 3.2, height = 8, color = 0x9aa0a1, hazard = 0xd89b31 } = opts;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: 0.55, metalness: 0.75 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: hazard, roughness: 0.6, metalness: 0.2 });
  addBox(group, new THREE.CylinderGeometry(radius, radius, height, 24), metal, 0, height / 2, 0);
  addBox(group, new THREE.SphereGeometry(radius, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, height, 0);
  for (const y of [1.1, height * 0.5, height - 0.5]) {
    addBox(group, new THREE.TorusGeometry(radius + 0.05, 0.09, 7, 32), dark, 0, y, 0).rotation.x = Math.PI / 2;
  }
  // Vertical ladder and cage hoops.
  for (const side of [-0.32, 0.32]) addBox(group, new THREE.CylinderGeometry(0.045, 0.045, height - 0.6, 6), dark, radius + 0.12, height / 2, side);
  for (let y = 0.8; y < height; y += 0.42) addBox(group, new THREE.BoxGeometry(0.12, 0.045, 0.7), hazardMat, radius + 0.12, y, 0);
  group.position.set(x, 0, z);
  collidables.push({ x, z, radius: radius + 0.3 });
  return group;
}

function makeChimney(x, z, collidables, opts = {}) {
  const { height = 20, radius = 1.45 } = opts;
  const group = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ color: 0x765145, roughness: 0.95 });
  const band = new THREE.MeshStandardMaterial({ color: 0xb9bab5, roughness: 0.7, metalness: 0.3 });
  addBox(group, new THREE.CylinderGeometry(radius * 0.72, radius, height, 18), brick, 0, height / 2, 0);
  for (const y of [height * 0.35, height * 0.68, height * 0.92]) {
    addBox(group, new THREE.TorusGeometry(radius * (1 - y / height * 0.2), 0.1, 6, 24), band, 0, y, 0).rotation.x = Math.PI / 2;
  }
  addBox(group, new THREE.CylinderGeometry(radius * 0.82, radius * 0.82, 0.35, 18), band, 0, height + 0.1, 0);
  group.position.set(x, 0, z);
  collidables.push({ x, z, radius: radius + 0.25 });
  return group;
}

function makeCargoContainer(x, z, rotation, collidables, color = 0x9a4f36) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.45 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x292d30, roughness: 0.55, metalness: 0.7 });
  addBox(group, new THREE.BoxGeometry(6, 2.65, 2.45), bodyMat, 0, 1.325, 0);
  for (let i = -2; i <= 2; i++) addBox(group, new THREE.BoxGeometry(0.07, 2.35, 2.5), edgeMat, i * 1.15, 1.325, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(group, new THREE.BoxGeometry(0.16, 2.8, 0.16), edgeMat, sx * 2.92, 1.4, sz * 1.18);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const alongX = Math.abs(Math.cos(rotation)) > 0.7;
  addSolidRectCollision(collidables, x, z, alongX ? 6 : 2.45, alongX ? 2.45 : 6);
  return group;
}

function makePipeRack(x, z, length, rotation, collidables) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x363c40, roughness: 0.5, metalness: 0.75 });
  const pipeMats = [0xc18a32, 0x758b65, 0x8f5b50].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 }));
  for (const along of [-length / 2, 0, length / 2]) {
    for (const side of [-1, 1]) addBox(group, new THREE.BoxGeometry(0.18, 4.8, 0.18), steel, along, 2.4, side * 1.35);
    addBox(group, new THREE.BoxGeometry(0.25, 0.22, 3), steel, along, 4.55, 0);
  }
  for (let i = 0; i < 3; i++) {
    const pipe = addBox(group, new THREE.CylinderGeometry(0.16, 0.16, length + 0.5, 10), pipeMats[i], 0, 3.25 + i * 0.48, -0.75 + i * 0.75);
    pipe.rotation.z = Math.PI / 2;
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  // Only the upright supports block movement; players can run beneath pipes.
  for (const along of [-length / 2, 0, length / 2]) {
    const px = x + Math.cos(rotation) * along;
    const pz = z - Math.sin(rotation) * along;
    collidables.push({ x: px, z: pz, radius: 1.55 });
  }
  return group;
}

function makeStreetLight(x, z, rotation = 0) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x303438, roughness: 0.55, metalness: 0.75 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe1a6, emissive: 0xffc76b, emissiveIntensity: 1.8 });
  addBox(group, new THREE.CylinderGeometry(0.08, 0.13, 5.5, 8), poleMat, 0, 2.75, 0);
  addBox(group, new THREE.BoxGeometry(1.4, 0.12, 0.12), poleMat, 0.62, 5.35, 0);
  addBox(group, new THREE.BoxGeometry(0.55, 0.16, 0.34), lampMat, 1.25, 5.22, 0, { cast: false });
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeForklift(x, z, rotation, collidables) {
  const group = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd49a28, roughness: 0.55, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252a2d, roughness: 0.5, metalness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x17191a, roughness: 0.95 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x30383c, roughness: 0.85 });
  addBox(group, new THREE.BoxGeometry(2.2, 0.65, 1.25), yellow, 0, 0.75, 0);
  addBox(group, new THREE.BoxGeometry(0.85, 0.85, 1.15), yellow, -0.58, 1.35, 0);
  addBox(group, new THREE.BoxGeometry(0.48, 0.65, 0.82), seat, 0.32, 1.25, 0);
  for (const side of [-1, 1]) {
    for (const axle of [-0.65, 0.65]) {
      const wheel = addBox(group, new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), rubber, axle, 0.48, side * 0.69);
      wheel.rotation.x = Math.PI / 2;
    }
  }
  // Driver cage, lifting mast, and paired forks.
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.5, 0.5]) addBox(group, new THREE.BoxGeometry(0.1, 1.8, 0.1), dark, sx, 2.15, sz);
  addBox(group, new THREE.BoxGeometry(1, 0.12, 1.2), dark, 0, 3.05, 0);
  for (const side of [-0.38, 0.38]) addBox(group, new THREE.BoxGeometry(0.12, 3.1, 0.12), dark, 1.28, 1.55, side);
  addBox(group, new THREE.BoxGeometry(0.18, 0.18, 1.05), dark, 1.42, 0.58, 0);
  for (const side of [-0.36, 0.36]) addBox(group, new THREE.BoxGeometry(2.2, 0.1, 0.13), dark, 2.35, 0.25, side);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  collidables.push({ x, z, radius: 1.45 });
  return group;
}

function makeParkedCar(x, z, rotation, collidables, color = 0x4e6878) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.48 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x252a2d, roughness: 0.5, metalness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.96 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x29434f, roughness: 0.18, metalness: 0.3 });
  const light = new THREE.MeshStandardMaterial({ color: 0xffe5ad, emissive: 0xffc66d, emissiveIntensity: 0.7 });
  addBox(group, new THREE.BoxGeometry(4.2, 0.72, 1.78), paint, 0, 0.72, 0);
  addBox(group, new THREE.BoxGeometry(2.15, 0.78, 1.55), paint, -0.25, 1.42, 0);
  for (const side of [-1, 1]) {
    const windshield = addBox(group, new THREE.BoxGeometry(0.78, 0.58, 0.05), glass, side * 0.72 - 0.25, 1.55, side > 0 ? 0.79 : -0.79, { cast: false });
    windshield.rotation.x = side * 0.08;
  }
  for (const axleX of [-1.35, 1.25]) {
    for (const sideZ of [-1, 1]) {
      const wheel = addBox(group, new THREE.CylinderGeometry(0.37, 0.37, 0.25, 14), tire, axleX, 0.48, sideZ * 0.9);
      wheel.rotation.x = Math.PI / 2;
    }
  }
  for (const sideZ of [-0.55, 0.55]) addBox(group, new THREE.BoxGeometry(0.12, 0.24, 0.34), light, 2.12, 0.8, sideZ, { cast: false });
  addBox(group, new THREE.BoxGeometry(0.12, 0.18, 1.1), trim, -2.12, 0.68, 0);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  collidables.push({ x, z, radius: 2.25, minY: 0, maxY: 1.8 });
  return group;
}

function makeDrumCluster(x, z, collidables, count = 4) {
  const group = new THREE.Group();
  const colors = [0x466878, 0x8b5d35, 0x6f7651];
  const spots = [[-0.5, -0.5], [0.5, -0.45], [-0.45, 0.5], [0.55, 0.55], [0, 1.15]];
  for (let i = 0; i < count; i++) {
    const [dx, dz] = spots[i];
    const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.62, metalness: 0.55 });
    addBox(group, new THREE.CylinderGeometry(0.34, 0.34, 0.92, 16), mat, dx, 0.46, dz);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x34393b, roughness: 0.5, metalness: 0.75 });
    for (const y of [0.08, 0.84]) addBox(group, new THREE.TorusGeometry(0.345, 0.035, 5, 16), rimMat, dx, y, dz).rotation.x = Math.PI / 2;
  }
  group.position.set(x, 0, z);
  collidables.push({ x, z, radius: count > 4 ? 1.65 : 1.25 });
  return group;
}

function makeJerseyBarrier(x, z, rotation, collidables) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa3a19a, roughness: 1 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xc88930, roughness: 0.8 });
  addBox(group, new THREE.BoxGeometry(3.4, 0.35, 0.72), concrete, 0, 0.18, 0);
  addBox(group, new THREE.BoxGeometry(3.15, 0.75, 0.38), concrete, 0, 0.72, 0);
  for (const side of [-1, 1]) addBox(group, new THREE.BoxGeometry(0.35, 0.22, 0.76), stripe, side * 1.05, 0.45, 0);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const alongX = Math.abs(Math.cos(rotation)) > 0.7;
  addSolidRectCollision(collidables, x, z, alongX ? 3.4 : 0.72, alongX ? 0.72 : 3.4);
  return group;
}

function makeFenceSegment(x1, z1, x2, z2, collidables, { gate = false } = {}) {
  const group = new THREE.Group();
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(-dz, dx);
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d6568, roughness: 0.45, metalness: 0.8 });
  const wire = new THREE.MeshStandardMaterial({
    color: 0x899194,
    roughness: 0.55,
    metalness: 0.65,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
  });
  const centerX = (x1 + x2) / 2;
  const centerZ = (z1 + z2) / 2;
  const gateWidth = gate ? Math.min(5, length * 0.35) : 0;
  const panelLength = gate ? (length - gateWidth) / 2 : length;

  const addPanel = (localX, panelWidth) => {
    addBox(group, new THREE.BoxGeometry(panelWidth, 1.8, 0.035), wire, localX, 1.05, 0, { cast: false });
    addBox(group, new THREE.BoxGeometry(panelWidth, 0.06, 0.07), steel, localX, 0.18, 0);
    addBox(group, new THREE.BoxGeometry(panelWidth, 0.06, 0.07), steel, localX, 1.93, 0);
  };
  if (gate) {
    addPanel(-(gateWidth + panelLength) / 2, panelLength);
    addPanel((gateWidth + panelLength) / 2, panelLength);
  } else {
    addPanel(0, length);
  }

  const postCount = Math.max(2, Math.ceil(length / 3));
  for (let i = 0; i <= postCount; i++) {
    const localX = -length / 2 + i * length / postCount;
    if (gate && Math.abs(localX) < gateWidth / 2 - 0.2) continue;
    addBox(group, new THREE.CylinderGeometry(0.055, 0.07, 2.25, 7), steel, localX, 1.12, 0);
  }

  group.position.set(centerX, 0, centerZ);
  group.rotation.y = angle;
  if (gate) {
    const ux = dx / length;
    const uz = dz / length;
    addWallCollision(collidables, x1, z1, centerX - ux * gateWidth / 2, centerZ - uz * gateWidth / 2, 0.22, 0.75);
    addWallCollision(collidables, centerX + ux * gateWidth / 2, centerZ + uz * gateWidth / 2, x2, z2, 0.22, 0.75);
  } else {
    addWallCollision(collidables, x1, z1, x2, z2, 0.22, 0.75);
  }
  return group;
}

function makeVillageAmenities(x, z) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x745136, roughness: 0.92 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x303638, roughness: 0.55, metalness: 0.65 });
  for (const bx of [-5.3, 5.3]) {
    const bench = new THREE.Group();
    for (const sz of [-0.22, 0.22]) addBox(bench, new THREE.BoxGeometry(2.5, 0.12, 0.22), wood, 0, 0.62, sz);
    addBox(bench, new THREE.BoxGeometry(2.5, 0.65, 0.12), wood, 0, 0.96, 0.34);
    for (const sx of [-0.9, 0.9]) addBox(bench, new THREE.BoxGeometry(0.12, 0.62, 0.12), iron, sx, 0.31, 0);
    bench.position.set(bx, 0, 0);
    bench.rotation.y = bx < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(bench);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#31513b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ded2aa';
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.fillStyle = '#f0ead7';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('IRONVALE WORKERS VILLAGE', 320, 82);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  sign.position.set(0, 2.05, -8.2);
  sign.rotation.y = Math.PI;
  group.add(sign);
  for (const sx of [-2.5, 2.5]) addBox(group, new THREE.CylinderGeometry(0.08, 0.1, 2.5, 8), wood, sx, 1.25, -8.2);

  // Noticeboard and litter bin provide the shared-space details typical of a
  // small company settlement rather than a row of isolated props.
  addBox(group, new THREE.BoxGeometry(2.2, 1.25, 0.12), wood, 0, 1.25, 2.6);
  for (const sx of [-0.85, 0.85]) addBox(group, new THREE.BoxGeometry(0.1, 1.65, 0.1), iron, sx, 0.82, 2.6);
  addBox(group, new THREE.CylinderGeometry(0.28, 0.34, 0.72, 10), iron, 2.1, 0.36, 2.6);

  group.position.set(x, 0, z);
  return group;
}

function makeCityBuilding(x, z, collidables, walkableSurfaces, opts = {}) {
  const {
    width = 18,
    depth = 16,
    storeyHeight = 3.2,
    stairSide = 'east',
    wallColor = 0x826956,
    trimColor = 0xd1c8b6,
    accentColor = 0x36596b,
    label = 'IRONVALE LOFTS',
  } = opts;
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.78 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x30373b, roughness: 0.46, metalness: 0.72 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x5d5e5b, roughness: 0.95 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x5b8393,
    emissive: 0x243e49,
    emissiveIntensity: 0.38,
    roughness: 0.2,
    metalness: 0.25,
  });
  const awningMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.72 });
  const hw = width / 2;
  const hd = depth / 2;
  const wallThickness = 0.25;
  const levelCount = 2;
  const totalHeight = storeyHeight * levelCount;

  // Pavement apron, ground slab, upper floor and roof.
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 8, depth + 6),
    new THREE.MeshStandardMaterial({ color: 0x777a78, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  pavement.rotation.x = -Math.PI / 2;
  pavement.position.y = 0.045;
  pavement.receiveShadow = true;
  group.add(pavement);
  addBox(group, new THREE.BoxGeometry(width, 0.22, depth), floorMat, 0, 0.11, 0);
  addBox(group, new THREE.BoxGeometry(width - 0.35, 0.22, depth - 0.35), floorMat, 0, storeyHeight, 0);
  addBox(group, new THREE.BoxGeometry(width + 0.5, 0.3, depth + 0.5), steelMat, 0, totalHeight + 0.15, 0);
  walkableSurfaces.push({ type: 'rect', x, z, width: width - 0.45, depth: depth - 0.45, y: storeyHeight });

  const sides = [
    { name: 'north', axis: 'x', fixed: -hd, length: width },
    { name: 'south', axis: 'x', fixed: hd, length: width },
    { name: 'west', axis: 'z', fixed: -hw, length: depth },
    { name: 'east', axis: 'z', fixed: hw, length: depth },
  ];

  function addLevelWall(side, yBase, hasDoor) {
    const isX = side.axis === 'x';
    const doorWidth = 2.3;
    const doorHeight = 2.35;
    const addSegment = (along, length) => {
      addBox(
        group,
        new THREE.BoxGeometry(isX ? length : wallThickness, storeyHeight, isX ? wallThickness : length),
        wallMat,
        isX ? along : side.fixed,
        yBase + storeyHeight / 2,
        isX ? side.fixed : along
      );
      if (isX) {
        addWallCollision(
          collidables,
          x + along - length / 2,
          z + side.fixed,
          x + along + length / 2,
          z + side.fixed,
          0.24,
          0.5,
          yBase,
          yBase + storeyHeight
        );
      } else {
        addWallCollision(
          collidables,
          x + side.fixed,
          z + along - length / 2,
          x + side.fixed,
          z + along + length / 2,
          0.24,
          0.5,
          yBase,
          yBase + storeyHeight
        );
      }
    };

    if (hasDoor) {
      const segment = (side.length - doorWidth) / 2;
      addSegment(-(doorWidth + segment) / 2, segment);
      addSegment((doorWidth + segment) / 2, segment);
      addBox(
        group,
        new THREE.BoxGeometry(isX ? doorWidth : wallThickness, storeyHeight - doorHeight, isX ? wallThickness : doorWidth),
        wallMat,
        isX ? 0 : side.fixed,
        yBase + doorHeight + (storeyHeight - doorHeight) / 2,
        isX ? side.fixed : 0
      );
    } else {
      addSegment(0, side.length);
    }
  }

  for (const side of sides) {
    addLevelWall(side, 0, side.name === 'south');
    addLevelWall(side, storeyHeight, side.name === stairSide);
  }

  // Storefront glazing and awning on the street side.
  for (const wx of [-width * 0.28, width * 0.28]) {
    addBox(group, new THREE.BoxGeometry(3.25, 1.55, 0.08), glassMat, wx, 1.55, hd + 0.14, { cast: false });
  }
  const awning = addBox(group, new THREE.BoxGeometry(width * 0.72, 0.16, 1.4), awningMat, 0, 2.72, hd + 0.68);
  awning.rotation.x = -0.09;

  // Upper-storey windows on every facade, with deep sills and lintels.
  for (const wx of [-width * 0.3, 0, width * 0.3]) {
    addBox(group, new THREE.BoxGeometry(1.65, 1.25, 0.08), glassMat, wx, storeyHeight + 1.62, hd + 0.14, { cast: false });
    addBox(group, new THREE.BoxGeometry(1.9, 0.12, 0.38), trimMat, wx, storeyHeight + 0.93, hd + 0.25);
    addBox(group, new THREE.BoxGeometry(1.65, 1.25, 0.08), glassMat, wx, storeyHeight + 1.62, -hd - 0.14, { cast: false });
  }
  for (const wz of [-depth * 0.28, depth * 0.28]) {
    for (const sx of [-1, 1]) {
      addBox(group, new THREE.BoxGeometry(0.08, 1.25, 1.65), glassMat, sx * (hw + 0.14), storeyHeight + 1.62, wz, { cast: false });
    }
  }

  // Cornice bands and drainpipes make the facade read as constructed layers.
  for (const yBand of [storeyHeight, totalHeight]) {
    addBox(group, new THREE.BoxGeometry(width + 0.35, 0.16, depth + 0.35), trimMat, 0, yBand, 0);
  }
  for (const sx of [-1, 1]) {
    addBox(group, new THREE.CylinderGeometry(0.07, 0.07, totalHeight, 8), steelMat, sx * (hw + 0.18), totalHeight / 2, hd + 0.18);
  }

  // Exterior staircase: sixteen physical treads plus an elevation ramp used
  // by player physics. The top landing connects directly to the upper door.
  const sideSign = stairSide === 'west' ? -1 : 1;
  const stairWidth = 2.6;
  const stairLength = 8.4;
  const lowX = sideSign * (hw + stairLength + 0.35);
  const highX = sideSign * (hw + 0.35);
  const stepCount = 16;
  for (let i = 0; i < stepCount; i++) {
    const t = (i + 0.5) / stepCount;
    const stepHeight = storeyHeight * (i + 1) / stepCount;
    const stepX = THREE.MathUtils.lerp(lowX, highX, t);
    addBox(
      group,
      new THREE.BoxGeometry(stairLength / stepCount + 0.04, stepHeight, stairWidth),
      floorMat,
      stepX,
      stepHeight / 2,
      0
    );
    if (i % 4 === 0 || i === stepCount - 1) {
      for (const railZ of [-stairWidth / 2, stairWidth / 2]) {
        addBox(group, new THREE.BoxGeometry(0.08, 1.05, 0.08), steelMat, stepX, stepHeight + 0.52, railZ);
      }
    }
  }
  const railLength = Math.hypot(stairLength, storeyHeight);
  const railAngle = Math.atan2(storeyHeight, highX - lowX);
  for (const railZ of [-stairWidth / 2, stairWidth / 2]) {
    const rail = addBox(group, new THREE.BoxGeometry(railLength, 0.1, 0.1), steelMat, (lowX + highX) / 2, storeyHeight / 2 + 1.0, railZ);
    rail.rotation.z = railAngle;
  }
  const landingX = sideSign * (hw + 0.75);
  addBox(group, new THREE.BoxGeometry(2.4, 0.2, 4.2), floorMat, landingX, storeyHeight, 0);
  for (const landingZ of [-2.0, 2.0]) addBox(group, new THREE.BoxGeometry(2.4, 1.0, 0.08), steelMat, landingX, storeyHeight + 0.52, landingZ);

  walkableSurfaces.push(
    {
      type: 'ramp',
      x1: x + lowX,
      z1: z,
      y1: 0,
      x2: x + highX,
      z2: z,
      y2: storeyHeight,
      width: stairWidth,
      steps: stepCount,
    },
    { type: 'rect', x: x + landingX, z, width: 2.3, depth: 4.1, y: storeyHeight }
  );

  // Ground-floor shop furniture and upper-level room dividers add depth when
  // looking through the doors and windows.
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x674a34, roughness: 0.88 });
  addBox(group, new THREE.BoxGeometry(width * 0.45, 1.0, 0.75), counterMat, 0, 0.62, -hd + 1.3);
  addWallCollision(
    collidables,
    x - width * 0.225,
    z - hd + 1.3,
    x + width * 0.225,
    z - hd + 1.3,
    0.4,
    0.65,
    0,
    storeyHeight
  );
  for (const roomX of [-width * 0.23, width * 0.23]) {
    addBox(group, new THREE.BoxGeometry(0.16, 2.7, depth * 0.45), trimMat, roomX, storeyHeight + 1.35, -depth * 0.18);
  }

  // Rooftop plant and parapet silhouette.
  for (const [rx, rz] of [[-3.2, -2.2], [2.8, 2.3]]) {
    addBox(group, new THREE.BoxGeometry(2.1, 0.85, 1.5), steelMat, rx, totalHeight + 0.72, rz);
    addBox(group, new THREE.CylinderGeometry(0.38, 0.45, 0.65, 12), steelMat, rx, totalHeight + 1.45, rz);
  }
  const parapets = [
    [0, -hd, width, 0.24], [0, hd, width, 0.24],
    [-hw, 0, 0.24, depth], [hw, 0, 0.24, depth],
  ];
  for (const [px, pz, pw, pd] of parapets) addBox(group, new THREE.BoxGeometry(pw, 0.65, pd), wallMat, px, totalHeight + 0.48, pz);

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 640;
  signCanvas.height = 150;
  const signCtx = signCanvas.getContext('2d');
  signCtx.fillStyle = '#20282c';
  signCtx.fillRect(0, 0, 640, 150);
  signCtx.fillStyle = '#ede5d0';
  signCtx.font = 'bold 58px sans-serif';
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillText(label, 320, 78);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.2), new THREE.MeshBasicMaterial({ map: signTexture }));
  sign.position.set(0, storeyHeight + 0.68, hd + 0.2);
  group.add(sign);

  group.position.set(x, 0, z);
  return group;
}

function getWalkableHeight(surfaces, x, z, currentY, stepAllowance) {
  let best = 0;
  const maxReachableY = currentY + stepAllowance + 0.001;
  for (const surface of surfaces) {
    let candidate = null;
    if (surface.type === 'rect') {
      if (Math.abs(x - surface.x) <= surface.width / 2 && Math.abs(z - surface.z) <= surface.depth / 2) {
        candidate = surface.y;
      }
    } else if (surface.type === 'ramp') {
      const dx = surface.x2 - surface.x1;
      const dz = surface.z2 - surface.z1;
      const lengthSq = dx * dx + dz * dz;
      const t = ((x - surface.x1) * dx + (z - surface.z1) * dz) / lengthSq;
      if (t >= 0 && t <= 1) {
        const nearestX = surface.x1 + dx * t;
        const nearestZ = surface.z1 + dz * t;
        if (Math.hypot(x - nearestX, z - nearestZ) <= surface.width / 2) {
          const surfaceT = surface.steps ? Math.ceil(t * surface.steps) / surface.steps : t;
          candidate = THREE.MathUtils.lerp(surface.y1, surface.y2, surfaceT);
        }
      }
    }
    if (candidate !== null && candidate <= maxReachableY && candidate > best) best = candidate;
  }
  return best;
}

function addIndustrialGround(scene) {
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -1 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x676b6c, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2 });
  const roadMark = new THREE.MeshStandardMaterial({ color: 0xc5a64a, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -3 });
  const roadParts = [
    [0, 0, 18, 214],
    [0, 0, 214, 18],
    [0, 78, 190, 12],
    [0, -84, 190, 13],
    [-70, -26, 42, 64],
    [70, 25, 44, 52],
  ];
  for (const [x, z, w, d] of roadParts) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.set(x, 0.025, z);
    road.receiveShadow = true;
    scene.add(road);
  }
  for (const x of [-55, -28, 28, 55]) {
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(7, 18), concrete);
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(x, 0.04, 88);
    drive.receiveShadow = true;
    scene.add(drive);
  }
  for (const x of [-48, -16, 16, 48]) {
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 16), concrete);
    drive.rotation.x = -Math.PI / 2;
    drive.position.set(x, 0.04, 69);
    drive.receiveShadow = true;
    scene.add(drive);
  }
  for (let z = -96; z <= 96; z += 9) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 4.5), roadMark);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.055, z);
    scene.add(dash);
  }
  for (let x = -96; x <= 96; x += 9) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.2), roadMark);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.055, 0);
    scene.add(dash);
  }
}

function addIndustrialDistrict(scene, collidables, walkableSurfaces, isOutbreak) {
  addIndustrialGround(scene);

  // Big Central Factory
  scene.add(makeCentralFactory(0, 0, collidables, walkableSurfaces, isOutbreak, false));

  // West Factory: Ironvale Metalworks / Quarantine Zone B (Double-Story, lit!)
  scene.add(makeCentralFactory(-70, -25, collidables, walkableSurfaces, isOutbreak, false, isOutbreak ? 'QUARANTINE ZONE B' : 'IRONVALE METALWORKS'));

  // East Factory: Freight Terminal / Bio-Hazards Warehouse (Double-Story, lit!)
  scene.add(makeCentralFactory(70, 25, collidables, walkableSurfaces, isOutbreak, false, isOutbreak ? 'BIO-HAZARDS STORAGE' : 'FREIGHT TERMINAL'));

  scene.add(makeIndustrialHall(37, -69, collidables, {
    width: 30,
    depth: 20,
    height: 6,
    doorSide: 'south',
    wallColor: 0x5f6667,
    label: 'MACHINE SHOP',
  }));

  // NEW FACTORY 1: Assembly Block B
  scene.add(makeIndustrialHall(70, -25, collidables, {
    width: 28,
    depth: 24,
    height: 7,
    doorSide: 'west',
    wallColor: isOutbreak ? 0x4d5154 : 0x616669,
    accentColor: isOutbreak ? 0x9c3d2e : 0xe67e22,
    label: isOutbreak ? 'INFECTED ASSEMBLY' : 'ASSEMBLY BLOCK B',
  }));

  // NEW FACTORY 2: Chemical Refinery
  scene.add(makeIndustrialHall(-37, -69, collidables, {
    width: 30,
    depth: 20,
    height: 6,
    doorSide: 'south',
    wallColor: isOutbreak ? 0x5a5455 : 0x586063,
    accentColor: isOutbreak ? 0xa0362c : 0x315d70,
    label: isOutbreak ? 'HAZMAT DISPOSAL' : 'CHEMICAL REFINERY',
  }));

  // NEW FACTORY 3: Power Substation
  scene.add(makeIndustrialHall(-37, 25, collidables, {
    width: 24,
    depth: 20,
    height: 6,
    doorSide: 'east',
    wallColor: isOutbreak ? 0x4f494a : 0x63635a,
    accentColor: isOutbreak ? 0x933827 : 0x8a7458,
    label: isOutbreak ? 'GRID BACKUP' : 'POWER SUBSTATION',
  }));

  scene.add(makeChimney(-94, -34, collidables, { height: 24 }));
  scene.add(makeChimney(-90, -17, collidables, { height: 19, radius: 1.2 }));
  scene.add(makeStorageTank(-87, 25, collidables, { radius: 4, height: 9 }));
  scene.add(makeStorageTank(-76, 29, collidables, { radius: 3.2, height: 7.5, color: 0x878e91 }));
  scene.add(makeStorageTank(91, 48, collidables, { radius: 3.4, height: 8, color: 0x8b9291 }));
  scene.add(makePipeRack(-48, 29, 28, 0, collidables));

  // Chain-link perimeter around the tank farm, with a usable service gate.
  scene.add(makeFenceSegment(-101, 13, -68, 13, collidables, { gate: true }));
  scene.add(makeFenceSegment(-68, 13, -68, 42, collidables));
  scene.add(makeFenceSegment(-68, 42, -101, 42, collidables, { gate: true }));
  scene.add(makeFenceSegment(-101, 42, -101, 13, collidables));

  const containers = [
    [-88, 57, 0, 0x9b4937], [-81, 57, 0, 0x3d6371],
    [83, -42, Math.PI / 2, 0x8d6e3e], [90, -42, Math.PI / 2, 0x3e6673],
    [63, 53, 0, 0x87513c], [70, 53, 0, 0x4d6e5e],
  ];
  for (const [x, z, r, color] of containers) scene.add(makeCargoContainer(x, z, r, collidables, color));

  // Mixed-use city edge: all three buildings have enterable shops, second-floor
  // rooms, balconies, and fully traversable exterior stairs.
  scene.add(makeCityBuilding(-48, -99, collidables, walkableSurfaces, {
    width: 19,
    depth: 16,
    stairSide: 'east',
    wallColor: isOutbreak ? 0x5b4e49 : 0x8b6e58,
    accentColor: isOutbreak ? 0x883b32 : 0x315d70,
    label: isOutbreak ? 'EVACUATION BLOCK' : 'FOUNDRY LOFTS',
  }));
  scene.add(makeCityBuilding(63, -99, collidables, walkableSurfaces, {
    width: 20,
    depth: 18,
    stairSide: 'west',
    wallColor: isOutbreak ? 0x514c50 : 0x6f777b,
    accentColor: isOutbreak ? 0x8f3d35 : 0x78633c,
    label: isOutbreak ? 'RESTRICTED MARKET' : 'MARKET ROW',
  }));
  scene.add(makeCityBuilding(18, -102, collidables, walkableSurfaces, {
    width: 17,
    depth: 14,
    stairSide: 'east',
    wallColor: isOutbreak ? 0x565154 : 0x77705f,
    accentColor: isOutbreak ? 0x8b3c34 : 0x566f4b,
    label: isOutbreak ? 'CIVIC CONTROL' : 'CIVIC EXCHANGE',
  }));

  for (const [cx, cz, rotation, color] of [
    [-72, -83, 0, 0x5f6f78],
    [-10, -87, Math.PI, 0x884d3f],
    [40, -81, 0, 0x6f7752],
    [87, -84, Math.PI, 0x4a6179],
  ]) {
    scene.add(makeParkedCar(cx, cz, rotation, collidables, color));
  }
  for (const lx of [-80, -28, 8, 56, 88]) scene.add(makeStreetLight(lx, -76, Math.PI / 2));

  scene.add(makeForklift(50, 9, -Math.PI / 2, collidables));
  scene.add(makeForklift(-49, -49, Math.PI / 5, collidables));
  for (const [x, z, count] of [[55, 46, 5], [-55, 6, 4], [82, 8, 5], [18, -78, 4]]) {
    scene.add(makeDrumCluster(x, z, collidables, count));
  }
  for (const [x, z, r] of [[-14, -13, 0], [14, 13, 0], [-13, 14, Math.PI / 2], [13, -14, Math.PI / 2]]) {
    scene.add(makeJerseyBarrier(x, z, r, collidables));
  }

  // Residential strip: varied sizes, colors and orientations, with driveways
  // facing the neighborhood street. These are all enterable through porches.
  const homes = [
    { x: -55, z: 96, width: 7.2, depth: 6, doorSide: 'north', wallColor: 0xa88968, roofColor: 0x594035, fabricColor: 0x536d74 },
    { x: -28, z: 96, width: 6.5, depth: 5.5, doorSide: 'north', wallColor: 0x87958a, roofColor: 0x414b46, rugColor: 0x4f6651 },
    { x: 28, z: 96, width: 7.5, depth: 6.2, doorSide: 'north', wallColor: 0xa39b84, roofColor: 0x55483d, fabricColor: 0x765d51 },
    { x: 55, z: 96, width: 6.8, depth: 5.8, doorSide: 'north', wallColor: 0x8b7772, roofColor: 0x4e3c3a, rugColor: 0x465b70 },
    { x: -48, z: 61, width: 6.8, depth: 5.7, doorSide: 'south', wallColor: 0x87919a, roofColor: 0x3e464c, fabricColor: 0x70584b },
    { x: -16, z: 61, width: 7.3, depth: 6.1, doorSide: 'south', wallColor: 0xa79579, roofColor: 0x584437, rugColor: 0x4d6255 },
    { x: 16, z: 61, width: 6.6, depth: 5.6, doorSide: 'south', wallColor: 0x8d8174, roofColor: 0x493d38, fabricColor: 0x4e6772 },
    { x: 48, z: 61, width: 7.4, depth: 6.2, doorSide: 'south', wallColor: 0x82907e, roofColor: 0x3d493c, rugColor: 0x77554b },
  ];
  for (const home of homes) scene.add(makeHouse(home.x, home.z, collidables, home));

  const villageRand = makeRng(8172);
  scene.add(makeGrassPatch(0, 98, 18, 19, villageRand, 900));
  for (const x of [-55, -28, 28, 55]) scene.add(makeGrassPatch(x, 96, 15, 16, villageRand, 430, 8.5, 7.5));
  for (const x of [-48, -16, 16, 48]) scene.add(makeGrassPatch(x, 61, 14, 14, villageRand, 380, 8.5, 7.5));
  const villageTrees = [
    [-72, 96], [-42, 101], [-13, 98], [12, 101], [42, 102], [71, 96],
    [-64, 63], [-32, 59], [0, 61], [32, 59], [65, 62], [-8, 89], [9, 88],
  ];
  for (const [tx, tz] of villageTrees) scene.add(makeDeciduousTree(tx, tz, villageRand, collidables));
  scene.add(makeVillageAmenities(0, 98));

  // Street furniture and utility rhythm visually tie the homes to the plant.
  for (const x of [-72, -43, -14, 14, 43, 72]) scene.add(makeStreetLight(x, 73, x < 0 ? 0 : Math.PI));
  for (const [x, z, r] of [[-10, -42, 0], [10, 42, Math.PI], [-42, 10, Math.PI / 2], [42, -10, -Math.PI / 2]]) {
    scene.add(makeStreetLight(x, z, r));
  }
}

function createVillageNPCs(scene) {
  const mixers = [];
  const walkers = [];
  const routes = [
    { from: [-73, 77], to: [-40, 77], speed: 0.82, phase: 0.12 },
    { from: [-36, 84], to: [-10, 84], speed: 0.7, phase: 0.65 },
    { from: [10, 84], to: [38, 84], speed: 0.76, phase: 0.35 },
    { from: [42, 77], to: [72, 77], speed: 0.88, phase: 0.8 },
    { from: [-10, 106], to: [10, 106], speed: 0.62, phase: 0.2 },
    { from: [-63, 70], to: [-35, 70], speed: 0.74, phase: 0.5 },
    { from: [-78, -76], to: [-32, -76], speed: 0.8, phase: 0.28 },
    { from: [32, -76], to: [88, -76], speed: 0.86, phase: 0.62 },
  ];
  const clothingTints = [0x738b93, 0x8a715d, 0x687b5c, 0x7d6266, 0x6d7089, 0x8b805d];
  const loader = new GLTFLoader();

  loader.load(
    'assets/characters/cesium-man.glb',
    (gltf) => {
      routes.forEach((route, index) => {
        const wrapper = new THREE.Group();
        wrapper.name = `Villager ${index + 1}`;
        const character = SkeletonUtils.clone(gltf.scene);
        character.scale.setScalar(1.12);
        character.traverse((node) => {
          if (!node.isMesh) return;
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            node.material = node.material.clone();
            if (node.material.color) node.material.color.lerp(new THREE.Color(clothingTints[index % clothingTints.length]), 0.22);
          }
        });
        wrapper.add(character);

        // Small, varied accessories help clones read as residents rather than
        // six identical copies while preserving the original rig and walk.
        if (index % 3 === 0) {
          const hat = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.17, 0.12, 12),
            new THREE.MeshStandardMaterial({ color: 0x424b50, roughness: 0.86 })
          );
          hat.position.set(0, 1.72, 0);
          hat.castShadow = true;
          wrapper.add(hat);
        }

        const start = new THREE.Vector3(route.from[0], 0, route.from[1]);
        const end = new THREE.Vector3(route.to[0], 0, route.to[1]);
        const length = start.distanceTo(end);
        const yawForward = Math.atan2(end.x - start.x, end.z - start.z);
        wrapper.position.lerpVectors(start, end, route.phase);
        wrapper.rotation.y = index % 2 ? yawForward + Math.PI : yawForward;
        scene.add(wrapper);

        if (gltf.animations.length) {
          const mixer = new THREE.AnimationMixer(character);
          const walkClip = gltf.animations.find((clip) => /walk/i.test(clip.name)) || gltf.animations[0];
          mixer.clipAction(walkClip).play();
          mixer.timeScale = 0.82 + index * 0.025;
          mixer.setTime(index * 0.31);
          mixers.push(mixer);
        }
        walkers.push({
          wrapper,
          start,
          end,
          length,
          yawForward,
          progress: route.phase,
          direction: index % 2 ? -1 : 1,
          speed: route.speed,
        });
      });
    },
    undefined,
    (error) => console.warn('Village NPC model could not be loaded:', error)
  );

  return {
    update(dt) {
      for (const mixer of mixers) mixer.update(dt);
      for (const walker of walkers) {
        walker.progress += walker.direction * walker.speed * dt / walker.length;
        if (walker.progress >= 1) {
          walker.progress = 1;
          walker.direction = -1;
        } else if (walker.progress <= 0) {
          walker.progress = 0;
          walker.direction = 1;
        }
        walker.wrapper.position.lerpVectors(walker.start, walker.end, walker.progress);
        walker.wrapper.rotation.y = walker.direction > 0 ? walker.yawForward : walker.yawForward + Math.PI;
      }
    },
  };
}

// Helper to quickly build boxes with relative group transforms
function addBox(group, geom, mat, x, y, z) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function makeCentralFactory(x, z, collidables, walkableSurfaces, isOutbreak, isForest, nameOverride = '') {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  let wallColor, accentColor, label;
  if (isForest) {
    wallColor = 0x54473e;    // Overgrown/rusty metal
    accentColor = 0x3d5434;  // Mossy green trim
    label = nameOverride || 'OVERGROWN SECTOR';
  } else if (isOutbreak) {
    wallColor = 0x3d393c;    // Grimy concrete
    accentColor = 0xa93c2a;  // WARNING Red trim
    label = nameOverride || 'RECON LAB 01';
  } else {
    wallColor = 0x5c666e;    // Cool steel grey
    accentColor = 0xe67e22;  // Safety orange
    label = nameOverride || 'CENTRAL ASSEMBLY';
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.82, metalness: 0.2 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x30363b, roughness: 0.5, metalness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.6, metalness: 0.3 });
  const floorColor = isForest ? 0x3c3c31 : 0x484b4d;
  const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 });

  const width = 38;
  const depth = 38;
  const height = 15; // Raised for proper double-story verticality
  const wallThickness = 0.35;
  const doorWidth = 11;
  const doorHeight = 5.5;
  const hw = width / 2;
  const hd = depth / 2;

  // Floor slab
  addBox(group, new THREE.BoxGeometry(width, 0.22, depth), floorMat, 0, 0.11, 0);

  // 4 walls with centered doors
  const sides = [
    { name: 'north', axis: 'x', fixed: -hd, sign: -1 },
    { name: 'south', axis: 'x', fixed: hd, sign: 1 },
    { name: 'west', axis: 'z', fixed: -hw, sign: -1 },
    { name: 'east', axis: 'z', fixed: hw, sign: 1 },
  ];

  for (const side of sides) {
    const isX = side.axis === 'x';
    const wallLength = isX ? width : depth;
    const segment = (wallLength - doorWidth) / 2;

    // Left wall segment
    addBox(
      group,
      new THREE.BoxGeometry(isX ? segment : wallThickness, height, isX ? wallThickness : segment),
      wallMat,
      isX ? -doorWidth / 2 - segment / 2 : side.fixed,
      height / 2,
      isX ? side.fixed : -doorWidth / 2 - segment / 2
    );

    // Right wall segment
    addBox(
      group,
      new THREE.BoxGeometry(isX ? segment : wallThickness, height, isX ? wallThickness : segment),
      wallMat,
      isX ? doorWidth / 2 + segment / 2 : side.fixed,
      height / 2,
      isX ? side.fixed : doorWidth / 2 + segment / 2
    );

    // Wall header above door
    addBox(
      group,
      new THREE.BoxGeometry(isX ? doorWidth : wallThickness, height - doorHeight, isX ? wallThickness : doorWidth),
      wallMat,
      isX ? 0 : side.fixed,
      doorHeight + (height - doorHeight) / 2,
      isX ? side.fixed : 0
    );

    // Collisions (approximated circular walls)
    if (isX) {
      addWallCollision(collidables, x - hw, z + side.fixed, x - doorWidth / 2, z + side.fixed);
      addWallCollision(collidables, x + doorWidth / 2, z + side.fixed, x + hw, z + side.fixed);
    } else {
      addWallCollision(collidables, x + side.fixed, z - hd, x + side.fixed, z - doorWidth / 2);
      addWallCollision(collidables, x + side.fixed, z + doorWidth / 2, x + side.fixed, z + hd);
    }

    // Yellow/Orange entry columns
    for (const dSign of [-1, 1]) {
      addBox(
        group,
        new THREE.BoxGeometry(isX ? 0.25 : wallThickness + 0.12, doorHeight, isX ? wallThickness + 0.12 : 0.25),
        accentMat,
        isX ? dSign * (doorWidth / 2) : side.fixed,
        doorHeight / 2,
        isX ? side.fixed : dSign * (doorWidth / 2)
      );
    }
  }

  // Steel roof with glass skylight - registered as a walkable surface so players can stand on top!
  addBox(group, new THREE.BoxGeometry(width + 0.7, 0.38, depth + 0.7), steelMat, 0, height + 0.19, 0);
  walkableSurfaces.push({ type: 'rect', x: x, z: z, width: width + 0.7, depth: depth + 0.7, y: height + 0.38 });

  const skyWidth = 14;
  const skyMat = new THREE.MeshStandardMaterial({
    color: isOutbreak ? 0x6b1d1f : 0x567d93,
    emissive: isOutbreak ? 0x240608 : 0x162c38,
    emissiveIntensity: 0.5,
    roughness: 0.15,
    metalness: 0.4
  });
  addBox(group, new THREE.BoxGeometry(skyWidth + 0.4, 0.45, skyWidth + 0.4), steelMat, 0, height + 0.45, 0);
  addBox(group, new THREE.BoxGeometry(skyWidth, 0.1, skyWidth), skyMat, 0, height + 0.6, 0);
  walkableSurfaces.push({ type: 'rect', x: x, z: z, width: skyWidth + 0.4, depth: skyWidth + 0.4, y: height + 0.9 });

  // Four interior structural pillars
  const columnPositions = [
    [-8, -8], [8, -8], [-8, 8], [8, 8]
  ];
  for (const [cx, cz] of columnPositions) {
    addBox(group, new THREE.BoxGeometry(1.2, height, 1.2), steelMat, cx, height / 2, cz);
    collidables.push({ x: x + cx, z: z + cz, radius: 0.8 });
    addBox(group, new THREE.BoxGeometry(1.6, 0.4, 1.6), accentMat, cx, 0.2, cz);
    addBox(group, new THREE.BoxGeometry(1.6, 0.4, 1.6), accentMat, cx, height - 0.2, cz);
  }

  // ==========================================
  // LEVEL 2: MEZZANINE FLOOR (SECOND STORY)
  // ==========================================
  const midHeight = 5.8;
  const midWidth = 6.2;
  const midMat = new THREE.MeshStandardMaterial({ color: isForest ? 0x3d352e : 0x2c2d30, roughness: 0.6, metalness: 0.7 });

  // 4 perimeter floor segments for second story mezzanine
  const midSpecs = [
    { cx: 0, cz: -hd + midWidth / 2, w: width, d: midWidth },
    { cx: 0, cz: hd - midWidth / 2, w: width, d: midWidth },
    { cx: -hw + midWidth / 2, cz: 0, w: midWidth, d: depth - midWidth * 2 },
    { cx: hw - midWidth / 2, cz: 0, w: midWidth, d: depth - midWidth * 2 },
  ];

  for (const m of midSpecs) {
    addBox(group, new THREE.BoxGeometry(m.w, 0.2, m.d), midMat, m.cx, midHeight, m.cz);
    walkableSurfaces.push({ type: 'rect', x: x + m.cx, z: z + m.cz, width: m.w, depth: m.d, y: midHeight });
  }

  // Mezzanine inner protective railings
  const innerEdge = hw - midWidth; // 19 - 6.2 = 12.8
  addBox(group, new THREE.BoxGeometry(25, 0.9, 0.08), steelMat, 0, midHeight + 0.45, -innerEdge);
  addBox(group, new THREE.BoxGeometry(25, 0.9, 0.08), steelMat, 0, midHeight + 0.45, innerEdge);
  addBox(group, new THREE.BoxGeometry(0.08, 0.9, 25), steelMat, -innerEdge, midHeight + 0.45, 0);
  addBox(group, new THREE.BoxGeometry(0.08, 0.9, 25), steelMat, innerEdge, midHeight + 0.45, 0);

  // LEVEL 1 -> LEVEL 2 STAIRS (Ground to Mezzanine)
  const stairWidth = 1.8;
  const steps1 = 14;
  const stairsL1 = [
    { lowX: -hw + stairWidth / 2 + 0.2, lowZ: -11.0, highX: -hw + stairWidth / 2 + 0.2, highZ: -2.0 },
    { lowX: hw - stairWidth / 2 - 0.2, lowZ: 11.0, highX: hw - stairWidth / 2 - 0.2, highZ: 2.0 }
  ];

  for (const s of stairsL1) {
    const sLen = Math.abs(s.highZ - s.lowZ);
    for (let i = 0; i < steps1; i++) {
      const t = (i + 0.5) / steps1;
      const sHeight = midHeight * (i + 1) / steps1;
      const sX = s.lowX;
      const sZ = THREE.MathUtils.lerp(s.lowZ, s.highZ, t);
      addBox(group, new THREE.BoxGeometry(stairWidth, sHeight, sLen / steps1 + 0.04), floorMat, sX, sHeight / 2, sZ);
    }
    walkableSurfaces.push({
      type: 'ramp',
      x1: x + s.lowX,
      z1: z + s.lowZ,
      y1: 0,
      x2: x + s.highX,
      z2: z + s.highZ,
      y2: midHeight,
      width: stairWidth,
      steps: steps1
    });
  }

  // ==========================================
  // LEVEL 3: TOP CATWALKS (THIRD LEVEL OVERLOOK)
  // ==========================================
  const topCatHeight = 11.2;
  const topCatWidth = 2.4;
  const topCatMat = new THREE.MeshStandardMaterial({ color: isForest ? 0x2e2b26 : 0x1d1e22, roughness: 0.7, metalness: 0.8 });

  const topCatSpecs = [
    { cx: -hw + midWidth + topCatWidth / 2, cz: 0, w: topCatWidth, d: depth - midWidth * 2 },
    { cx: hw - midWidth - topCatWidth / 2, cz: 0, w: topCatWidth, d: depth - midWidth * 2 }
  ];

  for (const c of topCatSpecs) {
    addBox(group, new THREE.BoxGeometry(c.w, 0.15, c.d), topCatMat, c.cx, topCatHeight, c.cz);
    walkableSurfaces.push({ type: 'rect', x: x + c.cx, z: z + c.cz, width: c.w, depth: c.d, y: topCatHeight });

    // Railings on inner and outer edges
    const edgeInner = c.cx + (c.cx < 0 ? topCatWidth / 2 : -topCatWidth / 2);
    const edgeOuter = c.cx + (c.cx < 0 ? -topCatWidth / 2 : topCatWidth / 2);
    addBox(group, new THREE.BoxGeometry(0.08, 0.9, c.d), steelMat, edgeInner, topCatHeight + 0.45, c.cz);
    addBox(group, new THREE.BoxGeometry(0.08, 0.9, c.d), steelMat, edgeOuter, topCatHeight + 0.45, c.cz);
  }

  // LEVEL 2 -> LEVEL 3 STAIRS (Mezzanine to Top Catwalks)
  const steps2 = 12;
  const stairsL2 = [
    { lowX: -hw + midWidth / 2, lowZ: 8.0, highX: -hw + midWidth + topCatWidth / 2, highZ: 1.0 },
    { lowX: hw - midWidth / 2, lowZ: -8.0, highX: hw - midWidth - topCatWidth / 2, highZ: -1.0 }
  ];

  for (const s of stairsL2) {
    const dz = s.highZ - s.lowZ;
    const dx = s.highX - s.lowX;
    for (let i = 0; i < steps2; i++) {
      const t = (i + 0.5) / steps2;
      const sHeight = midHeight + (topCatHeight - midHeight) * (i + 1) / steps2;
      const sX = THREE.MathUtils.lerp(s.lowX, s.highX, t);
      const sZ = THREE.MathUtils.lerp(s.lowZ, s.highZ, t);
      addBox(group, new THREE.BoxGeometry(stairWidth, sHeight, Math.abs(dz) / steps2 + 0.04), floorMat, sX, sHeight / 2, sZ);
    }
    walkableSurfaces.push({
      type: 'ramp',
      x1: x + s.lowX,
      z1: z + s.lowZ,
      y1: midHeight,
      x2: x + s.highX,
      z2: z + s.highZ,
      y2: topCatHeight,
      width: stairWidth,
      steps: steps2
    });
  }

  // Corner clutter
  for (const [tx, tz, h, rad, color] of [
    [13, -13, 5, 1.8, 0x768285],
    [10.5, -14, 4, 1.3, 0x8b8070],
  ]) {
    addBox(group, new THREE.CylinderGeometry(rad, rad, h, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }), tx, h / 2, tz);
    collidables.push({ x: x + tx, z: z + tz, radius: rad });
  }

  const crateColors = [0x8b653f, 0x6e5233, 0xa37e58];
  const cratePositions = [
    [-13, 13, 0.9, 1.8],
    [-10.5, 13.5, 0.75, 1.5],
    [-12, 11, 0.7, 1.4],
    [-12.5, 12.8, 2.3, 1.2],
  ];
  for (const [cx, cz, cy, size] of cratePositions) {
    const cColor = crateColors[Math.floor((cx + cz) * 10) % crateColors.length];
    addBox(group, new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: cColor, roughness: 0.9 }), cx, cy, cz);
  }
  collidables.push({ x: x - 12, z: z + 12.5, radius: 2.5 });

  // Large glowing entrance signs
  const textMat = new THREE.MeshStandardMaterial({
    color: isOutbreak ? 0xff4433 : 0xffaa00,
    emissive: isOutbreak ? 0xff3300 : 0xaa5500,
    emissiveIntensity: 1.5,
    roughness: 0.1
  });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
  const labelLength = label.length * 0.42;

  addBox(group, new THREE.BoxGeometry(labelLength + 1, 1.1, 0.2), boardMat, 0, doorHeight + 1.2, -hd - 0.12);
  addBox(group, new THREE.BoxGeometry(labelLength, 0.6, 0.25), textMat, 0, doorHeight + 1.2, -hd - 0.14);

  addBox(group, new THREE.BoxGeometry(labelLength + 1, 1.1, 0.2), boardMat, 0, doorHeight + 1.2, hd + 0.12);
  addBox(group, new THREE.BoxGeometry(labelLength, 0.6, 0.25), textMat, 0, doorHeight + 1.2, hd + 0.14);

  addBox(group, new THREE.BoxGeometry(0.2, 1.1, labelLength + 1), boardMat, -hw - 0.12, doorHeight + 1.2, 0);
  addBox(group, new THREE.BoxGeometry(0.25, 0.6, labelLength), textMat, -hw - 0.14, doorHeight + 1.2, 0);

  addBox(group, new THREE.BoxGeometry(0.2, 1.1, labelLength + 1), boardMat, hw + 0.12, doorHeight + 1.2, 0);
  addBox(group, new THREE.BoxGeometry(0.25, 0.6, labelLength), textMat, hw + 0.14, doorHeight + 1.2, 0);

  // Moss/greenery inside for Forest Outpost
  if (isForest) {
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x3d6e3d, roughness: 0.9 });
    addBox(group, new THREE.SphereGeometry(2.4, 8, 8), mossMat, -11, 1, 11);
    addBox(group, new THREE.SphereGeometry(1.8, 8, 8), mossMat, -12, 2.5, 11);
    addBox(group, new THREE.SphereGeometry(4.5, 12, 12), mossMat, 0, height + 0.5, 0);
    for (const [cx, cz] of columnPositions) {
      addBox(group, new THREE.CylinderGeometry(0.72, 0.72, height - 1, 6), mossMat, cx + (cx < 0 ? 0.4 : -0.4), height / 2, cz + (cz < 0 ? 0.4 : -0.4));
    }
  }

  // ==========================================
  // FACTORY LIGHTING SYSTEM
  // ==========================================
  const lightColor = isOutbreak ? 0xff3300 : (isForest ? 0xffaa44 : 0x00d0ff);
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: lightColor,
    emissive: lightColor,
    emissiveIntensity: 3.0,
    roughness: 0.1
  });

  const lightPositions = [
    [-11, 11], [11, -11], [-11, -11], [11, 11],
    [0, 10], [0, -10], [-10, 0], [10, 0]
  ];

  for (const [lx, lz] of lightPositions) {
    // Hang fixture from the ceiling (height = 15)
    // Small steel wire/chain
    addBox(group, new THREE.CylinderGeometry(0.04, 0.04, 2.0, 4), steelMat, lx, height - 1.0, lz);
    // Glowing lamp cap
    addBox(group, new THREE.CylinderGeometry(0.35, 0.5, 0.4, 8), steelMat, lx, height - 2.0, lz);
    addBox(group, new THREE.SphereGeometry(0.24, 8, 8), fixtureMat, lx, height - 2.2, lz);

    // Actual point light source
    const pLight = new THREE.PointLight(lightColor, isOutbreak ? 2.5 : 3.0, 28, 1.2);
    pLight.position.set(lx, height - 2.5, lz);
    // Most lights don't cast shadows to maintain high 60 FPS, but provide gorgeous illumination
    pLight.castShadow = false;
    group.add(pLight);
  }

  // Warning/Work beacon lights on structural pillars
  const beaconColor = isOutbreak ? 0xff1100 : 0xffaa00;
  const beaconMat = new THREE.MeshStandardMaterial({
    color: beaconColor,
    emissive: beaconColor,
    emissiveIntensity: 4.0
  });

  for (const [cx, cz] of columnPositions) {
    // Offset slightly from the column's faces
    const ox = cx < 0 ? 0.65 : -0.65;
    const oz = cz < 0 ? 0.65 : -0.65;
    addBox(group, new THREE.BoxGeometry(0.3, 0.3, 0.3), steelMat, cx + ox, 5.0, cz + oz);
    addBox(group, new THREE.SphereGeometry(0.15, 8, 8), beaconMat, cx + ox, 5.15, cz + oz);
    
    const colLight = new THREE.PointLight(beaconColor, 2.0, 15, 1.5);
    colLight.position.set(cx + ox * 1.5, 5.15, cz + oz * 1.5);
    group.add(colLight);
  }

  return group;
}

// =================================------------------------------------------
// AAA ENVIRONMENT GRAPHICS PROCEDURAL GENERATORS (MOUNTAINS & PARIS TOWER)
// =================================------------------------------------------

function makeMountain(x, z, height, radius, rand) {
  const group = new THREE.Group();
  
  const mountainMat = new THREE.MeshStandardMaterial({
    color: 0x42444a, // slate-gray stone
    roughness: 0.95,
    metalness: 0.1,
    flatShading: true // beautiful facets
  });

  const geom = new THREE.ConeGeometry(radius, height, 5, 4);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    // Don't modify the exact tip or base vertices too drastically
    if (py > -height / 2 && py < height / 2) {
      const scale = (height / 2 - py) / height; // more perturbation at the base
      pos.setX(i, pos.getX(i) + (rand() - 0.5) * (radius * 0.4 * scale));
      pos.setZ(i, pos.getZ(i) + (rand() - 0.5) * (radius * 0.4 * scale));
      pos.setY(i, py + (rand() - 0.5) * (height * 0.1 * scale));
    }
  }
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, mountainMat);
  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Add 3 sub-peaks for organic range clustering
  for (let p = 0; p < 3; p++) {
    const subH = height * (0.45 + rand() * 0.35);
    const subR = radius * (0.5 + rand() * 0.3);
    const subGeom = new THREE.ConeGeometry(subR, subH, 4, 3);
    const subPos = subGeom.attributes.position;
    for (let i = 0; i < subPos.count; i++) {
      const py = subPos.getY(i);
      if (py > -subH / 2 && py < subH / 2) {
        const scale = (subH / 2 - py) / subH;
        subPos.setX(i, subPos.getX(i) + (rand() - 0.5) * (subR * 0.35 * scale));
        subPos.setZ(i, subPos.getZ(i) + (rand() - 0.5) * (subR * 0.35 * scale));
      }
    }
    subGeom.computeVertexNormals();
    const subMesh = new THREE.Mesh(subGeom, mountainMat);
    const angle = rand() * Math.PI * 2;
    const dist = radius * (0.4 + rand() * 0.3);
    subMesh.position.set(Math.cos(angle) * dist, subH / 2, Math.sin(angle) * dist);
    subMesh.castShadow = true;
    subMesh.receiveShadow = true;
    group.add(subMesh);
  }

  return group;
}

function makeMountains(scene, rand) {
  const count = 12;
  const worldRadius = 320; // Sit outside playable 240 arena boundaries
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const dist = worldRadius + rand() * 110;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const height = 65 + rand() * 75;
    const radius = 50 + rand() * 45;
    scene.add(makeMountain(x, z, height, radius, rand));
  }
}

let beaconSpotlight = null;
let beaconAngle = 0;

function makeParisTower(x, z, collidables, walkableSurfaces) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x48423d, // steel bronze
    metalness: 0.85,
    roughness: 0.35,
    flatShading: true
  });

  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x2b2622,
    metalness: 0.75,
    roughness: 0.55
  });

  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xff1100,
    toneMapped: false
  });

  // Base physics collision
  collidables.push({ x, z, radius: 9.5 });

  // LEVEL 1 PLATFORM (y = 10m): Size 13m x 13m
  addBox(group, new THREE.BoxGeometry(13, 0.4, 13), platformMat, 0, 10, 0);
  walkableSurfaces.push({ type: 'rect', x: x, z: z, width: 13, depth: 13, y: 10 });

  // Railings L1
  for (const side of [-1, 1]) {
    addBox(group, new THREE.BoxGeometry(13, 0.08, 0.08), metalMat, 0, 11.1, side * 6.5);
    addBox(group, new THREE.BoxGeometry(0.08, 0.08, 13), metalMat, side * 6.5, 11.1, 0);
    for (let offset = -6.0; offset <= 6.0; offset += 3.0) {
      addBox(group, new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), metalMat, offset, 10.55, side * 6.5);
      addBox(group, new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), metalMat, side * 6.5, 10.55, offset);
    }
  }

  // LEVEL 2 PLATFORM (y = 26m): Size 8m x 8m
  addBox(group, new THREE.BoxGeometry(8, 0.4, 8), platformMat, 0, 26, 0);
  walkableSurfaces.push({ type: 'rect', x: x, z: z, width: 8, depth: 8, y: 26 });

  // Railings L2
  for (const side of [-1, 1]) {
    addBox(group, new THREE.BoxGeometry(8, 0.08, 0.08), metalMat, 0, 27.1, side * 4);
    addBox(group, new THREE.BoxGeometry(0.08, 0.08, 8), metalMat, side * 4, 27.1, 0);
    for (let offset = -3.5; offset <= 3.5; offset += 1.75) {
      addBox(group, new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), metalMat, offset, 26.55, side * 4);
      addBox(group, new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), metalMat, side * 4, 26.55, offset);
    }
  }

  // Slanted Base Legs (y = 0 to y = 10)
  const baseLegs = [
    { x1: -7.5, z1: -7.5, x2: -5.2, z2: -5.2 },
    { x1: 7.5, z1: -7.5, x2: 5.2, z2: -5.2 },
    { x1: -7.5, z1: 7.5, x2: -5.2, z2: 5.2 },
    { x1: 7.5, z1: 7.5, x2: 5.2, z2: 5.2 }
  ];
  for (const c of baseLegs) {
    const leg = addBox(group, new THREE.CylinderGeometry(0.48, 0.72, 11, 8), metalMat, (c.x1 + c.x2) / 2, 5, (c.z1 + c.z2) / 2);
    leg.lookAt(new THREE.Vector3(c.x2, 10, c.z2));
    leg.rotateX(Math.PI / 2);

    // Decorative support arch
    const arch = addBox(group, new THREE.CylinderGeometry(0.18, 0.22, 6, 6), metalMat, (c.x1 + c.x2) / 2 * 0.92, 2.25, (c.z1 + c.z2) / 2 * 0.92);
    arch.lookAt(new THREE.Vector3(c.x2 * 0.92, 10, c.z2 * 0.92));
    arch.rotateX(Math.PI / 2);
  }

  // Slanted Middle Legs (y = 10 to y = 26)
  const midLegs = [
    { x1: -5.2, z1: -5.2, x2: -3.0, z2: -3.2 },
    { x1: 5.2, z1: -5.2, x2: 3.0, z2: -3.2 },
    { x1: -5.2, z1: 5.2, x2: -3.0, z2: 3.2 },
    { x1: 5.2, z1: 5.2, x2: 3.0, z2: 3.2 }
  ];
  for (const c of midLegs) {
    const leg = addBox(group, new THREE.CylinderGeometry(0.32, 0.48, 17, 8), metalMat, (c.x1 + c.x2) / 2, 18, (c.z1 + c.z2) / 2);
    leg.lookAt(new THREE.Vector3(c.x2, 26, c.z2));
    leg.rotateX(Math.PI / 2);
  }

  // Spire Needle structure (y = 26 to y = 52)
  const needle = addBox(group, new THREE.ConeGeometry(2.8, 26, 4, 3), metalMat, 0, 39, 0);
  needle.rotation.y = Math.PI / 4;

  // Intermediate ring brace on the needle (y = 39)
  addBox(group, new THREE.BoxGeometry(2.2, 0.4, 2.2), metalMat, 0, 39, 0);

  // Top Dome & Beacon Cap
  addBox(group, new THREE.SphereGeometry(0.72, 12, 12), metalMat, 0, 52, 0);
  addBox(group, new THREE.CylinderGeometry(0.08, 0.15, 3.5, 6), metalMat, 0, 53.75, 0);

  // Warning light sphere
  addBox(group, new THREE.SphereGeometry(0.22, 8, 8), beaconMat, 0, 55.5, 0);
  const colLightSphere = new THREE.PointLight(0xff1100, 2.5, 35, 1.5);
  colLightSphere.position.set(0, 55.5, 0);
  group.add(colLightSphere);

  // Spotlight Sweep
  const spot = new THREE.SpotLight(0xffffff, 16.0, 130, Math.PI / 9, 0.45, 1.2);
  spot.position.set(0, 55.3, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  spot.shadow.bias = -0.0015;

  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(40, 0, 40);
  spot.target = spotTarget;
  group.add(spot);
  group.add(spotTarget);

  beaconSpotlight = spot;

  // Staircase 1: Ground to Platform 1
  const steps1 = 28;
  const stairWidth = 1.6;
  const stairX1 = -6.5;
  const stairZLow = -6.0;
  const stairZHigh = 5.2;
  const sLen = Math.abs(stairZHigh - stairZLow);

  for (let i = 0; i < steps1; i++) {
    const t = (i + 0.5) / steps1;
    const sHeight = 10.0 * (i + 1) / steps1;
    const sZ = THREE.MathUtils.lerp(stairZLow, stairZHigh, t);
    addBox(group, new THREE.BoxGeometry(stairWidth, sHeight, sLen / steps1 + 0.05), platformMat, stairX1, sHeight / 2, sZ);
  }
  walkableSurfaces.push({
    type: 'ramp',
    x1: x + stairX1,
    z1: z + stairZLow,
    y1: 0,
    x2: x + stairX1,
    z2: z + stairZHigh,
    y2: 10,
    width: stairWidth,
    steps: steps1
  });

  // Staircase 2: Platform 1 to Platform 2
  const steps2 = 36;
  const stairX2 = 3.2;
  const stairZLow2 = 3.2;
  const stairZHigh2 = -3.2;
  const sLen2 = Math.abs(stairZHigh2 - stairZLow2);

  for (let i = 0; i < steps2; i++) {
    const t = (i + 0.5) / steps2;
    const sHeight = 10.0 + 16.0 * (i + 1) / steps2;
    const sZ = THREE.MathUtils.lerp(stairZLow2, stairZHigh2, t);
    const hDelta = sHeight - 10.0;
    addBox(group, new THREE.BoxGeometry(stairWidth, hDelta, sLen2 / steps2 + 0.05), platformMat, stairX2, 10.0 + hDelta / 2, sZ);
  }
  walkableSurfaces.push({
    type: 'ramp',
    x1: x + stairX2,
    z1: z + stairZLow2,
    y1: 10,
    x2: x + stairX2,
    z2: z + stairZHigh2,
    y2: 26,
    width: stairWidth,
    steps: steps2
  });

  return group;
}

// =================================------------------------------------------
// PROPER TACTICAL FOREST SCENERY FEATURES & OUTPOSTS
// =================================------------------------------------------

// Climbable Tactical Watchtower / Observation Outpost
function makeWatchtower(x, z, collidables, walkableSurfaces) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.9 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.8, roughness: 0.3 });
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.85, roughness: 0.3 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffdd88, emissiveIntensity: 2.0 });

  // 4 Support Legs (12 meters high!)
  const legGeo = new THREE.CylinderGeometry(0.12, 0.18, 12, 6);
  addBox(group, legGeo, woodMat, -2.4, 6, -2.4);
  addBox(group, legGeo, woodMat, 2.4, 6, -2.4);
  addBox(group, legGeo, woodMat, -2.4, 6, 2.4);
  addBox(group, legGeo, woodMat, 2.4, 6, 2.4);

  // Cross beams/trusses
  const beamHGeo = new THREE.BoxGeometry(4.8, 0.15, 0.15);
  addBox(group, beamHGeo, woodMat, 0, 4, -2.4);
  addBox(group, beamHGeo, woodMat, 0, 4, 2.4);
  addBox(group, beamHGeo, woodMat, 0, 8, -2.4);
  addBox(group, beamHGeo, woodMat, 0, 8, 2.4);

  const beamWGeo = new THREE.BoxGeometry(0.15, 0.15, 4.8);
  addBox(group, beamWGeo, woodMat, -2.4, 4, 0);
  addBox(group, beamWGeo, woodMat, 2.4, 4, 0);
  addBox(group, beamWGeo, woodMat, -2.4, 8, 0);
  addBox(group, beamWGeo, woodMat, 2.4, 8, 0);

  // Main floor cabin deck (y = 12)
  const deckGeo = new THREE.BoxGeometry(5.4, 0.3, 5.4);
  addBox(group, deckGeo, woodMat, 0, 12, 0);

  // Deck railings
  const railH = new THREE.BoxGeometry(5.4, 0.1, 0.1);
  const railW = new THREE.BoxGeometry(0.1, 0.1, 5.4);
  addBox(group, railH, steelMat, 0, 13.1, -2.7);
  addBox(group, railH, steelMat, 0, 13.1, 2.7);
  addBox(group, railW, steelMat, -2.7, 13.1, 0);
  addBox(group, railW, steelMat, 2.7, 13.1, 0);

  // Cabin Roof
  const roofGeo = new THREE.BoxGeometry(5.8, 0.25, 5.8);
  addBox(group, roofGeo, steelMat, 0, 15.6, 0);

  // Roof pillars
  const pillarGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.6, 6);
  addBox(group, pillarGeo, steelMat, -2.6, 13.8, -2.6);
  addBox(group, pillarGeo, steelMat, 2.6, 13.8, -2.6);
  addBox(group, pillarGeo, steelMat, -2.6, 13.8, 2.6);
  addBox(group, pillarGeo, steelMat, 2.6, 13.8, 2.6);

  // Cabin floodlight
  addBox(group, new THREE.BoxGeometry(0.4, 0.4, 0.6), steelMat, 0, 15.3, -2.5);
  addBox(group, new THREE.SphereGeometry(0.2, 8, 8), lampMat, 0, 15.3, -2.75);

  const watchlight = new THREE.PointLight(0xfff0bb, 2.5, 30, 1.2);
  watchlight.position.set(0, 14.8, -3.0);
  group.add(watchlight);

  // Build stairs leading up to cabin deck
  const steps = 24;
  const stairWidth = 1.2;
  const stairZLow = -3.2;
  const stairZHigh = 2.4;
  const sLen = Math.abs(stairZHigh - stairZLow);

  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const sHeight = 12.0 * (i + 1) / steps;
    const sZ = THREE.MathUtils.lerp(stairZLow, stairZHigh, t);
    addBox(group, new THREE.BoxGeometry(stairWidth, sHeight, sLen / steps + 0.05), woodMat, -1.2, sHeight / 2, sZ);
  }

  // Register physical collisions and ramps
  collidables.push(
    { x: x - 2.4, z: z - 2.4, radius: 0.35 },
    { x: x + 2.4, z: z - 2.4, radius: 0.35 },
    { x: x - 2.4, z: z + 2.4, radius: 0.35 },
    { x: x + 2.4, z: z + 2.4, radius: 0.35 }
  );

  walkableSurfaces.push({
    type: 'ramp',
    x1: x - 1.2,
    z1: z + stairZLow,
    y1: 0,
    x2: x - 1.2,
    z2: z + stairZHigh,
    y2: 12.0,
    width: stairWidth,
    steps: steps
  });

  // Flat deck surface walkway
  walkableSurfaces.push({
    type: 'box',
    x1: x - 2.7,
    z1: z - 2.7,
    x2: x + 2.7,
    z2: z + 2.7,
    y: 12.0
  });

  return group;
}

// Campsite with Fire pit and surrounding logs for coverage
function makeCampsite(x, z, collidables) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x858580, roughness: 0.9 });
  const ashMat = new THREE.MeshStandardMaterial({ color: 0x3d3a35, roughness: 1.0 });
  const logMat = new THREE.MeshStandardMaterial({ color: 0x7c5432, roughness: 0.95 });
  const fireMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff3300, emissiveIntensity: 5.0 });

  // Fire pit stone ring
  const stoneRadius = 1.0;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const sx = Math.cos(angle) * stoneRadius;
    const sz = Math.sin(angle) * stoneRadius;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), stoneMat);
    stone.position.set(sx, 0.1, sz);
    group.add(stone);
  }

  // Ash Center
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 12), ashMat);
  ash.position.set(0, 0.04, 0);
  group.add(ash);

  // Fire logs
  const stickGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
  for (let i = 0; i < 4; i++) {
    const stick = new THREE.Mesh(stickGeo, logMat);
    stick.rotation.y = (i / 4) * Math.PI * 2;
    stick.rotation.z = Math.PI / 4 + 0.1;
    stick.position.set(0, 0.25, 0);
    group.add(stick);
  }

  // Fire embers
  const ember = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.0, 5), fireMat);
  ember.position.set(0, 0.5, 0);
  group.add(ember);

  // Dynamic light flickering campfire glow
  const fireLight = new THREE.PointLight(0xff5511, 4.0, 18, 1.0);
  fireLight.position.set(0, 0.8, 0);
  group.add(fireLight);

  // Tactical sitting logs (high cover barricades!)
  const logCount = 3;
  for (let i = 0; i < logCount; i++) {
    const angle = (i / logCount) * Math.PI * 2 + Math.PI / 6;
    const lx = Math.cos(angle) * 3.5;
    const lz = Math.sin(angle) * 3.5;

    const logMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 8), logMat);
    logMesh.rotation.y = angle + Math.PI / 2;
    logMesh.rotation.z = Math.PI / 2;
    logMesh.position.set(lx, 0.35, lz);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;
    group.add(logMesh);

    collidables.push({ x: x + lx, z: z + lz, radius: 0.65 });
  }

  return group;
}

// Tactical Sandbag Barricade
function makeBarricade(x, z, angle, collidables) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = angle;

  const bagMat = new THREE.MeshStandardMaterial({ color: 0xc2b092, roughness: 0.95 });

  // Stacked sandbag layers
  const bagGeo = new THREE.BoxGeometry(0.9, 0.38, 0.5);

  const offsets = [
    [-1.2, 0.19, 0], [0, 0.19, 0], [1.2, 0.19, 0],
    [-0.6, 0.57, 0], [0.6, 0.57, 0],
    [0, 0.95, 0]
  ];

  for (const [bx, by, bz] of offsets) {
    const bag = new THREE.Mesh(bagGeo, bagMat);
    bag.position.set(bx, by, bz);
    bag.rotation.z = (Math.random() - 0.5) * 0.08;
    bag.rotation.y = (Math.random() - 0.5) * 0.08;
    bag.castShadow = true;
    bag.receiveShadow = true;
    group.add(bag);
  }

  // Register physical collision bounding radius
  collidables.push({ x, z, radius: 1.6 });

  return group;
}

// Moss-covered ancient brick arches/ruins
function makeBrickRuin(x, z, angle, collidables) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = angle;

  const brickMat = new THREE.MeshStandardMaterial({ color: 0x8a7065, roughness: 0.9 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x4a6e3d, roughness: 0.95 });

  // Left pillar
  const pillarGeo = new THREE.BoxGeometry(0.8, 3.8, 0.8);
  const left = new THREE.Mesh(pillarGeo, brickMat);
  left.position.set(-1.8, 1.9, 0);
  left.castShadow = true;
  group.add(left);

  // Right pillar
  const right = new THREE.Mesh(pillarGeo, brickMat);
  right.position.set(1.8, 1.9, 0);
  right.castShadow = true;
  group.add(right);

  // Arch header beam
  const header = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.72, 0.8), brickMat);
  header.position.set(0, 4.16, 0);
  header.castShadow = true;
  group.add(header);

  // Broken collapsed bricks on ground
  const brokenGeo = new THREE.BoxGeometry(0.35, 0.18, 0.22);
  for (let i = 0; i < 6; i++) {
    const brick = new THREE.Mesh(brokenGeo, brickMat);
    brick.position.set((Math.random() - 0.5) * 3.5, 0.09, (Math.random() - 0.5) * 1.5);
    brick.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
    group.add(brick);
  }

  // Moss spots creeping on the arch
  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), mossMat);
  moss.scale.set(1, 0.2, 0.5);
  moss.position.set(-1.8, 3.6, 0.2);
  group.add(moss);

  const moss2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), mossMat);
  moss2.scale.set(1.2, 0.15, 0.8);
  moss2.position.set(0.6, 4.45, -0.15);
  group.add(moss2);

  // Bounding collisions
  collidables.push(
    { x: x - 1.8 * Math.cos(angle), z: z - 1.8 * Math.sin(angle), radius: 0.65 },
    { x: x + 1.8 * Math.cos(angle), z: z + 1.8 * Math.sin(angle), radius: 0.65 }
  );

  return group;
}

export function getForestTerrainHeight(x, z) {
  // Make the entire forest map completely flat so the grass, trees, buildings, and combat gameplay work perfectly without bumps or clipping!
  return 0;
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

  // The zombies map reuses the Ironvale layout, so its darker, grimier
  // `groundColor` tint (applied below) is what differentiates it visually
  // from daytime Ironvale — no separate base texture needed.
  const groundSpeckle =
    def.terrain === 'techbase'
      ? makeSpeckleTexture({ base: '#54585e', speck: '#2e3136', repeat: 48 })
      : makeSpeckleTexture({ base: '#4a7c3f', speck: '#5a9a4a', repeat: 48 });

  // Visually much bigger than the playable area (which stays bounded by
  // WORLD_SIZE and the boundary walls below): the sky dome is a sphere of
  // radius 400, and a ground plane that stops at WORLD_SIZE (240) leaves a
  // gap between the ground's edge and the dome at the horizon — the dome's
  // lower hemisphere becomes visible through that gap as a stray bulge
  // poking up above the treeline. Extending the ground well past the
  // dome's horizontal reach closes that gap.
  const GROUND_VISUAL_SIZE = 1000;
  let ground;
  if (def.terrain === 'forest') {
    // 120x120 tessellation density allows fine-grained smooth sculpted hills/humps across the forest floor
    const geom = new THREE.PlaneGeometry(GROUND_VISUAL_SIZE, GROUND_VISUAL_SIZE, 120, 120);
    const pos = geom.attributes.position;
    // PlaneGeometry vertices are (x, y, 0). After rotation.x = -Math.PI / 2, the Plane's Y coordinate becomes the 3D Z axis, and the Plane's Z becomes the 3D Y (height!)
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const worldX = vx;
      const worldZ = -vy; // map rotated axis
      const height = getForestTerrainHeight(worldX, worldZ);
      pos.setZ(i, height); // set vertical height map
    }
    geom.computeVertexNormals();
    ground = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ map: groundSpeckle, color: def.groundColor, roughness: 1 })
    );
  } else {
    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_VISUAL_SIZE, GROUND_VISUAL_SIZE),
      new THREE.MeshStandardMaterial({ map: groundSpeckle, color: def.groundColor, roughness: 1 })
    );
  }
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Real buildings, placed at fixed spots per map (not randomly scattered
  // like trees/rocks/crates) — the thing this map was actually missing.
  const houseSpecs =
    def.terrain === 'techbase'
      ? []
      : [
          { x: -55, z: 25, width: 6, depth: 5, doorSide: 'south', wallColor: 0x8a7458, roofColor: 0x5a3a2a },
          { x: 55, z: -25, width: 6, depth: 5, doorSide: 'north', wallColor: 0x7a6248, roofColor: 0x4a2e22 },
          { x: 30, z: 55, width: 6, depth: 5, doorSide: 'west', wallColor: 0x8a7458, roofColor: 0x5a3a2a },
          { x: -30, z: -55, width: 6, depth: 5, doorSide: 'east', wallColor: 0x7a6248, roofColor: 0x4a2e22 },
        ];

  const collidables = [];
  const walkableSurfaces = [];
  let ambientActors = null;
  const half = WORLD_SIZE / 2;
  const keepClear = [...getKeepClearPoints(), ...houseSpecs.map((h) => ({ x: h.x, z: h.z }))];
  const rand = makeRng(def.terrain === 'techbase' ? 4242 : 1337);

  if (def.terrain === 'techbase') {
    addIndustrialDistrict(scene, collidables, walkableSurfaces, def.mode === 'zombies');
    if (def.mode !== 'zombies') ambientActors = createVillageNPCs(scene);

    // Industrial maps use localized village lawns rather than covering roads
    // and factory yards in grass. Outbreak adds emergency lights to the same
    // layout for atmosphere.
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
    // Overgrown/moss-covered Central Factory in the forest!
    scene.add(makeCentralFactory(0, 0, collidables, walkableSurfaces, false, true));

    // Additional Forest Factory 1: Rusted Recovery (Double-Story, lit!)
    scene.add(makeCentralFactory(-65, 65, collidables, walkableSurfaces, false, true, "RUSTED RECOVERY"));

    // Additional Forest Factory 2: Abandoned Station (Double-Story, lit!)
    scene.add(makeCentralFactory(65, -65, collidables, walkableSurfaces, false, true, "ABANDONED STATION"));

    const trunkMat = new THREE.MeshStandardMaterial({ map: makeBarkTexture(), roughness: 0.95 });
    const canopyMats = [0x2e5c2e, 0x356b35, 0x3d7a3d].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
    // Smooth shading (not flatShading) reads as weathered stone rather
    // than a faceted low-poly "gem" look.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777066, roughness: 1 });
    const treeMaterials = { trunk: trunkMat, canopy: canopyMats };

    const treeCount = 340;
    for (let i = 0; i < treeCount; i++) {
      const x = (rand() - 0.5) * (WORLD_SIZE - 10);
      const z = (rand() - 0.5) * (WORLD_SIZE - 10);
      if (Math.hypot(x, z) < 24) continue; // Keep clear of central factory
      if (Math.hypot(x - (-65), z - 65) < 24) continue; // Keep clear of Rusted Recovery
      if (Math.hypot(x - 65, z - (-65)) < 24) continue; // Keep clear of Abandoned Station
      if (isNearAnyPoint(x, z, keepClear, 7)) continue;
      const t = makeTree(x, z, rand, treeMaterials);
      t.group.position.y = getForestTerrainHeight(x, z);
      scene.add(t.group);
      collidables.push({ x, z, radius: t.radius });
    }

    const rockCount = 30;
    for (let i = 0; i < rockCount; i++) {
      const x = (rand() - 0.5) * (WORLD_SIZE - 20);
      const z = (rand() - 0.5) * (WORLD_SIZE - 20);
      if (Math.hypot(x, z) < 24) continue; // Keep clear of central factory
      if (Math.hypot(x - (-65), z - 65) < 24) continue; // Keep clear of Rusted Recovery
      if (Math.hypot(x - 65, z - (-65)) < 24) continue; // Keep clear of Abandoned Station
      if (isNearAnyPoint(x, z, keepClear, 7)) continue;
      const r = makeRockCluster(x, z, rand, rockMat);
      r.group.position.y = getForestTerrainHeight(x, z);
      scene.add(r.group);
      collidables.push({ x, z, radius: r.radius });
    }

    scene.add(makeGrassField(half, makeRng(99), 6000, true));

    // Spawn 2 climbable, fully-illuminated Tactical Watchtowers!
    scene.add(makeWatchtower(-35, -35, collidables, walkableSurfaces));
    scene.add(makeWatchtower(35, 35, collidables, walkableSurfaces));

    // Spawn 2 gorgeous campfire campsites with logs for tactical cover!
    scene.add(makeCampsite(-30, 20, collidables));
    scene.add(makeCampsite(25, -25, collidables));

    // Spawn several sandbag cover barricades strategically scattered!
    scene.add(makeBarricade(-15, -12, 0.4, collidables));
    scene.add(makeBarricade(12, 18, -0.6, collidables));
    scene.add(makeBarricade(-8, 30, 1.2, collidables));
    scene.add(makeBarricade(35, -5, -1.1, collidables));

    // Spawn 2 ancient overgrown stone ruins for premium aesthetics and cover!
    scene.add(makeBrickRuin(-45, 5, 0.8, collidables));
    scene.add(makeBrickRuin(42, -45, -0.5, collidables));
  }

  for (const spec of houseSpecs) {
    const house = makeHouse(spec.x, spec.z, collidables, spec);
    const yVal = def.terrain === 'forest' ? getForestTerrainHeight(spec.x, spec.z) : 0;
    house.position.y = yVal;
    scene.add(house);
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

  return {
    scene,
    collidables,
    bounds: half - 1.5,
    getFloorHeight(x, z, currentY, stepAllowance = 0) {
      const surfaceHeight = getWalkableHeight(walkableSurfaces, x, z, currentY, stepAllowance);
      if (def.terrain === 'forest') {
        const terrainHeight = getForestTerrainHeight(x, z);
        return Math.max(terrainHeight, surfaceHeight);
      }
      return surfaceHeight;
    },
    update(dt) {
      ambientActors?.update(dt);
      if (beaconSpotlight) {
        beaconAngle += dt * 0.45; // rotate smoothly
        beaconSpotlight.target.position.set(
          beaconSpotlight.position.x + Math.cos(beaconAngle) * 85,
          0,
          beaconSpotlight.position.z + Math.sin(beaconAngle) * 85
        );
      }
    },
  };
}
