import { Img } from '../gfx/img.js';
import { PART_FLOATS } from '../gfx/renderer.js';

const MAX = 6000;

function makeSprites(bank) {
  const mk = (key, w, h, fn) => {
    const img = new Img(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = fn(x + 0.5, y + 0.5, w, h);
      if (r) img.set(x, y, [r[0], r[1], r[2]], r[3]);
    }
    return bank.fromImg('pt:' + key, img).slices[0].r;
  };
  const S = {};
  S.soft = mk('soft', 32, 32, (x, y, w) => { const d = Math.hypot(x - w / 2, y - w / 2) / (w / 2); return d < 1 ? [255, 255, 255, Math.round((1 - d) ** 1.6 * 255)] : null; });
  S.puff = mk('puff', 32, 32, (x, y, w) => {
    let a = 0;
    for (const [cx, cy, r] of [[16, 16, 11], [10, 13, 7], [22, 12, 7], [12, 21, 7], [21, 21, 7]]) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1) a = Math.max(a, 1 - d * d);
    }
    return a > 0 ? [255, 255, 255, Math.round(a * 230)] : null;
  });
  S.px = mk('px', 4, 4, () => [255, 255, 255, 255]);
  S.ring = mk('ring', 32, 32, (x, y, w) => { const d = Math.hypot(x - w / 2, y - w / 2); return d < 15 && d > 12 ? [255, 255, 255, 255] : d <= 12 && d > 10 ? [255, 255, 255, 90] : null; });
  S.star = mk('star', 16, 16, (x, y) => {
    const a = Math.atan2(y - 8, x - 8), d = Math.hypot(x - 8, y - 8);
    const r = 3 + 4 * Math.abs(Math.cos(a * 2.5));
    return d < r ? [255, 240, 120, 255] : null;
  });
  S.flame = mk('flame', 16, 24, (x, y) => {
    const t = y / 24;
    const half = 7 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.6 + 0.4 * t);
    if (Math.abs(x - 8) > half) return null;
    const core = 1 - Math.abs(x - 8) / Math.max(half, 0.1);
    return [255, Math.round(140 + 115 * core * t), Math.round(40 + 160 * core * core * t), Math.round(255 * Math.min(1, t * 2))];
  });
  S.drop = mk('drop', 4, 16, (x, y) => [210, 225, 255, Math.round((y / 16) * 200)]);
  S.petal = mk('petal', 8, 8, (x, y) => { const d = Math.hypot((x - 4) * 1.4, y - 4); return d < 3.2 ? [255, 190, 215, 255] : null; });
  S.leaf = mk('leaf', 8, 8, (x, y) => { const d = Math.hypot((x - 4) * 1.5, y - 4); return d < 3.2 ? [120, 180, 70, 255] : null; });
  S.coin = mk('coin', 8, 8, (x, y) => { const d = Math.hypot(x - 4, y - 4); return d < 3.5 ? (d < 2 ? [255, 236, 140, 255] : [230, 180, 50, 255]) : null; });
  S.beam = mk('beam', 32, 4, (x, y) => [255, 255, 255, Math.round((1 - Math.abs(y - 2) / 2) * 255 * (x / 32))]);
  S.note = mk('note', 12, 12, (x, y) => ((x >= 7 && x <= 8 && y <= 9) || (Math.hypot(x - 5.5, y - 9) < 2.2) || (y <= 2 && x >= 7 && x <= 11) ? [255, 255, 255, 255] : null));
  S.heart = mk('heart', 12, 12, (x, y) => {
    const X = (x - 6) / 5, Y = (6 - y) / 5 + 0.25;
    return (X * X + Y * Y - 1) ** 3 - X * X * Y * Y * Y < 0 ? [255, 120, 160, 255] : null;
  });
  S.bubble = mk('bubble', 16, 16, (x, y) => { const d = Math.hypot(x - 8, y - 8); return d < 7 && d > 5.5 ? [220, 240, 255, 220] : d <= 5.5 ? [220, 240, 255, 50] : null; });
  return S;
}

// CPU particle system. Particles are horizontal quads at their z, drawn in a forward pass.
export class Particles {
  constructor(bank) {
    this.S = makeSprites(bank);
    this.list = [];
    this.data = new Float32Array(MAX * PART_FLOATS);
    this.out = { data: this.data, nAlpha: 0, nAdd: 0 };
  }

