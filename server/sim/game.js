import { CollisionWorld } from '../../shared/collision.js';
import { F, TILE, VIEW_RADIUS, PROTOCOL_VERSION, POI, clamp } from '../../shared/constants.js';
import { VEHICLES, VEH_ID, PAINTS } from '../../shared/vehicles.js';
import { WEAPONS, WEAPON_ID, ARMOR_PRICE } from '../../shared/weapons.js';
import { sanitizeAppearance, sanitizeName } from '../../shared/appearance.js';
import { encodeSnapshot, MODE, PF, NPC_DRIVER, PED_STATE as PS } from '../../shared/protocol.js';
import { SHOPS, findItem } from '../../shared/shops.js';
import { PROP_DEF } from '../../shared/props.js';
import { Storage } from '../storage.js';
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Jobs } from './jobs.js';
import { Voice } from './voice.js';

const TICK = 1 / 20;
const RESPAWN_TIME = { pickup: { health: 30, armor: 60, cash: 60 }, weapon: 45 };
const BAD_WORDS = /\b(nigg\w*|fag\w*|kike\w*|retard\w*)\b/gi;
const BAD_TEST = /\b(nigg\w*|fag\w*|kike\w*|retard\w*)\b/i;

class DynGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  add(o) {
    const k = Math.floor(o.x / this.cell) * 100000 + Math.floor(o.y / this.cell);
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(o);
  }
  query(x, y, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const a = this.map.get(i * 100000 + j);
      if (a) for (const o of a) fn(o);
    }
  }
}

export class Game {
  constructor(world, config) {
    this.world = world;
    this.config = config;
    this.cw = new CollisionWorld(world);
    this.storage = new Storage(config.dataDir);
    this.players = new Map();
    this.vehicles = new Map();
    this.peds = new Map();
    this.projs = new Map();
    this.clients = new Set();
    this.nextId = { p: 1, v: 1, n: 1, j: 1 };
    this.grid = new DynGrid(128);
    this.started = Date.now();
    this.now = 0;
    this.startHour = 8.5;
    this.weather = { cloud: 0.2, rain: 0, storm: 0, target: { cloud: 0.2, rain: 0, storm: 0 }, next: 300 };
    this.pickups = world.pickups.map((p) => ({ ...p, active: true, respawn: 0 }));
    this.cashDrops = new Map();
    this.broken = new Map();
    this.events = [];
    this.traffic = new Traffic(this);
    this.pedAI = new Peds(this);
    this.police = new Police(this);
    this.combat = new Combat(this);
    this.jobs = new Jobs(this);
    this.voice = new Voice(this, config);
    this.policeSpawns = world.policeSpawns.length ? world.policeSpawns : world.spawns;
    this.clinics = world.spawns.filter((s) => s.clinic);
    if (!this.clinics.length) this.clinics = world.spawns;
    this.lastTick = performance.now();
    if (!config.manualTick) {
      this.timer = setInterval(() => this.tick(), TICK * 1000);
      this.worldTimer = setInterval(() => this.broadcastWorld(), 5000);
    }
  }

  get hour() { return (this.startHour + (this.now / this.config.dayLength) * 24) % 24; }
  get night() { const h = this.hour; return h < 6.4 || h > 19.3; }

  status() {
    return { name: this.config.serverName, players: [...this.players.values()].filter((p) => p.ready).length, max: this.config.maxPlayers, uptime: Math.round(this.now), hour: Math.round(this.hour * 10) / 10 };
  }

  shutdown() {
    clearInterval(this.timer);
    clearInterval(this.worldTimer);
    for (const p of this.players.values()) this.saveProfile(p);
    this.storage.close();
  }

  // ------------------------------------------------------------ entities
  allocId(kind, map) {
    for (let i = 0; i < 65535; i++) {
      let id = this.nextId[kind]++;
      if (this.nextId[kind] > 32000) this.nextId[kind] = 1;
      if (!map.has(id)) return id;
    }
    throw new Error('id space exhausted');
  }

  spawnVehicle(model, x, y, a, opt = {}) {
    const m = VEHICLES[model];
    const id = this.allocId('v', this.vehicles);
    const v = {
      id, kind: opt.kind || 'parked', model, color: opt.color ?? 0, x, y, a, vx: 0, vy: 0, av: 0,
      hp: m.health, maxHp: m.health, driverId: 0, flags: 0, steer: 0, slip: 0, dead: false, deadT: 0, info: 1, owner: 0,
      created: this.now, lastDriven: 0,
    };
    this.vehicles.set(id, v);
    return v;
  }

  removeVehicle(id) {
    const v = this.vehicles.get(id);
    if (!v) return;
    for (const p of this.players.values()) if (p.vehicle === id) this.ejectPlayer(p, true);
    this.vehicles.delete(id);
  }

  vehicleNear(x, y, r) {
    for (const v of this.vehicles.values()) if ((v.x - x) ** 2 + (v.y - y) ** 2 < r * r) return v;
    return null;
  }

  addPed(o) {
    const id = this.allocId('n', this.peds);
    const n = { id, flags: 0, vx: 0, vy: 0, info: 1, ...o };
    this.peds.set(id, n);
    return n;
  }
  removePed(id) { this.peds.delete(id); }

  addProj(o) {
    const id = this.allocId('j', this.projs);
    const j = { id, ...o };
    this.projs.set(id, j);
    return j;
  }
  removeProj(id) { this.projs.delete(id); }

  anyPlayerSees(x, y, r = 620) {
    for (const p of this.players.values()) if (p.ready && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r * 0.62) return true;
    return false;
  }

  sendInfo(entity) { entity.info = (entity.info || 0) + 1; }

