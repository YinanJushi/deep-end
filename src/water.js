import * as THREE from 'three';
import { U } from './shared.js';

const CELL = 0.2;
const STEP = 1 / 60;

/** Wave-equation height field on a regular grid (~20 cm cells). Reflecting walls. */
export class WaterField {
  constructor({ x0, z0, w, d, damp = 0.9935, k = 0.075 }) {
    this.x0 = x0; this.z0 = z0; this.w = w; this.d = d;
    this.nx = Math.round(w / CELL); this.nz = Math.round(d / CELL);
    this.cell = w / this.nx;
    this.h = new Float32Array(this.nx * this.nz);
    this.v = new Float32Array(this.nx * this.nz);
    this.damp = damp; this.k = k; this.acc = 0;
    this.data = new Float32Array(this.nx * this.nz * 4);
    this.tex = new THREE.DataTexture(this.data, this.nx, this.nz, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter; this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
  }

  contains(x, z, m = 0) {
    return x > this.x0 + m && x < this.x0 + this.w - m && z > this.z0 + m && z < this.z0 + this.d - m;
  }

  /** smooth bump: amp > 0 raises, amp < 0 pushes the surface down */
  drop(x, z, r, amp) {
    if (!this.contains(x, z)) return;
    const { nx, nz, h, cell } = this;
    const ci = (x - this.x0) / cell, cj = (z - this.z0) / cell;
    const rr = Math.max(r / cell, 0.8);
    const i0 = Math.max(0, Math.floor(ci - rr)), i1 = Math.min(nx - 1, Math.ceil(ci + rr));
    const j0 = Math.max(0, Math.floor(cj - rr)), j1 = Math.min(nz - 1, Math.ceil(cj + rr));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dd = Math.hypot(i + 0.5 - ci, j + 0.5 - cj) / rr;
      if (dd < 1) h[j * nx + i] += amp * 0.5 * (1 + Math.cos(Math.PI * dd));
    }
  }

  height(x, z) {
    if (!this.contains(x, z)) return 0;
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    return this.h[j * this.nx + i];
  }

  step(dt) {
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= STEP && n++ < 3) { this.acc -= STEP; this._sim(); }
    const { data, h, v } = this;
    for (let i = 0, n4 = 0; i < h.length; i++, n4 += 4) { data[n4] = h[i]; data[n4 + 1] = v[i]; }
    this.tex.needsUpdate = true;
  }

  _sim() {
    const { nx, nz, h, v, k, damp } = this;
    for (let j = 0; j < nz; j++) {
      const rowU = (j > 0 ? j - 1 : j) * nx, rowD = (j < nz - 1 ? j + 1 : j) * nx, row = j * nx;
      for (let i = 0; i < nx; i++) {
        const c = h[row + i];
        const lap = h[row + (i > 0 ? i - 1 : i)] + h[row + (i < nx - 1 ? i + 1 : i)] + h[rowU + i] + h[rowD + i] - 4 * c;
        v[row + i] = (v[row + i] + k * lap) * damp;
      }
    }
    for (let i = 0; i < h.length; i++) { h[i] = (h[i] + v[i]) * 0.9997; }
  }
}

const HEIGHT_GLSL = /* glsl */`
uniform sampler2D tH;
uniform vec4 uRect;
uniform vec2 uN;
float H(vec2 xz){
  vec2 g = (xz - uRect.xy) / (uRect.zw / uN) - 0.5;
  vec2 i = floor(g); vec2 f = g - i;
  ivec2 n = ivec2(uN) - 1;
  ivec2 a = clamp(ivec2(i), ivec2(0), n);
  ivec2 b = clamp(ivec2(i) + 1, ivec2(0), n);
  float h00 = texelFetch(tH, ivec2(a.x, a.y), 0).r;
  float h10 = texelFetch(tH, ivec2(b.x, a.y), 0).r;
  float h01 = texelFetch(tH, ivec2(a.x, b.y), 0).r;
  float h11 = texelFetch(tH, ivec2(b.x, b.y), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

const COMMON_UNIFORMS = (field) => ({
  tH: { value: field.tex },
  uRect: { value: new THREE.Vector4(field.x0, field.z0, field.w, field.d) },
  uN: { value: new THREE.Vector2(field.nx, field.nz) },
});

const SURF_VERT = /* glsl */`
varying vec3 vW; varying vec3 vN;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export function waterMaterial(field, alpha) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...COMMON_UNIFORMS(field), uAlpha: { value: alpha }, ...U },
    vertexShader: SURF_VERT,
    fragmentShader: /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN;
