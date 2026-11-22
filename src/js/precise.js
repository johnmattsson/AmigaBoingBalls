// =============================================================================
// precise.js — the physics with about 32 or 64 digits instead of 16.
//
// Computers store a number with about 16 significant digits. Bouncing balls
// are chaotic: every collision makes a small error several times bigger.
// So when time is run backwards, the balls retrace their paths only for
// about twenty collisions each; after that, the rounding errors have grown
// as big as the balls (see the About window).
//
// This file does the same physics as physics.js, but carries every number
// as a short list of ordinary numbers that add up to it: the first is the
// usual number, the next holds the 16 digits that would otherwise be rounded
// away, and so on. Two of them give about 32 digits ("double-double"), four
// give about 64 ("quad-double"). Every extra digit lets a rewind survive
// more collisions. It is slower, so it is an option (Digits on the Scene page).
//
// What is carried with all the digits: every ball's position, velocity and
// spin, and every moment in time. (The balls' rotations, which only matter
// for drawing them, stay as they are.) The extra parts live next to each
// ball in `ball.precise`. The usual Vec3 values (ball.position etc.) always
// hold the first parts, so everything else in the program sees the balls as
// usual. If something else changes a ball (a click, the Energy slider, a
// preset), its extra parts simply start again from zero.
// =============================================================================

import { Vec3 } from './math.js';
import { nearbyPairs } from './physics.js';
import { PRECISE_WASM } from './precise-wasm.js';

// ---- Two exact tricks everything is built on ----------------------------------
// When a computer adds or multiplies two numbers, it rounds the result. The
// rounding error can be worked out EXACTLY with a few more operations:
let err = 0;   // the rounding error of the last twoSum / twoProduct

// a + b, rounded; the error is left in `err` ("two-sum").
function twoSum(a, b) {
  const s = a + b, v = s - a;
  err = (a - (s - v)) + (b - v);
  return s;
}

// a × b, rounded; the error is left in `err`. Each number is cut into two
// halves of 26 bits, whose products are exact.
const SPLIT = 134217729;   // 2^27 + 1
function twoProduct(a, b) {
  const p = a * b;
  let t = SPLIT * a;
  const a1 = t - (t - a), a2 = a - a1;
  t = SPLIT * b;
  const b1 = t - (t - b), b2 = b - b1;
  err = ((a1 * b1 - p) + a1 * b2 + a2 * b1) + a2 * b2;
  return p;
}

// ---- Arithmetic with lists of numbers --------------------------------------------
// A precise number is a Float64Array of `parts` numbers, biggest first, that
// add up to the value. Results are written into `out`, which may be one of
// the inputs. This general version works for any number of parts; the
// two-part version below has quicker formulas for the same things.
class Arithmetic {
  constructor(parts) {
    this.parts = parts;
    this.terms = new Float64Array(4 * parts * parts + 8);   // scratch space for sums
    this.a = this.number(); this.b = this.number();
    this.q = new Float64Array(parts + 1);
    this.x = this.number(); this.y = this.number(); this.z = this.number();
  }

  number() { return new Float64Array(this.parts); }
  set(out, value) { out.fill(0); out[0] = value; }
  negate(out, a) { for (let k = 0; k < this.parts; k++) out[k] = -a[k]; }

  // Is a < b? (The biggest parts decide; the next ones only if those are equal.)
  less(a, b) {
    for (let k = 0; k < this.parts; k++) if (a[k] !== b[k]) return a[k] < b[k];
    return false;
  }

  // Turn `count` numbers in `terms` (in any order) into a precise number:
  // add them up `parts` times over. Each pass puts the (rounded) sum of
  // what is left at the end and keeps every rounding error, so nothing is
  // lost; the sum is the next part.
  gather(t, count, out) {
    const parts = this.parts;
    for (let k = 0; k < parts; k++) {
      if (count === 0) { out[k] = 0; continue; }
      for (let i = 1; i < count; i++) { t[i] = twoSum(t[i - 1], t[i]); t[i - 1] = err; }
      out[k] = t[--count];
    }
    for (let i = 0; i < count; i++) out[parts - 1] += t[i];   // what little is left
    // Tidy up so that each part is much smaller than the one before.
    let s = out[parts - 1];
    for (let k = parts - 2; k >= 0; k--) { s = twoSum(out[k], s); out[k + 1] = err; }
    out[0] = s;
  }

  add(out, a, b) {
    const t = this.terms, n = this.parts;
    for (let k = 0; k < n; k++) { t[k] = a[k]; t[n + k] = b[k]; }
    this.gather(t, 2 * n, out);
  }

  sub(out, a, b) {
    const t = this.terms, n = this.parts;
    for (let k = 0; k < n; k++) { t[k] = a[k]; t[n + k] = -b[k]; }
    this.gather(t, 2 * n, out);
  }

  // Products of parts that are too small to matter are left out.
  mul(out, a, b) {
    const t = this.terms, n = this.parts;
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) { t[count++] = twoProduct(a[i], b[j]); t[count++] = err; }
      if (i > 0) t[count++] = a[i] * b[n - i];
    }
    this.gather(t, count, out);
  }

  // a × an ordinary number.
  scale(out, a, x) {
    const t = this.terms, n = this.parts;
    for (let k = 0; k < n; k++) { t[2 * k] = twoProduct(a[k], x); t[2 * k + 1] = err; }
    this.gather(t, 2 * n, out);
  }

  // a ÷ b by long division, one part of the answer at a time.
  div(out, a, b) {
    const n = this.parts, rest = this.a, step = this.b, q = this.q;
    rest.set(a);
    for (let k = 0; k <= n; k++) {
      q[k] = rest[0] / b[0];
      this.scale(step, b, q[k]);
      this.sub(rest, rest, step);
    }
    const t = this.terms;
    for (let k = 0; k <= n; k++) t[k] = q[k];
    this.gather(t, n + 1, out);
  }

  // √a: an ordinary square root, then corrections (Newton's method), each
  // of which doubles the number of correct digits.
  sqrt(out, a) {
    if (a[0] <= 0) { out.fill(0); return; }
    const x = this.x, square = this.y, half = this.z;
    this.set(x, Math.sqrt(a[0]));
    for (let digits = 16; digits < 16 * this.parts; digits *= 2) {
      this.mul(square, x, x);
      this.sub(square, a, square);          // what is missing ...
      this.div(half, square, x);
      this.scale(half, half, 0.5);          // ... ÷ 2x is the correction
      this.add(x, x, half);
    }
    out.set(x);
  }
}

