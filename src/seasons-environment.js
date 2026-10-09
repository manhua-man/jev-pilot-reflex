import * as THREE from "three";

/**
 * Four-Seasons Atmospheric & Environmental Rendering Engine
 * Inspired by iamtechartist/Four-Seasons
 *
 * Implements:
 * - 4 Seasons: Spring (春), Summer (夏), Autumn (秋), Winter (冬)
 * - 3 Times of Day: Sunset (暮色), Noon (正午), Night (星夜)
 * - Shared uniform block driven by non-allocating cubic smootherstep blender
 * - Procedural 3-tier gradient sky dome with Sun/Moon bodies and radial corona glow
 * - 1200+ instanced twinkling procedural stars & Milky Way dust band
 * - Instanced seasonal particle system: cherry petals, pollen, maple leaves, snowflakes, fireflies
 * - Material patching pipeline (onBeforeCompile) for seasonal tint, height fog, wetness, and snow dusting
 */

export const SEASONS = [
  {
    key: "spring",
    name: "Spring · 春和景明",
    grassBase: "#347d25",
    grassTip: "#b5ea68",
    grassHeight: 0.95,
    meadowTint: [1.02, 1.12, 0.86],
    lush: 1.0,
    dry: 0.0,
    frost: 0.0,
    snowLine: 3.55,
    snowCoverage: 0.0,
    freeze: 0.0,
    flow: 1.7,
    foam: 1.5,
    wetness: 0.25,
    fogTint: [1.0, 1.03, 1.04],
    fogDensity: 0.014,
    heightFog: 0.3,
    skyTint: [0.98, 1.02, 1.05],
    cloudShade: 0.05,
    particles: [1.0, 0.2, 0.0, 0.0],
    fireflies: 0.25,
    birds: 7,
    flowers: 1.0,
    canopy: 1,
    sunElev: 0.0,
    smoke: 0.35,
    fire: 0,
  },
  {
    key: "summer",
    name: "Summer · 夏木葱茏",
    grassBase: "#32781f",
    grassTip: "#9ad64e",
    grassHeight: 1.1,
    meadowTint: [0.95, 1.03, 0.8],
    lush: 0.55,
    dry: 0.1,
    frost: 0.0,
    snowLine: 4.85,
    snowCoverage: 0.0,
    freeze: 0.0,
    flow: 1.0,
    foam: 1.0,
    wetness: 0.06,
    fogTint: [1.0, 1.0, 1.0],
    fogDensity: 0.012,
    heightFog: 0.18,
    skyTint: [1.0, 1.0, 1.0],
    cloudShade: 0.0,
    particles: [0.0, 1.0, 0.0, 0.0],
    fireflies: 1.0,
    birds: 9,
    flowers: 0.4,
    canopy: 1,
    sunElev: 0.12,
    smoke: 0.15,
    fire: 1,
  },
  {
    key: "autumn",
    name: "Autumn · 霜染红枫",
    grassBase: "#7a6a2a",
    grassTip: "#f5a43a",
    grassHeight: 0.9,
    meadowTint: [1.22, 1.0, 0.62],
    lush: 0.0,
    dry: 1.0,
    frost: 0.05,
    snowLine: 4.15,
    snowCoverage: 0.06,
    freeze: 0.04,
    flow: 0.85,
    foam: 0.8,
    wetness: 0.18,
    fogTint: [1.07, 0.98, 0.9],
    fogDensity: 0.016,
    heightFog: 0.45,
    skyTint: [1.06, 0.97, 0.88],
    cloudShade: 0.18,
    particles: [0.0, 0.0, 1.0, 0.0],
    fireflies: 0.35,
    birds: 5,
    flowers: 0.0,
    canopy: 1,
    sunElev: -0.08,
    smoke: 0.75,
    fire: 1,
  },
  {
    key: "winter",
    name: "Winter · 银装素裹",
    grassBase: "#b9c4bd",
    grassTip: "#f1f6f5",
    grassHeight: 0.2,
    meadowTint: [0.86, 0.92, 1.0],
    lush: 0.0,
    dry: 0.25,
    frost: 1.0,
    snowLine: 0.16,
    snowCoverage: 1.0,
    freeze: 1.0,
    flow: 0.04,
    foam: 0.1,
    wetness: 0.85,
    fogTint: [0.95, 1.0, 1.08],
    fogDensity: 0.018,
    heightFog: 0.35,
    skyTint: [0.9, 0.97, 1.08],
    cloudShade: 0.38,
    particles: [0.0, 0.0, 0.0, 1.0],
    fireflies: 0.0,
    birds: 0,
    flowers: 0.0,
    canopy: 0,
    sunElev: -0.16,
    smoke: 1.0,
    fire: 0,
  },
];

