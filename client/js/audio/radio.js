// Procedural radio. A station is (seed, style); the song and position come from server time,
// so every player tuned to the same station hears the same notes in sync.
import { RNG } from '/shared/rng.js';

export const STATIONS = [
  { name: 'Haven FM 88.1', genre: 'lo-fi beats', style: 'lofi', seed: 881, bpm: [76, 86], bars: 32 },
  { name: 'Sunset 96.5', genre: 'synthwave', style: 'synth', seed: 965, bpm: [96, 108], bars: 32 },
  { name: 'Pixel 101.3', genre: 'chiptune', style: 'chip', seed: 1013, bpm: [120, 140], bars: 32 },
  { name: 'Harbor Jazz 104.7', genre: 'cozy jazz', style: 'jazz', seed: 1047, bpm: [100, 118], bars: 32 },
];

const PROGS = [
  [[2, 'm9'], [5, '13'], [1, 'maj9'], [6, 'm9']],
  [[4, 'maj7'], [3, 'm7'], [2, 'm7'], [1, 'maj7']],
  [[4, 'maj7'], [5, '7'], [3, 'm7'], [6, 'm7']],
  [[1, 'maj7'], [3, 'm7'], [4, 'maj7'], [4, 'm6']],
  [[6, 'm9'], [2, 'm9'], [4, 'maj7'], [3, '7#9']],
  [[1, 'maj9'], [6, 'm9'], [4, 'maj9'], [5, '13']],
];
const DEG = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const SHAPES = { maj7: [0, 4, 7, 11], maj9: [4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [3, 7, 10, 14], 13: [4, 10, 14, 21], 7: [0, 4, 7, 10], '7#9': [4, 10, 15], m6: [0, 3, 7, 9] };
const PENTA = [0, 2, 4, 7, 9];
const ADJ = ['Sleepy', 'Neon', 'Velvet', 'Rainy', 'Golden', 'Paper', 'Cozy', 'Late', 'Soft', 'Blue', 'Lucky', 'Quiet', 'Pastel', 'Hazy', 'Little'];
const NOUN = ['Harbor', 'Streetlights', 'Cat', 'Tram', 'Window', 'Rooftops', 'Lanterns', 'Cassette', 'Ferry', 'Bakery', 'Pier', 'Clouds', 'Postcard', 'Avenue', 'Moon'];

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

function makeSong(st, idx) {
  const r = new RNG((st.seed * 7919) ^ (idx * 104729));
  const bpm = r.int(st.bpm[0], st.bpm[1]);
  const key = 60 + r.pick([0, 2, 3, 5, 7, 9, -2]);
  const prog = r.pick(PROGS);
  const name = `${r.pick(ADJ)} ${r.pick(NOUN)}`;
  const melody = [];
  for (let b = 0; b < st.bars; b++) {
    const bar = [];
    let deg = r.int(0, 4);
    for (let s = 0; s < 16; s += 2) {
      if (r.next() < (st.style === 'chip' ? 0.7 : 0.42)) {
        const step = r.weighted([[1, 3], [-1, 3], [2, 1], [-2, 1], [0, 1.5]]);
        deg = Math.max(0, Math.min(9, deg + step));
        bar.push([s, deg, r.chance(0.3) ? 2 : 1]);
      }
    }
    melody.push(bar);
  }
  return { bpm, key, prog, name, melody, rng: r, swing: st.style === 'lofi' ? 0.58 : st.style === 'jazz' ? 0.62 : 0.5 };
}

export class Radio {
  constructor(A) {
    this.A = A;
    this.station = -1;
    this.timer = null;
    this.onChange = null;
    this.volume = 1;
  }

  ensureChain() {
    if (this.out) return;
    const A = this.A, ctx = A.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 5200;
    const sh = A.shaper(1.5);
    this.keys = ctx.createGain(); this.keys.gain.value = 1;
    this.keys.connect(this.out);
    this.drums = ctx.createGain(); this.drums.gain.value = 0.9;
    this.drums.connect(this.out);
    this.out.connect(hp).connect(this.lp).connect(sh).connect(A.music);
    // wow & flutter on everything with a detune input
    this.wow = ctx.createGain(); this.wow.gain.value = 8;
    const w1 = ctx.createOscillator(); w1.frequency.value = 0.5; w1.connect(this.wow); w1.start();
    this.flutter = ctx.createGain(); this.flutter.gain.value = 2;
    const w2 = ctx.createOscillator(); w2.frequency.value = 6; w2.connect(this.flutter); w2.start();
    // vinyl hiss + crackle
    const hiss = ctx.createBufferSource(); hiss.buffer = A.pink; hiss.loop = true;
    const hhp = ctx.createBiquadFilter(); hhp.type = 'highpass'; hhp.frequency.value = 3000;
    this.vinyl = ctx.createGain(); this.vinyl.gain.value = 0;
    hiss.connect(hhp).connect(this.vinyl).connect(this.out);
    hiss.start();
    const cr = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = cr.getChannelData(0);
    for (let i = 0; i < 160; i++) { const p = Math.floor(Math.random() * d.length); d[p] = (Math.random() < 0.1 ? 0.7 : 0.15) * (Math.random() < 0.5 ? 1 : -1); }
    const crs = ctx.createBufferSource(); crs.buffer = cr; crs.loop = true;
    const crbp = ctx.createBiquadFilter(); crbp.type = 'bandpass'; crbp.frequency.value = 2500; crbp.Q.value = 0.5;
    this.crackle = ctx.createGain(); this.crackle.gain.value = 0;
    crs.connect(crbp).connect(this.crackle).connect(this.out);
    crs.start();
    const worker = new Worker(URL.createObjectURL(new Blob(['let i;onmessage=e=>{clearInterval(i);if(e.data==="start")i=setInterval(()=>postMessage(0),25)}'], { type: 'text/javascript' })));
    worker.onmessage = () => this.schedule();
    worker.postMessage('start');
    this.worker = worker;
  }

  // serverNow: function returning synced server time (s)
  tune(i, serverNow) {
    const A = this.A;
    if (!A.ready) return;
    this.ensureChain();
    this.serverNow = serverNow;
    const t = A.ctx.currentTime;
    if (i < 0 || i >= STATIONS.length) {
      this.station = -1;
      this.out.gain.setTargetAtTime(0, t, 0.08);
      this.onChange?.(null);
      return;
    }
    // static burst between stations
    A.burst(A.music, t, { buf: A.white, f: 2000, q: 0.5, gain: 0.12, atk: 0.01, tau: 0.08 });
    this.station = i;
    this.song = null;
    this.out.gain.setTargetAtTime(0.0001, t, 0.02);
    this.out.gain.setTargetAtTime(0.9 * this.volume, t + 0.25, 0.1);
    const st = STATIONS[i];
    this.vinyl.gain.setTargetAtTime(st.style === 'lofi' ? 0.014 : st.style === 'jazz' ? 0.008 : 0, t, 0.2);
    this.crackle.gain.setTargetAtTime(st.style === 'lofi' ? 0.5 : st.style === 'jazz' ? 0.3 : 0, t, 0.2);
    this.nextT = 0;
  }

  setContext(inCar, onFoot) {
    if (!this.out) return;
    const t = this.A.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(inCar ? 5200 : 2600, t, 0.2);
    if (this.station >= 0) this.out.gain.setTargetAtTime((inCar ? 0.9 : onFoot ? 0.45 : 0) * this.volume, t, 0.2);
  }

  schedule() {
    const A = this.A;
    if (this.station < 0 || !A.ready || !this.serverNow) return;
    const st = STATIONS[this.station];
    const ctxNow = A.ctx.currentTime;
    const sNow = this.serverNow();
    if (!this.song || this.songStation !== this.station) {
      // align to the global song grid
      const approxLen = (st.bars * 4 * 60) / ((st.bpm[0] + st.bpm[1]) / 2);
      const idx = Math.floor(sNow / approxLen);
      this.song = makeSong(st, idx);
      this.song.bars = Math.max(8, Math.floor(approxLen / (240 / this.song.bpm)));
      this.songLen = approxLen;
      this.songStation = this.station;
      this.songStart = idx * approxLen;
      const d16 = 60 / this.song.bpm / 4;
      const into = sNow - this.songStart;
      const step = Math.ceil(into / d16);
      this.stepIdx = step;
      this.nextT = ctxNow + (step * d16 - into);
      this.onChange?.({ station: st, song: this.song.name });
    }
    const d16 = 60 / this.song.bpm / 4;
    const total = this.song.bars * 16;
    while (this.nextT < ctxNow + 0.12) {
      if (this.stepIdx >= total) {
        if (sNow >= this.songStart + this.songLen) this.song = null;
        return;
      }
      if (this.nextT > ctxNow - 0.05) this.playStep(st, this.song, this.stepIdx, this.nextT, d16);
      this.stepIdx++;
      this.nextT += d16;
    }
  }

  playStep(st, song, si, t, d16) {
    const bar = Math.floor(si / 16), s = si % 16;
    const r = song.rng;
    const tt = t + (s % 2 ? (song.swing - 0.5) * 2 * d16 : 0) + (r.next() - 0.5) * 0.006;
    const section = bar < 4 ? 'intro' : bar < 12 ? 'A' : bar < 20 ? 'B' : bar < 24 ? 'break' : bar < 30 ? 'A2' : 'outro';
    const ch = song.prog[bar % song.prog.length];
    const root = song.key + DEG[ch[0]] - 12;
    const shape = SHAPES[ch[1]];
    const drums = section !== 'intro' && section !== 'outro';
    const style = st.style;
    if (s === 0) {
      const voicing = shape.map((iv) => root + 12 + iv);
      if (style === 'lofi' || style === 'jazz') voicing.forEach((n, k) => this.ep(n, tt + k * 0.012, d16 * 16 * 0.96, style === 'jazz' ? 0.05 : 0.06));
      if (style === 'synth') voicing.forEach((n) => this.pad(n, tt, d16 * 16, 0.035));
      if (style === 'chip' && section !== 'intro') voicing.slice(0, 3).forEach((n) => this.chipPad(n, tt, d16 * 16, 0.025));
    }
    // bass
    if (style === 'jazz') { if (s % 4 === 0) this.bass(root - 12 + [0, 7, 12, 5][s / 4] + (bar % 2 && s === 12 ? 2 : 0), tt, d16 * 3.6, 0.32); }
    else if (style === 'synth') { if (s % 2 === 0) this.bass(root - 12 + (s % 8 === 6 ? 12 : 0), tt, d16 * 1.8, 0.22, 'sawtooth'); }
    else if (style === 'chip') { if (s % 2 === 0) this.bass(root - 12 + (s % 4 === 2 ? 12 : 0), tt, d16 * 1.5, 0.16, 'triangle'); }
    else if (s === 0 || s === 10 || (s === 7 && r.chance(0.4))) this.bass(root - 12 + (s === 10 && r.chance(0.3) ? 7 : 0), tt, d16 * 5, 0.3);
    // drums
    if (drums) {
      if (style === 'lofi') {
        if ((s === 0 || s === 7 || s === 10) && section !== 'break') this.kick(tt, s ? 0.8 : 1);
        if (s === 4 || s === 12) this.snare(tt, 1);
        if (s % 2 === 0) this.hat(tt, s % 4 ? 0.4 : 0.6, false);
        else if (r.chance(0.25)) this.hat(tt, 0.2, false);
      } else if (style === 'synth') {
        if (s % 4 === 0) this.kick(tt, 1);
        if (s === 4 || s === 12) this.snare(tt, 1.1, true);
        if (s % 2 === 1) this.hat(tt, 0.4, s % 4 === 3);
      } else if (style === 'chip') {
        if (s % 4 === 0) this.chipDrum(tt, 'k');
        if (s === 4 || s === 12) this.chipDrum(tt, 's');
        if (s % 2 === 1) this.chipDrum(tt, 'h');
      } else {
        if (s % 4 === 0 && r.chance(0.6)) this.kick(tt, 0.5);
        if (s % 4 === 2 || (s % 4 === 3 && r.chance(0.3))) this.brush(tt, 0.5);
        if (s === 4 || s === 12) this.brush(tt, 0.9);
      }
    }
    // melody / arps
    const mel = song.melody[bar];
    if (style === 'synth' && section !== 'intro') {
      const arp = [0, 2, 1, 3][Math.floor(s / 2) % 4];
      if (s % 2 === 0) this.lead(root + 24 + shape[arp % shape.length], tt, d16 * 1.6, 0.03, 'sawtooth');
    } else if (style === 'chip' && section !== 'intro') {
      if (s % 2 === 1) this.lead(root + 24 + shape[(s >> 1) % shape.length], tt, d16 * 0.9, 0.02, 'square');
    }
    if ((section === 'B' || section === 'A2' || style === 'chip') && mel) {
      for (const [ms, deg, len] of mel) if (ms === s) {
        const n = song.key + 12 + PENTA[deg % 5] + 12 * Math.floor(deg / 5);
        if (style === 'chip') this.lead(n + 12, tt, d16 * 2 * len, 0.035, 'square');
        else if (style === 'synth') this.lead(n, tt, d16 * 2 * len, 0.04, 'triangle');
        else this.ep(n + 12, tt, d16 * 2.5 * len, 0.045);
      }
    }
    if (s === 0 && (style === 'lofi' || style === 'synth') && drums) this.duck(tt);
  }

  duck(t) {
    const g = this.keys.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.55, t + 0.012);
    g.setTargetAtTime(1, t + 0.03, 0.09);
  }

  osc(type, f, t, dur) {
    const o = this.A.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    this.wow.connect(o.detune); this.flutter.connect(o.detune);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => { try { this.wow.disconnect(o.detune); this.flutter.disconnect(o.detune); } catch { /* done */ } };
    return o;
  }

  ep(n, t, dur, gain) {
    const ctx = this.A.ctx;
    const f = mtof(n);
    const car = this.osc('sine', f, t, dur + 0.4);
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.5, t); mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 1.2);
    mod.connect(mg).connect(car.frequency);
    mod.start(t); mod.stop(t + dur + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setTargetAtTime(gain * 0.4, t + 0.01, 0.6);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.15);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    car.connect(g).connect(lp).connect(this.keys);
  }
  pad(n, t, dur, gain) {
    const ctx = this.A.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.4); g.gain.setTargetAtTime(0.0001, t + dur - 0.2, 0.4);
    for (const d of [-7, 7]) { const o = this.osc('sawtooth', mtof(n), t, dur + 1); o.detune.value = d; o.connect(lp); }
    lp.connect(g).connect(this.keys);
  }
  chipPad(n, t, dur, gain) {
    const ctx = this.A.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.setTargetAtTime(gain * 0.5, t + 0.05, 0.3); g.gain.setTargetAtTime(0.0001, t + dur - 0.05, 0.05);
    const o = this.osc('square', mtof(n), t, dur);
    o.connect(g).connect(this.keys);
  }
  lead(n, t, dur, gain, type) {
    const ctx = this.A.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.06);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = type === 'square' ? 4000 : 2400;
    const o = this.osc(type, mtof(n), t, dur + 0.3);
    o.connect(lp).connect(g).connect(this.keys);
  }
  bass(n, t, dur, gain, type = 'sine') {
    const ctx = this.A.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.setTargetAtTime(gain * 0.6, t + 0.02, 0.3); g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = type === 'sine' ? 400 : 700;
    const o = this.osc(type, mtof(n), t, dur + 0.2);
    o.connect(lp).connect(g).connect(this.drums);
    if (type === 'sine') { const o2 = this.osc('triangle', mtof(n), t, dur + 0.2); const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2).connect(lp); }
  }
  kick(t, v) {
    const A = this.A;
    A.tone(this.drums, t, { f: 150, f2: 45, glide: 0.12, gain: 0.55 * v, atk: 0.002, tau: 0.12 });
    A.burst(this.drums, t, { type: 'highpass', f: 4000, gain: 0.05 * v, tau: 0.002 });
  }
  snare(t, v, gated) {
    const A = this.A;
    A.burst(this.drums, t, { f: 1800, q: 0.8, gain: 0.3 * v, tau: gated ? 0.06 : 0.12 });
    A.tone(this.drums, t, { type: 'triangle', f: 185, gain: 0.15 * v, tau: 0.05 });
    if (gated) A.burst(this.drums, t, { type: 'lowpass', f: 5000, gain: 0.1 * v, tau: 0.18 });
  }
  hat(t, v, open) { this.A.burst(this.drums, t, { type: 'highpass', f: 7000, gain: 0.12 * v, tau: open ? 0.15 : 0.03 }); }
  brush(t, v) { this.A.burst(this.drums, t, { buf: this.A.pink, type: 'bandpass', f: 4500, q: 0.6, gain: 0.12 * v, atk: 0.01, tau: 0.06 }); }
  chipDrum(t, k) {
    const A = this.A;
    if (k === 'k') A.tone(this.drums, t, { type: 'square', f: 180, f2: 50, glide: 0.06, gain: 0.12, tau: 0.04 });
    else if (k === 's') A.burst(this.drums, t, { type: 'bandpass', f: 3000, q: 0.5, gain: 0.15, tau: 0.04 });
    else A.burst(this.drums, t, { type: 'highpass', f: 9000, gain: 0.06, tau: 0.015 });
  }
}
