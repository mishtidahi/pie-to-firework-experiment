# Pie → Firework

An ~8 s animation: a precise 2D pie chart turns into a cel-shaded 3D ground-spinner firecracker and ends on solid `#ffde59`.
Built with Vite, React, TypeScript, React Three Fiber and GSAP.

## Look (cel-shaded revision)

- **Pie → spinner (4.0–4.8 s):** the spinning pie's smear is posterised into hard, overlapping tones, and the sectors morph without a seam into concentric bands with the same proportions. The orange arc widens symmetrically and closes into the outer ring (a C becoming an O), and each blue gap curls round into a coil groove. The morph is front-loaded, so the rotating asymmetric detail lasts about 4 frames at 30 fps. The gaps close into grooves, the colours resolve to orange, and the body grows its thickness and real bevel.
- **Spinner (4.8–6.2 s):** a 3D body with a top face, a real 45° chamfer at the top and bottom edges, a side wall and a hub, cel-shaded by one key light in hard bands relative to the top plane. The top chamfer always sits a tone between the gold top and the orange wall; the bottom chamfer is a dark contact edge. A gentle ignition tilt shows the thickness early. Speed comes from hard accent arcs on the chamfer, sweeping side-wall stripes, vibration and the sparks.
- **Spark sequence (`src/effects/emission.ts`):** the disc completes its move to gold by 5.1 s; only then does the nozzle ignite.
  - *Ignition (5.1–5.45 s):* one white-hot source on the rim, riding the body's visible rotation (the chamfer accent arcs, 2 rev/s apparent). Short golden sparks jet backwards along the tangent from a narrow rim region, with varied length, angle and speed and a few escaping far beyond the rest, tracing an uneven, comet-like arm rather than a halo.
  - *Expansion (5.45–6.2 s):* the emitting region widens to nearly the whole rim, the rate climbs, and speed, life and trail grow, so the arm sweeps round into a nearly circular fan of strokes several body radii long, with small incandescent pellets splitting off.
  - *Stroke style:* the sparks are drawn in the spinner's cel language, not as photographic light trails. Each is a bold graphic stroke as thick as the face's inner groove rings (`sparkWidth`, ≈ 4.5–5 px at 1080p), with a rounded, pointed nose, a full belly and a tapering tail, posterised in flat bands across its width (hot core, gold body, thin orange edge) that cool in hard steps with age (white-hot at the source, gold, amber and orange far out). Trajectories bend and sway gently rather than jitter, and there are fewer, heavier strokes, so the spinner stays the primary object. The orbiting streaks at the rim use the same stroke.
  - *Into the tilt (6.2 s →):* the full shower carries into the tilt, then thins (emission declines and trails drain away) and is gone before the frame fills. Each spark keeps the orientation the body had at its birth, so sparks in flight hold their course while the body tilts on; new ones leave the tilted rim.
- **Tilt and zoom (6.2–7.6 s):** the body tilts and rushes toward camera; the side wall and bevel foreshorten in perspective, and sparks behind the body are hidden by depth. Shading flattens to exact `#ffde59` as the solved expansion covers every corner.
- No soft glow, comet streaks or spiral overlays. The original flat look is git tag `phase3-complete`.

## Run

```bash
npm install
npm run dev          # http://localhost:5173            → debug workbench
                     # http://localhost:5173/?debug=0    → standalone player (add &loop=1 to loop)
npm run build        # static, relocatable site in dist/
npm run typecheck
npm test             # unit tests: preset format, validation, export configuration (Node built-in runner)
npm run export:plan -- --preset final --fps 60   # dry run of the Phase 4 export interface (renders nothing)
```

Browser verification (dev server must be running):

```bash
node scripts/compare-reference.mjs --t 1.6  # pixel-diff a frame against the reference
node scripts/verify-motion.mjs              # Phase 2: continuity, seek determinism, 1× playback → captures/phase2/
node scripts/verify-phase3.mjs              # Phase 3: report, recordings, strips → captures/phase3/
node scripts/verify-presets.mjs [--baseline-url <url>]  # presets: cross-mode, reload, import/export, errors
python scripts/assemble-captures.py         # builds WebP/GIF/contact sheets from Phase 3 frames (Python + Pillow)
node scripts/capture-closeups.mjs --out <dir> # deterministic transition + rim close-ups (SwiftShader)
python scripts/compare-closeups.py <a> <b> <out>  # side-by-side sheets of two close-up captures
node scripts/capture-sparks.mjs --out <dir>   # spark stages: ignition, spread, peak, tilt (progression + 30/60 fps runs)
python scripts/compare-sparks.py <a> <b> <out>    # side-by-side sheets of two spark captures
python scripts/stroke-width.py <dir> [<dir>]      # spark stroke thickness measured from spark captures
python scripts/seam-metric.py <dir> [<dir>]  # radial-seam score and frame-to-frame churn of the transition
```

## Presets

