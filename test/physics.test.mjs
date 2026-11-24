// =============================================================================
// physics.test.mjs — the physics, checked without a browser.
//
// Run with "npm test" (the build runs it too, and stops if anything fails):
//   - every preset, and every part of the Megademo, keeps its energy, and
//     no two balls ever overlap or leave the box;
//   - a gas run forwards and then backwards comes back to where it started;
//   - 4000 balls can be stepped;
//   - the physics' host (what the worker runs) survives a long list of
//     random commands, as the page could send them.
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { Physics, BOX_HALF_SIZE } from '../src/js/physics.js';
import { PhysicsHost } from '../src/js/physics-host.js';
import { PRESETS, PRESET_DEFAULTS } from '../src/js/presets.js';

// Every scene of balls there is: the presets, and the Megademo's parts.
const scenes = [];
for (const [name, preset] of Object.entries(PRESETS)) {
  if (!preset.parts) { scenes.push([name, preset]); continue; }
  preset.parts.forEach((part, i) => {
    scenes.push([`${name} part ${i + 1}`, { ...part, settings: { ...preset.settings, ...part.settings } }]);
  });
}
const sceneOf = (preset) => {
  const s = { ...PRESET_DEFAULTS, ...preset.settings };
  const physics = new Physics(0, 0);
  physics.ballSize = s.ballSize;
  if (preset.setup) preset.setup(physics);
  else physics.setBallCount(s.balls);
  return { physics, gravity: s.gravity };
};

for (const [name, preset] of scenes) {
  test(`${name}: energy kept, no overlaps, nothing outside the box`, () => {
    const { physics, gravity } = sceneOf(preset);
    const before = physics.totalEnergy(gravity);
    const edge = BOX_HALF_SIZE + 1e-6;
    for (let frame = 0; frame < 240; frame++) {
      physics.update(1 / 60, gravity);
      if (frame % 40 !== 0) continue;
      const balls = physics.balls;
      for (const ball of balls) {
        assert.ok(Number.isFinite(ball.position.x + ball.position.y + ball.position.z), 'a ball is nowhere (NaN)');
        // (Without the box, the room is the window: wider than the box.)
        if (PRESET_DEFAULTS.grid && preset.settings?.grid !== false) {
          assert.ok(Math.abs(ball.position.x) <= edge && Math.abs(ball.position.y) <= edge && Math.abs(ball.position.z) <= edge, 'a ball left the box');
        }
      }
      for (let i = 0; i < balls.length && balls.length <= 600; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const gap = balls[i].position.sub(balls[j].position).length() - balls[i].radius - balls[j].radius;
          assert.ok(gap > -1e-6, `two balls overlap by ${-gap}`);
        }
      }
    }
    const after = physics.totalEnergy(gravity);
    assert.ok(Math.abs(after - before) <= 1e-9 * Math.max(1, Math.abs(before)), `energy went from ${before} to ${after}`);
  });
}

test('gas: one second forwards, then backwards, ends where it began', () => {
  // (The same balls every time: the gas places them by chance.)
  let seed = 7919;
  const chance = Math.random;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const physics = new Physics(0, 0);
  PRESETS.gas.setup(physics);
  Math.random = chance;
  const start = physics.balls.map((ball) => ball.position);
  for (let frame = 0; frame < 120; frame++) physics.update(1 / 120, 0);
  for (let frame = 0; frame < 120; frame++) physics.update(-1 / 120, 0);
  let worst = 0;
  physics.balls.forEach((ball, i) => { worst = Math.max(worst, ball.position.sub(start[i]).length() / ball.radius); });
  // (A thousand balls and some thousand hits each way: usually less than a
  // millionth of a ball's size. The rounding errors grow about a
  // hundredfold with every further second, so the time is kept short.)
  assert.ok(worst < 1e-3, `the worst ball missed its start by ${worst} of its size`);
});

