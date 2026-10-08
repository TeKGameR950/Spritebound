import { RNG, hash2 } from '../../shared/rng.js';
import { fbm, valueNoise } from '../../shared/noise.js';
import { T, MAP_W, MAP_H, TILE, FLOOR_H, D, BSTYLE, ROOF, POI, DISTRICTS } from '../../shared/constants.js';
import { PROP_ID } from '../../shared/props.js';
import {
  riverX, RIVER_HALF, isOcean, isRiver, isRockBorder, districtAt, inPeninsula, inPier, PIERS, PENINSULA, DOWNTOWN_CENTER,
} from './layout.js';

const W = MAP_W, H = MAP_H;
const N = 0, E = 1, S = 2, Wd = 3;

const URBAN = new Set([D.downtown, D.market, D.oldtown, D.docks, D.beach]);
const SUBURB = new Set([D.willow, D.maple, D.estates]);

export function generateWorld(seed = 1337) {
  const g = new Gen(seed);
  g.run();
  return g.output();
}

class Gen {
  constructor(seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.ground = new Uint8Array(W * H).fill(T.GRASS);
    this.district = new Uint8Array(W * H);
    this.road = new Uint8Array(W * H); // 1 road, 2 bridge
    this.bgrid = new Int32Array(W * H).fill(-1);
    this.avail = new Uint8Array(W * H);
    this.occ = new Uint8Array(W * H); // prop occupancy
    this.water = new Uint8Array(W * H); // 1 ocean, 2 river, 3 lake/pond
    this.buildings = [];
    this.props = [];
    this.parking = [];
    this.pois = [];
    this.blocks = [];
    this.pedZones = [];
    this.spawns = [];
    this.collectibles = [];
    this.pickups = [];
  }

