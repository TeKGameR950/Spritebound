import { Img, hex, mixc, mulc, pnoise, pfbm, ramp, bayer } from './img.js';
import { hash2, RNG } from '/shared/rng.js';
import { T, TERRAIN_COUNT } from '/shared/constants.js';

export const TERRAIN_TEX = 128;
const S = TERRAIN_TEX;

function noiseRamp(img, colors, seed, scale = 16, oct = 3, fine = 0.18, dither = 0.7) {
  const P = S / scale;
  img.each((x, y) => {
    const n = pfbm(x / scale, y / scale, P, seed, oct);
    const f = (hash2(x, y, seed + 99) - 0.5) * fine;
    return ramp(colors, n + f, x, y, dither);
  });
}

function grass(seed, colors, opts = {}) {
  const img = new Img(S, S);
  noiseRamp(img, colors, seed, 24, 3, 0.22);
  const r = new RNG(seed);
  // tufts
  for (let k = 0; k < (opts.tufts ?? 260); k++) {
    const x = r.int(0, S - 1), y = r.int(0, S - 1);
    const light = r.chance(0.55);
    const c = hex(light ? colors[colors.length - 1] : colors[0]);
    img.setw(x, y, c);
    img.setw(x - 1, y + 1, c);
    img.setw(x + 1, y + 1, c);
    if (light) img.setw(x, y + 1, mulc(c, 0.85));
  }
  for (let k = 0; k < (opts.flowers ?? 0); k++) {
    const x = r.int(0, S - 1), y = r.int(0, S - 1);
    const c = hex(r.pick(['#fff6e0', '#ffe066', '#ffb3d1', '#b9d7ff']));
    img.setw(x, y, c);
    img.setw(x, y + 1, hex(colors[0]));
  }
  return img;
}

function slabs(base, joint, size, seed, opts = {}) {
  const img = new Img(S, S);
  const b = hex(base), j = hex(joint);
  img.each((x, y) => {
    const sx = Math.floor(x / size), sy = Math.floor(y / size);
    const v = hash2(sx, sy, seed) * 0.08 - 0.04;
    const n = (pnoise(x / 4, y / 4, S / 4, seed + 3) - 0.5) * 0.06 + (hash2(x, y, seed + 7) - 0.5) * 0.05;
    let c = mulc(b, 1 + v + n);
    const lx = x % size, ly = y % size;
    if (lx === 0 || ly === 0) c = j;
    else if (lx === 1 || ly === 1) c = mulc(c, 1.05);
    else if (lx === size - 1 || ly === size - 1) c = mulc(c, 0.95);
    return c;
  });
  const r = new RNG(seed);
  for (let k = 0; k < (opts.cracks ?? 6); k++) {
    let x = r.int(0, S - 1), y = r.int(0, S - 1);
    for (let s = 0; s < r.int(4, 10); s++) {
      img.mul(x, y, 0.78);
      x += r.int(-1, 1); y += r.chance(0.5) ? 1 : 0;
    }
  }
  for (let k = 0; k < (opts.spots ?? 12); k++) img.mul(r.int(0, S - 1), r.int(0, S - 1), 0.82);
  return img;
}

function asphalt(seed, colors, opts = {}) {
  const img = new Img(S, S);
  noiseRamp(img, colors, seed, 32, 2, 0.5, 0.9);
  const r = new RNG(seed);
  // aggregate speckle
  for (let k = 0; k < 900; k++) {
    const x = r.int(0, S - 1), y = r.int(0, S - 1);
    img.mul(x, y, r.chance(0.5) ? 1.12 : 0.88);
  }
  // cracks
  for (let k = 0; k < (opts.cracks ?? 3); k++) {
    let x = r.int(0, S - 1), y = r.int(0, S - 1);
    const dx = r.chance(0.5) ? 1 : 0;
    for (let s = 0; s < r.int(8, 22); s++) {
      img.mul(x, y, 0.7);
      if (dx) { x++; y += r.int(-1, 1); } else { y++; x += r.int(-1, 1); }
    }
  }
  // soft patches (repairs / oil)
  for (let k = 0; k < (opts.patches ?? 2); k++) {
    const cx = r.int(0, S - 1), cy = r.int(0, S - 1), rad = r.range(5, 11);
    const f = r.chance(0.5) ? 0.9 : 1.06;
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
      const d = Math.hypot(x, y) / rad;
      if (d < 1 && bayer(cx + x, cy + y) < 1 - d * 0.7) img.mul(cx + x, cy + y, f);
    }
  }
  return img;
}

