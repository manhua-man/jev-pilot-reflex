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

  for (let s = 1; s <= 20; s++) {
    await page.waitForTimeout(1000);
    const data = await page.evaluate((sec) => {
      const sim = window.sim;
      return sim.traffic.map(t => {
        const env = sim.speedEnvelope(t);
        return {
          id: t.id,
          s: t.s?.toFixed(1),
          speed: t.speed.toFixed(2),
          envMax: env.max?.toFixed(2),
          envReason: env.reason,
          ruleMustStop: env.rule?.mustStop,
          ruleReason: env.rule?.reason,
          ruleDist: env.rule?.distance?.toFixed(1),
          leadGap: env.lead?.gap?.toFixed(1),
          leadId: env.lead?.other?.id
        };
      });
    }, s);
    console.log(`t=${s}s:`, JSON.stringify(data));
  }

  await browser.close();
})();
