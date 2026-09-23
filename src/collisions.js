import { angle, clamp, dist, mix } from "./math.js";
import { footprintClearance } from "./traffic-safety.js";

export function collisionPose(object) {
  return {
    x: object.x,
    z: object.z,
    heading:
      object.type === "building"
        ? -(object.rotation || 0)
        : object.heading || 0,
    width: object.width,
    depth: object.depth,
    speed: object.speed || 0,
  };
}

function interpolate(a, b, t) {
  return {
    ...b,
    x: mix(a.x, b.x, t),
    z: mix(a.z, b.z, t),
    heading: a.heading + angle(b.heading - a.heading) * t,
  };
}

// Sweep both participants, including rotation, so thin or crossing objects
// cannot slip between rendered frames. Refine the first overlap to contact.
export function firstCollision(start, end, obstacles) {
  let first = null;
  const radius = (p) => Math.hypot(p.width, p.depth) / 2;
  for (const { object, previous } of obstacles) {
    const b = collisionPose(object),
      a = previous || b;
    const reach = radius(end) + radius(b);
    if (
      Math.min(start.x, end.x) - Math.max(a.x, b.x) > reach ||
      Math.min(a.x, b.x) - Math.max(start.x, end.x) > reach ||
      Math.min(start.z, end.z) - Math.max(a.z, b.z) > reach ||
      Math.min(a.z, b.z) - Math.max(start.z, end.z) > reach
    )
      continue;
    const travel =
      dist(start, end) +
      dist(a, b) +
      Math.abs(angle(end.heading - start.heading)) * radius(end) +
      Math.abs(angle(b.heading - a.heading)) * radius(b);
    const steps = Math.max(1, Math.ceil(travel / 0.12));
    const overlaps = (t) =>
      footprintClearance(interpolate(start, end, t), interpolate(a, b, t)) < 0;
    for (let i = 0; i <= steps; i++) {
      let high = i / steps;
      if (first && high - 1 / steps > first.fraction) break;
      if (!overlaps(high)) continue;
      let low = Math.max(0, (i - 1) / steps);
      for (let j = 0; j < 12 && high > low; j++) {
        const middle = (low + high) / 2;
        if (overlaps(middle)) high = middle;
        else low = middle;
      }
      if (!first || high < first.fraction) {
        const player = interpolate(start, end, low),
          target = interpolate(a, b, low);
        const sin = Math.sin(target.heading),
          cos = Math.cos(target.heading);
        const dx = player.x - target.x,
          dz = player.z - target.z;
        const right = clamp(
          dx * cos + dz * sin,
          -target.width / 2,
          target.width / 2,
        );
        const forward = clamp(
          dx * sin - dz * cos,
          -target.depth / 2,
          target.depth / 2,
        );
        const point = {
          x: target.x + cos * right + sin * forward,
          z: target.z + sin * right - cos * forward,
        };
        const length = dist(player, point) || 1;
        const normal = {
          x: (player.x - point.x) / length,
          z: (player.z - point.z) / length,
        };
        const relativeSpeed = Math.hypot(
          Math.sin(end.heading) * end.speed - Math.sin(b.heading) * b.speed,
          -Math.cos(end.heading) * end.speed + Math.cos(b.heading) * b.speed,
        );
        first = {
          object,
          fraction: high,
          player,
          target,
          point,
          normal,
          relativeSpeed,
        };
      }
      break;
    }
  }
  return first;
}
