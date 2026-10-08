// Procedural sound library. Each entry: (audio, out, t, opts) => duration in seconds.
const R = (a, b) => a + Math.random() * (b - a);

function gun(A, out, t, P) {
  const ctx = A.ctx;
  const sh = A.shaper(3);
  sh.connect(out);
  const rate = R(0.92, 1.08);
  A.burst(sh, t, { type: 'highpass', f: 3000, gain: P.g * 0.6, atk: 0.0005, tau: 0.002 });
  A.burst(sh, t, { type: P.type || 'bandpass', f: P.f * rate, f2: P.f2, q: P.q, gain: P.g, tau: P.tau, rate });
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(P.th[0] * rate, t);
  o.frequency.exponentialRampToValueAtTime(P.th[1], t + P.th[2]);
  g.gain.setValueAtTime(P.g * 0.8, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + P.th[2] * 1.5);
  o.connect(g).connect(sh);
  o.start(t); o.stop(t + P.th[2] * 1.6);
  return P.dur;
}

export const SFX = {
  pistol: (A, out, t) => gun(A, out, t, { f: 1200, q: 0.8, tau: 0.025, th: [180, 60, 0.06], g: 0.9, dur: 0.4 }),
  smg: (A, out, t) => {
    A.tone(out, t, { type: 'square', f: 5000, gain: 0.04, atk: 0.0005, tau: 0.001 });
    return gun(A, out, t, { f: 2000, q: 1, tau: 0.012, th: [220, 90, 0.03], g: 0.6, dur: 0.25 });
  },
  rifle: (A, out, t) => gun(A, out, t, { f: 1600, q: 0.9, tau: 0.02, th: [160, 50, 0.05], g: 0.85, dur: 0.35 }),
  shotgun: (A, out, t) => {
    gun(A, out, t, { f: 2500, f2: 600, type: 'lowpass', q: 0.7, tau: 0.07, th: [120, 40, 0.15], g: 1.3, dur: 0.6 });
    A.burst(out, t + 0.35, { f: 3000, q: 3, gain: 0.25, tau: 0.008 });
    A.burst(out, t + 0.44, { f: 2600, q: 3, gain: 0.3, tau: 0.01 });
    return 0.7;
  },
  rocket: (A, out, t) => {
    A.burst(out, t, { buf: A.brown, type: 'lowpass', f: 2500, f2: 300, gain: 1.2, atk: 0.005, tau: 0.25 });
    A.burst(out, t, { type: 'bandpass', f: 900, f2: 3000, q: 0.6, gain: 0.5, atk: 0.02, tau: 0.3 });
    return 1.8;
  },
  throw: (A, out, t) => { A.burst(out, t, { f: 400, f2: 1400, q: 1.5, gain: 0.25, atk: 0.02, tau: 0.04 }); return 0.3; },
  bounce: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: R(500, 700), f2: 300, glide: 0.05, gain: 0.15, tau: 0.03 }); return 0.2; },
  explosion: (A, out, t) => {
    const ctx = A.ctx;
    const sh = A.shaper(4);
    sh.connect(out);
    A.burst(sh, t, { type: 'highpass', f: 200, gain: 1, atk: 0.001, tau: 0.03 });
    const s = ctx.createBufferSource(); s.buffer = A.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(150, t + 1.5);
    const g = ctx.createGain(); A.env(g.gain, t, 2.2, 0.005, 0.6);
    s.connect(lp).connect(g).connect(sh);
    s.start(t, Math.random()); s.stop(t + 3.5);
    A.tone(sh, t, { f: 60, f2: 25, glide: 0.5, gain: 1, atk: 0.003, tau: 0.35 });
    for (let i = 0; i < 26; i++) A.burst(out, t + R(0.15, 1.5), { f: R(2000, 5000), q: 2, gain: R(0.02, 0.12), tau: R(0.004, 0.015) });
    A.duckMusic(0.45, 1.2);
    return 3.6;
  },
  punch: (A, out, t) => {
    A.tone(out, t, { f: R(100, 120), f2: 55, glide: 0.07, gain: 0.7, tau: 0.03 });
    A.burst(out, t, { type: 'lowpass', f: 1200, gain: 0.5, tau: 0.025 });
    A.burst(out, t, { type: 'highpass', f: 2500, gain: 0.35, tau: 0.004 });
    return 0.4;
  },
  whoosh: (A, out, t) => { A.burst(out, t, { f: 400, f2: 1200, q: 1.5, gain: 0.3, atk: 0.03, tau: 0.04 }); return 0.35; },
  batHit: (A, out, t) => {
    A.tone(out, t, { type: 'triangle', f: 320, f2: 120, glide: 0.08, gain: 0.5, tau: 0.05 });
    A.burst(out, t, { f: 900, q: 4, gain: 0.5, tau: 0.04 });
    return 0.4;
  },
  step: (A, out, t, o) => {
    const surf = o.surf || 'hard';
    const g = o.gain ?? 1;
    if (surf === 'grass') {
      A.burst(out, t, { f: 3500, q: 0.7, gain: 0.12 * g, atk: 0.01, tau: 0.03 });
      for (let i = 0; i < 3; i++) A.burst(out, t + R(0, 0.04), { type: 'highpass', f: 5000, gain: 0.04 * g, tau: 0.002 });
    } else if (surf === 'wood') {
      A.burst(out, t, { f: 700, q: 4, gain: 0.25 * g, tau: 0.03 });
      A.tone(out, t, { f: 180, gain: 0.08 * g, tau: 0.02 });
    } else if (surf === 'sand' || surf === 'gravel' || surf === 'dirt') {
      for (let i = 0; i < 7; i++) A.burst(out, t + R(0, 0.06), { f: 2500, q: 1, gain: R(0.02, 0.07) * g, tau: 0.003 });
    } else if (surf === 'water') {
      A.burst(out, t, { f: 1000, q: 1, gain: 0.2 * g, tau: 0.03 });
      A.tone(out, t, { f: 600, f2: 1200, glide: 0.04, gain: 0.05 * g, tau: 0.02 });
    } else {
      A.burst(out, t, { f: 1800, q: 1.2, gain: 0.14 * g, tau: 0.015 });
      A.tone(out, t, { f: 90, gain: 0.08 * g, tau: 0.015 });
      A.burst(out, t + 0.04, { f: 2200, q: 1.2, gain: 0.07 * g, tau: 0.01 });
    }
    return 0.3;
  },
  crash: (A, out, t, o) => {
    const I = Math.min(1, (o.i ?? 100) / 260);
    const sh = A.shaper(3);
    sh.connect(out);
    A.tone(sh, t, { f: 80, f2: 35, glide: 0.15, gain: 0.4 + I * 0.6, tau: 0.08 });
    for (let k = 0; k < 4; k++) A.burst(sh, t + R(0, 0.03), { f: R(400, 3000), q: R(10, 20), gain: (0.4 + I) * 0.5, tau: R(0.08, 0.3) * (0.5 + I) });
    if (I > 0.55) for (let k = 0; k < 18; k++) A.tone(out, t + R(0, 0.4), { f: R(3000, 8000), gain: 0.04, tau: R(0.01, 0.03) });
    return 1;
  },
  tock: (A, out, t) => { A.burst(out, t, { f: 900, q: 5, gain: 0.3, tau: 0.03 }); return 0.2; },
  clang: (A, out, t) => {
    for (const f of [523, 1307, 2190]) A.tone(out, t, { f: f * R(0.9, 1.1), gain: 0.12, tau: 0.12 });
    A.burst(out, t, { type: 'highpass', f: 3000, gain: 0.3, tau: 0.002 });
    return 0.8;
  },
  glass: (A, out, t) => {
    for (let k = 0; k < 22; k++) A.tone(out, t + R(0, 0.35), { f: R(3000, 8000), gain: 0.05, tau: R(0.01, 0.04) });
    A.burst(out, t, { type: 'highpass', f: 5000, gain: 0.3, tau: 0.08 });
    return 0.6;
  },
  ricochet: (A, out, t) => {
    A.tone(out, t, { type: 'sine', f: R(2400, 3600), f2: R(900, 1400), glide: 0.18, gain: 0.08, tau: 0.08 });
    A.burst(out, t, { type: 'highpass', f: 4000, gain: 0.15, tau: 0.003 });
    return 0.4;
  },
  impactSoft: (A, out, t) => { A.burst(out, t, { type: 'lowpass', f: 800, gain: 0.35, tau: 0.03 }); A.tone(out, t, { f: 120, f2: 60, glide: 0.05, gain: 0.3, tau: 0.03 }); return 0.3; },
  horn: (A, out, t, o) => {
    const ctx = A.ctx;
    const dur = o.dur ?? 0.35;
    const fs = o.truck ? [280, 350] : o.small ? [520] : [400, 500];
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const sh = A.shaper(2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.01);
    g.gain.setValueAtTime(0.25, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    bp.connect(lp).connect(sh).connect(g).connect(out);
    for (const f of fs) { const os = ctx.createOscillator(); os.type = o.small ? 'square' : 'sawtooth'; os.frequency.value = f; os.connect(bp); os.start(t); os.stop(t + dur + 0.1); }
    return dur + 0.2;
  },
  door: (A, out, t) => { A.burst(out, t, { type: 'lowpass', f: 600, gain: 0.5, tau: 0.04 }); A.tone(out, t + 0.06, { f: 160, f2: 90, glide: 0.05, gain: 0.3, tau: 0.04 }); A.burst(out, t + 0.06, { f: 2500, q: 3, gain: 0.15, tau: 0.01 }); return 0.4; },
  pickup: (A, out, t) => { [660, 880, 1320].forEach((f, i) => A.tone(out, t + i * 0.06, { type: 'triangle', f, gain: 0.18, tau: 0.08 })); return 0.5; },
  cash: (A, out, t) => { [1200, 1600, 2400].forEach((f, i) => A.tone(out, t + i * 0.05, { type: 'square', f, gain: 0.06, tau: 0.06 })); A.burst(out, t, { f: 6000, q: 2, gain: 0.08, tau: 0.05 }); return 0.5; },
  collect: (A, out, t) => {
    const notes = [784, 988, 1175, 1568, 1976];
    notes.forEach((f, i) => { A.tone(out, t + i * 0.07, { type: 'sine', f, gain: 0.14, tau: 0.25 }); A.tone(out, t + i * 0.07, { type: 'triangle', f: f * 2, gain: 0.04, tau: 0.15 }); });
    return 1.2;
  },
  reload: (A, out, t) => { A.burst(out, t, { f: 2500, q: 4, gain: 0.25, tau: 0.008 }); A.burst(out, t + 0.18, { f: 1800, q: 4, gain: 0.3, tau: 0.01 }); return 0.4; },
  empty: (A, out, t) => { A.burst(out, t, { f: 3200, q: 6, gain: 0.2, tau: 0.004 }); return 0.1; },
  scream: (A, out, t, o) => {
    const ctx = A.ctx;
    const base = [520, 680, 440, 760][o.s ?? 0];
    const os = ctx.createOscillator(); os.type = 'sawtooth';
    os.frequency.setValueAtTime(base, t); os.frequency.linearRampToValueAtTime(base * 1.35, t + 0.15); os.frequency.linearRampToValueAtTime(base * 0.9, t + 0.6);
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vg = ctx.createGain(); vg.gain.value = 18; vib.connect(vg).connect(os.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2400; f2.Q.value = 6;
    const g = ctx.createGain(); A.env(g.gain, t, 0.12, 0.04, 0.25);
    os.connect(f1).connect(g); os.connect(f2).connect(g); g.connect(out);
    os.start(t); vib.start(t); os.stop(t + 0.9); vib.stop(t + 0.9);
    return 1;
  },
  splash: (A, out, t) => { A.burst(out, t, { buf: A.pink, f: 1100, q: 0.8, gain: 0.5, atk: 0.005, tau: 0.12 }); A.tone(out, t, { f: 500, f2: 1400, glide: 0.06, gain: 0.08, tau: 0.04 }); return 0.7; },
  hurt: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 220, f2: 150, glide: 0.12, gain: 0.25, tau: 0.06 }); A.burst(out, t, { type: 'lowpass', f: 900, gain: 0.25, tau: 0.03 }); return 0.4; },
  ko: (A, out, t) => { [523, 466, 392, 330].forEach((f, i) => A.tone(out, t + i * 0.16, { type: 'triangle', f, gain: 0.16, tau: 0.12 })); return 1; },
  busted: (A, out, t) => { [392, 392, 311].forEach((f, i) => A.tone(out, t + i * 0.22, { type: 'square', f, gain: 0.08, tau: 0.12 })); return 1; },
  checkpoint: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 988, gain: 0.18, tau: 0.08 }); A.tone(out, t + 0.08, { type: 'triangle', f: 1319, gain: 0.18, tau: 0.15 }); return 0.5; },
  countdown: (A, out, t, o) => { A.tone(out, t, { type: 'square', f: o.go ? 880 : 440, gain: 0.08, tau: o.go ? 0.25 : 0.1 }); return 0.6; },
  wanted: (A, out, t) => { A.tone(out, t, { type: 'square', f: 660, gain: 0.06, tau: 0.06 }); A.tone(out, t + 0.12, { type: 'square', f: 880, gain: 0.06, tau: 0.06 }); return 0.4; },
  note: (A, out, t) => { A.tone(out, t, { type: 'sine', f: 880, gain: 0.1, tau: 0.05 }); A.tone(out, t + 0.07, { type: 'sine', f: 1175, gain: 0.08, tau: 0.08 }); return 0.4; },
  chat: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 1400, gain: 0.05, tau: 0.03 }); return 0.2; },
  click: (A, out, t) => { A.tone(out, t, { type: 'square', f: 1800, f2: 1200, glide: 0.02, gain: 0.04, tau: 0.01 }); return 0.1; },
  hover: (A, out, t) => { A.tone(out, t, { type: 'sine', f: 1200, gain: 0.025, tau: 0.01 }); return 0.1; },
  open: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 660, f2: 990, glide: 0.08, gain: 0.08, tau: 0.06 }); return 0.3; },
  close: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 990, f2: 560, glide: 0.08, gain: 0.07, tau: 0.06 }); return 0.3; },
  buy: (A, out, t) => { SFX.cash(A, out, t); A.tone(out, t + 0.12, { type: 'triangle', f: 1568, gain: 0.08, tau: 0.12 }); return 0.6; },
  eat: (A, out, t) => { for (let i = 0; i < 3; i++) A.burst(out, t + i * 0.13, { f: 1400, q: 2, gain: 0.15, tau: 0.03 }); return 0.5; },
  thunder: (A, out, t, o) => {
    const ctx = A.ctx;
    const near = (o.d ?? 1) < 1;
    if (near) A.burst(out, t, { type: 'highpass', f: 1000, gain: 0.8, tau: 0.06 });
    const s = ctx.createBufferSource(); s.buffer = A.brown; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(near ? 300 : 160, t); lp.frequency.exponentialRampToValueAtTime(70, t + 6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    let tt = t;
    for (let i = 0; i < 6; i++) { tt += R(0.1, 0.9); g.gain.setTargetAtTime(R(0.5, 1.4) * (near ? 1 : 0.4), tt, R(0.05, 0.3)); g.gain.setTargetAtTime(0.0001, tt + 0.3, R(0.4, 1.2)); }
    s.connect(lp).connect(g).connect(out);
    s.start(t); s.stop(t + 8);
    return 8;
  },
  sprayClick: (A, out, t) => { A.burst(out, t, { f: 5000, q: 1, gain: 0.2, atk: 0.01, tau: 0.3 }); return 1; },
  launchRing: (A, out, t) => { A.tone(out, t, { type: 'sine', f: 1046, gain: 0.08, tau: 0.2 }); A.tone(out, t + 0.1, { type: 'sine', f: 1568, gain: 0.06, tau: 0.3 }); return 0.8; },
  bird: (A, out, t, o) => {
    const k = o.k ?? 0;
    if (k === 0) {
      const n = Math.floor(R(3, 6));
      for (let i = 0; i < n; i++) {
        const tk = t + i * 0.15;
        const os = A.ctx.createOscillator(), g = A.ctx.createGain();
        os.frequency.setValueAtTime(3200 * R(0.95, 1.05), tk);
        os.frequency.exponentialRampToValueAtTime(5200, tk + 0.04);
        os.frequency.exponentialRampToValueAtTime(2900, tk + 0.06);
        g.gain.setValueAtTime(0, tk); g.gain.linearRampToValueAtTime(0.05, tk + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.06);
        os.connect(g).connect(out); os.start(tk); os.stop(tk + 0.07);
      }
      return 1;
    }
    if (k === 1) {
      const os = A.ctx.createOscillator(), fm = A.ctx.createOscillator(), fg = A.ctx.createGain(), g = A.ctx.createGain();
      os.frequency.value = 4000; fm.frequency.value = 35; fg.gain.value = 400;
      fm.connect(fg).connect(os.frequency);
      A.env(g.gain, t, 0.035, 0.02, 0.2);
      os.connect(g).connect(out); os.start(t); fm.start(t); os.stop(t + 0.7); fm.stop(t + 0.7);
      return 0.8;
    }
    [450, 520, 430].forEach((f, i) => A.tone(out, t + i * 0.38, { f, gain: 0.05, atk: 0.05, tau: 0.12 }));
    return 1.4;
  },
  cricket: (A, out, t) => {
    const f = 4500 * R(0.97, 1.03);
    for (let i = 0; i < 4; i++) A.tone(out, t + i * 0.03, { f, gain: 0.025, atk: 0.002, tau: 0.004, dur: 0.02 });
    return 0.2;
  },
  frog: (A, out, t) => {
    const os = A.ctx.createOscillator(), am = A.ctx.createOscillator(), ag = A.ctx.createGain(), g = A.ctx.createGain();
    os.frequency.value = R(260, 330); am.frequency.value = 25; ag.gain.value = 0.5;
    am.connect(ag).connect(g.gain);
    g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.3);
    os.connect(g).connect(out); os.start(t); am.start(t); os.stop(t + 0.32); am.stop(t + 0.32);
    return 0.4;
  },
  gull: (A, out, t) => { A.tone(out, t, { type: 'triangle', f: 1400, f2: 900, glide: 0.25, gain: 0.05, atk: 0.03, tau: 0.1 }); A.tone(out, t + 0.3, { type: 'triangle', f: 1300, f2: 850, glide: 0.2, gain: 0.04, atk: 0.03, tau: 0.1 }); return 0.8; },
  bark: (A, out, t) => { for (let i = 0; i < 2; i++) { A.burst(out, t + i * 0.22, { buf: A.pink, f: 600, q: 3, gain: 0.25, tau: 0.04 }); A.burst(out, t + i * 0.22, { buf: A.pink, f: 1200, q: 4, gain: 0.15, tau: 0.04 }); } return 0.6; },
  jingle: (A, out, t) => {
    const notes = [659, 784, 880, 784, 659, 587, 523, 587];
    notes.forEach((f, i) => { A.tone(out, t + i * 0.2, { type: 'triangle', f, gain: 0.07, tau: 0.12 }); A.tone(out, t + i * 0.2, { type: 'sine', f: f * 2, gain: 0.03, tau: 0.08 }); });
    return 1.8;
  },
  purr: (A, out, t) => { A.burst(out, t, { buf: A.brown, type: 'lowpass', f: 200, gain: 0.3, atk: 0.1, tau: 0.4 }); return 1; },
};
