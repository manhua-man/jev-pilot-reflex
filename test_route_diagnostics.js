import { generateWorld, makeRoute, makeForkRoute, shortestPath } from "./src/world.js";
import { Simulation } from "./src/simulation.js";
import { nearestOnPath, dist, pointAt } from "./src/math.js";
import { routesFromLocation, routeFromLocation } from "./src/routing.js";

console.log("=== STARTING ROUTE DIAGNOSTICS ===");
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failures++;
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

// TEST 1: makeRoute geometry and angle smoothness on Town, City, Highway
for (const type of ["town", "city", "highway"]) {
  const world = generateWorld(42, type);
  const route = world.route;
  let maxTurn = 0;
  let maxTurnIndex = -1;
  let maxGap = 0;
  for (let i = 1; i < route.points.length - 1; i++) {
    const p0 = route.points[i - 1];
    const p1 = route.points[i];
    const p2 = route.points[i + 1];
    const d1 = dist(p0, p1);
    if (d1 > maxGap) maxGap = d1;
    const h1 = Math.atan2(p1.x - p0.x, p0.z - p1.z);
    const h2 = Math.atan2(p2.x - p1.x, p1.z - p2.z);
    let dh = Math.abs(h2 - h1);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    if (dh > maxTurn) {
      maxTurn = dh;
      maxTurnIndex = i;
    }
  }
  const maxTurnDeg = (maxTurn * 180) / Math.PI;
  console.log(`World '${type}': route length = ${route.length.toFixed(1)}m, points = ${route.points.length}, max waypoint turn = ${maxTurnDeg.toFixed(2)}°, max waypoint gap = ${maxGap.toFixed(2)}m`);
  assert(maxTurnDeg < 15, `${type}: Maximum turn angle between 1m waypoints should be < 15° (was ${maxTurnDeg.toFixed(2)}° at index ${maxTurnIndex})`);
  assert(maxGap < 2.5, `${type}: Maximum gap between sampled waypoints should be < 2.5m (was ${maxGap.toFixed(2)}m)`);
}

// TEST 2: Fork switching via setForkBranch
{
  const sim = new Simulation(42, "town");
  const initBranch = sim.world.route.ids.includes("fork-right") ? "right" : "left";
  const targetBranch = initBranch === "right" ? "left" : "right";
  console.log(`Initial fork branch: ${initBranch}, switching to ${targetBranch}`);
  
  const switched = sim.setForkBranch(targetBranch);
  assert(switched === true, `setForkBranch("${targetBranch}") should return true`);
  assert(sim.world.route.ids.includes(`fork-${targetBranch}`), `World route must include fork-${targetBranch}`);
  assert(sim.player.route.ids.includes(`fork-${targetBranch}`), `Player route must include fork-${targetBranch}`);
}

// TEST 3: Endless Cruising multi-leg continuity
{
  const sim = new Simulation(42, "town");
  sim.endlessCruising = true;
  sim.lastLegAdvance = -10;
  
  for (let leg = 1; leg <= 5; leg++) {
    sim.lastLegAdvance = -10;
    const prevPointsCount = sim.player.route.points.length;
    const prevLen = sim.player.route.length;
    sim.appendNextLeg();
    assert(sim.player.route.points.length > prevPointsCount, `Leg ${leg}: route points should increase`);
    assert(sim.player.route.length > prevLen, `Leg ${leg}: route length should increase`);
    
    // Check for gaps or discontinuous jumps in the stitched route
    let legMaxGap = 0;
    let legMaxTurn = 0;
    for (let i = 1; i < sim.player.route.points.length - 1; i++) {
      const p0 = sim.player.route.points[i - 1];
      const p1 = sim.player.route.points[i];
      const p2 = sim.player.route.points[i + 1];
      const d1 = dist(p0, p1);
      if (d1 > legMaxGap) legMaxGap = d1;
      const h1 = Math.atan2(p1.x - p0.x, p0.z - p1.z);
      const h2 = Math.atan2(p2.x - p1.x, p1.z - p2.z);
      let dh = Math.abs(h2 - h1);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      if (dh > legMaxTurn) legMaxTurn = dh;
    }
    const legMaxTurnDeg = (legMaxTurn * 180) / Math.PI;
    assert(legMaxGap < 2.5, `Leg ${leg}: Waypoint gap across leg junction must be < 2.5m (was ${legMaxGap.toFixed(2)}m)`);
    assert(legMaxTurnDeg < 15, `Leg ${leg}: Waypoint turn across leg junction must be < 15° (was ${legMaxTurnDeg.toFixed(2)}°)`);
  }
}

// TEST 4: Rerouting from off-route locations
{
  const sim = new Simulation(42, "town");
  // Position car 10 meters off the road
  const car = {
    x: sim.player.x + 12,
    z: sim.player.z + 5,
    heading: sim.player.heading,
  };
  const candidates = routesFromLocation(sim.world, car, sim.destinationApproach, sim.destinationPoint);
  assert(candidates.length > 0, "routesFromLocation should find viable candidate routes");
  if (candidates.length > 0) {
    const top = candidates[0].route;
    assert(top.points.length > 2, "Candidate route should have points");
    // Verify no negative stopS values
    const negCrossings = top.crossings.filter(c => c.stopS < -0.1);
    assert(negCrossings.length === 0, `Candidate route should not contain negative stopS crossings (found ${negCrossings.length})`);
  }
}

console.log(`\n=== ROUTE DIAGNOSTICS COMPLETED with ${failures} failures ===`);
if (failures > 0) process.exit(1);
