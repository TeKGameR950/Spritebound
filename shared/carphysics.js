import { F, clamp } from './constants.js';
import { obbVsObb } from './collision.js';

// Arcade top-down car model (single rigid body, kinematic-bicycle yaw with grip limits,
// self-aligning torque, capped lateral impulse and drift hysteresis). Units: world units
// (8 per metre) and seconds. Tuning follows the research notes in docs/DESIGN.md.
const U = 8;
const BASE = {
  maxSteer: 0.62, steerFalloff: 0.5, steerRate: 3.5, steerReturn: 7.0,
  yawCapK: 1.05, yawCapKDrift: 1.8, yawResp: 14, yawRespDrift: 5, align: 5, alignDrift: 2.2,
  handbrakeYaw: 1.5, handbrakeDecel: 5 * U, engineBrake: 5 * U, rollToDrag: 30 * U,
};

export function carParams(m) {
  if (m._p) return m._p;
  const p = { ...BASE };
  p.wheelBase = m.len * 0.62;
  p.accel = m.accel;
  p.vMax = m.maxSpeed;
  p.brake = m.brake;
  p.reverseAccel = m.accel * 0.55;
  p.maxReverse = m.reverse;
  p.gripLat = m.grip * 25;
  p.gripLatDrift = p.gripLat * 0.6;
  p.gripLatHandbrake = p.gripLat * 0.27;
  p.maxSteer *= m.turn / 2.8;
  p.kDrag = p.accel / (p.vMax * p.vMax + p.rollToDrag * p.vMax);
  p.kRoll = p.rollToDrag * p.kDrag;
  m._p = p;
  return p;
}

export function stepCar(car, input, m, dt, world, events) {
  const P = carParams(m);
  const surf = world ? world.terrainInfo(car.x, car.y) : null;
  const off = m.offroad || 0;
  const grip = surf ? surf.grip + (1 - surf.grip) * off : 1;
  const traction = surf ? (surf.drive > 0 ? surf.drive + (1 - surf.drive) * off : 0.3) : 1;
  const rolling = surf ? 1 + (1 - Math.min(1, surf.drive + off)) * 4 : 1;
  const dead = car.dead || car.hp <= 0;
  const thr = dead ? 0 : Math.max(0, input.throttle || 0);
  const brk = dead ? 0.4 : Math.max(0, input.brake || 0);
  const hb = !!input.handbrake;
  const steerIn = dead ? 0 : clamp(input.steer || 0, -1, 1);
  if (car.steer === undefined) { car.steer = 0; car.revT = 0; car.drift = false; car.stun = 0; car.av = car.av || 0; }

  const back = steerIn === 0 || Math.sign(steerIn) !== Math.sign(car.steer);
  const rate = (back ? P.steerReturn : P.steerRate) * dt;
  car.steer += clamp(steerIn - car.steer, -rate, rate);

  let fx = Math.cos(car.a), fy = Math.sin(car.a);
  let vF = car.vx * fx + car.vy * fy;
  const speed = Math.hypot(car.vx, car.vy), dir = vF >= 0 ? 1 : -1;

  const steerMax = P.maxSteer * (1 - P.steerFalloff * Math.min(Math.abs(vF) / P.vMax, 1));
  let wT = (dir * speed * Math.tan(car.steer * steerMax)) / P.wheelBase;
  if (hb) wT *= P.handbrakeYaw;
  const loose = hb || car.drift;
  const cap = ((loose ? P.yawCapKDrift : P.yawCapK) * P.gripLat * grip) / Math.max(speed, U);
  wT = clamp(wT, -cap, cap);
  const beta = speed > U ? Math.atan2(-car.vx * fy + car.vy * fx, Math.abs(vF)) : 0;
  if (!hb) wT += (car.drift ? P.alignDrift : P.align) * beta * dir;
  const resp = car.stun > 0 ? 1.5 : loose ? P.yawRespDrift : P.yawResp;
  car.stun = Math.max(0, car.stun - dt);
  car.av += (wT - car.av) * (1 - Math.exp(-resp * dt));
  car.a += car.av * dt;

  fx = Math.cos(car.a); fy = Math.sin(car.a);
  const rx = -fy, ry = fx;
  vF = car.vx * fx + car.vy * fy;
  let vL = car.vx * rx + car.vy * ry;

  let a = 0;
  car.braking = false;
  car.reversing = false;
  if (thr > 0) {
    car.revT = 0;
    if (vF < -0.5 * U) { a += P.brake * thr; car.braking = true; }
    else a += P.accel * thr * traction * (vF < 6 * U ? 1.3 : 1);
  }
  if (brk > 0) {
    if (vF > 0.5 * U) { a -= P.brake * brk; car.braking = true; }
    else if ((car.revT += dt) > 0.15 && vF > -P.maxReverse) { a -= P.reverseAccel * brk; car.reversing = true; }
  } else if (!(thr > 0)) car.revT = 0;
  const res = P.kDrag * vF * Math.abs(vF) + P.kRoll * vF * rolling
    + (!thr && !brk ? Math.sign(vF) * P.engineBrake : 0)
    + (hb ? Math.sign(vF) * P.handbrakeDecel : 0);
  const vF0 = vF;
  vF += (a - res) * dt;
  if (!thr && !(brk > 0 && vF0 <= 0.5 * U) && vF0 !== 0 && Math.sign(vF) !== Math.sign(vF0)) vF = 0;
  if (hb) car.braking = true;

  const lim = (hb ? P.gripLatHandbrake : car.drift ? P.gripLatDrift : P.gripLat) * grip * dt;
  car.sliding = Math.abs(vL) > lim;
  car.slip = Math.abs(vL);
  vL += clamp(-vL, -lim, lim);

  const slipAng = Math.atan2(Math.abs(vL), Math.abs(vF) + 1e-3);
  if (!car.drift && slipAng > 0.26 && speed > 8 * U) car.drift = true;
  else if (car.drift && (slipAng < 0.12 || speed < 4 * U)) car.drift = false;

  car.vx = fx * vF + rx * vL;
  car.vy = fy * vF + ry * vL;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = vF;

  if (world) return collideCarWorld(car, m, world, events);
  return 0;
}

