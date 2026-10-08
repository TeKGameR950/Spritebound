import { MAP_W, MAP_H, D } from '../../shared/constants.js';
import { fbm } from '../../shared/noise.js';

// Large-scale geography of Haven Bay. All coordinates are in tiles.

export const riverX = (y) => 184 + 15 * Math.sin(y / 68) + 6 * Math.sin(y / 23 + 1.3);
export const RIVER_HALF = 6.5;

export const southCoast = (x) => 446 + 5 * Math.sin(x / 37) + 3 * Math.sin(x / 13 + 2);

export function eastLimit(y) {
  if (y < 270) return 482 + 4 * Math.sin(y / 29);
  return 474;
}

export const PIERS = [
  { x0: 474, x1: 500, y0: 316, y1: 326 },
  { x0: 474, x1: 500, y0: 372, y1: 382 },
];

export const PENINSULA = { cx: 488, cy: 460, r: 12 };

export function inPeninsula(x, y) {
  const dx = x - PENINSULA.cx, dy = y - PENINSULA.cy;
  if (dx * dx + dy * dy < PENINSULA.r * PENINSULA.r) return true;
  return x >= 470 && x <= 492 && y >= 438 && y <= 456;
}

export function inPier(x, y) {
  for (const p of PIERS) if (x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1) return true;
  return false;
}

export function isOcean(x, y) {
  if (inPeninsula(x, y)) return false;
  if (inPier(x, y)) return false;
  if (y > southCoast(x)) return true;
  if (x > eastLimit(y)) return true;
  return false;
}

export function isRiver(x, y) {
  return Math.abs(x + 0.5 - riverX(y + 0.5)) < RIVER_HALF;
}

export function isRockBorder(x, y, seed) {
  const n = fbm(x * 0.08, y * 0.08, seed + 5, 3);
  if (x < 5 + n * 9) return true;
  if (y < 4 + n * 8) return true;
  return false;
}

// District of a point, given the y of the beach boulevard (first tile row of that road).
export function districtAt(x, y, beachY) {
  if (inPeninsula(x, y) || (x > 466 && y > 430)) return D.point;
  if (y >= beachY) return D.beach;
  if (x < 42 || y < 36 || (x < 152 && y < 146)) return D.wild;
  const rx = riverX(y);
  if (Math.abs(x - rx) < RIVER_HALF + 1) return D.river;
  if (x < rx) {
    if (y >= 318) return D.oldtown;
    return D.willow;
  }
  if (x >= 392 && y >= 268) return D.docks;
  if (x >= 446 && y < 268) return D.estates;
  if (y < 62) return D.estates;
  if (x >= 340 && y < 196) return D.park;
  if (x < 340 && y < 166) return D.maple;
  if (x >= 236 && x < 376 && y >= 196 && y < 318) return D.downtown;
  return D.market;
}

export const MAP_CENTER = { x: MAP_W / 2, y: MAP_H / 2 };
export const DOWNTOWN_CENTER = { x: 306, y: 256 };
