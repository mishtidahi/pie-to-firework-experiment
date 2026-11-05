import { sanitizeParams, type Params } from '../config/params';
import { sameAnimationParams } from '../config/preset';

/**
 * Workbench-only convenience: unsaved edits are kept in localStorage as a
 * draft tied to the fingerprint of the preset they started from. Drafts are
 * never applied automatically. The workbench offers to restore one, so the
 * same URL always starts from the same configuration in every mode.
 * The player and export never read drafts.
 */
const DRAFT_KEY = 'pie-firework:draft:v1';
const LEGACY_KEYS = ['pie-firework:params:v3'];

export interface Draft {
  baseFingerprint: string;
  baseName: string;
  savedAt: string;
  params: Params;
}

export function readDraft(): Draft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (!raw || typeof raw.baseFingerprint !== 'string') return null;
    return { ...raw, params: sanitizeParams(raw.params) };
  } catch {
    return null;
  }
}

export function writeDraft(base: { fingerprint: string; name: string; params: Params }, params: Params) {
  if (sameAnimationParams(base.params, params) && base.params.exportFps === params.exportFps) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }
  const draft: Draft = { baseFingerprint: base.fingerprint, baseName: base.name, savedAt: new Date().toISOString(), params };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

/**
 * One-time migration of pre-preset saved params (Phases 1–3 auto-restored
 * them). They become a draft on top of the default preset, so nothing is lost.
 */
export function migrateLegacyParams(defaultBase: { fingerprint: string; name: string; params: Params }) {
  for (const key of LEGACY_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    localStorage.removeItem(key);
    if (localStorage.getItem(DRAFT_KEY) !== null) continue;
    try {
      writeDraft(defaultBase, sanitizeParams(JSON.parse(raw)));
    } catch {
      /* unreadable legacy data: drop it */
    }
  }
}
