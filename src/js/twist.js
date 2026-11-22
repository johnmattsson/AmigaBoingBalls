// =============================================================================
// twist.js — the "Twist" window: a classic Amiga demo effect in modern 3D.
//
// THE CLASSIC EFFECT
// A "twister" is a tall bar with a square cross-section that looks as if it
// is being wrung like a wet towel: every height of the bar is turned by a
// different angle, and the angles change all the time. On the Amiga this was
// a trick: the bar was never really 3D. For each screen line the demo only
// worked out where the four edges of the square would be at that line's
// angle (four sine values) and filled the gaps between them with colour.
//
// THIS VERSION
// Here the bar is a real 3D shape. It is cut into thin slices; each slice is
// a square, turned by the angle for its height. Joining the slices gives a
// smoothly twisted surface, which is then drawn with what the Amiga could
// only fake: perspective, a lamp with a shiny highlight, smoothed edges —
// and the Boing Balls' checker pattern on its four sides.
//
// The window has its own small canvas, separate from the main scene, and
// only draws while it is open: with WebGPU where the main scene uses it (the
// same graphics card connection; HDR goes straight onto the canvas, as in
// the scene: see createGpuDrawer), else with WebGL2 (see createDrawer).
// =============================================================================

import { showWindow, keepInView } from './gui.js';
import { twistOptions, samples, effectLook } from './effect-options.js';
export { twistOptions, samples, effectLook };
import { toGlsl, toWgsl, SQUARE_WAVE, COLOR_CURVES } from './shade.js';
import { HDR_RANGE } from './gpu-renderer.js';
import { onP3Screen, onRec2020Screen } from './renderer.js';

// Set by main.js from the Controls (the window follows changes at once):
//   device – the WebGPU device the main scene draws with (null: WebGL)
//   hdr  – show it on an HDR screen (WebGPU only)
//   glow – with HDR, the shiny highlight gets brighter than white
//   strength – how much brighter (the HDR setting)
//   wide – wide colour (Display P3), as in the scene
//   onFullScreen(on) – called when the twist goes full screen and back
//                      (main.js pauses the balls meanwhile)
// The effects repeat exactly after this many seconds (200π, about ten and a
// half minutes): every motion in them turns a whole number of times in it.
// So the time the shaders get starts again from 0 after each period (see
// effectTime), and stays precise however long a window stays open (the
// graphics card's numbers would otherwise grow too coarse after a day or
// so, and the motion jerky).
export const EFFECT_PERIOD = 200 * Math.PI;
const EFFECT_PIXELS = 3840 * 2160;   // the most pixels an effect window draws (see setSize in openEffectWindow)
const EFFECT_SIDE = 8192;            // ... and the most across or down
export const effectTime = (seconds) => ((seconds % EFFECT_PERIOD) + EFFECT_PERIOD) % EFFECT_PERIOD;

// THE TWIST, as maths (in the notation of shade.js, for both renderers):
// by what angle is the bar turned at height y (-1 … 1), at time t?
//   - the whole bar turns steadily,
//   - it is wrung, more at the ends than in the middle, back and forth,
//   - and a ripple travels along it.
// The bar also sways gently from side to side, like a snake (swayAt). And
// how fast the two change with height (their derivatives), needed to work
// out which way the twisted surface faces, for the lighting.
const TWIST_SHAPE = `
  fn angleAt(y: f32, t: f32) -> f32 {
    return 0.6 * t
         + 2.4 * sin(0.53 * t) * y
         + 0.7 * sin(2.6 * y + 1.3 * t);
  }
  fn swayAt(y: f32, t: f32) -> f32 { return 0.16 * sin(1.7 * y + 0.9 * t); }
  fn angleSlopeAt(y: f32, t: f32) -> f32 { return 2.4 * sin(0.53 * t) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * t); }
  fn swaySlopeAt(y: f32, t: f32) -> f32 { return 0.16 * 1.7 * cos(1.7 * y + 0.9 * t); }`;

