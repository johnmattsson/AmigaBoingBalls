// =============================================================================
// renderer.js — talks to WebGL2 and draws one picture of the scene.
//
// WebGL is a low-level API: you upload lists of numbers (vertex buffers) to
// the graphics card, compile shader programs (see shaders.js), set their
// inputs ("uniforms"), and ask it to draw. This file wraps all that so
// main.js can simply call renderer.draw(camera, balls).
//
// Each frame:
//   1. A cheap first pass records which ball is in front at each pixel, so
//      hidden pixels can skip their work later.
//   2. Draw the scene into an off-screen picture that stores linear light
//      (see "Linear light" in shaders.js). The backdrop first, then the
//      floor's shadows, then the walls, then the balls from farthest to
//      nearest, so every smoothed edge blends over whatever is behind it.
//      Last come the balls' trails, if switched on.
//   3. Copy that picture to the canvas, converting to screen colours.
// =============================================================================

import { HDR_RANGE } from './hdr.js';
import { BOX_HALF_SIZE, WALL_NORMALS } from './physics.js';
import { Vec3 } from './math.js';
import * as Shaders from './shaders.js';

const { MAX_BALLS, SHADOW_GRID, SHADOW_LIST_WIDTH } = Shaders;
const MAX_SHADOW_RANGE = 3;   // the shadow grid covers at most ±3 sideways per 1 away from the lamp

// --- Look of the scene -------------------------------------------------------

const BACKGROUND = hexToRgb(0xaaaaaa);   // light grey, same as the floor
const GRID_COLOR = hexToRgb(0xaa00aa);   // purple
const GRID_OPACITY = 0.6;                // 60 % purple, 40 % grey showing through
const GRID_LINE_WIDTH = 1.5;             // in CSS pixels; try 1–2 to taste

// The shade a grid line has where it fully covers a pixel. Release 1.3 drew
// the lines 60 % see-through over the grey; we work out that resulting shade
// once, so the lines look exactly as before.
const GRID_SHADE = GRID_COLOR.map((c, i) => GRID_OPACITY * c + (1 - GRID_OPACITY) * BACKGROUND[i]);

// How many pixels every edge (ball outlines, checker squares, grid lines,
// shadows) is blended over. 1 = as sharp as possible without stair-steps.
// Try 1.2 for slightly calmer edges on moving things.
const EDGE_WIDTH = 1.0;

// The stage: where the floor and the lamp are, and how far the balls can
// get. These are the values for the box; main.js passes others (the Lamp
// slider, and the window-sized room when the grid is off).
//
// The lamp hangs high above the middle, like the spotlight in the original.
// It is a single point, which gives hard, old-school shadow edges.
const BOX_STAGE = {
  floorY: -BOX_HALF_SIZE,    // the floor is drawn a hair below this, under the bottom grid
  lightHeight: 21,           // how far the lamp is from the middle of the room
  lightTilt: 0,              // 0° = straight above, 90° = right in front
  reach: BOX_HALF_SIZE,      // how far sideways any ball can get
  top: BOX_HALF_SIZE,        // how high any ball can get
};

// The lamp always stays at least this far outside the space the balls are in.
const MIN_LAMP_CLEARANCE = 4;
// How far left the lamp moves as it tilts forwards, as a share of its distance.
const LAMP_SIDE_STEP = 0.39;
// The floor (which only shows shadows) is never drawn bigger than this.
const FLOOR_LIMIT = 400;

// The floor is drawn this far below the bottom of the box, so that it
// never fights with the bottom grid over which is in front.
const FLOOR_GAP = 0.01;
const SHADOW_STRENGTH = 0.4;    // 40 % darker in full shadow

// Trails: the fading lines behind the balls.
const TRAIL_WIDTH = 3;          // in CSS pixels
const TRAIL_OPACITY = 0.9;      // at the ball; fades to 0 at the old end
const MAX_TRAIL_PIECES = 400000; // most straight pieces drawn per frame (1000 balls × 400 fit)
const FIRST_TRAIL_PIECES = 40960; // room made at the start; it grows when more is needed
const BALL_TABLE_COLUMNS = 6;     // groups of 4 numbers per ball in the ball table
const TRAIL_PIECE_NUMBERS = 11; // numbers sent per piece: 2 ends, colour, 2 fades

// Big pixels (renderer.pixelSize above 1): draw the scene the way an old
// computer would have shown it — with far fewer pixels, blown up into big
// squares, with hard edges and the Amiga's 4096 colours (16 levels each of
// red, green and blue).
const AMIGA_COLOR_LEVELS = 15;   // 16 levels: 0 … 15

// Light brighter than white. An ordinary screen cuts it at white; an HDR
// screen (see hdr.js) shows it, up to HDR_RANGE times white. The copy to the
// canvas packs it into the canvas's 8 bits for WebGPU to unpack.
// With HDR (the HDR slider above 0) all of it shines, times the slider's
// value (options.hdrStrength):
//   - HDR_SHINE: the copper bars' white highlights shine up to 1 +
//     HDR_SHINE times white;
//   - GLINT: Glints (a slider of its own, also without HDR, when the glint
//     is white at most) — with HDR, up to 1 + GLINT times white is added
//     where a ball mirrors the lamp;
//   - TEXT_GLOW: the scroller's letters are drawn into the scene, 1 +
//     TEXT_GLOW times as bright.
const HDR_SHINE = 2;
const GLINT = 3;
const TEXT_GLOW = 2;
const HARD_EDGE = 0.001;         // an edge "blended" over a 1000th of a pixel: not at all

// Never render at more than 2 pixels per CSS pixel: phones with 3x screens
// would otherwise draw over twice as many pixels for no visible gain.
const MAX_PIXEL_RATIO = 2;


// How far the lamp is from the middle of the room (see Renderer.draw).
function lampDistance(stage) {
  return Math.max(stage.lightHeight, Math.max(stage.top, stage.reach) + MIN_LAMP_CLEARANCE);
}

