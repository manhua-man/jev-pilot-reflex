import * as THREE from "three";
import { rng } from "./math.js";
import { pbr, metricUV, materials } from "./materials.js";
import { renderProfile } from "./render-profile.js";

function leafTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d"),
    random = rng(812);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#544a2d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(250, 490);
  ctx.quadraticCurveTo(230, 280, 260, 30);
  ctx.stroke();
  for (let row = 0; row < 10; row++)
    for (const side of [-1, 1]) {
      const y = 58 + row * 39;
      ctx.save();
      ctx.translate(250 + side * (22 + random() * 48), y);
      ctx.rotate(side * (-0.8 + random() * 0.35));
      const width = 23 + random() * 12,
        length = 59 + random() * 30;
      const gradient = ctx.createLinearGradient(-width, 0, width, length);
      gradient.addColorStop(0, "#6b852b");
      gradient.addColorStop(0.5, "#466b23");
      gradient.addColorStop(1, "#203f18");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, -length / 2);
      ctx.bezierCurveTo(width, -length / 3, width, length / 4, 0, length / 2);
      ctx.bezierCurveTo(
        -width,
        length / 4,
        -width,
        -length / 3,
        0,
        -length / 2,
      );
      ctx.fill();
      ctx.strokeStyle = "#93a249a0";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -length / 2);
      ctx.lineTo(0, length / 2);
      ctx.stroke();
      for (let vein = -2; vein <= 2; vein++) {
        ctx.beginPath();
        ctx.moveTo(0, vein * 10);
        ctx.lineTo(width * 0.7, vein * 10 - 12);
        ctx.moveTo(0, vein * 10);
        ctx.lineTo(-width * 0.7, vein * 10 - 12);
        ctx.stroke();
      }
      ctx.restore();
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Vegetation {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.random = rng(world.seed + 983);
    this.wind = { value: 0 };
    this.leaves = new Map();
    this.treeCards = new Map();
    this.hiddenTrees = new Set();
    if (!materials.has("leaves")) {
      materials.set(
        "leaves",
        new THREE.MeshStandardMaterial({
          map: leafTexture(),
          alphaTest: 0.38,
          side: THREE.DoubleSide,
          roughness: 0.87,
          emissive: "#253613",
          emissiveIntensity: 0.13,
        }),
      );
    }
    // The wind uniform belongs to this world; shared materials receive the new one on rebuild.
    this.leafMaterial = materials.get("leaves");
    this.addWind(this.leafMaterial, 0.045);
    this.leafMaterial.needsUpdate = true;
  }
  addWind(material, strength) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.wind;
      shader.vertexShader =
        `uniform float windTime;\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float phase = instanceMatrix[3].x * 0.29 + instanceMatrix[3].z * 0.21;
        transformed.x += sin(windTime * 1.3 + phase + position.y * 2.0) * ${strength.toFixed(3)} * (position.y + 1.0);
        transformed.z += cos(windTime * 0.8 + phase) * ${(strength * 0.6).toFixed(3)};
        #endif`,
        );
    };
    material.customProgramCacheKey = () => `foliage-wind-${strength}`;
  }
  tree(parent, tree) {
    const r = this.random,
      height = tree.height * 1.25;
    const bark = pbr("bark", "#b8b0a0", 1.6);
    const branch = (a, b, radius) => {
      const direction = b.clone().sub(a);
      const geometry = new THREE.CylinderGeometry(
        radius * 0.4,
        radius,
        direction.length(),
        9,
      );
      metricUV(geometry, bark);
      const mesh = new THREE.Mesh(geometry, bark);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      );
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    };
    const origin = new THREE.Vector3(tree.x, 0, tree.z);
    branch(
      origin,
      origin.clone().add(new THREE.Vector3(0.15, height * 0.86, 0.12)),
      height * 0.031,
    );
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + r(),
        y = height * (0.28 + i * 0.048);
      branch(
        origin.clone().add(new THREE.Vector3(0, y, 0)),
        origin
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(a) * height * 0.23,
              y + height * 0.2,
              Math.sin(a) * height * 0.23,
            ),
          ),
        height * 0.012,
      );
    }
    const key = `${Math.floor(tree.x / 70)}:${Math.floor(tree.z / 70)}`;
    const leaves = this.leaves.get(key) || [];
    const pine = tree.kind === "pine";
    for (let i = 0; i < renderProfile.leafCards; i++) {
      const a = r() * Math.PI * 2,
        u = r();
      const radial =
        Math.sqrt(r()) *
        height *
        (pine ? (1 - u) * 0.29 : Math.sqrt(1 - (u * 2 - 1) ** 2) * 0.31);
      leaves.push({
        treeId: tree.id,
        x: tree.x + Math.cos(a) * radial,
        y: height * (0.42 + u * 0.58),
        z: tree.z + Math.sin(a) * radial,
        scale: height * (pine ? 0.2 : 0.24),
        rx: (r() - 0.5) * Math.PI,
        ry: r() * Math.PI,
        rz: r() * Math.PI,
        shade: pine ? 0.7 + r() * 0.22 : 0.82 + r() * 0.3,
      });
    }
    this.leaves.set(key, leaves);
  }
  finish() {
    const dummy = new THREE.Object3D(),
      color = new THREE.Color();
    for (const leaves of this.leaves.values()) {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        this.leafMaterial,
        leaves.length,
      );
      mesh.name = "leaf-canopy";
      leaves.forEach((leaf, i) => {
        dummy.position.set(leaf.x, leaf.y, leaf.z);
        dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz);
        dummy.scale.setScalar(leaf.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const cards = this.treeCards.get(leaf.treeId) || [];
        cards.push({ mesh, index: i, matrix: dummy.matrix.clone() });
        this.treeCards.set(leaf.treeId, cards);
        color.setRGB(leaf.shade, leaf.shade, leaf.shade * 0.9);
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: this.leafMaterial.map,
        alphaTest: 0.38,
        side: THREE.DoubleSide,
      });
      this.addWind(mesh.customDepthMaterial, 0.045);
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
    this.grass();
  }
  grass() {
    const r = this.random,
      locations = [];
    for (const parcel of this.world.objects.filter(
      (o) => o.type === "parcel",
    )) {
      for (let i = 0; i < (parcel.park ? 600 : 200); i++) {
        const x = parcel.x + (r() - 0.5) * (parcel.width - 2),
          z = parcel.z + (r() - 0.5) * (parcel.depth - 2);
        if (
          parcel.park &&
          (Math.abs(x - parcel.x) < 1.3 || Math.abs(z - parcel.z) < 1.3)
        )
          continue;
        if (
          this.world.objects.some(
            (o) =>
              o.type === "building" &&
              Math.abs(x - o.x) < o.width / 2 + 1 &&
              Math.abs(z - o.z) < o.depth / 2 + 1,
          )
        )
          continue;
        locations.push({ x, z });
      }
    }
    if (this.world.type === "highway") {
      for (const tree of this.world.objects.filter((o) => o.type === "tree"))
        for (let i = 0; i < 24; i++)
          locations.push({
            x: tree.x + (r() - 0.5) * 8,
            z: tree.z + (r() - 0.5) * 8,
          });
    }
    const verts = [],
      normals = [];
    for (let blade = 0; blade < 5; blade++) {
      const x = (r() - 0.5) * 0.45,
        z = (r() - 0.5) * 0.45,
        height = 0.18 + r() * 0.28;
      verts.push(x - 0.035, 0, z, x + 0.035, 0, z, x + 0.12, height, z + 0.08);
      normals.push(0, 0.7, 0.7, 0, 0.7, 0.7, 0, 0.7, 0.7);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(verts, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    const material = new THREE.MeshStandardMaterial({
      color: "#586537",
      roughness: 1,
      side: THREE.DoubleSide,
    });
    this.addWind(material, 0.025);
    const mesh = new THREE.InstancedMesh(geometry, material, locations.length),
      dummy = new THREE.Object3D();
    locations.forEach((p, i) => {
      dummy.position.set(p.x, 0.1, p.z);
      dummy.rotation.y = r() * Math.PI;
      dummy.scale.setScalar(0.6 + r() * 0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.name = "grass-blades";
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
  }
  hideTrees(ids) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const id of new Set([...this.hiddenTrees, ...ids])) {
      if (this.hiddenTrees.has(id) === ids.has(id)) continue;
      for (const card of this.treeCards.get(id) || []) {
        card.mesh.setMatrixAt(
          card.index,
          ids.has(id) && card.index % 3 !== 0 ? zero : card.matrix,
        );
        card.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.hiddenTrees = ids;
  }
  update(time) {
    this.wind.value = time;
  }
}
