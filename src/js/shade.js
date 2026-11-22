// =============================================================================
// shade.js — shader maths written once, for both ways of drawing.
//
// WebGL wants its shaders in one language (GLSL) and WebGPU in another
// (WGSL). They can say the same things, spelled differently. The maths that
// is the same in both, a backdrop's pattern, a curve, a colour formula, is
// written once in the notation below, and these two functions turn it into
// each language. What really differs between the two ways of drawing (how
// they are handed their numbers and pictures, what they are asked to draw)
// stays written by hand in each.
//
// The notation is a small part of WGSL, with the types always written out:
//
//   fn name(a: f32, b: vec3f) -> vec3f { ... }      a function
//   let x: f32 = ...;   var c: vec3f = ...;         a value; one that changes
//   const N: i32 = 4;                               a constant
//   if (...) { ... } else { ... }                   always with braces
//   for (var i: i32 = 0; i < 3; i++) { ... }        also break, continue
//   select(ifNot, ifSo, condition)                  for numbers and vectors of f32
//   f32(i), i32(x), vec2f(...), vec3f(...), vec4f(...), mat3x3f(...)
//   $name                                           something each language
//                                                   names differently: the
//                                                   caller says what (see below)
//
// and the functions both languages have under the same name: sin, cos, abs,
// floor, fract, mix, clamp, min, max, pow, exp, sqrt, dot, length,
// normalize, cross, step, smoothstep, sign. (For a remainder, write
// x - y * floor(x / y); and compare vectors with step, not with <.)
//
// A function may use others, and globals, that each language defines by
// hand under the same name (a table of colours, say).
// =============================================================================

// What each of the notation's type names is called in GLSL.
const GLSL_TYPES = {
  f32: 'float', i32: 'int', u32: 'uint', bool: 'bool',
  vec2f: 'vec2', vec3f: 'vec3', vec4f: 'vec4', vec2i: 'ivec2', vec3i: 'ivec3',
  mat2x2f: 'mat2', mat3x3f: 'mat3', mat4x4f: 'mat4',
};
// ... and the few functions with another name there.
const GLSL_FUNCTIONS = { select: 'mix', atan2: 'atan', dpdx: 'dFdx', dpdy: 'dFdy', inverseSqrt: 'inversesqrt' };

const named = (source, names) => source.replace(/\$(\w+)/g, (all, name) => {
  if (!(name in names)) throw new Error(`shade.js: no name given for $${name}`);
  return names[name];
});

// The notation as WGSL: it is WGSL already, but for the $names.
export function toWgsl(source, names = {}) {
  return named(source, names);
}

// The notation as GLSL (ES 3.00, as WebGL2 reads it).
export function toGlsl(source, names = {}) {
  const type = (name) => {
    if (!(name in GLSL_TYPES)) throw new Error(`shade.js: no type "${name}" in the notation`);
    return GLSL_TYPES[name];
  };
  let out = named(source, names);
  // fn name(a: T, b: T) -> R {      →   R name(T a, T b) {
  out = out.replace(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+)\s*)?\{/g, (all, name, parameters, result) => {
    const list = parameters.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const [, n, t] = p.match(/^(\w+)\s*:\s*(\w+)$/) ?? [];
      if (!n) throw new Error(`shade.js: "${p}" in ${name}(...) is no "name: type"`);
      return `${type(t)} ${n}`;
    });
    return `${result ? type(result) : 'void'} ${name}(${list.join(', ')}) {`;
  });
  // let x: T = ...   var x: T ...   const X: T = ...
  out = out.replace(/\b(let|var|const)\s+(\w+)\s*:\s*(\w+)/g, (all, kind, name, t) => `${kind === 'const' ? 'const ' : ''}${type(t)} ${name}`);
  if (/\b(let|var)\s+\w+\s*=/.test(out)) throw new Error('shade.js: a let or var without its type');
  // The types left are constructors and casts: vec3f(...), f32(...)
  out = out.replace(/\b(\w+)(?=\s*\()/g, (name) => GLSL_TYPES[name] ?? GLSL_FUNCTIONS[name] ?? name);
  return out;
}

// ---- Maths that several shaders share, in the notation above ----

// A smoothed "square wave": +1 on even squares, -1 on odd squares; the
// checks on the balls, the Twist and the Tunnel.
//
// 'blur' is how many squares the edge blend spans (about one pixel).
// Instead of a hard jump the wave is averaged over that width. At an edge
// that gives exactly the blend of a smoothed edge; the advantage of
// averaging is that where the squares get smaller than a pixel (near a
// ball's poles, far down the Tunnel) they melt into an even colour instead
// of shimmering.
//
// Trick: the running total of a square wave is a zig-zag, and the average
// over a window is (zig-zag at one end − at the other) / width.
export const SQUARE_WAVE = `
  fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
  fn squareWave(x: f32, blur0: f32) -> f32 {
    let blur: f32 = max(blur0, 1e-4);
    return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
  }`;

// The screen's colour curve (sRGB), both ways: toLinear turns a screen
// colour into linear light, toScreen turns it back. For numbers below 0
// too, mirrored (colours outside sRGB, on a wide-colour screen: see
// ELEMENTARY_IN_P3 in renderer.js).
export const COLOR_CURVES = `
  fn toLinear(c: vec3f) -> vec3f {
    let a: vec3f = abs(c);
    return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), a));
  }
  fn toScreen(c: vec3f) -> vec3f {
    let a: vec3f = abs(c);
    return sign(c) * mix(a * 12.92, 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), a));
  }`;

// The remainder of x / y, never below 0.
export const MODULO = `
  fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }`;