// How far the lamp may tilt, in degrees. In the box: all the way (90°).
// In the window-sized room (grid off) the floor is all there is, and a
// lamp tilted down to about the height of the highest balls throws their
// shadows almost endlessly far, up to the horizon, where any floor must end
// and cut them off. So there it stops while it is still well above the top
// of the room: high enough that the shadow of a ball at the very top lands
// at most SHADOW_STRETCH times as far out as the lamp is.
const SHADOW_STRETCH = 4;
export function maxLampTilt(stage) {
  if (!stage.windowRoom) return 90;
  const s = { ...BOX_STAGE, ...stage };
  // The lamp's height is distance · cos(tilt). With the lamp at height h,
  // a ball at the top lands (h − floor) / (h − top) times as far out.
  const lowest = (SHADOW_STRETCH * s.top - s.floorY) / (SHADOW_STRETCH - 1);
  const c = lowest / lampDistance(s);
  return c >= 1 ? 0 : Math.floor((Math.acos(Math.max(-1, c)) * 180) / Math.PI);
}

export class Renderer {
  // canvas: what to draw on. view: the element on the page that shows the
  // scene, for its size and position — the canvas itself, or for HDR (see
  // hdr.js) the page's canvas while this one draws on an OffscreenCanvas
  // that is never shown, so that only WebGPU's canvas changes on screen.
  constructor(canvas, view = canvas) {
    this.canvas = canvas;
    this.view = view;

    // antialias: false — the shaders smooth every edge themselves, so the
    // graphics card's own (multi-sample) smoothing isn't needed.
    // depth: false — the canvas itself needs no depth buffer; the off-screen
    // picture has its own.
    // (We leave the canvas see-through-capable, the default, even though every
    // pixel we draw is fully opaque: in testing, an opaque-only canvas made
    // Chrome show garbage where the settings panel overlaps the scene.)
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    // The off-screen picture keeps light as 16-bit floating-point numbers
    // where the graphics card can draw into those (almost everywhere), so
    // it can hold light brighter than white (see createLinearTarget below).
    this.floatTarget = !!gl.getExtension('EXT_color_buffer_float');
    // An HDR screen, if switched on (see hdr.js): set by setHdr() in main.js.
    this.hdr = null;
    this.wideColor = false;   // see setWideColor() (main.js switches it on)

    // Compile the shader programs.
    this.floorProgram = createProgram(gl, Shaders.FLOOR_VERTEX_SHADER, Shaders.FLOOR_FRAGMENT_SHADER);
    this.wallProgram = createProgram(gl, Shaders.WALL_VERTEX_SHADER, Shaders.WALL_FRAGMENT_SHADER);
    this.ballProgram = createProgram(gl, Shaders.BALL_VERTEX_SHADER, Shaders.BALL_FRAGMENT_SHADER);
    this.ballDepthProgram = createProgram(gl, Shaders.BALL_VERTEX_SHADER, Shaders.BALL_DEPTH_FRAGMENT_SHADER);
    this.trailProgram = createProgram(gl, Shaders.TRAIL_VERTEX_SHADER, Shaders.TRAIL_FRAGMENT_SHADER);
    // The copper bars fill the whole picture, like the copy-to-screen step,
    // so they share its vertex shader.
    this.copperProgram = createProgram(gl, Shaders.PRESENT_VERTEX_SHADER, Shaders.COPPER_FRAGMENT_SHADER);
    this.presentProgram = createProgram(gl, Shaders.PRESENT_VERTEX_SHADER, Shaders.PRESENT_FRAGMENT_SHADER);
    // The scroller's picture, for its glowing letters with HDR (on texture unit 5).
    this.textVersion = null;   // which of its pictures was sent last
    this.textTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);

    // Upload the shapes. Walls and balls are both drawn as flat squares.
    this.square = createSquare(gl);
    this.emptyVao = gl.createVertexArray();   // for the copy-to-screen step
    this.walls = WALL_NORMALS.map(describeWall);
    this.trails = createTrailMesh(gl);
    this.trailPieces = new Float32Array(FIRST_TRAIL_PIECES * TRAIL_PIECE_NUMBERS);

    // The ball table for the shaders (see BALL_LIST in shaders.js): one row
    // of 6 × 4 numbers per ball, in a texture of 32-bit floating-point
    // numbers on texture unit 3. Sent anew every frame.
    this.ballTable = new Float32Array(MAX_BALLS * BALL_TABLE_COLUMNS * 4);
    this.ballTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ballTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, BALL_TABLE_COLUMNS, MAX_BALLS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    this.rotation = new Float32Array(9);
    this.drawOrder = new Int32Array(MAX_BALLS);       // ball numbers, farthest first
    this.drawDistance = new Float64Array(MAX_BALLS);  // (squared) distance of each ball from the eye
    this.drawCount = -1;