A preset is a versioned JSON file holding **every parameter that affects the rendered animation**, and nothing else:

```json
{
  "format": "pie-firework-preset",
  "version": 3,
  "name": "final",
  "description": "optional",
  "params": { "durIntro": 0.4, "...": "all 57 animation parameters" }
}
```

- `presets/default.json`: the default (cel-shaded) animation. Protected from overwriting by the save endpoint; a unit test keeps it equal to the schema defaults.
- `presets/final.json`: the slot for the approved final animation. Currently identical to `default`.
- Validation is strict: every animation parameter must be present, in range and of the right type. Unknown keys and output settings are rejected, and every problem is reported. Presets from a newer version are refused; older ones go through `migrate()` in `src/config/preset.ts`, one version at a time.
  - **v1 → v2** (cel revision) adds the 8 body/shading parameters at their defaults. A v1 preset keeps its timing, motion, colours and particles but renders in the new style.
  - **v2 → v3** (spark emission) adds the 8 new emission and stroke controls at their defaults. `sparkCount` (total sparks) becomes `showerDensity` (sparks/s at peak); it is converted proportionally, as are `sparkSpeed` and `sparkLife`, so old defaults land exactly on the new defaults and tuned values keep their ratio. Everything else, including `goldAt`, is kept: ignition still begins when that preset's disc turns gold.
- **Fingerprint:** a 14-hex-digit hash of the animation parameters. It is identical in the browser and in Node, and shown in the workbench.

### Selecting the configuration: the URL is the single source of truth

| URL | Configuration |
| --- | --- |
| `/` or `/?debug=0` | `presets/default.json` |
| `?preset=final` | `presets/final.json` (bundled from the repository at build time) |
| `#preset=<base64url>` | inline preset (imports, share links, export of arbitrary preset files) |
| `&fp=<fingerprint>` | pin: refuse to run unless the resolved configuration has this fingerprint |
| `&autoplay=0` | player starts paused (used by export and tests) |

The workbench and the player resolve the URL with the same code (`src/config/presetRegistry.ts`), so **the same URL renders the same animation in both modes**. A requested preset that is missing, invalid, ambiguous (`?preset` and `#preset` together) or fails its `fp` pin shows an error screen. It never falls back to the default. The player never reads localStorage.

### Workflow (workbench → Preset panel)

- **Edit:** change parameters as before. The panel shows **modified** and the new fingerprint. Unsaved edits are kept as a localStorage *draft*. After a reload the workbench offers **Restore / Discard** but never applies a draft by itself.
- **Save:** *Save to project* (dev server only) writes `presets/<name>.json`. It refuses `default` and needs *overwrite existing* to replace a file. To store the approved animation, save as `final`.
- **Load:** pick a repository preset and click *Load*, which navigates to `?preset=<name>`. *Revert* discards edits.
- **Share:** *Export JSON* downloads `<name>.json`. *Import JSON…* validates a file and opens it as `#preset=…`, so it survives reloads and works in a fresh browser. *Open in player* and *Copy player link* reproduce the current configuration, edits included, in the standalone player.

`exportFps` (shown as "Frame-step FPS") is a workbench output setting, so it is not part of presets.

## Export interface (Phase 4)

Animation parameters come **only** from the preset. Output options come **only** from the command line. `scripts/lib/export-config.mjs` validates both and produces the plan Phase 4 will execute. `npm run export:plan` prints that plan today without rendering anything:

```bash
node scripts/export.mjs --preset final --width 1920 --height 1080 --fps 60 --format png,mp4,gif   # Phase 4 (planned)
node scripts/export-plan.mjs --preset final --width 1920 --height 1080 --fps 60 --format png,mp4,gif  # available now
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--preset <name>` / `--preset-file <path>` | exactly one is **required**; no implicit default | none |
| `--width`, `--height` | pixels; must match the preset's aspect ratio (aspect is part of the animation) | 1080-px short side |
| `--fps` | whole number 1–120; frame *i* is rendered at *t = from + i / fps* | 30 |
| `--format` | comma list of `png`, `mp4`, `gif` (MP4 needs even dimensions) | `png` |
| `--renderer` | `swiftshader` (software, bit-exact) or `gpu` | `swiftshader` |
| `--from`, `--to` | time range in seconds | whole animation |
| `--out` | output directory | `export/<preset>-<w>x<h>-<fps>fps` |

The plan contains the exact player URL to load, e.g. `/?debug=0&autoplay=0&preset=final&fp=0a699f1819fb39`. Because of the `fp` pin, the exporter renders through the **same standalone player and the same configuration a viewer sees**, and the page refuses to run if the bundled preset differs from the file on disk. Preset files from `--preset-file` are passed inline (`#preset=`). Errors (unknown or invalid preset, bad output options, aspect mismatch) print an explanation and exit with code 2.

## Architecture

