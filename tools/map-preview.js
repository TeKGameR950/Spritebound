import fs from 'node:fs';
import { generateWorld } from '../server/worldgen/index.js';
import { TERRAIN, TILE, BSTYLE } from '../shared/constants.js';
import { PROP_DEF } from '../shared/props.js';
import { encodePNG } from './png.js';

const seed = Number(process.argv[2] || 1337);
const out = process.argv[3] || 'map.png';
const scale = Number(process.argv[4] || 2);
const t0 = performance.now();
const w = generateWorld(seed);
console.log(`generated in ${(performance.now() - t0).toFixed(0)}ms: ${w.buildings.length} buildings, ${w.props.length} props, ${w.nodes.length} nodes, ${w.edges.length} edges, ${w.parking.length} parking, ${w.pois.length} pois, ${w.pedZones.length} pedZones, ${w.collectibles.length} collectibles, ${w.pickups.length} pickups`);

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const colors = TERRAIN.map((t) => hex(t.map.length === 4 ? '#' + t.map[1] + t.map[1] + t.map[2] + t.map[2] + t.map[3] + t.map[3] : t.map));
const W = w.w * scale, H = w.h * scale;
const px = new Uint8Array(W * H * 4);
const put = (x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const k = (y * W + x) * 4;
  px[k] = px[k] * (1 - a) + c[0] * a;
  px[k + 1] = px[k + 1] * (1 - a) + c[1] * a;
  px[k + 2] = px[k + 2] * (1 - a) + c[2] * a;
  px[k + 3] = 255;
};
for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
  const c = colors[w.ground[y * w.w + x]];
  for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) put(x * scale + i, y * scale + j, c);
}
const bcol = (b) => {
  const f = Math.min(1, b.floors / 14);
  const base = b.style === BSTYLE.HOUSE ? [200, 110, 90] : b.style === BSTYLE.CONTAINER ? [60, 140, 190] : b.style === BSTYLE.SHIP ? [170, 60, 50] : [140 + 80 * f, 140 + 70 * f, 150 + 60 * f];
  if (b.poi) return [255, 200, 40];
  return base;
};
for (const b of w.buildings) {
  const c = bcol(b);
  for (let y = b.y * scale; y < (b.y + b.h) * scale; y++) for (let x = b.x * scale; x < (b.x + b.w) * scale; x++) {
    const edge = y === b.y * scale || x === b.x * scale || y === (b.y + b.h) * scale - 1 || x === (b.x + b.w) * scale - 1;
    put(x, y, edge ? [40, 40, 50] : c, b.open ? 0.5 : 1);
  }
}
for (const p of w.props) {
  const def = PROP_DEF[p[0]];
  const x = Math.floor(p[1] / TILE * scale), y = Math.floor(p[2] / TILE * scale);
  const tree = ['oak', 'pine', 'palm', 'cherry', 'birch', 'bush'].includes(def.key);
  const c = tree ? (def.key === 'cherry' ? [240, 160, 200] : [30, 100, 40]) : def.key.includes('lamp') || def.key === 'lantern' ? [255, 240, 120] : [230, 230, 230];
  if (p[4] > 0) continue;
  put(x, y, c);
  if (tree && scale > 1) { put(x + 1, y, c); put(x, y + 1, c); put(x + 1, y + 1, c); }
}
for (const n of w.nodes) {
  if (!n.signal) continue;
  put(Math.floor(n.x / TILE * scale), Math.floor(n.y / TILE * scale), [255, 0, 0]);
}
for (const p of w.pois) {
  const x = Math.floor(p.x / TILE * scale), y = Math.floor(p.y / TILE * scale);
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (Math.abs(i) + Math.abs(j) <= 3) put(x + i, y + j, [255, 0, 255]);
}
for (const c of w.collectibles) put(Math.floor(c.x / TILE * scale), Math.floor(c.y / TILE * scale), [0, 255, 255]);
fs.writeFileSync(out, encodePNG(W, H, px));
console.log('wrote', out);
