import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, patchMaterial, GLSL_NOISE, SHARED_DECL, HEIGHT_FOG_CODE } from './seasons-environment.js';

const QUALITY = {
    GRASS_COUNT: 4500,
    SHADOW_MAP_SIZE: 2048,
    MAX_PIXEL_RATIO: 1.5,
    USE_BLOOM: true,
    MSAA_SAMPLES: 4,
    ADAPTIVE: false,
    PARTICLES: { petals: 360, pollen: 240, leaves: 300, snow: 1700, fireflies: 80 }
};

function createSafeCanvas(w = 256, h = 256) {
    if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
    return {
        width: w, height: h,
        getContext: () => ({
            fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '',
            fillRect: () => {}, strokeRect: () => {}, fillText: () => {},
            beginPath: () => {}, arc: () => {}, fill: () => {},
            createRadialGradient: () => ({ addColorStop: () => {} })
        })
    };
}

        /* ════════════════════════════════════════════════════════════════════
           WORLD LAYOUT (unchanged from the reference)
           ════════════════════════════════════════════════════════════════════ */
        const WORLD_SIZE = 15;
        const HALF_WORLD = WORLD_SIZE / 2;
        const BASE_HEIGHT = 0.1;
        const ROAD_WIDTH = 1.4;
        const ROAD_DIR_X = 0.707106;
        const ROAD_DIR_Z = 0.707106;
        const BRIDGE_X = -0.72, BRIDGE_Z = -0.72;
        const BRIDGE_ALONG = BRIDGE_X * ROAD_DIR_X + BRIDGE_Z * ROAD_DIR_Z;
        const PEAK_X = -4.5, PEAK_Z = 4.5;
        const HUT_X = 4.5, HUT_Z = -4.5;
        const WINDMILL_X = 2.0, WINDMILL_Z = -4.5;
        const CAMP_X = 5.75, CAMP_Z = -2.45;
        const CLIFF_BASE_Y = -3.2;

        const STREAM_POINTS = [
            [-4.92, 3.93], [-5.16, 3.58], [-5.52, 3.08], [-5.48, 2.63],
            [-5.08, 2.18], [-4.2, 1.25], [-3.15, 0.45], [-2.25, 0.35],
            [-1.5, 0.06], [-1.15, -0.29], [-0.72, -0.72], [-0.29, -1.15],
            [0.06, -1.5], [0.2, -2.2], [0.28, -3.15], [0.42, -4.35],
            [0.58, -5.7], [0.75, -7.15]
        ];
        const STREAM_LENGTH = (() => {
            const cumulative = [0];
            let total = 0;
            for (let i = 0; i < STREAM_POINTS.length - 1; i++) {
                const [ax, az] = STREAM_POINTS[i];
                const [bx, bz] = STREAM_POINTS[i + 1];
                total += Math.hypot(bx - ax, bz - az);
                cumulative.push(total);
            }
            return { cumulative, total };
        })();
        const BRIDGE_STREAM_INDEX = STREAM_POINTS.findIndex(([x, z]) => x === BRIDGE_X && z === BRIDGE_Z);
        const BRIDGE_STREAM_PROGRESS = STREAM_LENGTH.cumulative[BRIDGE_STREAM_INDEX] / STREAM_LENGTH.total;
        const BRIDGE_WATER_LEVEL = -0.095;
        const CASCADE_AT = 0.34;      // downstream fraction where the stream steps down (waterfall)

        /* ════════════════════════════════════════════════════════════════════
           MATH HELPERS (CPU side)
           ════════════════════════════════════════════════════════════════════ */
        const { clamp, lerp, smoothstep, degToRad } = THREE.MathUtils;

        // Deterministic PRNG so the diorama layout is identical on every load.
        const rand = (() => {
            let s = 0x2f6b1c ^ 20260926;
            return () => {
                s = (s + 0x6D2B79F5) | 0;
                let t = Math.imul(s ^ (s >>> 15), 1 | s);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        })();
        const randRange = (a, b) => a + (b - a) * rand();

        function hash(x, z) {
            const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
            return s - Math.floor(s);
        }

        function valueNoise(x, z) {
            const ix = Math.floor(x), iz = Math.floor(z);
            const fx = x - ix, fz = z - iz;
            const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
            const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
            return (1 - uz) * ((1 - ux) * a + ux * b) + uz * ((1 - ux) * c + ux * d);
        }

        function fbm(x, z, octaves = 4) {
            let v = 0, amp = 0.5, f = 1;
            for (let i = 0; i < octaves; i++) {
                v += valueNoise(x * f, z * f) * amp;
                f *= 2.03; amp *= 0.5;
            }
            return v;
        }

        // Ridged multifractal: sharp crests where noise crosses 0.5, weighted by the previous octave.
        function ridgedNoise(x, z) {
            let sum = 0, amp = 0.55, f = 1, prev = 1;
            for (let i = 0; i < 4; i++) {
                let n = 1 - Math.abs(valueNoise(x * f, z * f) * 2 - 1);
                n *= n;
                sum += n * amp * prev;
                prev = n;
                f *= 2.1; amp *= 0.5;
            }
            return sum;
        }

        function getLateralRoadDist(x, z) {
            return Math.abs(-x * ROAD_DIR_Z + z * ROAD_DIR_X);
        }

        function getStreamMetrics(x, z) {
            let closest = Infinity, progress = 0;
            for (let i = 0; i < STREAM_POINTS.length - 1; i++) {
                const [ax, az] = STREAM_POINTS[i];
                const [bx, bz] = STREAM_POINTS[i + 1];
                const abx = bx - ax, abz = bz - az;
                const lengthSq = abx * abx + abz * abz;
                const t = clamp(((x - ax) * abx + (z - az) * abz) / lengthSq, 0, 1);
                const distance = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
                if (distance < closest) {
                    closest = distance;
                    progress = (STREAM_LENGTH.cumulative[i] + Math.sqrt(lengthSq) * t) / STREAM_LENGTH.total;
                }
            }
            return { distance: closest, progress };
        }
        const distanceToStream = (x, z) => getStreamMetrics(x, z).distance;

        // Water level after the bridge: gentle descent plus a small cascade step.
        function getDownstreamWaterHeight(progress) {
            const d = clamp((progress - BRIDGE_STREAM_PROGRESS) / (1 - BRIDGE_STREAM_PROGRESS), 0, 1);
            const eased = d * d * (3 - 2 * d);
            const cascade = smoothstep(d, CASCADE_AT - 0.012, CASCADE_AT + 0.022);
            return BRIDGE_WATER_LEVEL - d * 0.16 - eased * 0.1 - cascade * 0.2;
        }

        // Matterhorn-like massif: a pyramidal body with four arêtes, a sharp leaning horn and ridged crags.
        function mountainHeight(x, z) {
            const dx = x - PEAK_X, dz = z - PEAK_Z;
            const d = Math.hypot(dx, dz);
            if (d >= 7.2) return 0;
            const t = 1 - d / 7.2;
            const ang = Math.atan2(dz, dx);
            const faces = Math.pow(Math.abs(Math.cos(2 * (ang + 0.42))), 0.65);
            const body = Math.pow(t, 2.05) * 4.2;
            const horn = Math.pow(Math.max(0, 1 - Math.hypot(x - (PEAK_X + 0.2), z - (PEAK_Z - 0.15)) / 1.7), 1.35) * 1.85;
            const ridges = ridgedNoise(x * 0.85 + 11.3, z * 0.85 - 4.1);
            let h = (body + horn) * (0.8 + ridges * 0.4);
            h += faces * t * t * 0.9 * (0.55 + ridges * 0.6);
            h += (valueNoise(x * 4.3, z * 4.3) - 0.5) * 0.2 * t;
            return h;
        }

        function getTerrainHeight(x, z) {
            if (Math.abs(x) > HALF_WORLD + 1e-4 || Math.abs(z) > HALF_WORLD + 1e-4) return -3.5;
            let h = BASE_HEIGHT + mountainHeight(x, z);

            // Gentle rolling hills
            h += valueNoise(x * 0.8, z * 0.8) * 0.35 + valueNoise(x * 0.3, z * 0.3) * 0.5;

            // Shallow stream channel
            const stream = getStreamMetrics(x, z);
            const streamDist = stream.distance;
            if (streamDist < 0.62) h -= (1 - smoothstep(streamDist, 0.08, 0.62)) * 0.18;

            // Flat road carve along the x = z diagonal
            const latDist = getLateralRoadDist(x, z);
            const roadShoulder = ROAD_WIDTH / 2 + 0.6;
            if (latDist < roadShoulder) {
                const t = clamp((latDist - ROAD_WIDTH / 2) / (roadShoulder - ROAD_WIDTH / 2), 0, 1);
                const s = t * t * (3 - 2 * t);
                h = 0.05 * (1 - s) + h * s;
            }

            // Stream banks outside the bridge deck → real underpass depth
            if (streamDist < 0.62) {
                const channel = 1 - smoothstep(streamDist, 0.08, 0.62);
                const outsideDeck = smoothstep(latDist, ROAD_WIDTH / 2 - 0.04, 1.08);
                const nearBridge = 1 - smoothstep(latDist, 1.18, 1.62);
                h -= channel * outsideDeck * nearBridge * 0.42;
            }

            // Downstream bed follows the descending water surface (including the cascade)
            if (stream.progress >= BRIDGE_STREAM_PROGRESS && streamDist < 0.68) {
                const water = getDownstreamWaterHeight(stream.progress);
                const bed = lerp(h, water - 0.085, 1 - smoothstep(streamDist, 0.06, 0.68));
                h = Math.min(h, bed);
            }
            return h;
        }

        const nonIndexed = (g) => (g.index ? g.toNonIndexed() : g);

        // Shared scratch objects — nothing below allocates inside the frame loop.
        const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
        const _obj = new THREE.Object3D();
        const _color = new THREE.Color();


        const snowDustCode = (amount = '1.0') => /* glsl */`
            {
                float sdN = sn_noise(vWPos.xz * 3.1) * 0.6 + sn_noise(vWPos.xz * 9.0) * 0.4;
                float sd = uSnowCoverage * (${amount}) * smoothstep(0.38, 0.78, vWNrm.y + (sdN - 0.5) * 0.5);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.97), sd);
            }
        `;


        /* ════════════════════════════════════════════════════════════════════
           STATIC BATCHING — merges one-off prop parts per material so the chalet,
           windmill, bridge etc. cost a handful of draw calls instead of hundreds.
           ════════════════════════════════════════════════════════════════════ */
        class StaticBatch {
            constructor() { this.parts = new Map(); }
            add(geometry, material, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
                _obj.position.set(px, py, pz);
                _obj.rotation.set(rx, ry, rz);
                _obj.scale.set(sx, sy, sz);
                _obj.updateMatrix();
                return this.addMatrix(geometry, material, _obj.matrix);
            }
            addMatrix(geometry, material, matrix) {
                let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
                for (const name of Object.keys(g.attributes)) {
                    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
                }
                if (!g.attributes.normal) g.computeVertexNormals();
                if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
                g.clearGroups();
                g.applyMatrix4(matrix);
                if (!this.parts.has(material)) this.parts.set(material, []);
                this.parts.get(material).push(g);
                return this;
            }
            box(material, w, h, d, px, py, pz, rx = 0, ry = 0, rz = 0) {
                return this.add(new THREE.BoxGeometry(w, h, d), material, px, py, pz, rx, ry, rz);
            }
            build(parent, { castShadow = true, receiveShadow = true } = {}) {
                for (const [material, geos] of this.parts) {
                    const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
                    mesh.castShadow = castShadow;
                    mesh.receiveShadow = receiveShadow;
                    parent.add(mesh);
                    geos.forEach(g => g.dispose());
                }
                this.parts.clear();
            }
        }

        const stdMat = (color, roughness = 0.9, extra = {}) =>
            new THREE.MeshStandardMaterial({ color, roughness, flatShading: true, ...extra });

        function makeDepthMaterial(key, vertexPars, vertexBegin) {
            const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
            mat.onBeforeCompile = (shader) => {
                Object.assign(shader.uniforms, U);
                shader.vertexShader = SHARED_DECL + GLSL_NOISE + vertexPars + '\n' +
                    shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertexBegin);
            };
            mat.customProgramCacheKey = () => 'alpine-depth-' + key;
            return mat;
        }

        /* Snow slabs on props (hut roof, windmill cap, bridge rails, car roofs).
           Geometry sits on local y = 0; the vertex shader scales thickness by uSnowCoverage
           so snow visibly builds up and melts away. While thin, the slab is sunk slightly
           below its host surface and grows up out of it, so the two never share a plane
           (a near-zero-thickness slab on the roof top caused z-fighting during blends). */
        const SNOW_SLAB_MIN_COVERAGE = 0.08;   // below this the slabs are fully hidden
        const snowSlabMaterial = patchMaterial(
            new THREE.MeshStandardMaterial({ color: 0xf3f7fb, roughness: 0.82 }),
            {
                key: 'snow-slab',
                worldPos: true,
                vertexBegin: /* glsl */`
                    float slabS = smoothstep(0.02, 0.9, uSnowCoverage);
                    transformed.y = transformed.y * max(slabS, 0.001) - 0.03 * (1.0 - slabS);
                    transformed.xz *= mix(0.92, 1.0, slabS);
                `,
                fragmentColor: /* glsl */`
                    diffuseColor.rgb *= 0.93 + 0.07 * sn_noise(vWPos.xz * 18.0);
                `
            }
        );
        const snowSlab = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);


        /* ════════════════════════════════════════════════════════════════════
           TERRAIN — heightfield with baked strata, scree, AO; seasonal coloring
           and snow in the fragment shader.
           Reads: uSnowLine, uSnowCoverage, uFrost, uLush, uDry, uMeadowTint, uHeightFog.
           ════════════════════════════════════════════════════════════════════ */
        class Terrain {
            constructor(scene) {
                this.scene = scene;
                this.buildSurface();
                this.buildCliffs();
                this.buildBoulders();
            }

            buildSurface() {
                const SEG = 120;
                const step = WORLD_SIZE / SEG;
                const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
                geo.rotateX(-Math.PI / 2);
                const pos = geo.attributes.position;
                const heights = new Float32Array(pos.count);
                for (let i = 0; i < pos.count; i++) {
                    heights[i] = getTerrainHeight(pos.getX(i), pos.getZ(i));
                    pos.setY(i, heights[i]);
                }
                const W = SEG + 1;
                const hAt = (ix, iz) => heights[clamp(iz, 0, SEG) * W + clamp(ix, 0, SEG)];

                const colors = new Float32Array(pos.count * 3);
                const mats = new Float32Array(pos.count * 3);
                const cMeadowA = new THREE.Color(0x3f6b2b), cMeadowB = new THREE.Color(0x679546);
                const cRockA = new THREE.Color(0x57534f), cRockB = new THREE.Color(0x8a8279), cRockHi = new THREE.Color(0x9c9a99);
                const cScreeA = new THREE.Color(0x6f685b), cScreeB = new THREE.Color(0x938b7d);
                const cDirt = new THREE.Color(0x59463c), cBank = new THREE.Color(0x5f5a4e);
                const col = new THREE.Color(), tmp = new THREE.Color();

                for (let iz = 0; iz <= SEG; iz++) {
                    for (let ix = 0; ix <= SEG; ix++) {
                        const i = iz * W + ix;
                        const x = pos.getX(i), z = pos.getZ(i), h = heights[i];
                        const gx = (hAt(ix + 1, iz) - hAt(ix - 1, iz)) / (2 * step);
                        const gz = (hAt(ix, iz + 1) - hAt(ix, iz - 1)) / (2 * step);
                        const slope = Math.hypot(gx, gz);
                        const lap = (hAt(ix + 1, iz) + hAt(ix - 1, iz) + hAt(ix, iz + 1) + hAt(ix, iz - 1)) / 4 - h;
                        const n = valueNoise(x * 0.6, z * 0.6), n2 = valueNoise(x * 2.3, z * 2.3);
                        const dPeak = Math.hypot(x - PEAK_X, z - PEAK_Z);
                        const lat = getLateralRoadDist(x, z);
                        const sd = distanceToStream(x, z);

                        const rock = Math.max(smoothstep(h, 1.3, 2.2), smoothstep(slope, 1.0, 1.7));
                        const scree = (1 - smoothstep(dPeak, 5.0, 6.6)) * (1 - rock) * smoothstep(h, 0.45, 0.95);
                        const dirt = lat < ROAD_WIDTH / 2 + 0.3 ? 1 : 0;
                        const bank = (1 - smoothstep(sd, 0.18, 0.36)) * (1 - rock);

                        // Meadow
                        col.lerpColors(cMeadowA, cMeadowB, clamp((h - BASE_HEIGHT) * 0.7 + n * 0.35, 0, 1));
                        // Rock with strata banding, lighter towards the summit
                        const band = 0.5 + 0.5 * Math.sin(h * 7.5 + n2 * 2.6 + x * 0.3);
                        tmp.lerpColors(cRockA, cRockB, band * 0.8 + n2 * 0.2);
                        tmp.lerp(cRockHi, smoothstep(h, 3.4, 6.0) * 0.7);
                        col.lerp(tmp, rock);
                        tmp.lerpColors(cScreeA, cScreeB, n2);
                        col.lerp(tmp, scree * 0.85);
                        col.lerp(cBank, bank * 0.7);
                        if (dirt) col.lerp(cDirt, 1 - rock);

                        // Baked ambient occlusion from local concavity
                        const ao = clamp(1 - Math.max(lap, 0) * 4.5, 0.5, 1) * (0.9 + 0.1 * clamp(1 - Math.max(-lap, 0) * 2, 0, 1) + 0.1 * smoothstep(-lap, 0, 0.05));
                        col.multiplyScalar(clamp(ao, 0.5, 1.05));

                        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
                        const meadow = clamp(1 - rock - scree * 0.8 - dirt - bank * 0.6, 0, 1);
                        mats[i * 3] = meadow; mats[i * 3 + 1] = rock; mats[i * 3 + 2] = dirt;
                    }
                }
                geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                geo.setAttribute('aMat', new THREE.BufferAttribute(mats, 3));
                geo.computeVertexNormals();

                const material = patchMaterial(
                    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true }),
                    {
                        key: 'terrain',
                        worldPos: true,
                        vertexPars: 'attribute vec3 aMat; varying vec3 vMat;',
                        vertexBegin: 'vMat = aMat;',
                        fragmentPars: 'varying vec3 vMat;',
                        fragmentColor: /* glsl */`
                            vec3 wp = vWPos;
                            vec3 fN = normalize(cross(dFdx(wp), dFdy(wp)) + vec3(0.0, 1e-6, 0.0));
                            float up = abs(fN.y);
                            float n1 = sn_fbm(wp.xz * 0.9);
                            float n2 = sn_noise(wp.xz * 6.5);
                            float meadow = vMat.x;
                            vec3 col = diffuseColor.rgb;

                            // Spring: lush saturation. All seasons: meadow tint.
                            float lum = dot(col, vec3(0.299, 0.587, 0.114));
                            col = mix(col, mix(vec3(lum), col, 1.0 + 0.55 * uLush) * uMeadowTint, meadow);
                            // Autumn: dry golden patches.
                            float dryMask = uDry * meadow * smoothstep(0.42, 0.66, n1 + n2 * 0.15);
                            col = mix(col, vec3(0.4, 0.27, 0.09) * (0.8 + n2 * 0.4), dryMask * 0.75);
                            // Winter: frost on the meadow.
                            col = mix(col, vec3(0.6, 0.66, 0.7), uFrost * meadow * (0.35 + 0.25 * n2));

                            // Snow: height line + noise, only on flat enough faces (steep rock stays bare).
                            float snowEdge = wp.y + (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.25;
                            float snowBand = smoothstep(uSnowLine - 0.2, uSnowLine + 0.3, snowEdge);
                            float flatMask = smoothstep(0.5 - 0.12 * uSnowCoverage, 0.8, up);
                            float snSnow = snowBand * flatMask;
                            col = mix(col, vec3(0.86, 0.9, 0.96) * (0.94 + 0.06 * n2), snSnow);

                            // Road paint, snowy shoulders and wet asphalt in winter.
                            float snWet = 0.0;
                            float lat = abs(-wp.x * 0.707106 + wp.z * 0.707106);
                            float along = wp.x * 0.707106 + wp.z * 0.707106;
                            if (lat < 0.72 && wp.y < 0.2 && abs(wp.x) < 7.5 && abs(wp.z) < 7.5) {
                                vec3 asphalt = vec3(0.18, 0.19, 0.21) * mix(1.0, 0.5, uSnowCoverage);
                                float dash = step(0.5, fract(along * 0.75));
                                float isCenter = step(lat, 0.02) * dash;
                                float isEdge = step(abs(lat - 0.6), 0.025);
                                vec3 roadCol = mix(asphalt, vec3(0.9, 0.75, 0.1), isCenter);
                                roadCol = mix(roadCol, vec3(0.85), isEdge);
                                float edgeSnow = uSnowCoverage * smoothstep(0.5, 0.68, lat + (n2 - 0.5) * 0.14);
                                roadCol = mix(roadCol, vec3(0.84, 0.88, 0.93), edgeSnow);
                                float shoulder = smoothstep(0.7, 0.72, lat);
                                col = mix(roadCol, col, shoulder);
                                snWet = uSnowCoverage * (1.0 - edgeSnow) * (1.0 - shoulder);
                                snSnow *= shoulder;
                            }
                            diffuseColor.rgb = col;
                        `,
                        fragmentRoughness: /* glsl */`
                            roughnessFactor = mix(roughnessFactor, 0.26, snWet);
                            roughnessFactor = mix(roughnessFactor, 0.7, snSnow * 0.6);
                        `
                    }
                );
                this.mesh = new THREE.Mesh(geo, material);
                this.mesh.castShadow = true;
                this.mesh.receiveShadow = true;
                this.scene.add(this.mesh);
            }

            // Cliff walls with rock strata bands and a winter snow lip along the top edge.
            buildCliffs() {
                const SEG = 120, ROWS = 16;
                const corners = [[-HALF_WORLD, -HALF_WORLD], [HALF_WORLD, -HALF_WORLD], [HALF_WORLD, HALF_WORLD], [-HALF_WORLD, HALF_WORLD], [-HALF_WORLD, -HALF_WORLD]];
                const strata = [0x5b4a3f, 0x6e5d4e, 0x463830, 0x7d6c5a, 0x54473d].map(c => new THREE.Color(c));
                const deep = new THREE.Color(0x120a06), soil = new THREE.Color(0x3a2a1f), rockTop = new THREE.Color(0x4b4845);
                const positions = [], colors = [], tops = [], indices = [];
                const col = new THREE.Color();
                let base = 0;
                for (let s = 0; s < 4; s++) {
                    const [ax, az] = corners[s], [bx, bz] = corners[s + 1];
                    for (let i = 0; i <= SEG; i++) {
                        const t = i / SEG;
                        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
                        const h = getTerrainHeight(x, z);
                        const wobble = valueNoise(x * 1.7 + z * 1.7, 3.1);
                        for (let r = 0; r <= ROWS; r++) {
                            let y;
                            if (r === 0) y = h;
                            else if (r === 1) y = h - 0.1;
                            else y = lerp(h - 0.3, CLIFF_BASE_Y, (r - 2) / (ROWS - 2));
                            positions.push(x, y, z);
                            tops.push(h);
                            if (r <= 1) col.copy(h > 2.0 ? rockTop : soil);
                            else {
                                const k = Math.floor(Math.abs(Math.sin(y * 2.9 + wobble * 2.2) * 997)) % strata.length;
                                col.copy(strata[k]);
                                col.lerp(deep, Math.pow(1 - (y - CLIFF_BASE_Y) / Math.max(h - CLIFF_BASE_Y, 0.1), 1.6) * 0.85);
                            }
                            colors.push(col.r, col.g, col.b);
                        }
                    }
                    for (let i = 0; i < SEG; i++) {
                        for (let r = 0; r < ROWS; r++) {
                            const a = base + i * (ROWS + 1) + r, b = a + 1;
                            const c = base + (i + 1) * (ROWS + 1) + r, d = c + 1;
                            indices.push(a, b, c, b, d, c);
                        }
                    }
                    base += (SEG + 1) * (ROWS + 1);
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                geo.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
                geo.setIndex(indices);
                geo.computeVertexNormals();
                const material = patchMaterial(
                    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05, flatShading: true }),
                    {
                        key: 'cliff', worldPos: true, heightFog: false,
                        vertexPars: 'attribute float aTop; varying float vTop;',
                        vertexBegin: 'vTop = aTop;',
                        fragmentPars: 'varying float vTop;',
                        fragmentColor: /* glsl */`
                            float lipDepth = 0.06 + 0.1 * sn_noise(vec2(vWPos.x + vWPos.z, vWPos.y) * 6.0);
                            float lip = uSnowCoverage * (1.0 - smoothstep(lipDepth, lipDepth + 0.04, vTop - vWPos.y));
                            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), lip);
                        `
                    }
                );
                const cliffs = new THREE.Mesh(geo, material);
                cliffs.castShadow = true;
                cliffs.receiveShadow = true;
                this.scene.add(cliffs);

                const bottom = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE).rotateX(Math.PI / 2), stdMat(0x0e0705));
                bottom.position.y = CLIFF_BASE_Y;
                this.scene.add(bottom);
            }

            // Scattered instanced boulders on the scree and meadow; snow settles on their tops.
            buildBoulders() {
                this.rockGeometry = makeRockGeometry();
                this.rockMaterial = patchMaterial(stdMat(0xffffff, 0.92), {
                    key: 'boulder', worldNormal: true, fragmentColor: snowDustCode('1.0')
                });
                const count = 46;
                const mesh = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, count);
                let placed = 0;
                for (let tries = 0; tries < 3000 && placed < count; tries++) {
                    const nearMountain = placed < 30;
                    let x, z;
                    if (nearMountain) {
                        const a = rand() * Math.PI * 2, r = randRange(3.4, 6.4);
                        x = PEAK_X + Math.cos(a) * r; z = PEAK_Z + Math.sin(a) * r;
                    } else {
                        x = randRange(-7, 7); z = randRange(-7, 7);
                    }
                    if (Math.abs(x) > 7 || Math.abs(z) > 7) continue;
                    const h = getTerrainHeight(x, z);
                    if (getLateralRoadDist(x, z) < ROAD_WIDTH / 2 + 0.5) continue;
                    if (distanceToStream(x, z) < 0.45) continue;
                    if (Math.hypot(x - HUT_X, z - HUT_Z) < 1.9 || Math.hypot(x - WINDMILL_X, z - WINDMILL_Z) < 1.3 || Math.hypot(x - CAMP_X, z - CAMP_Z) < 1.2) continue;
                    if (h > 2.8) continue;
                    const s = nearMountain ? randRange(0.12, 0.34) : randRange(0.08, 0.2);
                    _obj.position.set(x, h - s * 0.25, z);
                    _obj.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
                    _obj.scale.set(s * randRange(0.9, 1.4), s * randRange(0.55, 0.9), s * randRange(0.9, 1.3));
                    _obj.updateMatrix();
                    mesh.setMatrixAt(placed, _obj.matrix);
                    const g = randRange(0.42, 0.62);
                    mesh.setColorAt(placed, _color.setRGB(g, g * 0.96, g * 0.92));
                    placed++;
                }
                mesh.count = placed;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor.needsUpdate = true;
                this.scene.add(mesh);
            }
        }

        // Low-poly jittered rock shared by boulders, stream stones and cascade rocks.
        function makeRockGeometry() {
            let g = new THREE.IcosahedronGeometry(1, 1);
            g.deleteAttribute('normal');
            g.deleteAttribute('uv');
            g = mergeVertices(g);
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) {
                _v1.fromBufferAttribute(p, i);
                const k = 0.78 + 0.4 * valueNoise(_v1.x * 2.1 + 5, _v1.z * 2.1 + _v1.y * 1.3);
                _v1.multiplyScalar(k);
                if (_v1.y < -0.2) _v1.y *= 0.5;
                p.setXYZ(i, _v1.x, _v1.y, _v1.z);
            }
            g.computeVertexNormals();
            return g;
        }

        /* ════════════════════════════════════════════════════════════════════
           MIST PUFFS — tiny shader-animated point clouds (spring source, cascade).
           No CPU updates. Reads: uTime, uFreeze, uNight.
           ════════════════════════════════════════════════════════════════════ */
        class MistPuff {
            constructor(parent, { count = 34, radius = 0.34, height = 0.5, size = 26, opacity = 0.42 } = {}) {
                const pos = new Float32Array(count * 3);
                const seed = new Float32Array(count);
                for (let i = 0; i < count; i++) {
                    const a = rand() * Math.PI * 2, r = rand() * radius;
                    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = Math.sin(a) * r;
                    seed[i] = rand();
                }
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
                this.uniforms = { uHeight: { value: height }, uSize: { value: size }, uOpacity: { value: opacity }, uPixelRatio: { value: 1 } };
                const m = new THREE.ShaderMaterial({
                    uniforms: { ...U, ...this.uniforms },
                    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                    vertexShader: SHARED_DECL + /* glsl */`
                        attribute float aSeed; uniform float uHeight; uniform float uSize; uniform float uPixelRatio;
                        varying float vA;
                        void main() {
                            float life = fract(uTime * (0.18 + aSeed * 0.2) + aSeed * 7.0);
                            vec3 p = position;
                            p.y += life * uHeight;
                            p.x += sin(uTime * 1.3 + aSeed * 20.0) * 0.05 * life;
                            p.z += cos(uTime * 1.1 + aSeed * 13.0) * 0.05 * life;
                            vA = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.55, 1.0, life));
                            vec4 mv = modelViewMatrix * vec4(p, 1.0);
                            gl_PointSize = uSize * uPixelRatio * (0.6 + life) / -mv.z;
                            gl_Position = projectionMatrix * mv;
                        }
                    `,
                    fragmentShader: SHARED_DECL + /* glsl */`
                        uniform float uOpacity; varying float vA;
                        void main() {
                            float d = length(gl_PointCoord - 0.5);
                            float a = smoothstep(0.5, 0.05, d) * vA * uOpacity * (1.0 - uFreeze * 0.9);
                            gl_FragColor = vec4(mix(vec3(0.85, 0.97, 1.0), vec3(0.45, 0.6, 0.85), uNight) * a, a);
                        }
                    `
                });
                this.points = new THREE.Points(g, m);
                this.points.frustumCulled = false;
                parent.add(this.points);
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           STREAM — spline ribbon with flow, depth tint, caustics, fresnel sky,
           rock foam wakes, cascade whitewater and gradual winter freeze.
           Reads: uFlowTime, uFreeze, uFoam, uSnowCoverage, uNight, uSunDir, uSky*.
           ════════════════════════════════════════════════════════════════════ */
        class Stream {
            constructor(scene, rockGeometry, rockMaterial) {
                this.scene = scene;
                this.curve = new THREE.CatmullRomCurve3(
                    STREAM_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.4
                );
                this.length = this.curve.getLength();
                this.mists = [];
                this.buildWater();
                this.buildRocks(rockGeometry, rockMaterial);
                this.buildSource();
            }

            sample(t) {
                const point = this.curve.getPoint(t);
                const tangent = this.curve.getTangent(t).normalize();
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const taper = smoothstep(t, 0.0, 0.13);
                const width = 0.075 + taper * (0.19 + Math.sin(t * Math.PI) * 0.13 + Math.sin(t * 19) * 0.024);
                const roadDistance = getLateralRoadDist(point.x, point.z);
                const natural = getTerrainHeight(point.x, point.z) + 0.052;
                const bridgeBlend = smoothstep(roadDistance, 0.52, 1.14);
                const progress = getStreamMetrics(point.x, point.z).progress;
                const y = progress >= BRIDGE_STREAM_PROGRESS
                    ? getDownstreamWaterHeight(progress)
                    : lerp(BRIDGE_WATER_LEVEL, natural, bridgeBlend);
                return { point, normal, width, y, progress };
            }

            buildWater() {
                const segments = 180;
                const positions = [], uvs = [], indices = [];
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const { point, normal, width, y } = this.sample(t);
                    positions.push(point.x + normal.x * width, y, point.z + normal.z * width);
                    positions.push(point.x - normal.x * width, y, point.z - normal.z * width);
                    uvs.push(0, t * 11, 1, t * 11);
                    if (i < segments) {
                        const a = i * 2;
                        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                    }
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
                geo.setIndex(indices);
                geo.computeVertexNormals();

                this.rockUniform = Array.from({ length: 8 }, () => new THREE.Vector4(-10, -10, 1, 1));
                this.material = new THREE.ShaderMaterial({
                    uniforms: {
                        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
                        ...U,
                        uRocks: { value: this.rockUniform }
                    },
                    fog: true,
                    transparent: true,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    vertexShader: SHARED_DECL + /* glsl */`
                        #include <fog_pars_vertex>
                        varying vec2 vUv; varying vec3 vWorldPosition; varying float vSlope; varying float vWave;
                        void main() {
                            vUv = uv;
                            vec3 p = position;
                            float calm = 1.0 - uFreeze;
                            float primary = sin(uv.y * 10.0 - uFlowTime * 3.5 + uv.x * 5.0);
                            float secondary = sin(uv.y * 23.0 - uFlowTime * 5.2 - uv.x * 8.0);
                            vWave = (primary * 0.58 + secondary * 0.24) * calm;
                            p.y += vWave * 0.008;
                            vec4 world = modelMatrix * vec4(p, 1.0);
                            vWorldPosition = world.xyz;
                            vSlope = clamp(1.0 - abs(normalize(mat3(modelMatrix) * normal).y), 0.0, 1.0);
                            vec4 mvPosition = viewMatrix * world;
                            gl_Position = projectionMatrix * mvPosition;
                            #include <fog_vertex>
                        }
                    `,
                    fragmentShader: SHARED_DECL + GLSL_NOISE + /* glsl */`
                        #include <fog_pars_fragment>
                        uniform vec3 uSkyTop; uniform vec3 uSkyBottom;
                        uniform vec4 uRocks[8];
                        varying vec2 vUv; varying vec3 vWorldPosition; varying float vSlope; varying float vWave;

                        float voronoiEdge(vec2 p) {
                            vec2 i = floor(p), f = fract(p);
                            float d1 = 8.0, d2 = 8.0;
                            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                                vec2 g = vec2(float(x), float(y));
                                vec2 o = vec2(sn_hash(i + g), sn_hash(i + g + 17.31));
                                vec2 r = g + o - f;
                                float d = dot(r, r);
                                if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
                            }
                            return sqrt(d2) - sqrt(d1);
                        }

                        void main() {
                            float flowTime = uFlowTime * 1.25;
                            vec2 flowUv = vec2(vUv.x * 4.2, vUv.y * 1.35 - flowTime);
                            float largeFlow = sn_fbm(flowUv + vec2(sin(vUv.y * 0.7), 0.0));
                            float fineFlow = sn_fbm(flowUv * 2.65 + vec2(4.7, -flowTime * 0.8));
                            float current = smoothstep(0.34, 0.84, largeFlow * 0.72 + fineFlow * 0.36 + vWave * 0.08);
                            float bankDistance = min(vUv.x, 1.0 - vUv.x);
                            float depth = smoothstep(0.0, 0.42, bankDistance);

                            // Foam: banks, rapids, the cascade and wakes behind stones.
                            float bankFoam = (1.0 - smoothstep(0.025, 0.23, bankDistance))
                                * smoothstep(0.44, 0.76, sn_fbm(vec2(vUv.y * 2.9 - flowTime * 1.7, vUv.x * 7.0)));
                            float rapidBands = sin(vUv.y * 29.0 - flowTime * 5.8 + fineFlow * 7.0) * 0.5 + 0.5;
                            float rapidFoam = smoothstep(0.78, 0.98, rapidBands) * (0.12 + vSlope * 2.2);
                            float cascade = smoothstep(0.06, 0.26, vSlope) * (0.55 + 0.45 * fineFlow);
                            float wake = 0.0;
                            for (int i = 0; i < 8; i++) {
                                vec4 r = uRocks[i];
                                vec2 d = vec2((vUv.x - r.x) / r.z, (vUv.y - r.y) / r.w);
                                float rd = length(d) - 1.05;
                                float ring = exp(-rd * rd * 7.0);
                                float trail = step(0.0, d.y) * exp(-d.x * d.x * 1.3) * exp(-d.y * 0.28);
                                float churn = smoothstep(0.3, 0.7, sn_noise(vec2(d.x * 2.2, d.y * 0.9 - flowTime * 5.0)));
                                wake += (ring * 0.9 + trail * 0.75) * churn;
                            }
                            float foam = clamp((bankFoam * 0.92 + rapidFoam + wake) * clamp(uFoam, 0.2, 1.6) + cascade, 0.0, 1.0);

                            vec3 deepColor = mix(vec3(0.018, 0.17, 0.23), vec3(0.008, 0.035, 0.095), uNight);
                            vec3 shallowColor = mix(vec3(0.09, 0.58, 0.68), vec3(0.025, 0.25, 0.48), uNight);
                            vec3 bankTint = mix(vec3(0.22, 0.3, 0.2), vec3(0.03, 0.05, 0.07), uNight);
                            vec3 color = mix(deepColor, shallowColor, current * 0.6 + (1.0 - depth) * 0.3);
                            color = mix(bankTint, color, 0.35 + 0.65 * smoothstep(0.0, 0.2, bankDistance));

                            // Caustic-like light ribbons over the shallows
                            float caust = pow(1.0 - abs(sn_noise(flowUv * 3.1 + vec2(fineFlow * 1.6, 0.0)) * 2.0 - 1.0), 6.0);
                            color += vec3(0.45, 0.85, 0.9) * caust * 0.24 * (1.0 - uNight * 0.75) * (0.4 + depth);

                            // Fresnel sky reflection + sun glint
                            vec3 N = normalize(vec3((fineFlow - 0.5) * 0.32 * (1.0 - uFreeze), 1.0, (largeFlow - 0.5) * 0.28 * (1.0 - uFreeze)));
                            vec3 V = normalize(cameraPosition - vWorldPosition);
                            float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
                            vec3 R = reflect(-V, N);
                            vec3 skyRef = mix(uSkyBottom, uSkyTop, clamp(R.y * 1.3, 0.0, 1.0));
                            color = mix(color, skyRef, clamp(fresnel * 0.85 + 0.1, 0.0, 0.7));
                            float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 90.0);
                            color += uSunColor * glint * 2.0;
                            color = mix(color, mix(vec3(0.82, 0.94, 0.98), vec3(0.3, 0.42, 0.6), uNight), foam * 0.85);

                            // Winter: ice grows in from the banks, cracks, snow on the edges.
                            float fn = sn_noise(vWorldPosition.xz * 4.0);
                            float iceMask = smoothstep(-0.05, 0.05, uFreeze * 1.18 - bankDistance * 2.0 + (fn - 0.5) * 0.2);
                            float crack = 1.0 - smoothstep(0.0, 0.05, voronoiEdge(vWorldPosition.xz * 5.0));
                            float crackFine = 1.0 - smoothstep(0.0, 0.035, voronoiEdge(vWorldPosition.xz * 13.0 + 3.1));
                            vec3 ice = mix(vec3(0.28, 0.52, 0.7), vec3(0.6, 0.8, 0.92), sn_fbm(vWorldPosition.xz * 2.2));
                            ice = mix(ice, vec3(0.95, 0.98, 1.0), crack * 0.55 + crackFine * 0.22);
                            ice = mix(ice, skyRef, fresnel * 0.35) + uSunColor * glint * 1.2;
                            float edgeSnow = 1.0 - smoothstep(0.02, 0.07 + 0.08 * fn, bankDistance);
                            float drift = smoothstep(0.64, 0.78, sn_fbm(vWorldPosition.xz * 2.8)) * uSnowCoverage;
                            ice = mix(ice, vec3(0.9, 0.94, 0.98), max(edgeSnow * uFreeze, drift * 0.7));
                            ice *= mix(1.0, 0.28, uNight) * mix(vec3(1.0), vec3(0.7, 0.8, 1.1), uNight);
                            color = mix(color, ice, iceMask);

                            float alpha = mix(mix(0.72, 0.93, current), 0.97, max(iceMask, foam * 0.6));
                            gl_FragColor = vec4(color, alpha);
                            #include <tonemapping_fragment>
                            #include <colorspace_fragment>
                            #include <fog_fragment>
                        }
                    `
                });
                this.mesh = new THREE.Mesh(geo, this.material);
                this.mesh.renderOrder = 2;
                this.scene.add(this.mesh);
            }

            // Stones in the current (with foam wakes) and rocks framing the cascade.
            buildRocks(rockGeometry, rockMaterial) {
                const spots = [
                    { t: 0.3, u: 0.35, s: 0.07 }, { t: 0.38, u: 0.68, s: 0.06 }, { t: 0.47, u: 0.42, s: 0.075 },
                    { t: 0.72, u: 0.62, s: 0.065 }, { t: 0.84, u: 0.36, s: 0.08 }, { t: 0.93, u: 0.58, s: 0.07 }
                ];
                // Find where the cascade sits along the curve.
                let cascadeT = 0.75, best = Infinity;
                for (let t = 0.55; t < 0.98; t += 0.004) {
                    const p = this.curve.getPoint(t);
                    const pr = getStreamMetrics(p.x, p.z).progress;
                    const d = Math.abs((pr - BRIDGE_STREAM_PROGRESS) / (1 - BRIDGE_STREAM_PROGRESS) - CASCADE_AT);
                    if (d < best) { best = d; cascadeT = t; }
                }
                this.cascadeT = cascadeT;
                const extra = [
                    { t: cascadeT + 0.012, u: 0.12, s: 0.11, edge: true }, { t: cascadeT + 0.008, u: 0.88, s: 0.1, edge: true },
                    { t: cascadeT - 0.006, u: 0.03, s: 0.13, edge: true }, { t: cascadeT - 0.004, u: 0.97, s: 0.12, edge: true },
                    { t: cascadeT + 0.03, u: 0.5, s: 0.06 }
                ];
                const all = [...spots, ...extra];
                const mesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, all.length);
                let wakeIndex = 0;
                all.forEach((r, i) => {
                    const { point, normal, width, y } = this.sample(r.t);
                    const lateral = (0.5 - r.u) * 2 * width;
                    _obj.position.set(point.x + normal.x * lateral, y - r.s * 0.25, point.z + normal.z * lateral);
                    _obj.rotation.set(rand(), rand() * 6.28, rand());
                    _obj.scale.set(r.s * 1.2, r.s * 0.8, r.s);
                    _obj.updateMatrix();
                    mesh.setMatrixAt(i, _obj.matrix);
                    const g = randRange(0.36, 0.5);
                    mesh.setColorAt(i, _color.setRGB(g, g * 1.02, g * 0.98));
                    if (!r.edge && wakeIndex < 8) {
                        this.rockUniform[wakeIndex++].set(r.u, r.t * 11, (r.s * 1.1) / (2 * width), (r.s * 1.1) * 11 / this.length);
                    }
                });
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.instanceColor.needsUpdate = true;
                this.scene.add(mesh);

                // Mist where the cascade lands.
                const base = this.sample(Math.min(cascadeT + 0.025, 0.99));
                const mistHolder = new THREE.Group();
                mistHolder.position.set(base.point.x, base.y, base.point.z);
                this.scene.add(mistHolder);
                this.mists.push(new MistPuff(mistHolder, { count: 26, radius: 0.22, height: 0.35, size: 34, opacity: 0.35 }));
            }

            // Glacial spring at the stream's source (reference design, lighter materials).
            buildSource() {
                const [sx, sz] = STREAM_POINTS[0];
                const source = new THREE.Group();
                source.position.set(sx, getTerrainHeight(sx, sz) + 0.07, sz);
                const batch = new StaticBatch();
                const snowMat = stdMat(0xe9f2f2, 0.92);
                const fissure = new THREE.Mesh(new THREE.CircleGeometry(0.28, 18),
                    new THREE.MeshBasicMaterial({ color: 0x07161d, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
                fissure.scale.set(1.35, 0.68, 1);
                fissure.rotation.set(-0.42, 0.05, 0.58);
                fissure.position.set(-0.02, 0.09, -0.02);
                source.add(fissure);
                const pool = new THREE.Mesh(new THREE.CircleGeometry(0.32, 28), new THREE.MeshStandardMaterial({
                    color: 0x8fe7f1, emissive: 0x0a5063, emissiveIntensity: 0.45, roughness: 0.12, transparent: true, opacity: 0.9
                }));
                pool.rotation.x = -Math.PI / 2;
                pool.scale.set(1.25, 0.72, 1);
                pool.position.y = 0.025;
                source.add(pool);
                this.foamRing = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.018, 5, 36),
                    new THREE.MeshBasicMaterial({ color: 0xdffcff, transparent: true, opacity: 0.66 }));
                this.foamRing.rotation.x = Math.PI / 2;
                this.foamRing.scale.set(1.25, 0.72, 1);
                this.foamRing.position.y = 0.04;
                source.add(this.foamRing);
                batch.add(new THREE.SphereGeometry(0.5, 10, 6), snowMat, -0.12, 0.18, 0.16, 0, -0.42, 0, 1.25, 0.28, 0.66);
                batch.build(source);
                this.scene.add(source);
                this.mists.push(new MistPuff(source, { count: 34, radius: 0.34, height: 0.5, size: 26, opacity: 0.42 }));
            }

            update(pixelRatio) {
                this.foamRing.material.opacity = 0.66 * (1 - U.uFreeze.value * 0.8);
                for (const m of this.mists) m.uniforms.uPixelRatio.value = pixelRatio;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           STONE BRIDGE — road deck over an arched underpass, lamps and rails.
           Reads: uSnowCoverage (stone dusting + rail snow slabs); lamp glow follows time of day.
           ════════════════════════════════════════════════════════════════════ */
        class Bridge {
            constructor(scene, glowMaterials) {
                const bridge = new THREE.Group();
                bridge.position.set(BRIDGE_X, 0.055, BRIDGE_Z);
                bridge.rotation.y = Math.PI / 4;
                const dusted = (color) => patchMaterial(stdMat(color, 0.9), { key: 'dusted-stone', worldNormal: true, fragmentColor: snowDustCode('0.9') });
                const stoneMat = dusted(0x81766b);
                const stoneEdgeMat = dusted(0xa39687);
                const asphaltMat = stdMat(0x252a2c);
                const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x101719, roughness: 1, side: THREE.DoubleSide });
                const metalMat = new THREE.MeshStandardMaterial({ color: 0x56666a, roughness: 0.4, metalness: 0.72 });
                const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd681, emissive: 0xff8a24, emissiveIntensity: 2.4, toneMapped: false });
                if (glowMaterials) glowMaterials.push({ material: lampMat, key: 'bridge', scale: 1.5 });
                const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4d35e });
                const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xe8ece8 });

                const b = new StaticBatch();
                b.box(asphaltMat, 1.62, 0.12, 2.46, 0, 0, 0);
                [-0.76, 0, 0.76].forEach(z => b.box(lineMat, 0.035, 0.008, 0.42, 0, 0.064, z));
                [-0.62, 0.62].forEach(x => b.box(edgeLineMat, 0.026, 0.007, 2.38, x, 0.064, 0));

                const arch = new THREE.Shape();
                arch.moveTo(-1.18, -0.72); arch.lineTo(1.18, -0.72); arch.lineTo(1.18, 0.06); arch.lineTo(-1.18, 0.06); arch.closePath();
                const hole = new THREE.Path();
                hole.moveTo(-0.62, -0.72); hole.lineTo(-0.62, -0.57);
                hole.absarc(0, -0.57, 0.62, Math.PI, 0, true);
                hole.lineTo(0.62, -0.72); hole.closePath();
                arch.holes.push(hole);
                const archGeo = new THREE.ExtrudeGeometry(arch, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 24 });
                [-1, 1].forEach(side => {
                    b.add(archGeo, stoneMat, side * 0.83, 0, 0, 0, -side * Math.PI / 2, 0);
                    b.add(new THREE.TorusGeometry(0.625, 0.045, 6, 28, Math.PI), stoneEdgeMat, side * 0.895, -0.57, 0, 0, side * Math.PI / 2, 0);
                });
                b.box(tunnelMat, 1.82, 0.035, 1.38, 0, -0.29, 0);
                [-0.71, 0.71].forEach(z => b.box(tunnelMat, 1.72, 0.54, 0.045, 0, -0.21, z));

                [-1, 1].forEach(side => {
                    b.box(stoneEdgeMat, 0.12, 0.13, 2.54, side * 0.82, 0.075, 0);
                    [0.31, 0.5].forEach(y => b.box(metalMat, 0.045, 0.045, 2.5, side * 0.82, y, 0));
                    for (let z = -1.1; z <= 1.1001; z += 0.44) b.box(metalMat, 0.052, 0.46, 0.052, side * 0.82, 0.29, z);
                    b.add(new THREE.CylinderGeometry(0.032, 0.045, 0.72, 8), metalMat, side * 0.92, 0.46, side * 0.88);
                    b.add(new THREE.IcosahedronGeometry(0.1, 1), lampMat, side * 0.92, 0.84, side * 0.88);

                    // Snow slabs on the curb and top rail
                    const curbSnow = new THREE.Mesh(snowSlab(0.13, 0.05, 2.5), snowSlabMaterial);
                    curbSnow.position.set(side * 0.82, 0.14, 0);
                    const railSnow = new THREE.Mesh(snowSlab(0.06, 0.035, 2.46), snowSlabMaterial);
                    railSnow.position.set(side * 0.82, 0.522, 0);
                    bridge.add(curbSnow, railSnow);

                    const light = new THREE.PointLight(0xff9a3c, 0.6, 3.4, 1.8);
                    light.position.set(side * 0.92, 0.84, side * 0.88);
                    bridge.add(light);
                    (this.lights ??= []).push(light);
                });
                b.build(bridge);
                scene.add(bridge);
            }
            update(T) {
                for (const l of this.lights) l.intensity = T.bridge;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           VEGETATION — grass, wildflowers, conifers (+ snow caps), deciduous
           trees, stream-bank bushes and ferns. Everything is instanced.
           ════════════════════════════════════════════════════════════════════ */

        // Placement rules shared by all meadow plants.
        function isMeadowSpot(x, z, { road = 0.4, stream = 0.55, hut = 1.7, mill = 1.35, maxH = 2.5, minH = -1 } = {}) {
            if (getLateralRoadDist(x, z) < ROAD_WIDTH / 2 + road) return false;
            if (Math.hypot(x - HUT_X, z - HUT_Z) < hut) return false;
            if (Math.hypot(x - WINDMILL_X, z - WINDMILL_Z) < mill) return false;
            if (Math.hypot(x - CAMP_X, z - CAMP_Z) < 1.05) return false;
            const h = getTerrainHeight(x, z);
            if (h > maxH || h < minH) return false;
            if (stream > 0 && distanceToStream(x, z) < stream) return false;
            return true;
        }

        // GLSL: sway offset converted from world space into the instance's local space.
        const LOCAL_WIND = /* glsl */`
            vec3 toLocal(vec3 worldOffset) {
                #ifdef USE_INSTANCING
                    mat3 im = mat3(instanceMatrix);
                    return transpose(im) * worldOffset / max(dot(im[0], im[0]), 1e-4);
                #else
                    return worldOffset;
                #endif
            }
            vec3 instanceOrigin() {
                #ifdef USE_INSTANCING
                    return (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                #else
                    return (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                #endif
            }
            // Travelling gust front: a visible wave rolling across the meadow.
            float gustAt(vec2 p) {
                float front = pow(max(0.0, 0.5 + 0.5 * sin(dot(p, uWindDir) * 0.55 - uWindTime * 1.5)), 5.0);
                return front * (0.55 + 0.45 * sn_noise(p * 0.35 + uWindTime * 0.15));
            }
        `;

        class Vegetation {
            constructor(scene) {
                this.scene = scene;
                this.buildGrass();
                this.buildFlowers();
                this.buildConifers();
                this.buildDeciduous();
                this.buildBankPlants();
            }

            /* Grass — one InstancedMesh, three blade shapes chosen per instance.
               Reads: uGrassBase, uGrassTip, uGrassHeight (winter shrink), uSnowCoverage, uWindTime. */
            buildGrass() {
                const w = 0.08, h = 0.55;
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
                    -w, 0, 0, w, 0, 0,
                    -w * 0.8, h * 0.3, 0.02, w * 0.8, h * 0.3, 0.02,
                    -w * 0.5, h * 0.7, 0.08, w * 0.5, h * 0.7, 0.08,
                    0, h, 0.16
                ]), 3));
                // Up-facing normals give blades soft, uniform meadow lighting.
                geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
                    0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.3, 0, 1, 0.3, 0, 1, 0.4
                ]), 3));
                geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 0.3, 1, 0.3, 0, 0.7, 1, 0.7, 0.5, 1]), 2));
                geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);

                const count = QUALITY.GRASS_COUNT;
                const attr = new Float32Array(count * 4);   // variant, tint jitter, unused, phase
                const mesh = new THREE.InstancedMesh(geo, null, count);
                let placed = 0;
                for (let i = 0; i < count * 4 && placed < count; i++) {
                    const x = (rand() - 0.5) * (WORLD_SIZE - 0.5);
                    const z = (rand() - 0.5) * (WORLD_SIZE - 0.5);
                    if (!isMeadowSpot(x, z, { road: 0.4, stream: 0.5, hut: 1.55, mill: 1.25, maxH: 2.4 })) continue;
                    const y = getTerrainHeight(x, z);
                    _obj.position.set(x, y - 0.02, z);
                    _obj.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
                    _obj.scale.setScalar(0.34 + rand() * 0.46);
                    _obj.updateMatrix();
                    mesh.setMatrixAt(placed, _obj.matrix);
                    const r = rand();
                    attr[placed * 4] = r < 0.55 ? 0 : r < 0.82 ? 1 : 2;
                    attr[placed * 4 + 1] = rand();
                    attr[placed * 4 + 3] = rand();
                    placed++;
                }
                mesh.count = placed;
                geo.setAttribute('aGrass', new THREE.InstancedBufferAttribute(attr, 4));

                mesh.material = patchMaterial(
                    new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide }),
                    {
                        key: 'grass',
                        worldPos: true,
                        vertexPars: 'attribute vec4 aGrass; varying float vGrassH; varying float vGust; varying float vTint;\n' + LOCAL_WIND,
                        vertexBegin: /* glsl */`
                            float hN = clamp(position.y / 0.55, 0.0, 1.0);
                            vGrassH = hN;
                            vTint = aGrass.y;
                            float wMul = aGrass.x < 0.5 ? 1.0 : (aGrass.x < 1.5 ? 1.75 : 0.6);
                            float hMul = aGrass.x < 0.5 ? 1.0 : (aGrass.x < 1.5 ? 0.62 : 1.3);
                            transformed.x *= wMul * (1.0 - hN * 0.15);
                            transformed.y *= hMul * uGrassHeight;
                            transformed.z *= hMul * (aGrass.x > 1.5 ? 1.6 : 1.0);
                            transformed.y -= (1.0 - uGrassHeight) * 0.04;
                            vec3 origin = instanceOrigin();
                            float gust = gustAt(origin.xz);
                            vGust = gust;
                            float sway = sin(uWindTime * 2.1 + origin.x * 0.9 + origin.z * 0.7 + aGrass.w * 6.28) * 0.12;
                            float stiff = mix(1.0, 0.35, uSnowCoverage);
                            float bend = pow(hN, 1.7) * hMul * stiff;
                            vec2 wind = uWindDir * (sway + gust * 0.6 + 0.1) * bend * 0.3;
                            transformed += toLocal(vec3(wind.x, -abs(gust) * bend * 0.05, wind.y));
                        `,
                        fragmentPars: 'varying float vGrassH; varying float vGust; varying float vTint;',
                        diffuse: /* glsl */`
                            vec3 gBase = uGrassBase * (0.8 + vTint * 0.4);
                            vec3 gTip = uGrassTip * (0.85 + (1.0 - vTint) * 0.3);
                            float gH = clamp(vGrassH, 0.0, 1.0);
                            vec3 grassCol = mix(gBase, gTip, pow(gH, 0.85));
                            // Autumn: some blades burn to deep amber, spring: a few fresh lime ones.
                            grassCol = mix(grassCol, vec3(0.75, 0.28, 0.04), uSeasonW.z * step(0.8, vTint) * gH);
                            grassCol = mix(grassCol, vec3(0.45, 0.8, 0.12), uSeasonW.x * step(0.8, vTint) * vGrassH * 0.6);
                            // Gust sheen travelling across the meadow
                            grassCol += vec3(0.08, 0.09, 0.05) * vGust * vGrassH * (1.0 - uNight * 0.7);
                            // Winter: tips poke out of the snow, frosted
                            grassCol = mix(grassCol, vec3(0.82, 0.87, 0.9), uSnowCoverage * (1.0 - vGrassH) * 0.85);
                            vec4 diffuseColor = vec4(grassCol, opacity);
                        `,
                        fragmentNormal: 'normal = normalize(vNormal);'
                    }
                );
                mesh.receiveShadow = true;
                mesh.castShadow = false;
                mesh.frustumCulled = false;
                this.scene.add(mesh);
                this.grass = mesh;
            }

            /* Wildflowers — bloom in spring, thin in summer, gone in autumn/winter.
               Each instance has a threshold; it scales in/out smoothly as uFlowers crosses it. */
            buildFlowers() {
                const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.22, 4).translate(0, 0.11, 0);
                const bloom = new THREE.IcosahedronGeometry(0.055, 0).translate(0, 0.24, 0);
                const petals = new THREE.CylinderGeometry(0.075, 0.02, 0.02, 6).translate(0, 0.225, 0);
                const parts = [stem, bloom, petals].map((g, i) => {
                    g = g.index ? g.toNonIndexed() : g;
                    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i === 0 ? 0 : i === 1 ? 0.6 : 1), 1));
                    return g;
                });
                const geo = mergeGeometries(parts);
                const count = 520;
                const seeds = new Float32Array(count);
                const colors = new Float32Array(count * 3);
                const palette = [0xf4d35e, 0xff8fab, 0xd9ed92, 0xb8c0ff, 0xffffff, 0xff6b6b, 0xc77dff].map(c => new THREE.Color(c));
                const mesh = new THREE.InstancedMesh(geo, null, count);
                let placed = 0;
                for (let i = 0; i < count * 10 && placed < count; i++) {
                    // Cluster flowers in drifts using low-frequency noise.
                    const x = (rand() - 0.5) * (WORLD_SIZE - 1.0), z = (rand() - 0.5) * (WORLD_SIZE - 1.0);
                    if (valueNoise(x * 0.7 + 3, z * 0.7) < 0.45) continue;
                    if (!isMeadowSpot(x, z, { road: 0.55, stream: 0.55, hut: 1.8, mill: 1.45, maxH: 2.1, minH: 0.2 })) continue;
                    const y = getTerrainHeight(x, z);
                    _obj.position.set(x, y - 0.01, z);
                    _obj.rotation.set((rand() - 0.5) * 0.3, rand() * Math.PI, (rand() - 0.5) * 0.3);
                    _obj.scale.setScalar(0.5 + rand() * 0.45);
                    _obj.updateMatrix();
                    mesh.setMatrixAt(placed, _obj.matrix);
                    seeds[placed] = rand();
                    const c = palette[Math.floor(rand() * palette.length)];
                    colors[placed * 3] = c.r; colors[placed * 3 + 1] = c.g; colors[placed * 3 + 2] = c.b;
                    placed++;
                }
                mesh.count = placed;
                geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
                geo.setAttribute('aFlowerColor', new THREE.InstancedBufferAttribute(colors, 3));
                mesh.material = patchMaterial(
                    new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
                    {
                        key: 'flowers',
                        vertexPars: 'attribute float aSeed; attribute vec3 aFlowerColor; attribute float aPart; varying vec3 vFlowerColor; varying float vPart;\n' + LOCAL_WIND,
                        vertexBegin: /* glsl */`
                            vFlowerColor = aFlowerColor; vPart = aPart;
                            float bloomS = smoothstep(aSeed, aSeed + 0.12, uFlowers * 1.12);
                            transformed *= bloomS;
                            vec3 origin = instanceOrigin();
                            float sway = sin(uWindTime * 2.3 + origin.x * 1.1 + aSeed * 12.0) * 0.05 + gustAt(origin.xz) * 0.08;
                            transformed += toLocal(vec3(uWindDir.x, 0.0, uWindDir.y) * sway * smoothstep(0.0, 0.25, position.y));
                        `,
                        fragmentPars: 'varying vec3 vFlowerColor; varying float vPart;',
                        diffuse: /* glsl */`
                            vec3 fc = mix(vec3(0.16, 0.36, 0.1), vFlowerColor, step(0.3, vPart));
                            fc = mix(fc, vec3(1.0, 0.85, 0.3), step(0.3, vPart) * step(vPart, 0.7));
                            vec4 diffuseColor = vec4(fc, opacity);
                        `
                    }
                );
                mesh.frustumCulled = false;
                mesh.receiveShadow = true;
                this.scene.add(mesh);
                this.flowers = mesh;
            }

            /* Conifers — stay green; snow caps (separate instanced mesh) grow with uSnowCoverage. */
            buildConifers() {
                const trunk = new THREE.CylinderGeometry(0.08, 0.14, 0.9, 6).translate(0, 0.45, 0);
                const tiers = [];
                const capTiers = [];
                for (let c = 0; c < 4; c++) {
                    const r = 0.72 - c * 0.15, hgt = 0.95 - c * 0.1, y = 0.95 + c * 0.52;
                    tiers.push(new THREE.ConeGeometry(r, hgt, 7).translate(0, y, 0));
                    // Cap: upper ~55% of each tier, slightly proud of the needles.
                    const capH = hgt * 0.56;
                    capTiers.push(new THREE.ConeGeometry(r * 0.6, capH, 7).translate(0, y + hgt / 2 - capH / 2 + 0.03, 0));
                }
                const colorize = (g, color) => {
                    g = nonIndexed(g);
                    const n = g.attributes.position.count;
                    const col = new Float32Array(n * 3);
                    for (let i = 0; i < n; i++) {
                        const shade = 0.8 + 0.35 * (g.attributes.position.getY(i) % 0.5);
                        col[i * 3] = color.r * shade; col[i * 3 + 1] = color.g * shade; col[i * 3 + 2] = color.b * shade;
                    }
                    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
                    return g;
                };
                const treeGeo = mergeGeometries([
                    colorize(trunk, new THREE.Color(0x4a2f20)),
                    ...tiers.map(t => colorize(t, new THREE.Color(0x1f4a2c)))
                ]);
                const capGeo = mergeGeometries(capTiers.map(nonIndexed));

                const spots = [
                    [-6.3, -1.0], [-2.0, -5.0], [2.5, 5.5], [4.5, 2.0], [6.2, 3.2], [-6.8, -3.2],
                    [-3.4, -6.3], [5.5, 5.8], [-1.5, 6.7], [-2.5, 2.9], [6.6, -6.6], [-4.6, -5.9], [-6.2, 5.9]
                ];
                const mats = [];
                for (const [x0, z0] of spots) {
                    const x = x0 + (rand() - 0.5) * 0.3, z = z0 + (rand() - 0.5) * 0.3;
                    if (!isMeadowSpot(x, z, { road: 0.7, stream: 0.9, hut: 2.0, mill: 1.6, maxH: 3.4, minH: 0.05 })) continue;
                    const s = randRange(0.55, 0.85);
                    _obj.position.set(x, getTerrainHeight(x, z) - 0.05, z);
                    _obj.rotation.set(0, rand() * Math.PI * 2, 0);
                    _obj.scale.set(s, s * randRange(0.9, 1.2), s);
                    _obj.updateMatrix();
                    mats.push(_obj.matrix.clone());
                }
                const sway = /* glsl */`
                    vec3 treeOrigin = instanceOrigin();
                    float treeSway = sin(uWindTime * 1.4 + treeOrigin.x * 0.7 + treeOrigin.z) * 0.018 + gustAt(treeOrigin.xz) * 0.03;
                    transformed += toLocal(vec3(uWindDir.x, 0.0, uWindDir.y) * treeSway * position.y * position.y * 0.35);
                `;
                const treeMat = patchMaterial(stdMat(0xffffff, 0.85, { vertexColors: true }), {
                    key: 'conifer', worldNormal: true,
                    vertexPars: LOCAL_WIND, vertexBegin: sway,
                    fragmentColor: /* glsl */`
                        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.82, 0.9, 1.0), uSeasonW.w);
                        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.12, 1.1, 0.9), uSeasonW.x);
                    ` + snowDustCode('0.55')
                });
                const capMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.8, flatShading: true }), {
                    key: 'conifer-cap',
                    vertexPars: LOCAL_WIND,
                    vertexBegin: /* glsl */`
                        float capS = smoothstep(0.05, 0.85, uSnowCoverage);
                        transformed.xz *= mix(0.72, 1.0, capS);
                        transformed.y -= (1.0 - capS) * 0.08;
                    ` + sway
                });
                const trees = new THREE.InstancedMesh(treeGeo, treeMat, mats.length);
                const caps = new THREE.InstancedMesh(capGeo, capMat, mats.length);
                mats.forEach((m, i) => {
                    trees.setMatrixAt(i, m);
                    caps.setMatrixAt(i, m);
                    const v = randRange(0.85, 1.12);
                    trees.setColorAt(i, _color.setRGB(v, v * randRange(0.95, 1.05), v));
                });
                trees.castShadow = true; trees.receiveShadow = true;
                caps.castShadow = false; caps.receiveShadow = true;
                this.scene.add(trees, caps);
                this.coniferCaps = caps;
            }

            /* Deciduous trees — bare trunks + canopy instanced mesh. Canopy colour comes from
               uSeasonW in the shader (blossom → green → fiery → bare) and scales to zero in winter,
               each tree on a slightly different schedule. Custom depth material keeps shadows in sync. */
            buildDeciduous() {
                const woodParts = [new THREE.CylinderGeometry(0.06, 0.12, 1.3, 6).translate(0, 0.65, 0)];
                const branch = (len, rad, tiltZ, rotY, y) => {
                    const g = new THREE.CylinderGeometry(rad * 0.5, rad, len, 5).translate(0, len / 2, 0);
                    g.rotateZ(tiltZ); g.rotateY(rotY); g.translate(0, y, 0);
                    return g;
                };
                for (let i = 0; i < 5; i++) {
                    woodParts.push(branch(0.62, 0.05, 0.75 + (i % 2) * 0.2, i * 1.26, 0.9 + (i % 3) * 0.12));
                    woodParts.push(branch(0.32, 0.025, 1.1, i * 1.26 + 0.6, 1.25 + (i % 2) * 0.1));
                }
                const woodGeo = mergeGeometries(woodParts.map(nonIndexed));
                const CANOPY_CENTER_Y = 1.5;
                const blobs = [];
                const blobData = [[0, 0.05, 0, 0.55], [0.36, -0.12, 0.1, 0.4], [-0.32, -0.08, -0.14, 0.42], [0.05, 0.3, -0.05, 0.38], [-0.1, -0.18, 0.34, 0.36], [0.12, -0.14, -0.36, 0.34]];
                for (const [x, y, z, r] of blobData) blobs.push(new THREE.IcosahedronGeometry(r, 1).translate(x, y + CANOPY_CENTER_Y, z));
                const canopyGeo = mergeGeometries(blobs);

                const spots = [[3.2, 3.8], [5.3, 0.6], [-3.6, -2.6], [2.6, -2.2], [-4.9, -3.9], [1.2, 2.6], [3.7, -6.5], [6.3, 4.6], [-0.3, 5.3]];
                const mats = [];
                const seeds = [];
                for (const [x0, z0] of spots) {
                    const x = x0 + (rand() - 0.5) * 0.3, z = z0 + (rand() - 0.5) * 0.3;
                    if (!isMeadowSpot(x, z, { road: 0.75, stream: 0.8, hut: 2.0, mill: 1.6, maxH: 2.6, minH: 0.05 })) continue;
                    const s = randRange(0.6, 0.85);
                    _obj.position.set(x, getTerrainHeight(x, z) - 0.04, z);
                    _obj.rotation.set(0, rand() * Math.PI * 2, 0);
                    _obj.scale.setScalar(s);
                    _obj.updateMatrix();
                    mats.push(_obj.matrix.clone());
                    seeds.push(rand());
                }
                canopyGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));

                const canopyVertex = /* glsl */`
                    float cs = smoothstep(aSeed * 0.35, aSeed * 0.35 + 0.65, uCanopy);
                    vec3 cc = vec3(0.0, ${CANOPY_CENTER_Y.toFixed(2)}, 0.0);
                    transformed = cc + (transformed - cc) * cs;
                    vec3 cOrigin = instanceOrigin();
                    float leafSway = sin(uWindTime * 1.8 + cOrigin.x + position.y * 3.0 + aSeed * 9.0) * 0.03 + gustAt(cOrigin.xz) * 0.06;
                    transformed += toLocal(vec3(uWindDir.x, 0.0, uWindDir.y) * leafSway * smoothstep(1.0, 2.0, position.y));
                `;
                const canopyPars = 'attribute float aSeed; varying float vSeed; varying vec3 vLocal;\n' + LOCAL_WIND;
                this.canopyMaterial = patchMaterial(stdMat(0xffffff, 0.8), {
                    key: 'canopy', worldPos: true,
                    vertexPars: canopyPars,
                    vertexBegin: 'vSeed = aSeed; vLocal = position;\n' + canopyVertex,
                    fragmentPars: 'varying float vSeed; varying vec3 vLocal;',
                    diffuse: /* glsl */`
                        float speck = sn_noise(vLocal.xz * 9.0 + vLocal.y * 7.0 + vSeed * 20.0);
                        vec3 spring = mix(vec3(0.92, 0.36, 0.55), vec3(1.0, 0.8, 0.86), step(0.6, fract(vSeed * 3.7)));
                        spring = mix(spring, vec3(0.5, 0.78, 0.3), smoothstep(0.62, 0.8, speck) * 0.6);
                        vec3 summer = mix(vec3(0.16, 0.38, 0.12), vec3(0.28, 0.5, 0.16), vSeed) * (0.85 + speck * 0.3);
                        vec3 autumn = mix(vec3(0.75, 0.12, 0.04), vec3(0.95, 0.45, 0.05), fract(vSeed * 5.3));
                        autumn = mix(autumn, vec3(0.95, 0.7, 0.1), step(0.78, fract(vSeed * 2.9)));
                        autumn *= 0.8 + speck * 0.4;
                        vec3 winter = vec3(0.35, 0.28, 0.2);
                        vec3 cc = spring * uSeasonW.x + summer * uSeasonW.y + autumn * uSeasonW.z + winter * uSeasonW.w;
                        vec4 diffuseColor = vec4(cc, opacity);
                    `
                });
                const woodMat = patchMaterial(stdMat(0x4b3325, 0.9), { key: 'wood-dusted', worldNormal: true, fragmentColor: snowDustCode('0.8') });
                const wood = new THREE.InstancedMesh(woodGeo, woodMat, mats.length);
                const canopy = new THREE.InstancedMesh(canopyGeo, this.canopyMaterial, mats.length);
                canopy.customDepthMaterial = makeDepthMaterial('canopy', canopyPars, canopyVertex);
                mats.forEach((m, i) => { wood.setMatrixAt(i, m); canopy.setMatrixAt(i, m); });
                wood.castShadow = true; wood.receiveShadow = true;
                canopy.castShadow = true; canopy.receiveShadow = true;
                this.scene.add(wood, canopy);
            }

            /* Bushes and ferns along the stream banks. Bushes turn red in autumn and shrink to
               twiggy mounds in winter; ferns uncurl in spring, rust in autumn, flatten under snow. */
            buildBankPlants() {
                const bushGeo = mergeGeometries([
                    new THREE.IcosahedronGeometry(0.22, 1).translate(0, 0.14, 0),
                    new THREE.IcosahedronGeometry(0.17, 1).translate(0.16, 0.1, 0.05),
                    new THREE.IcosahedronGeometry(0.15, 1).translate(-0.14, 0.09, -0.06)
                ]);
                const fronds = [];
                for (let i = 0; i < 7; i++) {
                    const g = new THREE.PlaneGeometry(0.07, 0.42, 1, 4).translate(0, 0.21, 0);
                    const p = g.attributes.position;
                    for (let v = 0; v < p.count; v++) {
                        const y = p.getY(v);
                        p.setX(v, p.getX(v) * (1 - y / 0.5));
                        p.setZ(v, y * y * 1.4);   // arch outward
                    }
                    g.rotateX(-0.35);
                    g.rotateY((i / 7) * Math.PI * 2);
                    fronds.push(g);
                }
                const fernGeo = mergeGeometries(fronds);
                fernGeo.computeVertexNormals();

                const bushM = [], fernM = [], bushSeeds = [], fernSeeds = [];
                for (let tries = 0; tries < 4000 && (bushM.length < 46 || fernM.length < 90); tries++) {
                    const t = rand();
                    const i = Math.floor(t * (STREAM_POINTS.length - 1));
                    const f = t * (STREAM_POINTS.length - 1) - i;
                    const [ax, az] = STREAM_POINTS[i], [bx, bz] = STREAM_POINTS[i + 1];
                    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
                    const side = rand() < 0.5 ? -1 : 1, off = randRange(0.42, 1.0);
                    const x = ax + dx * f - (dz / len) * off * side;
                    const z = az + dz * f + (dx / len) * off * side;
                    if (Math.abs(x) > 7.1 || Math.abs(z) > 7.1) continue;
                    if (!isMeadowSpot(x, z, { road: 0.6, stream: 0.36, hut: 1.8, mill: 1.4, maxH: 3.0 })) continue;
                    const y = getTerrainHeight(x, z);
                    const isFern = rand() < 0.62;
                    _obj.position.set(x, y - 0.02, z);
                    _obj.rotation.set(0, rand() * Math.PI * 2, 0);
                    _obj.scale.setScalar(isFern ? randRange(0.5, 0.85) : randRange(0.45, 0.85));
                    _obj.updateMatrix();
                    if (isFern && fernM.length < 90) { fernM.push(_obj.matrix.clone()); fernSeeds.push(rand()); }
                    else if (!isFern && bushM.length < 46) { bushM.push(_obj.matrix.clone()); bushSeeds.push(rand()); }
                }
                bushGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(bushSeeds), 1));
                fernGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(fernSeeds), 1));

                const bushMat = patchMaterial(stdMat(0xffffff, 0.85), {
                    key: 'bush', worldNormal: true,
                    vertexPars: 'attribute float aSeed; varying float vSeed;\n' + LOCAL_WIND,
                    vertexBegin: /* glsl */`
                        vSeed = aSeed;
                        transformed *= mix(1.0, 0.62, uSeasonW.w);
                        vec3 o = instanceOrigin();
                        transformed += toLocal(vec3(uWindDir.x, 0.0, uWindDir.y) * gustAt(o.xz) * 0.03 * position.y * 4.0);
                    `,
                    fragmentPars: 'varying float vSeed;',
                    diffuse: /* glsl */`
                        vec3 sp = mix(vec3(0.3, 0.62, 0.18), vec3(0.95, 0.95, 0.9), step(0.8, fract(vSeed * 7.1)) * 0.5);
                        vec3 su = mix(vec3(0.14, 0.34, 0.1), vec3(0.2, 0.42, 0.14), vSeed);
                        vec3 au = mix(vec3(0.7, 0.1, 0.05), vec3(0.85, 0.42, 0.06), vSeed);
                        vec3 wi = vec3(0.3, 0.22, 0.16);
                        vec4 diffuseColor = vec4(sp * uSeasonW.x + su * uSeasonW.y + au * uSeasonW.z + wi * uSeasonW.w, opacity);
                    `,
                    fragmentColor: snowDustCode('1.0')
                });
                const fernMat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), {
                    key: 'fern',
                    vertexPars: 'attribute float aSeed; varying float vSeed; varying float vFernH;\n' + LOCAL_WIND,
                    vertexBegin: /* glsl */`
                        vSeed = aSeed; vFernH = position.y;
                        float unfurl = mix(1.0, 0.75, uSeasonW.x * step(0.5, aSeed));
                        transformed.y *= mix(1.0, 0.28, uSeasonW.w) * unfurl;
                        transformed.xz *= mix(1.0, 1.25, uSeasonW.w);
                        vec3 o = instanceOrigin();
                        float s = sin(uWindTime * 2.4 + o.x * 2.0 + aSeed * 10.0) * 0.04 + gustAt(o.xz) * 0.08;
                        transformed += toLocal(vec3(uWindDir.x, 0.0, uWindDir.y) * s * position.y * 2.2);
                    `,
                    fragmentPars: 'varying float vSeed; varying float vFernH;',
                    diffuse: /* glsl */`
                        vec3 sp = vec3(0.36, 0.72, 0.22), su = vec3(0.14, 0.4, 0.12);
                        vec3 au = mix(vec3(0.6, 0.3, 0.08), vec3(0.72, 0.5, 0.14), vSeed), wi = vec3(0.5, 0.44, 0.38);
                        vec3 fc = (sp * uSeasonW.x + su * uSeasonW.y + au * uSeasonW.z + wi * uSeasonW.w) * (0.7 + vFernH * 0.9);
                        fc = mix(fc, vec3(0.86, 0.9, 0.95), uSnowCoverage * 0.45);
                        vec4 diffuseColor = vec4(fc, opacity);
                    `,
                    fragmentNormal: 'normal = normalize(vNormal); if (!gl_FrontFacing) normal.xz *= -1.0;'
                });
                const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushM.length);
                const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fernM.length);
                bushM.forEach((m, i) => bushes.setMatrixAt(i, m));
                fernM.forEach((m, i) => ferns.setMatrixAt(i, m));
                bushes.castShadow = true; bushes.receiveShadow = true;
                ferns.receiveShadow = true;
                ferns.frustumCulled = false; bushes.frustumCulled = false;
                this.scene.add(bushes, ferns);
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           ALPINE CHALET — stone base, log walls, overhanging gabled roof with
           beams, balcony, framed glowing windows, woodpile and fence.
           Reads: uSnowCoverage (roof/woodpile slabs, stone + fence dusting).
           ════════════════════════════════════════════════════════════════════ */
        class Chalet {
            constructor(scene, glowMaterials) {
                const hut = new THREE.Group();
                const groundY = getTerrainHeight(HUT_X, HUT_Z);
                hut.position.set(HUT_X, groundY, HUT_Z);
                hut.rotation.y = -Math.PI / 4;   // front (+Z) faces the diagonal road

                const dustedStone = patchMaterial(stdMat(0x77706a, 0.95), { key: 'dusted-stone', worldNormal: true, fragmentColor: snowDustCode('0.9') });
                const logMat = stdMat(0x6b4430, 0.85);
                const logDark = stdMat(0x4a2c1d, 0.9);
                const timber = patchMaterial(stdMat(0x3d2517, 0.85), { key: 'wood-dusted', worldNormal: true, fragmentColor: snowDustCode('0.8') });
                const gableMat = stdMat(0x7c5236, 0.85);
                const roofMat = stdMat(0x4a3d37, 0.8);
                const shutterMat = stdMat(0x2f5a3a, 0.8);
                const frameMat = stdMat(0xe8dcc6, 0.7);
                const doorMat = stdMat(0x3a2114, 0.9);
                const firewood = stdMat(0x8a5a36, 0.9);
                const windowMat = new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff7a18, emissiveIntensity: 3, roughness: 0.3, toneMapped: false });
                if (glowMaterials) glowMaterials.push({ material: windowMat, key: 'window' });

                const b = new StaticBatch();
                // Stone base (sunk into the slope) and log walls with grooves + corner posts
                b.box(dustedStone, 1.95, 0.9, 1.65, 0, 0, 0);
                b.box(logMat, 1.7, 1.05, 1.4, 0, 0.975, 0);
                for (let y = 0.56; y < 1.5; y += 0.15) b.box(logDark, 1.72, 0.02, 1.42, 0, y, 0);
                [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => b.box(timber, 0.11, 1.07, 0.11, sx * 0.85, 0.975, sz * 0.7));
                b.box(timber, 1.8, 0.08, 1.5, 0, 1.5, 0);   // sill beam under the gable

                // Gable prism (ridge along Z so the gable faces the road)
                const pitch = Math.atan2(0.62, 0.85);
                const gShape = new THREE.Shape();
                gShape.moveTo(-0.85, 0); gShape.lineTo(0.85, 0); gShape.lineTo(0, 0.62); gShape.closePath();
                b.add(new THREE.ExtrudeGeometry(gShape, { depth: 1.4, bevelEnabled: false }), gableMat, 0, 1.54, -0.7);
                for (let x = -0.6; x <= 0.61; x += 0.2) {
                    const hgt = 0.62 * (1 - Math.abs(x) / 0.85);
                    b.box(logDark, 0.018, hgt, 0.02, x, 1.54 + hgt / 2, 0.705);
                }
                // Overhanging roof panels, ridge beam, purlins and rafter tails
                const ridgeY = 2.2, run = 1.27;
                const L = run / Math.cos(pitch);
                this.roofSnow = [];
                [-1, 1].forEach(side => {
                    const cx = side * run / 2, cy = ridgeY - (run / 2) * Math.tan(pitch);
                    b.box(roofMat, L, 0.08, 2.15, cx, cy, 0, 0, 0, -side * pitch);
                    b.box(timber, L + 0.02, 0.1, 0.06, cx, cy - 0.02, 1.08, 0, 0, -side * pitch);   // barge boards
                    b.box(timber, L + 0.02, 0.1, 0.06, cx, cy - 0.02, -1.08, 0, 0, -side * pitch);
                    [0.45, 0.88].forEach(px => b.box(timber, 0.08, 0.08, 2.25, side * px, ridgeY - px * Math.tan(pitch) - 0.08, 0));
                    for (let z = -0.9; z <= 0.91; z += 0.3) b.box(timber, 0.07, 0.07, 0.07, side * 1.2, ridgeY - 1.2 * Math.tan(pitch) - 0.07, z);
                    // Snow slab sitting on this panel
                    const snow = new THREE.Mesh(snowSlab(L + 0.04, 0.11, 2.18), snowSlabMaterial);
                    snow.position.set(cx + side * Math.sin(pitch) * 0.04, cy + Math.cos(pitch) * 0.04, 0);
                    snow.rotation.z = -side * pitch;
                    snow.receiveShadow = true;
                    hut.add(snow);
                });
                b.box(timber, 0.12, 0.12, 2.25, 0, ridgeY + 0.02, 0);
                // Crossed gable timbers
                b.box(timber, 0.05, 0.62, 0.03, -0.22, 1.83, 0.72, 0, 0, 0.9);
                b.box(timber, 0.05, 0.62, 0.03, 0.22, 1.83, 0.72, 0, 0, -0.9);

                // Balcony under the gable
                b.box(timber, 1.55, 0.06, 0.44, 0, 1.52, 0.92);
                b.box(timber, 1.55, 0.05, 0.05, 0, 1.87, 1.12);
                [-0.775, 0.775].forEach(x => b.box(timber, 0.05, 0.05, 0.44, x, 1.87, 0.92));
                for (let x = -0.72; x <= 0.73; x += 0.09) b.box(gableMat, 0.05, 0.32, 0.02, x, 1.71, 1.12);
                [-0.775, 0.775].forEach(x => b.box(gableMat, 0.02, 0.32, 0.4, x, 1.71, 0.92));
                [-0.6, 0.6].forEach(x => b.box(timber, 0.06, 0.45, 0.06, x, 1.32, 0.85, 0.72, 0, 0));
                b.box(doorMat, 0.36, 0.52, 0.03, 0, 1.82, 0.705);                // balcony door

                // Ground floor: door, framed windows with shutters
                b.box(doorMat, 0.38, 0.72, 0.04, -0.4, 0.84, 0.705);
                b.box(frameMat, 0.46, 0.05, 0.05, -0.4, 1.22, 0.71);
                const addWindow = (x, y, z, ry) => {
                    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
                    const add = (geo, mat, px, py, pz) => b.addMatrix(geo, mat, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(px, py, pz)));
                    add(new THREE.BoxGeometry(0.3, 0.3, 0.02), windowMat, 0, 0, 0);
                    add(new THREE.BoxGeometry(0.38, 0.045, 0.05), frameMat, 0, 0.17, 0.01);
                    add(new THREE.BoxGeometry(0.4, 0.05, 0.08), frameMat, 0, -0.17, 0.02);
                    add(new THREE.BoxGeometry(0.045, 0.3, 0.05), frameMat, -0.17, 0, 0.01);
                    add(new THREE.BoxGeometry(0.045, 0.3, 0.05), frameMat, 0.17, 0, 0.01);
                    add(new THREE.BoxGeometry(0.02, 0.3, 0.03), frameMat, 0, 0, 0.012);
                    add(new THREE.BoxGeometry(0.15, 0.36, 0.025), shutterMat, -0.28, 0, 0.02);
                    add(new THREE.BoxGeometry(0.15, 0.36, 0.025), shutterMat, 0.28, 0, 0.02);
                };
                addWindow(0.38, 1.0, 0.705, 0);
                addWindow(0.86, 1.0, 0.3, Math.PI / 2); addWindow(0.86, 1.0, -0.35, Math.PI / 2);
                addWindow(-0.86, 1.0, 0.3, -Math.PI / 2); addWindow(-0.86, 1.0, -0.35, -Math.PI / 2);
                addWindow(0.0, 1.0, -0.705, Math.PI);

                // Chimney through the roof
                b.box(dustedStone, 0.26, 0.9, 0.26, 0.42, 2.05, -0.4);
                b.box(dustedStone, 0.34, 0.06, 0.34, 0.42, 2.52, -0.4);

                // Woodpile against the left wall
                const logGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.46, 7).rotateZ(Math.PI / 2);
                for (let row = 0; row < 4; row++) {
                    for (let i = 0; i < 7 - row; i++) {
                        b.add(logGeo, firewood, -1.26, 0.06 + row * 0.095, -0.5 + i * 0.115 + row * 0.057, rand() * 0.3, 0, 0);
                    }
                }
                const pileSnow = new THREE.Mesh(snowSlab(0.5, 0.06, 0.62), snowSlabMaterial);
                pileSnow.position.set(-1.26, 0.43, -0.16);
                hut.add(pileSnow);

                // Fence posts follow the real terrain height around the yard
                hut.updateMatrixWorld(true);
                const fencePath = [[0.35, 1.55], [0.75, 1.55], [1.15, 1.55], [1.55, 1.55], [1.75, 1.3], [1.75, 0.9], [1.75, 0.5], [1.75, 0.1], [1.75, -0.3], [1.75, -0.7]];
                const localH = fencePath.map(([x, z]) => {
                    _v2.set(x, 0, z).applyMatrix4(hut.matrixWorld);
                    return getTerrainHeight(_v2.x, _v2.z) - groundY;
                });
                fencePath.forEach(([x, z], i) => {
                    b.box(timber, 0.06, 0.46, 0.06, x, localH[i] + 0.2, z);
                    if (i > 0) {
                        const [px, pz] = fencePath[i - 1];
                        const len = Math.hypot(x - px, z - pz), ang = Math.atan2(x - px, z - pz);
                        const y0 = (localH[i] + localH[i - 1]) / 2;
                        [0.18, 0.34].forEach(ry => b.box(timber, 0.03, 0.05, len, (x + px) / 2, y0 + ry, (z + pz) / 2, 0, ang, 0));
                    }
                });
                b.build(hut);

                // Door lantern (no shadow map: cube shadows are costly)
                const lanternGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.15, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.7), toneMapped: false }));
                lanternGlass.position.set(-0.4, 1.33, 0.82);
                this.lantern = new THREE.PointLight(0xff7711, 1.6, 5, 1.2);
                this.lantern.position.set(-0.4, 1.33, 0.95);
                hut.add(lanternGlass, this.lantern);
                this.lanternGlass = lanternGlass;
                scene.add(hut);

                hut.updateMatrixWorld(true);
                this.chimneyTop = new THREE.Vector3(0.42, 2.62, -0.4).applyMatrix4(hut.matrixWorld);
            }
            update(T) {
                this.lantern.intensity = T.lantern;
                this.lanternGlass.material.color.setRGB(0.6 + T.lantern * 0.5, 0.45 + T.lantern * 0.36, 0.2 + T.lantern * 0.15);
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           WINDMILL — stone plinth, tapered plaster tower, gallery, ogee cap,
           lattice sails whose cloth billows (vertex shader) and a turning fantail.
           Reads: uWindTime/uTime (cloth), uSnowCoverage (cap snow, plinth dusting).
           ════════════════════════════════════════════════════════════════════ */
        class Windmill {
            constructor(scene, glowMaterials) {
                const mill = new THREE.Group();
                mill.position.set(WINDMILL_X, getTerrainHeight(WINDMILL_X, WINDMILL_Z), WINDMILL_Z);
                mill.rotation.y = Math.atan2(-WINDMILL_X, -WINDMILL_Z);

                const stone = patchMaterial(stdMat(0x7d766e, 0.95), { key: 'dusted-stone', worldNormal: true, fragmentColor: snowDustCode('0.9') });
                const plaster = stdMat(0xe3dccb, 0.9);
                const trim = patchMaterial(stdMat(0x4a3121, 0.8), { key: 'wood-dusted', worldNormal: true, fragmentColor: snowDustCode('0.8') });
                const dark = stdMat(0x2b1d14, 0.9);
                const roof = stdMat(0x474c55, 0.75);
                const winMat = new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: 0xff7a18, emissiveIntensity: 3, toneMapped: false });
                if (glowMaterials) glowMaterials.push({ material: winMat, key: 'window' });
                const sailMat = patchMaterial(
                    new THREE.MeshStandardMaterial({ color: 0xf1eadc, roughness: 0.85, side: THREE.DoubleSide }),
                    {
                        key: 'sail-cloth',
                        vertexBegin: /* glsl */`
                            float billow = sin(uv.x * 3.14159) * sin(uv.y * 3.14159);
                            transformed.z += billow * (0.05 + 0.018 * sin(uWindTime * 4.0 + uv.y * 6.0));
                            transformed.x += billow * 0.012 * sin(uWindTime * 3.0 + uv.y * 4.0);
                        `
                    }
                );

                const b = new StaticBatch();
                b.add(new THREE.CylinderGeometry(0.86, 0.94, 0.5, 8), stone, 0, 0.05, 0);
                b.add(new THREE.CylinderGeometry(0.5, 0.74, 2.1, 8), plaster, 0, 1.33, 0);
                b.add(new THREE.CylinderGeometry(0.755, 0.77, 0.08, 8), trim, 0, 0.34, 0);
                b.add(new THREE.CylinderGeometry(0.52, 0.52, 0.07, 8), trim, 0, 2.36, 0);
                b.box(dark, 0.26, 0.44, 0.06, 0, 0.55, 0.71, -0.11, 0, 0);
                b.box(trim, 0.34, 0.05, 0.08, 0, 0.8, 0.71, -0.11, 0, 0);
                [[1.55, 0.6], [1.9, -0.6], [1.62, Math.PI]].forEach(([y, a]) => {
                    const r = 0.74 - (y - 0.28) / 2.1 * 0.24 + 0.005;
                    b.box(winMat, 0.14, 0.2, 0.03, Math.sin(a) * r, y, Math.cos(a) * r, 0, a, 0);
                    b.box(trim, 0.2, 0.26, 0.02, Math.sin(a) * (r - 0.006), y, Math.cos(a) * (r - 0.006), 0, a, 0);
                });
                // Gallery deck
                b.add(new THREE.CylinderGeometry(0.98, 0.98, 0.05, 16), trim, 0, 1.0, 0);
                b.add(new THREE.TorusGeometry(0.94, 0.025, 4, 24).rotateX(Math.PI / 2), trim, 0, 1.26, 0);
                for (let i = 0; i < 16; i++) {
                    const a = i / 16 * Math.PI * 2;
                    b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 4), trim, Math.cos(a) * 0.94, 1.13, Math.sin(a) * 0.94);
                }
                // Ogee cap
                const capProfile = [[0.62, 0], [0.61, 0.1], [0.52, 0.3], [0.36, 0.5], [0.16, 0.66], [0.05, 0.74], [0, 0.76]].map(([x, y]) => new THREE.Vector2(x, y));
                b.add(new THREE.LatheGeometry(capProfile, 12), roof, 0, 2.39, 0);
                b.add(new THREE.SphereGeometry(0.05, 8, 6), trim, 0, 3.17, 0);
                b.build(mill);

                const capSnowProfile = [[0.58, 0.2], [0.44, 0.4], [0.24, 0.6], [0.08, 0.74], [0, 0.8]].map(([x, y]) => new THREE.Vector2(x * 1.06, y));
                const capSnow = new THREE.Mesh(new THREE.LatheGeometry(capSnowProfile, 12), snowSlabMaterial);
                capSnow.position.y = 2.39;
                mill.add(capSnow);

                // Rotor with lattice sails (clockwise when seen from the front)
                this.rotor = new THREE.Group();
                this.rotor.position.set(0, 2.66, 0.66);
                const rb = new StaticBatch();
                rb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222a35, roughness: 0.5, metalness: 0.7 }), 0, 0, 0);
                for (let i = 0; i < 4; i++) {
                    const m = new THREE.Matrix4().makeRotationZ(i * Math.PI / 2);
                    const add = (geo, mat) => rb.addMatrix(geo, mat, m);
                    add(new THREE.BoxGeometry(0.05, 1.6, 0.05).translate(0, 0.8, 0), dark);
                    for (let j = 0; j < 7; j++) add(new THREE.BoxGeometry(0.36, 0.02, 0.02).translate(0.15, 0.36 + j * 0.19, 0), trim);
                    add(new THREE.BoxGeometry(0.02, 1.25, 0.02).translate(0.33, 0.95, 0), trim);
                    add(new THREE.PlaneGeometry(0.32, 1.2, 3, 10).translate(0.17, 0.95, 0.015), sailMat);
                }
                rb.build(this.rotor);
                mill.add(this.rotor);

                // Fantail at the back of the cap: axis perpendicular to the sails.
                const tail = new THREE.Group();
                tail.position.set(0, 2.55, -0.62);
                const tb = new StaticBatch();
                tb.box(trim, 0.06, 0.06, 0.55, 0, 0, -0.25);
                tb.box(trim, 0.04, 0.5, 0.04, 0, -0.25, -0.2, 0.5, 0, 0);
                tb.build(tail);
                this.fantail = new THREE.Group();
                this.fantail.position.set(0, 0.05, -0.55);
                const fb = new StaticBatch();
                for (let i = 0; i < 6; i++) {
                    const m = new THREE.Matrix4().makeRotationX(i / 6 * Math.PI * 2)
                        .multiply(new THREE.Matrix4().makeTranslation(0, 0.15, 0))
                        .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2 + 0.35));
                    fb.addMatrix(new THREE.PlaneGeometry(0.1, 0.24), sailMat, m);
                }
                fb.build(this.fantail, { castShadow: false });
                tail.add(this.fantail);
                mill.add(tail);
                scene.add(mill);
            }
            update(dt) {
                this.rotor.rotation.z -= (WIND_SPEED * 0.9 + 0.3) * dt;   // clockwise, as in the reference
                this.fantail.rotation.x += 5.5 * dt;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           ROAD FURNITURE — guard rails with reflectors (snow on top in winter),
           the ALPINE PASS sign.
           ════════════════════════════════════════════════════════════════════ */
        function buildRoadDetails(scene, glowMaterials) {
            const guardMat = new THREE.MeshStandardMaterial({ color: 0x9da6a3, roughness: 0.45, metalness: 0.55 });
            const reflectorMat = new THREE.MeshStandardMaterial({ color: 0xffe5a1, emissive: 0xffa800, emissiveIntensity: 0.9, toneMapped: false });
            if (glowMaterials) glowMaterials.push({ material: reflectorMat, key: 'reflector' });
            [-1, 1].forEach(side => {
                [-5.7, 5.7].forEach(centerAlong => {
                    const group = new THREE.Group();
                    group.position.set(centerAlong * ROAD_DIR_X, 0, centerAlong * ROAD_DIR_Z);
                    group.rotation.y = Math.PI / 4;
                    const b = new StaticBatch();
                    b.box(guardMat, 0.055, 0.08, 2.5, side * 0.9, 0.39, 0);
                    for (let z = -1.05; z <= 1.06; z += 0.7) {
                        b.box(guardMat, 0.055, 0.38, 0.055, side * 0.9, 0.2, z);
                        b.box(reflectorMat, 0.07, 0.055, 0.025, side * 0.86, 0.42, z);
                    }
                    b.build(group);
                    const snow = new THREE.Mesh(snowSlab(0.07, 0.035, 2.48), snowSlabMaterial);
                    snow.position.set(side * 0.9, 0.43, 0);
                    group.add(snow);
                    scene.add(group);
                });
            });

            const canvas = createSafeCanvas();
            canvas.width = 512; canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#173e4c'; ctx.fillRect(0, 0, 512, 256);
            ctx.strokeStyle = '#dff7f9'; ctx.lineWidth = 13; ctx.strokeRect(13, 13, 486, 230);
            ctx.fillStyle = '#f4fbf8'; ctx.textAlign = 'center';
            ctx.font = '700 70px Arial'; ctx.fillText('ALPINE PASS', 256, 105);
            ctx.font = '600 48px Arial'; ctx.fillText('480 m  •  A-07', 256, 182);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const sign = new THREE.Group();
            const along = -3.75, side = -1.18;
            sign.position.set(along * ROAD_DIR_X + side * -ROAD_DIR_Z, 0.08, along * ROAD_DIR_Z + side * ROAD_DIR_X);
            sign.rotation.y = Math.PI / 4;
            const b = new StaticBatch();
            const postMat = new THREE.MeshStandardMaterial({ color: 0x48565a, metalness: 0.55, roughness: 0.5 });
            [-0.34, 0.34].forEach(x => b.box(postMat, 0.055, 1.35, 0.055, x, 0.68, 0));
            b.add(new THREE.PlaneGeometry(1.35, 0.67), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.68, side: THREE.DoubleSide }), 0, 1.25, 0.035);
            b.box(postMat, 1.37, 0.69, 0.02, 0, 1.25, 0.018);   // plain back panel
            b.build(sign);
            const signSnow = new THREE.Mesh(snowSlab(1.37, 0.05, 0.06), snowSlabMaterial);
            signSnow.position.set(0, 1.585, 0.035);
            sign.add(signSnow);
            scene.add(sign);
        }

        /* ════════════════════════════════════════════════════════════════════
           CAMPFIRE LOOKOUT — lit only on summer/autumn evenings.
           Reads: season.fire × time.evening (flames, embers, light).
           ════════════════════════════════════════════════════════════════════ */
        class Campfire {
            constructor(scene, glowMaterials) {
                const camp = new THREE.Group();
                camp.position.set(CAMP_X, getTerrainHeight(CAMP_X, CAMP_Z), CAMP_Z);
                const stone = patchMaterial(stdMat(0x615b56, 0.96), { key: 'dusted-stone', worldNormal: true, fragmentColor: snowDustCode('0.9') });
                const wood = patchMaterial(stdMat(0x3b2519, 0.9), { key: 'wood-dusted', worldNormal: true, fragmentColor: snowDustCode('0.8') });
                this.emberMat = new THREE.MeshStandardMaterial({ color: 0x33140b, emissive: 0xff3b0a, emissiveIntensity: 3.4, toneMapped: false });
                const b = new StaticBatch();
                for (let i = 0; i < 10; i++) {
                    const a = i / 10 * Math.PI * 2;
                    b.add(new THREE.DodecahedronGeometry(0.12, 0), stone, Math.cos(a) * 0.35, 0.08, Math.sin(a) * 0.35, 0, a, 0, 1, 0.65, 0.85);
                }
                [-0.65, 0.65].forEach((ry, i) => b.add(new THREE.CylinderGeometry(0.07, 0.09, 0.62, 6), this.emberMat, 0, 0.1 + i * 0.03, 0, 0, ry, Math.PI / 2));
                [[0.85, -0.32, -0.35], [-0.85, 0.32, 0.35]].forEach(([x, z, ry]) => b.add(new THREE.CylinderGeometry(0.1, 0.12, 1.05, 6), wood, x, 0.2, z, 0, ry, Math.PI / 2));
                b.build(camp);

                this.flames = [];
                for (let i = 0; i < 3; i++) {
                    const flame = new THREE.Mesh(
                        new THREE.ConeGeometry(0.14 - i * 0.025, 0.52 - i * 0.07, 6).translate(0, (0.52 - i * 0.07) / 2, 0),
                        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.25), transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false })
                    );
                    flame.position.set((i - 1) * 0.07, 0.12, (rand() - 0.5) * 0.08);
                    flame.rotation.z = (i - 1) * 0.18;
                    flame.userData.phase = rand() * Math.PI * 2;
                    camp.add(flame);
                    this.flames.push(flame);
                }
                this.light = new THREE.PointLight(0xff6b20, 1.5, 4.4, 1.7);
                this.light.position.set(0, 0.65, 0);
                camp.add(this.light);
                scene.add(camp);
            }
            update(t, fire) {
                const on = fire > 0.01;
                this.flames.forEach((f, i) => {
                    f.visible = on;
                    const flicker = 0.86 + Math.sin(t * (7.5 + i) + f.userData.phase) * 0.13 + Math.sin(t * 13) * 0.05;
                    f.scale.set(fire / flicker, fire * flicker, fire / flicker);
                    f.material.opacity = (0.78 + flicker * 0.14) * Math.min(1, fire * 1.5);
                });
                const flick = 0.92 + 0.08 * Math.sin(t * 17.3) * Math.sin(t * 7.1);
                this.light.intensity = 2.2 * fire * flick;
                this.emberMat.emissiveIntensity = 0.15 + fire * 3.2 * flick;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           BIRD FLOCK — loose boids (cohesion / alignment / separation) inside a
           soft bounding volume, flap-and-glide wings, banking into turns.
           Birds beyond the season's bird count migrate: they fly out of the
           diorama (and come back in spring) instead of vanishing.
           Reads: season.birds.
           ════════════════════════════════════════════════════════════════════ */
        class BirdFlock {
            constructor(scene, count = 9) {
                this.home = new THREE.Vector3(-1.8, 5.5, 1.6);
                this.migrateTo = new THREE.Vector3(42, 13, -40);
                this.birds = [];
                this._acc = new THREE.Vector3();
                this._sep = new THREE.Vector3();
                this._ali = new THREE.Vector3();
                this._coh = new THREE.Vector3();

                const wing = (s) => {
                    const g = new THREE.BufferGeometry();
                    const p = [
                        0.03, 0, 0.1, 0.5, 0.025, -0.02, 0.31, 0.015, 0.16,
                        0.03, 0, 0.1, 0.26, 0.012, -0.22, 0.5, 0.025, -0.02,
                        0.03, 0, 0.1, 0.09, 0, -0.15, 0.26, 0.012, -0.22
                    ];
                    if (s < 0) for (let i = 0; i < p.length; i += 9) {
                        // mirror X and flip winding
                        const tri = p.slice(i, i + 9);
                        const m = [-tri[0], tri[1], tri[2], -tri[6], tri[7], tri[8], -tri[3], tri[4], tri[5]];
                        p.splice(i, 9, ...m);
                    }
                    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
                    g.computeVertexNormals();
                    return g;
                };
                const leftWingGeo = wing(-1), rightWingGeo = wing(1);
                const tailGeo = new THREE.BufferGeometry();
                tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
                    -0.07, 0, -0.23, -0.16, 0, -0.4, 0, 0.025, -0.35,
                    0.07, 0, -0.23, 0, 0.025, -0.35, 0.16, 0, -0.4
                ], 3));
                tailGeo.computeVertexNormals();
                const palette = [0x67a9c2, 0xd98673, 0x82a879, 0xa38abb, 0xd7ad5b, 0x5f98a4];

                const colored = (geo, color) => {
                    geo = geo.index ? geo.toNonIndexed() : geo;
                    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
                    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
                    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
                    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
                    return geo;
                };

                for (let i = 0; i < count; i++) {
                    const bodyColor = new THREE.Color(palette[i % palette.length]);
                    const wingColor = bodyColor.clone().offsetHSL(0, -0.03, -0.09);
                    const bodyGeo = mergeGeometries([
                        colored(new THREE.SphereGeometry(0.14, 8, 6).scale(0.78, 0.72, 1.48), bodyColor),
                        colored(new THREE.SphereGeometry(0.105, 7, 5).scale(0.72, 0.44, 1.12).translate(0, -0.075, 0.035), new THREE.Color(0xf1e7d0)),
                        colored(new THREE.SphereGeometry(0.095, 8, 6).translate(0, 0.025, 0.215), bodyColor),
                        colored(new THREE.ConeGeometry(0.026, 0.08, 6).rotateX(Math.PI / 2).translate(0, 0.015, 0.32), new THREE.Color(0xe0a34c)),
                        colored(new THREE.SphereGeometry(0.012, 6, 4).translate(-0.073, 0.048, 0.265), new THREE.Color(0x10191c)),
                        colored(new THREE.SphereGeometry(0.012, 6, 4).translate(0.073, 0.048, 0.265), new THREE.Color(0x10191c)),
                        colored(tailGeo.clone(), wingColor)
                    ]);
                    const bird = new THREE.Group();
                    const body = new THREE.Mesh(bodyGeo, stdMat(0xffffff, 0.85, { vertexColors: true }));
                    body.castShadow = true;
                    const wingMat = stdMat(wingColor, 0.86, { side: THREE.DoubleSide });
                    const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
                    const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
                    leftWing.castShadow = rightWing.castShadow = true;
                    bird.add(body, leftWing, rightWing);
                    bird.scale.setScalar(0.24 + rand() * 0.085);
                    const a = i / count * Math.PI * 2;
                    const state = {
                        mesh: bird, leftWing, rightWing,
                        pos: new THREE.Vector3(this.home.x + Math.cos(a) * 2, this.home.y + (rand() - 0.5), this.home.z + Math.sin(a) * 2),
                        vel: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(1.4),
                        phase: rand() * Math.PI * 2,
                        flap: rand() * 6,
                        yaw: 0, bank: 0
                    };
                    bird.position.copy(state.pos);
                    scene.add(bird);
                    this.birds.push(state);
                }
            }

            update(dt, t, activeCount) {
                const active = Math.round(activeCount);
                const { birds, home, _acc: acc, _sep: sep, _ali: ali, _coh: coh } = this;
                for (let i = 0; i < birds.length; i++) {
                    const b = birds[i];
                    const migrating = i >= active;
                    acc.set(0, 0, 0);
                    if (!migrating) {
                        sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
                        let n = 0;
                        for (let j = 0; j < birds.length; j++) {
                            if (j === i || j >= active) continue;
                            const o = birds[j];
                            const d = b.pos.distanceTo(o.pos);
                            if (d > 2.6) continue;
                            n++;
                            ali.add(o.vel);
                            coh.add(o.pos);
                            if (d < 0.75) sep.add(_v1.subVectors(b.pos, o.pos).multiplyScalar((0.75 - d) / Math.max(d, 0.05)));
                        }
                        if (n > 0) {
                            ali.divideScalar(n).sub(b.vel).multiplyScalar(0.6);
                            coh.divideScalar(n).sub(b.pos).multiplyScalar(0.35);
                            acc.add(ali).add(coh);
                        }
                        acc.addScaledVector(sep, 2.4);
                        // Soft bounding volume around the mountain flank
                        _v2.subVectors(home, b.pos);
                        const horiz = Math.hypot(_v2.x, _v2.z);
                        if (horiz > 2.4) acc.addScaledVector(_v2.set(_v2.x, 0, _v2.z).normalize(), (horiz - 2.4) * 1.3);
                        acc.y += (home.y - b.pos.y) * 0.9;
                        // Gentle wander
                        acc.x += Math.sin(t * 0.7 + b.phase) * 0.35;
                        acc.z += Math.cos(t * 0.53 + b.phase * 1.3) * 0.35;
                        acc.y += Math.sin(t * 0.9 + b.phase * 2.1) * 0.25;
                    } else {
                        _v2.subVectors(this.migrateTo, b.pos).normalize().multiplyScalar(3.4);
                        acc.addScaledVector(_v2.sub(b.vel), 1.2);
                    }
                    b.vel.addScaledVector(acc, dt);
                    const speed = b.vel.length();
                    const maxSpeed = migrating ? 3.6 : 2.0, minSpeed = 1.0;
                    if (speed > maxSpeed) b.vel.multiplyScalar(maxSpeed / speed);
                    else if (speed < minSpeed) b.vel.multiplyScalar(minSpeed / Math.max(speed, 1e-3));
                    b.pos.addScaledVector(b.vel, dt);

                    const m = b.mesh;
                    m.visible = b.pos.distanceToSquared(home) < 55 * 55;
                    if (!m.visible) continue;
                    m.position.copy(b.pos);
                    m.lookAt(_v1.copy(b.pos).add(b.vel));
                    // Bank into turns from the yaw rate
                    const yaw = Math.atan2(b.vel.x, b.vel.z);
                    let dy = yaw - b.yaw;
                    if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
                    b.yaw = yaw;
                    b.bank = THREE.MathUtils.damp(b.bank, clamp(-dy / Math.max(dt, 1e-3) * 0.45, -0.75, 0.75), 4, dt);
                    m.rotateZ(b.bank);
                    // Flap / glide cycle: glide on descents and in periodic lulls
                    const glide = migrating ? 0.1 : smoothstep(Math.sin(t * 0.45 + b.phase), 0.25, 0.75) * (b.vel.y < 0.25 ? 1 : 0.3);
                    b.flap += dt * (10.5 - glide * 6.5);
                    const amp = lerp(0.6, 0.07, glide);
                    const f = Math.sin(b.flap) * amp;
                    b.leftWing.rotation.z = -0.06 - f - glide * 0.12;
                    b.rightWing.rotation.z = 0.06 + f + glide * 0.12;
                }
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           WEATHER PARTICLES — one pooled InstancedMesh, fully shader driven.
           Each instance cycles (age = fract(time/life)); every new cycle hashes a
           new spawn point, which is the GPU version of the chimney smoke's
           reset/age pooling. Particles fade on spawn, on despawn, at the
           diorama edges and when their type's rate drops — nothing ever pops.
           Types: 0 blossom petals, 1 pollen, 2 tumbling leaves, 3 snowflakes, 4 fireflies.
           Reads: uParticleRates, uFireflyRate, uWindDir, uNight, uSunDir, uTime.
           ════════════════════════════════════════════════════════════════════ */
        class WeatherParticles {
            constructor(scene) {
                const counts = QUALITY.PARTICLES;
                const typeCounts = [counts.petals, counts.pollen, counts.leaves, counts.snow, counts.fireflies];
                const total = typeCounts.reduce((a, b) => a + b, 0);
                const geo = new THREE.PlaneGeometry(1, 1);
                const types = new Float32Array(total);
                const seeds = new Float32Array(total * 4);
                let k = 0;
                typeCounts.forEach((c, type) => {
                    for (let i = 0; i < c; i++, k++) {
                        types[k] = type;
                        for (let j = 0; j < 4; j++) seeds[k * 4 + j] = rand();
                    }
                });
                geo.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));
                geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
                this.uniforms = { uPixelRatio: { value: 1 } };
                const material = new THREE.ShaderMaterial({
                    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...U, ...this.uniforms },
                    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
                    vertexShader: SHARED_DECL + /* glsl */`
                        #include <fog_pars_vertex>
                        attribute float aType; attribute vec4 aSeed;
                        uniform vec4 uParticleRates; uniform float uFireflyRate;
                        varying vec2 vUv; varying float vAlpha; varying float vType; varying vec3 vColor; varying float vShade; varying float vSeed;

                        float h1(float n) { return fract(sin(n) * 43758.5453123); }
                        mat3 rotAxis(vec3 a, float ang) {
                            float s = sin(ang), c = cos(ang), oc = 1.0 - c;
                            return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                                        oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                                        oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
                        }

                        void main() {
                            vType = aType; vUv = uv; vSeed = aSeed.y;
                            float fall = 0.0, size = 0.05, rate = 0.0;
                            bool tumbling = false, hovering = false;
                            if (aType < 0.5)      { fall = 0.5;  size = 0.085; rate = uParticleRates.x; tumbling = true; }
                            else if (aType < 1.5) { fall = 0.0;  size = 0.035; rate = uParticleRates.y; hovering = true; }
                            else if (aType < 2.5) { fall = 0.62; size = 0.14;  rate = uParticleRates.z; tumbling = true; }
                            else if (aType < 3.5) { fall = 0.8;  size = 0.055; rate = uParticleRates.w; }
                            else                  { fall = 0.0;  size = 0.075; rate = uFireflyRate; hovering = true; }

                            float speed = fall * (0.8 + aSeed.z * 0.4);
                            // Leaves and petals drop from tree height, snow from the clouds.
                            float top = aType < 0.5 ? 6.0 : (aType < 2.5 ? 4.6 : 8.2);
                            float life = hovering ? 8.0 + aSeed.z * 6.0 : (top + 1.4) / speed;
                            float t = uTime + aSeed.w * life * 7.0;
                            float cycle = floor(t / life);
                            float age = fract(t / life);
                            float ageSec = age * life;

                            // New spawn point every cycle (pool reuse)
                            vec3 c = vec3((h1(cycle * 12.9898 + aSeed.x * 78.233) - 0.5) * 15.0, 0.0,
                                          (h1(cycle * 39.3467 + aSeed.y * 11.135) - 0.5) * 15.0);
                            if (hovering) {
                                c.y = 0.5 + aSeed.z * 2.2 + sin(ageSec * 0.6 + aSeed.x * 20.0) * 0.3;
                                c.x += sin(ageSec * 0.5 + aSeed.y * 30.0) * 0.7 + uWindDir.x * ageSec * 0.12;
                                c.z += cos(ageSec * 0.43 + aSeed.x * 30.0) * 0.7 + uWindDir.y * ageSec * 0.12;
                            } else {
                                c.y = top + aSeed.z * 1.2 - ageSec * speed;
                                float fl = aType < 0.5 ? 0.35 : (aType < 2.5 ? 0.55 : 0.2);
                                c.xz += uWindDir * ageSec * (aType > 2.5 ? 0.32 : 0.45);
                                c.x += sin(ageSec * 1.7 + aSeed.x * 30.0) * fl;
                                c.z += cos(ageSec * 1.3 + aSeed.y * 30.0) * fl;
                            }
                            c.xz = mod(c.xz + 7.5, 15.0) - 7.5;

                            float threshold = fract(aSeed.x * 7.13 + aSeed.w * 3.1);
                            float presence = smoothstep(threshold, threshold + 0.1, rate * 1.1);
                            float edgeFade = 1.0 - smoothstep(6.5, 7.4, max(abs(c.x), abs(c.z)));
                            float lifeFade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.84, 1.0, age));
                            float groundFade = smoothstep(-0.4, 0.3, c.y);
                            vAlpha = presence * edgeFade * lifeFade * groundFade;
                            if (aType > 3.5) vAlpha *= 0.35 + 0.65 * pow(max(0.0, 0.5 + 0.5 * sin(uTime * (1.5 + aSeed.z * 2.0) + aSeed.x * 40.0)), 3.0);
                            if (vAlpha < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

                            vec3 local = vec3(position.xy, 0.0) * size * (0.7 + aSeed.y * 0.6);
                            vec3 world;
                            vec3 nrm = vec3(0.0, 0.0, 1.0);
                            if (tumbling) {
                                vec3 axis = normalize(vec3(aSeed.x - 0.5, aSeed.y - 0.2, aSeed.z - 0.5) + 0.001);
                                mat3 R = rotAxis(axis, ageSec * (1.4 + aSeed.w * 3.0) + aSeed.x * 6.28);
                                local = R * local;
                                nrm = R * nrm;
                                world = c + local;
                            } else {
                                vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
                                vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
                                world = c + right * local.x + up * local.y;
                            }
                            vShade = abs(dot(nrm, normalize(uSunDir)));

                            if (aType < 0.5) vColor = mix(vec3(1.0, 0.62, 0.78), vec3(1.0, 0.95, 0.96), step(0.55, aSeed.y));
                            else if (aType < 1.5) vColor = vec3(1.0, 0.86, 0.45);
                            else if (aType < 2.5) {
                                float p = fract(aSeed.y * 5.7);
                                vColor = p < 0.3 ? vec3(0.78, 0.14, 0.05) : p < 0.6 ? vec3(0.95, 0.45, 0.06) : p < 0.85 ? vec3(0.95, 0.72, 0.12) : vec3(0.45, 0.25, 0.1);
                            }
                            else if (aType < 3.5) vColor = vec3(0.95, 0.97, 1.0);
                            else vColor = vec3(0.9, 1.0, 0.35);

                            vec4 mvPosition = viewMatrix * vec4(world, 1.0);
                            gl_Position = projectionMatrix * mvPosition;
                            #include <fog_vertex>
                        }
                    `,
                    fragmentShader: SHARED_DECL + /* glsl */`
                        #include <fog_pars_fragment>
                        varying vec2 vUv; varying float vAlpha; varying float vType; varying vec3 vColor; varying float vShade; varying float vSeed;
                        void main() {
                            vec2 p = vUv - 0.5;
                            float a;
                            vec3 col = vColor;
                            if (vType < 0.5) {            // petal: rounded teardrop with a notch
                                vec2 q = p * vec2(1.7, 1.15);
                                a = smoothstep(0.5, 0.42, length(q + vec2(0.0, 0.08 * sign(p.y))));
                                a *= 1.0 - smoothstep(0.03, 0.0, abs(p.x)) * step(0.3, p.y);
                                col *= 0.62 + 0.55 * vShade;
                            } else if (vType < 1.5 || vType > 3.5) {   // pollen / firefly glow
                                float d = length(p);
                                a = pow(smoothstep(0.5, 0.0, d), 2.2);
                                col *= vType > 3.5 ? 3.2 : 1.4;
                            } else if (vType < 2.5) {     // leaf: pointed ellipse with a midrib
                                float w = 0.46 * pow(max(1.0 - pow(abs(p.y) * 2.0, 2.0), 0.0), 0.75);
                                a = smoothstep(w, w - 0.05, abs(p.x));
                                col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.x));
                                col *= 0.5 + 0.6 * vShade;
                            } else {                      // snowflake: soft disc
                                a = smoothstep(0.5, 0.12, length(p));
                                col *= 1.0 - uNight * 0.55;
                            }
                            if (vType < 3.5 && !(vType > 0.5 && vType < 1.5)) col *= mix(1.0, 0.35, uNight);
                            a *= vAlpha;
                            if (a < 0.01) discard;
                            gl_FragColor = vec4(col, a);
                            #include <tonemapping_fragment>
                            #include <colorspace_fragment>
                            #include <fog_fragment>
                        }
                    `
                });
                this.mesh = new THREE.InstancedMesh(geo, material, total);
                this.mesh.frustumCulled = false;
                this.mesh.renderOrder = 3;
                scene.add(this.mesh);
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           CHIMNEY SMOKE — CPU pool with reset/age, drawn as one InstancedMesh with
           per-instance alpha. Reads: season.smoke (emission), time.night (tint).
           ════════════════════════════════════════════════════════════════════ */
        class ChimneySmoke {
            constructor(scene, origin, count = 26) {
                this.origin = origin || new THREE.Vector3(HUT_X, getTerrainHeight(HUT_X, HUT_Z) + 1.8, HUT_Z);
                this.alpha = new Float32Array(count);
                const geo = new THREE.DodecahedronGeometry(0.12, 1);
                geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
                this.material = patchMaterial(
                    new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.95, transparent: true, depthWrite: false, flatShading: true }),
                    {
                        key: 'smoke', heightFog: false,
                        vertexPars: 'attribute float aAlpha; varying float vAlpha;',
                        vertexBegin: 'vAlpha = aAlpha;',
                        fragmentPars: 'varying float vAlpha;',
                        diffuse: 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );'
                    }
                );
                this.mesh = new THREE.InstancedMesh(geo, this.material, count);
                this.mesh.frustumCulled = false;
                this.particles = Array.from({ length: count }, (_, i) => ({
                    pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: -i / count * 3.5, maxAge: 3, size: 0.3, live: false
                }));
                this.particles.forEach(p => this.reset(p, 1));
                scene.add(this.mesh);
            }
            reset(p, amount) {
                p.pos.copy(this.origin);
                p.vel.set((rand() - 0.5) * 0.18, 0.42 + rand() * 0.35, (rand() - 0.5) * 0.18);
                p.maxAge = 2.2 + rand() * 2.2;
                p.size = 0.2 + rand() * 0.4;
                p.live = rand() < amount;
                if (p.age >= 0) p.age = 0;
            }
            update(dt, amount, night) {
                this.material.color.setRGB(lerp(0.62, 0.22, night), lerp(0.62, 0.24, night), lerp(0.64, 0.3, night));
                for (let i = 0; i < this.particles.length; i++) {
                    const p = this.particles[i];
                    p.age += dt;
                    if (p.age >= p.maxAge) this.reset(p, amount);
                    const prog = Math.max(p.age, 0) / p.maxAge;
                    if (p.age >= 0) {
                        p.pos.addScaledVector(p.vel, dt);
                        p.pos.x += U.uWindDir.value.x * dt * 0.25 * prog;
                        p.pos.z += U.uWindDir.value.y * dt * 0.25 * prog;
                    }
                    const visible = p.live && p.age >= 0;
                    _obj.position.copy(p.pos);
                    _obj.rotation.set(0, prog * 2, 0);
                    _obj.scale.setScalar(visible ? (0.4 + prog * 2.6) * (1 - prog * 0.45) * p.size * 2 : 0);
                    _obj.updateMatrix();
                    this.mesh.setMatrixAt(i, _obj.matrix);
                    this.alpha[i] = visible ? smoothstep(prog, 0, 0.08) * (1 - prog) * 0.5 * (0.6 + amount * 0.4) : 0;
                }
                this.mesh.instanceMatrix.needsUpdate = true;
                this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           TRAFFIC — two lanes, wrap-around gap-based braking (reference logic).
           Headlights paint cheap additive light pools instead of using 12 spot lights.
           Reads: time.carLights, uSnowCoverage (roof snow).
           ════════════════════════════════════════════════════════════════════ */
        const CAR_SHARED = (() => {
            // Soft elliptical light pool painted on the asphalt ahead of each car.
            const poolCanvas = createSafeCanvas();
            poolCanvas.width = poolCanvas.height = 128;
            const ctx = poolCanvas.getContext('2d');
            const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,.9)');
            g.addColorStop(0.45, 'rgba(255,255,255,.35)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
            const poolTex = new THREE.CanvasTexture(poolCanvas);
            const tireGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12).rotateZ(Math.PI / 2);
            const rimGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.11, 8).rotateZ(Math.PI / 2);
            const paint = (geo, c) => {
                const n = geo.attributes.position.count, a = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) { a[i * 3] = c; a[i * 3 + 1] = c; a[i * 3 + 2] = c; }
                geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
                return geo;
            };
            return {
                wheelGeo: mergeGeometries([paint(nonIndexed(tireGeo), 0.012), paint(nonIndexed(rimGeo), 0.6)]),
                wheelMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }),
                chassisMat: stdMat(0x222222, 0.8),
                cabinMat: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1, metalness: 0.9, flatShading: true }),
                headMat: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 0, toneMapped: false }),
                tailMat: new THREE.MeshStandardMaterial({ color: 0xcc0000, emissive: 0xff0000, emissiveIntensity: 0, toneMapped: false }),
                poolGeo: new THREE.PlaneGeometry(0.95, 1.9).rotateX(-Math.PI / 2).translate(0, 0.035, 1.45),
                poolMat: new THREE.MeshBasicMaterial({
                    color: 0xffe7b8, alphaMap: poolTex, transparent: true, opacity: 0, depthWrite: false,
                    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, fog: true
                })
            };
        })();

        class Car {
            constructor(scene, isForward, initialPos) {
                this.isForward = isForward;
                this.pos = initialPos;
                this.baseSpeed = 2.5 + rand() * 0.8;
                this.currentSpeed = this.baseSpeed;
                this.lastSpeed = this.currentSpeed;
                this.rideHeight = 0.03;
                this.wheels = [];
                const colors = [0xd62828, 0x0077b6, 0xfca311, 0xeeeeee, 0x2a9d8f];
                const bodyMat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(rand() * colors.length)], roughness: 0.3, metalness: 0.4, flatShading: true });
                const S = CAR_SHARED;
                this.group = new THREE.Group();
                const b = new StaticBatch();
                b.box(S.chassisMat, 0.42, 0.1, 1.0, 0, 0.15, 0);
                b.box(bodyMat, 0.44, 0.16, 0.98, 0, 0.28, 0);
                b.box(S.cabinMat, 0.36, 0.2, 0.45, 0, 0.46, -0.05);
                b.box(bodyMat, 0.38, 0.04, 0.47, 0, 0.57, -0.05);
                [-0.14, 0.14].forEach(x => b.box(S.headMat, 0.1, 0.05, 0.02, x, 0.32, 0.49));
                [-0.15, 0.15].forEach(x => b.box(S.tailMat, 0.12, 0.04, 0.02, x, 0.32, -0.49));
                b.build(this.group);
                [[0.22, 0.12, 0.28], [-0.22, 0.12, 0.28], [0.22, 0.12, -0.28], [-0.22, 0.12, -0.28]].forEach(p => {
                    const w = new THREE.Mesh(S.wheelGeo, S.wheelMat);
                    w.position.set(...p);
                    w.castShadow = true;
                    this.group.add(w);
                    this.wheels.push(w);
                });
                const pool = new THREE.Mesh(S.poolGeo, S.poolMat);
                pool.renderOrder = 4;
                this.group.add(pool);
                const roofSnow = new THREE.Mesh(snowSlab(0.38, 0.05, 0.47), snowSlabMaterial);
                roofSnow.position.set(0, 0.59, -0.05);
                this.group.add(roofSnow);
                this.group.rotation.y = isForward ? Math.PI / 4 : -3 * Math.PI / 4;
                scene.add(this.group);
            }

            update(dt, sameLane) {
                let minDist = Infinity;
                for (let i = 0; i < sameLane.length; i++) {
                    const other = sameLane[i];
                    if (other === this) continue;
                    let diff = this.isForward ? other.pos - this.pos : this.pos - other.pos;
                    while (diff > 11.5) diff -= 23;
                    while (diff < -11.5) diff += 23;
                    if (diff > 0 && diff < minDist) minDist = diff;
                }
                if (minDist < 1.9) this.currentSpeed = 0;
                else if (minDist < 3.5) this.currentSpeed = Math.max(0, this.currentSpeed - 12 * dt);
                else if (minDist < 6.0) this.currentSpeed = Math.max(1, this.currentSpeed - 4 * dt);
                else this.currentSpeed = Math.min(this.baseSpeed, this.currentSpeed + 2.5 * dt);

                const acceleration = (this.currentSpeed - this.lastSpeed) / Math.max(dt, 0.001);
                this.lastSpeed = this.currentSpeed;
                if (this.isForward) { this.pos += this.currentSpeed * dt; if (this.pos > 11.5) this.pos -= 23; }
                else { this.pos -= this.currentSpeed * dt; if (this.pos < -11.5) this.pos += 23; }

                const side = this.isForward ? -1 : 1;
                this.group.position.x = this.pos * ROAD_DIR_X + side * 0.38 * -ROAD_DIR_Z;
                this.group.position.z = this.pos * ROAD_DIR_Z + side * 0.38 * ROAD_DIR_X;
                const roadHeightAt = along => 0.03 + (1 - smoothstep(Math.abs(along - BRIDGE_ALONG), 0.78, 1.34)) * 0.065;
                this.rideHeight = THREE.MathUtils.damp(this.rideHeight, roadHeightAt(this.pos), 14, dt);
                this.group.position.y = this.rideHeight;
                const dir = this.isForward ? 1 : -1;
                const pitch = Math.atan2(roadHeightAt(this.pos + dir * 0.24) - roadHeightAt(this.pos - dir * 0.24), 0.48);
                const brake = clamp(-acceleration * 0.006, -0.045, 0.055);
                this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, pitch + brake, 9, dt);
                const turn = this.currentSpeed * dt / 0.12;
                for (const w of this.wheels) w.rotation.x -= turn;
                const absPos = Math.abs(this.pos);
                this.group.scale.setScalar(absPos > 9.5 ? Math.max(0.0001, 1 - (absPos - 9.5) / 1.5) : 1);
            }
        }

        class Traffic {
            constructor(scene) {
                this.cars = [];
                for (let i = 0; i < 3; i++) {
                    this.cars.push(new Car(scene, true, -9.5 + i * 7));
                    this.cars.push(new Car(scene, false, 9.5 - i * 7));
                }
                // Lanes computed once — no per-frame filtering.
                this.forward = this.cars.filter(c => c.isForward);
                this.backward = this.cars.filter(c => !c.isForward);
            }
            update(dt, lights) {
                for (const c of this.forward) c.update(dt, this.forward);
                for (const c of this.backward) c.update(dt, this.backward);
                CAR_SHARED.headMat.emissiveIntensity = lights * 2.4;
                CAR_SHARED.tailMat.emissiveIntensity = lights * 3;
                CAR_SHARED.poolMat.opacity = Math.max(0, lights - 0.3) * 0.2;
            }
        }

        /* ════════════════════════════════════════════════════════════════════
           CAMERA RIG — eased preset transitions (Orbit / Ridge / Road).
           ════════════════════════════════════════════════════════════════════ */
        const CAMERA_PRESETS = {
            overview: { position: new THREE.Vector3(16, 12, 16), target: new THREE.Vector3(0, 0.35, 0) },
            ridge: { position: new THREE.Vector3(10.5, 7.4, -10.5), target: new THREE.Vector3(-3.5, 2.25, 3.25) },
            road: { position: new THREE.Vector3(-8.6, 2.8, -8.6), target: new THREE.Vector3(2.2, 0.55, 2.2) }
        };