    // The shadow grid (see "Shadows" in shaders.js): for each of the
    // 128 × 128 cells of the lamp's view, a list of the balls that can cast
    // a shadow there. All the lists are kept one after another in
    // `shadowList`; for each cell, `shadowCells` holds where its list starts
    // and how long it is. Both are sent to the GPU as textures of whole
    // numbers: the cells on unit 1, the lists on unit 4.
    const cells = SHADOW_GRID * SHADOW_GRID;
    // (Both in one number per cell: start × 4096 + length, which halves what
    // has to be sent each frame. A list holds at most 1000 balls.)
    this.shadowCells = new Uint32Array(cells);
    this.shadowCount = new Uint32Array(cells);        // how many balls each cell lists
    this.shadowCellTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowCellTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, SHADOW_GRID, SHADOW_GRID);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    this.shadowList = null;          // made (and made bigger) by makeShadowListRoom()
    this.shadowListTexture = null;
    this.makeShadowListRoom(64 * SHADOW_LIST_WIDTH);

    this.pixelRatio = 1;
    // How many screen points (CSS pixels) wide and high one drawn pixel is.
    // 1 = as sharp as the screen allows; more = big pixels (see above).
    // Call resize() after changing it.
    this.pixelSize = 1;
    this.pixelated = false;   // set by resize(): is pixelSize above 1?
    this.target = null;   // the off-screen picture, made in resize()

    // Measuring how long the graphics card works on each frame (for the
    // Info page). Only some browsers offer this (Chrome and Edge on
    // desktop do); elsewhere gpuTimer is null and the time shows as "n/a".
    // The card works in the background, so each measurement only becomes
    // available a few frames later: unfinished ones wait in a queue.
    this.gpuTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.measureGpu = false;   // switched on by main.js while the Info page is shown

    this.gpuQueue = [];
    this.gpuTotalMs = 0;       // summed measurements, read and reset by main.js
    this.gpuFrames = 0;
  }

  // Match the drawing size to the canvas's size on screen.
  resize() {
    const gl = this.gl;
    // Normally: as many pixels as the screen has. With big pixels: fewer,
    // and the browser is told to blow them up into crisp squares instead
    // of blurring them.
    // (A big pixel is made a whole number of the screen's own pixels wide —
    // 3, not 2.5 — or some would come out wider than others.)
    this.pixelated = this.pixelSize > 1;
    const screenRatio = window.devicePixelRatio || 1;
    const bigPixel = Math.max(1, Math.round(this.pixelSize * screenRatio)) / screenRatio;
    this.pixelRatio = this.pixelated ? 1 / bigPixel : Math.min(screenRatio, MAX_PIXEL_RATIO);
    this.view.style.imageRendering = this.pixelated ? 'pixelated' : '';
    const width = Math.max(1, Math.round(this.view.clientWidth * this.pixelRatio));
    const height = Math.max(1, Math.round(this.view.clientHeight * this.pixelRatio));
    if (this.target && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.target) this.target.dispose();
    this.target = createLinearTarget(gl, width, height, this.floatTarget);
    // (Should the card turn the float picture down after all, use 8 bits.)
    if (!this.target.complete && this.floatTarget) {
      this.target.dispose();
      this.floatTarget = false;
      this.target = createLinearTarget(gl, width, height, false);
    }
  }

  // Give the graphics memory back (the HDR renderer, when HDR goes off).
  dispose() {
    this.hdr?.dispose();
    this.hdr = null;
    this.target?.dispose();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // Can the canvas show colours in the wider Display P3 range? (Most
  // phones, Macs and newer laptops have such screens.)
  get wideColorSupported() {
    return 'drawingBufferColorSpace' in this.gl;
  }

  // Wide colour: the colours are sent to the screen as Display P3 instead
  // of sRGB. The numbers stay the same, so grey stays grey, but on a
  // wide-colour screen red, green, blue and yellow come out deeper than
  // sRGB can show. (On an ordinary screen it looks as before.)
  setWideColor(on) {
    this.wideColor = on;
    this.applyColorSpace();
  }

  applyColorSpace() {
    // With an HDR screen the WebGPU canvas shows the picture, so the colour
    // space is set there, and this canvas must stay plain sRGB.
    const space = this.wideColor && !this.hdr ? 'display-p3' : 'srgb';
    if (this.wideColorSupported && this.gl.drawingBufferColorSpace !== space) {
      this.gl.drawingBufferColorSpace = space;
    }
    this.hdr?.setColorSpace(this.wideColor ? 'display-p3' : 'srgb');
  }

  // Draw one frame. `options` switches the extras on:
  //   copper: true     – copper bars as the backdrop instead of plain grey
  //   backdropTime     – the time (in seconds) that moves the copper bars
  //   trailSeconds     – draw the balls' trails, this many seconds long (0 = none)
  //   trailTime        – the physics' current time, for fading the trails
  //   grid: false      – leave out the box's grid lines (and with them the
  //                      walls: shadows then only fall on the floor)
  //   shadows: false   – no shadows at all
  //   stage            – where the floor and lamp are, if not as in
  //                      BOX_STAGE above (any part may be left out)
  //   hdrStrength      – how bright the light brighter than white gets
  //   glints           – a glint where each ball mirrors the lamp: how
  //                      bright (0 = none, 1 = white, more with HDR)
  //   text             – the scroller's canvas, to draw into the scene
  //                      with glowing letters (with HDR)
  //   textVersion      – changes whenever that canvas has a new picture
  draw(camera, balls, options = {}) {
    const showGrid = options.grid ?? true;
    const strength = options.hdrStrength ?? 1;   // of the light brighter than white
    const showShadows = options.shadows ?? true;
    const edgeWidth = this.pixelated ? HARD_EDGE : EDGE_WIDTH;
    const stage = { ...BOX_STAGE, ...options.stage };
    const floorY = stage.floorY - FLOOR_GAP;
    // The lamp. It is `lightHeight` away from the middle of the room:
    // straight above it when `lightTilt` is 0, and swung forwards, towards
    // the viewer, as the tilt grows — at 90° it stands right in front, level
    // with the middle. On the way it also moves a little to the left, so
    // that shadows on the back wall fall to the right of the balls, as in
    // the original demo.
    // (It never comes closer than a little outside the room: a lamp among
    // the balls would throw shadows in all directions, further than the
    // shadow grid can keep track of.)
    const distance = lampDistance(stage);
    const tilt = (Math.min(stage.lightTilt, maxLampTilt(stage)) * Math.PI) / 180;
    const light = new Vec3(-LAMP_SIDE_STEP * Math.sin(tilt), Math.cos(tilt), Math.sin(tilt)).scale(distance);

    // The lamp looks at the middle of the room. "Sideways" and "up" in its
    // view are two directions at right angles to that.
    const forward = light.scale(-1).normalize();
    const up = forward.cross(new Vec3(1, 0, 0)).normalize();
    const side = up.cross(forward);
    const lamp = { position: light, forward, side, up };

    // How much of the lamp's view the shadow grid covers: set by
    // fillShadowGrid, from where the balls are.
    let shadowRange = 1;
    // The floor must be big enough to catch every shadow: see where the
    // lamp throws the shadow of each top corner of that space. (A lamp
    // lower than the corner throws it "to infinity": then we stop at
    // FLOOR_LIMIT.) In the box, a shown wall catches the shadows that pass
    // the end where a hidden wall would be (see "WALLS" in shaders.js), so
    // it reaches as far as the floor.
    let floorHalfSize = BOX_HALF_SIZE;
    for (const x of [-stage.reach, stage.reach]) {
      for (const y of [stage.floorY, stage.top]) {
        for (const z of [-stage.reach, stage.reach]) {
          const corner = new Vec3(x, y, z).sub(light);

          const drop = light.y - y;   // how far the lamp is above this corner
          const stretch = drop > 0.5 ? (light.y - floorY) / drop : Infinity;
          const landsAt = light.add(corner.scale(stretch));
          const reach = Math.max(Math.abs(landsAt.x), Math.abs(landsAt.z));
          floorHalfSize = Math.max(floorHalfSize, Number.isFinite(reach) ? Math.min(reach, FLOOR_LIMIT) : FLOOR_LIMIT);
        }
      }
    }
    floorHalfSize *= 1.05;
    const wallShadowExtend = Math.max(0, floorHalfSize - BOX_HALF_SIZE);
    const gl = this.gl;
    const timer = this.measureGpu ? this.gpuTimer : null;
    let query = null;
    if (timer) {
      this.collectGpuTimes();
      query = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    }
    const count = Math.min(balls.length, MAX_BALLS);
    const eye = camera.position;

    // Farthest ball first, so nearer balls are drawn over farther ones.
    // The order hardly changes from one frame to the next, so last frame's
    // order is tidied up ("insertion sort", which is quick on a list that is
    // nearly in order already) instead of sorting from scratch.
    const order = this.drawOrder, away = this.drawDistance;
    if (this.drawCount !== count) {
      for (let i = 0; i < count; i++) order[i] = i;
      this.drawCount = count;
    }
    for (let i = 0; i < count; i++) {
      const p = balls[i].position;
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      away[i] = dx * dx + dy * dy + dz * dz;
    }
    for (let i = 1; i < count; i++) {
      const ball = order[i], d = away[ball];
      let j = i - 1;
      while (j >= 0 && away[order[j]] < d) { order[j + 1] = order[j]; j--; }
      order[j + 1] = ball;
    }

    // Fill the ball table (see BALL_LIST in shaders.js), one row per ball.
    // (Written number by number: this runs for every ball in every frame.)
    const table = this.ballTable, r = this.rotation;
    for (let i = 0; i < count; i++) {
      const b = balls[i], p = b.position, c = b.color;
      let at = i * BALL_TABLE_COLUMNS * 4;
      b.orientation.toMat3(r);
      table[at++] = p.x; table[at++] = p.y; table[at++] = p.z; table[at++] = b.radius;
      table[at++] = ((c >> 16) & 255) / 255; table[at++] = ((c >> 8) & 255) / 255; table[at++] = (c & 255) / 255;
      table[at++] = b.squares;
      for (let k = 0; k < 9; k += 3) { table[at++] = r[k]; table[at++] = r[k + 1]; table[at++] = r[k + 2]; table[at++] = 0; }
      table[at++] = order[i]; table[at++] = 0; table[at++] = 0; table[at++] = 0;
    }

    // Send it to the graphics card (one upload for all shaders), only the
    // rows that are in use.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ballTexture);
    if (count > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BALL_TABLE_COLUMNS, count, gl.RGBA, gl.FLOAT, table);
    }
    gl.activeTexture(gl.TEXTURE0);

    // Work out which balls can cast shadows where, and send that too.
    // Without shadows the grid is simply left empty ("no ball can shadow
    // anything"), so every shadow test finishes at once.
    const listed = showShadows ? this.fillShadowGrid(balls, count, lamp) : this.emptyShadowGrid();
    shadowRange = this.shadowRange;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowCellTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_GRID, SHADOW_GRID, gl.RED_INTEGER, gl.UNSIGNED_INT, this.shadowCells);
    const rows = Math.ceil(listed / SHADOW_LIST_WIDTH);
    if (rows > 0) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowListTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_LIST_WIDTH, rows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, this.shadowList);
    }
    gl.activeTexture(gl.TEXTURE0);

    // How shadows are painted on the floor and walls (see uShadowColor in
    // shaders.js). Plain backdrop: the grey's own shadowed shade, opaque.
    // Copper bars: see-through black that darkens the bars by as much as
    // a shadow darkens the grey.
    const litGrey = srgbToLinear(BACKGROUND[0]);
    const shadowedGrey = srgbToLinear(BACKGROUND[0] * (1 - SHADOW_STRENGTH));
    const shadowColor = options.copper ? [0, 0, 0] : BACKGROUND.map((c) => srgbToLinear(c * (1 - SHADOW_STRENGTH)));
    const shadowOpacity = options.copper ? 1 - shadowedGrey / litGrey : 1;

    // A wall is in the way when the camera is on its outside, so only the
    // walls seen from the inside are shown.
    const visible = this.walls.map((wall) => eye.dot(wall.normal) <= BOX_HALF_SIZE);

    // Uniforms that every scene program needs: camera, balls, lamp, edges.
    const setShared = (program) => {
      gl.useProgram(program.handle);
      const u = program.uniforms;
      gl.uniformMatrix4fv(u.uViewProjection, false, camera.viewProjection);
      gl.uniform3f(u.uCameraPosition, eye.x, eye.y, eye.z);
      gl.uniform1i(u.uBallCount, count);
      gl.uniform3f(u.uLightPosition, light.x, light.y, light.z);
      gl.uniform3f(u.uLightForward, forward.x, forward.y, forward.z);
      gl.uniform3f(u.uLightSide, side.x, side.y, side.z);
      gl.uniform3f(u.uLightUp, up.x, up.y, up.z);
      gl.uniform1f(u.uShadowRange, shadowRange);
      gl.uniform1f(u.uShadowStrength, SHADOW_STRENGTH);
      gl.uniform3f(u.uShadowColor, ...shadowColor);
      gl.uniform1f(u.uShadowOpacity, shadowOpacity);
      gl.uniform1f(u.uEdgeWidth, edgeWidth);
      gl.uniform1i(u.uShadowCells, 1);  // the shadow grid is on texture units 1 and 4
      gl.uniform1i(u.uShadowList, 4);
      gl.uniform1i(u.uFrontDepth, 2);   // the front-depth picture is on unit 2
      gl.uniform1i(u.uBallData, 3);     // the ball table is on unit 3
      return u;
    };

    // ---- Step 1: the cheap first pass. Draw all balls, recording only how
    // far away the nearest one is at each pixel (see "Skipping hidden pixels"
    // in shaders.js). Everything farther away can then skip its work.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.frontFramebuffer);
    gl.viewport(0, 0, this.target.width, this.target.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);   // "nothing in front" everywhere
    gl.enable(gl.DEPTH_TEST);
    setShared(this.ballDepthProgram);
    gl.bindVertexArray(this.square.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.target.frontDepth);
    gl.activeTexture(gl.TEXTURE0);

    // Shadows fall on the four side walls and on the ceiling (which a lamp
    // tilted to the front can reach). The bottom of the box lies on the
    // floor, which shows them already. Wall 0 in the list is the bottom,
    // wall 1 the ceiling.
    const catchesShadows = (index) => index >= 1;
    const placeWall = (u, wall, index) => {
      // Shadows are caught on the wall, and a good way past each edge where
      // the next such wall is hidden. (At the bottom they reach the hair's
      // breadth down to where the floor is drawn, so that wall and floor
      // meet exactly.)
      gl.uniform4f(u.uExtend, ...wall.neighbours.map((other) => {
        if (!catchesShadows(index)) return 0;
        if (other === 0) return FLOOR_GAP;
        return catchesShadows(other) && !visible[other] ? wallShadowExtend : 0;
      }));
      gl.uniform3f(u.uWallCenter, wall.center.x, wall.center.y, wall.center.z);
      gl.uniform3f(u.uWallAxisU, wall.axisU.x, wall.axisU.y, wall.axisU.z);
      gl.uniform3f(u.uWallAxisV, wall.axisV.x, wall.axisV.y, wall.axisV.z);
    };

    // ---- Step 2: draw the scene into the off-screen linear-light picture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    gl.viewport(0, 0, this.target.width, this.target.height);
    // The picture stores linear light, so the clear colour must be linear too.
    gl.clearColor(...BACKGROUND.map(srgbToLinear), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);   // alpha = coverage

    // --- 0. Backdrop: copper bars over the whole picture, if switched on.
    if (options.copper) {
      gl.disable(gl.DEPTH_TEST);   // it is behind everything
      gl.useProgram(this.copperProgram.handle);
      gl.uniform1f(this.copperProgram.uniforms.uTime, options.backdropTime ?? 0);
      gl.uniform1f(this.copperProgram.uniforms.uHeight, this.target.height);
      // On an HDR screen the bars' white highlights shine brighter than white.
      gl.uniform1f(this.copperProgram.uniforms.uShine, this.hdr ? HDR_SHINE * strength : 0);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.DEPTH_TEST);   // nearer things hide farther things
    gl.enable(gl.BLEND);        // shadows and smoothed edges blend over what's behind

    // --- 1. Floor shadows (only from above; like the original, the floor
    //     has no back side).
    if (showShadows && eye.y > floorY) {
      const u = setShared(this.floorProgram);
      gl.uniform1f(u.uFloorY, floorY);
      gl.uniform1f(u.uFloorHalfSize, floorHalfSize);
      gl.uniform1f(u.uHalfSize, BOX_HALF_SIZE);
      // Walls 2…5 in the WALL_NORMALS list are left, right, back and front.
      gl.uniform4f(u.uWallShown, ...[2, 3, 4, 5].map((index) => (showGrid && visible[index] ? 1 : 0)));
      gl.depthMask(false);
      gl.bindVertexArray(this.square.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true);
    }

    // --- 2. Walls. They are always behind the balls (we hide the walls
    //     between the camera and the box), so they go next. They don't
    //     write depth, so they never hide each other.
    if (showGrid) {
      const u = setShared(this.wallProgram);
      // Over plain grey the lines are drawn solid, in the shade that 60 %
      // purple over that grey gives. Over the copper bars they really are
      // 60 % see-through purple.
      gl.uniform3f(u.uColor, ...(options.copper ? GRID_COLOR : GRID_SHADE));
      gl.uniform1f(u.uLineOpacity, options.copper ? GRID_OPACITY : 1);
      gl.uniform1f(u.uLineWidth, Math.max(1, GRID_LINE_WIDTH * this.pixelRatio));   // never thinner than a pixel
      gl.uniform1f(u.uHalfSize, BOX_HALF_SIZE);
      gl.depthMask(false);
      gl.bindVertexArray(this.square.vao);

      this.walls.forEach((wall, index) => {
        if (!visible[index]) return;

        gl.uniform1f(u.uCatchShadows, showShadows && catchesShadows(index) ? 1 : 0);
        placeWall(u, wall, index);


        // Each edge of the box is shared by two walls. If both walls drew
        // the line along it, it would be blended twice and look darker than
        // the other lines. So it is drawn by just one of them: the one that
        // comes first in the list, unless the other wall is hidden.
        const drawEdge = wall.neighbours.map((other) => (!visible[other] || index < other ? 1 : 0));
        gl.uniform4f(u.uDrawEdge, ...drawEdge);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });

      gl.depthMask(true);
    }

    // --- 3. Balls: one square each, all in a single instanced draw call,
    //     farthest first. Their smoothed outlines blend over what's behind.
    {
      const u = setShared(this.ballProgram);
      gl.uniform1f(u.uGlint, (options.glints ?? 0) * (this.hdr ? 1 + GLINT * strength : 1));
      gl.bindVertexArray(this.square.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    // --- 3b. Trails. Drawn last: the depth test hides the parts behind a
    //     ball, and they don't write depth themselves.
    if (options.trailSeconds > 0) {
      const pieces = this.fillTrails(balls, count, options.trailTime ?? 0, options.trailSeconds);
      if (pieces > 0) {
        const u = this.trailProgram.uniforms;
        gl.useProgram(this.trailProgram.handle);
        gl.uniformMatrix4fv(u.uViewProjection, false, camera.viewProjection);
        gl.uniform2f(u.uViewport, this.target.width, this.target.height);
        gl.uniform1f(u.uWidth, Math.max(1, TRAIL_WIDTH * this.pixelRatio));
        gl.uniform1f(u.uEdgeWidth, edgeWidth);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.trails.pieceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trailPieces, 0, pieces * TRAIL_PIECE_NUMBERS);
        gl.depthMask(false);
        gl.bindVertexArray(this.trails.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pieces);
        gl.depthMask(true);
      }
    }

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // The glowing letters (HDR): the scroller's picture, and where it lies on the canvas
    // (in the canvas's own pixels, counted from the bottom left).
    let textRect = [0, 0, 0, 0];
    if (options.text && options.text.width > 0) {
      const box = this.view.getBoundingClientRect();
      const strip = options.text.getBoundingClientRect();
      const sx = this.canvas.width / box.width, sy = this.canvas.height / box.height;
      textRect = [(strip.left - box.left) * sx, (box.bottom - strip.bottom) * sy, strip.width * sx, strip.height * sy];
      // (Only a new picture is sent: sending it costs a pause every time.)
      if (options.textVersion !== this.textVersion) {
        this.textVersion = options.textVersion;
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.text);
        gl.activeTexture(gl.TEXTURE0);
      }
    } else {
      this.textVersion = null;   // (shown again later: send it afresh)
    }

    // ---- Step 3: copy to the canvas, converting back to screen colours.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.presentProgram.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
    gl.uniform1i(this.presentProgram.uniforms.uScene, 0);
    gl.uniform1f(this.presentProgram.uniforms.uColorLevels, this.pixelated ? AMIGA_COLOR_LEVELS : 0);
    gl.uniform1f(this.presentProgram.uniforms.uHdrRange, this.hdr ? HDR_RANGE : 0);
    gl.uniform1i(this.presentProgram.uniforms.uText, 5);
    gl.uniform4f(this.presentProgram.uniforms.uTextRect, ...textRect);
    gl.uniform1f(this.presentProgram.uniforms.uTextGlow, TEXT_GLOW * strength);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // With an HDR screen, WebGPU takes the picture from here and shows it.
    this.hdr?.present(this.canvas, this.view);

    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      this.gpuQueue.push(query);
    }
  }

  // Wait until the graphics card has really finished drawing. (Reading back
  // one pixel of the picture forces that wait; gl.finish() is not reliable
  // for this in every browser.)
  waitUntilDone() {
    const gl = this.gl;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.onePixel ??= new Uint8Array(4));
  }

  // Pick up the graphics card's finished time measurements.
  collectGpuTimes() {
    const gl = this.gl;
    // "Disjoint" means something interrupted the card (e.g. power saving),
    // which makes the waiting measurements unreliable: throw them away.
    const disjoint = gl.getParameter(this.gpuTimer.GPU_DISJOINT_EXT);
    while (this.gpuQueue.length) {
      const query = this.gpuQueue[0];
      if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) {
        this.gpuTotalMs += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;   // ns → ms
        this.gpuFrames++;
      }
      gl.deleteQuery(query);
      this.gpuQueue.shift();
    }
  }

  // Turn the balls' remembered paths into a list of straight pieces for
  // the trail shader. Each piece: start (x, y, z), end (x, y, z), colour
  // (r, g, b), and how visible its start and its end are. Returns how many
  // pieces there are.
  fillTrails(balls, count, now, seconds) {
    // Make more room if the trails need it (up to MAX_TRAIL_PIECES). Many
    // long trails need a lot of memory (17 MB for 1000 balls), so the room
    // is only made when it is actually used.
    let needed = 0;
    for (let i = 0; i < count; i++) needed += Math.max(0, balls[i].trail.length / 4 - 1);
    const room = this.trailPieces.length / TRAIL_PIECE_NUMBERS;
    if (needed > room && room < MAX_TRAIL_PIECES) {
      let more = room;
      while (more < needed && more < MAX_TRAIL_PIECES) more *= 2;
      more = Math.min(more, MAX_TRAIL_PIECES);
      this.trailPieces = new Float32Array(more * TRAIL_PIECE_NUMBERS);
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trails.pieceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.trailPieces.byteLength, gl.DYNAMIC_DRAW);
    }
    const out = this.trailPieces;
    const most = out.length / TRAIL_PIECE_NUMBERS;
    let pieces = 0;
    // A point fades with its age: fully visible now, gone after `seconds`.
    const fade = (time) => TRAIL_OPACITY * Math.max(0, 1 - Math.abs(now - time) / seconds);

    for (let i = 0; i < count; i++) {
      const trail = balls[i].trail;   // x, y, z, time, x, y, z, time, ...
      const [r, g, b] = hexToRgb(balls[i].color);
      for (let k = 0; k + 7 < trail.length && pieces < most; k += 4) {
        let at = pieces * TRAIL_PIECE_NUMBERS;
        out[at++] = trail[k];     out[at++] = trail[k + 1]; out[at++] = trail[k + 2];   // start
        out[at++] = trail[k + 4]; out[at++] = trail[k + 5]; out[at++] = trail[k + 6];   // end
        out[at++] = r; out[at++] = g; out[at++] = b;
        out[at++] = fade(trail[k + 3]);
        out[at++] = fade(trail[k + 7]);
        pieces++;
      }
    }
    return pieces;
  }

  // Fill the shadow grid (explained in shaders.js, at shadowAt).
  //
  // Seen from the lamp, a point is at  sideways distance ÷ distance away
  // from the lamp (in the direction the lamp looks: `below` it, for the
  // usual lamp overhead). For a ball, every point on it is at most one radius away from
  // its centre in each direction, which gives a small rectangle of the
  // lamp's view that the ball can cover. The ball is listed in every grid
  // cell that rectangle touches (plus one extra cell around it, so the
  // smoothed shadow edges are never cut off).
  fillShadowGrid(balls, count, lamp) {
    // First where each ball is in the lamp's view: the lowest and highest
    // "seen" value any point of it can have, sideways and up:
    // (side ± r) / (below ± r), whichever is smallest and largest.
    // (Written out with plain numbers: this runs for every ball in every frame.)
    const seen = this.shadowSeen?.length >= 4 * count ? this.shadowSeen : (this.shadowSeen = new Float64Array(4 * MAX_BALLS));
    const L = lamp.position, F = lamp.forward, S = lamp.side, U = lamp.up;
    let range = 0.05;
    for (let i = 0; i < count; i++) {
      const r = balls[i].radius, p = balls[i].position;
      const fx = p.x - L.x, fy = p.y - L.y, fz = p.z - L.z;     // from the lamp to the ball
      const below = fx * F.x + fy * F.y + fz * F.z;              // how far away from the lamp
      if (below - r <= 0) { seen[4 * i] = NaN; continue; }      // at or behind the lamp: no shadow
      const near = 1 / (below - r), far = 1 / (below + r);
      const side = fx * S.x + fy * S.y + fz * S.z, up = fx * U.x + fy * U.y + fz * U.z;
      const a = Math.min((side - r) * near, (side - r) * far), b = Math.max((side + r) * near, (side + r) * far);
      const c = Math.min((up - r) * near, (up - r) * far), d = Math.max((up + r) * near, (up + r) * far);
      seen[4 * i] = a; seen[4 * i + 1] = b; seen[4 * i + 2] = c; seen[4 * i + 3] = d;
      range = Math.max(range, -a, b, -c, d);
    }
    // The grid only needs to cover the balls: a point can only be in shadow
    // if a ball sits on its line to the lamp, and then the point is seen
    // where that ball is. (Sizing it for every place a ball could be made
    // the cells huge with a tilted lamp and no box: hundreds of balls per
    // cell.) Balls seen at a very grazing angle would still stretch it, so
    // it stops at MAX_SHADOW_RANGE; beyond that, balls and points alike are
    // put in the outermost cells, which keeps those shadows right too.
    range = Math.min(range * 1.02, MAX_SHADOW_RANGE);
    this.shadowRange = range;

    const cellsPerUnit = SHADOW_GRID / (2 * range);
    const toCell = (v) => Math.floor((v + range) * cellsPerUnit);
    const clamp = (c) => Math.min(SHADOW_GRID - 1, Math.max(0, c));
    const box = this.shadowBoxes?.length >= 4 * count ? this.shadowBoxes : (this.shadowBoxes = new Int32Array(4 * MAX_BALLS));
    for (let i = 0; i < count; i++) {
      box[4 * i] = 0; box[4 * i + 1] = -1; box[4 * i + 2] = 0; box[4 * i + 3] = -1;
      if (Number.isNaN(seen[4 * i])) continue;
      box[4 * i]     = clamp(toCell(seen[4 * i]) - 1);
      box[4 * i + 1] = clamp(toCell(seen[4 * i + 1]) + 1);
      box[4 * i + 2] = clamp(toCell(seen[4 * i + 2]) - 1);
      box[4 * i + 3] = clamp(toCell(seen[4 * i + 3]) + 1);
    }

    // ... then count how many balls each cell lists, which says where each
    // cell's list starts ...
    const counts = this.shadowCount;
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      for (let z = box[4 * i + 2]; z <= box[4 * i + 3]; z++) {
        for (let x = box[4 * i]; x <= box[4 * i + 1]; x++) counts[z * SHADOW_GRID + x]++;
      }
    }
    let total = 0;
    const MOST = 1048575;   // (the start must fit in 20 bits; far more than any scene needs)
    for (let c = 0; c < counts.length; c++) {
      if (total + counts[c] > MOST) counts[c] = Math.max(0, MOST - total);
      this.shadowCells[c] = total * 4096 + counts[c];
      total += counts[c];
    }
    this.makeShadowListRoom(total);

    // ... and finally write the ball numbers into the lists.
    const next = this.shadowNext?.length === counts.length ? this.shadowNext : (this.shadowNext = new Uint32Array(counts.length));
    for (let c = 0; c < counts.length; c++) next[c] = Math.floor(this.shadowCells[c] / 4096);
    for (let i = 0; i < count; i++) {
      for (let z = box[4 * i + 2]; z <= box[4 * i + 3]; z++) {
        for (let x = box[4 * i]; x <= box[4 * i + 1]; x++) {
          const c = z * SHADOW_GRID + x;
          if (next[c] < Math.floor(this.shadowCells[c] / 4096) + (this.shadowCells[c] & 4095)) this.shadowList[next[c]++] = i;
        }
      }
    }
    return total;
  }

  // No shadows: every cell's list is empty.
  emptyShadowGrid() {
    this.shadowRange = 1;
    this.shadowCells.fill(0);
    this.shadowCount.fill(0);
    return 0;
  }

  // Make sure the list of all cells' lists has room for `entries` ball
  // numbers (in whole texture rows), making it bigger if not.
  makeShadowListRoom(entries) {
    const rows = Math.max(1, Math.ceil(entries / SHADOW_LIST_WIDTH));
    if (this.shadowList && this.shadowList.length >= rows * SHADOW_LIST_WIDTH) return;
    const gl = this.gl;
    let size = this.shadowList ? this.shadowList.length / SHADOW_LIST_WIDTH : 64;
    while (size < rows) size *= 2;
    this.shadowList = new Uint16Array(size * SHADOW_LIST_WIDTH);
    if (this.shadowListTexture) gl.deleteTexture(this.shadowListTexture);
    this.shadowListTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowListTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, SHADOW_LIST_WIDTH, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
  }

}