  // ------------------------------------------------------------ messaging
  send(ws, msg) {
    if (ws.readyState !== 1) return;
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  sendTo(p, msg) { if (p && p.ws) this.send(p.ws, msg); }
  notify(p, text, kind = 'info') { this.sendTo(p, { t: 'note', m: text, k: kind }); }
  broadcast(msg, except = 0) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ready && p.id !== except) this.send(p.ws, s);
  }
  // Queue an event for clients within radius of (x, y).
  event(data, x, y, radius = 1200, except = 0) { this.events.push({ data, x, y, r: radius, except }); }

  sendMe(p) {
    const prof = p.profile;
    this.sendTo(p, {
      t: 'me', hp: Math.max(0, Math.round(p.hp)), armor: Math.round(prof.armor), money: prof.money, wanted: p.wanted,
      weapons: prof.weapons, ammo: prof.ammo, passive: p.passive, collected: prof.collected.length, cars: prof.cars,
    });
  }

  // ------------------------------------------------------------ connections
  connect(ws, ip) {
    const c = { ws, ip, player: null, bucket: 120, last: Date.now(), hello: false };
    this.clients.add(c);
    ws.on('message', (data, isBinary) => {
      const t = Date.now();
      c.bucket = Math.min(120, c.bucket + ((t - c.last) / 1000) * 90);
      c.last = t;
      if (--c.bucket < 0) return;
      if (isBinary || data.length > 64 * 1024) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      try { this.onMessage(c, msg); } catch (e) { console.error('[game] message error', e); }
    });
    ws.on('close', () => this.disconnect(c));
    ws.on('error', () => {});
  }

  disconnect(c) {
    this.clients.delete(c);
    const p = c.player;
    if (!p) return;
    this.voice.drop(p);
    if (p.vehicle) this.ejectPlayer(p, true);
    if (p.job) this.jobs.end(p, false);
    for (const v of this.vehicles.values()) if (v.owner === p.id && v.kind === 'owned') this.removeVehicle(v.id);
    this.saveProfile(p);
    this.players.delete(p.id);
    if (p.ready) this.broadcast({ t: 'chat', sys: true, m: `${p.name} left Haven Bay.` });
  }

  saveProfile(p) {
    const prof = p.profile;
    prof.lastSeen = Date.now();
    prof.armor = Math.round(prof.armor);
    if (p.alive && !p.vehicle) prof.pos = [Math.round(p.x), Math.round(p.y)];
    prof.passive = p.passive;
    prof.stats.playtime += Math.round(this.now - (p.joinedAt || this.now));
    p.joinedAt = this.now;
    this.storage.touch();
  }

  onMessage(c, m) {
    const p = c.player;
    switch (m.t) {
      case 'hello': return this.onHello(c, m);
      case 'join': return this.onJoin(c, m);
      case 'ping': return this.send(c.ws, { t: 'pong', c: m.c, s: this.now });
    }
    if (!p || !p.ready) return;
    switch (m.t) {
      case 's': return this.onState(p, m.s);
      case 'fire': return this.combat.onFire(p, m);
      case 'melee': return this.combat.onMelee(p, m);
      case 'proj': return this.combat.onProjectile(p, m);
      case 'enter': return this.onEnter(p, m.v | 0);
      case 'exit': return this.onExit(p, m);
      case 'bump': return this.onBump(p, m);
      case 'hitped': return this.onHitPed(p, m);
      case 'runover': return this.onRunover(p, m);
      case 'crash': return this.onCrash(p, m);
      case 'prop': return this.onProp(p, m);
      case 'chat': return this.onChat(p, m);
      case 'buy': return this.onBuy(p, m);
      case 'job': return this.onJob(p, m);
      case 'collect': return this.onCollect(p, m.id | 0);
      case 'pickup': return this.onPickup(p, m);
      case 'rtc': return this.voice.relay(p, m);
      case 'voice': p.voiceOn = !!m.on; return;
      case 'talk': p.talking = !!m.on; return;
      case 'app': return this.onAppearance(p, m);
      case 'passive': return this.onPassive(p, !!m.on);
      case 'respawn': if (p.alive && p.hp <= 0) this.knockout(p, null, -1); return;
      case 'callcar': return this.onCallCar(p, m.i | 0);
      case 'emote': this.event({ e: 'emote', p: p.id, k: String(m.k).slice(0, 12) }, p.x, p.y, 900); return;
      case 'arrest': return;
    }
  }

  onHello(c, m) {
    if (m.v !== PROTOCOL_VERSION) return this.send(c.ws, { t: 'kick', m: 'Your game is out of date. Please refresh the page.' });
    const prof = this.storage.get(m.token);
    c.token = prof ? m.token : null;
    c.hello = true;
    this.send(c.ws, {
      t: 'profile', exists: !!prof, name: prof?.name || '', app: prof?.app || null, money: prof?.money ?? 0,
      server: this.config.serverName, motd: this.config.motd, players: this.status().players, max: this.config.maxPlayers,
      pvp: this.config.pvp,
    });
  }

  onJoin(c, m) {
    if (c.player || !c.hello) return;
    const ready = [...this.players.values()].filter((p) => p.ready).length;
    if (ready >= this.config.maxPlayers) return this.send(c.ws, { t: 'kick', m: 'The server is full right now. Try again soon!' });
    const name = sanitizeName(m.name);
    if (!name) return this.send(c.ws, { t: 'deny', m: 'Pick a name with 2-16 letters, numbers, spaces, _ - or .' });
    if (BAD_TEST.test(name)) return this.send(c.ws, { t: 'deny', m: 'Please pick a friendlier name.' });
    for (const o of this.players.values()) if (o.ready && o.name.toLowerCase() === name.toLowerCase() && o.token !== c.token) return this.send(c.ws, { t: 'deny', m: 'Someone with that name is already in town.' });
    const app = sanitizeAppearance(m.app);
    let token = c.token, profile;
    if (token) {
      profile = this.storage.get(token);
      profile.name = name;
      if (m.app) profile.app = app;
      // one session per profile
      for (const o of this.players.values()) if (o.token === token) { this.send(o.ws, { t: 'kick', m: 'You joined from another window.' }); o.ws.close(); }
    } else {
      ({ token, profile } = this.storage.create(name, app));
    }
    const id = this.allocId('p', this.players);
    let spawn = this.world.spawns[Math.floor(Math.random() * this.world.spawns.length)];
    if (profile.pos && this.cw.circleFree(profile.pos[0], profile.pos[1], 6, F.WALK)) spawn = { x: profile.pos[0], y: profile.pos[1] };
    const p = {
      id, ws: c.ws, token, profile, name, app: profile.app, x: spawn.x, y: spawn.y, a: Math.PI / 2, aim: 0, vx: 0, vy: 0,
      mode: MODE.WALK, vehicle: 0, weapon: 0, flags: 0, hp: 100, alive: true, wanted: 0, heat: 0, lastSeen: 0,
      passive: this.config.pvp ? profile.passive !== false : true, ready: true, lastState: this.now, tp: 1, info: 1,
      known: { p: new Map(), v: new Map(), n: new Map() }, lastFire: {}, firingT: 0, spawnShield: this.now + 4,
      joinedAt: this.now, voiceOn: false, talking: false, chatT: 0, job: null, lastPvp: 0,
    };
    c.player = p;
    this.players.set(id, p);
    this.storage.touch();
    this.send(c.ws, {
      t: 'welcome', id, token, name, app: profile.app, x: p.x, y: p.y, time: this.now, hour: this.hour, dayLength: this.config.dayLength,
      startHour: this.startHour, weather: this.wInfo(), pickups: this.pickups.filter((q) => !q.active).map((q) => q.id),
      broken: [...this.broken.keys()], collected: profile.collected, races: this.jobs.races, leaderboards: this.storage.leaderboards,
      pvp: this.config.pvp, tutorial: !profile.tutorial, tp: p.tp, motd: this.config.motd,
    });
    profile.tutorial = true;
    this.sendMe(p);
    this.broadcast({ t: 'chat', sys: true, m: `${name} arrived in Haven Bay.` }, id);
    console.log(`[game] ${name} joined (${this.players.size} online)`);
  }

  // Client-authoritative movement with server sanity checks.
  onState(p, s) {
    if (!Array.isArray(s) || s.length < 9) return;
    const [tp, x, y, a, mode, flags, weapon, aim, vx, vy] = s;
    if (tp !== p.tp) return;
    if (![x, y, a, vx, vy].every(Number.isFinite)) return;
    const dt = Math.max(0.03, this.now - p.lastState);
    p.lastState = this.now;
    if (!p.alive) return;
    p.flags = (flags | 0) & 0xff;
    if (p.talking) p.flags |= PF.TALKING;
    if (p.passive) p.flags |= PF.PASSIVE;
    const w = weapon | 0;
    p.weapon = WEAPONS[w] && (w === 0 || p.profile.weapons[WEAPONS[w].key]) ? w : 0;
    p.aim = Number(aim) || 0;
    if (p.vehicle) {
      const v = this.vehicles.get(p.vehicle);
      if (!v || v.driverId !== p.id) return;
      const vs = s[10];
      if (!Array.isArray(vs) || vs.length < 6 || !vs.every(Number.isFinite)) return;
      const [nx, ny, na, nvx, nvy, nav, steer, vflags, slip] = vs;
      const m = VEHICLES[v.model];
      const maxD = (m.maxSpeed * 1.4 + 200) * dt + 30;
      if ((nx - v.x) ** 2 + (ny - v.y) ** 2 > maxD * maxD || !this.validDrivePos(nx, ny)) {
        this.correct(p, v.x, v.y);
        return;
      }
      v.x = nx; v.y = ny; v.a = na; v.vx = nvx; v.vy = nvy; v.av = nav; v.steer = steer; v.slip = slip || 0;
      v.flags = ((vflags | 0) & (1 | 2 | 4 | 8 | 128)) | (v.flags & (16 | 32 | 64));
      if (!VEHICLES[v.model].siren) v.flags &= ~4;
      v.lastDriven = this.now;
      p.x = nx; p.y = ny; p.vx = nvx; p.vy = nvy; p.a = na;
      p.mode = VEHICLES[v.model].bike ? MODE.RIDE : MODE.DRIVE;
      p.profile.stats.distance += Math.hypot(nvx, nvy) * dt / 8;
      return;
    }
    const maxD = 210 * dt + 24;
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > maxD * maxD) {
      p.strikes = (p.strikes || 0) + 1;
      if (p.strikes > 2) { this.correct(p, p.x, p.y); p.strikes = 0; }
      return;
    }
    p.strikes = 0;
    if (this.cw.flagsAt(x, y) & F.BUILDING) { this.correct(p, p.x, p.y); return; }
    p.x = x; p.y = y; p.a = a; p.vx = vx; p.vy = vy;
    p.mode = mode === MODE.SWIM ? MODE.SWIM : MODE.WALK;
  }

  validDrivePos(x, y) {
    if (x < 0 || y < 0 || x > this.world.w * TILE || y > this.world.h * TILE) return false;
    return !(this.cw.flagsAt(x, y) & F.BUILDING);
  }

  correct(p, x, y) {
    p.tp++;
    p.x = x; p.y = y;
    this.sendTo(p, { t: 'tp', x, y, tp: p.tp, v: p.vehicle || 0 });
  }

  // ------------------------------------------------------------ vehicles
  onEnter(p, vid) {
    const v = this.vehicles.get(vid);
    if (!v || v.dead || p.vehicle || !p.alive) return this.sendTo(p, { t: 'deny', m: '' });
    if ((v.x - p.x) ** 2 + (v.y - p.y) ** 2 > 60 * 60) return this.sendTo(p, { t: 'deny', m: 'Too far away.' });
    if (v.driverId && v.driverId < NPC_DRIVER) return this.sendTo(p, { t: 'deny', m: 'Someone is driving that.' });
    if (v.kind === 'owned' && v.owner !== p.id) return this.sendTo(p, { t: 'deny', m: 'That car is locked.' });
    if (v.kind === 'job' && v.owner && v.owner !== p.id) return this.sendTo(p, { t: 'deny', m: 'That is someone else\'s work vehicle.' });
    // carjacking an NPC
    if (v.kind === 'traffic' && v.npcDriver) {
      const c = Math.cos(v.a), s = Math.sin(v.a);
      const ped = this.pedAI.spawn(v.x + s * 18, v.y - c * 18, { seed: v.npcDriver });
      ped.state = PS.FLEE; ped.fleeX = p.x; ped.fleeY = p.y; ped.timer = 8;
      this.event({ e: 'jack', v: v.id, n: ped.id }, v.x, v.y, 900);
      this.police.crime(p, 'carjack', v.x, v.y);
    } else if (v.kind === 'parked' || (v.kind === 'traffic' && v.ai && v.ai.mode === 'parked')) {
      if (Math.random() < 0.15) this.police.crime(p, 'theft', v.x, v.y);
    }
    if (v.kind === 'police' && v.ai) this.police.crime(p, 'carjack', v.x, v.y);
    v.driverId = p.id;
    v.ai = null;
    v.npcDriver = 0;
    if (v.kind === 'traffic' || v.kind === 'police' || v.kind === 'parked') v.kind = 'player';
    v.flags &= ~8;
    p.vehicle = v.id;
    p.mode = VEHICLES[v.model].bike ? MODE.RIDE : MODE.DRIVE;
    p.tp++;
    this.sendTo(p, { t: 'drive', v: v.id, tp: p.tp, st: [v.x, v.y, v.a, v.vx, v.vy, v.av || 0, v.hp] });
    if (p.job && p.job.kind === 'taxi' && p.job.vehicle === v.id) p.job.away = 0;
  }

  onExit(p, m) {
    if (!p.vehicle) return;
    const v = this.vehicles.get(p.vehicle);
    const x = Number(m.x), y = Number(m.y);
    if (v && Number.isFinite(x) && Number.isFinite(y) && (x - v.x) ** 2 + (y - v.y) ** 2 < 70 * 70 && this.cw.circleFree(x, y, 4, F.WALK)) {
      p.x = x; p.y = y;
    } else if (v) {
      const pos = this.exitPos(v);
      p.x = pos[0]; p.y = pos[1];
    }
    this.releaseVehicle(p, v);
    this.sendTo(p, { t: 'walk', x: p.x, y: p.y, tp: p.tp });
  }

  exitPos(v) {
    const m = VEHICLES[v.model];
    const c = Math.cos(v.a), s = Math.sin(v.a);
    for (const side of [-1, 1]) {
      const off = m.wid / 2 + 8;
      const x = v.x + s * off * side, y = v.y - c * off * side;
      if (this.cw.circleFree(x, y, 5, F.WALK)) return [x, y];
    }
    for (const fb of [1, -1]) {
      const x = v.x + c * (m.len / 2 + 8) * fb, y = v.y + s * (m.len / 2 + 8) * fb;
      if (this.cw.circleFree(x, y, 5, F.WALK)) return [x, y];
    }
    return [v.x, v.y];
  }

  releaseVehicle(p, v) {
    p.vehicle = 0;
    p.mode = MODE.WALK;
    p.tp++;
    if (v) {
      v.driverId = 0;
      v.flags &= ~(4 | 8);
      if (v.kind === 'player') { v.kind = 'traffic'; v.ai = { mode: 'phys', physT: 0, speed: 0 }; v.keep = false; }
    }
  }

  ejectPlayer(p, forced) {
    const v = this.vehicles.get(p.vehicle);
    if (v) { const pos = this.exitPos(v); p.x = pos[0]; p.y = pos[1]; }
    this.releaseVehicle(p, v);
    this.sendTo(p, { t: 'walk', x: p.x, y: p.y, tp: p.tp, forced: !!forced });
  }

  onBump(p, m) {
    const v = this.vehicles.get(m.v | 0);
    if (!v || v.dead) return;
    const ref = p.vehicle ? this.vehicles.get(p.vehicle) : p;
    if (!ref || (ref.x - v.x) ** 2 + (ref.y - v.y) ** 2 > 90 * 90) return;
    const vx = clamp(Number(m.vx) || 0, -500, 500), vy = clamp(Number(m.vy) || 0, -500, 500), av = clamp(Number(m.av) || 0, -6, 6);
    const impact = clamp(Number(m.i) || 0, 0, 500);
    if (v.driverId && v.driverId < NPC_DRIVER) {
      const drv = this.players.get(v.driverId);
      if (drv) this.sendTo(drv, { t: 'shove', vid: v.id, vx, vy, av });
      if (impact > 60) this.combat.damageVehicle(v, impact * 0.5, p);
      return;
    }
    if (v.kind === 'traffic' && v.ai) this.traffic.knock(v, v.vx + vx, v.vy + vy, (v.av || 0) + av);
    else if (v.kind === 'police' && v.ai) { v.vx += vx; v.vy += vy; v.av = (v.av || 0) + av; this.police.crime(p, 'ramcop', v.x, v.y); }
    else { v.vx += vx; v.vy += vy; v.av = (v.av || 0) + av; if (!v.ai) v.ai = { mode: 'phys', physT: 0, speed: 0 }; if (v.kind === 'parked') v.kind = 'traffic'; }
    if (impact > 60) this.combat.damageVehicle(v, impact * 0.6, p);
  }

  onCrash(p, m) {
    if (!p.vehicle) return;
    const v = this.vehicles.get(p.vehicle);
    if (!v) return;
    const impact = clamp(Number(m.i) || 0, 0, 600);
    if (impact > 70) this.combat.damageVehicle(v, (impact - 60) * 0.9, null);
    this.event({ e: 'crash', x: v.x, y: v.y, i: impact }, v.x, v.y, 900, p.id);
  }

  onHitPed(p, m) {
    const n = this.peds.get(m.id | 0);
    if (!n || n.state === PS.OUT) return;
    const v = this.vehicles.get(p.vehicle);
    if (!v || (v.x - n.x) ** 2 + (v.y - n.y) ** 2 > 70 * 70) return;
    const speed = Math.hypot(v.vx, v.vy);
    if (speed < 40) return;
    const dmg = Math.min(80, speed * 0.22);
    this.pedAI.knock(n, clamp(Number(m.vx) || 0, -400, 400), clamp(Number(m.vy) || 0, -400, 400), dmg, p);
    this.police.crime(p, n.cop ? 'shootcop' : 'hitped', n.x, n.y);
    this.event({ e: 'hit', k: 'n', id: n.id, x: n.x, y: n.y, w: -1 }, n.x, n.y, 900, p.id);
    this.pedAI.scare(n.x, n.y, 200, 0.6);
  }

  onRunover(p, m) {
    const t = this.players.get(m.id | 0);
    const v = this.vehicles.get(p.vehicle);
    if (!t || !v || !t.alive || t.vehicle) return;
    if ((v.x - t.x) ** 2 + (v.y - t.y) ** 2 > 80 * 80) return;
    const speed = Math.hypot(v.vx, v.vy);
    if (speed < 50) return;
    if (!this.combat.canHurt(p, t)) {
      this.sendTo(t, { t: 'knock', vx: clamp(Number(m.vx) || 0, -200, 200) * 0.4, vy: clamp(Number(m.vy) || 0, -200, 200) * 0.4 });
      return;
    }
    this.combat.damagePlayer(t, Math.min(70, speed * 0.18), p, -1, v.x, v.y);
    this.sendTo(t, { t: 'knock', vx: clamp(Number(m.vx) || 0, -400, 400), vy: clamp(Number(m.vy) || 0, -400, 400) });
  }

  onProp(p, m) {
    const i = m.i | 0;
    const prop = this.world.props[i];
    if (!prop || !PROP_DEF[prop[0]].brk || this.broken.has(i)) return;
    const ref = p.vehicle ? this.vehicles.get(p.vehicle) : p;
    if (!ref || (ref.x - prop[1]) ** 2 + (ref.y - prop[2]) ** 2 > 90 * 90) return;
    this.breakProp(i, Number(m.vx) || 0, Number(m.vy) || 0);
  }

  breakProp(i, vx = 0, vy = 0) {
    if (this.broken.has(i)) return;
    const prop = this.world.props[i];
    this.broken.set(i, this.now + 90);
    for (const s of this.cw.shapesNear(prop[1], prop[2], 4, [])) if (s.prop === i) s.alive = false;
    this.event({ e: 'prop', i, on: false, vx, vy }, prop[1], prop[2], 1600);
  }

  dropCash(x, y, amount) {
    const id = 10000 + Math.floor(Math.random() * 1e6);
    this.cashDrops.set(id, { id, x, y, amount, until: this.now + 30 });
    this.event({ e: 'cash', id, x, y, a: amount }, x, y, 1000);
  }

  // ------------------------------------------------------------ pickups & collectibles
  onPickup(p, m) {
    const id = m.id | 0;
    if (this.cashDrops.has(id)) {
      const c = this.cashDrops.get(id);
      if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 > 50 * 50) return;
      this.cashDrops.delete(id);
      p.profile.money += c.amount;
      this.sendMe(p);
      this.sendTo(p, { t: 'cash', d: c.amount, why: '' });
      this.event({ e: 'cashgone', id }, c.x, c.y, 1000);
      return;
    }
    const pk = this.pickups[id];
    if (!pk || !pk.active) return;
    const ref = p.vehicle ? this.vehicles.get(p.vehicle) : p;
    if (!ref || (pk.x - ref.x) ** 2 + (pk.y - ref.y) ** 2 > 50 * 50) return;
    const prof = p.profile;
    let msg = '';
    if (pk.kind === 'health') { if (p.hp >= 100) return; p.hp = Math.min(100, p.hp + 50); msg = '+50 health'; }
    else if (pk.kind === 'armor') { if (prof.armor >= 100) return; prof.armor = Math.min(100, prof.armor + 50); msg = '+50 armor'; }
    else if (pk.kind === 'cash') { const a = 50 + Math.floor(Math.random() * 100); prof.money += a; msg = `+$${a}`; }
    else {
      const w = WEAPONS[WEAPON_ID[pk.kind]];
      if (!w) return;
      prof.weapons[w.key] = 1;
      prof.ammo[w.key] = Math.min(999, (prof.ammo[w.key] || 0) + (w.ammoPack || w.clip * 3 || 0));
      msg = w.name;
    }
    pk.active = false;
    pk.respawn = this.now + (RESPAWN_TIME.pickup[pk.kind] || RESPAWN_TIME.weapon);
    this.storage.touch();
    this.sendMe(p);
    this.sendTo(p, { t: 'got', m: msg, k: pk.kind });
    this.event({ e: 'pk', id, on: false, p: p.id }, pk.x, pk.y, 1600);
  }

  onCollect(p, id) {
    const c = this.world.collectibles[id];
    if (!c || p.profile.collected.includes(id)) return;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 > 60 * 60) return;
    p.profile.collected.push(id);
    p.profile.stats.collected = p.profile.collected.length;
    const n = p.profile.collected.length, total = this.world.collectibles.length;
    const reward = 150 + (n % 10 === 0 ? 1000 : 0) + (n === total ? 10000 : 0);
    p.profile.money += reward;
    this.storage.touch();
    this.sendMe(p);
    this.sendTo(p, { t: 'collected', id, n, total, reward });
    if (n === total) this.broadcast({ t: 'chat', sys: true, m: `${p.name} found every sprite in Haven Bay!` });
  }

  // ------------------------------------------------------------ chat & misc
  onChat(p, m) {
    let text = typeof m.m === 'string' ? m.m.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160) : '';
    if (!text) return;
    if (this.now - p.chatT < 0.8) return;
    p.chatT = this.now;
    if (text.startsWith('/')) return this.command(p, text);
    text = text.replace(BAD_WORDS, (w) => '*'.repeat(w.length));
    this.broadcast({ t: 'chat', id: p.id, n: p.name, m: text });
  }

  command(p, text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'help': return this.notify(p, 'Commands: /passive on|off, /stuck, /players, /time', 'info');
      case 'passive': return this.onPassive(p, args[0] !== 'off');
      case 'stuck': {
        if (p.vehicle) return this.notify(p, 'Get out of the vehicle first.', 'warn');
        const s = this.world.spawns[0];
        this.correct(p, s.x, s.y);
        return;
      }
      case 'players': return this.notify(p, [...this.players.values()].filter((q) => q.ready).map((q) => q.name).join(', '), 'info');
      case 'time': return this.notify(p, `It is ${String(Math.floor(this.hour)).padStart(2, '0')}:${String(Math.floor((this.hour % 1) * 60)).padStart(2, '0')} in Haven Bay.`, 'info');
      default: return this.notify(p, 'Unknown command. Try /help', 'warn');
    }
  }

  onPassive(p, on) {
    if (!this.config.pvp) { p.passive = true; return this.notify(p, 'This server is peaceful: no player fighting.', 'info'); }
    if (!on && p.wanted) return;
    if (this.now - p.lastHurt < 10 && on) return this.notify(p, 'Wait a few seconds after a fight.', 'warn');
    p.passive = on;
    this.notify(p, on ? 'Passive mode on: other players cannot hurt you.' : 'Passive mode off: player fights enabled.', on ? 'good' : 'warn');
    this.sendMe(p);
    this.sendInfo(p);
  }

  onAppearance(p, m) {
    // only applied at the tailor (cost handled in buy) or on join
    if (!p.pendingMakeover) return;
    p.pendingMakeover = false;
    p.app = p.profile.app = sanitizeAppearance(m.app);
    this.sendInfo(p);
    this.storage.touch();
  }

  onCallCar(p, i) {
    const car = p.profile.cars[i];
    if (!car || p.vehicle) return;
    if (this.now - (p.lastCall || -99) < 20) return this.notify(p, 'Your car is on its way already.', 'info');
    p.lastCall = this.now;
    for (const v of this.vehicles.values()) if (v.owner === p.id && v.kind === 'owned') this.removeVehicle(v.id);
    // find a road spot near the player
    const net = this.traffic.net;
    let best = null, bd = 1e18;
    for (const e of net.edges) {
      const [mx, my] = net.edgeMid[e.id];
      const d = (mx - p.x) ** 2 + (my - p.y) ** 2;
      if (d < bd && d > 40 * 40) {
        const L = net.lane(e, 1, 0);
        const s = clamp((p.x - L.x0) * L.dx + (p.y - L.y0) * L.dy, 10, L.len - 10);
        const x = L.x0 + L.dx * s, y = L.y0 + L.dy * s;
        const dd = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (dd < bd) { bd = dd; best = [x, y, L.a]; }
      }
    }
    if (!best || bd > 500 * 500) return this.notify(p, 'No road nearby for delivery.', 'warn');
    const v = this.spawnVehicle(VEH_ID[car.model] ?? 0, best[0], best[1], best[2], { kind: 'owned', color: car.color | 0 });
    v.owner = p.id;
    this.notify(p, 'Your car has been dropped off nearby.', 'good');
    this.sendTo(p, { t: 'mark', x: v.x, y: v.y, k: 'car', ttl: 20 });
  }

  onJob(p, m) {
    if (m.a === 'cancel') return this.jobs.end(p, true);
    if (m.a === 'race') {
      const r = this.jobs.races[m.r | 0];
      if (!r || !p.vehicle) return;
      const ref = this.vehicles.get(p.vehicle);
      if (!ref || Math.hypot(ref.x - r.cps[0][0], ref.y - r.cps[0][1]) > 110) return;
      return this.jobs.start(p, 'race', { race: m.r | 0 });
    }
    if (m.a === 'taxi' && p.vehicle) {
      const v = this.vehicles.get(p.vehicle);
      if (v && v.model === VEH_ID.taxi) return this.jobs.start(p, 'taxi', { poi: { x: v.x, y: v.y } });
    }
  }

  nearPoi(p, type, r = 70) {
    for (const poi of this.world.pois) if (poi.type === type && (poi.x - p.x) ** 2 + (poi.y - p.y) ** 2 < r * r) return poi;
    return null;
  }

  onBuy(p, m) {
    const shop = String(m.shop);
    const item = findItem(shop, String(m.item));
    if (!item) return;
    const poiType = shop;
    const ref = p.vehicle ? this.vehicles.get(p.vehicle) : p;
    const poi = this.nearPoi(ref || p, poiType, SHOPS[shop].needsCar ? 110 : 80);
    if (!poi) return this.notify(p, 'You need to be at the shop.', 'warn');
    const prof = p.profile;
    if (prof.money < item.price) return this.notify(p, 'Not enough cash.', 'warn');
    const v = p.vehicle ? this.vehicles.get(p.vehicle) : null;
    const charge = () => { prof.money -= item.price; this.storage.touch(); };
    const id = item.id;
    if (id.startsWith('w:')) {
      const w = WEAPONS[WEAPON_ID[id.slice(2)]];
      if (prof.weapons[w.key] && w.kind === 'melee') return this.notify(p, 'You already have that.', 'info');
      charge();
      prof.weapons[w.key] = 1;
      if (w.kind !== 'melee') prof.ammo[w.key] = Math.min(999, (prof.ammo[w.key] || 0) + (w.ammoPack || 0));
      this.notify(p, `Bought ${w.name}.`, 'good');
    } else if (id.startsWith('a:')) {
      const w = WEAPONS[WEAPON_ID[id.slice(2)]];
      if (!prof.weapons[w.key]) return this.notify(p, `You need a ${w.name} first.`, 'warn');
      charge();
      prof.ammo[w.key] = Math.min(999, (prof.ammo[w.key] || 0) + w.ammoPack);
    } else if (id === 'armor') {
      if (prof.armor >= 100) return this.notify(p, 'Your armor is already full.', 'info');
      charge(); prof.armor = 100;
    } else if (item.heal) {
      if (p.hp >= 100) return this.notify(p, 'You feel great already!', 'info');
      charge(); p.hp = Math.min(100, p.hp + item.heal);
      this.sendTo(p, { t: 'sfx', k: 'eat' });
    } else if (id === 'makeover') {
      charge(); p.pendingMakeover = true;
      this.sendTo(p, { t: 'makeover' });
    } else if (id === 'respray') {
      if (!v) return this.notify(p, 'Drive in with a vehicle first.', 'warn');
      charge();
      v.color = (v.color + 1 + Math.floor(Math.random() * (PAINTS.length - 1))) % PAINTS.length;
      if (m.color !== undefined && Number.isInteger(m.color) && m.color >= 0 && m.color < PAINTS.length) v.color = m.color;
      this.sendInfo(v);
      if (v.kind === 'owned') { const car = prof.cars.find((c) => c.model === VEHICLES[v.model].key); if (car) car.color = v.color; }
      this.police.clear(p);
      this.notify(p, 'Fresh paint! The police lost track of you.', 'good');
    } else if (id === 'repair') {
      if (!v) return this.notify(p, 'Drive in with a vehicle first.', 'warn');
      charge(); v.hp = v.maxHp; v.burn = 0; v.flags &= ~(16 | 32);
      this.sendTo(p, { t: 'repaired', v: v.id });
      this.notify(p, 'Good as new.', 'good');
    } else if (id.startsWith('car:')) {
      const key = id.slice(4);
      if (prof.cars.some((c) => c.model === key)) return this.notify(p, 'You already own one. Press G to call it.', 'info');
      if (prof.cars.length >= 8) return this.notify(p, 'Your garage is full.', 'warn');
      charge();
      prof.cars.push({ model: key, color: Number.isInteger(m.color) ? clamp(m.color, 0, PAINTS.length - 1) : Math.floor(Math.random() * PAINTS.length) });
      this.notify(p, `You bought a ${VEHICLES[VEH_ID[key]].name}! Press G to call it anytime.`, 'good');
      this.sendMe(p);
      this.onCallCar(p, prof.cars.length - 1);
    } else if (id === 'job:pizza') {
      return this.jobs.start(p, 'pizza', { poi });
    } else if (id === 'job:taxi') {
      return this.jobs.start(p, 'taxi', { poi });
    } else if (id === 'arcade') {
      charge();
      const win = Math.random() < 0.35 ? [10, 20, 30, 60][Math.floor(Math.random() * 4)] : 0;
      prof.money += win;
      this.notify(p, win ? `High score! You won $${win}.` : 'So close! Better luck next time.', win ? 'good' : 'info');
    } else if (id === 'board') {
      return this.sendTo(p, { t: 'boards', races: this.jobs.races.map((r) => ({ id: r.id, name: r.name })), boards: this.storage.leaderboards, top: this.topPlayers() });
    }
    this.sendMe(p);
    this.sendTo(p, { t: 'bought', item: id });
  }

  topPlayers() {
    const all = [...this.storage.profiles.values()];
    const by = (f) => all.slice().sort((a, b) => f(b) - f(a)).slice(0, 8).map((q) => ({ name: q.name, v: f(q) }));
    return { money: by((q) => q.money), sprites: by((q) => q.collected.length), deliveries: by((q) => q.stats.deliveries + q.stats.fares) };
  }

  // ------------------------------------------------------------ life & death
  knockout(p, attacker, weapon) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    if (p.vehicle) this.ejectPlayer(p, true);
    p.mode = MODE.KO;
    p.respawnAt = this.now + 4.5;
    p.koBy = attacker ? attacker.name : null;
    const loss = Math.min(200, Math.floor(p.profile.money * 0.05));
    p.profile.money -= loss;
    p.koLoss = loss;
    if (p.job && p.job.kind !== 'race') this.jobs.end(p, true);
    this.event({ e: 'ko', p: p.id, by: attacker ? attacker.id : 0, w: weapon }, p.x, p.y, 1500);
    this.sendTo(p, { t: 'ko', by: p.koBy, loss, w: weapon });
    if (attacker && attacker !== p) this.notify(attacker, `You knocked out ${p.name}.`, 'info');
    this.police.clear(p);
  }

  bust(p) {
    if (!p.alive) return;
    if (p.vehicle) this.ejectPlayer(p, true);
    const loss = Math.min(500, Math.floor(p.profile.money * 0.1));
    p.profile.money -= loss;
    this.police.clear(p);
    if (p.job) this.jobs.end(p, false);
    const s = this.policeSpawns[Math.floor(Math.random() * this.policeSpawns.length)];
    p.hp = Math.max(p.hp, 50);
    p.spawnShield = this.now + 4;
    this.correct(p, s.x, s.y);
    this.sendTo(p, { t: 'busted', loss });
    this.sendMe(p);
    for (const n of this.peds.values()) if (n.cop && n.chase === p.id) n.chase = 0;
  }

  respawn(p) {
    const s = this.clinics.reduce((best, c) => (!best || (c.x - p.x) ** 2 + (c.y - p.y) ** 2 < (best.x - p.x) ** 2 + (best.y - p.y) ** 2 ? c : best), null) || this.world.spawns[0];
    p.alive = true;
    p.hp = 100;
    p.mode = MODE.WALK;
    p.spawnShield = this.now + 5;
    this.correct(p, s.x, s.y);
    this.sendTo(p, { t: 'respawn', x: s.x, y: s.y, tp: p.tp });
    this.sendMe(p);
  }

  // ------------------------------------------------------------ world state
  wInfo() {
    const w = this.weather;
    return { cloud: Math.round(w.cloud * 100) / 100, rain: Math.round(w.rain * 100) / 100, storm: Math.round(w.storm * 100) / 100 };
  }
  broadcastWorld() { this.broadcast({ t: 'world', time: this.now, hour: this.hour, weather: this.wInfo() }); }

  updateWeather(dt) {
    const w = this.weather;
    w.next -= dt;
    if (w.next <= 0) {
      w.next = 300 + Math.random() * 420;
      const r = Math.random();
      if (r < 0.5) w.target = { cloud: 0.1 + Math.random() * 0.25, rain: 0, storm: 0 };
      else if (r < 0.72) w.target = { cloud: 0.55 + Math.random() * 0.3, rain: 0, storm: 0 };
      else if (r < 0.93) w.target = { cloud: 0.8, rain: 0.6 + Math.random() * 0.4, storm: 0 };
      else w.target = { cloud: 0.95, rain: 1, storm: 1 };
    }
    const k = Math.min(1, dt / 40);
    w.cloud += (w.target.cloud - w.cloud) * k;
    w.rain += (w.target.rain - w.rain) * k;
    w.storm += (w.target.storm - w.storm) * k;
    if (w.storm > 0.6 && Math.random() < dt * 0.06) {
      this.broadcast({ t: 'thunder', x: Math.random(), y: Math.random(), d: 0.5 + Math.random() * 2.5 });
    }
  }

  tick() {
    const t = performance.now();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    this.step(dt);
  }

  step(dt) {
    this.now += dt;
    // spatial grid of dynamic things
    this.grid.clear();
    for (const p of this.players.values()) if (p.ready && !p.vehicle && p.alive) this.grid.add({ kind: 'player', x: p.x, y: p.y, ref: p });
    for (const v of this.vehicles.values()) this.grid.add({ kind: 'veh', x: v.x, y: v.y, ref: v });
    for (const n of this.peds.values()) if (n.state !== PS.KO && n.state !== PS.OUT) this.grid.add({ kind: 'ped', x: n.x, y: n.y, ref: n });

    this.traffic.update(dt, this.now);
    this.pedAI.update(dt, this.now);
    this.police.update(dt);
    this.combat.update(dt);
    this.jobs.update(dt);
    this.voice.update(dt);
    this.updateWeather(dt);

    // loose vehicles: integrate unoccupied cars knocked by explosions
    for (const v of this.vehicles.values()) {
      if (v.driverId || (v.ai && v.ai.mode !== 'dead')) continue;
      if (Math.abs(v.vx) + Math.abs(v.vy) > 1) {
        v.x += v.vx * dt; v.y += v.vy * dt; v.a += (v.av || 0) * dt;
        const k = Math.exp(-2.5 * dt);
        v.vx *= k; v.vy *= k; v.av = (v.av || 0) * k;
      }
      if (v.kind === 'job' && v.expire && this.now > v.expire && !this.anyPlayerSees(v.x, v.y)) this.removeVehicle(v.id);
    }
    // parked cars near players
    this.populateParked();
    for (const p of this.players.values()) {
      if (!p.ready) continue;
      if (!p.alive && this.now >= p.respawnAt) this.respawn(p);
      if (p.alive && p.hp < 100 && this.now - (p.lastHurt || 0) > 12) p.hp = Math.min(100, p.hp + dt * 1.2);
      if (p.firingT > 0) p.firingT -= dt;
    }
    for (const pk of this.pickups) {
      if (!pk.active && this.now >= pk.respawn) {
        pk.active = true;
        this.event({ e: 'pk', id: pk.id, on: true }, pk.x, pk.y, 1600);
      }
    }
    for (const [id, c] of this.cashDrops) if (this.now > c.until) { this.cashDrops.delete(id); this.event({ e: 'cashgone', id }, c.x, c.y, 1000); }
    for (const [i, until] of this.broken) {
      if (this.now < until) continue;
      const prop = this.world.props[i];
      if (this.anyPlayerSees(prop[1], prop[2], 500)) continue;
      this.broken.delete(i);
      for (const s of this.cw.shapesNear(prop[1], prop[2], 4, [])) if (s.prop === i) s.alive = true;
      this.event({ e: 'prop', i, on: true }, prop[1], prop[2], 3000);
    }
    this.sendSnapshots();
  }

  populateParked() {
    this.parkTimer = (this.parkTimer || 0) - TICK;
    if (this.parkTimer > 0) return;
    this.parkTimer = 1.5;
    const players = [...this.players.values()].filter((p) => p.ready);
    this.parked = this.parked || new Map();
    for (const [idx, vid] of this.parked) {
      const v = this.vehicles.get(vid);
      if (!v) { this.parked.delete(idx); continue; }
      if (v.kind !== 'parked') { this.parked.delete(idx); continue; }
      let near = false;
      for (const p of players) if ((p.x - v.x) ** 2 + (p.y - v.y) ** 2 < 1500 * 1500) { near = true; break; }
      if (!near) { this.removeVehicle(vid); this.parked.delete(idx); }
    }
    const spots = this.world.parking;
    for (const p of players) {
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        if (this.parked.has(i) || (s.x - p.x) ** 2 + (s.y - p.y) ** 2 > 1100 * 1100) continue;
        if (this.anyPlayerSees(s.x, s.y, 560)) continue;
        // deterministic occupancy per spot and hour so the city looks stable
        const hr = Math.floor(this.now / 600);
        const h = ((i * 2654435761 + hr * 97) >>> 0) / 4294967296;
        if (h > (s.p ?? 0.5)) { this.parked.set(i, 0); continue; }
        if (this.vehicleNear(s.x, s.y, 20)) continue;
        let key = ['sedan', 'compact', 'pickup', 'van', 'offroad', 'sports', 'muscle', 'scooter'][Math.floor(h * 1000) % 8];
        if (s.d === 'police') key = 'police';
        if (s.d === 'taxi') key = 'taxi';
        if (s.d === 'dealer') key = ['sports', 'muscle', 'offroad', 'sedan'][i % 4];
        const v = this.spawnVehicle(VEH_ID[key], s.x, s.y, s.a, { kind: 'parked', color: Math.floor(h * 7919) % PAINTS.length });
        this.parked.set(i, v.id);
      }
    }
    for (const [idx, vid] of this.parked) if (vid === 0 && Math.random() < 0.02) this.parked.delete(idx);
  }

  sendSnapshots() {
    const R = VIEW_RADIUS, R2 = R * R;
    const evs = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      if (!p.ready || p.ws.readyState !== 1) continue;
      const cx = p.x, cy = p.y;
      const pl = [], vl = [], nl = [], jl = [];
      const info = { p: [], v: [], n: [] };
      for (const o of this.players.values()) {
        if (o === p || !o.ready) continue;
        if ((o.x - cx) ** 2 + (o.y - cy) ** 2 > R2) continue;
        pl.push(o);
        if (p.known.p.get(o.id) !== o.info) { p.known.p.set(o.id, o.info); info.p.push({ id: o.id, name: o.name, app: o.app, passive: o.passive }); }
      }
      for (const v of this.vehicles.values()) {
        if (p.vehicle === v.id) continue;
        if ((v.x - cx) ** 2 + (v.y - cy) ** 2 > R2) continue;
        vl.push(v);
        if (p.known.v.get(v.id) !== v.info) { p.known.v.set(v.id, v.info); info.v.push({ id: v.id, m: v.model, c: v.color, k: v.kind, d: v.dead ? 1 : 0, o: v.owner }); }
      }
      for (const n of this.peds.values()) {
        if ((n.x - cx) ** 2 + (n.y - cy) ** 2 > R2) continue;
        nl.push(n);
        if (p.known.n.get(n.id) !== n.info) { p.known.n.set(n.id, n.info); info.n.push({ id: n.id, s: n.seed, c: n.cop ? 1 : 0, t: n.taxiFor === p.id ? 1 : 0 }); }
      }
      for (const j of this.projs.values()) if ((j.x - cx) ** 2 + (j.y - cy) ** 2 < R2) jl.push(j);
      if (info.p.length || info.v.length || info.n.length) this.send(p.ws, { t: 'info', ...info });
      const mine = [];
      for (const ev of evs) {
        if (ev.except === p.id) continue;
        if ((ev.x - cx) ** 2 + (ev.y - cy) ** 2 > ev.r * ev.r) continue;
        mine.push(ev.data);
      }
      if (mine.length) this.send(p.ws, { t: 'ev', e: mine });
      // driver ids: players as-is, NPC drivers flagged
      for (const v of vl) v.drv = v.driverId && v.driverId < NPC_DRIVER ? v.driverId : (v.npcDriver ? NPC_DRIVER : 0);
      const players = pl.map((o) => ({ id: o.id, x: o.x, y: o.y, a: o.a, mode: o.mode, vehicle: o.vehicle, weapon: o.weapon, flags: o.flags | (o.firingT > 0 ? PF.FIRING : 0), hp: o.hp, aim: o.aim }));
      p.ws.send(encodeSnapshot(this.now, players, vl, nl, jl));
    }
    // forget entities for which no client holds info anymore (bounded memory)
    if (Math.random() < 0.02) {
      for (const p of this.players.values()) {
        for (const [id] of p.known.v) if (!this.vehicles.has(id)) p.known.v.delete(id);
        for (const [id] of p.known.n) if (!this.peds.has(id)) p.known.n.delete(id);
        for (const [id] of p.known.p) if (!this.players.has(id)) p.known.p.delete(id);
      }
    }
  }
}

void ARMOR_PRICE; void POI;
