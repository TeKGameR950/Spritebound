import { TILE, T, F, TERRAIN, MAP_W, MAP_H } from './constants.js';
import { PROP_DEF } from './props.js';

const CELL = 64;

// Static collision world: tile flags plus a spatial hash of prop shapes.
export class CollisionWorld {
  constructor(world) {
    this.w = world.w;
    this.h = world.h;
    this.ground = world.ground;
    this.flags = new Uint8Array(this.w * this.h);
    this.bgrid = new Int32Array(this.w * this.h).fill(-1);
    for (let i = 0; i < this.w * this.h; i++) {
      const t = this.ground[i];
      let f = 0;
      if (t === T.DEEP) f |= F.WALK | F.DRIVE | F.WATER;
      else if (t === T.ROCK) f |= F.WALK | F.DRIVE | F.SHOT;
      else if (t === T.WATER) f |= F.DRIVE | F.SHALLOW | F.WATER;
      else if (t === T.POOL) f |= F.DRIVE | F.SHALLOW | F.WATER;
      this.flags[i] = f;
    }
    for (const b of world.buildings) {
      if (b.open) continue;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * this.w + x;
        this.flags[i] = F.WALK | F.DRIVE | F.SHOT | F.BUILDING;
        this.bgrid[i] = b.id;
      }
    }
    this.gw = Math.ceil((this.w * TILE) / CELL);
    this.gh = Math.ceil((this.h * TILE) / CELL);
    this.cells = new Array(this.gw * this.gh);
    this.shapes = [];
    world.props.forEach((p, i) => this.addProp(p, i));
  }

  addProp(p, index) {
    const def = PROP_DEF[p[0]];
    if (!def.mask || p[4] > 0) return;
    let s;
    if (def.c) s = { k: 0, x: p[1], y: p[2], r: def.c, mask: def.mask, prop: index, brk: !!def.brk, alive: true };
    else if (def.r) {
      const q = Math.round(p[3] / (Math.PI / 2)) & 1;
      const hw = (q ? def.r[1] : def.r[0]) / 2, hh = (q ? def.r[0] : def.r[1]) / 2;
      s = { k: 1, x: p[1], y: p[2], hw, hh, mask: def.mask, prop: index, brk: !!def.brk, alive: true };
    } else return;
    this.shapes.push(s);
    const ext = s.k === 0 ? s.r : Math.max(s.hw, s.hh);
    const cx0 = Math.max(0, Math.floor((s.x - ext) / CELL)), cx1 = Math.min(this.gw - 1, Math.floor((s.x + ext) / CELL));
    const cy0 = Math.max(0, Math.floor((s.y - ext) / CELL)), cy1 = Math.min(this.gh - 1, Math.floor((s.y + ext) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cy * this.gw + cx;
      (this.cells[k] || (this.cells[k] = [])).push(s);
    }
  }

  tileFlags(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return F.WALK | F.DRIVE | F.SHOT;
    return this.flags[ty * this.w + tx];
  }
  flagsAt(x, y) {
    return this.tileFlags(Math.floor(x / TILE), Math.floor(y / TILE));
  }
  terrainAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.ROCK;
    return this.ground[ty * this.w + tx];
  }
  terrainInfo(x, y) {
    return TERRAIN[this.terrainAt(x, y)];
  }
  buildingAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return this.bgrid[ty * this.w + tx];
  }

  shapesNear(x, y, r, out) {
    out.length = 0;
    const cx0 = Math.max(0, Math.floor((x - r) / CELL)), cx1 = Math.min(this.gw - 1, Math.floor((x + r) / CELL));
    const cy0 = Math.max(0, Math.floor((y - r) / CELL)), cy1 = Math.min(this.gh - 1, Math.floor((y + r) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.cells[cy * this.gw + cx];
      if (!c) continue;
      for (const s of c) if (s.alive && !out.includes(s)) out.push(s);
    }
    return out;
  }

  // Push a circle out of solids. Returns {x, y, hit, nx, ny} (normal of the last contact).
  resolveCircle(x, y, r, mask, res = {}) {
    let hit = false, nx = 0, ny = 0, hitShape = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
      const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!(this.tileFlags(tx, ty) & mask)) continue;
        const bx0 = tx * TILE, by0 = ty * TILE, bx1 = bx0 + TILE, by1 = by0 + TILE;
        const cx = x < bx0 ? bx0 : x > bx1 ? bx1 : x;
        const cy = y < by0 ? by0 : y > by1 ? by1 : y;
        let dx = x - cx, dy = y - cy;
        let d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          // centre inside the tile: push out along the axis of least penetration toward an open neighbour
          const pl = x - bx0, pr = bx1 - x, pt = y - by0, pb = by1 - y;
          const opts = [];
          if (!(this.tileFlags(tx - 1, ty) & mask)) opts.push([pl, -1, 0]);
          if (!(this.tileFlags(tx + 1, ty) & mask)) opts.push([pr, 1, 0]);
          if (!(this.tileFlags(tx, ty - 1) & mask)) opts.push([pt, 0, -1]);
          if (!(this.tileFlags(tx, ty + 1) & mask)) opts.push([pb, 0, 1]);
          if (!opts.length) opts.push([pl, -1, 0], [pr, 1, 0], [pt, 0, -1], [pb, 0, 1]);
          opts.sort((a, b) => a[0] - b[0]);
          const [p, ox, oy] = opts[0];
          x += ox * (p + r); y += oy * (p + r);
          nx = ox; ny = oy;
        } else {
          const d = Math.sqrt(d2);
          const push = r - d;
          dx /= d; dy /= d;
          x += dx * push; y += dy * push;
          nx = dx; ny = dy;
        }
        hit = moved = true;
      }
      const near = this.shapesNear(x, y, r + 24, this._tmp || (this._tmp = []));
      for (const s of near) {
        if (!(s.mask & mask)) continue;
        if (s.k === 0) {
          let dx = x - s.x, dy = y - s.y;
          const rr = r + s.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.001;
          dx /= d; dy /= d;
          x = s.x + dx * rr; y = s.y + dy * rr;
          nx = dx; ny = dy;
        } else {
          const cx = Math.max(s.x - s.hw, Math.min(x, s.x + s.hw));
          const cy = Math.max(s.y - s.hh, Math.min(y, s.y + s.hh));
          let dx = x - cx, dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 < 1e-6) {
            const pl = x - (s.x - s.hw), pr = s.x + s.hw - x, pt = y - (s.y - s.hh), pb = s.y + s.hh - y;
            const m = Math.min(pl, pr, pt, pb);
            if (m === pl) { x -= pl + r; nx = -1; ny = 0; } else if (m === pr) { x += pr + r; nx = 1; ny = 0; } else if (m === pt) { y -= pt + r; nx = 0; ny = -1; } else { y += pb + r; nx = 0; ny = 1; }
          } else {
            const d = Math.sqrt(d2);
            dx /= d; dy /= d;
            x += dx * (r - d); y += dy * (r - d);
            nx = dx; ny = dy;
          }
        }
        hit = moved = true;
        hitShape = s;
      }
      if (!moved) break;
    }
    res.x = x; res.y = y; res.hit = hit; res.nx = nx; res.ny = ny; res.shape = hitShape;
    return res;
  }

  // Move a circle with sub-stepping so fast movers do not tunnel.
  moveCircle(x, y, dx, dy, r, mask, res = {}) {
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / (r * 0.8)));
    let hit = false, nx = 0, ny = 0;
    for (let i = 0; i < steps; i++) {
      x += dx / steps; y += dy / steps;
      this.resolveCircle(x, y, r, mask, res);
      x = res.x; y = res.y;
      if (res.hit) { hit = true; nx = res.nx; ny = res.ny; }
    }
    res.x = x; res.y = y; res.hit = hit; res.nx = nx; res.ny = ny;
    return res;
  }

  circleFree(x, y, r, mask) {
    const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!(this.tileFlags(tx, ty) & mask)) continue;
      const bx0 = tx * TILE, by0 = ty * TILE;
      const cx = Math.max(bx0, Math.min(x, bx0 + TILE)), cy = Math.max(by0, Math.min(y, by0 + TILE));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
    }
    for (const s of this.shapesNear(x, y, r + 24, this._tmp2 || (this._tmp2 = []))) {
      if (!(s.mask & mask)) continue;
      if (s.k === 0) { if ((x - s.x) ** 2 + (y - s.y) ** 2 < (r + s.r) ** 2) return false; }
      else {
        const cx = Math.max(s.x - s.hw, Math.min(x, s.x + s.hw)), cy = Math.max(s.y - s.hh, Math.min(y, s.y + s.hh));
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
      }
    }
    return true;
  }

  // Ray against tiles (DDA) and prop shapes. Returns distance fraction t in [0,1] and hit info.
  raycast(x0, y0, x1, y1, mask, res = {}) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1e-6;
    let tBest = 1, nx = 0, ny = 0, kind = 0, shape = null;
    // tiles
    let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : 1e9;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : 1e9;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : 1e9;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)) : 1e9;
    let t = 0, lastAxis = -1;
    if (this.tileFlags(tx, ty) & mask) { res.t = 0; res.x = x0; res.y = y0; res.nx = -dx / len; res.ny = -dy / len; res.kind = 1; res.shape = null; return res; }
    while (t <= 1) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; lastAxis = 0; }
      else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; lastAxis = 1; }
      if (t > 1) break;
      if (this.tileFlags(tx, ty) & mask) {
        tBest = t; kind = 1;
        if (lastAxis === 0) { nx = -stepX; ny = 0; } else { nx = 0; ny = -stepY; }
        break;
      }
    }
    // shapes along the segment
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const near = this.shapesNear(mx, my, len / 2 + 24, this._tmp3 || (this._tmp3 = []));
    for (const s of near) {
      if (!(s.mask & mask)) continue;
      let th = 2;
      let hnx = 0, hny = 0;
      if (s.k === 0) {
        const fx = x0 - s.x, fy = y0 - s.y;
        const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - s.r * s.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        if (t1 >= 0 && t1 < tBest) { th = t1; hnx = (x0 + dx * t1 - s.x) / s.r; hny = (y0 + dy * t1 - s.y) / s.r; }
      } else {
        const r = rayAabb(x0, y0, dx, dy, s.x - s.hw, s.y - s.hh, s.x + s.hw, s.y + s.hh);
        if (r && r.t < tBest) { th = r.t; hnx = r.nx; hny = r.ny; }
      }
      if (th < tBest) { tBest = th; nx = hnx; ny = hny; kind = 2; shape = s; }
    }
    res.t = tBest; res.x = x0 + dx * tBest; res.y = y0 + dy * tBest; res.nx = nx; res.ny = ny; res.kind = tBest < 1 ? kind : 0; res.shape = shape;
    return res;
  }

  lineOfSight(x0, y0, x1, y1) {
    return this.raycast(x0, y0, x1, y1, F.SHOT, this._los || (this._los = {})).t >= 1;
  }

  // Oriented box (car) vs static world. Returns contacts list [{px,py,nx,ny,depth,shape}].
  boxContacts(x, y, angle, hl, hw, mask, out = []) {
    out.length = 0;
    const c = Math.cos(angle), s = Math.sin(angle);
    // sample points around the perimeter
    const pts = this._boxPts || (this._boxPts = []);
    pts.length = 0;
    const nx = Math.max(2, Math.ceil(hl * 2 / 8)), ny = Math.max(2, Math.ceil(hw * 2 / 8));
    for (let i = 0; i <= nx; i++) {
      const u = -hl + (2 * hl * i) / nx;
      pts.push(u, -hw, u, hw);
    }
    for (let j = 1; j < ny; j++) {
      const v = -hw + (2 * hw * j) / ny;
      pts.push(-hl, v, hl, v);
    }
    for (let k = 0; k < pts.length; k += 2) {
      const lx = pts[k], ly = pts[k + 1];
      const px = x + lx * c - ly * s, py = y + lx * s + ly * c;
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (this.tileFlags(tx, ty) & mask) {
        // push direction: from tile toward the box centre, snapped to the axis with open neighbour
        const bx0 = tx * TILE, by0 = ty * TILE;
        const pl = px - bx0, pr = bx0 + TILE - px, pt = py - by0, pb = by0 + TILE - py;
        const cand = [];
        if (!(this.tileFlags(tx - 1, ty) & mask)) cand.push([pl, -1, 0]);
        if (!(this.tileFlags(tx + 1, ty) & mask)) cand.push([pr, 1, 0]);
        if (!(this.tileFlags(tx, ty - 1) & mask)) cand.push([pt, 0, -1]);
        if (!(this.tileFlags(tx, ty + 1) & mask)) cand.push([pb, 0, 1]);
        if (!cand.length) {
          const ddx = x - px, ddy = y - py;
          const dl = Math.hypot(ddx, ddy) || 1;
          out.push({ px, py, nx: ddx / dl, ny: ddy / dl, depth: 2, shape: null });
          continue;
        }
        // prefer normals that point toward the box centre
        let best = null, bestScore = 1e9;
        for (const [p, ox, oy] of cand) {
          const toward = (x - px) * ox + (y - py) * oy;
          const score = p - (toward > 0 ? 4 : 0);
          if (score < bestScore) { bestScore = score; best = [p, ox, oy]; }
        }
        out.push({ px, py, nx: best[1], ny: best[2], depth: Math.min(best[0], 8), shape: null });
      }
    }
    // shapes: test circles/rects against the box
    const near = this.shapesNear(x, y, hl + 24, this._tmp4 || (this._tmp4 = []));
    for (const sh of near) {
      if (!(sh.mask & mask)) continue;
      if (sh.k === 0) {
        // circle vs OBB
        const dx = sh.x - x, dy = sh.y - y;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const cx = Math.max(-hl, Math.min(hl, lx)), cy = Math.max(-hw, Math.min(hw, ly));
        let ex = lx - cx, ey = ly - cy;
        const d2 = ex * ex + ey * ey;
        if (d2 >= sh.r * sh.r) continue;
        let d = Math.sqrt(d2), nlx, nly, depth;
        if (d < 1e-4) {
          const px = hl - Math.abs(lx), py = hw - Math.abs(ly);
          if (px < py) { nlx = -Math.sign(lx) || -1; nly = 0; depth = px + sh.r; } else { nlx = 0; nly = -Math.sign(ly) || -1; depth = py + sh.r; }
        } else { nlx = -ex / d; nly = -ey / d; depth = sh.r - d; }
        const wx = sh.x - (ex ? (ex / (d || 1)) * Math.min(d, sh.r) : 0);
        const cpx = x + cx * c - cy * s, cpy = y + cx * s + cy * c;
        void wx;
        out.push({ px: cpx, py: cpy, nx: nlx * c - nly * s, ny: nlx * s + nly * c, depth: Math.min(depth, 10), shape: sh });
      } else {
        // rect: test the 4 rect corners against the box, plus box corners against the rect
        const res = obbVsAabb(x, y, angle, hl, hw, sh.x, sh.y, sh.hw, sh.hh);
        if (res) out.push({ px: res.px, py: res.py, nx: res.nx, ny: res.ny, depth: Math.min(res.depth, 10), shape: sh });
      }
    }
    return out;
  }
}

