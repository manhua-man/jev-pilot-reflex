import * as THREE from "three";
import {
  CANDIDATE_COUNT,
  VECTOR_STEPS,
  candidateName,
  vectorWeights,
} from "./planning.js";

function ribbon() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array((VECTOR_STEPS + 1) * 6),
      3,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  const progress = [],
    indices = [];
  for (let i = 0; i <= VECTOR_STEPS; i++)
    progress.push(i / VECTOR_STEPS, i / VECTOR_STEPS);
  geometry.setAttribute(
    "progress",
    new THREE.Float32BufferAttribute(progress, 1),
  );
  for (let i = 0; i < VECTOR_STEPS; i++) {
    const n = i * 2;
    indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
  }
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color("#007aff") },
      alpha: { value: 0.27 },
      time: { value: 0 },
      pulse: { value: 0 },
      ego: { value: new THREE.Vector3() },
      body: { value: new THREE.Vector2() },
    },
    vertexShader: `attribute float progress; varying float vProgress; varying vec2 vWorld; void main() { vProgress = progress; vWorld = (modelMatrix * vec4(position, 1.0)).xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 tint; uniform float alpha; uniform float time; uniform float pulse; uniform vec3 ego; uniform vec2 body; varying float vProgress; varying vec2 vWorld; void main() {
      vec2 delta = vWorld - ego.xy;
      float right = dot(delta, vec2(cos(ego.z), sin(ego.z)));
      float ahead = dot(delta, vec2(sin(ego.z), -cos(ego.z)));
      if (abs(right) < body.x && abs(ahead) < body.y) discard; float fade = (1.0 - smoothstep(0.72,1.0,vProgress)) * smoothstep(0.015,0.08,vProgress); float scan = 1.0 - pulse * (0.5 + 0.5 * sin(vProgress * 18.0 - time * 6.0)); gl_FragColor = vec4(tint, alpha * fade * scan);
      #include <colorspace_fragment>
    }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}
function updateRibbon(mesh, points, width, y) {
  const a = mesh.geometry.attributes.position;
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 1)],
      dx = after.x - before.x,
      dz = after.z - before.z,
      len = Math.hypot(dx, dz) || 1;
    a.setXYZ(
      i * 2,
      points[i].x - (dz / len) * width,
      y,
      points[i].z + (dx / len) * width,
    );
    a.setXYZ(
      i * 2 + 1,
      points[i].x + (dz / len) * width,
      y,
      points[i].z - (dx / len) * width,
    );
  }
  a.needsUpdate = true;
}
// Prepared once per batch. Rendering only interpolates these car-relative shapes.
function preparePaths(plan) {
  if (plan.displayPaths) return;
  const origin = plan.origin;
  const sin = Math.sin(origin.heading),
    cos = Math.cos(origin.heading);
  plan.displayPaths = Object.fromEntries(
    Object.entries(plan.projections).map(([id, path]) => {
      const direction = plan.vectors[id].velocity_mps < 0 ? -1 : 1;
      return [
        id,
        path.points.map((p) => {
          const x =
            p.x + Math.sin(p.heading) * (origin.depth / 2 + 0.2) * direction;
          const z =
            p.z - Math.cos(p.heading) * (origin.depth / 2 + 0.2) * direction;
          return {
            right: (x - origin.x) * cos + (z - origin.z) * sin,
            ahead: (x - origin.x) * sin - (z - origin.z) * cos,
          };
        }),
      ];
    }),
  );
}
function animatePath(car, candidate, target, animation, dt, paused) {
  const direction = candidate.velocity_mps < 0 ? -1 : 1;
  const blend = paused ? 0 : 1 - Math.exp(-Math.min(dt, 0.1) / 0.22);
  const previous = animation.direction === direction ? animation.points : null;
  animation.direction = direction;
  animation.points = target.map((p, i) => {
    const alpha = i === 0 || !previous ? 1 : blend;
    return {
      right: previous
        ? previous[i].right + (p.right - previous[i].right) * alpha
        : p.right,
      ahead: previous
        ? previous[i].ahead + (p.ahead - previous[i].ahead) * alpha
        : p.ahead,
    };
  });
  const sin = Math.sin(car.heading),
    cos = Math.cos(car.heading);
  return animation.points.map((p) => ({
    x: car.x + p.right * cos + p.ahead * sin,
    z: car.z + p.right * sin - p.ahead * cos,
  }));
}

export class RoadVectors {
  constructor(scene, layer) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.layer = layer;
    layer.hidden = true;
    layer.replaceChildren();
    this.enabled = true;
    this.showCandidates = false;
    this.items = new Map();
    this.pool = Array.from({ length: CANDIDATE_COUNT }, () => {
      const line = ribbon(),
        glow = ribbon();
      const label = document.createElement("span");
      label.className = "vector-label";
      label.hidden = true;
      layer.append(label);
      this.group.add(glow, line);
      return { line, glow, label, width: 0.055, opacity: 0.4, animation: {} };
    });
    this.selected = ribbon();
    this.selectedGlow = ribbon();
    this.group.add(this.selectedGlow, this.selected);
    this.clear();
  }
  setCandidates(plan) {
    preparePaths(plan);
    this.plan = plan;
    this.items = new Map(
      Object.keys(plan.vectors).map((id, i) => [id, this.pool[i]]),
    );
  }
  setAnswer(answer, plan) {
    this.setCandidates(plan);
    this.answer = answer;
    this.answeredPlan = plan;
    this.received = performance.now();
  }
  clear() {
    this.answer = null;
    this.plan = null;
    this.answeredPlan = null;
    this.received = 0;
    this.selectedAnimation = {};
    for (const item of this.pool) item.animation = {};
    this.group.visible = false;
    this.layer.hidden = true;
  }
  render(car, camera, width, height, dt, active, paused) {
    const age = paused ? 0 : performance.now() - this.received;
    const weights = active
      ? vectorWeights(this.answer, this.answeredPlan?.eligible, age)
      : null;
    const chosen = weights
      ? this.answeredPlan.projections[this.answer.choice]
      : null;
    const visible =
      (this.enabled && !!chosen) || (this.showCandidates && !!this.plan);
    this.group.visible = visible;
    this.layer.hidden = !visible;
    if (!visible) return;
    this.selected.visible = this.selectedGlow.visible =
      this.enabled && !!chosen;
    const plan = chosen ? this.answeredPlan : this.plan;
    for (const mesh of this.group.children) {
      mesh.material.uniforms.ego.value.set(car.x, car.z, car.heading);
      mesh.material.uniforms.body.value.set(
        car.width / 2 + 0.12,
        car.depth / 2 + 0.15,
      );
    }
    let selectedPoints = null;
    if (chosen && this.enabled) {
      const candidate = this.answeredPlan.vectors[this.answer.choice];
      const displayed = animatePath(
        car,
        candidate,
        this.answeredPlan.displayPaths[this.answer.choice],
        this.selectedAnimation,
        dt,
        paused,
      );
      selectedPoints = displayed;
      updateRibbon(this.selected, displayed, 0.2, 0.25);
      updateRibbon(this.selectedGlow, displayed, 0.5, 0.195);
      this.selected.material.uniforms.alpha.value = 0.9;
      this.selectedGlow.material.uniforms.alpha.value = 0.15;
      this.selected.renderOrder = 5;
    }
    for (const item of this.pool) {
      item.line.visible = item.glow.visible = false;
      item.label.hidden = true;
    }
    if (!this.showCandidates || !plan) return;
    // Stable spatial ordering keeps similar paths in the same animation slots
    // even though each candidate batch has new IDs and random values.
    const candidates = Object.entries(plan.vectors).sort(([, a], [, b]) => {
      const directionA = Math.sign(a.velocity_mps),
        directionB = Math.sign(b.velocity_mps);
      return (
        directionB - directionA ||
        a.steering * directionA - b.steering * directionB
      );
    });
    this.items = new Map(candidates.map(([id], i) => [id, this.pool[i]]));
    let index = 0;
    for (const [id, item] of this.items) {
      const candidate = plan.vectors[id];
      const selected = !!weights?.[id]?.selected;
      const animated = animatePath(
        car,
        candidate,
        plan.displayPaths[id],
        item.animation,
        dt,
        paused,
      );
      const points = selected && selectedPoints ? selectedPoints : animated;
      item.width = selected ? 0.2 : 0.055;
      item.line.visible = !selected || !this.enabled;
      updateRibbon(item.line, points, item.width, 0.22);
      item.line.material.uniforms.tint.value.set(
        candidate.collision_predicted
          ? "#e86940"
          : candidate.velocity_mps < 0
            ? "#9a6bff"
            : !candidate.stays_on_road || !candidate.stays_in_lane
              ? "#e6a34b"
              : candidate.steering < -0.02
                ? "#38bcd6"
                : "#48a5ff",
      );
      item.line.material.uniforms.alpha.value = candidate.collision_predicted
        ? 0.3
        : 0.65;
      const end =
        points[Math.floor(VECTOR_STEPS * (0.55 + (index % 4) * 0.12))];
      const screen = new THREE.Vector3(end.x, 0.7, end.z).project(camera);
      const probability = weights?.[id]?.probability;
      item.label.hidden =
        probability === undefined ||
        !candidate.velocity_mps ||
        screen.z > 1 ||
        screen.z < 0 ||
        Math.abs(screen.x) > 1 ||
        Math.abs(screen.y) > 1;
      item.label.dataset.vector = id;
      item.label.classList.toggle("selected", selected);
      index++;
      item.label.textContent =
        probability === undefined ? "" : `${Math.round(probability * 100)}%`;
      item.label.setAttribute(
        "aria-label",
        `${candidateName(candidate)}, ${Math.abs(candidate.velocity_mps).toFixed(1)} meters per second${selected ? ", selected" : ""}`,
      );
      item.label.style.opacity = selected ? "1" : "0.75";
      item.label.style.transform = `translate(${(screen.x * 0.5 + 0.5) * width}px,${(-0.5 * screen.y + 0.5) * height - (index % 3) * 17}px) translate(-50%,-50%)`;
    }
  }
}
