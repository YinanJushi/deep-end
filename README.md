# Deep End

An open-air lido on a floating island, drawn as real-time 3D pixel art (three.js, orthographic isometric camera → low-res target → 64-colour OKLab palette snap, depth-buffer outlines).

## Run

No build step. Serve the folder over HTTP and open it:

```bash
python3 -m http.server 5188
```

then visit http://localhost:5188. three.js is vendored in `vendor/`.

## Controls

- Click the water to splash; drag to pan; wheel or `+`/`-` to zoom; `Q`/`E` quarter-turn the view.
- Side panel: event (10 m, 3 m, free swim), light (day/dusk/night), weather (dry/rain), pixel size, Raw 3D.

## Layout

| File | What it does |
| --- | --- |
| `src/pipeline.js`, `src/palette.js` | low-res render target, depth outlines, OKLab palette snap, planar water reflection |
| `src/water.js` | wave-equation height fields, water and tiled-floor shaders (caustics) |
| `src/world.js`, `src/layout.js` | island, pools, tower, boards, cabins, kiosk, props |
| `src/figure.js`, `src/motion.js` | box-rig figures with two-bone IK, walking, strokes, flip turns |
| `src/dive.js` | take-off solver, angular-momentum flight, springboard bending, scoring |
| `src/actors.js`, `src/meet.js` | swimmers, divers, children, lifeguard, judges, meet director and scoreboard |
| `src/env.js`, `src/fx.js` | time of day, weather, splashes, rain, steam, wet footprints |

Debug hook: `window.__deepEnd.advance(seconds)` steps the simulation without rendering; `window.__deepEnd.draw()` renders one frame.
