import { VEHICLES } from '/shared/vehicles.js';
import { WEAPONS } from '/shared/weapons.js';
import { MODE, PF, VF, PED_STATE as PS, NPC_DRIVER } from '/shared/protocol.js';
import { randomAppearance } from '/shared/appearance.js';
import { FL } from '../gfx/sprites.js';
import { LIGHT_FLOATS } from '../gfx/renderer.js';
import { copAppearance } from './art-cache.js';

const WEAPON_POSE = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', rocket: 'rocket', grenade: 'grenade', bat: 'bat' };
const WALK_FRAMES = ['w0', 'w1', 'w2', 'w3'];
const SWING_FRAMES = ['s0', 'idle', 's2', 'idle'];

export function vehFlags(f) {
  return (f & VF.LIGHTS ? FL.LIGHTS : 0) | (f & VF.BRAKE ? FL.BRAKE : 0) | (f & VF.SIREN ? FL.SIREN : 0) | (f & VF.REVERSE ? FL.REVERSE : 0);
}

// Builds the per-frame list of dynamic sprite instances and lights.
export class SceneBuilder {
  constructor(game) {
    this.g = game;
    this.pedApps = new Map();
    this.lights = new Float32Array(LIGHT_FLOATS * 4096);
    this.nLights = 0;
  }

  pedApp(info) {
    const key = (info.c ? 'c' : 'n') + info.s;
    let a = this.pedApps.get(key);
    if (!a) { a = info.c ? copAppearance(info.s) : randomAppearance(info.s); this.pedApps.set(key, a); if (this.pedApps.size > 400) this.pedApps.clear(); }
    return a;
  }

  light(x, y, z, r, c, cone, occ = 0) {
    if (this.nLights >= 4000) return;
    const L = this.lights, o = this.nLights * LIGHT_FLOATS;
    L[o] = x; L[o + 1] = y; L[o + 2] = z; L[o + 3] = r;
    L[o + 4] = c[0]; L[o + 5] = c[1]; L[o + 6] = c[2]; L[o + 7] = occ;
    if (cone) { L[o + 8] = cone[0]; L[o + 9] = cone[1]; L[o + 10] = cone[2]; L[o + 11] = cone[3]; }
    else { L[o + 8] = 0; L[o + 9] = 0; L[o + 10] = -2; L[o + 11] = 0; }
    this.nLights++;
  }

  character(dyn, app, x, y, a, o = {}) {
    const art = this.g.art;
    const c = art.character(app);
    const flags = o.hit ? FL.HIT : 0;
    if (o.ko) { dyn.stack(art.ko(c), x, y, 0, a, { flags }); return; }
    const z = o.z || 0;
    dyn.stack(art.lower(c, o.lower || 'idle'), x, y, z, a, { flags, alpha: o.alpha });
    dyn.stack(art.upper(c, o.upper || 'idle'), x, y, z, a, { flags, alpha: o.alpha });
  }

  upperFor(weaponKey, s) {
    if (s.wave > 0) return 'wave';
    if (s.punch > 0) return 'punch';
    if (s.swing > 0) return 'batswing';
    if (s.throw > 0) return 'throw';
    const wp = WEAPON_POSE[weaponKey];
    if (wp) return wp;
    if (s.aiming) return 'fists';
    if (s.moving) return SWING_FRAMES[Math.floor(s.phase) % 4];
    return 'idle';
  }

