import test from "node:test";
import assert from "node:assert/strict";
import { generateWorld, shortestPath, signalState } from "../src/world.js";
import { Simulation, physics } from "../src/simulation.js";
import { blockedByBuilding, dist, pointAt, heading } from "../src/math.js";

test("100 seeds per world produce connected, distinct road graphs and valid start/destination routes", () => {
  for (const type of ["city", "town", "highway"])
    for (let seed = 1; seed <= 100; seed++) {
      const w = generateWorld(seed, type);
      assert(w.route.length > 40);
      assert(w.byId[w.startNode].neighbors.includes(w.nextNode));
      for (const n of w.nodes)
        assert(shortestPath(w, w.startNode, n.id).length > 0);
      for (let i = 1; i < w.route.ids.length; i++)
        assert(w.byId[w.route.ids[i - 1]].neighbors.includes(w.route.ids[i]));
      assert.equal(w.route.ids.at(-1), w.destination);
      if (type === "highway") {
        assert.equal(w.route.crossings.length, 0);
        assert(w.route.length > 900);
        assert(w.edges.every((e) => e.width === 25 && e.length >= 170));
      } else {
        assert(w.objects.some((o) => o.type === "stop_sign"));
        assert(w.objects.some((o) => o.type === "traffic_light"));
        assert(w.edges.every((e) => e.length >= 110));
        assert.equal(
          w.objects.some((o) => o.type === "building" && o.height > 30),
          type === "city",
        );
      }
    }
  assert.notDeepEqual(generateWorld(1).xs, generateWorld(2).xs);
  assert.deepEqual(generateWorld(42), generateWorld(42));
});

test("two physical axes steer, accelerate, brake and reverse without route snapping", () => {
  const v = { x: 0, z: 0, heading: 0, speed: 0, steering: 0 };
  for (let i = 0; i < 30; i++) physics(v, 0.5, 8, 0.05);
  assert(v.speed > 0);
  assert(v.heading > 0);
  assert(v.x > 0);
  assert(v.z < 0);
  for (let i = 0; i < 60; i++) physics(v, 0, -3, 0.05);
  assert.equal(v.speed, -3);
});

test("opposed signal phases never conflict and pedestrians get an all-red interval", () => {
  const n = generateWorld(42).nodes[1];
  for (let t = 0; t < 48; t += 0.1) {
    const a = signalState(n, t, 0),
      b = signalState(n, t, Math.PI / 2);
    assert(!(a.color === "green" && b.color === "green"));
    if (a.walk) {
      assert.equal(a.color, "red");
      assert.equal(b.color, "red");
    }
  }
});

test("stop signs require a stationary dwell and give the first arrival priority", () => {
  const s = new Simulation(42),
    v = s.player,
    c = v.route.crossings[0];
  v.s = c.stopS - 3;
  v.speed = 0;
  assert.equal(s.rule(v, true).mustStop, true);
  s.time += 1;
  assert.equal(s.rule(v, true).mustStop, true);
  s.time += 0.3;
  assert.equal(s.rule(v, true).stopCompleted, true);
  s.locks.set(c.nodeId, { id: "another-car", at: s.time });
  assert.equal(s.rule(v).mustStop, true);
});

test("visibility excludes objects behind the car and building-occluded objects", () => {
  const s = new Simulation(42);
  s.player.x = 0;
  s.player.z = 0;
  s.player.heading = 0;
  s.world.objects = [
    {
      id: "wall",
      type: "building",
      x: 0,
      z: -10,
      width: 8,
      depth: 4,
      height: 5,
    },
    { id: "hidden", type: "tree", x: 0, z: -20, height: 5 },
    { id: "behind", type: "tree", x: 0, z: 10, height: 5 },
    { id: "visible", type: "tree", x: 12, z: -20, height: 5 },
  ];
  s.traffic = [];
  s.pedestrians = [];
  const o = s.observation(true);
  assert(o.sensor.visible_objects.some((o) => o.id === "visible"));
  assert(
    !o.sensor.visible_objects.some(
      (o) => o.id === "hidden" || o.id === "behind",
    ),
  );
  assert(o.world.sensor_occluded_ids.includes("hidden"));
  assert(
    blockedByBuilding(
      { x: 0, z: 0 },
      { x: 0, z: -20 },
      s.world.objects.filter((o) => o.type === "building"),
    ),
  );
  const copy = JSON.parse(JSON.stringify(o));
  assert(copy.world.roads.length);
  assert(
    Object.values(copy.steering_candidates).some((v) =>
      Number.isFinite(v.steering),
    ),
  );
  assert.equal(copy.ego.position.y, 0.4);
});

test("pause freezes the entire simulation and reset clears arrival and contacts", () => {
  const s = new Simulation(42);
  s.paused = true;
  const before = JSON.stringify(s.observation(true));
  s.step(0.05);
  assert.equal(JSON.stringify(s.observation(true)), before);
  s.complete = true;
  s.freeExplore = true;
  s.collisions = 3;
  s.reset(3, "town");
  assert(!s.complete);
  assert(!s.freeExplore);
  assert.equal(s.collisions, 0);
  assert.equal(s.world.type, "town");
});