export const TIMES = [
  {
    key: "sunset",
    name: "Sunset · 日落余晖",
    lightDir: [0.62, 0.34, -0.7],
    sunColor: "#ffcf96",
    sunIntensity: 1.0,
    hemiSky: "#ffd6b8",
    hemiGround: "#3b2b2c",
    hemiIntensity: 0.6,
    skyTop: "#1d3a66",
    skyMid: "#e98a60",
    skyBottom: "#ffb65c",
    fog: "#5a5460",
    exposure: 1.05,
    windows: 3.0,
    lantern: 1.6,
    bridge: 0.6,
    streetlights: 2.4,
    reflector: 1.2,
    stars: 0.06,
    night: 0.0,
    evening: 1.0,
    sunBody: 1.0,
    moonBody: 0.0,
    glow: "#ffb56b",
    glowScale: 5.2,
    carLights: 0.35,
  },
  {
    key: "noon",
    name: "Noon · 高天丽日",
    lightDir: [0.3, 0.92, -0.28],
    sunColor: "#fff5e8",
    sunIntensity: 1.3,
    hemiSky: "#cfe4ff",
    hemiGround: "#4d5a3c",
    hemiIntensity: 0.8,
    skyTop: "#2c7fd8",
    skyMid: "#78b8f3",
    skyBottom: "#d8edff",
    fog: "#9cc2dc",
    exposure: 0.98,
    windows: 0.15,
    lantern: 0.0,
    bridge: 0.0,
    streetlights: 0.0,
    reflector: 0.2,
    stars: 0.0,
    night: 0.0,
    evening: 0.0,
    sunBody: 1.0,
    moonBody: 0.0,
    glow: "#fff4dd",
    glowScale: 4.0,
    carLights: 0.0,
  },
  {
    key: "night",
    name: "Night · 静谧星月",
    lightDir: [-0.5, 0.62, -0.6],
    sunColor: "#a9c2ff",
    sunIntensity: 0.55,
    hemiSky: "#4a6190",
    hemiGround: "#121426",
    hemiIntensity: 0.85,
    skyTop: "#02040c",
    skyMid: "#08142e",
    skyBottom: "#191339",
    fog: "#0e152a",
    exposure: 1.22,
    windows: 5.0,
    lantern: 3.2,
    bridge: 1.6,
    streetlights: 4.5,
    reflector: 2.6,
    stars: 1.0,
    night: 1.0,
    evening: 1.0,
    sunBody: 0.0,
    moonBody: 1.0,
    glow: "#7fc4ff",
    glowScale: 3.6,
    carLights: 1.0,
  },
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const easeInOut = (t) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep

function prepareSet(list) {
  return list.map((src) => {
    const out = {};
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "string" && v[0] === "#") out[k] = new THREE.Color(v);
      else if (Array.isArray(v))
        out[k] =
          v.length === 4
            ? new THREE.Vector4(...v)
            : new THREE.Vector3(...v);
      else out[k] = v;
    }
    return out;
  });
}

export class SeasonBlender {
  constructor(list) {
    this.list = prepareSet(list);
    this.keys = Object.keys(this.list[0]);
    this.result = {};
    for (const [k, v] of Object.entries(this.list[0])) {
      if (v?.isColor) this.result[k] = new THREE.Color();
      else if (v?.isVector3) this.result[k] = new THREE.Vector3();
      else if (v?.isVector4) this.result[k] = new THREE.Vector4();
      else this.result[k] = 0;
    }
  }

  blend(weights) {
    const list = this.list,
      out = this.result;
    for (const k of this.keys) {
      const first = list[0][k];
      if (typeof first === "number") {
        let v = 0;
        for (let i = 0; i < list.length; i++) v += list[i][k] * weights[i];
        out[k] = v;
      } else if (first.isColor) {
        let r = 0,
          g = 0,
          b = 0;
        for (let i = 0; i < list.length; i++) {
          const c = list[i][k],
            w = weights[i];
          r += c.r * w;
          g += c.g * w;
          b += c.b * w;
        }
        out[k].setRGB(r, g, b);
      } else if (first.isVector4) {
        const t = out[k];
        t.set(0, 0, 0, 0);
        for (let i = 0; i < list.length; i++)
          t.addScaledVector(list[i][k], weights[i]);
      } else if (first.isVector3) {
        const t = out[k];
        t.set(0, 0, 0);
        for (let i = 0; i < list.length; i++)
          t.addScaledVector(list[i][k], weights[i]);
      }
    }
    return out;
  }
}

/**
 * Shared uniform block across all materials
 */
