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
  GRAVITY,
  FLY_SPEED,
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

    // Free flight — unlimited, no fuel. Toggled on/off by a double-tap of
    // Space or a single press of F (see main.js); while on, gravity is
    // suspended entirely.
    this.flying = false;
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

    // Ramps and upper floors register walkable surfaces with the world. Pick
    // only a surface close enough to step onto from the player's current
    // elevation, which prevents somebody on the ground floor from snapping
    // through a ceiling to the floor above.
    const floorY = world.getFloorHeight?.(this.x, this.z, this.y, this.onGround ? 0.55 : 0) ?? 0;
    if (this.onGround) {
      if (floorY >= this.y - 0.35 && floorY <= this.y + 0.55) {
        this.y = floorY;
        this.vy = 0;
      } else if (floorY < this.y - 0.1) {
        this.onGround = false;
      }
    }

    if (this.flying) {
      // Unlimited free flight: no fuel, no cap. Holding Space climbs at a
      // constant rate; releasing it just hovers in place (gravity stays
      // suspended — you don't drift back down on your own). The only way
      // down is to exit flight (double-tap Space, or press F), at which
      // point the `else` branch below takes over and gravity resumes.
      this.vy = input.spaceHeld ? FLY_SPEED : 0;
      this.y += this.vy * dt;
      this.onGround = false;
    } else {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.vy <= 0 && this.y <= floorY) {
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
      const playerMinY = this.y + 0.05;
      const playerMaxY = this.y + PLAYER_EYE_HEIGHT;
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
    // Moving the mouse/trackpad right should turn the view right. Given
    // this game's yaw convention (forward = (-sin(angle), -cos(angle))),
    // increasing `angle` turns the view left, so rightward input must
    // *subtract* from it, not add.
    this.angle -= deltaX * sensitivity;
  }

  rotatePitch(deltaY, sensitivity, maxPitch) {
    this.pitch -= deltaY * sensitivity;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }
}
