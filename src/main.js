import * as THREE from 'three';
import { Pipeline } from './pipeline.js';
import { buildWorld } from './world.js';
import { Env } from './env.js';
import { FX } from './fx.js';
import { Actors } from './actors.js';
import { U } from './shared.js';
import { ISLAND } from './layout.js';

const canvas = document.getElementById('view');
const fatal = document.getElementById('fatal');
function die(e) { console.error(e); fatal.style.display = 'grid'; fatal.textContent = 'Deep End could not start:\n' + (e && e.message || e); }
window.addEventListener('error', (e) => die(e.error || e.message));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { die(e); throw e; }
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.autoClear = true;

const scene = new THREE.Scene();
const pipeline = new Pipeline(renderer);
const world = buildWorld(scene);
const env = new Env(scene, world, pipeline);
const fx = new FX(scene, world);
const actors = new Actors({ scene, world, fx, env });

// ---- camera ---------------------------------------------------------------------------------
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.5, 320);
const view = {
  az: Math.PI / 4, azTarget: Math.PI / 4, el: THREE.MathUtils.degToRad(30),
  zoom: 14, target: new THREE.Vector3(ISLAND.cx + 4, 1.5, ISLAND.cz - 3), px: 3, raw: false,
};
const q = new URLSearchParams(location.search);
if (q.has('px')) view.px = +q.get('px');
const $ = (id) => document.getElementById(id);

function layout() {
  const stage = $('stage');
  const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.cssW = w; view.cssH = h; view.dpr = dpr;
  pipeline.setSize(w, h, view.px, dpr, view.raw);
  pipeline.setCamera(camera);
}
function fitZoom() {
  const stage = $('stage');
  view.zoom = Math.max(6, Math.min(60, Math.min(stage.clientWidth / 46, stage.clientHeight / 36)));
  $('zoom').value = view.zoom; $('zoomV').textContent = view.zoom.toFixed(0);
}
function updateCamera(dt) {
  const d = THREE.MathUtils.euclideanModulo(view.azTarget - view.az + Math.PI, Math.PI * 2) - Math.PI;
  view.az += d * Math.min(1, dt * 7);
  const { az, el } = view;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  camera.position.copy(view.target).addScaledVector(dir, 150);
  camera.lookAt(view.target);
  const wCss = pipeline.raw ? pipeline.w / view.dpr : pipeline.w * pipeline.px;
  const hCss = pipeline.raw ? pipeline.h / view.dpr : pipeline.h * pipeline.px;
  const hw = wCss / view.zoom / 2, hh = hCss / view.zoom / 2;
  camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  U.uView.value.copy(dir);
}

// ---- input ------------------------------------------------------------------------------------
let drag = null;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
  if (drag.moved) {
    const right = new THREE.Vector3(Math.cos(view.az), 0, -Math.sin(view.az));
    const fwd = new THREE.Vector3(-Math.sin(view.az), 0, -Math.cos(view.az));
    view.target.addScaledVector(right, -dx / view.zoom).addScaledVector(fwd, dy / (view.zoom * Math.sin(view.el)));
  }
  drag.x = e.clientX; drag.y = e.clientY;
});
const ray = new THREE.Raycaster();
canvas.addEventListener('pointerup', (e) => {
  const was = drag; drag = null;
  if (!was || was.moved) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(Object.values(world.pools).map((p) => p.water), false);
  if (hits.length) {
    const p = hits[0].point;
    fx.ripple(p.x, p.z, 0.55, -0.2); fx.ripple(p.x, p.z, 1.3, 0.08);
    fx.smallSplash(p.x, 0.05, p.z, 18, 1.6);
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.max(6, Math.min(60, view.zoom * Math.exp(-e.deltaY * 0.0012)));
  $('zoom').value = view.zoom; $('zoomV').textContent = view.zoom.toFixed(0);
}, { passive: false });
const turn = (k) => { view.azTarget += k * Math.PI / 2; };
window.addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') turn(-1);
  if (e.key === 'e' || e.key === 'E') turn(1);
  if (e.key === '+' || e.key === '=') { view.zoom = Math.min(60, view.zoom * 1.1); $('zoom').value = view.zoom; }
  if (e.key === '-') { view.zoom = Math.max(6, view.zoom / 1.1); $('zoom').value = view.zoom; }
});
$('rotL').onclick = () => turn(-1); $('rotR').onclick = () => turn(1);
$('zoom').oninput = (e) => { view.zoom = +e.target.value; $('zoomV').textContent = view.zoom.toFixed(0); };
$('px').value = view.px; $('pxV').textContent = view.px + 'px';
$('px').oninput = (e) => { view.px = +e.target.value; $('pxV').textContent = view.px + 'px'; layout(); };
$('raw').onclick = (e) => { view.raw = !view.raw; e.target.setAttribute('aria-pressed', view.raw); e.target.textContent = view.raw ? 'On' : 'Off'; layout(); };
function group(attr, fn) {
  const btns = [...document.querySelectorAll(`[data-${attr}]`)];
  btns.forEach((b) => b.addEventListener('click', () => { btns.forEach((o) => o.setAttribute('aria-pressed', o === b)); fn(b.dataset[attr]); }));
}
group('tod', (v) => env.set(v));
group('weather', (v) => env.setWeather(v));
group('event', (v) => actors.setEvent(v));
window.addEventListener('resize', layout);
new ResizeObserver(layout).observe($('stage'));

// ---- loop -------------------------------------------------------------------------------------
let last = performance.now(), time = 0;
function tick(dt) {
  time += dt;
  U.uTime.value = time;
  updateCamera(dt);
  actors.update(dt, time);
  world.tick(dt, time);
  env.update(dt);
  for (const k in world.pools) world.pools[k].field.step(dt);
  scene.updateMatrixWorld(true);
  actors.afterPose(dt);
  fx.update(dt, env, camera);
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * (window.__ts ?? 1); last = now;
  try {
    tick(dt);
    pipeline.render(scene, camera, world.hideForRefl);
  } catch (e) { die(e); return; }
  requestAnimationFrame(frame);
}
layout(); fitZoom(); layout();
// debug helpers: advance the simulation without rendering, or render once on demand
const dbg = {
  scene, world, actors, env, fx, view, pipeline, camera, THREE,
  advance(sec, step = 1 / 30) { for (let t = 0; t < sec; t += step) tick(step); },
  draw() { pipeline.render(scene, camera, world.hideForRefl); },
};
window.__deepEnd = dbg;
requestAnimationFrame(frame);
