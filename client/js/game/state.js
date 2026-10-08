import { INTERP_DELAY, lerpAngle } from '/shared/constants.js';

// Remote entity store with a snapshot buffer per entity and time-based interpolation.
class Store {
  constructor(kind) {
    this.kind = kind;
    this.map = new Map();
    this.info = new Map();
  }
  sample(id, t, s) {
    let e = this.map.get(id);
    if (!e) {
      e = { id, buf: [], seen: t, cur: { ...s }, born: t };
      this.map.set(id, e);
    }
    e.seen = t;
    const b = e.buf;
    if (b.length && b[b.length - 1].t >= t) return e;
    b.push({ t, ...s });
    if (b.length > 12) b.shift();
    return e;
  }
  prune(t) {
    for (const [id, e] of this.map) if (t - e.seen > 0.6) this.map.delete(id);
  }
}

const NUM_KEYS = { players: ['x', 'y'], vehicles: ['x', 'y', 'vx', 'vy', 'steer', 'slip'], peds: ['x', 'y'], projs: ['x', 'y', 'z'] };

export class ClientState {
  constructor() {
    this.players = new Store('players');
    this.vehicles = new Store('vehicles');
    this.peds = new Store('peds');
    this.projs = new Store('projs');
    this.lastSnap = 0;
    this.delay = INTERP_DELAY;
  }

  onSnapshot(s) {
    const t = s.time;
    this.lastSnap = t;
    for (const p of s.players) this.players.sample(p.id, t, p);
    for (const v of s.vehicles) this.vehicles.sample(v.id, t, v);
    for (const n of s.peds) this.peds.sample(n.id, t, n);
    for (const j of s.projs) this.projs.sample(j.id, t, j);
    this.players.prune(t);
    this.vehicles.prune(t);
    this.peds.prune(t);
    this.projs.prune(t);
  }

  onInfo(m) {
    for (const p of m.p || []) this.players.info.set(p.id, p);
    for (const v of m.v || []) this.vehicles.info.set(v.id, v);
    for (const n of m.n || []) this.peds.info.set(n.id, n);
  }

  // Compute interpolated state for render time rt (server time minus delay).
  interpolate(rt) {
    for (const store of [this.players, this.vehicles, this.peds, this.projs]) {
      const keys = NUM_KEYS[store.kind];
      for (const e of store.map.values()) {
        const b = e.buf;
        if (!b.length) continue;
        let a = b[0], c = b[b.length - 1];
        if (rt <= a.t) { Object.assign(e.cur, a); continue; }
        if (rt >= c.t) {
          // extrapolate briefly using velocity (vehicles) to hide jitter
          Object.assign(e.cur, c);
          const dt = Math.min(0.15, rt - c.t);
          if (store.kind === 'vehicles') { e.cur.x = c.x + c.vx * dt; e.cur.y = c.y + c.vy * dt; }
          continue;
        }
        for (let i = 0; i < b.length - 1; i++) {
          if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
        }
        const f = (rt - a.t) / Math.max(1e-4, c.t - a.t);
        const cur = e.cur;
        Object.assign(cur, f < 0.5 ? a : c);
        for (const k of keys) cur[k] = a[k] + (c[k] - a[k]) * f;
        cur.a = lerpAngle(a.a, c.a, f);
        if (a.aim !== undefined) cur.aim = lerpAngle(a.aim, c.aim, f);
        // teleports: snap instead of sliding across the map
        if (Math.abs(c.x - a.x) + Math.abs(c.y - a.y) > 300) { cur.x = c.x; cur.y = c.y; }
      }
    }
  }
}
