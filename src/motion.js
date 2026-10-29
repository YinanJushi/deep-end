import * as THREE from 'three';
import { POSES, blendPose, poseWalk, Figure } from './figure.js';
import { DECK_Y } from './shared.js';

export const CTX = { fx: null, env: null, world: null };
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
export const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export function angleLerp(a, b, t) {
  const d = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
  return a + d * t;
}
export function* wait(s) { let t = 0; while (t < s) t += yield; }
export function* until(fn) { while (!fn()) yield; }

const tmpPose = { flex: 0, fx: 0, fy: 0, fz: 0, hx: 0, hy: 0, hz: 0 };

/** apply a pose with the pelvis lowered so the feet stay on the ground */
export function groundedPose(fig, P) {
  fig.pelvis.position.set(0, Figure.groundY(P.fy), 0);
  fig.pelvis.quaternion.identity();
  fig.head.rotation.set(0, 0, 0);
  fig.applyPose(P);
}
export function groundedBlend(fig, A, B, t) {
  blendPose(tmpPose, A, B, t);
  groundedPose(fig, tmpPose);
}

export function* turnTo(a, yaw, rate = 6) {
  const f = a.fig;
  while (Math.abs(THREE.MathUtils.euclideanModulo(yaw - f.heading + Math.PI, Math.PI * 2) - Math.PI) > 0.04) {
    const dt = yield;
    f.heading = angleLerp(f.heading, yaw, Math.min(1, dt * rate));
    f.root.rotation.y = f.heading;
    groundedPose(f, POSES.stand);
  }
}

/** walk (or run) through a list of Vector3 points; y follows the waypoints, so stairs just work */
export function* walkPath(a, pts, speed = 1.3, o = {}) {
  const f = a.fig;
  for (const tgt of pts) {
    const y0 = f.root.position.y;
    const len0 = Math.hypot(tgt.x - f.root.position.x, tgt.z - f.root.position.z);
    const slope = len0 > 0.05 ? Math.abs(tgt.y - y0) / len0 : 0;
    for (;;) {
      const dt = yield;
      if (o.abort && o.abort()) return;
      const p = f.root.position;
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
      const sp = typeof speed === 'function' ? speed() : speed;
      const step = Math.min(dist, sp * dt);
      if (dist > 0.02) {
        f.heading = angleLerp(f.heading, Math.atan2(dx, dz), Math.min(1, dt * 9));
        f.root.rotation.y = f.heading;
        p.x += dx / dist * step; p.z += dz / dist * step;
      }
      const prog = len0 > 0.05 ? 1 - Math.min(1, Math.hypot(tgt.x - p.x, tgt.z - p.z) / len0) : 1;
      p.y = lerp(y0, tgt.y, prog) + (o.yOff ? o.yOff(p) : 0);
      const run = !!(typeof o.run === 'function' ? o.run() : o.run);
      const climb = slope > 0.3;
      const prev = a.phase;
      a.phase += step / (run ? 1.1 : climb ? 0.42 : 0.5) / f.scale * 0.9 + (dist <= 0.02 ? 0 : 0);
      poseWalk(f, a.phase, {
        stride: run ? 0.46 : climb ? 0.2 : 0.3, lift: run ? 0.2 : climb ? 0.3 : 0.1,
        swing: run ? 0.55 : 0.28, bob: run ? 0.06 : 0.025, lean: run ? 0.1 : climb ? 0.1 : 0, run,
      });
      if (Math.floor(a.phase / Math.PI) !== Math.floor(prev / Math.PI)) {
        a.step(Math.floor(a.phase / Math.PI) % 2 ? 1 : -1);
      }
      if (dist < 0.06 || (dist <= step + 1e-6)) break;
    }
  }
}

