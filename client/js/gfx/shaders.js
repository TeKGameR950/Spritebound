// GLSL sources. World: x right, y down (south), z up. 1 tile = 16 units.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
`;

const COMMON = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float bayer4(vec2 fc) {
  ivec2 p = ivec2(mod(fc, 4.0));
  int i = p.y * 4 + p.x;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}
// Crisp texels with a one-pixel anti-aliased edge at any zoom (requires LINEAR sampling).
vec2 pixelUV(vec2 uv, vec2 texSize) {
  vec2 p = uv * texSize;
  vec2 i = floor(p + 0.5);
  vec2 f = fract(p + 0.5);
  vec2 w = fwidth(p) * 0.75;
  f = smoothstep(0.5 - w, 0.5 + w, f);
  return (i + f - 0.5) / texSize;
}
`;

// Material codes written to albedo.a (code / 255).
export const MAT = { GROUND: 1, OBJECT: 2, ROOF: 3, WALL_N: 4, WALL_E: 5, WALL_S: 6, WALL_W: 7, SLOPE_N: 8, SLOPE_E: 9, SLOPE_S: 10, SLOPE_W: 11, WATER: 12, UNLIT: 13, FOLIAGE: 14 };

// ------------------------------------------------------------------ ground
export const groundVS = HEAD + `
layout(location=0) in vec2 aPos;
uniform mat4 uVP;
out vec2 vWorld;
void main() { vWorld = aPos; gl_Position = uVP * vec4(aPos, 0.0, 1.0); }
`;

export const groundFS = HEAD + COMMON + `
in vec2 vWorld;
uniform sampler2D uMap;        // R8 terrain ids
uniform sampler2DArray uTex;   // terrain textures (LINEAR, REPEAT)
uniform sampler2D uJitter;     // RGBA noise (LINEAR, REPEAT)
uniform sampler2D uAO;         // ambient occlusion (LINEAR)
uniform sampler2D uNoise;      // fbm (LINEAR, REPEAT)
uniform vec2 uMapSize;         // tiles
uniform float uTime;
uniform float uWet;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oEmis;

int terr(vec2 p) {
  ivec2 t = clamp(ivec2(floor(p / 16.0)), ivec2(0), ivec2(uMapSize) - 1);
  return int(texelFetch(uMap, t, 0).r * 255.0 + 0.5);
}
bool natural(int id) { return id <= 5 || id == 18; }
bool water(int id) { return id == 0 || id == 1; }
bool roadLike(int id) { return id == 6 || id == 12 || id == 9 || id == 16; }
bool landNatural(int id) { return id >= 2 && id <= 5; }

void main() {
  vec2 p = vWorld;
  vec2 pf = floor(p) + 0.5;
  int id0 = terr(pf);
  vec2 j = (texture(uJitter, pf / 96.0).rg - 0.5) * 12.0;
  int idj = terr(pf + j);
  int id = (natural(id0) && natural(idj)) ? idj : id0;
  vec2 uv = pixelUV(p / 128.0, vec2(128.0));
  vec3 col = texture(uTex, vec3(uv, float(id))).rgb;
  float macro = texture(uNoise, p / 1800.0).b;
  float mat = 1.0;
  vec3 emis = vec3(0.0);

  if (water(id) || id == 15) {
    // animated pixel water
    vec2 q = floor(p / 2.0) * 2.0;
    float t = uTime;
    float w1 = texture(uNoise, q / 420.0 + vec2(t * 0.006, t * 0.004)).r;
    float w2 = texture(uNoise, q / 230.0 - vec2(t * 0.009, -t * 0.007)).g;
    float wave = w1 * 0.6 + w2 * 0.4;
    vec3 deep = vec3(0.10, 0.30, 0.50), shallow = vec3(0.22, 0.55, 0.72), pool = vec3(0.42, 0.82, 0.90);
    vec3 base = id == 0 ? deep : id == 1 ? shallow : pool;
    col = base * (0.86 + wave * 0.28);
    float bands = fract(wave * 5.0 + t * 0.04);
    if (bands > 0.95) col = mix(col, vec3(0.7, 0.88, 1.0), 0.22);
    // shore foam: count land around
    float shore = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785;
      vec2 o = vec2(cos(a), sin(a));
      int n1 = terr(pf + o * 5.0 + j * 0.4);
      int n2 = terr(pf + o * 10.0 + j * 0.4);
      if (!water(n1) && n1 != 15) shore += 0.18;
      if (!water(n2) && n2 != 15) shore += 0.07;
    }
    shore = clamp(shore, 0.0, 1.0);
    if (id != 15) {
      float foamWave = sin(shore * 9.0 - t * 1.6 + w1 * 6.0);
      if (shore > 0.15 && foamWave > 0.55) col = mix(col, vec3(0.92, 0.97, 1.0), 0.75 * shore);
      col = mix(col, vec3(0.55, 0.78, 0.82), shore * 0.25);
    }
    mat = 12.0;
  } else {
    col *= 0.93 + macro * 0.14;
    // per-tile subtle variation for natural ground
    if (natural(id)) col *= 0.97 + hash12(floor(p / 16.0)) * 0.06;
    // edges between surfaces
    int nE = terr(pf + vec2(1.5, 0.0)), nW = terr(pf - vec2(1.5, 0.0)), nS = terr(pf + vec2(0.0, 1.5)), nN = terr(pf - vec2(0.0, 1.5));
    int nE2 = terr(pf + vec2(3.0, 0.0)), nW2 = terr(pf - vec2(3.0, 0.0)), nS2 = terr(pf + vec2(0.0, 3.0)), nN2 = terr(pf - vec2(0.0, 3.0));
    if (id == 7 || id == 8 || id == 13 || id == 19) {
      // raised curb toward roads
      bool c1 = roadLike(nE) || roadLike(nW) || roadLike(nS) || roadLike(nN);
      bool c2 = roadLike(nE2) || roadLike(nW2) || roadLike(nS2) || roadLike(nN2);
      if (c1) col = vec3(0.62, 0.60, 0.57);
      else if (c2) col = vec3(0.86, 0.84, 0.80);
    }
    if (roadLike(id)) {
      bool g1 = nE == 7 || nW == 7 || nS == 7 || nN == 7 || nE == 8 || nW == 8 || nS == 8 || nN == 8;
      if (g1) col *= 0.72;
    }
    if (landNatural(id) && id != 2) {
      bool hard = !natural(nE) || !natural(nW) || !natural(nS) || !natural(nN);
      if (hard && nE != 14 && nW != 14 && nS != 14 && nN != 14) col *= 0.82;
    }
    if (id == 2) {
      // wet sand near water
      float wet = 0.0;
      for (int k = 0; k < 4; k++) {
        float a = float(k) * 1.5708 + 0.4;
        vec2 o = vec2(cos(a), sin(a));
        if (water(terr(pf + o * 6.0 + j * 0.4))) wet += 0.5;
        if (water(terr(pf + o * 14.0 + j * 0.4))) wet += 0.25;
      }
      col *= 1.0 - clamp(wet, 0.0, 1.0) * 0.22;
    }
    float ao = texture(uAO, p / (uMapSize * 16.0)).r;
    col *= 1.0 - ao * 0.5;
    // rain wetness: porous surfaces darken
    if (uWet > 0.0) {
      float por = roadLike(id) ? 1.0 : (id == 7 || id == 8 || id == 11) ? 0.7 : 0.45;
      col *= mix(1.0, 0.62, uWet * por);
    }
  }
  oAlbedo = vec4(col, mat / 255.0);
  oEmis = vec4(emis, 0.0);
}
`;

