import { clamp, dist, round, angle } from "./math.js";

/**
 * Multi-Agent Game Theory Traffic & Reflex Payoff Matrix Engine
 * JevPilot Reflex V5.0
 */

export const ACTION_NAMES = [
  { id: "keep_lane", name: "保持车道·平稳巡航", short: "保持巡航" },
  { id: "yield_decel", name: "防御让行·主动减速", short: "减速让行" },
  { id: "overtake_left", name: "向左变道·切出超车", short: "向左变道" },
  { id: "evade_right", name: "向右变道·边缘避让", short: "向右避让" },
  { id: "aeb_stop", name: "紧急制动·物理刹停", short: "紧急制动" },
];

export class GameTrafficManager {
  constructor(sim) {
    this.sim = sim;
    this.agents = [];
    this.keyAdversary = null;
    this.payoffMatrix = null;
    this.cutInTimer = 0;
    this.swarmActive = true;
    this.scenarioMode = "swarm"; // "swarm" | "cut_in" | "zipper_merge"
    this.zipperState = null;
    this.nextId = 1;
    this.initSwarm();
  }

  initSwarm() {
    this.agents = [];
    const player = this.sim.player;
    // Spawn 3 game-theoretic surrounding NPCs around player:
    // 1. Right-front aggressive car (potential cut-in agent)
    // 2. Left-rear fast overtaking car
    // 3. Front steady cruising leader
    this.spawnAgent({
      role: "cut_in",
      relAhead: 18,
      relRight: 3.5, // in right adjacent lane
      speed: Math.max(10, player.speed * 0.95),
      aggressiveness: 0.85,
      name: "NPC-01 (激进加塞车)",
      color: "#f59e0b", // Amber
    });

    this.spawnAgent({
      role: "overtake",
      relAhead: -14,
      relRight: -3.6, // in left adjacent lane
      speed: Math.max(12, player.speed * 1.15),
      aggressiveness: 0.70,
      name: "NPC-02 (左侧超车车)",
      color: "#06b6d4", // Cyan
    });

    this.spawnAgent({
      role: "lead",
      relAhead: 36,
      relRight: 0, // same lane
      speed: Math.max(11, player.speed * 0.98),
      aggressiveness: 0.40,
      name: "NPC-03 (前向巡航车)",
      color: "#a855f7", // Purple
    });
  }

  spawnAgent({ role, relAhead, relRight, speed, aggressiveness, name, color }) {
    const player = this.sim.player;
    const h = player.heading;
    const forwardX = Math.sin(h);
    const forwardZ = -Math.cos(h);
    const rightX = Math.cos(h);
    const rightZ = Math.sin(h);

    const x = player.x + forwardX * relAhead + rightX * relRight;
    const z = player.z + forwardZ * relAhead + rightZ * relRight;

    const agent = {
      id: `game-npc-${this.nextId++}`,
      name: name || `NPC-${this.nextId}`,
      role: role || "follow",
      state: role === "cut_in" ? "ready_cut_in" : "cruising",
      x,
      z,
      heading: h,
      speed,
      targetSpeed: speed,
      width: 1.9,
      depth: 4.5,
      color: color || "#e2e8f0",
      aggressiveness: aggressiveness || 0.6,
      lateralOffset: 0, // dynamic lateral shift in lane (m)
      lateralVelocity: 0,
      currentLaneRight: relRight,
      targetLaneRight: relRight,
      blinker: "none",
      blinkerTimer: 0,
      statusText: "自适应巡航",
      ttc: 9.9,
      gap: relAhead,
      cutInStage: 0, // 0: tracking, 1: signaling & edging, 2: cutting across, 3: completed
      isAdversary: role === "cut_in",
    };

    this.agents.push(agent);
    return agent;
  }

  triggerCutIn() {
    // Find or create a cut-in agent on the front right/left
    let candidate = this.agents.find(a => a.role === "cut_in" || a.state === "ready_cut_in");
    const player = this.sim.player;

    if (!candidate || dist(candidate, player) > 60) {
      // Reposition or spawn a fresh aggressive vehicle on right-front
      const h = player.heading;
      const x = player.x + Math.sin(h) * 16 + Math.cos(h) * 3.6;
      const z = player.z - Math.cos(h) * 16 + Math.sin(h) * 3.6;
      if (!candidate) {
        candidate = this.spawnAgent({
          role: "cut_in",
          relAhead: 16,
          relRight: 3.6,
          speed: Math.max(9, player.speed * 0.95),
          aggressiveness: 0.90,
          name: "NPC-加塞先锋",
          color: "#f59e0b",
        });
      }
      candidate.x = x;
      candidate.z = z;
      candidate.heading = h;
      candidate.currentLaneRight = 3.6;
      candidate.targetLaneRight = 3.6;
      candidate.lateralOffset = 0;
      candidate.speed = Math.max(9, player.speed * 0.95);
    }

    // Force trigger aggressive cut-in
    this.scenarioMode = "cut_in";
    this.zipperState = null;
    candidate.role = "cut_in";
    candidate.state = "aggressive_cut_in";
    candidate.cutInStage = 1;
    candidate.targetLaneRight = 0.0; // aim directly for player's center lane
    candidate.blinker = "left";
    candidate.statusText = "⚠️ 强行加塞并线中";
    candidate.aggressiveness = 0.92;
    this.keyAdversary = candidate;

    this.sim.event("⚡ 触发多车博弈场景：右侧 NPC 开启转向灯向自车强行加塞！", "warning");
    return candidate;
  }

