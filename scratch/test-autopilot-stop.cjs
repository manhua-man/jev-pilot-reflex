const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Loading Alpine Passage on port 4175...');
  await page.goto('http://localhost:4175/?world=alpine');
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Ensure autopilot is enabled
  await page.evaluate(() => {
    if (!window.sim.autopilot) window.sim.autopilot = true;
  });

  console.log('Autopilot driving test started (60 seconds)...');
  let stoppedCount = 0;
  let maxS = 0;
  for (let s = 1; s <= 60; s++) {
    await page.waitForTimeout(1000);
    const info = await page.evaluate((sec) => {
      const v = window.sim?.player;
      const sim = window.sim;
      return {
        sec,
        time: sim?.time?.toFixed(1),
        speed: v?.speed?.toFixed(2),
        s: v?.s?.toFixed(1),
        routeLen: v?.route?.length?.toFixed(1),
        x: v?.x?.toFixed(1),
        z: v?.z?.toFixed(1),
        stageLeg: sim?.stageLeg,
        complete: sim?.complete,
        crash: sim?.crash,
        brakeReason: sim?.brakeReason,
        target: v?.target?.toFixed(2),
        appliedTarget: v?.appliedTarget?.toFixed(2)
      };
    }, s);

    const currentS = parseFloat(info.s);
    if (currentS > maxS) maxS = currentS;
    console.log(`t=${s}s: s=${info.s}m (len=${info.routeLen}), spd=${info.speed}, leg=${info.stageLeg}, brake=${info.brakeReason}`);

    if (s === 25) {
      await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/autopilot-25s.png' });
    }
    if (s === 50) {
      await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/autopilot-50s.png' });
    }

    if (parseFloat(info.speed) < 0.1 && s > 10) {
      stoppedCount++;
      if (stoppedCount >= 4) {
        console.log('!!! VEHICLE IS STOPPED for 4 consecutive seconds !!! Info:', info);
        await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/stopped-failure.png' });
        break;
      }
    } else {
      stoppedCount = 0;
    }
  }

  await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/autopilot-final.png' });
  console.log(`Test finished. Max s reached = ${maxS}m. Stopped count = ${stoppedCount}`);
  await browser.close();
})();
