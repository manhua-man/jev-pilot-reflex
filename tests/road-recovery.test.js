import test from "node:test";
import assert from "node:assert/strict";
import {
  roadGeometry,
  roadOccupancy,
  localRoads,
} from "../src/road-geometry.js";
import {
  createDrivingPlan,
  recoveryTarget,
  recoveryBlocked,
} from "../src/driving-plan.js";
import { generateWorld } from "../src/world.js";
import { Simulation } from "../src/simulation.js";
import { heading, move, rng, samplePolyline } from "../src/math.js";

function crossroads() {
  const nodes = [
    { id: "n", x: 0, z: -80 },
    { id: "s", x: 0, z: 80 },
    { id: "w", x: -80, z: 0 },
    { id: "e", x: 80, z: 0 },
  ];
  return {
    type: "town",
    nodes,
    byId: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: [
      { a: "n", b: "s", width: 12 },
      { a: "w", b: "e", width: 12 },
    ],
  };
}
function carAt(x, z, h = 0) {
  const points = samplePolyline([
    { x: 3, z: 70 },
    { x: 3, z: -70 },
  ]);
  return {
    x,
    z,
    heading: h,
    speed: 0,
    steering: 0,
    width: 1.9,
    depth: 4.75,
    route: { points, length: points.at(-1).s, crossings: [] },
  };
}

test("road occupancy checks the full footprint and the union at intersections", () => {
  const roads = roadGeometry(crossroads());
  assert(roadOccupancy(carAt(3, -20), roads).on_road);
  assert(!roadOccupancy(carAt(5.8, -20), roads).on_road);
  assert(roadOccupancy(carAt(4.5, 4.5, Math.PI / 4), roads).on_road);
  assert(!roadOccupancy(carAt(8, 8), roads).on_road);
});

test("curved highway geometry includes both carriageways and excludes the median", () => {
  const world = generateWorld(7, "highway"),
    i = Math.floor(world.roadSamples.length / 2);
  const p = world.roadSamples[i],
    h = heading(world.roadSamples[i - 1], world.roadSamples[i + 1]);
  const roads = localRoads(world, p);
  for (const side of [-1, 1]) {
    const lane = move(p, h + Math.PI / 2, side * 9);
    assert(roadOccupancy({ ...carAt(lane.x, lane.z, h) }, roads).on_road);
  }
  const median = roadOccupancy({ ...carAt(p.x, p.z, h), width: 4 }, roads);
  assert(!median.on_road);
  assert(
    median.outside_fraction > 0.45,
    "corners on asphalt must not hide the median beneath the body",
  );
});

test("random batches change while seeded runs remain reproducible", () => {
  const a = new Simulation(42),
    b = new Simulation(42);
  const first = a.decisionState(),
    duplicate = b.decisionState(),
    next = a.decisionState();
  assert.deepEqual(first, duplicate);
  assert.notEqual(first.batch_id, next.batch_id);
  assert.notDeepEqual(
    Object.values(first.vectors).map((v) => v.steering),
    Object.values(next.vectors).map((v) => v.steering),
  );
  assert(
    Object.values(first.vectors)
      .filter((v) => v.velocity_mps)
      .every((v) => v.stays_on_road),
  );
  assert.equal(a.observation().steering_candidates, next.vectors);
});

test("off-road sampling spans steering and both directions at recovery speed", () => {
  const world = crossroads(),
    car = carAt(12, -25);
  const plan = createDrivingPlan(car, world, [], rng(91), "b1", 0);
  const options = Object.values(plan.vectors).filter((v) => v.velocity_mps);
  assert(plan.recovery.active);
  assert(!plan.recovery.blocked);
  assert(plan.recovery.target.right_m < 0);
  assert(options.some((v) => v.velocity_mps < 0));
  assert(options.some((v) => v.velocity_mps > 0));
  assert(options.every((v) => Math.abs(v.velocity_mps) <= 2));
  assert(Math.min(...options.map((v) => v.steering)) < -0.7);
  assert(Math.max(...options.map((v) => v.steering)) > 0.7);
  assert(
    options.some((v) => v.road_distance_after_m < plan.road.distance_to_road_m),
  );
});

test("recovery guidance can detour around a building toward a road lane", () => {
  const world = crossroads(),
    car = carAt(20, -25),
    surfaces = localRoads(world, car);
  const building = {
    type: "building",
    x: 12,
    z: -25,
    width: 5,
    depth: 80,
    rotation: 0,
  };
  const target = recoveryTarget(car, surfaces, [building]);
  assert(target);
  assert(
    target.waypoint.x > building.x,
    "first waypoint stays on this side of the blocker",
  );
  assert(Math.abs(target.waypoint.z - building.z) > building.depth / 2);
  assert(roadOccupancy({ ...car, ...target.goal }, surfaces).on_road);
});

test("candidate sweeps and recovery braking detect obstacles behind the car", () => {
  const world = crossroads(),
    car = carAt(12, -25);
  const obstacle = {
    id: "rear",
    type: "building",
    x: 12,
    z: -19.8,
    width: 6,
    depth: 2,
  };
  const plan = createDrivingPlan(car, world, [obstacle], rng(91), "b1", 14);
  assert(
    Object.values(plan.vectors).some(
      (v) => v.velocity_mps < 0 && v.collision_predicted,
    ),
  );
  assert(
    recoveryBlocked({ ...car, speed: -2 }, 0, -2, [{ ...obstacle, z: -20.5 }]),
  );
});

test("road-mode candidates obey a red-light stop ceiling", () => {
  const plan = createDrivingPlan(
    carAt(3, -25),
    crossroads(),
    [],
    rng(7),
    "b1",
    0,
  );
  assert(!plan.recovery.active);
  assert(Object.values(plan.vectors).every((v) => v.velocity_mps === 0));
});

test("recovery targets look ahead along the lane instead of stopping sideways", () => {
  const sim = new Simulation(42, "town");
  Object.assign(
    sim.player,
    move(sim.player, sim.player.heading + Math.PI / 2, 7),
  );
  const state = sim.decisionState();
  assert(state.recovery.active);
  assert(!state.recovery.blocked, "the open shoulder has a route back");
  assert(state.recovery.target.ahead_m >= 7.9);
  assert(state.recovery.target.right_m < -6);
});
