// =============================================================================
// effects.js — more classic Amiga demo effects, each in a window of its own,
// like the Twist (see twist.js, which also opens and runs the windows):
//
//   Vector bobs – a few hundred small balls that fly together into a cube,
//                 then a sphere, and back (more groups on a wide picture)
//   Tunnel      – a rollercoaster ride down a tube lined with the Boing
//                 checker, along a track made up at random as it goes
// (Kefrens bars, another classic, are one of the scene's backdrops: see the
// copper shader in shaders.js.)
//
// Each draws with WebGPU where the main scene does (HDR where it is on: the
// highlights then shine), else with WebGL2. The four ball colours are the
// NCS elementary colours, as everywhere (see ELEMENTARY_IN_P3 in
// renderer.js): truer on a wide-colour screen, every other colour the same.
// Every shader is written twice: in GLSL for WebGL and in WGSL for WebGPU,
// line by line alike.
// =============================================================================

import { openEffectWindow, twistOptions, createProgram, GPU_FORMAT, effectTime, sharpen, samples, colorTarget } from './twist.js';
import { toGlsl, toWgsl, SQUARE_WAVE, COLOR_CURVES, MODULO } from './shade.js';
import { ELEMENTARY_COLOR_MATHS, srgbToP3Matrix } from './colors.js';
import { HDR_RANGE } from './gpu-renderer.js';
import { onP3Screen, onRec2020Screen } from './renderer.js';

const WIDTH = 400, HEIGHT = 300;   // the window's picture, in CSS pixels (4:3, as an Amiga screen)

// ---- Shared shader code -------------------------------------------------------
// Written once for both renderers (in the notation of shade.js): the
// Twist's night-blue backdrop, lighter towards the top (p: a pixel, from
// the top; $size: the picture's size), and where bob i sits on the two
// shapes the Vector Bobs change between: on a cube's faces, 6 × 6 to a
// face, and on a ball, spread evenly along a spiral.
const SKY = `
  fn sky(p: vec2f) -> vec3f {
    return light(mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), p.y / $size.y));
  }`;
const BOB_SHAPES = `
  fn cube(i: f32) -> vec3f {
    let face: f32 = floor(i / 36.0);
    let j: f32 = i - 36.0 * face;
    let a: f32 = (fmod(j, 6.0) + 0.5) / 3.0 - 1.0;
    let b: f32 = (floor(j / 6.0) + 0.5) / 3.0 - 1.0;
    let s: f32 = select(1.0, -1.0, fmod(face, 2.0) > 0.5);
    let axis: f32 = floor(face / 2.0);   // 0, 1 or 2: which pair of faces
    let third: vec3f = mix(vec3f(a, s, b), vec3f(a, b, s), step(1.5, axis));
    return 0.8 * mix(vec3f(s, a, b), third, step(0.5, axis));
  }
  fn sphere(i: f32) -> vec3f {
    let y: f32 = 1.0 - 2.0 * (i + 0.5) / $count;
    let r: f32 = sqrt(1.0 - y * y);
    let a: f32 = i * 2.39996323;
    return 1.05 * vec3f(cos(a) * r, y, sin(a) * r);
  }`;

// Colours as everywhere in the demo: light(c) turns a screen colour (sRGB)
// into linear light as the canvas takes it (Display P3 on a wide-colour
// screen); ballColor(i) is ball colour i (red, yellow, blue, green); sky(p)
// is the Twist's night-blue backdrop.
const GL_COMMON = /* glsl */ `
  uniform float uTime, uAspect, uGlow, uHdrRange, uWide, uRadius;
  uniform vec2 uSize;
  const float PI = 3.14159265359;
  ${toGlsl(COLOR_CURVES)}
  vec3 light(vec3 c) {
    const mat3 SRGB_TO_P3 = ${srgbToP3Matrix('glsl')};
    vec3 l = toLinear(c);
    return uWide > 0.5 ? SRGB_TO_P3 * l : l;
  }
  ${toGlsl(ELEMENTARY_COLOR_MATHS)}
  vec3 ballColor(int i) { return elementaryColor(float(i), uWide); }   // (see colors.js)
  ${toGlsl(SKY, { size: 'uSize' })}
  ${toGlsl(SQUARE_WAVE).trim()}
  ${toGlsl(MODULO)}
  vec3 finish(vec3 c) { return toScreen(clamp(c, 0.0, max(1.0, uHdrRange))); }
`;
const WGSL_COMMON = /* wgsl */ `
  struct Look { time: f32, aspect: f32, glow: f32, hdrRange: f32, size: vec2f, wide: f32, radius: f32, linear: f32, _b: f32, _c: f32, _d: f32 }
  @group(0) @binding(0) var<uniform> look: Look;
  const PI = 3.14159265359;
  ${toWgsl(COLOR_CURVES)}
  fn light(c: vec3f) -> vec3f {
    const SRGB_TO_P3 = ${srgbToP3Matrix('wgsl')};
    let l = toLinear(c);
    return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
  }
  ${toWgsl(ELEMENTARY_COLOR_MATHS)}
  fn ballColor(i: i32) -> vec3f { return elementaryColor(f32(i), look.wide); }   // (see colors.js)
  ${toWgsl(SKY, { size: 'look.size' })}
  ${toWgsl(SQUARE_WAVE).trim()}
  ${toWgsl(MODULO)}
  // (Below 0 only beyond P3, Rec. 2020: see ballColor.)
  // (look.linear = 1: drawn as light, not screen colours, into the scene's
  // own picture as its backdrop: see drawPicture in gpu-renderer.js.)
  fn finish(c: vec3f) -> vec4f {
    let clamped = clamp(c, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)));
    return vec4f(select(toScreen(clamped), clamped, look.linear > 0.5), 1.0);
  }
  @vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
    let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
  }
  // (p: counted from the bottom left, as in WebGL.)
  @fragment fn skyFs(@builtin(position) at: vec4f) -> @location(0) vec4f { return finish(sky(vec2f(at.x, look.size.y - at.y))); }
`;
const GL_FULL_VS = /* glsl */ `#version 300 es
  void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  }
`;