function cobble(seed) {
  const img = new Img(S, S);
  const r = new RNG(seed);
  const pts = [];
  const cell = 6;
  for (let y = 0; y < S; y += cell) for (let x = 0; x < S; x += cell) pts.push([x + r.range(0.5, cell - 0.5), y + r.range(0.5, cell - 0.5), r.next()]);
  const stones = ['#8b8379', '#968d82', '#a1978b', '#81796f', '#9c9184'];
  img.each((x, y) => {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) {
      let dx = Math.abs(x + 0.5 - p[0]); dx = Math.min(dx, S - dx);
      let dy = Math.abs(y + 0.5 - p[1]); dy = Math.min(dy, S - dy);
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1);
    if (edge < 0.9) return hex('#5d564e');
    const c = hex(stones[Math.floor(best[2] * stones.length)]);
    let f = 1 + (hash2(x, y, seed) - 0.5) * 0.08;
    // light from the top-left
    let dx = x + 0.5 - best[0]; if (dx > S / 2) dx -= S; if (dx < -S / 2) dx += S;
    let dy = y + 0.5 - best[1]; if (dy > S / 2) dy -= S; if (dy < -S / 2) dy += S;
    if (dx + dy < -2.5 && edge > 1.5) f *= 1.12;
    if (dx + dy > 2.5) f *= 0.9;
    return mulc(c, f);
  });
  return img;
}

function pavers(seed, colors, mortar, bw = 8, bh = 4) {
  const img = new Img(S, S);
  const m = hex(mortar);
  img.each((x, y) => {
    const row = Math.floor(y / bh);
    const off = (row % 2) * (bw / 2);
    const bx = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    if (lx === 0 || ly === 0) return m;
    const c = hex(colors[Math.floor(hash2(bx, row, seed) * colors.length)]);
    let f = 1 + (hash2(x, y, seed + 1) - 0.5) * 0.07;
    if (ly === 1) f *= 1.06;
    if (ly === bh - 1) f *= 0.94;
    return mulc(c, f);
  });
  return img;
}

function wood(seed) {
  const img = new Img(S, S);
  const cols = ['#a8774c', '#b4845a', '#bf9066', '#9e6f47'];
  img.each((x, y) => {
    const plank = Math.floor(x / 5);
    const lx = x % 5;
    if (lx === 0) return hex('#5e4029');
    const seg = Math.floor((y + hash2(plank, 0, seed) * 64) / 32);
    const c = hex(cols[Math.floor(hash2(plank, seg, seed) * cols.length)]);
    let f = 1 + (pnoise(x / 2, y / 9, S / 2, seed + plank) - 0.5) * 0.18;
    if ((y + Math.floor(hash2(plank, 0, seed) * 64)) % 32 === 0) return mulc(c, 0.7);
    if (lx === 1) f *= 1.08;
    if (lx === 4) f *= 0.9;
    const yy = (y + Math.floor(hash2(plank, 0, seed) * 64)) % 32;
    if ((yy === 2 || yy === 29) && (lx === 2 || lx === 3) && lx === 2) return hex('#4d3a2a');
    return mulc(c, f);
  });
  return img;
}

function rock(seed) {
  const img = new Img(S, S);
  noiseRamp(img, ['#55555e', '#64646e', '#74747e', '#86868f', '#9a9aa2'], seed, 20, 4, 0.25);
  const r = new RNG(seed);
  for (let k = 0; k < 14; k++) {
    let x = r.int(0, S - 1), y = r.int(0, S - 1);
    for (let s = 0; s < r.int(6, 16); s++) {
      img.mul(x, y, 0.68);
      img.mul(x + 1, y - 1, 1.15);
      x += r.int(-1, 1); y += r.int(0, 1);
    }
  }
  return img;
}

