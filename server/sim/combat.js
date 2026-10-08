import { F } from '../../shared/constants.js';
import { WEAPONS, WEAPON_ID, weaponDamageVs } from '../../shared/weapons.js';
import { VEHICLES } from '../../shared/vehicles.js';
import { PED_STATE as PS } from '../../shared/protocol.js';

const PROJ_KIND = { rocket: 1, grenade: 2 };

export class Combat {
  constructor(game) {
    this.g = game;
  }

  canHurt(attacker, victim) {
    const g = this.g;
    if (!attacker || attacker === victim) return attacker === victim;
    if (!g.config.pvp) return false;
    return !attacker.passive && !victim.passive;
  }

  origin(p, msg) {
    const ox = Number(msg.x), oy = Number(msg.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
    const ref = p.vehicle ? this.g.vehicles.get(p.vehicle) : p;
    if (!ref || (ox - ref.x) ** 2 + (oy - ref.y) ** 2 > 60 * 60) return null;
    return [ox, oy];
  }

  useAmmo(p, w) {
    if (w.kind === 'melee') return true;
    const a = p.profile.ammo[w.key] || 0;
    if (a <= 0) return false;
    p.profile.ammo[w.key] = a - 1;
    return true;
  }

  onFire(p, msg) {
    const g = this.g;
    const w = WEAPONS[msg.w];
    if (!w || w.kind !== 'gun' || !p.alive || !p.profile.weapons[w.key]) return;
    const last = p.lastFire[w.id] || 0;
    if (g.now - last < w.rate * 0.7) return;
    if (p.vehicle && !(w.key === 'pistol' || w.key === 'smg')) return;
    const o = this.origin(p, msg);
    if (!o) return;
    if (!this.useAmmo(p, w)) return;
    p.lastFire[w.id] = g.now;
    p.firingT = 0.25;
    const a = Number(msg.a) || 0;
    const hits = Array.isArray(msg.h) ? msg.h.slice(0, w.pellets) : [];
    const ends = Array.isArray(msg.e) ? msg.e.slice(0, w.pellets) : [];
    for (const h of hits) this.applyHit(p, w, o, h);
    g.event({ e: 'shot', p: p.id, w: w.id, x: o[0], y: o[1], a, ends }, o[0], o[1], 1400, p.id);
    g.police.crime(p, 'gunfire', o[0], o[1]);
    g.pedAI.scare(o[0], o[1], 360, 1);
  }

  applyHit(p, w, o, h) {
    const g = this.g;
    if (!h || typeof h !== 'object') return;
    const id = h.id | 0;
    let target = null, kind = h.k;
    if (kind === 'p') target = g.players.get(id);
    else if (kind === 'n') target = g.peds.get(id);
    else if (kind === 'v') target = g.vehicles.get(id);
    if (!target) return;
    const tx = target.x, ty = target.y;
    const d = Math.hypot(tx - o[0], ty - o[1]);
    if (d > (w.range || 30) + 70) return;
    if (w.kind !== 'melee' && !g.cw.lineOfSight(o[0], o[1], tx, ty)) return;
    let dmg = weaponDamageVs(w, kind === 'v' ? 'vehicle' : 'person');
    if (w.key === 'shotgun' && d > 120) dmg *= 0.6;
    if (kind === 'p') {
      if (!this.canHurt(p, target) || !target.alive) return;
      this.damagePlayer(target, dmg, p, w.id, o[0], o[1]);
    } else if (kind === 'n') {
      if (target.state === PS.OUT) return;
      const push = w.kind === 'melee' ? 90 : 25;
      const dx = tx - o[0], dy = ty - o[1], dl = Math.hypot(dx, dy) || 1;
      if (w.kind === 'melee' && target.hp - dmg > 0) {
        target.hp -= dmg;
        if (target.cop) { target.state = PS.CHASE; target.chase = p.id; } else { target.state = PS.FLEE; target.fleeX = o[0]; target.fleeY = o[1]; target.timer = 6; }
      } else g.pedAI.knock(target, (dx / dl) * push, (dy / dl) * push, dmg, p);
      if (target.cop) g.police.crime(p, target.state === PS.OUT ? 'kocop' : 'shootcop', tx, ty);
      else g.police.crime(p, w.kind === 'melee' ? 'punch' : 'assault', tx, ty);
      g.event({ e: 'hit', k: 'n', id: target.id, x: tx, y: ty, w: w.id }, tx, ty, 900);
    } else if (kind === 'v') {
      this.damageVehicle(target, dmg, p);
      g.event({ e: 'hit', k: 'v', id: target.id, x: Number(h.x) || tx, y: Number(h.y) || ty, w: w.id }, tx, ty, 900);
    }
  }

  onMelee(p, msg) {
    const g = this.g;
    const w = WEAPONS[msg.w];
    if (!w || w.kind !== 'melee' || !p.alive || p.vehicle) return;
    if (w.key !== 'fists' && !p.profile.weapons[w.key]) return;
    const last = p.lastFire[w.id] || 0;
    if (g.now - last < w.rate * 0.7) return;
    p.lastFire[w.id] = g.now;
    const o = this.origin(p, msg);
    if (!o) return;
    const hits = Array.isArray(msg.h) ? msg.h.slice(0, 3) : [];
    for (const h of hits) this.applyHit(p, w, o, h);
    g.event({ e: 'swing', p: p.id, w: w.id, x: o[0], y: o[1], a: Number(msg.a) || 0, hit: hits.length > 0 }, o[0], o[1], 700, p.id);
  }

  onProjectile(p, msg) {
    const g = this.g;
    const w = WEAPONS[msg.w];
    if (!w || w.kind !== 'proj' || !p.alive || !p.profile.weapons[w.key] || p.vehicle) return;
    const last = p.lastFire[w.id] || 0;
    if (g.now - last < w.rate * 0.7) return;
    const o = this.origin(p, msg);
    if (!o) return;
    if (!this.useAmmo(p, w)) return;
    p.lastFire[w.id] = g.now;
    const a = Number(msg.a) || 0;
    const power = Math.max(0.2, Math.min(1, Number(msg.pw) || 1));
    const sp = w.thrown ? w.speed * power : w.speed;
    const j = g.addProj({
      kind: PROJ_KIND[w.proj], owner: p.id, w: w.id, x: o[0] + Math.cos(a) * 10, y: o[1] + Math.sin(a) * 10, z: 10, a,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: w.thrown ? 140 * power : 0, fuse: w.fuse || 4, life: 0,
    });
    g.event({ e: w.thrown ? 'throw' : 'launch', p: p.id, w: w.id, x: o[0], y: o[1], a }, o[0], o[1], 1200, p.id);
    if (!w.thrown) g.pedAI.scare(o[0], o[1], 300, 1);
    return j;
  }

  update(dt) {
    const g = this.g;
    const res = {};
    for (const j of g.projs.values()) {
      j.life += dt;
      const w = WEAPONS[j.w];
      if (j.kind === 1) {
        // rocket: straight, explodes on contact or after its range
        const nx = j.x + j.vx * dt, ny = j.y + j.vy * dt;
        const r = g.cw.raycast(j.x, j.y, nx, ny, F.SHOT, res);
        let hit = r.t < 1;
        let hx = r.x, hy = r.y;
        if (!hit) {
          g.grid.query(nx, ny, 18, (o) => {
            if (hit || o.kind === 'player' && o.ref.id === j.owner) return;
            if (o.kind === 'veh' && o.ref.driverId === j.owner) return;
            if ((o.x - nx) ** 2 + (o.y - ny) ** 2 < (o.kind === 'veh' ? 16 : 8) ** 2) { hit = true; hx = nx; hy = ny; }
          });
        }
        j.x = nx; j.y = ny;
        if (hit || j.life > 2.2) { this.explode(hit ? hx : j.x, hit ? hy : j.y, g.players.get(j.owner), w.radius, w.dmg); g.removeProj(j.id); }
      } else {
        // grenade: ballistic arc, bounces, explodes on fuse
        j.vz -= 420 * dt;
        let nz = j.z + j.vz * dt;
        if (nz <= 0) { nz = 0; j.vz = -j.vz * 0.35; j.vx *= 0.6; j.vy *= 0.6; if (Math.abs(j.vz) < 30) j.vz = 0; }
        const nx = j.x + j.vx * dt, ny = j.y + j.vy * dt;
        const r = g.cw.raycast(j.x, j.y, nx, ny, F.SHOT, res);
        if (r.t < 1) {
          if (r.nx) j.vx = -j.vx * 0.5; if (r.ny) j.vy = -j.vy * 0.5;
          if (!r.nx && !r.ny) { j.vx = -j.vx * 0.5; j.vy = -j.vy * 0.5; }
        } else { j.x = nx; j.y = ny; }
        j.z = nz;
        j.a += dt * 8;
        if (j.life >= j.fuse) { this.explode(j.x, j.y, g.players.get(j.owner), w.radius, w.dmg); g.removeProj(j.id); }
      }
    }
    // burning vehicles
    for (const v of g.vehicles.values()) {
      if (v.dead) {
        v.deadT += dt;
        if (v.deadT > 40 && !g.anyPlayerSees(v.x, v.y, 600)) g.removeVehicle(v.id);
        continue;
      }
      const frac = v.hp / v.maxHp;
      let f = v.flags & ~(16 | 32);
      if (frac < 0.38) f |= 16;
      if (frac < 0.14) {
        f |= 32;
        v.burn = (v.burn || 0) + dt;
        if (v.burn > 5.5) this.destroyVehicle(v, g.players.get(v.lastHitBy));
      }
      v.flags = f;
    }
  }

  damageVehicle(v, dmg, attacker) {
    if (v.dead) return;
    v.hp -= dmg;
    if (attacker) v.lastHitBy = attacker.id;
    if (v.hp <= 0) this.destroyVehicle(v, attacker);
  }

  destroyVehicle(v, attacker) {
    const g = this.g;
    if (v.dead) return;
    v.dead = true;
    v.deadT = 0;
    v.hp = 0;
    v.flags = (v.flags | 64) & ~(1 | 4 | 8);
    v.vx *= 0.3; v.vy *= 0.3;
    if (v.ai) v.ai.mode = 'dead';
    g.sendInfo(v);
    if (attacker && v.kind !== 'player') g.police.crime(attacker, v.kind === 'police' ? 'kocop' : 'destroy', v.x, v.y);
    // throw out anyone inside
    for (const p of g.players.values()) {
      if (p.vehicle === v.id) {
        g.ejectPlayer(p, true);
        this.damagePlayer(p, 60, attacker, -1, v.x, v.y);
      }
    }
    this.explode(v.x, v.y, attacker, 80, 90, v.id);
  }

  explode(x, y, owner, radius, dmg, skipVeh = 0) {
    const g = this.g;
    g.event({ e: 'boom', x, y, r: radius }, x, y, 2200);
    g.pedAI.scare(x, y, 520, 1.5);
    if (owner) g.police.crime(owner, 'explosion', x, y);
    const R2 = radius * radius;
    for (const p of g.players.values()) {
      if (!p.alive) continue;
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 > R2 * 1.6) continue;
      const d = Math.sqrt(d2);
      const f = Math.max(0, 1 - d / (radius * 1.25));
      if (f <= 0) continue;
      if (owner && owner !== p && !this.canHurt(owner, p)) { g.sendTo(p, { t: 'knock', vx: ((p.x - x) / (d || 1)) * 120 * f, vy: ((p.y - y) / (d || 1)) * 120 * f }); continue; }
      this.damagePlayer(p, dmg * f, owner, -2, x, y);
      g.sendTo(p, { t: 'knock', vx: ((p.x - x) / (d || 1)) * 260 * f, vy: ((p.y - y) / (d || 1)) * 260 * f });
    }
    for (const n of g.peds.values()) {
      const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d2 > R2) continue;
      const d = Math.sqrt(d2) || 1;
      const f = 1 - d / radius;
      g.pedAI.knock(n, ((n.x - x) / d) * 220 * f, ((n.y - y) / d) * 220 * f, dmg * f, owner);
    }
    for (const v of g.vehicles.values()) {
      if (v.id === skipVeh || v.dead) continue;
      const d2 = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (d2 > R2 * 1.4) continue;
      const d = Math.sqrt(d2) || 1;
      const f = Math.max(0, 1 - d / (radius * 1.2));
      const ix = ((v.x - x) / d) * 260 * f, iy = ((v.y - y) / d) * 260 * f;
      if (v.driverId && v.driverId < 0x8000) {
        const drv = g.players.get(v.driverId);
        if (drv) g.sendTo(drv, { t: 'shove', vid: v.id, vx: ix, vy: iy, av: (Math.random() - 0.5) * 6 });
      } else if (v.kind === 'traffic') g.traffic.knock(v, v.vx + ix, v.vy + iy, (Math.random() - 0.5) * 6);
      else { v.vx += ix; v.vy += iy; }
      this.damageVehicle(v, dmg * f * 3, owner);
    }
    // break props in the blast
    for (const s of g.cw.shapesNear(x, y, radius * 0.6, [])) if (s.brk && s.alive) g.breakProp(s.prop);
  }

  damagePlayer(p, dmg, attacker, weapon, fx, fy) {
    const g = this.g;
    if (!p.alive || dmg <= 0) return;
    if (p.spawnShield > g.now) return;
    const prof = p.profile;
    if (prof.armor > 0 && weapon !== -3) {
      const absorbed = Math.min(prof.armor, dmg * 0.66);
      prof.armor -= absorbed;
      dmg -= absorbed;
    }
    p.hp -= dmg;
    p.lastHurt = g.now;
    g.sendTo(p, { t: 'hurt', d: Math.round(dmg), x: fx, y: fy });
    if (p.hp <= 0) g.knockout(p, attacker, weapon);
    else g.sendMe(p);
  }

  // Cop pistol fire: server-side hitscan with distance and motion based accuracy.
  npcShoot(cop, target) {
    const g = this.g;
    const d = Math.hypot(target.x - cop.x, target.y - cop.y);
    const speed = Math.hypot(target.vx || 0, target.vy || 0);
    const chance = Math.max(0.12, 0.62 - d / 700 - speed / 900);
    const hit = Math.random() < chance;
    const a = Math.atan2(target.y - cop.y, target.x - cop.x) + (hit ? 0 : (Math.random() - 0.5) * 0.35);
    const ex = cop.x + Math.cos(a) * Math.min(420, d + 30), ey = cop.y + Math.sin(a) * Math.min(420, d + 30);
    const r = g.cw.raycast(cop.x, cop.y, ex, ey, F.SHOT, {});
    g.event({ e: 'shot', n: cop.id, w: WEAPON_ID.pistol, x: cop.x, y: cop.y, a, ends: [[Math.round(r.x), Math.round(r.y)]] }, cop.x, cop.y, 1400);
    if (hit && r.t >= Math.min(1, d / Math.hypot(ex - cop.x, ey - cop.y)) - 0.02) {
      if (target.vehicle) {
        const v = g.vehicles.get(target.vehicle);
        if (v) this.damageVehicle(v, 14, null);
      } else this.damagePlayer(target, 9, null, WEAPON_ID.pistol, cop.x, cop.y);
    }
  }
}

export { PROJ_KIND };
void VEHICLES;
