import { F, TILE, clamp, wrapAngle, lerpAngle } from '/shared/constants.js';
import { WEAPONS, WEAPON_ID } from '/shared/weapons.js';
import { VEHICLES } from '/shared/vehicles.js';
import { stepCar, collideCars, circleVsCar } from '/shared/carphysics.js';
import { obbVsObb } from '/shared/collision.js';
import { MODE, PF, VF, PED_STATE } from '/shared/protocol.js';

const WALK = 74, RUN = 122, RADIUS = 4.5;

// The locally controlled character and (when driving) its vehicle. Movement is simulated
// here and sent to the server, which validates it.
export class Local {
  constructor(game) {
    this.g = game;
    this.id = 0;
    this.x = 0; this.y = 0; this.a = 0; this.aim = 0;
    this.vx = 0; this.vy = 0;
    this.mode = 'walk';
    this.tp = 1;
    this.car = null;
    this.weapon = 0;
    this.clip = {};
    this.reloadT = 0;
    this.fireT = 0;
    this.meleeT = 0;
    this.punchSide = 0;
    this.anim = { phase: 0, punch: 0, swing: 0, throw: 0, hit: 0, wave: 0 };
    this.stats = { hp: 100, armor: 0, money: 0, wanted: 0, weapons: { fists: 1 }, ammo: {}, passive: true, collected: 0, cars: [] };
    this.sendT = 0;
    this.knockV = null;
    this.stepT = 0;
    this.aimingT = 0;
    this.charge = 0;
    this.pendingEnter = 0;
    this.lastCrash = 0;
    this.hitPeds = new Map();
    this.lights = false;
    this.siren = false;
    this.horn = false;
    this.koT = 0;
    this._res = {};
    this._contacts = [];
  }

  get alive() { return this.mode !== 'ko'; }
  get w() { return WEAPONS[this.weapon]; }

  ownedWeapons() {
    return WEAPONS.filter((w) => w.key === 'fists' || this.stats.weapons[w.key]).map((w) => w.id);
  }
  ammoTotal(w) { return this.stats.ammo[w.key] || 0; }
  clipOf(w) {
    if (w.kind === 'melee') return Infinity;
    if (this.clip[w.key] === undefined) this.clip[w.key] = Math.min(w.clip, this.ammoTotal(w));
    return Math.min(this.clip[w.key], this.ammoTotal(w));
  }

