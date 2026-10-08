import { SKIN, HAIR_STYLES, HAIR_COLORS, TOPS, HATS, ACCESSORIES, CLOTH, randomAppearance, sanitizeAppearance } from '/shared/appearance.js';
import { buildCharacter } from '../gfx/art-characters.js';
import { drawVox } from './preview.js';
import { el, sfx } from './dom.js';

const PANTS = ['pants', 'shorts', 'skirt'];
const BODY = ['slim', 'regular', 'broad'];

export function openCreator(root, { name = '', app, mode = 'new', onSave, onCancel, audio }) {
  let a = sanitizeAppearance(app || randomAppearance((Math.random() * 1e9) | 0));
  let angle = 0.6, auto = true, pose = 0, poseT = 0, dragging = false, lastX = 0;
  const wrap = el('div', 'modal-wrap');
  const modal = el('div', 'panel modal');
  wrap.append(modal);
  modal.append(el('h2', null, mode === 'makeover' ? 'Tailor: a whole new you' : mode === 'edit' ? 'Edit your character' : 'Create your character'));
  const grid = el('div', 'creator');
  modal.append(grid);
  const left = el('div', 'preview');
  const canvas = el('canvas');
  canvas.width = 288; canvas.height = 288;
  const ctx = canvas.getContext('2d');
  left.append(canvas);
  const nameIn = el('input');
  nameIn.type = 'text'; nameIn.maxLength = 16; nameIn.placeholder = 'Your name'; nameIn.value = name;
  nameIn.disabled = mode === 'makeover';
  left.append(nameIn);
  const rnd = el('button', 'btn secondary small', 'Randomize');
  rnd.onclick = () => { a = randomAppearance((Math.random() * 1e9) | 0); sfx(audio, 'click'); refresh(); };
  left.append(rnd);
  left.append(el('div', 'muted', 'Drag the preview to spin it.'));
  grid.append(left);
  const opts = el('div', 'opts');
  grid.append(opts);

  const rows = [];
  const stepper = (label, key, names) => {
    const row = el('div', 'opt');
    row.append(el('div', 'lbl', label));
    const st = el('div', 'stepper');
    const prev = el('button', 'icon-btn', '<'), next = el('button', 'icon-btn', '>');
    const val = el('div', 'val');
    prev.onclick = () => { a[key] = (a[key] - 1 + names.length) % names.length; sfx(audio, 'click'); refresh(); };
    next.onclick = () => { a[key] = (a[key] + 1) % names.length; sfx(audio, 'click'); refresh(); };
    st.append(prev, val, next);
    row.append(st);
    opts.append(row);
    rows.push(() => (val.textContent = names[a[key]]));
  };
  const swatch = (label, key, colors) => {
    const row = el('div', 'opt');
    row.append(el('div', 'lbl', label));
    const box = el('div', 'swatches');
    const items = colors.map((c, i) => {
      const s = el('div', 'sw');
      s.style.background = c;
      s.title = c;
      s.onclick = () => { a[key] = i; sfx(audio, 'click'); refresh(); };
      box.append(s);
      return s;
    });
    row.append(box);
    opts.append(row);
    rows.push(() => items.forEach((s, i) => s.classList.toggle('on', i === a[key])));
  };
  stepper('Body', 'body', BODY);
  swatch('Skin', 'skin', SKIN);
  stepper('Hair', 'hair', HAIR_STYLES);
  swatch('Hair color', 'hairColor', HAIR_COLORS);
  stepper('Top', 'top', TOPS);
  swatch('Top color', 'topColor', CLOTH);
  stepper('Bottoms', 'pants', PANTS);
  swatch('Bottoms color', 'pantsColor', CLOTH);
  swatch('Shoes', 'shoes', CLOTH);
  stepper('Hat', 'hat', HATS);
  swatch('Hat color', 'hatColor', CLOTH);
  stepper('Extra', 'acc', ACCESSORIES);
  swatch('Extra color', 'accColor', CLOTH);

  const foot = el('div', 'spread');
  foot.style.marginTop = '18px';
  const err = el('div', 'muted');
  const btns = el('div', 'row');
  const cancel = el('button', 'btn secondary', mode === 'makeover' ? 'Keep my look' : 'Cancel');
  const save = el('button', 'btn', mode === 'new' ? "Let's go!" : 'Save');
  btns.append(cancel, save);
  foot.append(err, btns);
  modal.append(foot);
  cancel.onclick = () => { close(); sfx(audio, 'close'); onCancel?.(); };
  if (mode === 'new' && !onCancel) cancel.classList.add('hidden');
  save.onclick = () => {
    const n = nameIn.value.trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-z0-9 _\-.]{2,16}$/.test(n)) { err.textContent = 'Name: 2-16 letters, numbers, spaces, _ - .'; err.style.color = 'var(--red)'; nameIn.focus(); return; }
    sfx(audio, 'open');
    close();
    onSave?.(n, { ...a });
  };
  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') save.click(); });

  let model = null, modelKey = '';
  const POSES = [['idle', 'idle'], ['w0', 's0'], ['idle', 'wave'], ['w2', 's2']];
  function refresh() {
    rows.forEach((f) => f());
    modelKey = '';
  }
  canvas.addEventListener('pointerdown', (e) => { dragging = true; auto = false; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { angle -= (e.clientX - lastX) * 0.02; lastX = e.clientX; } });
  canvas.addEventListener('pointerup', () => { dragging = false; setTimeout(() => (auto = true), 2500); });
  let raf = 0, last = performance.now();
  const draw = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (auto) angle += dt * 0.7;
    poseT += dt;
    if (poseT > 1.6) { poseT = 0; pose = (pose + 1) % POSES.length; modelKey = ''; }
    const key = JSON.stringify(a) + pose;
    if (key !== modelKey) { model = buildCharacter(a, POSES[pose][0], POSES[pose][1]); modelKey = key; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(144, 222, 56, 16, 0, 0, Math.PI * 2); ctx.fill();
    drawVox(ctx, model, angle, { scale: 8.5, cx: 144, cy: 150, zMid: 12, elev: 0.38 });
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  function close() { cancelAnimationFrame(raf); wrap.remove(); }
  refresh();
  root.append(wrap);
  if (mode === 'new') setTimeout(() => nameIn.focus(), 50);
  return { close };
}

// Small static portrait (head and shoulders).
export function drawPortrait(canvas, app) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const m = buildCharacter(sanitizeAppearance(app), 'idle', 'idle');
  drawVox(ctx, m, 0.35, { scale: canvas.width / 13, cx: canvas.width / 2, cy: canvas.height * 0.62, zMid: 17, elev: 0.3, zMin: 9 });
}
