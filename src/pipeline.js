import * as THREE from 'three';
import { buildPaletteData } from './palette.js';
import { U } from './shared.js';

const VERT = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec3 uPal[64];
uniform vec3 uPalRGB[64];
uniform vec3 uSkyTop;
uniform vec3 uSkyBot;
uniform float uStars;
uniform float uRange;
uniform float uThr;

vec3 toOklab(vec3 c){
  float l = pow(max(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b, 0.0), 1.0/3.0);
  float m = pow(max(0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b, 0.0), 1.0/3.0);
  float s = pow(max(0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b, 0.0), 1.0/3.0);
  return vec3(0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
              1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
              0.0259040371*l + 0.7827717662*m - 0.8086757660*s);
}
float bayer4(ivec2 p){
  int x = p.x & 3, y = p.y & 3;
  int m[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  return (float(m[(y*4)+x]) + 0.5) / 16.0;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(tColor, 0);
  float d0 = texelFetch(tDepth, p, 0).r;
  bool sky = d0 >= 0.99999;
  vec3 col;
  if (sky) {
    float t = gl_FragCoord.y / float(sz.y);
    col = mix(uSkyBot, uSkyTop, pow(clamp(t, 0.0, 1.0), 0.85));
    float h = hash(vec2(p));
    col += vec3(step(0.9935, h) * uStars) * step(0.3, t);
  } else {
    col = texelFetch(tColor, p, 0).rgb;
  }
  float dc = d0 * uRange;
  ivec2 mx = sz - 1;
  float dl = texelFetch(tDepth, clamp(p + ivec2(-1,0), ivec2(0), mx), 0).r * uRange;
  float dr = texelFetch(tDepth, clamp(p + ivec2( 1,0), ivec2(0), mx), 0).r * uRange;
  float du = texelFetch(tDepth, clamp(p + ivec2(0, 1), ivec2(0), mx), 0).r * uRange;
  float dd = texelFetch(tDepth, clamp(p + ivec2(0,-1), ivec2(0), mx), 0).r * uRange;
  float lx = dl + dr - 2.0 * dc;
  float ly = du + dd - 2.0 * dc;
  if (min(lx, ly) < -uThr) col *= sky ? 0.55 : 0.4;

  vec3 lab = toOklab(col);
  if (sky) lab.x += (bayer4(p) - 0.5) * 0.07;
  float best = 1e9; int bi = 0;
  for (int i = 0; i < 64; i++) {
    vec3 q = lab - uPal[i];
    float e = dot(q, q);
    if (e < best) { best = e; bi = i; }
  }
  gl_FragColor = vec4(uPalRGB[bi], 1.0);
}
`;

const BLIT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tPal;
uniform vec2 uScale; // canvas device px per art pixel, and rt size
uniform vec2 uRT;
void main(){
  vec2 uv = gl_FragCoord.xy / (uScale * uRT);
  gl_FragColor = texture2D(tPal, uv);
}
`;

function makeTarget(w, h, depthTex, type) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    type, depthBuffer: true, samples: 0,
  });
  if (depthTex) {
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.raw = false;
    this.px = 3;
    this.w = 2; this.h = 2;
    const { lab, rgb } = buildPaletteData();
    this.palUniforms = {
      tColor: { value: null }, tDepth: { value: null },
      uPal: { value: lab.map((v) => new THREE.Vector3(...v)) },
      uPalRGB: { value: rgb.map((v) => new THREE.Vector3(...v)) },
      uSkyTop: { value: new THREE.Color() }, uSkyBot: { value: new THREE.Color() },
      uStars: { value: 0 }, uRange: { value: 1 }, uThr: { value: 0.4 },
    };
    this.palMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: PAL_FRAG, uniforms: this.palUniforms,
      depthTest: false, depthWrite: false,
    });
    this.blitUniforms = { tPal: { value: null }, uScale: { value: new THREE.Vector2(1, 1) }, uRT: { value: new THREE.Vector2(1, 1) } };
    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLIT_FRAG, uniforms: this.blitUniforms,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.palMat);
    this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.quad);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.04);
  }

  /** cssW/H in CSS px, px = CSS px per art pixel. */
  setSize(cssW, cssH, px, dpr, raw) {
    this.raw = raw; this.px = px; this.dpr = dpr; this.cssW = cssW; this.cssH = cssH;
    const r = this.renderer;
    r.setPixelRatio(dpr);
    r.setSize(cssW, cssH, false);
    if (raw) { this.w = Math.max(2, Math.floor(cssW * dpr)); this.h = Math.max(2, Math.floor(cssH * dpr)); }
    else { this.w = Math.max(2, Math.ceil(cssW / px)); this.h = Math.max(2, Math.ceil(cssH / px)); }
    for (const k of ['rtScene', 'rtRefl', 'rtPal']) if (this[k]) this[k].dispose();
    this.rtScene = makeTarget(this.w, this.h, true, THREE.HalfFloatType);
    this.rtRefl = makeTarget(this.w, this.h, false, THREE.HalfFloatType);
    this.rtPal = makeTarget(this.w, this.h, false, THREE.UnsignedByteType);
    this.rtPal.depthBuffer = false;
    U.uRefl.value = this.rtRefl.texture;
    U.uRes.value.set(this.w, this.h);
    this.blitUniforms.uRT.value.set(this.w, this.h);
    this.blitUniforms.uScale.value.setScalar(px * dpr);
  }

  /** world units of depth range for the ortho camera */
  setCamera(camera) {
    this.palUniforms.uRange.value = camera.far - camera.near;
  }

  render(scene, camera, hideForRefl) {
    const r = this.renderer;
    // --- planar reflection: mirror the whole scene about the water plane -------------------
    r.setRenderTarget(this.rtRefl);
    for (const o of hideForRefl) o.visible = false;
    const shadowWas = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    scene.scale.y = -1;
    r.clippingPlanes = [this.clip];
    r.clear();
    r.render(scene, camera);
    r.clippingPlanes = [];
    scene.scale.y = 1;
    r.shadowMap.enabled = shadowWas;
    for (const o of hideForRefl) o.visible = true;

    if (this.raw) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    this.palUniforms.tColor.value = this.rtScene.texture;
    this.palUniforms.tDepth.value = this.rtScene.depthTexture;
    this.quad.material = this.palMat;
    r.setRenderTarget(this.rtPal);
    r.render(this.fsScene, this.fsCam);

    this.blitUniforms.tPal.value = this.rtPal.texture;
    this.quad.material = this.blitMat;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
  }
}
