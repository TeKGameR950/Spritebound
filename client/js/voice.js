// Proximity voice chat: WebRTC mesh with perfect negotiation, server-decided links,
// spatialised playback (gain + stereo pan reaching silence at the audible radius),
// push-to-talk or open mic, and RMS voice activity detection for speaking indicators.

const INNER = 60, AUDIBLE = 580, PAN_RANGE = 380;

function tuneOpus(sdp, maxAvg = 28000) {
  const pt = /^a=rtpmap:(\d+) opus\/48000\/2/im.exec(sdp)?.[1];
  if (!pt) return sdp;
  const want = { useinbandfec: '1', usedtx: '1', stereo: '0', maxaveragebitrate: String(maxAvg) };
  return sdp.replace(new RegExp(`^a=fmtp:${pt} ([^\\r\\n]*)`, 'm'), (_, params) => {
    const m = new Map(params.split(';').map((s) => s.trim()).filter(Boolean).map((kv) => {
      const i = kv.indexOf('=');
      return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
    }));
    for (const [k, v] of Object.entries(want)) m.set(k, v);
    return `a=fmtp:${pt} ` + [...m].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';');
  });
}

function distanceGain(d) {
  if (d <= INNER) return 1;
  if (d >= AUDIBLE) return 0;
  const t = (d - INNER) / (AUDIBLE - INNER);
  return (1 - t) * (1 - t);
}

function vadStep(a, now, open = -50, close = -58, holdMs = 300) {
  const s = a.vad;
  a.an.getFloatTimeDomainData(a.buf);
  let sum = 0;
  for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
  const db = 10 * Math.log10(sum / a.buf.length + 1e-10);
  if (!s.speaking) s.floor = db < s.floor ? db : s.floor + 0.02;
  const openAt = Math.max(open, s.floor + 10), closeAt = Math.max(close, s.floor + 6);
  if (!s.speaking) { if (db > openAt) { s.speaking = true; s.last = now; } }
  else if (db > closeAt) s.last = now;
  else if (now - s.last > holdMs) s.speaking = false;
  s.level = db;
  return s.speaking;
}

export class VoiceChat {
  constructor(net, audio) {
    this.net = net;
    this.A = audio;
    this.peers = new Map();
    this.enabled = false;
    this.mic = null;
    this.mode = 'ptt';
    this.transmit = false;
    this.speaking = false;
    this.mutes = new Map();
    this.volumes = new Map();
    this.status = 'off';
    this.onStatus = null;
    net.on('voice', (m) => (m.link ? this.link(m) : this.unlink(m)));
    net.on('rtc', (m) => {
      const p = this.peers.get(m.from);
      if (p && p.cid === m.cid) this.onSignal(p, m.d || {});
    });
  }

  setStatus(s) { this.status = s; this.onStatus?.(s); }

