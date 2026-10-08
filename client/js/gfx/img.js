// Small RGBA image toolkit for procedural pixel art.
import { hash2 } from '/shared/rng.js';

export function hex(c) {
  if (Array.isArray(c)) return c;
  let h = c.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a, f) => [a[0] * f, a[1] * f, a[2] * f];

export class Img {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = a;
  }
  // wrap-around set for tileable textures
  setw(x, y, c, a = 255) {
    x = ((Math.floor(x) % this.w) + this.w) % this.w;
    y = ((Math.floor(y) % this.h) + this.h) % this.h;
    this.set(x, y, c, a);
  }
  get(x, y) {
    x = ((Math.floor(x) % this.w) + this.w) % this.w;
    y = ((Math.floor(y) % this.h) + this.h) % this.h;
    const o = (y * this.w + x) * 4;
    return [this.d[o], this.d[o + 1], this.d[o + 2], this.d[o + 3]];
  }
  blend(x, y, c, t) {
    const p = this.get(x, y);
    this.setw(x, y, mixc(p, c, t), p[3]);
  }
  mul(x, y, f) {
    const p = this.get(x, y);
    this.setw(x, y, mulc(p, f), p[3]);
  }
  fill(c, a = 255) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c, a);
  }
  rect(x, y, w, h, c, a = 255, wrap = false) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) (wrap ? this.setw(i, j, c, a) : this.set(i, j, c, a));
  }
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const r = fn(x, y);
      if (r) this.set(x, y, r, r[3] ?? 255);
    }
  }
  circle(cx, cy, r, c, a = 255, wrap = true) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) (wrap ? this.setw(x, y, c, a) : this.set(x, y, c, a));
    }
  }
  line(x0, y0, x1, y1, c, a = 255, wrap = true) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      wrap ? this.setw(x, y, c, a) : this.set(x, y, c, a);
    }
  }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const o = (y * src.w + x) * 4;
      if (!src.d[o + 3]) continue;
      this.set(dx + x, dy + y, [src.d[o], src.d[o + 1], src.d[o + 2]], src.d[o + 3]);
    }
  }
}

// Tileable value noise with integer period.
export function pnoise(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (v) => ((v % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function pfbm(x, y, period, seed = 0, oct = 3) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += pnoise(x * f, y * f, period * f, seed + i * 13) * amp;
    n += amp; amp *= 0.5; f *= 2;
  }
  return s / n;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

// Map value v in [0,1] onto a colour ramp with ordered dithering between steps.
export function ramp(colors, v, x, y, dither = 0.6) {
  const n = colors.length - 1;
  const f = Math.max(0, Math.min(0.9999, v)) * n;
  const i = Math.floor(f);
  const t = f - i;
  const pick = t > 0.5 + (bayer(x, y) - 0.5) * dither ? i + 1 : i;
  return hex(colors[Math.min(n, pick)]);
}
