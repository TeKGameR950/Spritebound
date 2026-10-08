// Tiny voxel modelling kit. Models are sliced into horizontal layers and rendered as
// stacked sprites under a perspective camera, which gives real depth from above.
// Axes: x = forward (length), y = right (width), z = up.

export function rgb(hex, a = 255) {
  if (typeof hex === 'number') return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return ((a & 255) << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
}

export function shade(c, f) {
  const r = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  return (c & 0xff000000) | (b << 16) | (g << 8) | r;
}

export function mix(c1, c2, t) {
  const r = Math.round((c1 & 255) * (1 - t) + (c2 & 255) * t);
  const g = Math.round(((c1 >> 8) & 255) * (1 - t) + ((c2 >> 8) & 255) * t);
  const b = Math.round(((c1 >> 16) & 255) * (1 - t) + ((c2 >> 16) & 255) * t);
  return 0xff000000 | (b << 16) | (g << 8) | r;
}

// Emissive codes stored in the atlas alpha channel (opaque range 128..254, 255 = plain).
export const EM = { ALWAYS: 250, NIGHT: 240, HEAD: 230, TAIL: 220, SIREN_R: 210, SIREN_B: 200, WATER: 180, FIRE: 170, BLINK: 160, REVERSE: 150 };

export class Vox {
  constructor(w, d, h) {
    this.w = w; this.d = d; this.h = h;
    this.c = new Uint32Array(w * d * h);
    this.e = new Uint8Array(w * d * h); // emissive strength 0-255
  }
  i(x, y, z) { return (z * this.d + y) * this.w + x; }
  in(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.d && z < this.h; }
  set(x, y, z, c, e = 0) {
    x |= 0; y |= 0; z |= 0;
    if (!this.in(x, y, z)) return;
    const k = this.i(x, y, z);
    this.c[k] = c;
    this.e[k] = e;
  }
  get(x, y, z) {
    if (!this.in(x, y, z)) return 0;
    return this.c[this.i(x, y, z)];
  }
  clear(x, y, z) { this.set(x, y, z, 0); }
  box(x0, y0, z0, x1, y1, z1, c, e = 0) {
    for (let z = Math.floor(z0); z < z1; z++) for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const col = typeof c === 'function' ? c(x, y, z) : c;
      if (col) this.set(x, y, z, col, e);
    }
  }
  // rounded-corner box in xy
  rbox(x0, y0, z0, x1, y1, z1, r, c, e = 0) {
    for (let z = Math.floor(z0); z < z1; z++) for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const dx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x1 - r));
      const dy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y1 - r));
      if (dx * dx + dy * dy > r * r) continue;
      const col = typeof c === 'function' ? c(x, y, z) : c;
      if (col) this.set(x, y, z, col, e);
    }
  }
  cyl(cx, cy, z0, z1, r, c, e = 0) {
    for (let z = Math.floor(z0); z < z1; z++) for (let y = Math.floor(cy - r - 1); y <= cy + r; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const col = typeof c === 'function' ? c(x, y, z) : c;
      if (col) this.set(x, y, z, col, e);
    }
  }
  ell(cx, cy, cz, rx, ry, rz, c, e = 0) {
    for (let z = Math.floor(cz - rz - 1); z <= cz + rz; z++) for (let y = Math.floor(cy - ry - 1); y <= cy + ry; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > 1) continue;
      const col = typeof c === 'function' ? c(x, y, z, d) : c;
      if (col) this.set(x, y, z, col, e);
    }
  }
  line(x0, y0, z0, x1, y1, z1, c, e = 0) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), Math.round(z0 + (z1 - z0) * t), c, e);
    }
  }
  // Rotate the model 90 degrees clockwise (around z) q times. Returns a new Vox.
  rot90(q = 1) {
    let m = this;
    for (let k = 0; k < (q & 3); k++) {
      const n = new Vox(m.d, m.w, m.h);
      for (let z = 0; z < m.h; z++) for (let y = 0; y < m.d; y++) for (let x = 0; x < m.w; x++) {
        const k2 = m.i(x, y, z);
        if (!m.c[k2]) continue;
        n.set(m.d - 1 - y, x, z, m.c[k2], m.e[k2]);
      }
      m = n;
    }
    return m;
  }

  // Slice into images. Bakes simple lighting: top-exposed voxels bright, covered voxels
  // (only visible as sides) darker, edge darkening and height-based ambient occlusion.
  slices(opts = {}) {
    const { w, d, h } = this;
    const step = opts.step || 1;
    const ao = opts.ao ?? 0.35;
    const out = [];
    let top = 0;
    for (let z = 0; z < h; z++) for (let k = z * w * d; k < (z + 1) * w * d; k++) if (this.c[k]) { top = z; break; }
    for (let z0 = 0; z0 <= top; z0 += step) {
      const px = new Uint8ClampedArray(w * d * 4);
      const em = new Uint8ClampedArray(w * d);
      let any = false;
      for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
        // merge the step layers: highest non-empty voxel within the step wins
        let col = 0, emv = 0, zz = -1;
        for (let s = step - 1; s >= 0; s--) {
          const z = z0 + s;
          if (z >= h) continue;
          const k = this.i(x, y, z);
          if (this.c[k]) { col = this.c[k]; emv = this.e[k]; zz = z; break; }
        }
        if (!col) continue;
        any = true;
        let f = 1;
        const covered = zz + 1 < h && this.get(x, y, zz + 1);
        if (covered) f *= 0.8;
        else f *= 1.06;
        // edge darkening: neighbours empty at this height
        const edge = !this.get(x - 1, y, zz) || !this.get(x + 1, y, zz) || !this.get(x, y - 1, zz) || !this.get(x, y + 1, zz);
        if (edge && covered) f *= 0.88;
        // AO by height
        f *= 1 - ao * (1 - Math.min(1, (zz + 1) / Math.max(4, top * 0.6)));
        if (emv) f = 1;
        const c = shade(col, f);
        const o = (y * w + x) * 4;
        px[o] = c & 255; px[o + 1] = (c >> 8) & 255; px[o + 2] = (c >> 16) & 255; px[o + 3] = (col >>> 24) & 255;
        em[y * w + x] = emv;
      }
      out.push({ z: z0, px, em, any });
    }
    return { w, d, h: top + 1, step, slices: out };
  }
}