// ------------------------------------------------------------------ decals (road markings, skids)
export const decalVS = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
uniform mat4 uVP;
out vec2 vUV;
out vec4 vCol;
out vec2 vWorld;
void main() { vUV = aUV; vCol = aCol; vWorld = aPos.xy; gl_Position = uVP * vec4(aPos, 1.0); }
`;
export const decalFS = HEAD + COMMON + `
in vec2 vUV;
in vec4 vCol;
in vec2 vWorld;
uniform float uWet;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oEmis;
void main() {
  // worn paint: break up markings with noise
  float wear = hash12(floor(vWorld));
  float a = vCol.a;
  if (vUV.x > 0.5) { if (wear < 0.18) a *= 0.35; }
  if (a <= 0.004) discard;
  vec3 c = vCol.rgb * mix(1.0, 0.7, uWet);
  oAlbedo = vec4(c, a);
  oEmis = vec4(0.0);
}
`;

// ------------------------------------------------------------------ buildings
export const buildingVS = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aFace;
layout(location=3) in vec4 aB0;
layout(location=4) in vec4 aB1;
layout(location=5) in vec2 aB2;
uniform mat4 uVP;
out vec2 vUV;
flat out float vFace;
flat out vec4 vB0;
flat out vec4 vB1;
flat out vec2 vB2;
out vec3 vWorld;
void main() {
  vUV = aUV; vFace = aFace; vB0 = aB0; vB1 = aB1; vB2 = aB2; vWorld = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

export const buildingFS = HEAD + COMMON + `
in vec2 vUV;
flat in float vFace;
flat in vec4 vB0;
flat in vec4 vB1;
flat in vec2 vB2;
in vec3 vWorld;
uniform sampler2DArray uWalls;
uniform sampler2D uPal;        // palette rows: 0 walls, 1 roofs, 2 flat roofs, 3 awnings, 4 containers, 5 ships
uniform float uTime;
uniform float uNight;          // 0 day .. 1 night
uniform float uWindowLit;      // probability a window is lit
uniform float uWet;
uniform vec2 uFade;            // player position for fading roofs of open structures
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oEmis;

