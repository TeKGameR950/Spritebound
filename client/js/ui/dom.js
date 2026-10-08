export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function sfx(audio, name) {
  if (audio && audio.ready) audio.play(name, undefined, undefined, { bus: 'ui' });
}

export function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