// The same with two parts, using shorter formulas (about 32 digits).
class DoubleDouble extends Arithmetic {
  constructor() { super(2); }

  add(out, a, b) {
    const s = twoSum(a[0], b[0]);
    let e = err;
    const t = twoSum(a[1], b[1]);
    const f = err;
    e += t;
    const h = s + e;
    e = e - (h - s) + f;
    const r = h + e;
    out[1] = e - (r - h);
    out[0] = r;
  }

  sub(out, a, b) {
    const s = twoSum(a[0], -b[0]);
    let e = err;
    const t = twoSum(a[1], -b[1]);
    const f = err;
    e += t;
    const h = s + e;
    e = e - (h - s) + f;
    const r = h + e;
    out[1] = e - (r - h);
    out[0] = r;
  }

  mul(out, a, b) {
    const p = twoProduct(a[0], b[0]);
    const e = err + (a[0] * b[1] + a[1] * b[0]);
    const r = p + e;
    out[1] = e - (r - p);
    out[0] = r;
  }

  scale(out, a, x) {
    const p = twoProduct(a[0], x);
    const e = err + a[1] * x;
    const r = p + e;
    out[1] = e - (r - p);
    out[0] = r;
  }

  div(out, a, b) {
    const q1 = a[0] / b[0];
    const rest = this.a, step = this.b;
    this.scale(step, b, q1);
    this.sub(rest, a, step);
    const q2 = rest[0] / b[0];
    this.scale(step, b, q2);
    this.sub(rest, rest, step);
    const q3 = rest[0] / b[0];
    const s = q1 + q2;
    const e = q2 - (s - q1) + q3;
    const r = s + e;
    out[1] = e - (r - s);
    out[0] = r;
  }

  sqrt(out, a) {
    if (a[0] <= 0) { out.fill(0); return; }
    const x = Math.sqrt(a[0]);
    const p = twoProduct(x, x);
    const c = ((a[0] - p) - err + a[1]) / (2 * x);
    const r = x + c;
    out[1] = c - (r - x);
    out[0] = r;
  }
}

// The same with four parts (about 64 digits), using the shortcuts of the
// QD library by Hida, Li and Bailey: the products and sums of parts are
// written out one by one instead of being gathered in general, and parts
// far too small to matter are left out. Much quicker than the general way.
let r0 = 0, r1 = 0, r2 = 0, r3 = 0;   // results of renorm

// s = a + b, when |a| ≥ |b| (one step fewer than twoSum); error in `err`.
function quickTwoSum(a, b) { const s = a + b; err = b - (s - a); return s; }

// Five numbers, roughly biggest first, into four parts that do not overlap.
function renorm(c0, c1, c2, c3, c4) {
  let s0, s1 = 0, s2 = 0, s3 = 0;
  s0 = quickTwoSum(c3, c4); c4 = err;
  s0 = quickTwoSum(c2, s0); c3 = err;
  s0 = quickTwoSum(c1, s0); c2 = err;
  c0 = quickTwoSum(c0, s0); c1 = err;
  s0 = c0; s1 = c1;
  s0 = quickTwoSum(c0, c1); s1 = err;
  if (s1 !== 0) {
    s1 = quickTwoSum(s1, c2); s2 = err;
    if (s2 !== 0) {
      s2 = quickTwoSum(s2, c3); s3 = err;
      if (s3 !== 0) s3 += c4; else s2 += c4;
    } else {
      s1 = quickTwoSum(s1, c3); s2 = err;
      if (s2 !== 0) { s2 = quickTwoSum(s2, c4); s3 = err; } else { s1 = quickTwoSum(s1, c4); s2 = err; }
    }
  } else {
    s0 = quickTwoSum(s0, c2); s1 = err;
    if (s1 !== 0) {
      s1 = quickTwoSum(s1, c3); s2 = err;
      if (s2 !== 0) { s2 = quickTwoSum(s2, c4); s3 = err; } else { s1 = quickTwoSum(s1, c4); s2 = err; }
    } else {
      s0 = quickTwoSum(s0, c3); s1 = err;
      if (s1 !== 0) { s1 = quickTwoSum(s1, c4); s2 = err; } else { s0 = quickTwoSum(s0, c4); s1 = err; }
    }
  }
  r0 = s0; r1 = s1; r2 = s2; r3 = s3;
}

class QuadDouble extends Arithmetic {
  constructor() { super(4); this.step = this.number(); this.rest = this.number(); }