vec3 pal(int idx, int row) { return texelFetch(uPal, ivec2(idx, row), 0).rgb; }

void main() {
  int face = int(vFace + 0.5);
  int style = int(vB0.x + 0.5);
  int wc = int(vB0.y + 0.5);
  int rc = int(vB0.z + 0.5);
  float seed = vB0.w;
  int floors = int(vB1.x + 0.5);
  int doorSide = int(vB1.y + 0.5) - 1;
  int doorT = int(vB1.z + 0.5);
  float extra = vB1.w;
  vec3 wallCol = style == 14 ? pal(wc, 4) : style == 15 ? pal(wc, 5) : pal(wc, 0);
  vec3 col = vec3(1.0, 0.0, 1.0);
  vec3 emis = vec3(0.0);
  float mat = 3.0;

  // open structures (gas canopy): fade when the player stands underneath
  if (style == 17 && face >= 4) {
    float d = distance(vWorld.xy, uFade);
    float a = smoothstep(30.0, 70.0, d);
    if (a < 1.0 && bayer4(gl_FragCoord.xy) > max(a, 0.3)) discard;
  }

  if (face <= 3 || face == 9) {
    // walls
    float u = vUV.x, v = vUV.y;
    int column = int(floor(u / 16.0));
    int fl = int(floor(v / 16.0));
    int tx = int(mod(floor(u), 16.0));
    int ty = 15 - int(mod(floor(v), 16.0));
    int row = fl == 0 ? 1 : 0;
    float hb = hash12(vec2(seed, 3.7));
    int base = int(hb * 8.0);
    float hc = hash12(vec2(seed + float(column) * 7.0 + float(face) * 31.0, float(fl) * 3.1));
    int cellX = (base + (hc < 0.18 ? 1 : 0)) % 8;
    if (fl == 0) cellX = int(hash12(vec2(seed + float(face), float(column))) * 8.0);
    if (face == 9) { row = 3; cellX = 0; }
    if (fl == 0 && face == doorSide && column == doorT) { row = 2; cellX = int(hb * 2.0); }
    if (style == 7 && fl == 0 && face == doorSide && (column == doorT || column == doorT + 1)) { row = 2; cellX = column == doorT ? 0 : 1; }
    if (style == 12 && fl == 0 && column % 3 != 0) { row = 1; cellX = column % 2; }
    vec4 t = texelFetch(uWalls, ivec3(cellX * 16 + tx, row * 16 + ty, style), 0);
    int m = int(t.a * 255.0 + 0.5);
    if (m >= 250) {
      col = t.rgb * wallCol * 1.18;
    } else if (m >= 210) {
      col = t.rgb;
    } else if (m >= 195) {
      col = t.rgb;
    } else if (m >= 170) {
      // glass
      float h = hash13(vec3(seed, float(fl) * 13.0 + float(face), float(column)));
      float lit = step(h, uWindowLit);
      float sky = float(ty) / 15.0;
      vec3 dayGlass = mix(t.rgb * 1.1, vec3(0.62, 0.78, 0.92), 0.35 * (1.0 - sky));
      if (tx + ty < 9 && tx > ty) dayGlass += 0.12;
      col = mix(dayGlass, t.rgb * 0.55, uNight * 0.85);
      if (lit > 0.5) {
        float k = hash12(vec2(h * 91.0, seed));
        vec3 warm = k < 0.55 ? vec3(1.0, 0.78, 0.45) : k < 0.8 ? vec3(1.0, 0.62, 0.32) : k < 0.94 ? vec3(0.85, 0.9, 1.0) : vec3(0.45, 0.6, 1.0) * (0.75 + 0.25 * sin(uTime * 7.0 + h * 40.0));
        float curtain = t.r > t.b + 0.15 ? 0.6 : 1.0;
        emis = warm * 0.8 * curtain * uNight;
        col = mix(col, warm * 0.6, uNight);
      }
    } else if (m >= 140) {
      col = t.rgb;
      emis = t.rgb * (0.6 + 1.2 * uNight);
    } else {
      col = t.rgb;
    }
    // cornice and base grime
    float topV = float(floors) * 16.0;
    if (face != 9 && v > topV - 2.0) col *= 0.82;
    if (v < 1.5) col *= 0.8;
    mat = float(4 + (face == 9 ? int(extra) : face));
  } else if (face == 4) {
    // flat roof with parapet
    vec2 r = vUV;
    vec2 sz = vB2;
    float edge = min(min(r.x, sz.x - r.x), min(r.y, sz.y - r.y));
    int rx = int(mod(floor(r.x), 32.0)), ry = int(mod(floor(r.y), 32.0));
    float hb = hash12(vec2(seed, 9.1));
    float hk = hash12(vec2(seed, 2.3));
    int ox = hb < 0.35 ? 0 : hb < 0.6 ? 32 : hb < 0.85 ? 96 : 0, oy = hb < 0.6 ? 64 : 96;
    if (hb >= 0.85) { ox = 32; oy = 96; }
    if (style == 3 || style == 4) { ox = 32; oy = 96; }
    if (style == 7 || style == 17) { ox = 0; oy = 96; }
    if (style == 14) { ox = 0; oy = 64; }
    if (style == 15) { ox = 64; oy = 96; }
    vec4 t = texelFetch(uWalls, ivec3(ox + rx, oy + ry, style), 0);
    int m = int(t.a * 255.0 + 0.5);
    vec3 roofTint = style == 14 ? wallCol : style == 15 ? vec3(1.0) : pal(int(hk * 8.0), 2);
    col = m >= 250 ? t.rgb * roofTint * 1.15 : m == 120 ? t.rgb * roofTint * 1.1 : t.rgb;
    // membrane seams and skylights on larger roofs
    if (style != 14 && style != 15 && style != 17) {
      vec2 cell = floor(r / 48.0);
      vec2 cf = mod(r, 48.0);
      float hs = hash12(cell + seed * 0.37);
      if (sz.x > 90.0 && sz.y > 70.0 && hs < 0.22 && cf.x > 14.0 && cf.x < 34.0 && cf.y > 18.0 && cf.y < 30.0 && edge > 8.0) {
        bool frame = cf.x < 15.0 || cf.x > 33.0 || cf.y < 19.0 || cf.y > 29.0 || abs(cf.x - 24.0) < 0.6;
        col = frame ? vec3(0.78, 0.8, 0.82) : mix(vec3(0.32, 0.45, 0.58), vec3(0.6, 0.75, 0.88), cf.y / 30.0 - 0.4);
        if (!frame) emis = vec3(1.0, 0.85, 0.6) * 0.5 * uNight * step(0.4, hash12(cell + 3.0));
      } else if (hk > 0.55 && (mod(r.x + 6.0, 40.0) < 1.0 || mod(r.y + 9.0, 56.0) < 1.0)) {
        col *= 0.86;
      }
    }
    if (style == 15) {
      // cargo ship: rows of containers on deck
      vec2 cg = floor(r / vec2(24.0, 10.0));
      vec2 cf = mod(r, vec2(24.0, 10.0));
      if (r.x > 30.0 && r.x < sz.x - 50.0 && r.y > 8.0 && r.y < sz.y - 8.0) {
        col = pal(int(hash12(cg + seed) * 8.0), 4) * (cf.y < 1.0 || cf.x < 1.0 ? 0.6 : (mod(cf.x, 3.0) < 1.0 ? 0.85 : 1.0));
      }
      if (r.x > sz.x - 40.0 && r.x < sz.x - 18.0 && r.y > 10.0 && r.y < sz.y - 10.0) col = vec3(0.92, 0.92, 0.9);
    }
    if (style != 14 && style != 15 && style != 17) {
      if (edge < 2.0) col = wallCol * (edge < 1.0 ? 1.08 : 0.92);
      else if (edge < 3.0) col *= 0.72;
    } else if (edge < 1.0) col *= 0.8;
    if (uWet > 0.0) col *= mix(1.0, 0.8, uWet);
    mat = 3.0;
  } else if (face >= 5 && face <= 8) {
    // sloped roof: shingles along the slope
    vec3 rcol = pal(rc, 1);
    int sx = int(mod(floor(vUV.x), 32.0)), sy = int(mod(floor(vUV.y), 32.0));
    int ox = style == 7 ? 32 : 64;
    vec4 t = texelFetch(uWalls, ivec3(ox + sx, 64 + sy, style == 7 ? 7 : 0), 0);
    col = t.rgb * rcol * 1.2;
    if (style == 13) col = vec3(0.72, 0.2, 0.18) * t.r * 1.2;
    if (vUV.y > vB2.y - 1.5) col *= 1.15;
    mat = float(face + 3);
  } else if (face == 10) {
    // striped awning with scalloped edge
    vec3 ac = pal(int(extra), 3);
    float stripe = mod(floor(vUV.x / 4.0), 2.0);
    col = stripe > 0.5 ? ac : vec3(0.96, 0.94, 0.9);
    if (vUV.y < 1.5 && mod(vUV.x, 4.0) > 2.0 && vUV.y < 0.8) discard;
    col *= vUV.y < 1.5 ? 0.85 : 1.0;
    mat = 3.0;
  } else if (face == 11) {
    // shop sign board
    int idx = int(extra);
    int tx = clamp(int(vUV.x), 0, 15), ty = clamp(15 - int(vUV.y), 0, 15);
    vec4 t = texelFetch(uWalls, ivec3((idx % 8) * 16 + tx, (idx / 8) * 16 + ty, 20), 0);
    int m = int(t.a * 255.0 + 0.5);
    col = t.rgb;
    if (m >= 140 && m < 170) {
      float flick = 0.85 + 0.15 * step(0.08, hash12(vec2(floor(uTime * 8.0), seed)));
      emis = t.rgb * (0.8 + 1.6 * uNight) * flick;
    }
    mat = float(4 + doorSide);
  } else if (face == 12) {
    col = mod(vUV.y, 8.0) < 4.0 ? vec3(0.85, 0.25, 0.2) : vec3(0.95);
    mat = 4.0;
  } else if (face == 13) {
    col = vec3(0.78, 0.78, 0.8);
    mat = 4.0;
  } else if (face == 14) {
    // lighthouse lantern room
    col = vec3(0.9, 0.95, 1.0);
    emis = vec3(1.0, 0.92, 0.7) * (0.4 + 2.0 * uNight);
    mat = 13.0;
  }
  oAlbedo = vec4(col, mat / 255.0);
  oEmis = vec4(emis, 0.0);
}
`;

// ------------------------------------------------------------------ sprites (stacked voxel slices)
export const spriteVS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in vec2 iSize;
layout(location=3) in float iAngle;
layout(location=4) in vec4 iUV;
layout(location=5) in float iLayer;
layout(location=6) in vec4 iTint;
layout(location=7) in vec4 iParams;   // flags, alpha, material, extra (0..255)
layout(location=8) in float iSeed;
uniform mat4 uVP;
uniform vec2 uFade;
uniform vec2 uShadowVec;
uniform int uShadowPass;
out vec3 vUV;
out vec4 vTint;
flat out vec4 vParams;
flat out float vAlpha;
flat out float vZ;
flat out float vSeed;
void main() {
  vec2 c = aCorner * iSize;
  float s = sin(iAngle), co = cos(iAngle);
  vec2 p = iPos.xy + vec2(c.x * co - c.y * s, c.x * s + c.y * co);
  float flags = iParams.x * 255.0;
  float alpha = iParams.y;
  // bit 1 (2): canopy fade near the local player
  if (mod(floor(flags / 2.0), 2.0) > 0.5) {
    float d = distance(iPos.xy, uFade);
    alpha = min(alpha, mix(0.22, 1.0, smoothstep(16.0, 34.0, d)));
  }
  vec3 wp = vec3(p, iPos.z);
  if (uShadowPass == 1) wp = vec3(p + uShadowVec * iPos.z, 0.05);
  gl_Position = uVP * vec4(wp, 1.0);
  vUV = vec3(mix(iUV.xy, iUV.zw, aCorner + 0.5), iLayer);
  vTint = iTint;
  vParams = iParams * 255.0;
  vAlpha = alpha;
  vZ = iPos.z;
  vSeed = iSeed;
}
`;

