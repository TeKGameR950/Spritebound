import { decodeSnapshot, SNAP } from '/shared/protocol.js';

// WebSocket connection with JSON messages, binary snapshots and server clock estimation.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.offset = 0;        // serverTime - clientTime (seconds)
    this.rtt = 0.1;
    this.bestRtt = 1e9;
    this.connected = false;
    this.bytesIn = 0;
    this.pingTimer = null;
  }

  on(type, fn) { this.handlers.set(type, fn); }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.connected = true;
        this.ping();
        this.pingTimer = setInterval(() => this.ping(), 2000);
        resolve();
      };
      ws.onerror = () => { if (!opened) reject(new Error('Could not reach the server.')); };
      ws.onclose = (e) => {
        this.connected = false;
        clearInterval(this.pingTimer);
        if (opened) this.emit('close', e);
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          this.bytesIn += e.data.byteLength;
          const dv = new DataView(e.data);
          if (dv.getUint8(0) === SNAP) this.emit('snap', decodeSnapshot(e.data));
          return;
        }
        this.bytesIn += e.data.length;
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') return this.onPong(m);
        this.emit(m.t, m);
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  ping() { this.send({ t: 'ping', c: performance.now() / 1000 }); }

  onPong(m) {
    const now = performance.now() / 1000;
    const rtt = Math.max(0.001, now - m.c);
    this.rtt = this.rtt * 0.8 + rtt * 0.2;
    // keep the estimate from the lowest-latency samples
    if (rtt < this.bestRtt * 1.3 || !this.synced) {
      const off = m.s + rtt / 2 - now;
      this.offset = this.synced ? this.offset * 0.7 + off * 0.3 : off;
      this.synced = true;
      this.bestRtt = Math.min(this.bestRtt * 1.02, rtt);
    }
  }

  // also nudge the clock from snapshot timestamps (they arrive about rtt/2 late)
  observeServerTime(t) {
    const est = t + this.rtt / 2 - performance.now() / 1000;
    if (!this.synced) { this.offset = est; this.synced = true; return; }
    if (est > this.offset) this.offset += (est - this.offset) * 0.05;
  }

  serverNow() { return performance.now() / 1000 + this.offset; }
}
