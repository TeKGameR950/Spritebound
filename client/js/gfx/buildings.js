import { TILE, FLOOR_H, BSTYLE, ROOF } from '/shared/constants.js';
import { SIGN_INDEX } from './art-buildings.js';

// Building mesh: interleaved [pos3, uv2, face1, b0(4), b1(4), b2(2)] = 16 floats per vertex.
export const BVERT = 16;

export function buildBuildingMesh(world) {
  const verts = [];
  const idx = [];
  let n = 0;
  const quad = (p, uv, face, b0, b1, b2) => {
    for (let i = 0; i < 4; i++) verts.push(p[i][0], p[i][1], p[i][2], uv[i][0], uv[i][1], face, ...b0, ...b1, ...b2);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  const tri = (p, uv, face, b0, b1, b2) => {
    for (let i = 0; i < 3; i++) verts.push(p[i][0], p[i][1], p[i][2], uv[i][0], uv[i][1], face, ...b0, ...b1, ...b2);
    idx.push(n, n + 1, n + 2);
    n += 3;
  };
  const box = (x0, y0, x1, y1, z0, z1, face, b0, b1) => {
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[0, z0], [x1 - x0, z0], [x1 - x0, z1], [0, z1]], face, b0, b1, [x1 - x0, 0]);
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[0, z0], [x1 - x0, z0], [x1 - x0, z1], [0, z1]], face, b0, b1, [x1 - x0, 0]);
    quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [[0, z0], [y1 - y0, z0], [y1 - y0, z1], [0, z1]], face, b0, b1, [y1 - y0, 0]);
    quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[0, z0], [y1 - y0, z0], [y1 - y0, z1], [0, z1]], face, b0, b1, [y1 - y0, 0]);
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[0, 0], [x1 - x0, 0], [x1 - x0, y1 - y0], [0, y1 - y0]], face, b0, b1, [x1 - x0, y1 - y0]);
  };

  const walls = (x0, y0, x1, y1, z0, H, b0, b1) => {
    const W = x1 - x0, D = y1 - y0;
    quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, H], [x0, y0, H]], [[0, z0], [W, z0], [W, H], [0, H]], 0, b0, b1, [W, 0]);
    quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, H], [x1, y0, H]], [[0, z0], [D, z0], [D, H], [0, H]], 1, b0, b1, [D, 0]);
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, H], [x0, y1, H]], [[0, z0], [W, z0], [W, H], [0, H]], 2, b0, b1, [W, 0]);
    quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, H], [x0, y0, H]], [[0, z0], [D, z0], [D, H], [0, H]], 3, b0, b1, [D, 0]);
  };

  for (const b of world.buildings) {
    const x0 = b.x * TILE, y0 = b.y * TILE, x1 = (b.x + b.w) * TILE, y1 = (b.y + b.h) * TILE;
    const H = b.floors * FLOOR_H;
    const W = x1 - x0, D = y1 - y0;
    const doorSide = b.door ? b.door.side + 1 : 0;
    const doorT = b.door ? b.door.t : 0;
    const b0 = [b.style, b.wc, b.rc, b.seed % 65536];
    const b1 = [b.floors, doorSide, doorT, 0];

    if (b.style === BSTYLE.LIGHTHOUSE) {
      lighthouse(quad, tri, (x0 + x1) / 2, (y0 + y1) / 2, H, b0, b1);
      continue;
    }
    if (b.open) {
      // gas station canopy: slab on four pillars
      const zs = H - 5;
      for (const [px, py] of [[x0 + 4, y0 + 4], [x1 - 7, y0 + 4], [x0 + 4, y1 - 7], [x1 - 7, y1 - 7]]) box(px, py, px + 3, py + 3, 0, zs, 13, b0, b1);
      const e = 3;
      const X0 = x0 - e, Y0 = y0 - e, X1 = x1 + e, Y1 = y1 + e;
      quad([[X0, Y0, zs], [X1, Y0, zs], [X1, Y0, H], [X0, Y0, H]], [[0, 0], [X1 - X0, 0], [X1 - X0, 5], [0, 5]], 12, b0, b1, [0, 0]);
      quad([[X0, Y1, zs], [X1, Y1, zs], [X1, Y1, H], [X0, Y1, H]], [[0, 0], [X1 - X0, 0], [X1 - X0, 5], [0, 5]], 12, b0, b1, [0, 0]);
      quad([[X0, Y0, zs], [X0, Y1, zs], [X0, Y1, H], [X0, Y0, H]], [[0, 0], [Y1 - Y0, 0], [Y1 - Y0, 5], [0, 5]], 12, b0, b1, [0, 0]);
      quad([[X1, Y0, zs], [X1, Y1, zs], [X1, Y1, H], [X1, Y0, H]], [[0, 0], [Y1 - Y0, 0], [Y1 - Y0, 5], [0, 5]], 12, b0, b1, [0, 0]);
      quad([[X0, Y0, H], [X1, Y0, H], [X1, Y1, H], [X0, Y1, H]], [[0, 0], [X1 - X0, 0], [X1 - X0, Y1 - Y0], [0, Y1 - Y0]], 4, b0, b1, [X1 - X0, Y1 - Y0]);
      continue;
    }

    walls(x0, y0, x1, y1, 0, H, b0, b1);

    // roof
    const ov = b.style === BSTYLE.HOUSE || b.style === BSTYLE.CABIN || b.style === BSTYLE.BEACHHUT ? 3 : 1;
    if (b.roof === ROOF.FLAT || b.roof === ROOF.DOME) {
      quad([[x0, y0, H], [x1, y0, H], [x1, y1, H], [x0, y1, H]], [[0, 0], [W, 0], [W, D], [0, D]], 4, b0, b1, [W, D]);
    } else if (b.roof === ROOF.GABLE_X || b.roof === ROOF.GABLE_Y || b.roof === ROOF.HIP) {
      const alongX = b.roof === ROOF.GABLE_X || (b.roof === ROOF.HIP && W >= D);
      const X0 = x0 - ov, X1 = x1 + ov, Y0 = y0 - ov, Y1 = y1 + ov;
      const ez = H - 1;
      if (alongX) {
        const ym = (y0 + y1) / 2;
        const rh = Math.min(D * 0.42, 26);
        const sl = Math.hypot(ym - Y0, rh);
        const inset = b.roof === ROOF.HIP ? Math.min((Y1 - Y0) / 2, (X1 - X0) / 2 - 4) : 0;
        const rx0 = X0 + inset, rx1 = X1 - inset;
        quad([[X0, Y0, ez], [X1, Y0, ez], [rx1, ym, H + rh], [rx0, ym, H + rh]], [[0, 0], [X1 - X0, 0], [X1 - X0 - inset, sl], [inset, sl]], 5, b0, b1, [0, sl]);
        quad([[X1, Y1, ez], [X0, Y1, ez], [rx0, ym, H + rh], [rx1, ym, H + rh]], [[0, 0], [X1 - X0, 0], [X1 - X0 - inset, sl], [inset, sl]], 7, b0, b1, [0, sl]);
        if (b.roof === ROOF.HIP) {
          const sl2 = Math.hypot(inset, rh);
          tri([[X0, Y1, ez], [X0, Y0, ez], [rx0, ym, H + rh]], [[0, 0], [Y1 - Y0, 0], [(Y1 - Y0) / 2, sl2]], 8, b0, b1, [0, sl2]);
          tri([[X1, Y0, ez], [X1, Y1, ez], [rx1, ym, H + rh]], [[0, 0], [Y1 - Y0, 0], [(Y1 - Y0) / 2, sl2]], 6, b0, b1, [0, sl2]);
        } else {
          tri([[x0, y0, H], [x0, y1, H], [x0, ym, H + rh]], [[0, H], [D, H], [D / 2, H + rh]], 9, b0, [b.floors, doorSide, doorT, 3], [D, 0]);
          tri([[x1, y0, H], [x1, y1, H], [x1, ym, H + rh]], [[0, H], [D, H], [D / 2, H + rh]], 9, b0, [b.floors, doorSide, doorT, 1], [D, 0]);
        }
      } else {
        const xm = (x0 + x1) / 2;
        const rh = Math.min(W * 0.42, 26);
        const sl = Math.hypot(xm - X0, rh);
        const inset = b.roof === ROOF.HIP ? Math.min((X1 - X0) / 2, (Y1 - Y0) / 2 - 4) : 0;
        const ry0 = Y0 + inset, ry1 = Y1 - inset;
        quad([[X1, Y0, ez], [X1, Y1, ez], [xm, ry1, H + rh], [xm, ry0, H + rh]], [[0, 0], [Y1 - Y0, 0], [Y1 - Y0 - inset, sl], [inset, sl]], 6, b0, b1, [0, sl]);
        quad([[X0, Y1, ez], [X0, Y0, ez], [xm, ry0, H + rh], [xm, ry1, H + rh]], [[0, 0], [Y1 - Y0, 0], [Y1 - Y0 - inset, sl], [inset, sl]], 8, b0, b1, [0, sl]);
        if (b.roof === ROOF.HIP) {
          const sl2 = Math.hypot(inset, rh);
          tri([[X0, Y0, ez], [X1, Y0, ez], [xm, ry0, H + rh]], [[0, 0], [X1 - X0, 0], [(X1 - X0) / 2, sl2]], 5, b0, b1, [0, sl2]);
          tri([[X1, Y1, ez], [X0, Y1, ez], [xm, ry1, H + rh]], [[0, 0], [X1 - X0, 0], [(X1 - X0) / 2, sl2]], 7, b0, b1, [0, sl2]);
        } else {
          tri([[x0, y0, H], [x1, y0, H], [xm, y0, H + rh]], [[0, H], [W, H], [W / 2, H + rh]], 9, b0, [b.floors, doorSide, doorT, 0], [W, 0]);
          tri([[x0, y1, H], [x1, y1, H], [xm, y1, H + rh]], [[0, H], [W, H], [W / 2, H + rh]], 9, b0, [b.floors, doorSide, doorT, 2], [W, 0]);
        }
      }
    } else if (b.roof === ROOF.SAWTOOTH) {
      const tw = 32;
      for (let x = x0; x < x1 - 1; x += tw) {
        const xe = Math.min(x1, x + tw);
        const peak = xe - 5;
        const th = 12;
        const sl = Math.hypot(peak - x, th);
        quad([[x, y0, H], [x, y1, H], [peak, y1, H + th], [peak, y0, H + th]], [[0, 0], [D, 0], [D, sl], [0, sl]], 8, [BSTYLE.WAREHOUSE, b.wc, b.rc, b0[3]], b1, [0, sl]);
        quad([[peak, y0, H + th], [peak, y1, H + th], [xe, y1, H], [xe, y0, H]], [[0, 0], [D, 0], [D, 5], [0, 5]], 6, [BSTYLE.WAREHOUSE, b.wc, b.rc, b0[3]], b1, [0, 5]);
        quad([[peak, y0, H + th], [xe, y0, H], [xe, y0, H], [peak, y0, H]], [[0, H + th], [5, H], [5, H], [0, H]], 9, b0, [b.floors, doorSide, doorT, 0], [5, 0]);
        quad([[peak, y1, H + th], [xe, y1, H], [xe, y1, H], [peak, y1, H]], [[0, H + th], [5, H], [5, H], [0, H]], 9, b0, [b.floors, doorSide, doorT, 2], [5, 0]);
        tri([[x, y0, H], [peak, y0, H + th], [peak, y0, H]], [[0, H], [peak - x, H + th], [peak - x, H]], 9, b0, [b.floors, doorSide, doorT, 0], [peak - x, 0]);
        tri([[x, y1, H], [peak, y1, H + th], [peak, y1, H]], [[0, H], [peak - x, H + th], [peak - x, H]], 9, b0, [b.floors, doorSide, doorT, 2], [peak - x, 0]);
      }
    }

    // ship superstructure
    if (b.style === BSTYLE.SHIP) {
      const sx0 = x1 - 44, sx1 = x1 - 16;
      walls(sx0, y0 + 10, sx1, y1 - 10, H, H + 28, [BSTYLE.APARTMENT, 51, 0, b0[3]], [3, 0, 0, 0]);
      quad([[sx0, y0 + 10, H + 28], [sx1, y0 + 10, H + 28], [sx1, y1 - 10, H + 28], [sx0, y1 - 10, H + 28]], [[0, 0], [28, 0], [28, D - 20], [0, D - 20]], 4, [BSTYLE.APARTMENT, 51, 1, b0[3]], b1, [28, D - 20]);
    }

    // awning and sign on the door side
    if (b.door && (b.awn >= 0 || b.sign)) {
      const side = b.door.side;
      const len = side === 0 || side === 2 ? W : D;
      const out = 11, zt = 15, zb = 10.5;
      const a0 = 2, a1 = len - 2;
      const P = (t, o, z) => {
        // t along wall, o outward distance
        if (side === 0) return [x0 + t, y0 - o, z];
        if (side === 2) return [x0 + t, y1 + o, z];
        if (side === 3) return [x0 - o, y0 + t, z];
        return [x1 + o, y0 + t, z];
      };
      if (b.awn >= 0 && b.style !== BSTYLE.GLASS) {
        const sl = Math.hypot(out, zt - zb);
        quad([P(a0, out, zb), P(a1, out, zb), P(a1, 0.3, zt), P(a0, 0.3, zt)], [[a0, 0], [a1, 0], [a1, sl], [a0, sl]], 10, b0, [b.floors, doorSide, doorT, b.awn], [0, 0]);
      }
      if (b.sign && SIGN_INDEX[b.sign] !== undefined) {
        const c = b.door.t * TILE + 8;
        const s0 = c - 8, s1 = c + 8;
        const z0 = b.floors >= 2 ? 17 : 6, z1 = z0 + 16;
        quad([P(s0, 0.7, z0), P(s1, 0.7, z0), P(s1, 0.7, z1), P(s0, 0.7, z1)], [[0, 0], [16, 0], [16, 16], [0, 16]], 11, b0, [b.floors, doorSide, doorT, SIGN_INDEX[b.sign]], [0, 0]);
      }
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx), count: idx.length };
}