const GLOW = 2.5;   // extra highlight light with HDR
// How much of it right now (0 without HDR): for whoever draws an effect.
// Pixel size (see Pixel size in settings.js) for the effect windows too:
// fewer real pixels, each shown as a hard-edged square. (The open windows'
// setSize, so a change shows at once.)
// With big pixels the effects are drawn sharp too, as the balls are: no
// smoothed edges (twistOptions.sharp: see sharpen), each pixel one colour.
let effectPixelSize = 1;
const openWindowSizes = new Set();
export function setEffectPixelSize(size) {
  if (size === effectPixelSize) return;
  effectPixelSize = size;
  twistOptions.sharp = size > 1;
  for (const resize of openWindowSizes) resize();
}
// The effects' shaders smooth their edges over about a pixel, times
// SOFTNESS; drawn sharp, that is next to nothing. (Made when a drawer is:
// a drawer is made anew when twistOptions.sharp changes. Sharp drawers
// also draw without multisampling: see samples.)
export const sharpen = (source) => source.replaceAll('SOFTNESS', twistOptions.sharp ? '0.001' : '1.0');
// (The pass's colour: into the multisampled picture, then resolved onto
// the canvas; or, with one sample, straight onto the canvas.)
export const colorTarget = (multi, canvasView) => (multi
  ? { view: multi, resolveTarget: canvasView, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }
  : { view: canvasView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] });

export const effectGlow = () => (twistOptions.hdr && twistOptions.glow ? GLOW * twistOptions.strength : 0);

const SLICES = 960;           // how many thin slices the bar is cut into (each is flat, so a checker line bends slightly at every seam: with fewer, that showed as a fine sawtooth)
// Each side is a strip: SLICES + 1 pairs of corners (on its left and right
// edge) up the bar, each worked out once, and an index list that makes
// 2 triangles of every slice. (Which corner is which: see the bar shader.)
const CORNERS_PER_SIDE = 2 * (SLICES + 1);
const INDEX_COUNT = 4 * SLICES * 6;   // 4 sides × slices × 2 triangles of 3 corners
function barIndices() {
  const out = new Uint32Array(INDEX_COUNT);
  let at = 0;
  for (let side = 0; side < 4; side++) {
    for (let slice = 0; slice < SLICES; slice++) {
      const leftBottom = side * CORNERS_PER_SIDE + 2 * slice, rightBottom = leftBottom + 1;
      const leftTop = leftBottom + 2, rightTop = leftBottom + 3;
      out.set([leftBottom, rightBottom, rightTop, leftBottom, rightTop, leftTop], at);
      at += 6;
    }
  }
  return out;
}
// (The sides are only seen from outside: their backs are skipped. Seen from
// outside, each triangle's corners run clockwise.)

// The size of the picture when the window opens, in CSS pixels. (Drag the
// gadget in the window's bottom-right corner to change it.)
const WIDTH = 340;
const HEIGHT = 440;

// MORE TWISTS ON A WIDE PICTURE. One twist fits the window; a wide picture
// (full screen, or a window dragged wide) has room for more: as many as
// fit at the same size, one per TWIST_SPACING of width (measured in heights
// of the picture): 1 in the window, 2 on a 4:3 screen, 3 on 16:10 and 16:9, 4 on an
// ultrawide. Each one is TWIST_DELAY seconds behind its left neighbour, so
// the wringing runs across the screen like a wave, and has the colours in
// another order.
const TWIST_SPACING = 0.5;
const TWIST_DELAY = 0.4;

// The bar's vertex shader. No shape is uploaded at all: every corner works
// out its own position from its number (gl_VertexID).
const BAR_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;

  uniform float uTime;      // seconds since the window opened
  uniform float uAspect;    // width ÷ height of the picture
  // Several twists side by side (see TWIST_SPACING): where this one stands
  // (sideways, in screen units: -1 … 1 is the whole width), and how many
  // seconds it lags behind the first one.
  uniform float uShift;
  uniform float uDelay;

  float time;               // this twist's own time: uTime - uDelay

  out vec3 vPosition;       // where this point is in the world
  out vec3 vNormal;         // which way the surface faces there
  out vec2 vPattern;        // position on its side: x across (0 … 1), y along the bar
  flat out int vSide;       // which of the four sides (0 … 3)

  const float PI = 3.14159265359;
  const float SLICES = ${SLICES}.0;
  const float HALF_HEIGHT = 1.45;   // the bar reaches from -1.45 to +1.45
  const float RADIUS = 0.46;        // from the bar's centre line to its edges

  ${toGlsl(TWIST_SHAPE)}

  // One edge of the bar at height y: where it is, and which way it runs
  // (how its position changes when y grows). 'edge' counts the four edges.
  void edgeAt(float y, int edge, out vec3 position, out vec3 direction) {
    // The square's corners sit at 45°, 135°, 225° and 315°, plus the twist.
    float angle = PI / 4.0 + float(edge) * PI / 2.0 + angleAt(y, time);
    position  = vec3(RADIUS * cos(angle) + swayAt(y, time), y * HALF_HEIGHT, RADIUS * sin(angle));
    direction = vec3(-RADIUS * sin(angle) * angleSlopeAt(y, time) + swaySlopeAt(y, time), HALF_HEIGHT,
                      RADIUS * cos(angle) * angleSlopeAt(y, time));
  }

  void main() {
    time = uTime - uDelay;

    // Which corner is this? Its side, and along that side's strip: which
    // pair up the bar, and the left or the right one (see barIndices).
    vSide = gl_VertexID / ${CORNERS_PER_SIDE};
    int along = gl_VertexID - vSide * ${CORNERS_PER_SIDE};
    bool right = (along & 1) == 1;
    float y = (float(along >> 1) / SLICES) * 2.0 - 1.0;   // -1 … 1 along the bar

    // A side is the surface stretched between two neighbouring edges.
    vec3 leftEdge, leftDirection, rightEdge, rightDirection;
    edgeAt(y, vSide, leftEdge, leftDirection);
    edgeAt(y, vSide + 1, rightEdge, rightDirection);
    vPosition = right ? rightEdge : leftEdge;
    vPattern = vec2(float(right), y);

    // The surface faces at right angles to two directions that lie in it:
    // along the edge here, and straight across to the other edge.
    vNormal = cross(right ? rightDirection : leftDirection, rightEdge - leftEdge);

    // A simple camera: straight in front, 4.4 units back, with perspective
    // (things further away are drawn smaller: divide by the distance).
    const float CAMERA_DISTANCE = 4.4;
    const float ZOOM = 2.6;          // bigger = narrower view
    float distance = CAMERA_DISTANCE - vPosition.z;
    gl_Position = vec4(vPosition.x * ZOOM / uAspect + uShift * distance, vPosition.y * ZOOM,
                       (vPosition.z * -0.2) * distance,    // only used to decide what is in front
                       distance);
  }
