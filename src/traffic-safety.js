import { angle, clamp, dist, heading, move, pointAt, round } from "./math.js";
import {
  BRAKING,
  FULL_STOP_DISTANCE_M,
  physics,
  maneuverSteering,
  maneuverVelocity,
} from "./planning.js";

export function relativeTrafficState(vehicle, other) {
  const dx = other.x - vehicle.x,
    dz = other.z - vehicle.z;
  const ahead = dx * Math.sin(vehicle.heading) - dz * Math.cos(vehicle.heading);
  const right = dx * Math.cos(vehicle.heading) + dz * Math.sin(vehicle.heading);
  const relativeHeading = angle((other.heading || 0) - vehicle.heading);
  return {
    ahead_m: round(ahead, 1),
    right_m: round(right, 1),
    relative_position:
      ahead < -1 ? "behind" : ahead > 1 ? "ahead" : "alongside",
    heading_relative_deg: round((relativeHeading * 180) / Math.PI, 1),
    relative_velocity_ahead_mps: round(
      (other.speed || 0) * Math.cos(relativeHeading) - vehicle.speed,
      1,
    ),
  };
}

function rearFollower(vehicle, other) {
  if (!["car", "motorcycle"].includes(other.type)) return false;
  const relative = relativeTrafficState(vehicle, other);
  return (
    relative.ahead_m < -vehicle.depth / 2 &&
    Math.abs(relative.heading_relative_deg) < 45 &&
    Math.abs(relative.right_m) < (vehicle.width + other.width) / 2 + 0.5
  );
}

export function rearTrafficPressure(vehicle, traffic) {
  const followers = traffic
    .filter((other) => rearFollower(vehicle, other))
    .map((other) => {
      const relative = relativeTrafficState(vehicle, other);
      const delta = angle((other.heading || 0) - vehicle.heading);
      const halfLength =
        (Math.abs(Math.cos(delta)) * other.depth +
          Math.abs(Math.sin(delta)) * other.width) /
        2;
      const gap = Math.max(
        0,
        -relative.ahead_m - vehicle.depth / 2 - halfLength,
      );
      const closing = Math.max(0, relative.relative_velocity_ahead_mps);
      return { other, gap, closing };
    })
    .filter(({ gap }) => gap < 45)
    .sort((a, b) => a.gap - b.gap);
  const nearest = followers[0];
  if (!nearest) return null;
  const { other, gap, closing } = nearest;
  const timeToClose = closing > 0.1 ? gap / closing : null;
  return {
    vehicle_id: other.id,
    gap_m: round(gap, 1),
    closing_speed_mps: round(closing, 1),
    time_to_close_gap_s: timeToClose === null ? null : round(timeToClose, 1),
    urgency:
      gap < 8 || (timeToClose !== null && timeToClose < 4)
        ? "high"
        : "moderate",
    preferred_action: "increase_forward_gap",
  };
}

function axes(vehicle) {
  const sin = Math.sin(vehicle.heading || 0),
    cos = Math.cos(vehicle.heading || 0);
  return [
    { x: sin, z: -cos, radius: (vehicle.depth || 4.2) / 2 },
    { x: cos, z: sin, radius: (vehicle.width || 1.9) / 2 },
  ];
}

// Signed separation of oriented vehicle footprints; negative means overlap.
export function footprintClearance(a, b) {
  const aa = axes(a),
    bb = axes(b),
    dx = b.x - a.x,
    dz = b.z - a.z;
  let separation = -Infinity;
  for (const axis of [...aa, ...bb]) {
    const radius = [...aa, ...bb].reduce(
      (sum, edge) =>
        sum + Math.abs(axis.x * edge.x + axis.z * edge.z) * edge.radius,
      0,
    );
    separation = Math.max(
      separation,
      Math.abs(dx * axis.x + dz * axis.z) - radius,
    );
  }
  return separation;
}

// Check the next 2.5 m of our actual path, not a radius around the car. A car
// behind us or a pedestrian beside the lane must not unlock the stop choice.
export function nearbyPathBlocker(vehicle, obstacles) {
  const nearby = obstacles
    .filter((o) => o.id !== vehicle.id)
    .map((o) => ({
      ...o,
      heading: o.type === "building" ? -(o.rotation || 0) : o.heading || 0,
    }))
    .filter((o) => footprintClearance(vehicle, o) <= FULL_STOP_DISTANCE_M);
  if (!nearby.length) return null;
  const direction = vehicle.target < 0 ? -1 : 1;
  const ghost = { ...vehicle, speed: direction };
  const maneuver = vehicle.maneuver || {
    lane_offset_m: 0,
    lookahead_m: 4.5,
  };
  for (let step = 0; step <= FULL_STOP_DISTANCE_M * 10; step++) {
    const blocker = nearby.find((o) => footprintClearance(ghost, o) <= 0.01);
    if (blocker)
      return { id: blocker.id, type: blocker.type, gap_m: round(step / 10, 1) };
    physics(ghost, maneuverSteering(ghost, maneuver), direction, 0.1);
  }
  return null;
}