export const spriteFS = HEAD + COMMON + `
in vec3 vUV;
in vec4 vTint;
flat in vec4 vParams;
flat in float vAlpha;
flat in float vZ;
flat in float vSeed;
uniform sampler2DArray uAtlas;
uniform float uTime;
uniform float uNight;
uniform int uShadowPass;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oEmis;
void main() {
  vec2 ts = vec2(textureSize(uAtlas, 0).xy);
  vec4 t = texture(uAtlas, vec3(pixelUV(vUV.xy, ts), vUV.z));
  if (t.a < 0.5) discard;
  if (vAlpha < 0.999 && bayer4(gl_FragCoord.xy) > vAlpha) discard;
  if (uShadowPass == 1) {
    if (mod(floor(vParams.x / 64.0), 2.0) > 0.5) discard;
    oAlbedo = vec4(0.0, clamp(vZ / 64.0, 0.02, 1.0), 0.0, 1.0);
    return;
  }
  float code = texelFetch(uAtlas, ivec3(ivec2(vUV.xy * ts), int(vUV.z)), 0).a * 255.0;
  float flags = vParams.x;
  bool lights = mod(flags, 2.0) > 0.5;             // bit 0: vehicle lights on
  bool brake = mod(floor(flags / 4.0), 2.0) > 0.5;  // bit 2
  bool siren = mod(floor(flags / 8.0), 2.0) > 0.5;  // bit 3
  bool reverse = mod(floor(flags / 16.0), 2.0) > 0.5; // bit 4
  bool hit = mod(floor(flags / 32.0), 2.0) > 0.5;   // bit 5: hit flash
  vec3 col = mix(t.rgb, t.rgb * vTint.rgb, vTint.a);
  vec3 emis = vec3(0.0);
  if (code > 245.5 && code < 252.5) emis = t.rgb * 1.3;
  else if (code > 237.5 && code < 242.5) emis = t.rgb * 1.6 * uNight;
  else if (code > 227.5 && code < 232.5) { if (lights) emis = t.rgb * 2.4; }
  else if (code > 217.5 && code < 222.5) { emis = t.rgb * ((lights ? 0.9 : 0.0) + (brake ? 1.8 : 0.0)); }
  else if (code > 207.5 && code < 212.5) { if (siren) emis = vec3(1.0, 0.15, 0.1) * 3.0 * step(0.5, fract(uTime * 2.5)); }
  else if (code > 197.5 && code < 202.5) { if (siren) emis = vec3(0.15, 0.3, 1.0) * 3.0 * step(0.5, fract(uTime * 2.5 + 0.5)); }
  else if (code > 177.5 && code < 182.5) { float sh = hash12(floor(vUV.xy * ts) + floor(uTime * 3.0)); col *= 0.9 + 0.2 * sh; emis = t.rgb * (0.08 + 0.25 * uNight); }
  else if (code > 167.5 && code < 172.5) { float f = 0.7 + 0.3 * sin(uTime * 13.0 + vSeed) * sin(uTime * 7.3 + vSeed * 2.0); emis = vec3(1.0, 0.5, 0.15) * 2.4 * f; }
  else if (code > 157.5 && code < 162.5) { emis = t.rgb * 2.5 * step(0.55, fract(uTime * 0.8 + vSeed)) * max(uNight, 0.25); }
  else if (code > 147.5 && code < 152.5) { if (reverse) emis = vec3(1.0) * 1.5; }
  if (hit) { col = mix(col, vec3(1.0), 0.75); }
  oAlbedo = vec4(col, vParams.z / 255.0);
  oEmis = vec4(emis, 0.0);
}
`;

