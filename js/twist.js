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
// The window has its own small WebGL2 canvas, separate from the main scene,
// and only draws while it is open.
// =============================================================================

import { showWindow } from './gui.js';

const SLICES = 240;           // how many thin slices the bar is cut into
const VERTEX_COUNT = 4 * SLICES * 6;   // 4 sides × slices × 2 triangles of 3 corners

// The size of the picture when the window opens, in CSS pixels. (Drag the
// gadget in the window's bottom-right corner to change it.)
const WIDTH = 340;
const HEIGHT = 440;

// The bar's vertex shader. No shape is uploaded at all: every corner works
// out its own position from its number (gl_VertexID).
const BAR_VERTEX_SHADER = /* glsl */ `#version 300 es
  precision highp float;

  uniform float uTime;      // seconds since the window opened
  uniform float uAspect;    // width ÷ height of the picture

  out vec3 vPosition;       // where this point is in the world
  out vec3 vNormal;         // which way the surface faces there
  out vec2 vPattern;        // position on its side: x across (0 … 1), y along the bar
  flat out int vSide;       // which of the four sides (0 … 3)

  const float PI = 3.14159265359;
  const float SLICES = ${SLICES}.0;
  const float HALF_HEIGHT = 1.45;   // the bar reaches from -1.45 to +1.45
  const float RADIUS = 0.46;        // from the bar's centre line to its edges

  // THE TWIST: by what angle is the bar turned at height y (-1 … 1)?
  //   - the whole bar turns steadily,
  //   - it is wrung, more at the ends than in the middle, back and forth,
  //   - and a ripple travels along it.
  float angleAt(float y) {
    return 0.6 * uTime
         + 2.4 * sin(0.53 * uTime) * y
         + 0.7 * sin(2.6 * y + 1.3 * uTime);
  }

  // The bar also sways gently from side to side, like a snake.
  float swayAt(float y) {
    return 0.16 * sin(1.7 * y + 0.9 * uTime);
  }

  // How fast the two change with height (their derivatives). Needed to
  // work out which way the twisted surface faces, for the lighting.
  float angleSlopeAt(float y) {
    return 2.4 * sin(0.53 * uTime) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * uTime);
  }
  float swaySlopeAt(float y) {
    return 0.16 * 1.7 * cos(1.7 * y + 0.9 * uTime);
  }

  // One edge of the bar at height y: where it is, and which way it runs
  // (how its position changes when y grows). 'edge' counts the four edges.
  void edgeAt(float y, int edge, out vec3 position, out vec3 direction) {
    // The square's corners sit at 45°, 135°, 225° and 315°, plus the twist.
    float angle = PI / 4.0 + float(edge) * PI / 2.0 + angleAt(y);
    position  = vec3(RADIUS * cos(angle) + swayAt(y), y * HALF_HEIGHT, RADIUS * sin(angle));
    direction = vec3(-RADIUS * sin(angle) * angleSlopeAt(y) + swaySlopeAt(y), HALF_HEIGHT,
                      RADIUS * cos(angle) * angleSlopeAt(y));
  }

  void main() {
    // Which corner is this? Each slice of each side is a small rectangle
    // made of 2 triangles = 6 corners.
    int corner = gl_VertexID % 6;
    int piece  = gl_VertexID / 6;
    int slice  = piece % ${SLICES};
    vSide      = piece / ${SLICES};

    // The 6 corners of the rectangle: is this one at its right edge / its top?
    bool right = corner == 1 || corner == 2 || corner == 4;
    bool top   = corner == 2 || corner == 4 || corner == 5;

    float y = (float(slice + int(top)) / SLICES) * 2.0 - 1.0;   // -1 … 1 along the bar

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
    gl_Position = vec4(vPosition.x * ZOOM / uAspect, vPosition.y * ZOOM,
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

  // The four sides have the four Boing Ball colours.
  const vec3 SIDE_COLORS[4] = vec3[4](
    vec3(0.769, 0.008, 0.200),   // red
    vec3(0.000, 0.624, 0.420),   // green
    vec3(0.000, 0.529, 0.741),   // blue
    vec3(1.000, 0.827, 0.000));  // yellow

  // Screen colour ↔ linear light (see "Linear light" in shaders.js).
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

  // A smoothed square wave, the same as on the balls: +1 on even squares,
  // -1 on odd ones, blended over 'blur' squares at each edge.
  float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
  float squareWave(float x, float blur) {
    blur = max(blur, 1e-4);
    return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
  }

  void main() {
    // ---- Checker pattern: 2 squares across each side, 9 along the bar.
    vec2 square = vec2(vPattern.x * 2.0, (vPattern.y * 0.5 + 0.5) * 9.0);
    vec2 blur = fwidth(square);
    float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
    vec3 color = mix(vec3(1.0), SIDE_COLORS[vSide], checker);

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

    vec3 lit = toLinear(color) * (0.25 + 0.85 * facing) + vec3(0.45) * shine;
    outColor = vec4(toScreen(lit), 1.0);
  }
`;

// The backdrop: a night-blue gradient in Amiga-style colour steps, drawn by
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
  void main() {
    // One colour per line of a 256-line Amiga screen, 16 levels per channel.
    float y = (floor(gl_FragCoord.y / uHeight * 256.0) + 0.5) / 256.0;
    vec3 color = mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), y);
    outColor = vec4(floor(color * 15.0 + 0.5) / 15.0, 1.0);
  }
`;


// Open the Twist window (called by the button in the settings panel).
let isOpen = false;
export function openTwistWindow() {
  if (isOpen) return;   // one is enough
  isOpen = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'twist-canvas';

  // antialias: true — let the graphics card smooth the bar's outline.
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { isOpen = false; return; }   // (the main scene needs WebGL2 too, so this won't happen)

  // Set the picture's size on screen, and with it the number of real
  // pixels it is drawn with (twice as many on sharp "retina" screens).
  const setSize = (width, height) => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  setSize(WIDTH, HEIGHT);

  const bar = createProgram(gl, BAR_VERTEX_SHADER, BAR_FRAGMENT_SHADER);
  const backdrop = createProgram(gl, BACKDROP_VERTEX_SHADER, BACKDROP_FRAGMENT_SHADER);
  const uTime = gl.getUniformLocation(bar, 'uTime');
  const uAspect = gl.getUniformLocation(bar, 'uAspect');
  const uHeight = gl.getUniformLocation(backdrop, 'uHeight');
  gl.bindVertexArray(gl.createVertexArray());   // WebGL wants one, even an empty one

  let running = true;
  const startTime = performance.now();

  function frame(now) {
    if (!running) return;

    // Backdrop first, without the depth test...
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(backdrop);
    gl.uniform1f(uHeight, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ...then the bar, with it, so that its near sides hide its far sides.
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(bar);
    gl.uniform1f(uTime, (now - startTime) / 1000);
    gl.uniform1f(uAspect, canvas.width / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, VERTEX_COUNT);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  showWindow('Twist', canvas, () => {
    // Closed: stop drawing and give the graphics memory back.
    isOpen = false;
    running = false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }, setSize);
}

// Compile a vertex + fragment shader pair into a program.
function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
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