export function* sitDown(a, seat, yaw, dur = 0.7) {
  const f = a.fig; let t = 0;
  f.place(seat.x, seat.y, seat.z, yaw);
  while (t < dur) { t += yield; groundedBlend(f, POSES.stand, POSES.sit, smooth(t / dur)); }
  groundedPose(f, POSES.sit);
}
export function* standUp(a, dur = 0.6) {
  const f = a.fig; let t = 0;
  while (t < dur) { t += yield; groundedBlend(f, POSES.sit, POSES.stand, smooth(t / dur)); }
  groundedPose(f, POSES.stand);
}

// ---- swimming ------------------------------------------------------------------------------------
export const SWIM = {
  free: { speed: 1.35, rate: 0.9 }, back: { speed: 1.15, rate: 0.78 }, breast: { speed: 0.95, rate: 0.5 },
};

export function swimBasis(fig, h, roll, supine, pitch = 0) {
  V.copy(h).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
  V2.set(0, supine ? 1 : -1, 0).applyAxisAngle(h, roll);
  fig.setBasis(V, V2);
}

const T2 = Math.PI * 2;
/** arms in torso space, legs in pelvis space; torso is straight along the body */
export function strokePose(fig, style, p) {
  fig.torso.rotation.set(0, 0, 0); fig.head.rotation.set(0, 0, 0);
  fig.pelvis.position.set(0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const u = ((p + i * 0.5) % 1 + 1) % 1;
    let hx, hy, hz, px = s * 0.5, pz = -0.5;
    let fx = 0.07, fy = -0.84, fz = 0;
    if (style === 'free') {
      if (u < 0.5) { const w = u / 0.5; hx = s * (0.26 - 0.07 * Math.sin(Math.PI * w)); hy = 1.0 - 1.05 * w; hz = 0.05 + 0.3 * Math.sin(Math.PI * w); pz = -0.2; }
      else { const w = (u - 0.5) / 0.5; hx = s * (0.3 + 0.08 * Math.sin(Math.PI * w)); hy = -0.05 + 1.05 * w; hz = -0.5 * Math.sin(Math.PI * w); pz = -1; }
      fz = Math.sin(T2 * p * 3 + i * Math.PI) * 0.17;
    } else if (style === 'back') {
      const a = T2 * (p + i * 0.5);
      hx = s * 0.3; hy = 0.45 - 0.52 * Math.cos(a); hz = 0.52 * Math.sin(a); px = s * 0.4; pz = 0.1;
      fz = Math.sin(T2 * p * 3 + i * Math.PI) * 0.17;
    } else {
      const q = ((p) % 1 + 1) % 1;
      if (q < 0.35) { const w = q / 0.35; hx = s * (0.12 + 0.42 * Math.sin(Math.PI * w)); hy = 1.0 - 0.7 * w; hz = 0.1 + 0.2 * w; }
      else if (q < 0.6) { const w = (q - 0.35) / 0.25; hx = s * 0.13; hy = 0.3 + 0.7 * w; hz = 0.3 - 0.2 * w; }
      else { hx = s * 0.12; hy = 1.0; hz = 0.08; }
      px = s * 0.4; pz = 0.3;
      if (q > 0.38 && q < 0.58) { const w = (q - 0.38) / 0.2; fx = lerp(0.08, 0.2, w); fy = lerp(-0.84, -0.42, smooth(w)); fz = lerp(0, -0.28, smooth(w)); }
      else if (q >= 0.58 && q < 0.74) { const w = (q - 0.58) / 0.16; fx = lerp(0.36, 0.08, w); fy = lerp(-0.5, -0.84, w); fz = lerp(-0.2, 0, w); }
    }
    fig.armIK(i, V.set(hx, hy, hz), V2.set(px, 0, pz));
    fig.legIK(i, V3.set(s * fx, fy, fz), V2.set(s * 0.05, 0.1, -0.2));
  }
}

