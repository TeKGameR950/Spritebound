// Ambient soundscape driven by time of day, weather and surroundings.
export class Ambience {
  constructor(A) {
    this.A = A;
    this.started = false;
    this.timers = { bird: 2, cricket: 1, gull: 6, frog: 3, bark: 20, drop: 0 };
  }
  init() {
    const A = this.A, ctx = A.ctx;
    const loop = (buf, filters, gain) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      let node = s;
      for (const f of filters) { node.connect(f); node = f; }
      const g = ctx.createGain(); g.gain.value = gain;
      node.connect(g).connect(A.amb);
      s.start(0, Math.random() * 1.5);
      return g;
    };
    const bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.windBp = bq('bandpass', 400, 0.8);
    this.wind = loop(A.pink, [this.windBp], 0);
    this.rain = loop(A.pink, [bq('highpass', 400), bq('lowpass', 7000)], 0);
    this.rainLp = null;
    this.gutter = loop(A.pink, [bq('bandpass', 300, 2)], 0);
    this.waveLp = bq('lowpass', 600);
    this.waves = loop(A.brown, [this.waveLp], 0);
    this.water = loop(A.white, [bq('bandpass', 2400, 0.6), bq('lowpass', 5000)], 0);
    this.started = true;
    this.t = 0;
  }

  // ctx: { hour, rain, cloud, nearWater (0..1), coast (0..1), park (0..1), suburb, fountain (0..1), inCar, x, y }
  update(c, dt) {
    const A = this.A;
    if (!A.ready) return;
    if (!this.started) this.init();
    const t = A.ctx.currentTime;
    this.t += dt;
    const day = c.hour > 5.5 && c.hour < 19.5;
    const dawn = c.hour > 5.3 && c.hour < 8;
    const inCar = c.inCar ? 0.45 : 1;
    // wind gusts
    const gust = 0.5 + 0.5 * Math.sin(this.t * 0.17) * Math.sin(this.t * 0.07 + 1);
    this.wind.gain.setTargetAtTime((0.04 + 0.08 * gust + 0.12 * c.coast + 0.15 * c.rain) * inCar, t, 0.8);
    this.windBp.frequency.setTargetAtTime(300 + gust * 300, t, 0.8);
    this.rain.gain.setTargetAtTime(0.32 * c.rain * (c.inCar ? 0.7 : 1), t, 1);
    this.gutter.gain.setTargetAtTime(0.07 * c.rain * inCar, t, 1);
    const surf = 0.5 + 0.5 * Math.sin(this.t * 0.6);
    this.waves.gain.setTargetAtTime(c.coast * (0.12 + 0.18 * surf) * inCar, t, 0.4);
    this.waveLp.frequency.setTargetAtTime(400 + surf * 500, t, 0.4);
    this.water.gain.setTargetAtTime(0.05 * c.fountain * inCar, t, 0.5);

    // events
    const T = this.timers;
    const near = (r = 160) => [c.x + (Math.random() - 0.5) * r * 2, c.y + (Math.random() - 0.5) * r * 2];
    if (day && c.rain < 0.3) {
      T.bird -= dt * (dawn ? 3 : 1) * (0.3 + c.park * 1.2 + c.suburb * 0.6);
      if (T.bird <= 0) { T.bird = 2 + Math.random() * 4; const [x, y] = near(); A.play('bird', x, y, { bus: 'amb', k: Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2, gain: inCar }); }
    }
    if (!day && c.rain < 0.3) {
      T.cricket -= dt * (0.4 + c.park + c.suburb);
      if (T.cricket <= 0) { T.cricket = 0.4 + Math.random() * 0.6; const [x, y] = near(120); A.play('cricket', x, y, { bus: 'amb', gain: inCar }); }
      if (c.nearWater > 0.3) { T.frog -= dt; if (T.frog <= 0) { T.frog = 1.5 + Math.random() * 3; const [x, y] = near(); A.play('frog', x, y, { bus: 'amb', gain: inCar }); } }
      if (c.suburb > 0.4) { T.bark -= dt; if (T.bark <= 0) { T.bark = 15 + Math.random() * 30; const [x, y] = near(400); A.play('bark', x, y, { bus: 'amb', gain: 0.5 * inCar }); } }
    }
    if (c.coast > 0.3 && day) { T.gull -= dt; if (T.gull <= 0) { T.gull = 5 + Math.random() * 8; const [x, y] = near(220); A.play('gull', x, y, { bus: 'amb', gain: inCar }); } }
  }
}
