import { TILE, FLOOR_H, ROOF, BSTYLE, TERRAIN_COUNT } from '/shared/constants.js';
import { PROP_DEF, PROP_ID } from '/shared/props.js';
import { texture2D, textureArray, buffer } from './gl.js';
import { makeTerrainTextures, makeJitterTexture, makeCloudTexture, TERRAIN_TEX } from './art-terrain.js';
import { makeWallTextures, WALL_LAYERS, WALL_COLORS, ROOF_COLORS, FLAT_ROOF, AWNING_COLORS, CONTAINER_COLORS, SHIP_COLORS } from './art-buildings.js';
import { PROP_BUILDERS, carouselTop } from './art-props.js';
import { buildBuildingMesh, BVERT } from './buildings.js';
import { buildRoadMarkings, DVERT } from './decals.js';
import { InstanceWriter, setupSpriteAttribs, FL } from './sprites.js';
import { hex } from './img.js';
import { MAT } from './shaders.js';

export const CHUNK = 32 * TILE;
const FOLIAGE = new Set(['oak', 'pine', 'palm', 'cherry', 'birch', 'bush', 'hedge', 'flowers', 'reeds', 'roofgarden']);
const NOSHADOW = new Set(['towel', 'lilypad', 'heli', 'flowers', 'beachball']);

export class WorldGfx {
  constructor(gl, bank, quadBuf) {
    this.gl = gl;
    this.bank = bank;
    this.quadBuf = quadBuf;
    this.meta = new Map();
  }

  async build(world, progress = () => {}) {
    const gl = this.gl;
    this.world = world;
    const W = world.w, H = world.h;
    const tick = () => new Promise((r) => setTimeout(r, 0));

    progress(0.05, 'Painting terrain');
    await tick();
    this.mapTex = texture2D(gl, W, H, { internal: gl.R8, format: gl.RED, data: world.ground });
    const terr = makeTerrainTextures();
    this.terrTex = textureArray(gl, TERRAIN_TEX, TERRAIN_TEX, TERRAIN_COUNT, { filter: gl.LINEAR, wrap: gl.REPEAT });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    terr.forEach((img, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TERRAIN_TEX, TERRAIN_TEX, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.d.buffer)));
    this.jitterTex = texture2D(gl, 64, 64, { data: makeJitterTexture(64), filter: gl.LINEAR, wrap: gl.REPEAT });
    this.noiseTex = texture2D(gl, 256, 256, { data: makeCloudTexture(256), filter: gl.LINEAR, wrap: gl.REPEAT });

