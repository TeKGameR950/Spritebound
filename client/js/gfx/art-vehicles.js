import { Vox, rgb, shade, mix, EM } from './voxel.js';
import { VEHICLES } from '/shared/vehicles.js';
import { hash2 } from '/shared/rng.js';

const C = (h) => rgb(h);
const TIRE = C('#1c1c20'), RIM = C('#9aa0a8'), GLASS = C('#34495e'), GLASS2 = C('#4b6a86');
const CHROME = C('#c9cdd2'), DARK = C('#2a2b30'), INTERIOR = C('#3a3236');
const HEAD = C('#fff6d8'), TAIL = C('#d83a32'), WHITE = C('#f2f0ea');

// Generic car body builder. Model axes: x forward (front at x = L-1), y right, z up.
function car(L, W, opt) {
  const m = new Vox(L, W, opt.h + 3);
  const paint = opt.paint;
  const hood = opt.hood ?? paint;
  const z0 = 2, zb = opt.body;          // body from z0 to zb
  const cab0 = Math.round(L * opt.cab[0]), cab1 = Math.round(L * opt.cab[1]);
  const roofZ = opt.h;
  // wheels
  const wx = opt.wheels ?? [Math.round(L * 0.2), Math.round(L * 0.78)];
  for (const x of wx) for (const y of [0, W - 2]) {
    m.box(x - 3, y, 0, x + 3, y + 2, 5, (xx, yy, z) => (z === 2 && (xx === x - 1 || xx === x) ? RIM : TIRE));
  }
  // lower body with rounded corners
  m.rbox(0, 1, z0, L, W - 1, zb, 3, (x, y, z) => {
    if (z === zb - 1 && (x < cab0 || x >= cab1)) {
      if (opt.stripe && Math.abs(y + 0.5 - W / 2) < 2) return opt.stripe;
      return x >= cab1 ? hood : paint;
    }
    if (z === z0) return shade(paint, 0.7);
    if (opt.doorLines && z > z0 && (x === Math.round(L * 0.5) || x === cab0 + 1) && (y === 1 || y === W - 2)) return shade(paint, 0.8);
    return paint;
  });
  // bumpers
  m.box(L - 1, 2, z0, L, W - 2, z0 + 2, DARK);
  m.box(0, 2, z0, 1, W - 2, z0 + 2, DARK);
  // lights
  m.box(L - 1, 2, zb - 2, L, 5, zb - 1, HEAD, EM.HEAD);
  m.box(L - 1, W - 5, zb - 2, L, W - 2, zb - 1, HEAD, EM.HEAD);
  m.box(0, 2, zb - 2, 1, 5, zb - 1, TAIL, EM.TAIL);
  m.box(0, W - 5, zb - 2, 1, W - 2, zb - 1, TAIL, EM.TAIL);
  // cabin
  if (opt.cabin !== false) {
    const inset = opt.cabInset ?? 2;
    for (let z = zb; z < roofZ; z++) {
      const t = (z - zb) / Math.max(1, roofZ - zb);
      const shrinkF = Math.round(t * (opt.slopeF ?? 2)), shrinkB = Math.round(t * (opt.slopeB ?? 1));
      for (let x = cab0 + shrinkB; x < cab1 - shrinkF; x++) for (let y = 1 + inset; y < W - 1 - inset; y++) {
        const edgeX = x === cab0 + shrinkB || x === cab1 - shrinkF - 1;
        const edgeY = y === 1 + inset || y === W - 2 - inset;
        const pillar = (x === cab0 + shrinkB || x === cab1 - shrinkF - 1 || x === Math.round((cab0 + cab1) / 2)) && edgeY;
        if (edgeX || edgeY) m.set(x, y, z, pillar ? paint : (edgeX && x > (cab0 + cab1) / 2 ? GLASS2 : GLASS));
        else m.set(x, y, z, INTERIOR);
      }
    }
    // roof
    const sf = opt.slopeF ?? 2, sb = opt.slopeB ?? 1;
    m.box(cab0 + sb, 1 + inset, roofZ, cab1 - sf, W - 1 - inset, roofZ + 1, (x, y) => {
      if (opt.roofStripe && Math.abs(y + 0.5 - W / 2) < 2) return opt.roofStripe;
      return opt.roof ?? shade(paint, 1.06);
    });
  }
  // mirrors
  m.set(cab1 - 2, 0, zb, paint); m.set(cab1 - 2, W - 1, zb, paint);
  return m;
}