// ------------------------------------------------------------------ fullscreen helpers
export const fsVS = HEAD + `
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const WORLDPOS = `
uniform mat4 uInvVP;
vec3 worldFromDepth(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c;
  return w.xyz / w.w;
}
vec3 faceNormal(int code) {
  if (code == 4) return vec3(0.0, -1.0, 0.0);
  if (code == 5) return vec3(1.0, 0.0, 0.0);
  if (code == 6) return vec3(0.0, 1.0, 0.0);
  if (code == 7) return vec3(-1.0, 0.0, 0.0);
  if (code == 8) return normalize(vec3(0.0, -0.8, 1.0));
  if (code == 9) return normalize(vec3(0.8, 0.0, 1.0));
  if (code == 10) return normalize(vec3(0.0, 0.8, 1.0));
  if (code == 11) return normalize(vec3(-0.8, 0.0, 1.0));
  return vec3(0.0, 0.0, 1.0);
}
`;

// Sun visibility via a ray-march through the building heightmap (half resolution).
export const sunShadowFS = HEAD + WORLDPOS + `
in vec2 vUV;
uniform sampler2D uDepth;
uniform sampler2D uHeight;     // R8: height / 2 units per tile
uniform vec3 uSunDir;          // toward the sun, normalised, z up
uniform vec2 uMapSize;
out vec4 oCol;
void main() {
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oCol = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 p = worldFromDepth(vUV, d);
  p.xy = floor(p.xy) + 0.5;
  if (uSunDir.z <= 0.01) { oCol = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float lxy = max(length(uSunDir.xy), 1e-3);
  vec2 dir = uSunDir.xy / lxy;
  float rise = max(uSunDir.z / lxy, 0.16);
  float vis = 1.0;
  float t = 1.5;
  p.z += 0.6;
  for (int i = 0; i < 56; i++) {
    vec3 q = p + vec3(dir * t, rise * t);
    if (q.z > 500.0) break;
    ivec2 tc = ivec2(floor(q.xy / 16.0));
    if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) break;
    float h = texelFetch(uHeight, tc, 0).r * 510.0;
    vis = min(vis, clamp(5.0 * (q.z - h) / t + 1.0, 0.0, 1.0));
    if (vis <= 0.0) break;
    t += max(2.5, t * 0.075);
  }
  oCol = vec4(vis, 0.0, 0.0, 1.0);
}
`;

// ------------------------------------------------------------------ lights
export const lightVS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPos;     // x, y, z, radius
layout(location=2) in vec4 iColor;   // rgb * intensity, occlusion flag
layout(location=3) in vec4 iCone;    // dirX, dirY, cosOuter (-2 omni), cosInner
uniform mat4 uVP;
flat out vec4 vPos;
flat out vec4 vColor;
flat out vec4 vCone;
void main() {
  vec2 p = iPos.xy + aCorner * iPos.w * 2.0;
  vPos = iPos; vColor = iColor; vCone = iCone;
  gl_Position = uVP * vec4(p, 0.0, 1.0);
}
`;

