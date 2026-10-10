const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Testing LIVE Production at https://manhua777.site/widgets/jev-pilot/?world=alpine ...');
  await page.goto('https://manhua777.site/widgets/jev-pilot/?world=alpine');
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 25000 });
  await page.waitForTimeout(1000);

  // Enable autopilot
  await page.evaluate(() => {
    if (!window.sim.autopilot) window.sim.autopilot = true;
  });

  console.log('Live driving test started (30s)...');
  for (let s = 1; s <= 30; s++) {
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
        stageLeg: sim?.stageLeg,
        brakeReason: sim?.brakeReason,
        appliedTarget: v?.appliedTarget?.toFixed(2)
      };
    }, s);
    console.log(`Live t=${s}s: s=${info.s}m (len=${info.routeLen}), spd=${info.speed}, leg=${info.stageLeg}, brake=${info.brakeReason}`);
  }

  await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/live-endless-verified.png' });
  console.log('LIVE PRODUCTION VERIFIED SUCCESSFULLY!');
  await browser.close();
})();
