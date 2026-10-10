const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Loading Alpine Passage...');
  await page.goto('http://localhost:4175/?world=alpine');
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    if (!window.sim.autopilot) window.sim.autopilot = true;
  });

  for (let s = 1; s <= 30; s++) {
    await page.waitForTimeout(1000);
    const data = await page.evaluate((sec) => {
      const sim = window.sim;
      const v = sim.player;
      const env = sim.speedEnvelope(v);
      return {
        sec,
        s: v.s.toFixed(1),
        speed: v.speed.toFixed(2),
        target: v.target?.toFixed(2),
        manVel: v.maneuver?.velocity_mps,
        manSteer: v.maneuver?.steering?.toFixed(3),
        manLaneOffset: v.maneuver?.lane_offset_m,
        brake: sim.brakeReason,
        planKeys: sim.lastPlan?.vectors ? Object.keys(sim.lastPlan.vectors) : [],
        lastPlanManeuvers: sim.lastPlan?.vectors ? Object.fromEntries(
          Object.entries(sim.lastPlan.vectors).map(([k, vec]) => [k, { vel: vec.velocity_mps, steer: vec.steering, stayRoad: vec.stays_on_road, stayLane: vec.stays_in_lane, coll: vec.collision_predicted }])
        ) : null
      };
    }, s);

    console.log(`t=${s}s: s=${data.s}, spd=${data.speed}, tgt=${data.target}, manVel=${data.manVel}, manSteer=${data.manSteer}, brake=${data.brake}`);

    if (parseFloat(data.speed) < 0.05 && s > 15) {
      console.log('=== STOP DETECTED AT SEC', s, '===');
      console.log('All vectors:', JSON.stringify(data.lastPlanManeuvers, null, 2));
      break;
    }
  }

  await browser.close();
})();