  idx(x, y) { return y * W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  g(x, y) { return this.inb(x, y) ? this.ground[y * W + x] : T.ROCK; }
  set(x, y, t) { if (this.inb(x, y)) this.ground[y * W + x] = t; }
  fill(x, y, w, h, t) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, t);
  }

  run() {
    this.nature();
    this.roadGrid();
    this.paintRoads();
    this.distances();
    this.findBlocks();
    this.assignSpecials();
    for (const b of this.blocks) this.fillBlock(b);
    this.beachAndCoast();
    this.streetFurniture();
    this.finalizeDistricts();
    this.placeCollectibles();
    this.placePickups();
  }

  // ---------------------------------------------------------------- nature
  nature() {
    const s = this.seed;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (isOcean(x, y)) { this.ground[i] = T.DEEP; this.water[i] = 1; continue; }
        if (isRiver(x, y) && y < 460) { this.ground[i] = T.DEEP; this.water[i] = 2; continue; }
        if (isRockBorder(x, y, s)) { this.ground[i] = T.ROCK; continue; }
        const forest = x < 152 && y < 146 || x < 44 || y < 38;
        if (forest) {
          const n = fbm(x * 0.06, y * 0.06, s + 9, 4);
          this.ground[i] = n > 0.56 ? T.GRASS : n < 0.36 ? T.DIRT : T.FOREST;
          if (n < 0.3) this.ground[i] = T.FOREST;
        }
      }
    }
    // Shallow water rings around land.
    const dist = bfsDist(W, H, (i) => this.water[i] === 0, 6);
    for (let i = 0; i < W * H; i++) {
      if (!this.water[i]) continue;
      const d = dist[i];
      const lim = this.water[i] === 2 ? 2 : 3;
      if (d <= lim) this.ground[i] = T.WATER;
    }
    // Peninsula rocks and grass
    for (let y = 430; y < H; y++) for (let x = 460; x < W; x++) {
      if (!inPeninsula(x, y)) continue;
      const dx = x - PENINSULA.cx, dy = y - PENINSULA.cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = valueNoise(x * 0.3, y * 0.3, s + 3);
      this.ground[this.idx(x, y)] = r > PENINSULA.r - 2.5 - n * 2 && y > 446 ? T.ROCK : T.GRASS;
    }
    for (const p of PIERS) this.fill(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, T.CONCRETE);
  }

  // ---------------------------------------------------------------- roads
  roadGrid() {
    const r = this.rng;
    const lines = (start, end, targets, gapLo, gapHi) => {
      const out = [];
      let p = start;
      const tg = [...targets];
      while (p < end) {
        while (tg.length && p > tg[0] + 14) tg.shift();
        let art = false;
        if (tg.length && Math.abs(p - tg[0]) <= 14) { art = true; tg.shift(); }
        const w = art ? 8 : 4;
        out.push({ p, w, art });
        p += w + r.int(gapLo, gapHi);
      }
      return out;
    };
    this.vl = lines(32, 470, [66, 238, 330, 432], 21, 26);
    this.hl = lines(36, 392, [150, 298], 21, 26);
    const last = this.hl[this.hl.length - 1];
    const by = Math.max(last.p + last.w + 18, 414);
    this.hl.push({ p: by, w: 8, art: true, beach: true });
    this.beachY = by + 8 + 2;

    const nv = this.vl.length, nh = this.hl.length;
    this.nodes = [];
    for (let j = 0; j < nh; j++) for (let i = 0; i < nv; i++) {
      this.nodes.push({ id: j * nv + i, i, j, x: this.vl[i].p, y: this.hl[j].p, w: this.vl[i].w, h: this.hl[j].w, edges: [] });
    }
    const cellD = (i, j) => {
      if (i < 0 || j < 0 || i >= nv - 1 || j >= nh - 1) {
        // outside the grid: beach below the last line, wild elsewhere
        if (j >= nh - 1 && i >= 0 && i < nv - 1) return D.beach;
        return D.wild;
      }
      const cx = (this.vl[i].p + this.vl[i + 1].p + this.vl[i + 1].w) / 2;
      const cy = (this.hl[j].p + this.hl[j + 1].p + this.hl[j + 1].w) / 2;
      return districtAt(cx, cy, this.beachY);
    };
    this.cellD = cellD;

    this.edges = [];
    const tryEdge = (a, b, dir, line, cells) => {
      const na = this.nodes[a], nb = this.nodes[b];
      const x0 = na.x, y0 = na.y;
      const x1 = dir === 'h' ? nb.x + nb.w : na.x + na.w;
      const y1 = dir === 'h' ? na.y + na.h : nb.y + nb.h;
      let river = 0, bad = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!this.inb(x, y)) { bad++; continue; }
        const i = this.idx(x, y);
        const gt = this.ground[i];
        if (this.water[i] === 1 || gt === T.ROCK) bad++;
        else if (this.water[i] === 2) river++;
      }
      if (bad) return;
      let bridge = false;
      if (river) {
        if (dir !== 'h') return;
        if (!(line.art || r.chance(0.3))) return;
        bridge = true;
      }
      const [c1, c2] = cells;
      const art = line.art;
      if (c1 === D.park && c2 === D.park) return;
      if (!art) {
        if (c1 === D.park && c2 === D.park) return;
        if (c1 === D.wild && c2 === D.wild && r.chance(0.8)) return;
        if ((c1 === D.wild) !== (c2 === D.wild) && r.chance(0.45)) return;
        if (c1 === D.docks && c2 === D.docks && r.chance(0.42)) return;
        if (dir === 'v' && SUBURB.has(c1) && SUBURB.has(c2) && r.chance(0.55)) return;
        if (c1 === D.beach && c2 === D.beach) return;
        if (c1 === D.point || c2 === D.point) return;
      }
      const e = { id: this.edges.length, a, b, dir, w: line.w, art, bridge, line, lanes: art ? 2 : 1, x0, y0, x1, y1 };
      this.edges.push(e);
    };
    for (let j = 0; j < nh; j++) for (let i = 0; i < nv - 1; i++) {
      tryEdge(j * nv + i, j * nv + i + 1, 'h', this.hl[j], [cellD(i, j - 1), cellD(i, j)]);
    }
    for (let i = 0; i < nv; i++) for (let j = 0; j < nh - 1; j++) {
      tryEdge(j * nv + i, (j + 1) * nv + i, 'v', this.vl[i], [cellD(i - 1, j), cellD(i, j)]);
    }
    this.pruneGraph();
  }

  pruneGraph() {
    const rebuild = () => {
      for (const n of this.nodes) n.edges = [];
      for (const e of this.edges) { this.nodes[e.a].edges.push(e.id); this.nodes[e.b].edges.push(e.id); }
    };
    let changed = true;
    while (changed) {
      changed = false;
      rebuild();
      const keep = this.edges.filter((e) => this.nodes[e.a].edges.length > 1 && this.nodes[e.b].edges.length > 1);
      if (keep.length !== this.edges.length) { this.edges = keep; changed = true; }
    }
    rebuild();
    // largest connected component
    const comp = new Int32Array(this.nodes.length).fill(-1);
    let best = -1, bestSize = 0, c = 0;
    for (const n of this.nodes) {
      if (comp[n.id] >= 0 || !n.edges.length) continue;
      const st = [n.id]; comp[n.id] = c; let size = 0;
      while (st.length) {
        const k = st.pop(); size++;
        for (const eid of this.nodes[k].edges) {
          const e = this.edges.find((q) => q.id === eid);
          const o = e.a === k ? e.b : e.a;
          if (comp[o] < 0) { comp[o] = c; st.push(o); }
        }
      }
      if (size > bestSize) { bestSize = size; best = c; }
      c++;
    }
    this.edges = this.edges.filter((e) => comp[e.a] === best);
    this.edges.forEach((e, k) => (e.id = k));
    rebuild();
    for (const n of this.nodes) {
      let h = 0, v = 0, art = 0;
      for (const eid of n.edges) {
        const e = this.edges[eid];
        if (e.dir === 'h') h++; else v++;
        if (e.art) art++;
      }
      n.inter = h > 0 && v > 0;
      const d = districtAt(n.x + n.w / 2, n.y + n.h / 2, this.beachY);
      n.district = d;
      n.signal = n.inter && n.edges.length >= 3 && (art > 0 || d === D.downtown) && d !== D.wild;
      n.cross = n.inter && (URBAN.has(d) || n.signal);
    }
  }

  paintRoads() {
    for (const e of this.edges) {
      const n0 = this.nodes[e.a], n1 = this.nodes[e.b];
      const cobble = !e.art && districtAt((n0.x + n1.x) / 2, (n0.y + n1.y) / 2, this.beachY) === D.oldtown;
      for (let y = e.y0; y < e.y1; y++) for (let x = e.x0; x < e.x1; x++) {
        const i = this.idx(x, y);
        if (this.water[i]) { this.ground[i] = T.BRIDGE; this.road[i] = 2; continue; }
        if (this.road[i] && this.ground[i] === T.ASPHALT) continue;
        this.ground[i] = cobble ? T.COBBLE : T.ASPHALT;
        this.road[i] = 1;
      }
    }
    // bridges get railings at their outer edges: handled as props later
  }

  distances() {
    this.roadDist = bfsDist(W, H, (i) => this.road[i] > 0, 4, true);
    this.waterDist = bfsDist(W, H, (i) => this.water[i] > 0 && this.ground[i] !== T.BRIDGE, 3, true);
  }

  // ---------------------------------------------------------------- blocks
  findBlocks() {
    const label = new Int32Array(W * H).fill(-1);
    const isLand = (i) => !this.road[i] && !this.water[i] && this.ground[i] !== T.ROCK;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i0 = this.idx(x, y);
      if (label[i0] >= 0 || !isLand(i0)) continue;
      const id = this.blocks.length;
      const tiles = [];
      const st = [i0]; label[i0] = id;
      let x0 = x, y0 = y, x1 = x, y1 = y, sx = 0, sy = 0;
      while (st.length) {
        const i = st.pop();
        tiles.push(i);
        const tx = i % W, ty = (i / W) | 0;
        sx += tx; sy += ty;
        if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
        const nb = [i - 1, i + 1, i - W, i + W];
        if (tx === 0) nb[0] = -1; if (tx === W - 1) nb[1] = -1;
        for (const k of nb) {
          if (k < 0 || k >= W * H || label[k] >= 0 || !isLand(k)) continue;
          label[k] = id; st.push(k);
        }
      }
      const cx = sx / tiles.length, cy = sy / tiles.length;
      this.blocks.push({ id, tiles, x0, y0, x1: x1 + 1, y1: y1 + 1, cx, cy, district: districtAt(cx, cy, this.beachY) });
    }
    this.blockLabel = label;
  }

  assignSpecials() {
    const want = [
      ['cityhall', D.downtown, DOWNTOWN_CENTER.x, DOWNTOWN_CENTER.y],
      ['clinicE', D.market, 372, 352],
      ['clinicW', D.willow, 118, 262],
      ['police', D.market, 262, 182],
      ['policeW', D.oldtown, 108, 368],
      ['gas1', D.maple, 230, 120],
      ['gas2', D.docks, 420, 300],
      ['gas3', D.willow, 82, 196],
      ['gas4', D.market, 214, 360],
      ['marketsq', D.oldtown, 140, 380],
      ['taxi', D.market, 380, 236],
      ['dealer', D.market, 212, 210],
      ['plaza2', D.downtown, 262, 300],
    ];
    const taken = new Set();
    for (const [tag, dist, tx, ty] of want) {
      let best = null, bd = 1e9;
      for (const b of this.blocks) {
        if (b.district !== dist || taken.has(b.id) || b.tiles.length < 200) continue;
        const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
        if (b.tiles.length < 0.85 * bw * bh) continue;
        const d = (b.cx - tx) ** 2 + (b.cy - ty) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (best) { best.special = tag; taken.add(best.id); }
    }
  }

  sidewalkDepth(d) {
    if (d === D.wild || d === D.point) return 0;
    return 2;
  }

  fillBlock(b) {
    const d = b.district;
    const sd = this.sidewalkDepth(d);
    const interior = [];
    for (const i of b.tiles) {
      const rd = this.roadDist[i];
      this.district[i] = d;
      if (sd && rd <= sd) {
        if (SUBURB.has(d) && rd === 2) this.ground[i] = T.GRASS;
        else this.ground[i] = T.SIDEWALK;
        continue;
      }
      if (this.waterDist[i] <= 2 && (URBAN.has(d) || SUBURB.has(d) || d === D.river)) {
        this.ground[i] = T.PLAZA;
        continue;
      }
      interior.push(i);
    }
    if (!interior.length) return;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const i of interior) {
      const x = i % W, y = (i / W) | 0;
      this.avail[i] = 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const R = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    b.inner = R;
    const rectish = interior.length >= 0.92 * R.w * R.h;
    b.rect = rectish;
    const rr = this.rng.fork(b.id * 7919);
    // sidewalk ring for pedestrians: only for proper blocks with sidewalks
    if (sd && rectish && R.w >= 4 && R.h >= 4) {
      this.pedZones.push({ k: 'ring', x0: (R.x - 1) * TILE, y0: (R.y - 1) * TILE, x1: (R.x + R.w + 1) * TILE, y1: (R.y + R.h + 1) * TILE, d });
    }
    if (b.special) return this.fillSpecial(b, R, rr);
    if (!rectish) return this.fillIrregular(b, interior, rr);
    switch (d) {
      case D.downtown: return rectish ? this.fillDowntown(b, R, rr) : this.fillGreen(b, interior, rr, 'plaza');
      case D.market: return rectish ? this.fillMarket(b, R, rr) : this.fillGreen(b, interior, rr, 'garden');
      case D.oldtown: return rectish ? this.fillOldtown(b, R, rr) : this.fillGreen(b, interior, rr, 'garden');
      case D.willow: case D.maple: case D.estates:
        return rectish ? this.fillSuburb(b, R, rr) : this.fillGreen(b, interior, rr, 'garden');
      case D.park: return this.fillPark(b, interior, R, rr);
      case D.docks: return rectish ? this.fillDocks(b, R, rr) : this.fillYard(b, interior, rr);
      case D.beach: return this.fillGreen(b, interior, rr, 'beach');
      case D.point: return this.fillPoint(b, interior, rr);
      case D.river: return this.fillGreen(b, interior, rr, 'garden');
      default: return this.fillWild(b, interior, rr);
    }
  }

  // Irregular regions (cut by river, coast or map edge): fill each tile by its own district.
  fillIrregular(b, interior, rr) {
    const groups = new Map();
    for (const i of interior) {
      const d = districtAt(i % W, (i / W) | 0, this.beachY);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(i);
    }
    for (const [d, tiles] of groups) {
      if (d === D.wild) this.fillWild(b, tiles, rr);
      else if (d === D.beach) this.fillGreen(b, tiles, rr, 'beach');
      else if (d === D.point) this.fillPoint(b, tiles, rr);
      else if (d === D.park && tiles.length > 400) {
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (const i of tiles) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        this.fillPark(b, tiles, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, rr);
      } else if (d === D.docks) this.fillYard(b, tiles, rr);
      else this.fillRiverside(b, tiles, rr);
    }
  }

  fillRiverside(b, tiles, rr) {
    for (const i of tiles) {
      if (!this.avail[i]) continue;
      const x = i % W, y = (i / W) | 0;
      this.avail[i] = 0;
      this.ground[i] = T.GRASS;
      if (this.waterDist[i] === 3) { this.ground[i] = T.GRAVEL; if (hash2(x, y, 5) < 0.04) this.propAt('bench', x, y, 0, 0); else if (hash2(x, y, 6) < 0.05) this.propAt('lamp', x, y, 0, 1); continue; }
      if (this.occ[i]) continue;
      const h = hash2(x, y, this.seed + 55);
      if (h < 0.08) {
        if (this.occ[i - 1] || this.occ[i - W]) continue;
        this.propAt(rr.weighted([['oak', 4], ['cherry', 3], ['birch', 2], ['pine', 1]]), x, y, rr.range(0, 6.28), rr.int(0, 3), 5, rr);
      } else if (h < 0.12) this.propAt('flowers', x, y, rr.range(0, 6.28), rr.int(0, 5), 5, rr);
      else if (h < 0.14) this.propAt('bush', x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      else if (h < 0.143) this.propAt('picnic', x, y, rr.pick([0, Math.PI / 2]), rr.int(0, 3), 2, rr);
    }
  }

  // ------------------------------------------------------------- building helpers
  rectAvail(x, y, w, h) {
    if (w < 1 || h < 1) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.inb(i, j) || !this.avail[this.idx(i, j)]) return false;
    }
    return true;
  }
  take(x, y, w, h, ground) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.inb(i, j)) continue;
      const k = this.idx(i, j);
      this.avail[k] = 0;
      if (ground !== undefined) this.ground[k] = ground;
    }
  }
  addBuilding(o) {
    const id = this.buildings.length;
    const b = {
      id, x: o.x, y: o.y, w: o.w, h: o.h, floors: o.floors, style: o.style, roof: o.roof ?? ROOF.FLAT,
      rc: o.rc ?? 0, wc: o.wc ?? 0, seed: (this.rng.next() * 1e9) | 0, door: o.door ?? null,
      awn: o.awn ?? -1, poi: o.poi ?? null, open: !!o.open, sign: o.sign ?? null, water: !!o.water,
    };
    this.buildings.push(b);
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) {
      if (!this.inb(i, j)) continue;
      const k = this.idx(i, j);
      this.avail[k] = 0;
      if (!b.open) {
        this.bgrid[k] = id;
        if (!b.water) this.ground[k] = T.FLOOR;
      }
    }
    return b;
  }
  prop(key, wx, wy, rot = 0, z = 0, v = 0) {
    const t = PROP_ID[key];
    if (t === undefined) throw new Error('unknown prop ' + key);
    this.props.push([t, Math.round(wx * 2) / 2, Math.round(wy * 2) / 2, Math.round(rot * 100) / 100, z, v | 0]);
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (this.inb(tx, ty)) this.occ[this.idx(tx, ty)] = 1;
  }
  propAt(key, tx, ty, rot = 0, v = 0, jitter = 0, rr = this.rng) {
    const jx = jitter ? rr.range(-jitter, jitter) : 0, jy = jitter ? rr.range(-jitter, jitter) : 0;
    this.prop(key, tx * TILE + 8 + jx, ty * TILE + 8 + jy, rot, 0, v);
  }
  // Pick the side of rect P touching the road-facing boundary of R.
  doorFor(P, R, rr) {
    const sides = [];
    if (P.y === R.y) sides.push(N);
    if (P.y + P.h === R.y + R.h) sides.push(S);
    if (P.x === R.x) sides.push(Wd);
    if (P.x + P.w === R.x + R.w) sides.push(E);
    if (!sides.length) sides.push(rr.int(0, 3));
    const side = rr.pick(sides);
    const len = side === N || side === S ? P.w : P.h;
    return { side, t: Math.max(0, Math.min(len - 1, Math.floor(len / 2) + rr.int(-1, 1))) };
  }
  roofDetails(b, rr, level = 1) {
    if (b.roof !== ROOF.FLAT || b.open) return;
    const z = b.floors * FLOOR_H;
    const x0 = b.x * TILE, y0 = b.y * TILE, ww = b.w * TILE, hh = b.h * TILE;
    const spots = [];
    const place = (key, m, v = 0, rot = 0) => {
      for (let tries = 0; tries < 8; tries++) {
        const px = x0 + m + rr.range(0, Math.max(1, ww - 2 * m)), py = y0 + m + rr.range(0, Math.max(1, hh - 2 * m));
        if (spots.some(([sx, sy, sr]) => (sx - px) ** 2 + (sy - py) ** 2 < (sr + m) ** 2)) continue;
        spots.push([px, py, m]);
        this.prop(key, px, py, rot, z, v);
        return true;
      }
      return false;
    };
    const area = b.w * b.h;
    if (b.style === BSTYLE.CLINIC || (b.style === BSTYLE.TOWER && area >= 100 && rr.chance(0.45))) {
      spots.push([x0 + ww / 2, y0 + hh / 2, 30]);
      this.prop('heli', x0 + ww / 2, y0 + hh / 2, 0, z, b.style === BSTYLE.CLINIC ? 1 : 0);
    }
    if (rr.chance(0.18) && area >= 30 && b.style !== BSTYLE.WAREHOUSE) {
      const n = Math.min(8, Math.floor(area / 10));
      for (let k = 0; k < n; k++) place('roofgarden', 12, rr.int(0, 3));
    }
    const nAc = Math.min(6, 1 + Math.floor(area / 40 * level));
    for (let k = 0; k < nAc; k++) place('acunit', 9, rr.int(0, 2), rr.pick([0, Math.PI / 2]));
    if (rr.chance(0.6)) place('vent', 6, rr.int(0, 1));
    if (area >= 60 && rr.chance(0.5)) place('watertank', 14, 0);
    if (rr.chance(0.3) && area >= 24) {
      const n = rr.int(2, 5);
      for (let k = 0; k < n; k++) place('solar', 10, 0, 0);
    }
    if ((b.style === BSTYLE.TOWER || b.style === BSTYLE.GLASS) && rr.chance(0.6)) place('antenna', 5, 0);
  }

  // ------------------------------------------------------------- district fills
  bsp(R, min, maxParts, rr, gap = 1) {
    const out = [];
    const split = (r, depth) => {
      const canW = r.w >= min * 2 + gap, canH = r.h >= min * 2 + gap;
      if (out.length + depth >= maxParts || (!canW && !canH) || (depth > 0 && rr.chance(0.25))) { out.push(r); return; }
      const vert = canW && (!canH || r.w > r.h || (r.w === r.h && rr.chance(0.5)));
      if (vert) {
        const s = rr.int(min, r.w - min - gap);
        split({ x: r.x, y: r.y, w: s, h: r.h }, depth + 1);
        split({ x: r.x + s + gap, y: r.y, w: r.w - s - gap, h: r.h }, depth + 1);
      } else {
        const s = rr.int(min, r.h - min - gap);
        split({ x: r.x, y: r.y, w: r.w, h: s }, depth + 1);
        split({ x: r.x, y: r.y + s + gap, w: r.w, h: r.h - s - gap }, depth + 1);
      }
    };
    split(R, 0);
    return out;
  }

  fillDowntown(b, R, rr) {
    const kind = rr.weighted([['towers', 80], ['plaza', 6], ['parking', 8], ['pocket', 6]]);
    if (kind === 'plaza' || R.w < 8 || R.h < 8) return this.plaza(R, rr, false);
    if (kind === 'parking') return this.parkingLot(R, rr, D.downtown);
    if (kind === 'pocket') return this.pocketPark(R, rr);
    const dc = Math.hypot(b.cx - DOWNTOWN_CENTER.x, b.cy - DOWNTOWN_CENTER.y);
    const tall = Math.max(0, 1 - dc / 95);
    const parts = this.bsp(R, 7, rr.int(1, 4), rr, 1);
    for (const P of parts) {
      this.take(P.x, P.y, P.w, P.h, T.CONCRETE);
      for (let j = P.y; j < P.y + P.h; j++) for (let i = P.x; i < P.x + P.w; i++) this.avail[this.idx(i, j)] = 1;
      // occasional forecourt facing the street
      let B = { ...P };
      if (P.w * P.h > 90 && rr.chance(0.35)) {
        const door = this.doorFor(P, R, rr);
        if (door.side === N) { B.y += 2; B.h -= 2; this.fill(P.x, P.y, P.w, 2, T.PLAZA); }
        if (door.side === S) { B.h -= 2; this.fill(P.x, P.y + P.h - 2, P.w, 2, T.PLAZA); }
        if (door.side === Wd) { B.x += 2; B.w -= 2; this.fill(P.x, P.y, 2, P.h, T.PLAZA); }
        if (door.side === E) { B.w -= 2; this.fill(P.x + P.w - 2, P.y, 2, P.h, T.PLAZA); }
        this.take(P.x, P.y, P.w, P.h);
        for (let j = B.y; j < B.y + B.h; j++) for (let i = B.x; i < B.x + B.w; i++) this.avail[this.idx(i, j)] = 1;
      }
      const floors = Math.max(4, Math.min(15, Math.round(4 + tall * 9 + rr.range(-1, 3) + (B.w * B.h > 120 ? 1 : 0))));
      const style = floors >= 10 ? rr.pick([BSTYLE.TOWER, BSTYLE.GLASS, BSTYLE.GLASS]) : rr.pick([BSTYLE.OFFICE, BSTYLE.TOWER, BSTYLE.APARTMENT, BSTYLE.GLASS]);
      const bd = this.addBuilding({ ...B, floors, style, wc: rr.int(0, 7), rc: rr.int(0, 3), door: this.doorFor(B, R, rr), awn: -1 });
      this.roofDetails(bd, rr, 1.4);
    }
    this.alleyFill(R, rr);
  }

  // Fill any leftover avail tiles in R as alleys with clutter.
  alleyFill(R, rr) {
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      const k = this.idx(i, j);
      if (!this.avail[k]) continue;
      this.ground[k] = T.CONCRETE;
      this.avail[k] = 0;
      if (rr.chance(0.07)) this.propAt(rr.pick(['dumpster', 'trash', 'crate', 'barrel', 'pallet']), i, j, rr.pick([0, Math.PI / 2]), rr.int(0, 3), 2, rr);
    }
  }

  plaza(R, rr, civic) {
    this.take(R.x, R.y, R.w, R.h, T.PLAZA);
    const cx = (R.x + R.w / 2) * TILE, cy = (R.y + R.h / 2) * TILE;
    // checker paving ring
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      const dx = i + 0.5 - (R.x + R.w / 2), dy = j + 0.5 - (R.y + R.h / 2);
      if (Math.abs(Math.hypot(dx, dy) - Math.min(R.w, R.h) * 0.32) < 0.8) this.set(i, j, T.TILES);
    }
    if (!civic) {
      if (rr.chance(0.6)) this.prop('fountain', cx, cy, 0, 0, rr.int(0, 1));
      else this.prop('statue', cx, cy, rr.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), 0, rr.int(0, 2));
    }
    // trees in planters at corners and benches
    const inset = 2;
    const corners = [[R.x + inset, R.y + inset], [R.x + R.w - 1 - inset, R.y + inset], [R.x + inset, R.y + R.h - 1 - inset], [R.x + R.w - 1 - inset, R.y + R.h - 1 - inset]];
    for (const [tx, ty] of corners) {
      this.propAt('planter', tx, ty, 0, rr.int(0, 2));
      this.propAt(rr.pick(['cherry', 'oak', 'birch']), tx, ty, rr.range(0, 6.28), rr.int(0, 3));
    }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const rad = Math.min(R.w, R.h) * 0.32 * TILE + 14;
      this.prop('bench', cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, a + Math.PI / 2, 0, 0);
    }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const rad = Math.min(R.w, R.h) * 0.42 * TILE;
      this.prop('lamp', cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, a, 0, 1);
    }
    this.pedZones.push({ k: 'area', x0: R.x * TILE, y0: R.y * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE });
  }

  pocketPark(R, rr) {
    this.take(R.x, R.y, R.w, R.h, T.GRASS);
    // cross paths
    const mx = R.x + (R.w >> 1), my = R.y + (R.h >> 1);
    this.fill(mx - 1, R.y, 2, R.h, T.GRAVEL);
    this.fill(R.x, my - 1, R.w, 2, T.GRAVEL);
    for (let k = 0; k < R.w * R.h / 14; k++) {
      const tx = rr.int(R.x, R.x + R.w - 1), ty = rr.int(R.y, R.y + R.h - 1);
      const gt = this.g(tx, ty);
      if (gt !== T.GRASS || this.occ[this.idx(tx, ty)]) continue;
      this.propAt(rr.weighted([['oak', 4], ['cherry', 3], ['birch', 2], ['bush', 3], ['flowers', 4]]), tx, ty, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
    }
    this.prop('bench', (mx - 2) * TILE, (my - 2) * TILE + 4, Math.PI / 2, 0, 0);
    this.prop('bench', (mx + 2) * TILE, (my + 2) * TILE - 4, -Math.PI / 2, 0, 0);
    this.prop('lamp', mx * TILE, my * TILE, 0, 0, 1);
    this.pedZones.push({ k: 'area', x0: R.x * TILE, y0: R.y * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE });
  }

  parkingLot(R, rr, d) {
    this.take(R.x, R.y, R.w, R.h, T.PARKING);
    // rows of bays running horizontally: each bay is 2 tiles wide, 3 deep; aisle 4 tiles
    let y = R.y + 1;
    const rows = [];
    while (y + 3 <= R.y + R.h - 1) {
      rows.push({ y, facing: rows.length % 2 === 0 ? S : N });
      y += 3;
      if (rows.length % 2 === 1) y += 4;
    }
    for (const row of rows) {
      for (let x = R.x + 1; x + 2 <= R.x + R.w - 1; x += 2) {
        const wx = (x + 1) * TILE, wy = (row.y + 1.5) * TILE;
        const a = row.facing === S ? Math.PI / 2 : -Math.PI / 2;
        this.parking.push({ x: wx, y: wy, a: a + (rr.chance(0.5) ? Math.PI : 0), d, p: 0.55, bay: [x, row.y, row.facing] });
      }
    }
    this.lots = this.lots || [];
    this.lots.push({ x: R.x, y: R.y, w: R.w, h: R.h, rows });
    if (R.w > 6) this.prop('lamp', (R.x + R.w / 2) * TILE, (R.y + R.h / 2) * TILE, 0, 0, 1);
  }

  fillMarket(b, R, rr) {
    if (R.w < 8 || R.h < 8) {
      if (R.w >= 5 && R.h >= 5) return this.pocketPark(R, rr);
      return this.alleyFill(R, rr);
    }
    if (rr.chance(0.07)) return this.parkingLot(R, rr, D.market);
    const lots = this.perimeterLots(R, [7, 9], [5, 9], rr, 0.25);
    for (const L of lots) {
      if (!this.rectAvail(L.x, L.y, L.w, L.h)) continue;
      const style = rr.weighted([[BSTYLE.SHOP, 55], [BSTYLE.APARTMENT, 25], [BSTYLE.BRICK, 20]]);
      const floors = style === BSTYLE.SHOP ? rr.int(2, 4) : rr.int(3, 6);
      const door = { side: L.side, t: Math.floor((L.side === N || L.side === S ? L.w : L.h) / 2) };
      const bd = this.addBuilding({ ...L, floors, style, wc: rr.int(0, 9), rc: rr.int(0, 3), door, awn: style === BSTYLE.SHOP ? rr.int(0, 7) : -1 });
      this.roofDetails(bd, rr);
      if (style === BSTYLE.SHOP && rr.chance(0.35)) this.shopFront(bd, rr);
    }
    this.courtyard(R, rr, 'market');
  }

  // Outdoor details in front of a shop door: cafe tables, vending, bike rack.
  shopFront(bd, rr) {
    const [dx, dy, nx, ny] = this.doorWorld(bd);
    const tx = Math.floor((dx + nx * 20) / TILE), ty = Math.floor((dy + ny * 20) / TILE);
    if (this.g(tx, ty) !== T.SIDEWALK) return;
    const px = -ny, py = nx;
    const kind = rr.weighted([['cafe', 3], ['vending', 2], ['bike', 2], ['plants', 3]]);
    if (kind === 'cafe') {
      this.prop('cafetable', dx + nx * 10 + px * 18, dy + ny * 10 + py * 18, 0, 0, rr.int(0, 3));
      this.prop('cafetable', dx + nx * 10 - px * 18, dy + ny * 10 - py * 18, 0, 0, rr.int(0, 3));
    } else if (kind === 'vending') {
      this.prop('vending', dx + nx * 5 + px * 16, dy + ny * 5 + py * 16, Math.atan2(ny, nx), 0, rr.int(0, 2));
    } else if (kind === 'bike') {
      this.prop('bikerack', dx + nx * 8 + px * 18, dy + ny * 8 + py * 18, Math.atan2(py, px), 0, rr.int(0, 3));
    } else {
      this.prop('planter', dx + nx * 6 + px * 14, dy + ny * 6 + py * 14, 0, 2);
      this.prop('planter', dx + nx * 6 - px * 14, dy + ny * 6 - py * 14, 0, 2);
    }
  }

  // world coords of the point just outside a building's door, and outward normal
  doorWorld(bd) {
    const d = bd.door || { side: S, t: 0 };
    const x0 = bd.x * TILE, y0 = bd.y * TILE, x1 = (bd.x + bd.w) * TILE, y1 = (bd.y + bd.h) * TILE;
    switch (d.side) {
      case N: return [x0 + d.t * TILE + 8, y0, 0, -1];
      case S: return [x0 + d.t * TILE + 8, y1, 0, 1];
      case Wd: return [x0, y0 + d.t * TILE + 8, -1, 0];
      default: return [x1, y0 + d.t * TILE + 8, 1, 0];
    }
  }

  perimeterLots(R, depthR, widthR, rr, gapChance = 0, attached = false) {
    const lots = [];
    const d = rr.int(depthR[0], depthR[1]);
    const twoRows = R.h >= d * 2 + 2;
    const twoCols = R.w >= d * 2 + 2;
    const run = (len, cb) => {
      let p = 0;
      while (p < len) {
        let w = rr.int(widthR[0], widthR[1]);
        if (len - p - w < widthR[0]) w = len - p;
        if (w > widthR[1] + 3) { w = Math.ceil(w / 2); }
        cb(p, w);
        p += w;
        if (!attached && p < len && rr.chance(gapChance)) {
          cb(p, 0, true);
          p += rr.int(1, 2);
        }
      }
    };
    const dd = (rows) => (rows ? d : R.h);
    run(R.w, (p, w, gap) => {
      if (gap || !w) return;
      lots.push({ x: R.x + p, y: R.y, w, h: twoRows ? d : R.h, side: N });
    });
    if (twoRows) {
      run(R.w, (p, w, gap) => {
        if (gap || !w) return;
        lots.push({ x: R.x + p, y: R.y + R.h - d, w, h: d, side: S });
      });
      if (twoCols) {
        const ys = R.y + d, ye = R.y + R.h - d;
        if (ye - ys >= widthR[0]) {
          run(ye - ys, (p, w, gap) => { if (!gap && w) lots.push({ x: R.x, y: ys + p, w: d, h: w, side: Wd }); });
          run(ye - ys, (p, w, gap) => { if (!gap && w) lots.push({ x: R.x + R.w - d, y: ys + p, w: d, h: w, side: E }); });
        }
      }
    }
    void dd;
    return lots;
  }

  courtyard(R, rr, flavor) {
    // remaining avail tiles inside R: find their bbox
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      if (!this.avail[this.idx(i, j)]) continue;
      n++;
      if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
    }
    if (!n) return;
    const C = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const full = n >= C.w * C.h * 0.95;
    if (full && C.w >= 6 && C.h >= 6) {
      const kind = flavor === 'oldtown' ? rr.weighted([['garden', 6], ['patio', 3]]) : rr.weighted([['parking', 4], ['garden', 3], ['alley', 3]]);
      if (kind === 'parking' && C.w >= 6 && C.h >= 7) { this.parkingLot(C, rr, D.market); }
      else if (kind === 'garden' || kind === 'patio') {
        this.take(C.x, C.y, C.w, C.h, kind === 'patio' ? T.TILES : T.GRASS);
        for (let k = 0; k < (C.w * C.h) / 12; k++) {
          const tx = rr.int(C.x, C.x + C.w - 1), ty = rr.int(C.y, C.y + C.h - 1);
          if (this.occ[this.idx(tx, ty)]) continue;
          const key = rr.weighted([['oak', 3], ['cherry', 3], ['bush', 3], ['flowers', 4], ['bench', 1], ['picnic', 1]]);
          this.propAt(key, tx, ty, key === 'bench' || key === 'picnic' ? rr.pick([0, Math.PI / 2]) : rr.range(0, 6.28), rr.int(0, 3), 3, rr);
        }
        if (flavor === 'oldtown' && rr.chance(0.4)) this.prop('well', (C.x + C.w / 2) * TILE, (C.y + C.h / 2) * TILE);
        this.pedZones.push({ k: 'area', x0: C.x * TILE, y0: C.y * TILE, x1: (C.x + C.w) * TILE, y1: (C.y + C.h) * TILE });
      }
    }
    this.alleyFill(R, rr);
  }

  fillOldtown(b, R, rr) {
    if (R.w < 8 || R.h < 8) {
      if (R.w >= 5 && R.h >= 5) return this.pocketPark(R, rr);
      return this.alleyFill(R, rr);
    }
    const lots = this.perimeterLots(R, [6, 8], [4, 7], rr, 0, true);
    for (const L of lots) {
      if (!this.rectAvail(L.x, L.y, L.w, L.h)) continue;
      const style = rr.weighted([[BSTYLE.BRICK, 45], [BSTYLE.APARTMENT, 25], [BSTYLE.SHOP, 30]]);
      const floors = rr.int(2, 4);
      const horiz = L.side === N || L.side === S;
      const roof = rr.chance(0.55) && L.w >= 4 && L.h >= 4 ? (horiz ? ROOF.GABLE_X : ROOF.GABLE_Y) : ROOF.FLAT;
      const door = { side: L.side, t: Math.floor((horiz ? L.w : L.h) / 2) };
      const bd = this.addBuilding({ ...L, floors, style, roof, wc: 10 + rr.int(0, 7), rc: 4 + rr.int(0, 3), door, awn: style === BSTYLE.SHOP ? rr.int(0, 7) : -1 });
      if (roof === ROOF.FLAT) this.roofDetails(bd, rr, 0.6);
      else if (rr.chance(0.6)) this.prop('chimney', (bd.x + rr.range(1, bd.w - 1)) * TILE, (bd.y + rr.range(1, bd.h - 1)) * TILE, 0, floors * FLOOR_H, 0);
      if (style === BSTYLE.SHOP && rr.chance(0.4)) this.shopFront(bd, rr);
    }
    this.courtyard(R, rr, 'oldtown');
  }

  fillSuburb(b, R, rr) {
    const d = b.district;
    const est = d === D.estates;
    if (R.w < 8 || R.h < 8) return this.fillGreen(b, this.availTiles(R), rr, 'garden');
    const lotW = est ? [12, 15] : [9, 11];
    const depth = est ? 12 : 10;
    const twoRows = R.h >= depth * 2 - 2;
    const rows = [];
    if (twoRows) {
      const dTop = Math.floor(R.h / 2);
      rows.push({ y: R.y, h: dTop, side: N });
      rows.push({ y: R.y + dTop, h: R.h - dTop, side: S });
    } else {
      rows.push({ y: R.y, h: R.h, side: rr.chance(0.5) ? N : S });
    }
    const roofColor = () => rr.int(0, 7);
    for (const row of rows) {
      let p = 0;
      while (p < R.w) {
        let w = rr.int(lotW[0], lotW[1]);
        if (R.w - p - w < lotW[0]) w = R.w - p;
        const L = { x: R.x + p, y: row.y, w, h: row.h };
        p += w;
        this.house(L, row.side, rr, est, roofColor);
      }
    }
    this.alleyFill(R, rr);
  }

  availTiles(R) {
    const out = [];
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) if (this.avail[this.idx(i, j)]) out.push(this.idx(i, j));
    return out;
  }

  house(L, side, rr, est, roofColor) {
    this.take(L.x, L.y, L.w, L.h, T.GRASS);
    for (let j = L.y; j < L.y + L.h; j++) for (let i = L.x; i < L.x + L.w; i++) this.avail[this.idx(i, j)] = 1;
    const setback = est ? 3 : 2;
    const hw = Math.max(5, Math.min(L.w - 4, est ? rr.int(8, 10) : rr.int(5, 7)));
    const hd = Math.max(4, Math.min(L.h - setback - 2, est ? rr.int(7, 9) : rr.int(5, 6)));
    if (L.h < setback + hd + 1 || L.w < hw + 3) {
      // too small: garden lot
      for (let k = 0; k < 3; k++) this.propAt(rr.pick(['oak', 'bush', 'cherry']), rr.int(L.x, L.x + L.w - 1), rr.int(L.y, L.y + L.h - 1), rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      this.take(L.x, L.y, L.w, L.h);
      return;
    }
    const driveLeft = rr.chance(0.5);
    const hx = driveLeft ? L.x + L.w - hw - 1 : L.x + 1;
    const hy = side === N ? L.y + setback : L.y + L.h - setback - hd;
    const floors = est ? rr.int(1, 2) : rr.chance(0.35) ? 2 : 1;
    const roof = rr.chance(0.12) ? ROOF.HIP : ROOF.GABLE_X;
    const door = { side, t: Math.floor(hw / 2) + (driveLeft ? -1 : 1) };
    const bd = this.addBuilding({ x: hx, y: hy, w: hw, h: hd, floors, style: BSTYLE.HOUSE, roof, wc: 20 + rr.int(0, 9), rc: roofColor(), door });
    if (rr.chance(0.55)) this.prop('chimney', (hx + (rr.chance(0.5) ? 1.5 : hw - 1.5)) * TILE, (hy + hd / 2) * TILE, 0, floors * FLOOR_H, 0);
    // driveway
    const dx = driveLeft ? L.x + 1 : L.x + L.w - 3;
    const dw = 2;
    if (side === N) this.fill(dx, L.y, dw, setback + hd - 1, T.CONCRETE);
    else this.fill(dx, hy + 1, dw, L.y + L.h - hy - 1, T.CONCRETE);
    const carY = side === N ? (L.y + 2.6) * TILE : (L.y + L.h - 2.6) * TILE;
    this.parking.push({ x: (dx + 1) * TILE, y: carY, a: side === N ? -Math.PI / 2 : Math.PI / 2, d: est ? D.estates : D.willow, p: 0.5 });
    // front path to door and flowerbed
    const doorX = hx + door.t;
    if (side === N) {
      this.fill(doorX, L.y, 1, setback, T.GRAVEL);
      for (let i = hx; i < hx + hw; i++) if (i !== doorX && rr.chance(0.7)) this.set(i, hy - 1, T.FLOWERBED);
      this.propAt('mailbox', doorX + 1, L.y, 0, rr.int(0, 3));
    } else {
      this.fill(doorX, hy + hd, 1, L.y + L.h - hy - hd, T.GRAVEL);
      for (let i = hx; i < hx + hw; i++) if (i !== doorX && rr.chance(0.7)) this.set(i, hy + hd, T.FLOWERBED);
      this.propAt('mailbox', doorX + 1, L.y + L.h - 1, 0, rr.int(0, 3));
    }
    // backyard
    const byY = side === N ? hy + hd : L.y;
    const byH = side === N ? L.y + L.h - (hy + hd) : hy - L.y;
    if (byH >= 3) {
      if ((est && rr.chance(0.8)) || (!est && rr.chance(0.18) && byH >= 4)) {
        const pw = Math.min(hw - 1, est ? 6 : 4), ph = Math.min(byH - 2, 3);
        const px = hx + 1, py = side === N ? byY + 1 : byY + byH - 1 - ph;
        this.fill(px - 1, py - 1, pw + 2, ph + 2, T.TILES);
        this.fill(px, py, pw, ph, T.POOL);
        this.prop('sunbed', (px + pw + 0.5) * TILE, (py + 0.8) * TILE, Math.PI / 2, 0, rr.int(0, 3));
      } else if (rr.chance(0.5)) {
        this.propAt(rr.pick(['picnic', 'grill', 'swing']), hx + 1 + rr.int(0, Math.max(0, hw - 3)), byY + Math.floor(byH / 2), 0, rr.int(0, 3));
      }
      for (let k = 0; k < (est ? 3 : 2); k++) {
        const tx = rr.int(L.x, L.x + L.w - 1), ty = rr.int(byY, byY + byH - 1);
        if (this.g(tx, ty) === T.GRASS && !this.occ[this.idx(tx, ty)]) this.propAt(rr.pick(est ? ['palm', 'oak', 'cherry'] : ['oak', 'birch', 'cherry', 'pine']), tx, ty, rr.range(0, 6.28), rr.int(0, 3), 3, rr);
      }
      // fence or hedge on the back line
      const backY = side === N ? L.y + L.h - 1 : L.y;
      const hedge = est || rr.chance(0.4);
      for (let i = L.x; i < L.x + L.w; i++) {
        if (this.occ[this.idx(i, backY)] || this.g(i, backY) !== T.GRASS) continue;
        if (hedge) this.propAt('hedge', i, backY, 0, 0);
        else this.prop('fence', i * TILE + 8, side === N ? (backY + 1) * TILE - 2 : backY * TILE + 2, 0, 0, rr.int(0, 2));
      }
    }
    // front tree
    const ftx = driveLeft ? L.x + 1 + rr.int(0, 1) : L.x + L.w - 2 - rr.int(0, 1);
    const fty = side === N ? L.y + 1 : L.y + L.h - 2;
    if (rr.chance(0.5) && this.g(ftx, fty) === T.GRASS) this.propAt(rr.pick(est ? ['palm', 'cherry'] : ['oak', 'cherry', 'birch']), ftx, fty, rr.range(0, 6.28), rr.int(0, 3), 2, rr);
    this.take(L.x, L.y, L.w, L.h);
  }

  fillDocks(b, R, rr) {
    if (R.w < 10 || R.h < 10) return this.fillYard(b, this.availTiles(R), rr);
    this.take(R.x, R.y, R.w, R.h, T.CONCRETE);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 1;
    const parts = this.bsp(R, 9, rr.int(1, 3), rr, 2);
    for (const P of parts) {
      if (rr.chance(0.6) && P.w >= 9 && P.h >= 9) {
        const B = { x: P.x + 1, y: P.y + 1, w: P.w - 2, h: P.h - 2 };
        const roof = rr.chance(0.5) ? ROOF.SAWTOOTH : ROOF.FLAT;
        const bd = this.addBuilding({ ...B, floors: rr.int(2, 3), style: BSTYLE.WAREHOUSE, roof, wc: 30 + rr.int(0, 5), rc: 8 + rr.int(0, 3), door: this.doorFor(B, R, rr) });
        if (roof === ROOF.FLAT) this.roofDetails(bd, rr, 0.5);
      } else {
        this.containerYard(P, rr);
      }
    }
    this.take(R.x, R.y, R.w, R.h);
    this.pedZones.push({ k: 'area', x0: R.x * TILE, y0: R.y * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE, sparse: true });
  }

  containerYard(P, rr) {
    const horiz = P.w >= P.h;
    if (horiz) {
      for (let y = P.y + 1; y + 2 <= P.y + P.h - 1; y += 4) {
        for (let x = P.x + 1; x + 6 <= P.x + P.w - 1; x += 7) {
          if (rr.chance(0.25) || !this.rectAvail(x, y, 6, 2)) continue;
          this.addBuilding({ x, y, w: 6, h: 2, floors: rr.int(1, 3), style: BSTYLE.CONTAINER, wc: rr.int(0, 7) });
        }
      }
    } else {
      for (let x = P.x + 1; x + 2 <= P.x + P.w - 1; x += 4) {
        for (let y = P.y + 1; y + 6 <= P.y + P.h - 1; y += 7) {
          if (rr.chance(0.25) || !this.rectAvail(x, y, 2, 6)) continue;
          this.addBuilding({ x, y, w: 2, h: 6, floors: rr.int(1, 3), style: BSTYLE.CONTAINER, wc: rr.int(0, 7) });
        }
      }
    }
    for (let k = 0; k < (P.w * P.h) / 30; k++) {
      const tx = rr.int(P.x, P.x + P.w - 1), ty = rr.int(P.y, P.y + P.h - 1);
      if (!this.avail[this.idx(tx, ty)] || this.occ[this.idx(tx, ty)]) continue;
      this.propAt(rr.pick(['crate', 'barrel', 'pallet', 'tires', 'cone']), tx, ty, rr.pick([0, Math.PI / 2]), rr.int(0, 3), 3, rr);
    }
  }

  fillYard(b, tiles, rr) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const i of tiles) {
      if (!this.avail[i]) continue;
      this.ground[i] = T.CONCRETE;
      const x = i % W, y = (i / W) | 0;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    for (let y = y0 + 1; y + 2 < y1; y += 4) {
      for (let x = x0 + 1; x + 6 < x1; x += 7) {
        if (rr.chance(0.3) || !this.rectAvail(x - 1, y - 1, 8, 4)) continue;
        this.addBuilding({ x, y, w: 6, h: 2, floors: rr.int(1, 3), style: BSTYLE.CONTAINER, wc: rr.int(0, 7) });
      }
    }
    for (const i of tiles) {
      if (!this.avail[i]) continue;
      this.avail[i] = 0;
      if (rr.chance(0.03)) this.propAt(rr.pick(['crate', 'barrel', 'pallet', 'tires']), i % W, (i / W) | 0, 0, rr.int(0, 3), 3, rr);
    }
  }

  fillGreen(b, tiles, rr, flavor) {
    for (const i of tiles) {
      if (!this.avail[i]) continue;
      const x = i % W, y = (i / W) | 0;
      this.avail[i] = 0;
      if (flavor === 'beach') { this.ground[i] = T.SAND; continue; }
      if (flavor === 'plaza') { this.ground[i] = T.PLAZA; if (rr.chance(0.03)) this.propAt('planter', x, y, 0, rr.int(0, 2)); continue; }
      this.ground[i] = T.GRASS;
      if (this.occ[i]) continue;
      const r = rr.next();
      if (r < 0.06) this.propAt(rr.pick(['oak', 'cherry', 'birch', 'pine']), x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      else if (r < 0.1) this.propAt('bush', x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      else if (r < 0.14) this.propAt('flowers', x, y, rr.range(0, 6.28), rr.int(0, 5), 4, rr);
    }
  }

  fillWild(b, tiles, rr) {
    const cabins = [];
    for (const i of tiles) {
      if (!this.avail[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const gt = this.ground[i];
      if (gt === T.ROCK) { this.avail[i] = 0; continue; }
      if (!(gt === T.FOREST || gt === T.DIRT || gt === T.GRASS)) this.ground[i] = T.FOREST;
    }
    // cabin clearings
    const nCab = Math.floor(tiles.length / 1600);
    for (let k = 0; k < nCab; k++) {
      const i = rr.pick(tiles);
      const x = i % W, y = (i / W) | 0;
      if (!this.rectAvail(x - 5, y - 5, 12, 12)) continue;
      this.take(x - 5, y - 5, 12, 12);
      for (let j = y - 5; j < y + 7; j++) for (let q = x - 5; q < x + 7; q++) {
        if (Math.hypot(q - x - 0.5, j - y - 0.5) < 6) this.set(q, j, T.GRASS);
      }
      const bd = this.addBuilding({ x: x - 2, y: y - 2, w: 5, h: 4, floors: 1, style: BSTYLE.CABIN, roof: ROOF.GABLE_X, wc: 40 + rr.int(0, 3), rc: rr.int(0, 7), door: { side: S, t: 2 } });
      this.prop('chimney', (bd.x + 1) * TILE, (bd.y + 2) * TILE, 0, FLOOR_H, 0);
      this.prop('campfire', (x + 0.5) * TILE, (y + 4.5) * TILE, 0, 0, 0);
      this.prop('log', (x - 1.5) * TILE, (y + 4.5) * TILE, Math.PI / 2, 0, 0);
      this.prop('log', (x + 2.5) * TILE, (y + 4.5) * TILE, Math.PI / 2, 0, 0);
      if (rr.chance(0.6)) this.prop('tent', (x + 4) * TILE, (y + 3) * TILE, 0, 0, rr.int(0, 3));
      cabins.push([x, y]);
      this.pedZones.push({ k: 'area', x0: (x - 4) * TILE, y0: (y + 2) * TILE, x1: (x + 6) * TILE, y1: (y + 6) * TILE, sparse: true });
    }
    // trees with blue-noise-ish spacing
    for (const i of tiles) {
      if (!this.avail[i] || this.occ[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const h = hash2(x, y, this.seed + 77);
      const gt = this.ground[i];
      const dens = gt === T.FOREST ? 0.2 : gt === T.GRASS ? 0.05 : 0.08;
      if (h < dens) {
        if (this.occ[i - 1] || this.occ[i - W] || this.occ[i - W - 1] || this.occ[i - W + 1]) continue;
        const key = rr.weighted([['pine', 6], ['oak', 3], ['birch', 2]]);
        this.propAt(key, x, y, rr.range(0, 6.28), rr.int(0, 3), 5, rr);
      } else if (h < dens + 0.025) {
        this.propAt(rr.weighted([['bush', 4], ['rock', 2], ['mushroom', 2], ['stump', 1], ['flowers', 2]]), x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      }
      this.avail[i] = 0;
    }
  }

  fillPoint(b, tiles, rr) {
    for (const i of tiles) this.avail[i] = 0;
    const cx = PENINSULA.cx, cy = PENINSULA.cy;
    this.fill(cx - 2, cy - 2, 4, 4, T.FLOOR);
    for (let j = cy - 4; j < cy + 4; j++) for (let i = cx - 4; i < cx + 4; i++) if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) < 4.2) this.set(i, j, T.PLAZA);
    const lh = this.addBuilding({ x: cx - 2, y: cy - 2, w: 4, h: 4, floors: 8, style: BSTYLE.LIGHTHOUSE, roof: ROOF.DOME, door: { side: N, t: 2 } });
    this.lighthouse = { x: cx * TILE, y: cy * TILE, z: 8 * FLOOR_H + 8, b: lh.id };
    this.addBuilding({ x: cx - 9, y: cy - 8, w: 5, h: 4, floors: 1, style: BSTYLE.CABIN, roof: ROOF.GABLE_X, wc: 41, rc: 2, door: { side: S, t: 2 } });
    // gravel path north to the road
    for (let y = cy - 4; y > 420; y--) {
      if (this.road[this.idx(cx, y)]) break;
      if (this.g(cx, y) === T.ROCK || this.water[this.idx(cx, y)]) break;
      this.set(cx, y, T.GRAVEL); this.set(cx - 1, y, T.GRAVEL);
    }
    this.prop('bench', (cx + 3.5) * TILE, (cy - 4) * TILE, Math.PI, 0, 0);
    this.prop('bench', (cx - 3.5) * TILE, (cy - 4) * TILE, 0, 0, 0);
    this.prop('lamp', (cx + 1.5) * TILE, (cy - 6) * TILE, 0, 0, 1);
    this.pois.push({ type: POI.LIGHTHOUSE, name: 'Lighthouse Point', x: cx * TILE, y: (cy - 3) * TILE });
  }

  fillPark(b, tiles, R, rr) {
    // big park: lake, loop path, cross paths, playground, court
    for (const i of tiles) this.ground[i] = T.GRASS;
    const cx = R.x + R.w * 0.55, cy = R.y + R.h * 0.5;
    const rx = Math.min(24, R.w * 0.22), ry = Math.min(15, R.h * 0.16);
    if (tiles.length > 900) {
      for (let j = Math.floor(cy - ry - 2); j <= cy + ry + 2; j++) for (let i = Math.floor(cx - rx - 2); i <= cx + rx + 2; i++) {
        if (!this.inb(i, j) || !this.avail[this.idx(i, j)]) continue;
        const n = valueNoise(i * 0.25, j * 0.25, this.seed + 11) * 0.3;
        const d = ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2;
        if (d < 1 - n) {
          const k = this.idx(i, j);
          this.ground[k] = d < 0.55 ? T.DEEP : T.WATER;
          this.water[k] = 3;
          this.avail[k] = 0;
        } else if (d < 1.25 - n) {
          this.set(i, j, T.SAND);
          this.avail[this.idx(i, j)] = 0;
        }
      }
      // loop path around lake
      for (let a = 0; a < Math.PI * 2; a += 0.01) {
        const px = Math.floor(cx + Math.cos(a) * (rx + 4)), py = Math.floor(cy + Math.sin(a) * (ry + 4));
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = this.idx(px + ox, py + oy);
          if (this.avail[k]) { this.ground[k] = T.GRAVEL; }
        }
      }
      for (let k = 0; k < 14; k++) {
        const a = rr.range(0, Math.PI * 2);
        const px = cx + Math.cos(a) * (rx - 1) * rr.range(0.85, 1.0), py = cy + Math.sin(a) * (ry - 1) * rr.range(0.85, 1.0);
        this.prop(rr.chance(0.5) ? 'lilypad' : 'reeds', px * TILE, py * TILE, rr.range(0, 6.28), 0, rr.int(0, 3));
      }
      this.parkLake = { x: cx * TILE, y: cy * TILE, rx: rx * TILE, ry: ry * TILE };
    }
    // cross paths from the middle of each side to the loop
    const mx = Math.floor(R.x + R.w / 2), my = Math.floor(R.y + R.h / 2);
    const pathLine = (x0, y0, x1, y1) => {
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      let x = x0, y = y0;
      for (let s = 0; s < 400; s++) {
        for (const [ox, oy] of [[0, 0], [dy ? 1 : 0, dx ? 1 : 0]]) {
          const k = this.idx(x + ox, y + oy);
          if (this.inb(x + ox, y + oy) && this.avail[k]) this.ground[k] = T.GRAVEL;
          else if (this.water[k]) return;
        }
        if (x === x1 && y === y1) break;
        if (x !== x1) x += dx; if (y !== y1) y += dy;
      }
    };
    pathLine(mx, R.y, mx, R.y + R.h - 1);
    pathLine(R.x, my, R.x + R.w - 1, my);
    pathLine(R.x + 6, R.y + 6, R.x + 6, R.y + R.h - 7);
    pathLine(R.x + 6, R.y + R.h - 7, R.x + R.w - 7, R.y + R.h - 7);
    // features in quadrants
    const feat = (key, fx, fy) => this.prop(key, fx * TILE, fy * TILE, 0, 0, 0);
    // fountain plaza at path crossing (if not lake)
    const fx = R.x + 6, fy = R.y + 6;
    for (let j = fy - 3; j <= fy + 3; j++) for (let i = fx - 3; i <= fx + 3; i++) if (this.avail[this.idx(i, j)] && Math.hypot(i - fx, j - fy) < 3.6) this.set(i, j, T.PLAZA);
    feat('fountain', fx + 0.5, fy + 0.5);
    // gazebo
    const gx = R.x + R.w - 12, gy = R.y + 10;
    if (this.rectAvail(gx - 3, gy - 3, 7, 7)) {
      for (let j = gy - 3; j <= gy + 3; j++) for (let i = gx - 3; i <= gx + 3; i++) if (Math.hypot(i - gx, j - gy) < 3.2) this.set(i, j, T.WOOD);
      feat('gazebo', gx + 0.5, gy + 0.5);
      this.take(gx - 3, gy - 3, 7, 7);
    }
    // playground
    const px = R.x + 10, py = R.y + R.h - 16;
    if (this.rectAvail(px, py, 9, 7)) {
      this.take(px, py, 9, 7, T.SAND);
      this.prop('slide', (px + 2.5) * TILE, (py + 2) * TILE, 0, 0, rr.int(0, 2));
      this.prop('swing', (px + 6) * TILE, (py + 2) * TILE, 0, 0, 0);
      this.prop('seesaw', (px + 4.5) * TILE, (py + 5) * TILE, 0, 0, rr.int(0, 2));
      this.prop('bench', (px + 4.5) * TILE, (py + 7.6) * TILE, 0, 0, 0);
    }
    // basketball court
    const kx = R.x + R.w - 18, ky = R.y + R.h - 14;
    if (this.rectAvail(kx, ky, 12, 8)) {
      this.take(kx, ky, 12, 8, T.COURT);
      this.prop('hoop', (kx + 0.6) * TILE, (ky + 4) * TILE, 0, 0, 0);
      this.prop('hoop', (kx + 11.4) * TILE, (ky + 4) * TILE, Math.PI, 0, 0);
      this.courts = this.courts || [];
      this.courts.push({ x: kx, y: ky, w: 12, h: 8 });
    }
    // trees, flowers, benches
    for (const i of tiles) {
      if (!this.avail[i] || this.occ[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const gt = this.ground[i];
      if (gt === T.GRAVEL) {
        if (rr.chance(0.03)) {
          // bench beside path
          const side = this.g(x + 1, y) === T.GRASS ? 1 : this.g(x - 1, y) === T.GRASS ? -1 : 0;
          if (side && !this.occ[i + side]) this.prop('bench', (x + 0.5 + side * 0.9) * TILE, (y + 0.5) * TILE, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0);
          else this.propAt('lamp', x + (side || 1), y, 0, 1);
        }
        continue;
      }
      if (gt !== T.GRASS) continue;
      const h = hash2(x, y, this.seed + 101);
      if (h < 0.07) {
        if (this.occ[i - 1] || this.occ[i - W]) continue;
        const cl = valueNoise(x * 0.08, y * 0.08, this.seed + 5);
        const key = cl > 0.62 ? 'cherry' : cl < 0.3 ? 'pine' : rr.weighted([['oak', 5], ['birch', 2], ['cherry', 1]]);
        this.propAt(key, x, y, rr.range(0, 6.28), rr.int(0, 3), 5, rr);
      } else if (h < 0.1) this.propAt('flowers', x, y, rr.range(0, 6.28), rr.int(0, 5), 5, rr);
      else if (h < 0.115) this.propAt('bush', x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
      else if (h < 0.118) this.propAt('picnic', x, y, rr.pick([0, Math.PI / 2]), rr.int(0, 3), 2, rr);
    }
    for (const i of tiles) this.avail[i] = 0;
    this.pedZones.push({ k: 'park', x0: R.x * TILE, y0: R.y * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE });
  }

  // ------------------------------------------------------------- specials
  fillSpecial(b, R, rr) {
    const tag = b.special;
    if (tag === 'cityhall') return this.cityHall(R, rr);
    if (tag === 'plaza2') return this.plaza(R, rr, false);
    if (tag.startsWith('clinic')) return this.civicBuilding(R, rr, BSTYLE.CLINIC, POI.CLINIC, tag === 'clinicE' ? 'Brightwater Clinic' : 'Willow Clinic', 4);
    if (tag.startsWith('police')) return this.civicBuilding(R, rr, BSTYLE.POLICE, POI.POLICE, tag === 'police' ? 'Central Precinct' : 'Harbor Precinct', 3);
    if (tag.startsWith('gas')) return this.gasStation(R, rr, b);
    if (tag === 'marketsq') return this.marketSquare(R, rr);
    if (tag === 'taxi') return this.depot(R, rr, POI.TAXI, 'Sunny Cabs', BSTYLE.GARAGE);
    if (tag === 'dealer') return this.depot(R, rr, POI.DEALER, 'Lucky Wheels Motors', BSTYLE.GLASS);
  }

  cityHall(R, rr) {
    this.take(R.x, R.y, R.w, R.h, T.PLAZA);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 1;
    const bw = Math.min(R.w - 6, 14), bh = Math.min(R.h - 10, 9);
    const bx = R.x + Math.floor((R.w - bw) / 2), by = R.y + 2;
    const bd = this.addBuilding({ x: bx, y: by, w: bw, h: bh, floors: 4, style: BSTYLE.CIVIC, roof: ROOF.FLAT, wc: 50, rc: 0, door: { side: S, t: Math.floor(bw / 2) } });
    // clock tower
    this.addBuilding({ x: bx + Math.floor(bw / 2) - 1, y: by + Math.floor(bh / 2) - 1, w: 3, h: 3, floors: 7, style: BSTYLE.CIVIC, roof: ROOF.HIP, wc: 50, rc: 1 });
    this.roofDetails(bd, rr, 0.5);
    const fy = by + bh + 1, fh = R.y + R.h - fy;
    const cx = (R.x + R.w / 2) * TILE, cy = (fy + fh / 2) * TILE;
    for (let j = fy; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      if (Math.abs(i + 0.5 - (R.x + R.w / 2)) < 1.5 || ((i + j) % 4 === 0)) this.set(i, j, T.TILES);
    }
    this.prop('fountain', cx, cy, 0, 0, 1);
    this.prop('flagpole', (bx - 1) * TILE, (by + bh + 1) * TILE, 0, 0, 0);
    this.prop('flagpole', (bx + bw + 1) * TILE, (by + bh + 1) * TILE, 0, 0, 1);
    for (let k = 0; k < 6; k++) {
      const tx = R.x + 1 + Math.floor((k % 3) * (R.w - 3) / 2), ty = k < 3 ? fy + 1 : R.y + R.h - 2;
      this.propAt('planter', tx, ty, 0, 1);
      this.propAt('cherry', tx, ty, rr.range(0, 6.28), 0);
    }
    this.prop('bench', cx - 40, cy + 30, 0, 0, 0);
    this.prop('bench', cx + 40, cy + 30, 0, 0, 0);
    this.prop('lamp', cx - 50, cy - 10, 0, 0, 1);
    this.prop('lamp', cx + 50, cy - 10, Math.PI, 0, 1);
    this.take(R.x, R.y, R.w, R.h);
    const [dx, dy] = this.doorWorld(bd);
    this.pois.push({ type: POI.CITYHALL, name: 'City Hall', x: dx, y: dy + 8, b: bd.id });
    this.spawns.push({ x: cx, y: cy + 40 });
    this.pedZones.push({ k: 'area', x0: R.x * TILE, y0: fy * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE });
  }

  civicBuilding(R, rr, style, poi, name, floors) {
    this.take(R.x, R.y, R.w, R.h, T.CONCRETE);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 1;
    const bw = Math.min(R.w - 2, 14), bh = Math.min(R.h - 8, 10);
    const bx = R.x + 1, by = R.y + 1;
    const bd = this.addBuilding({ x: bx, y: by, w: bw, h: bh, floors, style, roof: ROOF.FLAT, wc: style === BSTYLE.CLINIC ? 51 : 52, rc: 0, door: { side: S, t: Math.floor(bw / 2) }, poi, sign: poi });
    this.roofDetails(bd, rr, 0.6);
    // forecourt / parking
    const P = { x: R.x, y: by + bh + 1, w: R.w, h: R.y + R.h - (by + bh + 1) };
    if (P.h >= 7) this.parkingLot(P, rr, poi === POI.POLICE ? 'police' : D.market);
    else this.take(P.x, P.y, P.w, P.h, T.PLAZA);
    // ambulance / patrol bays marked as special parking
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      const k = this.idx(i, j);
      if (this.avail[k]) { this.avail[k] = 0; this.ground[k] = T.PLAZA; }
    }
    const [dx, dy, nx, ny] = this.doorWorld(bd);
    this.pois.push({ type: poi, name, x: dx + nx * 12, y: dy + ny * 12, b: bd.id });
    if (poi === POI.CLINIC) this.spawns.push({ x: dx + nx * 24, y: dy + ny * 24, clinic: true });
    if (poi === POI.POLICE) this.policeSpawns = [...(this.policeSpawns || []), { x: dx + nx * 24, y: dy + ny * 24 }];
  }

  gasStation(R, rr, b) {
    this.take(R.x, R.y, R.w, R.h, T.CONCRETE);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 1;
    const cw = Math.min(10, R.w - 4), ch = 6;
    const cx = R.x + Math.floor((R.w - cw) / 2), cy = R.y + 2;
    this.addBuilding({ x: cx, y: cy, w: cw, h: ch, floors: 2, style: BSTYLE.CANOPY, open: true, wc: 60, rc: 0 });
    for (let k = 0; k < 3; k++) {
      const px = (cx + 1.5 + k * (cw - 3) / 2) * TILE, py = (cy + ch / 2) * TILE;
      this.prop('pump', px, py, 0, 0, 0);
    }
    for (const [ox, oy] of [[0.5, 0.5], [cw - 0.5, 0.5], [0.5, ch - 0.5], [cw - 0.5, ch - 0.5]]) this.prop('bollard', (cx + ox) * TILE, (cy + oy) * TILE, 0, 0, 1);
    const kw = Math.min(8, R.w - 4), kh = 5;
    const kx = R.x + Math.floor((R.w - kw) / 2), ky = R.y + R.h - kh - 1;
    if (ky > cy + ch + 1) {
      const bd = this.addBuilding({ x: kx, y: ky, w: kw, h: kh, floors: 1, style: BSTYLE.KIOSK, wc: 61, rc: 0, door: { side: N, t: Math.floor(kw / 2) }, awn: 3, poi: POI.GAS, sign: POI.GAS });
      this.roofDetails(bd, rr, 0.4);
      const [dx, dy, nx, ny] = this.doorWorld(bd);
      this.pois.push({ type: POI.GAS, name: 'Gas & Snacks', x: dx + nx * 12, y: dy + ny * 12, b: bd.id });
      this.prop('vending', dx + 26, dy + ny * 6, -Math.PI / 2, 0, 1);
      this.prop('trash', dx - 22, dy + ny * 8, 0, 0, 0);
    }
    this.prop('polesign', (R.x + 0.7) * TILE, (R.y + 0.7) * TILE, 0, 0, 0);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 0;
    this.gasStations = [...(this.gasStations || []), { x: (cx + cw / 2) * TILE, y: (cy + ch / 2) * TILE }];
  }

  marketSquare(R, rr) {
    this.take(R.x, R.y, R.w, R.h, T.COBBLE);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      if ((i - R.x) % 6 === 0 || (j - R.y) % 6 === 0) this.set(i, j, T.PLAZA);
    }
    const cx = (R.x + R.w / 2) * TILE, cy = (R.y + R.h / 2) * TILE;
    this.prop('statue', cx, cy, Math.PI / 2, 0, 1);
    const cols = Math.floor((R.w - 4) / 6), rows = Math.floor((R.h - 4) / 5);
    for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
      const sx = (R.x + 3.5 + a * 6) * TILE, sy = (R.y + 3 + c * 5) * TILE;
      if (Math.hypot(sx - cx, sy - cy) < 40) continue;
      if (rr.chance(0.75)) this.prop('stall', sx, sy, 0, 0, rr.int(0, 5));
    }
    for (let k = 0; k < 6; k++) this.prop('lantern', (R.x + 1 + rr.next() * (R.w - 2)) * TILE, (R.y + 1 + rr.next() * (R.h - 2)) * TILE, 0, 0, 0);
    this.pois.push({ type: POI.CAFE, name: 'Old Harbor Market', x: cx, y: cy + 24 });
    this.pedZones.push({ k: 'area', x0: R.x * TILE, y0: R.y * TILE, x1: (R.x + R.w) * TILE, y1: (R.y + R.h) * TILE });
  }

  depot(R, rr, poi, name, style) {
    this.take(R.x, R.y, R.w, R.h, T.CONCRETE);
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) this.avail[this.idx(i, j)] = 1;
    const bw = Math.min(R.w - 2, 12), bh = Math.min(7, R.h - 9);
    const bd = this.addBuilding({ x: R.x + 1, y: R.y + 1, w: bw, h: bh, floors: 2, style, roof: ROOF.FLAT, wc: style === BSTYLE.GLASS ? 3 : 62, rc: 0, door: { side: S, t: Math.floor(bw / 2) }, poi, sign: poi, awn: 1 });
    this.roofDetails(bd, rr, 0.5);
    const P = { x: R.x, y: R.y + bh + 2, w: R.w, h: R.h - bh - 2 };
    if (P.h >= 7) this.parkingLot(P, rr, poi === POI.TAXI ? 'taxi' : 'dealer');
    for (let j = R.y; j < R.y + R.h; j++) for (let i = R.x; i < R.x + R.w; i++) {
      const k = this.idx(i, j);
      if (this.avail[k]) { this.avail[k] = 0; }
    }
    const [dx, dy, nx, ny] = this.doorWorld(bd);
    this.pois.push({ type: poi, name, x: dx + nx * 12, y: dy + ny * 12, b: bd.id });
  }

  // ------------------------------------------------------------- beach & coast
  beachAndCoast() {
    const rr = this.rng.fork(4242);
    const bl = this.hl[this.hl.length - 1];
    const roadBottom = bl.p + bl.w;
    // boardwalk strip along the south side of the beach boulevard, east of the river
    for (let x = 0; x < W; x++) {
      for (let y = roadBottom; y < H; y++) {
        const i = this.idx(x, y);
        if (this.water[i] || this.road[i] || this.bgrid[i] >= 0) continue;
        if (this.ground[i] === T.ROCK || inPeninsula(x, y)) continue;
        const d = districtAt(x, y, this.beachY);
        if (d !== D.beach) continue;
        if (y < roadBottom + 2) this.ground[i] = T.SIDEWALK;
        else if (y < roadBottom + 6 && x > riverX(y) + 10 && x < 392) this.ground[i] = T.WOOD;
        else this.ground[i] = T.SAND;
        this.district[i] = D.beach;
      }
    }
    // beach huts and food carts along the boardwalk
    for (let x = 206; x < 388; x += rr.int(16, 26)) {
      const y = roadBottom + 6;
      if (!this.rectFreeSand(x, y, 5, 4)) continue;
      const poi = rr.chance(0.3) ? POI.DINER : null;
      const bd = this.addBuilding({ x, y, w: 5, h: 4, floors: 1, style: BSTYLE.BEACHHUT, roof: ROOF.GABLE_X, wc: 70 + rr.int(0, 5), rc: rr.int(0, 7), door: { side: N, t: 2 }, awn: rr.int(0, 7), poi, sign: poi });
      if (poi) {
        const [dx, dy, nx, ny] = this.doorWorld(bd);
        this.pois.push({ type: POI.DINER, name: rr.pick(['Shaved Ice Shack', 'Taco Wave', 'Sunny Smoothies', 'Fish & Chips']), x: dx + nx * 12, y: dy + ny * 12, b: bd.id });
      }
    }
    // pier with carousel
    const pierX = 300;
    let pierEnd = 0;
    for (let y = roadBottom + 6; y < H - 4; y++) {
      const i = this.idx(pierX, y);
      if (y > southCoastAt(pierX) + 26) break;
      for (let x = pierX - 3; x < pierX + 3; x++) {
        const k = this.idx(x, y);
        if (this.bgrid[k] >= 0) continue;
        this.ground[k] = T.WOOD; this.water[k] = 0; this.district[k] = D.beach;
      }
      pierEnd = y;
      void i;
    }
    if (pierEnd) {
      const py = pierEnd - 8;
      for (let y = py - 7; y <= py + 7; y++) for (let x = pierX - 8; x <= pierX + 7; x++) {
        const k = this.idx(x, y);
        this.ground[k] = T.WOOD; this.water[k] = 0; this.district[k] = D.beach;
      }
      this.prop('ferris', pierX * TILE, py * TILE, 0, 0, 0);
      this.pois.push({ type: POI.FERRIS, name: 'Sunset Pier Carousel', x: pierX * TILE, y: (py - 9) * TILE });
      for (let y = roadBottom + 10; y < pierEnd; y += 6) {
        this.prop('lamp', (pierX - 2.7) * TILE, y * TILE, 0, 0, 1);
        this.prop('lamp', (pierX + 2.7) * TILE, (y + 3) * TILE, Math.PI, 0, 1);
      }
      this.pier = { x: pierX * TILE, y0: (roadBottom + 6) * TILE, y1: pierEnd * TILE };
      this.pedZones.push({ k: 'area', x0: (pierX - 2) * TILE, y0: (roadBottom + 6) * TILE, x1: (pierX + 2) * TILE, y1: pierEnd * TILE });
    }
    // beach props
    for (let x = 4; x < W - 4; x++) {
      for (let y = roadBottom + 6; y < H; y++) {
        const i = this.idx(x, y);
        if (this.ground[i] !== T.SAND || this.occ[i]) continue;
        const h = hash2(x, y, this.seed + 31);
        const nearWater = this.waterDist[i] <= 3;
        if (h < 0.018 && !nearWater) this.propAt('palm', x, y, rr.range(0, 6.28), rr.int(0, 3), 4, rr);
        else if (h < 0.034 && !nearWater) {
          this.propAt('parasol', x, y, 0, rr.int(0, 5), 2, rr);
          this.propAt('towel', x + 1, y, rr.pick([0, Math.PI / 2]), rr.int(0, 5), 2, rr);
        } else if (h < 0.04 && !nearWater) this.propAt('sunbed', x, y, Math.PI / 2, rr.int(0, 3), 1, rr);
        else if (h < 0.043) this.propAt('beachball', x, y, 0, rr.int(0, 3), 4, rr);
      }
    }
    for (let x = 220; x < 380; x += 52) {
      const y = roadBottom + 13;
      const i = this.idx(x, y);
      if (this.ground[i] === T.SAND && !this.occ[i]) this.propAt('lifeguard', x, y, 0, 0);
    }
    const vx = 250, vy = roadBottom + 15;
    if (this.ground[this.idx(vx, vy)] === T.SAND) this.prop('volleynet', vx * TILE, vy * TILE, 0, 0, 0);
    this.pedZones.push({ k: 'beach', x0: 200 * TILE, y0: (roadBottom + 6) * TILE, x1: 388 * TILE, y1: (roadBottom + 18) * TILE });
    this.pedZones.push({ k: 'beach', x0: 20 * TILE, y0: (roadBottom + 3) * TILE, x1: 160 * TILE, y1: (roadBottom + 16) * TILE });
    // boats moored at the docks and buoys out at sea
    for (const p of PIERS) {
      this.addBuilding({ x: p.x0 + 4, y: p.y0 - 6, w: 20, h: 5, floors: 2, style: BSTYLE.SHIP, wc: rr.int(0, 3), water: true });
      for (let x = p.x0 + 1; x < p.x1; x += 4) {
        this.prop('pierpost', x * TILE + 8, p.y0 * TILE + 3, 0, 0, 0);
        this.prop('pierpost', x * TILE + 8, p.y1 * TILE - 3, 0, 0, 0);
      }
      this.prop('crane', (p.x0 + 12) * TILE, (p.y0 + 5) * TILE, 0, 0, 0);
    }
    for (let k = 0; k < 40; k++) {
      const x = rr.int(10, W - 10), y = rr.int(300, H - 6);
      const i = this.idx(x, y);
      if (this.ground[i] !== T.DEEP || this.waterDist[i] < 3) continue;
      if (rr.chance(0.6)) this.prop('buoy', x * TILE + 8, y * TILE + 8, 0, 0, rr.int(0, 1));
      else this.prop('boat', x * TILE + 8, y * TILE + 8, rr.range(0, 6.28), 0, rr.int(0, 3));
    }
    // river: small boats
    for (let k = 0; k < 6; k++) {
      const y = rr.int(60, 420), x = Math.round(riverX(y));
      if (this.ground[this.idx(x, y)] === T.DEEP) this.prop('boat', x * TILE + 8, y * TILE, Math.PI / 2 + rr.range(-0.2, 0.2), 0, rr.int(0, 3));
    }
  }

  rectFreeSand(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = this.idx(i, j);
      if (!this.inb(i, j) || this.ground[k] !== T.SAND || this.bgrid[k] >= 0 || this.occ[k]) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- street furniture
  streetFurniture() {
    const rr = this.rng.fork(999);
    const lampKey = (tx, ty) => (this.district[this.idx(tx, ty)] === D.oldtown ? 'lantern' : 'lamp');
    const put = (key, tx, ty, wx, wy, rot, v = 0) => {
      const k = this.idx(tx, ty);
      if (!this.inb(tx, ty) || this.occ[k]) return false;
      const gt = this.ground[k];
      if (gt !== T.SIDEWALK && gt !== T.GRASS && gt !== T.PLAZA) return false;
      this.prop(key, wx, wy, rot, 0, v);
      return true;
    };
    for (const e of this.edges) {
      const na = this.nodes[e.a], nb = this.nodes[e.b];
      const d = districtAt((na.x + nb.x) / 2, (na.y + nb.y) / 2, this.beachY);
      const wild = d === D.wild;
      if (e.dir === 'h') {
        const xs = na.x + na.w, xe = nb.x;
        let k = 0;
        for (let x = xs + 3; x < xe - 2; x += wild ? 14 : 8, k++) {
          const top = k % 2 === 0;
          const ty = top ? e.y0 - 1 : e.y1;
          const wy = top ? e.y0 * TILE - 4 : e.y1 * TILE + 4;
          if (!wild) put(lampKey(x, ty), x, ty, x * TILE + 8, wy, top ? Math.PI / 2 : -Math.PI / 2);
        }
        // trees and furniture
        for (let x = xs + 1; x < xe - 1; x++) {
          for (const top of [true, false]) {
            const ty = top ? e.y0 - 1 : e.y1;
            const ty2 = top ? e.y0 - 2 : e.y1 + 1;
            const k1 = this.idx(x, ty);
            if (!this.inb(x, ty) || this.occ[k1]) continue;
            const h = hash2(x, ty, this.seed + 13);
            if (SUBURB.has(d) && this.ground[this.idx(x, ty2)] === T.GRASS && h < 0.14 && !this.occ[this.idx(x, ty2)] && !this.occ[this.idx(x - 1, ty2)]) {
              this.propAt(rr.pick(d === D.estates ? ['palm', 'cherry'] : ['oak', 'birch', 'cherry', 'oak']), x, ty2, rr.range(0, 6.28), rr.int(0, 3));
            } else if ((d === D.market || d === D.downtown) && h < 0.05 && this.ground[k1] === T.SIDEWALK) {
              put(rr.pick(['oak', 'birch', 'cherry']), x, ty, x * TILE + 8, top ? (ty * TILE + 4) : (ty * TILE + 12), rr.range(0, 6.28), rr.int(0, 3));
            } else if (URBAN.has(d) && h < 0.085 && this.ground[k1] === T.SIDEWALK) {
              const key = rr.weighted([['trash', 4], ['bench', 2], ['hydrant', 3], ['newsbox', 2], ['phone', 1], ['bikerack', 1]]);
              const wy = top ? (ty * TILE + 10) : (ty * TILE + 6);
              if (key === 'bench') put(key, x, ty, x * TILE + 8, top ? ty * TILE + 4 : ty * TILE + 12, top ? Math.PI : 0);
              else put(key, x, ty, x * TILE + 8, wy, top ? Math.PI / 2 : -Math.PI / 2, rr.int(0, 3));
            }
          }
        }
        if (e.art && !wild && rr.chance(0.4)) {
          const mx = Math.floor((xs + xe) / 2);
          put('busstop', mx, e.y1, mx * TILE + 8, e.y1 * TILE + 9, 0);
        }
        if (e.bridge) this.bridgeRails(e);
      } else {
        const ys = na.y + na.h, ye = nb.y;
        let k = 0;
        for (let y = ys + 3; y < ye - 2; y += wild ? 14 : 8, k++) {
          const left = k % 2 === 0;
          const tx = left ? e.x0 - 1 : e.x1;
          const wx = left ? e.x0 * TILE - 4 : e.x1 * TILE + 4;
          if (!wild) put(lampKey(tx, y), tx, y, wx, y * TILE + 8, left ? 0 : Math.PI);
        }
        for (let y = ys + 1; y < ye - 1; y++) {
          for (const left of [true, false]) {
            const tx = left ? e.x0 - 1 : e.x1;
            const tx2 = left ? e.x0 - 2 : e.x1 + 1;
            const k1 = this.idx(tx, y);
            if (!this.inb(tx, y) || this.occ[k1]) continue;
            const h = hash2(tx, y, this.seed + 17);
            if (SUBURB.has(d) && this.ground[this.idx(tx2, y)] === T.GRASS && h < 0.14 && !this.occ[this.idx(tx2, y)] && !this.occ[this.idx(tx2, y - 1)]) {
              this.propAt(rr.pick(d === D.estates ? ['palm', 'cherry'] : ['oak', 'birch', 'cherry', 'oak']), tx2, y, rr.range(0, 6.28), rr.int(0, 3));
            } else if ((d === D.market || d === D.downtown) && h < 0.05 && this.ground[k1] === T.SIDEWALK) {
              put(rr.pick(['oak', 'birch', 'cherry']), tx, y, left ? tx * TILE + 4 : tx * TILE + 12, y * TILE + 8, rr.range(0, 6.28), rr.int(0, 3));
            } else if (URBAN.has(d) && h < 0.085 && this.ground[k1] === T.SIDEWALK) {
              const key = rr.weighted([['trash', 4], ['bench', 2], ['hydrant', 3], ['newsbox', 2], ['phone', 1]]);
              if (key === 'bench') put(key, tx, y, left ? tx * TILE + 4 : tx * TILE + 12, y * TILE + 8, left ? -Math.PI / 2 : Math.PI / 2);
              else put(key, tx, y, left ? tx * TILE + 10 : tx * TILE + 6, y * TILE + 8, left ? 0 : Math.PI, rr.int(0, 3));
            }
          }
        }
      }
    }
    // traffic lights at signalised intersections (one per corner, facing incoming traffic)
    for (const n of this.nodes) {
      if (!n.signal) continue;
      const x0 = n.x * TILE, y0 = n.y * TILE, x1 = (n.x + n.w) * TILE, y1 = (n.y + n.h) * TILE;
      this.prop('traffic', x0 - 5, y0 - 5, 0, 0, 0);
      this.prop('traffic', x1 + 5, y0 - 5, Math.PI / 2, 0, 1);
      this.prop('traffic', x1 + 5, y1 + 5, Math.PI, 0, 0);
      this.prop('traffic', x0 - 5, y1 + 5, -Math.PI / 2, 0, 1);
    }
  }

  bridgeRails(e) {
    for (let x = e.x0; x < e.x1; x++) {
      if (this.ground[this.idx(x, e.y0)] !== T.BRIDGE) continue;
      this.prop('railing', x * TILE + 8, e.y0 * TILE + 1, 0, 0, 0);
      this.prop('railing', x * TILE + 8, e.y1 * TILE - 1, 0, 0, 0);
    }
  }

  finalizeDistricts() {
    // fill the district grid everywhere (roads, water) for HUD labels
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = this.idx(x, y);
      if (this.road[i] || this.water[i] || this.district[i] === 0) {
        this.district[i] = districtAt(x, y, this.beachY);
        if (this.water[i] === 1) this.district[i] = y > 300 ? D.beach : D.estates;
      }
    }
    // POIs from shop buildings in market and oldtown
    const wants = [
      [POI.GUNSHOP, 'Pew Pew Outfitters', 300, 360],
      [POI.GUNSHOP, 'Harbor Hardware & Arms', 90, 330],
      [POI.CLOTHES, 'Thread Lightly', 330, 210],
      [POI.CLOTHES, 'Old Harbor Tailors', 150, 350],
      [POI.RESPRAY, 'Fresh Coat Garage', 420, 250],
      [POI.RESPRAY, 'Willow Paint & Go', 120, 220],
      [POI.PIZZA, 'Pizza Pals', 220, 280],
      [POI.CAFE, 'Morning Mug Cafe', 360, 290],
      [POI.CAFE, 'Little Fern Cafe', 130, 410],
      [POI.ARCADE, 'Pixel Palace Arcade', 260, 380],
      [POI.DINER, 'Starlight Diner', 410, 200],
      [POI.HOTEL, 'Hotel Bellwater', 340, 330],
    ];
    const used = new Set(this.pois.filter((p) => p.b !== undefined).map((p) => p.b));
    for (const [type, name, tx, ty] of wants) {
      let best = null, bd = 1e9;
      for (const b of this.buildings) {
        if (used.has(b.id) || !b.door || b.poi) continue;
        if (!(b.style === BSTYLE.SHOP || b.style === BSTYLE.BRICK || b.style === BSTYLE.APARTMENT)) continue;
        if (b.w * b.h < 30) continue;
        const d = (b.x + b.w / 2 - tx) ** 2 + (b.y + b.h / 2 - ty) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) continue;
      used.add(best.id);
      best.poi = type; best.sign = type;
      if (type === POI.RESPRAY) best.style = BSTYLE.GARAGE;
      else if (best.style !== BSTYLE.SHOP) best.style = BSTYLE.SHOP;
      if (best.awn < 0) best.awn = (best.id % 8);
      const [dx, dy, nx, ny] = this.doorWorld(best);
      this.pois.push({ type, name, x: dx + nx * 12, y: dy + ny * 12, b: best.id });
    }
    if (!this.spawns.length) this.spawns.push({ x: DOWNTOWN_CENTER.x * TILE, y: DOWNTOWN_CENTER.y * TILE });
  }

  walkableTile(i) {
    const gt = this.ground[i];
    if (this.bgrid[i] >= 0 || this.water[i] && gt !== T.BRIDGE && gt !== T.WOOD) return false;
    if (gt === T.ROCK || gt === T.DEEP || gt === T.POOL) return false;
    return true;
  }

  placeCollectibles() {
    // 60 hidden "sprites": spread across districts, preferring quiet corners.
    const rr = this.rng.fork(31337);
    const want = 60;
    const placed = [];
    let guard = 0;
    while (placed.length < want && guard++ < 50000) {
      const x = rr.int(10, W - 10), y = rr.int(10, H - 10);
      const i = this.idx(x, y);
      if (!this.walkableTile(i) || this.road[i] || this.occ[i]) continue;
      const gt = this.ground[i];
      if (gt === T.SIDEWALK && rr.chance(0.85)) continue;
      if (placed.some((p) => Math.abs(p.tx - x) + Math.abs(p.ty - y) < 34)) continue;
      // prefer tiles next to buildings, trees, or water: tucked away
      let tucked = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = this.idx(x + ox, y + oy);
        if (this.bgrid[k] >= 0 || this.occ[k] || this.water[k]) tucked++;
      }
      if (tucked === 0 && rr.chance(0.8)) continue;
      placed.push({ tx: x, ty: y });
      this.collectibles.push({ id: placed.length - 1, x: x * TILE + 8, y: y * TILE + 8 });
    }
  }

  placePickups() {
    const rr = this.rng.fork(777);
    const kinds = [['health', 14], ['armor', 7], ['pistol', 6], ['bat', 4], ['smg', 4], ['shotgun', 3], ['rifle', 2], ['rocket', 1], ['grenade', 3], ['cash', 10]];
    let guard = 0;
    while (this.pickups.length < 70 && guard++ < 40000) {
      const x = rr.int(20, W - 20), y = rr.int(20, H - 20);
      const i = this.idx(x, y);
      if (!this.walkableTile(i) || this.road[i] || this.occ[i]) continue;
      if (this.pickups.some((p) => Math.abs(p.x / TILE - x) + Math.abs(p.y / TILE - y) < 24)) continue;
      const d = this.district[i];
      if (d === D.wild && rr.chance(0.7)) continue;
      this.pickups.push({ id: this.pickups.length, kind: rr.weighted(kinds), x: x * TILE + 8, y: y * TILE + 8 });
    }
  }

  // ------------------------------------------------------------- output
  output() {
    const nodes = this.nodes.filter((n) => n.edges.length).map((n) => ({
      id: n.id, x: (n.x + n.w / 2) * TILE, y: (n.y + n.h / 2) * TILE, w: n.w * TILE, h: n.h * TILE,
      tx: n.x, ty: n.y, tw: n.w, th: n.h, edges: n.edges, signal: n.signal, cross: n.cross, inter: n.inter, district: n.district,
    }));
    const edges = this.edges.map((e) => ({
      id: e.id, a: e.a, b: e.b, dir: e.dir, w: e.w, art: e.art, bridge: e.bridge, lanes: e.lanes,
      x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1,
    }));
    return {
      seed: this.seed,
      w: W, h: H,
      ground: this.ground,
      district: this.district,
      buildings: this.buildings,
      props: this.props,
      nodes, edges,
      parking: this.parking,
      parkingLots: this.lots || [],
      pois: this.pois,
      pedZones: this.pedZones,
      spawns: this.spawns,
      policeSpawns: this.policeSpawns || [],
      gasStations: this.gasStations || [],
      collectibles: this.collectibles,
      pickups: this.pickups,
      lighthouse: this.lighthouse || null,
      pier: this.pier || null,
      parkLake: this.parkLake || null,
      courts: this.courts || [],
      beachY: this.beachY,
      districts: DISTRICTS,
    };
  }
}

function southCoastAt(x) {
  return 446 + 5 * Math.sin(x / 37) + 3 * Math.sin(x / 13 + 2);
}

// Multi-source BFS distance (in tiles) from tiles where src(i) is true, capped at max.
function bfsDist(w, h, src, max, diag = false) {
  const dist = new Uint8Array(w * h).fill(255);
  let frontier = [];
  for (let i = 0; i < w * h; i++) if (src(i)) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d <= max && frontier.length; d++) {
    const next = [];
    for (const i of frontier) {
      const x = i % w, y = (i / w) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (!diag && ox && oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (dist[k] !== 255) continue;
        dist[k] = d;
        next.push(k);
      }
    }
    frontier = next;
  }
  return dist;
}

export { RIVER_HALF };
