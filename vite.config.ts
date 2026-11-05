import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { PRESET_NAME_PATTERN, PROTECTED_PRESETS, serializePreset, validatePreset } from './src/config/preset.ts';

const PRESET_DIR = resolve(__dirname, 'presets');
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Dev-server-only endpoint behind the workbench's "Save to project" button:
 * POST /__presets/save  { preset, overwrite? }  →  writes presets/<name>.json.
 * Validated with the same rules as every other preset consumer; refuses
 * protected names and silently never overwrites (needs `overwrite: true`).
 * Not present in production builds.
 */
function presetSaveEndpoint(): Plugin {
  return {
    name: 'pie-firework-preset-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__presets/save', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { errors: ['POST only.'] });
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          let body: { preset?: unknown; overwrite?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return reply(400, { errors: ['Request body is not JSON.'] });
          }
          const v = validatePreset(body.preset);
          if (!v.ok) return reply(422, { errors: v.errors });
          const { name } = v.preset;
          if (!PRESET_NAME_PATTERN.test(name)) return reply(422, { errors: [`Invalid preset name "${name}".`] });
          if ((PROTECTED_PRESETS as readonly string[]).includes(name)) {
            return reply(403, { errors: [`presets/${name}.json is protected. Save under another name.`] });
          }
          const file = resolve(PRESET_DIR, `${name}.json`);
          if (existsSync(file) && body.overwrite !== true) {
            return reply(409, { errors: [`presets/${name}.json already exists. Tick "overwrite existing" to replace it.`] });
          }
          writeFileSync(file, serializePreset(v.preset));
          reply(200, { ok: true, file: `presets/${name}.json` });
        });
      });
    },
  };
}

// `base: './'` keeps the production build relocatable so `dist/` can be
// dropped into any static host or sub-path as a standalone animation.
export default defineConfig({
  base: './',
  plugins: [react(), presetSaveEndpoint()],
  server: { port: 5173, strictPort: false },
});
