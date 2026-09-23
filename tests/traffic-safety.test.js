import test from "node:test";
import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import { physics } from "../src/planning.js";
import { samplePolyline } from "../src/math.js";
import {
  footprintClearance,
  leadVehicle,
  predictTrafficConflict,
} from "../src/traffic-safety.js";

function fixture(speed = 14) {
  const sim = new Simulation(42, "highway");
  sim.traffic = [];
  sim.pedestrians = [];
  sim.world.objects = [];
  sim.freeExplore = true;
  const points = samplePolyline([
    { x: 0, z: 0 },
    { x: 0, z: -1000 },
  ]);
  Object.assign(sim.player, {
    x: 0,
    z: 0,
    s: 0,
    heading: 0,
    steering: 0,
    speed,
    target: speed,
    route: { points, length: 1000, crossings: [] },
  });
  return sim;
}
const motorcycle = (props = {}) => ({
  id: "test-bike",
  type: "motorcycle",
  width: 0.8,
  depth: 2.3,
  x: 0,
  z: -40,
  heading: 0,
  speed: 0,
  ...props,
});

test("crossing motorcycle is detected before it enters the old forward strip", () => {
  const sim = fixture(),
    v = sim.player,
    bike = motorcycle({ x: -16, z: -28, heading: Math.PI / 2, speed: 8 });
  sim.traffic = [bike];
  assert.equal(leadVehicle(v, [bike]), null);
  const risk = sim.speedEnvelope(v);
  assert.equal(risk.conflict.object_id, bike.id);
  assert(risk.conflict.time_s > 1);
  assert(risk.max < v.speed);
  let min = Infinity,
    braked = false;
  for (let t = 0; t < 8; t += 0.025) {
    const cap = sim.speedEnvelope(v).max;
    braked ||= cap < v.target;
    physics(v, 0, Math.min(v.target, cap), 0.025);
    bike.x += bike.speed * 0.025;
    min = Math.min(min, footprintClearance(v, bike));
  }
  assert(braked);
  assert(min > 0.5, `clearance ${min}`);
  assert(v.z < -50, "continues once the motorcycle clears");
});

test("highway approach leaves a useful gap behind a motorcycle that brakes hard", () => {
  const sim = fixture(28),
    v = sim.player,
    bike = motorcycle({ z: -65, speed: 14 });
  sim.traffic = [bike];
  let min = Infinity;
  for (let t = 0; t < 15; t += 0.025) {
    bike.speed = Math.max(0, bike.speed - 8 * 0.025);
    bike.z -= bike.speed * 0.025;
    physics(v, 0, Math.min(v.target, sim.speedEnvelope(v).max), 0.025);
    min = Math.min(min, footprintClearance(v, bike));
  }
  assert(min >= 3, `clearance ${min}`);
  assert(v.speed < 0.1);
  const gap = leadVehicle(v, [bike]).gap;
  assert(gap >= 3 && gap <= 8, `stopped gap ${gap}`);
});

test("parallel and oncoming motorcycles in other lanes do not cause a stop", () => {
  const sim = fixture(28);
  sim.traffic = [
    motorcycle({ x: 4.5, z: -5, speed: 28 }),
    motorcycle({ id: "opposite", x: -6, z: -35, speed: 28, heading: Math.PI }),
  ];
  assert.equal(sim.speedEnvelope(sim.player).max, 28);
  assert.equal(predictTrafficConflict(sim.player, sim.traffic), null);
});

test("prediction follows the turn toward a stopped motorcycle", () => {
  const sim = fixture(7),
    points = samplePolyline([
      { x: 0, z: 0 },
      { x: 0, z: -12 },
      { x: 12, z: -12 },
      { x: 50, z: -12 },
    ]);
  sim.player.route = { points, length: points.at(-1).s, crossings: [] };
  const bike = motorcycle({ x: 8, z: -12, heading: Math.PI / 2 });
  assert.equal(leadVehicle(sim.player, [bike]), null);
  assert.equal(predictTrafficConflict(sim.player, [bike])?.object_id, bike.id);
});

test("vehicle footprint detects front-bumper overlap before centers collide", () => {
  const sim = fixture(),
    bike = motorcycle({ z: -3 });
  assert(footprintClearance(sim.player, bike) < 0);
  bike.z = -4;
  assert(footprintClearance(sim.player, bike) > 0);
});