// =============================================================================
// Helpers for building shapes and shader programs.
// =============================================================================

// 0xRRGGBB → [r, g, b] with each part between 0 and 1.
function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// Screen colour (sRGB) → linear light. Same formula as toLinear() in shaders.js.
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// The off-screen picture the scene is drawn into. It holds linear light:
// the shaders write it, and blending — mixing a new colour with the one
// already there — happens in linear light, as it should.
//
// Its colour format is RGBA16F: 16-bit floating-point numbers, so it can
// keep light brighter than white (above 1), which only an HDR screen can
// show (see hdr.js). On an ordinary screen the copy to the canvas cuts
// everything at white, which looks exactly as before. Where the graphics
// card can't draw into floats, the older SRGB8_ALPHA8 is used: 8 bits per
// channel stored as screen colours, which is enough for everything up to
// white. (Both blend without any extension; a 16-bit float picture takes
// twice the memory traffic, which these simple shaders hardly notice.)
// A depth buffer next to it remembers how far away each pixel's surface is.
function createLinearTarget(gl, width, height, float) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RGBA16F : gl.SRGB8_ALPHA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

  // A second, depth-only picture for the cheap first pass: how far away the
  // nearest ball is at each pixel. It is a texture, so the main pass can read it.
  const frontDepth = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, frontDepth);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const frontFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frontFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, frontDepth, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    framebuffer, texture, frontFramebuffer, frontDepth, width, height, complete,
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteRenderbuffer(depth);
      gl.deleteFramebuffer(frontFramebuffer);
      gl.deleteTexture(frontDepth);
    },
  };
}

