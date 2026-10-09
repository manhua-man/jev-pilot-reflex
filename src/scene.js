import * as THREE from "three";
if (typeof window !== "undefined") window.THREE = THREE;
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { signalState } from "./world.js";
import { RoadVectors } from "./road-vectors.js";
import { CrashEffects } from "./crash-effects.js";
import { dist, heading, move } from "./math.js";
import {
  materials as M,
  material as mat,
  pbr,
  physical,
  metricUV,
} from "./materials.js";
import { CameraInput } from "./camera-input.js";
import { SceneryAssets } from "./scenery-assets.js";
import { Vegetation } from "./vegetation.js";
import { loadHeroCar, updateHeroWheels } from "./model-assets.js";
import {
  detailedCar,
  detailedHeavyTruck,
  detailedAlpineSUV,
  detailedAlpineLoggingTruck,
  detailedAlpineBus,
} from "./vehicle-model.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { assetManager, assetsReady } from "./asset-loading.js";
import { renderProfile } from "./render-profile.js";
import {
  SeasonController,
  ProceduralSky,
  SeasonalParticles,
  U,
} from "./seasons-environment.js";
import {
  buildCityRoadNetwork,
  buildHighwayRoadNetwork,
} from "./road-renderer.js";
import { AlpinePassage, getContinuousAlpineHeight, CAR_SHARED } from "./alpine-world.js";
let daylight;
function daylightEnvironment() {
  return (daylight ||= new HDRLoader(assetManager)
    .loadAsync(`${import.meta.env.BASE_URL || "./"}textures/daylight.hdr`)
    .then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      return texture;
    }));
}
function box(parent, w, h, d, x, y, z, color, rotation = 0) {
  const m = new THREE.Mesh(
    metricUV(new THREE.BoxGeometry(w, h, d), mat(color)),
    mat(color),
  );
  m.position.set(x, y, z);
  m.rotation.y = rotation;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cone(parent, r, h, x, y, z, color, segments = 5) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, segments), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function sphere(parent, r, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function cyl(parent, r, h, x, y, z, color, segments = 8) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, segments),
    mat(color),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function label(text, bg = "#f2eee4", fg = "#304c46", w = 128, h = 64) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `bold ${h * 0.49}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
  return new THREE.CanvasTexture(c);
}
function interstateGuide({ text, detail, direction = "straight" }) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#126b48";
  ctx.fillRect(0, 0, 768, 384);
  ctx.strokeStyle = "#fffef3";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(13, 13, 742, 358, 14);
  ctx.stroke();
  // A red-and-blue interstate shield, separate from the destination legend.
  const shield = new Path2D();
  shield.moveTo(52, 78);
  shield.quadraticCurveTo(133, 53, 214, 78);
  shield.lineTo(209, 184);
  shield.bezierCurveTo(203, 218, 159, 247, 133, 257);
  shield.bezierCurveTo(107, 247, 63, 218, 57, 184);
  shield.closePath();
  ctx.fillStyle = "#17468c";
  ctx.fill(shield);
  ctx.save();
  ctx.clip(shield);
  ctx.fillStyle = "#bd2637";
  ctx.fillRect(40, 50, 190, 68);
  ctx.restore();
  ctx.stroke(shield);
  ctx.beginPath();
  ctx.moveTo(54, 118);
  ctx.lineTo(212, 118);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#fffef3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("INTERSTATE", 133, 96);
  ctx.font = "bold 86px sans-serif";
  ctx.fillText("08", 133, 179);
  ctx.textAlign = "left";
  ctx.font = "bold 37px sans-serif";
  ctx.fillText("NORTH", 263, 88);
  ctx.font = "bold 39px sans-serif";
  ctx.fillText(text || "Cedar Town", 263, 151, 348);
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(detail || "INTERSTATE 08", 52, 319, 660);
  ctx.save();
  ctx.translate(668, 168);
  ctx.rotate(
    direction === "left"
      ? -Math.PI / 2
      : direction === "right"
        ? Math.PI / 2
        : 0,
  );
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.lineTo(-34, -12);
  ctx.lineTo(-13, -12);
  ctx.lineTo(-13, 44);
  ctx.lineTo(13, 44);
  ctx.lineTo(13, -12);
  ctx.lineTo(34, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function forkGuideSign({ main, sub, arrow = "left", detail = "KEEP LANE · 保持车道" }) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#15803d";
  ctx.fillRect(0, 0, 800, 400);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(16, 16, 768, 368, 16);
  ctx.stroke();

  // Top header bar
  ctx.fillStyle = "#166534";
  ctx.fillRect(20, 20, 760, 60);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("FORK JUNCTION · 分岔路口", 40, 50);

  // Main English text
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(main || "EXPRESSWAY", 40, 135);

  // Chinese subtitle
  ctx.fillStyle = "#facc15";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText(sub || "快速路 · 机场", 40, 210);

  // Detail / instruction
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(detail || "CHOOSE LANE · 提前减速变道", 40, 315);

  // Directional arrow
  ctx.save();
  ctx.translate(680, 200);
  ctx.rotate(arrow === "left" ? -Math.PI / 4 : Math.PI / 4);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(0, -65);
  ctx.lineTo(-42, -15);
  ctx.lineTo(-16, -15);
  ctx.lineTo(-16, 55);
  ctx.lineTo(16, 55);
  ctx.lineTo(16, -15);
  ctx.lineTo(42, -15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function zipperGuideSign({ main, sub, detail = "NASH COOPERATION · 1:1 交替通行 · 一车一让" }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#15803d"; // Highway green
  ctx.fillRect(0, 0, 1000, 360);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(16, 16, 968, 328, 16);
  ctx.stroke();

  // Top header band
  ctx.fillStyle = "#166534";
  ctx.fillRect(20, 20, 960, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("HIGHWAY MERGE ZONE · 高速匝道交织合流管控区", 40, 48);

  // Zipper Emblem ⫰
  ctx.font = "bold 64px sans-serif";
  ctx.fillStyle = "#facc15";
  ctx.fillText("⫰", 45, 145);

  // Main Title
  ctx.font = "bold 44px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(main || "ON-RAMP ZIPPER MERGE ⫰", 125, 130);

  // Subtitle
  ctx.font = "bold 38px sans-serif";
  ctx.fillStyle = "#facc15";
  ctx.fillText(sub || "高架匝道合流口 · 1:1 交替通行", 125, 195);

  // Detail instruction
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(detail, 125, 280);

  // Converging arrows on the right
  ctx.save();
  ctx.translate(880, 185);
  ctx.fillStyle = "#ffffff";
  // Mainline straight arrow
  ctx.fillRect(-35, -45, 14, 90);
  ctx.beginPath();
  ctx.moveTo(-45, -45);
  ctx.lineTo(-28, -68);
  ctx.lineTo(-11, -45);
  ctx.fill();
  // Ramp merging angled arrow
  ctx.beginPath();
  ctx.moveTo(35, 45);
  ctx.lineTo(22, 45);
  ctx.lineTo(-8, -15);
  ctx.lineTo(-8, -35);
  ctx.lineTo(8, -8);
  ctx.lineTo(35, 30);
  ctx.fill();
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hazardSignTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0284c7";
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 236);

  ctx.fillStyle = "#ffffff";
  for (const [cx, dir] of [[150, -1], [362, 1]]) {
    ctx.save();
    ctx.translate(cx, 128);
    for (const offset of [-40, 20]) {
      ctx.beginPath();
      ctx.moveTo(offset * dir, -70);
      ctx.lineTo((offset + 35) * dir, 0);
      ctx.lineTo(offset * dir, 70);
      ctx.lineTo((offset - 25) * dir, 70);
      ctx.lineTo((offset + 10) * dir, 0);
      ctx.lineTo((offset - 25) * dir, -70);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBadgeTexture(text, role) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const borderColor =
    role === "truck" || role === "construction"
      ? "#f97316"
      : role === "roundabout"
      ? "#3b82f6"
      : role === "cut_in" || role === "zipper_r2"
      ? "#f59e0b"
      : role === "overtake" || role === "truck_oncoming"
      ? "#06b6d4"
      : role === "zipper_r1" || role === "zipper"
      ? "#10b981"
      : "#a855f7";

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(8, 8, 368, 80, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 192, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, canvas, ctx, lastText: text };
}

function updateBadgeTexture(badgeObj, text, role) {
  if (badgeObj.lastText === text) return;
  badgeObj.lastText = text;
  const ctx = badgeObj.ctx;
  const borderColor =
    role === "truck"
      ? "#f97316"
      : role === "cut_in" || role === "zipper_r2"
      ? "#f59e0b"
      : role === "overtake" || role === "truck_oncoming"
      ? "#06b6d4"
      : role === "zipper_r1" || role === "zipper"
      ? "#10b981"
      : "#a855f7";

  ctx.clearRect(0, 0, 384, 96);
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(8, 8, 368, 80, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 192, 48);
  badgeObj.texture.needsUpdate = true;
}
function mergeModel(group) {
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const a = batches.get(o.material) || [];
    a.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    batches.set(o.material, a);
    o.geometry.dispose();
  });
  group.clear();
  for (const [material, geoms] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geoms.forEach((g) => g.dispose());
  }
  return group;
}
function keepCameraOutsideBuildings(position, anchor, buildings) {
  const direction = position.clone().sub(anchor),
    length = direction.length();
  if (length < 0.01) return;
  direction.divideScalar(length);
  let distance = length;
  const ray = new THREE.Ray(),
    box = new THREE.Box3(),
    hit = new THREE.Vector3();
  for (const building of buildings) {
    if (
      building.type !== "building" ||
      Math.hypot(building.x - anchor.x, building.z - anchor.z) >
        length + Math.hypot(building.width, building.depth)
    )
      continue;
    const rotation = -(building.rotation || 0);
    ray.origin
      .set(anchor.x - building.x, anchor.y, anchor.z - building.z)
      .applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotation);
    ray.direction
      .copy(direction)
      .applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotation);
    box.min.set(-building.width / 2 - 0.25, 0, -building.depth / 2 - 0.25);
    box.max.set(
      building.width / 2 + 0.25,
      building.height + 2,
      building.depth / 2 + 0.25,
    );
    if (!box.containsPoint(ray.origin) && ray.intersectBox(box, hit))
      distance = Math.min(
        distance,
        Math.max(0.5, hit.distanceTo(ray.origin) - 0.45),
      );
  }
  position.copy(anchor).addScaledVector(direction, distance);
}
export const carModel = detailedCar;
export function personModel(o) {
  const g = new THREE.Group(),
    body = new THREE.Group();
  const color = ["#c27d55", "#8d9cab", "#dec060", "#548975"][
    Number(o.id.split("-").at(-1)) % 4
  ];
  const capsule = (parent, radius, length, x, y, z, color) => {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, length, 4, 8),
      mat(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const torso = capsule(body, 0.21, 0.28, 0, 1.09, 0, color);
  torso.scale.z = 0.62;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 10),
    mat("#be9578"),
  );
  head.position.set(0, 1.57, -0.015);
  head.scale.set(0.9, 1.1, 0.95);
  head.castShadow = true;
  body.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.181, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    mat("#3b2c23"),
  );
  hair.position.set(0, 1.61, 0);
  body.add(hair);
  capsule(body, 0.065, 0.08, 0, 1.38, 0, "#be9578");
  for (const x of [-0.058, 0.058])
    box(body, 0.025, 0.019, 0.018, x, 1.6, -0.17, "#28201e");
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 6, 6),
    mat("#b8886d"),
  );
  nose.position.set(0, 1.55, -0.182);
  body.add(nose);
  g.add(mergeModel(body));
  const legs = [],
    arms = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.12, 0.77, 0);
    capsule(leg, 0.08, 0.48, 0, -0.3, 0, "#323c4c");
    box(leg, 0.17, 0.12, 0.28, 0, -0.61, -0.055, "#293936");
    g.add(leg);
    legs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.3, 1.31, 0);
    capsule(arm, 0.071, 0.37, 0, -0.24, 0, color);
    capsule(arm, 0.055, 0.07, 0, -0.51, 0, "#be9578");
    g.add(arm);
    arms.push(arm);
  }
  g.userData.limbs = { legs, arms };
  return g;
}

const smoothCurve = (x, min, max) => {
  const t = Math.max(0, Math.min(1, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
};

export class DriveScene {
  constructor(canvas, sim, vectorLayer) {
    this.vectorLayer = vectorLayer;
    this.canvas = canvas;
    this.sim = sim;
    this.mode = "chase";
    this.cameraInput = new CameraInput(canvas, () => this.mode);
    this.showSensors = false;
    this._sunTargetPos = new THREE.Vector3();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: renderProfile.antialias,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, renderProfile.pixelRatio),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1200);
    this.viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.viewport = entry.contentRect;
    });
    this.resizeObserver.observe(canvas);
    this.build();
  }
  build() {
    if (this.alpinePassage) {
      this.alpinePassage.dispose();
      this.alpinePassage = null;
    }
    if (this.scenery) this.scenery.active = false;
    if (this.scene)
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
        o.customDepthMaterial?.dispose();
        if (o.material && ![...M.values()].includes(o.material)) {
          o.material.map?.dispose();
          o.material.dispose();
        }
        o.shadow?.dispose();
      });
    this.scene = new THREE.Scene();
    const builtScene = this.scene;
    const environmentReady = daylightEnvironment()
      .then((texture) => {
        if (this.scene !== builtScene) return;
        this.daylightTexture = texture;
        builtScene.environment = texture;
        builtScene.environmentIntensity = 0.45;
      })
      .catch((error) =>
        console.warn("Daylight environment unavailable", error),
      );
    this.glowMaterials = [];
    this.seasons = new SeasonController(1, 0); // Summer · Golden Sunset (iconic Four-Seasons diorama look)
    this.sky = new ProceduralSky(this.scene);
    this.weatherParticles = new SeasonalParticles(this.scene);

    this.weatherMode = "clear";
    const FOG_BASE_DENSITY = 0.017;
    this.scene.fog = new THREE.FogExp2(0x263b42, FOG_BASE_DENSITY);
    U.uFogColor.value = this.scene.fog.color;
    this.hemiLight = new THREE.HemisphereLight("#cfe4ff", "#4d5a3c", 0.85);
    this.scene.add(this.hemiLight);
    this.sun = new THREE.DirectionalLight("#fff5e8", 2.0);
    this.sun.position.set(-60, 110, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      renderProfile.shadowSize,
      renderProfile.shadowSize,
    );
    Object.assign(this.sun.shadow.camera, {
      left: -32,
      right: 32,
      top: 32,
      bottom: -32,
      near: 4,
      far: 95,
    });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Initialize Four-Seasons Post-Processing Pipeline
    // Default to false (ultra-fast 60 FPS direct WebGL render), toggleable with Bloom key/button
    this.useComposer = false;
    if (this.composer) {
      try { this.composer.dispose(); } catch (_) {}
      this.composer = null;
    }
    const pr = Math.min(devicePixelRatio, renderProfile.pixelRatio);
    const initW = Math.max(1, this.canvas.clientWidth || 800);
    const initH = Math.max(1, this.canvas.clientHeight || 600);
    const composerTarget = new THREE.WebGLRenderTarget(
      Math.floor(initW * pr),
      Math.floor(initH * pr),
      {
        type: THREE.HalfFloatType,
        samples: 2,
      }
    );
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(initW, initH),
      0.38,
      0.45,
      1.0,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Weather Rain Particle System (暴雨动态粒子流)
    this.rainGroup = new THREE.Group();
    const rainCount = 1800;
    const rainGeo = new THREE.BufferGeometry();
    const rainPos = new Float32Array(rainCount * 6);
    for (let i = 0; i < rainCount; i++) {
      const rx = (Math.random() - 0.5) * 80;
      const ry = Math.random() * 30;
      const rz = (Math.random() - 0.5) * 80;
      rainPos[i * 6 + 0] = rx;
      rainPos[i * 6 + 1] = ry;
      rainPos[i * 6 + 2] = rz;
      rainPos[i * 6 + 3] = rx;
      rainPos[i * 6 + 4] = ry - 0.75;
      rainPos[i * 6 + 5] = rz;
    }
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: "#93c5fd",
      transparent: true,
      opacity: 0.65,
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainGroup.add(this.rainLines);
    this.rainGroup.visible = false;
    this.scene.add(this.rainGroup);

    const world = this.sim.world;
    this.vegetation = new Vegetation(this.scene, world);
    this.static = new THREE.Group();
    const s = this.static;
    // High-fidelity engineered road network
    const groundMat = pbr("grass", "#386828", 4);
    if (world.type === "highway") {
      box(s, 3000, 0.8, 3000, 0, -0.7, 0, groundMat);
      this.buildHighway(s, world);
    } else if (world.type === "alpine") {
      this.buildAlpine(this.scene, world);
    } else {
      box(s, 3000, 0.8, 3000, 0, -0.7, 0, groundMat);
      buildCityRoadNetwork(this.scene, s, world, this.glowMaterials);
    }
    if (world.type !== "alpine") {
      for (const o of world.objects) {
      if (o.type === "hill") {
        const hill = cone(
          s,
          o.width / 2,
          o.height,
          o.x,
          o.height / 2 - 5,
          o.z,
          "#94ad85",
          7,
        );
        hill.scale.z = 1.3;
        continue;
      }
      if (o.type === "overpass") {
        box(s, o.width, 0.8, o.depth, o.x, o.height, o.z, "#a9b8aa");
        box(s, o.width, 0.12, o.depth - 2, o.x, o.height + 0.5, o.z, "#6d7e79");
        for (const side of [-1, 1]) {
          box(
            s,
            o.width,
            0.8,
            0.3,
            o.x,
            o.height + 0.75,
            o.z + side * (o.depth / 2),
            "#c6cec0",
          );
          for (const x of [-20, 20])
            box(
              s,
              1.6,
              o.height,
              2.5,
              o.x + x,
              o.height / 2,
              o.z + side * 4,
              "#bac5b5",
            );
        }
        continue;
      }
      if (o.type === "highway_sign") {
        for (const x of [-14, 14]) cyl(s, 0.14, 8, o.x + x, 4, o.z, "#8e9f95");
        box(s, 28, 0.25, 0.25, o.x, 8, o.z, "#8e9f95");
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(9, 4.5),
          new THREE.MeshBasicMaterial({
            map: interstateGuide(o),
            side: THREE.FrontSide,
          }),
        );
        sign.position.set(o.x + 6, 7.2, o.z);
        s.add(sign);
        continue;
      }
      if (o.type === "interstate_guide") {
        const sign = new THREE.Group();
        sign.position.set(o.x, 0, o.z);
        sign.rotation.y = -o.approach;
        for (const x of [-2.1, 2.1])
          cyl(sign, 0.09, 4.5, x, 2.25, 0, "#8e9f95");
        box(sign, 6.4, 3.2, 0.13, 0, 4.3, 0, "#8e9f95");
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(6.4, 3.2),
          new THREE.MeshBasicMaterial({ map: interstateGuide(o) }),
        );
        face.position.set(0, 4.3, 0.075);
        sign.add(face);
        s.add(sign);
        continue;
      }
      if (o.type === "town_sign") {
        cyl(s, 0.08, 3, o.x, 1.5, o.z, "#8e9f95");
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(5, 1.4),
          new THREE.MeshBasicMaterial({
            map: label(o.text, "#3a755d", "#eef7e3", 512, 128),
          }),
        );
        sign.position.set(o.x, 2.7, o.z);
        s.add(sign);
        continue;
      }
      if (o.type === "fork_gantry") {
        for (const xOff of [-13, 13]) {
          cyl(s, 0.22, 8.5, o.x + xOff, 4.25, o.z, "#64748b");
        }
        box(s, 26.5, 0.35, 0.35, o.x, 7.8, o.z, "#64748b");
        box(s, 26.5, 0.35, 0.35, o.x, 8.6, o.z, "#64748b");
        const airportMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(8.2, 4.0),
          new THREE.MeshBasicMaterial({
            map: forkGuideSign({
              main: o.leftText || "AIRPORT EXPWY ↖",
              sub: o.leftSub || "机场快速路 · 科技城",
              arrow: "left",
            }),
            side: THREE.DoubleSide,
          }),
        );
        airportMesh.position.set(o.x + 5.5, 7.2, o.z);
        airportMesh.rotation.y = Math.PI;
        s.add(airportMesh);

        const downtownMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(8.2, 4.0),
          new THREE.MeshBasicMaterial({
            map: forkGuideSign({
              main: o.rightText || "DOWNTOWN CBD ↗",
              sub: o.rightSub || "中央大道 · 市中心",
              arrow: "right",
            }),
            side: THREE.DoubleSide,
          }),
        );
        downtownMesh.position.set(o.x - 5.5, 7.2, o.z);
        downtownMesh.rotation.y = Math.PI;
        s.add(downtownMesh);
        continue;
      }
      if (o.type === "fork_gore") {
        const goreLen = o.length || 34;
        const goreW = o.width || 15;
        box(s, goreW * 0.7, 0.1, goreLen * 0.9, o.x, 0.02, o.z + goreLen * 0.45, "#22272c");
        for (const side of [-1, 1]) {
          const angle = side * Math.atan2(goreW / 2, goreLen);
          box(s, 0.35, 0.022, Math.hypot(goreW / 2, goreLen), o.x + side * (goreW / 4), 0.082, o.z + goreLen / 2, "#f8fafc", -angle);
        }
        for (let d = 4; d < goreLen - 3; d += 3.2) {
          const span = (d / goreLen) * (goreW - 2.5);
          for (const leg of [-1, 1]) {
            const hLeg = leg * 0.55;
            box(s, 0.28, 0.02, span * 0.65, o.x + leg * (span * 0.28), 0.083, o.z + d, "#facc15", -hLeg);
          }
        }
        continue;
      }
      if (o.type === "crash_barrels") {
        const barrelCoords = [
          [0, 0],
          [-0.8, 1.4],
          [0.8, 1.4],
          [-1.5, 2.8],
          [0, 2.8],
          [1.5, 2.8],
        ];
        for (const [bx, bz] of barrelCoords) {
          cyl(s, 0.42, 1.05, o.x + bx, 0.525, o.z + bz, "#f59e0b", 12);
          cyl(s, 0.425, 0.26, o.x + bx, 0.525, o.z + bz, "#1e293b", 12);
          cyl(s, 0.43, 0.08, o.x + bx, 0.525, o.z + bz, "#f8fafc", 12);
          cyl(s, 0.435, 0.06, o.x + bx, 1.05, o.z + bz, "#0f172a", 12);
        }
        cyl(s, 0.08, 2.8, o.x, 1.4, o.z + 4.2, "#64748b");
        const hazardMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 1.2),
          new THREE.MeshBasicMaterial({
            map: hazardSignTexture(),
            side: THREE.DoubleSide,
          }),
        );
        hazardMesh.position.set(o.x, 2.4, o.z + 4.15);
        hazardMesh.rotation.y = Math.PI;
        s.add(hazardMesh);

        // Concrete Jersey Barrier dividing wall extending downstream between diverging ramps
        box(s, 0.6, 0.9, 28, o.x, 0.45, o.z + 18.5, "#cbd5e1");
        box(s, 0.9, 0.25, 28, o.x, 0.125, o.z + 18.5, "#94a3b8");
        continue;
      }
      if (o.type === "zipper_road_marking") {
        const markLen = o.length || 36;
        for (let d = 0; d < markLen; d += 3.2) {
          const isLeftTooth = (Math.floor(d / 3.2) % 2 === 0);
          const toothX = o.x + (isLeftTooth ? -0.55 : 0.55);
          box(s, 0.65, 0.02, 1.8, toothX, 0.082, o.z + d, "#ffffff");
        }
        for (const [tz, tw] of [[-4.0, 2.0], [-2.5, 1.4], [-1.0, 0.8]]) {
          box(s, tw, 0.02, 0.35, o.x + 1.2, 0.082, o.z + tz, "#ffffff");
        }
        continue;
      }
      if (o.type === "streetlight") {
        cyl(s, 0.075, o.height, o.x, o.height / 2, o.z, "#596b61");
        box(s, 1.3, 0.12, 0.6, o.x - 0.5, o.height, o.z, "#e4e5d7");
        if (!this.streetlightMat) {
          this.streetlightMat = new THREE.MeshStandardMaterial({
            color: 0xfff0c4,
            emissive: new THREE.Color(0xffd15c),
            emissiveIntensity: 0.0,
            roughness: 0.2,
          });
          this.glowMaterials.push({
            material: this.streetlightMat,
            key: "streetlights",
          });
        }
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.04, 0.4),
          this.streetlightMat,
        );
        lamp.position.set(o.x - 0.5, o.height - 0.06, o.z);
        s.add(lamp);
        continue;
      }
      if (o.type === "parcel") {
        box(
          s,
          o.width,
          0.18,
          o.depth,
          o.x,
          -0.035,
          o.z,
          o.park ? "#9eb890" : "#adbf9d",
        );
        if (o.park) {
          box(s, 2, 0.03, o.depth, o.x, 0.1, o.z, "#d2c9a7");
          box(s, o.width, 0.03, 2, o.x, 0.11, o.z, "#d2c9a7");
        }
        continue;
      }
      if (o.type === "tree") {
        this.vegetation.tree(s, o);
        continue;
      }
      if (o.type === "bench") {
        box(s, 3, 0.15, 0.8, o.x, 0.7, o.z, "#a78760");
        box(s, 3, 0.75, 0.12, o.x, 1.1, o.z + 0.4, "#a78760");
        for (const d of [-1, 1])
          box(s, 0.15, 0.7, 0.8, o.x + d, 0.35, o.z, "#52645a");
        continue;
      }
      if (o.type === "building") {
        const g = new THREE.Group();
        g.position.set(o.x, 0, o.z);
        g.rotation.y = o.rotation;
        const { width: w, depth: d, height: h } = o;
        box(g, w + 0.6, 0.35, d + 0.6, 0, 0.16, 0, "#e1ddca");
        const tower = o.style === "skyscraper";
        const facade = tower
          ? physical(`facade:${o.color}`, {
              color: new THREE.Color(o.color).lerp(
                new THREE.Color("#31465b"),
                0.72,
              ),
              metalness: 0.48,
              roughness: 0.23,
              clearcoat: 0.55,
            })
          : o.style === "cottage" || o.style === "townhouse"
            ? pbr("brick", "#c5b5a5", 2.8)
            : pbr("pavement", "#c9c7c2", 3.5);
        box(g, w, h, d, 0, h / 2 + 0.3, 0, facade);
        if (tower) {
          for (let floor = 3.8; floor < h; floor += 3.8) {
            box(g, w + 0.07, 0.08, d + 0.07, 0, floor, 0, "#6b727b");
          }
          for (const side of [-1, 1]) {
            for (let col = -w / 2 + 1.6; col < w / 2; col += 1.6)
              box(
                g,
                0.055,
                h,
                0.07,
                col,
                h / 2 + 0.3,
                side * (d / 2 + 0.04),
                "#818a92",
              );
            for (let col = -d / 2 + 1.6; col < d / 2; col += 1.6)
              box(
                g,
                0.07,
                h,
                0.055,
                side * (w / 2 + 0.04),
                h / 2 + 0.3,
                col,
                "#818a92",
              );
          }
          box(
            g,
            w + 0.18,
            0.75,
            d + 0.18,
            0,
            0.6,
            0,
            pbr("pavement", "#898b88", 3),
          );
        }
        if (o.style === "cottage" || o.style === "townhouse") {
          const roof = cone(g, w * 0.77, 3, 0, h + 1.8, 0, o.roof, 4);
          roof.rotation.y = Math.PI / 4;
          roof.scale.z = d / w;
          box(g, 1.1, 2.6, 1.1, w * 0.25, h + 1.5, 0.6, "#b78d72");
        } else {
          box(g, w + 0.5, 0.35, d + 0.5, 0, h + 0.48, 0, o.roof);
          box(g, 2, 0.7, 2, -w * 0.2, h + 1.0, 0, "#a9b2a3");
        }
        for (
          let floor = 0;
          !tower &&
          floor <
            Math.max(1, Math.floor(h / (o.style === "skyscraper" ? 4.5 : 3)));
          floor++
        )
          for (let col = -1; col <= 1; col++) {
            for (const side of [-1, 1]) {
              box(
                g,
                1.5,
                1.65,
                0.1,
                col * w * 0.27,
                2.3 + floor * (o.style === "skyscraper" ? 4.5 : 3),
                side * (d / 2 + 0.04),
                "#f1ead8",
              );
              box(
                g,
                1.2,
                1.35,
                0.12,
                col * w * 0.27,
                2.3 + floor * (o.style === "skyscraper" ? 4.5 : 3),
                side * (d / 2 + 0.09),
                physical("architecture-glass", {
                  color: "#40566b",
                  metalness: 0.4,
                  roughness: 0.14,
                  clearcoat: 0.8,
                }),
              );
              box(
                g,
                0.08,
                1.4,
                0.14,
                col * w * 0.27,
                2.3 + floor * (o.style === "skyscraper" ? 4.5 : 3),
                side * (d / 2 + 0.12),
                "#d9dfca",
              );
            }
            for (const side of [-1, 1])
              box(
                g,
                0.1,
                1.4,
                1.3,
                side * (w / 2 + 0.05),
                2.3 + floor * (o.style === "skyscraper" ? 4.5 : 3),
                col * d * 0.26,
                physical("architecture-glass", {
                  color: "#40566b",
                  metalness: 0.4,
                  roughness: 0.14,
                  clearcoat: 0.8,
                }),
              );
          }
        box(g, 1.3, 2.2, 0.2, 0, 1.4, d / 2 + 0.15, "#776d57");
        box(g, 3, 0.12, 2, 0, 0.35, d / 2 + 1, "#d7d1b8");
        if (o.style === "skyscraper") {
          box(g, w * 0.7, 3, d * 0.7, 0, h + 1.9, 0, "#607d87");
          cyl(g, 0.09, 9, 0, h + 6, 0, "#bdd0cd");
          for (const x of [-w * 0.39, 0, w * 0.39])
            for (const z of [-d / 2 - 0.08, d / 2 + 0.08])
              box(g, 0.13, h, 0.12, x, h / 2 + 0.3, z, "#b5d0d1");
        }
        if (o.style === "shop") {
          box(g, w * 0.9, 0.14, 1.9, 0, 3, d / 2 + 0.75, "#648c80");
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(w * 0.7, 1.2),
            new THREE.MeshBasicMaterial({ map: label("MARKET") }),
          );
          sign.position.set(0, h - 0.6, d / 2 + 0.12);
          g.add(sign);
        }
        this.static.add(g);
        continue;
      }
    }
    }
    if (world.type !== "alpine") {
      // Batch by material and city block so offscreen geometry is culled,
      // including buildings outside the moving shadow camera.
      s.updateMatrixWorld(true);
      const batches = new Map(),
        special = [];
      s.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh) return;
        if (o.material.map && !o.material.userData.metersPerTile) {
          const copy = o.clone();
          o.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
          special.push(copy);
          return;
        }
        const position = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const key = `${o.material.uuid}:${Math.floor(position.x / 80)}:${Math.floor(position.z / 80)}`;
        const batch = batches.get(key) || { material: o.material, geoms: [] };
        batch.geoms.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
        batches.set(key, batch);
      });
      for (const { material, geoms } of batches.values()) {
        const mesh = new THREE.Mesh(mergeGeometries(geoms), material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        geoms.forEach((g) => g.dispose());
      }
      special.forEach((o) => this.scene.add(o));
      // Source geometries have been copied into batches.
      s.traverse((o) => o.geometry?.dispose());
      s.clear();
      this.vegetation.finish();
      this.scenery = new SceneryAssets(this.scene, world, this.vegetation);
    } else {
      this.scene.add(s);
      this.vegetation.finish();
      this.scenery = { active: true, update: () => {} };
    }
    this.lights = [];
    for (const o of world.objects.filter(
      (o) => o.type === "traffic_light" || o.type === "stop_sign",
    )) {
      const g = new THREE.Group();
      g.position.set(o.x, 0, o.z);
      g.rotation.y = -o.approach;
      cyl(g, 0.08, o.height, 0, o.height / 2, 0, "#566861", 8);
      if (o.type === "stop_sign") {
        const sign = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.65, 0.1, 8),
          mat("#c4715b"),
        );
        sign.rotation.x = Math.PI / 2;
        sign.position.set(0, 2.45, 0);
        g.add(sign);
        const text = new THREE.Mesh(
          new THREE.PlaneGeometry(0.95, 0.43),
          new THREE.MeshBasicMaterial({
            map: label("STOP", "#c4715b", "#fff4df"),
            side: THREE.DoubleSide,
          }),
        );
        text.position.set(0, 2.45, 0.065);
        g.add(text);
      } else {
        box(g, 0.65, 1.65, 0.38, 0, 4.2, 0, "#344e47");
        for (let i = 0; i < 3; i++) {
          const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.17, 10, 8),
            new THREE.MeshStandardMaterial({
              color: "#394d43",
              emissive: "#000000",
            }),
          );
          lamp.position.set(0, 4.73 - i * 0.5, 0.22);
          g.add(lamp);
          this.lights.push({ mesh: lamp, obj: o, index: i });
        }
      }
      g.userData.control = true;
      this.scene.add(g);
    }
    const route = this.sim.world.route.points;
    this.destination = new THREE.Group();
    const end = route.at(-1);
    this.destination.position.set(end.x, 0.2, end.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2, 0.13, 8, 48),
      mat("#edfda2"),
    );
    ring.rotation.x = Math.PI / 2;
    this.destination.add(ring);
    const pole = cyl(this.destination, 0.055, 5, 0, 2.5, 0, "#e4f6b3");
    const flag = box(this.destination, 1.8, 1.1, 0.06, 0.85, 4.5, 0, "#dff293");
    if (this.sim.world.type === "alpine") {
      this.destination.scale.set(0.24, 0.24, 0.24);
    }
    this.scene.add(this.destination);
    this.player = carModel("#e2e5e9");
    this.heroCar = null;
    this.wheelDistance = this.sim.distance;
    this.wheelDirection = Math.sign(this.sim.player.speed) || 1;
    this.scene.add(this.player);
    const playerGroup = this.player;
    const amberMat = new THREE.MeshBasicMaterial({ color: "#f59e0b" });
    const bGeo = new THREE.BoxGeometry(0.18, 0.12, 0.12);
    this.blinkerLeft = new THREE.Mesh(bGeo, amberMat);
    this.blinkerLeft.position.set(-0.85, 0.75, 2.1);
    this.player.add(this.blinkerLeft);
    this.blinkerLeft.visible = false;

    this.blinkerRight = new THREE.Mesh(bGeo, amberMat);
    this.blinkerRight.position.set(0.85, 0.75, 2.1);
    this.player.add(this.blinkerRight);
    this.blinkerRight.visible = false;

    // Vehicle Dual Front Headlights (前大灯聚光锥与发光透镜)
    this.headlights = new THREE.Group();
    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.position.set(0, 0.1, 45);
    this.player.add(this.headlightTarget);

    const leftSpot = new THREE.SpotLight("#f8fafc", 16, 75, Math.PI / 6, 0.45, 1.4);
    leftSpot.position.set(-0.68, 0.72, 2.15);
    leftSpot.target = this.headlightTarget;
    this.headlights.add(leftSpot);

    const rightSpot = new THREE.SpotLight("#f8fafc", 16, 75, Math.PI / 6, 0.45, 1.4);
    rightSpot.position.set(0.68, 0.72, 2.15);
    rightSpot.target = this.headlightTarget;
    this.headlights.add(rightSpot);

    const lensGeo = new THREE.BoxGeometry(0.2, 0.08, 0.08);
    const lensMat = new THREE.MeshBasicMaterial({ color: "#f8fafc" });
    const leftLens = new THREE.Mesh(lensGeo, lensMat);
    leftLens.position.set(-0.68, 0.72, 2.15);
    this.headlights.add(leftLens);

    const rightLens = new THREE.Mesh(lensGeo, lensMat);
    rightLens.position.set(0.68, 0.72, 2.15);
    this.headlights.add(rightLens);

    this.player.add(this.headlights);
    this.headlights.visible = false;

    // Tail Brake Lights (红色尾灯与高位刹车灯)
    this.tailLights = new THREE.Group();
    const tailGeo = new THREE.BoxGeometry(0.24, 0.08, 0.08);
    this.tailMat = new THREE.MeshBasicMaterial({ color: "#7f1d1d" });
    const leftTail = new THREE.Mesh(tailGeo, this.tailMat);
    leftTail.position.set(-0.72, 0.85, -2.15);
    this.tailLights.add(leftTail);

    const rightTail = new THREE.Mesh(tailGeo, this.tailMat);
    rightTail.position.set(0.72, 0.85, -2.15);
    this.tailLights.add(rightTail);

    this.brakePointLight = new THREE.PointLight("#ff0022", 0.01, 10, 2);
    this.brakePointLight.position.set(0, 0.85, -2.35);
    this.tailLights.add(this.brakePointLight);

    this.player.add(this.tailLights);

    const carReady = loadHeroCar()
      .then((model) => {
        if (this.player !== playerGroup || this.sim.crash) {
          model.traverse((mesh) => mesh.geometry?.dispose());
          return;
        }
        playerGroup.traverse((mesh) => mesh.geometry?.dispose());
        playerGroup.clear();
        playerGroup.add(model);
        playerGroup.add(this.blinkerLeft);
        playerGroup.add(this.blinkerRight);
        playerGroup.add(this.headlights);
        playerGroup.add(this.headlightTarget);
        playerGroup.add(this.tailLights);
        this.heroCar = model;
        playerGroup.userData.sourcedModel = true;
        playerGroup.userData.eyeHeight = model.userData.eyeHeight;
        playerGroup.userData.eyeForward = model.userData.eyeForward;
      })
      .catch((error) => console.warn("Detailed vehicle unavailable", error));
    this.vehicles = new Map();
    this.people = new Map();
    this.gameVehicles = new Map();
    for (const v of this.sim.traffic) {
      const m = this.createVehicleMesh(v);
      this.vehicles.set(v.id, m);
      this.scene.add(m);
    }
    if (this.sim.gameManager?.agents) {
      for (const agent of this.sim.gameManager.agents) {
        this.addGameAgentMesh(agent);
      }
    }
    for (const p of this.sim.pedestrians) {
      const m = personModel(p);
      this.people.set(p.id, m);
      this.scene.add(m);
    }

    // Dynamic Game Interaction Beam
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.6, 0, 0, 0.6, 0], 3));
    this.gameBeamMat = new THREE.LineBasicMaterial({ color: "#f59e0b", transparent: true, opacity: 0.85, depthTest: false });
    this.gameBeam = new THREE.Line(beamGeo, this.gameBeamMat);
    this.gameBeam.visible = false;
    this.scene.add(this.gameBeam);

    // 3D Holographic Zipper Merge Slot Indicator
    this.zipperSlotGroup = new THREE.Group();
    const slotPlaneGeo = new THREE.PlaneGeometry(2.6, 5.2);
    this.zipperSlotMat = new THREE.MeshBasicMaterial({
      color: "#10b981",
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const slotPlane = new THREE.Mesh(slotPlaneGeo, this.zipperSlotMat);
    slotPlane.rotation.x = -Math.PI / 2;
    slotPlane.position.y = 0.08;
    this.zipperSlotGroup.add(slotPlane);

    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 0.35, 5.2));
    this.zipperSlotEdgeMat = new THREE.LineBasicMaterial({ color: "#34d399", transparent: true, opacity: 0.85 });
    const slotEdges = new THREE.LineSegments(edgeGeo, this.zipperSlotEdgeMat);
    slotEdges.position.y = 0.22;
    this.zipperSlotGroup.add(slotEdges);

    this.zipperBadgeData = makeBadgeTexture("⫰ ZIPPER SLOT · 交替插入槽位", "zipper");
    const zipperBadgeMat = new THREE.SpriteMaterial({ map: this.zipperBadgeData.texture, transparent: true, depthTest: false });
    this.zipperBadgeSprite = new THREE.Sprite(zipperBadgeMat);
    this.zipperBadgeSprite.scale.set(4.2, 1.05, 1);
    this.zipperBadgeSprite.position.set(0, 2.2, 0);
    this.zipperSlotGroup.add(this.zipperBadgeSprite);

    this.zipperSlotGroup.visible = false;
    this.scene.add(this.zipperSlotGroup);

    // 3D Dynamic Sensor Occlusion Shadow (Truck Blind Zone)
    this.truckOcclusionGroup = new THREE.Group();
    const truckPlaneGeo = new THREE.PlaneGeometry(3.6, 16);
    this.truckOcclusionMat = new THREE.MeshBasicMaterial({
      color: "#ef4444",
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.truckOcclusionPlane = new THREE.Mesh(truckPlaneGeo, this.truckOcclusionMat);
    this.truckOcclusionPlane.rotation.x = -Math.PI / 2;
    this.truckOcclusionPlane.position.y = 0.08;
    this.truckOcclusionGroup.add(this.truckOcclusionPlane);

    const truckEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(3.6, 0.25, 16));
    this.truckOcclusionEdgeMat = new THREE.LineBasicMaterial({ color: "#f87171", transparent: true, opacity: 0.85 });
    this.truckOcclusionEdges = new THREE.LineSegments(truckEdgeGeo, this.truckOcclusionEdgeMat);
    this.truckOcclusionEdges.position.y = 0.15;
    this.truckOcclusionGroup.add(this.truckOcclusionEdges);

    this.truckBadgeData = makeBadgeTexture("⚠️ BLIND ZONE · 视线遮挡 88%", "truck");
    const truckBadgeMat = new THREE.SpriteMaterial({ map: this.truckBadgeData.texture, transparent: true, depthTest: false });
    this.truckBadgeSprite = new THREE.Sprite(truckBadgeMat);
    this.truckBadgeSprite.scale.set(4.6, 1.15, 1);
    this.truckBadgeSprite.position.set(0, 2.2, 0);
    this.truckOcclusionGroup.add(this.truckBadgeSprite);

    this.truckOcclusionGroup.visible = false;
    this.scene.add(this.truckOcclusionGroup);

    // Construction Zone 3D Group (Traffic cones taper & LED Arrow trailer)
    this.constructionGroup = new THREE.Group();
    this.coneMeshes = [];
    for (let i = 0; i < 7; i++) {
      const coneSub = new THREE.Group();
      box(coneSub, 0.45, 0.05, 0.45, 0, 0.025, 0, "#0f172a");
      cyl(coneSub, 0.18, 0.75, 0, 0.40, 0, "#f97316", 12);
      cyl(coneSub, 0.185, 0.18, 0, 0.42, 0, "#f8fafc", 12);
      this.constructionGroup.add(coneSub);
      this.coneMeshes.push(coneSub);
    }
    this.arrowTrailerGroup = new THREE.Group();
    box(this.arrowTrailerGroup, 2.2, 0.4, 3.8, 0, 0.35, 0, "#eab308");
    box(this.arrowTrailerGroup, 2.0, 1.4, 0.15, 0, 1.6, 0.5, "#0f172a");
    this.constructionBadgeData = makeBadgeTexture("🚧 道路施工占道 · 反光锥桶导向", "construction");
    const constBadgeMat = new THREE.SpriteMaterial({ map: this.constructionBadgeData.texture, transparent: true, depthTest: false });
    this.constructionBadgeSprite = new THREE.Sprite(constBadgeMat);
    this.constructionBadgeSprite.scale.set(4.6, 1.15, 1);
    this.constructionBadgeSprite.position.set(0, 2.8, 0.5);
    this.arrowTrailerGroup.add(this.constructionBadgeSprite);
    this.constructionGroup.add(this.arrowTrailerGroup);
    this.constructionGroup.visible = false;
    this.scene.add(this.constructionGroup);

    // Roundabout 3D Guidance Group
    this.roundaboutGroup = new THREE.Group();
    const yieldRingGeo = new THREE.RingGeometry(2.5, 3.2, 32);
    this.roundaboutRingMat = new THREE.MeshBasicMaterial({ color: "#3b82f6", side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
    const yieldRing = new THREE.Mesh(yieldRingGeo, this.roundaboutRingMat);
    yieldRing.rotation.x = -Math.PI / 2;
    yieldRing.position.y = 0.08;
    this.roundaboutGroup.add(yieldRing);
    this.roundaboutBadgeData = makeBadgeTexture("⫳ 环岛让行线 · 环内车辆优先", "roundabout");
    const rbBadgeMat = new THREE.SpriteMaterial({ map: this.roundaboutBadgeData.texture, transparent: true, depthTest: false });
    this.roundaboutBadgeSprite = new THREE.Sprite(rbBadgeMat);
    this.roundaboutBadgeSprite.scale.set(4.6, 1.15, 1);
    this.roundaboutBadgeSprite.position.set(0, 2.2, 0);
    this.roundaboutGroup.add(this.roundaboutBadgeSprite);
    this.roundaboutGroup.visible = false;
    this.scene.add(this.roundaboutGroup);
    const vertices = [0, 0.18, 0];
    for (let k = 0; k <= 40; k++) {
      const a = ((-65 + (k * 130) / 40) * Math.PI) / 180;
      vertices.push(Math.sin(a) * 65, 0.18, -Math.cos(a) * 65);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const idx = [];
    for (let i = 1; i <= 40; i++) idx.push(0, i, i + 1);
    geo.setIndex(idx);
    this.sensorCone = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: "#dbfba0",
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.scene.add(this.sensorCone);
    this.impacts = new CrashEffects(this.scene);
    this.vectors = new RoadVectors(this.scene, this.vectorLayer);
    this.renderer.shadowMap.needsUpdate = true;
    this.snap = true;
    this.ready = Promise.all([environmentReady, carReady, this.scenery.ready]);
  }
  setWorldActionModel(waModel) {
    this.worldActionModel = waModel;
    if (waModel.rolloutGroup) this.scene.add(waModel.rolloutGroup);
    if (waModel.ghostGroup) this.scene.add(waModel.ghostGroup);
  }
  async prepare() {
    await this.ready;
    await assetsReady();
    if (this.alpinePassage) {
      this.alpinePassage.prewarm(this.sim.player);
    }
    this.render(0, false);
    // Prepare shaders and upload assets behind the loader, before driving starts.
    await this.renderer.compileAsync(this.scene, this.camera);
    this.render(0);
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.scenery.active = false;
    this.renderer.dispose();
  }
  buildHighway(group, world) {
    buildHighwayRoadNetwork(this.scene, group, world, this.glowMaterials);
  }
  createVehicleMesh(v) {
    if (this.sim.world.type === "alpine") {
      let m;
      if (v.subtype === "suv") m = detailedAlpineSUV(v.color);
      else if (v.subtype === "truck") m = detailedAlpineLoggingTruck(v.color);
      else if (v.subtype === "bus") m = detailedAlpineBus(v.color);
      else if (v.subtype === "motorcycle") m = detailedCar(v.color, true);
      else m = detailedCar(v.color, false);

      if (CAR_SHARED?.poolGeo && CAR_SHARED?.poolMat) {
        const pool = new THREE.Mesh(CAR_SHARED.poolGeo, CAR_SHARED.poolMat);
        pool.renderOrder = 4;
        m.add(pool);
        m.userData.lightPool = pool;
      }
      return m;
    }
    return carModel(v.color, v.type === "motorcycle");
  }
  buildAlpine(group, world) {
    this.alpinePassage = new AlpinePassage(group, this.glowMaterials, false, world);
    this.alpinePassage.group.scale.set(1, 1, 1);
    this.alpinePassage.group.position.set(0, 0, 0);
    Object.assign(this.sun.shadow.camera, {
      left: -16.5,
      right: 16.5,
      top: 16.5,
      bottom: -16.5,
      near: 4,
      far: 50,
    });
    this.sun.shadow.radius = 1.1;
    this.sun.shadow.camera.updateProjectionMatrix();
  }
  render(dt, draw = true) {
    const { width, height } = this.viewport;
    if (!width || !height) return;
    if (
      this.canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) ||
      this.canvas.height !== Math.floor(height * this.renderer.getPixelRatio())
    ) {
      this.renderer.setSize(width, height, false);
      if (this.composer) {
        this.composer.setSize(width, height);
        this.bloom?.resolution?.set(width, height);
      }
      this.camera.aspect = width / height;
      const targetFov = 38;
      if (Math.abs(this.camera.fov - targetFov) > 0.1) {
        this.camera.fov = targetFov;
      }
      this.camera.updateProjectionMatrix();
    }
    const v = this.sim.player;
    this.vegetation.update(this.sim.time);
    this.scenery.update(v, this.sim.time);
    for (const o of this.scene.children)
      if (o.userData.control)
        o.visible = Math.hypot(o.position.x - v.x, o.position.z - v.z) < 170;
    this.player.position.set(v.x, 0, v.z);
    this.player.rotation.y = -v.heading;
    if (this.sim.world.type === "alpine") {
      this.player.scale.set(0.24, 0.24, 0.24);
      const hCenter = getContinuousAlpineHeight(v.x, v.z, this.sim.world);
      const along = v.x * 0.707106 + v.z * 0.707106;
      const BRIDGE_ALONG = -0.72 * 0.707106 + -0.72 * 0.707106;
      const bridgeBoost = (Math.abs(v.x) <= 7.5 && Math.abs(v.z) <= 7.5)
        ? (1 - smoothCurve(Math.abs(along - BRIDGE_ALONG), 0.78, 1.34)) * 0.065
        : 0;
      this.player.position.y = Math.max(hCenter, 0.03) + bridgeBoost;

      const fx = v.x + Math.sin(v.heading) * 0.24;
      const fz = v.z - Math.cos(v.heading) * 0.24;
      const rx = v.x - Math.sin(v.heading) * 0.24;
      const rz = v.z + Math.cos(v.heading) * 0.24;
      const hFront = getContinuousAlpineHeight(fx, fz, this.sim.world);
      const hRear = getContinuousAlpineHeight(rx, rz, this.sim.world);
      this.player.rotation.x = Math.atan2(hFront - hRear, 0.48);
    } else {
      this.player.scale.set(1, 1, 1);
      this.player.rotation.x = 0;
    }
    this.wheelDirection = Math.sign(v.speed) || this.wheelDirection;
    if (this.heroCar && !this.sim.paused && !this.sim.crash)
      updateHeroWheels(
        this.heroCar,
        Math.max(0, this.sim.distance - this.wheelDistance) *
          this.wheelDirection,
        v.wheelSteering ?? v.steering,
        v.speed,
      );
    this.wheelDistance = this.sim.distance;
    const insideCar = this.mode === "hood" && !this.sim.crash;
    this.player.traverse((mesh) => {
      if (mesh.isMesh && mesh.material.name === "Glass")
        mesh.visible = !insideCar;
    });
    for (const p of this.sim.traffic) {
      let m = this.vehicles.get(p.id);
      if (!m) {
        m = this.createVehicleMesh(p);
        this.vehicles.set(p.id, m);
        this.scene.add(m);
      }
      if (m) {
        let py = 0;
        if (this.sim.world.type === "alpine") {
          m.scale.set(0.24, 0.24, 0.24);
          const hCenter = getContinuousAlpineHeight(p.x, p.z, this.sim.world);
          const pAlong = p.x * 0.707106 + p.z * 0.707106;
          const BRIDGE_ALONG = -0.72 * 0.707106 + -0.72 * 0.707106;
          const bridgeBoost = (Math.abs(p.x) <= 7.5 && Math.abs(p.z) <= 7.5)
            ? (1 - smoothCurve(Math.abs(pAlong - BRIDGE_ALONG), 0.78, 1.34)) * 0.065
            : 0;
          py = Math.max(hCenter, 0.03) + bridgeBoost;

          const fx = p.x + Math.sin(p.heading) * 0.2;
          const fz = p.z - Math.cos(p.heading) * 0.2;
          const rx = p.x - Math.sin(p.heading) * 0.2;
          const rz = p.z + Math.cos(p.heading) * 0.2;
          const hFront = getContinuousAlpineHeight(fx, fz, this.sim.world);
          const hRear = getContinuousAlpineHeight(rx, rz, this.sim.world);
          m.rotation.x = Math.atan2(hFront - hRear, 0.4);
        } else {
          m.scale.set(1, 1, 1);
          m.rotation.x = 0;
        }
        m.position.set(p.x, py, p.z);
        m.rotation.y = -p.heading;
        if (m.userData.lightPool) {
          const T = this.seasonController?.time;
          const nightVal = T ? Math.max(T.night || 0, (T.evening || 0) * 0.7) : 0;
          m.userData.lightPool.visible = nightVal > 0.05 || this.weatherMode === "rain" || this.weatherMode === "night";
          m.userData.lightPool.material.opacity = Math.max(0.12, nightVal * 0.45);
        }
      }
    }

    // Prune despawned traffic vehicles so inactive cars do not linger in scene
    const activeTrafficIds = new Set(this.sim.traffic.map((p) => p.id));
    for (const [id, m] of this.vehicles.entries()) {
      if (!activeTrafficIds.has(id)) {
        this.scene.remove(m);
        this.vehicles.delete(id);
      }
    }

    const blinkOn = Math.floor(this.sim.time * 4) % 2 === 0;
    if (this.blinkerLeft) this.blinkerLeft.visible = this.sim.blinker === "left" && blinkOn;
    if (this.blinkerRight) this.blinkerRight.visible = this.sim.blinker === "right" && blinkOn;

    // Render Multi-Agent Game Theory Swarm
    if (this.sim.gameManager?.agents) {
      // Prune meshes of agents that were removed or reset
      const activeIds = new Set(this.sim.gameManager.agents.map((a) => a.id));
      for (const [id, m] of this.gameVehicles.entries()) {
        if (!activeIds.has(id)) {
          this.scene.remove(m);
          this.gameVehicles.delete(id);
        }
      }

      for (const agent of this.sim.gameManager.agents) {
        let m = this.gameVehicles.get(agent.id);
        if (!m) {
          m = this.addGameAgentMesh(agent);
        }
        m.position.set(agent.x, 0, agent.z);
        m.rotation.y = -agent.heading;

        // Dynamic turn blinkers
        if (m.userData.blinkers) {
          const lOn = agent.blinker === "left" && blinkOn;
          const rOn = agent.blinker === "right" && blinkOn;
          m.userData.blinkers.left.forEach((b) => (b.visible = lOn));
          m.userData.blinkers.right.forEach((b) => (b.visible = rOn));
        }

        // Floating badge text
        if (m.userData.badgeObj) {
          const badgeText = `${(agent.name || "NPC").split(" ")[0]} · ${agent.statusText || ""}`;
          updateBadgeTexture(m.userData.badgeObj, badgeText, agent.role);
        }
      }

      // Dynamic Game-Theoretic Interaction Beam
      const adversary =
        this.sim.gameManager.keyAdversary ||
        this.sim.gameManager.agents.find((a) => a.role === "cut_in" || a.role === "zipper_r1" || a.role === "truck");
      if (
        adversary &&
        Math.hypot(v.x - adversary.x, v.z - adversary.z) < 55
      ) {
        this.gameBeam.visible = true;
        const pos = this.gameBeam.geometry.attributes.position.array;
        pos[0] = v.x;
        pos[1] = 0.55;
        pos[2] = v.z;
        pos[3] = adversary.x;
        pos[4] = 0.55;
        pos[5] = adversary.z;
        this.gameBeam.geometry.attributes.position.needsUpdate = true;

        if (this.sim.gameManager.scenarioMode === "truck_overtake") {
          this.gameBeamMat.color.set("#f97316"); // heavy truck amber-orange
          this.gameBeamMat.opacity = 0.88;
        } else if (this.sim.gameManager.scenarioMode === "zipper_merge") {
          this.gameBeamMat.color.set("#10b981"); // cooperative emerald green
          this.gameBeamMat.opacity = 0.88;
        } else if (adversary.ttc < 2.0) {
          this.gameBeamMat.color.set("#ef4444"); // emergency red
          this.gameBeamMat.opacity = blinkOn ? 0.95 : 0.4;
        } else if (
          adversary.ttc < 4.0 ||
          adversary.state.includes("cut_in")
        ) {
          this.gameBeamMat.color.set("#f59e0b"); // warning amber
          this.gameBeamMat.opacity = 0.85;
        } else {
          this.gameBeamMat.color.set("#38bdf8"); // tactical cyan
          this.gameBeamMat.opacity = 0.6;
        }
      } else {
        this.gameBeam.visible = false;
      }
    }

    // Dynamic 3D Holographic Zipper Slot Indicator
    if (this.sim.gameManager?.scenarioMode === "zipper_merge" && this.sim.gameManager?.zipperState && this.zipperSlotGroup) {
      const zState = this.sim.gameManager.zipperState;
      const r1 = this.sim.gameManager.agents.find((a) => a.role === "zipper_r1");
      this.zipperSlotGroup.visible = true;

      const fX = Math.sin(v.heading);
      const fZ = -Math.cos(v.heading);

      const slotAhead = Math.max(8.0, Math.min(22.0, r1 ? r1.gap : 13.0));
      const slotX = v.x + fX * slotAhead;
      const slotZ = v.z + fZ * slotAhead;
      this.zipperSlotGroup.position.set(slotX, 0, slotZ);
      this.zipperSlotGroup.rotation.y = -v.heading;

      const pulse = 0.45 + 0.3 * Math.sin(performance.now() * 0.007);
      this.zipperSlotMat.opacity = pulse;

      if (zState.stage === "ego_passing" || zState.stage === "completed") {
        this.zipperSlotMat.color.set("#10b981");
        this.zipperSlotEdgeMat.color.set("#34d399");
        updateBadgeTexture(this.zipperBadgeData, "✔ 槽位就位 · 顺利汇入", "zipper_r1");
      } else {
        this.zipperSlotMat.color.set("#06b6d4");
        this.zipperSlotEdgeMat.color.set("#38bdf8");
        updateBadgeTexture(this.zipperBadgeData, `⫰ 预留槽位 ${(zState.slotGap || 14.5).toFixed(1)}m · 礼让让行`, "zipper");
      }
    } else if (this.zipperSlotGroup) {
      this.zipperSlotGroup.visible = false;
    }

    // Dynamic 3D Heavy Truck Occlusion Shadow
    if (this.sim.gameManager?.scenarioMode === "truck_overtake" && this.sim.gameManager?.truckState && this.truckOcclusionGroup) {
      const tState = this.sim.gameManager.truckState;
      const truck = this.sim.gameManager.agents.find((a) => a.role === "truck");
      if (truck) {
        this.truckOcclusionGroup.visible = true;

        const fX = Math.sin(v.heading);
        const fZ = -Math.cos(v.heading);

        // Place occlusion zone behind the truck
        const truckBackGap = Math.max(2.0, truck.gap - 6.5);
        const zoneLength = Math.max(6.0, Math.min(22.0, truckBackGap));
        const centerDist = truckBackGap / 2;

        const zoneX = v.x + fX * centerDist;
        const zoneZ = v.z + fZ * centerDist;
        this.truckOcclusionGroup.position.set(zoneX, 0, zoneZ);
        this.truckOcclusionGroup.rotation.y = -v.heading;

        this.truckOcclusionPlane.scale.set(1, zoneLength / 16, 1);
        this.truckOcclusionEdges.scale.set(1, 1, zoneLength / 16);

        const pulse = 0.40 + 0.25 * Math.sin(performance.now() * 0.008);
        this.truckOcclusionMat.opacity = pulse;

        if (tState.stage === "completed") {
          this.truckOcclusionMat.color.set("#10b981");
          this.truckOcclusionEdgeMat.color.set("#34d399");
          updateBadgeTexture(this.truckBadgeData, "✔ 超车顺利完成 · 视距恢复 100%", "zipper_r1");
        } else if (tState.stage === "overtaking") {
          this.truckOcclusionMat.color.set("#38bdf8");
          this.truckOcclusionEdgeMat.color.set("#0284c7");
          updateBadgeTexture(this.truckBadgeData, "⭐ 左道净空确认 · 全力超车中", "overtake");
        } else if (tState.stage === "peeking_left") {
          this.truckOcclusionMat.color.set("#f59e0b");
          this.truckOcclusionEdgeMat.color.set("#fbbf24");
          updateBadgeTexture(this.truckBadgeData, `🔍 车道微偏 0.7m 探头 (盲区降至 ${tState.occlusionRatio}%)`, "cut_in");
        } else {
          this.truckOcclusionMat.color.set("#ef4444");
          this.truckOcclusionEdgeMat.color.set("#f87171");
          updateBadgeTexture(this.truckBadgeData, `⚠️ BLIND ZONE · 视线遮挡 ${tState.occlusionRatio}%`, "truck");
        }
      } else {
        this.truckOcclusionGroup.visible = false;
      }
    } else if (this.truckOcclusionGroup) {
      this.truckOcclusionGroup.visible = false;
    }

    // Construction Zone 3D Animation & Placement
    if (this.sim.gameManager?.scenarioMode === "construction" && this.constructionGroup) {
      const trailer = this.sim.gameManager.agents.find((a) => a.role === "construction_trailer");
      if (trailer) {
        this.constructionGroup.visible = true;
        this.arrowTrailerGroup.position.set(trailer.x, 0, trailer.z);
        this.arrowTrailerGroup.rotation.y = -trailer.heading;

        const fX = Math.sin(v.heading);
        const fZ = -Math.cos(v.heading);
        const rX = Math.cos(v.heading);
        const rZ = Math.sin(v.heading);

        // Position 7 cones along the taper between car right edge and trailer
        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          const coneDist = trailer.gap * 0.15 + t * (trailer.gap * 0.75);
          const coneOffset = 3.6 - t * 1.4;
          const cx = v.x + fX * coneDist + rX * coneOffset;
          const cz = v.z + fZ * coneDist + rZ * coneOffset;
          this.coneMeshes[i].position.set(cx, 0, cz);
        }
      } else {
        this.constructionGroup.visible = false;
      }
    } else if (this.constructionGroup) {
      this.constructionGroup.visible = false;
    }

    // Roundabout 3D Animation & Placement
    if (this.sim.gameManager?.scenarioMode === "roundabout" && this.roundaboutGroup) {
      const circulating = this.sim.gameManager.agents.find((a) => a.role === "roundabout_circulating");
      if (circulating) {
        this.roundaboutGroup.visible = true;
        this.roundaboutGroup.position.set(circulating.x, 0, circulating.z);
        const pulse = 0.5 + 0.3 * Math.sin(performance.now() * 0.006);
        this.roundaboutRingMat.opacity = pulse;
      } else {
        this.roundaboutGroup.visible = false;
      }
    } else if (this.roundaboutGroup) {
      this.roundaboutGroup.visible = false;
    }

    // Dynamic Rain Particles Falling
    if (this.rainGroup && this.rainGroup.visible) {
      this.rainGroup.position.set(v.x, 0, v.z);
      const pos = this.rainLines.geometry.attributes.position.array;
      const count = pos.length / 6;
      for (let i = 0; i < count; i++) {
        pos[i * 6 + 1] -= 38 * dt;
        pos[i * 6 + 4] -= 38 * dt;
        if (pos[i * 6 + 1] < 0.2) {
          const rx = (Math.random() - 0.5) * 80;
          const ry = 28 + Math.random() * 6;
          const rz = (Math.random() - 0.5) * 80;
          pos[i * 6 + 0] = rx;
          pos[i * 6 + 1] = ry;
          pos[i * 6 + 2] = rz;
          pos[i * 6 + 3] = rx;
          pos[i * 6 + 4] = ry - 0.75;
          pos[i * 6 + 5] = rz;
        }
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }

    // Dynamic Tail Brake Lights Glow
    const braking = (this.sim.pedals.brake > 0.05 || this.sim.aebActive);
    if (this.tailMat) {
      const isNight = this.sim.weather === "night";
      if (braking) {
        this.tailMat.color.set("#ff1122");
        if (this.brakePointLight) this.brakePointLight.intensity = 5.5;
      } else {
        this.tailMat.color.set(isNight ? "#991b1b" : "#450a0a");
        if (this.brakePointLight) this.brakePointLight.intensity = isNight ? 0.35 : 0.001;
      }
    }

    for (const p of this.sim.pedestrians) {
      let m = this.people.get(p.id);
      if (!m) {
        m = personModel(p);
        this.people.set(p.id, m);
        this.scene.add(m);
      }
      if (m) {
        let py = p.walking ? Math.sin(this.sim.time * 8) * 0.035 : 0;
        if (this.sim.world.type === "alpine") {
          m.scale.set(0.24, 0.24, 0.24);
          py = getContinuousAlpineHeight(p.x, p.z, this.sim.world) + (p.walking ? Math.sin(this.sim.time * 8) * 0.015 : 0);
        } else {
          m.scale.set(1, 1, 1);
        }
        m.position.set(p.x, py, p.z);
        m.rotation.y = -(p.heading || 0);
        const stride = p.walking
          ? Math.sin(
              this.sim.time * (p.crossing ? 10 : 5) +
                Number(p.id.split("-").at(-1)),
            ) * 0.42
          : 0;
        m.userData.limbs.legs.forEach(
          (leg, i) => (leg.rotation.x = stride * (i ? -1 : 1)),
        );
        m.userData.limbs.arms.forEach(
          (arm, i) => (arm.rotation.x = stride * (i ? 1 : -1)),
        );
      }
    }
    if (this.sim.crash && !this.impacts.crash) {
      const crash = this.sim.crash;
      const target =
        this.vehicles.get(crash.object_id) || this.people.get(crash.object_id);
      this.impacts.start(
        crash,
        this.player,
        target,
        this.sim.world.objects.find((o) => o.id === crash.object_id),
      );
    }
    this.impacts.update(Math.min(dt, 0.05));
    for (const l of this.lights) {
      const c = signalState(
          this.sim.world.byId[l.obj.nodeId],
          this.sim.time,
          l.obj.approach,
        ).color,
        on = ["red", "amber", "green"][l.index] === c;
      l.mesh.material.color.set(
        on ? ["#f0836b", "#f4cb69", "#afdf92"][l.index] : "#34483e",
      );
      l.mesh.material.emissive.set(
        on ? ["#98301d", "#ad770e", "#508e38"][l.index] : "#000000",
      );
      l.mesh.material.emissiveIntensity = on ? 0.9 : 0;
    }
    this.sensorCone.visible = this.showSensors;
    this.sensorCone.position.set(v.x, 0, v.z);
    this.sensorCone.rotation.y = -v.heading;
    this.destination.children[2].position.y =
      4.5 + Math.sin(this.sim.time * 2) * 0.18;
    let pos, look;
    if (this.customCamera) {
      pos = this.customCamera.pos;
      look = this.customCamera.look;
    } else if (this.sim.crash) {
      const side = this.sim.crash.type === "building" ? -1 : 1;
      pos = new THREE.Vector3(
        v.x - Math.sin(v.heading) * 12 + Math.cos(v.heading) * 8 * side,
        8,
        v.z + Math.cos(v.heading) * 12 + Math.sin(v.heading) * 8 * side,
      );
      look = new THREE.Vector3(v.x, 0.7, v.z);
    } else if (this.mode === "hood") {
      const isAlpine = this.sim.world.type === "alpine";
      const carScale = isAlpine ? 0.24 : 1.0;
      const view = this.cameraInput.current();
      const forward = (this.player.userData.eyeForward ?? 0.15) * carScale;
      pos = new THREE.Vector3(
        v.x + Math.sin(v.heading) * forward - Math.cos(v.heading) * (0.3 * carScale),
        (this.player.position.y || 0) + (this.player.userData.eyeHeight || 1.27) * carScale,
        v.z - Math.cos(v.heading) * forward - Math.sin(v.heading) * (0.3 * carScale),
      );
      const yaw = v.heading + view.yaw;
      look = pos
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(yaw) * Math.cos(view.pitch),
            Math.sin(view.pitch),
            -Math.cos(yaw) * Math.cos(view.pitch),
          ).multiplyScalar(25 * carScale),
        );
    } else if (this.mode === "overview" && this.sim.world.type === "alpine") {
      // Iconic Four-Seasons Golden 3/4 Isometric Vantage with 360-degree interactive orbit drag & zoom
      const view = this.cameraInput.current() || { yaw: 0, pitch: 0.46, distance: 22.8 };
      // Golden 3/4 perspective offset: road sweeps diagonally across screen, peak towers on left, hamlet on right
      const GOLDEN_YAW_OFFSET = 0.52;
      const orbitYaw = Math.PI / 4 + GOLDEN_YAW_OFFSET + (view.yaw || 0);
      const pitch = Math.max(0.18, Math.min(1.25, view.pitch ?? 0.46));
      const dist = Math.max(10.0, Math.min(48.0, view.distance ?? 22.8));
      const hDist = Math.cos(pitch) * dist;
      const vHeight = Math.sin(pitch) * dist;
      pos = new THREE.Vector3(
        Math.sin(orbitYaw) * hDist,
        vHeight,
        Math.cos(orbitYaw) * hDist,
      );
      look = new THREE.Vector3(0, 0.42, 0);
    } else if (this.mode === "map" && this.sim.world.type === "alpine") {
      const py = this.player.position.y || 0.05;
      const view = this.cameraInput.current();
      const orbitYaw = Math.PI / 4 + (view.yaw || 0);
      pos = new THREE.Vector3(
        v.x - Math.sin(orbitYaw) * 22.0,
        py + 18.0,
        v.z - Math.cos(orbitYaw) * 22.0,
      );
      look = new THREE.Vector3(v.x, py + 0.8, v.z);
    } else if (this.sim.world.type === "alpine") {
      const view = this.cameraInput.current();
      // True Four-Seasons Panoramic Diorama Tilt-Shift Follow Cam:
      // Uses stable oblique vantage (~67 deg) + user orbit drag,
      // perfectly balancing hero car, winding road, towering summits, and golden sunset sky
      const orbitYaw = Math.PI / 4 + 0.35 + (view.yaw || 0);
      const pitch = Math.max(0.36, Math.min(0.85, (view.pitch ?? 0.46)));
      const dist = Math.max(12.0, Math.min(30.0, (view.distance || 15) * 1.15));
      const hDist = Math.cos(pitch) * dist;
      const vHeight = Math.sin(pitch) * dist + 2.4;
      const py = this.player.position.y || 0.05;
      pos = new THREE.Vector3(
        v.x - Math.sin(orbitYaw) * hDist,
        py + vHeight,
        v.z - Math.cos(orbitYaw) * hDist,
      );
      // Guarantee camera remains nicely above mountain slope terrain
      const terrH = getContinuousAlpineHeight(pos.x, pos.z, this.sim.world);
      if (pos.y < terrH + 2.5) {
        pos.y = terrH + 2.5;
      }
      const ahead = 2.8;
      look = new THREE.Vector3(
        v.x + Math.sin(v.heading) * ahead,
        py + 0.95,
        v.z - Math.cos(v.heading) * ahead,
      );
    } else {
      const view = this.cameraInput.current(),
        yaw = v.heading + view.yaw;
      const horizontal = Math.cos(view.pitch) * view.distance;
      pos = new THREE.Vector3(
        v.x - Math.sin(yaw) * horizontal,
        Math.sin(view.pitch) * view.distance + 0.7,
        v.z + Math.cos(yaw) * horizontal,
      );
      const ahead = this.mode === "map" ? 0 : 5;
      look = new THREE.Vector3(
        v.x + Math.sin(v.heading) * ahead,
        0.7,
        v.z - Math.cos(v.heading) * ahead,
      );
    }
    this.camera.position.lerp(
      pos,
      this.snap || insideCar ? 1 : 1 - Math.exp(-dt * 4),
    );
    if (!insideCar)
      keepCameraOutsideBuildings(
        this.camera.position,
        new THREE.Vector3(v.x, 1, v.z),
        this.sim.world.objects,
      );
    this.look = this.look || look.clone();
    this.look.lerp(look, this.snap || insideCar ? 1 : 1 - Math.exp(-dt * 6));
    this.camera.lookAt(this.look);
    this.snap = false;
    if (this.seasons) {
      this.seasons.update(dt);
      const T = this.seasons.time;
      const S = this.seasons.season;

      if (this.sky) this.sky.update(this.seasons, this.camera.position);
      if (this.weatherParticles) this.weatherParticles.update(this.camera.position);

      const LIGHT_POWER = 1.8;
      this.sun.color.copy(T.sunColor);
      this.sun.intensity = LIGHT_POWER * T.sunIntensity * (1 - S.cloudShade * 0.35);
      const sunDist = this.sim.world.type === "alpine" ? 46 : 22;
      const targetPos = this._sunTargetPos;
      if (this.mode === "overview" && this.sim.world.type === "alpine") {
        targetPos.set(0, 0.45, 0);
      } else {
        targetPos.set(v.x, 0, v.z);
      }
      this.sun.position.copy(this.seasons.lightDir).multiplyScalar(sunDist).add(targetPos);
      this.sun.target.position.copy(targetPos);
      this.sun.target.updateMatrixWorld();

      this.hemiLight.color.copy(T.hemiSky);
      this.hemiLight.groundColor.copy(T.hemiGround);
      this.hemiLight.intensity = T.hemiIntensity * (1 + S.snowCoverage * 0.2);

      const FOG_BASE_DENSITY = 0.017;
      if (this.scene.fog) {
        this.scene.fog.color.setRGB(T.fog.r * S.fogTint.x, T.fog.g * S.fogTint.y, T.fog.b * S.fogTint.z);
        this.scene.fog.density = S.fogDensity * (FOG_BASE_DENSITY / 0.017);
        U.uFogColor.value.copy(this.scene.fog.color);
      }
      this.renderer.toneMappingExposure = T.exposure;

      if (this.headlights) {
        this.headlights.visible = T.night > 0.1 || T.evening > 0.5 || S.wetness > 0.3 || this.weatherMode === "rain" || this.weatherMode === "night";
      }

      if (this.glowMaterials) {
        for (const g of this.glowMaterials) {
          if (g.key === "reflector") g.material.emissiveIntensity = 0.35 + T.night * 1.5 + T.evening * 0.4;
          else if (g.key === "streetlights") g.material.emissiveIntensity = T.streetlights;
          else if (g.key === "window") g.material.emissiveIntensity = T.windows;
          else if (g.key === "bridge") g.material.emissiveIntensity = 0.5 + T.bridge * 1.6;
        }
      }
    } else {
      this.sun.position.set(v.x - 55, 85, v.z + 50);
      this.sun.target.position.set(v.x, 0, v.z);
    }
    this.vectors.render(
      v,
      this.camera,
      width,
      height,
      dt,
      this.sim.autopilot,
      this.sim.paused,
      this.sim.aebActive,
      this.sim.world,
    );
    if (this.worldActionModel) {
      this.worldActionModel.update(this.sim, dt);
    }
    if (this.alpinePassage) {
      this.alpinePassage.update(dt, this.seasons, v, this.sim.world, this.camera.position);
    }

    if (draw) {
      if (this.useComposer && this.composer) {
        this.composer.render(dt);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }
  setBloom(enabled) {
    this.useComposer = !!enabled;
    return this.useComposer;
  }
  toggleBloom() {
    this.useComposer = !this.useComposer;
    return this.useComposer;
  }
  isBloomEnabled() {
    return !!this.useComposer;
  }
  setSeason(index) {
    if (this.seasons) this.seasons.setSeason(index);
  }
  setTimeOfDay(index) {
    if (this.seasons) this.seasons.setTime(index);
  }
  setWeather(mode) {
    this.weatherMode = mode;
    if (mode === "rain") {
      if (this.seasons) {
        this.seasons.setTime(0);
        U.uWetness.value = 0.85;
      }
      if (this.rainGroup) this.rainGroup.visible = true;
      if (this.headlights) this.headlights.visible = true;
    } else if (mode === "night") {
      if (this.seasons) this.seasons.setTime(2);
      if (this.rainGroup) this.rainGroup.visible = false;
      if (this.headlights) this.headlights.visible = true;
    } else {
      if (this.seasons) {
        U.uWetness.value = this.seasons.season.wetness || 0.05;
      }
      if (this.rainGroup) this.rainGroup.visible = false;
      if (this.headlights) {
        const T = this.seasons?.time;
        this.headlights.visible = T ? (T.night > 0.1 || T.evening > 0.5) : false;
      }
    }
  }
  addGameAgentMesh(agent) {
    const isTruck = agent.role === "truck";
    const m = isTruck
      ? detailedHeavyTruck(agent.color || "#1e3a8a", "#0f172a")
      : carModel(agent.color, false);

    // Amber Turn Indicators (Front & Rear)
    const blinkMat = new THREE.MeshBasicMaterial({ color: "#f59e0b" });
    const bGeo = new THREE.BoxGeometry(0.18, 0.12, 0.12);
    let fl, fr, rl, rr;
    if (isTruck) {
      fl = new THREE.Mesh(bGeo, blinkMat); fl.position.set(-1.25, 1.0, -6.6); fl.visible = false; m.add(fl);
      fr = new THREE.Mesh(bGeo, blinkMat); fr.position.set(1.25, 1.0, -6.6); fr.visible = false; m.add(fr);
      rl = new THREE.Mesh(bGeo, blinkMat); rl.position.set(-1.25, 0.8, 6.4); rl.visible = false; m.add(rl);
      rr = new THREE.Mesh(bGeo, blinkMat); rr.position.set(1.25, 0.8, 6.4); rr.visible = false; m.add(rr);
    } else {
      fl = new THREE.Mesh(bGeo, blinkMat); fl.position.set(-0.95, 0.65, -2.15); fl.visible = false; m.add(fl);
      fr = new THREE.Mesh(bGeo, blinkMat); fr.position.set(0.95, 0.65, -2.15); fr.visible = false; m.add(fr);
      rl = new THREE.Mesh(bGeo, blinkMat); rl.position.set(-0.95, 0.8, 2.15); rl.visible = false; m.add(rl);
      rr = new THREE.Mesh(bGeo, blinkMat); rr.position.set(0.95, 0.8, 2.15); rr.visible = false; m.add(rr);
    }

    // Holographic Sprite Badge above vehicle
    const badgeData = makeBadgeTexture(agent.name, agent.role);
    const spriteMat = new THREE.SpriteMaterial({ map: badgeData.texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    if (isTruck) {
      sprite.scale.set(4.8, 1.2, 1);
      sprite.position.set(0, 4.4, 0);
    } else {
      sprite.scale.set(3.8, 0.95, 1);
      sprite.position.set(0, 2.6, 0);
    }
    m.add(sprite);

    m.userData.blinkers = { left: [fl, rl], right: [fr, rr] };
    m.userData.badgeObj = { ...badgeData, sprite, lastText: agent.name };

    this.gameVehicles.set(agent.id, m);
    this.scene.add(m);
    return m;
  }
}