test('4000 balls: a step is worked out, and quickly enough', () => {
  const physics = new Physics(0, 0);
  physics.ballSize = 0.25;   // (small balls: that many only fit so)
  physics.setBallCount(4000);
  const start = performance.now();
  for (let frame = 0; frame < 10; frame++) physics.update(1 / 60, 0.1);
  const each = (performance.now() - start) / 10;
  assert.equal(physics.balls.length, 4000);
  assert.ok(each < 500, `a step took ${each.toFixed(0)} ms`);   // (about 10 ms on a laptop; this only catches a freeze)
});

test('the host survives 1500 random commands', () => {
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const host = new PhysicsHost();
  host.handle({ op: 'init', balls: 4 });
  const names = Object.keys(PRESETS).filter((name) => PRESETS[name].setup);
  for (let i = 0; i < 1500; i++) {
    const r = random();
    if (r < 0.05) host.handle({ op: 'rewind', name: 'setEnabled', args: [random() < 0.7] });
    else if (r < 0.1) host.handle({ op: 'call', name: 'setBallCount', args: [Math.floor(random() * 60)] });
    else if (r < 0.13) host.handle({ op: 'call', name: 'setBallSize', args: [0.3 + random()] });
    else if (r < 0.15) {
      // (A preset's own balls, set up with the same calls as on the page.)
      PRESETS[names[Math.floor(random() * names.length)]].setup(
        new Proxy({}, { get: (_, name) => (...args) => host.handle({ op: 'call', name, args }) }));
      host.handle({ op: 'rewind', name: 'noticeNewBalls', args: [] });
    } else if (r < 0.17) host.handle({ op: 'set', key: 'precise', value: [0, 0, 1, 2][Math.floor(random() * 4)] });
    else if (r < 0.19) host.handle({ op: 'call', name: 'setTotalEnergy', args: [random() * 200, 0.1] });
    else if (r < 0.2) host.handle({ op: 'rewind', name: 'markChanged', args: [] });
    else if (r < 0.22) host.handle({ op: 'set', key: 'ballBounce', value: ['rough', 'smooth', 'garwin'][Math.floor(random() * 3)] });
    else if (r < 0.23 && host.physics.balls.length) {
      host.handle({ op: 'call', name: 'push', args: [Math.floor(random() * host.physics.balls.length), { x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: -1 }] });
    } else host.handle({ op: 'step', seconds: ((random() < 0.2 ? -1 : 1) / 60) * (random() * 3), gravity: random() * 5, seq: i });
  }
  for (const ball of host.physics.balls) assert.ok(Number.isFinite(ball.position.x + ball.position.y + ball.position.z), 'a ball is nowhere (NaN)');
});

test('a popped ball taken away (removeBalls) leaves the others as if it had never been there', async () => {
  const { Vec3 } = await import('../src/js/math.js');
  // Ball 1 flies at ball 0; ball 2 is far off. Without ball 1, ball 0 must
  // move exactly as when it was alone with ball 2 from the start.
  const make = (withMiddle) => {
    const p = new Physics(0, 0);
    const list = [
      { position: new Vec3(-3, 0, 0), velocity: new Vec3(0, 0, 0) },
      ...(withMiddle ? [{ position: new Vec3(0, 0, 0), velocity: new Vec3(-4, 0, 0) }] : []),
      { position: new Vec3(3, 3, 3), velocity: new Vec3(0, 1, 0) },
    ];
    p.setBalls(list);
    return p;
  };
  const popped = make(true), alone = make(false);
  const ids = popped.balls.map((b) => b.id);
  assert.equal(new Set(ids).size, 3, 'every ball its own id');
  popped.removeBalls([ids[1]]);
  assert.deepEqual(popped.balls.map((b) => b.id), [ids[0], ids[2]]);
  for (let k = 0; k < 120; k++) { popped.update(1 / 60, 0); alone.update(1 / 60, 0); }
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(popped.balls[i].position, alone.balls[i].position, `ball ${i} moved as if alone`);
  }
  assert.equal(popped.balls[0].velocity.x, 0, 'nothing hit it');
});