`;

const BAR_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;

  in vec3 vPosition;
  in vec3 vNormal;
  in vec2 vPattern;
  flat in int vSide;
  out vec4 outColor;
  uniform int uColorTurn;   // each twist has the colours in another order

  // The four sides have the four Boing Ball colours.
  const vec3 SIDE_COLORS[4] = vec3[4](
    vec3(0.769, 0.008, 0.200),   // red
    vec3(0.000, 0.624, 0.420),   // green
    vec3(0.000, 0.529, 0.741),   // blue
    vec3(1.000, 0.827, 0.000));  // yellow
  // (On a wide-colour screen: as P3 shows them, see ELEMENTARY_IN_P3.)
  const vec3 SIDE_COLORS_P3[4] = vec3[4](
    vec3( 0.8242, -0.1608,  0.1756),
    vec3(-0.3157,  0.6472,  0.3911),
    vec3(-0.2504,  0.5236,  0.7784),
    vec3( 1.0176,  0.8609, -0.3058));

  // Screen colour ↔ linear light (see "Linear light" in shaders.js), and
  // linear sRGB light → linear Display P3 light, for a wide-colour screen
  // (uWide = 1: see SRGB_TO_P3 and ELEMENTARY_IN_P3 in renderer.js).
  uniform float uWide;
  ${toGlsl(COLOR_CURVES)}
  vec3 toCanvas(vec3 linear) {
    const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
                                 0.1775380, 0.9668058, 0.0723974,
                                 0.0,       0.0,       0.9105199);
    return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
  }

  // A smoothed square wave, the same as on the balls (see SQUARE_WAVE in shade.js).${toGlsl(SQUARE_WAVE)}

  void main() {
    // ---- Checker pattern: 2 squares across each side, 9 along the bar.
    vec2 square = vec2(vPattern.x * 2.0, (vPattern.y * 0.5 + 0.5) * 9.0);
    vec2 blur = fwidth(square) * SOFTNESS;
    float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
    int side = (vSide + uColorTurn) % 4;
    vec3 color = mix(vec3(1.0), uWide > 0.5 ? SIDE_COLORS_P3[side] : SIDE_COLORS[side], checker);

    // ---- Which way does the surface face here? (Worked out at the corners
    // by the vertex shader and blended smoothly in between.)
    vec3 normal = normalize(vNormal);
    vec3 toCamera = normalize(vec3(0.0, 0.0, 4.4) - vPosition);
    if (dot(normal, toCamera) < 0.0) normal = -normal;   // make it point towards us

    // ---- Lighting from a lamp up to the left, in front.
    vec3 toLamp = normalize(vec3(-0.5, 0.7, 0.9));
    float facing = max(0.0, dot(normal, toLamp));            // 1 = facing the lamp squarely
    // The shiny highlight: strongest where the surface mirrors the lamp
    // straight into the camera.
    vec3 halfway = normalize(toLamp + toCamera);
    float shine = pow(max(0.0, dot(normal, halfway)), 48.0);

    vec3 lit = toCanvas(toLinear(color)) * (0.25 + 0.85 * facing) + vec3(0.45) * shine;
    outColor = vec4(toScreen(clamp(lit, 0.0, 1.0)), 1.0);
  }
`;

