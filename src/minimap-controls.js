import { clamp } from "./math.js";

export class MinimapControls {
  constructor(panel, simulation, redraw) {
    this.panel = panel;
    this.simulation = simulation;
    this.redraw = redraw;
    this.zoom = 1;
    this.center = null;
    this.heading = null;
    this.position = null;
    this.events = new AbortController();
    const on = (target, type, handler, options = {}) =>
      target.addEventListener(type, handler, {
        ...options,
        signal: this.events.signal,
      });
    const canvas = panel.querySelector("canvas");
    const grip = panel.querySelector("#map-drag");
    this.zoomIn = panel.querySelector("#map-zoom-in");
    this.zoomOut = panel.querySelector("#map-zoom-out");
    on(this.zoomIn, "click", () => this.setZoom(this.zoom * 1.25));
    on(this.zoomOut, "click", () => this.setZoom(this.zoom / 1.25));
    on(panel.querySelector("#map-reset"), "click", () => {
      this.position = null;
      for (const property of ["position", "left", "top", "bottom"])
        panel.style.removeProperty(property);
      this.resetView();
    });
    on(
      canvas,
      "wheel",
      (event) => {
        event.preventDefault();
        this.setZoom(
          this.zoom * Math.exp(-clamp(event.deltaY, -100, 100) * 0.005),
        );
      },
      { passive: false },
    );
    on(canvas, "dblclick", () => this.resetView());

    const drag = (handle, start, move, className) => {
      let state = null;
      on(handle, "pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        state = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          ...start(),
        };
        handle.setPointerCapture(event.pointerId);
        panel.classList.add(className);
      });
      on(handle, "pointermove", (event) => {
        if (!state || state.id !== event.pointerId) return;
        const dx = event.clientX - state.x,
          dy = event.clientY - state.y;
        if (Math.hypot(dx, dy) < 3 && !state.moved) return;
        state.moved = true;
        move(state, dx, dy);
      });
      const finish = (event) => {
        if (state?.id !== event.pointerId) return;
        state = null;
        panel.classList.remove(className);
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        on(handle, type, finish);
    };
    drag(
      grip,
      () => {
        const { left, top } = panel.getBoundingClientRect();
        return { left, top };
      },
      (start, dx, dy) => {
        this.movePanel(start.left + dx, start.top + dy);
      },
      "is-moving",
    );
    drag(
      canvas,
      () => ({ view: this.view(), rect: canvas.getBoundingClientRect() }),
      (start, dx, dy) => {
        const x = (dx * canvas.width) / start.rect.width / start.view.scale;
        const z = (dy * canvas.height) / start.rect.height / start.view.scale;
        const c = Math.cos(start.view.heading),
          s = Math.sin(start.view.heading);
        this.center = {
          x: start.view.center.x - (x * c - z * s),
          z: start.view.center.z - (x * s + z * c),
        };
        this.heading = start.view.heading;
        this.redraw();
      },
      "is-panning",
    );
    on(grip, "keydown", (event) => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect(),
        step = event.shiftKey ? 1 : 10;
      this.movePanel(
        rect.left + direction[0] * step,
        rect.top + direction[1] * step,
      );
    });
    on(window, "resize", () => this.constrainPosition());
  }
  view() {
    const player = this.simulation.player;
    return {
      center: this.center ? { ...this.center } : { x: player.x, z: player.z },
      heading: this.heading ?? player.heading,
      scale:
        (this.simulation.world.type === "highway" ? 0.85 : 1.35) * this.zoom,
    };
  }
  setZoom(value) {
    this.zoom = clamp(value, 0.35, 4);
    this.zoomIn.disabled = this.zoom >= 4;
    this.zoomOut.disabled = this.zoom <= 0.35;
    this.redraw();
  }
  resetView() {
    this.center = this.heading = null;
    this.setZoom(1);
  }
  movePanel(left, top) {
    const rect = this.panel.getBoundingClientRect();
    this.position = {
      left: clamp(left, 8, Math.max(8, innerWidth - rect.width - 8)),
      top: clamp(top, 8, Math.max(8, innerHeight - rect.height - 8)),
    };
    this.panel.style.position = "fixed";
    this.panel.style.left = `${this.position.left}px`;
    this.panel.style.top = `${this.position.top}px`;
    this.panel.style.bottom = "auto";
  }
  constrainPosition() {
    if (this.position && !this.panel.hidden)
      this.movePanel(this.position.left, this.position.top);
  }
  dispose() {
    this.events.abort();
  }
}
