import { clamp01 } from '../core/MathUtil';

export type SfxName =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'punch'
  | 'reload'
  | 'crash'
  | 'explosion'
  | 'pickup'
  | 'cash'
  | 'mission'
  | 'busted'
  | 'hit'
  | 'ui'
  | 'horn';

const SCALE = [0, 3, 5, 7, 10, 12, 10, 7]; // minor pentatonic-ish
const BASS_PATTERN = [0, 0, 7, 0, 5, 0, 7, 3];

/**
 * All audio is synthesised with the Web Audio API — no sample files.
 * The context is created lazily so browsers never block on autoplay rules.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenLfo: OscillatorNode | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;

  volume = 0.7;
  musicEnabled = true;

  /** Create (or resume) the audio context. Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 8;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    this.sfxBus = sfx;

    const music = ctx.createGain();
    music.gain.value = 0.32;
    music.connect(master);
    this.musicBus = music;

    // Noise buffer for percussive effects.
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    this.startEngine();
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.master) this.master.gain.value = this.volume;
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.32 : 0;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /* ─────────────────── one shot sounds ─────────────────── */

  play(name: SfxName): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;

    switch (name) {
      case 'pistol':
        this.gunshot(now, 0.32, 180, 0.09);
        break;
      case 'smg':
        this.gunshot(now, 0.22, 240, 0.05);
        break;
      case 'shotgun':
        this.gunshot(now, 0.55, 110, 0.16);
        break;
      case 'punch':
        this.thump(now, 140, 0.08, 0.25);
        break;
      case 'hit':
        this.thump(now, 320, 0.06, 0.2);
        break;
      case 'reload':
        this.click(now, 900, 0.05);
        this.click(now + 0.12, 1400, 0.04);
        break;
      case 'crash':
        this.crash(now, 0.5);
        break;
      case 'explosion':
        this.explosion(now);
        break;
      case 'pickup':
        this.blip(now, 660, 0.08, 'triangle', 0.22);
        this.blip(now + 0.07, 990, 0.1, 'triangle', 0.2);
        break;
      case 'cash':
        this.blip(now, 1180, 0.06, 'square', 0.16);
        this.blip(now + 0.05, 1560, 0.09, 'square', 0.14);
        break;
      case 'mission':
        this.blip(now, 523, 0.16, 'triangle', 0.2);
        this.blip(now + 0.12, 659, 0.16, 'triangle', 0.2);
        this.blip(now + 0.24, 784, 0.3, 'triangle', 0.22);
        break;
      case 'busted':
        this.blip(now, 220, 0.5, 'sawtooth', 0.22);
        this.blip(now + 0.2, 165, 0.6, 'sawtooth', 0.2);
        break;
      case 'ui':
        this.blip(now, 440, 0.05, 'square', 0.12);
        break;
      case 'horn':
        this.blip(now, 392, 0.32, 'square', 0.16);
        this.blip(now, 523, 0.32, 'square', 0.14);
        break;
    }
  }

  private blip(at: number, freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(this.sfxBus!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private click(at: number, freq: number, dur: number): void {
    this.blip(at, freq, dur, 'square', 0.09);
  }

  private thump(at: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.35, at + dur);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(this.sfxBus!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private gunshot(at: number, gain: number, cutoff: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff * 6, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus!);
    src.start(at, Math.random() * 0.4);
    src.stop(at + dur + 0.02);
  }

  private crash(at: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, at);
    filter.frequency.exponentialRampToValueAtTime(320, at + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.45);
    this.thump(at, 90, 0.22, gain * 0.7);
  }

  private explosion(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, at);
    filter.frequency.exponentialRampToValueAtTime(120, at + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus!);
    src.start(at, Math.random() * 0.3);
    src.stop(at + 1.2);
    this.thump(at, 70, 0.6, 0.6);
  }

  /* ─────────────────── engine ─────────────────── */

  private startEngine(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus!);
    osc.start();
    sub.start();

    this.engineOsc = osc;
    this.engineSub = sub;
    this.engineGain = gain;
    this.engineFilter = filter;
  }

  /** rpm 0..1, load 0..1 */
  setEngine(active: boolean, rpm: number, load: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineOsc || !this.engineGain || !this.engineFilter || !this.engineSub) return;
    const now = ctx.currentTime;
    const base = 46 + rpm * 190;
    this.engineOsc.frequency.setTargetAtTime(base, now, 0.06);
    this.engineSub.frequency.setTargetAtTime(base * 0.5, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(420 + rpm * 2200 + load * 500, now, 0.08);
    const target = active ? 0.035 + load * 0.075 + rpm * 0.035 : 0;
    this.engineGain.gain.setTargetAtTime(target, now, 0.12);
  }

  /* ─────────────────── siren ─────────────────── */

  setSiren(active: boolean, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (active && !this.sirenOsc) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 640;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.6;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 2;
      osc.connect(filter);
      filter.connect(g);
      g.connect(this.sfxBus!);
      osc.start();
      lfo.start();
      this.sirenOsc = osc;
      this.sirenGain = g;
      this.sirenLfo = lfo;
    }
    if (this.sirenGain) {
      const target = active ? 0.045 * Math.max(0, Math.min(1, intensity)) : 0;
      this.sirenGain.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
    }
    if (!active && this.sirenOsc) {
      // Keep the oscillator alive but silent; restarting is cheap enough to skip.
      this.sirenLfo?.stop();
      this.sirenOsc.stop();
      this.sirenLfo = null;
      this.sirenOsc = null;
      this.sirenGain = null;
    }
  }

  /* ─────────────────── music ─────────────────── */

  startMusic(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 40);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const stepDur = 0.26; // ~115 bpm in 8ths
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      const step = this.musicStep % 16;
      const time = this.nextNoteTime;

      // Kick on beats 1 and 3.
      if (step % 8 === 0 || step === 6) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
        g.gain.setValueAtTime(0.5, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
        osc.connect(g);
        g.connect(bus);
        osc.start(time);
        osc.stop(time + 0.22);
      }

      // Hi-hat.
      if (step % 2 === 1) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        src.connect(f);
        f.connect(g);
        g.connect(bus);
        src.start(time, Math.random() * 0.2);
        src.stop(time + 0.06);
      }

      // Bass.
      if (step % 2 === 0) {
        const note = BASS_PATTERN[(step / 2) % BASS_PATTERN.length];
        const freq = 55 * Math.pow(2, note / 12);
        const osc = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        f.type = 'lowpass';
        f.frequency.setValueAtTime(520, time);
        f.frequency.exponentialRampToValueAtTime(180, time + stepDur);
        g.gain.setValueAtTime(0.16, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + stepDur * 0.9);
        osc.connect(f);
        f.connect(g);
        g.connect(bus);
        osc.start(time);
        osc.stop(time + stepDur);
      }

      // Arpeggio.
      if (this.musicEnabled) {
        const note = SCALE[step % SCALE.length];
        const freq = 220 * Math.pow(2, note / 12);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.045, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + stepDur * 0.6);
        osc.connect(g);
        g.connect(bus);
        osc.start(time);
        osc.stop(time + stepDur * 0.7);
      }

      this.nextNoteTime += stepDur;
      this.musicStep++;
    }
  }
}