// ---- Tunnel: a rollercoaster ride ------------------------------------------------
// A tube of radius 1, fixed in space, laid along a track that is made up as
// the ride goes on, at random (Track below): straights, turns, hills, loops
// and corkscrews, never the same twice. The camera rides along the track,
// heads over heels through the loops, faster downhill, slower uphill.
//
// The shader gets the track near the camera as TRACK_POINTS points, one
// unit apart (where the track's middle line is, and which way is "up" on the
// track there, as the rider feels it), and draws a smooth curve through them
// (Catmull-Rom). The tube is built from triangles along that curve, anew
// each frame in the vertex shader: TUBE_STEPS rings per point, each of
// TUBE_AROUND corners. Drawn as any 3D shape is, with a depth buffer and
// smoothed edges (multisampling), it is right wherever the tube bends or
// folds over itself. The wall's checker is laid out around the middle line,
// measured from the track's "up", so it never twists by itself: a new colour
// every few rings, darker far ahead.
const TRACK_POINTS = 96;
const TRACK_BEHIND = 8;   // points kept behind the camera
const TUBE_STEPS = 4;
const TUBE_AROUND = 48;
const TUBE_RINGS = (TRACK_POINTS - 4) * TUBE_STEPS;   // (from point 1 to point TRACK_POINTS - 3: the curve needs one more on each side)
const TUBE_VERTICES = TUBE_RINGS * TUBE_AROUND * 6;
const NEAR = 0.05, FAR = 120;
const TUNNEL_GL_VS = /* glsl */ `#version 300 es
  precision highp float;
  ${GL_COMMON}
  // (uTrack: the points (x, y, z), then their ups, then (camera, pattern start).)
  uniform highp sampler2D uTrack;
  vec3 trackAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${TRACK_POINTS - 1}), 0), 0).xyz; }
  vec3 upAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${TRACK_POINTS - 1}) + ${TRACK_POINTS}, 0), 0).xyz; }
  vec4 extra() { return texelFetch(uTrack, ivec2(${2 * TRACK_POINTS}, 0), 0); }
  // The middle line at u (in points), and its direction there (not of
  // length 1).
  void trackNear(float u, out vec3 middle, out vec3 slope) {
    int k = int(floor(u));
    float f = u - float(k);
    vec3 a = trackAt(k - 1), b = trackAt(k), c = trackAt(k + 1), d = trackAt(k + 2);
    vec3 c1 = c - a, c2 = 2.0 * a - 5.0 * b + 4.0 * c - d, c3 = 3.0 * b - a - 3.0 * c + d;
    middle = 0.5 * (2.0 * b + (c1 + (c2 + c3 * f) * f) * f);
    slope = 0.5 * (c1 + (2.0 * c2 + 3.0 * c3 * f) * f);
  }
  vec3 upNear(float u, vec3 direction) {
    int k = int(floor(u));
    vec3 up = mix(upAt(k), upAt(k + 1), u - float(k));
    return normalize(up - dot(up, direction) * direction);
  }
  out vec3 vSeen;   // from the eye to the wall
  out vec2 vWall;   // where on the wall: round (in checker squares), along (in points, from the pattern's start)
  void main() {
    // (Two triangles per square of the tube.)
    int quad = gl_VertexID / 6, c = gl_VertexID - 6 * quad;
    vec2 corner = vec2(float(c == 1 || c == 4 || c == 5), float(c == 2 || c == 3 || c == 5));
    int ring = quad / ${TUBE_AROUND}, j = quad - ${TUBE_AROUND} * ring;
    float u = 1.0 + (float(ring) + corner.y) / ${TUBE_STEPS}.0;
    float around = (float(j) + corner.x) / ${TUBE_AROUND}.0;
    vec3 middle, slope;
    trackNear(u, middle, slope);
    vec3 direction = normalize(slope), wallUp = upNear(u, direction);
    vec3 at = middle + cos(2.0 * PI * around) * wallUp + sin(2.0 * PI * around) * cross(direction, wallUp);
    // The camera, on the middle line, looking a little ahead along it.
    vec4 e = extra();
    vec3 eye, there, unused;
    trackNear(e.x, eye, unused);
    trackNear(e.x + 2.5, there, unused);
    vec3 ahead = normalize(there - eye);
    vec3 up = upNear(e.x, ahead), right = cross(ahead, up);
    vec3 seen = at - eye;
    vec3 v = vec3(dot(seen, right), dot(seen, up), dot(seen, ahead));
    float depth = ${FAR}.0 * (v.z - ${NEAR}) / (${FAR}.0 - ${NEAR});
    gl_Position = vec4(1.2 * v.x / uAspect, 1.2 * v.y, 2.0 * depth - v.z, v.z);
    vSeen = seen;
    vWall = vec2(16.0 * around, u + e.y);
  }
`;
const TUNNEL_GL_FS = /* glsl */ `#version 300 es
  precision highp float;
  ${GL_COMMON}
  in vec3 vSeen;
  in vec2 vWall;
  out vec4 outColor;
  // The wall's light: the checker (its edges smoothed over a pixel), a new
  // colour every 4 rings, darker far ahead.
  void main() {
    float t = length(vSeen);
    vec2 blur = 1.5 * SOFTNESS * fwidth(vWall);
    float checker = 0.5 + 0.5 * squareWave(vWall.x, blur.x) * squareWave(vWall.y, blur.y);
    // (Far ahead, where rings get too thin to show, their colours blend into
    // one, instead of flickering.)
    vec3 ring = mix(light(ballColor(int(fmod(floor(vWall.y / 4.0), 4.0)))),
                    0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
                    smoothstep(15.0, 35.0, t));
    vec3 color = mix(vec3(1.0), ring, checker);
    float fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
    outColor = vec4(finish(color * fog * (1.0 + uGlow * 0.3 * fog * fog * fog)), 1.0);
  }
`;
const TUNNEL_WGSL = /* wgsl */ `
  ${WGSL_COMMON}
  @group(0) @binding(1) var<uniform> track: array<vec4f, ${2 * TRACK_POINTS + 1}>;
  fn trackAt(k: i32) -> vec3f { return track[clamp(k, 0, ${TRACK_POINTS - 1})].xyz; }
  fn upAt(k: i32) -> vec3f { return track[clamp(k, 0, ${TRACK_POINTS - 1}) + ${TRACK_POINTS}].xyz; }
  fn extra() -> vec4f { return track[${2 * TRACK_POINTS}]; }
  // (The middle line, then its direction.)
  fn trackNear(u: f32) -> array<vec3f, 2> {
    let k = i32(floor(u));
    let f = u - f32(k);
    let a = trackAt(k - 1);
    let b = trackAt(k);
    let c = trackAt(k + 1);
    let d = trackAt(k + 2);
    let c1 = c - a;
    let c2 = 2.0 * a - 5.0 * b + 4.0 * c - d;
    let c3 = 3.0 * b - a - 3.0 * c + d;
    return array<vec3f, 2>(0.5 * (2.0 * b + (c1 + (c2 + c3 * f) * f) * f), 0.5 * (c1 + (2.0 * c2 + 3.0 * c3 * f) * f));
  }
  fn upNear(u: f32, direction: vec3f) -> vec3f {
    let k = i32(floor(u));
    let up = mix(upAt(k), upAt(k + 1), u - f32(k));
    return normalize(up - dot(up, direction) * direction);
  }
  struct Wall { @builtin(position) at: vec4f, @location(0) seen: vec3f, @location(1) wall: vec2f }
  @vertex fn tunnelVs(@builtin(vertex_index) vertex: u32) -> Wall {
    let quad = vertex / 6u;
    let c = vertex - 6u * quad;
    let corner = vec2f(select(0.0, 1.0, c == 1u || c == 4u || c == 5u), select(0.0, 1.0, c == 2u || c == 3u || c == 5u));
    let ring = quad / ${TUBE_AROUND}u;
    let j = quad - ${TUBE_AROUND}u * ring;
    let u = 1.0 + (f32(ring) + corner.y) / ${TUBE_STEPS}.0;
    let around = (f32(j) + corner.x) / ${TUBE_AROUND}.0;
    let near = trackNear(u);
    let direction = normalize(near[1]);
    let wallUp = upNear(u, direction);
    let at = near[0] + cos(2.0 * PI * around) * wallUp + sin(2.0 * PI * around) * cross(direction, wallUp);
    let e = extra();
    let eye = trackNear(e.x)[0];
    let ahead = normalize(trackNear(e.x + 2.5)[0] - eye);
    let up = upNear(e.x, ahead);
    let right = cross(ahead, up);
    let seen = at - eye;
    let v = vec3f(dot(seen, right), dot(seen, up), dot(seen, ahead));
    var o: Wall;
    o.at = vec4f(1.2 * v.x / look.aspect, 1.2 * v.y, ${FAR}.0 * (v.z - ${NEAR}) / (${FAR}.0 - ${NEAR}), v.z);
    o.seen = seen;
    o.wall = vec2f(16.0 * around, u + e.y);
    return o;
  }
  @fragment fn tunnelFs(w: Wall) -> @location(0) vec4f {
    let t = length(w.seen);
    let blur = 1.5 * SOFTNESS * fwidth(w.wall);
    let checker = 0.5 + 0.5 * squareWave(w.wall.x, blur.x) * squareWave(w.wall.y, blur.y);
    let ring = mix(light(ballColor(i32(fmod(floor(w.wall.y / 4.0), 4.0)))),
                   0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
                   smoothstep(15.0, 35.0, t));
    let color = mix(vec3f(1.0), ring, checker);
    let fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
    return finish(color * fog * (1.0 + look.glow * 0.3 * fog * fog * fog));
  }
`;

