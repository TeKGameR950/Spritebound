// Draws voxel models onto a 2D canvas in a 3/4 view (for menus, portraits and icons).
const colorCache = new Map();
function css(c, f = 1) {
  const key = c * 7 + Math.round(f * 100);
  let s = colorCache.get(key);
  if (!s) {
    const r = Math.min(255, Math.round((c & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round(((c >> 16) & 255) * f));
    s = `rgb(${r},${g},${b})`;
    colorCache.set(key, s);
    if (colorCache.size > 6000) colorCache.clear();
  }
  return s;
}

// angle: turntable rotation (radians). opts: {scale, cx, cy, elev (0..1), zMin, zMax, crop}
export function drawVox(ctx, vox, angle, opts = {}) {
  const { w, d, h } = vox;
  const scale = opts.scale ?? 6;
  const ky = opts.elev ?? 0.45;
  const kz = Math.sqrt(1 - ky * ky);
  const cx = opts.cx ?? ctx.canvas.width / 2, cy = opts.cy ?? ctx.canvas.height / 2;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const mx = w / 2, my = d / 2, mz = opts.zMid ?? h / 2;
  const list = [];
  const zMin = opts.zMin ?? 0, zMax = opts.zMax ?? h;
  for (let z = zMin; z < zMax; z++) for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
    const c = vox.c[(z * d + y) * w + x];
    if (!c) continue;
    if (vox.get(x + 1, y, z) && vox.get(x - 1, y, z) && vox.get(x, y + 1, z) && vox.get(x, y - 1, z) && vox.get(x, y, z + 1) && vox.get(x, y, z - 1)) continue;
    const lx = x + 0.5 - mx, ly = y + 0.5 - my;
    // viewer looks from +X' toward the model
    const rx = lx * ca - ly * sa, ry = lx * sa + ly * ca;
    const top = !vox.get(x, y, z + 1);
    list.push([rx, ry, z, c, top]);
  }
  list.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const s = scale * 1.12;
  for (const [rx, ry, z, c, top] of list) {
    const sx = cx + ry * scale;
    const sy = cy + rx * scale * ky - (z + 0.5 - mz) * scale * kz;
    ctx.fillStyle = css(c, 0.82);
    ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - s * kz / 2), Math.ceil(s), Math.ceil(s * kz));
    if (top) {
      ctx.fillStyle = css(c, 1.05);
      ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - s * kz / 2 - s * ky), Math.ceil(s), Math.ceil(s * ky));
    }
  }
}
