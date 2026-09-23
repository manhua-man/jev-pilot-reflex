import {
  angle,
  clamp,
  dist,
  heading,
  move,
  nearestOnPath,
  pointAt,
} from "./math.js";

export const CANDIDATE_COUNT = 12;
export const VECTOR_HORIZON = 3;
export const VECTOR_STEPS = 60;
export const EVALUATION_STEPS = 24;
export const ACCELERATION = 5;
export const BRAKING = 8;
export const WHEELBASE = 2.7;
export const FULL_STOP_DISTANCE_M = 2.5;

// Signed distance from the front bumper to the stop-line plane. Positive is
// before the line; this is an observation, never an automatic braking command.
export function stopLineDistance(car, line) {
  const front = move(car, car.heading, car.depth / 2);
  return (
    (line.x - front.x) * Math.sin(line.heading) -
    (line.z - front.z) * Math.cos(line.heading)
  );
}

// Leave time for the next Jev response while approaching a required stop.
// This moderates moving options; choosing whether to stop remains with Jev.
export function stopApproachSpeed(car, line) {
  const room = Math.max(0, stopLineDistance(car, line) - 0.5);
  const deceleration = 4.5;
  const responseAllowance = 0.45;
  return Math.max(
    0.6,
    Math.sqrt(
      (deceleration * responseAllowance) ** 2 + 2 * deceleration * room,
    ) -
      deceleration * responseAllowance,
  );
}

// Full low-speed lock fits the route's 3 m U-turn arcs. Fade the extra lock
// out by 8 m/s so normal driving keeps its existing steering response.
function steeringAngleScale(speed) {
  return 0.58 + 0.37 * (1 - clamp((Math.abs(speed) - 3) / 5, 0, 1));
}

export function steeringCurvature(steering, speed) {
  return Math.tan(steering * steeringAngleScale(speed)) / WHEELBASE;
}

export function steeringForCurvature(curvature, speed) {
  return clamp(
    Math.atan(WHEELBASE * curvature) / steeringAngleScale(speed),
    -0.85,
    0.85,
  );
}

export function physics(car, steer, target, dt) {
  car.speed += clamp(target - car.speed, -BRAKING * dt, ACCELERATION * dt);
  const actual = car.wheelSteering ?? car.steering ?? 0;
  car.wheelSteering = actual + clamp(steer - actual, -1.8 * dt, 1.8 * dt);
  integratePose(car, car.wheelSteering, dt);
  car.steering = steer;
}

// Free play uses pedals. Rolling resistance, engine braking, and aerodynamic
// drag slow a released accelerator without an artificial target-speed lock.
export function pedalPhysics(car, steer, throttle, brake, dt) {
  throttle = clamp(throttle, -1, 1);
  brake = clamp(brake, 0, 1);
  const speed = Math.abs(car.speed);
  const resistance =
    0.18 + 0.0017 * speed * speed + (Math.abs(throttle) < 0.01 ? 0.32 : 0);
  const opposingPedal = throttle * car.speed < -0.01;
  const braking = brake * 11 + (opposingPedal ? Math.abs(throttle) * 8 : 0);
  if (brake || opposingPedal || !throttle) {
    car.speed =
      Math.sign(car.speed) * Math.max(0, speed - (resistance + braking) * dt);
  } else {
    const acceleration = throttle * (throttle < 0 ? 2.5 : 5);
    car.speed +=
      (acceleration - Math.sign(car.speed || throttle) * resistance) * dt;
    car.speed = clamp(car.speed, -3, 34);
  }
  // Build a virtual steering stick while a key is held (full travel in 0.63s).
  // A soft center makes taps precise; continued input reaches a sharp turn.
  steer = clamp(steer, -1, 1);
  const current = car.steeringProgress || 0;
  const reversing = steer * current < 0;
  const goal = reversing ? 0 : steer;
  const returning = reversing || Math.abs(goal) < Math.abs(current);
  const step = (returning ? 5 : 1.6) * dt;
  car.steeringProgress = current + clamp(goal - current, -step, step);
  const input = car.steeringProgress;
  const shaped = input * (0.2 + 0.8 * Math.abs(input));
  const speedLimit = Math.min(
    1,
    (0.72 * 1.4) / (1 + (Math.abs(car.speed) / 7) ** 1.4),
  );
  // Allow full lock while crawling, then blend into the normal manual cap.
  const limit =
    1 + (speedLimit - 1) * clamp((Math.abs(car.speed) - 3) / 5, 0, 1);
  car.wheelSteering = shaped * limit;
  integratePose(car, car.wheelSteering, dt);
}

