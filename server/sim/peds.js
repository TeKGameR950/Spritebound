import { F, TILE } from '../../shared/constants.js';
import { PED_STATE as PS } from '../../shared/protocol.js';
import { WEAPON_ID } from '../../shared/weapons.js';

const WALK = [24, 36];
const FLEE_SPEED = 88;
const COP_SPEED = 84;

// Pedestrians wander sidewalk rings and plazas, flee from danger, get knocked down and
// stand back up. Cops chase wanted players and arrest or shoot depending on heat.
export class Peds {
  constructor(game) {
    this.g = game;
    this.zones = game.world.pedZones.map((z) => ({ ...z, w: z.x1 - z.x0, h: z.y1 - z.y0, per: 2 * (z.x1 - z.x0 + z.y1 - z.y0) }));
    this.timer = 0;
    this._res = {};
  }

  spawn(x, y, opt = {}) {
    const g = this.g;
    const p = g.addPed({
      x, y, a: Math.random() * Math.PI * 2,
      seed: opt.seed ?? ((Math.random() * 1e9) | 0),
      state: PS.WALK, hp: opt.cop ? 120 : 60, speed: WALK[0] + Math.random() * (WALK[1] - WALK[0]),
      zone: opt.zone ?? null, cop: !!opt.cop, weapon: opt.cop ? WEAPON_ID.pistol : 0, timer: 1 + Math.random() * 4,
      u: 0, dir: Math.random() < 0.5 ? 1 : -1, lat: (Math.random() - 0.5) * 10, target: null, fleeX: 0, fleeY: 0,
      chase: opt.chase ?? 0, fireT: 1 + Math.random(), arrestT: 0, keep: !!opt.keep,
    });
    if (p.zone && p.zone.k === 'ring') {
      p.u = this.ringU(p.zone, x, y);
    }
    return p;
  }

  ringPoint(z, u, lat) {
    const w = z.w, h = z.h;
    u = ((u % z.per) + z.per) % z.per;
    if (u < w) return [z.x0 + u, z.y0 - lat, 0];
    u -= w;
    if (u < h) return [z.x1 + lat, z.y0 + u, Math.PI / 2];
    u -= h;
    if (u < w) return [z.x1 - u, z.y1 + lat, Math.PI];
    u -= w;
    return [z.x0 - lat, z.y1 - u, -Math.PI / 2];
  }
  ringU(z, x, y) {
    // nearest perimeter parameter (approximate)
    const dTop = Math.abs(y - z.y0), dBot = Math.abs(y - z.y1), dL = Math.abs(x - z.x0), dR = Math.abs(x - z.x1);
    const m = Math.min(dTop, dBot, dL, dR);
    if (m === dTop) return Math.max(0, Math.min(z.w, x - z.x0));
    if (m === dR) return z.w + Math.max(0, Math.min(z.h, y - z.y0));
    if (m === dBot) return z.w + z.h + Math.max(0, Math.min(z.w, z.x1 - x));
    return 2 * z.w + z.h + Math.max(0, Math.min(z.h, z.y1 - y));
  }

  populate() {
    const g = this.g;
    const players = [...g.players.values()].filter((p) => p.ready);
    for (const n of g.peds.values()) {
      if (n.keep || n.cop) continue;
      let near = false;
      for (const p of players) if ((p.x - n.x) ** 2 + (p.y - n.y) ** 2 < 1550 * 1550) { near = true; break; }
      if (!near) g.removePed(n.id);
    }
    if (!players.length) return;
    const density = g.night ? 0.55 : 1;
    const target = Math.round(g.config.pedsPerPlayer * density * (g.weather.rain > 0.5 ? 0.6 : 1));
    for (const p of players) {
      let count = 0;
      for (const n of g.peds.values()) if (!n.cop && (p.x - n.x) ** 2 + (p.y - n.y) ** 2 < 1100 * 1100) count++;
      for (let tries = 0; count < target && tries < 10; tries++) {
        const z = this.zones[Math.floor(Math.random() * this.zones.length)];
        if (z.sparse && Math.random() < 0.7) continue;
        let x, y, a = 0;
        if (z.k === 'ring') {
          const u = Math.random() * z.per;
          [x, y, a] = this.ringPoint(z, u, (Math.random() - 0.5) * 10);
        } else {
          x = z.x0 + Math.random() * z.w; y = z.y0 + Math.random() * z.h;
        }
        const dd = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (dd > 1050 * 1050 || dd < 400 * 400) continue;
        let visible = false;
        for (const q of players) if (Math.abs(q.x - x) < 540 && Math.abs(q.y - y) < 330) { visible = true; break; }
        if (visible) continue;
        if (!g.cw.circleFree(x, y, 5, F.WALK)) continue;
        const n = this.spawn(x, y, { zone: z });
        n.a = a;
        count++;
      }
    }
  }

