import { hash2 } from './rng.js';

// Traffic signal timing shared by server (AI) and client (lamp colours).
export const SIGNAL_CYCLE = 28;
// phases: 0 H green, 1 H yellow, 2 all red, 3 V green, 4 V yellow, 5 all red
export function signalPhase(nodeId, t) {
  const off = hash2(nodeId, 7, 11) * SIGNAL_CYCLE;
  const c = (t + off) % SIGNAL_CYCLE;
  if (c < 11) return 0;
  if (c < 13.5) return 1;
  if (c < 14) return 2;
  if (c < 25) return 3;
  if (c < 27.5) return 4;
  return 5;
}

// 'g' green, 'y' yellow, 'r' red for traffic travelling along axis ('h' or 'v').
export function signalFor(axis, phase) {
  if (axis === 'h') return phase === 0 ? 'g' : phase === 1 ? 'y' : 'r';
  return phase === 3 ? 'g' : phase === 4 ? 'y' : 'r';
}

export const LANE_W = 32;