export const U = {
  uTime: { value: 0 },
  uWindTime: { value: 0 },
  uFlowTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.82, 0.57).normalize() },
  uSeasonW: { value: new THREE.Vector4(0, 1, 0, 0) },
  uSeasonBlend: { value: 1 },
  uNight: { value: 0 },
  uEvening: { value: 0 },
  uSnowLine: { value: 4.8 },
  uSnowCoverage: { value: 0 },
  uFrost: { value: 0 },
  uLush: { value: 0.5 },
  uDry: { value: 0 },
  uFreeze: { value: 0 },
  uFoam: { value: 1 },
  uWetness: { value: 0 },
  uGrassHeight: { value: 1 },
  uCanopy: { value: 1 },
  uFlowers: { value: 0.4 },
  uMeadowTint: { value: new THREE.Vector3(1, 1, 1) },
  uGrassBase: { value: new THREE.Color() },
  uGrassTip: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uHeightFog: { value: 0.3 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.5, -0.5) },
  uSunColor: { value: new THREE.Color() },
  uSkyTop: { value: new THREE.Color() },
  uSkyMid: { value: new THREE.Color() },
  uSkyBottom: { value: new THREE.Color() },
  uParticleRates: { value: new THREE.Vector4() },
  uFireflyRate: { value: 0 },
};

export const SHARED_DECL = /* glsl */ `
    uniform float uTime; uniform float uWindTime; uniform float uFlowTime; uniform vec2 uWindDir;
    uniform vec4 uSeasonW; uniform float uNight; uniform float uEvening;
    uniform float uSnowLine; uniform float uSnowCoverage; uniform float uFrost; uniform float uLush; uniform float uDry;
    uniform float uFreeze; uniform float uFoam; uniform float uWetness; uniform float uGrassHeight; uniform float uCanopy; uniform float uFlowers;
    uniform vec3 uMeadowTint; uniform vec3 uGrassBase; uniform vec3 uGrassTip;
    uniform vec3 uFogColor; uniform float uHeightFog; uniform vec3 uSunDir; uniform vec3 uSunColor;
`;

export const GLSL_NOISE = /* glsl */ `
    float sn_hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float sn_noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(sn_hash(i), sn_hash(i + vec2(1.0, 0.0)), f.x),
                   mix(sn_hash(i + vec2(0.0, 1.0)), sn_hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float sn_fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * sn_noise(p); p = p * 2.03 + vec2(17.2, 9.1); a *= 0.5; }
        return v;
    }
`;

export const WORLD_POS_CODE = /* glsl */ `
    {
        vec4 snWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
            snWp = instanceMatrix * snWp;
        #endif
        vWPos = (modelMatrix * snWp).xyz;
    }
`;

export const WORLD_NORMAL_CODE = /* glsl */ `
    {
        vec3 snN = objectNormal;
        #ifdef USE_INSTANCING
            snN = mat3(instanceMatrix) * snN;
        #endif
        vWNrm = normalize(mat3(modelMatrix) * snN);
    }
`;

export const HEIGHT_FOG_CODE = /* glsl */ `
    {
        float hfDist = length(vWPos - cameraPosition);
        float hfHeight = exp(-max(vWPos.y + 0.15, 0.0) * 0.15);
        float hf = uHeightFog * hfHeight * (1.0 - exp(-hfDist * 0.0035));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor * 1.08, clamp(hf, 0.0, 0.72));
    }
`;

export function patchMaterial(
  material,
  {
    key = "mat",
    uniforms = null,
    worldPos = false,
    worldNormal = false,
    heightFog = true,
    vertexPars = "",
    vertexBegin = "",
    fragmentPars = "",
    diffuse = "",
    fragmentColor = "",
    fragmentRoughness = "",
    fragmentEmissive = "",
    fragmentNormal = "",
  } = {},
) {
  const needWP = worldPos || heightFog || worldNormal;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    if (uniforms) Object.assign(shader.uniforms, uniforms);
    const varyings =
      (needWP ? "varying vec3 vWPos;\n" : "") +
      (worldNormal ? "varying vec3 vWNrm;\n" : "");
    let vs =
      SHARED_DECL +
      GLSL_NOISE +
      varyings +
      vertexPars +
      "\n" +
      shader.vertexShader;
    if (vertexBegin)
      vs = vs.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" + vertexBegin,
      );
    if (worldNormal)
      vs = vs.replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n" + WORLD_NORMAL_CODE,
      );
    if (needWP)
      vs = vs.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n" + WORLD_POS_CODE,
      );
    shader.vertexShader = vs;

    let fs =
      SHARED_DECL +
      GLSL_NOISE +
      varyings +
      fragmentPars +
      "\n" +
      shader.fragmentShader;
    if (diffuse)
      fs = fs.replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        diffuse,
      );
    if (fragmentColor)
      fs = fs.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" + fragmentColor,
      );
    if (fragmentRoughness)
      fs = fs.replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n" + fragmentRoughness,
      );
    if (fragmentNormal)
      fs = fs.replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\n" + fragmentNormal,
      );
    if (fragmentEmissive)
      fs = fs.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n" + fragmentEmissive,
      );
    if (heightFog)
      fs = fs.replace(
        "#include <fog_fragment>",
        "#include <fog_fragment>\n" + HEIGHT_FOG_CODE,
      );
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => "alpine-" + key;
  return material;
}

