import * as THREE from "three";
import { pbr, metricUV } from "./materials.js";
import { dist, heading, move } from "./math.js";
import {
  U,
  patchMaterial,
  GLSL_NOISE,
  SHARED_DECL,
  HEIGHT_FOG_CODE,
} from "./seasons-environment.js";

/**
 * High-Fidelity Engineered Road & Lane Renderer
 * Inspired by iamtechartist/Four-Seasons
 *
 * Replaces crude flat untextured boxes with:
 * - Real PBR asphalt material with procedural micro-grain noise
 * - Dynamic seasonal wetness / puddle reflections (snWet)
 * - Road shoulder and curb snow accumulation in winter (edgeSnow)
 * - Zero z-fighting layered lane markings (yellow dual centerlines, white dashed dividers, outer solid edge lines)
 * - Modern pedestrian zebra crossings & intersection stop lines
 * - Automotive cat's eye retroreflectors (道钉) that catch headlights at night
 * - Chevron fork gore markings (人字形导流岛)
 */

let cachedAsphaltMaterial = null;
let cachedPavementMaterial = null;
let cachedYellowMarkingMaterial = null;
let cachedWhiteMarkingMaterial = null;
let cachedCurbMaterial = null;
let cachedReflectorMaterial = null;

export function getAsphaltMaterial() {
  if (!cachedAsphaltMaterial) {
    const baseMat = pbr("asphalt", "#24272c", 4.0);
    cachedAsphaltMaterial = patchMaterial(baseMat.clone(), {
      key: "engineered-asphalt",
      worldPos: true,
      worldNormal: true,
      heightFog: true,
      fragmentPars: /* glsl */ `
        varying vec3 vMat;
      `,
      fragmentColor: /* glsl */ `
        // Micro-grain aggregate noise to break up repetitive tiling
        float grain = sn_fbm(vWPos.xz * 2.8) * 0.16 + sn_noise(vWPos.xz * 12.0) * 0.08;
        diffuseColor.rgb *= (0.92 + grain);

        // Seasonal wetness darkening (wet asphalt is significantly darker and richer)
        float wetDarkening = clamp(uWetness * 1.35, 0.0, 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.52, wetDarkening);

        // Winter road shoulder snow accumulation
        float snowNoise = sn_noise(vWPos.xz * 4.2) * 0.5 + sn_noise(vWPos.xz * 14.0) * 0.5;
        float snowAmount = uSnowCoverage * smoothstep(0.45, 0.82, snowNoise + uSnowCoverage * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.96), snowAmount * 0.75);
      `,
      fragmentRoughness: /* glsl */ `
        // Real asphalt retains aggregate roughness even under damp/rain conditions (slight sheen, not a chrome mirror)
        float wetRoughness = mix(roughnessFactor, 0.56, clamp(uWetness * 0.75, 0.0, 0.5));
        roughnessFactor = wetRoughness;
      `,
    });
    cachedAsphaltMaterial.roughness = 0.92;
    cachedAsphaltMaterial.envMapIntensity = 0.08;
    cachedAsphaltMaterial.userData.metersPerTile = 4.0;
  }
  return cachedAsphaltMaterial;
}

export function getPavementMaterial() {
  if (!cachedPavementMaterial) {
    const baseMat = pbr("pavement", "#d6d4cb", 3.0);
    cachedPavementMaterial = patchMaterial(baseMat.clone(), {
      key: "engineered-pavement",
      worldPos: true,
      worldNormal: true,
      heightFog: true,
      fragmentColor: /* glsl */ `
        // Pavement aging and winter frost
        float frost = uFrost * (0.4 + 0.3 * sn_noise(vWPos.xz * 5.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.92), frost);

        // Horizontal snow dusting
        float snowN = sn_noise(vWPos.xz * 3.5);
        float sd = uSnowCoverage * smoothstep(0.35, 0.72, vWNrm.y + (snowN - 0.5) * 0.4);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.89, 0.93, 0.98), sd);
      `,
    });
    cachedPavementMaterial.roughness = 0.88;
    cachedPavementMaterial.envMapIntensity = 0.12;
    cachedPavementMaterial.userData.metersPerTile = 3.0;
  }
  return cachedPavementMaterial;
}

