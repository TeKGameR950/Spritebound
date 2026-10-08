import { TILE } from '../../shared/constants.js';
import { VEHICLES, VEH_ID, PAINTS, TRAFFIC_MIX } from '../../shared/vehicles.js';
import { signalPhase, signalFor, LANE_W } from '../../shared/traffic.js';
import { stepCar } from '../../shared/carphysics.js';
import { D } from '../../shared/constants.js';

const CRUISE_LOCAL = 120, CRUISE_ART = 165, TURN_SPEED = 62;

// Road network for AI: lane segments along edges and Bezier turn paths through nodes.
export class RoadNet {
  constructor(world) {
    this.nodes = new Map();
    for (const n of world.nodes) this.nodes.set(n.id, n);
    this.edges = world.edges;
    this.edgeMid = this.edges.map((e) => [((e.x0 + e.x1) / 2) * TILE, ((e.y0 + e.y1) / 2) * TILE]);
  }

  // Lane geometry: returns {x0,y0,x1,y1,dx,dy,len,a,S,E}
  lane(e, d, k) {
    const na = this.nodes.get(e.a), nb = this.nodes.get(e.b);
    const S = d > 0 ? na : nb, E = d > 0 ? nb : na;
    const off = (k + 0.5) * LANE_W;
    let x0, y0, x1, y1;
    if (e.dir === 'h') {
      const yc = ((e.y0 + e.y1) / 2) * TILE;
      const y = d > 0 ? yc + off : yc - off;
      x0 = d > 0 ? (S.tx + S.tw) * TILE : S.tx * TILE;
      x1 = d > 0 ? E.tx * TILE : (E.tx + E.tw) * TILE;
      y0 = y1 = y;
    } else {
      const xc = ((e.x0 + e.x1) / 2) * TILE;
      const x = d > 0 ? xc - off : xc + off;
      y0 = d > 0 ? (S.ty + S.th) * TILE : S.ty * TILE;
      y1 = d > 0 ? E.ty * TILE : (E.ty + E.th) * TILE;
      x0 = x1 = x;
    }
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    return { x0, y0, x1, y1, dx, dy, len, a: Math.atan2(dy, dx), S, E };
  }

  // Choose the next edge leaving node E when arriving along edge e.
  next(e, d, k, rng) {
    const L = this.lane(e, d, k);
    const E = L.E;
    const opts = [];
    for (const eid of E.edges) {
      if (eid === e.id) continue;
      const e2 = this.edges[eid];
      const d2 = e2.a === E.id ? 1 : -1;
      const L2 = this.lane(e2, d2, 0);
      const cross = L.dx * L2.dy - L.dy * L2.dx;
      const dot = L.dx * L2.dx + L.dy * L2.dy;
      const kind = dot > 0.7 ? 'straight' : cross > 0 ? 'right' : 'left';
      const w = kind === 'straight' ? 5 : kind === 'right' ? 3 : 2;
      opts.push({ e2, d2, kind, w });
    }
    let pick;
    if (!opts.length) pick = { e2: e, d2: -d, kind: 'uturn' };
    else {
      let tot = 0;
      for (const o of opts) tot += o.w;
      let r = rng() * tot;
      pick = opts[opts.length - 1];
      for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    }
    const lanes2 = pick.e2.lanes;
    const k2 = pick.kind === 'right' ? lanes2 - 1 : pick.kind === 'left' ? 0 : Math.min(k, lanes2 - 1);
    const L2 = this.lane(pick.e2, pick.d2, k2);
    // quadratic Bezier from lane end to next lane start
    const p0 = [L.x1, L.y1], p2 = [L2.x0, L2.y0];
    let c;
    if (pick.kind === 'straight') c = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else if (pick.kind === 'uturn') c = [p0[0] + L.dx * 46, p0[1] + L.dy * 46];
    else c = Math.abs(L.dx) > 0.5 ? [p2[0], p0[1]] : [p0[0], p2[1]];
    let len = 0, px = p0[0], py = p0[1];
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p2[0];
      const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p2[1];
      len += Math.hypot(x - px, y - py); px = x; py = y;
    }
    return { e2: pick.e2, d2: pick.d2, k2, kind: pick.kind, p0, c, p2, len: Math.max(1, len), node: E };
  }

  axisOf(e) { return e.dir; }
}

