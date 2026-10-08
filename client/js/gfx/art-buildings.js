import { Img, hex, mulc, mixc, pnoise, bayer } from './img.js';
import { hash2, RNG } from '/shared/rng.js';
import { BSTYLE, BSTYLE_COUNT } from '/shared/constants.js';

// Wall atlas: one 128x128 layer per building style, 8x8 cells of 16x16.
// Alpha encodes material: 255 paint (tinted by wall colour), 220 fixed detail,
// 180 glass (reflective, lights up at night), 150 always-emissive, 120 shingle (tinted by roof colour).
export const M = { PAINT: 255, FIXED: 220, GLASS: 180, EMIT: 150, ROOF: 120, TRIM: 200 };
export const WALL_LAYER_SIGNS = BSTYLE_COUNT;
export const WALL_LAYERS = BSTYLE_COUNT + 1;

export const WALL_COLORS = (() => {
  const c = new Array(80).fill('#d0c8bc');
  ['#ddd3c4', '#c7bcac', '#bcc5cc', '#a9b6c1', '#d9c6a8', '#cdae92', '#e6e0d3', '#a3acb4', '#d1bca4', '#bcac9c'].forEach((v, i) => (c[i] = v));
  ['#c4704f', '#b75a43', '#d39062', '#e3b98f', '#cfa47e', '#ab5e48', '#dcc49f', '#94533f'].forEach((v, i) => (c[10 + i] = v));
  ['#f4e4c5', '#d2e6da', '#f3d3c7', '#dadcf2', '#f6eed3', '#e8d4ea', '#d0e6f0', '#f2dfb8', '#e2eacc', '#fbfaf5'].forEach((v, i) => (c[20 + i] = v));
  ['#8d9da1', '#a79273', '#738d7d', '#9d806d', '#80909f', '#b6ad9a'].forEach((v, i) => (c[30 + i] = v));
  ['#8e603e', '#7c5336', '#9f6e47', '#6f4c32'].forEach((v, i) => (c[40 + i] = v));
  c[50] = '#ebe3d2'; c[51] = '#f6f6f2'; c[52] = '#e2e9f1';
  c[60] = '#ececec'; c[61] = '#f2e8d4'; c[62] = '#f4d670';
  ['#a3dbea', '#f8cacb', '#fff3ad', '#bce8b4', '#dccaf2', '#ffd9a8'].forEach((v, i) => (c[70 + i] = v));
  return c;
})();
export const CONTAINER_COLORS = ['#c2463b', '#3170b8', '#e29d2e', '#41a05d', '#8d52b3', '#dcdcd2', '#2ca3a3', '#bb5f2c'];
export const ROOF_COLORS = ['#b8523d', '#7f503b', '#5d6d80', '#607f50', '#4c4c55', '#cc764b', '#6d8292', '#41827c', '#8e8a83', '#7a8086', '#a69d8d', '#80878c'];
export const FLAT_ROOF = ['#9d978e', '#8c9196', '#a59c8c', '#80868b'];
export const AWNING_COLORS = ['#d84a4a', '#407ed1', '#3c9c66', '#f2b63e', '#8c5ecb', '#e281b5', '#2c9f9f', '#f27e3e'];
export const SHIP_COLORS = ['#7d2a2a', '#1f3b5c', '#2c4a2c', '#3a3a44'];

const N = (x, y, s) => (hash2(x, y, s) - 0.5);

function cell(img, cx, cy, fn) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = fn(x, y);
    if (!r) continue;
    img.set(cx * 16 + x, cy * 16 + y, r, r[3] ?? 255);
  }
}
const P = (v, a = M.PAINT) => [v, v, v, a];
const F = (c, a = M.FIXED) => { const h = hex(c); return [h[0], h[1], h[2], a]; };
const G = (c) => F(c, M.GLASS);

