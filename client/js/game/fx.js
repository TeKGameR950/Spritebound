import { WEAPONS } from '/shared/weapons.js';
import { PED_STATE } from '/shared/protocol.js';

const GUN_SOUND = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', rocket: 'rocket', grenade: 'throw' };

// Visual and audio feedback for shots, hits, explosions and other events.
export class Fx {
  constructor(game, particles) {
    this.g = game;
    this.p = particles;
    this.lights = [];
  }

  flash(x, y, z, r, c, life) {
    this.lights.push({ x, y, z, r, c, t: 0, life });
  }

  update(dt) {
    let w = 0;
    for (const L of this.lights) { L.t += dt; if (L.t < L.life) this.lights[w++] = L; }
    this.lights.length = w;
  }

  shot(shooter, w, ox, oy, a, local) {
    const g = this.g;
    if (w.kind === 'gun') {
      this.p.muzzle(ox, oy, 10, a, w.key === 'shotgun' ? 1.5 : w.key === 'smg' ? 0.8 : 1);
      this.flash(ox, oy, 10, w.key === 'shotgun' ? 120 : 90, [1.6, 1.2, 0.6], 0.06);
      if (Math.random() < 0.9) this.p.casing(ox - Math.cos(a) * 4, oy - Math.sin(a) * 4, 10, a);
      g.audio.play(GUN_SOUND[w.key] || 'pistol', ox, oy, { slap: 0.35, reverb: 0.4 });
      if (local) {
        g.shake(w.shake * 0.05);
        g.kick(-Math.cos(a) * w.recoil, -Math.sin(a) * w.recoil);
      }
    } else if (w.kind === 'proj') {
      if (!w.thrown) {
        for (let i = 0; i < 6; i++) this.p.smoke(ox - Math.cos(a) * 10, oy - Math.sin(a) * 10, 10, { vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60, s0: 4, s1: 16, life: 1 });
        this.flash(ox, oy, 10, 110, [1.4, 0.9, 0.5], 0.1);
        g.audio.play('rocket', ox, oy, { reverb: 0.4 });
        if (local) g.shake(0.25);
      } else g.audio.play('throw', ox, oy);
    }
  }

  tracer(ox, oy, hx, hy, kind) {
    this.p.tracer(ox, oy, hx, hy, 10);
    const a = Math.atan2(hy - oy, hx - ox);
    if (kind === 'wall') {
      for (let i = 0; i < 3; i++) this.p.spark(hx, hy, 8, a + Math.PI, { speed: 90, spread: 2 });
      this.p.hitPuff(hx, hy, 8, [0.75, 0.72, 0.68]);
      if (Math.random() < 0.3) this.g.audio.play('ricochet', hx, hy);
    } else if (kind === 'v') {
      for (let i = 0; i < 4; i++) this.p.spark(hx, hy, 8, a + Math.PI, { speed: 120, spread: 2 });
      this.g.audio.play('clang', hx, hy, { gain: 0.5 });
    } else if (kind === 'n' || kind === 'p') {
      this.p.hitPuff(hx, hy, 10, [1, 1, 1]);
      this.p.spawn({ x: hx, y: hy, z: 12, life: 0.25, s0: 6, s1: 10, r: 1, g: 1, b: 1, a0: 0.9, a1: 0, add: true, emis: 2, tex: this.p.S.star });
    }
  }

  explosion(x, y, r) {
    const g = this.g;
    this.p.explosion(x, y, r);
    this.flash(x, y, 20, r * 4, [3, 1.8, 0.8], 0.7);
    g.audio.play('explosion', x, y, { reverb: 0.8, force: true });
    const d = Math.hypot(x - g.local.x, y - g.local.y);
    g.shake(Math.max(0, 0.9 * (1 - d / 600)));
    if (d < 300) g.hitStop(0.06);
    g.renderer.marks.blob(x, y, r * 0.45, [0.08, 0.07, 0.07, 0.55]);
  }

  // server events
  event(e) {
    const g = this.g;
    switch (e.e) {
      case 'shot': {
        const w = WEAPONS[e.w];
        const shooter = e.p ? g.state.players.map.get(e.p) : null;
        this.shot(shooter, w, e.x, e.y, e.a, false);
        for (const [hx, hy] of e.ends || []) this.tracer(e.x, e.y, hx, hy, null);
        if (e.p) { const pl = g.state.players.map.get(e.p); if (pl) pl.fireAnim = 0.2; }
        if (e.n) { const n = g.state.peds.map.get(e.n); if (n) n.fireAnim = 0.2; }
        break;
      }
      case 'swing': {
        const pl = g.state.players.map.get(e.p);
        if (pl) { if (e.w === 0) { pl.punchAnim = 0.22; pl.punchSide = (pl.punchSide || 0) ^ 1; } else pl.swingAnim = 0.3; }
        g.audio.play('whoosh', e.x, e.y);
        if (e.hit) g.audio.play(e.w === 0 ? 'punch' : 'batHit', e.x + Math.cos(e.a) * 14, e.y + Math.sin(e.a) * 14);
        break;
      }
      case 'throw': case 'launch': this.shot(null, WEAPONS[e.w], e.x, e.y, e.a, false); break;
      case 'hit': {
        if (e.k === 'n') {
          const n = g.state.peds.map.get(e.id);
          if (n) n.hitFlash = 0.12;
          if (e.w === -1) g.audio.play('impactSoft', e.x, e.y);
        } else if (e.k === 'v') {
          for (let i = 0; i < 3; i++) this.p.spark(e.x, e.y, 8, Math.random() * 6.28, { speed: 90 });
        }
        break;
      }
      case 'boom': this.explosion(e.x, e.y, e.r); break;
      case 'crash': g.audio.play(e.i > 70 ? 'crash' : 'tock', e.x, e.y, { i: e.i }); break;
      case 'scream': g.audio.play('scream', e.x, e.y, { s: e.s }); break;
      case 'ko': {
        const pl = g.state.players.map.get(e.p);
        if (pl) this.p.sparkle(pl.cur.x, pl.cur.y, 14, [1, 0.9, 0.4]);
        break;
      }
      case 'jack': g.audio.play('door', g.local.x, g.local.y); break;
      case 'prop': g.setPropState(e.i, e.on, e.vx, e.vy); break;
      case 'pk': g.setPickup(e.id, e.on, e.p); break;
      case 'cash': g.addCash(e.id, e.x, e.y, e.a); break;
      case 'cashgone': g.removeCash(e.id); break;
      case 'emote': {
        const pl = g.state.players.map.get(e.p);
        if (pl && e.k === 'wave') { pl.waveAnim = 1.6; this.p.spawn({ x: pl.cur.x, y: pl.cur.y - 4, z: 28, vz: 10, life: 1.2, s0: 6, s1: 6, r: 1, g: 1, b: 1, a0: 1, a1: 0, tex: this.p.S.heart, add: true, emis: 1.2, floor: false }); }
        break;
      }
    }
  }
}

void PED_STATE;
