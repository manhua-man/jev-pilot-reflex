export type LaneIndex = 0 | 1 | 2; // 0: Left, 1: Center, 2: Right

export interface VehicleTelemetry {
  speedKmh: number;
  speedMps: number;
  acceleration: number;
  laneIndex: LaneIndex;
  laneOffset: number; // Lateral offset from lane center (-1.0 to 1.0)
  x: number;
  z: number;
}

export interface ObstacleInfo {
  id: string;
  type: 'vehicle' | 'truck' | 'debris' | 'hazard';
  laneIndex: LaneIndex;
  relativeDistance: number; // in meters (positive = ahead)
  relativeSpeed: number; // in m/s (negative = getting closer)
  ttc: number; // Time To Collision in seconds (Infinity if safe)
}

export interface PerceptionFrame {
  ego: VehicleTelemetry;
  leadObstacle: ObstacleInfo | null;
  leftObstacle: ObstacleInfo | null;
  rightObstacle: ObstacleInfo | null;
  minTtc: number;
  speedLimitKmh: number;
  timestamp: number;
}

export type JevReflexAction =
  | 'ADAPTIVE_CRUISE'
  | 'FOLLOW_LEAD'
  | 'DECELERATE'
  | 'LANE_CHANGE_LEFT'
  | 'LANE_CHANGE_RIGHT'
  | 'EMERGENCY_BRAKE'
  | 'SWERVE_EVADE';

export interface ReflexDecision {
  action: JevReflexAction;
  confidence: number;
  latencyMs: number;
  throttle: number; // 0.0 to 1.0
  brake: number; // 0.0 to 1.0
  targetLaneIndex: LaneIndex;
  steering: number; // -1.0 (left) to 1.0 (right)
  safetyGateIntervened: boolean;
  overrideReason?: string;
}

export interface System2Guidance {
  strategicSpeedKmh: number;
  preferredLane: LaneIndex;
  riskAssessment: 'low' | 'medium' | 'high';
  macroAdvice: string;
  timestamp: number;
}
