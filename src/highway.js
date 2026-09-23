import {
  rng,
  choose,
  dist,
  heading,
  move,
  nearestOnPath,
  pointAt,
  samplePolyline,
} from "./math.js";

function smoothRoad(nodes) {
  const raw = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)],
      p1 = nodes[i];
    const p2 = nodes[i + 1],
      p3 = nodes[Math.min(nodes.length - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40,
        p = {};
      for (const axis of ["x", "z"])
        p[axis] =
          0.5 *
          (2 * p1[axis] +
            (-p0[axis] + p2[axis]) * t +
            (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t +
            (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t * t * t);
      raw.push(p);
    }
  }
  raw.push(nodes.at(-1));
  return samplePolyline(raw, 2);
}

function offsetPath(points, offset) {
  return points.map((p, i) =>
    move(
      p,
      heading(
        points[Math.max(0, i - 1)],
        points[Math.min(points.length - 1, i + 1)],
      ) +
        Math.PI / 2,
      offset,
    ),
  );
}

function cubic(a, b, c, d) {
  return samplePolyline(
    Array.from({ length: 81 }, (_, i) => {
      const t = i / 80,
        u = 1 - t;
      return {
        x:
          u ** 3 * a.x +
          3 * u ** 2 * t * b.x +
          3 * u * t ** 2 * c.x +
          t ** 3 * d.x,
        z:
          u ** 3 * a.z +
          3 * u ** 2 * t * b.z +
          3 * u * t ** 2 * c.z +
          t ** 3 * d.z,
      };
    }),
    1.5,
  );
}

// All interstate routes follow the same sampled road. Re-smoothing a subset of
// junctions produces a different curve and moves traffic away from its lane.
export function makeHighwayRoute(world, ids, laneOffset = 9) {
  const points = [],
    sections = [],
    crossings = [];
  const append = (path) => {
    for (const p of path) {
      const last = points.at(-1);
      if (last && dist(last, p) < 0.001) continue;
      points.push({ x: p.x, z: p.z, s: last ? last.s + dist(last, p) : 0 });
    }
  };
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i],
      b = ids[i + 1];
    const edge = world.edges.find(
      (e) => (e.a === a && e.b === b) || (!e.oneWay && e.b === a && e.a === b),
    );
    if (!edge) throw Error(`No drivable connection from ${a} to ${b}`);
    let path;
    if (edge.path)
      path =
        edge.a === a
          ? edge.path
          : samplePolyline(
              offsetPath([...edge.centerline].reverse(), edge.laneOffset),
              1.5,
            );
    else {
      const start = nearestOnPath(world.byId[a], world.roadSamples).s;
      const end = nearestOnPath(world.byId[b], world.roadSamples).s;
      const low = Math.min(start, end),
        high = Math.max(start, end);
      const center = [
        pointAt(world.roadSamples, low),
        ...world.roadSamples.filter((p) => p.s > low && p.s < high),
        pointAt(world.roadSamples, high),
      ];
      if (end < start) center.reverse();
      path = offsetPath(center, laneOffset);
    }
    const junction = world.byId[a];
    let corner = null;
    if (
      i > 0 &&
      (junction.townJunction ||
        (edge.kind === "local" && sections.at(-1)?.kind === "local"))
    ) {
      const approach = heading(points.at(-2), points.at(-1));
      const exit = heading(path[0], path[1]);
      if (junction.townJunction)
        crossings.push({
          nodeId: a,
          x: junction.x,
          z: junction.z,
          approach,
          exit,
        });
      if (Math.abs(Math.sin(exit - approach)) > 0.1) {
        // Join the right-hand lane to the actual outgoing road through the
        // intersection, rather than splicing two lane endpoints at a sharp angle.
        const rightTurn = Math.sin(exit - approach) > 0;
        const inset = rightTurn ? 11 : 14;
        const entry = pointAt(points, points.at(-1).s - inset);
        const leaving = pointAt(path, inset);
        while (points.at(-1).s > entry.s) points.pop();
        append([entry]);
        sections.at(-1).endS = points.at(-1).s;
        const bend =
          Math.abs(Math.sin(approach)) > 0.5
            ? { x: leaving.x, z: entry.z }
            : { x: entry.x, z: leaving.z };
        corner = cubic(
          entry,
          rightTurn
            ? { x: (entry.x + 2 * bend.x) / 3, z: (entry.z + 2 * bend.z) / 3 }
            : move(entry, approach, 9),
          rightTurn
            ? {
                x: (leaving.x + 2 * bend.x) / 3,
                z: (leaving.z + 2 * bend.z) / 3,
              }
            : move(leaving, exit, -9),
          leaving,
        );
        path = path.filter((p) => p.s > inset);
      }
    }
    const startS = points.at(-1)?.s ?? 0;
    if (corner) append(corner);
    append(path);
    const previous = sections.at(-1);
    if (previous?.kind === edge.kind && previous.speedLimit === edge.speedLimit)
      previous.endS = points.at(-1).s;
    else
      sections.push({
        kind: edge.kind,
        name: edge.name,
        startS,
        endS: points.at(-1).s,
        speedLimit: edge.speedLimit,
        laneHalfWidth: edge.kind === "interstate" ? 2.25 : 3,
      });
  }
  for (const crossing of crossings) {
    const line = move(
      move(crossing, crossing.approach, -10.5),
      crossing.approach + Math.PI / 2,
      3,
    );
    crossing.stopS = nearestOnPath(line, points).s;
  }
  return { ids, points, sections, crossings, length: points.at(-1).s };
}