  add(out, a, b) { this.addParts(out, a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]); }
  sub(out, a, b) { this.addParts(out, a[0], a[1], a[2], a[3], -b[0], -b[1], -b[2], -b[3]); }

  addParts(out, a0, a1, a2, a3, b0, b1, b2, b3) {
    let s0 = twoSum(a0, b0), t0 = err;
    let s1 = twoSum(a1, b1), t1 = err;
    let s2 = twoSum(a2, b2), t2 = err;
    let s3 = twoSum(a3, b3), t3 = err;
    s1 = twoSum(s1, t0); t0 = err;
    // three-sum of (s2, t0, t1)
    let u1 = twoSum(s2, t0), u2 = err;
    s2 = twoSum(t1, u1); let u3 = err;
    t0 = twoSum(u2, u3); t1 = err;
    // three-sum (keeping two) of (s3, t0, t2)
    u1 = twoSum(s3, t0); u2 = err;
    s3 = twoSum(t2, u1); u3 = err;
    t0 = u2 + u3;
    t0 = t0 + t1 + t3;
    renorm(s0, s1, s2, s3, t0);
    out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
  }

  mul(out, a, b) {
    const p0 = twoProduct(a[0], b[0]), q0 = err;
    let p1 = twoProduct(a[0], b[1]), q1 = err;
    let p2 = twoProduct(a[1], b[0]), q2 = err;
    let p3 = twoProduct(a[0], b[2]), q3 = err;
    let p4 = twoProduct(a[1], b[1]), q4 = err;
    let p5 = twoProduct(a[2], b[0]), q5 = err;
    // three-sum of (p1, p2, q0)
    let t1 = twoSum(p1, p2), t2 = err;
    p1 = twoSum(q0, t1); let t3 = err;
    p2 = twoSum(t2, t3); let c = err;
    // three-sums of (p2, q1, q2) and (p3, p4, p5)
    t1 = twoSum(p2, q1); t2 = err; p2 = twoSum(q2, t1); t3 = err; q1 = twoSum(t2, t3); q2 = err;
    t1 = twoSum(p3, p4); t2 = err; p3 = twoSum(p5, t1); t3 = err; p4 = twoSum(t2, t3); p5 = err;
    // (s0, s1, s2) = (p2, q1, q2) + (p3, p4, p5)
    const s0 = twoSum(p2, p3); let e0 = err;
    let s1 = twoSum(q1, p4); const e1 = err;
    let s2 = q2 + p5;
    s1 = twoSum(s1, e0); e0 = err;
    s2 += e0 + e1;
    // the next smaller terms, without their own errors
    s1 += a[0] * b[3] + a[1] * b[2] + a[2] * b[1] + a[3] * b[0] + c + q3 + q4 + q5;
    renorm(p0, p1, s0, s1, s2);
    out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
  }

  scale(out, a, x) {
    const p0 = twoProduct(a[0], x), q0 = err;
    const p1 = twoProduct(a[1], x), q1 = err;
    const p2 = twoProduct(a[2], x), q2 = err;
    const p3 = a[3] * x;
    const s0 = p0;
    const s1 = twoSum(q0, p1); let s2 = err;
    // three-sum of (s2, q1, p2)
    let t1 = twoSum(s2, q1), t2 = err;
    s2 = twoSum(p2, t1); let t3 = err;
    let u1 = twoSum(t2, t3), u2 = err;
    // three-sum (keeping two) of (u1, q2, p3)
    t1 = twoSum(u1, q2); t2 = err;
    const s3 = twoSum(p3, t1); t3 = err;
    const s4 = t2 + t3 + u2;
    renorm(s0, s1, s2, s3, s4);
    out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
  }

  div(out, a, b) {
    const step = this.step, rest = this.rest;
    const q0 = a[0] / b[0];
    this.scale(step, b, q0); this.sub(rest, a, step);
    const q1 = rest[0] / b[0];
    this.scale(step, b, q1); this.sub(rest, rest, step);
    const q2 = rest[0] / b[0];
    this.scale(step, b, q2); this.sub(rest, rest, step);
    const q3 = rest[0] / b[0];
    this.scale(step, b, q3); this.sub(rest, rest, step);
    const q4 = rest[0] / b[0];
    renorm(q0, q1, q2, q3, q4);
    out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
  }
}

// ---- Faster with WebAssembly -----------------------------------------------------------
// The hot operations of the 64-digit arithmetic above also exist compiled to
// WebAssembly (wasm/precise.c, packed into precise-wasm.js), where they run
// about eight times faster; the whole 64-digit physics then runs about twice
// as fast. Operation for operation they are the same, so the results are
// identical to the last bit. If WebAssembly is not available, the
// JavaScript versions above are simply used instead.
//
// (For 32 digits it made no difference: those operations are so short that
// calling WebAssembly costs as much as it saves. For 16 digits the physics
// uses ordinary numbers, which JavaScript already handles at full speed.)
//
// The digits go in as arguments and the result comes back in a small fixed
// place in WebAssembly's memory (R), from where it is copied into `out`.
// (Calling WebAssembly costs a little each time, so only operations that
// are worth it are moved; the rest stays in JavaScript.)
async function loadWasm() {
  try {
    const bytes = Uint8Array.from(atob(PRECISE_WASM), (c) => c.charCodeAt(0));
    return (await WebAssembly.instantiate(bytes)).instance.exports;
  } catch {
    return null;
  }
}
const wasm = await loadWasm();
if (wasm) {
  const R = new Float64Array(wasm.memory.buffer, wasm.res(), 4);
  const { qdAdd, qdMul, qdScale } = wasm;
  Object.assign(QuadDouble.prototype, {
    add(out, a, b) { qdAdd(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]); out[0] = R[0]; out[1] = R[1]; out[2] = R[2]; out[3] = R[3]; },
    sub(out, a, b) { qdAdd(a[0], a[1], a[2], a[3], -b[0], -b[1], -b[2], -b[3]); out[0] = R[0]; out[1] = R[1]; out[2] = R[2]; out[3] = R[3]; },
    mul(out, a, b) { qdMul(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]); out[0] = R[0]; out[1] = R[1]; out[2] = R[2]; out[3] = R[3]; },
    scale(out, a, x) { qdScale(a[0], a[1], a[2], a[3], x); out[0] = R[0]; out[1] = R[1]; out[2] = R[2]; out[3] = R[3]; },
  });
}

