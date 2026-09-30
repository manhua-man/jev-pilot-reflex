import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { physical, material } from "./materials.js";

export function detailedCar(color = "#d6d9df", motorcycle = false) {
  const group = new THREE.Group();
  const paint = physical(`paint:${color}`, {
    color,
    metalness: 0.55,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const glass = physical("vehicle-glass", {
    color: "#202d3b",
    metalness: 0.38,
    roughness: 0.08,
    clearcoat: 1,
  });
  const rubber = physical("rubber", { color: "#141518", roughness: 0.96 });
  const chrome = physical("wheel-alloy", {
    color: "#a4a9b2",
    metalness: 0.9,
    roughness: 0.25,
  });
  const trim = physical("dark-trim", {
    color: "#24262a",
    roughness: 0.4,
    metalness: 0.5,
  });
  const led = physical("headlight", {
    color: "#f8fcff",
    emissive: "#d9eeff",
    emissiveIntensity: 2,
    roughness: 0.2,
  });
  const tail = physical("taillight", {
    color: "#d71121",
    emissive: "#a9000b",
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });
  const mesh = (geometry, mat, x, y, z) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w, h, d, x, y, z, mat, radius = 0.025) =>
    mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat, x, y, z);
  const quad = (points, mat) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points.flat(), 3),
    );
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return mesh(geometry, mat, 0, 0, 0);
  };
  if (motorcycle) {
    box(0.48, 0.4, 1.15, 0, 0.65, 0, trim, 0.1);
    box(0.58, 0.4, 0.7, 0, 0.94, -0.22, paint, 0.15);
    box(0.5, 0.13, 0.68, 0, 1.06, 0.28, rubber);
    box(0.78, 0.05, 0.08, 0, 1.16, -0.6, chrome);
    box(0.3, 0.15, 0.1, 0, 1.04, -0.82, led);
    box(0.2, 0.12, 0.1, 0, 0.86, 0.85, tail);
    box(0.47, 0.56, 0.35, 0, 1.37, 0.15, material("#303942"), 0.12);
    mesh(new THREE.SphereGeometry(0.245, 16, 12), paint, 0, 1.83, 0);
    box(0.34, 0.12, 0.12, 0, 1.83, -0.2, glass);
    for (const side of [-1, 1]) {
      const leg = box(0.16, 0.7, 0.18, side * 0.25, 0.91, 0.2, rubber, 0.06);
      leg.rotation.x = 0.3;
      const arm = box(0.14, 0.55, 0.14, side * 0.28, 1.36, -0.12, trim, 0.05);
      arm.rotation.x = 0.85;
    }
  } else {
    box(1.9, 0.64, 4.16, 0, 0.73, 0, paint, 0.2);
    box(1.77, 0.17, 3.95, 0, 0.43, 0, trim, 0.06);
    box(1.65, 0.15, 1.25, 0, 1.03, -1.28, paint, 0.08);
    box(1.62, 0.14, 0.85, 0, 1.04, 1.51, paint, 0.07);
    const lowerY = 1.04,
      roofY = 1.61;
    quad(
      [
        [-0.78, lowerY, -0.92],
        [0.78, lowerY, -0.92],
        [0.66, roofY, -0.36],
        [-0.66, roofY, -0.36],
      ],
      glass,
    );
    quad(
      [
        [0.77, lowerY, 1.16],
        [-0.77, lowerY, 1.16],
        [-0.66, roofY, 0.68],
        [0.66, roofY, 0.68],
      ],
      glass,
    );
    for (const side of [-1, 1]) {
      const points = [
        [side * 0.78, lowerY, -0.87],
        [side * 0.78, lowerY, 1.11],
        [side * 0.66, roofY, 0.68],
        [side * 0.66, roofY, -0.36],
      ];
      if (side < 0) points.reverse();
      quad(points, glass);
      box(0.075, 0.55, 0.075, side * 0.72, 1.32, 0.28, trim);
      box(0.045, 0.05, 2.08, side * 0.81, 1.04, 0.12, chrome);
      for (const z of [-0.2, 0.88])
        box(0.05, 0.035, 0.22, side * 0.95, 0.92, z, chrome);
      box(0.24, 0.13, 0.34, side * 1.0, 1.08, -0.66, paint, 0.055);
      box(0.15, 0.08, 0.02, side * 1.0, 1.08, -0.47, chrome);
      box(0.017, 0.46, 0.017, side * 0.95, 0.77, 0.29, trim, 0.002);
      box(0.59, 0.065, 0.055, side * 0.58, 0.91, -2.06, led);
      box(0.6, 0.075, 0.055, side * 0.58, 0.91, 2.06, tail);
    }
    box(1.38, 0.095, 1.16, 0, 1.64, 0.15, paint, 0.045);
    box(1.28, 0.02, 0.83, 0, 1.696, 0.1, glass);
    box(1.14, 0.18, 0.05, 0, 0.56, -2.074, trim);
    for (let i = -4; i <= 4; i++)
      box(0.016, 0.12, 0.06, i * 0.115, 0.56, -2.08, chrome, 0.003);
    box(0.47, 0.13, 0.035, 0, 0.62, 2.09, material("#e0e2e4"));
    box(0.5, 0.04, 0.025, 0, 0.98, 2.094, tail);
  }
  for (const z of motorcycle ? [-0.77, 0.77] : [-1.29, 1.28])
    for (const side of motorcycle ? [0] : [-1, 1]) {
      const x = side * 0.87;
      const tire = mesh(
        new THREE.TorusGeometry(
          motorcycle ? 0.28 : 0.285,
          motorcycle ? 0.085 : 0.1,
          10,
          24,
        ),
        rubber,
        x,
        0.39,
        z,
      );
      tire.rotation.y = Math.PI / 2;
      const hub = mesh(
        new THREE.CylinderGeometry(0.23, 0.23, motorcycle ? 0.13 : 0.22, 24),
        trim,
        x,
        0.39,
        z,
      );
      hub.rotation.z = Math.PI / 2;
      for (let spoke = 0; spoke < 6; spoke++) {
        const spokeMesh = box(
          motorcycle ? 0.15 : 0.24,
          0.035,
          0.43,
          x,
          0.39,
          z,
          chrome,
          0.012,
        );
        spokeMesh.rotation.x = (spoke * Math.PI) / 6;
      }
    }
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const geometries = batches.get(o.material) || [];
    const geometry = o.geometry.index
      ? o.geometry.toNonIndexed()
      : o.geometry.clone();
    geometries.push(geometry.applyMatrix4(o.matrixWorld));
    batches.set(o.material, geometries);
    o.geometry.dispose();
  });
  group.clear();
  for (const [mat, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    geometries.forEach((g) => g.dispose());
  }
  return group;
}

