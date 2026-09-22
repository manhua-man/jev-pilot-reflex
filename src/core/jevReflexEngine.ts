import type {
  PerceptionFrame,
  ReflexDecision,
  System2Guidance,
  LaneIndex,
} from '../types';

export class JevReflexEngine {
  /**
   * Evaluates the perception frame and returns a typed reflex decision.
   * Execution budget: < 15ms.
   */
  public evaluate(
    frame: PerceptionFrame,
    guidance: System2Guidance | null
  ): ReflexDecision {
    const startTime = performance.now();
    const ego = frame.ego;
    const lead = frame.leadObstacle;
    const targetSpeedKmh = guidance?.strategicSpeedKmh ?? frame.speedLimitKmh;
    const preferredLane = guidance?.preferredLane ?? 1;

    // 1. HARD SAFETY BRAKE CHECK (AI 安全闸：基于动力学 TTC 的第一优先裁决)
    // 物理防线：无论 System 2 发出何种指令，若 TTC < 1.6s 且前向距离危险，立即强制截断！
    if (lead && lead.relativeDistance < 60) {
      if (lead.ttc < 1.6 || (lead.relativeDistance < 15 && ego.speedKmh > 30)) {
        const latency = performance.now() - startTime + (Math.random() * 4 + 6); // ~6-10ms simulated Jev latency
        return {
          action: 'EMERGENCY_BRAKE',
          confidence: 0.99,
          latencyMs: Number(latency.toFixed(1)),
          throttle: 0,
          brake: 1.0, // 100% 最大刹车压力
          targetLaneIndex: ego.laneIndex,
          steering: 0,
          safetyGateIntervened: true,
          overrideReason: `TTC (${lead.ttc.toFixed(2)}s < 1.60s) 临界报警！安全闸强制接管线控，施加全负荷减速。`,
        };
      }

      // 2. EVASIVE SWERVE CHECK (当距离紧迫且侧方车道具备安全变道空档时)
      if (lead.ttc < 2.5 && lead.relativeDistance < 35 && ego.speedKmh > 50) {
        // Check if left lane is clear
        if (ego.laneIndex > 0 && !frame.leftObstacle) {
          const targetLane: LaneIndex = (ego.laneIndex - 1) as LaneIndex;
          const latency = performance.now() - startTime + (Math.random() * 4 + 7);
          return {
            action: 'SWERVE_EVADE',
            confidence: 0.92,
            latencyMs: Number(latency.toFixed(1)),
            throttle: 0.3,
            brake: 0.4,
            targetLaneIndex: targetLane,
            steering: -0.6,
            safetyGateIntervened: true,
            overrideReason: `前车急减速 (TTC ${lead.ttc.toFixed(1)}s)，向左侧空闲车道执行紧急避险变道。`,
          };
        }
        // Check if right lane is clear
        if (ego.laneIndex < 2 && !frame.rightObstacle) {
          const targetLane: LaneIndex = (ego.laneIndex + 1) as LaneIndex;
          const latency = performance.now() - startTime + (Math.random() * 4 + 7);
          return {
            action: 'SWERVE_EVADE',
            confidence: 0.92,
            latencyMs: Number(latency.toFixed(1)),
            throttle: 0.3,
            brake: 0.4,
            targetLaneIndex: targetLane,
            steering: 0.6,
            safetyGateIntervened: true,
            overrideReason: `前车急减速 (TTC ${lead.ttc.toFixed(1)}s)，向右侧空闲车道执行紧急避险变道。`,
          };
        }
      }
    }

    // 3. REGULAR TRAFFIC FLOW & ADAPTIVE CRUISE DECISIONS
    // A: Follow lead vehicle smoothly if approaching
    if (lead && lead.relativeDistance < 45) {
      // If lead is significantly slower than our target speed
      if (lead.relativeSpeed < -2) {
        // Can we overtake?
        if (ego.laneIndex > 0 && !frame.leftObstacle) {
          const latency = performance.now() - startTime + (Math.random() * 5 + 6);
          return {
            action: 'LANE_CHANGE_LEFT',
            confidence: 0.88,
            latencyMs: Number(latency.toFixed(1)),
            throttle: 0.6,
            brake: 0,
            targetLaneIndex: (ego.laneIndex - 1) as LaneIndex,
            steering: -0.4,
            safetyGateIntervened: false,
          };
        }

        const latency = performance.now() - startTime + (Math.random() * 5 + 6);
        return {
          action: 'DECELERATE',
          confidence: 0.94,
          latencyMs: Number(latency.toFixed(1)),
          throttle: 0,
          brake: 0.45,
          targetLaneIndex: ego.laneIndex,
          steering: 0,
          safetyGateIntervened: false,
        };
      }

      // Maintain safe following distance (e.g. 2s headway)
      const latency = performance.now() - startTime + (Math.random() * 5 + 6);
      return {
        action: 'FOLLOW_LEAD',
        confidence: 0.96,
        latencyMs: Number(latency.toFixed(1)),
        throttle: 0.45,
        brake: 0.05,
        targetLaneIndex: ego.laneIndex,
        steering: 0,
        safetyGateIntervened: false,
      };
    }

    // B: Return to preferred lane if clear (from System 2 strategic advice)
    if (ego.laneIndex !== preferredLane) {
      if (preferredLane < ego.laneIndex && !frame.leftObstacle) {
        const latency = performance.now() - startTime + (Math.random() * 4 + 7);
        return {
          action: 'LANE_CHANGE_LEFT',
          confidence: 0.91,
          latencyMs: Number(latency.toFixed(1)),
          throttle: 0.7,
          brake: 0,
          targetLaneIndex: (ego.laneIndex - 1) as LaneIndex,
          steering: -0.35,
          safetyGateIntervened: false,
        };
      }
      if (preferredLane > ego.laneIndex && !frame.rightObstacle) {
        const latency = performance.now() - startTime + (Math.random() * 4 + 7);
        return {
          action: 'LANE_CHANGE_RIGHT',
          confidence: 0.91,
          latencyMs: Number(latency.toFixed(1)),
          throttle: 0.7,
          brake: 0,
          targetLaneIndex: (ego.laneIndex + 1) as LaneIndex,
          steering: 0.35,
          safetyGateIntervened: false,
        };
      }
    }

    // C: Free Cruise
    const currentSpeed = ego.speedKmh;
    const latency = performance.now() - startTime + (Math.random() * 4 + 6);
    if (currentSpeed < targetSpeedKmh - 2) {
      return {
        action: 'ADAPTIVE_CRUISE',
        confidence: 0.98,
        latencyMs: Number(latency.toFixed(1)),
        throttle: 0.8,
        brake: 0,
        targetLaneIndex: ego.laneIndex,
        steering: 0,
        safetyGateIntervened: false,
      };
    } else if (currentSpeed > targetSpeedKmh + 2) {
      return {
        action: 'ADAPTIVE_CRUISE',
        confidence: 0.98,
        latencyMs: Number(latency.toFixed(1)),
        throttle: 0,
        brake: 0.2,
        targetLaneIndex: ego.laneIndex,
        steering: 0,
        safetyGateIntervened: false,
      };
    }

    return {
      action: 'ADAPTIVE_CRUISE',
      confidence: 0.99,
      latencyMs: Number(latency.toFixed(1)),
      throttle: 0.35,
      brake: 0,
      targetLaneIndex: ego.laneIndex,
      steering: 0,
      safetyGateIntervened: false,
    };
  }
}
