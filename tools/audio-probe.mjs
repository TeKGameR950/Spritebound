// Plays every synthesized sound effect and the radio in headless Chromium, and reports peak levels.
// node tools/audio-probe.mjs <baseUrl>
import { chromium } from 'playwright';

const [base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));
await page.addInitScript(() => {
  localStorage.setItem('sb_name', JSON.stringify('Ears' + Math.floor(Math.random() * 999)));
  localStorage.setItem('sb_app', JSON.stringify({ body: 0, skin: 1, hair: 2, hairColor: 1, top: 0, topColor: 2, pants: 0, pantsColor: 1, shoes: 0, hat: 0, hatColor: 0, acc: 0, accColor: 0 }));
  localStorage.setItem('sb_settings', JSON.stringify({ hints: false }));
});
await page.goto(base);
await page.waitForSelector('#title .play', { timeout: 180000 });
await page.click('#title .play');
await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 60000 });
const result = await page.evaluate(async () => {
  const g = window.__game;
  const A = g.audio;
  const { SFX } = await import('/js/audio/sfx.js');
  const an = A.ctx.createAnalyser();
  an.fftSize = 2048;
  A.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  const peak = async (ms) => {
    let p = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) p = Math.max(p, Math.abs(v));
      await new Promise((r) => setTimeout(r, 20));
    }
    return p;
  };
  const silent = [], failed = [], levels = {};
  await peak(300);
  for (const name of Object.keys(SFX)) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      A.play(name, undefined, undefined, { force: true, bus: 'ui' });
    } catch (e) { failed.push(name + ': ' + e.message); continue; }
    const p = await peak(450);
    levels[name] = Math.round(p * 1000) / 1000;
    if (p < 0.002) silent.push(name);
  }
  return { count: Object.keys(SFX).length, failed, silent, levels, ctx: A.ctx.state };
});
console.log(JSON.stringify(result, null, 1));
console.log('--- console (' + logs.length + ')');
for (const l of logs.slice(0, 20)) console.log(l.slice(0, 300));
await browser.close();
