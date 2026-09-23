import test from "node:test";
import assert from "node:assert/strict";
import { firstCollision, collisionPose } from "../src/collisions.js";
import { Simulation } from "../src/simulation.js";

const car = (props = {}) => ({
  x: 0,
  z: 0,
  heading: 0,
  speed: 28,
  width: 1.9,
  depth: 4.2,
  ...props,
});
test("sweeps stop at the first building, pedestrian, car, or motorcycle contact", () => {
  for (const [type, width, depth] of [
    ["building", 10, 10],
    ["pedestrian", 0.6, 0.6],
    ["car", 1.9, 4.2],
    ["motorcycle", 0.8, 2.3],
  ]) {
    const object = { id: type, type, x: 0, z: -15, width, depth };
    const hit = firstCollision(car(), car({ z: -30 }), [{ object }]);
    assert.equal(hit.object.id, type);
    assert(Math.abs(hit.player.z - (-15 + depth / 2 + 2.1)) < 0.002);
    assert.equal(hit.relativeSpeed, 28);
  }
});
test("a crossing motorcycle cannot tunnel through a stationary car between frames", () => {
  const object = {
    id: "bike",
    type: "motorcycle",
    x: 5,
    z: 0,
    heading: Math.PI / 2,
    speed: 28,
    width: 0.8,
    depth: 2.3,
  };
  const hit = firstCollision(car({ speed: 0 }), car({ speed: 0 }), [
    { object, previous: collisionPose({ ...object, x: -5 }) },
  ]);
  assert.equal(hit.object.id, "bike");
  assert(hit.fraction < 0.5);
  assert.equal(hit.relativeSpeed, 28);
});
test("rotated building footprints preserve close passes and detect the protruding corner", () => {
  const object = {
    id: "building",
    type: "building",
    x: 0,
    z: -10,
    width: 2,
    depth: 12,
    rotation: Math.PI / 2,
  };
  assert.equal(
    firstCollision(car({ x: 7 }), car({ x: 7, z: -30 }), [{ object }]),
    null,
  );
  assert(firstCollision(car({ x: 5 }), car({ x: 5, z: -30 }), [{ object }]));
});
test("crashes end the drive once, freeze simulation, disable autopilot and reset cleanly", () => {
  const sim = new Simulation(42, "town");
  sim.traffic = [];
  sim.pedestrians = [];
  sim.world.objects = [
    {
      id: "wall",
      type: "building",
      x: sim.player.x,
      z: sim.player.z,
      width: 1,
      depth: 1,
    },
  ];
  sim.autopilot = true;
  sim.step(0.025);
  assert.equal(sim.crash.type, "building");
  assert.equal(sim.collisions, 1);
  assert.equal(sim.autopilot, false);
  assert.equal(sim.complete, false);
  assert.equal(sim.player.target, 0);
  const time = sim.time,
    x = sim.player.x;
  for (let i = 0; i < 100; i++) sim.step(0.05);
  assert.equal(sim.time, time);
  assert.equal(sim.player.x, x);
  assert.equal(sim.collisions, 1);
  sim.reset(42, "town");
  assert.equal(sim.crash, null);
  assert.equal(sim.collisions, 0);
  sim.step(0.025);
  assert(sim.time > 0);
  assert.equal(sim.crash, null);
});
