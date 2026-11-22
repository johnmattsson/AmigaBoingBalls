// =============================================================================
// shade.test.mjs — the shader notation (shade.js) turned into both shader
// languages. Run with "npm test". (Whether the graphics card accepts the
// results is checked by the page test, which draws with them.)
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { toGlsl, toWgsl } from '../src/js/shade.js';

const SOURCE = `
  const TURNS: f32 = 3.0;
  fn wave(p: vec2f, k: i32) -> vec3f {
    let t: f32 = $time * TURNS;
    var color: vec3f = vec3f(0.0);
    for (var i: i32 = 0; i < k; i++) {
      if (f32(i) > t) { continue; }
      color += select(vec3f(1.0), mix(color, vec3f(p, 0.5), 0.5), sin(t) > 0.0);
    }
    return color;
  }
  fn nothing() { shine = 0.0; }`;

test('as WGSL: itself, with the names filled in', () => {
  assert.equal(toWgsl(SOURCE, { time: 'frame.time' }), SOURCE.replace('$time', 'frame.time'));
});

test('as GLSL: types first, and its own names for a few things', () => {
  assert.equal(toGlsl(SOURCE, { time: 'uTime' }), `
  const float TURNS = 3.0;
  vec3 wave(vec2 p, int k) {
    float t = uTime * TURNS;
    vec3 color = vec3(0.0);
    for (int i = 0; i < k; i++) {
      if (float(i) > t) { continue; }
      color += mix(vec3(1.0), mix(color, vec3(p, 0.5), 0.5), sin(t) > 0.0);
    }
    return color;
  }
  void nothing() { shine = 0.0; }`);
});

test('mistakes in the notation are caught, not passed on', () => {
  assert.throws(() => toGlsl('fn f() -> f32 { let x = 1.0; return x; }'), /without its type/);
  assert.throws(() => toGlsl('fn f(a: float) -> f32 { return a; }'), /no type "float"/);
  assert.throws(() => toGlsl('fn f() -> f32 { return $time; }'), /no name given/);
  assert.throws(() => toWgsl('fn f() -> f32 { return $time; }'), /no name given/);
});