// The track, made up as the ride goes on: a point every unit, each with the
// direction the track heads in and which way is "up" on it. It is built in
// pieces, each picked at random: a straight, a turn left or right (banked),
// a hill, a dip, a loop (a full turn upwards, moving sideways so it
// doesn't run into itself), or a corkscrew (rolling over while turning).
// The turning eases in and out, and between pieces the track levels out
// again and rolls back upright.
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => v3.scale(a, 1 / Math.hypot(a[0], a[1], a[2])),
  // a turned by `angle` about the unit axis (Rodrigues' formula).
  turn: (a, axis, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return v3.add(v3.add(v3.scale(a, c), v3.scale(v3.cross(axis, a), s)), v3.scale(axis, v3.dot(axis, a) * (1 - c)));
  },
};
// (Two points of the track this many points apart or more may be shown at
// once, so must be at least CLEARANCE apart: the tube never runs into
// itself.)
const CLEARANCE = 2.4;
const NEAR_POINTS = 12;   // (points nearer than this along the track are neighbours, not a crossing)
class Track {
  constructor() {
    this.points = [];   // { at, up } for points first, first + 1, …
    this.first = 0;
    this.recent = [];   // where the last TRACK_POINTS points are (also those let go)
    this.state = { at: [0, 0, 0], heading: [0, 0, 1], up: [0, 1, 0], rates: [0, 0, 0] };   // rates: turning per unit about up (yaw), the side (pitch), the heading (roll)
    this.piece = { rates: [0, 0, 0], left: 12 };   // (a straight start)
    while (this.points.length < TRACK_POINTS) this.grow();
  }
  pick() {
    const r = Math.random, side = r() < 0.5 ? -1 : 1;
    const kinds = [
      () => ({ rates: [0, 0, 0], left: 6 + 10 * r() }),                                   // straight
      () => ({ rates: [side * (0.12 + 0.14 * r()), 0, side * 0.03], left: 8 + 12 * r() }), // turn, banked
      () => ({ rates: [0, 0.1 + 0.06 * r(), 0], left: 7 + 5 * r(), then: { rates: [0, -0.15, 0], left: 9 } }),   // hill
      () => ({ rates: [0, -(0.1 + 0.06 * r()), 0], left: 7 + 5 * r(), then: { rates: [0, 0.15, 0], left: 9 } }), // dip
      () => ({ rates: [0, 0.26, 0], left: 2 * Math.PI / 0.26, shift: side * 0.2 }),         // loop
      () => ({ rates: [side * 0.06, 0, side * 0.25], left: 2 * Math.PI / 0.25 }),          // corkscrew
    ];
    return kinds[Math.floor(r() * kinds.length)]();
  }
  // One unit further along, turning as the piece says.
  static advance(state, piece) {
    // Ease the turning towards the piece's; when going straight, also level
    // out and roll back upright, so the ride never drifts off for good.
    const goal = [...piece.rates];
    const calm = goal[0] === 0 && goal[1] === 0 && goal[2] === 0;
    if (calm) {
      goal[1] = -0.15 * state.heading[1];
      const side = v3.norm(v3.cross(state.heading, [0, 1, 0]));
      goal[2] = 0.2 * v3.dot(state.up, side);
    }
    for (let k = 0; k < 3; k++) state.rates[k] += (goal[k] - state.rates[k]) * 0.35;
    const side = v3.cross(state.heading, state.up);
    state.heading = v3.turn(state.heading, state.up, -state.rates[0]);
    state.heading = v3.turn(state.heading, side, state.rates[1]);
    state.up = v3.norm(v3.turn(v3.turn(state.up, side, state.rates[1]), state.heading, state.rates[2]));
    state.heading = v3.norm(state.heading);
    state.up = v3.norm(v3.add(state.up, v3.scale(state.heading, -v3.dot(state.up, state.heading))));
    state.at = v3.add(state.at, state.heading);
    // (A loop also moves sideways as it goes round, smoothly, so its way
    // out passes beside its way in.)
    if (piece.shift) {
      piece.side ??= v3.cross(state.heading, state.up);
      piece.total ??= piece.left + 1;
      state.at = v3.add(state.at, v3.scale(piece.side, piece.shift * Math.sin(Math.PI * (1 - (piece.left + 0.5) / piece.total))));
    }
  }
  // A new piece that keeps clear of the track so far (tried out first, with
  // a straight after it): of a few picked at random, the first that does,
  // else the one that comes least close.
  pickClear() {
    let best = null, bestGap = -1;
    for (let tries = 0; tries < 30; tries++) {
      const piece = this.pick();
      const trial = { at: this.state.at, heading: this.state.heading, up: this.state.up, rates: [...this.state.rates] };
      const path = [];
      let part = { ...piece };
      for (let n = 0; n < 60; n++) {
        if (part.left <= 0) part = part.then ? { ...part.then } : null;
        if (!part) break;
        part.left--;
        Track.advance(trial, part);
        path.push(trial.at);
      }
      const straight = { rates: [0, 0, 0] };
      for (let n = 0; n < 10; n++) { Track.advance(trial, straight); path.push(trial.at); }
      // (Squared distances; a try stops as soon as it comes closer than the
      // best one so far.)
      const recent = this.recent, before = recent.length, at = (k) => (k < before ? recent[k] : path[k - before]);
      let gap = Infinity;
      for (let i = before; i < before + path.length && gap > bestGap; i++) {
        const p = at(i);
        for (let j = Math.max(0, i - TRACK_POINTS); j <= i - NEAR_POINTS; j++) {
          const q = at(j), dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
          gap = Math.min(gap, dx * dx + dy * dy + dz * dz);
        }
      }
      if (gap >= CLEARANCE * CLEARANCE) return piece;
      if (gap > bestGap) { best = piece; bestGap = gap; }
    }
    return best;
  }
  grow() {
    if (this.piece.left <= 0) this.piece = this.piece.then ?? this.pickClear();
    this.piece.left--;
    Track.advance(this.state, this.piece);
    this.points.push({ at: this.state.at, up: this.state.up });
    this.recent.push(this.state.at);
    if (this.recent.length > TRACK_POINTS) this.recent.shift();
  }
  // Keep the points from `from` on (and as many ahead as fit).
  moveTo(from) {
    while (this.first < from) { this.points.shift(); this.first++; }
    while (this.points.length < TRACK_POINTS) this.grow();
  }
}
// The ride: where the camera is along the track (in units = points), and how
// fast it goes: faster downhill, slower uphill, as if coasting.
function tunnelRide() {
  const track = new Track();
  const data = new Float32Array(4 * (2 * TRACK_POINTS + 1));
  let along = 2, speed = 8, last = null;
  return {
    data,
    update(seconds) {
      const step = last === null ? 0 : Math.min(0.1, Math.max(0, seconds - last));
      last = seconds;
      const k = Math.floor(along) - track.first;
      const heading = v3.norm(v3.add(track.points[k + 1].at, v3.scale(track.points[k].at, -1)));
      speed = Math.min(16, Math.max(5, speed + (-9 * heading[1] - 0.3 * (speed - 8)) * step));
      along += speed * step;
      track.moveTo(Math.floor(along) - TRACK_BEHIND);
      // (Counted from the first point kept, and from its place: small
      // numbers, so nothing is lost to rounding however long the ride.)
      const origin = track.points[0].at;
      track.points.forEach(({ at, up }, i) => {
        const k = 4 * i, u = 4 * (TRACK_POINTS + i);
        data[k] = at[0] - origin[0]; data[k + 1] = at[1] - origin[1]; data[k + 2] = at[2] - origin[2];
        data[u] = up[0]; data[u + 1] = up[1]; data[u + 2] = up[2];
      });
      data[8 * TRACK_POINTS] = along - track.first;
      data[8 * TRACK_POINTS + 1] = track.first % 16;
    },
  };
}