export function followingGap(vehicle, other) {
  const speed = Math.abs(vehicle.speed);
  return other?.type === "motorcycle"
    ? Math.min(3, 0.9 + speed * 0.15)
    : Math.min(2.5, 0.5 + speed * 0.12);
}

export function leadVehicle(vehicle, traffic) {
  let lead = null;
  for (const other of traffic) {
    if (other.id === vehicle.id) continue;
    const dx = other.x - vehicle.x,
      dz = other.z - vehicle.z;
    const forward =
      dx * Math.sin(vehicle.heading) - dz * Math.cos(vehicle.heading);
    const right =
      dx * Math.cos(vehicle.heading) + dz * Math.sin(vehicle.heading);
    const relative = (other.heading || 0) - vehicle.heading;
    // Oncoming and crossing vehicles are handled by the swept-path check.
    // They are not a queue to follow just because they enter the forward strip.
    if (Math.cos(relative) < 0.5) continue;
    const length =
      (Math.abs(Math.cos(relative)) * (other.depth || 4.2)) / 2 +
      (Math.abs(Math.sin(relative)) * (other.width || 1.9)) / 2;
    const width =
      (Math.abs(Math.cos(relative)) * (other.width || 1.9)) / 2 +
      (Math.abs(Math.sin(relative)) * (other.depth || 4.2)) / 2;
    const gap = forward - (vehicle.depth || 4.2) / 2 - length;
    const buffer =
      other.type === "motorcycle"
        ? 0.55
        : Math.min(0.45, 0.18 + Math.abs(vehicle.speed) * 0.025);
    if (
      forward > 0 &&
      Math.abs(right) < (vehicle.width || 1.9) / 2 + width + buffer &&
      (!lead || gap < lead.gap)
    )
      lead = { other, gap };
  }
  return lead;
}

export function brakingSpeed(distance) {
  const deceleration = 5,
    reaction = 0.35;
  return Math.max(
    0,
    Math.sqrt(
      (deceleration * reaction) ** 2 + 2 * deceleration * Math.max(0, distance),
    ) -
      deceleration * reaction,
  );
}

// Re-evaluate as the gap closes, both in rollouts and on the real car. A moving
// lead contributes its stopping distance; a stopped lead permits a gentle creep.
export function followingSpeed(vehicle, lead) {
  if (!lead) return Infinity;
  const speed = Math.max(
    0,
    (lead.other.speed || 0) *
      Math.cos((lead.other.heading || 0) - vehicle.heading),
  );
  const room = lead.gap - followingGap(vehicle, lead.other);
  return Math.min(
    brakingSpeed(room + (speed * speed) / 10),
    Math.max(0, speed + room * 1.5),
  );
}

export function otherPose(other, time) {
  if (other.type === "pedestrian") {
    if (other.crossing) {
      const remaining = Math.max(0, 16 - (other.progress || 0));
      const travel = Math.min(remaining, (other.speed || 0) * time);
      return {
        ...other,
        ...move(other, other.heading || 0, travel),
        speed: travel >= remaining ? 0 : other.speed,
      };
    }
    if (other.walkPath?.length) {
      const { start, heading: pathHeading, length } = other.walkPath;
      const progress = other.progress + other.direction * other.speed * time;
      const wrapped = ((progress % (2 * length)) + 2 * length) % (2 * length);
      const forward = wrapped < length;
      return {
        ...other,
        ...move(start, pathHeading, forward ? wrapped : 2 * length - wrapped),
        heading: angle(
          pathHeading +
            ((forward ? other.direction : -other.direction) < 0 ? Math.PI : 0),
        ),
      };
    }
  }
  if (other.route?.points?.length && Number.isFinite(other.s)) {
    const travel = Math.max(0, other.speed) * time;
    const s = other.s + travel;
    // Traffic continues beyond the route while leaving the view. Predict from
    // its real position there; clamping to the endpoint invents a teleport.
    if (other.s >= other.route.length - 1)
      return { ...other, ...move(other, other.heading, travel), s };
    const p = pointAt(other.route.points, s);
    const before = pointAt(
      other.route.points,
      Math.max(0, Math.min(s, other.route.length) - 0.2),
    );
    const h = heading(before, p);
    return {
      ...other,
      ...move(p, h, Math.max(0, s - other.route.length)),
      heading: h,
      s,
    };
  }
  return {
    ...other,
    x: other.x + Math.sin(other.heading || 0) * (other.speed || 0) * time,
    z: other.z - Math.cos(other.heading || 0) * (other.speed || 0) * time,
  };
}

