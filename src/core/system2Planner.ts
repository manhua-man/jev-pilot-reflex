import type { PerceptionFrame, System2Guidance, LaneIndex } from '../types';

export class System2Planner {
  private isThinking: boolean = false;
  private currentGuidance: System2Guidance = {
    strategicSpeedKmh: 100,
    preferredLane: 1,
    riskAssessment: 'low',
    macroAdvice: '常规巡航：路况开阔，推荐居中车道以 100 km/h 巡航。',
    timestamp: Date.now(),
  };

  public getGuidance(): System2Guidance {
    return this.currentGuidance;
  }

  public isBusy(): boolean {
    return this.isThinking;
  }

  /**
   * Dispatches an asynchronous reasoning cycle (simulating a 500ms+ LLM/VLM call).
   * Notice that this function does not block the caller!
   */
  public requestStrategicUpdate(frame: PerceptionFrame, onComplete?: (guidance: System2Guidance) => void): void {
    if (this.isThinking) return; // Prevent queue buildup

    this.isThinking = true;
    const latency = Math.floor(Math.random() * 300 + 450); // 450-750ms inference latency

    window.setTimeout(() => {
      let advice = '常规巡航：前方视野良好，维持中道 100 km/h 高效通行。';
      let targetLane: LaneIndex = 1;
      let targetSpeed = 100;
      let risk: 'low' | 'medium' | 'high' = 'low';

      if (frame.leadObstacle && frame.leadObstacle.relativeDistance < 50) {
        risk = 'medium';
        if (!frame.leftObstacle && frame.ego.laneIndex > 0) {
          targetLane = (frame.ego.laneIndex - 1) as LaneIndex;
          advice = '策略建议：前车车速较慢，左侧快车道安全，建议在确认盲区后适时借道超车。';
        } else {
          targetSpeed = 80;
          advice = '策略建议：前向交通流变密，建议跟车并拉大时距至 3 秒，避免急加速。';
        }
      }

      if (frame.minTtc < 3.0) {
        risk = 'high';
        advice = '高危预警：前向相对减速过猛，启动防撞监控，允许反射小脑进行优先接管。';
      }

      this.currentGuidance = {
        strategicSpeedKmh: targetSpeed,
        preferredLane: targetLane,
        riskAssessment: risk,
        macroAdvice: advice,
        timestamp: Date.now(),
      };

      this.isThinking = false;
      onComplete?.(this.currentGuidance);
    }, latency);
  }
}
