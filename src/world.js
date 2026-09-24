import { rng, choose, dist, heading, move, samplePolyline } from "./math.js";
import { generateHighway, makeHighwayRoute } from "./highway.js";
export const THEMES = {
  city: {
    name: "Skyline City",
    subtitle: "Long avenues. A higher horizon.",
    size: 5,
    traffic: 28,
    buildings: 0.97,
    limit: 18,
  },
  town: {
    name: "Cedar Town",
    subtitle: "Room between the crossroads.",
    size: 5,
    traffic: 14,
    buildings: 0.62,
    limit: 14,
  },
  highway: {
    name: "Interstate 08",
    subtitle: "On-ramp, open road, small-town arrival.",
    size: 8,
    traffic: 18,
    buildings: 0,
    limit: 28,
    laneOffset: 9,
  },
};
export function generateWorld(seed, type = "town") {
  if (type === "highway") return generateHighway(seed, THEMES.highway);
  const r = rng(seed),
    theme = THEMES[type],
    n = theme.size,
    xs = [0],
    zs = [0];
  for (let i = 1; i < n; i++) {
    xs.push(xs.at(-1) + (type === "city" ? 125 : 110) + Math.floor(r() * 55));
    zs.push(zs.at(-1) + (type === "city" ? 125 : 110) + Math.floor(r() * 55));
  }
  const cx = xs.at(-1) / 2,
    cz = zs.at(-1) / 2;
  xs.forEach((v, i) => (xs[i] = v - cx));
  zs.forEach((v, i) => (zs[i] = v - cz));
  const nodes = [],
    edges = [],
    objects = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      nodes.push({
        id: `j${j}-${i}`,
        i,
        j,
        x: xs[i],
        z: zs[j],
        control: (i + j) % 3 === 0 ? "stop" : "signal",
        offset: Math.floor(r() * 14),
        neighbors: [],
      });
  const link = (a, b, customWidth = 20, customName = null) => {
    a.neighbors.push(b.id);
    b.neighbors.push(a.id);
    edges.push({
      id: `road-${edges.length}`,
      a: a.id,
      b: b.id,
      length: dist(a, b),
      width: customWidth,
      speedLimit: theme.limit,
      name:
        customName ||
        (choose(r, [
          "Cedar",
          "Maple",
          "Willow",
          "Juniper",
          "Oak",
          "Birch",
          "Laurel",
        ]) + choose(r, [" Street", " Avenue", " Way"])),
    });
  };
  // All horizontal streets and a vertical spine ensure connectivity; other links vary.
  for (const p of nodes) {
    if (p.i < n - 1) link(p, nodes[p.j * n + p.i + 1]);
    if (p.j < n - 1 && (p.i === 2 || r() > 0.16)) {
      if (!(p.i === 1 && p.j === 1)) {
        link(p, nodes[(p.j + 1) * n + p.i]);
      }
    }
  }

  // Explicit Fork Road (分岔路 / Y-Bifurcation):
  // The main avenue departing from startNode (j1-1) heads towards forkJunction,
  // then bifurcates into Northwest Expressway (forkLeft) and Downtown Boulevard (forkRight).
  const nodeStart = nodes[n + 1]; // j1-1
  const nodeNext = nodes[2 * n + 1]; // j2-1
  const forkZ = zs[1] + (zs[2] - zs[1]) * 0.44;
  const forkJunction = {
    id: "fork-junction",
    x: xs[1],
    z: forkZ,
    control: "none",
    offset: 0,
    neighbors: [],
    isFork: true,
  };
  const forkLeft = {
    id: "fork-left",
    x: xs[1] - 40,
    z: zs[2],
    control: "none",
    offset: 0,
    neighbors: [],
  };
  const forkRight = {
    id: "fork-right",
    x: xs[1] + 40,
    z: zs[2],
    control: "none",
    offset: 0,
    neighbors: [],
  };
  nodes.push(forkJunction, forkLeft, forkRight);

  // Link main avenue to fork, then fork to both branches:
  link(nodeStart, forkJunction, 20, "Grand Avenue · Fork Approach");
  link(forkJunction, forkLeft, 16, "Northwest Expressway ↖ (Airport)");
  link(forkJunction, forkRight, 16, "Downtown Boulevard ↗ (CBD)");

  // Connect branches onward to the city grid:
  link(forkLeft, nodes[2 * n + 0], 20, "West Ring Road"); // j2-0
  link(forkLeft, nodeNext, 20, "Central Spine Avenue"); // j2-1
  if (n > 3) link(forkLeft, nodes[3 * n + 1], 20, "North Highway"); // j3-1

  link(forkRight, nodes[2 * n + 2], 20, "East Business Parkway"); // j2-2
  link(forkRight, nodeNext, 20, "Central Spine Avenue"); // j2-1
  if (n > 3) link(forkRight, nodes[3 * n + 2], 20, "East Outer Loop"); // j3-2

  let id = 0;
  const add = (type, x, z, props = {}) =>
    objects.push({ id: `${type}-${id++}`, type, x, z, ...props });

  // Add specialized 3D objects for the Fork Road
  add("fork_gantry", xs[1], forkZ - 22, {
    approach: 0,
    leftText: "AIRPORT EXPWY ↖",
    leftSub: "机场快速路 · 科技城",
    rightText: "DOWNTOWN CBD ↗",
    rightSub: "中心商务区 · 金融街",
  });
  add("fork_gore", xs[1], forkZ + 8, {
    leftTarget: { x: forkLeft.x, z: forkLeft.z },
    rightTarget: { x: forkRight.x, z: forkRight.z },
    length: 34,
    width: 15,
  });
  add("crash_barrels", xs[1], forkZ + 8, {
    count: 4,
  });
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const x = (xs[i] + xs[i + 1]) / 2,
        z = (zs[j] + zs[j + 1]) / 2,
        w = xs[i + 1] - xs[i],
        d = zs[j + 1] - zs[j],
        park = r() > theme.buildings;
      add("parcel", x, z, { width: w - 26, depth: d - 26, park });
      for (const dx of [-1, 1])
        for (const dz of [-1, 1]) {
          const bx = x + dx * (w / 2 - 26),
            bz = z + dz * (d / 2 - 26);
          if (!park) {
            const style =
              type === "city"
                ? choose(r, ["skyscraper", "skyscraper", "apartment", "shop"])
                : choose(r, ["cottage", "cottage", "modern", "townhouse"]);
            add("building", bx, bz, {
              style,
              width: (type === "city" ? 15 : 10) + r() * 2,
              depth: (type === "city" ? 15 : 10) + r() * 2,
              height:
                style === "skyscraper"
                  ? 34 + r() * 58
                  : style === "apartment"
                    ? 18 + r() * 12
                    : style === "townhouse"
                      ? 8
                      : 4 + r() * 2,
              color: choose(r, [
                "#eadbc9",
                "#e6ad91",
                "#d9e2ce",
                "#e5c977",
                "#bdd3d0",
                "#ebd9ad",
              ]),
              roof: choose(r, ["#697577", "#a26f58", "#536d65"]),
              rotation: dz < 0 ? Math.PI : 0,
            });
          } else
            add("tree", bx, bz, {
              height: 5 + r() * 4,
              kind: r() > 0.4 ? "round" : "pine",
            });
        }
      if (!park) {
        for (const axis of ["x", "z"]) {
          const length = axis === "x" ? w : d;
          for (let t = -length / 2 + 42; t < length / 2 - 32; t += 26) {
            for (const side of [-1, 1]) {
              const bx = axis === "x" ? x + t : x + side * (w / 2 - 26);
              const bz = axis === "z" ? z + t : z + side * (d / 2 - 26);
              const style =
                type === "city"
                  ? choose(r, ["skyscraper", "skyscraper", "apartment"])
                  : choose(r, ["cottage", "modern"]);
              add("building", bx, bz, {
                style,
                width: (type === "city" ? 15 : 10) + r() * 2,
                depth: (type === "city" ? 15 : 10) + r() * 2,
                height:
                  style === "skyscraper"
                    ? 32 + r() * 65
                    : style === "apartment"
                      ? 18 + r() * 12
                      : 5 + r() * 3,
                color: choose(r, [
                  "#eadbc9",
                  "#d9e2ce",
                  "#e6ad91",
                  "#bdd3d0",
                  "#ebd9ad",
                ]),
                roof: choose(r, ["#697577", "#a26f58", "#536d65"]),
                rotation:
                  axis === "x"
                    ? side < 0
                      ? Math.PI
                      : 0
                    : side < 0
                      ? -Math.PI / 2
                      : Math.PI / 2,
              });
            }
          }
        }
      }
      for (let k = 0; k < (park ? 22 : 12); k++)
        add("tree", x + (r() - 0.5) * (w - 30), z + (r() - 0.5) * (d - 30), {
          height: 4 + r() * 5,
          kind: r() > 0.3 ? "round" : "pine",
        });
      if (park) add("bench", x, z, { rotation: 0 });
    }
  // Tree-lined outer boundary.
  for (let k = 0; k < 65; k++) {
    const side = k % 4;
    add(
      "tree",
      side < 2
        ? side === 0
          ? xs[0] - 22
          : xs.at(-1) + 22
        : xs[0] + r() * (xs.at(-1) - xs[0]),
      side >= 2
        ? side === 2
          ? zs[0] - 22
          : zs.at(-1) + 22
        : zs[0] + r() * (zs.at(-1) - zs[0]),
      { height: 5 + r() * 7, kind: choose(r, ["round", "pine"]) },
    );
  }
  const byId = Object.fromEntries(nodes.map((v) => [v.id, v]));
  for (const node of nodes)
    for (const nid of node.neighbors) {
      if (node.control === "none") continue;
      const other = byId[nid],
        h = heading(other, node),
        p = move(move(node, h, -12), h + Math.PI / 2, 10.8);
      add(node.control === "stop" ? "stop_sign" : "traffic_light", p.x, p.z, {
        nodeId: node.id,
        approach: h,
        height: node.control === "stop" ? 2.8 : 4.8,
      });
    }
  const startNode = nodes[n + 1],
    nextNode = forkJunction;
  // A random destination on the far half of the graph, always reachable.
  const destination = choose(
    r,
    nodes.filter((p) => p.i >= n - 2 && p.j >= 1 && p.j < n - 1),
  );
  const glassColors = ["#8aa4ac", "#829eaa", "#749699", "#a4bab9"];
  objects
    .filter((o) => o.style === "skyscraper")
    .forEach((o, i) => (o.color = glassColors[i % glassColors.length]));
  const buildings = objects.filter((o) => o.type === "building");
  const distToEdge = (b, e) => {
    const a = byId[e.a], c = byId[e.b];
    if (!a || !c) return Infinity;
    const dx = c.x - a.x, dz = c.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (!l2) return dist(b, a);
    const t = Math.max(0, Math.min(1, ((b.x - a.x) * dx + (b.z - a.z) * dz) / l2));
    return Math.hypot(b.x - (a.x + t * dx), b.z - (a.z + t * dz));
  };
  const clearObjects = objects.filter(
    (o) => {
      if (o.type === "building" || o.type === "tree") {
        for (const e of edges) {
          const buffer = o.type === "building" ? Math.max(o.width, o.depth) / 2 + 2.0 : 2.5;
          if (distToEdge(o, e) < e.width / 2 + buffer) return false;
        }
      }
      return (
        o.type !== "tree" ||
        !buildings.some(
          (b) =>
            Math.abs(o.x - b.x) < b.width / 2 + 1.8 &&
            Math.abs(o.z - b.z) < b.depth / 2 + 1.8,
        )
      );
    },
  );
  const world = {
    seed,
    type,
    theme,
    nodes,
    byId,
    edges,
    objects: clearObjects,
    xs,
    zs,
    bounds: {
      minX: xs[0] - 28,
      maxX: xs.at(-1) + 28,
      minZ: zs[0] - 28,
      maxZ: zs.at(-1) + 28,
    },
    startNode: startNode.id,
    nextNode: nextNode.id,
    destination: destination.id,
  };
  world.route = makeRoute(world, [
    startNode.id,
    ...shortestPath(world, nextNode.id, destination.id, startNode.id),
  ]);
  return world;
}
export function shortestPath(world, start, end, previousNode = null) {
  const cost = { [start]: 0 },
    prev = {},
    todo = new Set(world.nodes.map((p) => p.id));
  while (todo.size) {
    let u;
    for (const id of todo)
      if (u === undefined || (cost[id] ?? Infinity) < (cost[u] ?? Infinity))
        u = id;
    if (u === end) break;
    todo.delete(u);
    for (const v of world.byId[u].neighbors) {
      // Preserve the incoming direction when planning a new trip. The remaining
      // shortest path has no backtracking, so the initial route has no U-turns.
      if (u === start && v === previousNode) continue;
      const c = cost[u] + dist(world.byId[u], world.byId[v]);
      if (c < (cost[v] ?? Infinity)) {
        cost[v] = c;
        prev[v] = u;
      }
    }
  }
  const route = [end];
  while (route[0] !== start) {
    if (!prev[route[0]]) throw Error("Unreachable destination");
    route.unshift(prev[route[0]]);
  }
  return route;
}
export function makeForkRoute(world, branchChoice) {
  const branchId = branchChoice === "right" ? "fork-right" : "fork-left";
  const startId = world.startNode;
  const forkId = "fork-junction";
  if (!world.byId[forkId] || !world.byId[branchId]) {
    return world.route;
  }
  const continuation = shortestPath(world, branchId, world.destination, forkId);
  return makeRoute(world, [startId, forkId, ...continuation]);
}
export function makeRoute(world, ids, laneOffset) {
  if (world.type === "highway") return makeHighwayRoute(world, ids, laneOffset);
  const raw = [],
    crossings = [];
  const nodes = ids.map((id) => world.byId[id]);
  const offset = (p, h) => move(p, h + Math.PI / 2, 4.8);
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i],
      hin = heading(nodes[Math.max(0, i - 1)], nodes[i === 0 ? 1 : i]),
      hout = i < nodes.length - 1 ? heading(p, nodes[i + 1]) : hin;
    if (i === 0) {
      raw.push(move(offset(p, hout), hout, 14));
      continue;
    }
    if (i === nodes.length - 1) {
      raw.push(move(offset(p, hin), hin, -15));
      continue;
    }
    const a = move(offset(p, hin), hin, -11),
      b = move(offset(p, hout), hout, 11);
    raw.push(a);
    if (Math.cos(hout - hin) < -0.99) {
      // Dead-end traffic makes a continuous turn into the opposite lane.
      const center = move(p, hin, -11);
      for (let k = 1; k <= 24; k++) {
        const theta = (k / 24) * Math.PI;
        raw.push(
          move(
            move(center, hin, Math.sin(theta) * 4.8),
            hin + Math.PI / 2,
            Math.cos(theta) * 4.8,
          ),
        );
      }
    } else if (Math.abs(Math.sin(hout - hin)) < 0.08) {
      raw.push(b);
    } else {
      // Analytical quadratic bezier control point for arbitrary turn angle!
      const sinDiff = Math.sin(hout - hin);
      let c = null;
      if (Math.abs(sinDiff) > 0.05) {
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const t = (dx * Math.cos(hout) + dz * Math.sin(hout)) / sinDiff;
        if (t > 0 && t < 45) {
          c = { x: a.x + t * Math.sin(hin), z: a.z - t * Math.cos(hin) };
        }
      }
      if (!c) {
        c =
          Math.abs(Math.sin(hin)) > 0.5
            ? { x: b.x, z: a.z }
            : { x: a.x, z: b.z };
      }
      for (let k = 1; k <= 16; k++) {
        const t = k / 16,
          u = 1 - t;
        raw.push({
          x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
          z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
        });
      }
    }
    if (p.control !== "none") {
      crossings.push({
        nodeId: p.id,
        x: p.x,
        z: p.z,
        approach: hin,
        exit: hout,
      });
    }
  }
  const points = samplePolyline(raw);
  for (const c of crossings) {
    const target = move(offset(c, c.approach), c.approach, -10.5);
    let best = Infinity;
    for (const p of points) {
      const d = dist(p, target);
      if (d < best) {
        best = d;
        c.stopS = p.s;
      }
    }
  }
  return { ids, points, crossings, length: points.at(-1).s };
}
export function signalState(node, time, approach) {
  const phase = (time + node.offset) % 24,
    ns = Math.abs(Math.cos(approach)) > 0.5;
  if (phase >= 20) return { color: "red", walk: true, remaining: 24 - phase };
  if (ns)
    return {
      color: phase < 8 ? "green" : phase < 10 ? "amber" : "red",
      walk: false,
      remaining: phase < 8 ? 8 - phase : phase < 10 ? 10 - phase : 24 - phase,
    };
  return {
    color: phase >= 10 && phase < 18 ? "green" : phase >= 18 ? "amber" : "red",
    walk: false,
    remaining: phase < 10 ? 10 - phase : phase < 18 ? 18 - phase : 20 - phase,
  };
}
