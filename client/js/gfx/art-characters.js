import { Vox, rgb, shade, mix } from './voxel.js';
import { SKIN, HAIR_COLORS, CLOTH, TOPS, HAIR_STYLES, HATS, ACCESSORIES } from '/shared/appearance.js';
import { hash2 } from '/shared/rng.js';

// Character model: 24x24 footprint, centre (12,12), facing +x. Split at z=8 into
// lower (legs) and upper (torso, arms, head) stacks so leg and arm poses combine freely.
export const CHAR_SIZE = 24;
export const CHAR_H = 27;
export const SPLIT_Z = 8;
export const LOWER_POSES = ['idle', 'w0', 'w1', 'w2', 'w3', 'sit'];
export const UPPER_POSES = ['idle', 's0', 's1', 's2', 's3', 'pistol', 'smg', 'shotgun', 'rifle', 'rocket', 'grenade', 'bat', 'punch', 'batswing', 'throw', 'ride', 'wave', 'fists'];

const C = (h) => rgb(h);
const GUN = C('#2c2d33'), GUN2 = C('#4a4c55'), WOODC = C('#8a5a36'), OLIVE = C('#5d6b3a');

function limb(m, x0, y0, z0, x1, y1, z1, colFn, thick = 2) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))) * 2 + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
    for (let a = 0; a < thick; a++) for (let b = 0; b < thick; b++) {
      m.set(Math.floor(x - thick / 2 + 0.5) + a, Math.floor(y - thick / 2 + 0.5) + b, Math.round(z), colFn(t, z));
    }
  }
}