function tintSky(dst, src, tint, shade) {
  dst.setRGB(src.r * tint.x, src.g * tint.y, src.b * tint.z);
  const l = dst.r * 0.3 + dst.g * 0.59 + dst.b * 0.11;
  dst.r = lerp(dst.r, l, shade);
  dst.g = lerp(dst.g, l, shade);
  dst.b = lerp(dst.b, l, shade);
}

function makeRadialGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.14, "rgba(255,245,220,.7)");
  g.addColorStop(0.42, "rgba(255,220,180,.18)");
  g.addColorStop(1, "rgba(255,200,160,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMoonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d9dde6";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const r = 3 + Math.random() * 12;
    const x = Math.random() * 128,
      y = Math.random() * 128;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, "rgba(120,126,140,.55)");
    g.addColorStop(1, "rgba(120,126,140,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural Sky with 3-tier gradient dome, Sun/Moon bodies, radial corona, and twinkling stars
 */
export class ProceduralSky {
  constructor(scene) {
    this.scene = scene;
    this.glowColor = new THREE.Color();
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { ...U, uGlowColor: { value: this.glowColor } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
                varying vec3 vDir;
                void main() {
                    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
      fragmentShader:
        SHARED_DECL +
        GLSL_NOISE +
        /* glsl */ `
                uniform vec3 uSkyTop; uniform vec3 uSkyMid; uniform vec3 uSkyBottom; uniform vec3 uGlowColor;
                varying vec3 vDir;
                void main() {
                    vec3 dir = normalize(vDir);
                    float t = clamp(dir.y * 1.5 + 0.5, 0.0, 1.0);
                    vec3 sky = mix(uSkyBottom, uSkyMid, smoothstep(0.0, 0.42, t));
                    sky = mix(sky, uSkyTop, smoothstep(0.42, 1.0, t));
                    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
                    sky += uGlowColor * (pow(sd, 6.0) * 0.42 + pow(sd, 48.0) * 0.85);
                    sky = mix(sky, uFogColor, (1.0 - smoothstep(0.0, 0.18, abs(dir.y))) * 0.22);
                    float bd = dot(dir, normalize(vec3(0.35, 0.3, 0.88)));
                    float band = exp(-bd * bd * 14.0);
                    float mw = sn_fbm(dir.xz * 5.0 + dir.y * 3.0);
                    sky += vec3(0.22, 0.26, 0.42) * band * mw * uNight * 0.35;
                    gl_FragColor = vec4(sky, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(950, 48, 24),
      this.skyMaterial,
    );
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Sun body (HDR bloom)
    this.sun = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.2, 3),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.6, 2.3, 1.8),
        toneMapped: false,
        transparent: true,
        fog: false,
      }),
    );

    // Moon body with craters
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(6.2, 32, 16),
      new THREE.MeshBasicMaterial({
        map: makeMoonTexture(),
        color: new THREE.Color(1.6, 1.7, 1.9),
        toneMapped: false,
        transparent: true,
        fog: false,
      }),
    );

    // Radial aura glow sprite
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialGlowTexture(),
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.glow.scale.set(70, 70, 1);
    scene.add(this.sun, this.moon, this.glow);

    this.stars = this.createStars();
    scene.add(this.stars);

    this.createClouds();
  }

  createClouds() {
    this.cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
      fog: false,
    });
    this.cloudGroup = new THREE.Group();
    const presets = [
      { x: 18, y: 15, z: -19, s: 4.8 },
      { x: 26, y: 18, z: -27, s: 5.4 },
      { x: 20, y: 16, z: -13, s: 4.2 },
      { x: 30, y: 17, z: -21, s: 4.6 },
      { x: -15, y: 17, z: -24, s: 4.5 },
    ];
    this.cloudMeshes = presets.map((d, idx) => {
      const puffGroup = new THREE.Group();
      const n = 6;
      for (let j = 0; j < n; j++) {
        const r = 1.1 + ((j * 3) % 4) * 0.28;
        const g = new THREE.DodecahedronGeometry(r, 1);
        g.scale(1, 0.65, 1);
        const mesh = new THREE.Mesh(g, this.cloudMaterial);
        mesh.position.set((j - n / 2) * 1.35 + ((j * 5) % 3 - 1) * 0.35, ((j * 7) % 3 - 1) * 0.3, ((j * 11) % 3 - 1) * 0.5);
        puffGroup.add(mesh);
      }
      puffGroup.scale.setScalar(d.s * 0.24);
      puffGroup.position.set(d.x, d.y, d.z);
      puffGroup.userData = {
        angle: idx * 1.25,
        radius: 3.5 + (idx % 3) * 2.5,
        speed: 0.02 + (idx % 4) * 0.015,
        baseY: d.y,
        cx: d.x,
        cz: d.z,
      };
      this.cloudGroup.add(puffGroup);
      return puffGroup;
    });
    this.scene.add(this.cloudGroup);
  }

  createStars() {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const radius = 600 + Math.random() * 250;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(lerp(0.04, 1, Math.random()));
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      sizes[i] = 1.4 + Math.pow(Math.random(), 3) * 3.6;
      phases[i] = Math.random() * 6.283;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    this.starUniforms = {
      uStars: { value: 0 },
      uTime: U.uTime,
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
                attribute float aSize; attribute float aPhase;
                uniform float uTime; uniform float uPixelRatio;
                varying float vTwinkle;
                void main() {
                    vTwinkle = 0.65 + 0.35 * sin(uTime * (1.3 + fract(aPhase) * 2.0) + aPhase * 9.0);
                    gl_PointSize = aSize * uPixelRatio;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
      fragmentShader: /* glsl */ `
                uniform float uStars; varying float vTwinkle;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.0, d);
                    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * 1.6, a * a * uStars * vTwinkle);
                }
            `,
    });
    const pts = new THREE.Points(g, m);
    pts.rotation.z = -0.14;
    pts.frustumCulled = false;
    return pts;
  }

  update(controller, cameraPos) {
    const S = controller.season,
      T = controller.time;

    // Reposition sky dome and stars to follow camera
    if (cameraPos) {
      this.dome.position.copy(cameraPos);
      this.stars.position.copy(cameraPos);
    }

    // Update Sun / Moon celestial positions
    const sunDist = 68;
    const sPos = new THREE.Vector3()
      .copy(controller.lightDir)
      .multiplyScalar(sunDist)
      .add(cameraPos || new THREE.Vector3());
    const mPos = new THREE.Vector3()
      .copy(controller.lightDir)
      .multiplyScalar(-sunDist)
      .add(cameraPos || new THREE.Vector3());

    this.sun.position.copy(sPos);
    this.moon.position.copy(mPos);

    this.sun.material.opacity = T.sunBody;
    this.moon.material.opacity = T.moonBody;

    // Position glow sprite at dominant celestial body
    if (T.sunBody > 0.05) {
      this.glow.position.copy(sPos);
      this.glow.material.color.set(T.glow);
      this.glow.material.opacity = 0.75 * T.sunBody;
      const sc = 32 * T.glowScale;
      this.glow.scale.set(sc, sc, 1);
      this.glow.visible = true;
    } else if (T.moonBody > 0.05) {
      this.glow.position.copy(mPos);
      this.glow.material.color.set(T.glow);
      this.glow.material.opacity = 0.6 * T.moonBody;
      const sc = 50 * T.glowScale;
      this.glow.scale.set(sc, sc, 1);
      this.glow.visible = true;
    } else {
      this.glow.visible = false;
    }

    this.glowColor.set(T.glow).multiplyScalar(0.75);
    this.starUniforms.uStars.value = T.stars;

    // Drifting low-poly clouds
    if (this.cloudGroup && cameraPos) {
      this.cloudGroup.position.copy(cameraPos);
    }
    if (this.cloudMeshes) {
      const cloudColor = new THREE.Color(1, 1, 1);
      cloudColor.lerp(new THREE.Color(0.62, 0.66, 0.72), (S?.cloudShade || 0) * 1.4);
      cloudColor.lerp(new THREE.Color(0.1, 0.12, 0.22), (T?.night || 0) * 0.85);
      cloudColor.lerp(new THREE.Color(1.0, 0.78, 0.66), (1 - (T?.night || 0)) * (T?.evening || 0) * 0.45);
      this.cloudMaterial.color.copy(cloudColor);
      const dt = 0.016;
      for (const c of this.cloudMeshes) {
        const u = c.userData;
        u.angle += u.speed * dt;
        c.position.set(
          u.cx + Math.cos(u.angle) * u.radius,
          u.baseY + Math.sin(u.angle * 2) * 0.35,
          u.cz + Math.sin(u.angle) * u.radius,
        );
      }
    }
  }
}

/**
 * Seasonal Atmospheric Weather Particles (Instanced)
 * Supports:
 * - 0: Cherry blossom petals (Spring)
 * - 1: Golden pollen (Summer)
 * - 2: Autumn maple leaves (Autumn)
 * - 3: Falling snowflakes (Winter)
 * - 4: Fireflies / Glowflies (Summer night)
 */
export class SeasonalParticles {
  constructor(scene) {
    this.scene = scene;
    const typeCounts = [280, 200, 260, 480, 160]; // petals, pollen, leaves, snow, fireflies
    const total = typeCounts.reduce((a, b) => a + b, 0);
    const geo = new THREE.PlaneGeometry(1, 1);
    const types = new Float32Array(total);
    const seeds = new Float32Array(total * 4);
    let k = 0;
    typeCounts.forEach((c, type) => {
      for (let i = 0; i < c; i++, k++) {
        types[k] = type;
        for (let j = 0; j < 4; j++) seeds[k * 4 + j] = Math.random();
      }
    });
    geo.setAttribute("aType", new THREE.InstancedBufferAttribute(types, 1));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));

    this.center = new THREE.Vector3();
    this.uniforms = {
      uCenter: { value: this.center },
      uRadius: { value: 45.0 },
      uParticleRates: U.uParticleRates,
      uFireflyRate: U.uFireflyRate,
      uTime: U.uTime,
      uWindDir: U.uWindDir,
      uSunDir: U.uSunDir,
    };

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...U,
        ...this.uniforms,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader:
        SHARED_DECL +
        /* glsl */ `
                #include <fog_pars_vertex>
                attribute float aType; attribute vec4 aSeed;
                uniform vec4 uParticleRates; uniform float uFireflyRate;
                uniform vec3 uCenter; uniform float uRadius;
                varying vec2 vUv; varying float vAlpha; varying float vType; varying vec3 vColor; varying float vShade;

                float sn_pHash(float n) { return fract(sin(n) * 43758.5453123); }
                mat3 rotAxis(vec3 a, float ang) {
                    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
                    return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                                oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                                oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
                }

                void main() {
                    vType = aType; vUv = uv;
                    float fall = 0.0, size = 0.06, rate = 0.0;
                    bool tumbling = false, hovering = false;
                    if (aType < 0.5)      { fall = 0.85;  size = 0.16; rate = uParticleRates.x; tumbling = true; } // petals
                    else if (aType < 1.5) { fall = 0.0;   size = 0.06; rate = uParticleRates.y; hovering = true; } // pollen
                    else if (aType < 2.5) { fall = 1.05;  size = 0.22; rate = uParticleRates.z; tumbling = true; } // leaves
                    else if (aType < 3.5) { fall = 1.35;  size = 0.11; rate = uParticleRates.w; }                   // snow
                    else                  { fall = 0.0;   size = 0.14; rate = uFireflyRate; hovering = true; }     // fireflies

                    float speed = fall * (0.8 + aSeed.z * 0.4);
                    float top = aType < 0.5 ? 12.0 : (aType < 2.5 ? 9.0 : 16.0);
                    float life = hovering ? 8.0 + aSeed.z * 6.0 : (top + 2.0) / speed;
                    float t = uTime + aSeed.w * life * 7.0;
                    float cycle = floor(t / life);
                    float age = fract(t / life);
                    float ageSec = age * life;

                    vec3 c = vec3((sn_pHash(cycle * 12.9898 + aSeed.x * 78.233) - 0.5) * uRadius * 2.0, 0.0,
                                  (sn_pHash(cycle * 39.3467 + aSeed.y * 11.135) - 0.5) * uRadius * 2.0);
                    if (hovering) {
                        c.y = 0.6 + aSeed.z * 3.5 + sin(ageSec * 0.6 + aSeed.x * 20.0) * 0.4;
                        c.x += sin(ageSec * 0.5 + aSeed.y * 30.0) * 1.0 + uWindDir.x * ageSec * 0.25;
                        c.z += cos(ageSec * 0.43 + aSeed.x * 30.0) * 1.0 + uWindDir.y * ageSec * 0.25;
                    } else {
                        c.y = top + aSeed.z * 2.0 - ageSec * speed;
                        float fl = aType < 0.5 ? 0.6 : (aType < 2.5 ? 0.9 : 0.35);
                        c.xz += uWindDir * ageSec * (aType > 2.5 ? 0.6 : 0.8);
                        c.x += sin(ageSec * 1.7 + aSeed.x * 30.0) * fl;
                        c.z += cos(ageSec * 1.3 + aSeed.y * 30.0) * fl;
                    }

                    // Seamless toroidal wrap around center vehicle position
                    c.xz = mod(c.xz + uRadius, uRadius * 2.0) - uRadius;
                    vec3 worldOrigin = uCenter + c;

                    float threshold = fract(aSeed.x * 7.13 + aSeed.w * 3.1);
                    float presence = smoothstep(threshold, threshold + 0.1, rate * 1.15);
                    float edgeFade = 1.0 - smoothstep(uRadius * 0.78, uRadius * 0.98, length(c.xz));
                    float lifeFade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.86, 1.0, age));
                    float groundFade = smoothstep(-0.2, 0.5, worldOrigin.y);
                    vAlpha = presence * edgeFade * lifeFade * groundFade;
                    if (aType > 3.5) vAlpha *= 0.35 + 0.65 * pow(max(0.0, 0.5 + 0.5 * sin(uTime * (1.8 + aSeed.z * 2.0) + aSeed.x * 40.0)), 3.0);
                    if (vAlpha < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

                    vec3 local = vec3(position.xy, 0.0) * size * (0.75 + aSeed.y * 0.55);
                    vec3 world;
                    vec3 nrm = vec3(0.0, 0.0, 1.0);
                    if (tumbling) {
                        vec3 axis = normalize(vec3(aSeed.x - 0.5, aSeed.y - 0.2, aSeed.z - 0.5) + 0.001);
                        mat3 R = rotAxis(axis, ageSec * (1.6 + aSeed.w * 3.0) + aSeed.x * 6.28);
                        local = R * local;
                        nrm = R * nrm;
                        world = worldOrigin + local;
                    } else {
                        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                        world = worldOrigin + right * local.x + up * local.y;
                    }
                    vShade = abs(dot(nrm, normalize(uSunDir)));

                    if (aType < 0.5) vColor = mix(vec3(1.0, 0.65, 0.8), vec3(1.0, 0.94, 0.96), step(0.55, aSeed.y)); // petals
                    else if (aType < 1.5) vColor = vec3(1.0, 0.88, 0.45); // pollen
                    else if (aType < 2.5) {
                        float p = fract(aSeed.y * 5.7);
                        vColor = p < 0.3 ? vec3(0.82, 0.16, 0.06) : p < 0.6 ? vec3(0.96, 0.48, 0.08) : p < 0.85 ? vec3(0.96, 0.74, 0.14) : vec3(0.5, 0.28, 0.12);
                    }
                    else if (aType < 3.5) vColor = vec3(0.95, 0.98, 1.0); // snow
                    else vColor = vec3(0.92, 1.0, 0.38); // fireflies

                    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
      fragmentShader:
        SHARED_DECL +
        /* glsl */ `
                #include <fog_pars_fragment>
                varying vec2 vUv; varying float vAlpha; varying float vType; varying vec3 vColor; varying float vShade;
                void main() {
                    vec2 p = vUv - 0.5;
                    float a;
                    vec3 col = vColor;
                    if (vType < 0.5) { // Petal: rounded teardrop with notch
                        vec2 q = p * vec2(1.7, 1.15);
                        a = smoothstep(0.5, 0.42, length(q + vec2(0.0, 0.08 * sign(p.y))));
                        col *= 0.85 + 0.25 * vShade;
                    } else if (vType < 1.5) { // Pollen: glowing speck
                        a = smoothstep(0.5, 0.0, length(p));
                    } else if (vType < 2.5) { // Maple leaf: 3-lobed organic profile
                        float ang = atan(p.y, p.x);
                        float r = length(p);
                        float lobed = 0.35 + 0.14 * cos(ang * 5.0) + 0.06 * cos(ang * 3.0);
                        a = smoothstep(lobed, lobed - 0.05, r);
                        col *= 0.82 + 0.28 * vShade;
                    } else if (vType < 3.5) { // Snowflake: soft crystal fleck
                        float d = length(p);
                        a = smoothstep(0.48, 0.12, d);
                    } else { // Firefly: soft luminous core with breathing halo
                        float d = length(p);
                        a = smoothstep(0.5, 0.0, d) * 1.5;
                        col = mix(col, vec3(1.0), smoothstep(0.18, 0.0, d));
                    }
                    a *= vAlpha;
                    if (a < 0.005) discard;
                    gl_FragColor = vec4(col, a);
                    #include <fog_fragment>
                }
            `,
    });

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    scene.add(this.mesh);
  }

  update(cameraPos) {
    if (cameraPos) {
      this.center.set(cameraPos.x, 0, cameraPos.z);
    }
  }
}

