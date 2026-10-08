import { RNG } from './rng.js';

export const SKIN = ['#ffe3cb', '#f6cba5', '#e8b088', '#cf9065', '#b07148', '#8a5434', '#653b24', '#432719'];
export const HAIR_STYLES = ['bald', 'short', 'buzz', 'spiky', 'long', 'ponytail', 'bun', 'afro', 'mohawk', 'curly', 'bob', 'pigtails'];
export const HAIR_COLORS = ['#1c1613', '#3d2b20', '#6e4629', '#a6743c', '#e0be74', '#f3e4bc', '#b5452c', '#d8d8d8', '#ff86bd', '#62c3ff', '#7ee08c', '#a27bff'];
export const TOPS = ['tshirt', 'hoodie', 'jacket', 'tank', 'suit', 'dress', 'overalls', 'sweater', 'raincoat', 'apron'];
export const HATS = ['none', 'cap', 'beanie', 'cowboy', 'beret', 'helmet', 'crown', 'headphones', 'flowers', 'tophat', 'bucket', 'bandana'];
export const ACCESSORIES = ['none', 'backpack', 'glasses', 'scarf', 'cape', 'sunglasses', 'guitar'];
export const CLOTH = [
  '#f4f1ea', '#2b2b33', '#d64545', '#ee8a3a', '#f6cf57', '#79c267', '#3a9a74', '#53b3d6',
  '#3d63c1', '#7d5ec9', '#e07fb3', '#9c6b47', '#8d949c', '#1f4f7a', '#6b2b3a', '#c9b48a',
  '#a4dccb', '#ffb3a8', '#cfe07a', '#4b3a2f',
];

export const DEFAULT_APPEARANCE = {
  body: 1, skin: 2, hair: 1, hairColor: 2, top: 0, topColor: 7, pants: 0, pantsColor: 13,
  shoes: 1, hat: 0, hatColor: 2, acc: 0, accColor: 4,
};

const LIMITS = {
  body: 3, skin: SKIN.length, hair: HAIR_STYLES.length, hairColor: HAIR_COLORS.length, top: TOPS.length,
  topColor: CLOTH.length, pants: 3, pantsColor: CLOTH.length, shoes: CLOTH.length, hat: HATS.length,
  hatColor: CLOTH.length, acc: ACCESSORIES.length, accColor: CLOTH.length,
};
export const APPEARANCE_KEYS = Object.keys(LIMITS);
export const APPEARANCE_LIMITS = LIMITS;

export function sanitizeAppearance(a) {
  const out = { ...DEFAULT_APPEARANCE };
  if (!a || typeof a !== 'object') return out;
  for (const k of APPEARANCE_KEYS) {
    const v = Number(a[k]);
    if (Number.isInteger(v) && v >= 0 && v < LIMITS[k]) out[k] = v;
  }
  return out;
}

export function randomAppearance(seed) {
  const r = new RNG(seed >>> 0);
  return {
    body: r.int(0, 2),
    skin: r.int(0, SKIN.length - 1),
    hair: r.weighted([[0, 1], [1, 4], [2, 2], [3, 1], [4, 3], [5, 2], [6, 2], [7, 1], [8, 0.3], [9, 2], [10, 2], [11, 1]]),
    hairColor: r.weighted([[0, 4], [1, 4], [2, 3], [3, 2], [4, 2], [5, 1], [6, 1], [7, 1], [8, 0.3], [9, 0.3], [10, 0.2], [11, 0.2]]),
    top: r.weighted([[0, 5], [1, 3], [2, 2], [3, 1], [4, 1], [5, 1], [6, 0.5], [7, 2], [8, 0.5], [9, 0.3]]),
    topColor: r.int(0, CLOTH.length - 1),
    pants: r.int(0, 2),
    pantsColor: r.pick([1, 8, 11, 12, 13, 15, 19, 0, 6]),
    shoes: r.pick([0, 1, 11, 2, 12, 19]),
    hat: r.chance(0.3) ? r.weighted([[1, 4], [2, 3], [3, 1], [4, 1], [7, 1], [10, 2], [11, 1]]) : 0,
    hatColor: r.int(0, CLOTH.length - 1),
    acc: r.chance(0.3) ? r.weighted([[1, 3], [2, 2], [3, 1], [5, 2]]) : 0,
    accColor: r.int(0, CLOTH.length - 1),
  };
}

const NAME_RE = /^[A-Za-z0-9 _\-.]{2,16}$/;
export function sanitizeName(n) {
  if (typeof n !== 'string') return null;
  n = n.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(n)) return null;
  return n;
}

export const NPC_NAMES = ['Ari', 'Bo', 'Cass', 'Dee', 'Eli', 'Fen', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kit', 'Lou', 'Mo', 'Nia', 'Oz', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam', 'Uma', 'Vic', 'Wren', 'Xan', 'Yui', 'Zed'];
