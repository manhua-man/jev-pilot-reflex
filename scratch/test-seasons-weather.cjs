const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://localhost:4175/?world=alpine');
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Test 4 Seasons:
  for (const s of ['spring', 'summer', 'autumn', 'winter']) {
    console.log(`Clicking #season-${s}...`);
    await page.click(`#season-${s}`);
    await page.waitForTimeout(1000);
    const season = await page.evaluate(() => window.sim.season);
    console.log(`  Current season: ${season}`);
  }

  // Test Time of Day:
  for (const t of ['sunset', 'noon', 'night']) {
    console.log(`Clicking #time-${t}...`);
    await page.click(`#time-${t}`);
    await page.waitForTimeout(1000);
  }

  // Test Weather:
  for (const w of ['clear', 'rain', 'night']) {
    console.log(`Clicking #weather-${w}...`);
    await page.click(`#weather-${w}`);
    await page.waitForTimeout(1000);
    const friction = await page.evaluate(() => window.sim.roadFriction);
    console.log(`  Current friction: ${friction}`);
  }

  await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/seasons-weather-tested.png' });
  console.log(`Errors encountered: ${errors.length}`);
  if (errors.length) console.error(errors);
  else console.log('SEASONS & WEATHERS ALL PASSED WITHOUT ERRORS!');

  await browser.close();
})();