// ---- The engine -----------------------------------------------------------------------
// One engine per number of parts (see stepPrecisely at the end).
class PreciseEngine {
  constructor(parts) {
    const N = this.N = parts === 2 ? new DoubleDouble() : parts === 4 ? new QuadDouble() : new Arithmetic(parts);
    this.parts = parts;
    const number = () => N.number(), vector = () => [N.number(), N.number(), N.number()];
    // Scratch space, so that nothing new has to be made while running.
    this.s = Array.from({ length: 16 }, number);   // scalars
    this.v = Array.from({ length: 12 }, vector);   // vectors
    this.gravity = vector();
  }

  // ---- Vectors: three precise numbers ----
  vSet(out, v) { this.N.set(out[0], v.x); this.N.set(out[1], v.y); this.N.set(out[2], v.z); }
  vAdd(out, a, b) { for (let k = 0; k < 3; k++) this.N.add(out[k], a[k], b[k]); }
  vSub(out, a, b) { for (let k = 0; k < 3; k++) this.N.sub(out[k], a[k], b[k]); }
  vMul(out, a, s) { for (let k = 0; k < 3; k++) this.N.mul(out[k], a[k], s); }
  vScale(out, a, x) { for (let k = 0; k < 3; k++) this.N.scale(out[k], a[k], x); }
  vNegate(out, a) { for (let k = 0; k < 3; k++) this.N.negate(out[k], a[k]); }
  vDot(out, a, b) {
    const N = this.N, t = this.s[15];
    N.mul(out, a[0], b[0]);
    N.mul(t, a[1], b[1]); N.add(out, out, t);
    N.mul(t, a[2], b[2]); N.add(out, out, t);
  }
  vCross(out, a, b) {
    const N = this.N, x = this.s[11], y = this.s[12], z = this.s[13], t = this.s[14];
    N.mul(x, a[1], b[2]); N.mul(t, a[2], b[1]); N.sub(x, x, t);
    N.mul(y, a[2], b[0]); N.mul(t, a[0], b[2]); N.sub(y, y, t);
    N.mul(z, a[0], b[1]); N.mul(t, a[1], b[0]); N.sub(z, z, t);
    out[0].set(x); out[1].set(y); out[2].set(z);
  }
  toVec3(a) { return new Vec3(a[0][0], a[1][0], a[2][0]); }

  // ---- A ball's precise state ----
  // ball.precise = { parts, position, velocity, spin, slide, was }.
  // Returns true if the ball had to be started afresh from its usual values.
  load(ball) {
    const N = this.N;
    let s = ball.precise, fresh = false;
    if (!s || s.parts !== this.parts) {
      fresh = true;
      const old = s;
      const vector = () => [N.number(), N.number(), N.number()];
      s = ball.precise = { parts: this.parts, position: vector(), velocity: vector(), spin: vector(),
                           slide: N.number(), was: old ? old.was : {} };
      s.was = {};   // (start from the usual values: they are of the present moment)
      // The "sliding mass" σ = m·I / (I + m·r²): how heavy the ball feels to
      // a push along its surface. (Ball has it as slideMass, rounded to 16
      // digits. A grippy bounce undoes itself only if σ fits m, I and r
      // exactly, so here it is worked out again with all the digits.)
      const [mr2, top, down] = [this.s[0], this.s[1], this.s[2]];
      N.set(mr2, ball.radius); N.mul(mr2, mr2, mr2); N.scale(mr2, mr2, ball.mass);
      N.set(down, ball.inertia); N.add(down, down, mr2);
      N.set(top, ball.mass); N.scale(top, top, ball.inertia);
      N.div(s.slide, top, down);
      // 1/mass and 1/inertia, so that a kick can multiply instead of divide.
      const one = this.s[3];
      N.set(one, 1);
      N.set(top, ball.mass); s.perMass = N.number(); N.div(s.perMass, one, top);
      N.set(top, ball.inertia); s.perInertia = N.number(); N.div(s.perInertia, one, top);
    }
    // If anything was changed from outside (a push, the Energy slider, ...),
    // start the whole ball afresh from its usual values, which are of the
    // present moment. (Its precise values may be from an earlier moment:
    // see stepPrecisely.)
    if (fresh || ball.position !== s.was.position || ball.velocity !== s.was.velocity || ball.spin !== s.was.spin) {
      this.vSet(s.position, ball.position);
      this.vSet(s.velocity, ball.velocity);
      this.vSet(s.spin, ball.spin);
      s.was = { position: ball.position, velocity: ball.velocity, spin: ball.spin };
      return true;
    }
    return false;
  }

  // Write the first parts back into the ball's usual Vec3 values.
  store(ball) {
    const s = ball.precise;
    ball.position = s.was.position = this.toVec3(s.position);
    ball.velocity = s.was.velocity = this.toVec3(s.velocity);
    ball.spin = s.was.spin = this.toVec3(s.spin);
  }

  // Move a ball by the time t (negative = backwards), exactly as Ball.move
  // in physics.js: position += velocity·t + ½·gravity·t², velocity += gravity·t.
  move(ball, t, gravity) {
    const N = this.N, s = ball.precise, step = this.v[0];
    this.vMul(step, s.velocity, t);
    this.vAdd(s.position, s.position, step);
    if (gravity.x !== 0 || gravity.y !== 0 || gravity.z !== 0) {
      const g = this.gravity, t2 = this.s[0];
      this.vSet(g, gravity);
      N.mul(t2, t, t);
      N.scale(t2, t2, 0.5);
      this.vMul(step, g, t2);
      this.vAdd(s.position, s.position, step);
      this.vMul(step, g, t);
      this.vAdd(s.velocity, s.velocity, step);
    }
  }