// The backdrop: a smooth night-blue gradient, drawn by
// one big triangle that covers the whole picture.
const BACKDROP_VERTEX_SHADER = /* glsl */ `#version 300 es
  void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  }
`;
const BACKDROP_FRAGMENT_SHADER = /* glsl */ `#version 300 es
  precision highp float;
  uniform float uHeight;
  out vec4 outColor;
  // Screen colour ↔ linear light (see "Linear light" in shaders.js), and
  // linear sRGB light → linear Display P3 light, for a wide-colour screen
  // (uWide = 1: see SRGB_TO_P3 and ELEMENTARY_IN_P3 in renderer.js).
  uniform float uWide;
  ${toGlsl(COLOR_CURVES)}
  vec3 toCanvas(vec3 linear) {
    const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
                                 0.1775380, 0.9668058, 0.0723974,
                                 0.0,       0.0,       0.9105199);
    return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
  }
  void main() {
    // A smooth night-blue gradient.
    vec3 color = mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), gl_FragCoord.y / uHeight);
    outColor = vec4(uWide > 0.5 ? toScreen(max(toCanvas(toLinear(color)), 0.0)) : color, 1.0);
  }
`;


// Is the Guru Meditation on screen (see main.js)?
const guruShownNow = () => document.getElementById('guru') !== null;

// Open the Twist window (called by the button in the settings panel).
export function openTwistWindow() {
  openEffectWindow('Twist v4', WIDTH, HEIGHT,
    (canvas) => (twistOptions.device && createGpuDrawer(canvas, twistOptions.device)) || createDrawer(canvas));
}

