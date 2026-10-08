// Sprite stacks: voxel models sliced into atlas regions, plus instance buffers.

export const INST_FLOATS = 16;
export const INST_BYTES = INST_FLOATS * 4;

// flag bits (params.x)
export const FL = { LIGHTS: 1, CANOPY: 2, BRAKE: 4, SIREN: 8, REVERSE: 16, HIT: 32, NOSHADOW: 64 };

export class SpriteBank {
  constructor(atlas) {
    this.atlas = atlas;
    this.cache = new Map();
  }

  // Convert sliced voxel data into atlas regions. opts: {canopyZ, mat, flat}
  fromVox(key, vox, opts = {}) {
    if (this.cache.has(key)) return this.cache.get(key);
    const sl = vox.slices({ step: opts.step || 1, ao: opts.ao });
    const def = { key, w: sl.w, d: sl.d, h: sl.h, slices: [], canopyZ: opts.canopyZ ?? 999, mat: opts.mat ?? 2, flat: !!opts.flat };
    for (const s of sl.slices) {
      if (!s.any) continue;
      if (opts.zMin !== undefined && s.z < opts.zMin) continue;
      if (opts.zMax !== undefined && s.z >= opts.zMax) continue;
      const px = s.px;
      // alpha carries the emissive code; dilate colours into transparent texels to avoid dark fringes
      for (let i = 0; i < s.em.length; i++) {
        if (px[i * 4 + 3]) px[i * 4 + 3] = s.em[i] ? s.em[i] : 255;
      }
      dilate(px, sl.w, sl.d);
      const r = this.atlas.add(sl.w, sl.d, px);
      def.slices.push({ z: s.z, r });
    }
    this.cache.set(key, def);
    return def;
  }

  // Flat sprite from an RGBA image (Img)
  fromImg(key, img, opts = {}) {
    if (this.cache.has(key)) return this.cache.get(key);
    const px = new Uint8ClampedArray(img.d);
    dilate(px, img.w, img.h);
    const r = this.atlas.add(img.w, img.h, px);
    const def = { key, w: img.w, d: img.h, h: 1, slices: [{ z: 0, r }], canopyZ: 999, mat: opts.mat ?? 2, flat: true };
    this.cache.set(key, def);
    return def;
  }

  get(key) { return this.cache.get(key); }
}

function dilate(px, w, h) {
  const src = new Uint8ClampedArray(px);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (src[o + 3]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = (ny * w + nx) * 4;
      if (src[k + 3]) { px[o] = src[k]; px[o + 1] = src[k + 1]; px[o + 2] = src[k + 2]; break; }
    }
  }
}

// Growable instance writer (Float32 + Uint8 views over one ArrayBuffer).
export class InstanceWriter {
  constructor(cap = 4096) {
    this.alloc(cap);
    this.n = 0;
  }
  alloc(cap) {
    const old = this.f32;
    this.cap = cap;
    this.buf = new ArrayBuffer(cap * INST_BYTES);
    this.f32 = new Float32Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
    if (old) this.f32.set(old.subarray(0, this.n * INST_FLOATS));
  }
  reset() { this.n = 0; }
  // Push one quad. tint: [r,g,b,a] 0..255; params: [flags, alpha, mat, extra] 0..255
  push(x, y, z, w, h, angle, r, tint, params, seed = 0) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const o = this.n * INST_FLOATS;
    const f = this.f32;
    f[o] = x; f[o + 1] = y; f[o + 2] = z;
    f[o + 3] = w; f[o + 4] = h; f[o + 5] = angle;
    f[o + 6] = r.u0; f[o + 7] = r.v0; f[o + 8] = r.u1; f[o + 9] = r.v1;
    f[o + 10] = r.layer;
    const b = o * 4;
    const u = this.u8;
    u[b + 44] = tint ? tint[0] : 255; u[b + 45] = tint ? tint[1] : 255; u[b + 46] = tint ? tint[2] : 255; u[b + 47] = tint ? tint[3] : 0;
    u[b + 48] = params ? params[0] : 0; u[b + 49] = params ? params[1] : 255; u[b + 50] = params ? params[2] : 2; u[b + 51] = params ? params[3] : 0;
    f[o + 13] = seed;
    return this.n++;
  }
  // Push all slices of a stack definition.
  stack(def, x, y, z, angle, opt = {}) {
    const flags = opt.flags || 0;
    const alpha = opt.alpha ?? 255;
    const tint = opt.tint || null;
    const seed = opt.seed || 0;
    const zScale = opt.zScale ?? 1;
    const first = this.n;
    const mat = opt.mat ?? def.mat;
    for (const s of def.slices) {
      if (opt.zMin !== undefined && s.z < opt.zMin) continue;
      if (opt.zMax !== undefined && s.z >= opt.zMax) continue;
      const canopy = s.z >= def.canopyZ ? 2 : 0;
      this.push(x, y, z + s.z * zScale, def.w, def.d, angle, s.r, tint, [flags | canopy, alpha, mat, 0], seed);
    }
    return [first, this.n];
  }
  setAlpha(i, a) { this.u8[i * INST_BYTES + 49] = a; }
}

// Configure instance attribute pointers for the sprite program on the bound VAO.
export function setupSpriteAttribs(gl, quadBuf, instBuf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  const S = INST_BYTES;
  const a = (loc, size, type, norm, off) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, norm, S, off);
    gl.vertexAttribDivisor(loc, 1);
  };
  a(1, 3, gl.FLOAT, false, 0);
  a(2, 2, gl.FLOAT, false, 12);
  a(3, 1, gl.FLOAT, false, 20);
  a(4, 4, gl.FLOAT, false, 24);
  a(5, 1, gl.FLOAT, false, 40);
  a(6, 4, gl.UNSIGNED_BYTE, true, 44);
  a(7, 4, gl.UNSIGNED_BYTE, true, 48);
  a(8, 1, gl.FLOAT, false, 52);
}
