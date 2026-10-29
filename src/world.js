import * as THREE from 'three';
import { U, DECK_Y } from './shared.js';
import { POOLS, ISLAND, TOWER, BOARDS, SPOTS } from './layout.js';
import { WaterField, waterMaterial, tileMaterial } from './water.js';
import { Springboard } from './dive.js';
import { lam } from './figure.js';

const D = DECK_Y;
const matC = new Map();
function mat(color, o) { return lam(color, o); }

export function box(parent, [w, h, d], color, [x, y, z], o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material || mat(color));
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
  if (o.rot) m.rotation.set(...o.rot);
  parent.add(m); return m;
}
function cyl(parent, r, h, color, [x, y, z], seg = 10, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r2 ?? r, r, h, seg), o.material || mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
export function labelTex(text, w, h, fg, bg, size = 10) {
  return canvasTex(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = fg; g.font = `bold ${size}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}
function stripeTex(c1, c2, n) {
  return canvasTex(n * 4, 4, (g, w, h) => {
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c2 : c1; g.fillRect(i * 4, 0, 4, h); }
  });
}

const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

function outline(a, b, n, inset = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const k = 1 + 0.025 * Math.sin(5 * t + 1) + 0.02 * Math.sin(9 * t + 2) + 0.015 * Math.sin(3 * t);
    pts.push(new THREE.Vector2(
      ISLAND.cx + (a - inset) * Math.sign(c) * Math.sqrt(Math.abs(c)) * k,
      ISLAND.cz + (b - inset) * Math.sign(s) * Math.sqrt(Math.abs(s)) * k));
  }
  return pts;
}

function slabGeometry(pts, holes, y0, y1) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) {
    const path = new THREE.Path();
    path.moveTo(h.x0, -h.z0);
    path.lineTo(h.x0 + h.w, -h.z0); path.lineTo(h.x0 + h.w, -(h.z0 + h.d)); path.lineTo(h.x0, -(h.z0 + h.d));
    path.closePath(); shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

function rockUnder(pts, depthTop) {
  const N = pts.length, rings = 9, pos = [], col = [];
  const grid = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, s = 1 - 0.95 * Math.pow(t, 0.8), y = depthTop - 30 * Math.pow(t, 1.1);
    const row = [];
    for (let i = 0; i < N; i++) {
      const j = hash(i, r), j2 = hash(i + 50, r);
      const k = r === 0 ? 1 : s * (1 + 0.16 * (j - 0.5));
      row.push(new THREE.Vector3(ISLAND.cx + (pts[i].x - ISLAND.cx) * k, y + (r === 0 ? 0 : (j2 - 0.5) * 3.0 * (1 - t * 0.5)), ISLAND.cz + (pts[i].y - ISLAND.cz) * k));
    }
    grid.push(row);
  }
  const tri = (a, b, c, t) => {
    for (const p of [a, b, c]) pos.push(p.x, p.y, p.z);
    const base = new THREE.Color().setHSL(0.07 - t * 0.04, 0.35 - t * 0.2, 0.28 - t * 0.1 + (hash(a.x * 7, a.z * 3) - 0.5) * 0.06);
    if (t > 0.35) base.lerp(new THREE.Color('#4d566f'), Math.min(0.7, (t - 0.3)));
    for (let q = 0; q < 3; q++) col.push(base.r, base.g, base.b);
  };
  for (let r = 0; r < rings; r++) for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N, t = (r + 0.5) / rings;
    tri(grid[r][i], grid[r + 1][i], grid[r][i2], t);
    tri(grid[r][i2], grid[r + 1][i], grid[r + 1][i2], t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true; return m;
}

function tree(parent, x, z, s, seedv) {
  const g = new THREE.Group(); g.position.set(x, 0.1, z);
  cyl(g, 0.16 * s, 1.6 * s, '#5f3f2a', [0, 0.8 * s, 0], 6);
  const cols = ['#23652f', '#3a8a3a', '#17492a'];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry((1.15 - i * 0.2) * s, 0), new THREE.MeshLambertMaterial({ color: cols[(i + seedv) % 3], flatShading: true }));
    m.position.set((hash(seedv, i) - 0.5) * 0.4 * s, (2.0 + i * 0.7) * s, (hash(seedv, i + 9) - 0.5) * 0.4 * s);
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  parent.add(g);
}

function stairs(parent, a, b, width, color, rail = true) {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, len = Math.hypot(dx, dz);
  const n = Math.max(3, Math.round(Math.abs(dy) / 0.22));
  const yaw = Math.atan2(dx, dz);
  const g = new THREE.Group(); g.position.set(a.x, a.y, a.z); g.rotation.y = yaw; parent.add(g);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    box(g, [width, 0.07, len / n + 0.02], color, [0, dy * (i + 1) / n - 0.035, len * t]);
  }
  const slope = Math.atan2(dy, len), L = Math.hypot(len, dy);
  for (const s of [-1, 1]) {
    box(g, [0.1, 0.22, L], '#7c746a', [s * (width / 2 - 0.05), dy / 2 - 0.16, len / 2], { rot: [-slope, 0, 0] });
    if (rail) {
      box(g, [0.05, 0.05, L], '#dfe1e8', [s * (width / 2), dy / 2 + 0.95, len / 2], { rot: [-slope, 0, 0] });
      for (let i = 0; i <= 4; i++) { const t = i / 4; box(g, [0.04, 0.95, 0.04], '#dfe1e8', [s * (width / 2), dy * t + 0.47, len * t]); }
    }
  }
}

function railing(parent, x0, z0, x1, z1, y, color = '#dfe1e8', h = 1.0) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const g = new THREE.Group(); g.position.set(x0, y, z0); g.rotation.y = Math.atan2(dx, dz); parent.add(g);
  box(g, [0.05, 0.05, len], color, [0, h, len / 2]);
  box(g, [0.03, 0.03, len], color, [0, h * 0.5, len / 2]);
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) box(g, [0.04, h, 0.04], color, [0, h / 2, len * i / n]);
}

export function buildWorld(scene) {
  const W = {
    glow: [], hideForRefl: [], pools: {}, boards: {}, update: [], deckMat: null, lampPoints: [],
  };
  const glowMat = (color, k = 1) => {
    const m = new THREE.MeshLambertMaterial({ color: '#555a66', emissive: new THREE.Color(color), emissiveIntensity: 0 });
    W.glow.push({ m, k }); return m;
  };
  const root = new THREE.Group(); scene.add(root); W.root = root;

  // ---- island ------------------------------------------------------------------------------
  const holes = [POOLS.dive, POOLS.lap];
  const outer = outline(ISLAND.a, ISLAND.b, 96);
  const inner = outline(ISLAND.a, ISLAND.b, 96, 2.4);
  const earthTex = canvasTex(8, 8, (g) => { for (let i = 0; i < 64; i++) { g.fillStyle = `hsl(100,${40 + hash(i) * 10}%,${26 + hash(i, 3) * 8}%)`; g.fillRect(i % 8, (i / 8) | 0, 1, 1); } }, [0.5, 0.5]);
  const body = new THREE.Mesh(slabGeometry(outer, holes, -6, 0.1), [
    new THREE.MeshLambertMaterial({ map: earthTex }), new THREE.MeshLambertMaterial({ color: '#5f3f2a' }),
  ]);
  body.receiveShadow = true; body.castShadow = true; root.add(body);
  const deckTex = canvasTex(32, 32, (g, w, h) => {
    g.fillStyle = '#c9bfac'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = hash(i, 4) > 0.5 ? '#c0b5a1' : '#d2c8b4'; g.fillRect((hash(i, 1) * w) | 0, (hash(i, 2) * h) | 0, 2, 1); }
    g.fillStyle = '#a39a8b'; g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  }, [0.25, 0.25]);
  W.deckMat = new THREE.MeshLambertMaterial({ map: deckTex });
  const deck = new THREE.Mesh(slabGeometry(inner, holes, -0.5, D), [W.deckMat, new THREE.MeshLambertMaterial({ color: '#a39a8b' })]);
  deck.receiveShadow = true; deck.castShadow = true; root.add(deck);
  const rock = rockUnder(outer, -6); root.add(rock);
  for (let i = 0; i < 7; i++) { // hanging spikes
    const a = hash(i, 8) * Math.PI * 2, r = 4 + hash(i, 9) * 12;
    const m = new THREE.Mesh(new THREE.ConeGeometry(1.2 + hash(i, 2) * 1.2, 6 + hash(i, 5) * 8, 5), new THREE.MeshLambertMaterial({ color: '#4d566f', flatShading: true }));
    m.rotation.x = Math.PI; m.position.set(ISLAND.cx + Math.cos(a) * r, -17 - hash(i, 3) * 8, ISLAND.cz + Math.sin(a) * r * 0.8); m.castShadow = true; root.add(m);
  }
  // grass rim & trees
  for (let i = 0; i < 26; i++) {
    const p = inner[(i * 96 / 26 | 0)];
    const dx = p.x - ISLAND.cx, dz = p.y - ISLAND.cz, k = 1 + (1.1 / Math.hypot(dx, dz));
    tree(root, ISLAND.cx + dx * k, ISLAND.cz + dz * k, 0.9 + hash(i, 1) * 0.8, i);
  }

  // ---- pools ---------------------------------------------------------------------------------
  function buildPool(key, o) {
    const P = POOLS[key];
    const field = new WaterField({ x0: P.x0, z0: P.z0, w: P.w, d: P.d, damp: key === 'dive' ? 0.994 : 0.9925 });
    const cx = P.x0 + P.w / 2, cz = P.z0 + P.d / 2;
    const lamps = [];
    const lg = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      for (const side of [0, 1]) {
        const x = P.x0 + P.w * (i + 0.5) / 4, y = key === 'dive' ? -2.2 : -0.9;
        const z = side ? P.z0 + P.d - 0.04 : P.z0 + 0.04;
        lamps.push([x, y, side ? z - 0.3 : z + 0.3, key === 'dive' ? 5 : 3.6]);
        const lm = box(lg, [0.3, 0.3, 0.06], '#fff', [x, y, z + (side ? -0.03 : 0.03)], { material: glowMat('#a8f0ff'), cast: false });
      }
    }
    const tm = tileMaterial(field, { lanes: key === 'lap', lamps });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d), tm);
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -P.depth, cz); lg.add(floor);
    const wallH = P.depth + 0.02;
    const wall = (w, ry, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, wallH), tm);
      m.rotation.y = ry; m.position.set(x, -P.depth / 2 + 0.01, z); lg.add(m);
    };
    wall(P.d, Math.PI / 2, P.x0 + 0.01, cz); wall(P.d, -Math.PI / 2, P.x0 + P.w - 0.01, cz);
    wall(P.w, 0, cx, P.z0 + 0.01); wall(P.w, Math.PI, cx, P.z0 + P.d - 0.01);
    root.add(lg); W.hideForRefl.push(lg);
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d), waterMaterial(field, key === 'dive' ? 0.54 : 0.45));
    wm.rotation.x = -Math.PI / 2; wm.position.set(cx, 0, cz); wm.renderOrder = 5;
    wm.userData.pool = key; root.add(wm); W.hideForRefl.push(wm);
    // coping
    const c = '#e2d9c3', t = 0.45;
    box(root, [P.w + 2 * t, 0.36, t], c, [cx, 0.13, P.z0 - t / 2]);
    box(root, [P.w + 2 * t, 0.36, t], c, [cx, 0.13, P.z0 + P.d + t / 2]);
    box(root, [t, 0.36, P.d], c, [P.x0 - t / 2, 0.13, cz]);
    box(root, [t, 0.36, P.d], c, [P.x0 + P.w + t / 2, 0.13, cz]);
    W.pools[key] = { key, P, field, water: wm, cx, cz };
  }
  buildPool('dive'); buildPool('lap');

  // lane ropes
  {
    const P = POOLS.lap, per = Math.floor((P.w - 4) / 0.5), count = per * 4;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: '#ffffff' }), count);
    const m4 = new THREE.Matrix4(), cc = new THREE.Color();
    let n = 0;
    for (let l = 1; l <= 4; l++) for (let i = 0; i < per; i++) {
      m4.makeTranslation(P.x0 + 2.2 + i * 0.5, 0.02, P.z0 + l * 2);
      im.setMatrixAt(n, m4); im.setColorAt(n, cc.set(i < 3 || i >= per - 3 ? '#c9403a' : (Math.floor(i / 5) % 2 ? '#fbf8ef' : '#2a9bd1'))); n++;
    }
    im.castShadow = false; root.add(im);
  }
  // starting blocks & ladders & flags on the lap pool
  for (let l = 0; l < 5; l++) box(root, [0.5, 0.55, 0.7], '#7c746a', [POOLS.lap.x0 - 0.9, D + 0.28, POOLS.lap.z0 + 1 + l * 2]);
  function ladder(x, z, rotY) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; root.add(g);
    for (const s of [-1, 1]) cyl(g, 0.025, 2.9, '#dfe1e8', [0, -0.55, s * 0.28], 6);
    for (let i = 0; i < 6; i++) box(g, [0.04, 0.04, 0.56], '#dfe1e8', [0, -1.7 + i * 0.4, 0]);
  }
  ladder(POOLS.dive.x0 + 0.12, -7.5, 0); ladder(-1.5, POOLS.dive.z0 + POOLS.dive.d - 0.12, Math.PI / 2);

  // ---- diving tower (1930s concrete) ---------------------------------------------------------
  {
    const g = new THREE.Group(); root.add(g);
    const conc = '#a39a8b', dark = '#7c746a', light = '#c9bfac';
    box(g, [4.2, 1.3, 5.0], dark, [2.0, D + 0.65, -14.7]);
    box(g, [2.4, 10.3, 3.6], conc, [2.0, D + 5.15, -14.8]);
    box(g, [2.8, 0.5, 4.0], light, [2.0, 10.55, -14.8]);
    box(g, [1.6, 0.9, 2.4], conc, [2.0, 11.25, -14.8]);
    for (const x of [1.0, 3.0]) box(g, [0.3, 10.2, 0.3], dark, [x, 5.35, -12.9]); // front pilasters
    for (const h of [5, 7.5, 10]) {
      const tip = TOWER.levels[h], len = tip + 13.0, zc = (tip - 13.0) / 2 + 0.0;
      const pz = -13.0 + (tip + 13.0) / 2;
      box(g, [2.6, 0.35, Math.abs(tip + 13.0)], light, [2.0, h - 0.175, pz]);
      box(g, [2.6, 0.12, 0.3], '#c9403a', [2.0, h + 0.06, tip - 0.1]);
      for (const s of [-1, 1]) {
        railing(g, 2.0 + s * 1.25, -13.0, 2.0 + s * 1.25, tip + 0.4 + (h === 10 ? 0.5 : 0), h, '#fbf8ef', 1.0);
        box(g, [0.1, 0.1, Math.abs(tip + 13.0) - 0.4], dark, [2.0 + s * 1.0, h - 0.5, pz - 0.2], { rot: [0.0, 0, 0] });
      }
      const brace = box(g, [0.18, 0.18, 2.8], dark, [2.0, h - 1.2, tip + 1.0 - 0.0], { rot: [-0.7, 0, 0] });
      brace.position.z = -13.0 + (tip + 13.0) * 0.45;
      // height marker
      const lab = h === 7.5 ? '7½' : String(h);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: labelTex(lab + 'm', 40, 20, '#fbf8ef', '#8e2a2d', 13) }));
      sign.position.set(2.0, h - 0.9, -12.98); g.add(sign);
    }
    // landings and bridges
    box(g, [2.6, 0.2, 1.2], light, [4.65, 4.9, -17.1]); // 5 m landing
    box(g, [2.6, 0.2, 1.2], light, [4.65, 7.4, -13.3]); // 7.5 m landing
    box(g, [1.3, 0.2, 1.2], light, [4.1, 9.9, -17.1]); // 10 m landing
    box(g, [1.3, 0.2, 3.5], light, [4.1, 4.9, -15.1]); box(g, [1.3, 0.2, 3.5], light, [3.9, 9.9, -14.9]);
    railing(g, 3.45, -17.7, 3.45, -13.5, 5.0, '#fbf8ef', 0.95); railing(g, 3.45, -17.7, 3.45, -13.5, 10.0, '#fbf8ef', 0.95);
    railing(g, 5.95, -17.7, 5.95, -12.7, 5.0, '#fbf8ef', 0.95); railing(g, 4.8, -17.7, 3.45, -17.7, 10.0, '#fbf8ef', 0.95);
    railing(g, 3.4, -17.7, 5.95, -17.7, 5.0, '#fbf8ef', 0.95);
    stairs(g, TOWER.run1[0], TOWER.run1[1], 1.1, conc);
    stairs(g, TOWER.run2[0], TOWER.run2[1], 1.1, conc);
    stairs(g, TOWER.run3[0], TOWER.run3[1], 1.1, conc);
    for (const x of [3.6, 5.9]) for (const z of [-17.4, -12.8]) box(g, [0.25, 7.4, 0.25], dark, [x, 3.7, z], { cast: true });
    // flag
    const pole = box(g, [0.06, 2.4, 0.06], '#dfe1e8', [2.0, 12.9, -14.8]);
    const flag = box(g, [0.04, 0.5, 1.0], '#c9403a', [2.0, 13.8, -14.3]);
    W.update.push((dt, t) => { flag.rotation.y = Math.sin(t * 3) * 0.18; });
    // floodlights
    W.floodPos = [new THREE.Vector3(1.0, 11.5, -13.4), new THREE.Vector3(3.0, 11.5, -13.4)];
    for (const p of W.floodPos) box(g, [0.5, 0.35, 0.3], '#fff', [p.x, p.y, p.z], { material: glowMat('#fff2c0'), cast: false });
  }

  // ---- springboards --------------------------------------------------------------------------
  for (const key of [3, 1]) {
    const B = BOARDS[key];
    const stand = new THREE.Group(); root.add(stand);
    const topY = B.y - 0.08;
    box(stand, [3.4, topY - D, 2.0], '#a39a8b', [12.9, D + (topY - D) / 2, B.z]);
    box(stand, [3.4, 0.12, 2.1], '#c9bfac', [12.9, topY, B.z]);
    const Lb = 4.8, Lc = 2.7;
    const geo = new THREE.BoxGeometry(Lb, 0.07, 0.5, 40, 1, 1); geo.translate(Lb / 2, 0, 0);
    const boardMesh = new THREE.Mesh(geo, mat(key === 3 ? '#e2d9c3' : '#dfe1e8')); boardMesh.castShadow = true; boardMesh.receiveShadow = true;
    const bg = new THREE.Group(); bg.position.set(B.baseX, B.y - 0.035, B.z); bg.rotation.y = Math.PI; bg.add(boardMesh); root.add(bg);
    box(stand, [0.3, 0.3, 0.7], '#5a544d', [B.fulcrum, B.y - 0.25, B.z]);
    box(stand, [0.6, 0.03, 0.55], '#6d758c', [B.baseX - 0.3, B.y + 0.02, B.z], { cast: false });
    W.boards[key] = new Springboard(boardMesh, Lb, Lc);
    W.boards[key].group = bg;
  }
  stairs(root, new THREE.Vector3(15.9, D, -4.7), new THREE.Vector3(11.9, 3.0, -4.7), 1.1, '#a39a8b');
  box(root, [1.2, 0.2, 1.3], '#c9bfac', [11.9, 2.9, -4.65]);
  for (let i = 0; i < 3; i++) box(root, [0.45, 0.25 + i * 0.25, 1.2], '#a39a8b', [15.4 - i * 0.45, D + (0.25 + i * 0.25) / 2, 2]);

  // ---- changing cabins, clock ------------------------------------------------------------------
  {
    const g = new THREE.Group(); root.add(g);
    const palettes = [['#c9403a', '#fbf8ef'], ['#1a7dba', '#fbf8ef'], ['#f6a63a', '#fbf8ef'], ['#23652f', '#fbf8ef']];
    const cabinW = 2.3, n = 8, x0 = -26.8;
    for (let i = 0; i < n; i++) {
      const [c1, c2] = palettes[i % 4], x = x0 + i * cabinW, z = -21;
      const tex = stripeTex(c1, c2, 8);
      const sideM = new THREE.MeshLambertMaterial({ map: tex });
      const plain = mat('#e2d9c3');
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 2.1), [sideM, sideM, plain, plain, sideM, sideM]);
      mesh.position.set(x, D + 1.25, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
      box(g, [0.85, 1.9, 0.08], '#5f3f2a', [x, D + 0.95, z + 1.07]);
      box(g, [0.1, 0.1, 0.06], '#fbd15a', [x + 0.25, D + 0.95, z + 1.13]);
      // prism ridge along z: build with extrude instead
      const sh = new THREE.Shape(); sh.moveTo(-1.25, 0); sh.lineTo(1.25, 0); sh.lineTo(0, 0.9); sh.closePath();
      const rg = new THREE.ExtrudeGeometry(sh, { depth: 2.5, bevelEnabled: false });
      const rm = new THREE.Mesh(rg, mat(i % 2 ? '#8e2a2d' : '#5a544d')); rm.position.set(x, D + 2.5, z - 1.25); rm.castShadow = true; g.add(rm);
    }
    // clock tower over the middle cabin
    const cx = x0 + 3 * cabinW + cabinW / 2;
    box(g, [1.7, 1.5, 1.7], '#e2d9c3', [cx, D + 4.1, -21]);
    const sh = new THREE.Shape(); sh.moveTo(-1.0, 0); sh.lineTo(1.0, 0); sh.lineTo(0, 1.1); sh.closePath();
    const rm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 2.0, bevelEnabled: false }), mat('#8e2a2d')); rm.position.set(cx, D + 4.85, -22); rm.castShadow = true; g.add(rm);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: '#fbf8ef' }));
    face.position.set(cx, D + 4.1, -21 + 0.86); g.add(face);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; box(g, [0.05, 0.1, 0.02], '#232a42', [cx + Math.sin(a) * 0.5, D + 4.1 + Math.cos(a) * 0.5, -21 + 0.88], { cast: false, rot: [0, 0, -a] }); }
    const hourP = new THREE.Group(), minP = new THREE.Group();
    hourP.position.set(cx, D + 4.1, -21 + 0.9); minP.position.copy(hourP.position); minP.position.z += 0.01; g.add(hourP, minP);
    box(hourP, [0.07, 0.3, 0.02], '#151a2b', [0, 0.15, 0], { cast: false }); box(minP, [0.05, 0.46, 0.02], '#151a2b', [0, 0.23, 0], { cast: false });
    W.update.push(() => { const d = new Date(); hourP.rotation.z = -((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2; minP.rotation.z = -d.getMinutes() / 60 * Math.PI * 2; });
    box(g, [0.06, 1.2, 0.06], '#dfe1e8', [cx, D + 5.9 + 0.3, -21]);
    // bench for the dive team
    box(root, [8.6, 0.12, 0.5], '#80573a', [-5, D + 0.45, -13.95]);
    box(root, [8.6, 0.5, 0.08], '#80573a', [-5, D + 0.8, -14.25]);
    for (const x of [-9, -5, -1]) box(root, [0.1, 0.45, 0.4], '#3b3733', [x, D + 0.22, -13.95]);
  }

  // ---- kiosk -----------------------------------------------------------------------------------
  {
    const g = new THREE.Group(); g.position.set(20, D, -3); root.add(g);
    box(g, [3.2, 2.5, 0.12], '#e2d9c3', [0, 1.25, -1.0]);
    for (const s of [-1, 1]) box(g, [0.12, 2.5, 2.1], '#e2d9c3', [s * 1.54, 1.25, 0]);
    box(g, [3.2, 0.1, 2.1], '#7c746a', [0, 2.55, 0]);
    box(g, [3.3, 1.05, 0.12], '#2a9bd1', [0, 0.52, 1.0]);
    box(g, [3.5, 0.1, 0.7], '#80573a', [0, 1.1, 1.0]);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.9), [mat('#fff'), mat('#fff'), mat('#fff'), mat('#fff'), new THREE.MeshLambertMaterial({ map: stripeTex('#c9403a', '#fbf8ef', 9) }), new THREE.MeshLambertMaterial({ map: stripeTex('#c9403a', '#fbf8ef', 9) })]);
    aw.position.set(0, 2.75, 1.4); aw.rotation.x = 0.35; aw.castShadow = true; g.add(aw);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: labelTex('ICES · COLA', 96, 24, '#fff0a0', '#232a42', 12) }));
    sign.position.set(0, 3.15, -0.95); g.add(sign); sign.rotation.y = 0;
    for (let i = 0; i < 4; i++) box(g, [0.18, 0.4, 0.18], ['#c9403a', '#fbd15a', '#62ad48', '#f3a6a0'][i], [-1.1 + i * 0.35, 1.35, 0.95]);
    box(g, [1.0, 0.1, 1.0], '#a39a8b', [0, 0.05, -0.5], { cast: false });
    const lantern = box(g, [0.2, 0.3, 0.2], '#fff', [1.3, 2.45, 1.2], { material: glowMat('#ffd98a'), cast: false });
    W.lanternPos = new THREE.Vector3(21.3, D + 2.4, -1.8);
  }

  // ---- loungers, parasols --------------------------------------------------------------------
  const lounger = (x, z, yaw, c) => {
    const g = new THREE.Group(); g.position.set(x, D, z); g.rotation.y = yaw; root.add(g);
    box(g, [0.75, 0.08, 1.4], c, [0, 0.36, 0]);
    box(g, [0.75, 0.08, 0.7], c, [0, 0.62, -0.55], { rot: [-0.5, 0, 0] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, [0.06, 0.34, 0.06], '#dfe1e8', [sx * 0.34, 0.17, sz * 0.62]);
  };
  const parasol = (x, z, c1, c2) => {
    const g = new THREE.Group(); g.position.set(x, D, z); root.add(g);
    cyl(g, 0.04, 2.4, '#dfe1e8', [0, 1.2, 0], 6);
    const cone = new THREE.ConeGeometry(1.5, 0.7, 8, 1, true).toNonIndexed();
    const pos = cone.attributes.position, cols = [];
    const a = new THREE.Color(c1), b = new THREE.Color(c2);
    for (let i = 0; i < pos.count; i += 3) {
      const cxp = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, czp = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const seg = Math.floor(((Math.atan2(czp, cxp) + Math.PI) / (Math.PI * 2)) * 8);
      const c = seg % 2 ? a : b; for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(cone, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.position.y = 2.5; m.castShadow = true; g.add(m);
  };
  W.loungers = [];
  const lp = [[-11, 23.3], [-7.5, 23.3], [-4, 23.3], [-0.5, 23.3], [3, 23.3], [15.8, 15], [15.8, 18.5]];
  lp.forEach(([x, z], i) => { lounger(x, z, Math.PI, ['#f6a63a', '#2a9bd1', '#ee6b57', '#fbf8ef'][i % 4]); W.loungers.push(new THREE.Vector3(x, D + 0.42, z)); });
  parasol(-9.2, 24.4, '#c9403a', '#fbf8ef'); parasol(-2.2, 24.4, '#2a9bd1', '#fbf8ef'); parasol(15.2, 16.8, '#f6a63a', '#fbf8ef'); parasol(20.5, 8, '#62ad48', '#fbf8ef');
  // cafe tables near kiosk
  for (const [x, z] of [[17.5, 3.5], [21.5, 4.5]]) { cyl(root, 0.5, 0.05, '#fbf8ef', [x, D + 0.8, z], 10); cyl(root, 0.05, 0.8, '#7c746a', [x, D + 0.4, z], 6); }

  // ---- lifeguard chair, judges' table, shower, tub, lamps -----------------------------------
  {
    const c = SPOTS.guardChair, g = new THREE.Group(); g.position.copy(c); root.add(g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, [0.1, 1.9, 0.1], '#fbf8ef', [sx * 0.5, 0.95, sz * 0.5]);
    box(g, [1.3, 0.1, 1.3], '#fbf8ef', [0, 1.55, 0]); box(g, [1.3, 0.8, 0.1], '#fbf8ef', [0, 1.95, -0.6]);
    for (let i = 0; i < 6; i++) box(g, [0.9, 0.06, 0.2], '#c9403a', [0, 0.3 + i * 0.25, 0.7 - i * 0.08], { cast: false });
    box(g, [1.9, 0.1, 1.9], '#c9403a', [0, 3.0, 0]); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, [0.06, 1.4, 0.06], '#fbf8ef', [sx * 0.85, 2.3, sz * 0.85]);
    box(root, [1.0, 0.08, 6.3], '#80573a', [-9.4, D + 0.82, -3.2]);
    box(root, [1.0, 0.7, 6.3], '#232a42', [-9.4, D + 0.38, -3.2]);
    for (const p of SPOTS.judges) { box(root, [0.5, 0.06, 0.5], '#5f3f2a', [p.x, D + 0.42, p.z]); box(root, [0.08, 0.5, 0.5], '#5f3f2a', [p.x - 0.28, D + 0.65, p.z]); box(root, [0.06, 0.4, 0.06], '#3b3733', [p.x, D + 0.2, p.z]); }
    // shower
    const s = SPOTS.shower; cyl(root, 0.04, 2.5, '#9399ab', [s.x, D + 1.25, s.z - 0.4], 6);
    box(root, [0.1, 0.1, 0.55], '#9399ab', [s.x, D + 2.5, s.z - 0.2]); cyl(root, 0.17, 0.05, '#dfe1e8', [s.x, D + 2.45, s.z + 0.08], 8);
    box(root, [1.4, 0.03, 1.4], '#6d758c', [s.x, D + 0.02, s.z], { cast: false });
    // tub
    const t = SPOTS.tub; cyl(root, 1.7, 0.6, '#80573a', [t.x, D + 0.3, t.z], 18);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.05, 18), new THREE.MeshLambertMaterial({ color: '#3fb5ae', emissive: '#1b8f93', emissiveIntensity: 0.35 }));
    tw.position.set(t.x, D + 0.5, t.z); root.add(tw); W.tubWater = tw;
    cyl(root, 1.85, 0.08, '#c9bfac', [t.x, D + 0.62, t.z], 18, { r2: 1.5 });
    // lamp posts
    W.lamps = [];
    for (const [x, z] of [[-18, 6], [-18, -13], [11.5, -14], [22, 9], [-4, 25.3], [16, 25], [-12, 9.2], [12, -8.5]]) {
      cyl(root, 0.06, 3.2, '#232a42', [x, D + 1.6, z], 6);
      box(root, [0.4, 0.4, 0.4], '#fff', [x, D + 3.35, z], { material: glowMat('#ffd98a'), cast: false });
      W.lamps.push(new THREE.Vector3(x, D + 3.2, z));
    }
  }

  // ---- drifting clouds and floating rocks ---------------------------------------------------
  W.clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const n = 3 + (hash(i, 4) * 3 | 0);
    for (let k = 0; k < n; k++) box(g, [2.5 + hash(i, k) * 3, 1 + hash(k, i) * 0.8, 2 + hash(i, k + 3) * 2], '#fbf8ef', [k * 2.2 - n, hash(k, i + 7) * 0.8, (hash(i + 3, k) - 0.5) * 2], { receive: false });
    const a = i / 9 * Math.PI * 2 + 0.3, r = 48 + hash(i, 2) * 14;
    g.position.set(ISLAND.cx + Math.cos(a) * r, -8 - hash(i, 6) * 26, ISLAND.cz + Math.sin(a) * r * 0.85);
    g.userData.speed = 0.5 + hash(i, 9) * 0.8; g.userData.base = g.position.clone();
    root.add(g); W.clouds.push(g); W.hideForRefl.push(g);
  }
  W.rocks = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + hash(i, 1) * 1.6, 0), new THREE.MeshLambertMaterial({ color: '#6d758c', flatShading: true }));
    const a = i / 5 * Math.PI * 2 + 0.9;
    m.position.set(ISLAND.cx + Math.cos(a) * (40 + hash(i, 3) * 5), -4 - hash(i, 4) * 12, ISLAND.cz + Math.sin(a) * 34);
    m.userData.y0 = m.position.y; m.userData.ph = i; m.castShadow = true; root.add(m); W.rocks.push(m);
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + hash(i, 1) * 1.1, 0), new THREE.MeshLambertMaterial({ color: '#3a8a3a', flatShading: true }));
    cap.position.y = 0.9 + hash(i, 1) * 1.2; cap.scale.y = 0.4; m.add(cap);
  }
  W.update.push((dt, t) => {
    for (const c of W.clouds) { c.position.x += dt * c.userData.speed; if (c.position.x > ISLAND.cx + 70) c.position.x -= 140; }
    for (const r of W.rocks) { r.position.y = r.userData.y0 + Math.sin(t * 0.4 + r.userData.ph) * 0.7; r.rotation.y += dt * 0.05; }
  });

  W.tick = (dt, t) => { for (const f of W.update) f(dt, t); for (const b of Object.values(W.boards)) b.update(dt); };
  return W;
}
