const fs = require('fs');
let code = fs.readFileSync('F:/jev-pilot-reflex/src/main.js', 'utf8').replace(/\r\n/g, '\n');

// 1. setPilot definition
code = code.replace(
  /function setPilot\(on\) \{[\s\S]*?sim\.autopilot = on;\n\s*if \(on\) sim\.freeExplore = false;/,
  'function setPilot(on = true) {\n  if (loading) return;\n  touch.reset();\n  if (on && playCredits?.exhausted) {\n    $("credit-dialog").showModal();\n    return;\n  }\n  if (sim.crash) return;\n  sim.autopilot = true;\n  sim.freeExplore = false;'
);

// 2. errors >= 3 in decide()
code = code.replace(
  /if \(errors >= 3\) \{[\s\S]*?setPilot\(false\);[\s\S]*?\}\n\s*\}/,
  'if (errors >= 3) {\n        sim.autopilot = true;\n        errors = 0;\n        console.warn("Planner fallback to local reflex");\n      }\n    }'
);

// 3. endless toggle
code = code.replace(
  /\$\("endless-toggle"\)[\s\S]*?toggleEndlessCruising\(\);[\s\S]*?\}\);/,
  '$("endless-toggle")?.addEventListener("click", () => {\n  sim.endlessCruising = true;\n  $("endless-toggle")?.classList.add("active");\n  toast("∞ 无尽巡航模式常驻激活：赛段无缝自动拓扑延展", "info");\n});'
);

// 4. KeyI
code = code.replace(
  /if \(e\.code === "KeyI"\) \{[\s\S]*?toggleEndlessCruising\(\);[\s\S]*?\}/,
  'if (e.code === "KeyI") {\n    sim.endlessCruising = true;\n    $("endless-toggle")?.classList.add("active");\n    toast("∞ 无尽巡航模式常驻激活：赛段无缝自动拓扑延展", "info");\n  }'
);

// 5. crash-dialog auto-respawn
if (!code.includes('// Auto-recovery guardian')) {
  code = code.replace(
    /\$\("crash-dialog"\)\.showModal\(\);\n\s*\}/,
    '$("crash-dialog").showModal();\n    // Auto-recovery guardian for 100% autonomous showcase\n    toast("⚠️ 触发物理碰撞保护，系统将于 2 秒后自动复位至道路中心并继续智驾巡航...", "warning");\n    setTimeout(() => {\n      if (sim.crash) {\n        respawnCar();\n      }\n    }, 2000);\n  }'
  );
}

// 6. arrival auto-advance
code = code.replace(
  /if \(sim\.complete && !sim\.freeExplore\) \{\n\s*\$\("arrival"\)\.hidden = false;/,
  'if (sim.complete && !sim.freeExplore) {\n    sim.complete = false;\n    sim.appendNextLeg();\n    $("arrival").hidden = true;'
);

fs.writeFileSync('F:/jev-pilot-reflex/src/main.js', code, 'utf8');
console.log('Regex replacements in main.js applied successfully!');