export function getYellowMarkingMaterial() {
  if (!cachedYellowMarkingMaterial) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.42,
      metalness: 0.05,
      envMapIntensity: 0.15,
    });
    cachedYellowMarkingMaterial = patchMaterial(mat, {
      key: "marking-yellow",
      worldPos: true,
      heightFog: true,
      fragmentColor: /* glsl */ `
        // Retroreflective micro-beads catching vehicle headlights at night
        float retro = uNight * 0.4 + uEvening * 0.2;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.85, 0.2), retro);

        // Winter snow dust covering paint
        float snowN = sn_noise(vWPos.xz * 6.0);
        float snowCover = uSnowCoverage * smoothstep(0.5, 0.85, snowN + uSnowCoverage * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snowCover * 0.6);
      `,
      fragmentEmissive: /* glsl */ `
        // Retroreflective glint under headlights
        totalEmissiveRadiance += vec3(0.98, 0.78, 0.12) * (0.08 + uNight * 0.35);
      `,
    });
  }
  return cachedYellowMarkingMaterial;
}

export function getWhiteMarkingMaterial() {
  if (!cachedWhiteMarkingMaterial) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.38,
      metalness: 0.05,
      envMapIntensity: 0.15,
    });
    cachedWhiteMarkingMaterial = patchMaterial(mat, {
      key: "marking-white",
      worldPos: true,
      heightFog: true,
      fragmentColor: /* glsl */ `
        float retro = uNight * 0.45 + uEvening * 0.22;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 1.0, 1.0), retro);

        float snowN = sn_noise(vWPos.xz * 6.0);
        float snowCover = uSnowCoverage * smoothstep(0.5, 0.85, snowN + uSnowCoverage * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.97), snowCover * 0.6);
      `,
      fragmentEmissive: /* glsl */ `
        totalEmissiveRadiance += vec3(0.92, 0.95, 1.0) * (0.08 + uNight * 0.38);
      `,
    });
  }
  return cachedWhiteMarkingMaterial;
}

export function getReflectorMaterial(glowMaterials) {
  if (!cachedReflectorMaterial) {
    cachedReflectorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe5a1,
      roughness: 0.15,
      metalness: 0.75,
      emissive: new THREE.Color(0xffa800),
      emissiveIntensity: 1.2,
      toneMapped: false,
    });
    if (glowMaterials) {
      glowMaterials.push({
        material: cachedReflectorMaterial,
        key: "reflector",
      });
    }
  }
  return cachedReflectorMaterial;
}

/**
 * Spawns a cat's eye road stud (道钉)
 */
export function addRoadStud(group, x, y, z, rotY, reflectorMat) {
  const studGeo = new THREE.BoxGeometry(0.14, 0.03, 0.14);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    metalness: 0.8,
    roughness: 0.3,
  });
  const studMesh = new THREE.Mesh(studGeo, baseMat);
  studMesh.position.set(x, y + 0.015, z);
  studMesh.rotation.y = rotY;

  const crystalGeo = new THREE.BoxGeometry(0.08, 0.02, 0.04);
  const crystal = new THREE.Mesh(crystalGeo, reflectorMat);
  crystal.position.set(0, 0.015, 0);
  studMesh.add(crystal);
  group.add(studMesh);
}

/**
 * Builds high-fidelity urban city roads
 */
