import { BSTYLE, TILE, POI } from '../../shared/constants.js';
import { VEH_ID } from '../../shared/vehicles.js';
import { RNG } from '../../shared/rng.js';
import { PED_STATE as PS } from '../../shared/protocol.js';

const PIZZA_STOPS = 4;

export class Jobs {
  constructor(game) {
    this.g = game;
    const w = game.world;
    this.doors = [];
    for (const b of w.buildings) {
      if (!b.door || !(b.style === BSTYLE.HOUSE || b.style === BSTYLE.APARTMENT || b.style === BSTYLE.BRICK)) continue;
      const d = b.door;
      const x0 = b.x * TILE, y0 = b.y * TILE, x1 = (b.x + b.w) * TILE, y1 = (b.y + b.h) * TILE;
      let x, y;
      if (d.side === 0) { x = x0 + d.t * TILE + 8; y = y0 - 10; }
      else if (d.side === 2) { x = x0 + d.t * TILE + 8; y = y1 + 10; }
      else if (d.side === 3) { x = x0 - 10; y = y0 + d.t * TILE + 8; }
      else { x = x1 + 10; y = y0 + d.t * TILE + 8; }
      if (game.cw.circleFree(x, y, 4, 1)) this.doors.push({ x, y });
    }
    this.races = this.makeRaces();
  }

  // Deterministic race routes along the road graph.
  makeRaces() {
    const net = this.g.traffic.net;
    const rng = new RNG(this.g.world.seed * 7 + 3);
    const nodes = [...net.nodes.values()].filter((n) => n.edges.length >= 2);
    const names = ['Downtown Dash', 'Harbor Loop', 'Maple Sprint', 'Sunset Run', 'Docks Drift'];
    const anchors = [[300, 250], [110, 380], [270, 110], [330, 420], [420, 330]];
    const races = [];
    names.forEach((name, i) => {
      const [ax, ay] = anchors[i];
      let start = null, bd = 1e18;
      for (const n of nodes) {
        const d = (n.x / TILE - ax) ** 2 + (n.y / TILE - ay) ** 2;
        if (d < bd) { bd = d; start = n; }
      }
      if (!start) return;
      for (let attempt = 0; attempt < 40; attempt++) {
        const path = [start];
        const seen = new Set([start.id]);
        let cur = start, prevEdge = -1;
        for (let s = 0; s < 14; s++) {
          const opts = cur.edges.filter((eid) => eid !== prevEdge).map((eid) => {
            const e = net.edges[eid];
            return { eid, n: net.nodes.get(e.a === cur.id ? e.b : e.a) };
          }).filter((o) => o.n && !seen.has(o.n.id));
          if (!opts.length) break;
          const o = opts[Math.floor(rng.next() * opts.length)];
          path.push(o.n); seen.add(o.n.id); prevEdge = o.eid; cur = o.n;
        }
        if (path.length >= 10) {
          races.push({ id: i, name, cps: path.map((n) => [Math.round(n.x), Math.round(n.y)]) });
          break;
        }
      }
    });
    return races;
  }

  info(p) {
    const j = p.job;
    if (!j) return null;
    const out = { kind: j.kind, idx: j.idx, total: j.total, earned: j.earned, deadline: j.deadline || 0 };
    if (j.kind === 'race') { out.race = j.race.id; out.cps = j.race.cps; out.startAt = j.startAt; }
    else if (j.target) out.target = [Math.round(j.target.x), Math.round(j.target.y)];
    out.stage = j.stage || null;
    return out;
  }

  push(p) { this.g.sendTo(p, { t: 'job', job: this.info(p) }); }