  // ---- When do things meet? ----
  // As timeUntilBallsTouch / timeUntilWall in physics.js. The answer goes
  // into `out` (Infinity = not within `within` seconds from now).
  //
  // First a quick look with ordinary numbers: most pairs are clearly moving
  // apart or will clearly not meet this frame, and then the slow precise
  // calculation can be skipped. Only when it is not clear is it done.
  // The quick look, with ordinary numbers: could balls a and b meet within
  // `within` seconds? Their precise state is from `lagA` and `lagB` seconds
  // ago (balls are only moved when needed), so first estimate where they
  // are now. Says "maybe" when it is not clear.
  mightTouch(a, b, lagA, lagB, direction, within, gravity) {
    const pa = a.precise.position, pb = b.precise.position, va = a.precise.velocity, vb = b.precise.velocity;
    const ha = 0.5 * lagA * lagA, hb = 0.5 * lagB * lagB;
    const ox = (pb[0][0] + vb[0][0] * lagB + gravity.x * hb) - (pa[0][0] + va[0][0] * lagA + gravity.x * ha);
    const oy = (pb[1][0] + vb[1][0] * lagB + gravity.y * hb) - (pa[1][0] + va[1][0] * lagA + gravity.y * ha);
    const oz = (pb[2][0] + vb[2][0] * lagB + gravity.z * hb) - (pa[2][0] + va[2][0] * lagA + gravity.z * ha);
    const vx = ((vb[0][0] + gravity.x * lagB) - (va[0][0] + gravity.x * lagA)) * direction;
    const vy = ((vb[1][0] + gravity.y * lagB) - (va[1][0] + gravity.y * lagA)) * direction;
    const vz = ((vb[2][0] + gravity.z * lagB) - (va[2][0] + gravity.z * lagA)) * direction;
    const R = a.radius + b.radius;
    const quickB = ox * vx + oy * vy + oz * vz;
    const quickA = vx * vx + vy * vy + vz * vz;
    const quickC = ox * ox + oy * oy + oz * oz - R * R;
    const size = Math.sqrt((ox * ox + oy * oy + oz * oz) * quickA) + 1e-300;
    if (quickB > 1e-9 * size) return false;                        // clearly apart
    if (quickC > 1e-9 * R * R) {
      const quickD = quickB * quickB - quickA * quickC;
      if (quickD < -1e-9 * quickB * quickB) return false;           // clearly missing
      const quickT = quickC / (-quickB + Math.sqrt(Math.max(0, quickD)));
      if (quickT > within * (1 + 1e-6) + 1e-9) return false;        // clearly later
    }
    return true;
  }

  // The precise calculation (both balls must be up to date).
  timeUntilBallsTouch(out, a, b, direction) {
    const N = this.N;
    const [offset, closing] = [this.v[1], this.v[2]];
    const [B, C, A, D, t] = [this.s[3], this.s[4], this.s[5], this.s[6], this.s[7]];
    this.vSub(offset, b.precise.position, a.precise.position);
    this.vSub(closing, b.precise.velocity, a.precise.velocity);
    if (direction < 0) this.vNegate(closing, closing);
    this.vDot(B, offset, closing);
    if (B[0] >= 0) { N.set(out, Infinity); return; }                         // moving apart
    N.set(t, a.radius); N.set(D, b.radius); N.add(t, t, D); N.mul(t, t, t);   // (r_a + r_b)²
    this.vDot(C, offset, offset);
    N.sub(C, C, t);
    if (C[0] <= 0) { N.set(out, 0); return; }                                // touching now
    this.vDot(A, closing, closing);
    N.mul(D, B, B);
    N.mul(t, A, C);
    N.sub(D, D, t);
    if (D[0] < 0) { N.set(out, Infinity); return; }                          // they miss
    N.sqrt(D, D);
    N.sub(D, D, B);                                                          // −B + √D
    N.div(out, C, D);
  }

  // The quick look for a wall: the gap to it cannot close faster than the
  // ball's speed towards it plus what gravity adds; could it close within
  // `within` seconds? (The precise state is from `lag` seconds ago.)
  mightReachWall(ball, wall, lag, within, gravity) {
    const s = ball.precise, n = wall.normal, p = s.position, v = s.velocity;
    const g = n.x * gravity.x + n.y * gravity.y + n.z * gravity.z;
    const speed = n.x * v[0][0] + n.y * v[1][0] + n.z * v[2][0];
    const gap = wall.offset - ball.radius - (n.x * p[0][0] + n.y * p[1][0] + n.z * p[2][0] + speed * lag + 0.5 * g * lag * lag);
    const towards = Math.abs(speed + g * lag);
    return !(gap > (towards * within + 0.5 * Math.abs(g) * within * within) * (1 + 1e-6) + 1e-9);
  }

  // The precise calculation (the ball must be up to date).
  timeUntilWall(out, ball, wall, direction, gravity) {
    const N = this.N, s = ball.precise, n = wall.normal;

    const [a, b, c, D, t, slope] = [this.s[3], this.s[4], this.s[5], this.s[6], this.s[7], this.s[8]];
    // The gap to the wall changes as a·t² + b·t + c.
    const g = this.gravity, nv = this.v[3];
    this.vSet(g, gravity);
    this.vSet(nv, n);
    this.vDot(a, nv, g);
    N.scale(a, a, 0.5);
    this.vDot(b, nv, s.velocity);
    if (direction < 0) N.negate(b, b);
    this.vDot(c, nv, s.position);
    N.set(t, ball.radius - 0); N.add(c, c, t);
    N.set(t, -wall.offset); N.add(c, c, t);

    if (c[0] >= 0 && b[0] > 0) { N.set(out, 0); return; }   // touching and moving out: now

    // The possible moments; keep the first one in the future where the
    // ball is moving outwards (2a·t + b > 0).
    N.set(out, Infinity);
    const consider = (root) => {
      if (!(root[0] >= 0) || root[0] === Infinity) return;
      N.mul(slope, a, root); N.scale(slope, slope, 2); N.add(slope, slope, b);
      if (slope[0] > 0 && N.less(root, out)) out.set(root);
    };
    if (Math.abs(a[0]) < 1e-12) {
      if (b[0] !== 0) { N.negate(D, c); N.div(t, D, b); consider(t); }
      return;
    }
    N.mul(D, b, b);
    N.mul(t, a, c); N.scale(t, t, 4);
    N.sub(D, D, t);
    if (D[0] < 0) return;
    N.sqrt(D, D);
    if (b[0] < 0) N.negate(D, D);              // q = −½·(b + sign(b)·√D)
    N.add(D, D, b);
    N.scale(D, D, -0.5);
    N.div(t, D, a); consider(t);
    if (D[0] !== 0) { N.div(t, c, D); consider(t); }
  }

