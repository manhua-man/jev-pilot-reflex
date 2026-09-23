import { decisionOptions } from "./planning.js";

const rounded = (value) =>
  Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const point = (p) => (p ? p.map(rounded) : [null, null]);
function table(columns, rows) {
  columns = typeof columns === "string" ? columns.split(",") : columns;
  const values = Object.values(rows);
  if (values.length < 3) return { columns, rows };
  const shared = {},
    varying = [];
  columns.forEach((column, i) => {
    const first = values[0][i] ?? null;
    if (values.every((row) => Object.is(row[i] ?? null, first)))
      shared[column] = first;
    else varying.push(i);
  });
  if (!Object.keys(shared).length) return { columns, rows };
  // Lossless factoring: shared columns apply to every row. Candidate identities,
  // alternatives and measurements are preserved, including null/unknown values.
  const project = (row) => varying.map((i) => row[i] ?? null);
  return {
    shared,
    columns: varying.map((i) => columns[i]),
    rows: Array.isArray(rows)
      ? rows.map(project)
      : Object.fromEntries(
          Object.entries(rows).map(([id, row]) => [id, project(row)]),
        ),
  };
}
function boundaryRows(samples) {
  const rows = samples.map((p) => [
    rounded(p.route_ahead_m),
    ...point(p.center),
    ...point(p.road_left),
    ...point(p.road_right),
  ]);
  // Straight edges need only endpoints. Preserve bends, width changes and
  // unknown edges, with at most 10 cm deviation from the original samples.
  const keep = new Set([0, rows.length - 1]);
  const pending = rows.length > 2 ? [[0, rows.length - 1]] : [];
  while (pending.length) {
    const [a, b] = pending.pop();
    let worst = 0.1,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const t = (rows[i][0] - rows[a][0]) / (rows[b][0] - rows[a][0]);
      for (let k = 1; k < 7; k++) {
        const values = [rows[a][k], rows[i][k], rows[b][k]];
        const error = values.every((v) => v === null)
          ? 0
          : values.some((v) => v === null)
            ? Infinity
            : Math.abs(
                rows[i][k] - (rows[a][k] + (rows[b][k] - rows[a][k]) * t),
              );
        if (error > worst) {
          worst = error;
          index = i;
        }
      }
    }
    if (index !== -1) {
      keep.add(index);
      pending.push([a, index], [index, b]);
    }
  }
  return rows.filter((_, i) => keep.has(i));
}
const singleAnswer = (criteria) => {
  const ids = Object.keys(criteria);
  return ids.length === 1
    ? { type: "choice", choice: ids[0], probabilities: { [ids[0]]: 1 } }
    : null;
};

