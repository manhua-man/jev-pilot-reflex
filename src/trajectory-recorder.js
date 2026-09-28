/**
 * Jev Trajectory Dataset Recorder
 * Records high-fidelity [State -> Action -> Reward] tuples at 10Hz
 * for offline Behavior Cloning (BC) and Reinforcement Learning (RL).
 */

export class TrajectoryRecorder {
  constructor(sim, gameManager) {
    this.sim = sim;
    this.gameManager = gameManager;
    this.isRecording = false;
    this.samples = [];
    this.lastSampleTime = 0;
    this.sampleInterval = 0.1; // 10 Hz
    this.sessionId = `session_${Date.now()}`;
  }

  toggle() {
    this.isRecording = !this.isRecording;
    if (this.isRecording) {
      this.samples = [];
      this.lastSampleTime = 0;
      this.sessionId = `session_${Date.now()}`;
      return { active: true, count: 0 };
    } else {
      const count = this.samples.length;
      if (count > 0) {
        this.downloadDataset();
      }
      return { active: false, count };
    }
  }

  update(time) {
    if (!this.isRecording || this.sim.paused || this.sim.crash) return;
    if (time - this.lastSampleTime < this.sampleInterval) return;
    this.lastSampleTime = time;

    const v = this.sim.player;
    const nav = this.sim.navigation();
    const gm = this.gameManager;
    const adv = gm?.keyAdversary || null;
    const bestPayoff = gm?.payoffMatrix?.matrix?.[0] || null;

    // Relative distance & heading error to centerline
    const pathPoint = v.route ? v.route.points[Math.min(v.route.points.length - 1, Math.max(0, Math.floor(v.s)))] : null;
    let headingError = 0;
    if (pathPoint && pathPoint.heading !== undefined) {
      let diff = v.heading - pathPoint.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      headingError = diff;
    }

    const sample = {
      id: this.samples.length,
      t: Number(time.toFixed(3)),
      // 1. Ego State Features (S_t)
      state: {
        speed: Number(v.speed.toFixed(3)),
        heading: Number(v.heading.toFixed(3)),
        heading_error: Number(headingError.toFixed(3)),
        wheel_steer: Number((v.wheelSteering ?? v.steering ?? 0).toFixed(3)),
        road_friction: Number((this.sim.roadFriction ?? 0.9).toFixed(2)),
        speed_limit: Number((nav.speed_limit_mps ?? 16.6).toFixed(2)),
        remaining_m: Number(nav.remaining_m.toFixed(1)),
        // Game-theory adversary context
        scenario: gm?.scenarioMode || "cruising",
        adv_rel_ahead: adv ? Number(adv.gap.toFixed(2)) : 99.0,
        adv_rel_right: adv ? Number((adv.currentLaneRight ?? 0).toFixed(2)) : 0.0,
        adv_ttc: adv ? Number(Math.min(9.9, adv.ttc).toFixed(2)) : 9.9,
        adv_speed: adv ? Number(adv.speed.toFixed(2)) : 0.0,
      },
      // 2. Control Action Ground Truth (A_t)
      action: {
        steering: Number(v.steering.toFixed(3)),
        target_velocity: Number(v.target.toFixed(3)),
        throttle: Number((this.sim.pedals?.throttle ?? 0).toFixed(2)),
        brake: Number((this.sim.pedals?.brake ?? 0).toFixed(2)),
      },
      // 3. Multi-Objective Payoff & Rewards (R_t)
      rewards: {
        j_safe: bestPayoff?.safe ?? 95.0,
        j_eff: bestPayoff?.eff ?? 80.0,
        j_comf: bestPayoff?.comf ?? 90.0,
        utility: bestPayoff?.utility ?? 88.0,
      },
    };

    this.samples.push(sample);
  }

  downloadDataset() {
    if (!this.samples.length) return;
    const metadata = {
      dataset_name: "jev_pilot_trajectory_dataset",
      session_id: this.sessionId,
      recorded_at: new Date().toISOString(),
      sample_rate_hz: 10,
      total_frames: this.samples.length,
      feature_dim: 11,
      action_dim: 2,
      world_type: this.sim.world.type,
      world_seed: this.sim.world.seed,
    };

    const payload = {
      metadata,
      samples: this.samples,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jev-trajectory-${this.sim.world.type}-${this.samples.length}pts.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }
}
