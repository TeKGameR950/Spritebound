import { Vox, rgb, shade, mix, EM } from './voxel.js';
import { hash2, RNG } from '/shared/rng.js';
import { valueNoise } from '/shared/noise.js';

// Each builder returns { m: Vox, step?, canopyZ?, lights?: [{x,y,z,r,c,k}] } with model
// coordinates centred on the prop position. Lights use model coords (before rotation).

const C = (h) => rgb(h);
const METAL = C('#4b4f58'), DARK = C('#2c2e34'), WOOD = C('#8a5a36'), WOOD2 = C('#a8744a');
const STONE = C('#a9a397'), STONE2 = C('#8e887d'), WHITE = C('#f1eee6'), RED = C('#cf3e36');
const LEAF = ['#3d7a35', '#4b8c3e', '#5aa047', '#6db452', '#82c561'];
const LEAF_DARK = ['#2c5a2e', '#356b35', '#3f7a3b', '#4b8a45'];
const CHERRY = ['#d77fa1', '#e693b3', '#f0a9c4', '#f8c4d8', '#fde0ea'];
const BIRCH = ['#6f9a3c', '#82ad45', '#97c052', '#acd060'];
const AUTUMN = ['#b8592c', '#cf7a2e', '#e09b34', '#ecbd4b'];

function leafColor(pal, x, y, z, cx, cy, top, seed) {
  const n = valueNoise(x * 0.35, y * 0.35 + z * 0.3, seed);
  const h = z / top;
  const v = Math.min(pal.length - 1, Math.max(0, Math.floor(n * 1.6 + h * (pal.length - 1) * 0.9)));
  return C(pal[v]);
}

function blobCanopy(m, cx, cy, cz, r, pal, seed, rz = r * 0.75) {
  const rr = new RNG(seed);
  const blobs = [[0, 0, 0, r]];
  for (let i = 0; i < 6; i++) {
    const a = rr.range(0, Math.PI * 2);
    blobs.push([Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, rr.range(-2, 3), r * rr.range(0.5, 0.7)]);
  }
  const top = cz + rz + 3;
  for (const [ox, oy, oz, br] of blobs) {
    m.ell(cx + ox, cy + oy, cz + oz, br, br, br * 0.78, (x, y, z, d) => {
      if (d > 0.82 && hash2(x, y * 31 + z, seed) < 0.35) return 0;
      return leafColor(pal, x, y, z, cx, cy, top, seed);
    });
  }
}

const B = {};

B.oak = (v) => {
  const m = new Vox(28, 28, 30);
  m.cyl(14, 14, 0, 14, 2.2, (x, y, z) => shade(C('#6b4a2f'), 0.9 + hash2(x, z, 1) * 0.2));
  blobCanopy(m, 14, 14, 19, 10, v === 3 ? AUTUMN : LEAF, 100 + v * 7);
  return { m, step: 2, canopyZ: 12 };
};
B.cherry = (v) => {
  const m = new Vox(26, 26, 26);
  m.cyl(13, 13, 0, 12, 1.8, C('#5a3a2a'));
  blobCanopy(m, 13, 13, 16, 9, CHERRY, 200 + v * 5);
  return { m, step: 2, canopyZ: 10 };
};
B.birch = (v) => {
  const m = new Vox(20, 20, 32);
  m.cyl(10, 10, 0, 22, 1.5, (x, y, z) => (hash2(x, z, 3) < 0.25 ? C('#2a2a2a') : C('#e9e6dc')));
  blobCanopy(m, 10, 10, 22, 7, BIRCH, 300 + v * 5, 6);
  return { m, step: 2, canopyZ: 14 };
};
B.pine = (v) => {
  const m = new Vox(22, 22, 36);
  m.cyl(11, 11, 0, 8, 1.6, C('#5c3f28'));
  const tiers = [[6, 9.5], [13, 7.5], [19, 5.5], [25, 3.5], [30, 2]];
  for (const [z0, r] of tiers) {
    for (let z = z0; z < z0 + 8 && z < 36; z++) {
      const t = (z - z0) / 8;
      const rr = r * (1 - t * 0.7);
      m.cyl(11, 11, z, z + 1, rr, (x, y) => {
        const n = hash2(x, y + z * 13, 40 + v);
        const pal = LEAF_DARK;
        return C(pal[Math.min(pal.length - 1, Math.floor(t * 2 + n * 2))]);
      });
    }
  }
  return { m, step: 2, canopyZ: 8 };
};
B.palm = (v) => {
  const m = new Vox(30, 30, 32);
  const lean = [1, -1, 0.6, -0.6][v & 3];
  let tx = 15, ty = 15;
  for (let z = 0; z < 24; z++) {
    tx = 15 + Math.sin(z / 24 * 1.4) * 4 * lean;
    m.cyl(tx, ty, z, z + 1, 1.6, z % 3 === 0 ? C('#9a7a52') : C('#b8956a'));
  }
  const top = 24;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + v;
    for (let s = 0; s < 13; s++) {
      const x = tx + Math.cos(a) * s, y = ty + Math.sin(a) * s;
      const z = top + 3 - (s * s) / 22;
      const col = C(s > 9 ? '#6aa84a' : s % 2 ? '#4f8f3c' : '#5c9c44');
      m.set(Math.round(x), Math.round(y), Math.round(z), col);
      m.set(Math.round(x - Math.sin(a)), Math.round(y + Math.cos(a)), Math.round(z), col);
      if (s > 2 && s < 10) m.set(Math.round(x + Math.sin(a)), Math.round(y - Math.cos(a)), Math.round(z - 1), shade(col, 0.85));
    }
  }
  m.ell(tx, ty, top, 2, 2, 1.5, C('#7a5a2a'));
  return { m, step: 2, canopyZ: 18 };
};
B.bush = (v) => {
  const m = new Vox(14, 14, 10);
  m.ell(7, 7, 4, 6.2, 6.2, 5, (x, y, z) => {
    if (v === 2 && hash2(x, y + z * 7, 5) < 0.12) return C(['#ff6f91', '#ffd166', '#ffffff'][(x + y) % 3]);
    return leafColor(LEAF, x, y, z, 7, 7, 9, 50 + v);
  });
  return { m };
};
B.hedge = () => {
  const m = new Vox(16, 16, 9);
  m.box(0, 0, 0, 16, 16, 9, (x, y, z) => C(LEAF[Math.min(4, Math.floor(z / 3) + Math.floor(hash2(x, y + z * 5, 9) * 2))]));
  return { m };
};
B.flowers = (v) => {
  const m = new Vox(10, 10, 4);
  const cols = ['#ff6f91', '#ffd166', '#ffffff', '#c493ff', '#ff9671', '#6fd0ff'];
  const rr = new RNG(v + 11);
  for (let i = 0; i < 6; i++) {
    const x = rr.int(1, 8), y = rr.int(1, 8);
    m.set(x, y, 0, C('#4a8a3a')); m.set(x, y, 1, C('#4a8a3a'));
    m.set(x, y, 2, C(cols[(v + i) % cols.length]));
    m.set(x + 1, y, 2, shade(C(cols[(v + i) % cols.length]), 0.85));
  }
  return { m };
};