  // ---- Bounces ----
  // As collideWithWall and collideBalls in physics.js, step by step.

  // Kick a ball with `impulse` at `lever` (from its centre), plus the pure
  // twist `twist`.
  applyImpulse(ball, lever, impulse, twist) {
    const s = ball.precise, d = this.v[4], turn = this.v[5];
    this.vMul(d, impulse, s.perMass);
    this.vAdd(s.velocity, s.velocity, d);
    this.vCross(turn, lever, impulse);
    this.vAdd(turn, turn, twist);
    this.vMul(d, turn, s.perInertia);
    this.vAdd(s.spin, s.spin, d);
  }

  collideWithWall(physics, ball, wallNormal) {
    const N = this.N, s = ball.precise, WALL = physics.wallBounce;
    const [n, lever, contact, inward, impulse, twist] = this.v.slice(6, 12);
    const [amount, factor] = [this.s[10], this.s[9]];
    this.vSet(n, wallNormal);
    this.vScale(lever, n, ball.radius);
    this.vCross(contact, s.spin, lever);
    this.vAdd(contact, s.velocity, contact);            // the contact point's velocity
    this.vDot(amount, n, contact);
    this.vMul(inward, n, amount);                       // the part going into the wall
    this.vSub(contact, contact, inward);                // the part sliding along it
    this.vScale(impulse, inward, -(1 + WALL.normal) * ball.mass);
    N.scale(factor, s.slide, -(1 + WALL.tangential));
    this.vMul(contact, contact, factor);
    this.vAdd(impulse, impulse, contact);
    this.vDot(amount, n, s.spin);
    N.scale(amount, amount, -(1 + WALL.angular) * ball.inertia);
    this.vMul(twist, n, amount);

    const impactSpeed = Math.abs(wallNormal.dot(ball.velocity));
    ball.catchUpRotation();
    this.applyImpulse(ball, lever, impulse, twist);
    if (WALL.flipSpinAtSides && wallNormal.x !== 0) this.vNegate(s.spin, s.spin);
    this.store(ball);
    physics.onWallCollision(ball, wallNormal, impactSpeed);
  }

  // The "reduced" value p·q/(p+q).
  reduced(out, p, q) {
    const N = this.N, sum = this.s[14];
    N.add(sum, p, q);
    N.mul(out, p, q);
    N.div(out, out, sum);
  }

  collideBalls(physics, a, b) {
    const N = this.N, sa = a.precise, sb = b.precise, BALL = physics.ballBounce;
    const [n, leverA, leverB, velA, velB, normalA, normalB, impulse, friction, twist] = this.v.slice(0, 10);
    const [length, amount, mass, slide, inertia, p, q] = this.s.slice(0, 7);

    this.vSub(n, sb.position, sa.position);             // from a towards b ...
    this.vDot(length, n, n);
    N.sqrt(length, length);
    N.set(amount, 1);
    N.div(length, amount, length);
    this.vMul(n, n, length);                            // ... of length 1
    this.vScale(leverA, n, a.radius);
    this.vScale(leverB, n, -b.radius);
    this.vCross(velA, sa.spin, leverA); this.vAdd(velA, sa.velocity, velA);
    this.vCross(velB, sb.spin, leverB); this.vAdd(velB, sb.velocity, velB);
    this.vDot(amount, n, velA); this.vMul(normalA, n, amount);
    this.vDot(amount, n, velB); this.vMul(normalB, n, amount);

    const impactSpeed = Math.abs(this.toVec3(n).dot(b.velocity.sub(a.velocity)));

    N.set(p, a.mass); N.set(q, b.mass); this.reduced(mass, p, q);
    this.reduced(slide, sa.slide, sb.slide);
    N.set(p, a.inertia); N.set(q, b.inertia); this.reduced(inertia, p, q);

    this.vSub(impulse, normalB, normalA);
    N.scale(mass, mass, 1 + BALL.normal);
    this.vMul(impulse, impulse, mass);
    this.vSub(velA, velA, normalA);                     // a's sliding
    this.vSub(velB, velB, normalB);                     // b's sliding
    this.vSub(friction, velB, velA);
    N.scale(slide, slide, 1 + BALL.tangential);
    this.vMul(friction, friction, slide);
    this.vAdd(impulse, impulse, friction);
    this.vDot(p, n, sb.spin);
    this.vDot(q, n, sa.spin);
    N.sub(amount, p, q);
    N.scale(inertia, inertia, 1 + BALL.angular);
    N.mul(amount, amount, inertia);
    this.vMul(twist, n, amount);

    a.catchUpRotation();
    b.catchUpRotation();
    this.applyImpulse(a, leverA, impulse, twist);
    this.vNegate(impulse, impulse);
    this.vNegate(twist, twist);
    this.applyImpulse(b, leverB, impulse, twist);
    this.store(a);
    this.store(b);
    physics.onBallCollision(a, b, impactSpeed);
  }
}

