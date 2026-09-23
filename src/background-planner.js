// One background worker owns candidate sampling and route searches.
// The UI sends snapshots; physics and rendering never await a planning result.
export class BackgroundPlanner {
  constructor() {
    this.worker = new Worker(new URL("./planner.worker.js", import.meta.url), {
      type: "module",
    });
    this.pending = new Map();
    this.sequence = 0;
    this.epoch = 0;
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      this.pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
    this.worker.onerror = (event) => {
      this.failure = new Error(
        event.message || "Background planner unavailable",
      );
      for (const job of this.pending.values()) {
        clearTimeout(job.timeout);
        job.reject(this.failure);
      }
      this.pending.clear();
    };
  }
  reset() {
    this.epoch++;
  }
  run(kind, sim) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    const snapshot = {
      time: sim.time,
      player: sim.player,
      traffic: sim.traffic,
      pedestrians: sim.pedestrians,
      perception: sim.perception,
      sensorRange: sim.sensorRange,
      locks: [...sim.locks],
      courtesy: [...sim.courtesy],
      freeExplore: sim.freeExplore,
      complete: sim.complete,
      autopilot: sim.autopilot,
      routeVersion: sim.routeVersion,
      destinationApproach: sim.destinationApproach,
      destinationPoint: sim.destinationPoint,
      offRouteSince: sim.offRouteSince,
      lastReroute: sim.lastReroute,
      routeHoldUntil: sim.routeHoldUntil,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Background planning timed out"));
      }, 8000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.worker.postMessage({
          id,
          kind,
          key: `${this.epoch}:${sim.world.type}:${sim.world.seed}`,
          seed: sim.world.seed,
          type: sim.world.type,
          snapshot,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  dispose() {
    this.worker.terminate();
    for (const job of this.pending.values()) {
      clearTimeout(job.timeout);
      job.reject(new Error("Planner stopped"));
    }
    this.pending.clear();
  }
}