export function detailedHeavyTruck(cabinColor = "#1e3a8a", containerColor = "#94a3b8") {
  const group = new THREE.Group();
  const paintCab = physical(`paint-cab:${cabinColor}`, {
    color: cabinColor,
    metalness: 0.6,
    roughness: 0.28,
    clearcoat: 0.9,
  });
  const paintContainer = physical(`paint-container:${containerColor}`, {
    color: containerColor,
    metalness: 0.35,
    roughness: 0.45,
  });
  const glass = physical("truck-glass", {
    color: "#1e293b",
    metalness: 0.4,
    roughness: 0.08,
    clearcoat: 1,
  });
  const rubber = physical("truck-rubber", { color: "#141518", roughness: 0.96 });
  const chrome = physical("truck-chrome", { color: "#cbd5e1", metalness: 0.92, roughness: 0.2 });
  const chassis = physical("truck-chassis", { color: "#1e242b", roughness: 0.6, metalness: 0.4 });
  const led = physical("truck-headlight", { color: "#f8fcff", emissive: "#d9eeff", emissiveIntensity: 2.2, roughness: 0.2 });
  const tail = physical("truck-taillight", { color: "#ef4444", emissive: "#b91c1c", emissiveIntensity: 1.5, roughness: 0.2 });
  const hazard = physical("truck-hazard", { color: "#f59e0b", emissive: "#d97706", emissiveIntensity: 0.8, roughness: 0.3 });

  const mesh = (geometry, mat, x, y, z) => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w, h, d, x, y, z, mat, radius = 0.03) =>
    mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat, x, y, z);

  // 1. TRACTOR CABIN (牵引车头)
  box(2.4, 0.45, 3.4, 0, 0.72, -4.8, chassis, 0.05);
  box(2.4, 1.9, 2.2, 0, 1.9, -4.3, paintCab, 0.08);
  box(2.2, 1.25, 1.4, 0, 1.45, -5.9, paintCab, 0.06);
  box(1.7, 1.05, 0.12, 0, 1.42, -6.65, chrome, 0.02);
  box(2.45, 0.35, 0.25, 0, 0.65, -6.6, chassis, 0.04);
  for (const s of [-0.95, 0.95]) {
    box(0.28, 0.15, 0.1, s, 0.68, -6.7, led, 0.02);
  }
  box(2.1, 0.75, 0.08, 0, 2.25, -5.35, glass, 0.02);
  for (const s of [-1.22, 1.22]) {
    box(0.06, 0.65, 0.95, s, 2.2, -4.4, glass, 0.02);
  }
  box(2.3, 0.65, 1.8, 0, 3.15, -4.2, paintCab, 0.1);
  for (const s of [-1.15, 1.15]) {
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 12), chrome, s, 2.6, -3.1);
  }

  // 2. 40FT SHIPPING CONTAINER TRAILER (集装箱货柜半挂车)
  box(2.35, 0.35, 9.8, 0, 0.88, 1.6, chassis, 0.04);
  box(2.45, 2.65, 9.5, 0, 2.38, 1.6, paintContainer, 0.08);
  for (let zRib = -2.8; zRib <= 6.0; zRib += 1.1) {
    for (const s of [-1.24, 1.24]) {
      box(0.04, 2.5, 0.08, s, 2.38, zRib, paintContainer, 0.01);
    }
  }
  box(2.35, 2.5, 0.08, 0, 2.38, 6.38, chassis, 0.02);
  for (const s of [-0.45, 0.45]) {
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 8), chrome, s, 2.38, 6.44);
  }
  box(2.4, 0.22, 0.15, 0, 0.58, 6.35, hazard, 0.02);
  for (const s of [-0.95, 0.95]) {
    box(0.24, 0.12, 0.08, s, 0.6, 6.44, tail, 0.02);
  }

  // 3. HEAVY WHEELS (10 重型货车轮胎)
  const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.32, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.34, 16);
  hubGeo.rotateZ(Math.PI / 2);

  for (const s of [-1.15, 1.15]) {
    mesh(wheelGeo, rubber, s, 0.52, -5.6);
    mesh(hubGeo, chrome, s, 0.52, -5.6);
  }
  for (const zAxle of [-3.7, -2.4]) {
    for (const s of [-1.12, 1.12]) {
      mesh(wheelGeo, rubber, s, 0.52, zAxle);
      mesh(hubGeo, chrome, s, 0.52, zAxle);
    }
  }
  for (const zAxle of [4.4, 5.7]) {
    for (const s of [-1.12, 1.12]) {
      mesh(wheelGeo, rubber, s, 0.52, zAxle);
      mesh(hubGeo, chrome, s, 0.52, zAxle);
    }
  }

  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const geometries = batches.get(o.material) || [];
    const geometry = o.geometry.index
      ? o.geometry.toNonIndexed()
      : o.geometry.clone();
    geometries.push(geometry.applyMatrix4(o.matrixWorld));
    batches.set(o.material, geometries);
    o.geometry.dispose();
  });
  group.clear();
  for (const [mat, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    geometries.forEach((g) => g.dispose());
  }
  return group;
}