// Paint texture backgrounds
const plaster = (s) => (x, y) => P(222 + N(x, y, s) * 18);
const siding = (s) => (x, y) => P((y % 4 === 3 ? 176 : y % 4 === 0 ? 236 : 220) + N(x, y, s) * 10);
const brick = (s) => (x, y) => {
  const row = Math.floor(y / 3), off = (row % 2) * 3;
  if (y % 3 === 2 || (x + off) % 6 === 5) return P(150);
  return P(214 + N(Math.floor((x + off) / 6), row, s) * 40 + N(x, y, s + 1) * 8);
};
const panel = (s) => (x, y) => (x === 15 || y === 15 ? P(170) : P(214 + N(x, y, s) * 10));
const corrugated = (s) => (x, y) => P((x % 3 === 0 ? 168 : x % 3 === 1 ? 236 : 210) + N(x, y, s) * 6);
const logs = (s) => (x, y) => {
  const ly = y % 4;
  if (ly === 3) return P(110);
  return P((ly === 0 ? 236 : ly === 1 ? 215 : 190) + N(x, Math.floor(y / 4), s) * 14);
};
const vplanks = (s) => (x, y) => (x % 4 === 3 ? P(160) : P(226 + N(Math.floor(x / 4), 0, s) * 20 + N(x, y, s) * 8));
const stone = (s) => (x, y) => {
  const row = Math.floor(y / 4), off = (row % 2) * 4;
  if (y % 4 === 3 || (x + off) % 8 === 7) return P(178);
  return P(226 + N(Math.floor((x + off) / 8), row, s) * 14);
};

// Window drawing: frame (fixed), glass, optional sill/shutters/flowerbox.
function windowCell(bg, o = {}) {
  const x0 = o.x0 ?? 4, x1 = o.x1 ?? 11, y0 = o.y0 ?? 3, y1 = o.y1 ?? 11;
  const frame = o.frame ?? '#f2efe8';
  const glass = o.glass ?? '#4a6a8a';
  return (x, y) => {
    if (o.shutter && y >= y0 && y <= y1 && (x === x0 - 2 || x === x0 - 1 || x === x1 + 1 || x === x1 + 2)) {
      return F(mixc(hex(o.shutter), [0, 0, 0], (y - y0) % 2 ? 0.15 : 0));
    }
    if (o.flowers && y === y1 + 1 && x >= x0 - 1 && x <= x1 + 1) return F('#7a4a2a');
    if (o.flowers && y === y1 && x >= x0 - 1 && x <= x1 + 1 && (x + y) % 2 === 0) return F(['#ff6f91', '#ffd166', '#ffffff', '#c493ff'][(x * 7) % 4]);
    if (o.arch && y === y0 && (x === x0 || x === x1)) return bg(x, y);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (edge) return F(frame, M.TRIM);
      if (o.mullionX && x === Math.floor((x0 + x1) / 2)) return F(frame, M.TRIM);
      if (o.mullionY && y === Math.floor((y0 + y1) / 2)) return F(frame, M.TRIM);
      if (o.curtain && (x === x0 + 1 || x === x1 - 1)) return F(o.curtain, M.GLASS);
      return G(glass);
    }
    if (o.sill && y === y1 + 1 && x >= x0 - 1 && x <= x1 + 1) return F('#d8d4cc', M.TRIM);
    if (o.lintel && y === y0 - 1 && x >= x0 - 1 && x <= x1 + 1) return P(190);
    return bg(x, y);
  };
}

function doorCell(bg, o = {}) {
  const x0 = o.x0 ?? 4, x1 = o.x1 ?? 11, y0 = o.y0 ?? 3;
  const col = o.color ?? '#7a4a2e';
  return (x, y) => {
    if (x >= x0 && x <= x1 && y >= y0) {
      if (x === x0 || x === x1 || y === y0) return F(o.frame ?? '#e8e2d6', M.TRIM);
      if (o.glass && y < 11) return G('#56789a');
      if (o.double && x === Math.floor((x0 + x1) / 2)) return F(mulc(hex(col), 0.7));
      if (x === x1 - 2 && y === 10) return F('#e8c860');
      return F(mulc(hex(col), 1 + N(x, y, 3) * 0.08 + (y % 4 === 0 ? -0.08 : 0)));
    }
    if (o.step && y === 15) return F('#a8a39a');
    if (o.lamp && y === y0 - 2 && (x === x0 - 2 || x === x1 + 2)) return F('#ffe9a0', M.EMIT);
    return bg(x, y);
  };
}