uniform sampler2D uRefl; uniform vec2 uRes; uniform vec3 uSunDir, uSunCol, uView, uWaterCol, uSkyCol;
uniform float uAlpha, uNight, uTime, uRain;
${HEIGHT_GLSL}
void main(){
  float e = 0.2;
  float hx = H(vW.xz + vec2(e, 0.0)) - H(vW.xz - vec2(e, 0.0));
  float hz = H(vW.xz + vec2(0.0, e)) - H(vW.xz - vec2(0.0, e));
  float h = H(vW.xz);
  // small ambient chop so calm water still shimmers
  float chop = sin(vW.x * 2.1 + uTime * 1.3) * cos(vW.z * 1.7 - uTime * 1.1) * 0.012;
  vec3 n = normalize(vec3(-hx * 2.4 - chop * 1.5, 2.0 * e, -hz * 2.4 + chop));
  vec3 V = normalize(uView);
  vec2 suv = gl_FragCoord.xy / uRes + n.xz * 0.045;
  vec3 refl = texture2D(uRefl, suv).rgb;
  float fres = 0.22 + 0.55 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 body = uWaterCol;
  vec3 col = mix(body, refl, fres);
  vec3 R = reflect(-V, n);
  float s = pow(max(dot(R, normalize(uSunDir)), 0.0), 140.0);
  col += uSunCol * smoothstep(0.25, 0.6, s) * 1.6;
  float foam = smoothstep(0.07, 0.15, abs(h) + abs(hx) * 0.5);
  col = mix(col, vec3(0.9, 0.97, 1.0) * (0.35 + 0.65 * (1.0 - uNight * 0.8)), foam * 0.7);
  gl_FragColor = vec4(col, clamp(mix(uAlpha, 1.0, fres * 0.8 + foam * 0.5), 0.0, 1.0));
}`,
  });
}

export function tileMaterial(field, { lanes = false, lamps = [] } = {}) {
  const lampArr = [];
  for (let i = 0; i < 8; i++) lampArr.push(lamps[i] ? new THREE.Vector4(...lamps[i]) : new THREE.Vector4(0, 999, 0, 0.01));
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...COMMON_UNIFORMS(field), uLanes: { value: lanes ? 1 : 0 }, uLamps: { value: lampArr }, ...U },
    vertexShader: SURF_VERT,
    fragmentShader: /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN;
uniform vec3 uSunDir, uSunCol, uAmb; uniform float uNight, uTime, uLanes;
uniform vec4 uLamps[8];
${HEIGHT_GLSL}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float caustic(vec2 uv){
  float t = uTime * 0.5 + 23.0;
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
void main(){
  vec3 n = normalize(vN);
  bool floorF = abs(n.y) > 0.5;
  vec2 uv = floorF ? vW.xz : (abs(n.x) > 0.5 ? vW.zy : vW.xy);
  vec2 cell = floor(uv / 0.5);
  vec2 f = fract(uv / 0.5);
  float grout = (f.x < 0.1 || f.y < 0.1) ? 1.0 : 0.0;
  float v = hash(cell) * 0.12;
  vec3 base = vec3(0.50, 0.80, 0.86) * (0.92 + v);
  base = mix(base, base * 0.62, grout);
  if (!floorF && vW.y > -0.42 && vW.y < -0.26) base = vec3(0.04, 0.18, 0.36);
  if (floorF && uLanes > 0.5) {
    float dz = abs(mod(vW.z - uRect.y, 2.0) - 1.0);
    float ex = min(vW.x - uRect.x, uRect.x + uRect.z - vW.x);
    if (dz < 0.11 && ex > 2.0) base = vec3(0.02, 0.07, 0.2);
    if (abs(ex - 2.0) < 0.11 && dz < 0.6) base = vec3(0.02, 0.07, 0.2);
  }
  vec3 L = uAmb * 0.95 + uSunCol * 0.55 * clamp(uSunDir.y, 0.15, 1.0);
  float lapH = H(vW.xz + vec2(0.3, 0.0)) + H(vW.xz - vec2(0.3, 0.0)) + H(vW.xz + vec2(0.0, 0.3)) + H(vW.xz - vec2(0.0, 0.3)) - 4.0 * H(vW.xz);
  float c = caustic(vW.xz * 0.34 + (floorF ? 0.0 : vW.y * 0.2)) + clamp(-lapH * 14.0, 0.0, 1.0);
  float sunUp = clamp(uSunDir.y * 1.5, 0.0, 1.0) * (1.0 - uNight);
  vec3 col = base * (L * 0.7 + uSunCol * c * 0.85 * sunUp);
  float g = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = length(vW - uLamps[i].xyz);
    float k = clamp(1.0 - d / uLamps[i].w, 0.0, 1.0);
    g += k * k;
  }
  col += vec3(0.35, 0.85, 1.0) * g * uNight * 1.7 * base.g;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}