export function detailedAlpineSUV(color = "#2563eb") {
  const group = new THREE.Group();
  const paint = physical(`paint-suv:${color}`, { color, metalness: 0.5, roughness: 0.3 });
  const trim = physical("suv-trim", { color: "#1f2429", roughness: 0.7, metalness: 0.2 });
  const glass = physical("suv-glass", { color: "#1e293b", metalness: 0.4, roughness: 0.08, clearcoat: 1 });
  const chrome = physical("suv-chrome", { color: "#cbd5e1", metalness: 0.9, roughness: 0.2 });
  const rubber = physical("suv-rubber", { color: "#141518", roughness: 0.95 });
  const led = physical("suv-headlight", { color: "#f8fcff", emissive: "#d9eeff", emissiveIntensity: 2.2 });
  const tail = physical("suv-taillight", { color: "#ef4444", emissive: "#b91c1c", emissiveIntensity: 1.5 });

  const box = (w, h, d, x, y, z, mat, radius = 0.03) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  box(2.0, 0.72, 4.4, 0, 0.82, 0, paint, 0.15);
  box(1.9, 0.25, 4.25, 0, 0.45, 0, trim, 0.08);
  box(1.85, 0.78, 2.5, 0, 1.48, 0.2, paint, 0.12);
  box(1.78, 0.62, 0.08, 0, 1.45, -0.98, glass);
  box(1.72, 0.55, 0.08, 0, 1.45, 1.45, glass);
  for (const s of [-0.94, 0.94]) {
    box(0.06, 0.52, 2.2, s, 1.46, 0.25, glass);
    box(0.18, 0.22, 0.8, s, 0.62, -1.2, trim, 0.05);
    box(0.18, 0.22, 0.8, s, 0.62, 1.2, trim, 0.05);
    box(0.35, 0.12, 0.08, s * 0.65, 0.88, -2.22, led);
    box(0.35, 0.12, 0.08, s * 0.65, 0.88, 2.22, tail);
  }
  box(1.3, 0.08, 2.2, 0, 1.92, 0.2, trim, 0.02);
  for (const s of [-0.4, 0, 0.4]) {
    box(0.2, 0.1, 0.06, s, 2.02, -0.75, led);
  }
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), rubber);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, 0.95, 2.32);
  spare.castShadow = true;
  group.add(spare);

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.24, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.25, 1.25]) {
    for (const s of [-0.98, 0.98]) {
      const wMesh = new THREE.Mesh(wheelGeo, rubber);
      wMesh.position.set(s, 0.38, z);
      wMesh.castShadow = true;
      group.add(wMesh);
    }
  }
  return group;
}

