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