export function generateHighway(seed, theme) {
  const random = rng(seed),
    nodes = [],
    edges = [],
    objects = [];
  const phase = random() * 2;
  for (let i = 0; i < 9; i++)
    nodes.push({
      id: `h${i}`,
      x: Math.sin(i * 0.65 + phase) * 48,
      z: 680 - i * 170,
      control: "none",
      offset: 0,
      neighbors: [],
    });
  const roadSamples = smoothRoad(nodes);
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1];
    a.neighbors.push(b.id);
    b.neighbors.push(a.id);
    edges.push({
      id: `interstate-${i}`,
      a: a.id,
      b: b.id,
      width: 25,
      length: dist(a, b),
      speedLimit: 28,
      kind: "interstate",
      name: "Interstate 08",
    });
  }
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const station = (id) => nearestOnPath(byId[id], roadSamples).s;
  const lanePoint = (s, offset) => {
    const p = pointAt(roadSamples, s);
    return move(p, p.heading + Math.PI / 2, offset);
  };
  const startX = Math.max(byId.h0.x, byId.h1.x, byId.h2.x) + 145;
  const townX = Math.max(byId.h6.x, byId.h7.x, byId.h8.x) + 155;
  const addNode = (id, p) => {
    const node = {
      id,
      x: p.x,
      z: p.z,
      control: "none",
      offset: 0,
      neighbors: [],
    };
    nodes.push(node);
    byId[id] = node;
    return node;
  };
  const start = addNode("local-start", { x: startX, z: 660 });
  const market = addNode("mill-market", { x: startX, z: 600 });
  const rampJunction = addNode("mill-interchange", { x: startX, z: 520 });
  const ramp = addNode("onramp", { x: startX - 38, z: 520 });
  const north = addNode("mill-north", { x: startX, z: 450 });
  const south = addNode("mill-south", { x: startX, z: 710 });
  const eastSouth = addNode("oak-south", { x: startX + 80, z: 710 });
  const eastMarket = addNode("oak-market", { x: startX + 80, z: 600 });
  const eastRamp = addNode("oak-interchange", { x: startX + 80, z: 520 });
  const eastNorth = addNode("oak-north", { x: startX + 80, z: 450 });
  const marketWest = addNode("market-west", { x: startX - 65, z: 600 });
  const marketEast = addNode("market-east", { x: startX + 116, z: 600 });
  for (const junction of [market, rampJunction, eastMarket, eastRamp]) {
    junction.townJunction = true;
    junction.control = "stop";
  }
  const mergeStart = station("h2"),
    mergeEnd = station("h3");
  const merge = addNode("merge-lane", lanePoint(mergeStart, 15));
  const exitStart = station("h6"),
    exitSplit = exitStart + 80;
  const exit = addNode("exit-cedar", lanePoint(exitSplit, 17));
  const town = addNode("cedar-town", { x: townX, z: -580 });
  const destination = addNode("cedar-stop", { x: townX, z: -755 });
  const connectorRoads = [];
  const link = (
    a,
    b,
    surface,
    width,
    speed,
    kind,
    name,
    offset = 0,
    endInset = 0,
    twoWay = false,
  ) => {
    const sampled = samplePolyline(surface, 1.5);
    const path = samplePolyline(offsetPath(sampled, offset), 1.5);
    if (endInset) {
      const end = path.at(-1).s - endInset;
      const last = pointAt(path, end);
      while (path.at(-1).s > end) path.pop();
      path.push(last);
    }
    a.neighbors.push(b.id);
    if (twoWay) b.neighbors.push(a.id);
    edges.push({
      id: `${a.id}-${b.id}`,
      a: a.id,
      b: b.id,
      oneWay: !twoWay,
      width,
      speedLimit: speed,
      kind,
      name,
      length: path.at(-1).s,
      path,
      ...(twoWay ? { centerline: sampled, laneOffset: offset } : {}),
    });
    connectorRoads.push({
      id: `${a.id}-${b.id}`,
      // Overlap asphalt at joins: independently sampled end tangents otherwise
      // leave a thin wedge that rejects every forward trajectory as off-road.
      // Rendering and occupancy share these points; the route stays unchanged.
      points: samplePolyline(
        [
          move(sampled[0], heading(sampled[0], sampled[1]), -0.25),
          ...sampled,
          move(sampled.at(-1), heading(sampled.at(-2), sampled.at(-1)), 0.25),
        ],
        1.5,
      ),
      width,
      kind,
      twoWay: offset !== 0,
    });
  };
  const street = (a, b, name) =>
    link(a, b, [a, b], 12, 10, "local", name, 3, 0, true);
  for (const [a, b] of [
    [south, start],
    [start, market],
    [market, rampJunction],
    [rampJunction, north],
  ])
    street(a, b, "Millbrook · Main Street");
  for (const [a, b] of [
    [eastSouth, eastMarket],
    [eastMarket, eastRamp],
    [eastRamp, eastNorth],
  ])
    street(a, b, "Millbrook · Oak Street");
  street(marketWest, market, "Millbrook · Market Street");
  street(market, eastMarket, "Millbrook · Market Street");
  street(eastMarket, marketEast, "Millbrook · Market Street");
  street(rampJunction, eastRamp, "Millbrook · Depot Street");
  street(north, eastNorth, "Millbrook · North Street");
  street(south, eastSouth, "Millbrook · South Street");
  link(
    rampJunction,
    ramp,
    [rampJunction, ramp],
    8,
    8,
    "ramp_turn",
    "Interstate 08 North entrance",
  );
  const mergeHeading = pointAt(roadSamples, mergeStart).heading;
  link(
    ramp,
    merge,
    cubic(
      ramp,
      move(ramp, -Math.PI / 2, 65),
      move(merge, mergeHeading, -85),
      merge,
    ),
    6,
    26,
    "onramp",
    "Interstate 08 on-ramp",
  );
  const merging = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100,
      blend = t * t * (3 - 2 * t);
    return lanePoint(mergeStart + (mergeEnd - mergeStart) * t, 15 - 6 * blend);
  });
  link(merge, byId.h3, merging, 6, 26, "merge", "Merge onto Interstate 08");
  const exiting = Array.from({ length: 61 }, (_, i) => {
    const t = i / 60,
      blend = t * t * (3 - 2 * t);
    return lanePoint(exitStart + (exitSplit - exitStart) * t, 9 + 8 * blend);
  });
  link(byId.h6, exit, exiting, 6, 22, "exit", "Cedar Town exit");
  const townEntry = { x: town.x + 3, z: town.z };
  const exitHeading = pointAt(roadSamples, exitSplit).heading;
  link(
    exit,
    town,
    cubic(
      exit,
      move(exit, exitHeading, 80),
      move(townEntry, 0, -80),
      townEntry,
    ),
    6,
    16,
    "offramp",
    "Cedar Town off-ramp",
  );
  link(
    town,
    destination,
    [town, destination],
    12,
    10,
    "town",
    "Cedar Town · Station Street",
    3,
    15,
  );

  // A few connected side streets and low buildings make the destination a town.
  for (const z of [-620, -695])
    connectorRoads.push({
      id: `cedar-cross-${z}`,
      kind: "town",
      twoWay: true,
      width: 12,
      points: samplePolyline(
        [
          { x: townX - 55, z },
          { x: townX + 80, z },
        ],
        2,
      ),
    });
  for (const [x, z, style] of [
    [townX - 22, -594, "shop"],
    [townX + 24, -594, "shop"],
    [townX - 22, -649, "cottage"],
    [townX + 24, -649, "townhouse"],
    [townX - 23, -672, "modern"],
    [townX + 25, -672, "cottage"],
    [townX - 23, -724, "shop"],
    [townX + 25, -728, "townhouse"],
    [startX - 23, 676, "cottage"],
    [startX - 23, 635, "shop"],
    [startX + 23, 676, "cottage"],
    [startX + 23, 635, "shop"],
    [startX + 57, 676, "townhouse"],
    [startX + 57, 635, "cottage"],
    [startX - 23, 574, "shop"],
    [startX - 23, 547, "shop"],
    [startX + 23, 574, "townhouse"],
    [startX + 23, 547, "shop"],
    [startX + 57, 574, "cottage"],
    [startX + 57, 547, "modern"],
    [startX + 103, 657, "cottage"],
    [startX + 103, 557, "cottage"],
    [startX - 23, 482, "cottage"],
    [startX + 23, 482, "modern"],
    [startX + 57, 482, "cottage"],
  ])
    objects.push({
      id: `building-${objects.length}`,
      type: "building",
      x,
      z,
      width: 12,
      depth: 14,
      height: style === "townhouse" ? 8 : 5,
      style,
      rotation: 0,
      color: choose(random, ["#eadbc9", "#d4d9cb", "#c6b4a2", "#ddd4c0"]),
    });
  for (const z of [-598, -645, -673, -723])
    objects.push({
      id: `lamp-${z}`,
      type: "streetlight",
      x: townX + 7.8,
      z,
      height: 6,
    });
  for (const z of [688, 650, 572, 490])
    for (const x of [startX - 8, startX + 88])
      objects.push({
        id: `millbrook-lamp-${objects.length}`,
        type: "streetlight",
        x,
        z,
        height: 6,
      });
  for (const junction of nodes.filter((n) => n.townJunction))
    for (const id of junction.neighbors) {
      if (
        !edges.some(
          (edge) =>
            (edge.a === id && edge.b === junction.id) ||
            (!edge.oneWay && edge.a === junction.id && edge.b === id),
        )
      )
        continue;
      const approach = heading(byId[id], junction);
      const p = move(move(junction, approach, -9), approach + Math.PI / 2, 6.9);
      objects.push({
        id: `millbrook-stop-${junction.id}-${id}`,
        type: "stop_sign",
        ...p,
        nodeId: junction.id,
        approach,
        height: 2.8,
      });
    }
  objects.push(
    {
      id: "millbrook-welcome",
      type: "town_sign",
      x: startX + 9,
      z: 650,
      text: "MILLBROOK",
      height: 3,
    },
    {
      id: "interstate-advance",
      type: "interstate_guide",
      x: startX + 11,
      z: 619,
      approach: 0,
      direction: "left",
      text: "Cedar Town",
      detail: "LEFT AFTER MARKET ST",
    },
    {
      id: "interstate-entrance",
      type: "interstate_guide",
      x: startX + 11,
      z: 538,
      approach: 0,
      direction: "left",
      text: "North entrance",
      detail: "INTERSTATE 08",
    },
    {
      id: "interstate-ramp",
      type: "interstate_guide",
      ...move(ramp, -Math.PI / 2, 15),
      z: ramp.z - 8,
      approach: -Math.PI / 2,
      direction: "straight",
      text: "Cedar Town",
      detail: "ACCELERATE TO MERGE",
    },
  );
  for (let i = 0; i < 210; i++) {
    const p = {
      x: (random() > 0.5 ? 1 : -1) * (65 + random() * 200),
      z: -760 + random() * 1480,
    };
    const nearConnector = connectorRoads.some(
      (road) => nearestOnPath(p, road.points).distance < road.width / 2 + 8,
    );
    if (
      nearConnector ||
      objects.some((o) => o.type === "building" && dist(p, o) < 18)
    )
      continue;
    objects.push({
      id: `tree-${i}`,
      type: "tree",
      ...p,
      height: 5 + random() * 9,
      kind: random() > 0.25 ? "pine" : "round",
    });
  }
  for (let i = 0; i < 10; i++)
    objects.push({
      id: `hill-${i}`,
      type: "hill",
      x: (i % 2 ? 1 : -1) * (270 + random() * 70),
      z: -700 + random() * 1400,
      height: 20 + random() * 35,
      width: 70 + random() * 60,
      depth: 80,
    });
  for (const i of [2, 5])
    objects.push({
      id: `overpass-${i}`,
      type: "overpass",
      x: byId[`h${i}`].x,
      z: byId[`h${i}`].z - 45,
      width: 230,
      depth: 13,
      height: 9,
    });
  for (const [i, direction, detail] of [
    [3, "straight", "CONTINUE NORTH"],
    [5, "right", "EXIT 6 · KEEP RIGHT"],
  ])
    objects.push({
      id: `highway-sign-${i}`,
      type: "highway_sign",
      x: byId[`h${i}`].x,
      z: byId[`h${i}`].z + 60,
      width: 18,
      height: 8,
      text: "Cedar Town",
      direction,
      detail,
    });
  objects.push({
    id: "cedar-welcome",
    type: "town_sign",
    x: townX + 9,
    z: -588,
    text: "CEDAR TOWN",
    height: 3,
  });
  const world = {
    seed,
    type: "highway",
    theme,
    nodes,
    byId,
    edges,
    objects,
    roadSamples,
    connectorRoads,
    shoulderOpenings: [
      [mergeStart - 5, mergeEnd + 8],
      [exitStart - 8, exitSplit + 15],
    ],
    xs: [-350, 350],
    zs: [-800, 720],
    bounds: { minX: -370, maxX: 370, minZ: -805, maxZ: 740 },
    startNode: start.id,
    nextNode: market.id,
    destination: destination.id,
  };
  world.route = makeHighwayRoute(world, [
    start.id,
    market.id,
    rampJunction.id,
    ramp.id,
    merge.id,
    "h3",
    "h4",
    "h5",
    "h6",
    exit.id,
    town.id,
    destination.id,
  ]);
  world.destinationStopLine = {
    ...move(world.route.points.at(-1), 0, 1.4),
    heading: 0,
  };
  return world;
}