function shopWindow(bg, o = {}) {
  const items = o.items ?? ['#e0605a', '#f2c14e', '#6fbf5a', '#53b3d6'];
  return (x, y) => {
    if (y <= 1) return F(o.band ?? '#3a3a42', M.TRIM);
    if (x === 0 || x === 15) return F('#2e2e34', M.TRIM);
    if (y >= 3 && y <= 13) {
      if (y === 13) return F('#cfc9be', M.TRIM);
      if (y >= 10 && y <= 12 && x > 1 && x < 14 && (x + Math.floor(y / 2)) % 3 !== 0) return F(items[(x + y) % items.length], M.GLASS);
      return G(o.glass ?? '#6d8fae');
    }
    if (y === 2) return F('#2e2e34', M.TRIM);
    return F('#55555e', M.TRIM);
  };
}

function garageDoor(o = {}) {
  return (x, y) => {
    if (y < 2) return P(200);
    if (x === 0 || x === 15) return F('#4a4a50', M.TRIM);
    const c = o.color ?? '#e6e2da';
    return F(mulc(hex(c), (y % 3 === 0 ? 0.82 : 1) + N(x, y, 9) * 0.05), o.paint ? M.PAINT : M.FIXED);
  };
}

function signBand(bg) {
  return (x, y) => (y >= 4 && y <= 10 ? F('#2a2a33', M.TRIM) : bg(x, y));
}

function ribbon(bg, glass = '#5a7b99') {
  return (x, y) => {
    if (y >= 4 && y <= 12) {
      if (y === 4 || y === 12) return F('#d9d7d0', M.TRIM);
      if (x % 8 === 0) return F('#3d4249', M.TRIM);
      return G(glass);
    }
    return bg(x, y);
  };
}

function curtainWall(tint = '#4f7ea6') {
  return (x, y) => {
    if (x % 8 === 0 || y === 0) return F('#2b3640', M.TRIM);
    if (y === 15) return F('#6f8090', M.TRIM);
    const t = y / 15;
    return G(mixc(hex(tint), hex('#a9cbe6'), t * 0.35));
  };
}

function towerGrid(bg) {
  return (x, y) => {
    if (x >= 2 && x <= 13 && y >= 2 && y <= 13) {
      if (x === 7 || x === 8) return F('#c9c6be', M.TRIM);
      if (y === 2 || y === 13) return F('#bdb9b0', M.TRIM);
      return G('#4c6d8e');
    }
    return bg(x, y);
  };
}

function balcony(bg) {
  const w = windowCell(bg, { x0: 3, x1: 12, y0: 2, y1: 12, mullionX: true });
  return (x, y) => {
    if (y >= 10 && y <= 14 && x >= 1 && x <= 14) {
      if (y === 10 || y === 14) return F('#3c3c44', M.TRIM);
      if (x % 2 === 0) return F('#3c3c44', M.TRIM);
    }
    return w(x, y);
  };
}

function porthole(bg) {
  return (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 2.6) return G('#38506a');
    if (d < 3.6) return F('#c9c4b8', M.TRIM);
    return bg(x, y);
  };
}

function hullBg(s) {
  return (x, y) => (y < 3 ? F('#1d1d22', M.FIXED) : y > 13 ? F('#7a1f1f', M.FIXED) : P(200 + N(x, y, s) * 10));
}