// ---- The collision plan ------------------------------------------------------------
// As CollisionPlan in physics.js (read that first), with every moment kept
// as a precise number. All moments are counted from the start of the frame;
// moment number i is kept in parts [i·P … i·P + P) of a long list.
class PrecisePlan {
  // `lag(i)`: how many seconds ago ball i was last moved precisely.
  constructor(engine, balls, walls, direction, gravity, horizon, clock, bringUpToDate, lag) {
    const N = engine.N, P = engine.parts, count = balls.length;
    Object.assign(this, { engine, N, P, balls, walls, direction, gravity, horizon, bringUpToDate, lag });
    this.clock = N.number(); this.clock.set(clock);
    this.t = N.number(); this.u = N.number();

    const left = horizon[0] - clock[0];
    Object.assign(this, nearbyPairs(balls, gravity, left));   // speedLimits, pairA, pairB, firstPair, pairsOf
    const pairs = this.pairA.length;
    this.pairTime = new Float64Array(pairs * P);
    this.wallTime = new Float64Array(count * P);
    this.wallNormal = new Array(count).fill(null);
    this.bestTime = new Float64Array(count * P);   // each ball's earliest event: when,
    this.bestOther = new Int32Array(count);         //   and with which ball (−1 = its wall)

    for (let i = 0; i < count; i++) this.predictWall(i);
    for (let p = 0; p < pairs; p++) this.predictPair(p);
    for (let i = 0; i < count; i++) this.findBest(i);
  }

  // Is moment i of list A before moment j of list B?
  before(A, i, B, j) {
    const P = this.P;
    for (let k = 0; k < P; k++) if (A[i * P + k] !== B[j * P + k]) return A[i * P + k] < B[j * P + k];
    return false;
  }
  put(A, i, x) { A.set(x, i * this.P); }
  get(out, A, i) { for (let k = 0; k < this.P; k++) out[k] = A[i * this.P + k]; }

  // `from now` later, counted from the start of the frame.
  later(out, fromNow) {
    if (fromNow[0] === Infinity) out.set(fromNow);
    else this.N.add(out, this.clock, fromNow);
  }

  predictWall(i) {
    const ball = this.balls[i], t = this.t, best = this.u;
    const within = this.horizon[0] - this.clock[0], lag = this.lag(i);
    this.N.set(best, Infinity);
    let normal = null;
    for (const wall of this.walls) {
      if (!this.engine.mightReachWall(ball, wall, lag, within, this.gravity)) continue;
      this.bringUpToDate(i);
      this.engine.timeUntilWall(t, ball, wall, this.direction, this.gravity);
      if (this.N.less(t, best)) { best.set(t); normal = wall.normal; }
    }
    this.later(t, best);
    this.put(this.wallTime, i, t);
    this.wallNormal[i] = normal;
  }

  predictPair(p) {
    const i = this.pairA[p], j = this.pairB[p], t = this.t;
    const within = this.horizon[0] - this.clock[0];
    if (!this.engine.mightTouch(this.balls[i], this.balls[j], this.lag(i), this.lag(j), this.direction, within, this.gravity)) {
      this.N.set(t, Infinity);
    } else {
      this.bringUpToDate(i);
      this.bringUpToDate(j);
      this.engine.timeUntilBallsTouch(t, this.balls[i], this.balls[j], this.direction);
      this.later(t, t);
    }
    this.put(this.pairTime, p, t);
  }

  partner(p, i) { return this.pairA[p] === i ? this.pairB[p] : this.pairA[p]; }

  findBest(i) {
    let fromList = this.wallTime, at = i, other = -1;
    for (let q = this.firstPair[i]; q < this.firstPair[i + 1]; q++) {
      const p = this.pairsOf[q];
      if (this.before(this.pairTime, p, fromList, at)) { fromList = this.pairTime; at = p; other = this.partner(p, i); }
    }
    this.get(this.t, fromList, at);
    this.put(this.bestTime, i, this.t);
    this.bestOther[i] = other;
  }

  // The ball whose event comes first (−1 if none at all).
  earliest() {
    let first = -1;
    for (let i = 0; i < this.balls.length; i++) {
      if (this.bestTime[i * this.P] === Infinity) continue;
      if (first < 0 || this.before(this.bestTime, i, this.bestTime, first)) first = i;
    }
    return first;
  }

  tooFast(changed) {
    return changed.some((i) => this.balls[i].velocity.length() > this.speedLimits[i]);
  }

  update(changed, clock) {
    this.clock.set(clock);
    for (const a of changed) {
      this.predictWall(a);
      for (let q = this.firstPair[a]; q < this.firstPair[a + 1]; q++) this.predictPair(this.pairsOf[q]);
    }
    for (const a of changed) {
      this.recheck(a, changed);
      for (let q = this.firstPair[a]; q < this.firstPair[a + 1]; q++) this.recheck(this.partner(this.pairsOf[q], a), changed);
    }
  }

  recheck(k, changed) {
    if (changed.includes(k) || changed.includes(this.bestOther[k])) {
      this.findBest(k);
      return;
    }
    for (let q = this.firstPair[k]; q < this.firstPair[k + 1]; q++) {
      const p = this.pairsOf[q], other = this.partner(p, k);
      if (changed.includes(other) && this.before(this.pairTime, p, this.bestTime, k)) {
        this.get(this.t, this.pairTime, p);
        this.put(this.bestTime, k, this.t);
        this.bestOther[k] = other;
      }
    }
  }
}

