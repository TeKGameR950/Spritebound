import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Profiles are kept in memory and flushed to a JSON file with atomic writes.
export class Storage {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'profiles.json');
    this.profiles = new Map();
    this.dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw.profiles || {})) this.profiles.set(k, v);
      this.leaderboards = raw.leaderboards || {};
      console.log(`[storage] loaded ${this.profiles.size} profiles`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[storage] could not read profiles:', e.message);
      this.leaderboards = {};
    }
    this.timer = setInterval(() => this.flush(), 15000);
    this.timer.unref?.();
  }

  newToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  get(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
    return this.profiles.get(token) || null;
  }

  create(name, app) {
    const token = this.newToken();
    const p = {
      name, app,
      money: 500,
      weapons: { fists: 1 },
      ammo: {},
      armor: 0,
      collected: [],
      cars: [],
      stats: { deliveries: 0, fares: 0, distance: 0, knockouts: 0, collected: 0, playtime: 0 },
      races: {},
      created: Date.now(),
      lastSeen: Date.now(),
      passive: true,
      tutorial: false,
    };
    this.profiles.set(token, p);
    this.dirty = true;
    return { token, profile: p };
  }

  touch() { this.dirty = true; }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const data = JSON.stringify({ profiles: Object.fromEntries(this.profiles), leaderboards: this.leaderboards });
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[storage] write failed:', e.message);
      this.dirty = true;
    }
  }

  close() {
    clearInterval(this.timer);
    this.flush();
  }
}