function flowerbed(seed) {
  const img = new Img(S, S);
  noiseRamp(img, ['#4a3528', '#56402f', '#634a37'], seed, 8, 2, 0.4);
  const r = new RNG(seed);
  const petals = ['#ff6f91', '#ffc75f', '#f9f871', '#ffffff', '#c493ff', '#ff9671', '#6fd0ff'];
  for (let k = 0; k < 170; k++) {
    const x = r.int(0, S - 1), y = r.int(0, S - 1);
    const leaf = hex(r.pick(['#4f8f3f', '#5ea54a', '#3f7a35']));
    img.setw(x - 1, y + 1, leaf); img.setw(x + 1, y + 1, leaf); img.setw(x, y + 2, leaf);
    const c = hex(r.pick(petals));
    img.setw(x, y, mulc(c, 1.0)); img.setw(x - 1, y, mulc(c, 0.85)); img.setw(x + 1, y, mulc(c, 0.85)); img.setw(x, y - 1, mulc(c, 1.08)); img.setw(x, y + 1, mulc(c, 0.75));
    img.setw(x, y, hex('#ffe9a8'));
  }
  return img;
}

function sand(seed) {
  const img = new Img(S, S);
  const cols = ['#d6b97f', '#e0c58d', '#e9d29b', '#f1ddab'];
  img.each((x, y) => {
    const n = pfbm(x / 32, y / 32, S / 32, seed, 2);
    const rip = Math.sin((x * 0.35 + y * 0.9 + pnoise(x / 16, y / 16, S / 16, seed + 5) * 10) * 0.9) * 0.08;
    const f = (hash2(x, y, seed) - 0.5) * 0.25;
    return ramp(cols, n + rip + f, x, y, 0.8);
  });
  const r = new RNG(seed);
  for (let k = 0; k < 40; k++) img.setw(r.int(0, S - 1), r.int(0, S - 1), hex(r.pick(['#fff3dc', '#c9a774', '#f7c9b8'])));
  return img;
}

function stripes(seed, a, b, band) {
  const img = new Img(S, S);
  const ca = hex(a), cb = hex(b);
  img.each((x, y) => {
    const c = Math.floor(y / band) % 2 ? ca : cb;
    return mulc(c, 1 + (hash2(x, y, seed) - 0.5) * 0.12 + (pnoise(x / 8, y / 8, S / 8, seed) - 0.5) * 0.08);
  });
  return img;
}

function checker(seed, a, b, grout, size) {
  const img = new Img(S, S);
  const ca = hex(a), cb = hex(b), g = hex(grout);
  img.each((x, y) => {
    if (x % size === 0 || y % size === 0) return g;
    const c = (Math.floor(x / size) + Math.floor(y / size)) % 2 ? ca : cb;
    let f = 1 + (hash2(x, y, seed) - 0.5) * 0.06;
    if (x % size === 1 || y % size === 1) f *= 1.06;
    return mulc(c, f);
  });
  return img;
}

function water(seed, colors) {
  const img = new Img(S, S);
  noiseRamp(img, colors, seed, 32, 3, 0.1, 0.8);
  return img;
}

