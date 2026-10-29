import * as THREE from 'three';

// Uniform objects shared by every custom shader. Mutated each frame by env.js / pipeline.js.
export const U = {
  uRefl: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.35, 0.8, 0.5).normalize() },
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uAmb: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uNight: { value: 0 },
  uView: { value: new THREE.Vector3(0, 1, 0) },
  uWaterCol: { value: new THREE.Color('#2fb4d8') },
  uSkyCol: { value: new THREE.Color('#bfe4ff') },
  uRain: { value: 0 },
};

export const WATER_Y = 0;
export const DECK_Y = 0.25;