function lighthouse(quad, tri, cx, cy, H, b0, b1) {
  const R = 22, R2 = 13, n = 8;
  const pt = (r, i, z) => [cx + Math.cos((i / n) * Math.PI * 2 + Math.PI / 8) * r, cy + Math.sin((i / n) * Math.PI * 2 + Math.PI / 8) * r, z];
  const faceOf = (i) => {
    const a = ((i + 0.5) / n) * Math.PI * 2 + Math.PI / 8;
    const dx = Math.cos(a), dy = Math.sin(a);
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
    return dy > 0 ? 2 : 0;
  };
  const side = 2 * R * Math.sin(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const f = faceOf(i);
    quad([pt(R, i, 0), pt(R, i + 1, 0), pt(R, i + 1, H), pt(R, i, H)], [[i * side, 0], [(i + 1) * side, 0], [(i + 1) * side, H], [i * side, H]], f, b0, [b1[0], i === 6 ? 1 : 0, 0, 0], [side, 0]);
    const s2 = 2 * R2 * Math.sin(Math.PI / n);
    quad([pt(R2, i, H), pt(R2, i + 1, H), pt(R2, i + 1, H + 14), pt(R2, i, H + 14)], [[0, 0], [s2, 0], [s2, 14], [0, 14]], 14, b0, b1, [0, 0]);
    tri([pt(R2 + 2, i, H + 14), pt(R2 + 2, i + 1, H + 14), [cx, cy, H + 26]], [[0, 0], [s2, 0], [s2 / 2, 14]], 5 + f, b0, b1, [0, 14]);
    // gallery deck
    quad([pt(R2, i, H), pt(R2, i + 1, H), pt(R + 2, i + 1, H), pt(R + 2, i, H)], [[0, 0], [side, 0], [side, 9], [0, 9]], 4, [11, 52, 0, b0[3]], b1, [400, 400]);
  }
}