B.lamp = (v) => {
  const m = new Vox(14, 6, 38);
  const pole = v === 1 ? C('#3a3d44') : C('#555a63');
  m.cyl(2.5, 3, 0, 36, 1.1, pole);
  m.cyl(2.5, 3, 0, 2, 1.8, DARK);
  m.box(2, 2, 35, 11, 4, 36, pole);
  m.box(8, 1, 33, 13, 5, 35, DARK);
  m.box(9, 2, 33, 12, 4, 34, C('#fff2c8'), EM.NIGHT);
  return { m, step: 1, lights: [{ x: 10.5, y: 3, z: 33, r: 92, c: [1.0, 0.72, 0.42], k: 'street' }] };
};
B.lantern = () => {
  const m = new Vox(8, 8, 30);
  m.cyl(4, 4, 0, 24, 1, C('#23242a'));
  m.cyl(4, 4, 0, 2, 2, C('#23242a'));
  m.box(2, 2, 23, 6, 6, 28, C('#23242a'));
  m.box(3, 3, 24, 5, 5, 27, C('#ffd88a'), EM.NIGHT);
  m.box(2, 2, 28, 6, 6, 29, C('#2f3038'));
  return { m, lights: [{ x: 4, y: 4, z: 26, r: 80, c: [1.0, 0.68, 0.36], k: 'street' }] };
};
B.traffic = () => {
  const m = new Vox(16, 6, 32);
  m.cyl(2, 3, 0, 30, 1, C('#3d4048'));
  m.box(2, 2, 29, 14, 4, 30, C('#3d4048'));
  m.box(11, 1, 26, 15, 5, 31, C('#1f2126'));
  return { m, signal: { x: 13, y: 3, z: 31 } };
};
B.bench = (v) => {
  const m = new Vox(18, 8, 9);
  const w = v === 1 ? C('#6b6f78') : WOOD2;
  for (const x of [1, 16]) m.box(x, 1, 0, x + 1, 7, 4, DARK);
  m.box(0, 2, 4, 18, 7, 5, (x, y) => (y % 2 ? w : shade(w, 0.85)));
  m.box(0, 0, 5, 18, 2, 9, (x, y, z) => (z % 2 ? w : shade(w, 0.85)));
  return { m };
};
B.hydrant = () => {
  const m = new Vox(8, 8, 9);
  m.cyl(4, 4, 0, 1, 3, C('#9a2a24'));
  m.cyl(4, 4, 1, 7, 2.2, RED);
  m.cyl(4, 4, 7, 9, 1.6, C('#e8c84a'));
  m.box(1, 3, 4, 7, 5, 6, C('#b8302a'));
  return { m };
};
B.trash = (v) => {
  const m = new Vox(10, 10, 11);
  const col = [C('#3a6b4a'), C('#3b5a7a'), C('#6a6e75')][v % 3];
  m.cyl(5, 5, 0, 9, 4, (x, y, z) => (z % 3 === 0 ? shade(col, 0.8) : col));
  m.cyl(5, 5, 9, 10, 4.4, shade(col, 1.15));
  m.cyl(5, 5, 10, 11, 1.5, DARK);
  return { m };
};
B.mailbox = (v) => {
  const m = new Vox(8, 8, 12);
  if (v % 2) {
    m.box(3, 3, 0, 5, 5, 8, WHITE);
    m.box(1, 2, 8, 7, 6, 12, C(['#3b6fb0', '#c43c3c', '#3d8a5a', '#2c2c32'][v % 4]));
    m.box(6, 5, 10, 7, 6, 12, RED);
  } else {
    m.box(1, 1, 0, 7, 7, 1, DARK);
    m.box(1, 1, 1, 7, 7, 10, C('#2f5ea8'));
    m.ell(4, 4, 10, 3, 3, 2, C('#2f5ea8'));
  }
  return { m };
};
B.busstop = () => {
  const m = new Vox(32, 12, 24);
  for (const x of [1, 30]) m.box(x, 1, 0, x + 1, 2, 22, METAL);
  m.box(1, 1, 1, 31, 2, 20, (x, y, z) => (z % 4 ? C('#9cc6dd') : METAL));
  m.box(4, 3, 4, 28, 7, 5, WOOD2);
  m.box(0, 0, 21, 32, 12, 23, C('#3f6f9f'));
  m.box(1, 1, 23, 31, 11, 24, C('#5585b5'));
  m.box(28, 9, 0, 30, 11, 26, C('#e8c84a'));
  return { m, canopyZ: 20, lights: [{ x: 16, y: 6, z: 20, r: 40, c: [0.7, 0.85, 1.0], k: 'neon' }] };
};
B.fountain = (v) => {
  const m = new Vox(46, 46, 18);
  m.cyl(23, 23, 0, 4, 22, (x, y, z) => (Math.hypot(x + 0.5 - 23, y + 0.5 - 23) > 19 ? (z === 3 ? C('#c8c1b2') : STONE) : 0));
  m.cyl(23, 23, 0, 1, 19, C('#8a8478'));
  m.cyl(23, 23, 1, 3, 19, C('#4aa3c7'), EM.WATER);
  m.cyl(23, 23, 3, 12, 2.5, STONE2);
  m.cyl(23, 23, 12, 13, 7, C('#c8c1b2'));
  m.cyl(23, 23, 13, 14, 6, C('#5cb7d9'), EM.WATER);
  m.cyl(23, 23, 14, 17, 1.4, STONE);
  if (v === 1) m.cyl(23, 23, 17, 18, 1, C('#e8c84a'));
  return { m, fountain: true, lights: [{ x: 23, y: 23, z: 4, r: 70, c: [0.4, 0.75, 1.0], k: 'neon' }] };
};
B.statue = (v) => {
  const m = new Vox(14, 14, 28);
  m.box(1, 1, 0, 13, 13, 3, STONE2);
  m.box(2, 2, 3, 12, 12, 9, STONE);
  const bronze = [C('#5f8f7a'), C('#8a7a5a'), C('#c8c4ba')][v % 3];
  m.box(5, 5, 9, 9, 9, 18, bronze);
  m.box(4, 3, 14, 10, 11, 19, bronze);
  m.ell(7, 7, 21, 2.2, 2.2, 2.4, bronze);
  m.box(9, 10, 18, 11, 12, 25, bronze);
  return { m };
};
B.parasol = (v) => {
  const m = new Vox(22, 22, 19);
  m.cyl(11, 11, 0, 17, 0.8, WHITE);
  const cols = [['#e85d5d', '#ffffff'], ['#3d8fd6', '#ffffff'], ['#f2c14e', '#ffffff'], ['#3fa36b', '#f2e6c8'], ['#e07fb3', '#ffffff'], ['#f27e3e', '#fff3d6']][v % 6];
  for (let z = 15; z < 19; z++) {
    const r = 10 - (z - 15) * 2.4;
    m.cyl(11, 11, z, z + 1, r, (x, y) => {
      const a = Math.atan2(y + 0.5 - 11, x + 0.5 - 11);
      return C(cols[Math.floor((a + Math.PI) / (Math.PI / 4)) % 2]);
    });
  }
  return { m, canopyZ: 14 };
};
B.towel = (v) => {
  const m = new Vox(16, 8, 1);
  const cols = [['#e85d5d', '#ffffff'], ['#3d8fd6', '#f2c14e'], ['#7d5ec9', '#ffffff'], ['#3fa36b', '#f2e6c8'], ['#e07fb3', '#ffe08a'], ['#2c9f9f', '#ffffff']][v % 6];
  m.box(0, 0, 0, 16, 8, 1, (x) => C(cols[Math.floor(x / 2) % 2]));
  return { m };
};
B.cafetable = (v) => {
  const m = new Vox(14, 14, 8);
  m.cyl(7, 7, 0, 6, 0.8, DARK);
  m.cyl(7, 7, 6, 7, 3.2, [WHITE, C('#2c2c32'), C('#c8a26a'), C('#3d6b8a')][v % 4]);
  for (const [cx, cy] of [[2, 7], [12, 7]]) {
    m.box(cx - 1.5, cy - 1.5, 3, cx + 1.5, cy + 1.5, 4, C('#7a5a3a'));
    m.box(cx - 1.5, cy - 1.5, 0, cx - 0.5, cy - 0.5, 3, DARK);
  }
  return { m };
};
B.planter = (v) => {
  const m = new Vox(14, 14, 9);
  m.box(0, 0, 0, 14, 14, 5, (x, y, z) => (z === 4 ? C('#cfc8b8') : STONE2));
  m.box(1, 1, 4, 13, 13, 5, C('#5a4030'));
  if (v !== 1) m.ell(7, 7, 6, 5, 5, 3, (x, y, z) => C(LEAF[Math.floor(hash2(x, y + z, 7) * 4)]));
  if (v === 2) for (let i = 0; i < 6; i++) m.set(3 + (i * 5) % 9, 3 + (i * 3) % 8, 8, C(['#ff6f91', '#ffd166', '#ffffff'][i % 3]));
  return { m };
};
B.bollard = (v) => {
  const m = new Vox(5, 5, v === 1 ? 26 : 7);
  if (v === 1) { m.box(1, 1, 0, 4, 4, 26, C('#e8e8e8')); m.box(1, 1, 0, 4, 4, 2, C('#d84a3a')); return { m }; }
  m.cyl(2.5, 2.5, 0, 6, 1.8, C('#3a3d44'));
  m.cyl(2.5, 2.5, 5, 6, 1.8, C('#e8c84a'));
  return { m };
};
B.phone = (v) => {
  const m = new Vox(10, 10, 24);
  const col = v % 2 ? C('#c43c3c') : C('#3b6fb0');
  m.box(0, 0, 0, 10, 10, 22, (x, y, z) => ((x === 0 || x === 9 || y === 0 || y === 9) && z > 3 && z < 19 && (x + y) % 9 !== 0 ? C('#9cc6dd') : col));
  m.box(0, 0, 22, 10, 10, 24, shade(col, 1.1));
  m.box(3, 3, 23, 7, 7, 24, C('#fff2c8'), EM.NIGHT);
  return { m, lights: [{ x: 5, y: 5, z: 20, r: 36, c: [0.8, 0.9, 1.0], k: 'neon' }] };
};
B.vending = (v) => {
  const m = new Vox(12, 8, 19);
  const col = [C('#d84a4a'), C('#3d7ccf'), C('#3c9c66')][v % 3];
  m.box(0, 0, 0, 12, 8, 19, col);
  m.box(1, 7, 4, 11, 8, 17, C('#bfe6ff'), EM.NIGHT);
  m.box(1, 1, 18, 11, 7, 19, shade(col, 1.15));
  return { m, lights: [{ x: 6, y: 9, z: 10, r: 30, c: [0.7, 0.9, 1.0], k: 'neon' }] };
};
B.newsbox = (v) => {
  const m = new Vox(7, 6, 9);
  m.box(0, 0, 0, 7, 6, 9, [C('#e8c84a'), C('#3b6fb0'), C('#c43c3c'), C('#3d8a5a')][v % 4]);
  m.box(1, 5, 4, 6, 6, 8, C('#cfe6f0'));
  return { m };
};
B.foodcart = (v) => {
  const m = new Vox(26, 14, 22);
  const col = [C('#f2c14e'), C('#e07fb3'), C('#53b3d6')][v % 3];
  for (const x of [3, 20]) m.cyl(x, 1, 0, 3, 2, DARK), m.cyl(x, 12, 0, 3, 2, DARK);
  m.box(1, 1, 3, 25, 13, 12, col);
  m.box(1, 1, 12, 25, 13, 13, C('#d8d4cc'));
  m.cyl(13, 7, 13, 19, 0.8, WHITE);
  for (let z = 19; z < 22; z++) m.cyl(13, 7, z, z + 1, 11 - (z - 19) * 3, (x, y) => (Math.floor(Math.atan2(y - 7, x - 13) * 2.5) % 2 ? C('#ffffff') : col));
  return { m, canopyZ: 18 };
};
B.picnic = (v) => {
  const m = new Vox(20, 16, 8);
  const w = v % 2 ? WOOD : WOOD2;
  m.box(2, 5, 7, 18, 11, 8, w);
  m.box(2, 1, 4, 18, 4, 5, w);
  m.box(2, 12, 4, 18, 15, 5, w);
  for (const x of [4, 15]) m.box(x, 2, 0, x + 1, 14, 7, shade(w, 0.8));
  return { m };
};
B.crate = (v) => {
  const m = new Vox(12, 12, 11);
  const w = [WOOD2, C('#9a7a4a'), C('#b88a5a'), C('#7a5a3a')][v % 4];
  m.box(0, 0, 0, 12, 12, 11, (x, y, z) => (x === 0 || x === 11 || y === 0 || y === 11 || z === 10 || z === 0 ? shade(w, 0.8) : (x + y) % 5 === 0 ? shade(w, 0.85) : w));
  return { m };
};
B.barrel = (v) => {
  const m = new Vox(10, 10, 13);
  const col = [C('#2f6db5'), C('#c0443a'), C('#3f9a5a'), C('#e09a2c')][v % 4];
  m.cyl(5, 5, 0, 13, 4.6, (x, y, z) => (z % 4 === 0 ? shade(col, 0.7) : col));
  m.cyl(5, 5, 12, 13, 3.6, shade(col, 0.85));
  m.set(6, 6, 12, DARK);
  return { m };
};
B.dumpster = (v) => {
  const m = new Vox(22, 12, 13);
  const col = v % 2 ? C('#2f5ea8') : C('#3a7a4a');
  m.box(0, 0, 0, 22, 12, 11, col);
  m.box(0, 0, 11, 22, 12, 13, (x) => (x === 11 ? DARK : shade(col, 0.85)));
  return { m };
};
B.rock = (v) => {
  const m = new Vox(18, 18, 10);
  const rr = new RNG(v + 5);
  m.ell(9, 9, 2, 8, 7, 7, (x, y, z) => (z >= 0 ? C(['#7d7d86', '#8b8b94', '#6e6e77', '#9a9aa2'][Math.floor(valueNoise(x * 0.4, y * 0.4 + z, v) * 4)]) : 0));
  m.ell(9 + rr.range(-3, 3), 9 + rr.range(-3, 3), 4, 4, 4, 4, C('#9a9aa2'));
  if (v % 2) for (let i = 0; i < 8; i++) m.set(rr.int(3, 14), rr.int(3, 14), rr.int(6, 8), C('#6aa04a'));
  return { m };
};
B.log = () => {
  const m = new Vox(26, 10, 9);
  for (let x = 0; x < 26; x++) for (let y = 0; y < 10; y++) for (let z = 0; z < 9; z++) {
    const d = Math.hypot(y + 0.5 - 5, z + 0.5 - 4.5);
    if (d > 4.3) continue;
    const end = x === 0 || x === 25;
    m.set(x, y, z, end ? (Math.floor(d) % 2 ? C('#c8a06a') : C('#b08a58')) : C(d > 3.4 ? '#5e3e26' : '#6b4a2f'));
  }
  return { m };
};
B.campfire = () => {
  const m = new Vox(14, 14, 6);
  for (let a = 0; a < 10; a++) {
    const x = 7 + Math.cos(a / 10 * Math.PI * 2) * 5.5, y = 7 + Math.sin(a / 10 * Math.PI * 2) * 5.5;
    m.ell(x, y, 1, 1.5, 1.5, 1.4, C(a % 2 ? '#8a8478' : '#a39d90'));
  }
  m.line(4, 5, 1, 10, 9, 2, C('#5e3e26'));
  m.line(4, 9, 1, 10, 5, 2, C('#6b4a2f'));
  m.ell(7, 7, 1, 2.5, 2.5, 1.2, C('#ff9a3a'), EM.FIRE);
  return { m, lights: [{ x: 7, y: 7, z: 6, r: 110, c: [1.0, 0.55, 0.22], k: 'fire' }], fire: { x: 7, y: 7, z: 3 } };
};
B.tent = (v) => {
  const m = new Vox(24, 20, 13);
  const col = [C('#e2702e'), C('#3f8f6b'), C('#3a5fb0'), C('#c94a4a')][v % 4];
  for (let z = 0; z < 13; z++) {
    const half = 10 * (1 - z / 13);
    m.box(1, 10 - half, z, 23, 10 + half, z + 1, (x, y) => (Math.abs(y + 0.5 - 10) > half - 1 ? col : z === 12 ? shade(col, 1.2) : shade(col, 0.9 + (y > 10 ? -0.12 : 0.05))));
  }
  return { m };
};
B.lifeguard = () => {
  const m = new Vox(18, 18, 28);
  for (const [x, y] of [[2, 2], [15, 2], [2, 15], [15, 15]]) m.box(x, y, 0, x + 1, y + 1, 14, WHITE);
  m.box(1, 1, 13, 17, 17, 14, WOOD2);
  m.box(3, 3, 14, 15, 15, 23, (x, y, z) => (z > 16 && z < 21 && (x === 3 || x === 14) ? C('#9cc6dd') : WHITE));
  for (let z = 23; z < 28; z++) m.box(1 + (z - 23), 1 + (z - 23), z, 17 - (z - 23), 17 - (z - 23), z + 1, (x) => (Math.floor(x / 3) % 2 ? RED : WHITE));
  return { m, canopyZ: 20 };
};
B.boat = (v) => {
  const m = new Vox(44, 18, 12);
  const hull = [C('#f1eee6'), C('#3a5fb0'), C('#c94a4a'), C('#3f8f6b')][v % 4];
  for (let x = 0; x < 44; x++) {
    const taper = x > 30 ? 1 - (x - 30) / 16 : 1;
    const half = 8 * taper + (x < 2 ? -1 : 0);
    for (let z = 0; z < 6; z++) m.box(x, 9 - half, z, x + 1, 9 + half, z + 1, z === 5 ? C('#c8a06a') : z > 3 ? hull : shade(hull, 0.7));
  }
  m.box(10, 4, 6, 22, 14, 11, WHITE);
  m.box(11, 5, 11, 21, 13, 12, shade(hull, 1.1));
  m.box(21, 5, 7, 22, 13, 10, C('#6f9fc0'));
  return { m };
};
B.buoy = (v) => {
  const m = new Vox(8, 8, 10);
  m.cyl(4, 4, 0, 7, 3.4, (x, y, z) => (Math.floor(z / 2) % 2 ? WHITE : v ? C('#3f8f6b') : RED));
  m.cyl(4, 4, 7, 9, 1, DARK);
  m.set(4, 4, 9, C('#fff2a8'), EM.BLINK);
  return { m, lights: [{ x: 4, y: 4, z: 9, r: 30, c: v ? [0.3, 1.0, 0.4] : [1.0, 0.3, 0.2], k: 'blink' }] };
};
B.slide = (v) => {
  const m = new Vox(28, 10, 18);
  const col = [C('#e85d5d'), C('#3d8fd6'), C('#f2c14e')][v % 3];
  m.box(1, 2, 0, 8, 8, 14, (x, y, z) => ((x === 1 || x === 7) && (y === 2 || y === 7) ? METAL : z === 13 ? C('#d8c8a0') : 0));
  m.box(1, 2, 13, 8, 8, 14, C('#d8c8a0'));
  m.box(0, 1, 14, 9, 9, 18, (x, y, z) => (z === 17 ? col : (x === 0 || x === 8 || y === 1 || y === 8) && z < 16 ? METAL : 0));
  for (let x = 8; x < 28; x++) { const z = Math.round(13 - (x - 8) * 0.65); m.box(x, 3, z, x + 1, 7, z + 1, col); m.set(x, 2, z + 1, shade(col, 0.8)); m.set(x, 7, z + 1, shade(col, 0.8)); }
  return { m };
};
B.swing = () => {
  const m = new Vox(30, 12, 20);
  for (const x of [1, 28]) { m.line(x, 1, 0, x, 6, 19, METAL); m.line(x, 11, 0, x, 6, 19, METAL); }
  m.box(1, 5, 19, 29, 7, 20, METAL);
  for (const x of [8, 20]) { m.line(x, 6, 19, x, 6, 6, C('#999')); m.box(x - 2, 5, 5, x + 3, 8, 6, C('#e85d5d')); }
  return { m };
};
B.seesaw = (v) => {
  const m = new Vox(32, 6, 6);
  m.box(14, 1, 0, 18, 5, 4, METAL);
  m.box(0, 2, 3, 32, 4, 4, [C('#3d8fd6'), C('#f2c14e'), C('#3fa36b')][v % 3]);
  m.box(1, 1, 4, 4, 5, 6, C('#e85d5d'));
  m.box(28, 1, 4, 31, 5, 6, C('#e85d5d'));
  return { m };
};
B.bikerack = (v) => {
  const m = new Vox(20, 8, 8);
  for (let x = 2; x < 20; x += 5) { m.box(x, 3, 0, x + 1, 5, 7, METAL); m.box(x, 3, 6, x + 3, 5, 7, METAL); }
  const cols = [C('#e85d5d'), C('#3d8fd6'), C('#3fa36b'), C('#f2c14e')];
  for (let i = 0; i < 2 + (v % 2); i++) {
    const x = 1 + i * 6;
    m.box(x, 0, 0, x + 1, 8, 1, DARK);
    m.box(x, 1, 2, x + 1, 7, 4, cols[(v + i) % 4]);
  }
  return { m };
};
B.acunit = (v) => {
  const m = new Vox(10, 8, 7);
  m.box(0, 0, 0, 10, 8, 7, v % 2 ? C('#b8bcc2') : C('#9aa0a8'));
  m.cyl(5, 4, 6, 7, 2.8, DARK);
  m.set(5, 4, 6, C('#777'));
  return { m };
};
B.watertank = () => {
  const m = new Vox(16, 16, 22);
  for (const [x, y] of [[3, 3], [12, 3], [3, 12], [12, 12]]) m.box(x, y, 0, x + 1, y + 1, 8, DARK);
  m.cyl(8, 8, 8, 18, 7, (x, y, z) => (z % 3 === 0 ? C('#7a5a3a') : C('#9a7048')));
  for (let z = 18; z < 22; z++) m.cyl(8, 8, z, z + 1, 7 - (z - 18) * 1.8, C('#5a5e66'));
  return { m };
};
B.vent = (v) => {
  const m = new Vox(6, 6, 6);
  m.cyl(3, 3, 0, 5, 1.5, C('#8a8f96'));
  m.cyl(3, 3, 5, 6, 2.5, v ? C('#6a6e75') : C('#a0a5ac'));
  return { m };
};
B.solar = () => {
  const m = new Vox(10, 16, 4);
  for (let x = 0; x < 10; x++) { const z = Math.floor(1 + x * 0.3); m.box(x, 0, z, x + 1, 16, z + 1, (xx, y) => (y % 4 === 0 || x % 5 === 0 ? C('#c8ccd2') : C('#2a3d6a'))); }
  m.box(1, 2, 0, 2, 3, 2, METAL); m.box(1, 13, 0, 2, 14, 2, METAL);
  return { m };
};
B.antenna = () => {
  const m = new Vox(8, 8, 34);
  m.box(3, 3, 0, 5, 5, 32, C('#8a8f96'));
  for (const z of [12, 20, 26]) m.box(1, 3.5, z, 7, 4.5, z + 1, C('#8a8f96'));
  m.box(3, 3, 32, 5, 5, 34, C('#ff4a3a'), EM.BLINK);
  return { m, lights: [{ x: 4, y: 4, z: 34, r: 26, c: [1.0, 0.15, 0.1], k: 'blink' }] };
};
B.roofgarden = (v) => {
  const m = new Vox(14, 14, 8);
  m.box(0, 0, 0, 14, 14, 3, WOOD);
  m.box(1, 1, 2, 13, 13, 3, C('#5a4030'));
  if (v === 3) { m.ell(7, 7, 5, 5, 5, 4, (x, y, z) => C(CHERRY[Math.floor(hash2(x, y + z, 3) * 4)])); return { m }; }
  m.ell(7, 7, 4, 5.5, 5.5, 3.5, (x, y, z) => {
    if (hash2(x, y * 3 + z, 9 + v) < 0.1) return C(['#ff6f91', '#ffd166', '#ffffff', '#c493ff'][(x + y) % 4]);
    return C(LEAF[Math.floor(hash2(x, y + z, 7 + v) * 5)]);
  });
  return { m };
};
B.pump = () => {
  const m = new Vox(8, 14, 15);
  m.box(0, 0, 0, 8, 14, 2, C('#d8d4cc'));
  m.box(1, 2, 2, 7, 12, 14, (x, y, z) => (z > 9 ? C('#f2f2f2') : C('#d8402f')));
  m.box(2, 3, 14, 6, 11, 15, C('#2a2a30'));
  m.box(1, 4, 10, 2, 10, 13, C('#8fe39a'), EM.ALWAYS);
  return { m };
};
B.cone = () => {
  const m = new Vox(7, 7, 8);
  m.box(0, 0, 0, 7, 7, 1, C('#e2702e'));
  for (let z = 1; z < 8; z++) m.cyl(3.5, 3.5, z, z + 1, 3 - z * 0.33, z === 4 || z === 5 ? WHITE : C('#f2803a'));
  return { m };
};
B.fence = (v) => {
  const m = new Vox(16, 3, 9);
  const col = [WHITE, WOOD2, C('#6f7680')][v % 3];
  for (let x = 0; x < 16; x += 4) m.box(x, 1, 0, x + 2, 2, 9, col);
  m.box(0, 1, 3, 16, 2, 4, col);
  m.box(0, 1, 6, 16, 2, 7, col);
  return { m };
};
B.railing = () => {
  const m = new Vox(16, 2, 7);
  for (let x = 0; x < 16; x += 4) m.box(x, 0, 0, x + 1, 2, 7, C('#5a5e66'));
  m.box(0, 0, 6, 16, 2, 7, C('#6f747c'));
  m.box(0, 0, 3, 16, 2, 4, C('#6f747c'));
  return { m };
};
B.pallet = () => {
  const m = new Vox(16, 12, 3);
  m.box(0, 0, 0, 16, 12, 2, (x, y) => (y % 4 === 0 ? 0 : C('#b89060')));
  m.box(0, 0, 2, 16, 12, 3, (x) => (x % 3 === 2 ? 0 : C('#c8a070')));
  return { m };
};
B.tires = () => {
  const m = new Vox(14, 14, 12);
  for (let z = 0; z < 12; z++) m.cyl(7, 7, z, z + 1, 6.5, (x, y) => (Math.hypot(x + 0.5 - 7, y + 0.5 - 7) < 3 ? 0 : z % 4 === 3 ? C('#3a3a3e') : C('#1f1f23')));
  return { m };
};
B.pierpost = () => {
  const m = new Vox(6, 6, 8);
  m.cyl(3, 3, 0, 7, 2.5, C('#6b4a2f'));
  m.cyl(3, 3, 7, 8, 2.5, C('#8a6a4a'));
  return { m };
};
B.stall = (v) => {
  const m = new Vox(30, 18, 19);
  const col = [C('#d84a4a'), C('#407ed1'), C('#3c9c66'), C('#f2b63e'), C('#8c5ecb'), C('#e281b5')][v % 6];
  for (const [x, y] of [[1, 1], [28, 1], [1, 16], [28, 16]]) m.box(x, y, 0, x + 1, y + 1, 15, WOOD);
  m.box(2, 9, 0, 28, 16, 8, WOOD2);
  const goods = [['#e0605a', '#f2c14e', '#79c267'], ['#ffb347', '#ffd84a', '#e8e0c0'], ['#c49a6c', '#e8d6b0', '#a0522d']][v % 3];
  for (let x = 3; x < 27; x += 2) for (let y = 10; y < 15; y += 2) m.set(x, y, 8, C(goods[(x + y) % 3]));
  for (let z = 15; z < 19; z++) m.box(0, 0 + (z - 15), z, 30, 18 - (z - 15), z + 1, (x) => (Math.floor(x / 3) % 2 ? col : WHITE));
  return { m, canopyZ: 14 };
};
B.grill = () => {
  const m = new Vox(10, 10, 9);
  m.line(2, 2, 0, 4, 4, 5, DARK); m.line(8, 2, 0, 6, 4, 5, DARK); m.line(5, 8, 0, 5, 6, 5, DARK);
  m.ell(5, 5, 6, 4, 4, 2.5, C('#232327'));
  return { m };
};
B.sunbed = (v) => {
  const m = new Vox(22, 9, 7);
  const col = [WHITE, C('#3d8fd6'), C('#f2c14e'), C('#3fa36b')][v % 4];
  m.box(0, 0, 2, 16, 9, 3, (x, y) => (y % 3 === 0 ? C('#e8e4dc') : col));
  for (let x = 16; x < 22; x++) m.box(x, 0, 2 + (x - 16), x + 1, 9, 3 + (x - 16), col);
  for (const x of [1, 14]) { m.box(x, 0, 0, x + 1, 1, 2, C('#ccc')); m.box(x, 8, 0, x + 1, 9, 2, C('#ccc')); }
  return { m };
};
B.hoop = () => {
  const m = new Vox(12, 14, 30);
  m.box(1, 6, 0, 3, 8, 26, C('#5a5e66'));
  m.box(1, 6, 25, 6, 8, 26, C('#5a5e66'));
  m.box(5, 2, 22, 7, 12, 30, WHITE);
  m.box(5, 5, 24, 7, 9, 27, C('#e85d5d'));
  m.cyl(9.5, 7, 23, 24, 2.6, (x, y) => (Math.hypot(x + 0.5 - 9.5, y + 0.5 - 7) > 1.6 ? C('#f27e3e') : 0));
  return { m };
};
B.goal = () => {
  const m = new Vox(8, 40, 14);
  m.box(0, 0, 0, 1, 1, 14, WHITE); m.box(0, 39, 0, 1, 40, 14, WHITE);
  m.box(0, 0, 13, 1, 40, 14, WHITE);
  m.box(1, 0, 0, 8, 40, 14, (x, y, z) => ((y + z) % 3 === 0 && (x === 7 || z === 13) ? C('#e8e8e8') : 0));
  return { m };
};
B.volleynet = () => {
  const m = new Vox(4, 60, 15);
  m.box(1, 0, 0, 3, 2, 15, WHITE); m.box(1, 58, 0, 3, 60, 15, WHITE);
  m.box(2, 2, 9, 3, 58, 14, (x, y, z) => ((y + z) % 2 === 0 || z === 13 ? WHITE : 0));
  return { m };
};
B.ferris = () => {
  // carousel base (canopy is drawn as a separate spinning model)
  const m = new Vox(64, 64, 6);
  m.cyl(32, 32, 0, 3, 30, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) > 28 ? C('#c8a06a') : C('#e6d2a8')));
  m.cyl(32, 32, 3, 5, 26, (x, y) => (Math.floor(Math.atan2(y - 32, x - 32) * 4) % 2 ? C('#f2c6d8') : C('#fff3d6')));
  m.cyl(32, 32, 0, 6, 3, C('#e8c84a'));
  return { m, carousel: true, lights: [{ x: 32, y: 32, z: 20, r: 150, c: [1.0, 0.7, 0.85], k: 'neon' }] };
};
export function carouselTop() {
  const m = new Vox(64, 64, 30);
  for (let a = 0; a < 8; a++) {
    const x = 32 + Math.cos(a / 8 * Math.PI * 2) * 20, y = 32 + Math.sin(a / 8 * Math.PI * 2) * 20;
    m.box(x - 0.5, y - 0.5, 4, x + 0.5, y + 0.5, 22, C('#e8c84a'));
    const horse = [C('#ffffff'), C('#f2c6d8'), C('#c6e2f2'), C('#f2e6a8')][a % 4];
    const hz = 8 + (a % 2) * 3;
    m.box(x - 3, y - 1.5, hz, x + 3, y + 1.5, hz + 4, horse);
    m.box(x + 2, y - 1, hz + 3, x + 4, y + 1, hz + 7, horse);
  }
  m.cyl(32, 32, 4, 24, 4, C('#d8402f'));
  for (let z = 22; z < 30; z++) {
    const r = 30 - (z - 22) * 3.6;
    m.cyl(32, 32, z, z + 1, r, (x, y) => {
      const a = Math.atan2(y + 0.5 - 32, x + 0.5 - 32);
      const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
      if (z === 22 && d > r - 1.5 && Math.floor(a * 12) % 2 === 0) return C('#fff2a8');
      return Math.floor((a + Math.PI) / (Math.PI / 8)) % 2 ? C('#e85d5d') : C('#fff3d6');
    }, z === 22 ? EM.NIGHT : 0);
  }
  m.cyl(32, 32, 29, 30, 2, C('#e8c84a'));
  return m;
}
B.chimney = () => {
  const m = new Vox(7, 7, 10);
  m.box(0, 0, 0, 7, 7, 9, (x, y, z) => ((z % 3 === 2) || ((x + (z % 6 < 3 ? 0 : 2)) % 4 === 3) ? C('#8a4a3a') : C('#a85a46')));
  m.box(0, 0, 9, 7, 7, 10, C('#6a6a70'));
  m.box(2, 2, 9, 5, 5, 10, C('#1a1a1e'));
  return { m, smoke: { x: 3.5, y: 3.5, z: 10 } };
};
B.polesign = () => {
  const m = new Vox(20, 8, 44);
  m.box(9, 3, 0, 11, 5, 36, C('#5a5e66'));
  m.box(0, 2, 34, 20, 6, 44, (x, y, z) => (x === 0 || x === 19 || z === 34 || z === 43 ? C('#2a2a30') : C('#d8402f')));
  m.box(2, 2, 37, 18, 3, 41, C('#ffffff'), EM.NIGHT);
  return { m, lights: [{ x: 10, y: 4, z: 40, r: 60, c: [1.0, 0.35, 0.25], k: 'neon' }] };
};
B.heli = (v) => {
  const m = new Vox(44, 44, 1);
  m.cyl(22, 22, 0, 1, 20, (x, y) => {
    const d = Math.hypot(x + 0.5 - 22, y + 0.5 - 22);
    if (d > 18) return v ? C('#e8e8e8') : C('#f2c14e');
    const lx = x - 22, ly = y - 22;
    if (v) { if ((Math.abs(lx) < 2 && Math.abs(ly) < 9) || (Math.abs(ly) < 2 && Math.abs(lx) < 9)) return C('#e04040'); }
    else if ((Math.abs(lx + 5) < 1.5 || Math.abs(lx - 5) < 1.5) && Math.abs(ly) < 8 || (Math.abs(ly) < 1.5 && Math.abs(lx) < 5)) return C('#f2f2f2');
    return C('#4a4d55');
  });
  return { m, flat: true };
};
B.flagpole = (v) => {
  const m = new Vox(18, 6, 46);
  m.box(1, 2, 0, 3, 4, 46, C('#cfd3d8'));
  const cols = v ? ['#3a5fb0', '#ffffff', '#3a5fb0'] : ['#3c9c66', '#f2e6c8', '#3c9c66'];
  m.box(3, 2, 34, 17, 4, 44, (x, y, z) => C(cols[Math.floor((z - 34) / 3.4)]));
  return { m };
};
B.well = () => {
  const m = new Vox(18, 18, 20);
  m.cyl(9, 9, 0, 6, 8, (x, y) => (Math.hypot(x + 0.5 - 9, y + 0.5 - 9) > 5.5 ? STONE : 0));
  m.cyl(9, 9, 0, 2, 5.5, C('#2a4a6a'));
  m.box(2, 8, 6, 3, 10, 16, WOOD); m.box(15, 8, 6, 16, 10, 16, WOOD);
  for (let z = 16; z < 20; z++) m.box(1, 2 + (z - 16) * 1.5, z, 17, 16 - (z - 16) * 1.5, z + 1, C('#8a4a3a'));
  return { m, canopyZ: 15 };
};
B.gazebo = () => {
  const m = new Vox(54, 54, 30);
  m.cyl(27, 27, 0, 2, 25, C('#e8dcc4'));
  for (let a = 0; a < 8; a++) {
    const x = 27 + Math.cos(a / 8 * Math.PI * 2) * 22, y = 27 + Math.sin(a / 8 * Math.PI * 2) * 22;
    m.box(x - 1, y - 1, 2, x + 1, y + 1, 18, WHITE);
  }
  for (let z = 18; z < 30; z++) m.cyl(27, 27, z, z + 1, 26 - (z - 18) * 2.1, (x, y) => (Math.floor((Math.atan2(y - 27, x - 27) + Math.PI) / (Math.PI / 4)) % 2 ? C('#3f7f7a') : C('#4f8f8a')));
  return { m, step: 2, canopyZ: 16, lights: [{ x: 27, y: 27, z: 16, r: 70, c: [1.0, 0.8, 0.5], k: 'street' }] };
};
B.crane = () => {
  const m = new Vox(90, 26, 96);
  const Y = C('#e8b23a'), Y2 = C('#c99528');
  for (const [x, y] of [[1, 1], [22, 1], [1, 23], [22, 23]]) m.box(x, y, 0, x + 3, y + 2, 70, (xx, yy, z) => (z % 8 < 1 ? Y2 : Y));
  for (let z = 10; z < 70; z += 14) { m.box(1, 1, z, 25, 3, z + 2, Y2); m.box(1, 23, z, 25, 25, z + 2, Y2); }
  m.box(0, 0, 70, 26, 26, 76, Y);
  m.box(4, 6, 76, 20, 20, 84, C('#f2f2f2'));
  m.box(5, 7, 84, 19, 19, 85, C('#d8402f'));
  m.box(20, 9, 72, 90, 17, 75, (x) => (x % 6 < 1 ? Y2 : Y));
  m.box(-10, 9, 72, 0, 17, 75, Y);
  m.box(70, 11, 66, 74, 15, 72, C('#5a5e66'));
  return { m, step: 3, lights: [{ x: 12, y: 13, z: 85, r: 30, c: [1.0, 0.2, 0.1], k: 'blink' }] };
};
B.tank = () => {
  const m = new Vox(62, 62, 36);
  m.cyl(31, 31, 0, 33, 29, (x, y, z) => (z % 8 === 0 ? C('#c8ccd2') : C('#e2e5e8')));
  for (let z = 33; z < 36; z++) m.cyl(31, 31, z, z + 1, 29 - (z - 33) * 5, C('#b8bcc2'));
  return { m, step: 3 };
};
B.beachball = (v) => {
  const m = new Vox(6, 6, 6);
  m.ell(3, 3, 3, 2.8, 2.8, 2.8, (x, y) => C([['#e85d5d', '#ffffff', '#3d8fd6', '#f2c14e'][(Math.floor(Math.atan2(y - 3, x - 3) * 1.3) + 8 + v) % 4]][0]));
  return { m };
};
B.lilypad = (v) => {
  const m = new Vox(8, 8, 1);
  m.cyl(4, 4, 0, 1, 3.5, (x, y) => (Math.abs(x - 4) < 1 && y < 4 ? 0 : C('#4f9a46')));
  if (v === 1) m.set(4, 5, 0, C('#ffd0e0'));
  return { m, flat: true };
};
B.reeds = (v) => {
  const m = new Vox(8, 8, 12);
  const rr = new RNG(v + 3);
  for (let i = 0; i < 7; i++) {
    const x = rr.int(1, 6), y = rr.int(1, 6), h = rr.int(6, 11);
    m.box(x, y, 0, x + 1, y + 1, h, C('#6a9a3c'));
    if (i % 2) m.box(x, y, h - 3, x + 1, y + 1, h, C('#7a4a2a'));
  }
  return { m };
};
B.stump = () => {
  const m = new Vox(10, 10, 5);
  m.cyl(5, 5, 0, 5, 4, (x, y, z) => (z === 4 ? (Math.floor(Math.hypot(x + 0.5 - 5, y + 0.5 - 5)) % 2 ? C('#c8a06a') : C('#a8804a')) : C('#6b4a2f')));
  return { m };
};
B.mushroom = (v) => {
  const m = new Vox(8, 8, 6);
  for (const [x, y, s] of [[3, 3, 1], [6, 5, 0.7]]) {
    m.box(x, y, 0, x + 1, y + 1, 3, WHITE);
    m.ell(x + 0.5, y + 0.5, 3.5, 2.2 * s, 2.2 * s, 1.4, (xx, yy) => ((xx + yy) % 3 === 0 ? WHITE : v ? C('#c8a06a') : RED));
  }
  return { m };
};
B.sign = () => {
  const m = new Vox(10, 4, 18);
  m.box(4, 1, 0, 6, 3, 14, C('#5a5e66'));
  m.box(0, 1, 12, 10, 3, 18, C('#3d8a5a'));
  return { m };
};

export const PROP_BUILDERS = B;
export { mix };