// Compile a vertex + fragment shader pair and link them into a program.
// Also looks up where every uniform lives, so later we can simply write
// program.uniforms.uColor instead of calling gl.getUniformLocation each time.
function createProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile error:\n' + gl.getShaderInfoLog(shader));
    }
    return shader;
  };

  const handle = gl.createProgram();
  gl.attachShader(handle, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(handle, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    throw new Error('Shader link error:\n' + gl.getProgramInfoLog(handle));
  }

  const uniforms = {};
  const total = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < total; i++) {
    const name = gl.getActiveUniform(handle, i).name.replace(/\[0\]$/, '');  // "uBalls[0]" → "uBalls"
    uniforms[name] = gl.getUniformLocation(handle, name);
  }
  return { handle, uniforms };
}

// Put a list of numbers in a GPU buffer and tell WebGL that attribute
// number `location` reads `size` numbers per vertex from it.
function addAttribute(gl, location, size, numbers) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(numbers), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

// A 2D square from (-1,-1) to (1,1), four corners in "triangle strip" order.
// The floor, wall and ball shaders place it in 3D.
function createSquare(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  addAttribute(gl, 0, 2, [-1, -1, -1, 1, 1, -1, 1, 1]);
  gl.bindVertexArray(null);
  return { vao };
}

