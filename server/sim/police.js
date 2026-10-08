import { VEH_ID, VEHICLES } from '../../shared/vehicles.js';
import { stepCar } from '../../shared/carphysics.js';
import { TILE } from '../../shared/constants.js';

export const STAR_HEAT = [0, 20, 60, 150, 350, 700];
export const LOSE_TIME = [0, 12, 20, 30, 45, 60];
const UNITS = [0, 1, 2, 2, 3, 4];
export const CRIMES = { assault: 12, punch: 8, gunfire: 18, shootcop: 40, kocop: 60, carjack: 20, destroy: 30, explosion: 40, ramcop: 15, hitped: 15, theft: 6 };

export class Police {
  constructor(game) {
    this.g = game;
    this.timer = 0;
  }

  crime(p, kind, x, y) {
    if (!p || !p.alive) return;
    const g = this.g;
    let base = CRIMES[kind] || 10;
    if (kind === 'gunfire') {
      if (g.now - (p.lastGunfire || 0) < 4) return;
      p.lastGunfire = g.now;
    }
    // witnesses: police nearby count fully, civilians call it in at half weight
    let factor = 0.3;
    for (const n of g.peds.values()) {
      const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (n.cop && d2 < 520 * 520 && g.cw.lineOfSight(n.x, n.y, x, y)) { factor = 1; break; }
      if (!n.cop && d2 < 300 * 300) factor = Math.max(factor, 0.6);
    }
    for (const v of g.vehicles.values()) {
      if (v.kind === 'police' && !v.dead && (v.x - x) ** 2 + (v.y - y) ** 2 < 520 * 520) { factor = 1; break; }
    }
    p.heat = Math.min(STAR_HEAT[5] + 200, (p.heat || 0) + base * factor);
    if (factor >= 1) p.lastSeen = g.now;
    this.refresh(p);
  }

  refresh(p) {
    let s = 0;
    for (let i = 1; i <= 5; i++) if (p.heat >= STAR_HEAT[i]) s = i;
    if (s !== p.wanted) {
      const up = s > p.wanted;
      p.wanted = s;
      if (up) p.lastSeen = this.g.now;
      this.g.sendMe(p);
      if (up) this.g.notify(p, s === 1 ? 'The police are looking for you.' : `Wanted level ${s}!`, 'warn');
    }
  }

  clear(p) {
    p.heat = 0;
    if (p.wanted) { p.wanted = 0; this.g.sendMe(p); }
  }

  update(dt) {
    const g = this.g;
    const now = g.now;
    for (const p of g.players.values()) {
      if (!p.ready) continue;
      if (p.wanted > 0) {
        // seen by any unit?
        for (const v of g.vehicles.values()) {
          if (v.kind !== 'police' || v.dead) continue;
          if ((v.x - p.x) ** 2 + (v.y - p.y) ** 2 < 600 * 600 && g.cw.lineOfSight(v.x, v.y, p.x, p.y)) { p.lastSeen = now; break; }
        }
        if (now - (p.lastSeen || now) > LOSE_TIME[p.wanted]) {
          p.heat = p.wanted > 1 ? STAR_HEAT[p.wanted - 1] : 0;
          p.lastSeen = now;
          this.refresh(p);
          if (p.wanted === 0) g.notify(p, 'You lost the police.', 'good');
        }
      }
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1;
      this.dispatch();
    }
    for (const v of g.vehicles.values()) {
      if (v.kind === 'police' && !v.dead && !v.driverId && v.ai) this.drive(v, dt);
    }
  }

  dispatch() {
    const g = this.g;
    for (const p of g.players.values()) {
      if (!p.ready || !p.alive) continue;
      const want = UNITS[p.wanted || 0];
      let have = 0;
      for (const v of g.vehicles.values()) if (v.kind === 'police' && v.ai && v.ai.target === p.id && !v.dead) have++;
      if (have < want) this.spawnUnit(p);
    }
    // units without a target leave and despawn when unseen
    for (const v of g.vehicles.values()) {
      if (v.kind !== 'police' || !v.ai) continue;
      const t = g.players.get(v.ai.target);
      if (!t || t.wanted <= 0 || !t.alive) {
        v.ai.mode = 'leave';
        if (!g.anyPlayerSees(v.x, v.y, 700)) g.removeVehicle(v.id);
      }
    }
  }

