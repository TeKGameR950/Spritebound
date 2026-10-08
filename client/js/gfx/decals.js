import { TILE } from '/shared/constants.js';
import { hex } from './img.js';

// Decal vertex: pos3, uv2, colour4 = 9 floats. uv.x = 1 marks worn paint.
export const DVERT = 9;
const WHITE = [...hex('#ecebe6').map((c) => c / 255), 0.92];
const YELLOW = [...hex('#f2c14e').map((c) => c / 255), 0.95];

class DecalList {
  constructor() { this.v = []; }
  // axis-aligned rectangle
  rect(x0, y0, x1, y1, col, paint = 1, z = 0.05) {
    const [r, g, b, a] = col;
    this.v.push(
      x0, y0, z, paint, 0, r, g, b, a,
      x1, y0, z, paint, 0, r, g, b, a,
      x1, y1, z, paint, 0, r, g, b, a,
      x0, y0, z, paint, 0, r, g, b, a,
      x1, y1, z, paint, 0, r, g, b, a,
      x0, y1, z, paint, 0, r, g, b, a,
    );
  }
  dashX(x0, x1, y, w, col, dash = 10, gap = 10) {
    const p = dash + gap;
    for (let x = Math.ceil(x0 / p) * p; x + dash <= x1; x += p) this.rect(x, y - w / 2, x + dash, y + w / 2, col);
  }
  dashY(y0, y1, x, w, col, dash = 10, gap = 10) {
    const p = dash + gap;
    for (let y = Math.ceil(y0 / p) * p; y + dash <= y1; y += p) this.rect(x - w / 2, y, x + w / 2, y + dash, col);
  }
}

export function buildRoadMarkings(world) {
  const d = new DecalList();
  const nodes = new Map(world.nodes.map((n) => [n.id, n]));
  for (const e of world.edges) {
    const na = nodes.get(e.a), nb = nodes.get(e.b);
    if (!na || !nb) continue;
    const cobble = isCobble(world, e);
    if (e.dir === 'h') {
      const y0 = e.y0 * TILE, y1 = e.y1 * TILE, yc = (y0 + y1) / 2;
      const xs = na.inter ? (na.tx + na.tw) * TILE : na.x, xe = nb.inter ? nb.tx * TILE : nb.x;
      if (xe - xs < 8) continue;
      const cwA = na.cross ? 14 : 0, cwB = nb.cross ? 14 : 0;
      if (!cobble) {
        if (e.lanes === 2) {
          d.rect(xs + cwA + 6, yc - 2.2, xe - cwB - 6, yc - 0.9, YELLOW);
          d.rect(xs + cwA + 6, yc + 0.9, xe - cwB - 6, yc + 2.2, YELLOW);
          d.dashX(xs + cwA + 8, xe - cwB - 8, yc - 32, 1.4, WHITE, 12, 12);
          d.dashX(xs + cwA + 8, xe - cwB - 8, yc + 32, 1.4, WHITE, 12, 12);
        } else {
          d.dashX(xs + cwA + 6, xe - cwB - 6, yc, 1.4, YELLOW, 9, 9);
        }
        // stop lines on the right-hand half approaching each intersection
        if (nb.inter) d.rect(xe - cwB - 5, yc, xe - cwB - 2, y1 - 2, WHITE);
        if (na.inter) d.rect(xs + cwA + 2, y0 + 2, xs + cwA + 5, yc, WHITE);
      }
      if (na.cross && na.inter) zebraV(d, xs + 1, xs + 13, y0, y1);
      if (nb.cross && nb.inter) zebraV(d, xe - 13, xe - 1, y0, y1);
    } else {
      const x0 = e.x0 * TILE, x1 = e.x1 * TILE, xc = (x0 + x1) / 2;
      const ys = na.inter ? (na.ty + na.th) * TILE : na.y, ye = nb.inter ? nb.ty * TILE : nb.y;
      if (ye - ys < 8) continue;
      const cwA = na.cross ? 14 : 0, cwB = nb.cross ? 14 : 0;
      if (!cobble) {
        if (e.lanes === 2) {
          d.rect(xc - 2.2, ys + cwA + 6, xc - 0.9, ye - cwB - 6, YELLOW);
          d.rect(xc + 0.9, ys + cwA + 6, xc + 2.2, ye - cwB - 6, YELLOW);
          d.dashY(ys + cwA + 8, ye - cwB - 8, xc - 32, 1.4, WHITE, 12, 12);
          d.dashY(ys + cwA + 8, ye - cwB - 8, xc + 32, 1.4, WHITE, 12, 12);
        } else {
          d.dashY(ys + cwA + 6, ye - cwB - 6, xc, 1.4, YELLOW, 9, 9);
        }
        // southbound traffic drives on the west half (x < xc); northbound on the east half
        if (nb.inter) d.rect(x0 + 2, ye - cwB - 5, xc, ye - cwB - 2, WHITE);
        if (na.inter) d.rect(xc, ys + cwA + 2, x1 - 2, ys + cwA + 5, WHITE);
      }
      if (na.cross && na.inter) zebraH(d, ys + 1, ys + 13, x0, x1);
      if (nb.cross && nb.inter) zebraH(d, ye - 13, ye - 1, x0, x1);
    }
  }
  // parking bays
  for (const lot of world.parkingLots || []) {
    for (const row of lot.rows) {
      for (let x = lot.x + 1; x <= lot.x + lot.w - 1; x += 2) {
        const wx = x * TILE;
        d.rect(wx - 0.7, row.y * TILE + 2, wx + 0.7, (row.y + 3) * TILE - 2, WHITE);
      }
      const yy = row.facing === 2 ? (row.y + 3) * TILE - 2 : row.y * TILE + 2;
      d.rect((lot.x + 1) * TILE, yy - 0.7, (lot.x + lot.w - 1) * TILE, yy + 0.7, WHITE, 1);
    }
  }
  // basketball courts
  for (const c of world.courts || []) {
    const x0 = c.x * TILE + 6, y0 = c.y * TILE + 6, x1 = (c.x + c.w) * TILE - 6, y1 = (c.y + c.h) * TILE - 6;
    const W = [1, 1, 1, 0.9];
    d.rect(x0, y0, x1, y0 + 1.2, W); d.rect(x0, y1 - 1.2, x1, y1, W);
    d.rect(x0, y0, x0 + 1.2, y1, W); d.rect(x1 - 1.2, y0, x1, y1, W);
    const xm = (x0 + x1) / 2;
    d.rect(xm - 0.6, y0, xm + 0.6, y1, W);
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2, r = 14;
      const cx = xm + Math.cos(t) * r, cy = (y0 + y1) / 2 + Math.sin(t) * r;
      d.rect(cx - 0.8, cy - 0.8, cx + 0.8, cy + 0.8, W);
    }
  }
  return new Float32Array(d.v);
}

