const { chromium } = require('f:/manhua-personal-site/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox']
  });

  const errors = [];
  const warnings = [];

  function attachPageListeners(page, label) {
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        errors.push(`[${label}] CONSOLE ERROR: ${text}`);
        console.error(`[${label}] ERROR:`, text);
      } else if (type === 'warning') {
        warnings.push(`[${label}] CONSOLE WARN: ${text}`);
      }
    });
    page.on('pageerror', err => {
      errors.push(`[${label}] PAGE ERROR: ${err.message}`);
      console.error(`[${label}] PAGE CRASH:`, err);
    });
  }

  console.log('====================================================');
  console.log('🚀 SYSTEMATIC PROACTIVE AUDIT: JEV PILOT REFLEX');
  console.log('====================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: Alpine Scenarios (E, G, Z, T, K, R) & Recovery
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Alpine Scenarios & Post-Event Recovery ---');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    attachPageListeners(page, 'Alpine-Scenarios');

    await page.goto('http://localhost:4175/?world=alpine');
    await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.sim.autopilot = true; });

    // Let car get up to cruising speed
    await page.waitForTimeout(3000);

    const scenarios = [
      { key: 'KeyE', name: 'Jaywalker (E)' },
      { key: 'KeyG', name: 'Aggressive Cut-in (G)' },
      { key: 'KeyZ', name: 'Zipper Merge (Z)' },
      { key: 'KeyT', name: 'Truck Overtake (T)' },
      { key: 'KeyK', name: 'Construction (K)' },
      { key: 'KeyR', name: 'Roundabout Yield (R)' },
    ];

    for (const sc of scenarios) {
      console.log(`Triggering Scenario: ${sc.name}...`);
      await page.keyboard.press(sc.key);
      await page.waitForTimeout(1000);

      // Check immediate reaction
      const reactState = await page.evaluate(() => ({
        speed: window.sim.player.speed.toFixed(2),
        brakeReason: window.sim.brakeReason,
        aebActive: window.sim.aebActive,
        event: window.sim.events?.[0]?.text
      }));
      console.log(`  Immediate reaction:`, reactState);

      // Wait 4 seconds and check recovery: Did vehicle resume cruising?
      await page.waitForTimeout(4000);
      const recoverState = await page.evaluate(() => ({
        speed: window.sim.player.speed.toFixed(2),
        brakeReason: window.sim.brakeReason,
        crash: window.sim.crash
      }));
      console.log(`  After 4s recovery:`, recoverState);

      if (recoverState.crash) {
        errors.push(`Scenario ${sc.name} caused crash: ${JSON.stringify(recoverState.crash)}`);
      }
      if (parseFloat(recoverState.speed) < 0.2) {
        warnings.push(`Scenario ${sc.name} left vehicle permanently stopped after 4s!`);
      }
    }
    await page.close();
  }

  // -------------------------------------------------------------------------
  // TEST 2: Seasons, Weathers & Low Friction Stress
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Weather & Seasons Transitions & Friction ---');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    attachPageListeners(page, 'Seasons-Weather');

    await page.goto('http://localhost:4175/?world=alpine');
    await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.sim.autopilot = true; });

    // Test seasonal buttons
    const seasons = ['summer', 'autumn', 'winter', 'spring'];
    for (const s of seasons) {
      console.log(`Switching season to ${s}...`);
      const success = await page.evaluate((seasonName) => {
        const btn = document.querySelector(`[data-season="${seasonName}"]`);
        if (btn) { btn.click(); return true; }
        return false;
      }, s);
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => ({
        friction: window.sim.roadFriction,
        speed: window.sim.player.speed.toFixed(2)
      }));
      console.log(`  Season ${s} (clicked: ${success}): friction=${state.friction}, spd=${state.speed}`);
    }

    // Test time of day / weather presets
    const times = ['noon', 'sunset', 'night', 'fog', 'snow'];
    for (const t of times) {
      console.log(`Switching weather/time to ${t}...`);
      await page.evaluate((timeName) => {
        const btn = document.querySelector(`[data-time="${timeName}"]`);
        if (btn) btn.click();
      }, t);
      await page.waitForTimeout(1000);
    }
    await page.close();
  }

  // -------------------------------------------------------------------------
  // TEST 3: Highway World Autopilot & Flow
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Highway World Cruising & Traffic ---');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    attachPageListeners(page, 'Highway-World');

    await page.goto('http://localhost:4175/?world=highway');
    await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.sim.autopilot = true; });

    console.log('Highway driving for 15s...');
    for (let s = 1; s <= 15; s++) {
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => ({
        s: window.sim.player.s.toFixed(1),
        speed: window.sim.player.speed.toFixed(2),
        brake: window.sim.brakeReason,
        crash: window.sim.crash
      }));
      if (s % 3 === 0) console.log(`  Highway t=${s}s: s=${info.s}m, spd=${info.speed}, brake=${info.brake}`);
      if (info.crash) errors.push(`Highway crashed at t=${s}s`);
    }
    await page.close();
  }

  // -------------------------------------------------------------------------
  // TEST 4: City World Autopilot, Signals & Stops
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: City World Cruising & Intersection Lights ---');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    attachPageListeners(page, 'City-World');

    await page.goto('http://localhost:4175/?world=city');
    await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.sim.autopilot = true; });

    console.log('City driving for 20s...');
    for (let s = 1; s <= 20; s++) {
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => {
        const sim = window.sim;
        const v = sim.player;
        const rule = sim.rule(v);
        return {
          s: v.s.toFixed(1),
          speed: v.speed.toFixed(2),
          brake: sim.brakeReason,
          ruleReason: rule.reason,
          ruleMustStop: rule.mustStop,
          signalColor: rule.color,
          crash: sim.crash
        };
      });
      if (s % 4 === 0) {
        console.log(`  City t=${s}s: s=${info.s}m, spd=${info.speed}, rule=${info.ruleReason} (${info.signalColor}), brake=${info.brake}`);
      }
      if (info.crash) errors.push(`City crashed at t=${s}s`);
    }
    await page.close();
  }

  // -------------------------------------------------------------------------
  // TEST 5: Features (Camera 'C', Neural 'N', Record 'U', Sound 'M', Telemetry 'B')
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Interactive Keys & View Modes ---');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    attachPageListeners(page, 'Features-Keys');

    await page.goto('http://localhost:4175/?world=alpine');
    await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Test Camera toggles ('C')
    for (let c = 0; c < 3; c++) {
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(500);
      console.log(`  Toggled camera mode ${c + 1}`);
    }

    // Test Neural Policy ('N')
    console.log('  Testing Neural Policy (KeyN)...');
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(2000);
    const nState = await page.evaluate(() => ({
      neural: window.neuralPolicy?.enabled,
      speed: window.sim.player.speed.toFixed(2)
    }));
    console.log('  Neural policy active:', nState);

    // Test Trajectory Recording ('U')
    console.log('  Testing Trajectory Recording (KeyU)...');
    await page.keyboard.press('KeyU');
    await page.waitForTimeout(2000);
    await page.keyboard.press('KeyU'); // Stop recording
    console.log('  Trajectory recording stopped');

    // Test Audio ('M')
    console.log('  Testing Audio toggle (KeyM)...');
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(500);

    // Test Dual-Brain Telemetry ('B')
    console.log('  Testing Dual-Brain HUD toggle (KeyB)...');
    await page.keyboard.press('KeyB');
    await page.waitForTimeout(500);

    await page.close();
  }

  // -------------------------------------------------------------------------
  // AUDIT SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log('📊 AUDIT SUMMARY REPORT');
  console.log('====================================================');
  console.log(`Total Errors Detected: ${errors.length}`);
  console.log(`Total Warnings Detected: ${warnings.length}`);
  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log('  ❌', e));
  }
  if (warnings.length) {
    console.log('\nWARNINGS:');
    warnings.forEach(w => console.log('  ⚠️', w));
  }
  if (!errors.length && !warnings.length) {
    console.log('✨ ALL SYSTEMS, WORLDS, SCENARIOS, AND CONTROLS PASSED FLAWLESSLY!');
  }

  await browser.close();
})();
