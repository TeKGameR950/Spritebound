// End-to-end smoke test in headless Chromium.
// node tools/play.mjs <baseUrl> <outDir> [scenario]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:3100', out = '.', scenario = 'basic'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));
await page.addInitScript(() => {
  localStorage.setItem('sb_name', JSON.stringify('Tester' + Math.floor(Math.random() * 999)));
  localStorage.setItem('sb_app', JSON.stringify({ body: 1, skin: 3, hair: 5, hairColor: 6, top: 1, topColor: 4, pants: 0, pantsColor: 13, shoes: 2, hat: 1, hatColor: 8, acc: 1, accColor: 2 }));
});
const t0 = Date.now();
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`); };
const frames = async (n) => {
  const start = await page.evaluate(() => window.__frames || 0);
  await page.waitForFunction((s) => (window.__frames || 0) >= s, start + n, { timeout: 120000, polling: 200 });
};
try {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('#title .play', { timeout: 180000 });
  await frames(3);
  await shot('01-title');
  await page.click('#title .play');
  await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 60000 });
  await frames(6);
  await shot('02-spawn');
  if (scenario === 'basic' || scenario === 'drive') {
    await page.keyboard.down('KeyD');
    await frames(10);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyS');
    await frames(8);
    await page.keyboard.up('KeyS');
    await shot('03-walked');
    // needs a server started with DEV=1
    await page.evaluate(() => window.__game.net.send({ t: 'chat', m: '/car sports' }));
    await frames(10);
    const info = await page.evaluate(() => {
      const g = window.__game;
      let best = null, bd = 1e9;
      for (const e of g.state.vehicles.map.values()) {
        const d = Math.hypot(e.cur.x - g.local.x, e.cur.y - g.local.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best && { id: best.id, d: Math.round(bd) };
    });
    console.log('nearest vehicle', JSON.stringify(info));
    if (info) {
      await page.keyboard.press('KeyE');
      await frames(8);
      const mode = await page.evaluate(() => window.__game.local.mode);
      console.log('mode after E:', mode);
      if (mode === 'drive') {
        await page.keyboard.down('KeyW');
        await frames(25);
        await shot('04-driving');
        await page.keyboard.down('KeyA');
        await page.keyboard.down('Space');
        await frames(10);
        await page.keyboard.up('Space');
        await page.keyboard.up('KeyA');
        await frames(10);
        await page.keyboard.up('KeyW');
        await shot('05-drift');
        const st = await page.evaluate(() => { const c = window.__game.local.car; return c && { x: c.x | 0, y: c.y | 0, speed: c.speed | 0, hp: c.hp | 0 }; });
        console.log('car state', JSON.stringify(st));
        await page.keyboard.press('KeyE');
        await frames(5);
      }
    }
    // shoot a pistol
    await page.evaluate(() => { const g = window.__game; g.local.stats.weapons.pistol = 1; g.local.stats.ammo.pistol = 30; g.local.selectWeapon(2); });
    await page.mouse.move(800, 300);
    await page.mouse.down();
    await frames(3);
    await page.mouse.up();
    await frames(3);
    await shot('06-shoot');
    await page.keyboard.press('KeyM');
    await frames(4);
    await shot('07-map');
    await page.keyboard.press('Escape');
    await frames(2);
    const stats = await page.evaluate(() => { const g = window.__game; return { players: g.state.players.map.size, vehicles: g.state.vehicles.map.size, peds: g.state.peds.map.size, inst: g.renderer.stats.instances, lights: g.renderer.stats.lights, parts: g.renderer.stats.particles, money: g.local.stats.money }; });
    console.log('stats', JSON.stringify(stats));
  }
  if (scenario === 'night') {
    const cmd = async (m) => { await page.evaluate((m) => window.__game.net.send({ t: 'chat', m }), m); await frames(4); await page.waitForTimeout(900); };
    await cmd('/time 22');
    await frames(6);
    await shot('night-spawn');
    await cmd('/tp 300 280');
    await frames(20);
    await shot('night-downtown');
    await cmd('/weather storm');
    await frames(30);
    await shot('night-storm');
    await cmd('/time 7');
    await cmd('/weather clear');
    await frames(20);
    await shot('morning');
  }
} catch (e) {
  console.log('ERROR', e.message);
  await shot('error');
}
console.log('--- console (' + logs.length + ')');
for (const l of logs.slice(0, 40)) console.log(l.slice(0, 600));
await browser.close();
