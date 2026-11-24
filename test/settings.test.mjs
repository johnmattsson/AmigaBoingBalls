// =============================================================================
// settings.test.mjs — the list of settings (settings.js) and everything that
// has to agree with it. Run with "npm test".
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, PRESET_DEFAULTS, startSettings, clean } from '../src/js/settings.js';
import { PRESETS } from '../src/js/presets.js';
import { COLLISION_TYPES } from '../src/js/physics.js';
import { TRACKS } from '../src/js/music.js';
import { CUE_SETTINGS, CURTAIN_SECONDS } from '../src/js/show.js';
import { readFileSync, readdirSync } from 'node:fs';

test('every setting starts with a value it may have', () => {
  for (const [key, about] of Object.entries(SETTINGS)) {
    if (about.shown || key === 'preset') continue;
    assert.equal(clean(key, about.start), about.start, key);
  }
  assert.ok(PRESETS[startSettings().preset], 'the page starts with a preset that exists');
});

test('a preset puts back the scene, and only the scene', () => {
  for (const key of ['soundVolume', 'musicVolume', 'hdrStrength', 'glints', 'preset', 'fps', 'energy', 'pixelSize']) {
    assert.ok(!(key in PRESET_DEFAULTS), `${key} is yours, not the scene's`);
  }
  for (const key of ['balls', 'gravity', 'speed', 'backdrop', 'grid', 'track']) assert.ok(key in PRESET_DEFAULTS, key);
});

// Every list of settings a preset (or a part of the Megademo) has.
const lists = [];
for (const [name, preset] of Object.entries(PRESETS)) {
  lists.push([name, preset.settings ?? {}]);
  (preset.parts ?? []).forEach((part, i) => lists.push([`${name} part ${i + 1}`, { ...part.settings }]));
}
test('the presets only set what a preset may set, to values it can have', () => {
  for (const [name, settings] of lists) {
    for (const [key, value] of Object.entries(settings)) {
      assert.ok(key in PRESET_DEFAULTS, `${name} sets ${key}, which no preset may`);
      assert.equal(clean(key, value), value, `${name}: ${key} = ${value}`);
    }
  }
});

test('the Megademo: every part has a length, and its cues are in order', () => {
  for (const part of PRESETS.megademo.parts) {
    assert.ok(part.seconds > 1, 'a part needs more than a second');
    let last = 0;
    for (const cue of part.cues ?? []) {
      assert.ok(cue.at > last && cue.at < part.seconds - CURTAIN_SECONDS, 'the cues come in order, before the curtain');
      last = cue.at;
      for (const [key, value] of Object.entries(cue.set)) {
        assert.ok(CUE_SETTINGS.includes(key), `a cue can't change ${key}`);
        assert.equal(clean(key, value), value, `cue: ${key} = ${value}`);
      }
    }
  }
});

test('the choices are the ones the rest of the demo knows', () => {
  assert.deepEqual([...SETTINGS.track.choices].sort(), Object.keys(TRACKS).sort());
  for (const kind of SETTINGS.wallType.choices) assert.ok(COLLISION_TYPES[kind], `wall bounce ${kind}`);
  for (const kind of SETTINGS.ballType.choices) assert.ok(COLLISION_TYPES[kind], `ball bounce ${kind}`);
});

test('values from outside are checked', () => {
  assert.equal(clean('balls', 1e9), SETTINGS.balls.max);
  assert.equal(clean('balls', 12.4), 12);
  assert.equal(clean('gravity', -3), 0);
  assert.equal(clean('ballSize', 0.74), 0.75);
  assert.equal(clean('backdrop', 'nonsense'), undefined);
  assert.equal(clean('grid', 'yes'), undefined);
  assert.equal(clean('balls', NaN), undefined);
  assert.equal(clean('fps', 60), undefined);
  assert.equal(clean('noSuchSetting', 1), undefined);
});

test('the page knows every script (for their versioned addresses: see index.html)', () => {
  const page = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const listed = JSON.parse(page.match(/const scripts = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
  const files = readdirSync(new URL('../src/js/', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => name.slice(0, -3))
    .filter((name) => name !== 'physics-worker');   // (the worker is started by physics-client.js, with the version in its own address)
  assert.deepEqual([...listed].sort(), files.sort());
});

test('the backdrops are the ones the renderers know, in the same order', async () => {
  // (renderer.js needs a page to load; its list is read as text.)
  const text = readFileSync(new URL('../src/js/renderer.js', import.meta.url), 'utf8');
  const listed = JSON.parse(text.match(/export const BACKDROPS = (\[[^\]]*\])/)[1].replaceAll("'", '"'));
  assert.deepEqual(SETTINGS.backdrop.choices, listed);
});

test('every Tile clicks choice has a label, and Paint a square of its own for every square', async () => {
  const { SETTINGS } = await import('../src/js/settings.js');
  const { squareIndex, wallKey } = await import('../src/js/shaders.js');
  const { choices, labels } = SETTINGS.tileClicks;
  for (const choice of choices) {
    assert.ok(labels[choice], `${choice} has a label`);
  }
  assert.deepEqual(choices, ['off', 'tricks', 'paint']);   // (tricks: all of TILE_EFFECTS, by chance; see tile-clicks.js)
  // (Paint: each square of a wall its own number, and the walls told apart.)
  const seen = new Set();
  for (let a = -5.5; a < 6; a++) for (let b = -5.5; b < 6; b++) seen.add(squareIndex({ x: a, y: b, z: -6 }, { x: 0, y: 0, z: -1 }, 6));
  assert.equal(seen.size, 144);
  assert.ok(Math.min(...seen) === 0 && Math.max(...seen) === 143);
  assert.equal(squareIndex({ x: 6.5, y: 0, z: -6 }, { x: 0, y: 0, z: -1 }, 6), -1);
  assert.deepEqual(['x+', 'x-', 'y+', 'y-', 'z+', 'z-'].map((k, i) => wallKey([{ x: 6, y: 0, z: 0 }, { x: -6, y: 0, z: 0 }, { x: 0, y: 6, z: 0 }, { x: 0, y: -6, z: 0 }, { x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: -6 }][i]) === k), [true, true, true, true, true, true]);
});

test('the shaders give every clicked-square effect its own length (tileSeconds)', async () => {
  const { TILE_EFFECTS, TILE_CLICK_MATHS } = await import('../src/js/shaders.js');
  const body = TILE_CLICK_MATHS.match(/fn tileSeconds\(kind: f32\) -> f32 \{ return (.*); \}/)[1];
  const tileSeconds = new Function('kind', `const select = (no, yes, c) => (c ? yes : no); return ${body};`);
  for (const [name, { code, seconds }] of Object.entries(TILE_EFFECTS)) assert.equal(tileSeconds(code), seconds, name);
});
