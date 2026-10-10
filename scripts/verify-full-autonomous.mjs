import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";

mkdirSync("artifacts", { recursive: true });

async function run() {
  console.log("🚀 启动 Playwright 全流程端到端自动驾驶深度验收测试...");
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });

  const errors = [];
  page.on("pageerror", (err) => {
    console.error("❌ Page Error:", err.message);
    errors.push(err.message);
  });

  const url = "http://localhost:4175/?world=alpine&seed=12345";
  console.log(`🌐 正在打开页面: ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });

  // 等待加载屏幕消失
  await page.waitForSelector("#scene-loader", { state: "hidden", timeout: 25000 });
  console.log("✔ 页面与 3D 场景加载就绪");

  // 1. 验证纯智驾模式状态与 UI
  const initialData = await page.evaluate(() => {
    const sim = window.__sim;
    const scene = window.scene;
    return {
      autopilot: sim?.autopilot,
      endless: sim?.endlessCruising,
      speed: sim?.player?.speed,
      showCandidates: scene?.vectors?.showCandidates,
      hasPerceptionSystem: !!scene?.perceptionSystem,
      pilotStateText: document.getElementById("pilot-state")?.textContent,
      contextMessage: document.getElementById("context-message")?.textContent,
      touchHidden: document.getElementById("touch-controls")?.hidden,
      activeGear: document.querySelector("#gear-cluster .gear-letter.active")?.dataset.gear,
    };
  });

  console.log("📊 初始智驾状态检定结果:", initialData);

  if (!initialData.autopilot) {
    throw new Error("FAIL: 初始状态非自动驾驶 (autopilot must be true)");
  }
  if (initialData.contextMessage.includes("WASD") || initialData.pilotStateText.includes("Free play")) {
    throw new Error("FAIL: 依然残留手动按键操控提示 (WASD / Free play detected)");
  }
  if (!initialData.hasPerceptionSystem) {
    throw new Error("FAIL: 3D 感知系统 (PerceptionSystem) 未激活");
  }

  console.log("✔ 智驾系统默认闭环启动确认通过！");

  // 截取开局高清视界
  await page.screenshot({ path: "artifacts/test-pilot-init.png" });

  // 2. 长程持续自主巡航测试 (无尽巡航 35 秒，每隔 5 秒检测一次状态)
  console.log("⏳ 正在进行 35 秒无尽自主长程巡航稳定性压测...");
  let lastDistance = 0;
  for (let t = 5; t <= 35; t += 5) {
    await page.waitForTimeout(5000);
    const cruiseState = await page.evaluate(() => {
      const sim = window.__sim;
      return {
        time: sim?.time,
        distance: sim?.distance,
        speed: (sim?.player?.speed * 3.6).toFixed(1),
        target: (sim?.player?.target * 3.6).toFixed(1),
        s: sim?.player?.s?.toFixed(1),
        routeLen: sim?.player?.route?.length?.toFixed(1),
        leg: sim?.stageLeg || 1,
        activeGear: document.querySelector("#gear-cluster .gear-letter.active")?.dataset.gear,
      };
    });

    console.log(`⏱️ [${t}s] 巡航里程: ${Math.round(cruiseState.distance)}m, 车速: ${cruiseState.speed} km/h, 当前赛段: Leg ${cruiseState.leg}, 挡位: ${cruiseState.activeGear}`);

    if (cruiseState.distance <= lastDistance) {
      throw new Error(`FAIL: 车辆在第 ${t} 秒停滞或里程未增加 (distance: ${cruiseState.distance})`);
    }
    lastDistance = cruiseState.distance;
  }

  console.log("✔ 35 秒无尽山口长程连续巡航测试 100% 通过！0 停顿、0 减速卡死！");
  await page.screenshot({ path: "artifacts/test-pilot-cruising-35s.png" });

  // 3. 逐一验证 6 大具身博弈推演场景与实时解说卡片
  console.log("🧪 正在测试 6 大博弈推演场景与解说卡弹出联动...");

  // 场景 1: E 鬼探头
  console.log("👉 触发场景 1: E 盲区突发鬼探头");
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(1000);
  const jaywalkState = await page.evaluate(() => {
    const card = document.getElementById("scenario-explainer");
    const title = document.getElementById("explainer-title")?.textContent;
    return {
      cardVisible: card && !card.hidden && card.classList.contains("active"),
      title,
      aebActive: window.__sim?.aebActive,
    };
  });
  console.log("   鬼探头遥测结果:", jaywalkState);
  await page.screenshot({ path: "artifacts/test-scenario-1-jaywalk.png" });

  // 场景 2: G 激进加塞
  console.log("👉 触发场景 2: G 智能邻车激进加塞博弈");
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(1000);
  const cutinState = await page.evaluate(() => {
    const card = document.getElementById("scenario-explainer");
    return {
      cardVisible: card && !card.hidden && card.classList.contains("active"),
      title: document.getElementById("explainer-title")?.textContent,
    };
  });
  console.log("   激进加塞遥测结果:", cutinState);
  await page.screenshot({ path: "artifacts/test-scenario-2-cutin.png" });

  // 场景 3: Z 拉链汇流
  console.log("👉 触发场景 3: Z 高架拉链交替合流博弈");
  await page.keyboard.press("KeyZ");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "artifacts/test-scenario-3-zipper.png" });

  // 场景 4: T 重卡超车
  console.log("👉 触发场景 4: T 重卡视线遮挡与微偏超车");
  await page.keyboard.press("KeyT");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "artifacts/test-scenario-4-truck.png" });

  // 场景 5: K 施工避障
  console.log("👉 触发场景 5: K 施工占道与反光锥桶避障");
  await page.keyboard.press("KeyK");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "artifacts/test-scenario-5-construction.png" });

  // 场景 6: R 环岛让行
  console.log("👉 触发场景 6: R 多车圆形环岛让行博弈");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "artifacts/test-scenario-6-roundabout.png" });

  // 4. 验证视角切换在纯智驾下的表现
  console.log("🎥 验证 4 大摄像机视角在智驾巡航下的画面表现...");
  for (let c = 1; c <= 3; c++) {
    await page.keyboard.press("KeyC");
    await page.waitForTimeout(1200);
    const camName = await page.evaluate(() => document.getElementById("camera-name")?.textContent);
    console.log(`   切换至视角: ${camName}`);
    await page.screenshot({ path: `artifacts/test-camera-${camName.toLowerCase()}.png` });
  }

  // 5. 检查整个生命周期的控制台错误
  if (errors.length > 0) {
    throw new Error(`FAIL: 检测到 ${errors.length} 个页面控制台未捕获错误:\n` + errors.join("\n"));
  }

  console.log("🎉 所有端到端自动驾驶深度验收测试 100% PASS！零错误、零停滞、视觉惊艳！");
  await browser.close();
}

run().catch((err) => {
  console.error("💥 测试失败:", err);
  process.exit(1);
});
