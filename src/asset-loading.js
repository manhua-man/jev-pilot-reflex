import { LoadingManager } from "three";

export const assetManager = new LoadingManager();
let idle = true;
const waiting = new Set();
assetManager.onStart = () => {
  idle = false;
};
assetManager.onLoad = () => {
  idle = true;
  for (const resolve of waiting) resolve();
  waiting.clear();
};

// Called after the scene's model promises, including any nested textures.
export function assetsReady() {
  return idle
    ? Promise.resolve()
    : new Promise((resolve) => waiting.add(resolve));
}
