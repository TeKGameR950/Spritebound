// Vehicle audio: layered procedural engines for the nearest cars, tyre screech, sirens
// and a shared traffic bed for everything further away.
import { VEHICLES } from '/shared/vehicles.js';

const U = 8;
const HARM = [0, 1, 0.55, 0.75, 0.3, 0.45, 0.18, 0.25, 0.1, 0.12, 0.06, 0.08];
const RATIOS = [3.6, 2.2, 1.5, 1.1, 0.85];
const CYL = { compact: 4, sedan: 4, sports: 6, muscle: 8, van: 4, pickup: 6, taxi: 4, police: 8, scooter: 1, icecream: 4, bus: 6, offroad: 6, ambulance: 6 };

class EngineVoice {
  constructor(A) {
    this.A = A;
    const ctx = A.ctx;
    this.o = ctx.createOscillator();
    const wave = ctx.createPeriodicWave(new Float32Array(HARM), new Float32Array(HARM.length));
    this.o.setPeriodicWave(wave);
    this.sub = ctx.createOscillator();
    this.subG = ctx.createGain(); this.subG.gain.value = 0.35;
    this.res = ctx.createBiquadFilter(); this.res.type = 'peaking'; this.res.frequency.value = 150; this.res.gain.value = 6;
    this.sh = A.shaper(2);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.9;
    this.n = ctx.createBufferSource(); this.n.buffer = A.pink; this.n.loop = true;
    this.nbp = ctx.createBiquadFilter(); this.nbp.type = 'bandpass'; this.nbp.Q.value = 2.5;
    this.ng = ctx.createGain();
    this.mix = ctx.createGain(); this.mix.gain.value = 0;
    this.o.connect(this.res).connect(this.sh);
    this.sub.connect(this.subG).connect(this.sh);
    this.sh.connect(this.lp).connect(this.mix);
    this.n.connect(this.nbp).connect(this.ng).connect(this.mix);
    // tyres
    this.tn = ctx.createBufferSource(); this.tn.buffer = A.white; this.tn.loop = true;
    this.tbp = ctx.createBiquadFilter(); this.tbp.type = 'bandpass'; this.tbp.Q.value = 10;
    this.tg = ctx.createGain(); this.tg.gain.value = 0;
    this.sq = ctx.createOscillator(); this.sq.type = 'triangle';
    this.vib = ctx.createOscillator(); this.vib.frequency.value = 11;
    this.vibG = ctx.createGain(); this.vibG.gain.value = 35;
    this.vib.connect(this.vibG).connect(this.sq.frequency);
    this.sqg = ctx.createGain(); this.sqg.gain.value = 0;
    this.tn.connect(this.tbp).connect(this.tg);
    this.sq.connect(this.sqg);
    this.pan = ctx.createStereoPanner();
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.dist = ctx.createBiquadFilter(); this.dist.type = 'lowpass'; this.dist.frequency.value = 18000;
    this.mix.connect(this.out); this.tg.connect(this.out); this.sqg.connect(this.out);
    this.out.connect(this.dist).connect(this.pan).connect(A.veh);
    for (const n of [this.o, this.sub, this.n, this.tn, this.sq, this.vib]) n.start();
    this.id = -1;
    this.gear = 0;
    this.rpm = 800;
    this.shiftT = 0;
    this.siren = null;
  }