test("traffic yields at red/stop controls, stays below the limit, and continues moving", () => {
  for (const type of ["city", "town", "highway"])
    for (const seed of [1, 42, 501]) {
      const sim = new Simulation(seed, type);
      let traveled = 0,
        redCrossings = 0,
        stopCrossings = 0;
      for (let tick = 0; tick < 2400; tick++) {
        const before = sim.traffic.map((v) => ({
          id: v.id,
          s: v.s,
          route: v.route,
          rule: sim.rule(v),
          stop: sim.crossingFor(v),
          served: sim.rule(v).stopCompleted,
        }));
        sim.step(0.05);
        for (const v of sim.traffic) {
          assert(v.speed <= sim.world.theme.limit + 0.01);
          const b = before.find((o) => o.id === v.id);
          if (v.route !== b.route) continue;
          traveled += Math.max(0, v.s - b.s);
          if (b.stop && b.s < b.stop.stopS && v.s >= b.stop.stopS) {
            const node = sim.world.byId[b.stop.nodeId];
            if (
              node.control === "signal" &&
              signalState(node, sim.time, b.stop.approach).color === "red"
            )
              redCrossings++;
            if (node.control === "stop" && !v.stops[node.id]?.served)
              stopCrossings++;
          }
        }
      }
      assert(traveled > 100, `${type} ${seed}: stalled traffic`);
      assert.equal(
        redCrossings,
        0,
        `${type} ${seed}: traffic crossed a red light`,
      );
      assert.equal(
        stopCrossings,
        0,
        `${type} ${seed}: traffic missed a stop sign`,
      );
    }
});

test("pedestrian heading matches actual sidewalk and crossing movement", () => {
  const sim = new Simulation(42, "city");
  sim.step(0.05);
  for (let tick = 0; tick < 200; tick++) {
    const before = sim.pedestrians.map((p) => ({ ...p }));
    sim.step(0.05);
    sim.pedestrians.forEach((p, i) => {
      const previous = before[i];
      if (
        p.direction !== previous.direction ||
        !p.walking ||
        dist(p, previous) < 0.001
      )
        return;
      const movement = heading(previous, p);
      assert(
        Math.abs(
          Math.atan2(
            Math.sin(movement - p.heading),
            Math.cos(movement - p.heading),
          ),
        ) < 0.001,
      );
    });
  }
});

test("compact scene discovers only visible objects and refreshes when they move into view", () => {
  const sim = new Simulation(42);
  const v = sim.player;
  v.x = 0;
  v.z = 0;
  v.heading = 0;
  sim.world.objects = [];
  sim.pedestrians = [];
  sim.traffic = [
    { id: "test-car", type: "car", x: 0, z: 15, speed: 3, depth: 4 },
  ];
  sim.scanScene();
  assert(!sim.discovered.has("test-car"));
  sim.traffic[0].z = -25;
  sim.scanScene();
  assert(sim.discovered.has("test-car"));
  assert.equal(sim.decisionState().scene.nearby[0].ahead_m, 25);
  sim.traffic[0].z = -20;
  sim.scanScene();
  assert.equal(sim.decisionState().scene.nearby[0].ahead_m, 20);
  const real = new Simulation(42, "city");
  assert(
    JSON.stringify(real.decisionState()).length <
      JSON.stringify(real.observation(true)).length * 0.1,
  );
});

test("green signal releases a stopped car's speed constraint after the road clears", () => {
  const sim = new Simulation(42, "city"),
    v = sim.player;
  sim.traffic = [];
  sim.pedestrians = [];
  const crossing = v.route.crossings.find(
    (c) => sim.world.byId[c.nodeId].control === "signal",
  );
  v.s = crossing.stopS - 2;
  Object.assign(v, pointAt(v.route.points, v.s));
  v.heading = crossing.approach;
  let red, green;
  for (let t = 0; t < 25; t += 0.1) {
    sim.time = t;
    sim.scanScene();
    const state = sim.decisionState();
    if (sim.rule(v).color === "red") red = state;
    if (sim.rule(v).color === "green") green = state;
  }
  assert(red.speed_ceiling_mps < green.speed_ceiling_mps);
  assert.equal(green.scene.intersection.signal, "green");
  assert.equal(green.scene.intersection.must_yield, false);
  assert(green.speed_ceiling_mps >= 5);
});

test("destination safety braking stops a highway-speed car within the arrival radius", () => {
  const sim = new Simulation(7, "highway"),
    v = sim.player;
  sim.traffic = [];
  sim.autopilot = true;
  v.s = v.route.length - 100;
  Object.assign(v, pointAt(v.route.points, v.s));
  v.heading = heading(v, pointAt(v.route.points, v.s + 1));
  v.speed = 28;
  v.target = 28;
  for (let t = 0; t < 1000 && !sim.complete; t++) {
    const candidate = Object.entries(sim.steeringCandidates()).sort(
      (a, b) => a[1].tracking_error - b[1].tracking_error,
    )[0][1];
    v.steering = candidate.axis;
    sim.step(0.05);
  }
  assert(sim.complete);
  assert(dist(v, v.route.points.at(-1)) < 3);
  assert(v.speed < 1);
});
