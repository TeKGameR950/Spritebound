import { textureArray } from './gl.js';

// Texture-array atlas with shelf packing and 1px padding.
export class Atlas {
  constructor(gl, size = 1024, layers = 24) {
    this.gl = gl;
    this.size = size;
    this.layers = layers;
    this.tex = textureArray(gl, size, size, layers);
    this.shelves = [];
    this.layer = 0;
    this.cursor = { x: 0, y: 0, h: 0 };
    this.used = 0;
  }

  alloc(w, h) {
    const pw = w + 2, ph = h + 2;
    const S = this.size;
    for (;;) {
      if (this.layer >= this.layers) throw new Error('Atlas full');
      const c = this.cursor;
      if (c.x + pw > S) { c.x = 0; c.y += c.h; c.h = 0; }
      if (c.y + ph > S) { this.layer++; this.cursor = { x: 0, y: 0, h: 0 }; continue; }
      const r = { layer: this.layer, x: c.x + 1, y: c.y + 1, w, h };
      c.x += pw;
      c.h = Math.max(c.h, ph);
      r.u0 = r.x / S; r.v0 = r.y / S; r.u1 = (r.x + w) / S; r.v1 = (r.y + h) / S;
      this.used += pw * ph;
      return r;
    }
  }

  // Upload RGBA pixels (Uint8ClampedArray or Uint8Array of w*h*4) into region r.
  put(r, pixels) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, r.x, r.y, r.layer, r.w, r.h, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }

  add(w, h, pixels) {
    const r = this.alloc(w, h);
    this.put(r, pixels);
    return r;
  }
}
