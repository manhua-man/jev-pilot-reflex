import {
  generateWorld,
  makeRoute,
  shortestPath,
  signalState,
} from "./world.js";
import {
  clamp,
  dist,
  heading,
  move,
  angle,
  pointAt,
  nearestOnPath,
  rng,
  choose,
  round,
  blockedByBuilding,
} from "./math.js";
import {
  physics,
  pedalPhysics,
  candidateChoices,
  maneuverSteering,
  maneuverVelocity,
  uTurnApproach,
  routeSection,
  routeSpeedLimit,
  BRAKING,
  stopLineDistance,
  stopAvailability,
} from "./planning.js";
import {
  followingSpeed,
  leadVehicle,
  followingGap,
  predictTrafficConflict,
  relativeTrafficState,
  rearTrafficPressure,
} from "./traffic-safety.js";
import { collisionPose, firstCollision } from "./collisions.js";
export { physics } from "./planning.js";
import { createDrivingPlan, recoveryBlocked } from "./driving-plan.js";
import { updateCourtesy } from "./courtesy.js";
import { routeFromLocation, routesFromLocation } from "./routing.js";

const REROUTE_DISTANCE_M = 30;
const REROUTE_DELAY_S = 6;
const REROUTE_COOLDOWN_S = 30;
const PLAYER_STOP_DWELL_S = 0.6;