export function detailedAlpineLoggingTruck(cabinColor = "#b91c1c") {
  const group = new THREE.Group();
  const paintCab = physical(`paint-cab:${cabinColor}`, { color: cabinColor, metalness: 0.6, roughness: 0.3 });
  const chassis = physical("truck-chassis", { color: "#1e242b", roughness: 0.6, metalness: 0.4 });
  const woodLog = physical("pine-log", { color: "#785338", roughness: 0.85 });
  const rubber = physical("truck-rubber", { color: "#141518", roughness: 0.96 });
  const chrome = physical("truck-chrome", { color: "#cbd5e1", metalness: 0.9, roughness: 0.2 });
  const glass = physical("truck-glass", { color: "#1e293b", metalness: 0.4, roughness: 0.08 });
  const led = physical("truck-headlight", { color: "#f8fcff", emissive: "#d9eeff", emissiveIntensity: 2.2 });
  const tail = physical("truck-taillight", { color: "#ef4444", emissive: "#b91c1c", emissiveIntensity: 1.5 });

  const box = (w, h, d, x, y, z, mat, radius = 0.03) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  box(2.4, 1.8, 2.2, 0, 1.6, -2.8, paintCab, 0.08);
  box(2.1, 0.7, 0.08, 0, 1.85, -3.85, glass);
  box(2.4, 0.4, 8.5, 0, 0.65, 0.6, chassis, 0.04);
  box(2.45, 0.3, 0.2, 0, 0.55, -3.9, chrome);
  for (const s of [-0.95, 0.95]) {
    box(0.28, 0.15, 0.08, s, 0.58, -3.95, led);
    box(0.24, 0.15, 0.08, s, 0.58, 4.88, tail);
  }

  for (const z of [-1.2, 0.8, 2.8, 4.4]) {
    for (const s of [-1.15, 1.15]) {
      box(0.12, 1.7, 0.12, s, 1.6, z, chrome, 0.02);
    }
  }

  const logPositions = [
    [-0.6, 1.15], [0.6, 1.15],
    [-0.3, 1.75], [0.3, 1.75],
    [0.0, 2.35]
  ];
  const logGeo = new THREE.CylinderGeometry(0.36, 0.36, 6.2, 12);
  logGeo.rotateX(Math.PI / 2);
  for (const [lx, ly] of logPositions) {
    const log = new THREE.Mesh(logGeo, woodLog);
    log.position.set(lx, ly, 1.6);
    log.castShadow = true;
    group.add(log);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-3.2, 2.6, 4.0]) {
    for (const s of [-1.12, 1.12]) {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.position.set(s, 0.48, z);
      w.castShadow = true;
      group.add(w);
    }
  }
  return group;
}

export function detailedAlpineBus(color = "#eab308") {
  const group = new THREE.Group();
  const paintYellow = physical(`paint-bus:${color}`, { color, metalness: 0.4, roughness: 0.35 });
  const paintWhite = physical("paint-white", { color: "#f8fafc", metalness: 0.3, roughness: 0.3 });
  const glass = physical("bus-glass", { color: "#1e293b", metalness: 0.3, roughness: 0.08, clearcoat: 1 });
  const rubber = physical("bus-rubber", { color: "#141518", roughness: 0.96 });
  const led = physical("bus-headlight", { color: "#f8fcff", emissive: "#d9eeff", emissiveIntensity: 2.2 });
  const tail = physical("bus-taillight", { color: "#ef4444", emissive: "#b91c1c", emissiveIntensity: 1.5 });

  const box = (w, h, d, x, y, z, mat, radius = 0.04) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  box(2.2, 0.9, 6.8, 0, 0.85, 0, paintYellow, 0.12);
  box(2.18, 0.85, 6.7, 0, 1.75, 0, glass, 0.08);
  box(2.2, 0.28, 6.8, 0, 2.28, 0, paintWhite, 0.12);
  box(2.1, 0.45, 0.08, 0, 1.82, -3.38, glass);
  box(2.1, 0.45, 0.08, 0, 1.82, 3.38, glass);

  for (const s of [-0.85, 0.85]) {
    box(0.28, 0.16, 0.08, s, 0.72, -3.42, led);
    box(0.24, 0.16, 0.08, s, 0.72, 3.42, tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.26, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-2.2, 2.2]) {
    for (const s of [-1.02, 1.02]) {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.position.set(s, 0.44, z);
      w.castShadow = true;
      group.add(w);
    }
  }
  return group;
}