  update(dt, now) {
    const g = this.g;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.7; this.populate(); }
    for (const n of g.peds.values()) {
      if (n.state === PS.KO || n.state === PS.OUT) {
        n.timer -= dt;
        if (n.vx || n.vy) {
          g.cw.moveCircle(n.x, n.y, n.vx * dt, n.vy * dt, 5, F.WALK, this._res);
          n.x = this._res.x; n.y = this._res.y;
          const k = Math.exp(-4 * dt);
          n.vx *= k; n.vy *= k;
          if (Math.abs(n.vx) + Math.abs(n.vy) < 2) n.vx = n.vy = 0;
        }
        if (n.timer <= 0) {
          if (n.state === PS.OUT) { g.removePed(n.id); continue; }
          n.state = n.cop ? PS.CHASE : PS.FLEE;
          n.timer = 5;
          n.hp = Math.max(n.hp, 25);
        }
        continue;
      }
      if (n.cop) { this.copThink(n, dt, now); continue; }
      switch (n.state) {
        case PS.FLEE: this.flee(n, dt); break;
        case PS.IDLE:
          n.timer -= dt;
          if (n.timer <= 0) { n.state = PS.WALK; n.timer = 4 + Math.random() * 10; }
          break;
        default: this.wander(n, dt);
      }
    }
  }

  wander(n, dt) {
    const z = n.zone;
    n.timer -= dt;
    if (n.timer <= 0) {
      if (Math.random() < 0.18) { n.state = PS.IDLE; n.timer = 1.5 + Math.random() * 4; return; }
      if (Math.random() < 0.12) n.dir = -n.dir;
      n.timer = 4 + Math.random() * 10;
    }
    if (z && z.k === 'ring') {
      n.u += n.dir * n.speed * dt;
      const [x, y] = this.ringPoint(z, n.u, n.lat);
      this.stepTo(n, x, y, n.speed * 1.4, dt, true);
      return;
    }
    if (!n.target || (n.x - n.target[0]) ** 2 + (n.y - n.target[1]) ** 2 < 36) {
      if (z) n.target = [z.x0 + Math.random() * z.w, z.y0 + Math.random() * z.h];
      else n.target = [n.x + (Math.random() - 0.5) * 200, n.y + (Math.random() - 0.5) * 200];
    }
    const moved = this.stepTo(n, n.target[0], n.target[1], n.speed, dt, false);
    if (!moved) n.target = null;
  }

  // Move toward a point; returns false when blocked.
  stepTo(n, tx, ty, speed, dt, snap) {
    const dx = tx - n.x, dy = ty - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    const step = Math.min(d, speed * dt);
    const want = Math.atan2(dy, dx);
    n.a += Math.atan2(Math.sin(want - n.a), Math.cos(want - n.a)) * Math.min(1, dt * 10);
    if (snap && d < 30) { n.x += (dx / d) * step; n.y += (dy / d) * step; return true; }
    const r = this.g.cw.moveCircle(n.x, n.y, (dx / d) * step, (dy / d) * step, 4.5, F.WALK, this._res);
    const moved = Math.hypot(r.x - n.x, r.y - n.y);
    n.x = r.x; n.y = r.y;
    return moved > step * 0.3;
  }

  flee(n, dt) {
    n.timer -= dt;
    const dx = n.x - n.fleeX, dy = n.y - n.fleeY;
    const d = Math.hypot(dx, dy) || 1;
    let tx = n.x + (dx / d) * 40, ty = n.y + (dy / d) * 40;
    if (!this.stepTo(n, tx, ty, FLEE_SPEED, dt, false)) {
      // blocked: veer sideways
      const side = (n.id % 2 ? 1 : -1);
      tx = n.x - (dy / d) * 40 * side; ty = n.y + (dx / d) * 40 * side;
      this.stepTo(n, tx, ty, FLEE_SPEED, dt, false);
    }
    if (n.timer <= 0) {
      n.state = PS.WALK;
      n.timer = 3;
      if (n.zone && n.zone.k === 'ring') n.u = this.ringU(n.zone, n.x, n.y);
    }
  }

  scare(x, y, radius, strength = 1) {
    for (const n of this.g.peds.values()) {
      if (n.cop || n.state === PS.KO || n.state === PS.OUT) continue;
      const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d2 > radius * radius) continue;
      if (n.state !== PS.FLEE && Math.random() < 0.35 * strength) this.g.event({ e: 'scream', x: n.x, y: n.y, s: n.seed % 4 }, n.x, n.y);
      n.state = PS.FLEE;
      n.fleeX = x; n.fleeY = y;
      n.timer = 5 + Math.random() * 4;
    }
  }

  knock(n, vx, vy, dmg, attacker) {
    n.hp -= dmg;
    n.vx = vx; n.vy = vy;
    if (n.hp <= 0) {
      n.state = PS.OUT;
      n.timer = 18 + Math.random() * 8;
      if (!n.cop && Math.random() < 0.6) this.g.dropCash(n.x, n.y, 5 + Math.floor(Math.random() * 40));
      if (attacker) attacker.profile.stats.knockouts++;
    } else {
      n.state = PS.KO;
      n.timer = 2.5 + Math.random() * 2.5;
    }
  }

  copThink(n, dt, now) {
    const g = this.g;
    const target = g.players.get(n.chase);
    if (!target || target.wanted <= 0 || !target.alive) {
      // patrol away, despawn when unseen
      n.state = PS.WALK;
      n.timer -= dt;
      if (n.timer <= 0) {
        if (!g.anyPlayerSees(n.x, n.y)) { g.removePed(n.id); return; }
        n.timer = 3;
      }
      if (!n.target || Math.random() < 0.01) n.target = [n.x + (Math.random() - 0.5) * 300, n.y + (Math.random() - 0.5) * 300];
      this.stepTo(n, n.target[0], n.target[1], WALK[1], dt, false);
      return;
    }
    const tx = target.x, ty = target.y;
    const dx = tx - n.x, dy = ty - n.y;
    const d = Math.hypot(dx, dy);
    const sees = d < 520 && g.cw.lineOfSight(n.x, n.y, tx, ty);
    if (sees) target.lastSeen = now;
    n.a = Math.atan2(dy, dx);
    if (target.wanted >= 2 && sees && d < 300) {
      // stop and shoot
      n.state = PS.SHOOT;
      n.fireT -= dt;
      if (n.fireT <= 0) {
        n.fireT = 0.9 + Math.random() * 0.7;
        g.combat.npcShoot(n, target);
      }
      if (d > 140) this.stepTo(n, tx, ty, COP_SPEED * 0.4, dt, false);
      return;
    }
    n.state = PS.CHASE;
    if (d > 13) this.stepTo(n, tx, ty, COP_SPEED, dt, false);
    // arrest attempt
    const tSpeed = Math.hypot(target.vx || 0, target.vy || 0);
    const inCar = target.vehicle;
    if (d < (inCar ? 30 : 17) && tSpeed < (inCar ? 12 : 45)) {
      n.arrestT += dt;
      if (n.arrestT > (inCar ? 2.2 : 1.4)) { n.arrestT = 0; g.bust(target); }
    } else n.arrestT = Math.max(0, n.arrestT - dt);
  }
}

void TILE;
