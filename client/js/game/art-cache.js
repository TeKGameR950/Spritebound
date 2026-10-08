import { buildCharacter, buildKO, SPLIT_Z } from '../gfx/art-characters.js';
import { buildVehicle, burnt } from '../gfx/art-vehicles.js';
import { Vox, rgb, shade, EM } from '../gfx/voxel.js';
import { Img, hex } from '../gfx/img.js';
import { PAINTS, VEHICLES } from '/shared/vehicles.js';
import { APPEARANCE_KEYS, randomAppearance } from '/shared/appearance.js';
import { MAT } from '../gfx/shaders.js';

const C = (h) => rgb(h);

export function copAppearance(seed) {
  const a = randomAppearance(seed);
  return { ...a, top: 4, topColor: 13, pants: 0, pantsColor: 1, shoes: 1, hat: 1, hatColor: 13, acc: 0 };
}

// Lazily builds and caches sprite stacks for characters, vehicles and items.
export class ArtCache {
  constructor(bank) {
    this.bank = bank;
    this.chars = new Map();
    this.particles = null;
  }

  appKey(app) { return APPEARANCE_KEYS.map((k) => app[k]).join('.'); }

  character(app) {
    const key = this.appKey(app);
    let c = this.chars.get(key);
    if (!c) {
      c = { key, app, lower: new Map(), upper: new Map(), ko: null };
      this.chars.set(key, c);
    }
    return c;
  }
  lower(c, pose) {
    let d = c.lower.get(pose);
    if (!d) {
      d = this.bank.fromVox(`cl:${c.key}:${pose}`, buildCharacter(c.app, pose, 'idle'), { zMax: SPLIT_Z, mat: MAT.OBJECT, ao: 0.25 });
      c.lower.set(pose, d);
    }
    return d;
  }
  upper(c, pose) {
    let d = c.upper.get(pose);
    if (!d) {
      d = this.bank.fromVox(`cu:${c.key}:${pose}`, buildCharacter(c.app, 'idle', pose), { zMin: SPLIT_Z, mat: MAT.OBJECT, ao: 0.1 });
      c.upper.set(pose, d);
    }
    return d;
  }
  ko(c) {
    if (!c.ko) c.ko = this.bank.fromVox(`ck:${c.key}`, buildKO(c.app), { mat: MAT.OBJECT, ao: 0.1 });
    return c.ko;
  }

  vehicle(model, color, dead = false) {
    const key = `v:${model}:${color}:${dead ? 1 : 0}`;
    let d = this.bank.get(key);
    if (!d) {
      let m = buildVehicle(model, PAINTS[color % PAINTS.length], color);
      if (dead) m = burnt(m);
      d = this.bank.fromVox(key, m, { mat: MAT.OBJECT, ao: 0.3 });
    }
    return d;
  }

  pickup(kind) {
    const key = `pk:${kind}`;
    const d = this.bank.get(key);
    if (d) return d;
    return this.bank.fromVox(key, pickupVox(kind), { mat: MAT.OBJECT, ao: 0 });
  }

  sprite() {
    const key = 'collectible';
    let d = this.bank.get(key);
    if (d) return d;
    const m = new Vox(12, 12, 14);
    // a little glowing spirit with a leaf on its head
    m.ell(6, 6, 6, 4.6, 4.6, 5, (x, y, z) => (z < 2 ? 0 : C(z > 8 ? '#bff7ff' : '#7fe6ff')), EM.ALWAYS);
    m.set(9, 4, 7, C('#1a2a40')); m.set(9, 7, 7, C('#1a2a40'));
    m.set(9, 4, 8, C('#ffffff')); m.set(9, 7, 8, C('#ffffff'));
    m.box(5, 5, 11, 7, 7, 13, C('#6fdc7f'), EM.ALWAYS);
    m.box(4, 6, 12, 5, 7, 13, C('#a8f0a0'), EM.ALWAYS);
    for (const [x, y] of [[2, 2], [10, 3], [3, 10], [10, 10]]) m.set(x, y, 3, C('#ffffff'), EM.ALWAYS);
    return this.bank.fromVox(key, m, { mat: MAT.UNLIT, ao: 0 });
  }