export function buildCityRoadNetwork(scene, group, world, glowMaterials) {
  const asphaltMat = getAsphaltMaterial();
  const pavementMat = getPavementMaterial();
  const yellowMat = getYellowMarkingMaterial();
  const whiteMat = getWhiteMarkingMaterial();
  const reflectorMat = getReflectorMaterial(glowMaterials);

  // 1. Straight road edges
  for (const e of world.edges) {
    const a = world.byId[e.a],
      b = world.byId[e.b];
    if (!a || !b) continue;

    const len = dist(a, b);
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const h = heading(a, b);
    const roadWidth = e.width || 20;

    // A. Concrete sidewalks / raised curbs on left and right (12cm urban curb step)
    // Diverging expressway ramps from the fork junction do not have pedestrian sidewalks
    if (e.a !== "fork-junction") {
      const sidewalkWidth = 2.4;
      const sidewalkHeight = 0.22;
      const sidewalkOffset = roadWidth / 2 + sidewalkWidth / 2;

      const clearA = (a.isFork || a.id === "fork-junction") ? 14.0 : 11.2;
      const clearB = (b.isFork || b.id === "fork-junction") ? 14.0 : 11.2;
      const curbLen = len - (clearA + clearB);

      if (curbLen > 4.0) {
        const curbCenterPoint = move(a, h, (clearA + len - clearB) / 2);
        for (const sd of [-sidewalkOffset, sidewalkOffset]) {
          const sp = move(curbCenterPoint, h + Math.PI / 2, sd);
          const curbGeo = new THREE.BoxGeometry(sidewalkWidth, sidewalkHeight, curbLen);
          const curbMesh = new THREE.Mesh(
            metricUV(curbGeo, pavementMat),
            pavementMat,
          );
          curbMesh.position.set(sp.x, 0.02, sp.z);
          curbMesh.rotation.y = -h;
          curbMesh.receiveShadow = true;
          group.add(curbMesh);
        }
      }
    }

    // B. Engineered asphalt road deck (top surface at y = 0.01)
    const roadGeo = new THREE.BoxGeometry(roadWidth, 0.12, len + 0.2);
    const roadMesh = new THREE.Mesh(
      metricUV(roadGeo, asphaltMat),
      asphaltMat,
    );
    roadMesh.position.set(x, -0.05, z);
    roadMesh.rotation.y = -h;
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // C. Double solid yellow centerlines (双黄线: ±0.24m, width 0.14m at y = 0.022)
    // One-way diverging expressway ramps do not use opposing yellow centerlines
    if (e.a !== "fork-junction") {
      for (const yellowOffset of [-0.24, 0.24]) {
        const yp = move({ x, z }, h + Math.PI / 2, yellowOffset);
        const markGeo = new THREE.PlaneGeometry(
          0.14,
          Math.max(1, len - 16),
        );
        markGeo.rotateX(-Math.PI / 2);
        const markMesh = new THREE.Mesh(markGeo, yellowMat);
        markMesh.position.set(yp.x, 0.022, yp.z);
        markMesh.rotation.y = -h;
        group.add(markMesh);
      }
    }

    // D. Lane dividing dashed lines
    // Diverging one-way ramps have a single center divider at 0; 4-lane roads have dividers at ±roadWidth/4
    const isForkBranch = e.a === "fork-junction";
    const dashOffsets = isForkBranch ? [0] : [-roadWidth / 4, roadWidth / 4];
    const dashLength = 4.0;
    const dashGap = 5.0;
    const step = dashLength + dashGap;
    let studCounter = 0;

    for (let k = 14; k < len - 14; k += step) {
      for (const sd of dashOffsets) {
        const dp = move(move(a, h, k + dashLength / 2), h + Math.PI / 2, sd);
        const dashGeo = new THREE.PlaneGeometry(0.15, dashLength);
        dashGeo.rotateX(-Math.PI / 2);
        const dashMesh = new THREE.Mesh(dashGeo, whiteMat);
        dashMesh.position.set(dp.x, 0.023, dp.z);
        dashMesh.rotation.y = -h;
        group.add(dashMesh);

        // Add cat's eye retroreflector every 2 dashes (~18m)
        if (studCounter % 2 === 0) {
          const sp = move(
            move(a, h, k + dashLength + dashGap / 2),
            h + Math.PI / 2,
            sd,
          );
          addRoadStud(group, sp.x, 0.015, sp.z, -h, reflectorMat);
        }
      }
      studCounter++;
    }

    // E. Outer edge solid white boundary lines
    const edgeOffset = roadWidth / 2 - 0.65;
    for (const sd of [-edgeOffset, edgeOffset]) {
      // Skip inner gore sides for fork branches to prevent lines crossing into the gore island
      if (isForkBranch && e.b === "fork-left" && sd > 0) continue;
      if (isForkBranch && e.b === "fork-right" && sd < 0) continue;

      const ep = move({ x, z }, h + Math.PI / 2, sd);
      const edgeGeo = new THREE.PlaneGeometry(
        0.18,
        Math.max(1, len - 16),
      );
      edgeGeo.rotateX(-Math.PI / 2);
      const edgeMesh = new THREE.Mesh(edgeGeo, whiteMat);
      edgeMesh.position.set(ep.x, 0.022, ep.z);
      edgeMesh.rotation.y = -h;
      group.add(edgeMesh);
    }
  }

  // 2. Intersections & Crosswalks
  for (const n of world.nodes.filter(
    (node) =>
      world.type !== "highway" || node.townJunction,
  )) {
    // A. Smooth asphalt junction deck (top surface at y = 0.01)
    const isFork = n.isFork || n.id === "fork-junction";
    const juncW = isFork ? 34.0 : 20.4;
    const juncL = isFork ? 36.0 : 20.4;
    const juncZ = isFork ? n.z + 10.0 : n.z;
    const juncGeo = new THREE.BoxGeometry(juncW, 0.12, juncL);
    const juncMesh = new THREE.Mesh(
      metricUV(juncGeo, asphaltMat),
      asphaltMat,
    );
    juncMesh.position.set(n.x, -0.05, juncZ);
    juncMesh.receiveShadow = true;
    group.add(juncMesh);

    // B. Pedestrian zebra stripes & stop lines for controlled intersections
    if (n.control !== "none" && !isFork) {
      for (const id of n.neighbors) {
        const b = world.byId[id];
        if (!b) continue;

        const dx = Math.sign(b.x - n.x);
        const dz = Math.sign(b.z - n.z);

        // Zebra crossings (pedestrian crosswalk bars across 4 lanes)
        for (let k = -8.0; k <= 8.0; k += 1.6) {
          const zebraW = dx ? 3.0 : 0.8;
          const zebraL = dx ? 0.8 : 3.0;
          const zebraGeo = new THREE.PlaneGeometry(zebraW, zebraL);
          zebraGeo.rotateX(-Math.PI / 2);
          const zebraMesh = new THREE.Mesh(zebraGeo, whiteMat);
          zebraMesh.position.set(
            n.x + dx * 11.2 + (dz ? k : 0),
            0.024,
            n.z + dz * 11.2 + (dx ? k : 0),
          );
          group.add(zebraMesh);
        }

        // Solid stop bar (0.45m wide, 9.2m long) across oncoming traffic
        const stopW = dx ? 0.45 : 9.2;
        const stopL = dx ? 9.2 : 0.45;
        const stopGeo = new THREE.PlaneGeometry(stopW, stopL);
        stopGeo.rotateX(-Math.PI / 2);
        const stopMesh = new THREE.Mesh(stopGeo, whiteMat);
        stopMesh.position.set(
          n.x + dx * 13.8 + (dz ? dz * 4.6 : 0),
          0.025,
          n.z + dz * 13.8 + (dx ? -dx * 4.6 : 0),
        );
        group.add(stopMesh);
      }
    }
  }
}

