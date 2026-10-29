// Local player physics: position, velocity, gravity, jumping, crouching,
// and collision against the current map's cylindrical obstacles (trees,
// rocks, wall segments) plus the world boundary. This module does no
// rendering — main.js drives the Three.js camera from this each frame.

import {
  PLAYER_RADIUS,
  PLAYER_EYE_HEIGHT,
  PLAYER_CROUCH_EYE_HEIGHT,
  MOVE_SPEED,
  SPRINT_MULTIPLIER,
  CROUCH_SPEED_MULTIPLIER,
  ADS_SPEED_MULTIPLIER,
  ACCELERATION,
  FRICTION,
  AIR_CONTROL,
  GRAVITY,
  JUMP_VELOCITY,
  FLY_SPEED,
} from './constants.js';

// Uniform grid over the collidable circles, so a collision test only
// looks at the handful of obstacles in nearby cells instead of every
// tree/wall segment on the map (thousands on the bigger maps).
const CELL = 4;

function buildCollisionGrid(collidables) {
  const cells = new Map();
  for (const c of collidables) {
    const r = c.radius + PLAYER_RADIUS;
    const x0 = Math.floor((c.x - r) / CELL);
    const x1 = Math.floor((c.x + r) / CELL);
    const z0 = Math.floor((c.z - r) / CELL);
    const z1 = Math.floor((c.z + r) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx * 100003 + gz;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(c);
      }
    }
  }
  return cells;
}

export function queryCollidables(world, x, z) {
  if (!world._collisionGrid || world._collisionGridSource !== world.collidables.length) {
    world._collisionGrid = buildCollisionGrid(world.collidables);
    world._collisionGridSource = world.collidables.length;
  }
  return world._collisionGrid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || [];
}

export class LocalPlayer {
  constructor(x, z, angle) {
    this.x = x;
    this.z = z;
    this.y = 0; // feet height above ground
    this.vy = 0;
    this.angle = angle; // yaw, radians — 0 looks toward -Z (Three.js default camera forward)
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.onGround = true;
    this.health = 100;
    this.score = 0;
    this.deaths = 0;
    this.zombieKills = 0;
    this.name = 'You';
    this.isMoving = false;
    this.isSprinting = false;

    this.crouching = false;
    // 0 = standing, 1 = fully crouched. Eased so the camera glides down
    // instead of snapping.
    this.crouchT = 0;
    this.aiming = false;
    this.flying = false;
    this.jumpQueued = false;
    this.landingImpact = 0; // set on landing, read by main.js for camera dip
  }

  get standHeight() {
    return PLAYER_EYE_HEIGHT + (PLAYER_CROUCH_EYE_HEIGHT - PLAYER_EYE_HEIGHT) * this.crouchT;
  }

  get eyeHeight() {
    return this.standHeight + this.y;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  jump() {
    this.jumpQueued = true;
  }

  update(dt, input, world) {
    const forward = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    const forwardX = -Math.sin(this.angle);
    const forwardZ = -Math.cos(this.angle);
    const rightX = Math.cos(this.angle);
    const rightZ = -Math.sin(this.angle);

    let wishX = forwardX * forward + rightX * strafe;
    let wishZ = forwardZ * forward + rightZ * strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    this.isMoving = wishLen > 0;
    if (wishLen > 0) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    // Sprinting only works moving forwards, standing, and not aiming —
    // like every modern military shooter.
    this.isSprinting = input.sprint && forward > 0 && !this.crouching && !this.aiming && this.onGround;
    let topSpeed = MOVE_SPEED;
    if (this.isSprinting) topSpeed *= SPRINT_MULTIPLIER;
    if (this.crouching && !this.flying) topSpeed *= CROUCH_SPEED_MULTIPLIER;
    if (this.aiming) topSpeed *= ADS_SPEED_MULTIPLIER;
    // Strafing and back-pedalling are slower than running forwards.
    if (forward <= 0) topSpeed *= 0.85;

    const targetVx = wishX * topSpeed;
    const targetVz = wishZ * topSpeed;
    let rate = this.isMoving ? ACCELERATION : FRICTION;
    if (!this.onGround && !this.flying) rate *= AIR_CONTROL;
    this.vx += (targetVx - this.vx) * Math.min(1, rate * dt);
    this.vz += (targetVz - this.vz) * Math.min(1, rate * dt);

    this.moveWithCollision(this.vx * dt, this.vz * dt, world);

    const targetCrouch = this.crouching && !this.flying ? 1 : 0;
    this.crouchT += (targetCrouch - this.crouchT) * Math.min(1, dt * 12);

    // Ramps and upper floors register walkable surfaces with the world.
    const floorY = world.getFloorHeight?.(this.x, this.z, this.y, this.onGround ? 0.55 : 0) ?? 0;
    if (this.onGround && !this.flying) {
      if (floorY >= this.y - 0.35 && floorY <= this.y + 0.55) {
        this.y = floorY;
        this.vy = 0;
      } else if (floorY < this.y - 0.1) {
        this.onGround = false;
      }
    }

    if (this.flying) {
      this.vy = input.spaceHeld ? FLY_SPEED : input.crouchHeld ? -FLY_SPEED : 0;
      this.y = Math.max(floorY, this.y + this.vy * dt);
      this.onGround = false;
      this.jumpQueued = false;
      return;
    }

    if (this.jumpQueued && this.onGround) {
      // Jumping out of a crouch stands you up first, then hops.
      if (this.crouching) {
        this.crouching = false;
      } else {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
    }
    this.jumpQueued = false;

    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.vy <= 0 && this.y <= floorY) {
        this.landingImpact = Math.min(1, -this.vy / 14);
        this.y = floorY;
        this.vy = 0;
        this.onGround = true;
      }
    }
  }

  moveWithCollision(dx, dz, world) {
    const r = PLAYER_RADIUS;
    const bound = world.bounds;

    const newX = this.x + dx;
    if (!this.collides(newX, this.z, r, world)) {
      this.x = Math.min(bound, Math.max(-bound, newX));
    } else {
      this.vx *= 0.2;
    }

    const newZ = this.z + dz;
    if (!this.collides(this.x, newZ, r, world)) {
      this.z = Math.min(bound, Math.max(-bound, newZ));
    } else {
      this.vz *= 0.2;
    }
  }

  collides(x, z, r, world) {
    const playerMinY = this.y + 0.05;
    const playerMaxY = this.y + this.standHeight;
    for (const obj of queryCollidables(world, x, z)) {
      const obstacleMinY = obj.minY ?? -Infinity;
      const obstacleMaxY = obj.maxY ?? Infinity;
      if (playerMaxY <= obstacleMinY || playerMinY >= obstacleMaxY) continue;
      const dx = x - obj.x;
      const dz = z - obj.z;
      const minDist = r + obj.radius;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }

  rotateYaw(deltaX, sensitivity) {
    // Yaw convention: forward = (-sin(angle), -cos(angle)), so turning
    // right means decreasing the angle.
    this.angle -= deltaX * sensitivity;
  }

  rotatePitch(deltaY, sensitivity, maxPitch) {
    this.pitch -= deltaY * sensitivity;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }
}