// Local state remains detailed for collision checks and debugging. This is the
// complete, stateless API input; omitted fields never depend on model memory.
export function prepareJevRequest(full) {
  const { moving, motion } = decisionOptions(full);
  const aliases = Object.fromEntries(
    Object.keys(moving).map((id, i) => [`v${i}`, id]),
  );
  const vectors = Object.fromEntries(
    Object.entries(aliases).map(([id, original]) => [id, moving[original]]),
  );
  const intersection = full.scene?.intersection;
  const recovery = full.recovery?.active;
  const nearby = full.scene?.nearby || [];
  const follower = full.traffic?.rear_pressure;
  const lead = full.traffic?.queue || full.scene?.following;
  const hazard = full.scene?.hazard;
  const hasTraffic =
    nearby.length || follower || lead || hazard || full.scene?.blocking_object;
  const requiredStop =
    !!full.speed_constraints?.required_stop_approach ||
    (intersection &&
      !intersection.already_entered &&
      ((intersection.control === "stop" && !intersection.stop_completed) ||
        (intersection.control === "signal" &&
          ["red", "amber"].includes(intersection.signal))));
  const state = {
    driving_style: [
      "Aggressive right-lane driver: favor fast useful progress. Stop only for imminent collision, a required line, or arrival.",
      hasTraffic
        ? "Follow queues without passing; close to 2m before stopping. Rear/oncoming/adjacent traffic alone is no reason to brake."
        : "",
      intersection
        ? "Approach the line; stop 0.5m before it. Green or completed stop: proceed when your path is clear."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    units:
      "m,s,m/s,deg; points=[right,ahead], negative ahead=behind. Table shared values apply to every row." +
      (nearby.length ? " Traffic heading:0=same direction,180=oncoming." : ""),
    speed: rounded(full.speed_mps),
    limit: rounded(full.limit_mps),
    nav: {
      turn: full.turn.direction,
      in_m: rounded(full.turn.in_m),
      remaining_m: rounded(full.destination_m),
      ...(full.trip ? { phase: full.trip.phase } : {}),
    },
    road: {
      on_road: full.road.on_road,
      lane_offset: rounded(full.lane.offset_m),
      lane_half_width: rounded(full.lane.half_width_m),
      body_width_length: full.road.ego_footprint?.length
        ? [0, 1].map((axis) => {
            const coords = full.road.ego_footprint.map((p) => p[axis]);
            return rounded(Math.max(...coords) - Math.min(...coords));
          })
        : undefined,
      // Left/right are actual asphalt edges. Lane edges can be derived from
      // the route center and half-width; sending both duplicates every point.
      boundaries: table(
        "route_ahead,center_right,center_ahead,left_right,left_ahead,right_right,right_ahead",
        boundaryRows(full.road.boundary_samples || []),
      ),
      body_edge_clearance_rear_center_front: (
        full.road.edge_clearance_samples || []
      ).map((p) => [rounded(p.left_clearance_m), rounded(p.right_clearance_m)]),
    },
  };
  const global = full.global;
  if (global?.position && global?.destination) {
    const h = (global.position.heading_deg * Math.PI) / 180;
    const dx = global.destination.x - global.position.x;
    const dz = global.destination.z - global.position.z;
    state.nav.destination = [
      rounded(dx * Math.cos(h) + dz * Math.sin(h)),
      rounded(dx * Math.sin(h) - dz * Math.cos(h)),
    ];
  }
  if (intersection) {
    const memory = intersection.stop_memory;
    state.intersection = {
      control: intersection.control,
      signal: intersection.signal,
      bumper_to_line: rounded(intersection.stop_line_ahead_m),
      entered: intersection.already_entered,
      stop_completed: intersection.stop_completed,
      ...(intersection.earlier_arrivals?.length
        ? { earlier_arrivals: intersection.earlier_arrivals.length }
        : {}),
      ...(memory
        ? {
            stops: memory.stops_on_this_approach,
            dwell: memory.current_stop_duration_s,
            ...(memory.last_stop
              ? {
                  last_stop: {
                    age: memory.last_stop.age_s,
                    duration: memory.last_stop.duration_s,
                    bumper_to_line: memory.last_stop.stop_line_ahead_m,
                  },
                }
              : {}),
          }
        : {}),
    };
  }
  if (full.traffic?.stopped_for_s > 0)
    state.stopped_for = rounded(full.traffic.stopped_for_s);
  if (full.traffic?.deadlock_release) state.deadlock_release = true;
  if (follower)
    state.rear_follower = {
      id: follower.vehicle_id,
      gap: follower.gap_m,
      closing_speed: follower.closing_speed_mps,
    };
  if (lead)
    state.following = {
      id: lead.lead_id ?? lead.id,
      gap: lead.gap_m,
      target_gap: lead.target_gap_m ?? lead.minimum_gap_m,
      ...(full.traffic?.queue ? { queue: true } : {}),
    };
  if (full.scene?.blocking_object) state.blocker = full.scene.blocking_object;
  if (hazard)
    state.current_path_hazard = {
      id: hazard.id,
      in_s: hazard.in_s,
      point: [hazard.right_m, hazard.ahead_m],
      braking_helps: hazard.braking_reduces_risk,
    };
  if (nearby.length)
    state.traffic = table(
      "id,type,right,ahead,speed,heading,relative_forward_speed",
      nearby.map((o) => [
        o.id,
        o.type,
        rounded(o.right_m),
        rounded(o.ahead_m),
        rounded(o.speed_mps),
        rounded(o.heading_relative_deg),
        rounded(o.relative_velocity_ahead_mps),
      ]),
    );
  if (recovery)
    state.recovery = {
      blocked: full.recovery.blocked,
      road_distance: full.road.distance_to_road_m,
      target: full.recovery.target,
    };

  const columns = [
    "speed",
    "end_speed",
    "progress",
    "route_error",
    "lane_error",
    "heading_error",
    "end_right",
    "end_ahead",
  ];
  if (requiredStop) columns.push("line_after", "crosses_line", "stop_at_line");
  const needsRoadStatus = Object.values(vectors).some((v) => !v.stays_on_road);
  const needsLaneStatus = Object.values(vectors).some((v) => !v.stays_in_lane);
  if (needsRoadStatus) columns.push("on_road", "max_offroad_fraction");
  if (needsLaneStatus) columns.push("in_lane", "returning_to_lane");
  if (recovery)
    columns.push("recovery_distance", "road_distance_after", "on_road_after");
  const rows = Object.fromEntries(
    Object.entries(vectors).map(([id, v]) => {
      const row = [
        v.velocity_mps,
        v.end_speed_mps,
        v.route_progress_m,
        v.route_error_m,
        v.lane_error_m,
        v.heading_error_deg,
      ].map(rounded);
      row.push(
        ...point(
          v.end_position
            ? [v.end_position.right_m, v.end_position.ahead_m]
            : null,
        ),
      );
      if (requiredStop)
        row.push(
          rounded(v.stop_line_after_m),
          v.crosses_stop_line,
          !!v.stop_at_line,
        );
      if (needsRoadStatus) row.push(v.stays_on_road, v.max_offroad_fraction);
      if (needsLaneStatus) row.push(v.stays_in_lane, v.returning_to_lane);
      if (recovery)
        row.push(
          rounded(v.recovery_distance_m),
          rounded(v.road_distance_after_m),
          v.on_road_after,
        );
      return [id, row];
    }),
  );
  if (Object.keys(rows).length) {
    state.candidates = {
      horizon_s: 3,
      ...(needsRoadStatus ? {} : { all_on_road: true }),
      ...(needsLaneStatus ? {} : { all_in_lane: true }),
      ...table(columns, rows),
    };
    const conflicts = Object.fromEntries(
      Object.entries(vectors)
        .filter(([, v]) => v.collision_predicted)
        .map(([id, v]) => [
          id,
          { object: v.collision_object_id, in_s: v.collision_in_s },
        ]),
    );
    if (Object.keys(conflicts).length) state.candidates.conflicts = conflicts;
  }

  const questions = {},
    fixed = {};
  const ask = (id, criteria, instructions) => {
    const only = singleAnswer(criteria);
    if (only) fixed[id] = only;
    else if (Object.keys(criteria).length)
      questions[id] = { type: "choice", instructions, criteria };
  };
  ask(
    "motion",
    motion,
    "Drive includes slowing or approaching a stop line; stop means zero target speed NOW. Prefer drive when useful progress is possible. Use current conflicts, legal requirements and stop memory; proximity alone is not a reason to stop.",
  );
  if (questions.motion) state.stop_reasons = full.stop_availability?.reasons;
  ask(
    "vector",
    Object.fromEntries(Object.keys(vectors).map((id) => [id, null])),
    [
      "Assuming drive, choose fastest useful progress with low route/lane error. Predictions include following and curve/section speed control. Keep the whole car on asphalt: negative clearance=off-road, null edges=unknown, preview end is not road end.",
      requiredStop
        ? "Choose stop_at_line to approach then stop 0.5m before the line. Do not pick a faster crossing path."
        : intersection
          ? "Green or completed stop: continue through the line."
          : "",
      state.candidates?.conflicts || hazard
        ? "Conflicts are future predicted contacts; compare timing and paths. A current-path hazard may not affect another candidate."
        : "",
      recovery
        ? "Recover toward target, reducing recovery_distance and road_distance_after, then align with route; clear reverse is allowed."
        : "",
      ["onramp", "merge", "interstate"].includes(full.trip?.phase)
        ? "Accelerate on the ramp, match a merge gap, then cruise. Section boundaries are continuous road, not a stop or U-turn."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (global?.routes && Object.keys(global.routes).length > 1) {
    state.navigation_choices = {
      position: global.position,
      destination: global.destination,
      routes: global.routes,
      junctions: table(
        "id,x,z,control",
        global.junctions.map((n) => [
          n.id,
          rounded(n.x),
          rounded(n.z),
          n.control,
        ]),
      ),
      roads: table("from,to,width,one_way,limit,kind", global.roads),
      ...(global.stopped_traffic.length
        ? { stopped_traffic: global.stopped_traffic }
        : {}),
    };
    ask(
      "route",
      Object.fromEntries(Object.keys(global.routes).map((id) => [id, null])),
      "Choose a route to destination. Keep the route when on or near it. Alternatives address a sustained departure: consider join distance, direction and blocked junctions; avoid repeated reversals. World coordinates x=east,z=south,heading 0=north.",
    );
  }
  return { request: { model: "jev-latest", state, questions }, fixed, aliases };
}

export function expandJevAnswers(prepared, answers = {}) {
  const result = { ...answers, ...prepared.fixed };
  if (result.vector) {
    const vector = result.vector;
    result.vector = {
      ...vector,
      choice: prepared.aliases[vector.choice],
      probabilities: Object.fromEntries(
        Object.entries(vector.probabilities || {}).map(([id, probability]) => [
          prepared.aliases[id] ?? id,
          probability,
        ]),
      ),
    };
  }
  return result;
}

export function decisionInterval(state) {
  const near = Math.max(18, Math.abs(state.speed_mps) * 3);
  if (
    state.recovery.active ||
    state.bend_deg > 12 ||
    ["merge", "ramp_turn"].includes(state.trip?.phase) ||
    state.scene?.hazard ||
    (state.scene?.intersection &&
      state.scene.intersection.stop_line_ahead_m < near) ||
    (state.scene?.following && state.scene.following.gap_m < near) ||
    state.scene?.nearby?.some(
      (o) => Math.abs(o.right_m) < 8 && Math.abs(o.ahead_m) < near,
    )
  )
    return 250;
  return 650;
}
