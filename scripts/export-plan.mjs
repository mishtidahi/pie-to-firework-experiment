#!/usr/bin/env node
/**
 * Dry run of the Phase 4 export interface: validates a preset and output
 * options and prints the resulting plan. Renders nothing.
 *
 *   node scripts/export-plan.mjs --preset final --width 1920 --height 1080 --fps 60 --format png,mp4,gif
 *   node scripts/export-plan.mjs --preset-file ~/Downloads/custom.json --fps 30 --json
 *
 * Options
 *   --preset <name>        presets/<name>.json            (exactly one of these two is required)
 *   --preset-file <path>   any preset JSON exported from the workbench
 *   --width/--height <px>  default: 1080-px short side at the preset's aspect ratio
 *   --fps <n>              default 30
 *   --format <list>        png,mp4,gif (default png)
 *   --renderer <r>         swiftshader (default, bit-exact) | gpu
 *   --from/--to <s>        time range, default the whole animation
 *   --out <dir>            default export/<preset>-<w>x<h>-<fps>fps
 *   --json                 print the plan as JSON
 *
 * Exit code 0 = valid plan, 2 = configuration error (message on stderr).
 */
import { ExportConfigError, parseArgs, resolveExportConfig } from './lib/export-config.mjs';

try {
  const opts = parseArgs(process.argv.slice(2));
  const plan = resolveExportConfig(opts);
  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const { preset: p, output: o, timeline: t, page } = plan;
    console.log(`Preset     ${p.name} (${p.source}: ${p.path})`);
    console.log(`           v${p.version}, fingerprint ${p.fingerprint}`);
    console.log(`Output     ${o.width}x${o.height} @ ${o.fps} fps → ${o.formats.join(', ')}  [renderer: ${o.renderer}]`);
    console.log(`           ${o.outDir}`);
    console.log(`Frames     ${t.frameCount} (t = ${t.firstFrameTime.toFixed(4)} … ${t.lastFrameTime.toFixed(4)} s of ${t.duration} s)`);
    console.log(`Player URL ${page.url.length > 140 ? `${page.url.slice(0, 137)}...` : page.url}`);
  }
} catch (e) {
  if (e instanceof ExportConfigError) {
    console.error(`export config error: ${e.message}`);
    for (const d of e.details) console.error(`  - ${d}`);
    process.exit(2);
  }
  throw e;
}