| Path | Role |
| --- | --- |
| `src/geometry/pieGeometry.ts` | Single source of truth for the pie, measured from `references/piechart-for-diwali-gif.png`. Sector angles use "clock angles" (0° = 3 o'clock, increasing clockwise). Also generates exact SVG paths. |
| `src/scene/pieShader.ts` | Top face: the analytic pie (vector-exact, bit-identical to Phases 1–2), the posterised smear, the seam-free sector → coil-band morph (single arcs per radius, so the exact smear still applies), and the cel-shaded spinner top (dome, grooves, hub, hard specular). |
| `src/scene/sideShader.ts`, `celShading.ts` | Body side: a top chamfer carrying the spin accents and heat flashes, the wall, and a bottom chamfer; plus the shared cel helpers (antialiased hard steps, palette tone ramp, perimeter wobble). |
| `src/scene/SpinnerBody.tsx` | Spinning group with the top face and side wall; derives every uniform from the anim state. |
| `src/effects/emission.ts` | The spark sequence as pure functions: ignition/shower/fade times, emission rate, emitting rim region, nozzle angle. Shared by the phases, the particle fields and the body shaders. |
| `src/scene/Sparks.tsx`, `SparkSource.tsx` | Sparks: graphic cel strokes built in screen space, each the recent part of its own closed-form trajectory (drag, curvature, sway, lift, gravity), in the body orientation at birth. The hot nozzle on the rim. |
| `src/timeline/rigTrack.ts` | Body tilt and vibration sampled from the built timeline, so each spark knows the body orientation at its birth. |
| `src/scene/StageCanvas.tsx` | R3F canvas. Uses `legacy linear flat` so palette hex values render unchanged. The frame height is always 2 world units at z = 0. |
| `src/phases/*` | One module per animation phase, all sharing one contract (`types.ts`). |
| `src/motion/MotionTrack.ts` | A C¹ sweep-angle curve that phases append segments to. 0→360° drives the wipe mask; beyond 360° it drives pie rotation, so the wipe's momentum carries into the overshoot. |
| `src/timeline/buildMasterTimeline.ts` | Lays the phases out on one paused, seekable GSAP timeline, with labels and per-phase progress values. |
| `src/timeline/engine.ts` | Playback (play, pause, seek, frame step, speed, loop, phase jump) and param-driven rebuilds. Exposed as `window.__pieFirework`. |
| `src/geometry/projection.ts` | Camera, tilt and corner-coverage maths (ray–plane), shared by the zoom phase and the renderer. |
| `src/effects/*` | Palette-derived colours, deterministic vibration noise, and seeded spark/streak attribute fields. |
| `src/scene/FireworkRig.tsx`, `OrbitStreaks.tsx` | Rig: shake and expansion (applied to everything) around the tilted body group; sparks sit outside the tilt. Orbiting streaks swirl at the emitting rim. All particles are instanced, depth-tested and closed-form in timeline time. |
| `src/config/params.ts` | Parameter schema (drives the debug panel). `scope` separates animation from output parameters. |
| `src/config/preset.ts` | Preset format, strict validation, canonical serialisation, fingerprint, URL encoding. No DOM dependencies, so Node imports it directly. |
| `src/config/presetRegistry.ts` | Bundles `presets/*.json` and resolves the active configuration from the URL. |
| `src/debug/PresetPanel.tsx`, `drafts.ts` | Preset UI and opt-in workbench drafts. |
| `scripts/lib/export-config.mjs` | Phase 4 configuration: preset loading, output validation, frame schedule, player URL. |
| `src/lib/random.ts` | Seeded PRNG and a stateless hash for deterministic particles. |
| `src/debug/*` | Transport, scrubber, phase list, parameter panel, reference/SVG inspection overlays. |

**Rendering determinism:** on SwiftShader (software WebGL) any frame is bit-identical however it is reached. Hardware GPUs add a few pixels of rasterisation noise at the disc rim, so bit-exact export should use SwiftShader.

**Determinism rules:** every visual value is a pure function of timeline time. Phases use explicit `fromTo` values, nothing is integrated frame by frame, and all randomness is seeded. Export can therefore seek to `frame / fps` and get an identical frame every time.

## Build status

- [x] **Phase 1:** project setup, reconstructed geometry, master timeline, debug interface
- [x] **Phase 2:** radial wipe, overshoot, recoil, rev and spin acceleration
- [x] **Phase 3:** analytic motion blur, colour transformation, ground-spinner firework, 3D expansion, exact final yellow (tag `phase3-complete`)
- [x] **Phase 4 preparation:** reproducible presets, a single source of truth for configuration, and the export configuration interface
- [x] **Cel-shaded 3D revision:** spinner body with thickness, bevel and side wall; hard-banded lighting; pie → coil-band morph; 3D particles (preset format v2)
- [x] **Spark emission revision:** gold first, then nozzle ignition → expanding shower → tilt → fade; graphic cel strokes (preset format v3)
- [ ] Phase 4: deterministic PNG export, then MP4/GIF via FFmpeg