export function buildCharacter(app, lower = 'idle', upper = 'idle') {
  const m = new Vox(CHAR_SIZE, CHAR_SIZE, CHAR_H);
  const cx = 12, cy = 12;
  const skin = C(SKIN[app.skin]);
  const top = C(CLOTH[app.topColor]);
  const pants = C(CLOTH[app.pantsColor]);
  const shoes = C(CLOTH[app.shoes]);
  const hair = C(HAIR_COLORS[app.hairColor]);
  const hatC = C(CLOTH[app.hatColor]);
  const accC = C(CLOTH[app.accColor]);
  const topKind = TOPS[app.top];
  const bw = [7, 8, 10][app.body];
  const half = bw / 2;
  const yL = cy - 2, yR = cy + 2;
  const longSleeve = ['hoodie', 'jacket', 'suit', 'sweater', 'raincoat'].includes(topKind);
  const longCoat = topKind === 'raincoat';
  const dress = topKind === 'dress' || app.pants === 2;

  // ---------------- legs
  let lf = 0, rf = 0, sit = false;
  if (lower === 'w0') { lf = 3; rf = -3; }
  else if (lower === 'w2') { lf = -3; rf = 3; }
  else if (lower === 'w1' || lower === 'w3') { lf = 0.5; rf = -0.5; }
  else if (lower === 'sit') sit = true;
  const legCol = (t, z) => {
    if (longCoat && z >= 3) return top;
    if (app.pants === 1 && z < 5) return skin;
    if (dress && z < 4) return skin;
    return topKind === 'overalls' ? pants : pants;
  };
  for (const [ly, off] of [[yL, lf], [yR, rf]]) {
    if (sit) {
      limb(m, cx, ly, 7, cx + 6, ly, 5, legCol);
      m.box(cx + 6, ly - 1, 3, cx + 9, ly + 1, 5, shoes);
    } else {
      limb(m, cx, ly, 7, cx + off, ly, 2, legCol);
      m.box(Math.round(cx + off) - 1, ly - 1, 0, Math.round(cx + off) + 3, ly + 1, 2, (x, y, z) => (z === 1 && x === Math.round(cx + off) + 2 ? shade(shoes, 1.15) : shoes));
    }
  }
  if (dress) {
    for (let z = 3; z < 8; z++) {
      const r = half + 0.8 + (8 - z) * 0.35;
      m.ell(cx, cy, z + 0.5, r * 0.75, r, 0.6, (x, y) => (z === 3 ? shade(app.pants === 2 && topKind !== 'dress' ? pants : top, 0.85) : app.pants === 2 && topKind !== 'dress' ? pants : top));
    }
  }
  if (longCoat) for (let z = 3; z < 8; z++) m.box(cx - 2, cy - half, z, cx + 3, cy + half, z + 1, z === 3 ? shade(top, 0.85) : top);

  // ---------------- torso
  for (let z = 8; z < 14; z++) {
    m.rbox(cx - 2, cy - half, z, cx + 2, cy + half, z + 1, 1, (x, y) => {
      if (topKind === 'overalls') return Math.abs(y + 0.5 - cy) < half - 1.5 && z < 12 ? pants : top;
      if (topKind === 'suit' && x === cx + 1 && Math.abs(y + 0.5 - cy) < 1.5 && z > 9) return y + 0.5 - cy < 0.5 && y + 0.5 - cy > -0.5 ? C('#c43c3c') : C('#f2f0ea');
      if (topKind === 'jacket' && x === cx + 1 && Math.abs(y + 0.5 - cy) < 1) return C('#f2f0ea');
      if (topKind === 'apron' && x === cx + 1 && Math.abs(y + 0.5 - cy) < half - 1) return C('#f6f2ea');
      if (topKind === 'sweater' && z % 2 === 0) return shade(top, 0.85);
      if (topKind === 'tank' && z === 13 && Math.abs(y + 0.5 - cy) > half - 2) return skin;
      return top;
    });
  }
  // neck
  m.box(cx - 1, cy - 1, 13, cx + 1, cy + 1, 14, skin);

  // ---------------- arms
  const shL = [cx, cy - half - 1, 13], shR = [cx, cy + half + 1, 13];
  const armCol = (t, z) => {
    if (topKind === 'tank') return skin;
    if (longSleeve || topKind === 'overalls') return t > 0.88 ? skin : top;
    return t < 0.4 ? top : skin;
  };
  const arm = (sh, hx, hy, hz) => limb(m, sh[0], sh[1], sh[2], hx, hy, hz, armCol);
  const hand = (x, y, z) => m.box(Math.round(x) - 1, Math.round(y) - 1, Math.round(z) - 1, Math.round(x) + 1, Math.round(y) + 1, Math.round(z) + 1, skin);
  const gun = (x0, x1, y, z, col = GUN, h = 1) => m.box(x0, y - 0.5, z, x1, y + 1.5, z + h, col);
  let swing = 0;
  if (upper === 's0') swing = 2.5;
  if (upper === 's2') swing = -2.5;
  switch (upper) {
    case 'pistol':
      arm(shL, cx + swing, shL[1], 8); arm(shR, cx + 7, cy + 2, 11); hand(cx + 7, cy + 2, 11);
      gun(cx + 8, cx + 11, cy + 1.5, 11); gun(cx + 7, cx + 8, cy + 1.5, 10);
      break;
    case 'smg':
      arm(shL, cx + 5, cy - 1, 11); arm(shR, cx + 4, cy + 2, 10); hand(cx + 5, cy - 1, 11); hand(cx + 4, cy + 2, 10);
      gun(cx + 2, cx + 11, cy + 0.5, 11, GUN, 2); gun(cx + 5, cx + 6, cy + 0.5, 9, GUN2);
      break;
    case 'shotgun':
      arm(shL, cx + 7, cy, 11); arm(shR, cx + 2, cy + 2, 11); hand(cx + 7, cy, 11);
      gun(cx - 2, cx + 3, cy + 0.5, 11, WOODC); gun(cx + 3, cx + 13, cy + 0.5, 11, GUN); gun(cx + 6, cx + 9, cy + 0.5, 10, WOODC);
      break;
    case 'rifle':
      arm(shL, cx + 7, cy, 11); arm(shR, cx + 2, cy + 2, 11); hand(cx + 7, cy, 11);
      gun(cx - 2, cx + 14, cy + 0.5, 11, GUN, 2); gun(cx + 4, cx + 6, cy + 0.5, 9, GUN2, 2); gun(cx - 2, cx + 1, cy + 0.5, 12, GUN2);
      break;
    case 'rocket':
      arm(shL, cx + 5, cy + 1, 13); arm(shR, cx + 2, cy + 3, 13);
      m.box(cx - 8, cy + 2, 14, cx + 9, cy + 5, 17, (x) => (x > cx + 7 || x < cx - 6 ? GUN : OLIVE));
      break;
    case 'grenade':
      arm(shL, cx + swing, shL[1], 8); arm(shR, cx + 3, shR[1] + 1, 10); hand(cx + 3, shR[1] + 1, 10);
      m.ell(cx + 4.5, shR[1] + 1, 10, 1.4, 1.4, 1.4, C('#4a6a3a'));
      break;
    case 'throw':
      arm(shL, cx - 1, shL[1], 9); arm(shR, cx + 6, shR[1], 15); hand(cx + 6, shR[1], 15);
      break;
    case 'bat':
      arm(shL, cx + 3, cy + 1, 10); arm(shR, cx + 3, cy + 3, 10); hand(cx + 3, cy + 2, 10);
      limb(m, cx + 3, cy + 3, 10, cx - 4, cy + 7, 21, () => WOODC, 1);
      m.box(cx - 5, cy + 6, 20, cx - 3, cy + 8, 22, WOODC);
      break;
    case 'batswing':
      arm(shL, cx + 6, cy + 2, 11); arm(shR, cx + 6, cy + 4, 11); hand(cx + 6, cy + 3, 11);
      limb(m, cx + 6, cy + 3, 11, cx + 9, cy + 12, 12, () => WOODC, 2);
      break;
    case 'punch':
      arm(shL, cx + 1, shL[1] + 1, 10); hand(cx + 1, shL[1] + 1, 10);
      arm(shR, cx + 9, cy + 2, 12); hand(cx + 9, cy + 2, 12);
      break;
    case 'fists':
      arm(shL, cx + 4, cy - 2, 11); hand(cx + 4, cy - 2, 11);
      arm(shR, cx + 4, cy + 2, 11); hand(cx + 4, cy + 2, 11);
      break;
    case 'ride':
      arm(shL, cx + 7, cy - 3, 10); hand(cx + 7, cy - 3, 10);
      arm(shR, cx + 7, cy + 3, 10); hand(cx + 7, cy + 3, 10);
      break;
    case 'wave':
      arm(shL, cx + swing, shL[1], 8); hand(cx + swing, shL[1], 8);
      arm(shR, cx + 1, shR[1] + 2, 19); hand(cx + 1, shR[1] + 2, 19);
      break;
    default:
      arm(shL, cx + swing, shL[1] - 0.3, 8); hand(cx + swing, shL[1] - 0.3, 8);
      arm(shR, cx - swing, shR[1] + 0.3, 8); hand(cx - swing, shR[1] + 0.3, 8);
  }

  // ---------------- head
  const hx0 = cx - 3, hx1 = cx + 4, hy0 = cy - 3.5, hy1 = cy + 3.5;
  m.rbox(hx0, hy0, 14, hx1, hy1, 21, 1.4, skin);
  // face: eyes, blush
  m.set(hx1 - 1, cy - 2, 17, C('#2a2026')); m.set(hx1 - 1, cy + 1, 17, C('#2a2026'));
  m.set(hx1 - 1, cy - 2, 18, C('#f8f4f0')); m.set(hx1 - 1, cy + 1, 18, C('#f8f4f0'));
  m.set(hx1 - 1, cy - 3, 16, mix(skin, C('#ff8080'), 0.35)); m.set(hx1 - 1, cy + 2, 16, mix(skin, C('#ff8080'), 0.35));
  m.set(hx1 - 1, cy - 1, 15, shade(skin, 0.75)); m.set(hx1 - 1, cy, 15, shade(skin, 0.75));

  // ---------------- hair
  const style = HAIR_STYLES[app.hair];
  const hairCap = (frontTo = hx1 - 2, down = 18) => {
    for (let z = down; z < 22; z++) for (let x = hx0 - 1; x <= hx1; x++) for (let y = Math.floor(hy0) - 1; y <= hy1; y++) {
      const inside = x >= hx0 && x < hx1 && y >= hy0 && y < hy1 && z < 21;
      if (inside) continue;
      const nearHead = x >= hx0 - 1 && x <= hx1 && y >= hy0 - 1 && y <= hy1;
      if (!nearHead) continue;
      if (x > frontTo && z < 20) continue;
      if ((x === hx0 - 1 || x === hx1) && (y === Math.floor(hy0) - 1 || y === Math.ceil(hy1))) continue;
      if (z === 21 && (x === hx0 - 1 || x === hx1 || y === Math.floor(hy0) - 1 || y >= Math.ceil(hy1))) continue;
      m.set(x, y, z, hash2(x, y + z * 5, 7) < 0.25 ? shade(hair, 1.12) : hair);
    }
  };
  switch (style) {
    case 'bald': break;
    case 'buzz': m.box(hx0, hy0, 21, hx1 - 1, hy1, 22, shade(hair, 0.9)); break;
    case 'short': hairCap(); break;
    case 'spiky': hairCap(); for (let i = 0; i < 6; i++) m.box(hx0 + (i % 3) * 2, hy0 + 1 + Math.floor(i / 3) * 3, 22, hx0 + (i % 3) * 2 + 1, hy0 + 2 + Math.floor(i / 3) * 3, 24, hair); break;
    case 'long': hairCap(hx1 - 2, 16); m.box(hx0 - 1, hy0 - 0.5, 9, hx0 + 1, hy1 + 0.5, 20, hair); break;
    case 'ponytail': hairCap(); limb(m, hx0 - 1, cy, 19, hx0 - 5, cy, 13, () => hair, 2); break;
    case 'bun': hairCap(); m.ell(hx0 + 1, cy, 22.5, 2.2, 2.2, 2, shade(hair, 1.05)); break;
    case 'afro': m.ell(cx, cy, 19, 6, 6.5, 5, (x) => (x >= hx1 - 1 ? 0 : hash2(x, cx, 3) < 0.2 ? shade(hair, 1.15) : hair)); break;
    case 'mohawk': m.box(hx0 - 1, cy - 1, 21, hx1 - 1, cy + 1, 24, hair); break;
    case 'curly': hairCap(hx1 - 2, 17); for (let i = 0; i < 14; i++) m.set(hx0 + Math.floor(hash2(i, 1, 9) * 7), Math.floor(hy0 + hash2(i, 2, 9) * 7), 22, hair); break;
    case 'bob': hairCap(hx1 - 2, 15); break;
    case 'pigtails': hairCap(); limb(m, cx - 1, hy0 - 1, 19, cx - 2, hy0 - 4, 13, () => hair, 2); limb(m, cx - 1, hy1 + 1, 19, cx - 2, hy1 + 4, 13, () => hair, 2); break;
  }
  if (topKind === 'hoodie' || topKind === 'raincoat') m.box(hx0 - 2, cy - 3, 13, hx0, cy + 3, 16, shade(top, 0.9));

  // ---------------- hats
  const hat = HATS[app.hat];
  switch (hat) {
    case 'cap': m.rbox(hx0 - 1, hy0 - 0.5, 20, hx1, hy1 + 0.5, 23, 1.5, hatC); m.box(hx1, cy - 3, 20, hx1 + 3, cy + 3, 21, shade(hatC, 0.85)); break;
    case 'beanie': m.ell(cx, cy, 20, 4.4, 4.4, 3.4, (x, y, z) => (z < 19 ? 0 : z === 19 ? shade(hatC, 0.85) : hatC)); m.set(cx, cy, 24, C('#f2f0ea')); break;
    case 'cowboy': m.cyl(cx, cy, 20, 21, 7, shade(hatC, 0.9)); m.rbox(cx - 3, cy - 2.5, 21, cx + 3, cy + 2.5, 25, 1, hatC); break;
    case 'beret': m.cyl(cx - 0.5, cy + 0.5, 21, 22, 4.6, hatC); m.set(cx, cy, 22, shade(hatC, 0.8)); break;
    case 'helmet': m.ell(cx, cy, 18, 5, 5, 4.5, (x, y, z) => (z < 16 ? 0 : x >= hx1 && z < 20 ? C('#2a3440') : hatC)); break;
    case 'crown': for (let a = 0; a < 16; a++) { const x = cx + Math.cos(a / 16 * Math.PI * 2) * 3.5, y = cy + Math.sin(a / 16 * Math.PI * 2) * 3.5; m.set(x, y, 21, C('#f2c14e')); m.set(x, y, 22, C('#f2c14e')); if (a % 4 === 0) m.set(x, y, 23, a % 8 ? C('#e85d5d') : C('#62c3ff')); } break;
    case 'headphones': m.box(cx - 1, hy0 - 1, 21, cx + 1, hy1 + 1, 22, C('#2a2b30')); m.box(cx - 2, hy0 - 2, 16, cx + 2, hy0, 20, hatC); m.box(cx - 2, hy1, 16, cx + 2, hy1 + 2, 20, hatC); break;
    case 'flowers': for (let a = 0; a < 12; a++) m.set(cx + Math.cos(a / 12 * Math.PI * 2) * 4, cy + Math.sin(a / 12 * Math.PI * 2) * 4, 21, C(['#ff6f91', '#ffd166', '#ffffff', '#c493ff'][a % 4])); break;
    case 'tophat': m.cyl(cx, cy, 21, 22, 5, C('#202024')); m.cyl(cx, cy, 22, 27, 3.4, (x, y, z) => (z === 23 ? hatC : C('#202024'))); break;
    case 'bucket': m.cyl(cx, cy, 20, 21, 6, shade(hatC, 0.9)); m.cyl(cx, cy, 21, 24, 4.2, hatC); break;
    case 'bandana': m.box(hx0 - 1, hy0 - 0.5, 19, hx1, hy1 + 0.5, 21, (x, y) => ((x + y) % 3 === 0 ? C('#f2f0ea') : hatC)); m.box(hx0 - 3, cy - 1, 19, hx0 - 1, cy + 1, 20, hatC); break;
  }

  // ---------------- accessories
  const acc = ACCESSORIES[app.acc];
  switch (acc) {
    case 'backpack': m.rbox(cx - 6, cy - 3, 8, cx - 2, cy + 3, 14, 1, accC); m.box(cx - 6, cy - 2, 13, cx - 5, cy + 2, 14, shade(accC, 1.15)); break;
    case 'glasses': m.box(hx1, cy - 3, 17, hx1 + 1, cy + 3, 18, C('#2a2b30')); break;
    case 'sunglasses': m.box(hx1, cy - 3, 17, hx1 + 1, cy + 3, 18, C('#121216')); m.set(hx1, cy - 2, 18, C('#121216')); m.set(hx1, cy + 1, 18, C('#121216')); break;
    case 'scarf': m.rbox(cx - 3, cy - half + 0.5, 13, cx + 3, cy + half - 0.5, 15, 1, accC); m.box(cx - 5, cy + 1, 10, cx - 3, cy + 3, 14, accC); break;
    case 'cape': m.box(cx - 5, cy - half - 1, 4, cx - 3, cy + half + 1, 14, (x, y, z) => (z === 4 ? shade(accC, 0.8) : accC)); break;
    case 'guitar': limb(m, cx - 4, cy - 4, 6, cx - 4, cy + 5, 17, () => C('#2a2020'), 1); m.ell(cx - 4, cy - 3, 8, 1.5, 3, 2.5, accC); break;
  }
  return m;
}

// Knocked-out pose: lie on the back along x (head at +x). Built by rotating a standing
// model around the y axis.
export function buildKO(app) {
  const s = buildCharacter(app, 'idle', 'idle');
  const m = new Vox(CHAR_H + 2, CHAR_SIZE, 8);
  for (let z = 0; z < s.h; z++) for (let y = 0; y < s.d; y++) for (let x = 0; x < s.w; x++) {
    const c = s.get(x, y, z);
    if (!c) continue;
    const nz = x - 8;
    if (nz < 0 || nz >= 8) continue;
    m.set(z + 1, y, nz, c);
  }
  return m;
}
