# Pie → Firework

An ~8 s animation: a precise 2D pie chart turns into a spinning ground-spinner firework and ends on solid `#ffde59`.
Built with Vite, React, TypeScript, React Three Fiber and GSAP.

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
```

## Presets

A preset is a versioned JSON file holding **every parameter that affects the rendered animation**, and nothing else:

```json
{
  "format": "pie-firework-preset",
  "version": 1,
  "name": "final",
  "description": "optional",
  "params": { "durIntro": 0.4, "...": "all 41 animation parameters" }
}
```

- `presets/default.json`: the original Phase 3 animation (tag `phase3-complete`). Protected from overwriting by the save endpoint; a unit test keeps it equal to the schema defaults.
- `presets/final.json`: the slot for the approved final animation. Currently identical to `default`.
- Validation is strict: every animation parameter must be present, in range and of the right type. Unknown keys and output settings are rejected, and every problem is reported. Presets from a newer version are refused; older ones go through `migrate()` in `src/config/preset.ts`.
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
| `src/scene/pieShader.ts`, `PieDisc.tsx` | Analytic per-pixel renderer for the same inset-wedge geometry. Edges are vector-exact at any resolution or 3D tilt. |
| `src/scene/StageCanvas.tsx` | R3F canvas. Uses `legacy linear flat` so palette hex values render unchanged. The frame height is always 2 world units at z = 0. |
| `src/phases/*` | One module per animation phase, all sharing one contract (`types.ts`). |
| `src/motion/MotionTrack.ts` | A C¹ sweep-angle curve that phases append segments to. 0→360° drives the wipe mask; beyond 360° it drives pie rotation, so the wipe's momentum carries into the overshoot. |
| `src/timeline/buildMasterTimeline.ts` | Lays the phases out on one paused, seekable GSAP timeline, with labels and per-phase progress values. |
| `src/timeline/engine.ts` | Playback (play, pause, seek, frame step, speed, loop, phase jump) and param-driven rebuilds. Exposed as `window.__pieFirework`. |
| `src/geometry/projection.ts` | Camera, tilt and corner-coverage maths (ray–plane), shared by the zoom phase and the renderer. |
| `src/effects/*` | Palette-derived colours, deterministic vibration noise, and seeded spark/streak attribute fields. |
| `src/scene/FireworkRig.tsx`, `Sparks.tsx`, `OrbitStreaks.tsx` | Vibration/tilt/expansion rig plus instanced particles. Positions are closed-form in timeline time, computed in the vertex shader. |
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
- [ ] Phase 4: deterministic PNG export, then MP4/GIF via FFmpeg