// A demo effect in a window of its own: the Twist, and those in effects.js.
// makeDrawer(canvas) gives { setLook(wide, hdr), draw(seconds, width,
// height, glow), dispose() }, or null. Each button opens another window, as
// many as wanted, each running by itself.
export function openEffectWindow(title, WIDTH, HEIGHT, makeDrawer) {
  let canvas = document.createElement('canvas');
  canvas.className = 'twist-canvas';
  // The canvas sits in a frame of its own, which is what goes full screen.
  const frame = document.createElement('div');
  frame.className = 'twist-frame';
  frame.append(canvas);

  // The drawing: with WebGPU where the main scene draws with it, else WebGL.
  // (drawnWith: the WebGPU device it draws with, or null for WebGL.)
  let drawer = makeDrawer(canvas);
  if (!drawer) return;
  let drawnWith = twistOptions.device, drawnLook = effectLook();

  // Set the picture's size on screen, and with it the number of real
  // pixels it is drawn with (twice as many on sharp "retina" screens).
  let shownSize = [WIDTH, HEIGHT];
  const setSize = (width, height) => {
    shownSize = [width, height];
    // (At most EFFECT_PIXELS in all, and never wider or higher than the
    // graphics card can draw: full screen on an 8K screen is 33 million
    // pixels, and the smoothed edges' four samples a pixel would need over a
    // gigabyte of memory. There, a 4K picture is drawn and the browser
    // scales it up: on such a screen its pixels are too small to tell.)
    // (Big pixels: as in the main scene, a whole number of the screen's
    // own; see bigPixel in renderer.js.)
    const screenRatio = window.devicePixelRatio || 1;
    const big = effectPixelSize > 1 ? Math.max(1, Math.round(effectPixelSize * screenRatio)) / screenRatio : 0;
    const pixelRatio = Math.min(big ? 1 / big : screenRatio, 2, Math.sqrt(EFFECT_PIXELS / Math.max(1, width * height)),
      EFFECT_SIDE / Math.max(1, width), EFFECT_SIDE / Math.max(1, height));
    canvas.style.imageRendering = big ? 'pixelated' : '';
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
  };
  setSize(WIDTH, HEIGHT);
  const resize = () => setSize(...shownSize);
  openWindowSizes.add(resize);

  // Should the main scene change how it draws meanwhile (WebGPU stopped, or
  // boing.drawWith), the window follows: a fresh canvas (one that has
  // drawn with WebGPU can't take WebGL, nor the other way round) and a new
  // drawer, at the same size. (Drawing on with a device that is gone would
  // only leave the picture frozen.)
  const redraw = () => {
    drawer.dispose();
    const fresh = document.createElement('canvas');
    fresh.className = canvas.className;
    fresh.style.cssText = canvas.style.cssText;
    fresh.width = canvas.width;
    fresh.height = canvas.height;
    canvas.replaceWith(fresh);
    canvas = fresh;
    drawnWith = twistOptions.device;
    drawnLook = effectLook();
    drawer = makeDrawer(canvas) ?? { setLook() {}, draw() {}, dispose() {} };
  };

  // Only drawn while it can be seen: not while the window is dragged off
  // the screen (or the page hidden, when the browser stops all of this
  // anyway).
  let onScreen = true;
  const watch = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; }) : null;
  watch?.observe(frame);
  let running = true;
  const startTime = performance.now();

  function drawFrame(now) {
    if (!running) return;
    requestAnimationFrame(drawFrame);
    // (Behind the Guru Meditation, which covers everything, nothing is drawn.)
    if (guruShownNow() || !onScreen) return;
    if (twistOptions.device !== drawnWith || effectLook() !== drawnLook) redraw();
    const seconds = (now - startTime) / 1000;
    drawer.setLook(twistOptions.wide, twistOptions.hdr);
    const glow = effectGlow();
    drawer.draw(seconds, canvas.width, canvas.height, glow);
  }
  requestAnimationFrame(drawFrame);

  // Full screen: the zoom gadget in the title bar, or a double-click on the
  // twist itself, shows just the twist on the whole screen, without title
  // bar or borders, drawn with all of the screen's pixels. Escape (or
  // another double-click) brings the window back, at the size it had.
  // (Only where the browser can do it.)
  const fullScreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
  const canFullScreen = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  let windowSize = [WIDTH, HEIGHT];
  //
  // When the page itself is already full screen, the twist instead covers
  // the whole page (which then is the whole screen): Safari doesn't let one
  // part of a full-screen page go full screen by itself. Its frame is moved
  // to the top of the page meanwhile, above every other window, and put back
  // afterwards; leaving the page's full screen ends it too.
  let covering = null;   // while covering: where the frame belongs in its window
  let full = false;      // full screen (either way)?
  const setFull = (on) => {
    if (on === full) return;
    full = on;
    twistOptions.onFullScreen?.(on);
  };
  // (Afterwards the window goes back to its own place: see keepInView in
  // gui.js, which also runs after each resize.)
  // The browser may still be animating out of full screen, so this is done
  // again a little later, once the page has its final size; and the page is
  // scrolled back to the top, should leaving full screen have scrolled it.
  // Where the window was, just before going full screen: it comes back
  // exactly there (and that is its place from then on).
  let placeBefore = null;
  const notePlace = () => {
    const w = frame.closest('.window');
    placeBefore = w ? { left: parseFloat(w.style.left) || w.offsetLeft, top: parseFloat(w.style.top) || w.offsetTop } : null;
  };
  const placeBack = () => {
    const w = frame.closest('.window');
    if (!w) return;
    if (placeBefore) {
      w.dataset.left = placeBefore.left;
      w.dataset.top = placeBefore.top;
      placeBefore = null;
    }
    const again = () => {
      if (!frame.isConnected || full) return;
      document.scrollingElement?.scrollTo(0, 0);
      keepInView(w);
    };
    again();
    requestAnimationFrame(again);
    setTimeout(again, 250);
    setTimeout(again, 1000);
  };
  const cover = (on) => {
    if (on) {
      covering = { parent: frame.parentNode, next: frame.nextSibling };
      document.body.append(frame);
      frame.classList.add('twist-cover');
      setSize(innerWidth, innerHeight);
      setFull(true);
    } else {
      covering.parent.insertBefore(frame, covering.next);
      covering = null;
      frame.classList.remove('twist-cover');
      setSize(...windowSize);
      setFull(false);
      placeBack();
    }
  };
  const toggleFullScreen = () => {
    if (covering) { cover(false); return; }
    if (fullScreenElement() === frame) {
      (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
      return;
    }
    windowSize = [parseFloat(canvas.style.width), parseFloat(canvas.style.height)];
    notePlace();
    if (fullScreenElement()) { cover(true); return; }   // (the page is full screen already)
    (frame.requestFullscreen ?? frame.webkitRequestFullscreen).call(frame)?.catch?.(() => {});
  };
  const fullScreenChanged = () => {
    if (covering) { if (!fullScreenElement()) cover(false); return; }
    if (fullScreenElement() === frame) { setSize(screen.width, screen.height); setFull(true); }
    else { setSize(...windowSize); setFull(false); placeBack(); }
  };
  const coverResized = () => {
    if (covering) setSize(innerWidth, innerHeight);
  };
  if (canFullScreen) {
    document.addEventListener('fullscreenchange', fullScreenChanged);
    document.addEventListener('webkitfullscreenchange', fullScreenChanged);
    addEventListener('resize', coverResized);
    frame.addEventListener('dblclick', toggleFullScreen);   // (on the frame: the canvas may be swapped, see redraw)
  }

  showWindow(title, frame, () => {
    // Closed: stop drawing and give the graphics memory back.
    running = false;
    openWindowSizes.delete(resize);
    document.removeEventListener('fullscreenchange', fullScreenChanged);
    document.removeEventListener('webkitfullscreenchange', fullScreenChanged);
    removeEventListener('resize', coverResized);
    watch?.disconnect();
    if (covering) frame.remove();
    setFull(false);
    if (fullScreenElement() === frame) (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    drawer.dispose();
  }, setSize, canFullScreen ? toggleFullScreen : null);
}

// Everything needed to draw the twist with WebGL2 on a canvas: its own
// WebGL context and shader programs. Returns null without WebGL2. (No HDR.)
//   setLook(wide, hdr) – wide colour (Display P3) or not; hdr is ignored
//   draw(seconds, width, height) – one frame, at that size
// (surface.shared: drawn with the scene's own WebGL instead, into a picture
// of its own, as the backdrop: see sharedPicture in renderer.js. It then
// keeps none of WebGL's settings from one frame to the next.)
export function createDrawer(surface) {
  // antialias — let the graphics card smooth the bar's outline (not when
  // drawn sharp).
  const shared = surface.shared;
  const antialias = samples() > 1;
  const gl = shared ? shared.gl : surface.getContext('webgl2', { antialias });
  if (!gl) return null;
  const bar = createProgram(gl, BAR_VERTEX_SHADER, BAR_FRAGMENT_SHADER);
  const backdrop = createProgram(gl, BACKDROP_VERTEX_SHADER, BACKDROP_FRAGMENT_SHADER);
  const u = (program, name) => gl.getUniformLocation(program, name);
  const uTime = u(bar, 'uTime'), uAspect = u(bar, 'uAspect'), uShift = u(bar, 'uShift');
  const uDelay = u(bar, 'uDelay'), uColorTurn = u(bar, 'uColorTurn');
  const uHeight = u(backdrop, 'uHeight');
  const uWideBar = u(bar, 'uWide'), uWideBackdrop = u(backdrop, 'uWide');
  let convert = 0;
  const vao = gl.createVertexArray(), indices = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, barIndices(), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return {
    setLook(wide) {
      const space = wide ? 'display-p3' : 'srgb';
      if (!shared && 'drawingBufferColorSpace' in gl && gl.drawingBufferColorSpace !== space) gl.drawingBufferColorSpace = space;
      convert = wide && 'drawingBufferColorSpace' in gl && onP3Screen() ? 1 : 0;
    },
    draw(seconds, width, height) {
      if (shared) shared.begin(width, height, antialias);
      else if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.bindVertexArray(vao);
      gl.frontFace(gl.CW);

      // Backdrop first, without the depth test...
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(backdrop);
      gl.uniform1f(uHeight, height);
      gl.uniform1f(uWideBackdrop, convert);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ...then the bar, with it, so that its near sides hide its far sides.
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(bar);
      gl.uniform1f(uWideBar, convert);
      const aspect = width / height;
      gl.uniform1f(uTime, effectTime(seconds));
      gl.uniform1f(uAspect, aspect);
      const count = Math.min(MAX_TWISTS, Math.max(1, Math.floor(aspect / TWIST_SPACING)));   // (as many as the WebGPU twist draws)
      for (let k = 0; k < count; k++) {
        gl.uniform1f(uShift, ((k + 0.5) / count) * 2 - 1);   // evenly spread over the width
        gl.uniform1f(uDelay, k * TWIST_DELAY);
        gl.uniform1i(uColorTurn, k % 4);
        gl.drawElements(gl.TRIANGLES, INDEX_COUNT, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      if (shared) shared.end();
    },
    dispose() {
      if (!shared) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return; }
      for (const program of [bar, backdrop]) gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(indices);
    },
  };
}

// Compile a vertex + fragment shader pair into a program.
export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, sharpen(source));
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error:\n' + gl.getShaderInfoLog(shader));
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Shader link error:\n' + gl.getProgramInfoLog(program));
  }
  return program;
}

