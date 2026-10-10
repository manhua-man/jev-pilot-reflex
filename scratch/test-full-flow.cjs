const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Loading Alpine Passage for manual & autopilot test...');
  await page.goto('http://localhost:4175/?world=alpine');
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Disable autopilot for manual test
  await page.evaluate(() => {
    window.sim.autopilot = false;
  });

  // Test forward (W)
  console.log('Testing W key forward...');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  let spd = await page.evaluate(() => window.sim.player.speed);
  console.log(`Forward speed: ${spd.toFixed(2)} m/s (expected > 1.5)`);
  if (spd < 1.0) throw new Error('Forward drive failed');

  // Test brake & reverse (S)
  console.log('Testing S key brake & reverse...');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyS');
  spd = await page.evaluate(() => window.sim.player.speed);
  console.log(`Reverse speed: ${spd.toFixed(2)} m/s (expected < 0)`);
  if (spd > 0) throw new Error('Reverse drive failed');

  // Test reset (Backspace)
  console.log('Testing Backspace reset...');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  const resetState = await page.evaluate(() => ({
    speed: window.sim.player.speed,
    steering: window.sim.player.steering
  }));
  console.log('Reset state:', resetState);
  if (Math.abs(resetState.speed) > 0.01) throw new Error('Reset failed');

  // Test J key autopilot activation
  console.log('Testing J key Autopilot...');
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(4000);
  const autoState = await page.evaluate(() => ({
    autopilot: window.sim.autopilot,
    speed: window.sim.player.speed.toFixed(2),
    s: window.sim.player.s.toFixed(1)
  }));
  console.log('Autopilot state after 4s:', autoState);
  if (!autoState.autopilot || parseFloat(autoState.speed) < 2.0) {
    throw new Error('Autopilot engagement failed');
  }

  await page.screenshot({ path: 'C:/Users/ManHua/.gemini/antigravity/brain/39617761-7ce6-40b7-b2f3-93ee284eb099/full-flow-verified.png' });
  console.log('ALL MANUAL & AUTOPILOT CHECKS PASSED PERFECTLY!');
  await browser.close();
})();
