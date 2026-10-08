// Time-of-day lighting and grading. Keyframes follow docs/DESIGN.md (warm key, cool fill).
const KEYS = [
  // hour, ambient, sun colour, saturation, contrast
  [0.0, [0.12, 0.15, 0.30], [0.08, 0.10, 0.16], 0.72, 1.10],
  [4.0, [0.12, 0.15, 0.30], [0.08, 0.10, 0.16], 0.72, 1.10],
  [5.5, [0.22, 0.24, 0.42], [0.0, 0.0, 0.0], 0.85, 1.05],
  [6.25, [0.36, 0.30, 0.48], [0.62, 0.28, 0.14], 1.10, 1.00],
  [7.5, [0.42, 0.42, 0.58], [0.66, 0.42, 0.22], 1.10, 1.02],
  [10.0, [0.48, 0.53, 0.66], [0.58, 0.49, 0.36], 1.02, 1.04],
  [13.0, [0.50, 0.56, 0.70], [0.56, 0.50, 0.40], 1.00, 1.05],
  [16.0, [0.48, 0.52, 0.64], [0.60, 0.48, 0.32], 1.04, 1.04],
  [18.0, [0.42, 0.40, 0.56], [0.68, 0.40, 0.20], 1.12, 1.02],
  [19.25, [0.36, 0.28, 0.46], [0.62, 0.26, 0.14], 1.15, 1.00],
  [20.0, [0.22, 0.24, 0.42], [0.0, 0.0, 0.0], 0.88, 1.05],
  [22.0, [0.14, 0.17, 0.33], [0.08, 0.10, 0.16], 0.76, 1.10],
  [24.0, [0.12, 0.15, 0.30], [0.08, 0.10, 0.16], 0.72, 1.10],
];
const SUNRISE = 6.1, SUNSET = 19.4;

const sm = (t) => t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function timeOfDay(hour, weather = {}) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = sm((hour - a[0]) / (b[0] - a[0]));
  let ambient = lerp3(a[1], b[1], t);
  let sunCol = lerp3(a[2], b[2], t);
  let sat = a[3] + (b[3] - a[3]) * t;
  const contrast = a[4] + (b[4] - a[4]) * t;

  // Sun path: azimuth E -> S -> W; elevation peaks at 65 degrees. Moon at night.
  let sunDir, isDay = hour > SUNRISE - 0.3 && hour < SUNSET + 0.3;
  if (isDay) {
    const f = clamp01((hour - SUNRISE) / (SUNSET - SUNRISE));
    const az = (90 + 180 * f) * Math.PI / 180;
    const el = Math.max(3, 65 * Math.sin(Math.PI * f)) * Math.PI / 180;
    sunDir = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  } else {
    const az = 215 * Math.PI / 180, el = 42 * Math.PI / 180;
    sunDir = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  }
  // a little brighter and warmer than the raw table for a cozy look
  sunCol = sunCol.map((c) => c * 1.32);
  const dayAmb = 0.94, nightAmb = 0.8;
  const nf0 = clamp01(hour < 12 ? (6.6 - hour) / 1.4 : (hour - 18.9) / 1.3);
  ambient = ambient.map((c, k) => c * (dayAmb + (nightAmb - dayAmb) * nf0) * (k === 0 ? 1.02 : 1));

  const night = clamp01(hour < 12 ? (6.6 - hour) / 1.4 : (hour - 18.9) / 1.3);
  let windowLit = 0.04;
  if (hour >= 17.5 || hour < 6.5) {
    const h = hour < 12 ? hour + 24 : hour;
    windowLit = h < 22 ? 0.05 + 0.37 * clamp01((h - 17.5) / 3) : 0.42 - 0.3 * clamp01((h - 22) / 6);
  }

  const cloud = weather.cloud ?? 0.2;
  const rain = weather.rain ?? 0;
  const overcast = clamp01(cloud * 1.2 + rain * 0.6);
  sunCol = sunCol.map((c) => c * (1 - overcast * 0.7));
  const grey = [0.6, 0.63, 0.68].map((g) => g * (0.35 + 0.65 * (1 - night)));
  ambient = lerp3(ambient, grey, overcast * 0.3);
  ambient = ambient.map((c) => c * (1 - rain * 0.15));
  sat *= 1 - overcast * 0.2;

  const shadowLen = Math.min(3.2, 1 / Math.tan(Math.max(Math.asin(sunDir[2]), 0.2)));
  const sxy = Math.hypot(sunDir[0], sunDir[1]) || 1;
  const shadowVec = [(-sunDir[0] / sxy) * shadowLen, (-sunDir[1] / sxy) * shadowLen];
  const nightBoost = 1 + night * 0.12;
  return {
    hour, ambient, sunCol, sunDir, shadowVec, night, windowLit,
    sat: sat * 1.14, contrast, exposure: 1.22 * nightBoost - night * 0.1,
    lift: [0.0, 0.01 * night, 0.03 * night],
    gain: [1.0 + 0.04 * (1 - night), 1.0, 1.0 - 0.05 * (1 - night) + 0.04 * night],
    bloom: 0.05 + night * 0.12 + rain * 0.04,
    vignette: 0.55 + night * 0.25,
    cloudCover: 1 - cloud * 0.75,
    cloudDark: 0.35 + overcast * 0.2,
    streetLights: clamp01(hour < 12 ? (7.0 - hour) / 1.2 : (hour - 18.4) / 1.0),
  };
}