// =============================================================================
// The same twist drawn with WebGPU (the same shapes and colours as the WebGL
// shaders above), with the main scene's WebGPU device. The canvas takes
// light brighter than white with HDR (toneMapping "extended"), so the
// highlight can glow; its edges are smoothed by drawing 4 samples per pixel.
//   setLook(wide, hdr) – wide colour (Display P3) and HDR on or off
//   draw(seconds, width, height, glow) – one frame; glow: extra highlight light (HDR)
// Returns null if the canvas can't be set up for WebGPU.
// =============================================================================
export const GPU_FORMAT = 'rgba16float';
const MAX_TWISTS = 16;
const TWIST_WGSL = /* wgsl */ `
  struct Look { time: f32, aspect: f32, count: f32, glow: f32, height: f32, hdrRange: f32, wide: f32, linear: f32 }
  // (linear = 1: drawn as light, not screen colours, into the scene's own
  // picture as its backdrop: see drawPicture in gpu-renderer.js.)
  fn shown(c: vec3f) -> vec3f { return select(toScreen(c), c, look.linear > 0.5); }
  @group(0) @binding(0) var<uniform> look: Look;

  const PI = 3.14159265359;
  const SLICES = ${SLICES}u;
  const HALF_HEIGHT = 1.45;
  const RADIUS = 0.46;

  // (As in BAR_VERTEX_SHADER above.)
  ${toWgsl(TWIST_SHAPE)}
  struct Edge { position: vec3f, direction: vec3f }
  fn edgeAt(y: f32, edge: u32, t: f32) -> Edge {
    let angle = PI / 4.0 + f32(edge) * PI / 2.0 + angleAt(y, t);
    var e: Edge;
    e.position = vec3f(RADIUS * cos(angle) + swayAt(y, t), y * HALF_HEIGHT, RADIUS * sin(angle));
    e.direction = vec3f(-RADIUS * sin(angle) * angleSlopeAt(y, t) + swaySlopeAt(y, t), HALF_HEIGHT,
                        RADIUS * cos(angle) * angleSlopeAt(y, t));
    return e;
  }

  struct Bar {
    @builtin(position) at: vec4f,
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) pattern: vec2f,
    @location(3) @interpolate(flat) side: u32,
  }

  @vertex fn barVs(@builtin(vertex_index) v: u32, @builtin(instance_index) twist: u32) -> Bar {
    // Several twists side by side (see TWIST_SPACING): one per instance.
    let shift = ((f32(twist) + 0.5) / look.count) * 2.0 - 1.0;
    let t = look.time - f32(twist) * ${TWIST_DELAY};
    let side = v / ${CORNERS_PER_SIDE}u;
    let along = v - side * ${CORNERS_PER_SIDE}u;
    var o: Bar;
    o.side = (side + twist) % 4u;   // (the colours in another order for each twist)
    let right = (along & 1u) == 1u;
    let y = (f32(along >> 1u) / f32(SLICES)) * 2.0 - 1.0;
    let left = edgeAt(y, side, t);
    let rightEdge = edgeAt(y, side + 1u, t);
    o.position = select(left.position, rightEdge.position, right);
    o.pattern = vec2f(select(0.0, 1.0, right), y);
    o.normal = cross(select(left.direction, rightEdge.direction, right), rightEdge.position - left.position);
    let distance = 4.4 - o.position.z;
    // (Depth from 0 to 1, as WebGPU wants it, not -1 to 1 as in WebGL.)
    o.at = vec4f(o.position.x * 2.6 / look.aspect + shift * distance, o.position.y * 2.6,
                 (0.5 - 0.1 * o.position.z) * distance, distance);
    return o;
  }

  ${toWgsl(COLOR_CURVES)}
  // Linear sRGB light → linear Display P3 light, on a wide-colour screen
  // (look.wide = 1: see SRGB_TO_P3 and ELEMENTARY_IN_P3 in renderer.js).
  fn toCanvas(l: vec3f) -> vec3f {
    const SRGB_TO_P3 = mat3x3f(0.8224620, 0.0331942, 0.0170826,
                               0.1775380, 0.9668058, 0.0723974,
                               0.0,       0.0,       0.9105199);
    return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
  }
  // (Carried on above 1 with HDR: the canvas shows that brighter than white.)
  ${toWgsl(SQUARE_WAVE).trim()}

  @fragment fn barFs(b: Bar) -> @location(0) vec4f {
    var colors = array<vec3f, 4>(vec3f(0.769, 0.008, 0.200), vec3f(0.000, 0.624, 0.420),
                                 vec3f(0.000, 0.529, 0.741), vec3f(1.000, 0.827, 0.000));
    if (look.wide > 1.5) {   // (as far as Rec. 2020: see ELEMENTARY_IN_2020)
      colors = array<vec3f, 4>(vec3f(0.9059, -0.2723, 0.1406), vec3f(-0.5210, 0.6906, 0.3214),
                               vec3f(-0.4457, 0.5113, 0.8618), vec3f(1.0212, 0.8716, -0.3339));
    } else if (look.wide > 0.5) {   // (as P3 shows them: see ELEMENTARY_IN_P3)
      colors = array<vec3f, 4>(vec3f(0.8242, -0.1608, 0.1756), vec3f(-0.3157, 0.6472, 0.3911),
                               vec3f(-0.2504, 0.5236, 0.7784), vec3f(1.0176, 0.8609, -0.3058));
    }
    let square = vec2f(b.pattern.x * 2.0, (b.pattern.y * 0.5 + 0.5) * 9.0);
    let blur = fwidth(square) * SOFTNESS;
    let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
    let color = mix(vec3f(1.0), colors[b.side], checker);
    var normal = normalize(b.normal);
    let toCamera = normalize(vec3f(0.0, 0.0, 4.4) - b.position);
    if (dot(normal, toCamera) < 0.0) { normal = -normal; }
    let toLamp = normalize(vec3f(-0.5, 0.7, 0.9));
    let facing = max(0.0, dot(normal, toLamp));
    let halfway = normalize(toLamp + toCamera);
    let shine = pow(max(0.0, dot(normal, halfway)), 48.0);
    let lit = toCanvas(toLinear(color)) * (0.25 + 0.85 * facing) + vec3f(0.45 + look.glow) * shine;
    // (Below 0 only beyond P3, Rec. 2020: see the colours above.)
    return vec4f(shown(clamp(lit, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)))), 1.0);
  }

  @vertex fn backdropVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
    let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
    return vec4f(corner * 2.0 - 1.0, 1.0, 1.0);
  }
  @fragment fn backdropFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    // (Counted from the bottom, as in WebGL.)
    let color = mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), (look.height - at.y) / look.height);
    if (look.linear > 0.5) { return vec4f(max(toCanvas(toLinear(color)), vec3f(0.0)), 1.0); }
    return vec4f(select(color, toScreen(max(toCanvas(toLinear(color)), vec3f(0.0))), look.wide > 0.5), 1.0);
  }
`;

