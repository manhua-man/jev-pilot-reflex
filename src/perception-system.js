import * as THREE from "three";
import { getContinuousAlpineHeight } from "./alpine-world.js";

/**
 * PerceptionSystem - Autonomous Driving 3D Sensor & Object Detection Visualizer
 * Renders:
 * 1. Ego Forward Sensor Perception Arc (130° FOV radar/lidar/vision field with distance rings)
 * 2. 3D Bounding Boxes for traffic vehicles, trucks, and pedestrians
 * 3. Overhead HUD telemetry badges showing object type, distance, velocity, and tracking status
 */
export class PerceptionSystem {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.group = new THREE.Group();
    this.group.name = "PerceptionSystemVisuals";
    this.scene.add(this.group);

    // 1. Ego Sensor Perception Frustum Arc (130° FOV, 35m-48m reach)
    this.sensorArc = this.createSensorArc();
    this.group.add(this.sensorArc);

    // 2. Object Pool for 3D Bounding Boxes and Floating HUD Badges
    this.maxTracked = 24;
    this.boxPool = [];
    this.initPool();

    this.lastBadgeUpdate = 0;
  }

  createSensorArc() {
    const segments = 32;
    const fovRad = (130 * Math.PI) / 180;
    const halfFov = fovRad / 2;
    const radius = 38.0;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((segments + 2) * 3);
    const uvs = new Float32Array((segments + 2) * 2);
    const indices = [];

    // Vertex 0: Apex at car front bumper
    positions[0] = 0;
    positions[1] = 0.04;
    positions[2] = 0;
    uvs[0] = 0.5;
    uvs[1] = 0;

    for (let i = 0; i <= segments; i++) {
      const angle = -halfFov + (i / segments) * fovRad;
      const x = Math.sin(angle) * radius;
      const z = -Math.cos(angle) * radius;

      const idx = (i + 1) * 3;
      positions[idx] = x;
      positions[idx + 1] = 0.04;
      positions[idx + 2] = z;

      const uvIdx = (i + 1) * 2;
      uvs[uvIdx] = i / segments;
      uvs[uvIdx + 1] = 1.0;

      if (i < segments) {
        indices.push(0, i + 1, i + 2);
      }
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        baseColor: { value: new THREE.Color("#00f0ff") },
        pulseColor: { value: new THREE.Color("#10b981") },
        dangerColor: { value: new THREE.Color("#ef4444") },
        isEmergency: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 baseColor;
        uniform vec3 pulseColor;
        uniform vec3 dangerColor;
        uniform float isEmergency;
        varying vec2 vUv;
        varying vec3 vPos;

        void main() {
          float dist = length(vPos.xz);
          float normDist = dist / 38.0;

          // Radial fading
          float alpha = (1.0 - smoothstep(0.6, 1.0, normDist)) * 0.16;

          // Range rings every 10m
          float ring1 = smoothstep(0.02, 0.0, abs(dist - 10.0));
          float ring2 = smoothstep(0.02, 0.0, abs(dist - 20.0));
          float ring3 = smoothstep(0.02, 0.0, abs(dist - 30.0));
          float rings = (ring1 + ring2 + ring3) * 0.35;

          // Scanning sweep pulse forward
          float sweep = sin(dist * 0.8 - time * 6.0) * 0.5 + 0.5;
          sweep = pow(sweep, 3.0) * 0.18;

          vec3 color = mix(baseColor, pulseColor, sweep);
          if (isEmergency > 0.5) {
            float blink = sin(time * 15.0) * 0.5 + 0.5;
            color = mix(dangerColor, vec3(1.0, 0.2, 0.2), blink);
            alpha = alpha * 1.8 + blink * 0.15;
          }

          gl_FragColor = vec4(color, alpha + rings);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    return mesh;
  }

  initPool() {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);

    for (let i = 0; i < this.maxTracked; i++) {
      // 3D Corner/Wireframe Box
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85,
        linewidth: 2,
        toneMapped: false,
      });
      const boxLines = new THREE.LineSegments(edgesGeo, lineMat);
      boxLines.renderOrder = 6;
      boxLines.visible = false;

      // Inner faint volume glow
      const volumeMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const volumeMesh = new THREE.Mesh(boxGeo, volumeMat);
      boxLines.add(volumeMesh);

      // Overhead HUD Badge Sprite
      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(3.8, 0.95, 1);
      sprite.renderOrder = 10;
      sprite.visible = false;

      this.group.add(boxLines);
      this.group.add(sprite);

      this.boxPool.push({
        boxLines,
        volumeMesh,
        lineMat,
        volumeMat,
        sprite,
        spriteMat,
        canvas,
        ctx,
        texture,
        lastText: "",
        lastColor: "",
        active: false,
      });
    }
  }

  updateBadge(item, title, sub, colorHex) {
    if (item.lastText === title && item.lastColor === colorHex) return;
    item.lastText = title;
    item.lastColor = colorHex;

    const ctx = item.ctx;
    const w = item.canvas.width;
    const h = item.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Frosted dark tech pill background
    ctx.fillStyle = "rgba(10, 16, 26, 0.88)";
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, h - 12, 16);
    ctx.fill();
    ctx.stroke();

    // Top title line
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, w / 2, 34);

    // Bottom telemetry status line
    ctx.fillStyle = colorHex;
    ctx.font = "600 20px monospace, sans-serif";
    ctx.fillText(sub, w / 2, 68);

    item.texture.needsUpdate = true;
  }

  update(dt) {
    const v = this.sim.player;
    if (!v) return;

    const isAlpine = this.sim.world.type === "alpine";
    const now = performance.now();

    // Update Ego Sensor Perception Frustum Arc
    if (this.sensorArc) {
      let py = 0.04;
      if (isAlpine) {
        py = getContinuousAlpineHeight(v.x, v.z, this.sim.world) + 0.04;
        this.sensorArc.scale.set(0.24, 0.24, 0.24);
      } else {
        this.sensorArc.scale.set(1.0, 1.0, 1.0);
      }
      this.sensorArc.position.set(v.x, py, v.z);
      this.sensorArc.rotation.y = -v.heading;

      this.sensorArc.material.uniforms.time.value = this.sim.time;
      this.sensorArc.material.uniforms.isEmergency.value =
        this.sim.aebActive || (this.sim.aebTTC && this.sim.aebTTC < 1.4) ? 1.0 : 0.0;
    }

    // Collect all dynamic targets within 65m perception range
    const targets = [];

    // 1. Pedestrians
    for (const p of this.sim.pedestrians) {
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < 55) {
        targets.push({
          type: "pedestrian",
          obj: p,
          dist: d,
          width: 0.7,
          height: 1.8,
          depth: 0.7,
          isJaywalker: p.isJaywalker,
        });
      }
    }

    // 2. Traffic Vehicles
    for (const car of this.sim.traffic) {
      const d = Math.hypot(car.x - v.x, car.z - v.z);
      if (d < 55) {
        const isTruck = car.subtype === "truck";
        const isBus = car.subtype === "bus";
        targets.push({
          type: isTruck ? "truck" : isBus ? "bus" : "car",
          obj: car,
          dist: d,
          width: isTruck ? 2.6 : 1.9,
          height: isTruck ? 3.4 : 1.5,
          depth: isTruck ? 12.0 : 4.4,
          speed: car.speed || 0,
        });
      }
    }

    // 3. Multi-Agent Game Theory Vehicles
    if (this.sim.gameManager?.agents) {
      for (const a of this.sim.gameManager.agents) {
        const d = Math.hypot(a.x - v.x, a.z - v.z);
        if (d < 55) {
          const isTruck = a.role === "truck";
          targets.push({
            type: isTruck ? "truck" : "car",
            obj: a,
            dist: d,
            width: isTruck ? 2.6 : 1.9,
            height: isTruck ? 3.4 : 1.5,
            depth: isTruck ? 14.0 : 4.4,
            speed: a.speed || 0,
            role: a.role,
            statusText: a.statusText,
          });
        }
      }
    }

    // Sort by proximity
    targets.sort((a, b) => a.dist - b.dist);

    // Update Box Pool
    const scaleFactor = isAlpine ? 0.24 : 1.0;
    const activeCount = Math.min(targets.length, this.maxTracked);

    for (let i = 0; i < this.maxTracked; i++) {
      const poolItem = this.boxPool[i];
      if (i < activeCount) {
        const t = targets[i];
        const obj = t.obj;

        poolItem.boxLines.visible = true;
        poolItem.sprite.visible = true;

        let py = 0;
        if (isAlpine) {
          py = getContinuousAlpineHeight(obj.x, obj.z, this.sim.world);
        }

        const bw = t.width * scaleFactor;
        const bh = t.height * scaleFactor;
        const bd = t.depth * scaleFactor;

        // Position 3D bounding box
        poolItem.boxLines.position.set(obj.x, py + bh / 2, obj.z);
        poolItem.boxLines.rotation.y = -(obj.heading || 0);
        poolItem.boxLines.scale.set(bw, bh, bd);

        // Position overhead HUD badge
        const badgeY = py + bh + (isAlpine ? 0.45 : 1.15);
        poolItem.sprite.position.set(obj.x, badgeY, obj.z);
        poolItem.sprite.scale.set(isAlpine ? 1.6 : 3.8, isAlpine ? 0.4 : 0.95, 1);

        // Determine Risk / Status Color
        let colorHex = "#06b6d4"; // Cyan: normal tracked
        let statusLabel = `${Math.round((t.speed || 0) * 3.6)} km/h · 稳定循迹`;

        if (t.isJaywalker) {
          colorHex = "#ef4444";
          statusLabel = "🚨 鬼探头横穿 · AEB干预";
        } else if (t.role === "cut_in") {
          colorHex = "#f59e0b";
          statusLabel = "⚠️ 激进加塞 · 纳什博弈减速";
        } else if (t.role === "zipper_r1") {
          colorHex = "#10b981";
          statusLabel = "🤝 拉链式交替 · 礼让先行";
        } else if (t.role === "truck") {
          colorHex = "#f97316";
          statusLabel = "🚚 重卡遮挡 · 盲区微偏探头";
        } else if (t.dist < 8.0) {
          colorHex = "#f59e0b";
          statusLabel = `${Math.round((t.speed || 0) * 3.6)} km/h · 近距防碰`;
        }

        poolItem.lineMat.color.set(colorHex);
        poolItem.volumeMat.color.set(colorHex);

        const typeName =
          t.type === "pedestrian"
            ? "🚶 行人"
            : t.type === "truck"
            ? "🚚 重卡"
            : t.type === "bus"
            ? "🚌 巴士"
            : "🚗 车辆";

        const titleText = `${typeName} · ${t.dist.toFixed(1)}m`;
        this.updateBadge(poolItem, titleText, statusLabel, colorHex);
      } else {
        poolItem.boxLines.visible = false;
        poolItem.sprite.visible = false;
      }
    }
  }

  dispose() {
    this.boxPool.forEach((item) => {
      item.boxLines.geometry.dispose();
      item.lineMat.dispose();
      item.volumeMat.dispose();
      item.spriteMat.dispose();
      item.texture.dispose();
    });
    this.boxPool = [];
    if (this.sensorArc) {
      this.sensorArc.geometry.dispose();
      this.sensorArc.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
