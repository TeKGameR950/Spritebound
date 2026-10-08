import { unpackWorld } from '/shared/worlddata.js';
import { PROTOCOL_VERSION } from '/shared/constants.js';
import { randomAppearance, sanitizeAppearance } from '/shared/appearance.js';
import { Renderer } from './gfx/renderer.js';
import { Camera } from './gfx/camera.js';
import { timeOfDay } from './gfx/lighting.js';
import { InstanceWriter } from './gfx/sprites.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { AudioEngine } from './audio/audio.js';
import { VoiceChat } from './voice.js';
import { UI } from './ui/ui.js';
import { openCreator, drawPortrait } from './ui/creator.js';
import { el, esc } from './ui/dom.js';
import { Game } from './game/game.js';

const TIPS = [
  'Tip: the handbrake (Space) lets you swing the car around corners.',
  'Tip: a fresh paint job at a respray garage makes the police forget you.',
  'Tip: the radio plays the same song for everyone tuned in. Radio parties!',
  'Tip: Sprites glow at night. They are easier to spot after sunset.',
  'Tip: hold V to talk to players nearby. Their voices fade with distance.',
  'Tip: pizza deliveries pay a bonus when they arrive hot.',
];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = Object.assign({ master: 0.8, sfx: 0.9, music: 0.5, ambience: 0.7, voice: 1, shake: 0.7, scale: 1, shadows: true, bloom: true, nametags: true, pocketRadio: false, autoRadio: true, voiceOn: false, voiceMode: 'ptt', hints: true }, store.get('sb_settings', {}));
const saveSettings = () => store.set('sb_settings', settings);

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const worldUi = document.getElementById('world-ui');

function loadingScreen() {
  const l = el('div');
  l.id = 'loading';
  l.innerHTML = `<div class="logo">SPRITE<span class="b">BOUND</span></div><div class="bar"><div></div></div><div class="msg">Waking up the city...</div><div class="tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>`;
  document.body.append(l);
  return {
    set(f, msg) { l.querySelector('.bar > div').style.width = Math.round(f * 100) + '%'; if (msg) l.querySelector('.msg').textContent = msg; },
    done() { l.classList.add('done'); setTimeout(() => l.remove(), 700); },
    error(msg) { l.querySelector('.msg').innerHTML = `<span style="color:var(--red)">${esc(msg)}</span>`; l.querySelector('.bar').style.display = 'none'; },
  };
}

function fatal(msg) {
  const o = el('div', 'modal-wrap');
  o.innerHTML = `<div class="panel modal" style="max-width:520px"><h2>Oh no!</h2><p>${esc(msg)}</p></div>`;
  const b = el('button', 'btn', 'Reload');
  b.onclick = () => location.reload();
  o.firstChild.append(b);
  uiRoot.append(o);
}

