// Headless bot clients for smoke and load testing.
// Usage: node tools/bots.js [count] [url] [seconds]
import WebSocket from 'ws';
import { decodeSnapshot } from '../shared/protocol.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { randomAppearance } from '../shared/appearance.js';

const count = Number(process.argv[2] || 4);
const url = process.argv[3] || 'ws://localhost:3000/ws';
const seconds = Number(process.argv[4] || 20);
const stats = { snaps: 0, bytes: 0, players: 0, vehicles: 0, peds: 0, events: 0, info: 0, errors: 0, notes: [] };

function bot(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let me = null, tp = 1, x = 0, y = 0, a = Math.random() * 6.28, t0 = Date.now();
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: null })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const s = decodeSnapshot(ab);
        stats.snaps++; stats.bytes += data.byteLength;
        stats.players = Math.max(stats.players, s.players.length);
        stats.vehicles = Math.max(stats.vehicles, s.vehicles.length);
        stats.peds = Math.max(stats.peds, s.peds.length);
        return;
      }
      const m = JSON.parse(data.toString());
      if (m.t === 'profile') ws.send(JSON.stringify({ t: 'join', name: `Bot${i}_${(Math.random() * 999) | 0}`, app: randomAppearance(i * 31) }));
      else if (m.t === 'welcome') { me = m; x = m.x; y = m.y; tp = m.tp; }
      else if (m.t === 'tp') { x = m.x; y = m.y; tp = m.tp; }
      else if (m.t === 'ev') stats.events += m.e.length;
      else if (m.t === 'info') stats.info += (m.p.length + m.v.length + m.n.length);
      else if (m.t === 'note' || m.t === 'deny' || m.t === 'kick') stats.notes.push(m.m);
    });
    ws.on('error', (e) => { stats.errors++; console.error('bot error', e.message); });
    const iv = setInterval(() => {
      if (!me) return;
      a += (Math.random() - 0.5) * 0.4;
      const sp = 70;
      x += Math.cos(a) * sp * 0.05; y += Math.sin(a) * sp * 0.05;
      ws.send(JSON.stringify({ t: 's', s: [tp, x, y, a, 0, 1, 0, a, Math.cos(a) * sp, Math.sin(a) * sp] }));
      if (Math.random() < 0.01) ws.send(JSON.stringify({ t: 'chat', m: 'hello from a bot' }));
      if (Date.now() - t0 > seconds * 1000) { clearInterval(iv); ws.close(); resolve(); }
    }, 50);
  });
}

const t = Date.now();
await Promise.all(Array.from({ length: count }, (_, i) => bot(i)));
const secs = (Date.now() - t) / 1000;
console.log(JSON.stringify({ ...stats, notes: stats.notes.slice(0, 5), kbPerSecPerBot: Math.round(stats.bytes / 1024 / secs / count * 10) / 10 }, null, 1));
