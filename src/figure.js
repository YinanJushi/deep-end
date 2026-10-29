import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const matCache = new Map();
export function lam(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, ...extra }); matCache.set(key, m); }
  return m;
}
const geoCache = new Map();
function segGeo(w, len, d) {
  const key = `${w}|${len}|${d}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, len, d); g.translate(0, -len / 2, 0); geoCache.set(key, g); }
  return g;
}
function boxMesh(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = false;
  parent.add(m); return m;
}

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tD = new THREE.Vector3();
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
const P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3(), P4 = new THREE.Vector3();

class Limb {
  constructor(parent, origin, L1, L2, w, colUp, colLow, endColor, endSize) {
    this.L1 = L1; this.L2 = L2;
    this.upper = new THREE.Group(); this.upper.position.copy(origin); parent.add(this.upper);
    const um = new THREE.Mesh(segGeo(w, L1, w), lam(colUp)); um.castShadow = true; this.upper.add(um);
    this.lower = new THREE.Group(); this.lower.position.set(0, -L1, 0); this.upper.add(this.lower);
    const lm = new THREE.Mesh(segGeo(w * 0.9, L2, w * 0.9), lam(colLow)); lm.castShadow = true; this.lower.add(lm);
    const em = new THREE.Mesh(new THREE.BoxGeometry(...endSize), lam(endColor)); em.castShadow = true;
    em.position.set(0, -L2 - endSize[1] / 2 + 0.01, endSize[2] > endSize[0] ? endSize[2] * 0.25 : 0);
    this.lower.add(em);
    this.reach = 0;
  }

  /** target & pole are in the parent's local space */
  ik(target, pole) {
    const o = this.upper.position, { L1, L2 } = this;
    tA.copy(target).sub(o);
    let dist = tA.length();
    const maxR = L1 + L2 - 0.005, minR = Math.abs(L1 - L2) + 0.03;
    dist = Math.min(maxR, Math.max(minR, dist));
    tA.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
    tB.copy(pole).addScaledVector(tA, -pole.dot(tA));
    if (tB.lengthSq() < 1e-6) tB.set(0, 0, 1);
    tB.normalize();
    tC.copy(tA).multiplyScalar(a).addScaledVector(tB, h); // elbow rel. origin
    qA.setFromUnitVectors(DOWN, tD.copy(tC).normalize());
    this.upper.quaternion.copy(qA);
    tD.copy(tA).multiplyScalar(dist).sub(tC).normalize();
    qB.setFromUnitVectors(DOWN, tD);
    this.lower.quaternion.copy(qA).invert().multiply(qB);
  }

  endWorld(out) { return this.lower.localToWorld(out.set(0, -this.L2, 0)); }
}

export const SKINS = ['#d39a76', '#a86a4d', '#efc19c', '#80573a', '#f8dcc0'];

export class Figure {
  constructor({ scale = 1, skin = '#d39a76', top = '#c9403a', bottom = '#1a7dba', hair = '#432c20', cap = null, long = false } = {}) {
    this.scale = scale;
    this.wet = 0;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.pelvis = new THREE.Group(); this.root.add(this.pelvis);
    boxMesh(0.33, 0.2, 0.2, bottom, 0, 0, 0, this.pelvis);
    this.torso = new THREE.Group(); this.torso.position.set(0, 0.1, 0); this.pelvis.add(this.torso);
    boxMesh(0.35, 0.5, 0.2, top, 0, 0.25, 0, this.torso);
    this.head = new THREE.Group(); this.head.position.set(0, 0.55, 0); this.torso.add(this.head);
    boxMesh(0.09, 0.07, 0.09, skin, 0, 0.03, 0, this.head);
    boxMesh(0.2, 0.22, 0.2, skin, 0, 0.16, 0, this.head);
    if (cap) {
      boxMesh(0.22, 0.14, 0.22, cap, 0, 0.23, -0.005, this.head);
    } else {
      boxMesh(0.22, 0.08, 0.22, hair, 0, 0.29, 0, this.head);
      boxMesh(0.22, long ? 0.3 : 0.17, 0.06, hair, 0, long ? 0.15 : 0.2, -0.1, this.head);
    }
    boxMesh(0.04, 0.04, 0.03, '#a86a4d', 0, 0.14, 0.11, this.head);
    this.arms = [1, -1].map((s) => new Limb(this.torso, new THREE.Vector3(s * 0.23, 0.45, 0), 0.3, 0.28, 0.09, top, skin, skin, [0.09, 0.09, 0.09]));
    this.legs = [1, -1].map((s) => new Limb(this.pelvis, new THREE.Vector3(s * 0.09, -0.05, 0), 0.43, 0.42, 0.12, bottom, skin, '#232a42', [0.11, 0.07, 0.22]));
    this.pose = null;
    this.heading = 0;
  }

  place(x, y, z, yaw) {
    this.root.position.set(x, y, z);
    if (yaw !== undefined) { this.root.rotation.set(0, yaw, 0); this.heading = yaw; }
  }

  /** orientation from body "up" (head direction) and chest-normal vectors, in root space */
  setBasis(head, chest) {
    tA.copy(head).normalize(); tB.copy(chest).normalize();
    tB.addScaledVector(tA, -tB.dot(tA)).normalize();
    tC.crossVectors(tA, tB);
    const m = new THREE.Matrix4().makeBasis(tC, tA, tB);
    this.pelvis.quaternion.setFromRotationMatrix(m);
  }

  /** pose = {flex, fx,fy,fz (foot, pelvis space, left side), hx,hy,hz (hand, pelvis space), lift?} */
  applyPose(p, kneePole = 1, elbowOut = 0.6) {
    this.torso.rotation.set(p.flex, p.twist || 0, p.side || 0);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.legs[i].ik(P1.set(s * p.fx, p.fy, p.fz), P2.set(s * 0.15 * (p.splay || 0), 0.1, kneePole));
      const ht = P3.set(s * p.hx, p.hy, p.hz).sub(this.torso.position).applyAxisAngle(AX, -p.flex);
      this.arms[i].ik(ht, P4.set(s * elbowOut, -0.2, -0.7));
    }
  }

  legIK(i, target, pole) { this.legs[i].ik(target, pole); }
  armIK(i, target, pole) { this.arms[i].ik(target, pole); }
  hand(i, out) { return this.arms[i].endWorld(out); }
  foot(i, out) { return this.legs[i].endWorld(out); }

  /** pelvis height (root space) at which feet at pelvis-space y = fy touch the ground */
  static groundY(fy) { return 0.11 - fy; }
}

// ---- shared pose library (feet/hands in pelvis space) ---------------------------------------
export const POSES = {
  stand: { flex: 0, fx: 0.09, fy: -0.78, fz: 0, hx: 0.3, hy: 0.0, hz: 0.02 },
  armsUp: { flex: 0, fx: 0.06, fy: -0.84, fz: 0, hx: 0.12, hy: 1.1, hz: 0.05 },
  armsOut: { flex: 0, fx: 0.07, fy: -0.84, fz: 0, hx: 0.62, hy: 0.85, hz: 0.0 },
  crouch: { flex: 0.45, fx: 0.11, fy: -0.5, fz: 0.22, hx: 0.3, hy: 0.0, hz: -0.1 },
  tuck: { flex: 1.15, fx: 0.1, fy: -0.2, fz: 0.2, hx: 0.2, hy: 0.0, hz: 0.5 },
  pike: { flex: 1.5, fx: 0.08, fy: -0.05, fz: 0.82, hx: 0.12, hy: 0.0, hz: 0.76 },
  free: { flex: 0.85, fx: 0.07, fy: -0.5, fz: 0.62, hx: 0.55, hy: 0.55, hz: 0.45 },
  sit: { flex: 0.05, fx: 0.1, fy: -0.42, fz: 0.46, hx: 0.22, hy: 0.0, hz: 0.38 },
  lineUp: { flex: 0, fx: 0.05, fy: -0.85, fz: -0.02, hx: 0.1, hy: 1.1, hz: 0.04 },
};
const NUM = ['flex', 'fx', 'fy', 'fz', 'hx', 'hy', 'hz'];
export function blendPose(out, a, b, t) {
  for (const k of NUM) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function poseWalk(fig, ph, o = {}) {
  const stride = o.stride ?? 0.3, lift = o.lift ?? 0.1, swing = o.swing ?? 0.28;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const sn = Math.sin(ph + i * Math.PI), cs = Math.cos(ph + i * Math.PI);
    const z = sn * stride;
    const y = -0.78 + 0.25 * z * z + Math.max(0, cs) * lift;
    fig.legIK(i, P1.set(s * 0.09, y, z), P2.set(0, 0.2, 1));
    if (o.run) {
      fig.armIK(i, P3.set(s * 0.22, 0.2, -sn * swing + 0.2), P4.set(s * 0.4, -0.3, -0.8));
    } else {
      fig.armIK(i, P3.set(s * 0.26, -0.03, -sn * swing), P4.set(s * 0.3, -0.2, -0.8));
    }
  }
  fig.pelvis.position.set(0, 0.89 + (o.bob ?? 0.025) * Math.abs(Math.cos(ph)), 0);
  fig.pelvis.quaternion.setFromAxisAngle(AX, o.lean ?? 0);
  fig.torso.rotation.set(o.torsoLean ?? 0.04, Math.sin(ph) * 0.12, 0);
}
