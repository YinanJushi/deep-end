import * as THREE from 'three';
import { DECK_Y } from './shared.js';
import { POOLS, SPOTS } from './layout.js';

const M4 = new THREE.Matrix4(), Q0 = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), P0 = new THREE.Vector3();

export function textSprite(text, w, h, worldW, fg = '#fbf8ef', bg = '#232a42') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.fillRect(1, 1, w - 2, h - 2); g.fillStyle = bg; g.fillRect(2, 2, w - 4, h - 4);
  g.fillStyle = fg; g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(worldW, worldW * h / w, 1); s.visible = false; return s;
}

export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    const fields = world.pools;
    this.ripple = (x, z, r, a) => { for (const k in fields) if (fields[k].field.contains(x, z)) fields[k].field.drop(x, z, r, a); };
    this.poolAt = (x, z) => { for (const k in fields) if (fields[k].field.contains(x, z, -0.3)) return fields[k]; return null; };

    // droplets
    this.N = 700;
    this.drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: '#e8fbff' }), this.N);
    this.drops.frustumCulled = false; this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dp = new Float32Array(this.N * 3); this.dv = new Float32Array(this.N * 3); this.dl = new Float32Array(this.N);
    scene.add(this.drops);
    this.dNext = 0;
    // bubbles
    this.NB = 260;
    this.bubbles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: '#d8f6ff' }), this.NB);
    this.bubbles.frustumCulled = false; this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bp = new Float32Array(this.NB * 3); this.bl = new Float32Array(this.NB);
    scene.add(this.bubbles); this.bNext = 0;
    for (let i = 0; i < this.N; i++) this._hideDrop(i);
    for (let i = 0; i < this.NB; i++) this._hideB(i);
    // steam over the tub
    this.NS = 36;
    this.steam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#e8f2f4' }), this.NS);
    this.steam.frustumCulled = false; scene.add(this.steam);
    this.sl = new Float32Array(this.NS).map(() => Math.random());
    // rain
    this.NR = 1300;
    this.rainPos = new Float32Array(this.NR * 6);
    this.rainSeed = new Float32Array(this.NR * 3);
    for (let i = 0; i < this.NR; i++) { this.rainSeed[i * 3] = -36 + Math.random() * 70; this.rainSeed[i * 3 + 1] = Math.random() * 30; this.rainSeed[i * 3 + 2] = -30 + Math.random() * 62; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#9fc4de', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rainMesh.frustumCulled = false; scene.add(this.rainMesh); world.hideForRefl.push(this.rainMesh);
    // shower
    this.NSh = 30;
    this.showerPos = new Float32Array(this.NSh * 6);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.showerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.shower = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#d8f6ff', depthWrite: false }));
    this.shower.frustumCulled = false; this.shower.visible = false; scene.add(this.shower); world.hideForRefl.push(this.shower);
    this.showerOn = 0;
    // footprints
    this.NF = 420;
    const fg = new THREE.PlaneGeometry(0.15, 0.3); fg.rotateX(-Math.PI / 2);
    this.prints = new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), this.NF);
    this.prints.frustumCulled = false; this.prints.receiveShadow = true; scene.add(this.prints);
    this.fp = new Array(this.NF).fill(null); this.fNext = 0; this.fTimer = 0;
    for (let i = 0; i < this.NF; i++) { this.prints.setMatrixAt(i, M4.makeScale(0, 0, 0)); this.prints.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.time = 0; this.rainAmount = 0;
  }

  _hideDrop(i) { this.drops.setMatrixAt(i, M4.makeScale(0, 0, 0)); this.dl[i] = 0; }
  _hideB(i) { this.bubbles.setMatrixAt(i, M4.makeScale(0, 0, 0)); this.bl[i] = 0; }

  /** entry splash: scale ~ amount of water thrown, tilt in degrees (0 = clean rip entry) */
  splash(x, z, speed, tilt, feetFirst = false) {
    const flat = Math.min(1, tilt / 70);
    const rip = tilt < 5;
    const amount = Math.min(1.6, 0.25 + speed / 14 * (0.5 + flat * 2.2));
    // rings
    this.ripple(x, z, 0.5 + amount * 0.7, -0.14 * amount - 0.05 * flat);
    this.ripple(x, z, 1.6 + amount, 0.07 * amount);
    const n = Math.floor((rip ? 18 : 40) + amount * (rip ? 30 : 140));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = rip ? 0.35 + Math.random() * 0.4 : 0.8 + Math.random() * (2.2 + flat * 2.5);
      const up = rip ? 3.5 + Math.random() * 5.5 * amount : 2.5 + Math.random() * (4 + flat * 4) * amount;
      this.spawnDrop(x + Math.cos(a) * 0.15, 0.05, z + Math.sin(a) * 0.15, Math.cos(a) * spread, up, Math.sin(a) * spread);
    }
    this.bubbleBurst(x, -0.3, z, 14 + Math.floor(amount * 22));
  }

  spawnDrop(x, y, z, vx, vy, vz) {
    const i = this.dNext; this.dNext = (this.dNext + 1) % this.N;
    this.dp[i * 3] = x; this.dp[i * 3 + 1] = y; this.dp[i * 3 + 2] = z;
    this.dv[i * 3] = vx; this.dv[i * 3 + 1] = vy; this.dv[i * 3 + 2] = vz; this.dl[i] = 2.5;
  }
  smallSplash(x, y, z, n = 5, p = 1) {
    for (let i = 0; i < n; i++) this.spawnDrop(x, y, z, (Math.random() - 0.5) * 1.6 * p, 1.2 + Math.random() * 1.8 * p, (Math.random() - 0.5) * 1.6 * p);
  }
  bubbleBurst(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const i = this.bNext; this.bNext = (this.bNext + 1) % this.NB;
      this.bp[i * 3] = x + (Math.random() - 0.5) * 0.9; this.bp[i * 3 + 1] = y - Math.random() * 2.2; this.bp[i * 3 + 2] = z + (Math.random() - 0.5) * 0.9;
      this.bl[i] = 1.5 + Math.random() * 2;
    }
  }

  footprint(x, z, yaw, strength) {
    const i = this.fNext; this.fNext = (this.fNext + 1) % this.NF;
    this.fp[i] = { x, z, yaw, born: this.time, strength };
    M4.compose(P0.set(x, DECK_Y + 0.012, z), Q0.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), S1);
    this.prints.setMatrixAt(i, M4); this.prints.instanceMatrix.needsUpdate = true;
  }

  update(dt, env, camera) {
    this.time += dt;
    const grav = -9.8;
    // droplets
    for (let i = 0; i < this.N; i++) {
      if (this.dl[i] <= 0) continue;
      const k = i * 3;
      this.dv[k + 1] += grav * dt;
      this.dp[k] += this.dv[k] * dt; this.dp[k + 1] += this.dv[k + 1] * dt; this.dp[k + 2] += this.dv[k + 2] * dt;
      this.dl[i] -= dt;
      if (this.dp[k + 1] < 0 && this.dv[k + 1] < 0) {
        const x = this.dp[k], z = this.dp[k + 2];
        if (this.poolAt(x, z) && Math.random() < 0.35) this.ripple(x, z, 0.25, -0.03);
        this._hideDrop(i); continue;
      }
      M4.makeTranslation(this.dp[k], this.dp[k + 1], this.dp[k + 2]); this.drops.setMatrixAt(i, M4);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    // bubbles
    for (let i = 0; i < this.NB; i++) {
      if (this.bl[i] <= 0) continue;
      const k = i * 3;
      this.bp[k + 1] += dt * (0.9 + Math.sin(this.time * 4 + i) * 0.2); this.bp[k] += Math.sin(this.time * 3 + i) * dt * 0.1;
      this.bl[i] -= dt;
      if (this.bp[k + 1] > -0.05 || this.bl[i] <= 0) { this._hideB(i); continue; }
      M4.makeTranslation(this.bp[k], this.bp[k + 1], this.bp[k + 2]); this.bubbles.setMatrixAt(i, M4);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
    // steam
    const t = SPOTS.tub;
    for (let i = 0; i < this.NS; i++) {
      this.sl[i] += dt * 0.35; if (this.sl[i] > 1) this.sl[i] -= 1;
      const l = this.sl[i], a = i * 2.4;
      const s = Math.sin(l * Math.PI) * (env.tod === 'day' ? 0.7 : 1.0);
      M4.compose(P0.set(t.x + Math.cos(a) * 1.0 * (0.5 + (i % 3) * 0.25) + Math.sin(l * 5 + i) * 0.1, DECK_Y + 0.7 + l * 1.8, t.z + Math.sin(a) * 0.9 * (0.5 + (i % 3) * 0.25)), Q0, S1.set(s, s, s));
      this.steam.setMatrixAt(i, M4);
    }
    S1.set(1, 1, 1);
    this.steam.instanceMatrix.needsUpdate = true;
    // rain
    this.rainAmount = env.rain;
    const n = Math.floor(this.NR * env.rain);
    this.rainMesh.visible = n > 10;
    if (this.rainMesh.visible) {
      const sp = 24 * dt, slant = 0.12;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        this.rainSeed[k + 1] -= sp;
        this.rainSeed[k] += sp * slant;
        if (this.rainSeed[k + 1] < 0) { this.rainSeed[k] = -36 + Math.random() * 70; this.rainSeed[k + 1] = 26 + Math.random() * 4; this.rainSeed[k + 2] = -30 + Math.random() * 62; }
        const x = this.rainSeed[k], y = this.rainSeed[k + 1], z = this.rainSeed[k + 2], q = i * 6;
        this.rainPos[q] = x; this.rainPos[q + 1] = y; this.rainPos[q + 2] = z;
        this.rainPos[q + 3] = x - 0.1; this.rainPos[q + 4] = y + 0.8; this.rainPos[q + 5] = z;
      }
      this.rainMesh.geometry.setDrawRange(0, n * 2);
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      // rain rings on the pools
      for (const k in this.world.pools) {
        const p = this.world.pools[k], area = p.P.w * p.P.d;
        let cnt = area * 0.35 * env.rain * dt;
        while (cnt > 0) {
          if (Math.random() < cnt) this.ripple(p.P.x0 + Math.random() * p.P.w, p.P.z0 + Math.random() * p.P.d, 0.25, -0.035);
          cnt -= 1;
        }
      }
    }
    // shower spray
    this.shower.visible = this.showerOn > 0;
    if (this.shower.visible) {
      const s = SPOTS.shower;
      for (let i = 0; i < this.NSh; i++) {
        const ph = (this.time * 2.2 + i / this.NSh) % 1, a = i * 2.39996;
        const x = s.x + Math.cos(a) * 0.35 * ph, z = s.z + 0.08 + Math.sin(a) * 0.35 * ph, y = DECK_Y + 2.4 - ph * 2.35;
        const q = i * 6;
        this.showerPos.set([x, y, z, x, y - 0.25, z], q);
      }
      this.shower.geometry.attributes.position.needsUpdate = true;
    }
    // footprints dry in the sun
    this.fTimer -= dt;
    if (this.fTimer <= 0) {
      this.fTimer = 0.25;
      const rate = env.dryRate();
      const dry = new THREE.Color('#c9bfac').multiply(this.world.deckMat.color);
      const wet = dry.clone().multiplyScalar(0.55);
      const c = new THREE.Color();
      for (let i = 0; i < this.NF; i++) {
        const f = this.fp[i]; if (!f) continue;
        const d = rate > 0 ? Math.min(1, (this.time - f.born) * rate / f.strength) : Math.min(1, (this.time - f.born) * 0.9);
        f.dry = d;
        if (env.wet > 0.5 || d >= 1) { this.prints.setMatrixAt(i, M4.makeScale(0, 0, 0)); this.fp[i] = null; continue; }
        c.copy(wet).lerp(dry, d * d);
        this.prints.setColorAt(i, c);
      }
      this.prints.instanceMatrix.needsUpdate = true;
      if (this.prints.instanceColor) this.prints.instanceColor.needsUpdate = true;
    }
  }
}
