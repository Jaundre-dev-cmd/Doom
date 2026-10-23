// Local player physics: position, velocity, gravity/jump, and collision
// against the current map's cylindrical obstacles (trees, rocks, crates)
// plus the world boundary. This module does no rendering — main.js drives
// the Three.js camera's position/rotation from this each frame.

import {
  PLAYER_RADIUS,
  PLAYER_EYE_HEIGHT,
  MOVE_SPEED,
  SPRINT_MULTIPLIER,
  ACCELERATION,
  FRICTION,
  JUMP_SPEED,
  GRAVITY,
  JETPACK_ACCEL,
  JETPACK_MAX_VY,
  JETPACK_FUEL_MAX,
  JETPACK_FUEL_DRAIN_PER_SEC,
  JETPACK_FUEL_REGEN_PER_SEC,
  STARTING_MONEY,
} from './constants.js';

export class LocalPlayer {
  constructor(x, z, angle) {
    this.x = x;
    this.z = z;
    this.y = 0; // height above ground (for jumping/jetpack)
    this.vy = 0;
    this.angle = angle; // yaw, radians — 0 looks toward -Z (Three.js default camera forward)
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.onGround = true;
    this.health = 100;
    this.score = 0;
    this.zombieKills = 0;
    this.name = 'You';
    this.isMoving = false;

    // Jetpack
    this.jetpackFuel = JETPACK_FUEL_MAX;
    this.isThrusting = false;

    // Economy / loadout (tracked locally — see constants.js economy note)
    this.money = STARTING_MONEY;
    this.ownedWeapons = ['pistol'];
    this.weaponUpgrades = {}; // weaponKey -> true once upgraded
  }

  get eyeHeight() {
    return PLAYER_EYE_HEIGHT + this.y;
  }

  update(dt, input, world) {
    const forward = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    // Forward/right vectors matching the camera's yaw convention.
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

    const topSpeed = MOVE_SPEED * (input.sprint ? SPRINT_MULTIPLIER : 1);
    const targetVx = wishX * topSpeed;
    const targetVz = wishZ * topSpeed;
    const rate = this.isMoving ? ACCELERATION : FRICTION;
    this.vx += (targetVx - this.vx) * Math.min(1, rate * dt);
    this.vz += (targetVz - this.vz) * Math.min(1, rate * dt);

    this.moveWithCollision(this.vx * dt, this.vz * dt, world);

    // Jump (held Space keeps hopping on landing, COD-style).
    if (input.jump && this.onGround) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }

    // Jetpack: thrust fights gravity while held and fuel remains; fuel
    // regenerates whenever you're not thrusting.
    this.isThrusting = !!input.jetpack && this.jetpackFuel > 0;
    if (this.isThrusting) {
      this.vy += JETPACK_ACCEL * dt;
      this.jetpackFuel = Math.max(0, this.jetpackFuel - JETPACK_FUEL_DRAIN_PER_SEC * dt);
      this.onGround = false;
    } else {
      this.jetpackFuel = Math.min(JETPACK_FUEL_MAX, this.jetpackFuel + JETPACK_FUEL_REGEN_PER_SEC * dt);
    }

    this.vy -= GRAVITY * dt;
    this.vy = Math.min(this.vy, JETPACK_MAX_VY);
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.onGround = true;
    }
  }

  moveWithCollision(dx, dz, world) {
    const r = PLAYER_RADIUS;
    const bound = world.bounds;

    const newX = this.x + dx;
    if (!this.collides(newX, this.z, r, world)) {
      this.x = Math.min(bound, Math.max(-bound, newX));
    } else {
      this.vx = 0;
    }

    const newZ = this.z + dz;
    if (!this.collides(this.x, newZ, r, world)) {
      this.z = Math.min(bound, Math.max(-bound, newZ));
    } else {
      this.vz = 0;
    }
  }

  collides(x, z, r, world) {
    for (const obj of world.collidables) {
      const dx = x - obj.x;
      const dz = z - obj.z;
      const minDist = r + obj.radius;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }

  rotateYaw(deltaX, sensitivity) {
    this.angle += deltaX * sensitivity;
  }

  rotatePitch(deltaY, sensitivity, maxPitch) {
    this.pitch -= deltaY * sensitivity;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }
}