// ---- One frame ------------------------------------------------------------------------
// Move all balls by `seconds` (negative = backwards), bouncing on the way,
// computing with `parts` numbers per number (2 = 32 digits, 4 = 64): the
// same steps as in Physics.update, with precise numbers.
//
// As there, balls are only moved when needed, and here this goes on from
// frame to frame: each ball remembers the moment it was last moved
// (precisely, in physics.preciseState), and is only moved when it collides
// or might collide. Most balls have no collision in a given frame. For
// drawing, their usual Vec3 values are worked out from where they were then,
// with ordinary numbers, which is plenty for a picture.
const MAX_COLLISIONS_PER_FRAME = 50000;
const engines = new Map();   // one engine per number of parts, made when first needed

export function stepPrecisely(physics, seconds, gravity, parts = 2) {
  if (!engines.has(parts)) engines.set(parts, new PreciseEngine(parts));
  const engine = engines.get(parts), N = engine.N, P = parts;
  const balls = physics.balls, count = balls.length;
  const direction = Math.sign(seconds);
  const startTime = physics.time;

  // The moments are counted from when the state was made: `time` is now
  // (the start of this frame), moved[i] the moment ball i was last moved,
  // turned[i] the moment up to which it has been turned for drawing.
  let state = physics.preciseState;
  if (!state || state.parts !== parts || state.balls !== balls || state.count !== count) {
    state = physics.preciseState = { parts, balls, count, time: N.number(),
      moved: new Float64Array(count * P), turned: new Float64Array(count) };
    for (const ball of balls) ball.precise = null;   // all start from their usual values
  }
  const { time, moved, turned } = state;
  for (let i = 0; i < count; i++) {
    if (engine.load(balls[i])) {
      // Started (again) from its usual values, which are of the present.
      moved.set(time, i * P);
      turned[i] = time[0];
    }
  }
  // If gravity changed since the last frame (the Gravity slider), the balls
  // that are behind are first moved up to now with the gravity they had:
  // the new gravity only acts from now on.
  const was = state.gravity;
  if (was && (was.x !== gravity.x || was.y !== gravity.y || was.z !== gravity.z)) {
    const then = N.number(), behind = N.number();
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < P; k++) then[k] = moved[i * P + k];
      N.sub(behind, time, then);
      if (behind[0] !== 0) engine.move(balls[i], behind, was);
      moved.set(time, i * P);
    }
  }
  state.gravity = gravity;

  const clock = N.number(), horizon = N.number(), dt = N.number(), here = N.number(), now = N.number();
  N.set(horizon, Math.abs(seconds));
  // The present moment: the start of the frame plus (or, going backwards,
  // minus) the time passed in this frame.
  const updateNow = () => {
    if (direction > 0) N.add(now, time, clock); else N.sub(now, time, clock);
  };
  updateNow();
  const bringUpToDate = (i) => {
    let same = true;
    for (let k = 0; k < P; k++) if (moved[i * P + k] !== now[k]) { same = false; break; }
    if (same) return;
    for (let k = 0; k < P; k++) here[k] = moved[i * P + k];
    N.sub(dt, now, here);
    engine.move(balls[i], dt, gravity);
    moved.set(now, i * P);
  };
  const bringAllUpToDate = () => { for (let i = 0; i < count; i++) bringUpToDate(i); };
  // How much time has passed for ball i since it was last moved (negative
  // when time runs backwards), for the quick looks.
  const lag = (i) => now[0] - moved[i * P];
  // Turn the ball for drawing up to now (needed before its spin changes).
  const turnUpToDate = (i) => {
    balls[i].unturnedTime += now[0] - turned[i];
    turned[i] = now[0];
  };
  const makePlan = () => new PrecisePlan(engine, balls, physics.room.walls, direction, gravity, horizon, clock, bringUpToDate, lag);
  let plan = makePlan();

  for (let collisions = 0; collisions < MAX_COLLISIONS_PER_FRAME; collisions++) {
    const i = plan.earliest();
    if (i < 0) break;
    plan.get(here, plan.bestTime, i);
    if (N.less(horizon, here)) break;   // nothing more happens this frame
    clock.set(here);
    updateNow();
    physics.time = startTime + direction * clock[0];
    const j = plan.bestOther[i];
    bringUpToDate(i);
    turnUpToDate(i);
    if (j >= 0) {
      bringUpToDate(j);
      turnUpToDate(j);
      engine.collideBalls(physics, balls[i], balls[j]);
    } else {
      engine.collideWithWall(physics, balls[i], plan.wallNormal[i]);
    }
    if (physics.trailSeconds > 0) {
      physics.recordTrail(balls[i], true);
      if (j >= 0) physics.recordTrail(balls[j], true);
    }
    const changed = j >= 0 ? [i, j] : [i];
    if (plan.tooFast(changed)) {
      bringAllUpToDate();
      for (const ball of balls) engine.store(ball);   // (the new plan looks at the usual values)
      plan = makePlan();
    } else {
      plan.update(changed, clock);
    }
  }

  // The end of the frame: from now on, "now" is here.
  clock.set(horizon);
  updateNow();
  time.set(now);
  // For drawing: where every ball is now, with ordinary numbers, and its turn.
  for (let i = 0; i < count; i++) {
    const ball = balls[i], s = ball.precise, t = now[0] - moved[i * P];
    if (t === 0) {
      engine.store(ball);
    } else {
      const p = s.position, v = s.velocity, h = 0.5 * t * t;
      ball.position = s.was.position = new Vec3(p[0][0] + v[0][0] * t + gravity.x * h,
        p[1][0] + v[1][0] * t + gravity.y * h, p[2][0] + v[2][0] * t + gravity.z * h);
      ball.velocity = s.was.velocity = new Vec3(v[0][0] + gravity.x * t, v[1][0] + gravity.y * t, v[2][0] + gravity.z * t);
      ball.spin = s.was.spin = engine.toVec3(s.spin);
    }
    turnUpToDate(i);
  }
  physics.time = startTime + seconds;
}
