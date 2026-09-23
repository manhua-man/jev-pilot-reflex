import { Simulation } from "../src/simulation.js";
import { evaluate } from "../server/jev.js";
const sim = new Simulation(
  Number(process.env.SEED || 42),
  process.env.WORLD || "town",
);
sim.autopilot = true;
let calls = 0,
  cost = 0,
  inputTokens = 0,
  maxSpeed = 0;
const started = Date.now();
while (
  !sim.complete &&
  !sim.crash &&
  calls < Number(process.env.MAX_CALLS || 600)
) {
  const state = sim.decisionState();
  const decision = await evaluate(state, process.env);
  calls++;
  cost += decision.cost_usd;
  inputTokens += decision.usage.input_tokens;
  maxSpeed = Math.max(maxSpeed, sim.player.speed);
  sim.player.maneuver = state.vectors[decision.answers.vector.choice];
  sim.player.steering = decision.controls.steering;
  sim.player.target = decision.controls.velocity;
  for (let i = 0; i < 6; i++) sim.step(0.05);
  if (calls % 20 === 0 || calls === 1 || sim.complete)
    console.log(
      JSON.stringify({
        call: calls,
        seconds: Math.round(sim.time),
        remaining: sim.navigation().remaining_m,
        offset: sim.navigation().route_offset_m,
        speed: sim.player.speed,
        choice: [
          decision.answers.vector.choice,
          decision.controls.velocity,
        ],
        control: sim.rule(sim.player),
        safety: sim.brakeReason,
        collisions: sim.collisions,
        violations: sim.violations,
        cost,
      }),
    );
}
console.log(
  JSON.stringify({
    arrived: sim.complete,
    calls,
    cost,
    wall_seconds: (Date.now() - started) / 1000,
    average_input_tokens: Math.round(inputTokens / calls),
    max_speed_kmh: Math.round(maxSpeed * 3.6),
    seed: sim.world.seed,
    type: sim.world.type,
    events: sim.events,
  }),
);
if (!sim.complete || sim.collisions || sim.violations) process.exitCode = 1;
