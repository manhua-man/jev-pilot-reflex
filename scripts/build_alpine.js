import fs from 'fs';
import { transformSync } from 'esbuild';

const html = fs.readFileSync('F:/Four-Seasons/index.html', 'utf8');
const lines = html.split('\n');

// 0-indexed slicing
// Part 1: Layout & Math (lines 660 to 843)
const part1 = lines.slice(659, 843).join('\n');

// Part 2: snowDustCode (lines 935 to 942)
const part2 = lines.slice(934, 942).join('\n');

// Part 3: StaticBatch & snowSlab (lines 1233 to 1299)
const part3 = lines.slice(1232, 1299).join('\n');

// Part 4: Scenery + Traffic (lines 1516 to 3496)
const part4 = lines.slice(1515, 3496).join('\n');

// Part 5: Camera Presets (lines 3498 to 3506)
const part5 = lines.slice(3497, 3506).join('\n');

let snippet = part1 + '\n\n' + part2 + '\n\n' + part3 + '\n\n' + part4 + '\n\n' + part5;
snippet = snippet.replaceAll("document.createElement('canvas')", "createSafeCanvas()");

const header = `import * as THREE from 'three';
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
`;

const footer = `

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
        this.stream = new Stream(this.group, glowMaterials);
        this.updatables.push(this.stream);

        // 3. Stone Bridge
        this.bridge = new Bridge(this.group, glowMaterials);
        this.updatables.push(this.bridge);

        // 4. Alpine Architecture: Chalet & Windmill
        this.chalet = new Chalet(this.group, glowMaterials);
        this.updatables.push(this.chalet);

        this.windmill = new Windmill(this.group);
        this.updatables.push(this.windmill);

        // 5. Road furniture (guardrails, reflectors, ALPINE PASS sign)
        buildRoadDetails(this.group, glowMaterials);

        // 6. Campfire lookout
        this.campfire = new Campfire(this.group, glowMaterials);
        this.updatables.push(this.campfire);

        // 7. Vegetation (Pines, Birches, Spruce, instanced grass)
        this.vegetation = new Vegetation(this.group);

        // 8. Chimney Smoke & Birds
        this.chimneySmoke = new ChimneySmoke(this.group);
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
`;

const finalCode = header + '\n' + snippet + '\n' + footer;
fs.writeFileSync('F:/tmp_jevpilot/src/alpine-world.js', finalCode);

try {
  transformSync(finalCode, { loader: 'js' });
  console.log('✅ esbuild: src/alpine-world.js has 100% valid syntax!');
} catch (e) {
  console.error('❌ esbuild error:', e.errors);
  process.exit(1);
}
