import { dist, heading, pointAt } from "./math.js";
import { maneuverSteering, physics } from "./planning.js";
import { firstCollision } from "./collisions.js";

// A stopped queue can take turns through a clear gap instead of yielding forever.
// Check the swept car body, not just the generous normal following-distance buffer.
function clearCreep(sim, vehicle) {
  const ghost = {
    ...vehicle,
    width: vehicle.width + 0.5,
    depth: vehicle.depth + 0.5,
  };
  const obstacles = [
    ...sim.traffic,
    sim.player,
    ...sim.pedestrians,
    ...sim.world.objects.filter((o) => o.type === "building"),
  ]
    .filter(
      (o) =>
        o.id !== vehicle.id &&
        dist(vehicle, o) < 16 + Math.hypot(o.width || 0, o.depth || 0) / 2,
    )
    .map((object) => ({ object }));
  const candidate = { lane_offset_m: 0, lookahead_m: 4.5 };
  for (let i = 1; i <= 30; i++) {
    const before = { ...ghost };
    if (vehicle === sim.player)
      physics(ghost, maneuverSteering(ghost, candidate), 1.5, 0.1);
    else {
      const p = pointAt(vehicle.route.points, vehicle.s + i * 0.15);
      const next = pointAt(vehicle.route.points, vehicle.s + i * 0.15 + 0.2);
      Object.assign(ghost, p, { heading: heading(p, next) });
    }
    if (firstCollision(before, ghost, obstacles)) return false;
  }
  return true;
}

export function updateCourtesy(sim) {
  const cars = [sim.player, ...sim.traffic];
  for (const v of cars)
    v.waitingSince =
      Math.abs(v.speed) < 0.2 ? (v.waitingSince ?? sim.time) : null;
  if (sim.time < sim.nextCourtesy) return;
  sim.nextCourtesy = sim.time + 0.5;
  for (const [nodeId, grant] of sim.courtesy) {
    const car = cars.find((v) => v.id === grant.id),
      node = sim.world.byId[nodeId];
    if (
      !car ||
      sim.time - grant.at > 12 ||
      dist(car, node) > 22 ||
      !clearCreep(sim, car)
    )
      sim.courtesy.delete(nodeId);
  }
  for (const node of sim.world.nodes) {
    if (node.control !== "stop" || sim.courtesy.has(node.id)) continue;
    const nearby = cars.filter((v) => dist(v, node) < 24);
    if (nearby.length < 2 || nearby.some((v) => Math.abs(v.speed) > 0.2))
      continue;
    if (
      sim.pedestrians.some((p) => dist(p, node) < 13 && p.crossing && p.walking)
    )
      continue;
    const waiting = nearby
      .filter(
        (v) =>
          (v !== sim.player || sim.autopilot) &&
          v.waitingSince !== null &&
          sim.time - v.waitingSince >= 4 &&
          v.stops[node.id]?.served &&
          sim.crossingFor(v)?.nodeId === node.id,
      )
      .sort(
        (a, b) =>
          a.stops[node.id].arrived - b.stops[node.id].arrived ||
          a.id.localeCompare(b.id),
      );
    const winner = waiting.find((v) => clearCreep(sim, v));
    if (winner) {
      sim.courtesy.set(node.id, { id: winner.id, at: sim.time });
      sim.locks.set(node.id, { id: winner.id, at: sim.time });
      if (winner === sim.player)
        sim.event("Traffic is stopped — taking a clear gap at walking speed");
    }
  }
}
