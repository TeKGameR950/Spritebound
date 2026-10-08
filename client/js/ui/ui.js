import { WEAPONS } from '/shared/weapons.js';
import { VEHICLES, VEH_ID, PAINTS } from '/shared/vehicles.js';
import { SHOPS } from '/shared/shops.js';
import { POI } from '/shared/constants.js';
import { el, sfx, fmtMoney, fmtTime } from './dom.js';
import { Minimap, openBigMap, POI_STYLE } from './minimap.js';
import { openCreator, drawPortrait } from './creator.js';
import { drawVox } from './preview.js';
import { pickupVox } from '../game/art-cache.js';
import { buildVehicle } from '../gfx/art-vehicles.js';
import { STATIONS } from '../audio/radio.js';

const HINTS = [
  ['Walk with <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span>, aim with the mouse. Hold <span class="kbd">Shift</span> to run.', 7],
  ['Walk up to a car and press <span class="kbd">E</span> to drive. <span class="kbd">Space</span> is the handbrake: drift!', 8],
  ['Press <span class="kbd">M</span> for the map. Shops, jobs and races are marked on it.', 7],
  ['Hold <span class="kbd">V</span> to talk to players near you. <span class="kbd">T</span> opens chat.', 7],
  ['Glowing little Sprites are hidden all over Haven Bay. Can you find all of them?', 8],
];

export class UI {
  constructor(root, worldRoot, { audio, voice, settings, saveSettings }) {
    this.root = root;
    this.worldRoot = worldRoot;
    this.audio = audio;
    this.voice = voice;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.modal = null;
    this.chatOpen = false;
    this.tags = new Map();
    this.notes = el('div', 'notes passthru');
    root.append(this.notes);
  }

  get blocking() { return !!this.modal || this.chatOpen; }

  // ------------------------------------------------------------------ game start
  onGameStart(g, w) {
    this.g = g;
    this.buildHud();
    this.minimap = new Minimap(this.root, g.world);
    this.buildChat();
    this.voice.onStatus = (s) => this.voiceStatus(s);
    this.voiceStatus(this.voice.status);
    if (w.motd) this.chat.add({ sys: true, m: w.motd });
    this.chat.add({ sys: true, m: 'Press T to chat, M for the map, Esc for the menu.' });
    if (w.tutorial || this.settings.hints !== false) this.startHints();
    this.weaponChanged();
  }

  startHints() {
    let i = 0;
    const next = () => {
      if (i >= HINTS.length) return;
      const [html, dur] = HINTS[i++];
      this.help(html, dur);
      setTimeout(next, dur * 1000 + 600);
    };
    setTimeout(next, 1500);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const h = el('div');
    h.id = 'hud';
    h.innerHTML = `
      <div class="tr"><div class="money">$0</div><div class="stars"></div><div class="clock"></div></div>
      <div class="voice panel hidden"><div class="mic"></div><span class="vt">Voice</span></div>
      <div class="bl">
        <div class="vitals panel">
          <div class="meter hp"><div></div><span>HP</span></div>
          <div class="meter ar"><div></div><span>ARMOR</span></div>
          <div class="meter car hidden"><div></div><span>CAR</span></div>
        </div>
        <div class="weapon panel"><canvas width="54" height="30"></canvas><div><div class="wname"></div><div class="ammo"></div></div></div>
      </div>
      <div class="speedo panel hidden"><div class="kmh">0</div><div class="unit">KM/H</div><div class="gear muted"></div></div>
      <div class="job panel hidden"></div>
      <div class="center-banner"><div class="district"></div></div>
      <div class="card panel"><div class="t1"></div><div class="t2"></div></div>
      <div class="prompt panel hidden"></div>
      <div class="countdown hidden"></div>`;
    this.root.append(h);
    this.hud = {
      root: h,
      money: h.querySelector('.money'), stars: h.querySelector('.stars'), clock: h.querySelector('.clock'),
      hp: h.querySelector('.meter.hp > div'), ar: h.querySelector('.meter.ar > div'), carM: h.querySelector('.meter.car'), car: h.querySelector('.meter.car > div'),
      wcan: h.querySelector('.weapon canvas'), wname: h.querySelector('.wname'), ammo: h.querySelector('.ammo'),
      speedo: h.querySelector('.speedo'), kmh: h.querySelector('.kmh'), job: h.querySelector('.job'),
      district: h.querySelector('.district'), card: h.querySelector('.card'), prompt: h.querySelector('.prompt'), countdown: h.querySelector('.countdown'),
      voice: h.querySelector('.voice'), mic: h.querySelector('.voice .mic'), vt: h.querySelector('.voice .vt'),
      shownMoney: 0, targetMoney: 0,
      stats: (s, dm) => {
        this.hud.targetMoney = s.money;
        if (dm && dm < 0 && Math.abs(dm) < 1e6) this.cashPop(dm);
        this.hud.hp.style.width = Math.max(0, Math.min(100, s.hp)) + '%';
        this.hud.ar.style.width = Math.max(0, Math.min(100, s.armor)) + '%';
        this.hud.ar.parentElement.classList.toggle('hidden', s.armor <= 0);
        let stars = '';
        for (let i = 1; i <= 5; i++) stars += `<div class="star ${i <= s.wanted ? 'on' : ''}">★</div>`;
        this.hud.stars.innerHTML = stars;
        this.weaponChanged();
      },
    };
    for (let i = 1; i <= 5; i++) this.hud.stars.append(el('div', 'star', '★'));
  }