function roofGravel(img, rx, ry, s, w = 32, h = 32) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = pnoise(x / 4, y / 4, w / 4, s) * 0.12 + N(x, y, s) * 0.16;
    img.set(rx + x, ry + y, [205 + n * 120, 205 + n * 120, 205 + n * 120], M.PAINT);
  }
}
function roofTiles(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = x % 8 === 0 || y % 8 === 0 ? 170 : 215 + N(Math.floor(x / 8), Math.floor(y / 8), s) * 18 + N(x, y, s) * 6;
    img.set(rx + x, ry + y, [v, v, v], M.PAINT);
  }
}
function shingles(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const row = Math.floor(y / 4), off = (row % 2) * 3;
    const ly = y % 4, lx = (x + off) % 6;
    let v = 220 - ly * 14 + N(Math.floor((x + off) / 6), row, s) * 26;
    if (lx === 0) v -= 40;
    if (ly === 3) v -= 30;
    img.set(rx + x, ry + y, [v, v, v], M.ROOF);
  }
}
function metalRoof(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = (x % 4 === 0 ? 170 : x % 4 === 1 ? 236 : 212) + N(x, y, s) * 6;
    img.set(rx + x, ry + y, [v, v, v], M.ROOF);
  }
}
function greenRoof(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = pnoise(x / 4, y / 4, 8, s);
    const c = n > 0.55 ? '#6cb553' : n > 0.4 ? '#5aa34a' : '#4b8f41';
    img.set(rx + x, ry + y, hex(c), M.FIXED);
  }
}
function containerRoof(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = (y % 3 === 0 ? 176 : 224) + N(x, y, s) * 6;
    img.set(rx + x, ry + y, [v, v, v], M.PAINT);
  }
}
function deck(img, rx, ry, s) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const v = (x % 5 === 0 ? 0.75 : 1) * (0.95 + N(x, y, s) * 0.1);
    img.set(rx + x, ry + y, mulc(hex('#8f7a5e'), v), M.FIXED);
  }
}