  // Flat ring markers and arrows for objectives.
  flat(key, size, draw) {
    let d = this.bank.get(key);
    if (d) return d;
    const img = new Img(size, size);
    draw(img, size);
    return this.bank.fromImg(key, img, { mat: MAT.UNLIT });
  }
  ring(color = '#ffd166') {
    return this.flat('ring:' + color, 48, (img, S) => {
      const c = hex(color);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
        if (d < S / 2 - 1 && d > S / 2 - 5) img.set(x, y, c, 255);
        else if (d <= S / 2 - 5) img.set(x, y, c, 70);
      }
    });
  }
  arrow(color = '#ffd166') {
    return this.flat('arrow:' + color, 16, (img) => {
      const c = hex(color);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const inHead = x >= 7 && Math.abs(y - 7.5) <= (15 - x) * 0.9;
        const inShaft = x < 8 && x > 1 && Math.abs(y - 7.5) < 2;
        if (inHead || inShaft) img.set(x, y, c, 255);
      }
    });
  }
  shadowBlob() {
    return this.flat('blob', 16, (img, S) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
        if (d < 1) img.set(x, y, [0, 0, 0], Math.round((1 - d) * 150));
      }
    });
  }
}

export function vehicleDef(m) { return VEHICLES[m]; }

export function pickupVox(kind, base = true) {
  const m = new Vox(14, 14, 12);
  const baseCol = { health: '#e04848', armor: '#3d7ccf', cash: '#3fae5a' }[kind] || '#f2b63e';
  if (base) m.cyl(7, 7, 0, 1, 6.5, C(baseCol), EM.ALWAYS);
  switch (kind) {
    case 'health':
      m.box(3, 3, 1, 11, 11, 8, C('#f6f4ee'));
      m.box(6, 4, 8, 8, 10, 9, C('#e04848'), EM.ALWAYS); m.box(4, 6, 8, 10, 8, 9, C('#e04848'), EM.ALWAYS);
      break;
    case 'armor':
      m.rbox(3, 3, 1, 11, 11, 8, 2, C('#2f5ea8'));
      m.box(5, 5, 8, 9, 9, 9, C('#9fc4ff'));
      break;
    case 'cash':
      for (let z = 1; z < 7; z++) m.box(3, 4, z, 11, 10, z + 1, z % 2 ? C('#4caf50') : C('#7bd17f'));
      m.box(6, 4, 7, 8, 10, 8, C('#f2e6c8'));
      break;
    case 'fists':
      m.ell(7, 7, 4, 3.5, 3, 3, C('#f6cba5'));
      m.box(9, 4, 3, 11, 10, 6, C('#e8b088'));
      break;
    default: {
      const gun = C('#2c2d33'), wood = C('#8a5a36');
      const L = { pistol: 7, bat: 12, smg: 9, shotgun: 13, rifle: 13, rocket: 13, grenade: 0 }[kind] ?? 9;
      if (kind === 'grenade') { m.ell(7, 7, 5, 3, 3, 3.4, C('#4a6a3a')); m.box(6, 6, 8, 8, 8, 10, C('#9a9a9a')); break; }
      if (kind === 'bat') { m.box(1, 6, 3, 13, 8, 5, wood); m.box(9, 5, 3, 13, 9, 6, wood); break; }
      const x0 = 7 - L / 2;
      m.box(x0, 6, 3, x0 + L, 8, 5, kind === 'rocket' ? C('#5d6b3a') : gun);
      if (kind === 'shotgun') m.box(x0, 6, 3, x0 + 4, 8, 5, wood);
      m.box(x0 + 2, 6, 1, x0 + 4, 8, 3, gun);
      if (kind === 'smg' || kind === 'rifle') m.box(x0 + 5, 6, 1, x0 + 6, 8, 3, C('#4a4c55'));
    }
  }
  return m;
}
void shade;