/**
 * Builds high-fidelity highway ribbons, connector ramps, and fork gores
 */
export function buildHighwayRoadNetwork(scene, group, world, glowMaterials) {
  const asphaltMat = getAsphaltMaterial();
  const pavementMat = getPavementMaterial();
  const yellowMat = getYellowMarkingMaterial();
  const whiteMat = getWhiteMarkingMaterial();
  const reflectorMat = getReflectorMaterial(glowMaterials);

  const pts = world.roadSamples;
  if (!pts || pts.length < 2) return;

  // Helper to build smooth extruded ribbon geometry along 3D path
  const strip = (offset, width, material, y, path = pts, skip = null) => {
    const positions = [],
      indices = [],
      uvs = [];
    let accumDist = 0;

    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)],
        b = path[Math.min(path.length - 1, i + 1)],
        dx = b.x - a.x,
        dz = b.z - a.z,
        segLen = Math.hypot(dx, dz) || 1;

      if (i > 0) {
        accumDist += Math.hypot(
          path[i].x - path[i - 1].x,
          path[i].z - path[i - 1].z,
        );
      }

      for (const side of [-1, 1]) {
        positions.push(
          path[i].x - (dz / segLen) * (offset + (side * width) / 2),
          y,
          path[i].z + (dx / segLen) * (offset + (side * width) / 2),
        );
        uvs.push(
          (side + 1) / 2,
          accumDist / (material.userData?.metersPerTile || 4.0),
        );
      }

      if (i < path.length - 1 && !skip?.(path[i])) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // 1. Concrete shoulder embankment
  strip(0, 31, pavementMat, 0.015);

  // 2. High-fidelity engineered asphalt carriageway
  strip(0, 25.5, asphaltMat, 0.05);

  // 3. Central median divider strip
  strip(0, 2.2, pavementMat, 0.095);

  // 4. White outer boundary shoulder lines
  for (const offset of [-11.8, 11.8]) {
    strip(
      offset,
      0.22,
      whiteMat,
      0.085,
      pts,
      offset > 0
        ? (p) =>
            world.shoulderOpenings?.some(
              ([start, end]) => p.s >= start && p.s <= end,
            )
        : null,
    );
  }

  // 5. White lane dividing dashed markings (±6.8m from center)
  for (let i = 0; i < pts.length - 1; i += 4) {
    const p = pts[i],
      q = pts[i + 1],
      h = Math.atan2(q.x - p.x, p.z - q.z);

    for (const side of [-1, 1]) {
      const off = side * 6.8;
      const dashGeo = new THREE.PlaneGeometry(0.18, 3.8);
      dashGeo.rotateX(-Math.PI / 2);
      const dashMesh = new THREE.Mesh(dashGeo, whiteMat);
      dashMesh.position.set(
        p.x + Math.cos(h) * off,
        0.088,
        p.z + Math.sin(h) * off,
      );
      dashMesh.rotation.y = -h;
      group.add(dashMesh);

      // Add cat's eye retroreflectors on lane divider lines
      if (i % 8 === 0) {
        addRoadStud(
          group,
          p.x + Math.cos(h) * off,
          0.085,
          p.z + Math.sin(h) * off,
          -h,
          reflectorMat,
        );
      }
    }
  }

  // 6. Central concrete barrier
  strip(0, 0.45, pavementMat, 0.55);

  // 7. Connector ramps & merging highways
  for (const road of world.connectorRoads || []) {
    const path = road.points;
    const inJunction = (p) =>
      world.nodes.some((n) => n.townJunction && dist(n, p) < 11);

    if (road.twoWay) strip(0, road.width + 3.8, pavementMat, 0.016, path);
    strip(0, road.width, asphaltMat, 0.052, path);

    for (const side of [-1, 1]) {
      strip(
        side * (road.width / 2 - 0.35),
        0.18,
        whiteMat,
        0.088,
        path,
        (p) =>
          inJunction(p) ||
          (["merge", "exit"].includes(road.kind) &&
            Math.floor(p.s / 4) % 2 === 1),
      );
    }
    if (road.twoWay) {
      strip(
        0,
        0.16,
        yellowMat,
        0.089,
        path,
        (p) => inJunction(p) || Math.floor(p.s / 4) % 2 === 1,
      );
    }
  }

  // 8. Destination stop line
  if (world.destinationStopLine) {
    const line = world.destinationStopLine;
    const stopGeo = new THREE.PlaneGeometry(5.2, 0.45);
    stopGeo.rotateX(-Math.PI / 2);
    const stopMesh = new THREE.Mesh(stopGeo, whiteMat);
    stopMesh.position.set(line.x, 0.092, line.z);
    group.add(stopMesh);
  }
}
