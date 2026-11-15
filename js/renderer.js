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

import { BOX_HALF_SIZE, WALL_NORMALS } from './physics.js';
import { Vec3 } from './math.js';
import * as Shaders from './shaders.js';

const { MAX_BALLS, SHADOW_GRID, SHADOW_SLOTS } = Shaders;

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
const FLOOR_LIMIT = 60;

// The floor is drawn this far below the bottom of the box, so that it
// never fights with the bottom grid over which is in front.
const FLOOR_GAP = 0.01;
const SHADOW_STRENGTH = 0.4;    // 40 % darker in full shadow

// Trails: the fading lines behind the balls.
const TRAIL_WIDTH = 3;          // in CSS pixels
const TRAIL_OPACITY = 0.9;      // at the ball; fades to 0 at the old end
const MAX_TRAIL_PIECES = 40960; // most straight pieces drawn per frame (100 balls × 400 fit)
const TRAIL_PIECE_NUMBERS = 11; // numbers sent per piece: 2 ends, colour, 2 fades

// Big pixels (renderer.pixelSize above 1): draw the scene the way an old
// computer would have shown it — with far fewer pixels, blown up into big
// squares, with hard edges and the Amiga's 4096 colours (16 levels each of
// red, green and blue).
const AMIGA_COLOR_LEVELS = 15;   // 16 levels: 0 … 15
const HARD_EDGE = 0.001;         // an edge "blended" over a 1000th of a pixel: not at all

// Never render at more than 2 pixels per CSS pixel: phones with 3x screens
// would otherwise draw over twice as many pixels for no visible gain.
const MAX_PIXEL_RATIO = 2;


