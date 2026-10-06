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
  alpine: {
    name: "Alpine Passage",
    subtitle: "Four seasons on one mountain pass. Every mile leads home.",
    size: 7,
    traffic: 5,
    buildings: 0,
    limit: 5,
    laneOffset: 0.32,
  },
};
export function generateWorld(seed, type = "town") {
  if (type === "highway") return generateHighway(seed, THEMES.highway);
  if (type === "alpine") return generateAlpine(seed, THEMES.alpine);
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

  // Add specialized 3D objects for the Fork Road (分岔路 / Y型分流)
  add("fork_gantry", xs[1], forkZ - 24, {
    approach: 0,
    leftText: "AIRPORT EXPWY ↖",
    leftSub: "机场快速路 · 科技城",
    rightText: "DOWNTOWN CBD ↗",
    rightSub: "中心商务区 · 金融街",
  });
  add("fork_gore", xs[1], forkZ + 20, {
    leftTarget: { x: forkLeft.x, z: forkLeft.z },
    rightTarget: { x: forkRight.x, z: forkRight.z },
    length: 34,
    width: 15,
  });
  add("crash_barrels", xs[1], forkZ + 26, {
    count: 6,
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
      if (o.type === "building" || o.type === "tree" || o.type === "stop_sign" || o.type === "traffic_light" || o.type === "bench") {
        for (const e of edges) {
          const buffer = o.type === "building" 
            ? Math.max(o.width, o.depth) / 2 + 2.0 
            : (o.type === "tree" ? 2.5 : 0.6);
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
  const isAlpine = world.type === "alpine";

  if (isAlpine) {
    const lOffset = laneOffset ?? world.theme?.laneOffset ?? 0.28;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      if (!p) continue;
      const prev = nodes[Math.max(0, i - 1)] || p;
      const next = nodes[Math.min(nodes.length - 1, i + 1)] || p;
      const dInX = p.x - prev.x, dInZ = p.z - prev.z;
      const lIn = Math.hypot(dInX, dInZ) || 1;
      const vinX = dInX / lIn, vinZ = dInZ / lIn;

      const dOutX = next.x - p.x, dOutZ = next.z - p.z;
      const lOut = Math.hypot(dOutX, dOutZ) || 1;
      const voutX = dOutX / lOut, voutZ = dOutZ / lOut;

      let tX = vinX + voutX, tZ = vinZ + voutZ;
      const tLen = Math.hypot(tX, tZ) || 1;
      tX /= tLen; tZ /= tLen;

      // Right normal to bisector tangent: (-tZ, tX)
      raw.push({
        x: p.x - tZ * lOffset,
        z: p.z + tX * lOffset,
      });

      if (p.control !== "none") {
        crossings.push({
          nodeId: p.id,
          x: p.x,
          z: p.z,
          approach: heading(prev, p),
          exit: heading(p, next),
        });
      }
    }
    const points = samplePolyline(raw, 0.25);
    for (const c of crossings) {
      const target = move(c, c.approach, -10.5);
      let best = Infinity;
      for (const pt of points) {
        const d = dist(pt, target);
        if (d < best) {
          best = d;
          c.stopS = pt.s;
        }
      }
    }
    const sections = [{
      kind: "alpine",
      name: "Alpine Pass Road",
      startS: 0,
      endS: points.at(-1)?.s || 0,
      speedLimit: world.theme?.limit || 5,
      laneHalfWidth: 0.65,
    }];
    return { ids, points, crossings, sections, length: points.at(-1)?.s || 0 };
  }

  const lOffset = laneOffset ?? world.theme?.laneOffset ?? 4.8;
  const offset = (p, h) => move(p, h + Math.PI / 2, lOffset);
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i],
      hin = heading(nodes[Math.max(0, i - 1)], nodes[i === 0 ? 1 : i]),
      hout = i < nodes.length - 1 ? heading(p, nodes[i + 1]) : hin;
    const dPrev = dist(nodes[Math.max(0, i - 1)], p);
    const dNext = i < nodes.length - 1 ? dist(p, nodes[i + 1]) : dPrev;
    const startLead = Math.min(isAlpine ? 0.2 : 14, dNext * 0.35);
    const endLead = Math.min(isAlpine ? 0.2 : 15, dPrev * 0.35);
    if (i === 0) {
      raw.push(move(offset(p, hout), hout, startLead));
      continue;
    }
    if (i === nodes.length - 1) {
      raw.push(move(offset(p, hin), hin, -endLead));
      continue;
    }
    const leadIn = Math.min(isAlpine ? 0.25 : 11, dPrev * 0.35),
      leadOut = Math.min(isAlpine ? 0.25 : 11, dNext * 0.35);
    const a = move(offset(p, hin), hin, -leadIn),
      b = move(offset(p, hout), hout, leadOut);
    raw.push(a);
    if (Math.cos(hout - hin) < -0.99) {
      // Dead-end traffic makes a continuous turn into the opposite lane.
      const center = move(p, hin, -leadIn);
      const rTurn = isAlpine ? lOffset : 4.8;
      for (let k = 1; k <= 24; k++) {
        const theta = (k / 24) * Math.PI;
        raw.push(
          move(
            move(center, hin, Math.sin(theta) * rTurn),
            hin + Math.PI / 2,
            Math.cos(theta) * rTurn,
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
        const t = -(dx * Math.cos(hout) + dz * Math.sin(hout)) / sinDiff;
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
  const points = samplePolyline(raw, isAlpine ? 0.25 : 1);
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

export function generateAlpine(seed, theme) {
  const nodes = [
    { id: "alp-0", x: -6.0, z: -6.0, control: "none", offset: 0, neighbors: [] },
    { id: "alp-1", x: -4.0, z: -4.0, control: "none", offset: 0, neighbors: [] },
    { id: "alp-2", x: -2.2, z: -2.2, control: "none", offset: 0, neighbors: [] },
    { id: "alp-3", x: -0.72, z: -0.72, control: "none", offset: 0, neighbors: [] },
    { id: "alp-4", x: 1.2, z: 1.2, control: "none", offset: 0, neighbors: [] },
    { id: "alp-5", x: 3.6, z: 3.6, control: "none", offset: 0, neighbors: [] },
    { id: "alp-6", x: 5.6, z: 5.6, control: "none", offset: 0, neighbors: [] },
    { id: "alp-7", x: 7.5, z: 7.5, control: "none", offset: 0, neighbors: [] },
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [];

  const link = (aId, bId, name = "Alpine Pass Road", width = 1.4) => {
    const a = byId[aId], b = byId[bId];
    if (!a.neighbors.includes(bId)) a.neighbors.push(bId);
    if (!b.neighbors.includes(aId)) b.neighbors.push(aId);
    edges.push({
      id: `road-${edges.length}`,
      a: aId,
      b: bId,
      length: dist(a, b),
      width,
      speedLimit: theme.limit,
      name,
    });
  };

  // Main Mountain Pass Ridge (crossing stone arch bridge over mountain stream)
  link("alp-0", "alp-1", "Alpine Pass · Valley Approach", 1.4);
  link("alp-1", "alp-2", "Alpine Pass · Pine Forest", 1.4);
  link("alp-2", "alp-3", "Alpine Pass · Stream Viaduct", 1.4);
  link("alp-3", "alp-4", "Alpine Pass · Stone Arch Bridge", 1.4);
  link("alp-4", "alp-5", "Alpine Pass · Chalet Plateau", 1.4);
  link("alp-5", "alp-6", "Alpine Pass · Matterhorn Summit", 1.4);
  link("alp-6", "alp-7", "Alpine Pass · Boundary Crossing", 1.4);
  // Stamp correct laneHalfWidth on every initial edge
  for (const e of edges) e.laneHalfWidth = e.width / 2;

  const objects = [];
  const world = {
    seed,
    type: "alpine",
    theme,
    nodes,
    byId,
    edges,
    objects,
    xs: [-7.5, 7.5],
    zs: [-7.5, 7.5],
    bounds: { minX: -8.0, maxX: 8.0, minZ: -8.0, maxZ: 8.0 },
    startNode: "alp-0",
    nextNode: "alp-1",
    destination: "alp-7",
    alpineLegCount: 0,
  };

  const routeIds = [
    "alp-0",
    "alp-1",
    "alp-2",
    "alp-3",
    "alp-4",
    "alp-5",
    "alp-6",
    "alp-7",
  ];

  // Pre-generate initial scenic legs extending out into surrounding alpine chunks
  let curDestNode = world.byId["alp-7"];
  for (let l = 1; l <= 3; l++) {
    const ext = extendAlpineWorld(world, curDestNode, Math.random, l % 2 === 0 ? "right" : "left");
    if (ext && ext.pathIds) {
      routeIds.push(...ext.pathIds.slice(1));
      curDestNode = world.byId[ext.destinationId];
      world.destination = ext.destinationId;
    }
  }

  world.route = makeRoute(world, routeIds);

  return world;
}

export function extendAlpineWorld(world, fromNode, r = Math.random, branchChoice = "left") {
  world.alpineLegCount = (world.alpineLegCount || 0) + 1;
  const legIdx = world.alpineLegCount;

  // Find predecessor node along incoming route to determine incoming heading
  let prevNode = null;
  if (world.route?.ids) {
    const idx = world.route.ids.lastIndexOf(fromNode.id);
    if (idx > 0) prevNode = world.byId[world.route.ids[idx - 1]];
  }
  if (!prevNode && fromNode.neighbors.length > 0) {
    prevNode = world.byId[fromNode.neighbors[0]];
  }
  const h0 = prevNode ? heading(prevNode, fromNode) : Math.PI / 4;

  const link = (aId, bId, name = "Alpine Pass Road", width = 1.4) => {
    const a = world.byId[aId], b = world.byId[bId];
    if (!a || !b) return;
    if (!a.neighbors.includes(bId)) a.neighbors.push(bId);
    if (!b.neighbors.includes(aId)) b.neighbors.push(aId);
    world.edges.push({
      id: `road-alp-${world.edges.length}`,
      a: aId,
      b: bId,
      length: dist(a, b),
      width,
      laneHalfWidth: width / 2,
      speedLimit: world.theme?.limit || 5,
      name,
    });
  };

  const addNode = (id, x, z, control = "none") => {
    const node = { id, x, z, control, offset: 0, neighbors: [] };
    world.nodes.push(node);
    world.byId[id] = node;
    world.bounds.minX = Math.min(world.bounds.minX, x - 8);
    world.bounds.maxX = Math.max(world.bounds.maxX, x + 8);
    world.bounds.minZ = Math.min(world.bounds.minZ, z - 8);
    world.bounds.maxZ = Math.max(world.bounds.maxZ, z + 8);
    return node;
  };

  const archetype = legIdx % 5;
  let pathIds = [fromNode.id];
  let destinationId = fromNode.id;
  let legName = "";

  if (archetype === 1) {
    // 1. Matterhorn Hairpin Switchback Pass (高山平滑多段发卡弯群)
    legName = `Matterhorn Switchbacks · 第 ${legIdx} 盘山弯道`;
    
    // Approach lead-in
    const pApp = move(fromNode, h0, 2.4);
    const nodeApp = addNode(`alp-hp-${legIdx}-app`, pApp.x, pApp.z);
    link(fromNode.id, nodeApp.id, "Hairpin Pass · Approach", 1.4);
    pathIds.push(nodeApp.id);

    let cur = nodeApp;
    let curH = h0;

    // Hairpin Turn 1: 8-segment smooth left arc (~-22° each = ~176° total, R≈3.5m)
    for (let k = 0; k < 8; k++) {
      curH -= 0.22;
      const np = move(cur, curH, 1.2);
      const nid = `alp-hp-${legIdx}-t1-${k}`;
      const node = addNode(nid, np.x, np.z);
      link(cur.id, nid, `Hairpin Pass · Arc Left ${k + 1}`, 1.4);
      pathIds.push(nid);
      cur = node;
    }

    // Ridge Traverse — short straight between the two hairpins
    curH += 0.04;
    const pMid = move(cur, curH, 4.2);
    const nodeMid = addNode(`alp-hp-${legIdx}-mid`, pMid.x, pMid.z);
    link(cur.id, nodeMid.id, "Hairpin Pass · Ridge Traverse", 1.4);
    pathIds.push(nodeMid.id);
    cur = nodeMid;

    // Hairpin Turn 2: 8-segment smooth right arc (~+22° each = ~176° total)
    for (let k = 0; k < 8; k++) {
      curH += 0.22;
      const np = move(cur, curH, 1.2);
      const nid = `alp-hp-${legIdx}-t2-${k}`;
      const node = addNode(nid, np.x, np.z);
      link(cur.id, nid, `Hairpin Pass · Arc Right ${k + 1}`, 1.4);
      pathIds.push(nid);
      cur = node;
    }

    // Straight exit run
    curH -= 0.04;
    const pOut = move(cur, curH, 2.8);
    const nodeOut = addNode(`alp-hp-${legIdx}-out`, pOut.x, pOut.z);
    link(cur.id, nodeOut.id, "Hairpin Pass · Exit Straight", 1.4);
    pathIds.push(nodeOut.id);
    destinationId = nodeOut.id;

  } else if (archetype === 2) {
    // 2. Alpine Y-Fork Bifurcation (宽阔流畅高山分流与自然中央岛)
    legName = `Summit Fork Bypass · 第 ${legIdx} 高山分流`;
    
    // Approach straight leading to fork signpost
    const pIn = move(fromNode, h0, 2.8);
    const nodeIn = addNode(`alp-fk-${legIdx}-in`, pIn.x, pIn.z);
    link(fromNode.id, nodeIn.id, "Fork Approach", 1.4);

    // Throat bifurcation point
    const pJct = move(nodeIn, h0, 2.2);
    const nodeJct = addNode(`alp-fk-${legIdx}-jct`, pJct.x, pJct.z);
    link(nodeIn.id, nodeJct.id, "Bifurcation Throat", 1.4);

    // Left branch (Summit Scenic Pass ↖): 3 intermediate arc nodes with 5.4m centerline clearance at apex
    const pL1 = move(move(nodeJct, h0, 3.0), h0 - Math.PI / 2, 1.35);
    const nodeL1 = addNode(`alp-fk-${legIdx}-L1`, pL1.x, pL1.z);
    const pL2 = move(move(nodeJct, h0, 6.6), h0 - Math.PI / 2, 2.7);
    const nodeL2 = addNode(`alp-fk-${legIdx}-L2`, pL2.x, pL2.z);
    const pL3 = move(move(nodeJct, h0, 10.2), h0 - Math.PI / 2, 1.35);
    const nodeL3 = addNode(`alp-fk-${legIdx}-L3`, pL3.x, pL3.z);

    // Right branch (Valley Tunnel Expressway ↗): 3 intermediate arc nodes
    const pR1 = move(move(nodeJct, h0, 3.0), h0 + Math.PI / 2, 1.35);
    const nodeR1 = addNode(`alp-fk-${legIdx}-R1`, pR1.x, pR1.z);
    const pR2 = move(move(nodeJct, h0, 6.6), h0 + Math.PI / 2, 2.7);
    const nodeR2 = addNode(`alp-fk-${legIdx}-R2`, pR2.x, pR2.z);
    const pR3 = move(move(nodeJct, h0, 10.2), h0 + Math.PI / 2, 1.35);
    const nodeR3 = addNode(`alp-fk-${legIdx}-R3`, pR3.x, pR3.z);

    // Convergence node: midpoint between the two branch endpoints, pushed slightly forward
    const pJoin = {
      x: (pL3.x + pR3.x) / 2 + Math.sin(h0) * 2.0,
      z: (pL3.z + pR3.z) / 2 - Math.cos(h0) * 2.0,
    };
    const nodeJoin = addNode(`alp-fk-${legIdx}-join`, pJoin.x, pJoin.z);

    // Link left branch sequence
    link(nodeJct.id, nodeL1.id, "Summit Scenic Pass ↖", 1.4);
    link(nodeL1.id, nodeL2.id, "Summit Scenic Pass ↖", 1.4);
    link(nodeL2.id, nodeL3.id, "Summit Scenic Pass ↖", 1.4);
    link(nodeL3.id, nodeJoin.id, "Summit Descent", 1.4);

    // Link right branch sequence
    link(nodeJct.id, nodeR1.id, "Valley Tunnel Expressway ↗", 1.4);
    link(nodeR1.id, nodeR2.id, "Valley Tunnel Expressway ↗", 1.4);
    link(nodeR2.id, nodeR3.id, "Valley Tunnel Expressway ↗", 1.4);
    link(nodeR3.id, nodeJoin.id, "Valley Portal Exit", 1.4);

    // Roadside timber guide signpost planted on approach shoulder
    world.objects.push({
      id: `alpine-gantry-${legIdx}`,
      type: "alpine_fork_gantry",
      x: nodeIn.x,
      z: nodeIn.z,
      heading: h0,
      leftText: "SUMMIT PASS ↖",
      leftSub: "雪山观景盘山道",
      rightText: "VALLEY PASS ↗",
      rightSub: "深谷岩石景观道",
    });

    const isRight = branchChoice === "right";
    const chosenNodes = isRight
      ? [nodeR1.id, nodeR2.id, nodeR3.id]
      : [nodeL1.id, nodeL2.id, nodeL3.id];
    pathIds.push(nodeIn.id, nodeJct.id, ...chosenNodes, nodeJoin.id);
    destinationId = nodeJoin.id;

  } else if (archetype === 3) {
    // 3. Alpine Lookout Roundabout (山顶真实12边形圆形环岛观景台, R=4.2m)
    legName = `Bellevue Lookout Rotary · 第 ${legIdx} 环岛观景`;
    
    // Approach straight
    const pEntry = move(fromNode, h0, 2.6);
    const nodeEntry = addNode(`alp-rb-${legIdx}-entry`, pEntry.x, pEntry.z);
    link(fromNode.id, nodeEntry.id, "Roundabout Approach", 1.4);

    // Rotary center: R = 4.2m
    const R = 4.2;
    const center = move(nodeEntry, h0, 2.0 + R);

    // 12 perimeter nodes around circular rotary ring
    const rbNodes = [];
    for (let k = 0; k < 12; k++) {
      const theta = h0 + Math.PI + (k / 12) * Math.PI * 2;
      const p = {
        x: center.x + Math.sin(theta) * R,
        z: center.z - Math.cos(theta) * R,
      };
      const n = addNode(`alp-rb-${legIdx}-${k}`, p.x, p.z);
      rbNodes.push(n);
    }

    // Link ring perimeter in one-way circle
    for (let k = 0; k < 12; k++) {
      link(rbNodes[k].id, rbNodes[(k + 1) % 12].id, "Roundabout Ring", 1.4);
    }
    // Tangential approach connects to perimeter node 0
    link(nodeEntry.id, rbNodes[0].id, "Roundabout Entry", 1.4);

    // Exit node: tangent at node 6 points away from center (perpendicular to radius)
    // radius vector at node 6: rbNodes[6] - center => theta6 = h0 + Math.PI + (6/12)*2π = h0 + 2π
    // tangent (clockwise circulation) is perpendicular CW: heading = theta6 + π/2
    const theta6 = h0 + Math.PI + (6 / 12) * Math.PI * 2;
    const exitHeading = theta6 + Math.PI / 2; // tangential, clockwise
    const pExit = {
      x: rbNodes[6].x + Math.sin(exitHeading) * 2.6,
      z: rbNodes[6].z - Math.cos(exitHeading) * 2.6,
    };
    const nodeExit = addNode(`alp-rb-${legIdx}-exit`, pExit.x, pExit.z);
    link(rbNodes[6].id, nodeExit.id, "Roundabout Exit", 1.4);

    // Central alpine stone fountain & pines landmark
    world.objects.push({
      id: `alpine-fountain-${legIdx}`,
      type: "alpine_roundabout_center",
      x: center.x,
      z: center.z,
    });

    // Follow entry -> half-circle (nodes 0 through 6) -> exit
    pathIds.push(
      nodeEntry.id,
      rbNodes[0].id,
      rbNodes[1].id,
      rbNodes[2].id,
      rbNodes[3].id,
      rbNodes[4].id,
      rbNodes[5].id,
      rbNodes[6].id,
      nodeExit.id
    );
    destinationId = nodeExit.id;

  } else if (archetype === 4) {
    // 4. Gorge Viaduct Bridge (峡谷高架与石拱瀑布桥, 4段平滑延伸)
    legName = `Glacier Torrent Viaduct · 第 ${legIdx} 峡谷高架桥`;
    let cur = fromNode;
    const viaductSteps = [
      { d: 3.2, dh: -0.08 },
      { d: 3.4, dh: 0.06 },
      { d: 3.4, dh: 0.08 },
      { d: 3.2, dh: -0.06 },
    ];
    let curH = h0;
    for (let k = 0; k < viaductSteps.length; k++) {
      curH += viaductSteps[k].dh;
      const np = move(cur, curH, viaductSteps[k].d);
      const nid = `alp-vd-${legIdx}-${k}`;
      const node = addNode(nid, np.x, np.z);
      link(cur.id, nid, `Glacier Viaduct · Span ${k + 1}`, 1.4);
      pathIds.push(nid);
      cur = node;
    }
    destinationId = cur.id;

  } else {
    // 5. Chalet Village & Crosswalk (高山木屋村落与斑马线, 4段平缓风情道)
    legName = `Alpine Chalet Hamlet · 第 ${legIdx} 瑞士小镇平缓段`;
    let cur = fromNode;
    const villageSteps = [
      { d: 3.0, dh: -0.06, control: "none", name: "Chalet Approach" },
      { d: 3.2, dh: 0.05, control: "stop", name: "Village Promenade · Crosswalk" },
      { d: 3.2, dh: 0.06, control: "none", name: "Village Fountain Way" },
      { d: 3.0, dh: -0.05, control: "none", name: "Chalet Exit" },
    ];
    let curH = h0;
    for (let k = 0; k < villageSteps.length; k++) {
      curH += villageSteps[k].dh;
      const np = move(cur, curH, villageSteps[k].d);
      const nid = `alp-vg-${legIdx}-${k}`;
      const node = addNode(nid, np.x, np.z, villageSteps[k].control);
      link(cur.id, nid, villageSteps[k].name, 1.4);
      pathIds.push(nid);
      cur = node;
    }
    destinationId = cur.id;
  }

  return {
    pathIds,
    destinationId,
    name: legName,
  };
}
