import {
  clamp,
  dist,
  heading,
  move,
  nearestOnPath,
  pointAt,
  round,
} from "./math.js";
import { routeSection } from "./planning.js";

const cache = new WeakMap();
const cross = (a, b, p) =>
  (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
const area = (p) =>
  Math.abs(
    p.reduce((a, v, i) => {
      const w = p[(i + 1) % p.length];
      return a + v.x * w.z - w.x * v.z;
    }, 0),
  ) / 2;

function polygon(points) {
  const signed = points.reduce((a, p, i) => {
    const q = points[(i + 1) % points.length];
    return a + p.x * q.z - q.x * p.z;
  }, 0);
  if (signed < 0) points.reverse();
  return {
    points,
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}

export function footprint(car, padding = 0) {
  return polygon(
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([right, ahead]) =>
      move(
        move(car, car.heading, ahead * (car.depth / 2 + padding)),
        car.heading + Math.PI / 2,
        right * (car.width / 2 + padding),
      ),
    ),
  ).points;
}

export function roadGeometry(world) {
  if (cache.has(world)) return cache.get(world);
  const surfaces = [];
  if (world.type === "highway") {
    // Match the rendered ribbon, including the non-drivable 2.1 m median.
    const samples = world.roadSamples;
    const offset = (i, d) =>
      move(
        samples[i],
        heading(
          samples[Math.max(0, i - 1)],
          samples[Math.min(samples.length - 1, i + 1)],
        ) +
          Math.PI / 2,
        d,
      );
    for (let i = 0; i < samples.length - 1; i++) {
      for (const [left, right] of [
        [-12.5, -1.05],
        [1.05, 12.5],
      ]) {
        surfaces.push(
          polygon([
            offset(i, left),
            offset(i, right),
            offset(i + 1, right),
            offset(i + 1, left),
          ]),
        );
      }
    }
  } else {
    for (const edge of world.edges) {
      const a = world.byId[edge.a],
        b = world.byId[edge.b],
        h = heading(a, b);
      surfaces.push(
        polygon([
          move(a, h - Math.PI / 2, edge.width / 2),
          move(a, h + Math.PI / 2, edge.width / 2),
          move(b, h + Math.PI / 2, edge.width / 2),
          move(b, h - Math.PI / 2, edge.width / 2),
        ]),
      );
    }
    for (const n of world.nodes)
      surfaces.push(
        polygon([
          { x: n.x - 6.05, z: n.z - 6.05 },
          { x: n.x + 6.05, z: n.z - 6.05 },
          { x: n.x + 6.05, z: n.z + 6.05 },
          { x: n.x - 6.05, z: n.z + 6.05 },
        ]),
      );
  }
  for (const road of world.connectorRoads || []) {
    const offset = (i, side) =>
      move(
        road.points[i],
        heading(
          road.points[Math.max(0, i - 1)],
          road.points[Math.min(road.points.length - 1, i + 1)],
        ) +
          Math.PI / 2,
        (side * road.width) / 2,
      );
    for (let i = 0; i < road.points.length - 1; i++)
      surfaces.push(
        polygon([
          offset(i, -1),
          offset(i, 1),
          offset(i + 1, 1),
          offset(i + 1, -1),
        ]),
      );
  }
  cache.set(world, surfaces);
  return surfaces;
}

function boxDistance(p, box) {
  return Math.hypot(
    Math.max(box.minX - p.x, 0, p.x - box.maxX),
    Math.max(box.minZ - p.z, 0, p.z - box.maxZ),
  );
}

export function localRoads(world, car, radius = 100) {
  const all = roadGeometry(world);
  const nearby = all.filter((p) => boxDistance(car, p) <= radius);
  return nearby.length
    ? nearby
    : [
        all.reduce((a, b) =>
          boxDistance(car, a) < boxDistance(car, b) ? a : b,
        ),
      ];
}

function halfPlane(points, a, b, inside) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length];
    const dp = cross(a, b, p),
      dq = cross(a, b, q);
    const pin = inside ? dp >= -1e-9 : dp <= 1e-9;
    const qin = inside ? dq >= -1e-9 : dq <= 1e-9;
    if (pin) result.push(p);
    if (pin !== qin) {
      const t = dp / (dp - dq);
      result.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return result;
}

function subtract(subject, clip) {
  const outside = [];
  let inside = subject;
  for (let i = 0; i < clip.length && inside.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length];
    const piece = halfPlane(inside, a, b, false);
    if (piece.length >= 3 && area(piece) > 1e-7) outside.push(piece);
    inside = halfPlane(inside, a, b, true);
  }
  return outside;
}

export function distanceToRoad(point, surfaces) {
  let best = Infinity;
  for (const { points } of surfaces) {
    if (
      points.every(
        (p, i) => cross(p, points[(i + 1) % points.length], point) >= -1e-8,
      )
    )
      return 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const t = clamp(
        ((point.x - a.x) * dx + (point.z - a.z) * dz) /
          (dx * dx + dz * dz || 1),
        0,
        1,
      );
      best = Math.min(best, dist(point, { x: a.x + dx * t, z: a.z + dz * t }));
    }
  }
  return best;
}

export function roadOccupancy(car, surfaces) {
  const body = polygon(footprint(car));
  let remaining = [body.points];
  for (const surface of surfaces) {
    if (
      surface.maxX < body.minX ||
      surface.minX > body.maxX ||
      surface.maxZ < body.minZ ||
      surface.minZ > body.maxZ
    )
      continue;
    remaining = remaining.flatMap((p) => subtract(p, surface.points));
    if (!remaining.length) break;
  }
  const fraction = Math.min(
    1,
    remaining.reduce((sum, p) => sum + area(p), 0) / (car.width * car.depth),
  );
  return { on_road: fraction < 1e-5, outside_fraction: fraction };
}