  spawnUnit(p) {
    const g = this.g;
    const net = g.traffic.net;
    for (let tries = 0; tries < 12; tries++) {
      const e = net.edges[Math.floor(Math.random() * net.edges.length)];
      const [mx, my] = net.edgeMid[e.id];
      const d = Math.hypot(mx - p.x, my - p.y);
      if (d < 520 || d > 1000) continue;
      if (g.anyPlayerSees(mx, my, 620)) continue;
      const L = net.lane(e, 1, 0);
      const v = g.spawnVehicle(VEH_ID.police, mx, my, L.a, { kind: 'police', color: 0 });
      v.npcDriver = 1;
      v.flags |= 4;
      v.ai = { mode: 'pursuit', target: p.id, path: null, repath: 0, stuck: 0, reverse: 0, deployed: false };
      return v;
    }
  }

  drive(v, dt) {
    const g = this.g;
    const ai = v.ai;
    const m = VEHICLES[v.model];
    const t = g.players.get(ai.target);
    let tx, ty;
    if (ai.mode === 'parked') {
      stepCar(v, { brake: 1 }, m, dt, g.cw, null);
      return;
    }
    if (ai.mode === 'leave' || !t) {
      // drive away from the nearest player
      if (!ai.leaveTo) ai.leaveTo = [v.x + (Math.random() - 0.5) * 3000, v.y + (Math.random() - 0.5) * 3000];
      [tx, ty] = ai.leaveTo;
      v.flags &= ~4;
    } else {
      tx = t.x; ty = t.y;
      const dist = Math.hypot(tx - v.x, ty - v.y);
      if (dist > 300) {
        ai.repath -= dt;
        if (ai.repath <= 0 || !ai.path) { ai.path = this.route(v.x, v.y, tx, ty); ai.repath = 2; }
        if (ai.path && ai.path.length) {
          const n = ai.path[0];
          if (Math.hypot(n.x - v.x, n.y - v.y) < 70) ai.path.shift();
          if (ai.path.length) { tx = ai.path[0].x; ty = ai.path[0].y; }
        }
      }
      // deploy officers when close to a player on foot
      const speed = Math.hypot(v.vx, v.vy);
      if (!t.vehicle && dist < 130 && speed < 60 && !ai.deployed) {
        ai.deployed = true;
        ai.mode = 'parked';
        for (const side of [-1, 1]) {
          const c = Math.cos(v.a), s = Math.sin(v.a);
          g.pedAI.spawn(v.x - s * 16 * side, v.y + c * 16 * side, { cop: true, chase: t.id, seed: (v.id * 31 + side) >>> 0 });
        }
        return;
      }
    }
    const want = Math.atan2(ty - v.y, tx - v.x);
    const diff = Math.atan2(Math.sin(want - v.a), Math.cos(want - v.a));
    let steer = Math.max(-1, Math.min(1, diff * 2.2));
    let throttle = Math.abs(diff) > 1.8 ? 0.4 : 1;
    let brake = 0;
    const speed = Math.hypot(v.vx, v.vy);
    if (Math.abs(diff) > 1.2 && speed > 200) { throttle = 0; brake = 0.6; }
    // stuck recovery
    if (speed < 12 && throttle > 0.5) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
    if (ai.stuck > 1.5) { ai.reverse = 1.0; ai.stuck = 0; }
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      throttle = 0; brake = 1; steer = -steer;
    }
    stepCar(v, { throttle, brake, steer }, m, dt, g.cw, null);
    v.steer = steer;
  }

  // Breadth-first route over the road graph between the nodes nearest two points.
  route(x0, y0, x1, y1) {
    const net = this.g.traffic.net;
    const nearest = (x, y) => {
      let best = null, bd = 1e18;
      for (const n of net.nodes.values()) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };
    const a = nearest(x0, y0), b = nearest(x1, y1);
    if (!a || !b) return null;
    const prev = new Map([[a.id, null]]);
    const q = [a];
    while (q.length) {
      const n = q.shift();
      if (n === b) break;
      for (const eid of n.edges) {
        const e = net.edges[eid];
        const o = net.nodes.get(e.a === n.id ? e.b : e.a);
        if (!o || prev.has(o.id)) continue;
        prev.set(o.id, n);
        q.push(o);
      }
    }
    if (!prev.has(b.id)) return null;
    const path = [];
    for (let n = b; n; n = prev.get(n.id)) path.unshift(n);
    return path;
  }
}

void TILE;