function integratePose(car, steer, dt) {
  if (Math.abs(car.speed) < 0.01) car.speed = 0;
  car.steering = steer;
  car.heading = angle(
    car.heading + car.speed * steeringCurvature(steer, car.speed) * dt,
  );
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z -= Math.cos(car.heading) * car.speed * dt;
}

// U-turns use a 3 m radius arc beginning just before the stop-line station.
// Keep approach speed proportional to available braking distance instead of
// imposing the arc's 3 m/s speed tens of meters before the bend.
export function uTurnApproach(car, progress = null) {
  if (!car.route?.points?.length) return null;
  const s = progress ?? nearestOnPath(car, car.route.points).s;
  const turn = car.route.crossings.find(
    (c) =>
      Math.cos(c.exit - c.approach) < -0.99 && c.stopS - 0.5 + Math.PI * 3 > s,
  );
  if (!turn) return null;
  const distance = Math.max(0, turn.stopS - 0.5 - s);
  return {
    distance_m: distance,
    speed_limit_mps: Math.sqrt(3 ** 2 + 2 * 5 * Math.max(0, distance - 1.5)),
  };
}

export function maneuverVelocity(car, candidate, velocity) {
  if (velocity <= 0 || !Number.isFinite(candidate?.lane_offset_m))
    return velocity;
  let target = Math.min(
    velocity,
    routeSpeedLimit(car),
    uTurnApproach(car)?.speed_limit_mps ?? Infinity,
  );
  if (candidate.stop_at_line) {
    const line = candidate.stop_at_line;
    const room = Math.max(0, stopLineDistance(car, line) - line.clearance_m);
    // The selected maneuver advances to the line and comes to rest there.
    // The proportional term settles near the line without creeping forever.
    const cap = Math.min(
      Math.sqrt(2 * line.deceleration_mps2 * room),
      room * 2.5,
    );
    target = Math.min(target, cap < 0.05 ? 0 : cap);
  }
  return target;
}

export function routeSection(car, progress = null) {
  const sections = car.route?.sections;
  if (!sections?.length) return null;
  const s = progress ?? nearestOnPath(car, car.route.points).s;
  return sections.find((section) => section.endS > s) ?? sections.at(-1);
}

export function routeSpeedLimit(car, progress = null) {
  if (!car.route?.sections?.length) return Infinity;
  const s = progress ?? nearestOnPath(car, car.route.points).s;
  const current = routeSection(car, s);
  let limit = current.speedLimit;
  if (current.kind === "onramp") {
    // Build speed through the ramp and reach the merge at motorway speed.
    // Both candidate projections and actual driving use this same profile.
    const progress = clamp(
      (s - current.startS) / (current.endS - current.startS),
      0,
      1,
    );
    const entrySpeed = Math.min(18, limit);
    limit = entrySpeed + (limit - entrySpeed) * progress;
  }
  for (const section of car.route.sections) {
    if (section.startS <= s || section.speedLimit >= limit) continue;
    // Match exit/town speed at the section boundary instead of abruptly
    // changing speed limits after entering the lower-speed road.
    limit = Math.min(
      limit,
      Math.sqrt(
        section.speedLimit ** 2 + 8 * Math.max(0, section.startS - s - 3),
      ),
    );
  }
  return limit;
}

