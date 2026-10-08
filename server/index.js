import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { generateWorld } from './worldgen/index.js';
import { packWorld } from '../shared/worlddata.js';
import { Game } from './sim/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const SHARED = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

console.log(`[spritebound] generating world (seed ${config.seed})...`);
const t0 = Date.now();
const world = generateWorld(config.seed);
const worldJson = JSON.stringify(packWorld(world));
const worldGz = zlib.gzipSync(worldJson, { level: 9 });
const worldEtag = '"' + crypto.createHash('sha1').update(worldJson).digest('hex').slice(0, 16) + '"';
console.log(`[spritebound] world ready in ${Date.now() - t0}ms: ${world.buildings.length} buildings, ${world.props.length} props, ${(worldGz.length / 1024).toFixed(0)} KB gzipped`);

const game = new Game(world, config);

const fileCache = new Map();
function readStatic(file) {
  const st = fs.statSync(file);
  const key = file + ':' + st.mtimeMs;
  let hit = fileCache.get(file);
  if (hit && hit.key === key) return hit;
  const body = fs.readFileSync(file);
  const ext = path.extname(file);
  hit = {
    key,
    body,
    gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(body) : null,
    etag: '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"',
    type: MIME[ext] || 'application/octet-stream',
  };
  fileCache.set(file, hit);
  return hit;
}

function send(req, res, status, type, body, gz, etag, cache = 'no-cache') {
  const headers = { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' };
  if (etag) {
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
  }
  const acceptGz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz && acceptGz) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    res.writeHead(status, headers);
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function resolveStatic(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0')) return null;
  let base = CLIENT;
  if (p.startsWith('/shared/')) { base = SHARED; p = p.slice('/shared'.length); }
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(base, p));
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/world') {
    return send(req, res, 200, MIME['.json'], worldJson, worldGz, worldEtag);
  }
  if (url.pathname === '/api/status') {
    const body = JSON.stringify(game.status());
    return send(req, res, 200, MIME['.json'], body, null, null, 'no-store');
  }
  if (url.pathname === '/healthz') return send(req, res, 200, MIME['.txt'], 'ok', null, null, 'no-store');
  const file = resolveStatic(url.pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(req, res, 404, MIME['.txt'], 'Not found', null, null, 'no-store');
  }
  try {
    const f = readStatic(file);
    const cache = f.type.startsWith('font/') ? 'public, max-age=604800' : 'no-cache';
    send(req, res, 200, f.type, f.body, f.gz, f.etag, cache);
  } catch (err) {
    console.error(err);
    send(req, res, 500, MIME['.txt'], 'Server error', null, null, 'no-store');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: false });
const perIp = new Map();
wss.on('connection', (ws, req) => {
  const ip = config.trustProxy ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  const n = perIp.get(ip) || 0;
  if (n >= config.maxConnPerIp) {
    ws.send(JSON.stringify({ t: 'kick', m: 'Too many connections from your network.' }));
    return ws.close();
  }
  perIp.set(ip, n + 1);
  ws.on('close', () => {
    const left = (perIp.get(ip) || 1) - 1;
    if (left > 0) perIp.set(ip, left); else perIp.delete(ip);
  });
  game.connect(ws, ip);
});

server.listen(config.port, config.host, () => {
  console.log(`[spritebound] ${config.serverName} listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[spritebound] saving and shutting down...');
  game.shutdown();
  server.close();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
