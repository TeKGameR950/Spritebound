// Temporary renderer test harness (replaced by the full game boot).
import { unpackWorld } from '/shared/worlddata.js';
import { Renderer, LIGHT_FLOATS } from './gfx/renderer.js';
import { Camera } from './gfx/camera.js';
import { timeOfDay } from './gfx/lighting.js';
import { InstanceWriter } from './gfx/sprites.js';
import { buildVehicle } from './gfx/art-vehicles.js';
import { buildCharacter, SPLIT_Z } from './gfx/art-characters.js';
import { VEHICLES, PAINTS } from '/shared/vehicles.js';
import { randomAppearance } from '/shared/appearance.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
ui.innerHTML = '<div id="dbg" style="position:fixed;left:8px;top:8px;color:#fff;font:12px monospace;text-shadow:1px 1px #000;white-space:pre"></div>';
const dbg = document.getElementById('dbg');

async function boot() {
  const res = await fetch('/api/world');
  const world = unpackWorld(await res.json());
  const r = new Renderer(canvas);
  await r.initWorld(world, (f, msg) => (dbg.textContent = `${msg} ${(f * 100) | 0}%`));
  const cam = new Camera();
  cam.x = Number(q.get('x') || 306 * 16);
  cam.y = Number(q.get('y') || 262 * 16);
  cam.zoom = Number(q.get('zoom') || 1);
  cam.tilt = Number(q.get('tilt') || 0);
  let hour = Number(q.get('hour') || 15);
  const freeze = q.has('freeze');
  const dyn = new InstanceWriter(2048);
  const lights = new Float32Array(LIGHT_FLOATS * 4096);
  // test cars and people
  const cars = [];
  for (let i = 0; i < VEHICLES.length; i++) {
    const def = r.bank.fromVox(`v:${i}:${i}`, buildVehicle(i, PAINTS[(i * 3) % PAINTS.length]), { mat: 2 });
    cars.push({ def, x: cam.x - 200 + i * 34, y: cam.y + 40, a: -Math.PI / 2 + (i % 2) * 0.3 });
  }
  const people = [];
  for (let i = 0; i < 10; i++) {
    const app = randomAppearance(i * 977 + 3);
    const pose = ['pistol', 'rifle', 'idle', 'bat', 'smg', 'shotgun', 'rocket', 'punch', 'wave', 's0'][i];
    const def = r.bank.fromVox(`c:${i}`, buildCharacter(app, i % 2 ? 'w0' : 'idle', pose), { mat: 2 });
    people.push({ def, x: cam.x - 120 + i * 24, y: cam.y - 30, a: i * 0.6 });
  }
  const keys = {};
  addEventListener('keydown', (e) => (keys[e.code] = true));
  addEventListener('keyup', (e) => (keys[e.code] = false));
  let last = performance.now();
  let t0 = last;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sp = (keys.ShiftLeft ? 900 : 300) * dt;
    if (keys.KeyW) cam.y -= sp; if (keys.KeyS) cam.y += sp; if (keys.KeyA) cam.x -= sp; if (keys.KeyD) cam.x += sp;
    if (keys.KeyQ) cam.zoom *= 1.02; if (keys.KeyE) cam.zoom /= 1.02;
    if (keys.KeyT) hour += dt * 2;
    r.resize(innerWidth, innerHeight, devicePixelRatio || 1);
    cam.setScreen(r.w, r.h);
    cam.update();
    const tod = timeOfDay(hour, { cloud: Number(q.get('cloud') || 0.25), rain: Number(q.get('rain') || 0) });
    dyn.reset();
    for (const c of cars) dyn.stack(c.def, c.x, c.y, 0, c.a, { flags: tod.night > 0.3 ? 1 : 0 });
    for (const p of people) dyn.stack(p.def, p.x, p.y, 0, p.a);
    // lights
    let nL = 0;
    const [x0, y0, x1, y1] = cam.groundBounds(150);
    const L = (x, y, z, rad, c, cone, occ = 1) => {
      const o = nL * LIGHT_FLOATS;
      lights[o] = x; lights[o + 1] = y; lights[o + 2] = z; lights[o + 3] = rad;
      lights[o + 4] = c[0]; lights[o + 5] = c[1]; lights[o + 6] = c[2]; lights[o + 7] = occ;
      lights[o + 8] = cone ? cone[0] : 0; lights[o + 9] = cone ? cone[1] : 0; lights[o + 10] = cone ? cone[2] : -2; lights[o + 11] = cone ? cone[3] : 0;
      nL++;
    };
    const sl = tod.streetLights;
    if (sl > 0.01) {
      r.wg.forEachInCells(r.wg.lightGrid, x0, y0, x1, y1, (s) => {
        if (s.off || nL > 4000) return;
        const k = s.k === 'street' ? 0.6 : s.k === 'fire' ? 1.0 : s.k === 'blink' ? 0.4 : 0.5;
        L(s.x, s.y, s.z, s.r, [s.c[0] * k * sl, s.c[1] * k * sl, s.c[2] * k * sl], null, s.k === 'street' ? 1 : 0);
      });
      for (const c of cars) {
        const fx = Math.cos(c.a), fy = Math.sin(c.a);
        L(c.x + fx * 20, c.y + fy * 20, 6, 150, [0.95 * sl, 0.88 * sl, 0.7 * sl], [fx, fy, 0.82, 0.95]);
      }
    }
    r.render({ cam, tod, time: freeze ? 10 : (now - t0) / 1000, dyn, lights, nLights: nL, parts: null, fadePos: [cam.x, cam.y], wet: Number(q.get('rain') || 0) });
    dbg.textContent = `pos ${(cam.x / 16) | 0},${(cam.y / 16) | 0}  hour ${hour.toFixed(1)}  zoom ${cam.zoom.toFixed(2)}\ninst ${r.stats.instances} lights ${r.stats.lights} chunks ${r.stats.chunks}  atlas layer ${r.atlas.layer}`;
    window.__frames = (window.__frames || 0) + 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
boot().catch((e) => { dbg.textContent = 'ERROR: ' + e.message; console.error(e); });
