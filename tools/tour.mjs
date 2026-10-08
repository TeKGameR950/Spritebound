// Screenshot tour of menus and gameplay systems. Needs a server started with DEV=1.
// node tools/tour.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:3100', out = '.'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack || e.message}`));
await page.addInitScript(() => localStorage.setItem('sb_settings', JSON.stringify({ hints: false })));
const t0 = Date.now();
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name}`); };
const wait = (ms) => page.waitForTimeout(ms);
const cmd = async (m) => { await page.evaluate((m) => window.__game.net.send({ t: 'chat', m }), m); await wait(900); };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); await shot('fail-' + name); } };

await page.goto(base);
await page.waitForSelector('#title .play', { timeout: 180000 });
await wait(1500);
await shot('t01-title');

await step('creator', async () => {
  await page.click('#title .play');
  await page.waitForSelector('.creator', { timeout: 10000 });
  await wait(800);
  await shot('t02-creator');
  const name = page.locator('.modal input[type=text]').first();
  await name.fill('Tour' + Math.floor(Math.random() * 999));
  const buttons = page.locator('.modal .opts .icon-btn');
  const n = await buttons.count();
  for (let i = 0; i < Math.min(n, 6); i += 2) await buttons.nth(i).click();
  await wait(400);
  await shot('t03-creator-edited');
  await page.locator('.modal button.btn', { hasText: /save|let.s go/i }).first().click();
  await wait(500);
  await page.click('#title .play');
  await page.waitForFunction(() => window.__game && window.__game.running, null, { timeout: 60000 });
  await wait(1500);
});

await step('menu', async () => {
  await page.keyboard.press('Escape');
  await wait(600);
  await shot('t04-menu');
  await page.keyboard.press('Escape');
  await wait(1500);
  await page.evaluate(() => window.__game.ui.openSettings());
  await wait(600);
  await shot('t05-settings');
  await page.keyboard.press('Escape');
  await wait(300);
});

await step('shop', async () => {
  const poi = await page.evaluate(() => window.__game.world.pois.find((p) => p.type === 'gunshop'));
  await cmd(`/tp ${Math.floor(poi.x / 16)} ${Math.floor(poi.y / 16)}`);
  await cmd('/money 5000');
  await wait(2500);
  await page.evaluate((p) => { const g = window.__game; g.ui.openShop(p); }, poi);
  await wait(800);
  await shot('t06-shop');
  const buy = page.locator('.modal button', { hasText: /\$/ }).first();
  if (await buy.count()) await buy.click();
  await wait(800);
  await shot('t07-bought');
  await page.keyboard.press('Escape');
  await wait(300);
});

await step('pizza', async () => {
  const poi = await page.evaluate(() => window.__game.world.pois.find((p) => p.type === 'pizza'));
  await cmd(`/tp ${Math.floor(poi.x / 16)} ${Math.floor(poi.y / 16)}`);
  await wait(2500);
  await page.evaluate(() => window.__game.net.send({ t: 'buy', shop: 'pizza', item: 'job:pizza' }));
  await wait(2500);
  await shot('t08-pizza-job');
  const job = await page.evaluate(() => window.__game.job && { kind: window.__game.job.kind, target: window.__game.objective() });
  console.log('job', JSON.stringify(job));
  await page.evaluate(() => window.__game.net.send({ t: 'job', a: 'cancel' }));
  await wait(600);
});

await step('police', async () => {
  await cmd('/tp 300 330');
  await wait(2000);
  await cmd('/wanted 3');
  await wait(9000);
  await shot('t09-wanted');
  const cops = await page.evaluate(() => [...window.__game.state.vehicles.info.values()].filter((i) => i.k === 'police').length);
  console.log('police vehicles in view', cops);
  await cmd('/wanted 0');
});

await step('ko', async () => {
  await page.evaluate(() => window.__game.net.send({ t: 'respawn' }));
  await page.evaluate(() => { const g = window.__game; g.local.stats.hp = 0; });
  await cmd('/give grenade');
  await page.evaluate(() => { const g = window.__game; g.local.selectWeapon(8); });
  await wait(500);
  await shot('t10-grenade');
});

await step('players', async () => {
  await page.keyboard.down('Tab');
  await wait(600);
  await shot('t11-players');
  await page.keyboard.up('Tab');
});

console.log('--- console (' + logs.length + ')');
for (const l of logs.slice(0, 30)) console.log(l.slice(0, 400));
await browser.close();