export const lightFS = HEAD + WORLDPOS + `
flat in vec4 vPos;
flat in vec4 vColor;
flat in vec4 vCone;
uniform sampler2D uDepth;
uniform sampler2D uAlbedo;
uniform sampler2D uHeight;
uniform vec2 uMapSize;
uniform vec2 uScreen;          // light buffer size
out vec4 oCol;
void main() {
  vec2 uv = gl_FragCoord.xy / uScreen;
  float d = texture(uDepth, uv).r;
  if (d >= 0.99999) discard;
  vec3 p = worldFromDepth(uv, d);
  int code = int(texture(uAlbedo, uv).a * 255.0 + 0.5);
  p.xy = floor(p.xy) + 0.5;
  vec3 L = vPos.xyz - p;
  float dist = length(L);
  float r = vPos.w;
  if (dist > r) discard;
  float x = dist / r;
  float win = clamp(1.0 - x * x * x * x, 0.0, 1.0);
  float att = win * win / (1.0 + 9.0 * x * x);
  if (vCone.z > -1.5) {
    vec2 toP = p.xy - vPos.xy;
    float lt = length(toP);
    float cd = lt > 0.5 ? dot(toP / lt, vCone.xy) : 1.0;
    att *= smoothstep(vCone.z, vCone.w, cd);
    if (lt < 6.0) att *= lt / 6.0;
  }
  vec3 n = faceNormal(code);
  float ndl = max(dot(n, L / max(dist, 0.001)), 0.0) * 0.75 + 0.25;
  if (code == 3 && p.z > vPos.z + 2.0) ndl *= 0.0;
  att *= ndl;
  if (vColor.a > 0.5 && att > 0.002) {
    // occlusion through the building heightmap
    for (int i = 1; i < 10; i++) {
      vec3 q = p + L * (float(i) / 10.0);
      float h = texelFetch(uHeight, clamp(ivec2(floor(q.xy / 16.0)), ivec2(0), ivec2(uMapSize) - 1), 0).r * 510.0;
      if (h > q.z + 1.0) { att = 0.0; break; }
    }
  }
  oCol = vec4(vColor.rgb * att, 1.0);
}
`;

