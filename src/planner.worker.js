import { Simulation } from "./simulation.js";
import { routeFromLocation } from "./routing.js";

let simulation, worldKey;
self.onmessage = ({ data }) => {
  const { id, key, seed, type, kind, snapshot } = data;
  try {
    if (!simulation || worldKey !== key) {
      simulation = new Simulation(seed, type);
      worldKey = key;
    }
    if (simulation.routeVersion !== snapshot.routeVersion) {
      simulation.routeChoices = {};
      simulation.nextRouteChoices = 0;
      simulation.routeChoicesOrigin = null;
    }
    Object.assign(simulation, snapshot, {
      locks: new Map(snapshot.locks),
      courtesy: new Map(snapshot.courtesy),
    });
    simulation.world.route = simulation.player.route;
    if (kind === "reroute") {
      self.postMessage({
        id,
        result: routeFromLocation(
          simulation.world,
          simulation.player,
          simulation.destinationApproach,
          simulation.destinationPoint,
        ),
      });
      return;
    }
    const state = simulation.decisionState();
    self.postMessage({
      id,
      result: {
        state,
        plan: simulation.lastPlan,
        routeChoices: simulation.routeChoices,
        routeChoicesOrigin: simulation.routeChoicesOrigin,
        nextRouteChoices: simulation.nextRouteChoices,
      },
    });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
