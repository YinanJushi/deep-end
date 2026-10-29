import * as THREE from 'three';
import { DECK_Y } from './shared.js';

// All coordinates in metres. y = 0 is the water surface, the deck sits at DECK_Y.
export const POOLS = {
  dive: { x0: -6, z0: -10, w: 16, d: 16, depth: 5.0 },
  lap: { x0: -14, z0: 11, w: 25, d: 10, depth: 1.8 },
};

export const ISLAND = { cx: -2, cz: 0.5, a: 32, b: 27.5 };

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const D = DECK_Y;

export const TOWER = {
  x: 2.0,
  // platform heights and the z of each platform tip (higher platforms reach further out)
  levels: { 5: -9.4, 7.5: -9.0, 10: -8.6 },
  dir: v(0, 0, 1),
  // stair waypoints (bottom -> top of each run)
  run1: [v(4.1, D, -10.8), v(4.1, 5.0, -16.6)],
  run2: [v(5.35, 5.0, -16.6), v(5.35, 7.5, -13.8)],
  run3: [v(4.1, 7.5, -13.0), v(4.1, 10.0, -16.6)],
};

export const BOARDS = {
  3: { x: 8.5, y: 3.0, z: -3, baseX: 13.3, fulcrum: 11.2, dir: v(-1, 0, 0) },
  1: { x: 8.5, y: 1.0, z: 2, baseX: 13.3, fulcrum: 11.2, dir: v(-1, 0, 0) },
};

/** Walk path (deck -> take-off point) for each dive height. */
export function pathTo(height) {
  const T = TOWER;
  if (height === 3) {
    return [v(15.9, D, -6), v(15.9, D, -4.7), v(11.9, 3.0, -4.7), v(11.9, 3.0, -3), v(BOARDS[3].fulcrum + 0.6, 3.0, -3)];
  }
  if (height === 1) {
    return [v(15.6, D, 4), v(14.9, D, 2), v(14.0, 1.0, 2), v(BOARDS[1].fulcrum + 0.6, 1.0, 2)];
  }
  const pts = [v(3.0, D, -11.3), v(T.run1[0].x, D, T.run1[0].z + 0.2), v(T.run1[1].x, 5.0, T.run1[1].z)];
  if (height === 5) {
    pts.push(v(4.1, 5.0, -14.2), v(2.0, 5.0, -13.2), v(2.0, 5.0, T.levels[5] - 0.35));
    return pts;
  }
  pts.push(v(5.35, 5.0, -16.6), v(5.35, 7.5, -13.8));
  if (height === 7.5) {
    pts.push(v(3.5, 7.5, -13.0), v(2.0, 7.5, -12.8), v(2.0, 7.5, T.levels[7.5] - 0.35));
    return pts;
  }
  pts.push(v(4.1, 7.5, -13.1), v(4.1, 10.0, -16.6), v(3.9, 10.0, -14.2), v(2.0, 10.0, -13.0), v(2.0, 10.0, T.levels[10] - 0.35));
  return pts;
}

export function takeoffPoint(height) {
  const p = pathTo(height);
  return p[p.length - 1].clone();
}

export const SPOTS = {
  ladderW: { deck: v(-7.0, D, -7.5), water: v(-5.5, 0, -7.5), rail: v(-5.88, 0, -7.5), face: -Math.PI / 2 },
  ladderS: { deck: v(-1.5, D, 7.0), water: v(-1.5, 0, 5.5), rail: v(-1.5, 0, 5.88), face: 0 },
  shower: v(-9.2, D, -8.6),
  tub: v(-17, D, -6),
  benches: [v(-8.5, D, -13.85), v(-6.8, D, -13.85), v(-5.1, D, -13.85), v(-3.4, D, -13.85), v(-1.7, D, -13.85)],
  guardChair: v(12.4, D, 8.6),
  kiosk: v(21, D, 0),
  judges: [-5.6, -4.4, -3.2, -2.0, -0.8].map((z) => v(-10.7, D, z)),
};

export const CHILD_NODES = [
  v(-16, D, 9), v(-16, D, 23), v(-4, D, 24.2), v(13.5, D, 24), v(14.5, D, 12), v(14, D, 8), v(2, D, 8.6), v(-9, D, 8.6),
  v(20, D, 14), v(20, D, 5), v(-20, D, 14), v(-20, D, 22),
];
