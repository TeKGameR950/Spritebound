// Web Audio core: buses, master compressor, reverb/slapback sends, noise buffers and
// positional one-shots (top-down: stereo pan + distance gain + air absorption).
import { SFX } from './sfx.js';

const U = 8; // world units per metre

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, y: 0 };
    this.vol = { master: 0.8, sfx: 0.9, music: 0.55, voice: 1, ambience: 0.7, ui: 0.7 };
    this.voices = 0;
    this.recent = new Map();
    this.muted = false;
  }

  // Must be called from a user gesture.
  async start() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    const bus = (v) => { const g = ctx.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.sfx = bus(this.vol.sfx);
    this.veh = bus(this.vol.sfx * 0.8);
    this.amb = bus(this.vol.ambience);
    this.music = bus(this.vol.music);
    this.ui = bus(this.vol.ui);
    this.voiceBus = bus(this.vol.voice);
    // noise buffers
    this.white = this.noise('white');
    this.pink = this.noise('pink');
    this.brown = this.noise('brown');
    // city reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.3, 2.6);
    const rvHp = ctx.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 280;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(rvHp).connect(this.reverb).connect(this.master);
    // slapback for gunshots and horns
    this.slap = ctx.createDelay(1);
    this.slap.delayTime.value = 0.21;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    const slapLp = ctx.createBiquadFilter(); slapLp.type = 'lowpass'; slapLp.frequency.value = 2000;
    this.slapSend = ctx.createGain(); this.slapSend.gain.value = 0.3;
    this.slapSend.connect(this.slap); this.slap.connect(slapLp).connect(fb).connect(this.slap);
    slapLp.connect(this.master);
    this.tanh = {};
    for (const k of [1.5, 2, 3, 4]) this.tanh[k] = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(k * (i / 511.5 - 1)) / Math.tanh(k));
    this.applyVolumes();
    this.ready = true;
    if (ctx.state !== 'running') await ctx.resume();
  }

  noise(type, sec = 2) {
    const ctx = this.ctx;
    const n = ctx.sampleRate * sec, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.veh.gain.setTargetAtTime(this.vol.sfx * 0.8, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.ambience, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music, t, 0.05);
    this.ui.gain.setTargetAtTime(this.vol.ui, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(this.vol.voice, t, 0.05);
  }

  // Spatial parameters for a world position relative to the listener.
  spatial(x, y) {
    const dx = (x - this.listener.x) / U, dy = (y - this.listener.y) / U;
    const d = Math.hypot(dx, dy);
    return {
      pan: Math.max(-1, Math.min(1, dx / 22)) * 0.8,
      gain: 1 / (1 + (d / 16) ** 2),
      lp: 18000 / (1 + d / 14),
      dist: d,
    };
  }

  // Positional output chain: returns an input node that routes into bus.
  chain(x, y, bus, opts = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    const pan = ctx.createStereoPanner();
    const sp = x === undefined ? { pan: 0, gain: 1, lp: 20000, dist: 0 } : this.spatial(x, y);
    g.gain.value = sp.gain * (opts.gain ?? 1);
    lp.frequency.value = Math.min(20000, sp.lp);
    pan.pan.value = sp.pan;
    g.connect(lp).connect(pan).connect(bus);
    if (opts.reverb) { const s = ctx.createGain(); s.gain.value = opts.reverb * (0.5 + Math.min(1, sp.dist / 40)); pan.connect(s).connect(this.reverbSend); }
    if (opts.slap) { const s = ctx.createGain(); s.gain.value = opts.slap; pan.connect(s).connect(this.slapSend); }
    return { input: g, sp, nodes: [g, lp, pan] };
  }

  // Play a named synthesized sound. x/y optional (non-positional when omitted).
  play(name, x, y, opts = {}) {
    if (!this.ready || this.muted) return;
    const fn = SFX[name];
    if (!fn) return;
    const now = this.ctx.currentTime;
    const key = name + (x === undefined ? '' : Math.round(x / 8) + ',' + Math.round(y / 8));
    if ((this.recent.get(key) || 0) > now - 0.03) return;
    this.recent.set(key, now);
    if (this.recent.size > 300) this.recent.clear();
    if (this.voices > 40) return;
    const bus = opts.bus === 'ui' ? this.ui : opts.bus === 'amb' ? this.amb : opts.bus === 'veh' ? this.veh : this.sfx;
    const ch = this.chain(x, y, bus, opts);
    if (ch.sp.gain < 0.012 && !opts.force) return;
    this.voices++;
    const dur = fn(this, ch.input, now + (opts.delay || 0), opts) || 1;
    setTimeout(() => { this.voices--; try { ch.nodes[0].disconnect(); } catch { /* already gone */ } }, (dur + (opts.delay || 0)) * 1000 + 200);
  }

  // ---- small helpers used by the synth library
  env(p, t, peak, atk, tau) {
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + atk);
    p.setTargetAtTime(0.0001, t + atk, tau);
  }
  burst(out, t, { buf, type = 'bandpass', f = 1000, f2, q = 1, gain = 1, atk = 0.002, tau = 0.05, rate = 1 }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buf || this.white;
    s.playbackRate.value = rate;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + tau * 4);
    const g = ctx.createGain();
    this.env(g.gain, t, gain, atk, tau);
    s.connect(fl).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + atk + tau * 7);
  }
  tone(out, t, { type = 'sine', f = 440, f2, glide = 0.1, gain = 0.3, atk = 0.005, tau = 0.1, dur, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + glide);
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g.gain, t, gain, atk, tau);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + (dur ?? atk + tau * 7));
    return o;
  }
  shaper(k) {
    const s = this.ctx.createWaveShaper();
    s.curve = this.tanh[k] || this.tanh[2];
    return s;
  }
  duckMusic(amount = 0.5, dur = 0.8) {
    if (!this.ready) return;
    const g = this.music.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.vol.music * amount, t + 0.02);
    g.setTargetAtTime(this.vol.music, t + dur * 0.3, dur * 0.4);
  }
}