/**
 * Master Season & Time-of-Day Controller
 */
export class SeasonController {
  constructor(initialSeason = 1, initialTime = 1) {
    this.seasons = new SeasonBlender(SEASONS);
    this.times = new SeasonBlender(TIMES);
    this.seasonIndex = initialSeason;
    this.timeIndex = initialTime;
    this.sW = [0, 0, 0, 0];
    this.sW[initialSeason] = 1;
    this.sFrom = [...this.sW];
    this.sTo = [...this.sW];
    this.tW = [0, 0, 0];
    this.tW[initialTime] = 1;
    this.tFrom = [...this.tW];
    this.tTo = [...this.tW];
    this.sProgress = 1;
    this.tProgress = 1;
    this.seasonDuration = 2.4; // 2.4s smooth transition
    this.timeDuration = 2.0; // 2.0s smooth transition
    this.listeners = [];
    this.season = this.seasons.blend(this.sW);
    this.time = this.times.blend(this.tW);
    this.lightDir = new THREE.Vector3();
    this.update(0);
  }

  on(fn) {
    this.listeners.push(fn);
  }
  emit(type) {
    for (const fn of this.listeners) fn(type, this);
  }

  get seasonKey() {
    return SEASONS[this.seasonIndex].key;
  }
  get seasonName() {
    return SEASONS[this.seasonIndex].name;
  }
  get timeKey() {
    return TIMES[this.timeIndex].key;
  }
  get timeName() {
    return TIMES[this.timeIndex].name;
  }