  start(p, kind, opts = {}) {
    const g = this.g;
    if (p.job) this.end(p, false);
    if (kind === 'pizza') {
      const poi = opts.poi;
      const v = g.spawnVehicle(VEH_ID.scooter, poi.x + 14, poi.y + 14, 0, { kind: 'job', color: 2 });
      v.owner = p.id;
      p.job = { kind, idx: 0, total: PIZZA_STOPS, earned: 0, vehicle: v.id, from: { x: poi.x, y: poi.y } };
      this.nextPizza(p);
      g.notify(p, 'Hop on the scooter and deliver the pizzas!', 'good');
    } else if (kind === 'taxi') {
      let vid = p.vehicle;
      const cur = vid && g.vehicles.get(vid);
      if (!cur || cur.model !== VEH_ID.taxi) {
        const poi = opts.poi;
        const v = g.spawnVehicle(VEH_ID.taxi, poi.x + 20, poi.y + 26, 0, { kind: 'job', color: 4 });
        v.owner = p.id;
        vid = v.id;
      }
      p.job = { kind, idx: 0, total: 0, earned: 0, vehicle: vid, stage: 'pickup' };
      this.nextFare(p);
      g.notify(p, 'Drive the cab to the waving passenger.', 'good');
    } else if (kind === 'race') {
      const race = this.races[opts.race];
      if (!race || !p.vehicle) return;
      p.job = { kind, race, idx: 1, total: race.cps.length - 1, earned: 0, startAt: g.now + 3.2 };
      g.notify(p, `${race.name}: get ready!`, 'good');
    }
    this.push(p);
  }

  nextPizza(p) {
    const j = p.job;
    const from = j.target || j.from;
    let best = null;
    for (let i = 0; i < 40; i++) {
      const d = this.doors[Math.floor(Math.random() * this.doors.length)];
      const dist = Math.hypot(d.x - from.x, d.y - from.y);
      if (dist > 420 && dist < 1700) { best = d; break; }
    }
    best = best || this.doors[Math.floor(Math.random() * this.doors.length)];
    const dist = Math.hypot(best.x - from.x, best.y - from.y);
    j.target = { x: best.x, y: best.y };
    j.dist = dist;
    j.deadline = this.g.now + dist / 105 + 22;
  }

  nextFare(p) {
    const g = this.g;
    const j = p.job;
    const ref = g.vehicles.get(j.vehicle) || p;
    const zones = g.pedAI.zones.filter((z) => z.k === 'ring');
    const pick = (minD, maxD) => {
      for (let i = 0; i < 60; i++) {
        const z = zones[Math.floor(Math.random() * zones.length)];
        const [x, y] = g.pedAI.ringPoint(z, Math.random() * z.per, 4);
        const d = Math.hypot(x - ref.x, y - ref.y);
        if (d > minD && d < maxD) return { x, y };
      }
      return null;
    };
    if (j.stage === 'pickup') {
      const pt = pick(400, 1400) || { x: ref.x + 300, y: ref.y };
      j.target = pt;
      j.deadline = 0;
      if (j.fare) g.removePed(j.fare);
      const ped = g.pedAI.spawn(pt.x, pt.y, { keep: true });
      ped.state = PS.WAVE;
      ped.zone = null;
      ped.taxiFor = p.id;
      j.fare = ped.id;
    } else {
      const pt = pick(900, 2600) || { x: ref.x - 900, y: ref.y };
      j.target = pt;
      j.dist = Math.hypot(pt.x - ref.x, pt.y - ref.y);
      j.deadline = g.now + j.dist / 150 + 20;
    }
  }

  end(p, done) {
    const g = this.g;
    const j = p.job;
    if (!j) return;
    if (j.fare) g.removePed(j.fare);
    if (j.vehicle) {
      const v = g.vehicles.get(j.vehicle);
      if (v && v.kind === 'job') v.expire = g.now + 40;
    }
    if (done && j.earned) g.notify(p, `Shift complete! You earned $${j.earned}.`, 'good');
    p.job = null;
    this.push(p);
  }

  pay(p, amount, why) {
    amount = Math.round(amount);
    p.profile.money += amount;
    if (p.job) p.job.earned += amount;
    this.g.storage.touch();
    this.g.sendMe(p);
    this.g.sendTo(p, { t: 'cash', d: amount, why });
  }

