import { chromium, expect } from "@playwright/test";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
mkdirSync("artifacts", { recursive: true });
const executablePath = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell`;
const browser = await chromium.launch({
  ...(existsSync(executablePath) ? { executablePath } : {}),
  ...(process.platform === "darwin" ? { args: ["--use-angle=metal"] } : {}),
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    errors.push(message.text());
    console.log(message.text());
  }
});
await page.route("**/api/decide", (route) =>
  route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "No live inference in visual tests" }),
  }),
);
const app = async () =>
  page.evaluate(async () => {
    window.experience = await import(
      document.querySelector('script[src*="/src/main.js"]').src
    );
  });
try {
  await page.goto(
    new URL(
      "/?world=city&seed=406772",
      process.env.BASE_URL || "http://localhost:5173",
    ).href,
  );
  await app();
  await expect(page).toHaveTitle(/Jevpilot/);
  await expect
    .poll(
      () =>
        page.evaluate(() => !!experience.scene.player.userData.sourcedModel),
      { timeout: 20000 },
    )
    .toBe(true);
  await page.evaluate(() => experience.scene.scenery.ready);
  await page.screenshot({ path: "artifacts/jevpilot-city.png" });
  const yaw = await page.evaluate(
    () => experience.scene.cameraInput.current().yaw,
  );
  await page.mouse.move(650, 320);
  await page.mouse.down();
  await page.mouse.move(830, 390, { steps: 8 });
  await page.mouse.up();
  expect(
    await page.evaluate(() => experience.scene.cameraInput.current().yaw),
  ).not.toBe(yaw);
  await page.locator("#camera").click();
  const eye = await page.evaluate(() => {
    const { sim, scene } = experience,
      original = { ...sim.player };
    sim.paused = true;
    let max = 0;
    for (let i = 0; i < 20; i++) {
      sim.player.x += 0.4;
      sim.player.z -= 0.25;
      sim.player.heading += 0.07;
      scene.render(0.025);
      const v = sim.player;
      const forward = scene.player.userData.eyeForward ?? 0.15;
      const x = v.x + Math.sin(v.heading) * forward - Math.cos(v.heading) * 0.3;
      const z = v.z - Math.cos(v.heading) * forward - Math.sin(v.heading) * 0.3;
      max = Math.max(
        max,
        Math.hypot(scene.camera.position.x - x, scene.camera.position.z - z),
      );
    }
    Object.assign(sim.player, original);
    sim.paused = false;
    return max;
  });
  expect(eye).toBeLessThan(0.00001);
  await page.mouse.move(700, 330);
  await page.mouse.down();
  await page.mouse.move(820, 345, { steps: 8 });
  await page.mouse.up();
  expect(
    await page.evaluate(() => experience.scene.cameraInput.current().yaw),
  ).toBeGreaterThan(0.3);
  await page
    .locator("#world-canvas")
    .dblclick({ position: { x: 650, y: 310 } });
  await page.screenshot({ path: "artifacts/jevpilot-driver.png" });
  await page.keyboard.down("w");
  await page.waitForTimeout(1400);
  await page.keyboard.up("w");
  const released = await page.evaluate(() => experience.sim.player.speed);
  await page.waitForTimeout(700);
  const coast = await page.evaluate(() => ({
    speed: experience.sim.player.speed,
    throttle: experience.sim.pedals.throttle,
  }));
  expect(released).toBeGreaterThan(2);
  expect(coast.speed).toBeGreaterThan(0);
  expect(coast.speed).toBeLessThan(released);
  expect(coast.throttle).toBe(0);
  await page.keyboard.down("Space");
  await expect(page.locator("#speed")).toHaveText("0");
  await page.keyboard.up("Space");
  await page.locator("#camera").click();
  const distance = await page.evaluate(
    () => experience.scene.cameraInput.current().distance,
  );
  await page.mouse.move(700, 330);
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => experience.scene.cameraInput.current().distance),
  ).toBeLessThan(distance);
  for (const type of ["building", "pedestrian", "car", "motorcycle"]) {
    await page.evaluate(async (kind) => {
      const { sim, scene } = experience;
      sim.paused = false;
      sim.autopilot = false;
      sim.freeExplore = true;
      sim.traffic = [];
      sim.pedestrians = [];
      const building = sim.world.objects.find((o) => o.type === "building");
      const base = sim.world.route.points[0];
      let target;
      if (kind === "building") {
        target = building;
        const extent =
          (Math.abs(Math.cos(target.rotation)) * target.width) / 2 +
          (Math.abs(Math.sin(target.rotation)) * target.depth) / 2;
        Object.assign(sim.player, {
          x: target.x - extent - 6,
          z: target.z,
          heading: Math.PI / 2,
        });
      } else if (kind === "pedestrian") {
        const node = sim.world.nodes[0];
        target = {
          id: "pedestrian-0",
          type: kind,
          nodeId: node.id,
          x: base.x,
          z: base.z - 7,
          width: 0.6,
          depth: 0.6,
          crossing: false,
          direction: 1,
          progress: 0,
          walkPath: {
            start: { x: base.x, z: base.z - 7 },
            heading: 0,
            length: 30,
          },
        };
        sim.pedestrians = [target];
        Object.assign(sim.player, { x: base.x, z: base.z, heading: 0 });
      } else {
        const points = [
          { x: base.x, z: base.z - 8, s: 0 },
          { x: base.x, z: base.z - 108, s: 100 },
        ];
        target = {
          id: "vehicle-0",
          type: kind,
          width: kind === "car" ? 1.9 : 0.8,
          depth: kind === "car" ? 4.2 : 2.3,
          x: base.x,
          z: base.z - 8,
          speed: 0,
          heading: 0,
          s: 0,
          stops: {},
          route: { points, ids: [], crossings: [], length: 100 },
          color: "#64788e",
        };
        sim.traffic = [target];
        Object.assign(sim.player, { x: base.x, z: base.z, heading: 0 });
      }
      Object.assign(sim.player, { speed: 14, steering: 0, target: 0 });
      sim.pedals.throttle = 1;
      sim.paused = true;
      scene.build();
      scene.mode = "chase";
      await new Promise((resolve) => {
        const ready = () =>
          scene.player.userData.sourcedModel
            ? resolve()
            : requestAnimationFrame(ready);
        ready();
      });
      sim.paused = false;
      for (let i = 0; i < 200 && !sim.crash; i++) sim.step(0.025);
      if (!sim.crash) throw new Error(`No ${kind} collision`);
      if (sim.crash.type !== kind)
        throw new Error(`Hit ${sim.crash.type} instead of ${kind}`);
    }, type);
    await expect(page.locator("#crash-dialog")).toBeVisible();
    expect(await page.evaluate(() => experience.sim.autopilot)).toBe(false);
    const frozen = await page.evaluate(() => experience.sim.time);
    await page.keyboard.press("Escape");
    await page.keyboard.press("j");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => experience.sim.time)).toBe(frozen);
    await expect(page.locator("#crash-dialog")).toBeVisible();
    expect(
      await page.evaluate(() => experience.scene.impacts.fragments.length),
    ).toBeGreaterThan(20);
    await page.screenshot({ path: `artifacts/game-over-${type}.png` });
    await page.locator("#retry-drive").click();
    await expect(page.locator("#crash-dialog")).not.toBeVisible();
    expect(await page.evaluate(() => experience.sim.crash)).toBeNull();
  }
  for (const world of ["town", "highway"]) {
    await page.locator("#world-select").selectOption(world);
    await expect
      .poll(() =>
        page.evaluate(() => !!experience.scene.player.userData.sourcedModel),
      )
      .toBe(true);
    await page.evaluate(() => experience.scene.scenery.ready);
    await page.screenshot({ path: `artifacts/jevpilot-${world}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "artifacts/jevpilot-mobile.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS: source assets, all cameras, orbit/look/zoom, attached driver view, throttle release, all four crash types, restart, worlds, and mobile.",
  );
} finally {
  await browser.close();
}
