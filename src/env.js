import * as THREE from 'three';
import { U } from './shared.js';

const C = (h) => new THREE.Color(h);
const TOD = {
  day: {
    skyTop: C('#4aa8ee'), skyBot: C('#bfe8ff'), sun: C('#fff1d6'), sunI: 2.9, sunDir: [-0.4, 0.8, 0.55],
    hemiSky: C('#cfe9ff'), hemiGround: C('#9a8a70'), hemiI: 1.7, water: C('#2aa7cf'), glow: 0, flood: 0, stars: 0,
  },
  dusk: {
    skyTop: C('#4a3f8f'), skyBot: C('#ff9a5c'), sun: C('#ff9d5a'), sunI: 2.6, sunDir: [0.85, 0.3, 0.3],
    hemiSky: C('#9a78b8'), hemiGround: C('#6a4040'), hemiI: 1.0, water: C('#3a7aa0'), glow: 0.65, flood: 0.5, stars: 0.25,
  },
  night: {
    skyTop: C('#04081a'), skyBot: C('#16224a'), sun: C('#7f98ff'), sunI: 0.5, sunDir: [-0.4, 0.7, 0.35],
    hemiSky: C('#26387a'), hemiGround: C('#101426'), hemiI: 0.55, water: C('#0c3a66'), glow: 1, flood: 1, stars: 1,
  },
};

function lerpTo(a, b, f) {
  if (typeof a === 'number') return a + (b - a) * f;
  if (a.isColor) return a.lerp(b, f);
  if (Array.isArray(a)) { for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * f; return a; }
  return a;
}
function cloneState(s) {
  const o = {};
  for (const k in s) o[k] = s[k].isColor ? s[k].clone() : Array.isArray(s[k]) ? s[k].slice() : s[k];
  return o;
}

export class Env {
  constructor(scene, world, pipeline) {
    this.scene = scene; this.world = world; this.pipeline = pipeline;
    this.tod = 'day'; this.weather = 'dry';
    this.cur = cloneState(TOD.day);
    this.wet = 0; this.rain = 0;
    this.sun = new THREE.DirectionalLight('#fff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.06;
    this.sun.target.position.set(-2, 0, 0);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#fff', '#888', 1);
    scene.add(this.hemi);
    this.floods = [];
    const sources = [...world.floodPos, world.lanternPos, ...world.lamps.slice(0, 3)];
    sources.forEach((p, i) => {
      const l = new THREE.PointLight(i < 2 ? '#fff0c8' : '#ffc977', 0, 0, 2);
      l.position.copy(p); l.userData.k = i < 2 ? 260 : 60; scene.add(l); this.floods.push(l);
    });
    this.scene.background = new THREE.Color();
    this.apply(1);
  }

  set(tod) { this.tod = tod; }
  setWeather(w) { this.weather = w; }

  apply(f) {
    const T = TOD[this.tod], c = this.cur;
    for (const k in T) c[k] = lerpTo(c[k], T[k], f);
  }

  update(dt) {
    const f = 1 - Math.exp(-dt * 1.8);
    this.apply(f);
    const c = this.cur;
    const rainT = this.weather === 'rain' ? 1 : 0;
    this.rain += (rainT - this.rain) * (1 - Math.exp(-dt * 0.8));
    this.wet += (rainT - this.wet) * (1 - Math.exp(-dt * (rainT ? 0.6 : 0.08)));
    const grey = 1 - this.rain * 0.4;
    const sunI = c.sunI * (1 - this.rain * 0.55);
    this.sun.color.copy(c.sun); this.sun.intensity = sunI;
    const d = new THREE.Vector3(...c.sunDir).normalize();
    this.sun.position.copy(this.sun.target.position).addScaledVector(d, 90);
    this.hemi.color.copy(c.hemiSky).multiplyScalar(grey); this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiI * (1 + this.rain * 0.15);
    for (const l of this.floods) l.intensity = c.flood * l.userData.k;
    const night = Math.max(c.glow, 0);
    for (const g of this.world.glow) g.m.emissiveIntensity = night * g.k;
    U.uNight.value = night;
    U.uSunDir.value.copy(d);
    U.uSunCol.value.copy(c.sun).multiplyScalar(sunI / Math.PI);
    U.uAmb.value.copy(c.hemiSky).lerp(c.hemiGround, 0.3).multiplyScalar(this.hemi.intensity / Math.PI);
    U.uWaterCol.value.copy(c.water).multiplyScalar(0.55 + 0.45 * Math.min(1, (sunI / 2.9 + this.hemi.intensity / 3))).multiplyScalar(1 - this.rain * 0.25);
    U.uRain.value = this.rain;
    this.scene.background.copy(c.skyBot);
    const pu = this.pipeline.palUniforms;
    pu.uSkyTop.value.copy(c.skyTop).lerp(new THREE.Color('#5a6270'), this.rain * 0.6);
    pu.uSkyBot.value.copy(c.skyBot).lerp(new THREE.Color('#9aa3ad'), this.rain * 0.6);
    pu.uStars.value = c.stars * (1 - this.rain);
    // wet deck darkens
    const dm = this.world.deckMat;
    dm.color.setRGB(1, 1, 1).lerp(new THREE.Color(0.52, 0.56, 0.66), this.wet);
  }

  /** drying rate for footprints and wet figures (per second) */
  dryRate() {
    if (this.weather === 'rain') return 0;
    return this.tod === 'day' ? 0.06 : this.tod === 'dusk' ? 0.035 : 0.02;
  }
}
