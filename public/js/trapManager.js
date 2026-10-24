import * as THREE from 'three';

export class TrapManager {
  constructor(scene, network, localPlayerId) {
    this.scene = scene;
    this.network = network;
    this.localPlayerId = localPlayerId;
    this.traps = new Map();
  }

  createTrapMesh(trapData) {
    const group = new THREE.Group();
    group.position.set(
      trapData.position.x,
      trapData.position.y || 0,
      trapData.position.z
    );
    group.userData = {
      id: trapData.id,
      type: trapData.trapType,
      ownerId: trapData.ownerId,
    };

    if (trapData.trapType === 'MINE') {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, 0.15, 16),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 })
      );
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      light.position.y = 0.1;
      group.add(base, light);
    } else if (trapData.trapType === 'BEAR_TRAP') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.6, 0.08, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.9, roughness: 0.2 })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else if (trapData.trapType === 'LASER') {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.8, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      const laser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 4),
        new THREE.MeshBasicMaterial({ color: 0xff0033, transparent: true, opacity: 0.7 })
      );
      laser.rotation.z = Math.PI / 2;
      laser.position.x = 2;
      group.add(post, laser);
    } else {
      group.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) material.dispose();
        } else {
          object.material?.dispose();
        }
      });
      return null;
    }

    return group;
  }

  addTrap(trapData) {
    if (this.traps.has(trapData.id)) return;
    const group = this.createTrapMesh(trapData);
    if (!group) return;
    this.scene.add(group);
    this.traps.set(trapData.id, group);
  }

  placeTrap(trapType) {
    this.network.sendPlaceTrap(trapType);
  }

  getOwnedTrapCount() {
    let count = 0;
    for (const group of this.traps.values()) {
      if (group.userData.ownerId === this.localPlayerId) count += 1;
    }
    return count;
  }

  removeTrap(trapId) {
    const group = this.traps.get(trapId);
    if (!group) return null;

    this.scene.remove(group);
    group.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) {
        for (const material of object.material) material.dispose();
      } else {
        object.material?.dispose();
      }
    });
    this.traps.delete(trapId);
    return group;
  }

  dispose() {
    for (const trapId of this.traps.keys()) this.removeTrap(trapId);
  }
}