  triggerZipperMerge() {
    this.scenarioMode = "zipper_merge";
    this.agents = [];
    const player = this.sim.player;

    // 1. M1: Mainline Lead Car (ahead in lane 0)
    const m1 = this.spawnAgent({
      role: "zipper_m1",
      relAhead: 28,
      relRight: 0,
      speed: Math.max(12, player.speed * 0.98),
      aggressiveness: 0.35,
      name: "NPC-M1 (主线前车)",
      color: "#a855f7",
    });
    m1.statusText = "主线先行通过 ✔";

    // 2. R1: First on-ramp merge vehicle (ahead right, descending ramp)
    const r1 = this.spawnAgent({
      role: "zipper_r1",
      relAhead: 13,
      relRight: 5.2,
      speed: Math.max(10.5, player.speed * 0.92),
      aggressiveness: 0.75,
      name: "NPC-R1 (匝道先锋)",
      color: "#10b981",
    });
    r1.blinker = "left";
    r1.currentLaneRight = 5.2;
    r1.targetLaneRight = 0.0;
    r1.statusText = "匝道第1顺位·交替切入中";

    // 3. R2: Second on-ramp vehicle (behind R1 on ramp, yields to Ego)
    const r2 = this.spawnAgent({
      role: "zipper_r2",
      relAhead: -5,
      relRight: 5.6,
      speed: Math.max(9.5, player.speed * 0.88),
      aggressiveness: 0.55,
      name: "NPC-R2 (匝道次车)",
      color: "#f59e0b",
    });
    r2.blinker = "left";
    r2.currentLaneRight = 5.6;
    r2.targetLaneRight = 5.6;
    r2.statusText = "匝道第2顺位·等候轮序";

    this.keyAdversary = r1;
    this.zipperState = {
      stage: "r1_merging", // "r1_merging" | "ego_passing" | "r2_merging" | "completed"
      slotGap: 14.5,
      cooperationScore: 98,
      flowEfficiency: 95.5,
      egoYielded: false,
    };

    this.sim.event("⫰ 触发高架匝道拉链式交替通行博弈 (Zipper Merge)！主线与匝道 1:1 交替汇流", "warning");
    return r1;
  }

  triggerTruckScenario() {
    this.scenarioMode = "truck_overtake";
    this.agents = [];
    const player = this.sim.player;

    // 1. NPC-Truck: 14m Heavy Container Truck ahead in lane 0
    const truck = this.spawnAgent({
      role: "truck",
      relAhead: 24,
      relRight: 0,
      speed: 7.2, // ~26 km/h slow crawl
      aggressiveness: 0.25,
      name: "NPC-重卡 (14米集装箱挂车)",
      color: "#1e3a8a",
    });
    truck.width = 2.5;
    truck.depth = 13.5;
    truck.statusText = "重载慢行 (26 km/h)";

    // 2. NPC-Left: Fast overtaking vehicle in left lane (-3.6m)
    const leftCar = this.spawnAgent({
      role: "truck_oncoming",
      relAhead: 70,
      relRight: -3.6,
      speed: 15.5,
      aggressiveness: 0.7,
      name: "NPC-左侧快车",
      color: "#06b6d4",
    });
    leftCar.statusText = "左侧快车后方逼近";

    this.keyAdversary = truck;
    this.truckState = {
      stage: "blocked_behind", // "blocked_behind" | "peeking_left" | "overtaking" | "completed"
      occlusionRatio: 88,
      peekOffset: 0,
      laneClearance: false,
      overtakeProgress: 0,
    };

    this.sim.event("🚚 触发大货车视觉遮挡与借道超车博弈！前视感知盲区达 88%，评估探头与超车策略", "warning");
    return truck;
  }

  update(dt) {
    if (!this.swarmActive || this.sim.paused || this.sim.crash) return;
    const player = this.sim.player;
    const roadSpeedLimit = 16.6; // ~60 km/h

    if (this.scenarioMode === "zipper_merge") {
      this.updateZipperTraffic(player, dt, roadSpeedLimit);
      this.payoffMatrix = this.evaluateZipperPayoffMatrix(player);
      return;
    }

    if (this.scenarioMode === "truck_overtake") {
      this.updateTruckTraffic(player, dt, roadSpeedLimit);
      this.payoffMatrix = this.evaluateTruckPayoffMatrix(player);
      return;
    }

    // Update each NPC agent
    for (const agent of this.agents) {
      this.updateAgent(agent, player, dt, roadSpeedLimit);
    }

    // Keep agents recycled around player if they drift too far (>120m)
    this.recycleAgents(player);

    // Compute Reflex Multi-Objective Payoff Matrix
    this.payoffMatrix = this.evaluatePayoffMatrix(player);
  }

  updateAgent(agent, player, dt, speedLimit) {
    const dx = agent.x - player.x;
    const dz = agent.z - player.z;
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);