export function bezier(t, p0, c, p2) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]];
}
export function bezierTan(t, p0, c, p2) {
  return [2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p2[0] - c[0]), 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p2[1] - c[1])];
}

function mixFor(district) {
  if (district === D.downtown) return TRAFFIC_MIX.downtown;
  if (district === D.docks) return TRAFFIC_MIX.docks;
  if (district === D.estates) return TRAFFIC_MIX.estates;
  if (district === D.willow || district === D.maple) return TRAFFIC_MIX.suburb;
  return TRAFFIC_MIX.default;
}
function weighted(list, r) {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let x = r * tot;
  for (const [k, w] of list) { x -= w; if (x <= 0) return k; }
  return list[0][0];
}

export class Traffic {
  constructor(game) {
    this.g = game;
    this.net = new RoadNet(game.world);
    this.spawnTimer = 0;
  }

  rng() { return Math.random(); }

  spawnOnLane(e, d, k, s, model) {
    const L = this.net.lane(e, d, k);
    s = Math.min(Math.max(0, s), L.len - 4);
    const x = L.x0 + L.dx * s, y = L.y0 + L.dy * s;
    const node = L.S;
    const key = model || weighted(mixFor(node.district), Math.random());
    const v = this.g.spawnVehicle(VEH_ID[key], x, y, L.a, { kind: 'traffic', color: key === 'taxi' || key === 'bus' || key === 'police' ? 0 : Math.floor(Math.random() * PAINTS.length) });
    const m = VEHICLES[v.model];
    v.npcDriver = (Math.random() * 1e9) | 0;
    v.ai = { mode: 'lane', e, d, k, s, L, speed: 0, cruise: (e.art ? CRUISE_ART : CRUISE_LOCAL) * (0.85 + Math.random() * 0.25) * Math.min(1, m.maxSpeed / 300), honk: 0, wait: 0, blocked: 0 };
    v.flags = 0;
    return v;
  }

