# Pie → Firework

An ~8 s animation: a precise 2D pie chart turns into a spinning ground-spinner firework and ends on solid `#ffde59`.
Built with Vite, React, TypeScript, React Three Fiber and GSAP.

## Run

```bash
npm install
npm run dev          # http://localhost:5173        → debug workbench
                     # http://localhost:5173/?debug=0 → standalone player (add &loop=1 to loop)
npm run build        # static, relocatable site in dist/
npm run typecheck
node scripts/compare-reference.mjs --t 1.6  # pixel-diff a frame against the reference (dev server must be running)
node scripts/verify-motion.mjs              # continuity, seek determinism, 1x playback + screencast → captures/phase2/
node scripts/verify-phase3.mjs              # Phase 3 report, recordings, strips → captures/phase3/
python scripts/assemble-captures.py         # builds WebP/GIF/contact sheets from those frames (Python + Pillow)
```

## Architecture

| Path | Role |
| --- | --- |
| `src/geometry/pieGeometry.ts` | Single source of truth for the pie, measured from `references/piechart-for-diwali-gif.png`. Sector angles use "clock angles" (0° = 3 o'clock, increasing clockwise). Also generates exact SVG paths. |
| `src/scene/pieShader.ts`, `PieDisc.tsx` | Analytic per-pixel renderer for the same inset-wedge geometry. Edges are vector-exact at any resolution or 3D tilt. |
| `src/scene/StageCanvas.tsx` | R3F canvas. Uses `legacy linear flat` so palette hex values render unchanged. The frame height is always 2 world units at z = 0. |
| `src/phases/*` | One module per animation phase, all sharing one contract (`types.ts`). |
| `src/motion/MotionTrack.ts` | A C¹ sweep-angle curve that phases append segments to. 0→360° drives the wipe mask; beyond 360° it drives pie rotation, so the wipe's momentum carries into the overshoot. |
| `src/timeline/buildMasterTimeline.ts` | Lays the phases out on one paused, seekable GSAP timeline, with labels and per-phase progress values. |
| `src/timeline/engine.ts` | Playback (play, pause, seek, frame step, speed, loop, phase jump) and param-driven rebuilds. Exposed as `window.__pieFirework`. |
| `src/geometry/projection.ts` | Camera, tilt and corner-coverage maths (ray–plane), shared by the zoom phase and the renderer. |
| `src/effects/*` | Palette-derived colours, deterministic vibration noise, and seeded spark/streak attribute fields. |
| `src/scene/FireworkRig.tsx`, `Sparks.tsx`, `OrbitStreaks.tsx` | Vibration/tilt/expansion rig plus instanced particles. Positions are closed-form in timeline time, computed in the vertex shader. |
| `src/config/params.ts` | Parameter schema that generates the debug panel. |
| `src/lib/random.ts` | Seeded PRNG and a stateless hash for deterministic particles. |
| `src/debug/*` | Transport, scrubber, phase list, parameter panel, reference/SVG inspection overlays. |

**Rendering determinism:** on SwiftShader (software WebGL) any frame is bit-identical however it is reached. Hardware GPUs add a few pixels of rasterisation noise at the disc rim, so bit-exact export should use SwiftShader.

**Determinism rules:** every visual value is a pure function of timeline time. Phases use explicit `fromTo` values, nothing is integrated frame by frame, and all randomness is seeded. Export can therefore seek to `frame / fps` and get an identical frame every time.

## Build status

- [x] **Phase 1:** project setup, reconstructed geometry, master timeline, debug interface
- [x] **Phase 2:** radial wipe, overshoot, recoil, rev and spin acceleration
- [x] **Phase 3:** analytic motion blur, colour transformation, ground-spinner firework, 3D expansion, exact final yellow
- [ ] Phase 4: deterministic PNG export, then MP4/GIF via FFmpeg