export function relativePoint(car, point, precision = 1) {
  const dx = point.x - car.x,
    dz = point.z - car.z;
  return {
    right_m: round(
      dx * Math.cos(car.heading) + dz * Math.sin(car.heading),
      precision,
    ),
    ahead_m: round(
      dx * Math.sin(car.heading) - dz * Math.cos(car.heading),
      precision,
    ),
  };
}

// Intersect a line across the road with the actual asphalt polygons, then
// union touching intervals. Internal mesh edges are not road boundaries;
// separated carriageways stay separated by the non-drivable median.
function roadCrossSection(center, h, surfaces) {
  const direction = { x: Math.cos(h), z: Math.sin(h) };
  const intervals = [];
  for (const { points } of surfaces) {
    let left = -Infinity,
      right = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const origin = cross(a, b, center);
      const slope = (b.x - a.x) * direction.z - (b.z - a.z) * direction.x;
      if (Math.abs(slope) < 1e-10) {
        if (origin < -1e-8) {
          left = Infinity;
          break;
        }
      } else if (slope > 0) left = Math.max(left, -origin / slope);
      else right = Math.min(right, -origin / slope);
      if (left > right) break;
    }
    if (Number.isFinite(left) && Number.isFinite(right) && left <= right)
      intervals.push({ left, right });
  }
  intervals.sort((a, b) => a.left - b.left);
  const joined = [];
  for (const interval of intervals) {
    const last = joined.at(-1);
    if (last && interval.left <= last.right + 1e-6)
      last.right = Math.max(last.right, interval.right);
    else joined.push({ ...interval });
  }
  // Prefer the connected surface beneath the center; off-road, show the
  // nearest surface so signed clearances indicate which way to return.
  const distance = (interval) => Math.max(interval.left, -interval.right, 0);
  return joined.reduce(
    (best, interval) =>
      !best || distance(interval) < distance(best) ? interval : best,
    null,
  );
}

export function roadState(car, surfaces, lookaheadM = 40) {
  const relative = (p) => {
    const { right_m, ahead_m } = relativePoint(car, p, 2);
    return [right_m, ahead_m];
  };
  const near = nearestOnPath(car, car.route.points);
  const preview = Math.max(40, lookaheadM);
  const stations = new Set(
    [
      -car.depth,
      0,
      ...Array.from({ length: 12 }, (_, i) => ((i + 1) * preview) / 12),
    ].map((ahead) => clamp(near.s + ahead, 0, car.route.length)),
  );
  const boundaries = [...stations].map((s) => {
    const center = pointAt(car.route.points, s);
    const h = center.heading ?? nearestOnPath(center, car.route.points).heading;
    const section = roadCrossSection(center, h, surfaces);
    const halfWidth = routeSection(car, s)?.laneHalfWidth ?? 3;
    const at = (offset) => relative(move(center, h + Math.PI / 2, offset));
    return {
      route_ahead_m: round(s - near.s, 1),
      center: relative(center),
      road_left: section ? at(section.left) : null,
      road_right: section ? at(section.right) : null,
      lane_left: at(-halfWidth),
      lane_right: at(halfWidth),
      center_on_road: !!section && section.left <= 0 && section.right >= 0,
    };
  });
  const clearances = [-car.depth / 2, 0, car.depth / 2].map((ahead) => {
    const center = move(car, car.heading, ahead);
    const section = roadCrossSection(center, car.heading, surfaces);
    return {
      ahead_m: round(ahead, 2),
      road_left_m: section ? round(section.left, 2) : null,
      road_right_m: section ? round(section.right, 2) : null,
      left_clearance_m: section
        ? round(-car.width / 2 - section.left, 2)
        : null,
      right_clearance_m: section
        ? round(section.right - car.width / 2, 2)
        : null,
    };
  });
  // Clip to a local square so long streets don't bloat the JSON.
  const radius = Math.max(
    preview + near.distance + car.depth,
    Math.min(
      160,
      Math.max(
        Math.abs(car.speed) * 3 + 10,
        distanceToRoad(car, surfaces) + 15,
      ),
    ),
  );
  const window = polygon([
    { x: car.x - radius, z: car.z - radius },
    { x: car.x + radius, z: car.z - radius },
    { x: car.x + radius, z: car.z + radius },
    { x: car.x - radius, z: car.z + radius },
  ]).points;
  const polygons = surfaces.flatMap((surface) => {
    let clipped = surface.points;
    for (let i = 0; i < window.length && clipped.length; i++)
      clipped = halfPlane(
        clipped,
        window[i],
        window[(i + 1) % window.length],
        true,
      );
    return clipped.length >= 3 && area(clipped) > 0.01
      ? [
          clipped.map((p) => {
            const { right_m, ahead_m } = relativePoint(car, p);
            return [right_m, ahead_m];
          }),
        ]
      : [];
  });
  return {
    ...roadOccupancy(car, surfaces),
    distance_to_road_m: round(distanceToRoad(car, surfaces), 1),
    coordinates:
      "Points are [right, ahead] meters from the car center. Negative right is left; negative ahead is behind. Left/right edges follow the route direction.",
    boundary_source:
      "Actual asphalt geometry; excludes grass, sidewalks and median",
    polygon_clip_radius_m: round(radius, 1),
    preview_distance_m: round(
      Math.max(0, Math.min(preview, car.route.length - near.s)),
      1,
    ),
    ego_footprint: footprint(car).map(relative),
    edge_clearance_samples: clearances,
    boundary_samples: boundaries,
    drivable_polygons: polygons,
  };
}
