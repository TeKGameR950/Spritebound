import { TERRAIN, TILE, BSTYLE } from '/shared/constants.js';
import { el } from './dom.js';

export const POI_STYLE = {
  gunshop: ['#ff6b6b', 'G', 'Outfitters'], clothes: ['#ff86bd', 'T', 'Tailor'], respray: ['#62c3ff', 'R', 'Respray'],
  pizza: ['#ffb347', 'P', 'Pizza job'], taxi: ['#ffd84a', '$', 'Taxi job'], clinic: ['#ff5050', '+', 'Clinic'],
  police: ['#6aa0ff', '*', 'Police'], cafe: ['#e9b98a', 'C', 'Cafe'], gas: ['#7ee0a3', 'F', 'Gas & repair'],
  dealer: ['#ffe066', 'D', 'Car dealer'], arcade: ['#c38bff', 'A', 'Arcade'], diner: ['#ff7a9c', 'D', 'Diner'],
  hotel: ['#ffd27a', 'H', 'Hotel'], cityhall: ['#fff1c4', 'H', 'City Hall'], lighthouse: ['#fff6a0', 'L', 'Lighthouse'], ferris: ['#ffb3d5', 'C', 'Carousel'],
};

function hexToRgb(h) {
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function renderMapImage(world) {
  const W = world.w, H = world.h;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const cols = TERRAIN.map((t) => hexToRgb(t.map));
  for (let i = 0; i < W * H; i++) {
    const t = world.ground[i];
    let [r, g, b] = cols[t];
    if (t === 6 || t === 9 || t === 12 || t === 16) { r = 92; g = 94; b = 110; }
    if (t === 7) { r = 168; g = 164; b = 158; }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (const b of world.buildings) {
    if (b.open) continue;
    const f = Math.min(1, b.floors / 12);
    ctx.fillStyle = b.style === BSTYLE.HOUSE ? '#c9846e' : b.style === BSTYLE.CONTAINER ? '#5b88b0' : `rgb(${200 - f * 50},${196 - f * 46},${206 - f * 40})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
    ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  }
  return c;
}

export class Minimap {
  constructor(root, world) {
    this.world = world;
    this.map = renderMapImage(world);
    this.wrap = el('div');
    this.wrap.id = 'minimap';
    this.canvas = el('canvas');
    this.canvas.width = 200; this.canvas.height = 200;
    this.wrap.append(this.canvas);
    root.append(this.wrap);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.waypoint = null;
  }

  draw(g) {
    const ctx = this.ctx;
    const S = this.canvas.width;
    const L = g.local;
    const scale = L.car ? 1.4 : 2.2; // px per tile
    const cx = L.x / TILE, cy = L.y / TILE;
    ctx.fillStyle = '#245d8f';
    ctx.fillRect(0, 0, S, S);
    const half = S / 2 / scale;
    ctx.drawImage(this.map, cx - half, cy - half, half * 2, half * 2, 0, 0, S, S);
    const toS = (x, y) => [S / 2 + (x / TILE - cx) * scale, S / 2 + (y / TILE - cy) * scale];
    const clampS = (p) => {
      const dx = p[0] - S / 2, dy = p[1] - S / 2, d = Math.hypot(dx, dy), m = S / 2 - 8;
      return d > m ? [S / 2 + (dx / d) * m, S / 2 + (dy / d) * m, true] : [p[0], p[1], false];
    };
    // POIs
    ctx.font = 'bold 9px Silkscreen, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const poi of this.world.pois) {
      const st = POI_STYLE[poi.type];
      if (!st) continue;
      const p = toS(poi.x, poi.y);
      if (p[0] < -6 || p[1] < -6 || p[0] > S + 6 || p[1] > S + 6) continue;
      ctx.fillStyle = '#1b1d2a';
      ctx.fillRect(p[0] - 6, p[1] - 6, 12, 12);
      ctx.fillStyle = st[0];
      ctx.fillRect(p[0] - 5, p[1] - 5, 10, 10);
      ctx.fillStyle = '#1b1d2a';
      ctx.fillText(st[1], p[0], p[1] + 0.5);
    }
    // police and other players
    const t = performance.now() / 1000;
    for (const e of g.state.vehicles.map.values()) {
      const info = g.state.vehicles.info.get(e.id);
      if (!info || info.k !== 'police' || info.d) continue;
      const p = toS(e.cur.x, e.cur.y);
      ctx.fillStyle = Math.floor(t * 4) % 2 ? '#ff4040' : '#4070ff';
      ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
    }
    for (const e of g.state.players.map.values()) {
      const p = clampS(toS(e.cur.x, e.cur.y));
      ctx.fillStyle = '#1b1d2a';
      ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#7ee0a3';
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.2, 0, 7); ctx.fill();
    }
    // objectives
    const target = g.objective();
    if (target) {
      const p = clampS(toS(target[0], target[1]));
      ctx.fillStyle = '#1b1d2a';
      ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 7); ctx.fill();
      ctx.fillStyle = Math.floor(t * 3) % 2 ? '#ffd166' : '#fff3b0';
      ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, 7); ctx.fill();
    }
    if (this.waypoint) {
      const p = clampS(toS(this.waypoint[0], this.waypoint[1]));
      ctx.fillStyle = '#ff86bd';
      ctx.beginPath(); ctx.moveTo(p[0], p[1] - 7); ctx.lineTo(p[0] + 5, p[1]); ctx.lineTo(p[0], p[1] + 7); ctx.lineTo(p[0] - 5, p[1]); ctx.fill();
    }
    // player arrow
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(L.a + Math.PI / 2);
    ctx.fillStyle = '#1b1d2a';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff6e3';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // north marker
    ctx.fillStyle = '#fff6e3';
    ctx.font = 'bold 11px Silkscreen, monospace';
    ctx.fillText('N', S / 2, 10);
  }
}

export function openBigMap(root, g, minimap, onClose) {
  const wrap = el('div');
  wrap.id = 'bigmap';
  const panel = el('div', 'panel wrap');
  const W = g.world.w;
  const wide = innerWidth > innerHeight;
  const size = Math.floor(wide ? Math.min(innerWidth - 300, innerHeight * 0.86, 1024) : Math.min(innerWidth * 0.9, innerHeight * 0.6));
  const c = el('canvas');
  c.width = W * 2; c.height = W * 2;
  c.style.width = size + 'px'; c.style.height = size + 'px';
  panel.append(c);
  const legend = el('div', 'legend');
  legend.append(el('h3', null, 'Haven Bay'));
  for (const [k, st] of Object.entries(POI_STYLE)) {
    if (k === 'ferris' || k === 'lighthouse') continue;
    const s = el('span');
    const sw = el('span', 'kbd', st[1]);
    sw.style.background = st[0];
    s.append(sw, document.createTextNode(' ' + st[2]));
    legend.append(s);
  }
  legend.append(el('div', 'foot', `Sprites found: ${g.collected.size}/${g.world.collectibles.length}`));
  legend.append(el('div', 'foot', 'Click the map to set a waypoint. M or Esc closes it.'));
  panel.append(legend);
  wrap.append(panel);
  root.append(wrap);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let raf = 0;
  const draw = () => {
    ctx.drawImage(minimap.map, 0, 0, W * 2, W * 2);
    ctx.font = 'bold 14px Silkscreen, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const poi of g.world.pois) {
      const st = POI_STYLE[poi.type];
      if (!st) continue;
      const x = (poi.x / TILE) * 2, y = (poi.y / TILE) * 2;
      ctx.fillStyle = '#1b1d2a'; ctx.fillRect(x - 9, y - 9, 18, 18);
      ctx.fillStyle = st[0]; ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.fillStyle = '#1b1d2a'; ctx.fillText(st[1], x, y + 1);
    }
    for (const id of g.collected) {
      const s = g.world.collectibles[id];
      if (!s) continue;
      ctx.fillStyle = '#7fe6ff';
      ctx.fillRect((s.x / TILE) * 2 - 2, (s.y / TILE) * 2 - 2, 4, 4);
    }
    for (const r of g.races || []) {
      const [x, y] = r.cps[0];
      ctx.fillStyle = '#1b1d2a'; ctx.fillRect((x / TILE) * 2 - 9, (y / TILE) * 2 - 9, 18, 18);
      ctx.fillStyle = '#ffffff'; ctx.fillRect((x / TILE) * 2 - 7, (y / TILE) * 2 - 7, 14, 14);
      ctx.fillStyle = '#1b1d2a'; ctx.fillText('R', (x / TILE) * 2, (y / TILE) * 2 + 1);
    }
    for (const e of g.state.players.map.values()) {
      ctx.fillStyle = '#7ee0a3';
      ctx.beginPath(); ctx.arc((e.cur.x / TILE) * 2, (e.cur.y / TILE) * 2, 5, 0, 7); ctx.fill();
    }
    const o = g.objective();
    if (o) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc((o[0] / TILE) * 2, (o[1] / TILE) * 2, 8, 0, 7); ctx.fill(); }
    if (minimap.waypoint) { ctx.fillStyle = '#ff86bd'; ctx.beginPath(); ctx.arc((minimap.waypoint[0] / TILE) * 2, (minimap.waypoint[1] / TILE) * 2, 8, 0, 7); ctx.fill(); }
    const L = g.local;
    ctx.save();
    ctx.translate((L.x / TILE) * 2, (L.y / TILE) * 2);
    ctx.rotate(L.a + Math.PI / 2);
    ctx.fillStyle = '#1b1d2a';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 4); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff6e3';
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 2); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    raf = requestAnimationFrame(draw);
  };
  draw();
  c.addEventListener('click', (e) => {
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W * TILE, y = ((e.clientY - r.top) / r.height) * W * TILE;
    minimap.waypoint = minimap.waypoint && Math.hypot(minimap.waypoint[0] - x, minimap.waypoint[1] - y) < 200 ? null : [x, y];
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  function close() { cancelAnimationFrame(raf); wrap.remove(); onClose?.(); }
  return { close };
}
