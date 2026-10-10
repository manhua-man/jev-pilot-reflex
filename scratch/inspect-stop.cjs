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

  for (let s = 1; s <= 35; s++) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => {
      const sim = window.sim;
      const v = sim.player;
      const env = sim.speedEnvelope(v);
      return {
        time: sim.time.toFixed(1),
        s: v.s.toFixed(1),
        speed: v.speed.toFixed(2),
        appliedTarget: v.appliedTarget?.toFixed(2),
        target: v.target?.toFixed(2),
        brakeReason: sim.brakeReason,
        aebActive: sim.aebActive,
        aebTimer: sim.aebTimer,
        aebTTC: sim.aebTTC,
        envConflict: env.conflict,
        envMax: env.max,
        traffic: sim.traffic.map(t => ({
          id: t.id,
          x: t.x.toFixed(1),
          z: t.z.toFixed(1),
          s: t.s?.toFixed(1),
          speed: t.speed.toFixed(2),
          routeLen: t.route?.length?.toFixed(1),
          routeIds: t.route?.ids?.slice(0, 3)
        })),
        pedestrians: sim.pedestrians.map(p => ({
          id: p.id,
          x: p.x.toFixed(1),
          z: p.z.toFixed(1),
          speed: p.speed?.toFixed(2),
          isJaywalker: p.isJaywalker
        })),
        playerPos: { x: v.x.toFixed(1), z: v.z.toFixed(1), heading: v.heading.toFixed(2) }
      };
    });

    console.log(`t=${s}s: s=${state.s}, spd=${state.speed}, tgt=${state.target}, appTgt=${state.appliedTarget}, brake=${state.brakeReason}, aeb=${state.aebActive}`);
    if (state.envConflict) {
      console.log('  --> Conflict:', JSON.stringify(state.envConflict));
    }

    if (parseFloat(state.speed) < 0.05 && s > 15) {
      console.log('=== STOP DETECTED ===');
      console.log('Full State:', JSON.stringify(state, null, 2));
      break;
    }
  }

  await browser.close();
})();
