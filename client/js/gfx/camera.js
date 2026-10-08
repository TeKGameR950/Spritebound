import { mat4 } from './gl.js';

// Perspective top-down camera. World: x right, y down, z up. The view matrix includes a
// reflection (y down on screen with z toward the viewer), so face culling stays disabled.
export const PERSPECTIVE = 3.3;
export const FPV_RANGE = 900;

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.tilt = 0;
    this.fpv = false;
    this.yaw = 0; this.pitch = -0.12; this.eyeZ = 13;
    this.baseViewH = 340;
    this.shakeX = 0; this.shakeY = 0; this.shakeA = 0;
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.vp = new Float32Array(16);
    this.inv = new Float32Array(16);
    this.w = 1; this.h = 1;
  }

  setScreen(w, h) {
    this.w = w; this.h = h;
    // fixed world height on screen; the fat-pixel sampler keeps texels crisp at any scale
    this.baseViewH = 300;
    this.ppu = h / this.baseViewH;
  }

  get viewH() { return this.baseViewH * this.zoom; }
  get viewW() { return this.viewH * (this.w / this.h); }

  update() {
    if (this.fpv) return this.updateFpv();
    const half = this.viewH / 2;
    const Hc = half * PERSPECTIVE;
    const fov = 2 * Math.atan(1 / PERSPECTIVE);
    this.height = Hc;
    const t = this.tilt;
    const c = Math.cos(t), s = Math.sin(t);
    const tx = this.x + this.shakeX, ty = this.y + this.shakeY;
    const ex = tx, ey = ty + s * Hc, ez = c * Hc;
    this.eye = [ex, ey, ez];
    // rows: r = (1,0,0), u = (0,-c,s), back = (0,s,c); optional roll for shake
    const ca = Math.cos(this.shakeA), sa = Math.sin(this.shakeA);
    const r = [ca, sa * c, -sa * s];
    const u = [sa, -c * ca, s * ca];
    const bk = [0, s, c];
    const V = this.view;
    V[0] = r[0]; V[4] = r[1]; V[8] = r[2]; V[12] = -(r[0] * ex + r[1] * ey + r[2] * ez);
    V[1] = u[0]; V[5] = u[1]; V[9] = u[2]; V[13] = -(u[0] * ex + u[1] * ey + u[2] * ez);
    V[2] = bk[0]; V[6] = bk[1]; V[10] = bk[2]; V[14] = -(bk[0] * ex + bk[1] * ey + bk[2] * ez);
    V[3] = 0; V[7] = 0; V[11] = 0; V[15] = 1;
    this.near = Math.max(4, Hc * 0.05);
    this.far = Hc * 1.3 + 200;
    mat4.perspective(this.proj, fov, this.w / this.h, this.near, this.far);
    mat4.mul(this.vp, this.proj, this.view);
    mat4.invert(this.inv, this.vp);
  }

  // First person: eye at (x, y, eyeZ) looking along yaw and pitch. Same handedness as the top-down view.
  updateFpv() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const f = [cy * cp, sy * cp, sp];
    const ex = this.x + this.shakeX, ey = this.y + this.shakeY, ez = this.eyeZ;
    this.eye = [ex, ey, ez];
    const rl = Math.hypot(f[0], f[1]) || 1;
    const r = [-f[1] / rl, f[0] / rl, 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const bk = [-f[0], -f[1], -f[2]];
    const V = this.view;
    V[0] = r[0]; V[4] = r[1]; V[8] = r[2]; V[12] = -(r[0] * ex + r[1] * ey + r[2] * ez);
    V[1] = u[0]; V[5] = u[1]; V[9] = u[2]; V[13] = -(u[0] * ex + u[1] * ey + u[2] * ez);
    V[2] = bk[0]; V[6] = bk[1]; V[10] = bk[2]; V[14] = -(bk[0] * ex + bk[1] * ey + bk[2] * ez);
    V[3] = 0; V[7] = 0; V[11] = 0; V[15] = 1;
    this.near = 1.5;
    this.far = FPV_RANGE * 1.6;
    mat4.perspective(this.proj, 74 * Math.PI / 180, this.w / this.h, this.near, this.far);
    mat4.mul(this.vp, this.proj, this.view);
    mat4.invert(this.inv, this.vp);
  }

  // Screen pixel (CSS px relative to canvas) to world point on plane z.
  screenToWorld(sx, sy, z = 0) {
    const nx = (sx / this.w) * 2 - 1, ny = 1 - (sy / this.h) * 2;
    const a = this.unproject(nx, ny, -1), b = this.unproject(nx, ny, 1);
    const t = (z - a[2]) / (b[2] - a[2]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  unproject(nx, ny, nz) {
    const m = this.inv;
    const x = m[0] * nx + m[4] * ny + m[8] * nz + m[12];
    const y = m[1] * nx + m[5] * ny + m[9] * nz + m[13];
    const z = m[2] * nx + m[6] * ny + m[10] * nz + m[14];
    const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15];
    return [x / w, y / w, z / w];
  }
  // World point to screen CSS px. Returns null if behind the camera.
  worldToScreen(x, y, z = 0, out = [0, 0]) {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0) return null;
    out[0] = (cx / cw * 0.5 + 0.5) * this.w;
    out[1] = (1 - (cy / cw * 0.5 + 0.5)) * this.h;
    return out;
  }
  // Axis-aligned bounds of the visible ground plane.
  groundBounds(margin = 0) {
    // screen corners above the horizon never hit the ground, so first person culls by range instead
    if (this.fpv) return [this.x - FPV_RANGE - margin, this.y - FPV_RANGE - margin, this.x + FPV_RANGE + margin, this.y + FPV_RANGE + margin];
    const pts = [this.screenToWorld(0, 0), this.screenToWorld(this.w, 0), this.screenToWorld(0, this.h), this.screenToWorld(this.w, this.h)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
  }
}
