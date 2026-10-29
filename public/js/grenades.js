// Frag grenades: physically simulated projectiles (gravity, bouncing off
// the ground, walls and obstacles, rolling friction) with a cookable
// fuse.
//
// The thrower's client is authoritative, the same way rockets work: it
// simulates the grenade, resolves the blast damage and reports the
// detonation point. Every other client runs the same simulation from the
// thrown position/velocity so the grenade visibly flies and bounces for
// them too, then snaps the explosion to the thrower's reported point.

import * as THREE from 'three';
import { GRAVITY, GRENADE_RADIUS, GRENADE_BLAST_RADIUS } from './constants.js';
import { queryCollidables } from './localPlayer.js';

const RESTITUTION = 0.38;
const WALL_RESTITUTION = 0.45;
const GROUND_FRICTION = 0.62;
const ROLL_DRAG = 2.6;
const SUBSTEPS = 4;

let sharedGeo = null;
function grenadeMesh() {
  if (!sharedGeo) {
    const body = new THREE.SphereGeometry(GRENADE_RADIUS, 12, 10);
    body.scale(1, 1.25, 1);
    sharedGeo = {
      body,
      cap: new THREE.CylinderGeometry(0.025, 0.03, 0.04, 8),
      lever: new THREE.BoxGeometry(0.015, 0.09, 0.02),
      ring: new THREE.TorusGeometry(0.02, 0.004, 6, 12),
      bodyMat: new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.65, metalness: 0.2 }),
      metalMat: new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.4, metalness: 0.8 }),
    };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(sharedGeo.body, sharedGeo.bodyMat);
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(sharedGeo.cap, sharedGeo.metalMat);
  cap.position.y = GRENADE_RADIUS * 1.3;
  g.add(cap);
  const lever = new THREE.Mesh(sharedGeo.lever, sharedGeo.metalMat);
  lever.position.set(0.035, GRENADE_RADIUS * 0.9, 0);
  lever.rotation.z = -0.2;
  g.add(lever);
  return g;
}

export function createHeldGrenade() {
  const g = grenadeMesh();
  const ring = new THREE.Mesh(sharedGeo.ring, sharedGeo.metalMat);
  ring.position.set(-0.03, GRENADE_RADIUS * 1.5, 0);
  g.add(ring);
  return g;
}

export class GrenadeSystem {
  constructor({ scene, world }) {
    this.scene = scene;
    this.world = world;
    this.active = [];
  }

  // `fuseMs` is the fuse time remaining at the moment of the throw.
  spawn({ id, ownerId, pos, vel, fuseMs, isLocal }) {
    const mesh = grenadeMesh();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const g = {
      id,
      ownerId,
      pos: pos.clone(),
      vel: vel.clone(),
      fuseLeft: fuseMs / 1000,
      isLocal,
      mesh,
      spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 8, Math.random() * 12 - 6),
      exploded: false,
    };
    this.active.push(g);
    return g;
  }

  remove(g) {
    g.mesh.removeFromParent();
    const i = this.active.indexOf(g);
    if (i >= 0) this.active.splice(i, 1);
  }

  findById(id) {
    return this.active.find((g) => g.id === id);
  }

  // Returns the list of grenades whose fuse ran out this frame. Remote
  // grenades get a grace period to wait for the thrower's authoritative
  // 'explosion' message before detonating on their own.
  update(dt) {
    const detonated = [];
    for (const g of [...this.active]) {
      const h = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) this.step(g, h);
      g.mesh.position.copy(g.pos);
      const spinScale = Math.min(1, g.vel.length() / 4);
      g.mesh.rotation.x += g.spin.x * dt * spinScale;
      g.mesh.rotation.y += g.spin.y * dt * spinScale;
      g.mesh.rotation.z += g.spin.z * dt * spinScale;

      g.fuseLeft -= dt;
      if (g.fuseLeft <= (g.isLocal ? 0 : -0.6)) {
        detonated.push(g);
        this.remove(g);
      }
    }
    return detonated;
  }

  step(g, dt) {
    const { pos, vel } = g;
    vel.y -= GRAVITY * dt;
    pos.addScaledVector(vel, dt);

    // Obstacles (trees, rocks, wall segments) are vertical cylinders.
    for (const c of queryCollidables(this.world, pos.x, pos.z)) {
      const minY = c.minY ?? -Infinity;
      const maxY = c.maxY ?? Infinity;
      if (pos.y < minY || pos.y > maxY + GRENADE_RADIUS) continue;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const minDist = c.radius + GRENADE_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      // Landing on top of a low obstacle (log, rock) rather than its side.
      if (Number.isFinite(maxY) && pos.y > maxY - 0.1 && vel.y < 0) {
        pos.y = maxY + GRENADE_RADIUS;
        vel.y = -vel.y * RESTITUTION;
        vel.x *= GROUND_FRICTION;
        vel.z *= GROUND_FRICTION;
        continue;
      }
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const nz = dz / d;
      pos.x = c.x + nx * minDist;
      pos.z = c.z + nz * minDist;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= (1 + WALL_RESTITUTION) * vn * nx;
        vel.z -= (1 + WALL_RESTITUTION) * vn * nz;
      }
    }

    const bound = this.world.bounds;
    if (Math.abs(pos.x) > bound) {
      pos.x = Math.sign(pos.x) * bound;
      vel.x = -vel.x * WALL_RESTITUTION;
    }
    if (Math.abs(pos.z) > bound) {
      pos.z = Math.sign(pos.z) * bound;
      vel.z = -vel.z * WALL_RESTITUTION;
    }

    const floor = Math.max(0, this.world.getFloorHeight?.(pos.x, pos.z, pos.y - GRENADE_RADIUS, 0.25) ?? 0);
    if (pos.y - GRENADE_RADIUS <= floor) {
      pos.y = floor + GRENADE_RADIUS;
      if (vel.y < -1.2) {
        vel.y = -vel.y * RESTITUTION;
        vel.x *= GROUND_FRICTION;
        vel.z *= GROUND_FRICTION;
      } else {
        vel.y = 0;
        const k = Math.max(0, 1 - ROLL_DRAG * dt);
        vel.x *= k;
        vel.z *= k;
      }
    }
  }

  clear() {
    for (const g of this.active) g.mesh.removeFromParent();
    this.active = [];
  }
}

// Damage falloff for a blast: full damage within 25% of the radius,
// then a smooth falloff to zero at the edge.
export function blastFalloff(distance, radius = GRENADE_BLAST_RADIUS) {
  if (distance >= radius) return 0;
  const t = distance / radius;
  if (t < 0.25) return 1;
  const k = (t - 0.25) / 0.75;
  return 1 - k * k * (3 - 2 * k);
}
