import { loadingFailed, nextPaint } from "./loading-screen.js";

// Paint the lightweight HTML loader before downloading/building the 3D world.
nextPaint()
  .then(() => import("./main.js"))
  .catch(loadingFailed);
