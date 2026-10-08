import { createContext, program, texture2D, framebuffer, deleteFramebuffer, buffer } from './gl.js';
import * as SH from './shaders.js';
import { Atlas } from './atlas.js';
import { SpriteBank, InstanceWriter, setupSpriteAttribs, INST_BYTES } from './sprites.js';
import { WorldGfx } from './world-gfx.js';
import { MarkRing, DVERT } from './decals.js';

export const LIGHT_FLOATS = 12;
export const PART_FLOATS = 16;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = createContext(canvas);
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.hdr = !!gl.ext.colorFloat;
    this.quality = { scale: 1, shadows: true, bloom: true };
    gl.disable(gl.CULL_FACE);

    const A = {};
    this.p = {
      ground: program(gl, 'ground', SH.groundVS, SH.groundFS, A),
      decal: program(gl, 'decal', SH.decalVS, SH.decalFS, A),
      building: program(gl, 'building', SH.buildingVS, SH.buildingFS, A),
      sprite: program(gl, 'sprite', SH.spriteVS, SH.spriteFS, A),
      xray: program(gl, 'xray', SH.spriteVS, SH.xrayFS, A),
      sun: program(gl, 'sun', SH.fsVS, SH.sunShadowFS, A),
      light: program(gl, 'light', SH.lightVS, SH.lightFS, A),
      composite: program(gl, 'composite', SH.fsVS, SH.compositeFS, A),
      particle: program(gl, 'particle', SH.particleVS, SH.particleFS, A),
      bPre: program(gl, 'bloomPre', SH.fsVS, SH.bloomPrefilterFS, A),
      bDown: program(gl, 'bloomDown', SH.fsVS, SH.bloomDownFS, A),
      bUp: program(gl, 'bloomUp', SH.fsVS, SH.bloomUpFS, A),
      final: program(gl, 'final', SH.fsVS, SH.finalFS, A),
    };

    this.quadBuf = buffer(gl, gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));
    this.fsVao = gl.createVertexArray();
    gl.bindVertexArray(this.fsVao);
    buffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.groundVao = gl.createVertexArray();
    gl.bindVertexArray(this.groundVao);
    this.groundBuf = buffer(gl, gl.ARRAY_BUFFER, new Float32Array(12), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // dynamic sprite instances
    this.dynBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 4096 * INST_BYTES, gl.DYNAMIC_DRAW);
    this.dynCap = 4096;
    this.dynVao = gl.createVertexArray();
    gl.bindVertexArray(this.dynVao);
    setupSpriteAttribs(gl, this.quadBuf, this.dynBuf);
    this.xrayBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.xrayBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 512 * INST_BYTES, gl.DYNAMIC_DRAW);
    this.xrayCap = 512;
    this.xrayData = new Float32Array(512 * 16);
    this.xrayVao = gl.createVertexArray();
    gl.bindVertexArray(this.xrayVao);
    setupSpriteAttribs(gl, this.quadBuf, this.xrayBuf);

    // lights
    this.lightBuf = gl.createBuffer();
    this.lightCap = 1024;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lightCap * LIGHT_FLOATS * 4, gl.DYNAMIC_DRAW);
    this.lightVao = gl.createVertexArray();
    gl.bindVertexArray(this.lightVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, LIGHT_FLOATS * 4, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }

    // particles
    this.partBuf = gl.createBuffer();
    this.partCap = 4096;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.partCap * PART_FLOATS * 4, gl.DYNAMIC_DRAW);
    this.partVao = gl.createVertexArray();
    gl.bindVertexArray(this.partVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    for (let k = 0; k < 4; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, PART_FLOATS * 4, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    gl.bindVertexArray(null);

    this.atlas = new Atlas(gl, 1024, 28);
    this.bank = new SpriteBank(this.atlas);
    this.marks = new MarkRing(gl, 6000);
    this.marksVao = gl.createVertexArray();
    gl.bindVertexArray(this.marksVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.marks.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, DVERT * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, DVERT * 4, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, DVERT * 4, 20);
    gl.bindVertexArray(null);
    this.visible = [];
    this.stats = { instances: 0, lights: 0, particles: 0, chunks: 0 };
  }

  async initWorld(world, progress) {
    this.world = world;
    this.wg = new WorldGfx(this.gl, this.bank, this.quadBuf);
    await this.wg.build(world, progress);
  }

  resize(cssW, cssH, dpr) {
    const scale = Math.min(dpr, 2) * this.quality.scale;
    const w = Math.max(1, Math.round(cssW * scale)), h = Math.max(1, Math.round(cssH * scale));
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.createTargets();
  }

  createTargets() {
    const gl = this.gl;
    const old = this.t;
    if (old) {
      deleteFramebuffer(gl, old.gbuf);
      deleteFramebuffer(gl, old.shadow);
      deleteFramebuffer(gl, old.light);
      deleteFramebuffer(gl, old.scene);
      gl.deleteFramebuffer(old.sceneP);
      for (const b of old.bloom) deleteFramebuffer(gl, b);
    }
    const w = this.w, h = this.h;
    const F16 = this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR } : { filter: gl.LINEAR };
    const F16N = this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : {};
    const gbuf = framebuffer(gl, w, h, [{}, F16N], true);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const shadow = framebuffer(gl, hw, hh, [{ internal: gl.RG8, format: gl.RG, filter: gl.LINEAR }]);
    const light = framebuffer(gl, hw, hh, [F16]);
    const scene = framebuffer(gl, w, h, [F16]);
    // same colour target with the G-buffer depth attached, for depth-tested particles
    const sceneP = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneP);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene.texs[0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, gbuf.depth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bloom = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < 5; i++) {
      bloom.push(framebuffer(gl, Math.max(1, bw), Math.max(1, bh), [F16]));
      bw >>= 1; bh >>= 1;
    }
    this.t = { gbuf, shadow, light, scene, sceneP, bloom };
  }

  // scene: { cam, tod, time, dyn: InstanceWriter, lights: Float32Array, nLights, parts: {alpha, add}, wet, flash, fade, damage, fadePos }
  render(s) {
    const gl = this.gl;
    const cam = s.cam;
    const T = this.t;
    const wg = this.wg;
    const tod = s.tod;
    const [bx0, by0, bx1, by1] = cam.groundBounds(0);
    const vis = wg.visibleChunks(bx0 - 160, by0 - 160, bx1 + 160, by1 + 160, this.visible);
    this.stats.chunks = vis.length;

    // ---------------------------------------------------------------- G-buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.gbuf.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ground quad
    const gx0 = bx0 - 32, gy0 = by0 - 32, gx1 = bx1 + 32, gy1 = by1 + 32;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([gx0, gy0, gx1, gy0, gx1, gy1, gx0, gy0, gx1, gy1, gx0, gy1]));
    let p = this.p.ground;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
    this.tex(p, 'uMap', 0, wg.mapTex);
    this.texA(p, 'uTex', 1, wg.terrTex);
    this.tex(p, 'uJitter', 2, wg.jitterTex);
    this.tex(p, 'uAO', 3, wg.aoTex);
    this.tex(p, 'uNoise', 4, wg.noiseTex);
    gl.uniform2f(p.u.uMapSize, this.world.w, this.world.h);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uWet, s.wet || 0);
    gl.bindVertexArray(this.groundVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // decals: road markings and dynamic marks, blended over the ground keeping material codes
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false);
    p = this.p.decal;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
    gl.uniform1f(p.u.uWet, s.wet || 0);
    gl.bindVertexArray(wg.dVao);
    gl.drawArrays(gl.TRIANGLES, 0, wg.dCount);
    this.marks.upload();
    if (this.marks.count) {
      gl.bindVertexArray(this.marksVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.marks.count * 6);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // buildings
    p = this.p.building;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
    this.texA(p, 'uWalls', 0, wg.wallTex);
    this.tex(p, 'uPal', 1, wg.palTex);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uNight, tod.night);
    gl.uniform1f(p.u.uWindowLit, tod.windowLit);
    gl.uniform1f(p.u.uWet, s.wet || 0);
    gl.uniform2f(p.u.uFade, s.fadePos[0], s.fadePos[1]);
    gl.bindVertexArray(wg.bVao);
    gl.drawElements(gl.TRIANGLES, wg.bCount, gl.UNSIGNED_INT, 0);

    // sprites
    p = this.p.sprite;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
    this.texA(p, 'uAtlas', 0, this.atlas.tex);
    gl.uniform2f(p.u.uFade, s.fadePos[0], s.fadePos[1]);
    gl.uniform2f(p.u.uShadowVec, tod.shadowVec[0], tod.shadowVec[1]);
    gl.uniform1i(p.u.uShadowPass, 0);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uNight, tod.night);
    let inst = 0;
    for (const c of vis) {
      gl.bindVertexArray(c.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.n);
      inst += c.n;
    }
    const dyn = s.dyn;
    if (dyn.n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
      if (dyn.n > this.dynCap) {
        this.dynCap = dyn.cap;
        gl.bufferData(gl.ARRAY_BUFFER, this.dynCap * INST_BYTES, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn.f32.subarray(0, dyn.n * 16));
      gl.bindVertexArray(this.dynVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dyn.n);
      inst += dyn.n;
    }
    this.stats.instances = inst;

    // ---------------------------------------------------------------- shadows (half res)
    const hw = T.shadow.w, hh = T.shadow.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.shadow.fb);
    gl.viewport(0, 0, hw, hh);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (this.quality.shadows && tod.sunDir[2] > 0.02) {
      // sprite shadows: max caster height projected onto the ground
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.colorMask(false, true, false, false);
      gl.uniform1i(p.u.uShadowPass, 1);
      for (const c of vis) {
        gl.bindVertexArray(c.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.n);
      }
      if (dyn.n) {
        gl.bindVertexArray(this.dynVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dyn.n);
      }
      gl.uniform1i(p.u.uShadowPass, 0);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      // buildings: heightmap ray-march toward the sun
      gl.colorMask(true, false, false, false);
      p = this.p.sun;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uInvVP, false, cam.inv);
      this.tex(p, 'uDepth', 0, T.gbuf.depth);
      this.tex(p, 'uHeight', 1, wg.heightTex);
      gl.uniform3fv(p.u.uSunDir, tod.sunDir);
      gl.uniform2f(p.u.uMapSize, this.world.w, this.world.h);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.colorMask(true, true, true, true);
    }

    // ---------------------------------------------------------------- lights (half res)
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.light.fb);
    gl.viewport(0, 0, T.light.w, T.light.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const nL = s.nLights;
    this.stats.lights = nL;
    if (nL) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      p = this.p.light;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
      gl.uniformMatrix4fv(p.u.uInvVP, false, cam.inv);
      this.tex(p, 'uDepth', 0, T.gbuf.depth);
      this.tex(p, 'uAlbedo', 1, T.gbuf.texs[0]);
      this.tex(p, 'uHeight', 2, wg.heightTex);
      gl.uniform2f(p.u.uMapSize, this.world.w, this.world.h);
      gl.uniform2f(p.u.uScreen, T.light.w, T.light.h);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
      if (nL > this.lightCap) {
        this.lightCap = Math.ceil(nL * 1.5);
        gl.bufferData(gl.ARRAY_BUFFER, this.lightCap * LIGHT_FLOATS * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.lights.subarray(0, nL * LIGHT_FLOATS));
      gl.bindVertexArray(this.lightVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nL);
      gl.disable(gl.BLEND);
    }

    // ---------------------------------------------------------------- composite into HDR scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
    gl.viewport(0, 0, this.w, this.h);
    p = this.p.composite;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uInvVP, false, cam.inv);
    this.tex(p, 'uAlbedo', 0, T.gbuf.texs[0]);
    this.tex(p, 'uEmis', 1, T.gbuf.texs[1]);
    this.tex(p, 'uDepth', 2, T.gbuf.depth);
    this.tex(p, 'uShadow', 3, T.shadow.texs[0]);
    this.tex(p, 'uLight', 4, T.light.texs[0]);
    this.tex(p, 'uNoise', 5, wg.noiseTex);
    gl.uniform3fv(p.u.uAmbient, tod.ambient);
    gl.uniform3fv(p.u.uSunCol, tod.sunCol);
    gl.uniform3fv(p.u.uSunDir, tod.sunDir);
    gl.uniform1f(p.u.uCloudCover, tod.cloudCover);
    gl.uniform1f(p.u.uCloudDark, tod.cloudDark);
    gl.uniform2f(p.u.uWind, 0.0035, 0.0014);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uWet, s.wet || 0);
    gl.uniform1f(p.u.uFlash, s.flash || 0);
    gl.uniform1f(p.u.uNight, tod.night);
    gl.uniform2f(p.u.uShadowSize, T.shadow.w, T.shadow.h);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---------------------------------------------------------------- particles (forward)
    const parts = s.parts;
    this.stats.particles = parts ? parts.nAlpha + parts.nAdd : 0;
    if (parts && (parts.nAlpha || parts.nAdd)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.sceneP);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      p = this.p.particle;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
      this.texA(p, 'uAtlas', 0, this.atlas.tex);
      const lit = [tod.ambient[0] + tod.sunCol[0] * 0.8, tod.ambient[1] + tod.sunCol[1] * 0.8, tod.ambient[2] + tod.sunCol[2] * 0.8];
      gl.uniform3fv(p.u.uLit, lit);
      const total = parts.nAlpha + parts.nAdd;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      if (total > this.partCap) {
        this.partCap = Math.ceil(total * 1.5);
        gl.bufferData(gl.ARRAY_BUFFER, this.partCap * PART_FLOATS * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, parts.data.subarray(0, total * PART_FLOATS));
      gl.bindVertexArray(this.partVao);
      if (parts.nAlpha) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, parts.nAlpha);
      }
      if (parts.nAdd) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        // additive particles live after the alpha ones in the buffer
        this.drawInstancedOffset(this.partVao, this.partBuf, parts.nAlpha, parts.nAdd);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }
    if (s.xray && s.xray.length) this.drawXray(s, cam);

    // ---------------------------------------------------------------- bloom
    const B = T.bloom;
    if (this.quality.bloom) {
      gl.disable(gl.DEPTH_TEST);
      p = this.p.bPre;
      gl.useProgram(p.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, B[0].fb);
      gl.viewport(0, 0, B[0].w, B[0].h);
      this.tex(p, 'uSrc', 0, T.scene.texs[0]);
      gl.uniform2f(p.u.uHalfPixel, 0.5 / this.w, 0.5 / this.h);
      gl.uniform1f(p.u.uThreshold, 1.0);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      p = this.p.bDown;
      gl.useProgram(p.p);
      for (let i = 1; i < B.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B[i].fb);
        gl.viewport(0, 0, B[i].w, B[i].h);
        this.tex(p, 'uSrc', 0, B[i - 1].texs[0]);
        gl.uniform2f(p.u.uHalfPixel, 0.5 / B[i - 1].w, 0.5 / B[i - 1].h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      p = this.p.bUp;
      gl.useProgram(p.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = B.length - 1; i > 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B[i - 1].fb);
        gl.viewport(0, 0, B[i - 1].w, B[i - 1].h);
        this.tex(p, 'uSrc', 0, B[i].texs[0]);
        gl.uniform2f(p.u.uHalfPixel, 0.5 / B[i].w, 0.5 / B[i].h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    // ---------------------------------------------------------------- final
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    p = this.p.final;
    gl.useProgram(p.p);
    this.tex(p, 'uScene', 0, T.scene.texs[0]);
    this.tex(p, 'uBloom', 1, B[0].texs[0]);
    gl.uniform1f(p.u.uBloomStrength, this.quality.bloom ? tod.bloom * 6.0 : 0);
    gl.uniform1f(p.u.uExposure, tod.exposure);
    gl.uniform1f(p.u.uSat, tod.sat * (s.satMul ?? 1));
    gl.uniform1f(p.u.uContrast, tod.contrast);
    gl.uniform3fv(p.u.uLift, tod.lift);
    gl.uniform3fv(p.u.uGain, tod.gain);
    gl.uniform1f(p.u.uVignette, tod.vignette);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uDamage, s.damage || 0);
    gl.uniform1f(p.u.uFade, s.fade ?? 1);
    gl.uniform2f(p.u.uScreen, this.w, this.h);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // Characters hidden behind buildings or canopies get a flat tinted silhouette, so players never lose
  // sight of themselves or friends in alleys.
  drawXray(s, cam) {
    const gl = this.gl;
    const src = s.dyn.f32;
    let n = 0;
    for (const r of s.xray) n += r.e - r.s;
    if (n > this.xrayCap) {
      this.xrayCap = Math.ceil(n * 1.5);
      this.xrayData = new Float32Array(this.xrayCap * 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.xrayBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.xrayCap * INST_BYTES, gl.DYNAMIC_DRAW);
    }
    const out = this.xrayData;
    const u8 = new Uint8Array(out.buffer);
    let k = 0;
    for (const r of s.xray) {
      out.set(src.subarray(r.s * 16, r.e * 16), k * 16);
      for (let i = k; i < k + r.e - r.s; i++) {
        const b = i * INST_BYTES + 44;
        u8[b] = r.c[0]; u8[b + 1] = r.c[1]; u8[b + 2] = r.c[2]; u8[b + 3] = 255;
      }
      k += r.e - r.s;
    }
    const p = this.p.xray;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.t.scene.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, cam.vp);
    this.texA(p, 'uAtlas', 0, this.atlas.tex);
    this.tex(p, 'uDepth', 1, this.t.gbuf.depth);
    gl.uniform2f(p.u.uNearFar, cam.near, cam.far);
    gl.uniform1f(p.u.uAlpha, 0.55);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.xrayBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.subarray(0, n * 16));
    gl.bindVertexArray(this.xrayVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  }

  drawInstancedOffset(vao, buf, offset, count) {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const S = PART_FLOATS * 4;
    for (let k = 0; k < 4; k++) gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, S, k * 16 + offset * S);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    for (let k = 0; k < 4; k++) gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, S, k * 16);
  }

  tex(p, name, unit, t) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (p.u[name]) gl.uniform1i(p.u[name], unit);
  }
  texA(p, name, unit, t) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    if (p.u[name]) gl.uniform1i(p.u[name], unit);
  }
}

export { InstanceWriter };
void texture2D;