// ------------------------------------------------------------------ composite
export const compositeFS = HEAD + COMMON + WORLDPOS + `
in vec2 vUV;
uniform sampler2D uAlbedo;
uniform sampler2D uEmis;
uniform sampler2D uDepth;
uniform sampler2D uShadow;
uniform sampler2D uLight;
uniform sampler2D uNoise;
uniform vec3 uAmbient;
uniform vec3 uSunCol;
uniform vec3 uSunDir;
uniform float uCloudCover;
uniform float uCloudDark;
uniform vec2 uWind;
uniform float uTime;
uniform float uWet;
uniform float uFlash;
uniform float uNight;
uniform vec2 uShadowSize;
out vec4 oCol;
void main() {
  vec4 alb = texture(uAlbedo, vUV);
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oCol = vec4(0.05, 0.08, 0.12, 1.0); return; }
  vec3 p = worldFromDepth(vUV, d);
  int code = int(alb.a * 255.0 + 0.5);
  vec3 emis = texture(uEmis, vUV).rgb;
  if (code == 13) { oCol = vec4(alb.rgb + emis, 1.0); return; }
  vec3 n = faceNormal(code);
  float sunVis = texture(uShadow, vUV).r;
  // sprite shadows: max caster height over the ground plane; only low surfaces receive them
  vec2 sp = vUV * uShadowSize;
  float caster = texelFetch(uShadow, ivec2(sp), 0).g * 64.0;
  float sprShadow = 0.0;
  if (p.z < 16.0 && caster > p.z + 1.5) sprShadow = 0.82;
  // cloud shadows, projected along the sun
  vec2 cw = p.xy + uSunDir.xy / max(uSunDir.z, 0.2) * (600.0 - p.z);
  float cl = texture(uNoise, cw / 2600.0 + uWind * uTime).r * 0.65 + texture(uNoise, cw / 900.0 + uWind * uTime * 1.7 + 0.31).g * 0.35;
  float cloud = 1.0 - uCloudDark * smoothstep(uCloudCover - 0.1, uCloudCover + 0.1, cl);
  float ndl = max(dot(n, uSunDir), 0.0);
  if (code == 2 || code == 14) ndl = 0.45 + 0.55 * max(uSunDir.z, 0.0);
  vec3 sun = uSunCol * ndl * sunVis * (1.0 - sprShadow) * cloud;
  vec3 amb = uAmbient;
  if (code >= 4 && code <= 7) amb *= (code == 6 ? 1.0 : code == 4 ? 0.82 : 0.9);
  amb *= mix(1.0, 0.9, sprShadow * 0.5);
  amb += vec3(0.9, 0.95, 1.1) * uFlash;
  vec3 light = texture(uLight, vUV).rgb;
  vec3 col = alb.rgb * (amb + sun + light) + emis;
  if (code == 12) {
    // water: sun glints and light reflections
    vec2 g = floor(p.xy / 2.0);
    float sp2 = hash12(g + floor(uTime * 3.0));
    float glint = step(0.994, sp2) * ndl * sunVis * cloud;
    col += uSunCol * glint * 1.6;
    vec3 refl = texture(uLight, vUV + vec2(sin(uTime * 2.0 + p.y * 0.2) * 0.002, 0.012)).rgb;
    col += refl * 0.35;
  }
  if (uWet > 0.0 && (code == 1)) {
    // puddles reflect lights and sky
    float puddle = smoothstep(0.56, 0.64, texture(uNoise, p.xy / 700.0).g) * smoothstep(0.3, 0.8, uWet);
    vec3 refl = texture(uLight, vUV + vec2(0.0, 0.01)).rgb;
    col += refl * (0.25 * uWet + 0.6 * puddle);
    col = mix(col, uAmbient * 0.5, 0.12 * puddle);
  }
  oCol = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ particles (forward, into HDR scene)
export const particleVS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iPos;     // x, y, z, size
layout(location=2) in vec4 iColor;   // rgba
layout(location=3) in vec4 iUV;
layout(location=4) in vec4 iMisc;    // angle, layer, emissive, stretch
uniform mat4 uVP;
out vec3 vUV;
out vec4 vColor;
flat out float vEmis;
void main() {
  float s = sin(iMisc.x), c = cos(iMisc.x);
  vec2 k = aCorner * vec2(iPos.w * max(iMisc.w, 1.0), iPos.w);
  vec2 p = iPos.xy + vec2(k.x * c - k.y * s, k.x * s + k.y * c);
  gl_Position = uVP * vec4(p, iPos.z, 1.0);
  vUV = vec3(mix(iUV.xy, iUV.zw, aCorner + 0.5), iMisc.y);
  vColor = iColor;
  vEmis = iMisc.z;
}
`;
export const particleFS = HEAD + COMMON + `
in vec3 vUV;
in vec4 vColor;
flat in float vEmis;
uniform sampler2DArray uAtlas;
uniform vec3 uLit;
out vec4 oCol;
void main() {
  vec4 t = texture(uAtlas, vUV);
  float a = t.a * vColor.a;
  if (a < 0.01) discard;
  vec3 c = t.rgb * vColor.rgb;
  c = vEmis > 0.0 ? c * vEmis : c * uLit;
  oCol = vec4(c, a);
}
`;

