/**
 * JevPilot Synthetic Procedural Audio Engine
 * Pure Web Audio API - Zero external asset downloads, 100% reliable.
 */
export class DriveAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.enabled = true;
    this.lastBlinkState = false;
    this.lastBlinkTime = 0;
    this.aebBeepTimer = 0;
    this.aebBeepState = false;

    // Audio Nodes
    this.masterGain = null;
    this.motorGain = null;
    this.motorOsc = null;
    this.motorOsc2 = null;
    this.motorFilter = null;
    this.rainGain = null;
    this.rainSource = null;
    this.skidGain = null;
    this.skidSource = null;
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.setupNodes();
      return true;
    } catch (e) {
      console.warn("Web Audio not supported", e);
      return false;
    }
  }

  setupNodes() {
    const ctx = this.ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.6, ctx.currentTime);
    this.masterGain.connect(ctx.destination);

    // 1. Motor Hum Synth (Dual Oscillator EV turbine)
    this.motorGain = ctx.createGain();
    this.motorGain.gain.setValueAtTime(0.001, ctx.currentTime);

    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.setValueAtTime(450, ctx.currentTime);

    this.motorOsc = ctx.createOscillator();
    this.motorOsc.type = "sawtooth";
    this.motorOsc.frequency.setValueAtTime(80, ctx.currentTime);

    this.motorOsc2 = ctx.createOscillator();
    this.motorOsc2.type = "sine";
    this.motorOsc2.frequency.setValueAtTime(160, ctx.currentTime);

    this.motorOsc.connect(this.motorFilter);
    this.motorOsc2.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.masterGain);

    this.motorOsc.start();
    this.motorOsc2.start();

    // 2. Procedural Rain Noise (White/Pink filtered buffer)
    this.setupRain(ctx);

    // 3. Procedural Skid Noise (Bandpassed noise buffer)
    this.setupSkid(ctx);
  }

  setupRain(ctx) {
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.1343714;
      b2 = 0.86650 * b2 + white * 0.3159468;
      output[i] = (b0 + b1 + b2) * 0.08;
    }

    this.rainSource = ctx.createBufferSource();
    this.rainSource.buffer = noiseBuffer;
    this.rainSource.loop = true;

    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = "lowpass";
    rainFilter.frequency.setValueAtTime(1200, ctx.currentTime);

    this.rainGain = ctx.createGain();
    this.rainGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    this.rainSource.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    this.rainSource.start();
  }

  setupSkid(ctx) {
    const bufferSize = ctx.sampleRate * 1.5;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.skidSource = ctx.createBufferSource();
    this.skidSource.buffer = noiseBuffer;
    this.skidSource.loop = true;

    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = "bandpass";
    skidFilter.frequency.setValueAtTime(900, ctx.currentTime);
    skidFilter.Q.setValueAtTime(3.5, ctx.currentTime);

    this.skidGain = ctx.createGain();
    this.skidGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    this.skidSource.connect(skidFilter);
    skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.masterGain);
    this.skidSource.start();
  }

  playBlinkerClick(high = true) {
    if (!this.ctx || this.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(high ? 920 : 710, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.045);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (_) {}
  }

  playAebBeep() {
    if (!this.ctx || this.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1150, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.28, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (_) {}
  }

  playZipperChime() {
    this.ensureContext();
    if (!this.ctx || this.muted) return;
    try {
      const now = this.ctx.currentTime;
      // Tone 1: C5 (523.25 Hz)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Tone 2: E5 (659.25 Hz) - delayed 70ms
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(659.25, now + 0.07);
      gain2.gain.setValueAtTime(0.20, now + 0.07);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(now + 0.07);
      osc2.stop(now + 0.30);
    } catch (_) {}
  }

  toggleMute() {
    this.ensureContext();
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  update(sim, dt) {
    if (!this.ctx || this.muted || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const v = sim.player;
    const speed = Math.abs(v.speed);

    // 1. Motor EV Turbine Synth Modulation
    const baseFreq = 75 + speed * 9.5;
    const throttleBoost = (sim.pedals.throttle || 0) * 45;
    this.motorOsc.frequency.setTargetAtTime(baseFreq + throttleBoost, now, 0.08);
    this.motorOsc2.frequency.setTargetAtTime((baseFreq + throttleBoost) * 1.5, now, 0.08);
    this.motorFilter.frequency.setTargetAtTime(320 + speed * 35, now, 0.08);

    const targetMotorVol = sim.crash ? 0.001 : Math.min(0.22, 0.02 + (speed / 35) * 0.16 + (sim.pedals.throttle ? 0.05 : 0));
    this.motorGain.gain.setTargetAtTime(targetMotorVol, now, 0.08);

    // 2. Blinker Tick-Tock
    if (sim.blinker && sim.blinker !== "none") {
      const blinkOn = Math.floor(sim.time * 4) % 2 === 0;
      if (blinkOn !== this.lastBlinkState) {
        this.lastBlinkState = blinkOn;
        this.playBlinkerClick(blinkOn);
      }
    } else {
      this.lastBlinkState = false;
    }

    // 3. AEB Warning Beeps (Rapid alternating pulse)
    if (sim.aebActive) {
      this.aebBeepTimer += dt;
      if (this.aebBeepTimer > 0.12) {
        this.aebBeepTimer = 0;
        this.playAebBeep();
      }
    } else {
      this.aebBeepTimer = 0;
    }

    // 4. Tire Skid Noise on Emergency Brake
    const hardBraking = (sim.pedals.brake > 0.6 || sim.aebActive) && speed > 2.5;
    const skidVol = hardBraking ? 0.18 : 0.0001;
    this.skidGain.gain.setTargetAtTime(skidVol, now, 0.06);

    // 5. Rain Sound Ambient Modulation
    const isRaining = sim.weather === "rain" || sim.weather === "night_rain";
    const targetRainVol = isRaining ? 0.15 : 0.0001;
    this.rainGain.gain.setTargetAtTime(targetRainVol, now, 0.2);
  }
}