export function makeTerrainTextures() {
  const tex = new Array(TERRAIN_COUNT);
  tex[T.DEEP] = water(11, ['#1f5585', '#25608f', '#2b6b9a', '#3176a5']);
  tex[T.WATER] = water(12, ['#3a8dbd', '#4598c6', '#50a3cf', '#5daed6']);
  tex[T.SAND] = sand(13);
  tex[T.GRASS] = grass(14, ['#3e7b38', '#4b8f41', '#5aa34a', '#6cb553', '#7fc45f'], { flowers: 26 });
  tex[T.DIRT] = (() => {
    const img = new Img(S, S);
    noiseRamp(img, ['#6f5034', '#7e5d3d', '#8d6a46', '#9c7850'], 15, 16, 3, 0.35);
    const r = new RNG(15);
    for (let k = 0; k < 90; k++) { const x = r.int(0, S - 1), y = r.int(0, S - 1); img.setw(x, y, hex('#b9a58a')); img.setw(x, y + 1, hex('#5b412b')); }
    return img;
  })();
  tex[T.FOREST] = (() => {
    const img = grass(16, ['#2d5a30', '#376a37', '#42793f', '#4e8846', '#5a954d'], { tufts: 340 });
    const r = new RNG(16);
    for (let k = 0; k < 160; k++) img.setw(r.int(0, S - 1), r.int(0, S - 1), hex(r.pick(['#6b5636', '#7c6440', '#8a3f2c', '#b5852e'])));
    return img;
  })();
  tex[T.ASPHALT] = asphalt(17, ['#3b3d47', '#41434c', '#474952', '#4d4f58']);
  tex[T.SIDEWALK] = slabs('#bdb7ac', '#999389', 16, 18, { cracks: 8, spots: 20 });
  tex[T.PLAZA] = pavers(19, ['#d5c09d', '#cfb790', '#dccaa9', '#c9b08a'], '#b09a78');
  tex[T.COBBLE] = cobble(20);
  tex[T.WOOD] = wood(21);
  tex[T.CONCRETE] = slabs('#a3a19a', '#86847e', 32, 22, { cracks: 10, spots: 40 });
  tex[T.PARKING] = asphalt(23, ['#4a4c55', '#50525b', '#565861', '#5c5e66'], { cracks: 2, patches: 4 });
  tex[T.GRAVEL] = (() => {
    const img = new Img(S, S);
    noiseRamp(img, ['#bba67c', '#c7b38a', '#d2c098', '#dccba6'], 24, 6, 2, 0.6, 1);
    const r = new RNG(24);
    for (let k = 0; k < 400; k++) img.setw(r.int(0, S - 1), r.int(0, S - 1), hex(r.pick(['#e8dcc0', '#9f8c66', '#ae9a74'])));
    return img;
  })();
  tex[T.FLOWERBED] = flowerbed(25);
  tex[T.POOL] = checker(26, '#79d3e0', '#83dbe6', '#5dbccb', 8);
  tex[T.BRIDGE] = (() => {
    const img = asphalt(27, ['#4a4750', '#504d56', '#56535c', '#5c5962'], { cracks: 1, patches: 1 });
    for (let y = 0; y < S; y++) { img.setw(0, y, hex('#2f2d33')); img.setw(64, y, hex('#2f2d33')); img.setw(1, y, hex('#6c6973')); img.setw(65, y, hex('#6c6973')); }
    return img;
  })();
  tex[T.FLOOR] = slabs('#77736c', '#5d5a55', 16, 28, { cracks: 0, spots: 0 });
  tex[T.ROCK] = rock(29);
  tex[T.TILES] = checker(30, '#c98d6a', '#e6d3b0', '#a88a6e', 8);
  tex[T.COURT] = (() => {
    const img = new Img(S, S);
    noiseRamp(img, ['#a8553f', '#b25d46', '#bc664d'], 31, 32, 2, 0.15, 0.6);
    return img;
  })();
  tex[T.FIELD] = stripes(32, '#5aa84a', '#66b655', 16);
  return tex;
}

// Small tileable RG noise used to jitter natural terrain borders.
export function makeJitterTexture(size = 64) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    d[o] = Math.floor(pfbm(x / 8, y / 8, size / 8, 101, 3) * 255);
    d[o + 1] = Math.floor(pfbm(x / 8, y / 8, size / 8, 202, 3) * 255);
    d[o + 2] = Math.floor(pfbm(x / 16, y / 16, size / 16, 303, 2) * 255);
    d[o + 3] = Math.floor(hash2(x, y, 404) * 255);
  }
  return d;
}

// Tileable cloud/fbm texture for cloud shadows, puddles and macro variation.
export function makeCloudTexture(size = 256) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    d[o] = Math.floor(pfbm(x / 32, y / 32, size / 32, 501, 5) * 255);
    d[o + 1] = Math.floor(pfbm(x / 16, y / 16, size / 16, 602, 4) * 255);
    d[o + 2] = Math.floor(pfbm(x / 64, y / 64, size / 64, 703, 3) * 255);
    d[o + 3] = 255;
  }
  return d;
}

void mixc;
