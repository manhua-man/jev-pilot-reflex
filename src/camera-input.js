import { clamp } from "./math.js";

export class CameraInput {
  constructor(canvas, getMode) {
    this.getMode = getMode;
    this.reset();
    let pointer = null;
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const state = this.current();
      if (getMode() === "hood") {
        state.yaw = clamp(state.yaw + dx * 0.004, -2.1, 2.1);
        state.pitch = clamp(state.pitch - dy * 0.003, -0.65, 0.65);
      } else {
        state.yaw += dx * 0.005;
        state.pitch = clamp(state.pitch + dy * 0.004, 0.15, 1.48);
      }
    });
    const release = () => {
      pointer = null;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (getMode() === "hood") return;
        event.preventDefault();
        const state = this.current();
        state.distance = clamp(
          state.distance * Math.exp(event.deltaY * 0.001),
          getMode() === "map" ? 25 : 6,
          getMode() === "map" ? 220 : 60,
        );
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", () => this.reset());
  }
  current() {
    return this.states[this.getMode()];
  }
  reset() {
    this.states = {
      chase: { yaw: 0, pitch: 0.48, distance: 20 },
      map: { yaw: 0, pitch: 1.25, distance: 150 },
      hood: { yaw: 0, pitch: 0, distance: 0 },
    };
  }
}
