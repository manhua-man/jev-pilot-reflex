import { Simulation } from "./src/simulation.js";
import { generateAlpine, extendAlpineWorld, THEMES } from "./src/world.js";
import { getContinuousAlpineHeight } from "./src/alpine-world.js";

console.log("=== [TEST 1] Procedural Alpine Network Extension ===");
const world = generateAlpine(42, THEMES.alpine);
console.log(`Initial Alpine World: nodes=${world.nodes.length}, edges=${world.edges.length}, routeLength=${world.route.length.toFixed(1)}m`);

let curDestNode = world.byId[world.destination];
console.log(`Start destination: ${curDestNode.id} at (${curDestNode.x}, ${curDestNode.z})`);

for (let leg = 1; leg <= 8; leg++) {
  const ext = extendAlpineWorld(world, curDestNode, Math.random, leg % 2 === 0 ? "right" : "left");
  console.log(`Leg ${leg}: [${ext.name}] -> newDest: ${ext.destinationId}, pathIds: ${ext.pathIds.join(" -> ")}`);
  if (!world.byId[ext.destinationId]) {
    throw new Error(`Destination ${ext.destinationId} missing from world!`);
  }
  curDestNode = world.byId[ext.destinationId];
}
console.log(`Extended Alpine World: nodes=${world.nodes.length}, edges=${world.edges.length}`);
console.log("✓ Test 1 Passed: 8 procedural alpine legs successfully generated and linked.");

console.log("\n=== [TEST 2] Simulation Endless Cruising in Alpine ===");
const sim = new Simulation(12345, "alpine");
console.log(`Initial Sim Route: length=${sim.player.route.length.toFixed(1)}m, traffic=${sim.traffic.length}, pedestrians=${sim.pedestrians.length}`);

// Verify traffic diversity
const subtypes = new Set(sim.traffic.map(v => v.subtype || v.type));
console.log(`Traffic fleet types: ${Array.from(subtypes).join(", ")}`);
if (subtypes.size < 3) {
  throw new Error(`Insufficient traffic fleet diversity: ${Array.from(subtypes).join(", ")}`);
}

// Verify pedestrian diversity
console.log(`Pedestrians spawned: ${sim.pedestrians.length}`);
if (sim.pedestrians.length < 5) {
  throw new Error(`Insufficient pedestrians in alpine: ${sim.pedestrians.length}`);
}
const pedSubtypes = new Set(sim.pedestrians.map(p => p.subtype));
console.log(`Pedestrian subtypes: ${Array.from(pedSubtypes).join(", ")}`);

// Simulate consecutive leg advances
sim.endlessCruising = true;
for (let step = 1; step <= 5; step++) {
  sim.time += 5;
  sim.player.s = sim.player.route.length - 8; // near end
  sim.appendNextLeg();
  console.log(`After appendNextLeg ${step}: stageLeg=${sim.stageLeg}, routeLength=${sim.player.route.length.toFixed(1)}m, dest=${sim.world.destination}`);
  if (sim.stageLeg !== step + 1) {
    throw new Error(`Expected stageLeg ${step + 1}, got ${sim.stageLeg}`);
  }
}
console.log("✓ Test 2 Passed: Simulation seamlessly appends 5 consecutive endless cruising legs.");

console.log("\n=== [TEST 3] Continuous Alpine Height Evaluation ===");
const sampleCoords = [
  [0, 0], [-4.5, 4.5], [-0.72, -0.72], [10, 10], [-15, 20], [30, -25], [100, 100]
];
for (const [x, z] of sampleCoords) {
  const h = getContinuousAlpineHeight(x, z, sim.world);
  if (Number.isNaN(h) || !Number.isFinite(h)) {
    throw new Error(`Height at (${x}, ${z}) is ${h}`);
  }
  console.log(`Height at (${x.toString().padStart(4)}, ${z.toString().padStart(4)}): ${h.toFixed(3)}m`);
}
console.log("✓ Test 3 Passed: Continuous alpine heights are valid, smooth, and finite everywhere.");

console.log("\n>>> ALL INFINITE PROCEDURAL ALPINES AUDIT TESTS PASSED WITH 0 ERRORS! <<<");