  selectWeapon(id) {
    if (id === this.weapon) return;
    const owned = this.ownedWeapons();
    if (!owned.includes(id)) return;
    this.weapon = id;
    this.reloadT = 0;
    this.g.audio.play('reload', undefined, undefined, { bus: 'ui' });
    this.g.ui.weaponChanged?.();
  }
  cycleWeapon(dir) {
    const owned = this.ownedWeapons();
    const i = owned.indexOf(this.weapon);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  onMe(m) {
    const prevMoney = this.stats.money;
    Object.assign(this.stats, m);
    if (!this.stats.weapons[WEAPONS[this.weapon].key] && this.weapon !== 0) this.weapon = 0;
    return m.money - prevMoney;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const g = this.g;
    this.fireT -= dt;
    this.meleeT -= dt;
    for (const k of ['punch', 'swing', 'throw', 'hit', 'wave']) this.anim[k] = Math.max(0, this.anim[k] - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const w = this.w; this.clip[w.key] = Math.min(w.clip, this.ammoTotal(w)); }
    }
    if (this.mode === 'ko') { this.koT += dt; this.vx *= 0.9; this.vy *= 0.9; return; }
    if (this.mode === 'drive') this.drive(dt, input);
    else this.walk(dt, input);
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 0.05; this.sendState(); }
  }

  walk(dt, input) {
    const g = this.g;
    const cw = g.cw;
    let [mx, my] = input.move();
    if (g.ui.blocking) { mx = 0; my = 0; }
    const fpv = g.cam.fpv;
    if (fpv) {
      // W walks where you look, A and D strafe
      const yaw = g.cam.yaw, fwd = -my, side = mx;
      mx = fwd * Math.cos(yaw) - side * Math.sin(yaw);
      my = fwd * Math.sin(yaw) + side * Math.cos(yaw);
    }
    const terr = cw.terrainInfo(this.x, this.y);
    const running = input.is('run') && !g.ui.blocking;
    let speed = (running ? RUN : WALK) * (terr.walk || 1);
    const swim = terr.surf === 'water' && (cw.flagsAt(this.x, this.y) & F.SHALLOW);
    if (swim) speed *= 0.8;
    const tvx = mx * speed, tvy = my * speed;
    const k = 1 - Math.exp(-dt * 16);
    this.vx += (tvx - this.vx) * k;
    this.vy += (tvy - this.vy) * k;
    if (this.knockV) {
      this.vx += this.knockV[0]; this.vy += this.knockV[1];
      this.knockV = null;
    }
    const r = cw.moveCircle(this.x, this.y, this.vx * dt, this.vy * dt, RADIUS, F.WALK, this._res);
    this.x = r.x; this.y = r.y;
    // push out of vehicles and other people
    for (const v of g.nearVehicles(this.x, this.y, 60)) {
      const m = VEHICLES[v.model];
      const hit = circleVsCar(this.x, this.y, RADIUS, v, m);
      if (hit) {
        this.x += hit.nx * hit.depth; this.y += hit.ny * hit.depth;
        const sp = Math.hypot(v.vx, v.vy);
        if (sp > 80 && v.driver && v.driver !== this.id) this.knockV = [v.vx * 0.5, v.vy * 0.5];
      }
    }
    for (const o of g.nearPeople(this.x, this.y, 20)) {
      const dx = this.x - o.x, dy = this.y - o.y, d = Math.hypot(dx, dy);
      if (d > 0.01 && d < 9) { this.x += (dx / d) * (9 - d) * 0.5; this.y += (dy / d) * (9 - d) * 0.5; }
    }
    const moving = Math.hypot(this.vx, this.vy) > 8;
    // aim: mouse, gamepad stick, or movement direction
    const padAim = input.padAim();
    const w = this.w;
    let aiming = false;
    if (fpv) {
      this.aim = g.cam.yaw;
      this.a = g.cam.yaw;
      if (w.kind !== 'melee' || input.mouse.left || input.mouse.right) aiming = true;
    } else if (padAim !== null) { this.aim = padAim; aiming = true; this.aimingT = 0.6; }
    else if (input.lastDevice === 'kb') {
      const [wx, wy] = g.cam.screenToWorld(input.mouse.x, input.mouse.y, 10);
      this.aim = Math.atan2(wy - this.y, wx - this.x);
      if (w.kind !== 'melee' || input.mouse.left || input.mouse.right) aiming = true;
    }
    if (aiming) this.aimingT = 0.5; else this.aimingT -= dt;
    if (this.aimingT > 0 || this.anim.punch > 0 || this.anim.swing > 0) this.a = lerpAngle(this.a, this.aim, Math.min(1, dt * 22));
    else if (moving) this.a = lerpAngle(this.a, Math.atan2(this.vy, this.vx), Math.min(1, dt * 12));
    this.moving = moving;
    this.running = running && moving;
    this.swim = swim;
    if (moving) {
      this.anim.phase += dt * Math.hypot(this.vx, this.vy) / 13;
      this.stepT -= dt * Math.hypot(this.vx, this.vy) / 30;
      if (this.stepT <= 0) {
        this.stepT = 1;
        g.audio.play('step', this.x, this.y, { surf: terr.surf, gain: running ? 1 : 0.7 });
        if (running && (terr.surf === 'sand' || terr.surf === 'dirt')) g.fx.p.dust(this.x, this.y);
        if (swim) g.fx.p.splash(this.x, this.y, 0.4);
      }
    }
    if (!g.ui.blocking) this.combat(dt, input);
  }

  combat(dt, input) {
    const g = this.g;
    const w = this.w;
    if (input.mouse.wheel) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
    if (input.hit('nextWeapon')) this.cycleWeapon(1);
    if (input.hit('prevWeapon')) this.cycleWeapon(-1);
    const owned = this.ownedWeapons();
    for (let i = 1; i <= 9; i++) if (input.hit('weapon' + i) && owned[i - 1] !== undefined) this.selectWeapon(owned[i - 1]);
    if (input.hit('reload')) this.reload();
    const trigger = input.mouse.left || input.padTrigger(7) > 0.5;
    const triggerHit = input.mouse.leftPressed || (input.padTrigger(7) > 0.5 && !this.padHeld);
    this.padHeld = input.padTrigger(7) > 0.5;
    if (input.hit('wave')) { this.anim.wave = 1.6; g.net.send({ t: 'emote', k: 'wave' }); }
    if (w.kind === 'melee') {
      if (triggerHit && this.meleeT <= 0) this.melee(w);
    } else if (w.kind === 'gun') {
      if ((w.auto ? trigger : triggerHit) && this.fireT <= 0 && this.reloadT <= 0) {
        if (this.clipOf(w) <= 0) {
          if (triggerHit) g.audio.play('empty', this.x, this.y);
          if (this.ammoTotal(w) > 0) this.reload();
        } else this.fire(w);
      }
    } else if (w.kind === 'proj') {
      if (w.thrown) {
        if (trigger && this.fireT <= 0 && this.ammoTotal(w) > 0) this.charge = Math.min(1, this.charge + dt * 1.3);
        else if (this.charge > 0) { this.throwProj(w, 0.3 + this.charge * 0.7); this.charge = 0; }
      } else if (triggerHit && this.fireT <= 0 && this.reloadT <= 0) {
        if (this.ammoTotal(w) > 0) this.throwProj(w, 1);
        else g.audio.play('empty', this.x, this.y);
      }
    }
  }

  reload() {
    const w = this.w;
    if (w.kind !== 'gun' || this.reloadT > 0) return;
    if (this.clipOf(w) >= w.clip || this.ammoTotal(w) <= this.clipOf(w)) return;
    this.reloadT = w.reload;
    this.g.audio.play('reload', this.x, this.y);
  }

  muzzle() {
    return [this.x + Math.cos(this.aim) * 9, this.y + Math.sin(this.aim) * 9];
  }

  // Client-side hit detection; the server validates range, line of sight and rate.
  fire(w) {
    const g = this.g;
    this.fireT = w.rate;
    this.clip[w.key] = this.clipOf(w) - 1;
    this.stats.ammo[w.key] = Math.max(0, this.ammoTotal(w) - 1);
    const [ox, oy] = this.mode === 'drive' ? [this.car.x, this.car.y] : this.muzzle();
    const hits = [], ends = [];
    const moveSpread = Math.min(1, Math.hypot(this.vx, this.vy) / RUN) * 0.06;
    for (let i = 0; i < w.pellets; i++) {
      const a = this.aim + (Math.random() - 0.5) * 2 * (w.spread + moveSpread);
      const ex = ox + Math.cos(a) * w.range, ey = oy + Math.sin(a) * w.range;
      const wall = g.cw.raycast(ox, oy, ex, ey, F.SHOT, this._res);
      let best = wall.t, hit = null;
      const dx = ex - ox, dy = ey - oy;
      g.forTargets(ox, oy, w.range, (k, e, r) => {
        const t = rayCircle(ox, oy, dx, dy, e.x, e.y, r);
        if (t !== null && t < best) { best = t; hit = { k, id: e.id, x: ox + dx * t, y: oy + dy * t }; }
      }, (v) => {
        if (this.car && v.id === this.car.id) return;
        const m = VEHICLES[v.model];
        const t = rayObb(ox, oy, dx, dy, v.x, v.y, v.a, m.len / 2, m.wid / 2);
        if (t !== null && t < best) { best = t; hit = { k: 'v', id: v.id, x: ox + dx * t, y: oy + dy * t }; }
      });
      const hx = ox + dx * best, hy = oy + dy * best;
      ends.push([Math.round(hx), Math.round(hy)]);
      if (hit) hits.push(hit);
      g.fx.tracer(ox, oy, hx, hy, hit ? hit.k : best < 1 ? 'wall' : null);
    }
    g.net.send({ t: 'fire', w: w.id, x: ox, y: oy, a: this.aim, h: hits, e: ends });
    g.fx.shot(this, w, ox, oy, this.aim, true);
    this.anim.hit = 0.08;
  }

  melee(w) {
    const g = this.g;
    this.meleeT = w.rate;
    if (w.key === 'fists') { this.anim.punch = 0.22; this.punchSide ^= 1; } else this.anim.swing = 0.3;
    const reach = w.range + 8;
    const hits = [];
    g.forTargets(this.x, this.y, reach + 20, (k, e, r) => {
      const dx = e.x - this.x, dy = e.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > reach + r) return;
      const ad = Math.abs(wrapAngle(Math.atan2(dy, dx) - this.aim));
      if (ad > w.arc / 2 + 0.2) return;
      if (hits.length < 2) hits.push({ k, id: e.id, x: e.x, y: e.y });
    }, (v) => {
      if (hits.length >= 2) return;
      const m = VEHICLES[v.model];
      const px = this.x + Math.cos(this.aim) * reach, py = this.y + Math.sin(this.aim) * reach;
      if (circleVsCar(px, py, 6, v, m)) hits.push({ k: 'v', id: v.id, x: px, y: py });
    });
    g.net.send({ t: 'melee', w: w.id, x: this.x, y: this.y, a: this.aim, h: hits });
    g.audio.play('whoosh', this.x, this.y);
    if (hits.length) {
      const h = hits[0];
      g.audio.play(w.key === 'bat' ? 'batHit' : 'punch', h.x, h.y);
      g.fx.p.hitPuff(h.x, h.y, 10, [1, 1, 0.9]);
      g.hitStop(w.key === 'bat' ? 0.09 : 0.05);
      g.shake(w.key === 'bat' ? 0.22 : 0.15);
    }
  }

  throwProj(w, power) {
    const g = this.g;
    this.fireT = w.rate;
    this.stats.ammo[w.key] = Math.max(0, this.ammoTotal(w) - 1);
    if (w.thrown) this.anim.throw = 0.35; else this.reloadT = w.reload;
    const [ox, oy] = this.muzzle();
    g.net.send({ t: 'proj', w: w.id, x: ox, y: oy, a: this.aim, pw: power });
    g.fx.shot(this, w, ox, oy, this.aim, true);
  }

  // ------------------------------------------------------------------ vehicles
  tryEnter() {
    const g = this.g;
    if (this.pendingEnter > performance.now()) return true;
    let best = null, bd = 1e9;
    for (const v of g.nearVehicles(this.x, this.y, 70)) {
      if (v.dead) continue;
      const m = VEHICLES[v.model];
      const d = Math.hypot(v.x - this.x, v.y - this.y) - m.len * 0.35;
      if (d < 26 && d < bd) { bd = d; best = v; }
    }
    if (best) {
      this.pendingEnter = performance.now() + 600;
      g.net.send({ t: 'enter', v: best.id });
      return true;
    }
    return false;
  }

  onDrive(m) {
    const g = this.g;
    const info = g.state.vehicles.info.get(m.v);
    const model = info ? info.m : 1;
    const [x, y, a, vx, vy, av, hp] = m.st;
    this.car = { id: m.v, model, color: info ? info.c : 0, x, y, a, vx, vy, av, hp, steer: 0, slip: 0, speed: 0, throttle: 0 };
    this.mode = 'drive';
    this.tp = m.tp;
    this.x = x; this.y = y;
    this.pendingEnter = 0;
    g.audio.play('door', x, y);
    g.onEnterCar(this.car);
  }

  exitCar() {
    const g = this.g;
    const c = this.car;
    if (!c) return;
    const m = VEHICLES[c.model];
    const cs = Math.cos(c.a), sn = Math.sin(c.a);
    let ex = c.x, ey = c.y;
    for (const side of [-1, 1]) {
      const x = c.x + sn * (m.wid / 2 + 8) * side, y = c.y - cs * (m.wid / 2 + 8) * side;
      if (g.cw.circleFree(x, y, 5, F.WALK)) { ex = x; ey = y; break; }
    }
    g.net.send({ t: 'exit', x: ex, y: ey });
    this.leaveCar(ex, ey);
    g.audio.play('door', c.x, c.y);
  }

  leaveCar(x, y) {
    if (!this.car) return;
    const c = this.car;
    this.g.onLeaveCar(c);
    this.car = null;
    this.mode = 'walk';
    this.x = x; this.y = y;
    this.vx = c.vx * 0.15; this.vy = c.vy * 0.15;
  }

  drive(dt, input) {
    const g = this.g;
    const c = this.car;
    const m = VEHICLES[c.model];
    let [mx] = input.move();
    let throttle = input.is('up') ? 1 : 0;
    let brake = input.is('down') ? 1 : 0;
    if (input.gamepad) {
      throttle = Math.max(throttle, input.padTrigger(7));
      brake = Math.max(brake, input.padTrigger(6));
    }
    let hb = input.is('handbrake');
    if (g.ui.blocking) { throttle = 0; brake = 0; mx = 0; hb = false; }
    c.throttle = throttle;
    const events = [];
    const impact = stepCar(c, { throttle, brake, steer: mx, handbrake: hb }, m, dt, g.cw, events);
    if (this.knockV) { c.vx += this.knockV[0]; c.vy += this.knockV[1]; this.knockV = null; }
    for (const ev of events) if (ev.t === 'prop') g.breakPropLocal(ev.prop, ev.vx, ev.vy, true);
    // other vehicles: they are remote authorities; resolve ourselves and report a bump
    for (const v of g.nearVehicles(c.x, c.y, 90)) {
      if (v.id === c.id || v.dead && false) continue;
      const om = VEHICLES[v.model];
      const pvx = c.vx, pvy = c.vy;
      const imp = collideCars(c, m, { x: v.x, y: v.y, a: v.a, vx: v.vx, vy: v.vy, av: 0 }, om, false);
      if (imp > 0) {
        const dvx = (pvx - c.vx) * (m.mass / om.mass), dvy = (pvy - c.vy) * (m.mass / om.mass);
        if (!this.bumpT || performance.now() - this.bumpT > 120) {
          this.bumpT = performance.now();
          g.net.send({ t: 'bump', v: v.id, vx: dvx, vy: dvy, av: (Math.random() - 0.5) * imp * 0.01, i: imp });
        }
        if (imp > 30) this.crashFx(imp, (c.x + v.x) / 2, (c.y + v.y) / 2);
      }
    }
    if (impact > 30) this.crashFx(impact, c.x, c.y);
    // people
    const speed = Math.hypot(c.vx, c.vy);
    if (speed > 40) {
      g.forPeople(c.x, c.y, m.len, (k, e) => {
        if (k === 'p' && e.id === this.id) return;
        const hit = circleVsCar(e.x, e.y, 5, c, m);
        if (!hit) return;
        const key = k + e.id;
        const last = this.hitPeds.get(key) || 0;
        if (performance.now() - last < 1200) return;
        this.hitPeds.set(key, performance.now());
        g.net.send({ t: k === 'n' ? 'hitped' : 'runover', id: e.id, vx: c.vx * 0.8, vy: c.vy * 0.8 });
        g.audio.play('impactSoft', e.x, e.y);
        g.shake(0.12);
        c.vx *= 0.94; c.vy *= 0.94;
      });
    }
    // lights, horn, siren
    if (input.hit('lights')) this.lights = !this.lights;
    if (input.hit('siren') && m.siren) this.siren = !this.siren;
    const hornNow = input.is('horn') && !g.ui.blocking;
    if (hornNow && !this.horn) g.audio.play('horn', c.x, c.y, { truck: m.key === 'bus' || m.key === 'van', small: m.bike, dur: 0.3 });
    if (hornNow && m.jingle && !this.horn) g.audio.play('jingle', c.x, c.y);
    this.horn = hornNow;
    c.flags = (this.lights || g.night ? VF.LIGHTS : 0) | (c.braking ? VF.BRAKE : 0) | (this.siren ? VF.SIREN : 0) | (this.horn ? VF.HORN : 0) | (c.reversing ? VF.REVERSE : 0);
    // drive-by: pistol/smg toward the mouse
    const w = this.w;
    if ((w.key === 'pistol' || w.key === 'smg') && !g.ui.blocking) {
      if (g.cam.fpv) this.aim = g.cam.yaw;
      else {
        const [wx, wy] = g.cam.screenToWorld(input.mouse.x, input.mouse.y, 10);
        this.aim = Math.atan2(wy - c.y, wx - c.x);
      }
      const trigger = input.mouse.left;
      if ((w.auto ? trigger : input.mouse.leftPressed) && this.fireT <= 0 && this.reloadT <= 0 && this.clipOf(w) > 0) this.fire(w);
    }
    if (!g.ui.blocking) {
      if (input.mouse.wheel) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
      if (input.hit('nextWeapon')) this.cycleWeapon(1);
      if (input.hit('prevWeapon')) this.cycleWeapon(-1);
    }
    this.x = c.x; this.y = c.y; this.a = c.a;
    this.vx = c.vx; this.vy = c.vy;
    g.skids(c, m, true);
  }

  crashFx(impact, x, y) {
    const g = this.g;
    const now = performance.now();
    if (now - this.lastCrash < 180) return;
    this.lastCrash = now;
    g.audio.play(impact > 70 ? 'crash' : 'tock', x, y, { i: impact });
    g.shake(Math.min(0.6, impact / 300));
    if (impact > 90) g.hitStop(0.05);
    for (let i = 0; i < Math.min(10, impact / 20); i++) g.fx.p.spark(x, y, 6, Math.random() * 6.28, { speed: 120 });
    if (impact > 60) g.net.send({ t: 'crash', i: impact });
  }

  sendState() {
    const g = this.g;
    const flags = (this.moving ? PF.MOVING : 0) | (this.running ? PF.RUNNING : 0) | (this.aimingT > 0 && this.w.kind !== 'melee' ? PF.AIMING : 0) | (this.reloadT > 0 ? PF.RELOAD : 0) | (this.anim.wave > 0 ? PF.WAVE : 0);
    const s = [this.tp, round1(this.x), round1(this.y), round2(this.a), this.swim ? MODE.SWIM : MODE.WALK, flags, this.weapon, round2(this.aim), round1(this.vx), round1(this.vy)];
    if (this.car) {
      const c = this.car;
      s.push([round1(c.x), round1(c.y), round2(c.a), round1(c.vx), round1(c.vy), round2(c.av), round2(c.steer || 0), c.flags | 0, Math.round(c.slip || 0)]);
    }
    g.net.send({ t: 's', s });
  }
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 1000) / 1000;

function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
function rayObb(ox, oy, dx, dy, cx, cy, ang, hl, hw) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const lx = (ox - cx) * c + (oy - cy) * s, ly = -(ox - cx) * s + (oy - cy) * c;
  const ldx = dx * c + dy * s, ldy = -dx * s + dy * c;
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[lx, ldx, hl], [ly, ldy, hw]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return null; continue; }
    let a = (-h - p) / d, b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

export { rayCircle, rayObb };
void TILE; void clamp; void obbVsObb; void PED_STATE; void WEAPON_ID;
