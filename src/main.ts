import { DrivingWorld } from './sim/drivingWorld';
import { JevReflexEngine } from './core/jevReflexEngine';
import { System2Planner } from './core/system2Planner';
import type { ReflexDecision } from './types';

const container = document.getElementById('canvas-container')!;
const world = new DrivingWorld(container);
const reflexEngine = new JevReflexEngine();
const system2Planner = new System2Planner();

let isAutopilotOn = true;
let lastTime = performance.now();
let lastS2Check = 0;

// UI Elements
const elSpeed = document.getElementById('hud-speed')!;
const elTtc = document.getElementById('hud-ttc')!;
const elDist = document.getElementById('hud-dist')!;
const elLatency = document.getElementById('hud-latency')!;
const elAction = document.getElementById('hud-action')!;
const elConfidence = document.getElementById('hud-confidence')!;
const elSafetyGate = document.getElementById('hud-safety-gate')!;
const elGateText = document.getElementById('hud-gate-text')!;
const elS2Status = document.getElementById('hud-s2-status')!;
const elS2Guidance = document.getElementById('hud-s2-guidance')!;
const elFps = document.getElementById('hud-fps')!;
const btnTogglePilot = document.getElementById('btn-toggle-pilot') as HTMLButtonElement;
const btnTriggerObstacle = document.getElementById('btn-trigger-obstacle') as HTMLButtonElement;
const btnTriggerCutin = document.getElementById('btn-trigger-cutin') as HTMLButtonElement;
const btnToggleCamera = document.getElementById('btn-toggle-camera') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

// Keyboard input state for manual driving
const keys = { forward: false, backward: false, left: false, right: false };

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'KeyW'].includes(e.code)) keys.forward = true;
  if (['ArrowDown', 'KeyS'].includes(e.code)) keys.backward = true;
  if (['ArrowLeft', 'KeyA'].includes(e.code)) {
    keys.left = true;
    if (!isAutopilotOn && world.currentLane > 0) world.currentLane--;
  }
  if (['ArrowRight', 'KeyD'].includes(e.code)) {
    keys.right = true;
    if (!isAutopilotOn && world.currentLane < 2) world.currentLane++;
  }
});

window.addEventListener('keyup', (e) => {
  if (['ArrowUp', 'KeyW'].includes(e.code)) keys.forward = false;
  if (['ArrowDown', 'KeyS'].includes(e.code)) keys.backward = false;
  if (['ArrowLeft', 'KeyA'].includes(e.code)) keys.left = false;
  if (['ArrowRight', 'KeyD'].includes(e.code)) keys.right = false;
});

// Button event listeners
btnTogglePilot.addEventListener('click', () => {
  isAutopilotOn = !isAutopilotOn;
  btnTogglePilot.textContent = isAutopilotOn ? '🤖 Jev 智驾托管: ON' : '🎮 手动模式: OFF';
  btnTogglePilot.classList.toggle('active', isAutopilotOn);
});

btnTriggerObstacle.addEventListener('click', () => {
  world.triggerSuddenObstacle();
});

btnTriggerCutin.addEventListener('click', () => {
  world.triggerCutIn();
});

btnToggleCamera.addEventListener('click', () => {
  const mode = world.cycleCamera();
  btnToggleCamera.textContent = `🎥 视角: ${mode.toUpperCase()}`;
});

btnReset.addEventListener('click', () => {
  world.reset();
});

// FPS counter
let frameCount = 0;
let lastFpsTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // FPS metric
  frameCount++;
  if (now - lastFpsTime >= 1000) {
    elFps.textContent = `${frameCount} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }

  // 1. Capture Perception Frame
  const frame = world.getPerceptionFrame();

  // 2. Periodic System 2 Strategic Update (every 2.5 seconds or on high risk)
  if (now - lastS2Check > 2500 || frame.minTtc < 3.0) {
    lastS2Check = now;
    if (!system2Planner.isBusy()) {
      elS2Status.textContent = 'THINKING...';
      elS2Status.className = 'hud-meta thinking';
      system2Planner.requestStrategicUpdate(frame, (guidance) => {
        elS2Status.textContent = 'READY';
        elS2Status.className = 'hud-meta ready';
        elS2Guidance.textContent = guidance.macroAdvice;
      });
    }
  }

  // 3. System 1 Reflex Decision
  let decision: ReflexDecision;

  if (isAutopilotOn) {
    decision = reflexEngine.evaluate(frame, system2Planner.getGuidance());
  } else {
    // Manual driving fallback
    let targetLane = world.currentLane;
    let throttle = 0;
    let brake = 0;
    if (keys.forward) throttle = 0.8;
    if (keys.backward) brake = 0.7;

    decision = {
      action: 'ADAPTIVE_CRUISE',
      confidence: 1.0,
      latencyMs: 0.1,
      throttle,
      brake,
      targetLaneIndex: targetLane,
      steering: 0,
      safetyGateIntervened: false,
    };
  }

  // 4. Apply to physics & render step
  world.applyDecision(decision, dt);
  world.step(dt);

  // 5. Update HUD UI
  elSpeed.innerHTML = `${Math.round(world.egoSpeedKmh)} <small>km/h</small>`;

  if (frame.minTtc < 10) {
    elTtc.innerHTML = `${frame.minTtc.toFixed(2)} <small>s</small>`;
    elTtc.className = frame.minTtc < 2.0 ? 'hud-stat-value alert' : 'hud-stat-value warning';
  } else {
    elTtc.innerHTML = `>10 <small>s</small>`;
    elTtc.className = 'hud-stat-value safe';
  }

  if (frame.leadObstacle) {
    elDist.innerHTML = `${Math.round(frame.leadObstacle.relativeDistance)} <small>m</small>`;
  } else {
    elDist.innerHTML = `-- <small>m</small>`;
  }

  elLatency.innerHTML = `${decision.latencyMs.toFixed(1)} <small>ms</small>`;
  elAction.textContent = decision.action;
  elConfidence.textContent = `${Math.round(decision.confidence * 100)}%`;

  if (decision.safetyGateIntervened) {
    elSafetyGate.className = 'hud-gate-banner gate-active';
    elGateText.textContent = `🚨 ${decision.overrideReason ?? 'AI 安全闸强行紧急接管！'}`;
  } else {
    elSafetyGate.className = 'hud-gate-banner gate-armed';
    elGateText.textContent = '🛡️ AI 安全闸持续警戒 (Ready to Intervene)';
  }
}

// Start simulation loop
requestAnimationFrame(animate);
