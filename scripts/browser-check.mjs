import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
mkdirSync("artifacts", { recursive: true });
const cached =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { args: ["--use-angle=metal"] } : {}),
  ...(existsSync(cached) ? { executablePath: cached } : {}),
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = new URL(
  "/?world=town&seed=42",
  process.env.BASE_URL || "http://localhost:5173",
).href;
try {
  await page.goto(url);
  await expect(page.getByText("Jev connected", { exact: true })).toBeVisible();
  await expect(page.locator("#controls-panel")).toBeHidden();
  await expect(page.locator("#minimap")).toBeVisible();
  await expect(page.locator(".mini-heading")).toHaveCount(0);
  const minimapBox = await page.locator("#minimap").boundingBox();
  expect(minimapBox.x).toBeLessThan(30);
  expect(minimapBox.y).toBeGreaterThan(500);
  await page.locator("#map-toggle").click();
  await expect(page.locator("#minimap")).toBeHidden();
  await page.locator("#map-toggle").click();
  await expect(page.locator("#minimap")).toBeVisible();
  const shadowUpdates = await page.evaluate(async () => {
    const { scene } = await import(
      document.querySelector('script[src*="/src/main.js"]').src
    );
    const shadow = scene.sun.shadow,
      original = shadow.updateMatrices;
    let updates = 0;
    shadow.updateMatrices = function (...args) {
      updates++;
      return original.apply(this, args);
    };
    await new Promise((resolve) => {
      let frames = 0;
      function frame() {
        if (++frames >= 12) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    shadow.updateMatrices = original;
    return updates;
  });
  expect(shadowUpdates).toBeGreaterThanOrEqual(11);
  await expect(page.locator("#json-dialog")).toBeHidden();
  expect(await page.locator("#world-canvas").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  });
  await page.screenshot({ path: "artifacts/desktop.png" });
  await page.locator("#scene-json").click();
  let input = JSON.parse(await page.locator("#json-content").innerText());
  expect(Object.keys(input.vectors)).toHaveLength(12);
  expect(input.road).toHaveProperty("drivable_polygons");
  expect(input.recovery.active).toBe(false);
  expect(input.scene).toHaveProperty("nearby");
  expect(input).not.toHaveProperty("world");
  await page.getByRole("button", { name: "Perception", exact: true }).click();
  let obs = JSON.parse(await page.locator("#json-content").innerText());
  expect(obs.ego.control).toBe("manual");
  expect(obs.sensor.visible_objects.length).toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        JSON.parse(await page.locator("#json-content").innerText()).frame
          .time_s,
    )
    .toBeGreaterThan(obs.frame.time_s);
  await page.locator("#freeze-json").click();
  const frozen = await page.locator("#json-content").innerText();
  await page.waitForTimeout(400);
  expect(await page.locator("#json-content").innerText()).toBe(frozen);
  await page.locator("#freeze-json").click();
  await page.getByRole("button", { name: "Full world", exact: true }).click();
  const full = JSON.parse(await page.locator("#json-content").innerText());
  expect(full.world.junctions.length).toBe(25);
  expect(full.world.pedestrians.length).toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/json-inspector.png" });
  await page.locator("#close-json").click();
  await page.locator("#world-canvas").click();
  await page.keyboard.down("w");
  await page.waitForTimeout(1000);
  await page.keyboard.up("w");
  expect(Number(await page.locator("#speed").innerText())).toBeGreaterThan(0);
  await page.keyboard.down("d");
  await expect
    .poll(async () =>
      Number(await page.locator("#steering-output").innerText()),
    )
    .toBeGreaterThan(0);
  await page.keyboard.up("d");
  await page.keyboard.down("Space");
  await expect(page.locator("#speed")).toHaveText("0");
  await page.keyboard.up("Space");
  for (const name of ["Driver", "Bird’s eye", "Chase"]) {
    await page.locator("#camera").click();
    await expect(page.locator("#camera-name")).toHaveText(name);
  }
  await page.locator("#pause").click();
  await expect(page.locator("#paused-overlay")).toBeVisible();
  await page.locator("#resume").click();
  await page.locator("#controls-toggle").click();
  await page.locator("#reset-car").click();
  await page.locator("#close-controls").click();
  await page.locator("#candidates-toggle").click();
  await expect(page.locator("#candidates-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#autopilot").click();
  await expect(page.locator(".vector-label.selected")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator("#cost")).not.toHaveText("$0.000000");
  const readPlans = () =>
    page.evaluate(async () => {
      const { scene } = await import(
        document.querySelector('script[src*="/src/main.js"]').src
      );
      return {
        meshCount: scene.vectors.group.children.length,
        selected: [...scene.vectors.items]
          .filter(([id, x]) => x.label.classList.contains("selected"))
          .map(([id, x]) => ({ id, width: x.width, opacity: x.opacity })),
        alternatives: [...scene.vectors.items.values()]
          .filter((x) => !x.label.classList.contains("selected"))
          .map((x) => x.width),
      };
    });
  await expect
    .poll(
      async () => {
        const p = await readPlans();
        return (
          p.selected.length === 1 &&
          p.selected[0].width > Math.max(...p.alternatives) * 2
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const plans = await readPlans();
  expect(plans.meshCount).toBe(26);
  expect(plans.selected.length).toBe(1);
  expect(plans.selected[0].width).toBeGreaterThan(
    Math.max(...plans.alternatives) * 2,
  );
  await page.screenshot({ path: "artifacts/planning-lines.png" });
  await page.keyboard.down("w");
  await page.keyboard.up("w");
  await expect(page.locator("#autopilot")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  if (!process.env.SKIP_TRIP) {
    await page.locator("#controls-toggle").click();
    await page.locator("#reset-car").click();
    await page.locator("#close-controls").click();
    await page.locator("#autopilot").click();
    // Use a smaller drawing buffer during the long headless trip; CSS layout stays fullscreen.
    await page.evaluate(async () => {
      (
        await import(document.querySelector('script[src*="/src/main.js"]').src)
      ).scene.renderer.setPixelRatio(0.65);
    });
    for (let i = 0; i < 36; i++) {
      if (await page.locator("#arrival").isVisible()) break;
      await page.waitForTimeout(5000);
      if (i % 3 === 0)
        console.log(
          "TRIP PROGRESS",
          await page.evaluate(async () => {
            const { sim } = await import(
              document.querySelector('script[src*="/src/main.js"]').src
            );
            return {
              time: sim.time,
              remaining: sim.navigation().remaining_m,
              speed: sim.player.speed,
              pilot: sim.autopilot,
              reason: sim.rule(sim.player).reason,
            };
          }),
        );
    }
    await expect(page.locator("#arrival")).toBeVisible({ timeout: 1000 });
    await page.evaluate(async () => {
      (
        await import(document.querySelector('script[src*="/src/main.js"]').src)
      ).scene.renderer.setPixelRatio(1);
    });
    const summary = await page.locator("#arrival-summary").innerText();
    expect(summary).toContain("0 contacts · 0 violations");
    console.log("BROWSER TRIP", summary);
    await page.screenshot({ path: "artifacts/arrival.png" });
    await page.locator("#keep-driving").click();
    await expect(page.locator("#arrival")).toBeHidden();
  }
  for (const type of ["city", "highway"]) {
    await page.locator("#world-select").selectOption(type);
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (
              await import(
                document.querySelector('script[src*="/src/main.js"]').src
              )
            ).sim.world.type,
        ),
      )
      .toBe(type);
    await page.screenshot({ path: `artifacts/${type}.png` });
  }
  const seed = await page.locator("#seed-label").innerText();
  await page.locator("#new-world").click();
  expect(await page.locator("#seed-label").innerText()).not.toBe(seed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile.png" });
  const mobileMap = await page.locator("#minimap").boundingBox(),
    dock = await page.locator(".driver-dock").boundingBox();
  expect(mobileMap.x).toBeLessThan(20);
  expect(mobileMap.y + mobileMap.height).toBeLessThan(dock.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.locator("#controls-toggle").click();
  await expect(page.locator("#steering")).toBeVisible();
  await page.locator("#close-controls").click();
  await page.locator("#scene-json").click();
  await expect(page.locator("#json-dialog")).toBeVisible();
  await page.locator("#close-json").click();
  expect(errors).toEqual([]);
  console.log(
    "PASS: fullscreen, compact/discovered JSON, keyboard controls, planning lines, cameras, pause, takeover, world types, mobile." +
      (process.env.SKIP_TRIP ? "" : " Real Jev trip reached destination."),
  );
} finally {
  await browser.close();
}
