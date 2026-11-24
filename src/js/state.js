// =============================================================================
// state.js — what is kept for the next visit.
//
// Your own settings (loudness, Glints, HDR: `own` in
// settings.js) and the Controls' page. (Not where the Controls were moved
// to: they open in their corner.) Not the scene: a reload always
// starts with Four balls, as the page did the first time. (The Defaults
// button puts your own settings back too: see main.js.)
//
// Everything read back is checked (clean in settings.js): it may be from an
// older version, or changed by hand.
//
// (No page here: main.js does the saving and the reading, so this can be
// tested without a browser. See test/state.test.mjs.)
// =============================================================================

import { SETTINGS, clean } from './settings.js';

// Your own settings, as they are now.
export function ownSettings(settings) {
  const own = {};
  for (const [key, about] of Object.entries(SETTINGS)) {
    if (about.own && !about.forgotten && key !== 'preset') own[key] = settings[key];
  }
  return own;
}

// A text to store, and back.
export function toSaved(settings, page) {
  return JSON.stringify({ own: ownSettings(settings), page });
}
// Returns { own, page }, or null if there is nothing usable. (Only your own
// settings, with values they may have.)
export function fromSaved(text) {
  let state;
  try { state = JSON.parse(text); } catch { return null; }
  if (!state || typeof state !== 'object') return null;
  const own = {};
  for (const [key, value] of Object.entries(state.own ?? {})) {
    const about = SETTINGS[key];
    if (!about?.own || about.forgotten || key === 'preset') continue;
    const ok = clean(key, value);
    if (ok !== undefined) own[key] = ok;
  }
  return { own, page: typeof state.page === 'string' ? state.page : null };
}