function rayAabb(x0, y0, dx, dy, ax, ay, bx, by) {
  let tmin = 0, tmax = 1, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-9) { if (x0 < ax || x0 > bx) return null; }
  else {
    let t1 = (ax - x0) / dx, t2 = (bx - x0) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < ay || y0 > by) return null; }
  else {
    let t1 = (ay - y0) / dy, t2 = (by - y0) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, ny };
}

// SAT between an oriented box and an axis-aligned box. Normal points from the AABB toward the OBB.
export function obbVsAabb(x, y, a, hl, hw, bx, by, bhw, bhh) {
  return obbVsObb(x, y, a, hl, hw, bx, by, 0, bhw, bhh);
}

export function obbVsObb(x1, y1, a1, hl1, hw1, x2, y2, a2, hl2, hw2) {
  const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
  const axes = [[c1, s1], [-s1, c1], [c2, s2], [-s2, c2]];
  const dx = x1 - x2, dy = y1 - y2;
  let minDepth = 1e9, nx = 0, ny = 0;
  for (const [ax, ay] of axes) {
    const r1 = hl1 * Math.abs(c1 * ax + s1 * ay) + hw1 * Math.abs(-s1 * ax + c1 * ay);
    const r2 = hl2 * Math.abs(c2 * ax + s2 * ay) + hw2 * Math.abs(-s2 * ax + c2 * ay);
    const d = dx * ax + dy * ay;
    const overlap = r1 + r2 - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < minDepth) {
      minDepth = overlap;
      const sg = d >= 0 ? 1 : -1;
      nx = ax * sg; ny = ay * sg;
    }
  }
  // contact point: deepest vertex of box1 along -n, or of box2 along n
  let best = -1e9, px = x1, py = y1;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const vx = x1 + sx * hl1 * c1 - sy * hw1 * s1, vy = y1 + sx * hl1 * s1 + sy * hw1 * c1;
    const p = -(vx * nx + vy * ny);
    if (p > best) { best = p; px = vx; py = vy; }
  }
  return { nx, ny, depth: minDepth, px, py };
}
