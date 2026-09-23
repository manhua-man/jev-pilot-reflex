import assert from "node:assert/strict";
import { Simulation } from "../src/simulation.js";
import { pointAt } from "../src/math.js";
import { evaluate } from "../server/jev.js";
const sim = new Simulation(42, "town"),
  v = sim.player;
sim.traffic = [];
sim.pedestrians = [];
sim.autopilot = true;
const crossing = v.route.crossings.find(
  (c) => sim.world.byId[c.nodeId].control === "signal",
);
const node = sim.world.byId[crossing.nodeId],
  northSouth = Math.abs(Math.cos(crossing.approach)) > 0.5;
v.s = crossing.stopS - 65;
Object.assign(v, pointAt(v.route.points, v.s));
v.heading = crossing.approach;
let calls = 0,
  cost = 0,
  stopped = false;
for (; calls < 100; calls++) {
  node.offset = (northSouth ? 12 : 2) - sim.time;
  sim.scanScene();
  const state = sim.decisionState();
  const answer = await evaluate(state, process.env);
  v.maneuver = state.vectors[answer.answers.vector.choice];
  cost += answer.cost_usd;
  v.steering = answer.controls.steering;
  v.target = answer.controls.velocity;
  for (let i = 0; i < 6; i++) {
    node.offset = (northSouth ? 12 : 2) - sim.time;
    sim.step(0.05);
  }
  const distance = crossing.stopS - v.s;
  if (v.speed < 0.1 && calls > 0) {
    assert(distance < 3.5, `stopped ${distance}m from line`);
    assert(distance > v.depth / 2, "front bumper crossed the line");
    stopped = true;
    console.log("RED STOP", {
      center_distance_m: distance,
      bumper_gap_m: distance - v.depth / 2,
      calls: calls + 1,
    });
    break;
  }
}
assert(stopped, "did not reach the stop line");
node.offset = (northSouth ? 2 : 12) - sim.time;
sim.scanScene();
const answer = await evaluate(sim.decisionState(), process.env);
cost += answer.cost_usd;
assert(answer.controls.velocity > 0, "did not resume at green");
console.log("GREEN RESUME", {
  target_mps: answer.controls.velocity,
  cost_usd: cost,
});
assert.equal(sim.collisions, 0);
assert.equal(sim.violations, 0);
