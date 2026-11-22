// =============================================================================
// state.test.mjs — what is kept for the next visit (state.js). Run with
// "npm test".
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { startSettings, PRESET_DEFAULTS } from '../src/js/settings.js';
import { PRESETS } from '../src/js/presets.js';
import { toSaved, fromSaved } from '../src/js/state.js';

// The settings as they are right after choosing a preset.
const after = (name) => ({ ...startSettings(), ...PRESET_DEFAULTS, ...PRESETS[name].settings, preset: name });

test('your own settings and the page come back, and nothing of the scene', () => {
  const settings = { ...after('carousel'), trails: 2, balls: 64, musicVolume: 0.8, glints: 0.7, hdrStrength: 0.3, tilt: true, rewindEstimate: true, pixelSize: 2 };
  const back = fromSaved(toSaved(settings, 'Show'));
  assert.deepEqual(back.own, { soundVolume: 0.5, musicVolume: 0.8, glints: 0.7, hdrStrength: 0.3, pixelSize: 2 });
  assert.equal(back.page, 'Show');
  assert.ok(!('preset' in back) && !('scene' in back));
});

test('a broken or old saved state gives only what makes sense', () => {
  assert.equal(fromSaved('not json'), null);
  assert.equal(fromSaved('null'), null);
  // (An older version also kept the preset and the scene: those are left out.)
  assert.deepEqual(fromSaved('{"preset":"gas","scene":{"balls":5},"own":{"balls":7,"musicVolume":9,"glints":"x","tilt":true,"preset":"gas"},"page":3}'),
    { own: { musicVolume: 1 }, page: null });
});