    const relAhead = dx * sinH - dz * cosH;
    const relRight = dx * cosH + dz * sinH;
    agent.gap = relAhead;

    // Estimate TTC
    const closingSpeed = player.speed - agent.speed;
    agent.ttc = (closingSpeed > 0.5 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;

    // State machine for Cut-In
    if (agent.role === "cut_in") {
      this.updateCutInBehavior(agent, player, relAhead, relRight, dt);
    } else if (agent.role === "overtake") {
      this.updateOvertakeBehavior(agent, player, relAhead, relRight, dt);
    } else {
      // Default leader / follower
      this.updateCruisingBehavior(agent, player, relAhead, relRight, dt, speedLimit);
    }

    // Integrate longitudinal motion along road heading
    const forwardX = Math.sin(agent.heading);
    const forwardZ = -Math.cos(agent.heading);
    const rightX = Math.cos(agent.heading);
    const rightZ = Math.sin(agent.heading);

    agent.x += forwardX * agent.speed * dt + rightX * agent.lateralVelocity * dt;
    agent.z += forwardZ * agent.speed * dt + rightZ * agent.lateralVelocity * dt;

    // Slight yaw orientation angle proportional to lateral velocity (realistic car steering)
    const steerAngle = Math.atan2(agent.lateralVelocity, Math.max(2, agent.speed)) * 0.7;
    agent.heading = player.heading + steerAngle;
  }

  updateCutInBehavior(agent, player, relAhead, relRight, dt) {
    if (agent.state === "ready_cut_in") {
      // Pace with or slightly ahead of player
      const desiredAhead = 15;
      const error = desiredAhead - relAhead;
      agent.speed += clamp(error * 0.8, -2.5, 2.5) * dt;
      agent.blinker = "none";
      agent.statusText = "邻道伴航";
    } else if (agent.state === "aggressive_cut_in") {
      // Stage 1: Signaling, nudging laterally to probe player's reaction
      agent.blinker = "left";
      const lateralGap = relRight - agent.targetLaneRight; // target is 0 (player lane)

      // Game-theoretic interaction: Check if player is yielding or accelerating
      const playerYielding = (player.speed < agent.speed - 1.0) || (relAhead > 10);
      const playerBlocking = (player.speed >= agent.speed + 1.5) && (relAhead < 9);

      if (playerBlocking && agent.aggressiveness < 0.7) {
        // Conservative NPC aborts cut-in
        agent.targetLaneRight = 3.5;
        agent.statusText = "自车封堵·放弃加塞";
        agent.state = "aborted";
        agent.blinker = "none";
      } else {
        // NPC presses in!
        // Lateral velocity smoothly guides car toward center lane
        const desiredLatVel = -clamp(lateralGap * 1.4, 0.4, 2.2);
        agent.lateralVelocity += (desiredLatVel - agent.lateralVelocity) * 3.5 * dt;

        // Maintain speed advantage to complete cut-in
        const targetSpeed = Math.max(player.speed + 1.2, 11);
        agent.speed += clamp(targetSpeed - agent.speed, -3.0, 3.5) * dt;

        if (Math.abs(relRight) < 0.8) {
          // Successfully occupied lane center!
          agent.state = "cut_in_completed";
          agent.statusText = "已完成加塞·居中巡航";
          agent.blinker = "none";
          agent.lateralVelocity = 0;
          agent.targetLaneRight = 0;
        } else {
          agent.statusText = `加塞切入中 (横向间距 ${relRight.toFixed(1)}m)`;
        }
      }
    } else if (agent.state === "cut_in_completed") {
      // Now act as lead vehicle
      agent.blinker = "none";
      agent.lateralVelocity = 0;
      agent.statusText = "前车跟车巡航";
      // Maintain distance
      if (relAhead < 12) {
        agent.speed += 1.5 * dt;
      }
    }
  }

  updateOvertakeBehavior(agent, player, relAhead, relRight, dt) {
    // Fast vehicle passing on left lane
    agent.blinker = agent.speed > player.speed ? "none" : "left";
    const targetSpeed = 16.5; // ~60 km/h
    agent.speed += clamp(targetSpeed - agent.speed, -2, 2.5) * dt;
    agent.lateralVelocity = 0;
    agent.statusText = relAhead < 0 ? "左侧后向逼近" : "左侧超越完成";
  }

  updateCruisingBehavior(agent, player, relAhead, relRight, dt, speedLimit) {
    agent.blinker = "none";
    agent.lateralVelocity = 0;
    // IDM Car-following model if ahead of player
    if (relAhead > 0 && Math.abs(relRight) < 2.0) {
      // Keep comfortable 25m distance
      const desiredGap = 24;
      const gapDiff = relAhead - desiredGap;
      agent.speed += clamp(gapDiff * 0.4, -3.0, 2.0) * dt;
      agent.statusText = "前向稳态领驶";
    } else {
      agent.speed += clamp(speedLimit * 0.9 - agent.speed, -1.5, 1.5) * dt;
      agent.statusText = "标称巡航";
    }
  }