export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;

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

    // Upload the shapes. Walls and balls are both drawn as flat squares.
    this.square = createSquare(gl);
    this.emptyVao = gl.createVertexArray();   // for the copy-to-screen step
    this.walls = WALL_NORMALS.map(describeWall);
    this.trails = createTrailMesh(gl);
    this.trailPieces = new Float32Array(MAX_TRAIL_PIECES * TRAIL_PIECE_NUMBERS);

    // Reusable arrays for sending ball data to the GPU each frame.
    // The ball list for the shaders, laid out exactly like the "Balls"
    // block in shaders.js: all centres+radii, then all colours, then all
    // rotations. Every entry is a group of 4 numbers (std140 rules), and a
    // rotation is 3 such groups.
    this.ballBlock = new Float32Array(MAX_BALLS * (4 + 4 + 12));
    this.ballBuffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ballBuffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.ballBlock.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ballBuffer);   // "slot" 0
    // Tell every program that its "Balls" block reads from slot 0.
    for (const program of [this.floorProgram, this.wallProgram, this.ballProgram, this.ballDepthProgram]) {
      const block = gl.getUniformBlockIndex(program.handle, 'Balls');
      if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program.handle, block, 0);
    }
    this.drawOrder = new Int32Array(MAX_BALLS);
    this.rotation = new Float32Array(9);

    // The shadow grid: for each of 64 × 64 cells (as seen from the lamp), a
    // list of up to 32 ball numbers, ended by 255. Stored as a small texture
    // of whole numbers, one row per row of cells.
    this.shadowGrid = new Uint8Array(SHADOW_GRID * SHADOW_SLOTS * SHADOW_GRID);
    this.shadowCount = new Uint8Array(SHADOW_GRID * SHADOW_GRID);
    this.shadowTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, SHADOW_GRID * SHADOW_SLOTS, SHADOW_GRID);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);

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

    // The cheap first pass that lets hidden pixels skip their work. On a real
    // graphics card it should save time with many overlapping balls; set to
    // false (e.g. boing.renderer.skipHidden = false in the console) to compare.
    this.skipHidden = true;
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
    this.canvas.style.imageRendering = this.pixelated ? 'pixelated' : '';
    const width = Math.max(1, Math.round(this.canvas.clientWidth * this.pixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * this.pixelRatio));
    if (this.target && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.target) this.target.dispose();
    this.target = createLinearTarget(gl, width, height);
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
  draw(camera, balls, options = {}) {
    const showGrid = options.grid ?? true;
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
    const distance = Math.max(stage.lightHeight, Math.max(stage.top, stage.reach) + MIN_LAMP_CLEARANCE);
    const tilt = (stage.lightTilt * Math.PI) / 180;
    const light = new Vec3(-LAMP_SIDE_STEP * Math.sin(tilt), Math.cos(tilt), Math.sin(tilt)).scale(distance);

    // The lamp looks at the middle of the room. "Sideways" and "up" in its
    // view are two directions at right angles to that.
    const forward = light.scale(-1).normalize();
    const up = forward.cross(new Vec3(1, 0, 0)).normalize();
    const side = up.cross(forward);
    const lamp = { position: light, forward, side, up };

    // How much of the lamp's view the shadow grid must cover: the largest
    // "sideways ÷ distance away" of any corner of the space the balls can
    // be in (see fillShadowGrid).
    let shadowRange = 0;
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
          const away = Math.max(0.5, corner.dot(forward));
          shadowRange = Math.max(shadowRange, Math.abs(corner.dot(side)) / away, Math.abs(corner.dot(up)) / away);

          const drop = light.y - y;   // how far the lamp is above this corner
          const stretch = drop > 0.5 ? (light.y - floorY) / drop : Infinity;
          const landsAt = light.add(corner.scale(stretch));
          const reach = Math.max(Math.abs(landsAt.x), Math.abs(landsAt.z));
          floorHalfSize = Math.max(floorHalfSize, Number.isFinite(reach) ? Math.min(reach, FLOOR_LIMIT) : FLOOR_LIMIT);
        }
      }
    }
    shadowRange *= 1.05;
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

    // Pack the ball data into flat number arrays for the GPU.
    for (let i = 0; i < count; i++) {
      const b = balls[i];
      const block = this.ballBlock;
      block.set([b.position.x, b.position.y, b.position.z, b.radius], i * 4);
      block.set([...hexToRgb(b.color), b.squares], MAX_BALLS * 4 + i * 4);
      // A rotation is 3 columns of 3 numbers; each column gets a 4th, unused number.
      b.orientation.toMat3(this.rotation);
      const r = this.rotation, at = MAX_BALLS * 8 + i * 12;
      block.set([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0], at);
    }

    // Farthest ball first, so nearer balls are drawn over farther ones.
    const order = [...Array(count).keys()].sort(
      (a, b) => balls[b].position.distanceSq(eye) - balls[a].position.distanceSq(eye));
    this.drawOrder.set(order);

    // Send the ball list to the graphics card (one upload for all shaders).
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ballBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.ballBlock);

    // Work out which balls can cast shadows where, and send that too.
    // Without shadows the grid is simply left empty ("no ball can shadow
    // anything"), so every shadow test finishes at once.
    if (showShadows) this.fillShadowGrid(balls, count, lamp, shadowRange);
    else this.shadowGrid.fill(255);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_GRID * SHADOW_SLOTS, SHADOW_GRID,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.shadowGrid);
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
      gl.uniform1i(u.uShadowGrid, 1);   // the shadow grid is on texture unit 1
      gl.uniform1i(u.uFrontDepth, 2);   // the front-depth picture is on unit 2
      gl.uniform1iv(u.uDrawOrder, this.drawOrder);
      return u;
    };

    // ---- Step 1: the cheap first pass. Draw all balls, recording only how
    // far away the nearest one is at each pixel (see "Skipping hidden pixels"
    // in shaders.js). Everything farther away can then skip its work.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.frontFramebuffer);
    gl.viewport(0, 0, this.target.width, this.target.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);   // "nothing in front" everywhere
    gl.enable(gl.DEPTH_TEST);
    if (this.skipHidden) {
      setShared(this.ballDepthProgram);
      gl.bindVertexArray(this.square.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.target.frontDepth);
    gl.activeTexture(gl.TEXTURE0);

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

        // Shadows fall on the four side walls and on the ceiling (which a
        // lamp tilted to the front can reach). The bottom of the box lies
        // on the floor, which shows them already. Wall 0 in the list is the
        // bottom, wall 1 the ceiling.
        const catches = (other) => other >= 1;
        gl.uniform1f(u.uCatchShadows, showShadows && catches(index) ? 1 : 0);
        // ...and a good way past each edge where the next such wall is hidden.
        // (At the bottom they reach the hair's breadth down to where the
        // floor is drawn, so that wall and floor meet exactly.)
        gl.uniform4f(u.uExtend, ...wall.neighbours.map((other) => {
          if (!catches(index)) return 0;
          if (other === 0) return FLOOR_GAP;
          return catches(other) && !visible[other] ? wallShadowExtend : 0;
        }));


        // Each edge of the box is shared by two walls. If both walls drew
        // the line along it, it would be blended twice and look darker than
        // the other lines. So it is drawn by just one of them: the one that
        // comes first in the list, unless the other wall is hidden.
        const drawEdge = wall.neighbours.map((other) => (!visible[other] || index < other ? 1 : 0));
        gl.uniform4f(u.uDrawEdge, ...drawEdge);

        gl.uniform3f(u.uWallCenter, wall.center.x, wall.center.y, wall.center.z);
        gl.uniform3f(u.uWallAxisU, wall.axisU.x, wall.axisU.y, wall.axisU.z);
        gl.uniform3f(u.uWallAxisV, wall.axisV.x, wall.axisV.y, wall.axisV.z);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });

      gl.depthMask(true);
    }

    // --- 3. Balls: one square each, all in a single instanced draw call,
    //     farthest first. Their smoothed outlines blend over what's behind.
    {
      setShared(this.ballProgram);
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

    // ---- Step 3: copy to the canvas, converting back to screen colours.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.presentProgram.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
    gl.uniform1i(this.presentProgram.uniforms.uScene, 0);
    gl.uniform1f(this.presentProgram.uniforms.uColorLevels, this.pixelated ? AMIGA_COLOR_LEVELS : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

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
    const out = this.trailPieces;
    let pieces = 0;
    // A point fades with its age: fully visible now, gone after `seconds`.
    const fade = (time) => TRAIL_OPACITY * Math.max(0, 1 - Math.abs(now - time) / seconds);

    for (let i = 0; i < count; i++) {
      const trail = balls[i].trail;   // x, y, z, time, x, y, z, time, ...
      const [r, g, b] = hexToRgb(balls[i].color);
      for (let k = 0; k + 7 < trail.length && pieces < MAX_TRAIL_PIECES; k += 4) {
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
  fillShadowGrid(balls, count, lamp, range) {
    this.shadowGrid.fill(255);   // 255 = end of list
    this.shadowCount.fill(0);
    const cellsPerUnit = SHADOW_GRID / (2 * range);
    const toCell = (seen) => Math.floor((seen + range) * cellsPerUnit);

    for (let i = 0; i < count; i++) {
      const r = balls[i].radius;
      const fromLamp = balls[i].position.sub(lamp.position);
      const below = fromLamp.dot(lamp.forward);       // how far away from the lamp
      if (below - r <= 0) continue;                    // (never happens in the box)
      const range = (side) => {
        // The lowest and highest "seen" value any point of the ball can have.
        const options = [(side - r) / (below - r), (side - r) / (below + r),
                         (side + r) / (below - r), (side + r) / (below + r)];
        return [toCell(Math.min(...options)) - 1, toCell(Math.max(...options)) + 1];
      };
      const [x0, x1] = range(fromLamp.dot(lamp.side));
      const [z0, z1] = range(fromLamp.dot(lamp.up));

      for (let z = Math.max(0, z0); z <= Math.min(SHADOW_GRID - 1, z1); z++) {
        for (let x = Math.max(0, x0); x <= Math.min(SHADOW_GRID - 1, x1); x++) {
          const cell = z * SHADOW_GRID + x;
          const n = this.shadowCount[cell];
          if (n < SHADOW_SLOTS) {
            this.shadowGrid[z * SHADOW_GRID * SHADOW_SLOTS + x * SHADOW_SLOTS + n] = i;
            this.shadowCount[cell] = n + 1;
          }
        }
      }
    }
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

// The off-screen picture the scene is drawn into.
//
// Its colour format, SRGB8_ALPHA8, is the trick behind linear-light blending:
// shaders write linear light, the graphics card stores it as screen colours
// (so 8 bits per channel are plenty), and blending — mixing a new colour
// with the one already there — is done in linear light automatically.
// A depth buffer next to it remembers how far away each pixel's surface is.
function createLinearTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

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
    framebuffer, texture, frontFramebuffer, frontDepth, width, height,
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
  gl.bufferData(gl.ARRAY_BUFFER, MAX_TRAIL_PIECES * TRAIL_PIECE_NUMBERS * 4, gl.DYNAMIC_DRAW);
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
