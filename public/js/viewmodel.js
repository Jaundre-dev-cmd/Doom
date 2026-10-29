// First-person viewmodel renderer, built the way modern military shooters
// (Call of Duty and friends) do it:
//
//  - The held weapon lives in its own scene with its own camera and its own
//    field of view ("weapon FOV"). It is drawn on top of the world after a
//    depth clear, so a wide world FOV never stretches or shrinks the gun,
//    and the gun can never poke through walls.
//  - It is lit by its own key/rim/fill lights, but the key light tracks the
//    real sun direction relative to where you're looking, and dims when you
//    step into shade or indoors — the gun visibly belongs to the world.
//  - Muzzle flash (front star + side flame cards + a light that flashes the
//    gun and hands), and brass shell casings that eject into the real world,
//    fall, bounce and roll on the ground.

import * as THREE from 'three';

export const WEAPON_FOV_PRESETS = { narrow: 44, default: 50, wide: 60 };

function flashTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  if (kind === 'star') {
    // Bright core with ragged spikes, viewed down the barrel.
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      ctx.save();
      ctx.rotate((i / spikes) * Math.PI * 2 + Math.random() * 0.3);
      const len = 40 + Math.random() * 22;
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,240,200,1)');
      g.addColorStop(0.4, 'rgba(255,170,60,0.8)');
      g.addColorStop(1, 'rgba(255,90,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, 7);
      ctx.fill();
      ctx.restore();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    core.addColorStop(0, 'rgba(255,255,240,1)');
    core.addColorStop(0.5, 'rgba(255,200,110,0.7)');
    core.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Side-on flame: a teardrop of hot gas leaving the muzzle.
    const g = ctx.createLinearGradient(0, 60, 0, -64);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.25, 'rgba(255,190,80,0.9)');
    g.addColorStop(0.7, 'rgba(255,110,20,0.35)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-18, 60);
    ctx.quadraticCurveTo(-30, -10, 0, -64);
    ctx.quadraticCurveTo(30, -10, 18, 60);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Viewmodel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(WEAPON_FOV_PRESETS.default, aspect, 0.01, 20);
    this.scene.add(this.camera);
    this.baseFov = WEAPON_FOV_PRESETS.default;

    this.hemi = new THREE.HemisphereLight(0xc8d6e6, 0x3a3a30, 0.9);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0dc, 2.4);
    this.scene.add(this.key, this.key.target);
    this.rim = new THREE.DirectionalLight(0x9ec4ff, 1.1);
    this.rim.position.set(-1.5, 0.8, 2.5);
    this.scene.add(this.rim);
    this.fill = new THREE.PointLight(0xffffff, 0.35, 3, 2);
    this.fill.position.set(0.3, 0.1, 0.4);
    this.camera.add(this.fill);
    this.flashLight = new THREE.PointLight(0xffa850, 0, 3, 2);
    this.scene.add(this.flashLight);

    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
    this.keyBase = 2.4;
    this.exposure = 1; // 1 = in sunlight, ~0.25 = in shade/indoors
    this.exposureTarget = 1;

    // Muzzle flash rig (parented to the weapon's muzzle point).
    const starMat = new THREE.MeshBasicMaterial({ map: flashTexture('star'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const flameMat = new THREE.MeshBasicMaterial({ map: flashTexture('flame'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    this.flashStar = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), starMat);
    this.flash.add(this.flashStar);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.PlaneGeometry(0.13, 0.36);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, -0.17);
      const card = new THREE.Mesh(g, flameMat);
      card.rotation.z = (i * Math.PI) / 2;
      this.flash.add(card);
    }
    this.flash.visible = false;
    this.flashT = 0;
    this.weapon = null;

    // Brass
    this.shells = [];
    this.shellGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.024, 8);
    this.shellGeo.rotateZ(Math.PI / 2);
    this.shotgunShellGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 8);
    this.shotgunShellGeo.rotateZ(Math.PI / 2);
    this.brassMat = new THREE.MeshStandardMaterial({ color: 0xc89a3c, metalness: 1, roughness: 0.32 });
    this.hullMat = new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.6 });
  }

  setLighting({ sky, ground, environment, environmentIntensity = 0.5, keyIntensity = 2.4 }) {
    this.hemi.color.set(sky);
    this.hemi.groundColor.set(ground);
    this.scene.environment = environment || null;
    this.scene.environmentIntensity = environmentIntensity;
    this.keyBase = keyIntensity;
  }

  setSunDirection(dir) {
    this.sunDir.copy(dir).normalize();
  }

  setFov(fov) {
    this.baseFov = fov;
  }

  setWeapon(group) {
    if (this.weapon) this.camera.remove(this.weapon);
    this.weapon = group;
    if (!group) return;
    this.camera.add(group);
    const muzzle = group.userData.muzzle;
    if (muzzle) {
      muzzle.add(this.flash);
      this.flash.scale.setScalar(1 / (group.scale.x || 1));
    }
  }

  muzzleFlash(weaponKey) {
    if (!this.weapon || weaponKey === 'rocket') return;
    const suppressed = weaponKey === 'm4a1' || weaponKey === 'mp5';
    const big = weaponKey === 'shotgun' || weaponKey === 'awp' || weaponKey === 'chaingun';
    const s = suppressed ? 0.35 : big ? 1.5 : 1;
    this.flash.visible = true;
    this.flashT = 0.045;
    this.flashStar.rotation.z = Math.random() * Math.PI * 2;
    this.flashStar.scale.setScalar(s * (0.8 + Math.random() * 0.5));
    for (let i = 1; i < this.flash.children.length; i++) {
      this.flash.children[i].scale.set(s, s * (0.7 + Math.random() * 0.6), s);
      this.flash.children[i].visible = !suppressed;
    }
    this.weapon.userData.muzzle?.getWorldPosition(this.flashLight.position);
    this.flashLight.intensity = suppressed ? 0.6 : 4 * s;
  }

  // Ejects a casing from the weapon's ejection port into the WORLD scene.
  ejectShell(worldScene, mainCamera, weaponKey, playerVel) {
    if (!this.weapon || weaponKey === 'rocket') return;
    const port = this.weapon.userData.ejector;
    if (!port) return;
    const local = port.getWorldPosition(new THREE.Vector3()); // vm space == camera space
    const pos = mainCamera.localToWorld(local.clone().multiplyScalar(0.9));
    const camVel = new THREE.Vector3(1.6 + Math.random() * 0.8, 1.4 + Math.random() * 0.8, 0.3 + Math.random() * 0.4).applyQuaternion(mainCamera.quaternion);
    const mesh = new THREE.Mesh(weaponKey === 'shotgun' ? this.shotgunShellGeo : this.shellGeo, weaponKey === 'shotgun' ? this.hullMat : this.brassMat);
    mesh.position.copy(pos);
    mesh.quaternion.copy(mainCamera.quaternion);
    mesh.castShadow = false;
    worldScene.add(mesh);
    this.shells.push({
      mesh,
      vel: camVel.add(playerVel || new THREE.Vector3()),
      spin: new THREE.Vector3(Math.random() * 30 - 15, Math.random() * 30 - 15, Math.random() * 40 - 20),
      life: 0,
      bounced: 0,
    });
    if (this.shells.length > 40) {
      const old = this.shells.shift();
      old.mesh.removeFromParent();
    }
  }

  update(dt, mainCamera, world, onShellBounce) {
    // Key light follows the real sun, expressed in camera space.
    const inv = mainCamera.quaternion.clone().invert();
    const d = this.sunDir.clone().applyQuaternion(inv);
    this.key.position.copy(d).multiplyScalar(5);
    this.exposure += (this.exposureTarget - this.exposure) * Math.min(1, dt * 4);
    this.key.intensity = this.keyBase * this.exposure;
    this.hemi.intensity = 0.55 + 0.45 * this.exposure;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 90);

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life += dt;
      if (s.life > 5) {
        s.mesh.removeFromParent();
        this.shells.splice(i, 1);
        continue;
      }
      if (s.bounced > 3 && s.vel.lengthSq() < 0.01) continue;
      s.vel.y -= 20 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      const floor = Math.max(0, world.getFloorHeight?.(s.mesh.position.x, s.mesh.position.z, s.mesh.position.y, 0.2) ?? 0) + 0.006;
      if (s.mesh.position.y < floor) {
        s.mesh.position.y = floor;
        if (s.vel.y < -0.6) {
          if (s.bounced < 2) onShellBounce?.(s.mesh.position, Math.min(1, -s.vel.y / 5));
          s.vel.y *= -0.35;
          s.vel.x *= 0.5;
          s.vel.z *= 0.5;
          s.spin.multiplyScalar(0.5);
          s.bounced++;
        } else {
          s.vel.set(s.vel.x * 0.85, 0, s.vel.z * 0.85);
          s.spin.set(0, 0, 0);
          s.mesh.rotation.x = 0;
          s.mesh.rotation.z = 0;
          s.bounced = 4;
        }
      }
    }
  }

  setCameraFov(fov) {
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  render(renderer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  clearShells() {
    for (const s of this.shells) s.mesh.removeFromParent();
    this.shells = [];
  }
}