const _contacts = [];
export function collideCarWorld(car, m, world, events) {
  const hl = m.len / 2, hw = m.wid / 2;
  const contacts = world.boxContacts(car.x, car.y, car.a, hl, hw, F.DRIVE, _contacts);
  if (!contacts.length) return 0;
  let impact = 0;
  const inertia = (m.len * m.len + m.wid * m.wid) / 12 * 1.6;
  let pushX = 0, pushY = 0, n = 0;
  for (const ct of contacts) {
    const speed = Math.hypot(car.vx, car.vy);
    if (ct.shape && ct.shape.brk && speed > 70) {
      ct.shape.alive = false;
      if (events) events.push({ t: 'prop', prop: ct.shape.prop, vx: car.vx, vy: car.vy });
      car.vx *= 0.9; car.vy *= 0.9;
      continue;
    }
    pushX += ct.nx * ct.depth; pushY += ct.ny * ct.depth; n++;
    const rx = ct.px - car.x, ry = ct.py - car.y;
    const vpx = car.vx - car.av * ry, vpy = car.vy + car.av * rx;
    const vn = vpx * ct.nx + vpy * ct.ny;
    if (vn >= 0) continue;
    const rn = rx * ct.ny - ry * ct.nx;
    const e = 0.22;
    const j = (-(1 + e) * vn) / (1 + (rn * rn) / inertia);
    car.vx += j * ct.nx;
    car.vy += j * ct.ny;
    car.av += (rn * j) / inertia * 0.6;
    // wall friction along the tangent
    const tx = -ct.ny, ty = ct.nx;
    const vt = car.vx * tx + car.vy * ty;
    car.vx -= tx * vt * 0.08;
    car.vy -= ty * vt * 0.08;
    impact = Math.max(impact, -vn);
  }
  if (n) {
    const len = Math.hypot(pushX, pushY) || 1;
    const avg = Math.min(8, len / Math.sqrt(n));
    car.x += (pushX / len) * avg;
    car.y += (pushY / len) * avg;
  }
  car.av = clamp(car.av, -6, 6);
  if (impact > 6 * U) car.stun = 0.6;
  return impact;
}

// Resolve two cars. massB = Infinity treats B as immovable (e.g. remote authority).
export function collideCars(a, ma, b, mb, applyB = true) {
  const res = obbVsObb(a.x, a.y, a.a, ma.len / 2, ma.wid / 2, b.x, b.y, b.a, mb.len / 2, mb.wid / 2);
  if (!res) return 0;
  const { nx, ny, depth, px, py } = res;
  const wa = 1 / ma.mass, wb = applyB ? 1 / mb.mass : 0;
  const tot = wa + wb || 1;
  a.x += nx * depth * (wa / tot);
  a.y += ny * depth * (wa / tot);
  if (applyB) { b.x -= nx * depth * (wb / tot); b.y -= ny * depth * (wb / tot); }
  const rvx = a.vx - (b.vx || 0), rvy = a.vy - (b.vy || 0);
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const e = 0.3;
  const j = (-(1 + e) * vn) / (wa + (applyB ? wb : 0.35 * wa) || 1);
  a.vx += j * nx * wa; a.vy += j * ny * wa;
  const ia = (ma.len * ma.len + ma.wid * ma.wid) / 12 * 1.6;
  const rax = px - a.x, ray = py - a.y;
  a.av += ((rax * ny - ray * nx) * j * wa) / ia * 0.5;
  if (-vn > 48) a.stun = 0.6;
  if (applyB) {
    b.vx -= j * nx * wb; b.vy -= j * ny * wb;
    const ib = (mb.len * mb.len + mb.wid * mb.wid) / 12 * 1.6;
    const rbx = px - b.x, rby = py - b.y;
    b.av = (b.av || 0) - ((rbx * ny - rby * nx) * j * wb) / ib * 0.5;
    if (-vn > 48) b.stun = 0.6;
  }
  return -vn;
}

// Circle (pedestrian) vs car overlap test. Returns penetration info or null.
export function circleVsCar(cx, cy, r, car, m) {
  const c = Math.cos(car.a), s = Math.sin(car.a);
  const dx = cx - car.x, dy = cy - car.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const hl = m.len / 2, hw = m.wid / 2;
  const qx = clamp(lx, -hl, hl), qy = clamp(ly, -hw, hw);
  const ex = lx - qx, ey = ly - qy;
  const d2 = ex * ex + ey * ey;
  if (d2 >= r * r && !(Math.abs(lx) < hl && Math.abs(ly) < hw)) return null;
  let nlx, nly, depth;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    nlx = ex / d; nly = ey / d; depth = r - d;
  } else {
    const px = hl - Math.abs(lx), py = hw - Math.abs(ly);
    if (px < py) { nlx = Math.sign(lx) || 1; nly = 0; depth = px + r; } else { nlx = 0; nly = Math.sign(ly) || 1; depth = py + r; }
  }
  return { nx: nlx * c - nly * s, ny: nlx * s + nly * c, depth };
}

export function carSeatPos(car, m, side) {
  const c = Math.cos(car.a), s = Math.sin(car.a);
  const off = m.wid / 2 + 8;
  const sg = side === 'right' ? 1 : -1;
  return { x: car.x - s * off * sg - c * 2, y: car.y + c * off * sg - s * 2 };
}