function zebraV(d, x0, x1, y0, y1) {
  for (let y = y0 + 3; y + 4 <= y1 - 2; y += 7) d.rect(x0, y, x1, y + 4, WHITE);
}
function zebraH(d, y0, y1, x0, x1) {
  for (let x = x0 + 3; x + 4 <= x1 - 2; x += 7) d.rect(x, y0, x + 4, y1, WHITE);
}

function isCobble(world, e) {
  const tx = Math.floor((e.x0 + e.x1) / 2), ty = Math.floor((e.y0 + e.y1) / 2);
  return world.ground[ty * world.w + tx] === 9;
}

// Dynamic ring buffer of dark marks (skids, scorch).
export class MarkRing {
  constructor(gl, cap = 6000) {
    this.gl = gl;
    this.cap = cap;
    this.data = new Float32Array(cap * 6 * DVERT);
    this.head = 0;
    this.count = 0;
    this.dirty0 = cap; this.dirty1 = -1;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }
  // oriented quad from (x0,y0) to (x1,y1) with half width w
  segment(x0, y0, x1, y1, w, col) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * w, ny = (dx / len) * w;
    const q = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 + nx, y0 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
    const o = this.head * 6 * DVERT;
    for (let i = 0; i < 6; i++) {
      const k = o + i * DVERT;
      this.data[k] = q[i][0]; this.data[k + 1] = q[i][1]; this.data[k + 2] = 0.03;
      this.data[k + 3] = 0; this.data[k + 4] = 0;
      this.data[k + 5] = col[0]; this.data[k + 6] = col[1]; this.data[k + 7] = col[2]; this.data[k + 8] = col[3];
    }
    this.dirty0 = Math.min(this.dirty0, this.head);
    this.dirty1 = Math.max(this.dirty1, this.head);
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
  }
  blob(x, y, r, col) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
      this.segment(x - dx, y - dy, x + dx, y + dy, r * 0.75, col);
    }
  }
  upload() {
    if (this.dirty1 < 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const s = this.dirty0 * 6 * DVERT, e = (this.dirty1 + 1) * 6 * DVERT;
    gl.bufferSubData(gl.ARRAY_BUFFER, s * 4, this.data.subarray(s, e));
    this.dirty0 = this.cap; this.dirty1 = -1;
  }
}