  setSeason(index) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= SEASONS.length ||
      index === this.seasonIndex
    )
      return;
    this.sFrom = [...this.sW];
    this.sTo = [0, 0, 0, 0];
    this.sTo[index] = 1;
    this.seasonIndex = index;
    this.sProgress = 0;
    this.emit("season");
  }

  setTime(index) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= TIMES.length ||
      index === this.timeIndex
    )
      return;
    this.tFrom = [...this.tW];
    this.tTo = [0, 0, 0];
    this.tTo[index] = 1;
    this.timeIndex = index;
    this.tProgress = 0;
    this.emit("time");
  }

  update(dt) {
    if (this.sProgress < 1) {
      this.sProgress = Math.min(1, this.sProgress + dt / this.seasonDuration);
      const e = easeInOut(this.sProgress);
      for (let i = 0; i < 4; i++)
        this.sW[i] = lerp(this.sFrom[i], this.sTo[i], e);
    }
    if (this.tProgress < 1) {
      this.tProgress = Math.min(1, this.tProgress + dt / this.timeDuration);
      const e = easeInOut(this.tProgress);
      for (let i = 0; i < 3; i++)
        this.tW[i] = lerp(this.tFrom[i], this.tTo[i], e);
    }
    const S = (this.season = this.seasons.blend(this.sW));
    const T = (this.time = this.times.blend(this.tW));

    U.uTime.value += dt;
    U.uWindTime.value += dt * (0.8 + S.flow * 0.4);

    this.lightDir.copy(T.lightDir).normalize();
    this.lightDir.y = Math.max(0.12, this.lightDir.y + S.sunElev);
    this.lightDir.normalize();

    U.uSeasonW.value.set(this.sW[0], this.sW[1], this.sW[2], this.sW[3]);
    U.uSeasonBlend.value = this.sProgress;
    U.uNight.value = T.night;
    U.uEvening.value = T.evening;
    U.uSnowLine.value = S.snowLine;
    U.uSnowCoverage.value = S.snowCoverage;
    U.uFrost.value = S.frost;
    U.uLush.value = S.lush;
    U.uDry.value = S.dry;
    U.uFreeze.value = S.freeze;
    U.uFoam.value = S.foam;
    U.uWetness.value = S.wetness;
    U.uGrassHeight.value = S.grassHeight;
    U.uCanopy.value = S.canopy;
    U.uFlowers.value = S.flowers;
    U.uMeadowTint.value.copy(S.meadowTint);
    U.uGrassBase.value.copy(S.grassBase);
    U.uGrassTip.value.copy(S.grassTip);
    U.uHeightFog.value = S.heightFog * (1 - T.night * 0.35);
    U.uFogColor.value.setRGB(
      clamp(T.fog.r * S.fogTint.x, 0, 1),
      clamp(T.fog.g * S.fogTint.y, 0, 1),
      clamp(T.fog.b * S.fogTint.z, 0, 1)
    );
    U.sunDir = this.lightDir;
    U.uSunDir.value.copy(this.lightDir);
    U.uSunColor.value.copy(T.sunColor);

    const p = S.particles;
    U.uParticleRates.value.set(
      p.x,
      p.y * (1 - T.night * 0.8),
      p.z,
      p.w * (1 + T.night * 0.6),
    );
    U.uFireflyRate.value =
      S.fireflies * clamp(T.night + this.tW[0] * 0.35, 0, 1);

    tintSky(U.uSkyTop.value, T.skyTop, S.skyTint, S.cloudShade);
    tintSky(U.uSkyMid.value, T.skyMid, S.skyTint, S.cloudShade);
    tintSky(U.uSkyBottom.value, T.skyBottom, S.skyTint, S.cloudShade);
  }
}