  set(car, dt) {
    const A = this.A, t = A.ctx.currentTime;
    const m = VEHICLES[car.model];
    const cyl = CYL[m.key] || 4;
    const v = Math.abs(car.speed ?? Math.hypot(car.vx, car.vy)) / U;
    const thr = car.throttle ?? (v > 1 ? 0.4 : 0);
    // simple gearbox
    let target;
    if (v < 0.6) target = 800 + thr * 4200;
    else {
      while (this.gear < RATIOS.length - 1 && v * RATIOS[this.gear] * 200 > 6000) { this.gear++; this.shiftT = 0.12; }
      while (this.gear > 0 && v * RATIOS[this.gear] * 200 < 2800) this.gear--;
      target = Math.max(900, v * RATIOS[this.gear] * 200);
    }
    if (m.bike) target *= 1.6;
    if (this.shiftT > 0) { this.shiftT -= dt; target *= 0.82; }
    this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
    const load = Math.min(1, 0.7 * thr + (this.shiftT > 0 ? 0 : 0.2));
    const doppler = car.doppler ?? 1;
    const f = ((this.rpm / 60) * (cyl === 1 ? 1 : cyl / 2)) * (m.engine ?? 1) * 0.9 * doppler;
    this.o.frequency.setTargetAtTime(f, t, 0.03);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.03);
    this.nbp.frequency.setTargetAtTime(Math.min(8000, f * 4), t, 0.05);
    this.ng.gain.setTargetAtTime(0.04 + 0.2 * load, t, 0.05);
    this.lp.frequency.setTargetAtTime(300 + 2500 * load + (1500 * this.rpm) / 7000, t, 0.05);
    this.mix.gain.setTargetAtTime(car.dead ? 0 : 0.28, t, 0.08);
    // tyres
    const lat = (car.slip || 0) / U;
    const s = Math.pow(Math.max(0, Math.min(1, (lat - 2.5) / 8)), 1.5) * (car.offroad ? 0.4 : 1);
    this.tbp.frequency.setTargetAtTime(1800 + 120 * lat, t, 0.05);
    this.tg.gain.setTargetAtTime(0.45 * s, t, s > 0.02 ? 0.03 : 0.12);
    this.sq.frequency.setTargetAtTime(900 + 40 * lat, t, 0.05);
    this.sqg.gain.setTargetAtTime(0.18 * s, t, s > 0.02 ? 0.03 : 0.12);
    // spatial
    const sp = car.local ? { pan: 0, gain: 1, lp: 20000 } : A.spatial(car.x, car.y);
    this.out.gain.setTargetAtTime(sp.gain * (car.local ? 0.85 : 0.75), t, 0.05);
    this.pan.pan.setTargetAtTime(sp.pan, t, 0.05);
    this.dist.frequency.setTargetAtTime(Math.min(18000, sp.lp), t, 0.05);
    // siren
    if (car.siren && !this.siren) this.startSiren();
    if (!car.siren && this.siren) this.stopSiren();
  }

  startSiren() {
    const A = this.A, ctx = A.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.detune.value = 7;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    o.frequency.value = o2.frequency.value = 1250;
    lfo.type = 'triangle'; lfo.frequency.value = 1 / 4.9; depth.gain.value = 450;
    lfo.connect(depth); depth.connect(o.frequency); depth.connect(o2.frequency);
    const mix = ctx.createGain(); mix.gain.value = 0.12;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
    const sh = A.shaper(3);
    o.connect(mix); o2.connect(mix); mix.connect(bp).connect(sh).connect(this.out);
    [o, o2, lfo].forEach((n) => n.start());
    this.siren = { o, o2, lfo, mix };
  }
  stopSiren() {
    const t = this.A.ctx.currentTime;
    for (const n of [this.siren.o, this.siren.o2, this.siren.lfo]) n.stop(t + 0.05);
    this.siren = null;
  }
  silence() {
    const t = this.A.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    if (this.siren) this.stopSiren();
    this.id = -1;
  }
}

export class VehicleAudio {
  constructor(A) {
    this.A = A;
    this.voices = [];
    this.bed = null;
  }
  init() {
    const A = this.A;
    for (let i = 0; i < 6; i++) this.voices.push(new EngineVoice(A));
    const ctx = A.ctx;
    const s = ctx.createBufferSource(); s.buffer = A.brown; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250;
    this.bedG = ctx.createGain(); this.bedG.gain.value = 0;
    s.connect(lp).connect(this.bedG).connect(A.amb);
    s.start();
  }
  // cars: [{id, x, y, vx, vy, speed, throttle, model, slip, siren, local, dead}]
  update(cars, dt) {
    const A = this.A;
    if (!A.ready) return;
    if (!this.voices.length) this.init();
    const L = A.listener;
    for (const c of cars) {
      c.d2 = c.local ? -1 : (c.x - L.x) ** 2 + (c.y - L.y) ** 2;
      if (!c.local) {
        // doppler from radial velocity (exaggerated speed of sound for fun)
        const dx = c.x - L.x, dy = c.y - L.y, d = Math.hypot(dx, dy) || 1;
        const vr = (c.vx * dx + c.vy * dy) / d / U;
        c.doppler = 250 / (250 + vr);
      }
    }
    cars.sort((a, b) => a.d2 - b.d2);
    const chosen = cars.slice(0, this.voices.length).filter((c) => c.local || c.d2 < 520 * 520);
    const ids = new Set(chosen.map((c) => c.id));
    for (const v of this.voices) if (v.id >= 0 && !ids.has(v.id)) v.silence();
    for (const c of chosen) {
      let v = this.voices.find((q) => q.id === c.id);
      if (!v) { v = this.voices.find((q) => q.id < 0); if (!v) continue; v.id = c.id; v.gear = 0; }
      v.set(c, dt);
    }
    let moving = 0;
    for (const c of cars) if (!c.local && c.d2 < 900 * 900 && Math.abs(c.speed ?? 1) > 20) moving++;
    this.bedG.gain.setTargetAtTime(Math.min(0.5, moving * 0.035), A.ctx.currentTime, 0.5);
  }
}