// ---- Vector bobs ---------------------------------------------------------------
// BOBS balls, each drawn as a small square that faces the camera and shows
// a shaded ball. Every six seconds or so they fly from a cube (a 6 × 6 grid on
// each face) to a sphere (spread evenly: a Fibonacci spiral) and back, a
// little scattered on the way, spaced so the balls never touch.
// A wide picture (full screen, or the window dragged wide) has room for more
// of them, as for the Twist: one group per COPY_WIDTH of width (measured in
// heights of the picture), each COPY_DELAY seconds behind its left
// neighbour, with the colours in another order.
const BOBS = 216;
// (How long each shape lasts, flying over included: 2π seconds, so that a
// hundred of them fill EFFECT_PERIOD exactly: see twist.js.)
const BOB_CHANGE = 2 * Math.PI;
const COPY_WIDTH = 0.75;
const COPY_DELAY = 1.5;
const MAX_COPIES = 8;
const bobCopies = (aspect) => Math.min(MAX_COPIES, Math.max(1, Math.floor(aspect / COPY_WIDTH)));
const BOBS_GL_VS = `#version 300 es
  precision highp float;
  uniform float uTime, uAspect, uRadius;
  out vec2 vCorner;
  flat out int vColor;
  const float PI = 3.14159265359;
  ${toGlsl(MODULO)}
  ${toGlsl(BOB_SHAPES, { count: BOBS + '.0' })}
  void main() {
    vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float copies = min(${MAX_COPIES}.0, max(1.0, floor(uAspect / ${COPY_WIDTH})));
    float copy = floor(float(gl_InstanceID) / ${BOBS}.0), i = float(gl_InstanceID) - ${BOBS}.0 * copy;
    float time = uTime - ${COPY_DELAY} * copy;
    float phase = time / ${BOB_CHANGE};
    float f = smoothstep(0.6, 1.0, fract(phase));
    vec3 scatter = vec3(sin(i * 12.9898), sin(i * 78.233), sin(i * 37.719)) * 0.35 * sin(PI * f);
    vec3 p = fmod(floor(phase), 2.0) < 0.5 ? mix(cube(i), sphere(i), f) : mix(sphere(i), cube(i), f);
    p += scatter;
    float ay = 0.6 * time, ax = 0.3 + 0.4 * sin(0.4 * time);
    p = vec3(cos(ay) * p.x + sin(ay) * p.z, p.y, -sin(ay) * p.x + cos(ay) * p.z);
    p = vec3(p.x, cos(ax) * p.y - sin(ax) * p.z, sin(ax) * p.y + cos(ax) * p.z);
    // (Each group as big as fits its share of the width, at most the whole
    // height; side by side.)
    float size = min(1.0, uAspect / copies / 1.25);
    vec3 v = p * size + vec3(corner * uRadius * size, -3.4);
    float w = -v.z;
    float depth = clamp((w - 1.5) / 4.0, 0.0, 1.0);
    float shift = ((copy + 0.5) / copies * 2.0 - 1.0) * w;
    gl_Position = vec4(v.x * 2.6 / uAspect + shift, v.y * 2.6, (depth * 2.0 - 1.0) * w, w);
    vCorner = corner;
    vColor = int(fmod(i + copy, 4.0));
  }
`;
const BOBS_GL_FS = `#version 300 es
  precision highp float;
  ${GL_COMMON}
  in vec2 vCorner;
  flat in int vColor;
  out vec4 outColor;
  void main() {
    float r = length(vCorner);
    float alpha = clamp((1.0 - r) / max(fwidth(r) * SOFTNESS, 1e-4) + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec3 n = vec3(vCorner, sqrt(max(0.0, 1.0 - r * r)));
    vec3 toLamp = normalize(vec3(-0.5, 0.7, 0.9));
    float facing = max(0.0, dot(n, toLamp));
    float shine = pow(max(0.0, dot(n, normalize(toLamp + vec3(0.0, 0.0, 1.0)))), 40.0);
    vec3 c = light(ballColor(vColor)) * (0.25 + 0.85 * facing) + vec3(0.45 + uGlow) * shine;
    outColor = vec4(finish(c), alpha);
    // (The smoothed outline is blended over what is behind; only the ball
    // itself, not its outline, hides the balls behind it.)
    gl_FragDepth = alpha >= 0.5 ? gl_FragCoord.z : 1.0;
  }
`;
const SKY_GL_FS = `#version 300 es
  precision highp float;
  ${GL_COMMON}
  out vec4 outColor;
  void main() { outColor = vec4(finish(sky(gl_FragCoord.xy)), 1.0); }
`;
// (The ball's square, drawn as a shaded ball.)
const BOB_FS_WGSL = /* wgsl */ `
  struct Bob { @builtin(position) at: vec4f, @location(0) corner: vec2f, @location(1) @interpolate(flat) color: i32 }
  struct BobOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
  @fragment fn bobFs(b: Bob) -> BobOut {
    let r = length(b.corner);
    let alpha = clamp((1.0 - r) / max(fwidth(r) * SOFTNESS, 1e-4) + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) { discard; }
    let n = vec3f(b.corner, sqrt(max(0.0, 1.0 - r * r)));
    let toLamp = normalize(vec3f(-0.5, 0.7, 0.9));
    let facing = max(0.0, dot(n, toLamp));
    let shine = pow(max(0.0, dot(n, normalize(toLamp + vec3f(0.0, 0.0, 1.0)))), 40.0);
    let c = light(ballColor(b.color)) * (0.25 + 0.85 * facing) + vec3f(0.45 + look.glow) * shine;
    var o: BobOut;
    o.color = vec4f(finish(c).rgb, alpha);
    o.depth = select(1.0, b.at.z, alpha >= 0.5);   // (see the WebGL shader)
    return o;
  }
`;
const BOBS_WGSL = /* wgsl */ `
  ${WGSL_COMMON}
  ${toWgsl(BOB_SHAPES, { count: BOBS + '.0' })}
  @vertex fn bobVs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Bob {
    let corner = vec2f(f32(vertex & 1u), f32(vertex >> 1u)) * 2.0 - 1.0;
    let copies = min(${MAX_COPIES}.0, max(1.0, floor(look.aspect / ${COPY_WIDTH})));
    let copy = floor(f32(instance) / ${BOBS}.0);
    let i = f32(instance) - ${BOBS}.0 * copy;
    let time = look.time - ${COPY_DELAY} * copy;
    let phase = time / ${BOB_CHANGE};
    let f = smoothstep(0.6, 1.0, fract(phase));
    let scatter = vec3f(sin(i * 12.9898), sin(i * 78.233), sin(i * 37.719)) * 0.35 * sin(PI * f);
    var p = select(mix(sphere(i), cube(i), f), mix(cube(i), sphere(i), f), fmod(floor(phase), 2.0) < 0.5) + scatter;
    let ay = 0.6 * time;
    let ax = 0.3 + 0.4 * sin(0.4 * time);
    p = vec3f(cos(ay) * p.x + sin(ay) * p.z, p.y, -sin(ay) * p.x + cos(ay) * p.z);
    p = vec3f(p.x, cos(ax) * p.y - sin(ax) * p.z, sin(ax) * p.y + cos(ax) * p.z);
    let size = min(1.0, look.aspect / copies / 1.25);
    let v = p * size + vec3f(corner * look.radius * size, -3.4);
    let w = -v.z;
    let depth = clamp((w - 1.5) / 4.0, 0.0, 1.0);
    let shift = ((copy + 0.5) / copies * 2.0 - 1.0) * w;
    var o: Bob;
    o.at = vec4f(v.x * 2.6 / look.aspect + shift, v.y * 2.6, depth * w, w);
    o.corner = corner;
    o.color = i32(fmod(i + copy, 4.0));
    return o;
  }
  ${BOB_FS_WGSL}
`;

