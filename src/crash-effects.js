import * as THREE from "three";
import { clamp, rng } from "./math.js";

export class CrashEffects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "impact-effects";
    scene.add(this.group);
    this.age = 0;
    this.crash = null;
    this.fragments = [];
    this.smoke = [];
    this.actors = [];
  }
  crumple(model, point, severity) {
    model.updateMatrixWorld(true);
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const local = mesh.worldToLocal(new THREE.Vector3(point.x, 0.8, point.z));
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(positions, i);
        const influence = Math.max(0, 1 - vertex.distanceTo(local) / 2.2);
        if (!influence) continue;
        vertex.x *= 1 - influence * 0.22 * severity;
        vertex.z *= 1 - influence * 0.37 * severity;
        vertex.y +=
          Math.sin(vertex.x * 14 + vertex.z * 9) * influence * 0.19 * severity;
        positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      positions.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    });
  }
  start(crash, player, target, targetObject) {
    this.crash = crash;
    const random = rng(Math.round(crash.time_s * 1000) + 79);
    const severity = clamp(crash.impact_speed_mps / 18, 0.3, 1.5);
    this.crumple(player, crash.point, severity);
    if (target && crash.type !== "pedestrian")
      this.crumple(target, crash.point, severity);
    if (target)
      this.actors.push({
        model: target,
        position: target.position.clone(),
        rotation: target.rotation.clone(),
        fall: crash.type === "pedestrian" || crash.type === "motorcycle",
        distance: Math.min(crash.type === "pedestrian" ? 1.5 : 0.9, severity),
      });
    const colors = ["#43484e", "#8ba0ae", "#b7bdc5", "#e1e3e4"];
    if (crash.type === "building")
      colors.push(targetObject.color || "#b2a599", "#918579");
    for (let i = 0; i < 24 + Math.floor(severity * 20); i++) {
      const size = 0.04 + random() * 0.16;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * 2, size, size * 1.3),
        new THREE.MeshStandardMaterial({
          color: colors[i % colors.length],
          roughness: 0.65,
          metalness: i % 3 ? 0.3 : 0,
        }),
      );
      mesh.position.set(crash.point.x, 0.55 + random() * 0.8, crash.point.z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.fragments.push({
        mesh,
        velocity: new THREE.Vector3(
          (random() - 0.5) * 6 * severity + crash.normal.x * 2,
          1.5 + random() * 4 * severity,
          (random() - 0.5) * 6 * severity + crash.normal.z * 2,
        ),
        spin: new THREE.Vector3(random() * 9, random() * 9, random() * 9),
      });
    }
    // A localized broken masonry scar; keep the rest of the building standing.
    if (crash.type === "building") {
      const scar = new THREE.Mesh(
        new THREE.CircleGeometry(1.1 * severity, 9),
        new THREE.MeshStandardMaterial({
          color: "#3d3833",
          roughness: 1,
          side: THREE.DoubleSide,
        }),
      );
      scar.position.set(
        crash.point.x + crash.normal.x * 0.025,
        0.9,
        crash.point.z + crash.normal.z * 0.025,
      );
      scar.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(crash.normal.x, 0, crash.normal.z).normalize(),
      );
      this.group.add(scar);
      for (let i = 0; i < 9; i++) {
        const a = (i * Math.PI * 2) / 9;
        const crack = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 1.2 + random(), 0.02),
          new THREE.MeshBasicMaterial({ color: "#50483f" }),
        );
        crack.position.set(Math.cos(a) * 1.1, Math.sin(a) * 0.7, 0.01);
        crack.rotation.z = a - Math.PI / 2;
        scar.add(crack);
      }
    }
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 2),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? "#889097" : "#b4b5b5",
          transparent: true,
          opacity: 0,
          depthWrite: false,
          roughness: 1,
        }),
      );
      this.group.add(mesh);
      this.smoke.push({ mesh, phase: i / 12, drift: random() - 0.5 });
    }
  }
  update(dt) {
    if (!this.crash) return;
    this.age += dt;
    for (const part of this.fragments) {
      if (part.mesh.position.y <= 0.12 && part.velocity.lengthSq() < 0.08)
        continue;
      part.velocity.y -= dt * 9.8;
      part.mesh.position.addScaledVector(part.velocity, dt);
      part.mesh.rotation.x += part.spin.x * dt;
      part.mesh.rotation.z += part.spin.z * dt;
      if (part.mesh.position.y < 0.12) {
        part.mesh.position.y = 0.12;
        part.velocity.y = Math.abs(part.velocity.y) * 0.22;
        part.velocity.x *= 0.65;
        part.velocity.z *= 0.65;
        part.spin.multiplyScalar(0.5);
      }
    }
    const settle = 1 - Math.exp(-this.age * 4);
    for (const actor of this.actors) {
      actor.model.position
        .copy(actor.position)
        .add(
          new THREE.Vector3(
            -this.crash.normal.x,
            0,
            -this.crash.normal.z,
          ).multiplyScalar(settle * actor.distance),
        );
      actor.model.rotation.copy(actor.rotation);
      actor.model.rotation.z += settle * (actor.fall ? 1.45 : 0.045);
      actor.model.rotation.y += settle * (actor.fall ? 0.15 : 0.12);
      if (actor.fall) actor.model.position.y = 0.25 * settle;
    }
    for (const puff of this.smoke) {
      const cycle = (this.age * 0.3 + puff.phase) % 1;
      puff.mesh.position.set(
        this.crash.point.x + cycle * (0.6 + puff.drift),
        0.7 + cycle * 4,
        this.crash.point.z + cycle * 0.5,
      );
      puff.mesh.scale.setScalar(0.25 + cycle * 1.6);
      puff.mesh.material.opacity =
        Math.sin(cycle * Math.PI) * 0.12 * Math.min(this.age, 1);
    }
  }
}
