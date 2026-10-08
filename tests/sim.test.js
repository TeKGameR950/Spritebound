import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { generateWorld } from '../server/worldgen/index.js';
import { Game } from '../server/sim/game.js';
import { config as baseConfig } from '../server/config.js';
import { F } from '../shared/constants.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const world = generateWorld(1337);

function fakeWs() {
  const ws = { readyState: 1, sent: [], handlers: {}, send(m) { this.sent.push(m); }, on(k, f) { this.handlers[k] = f; }, close() { this.readyState = 3; } };
  return ws;
}
function makeGame(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  return new Game(world, { ...baseConfig, dataDir: dir, manualTick: true, dev: false, ...extra });
}
function join(g, name = 'Tester') {
  const ws = fakeWs();
  g.connect(ws, '127.0.0.1');
  const msg = (o) => ws.handlers.message(Buffer.from(JSON.stringify(o)), false);
  msg({ t: 'hello', v: PROTOCOL_VERSION });
  msg({ t: 'join', name, app: {} });
  const p = [...g.players.values()].find((q) => q.name === name);
  // spawn points are random; downtown keeps traffic and crowd counts stable
  const hall = world.pois.find((q) => q.type === 'cityhall');
  p.x = hall.x; p.y = hall.y;
  return { ws, msg, p };
}

test('traffic spawns near players and keeps moving on roads', () => {
  const g = makeGame();
  const { p } = join(g);
  for (let i = 0; i < 20 * 20; i++) g.step(0.05);
  const traffic = [...g.vehicles.values()].filter((v) => v.kind === 'traffic');
  assert.ok(traffic.length >= 8, `expected traffic, got ${traffic.length}`);
  const before = new Map(traffic.map((v) => [v.id, [v.x, v.y]]));
  for (let i = 0; i < 20 * 10; i++) g.step(0.05);
  let moved = 0, inside = 0;
  for (const v of traffic) {
    const b = before.get(v.id);
    if (!g.vehicles.has(v.id) || !b) continue;
    if (Math.hypot(v.x - b[0], v.y - b[1]) > 40) moved++;
    if (g.cw.flagsAt(v.x, v.y) & F.BUILDING) inside++;
  }
  assert.ok(moved >= traffic.length * 0.4, `only ${moved}/${traffic.length} cars moved`);
  assert.equal(inside, 0, 'a car is inside a building');
  g.shutdown();
});

test('pedestrians spawn and stay out of buildings', () => {
  const g = makeGame();
  join(g);
  for (let i = 0; i < 20 * 15; i++) g.step(0.05);
  const peds = [...g.peds.values()];
  assert.ok(peds.length >= 10, `expected peds, got ${peds.length}`);
  for (const n of peds) assert.ok(!(g.cw.flagsAt(n.x, n.y) & F.BUILDING), 'ped inside building');
  g.shutdown();
});

test('crimes raise wanted level and police respond', () => {
  const g = makeGame();
  const { p } = join(g);
  p.passive = false;
  for (let i = 0; i < 40; i++) g.step(0.05);
  p.heat = 70; g.police.refresh(p);
  assert.equal(p.wanted, 2);
  for (let i = 0; i < 20 * 6; i++) g.step(0.05);
  const cops = [...g.vehicles.values()].filter((v) => v.kind === 'police');
  assert.ok(cops.length >= 1, 'no police dispatched');
  g.shutdown();
});

test('pickups grant items and buying requires being at the shop', () => {
  const g = makeGame();
  const { p, msg } = join(g);
  const pk = g.pickups.find((q) => q.kind === 'pistol');
  p.x = pk.x; p.y = pk.y;
  msg({ t: 'pickup', id: pk.id });
  assert.ok(p.profile.weapons.pistol);
  assert.ok(p.profile.ammo.pistol > 0);
  const money = p.profile.money;
  msg({ t: 'buy', shop: 'gunshop', item: 'armor' });
  assert.equal(p.profile.money, money, 'bought from far away');
  const shop = world.pois.find((q) => q.type === 'gunshop');
  p.x = shop.x; p.y = shop.y;
  msg({ t: 'buy', shop: 'gunshop', item: 'armor' });
  assert.equal(p.profile.money, money - 250);
  g.shutdown();
});

test('entering a car carjacks the NPC driver and grants driving', () => {
  const g = makeGame();
  const { p, msg, ws } = join(g);
  for (let i = 0; i < 20 * 5; i++) g.step(0.05);
  const v = [...g.vehicles.values()].find((q) => q.kind === 'traffic' && q.npcDriver);
  assert.ok(v, 'no traffic car');
  p.x = v.x + 10; p.y = v.y;
  const pedsBefore = g.peds.size;
  msg({ t: 'enter', v: v.id });
  assert.equal(p.vehicle, v.id);
  assert.ok(g.peds.size > pedsBefore, 'driver was not ejected');
  assert.ok(ws.sent.some((m) => typeof m === 'string' && m.includes('"t":"drive"')));
  g.shutdown();
});

test('dev commands only work on dev servers', () => {
  const prod = makeGame();
  const a = join(prod);
  const money = a.p.profile.money;
  a.msg({ t: 'chat', m: '/money 99999' });
  assert.equal(a.p.profile.money, money);
  prod.shutdown();

  const dev = makeGame({ dev: true });
  const b = join(dev);
  b.msg({ t: 'chat', m: '/money 99999' });
  assert.equal(b.p.profile.money, 99999);
  dev.step(1);
  const cars = dev.vehicles.size;
  b.msg({ t: 'chat', m: '/car taxi' });
  assert.equal(dev.vehicles.size, cars + 1);
  dev.step(1);
  b.msg({ t: 'chat', m: '/time 22' });
  assert.ok(Math.abs(dev.hour - 22) < 0.01, `hour is ${dev.hour}`);
  dev.shutdown();
});