  weaponChanged() {
    if (!this.hud || !this.g) return;
    const L = this.g.local;
    const w = WEAPONS[L.weapon];
    if (this.lastWeaponIcon !== w.key) {
      this.lastWeaponIcon = w.key;
      const c = this.hud.wcan.getContext('2d');
      c.clearRect(0, 0, 54, 30);
      drawVox(c, pickupVox(w.key, false), Math.PI / 2, { scale: 3, cx: 27, cy: 17, zMid: 5, elev: 0.5 });
    }
    this.hud.wname.textContent = w.name;
  }

  frame(g, dt) {
    if (!this.hud) return;
    const L = g.local, H = this.hud;
    // money roll-up
    if (H.shownMoney !== H.targetMoney) {
      const d = H.targetMoney - H.shownMoney;
      H.shownMoney += Math.abs(d) < 2 ? d : d * Math.min(1, dt * 6);
      H.money.textContent = fmtMoney(H.shownMoney);
    }
    const hh = Math.floor(g.hourNow), mm = Math.floor((g.hourNow % 1) * 60);
    const wx = g.weather.storm > 0.5 ? 'Storm' : g.weather.rain > 0.3 ? 'Rain' : g.weather.cloud > 0.55 ? 'Cloudy' : hh >= 6 && hh < 20 ? 'Sunny' : 'Clear';
    H.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  ${wx}`;
    // weapon ammo
    const w = L.w;
    H.ammo.textContent = w.kind === 'melee' ? '' : w.kind === 'gun' ? (L.reloadT > 0 ? 'reloading...' : `${L.clipOf(w)} / ${Math.max(0, L.ammoTotal(w) - L.clipOf(w))}`) : `${L.ammoTotal(w)}`;
    // car
    document.body.classList.toggle('driving', !!L.car);
    H.speedo.classList.toggle('hidden', !L.car);
    H.carM.classList.toggle('hidden', !L.car);
    if (L.car) {
      const kmh = Math.round((Math.abs(L.car.speed || 0) / 8) * 3.6);
      H.kmh.textContent = kmh;
      H.car.style.width = Math.max(0, (L.car.hp / VEHICLES[L.car.model].health) * 100) + '%';
    }
    // prompt
    let prompt = null;
    if (!this.blocking && L.alive) {
      const poi = g.nearestPoi();
      const race = g.nearRaceStart();
      if (L.car) {
        if (poi && SHOPS[poi.type]?.needsCar) prompt = `<span class="kbd">E</span> ${SHOPS[poi.type].verb} at ${poi.name}`;
        else if (race) prompt = `<span class="kbd">E</span> Start race: ${race.name}`;
        else if (VEHICLES[L.car.model].key === 'taxi' && !g.job) prompt = `<span class="kbd">J</span> Start taxi fares`;
      } else if (poi && !SHOPS[poi.type].needsCar) prompt = `<span class="kbd">E</span> ${SHOPS[poi.type].verb}: ${poi.name}`;
      else if (L.mode === 'walk') {
        for (const v of g.nearVehicles(L.x, L.y, 50)) {
          const m = VEHICLES[v.model];
          if (!v.dead && Math.hypot(v.x - L.x, v.y - L.y) - m.len * 0.35 < 26) { prompt = `<span class="kbd">E</span> ${v.driver ? 'Borrow' : 'Drive'} the ${m.name}`; break; }
        }
      }
    }
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      H.prompt.classList.toggle('hidden', !prompt);
      if (prompt) H.prompt.innerHTML = prompt;
    }
    // job panel
    const j = g.job;
    if (j) {
      let txt = '';
      const now = g.net.serverNow();
      if (j.kind === 'pizza') txt = `<div class="jt">Pizza delivery ${j.idx + 1}/${j.total}</div><div class="timer">${j.deadline ? Math.max(0, j.deadline - now).toFixed(0) + 's' : ''}</div><div class="muted">Earned ${fmtMoney(j.earned)} · <span class="kbd">J</span> quit</div>`;
      else if (j.kind === 'taxi') txt = `<div class="jt">Taxi · ${j.stage === 'pickup' ? 'Pick up the fare' : 'Drop off'}</div><div class="timer">${j.stage === 'dropoff' && j.deadline ? Math.max(0, j.deadline - now).toFixed(0) + 's' : ''}</div><div class="muted">Fares ${j.idx} · ${fmtMoney(j.earned)} · <span class="kbd">J</span> quit</div>`;
      else if (j.kind === 'race') {
        const t = Math.max(0, now - j.startAt);
        txt = `<div class="jt">Race · checkpoint ${Math.min(j.idx, j.total)}/${j.total}</div><div class="timer">${now < j.startAt ? '--' : fmtTime(t)}</div><div class="muted"><span class="kbd">J</span> quit</div>`;
        const cd = j.startAt - now;
        H.countdown.classList.toggle('hidden', !(cd > -0.8 && cd < 3.2));
        const label = cd > 2 ? '3' : cd > 1 ? '2' : cd > 0 ? '1' : 'GO!';
        if (label !== this.lastCd && cd < 3.2 && cd > -0.8) { this.lastCd = label; sfx(this.audio, 'countdown'); if (label === 'GO!') this.audio.play('countdown', undefined, undefined, { bus: 'ui', go: true }); }
        H.countdown.textContent = label;
      }
      H.job.innerHTML = txt;
      H.job.classList.remove('hidden');
    } else { H.job.classList.add('hidden'); H.countdown.classList.add('hidden'); }
    this.minimap.draw(g);
    this.updateTags(g);
    this.chat.tick();
  }

  // ------------------------------------------------------------------ world markers, nametags, arrows
  markers(g) {
    const p = g.fx.p;
    const t = g.time;
    const ring = (x, y, s, c, z = 0.5) => p.spawn({ x, y, z, life: 1 / 50, s0: s, s1: s, r: c[0], g: c[1], b: c[2], a0: 0.9, a1: 0.9, add: true, emis: 1.6, tex: p.S.ring, floor: false });
    const o = g.objective();
    if (o) {
      const s = 34 + Math.sin(t * 4) * 4;
      ring(o[0], o[1], s, [1, 0.82, 0.3]);
      if (Math.random() < 0.3) p.spawn({ x: o[0] + (Math.random() - 0.5) * 30, y: o[1] + (Math.random() - 0.5) * 30, z: 1, vz: 26, life: 1, s0: 2.5, s1: 1, r: 1, g: 0.85, b: 0.4, a0: 1, a1: 0, add: true, emis: 2, tex: p.S.soft, floor: false });
    }
    if (g.job && g.job.kind === 'race' && g.job.cps) {
      const nxt = g.job.cps[g.job.idx + 1];
      if (nxt) ring(nxt[0], nxt[1], 26, [0.6, 0.6, 0.7]);
    }
    if (!g.job && g.local.car && g.races) for (const r of g.races) {
      const [x, y] = r.cps[0];
      if (Math.abs(x - g.local.x) < 700 && Math.abs(y - g.local.y) < 500) ring(x, y, 46 + Math.sin(t * 3) * 3, [1, 1, 1]);
    }
    for (const poi of g.world.pois) {
      if (!SHOPS[poi.type]) continue;
      if (Math.abs(poi.x - g.local.x) > 600 || Math.abs(poi.y - g.local.y) > 400) continue;
      const st = POI_STYLE[poi.type];
      const c = st ? hexRgb(st[0]) : [1, 1, 1];
      ring(poi.x, poi.y, 18 + Math.sin(t * 3 + poi.x) * 2, c);
    }
    if (this.minimap?.waypoint) {
      const [x, y] = this.minimap.waypoint;
      ring(x, y, 30, [1, 0.5, 0.75]);
      if (Math.hypot(x - g.local.x, y - g.local.y) < 40) this.minimap.waypoint = null;
    }
  }

  updateTags(g) {
    const seen = new Set();
    const cam = g.cam;
    const sx = innerWidth / cam.w, sy = innerHeight / cam.h;
    const pt = [0, 0];
    if (this.settings.nametags !== false) for (const e of g.state.players.map.values()) {
      const info = g.state.players.info.get(e.id);
      if (!info) continue;
      const s = e.cur;
      const z = s.mode === 1 ? 20 : 30;
      if (!cam.worldToScreen(s.x, s.y, z, pt)) continue;
      const x = pt[0] * sx, y = pt[1] * sy;
      if (x < -50 || y < -50 || x > innerWidth + 50 || y > innerHeight + 50) continue;
      seen.add(e.id);
      let t = this.tags.get(e.id);
      if (!t) {
        t = el('div', 'tag');
        t.innerHTML = '<span class="spk"></span><span class="nm"></span><span class="pv"></span>';
        this.worldRoot.append(t);
        this.tags.set(e.id, t);
      }
      t.querySelector('.nm').textContent = info.name;
      t.querySelector('.pv').textContent = info.passive ? '' : '⚔';
      t.classList.toggle('talking', g.speaking.has(e.id) || !!(s.flags & 16));
      t.style.left = x + 'px'; t.style.top = y + 'px';
    }
    for (const [id, t] of this.tags) if (!seen.has(id)) { t.remove(); this.tags.delete(id); }
    // edge arrow toward the objective
    const o = g.objective() || this.minimap?.waypoint;
    if (!this.arrow) { this.arrow = el('div', 'edge-arrow'); this.worldRoot.append(this.arrow); }
    if (o && cam.worldToScreen(o[0], o[1], 0, pt)) {
      const x = pt[0] * sx, y = pt[1] * sy, m = 40;
      if (x < m || y < m || x > innerWidth - m || y > innerHeight - m) {
        const cx = innerWidth / 2, cy = innerHeight / 2;
        const a = Math.atan2(y - cy, x - cx);
        const k = Math.min((innerWidth / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (innerHeight / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
        this.arrow.style.display = 'block';
        this.arrow.style.left = cx + Math.cos(a) * k - 12 + 'px';
        this.arrow.style.top = cy + Math.sin(a) * k - 11 + 'px';
        this.arrow.style.transform = `rotate(${a + Math.PI / 2}rad)`;
      } else this.arrow.style.display = 'none';
    } else this.arrow.style.display = 'none';
  }

  // ------------------------------------------------------------------ feedback
  notify(text, kind = 'info', short = false, dur, html) {
    const n = el('div', `note panel ${kind}`);
    if (html) n.innerHTML = text; else n.textContent = text;
    this.notes.append(n);
    while (this.notes.children.length > 4) this.notes.firstChild.remove();
    const life = (dur ?? (short ? 2.2 : 4.5)) * 1000;
    setTimeout(() => n.classList.add('out'), life);
    setTimeout(() => n.remove(), life + 450);
    if (kind === 'warn') sfx(this.audio, 'note');
  }
  help(html, dur) {
    this.helpEl?.remove();
    const n = el('div', 'helpbox panel passthru');
    n.innerHTML = html;
    this.root.append(n);
    this.helpEl = n;
    setTimeout(() => n.classList.add('out'), dur * 1000);
    setTimeout(() => n.remove(), dur * 1000 + 450);
  }
  cashPop(d, why) {
    const c = el('div', 'cashpop' + (d < 0 ? ' neg' : ''), (d >= 0 ? '+' : '-') + fmtMoney(Math.abs(d)) + (why ? '  ' + why : ''));
    this.root.append(c);
    setTimeout(() => c.remove(), 1700);
  }
  district(name) {
    const d = this.hud?.district;
    if (!d) return;
    d.textContent = name;
    d.classList.add('show');
    clearTimeout(this.distT);
    this.distT = setTimeout(() => d.classList.remove('show'), 2800);
  }
  card(t1, t2, ms = 2600) {
    const c = this.hud?.card;
    if (!c) return;
    c.querySelector('.t1').textContent = t1;
    c.querySelector('.t2').textContent = t2 || '';
    c.classList.add('show');
    clearTimeout(this.cardT);
    this.cardT = setTimeout(() => c.classList.remove('show'), ms);
  }
  vehicleCard(m) { this.card(m.name, `Top speed ${Math.round((m.maxSpeed / 8) * 3.6)} km/h${m.siren ? ' · Q siren' : ''} · N radio`); }
  radioCard(info) { if (!info) this.card('Radio off', 'N to turn it back on', 1500); else this.card(info.station.name, `${info.station.genre} · "${info.song}"`, 3200); }
  collected(m) { this.notify(`Sprite found! ${m.n}/${m.total}  +${fmtMoney(m.reward)}`, 'good'); }
  job(j) {
    if (j && j.kind !== 'race' && j.idx === 0 && !this.jobAnnounced) { this.jobAnnounced = true; }
    if (!j) { this.jobAnnounced = false; this.lastCd = null; }
  }
  voiceStatus(s) {
    if (!this.hud) return;
    const v = this.hud.voice;
    v.classList.toggle('hidden', s === 'off');
    this.hud.vt.innerHTML = s === 'ptt' ? 'Voice · hold <span class="kbd">V</span>' : s === 'open' ? 'Voice · open mic' : s === 'listen' ? 'Voice · listening only' : 'Voice';
    clearInterval(this.micT);
    this.micT = setInterval(() => this.hud.mic.classList.toggle('live', this.voice.speaking), 100);
  }

  showKO(m) {
    this.hideKO();
    const o = el('div', 'overlay-msg');
    o.innerHTML = `<div class="big">KNOCKED OUT</div><div class="sub">${m.by ? 'Thanks a lot, ' + escapeHtml(m.by) + '. ' : ''}Waking up at the clinic${m.loss ? ' (-' + fmtMoney(m.loss) + ' medical bill)' : ''}...</div>`;
    this.root.append(o);
    this.koEl = o;
  }
  hideKO() { if (this.koEl) { this.koEl.remove(); this.koEl = null; } }
  showBusted(m) {
    const o = el('div', 'overlay-msg');
    o.innerHTML = `<div class="big blue">BUSTED</div><div class="sub">You paid a ${fmtMoney(m.loss)} fine. Behave, citizen!</div>`;
    this.root.append(o);
    setTimeout(() => o.remove(), 3200);
  }
  raceResult(m) {
    const rows = (m.board || []).map((e, i) => `<li>${escapeHtml(e.name)} · ${fmtTime(e.time)}</li>`).join('');
    this.openModal((box) => {
      box.innerHTML = `<h2>${escapeHtml(m.name)} finished!</h2><p style="font-size:22px">Your time: <b>${fmtTime(m.time)}</b></p><p class="muted">Personal best: ${fmtTime(m.best)}</p><h3>Leaderboard</h3><ol>${rows}</ol>`;
      const b = el('button', 'btn', 'Nice!');
      b.onclick = () => this.closeModal();
      box.append(b);
    });
  }
  showBoards(m) {
    this.openModal((box) => {
      box.append(el('h2', null, 'Hall of Fame'));
      const grid = el('div', 'boards');
      for (const r of m.races) {
        const b = m.boards['race:' + r.id] || [];
        const c = el('div', 'item');
        c.innerHTML = `<div class="nm">${escapeHtml(r.name)}</div><ol>${b.map((e) => `<li>${escapeHtml(e.name)} · ${fmtTime(e.time)}</li>`).join('') || '<li class="muted">No times yet</li>'}</ol>`;
        grid.append(c);
      }
      const top = (title, list, f) => {
        const c = el('div', 'item');
        c.innerHTML = `<div class="nm">${title}</div><ol>${list.map((e) => `<li>${escapeHtml(e.name)} · ${f(e.v)}</li>`).join('')}</ol>`;
        grid.append(c);
      };
      top('Richest citizens', m.top.money, fmtMoney);
      top('Sprite hunters', m.top.sprites, (v) => v + ' found');
      top('Hardest workers', m.top.deliveries, (v) => v + ' jobs');
      box.append(grid);
      const b = el('button', 'btn', 'Close');
      b.style.marginTop = '14px';
      b.onclick = () => this.closeModal();
      box.append(b);
    });
  }

  // ------------------------------------------------------------------ modals
  openModal(build, onClose) {
    this.closeModal();
    const wrap = el('div', 'modal-wrap');
    const box = el('div', 'panel modal');
    wrap.append(box);
    this.root.append(wrap);
    this.modal = { wrap, onClose };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) this.closeModal(); });
    build(box);
    sfx(this.audio, 'open');
  }
  closeModal() {
    if (!this.modal) return;
    const m = this.modal;
    this.modal = null;
    m.wrap.remove();
    m.close?.();
    m.onClose?.();
    sfx(this.audio, 'close');
  }

  openShop(poi) {
    const g = this.g;
    const shop = SHOPS[poi.type];
    if (!shop) return;
    let color = 0;
    const L = g.local;
    this.openModal((box) => {
      const render = () => {
        box.innerHTML = '';
        const head = el('div', 'spread');
        head.append(el('h2', null, poi.name), el('div', 'wallet', fmtMoney(L.stats.money)));
        box.append(head);
        if (poi.type === 'respray' || poi.type === 'dealer') {
          box.append(el('h3', null, 'Paint color'));
          const sw = el('div', 'swatches');
          PAINTS.forEach((c, i) => {
            const s = el('div', 'sw' + (i === color ? ' on' : ''));
            s.style.background = c;
            s.onclick = () => { color = i; sfx(this.audio, 'click'); render(); };
            sw.append(s);
          });
          box.append(sw);
        }
        const items = el('div', 'items');
        items.style.marginTop = '14px';
        for (const it of shop.items) {
          const c = el('div', 'item');
          const owned = it.id.startsWith('w:') && WEAPONS.find((w) => 'w:' + w.key === it.id)?.kind === 'melee' && L.stats.weapons[it.id.slice(2)];
          const ownedCar = it.id.startsWith('car:') && L.stats.cars?.some((x) => x.model === it.id.slice(4));
          if (it.id.startsWith('car:')) {
            const cv = el('canvas');
            cv.width = 180; cv.height = 90;
            cv.style.width = '100%'; cv.style.imageRendering = 'pixelated';
            drawVox(cv.getContext('2d'), buildVehicle(VEH_ID[it.id.slice(4)], PAINTS[color]), -0.9, { scale: 2.4, cx: 90, cy: 50, elev: 0.55 });
            c.append(cv);
          }
          c.append(el('div', 'nm', it.name), el('div', 'ds', it.desc || (it.heal ? `+${it.heal} health` : '')));
          const row = el('div', 'spread');
          row.append(el('div', 'pr', it.price ? fmtMoney(it.price) : 'Free'));
          const needCar = (shop.needsCar || it.needsCar) && !L.car;
          const b = el('button', 'btn small', owned || ownedCar ? 'Owned' : it.id.startsWith('job:') ? 'Start' : it.id === 'board' ? 'Open' : 'Buy');
          b.disabled = owned || ownedCar || needCar || L.stats.money < it.price;
          if (needCar) b.title = 'Drive in with a vehicle';
          b.onclick = () => {
            if (it.id === 'makeover' || it.id.startsWith('job:') || it.id === 'board') this.closeModal();
            g.net.send({ t: 'buy', shop: poi.type, item: it.id, color });
            sfx(this.audio, 'click');
          };
          row.append(b);
          c.append(row);
          items.append(c);
        }
        box.append(items);
        const foot = el('div', 'spread');
        foot.style.marginTop = '16px';
        foot.append(el('div', 'muted', poi.type === 'respray' ? 'A fresh coat also makes the police forget you.' : ''));
        const close = el('button', 'btn secondary', 'Leave');
        close.onclick = () => this.closeModal();
        foot.append(close);
        box.append(foot);
      };
      this.shopRefresh = () => { if (this.modal) render(); };
      render();
    }, () => { this.shopRefresh = null; });
  }

  openMakeover() {
    const g = this.g;
    this.closeModal();
    this.modal = { wrap: { remove() {} } };
    const c = openCreator(this.root, {
      name: g.name, app: g.app, mode: 'makeover', audio: this.audio,
      onSave: (name, app) => { this.modal = null; g.app = app; g.net.send({ t: 'app', app }); this.notify('Looking sharp!', 'good'); },
      onCancel: () => { this.modal = null; },
    });
    this.modal.close = () => c.close();
  }

  openGarage() {
    const g = this.g;
    const cars = g.local.stats.cars || [];
    this.openModal((box) => {
      box.append(el('h2', null, 'My garage'));
      if (!cars.length) {
        box.append(el('p', 'muted', 'You do not own a car yet. Visit Lucky Wheels Motors (D on the map) to buy one, then press G anywhere to have it delivered.'));
      } else {
        const items = el('div', 'items shop');
        items.className = 'items';
        cars.forEach((car, i) => {
          const c = el('div', 'item');
          const cv = el('canvas');
          cv.width = 180; cv.height = 90; cv.style.width = '100%'; cv.style.imageRendering = 'pixelated';
          drawVox(cv.getContext('2d'), buildVehicle(VEH_ID[car.model], PAINTS[car.color]), -0.9, { scale: 2.4, cx: 90, cy: 50, elev: 0.55 });
          const b = el('button', 'btn small', 'Deliver here');
          b.onclick = () => { g.net.send({ t: 'callcar', i }); this.closeModal(); };
          c.append(cv, el('div', 'nm', VEHICLES[VEH_ID[car.model]].name), b);
          items.append(c);
        });
        box.append(items);
      }
      const b = el('button', 'btn secondary', 'Close');
      b.style.marginTop = '14px';
      b.onclick = () => this.closeModal();
      box.append(b);
    });
  }

  openPlayers() {
    const g = this.g;
    this.openModal((box) => {
      box.append(el('h2', null, 'Players nearby'));
      const list = el('div', 'players-list');
      const mine = el('div', 'p');
      mine.innerHTML = `<b>${escapeHtml(g.name)}</b> <span class="muted">(you)</span>`;
      list.append(mine);
      for (const [id, info] of g.state.players.info) {
        if (!g.state.players.map.has(id)) continue;
        const r = el('div', 'p');
        r.append(el('b', 'grow', info.name));
        const mute = el('button', 'btn small secondary', this.voice.mutes.get(id) ? 'Unmute' : 'Mute');
        mute.onclick = () => { this.voice.mutes.set(id, !this.voice.mutes.get(id)); mute.textContent = this.voice.mutes.get(id) ? 'Unmute' : 'Mute'; };
        const vol = el('input');
        vol.type = 'range'; vol.min = 0; vol.max = 2; vol.step = 0.1; vol.value = this.voice.volumes.get(id) ?? 1;
        vol.style.width = '110px';
        vol.oninput = () => this.voice.volumes.set(id, Number(vol.value));
        r.append(vol, mute);
        list.append(r);
      }
      box.append(list);
      box.append(el('p', 'muted', 'Only players close to you are listed. Voice volume and mute apply to proximity chat.'));
    });
  }

  openMenu() {
    const g = this.g;
    this.openModal((box) => {
      box.append(el('h2', null, 'Paused (the city keeps going!)'));
      const col = el('div');
      col.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:360px';
      const add = (label, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; col.append(b); return b; };
      add('Resume', '', () => this.closeModal());
      add('Settings', 'secondary', () => this.openSettings());
      add('How to play', 'secondary', () => this.openHelp());
      add('Players', 'secondary', () => this.openPlayers());
      add(g.local.stats.passive ? 'Passive mode: ON (no PvP)' : 'Passive mode: OFF (PvP)', 'secondary', () => { g.net.send({ t: 'passive', on: !g.local.stats.passive }); this.closeModal(); });
      add('Leave Haven Bay', 'pink', () => location.reload());
      box.append(col);
    });
  }

  openHelp() {
    this.openModal((box) => {
      box.innerHTML = `<h2>How to play</h2>
      <div class="keys">
        <span><span class="kbd">WASD</span></span><span>Walk, or drive when in a car</span>
        <span><span class="kbd">Shift</span></span><span>Run</span>
        <span><span class="kbd">Mouse</span></span><span>Aim · left click to attack</span>
        <span><span class="kbd">E</span></span><span>Enter or leave cars, use shops</span>
        <span><span class="kbd">Space</span></span><span>Handbrake (drift!)</span>
        <span><span class="kbd">1-9</span> <span class="kbd">Wheel</span></span><span>Switch weapons · <span class="kbd">R</span> reload</span>
        <span><span class="kbd">H</span></span><span>Horn · <span class="kbd">Q</span> siren · <span class="kbd">L</span> lights</span>
        <span><span class="kbd">N</span></span><span>Radio station</span>
        <span><span class="kbd">V</span></span><span>Push to talk (proximity voice)</span>
        <span><span class="kbd">T</span></span><span>Chat · <span class="kbd">Tab</span> players · <span class="kbd">B</span> wave</span>
        <span><span class="kbd">M</span></span><span>Map · <span class="kbd">G</span> call your car · <span class="kbd">C</span> zoom</span>
        <span><span class="kbd">J</span></span><span>Start or quit a taxi shift</span>
      </div>
      <h3>Things to do</h3>
      <p>Deliver pizzas, drive a cab, race against the clock, hunt the 60 hidden Sprites, buy a car, find a cozy rooftop at sunset.
      Causing trouble raises your wanted level: lose the police by staying out of sight, or get a fresh paint job at a respray garage.</p>
      <p class="muted">Getting knocked out costs a small clinic bill. Passive mode (menu) keeps other players from hurting you.</p>`;
      const b = el('button', 'btn', 'Got it');
      b.onclick = () => this.closeModal();
      box.append(b);
    });
  }

  openSettings() {
    const s = this.settings;
    this.openModal((box) => {
      box.className = 'panel modal settings';
      box.append(el('h2', null, 'Settings'));
      const grid = el('div', 'grid');
      const slider = (label, key, min, max, step, apply) => {
        const l = el('label');
        l.append(document.createTextNode(label));
        const r = el('input');
        r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = s[key];
        r.oninput = () => { s[key] = Number(r.value); apply?.(); this.saveSettings(); };
        l.append(r);
        grid.append(l);
      };
      const toggle = (label, key, apply) => {
        const l = el('label', 'toggle');
        const c = el('input');
        c.type = 'checkbox'; c.checked = s[key] !== false;
        c.onchange = () => { s[key] = c.checked; apply?.(); this.saveSettings(); };
        l.append(c, document.createTextNode(label));
        grid.append(l);
      };
      const A = this.audio;
      const vol = () => { Object.assign(A.vol, { master: s.master, sfx: s.sfx, music: s.music, ambience: s.ambience, voice: s.voice }); A.applyVolumes(); };
      slider('Master volume', 'master', 0, 1, 0.05, vol);
      slider('Sound effects', 'sfx', 0, 1, 0.05, vol);
      slider('Radio', 'music', 0, 1, 0.05, vol);
      slider('Ambience', 'ambience', 0, 1, 0.05, vol);
      slider('Voice chat volume', 'voice', 0, 2, 0.05, vol);
      slider('Camera shake', 'shake', 0, 1, 0.05);
      slider('Render scale', 'scale', 0.5, 1, 0.25, () => { this.g.renderer.quality.scale = s.scale; this.g.renderer.w = 0; });
      toggle('Shadows', 'shadows', () => (this.g.renderer.quality.shadows = s.shadows !== false));
      toggle('Bloom', 'bloom', () => (this.g.renderer.quality.bloom = s.bloom !== false));
      toggle('Nametags', 'nametags');
      toggle('Pocket radio when walking', 'pocketRadio', () => this.g.radio.setContext(!!this.g.local.car, s.pocketRadio));
      toggle('Auto radio in cars', 'autoRadio');
      toggle('Proximity voice chat', 'voiceOn', async () => { if (s.voiceOn) await this.voice.enable(); else this.voice.disable(); });
      const lm = el('label');
      lm.append(document.createTextNode('Voice mode'));
      const sel = el('select');
      sel.innerHTML = '<option value="ptt">Push to talk (V)</option><option value="open">Open mic</option>';
      sel.value = s.voiceMode || 'ptt';
      sel.style.cssText = 'background:#14151f;color:var(--cream);border:2px solid var(--ink);border-radius:6px;padding:6px';
      sel.onchange = () => { s.voiceMode = sel.value; this.voice.setMode(sel.value); this.saveSettings(); };
      lm.append(sel);
      grid.append(lm);
      box.append(grid);
      box.append(el('p', 'muted', 'Headphones are recommended for voice chat. Your microphone is only used while voice is on.'));
      const b = el('button', 'btn', 'Done');
      b.onclick = () => this.closeModal();
      box.append(b);
    });
  }

  // ------------------------------------------------------------------ chat
  buildChat() {
    const box = el('div');
    box.id = 'chat';
    const log = el('div', 'log');
    const input = el('input');
    input.type = 'text'; input.maxLength = 160; input.placeholder = 'Say something nice... (Enter to send)';
    input.classList.add('hidden');
    box.append(log, input);
    this.root.append(box);
    const lines = [];
    this.chat = {
      add: (m) => {
        const l = el('div', 'line' + (m.sys ? ' sys' : ''));
        if (m.sys) l.textContent = m.m;
        else { const n = el('span', 'n', m.n + ': '); l.append(n, document.createTextNode(m.m)); }
        log.append(l);
        lines.push({ l, t: performance.now() });
        while (log.children.length > 9) log.firstChild.remove();
      },
      tick: () => {
        const now = performance.now();
        for (const x of lines) if (now - x.t > 12000) x.l.classList.add('fade');
      },
      open: () => {
        this.chatOpen = true;
        box.classList.add('open');
        input.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
        this.g.input.typing = true;
      },
      close: () => {
        this.chatOpen = false;
        box.classList.remove('open');
        input.classList.add('hidden');
        input.value = '';
        input.blur();
        this.g.input.typing = false;
        this.g.input.down.clear();
      },
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = input.value.trim(); if (v) this.g.net.send({ t: 'chat', m: v }); this.chat.close(); }
      if (e.key === 'Escape') this.chat.close();
    });
  }

  handleKeys(input) {
    if (this.chatOpen) return;
    if (input.pressed.has('Escape')) {
      if (this.bigmap) { this.bigmap.close(); return; }
      if (this.modal) { this.closeModal(); return; }
      this.openMenu();
      return;
    }
    if (this.modal) return;
    if (input.pressed.has('KeyT') || input.pressed.has('Enter')) { this.chat.open(); input.pressed.clear(); return; }
    if (input.pressed.has('KeyM')) {
      if (this.bigmap) { this.bigmap.close(); }
      else this.bigmap = openBigMap(this.root, this.g, this.minimap, () => (this.bigmap = null));
    }
    if (input.pressed.has('Tab')) this.openPlayers();
  }
}

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export { openCreator, drawPortrait, STATIONS, POI };