function sirenBar(m, x0, x1, W, z, colors = [EM.SIREN_R, EM.SIREN_B]) {
  const mid = Math.floor(W / 2);
  m.box(x0, 3, z, x1, W - 3, z + 1, DARK);
  m.box(x0, 3, z + 1, x1, mid, z + 2, C('#ff3a30'), colors[0]);
  m.box(x0, mid, z + 1, x1, W - 3, z + 2, C('#3a6aff'), colors[1]);
}

const BUILD = {
  compact: (p) => car(34, 18, { paint: p, h: 10, body: 6, cab: [0.22, 0.72], slopeF: 2, slopeB: 1, doorLines: true }),
  sedan: (p) => car(40, 20, { paint: p, h: 11, body: 6, cab: [0.28, 0.68], slopeF: 2, slopeB: 2, doorLines: true }),
  sports: (p, v) => {
    const m = car(40, 20, { paint: p, h: 9, body: 5, cab: [0.34, 0.66], slopeF: 3, slopeB: 2, stripe: v % 2 ? C('#f2f0ea') : 0, roofStripe: v % 2 ? C('#f2f0ea') : 0 });
    m.box(0, 2, 6, 3, 18, 8, shade(p, 0.85));
    m.box(1, 3, 5, 2, 4, 6, DARK); m.box(1, 16, 5, 2, 17, 6, DARK);
    return m;
  },
  muscle: (p) => {
    const m = car(42, 21, { paint: p, h: 10, body: 6, cab: [0.24, 0.6], slopeF: 2, slopeB: 1, stripe: C('#1d1d22'), roofStripe: C('#1d1d22') });
    m.box(30, 8, 6, 36, 13, 7, DARK);
    return m;
  },
  van: (p) => {
    const m = car(46, 22, { paint: p, h: 15, body: 7, cab: [0.08, 0.86], slopeF: 2, slopeB: 0, cabInset: 1 });
    for (let x = 6; x < 36; x++) for (const y of [2, 19]) for (let z = 8; z < 14; z++) m.set(x, y, z, x > 28 ? GLASS : p);
    m.box(4, 3, 15, 38, 19, 16, shade(p, 1.08));
    return m;
  },
  pickup: (p) => {
    const m = car(46, 22, { paint: p, h: 12, body: 7, cab: [0.42, 0.7], slopeF: 2, slopeB: 0 });
    m.box(1, 2, 7, 18, 20, 9, (x, y) => (x === 1 || y === 2 || y === 19 ? p : C('#4a4440')));
    m.box(2, 3, 6, 18, 19, 7, C('#3a3430'));
    return m;
  },
  taxi: (p) => {
    const m = car(40, 20, { paint: C('#f2c43a'), h: 11, body: 6, cab: [0.28, 0.68], slopeF: 2, slopeB: 2, doorLines: true });
    for (let x = 4; x < 36; x++) m.set(x, 1, 4, (x >> 1) % 2 ? DARK : WHITE), m.set(x, 18, 4, (x >> 1) % 2 ? DARK : WHITE);
    m.box(17, 7, 12, 23, 13, 14, C('#fff2c8'), EM.NIGHT);
    return m;
  },
  police: () => {
    const m = car(42, 20, { paint: C('#1f2733'), hood: C('#1f2733'), h: 11, body: 6, cab: [0.3, 0.7], slopeF: 2, slopeB: 2, roof: C('#f2f0ea') });
    for (let x = 13; x < 31; x++) for (const y of [1, 18]) for (let z = 3; z < 6; z++) m.set(x, y, z, WHITE);
    for (let x = 13; x < 31; x++) for (let y = 1; y < 19; y++) if (m.get(x, y, 5)) m.set(x, y, 5, WHITE);
    sirenBar(m, 19, 23, 20, 12);
    return m;
  },
  scooter: (p) => {
    const m = new Vox(24, 10, 12);
    m.box(1, 4, 0, 6, 6, 4, TIRE); m.box(18, 4, 0, 23, 6, 4, TIRE);
    m.rbox(3, 2, 3, 21, 8, 7, 2, p);
    m.box(4, 3, 7, 13, 7, 9, C('#3a2a24'));
    m.box(18, 3, 5, 21, 7, 10, p);
    m.box(19, 0, 10, 20, 10, 11, DARK);
    m.box(22, 4, 7, 23, 6, 8, HEAD, EM.HEAD);
    m.box(1, 4, 6, 2, 6, 7, TAIL, EM.TAIL);
    return m;
  },
  icecream: () => {
    const p = C('#f6f1ea');
    const m = car(48, 22, { paint: p, h: 16, body: 8, cab: [0.06, 0.82], slopeF: 2, slopeB: 0, cabInset: 1, roof: C('#f8c8d8') });
    for (let x = 4; x < 38; x++) for (let z = 4; z < 7; z++) { m.set(x, 1, z, C('#e88ab0')); m.set(x, 20, z, C('#e88ab0')); }
    m.box(18, 8, 17, 24, 14, 19, C('#e3b06a'));
    m.ell(21, 11, 20, 3.5, 3.5, 2.5, C('#ffb3cf'));
    m.set(21, 11, 22, C('#d83a4a'));
    return m;
  },
  bus: (p) => {
    const body = C('#f2c14e');
    const m = car(82, 25, { paint: body, h: 21, body: 8, cab: [0.02, 0.97], slopeF: 1, slopeB: 0, cabInset: 1, roof: C('#f8f4ea') });
    for (let x = 4; x < 78; x++) for (const y of [2, 22]) for (let z = 9; z < 19; z++) {
      if (z >= 12 && z <= 17 && x % 9 !== 0) m.set(x, y, z, GLASS);
      else m.set(x, y, z, z < 12 ? C('#3a7ad1') : body);
    }
    m.box(20, 7, 22, 30, 18, 24, C('#b8bcc2'));
    m.box(50, 7, 22, 60, 18, 24, C('#b8bcc2'));
    void p;
    return m;
  },
  offroad: (p) => {
    const m = car(40, 22, { paint: p, h: 14, body: 7, cab: [0.18, 0.72], slopeF: 1, slopeB: 0, cabInset: 1 });
    m.box(0, 7, 4, 2, 15, 11, TIRE);
    m.box(10, 3, 15, 28, 19, 16, (x, y) => ((x + y) % 3 === 0 ? DARK : 0));
    return m;
  },
  ambulance: () => {
    const p = C('#f4f4f0');
    const m = car(50, 22, { paint: p, h: 16, body: 8, cab: [0.06, 0.86], slopeF: 2, slopeB: 0, cabInset: 1, roof: C('#f8f8f4') });
    for (let x = 3; x < 44; x++) for (let z = 4; z < 7; z++) { m.set(x, 1, z, C('#d83a3a')); m.set(x, 20, z, C('#d83a3a')); }
    m.box(14, 8, 17, 26, 14, 18, C('#d83a3a'));
    m.box(18, 5, 17, 22, 17, 18, C('#d83a3a'));
    sirenBar(m, 38, 42, 22, 16);
    return m;
  },
};

export function buildVehicle(model, paintHex, variant = 0) {
  const def = VEHICLES[model];
  const fn = BUILD[def.key] || BUILD.sedan;
  const paint = C(paintHex);
  const m = fn(paint, variant);
  return m;
}

// Burnt wreck: darken everything, kill emissive.
export function burnt(m) {
  const out = new Vox(m.w, m.d, m.h);
  for (let i = 0; i < m.c.length; i++) {
    if (!m.c[i]) continue;
    const g = hash2(i, 7, 3) < 0.15 ? C('#5a3a2a') : C('#26262a');
    out.c[i] = mix(m.c[i], g, 0.85);
  }
  return out;
}
