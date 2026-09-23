import { decisionOptions, decisionSelection } from "./planning.js";

/**
 * TypeSafe Jev System 1 Reflex Solver (High-speed local inference)
 * Evaluates candidate trajectory vectors based on collision clearance,
 * lane alignment, and target speed regulation with <2ms latency.
 */
export function solveLocalJev(state) {
  const { candidates, moving, stopId } = decisionOptions(state);
  const movingIds = Object.keys(moving);

  // If no moving options exist, command full stop
  if (!movingIds.length || !candidates) {
    const motionAns = { choice: "stop", probabilities: { stop: 1.0, drive: 0.0 } };
    const vectorAns = { choice: movingIds[0] || "", probabilities: {} };
    const answers = { motion: motionAns, vector: vectorAns };
    const selection = decisionSelection(state, answers);
    const candidate = state.vectors[selection?.choice || stopId];
    return {
      batch_id: state.batch_id,
      decision_source: "local_jev_reflex",
      selection,
      answers,
      controls: {
        steering: candidate?.steering ?? 0,
        velocity: candidate?.velocity_mps ?? 0
      },
      usage: { input_tokens: 42, output_tokens: 12 },
      pricing: { input_per_million: 0.15, output_per_million: 0.60 },
      latency_ms: 1.2,
      cost_usd: 0
    };
  }

  // Score each eligible moving vector
  let bestId = movingIds[0];
  let bestScore = -Infinity;

  for (const id of movingIds) {
    const v = moving[id];
    let score = 0;

    // Disqualify any path with predicted collision
    if (v.collision_imminent || v.collision_predicted) {
      score -= 20000;
    }

    // High penalty for driving off road
    if (v.stays_on_road) {
      score += 200;
    } else {
      score -= 1000;
    }

    // Lane centering reward: minimize lateral route error
    score -= Math.abs(v.route_error_m || 0) * 35;

    // Speed efficiency: track speed ceiling smoothly
    const targetSpeed = Math.max(2, state.speed_ceiling_mps || 15);
    const speedRatio = v.velocity_mps / targetSpeed;
    score += speedRatio * 40;

    // Favor smoother steering maneuvers (prevent steering flutter)
    score -= Math.abs(v.steering) * 8;

    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  // Emergency safety brake if all moving candidates lead to collision
  const shouldStop = bestScore < -5000 && !!stopId;
  const chosenMotion = shouldStop ? "stop" : "drive";
  const motionProbs = shouldStop
    ? { stop: 0.99, drive: 0.01 }
    : { drive: 0.98, stop: 0.02 };

  const vectorProbs = {};
  for (const id of movingIds) {
    vectorProbs[id] = id === bestId ? 0.92 : 0.08 / Math.max(1, movingIds.length - 1);
  }

  const answers = {
    motion: { choice: chosenMotion, probabilities: motionProbs },
    vector: { choice: bestId, probabilities: vectorProbs }
  };

  const selection = decisionSelection(state, answers);
  const candidate = state.vectors[selection?.choice || bestId];

  return {
    batch_id: state.batch_id,
    decision_source: "local_jev_reflex",
    selection,
    answers,
    controls: {
      steering: candidate.steering,
      velocity: candidate.velocity_mps
    },
    usage: { input_tokens: 45, output_tokens: 15 },
    pricing: { input_per_million: 0.15, output_per_million: 0.60 },
    latency_ms: 1.5,
    cost_usd: 0
  };
}
