// =============================================================================
// pieces.test.mjs — the pieces of a burst ball (see shell-pieces.js), checked
// without a browser: they fall as the balls do (the Gravity setting), bounce
// off balls still there, land on the floor lying flat, inside the room, at
// their own shape and size, and are painted into a picture of it; without
// gravity they come to rest in mid-air (so the page can stop drawing them).
// =============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellPieces } from '../src/js/shell-pieces.js';
import { boxRoom, GRAVITY_SCALE } from '../src/js/physics.js';
import { Vec3, Quat } from '../src/js/math.js';

const walls = boxRoom().walls;
const ball = (x = 0, y = 0, z = 0) => ({ id: 1, position: new Vec3(x, y, z), orientation: new Quat(0, 0, 0, 1), radius: 1, color: 0xc40233, squares: 8 });
const burst = () => { const p = new ShellPieces(); p.burst(ball(), new Vec3(), 1); return p; };
const run = (pieces, seconds, gravity, balls = []) => { for (let t = 0; t < seconds; t += 1 / 60) pieces.step(1 / 60, walls, gravity, balls); };

test('the pieces fall with the Gravity setting: none, the usual, heavy', () => {
  const heights = [0, 1, 5].map((g) => {
    const p = burst();
    const before = p.pieces.reduce((sum, q) => sum + q.vy, 0) / p.count;
    run(p, 0.3, GRAVITY_SCALE * g);
    return p.pieces.reduce((sum, q) => sum + q.vy, 0) / p.count - before * Math.exp(-0.6 * 0.3);   // (how much faster upwards, on average, than the air alone would leave them)
  });
  assert.ok(Math.abs(heights[0]) < 0.5, `no gravity: not falling (${heights[0]})`);
  assert.ok(heights[1] < heights[0] - 0.5 && heights[2] < heights[1] - 2, `heavier, faster down: ${heights}`);
});

test('they bounce off a ball still there, never staying inside it', () => {
  const p = burst();
  const other = { id: 2, position: new Vec3(0, -3, 0), radius: 1.5 };   // just below the burst
  for (let t = 0; t < 3; t += 1 / 60) {
    p.step(1 / 60, walls, GRAVITY_SCALE, [other]);
    for (const q of p.pieces) {
      const d = Math.hypot(q.x - other.position.x, q.y - other.position.y, q.z - other.position.z);
      assert.ok(d >= other.radius - 1e-9, `inside the ball: ${d}`);
    }
  }
});

test('on the floor they are painted into its picture, and gone from the list', () => {
  const p = burst(), count = p.count;
  run(p, 30, GRAVITY_SCALE);
  assert.equal(p.count, 0, 'none left one by one');
  assert.ok(p.floor?.any, 'the floor has a picture');
  // As much of the floor covered as the pieces' own area, or less where they overlap.
  const texel = (p.floor.across / p.floor.width) * (p.floor.deep / p.floor.height);
  const painted = p.floor.codes.reduce((n, c) => n + (c > 0 ? 1 : 0), 0) * texel;
  const shell = 4 * Math.PI * 1 * 1;   // (the ball's whole shell, radius 1)
  assert.ok(painted > 0.3 * shell && painted < 1.05 * shell, `${painted.toFixed(2)} of the floor painted, the shell ${shell.toFixed(2)}`);
  const codes = new Set(p.floor.codes);
  assert.ok(codes.has(1) && codes.has(5), 'red and white');   // (a red ball: see ball above)
  assert.equal(count > 0, true);
  p.clear();
  assert.equal(p.floor, null, 'cleared with the scene');
});

test('never more pieces in all than allowed: the oldest go', () => {
  const p = new ShellPieces();
  p.most = 4000;
  for (let k = 0; k < 40; k++) p.burst({ ...ball(), squares: 12 }, new Vec3(), 1);   // (288 each)
  assert.equal(p.count, 4000);
});

test('many bursting together leave out squares by chance, to stay within the limit', () => {
  for (const most of [2000, 20000]) {
    const p = new ShellPieces();
    p.most = most;
    for (let k = 0; k < 1000; k++) p.burst(ball(), new Vec3(), 1000);   // (72 squares each: 72000 without leaving any out)
    assert.ok(p.count <= most && p.count > 0.9 * most, `${p.count} of at most ${most}`);
  }
});

test('without gravity they stay, and come to rest in mid-air', () => {
  const p = burst(), count = p.count;
  run(p, 30, 0);
  assert.equal(p.count, count, 'none gone');
  assert.equal(p.moving, 0, 'all still');
});

test('landing, each lies flat on the floor, inside the room, at its own shape and size', () => {
  const area = (k) => {   // (of its corners, x, y, z, …, as a flat shape)
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < k.length; c += 3) {
      const d = (c + 3) % k.length;
      x += k[c + 1] * k[d + 2] - k[c + 2] * k[d + 1];
      y += k[c + 2] * k[d] - k[c] * k[d + 2];
      z += k[c] * k[d + 1] - k[c + 1] * k[d];
    }
    return Math.hypot(x, y, z) / 2;
  };
  const p = new ShellPieces();
  for (const y of [-5, 0, 5]) for (const z of [-5, 5]) p.burst({ ...ball(0, y, z) }, new Vec3(), 6);
  const sizes = new Map(p.pieces.map((q) => [q, area(q.corners)]));
  // Each piece as it is painted into the floor (see bake).
  let landed = 0, worst = 0;
  const bake = p.bake.bind(p);
  p.bake = (q, floor) => {
    landed++;
    worst = Math.max(worst, Math.abs(area(q.corners) / sizes.get(q) - 1));
    for (let c = 0; c < q.corners.length; c += 3) {
      assert.ok(Math.abs(q.corners[c + 1]) < 1e-9, 'flat');
      for (const w of walls) {
        const n = w.normal;
        const beyond = (q.x + q.corners[c]) * n.x + (q.y + q.corners[c + 1]) * n.y + (q.z + q.corners[c + 2]) * n.z - w.offset;
        assert.ok(beyond < 1e-9, `a corner ${beyond} beyond a wall`);
      }
    }
    bake(q, floor);
  };
  const count = p.count;
  run(p, 30, GRAVITY_SCALE);
  assert.equal(landed, count, 'all landed');
  assert.ok(worst < 0.03, `a piece's size changed by ${(100 * worst).toFixed(1)}%`);
});
