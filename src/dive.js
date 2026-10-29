import * as THREE from 'three';

export const G = 9.81;
const Y = new THREE.Vector3(0, 1, 0);

const DIRS = { fwd: 'Forward', back: 'Back', rev: 'Reverse', inw: 'Inward' };
const POS = { tuck: 'Tuck', pike: 'Pike', free: 'Free', str: 'Straight' };
const ROTS = { 2: '1 Somersault', 3: '1½ Somersaults', 4: '2 Somersaults', 5: '2½ Somersaults', 6: '3 Somersaults', 7: '3½ Somersaults' };
const DIR_BONUS = { fwd: 0, back: 0.1, rev: 0.2, inw: 0.2 };

/** n = number of half-rotations; the degree of difficulty is a simple fictional formula */
export function makeDive(dir, n, pos, height) {
  const dd = 0.5 + 0.3 * n + DIR_BONUS[dir] + (pos === 'pike' ? 0.1 : pos === 'free' ? 0.2 : 0) + (height >= 7.5 ? 0.1 : 0);
  const name = n === 0 ? 'Feet-first Jump'
    : n === 1 ? `${DIRS[dir]} Dive, ${POS[pos]}` : `${DIRS[dir]} ${ROTS[n]}, ${POS[pos]}`;
  return { dir, n, pos, name, dd: Math.round(dd * 10) / 10, height };
}

const MENU_3 = [['fwd', 1, 'str'], ['back', 1, 'str'], ['fwd', 3, 'pike'], ['back', 3, 'tuck'], ['rev', 3, 'pike'], ['inw', 3, 'pike'], ['fwd', 5, 'tuck'], ['back', 5, 'tuck'], ['rev', 5, 'tuck']];
const MENU_10 = [['fwd', 1, 'str'], ['fwd', 3, 'pike'], ['back', 3, 'pike'], ['rev', 3, 'tuck'], ['fwd', 5, 'tuck'], ['back', 5, 'tuck'], ['fwd', 7, 'tuck'], ['rev', 5, 'pike']];
const MENU_1 = [['fwd', 1, 'str'], ['fwd', 3, 'tuck'], ['back', 1, 'str'], ['fwd', 3, 'pike']];
export function menuFor(height) { return (height >= 5 ? MENU_10 : height >= 3 ? MENU_3 : MENU_1).map(([d, n, p]) => makeDive(d, n, p, height)); }

const IO = 11;
const IP = { tuck: 3.3, pike: 5.4, free: 7.0, str: IO };
const OMEGA_MAX = { tuck: 21, pike: 16, free: 14, str: 99 };
const TR = 0.07;
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

export function inertiaBlend(t, ta, tb) { return sm((t - ta) / TR) - sm((t - tb) / TR); }

/**
 * Solve take-off speed and angular momentum so the somersaults land exactly head-first.
 * theta = L * integral(dt / I(t)); I(t) switches between layout and the tuck/pike inertia.
 */
export function solveDive(dive, h0, board) {
  const theta = dive.n * Math.PI;
  const yCM0 = h0 + 0.96, yEnd = 1.15;
  const Ip = IP[dive.pos];
  let v = board ? (h0 < 2 ? 3.7 : 4.5) : 1.9;
  let out = null;
  for (; v < 11; v += 0.05) {
    const T = (v + Math.sqrt(v * v + 2 * G * (yCM0 - yEnd))) / G;
    const ta = Math.min(0.16, 0.13 * T);
    const tb = T - Math.min(0.55, Math.max(0.3, 0.22 * T + 0.05));
    let inv = 0; const N = 400;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N * T;
      inv += 1 / (IO + (Ip - IO) * inertiaBlend(t, ta, tb)) * (T / N);
    }
    const L = theta / inv;
    out = { T, vy: v, vh: board ? 1.6 : 1.25, L, ta, tb, Ip };
    if (L / Ip <= OMEGA_MAX[dive.pos]) break;
  }
  return out;
}

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.2;

