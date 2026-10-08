import { CollisionWorld } from '/shared/collision.js';
import { TILE, INTERP_DELAY, clamp, SHOP_POIS, DISTRICTS } from '/shared/constants.js';
import { VEHICLES } from '/shared/vehicles.js';
import { WEAPONS } from '/shared/weapons.js';
import { PROP_DEF } from '/shared/props.js';
import { MODE, PED_STATE as PS, NPC_DRIVER } from '/shared/protocol.js';
import { signalPhase, signalFor } from '/shared/traffic.js';
import { SHOPS } from '/shared/shops.js';
import { valueNoise } from '/shared/noise.js';
import { Camera } from '../gfx/camera.js';
import { timeOfDay } from '../gfx/lighting.js';
import { InstanceWriter } from '../gfx/sprites.js';
import { ClientState } from './state.js';
import { Local } from './local.js';
import { ArtCache } from './art-cache.js';
import { Particles } from './particles.js';
import { Fx } from './fx.js';
import { SceneBuilder } from './scene.js';
import { VehicleAudio } from '../audio/engine.js';
import { Ambience } from '../audio/ambience.js';
import { Radio, STATIONS } from '../audio/radio.js';

const smoothDamp = (x, v, target, omega, dt) => {
  const k = omega * dt, e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const ch = x - target, tmp = (v + omega * ch) * dt;
  return [target + (ch + tmp) * e, (v - omega * tmp) * e];
};
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Game {
  constructor({ renderer, world, net, audio, voice, ui, input, settings }) {
    this.renderer = renderer;
    this.world = world;
    this.net = net;
    this.audio = audio;
    this.voice = voice;
    this.ui = ui;
    this.input = input;
    this.settings = settings;
    this.cw = new CollisionWorld(world);
    this.state = new ClientState();
    this.cam = new Camera();
    this.camV = { x: 0, y: 0 };
    this.trauma = 0;
    this.kickV = [0, 0];
    this.hitStopT = 0;
    this.art = new ArtCache(renderer.bank);
    this.fx = new Fx(this, new Particles(renderer.bank));
    this.scene = new SceneBuilder(this);
    this.dyn = new InstanceWriter(4096);
    this.local = new Local(this);
    this.vaudio = new VehicleAudio(audio);
    this.ambience = new Ambience(audio);
    this.radio = new Radio(audio);
    this.pickups = world.pickups.map((p) => ({ ...p, active: true }));
    this.cash = new Map();
    this.collected = new Set();
    this.brokenProps = new Set();
    this.markers = {};
    this.job = null;
    this.hour = 9;
    this.weather = { cloud: 0.2, rain: 0, storm: 0 };
    this.wet = 0;
    this.flashT = 0;
    this.running = false;
    this.time = 0;
    this.lastSkid = new Map();
    this.pickT = new Map();
    this.speaking = new Set();
    this.districtName = '';
    this.radioStation = -1;
    this.fade = 0;
    this.tod = timeOfDay(9);
    this.bindNet();
  }

  get night() { return this.tod.streetLights > 0.4; }

  // ------------------------------------------------------------------ network
  bindNet() {
    const n = this.net;
    const L = this.local;
    n.on('snap', (s) => { this.net.observeServerTime(s.time); this.state.onSnapshot(s); });
    n.on('info', (m) => this.state.onInfo(m));
    n.on('ev', (m) => { for (const e of m.e) this.fx.event(e); });
    n.on('me', (m) => {
      const dm = L.onMe(m);
      this.ui.hud?.stats(L.stats, dm);
      if (m.wanted !== undefined && m.wanted > (this.lastWanted || 0)) this.audio.play('wanted', undefined, undefined, { bus: 'ui' });
      this.lastWanted = m.wanted;
    });
    n.on('tp', (m) => {
      L.tp = m.tp;
      if (L.car && !m.v) L.leaveCar(m.x, m.y);
      if (L.car) { L.car.x = m.x; L.car.y = m.y; L.car.vx = L.car.vy = 0; }
      L.x = m.x; L.y = m.y; L.vx = L.vy = 0;
      this.snapCamera();
    });
    n.on('drive', (m) => L.onDrive(m));
    n.on('walk', (m) => {
      L.tp = m.tp;
      if (L.car) L.leaveCar(m.x, m.y);
      L.x = m.x; L.y = m.y;
      if (m.forced) this.shake(0.3);
    });
    n.on('deny', (m) => { L.pendingEnter = 0; if (m.m) this.ui.notify(m.m, 'warn'); });
    n.on('shove', (m) => { if (L.car && L.car.id === m.vid) { L.car.vx += m.vx; L.car.vy += m.vy; L.car.av += m.av || 0; L.car.stun = 0.5; this.shake(0.3); } });
    n.on('knock', (m) => { L.knockV = [m.vx, m.vy]; this.shake(0.25); });
    n.on('hurt', (m) => {
      this.hurtT = 0.5;
      this.audio.play('hurt', L.x, L.y);
      this.shake(Math.min(0.4, m.d / 60));
    });
    n.on('ko', (m) => {
      L.mode = 'ko'; L.koT = 0;
      if (L.car) L.leaveCar(L.x, L.y);
      this.audio.play('ko', undefined, undefined, { bus: 'ui' });
      this.ui.showKO(m);
    });
    n.on('respawn', (m) => {
      L.mode = 'walk'; L.tp = m.tp; L.x = m.x; L.y = m.y; L.vx = L.vy = 0;
      this.snapCamera();
      this.ui.hideKO();
      this.fade = 0;
    });
    n.on('busted', (m) => { this.audio.play('busted', undefined, undefined, { bus: 'ui' }); this.ui.showBusted(m); });
    n.on('note', (m) => this.ui.notify(m.m, m.k));
    n.on('chat', (m) => { this.ui.chat?.add(m); if (!m.sys) this.audio.play('chat', undefined, undefined, { bus: 'ui' }); });
    n.on('cash', (m) => { this.audio.play('cash', undefined, undefined, { bus: 'ui' }); this.ui.cashPop(m.d, m.why); this.fx.p.coins(L.x, L.y); });
    n.on('got', (m) => { this.audio.play('pickup', undefined, undefined, { bus: 'ui' }); this.ui.notify(m.m, 'good', true); });
    n.on('collected', (m) => {
      this.collected.add(m.id);
      this.audio.play('collect', undefined, undefined, { bus: 'ui' });
      const c = this.world.collectibles[m.id];
      if (c) this.fx.p.sparkle(c.x, c.y, 8);
      this.ui.collected(m);
    });
    n.on('job', (m) => { this.job = m.job; this.ui.job(m.job); });
    n.on('race', (m) => this.ui.raceResult(m));
    n.on('boards', (m) => this.ui.showBoards(m));
    n.on('makeover', () => this.ui.openMakeover());
    n.on('repaired', () => { if (L.car) L.car.hp = VEHICLES[L.car.model].health; });
    n.on('bought', () => { this.audio.play('buy', undefined, undefined, { bus: 'ui' }); this.ui.shopRefresh?.(); });
    n.on('sfx', (m) => this.audio.play(m.k, undefined, undefined, { bus: 'ui' }));
    n.on('mark', (m) => { this.markers.call = { x: m.x, y: m.y, until: this.time + (m.ttl || 15) }; });
    n.on('world', (m) => { this.hour = m.hour; this.hourAt = this.time; this.weather = m.weather; });
    n.on('thunder', (m) => {
      this.flashT = 0.35;
      setTimeout(() => this.audio.play('thunder', this.local.x + (m.x - 0.5) * 400, this.local.y + (m.y - 0.5) * 300, { d: m.d, bus: 'amb', force: true }), (m.d / 3) * 1000);
    });
  }

  start(w) {
    const L = this.local;
    L.id = w.id; L.tp = w.tp;
    L.x = w.x; L.y = w.y;
    this.app = w.app;
    this.name = w.name;
    this.hour = w.hour; this.hourAt = 0;
    this.dayLength = w.dayLength;
    this.weather = w.weather;
    for (const id of w.pickups) if (this.pickups[id]) this.pickups[id].active = false;
    for (const i of w.broken) this.setPropState(i, false);
    for (const id of w.collected) this.collected.add(id);
    this.races = w.races;
    this.snapCamera();
    this.running = true;
    this.last = performance.now();
    this.ui.onGameStart(this, w);
    requestAnimationFrame((t) => this.frame(t));
  }

  snapCamera() {
    this.cam.x = this.local.x; this.cam.y = this.local.y;
    this.camV.x = this.camV.y = 0;
  }

  // ------------------------------------------------------------------ helpers
  vehicleView(e) {
    const s = e.cur, info = this.state.vehicles.info.get(e.id);
    if (!info) return null;
    return { id: e.id, x: s.x, y: s.y, a: s.a, vx: s.vx, vy: s.vy, model: info.m, driver: s.driver, dead: !!info.d };
  }
  nearVehicles(x, y, r) {
    const out = [];
    for (const e of this.state.vehicles.map.values()) {
      const s = e.cur;
      if (Math.abs(s.x - x) > r || Math.abs(s.y - y) > r) continue;
      const v = this.vehicleView(e);
      if (v) out.push(v);
    }
    return out;
  }
  nearPeople(x, y, r) {
    const out = [];
    for (const e of this.state.players.map.values()) {
      const s = e.cur;
      if (s.mode === MODE.DRIVE || s.mode === MODE.RIDE) continue;
      if (Math.abs(s.x - x) < r && Math.abs(s.y - y) < r) out.push(s);
    }
    for (const e of this.state.peds.map.values()) {
      const s = e.cur;
      if (s.state === PS.KO || s.state === PS.OUT) continue;
      if (Math.abs(s.x - x) < r && Math.abs(s.y - y) < r) out.push(s);
    }
    return out;
  }
  forPeople(x, y, r, fn) {
    for (const e of this.state.players.map.values()) {
      const s = e.cur;
      if (s.mode !== MODE.WALK && s.mode !== MODE.SWIM) continue;
      if (Math.abs(s.x - x) < r && Math.abs(s.y - y) < r) fn('p', s);
    }
    for (const e of this.state.peds.map.values()) {
      const s = e.cur;
      if (s.state === PS.OUT || s.state === PS.KO) continue;
      if (Math.abs(s.x - x) < r && Math.abs(s.y - y) < r) fn('n', s);
    }
  }
  forTargets(x, y, r, fnPerson, fnVehicle) {
    this.forPeople(x, y, r, (k, s) => fnPerson(k, s, 6));
    for (const e of this.state.vehicles.map.values()) {
      const s = e.cur;
      if (Math.abs(s.x - x) > r + 40 || Math.abs(s.y - y) > r + 40) continue;
      const v = this.vehicleView(e);
      if (v && !v.dead) fnVehicle(v);
    }
  }

  signalColor(sgl) { return signalFor(sgl.axis, signalPhase(sgl.node, this.net.serverNow())); }

  shake(t) { this.trauma = Math.min(1, this.trauma + t * (this.settings.shake ?? 0.7) / 0.7); }
  kick(x, y) { this.kickV[0] += x; this.kickV[1] += y; }
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }

  breakPropLocal(i, vx, vy, mine) {
    if (this.brokenProps.has(i)) return;
    this.setPropState(i, false, vx, vy);
    if (mine) this.net.send({ t: 'prop', i, vx, vy });
  }
  setPropState(i, on, vx = 0, vy = 0) {
    const p = this.world.props[i];
    if (!p) return;
    if (!on) {
      if (this.brokenProps.has(i)) return;
      this.brokenProps.add(i);
      this.renderer.wg.setPropVisible(i, false);
      for (const s of this.cw.shapesNear(p[1], p[2], 4, [])) if (s.prop === i) s.alive = false;
      const key = PROP_DEF[p[0]].key;
      const x = p[1], y = p[2];
      for (let k = 0; k < 8; k++) this.fx.p.spawn({ x, y, z: 6, vx: vx * 0.4 + (Math.random() - 0.5) * 80, vy: vy * 0.4 + (Math.random() - 0.5) * 80, vz: 60 + Math.random() * 80, grav: 300, life: 1.4, s0: 2.5, s1: 2, r: 0.5, g: 0.5, b: 0.52, a0: 1, a1: 1, tex: this.fx.p.S.px, bounce: 0.3, vr: 8 });
      if (key === 'hydrant') this.hydrants = [...(this.hydrants || []), { x, y, until: this.time + 25 }];
      this.audio.play(key === 'bench' || key === 'cafetable' || key === 'crate' ? 'tock' : 'clang', x, y);
    } else {
      this.brokenProps.delete(i);
      this.renderer.wg.setPropVisible(i, true);
      for (const s of this.cw.shapesNear(p[1], p[2], 4, [])) if (s.prop === i) s.alive = true;
    }
  }
  setPickup(id, on, by) {
    const pk = this.pickups[id];
    if (!pk) return;
    pk.active = on;
    if (!on) this.fx.p.sparkle(pk.x, pk.y, 6, [1, 0.95, 0.6]);
  }
  addCash(id, x, y, a) { this.cash.set(id, { id, x, y, a }); }
  removeCash(id) { this.cash.delete(id); }

  skids(car, m, local) {
    const slip = car.slip || 0;
    const sp = Math.hypot(car.vx, car.vy);
    const key = car.id;
    const prev = this.lastSkid.get(key);
    const c = Math.cos(car.a), s = Math.sin(car.a);
    const rx = -c * m.len * 0.32, ry = -s * m.len * 0.32;
    const wx = -s * m.wid * 0.38, wy = c * m.wid * 0.38;
    const wheels = [[car.x + rx + wx, car.y + ry + wy], [car.x + rx - wx, car.y + ry - wy]];
    const sliding = (slip > 45 || (car.braking && sp > 140 && local)) && sp > 50;
    if (sliding && prev) {
      const terr = this.cw.terrainInfo(car.x, car.y);
      const onRoad = terr.surf === 'hard';
      const alpha = Math.min(0.42, 0.12 + slip / 600);
      for (let k = 0; k < 2; k++) {
        const [x0, y0] = prev[k], [x1, y1] = wheels[k];
        if (Math.hypot(x1 - x0, y1 - y0) < 60) this.renderer.marks.segment(x0, y0, x1, y1, m.bike ? 0.9 : 1.6, onRoad ? [0.06, 0.06, 0.07, alpha] : [0.25, 0.2, 0.15, alpha * 0.8]);
      }
      if (Math.random() < 0.5) {
        const [x, y] = wheels[Math.random() < 0.5 ? 0 : 1];
        if (onRoad) this.fx.p.smoke(x, y, 2, { grey: 0.82, s0: 4, s1: 18, life: 1.1, a: 0.35, vz: 6 });
        else this.fx.p.dust(x, y, [0.6, 0.52, 0.4]);
      }
    }
    this.lastSkid.set(key, sliding ? wheels : null);
    if (this.lastSkid.size > 200) this.lastSkid.clear();
  }

  onEnterCar(car) {
    const m = VEHICLES[car.model];
    this.ui.vehicleCard(m);
    if (this.radioStation < 0 && this.settings.autoRadio !== false && !m.bike) this.tuneRadio(Math.floor(Math.random() * STATIONS.length));
    else this.radio.setContext(true, false);
    this.local.lights = this.night;
  }
  onLeaveCar() {
    this.radio.setContext(false, this.settings.pocketRadio);
    this.local.siren = false;
  }
  tuneRadio(i) {
    this.radioStation = i;
    this.radio.onChange = (info) => this.ui.radioCard(info);
    this.radio.tune(i, () => this.net.serverNow());
    this.radio.setContext(!!this.local.car, this.settings.pocketRadio);
    if (i < 0) this.ui.radioCard(null);
  }

  nearestPoi(r = 46) {
    const L = this.local;
    const ref = L.car || L;
    let best = null, bd = r * r;
    for (const poi of this.world.pois) {
      if (!SHOPS[poi.type]) continue;
      const rr = SHOPS[poi.type].needsCar ? 110 : r;
      const d = (poi.x - ref.x) ** 2 + (poi.y - ref.y) ** 2;
      if (d < Math.min(bd, rr * rr) || (SHOPS[poi.type].needsCar && L.car && d < rr * rr && d < bd * 4)) { bd = d; best = poi; }
    }
    return best;
  }
  nearRaceStart() {
    if (!this.local.car || !this.races || this.job) return null;
    for (const r of this.races) if (Math.hypot(r.cps[0][0] - this.local.x, r.cps[0][1] - this.local.y) < 90) return r;
    return null;
  }

  objective() {
    const j = this.job;
    if (j) {
      if (j.kind === 'race' && j.cps) return j.cps[Math.min(j.idx, j.cps.length - 1)];
      if (j.target) return j.target;
    }
    if (this.markers.call && this.markers.call.until > this.time) return [this.markers.call.x, this.markers.call.y];
    return null;
  }

  districtAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const d = this.world.district[ty * this.world.w + tx];
    return DISTRICTS[d] ? DISTRICTS[d].name : '';
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    const input = this.input;
    input.pollGamepad();
    input.enabled = !this.ui.blocking;
    // hit-stop freezes presentation only, never the network or simulation clock
    const visDt = this.hitStopT > 0 ? dt * 0.15 : dt;
    this.hitStopT -= dt;
    this.ui.handleKeys?.(input);
    this.handleActions(input);
    this.local.update(dt, input);
    this.updateWorld(dt);
    this.render(dt, visDt);
    input.endFrame();
  }

  handleActions(input) {
    const L = this.local;
    if (this.ui.blocking) return;
    if (input.hit('use')) {
      if (L.mode === 'drive') {
        const race = this.nearRaceStart();
        const poi = this.nearestPoi();
        if (poi && SHOPS[poi.type]?.needsCar && Math.hypot(L.car.vx, L.car.vy) < 60) this.ui.openShop(poi);
        else if (race && Math.hypot(L.car.vx, L.car.vy) < 80) this.net.send({ t: 'job', a: 'race', r: race.id });
        else L.exitCar();
      } else if (L.mode === 'walk') {
        const poi = this.nearestPoi();
        if (poi && !SHOPS[poi.type].needsCar) this.ui.openShop(poi);
        else if (!L.tryEnter() && poi) this.ui.openShop(poi);
      }
    }
    if (input.hit('callcar')) this.ui.openGarage();
    if (input.hit('radio')) this.tuneRadio(this.radioStation + 1 >= STATIONS.length ? -1 : this.radioStation + 1);
    if (input.hit('job')) {
      if (this.job) this.net.send({ t: 'job', a: 'cancel' });
      else if (L.car && VEHICLES[L.car.model].key === 'taxi') this.net.send({ t: 'job', a: 'taxi' });
    }
    if (input.hit('zoom')) this.settings.zoomOut = !this.settings.zoomOut;
    this.voice.setTransmit(input.is('talk'));
  }

  updateWorld(dt) {
    const L = this.local;
    // clock and weather
    this.hourNow = (this.hour + ((this.time - (this.hourAt || 0)) / (this.dayLength || 1440)) * 24) % 24;
    const w = this.weather;
    this.wet += ((w.rain > 0.2 ? 1 : 0) - this.wet) * dt * (w.rain > 0.2 ? 1 / 60 : 1 / 180);
    this.wet = clamp(this.wet, 0, 1);
    this.tod = timeOfDay(this.hourNow, w);
    // pickups and collectibles
    const ref = L.car || L;
    const rr = L.car ? 26 : 16;
    if (L.alive) {
      for (const pk of this.pickups) {
        if (!pk.active || Math.abs(pk.x - ref.x) > rr || Math.abs(pk.y - ref.y) > rr) continue;
        if ((this.pickT.get(pk.id) || 0) > this.time) continue;
        this.pickT.set(pk.id, this.time + 0.6);
        this.net.send({ t: 'pickup', id: pk.id });
      }
      for (const c of this.cash.values()) {
        if (Math.abs(c.x - ref.x) > rr || Math.abs(c.y - ref.y) > rr) continue;
        if ((this.pickT.get(c.id) || 0) > this.time) continue;
        this.pickT.set(c.id, this.time + 0.6);
        this.net.send({ t: 'pickup', id: c.id });
      }
      if (L.mode === 'walk') for (const c of this.world.collectibles) {
        if (this.collected.has(c.id) || Math.abs(c.x - L.x) > 20 || Math.abs(c.y - L.y) > 20) continue;
        if ((this.pickT.get('c' + c.id) || 0) > this.time) continue;
        this.pickT.set('c' + c.id, this.time + 1);
        this.net.send({ t: 'collect', id: c.id });
      }
    }
    // broken hydrants spray
    if (this.hydrants) {
      this.hydrants = this.hydrants.filter((h) => h.until > this.time);
      for (const h of this.hydrants) for (let k = 0; k < 2; k++) this.fx.p.spawn({ x: h.x, y: h.y, z: 4, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vz: 140 + Math.random() * 40, grav: 260, life: 1.2, s0: 2, s1: 3, r: 0.75, g: 0.88, b: 1, a0: 0.9, a1: 0, tex: this.fx.p.S.soft });
    }
    // district banner
    const dn = this.districtAt(L.x, L.y);
    if (dn && dn !== this.districtName) { this.districtName = dn; this.ui.district(dn); }
  }

  updateCamera(dt) {
    const L = this.local;
    const cam = this.cam;
    const car = L.car;
    const vx = car ? car.vx : L.vx, vy = car ? car.vy : L.vy;
    const spd = Math.hypot(vx, vy);
    let zT = 1;
    if (car) zT = 1 + 0.55 * smoothstep(40, 300, spd);
    if (this.settings.zoomOut) zT *= 1.35;
    if (L.mode === 'walk' && L.w.kind === 'gun' && L.aimingT > 0) zT *= 1.08;
    const tau = zT > cam.zoom ? 0.6 : 1.6;
    cam.zoom += (zT - cam.zoom) * (1 - Math.exp(-dt / tau));
    let lx = 0, ly = 0;
    if (car) {
      lx = vx * 0.45; ly = vy * 0.45;
      const maxLead = 0.3 * cam.viewW * 0.5;
      const l = Math.hypot(lx, ly);
      if (l > maxLead) { lx *= maxLead / l; ly *= maxLead / l; }
    } else if (this.input.lastDevice === 'kb' && !this.ui.blocking && L.mode === 'walk') {
      const [wx, wy] = cam.screenToWorld(this.input.mouse.x, this.input.mouse.y, 0);
      lx = clamp((wx - L.x) * 0.22, -60, 60); ly = clamp((wy - L.y) * 0.22, -40, 40);
    }
    [cam.x, this.camV.x] = smoothDamp(cam.x, this.camV.x, L.x + lx, car ? 6 : 9, dt);
    [cam.y, this.camV.y] = smoothDamp(cam.y, this.camV.y, L.y + ly, car ? 6 : 9, dt);
    if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y)) this.snapCamera();
    // trauma shake + directional kick
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma;
    const t = this.time * 18;
    const n = (s) => (valueNoise(t, s, 3) - 0.5) * 2;
    cam.shakeX = 8 * sh * n(1) + this.kickV[0];
    cam.shakeY = 8 * sh * n(2) + this.kickV[1];
    cam.shakeA = (2.5 * Math.PI / 180) * sh * n(3) * 0.5;
    this.kickV[0] *= Math.exp(-dt * 20); this.kickV[1] *= Math.exp(-dt * 20);
  }

  render(dt, visDt) {
    const r = this.renderer;
    const L = this.local;
    r.resize(innerWidth, innerHeight, devicePixelRatio || 1);
    this.cam.setScreen(r.w, r.h);
    this.updateCamera(dt);
    this.cam.update();
    const serverNow = this.net.serverNow();
    this.state.interpolate(serverNow - INTERP_DELAY);
    const view = this.cam.groundBounds(40);
    this.fx.update(visDt);
    this.fx.p.update(visDt);
    // rain particles around the camera
    if (this.weather.rain > 0.05) this.fx.p.rain(this.cam.x, this.cam.y, view[2] - view[0], view[3] - view[1], this.weather.rain, dt, this.tod.streetLights);
    if (this.flashT > 0) this.flashT -= dt;
    this.dyn.reset();
    this.markers.taxiFare = null;
    this.scene.build(this.dyn, visDt, view, this.time);
    this.ui.markers?.(this);
    const parts = this.fx.p.build([view[0] - 60, view[1] - 60, view[2] + 60, view[3] + 60]);
    if (L.mode === 'ko') this.fade = Math.max(0.35, 1 - L.koT * 0.25); else this.fade = Math.min(1, (this.fade || 0) + dt * 2);
    this.hurtT = Math.max(0, (this.hurtT || 0) - dt);
    const lowHp = L.stats.hp < 30 && L.alive ? 0.35 + 0.15 * Math.sin(this.time * 6) : 0;
    r.render({
      cam: this.cam, tod: this.tod, time: this.time, dyn: this.dyn, lights: this.scene.lights, nLights: this.scene.nLights, parts,
      wet: this.wet, flash: this.flashT > 0 ? (this.flashT > 0.25 || (this.flashT > 0.1 && this.flashT < 0.16) ? 1.2 : 0) : 0,
      fade: this.fade, damage: Math.max(this.hurtT * 1.6, lowHp), fadePos: [L.x, L.y], satMul: L.mode === 'ko' ? 0.4 : 1,
    });
    // audio listener follows the camera target
    const A = this.audio;
    A.listener.x = this.cam.x; A.listener.y = this.cam.y;
    const cars = [];
    for (const e of this.state.vehicles.map.values()) {
      const s = e.cur, info = this.state.vehicles.info.get(e.id);
      if (!info || info.d || !s.driver) continue;
      cars.push({ id: e.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy, model: info.m, slip: s.slip, siren: !!(s.flags & 4), throttle: 0.5 });
    }
    if (L.car) cars.push({ id: L.car.id, x: L.car.x, y: L.car.y, vx: L.car.vx, vy: L.car.vy, speed: L.car.speed, throttle: L.car.throttle, model: L.car.model, slip: L.car.slip, siren: L.siren, local: true });
    this.vaudio.update(cars, dt);
    this.ambience.update(this.ambientContext(), dt);
    // voice
    const pos = new Map();
    for (const e of this.state.players.map.values()) pos.set(e.id, e.cur);
    this.speaking = this.voice.update(L, pos);
    this.ui.frame?.(this, dt);
  }

  ambientContext() {
    const L = this.local;
    const w = this.world;
    const tx = Math.floor(L.x / TILE), ty = Math.floor(L.y / TILE);
    let water = 0, park = 0, sub = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const sx = tx + Math.round(Math.cos(a) * 14), sy = ty + Math.round(Math.sin(a) * 14);
      if (sx < 0 || sy < 0 || sx >= w.w || sy >= w.h) continue;
      const g = w.ground[sy * w.w + sx];
      if (g <= 1) water++;
      if (g === 3 || g === 5) park++;
      const d = w.district[sy * w.w + sx];
      if (d === 1 || d === 3 || d === 9) sub++;
    }
    let fountain = 0;
    this.renderer.wg.forEachInCells(this.renderer.wg.emitGrid, L.x - 100, L.y - 100, L.x + 100, L.y + 100, (e) => { if (e.k === 'fountain') fountain = Math.max(fountain, 1 - Math.hypot(e.x - L.x, e.y - L.y) / 120); });
    return { hour: this.hourNow, rain: this.weather.rain, cloud: this.weather.cloud, nearWater: water / 12, coast: Math.min(1, water / 5), park: park / 12, suburb: sub / 12, fountain: Math.max(0, fountain), inCar: !!L.car, x: L.x, y: L.y };
  }
}

void WEAPONS; void NPC_DRIVER; void SHOP_POIS;
