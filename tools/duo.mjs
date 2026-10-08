// Two-player smoke test: both players join, meet, see each other and connect proximity voice.
// node tools/duo.mjs <baseUrl> <outDir>   (server must run with DEV=1)
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:3100', out = '.'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(process.env.FAKE_MIC ? ['--use-file-for-fake-audio-capture=' + process.env.FAKE_MIC] : [])],
});
const logs = [];
async function player(name, hat) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${name} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${name} pageerror] ${e.stack || e.message}`));
  await page.addInitScript(([n, h]) => {
    localStorage.setItem('sb_name', JSON.stringify(n));
    localStorage.setItem('sb_app', JSON.stringify({ body: 0, skin: 2, hair: 3, hairColor: 2, top: 2, topColor: 9, pants: 1, pantsColor: 3, shoes: 1, hat: h, hatColor: 5, acc: 0, accColor: 0 }));
    localStorage.setItem('sb_settings', JSON.stringify({ voiceOn: true, voiceMode: 'open', hints: false }));
  }, [name, hat]);
  if (process.env.TRACE_RTC) await page.addInitScript(() => {
    window.__rtc = [];
    const t0 = performance.now();
    const log = (s) => window.__rtc.push(((performance.now() - t0) / 1000).toFixed(2) + ' ' + s);
    const Orig = window.RTCPeerConnection;
    let n = 0;
    window.RTCPeerConnection = function (cfg) {
      const pc = new Orig(cfg);
      const id = ++n;
      log(`pc${id} new`);
      pc.addEventListener('signalingstatechange', () => log(`pc${id} sig ${pc.signalingState}`));
      pc.addEventListener('iceconnectionstatechange', () => log(`pc${id} ice ${pc.iceConnectionState}`));
      pc.addEventListener('icegatheringstatechange', () => log(`pc${id} gather ${pc.iceGatheringState}`));
      const srd = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = (d) => { log(`pc${id} srd ${d && d.type}`); return srd(d).catch((e) => { log(`pc${id} srd error ${e.message}`); throw e; }); };
      const aic = pc.addIceCandidate.bind(pc);
      pc.addIceCandidate = (c) => { log(`pc${id} aic ${c && c.candidate ? c.candidate.split(' ').slice(4, 8).join(' ') : 'end'}`); return aic(c).catch((e) => { log(`pc${id} aic error ${e.message}`); throw e; }); };
      pc.addEventListener('icecandidate', (e) => log(`pc${id} local cand ${e.candidate ? e.candidate.candidate.split(' ').slice(4, 8).join(' ') : 'end'}`));
      const sld = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = (d) => { log(`pc${id} sld ${d ? d.type : 'auto'}`); return sld(d).catch((e) => { log(`pc${id} sld error ${e.message}`); throw e; }); };
      const close = pc.close.bind(pc);
      pc.close = () => { log(`pc${id} close`); close(); };
      return pc;
    };
    window.RTCPeerConnection.prototype = Orig.prototype;
  });
  await page.goto(base);
  await page.waitForSelector('#title .play', { timeout: 180000 });
  await page.click('#title .play');
  await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 60000 });
  return page;
}
const tag = Math.floor(Math.random() * 900 + 100);
const a = await player('Ada' + tag, 2);
const b = await player('Bo' + tag, 4);
const chat = (p, m) => p.evaluate((m) => window.__game.net.send({ t: 'chat', m }), m);
await chat(a, '/tp 300 300');
await chat(b, '/tp 302 300');
await a.waitForTimeout(6000);
const probe = (p) => p.evaluate(() => {
  const g = window.__game;
  const peers = [...g.voice.peers.values()].map((q) => ({ id: q.id, ice: q.pc.iceConnectionState, audio: !!q.audio, level: q.audio?.vad?.level ?? null }));
  return { me: g.local.id, seen: [...g.state.players.info.values()].map((i) => i.name), voice: g.voice.status, peers, talking: g.voice.speaking };
});
let ra, rb;
for (let i = 0; i < 20; i++) {
  ra = await probe(a); rb = await probe(b);
  if (ra.peers[0]?.ice === 'connected' && rb.peers[0]?.ice === 'connected' && ra.peers[0].audio) break;
  await a.waitForTimeout(1000);
}
console.log('A', JSON.stringify(ra));
console.log('B', JSON.stringify(rb));
const rtp = (p) => p.evaluate(async () => {
  const g = window.__game;
  const q = [...g.voice.peers.values()][0];
  if (!q) return null;
  const r = { ctx: g.audio.ctx.state, mic: g.voice.micLevel ?? null };
  (await q.pc.getStats()).forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'audio') { r.inBytes = s.bytesReceived; r.inLevel = s.audioLevel; }
    if (s.type === 'outbound-rtp' && s.kind === 'audio') r.outBytes = s.bytesSent;
  });
  return r;
});
console.log('A rtp', JSON.stringify(await rtp(a)));
console.log('B rtp', JSON.stringify(await rtp(b)));
if (process.env.TRACE_RTC) {
  console.log('A trace\n  ' + (await a.evaluate(() => window.__rtc)).join('\n  '));
  console.log('B trace\n  ' + (await b.evaluate(() => window.__rtc)).join('\n  '));
}
await chat(a, '/tp 120 120');
await a.waitForTimeout(8000);
const apart = [(await probe(a)).peers.length, (await probe(b)).peers.length];
console.log('peers after moving apart', JSON.stringify(apart));
await chat(a, '/tp 301 301');
let back;
for (let i = 0; i < 15; i++) {
  await a.waitForTimeout(1000);
  back = [await probe(a), await probe(b)];
  if (back.every((r) => r.peers[0]?.ice === 'connected')) break;
}
console.log('relinked', JSON.stringify(back.map((r) => r.peers.map((q) => q.ice))));
await a.waitForTimeout(900);
await chat(a, 'hello from Ada');
await a.waitForTimeout(1500);
const where = await a.evaluate(() => {
  const g = window.__game;
  const o = [...g.state.players.map.values()][0];
  const me = g.cam.worldToScreen(g.local.x, g.local.y, 0);
  const them = o && g.cam.worldToScreen(o.cur.x, o.cur.y, 0);
  const tag = [...document.querySelectorAll('#world-ui > *')].map((e) => [e.textContent, e.style.transform || e.style.left + ',' + e.style.top]);
  return { me: [g.local.x | 0, g.local.y | 0], meScreen: me?.map(Math.round), them: o && [o.cur.x | 0, o.cur.y | 0], themScreen: them?.map(Math.round), cam: [g.cam.x | 0, g.cam.y | 0], tag };
});
console.log('where', JSON.stringify(where));
await a.screenshot({ path: `${out}/duo-a.png` });
await b.screenshot({ path: `${out}/duo-b.png` });
const chatSeen = await b.evaluate(() => document.querySelector('#chat')?.textContent || '');
console.log('B chat has hello:', chatSeen.includes('hello from Ada'));
console.log('--- console (' + logs.length + ')');
for (const l of logs.slice(0, 30)) console.log(l.slice(0, 400));
await browser.close();