// (Not bobs: the uniforms the bobs' shaders have, for the other programs.)
const NO_BOBS = { radius: 0 };

// ---- Drawing with WebGL2 ------------------------------------------------------
// (canvas.shared: drawn with the scene's own WebGL instead, into a picture
// of its own, as the backdrop: see sharedPicture in renderer.js. A drawer
// then sets everything it needs each frame, puts it back after (done), and
// deletes what it made when it goes (owned).)
function glBase(canvas, antialias) {
  const shared = canvas.shared;
  const gl = shared ? shared.gl : canvas.getContext('webgl2', { antialias });
  if (!gl) return null;
  let convert = 0;
  const locations = new Map();   // program → its uniforms' places (looked up once)
  const owned = [];              // (what to delete when sharing: [kind, thing])
  return {
    gl, owned,
    setLook(wide) {
      const space = wide ? 'display-p3' : 'srgb';
      if (!shared && 'drawingBufferColorSpace' in gl && gl.drawingBufferColorSpace !== space) gl.drawingBufferColorSpace = space;
      convert = wide && 'drawingBufferColorSpace' in gl && onP3Screen() ? 1 : 0;
    },
    // The uniforms every program here has (those it uses).
    setUniforms(program, seconds, width, height, bobs = NO_BOBS) {
      const known = locations.get(program) ?? locations.set(program, new Map()).get(program);
      const u = (name) => known.get(name) ?? known.set(name, gl.getUniformLocation(program, name)).get(name);
      gl.uniform1f(u('uTime'), effectTime(seconds));
      gl.uniform1f(u('uAspect'), width / height);
      gl.uniform2f(u('uSize'), width, height);
      gl.uniform1f(u('uGlow'), 0);
      gl.uniform1f(u('uHdrRange'), 1);
      gl.uniform1f(u('uWide'), convert);
      gl.uniform1f(u('uRadius'), bobs.radius);
    },
    size(width, height) {
      if (shared) shared.begin(width, height, antialias);
      else if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    },
    done() {
      if (!shared) return;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      shared.end();
    },
    dispose() {
      if (!shared) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
      for (const [kind, thing] of owned) gl[kind](thing);
    },
  };
}
// The tunnel. (ride: numbers worked out anew for each frame —
// ride.update(seconds) — and given to the shader as ride.data, a row of
// four-number texels in the texture uTrack: the track.)
function glTunnelDrawer(canvas, ride) {
  const base = glBase(canvas, samples() > 1);
  if (!base) return null;
  const { gl } = base;
  const program = createProgram(gl, TUNNEL_GL_VS, TUNNEL_GL_FS);
  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  base.owned.push(['deleteProgram', program], ['deleteVertexArray', vao], ['deleteTexture', texture]);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, ride.data.length / 4, 1);
  // (Floats can't be blended between texels everywhere; read as they are.)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return {
    setLook: base.setLook, dispose: base.dispose,
    draw(seconds, width, height) {
      base.size(width, height);
      gl.bindVertexArray(vao);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      base.setUniforms(program, seconds, width, height);
      ride.update(seconds);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ride.data.length / 4, 1, gl.RGBA, gl.FLOAT, ride.data);
      gl.uniform1i(gl.getUniformLocation(program, 'uTrack'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, TUBE_VERTICES);
      base.done();
    },
  };
}
// (bobs: { radius }: how big the balls are.)
function glBobsDrawer(canvas, bobs) {
  const base = glBase(canvas, false);
  if (!base) return null;
  const { gl } = base;
  const sky = createProgram(gl, GL_FULL_VS, SKY_GL_FS);
  const balls = createProgram(gl, BOBS_GL_VS, BOBS_GL_FS);
  const vao = gl.createVertexArray();
  base.owned.push(['deleteProgram', sky], ['deleteProgram', balls], ['deleteVertexArray', vao]);
  return {
    setLook: base.setLook, dispose: base.dispose,
    draw(seconds, width, height) {
      base.size(width, height);
      gl.bindVertexArray(vao);
      // (The picture's own alpha stays 1: less would let the page show
      // through the window, or brighten the colours when copied.)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(sky);
      base.setUniforms(sky, seconds, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);   // (the balls' smoothed outlines)
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(balls);
      base.setUniforms(balls, seconds, width, height, bobs);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, BOBS * bobCopies(width / height));
      base.done();
    },
  };
}