  build(dyn, dt, view, time) {
    const g = this.g;
    const st = g.state;
    const L = g.local;
    const tod = g.tod;
    this.nLights = 0;
    const [x0, y0, x1, y1] = view;
    const inView = (x, y, m = 80) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    const night = tod.streetLights;

    // ---------------------------------------------------------------- local player
    if (L.mode === 'walk' || L.mode === 'ko') {
      const w = WEAPONS[L.weapon];
      const upper = this.upperFor(w.key, { punch: L.anim.punch, swing: L.anim.swing, throw: L.anim.throw, wave: L.anim.wave, aiming: L.aimingT > 0, moving: L.moving, phase: L.anim.phase });
      const lower = L.moving ? WALK_FRAMES[Math.floor(L.anim.phase) % 4] : 'idle';
      const aimA = L.aimingT > 0 || L.anim.punch || L.anim.swing ? L.aim : L.a;
      this.character(dyn, g.app, L.x, L.y, L.mode === 'ko' ? L.a : aimA, { lower, upper, ko: L.mode === 'ko', z: L.swim ? -6 : 0 });
    }

    // ---------------------------------------------------------------- remote players
    for (const e of st.players.map.values()) {
      const s = e.cur;
      const info = st.players.info.get(e.id);
      if (!info) continue;
      e.lastX ??= s.x; e.lastY ??= s.y;
      const sp = Math.hypot(s.x - e.lastX, s.y - e.lastY) / Math.max(dt, 1e-3);
      e.lastX = s.x; e.lastY = s.y;
      e.phase = (e.phase || 0) + (dt * sp) / 13;
      for (const k of ['fireAnim', 'punchAnim', 'swingAnim', 'waveAnim']) if (e[k] > 0) e[k] -= dt;
      if (s.mode === MODE.DRIVE || s.mode === MODE.RIDE) continue;
      if (!inView(s.x, s.y)) continue;
      const w = WEAPONS[s.weapon] || WEAPONS[0];
      const moving = sp > 10;
      const upper = this.upperFor(w.key, { punch: e.punchAnim, swing: e.swingAnim, throw: 0, wave: e.waveAnim || (s.flags & PF.WAVE ? 1 : 0), aiming: s.flags & PF.AIMING, moving, phase: e.phase });
      this.character(dyn, info.app, s.x, s.y, s.mode === MODE.KO ? s.a : (s.flags & PF.AIMING ? s.aim : s.a), { lower: moving ? WALK_FRAMES[Math.floor(e.phase) % 4] : 'idle', upper, ko: s.mode === MODE.KO, z: s.mode === MODE.SWIM ? -6 : 0 });
    }

    // ---------------------------------------------------------------- pedestrians
    for (const e of st.peds.map.values()) {
      const s = e.cur;
      if (!inView(s.x, s.y)) continue;
      const info = st.peds.info.get(e.id);
      if (!info) continue;
      const app = this.pedApp(info);
      e.lastX ??= s.x; e.lastY ??= s.y;
      const sp = Math.hypot(s.x - e.lastX, s.y - e.lastY) / Math.max(dt, 1e-3);
      e.lastX = s.x; e.lastY = s.y;
      e.phase = (e.phase || 0) + (dt * sp) / 12;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.fireAnim > 0) e.fireAnim -= dt;
      const ko = s.state === PS.KO || s.state === PS.OUT;
      const moving = sp > 6 && !ko;
      let upper = moving ? SWING_FRAMES[Math.floor(e.phase) % 4] : 'idle';
      if (info.c && (s.state === PS.SHOOT || s.state === PS.CHASE)) upper = 'pistol';
      if (s.state === PS.WAVE) upper = 'wave';
      this.character(dyn, app, s.x, s.y, s.a, { lower: moving ? WALK_FRAMES[Math.floor(e.phase) % 4] : 'idle', upper, ko, hit: e.hitFlash > 0 });
      if (ko && s.state === PS.KO && Math.random() < dt * 4) g.fx.p.spawn({ x: s.x + (Math.random() - 0.5) * 8, y: s.y + (Math.random() - 0.5) * 8, z: 10, vz: 6, life: 0.7, s0: 3, s1: 2, r: 1, g: 0.95, b: 0.5, a0: 1, a1: 0, tex: g.fx.p.S.star, add: true, emis: 1.5, floor: false, vr: 4 });
      if (info.t && s.state === PS.WAVE) g.markers.taxiFare = [s.x, s.y];
    }

