import test from "node:test";
import assert from "node:assert/strict";
import { pedalPhysics, physics } from "../src/planning.js";
import { Simulation } from "../src/simulation.js";
import { collisionPose } from "../src/collisions.js";
import { footprintClearance } from "../src/traffic-safety.js";
import { dist, pointAt, heading } from "../src/math.js";

const vehicle = (speed = 0) => ({ x: 0, z: 0, heading: 0, speed });
test("released accelerator coasts down, brakes stop faster, and autopilot holds its target", () => {
  const car = vehicle();
  for (let i = 0; i < 200; i++) pedalPhysics(car, 0, 1, 0, 0.025);
  assert(car.speed > 20);
  const coast = { ...car },
    braking = { ...car },
    auto = { ...car };
  for (let i = 0; i < 80; i++) {
    pedalPhysics(coast, 0, 0, 0, 0.025);
    pedalPhysics(braking, 0, 0, 1, 0.025);
    physics(auto, 0, car.speed, 0.025);
  }
  assert(coast.speed < car.speed - 1);
  assert(coast.speed > car.speed * 0.8);
  assert(braking.speed < 2);
  assert.equal(auto.speed, car.speed);
});
test("pedal release never reverses a stopped car and reverse brakes forward motion first", () => {
  const car = vehicle(4);
  pedalPhysics(car, 0, -1, 0, 0.05);
  assert(car.speed >= 0);
  for (let i = 0; i < 100; i++) pedalPhysics(car, 0, -1, 0, 0.05);
  assert(car.speed < 0 && car.speed >= -3);
  for (let i = 0; i < 200; i++) pedalPhysics(car, 0, 0, 0, 0.05);
  assert.equal(car.speed, 0);
});
test("brief steering taps make small corrections at road speeds and recenter after release", () => {
  for (const kmh of [10, 30, 65, 100]) {
    const car = vehicle(kmh / 3.6);
    for (let i = 0; i < 12; i++) pedalPhysics(car, 1, 0, 0, 0.0125);
    const pressed = car.steering;
    for (let i = 0; i < 48; i++) pedalPhysics(car, 0, 0, 0, 0.0125);
    assert(car.x > 0 && car.x < 0.2, `${kmh} km/h tap should stay within 20cm`);
    assert(car.heading > 0 && car.heading < (2 * Math.PI) / 180);
    assert(Math.abs(car.steering) < pressed * 0.01);
  }
});
test("held steering preserves parking turns and builds into sharp highway turns", () => {
  const parking = vehicle(1);
  for (let i = 0; i < 120; i++) {
    parking.speed = 1;
    pedalPhysics(parking, 1, 0, 0, 1 / 60);
  }
  const parkingRadius = 2.7 / Math.tan(parking.steering * 0.58);
  assert(parkingRadius > 3.5 && parkingRadius < 6);
  for (const kmh of [65, 100, 120]) {
    const car = vehicle(kmh / 3.6);
    let tapSteering;
    for (let i = 0; i < 120; i++) {
      // Hold speed constant to measure steering independently of pedal drag.
      car.speed = kmh / 3.6;
      pedalPhysics(car, 1, 0, 0, 1 / 120);
      if (i === 17) tapSteering = car.steering;
    }
    assert(
      car.steering > tapSteering * 8,
      "holding must unlock a much sharper turn",
    );
    assert(
      car.heading > (20 * Math.PI) / 180 && car.heading < (40 * Math.PI) / 180,
    );
    for (let i = 0; i < 30; i++) pedalPhysics(car, 0, 0, 0, 1 / 120);
    assert.equal(car.steering, 0, "release must recenter within 250ms");
  }
});
test("progressive steering countersteers promptly and behaves consistently across frame rates", () => {
  const drive = (hz, direction = 1) => {
    const car = vehicle(25);
    for (let i = 0; i < hz; i++) pedalPhysics(car, direction, 0, 0, 1 / hz);
    return car;
  };
  const slowFrames = drive(30),
    fastFrames = drive(120),
    left = drive(120, -1);
  assert(Math.abs(slowFrames.heading - fastFrames.heading) < 0.03);
  assert(Math.abs(slowFrames.x - fastFrames.x) < 0.5);
  assert(Math.abs(left.heading + fastFrames.heading) < 0.000001);
  for (let i = 0; i < 36; i++) pedalPhysics(fastFrames, -1, 0, 0, 1 / 60);
  assert(
    fastFrames.steering < -0.04,
    "opposite input must not inherit the old turn",
  );
});
test("sidewalk pedestrians remain clear of rotated buildings over their complete paths", () => {
  for (const type of ["town", "city"])
    for (const seed of [1, 42, 501, 406772]) {
      const sim = new Simulation(seed, type);
      const buildings = sim.world.objects
        .filter((o) => o.type === "building")
        .map(collisionPose);
      for (const pedestrian of sim.pedestrians.filter((p) => !p.crossing)) {
        const path = pedestrian.walkPath;
        for (let s = 0; s <= path.length; s += 0.5) {
          const pose = {
            ...pedestrian,
            x: path.start.x + Math.sin(path.heading) * s,
            z: path.start.z - Math.cos(path.heading) * s,
            heading: path.heading,
          };
          for (const building of buildings)
            assert(
              footprintClearance(pose, building) > 0.1,
              `${type} ${seed}: ${pedestrian.id} enters a wall`,
            );
        }
      }
    }
});
test("visible town traffic extends its route without relocating the vehicle", () => {
  const sim = new Simulation(42, "city"),
    car = sim.traffic[1];
  car.s = car.route.length - 55;
  const point = pointAt(car.route.points, car.s),
    next = pointAt(car.route.points, car.s + 1);
  Object.assign(car, point, { heading: heading(point, next) });
  const before = { ...car },
    oldRoute = car.route;
  sim.continueTraffic(car);
  assert.notEqual(car.route, oldRoute);
  assert.equal(dist(car, before), 0);
  assert(dist(car, pointAt(car.route.points, car.s)) < 0.01);
  assert(car.route.length - car.s > 300);
});