  update(dt, now) {
    const g = this.g;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      this.populate();
    }
    for (const v of g.vehicles.values()) {
      if (v.kind !== 'traffic' || v.driverId) continue;
      if (v.dead) continue;
      const ai = v.ai;
      if (!ai) continue;
      if (ai.mode === 'phys') this.physics(v, dt);
      else if (ai.mode === 'parked') continue;
      else this.drive(v, dt, now);
    }
  }

  populate() {
    const g = this.g;
    const players = [...g.players.values()].filter((p) => p.ready);
    if (!players.length) return;
    // despawn far traffic
    for (const v of g.vehicles.values()) {
      if (v.kind !== 'traffic' || v.driverId || v.keep) continue;
      let near = false;
      for (const p of players) if ((p.x - v.x) ** 2 + (p.y - v.y) ** 2 < 1900 * 1900) { near = true; break; }
      if (!near) g.removeVehicle(v.id);
    }
    const target = g.config.trafficPerPlayer;
    for (const p of players) {
      let count = 0;
      for (const v of g.vehicles.values()) if (v.kind === 'traffic' && (p.x - v.x) ** 2 + (p.y - v.y) ** 2 < 1400 * 1400) count++;
      for (let tries = 0; count < target && tries < 6; tries++) {
        const e = this.net.edges[Math.floor(Math.random() * this.net.edges.length)];
        const [mx, my] = this.net.edgeMid[e.id];
        const dd = (mx - p.x) ** 2 + (my - p.y) ** 2;
        if (dd > 1350 * 1350 || dd < 450 * 450) continue;
        if (e.bridge && Math.random() < 0.5) continue;
        const d = Math.random() < 0.5 ? 1 : -1;
        const k = Math.floor(Math.random() * e.lanes);
        const L = this.net.lane(e, d, k);
        if (L.len < 40) continue;
        const s = Math.random() * (L.len - 30) + 10;
        const x = L.x0 + L.dx * s, y = L.y0 + L.dy * s;
        let visible = false;
        for (const q of players) if (Math.abs(q.x - x) < 560 && Math.abs(q.y - y) < 360) { visible = true; break; }
        if (visible) continue;
        if (g.vehicleNear(x, y, 60)) continue;
        this.spawnOnLane(e, d, k, s);
        count++;
      }
    }
  }

  // Look ahead for anything blocking the lane. Returns free distance.
  probe(v, look) {
    const g = this.g;
    const c = Math.cos(v.a), s = Math.sin(v.a);
    const m = VEHICLES[v.model];
    const front = m.len / 2;
    let best = look;
    let blocker = null;
    g.grid.query(v.x + c * look * 0.5, v.y + s * look * 0.5, look * 0.6 + 30, (o) => {
      if (o === v) return;
      const dx = o.x - v.x, dy = o.y - v.y;
      const f = dx * c + dy * s - front;
      if (f < -4 || f > best) return;
      const l = -dx * s + dy * c;
      const half = o.kind === 'ped' || o.kind === 'player' ? 9 : 14;
      if (Math.abs(l) > half + (o.kind === 'veh' ? 6 : 2)) return;
      // ignore vehicles heading toward us in the other lane
      if (o.kind === 'veh') {
        const oc = Math.cos(o.ref.a), os = Math.sin(o.ref.a);
        if (oc * c + os * s < -0.6 && Math.abs(l) > 8) return;
        const om = VEHICLES[o.ref.model];
        const ff = f - om.len / 2 + 2;
        if (ff < best) { best = Math.max(0, ff); blocker = o; }
        return;
      }
      if (f < best) { best = Math.max(0, f); blocker = o; }
    });
    return [best, blocker];
  }

  drive(v, dt, now) {
    const ai = v.ai;
    const net = this.net;
    let target = ai.cruise;
    if (ai.mode === 'lane') {
      const L = ai.L;
      const remain = L.len - ai.s;
      // stop line logic
      const E = L.E;
      if (remain < 70) {
        if (!ai.nextPlan) ai.nextPlan = net.next(ai.e, ai.d, ai.k, Math.random);
        let mayGo = true;
        if (E.signal) {
          const ph = signalPhase(E.id, now);
          const sig = signalFor(ai.e.dir, ph);
          if (sig === 'r' || (sig === 'y' && remain > 26)) mayGo = false;
        } else if (E.inter) {
          // yield: someone already crossing from another direction
          for (const o of this.g.vehicles.values()) {
            if (o === v || !o.ai || o.ai.mode !== 'turn' || o.ai.turn.node !== E) continue;
            if (o.ai.from !== ai.e.id || o.ai.fromD !== ai.d) { mayGo = false; break; }
          }
        }
        if (!mayGo) target = Math.min(target, Math.max(0, (remain - 4) * 2.2));
        else if (ai.nextPlan.kind !== 'straight') target = Math.min(target, TURN_SPEED + remain * 1.2);
      }
      const [free, blocker] = this.probe(v, 42 + ai.speed * 0.9);
      target = Math.min(target, Math.max(0, (free - 10) * 2.4));
      this.honkLogic(v, blocker, target, dt);
      this.accel(ai, target, dt);
      ai.s += ai.speed * dt;
      if (ai.s >= L.len) {
        if (!ai.nextPlan) ai.nextPlan = net.next(ai.e, ai.d, ai.k, Math.random);
        const p = ai.nextPlan;
        ai.mode = 'turn';
        ai.turn = p;
        ai.from = ai.e.id; ai.fromD = ai.d;
        ai.t = 0;
        ai.s = 0;
        ai.nextPlan = null;
      } else {
        v.x = L.x0 + L.dx * ai.s;
        v.y = L.y0 + L.dy * ai.s;
        v.a = turnToward(v.a, L.a, dt * 6);
      }
    }
    if (ai.mode === 'turn') {
      const p = ai.turn;
      const [free, blocker] = this.probe(v, 34 + ai.speed * 0.7);
      target = Math.min(p.kind === 'straight' ? ai.cruise : TURN_SPEED, Math.max(0, (free - 8) * 2.4));
      this.honkLogic(v, blocker, target, dt);
      this.accel(ai, target, dt);
      ai.s += ai.speed * dt;
      const t = Math.min(1, ai.s / p.len);
      const [x, y] = bezier(t, p.p0, p.c, p.p2);
      const [tx, ty] = bezierTan(t, p.p0, p.c, p.p2);
      v.x = x; v.y = y;
      if (tx || ty) v.a = Math.atan2(ty, tx);
      if (t >= 1) {
        ai.mode = 'lane';
        ai.e = p.e2; ai.d = p.d2; ai.k = p.k2;
        ai.L = net.lane(ai.e, ai.d, ai.k);
        ai.s = 0;
        ai.cruise = (ai.e.art ? CRUISE_ART : CRUISE_LOCAL) * (0.85 + Math.random() * 0.25) * Math.min(1, VEHICLES[v.model].maxSpeed / 300);
        ai.turn = null;
      }
    }
    v.vx = Math.cos(v.a) * ai.speed;
    v.vy = Math.sin(v.a) * ai.speed;
    v.av = 0;
    let f = v.flags & ~(2 | 1 | 8);
    if (ai.braking) f |= 2;
    if (this.g.night) f |= 1;
    if (ai.honk > 0) { f |= 8; ai.honk -= dt; }
    v.flags = f;
  }

  honkLogic(v, blocker, target, dt) {
    const ai = v.ai;
    if (blocker && target < 5 && (blocker.kind === 'player' || (blocker.kind === 'veh' && blocker.ref.driverId && blocker.ref.driverId < 0x8000))) {
      ai.blocked += dt;
      if (ai.blocked > 2.2 && ai.honk <= 0) { ai.honk = 0.35 + Math.random() * 0.3; ai.blocked = -1.5 - Math.random() * 2; }
    } else ai.blocked = Math.max(0, ai.blocked - dt);
  }

  accel(ai, target, dt) {
    const up = 85, down = 260;
    if (ai.speed < target) ai.speed = Math.min(target, ai.speed + up * dt);
    else ai.speed = Math.max(target, ai.speed - down * dt);
    ai.braking = target < ai.speed - 4 || (target < 2 && ai.speed < 2);
  }

  // Knocked about by a collision: simulate as a rolling body, then try to rejoin the road.
  physics(v, dt) {
    const ai = v.ai;
    const m = VEHICLES[v.model];
    stepCar(v, { brake: 0.6 }, m, dt, this.g.cw, null);
    ai.physT += dt;
    const sp = Math.hypot(v.vx, v.vy);
    if (ai.physT > 2.5 && sp < 6) {
      const snap = v.npcDriver ? this.findLane(v) : null;
      if (snap) {
        Object.assign(ai, snap, { mode: 'lane', speed: 0, nextPlan: null });
        v.av = 0;
      } else {
        ai.mode = 'parked';
        v.vx = v.vy = 0;
      }
    }
  }

  findLane(v) {
    let best = null, bd = 30;
    for (const e of this.net.edges) {
      const [mx, my] = this.net.edgeMid[e.id];
      if (Math.abs(mx - v.x) > 700 || Math.abs(my - v.y) > 700) continue;
      for (const d of [1, -1]) for (let k = 0; k < e.lanes; k++) {
        const L = this.net.lane(e, d, k);
        const s = (v.x - L.x0) * L.dx + (v.y - L.y0) * L.dy;
        if (s < 0 || s > L.len - 10) continue;
        const px = L.x0 + L.dx * s, py = L.y0 + L.dy * s;
        const dist = Math.hypot(v.x - px, v.y - py);
        const ang = Math.abs(Math.atan2(Math.sin(v.a - L.a), Math.cos(v.a - L.a)));
        if (dist < bd && ang < 0.9) { bd = dist; best = { e, d, k, s, L }; }
      }
    }
    return best;
  }

  knock(v, vx, vy, av = 0) {
    if (!v.ai) return;
    v.ai.mode = 'phys';
    v.ai.physT = 0;
    v.vx = vx; v.vy = vy; v.av = av;
    v.ai.speed = 0;
  }
}

function turnToward(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * Math.min(1, k);
}