// The shape for the trails: one small rectangle that is drawn once for every
// piece of trail ("instancing"). The corner positions are the same for all
// pieces; the piece buffer holds, per piece, the numbers listed in
// fillTrails() — the divisor of 1 tells WebGL "one set per piece".
function createTrailMesh(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  addAttribute(gl, 0, 2, [-1, -1, -1, 1, 1, -1, 1, 1]);

  const pieceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pieceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, FIRST_TRAIL_PIECES * TRAIL_PIECE_NUMBERS * 4, gl.DYNAMIC_DRAW);
  const bytesPerPiece = TRAIL_PIECE_NUMBERS * 4;   // 4 bytes per number
  // [attribute location, how many numbers, which number of the piece it starts at]
  for (const [location, size, start] of [[1, 3, 0], [2, 3, 3], [3, 3, 6], [4, 2, 9]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, bytesPerPiece, start * 4);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return { vao, pieceBuffer };
}

// Work out where a wall is and which two directions lie flat inside it.
function describeWall(normal) {
  // Any direction not parallel to the normal will do as a starting point.
  const helper = Math.abs(normal.y) > 0.5 ? new Vec3(1, 0, 0) : new Vec3(0, 1, 0);
  const axisU = helper.cross(normal).normalize();
  const axisV = normal.cross(axisU);

  // The walls on the other side of this wall's four edges, as positions in
  // the WALL_NORMALS list, in the order +U, -U, +V, -V. (The edge at the
  // +U end of this wall is where the wall facing +U begins, and so on.)
  const indexOf = (dir) => WALL_NORMALS.findIndex((n) => n.dot(dir) > 0.99);
  const neighbours = [axisU, axisU.negate(), axisV, axisV.negate()].map(indexOf);

  return { normal, center: normal.scale(BOX_HALF_SIZE), axisU, axisV, neighbours };
}
