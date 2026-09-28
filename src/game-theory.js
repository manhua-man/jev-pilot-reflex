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

  update(dt) {
    if (!this.swarmActive || this.sim.paused || this.sim.crash) return;
    const player = this.sim.player;
    const roadSpeedLimit = 16.6; // ~60 km/h

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
}