    // ---------------------------------------------------------------- vehicles
    const drawVehicle = (id, model, color, x, y, a, f, hp, dead, driverApp, vx, vy, slip) => {
      const m = VEHICLES[model];
      if (!inView(x, y, 100)) return;
      const def = g.art.vehicle(model, color, dead);
      dyn.stack(def, x, y, 0, a, { flags: vehFlags(f), seed: id % 97 });
      if (m.bike && driverApp) {
        const c = Math.cos(a), s = Math.sin(a);
        this.character(dyn, driverApp, x - c * 3, y - s * 3, a, { lower: 'sit', upper: 'ride', z: 2 });
      }
      const c = Math.cos(a), s = Math.sin(a);
      // lights
      if (!dead && (f & VF.LIGHTS) && night > 0.05) {
        const fx = x + c * m.len * 0.5, fy = y + s * m.len * 0.5;
        this.light(fx, fy, 6, m.bike ? 120 : 170, [0.8 * night, 0.74 * night, 0.6 * night], [c, s, 0.8, 0.95], 1);
        this.light(fx + c * 8, fy + s * 8, 4, 26, [0.5 * night, 0.48 * night, 0.4 * night]);
        const bx = x - c * m.len * 0.5, by = y - s * m.len * 0.5;
        this.light(bx, by, 4, 30, [(f & VF.BRAKE ? 1.3 : 0.45) * night, 0.04, 0.03]);
      } else if (!dead && (f & VF.BRAKE)) {
        this.light(x - c * m.len * 0.5, y - s * m.len * 0.5, 4, 22, [0.9, 0.03, 0.02]);
      }
      if (f & VF.SIREN) {
        const ph = Math.floor(time * 5) % 2;
        this.light(x, y, 16, 120, ph ? [2.0, 0.1, 0.1] : [0.1, 0.3, 2.2]);
      }
      // damage smoke and fire
      if (f & VF.FIRE || dead) {
        if (Math.random() < dt * (dead ? 8 : 20)) g.fx.p.fire(x + c * m.len * 0.25, y + s * m.len * 0.25, 10, dead ? 1.2 : 1);
        if (Math.random() < dt * 6) g.fx.p.smoke(x, y, 14, { grey: 0.2, s0: 8, s1: 30, life: 2.4, a: 0.6 });
        this.light(x, y, 12, 110, [1.6, 0.7, 0.2]);
      } else if (f & VF.SMOKE && Math.random() < dt * 10) g.fx.p.smoke(x + c * m.len * 0.35, y + s * m.len * 0.35, 12, { grey: 0.55, s0: 4, s1: 18, life: 1.4 });
      void vx; void vy; void slip; void hp;
    };
    for (const e of st.vehicles.map.values()) {
      const s = e.cur;
      const info = st.vehicles.info.get(e.id);
      if (!info) continue;
      let driverApp = null;
      if (VEHICLES[info.m].bike && s.driver) {
        if (s.driver >= NPC_DRIVER) driverApp = randomAppearance(e.id * 13);
        else { const pi = st.players.info.get(s.driver); driverApp = pi ? pi.app : null; }
      }
      drawVehicle(e.id, info.m, info.c, s.x, s.y, s.a, s.flags, s.hp, !!info.d || (s.flags & VF.DEAD), driverApp, s.vx, s.vy, s.slip);
      if (s.slip > 40 && inView(s.x, s.y)) g.skids({ x: s.x, y: s.y, a: s.a, vx: s.vx, vy: s.vy, slip: s.slip, id: e.id }, VEHICLES[info.m], false);
    }
    if (L.car) {
      const c = L.car;
      drawVehicle(c.id, c.model, c.color, c.x, c.y, c.a, c.flags | 0, c.hp, false, g.app, c.vx, c.vy, c.slip);
    }

    // ---------------------------------------------------------------- items
    const bob = Math.sin(time * 3) * 1.5;
    for (const pk of g.pickups) {
      if (!pk.active || !inView(pk.x, pk.y, 20)) continue;
      dyn.stack(g.art.pickup(pk.kind), pk.x, pk.y, 2 + bob, time * 1.6, {});
      if (night > 0.1) this.light(pk.x, pk.y, 6, 34, pk.kind === 'health' ? [0.9, 0.2, 0.2] : pk.kind === 'armor' ? [0.3, 0.5, 1] : [1, 0.85, 0.4]);
    }
    for (const c of g.cash.values()) {
      if (!inView(c.x, c.y, 20)) continue;
      dyn.stack(g.art.pickup('cash'), c.x, c.y, 1 + bob * 0.5, time * 2, {});
    }
    const spriteDef = g.art.sprite();
    for (const c of g.world.collectibles) {
      if (g.collected.has(c.id) || !inView(c.x, c.y, 20)) continue;
      const z = 4 + Math.sin(time * 2 + c.id) * 2.5;
      dyn.stack(spriteDef, c.x + Math.sin(time * 0.7 + c.id) * 3, c.y + Math.cos(time * 0.9 + c.id) * 3, z, time * 0.8 + c.id, {});
      this.light(c.x, c.y, 10, 60, [0.3, 0.9, 1.0]);
      if (Math.random() < dt * 3) g.fx.p.spawn({ x: c.x + (Math.random() - 0.5) * 10, y: c.y + (Math.random() - 0.5) * 10, z: 6, vz: 12, life: 1, s0: 2.5, s1: 0.5, r: 0.6, g: 1, b: 1, a0: 1, a1: 0, add: true, emis: 2.5, tex: g.fx.p.S.star, floor: false });
    }
    for (const e of st.projs.map.values()) {
      const s = e.cur;
      if (!inView(s.x, s.y, 30)) continue;
      if (s.kind === 1) {
        g.fx.p.smoke(s.x, s.y, s.z + 8, { s0: 3, s1: 12, life: 0.8, grey: 0.85, a: 0.5 });
        g.fx.p.spawn({ x: s.x, y: s.y, z: s.z + 8, life: 0.05, s0: 6, s1: 4, r: 1, g: 0.7, b: 0.3, a0: 1, a1: 0.6, add: true, emis: 3, tex: g.fx.p.S.soft });
        this.light(s.x, s.y, 12, 60, [1.4, 0.8, 0.3]);
        dyn.stack(g.art.pickup('rocket'), s.x, s.y, s.z + 4, s.a, {});
      } else {
        dyn.stack(g.art.pickup('grenade'), s.x, s.y, s.z, s.a, {});
      }
    }