async function boot() {
  const load = loadingScreen();
  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (e) {
    load.error('Your browser does not support WebGL2. Try a recent Chrome, Firefox, Edge or Safari.');
    return;
  }
  renderer.quality.scale = settings.scale;
  renderer.quality.shadows = settings.shadows !== false;
  renderer.quality.bloom = settings.bloom !== false;
  load.set(0.02, 'Downloading Haven Bay...');
  let world;
  try {
    const res = await fetch('/api/world');
    world = unpackWorld(await res.json());
  } catch (e) {
    load.error('Could not reach the server. Is it running?');
    return;
  }
  await renderer.initWorld(world, (f, msg) => load.set(0.05 + f * 0.85, msg + '...'));
  const net = new Net();
  load.set(0.94, 'Saying hi to the server...');
  try { await net.connect(); } catch (e) { load.error(e.message); return; }
  const audio = new AudioEngine();
  Object.assign(audio.vol, { master: settings.master, sfx: settings.sfx, music: settings.music, ambience: settings.ambience, voice: settings.voice });
  const voice = new VoiceChat(net, audio);
  voice.mode = settings.voiceMode || 'ptt';
  const input = new Input(canvas);
  const ui = new UI(uiRoot, worldUi, { audio, voice, settings, saveSettings });

  let profile = null;
  let game = null;
  net.on('profile', (m) => {
    profile = m;
    load.set(1, 'Ready!');
    load.done();
    showTitle();
  });
  net.on('kick', (m) => fatal(m.m));
  net.on('close', () => { if (!kicked) fatal('Lost connection to the server. It may be restarting, try again in a moment.'); });
  let kicked = false;
  net.on('kick', (m) => { kicked = true; fatal(m.m); });
  net.send({ t: 'hello', v: PROTOCOL_VERSION, token: store.get('sb_token', null) });

  // ---------------------------------------------------------------- title flyover
  const cam = new Camera();
  const dyn = new InstanceWriter(16);
  const lights = new Float32Array(12 * 2048);
  let titleRunning = true;
  const path = [[306, 250], [330, 300], [260, 330], [215, 300], [300, 420], [380, 360]].map(([x, y]) => [x * 16, y * 16]);
  const t0 = performance.now();
  const titleFrame = (now) => {
    if (!titleRunning) return;
    requestAnimationFrame(titleFrame);
    const t = Math.max(0, (now - t0) / 1000);
    const seg = (t / 28) % path.length;
    const i = Math.floor(seg), f = seg - i;
    const a = path[i], b = path[(i + 1) % path.length];
    const s = f * f * (3 - 2 * f);
    cam.x = a[0] + (b[0] - a[0]) * s;
    cam.y = a[1] + (b[1] - a[1]) * s;
    cam.zoom = 1.25 + Math.sin(t * 0.1) * 0.15;
    renderer.resize(innerWidth, innerHeight, devicePixelRatio || 1);
    cam.setScreen(renderer.w, renderer.h);
    cam.update();
    const tod = timeOfDay(19.05 + Math.sin(t * 0.02) * 0.4, { cloud: 0.25 });
    let n = 0;
    const [x0, y0, x1, y1] = cam.groundBounds(150);
    if (tod.streetLights > 0.01) renderer.wg.forEachInCells(renderer.wg.lightGrid, x0, y0, x1, y1, (L) => {
      if (n >= 2000) return;
      const k = (L.k === 'street' ? 0.95 : 0.5) * tod.streetLights;
      const o = n * 12;
      lights[o] = L.x; lights[o + 1] = L.y; lights[o + 2] = L.z; lights[o + 3] = L.r;
      lights[o + 4] = L.c[0] * k; lights[o + 5] = L.c[1] * k; lights[o + 6] = L.c[2] * k; lights[o + 7] = L.k === 'street' ? 1 : 0;
      lights[o + 8] = 0; lights[o + 9] = 0; lights[o + 10] = -2; lights[o + 11] = 0;
      n++;
    });
    renderer.render({ cam, tod, time: t, dyn, lights, nLights: n, parts: null, fadePos: [0, 0], wet: 0, fade: Math.min(1, t * 0.8) });
  };
  requestAnimationFrame(titleFrame);

  let title = null;
  function showTitle(error) {
    title?.remove();
    const name = profile.exists ? profile.name : store.get('sb_name', '');
    const app = profile.exists && profile.app ? profile.app : store.get('sb_app', null);
    title = el('div');
    title.id = 'title';
    title.innerHTML = `
      <div class="col">
        <div class="logo">SPRITE<span class="b">BOUND</span></div>
        <div class="tagline">A cozy pixel city to cruise, explore and share.</div>
        <div class="server"><span class="dot"></span>${esc(profile.server)} · ${profile.players}/${profile.max} online${profile.pvp ? '' : ' · peaceful server'}</div>
        <div class="panel who"><canvas width="72" height="72"></canvas><div><div style="font-size:20px;font-weight:700" class="nm"></div><div class="muted mn"></div></div></div>
        <button class="btn play">${name ? 'Play' : 'Create character'}</button>
        <button class="btn secondary edit">Customize character</button>
        <label class="check"><input type="checkbox" class="vc"> Proximity voice chat (microphone)</label>
        <div class="row"><button class="btn secondary small set">Settings</button><button class="btn secondary small help">How to play</button></div>
        <div class="err" style="color:var(--red);min-height:20px"></div>
        <div class="panel motd">${esc(profile.motd || '')}</div>
      </div>
      <div class="foot">spritebound.world · WASD to move, E to drive, M for the map. Made with pixels and love.</div>`;
    uiRoot.append(title);
    title.querySelector('.nm').textContent = name || 'New in town';
    title.querySelector('.mn').textContent = profile.exists ? `$${profile.money.toLocaleString('en-US')} in the bank` : 'Make yourself a character!';
    if (app) drawPortrait(title.querySelector('.who canvas'), app);
    else title.querySelector('.who').classList.add('hidden');
    const vc = title.querySelector('.vc');
    vc.checked = !!settings.voiceOn;
    vc.onchange = () => { settings.voiceOn = vc.checked; saveSettings(); };
    if (error) title.querySelector('.err').textContent = error;
    const edit = () => openCreator(uiRoot, {
      name, app, mode: profile.exists ? 'edit' : 'new', audio,
      onSave: (n, a) => { store.set('sb_name', n); store.set('sb_app', a); profile.name = n; profile.app = a; profile.exists = profile.exists || false; pendingJoin = { name: n, app: a }; showTitle(); },
      onCancel: () => {},
    });
    title.querySelector('.edit').onclick = () => { audio.start(); edit(); };
    title.querySelector('.set').onclick = () => { audio.start(); ui.g = ui.g || { renderer, radio: { setContext() {} }, local: { car: null } }; ui.openSettings(); };
    title.querySelector('.help').onclick = () => ui.openHelp();
    title.querySelector('.play').onclick = async () => {
      await audio.start();
      const n = pendingJoin?.name || name;
      const a = pendingJoin?.app || app;
      if (!n) { edit(); return; }
      if (settings.voiceOn) voice.enable();
      title.querySelector('.play').disabled = true;
      net.send({ t: 'join', name: n, app: sanitizeAppearance(a || randomAppearance(Date.now())) });
    };
  }
  let pendingJoin = null;

  net.on('deny', (m) => { if (!game && title) showTitle(m.m); });
  net.on('welcome', (w) => {
    store.set('sb_token', w.token);
    store.set('sb_name', w.name);
    store.set('sb_app', w.app);
    titleRunning = false;
    title?.remove();
    ui.closeModal();
    game = new Game({ renderer, world, net, audio, voice, ui, input, settings });
    window.__game = game;
    game.start(w);
    if (settings.voiceOn && !voice.enabled) voice.enable();
  });
  window.__frames = 0;
  const countFrames = () => { window.__frames++; requestAnimationFrame(countFrames); };
  requestAnimationFrame(countFrames);
}

boot().catch((e) => { console.error(e); fatal('Something went wrong while starting: ' + e.message); });
