import { makeRoute, shortestPath } from "./world.js";
import {
  angle,
  blockedByBuilding,
  dist,
  nearestOnPath,
  pointAt,
} from "./math.js";

function pathAvoiding(world, start, end, avoid) {
  const costs = new Map([[start, 0]]),
    previous = new Map();
  const pending = new Set(
    world.nodes
      .map((n) => n.id)
      .filter((id) => id !== avoid || id === start || id === end),
  );
  while (pending.size) {
    const id = [...pending].reduce((a, b) =>
      (costs.get(a) ?? Infinity) < (costs.get(b) ?? Infinity) ? a : b,
    );
    if (!Number.isFinite(costs.get(id))) return null;
    if (id === end) {
      const path = [end];
      while (path[0] !== start) path.unshift(previous.get(path[0]));
      return path;
    }
    pending.delete(id);
    for (const next of world.byId[id].neighbors) {
      if (!pending.has(next)) continue;
      const cost = costs.get(id) + dist(world.byId[id], world.byId[next]);
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost);
        previous.set(next, id);
      }
    }
  }
  return null;
}

// Join a nearby lane, then offer different streets that still reach the original
// destination approach after a substantial departure from the current route.
export function routesFromLocation(
  world,
  car,
  destinationApproach,
  destinationPoint,
) {
  const [approach, destination] = destinationApproach;
  const buildings = world.objects.filter((o) => o.type === "building");
  const edges = world.edges
    .map((edge) => {
      const a = world.byId[edge.a],
        b = world.byId[edge.b];
      const near = nearestOnPath(
        car,
        edge.path ?? [
          { ...a, s: 0 },
          { ...b, s: dist(a, b) },
        ],
      );
      return { edge, distance: near.distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6);
  const candidates = [],
    seen = new Set();
  for (const { edge } of edges) {
    for (const [a, b] of edge.oneWay
      ? [[edge.a, edge.b]]
      : [
          [edge.a, edge.b],
          [edge.b, edge.a],
        ]) {
      let initial;
      try {
        initial =
          a === approach && b === destination
            ? [a, b]
            : [a, ...shortestPath(world, b, approach), destination];
      } catch {
        continue; // A one-way ramp cannot be used to return against traffic.
      }
      const paths = [initial];
      if (b !== destination && b !== approach) {
        for (const exit of world.byId[b].neighbors.filter((id) => id !== a)) {
          const onward = pathAvoiding(world, exit, approach, b);
          if (onward) paths.push([a, b, ...onward, destination]);
        }
      }
      for (const ids of paths) {
        if (seen.has(ids.join(","))) continue;
        seen.add(ids.join(","));
        const route = makeRoute(world, ids);
        const entryEnd = route.crossings[0]?.stopS + 17;
        const entry = Number.isFinite(entryEnd)
          ? route.points.filter((p) => p.s <= entryEnd)
          : route.points;
        if (entry.length < 2) continue;
        const near = nearestOnPath(car, entry);
        const relativeHeading = angle(near.heading - car.heading);
        const score =
          near.distance * 5 +
          Math.abs(relativeHeading) * 9 +
          (route.length - near.s) * 0.025 +
          (blockedByBuilding(car, near, buildings) ? 80 : 0);
        const start = Math.max(0, near.s - 3);
        route.points = [
          pointAt(route.points, start),
          ...route.points.filter((p) => p.s > start),
        ].map((p) => ({ ...p, s: p.s - start }));
        route.crossings = route.crossings
          .filter((c) => c.stopS >= start - 19)
          .map((c) => ({ ...c, stopS: c.stopS - start }));
        route.length -= start;
        if (route.sections)
          route.sections = route.sections
            .filter((section) => section.endS > start)
            .map((section) => ({
              ...section,
              startS: Math.max(0, section.startS - start),
              endS: section.endS - start,
            }));
        if (
          destinationPoint &&
          dist(route.points.at(-1), destinationPoint) > 0.01
        ) {
          route.length += dist(route.points.at(-1), destinationPoint);
          route.points.push({ ...destinationPoint, s: route.length });
        }
        candidates.push({
          route,
          progress: near.s - start,
          distance: near.distance,
          relativeHeading,
          score,
        });
      }
    }
  }
  return candidates.sort((a, b) => a.score - b.score);
}

export function routeFromLocation(
  world,
  car,
  destinationApproach,
  destinationPoint,
) {
  return (
    routesFromLocation(world, car, destinationApproach, destinationPoint)[0] ??
    null
  );
}
