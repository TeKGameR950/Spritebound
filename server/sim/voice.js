import crypto from 'node:crypto';

const LINK_R = 640, UNLINK_R = 640 * 1.3, MAX_LINKS = 8, GRACE = 1.5, MIN_LIFE = 4;

// Server-driven proximity voice: decides who connects to whom (with hysteresis) and
// relays WebRTC signalling only between linked players.
export class Voice {
  constructor(game, config) {
    this.g = game;
    this.config = config;
    this.links = new Map();
    this.cid = 1;
    this.timer = 0;
  }

  iceServers(p) {
    const c = this.config;
    const list = [];
    if (c.stunUrls.length) list.push({ urls: c.stunUrls.slice(0, 2) });
    if (c.turnUrls.length) {
      if (c.turnSecret) {
        const user = `${Math.floor(Date.now() / 1000) + 8 * 3600}:${p.id}`;
        const cred = crypto.createHmac('sha1', c.turnSecret).update(user).digest('base64');
        list.push({ urls: c.turnUrls, username: user, credential: cred });
      } else if (c.turnUser) {
        list.push({ urls: c.turnUrls, username: c.turnUser, credential: c.turnPass });
      }
    }
    return list;
  }

  key(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

  count(id) {
    let n = 0;
    for (const l of this.links.values()) if (l.a === id || l.b === id) n++;
    return n;
  }

  link(a, b) {
    const k = this.key(a.id, b.id);
    if (this.links.has(k)) return;
    const cid = this.cid++;
    this.links.set(k, { a: a.id, b: b.id, cid, since: this.g.now, far: 0 });
    this.g.sendTo(a, { t: 'voice', link: b.id, polite: a.id > b.id, cid, ice: this.iceServers(a) });
    this.g.sendTo(b, { t: 'voice', link: a.id, polite: b.id > a.id, cid, ice: this.iceServers(b) });
  }

  unlink(k) {
    const l = this.links.get(k);
    if (!l) return;
    this.links.delete(k);
    const a = this.g.players.get(l.a), b = this.g.players.get(l.b);
    if (a) this.g.sendTo(a, { t: 'voice', unlink: l.b, cid: l.cid });
    if (b) this.g.sendTo(b, { t: 'voice', unlink: l.a, cid: l.cid });
  }

  drop(p) {
    for (const [k, l] of this.links) if (l.a === p.id || l.b === p.id) this.unlink(k);
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const g = this.g;
    const vp = [...g.players.values()].filter((p) => p.ready && p.voiceOn);
    for (const [k, l] of this.links) {
      const a = g.players.get(l.a), b = g.players.get(l.b);
      if (!a || !b || !a.voiceOn || !b.voiceOn) { this.unlink(k); continue; }
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > UNLINK_R) {
        l.far += 0.5;
        if (l.far >= GRACE && g.now - l.since > MIN_LIFE) this.unlink(k);
      } else l.far = 0;
    }
    for (let i = 0; i < vp.length; i++) {
      const a = vp[i];
      const near = [];
      for (let j = 0; j < vp.length; j++) {
        if (i === j) continue;
        const b = vp[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK_R) near.push([d, b]);
      }
      near.sort((x, y) => x[0] - y[0]);
      for (const [, b] of near) {
        if (this.links.has(this.key(a.id, b.id))) continue;
        if (this.count(a.id) >= MAX_LINKS || this.count(b.id) >= MAX_LINKS) break;
        this.link(a, b);
      }
    }
  }

  relay(p, msg) {
    const to = msg.to | 0;
    const l = this.links.get(this.key(p.id, to));
    if (!l || (msg.cid | 0) !== l.cid) return;
    const target = this.g.players.get(to);
    if (!target) return;
    const s = JSON.stringify(msg.d || null);
    if (s.length > 16000) return;
    this.g.sendTo(target, { t: 'rtc', from: p.id, cid: l.cid, d: msg.d });
  }
}