/** Free flight of the diver's centre of mass + rigid rotation with conserved angular momentum. */
export class Flight {
  constructor(sol, dive, start, D, skill) {
    this.sol = sol; this.dive = dive;
    this.pos = start.clone();
    this.vel = D.clone().multiplyScalar(sol.vh); this.vel.y = sol.vy;
    this.D = D.clone();
    const sig = (0.006 + 0.008 * dive.dd) * (1.35 - skill);
    this.dta = gauss() * sig * 0.5; this.dtb = gauss() * sig;
    this.ta = sol.ta + this.dta; this.tb = sol.tb + this.dtb;
    this.t = 0; this.theta = 0; this.omega = 0; this.blend = 0;
    this.F = (dive.dir === 'fwd' || dive.dir === 'rev') ? D.clone() : D.clone().negate();
    this.sgn = (dive.dir === 'fwd' || dive.dir === 'inw') ? 1 : -1;
    this.axis = new THREE.Vector3().crossVectors(Y, this.F).normalize();
    this.yaw = Math.atan2(this.F.x, this.F.z);
    this.q = new THREE.Quaternion();
    this.entered = false; this.under = false;
    this.u = new THREE.Vector3(0, 1, 0);
    this.updateQ();
  }

  updateQ() {
    const qy = new THREE.Quaternion().setFromAxisAngle(Y, this.yaw);
    this.q.setFromAxisAngle(this.axis, this.sgn * this.theta).multiply(qy);
    this.u.set(0, 1, 0).applyQuaternion(this.q);
  }

  /** returns an entry-event object once, at the moment the lowest body point touches the water */
  step(dt) {
    let ev = null;
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (!this.entered) {
        this.t += h;
        this.blend = inertiaBlend(this.t, this.ta, this.tb);
        const I = IO + (this.sol.Ip - IO) * this.blend;
        this.omega = this.sol.L / I;
        this.theta += this.omega * h;
        this.vel.y -= G * h;
        this.pos.addScaledVector(this.vel, h);
        this.updateQ();
        const ux = this.u;
        const hand = this.pos.y + ux.y * 1.2, foot = this.pos.y - ux.y * 0.95;
        if (this.vel.y < 0 && Math.min(hand, foot) < 0) {
          this.entered = true; this.under = true;
          const tilt = Math.acos(Math.min(1, Math.max(-1, -ux.y))) * 180 / Math.PI;
          ev = {
            x: this.pos.x, z: this.pos.z, tilt, speed: this.vel.length(), vy: this.vel.y,
            eps: (this.theta - this.dive.n * Math.PI) * 180 / Math.PI, feetFirst: ux.y > 0.2, dta: this.dta, dtb: this.dtb,
          };
        }
      } else {
        this.omega *= Math.exp(-9 * h);
        this.theta += this.omega * h * 0;
        const k = 3.6;
        this.vel.y += (-k * this.vel.y + 4.6) * h;
        this.vel.x -= k * this.vel.x * h; this.vel.z -= k * this.vel.z * h;
        this.pos.addScaledVector(this.vel, h);
      }
    }
    return ev;
  }
}

/** Springboard: cantilever from the fulcrum to the tip, deflection shape of a tip-loaded beam. */
export class Springboard {
  constructor(mesh, length, cantilever) {
    this.mesh = mesh; this.len = length; this.lc = cantilever;
    this.orig = mesh.geometry.attributes.position.array.slice();
    this.d = -1; this.vib = 0; this.vibT = 99; this.vibA = 0;
  }
  bend(d) {
    if (Math.abs(d - this.d) < 1e-4) return;
    this.d = d;
    const pos = this.mesh.geometry.attributes.position, o = this.orig;
    const xf = this.len - this.lc;
    for (let i = 0; i < pos.count; i++) {
      const x = o[i * 3];
      const s = Math.min(this.lc, Math.max(0, x - xf));
      const y = -d * (s * s * (3 * this.lc - s)) / (2 * this.lc ** 3);
      pos.array[i * 3 + 1] = o[i * 3 + 1] + y;
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
  /** damped oscillation after the diver leaves */
  release(amp) { this.vibA = amp; this.vibT = 0; }
  update(dt) {
    if (this.vibT < 3) {
      this.vibT += dt;
      this.bend(this.vibA * Math.exp(-this.vibT / 0.55) * Math.cos(this.vibT * 2 * Math.PI * 3.2));
    }
  }
}

export function scoreFromEntry(ev, dive, rand = Math.random) {
  // execution score for one judge (0..10 in half points)
  const e = Math.abs(ev.tilt) + (ev.feetFirst ? 25 : 0);
  let s = 10 - 0.17 * e - 0.4 * Math.abs(ev.dtb) * 40;
  s += (rand() + rand() + rand() - 1.5) * 0.9;
  return Math.max(0, Math.min(10, Math.round(s * 2) / 2));
}