  async enable() {
    if (this.enabled) return true;
    await this.A.start();
    this.enabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      track.enabled = this.mode === 'open';
      const src = this.A.ctx.createMediaStreamSource(stream);
      const an = this.A.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.mic = { stream, track, src, an, buf: new Float32Array(512), vad: { speaking: false, last: 0, floor: -60 } };
      for (const p of this.peers.values()) this.addMic(p);
      this.setStatus(this.mode === 'open' ? 'open' : 'ptt');
    } catch (e) {
      console.warn('[voice] microphone unavailable, listen-only', e);
      this.mic = null;
      this.setStatus('listen');
    }
    this.net.send({ t: 'voice', on: true });
    return true;
  }

  disable() {
    this.enabled = false;
    this.net.send({ t: 'voice', on: false });
    for (const p of this.peers.values()) this.close(p);
    this.peers.clear();
    if (this.mic) { this.mic.track.stop(); this.mic = null; }
    this.setStatus('off');
    this.setTalking(false);
  }

  setMode(mode) {
    this.mode = mode;
    if (this.mic) this.mic.track.enabled = mode === 'open' || this.transmit;
    if (this.enabled) this.setStatus(this.mic ? mode : 'listen');
  }

  // push-to-talk key state
  setTransmit(on) {
    if (on === this.transmit) return;
    this.transmit = on;
    if (!this.mic || this.mode !== 'ptt') return;
    clearTimeout(this.tail);
    if (on) this.mic.track.enabled = true;
    else this.tail = setTimeout(() => { if (!this.transmit && this.mic && this.mode === 'ptt') this.mic.track.enabled = false; }, 220);
  }

  setTalking(on) {
    if (on === this.speaking) return;
    this.speaking = on;
    this.net.send({ t: 'talk', on });
  }

  link(m) {
    if (!this.enabled) return;
    const old = this.peers.get(m.link);
    if (old) this.close(old);
    const pc = new RTCPeerConnection({ iceServers: m.ice || [], bundlePolicy: 'max-bundle' });
    const p = { id: m.link, cid: m.cid, polite: m.polite, pc, makingOffer: false, ignoreOffer: false, srdAnswerPending: false, restarts: 0, timer: 0, closed: false, sendTx: null, audio: null };
    this.peers.set(m.link, p);
    const sig = (d) => this.net.send({ t: 'rtc', to: p.id, cid: p.cid, d });
    p.sig = sig;
    pc.ontrack = ({ track, streams }) => this.attach(p, streams[0] || new MediaStream([track]));
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig({ candidate: candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        if (!p.closed) sig({ description: pc.localDescription.toJSON() });
      } catch (e) { console.warn('[voice] offer', e); } finally { p.makingOffer = false; }
    };
    pc.oniceconnectionstatechange = () => {
      clearTimeout(p.timer);
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') p.restarts = 0;
      else if (s === 'failed') this.restart(p);
      else if (s === 'disconnected') p.timer = setTimeout(() => pc.iceConnectionState === 'disconnected' && this.restart(p), 3000);
    };
    // receive-only peers still need an m-line to get audio when we have no mic
    if (this.mic) this.addMic(p);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  addMic(p) {
    if (!this.mic || p.sendTx || p.closed) return;
    p.sendTx = p.pc.addTransceiver(this.mic.track, { direction: 'sendonly', streams: [this.mic.stream], sendEncodings: [{ maxBitrate: 28000 }] });
  }

  restart(p) {
    if (++p.restarts > 3) return;
    try { p.pc.restartIce(); } catch { /* not supported */ }
  }

  async onSignal(p, { description, candidate }) {
    if (p.closed) return;
    const pc = p.pc;
    try {
      if (description) {
        const readyForOffer = !p.makingOffer && (pc.signalingState === 'stable' || p.srdAnswerPending);
        const collision = description.type === 'offer' && !readyForOffer;
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        p.srdAnswerPending = description.type === 'answer';
        await pc.setRemoteDescription({ type: description.type, sdp: tuneOpus(description.sdp) });
        p.srdAnswerPending = false;
        if (p.closed) return;
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          if (!p.closed) p.sig({ description: pc.localDescription.toJSON() });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('[voice] signal', p.id, e); }
  }

  unlink(m) {
    const p = this.peers.get(m.unlink);
    if (p && p.cid === m.cid) { this.close(p); this.peers.delete(m.unlink); }
  }

  close(p) {
    if (p.closed) return;
    p.closed = true;
    clearTimeout(p.timer);
    const pc = p.pc;
    pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.oniceconnectionstatechange = null;
    pc.close();
    this.detach(p);
  }

  attach(p, stream) {
    if (p.audio) return;
    const ctx = this.A.ctx;
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(gain).connect(pan).connect(this.A.voiceBus);
    src.connect(an);
    p.audio = { el, src, gain, pan, an, buf: new Float32Array(512), vad: { speaking: false, last: 0, floor: -60 } };
  }

  detach(p) {
    const a = p.audio;
    if (!a) return;
    try { a.src.disconnect(); a.gain.disconnect(); a.pan.disconnect(); } catch { /* gone */ }
    a.el.pause();
    a.el.srcObject = null;
    p.audio = null;
  }

  // positions: Map id -> {x, y}; me: {x, y}. Returns Set of speaking peer ids.
  update(me, positions) {
    const speaking = new Set();
    if (!this.enabled) return speaking;
    const now = performance.now();
    const t = this.A.ctx.currentTime;
    for (const p of this.peers.values()) {
      const a = p.audio;
      const pos = positions.get(p.id);
      if (!a) continue;
      if (pos) {
        const dx = pos.x - me.x, dy = pos.y - me.y;
        const vol = this.mutes.get(p.id) ? 0 : (this.volumes.get(p.id) ?? 1);
        a.gain.gain.setTargetAtTime(distanceGain(Math.hypot(dx, dy)) * vol, t, 0.05);
        a.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx / PAN_RANGE)) * 0.75, t, 0.05);
      } else a.gain.gain.setTargetAtTime(0, t, 0.05);
      if (vadStep(a, now)) speaking.add(p.id);
    }
    if (this.mic) {
      const live = this.mode === 'open' || this.transmit;
      const s = vadStep(this.mic, now) && live;
      this.setTalking(s);
      this.micLevel = this.mic.vad.level;
    }
    return speaking;
  }
}