  spawn(o) {
    if (this.list.length >= MAX) this.list.shift();
    const p = {
      x: o.x, y: o.y, z: o.z ?? 1, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life ?? 1, s0: o.s0 ?? 6, s1: o.s1 ?? o.s0 ?? 6, r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1,
      a0: o.a0 ?? 1, a1: o.a1 ?? 0, rot: o.rot ?? Math.random() * 6.28, vr: o.vr ?? 0, tex: o.tex || this.S.soft,
      add: !!o.add, emis: o.emis ?? (o.add ? 1.5 : 0), grav: o.grav ?? 0, drag: o.drag ?? 0, stretch: o.stretch ?? 1,
      floor: o.floor ?? true, bounce: o.bounce ?? 0, r1: o.r1, g1: o.g1, b1: o.b1, spin: o.spin ?? false,
    };
    this.list.push(p);
    return p;
  }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = p.drag ? Math.exp(-p.drag * dt) : 1;
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vz -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor && p.z < 0.2) {
        p.z = 0.2;
        if (p.bounce) { p.vz = -p.vz * p.bounce; p.vx *= 0.6; p.vy *= 0.6; } else p.vz = 0;
      }
      p.rot += p.vr * dt;
      L[w++] = p;
    }
    L.length = w;
  }

  // Pack into the renderer's instance format: alpha-blended first, then additive.
  build(view) {
    const d = this.data;
    let n = 0;
    const [x0, y0, x1, y1] = view;
    const put = (p) => {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return;
      const t = p.life / p.max;
      const o = n * PART_FLOATS;
      const size = p.s0 + (p.s1 - p.s0) * t;
      d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z; d[o + 3] = size;
      d[o + 4] = p.r1 !== undefined ? p.r + (p.r1 - p.r) * t : p.r;
      d[o + 5] = p.g1 !== undefined ? p.g + (p.g1 - p.g) * t : p.g;
      d[o + 6] = p.b1 !== undefined ? p.b + (p.b1 - p.b) * t : p.b;
      d[o + 7] = p.a0 + (p.a1 - p.a0) * t;
      const r = p.tex;
      d[o + 8] = r.u0; d[o + 9] = r.v0; d[o + 10] = r.u1; d[o + 11] = r.v1;
      d[o + 12] = p.stretch > 1 ? Math.atan2(p.vy, p.vx) : p.rot;
      d[o + 13] = r.layer;
      d[o + 14] = p.add ? p.emis : 0;
      d[o + 15] = p.stretch;
      n++;
    };
    for (const p of this.list) if (!p.add) put(p);
    const nA = n;
    for (const p of this.list) if (p.add) put(p);
    this.out.nAlpha = nA;
    this.out.nAdd = n - nA;
    return this.out;
  }

  // ---------------------------------------------------------------- presets
  smoke(x, y, z, o = {}) {
    const g = o.grey ?? 0.75;
    return this.spawn({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4, z, vx: (o.vx || 0) + (Math.random() - 0.5) * 10, vy: (o.vy || 0) + (Math.random() - 0.5) * 10, vz: o.vz ?? 14, life: o.life ?? 1.6, s0: o.s0 ?? 6, s1: o.s1 ?? 22, r: g, g: g, b: g, a0: o.a ?? 0.55, a1: 0, tex: this.S.puff, vr: (Math.random() - 0.5) * 1.5, drag: 0.8, floor: false });
  }
  spark(x, y, z, ang, o = {}) {
    const sp = (o.speed ?? 160) * (0.5 + Math.random());
    const a = ang + (Math.random() - 0.5) * (o.spread ?? 1.6);
    return this.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 40 + Math.random() * 60, grav: 260, life: 0.25 + Math.random() * 0.25, s0: 2.2, s1: 1, r: 1, g: 0.85, b: 0.45, a0: 1, a1: 0.3, add: true, emis: 2.5, stretch: 3, tex: this.S.soft, bounce: 0.3 });
  }
  muzzle(x, y, z, ang, big = 1) {
    this.spawn({ x: x + Math.cos(ang) * 4, y: y + Math.sin(ang) * 4, z, life: 0.06, s0: 9 * big, s1: 5 * big, r: 1, g: 0.85, b: 0.5, a0: 1, a1: 0.6, add: true, emis: 4, rot: ang, tex: this.S.star });
    this.spawn({ x, y, z, vx: Math.cos(ang) * 30, vy: Math.sin(ang) * 30, life: 0.5, s0: 3, s1: 10 * big, r: 0.8, g: 0.8, b: 0.8, a0: 0.35, a1: 0, tex: this.S.puff, floor: false, drag: 2 });
  }
  tracer(x0, y0, x1, y1, z = 10, color = [1, 0.9, 0.6]) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const speed = 2400;
    const p = this.spawn({ x: x0, y: y0, z, vx: (dx / len) * speed, vy: (dy / len) * speed, life: Math.min(0.25, len / speed), s0: 3, s1: 3, r: color[0], g: color[1], b: color[2], a0: 1, a1: 1, add: true, emis: 3, stretch: 7, tex: this.S.soft, floor: false });
    return p;
  }
  casing(x, y, z, ang) {
    const a = ang + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    return this.spawn({ x, y, z, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, vz: 60, grav: 300, life: 3, s0: 1.6, s1: 1.6, r: 0.95, g: 0.75, b: 0.3, a0: 1, a1: 1, tex: this.S.px, bounce: 0.35, vr: 20 });
  }
  hitPuff(x, y, z, color = [0.9, 0.85, 0.7]) {
    for (let i = 0; i < 5; i++) this.spawn({ x, y, z, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70, vz: 30 + Math.random() * 30, grav: 120, life: 0.4, s0: 2.5, s1: 1, r: color[0], g: color[1], b: color[2], a0: 1, a1: 0, tex: this.S.px });
  }
  explosion(x, y, r = 70) {
    const k = r / 70;
    this.spawn({ x, y, z: 4, life: 0.35, s0: 20 * k, s1: 150 * k, r: 1, g: 0.9, b: 0.7, a0: 0.9, a1: 0, add: true, emis: 3, tex: this.S.ring, floor: false });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, s = 40 + Math.random() * 140 * k;
      this.spawn({ x, y, z: 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 30 + Math.random() * 60, life: 0.4 + Math.random() * 0.5, s0: 14 * k, s1: 30 * k, r: 1, g: 0.6 + Math.random() * 0.3, b: 0.2, r1: 0.6, g1: 0.2, b1: 0.05, a0: 1, a1: 0, add: true, emis: 3, tex: this.S.puff, drag: 3, floor: false });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, s = 20 + Math.random() * 80 * k;
      this.smoke(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 8, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 20 + Math.random() * 30, life: 2.5 + Math.random() * 2, s0: 16 * k, s1: 60 * k, grey: 0.25 + Math.random() * 0.2, a: 0.75 });
    }
    for (let i = 0; i < 24; i++) this.spark(x, y, 6, Math.random() * 6.28, { speed: 260 * k, spread: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, s = 60 + Math.random() * 160;
      this.spawn({ x, y, z: 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 80 + Math.random() * 120, grav: 380, life: 1.6, s0: 2.5, s1: 2.5, r: 0.15, g: 0.13, b: 0.12, a0: 1, a1: 1, tex: this.S.px, bounce: 0.25, vr: 10 });
    }
  }
  fire(x, y, z, size = 1) {
    this.spawn({ x: x + (Math.random() - 0.5) * 6 * size, y: y + (Math.random() - 0.5) * 6 * size, z, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, vz: 26 + Math.random() * 20, life: 0.5 + Math.random() * 0.3, s0: 7 * size, s1: 2 * size, r: 1, g: 0.75, b: 0.3, r1: 1, g1: 0.3, b1: 0.05, a0: 1, a1: 0, add: true, emis: 2.6, tex: this.S.flame, floor: false, rot: -Math.PI / 2 });
  }
  splash(x, y, big = 1) {
    this.spawn({ x, y, z: 0.4, life: 0.5, s0: 4 * big, s1: 22 * big, r: 0.85, g: 0.95, b: 1, a0: 0.8, a1: 0, tex: this.S.ring, floor: false });
    for (let i = 0; i < 8 * big; i++) {
      const a = Math.random() * 6.28, s = 20 + Math.random() * 50;
      this.spawn({ x, y, z: 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 60 + Math.random() * 60, grav: 300, life: 0.6, s0: 2, s1: 1.4, r: 0.8, g: 0.9, b: 1, a0: 0.9, a1: 0, tex: this.S.soft });
    }
  }
  dust(x, y, color = [0.75, 0.68, 0.55]) {
    this.spawn({ x, y, z: 1, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, vz: 6, life: 0.6, s0: 3, s1: 9, r: color[0], g: color[1], b: color[2], a0: 0.4, a1: 0, tex: this.S.puff, floor: false });
  }
  coins(x, y) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28;
      this.spawn({ x, y, z: 8, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, vz: 90 + Math.random() * 40, grav: 300, life: 0.9, s0: 4, s1: 3, r: 1, g: 1, b: 1, a0: 1, a1: 0, tex: this.S.coin, bounce: 0.4, add: true, emis: 1.2 });
    }
  }
  sparkle(x, y, z, color = [0.6, 1, 1]) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, s = 20 + Math.random() * 60;
      this.spawn({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40 + Math.random() * 60, grav: 60, drag: 1.5, life: 1 + Math.random() * 0.6, s0: 4, s1: 0.5, r: color[0], g: color[1], b: color[2], a0: 1, a1: 0, add: true, emis: 3, tex: this.S.star, vr: 6 });
    }
  }
  rain(cx, cy, w, h, intensity, dt, night, wind = 0.3) {
    this.rainAcc = (this.rainAcc || 0) + intensity * 2600 * dt;
    const n = Math.min(400, Math.floor(this.rainAcc));
    this.rainAcc -= n;
    // at night drops would vanish in the dark ambient, so they glow faintly as if catching lamplight
    const emis = night > 0.3 ? 0.55 : 0;
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * w, y = cy + (Math.random() - 0.5) * h;
      this.spawn({ x: x - wind * 60, y: y - 40, z: 60, vx: wind * 160, vy: 260, vz: -700, life: 0.09, s0: 1.2, s1: 1.2, r: 0.75, g: 0.82, b: 0.95, a0: 0.5, a1: 0.5, stretch: 9, tex: this.S.soft, floor: false, emis });
      if (Math.random() < 0.3) this.spawn({ x, y, z: 0.3, life: 0.22, s0: 1, s1: 6, r: 0.8, g: 0.88, b: 1, a0: 0.5, a1: 0, tex: this.S.ring, floor: false, emis });
    }
  }
}