    progress(0.2, 'Raising buildings');
    await tick();
    const walls = makeWallTextures();
    this.wallTex = textureArray(gl, 128, 128, WALL_LAYERS);
    walls.layers.forEach((img, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 128, 128, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.d.buffer)));
    this.palTex = this.makePalette();
    this.heightTex = this.makeHeightmap(world);
    this.aoTex = this.makeAO(world);
    const mesh = buildBuildingMesh(world);
    this.bVao = gl.createVertexArray();
    gl.bindVertexArray(this.bVao);
    buffer(gl, gl.ARRAY_BUFFER, mesh.verts);
    const S = BVERT * 4;
    const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off * 4); };
    at(0, 3, 0); at(1, 2, 3); at(2, 1, 5); at(3, 4, 6); at(4, 4, 10); at(5, 2, 14);
    buffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
    gl.bindVertexArray(null);
    this.bCount = mesh.count;

    progress(0.35, 'Painting roads');
    await tick();
    const decals = buildRoadMarkings(world);
    this.dVao = gl.createVertexArray();
    gl.bindVertexArray(this.dVao);
    buffer(gl, gl.ARRAY_BUFFER, decals);
    const DS = DVERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, DS, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, DS, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, DS, 20);
    gl.bindVertexArray(null);
    this.dCount = decals.length / DVERT;

    progress(0.45, 'Planting trees');
    await tick();
    this.buildProps(world, (f) => progress(0.45 + f * 0.45, 'Placing street furniture'));
    progress(0.95, 'Almost there');
  }

  makePalette() {
    const gl = this.gl;
    const w = 128, h = 8;
    const d = new Uint8Array(w * h * 4);
    const row = (r, cols) => cols.forEach((c, i) => { const [R, G, B] = hex(c); const o = (r * w + i) * 4; d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255; });
    row(0, WALL_COLORS); row(1, ROOF_COLORS); row(2, FLAT_ROOF); row(3, AWNING_COLORS); row(4, CONTAINER_COLORS); row(5, SHIP_COLORS);
    return texture2D(gl, w, h, { data: d });
  }

  makeHeightmap(world) {
    const W = world.w, H = world.h;
    const d = new Uint8Array(W * H);
    for (const b of world.buildings) {
      let h = b.floors * FLOOR_H;
      if (b.roof === ROOF.GABLE_X || b.roof === ROOF.GABLE_Y || b.roof === ROOF.HIP) h += Math.min((b.roof === ROOF.GABLE_Y ? b.w : b.h) * TILE * 0.42, 26) * 0.6;
      if (b.style === BSTYLE.LIGHTHOUSE) h += 20;
      const v = Math.min(255, Math.round(h / 2));
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * W + x;
        if (b.open) { d[i] = Math.max(d[i], v); continue; }
        d[i] = Math.max(d[i], v);
      }
    }
    this.heightData = d;
    return texture2D(this.gl, W, H, { internal: this.gl.R8, format: this.gl.RED, data: d });
  }

  // Ambient occlusion around building bases, 2 texels per tile, blurred.
  makeAO(world) {
    const W = world.w * 2, H = world.h * 2;
    const solid = new Uint8Array(W * H);
    for (const b of world.buildings) {
      if (b.open || b.water) continue;
      for (let y = b.y * 2; y < (b.y + b.h) * 2; y++) for (let x = b.x * 2; x < (b.x + b.w) * 2; x++) solid[y * W + x] = 1;
    }
    let a = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = solid[i] ? 0 : 0;
    // distance to nearest solid within 3 texels
    const R = 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (solid[y * W + x]) continue;
      let best = 99;
      for (let oy = -R; oy <= R; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= H) continue;
        for (let ox = -R; ox <= R; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= W || !solid[yy * W + xx]) continue;
          const dd = Math.hypot(ox, oy);
          if (dd < best) best = dd;
        }
      }
      if (best < 99) a[y * W + x] = Math.max(0, 1 - (best - 0.5) / R) * 0.9;
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += a[yy * W + xx]; n++;
      }
      out[y * W + x] = Math.round((s / n) * 255);
    }
    return texture2D(this.gl, W, H, { internal: this.gl.R8, format: this.gl.RED, data: out, filter: this.gl.LINEAR });
  }

  propDef(type, v) {
    const key = `p:${type}:${v}`;
    let m = this.meta.get(key);
    if (m) return m;
    const name = PROP_DEF[type].key;
    const fn = PROP_BUILDERS[name];
    if (!fn) { this.meta.set(key, null); return null; }
    const res = fn(v);
    const mat = res.flat ? (name === 'heli' ? MAT.ROOF : MAT.GROUND) : FOLIAGE.has(name) ? MAT.FOLIAGE : MAT.OBJECT;
    const def = this.bank.fromVox(key, res.m, { step: res.step || 1, canopyZ: res.canopyZ ?? 999, mat });
    m = { def, res, name, cx: res.m.w / 2, cy: res.m.d / 2 };
    this.meta.set(key, m);
    return m;
  }

  buildProps(world, progress) {
    const gl = this.gl;
    const cw = Math.ceil((world.w * TILE) / CHUNK), ch = Math.ceil((world.h * TILE) / CHUNK);
    this.cw = cw; this.ch = ch;
    const writers = Array.from({ length: cw * ch }, () => new InstanceWriter(256));
    this.staticLights = [];
    this.signals = [];
    this.emitters = [];
    this.carousels = [];
    this.propInst = new Array(world.props.length);
    const n = world.props.length;
    for (let i = 0; i < n; i++) {
      const p = world.props[i];
      const [type, x, y, rot, z, v] = p;
      const m = this.propDef(type, v);
      if (!m) continue;
      const c = Math.min(cw - 1, Math.floor(x / CHUNK)) + Math.min(ch - 1, Math.floor(y / CHUNK)) * cw;
      const wr = writers[c];
      let flags = 0;
      if (NOSHADOW.has(m.name) || z > 0) flags |= FL.NOSHADOW;
      const [s, e] = wr.stack(m.def, x, y, z, rot, { flags, seed: (i * 13.7) % 100 });
      this.propInst[i] = [c, s, e];
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const toWorld = (lx, ly) => {
        const dx = lx - m.cx, dy = ly - m.cy;
        return [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
      };
      if (m.res.lights) for (const L of m.res.lights) {
        const [wx, wy] = toWorld(L.x, L.y);
        this.staticLights.push({ x: wx, y: wy, z: z + L.z, r: L.r, c: L.c, k: L.k, prop: i, seed: (i * 7.31) % 10 });
      }
      if (m.res.signal) {
        const [wx, wy] = toWorld(m.res.signal.x, m.res.signal.y);
        const axis = Math.abs(Math.cos(rot)) > 0.5 ? 'v' : 'h';
        this.signals.push({ x: wx, y: wy, z: m.res.signal.z, axis, prop: i });
      }
      if (m.res.fountain) this.emitters.push({ k: 'fountain', x, y, z: z + 17, prop: i });
      if (m.res.fire) { const [wx, wy] = toWorld(m.res.fire.x, m.res.fire.y); this.emitters.push({ k: 'fire', x: wx, y: wy, z: z + m.res.fire.z, prop: i }); }
      if (m.res.smoke && (i % 3 === 0)) { const [wx, wy] = toWorld(m.res.smoke.x, m.res.smoke.y); this.emitters.push({ k: 'chimney', x: wx, y: wy, z: z + m.res.smoke.z, prop: i }); }
      if (m.res.carousel) this.carousels.push({ x, y, z, prop: i });
      if (i % 2000 === 0) progress(i / n);
    }
    this.carouselDef = this.carousels.length ? this.bank.fromVox('carousel-top', carouselTop(), { step: 2, canopyZ: 14 }) : null;
    // signals: find the owning intersection for phase lookup
    for (const s of this.signals) {
      let best = null, bd = 1e9;
      for (const nd of world.nodes) {
        if (!nd.signal) continue;
        const d = (nd.x - s.x) ** 2 + (nd.y - s.y) ** 2;
        if (d < bd) { bd = d; best = nd; }
      }
      s.node = best ? best.id : 0;
    }
    this.chunks = writers.map((wr, k) => {
      if (!wr.n) return null;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = buffer(gl, gl.ARRAY_BUFFER, wr.f32.subarray(0, wr.n * 16), gl.DYNAMIC_DRAW);
      setupSpriteAttribs(gl, this.quadBuf, buf);
      gl.bindVertexArray(null);
      return { vao, buf, n: wr.n, wr, cx: k % cw, cy: Math.floor(k / cw) };
    });
    // spatial grid for static lights
    this.lightGrid = new Map();
    for (const L of this.staticLights) {
      const key = Math.floor(L.x / CHUNK) + Math.floor(L.y / CHUNK) * cw;
      if (!this.lightGrid.has(key)) this.lightGrid.set(key, []);
      this.lightGrid.get(key).push(L);
    }
    this.emitGrid = new Map();
    for (const e of this.emitters) {
      const key = Math.floor(e.x / CHUNK) + Math.floor(e.y / CHUNK) * cw;
      if (!this.emitGrid.has(key)) this.emitGrid.set(key, []);
      this.emitGrid.get(key).push(e);
    }
  }

  // Hide or show a prop (breakables).
  setPropVisible(i, visible) {
    const inst = this.propInst[i];
    if (!inst) return;
    const [c, s, e] = inst;
    const ch = this.chunks[c];
    if (!ch) return;
    for (let k = s; k < e; k++) ch.wr.setAlpha(k, visible ? 255 : 0);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, ch.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, s * 64, ch.wr.f32.subarray(s * 16, e * 16));
    for (const L of this.staticLights) if (L.prop === i) L.off = !visible;
    for (const em of this.emitters) if (em.prop === i) em.off = !visible;
  }

  visibleChunks(x0, y0, x1, y1, out = []) {
    out.length = 0;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cx1 = Math.min(this.cw - 1, Math.floor(x1 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK)), cy1 = Math.min(this.ch - 1, Math.floor(y1 / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunks[cy * this.cw + cx];
      if (c) out.push(c);
    }
    return out;
  }

  forEachInCells(grid, x0, y0, x1, y1, fn) {
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cx1 = Math.min(this.cw - 1, Math.floor(x1 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK)), cy1 = Math.min(this.ch - 1, Math.floor(y1 / CHUNK));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const arr = grid.get(cy * this.cw + cx);
      if (arr) for (const it of arr) fn(it);
    }
  }
}

void PROP_ID;