// ---- Drawing with WebGPU ------------------------------------------------------
// (ride: as for glTunnelDrawer; in WGSL, a uniform array at binding 1.)
function gpuBase(canvas, device, code, ride = null) {
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const module = device.createShaderModule({ code: sharpen(code) });
  const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const uniforms = device.createBuffer({ size: 48, usage });
  const rideBuffer = ride && device.createBuffer({ size: ride.data.byteLength, usage });
  const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility, buffer: {} },
    ...(ride ? [{ binding: 1, visibility, buffer: {} }] : [])] });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniforms } },
    ...(ride ? [{ binding: 1, resource: { buffer: rideBuffer } }] : [])] });
  const numbers = new Float32Array(12);
  let shownAs = null, convert = 0;
  const configure = (wide, hdr) => {
    const as = `${wide} ${hdr}`;
    if (as === shownAs) return;
    shownAs = as;
    context.configure({
      device, format: GPU_FORMAT, alphaMode: 'opaque',
      colorSpace: wide ? 'display-p3' : 'srgb',
      toneMapping: { mode: hdr ? 'extended' : 'standard' },
    });
  };
  return {
    context, module, group,
    pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    // (convert: 0 = sRGB, 1 = Display P3, 2 = and the ball colours as far as
    // Rec. 2020, with HDR on a screen that shows about that much: see
    // colourLevel in gpu-renderer.js.)
    setLook(wide, hdr) { configure(wide, hdr); convert = !(wide && onP3Screen()) ? 0 : hdr && onRec2020Screen() ? 2 : 1; },
    begin(seconds, width, height, glow, bobs = NO_BOBS) {
      if (!shownAs) configure(true, false);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      numbers.set([effectTime(seconds), width / height, glow, glow > 0 ? HDR_RANGE : 1, width, height, convert,
        bobs.radius, canvas.linear ? 1 : 0, 0, 0, 0]);
      device.queue.writeBuffer(uniforms, 0, numbers);
      if (ride) {
        ride.update(seconds);
        device.queue.writeBuffer(rideBuffer, 0, ride.data);
      }
    },
    dispose() { uniforms.destroy(); rideBuffer?.destroy(); context.unconfigure(); },
  };
}
// The tunnel: smoothed edges by multisampling (four samples a pixel).
// (As the backdrop, it is drawn in a pass of its own first, then the scene
// over it; see drawPicture in gpu-renderer.js. Drawing it inside the
// scene's own pass instead, to save writing its picture out and reading it
// back in, was tried in 2.04-326 and measured on an Apple M-series Mac at
// 3338 × 2410: some 2.5 ms a frame slower, not faster, for the Tunnel and
// the Vector Bobs alike, drawn before the balls' depth or after.)
function gpuTunnelDrawer(canvas, device, ride) {
  const base = gpuBase(canvas, device, TUNNEL_WGSL, ride);
  if (!base) return null;
  const SAMPLES = samples();
  const pipeline = device.createRenderPipeline({
    layout: base.pipelineLayout,
    vertex: { module: base.module, entryPoint: 'tunnelVs' },
    fragment: { module: base.module, entryPoint: 'tunnelFs', targets: [{ format: GPU_FORMAT }] },
    depthStencil: { format: 'depth24plus', depthCompare: 'less', depthWriteEnabled: true },
    multisample: { count: SAMPLES },
  });
  let targets = null;
  const dropTargets = () => { targets?.color?.destroy(); targets?.depth.destroy(); targets = null; };
  return {
    setLook: base.setLook,
    dispose() { dropTargets(); base.dispose(); },
    draw(seconds, width, height, glow) {
      base.begin(seconds, width, height, glow);
      if (!targets || targets.width !== width || targets.height !== height) {
        dropTargets();
        const make = (format) => device.createTexture({ size: [width, height], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        targets = { width, height, color: SAMPLES > 1 ? make(GPU_FORMAT) : null, depth: make('depth24plus') };
        targets.colorView = targets.color?.createView();
        targets.depthView = targets.depth.createView();
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [colorTarget(targets.colorView, base.context.getCurrentTexture().createView())],
        depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        timestampWrites: this.timestampWrites,   // (as a backdrop, while the frame is timed: see drawPicture in gpu-renderer.js)
      });
      pass.setBindGroup(0, base.group);
      pass.setPipeline(pipeline);
      pass.draw(TUBE_VERTICES);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
// (No multisampling: the balls' outlines are smoothed in the shader and
// blended, which costs far less on a big screen.)
function gpuBobsDrawer(canvas, device, bobs) {
  const base = gpuBase(canvas, device, BOBS_WGSL);
  if (!base) return null;
  const depthStencil = (depthCompare, depthWriteEnabled) => ({ format: 'depth24plus', depthCompare, depthWriteEnabled });
  const sky = device.createRenderPipeline({
    layout: base.pipelineLayout,
    vertex: { module: base.module, entryPoint: 'fullVs' },
    fragment: { module: base.module, entryPoint: 'skyFs', targets: [{ format: GPU_FORMAT }] },
    depthStencil: depthStencil('always', false),
  });
  const blend = { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' };
  const balls = device.createRenderPipeline({
    layout: base.pipelineLayout,
    vertex: { module: base.module, entryPoint: 'bobVs' },
    fragment: { module: base.module, entryPoint: 'bobFs', targets: [{ format: GPU_FORMAT, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip' },
    depthStencil: depthStencil('less', true),
  });
  let depth = null;
  return {
    setLook: base.setLook,
    dispose() { depth?.texture.destroy(); base.dispose(); },
    draw(seconds, width, height, glow) {
      base.begin(seconds, width, height, glow, bobs);
      if (!depth || depth.width !== width || depth.height !== height) {
        depth?.texture.destroy();
        const texture = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        depth = { width, height, texture, view: texture.createView() };
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: base.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        timestampWrites: this.timestampWrites,   // (see drawPicture in gpu-renderer.js)
      });
      pass.setBindGroup(0, base.group);
      pass.setPipeline(sky);
      pass.draw(3);
      pass.setPipeline(balls);
      pass.draw(4, BOBS * bobCopies(width / height));
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}

// ---- The effects, as the Controls' buttons open them ----------------------------
const open = (title, gpu, gl) => () => openEffectWindow(title, WIDTH, HEIGHT,
  (canvas) => (twistOptions.device && gpu(canvas, twistOptions.device)) || gl(canvas));
const VECTOR_BOBS = { radius: 0.05 };
const bobsEffect = (title, bobs) => open(title,
  (canvas, device) => gpuBobsDrawer(canvas, device, bobs), (canvas) => glBobsDrawer(canvas, bobs));

export const EFFECTS = [
  { label: 'Vector Bobs', short: 'Bobs', open: bobsEffect('Vector Bobs', VECTOR_BOBS) },
  { label: 'Tunnel', open: open('Tunnel', (canvas, device) => gpuTunnelDrawer(canvas, device, tunnelRide()),
    (canvas) => glTunnelDrawer(canvas, tunnelRide())) },
];

// (For testing: the drawers themselves.)
export const effectDrawers = {
  bobs: { gpu: (c, d) => gpuBobsDrawer(c, d, VECTOR_BOBS), gl: (c) => glBobsDrawer(c, VECTOR_BOBS) },
  tunnel: { gpu: (c, d) => gpuTunnelDrawer(c, d, tunnelRide()), gl: (c) => glTunnelDrawer(c, tunnelRide()) },
  tunnelRide,
};