// Rear traffic follows the simulated car using the same gap control and braking
// rate as NPCs. Constant-speed extrapolation otherwise invents rear-end crashes
// whenever our car waits, making every slow candidate look unsafe.
export function createObstaclePrediction(vehicle, obstacles) {
  const followers = new Set(
    obstacles.filter((o) => rearFollower(vehicle, o)).map((o) => o.id),
  );
  let previous = new Map(obstacles.map((o) => [o.id, o])),
    lastTime = 0,
    previousEgo = vehicle;
  return (time, ego) => {
    const dt = Math.max(0, time - lastTime);
    const traffic = [
      previousEgo,
      ...[...previous.values()].filter((o) =>
        ["car", "motorcycle"].includes(o.type),
      ),
    ];
    const samples = obstacles.map((original) => {
      if (original.type === "building") return { object: original };
      const prior = previous.get(original.id);
      let pose;
      if (followers.has(original.id)) {
        const target = Math.min(
          Math.max(original.speed || 0, ego.speed),
          followingSpeed(prior, leadVehicle(prior, traffic)),
        );
        const speed = Math.max(
          0,
          prior.speed + clamp(target - prior.speed, -7 * dt, 2.8 * dt),
        );
        pose = otherPose({ ...prior, speed }, dt);
      } else pose = otherPose(original, time);
      return { object: pose, previous: prior };
    });
    previous = new Map(samples.map(({ object }) => [object.id, object]));
    lastTime = time;
    previousEgo = { ...ego };
    return samples;
  };
}

// Predict crossing/merging conflicts, including motorcycles outside the forward lane strip.
// The safeguard only limits speed; Jev remains responsible for steering.
export function predictTrafficConflict(vehicle, obstacles) {
  const target = Math.max(0, vehicle.speed, vehicle.target || 0);
  const horizon = clamp(target / BRAKING + 1, 3, 5),
    step = 0.1;
  const nearby = obstacles.filter(
    (o) =>
      o.id !== vehicle.id &&
      dist(vehicle, o) < (target + Math.abs(o.speed || 0)) * horizon + 12,
  );
  if (!nearby.length) return null;
  const ghost = { ...vehicle };
  const prediction = createObstaclePrediction(vehicle, nearby);
  const originals = new Map(nearby.map((o) => [o.id, o]));
  const lead = leadVehicle(
    vehicle,
    nearby.filter((o) => o.type === "car" || o.type === "motorcycle"),
  );
  let traveled = 0,
    rearThreat = null;
  for (let time = 0; time <= horizon; time += step) {
    if (time > 0) {
      const steering = vehicle.maneuver
        ? maneuverSteering(ghost, vehicle.maneuver)
        : vehicle.steering || 0;
      const ahead = lead
        ? leadVehicle(ghost, [otherPose(lead.other, time - step)])
        : null;
      const before = { x: ghost.x, z: ghost.z };
      physics(
        ghost,
        steering,
        Math.min(
          maneuverVelocity(ghost, vehicle.maneuver, target),
          followingSpeed(ghost, ahead),
        ),
        step,
      );
      traveled += dist(before, ghost);
    }
    for (const { object: pose } of prediction(time, ghost)) {
      const other = originals.get(pose.id);
      // Cover motion between samples and leave extra room around a rider.
      const buffer =
        (other.type === "motorcycle"
          ? 0.3
          : other.type === "pedestrian"
            ? 0.35
            : 0.12) +
        Math.min(0.8, ((ghost.speed + Math.abs(pose.speed || 0)) * step) / 2);
      if (footprintClearance(ghost, pose) > buffer) continue;
      const fromBehind =
        rearFollower(vehicle, other) &&
        ghost.speed >= 0 &&
        Math.cos(ghost.heading - vehicle.heading) > 0.85 &&
        Math.cos(pose.heading - ghost.heading) > 0.5;
      const conflict = {
        object_id: other.id,
        type: other.type,
        ...relativeTrafficState(vehicle, other),
        time_s: time,
        distance_along_path_m: traveled,
        braking_reduces_risk: !fromBehind,
        max_speed_mps: fromBehind
          ? null
          : brakingSpeed(traveled - (other.type === "pedestrian" ? 0.65 : 0.3)),
        reason: fromBehind
          ? "Following traffic behind"
          : other.type === "motorcycle"
            ? "Motorcycle clearance"
            : other.type === "pedestrian"
              ? "Pedestrian clearance"
              : "Crossing or merging traffic",
      };
      // Braking cannot resolve a same-lane follower approaching our rear.
      // Still report it to Jev and keep looking for hazards ahead or across us.
      if (fromBehind) rearThreat ??= conflict;
      else return conflict;
    }
  }
  return rearThreat;
}