// Standard layout for a style: row0 upper floors, row1 ground floor, row2 doors, rows 4-5 roof.
function buildStyle(id) {
  const img = new Img(128, 128);
  const s = id * 31 + 7;
  let bg = plaster(s);
  const upper = [], ground = [], doors = [];
  let roof = (im) => roofGravel(im, 0, 64, s);
  let roof2 = (im) => roofTiles(im, 32, 64, s);
  switch (id) {
    case BSTYLE.HOUSE:
      bg = siding(s);
      upper.push(windowCell(bg, { shutter: '#5a7a9a', sill: true, mullionX: true, mullionY: true, curtain: '#f2e3c4' }));
      upper.push(windowCell(bg, { shutter: '#9a5a4a', sill: true, mullionY: true, flowers: true }));
      upper.push(windowCell(bg, { x0: 3, x1: 12, sill: true, mullionX: true, curtain: '#f6d1d1' }));
      upper.push(bg);
      ground.push(...upper, bg);
      doors.push(doorCell(bg, { color: '#6c8fae', glass: false, lamp: true }), doorCell(bg, { color: '#b5523d', lamp: true }), garageDoor(), garageDoor());
      break;
    case BSTYLE.APARTMENT:
    case BSTYLE.SHOP:
    case BSTYLE.KIOSK:
      bg = id === BSTYLE.APARTMENT ? brick(s) : plaster(s);
      upper.push(windowCell(bg, { sill: true, lintel: true, mullionX: true, curtain: '#e8d7b0' }));
      upper.push(windowCell(bg, { sill: true, lintel: true, mullionY: true }));
      upper.push(balcony(bg));
      upper.push(windowCell(bg, { sill: true, lintel: true, flowers: true, mullionX: true }));
      upper.push(windowCell(bg, { x0: 5, x1: 10, sill: true, lintel: true }));
      ground.push(shopWindow(bg), shopWindow(bg, { items: ['#ffffff', '#d64545', '#f6cf57'] }), shopWindow(bg, { items: ['#7d5ec9', '#e07fb3', '#79c267'], band: '#5a2e2e' }), shopWindow(bg, { glass: '#7a9cb8' }));
      if (id === BSTYLE.APARTMENT) ground.splice(0, 4, windowCell(bg, { sill: true }), windowCell(bg, { sill: true, mullionX: true }), bg);
      doors.push(doorCell(bg, { glass: true, color: '#3a3a42', step: true }), doorCell(bg, { glass: true, double: true, color: '#2c4a3a' }), garageDoor({ color: '#8a8f96' }), garageDoor({ color: '#8a8f96' }));
      break;
    case BSTYLE.OFFICE:
      bg = panel(s);
      upper.push(ribbon(bg), ribbon(bg, '#4d7090'), ribbon(bg));
      ground.push(curtainWall('#5b7d99'), curtainWall('#5b7d99'));
      doors.push(doorCell(bg, { glass: true, double: true, x0: 2, x1: 13, color: '#30343a', frame: '#9aa3ab' }));
      break;
    case BSTYLE.TOWER:
      bg = stone(s);
      upper.push(towerGrid(bg), towerGrid(bg), windowCell(bg, { x0: 3, x1: 12, y0: 2, y1: 13, mullionX: true, glass: '#476985' }));
      ground.push(curtainWall('#53748f'));
      doors.push(doorCell(bg, { glass: true, double: true, x0: 2, x1: 13, color: '#30343a', frame: '#c8b88a' }));
      roof = (im) => roofTiles(im, 0, 64, s);
      break;
    case BSTYLE.GLASS:
      bg = curtainWall('#4a7aa3');
      upper.push(curtainWall('#4a7aa3'), curtainWall('#4677a0'), curtainWall('#5283ac'));
      ground.push(curtainWall('#3f6a8f'));
      doors.push(doorCell(bg, { glass: true, double: true, x0: 2, x1: 13, color: '#30343a', frame: '#9aa3ab' }));
      break;
    case BSTYLE.BRICK:
      bg = brick(s);
      upper.push(windowCell(bg, { arch: true, sill: true, flowers: true, mullionX: true }));
      upper.push(windowCell(bg, { arch: true, sill: true, mullionX: true, mullionY: true, curtain: '#f2c6a0' }));
      upper.push(windowCell(bg, { arch: true, sill: true, shutter: '#3f6f5a' }));
      upper.push(windowCell(bg, { arch: true, sill: true, x0: 5, x1: 10 }));
      ground.push(shopWindow(bg, { band: '#2f4a3a' }), windowCell(bg, { arch: true, sill: true }), shopWindow(bg, { band: '#5a2e2e', items: ['#f6cf57', '#ffffff'] }));
      doors.push(doorCell(bg, { color: '#5a3a28', step: true, lamp: true }), doorCell(bg, { color: '#2f4a3a', glass: true }));
      break;
    case BSTYLE.WAREHOUSE:
      bg = corrugated(s);
      upper.push(bg, (x, y) => (y >= 5 && y <= 8 && x >= 2 && x <= 13 ? (y === 5 || y === 8 ? F('#3a3a40', M.TRIM) : G('#6d8796')) : bg(x, y)), bg);
      ground.push(bg, bg);
      doors.push(garageDoor({ color: '#c9b04a' }), garageDoor({ color: '#c9b04a' }), doorCell(bg, { color: '#4a5a6a' }));
      roof2 = (im) => metalRoof(im, 32, 64, s);
      break;
    case BSTYLE.CABIN:
      bg = logs(s);
      upper.push(windowCell(bg, { x0: 5, x1: 10, y0: 4, y1: 10, frame: '#5e3e26', shutter: '#3f6f5a', flowers: true, mullionX: true }), bg);
      ground.push(...upper);
      doors.push(doorCell(bg, { color: '#5a3a24', frame: '#4a2e1c', lamp: true }));
      break;
    case BSTYLE.CIVIC:
      bg = stone(s);
      upper.push((x, y) => {
        if (x <= 2 || x >= 13) return P(x === 1 || x === 14 ? 246 : 226);
        return windowCell(bg, { x0: 5, x1: 10, y0: 2, y1: 13, arch: true, mullionX: true, mullionY: true, glass: '#3f5f7f' })(x, y);
      });
      ground.push(upper[0]);
      doors.push(doorCell(bg, { color: '#5a3a28', double: true, x0: 3, x1: 12, y0: 1, frame: '#e8dfc8' }));
      break;
    case BSTYLE.CLINIC:
      bg = panel(s);
      upper.push(ribbon(bg, '#6a9cc0'), windowCell(bg, { x0: 3, x1: 12, glass: '#6a9cc0', frame: '#e8eef2' }));
      ground.push(curtainWall('#7aaccc'));
      doors.push(doorCell(bg, { glass: true, double: true, x0: 2, x1: 13, color: '#30343a', frame: '#d8e0e6' }));
      break;
    case BSTYLE.POLICE:
      bg = panel(s);
      upper.push(windowCell(bg, { x0: 3, x1: 12, glass: '#3d5f85', frame: '#2b3f66', mullionX: true }), (x, y) => (y >= 12 ? F('#2b4b8a', M.TRIM) : windowCell(bg, { glass: '#3d5f85', frame: '#2b3f66' })(x, y)));
      ground.push(windowCell(bg, { glass: '#3d5f85', frame: '#2b3f66', sill: true }));
      doors.push(doorCell(bg, { glass: true, double: true, x0: 3, x1: 12, color: '#2b3f66', frame: '#c8d0dc', lamp: true }));
      break;
    case BSTYLE.GARAGE:
      bg = brick(s);
      upper.push(windowCell(bg, { sill: true, mullionX: true }), signBand(bg));
      ground.push(garageDoor({ color: '#d7d2c6' }), garageDoor({ color: '#d7d2c6' }));
      doors.push(doorCell(bg, { color: '#3a3a42', glass: true }), garageDoor({ color: '#c94a3a' }));
      break;
    case BSTYLE.LIGHTHOUSE:
      bg = (x, y) => (Math.floor(y / 8) % 2 ? F('#c9302c', M.FIXED) : P(236 + N(x, y, s) * 8));
      upper.push(bg, (x, y) => (x >= 6 && x <= 9 && y >= 5 && y <= 10 ? (x === 6 || x === 9 || y === 5 ? F('#2a2a30', M.TRIM) : G('#3f5f7f')) : bg(x, y)));
      ground.push(bg);
      doors.push(doorCell(bg, { color: '#2a3a4a', y0: 4 }));
      break;
    case BSTYLE.CONTAINER:
      bg = corrugated(s);
      upper.push(bg);
      ground.push(bg);
      doors.push((x, y) => (x === 7 || x === 8 ? F('#3a3a40', M.TRIM) : (y === 4 || y === 11) && (x === 5 || x === 10) ? F('#b0b0b0', M.TRIM) : bg(x, y)));
      roof = (im) => containerRoof(im, 0, 64, s);
      break;
    case BSTYLE.SHIP:
      bg = hullBg(s);
      upper.push(porthole(bg), bg, bg);
      ground.push(bg);
      doors.push(bg);
      roof = (im) => deck(im, 0, 64, s);
      break;
    case BSTYLE.CANOPY:
      bg = (x, y) => (y < 8 ? F('#d8402f', M.FIXED) : P(236));
      upper.push(bg); ground.push(bg); doors.push(bg);
      roof = (im) => metalRoof(im, 0, 64, s);
      break;
    case BSTYLE.PARKADE:
      bg = (x, y) => (y >= 5 && y <= 13 ? F('#1d1d22', M.FIXED) : P(206 + N(x, y, s) * 8));
      upper.push(bg); ground.push(bg); doors.push(bg);
      break;
    case BSTYLE.BEACHHUT:
      bg = vplanks(s);
      upper.push(windowCell(bg, { x0: 4, x1: 11, y0: 3, y1: 9, frame: '#ffffff', shutter: '#ffffff', glass: '#4a6a8a' }), bg);
      ground.push(...upper, (x, y) => (y >= 2 && y <= 10 && x >= 1 && x <= 14 ? (y === 2 || y === 10 ? F('#ffffff', M.TRIM) : F('#2d2d33', M.FIXED)) : bg(x, y)));
      doors.push(doorCell(bg, { color: '#ffffff', frame: '#e8e8e8' }));
      break;
    default:
      upper.push(windowCell(bg, {}));
      ground.push(windowCell(bg, {}));
      doors.push(doorCell(bg, {}));
  }
  const fill = (row, arr) => { for (let i = 0; i < 8; i++) cell(img, i, row, arr[i % arr.length]); };
  fill(0, upper);
  fill(1, ground);
  fill(2, doors);
  // row 3: plain background (for gable ends / side walls)
  fill(3, [bg]);
  roof(img);
  roof2(img);
  shingles(img, 64, 64, s);
  greenRoof(img, 96, 64, s);
  metalRoof(img, 0, 96, s + 1);
  roofTiles(img, 32, 96, s + 2);
  deck(img, 64, 96, s + 3);
  roofGravel(img, 96, 96, s + 4);
  // cells per style for the shader: counts of usable variants
  return { img, counts: [upper.length, ground.length, doors.length] };
}