export function createGpuDrawer(canvas, device) {
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const module = device.createShaderModule({ code: sharpen(TWIST_WGSL) });
  const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniforms } }] });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const SAMPLES = samples();
  const make = (vs, fs, depthCompare, depthWrite, primitive = {}) => device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: vs },
    fragment: { module, entryPoint: fs, targets: [{ format: GPU_FORMAT }] },
    depthStencil: { format: 'depth24plus', depthCompare, depthWriteEnabled: depthWrite },
    multisample: { count: SAMPLES },
    primitive,
  });
  const backdrop = make('backdropVs', 'backdropFs', 'always', false);
  const bar = make('barVs', 'barFs', 'less', true, { cullMode: 'back', frontFace: 'cw' });
  const indices = barIndices();
  const indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(indexBuffer, 0, indices);
  const numbers = new Float32Array(8);
  let shownAs = null, targets = null, convert = 0;

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
    // (convert 2: the colours as far as Rec. 2020; see colourLevel in gpu-renderer.js.)
    setLook(wide, hdr) { configure(wide, hdr); convert = !(wide && onP3Screen()) ? 0 : hdr && onRec2020Screen() ? 2 : 1; },
    draw(seconds, width, height, glow) {
      if (!shownAs) configure(true, false);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      if (!targets || targets.width !== width || targets.height !== height) {
        targets?.color?.destroy(); targets?.depth.destroy();
        const texture = (format) => device.createTexture({ size: [width, height], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        targets = { width, height, color: SAMPLES > 1 ? texture(GPU_FORMAT) : null, depth: texture('depth24plus') };
        targets.colorView = targets.color?.createView();
        targets.depthView = targets.depth.createView();
      }
      const aspect = width / height;
      const count = Math.min(MAX_TWISTS, Math.max(1, Math.floor(aspect / TWIST_SPACING)));
      numbers.set([effectTime(seconds), aspect, count, glow, height, glow > 0 ? HDR_RANGE : 1, convert, canvas.linear ? 1 : 0]);
      device.queue.writeBuffer(uniforms, 0, numbers);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [colorTarget(targets.colorView, context.getCurrentTexture().createView())],
        depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        timestampWrites: this.timestampWrites,   // (as a backdrop, while the frame is timed: see drawPicture in gpu-renderer.js)
      });
      pass.setBindGroup(0, group);
      pass.setPipeline(backdrop);
      pass.draw(3);
      pass.setPipeline(bar);
      pass.setIndexBuffer(indexBuffer, 'uint32');
      pass.drawIndexed(INDEX_COUNT, count);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      targets?.color?.destroy(); targets?.depth.destroy();
      uniforms.destroy(); indexBuffer.destroy();
      context.unconfigure();
    },
  };
}
