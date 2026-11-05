/**
 * Resolves the active animation configuration from the page URL. This is the
 * single source of truth shared by the debug workbench, the standalone player
 * and (Phase 4) export, so the same URL always renders the same animation:
 *
 *   #preset=<base64url>   inline preset (imports, share links, export of preset files)
 *   ?preset=<name>        presets/<name>.json from the repository (bundled at build time)
 *   (neither)             presets/default.json
 *   &fp=<fingerprint>     optional pin: refuse to run unless the resolved config matches
 *
 * An explicitly requested preset that is missing or invalid is an error; it
 * never silently falls back to the default. localStorage is never consulted
 * here (workbench drafts are opt-in; see debug/drafts.ts).
 */
import {
  PRESET_NAME_PATTERN,
  decodePresetFromUrl,
  encodePresetForUrl,
  presetFingerprint,
  validatePreset,
  type Preset,
} from './preset';

export type PresetSource =
  | { kind: 'bundled'; name: string; file: string; explicit: boolean }
  | { kind: 'inline' };

export interface BundledPreset {
  name: string;
  file: string;
  validation: ReturnType<typeof validatePreset>;
}

export type ResolvedPreset =
  | { ok: true; preset: Preset; source: PresetSource; fingerprint: string }
  | { ok: false; title: string; errors: string[] };

const files = import.meta.glob('../../presets/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** Every preset file in presets/, validated once at startup (invalid files are kept so selecting them reports why). */
export const BUNDLED_PRESETS: ReadonlyMap<string, BundledPreset> = new Map(
  Object.entries(files)
    .map(([path, json]): BundledPreset => {
      const name = path.split('/').pop()!.replace(/\.json$/, '');
      let validation = validatePreset(json);
      if (validation.ok && validation.preset.name !== name) {
        validation = { ok: false, errors: [`presets/${name}.json declares "name": "${validation.preset.name}"; the file name and name must match.`] };
      }
      return { name, file: `presets/${name}.json`, validation };
    })
    .sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)))
    .map((p) => [p.name, p]),
);

function inlineFromHash(hash: string): string | null {
  const m = /^#preset=(.+)$/.exec(hash);
  return m ? m[1] : null;
}

export function resolvePresetFromUrl(href: string): ResolvedPreset {
  const url = new URL(href);
  const inline = inlineFromHash(url.hash);
  const named = url.searchParams.get('preset');
  const pin = url.searchParams.get('fp');

  let result: ResolvedPreset;
  if (inline !== null && named !== null) {
    return { ok: false, title: 'Ambiguous preset selection', errors: ['The URL has both ?preset= and #preset=. Use one.'] };
  } else if (inline !== null) {
    let raw: unknown;
    try {
      raw = decodePresetFromUrl(inline);
    } catch (e) {
      return { ok: false, title: 'Inline preset could not be read', errors: [(e as Error).message] };
    }
    const v = validatePreset(raw);
    if (!v.ok) return { ok: false, title: 'Inline preset is invalid', errors: v.errors };
    result = { ok: true, preset: v.preset, source: { kind: 'inline' }, fingerprint: presetFingerprint(v.preset.params) };
  } else {
    const name = named ?? 'default';
    if (!PRESET_NAME_PATTERN.test(name)) {
      return { ok: false, title: `Preset "${name}" not found`, errors: [`"${name}" is not a valid preset name.`] };
    }
    const entry = BUNDLED_PRESETS.get(name);
    if (!entry) {
      return {
        ok: false,
        title: `Preset "${name}" not found`,
        errors: [`No presets/${name}.json in this build.`, `Available: ${[...BUNDLED_PRESETS.keys()].join(', ') || '(none)'}.`],
      };
    }
    if (!entry.validation.ok) return { ok: false, title: `Preset "${name}" is invalid`, errors: entry.validation.errors };
    result = {
      ok: true,
      preset: entry.validation.preset,
      source: { kind: 'bundled', name, file: entry.file, explicit: named !== null },
      fingerprint: presetFingerprint(entry.validation.preset.params),
    };
  }

  if (pin !== null && pin !== result.fingerprint) {
    return {
      ok: false,
      title: 'Preset fingerprint mismatch',
      errors: [`The URL pins fingerprint ${pin}, but the resolved preset "${result.preset.name}" has ${result.fingerprint}.`, 'The preset file changed or the build is stale.'],
    };
  }
  return result;
}

/** URL (relative to the app root) that reproduces a configuration in the given mode. */
export function urlForPreset(
  target: { preset: Preset; bundledName?: string },
  mode: 'player' | 'workbench',
  extra: Record<string, string> = {},
): string {
  const q = new URLSearchParams();
  if (mode === 'player') q.set('debug', '0');
  if (target.bundledName) q.set('preset', target.bundledName);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const query = q.toString();
  const hash = target.bundledName ? '' : `#preset=${encodePresetForUrl(target.preset)}`;
  return `./${query ? `?${query}` : ''}${hash}`;
}