// Sign icons: 16x16 cells, emissive-ready (alpha EMIT for lit parts, FIXED for board).
const SIGN_KEYS = ['gunshop', 'clothes', 'respray', 'pizza', 'taxi', 'clinic', 'police', 'cafe', 'gas', 'dealer', 'arcade', 'diner', 'hotel', 'cityhall'];
export const SIGN_INDEX = Object.fromEntries(SIGN_KEYS.map((k, i) => [k, i]));

const ICONS = {
  gunshop: ['................', '................', '..#########.....', '..##########....', '..###.......#...', '..###...........', '..###...........', '...##...........', '................'],
  clothes: ['.....#....#.....', '....##....##....', '...##########...', '..############..', '..###.####.###..', '.....######.....', '.....######.....', '.....######.....', '.....######.....'],
  respray: ['....#####.......', '....#####.......', '.....###........', '.....###...#.#..', '....#####..##.#.', '....#####.#.##..', '....#####.......', '....#####.......', '................'],
  pizza: ['......####......', '....###..###....', '...#.#.##.#.#...', '...##.####.##...', '....##.##.##....', '.....######.....', '......####......', '.......##.......', '................'],
  taxi: ['......###.......', '...#########....', '..##..###..##...', '.#############..', '.#############..', '..##.......##...', '..##.......##...', '................', '................'],
  clinic: ['......####......', '......####......', '...##########...', '...##########...', '......####......', '......####......', '................', '................', '................'],
  police: ['.......##.......', '......####......', '.##############.', '...##########...', '....########....', '...####..####...', '..###......###..', '................', '................'],
  cafe: ['.....#..#.......', '......#..#......', '..##########....', '..##########.##.', '..##########..#.', '..##########.##.', '...########.....', '.....####.......', '................'],
  gas: ['..########......', '..#......#.##...', '..#......#..#...', '..########..#...', '..########..#...', '..########.#....', '..########......', '.##########.....', '................'],
  dealer: ['................', '....######......', '...#......#.....', '..##########....', '..##########....', '...##....##.....', '................', '................', '................'],
  arcade: ['....######......', '...#.####.#.....', '...########.....', '...##.##.##.....', '...########.....', '....#....#......', '...##....##.....', '................', '................'],
  diner: ['....######......', '...########.....', '..##########....', '..##########....', '...########.....', '..##########....', '...########.....', '................', '................'],
  hotel: ['................', '..#.............', '..#..######.....', '..##########....', '..##########....', '..#........#....', '..#........#....', '................', '................'],
  cityhall: ['.......#........', '......###.......', '....#######.....', '...#########....', '...#.#.#.#.#....', '...#.#.#.#.#....', '..###########...', '................', '................'],
};
const ICON_COLORS = {
  gunshop: '#ff5a4a', clothes: '#ff86d0', respray: '#7ae1ff', pizza: '#ffb347', taxi: '#ffd84a', clinic: '#ff4a4a', police: '#6aa0ff',
  cafe: '#e9b98a', gas: '#7dff9b', dealer: '#ffe066', arcade: '#c38bff', diner: '#ff7a9c', hotel: '#ffd27a', cityhall: '#fff1c4',
};

function buildSigns() {
  const img = new Img(128, 128);
  SIGN_KEYS.forEach((k, i) => {
    const cx = i % 8, cy = Math.floor(i / 8);
    const icon = ICONS[k];
    const col = hex(ICON_COLORS[k]);
    cell(img, cx, cy, (x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return F('#1c1c22', M.TRIM);
      const iy = y - 3;
      if (iy >= 0 && iy < icon.length && icon[iy][x] === '#') return [col[0], col[1], col[2], M.EMIT];
      return F('#2a2a33', M.FIXED);
    });
  });
  return img;
}

export function makeWallTextures() {
  const layers = [];
  const counts = [];
  for (let id = 0; id < BSTYLE_COUNT; id++) {
    const { img, counts: c } = buildStyle(id);
    layers.push(img);
    counts.push(c);
  }
  layers.push(buildSigns());
  return { layers, counts };
}

void bayer; void RNG;
