import * as THREE from 'three';
import { Figure, POSES, blendPose, SKINS } from './figure.js';
import { POOLS, SPOTS, BOARDS, TOWER, CHILD_NODES, pathTo } from './layout.js';
import { solveDive, Flight } from './dive.js';
import { DECK_Y } from './shared.js';
import { textSprite } from './fx.js';
import {
  CTX, wait, until, smooth, clamp, lerp, angleLerp, groundedPose, groundedBlend, walkPath, turnTo, sitDown, standUp,
  swimTo, flipTurn, strokePose, swimBasis, glidePose, SWIM,
} from './motion.js';
import { Meet } from './meet.js';

const D = DECK_Y;
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SUITS = ['#c9403a', '#1a7dba', '#f6a63a', '#62ad48', '#b9567a', '#3b4fa6', '#fbd15a', '#1b8f93'];
const HAIR = ['#2a1c16', '#432c20', '#80573a', '#dbbc88', '#151a2b', '#a07448'];
const tmpPose = { flex: 0, fx: 0, fy: 0, fz: 0, hx: 0, hy: 0, hz: 0 };

export function basisQuat(out, head, chest) {
  const y = head.clone().normalize(), z = chest.clone();
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

class Actor {
  constructor(opts) {
    this.fig = new Figure(opts);
    CTX.scene.add(this.fig.root);
    this.gen = null; this.phase = 0; this.stroke = Math.random(); this.yaw = 0; this.dirx = 1;
    this.inWater = false; this.prev = [0, 0, 0, 0]; this.wakeT = 0; this.headWake = false;
  }
  update(dt) {
    this.inWater = false; this.headWake = false;
    if (!this.gen) this.gen = this.script();
    const r = this.gen.next(dt);
    if (r.done) this.gen = null;
    const f = this.fig;
    if (!this.inWater && f.wet > 0) f.wet = Math.max(0, f.wet - dt * CTX.env.dryRate() * 0.6);
    if (this.inWater) f.wet = 1;
  }
  /** a foot plants on dry deck: leave a wet footprint */
  step(side) {
    const f = this.fig, p = f.root.position;
    if (f.wet < 0.08 || Math.abs(p.y - D) > 0.04) return;
    const yaw = f.heading;
    const x = p.x + Math.cos(yaw) * 0.1 * side * f.scale, z = p.z - Math.sin(yaw) * 0.1 * side * f.scale;
    if (CTX.fx.poolAt(x, z)) return;
    CTX.fx.footprint(x, z, yaw, f.wet);
  }
  sitInstant(seat, yaw, P = POSES.sit) {
    this.fig.place(seat.x, seat.y, seat.z, yaw); groundedPose(this.fig, P);
  }
}

// ---------------------------------------------------------------------------------------------------
class LapSwimmer extends Actor {
  constructor(lane) {
    super({ skin: pick(SKINS), top: SUITS[lane % SUITS.length], bottom: SUITS[lane % SUITS.length], cap: pick(['#fbf8ef', '#c9403a', '#fbd15a', '#2a9bd1']) });
    this.lane = lane; this.style = pick(['free', 'free', 'back', 'breast']);
  }
  *script() {
    const P = POOLS.lap, z = P.z0 + 1 + 2 * this.lane;
    this.dirx = this.lane % 2 ? -1 : 1;
    this.fig.place(P.x0 + 4 + Math.random() * (P.w - 8), -0.04, z, 0);
    this.yaw = Math.atan2(this.dirx, 0);
    for (;;) {
      const wallX = this.dirx > 0 ? P.x0 + P.w : P.x0;
      yield* swimTo(this, wallX, z, { style: this.style, wallX, speed: SWIM[this.style].speed * (0.85 + (this.lane % 3) * 0.1) });
      yield* flipTurn(this, wallX, this.style);
      if (Math.random() < 0.5) this.style = pick(['free', 'free', 'back', 'breast']);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
class Child extends Actor {
  constructor(i) {
    super({ scale: 0.62, skin: pick(SKINS), top: pick(['#ee6b57', '#fbd15a', '#6f86d6', '#7fd6c8']), bottom: pick(['#3b4fa6', '#c9403a', '#23652f']), hair: pick(HAIR) });
    this.i = i; this.mode = 'run'; this.scold = 0; this.walkUntil = 0; this.t = 0;
  }
  update(dt) {
    this.t += dt;
    if (this.scold > 0) this.scold -= dt;
    if (this.mode === 'walk' && this.t > this.walkUntil && this.scold <= 0) this.mode = 'run';
    super.update(dt);
  }
  *script() {
    const f = this.fig;
    const n0 = CHILD_NODES[(this.i * 3) % CHILD_NODES.length];
    f.place(n0.x, D, n0.z, 0);
    for (;;) {
      if (this.scold > 0) {
        const ang = f.heading;
        while (this.scold > 0) { yield; groundedPose(f, POSES.stand); f.torso.rotation.x = 0.25; f.head.rotation.x = 0.4; }
        f.head.rotation.x = 0; continue;
      }
      const node = pick(CHILD_NODES);
      yield* walkPath(this, [node], () => (this.mode === 'run' ? 3.5 : 1.2), { run: () => this.mode === 'run', abort: () => this.scold > 0 });
      if (this.scold > 0) continue;
      if (Math.random() < 0.4) { const t = 0.8 + Math.random() * 2; yield* wait(t); }
    }
  }
}

class Guard extends Actor {
  constructor() {
    super({ skin: '#d39a76', top: '#c9403a', bottom: '#fbf8ef', cap: '#fbd15a' });
    this.cool = 3; this.blow = 0; this.t = 0;
    this.bubble = textSprite('TWEEEET!', 52, 14, 2.4, '#fbf8ef', '#8e2a2d');
    CTX.scene.add(this.bubble);
  }
  whistle(child) {
    this.blow = 1.3; this.cool = 6;
    child.scold = 2.2; child.mode = 'walk'; child.walkUntil = child.t + 7;
  }
  *script() {
    const c = SPOTS.guardChair, f = this.fig;
    for (;;) {
      const dt = yield;
      this.t += dt; this.cool -= dt;
      f.place(c.x, c.y + 1.6, c.z, Math.sin(this.t * 0.35) * 0.9);
      groundedPose(f, POSES.sit);
      if (this.blow > 0) {
        this.blow -= dt;
        const k = smooth(Math.min(1, (1.3 - this.blow) / 0.2));
        f.armIK(0, V.set(0.08, 0.78, 0.2).lerp(V2.set(0.26, 0.0, 0.32), 1 - k), V3.set(0.3, 0, -0.3));
        this.bubble.visible = true; this.bubble.position.set(c.x, c.y + 3.9, c.z).addScaledVector(V.set(0.8, 0, 0.8).normalize(), 0.5);
      } else this.bubble.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
class Judge extends Actor {
  constructor(i) {
    super({ skin: pick(SKINS), top: pick(['#fbf8ef', '#dfe1e8', '#9399ab']), bottom: '#232a42', hair: pick(HAIR), long: i % 2 === 1 });
    this.i = i; this.raise = 0; this.want = 0;
    const c = document.createElement('canvas'); c.width = 48; c.height = 36; this.cv = c;
    this.tex = new THREE.CanvasTexture(c); this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.NearestFilter; this.tex.colorSpace = THREE.SRGBColorSpace;
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.465), new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide }));
    this.card.rotation.y = Math.PI / 2; this.card.visible = false; CTX.scene.add(this.card);
    this.draw('', false);
  }
  draw(text, dropped) {
    const g = this.cv.getContext('2d');
    g.fillStyle = '#fbf8ef'; g.fillRect(0, 0, 48, 36); g.fillStyle = '#151a2b'; g.fillRect(0, 0, 48, 2); g.fillRect(0, 34, 48, 2);
    g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = dropped ? '#8e2a2d' : '#151a2b'; g.fillText(text, 24, 19);
    if (dropped) { g.strokeStyle = '#c9403a'; g.lineWidth = 3; g.beginPath(); g.moveTo(4, 32); g.lineTo(44, 4); g.stroke(); }
    this.tex.needsUpdate = true;
  }
  *script() {
    const p = SPOTS.judges[this.i], f = this.fig;
    f.place(p.x, p.y + 0.02, p.z, Math.PI / 2); groundedPose(f, POSES.sit);
    const C = v3(p.x + 0.55, D + 1.55, p.z + 0.05);
    this.card.position.copy(C).add(v3(0, 0.3, 0));
    let t = Math.random() * 10;
    for (;;) {
      const dt = yield; t += dt;
      this.raise += (this.want - this.raise) * Math.min(1, dt * 7);
      groundedPose(f, POSES.sit);
      f.head.rotation.y = Math.sin(t * 0.4 + this.i) * 0.3 * (1 - this.raise);
      if (this.raise > 0.02) {
        f.torso.updateWorldMatrix(true, false);
        const tgt = f.torso.worldToLocal(V.copy(C));
        f.armIK(0, V2.set(0.26, 0.0, 0.32).lerp(tgt, this.raise), V3.set(0.3, 0, -0.5));
        this.card.visible = this.raise > 0.7;
      } else this.card.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
class Sunbather extends Actor {
  constructor(spot) { super({ skin: pick(SKINS), top: pick(SUITS), bottom: pick(SUITS), hair: pick(HAIR), long: Math.random() < 0.5 }); this.spot = spot; }
  *script() {
    const f = this.fig; let t = Math.random() * 20;
    f.place(this.spot.x, this.spot.y + 0.1, this.spot.z + 0.0, 0);
    for (;;) {
      const dt = yield; t += dt;
      f.pelvis.position.set(0, 0, 0);
      f.setBasis(V.set(0, 0.55, 0.85), V2.set(0, 0.85, -0.55));
      f.torso.rotation.set(0, 0, 0); f.head.rotation.set(0.1, Math.sin(t * 0.2) * 0.25, 0);
      for (let i = 0; i < 2; i++) { const s = i ? -1 : 1; f.legIK(i, V.set(s * 0.12, -0.83, 0), V2.set(0, 0.1, 1)); f.armIK(i, V.set(s * 0.3, 0.0, 0.2 + (i === 0 && Math.sin(t * 0.3) > 0.97 ? 0.5 : 0)), V2.set(s, 0, -0.5)); }
    }
  }
}

class Vendor extends Actor {
  constructor() { super({ skin: '#a86a4d', top: '#fbf8ef', bottom: '#232a42', cap: '#c9403a' }); }
  *script() {
    const f = this.fig; let t = 0;
    f.place(20, D, -3.6, 0);
    for (;;) {
      t += yield;
      groundedPose(f, POSES.stand);
      f.armIK(0, V.set(0.3 + Math.sin(t * 1.3) * 0.12, -0.05, 0.55 + Math.cos(t * 1.3) * 0.1), V2.set(0.4, -0.2, -0.5));
      f.head.rotation.y = Math.sin(t * 0.4) * 0.5;
    }
  }
}

class Sitter extends Actor {
  constructor(seat, yaw) { super({ skin: pick(SKINS), top: pick(SUITS), bottom: pick(['#3b4fa6', '#232a42']), hair: pick(HAIR), long: Math.random() < 0.5 }); this.seat = seat; this.yawS = yaw; }
  *script() {
    const f = this.fig; let t = Math.random() * 9;
    f.place(this.seat.x, D + 0.02, this.seat.z, this.yawS);
    for (;;) {
      t += yield; groundedPose(f, POSES.sit);
      f.head.rotation.y = Math.sin(t * 0.5) * 0.5;
      f.armIK(1, V.set(-0.1, 0.1, 0.5), V2.set(-0.4, 0, -0.5));
    }
  }
}

// ---------------------------------------------------------------------------------------------------
const FLIGHT_BASE = { ...POSES.armsOut };
const LADDERS = [SPOTS.ladderW, SPOTS.ladderS];

class Diver extends Actor {
  constructor(meet, i, name, skinIdx) {
    super({ skin: SKINS[skinIdx % SKINS.length], top: SUITS[(i * 2 + 1) % SUITS.length], bottom: SUITS[(i * 2 + 1) % SUITS.length], cap: i % 2 ? SUITS[(i * 3) % SUITS.length] : null, hair: pick(HAIR), long: i % 2 === 0 });
    this.meet = meet; this.i = i; this.name = name; this.skill = 0.65 + Math.random() * 0.3;
    this.mode = 'meet'; this.task = null; this.go = false; this.state = 'bench'; this.total = 0; this.last = null; this.celebrate = false;
    this.seat = SPOTS.benches[i].clone(); this.showering = false; this.entry = null; this.q = new THREE.Quaternion(); this.boardKey = 0;
  }

  reset() {
    this.gen = null; this.task = null; this.go = false; this.state = 'bench'; this.entry = null;
    if (this.showering) { CTX.fx.showerOn--; this.showering = false; }
    this.fig.pelvis.quaternion.identity(); this.fig.root.rotation.set(0, 0, 0);
    for (const k in CTX.world.boards) CTX.world.boards[k].bend(0);
  }

  *script() {
    this.fig.wet = 0;
    this.fig.place(this.seat.x, D + 0.02, this.seat.z, 0); groundedPose(this.fig, POSES.sit);
    this.state = 'bench';
    for (;;) {
      if (this.mode === 'free') { yield* this.freeLoop(); continue; }
      if (this.task) {
        const task = this.task; this.task = null;
        yield* standUp(this);
        yield* this.doDive(task);
        yield* this.afterDive();
        continue;
      }
      yield* this.idle();
    }
  }

  *idle() {
    const dt = yield; const f = this.fig;
    if (this.celebrate) { groundedPose(f, POSES.sit); f.armIK(0, V.set(0.3, 1.0, 0.1), V2.set(0.4, 0, -0.5)); f.armIK(1, V.set(-0.3, 1.0 + Math.sin(this.phase) * 0.1, 0.1), V2.set(-0.4, 0, -0.5)); this.phase += dt * 8; return; }
    groundedPose(f, POSES.sit);
    this.phase += dt;
    f.head.rotation.set(0, Math.sin(this.phase * 0.5 + this.i) * 0.5, 0);
  }

  *freeLoop() {
    yield* standUp(this);
    for (; this.mode === 'free';) {
      const roll = Math.random();
      if (roll < 0.7) {
        const h = pick([1, 3]);
        const dive = pick([null, 'fwd1']);
        const d = { dir: 'fwd', n: pick([0, 0, 1]), pos: 'str', name: 'Jump', dd: 1, height: h };
        yield* this.doDive({ dive: d, height: h, scored: false });
      }
      yield* this.afterDive();
      yield* wait(1 + Math.random() * 3);
    }
  }

  *doDive({ dive, height, scored }) {
    const f = this.fig;
    this.state = 'climb'; this.curDive = dive; this.scored = scored;
    const path = pathTo(height);
    const first = path[0];
    if (f.root.position.y < D + 0.01 && Math.hypot(f.root.position.x - first.x, f.root.position.z - first.z) > 1) {
      yield* walkPath(this, [v3(f.root.position.x, D, f.root.position.z > -12.4 ? f.root.position.z : -12.2), v3(first.x, D, first.z)], 1.3);
    }
    yield* walkPath(this, path, 1.25);
    const P = path[path.length - 1];
    const board = height < 5;
    const Dir = board ? BOARDS[height].dir : TOWER.dir;
    const faceYaw = Math.atan2(Dir.x, Dir.z);
    const backFacing = dive.dir === 'back' || dive.dir === 'inw';
    if (board) {
      this.boardKey = height;
      const B = BOARDS[height], bd = CTX.world.boards[height];
      const tip = v3(B.x, B.y, B.z);
      if (backFacing) {
        yield* walkPath(this, [v3(B.x + 0.5, B.y, B.z)], 1.0, { yOff: (p) => this.boardY(bd, p.x) });
        yield* turnTo(this, faceYaw + Math.PI, 5);
        P.copy(v3(B.x + 0.15, B.y, B.z));
      } else {
        yield* walkPath(this, [v3(10.6, B.y, B.z)], 1.0, { yOff: (p) => this.boardY(bd, p.x) });
      }
      this.state = 'ready';
      yield* until(() => this.go || this.mode === 'free');
    } else {
      yield* turnTo(this, backFacing ? faceYaw + Math.PI : faceYaw, 5);
      this.state = 'ready';
      yield* until(() => this.go || this.mode === 'free');
    }
    this.go = false; this.state = 'flight';
    const sol = solveDive(dive, height, board);
    let flight;
    if (board) flight = yield* this.boardTakeoff(dive, height, sol, backFacing);
    else flight = yield* this.platformTakeoff(dive, height, sol, P, Dir, backFacing);
    yield* this.fly(dive, flight, scored);
    yield* this.exitWater();
  }

  boardY(bd, x) {
    const Lc = bd.lc, xf = 11.2, s = clamp(xf - x, 0, Lc);
    const d = 0.05 * clamp((xf - x) / Lc, 0, 1);
    bd.bend(d);
    return -d * (s * s * (3 * Lc - s)) / (2 * Lc ** 3);
  }

  *platformTakeoff(dive, h, sol, P, Dir, backFacing) {
    const f = this.fig;
    yield* wait(0.9);
    let t = 0;
    while (t < 0.55) { t += yield; groundedBlend(f, POSES.stand, POSES.crouch, smooth(t / 0.55)); }
    t = 0;
    while (t < 0.16) { t += yield; groundedBlend(f, POSES.crouch, POSES.armsUp, smooth(t / 0.16)); }
    return new Flight(sol, dive, v3(P.x, P.y + 0.95, P.z), Dir, this.skill);
  }

  *boardTakeoff(dive, key, sol, backFacing) {
    const f = this.fig, B = BOARDS[key], bd = CTX.world.boards[key];
    const tipX = B.x;
    const dmax = clamp(0.075 * sol.vy, 0.2, 0.45);
    const surf = (d) => B.y - d;
    let t = 0;
    const setY = (d, P, ycrouch = 0) => { f.root.position.y = surf(d); };
    if (!backFacing) {
      // three-step approach and hurdle
      yield* walkPath(this, [v3(9.55, B.y, B.z)], 1.5, { yOff: (p) => this.boardY(bd, p.x) });
      t = 0; const T = 0.58, x0 = f.root.position.x;
      while (t < T) {
        t += yield; const u = t / T;
        f.root.position.x = lerp(x0, tipX + 0.1, smooth(u));
        f.root.position.y = B.y + 0.55 * 4 * u * (1 - u) + (1 - u) * this.boardY(bd, f.root.position.x) * 0;
        groundedPose(f, POSES.stand); f.pelvis.position.y = 0.89 + 0.0;
        f.legIK(0, V.set(0.09, -0.32, 0.38), V2.set(0, 0.2, 1)); f.legIK(1, V.set(-0.09, -0.72, -0.06), V2.set(0, 0.2, 1));
        const a = smooth(u);
        f.armIK(0, V.set(0.26, 0.5 + a * 0.5, 0.1 + a * 0.2), V2.set(0.5, -0.2, -0.7)); f.armIK(1, V.set(-0.26, 0.5 + a * 0.5, 0.1 + a * 0.2), V2.set(-0.5, -0.2, -0.7));
      }
    } else {
      // two preparatory bounces
      for (let b = 0; b < 2; b++) {
        t = 0;
        while (t < 0.55) { t += yield; const u = t / 0.55; bd.bend(0.12 * Math.sin(Math.PI * u) * (b + 1)); f.root.position.y = surf(0.12 * Math.sin(Math.PI * u) * (b + 1)) + 0.08 * Math.sin(Math.PI * u); groundedBlend(f, POSES.stand, POSES.crouch, Math.sin(Math.PI * u) * 0.5); }
      }
    }
    f.root.position.x = tipX + (backFacing ? 0.15 : 0.0);
    // land on the tip: board loads
    t = 0;
    while (t < 0.2) { t += yield; const d = dmax * Math.sin(Math.PI / 2 * t / 0.2); bd.bend(d); f.root.position.y = surf(d); groundedBlend(f, POSES.stand, POSES.crouch, smooth(t / 0.2)); }
    t = 0;
    const UP = 0.15;
    while (t < UP) {
      t += yield; const tau = Math.min(1, t / UP), d = dmax * (1 - tau * tau);
      bd.bend(d); f.root.position.y = surf(d); groundedBlend(f, POSES.crouch, POSES.armsUp, smooth(tau));
    }
    bd.bend(0); bd.release(0.14);
    const Dir = BOARDS[key].dir;
    return new Flight(sol, dive, v3(tipX + (backFacing ? 0.15 : 0.0), B.y + 0.95, B.z), Dir, this.skill);
  }

  *fly(dive, fl, scored) {
    const f = this.fig;
    for (;;) {
      const dt = yield;
      const ev = fl.step(dt);
      f.root.position.copy(fl.pos); f.root.rotation.set(0, 0, 0);
      f.pelvis.position.set(0, 0, 0); f.pelvis.quaternion.copy(fl.q);
      const T = fl.sol.T;
      let base;
      if (dive.n === 0) base = blendPose(tmpPose, POSES.armsOut, POSES.stand, smooth(fl.t / T));
      else if (dive.pos === 'str') base = blendPose(tmpPose, POSES.armsOut, POSES.lineUp, smooth((fl.t - 0.25 * T) / (0.45 * T)));
      else base = blendPose(tmpPose, POSES.lineUp, POSES[dive.pos], fl.blend);
      f.head.rotation.set(0, 0, 0);
      f.applyPose(base);
      if (ev) {
        this.entry = ev; this.state = 'water'; f.wet = 1;
        CTX.fx.splash(ev.x, ev.z, ev.speed, ev.tilt, ev.feetFirst);
        if (scored) this.meet.onEntry(this, ev, dive);
      }
      if (fl.entered) break;
    }
    // underwater
    const qDown = basisQuat(new THREE.Quaternion(), V.set(0, -1, 0), fl.F), qUp = basisQuat(new THREE.Quaternion(), V.set(0, 1, 0), fl.F);
    const P = POOLS.dive; let bt = 0, t = 0;
    for (;;) {
      const dt = yield; t += dt; bt += dt;
      fl.step(dt);
      if (fl.pos.y < -3.95) { fl.pos.y = -3.95; fl.vel.y = Math.max(fl.vel.y, 0.25); }
      if (fl.pos.x < P.x0 + 0.9 || fl.pos.x > P.x0 + P.w - 0.9) { fl.pos.x = clamp(fl.pos.x, P.x0 + 0.9, P.x0 + P.w - 0.9); fl.vel.x = 0; }
      if (fl.pos.z < P.z0 + 0.9 || fl.pos.z > P.z0 + P.d - 0.9) { fl.pos.z = clamp(fl.pos.z, P.z0 + 0.9, P.z0 + P.d - 0.9); fl.vel.z = 0; }
      f.root.position.copy(fl.pos);
      if (fl.vel.y < 0.15 && t < 0.8) fl.q.slerp(qDown, 1 - Math.exp(-dt * 6)); else fl.q.slerp(qUp, 1 - Math.exp(-dt * (fl.vel.y > 0 ? 2.2 : 0.5)));
      f.pelvis.quaternion.copy(fl.q);
      blendPose(tmpPose, POSES.lineUp, POSES.stand, smooth((t - 0.5) / 1.5));
      f.applyPose(tmpPose);
      if (bt > 0.12 && fl.pos.y < -0.8) { bt = 0; CTX.fx.bubbleBurst(fl.pos.x, fl.pos.y, fl.pos.z, 1); }
      this.inWater = true;
      if (fl.pos.y > -0.62 && fl.vel.y > 0 && t > 0.6) break;
    }
    this.entryEnd = fl;
  }

  *exitWater() {
    const f = this.fig, fl = this.entryEnd, p = f.root.position;
    CTX.fx.ripple(p.x, p.z, 0.5, -0.06); CTX.fx.smallSplash(p.x, 0.02, p.z, 6, 0.8);
    this.yaw = fl.yaw; this.stroke = 0;
    // head to the nearest ladder, swimming a few strokes (more in free swim)
    if (this.mode === 'free' && Math.random() < 0.7) {
      const P = POOLS.dive;
      for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
        yield* swimTo(this, P.x0 + 2 + Math.random() * (P.w - 8), P.z0 + 2 + Math.random() * (P.d - 5), { style: pick(['free', 'back', 'breast']), tol: 0.8 });
      }
    }
    const L = LADDERS.reduce((a, b) => (Math.hypot(a.water.x - p.x, a.water.z - p.z) < Math.hypot(b.water.x - p.x, b.water.z - p.z) ? a : b));
    // while the ladder is occupied (next diver?), nothing else to wait for
    yield* swimTo(this, L.water.x, L.water.z, { style: 'free', speed: 1.1, tol: 0.25 });
    // transition to upright and climb
    let t = 0;
    const q0 = f.pelvis.quaternion.clone(), x0 = p.x, z0 = p.z;
    const yaw = Math.atan2(L.rail.x - L.water.x, L.rail.z - L.water.z);
    f.heading = yaw; f.root.rotation.set(0, yaw, 0);
    const qFace = new THREE.Quaternion();
    this.inWater = true;
    const T = 4.0;
    // world-space orientation of the swim pose, relative to root yaw
    const rootQ = new THREE.Quaternion().setFromAxisAngle(Y, yaw).invert();
    q0.premultiply(rootQ);
    while (t < T) {
      const dt = yield; t += dt; this.inWater = t < T - 0.9;
      const k = smooth(t / 0.6), u = smooth(t / T);
      p.x = lerp(x0, L.water.x + (L.rail.x - L.water.x) * 0.55, smooth(t / 0.6)); p.z = lerp(z0, L.water.z + (L.rail.z - L.water.z) * 0.55, smooth(t / 0.6));
      const pelvisY = lerp(-0.04, D + 0.95, u);
      const pl = 0.89 * k;
      f.pelvis.position.set(0, pl, 0);
      f.pelvis.quaternion.copy(q0).slerp(qFace.identity(), k);
      p.y = pelvisY - pl;
      f.torso.rotation.set(0.1 * k, 0, 0);
      const ph = t * 1.3;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1, a = Math.sin(Math.PI * 2 * (ph + i * 0.5));
        f.armIK(i, V.set(s * 0.22, 0.45 + 0.6 + 0.16 * a, 0.22), V2.set(s * 0.5, 0, -0.3));
        f.legIK(i, V3.set(s * 0.1, -0.5 + 0.22 * Math.max(0, -a), 0.28), V2.set(0, 0.1, 1));
      }
    }
    f.wet = 1; this.state = 'out';
    p.y = D;
    yield* walkPath(this, [L.deck.clone()], 1.2);
  }

  *afterDive() {
    const f = this.fig; const free = this.mode === 'free';
    this.state = 'out';
    if (!free || Math.random() < 0.5) {
      const s = SPOTS.shower;
      yield* walkPath(this, [v3(s.x + 0.9, D, s.z + 0.9), v3(s.x, D, s.z + 0.15)], 1.25);
      yield* turnTo(this, 0, 5);
      CTX.fx.showerOn++; this.showering = true; f.wet = 1;
      let t = 0; const T = free ? 4 : 5.5;
      while (t < T) {
        t += yield;
        groundedPose(f, POSES.stand); const w = Math.sin(t * 5) * 0.06;
        f.armIK(0, V.set(0.19, 0.78 + w, 0.16), V2.set(0.6, 0, -0.8)); f.armIK(1, V.set(-0.19, 0.78 - w, 0.16), V2.set(-0.6, 0, -0.8));
        f.head.rotation.x = -0.15;
      }
      f.head.rotation.x = 0; CTX.fx.showerOn--; this.showering = false;
    }
    if (!free || Math.random() < 0.5) {
      const tb = SPOTS.tub, a = this.i * 1.25 + 0.5;
      yield* walkPath(this, [v3(tb.x + 2.3, D, tb.z + 0.6), v3(tb.x + 2.0, D, tb.z)], 1.2);
      const slot = v3(tb.x + Math.cos(a) * 0.75, D - 0.1, tb.z + Math.sin(a) * 0.75);
      const yawIn = Math.atan2(tb.x - slot.x, tb.z - slot.z);
      yield* turnTo(this, Math.atan2(-1, 0), 6);
      yield* sitDown(this, slot, yawIn, 0.9);
      let t = 0; const T = free ? 7 : 11;
      while (t < T) {
        t += yield; groundedPose(f, POSES.sit);
        f.head.rotation.set(-0.1, Math.sin(t * 0.7 + this.i) * 0.4, 0);
        f.armIK(0, V.set(0.42, 0.15 + Math.sin(t * 1.3) * 0.04, 0.25), V2.set(0.5, 0, -0.5)); f.armIK(1, V.set(-0.42, 0.15, 0.25), V2.set(-0.5, 0, -0.5));
        f.wet = 1;
      }
      yield* standUp(this);
      yield* walkPath(this, [v3(tb.x + 2.0, D, tb.z + 0.2)], 1.0);
    }
    if (free) return;
    this.state = 'bench';
    yield* walkPath(this, [v3(this.seat.x, D, -11.8), v3(this.seat.x, D, this.seat.z + 0.55)], 1.3);
    yield* turnTo(this, 0, 6);
    yield* sitDown(this, v3(this.seat.x, D + 0.02, this.seat.z), 0, 0.6);
    this.state = 'bench';
  }
}

// ---------------------------------------------------------------------------------------------------
const NAMES = ['Mina Okafor', 'Teo Laurent', 'Iris Valdez', 'Bram Kessler', 'Suki Aoyama'];

export class Actors {
  constructor({ scene, world, fx, env }) {
    CTX.scene = scene; CTX.world = world; CTX.fx = fx; CTX.env = env; CTX.actors = this;
    this.all = [];
    this.meet = new Meet(this);
    this.lap = [0, 1, 2, 3, 4].map((l) => new LapSwimmer(l));
    this.divers = NAMES.map((n, i) => new Diver(this.meet, i, n, i));
    this.kids = [0, 1, 2, 3].map((i) => new Child(i));
    this.guard = new Guard();
    this.judges = [0, 1, 2, 3, 4].map((i) => new Judge(i));
    const lg = world.loungers;
    this.statics = [new Sunbather(lg[0]), new Sunbather(lg[2]), new Sunbather(lg[5]), new Vendor(), new Sitter(v3(17.5, 0, 4.4), Math.PI), new Sitter(v3(21.5, 0, 3.6), Math.PI * 1.5)];
    this.all = [...this.lap, ...this.divers, ...this.kids, this.guard, ...this.judges, ...this.statics];
    this.meet.start('10');
  }

  setEvent(ev) { this.meet.start(ev); }

  update(dt, time) {
    for (const a of this.all) a.update(dt);
    this.meet.update(dt);
    // whistle: running child near a pool edge
    const g = this.guard;
    if (g.cool <= 0) {
      for (const c of this.kids) {
        if (c.mode !== 'run' || c.scold > 0) continue;
        const p = c.fig.root.position;
        let near = false;
        for (const k in POOLS) { const P = POOLS[k]; if (p.x > P.x0 - 3 && p.x < P.x0 + P.w + 3 && p.z > P.z0 - 3 && p.z < P.z0 + P.d + 3) near = true; }
        if (near) { g.whistle(c); break; }
      }
    }
  }

  /** after matrices are fresh: hands, feet and heads disturb the water */
  afterPose(dt) {
    const fx = CTX.fx;
    for (const a of [...this.lap, ...this.divers]) {
      const f = a.fig;
      if (!a.inWater) { a.prev.fill(1); continue; }
      const pts = [f.hand(0, V), f.hand(1, V2), f.foot(0, V3)];
      const arr = [V.clone(), V2.clone(), V3.clone(), f.foot(1, new THREE.Vector3())];
      for (let i = 0; i < 4; i++) {
        const y = arr[i].y;
        if (a.prev[i] > 0.02 && y <= 0.02 && f.root.position.y > -0.5) {
          fx.ripple(arr[i].x, arr[i].z, 0.28, i < 2 ? -0.05 : -0.035);
          if (i < 2) fx.smallSplash(arr[i].x, 0.03, arr[i].z, 2, 0.5);
        }
        a.prev[i] = y;
      }
      a.wakeT -= dt;
      if (a.wakeT <= 0 && f.root.position.y > -0.2) {
        a.wakeT = 0.22;
        V.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        fx.ripple(f.root.position.x + V.x * 0.9, f.root.position.z + V.z * 0.9, 0.4, -0.02);
      }
    }
  }
}