export class Simulation {
  constructor(seed = Math.floor(Math.random() * 999999), type = "town") {
    this.reset(seed, type);
  }
  reset(seed, type) {
    this.world = generateWorld(seed, type);
    this.time = 0;
    this.paused = false;
    this.autopilot = false;
    this.safety = true;
    this.pedals = { throttle: 0, brake: 0 };
    this.steeringInput = 0;
    this.brakeReason = null;
    this.complete = false;
    this.collisions = 0;
    this.crash = null;
    this.violations = 0;
    this.distance = 0;
    this.freeExplore = false;
    this.events = [];
    this.locks = new Map();
    this.courtesy = new Map();
    this.nextCourtesy = 0;
    this.r = rng(seed + 51);
    this.planRandom = rng(seed + 9173);
    this.planSequence = 0;
    this.routeVersion = 0;
    this.routeChoices = {};
    this.nextRouteChoices = 0;
    this.routeChoicesOrigin = null;
    this.routeHoldUntil = 0;
    this.nextRouteCheck = 0;
    this.offRouteSince = null;
    this.lastReroute = -Infinity;
    this.destinationApproach = this.world.route.ids.slice(-2);
    this.destinationPoint = { ...this.world.route.points.at(-1) };
    this.lastPlan = null;
    this.lastDecisionState = null;
    this.contacts = new Set();
    this.discovered = new Map();
    this.perception = [];
    this.nextScan = 0;
    const p = this.world.route.points[0],
      h = heading(p, this.world.route.points[1]);
    this.player = {
      id: "ego",
      type: "car",
      x: p.x,
      z: p.z,
      heading: h,
      speed: 0,
      steering: 0,
      steeringProgress: 0,
      target: 0,
      route: this.world.route,
      s: 0,
      stops: {},
      intersectionMemory: null,
      width: 1.9,
      depth: 4.75,
    };
    this.traffic = [];
    for (let i = 0; i < this.world.theme.traffic; i++) this.spawnTraffic(i);
    this.pedestrians = [];
    for (
      let i = 0;
      i < (type === "highway" ? 0 : 14 + (type === "city" ? 12 : 0));
      i++
    ) {
      const node = choose(this.r, this.world.nodes),
        crossing = i % 3 === 0 && node.control === "signal";
      const other = this.world.byId[choose(this.r, node.neighbors)];
      const walkHeading = heading(node, other),
        side = this.r() < 0.5 ? -1 : 1;
      const pathStart = move(
        move(node, walkHeading, 14),
        walkHeading + Math.PI / 2,
        7.05 * side,
      );
      const pathLength = dist(node, other) - 28;
      const progress = crossing ? 0 : this.r() * pathLength;
      const position = crossing
        ? { x: node.x - 8, z: node.z - 7.8 }
        : move(pathStart, walkHeading, progress);
      this.pedestrians.push({
        id: `pedestrian-${i}`,
        type: "pedestrian",
        nodeId: node.id,
        x: position.x,
        z: position.z,
        progress,
        walkPath: {
          start: pathStart,
          heading: walkHeading,
          length: pathLength,
        },
        direction: this.r() > 0.5 ? 1 : -1,
        crossing,
        walking: false,
        speed: 0,
        width: 0.6,
        depth: 0.6,
        height: 1.7,
      });
    }
  }
  spawnTraffic(i, distant = false) {
    const highway = this.world.type === "highway";
    const nodes = highway
      ? this.world.nodes.filter((node) => /^h\d+$/.test(node.id))
      : this.world.nodes;
    let a = choose(this.r, nodes),
      b = choose(
        this.r,
        nodes.filter((n) => dist(n, a) > 100),
      ),
      ids = highway
        ? (i % 4 < 2 ? nodes : [...nodes].reverse()).map((node) => node.id)
        : shortestPath(this.world, a.id, b.id);
    if (ids.length < 3) return this.spawnTraffic(i, distant);
    const route = makeRoute(
        this.world,
        ids,
        this.world.type === "highway" && i % 2 === 0 ? 4.5 : undefined,
      ),
      s = this.r() * route.length,
      p = pointAt(route.points, s),
      next = pointAt(route.points, s + 1);
    if (dist(p, this.player) < (distant ? 600 : 15))
      return this.spawnTraffic(i, distant);
    const existing = this.traffic.find((v) => v.id === `vehicle-${i}`);
    if (this.traffic.some((v) => v !== existing && dist(v, p) < 10)) return;
    const v = {
      id: `vehicle-${i}`,
      type: i % 5 === 0 ? "motorcycle" : "car",
      x: p.x,
      z: p.z,
      heading: heading(p, next),
      speed: 0,
      s,
      route,
      stops: {},
      width: i % 5 === 0 ? 0.8 : 1.9,
      depth: i % 5 === 0 ? 2.3 : 4.2,
      color: choose(this.r, [
        "#de8e69",
        "#e9be57",
        "#97b6b9",
        "#efefe2",
        "#658f82",
        "#a294bf",
      ]),
    };
    if (existing) Object.assign(existing, v);
    else this.traffic.push(v);
  }
  continueTraffic(v) {
    if (this.world.type === "highway") return;
    // Rebuild from the current final road segment, before its junction enters
    // braking range. The shared segment preserves lane position and heading.
    const ids = v.route.ids.slice(-2);
    for (let i = 0; i < 5; i++) {
      const node = this.world.byId[ids.at(-1)];
      const forward = node.neighbors.filter((id) => id !== ids.at(-2));
      ids.push(choose(this.r, forward.length ? forward : node.neighbors));
    }
    const route = makeRoute(this.world, ids);
    const near = nearestOnPath(v, route.points);
    if (near.distance > 0.5) return;
    v.route = route;
    v.s = near.s;
    v.stops = {};
    v.amber = null;
  }
  event(text, type = "info") {
    if (this.events[0]?.text === text && this.time - this.events[0].time < 3)
      return;
    this.events.unshift({ time: round(this.time, 1), text, type });
    this.events = this.events.slice(0, 30);
  }
  crossingFor(v) {
    return v.route.crossings.find((c) => c.stopS - v.s > -19);
  }
  rememberIntersectionStop(v, crossing, signal) {
    const key = `${this.routeVersion}:${crossing.nodeId}:${crossing.stopS}:${crossing.approach}`;
    if (v.intersectionMemory?.key !== key) {
      v.intersectionMemory = {
        key,
        nodeId: crossing.nodeId,
        stopCount: 0,
        stationarySince: null,
        currentStopRecorded: false,
        lastStop: null,
      };
      // A completed visit to the same junction is not this approach's stop.
      if (v.stops[crossing.nodeId]?.passed) delete v.stops[crossing.nodeId];
    }
    const memory = v.intersectionMemory;
    const line = {
      ...pointAt(v.route.points, crossing.stopS),
      heading: crossing.approach,
    };
    const lineDistance = stopLineDistance(v, line);
    const approaching =
      crossing.stopS - v.s > -0.7 &&
      lineDistance <= 80 &&
      dist(v, pointAt(v.route.points, v.s)) < 6 &&
      Math.abs(angle(v.heading - crossing.approach)) < 1.2;
    if (!approaching || Math.abs(v.speed) >= 0.2) {
      memory.stationarySince = null;
      memory.currentStopRecorded = false;
      return;
    }
    memory.stationarySince ??= this.time;
    const duration = this.time - memory.stationarySince;
    if (duration < PLAYER_STOP_DWELL_S) return;
    if (!memory.currentStopRecorded) {
      memory.stopCount++;
      memory.currentStopRecorded = true;
      memory.lastStop = {
        position: { x: v.x, z: v.z },
        progress: v.s,
        lineDistance,
        signal,
      };
    }
    memory.lastStop.confirmedAt = this.time;
    memory.lastStop.duration = duration;
  }
  intersectionStopMemory(control) {
    const memory = this.player.intersectionMemory;
    if (
      !control ||
      memory?.key !==
        `${this.routeVersion}:${control.nodeId}:${control.stopS}:${control.approach}`
    )
      return null;
    const stop = memory.lastStop;
    const age = stop ? this.time - stop.confirmedAt : null;
    return {
      approach_id: memory.key,
      stops_on_this_approach: memory.stopCount,
      stopped_recently: age !== null && age <= 30,
      currently_stopped: memory.stationarySince !== null,
      current_stop_duration_s:
        memory.stationarySince === null
          ? 0
          : round(this.time - memory.stationarySince, 1),
      last_stop: stop
        ? {
            age_s: round(age, 1),
            duration_s: round(stop.duration, 1),
            stop_line_ahead_m: round(stop.lineDistance, 1),
            signal_at_stop: stop.signal,
            forward_progress_since_m: round(this.player.s - stop.progress, 1),
          }
        : null,
    };
  }
  rule(v, update = false) {
    const c = this.crossingFor(v);
    if (!c)
      return {
        mustStop: false,
        distance: Infinity,
        reason: "Clear road",
        color: null,
      };
    const node = this.world.byId[c.nodeId],
      delta = c.stopS - v.s,
      signal =
        node.control === "signal"
          ? signalState(node, this.time, c.approach)
          : { color: "stop", walk: false };
    const amberKey = `${node.id}:${Math.floor((this.time + node.offset) / 24)}`;
    if (update && signal.color === "amber" && v.amber?.key !== amberKey)
      v.amber = {
        key: amberKey,
        proceed:
          (v.speed * v.speed) / 16 > Math.max(0, delta - v.depth / 2 - 0.2),
      };
    const proceedOnAmber =
      v.amber?.key === amberKey
        ? v.amber.proceed
        : (v.speed * v.speed) / 16 > Math.max(0, delta - v.depth / 2 - 0.2);
    const inside = delta < -0.7;
    if (update && v === this.player)
      this.rememberIntersectionStop(v, c, signal.color);
    let stop = v.stops[c.nodeId];
    if (update && delta < 5.5 && delta > -0.7 && Math.abs(v.speed) < 0.2) {
      if (!stop)
        v.stops[c.nodeId] = stop = { arrived: this.time, served: false };
      stop.stationarySince ??= this.time;
      if (
        this.time - stop.stationarySince >=
        (v === this.player ? PLAYER_STOP_DWELL_S : 1.2)
      )
        stop.served = true;
    } else if (update && stop) stop.stationarySince = null;
    let reason = "Clear road",
      mustStop = false;
    if (!inside) {
      if (
        node.control === "signal" &&
        (signal.color === "red" ||
          (signal.color === "amber" && !proceedOnAmber))
      ) {
        mustStop = true;
        reason = signal.walk
          ? "Pedestrian crossing"
          : `${signal.color === "amber" ? "Amber" : "Red"} light`;
      }
      if (node.control === "stop" && !stop?.served) {
        mustStop = true;
        reason = "Stop sign";
      }
      const grant = this.courtesy.get(node.id);
      const released = grant?.id === v.id;
      const lock = this.locks.get(node.id);
      // At traffic lights Jev evaluates the visible traffic and candidate paths.
      // The NPC reservation must not turn a green light into a blanket stop.
      const reservationRequired = node.control === "stop" || v !== this.player;
      if (reservationRequired && !released && lock && lock.id !== v.id) {
        mustStop = true;
        reason = "Yield to crossing traffic";
      }
      if (node.control === "stop" && stop?.served && !released) {
        const waiting = [this.player, ...this.traffic].filter(
          (o) =>
            o.id !== v.id &&
            o.stops[node.id] &&
            !o.stops[node.id].passed &&
            this.crossingFor(o)?.nodeId === node.id &&
            o.stops[node.id].arrived < stop.arrived,
        );
        if (waiting.length) {
          mustStop = true;
          reason = "Yield to first arrival";
        }
      }
      if (grant && !released) {
        mustStop = true;
        reason = "Letting stopped traffic clear";
      }
      const pedestrians = this.pedestrians.filter(
        (p) => p.crossing && p.walking && p.nodeId === node.id,
      );
      // The player's selected trajectory handles pedestrian conflicts. Someone
      // crossing another arm of the junction must not stop the entire junction.
      if (v !== this.player && pedestrians.length) {
        mustStop = true;
        reason = "Yield to pedestrian";
      }
      if (update && !mustStop && delta < 3)
        this.locks.set(node.id, { id: v.id, at: this.time });
    } else if (update) {
      this.locks.set(node.id, { id: v.id, at: this.time });
      if (stop) stop.passed = true;
    }
    return {
      mustStop,
      distance: delta,
      reason,
      color: signal.color,
      nodeId: node.id,
      stopCompleted: !!stop?.served,
      walk: signal.walk,
    };
  }
  leadGap(v) {
    return leadVehicle(v, [...this.traffic, this.player])?.gap ?? Infinity;
  }
  speedEnvelope(v) {
    const rule = this.rule(v),
      lead = leadVehicle(v, [...this.traffic, this.player]),
      gap = lead?.gap ?? Infinity;
    let max = Math.min(this.world.theme.limit, routeSpeedLimit(v, v.s)),
      reason = null;
    // NPCs obey the scripted traffic rules. Jev gets the observations and
    // decides when the player's car should approach, yield, or stop.
    if (v !== this.player && rule.mustStop && rule.distance > -0.7) {
      const cap = Math.sqrt(
        2 * 5 * Math.max(0, rule.distance - v.depth / 2 - 0.2),
      );
      if (cap < max) {
        max = cap;
        reason = rule.reason;
      }
    }
    if (v === this.player && !this.freeExplore) {
      const distance = Math.max(0, v.route.length - v.s);
      const destinationCap = Math.sqrt(2 * 5 * Math.max(0, distance - 1.5));
      if (destinationCap < max) {
        max = destinationCap;
        reason = "Destination ahead";
      }
    }
    const cap = followingSpeed(v, lead);
    if (cap < max) {
      max = cap;
      reason =
        lead?.other.type === "motorcycle"
          ? "Motorcycle ahead"
          : "Vehicle ahead";
    }
    // A hazard on the currently selected path must not zero out the speeds of
    // every new candidate. Each candidate predicts its own collisions, while
    // the real-time guard still checks whichever maneuver Jev actually selects.
    const planningMax = max;
    const conflict =
      v === this.player
        ? predictTrafficConflict(v, [...this.traffic, ...this.pedestrians])
        : null;
    if (conflict?.braking_reduces_risk && conflict.max_speed_mps < max) {
      max = conflict.max_speed_mps;
      reason = conflict.reason;
    }
    const released = this.courtesy.get(rule.nodeId)?.id === v.id;
    if (v !== this.player && released && !rule.mustStop && !this.complete) {
      max = Math.min(max, 1.5);
      if (max > 0) reason = "Taking a clear gap";
    }
    return { max, planningMax, reason, rule, gap, conflict, lead, released };
  }
  step(dt) {
    if (this.paused || this.crash) return;
    const previous = new Map(
      [...this.traffic, ...this.pedestrians].map((o) => [
        o.id,
        {
          pose: collisionPose(o),
          route: o.route,
        },
      ]),
    );
    const firstStep = this.time === 0;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.rerouteIfNeeded();
    for (const [id, lock] of this.locks) {
      const car = [this.player, ...this.traffic].find((c) => c.id === lock.id),
        node = this.world.byId[id];
      if (!car || dist(car, node) > 17 || this.time - lock.at > 7)
        this.locks.delete(id);
    }
    for (const p of this.pedestrians) {
      const node = this.world.byId[p.nodeId],
        walk = signalState(node, this.time, 0).walk;
      if (p.crossing) {
        if (walk && !p.walking && p.progress === 0) {
          const anyCar = [this.player, ...this.traffic].some(
            (v) => dist(v, node) < 13,
          );
          if (!anyCar) p.walking = true;
        }
        if (p.walking) {
          p.progress += dt * 3.8;
          if (p.progress >= 16) {
            p.progress = 0;
            p.walking = false;
            p.direction *= -1;
          }
        } else if (p.progress > 0) {
          p.progress = 0;
        }
        p.x = node.x + (p.direction > 0 ? -8 + p.progress : 8 - p.progress);
        p.z = node.z - 7.8;
        p.speed = p.walking ? 3.8 : 0;
        p.heading = p.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        p.progress += dt * 0.9 * p.direction;
        if (p.progress > p.walkPath.length || p.progress < 0) {
          p.progress = clamp(p.progress, 0, p.walkPath.length);
          p.direction *= -1;
        }
        const position = move(p.walkPath.start, p.walkPath.heading, p.progress);
        p.x = position.x;
        p.z = position.z;
        p.walking = true;
        p.speed = 0.9;
        p.heading = angle(p.walkPath.heading + (p.direction < 0 ? Math.PI : 0));
      }
    }
    updateCourtesy(this);
    for (const v of this.traffic) {
      if (v.route.length - v.s < 75) this.continueTraffic(v);
      const rule = this.rule(v, true);
      let target = this.speedEnvelope(v).max;
      const next = pointAt(v.route.points, v.s + 9),
        h = heading(v, next);
      if (v.s < v.route.length - 1 && Math.abs(angle(h - v.heading)) > 0.2)
        target = Math.min(target, 6.5);
      v.speed += clamp(target - v.speed, -7 * dt, 2.8 * dt);
      if (
        rule.mustStop &&
        rule.distance >= 0 &&
        v.speed * dt > Math.max(0, rule.distance - v.depth / 2 - 0.2)
      )
        v.speed = Math.max(0, rule.distance - v.depth / 2 - 0.2) / dt;
      v.s += v.speed * dt;
      if (v.s >= v.route.length - 1) {
        // Interstate vehicles continue beyond the map and recycle only after
        // leaving the view. No visible route-end teleport.
        if (dist(v, this.player) > 1300)
          this.spawnTraffic(Number(v.id.split("-")[1]), true);
        else {
          v.x += Math.sin(v.heading) * v.speed * dt;
          v.z -= Math.cos(v.heading) * v.speed * dt;
        }
        continue;
      }
      const p = pointAt(v.route.points, v.s),
        ahead = pointAt(v.route.points, v.s + 0.5);
      v.x = p.x;
      v.z = p.z;
      v.heading = heading(p, ahead);
    }
    if (this.time >= this.nextScan) {
      this.scanScene();
      this.nextScan = this.time + 0.2;
    }
    const v = this.player,
      old = { ...collisionPose(v), s: v.s };
    const currentRule = this.rule(v, true);
    if (
      v.maneuver?.stop_at_line?.node_id === currentRule.nodeId &&
      (currentRule.color === "green" || currentRule.stopCompleted)
    ) {
      // A selected line-stop profile ceases to apply after a green light or
      // served stop. Keep Jev's chosen speed cap until its next decision.
      v.maneuver = { ...v.maneuver, stop_at_line: null };
    }
    let target = this.autopilot
      ? maneuverVelocity(v, v.maneuver, v.target)
      : v.target;
    this.brakeReason = null;
    if (this.autopilot && this.safety) {
      if (this.lastPlan?.recovery.active) {
        target = clamp(target, -2, 2);
        if (
          recoveryBlocked(v, v.steering, target, [
            ...this.world.objects.filter((o) => o.type === "building"),
            ...this.traffic,
            ...this.pedestrians,
          ])
        ) {
          target = 0;
          this.brakeReason = "Recovery clearance";
        }
      } else {
        const env = this.speedEnvelope(v);
        if (target > env.max) {
          target = env.max;
          this.brakeReason = env.reason;
        }
      }
    }
    if (this.complete) target = 0;
    v.appliedTarget = target;
    if (this.autopilot || this.complete) {
      const steering = v.maneuver
        ? maneuverSteering(v, v.maneuver)
        : v.steering;
      physics(v, steering, target, dt);
    } else
      pedalPhysics(
        v,
        this.steeringInput,
        this.pedals.throttle,
        this.pedals.brake,
        dt,
      );
    v.x = clamp(v.x, this.world.bounds.minX, this.world.bounds.maxX);
    v.z = clamp(v.z, this.world.bounds.minZ, this.world.bounds.maxZ);
    const hit = firstCollision(old, collisionPose(v), [
      ...this.world.objects
        .filter((o) => o.type === "building")
        .map((object) => ({ object })),
      ...[...this.traffic, ...this.pedestrians].map((object) => ({
        object,
        // Newly spawned traffic and initial pedestrian placement are teleports.
        previous:
          !firstStep && previous.get(object.id)?.route === object.route
            ? previous.get(object.id).pose
            : null,
      })),
    ]);
    if (hit) {
      Object.assign(v, {
        x: hit.player.x,
        z: hit.player.z,
        heading: hit.player.heading,
      });
      if (hit.object.type !== "building") {
        Object.assign(hit.object, {
          x: hit.target.x,
          z: hit.target.z,
          heading: hit.target.heading,
          speed: 0,
          walking: false,
        });
      }
      this.distance += dist(old, v);
      v.s = nearestOnPath(v, v.route.points).s;
      this.crash = {
        object_id: hit.object.id,
        type: hit.object.type,
        time_s: round(this.time, 2),
        impact_speed_mps: round(hit.relativeSpeed, 2),
        player_speed_mps: round(Math.abs(v.speed), 2),
        point: hit.point,
        normal: hit.normal,
      };
      v.speed = v.target = v.steering = 0;
      this.autopilot = false;
      this.complete = false;
      this.collisions++;
      this.contacts = new Set([hit.object.id]);
      this.event(`Collision with ${hit.object.type} — drive ended`, "error");
      return;
    }
    this.contacts.clear();
    this.distance += dist(old, v);
    const near = nearestOnPath(v, v.route.points);
    v.s = near.s;
    // Reset immediately on rejoining, including while a worker is calculating.
    if (near.distance <= REROUTE_DISTANCE_M && this.offRouteSince != null) {
      this.offRouteSince = null;
      this.routeChoices = {};
      this.routeChoicesOrigin = null;
    }
    for (const c of v.route.crossings) {
      if (old.s < c.stopS && v.s >= c.stopS && near.distance < 4) {
        const node = this.world.byId[c.nodeId];
        if (
          node.control === "signal"
            ? signalState(node, this.time, c.approach).color === "red"
            : !v.stops[node.id]?.served
        ) {
          this.violations++;
          this.event(
            node.control === "stop" ? "Missed stop sign" : "Crossed on red",
            "error",
          );
        }
      }
    }
    if (
      !this.complete &&
      !this.freeExplore &&
      dist(v, v.route.points.at(-1)) < 3 &&
      v.speed < 1
    ) {
      this.complete = true;
      v.target = 0;
      this.autopilot = false;
      this.event("Destination reached. Nicely driven.", "success");
    }
  }
  rerouteIfNeeded() {
    if (
      this.complete ||
      this.freeExplore ||
      this.crash ||
      this.time < this.nextRouteCheck
    )
      return;
    this.nextRouteCheck = this.time + 0.75;
    const v = this.player,
      near = nearestOnPath(v, v.route.points);
    // Keep the route through turns, queues, and recovery on the same street.
    // Heading and time spent stopped never override this proximity check.
    if (near.distance <= REROUTE_DISTANCE_M) {
      this.offRouteSince = null;
      this.routeChoices = {};
      this.routeChoicesOrigin = null;
      return;
    }
    this.offRouteSince ??= this.time;
    if (!this.routeChoiceNeeded()) return;
    if (this.requestReroute) {
      this.nextRouteCheck = this.time + 4;
      this.requestReroute();
      return;
    }
    const next = routeFromLocation(
      this.world,
      v,
      this.destinationApproach,
      this.destinationPoint,
    );
    if (!next) return;
    // A car on the shoulder of the correct street should recover to that street,
    // without continuously replacing the same route while it does so.
    if (next.route.ids.join(",") === v.route.ids.join(",")) return;
    this.installRoute(next);
  }
  installRoute(next) {
    // A background calculation or Jev response may arrive after we rejoin.
    if (!this.routeChoiceNeeded()) return false;
    const v = this.player;
    const previousControl = this.crossingFor(v);
    const served = previousControl && v.stops[previousControl.nodeId];
    v.route = this.world.route = next.route;
    v.s = next.progress;
    v.stops = {};
    const newControl = this.crossingFor(v);
    if (
      served &&
      newControl?.nodeId === previousControl.nodeId &&
      Math.abs(angle(newControl.approach - previousControl.approach)) < 0.1
    )
      v.stops[newControl.nodeId] = served;
    v.amber = null;
    v.maneuver = null;
    v.target = 0;
    for (const [id, lock] of this.locks)
      if (lock.id === v.id) this.locks.delete(id);
    for (const [id, grant] of this.courtesy)
      if (grant.id === v.id) this.courtesy.delete(id);
    this.lastPlan = this.lastDecisionState = null;
    this.lastReroute = this.time;
    this.offRouteSince = null;
    this.routeVersion++;
    this.routeChoices = {};
    this.nextRouteChoices = this.time;
    this.routeHoldUntil = 0;
    this.event("Route recalculated from your current location");
    return true;
  }
  routeChoiceNeeded() {
    return (
      !this.complete &&
      !this.freeExplore &&
      !this.crash &&
      this.offRouteSince != null &&
      this.time - this.offRouteSince >= REROUTE_DELAY_S &&
      this.time - this.lastReroute >= REROUTE_COOLDOWN_S &&
      this.time >= this.routeHoldUntil &&
      nearestOnPath(this.player, this.player.route.points).distance >
        REROUTE_DISTANCE_M
    );
  }
  refreshRouteChoices() {
    if (!this.routeChoiceNeeded() || this.time < this.routeHoldUntil) {
      this.routeChoices = {};
      return;
    }
    const control = this.crossingFor(this.player);
    // Commit through a turn instead of changing destinations halfway across it.
    if (
      control &&
      Math.abs(control.stopS - this.player.s) < 18 &&
      this.player.speed > 2
    ) {
      this.routeChoices = {};
      return;
    }
    if (
      this.time < this.nextRouteChoices &&
      this.routeChoicesOrigin &&
      dist(this.player, this.routeChoicesOrigin) < 10
    )
      return;
    this.nextRouteChoices = this.time + 4;
    this.routeChoicesOrigin = { x: this.player.x, z: this.player.z };
    const candidates = routesFromLocation(
      this.world,
      this.player,
      this.destinationApproach,
      this.destinationPoint,
    );
    const current = this.player.route.ids.join(",");
    const nearest = candidates[0];
    this.routeChoices = {};
    if (!nearest) return;
    const selected = candidates.filter(
      (c) =>
        !current.endsWith(c.route.ids.join(",")) &&
        c.distance < nearest.distance + 5,
    );
    for (const choice of selected) {
      // Retain genuinely different first streets/turns rather than duplicate paths.
      const key = choice.route.ids.slice(0, 3).join("_");
      if (this.routeChoices[key]) continue;
      this.routeChoices[key] = choice;
      if (Object.keys(this.routeChoices).length === 3) break;
    }
  }
  chooseRoute(id) {
    if (!this.routeChoiceNeeded()) return false;
    const next = this.routeChoices[id];
    if (
      !next ||
      !this.routeChoicesOrigin ||
      dist(this.player, this.routeChoicesOrigin) > 12
    )
      return false;
    const control = this.crossingFor(this.player);
    if (
      control &&
      Math.abs(control.stopS - this.player.s) < 18 &&
      this.player.speed > 2
    )
      return false;
    const entry = next.route.points.filter((p) => p.s <= next.progress + 60);
    const progress = nearestOnPath(
      this.player,
      entry.length > 1 ? entry : next.route.points,
    ).s;
    if (!this.installRoute({ ...next, progress })) return false;
    this.routeChoices = {};
    this.nextRouteChoices = this.time + 20;
    this.routeHoldUntil = this.time + 20;
    return true;
  }
  globalNavigation() {
    this.refreshRouteChoices();
    const v = this.player;
    const describe = (route, remaining, distance, relativeHeading = 0) => ({
      via: route.ids,
      remaining_m: round(remaining, 1),
      join_distance_m: round(distance, 1),
      heading_change_deg: round((relativeHeading * 180) / Math.PI, 1),
    });
    return {
      coordinates: "World meters: x east, z south; heading 0 north, 90 east",
      position: {
        x: round(v.x, 1),
        z: round(v.z, 1),
        heading_deg: round((v.heading * 180) / Math.PI, 1),
      },
      destination: {
        node: this.world.destination,
        x: this.destinationPoint.x,
        z: this.destinationPoint.z,
      },
      junctions: this.world.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        z: n.z,
        control: n.control,
      })),
      roads: this.world.edges.map((e) => [
        e.a,
        e.b,
        e.width,
        !!e.oneWay,
        e.speedLimit,
        e.kind ?? "street",
      ]),
      road_fields: [
        "from",
        "to",
        "width_m",
        "one_way",
        "speed_limit_mps",
        "kind",
      ],
      stopped_traffic: this.world.nodes.flatMap((n) => {
        const waiting = this.traffic.filter(
          (o) =>
            o.waitingSince != null &&
            this.time - o.waitingSince > 6 &&
            dist(o, n) < 24,
        );
        return waiting.length
          ? [{ junction: n.id, vehicles: waiting.length }]
          : [];
      }),
      routes: {
        keep: describe(
          v.route,
          v.route.length - v.s,
          nearestOnPath(v, v.route.points).distance,
        ),
        ...Object.fromEntries(
          Object.entries(this.routeChoices).map(([id, c]) => [
            id,
            describe(
              c.route,
              c.route.length - c.progress,
              c.distance,
              c.relativeHeading,
            ),
          ]),
        ),
      },
    };
  }
  navigation() {
    const v = this.player,
      near = nearestOnPath(v, v.route.points),
      look = pointAt(
        v.route.points,
        v.s + Math.max(5, Math.abs(v.speed) * 1.1),
      ),
      c = this.crossingFor(v);
    const turn = c ? angle(c.exit - c.approach) : 0;
    const nextTurn = c
      ? Math.abs(turn) > 3
        ? "uturn"
        : Math.abs(turn) < 0.3
          ? "straight"
          : turn > 0
            ? "right"
            : "left"
      : "arrive";
    const section = routeSection(v, near.s);
    const instructions = {
      local: [
        c?.nodeId === "mill-interchange" && nextTurn === "left"
          ? "Turn left onto the Interstate 08 entrance"
          : ["left", "right"].includes(nextTurn)
            ? `Turn ${nextTurn} through Millbrook`
            : "Continue through Millbrook",
        nextTurn,
      ],
      ramp_turn: ["Take the Interstate 08 North on-ramp", "left"],
      onramp: ["Join the acceleration lane", "merge"],
      merge: ["Merge onto Interstate 08", "merge"],
      interstate: ["Take the Cedar Town exit", "exit"],
      exit: ["Follow the Cedar Town off-ramp", "exit"],
      offramp: ["Enter Cedar Town", "straight"],
      town: ["Stop at the town destination", "arrive"],
    };
    return {
      remaining_m: round(Math.max(0, v.route.length - v.s)),
      route_version: this.routeVersion,
      rerouted: this.time - this.lastReroute < 3,
      route_offset_m: round(near.distance),
      heading_error_deg: round(
        (angle(heading(v, look) - v.heading) * 180) / Math.PI,
      ),
      lookahead: { x: round(look.x), z: round(look.z) },
      next_turn: nextTurn,
      turn_distance_m: round(
        c ? Math.max(0, c.stopS - v.s + 10) : v.route.length - v.s,
      ),
      destination: { id: this.world.destination, ...v.route.points.at(-1) },
      ...(section
        ? {
            phase: section.kind,
            instruction: instructions[section.kind][0],
            road_name: section.name,
            speed_limit_mps: section.speedLimit,
            next_turn: instructions[section.kind][1],
            turn_distance_m: round(
              Math.max(
                0,
                c && ["local", "ramp_turn"].includes(section.kind)
                  ? c.stopS - near.s + 10
                  : section.endS - near.s,
              ),
            ),
          }
        : {}),
    };
  }
  steeringCandidates() {
    const state = this.decisionState();
    return Object.fromEntries(
      Object.entries(state.vectors).map(([id, v]) => [
        id,
        {
          ...v,
          axis: v.steering,
          tracking_error: v.route_error_m,
        },
      ]),
    );
  }
  scanScene() {
    const v = this.player;
    const range = Math.max(80, Math.abs(v.speed) * 6);
    const buildings = this.world.objects.filter((o) => o.type === "building");
    const found = [];
    for (const o of [
      ...this.traffic,
      ...this.pedestrians,
      ...this.world.objects,
    ]) {
      if (
        ![
          "car",
          "motorcycle",
          "pedestrian",
          "building",
          "stop_sign",
          "traffic_light",
        ].includes(o.type)
      )
        continue;
      const dx = o.x - v.x,
        dz = o.z - v.z;
      const forward = dx * Math.sin(v.heading) - dz * Math.cos(v.heading);
      const right = dx * Math.cos(v.heading) + dz * Math.sin(v.heading);
      const distance = Math.hypot(dx, dz);
      const dynamic = ["car", "motorcycle", "pedestrian"].includes(o.type);
      if (
        distance > range ||
        (!dynamic &&
          Math.abs(Math.atan2(right, forward)) > (65 * Math.PI) / 180)
      )
        continue;
      if (blockedByBuilding(v, o, buildings, o.id)) continue;
      const previous = this.discovered.get(o.id);
      this.discovered.set(o.id, {
        first_seen_s: previous?.first_seen_s ?? round(this.time, 1),
        last_seen_s: round(this.time, 1),
        type: o.type,
      });
      found.push({
        id: o.id,
        type: o.type,
        ahead_m: round(forward, 1),
        right_m: round(right, 1),
        speed_mps: round(o.speed || 0, 1),
        ...(dynamic ? relativeTrafficState(v, o) : {}),
        ...(o.type === "traffic_light"
          ? {
              signal: signalState(
                this.world.byId[o.nodeId],
                this.time,
                o.approach,
              ).color,
            }
          : {}),
        ...(o.type === "pedestrian"
          ? { crossing: o.crossing && o.walking }
          : {}),
      });
    }
    this.perception = found.sort(
      (a, b) =>
        Math.hypot(a.ahead_m, a.right_m) - Math.hypot(b.ahead_m, b.right_m),
    );
    this.sensorRange = range;
  }
  decisionContextChanged(state) {
    const sent = state.scene?.intersection;
    const control = this.crossingFor(this.player);
    if ((sent?.node_id ?? null) !== (control?.nodeId ?? null)) return true;
    if (!control) return false;
    const current = this.rule(this.player);
    const memory = this.intersectionStopMemory(control);
    return (
      (sent.signal !== null && sent.signal !== current.color) ||
      sent.stop_completed !== current.stopCompleted ||
      sent.already_entered !== current.distance < -0.7 ||
      (sent.stop_memory?.stops_on_this_approach ?? 0) !==
        (memory?.stops_on_this_approach ?? 0)
    );
  }
  decisionState() {
    // Decisions use the current worker snapshot, not the previous sensor tick.
    this.scanScene();
    const nav = this.navigation(),
      env = this.speedEnvelope(this.player);
    const observed = new Set(this.perception.map((o) => o.id));
    const rearPressure = rearTrafficPressure(
      this.player,
      this.traffic.filter((o) => observed.has(o.id)),
    );
    const dynamic = this.perception
      .filter((o) => ["car", "motorcycle", "pedestrian"].includes(o.type))
      .sort(
        (a, b) =>
          Number(
            b.id === env.conflict?.object_id ||
              b.id === env.lead?.other.id ||
              b.id === rearPressure?.vehicle_id,
          ) -
          Number(
            a.id === env.conflict?.object_id ||
              a.id === env.lead?.other.id ||
              a.id === rearPressure?.vehicle_id,
          ),
      )
      .slice(0, 10);
    const control = this.crossingFor(this.player);
    const seenControl =
      control &&
      this.perception.some(
        (o) =>
          this.world.objects.find((w) => w.id === o.id)?.nodeId ===
          control.nodeId,
      );
    const uTurn = uTurnApproach(this.player);
    // Interstate ramps already have continuous section speed profiles. The
    // city-junction heuristic mistakes a sweeping ramp for a sharp turn.
    const turnCap = nav.phase
      ? Infinity
      : Math.abs(nav.heading_error_deg) > 15 ||
          (["left", "right"].includes(nav.next_turn) &&
            nav.turn_distance_m < 24)
        ? nav.next_turn === "right"
          ? 7
          : 8
        : ["left", "right"].includes(nav.next_turn) && nav.turn_distance_m < 48
          ? 12
          : this.world.theme.limit;
    const ceiling = round(
      Math.min(env.planningMax, uTurn?.speed_limit_mps ?? Infinity, turnCap),
      1,
    );
    const plan = createDrivingPlan(
      this.player,
      this.world,
      [
        ...this.world.objects.filter((o) => o.type === "building"),
        ...this.traffic,
        ...this.pedestrians,
      ],
      this.planRandom,
      `b${++this.planSequence}`,
      ceiling,
      env.rule,
    );
    this.lastPlan = plan;
    // Give Jev readable edges in normal driving. The raw mesh patches remain
    // in perception, and are also sent during off-road recovery for context.
    const { drivable_polygons, ...roadSummary } = plan.road;
    const state = {
      batch_id: plan.batch_id,
      route_version: this.routeVersion,
      global: this.globalNavigation(),
      driving_style: {
        name: "aggressive",
        description:
          "An aggressive, decisive driver who actively wants to make forward progress. Prefer the fastest useful maneuver and take available gaps promptly. Slowing down still means driving; a full stop needs a concrete current reason.",
        rules: [
          "A full-stop choice is offered only within 2.5 meters of a blocking object or a required stop line, at the destination, or when no eligible moving path exists. Otherwise choose a moving vector, reducing speed as needed. Uncertainty alone is not a reason to stop.",
          "When stopping behind a blocking object, close to within 2 meters bumper-to-object before coming to rest when space permits. Slow earlier as needed; do not park several car lengths back. An imminent collision can require braking sooner.",
          "For stop signs and red lights, stop right at the line with the front bumper about 0.5 meters before it, not farther back. A distant red light or stop sign is a reason to approach, not to stop immediately.",
          "Use a stop_at_line moving vector to approach an unserved stop sign or red light. It carries speed toward the line and then stops there; do not wait until 2.5 meters away to begin slowing. Once the stop is served or the light is green, choose a continuing path when clear.",
          "Remember a completed stop on this approach. Advance after an early stop, and proceed once the required stop is complete and the actual path is clear. Do not repeatedly stop for the same sign.",
          "At green lights or after a completed stop, move decisively through the junction. Yield only to actual conflicting priority traffic. Do not wait for the whole intersection to become empty.",
          "Accelerate along a clear on-ramp, match interstate traffic speed while merging, then accelerate to the cruising limit. A ramp-to-merge boundary is a continuous road, not a stop or a U-turn. Slow to fit behind another vehicle only when there is an actual merging conflict.",
          "A close or closing follower behind should motivate faster forward progress when the road ahead allows it. Traffic behind, alongside, or in the opposite lane is not itself a reason to brake.",
          "Stay in the right-hand lane, follow a normal traffic queue without passing, and use current signal and collision information. Later hypothetical conflicts are warnings to reassess, not immediate stop commands.",
        ],
      },
      speed_mps: round(this.player.speed, 1),
      braking: {
        max_deceleration_mps2: BRAKING,
        stopping_distance_m: round(this.player.speed ** 2 / (2 * BRAKING), 1),
        comfortable_stopping_distance_m: round(this.player.speed ** 2 / 7, 1),
        decision_allowance_m: round(Math.abs(this.player.speed) * 0.35, 1),
      },
      limit_mps: nav.speed_limit_mps ?? this.world.theme.limit,
      speed_ceiling_mps: plan.speedCap,
      speed_constraints: {
        traffic_and_destination_cap_mps: round(env.planningMax, 1),
        required_stop_approach: plan.stopApproach,
        uturn_approach: uTurn
          ? {
              curve_ahead_m: round(uTurn.distance_m, 1),
              approach_cap_mps: round(uTurn.speed_limit_mps, 1),
              curve_speed_mps: 3,
            }
          : null,
      },
      road: plan.recovery.active ? plan.road : roadSummary,
      lane: plan.lane,
      traffic: {
        queue: plan.queue,
        rear_pressure: rearPressure,
        stopped_for_s: round(
          this.player.waitingSince == null
            ? 0
            : this.time - this.player.waitingSince,
          1,
        ),
        deadlock_release: env.released,
      },
      recovery: plan.recovery,
      bend_deg: round(Math.abs(nav.heading_error_deg), 1),
      destination_m: round(nav.remaining_m, 1),
      turn: { direction: nav.next_turn, in_m: round(nav.turn_distance_m, 1) },
      ...(nav.phase
        ? {
            trip: {
              phase: nav.phase,
              instruction: nav.instruction,
              road: nav.road_name,
            },
          }
        : {}),
      scene: {
        blocking_object: plan.blockingObject,
        observed_at_s: round(this.time, 2),
        coordinates:
          "Car-relative meters: ahead_m is positive ahead and negative behind; right_m is positive to the right. heading_relative_deg=0 is the same direction, 180 is oncoming. Positive relative_velocity_ahead_mps means moving forward relative to this car.",
        traffic_view_deg: 360,
        range_m: Math.round(this.sensorRange),
        intersection: control
          ? {
              node_id: control.nodeId,
              control: this.world.byId[control.nodeId].control,
              signal: seenControl ? env.rule.color : null,
              visible: !!seenControl,
              stop_line_ahead_m: round(
                stopLineDistance(this.player, plan.stopLine),
                1,
              ),
              stop_line_position: {
                x: round(plan.stopLine.x, 1),
                z: round(plan.stopLine.z, 1),
              },
              already_entered: env.rule.distance < -0.7,
              stop_completed: env.rule.stopCompleted,
              stop_dwell_s: PLAYER_STOP_DWELL_S,
              stop_memory: this.intersectionStopMemory(control),
              earlier_arrivals: this.traffic
                .filter((other) => {
                  const stopped = other.stops[control.nodeId];
                  return (
                    stopped &&
                    !stopped.passed &&
                    this.crossingFor(other)?.nodeId === control.nodeId &&
                    stopped.arrived <
                      (this.player.stops[control.nodeId]?.arrived ?? Infinity)
                  );
                })
                .map((other) => other.id),
            }
          : null,
        nearby: dynamic,
        ...(env.lead && env.gap < this.sensorRange
          ? {
              following: {
                id: env.lead.other.id,
                gap_m: round(env.gap, 1),
                minimum_gap_m: round(
                  followingGap(this.player, env.lead.other),
                  1,
                ),
              },
            }
          : {}),
        ...(env.conflict
          ? {
              hazard: {
                id: env.conflict.object_id,
                type: env.conflict.type,
                applies_to: "current_maneuver",
                in_s: round(env.conflict.time_s, 1),
                ahead_m: env.conflict.ahead_m,
                right_m: env.conflict.right_m,
                relative_position: env.conflict.relative_position,
                distance_along_path_m: round(
                  env.conflict.distance_along_path_m,
                  1,
                ),
                braking_reduces_risk: env.conflict.braking_reduces_risk,
              },
            }
          : {}),
      },
      vectors: plan.vectors,
    };
    state.stop_availability = stopAvailability(state);
    if (!state.stop_availability.available) {
      state.vectors = Object.fromEntries(
        Object.entries(state.vectors).filter(
          ([, vector]) => vector.velocity_mps !== 0,
        ),
      );
      plan.vectors = state.vectors;
      for (const id of Object.keys(plan.projections))
        if (!Object.hasOwn(state.vectors, id)) delete plan.projections[id];
    }
    plan.eligible = candidateChoices(state);
    this.lastDecisionState = state;
    return state;
  }
  observation(full = false) {
    if (!this.lastPlan && !this.backgroundPlanning) this.decisionState();
    const v = this.player,
      buildings = this.world.objects.filter((o) => o.type === "building"),
      all = [
        ...this.traffic,
        ...this.pedestrians,
        ...this.world.objects.filter((o) => o.type !== "parcel"),
      ];
    const visible = [],
      occluded = [];
    for (const o of all) {
      const dx = o.x - v.x,
        dz = o.z - v.z,
        d = dist(v, o),
        f = dx * Math.sin(v.heading) - dz * Math.cos(v.heading),
        l = dx * Math.cos(v.heading) + dz * Math.sin(v.heading),
        bearing = (Math.atan2(l, f) * 180) / Math.PI;
      const dynamic = ["car", "motorcycle", "pedestrian"].includes(o.type);
      if (d > 80 || (!dynamic && Math.abs(bearing) > 65)) continue;
      if (blockedByBuilding(v, o, buildings, o.id)) {
        occluded.push(o.id);
        continue;
      }
      visible.push({
        id: o.id,
        type: o.type,
        position: { x: round(o.x), z: round(o.z) },
        distance_m: round(d),
        forward_m: round(f),
        right_m: round(l),
        bearing_deg: round(bearing),
        ...(dynamic ? relativeTrafficState(v, o) : {}),
        speed_mps: round(o.speed || 0),
        heading_deg:
          o.heading === undefined
            ? undefined
            : round((o.heading * 180) / Math.PI),
        dimensions: { width: o.width, depth: o.depth, height: o.height },
        style: o.style,
        signal:
          o.type === "traffic_light"
            ? signalState(this.world.byId[o.nodeId], this.time, o.approach)
                .color
            : undefined,
        walking: o.walking,
      });
    }
    visible.sort((a, b) => a.distance_m - b.distance_m);
    const env = this.speedEnvelope(v);
    const obs = {
      schema_version: "1.0",
      frame: {
        time_s: round(this.time),
        seed: this.world.seed,
        environment: this.world.type,
        coordinates:
          "meters; +x east, +z south; heading 0 north; positive steering right",
      },
      ego: {
        position: { x: round(v.x), y: 0.4, z: round(v.z) },
        heading_deg: round((v.heading * 180) / Math.PI),
        speed_mps: round(v.speed),
        steering_axis: round(v.steering),
        velocity_axis_mps: round(v.target),
        applied_velocity_mps: round(v.appliedTarget ?? v.target),
        dimensions: { width: v.width, length: v.depth },
        control: this.autopilot ? "jev" : "manual",
        pedals: this.autopilot ? null : { ...this.pedals },
      },
      navigation: this.navigation(),
      road_rules: {
        drive_on: "right",
        speed_limit_mps:
          routeSection(v, v.s)?.speedLimit ?? this.world.theme.limit,
        next_control: {
          ...env.rule,
          distance: round(
            Number.isFinite(env.rule.distance) ? env.rule.distance : 999,
          ),
        },
        lead_vehicle_gap_m: Number.isFinite(env.gap) ? round(env.gap) : null,
        stop_dwell_s: PLAYER_STOP_DWELL_S,
        amber_rule:
          "Stop if there is sufficient braking distance; otherwise clear the intersection",
      },
      sensor: {
        horizontal_fov_deg: 130,
        traffic_fov_deg: 360,
        range_m: 80,
        occlusion: "line of sight blocked by building footprints",
        visible_count: visible.length,
        occluded_count: occluded.length,
        visible_objects: visible,
        discovered_objects: Object.fromEntries(this.discovered),
        live_nearby: this.perception,
      },
      road: this.lastPlan?.road,
      recovery: this.lastPlan?.recovery,
      steering_candidates: this.lastPlan?.vectors || {},
      telemetry: {
        collisions: this.collisions,
        crash: this.crash,
        traffic_violations: this.violations,
        distance_driven_m: round(this.distance),
        arrived: this.complete,
        brake_intervention: this.brakeReason,
        predicted_conflict: env.conflict,
      },
    };
    if (full)
      obs.world = {
        bounds: this.world.bounds,
        start: this.world.route.points[0],
        destination: this.world.route.points.at(-1),
        junctions: this.world.nodes.map((n) => ({
          ...n,
          signal: signalState(n, this.time, 0),
        })),
        roads: this.world.edges,
        static_objects: this.world.objects,
        traffic_controls: this.world.objects
          .filter((o) => o.type === "traffic_light" || o.type === "stop_sign")
          .map((o) => ({
            id: o.id,
            node_id: o.nodeId,
            approach_heading_deg: round((o.approach * 180) / Math.PI),
            state:
              o.type === "stop_sign"
                ? { color: "stop" }
                : signalState(this.world.byId[o.nodeId], this.time, o.approach),
          })),
        vehicles: this.traffic.map(({ route, stops, ...o }) => ({
          ...o,
          route_node_ids: route.ids,
        })),
        pedestrians: this.pedestrians,
        planned_route: this.world.route,
        sensor_occluded_ids: occluded,
      };
    return obs;
  }
}
