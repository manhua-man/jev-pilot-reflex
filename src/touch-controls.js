import { clamp } from "./math.js";

export class TouchControls {
  constructor(root, canDrive) {
    this.root = root;
    this.stick = root.querySelector(".touch-stick");
    this.brakeButton = root.querySelector(".touch-brake");
    this.canDrive = canDrive;
    this.media = matchMedia("(pointer: coarse)");
    this.controller = new AbortController();
    this.steering = this.throttle = this.brake = 0;
    this.pointers = new Map();
    const listen = (element, name, handler) =>
      element.addEventListener(name, handler, {
        signal: this.controller.signal,
      });
    for (const element of [this.stick, this.brakeButton]) {
      listen(element, "pointerdown", (event) => {
        if (
          event.button !== 0 ||
          !this.canDrive() ||
          this.pointers.has(element)
        )
          return;
        event.preventDefault();
        this.pointers.set(element, event.pointerId);
        element.setPointerCapture(event.pointerId);
        element.classList.add("held");
        if (element === this.stick) {
          const rect = element.getBoundingClientRect();
          this.origin = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          this.radius = rect.width * 0.32;
          this.move(event);
        } else this.brake = 1;
      });
      listen(element, "pointermove", (event) => {
        if (
          element === this.stick &&
          this.pointers.get(element) === event.pointerId
        )
          this.move(event);
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
        listen(element, name, (event) => {
          if (this.pointers.get(element) === event.pointerId)
            this.release(element);
        });
      listen(element, "contextmenu", (event) => event.preventDefault());
    }
    listen(window, "blur", () => this.reset());
    listen(window, "resize", () => this.reset());
    listen(document, "visibilitychange", () => this.reset());
    listen(this.media, "change", () => this.reset());
  }
  get available() {
    return this.media.matches;
  }
  move(event) {
    if (!this.canDrive()) {
      this.reset();
      return;
    }
    let x = (event.clientX - this.origin.x) / this.radius;
    let y = (event.clientY - this.origin.y) / this.radius;
    const length = Math.max(1, Math.hypot(x, y));
    x /= length;
    y /= length;
    const axis = (v) => Math.sign(v) * clamp((Math.abs(v) - 0.1) / 0.65, 0, 1);
    this.steering = axis(x);
    this.throttle = axis(-y);
    this.stick.style.setProperty("--stick-x", `${x * this.radius}px`);
    this.stick.style.setProperty("--stick-y", `${y * this.radius}px`);
  }
  release(element) {
    const id = this.pointers.get(element);
    this.pointers.delete(element);
    if (id !== undefined && element.hasPointerCapture(id))
      element.releasePointerCapture(id);
    element.classList.remove("held");
    if (element === this.stick) {
      this.steering = this.throttle = 0;
      element.style.setProperty("--stick-x", "0px");
      element.style.setProperty("--stick-y", "0px");
    } else this.brake = 0;
  }
  reset() {
    this.release(this.stick);
    this.release(this.brakeButton);
  }
  sync() {
    const disabled = !this.available || !this.canDrive();
    if (disabled && this.pointers.size) this.reset();
    if (this.root.hidden !== disabled) this.root.hidden = disabled;
  }
  dispose() {
    this.reset();
    this.controller.abort();
  }
}
