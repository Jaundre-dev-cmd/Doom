// A visible representation of another player: an articulated low-poly
// humanoid (torso, head, two swinging arms, two swinging legs) in their
// chosen skin color and accent color, with optional headgear, a name tag
// that always faces the camera, a jetpack flame shown while airborne, and
// an invisible hitbox mesh used for shot raycasting (larger than the
// visible model, for forgiving aim over network latency).
//
// This is built from real human body proportions (head/torso/limb ratios)
// rather than a single capsule, and animates a basic opposite-arm/leg
// walk cycle — a meaningful "looks like a person" upgrade achievable with
// primitive geometry alone, with no external model files.
//
// The same builder also produces the zombies-mode enemy model (pass
// `isZombie: true`): a sickly tint, glowing eyes, and a permanent hunch.

import * as THREE from 'three';

function makeNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  drawName(ctx, canvas, name);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2, 0.5, 1);
  sprite.userData = { canvas, ctx, texture };
  return sprite;
}

function drawName(ctx, canvas, name) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 28px "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(name, canvas.width / 2, 40);
}

function makeLimb(length, radiusTop, radiusBottom, color) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.75 })
  );
  mesh.position.y = -length / 2; // group origin sits at the pivot (shoulder/hip); limb hangs below it
  mesh.castShadow = true;
  return mesh;
}

function addHeadgear(group, kind, headY, accentColor) {
  if (kind === 'helmet') {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
      new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5, metalness: 0.3 })
    );
    helmet.position.y = headY + 0.03;
    helmet.castShadow = true;
    group.add(helmet);
  } else if (kind === 'cap') {
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.165, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.8 })
    );
    crown.position.y = headY + 0.03;
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.8 })
    );
    brim.position.set(0, headY - 0.02, -0.14);
    group.add(crown, brim);
  }
}

export function createPlayerModel(skinColor, name, options = {}) {
  const { accentColor = 0x2b2b2b, headgear = 'none', isZombie = false } = options;
  const group = new THREE.Group();

  // Proportions approximate a ~1.8-unit-tall adult figure.
  const hipY = 0.9;
  const shoulderY = 1.45;
  const headY = shoulderY + 0.22;
  const headColor = isZombie ? 0x7a8a6a : 0xe0b894;
  const bodyColor = isZombie ? 0x4a5a3a : skinColor;

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, shoulderY - hipY + 0.1, 0.28),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 })
  );
  torso.position.y = (shoulderY + hipY) / 2;
  torso.rotation.x = isZombie ? 0.25 : 0; // permanent hunch
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.85 }));
  head.position.y = headY;
  head.position.z = isZombie ? 0.08 : 0;
  head.castShadow = true;
  group.add(head);

  if (isZombie) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    for (const dx of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
      eye.position.set(dx, headY + 0.01, 0.16);
      group.add(eye);
    }
  } else {
    addHeadgear(group, headgear, headY, accentColor);
  }

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.32, shoulderY, 0);
  leftArmPivot.add(makeLimb(0.55, 0.07, 0.06, bodyColor));
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.32, shoulderY, 0);
  rightArmPivot.add(makeLimb(0.55, 0.07, 0.06, bodyColor));
  group.add(rightArmPivot);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.14, hipY, 0);
  leftLegPivot.add(makeLimb(0.9, 0.09, 0.08, accentColor));
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.14, hipY, 0);
  rightLegPivot.add(makeLimb(0.9, 0.09, 0.08, accentColor));
  group.add(rightLegPivot);

  let gun = null;
  if (!isZombie) {
    // Gun offset toward -Z, matching the local camera's forward convention
    // (yaw 0 looks toward -Z), so a remote player's rotation.y = their yaw
    // makes their gun visibly point the way they're actually facing.
    gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.5 })
    );
    gun.position.set(0.32, 1.15, -0.3);
    group.add(gun);
  }

  // Jetpack flame, shown only while airborne (zombies never fly).
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.35, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0.85 })
  );
  flame.position.set(0, hipY - 0.1, 0.18);
  flame.rotation.x = Math.PI;
  flame.visible = false;
  group.add(flame);

  const nameSprite = makeNameSprite(name);
  nameSprite.position.y = headY + 0.35;
  group.add(nameSprite);

  // Invisible but raycast-testable hitbox, larger than the visible model.
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.85, 0.9),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitbox.position.y = 0.92;
  group.add(hitbox);

  let walkPhase = 0;

  return {
    group,
    hitbox,
    setPosition(x, y, z, angle) {
      group.position.set(x, y || 0, z);
      group.rotation.y = angle || 0;
    },
    setName(newName) {
      drawName(nameSprite.userData.ctx, nameSprite.userData.canvas, newName);
      nameSprite.userData.texture.needsUpdate = true;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    setAirborne(airborne) {
      flame.visible = airborne && !isZombie;
    },
    // Called every render frame (not just on network updates) so the walk
    // cycle swings smoothly between the ~20Hz position updates. Zombies
    // always shamble, regardless of the `moving` flag.
    animate(dt, moving) {
      const effectivelyMoving = isZombie || moving;
      if (effectivelyMoving) {
        walkPhase += dt * (isZombie ? 5 : 8);
      } else {
        walkPhase += (0 - (walkPhase % (Math.PI * 2))) * Math.min(1, dt * 6); // ease back to neutral
      }
      const swing = Math.sin(walkPhase) * (effectivelyMoving ? 0.6 : 0);
      leftArmPivot.rotation.x = swing;
      rightArmPivot.rotation.x = -swing;
      leftLegPivot.rotation.x = -swing;
      rightLegPivot.rotation.x = swing;
    },
    dispose() {
      torso.geometry.dispose();
      head.geometry.dispose();
      if (gun) gun.geometry.dispose();
      flame.geometry.dispose();
      hitbox.geometry.dispose();
      nameSprite.userData.texture.dispose();
    },
  };
}