export class AlpinePassage {
    constructor(scene, glowMaterials = [], spawnDioramaTraffic = true) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'AlpinePassageDiorama';
        this.glowMaterials = glowMaterials;
        this.updatables = [];

        // 1. Terrain & Cliffs
        this.terrain = new Terrain(this.group);

        // 2. Stream, waterfall cascade & mist
        this.stream = new Stream(this.group, this.terrain.rockGeometry, this.terrain.rockMaterial);
        this.updatables.push(this.stream);

        // 3. Stone Bridge
        this.bridge = new Bridge(this.group, glowMaterials);
        this.updatables.push(this.bridge);

        // 4. Alpine Architecture: Chalet & Windmill
        this.chalet = new Chalet(this.group, glowMaterials);
        this.updatables.push(this.chalet);

        this.windmill = new Windmill(this.group, glowMaterials);
        this.updatables.push(this.windmill);

        // 5. Road furniture (guardrails, reflectors, ALPINE PASS sign)
        buildRoadDetails(this.group, glowMaterials);

        // 6. Campfire lookout
        this.campfire = new Campfire(this.group, glowMaterials);
        this.updatables.push(this.campfire);

        // 7. Vegetation (Pines, Birches, Spruce, instanced grass)
        this.vegetation = new Vegetation(this.group);