// Road maneuvers keep their sampled lane offset throughout the rollout.
// The same controller runs on the real car, so a turn can straighten on exit.
export function maneuverSteering(car, candidate) {
  if (!Number.isFinite(candidate?.lane_offset_m) || !car.route?.points?.length)
    return candidate?.steering ?? car.steering ?? 0;
  const near = nearestOnPath(car, car.route.points);
  const turn = uTurnApproach(car, near.s);
  const lookahead = turn
    ? Math.min(candidate.lookahead_m, Math.max(2.6, turn.distance_m))
    : candidate.lookahead_m;
  const center = pointAt(car.route.points, near.s + lookahead);
  const tangent = center.heading ?? near.heading;
  const goal = move(center, tangent + Math.PI / 2, candidate.lane_offset_m);
  return steeringForCurvature(
    (2 * Math.sin(angle(heading(car, goal) - car.heading))) /
      Math.max(2, dist(car, goal)),
    car.speed,
  );
}

// One immutable maneuver, integrated from the real speed, including braking/reverse.
export function projectVector(
  car,
  steering,
  velocity,
  candidate = null,
  speedLimit = null,
) {
  const ghost = { ...car };
  const points = [{ ...ghost }];
  let evaluation;
  for (let i = 0; i < VECTOR_STEPS; i++) {
    physics(
      ghost,
      candidate ? maneuverSteering(ghost, candidate) : steering,
      Math.min(
        maneuverVelocity(ghost, candidate, velocity),
        speedLimit
          ? speedLimit(ghost, (i * VECTOR_HORIZON) / VECTOR_STEPS)
          : Infinity,
      ),
      VECTOR_HORIZON / VECTOR_STEPS,
    );
    points.push({
      x: ghost.x,
      z: ghost.z,
      heading: ghost.heading,
      speed: ghost.speed,
    });
    if (i === EVALUATION_STEPS - 1) evaluation = { ...ghost };
  }
  return {
    axis: steering,
    velocity,
    points,
    evaluation,
    endHeading: ghost.heading,
  };
}

export function vectorWeights(answer, candidates, ageMs = 0) {
  if (
    !answer ||
    !candidates ||
    ageMs > 1800 ||
    !Object.hasOwn(candidates, answer.choice)
  )
    return null;
  const ids = Object.keys(candidates),
    probabilities = answer.probabilities;
  if (
    !probabilities ||
    ids.some(
      (id) =>
        !Number.isFinite(probabilities[id]) ||
        probabilities[id] < 0 ||
        probabilities[id] > 1,
    )
  )
    return null;
  return Object.fromEntries(
    ids.map((id) => [
      id,
      { probability: probabilities[id], selected: id === answer.choice },
    ]),
  );
}

export function candidateName(candidate) {
  if (!candidate) return "Planning";
  if (!candidate.velocity_mps) return "Brake";
  if (candidate.stop_at_line) return "Approach stop line";
  const direction =
    candidate.steering < -0.025
      ? "Left"
      : candidate.steering > 0.025
        ? "Right"
        : "Straight";
  return `${candidate.velocity_mps < 0 ? "Reverse · " : ""}${direction}`;
}

function movingCandidates(state) {
  const entries = Object.entries(state.vectors);
  if (state.recovery?.blocked || state.speed_ceiling_mps === 0) return [];
  const moving = entries.filter(
    ([, v]) =>
      v.velocity_mps !== 0 && !(v.collision_imminent ?? v.collision_predicted),
  );
  const forwardOnly =
    !state.recovery?.active &&
    ["onramp", "merge", "interstate", "exit", "offramp"].includes(
      state.trip?.phase,
    );
  const roadSafe = state.recovery?.active
    ? moving
    : moving.filter(
        ([, v]) =>
          v.stays_on_road && (!forwardOnly || v.follows_route_direction),
      );
  // A normal traffic queue is not an obstacle to drive around. Keep exploratory
  // alternatives visible, but offer Jev only lane-following queue maneuvers.
  const safe =
    state.traffic?.queue && !state.recovery?.active
      ? roadSafe.filter(([, v]) => v.queue_compatible)
      : roadSafe;
  const inLane = safe.filter(([, v]) => v.stays_in_lane);
  const returning = safe.filter(([, v]) => v.returning_to_lane);
  const preferred = state.recovery?.active
    ? safe
    : inLane.length
      ? inLane
      : returning.length
        ? returning
        : forwardOnly
          ? []
          : safe;
  return preferred;
}

