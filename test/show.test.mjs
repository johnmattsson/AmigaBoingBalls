// =============================================================================
// show.test.mjs — the timeline (show.js), run without a page: a made-up page
// writes down what the show asks of it. Run with "npm test".
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Show, CURTAIN_SECONDS } from '../src/js/show.js';
import { PRESETS } from '../src/js/presets.js';

function playing(preset) {
  const log = [];
  const show = new Show({
    scene: (part, keep) => log.push(['scene', part, keep]),
    change: (set) => log.push(['change', set]),
    curtain: (drawn) => { if (log.at(-1)?.[0] !== 'curtain' || log.at(-1)[1] !== drawn) log.push(['curtain', drawn]); },
    speed: () => 2,
  });
  show.start(preset, { digits: 32 });
  return { show, log };
}

test('a preset of one part is set up once, and then left alone', () => {
  const { show, log } = playing(PRESETS.gas);
  for (let i = 0; i < 1000; i++) show.tick(1);
  assert.deepEqual(log, [['scene', PRESETS.gas, { digits: 32 }]]);
  assert.equal(show.moves, false);
});

test('the Megademo shows every part for its time, in order, round and round', () => {
  const { show, log } = playing(PRESETS.megademo);
  const parts = PRESETS.megademo.parts, seen = [0];
  let cues = 0;
  const round = parts.reduce((sum, part) => sum + part.seconds, 0);
  for (let t = 0; t < 2 * round; t += 0.05) {
    const before = show.time, part = show.index;
    show.tick(0.05);
    if (show.index !== part) {
      assert.ok(Math.abs(before + 0.05 - parts[part].seconds) < 0.06, `part ${part + 1} ended after ${before} s`);
      seen.push(show.index);
    }
  }
  assert.deepEqual(seen.slice(0, parts.length + 2), [...parts.keys(), 0, 1]);
  for (const entry of log) if (entry[0] === 'change') cues++;
  assert.equal(cues, 2 * parts.reduce((sum, part) => sum + (part.cues?.length ?? 0), 0), 'every cue happens once in each round');
  // A part with balls gets the show's settings under its own, and keeps the Speed.
  const second = log.filter((entry) => entry[0] === 'scene')[1];
  assert.equal(second[1].settings.scroller, true);
  assert.equal(second[1].settings.balls, 32);
  assert.deepEqual(second[2], { speed: 2 });
  // Every backdrop there is has its part.
  const backdrops = new Set(parts.map((part) => (part.settings.copper ? part.settings.backdrop ?? 'bars' : 'none')));
  assert.deepEqual([...backdrops].sort(), ['bars', 'bobs', 'kefrens', 'none', 'plasma', 'stars', 'tunnel', 'twist']);
});

test('the curtain is drawn just before each part ends, and opens with the next', () => {
  const { show, log } = playing(PRESETS.megademo);
  const first = PRESETS.megademo.parts[0].seconds;
  show.tick(first - CURTAIN_SECONDS - 0.1);
  assert.deepEqual(log.at(-1), ['curtain', false]);
  show.tick(0.2);
  assert.deepEqual(log.at(-1), ['curtain', true]);
  show.tick(CURTAIN_SECONDS);
  assert.deepEqual(log.at(-1), ['curtain', false]);
  assert.equal(show.index, 1);
});

test('starting another show ends the one before', () => {
  const { show, log } = playing(PRESETS.megademo);
  show.tick(PRESETS.megademo.parts[0].seconds - 0.1);
  assert.deepEqual(log.at(-1), ['curtain', true]);
  show.start(PRESETS.four);
  assert.deepEqual(log.at(-2), ['curtain', false]);
  assert.equal(show.moves, false);
  assert.equal(log.at(-1)[1], PRESETS.four);
});

test('each part of the Megademo with music is as long as its section of the tune', async () => {
  const { TRACKS, MEGA_BAR_SECONDS } = await import('../src/js/music.js');
  const parts = PRESETS.megademo.parts.slice(1), sections = TRACKS.mega.sections;
  assert.equal(PRESETS.megademo.settings.track, 'mega');
  assert.equal(parts.length, sections.length);
  parts.forEach((part, i) => {
    assert.ok(Math.abs(part.seconds - sections[i].length * MEGA_BAR_SECONDS) < 1e-9, `part ${i + 2}`);
    for (const cue of part.cues ?? []) assert.ok(Number.isInteger(cue.at / MEGA_BAR_SECONDS), `a cue of part ${i + 2} is on a bar line`);
    for (const row of sections[i].melody) assert.equal(row.length, 16);
  });
});