        // 8. Chimney Smoke & Birds
        this.chimneySmoke = new ChimneySmoke(this.group, this.chalet?.chimneyTop);
        this.updatables.push(this.chimneySmoke);

        this.birds = new BirdFlock(this.group);
        this.updatables.push(this.birds);

        // 9. Traffic (Micro diorama cars)
        if (spawnDioramaTraffic) {
            this.traffic = new Traffic(this.group);
            this.updatables.push(this.traffic);
        }

        scene.add(this.group);
    }

    update(dt, controller) {
        if (!controller) return;
        const S = controller.season, T = controller.time;
        for (const u of this.updatables) {
            try {
                if (u === this.stream) u.update(dt, U.uFlowTime.value);
                else if (u === this.bridge) u.update(T);
                else if (u === this.chalet) u.update(T);
                else if (u === this.windmill) u.update(dt, U.uWindTime.value);
                else if (u === this.campfire) u.update(dt, S.fireflies || 0.5, T.evening || 0);
                else if (u === this.chimneySmoke) u.update(dt);
                else if (u === this.birds) u.update(dt);
                else if (u === this.traffic) u.update(dt, T.carLights || 0);
            } catch (e) {
                // Ignore individual prop tick error
            }
        }
    }

    dispose() {
        this.scene.remove(this.group);
    }
}

export {
    WORLD_SIZE, HALF_WORLD, ROAD_WIDTH, ROAD_DIR_X, ROAD_DIR_Z,
    BRIDGE_X, BRIDGE_Z, BRIDGE_ALONG, PEAK_X, PEAK_Z, HUT_X, HUT_Z,
    WINDMILL_X, WINDMILL_Z, CAMP_X, CAMP_Z, CAMERA_PRESETS,
    getTerrainHeight, distanceToStream, getLateralRoadDist,
    Terrain, Stream, Bridge, Vegetation, Chalet, Windmill, Campfire, BirdFlock, ChimneySmoke, Traffic
};