  update(dt) {
    const g = this.g;
    for (const p of g.players.values()) {
      const j = p.job;
      if (!j || !p.alive) continue;
      const ref = p.vehicle ? g.vehicles.get(p.vehicle) : p;
      if (!ref) continue;
      const speed = Math.hypot(ref.vx || 0, ref.vy || 0);
      if (j.kind === 'pizza') {
        const d = Math.hypot(ref.x - j.target.x, ref.y - j.target.y);
        if (d < 40 && speed < 140) {
          const late = g.now > j.deadline;
          const base = 35 + j.dist / 22;
          const bonus = late ? 0 : Math.max(0, j.deadline - g.now) * 1.5;
          this.pay(p, late ? base * 0.5 : base + bonus, late ? 'Cold pizza' : 'Hot pizza delivered!');
          p.profile.stats.deliveries++;
          j.idx++;
          if (j.idx >= j.total) { this.pay(p, 80, 'Shift bonus'); this.end(p, true); continue; }
          this.nextPizza(p);
          this.push(p);
        }
      } else if (j.kind === 'taxi') {
        const v = g.vehicles.get(j.vehicle);
        if (!v || v.dead) { g.notify(p, 'Your cab is gone. Shift over.', 'warn'); this.end(p, true); continue; }
        if (p.vehicle !== j.vehicle) {
          j.away = (j.away || 0) + dt;
          if (j.away > 30) { g.notify(p, 'You left your cab. Shift over.', 'warn'); this.end(p, true); }
          continue;
        }
        j.away = 0;
        const d = Math.hypot(v.x - j.target.x, v.y - j.target.y);
        if (d < 55 && speed < 45) {
          j.hold = (j.hold || 0) + dt;
          if (j.hold > 0.8) {
            j.hold = 0;
            if (j.stage === 'pickup') {
              if (j.fare) g.removePed(j.fare);
              j.fare = 0;
              j.stage = 'dropoff';
              this.nextFare(p);
              g.notify(p, 'Passenger on board. Follow the marker!', 'good');
              g.sendTo(p, { t: 'sfx', k: 'door' });
            } else {
              const late = g.now > j.deadline;
              const fare = 25 + j.dist / 11 + (late ? 0 : (j.deadline - g.now) * 1.2);
              this.pay(p, late ? fare * 0.6 : fare, late ? 'Fare (late)' : 'Fare + tip!');
              p.profile.stats.fares++;
              j.idx++;
              j.stage = 'pickup';
              this.nextFare(p);
            }
            this.push(p);
          }
        } else j.hold = 0;
      } else if (j.kind === 'race') {
        if (g.now < j.startAt) continue;
        if (!p.vehicle) { g.notify(p, 'Race abandoned.', 'warn'); this.end(p, false); continue; }
        const cp = j.race.cps[j.idx];
        if (Math.hypot(ref.x - cp[0], ref.y - cp[1]) < 80) {
          j.idx++;
          g.sendTo(p, { t: 'sfx', k: 'checkpoint' });
          if (j.idx >= j.race.cps.length) { this.finishRace(p); continue; }
          this.push(p);
        }
        if (g.now - j.startAt > 240) { g.notify(p, 'Out of time!', 'warn'); this.end(p, false); }
      }
    }
  }

  finishRace(p) {
    const g = this.g;
    const j = p.job;
    const t = g.now - j.startAt;
    let minT = 0;
    const cps = j.race.cps;
    for (let i = 1; i < cps.length; i++) minT += Math.hypot(cps[i][0] - cps[i - 1][0], cps[i][1] - cps[i - 1][1]) / 560;
    if (t < minT) { g.notify(p, 'That time looks impossible. Not counted.', 'warn'); this.end(p, false); return; }
    const key = 'race:' + j.race.id;
    const prof = p.profile;
    const best = prof.races[j.race.id];
    const board = (g.storage.leaderboards[key] = g.storage.leaderboards[key] || []);
    let reward = best ? 40 : 150;
    if (!best || t < best) { prof.races[j.race.id] = t; reward += best ? 60 : 0; }
    const existing = board.find((e) => e.name === p.name);
    if (existing) existing.time = Math.min(existing.time, t);
    else board.push({ name: p.name, time: t });
    board.sort((a, b) => a.time - b.time);
    board.length = Math.min(board.length, 10);
    if (board[0] && board[0].name === p.name && board[0].time === t) reward += 250;
    g.storage.touch();
    g.sendTo(p, { t: 'race', name: j.race.name, time: t, best: prof.races[j.race.id], board });
    this.pay(p, reward, 'Race prize');
    p.job = null;
    this.push(p);
  }
}

void POI;
