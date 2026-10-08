// Headless screenshot helper: node tools/shot.mjs <url> <out.png> [width] [height] [waitFrames]
import { chromium } from 'playwright';

const [url, out = 'shot.png', w = '1280', h = '720', frames = '8'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction((n) => (window.__frames || 0) >= n, Number(frames), { timeout: 240000, polling: 250 });
} catch (e) {
  logs.push('[timeout] waiting for frames: ' + e.message);
}
await page.screenshot({ path: out });
console.log(`shot in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
for (const l of logs.slice(0, 60)) console.log(l);
await browser.close();