    // ---------------------------------------------------------------- static world lights
    if (night > 0.01) {
      const k = night;
      g.renderer.wg.forEachInCells(g.renderer.wg.lightGrid, x0 - 150, y0 - 150, x1 + 150, y1 + 150, (s) => {
        if (s.off) return;
        let mul = s.k === 'street' ? 0.95 : s.k === 'fire' ? 1.0 * (0.85 + 0.15 * Math.sin(time * 13 + s.seed) * Math.sin(time * 7 + s.seed)) : s.k === 'blink' ? 0.5 * (Math.sin(time * 5 + s.seed) > 0.3 ? 1 : 0) : 0.5;
        if (s.k === 'fire') mul = Math.max(mul, 0.7 / Math.max(k, 0.3));
        this.light(s.x, s.y, s.z, s.r, [s.c[0] * mul * k, s.c[1] * mul * k, s.c[2] * mul * k], null, s.k === 'street' ? 1 : 0);
        if (s.k === 'street' && inView(s.x, s.y, 20)) g.fx.p.spawn({ x: s.x, y: s.y, z: s.z + 2.5, life: dt * 1.01, s0: 7, s1: 7, r: 1, g: 0.8, b: 0.55, a0: 0.8 * k, a1: 0.8 * k, add: true, emis: 1.6, tex: g.fx.p.S.soft, floor: false });
      });
    }
    // campfires glow during the day as well
    g.renderer.wg.forEachInCells(g.renderer.wg.emitGrid, x0 - 60, y0 - 60, x1 + 60, y1 + 60, (em) => {
      if (em.off) return;
      if (em.k === 'fire') {
        if (Math.random() < dt * 14) g.fx.p.fire(em.x, em.y, em.z, 0.9);
        if (Math.random() < dt * 2) g.fx.p.smoke(em.x, em.y, em.z + 12, { grey: 0.6, s0: 5, s1: 22, life: 2.5, a: 0.35 });
        if (night < 0.01) this.light(em.x, em.y, 6, 70, [1.0, 0.5, 0.18]);
      } else if (em.k === 'fountain') {
        if (Math.random() < dt * 22) {
          const a = Math.random() * 6.28, sp = 14 + Math.random() * 10;
          g.fx.p.spawn({ x: em.x, y: em.y, z: em.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 60 + Math.random() * 20, grav: 160, life: 0.9, s0: 1.6, s1: 1.2, r: 0.75, g: 0.9, b: 1, a0: 0.85, a1: 0.2, tex: g.fx.p.S.soft, floor: false });
        }
      } else if (em.k === 'chimney' && Math.random() < dt * 1.2) {
        g.fx.p.smoke(em.x, em.y, em.z, { grey: 0.82, s0: 4, s1: 20, life: 3, a: 0.4, vz: 10, vx: 6, vy: -3 });
      }
    });
    // traffic signals
    for (const sgl of g.renderer.wg.signals) {
      if (!inView(sgl.x, sgl.y, 40)) continue;
      const col = g.signalColor(sgl);
      const c = col === 'g' ? [0.2, 1.0, 0.45] : col === 'y' ? [1.0, 0.75, 0.15] : [1.0, 0.15, 0.1];
      g.fx.p.spawn({ x: sgl.x, y: sgl.y, z: sgl.z + 0.5, life: dt * 1.01, s0: 4, s1: 4, r: c[0], g: c[1], b: c[2], a0: 1, a1: 1, add: true, emis: 2.4, tex: g.fx.p.S.soft, floor: false });
      if (night > 0.05) this.light(sgl.x, sgl.y, 10, 28, c.map((v) => v * 0.6 * night));
    }
    // carousel canopy spins
    for (const cr of g.renderer.wg.carousels) {
      if (!inView(cr.x, cr.y, 80)) continue;
      dyn.stack(g.renderer.wg.carouselDef, cr.x, cr.y, cr.z, time * 0.5, {});
    }
    // temporary flashes
    for (const f of g.fx.lights) {
      const k = 1 - f.t / f.life;
      this.light(f.x, f.y, f.z, f.r, f.c.map((v) => v * k));
    }
  }
}