  recycleAgents(player) {
    for (const agent of this.agents) {
      const d = dist(agent, player);
      if (d > 130) {
        // Recycle ahead or behind
        const h = player.heading;
        const forward = (Math.random() > 0.4 ? 1 : -1) * (50 + Math.random() * 40);
        const laneIdx = (Math.floor(Math.random() * 3) - 1) * 3.6; // -3.6, 0, 3.6
        agent.x = player.x + Math.sin(h) * forward + Math.cos(h) * laneIdx;
        agent.z = player.z - Math.cos(h) * forward + Math.sin(h) * laneIdx;
        agent.heading = h;
        agent.speed = player.speed * (0.9 + Math.random() * 0.2);
        agent.lateralVelocity = 0;
        agent.blinker = "none";
        agent.state = "cruising";
        agent.statusText = "巡航重置";
      }
    }
  }

  /**
   * Evaluate Reflex Multi-Objective Payoff Matrix
   * Computes J_safe, J_eff, J_comf, and Expected Game Utility E[U] for all 5 candidate actions
   */
  evaluatePayoffMatrix(player) {
    const adversary = this.agents.find(a => a.role === "cut_in" || a.state.includes("cut_in")) || this.agents[0];
    const friction = this.sim.roadFriction || 0.9;
    const speed = player.speed;
    const speedLimit = 16.6; // 60 km/h

    // Distance and relative motion to key adversary
    const dx = adversary.x - player.x;
    const dz = adversary.z - player.z;
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);
    const relAhead = dx * sinH - dz * cosH;
    const relRight = dx * cosH + dz * sinH;
    const closingSpeed = speed - adversary.speed;
    const rawTTC = (closingSpeed > 0.2 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;
    const isCutInActive = adversary.state.includes("cut_in") || adversary.cutInStage > 0;

    // Weights: Safety is king, followed by efficiency and comfort
    const wSafe = 0.55;
    const wEff = 0.28;
    const wComf = 0.17;

    // Probabilities of adversary actions:
    // P_commit: adversary forces cut-in
    // P_yield: adversary gives up
    const pCommit = isCutInActive ? clamp(adversary.aggressiveness * 0.95, 0.4, 0.95) : 0.25;
    const pYield = 1.0 - pCommit;

    const rows = [];

    // 1. KEEP LANE (保持车道·平稳巡航)
    {
      // If adversary cuts in and we keep lane, risk of crash is high if TTC < 2.5s
      const minDistanceIfCommit = Math.max(0.5, relAhead - closingSpeed * 1.5);
      const safeScoreCommit = isCutInActive
        ? clamp((rawTTC - 1.0) / 2.5 * 100 * (friction / 0.9), 5, 95)
        : 95;
      const safeScoreYield = 92;
      const jSafe = round(safeScoreCommit * pCommit + safeScoreYield * pYield, 1);
      const jEff = round(clamp((speed / speedLimit) * 100, 40, 100), 1);
      const jComf = 95; // perfectly smooth, no jerk
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "keep_lane",
        name: "保持车道·平稳巡航",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: isCutInActive && rawTTC < 2.5 ? "⚠️ 存在切入冲突风险" : "标称均衡",
      });
    }

    // 2. DEFENSIVE YIELD (防御让行·主动减速)
    {
      // Slow down creates safe forward gap, high safety, moderate efficiency penalty
      const jSafe = round(clamp((rawTTC + 2.0) / 3.5 * 100 * (friction / 0.9), 60, 98), 1);
      const reducedSpeed = Math.max(5, speed * 0.8);
      const jEff = round(clamp((reducedSpeed / speedLimit) * 100, 30, 85), 1);
      const jComf = 88; // slight brake jerk
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "yield_decel",
        name: "防御让行·主动减速",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: isCutInActive ? "🛡️ 礼让保安全" : "减速冗余",
      });
    }

    // 3. OVERTAKE LEFT (向左变道·切出超车)
    {
      // Check left lane clearance (NPC-02 might be there)
      const leftOccupied = this.agents.some(a => a.id !== adversary.id && Math.abs(a.currentLaneRight - (-3.6)) < 1.8 && Math.abs(a.gap) < 14);
      const jSafe = leftOccupied ? 25 : round(clamp(88 * (friction / 0.9), 40, 92), 1);
      const jEff = 96; // fast bypass
      const jComf = 78; // lateral steering movement
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "overtake_left",
        name: "向左变道·切出超车",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: leftOccupied ? "❌ 左侧有后方逼近车" : "空隙充足可变道",
      });
    }

    // 4. EVADE RIGHT (向右变道·边缘避让)
    {
      // Right lane has adversary coming from it!
      const rightHazard = isCutInActive && relRight > 0;
      const jSafe = rightHazard ? 15 : 70;
      const jEff = 75;
      const jComf = 72;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "evade_right",
        name: "向右变道·边缘避让",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: rightHazard ? "❌ 严禁向加塞侧反切" : "备用空间受限",
      });
    }

    // 5. AEB STOP (紧急制动·物理刹停)
    {
      // Maximum safety clearance, zero efficiency, poor comfort
      const jSafe = (friction < 0.6) ? 75 : 94; // wet road brake slip penalty
      const jEff = 5;
      const jComf = 25; // max deceleration jerk
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "aeb_stop",
        name: "紧急制动·物理刹停",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: rawTTC < 1.2 ? "🚨 极度危急兜底" : "非必要急刹",
      });
    }

    // Determine Nash Best Response (highest expected utility)
    let bestIndex = 0;
    let maxU = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].expectedU > maxU) {
        maxU = rows[i].expectedU;
        bestIndex = i;
      }
    }
    rows[bestIndex].isBest = true;

    return {
      adversary: {
        id: adversary.id,
        name: adversary.name,
        role: adversary.role,
        statusText: adversary.statusText,
        aggressiveness: adversary.aggressiveness,
        gap: round(relAhead, 1),
        lateralGap: round(relRight, 1),
        ttc: round(rawTTC, 1),
        pCommit: round(pCommit * 100, 0),
      },
      rows,
      bestAction: rows[bestIndex],
      decisionRationale: this.composeRationale(rows[bestIndex], adversary, rawTTC, isCutInActive),
    };
  }

  composeRationale(best, adversary, ttc, isCutIn) {
    if (isCutIn) {
      if (best.id === "yield_decel") {
        return `博弈车 ${adversary.name} 加塞意图高 (${(adversary.aggressiveness * 100).toFixed(0)}%)，Reflex 纳什均衡选择 [防御让行] (期望收益 ${best.expectedU})，平滑降速化解右前交织冲突。`;
      } else if (best.id === "overtake_left") {
        return `右侧加塞逼近，Reflex 识别左侧净空足够，执行 [向左变道超车] (期望收益 ${best.expectedU})，兼顾安全与通行效率。`;
      } else if (best.id === "aeb_stop") {
        return `⚠️ TTC 压缩至极限 (${ttc.toFixed(1)}s)，Reflex 触发 [紧急制动] 物理安全兜底。`;
      }
    }
    return `路况畅通，Reflex 保持 [平稳巡航] (期望收益 ${best.expectedU})，多车博弈流处于稳定态。`;
  }

  updateZipperTraffic(player, dt, speedLimit) {
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);

    for (const agent of this.agents) {
      const dx = agent.x - player.x;
      const dz = agent.z - player.z;
      const relAhead = dx * sinH - dz * cosH;
      const relRight = dx * cosH + dz * sinH;
      agent.gap = relAhead;

      const closingSpeed = player.speed - agent.speed;
      agent.ttc = (closingSpeed > 0.5 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;

      if (agent.role === "zipper_m1") {
        agent.blinker = "none";
        agent.lateralVelocity = 0;
        agent.speed += clamp(speedLimit * 0.95 - agent.speed, -1.0, 1.5) * dt;
        agent.statusText = "主线先行通过 ✔";
      } else if (agent.role === "zipper_r1") {
        const isYielding = player.speed < agent.speed + 0.5 || relAhead > 8.0;
        const isBlocking = player.speed >= agent.speed + 2.0 && relAhead < 6.5;

        if (isBlocking) {
          agent.statusText = "⚠️ 主线封堵·匝道控速避碰";
          agent.speed += clamp(player.speed * 0.7 - agent.speed, -3.5, 0.5) * dt;
          if (this.zipperState) {
            this.zipperState.cooperationScore = Math.max(15, this.zipperState.cooperationScore - 12 * dt);
          }
        } else {
          agent.blinker = "left";
          const latDiff = relRight - 0.0;
          const desiredLatVel = -clamp(latDiff * 1.35, 0.35, 1.85);
          agent.lateralVelocity += (desiredLatVel - agent.lateralVelocity) * 3.2 * dt;
          agent.speed += clamp(Math.max(player.speed + 0.5, 11) - agent.speed, -1.5, 2.0) * dt;

          if (Math.abs(relRight) < 0.6) {
            agent.blinker = "none";
            agent.lateralVelocity = 0;
            agent.statusText = "已完成交替汇入 ✔";
            if (this.zipperState && this.zipperState.stage === "r1_merging") {
              this.zipperState.stage = "ego_passing";
              const r2Agent = this.agents.find(a => a.role === "zipper_r2");
              if (r2Agent) this.keyAdversary = r2Agent;
            }
          } else {
            agent.statusText = `匝道交替切入 (横向 ${relRight.toFixed(1)}m)`;
          }
        }
      } else if (agent.role === "zipper_r2") {
        if (!this.zipperState || this.zipperState.stage === "r1_merging" || this.zipperState.stage === "ego_passing") {
          agent.blinker = "left";
          agent.lateralVelocity = 0;
          agent.speed += clamp(Math.min(player.speed * 0.9, 10.5) - agent.speed, -2, 2) * dt;
          agent.statusText = "礼让自车·轮候等候";

          if (this.zipperState && this.zipperState.stage === "ego_passing" && relAhead < -6.5) {
            this.zipperState.stage = "r2_merging";
          }
        } else if (this.zipperState.stage === "r2_merging") {
          agent.blinker = "left";
          const latDiff = relRight - 0.0;
          const desiredLatVel = -clamp(latDiff * 1.3, 0.35, 1.8);
          agent.lateralVelocity += (desiredLatVel - agent.lateralVelocity) * 2.8 * dt;
          agent.speed += clamp(Math.max(player.speed, 11.5) - agent.speed, -1.5, 2.0) * dt;

          if (Math.abs(relRight) < 0.6) {
            agent.blinker = "none";
            agent.lateralVelocity = 0;
            agent.statusText = "次席汇流完成·恢复编队 ✔";
            this.zipperState.stage = "completed";
            this.sim.event("✔ 匝道拉链交替汇流全部完成！博弈协同度 100%", "success");
          } else {
            agent.statusText = `次车按序汇入中 (横向 ${relRight.toFixed(1)}m)`;
          }
        } else {
          agent.blinker = "none";
          agent.lateralVelocity = 0;
          agent.statusText = "跟车巡航";
        }
      }

      // Longitudinal motion integration
      const fX = Math.sin(agent.heading);
      const fZ = -Math.cos(agent.heading);
      const rX = Math.cos(agent.heading);
      const rZ = Math.sin(agent.heading);

      agent.x += fX * agent.speed * dt + rX * agent.lateralVelocity * dt;
      agent.z += fZ * agent.speed * dt + rZ * agent.lateralVelocity * dt;

      const steerAngle = Math.atan2(agent.lateralVelocity, Math.max(2, agent.speed)) * 0.6;
      agent.heading = player.heading + steerAngle;
    }

    // Dynamic slot distance calculation
    if (this.zipperState) {
      const r1 = this.agents.find(a => a.role === "zipper_r1");
      if (r1) {
        this.zipperState.slotGap = Math.max(0, r1.gap);
      }
    }
  }

  evaluateZipperPayoffMatrix(player) {
    const adversary = this.keyAdversary || this.agents.find(a => a.role === "zipper_r1") || this.agents[0];
    const friction = this.sim.roadFriction || 0.9;
    const speed = player.speed;

    const dx = adversary.x - player.x;
    const dz = adversary.z - player.z;
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);
    const relAhead = dx * sinH - dz * cosH;
    const relRight = dx * cosH + dz * sinH;
    const closingSpeed = speed - adversary.speed;
    const rawTTC = (closingSpeed > 0.2 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;

    const wSafe = 0.50;
    const wEff = 0.30;
    const wComf = 0.20;

    const stage = this.zipperState?.stage || "r1_merging";
    const pCommit = stage === "r1_merging" ? 0.90 : 0.40;

    const rows = [];

    // 1. ZIPPER YIELD (拉链礼让·主动留空)
    {
      const jSafe = round(clamp(96 * (friction / 0.9), 65, 99), 1);
      const jEff = stage === "r1_merging" ? 86 : 82;
      const jComf = 93;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "zipper_yield",
        name: "拉链礼让·主动留空",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: stage === "r1_merging" ? "⭐ 帕累托最优交替解" : "轮序保持",
      });
    }

    // 2. ZIPPER MERGE (合流切入·按序跟进)
    {
      const jSafe = stage === "r1_merging" ? 78 : 94;
      const jEff = 94;
      const jComf = 88;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "zipper_merge",
        name: "合流切入·按序跟进",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: stage === "ego_passing" ? "⭐ 顺位通过合流口" : "按序跟车",
      });
    }

    // 3. GREEDY BLOCK (强行封堵·拒绝交替)
    {
      const jSafe = 22; // High crash risk if forcing closure on merging vehicle
      const jEff = 95;
      const jComf = 42;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "greedy_block",
        name: "强行封堵·拒绝交替",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: "❌ 诱发汇流严重冲突",
      });
    }

    // 4. EVADE LEFT (向左变道·提前腾道)
    {
      const jSafe = 92;
      const jEff = 96;
      const jComf = 79;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "evade_left",
        name: "向左变道·提前腾道",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: "左道净空充足",
      });
    }

    // 5. AEB BRAKE (紧急制动·物理刹停)
    {
      const jSafe = round(84 * (friction / 0.9), 40, 90);
      const jEff = 5;
      const jComf = 20;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "aeb_brake",
        name: "紧急制动·物理刹停",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: "非危急兜底减速",
      });
    }

    // Pick best action based on stage and utility
    let bestIndex = 0;
    if (stage === "r1_merging") {
      bestIndex = 0; // zipper_yield
    } else if (stage === "ego_passing" || stage === "completed") {
      bestIndex = 1; // zipper_merge
    } else {
      let maxU = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].expectedU > maxU) {
          maxU = rows[i].expectedU;
          bestIndex = i;
        }
      }
    }
    rows[bestIndex].isBest = true;

    return {
      mode: "zipper_merge",
      zipperState: {
        stage: this.zipperState ? this.zipperState.stage : "r1_merging",
        slotGap: this.zipperState ? round(this.zipperState.slotGap, 1) : 14.5,
        cooperationScore: this.zipperState ? round(this.zipperState.cooperationScore, 0) : 98,
        flowEfficiency: this.zipperState ? round(this.zipperState.flowEfficiency, 1) : 95.5,
        tokens: [
          { id: "m1", label: "M1 主线", sub: "先行通过", status: "done" },
          { id: "r1", label: "R1 匝道", sub: stage === "r1_merging" ? "切入槽位中" : "汇入就位", status: stage === "r1_merging" ? "active" : "done" },
          { id: "ego", label: "Ego 自车", sub: stage === "r1_merging" ? "减速礼让" : (stage === "ego_passing" ? "领航通过" : "平稳巡航"), status: stage === "r1_merging" ? "yield" : (stage === "ego_passing" ? "active" : "done") },
          { id: "r2", label: "R2 匝道", sub: stage === "r2_merging" ? "跟进汇入" : (stage === "completed" ? "汇入完成" : "等候轮序"), status: stage === "r2_merging" ? "active" : (stage === "completed" ? "done" : "wait") },
        ],
      },
      adversary: {
        id: adversary.id,
        name: adversary.name,
        role: adversary.role,
        statusText: adversary.statusText,
        aggressiveness: adversary.aggressiveness,
        gap: round(relAhead, 1),
        lateralGap: round(relRight, 1),
        ttc: round(rawTTC, 1),
        pCommit: round(pCommit * 100, 0),
      },
      rows,
      bestAction: rows[bestIndex],
      decisionRationale: this.composeZipperRationale(rows[bestIndex], adversary, this.zipperState),
    };
  }

  composeZipperRationale(best, adversary, state) {
    const stage = state?.stage || "r1_merging";
    if (stage === "r1_merging") {
      return `高架合流口执行《交替通行准则》，Reflex 纳什均衡选择 [拉链礼让·主动留空] (期望收益 ${best.expectedU})，平滑控速为 R1 车腾出 14.5m 安全入槽空间，达成帕累托最优协同。`;
    } else if (stage === "ego_passing") {
      return `R1 匝道车已成功入槽，Reflex 切换至 [合流切入·按序跟进] (期望收益 ${best.expectedU})，自车顺位通过合流区，后方 R2 车自觉礼让。`;
    } else if (stage === "r2_merging") {
      return `自车已通过合流点，R2 匝道车正有序跟入自车车尾，Reflex 保持标称车道居中巡航。`;
    } else if (stage === "completed") {
      return `🎉 4 车拉链式交替通行博弈圆满完成！博弈协同度 100%，无制动休克，通行效率最优。`;
    }
    return `Reflex 监控多向复杂立体交织流，维持最优博弈均衡。`;
  }

  updateTruckTraffic(player, dt, speedLimit) {
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);

    const truck = this.agents.find(a => a.role === "truck");
    const leftCar = this.agents.find(a => a.role === "truck_oncoming");

    for (const agent of this.agents) {
      const dx = agent.x - player.x;
      const dz = agent.z - player.z;
      const relAhead = dx * sinH - dz * cosH;
      const relRight = dx * cosH + dz * sinH;
      agent.gap = relAhead;

      const closingSpeed = player.speed - agent.speed;
      agent.ttc = (closingSpeed > 0.5 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;

      if (agent.role === "truck") {
        agent.blinker = "none";
        agent.lateralVelocity = 0;
        agent.speed += clamp(7.2 - agent.speed, -1.0, 1.0) * dt;
        agent.statusText = "重载慢行 (26 km/h) · 视线严重遮挡";
      } else if (agent.role === "truck_oncoming") {
        agent.blinker = "none";
        agent.lateralVelocity = 0;
        agent.speed += clamp(15.5 - agent.speed, -1.0, 1.5) * dt;
        agent.statusText = relAhead < 0 ? "已超越自车" : "左侧快速逼近中";
      }

      const fX = Math.sin(agent.heading);
      const fZ = -Math.cos(agent.heading);
      const rX = Math.cos(agent.heading);
      const rZ = Math.sin(agent.heading);

      agent.x += fX * agent.speed * dt + rX * agent.lateralVelocity * dt;
      agent.z += fZ * agent.speed * dt + rZ * agent.lateralVelocity * dt;
      agent.heading = player.heading;
    }

    if (this.truckState && truck) {
      const distanceToTruck = Math.max(0.5, truck.gap);
      const leftClear = !leftCar || leftCar.gap < -6.0 || leftCar.gap > 50.0;
      this.truckState.laneClearance = leftClear;

      if (this.truckState.stage === "blocked_behind") {
        if (distanceToTruck < 28.0) {
          this.truckState.stage = "peeking_left";
        }
      } else if (this.truckState.stage === "peeking_left") {
        this.truckState.peekOffset = Math.min(0.85, this.truckState.peekOffset + 1.2 * dt);
        this.truckState.occlusionRatio = Math.max(28, Math.round(88 - this.truckState.peekOffset * 70));

        if (leftClear && player.speed > 8.0) {
          this.truckState.stage = "overtaking";
        }
      } else if (this.truckState.stage === "overtaking") {
        this.truckState.occlusionRatio = 0;
        if (truck.gap < -14.0) {
          this.truckState.stage = "completed";
          this.sim.event("✔ 成功完成大货车借道超车！前方视线完全通透，恢复车道居中巡航", "success");
        }
      }
    }
  }

  evaluateTruckPayoffMatrix(player) {
    const truck = this.agents.find(a => a.role === "truck") || this.agents[0];
    const leftCar = this.agents.find(a => a.role === "truck_oncoming");
    const friction = this.sim.roadFriction || 0.9;
    const speed = player.speed;

    const dx = truck.x - player.x;
    const dz = truck.z - player.z;
    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);
    const relAhead = dx * sinH - dz * cosH;
    const relRight = dx * cosH + dz * sinH;
    const closingSpeed = speed - truck.speed;
    const rawTTC = (closingSpeed > 0.2 && relAhead > 0) ? (relAhead / closingSpeed) : 9.9;

    const stage = this.truckState?.stage || "blocked_behind";
    const leftClear = this.truckState?.laneClearance ?? false;

    const wSafe = 0.52;
    const wEff = 0.32;
    const wComf = 0.16;

    const rows = [];

    // 1. PEEK LEFT (探头观测·微偏侦测)
    {
      const jSafe = 95.0;
      const jEff = 88.0;
      const jComf = 93.0;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "peek_left",
        name: "探头观测·微偏侦测",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: stage === "blocked_behind" || stage === "peeking_left" ? "⭐ 纳什最优·破除遮挡" : "视距已侦测",
      });
    }

    // 2. COMMIT OVERTAKE (借道超车·全力提速)
    {
      const jSafe = leftClear ? round(clamp(91.0 * (friction / 0.9), 70, 95), 1) : 25.0;
      const jEff = 98.0;
      const jComf = 85.0;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "commit_overtake",
        name: "借道超车·全力提速",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: leftClear ? (stage === "overtaking" ? "⭐ 提速超车中" : "左道净空充足") : "❌ 左道有快车交织",
      });
    }

    // 3. FOLLOW CRAWL (安全跟车·低速蠕行)
    {
      const jSafe = 96.0;
      const jEff = 28.0;
      const jComf = 95.0;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "follow_crawl",
        name: "安全跟车·低速蠕行",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: "效率极低·视线受阻",
      });
    }

    // 4. ABORT FALL BACK (放弃超车·切回原道)
    {
      const jSafe = 96.0;
      const jEff = 45.0;
      const jComf = 82.0;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "abort_overtake",
        name: "放弃超车·切回原道",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: leftClear ? "备用退路" : "⚠️ 避险退避",
      });
    }

    // 5. EMERGENCY BRAKE (紧急制动·防内轮差)
    {
      const jSafe = round(84.0 * (friction / 0.9), 40, 92);
      const jEff = 5.0;
      const jComf = 20.0;
      const expectedU = round(wSafe * jSafe + wEff * jEff + wComf * jComf, 1);
      rows.push({
        id: "emergency_brake",
        name: "紧急制动·防内轮差",
        jSafe,
        jEff,
        jComf,
        expectedU,
        status: rawTTC < 1.5 ? "🚨 极限安全刹车" : "非危急兜底",
      });
    }

    let bestIndex = 0;
    if (stage === "overtaking" && leftClear) {
      bestIndex = 1;
    } else if (stage === "completed") {
      bestIndex = 1;
    } else {
      bestIndex = 0;
    }
    rows[bestIndex].isBest = true;

    return {
      mode: "truck_overtake",
      truckState: {
        stage,
        occlusionRatio: this.truckState ? this.truckState.occlusionRatio : 88,
        peekOffset: this.truckState ? round(this.truckState.peekOffset, 2) : 0,
        laneClearance: leftClear,
        tokens: [
          { id: "blocked", label: "视线封锁", sub: `盲区率 ${this.truckState ? this.truckState.occlusionRatio : 88}%`, status: stage === "blocked_behind" ? "active" : "done" },
          { id: "peek", label: "探头微偏", sub: "微移 0.7m 侦测", status: stage === "peeking_left" ? "active" : (stage === "blocked_behind" ? "wait" : "done") },
          { id: "check", label: "左道核验", sub: leftClear ? "净空确认 ✔" : "快车逼近 ⏳", status: leftClear ? "done" : "wait" },
          { id: "overtake", label: "全力超车", sub: stage === "completed" ? "超车完成" : "提速借道", status: stage === "overtaking" ? "active" : (stage === "completed" ? "done" : "wait") },
        ],
      },
      adversary: {
        id: truck.id,
        name: truck.name,
        role: truck.role,
        statusText: truck.statusText,
        aggressiveness: truck.aggressiveness,
        gap: round(relAhead, 1),
        lateralGap: round(relRight, 1),
        ttc: round(rawTTC, 1),
        pCommit: this.truckState ? this.truckState.occlusionRatio : 88,
      },
      rows,
      bestAction: rows[bestIndex],
      decisionRationale: this.composeTruckRationale(rows[bestIndex], truck, this.truckState),
    };
  }

  composeTruckRationale(best, truck, state) {
    const stage = state?.stage || "blocked_behind";
    if (stage === "blocked_behind" || stage === "peeking_left") {
      return `前车为 14m 重型集装箱卡车，前向视距严重遮挡（盲区率 ${state?.occlusionRatio ?? 88}%）。Reflex 纳什最优解为 [探头观测·微偏侦测] (期望收益 ${best.expectedU})，在车道内向左微偏 0.7m 消除前视感知死角。`;
    } else if (stage === "overtaking") {
      return `探头侦测确认左道安全净空，Reflex 下发 [借道超车·全力提速] (期望收益 ${best.expectedU})，迅速超越大货车并远离大车右侧内轮差盲区。`;
    } else if (stage === "completed") {
      return `🎉 大货车借道超车顺利完成！自车重获 100% 前向高清视距，恢复标称巡航。`;
    }
    return `Reflex 监控重型货车遮挡博弈流，维持最优博弈均衡。`;
  }
}