export function glidePose(fig, t, depthKick = 1) {
  fig.torso.rotation.set(0, 0, 0); fig.pelvis.position.set(0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    fig.armIK(i, V.set(s * 0.1, 1.05, 0.08), V2.set(s * 0.4, 0, -0.3));
    fig.legIK(i, V3.set(s * 0.05, -0.84, 0.2 * depthKick * Math.sin(T2 * 3.2 * t + i * 0.5)), V2.set(0, 0.1, -0.3));
  }
}

/** swim toward (tx,tz) on the surface */
export function* swimTo(a, tx, tz, o = {}) {
  const f = a.fig, style = o.style || 'free', S = SWIM[style];
  for (;;) {
    const dt = yield;
    const p = f.root.position;
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    if (o.wallX !== undefined) { if (Math.abs(o.wallX - (p.x + a.dirx * 0.95)) < 1.55) return; }
    else if (dist < (o.tol ?? 0.4)) return;
    a.yaw = angleLerp(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * 3.5));
    V.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const spd = (o.speed ?? S.speed) * (style === 'breast' ? 0.7 + 0.5 * Math.max(0, Math.sin(T2 * a.stroke * 1 + 1)) : 1);
    p.x += V.x * spd * dt; p.z += V.z * spd * dt;
    a.stroke += dt * S.rate * (o.rate ?? 1);
    p.y = -0.04 - (style === 'breast' ? 0.05 * Math.sin(T2 * a.stroke + 1) + 0.03 : 0);
    const roll = style === 'free' ? 0.5 * Math.sin(T2 * a.stroke) : style === 'back' ? 0.3 * Math.sin(T2 * a.stroke) : 0;
    const pitch = style === 'breast' ? 0.16 * Math.sin(T2 * a.stroke + 1) + 0.05 : 0;
    strokePose(f, style, a.stroke);
    swimBasis(f, V, roll, style === 'back', pitch);
    f.heading = a.yaw; f.root.rotation.set(0, 0, 0);
    a.inWater = true;
  }
}

/** tumble at the wall, push off underwater, surface. wall x is the wall coordinate; dirx the approach direction */
export function* flipTurn(a, wallX, style) {
  const f = a.fig, p = f.root.position, dirx = a.dirx;
  const standoff0 = Math.abs(wallX - p.x), standoff1 = 1.05;
  const z = p.z;
  const h0 = new THREE.Vector3(dirx, 0, 0);
  const lat = new THREE.Vector3(0, 0, 1);
  let t = 0; const D1 = 1.0;
  const supine = style === 'back';
  while (t < D1) {
    t += yield;
    const k = Math.min(1, t / D1), s = smooth(k);
    p.x = wallX - dirx * lerp(standoff0, standoff1, s); p.z = z; p.y = -0.04 - 0.6 * s;
    const phi = -dirx * Math.PI * s;
    V.copy(h0).applyAxisAngle(lat, phi);
    V2.set(0, supine ? 1 : -1, 0).applyAxisAngle(lat, phi);
    f.setBasis(V, V2);
    groundedBlend(f, POSES.stand, POSES.tuck, Math.sin(Math.PI * s));
    f.pelvis.position.set(0, 0, 0);
    f.setBasis(V, V2);
    f.root.rotation.set(0, 0, 0);
  }
  a.dirx = -dirx;
  const hN = new THREE.Vector3(a.dirx, 0, 0);
  a.yaw = Math.atan2(hN.x, hN.z);
  t = 0; const D2 = 1.9;
  while (t < D2) {
    const dt = yield; t += dt;
    const k = Math.min(1, t / D2);
    p.x += a.dirx * lerp(3.3, 1.3, k) * dt;
    p.y = -0.64 + 0.6 * smooth(k * k);
    const roll = supine ? 0 : Math.PI * (1 - smooth(clamp(k / 0.55, 0, 1)));
    glidePose(f, t, k < 0.7 ? 1 : 0.2);
    swimBasis(f, hN, roll, supine, 0);
    f.root.rotation.set(0, 0, 0);
    a.inWater = true;
    if (k > 0.6) a.stroke += dt * SWIM[style].rate * 0.6;
  }
}