export function stopAvailability(state, moving = movingCandidates(state)) {
  const reasons = [];
  const blocker = state.scene?.blocking_object;
  if (
    blocker &&
    Number.isFinite(blocker.gap_m) &&
    blocker.gap_m <= FULL_STOP_DISTANCE_M
  )
    reasons.push("blocking_object_within_2_5m");
  const intersection = state.scene?.intersection;
  if (
    intersection &&
    !intersection.already_entered &&
    Number.isFinite(intersection.stop_line_ahead_m) &&
    intersection.stop_line_ahead_m >= -0.5 &&
    intersection.stop_line_ahead_m <= FULL_STOP_DISTANCE_M &&
    ((intersection.control === "stop" && !intersection.stop_completed) ||
      (intersection.control === "signal" &&
        ["red", "amber"].includes(intersection.signal)))
  )
    reasons.push("required_stop_line_within_2_5m");
  if (
    Number.isFinite(state.destination_m) &&
    state.destination_m <= FULL_STOP_DISTANCE_M
  )
    reasons.push("destination_reached");
  // Keep an emergency fallback if every sampled movement is blocked. This is
  // not permission to select a full stop while useful moving choices exist.
  if (!moving.length) reasons.push("no_eligible_moving_path");
  return {
    available: reasons.length > 0,
    proximity_m: FULL_STOP_DISTANCE_M,
    reasons,
  };
}

export function candidateChoices(state) {
  const moving = movingCandidates(state);
  const stop = stopAvailability(state, moving).available
    ? Object.entries(state.vectors)
        .filter(([, v]) => v.velocity_mps === 0)
        .slice(-1)
    : [];
  return Object.fromEntries([...moving, ...stop]);
}

export function decisionOptions(state) {
  const candidates = candidateChoices(state);
  const moving = Object.fromEntries(
    Object.entries(candidates).filter(([, v]) => v.velocity_mps !== 0),
  );
  const stopId = Object.keys(candidates).find(
    (id) => candidates[id].velocity_mps === 0,
  );
  return {
    candidates,
    moving,
    stopId,
    motion: {
      ...(Object.keys(moving).length ? { drive: null } : {}),
      ...(stopId ? { stop: null } : {}),
    },
  };
}

// Keep Jev's drive/stop choice separate from its conditional path choice. Many
// similar paths must not split the drive preference against a single stop ID.
export function decisionSelection(state, answers) {
  const { candidates, moving, stopId, motion } = decisionOptions(state);
  if (!vectorWeights(answers?.motion, motion)) return null;
  if (Object.keys(moving).length && !vectorWeights(answers?.vector, moving))
    return null;
  const drive = answers.motion.probabilities.drive ?? 0;
  return {
    choice: answers.motion.choice === "drive" ? answers.vector.choice : stopId,
    probabilities: Object.fromEntries(
      Object.keys(candidates).map((id) => [
        id,
        id === stopId
          ? answers.motion.probabilities.stop
          : drive * answers.vector.probabilities[id],
      ]),
    ),
    confidence: answers.motion.probabilities[answers.motion.choice],
    probability_basis:
      "Motion probability × conditional path probability; stop uses motion probability directly",
  };
}

export function decisionControls(state, response) {
  if (!state?.vectors) return null;
  const selection = decisionSelection(state, response?.answers);
  const candidate = state.vectors[selection?.choice];
  if (
    response?.batch_id !== state?.batch_id ||
    !candidate ||
    response.selection?.choice !== selection.choice ||
    response.selection?.confidence !== selection.confidence ||
    Object.entries(selection.probabilities).some(
      ([id, probability]) =>
        response.selection?.probabilities?.[id] !== probability,
    ) ||
    response.controls?.steering !== candidate.steering ||
    response.controls?.velocity !== candidate.velocity_mps
  )
    return null;
  return response.controls;
}
