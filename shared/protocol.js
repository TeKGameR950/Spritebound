// Network protocol: JSON for events, compact binary for snapshots.
export const SNAP = 1;
export const POS_SCALE = 7;     // world units -> u16 (8192 * 7 < 65536)
export const VEL_SCALE = 8;
const TAU = Math.PI * 2;

export const MODE = { WALK: 0, DRIVE: 1, KO: 2, RIDE: 3, DEAD: 4, SWIM: 5 };
// player/ped flags
export const PF = { MOVING: 1, RUNNING: 2, AIMING: 4, FIRING: 8, TALKING: 16, PASSIVE: 32, RELOAD: 64, WAVE: 128 };
// vehicle flags
export const VF = { LIGHTS: 1, BRAKE: 2, SIREN: 4, HORN: 8, SMOKE: 16, FIRE: 32, DEAD: 64, REVERSE: 128 };
export const PED_STATE = { WALK: 0, IDLE: 1, FLEE: 2, KO: 3, OUT: 4, CHASE: 5, SHOOT: 6, SIT: 7, WAVE: 8 };

const encA = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65535);
const decA = (v) => (v / 65535) * TAU;
const encP = (v) => Math.max(0, Math.min(65535, Math.round(v * POS_SCALE)));
const decP = (v) => v / POS_SCALE;
const encV = (v) => Math.max(-32767, Math.min(32767, Math.round(v * VEL_SCALE)));

export const P_BYTES = 15, V_BYTES = 19, N_BYTES = 12, J_BYTES = 11;

export function encodeSnapshot(time, players, vehicles, peds, projs) {
  const size = 1 + 8 + 2 + players.length * P_BYTES + 2 + vehicles.length * V_BYTES + 2 + peds.length * N_BYTES + 2 + projs.length * J_BYTES;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o, SNAP); o += 1;
  dv.setFloat64(o, time, true); o += 8;
  dv.setUint16(o, players.length, true); o += 2;
  for (const p of players) {
    dv.setUint16(o, p.id, true);
    dv.setUint16(o + 2, encP(p.x), true);
    dv.setUint16(o + 4, encP(p.y), true);
    dv.setUint16(o + 6, encA(p.a), true);
    dv.setUint8(o + 8, p.mode);
    dv.setUint16(o + 9, p.vehicle || 0, true);
    dv.setUint8(o + 11, p.weapon || 0);
    dv.setUint8(o + 12, p.flags || 0);
    dv.setUint8(o + 13, Math.max(0, Math.min(255, Math.round(p.hp * 2.55))));
    dv.setUint8(o + 14, encA(p.aim ?? p.a) >> 8);
    o += P_BYTES;
  }
  dv.setUint16(o, vehicles.length, true); o += 2;
  for (const v of vehicles) {
    dv.setUint16(o, v.id, true);
    dv.setUint16(o + 2, encP(v.x), true);
    dv.setUint16(o + 4, encP(v.y), true);
    dv.setUint16(o + 6, encA(v.a), true);
    dv.setInt16(o + 8, encV(v.vx), true);
    dv.setInt16(o + 10, encV(v.vy), true);
    dv.setUint8(o + 12, v.flags || 0);
    dv.setUint8(o + 13, Math.max(0, Math.min(255, Math.round((v.hp / v.maxHp) * 255))));
    dv.setUint16(o + 14, v.drv ?? v.driverId ?? 0, true);
    dv.setInt8(o + 16, Math.round(Math.max(-1, Math.min(1, v.steer || 0)) * 127));
    dv.setUint16(o + 17, Math.min(65535, Math.round(Math.abs(v.slip || 0) * 16)), true);
    o += V_BYTES;
  }
  dv.setUint16(o, peds.length, true); o += 2;
  for (const n of peds) {
    dv.setUint16(o, n.id, true);
    dv.setUint16(o + 2, encP(n.x), true);
    dv.setUint16(o + 4, encP(n.y), true);
    dv.setUint16(o + 6, encA(n.a), true);
    dv.setUint8(o + 8, n.state);
    dv.setUint8(o + 9, n.flags || 0);
    dv.setUint8(o + 10, n.weapon || 0);
    dv.setUint8(o + 11, Math.max(0, Math.min(255, Math.round(n.hp * 2.55))));
    o += N_BYTES;
  }
  dv.setUint16(o, projs.length, true); o += 2;
  for (const j of projs) {
    dv.setUint16(o, j.id, true);
    dv.setUint8(o + 2, j.kind);
    dv.setUint16(o + 3, encP(j.x), true);
    dv.setUint16(o + 5, encP(j.y), true);
    dv.setUint16(o + 7, Math.max(0, Math.min(65535, Math.round(j.z * 8))), true);
    dv.setUint16(o + 9, encA(j.a), true);
    o += J_BYTES;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const dv = new DataView(buf);
  let o = 1;
  const time = dv.getFloat64(o, true); o += 8;
  const np = dv.getUint16(o, true); o += 2;
  const players = new Array(np);
  for (let i = 0; i < np; i++) {
    players[i] = {
      id: dv.getUint16(o, true), x: decP(dv.getUint16(o + 2, true)), y: decP(dv.getUint16(o + 4, true)), a: decA(dv.getUint16(o + 6, true)),
      mode: dv.getUint8(o + 8), vehicle: dv.getUint16(o + 9, true), weapon: dv.getUint8(o + 11), flags: dv.getUint8(o + 12),
      hp: dv.getUint8(o + 13) / 2.55, aim: (dv.getUint8(o + 14) / 255) * TAU,
    };
    o += P_BYTES;
  }
  const nv = dv.getUint16(o, true); o += 2;
  const vehicles = new Array(nv);
  for (let i = 0; i < nv; i++) {
    vehicles[i] = {
      id: dv.getUint16(o, true), x: decP(dv.getUint16(o + 2, true)), y: decP(dv.getUint16(o + 4, true)), a: decA(dv.getUint16(o + 6, true)),
      vx: dv.getInt16(o + 8, true) / VEL_SCALE, vy: dv.getInt16(o + 10, true) / VEL_SCALE, flags: dv.getUint8(o + 12), hp: dv.getUint8(o + 13) / 255,
      driver: dv.getUint16(o + 14, true), steer: dv.getInt8(o + 16) / 127, slip: dv.getUint16(o + 17, true) / 16,
    };
    o += V_BYTES;
  }
  const nn = dv.getUint16(o, true); o += 2;
  const peds = new Array(nn);
  for (let i = 0; i < nn; i++) {
    peds[i] = {
      id: dv.getUint16(o, true), x: decP(dv.getUint16(o + 2, true)), y: decP(dv.getUint16(o + 4, true)), a: decA(dv.getUint16(o + 6, true)),
      state: dv.getUint8(o + 8), flags: dv.getUint8(o + 9), weapon: dv.getUint8(o + 10), hp: dv.getUint8(o + 11) / 2.55,
    };
    o += N_BYTES;
  }
  const nj = dv.getUint16(o, true); o += 2;
  const projs = new Array(nj);
  for (let i = 0; i < nj; i++) {
    projs[i] = { id: dv.getUint16(o, true), kind: dv.getUint8(o + 2), x: decP(dv.getUint16(o + 3, true)), y: decP(dv.getUint16(o + 5, true)), z: dv.getUint16(o + 7, true) / 8, a: decA(dv.getUint16(o + 9, true)) };
    o += J_BYTES;
  }
  return { time, players, vehicles, peds, projs };
}

// Driver id encoding: 0 none, 1..32767 player id, 32768+ npc driver.
export const NPC_DRIVER = 0x8000;