// ------------------------------------------------------------------ bloom (dual Kawase)
export const bloomPrefilterFS = HEAD + `
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uHalfPixel;
uniform float uThreshold;
out vec4 oCol;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += texture(uSrc, vUV - uHalfPixel).rgb;
  c += texture(uSrc, vUV + uHalfPixel).rgb;
  c += texture(uSrc, vUV + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  c += texture(uSrc, vUV - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  c /= 8.0;
  float b = max(c.r, max(c.g, c.b));
  float K = 0.5;
  float s = clamp(b - uThreshold + K, 0.0, 2.0 * K);
  s = s * s / (4.0 * K + 1e-5);
  float w = max(s, b - uThreshold) / max(b, 1e-5);
  oCol = vec4(c * w, 1.0);
}
`;
export const bloomDownFS = HEAD + `
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uHalfPixel;
out vec4 oCol;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += texture(uSrc, vUV - uHalfPixel).rgb;
  c += texture(uSrc, vUV + uHalfPixel).rgb;
  c += texture(uSrc, vUV + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  c += texture(uSrc, vUV - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  oCol = vec4(c / 8.0, 1.0);
}
`;
export const bloomUpFS = HEAD + `
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uHalfPixel;
out vec4 oCol;
void main() {
  vec2 h = uHalfPixel;
  vec3 s = texture(uSrc, vUV + vec2(-h.x * 2.0, 0.0)).rgb + texture(uSrc, vUV + vec2(h.x * 2.0, 0.0)).rgb
         + texture(uSrc, vUV + vec2(0.0, h.y * 2.0)).rgb + texture(uSrc, vUV + vec2(0.0, -h.y * 2.0)).rgb;
  s += 2.0 * (texture(uSrc, vUV + vec2(-h.x, h.y)).rgb + texture(uSrc, vUV + vec2(h.x, h.y)).rgb
            + texture(uSrc, vUV + vec2(h.x, -h.y)).rgb + texture(uSrc, vUV + vec2(-h.x, -h.y)).rgb);
  oCol = vec4(s / 12.0, 1.0);
}
`;

// ------------------------------------------------------------------ final: tonemap + grade
export const finalFS = HEAD + COMMON + `
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uVignette;
uniform float uTime;
uniform float uDamage;
uniform float uFade;
uniform vec2 uScreen;
out vec4 oCol;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * uBloomStrength;
  c = aces(c * uExposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = c * uGain + uLift * (1.0 - c);
  vec2 q = vUV - 0.5;
  float v = 1.0 - dot(q, q) * uVignette;
  c *= v;
  if (uDamage > 0.0) {
    float e = smoothstep(0.25, 0.75, length(q * vec2(uScreen.x / uScreen.y, 1.0)));
    c = mix(c, vec3(0.7, 0.05, 0.05), e * uDamage * 0.6);
  }
  c *= uFade;
  c += (bayer4(gl_FragCoord.xy) - 0.5) / 255.0;
  oCol = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
