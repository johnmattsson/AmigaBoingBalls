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
import { effectLook } from './effect-options.js';

const { MAX_BALLS, SHADOW_GRID, SHADOW_LIST_WIDTH } = Shaders;
const SHADOW_EDGE_PIXELS = 2;   // how many pixels' width a shadow's soft edge can reach, safely (see prepare)
const MAX_SHADOW_RANGE = 3;   // the shadow grid covers at most ±3 sideways per 1 away from the lamp

// --- Look of the scene -------------------------------------------------------

export const BACKGROUND = hexToRgb(0xaaaaaa);   // light grey, same as the floor
const GRID_COLOR = hexToRgb(0xaa00aa);   // purple
const GRID_OPACITY = 0.6;                // 60 % purple, 40 % grey showing through
const GRID_LINE_WIDTH = 1;               // in CSS pixels

// The shade a grid line has where it fully covers a pixel. Release 1.3 drew
// the lines 60 % see-through over the grey; we work out that resulting shade
// once, so the lines look exactly as before.
const GRID_SHADE = GRID_COLOR.map((c, i) => GRID_OPACITY * c + (1 - GRID_OPACITY) * BACKGROUND[i]);

// The grid's colour over each backdrop, and how see-through its lines are:
// purple as on the grey (it suits the dark copper sky and the night of the
// stars); over the bright, many-coloured plasma, where purple drowns, a dark
// navy; over the Kefrens bars, white.
const GRID_OVER = {
  bars: { color: GRID_COLOR, opacity: GRID_OPACITY },
  stars: { color: GRID_COLOR, opacity: GRID_OPACITY },
  plasma: { color: hexToRgb(0x101040), opacity: 0.55 },
  kefrens: { color: hexToRgb(0xffffff), opacity: 0.6 },
};
// The grid's colour and opacity for these drawing options: solid in the
// purple-over-grey shade without a backdrop (see GRID_SHADE).
export function gridLook(options) {
  if (!options.copper) return { color: GRID_SHADE, opacity: 1 };
  return GRID_OVER[options.backdrop] ?? GRID_OVER.bars;
}

// The backdrops (the Backdrop setting; see the copper shader in shaders.js).
// The last three are pictures: the demo effects (see twist.js and
// effects.js), drawn into a picture of their own each frame, which the
// backdrop shader then shows; so everything else, the shadows, the grid, the
// balls and their trails, comes in front of them as in front of any backdrop.
export const BACKDROPS = ['bars', 'stars', 'plasma', 'kefrens', 'twist', 'bobs', 'tunnel'];
const PICTURE_BACKDROPS = ['twist', 'bobs', 'tunnel'];
// Is an effect the backdrop, with these drawing options? (options.effect:
// what draws it, { gl(canvas), gpu(canvas, device), glow }; see main.js.)
export const pictureBackdrop = (options) => Boolean(options.copper && options.effect && PICTURE_BACKDROPS.includes(options.backdrop));

// --- Colour on wide-colour (Display P3) screens ------------------------------
//
// Every colour in the scene is given in sRGB (as on the web). On a Display P3
// screen it is converted exactly, so it looks the same as on an ordinary
// screen: SRGB_TO_P3 turns linear sRGB light into linear P3 light (its rows;
// the shaders keep their own copy). Grey and white stay as they are.
export const SRGB_TO_P3 = [
  [0.8224620, 0.1775380, 0],
  [0.0331942, 0.9668058, 0],
  [0.0170826, 0.0723974, 0.9105199],
];
// The one exception: the four ball colours are the NCS elementary colours
// (BALL_COLORS in physics.js), which sRGB can only approximate. A P3 screen
// can come closer, so there they move from the sRGB colour straight towards
// the true NCS colour (in CIELAB), as far as P3 reaches; the hue stays:
//   red    #C40233 → P3 (192, 0, 51)     yellow #FFD300 → P3 (253, 221, 0)
//   blue   #0087BD → P3 (0, 131, 193)    green  #009F6B → P3 (0, 162, 105)
// They are given here as the sRGB numbers that make those P3 colours (some
// below 0 or above 1: outside what sRGB can show), so the scene can treat
// them as any other colour.
export const ELEMENTARY_IN_P3 = new Map([
  [0xc40233, [0.8242, -0.1608, 0.1756]],
  [0xffd300, [1.0176, 0.8609, -0.3058]],
  [0x0087bd, [-0.2504, 0.5236, 0.7784]],
  [0x009f6b, [-0.3157, 0.6472, 0.3911]],
]);
// On a screen that shows even more, close to Rec. 2020 (TV's wide colour),
// they go on along the same line as far as Rec. 2020 reaches: about a third
// more colourful again (green and blue the most). Only with WebGPU and HDR
// on: then the canvas takes colours beyond P3, and the screen shows what it
// can of them (see colourLevel in gpu-renderer.js):
//   red    → Rec. 2020 (185, 0, 42)     yellow → Rec. 2020 (243, 224, 0)
//   blue   → Rec. 2020 (0, 124, 212)    green  → Rec. 2020 (0, 167, 93)
export const ELEMENTARY_IN_2020 = new Map([
  [0xc40233, [0.9059, -0.2723, 0.1406]],
  [0xffd300, [1.0212, 0.8716, -0.3339]],
  [0x0087bd, [-0.4457, 0.5113, 0.8618]],
  [0x009f6b, [-0.5210, 0.6906, 0.3214]],
]);
// Is the screen a wide-colour one? (Only then do the ball colours change.)
const p3Screen = typeof matchMedia === 'function' ? matchMedia('(color-gamut: p3)') : null;
export const onP3Screen = () => Boolean(p3Screen?.matches);
// And one that shows about as much as Rec. 2020? (see ELEMENTARY_IN_2020)
const rec2020Screen = typeof matchMedia === 'function' ? matchMedia('(color-gamut: rec2020)') : null;
export const onRec2020Screen = () => Boolean(rec2020Screen?.matches);

// A ball's colour, as the scene uses it: sRGB numbers between 0 and 1, or on
// a wide-colour screen, for the four elementary colours, the numbers above.
// (wide: false or 0 = sRGB, true or 1 = Display P3, 2 = Rec. 2020.)
export function ballRgb(hex, wide) {
  const table = wide === 2 ? ELEMENTARY_IN_2020 : wide ? ELEMENTARY_IN_P3 : null;
  return table?.get(hex) || hexToRgb(hex);
}

// Linear sRGB light → the canvas's linear light (P3 when wide).
export function toCanvasLight(rgb, wide) {
  if (!wide) return rgb;
  return SRGB_TO_P3.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}


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
export const SHADOW_STRENGTH = 0.4;    // 40 % darker in full shadow
// (The colour of a shadow on the plain grey, and "none": made once.)
const SHADOWED_BACKGROUND = BACKGROUND.map((c) => srgbToLinear(c * (1 - SHADOW_STRENGTH)));
const NO_COLOR = [0, 0, 0];

// Trails: the fading lines behind the balls.
const TRAIL_WIDTH = 3;          // in CSS pixels
export const TRAIL_OPACITY = 0.9;      // at the ball; fades to 0 at the old end
// How a trail fades along its length (see sendTrails): 1, evenly, for an
// ordinary one; for a longer trail (span seconds, the setting `seconds`) a
// power that keeps it strong for longer, up to 8.
export const trailPower = (span, seconds) => Math.min(8, (span / seconds) ** 2);
const MAX_TRAIL_PIECES = 400000; // most straight pieces drawn per frame (1000 balls × 400 fit)
const FIRST_TRAIL_PIECES = 40960; // room made at the start; it grows when more is needed
export const BALL_NUMBERS = 10;          // per ball from the physics (see snapshot in physics-host.js)
export const BALL_TABLE_COLUMNS = 6;     // groups of 4 numbers per ball in the ball table
const TRAIL_PIECE_NUMBERS = 11; // numbers sent per piece: 2 ends, colour, 2 fades

// Big pixels (renderer.pixelSize above 1): draw the scene the way an old
// computer would have shown it — with far fewer pixels, blown up into big
// squares with hard edges (in all colours).

// Light brighter than white. An ordinary screen cuts it at white; an HDR
// screen shows it, up to HDR_RANGE times white (see gpu-renderer.js; only when
// drawn with WebGPU: see gpu-renderer.js).
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
const EDGE_UNITS = 0.05;        // see edgeUnits in measure
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

// What both renderers share: everything about the scene that is worked out
// on the main processor each frame, before the graphics card is told to
// draw — the lamp, the floor's size, the balls' drawing order, the ball
// table, the shadow grid, which walls show, and the trails. This class
// (WebGL2) and GpuRenderer in gpu-renderer.js (WebGPU, used for HDR) each
// send it on and draw with it in their own way.
export class SceneRenderer {
  // Are colours converted to Display P3 for the canvas (see SRGB_TO_P3)?
  // Only on a wide-colour screen: on an ordinary one, the canvas shows
  // sRGB colours as they are.
  get canvasIsWide() {
    return this.wideColor && this.wideColorSupported !== false && onP3Screen();
  }
  // How far the ball colours go: 0 = sRGB, 1 = Display P3, 2 = Rec. 2020
  // (only with WebGPU: see there).
  get colourLevel() { return this.canvasIsWide ? 1 : 0; }

  constructor(view) {
    this.view = view;
    // HDR, if switched on (WebGPU only: see gpu-renderer.js).
    this.hdr = null;
    this.wideColor = false;   // see setWideColor() (main.js switches it on)
    this.walls = WALL_NORMALS.map(describeWall);
    this.trailPieces = new Float32Array(FIRST_TRAIL_PIECES * TRAIL_PIECE_NUMBERS);

    // The ball table for the shaders (see BALL_LIST in shaders.js): one row
    // of 6 × 4 numbers per ball. Sent anew every frame.
    this.ballTable = new Float32Array(MAX_BALLS * BALL_TABLE_COLUMNS * 4);
    this.rotation = new Float32Array(9);
    this.drawOrder = new Int32Array(MAX_BALLS);       // ball numbers, farthest first
    this.drawDistance = new Float64Array(MAX_BALLS);  // how far each ball is from the eye (see prepare)
    this.drawCount = -1;

    // The shadow grid (see "Shadows" in shaders.js): for each of the
    // 192 × 192 cells of the lamp's view, a list of the balls that can cast
    // a shadow there. All the lists are kept one after another in
    // `shadowList`; for each cell, `shadowCells` holds where its list starts
    // and how long it is.
    const cells = SHADOW_GRID * SHADOW_GRID;
    // (Both in one number per cell: start × 4096 + length, which halves what
    // has to be sent each frame. A list holds at most 4000 balls, below 4096.)
    this.shadowCells = new Uint32Array(cells);
    this.shadowCount = new Uint32Array(cells);        // how many balls each cell lists
    this.shadowList = null;          // made (and made bigger) by makeShadowListRoom()

    this.pixelRatio = 1;
    // How many screen points (CSS pixels) wide and high one drawn pixel is.
    // 1 = as sharp as the screen allows; more = big pixels (see above).
    // Call resize() after changing it.
    this.pixelSize = 1;
    this.pixelated = false;   // set by resize(): is pixelSize above 1?
    this.edgeUnits = EDGE_UNITS;   // set by resize() too (see measure)

    // Measuring how long the graphics card works on each frame (for the
    // Info page): see the WebGL renderer. Elsewhere it shows as "n/a".
    this.gpuTimer = null;
    this.measureGpu = false;   // switched on by main.js while the Info page is shown
    this.gpuTotalMs = 0;       // summed measurements, read and reset by main.js
    this.gpuFrames = 0;
  }

  // How many pixels to draw, to match the view's size on screen.
  // Normally: as many pixels as the screen has. With big pixels: fewer,
  // and the browser is told to blow them up into crisp squares instead
  // of blurring them.
  // (A big pixel is made a whole number of the screen's own pixels wide —
  // 3, not 2.5 — or some would come out wider than others.)
  measure() {
    this.pixelated = this.pixelSize > 1;
    const screenRatio = window.devicePixelRatio || 1;
    const bigPixel = Math.max(1, Math.round(this.pixelSize * screenRatio)) / screenRatio;
    // (boing.renderer.testPixelRatio = 1.5, then boing.renderer.resize(), in
    // the console: fewer pixels, to measure what they cost.)
    this.pixelRatio = this.pixelated ? 1 / bigPixel : Math.min(screenRatio, this.testPixelRatio ?? MAX_PIXEL_RATIO);
    // (The walls measure how far past their edge a pixel is with at most
    // EDGE_UNITS box units to a pixel, see the wall shader. A big pixel
    // covers as much as several ordinary ones: so many more units. Else a
    // pixel just outside the edge counted as far outside, and the edge
    // lines, drawn hard, came out in pieces.)
    this.edgeUnits = EDGE_UNITS * (this.pixelated ? Math.min(screenRatio, MAX_PIXEL_RATIO) * bigPixel : 1);
    // (Never more pixels across than the graphics card's pictures can be
    // wide or high — 8192 on many — or nothing would be drawn at all: a
    // very wide screen at twice the density, 5120 wide, is 10240 pixels.)
    const most = this.maxPictureSize ?? 8192;
    this.pixelRatio = Math.min(this.pixelRatio, most / Math.max(1, this.view.clientWidth), most / Math.max(1, this.view.clientHeight));
    this.view.style.imageRendering = this.pixelated ? 'pixelated' : '';
    // (The height is kept for prepare: asking the page for it every frame
    // would make the browser lay the page out first whenever anything on it
    // had changed.)
    this.pixelsHigh = Math.max(1, Math.round(this.view.clientHeight * this.pixelRatio));
    return {
      width: Math.max(1, Math.round(this.view.clientWidth * this.pixelRatio)),
      height: this.pixelsHigh,
    };
  }

  setWideColor(on) {
    this.wideColor = on;
    this.applyColorSpace();
  }

  // Everything about the frame that both renderers need (see draw() for
  // the options). Also fills the ball table and the shadow grid.
  prepare(camera, balls, options) {
    const showGrid = options.grid ?? true;
    const strength = options.hdrStrength ?? 1;   // of the light brighter than white
    const showShadows = options.shadows ?? true;
    const edgeWidth = this.pixelated ? HARD_EDGE : EDGE_WIDTH;
    const stage = options.stage ?? BOX_STAGE;   // (main.js always gives the whole stage)
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
    // (reach: how far past a ball's outline its soft shadow edge can go: half
    // the width of the edge, about a pixel at the surface the shadow falls on —
    // see shadowAt in shaders.js — taken where pixels are biggest, at the
    // far side of the box. See fillShadowGrid. On a surface seen almost
    // edge-on a pixel is longer still, and there the edge may come out a
    // hair's breadth narrower, which no one can see.)
    const pixelAngle = 2 / (camera.projection[5] * (this.pixelsHigh ?? 1));
    const farthest = camera.position.length() + 2 * BOX_HALF_SIZE;
    const lamp = { position: light, forward, side, up, reach: SHADOW_EDGE_PIXELS * edgeWidth * pixelAngle * farthest };

    // How much of the lamp's view the shadow grid covers: set by
    // fillShadowGrid, from where the balls are.
    let shadowRange = 1;
    // The floor must be big enough to catch every shadow: see where the
    // lamp throws the shadow of each top corner of that space. (A lamp
    // lower than the corner throws it "to infinity": then we stop at
    // FLOOR_LIMIT.) In the box, a shown wall catches the shadows that pass
    // the end where a hidden wall would be (see "WALLS" in shaders.js), so
    // it reaches as far as the floor.
    // (It only changes with the lamp and the room, so it is worked out again
    // only then, not in every frame.)
    const floorKey = this.floorKey ??= [NaN, NaN, NaN, NaN, NaN, NaN];
    if (floorKey[0] !== light.x || floorKey[1] !== light.y || floorKey[2] !== light.z
        || floorKey[3] !== stage.reach || floorKey[4] !== stage.floorY || floorKey[5] !== stage.top) {
      floorKey[0] = light.x; floorKey[1] = light.y; floorKey[2] = light.z;
      floorKey[3] = stage.reach; floorKey[4] = stage.floorY; floorKey[5] = stage.top;
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
      this.floorHalfSize = floorHalfSize * 1.05;
    }
    const floorHalfSize = this.floorHalfSize;
    const wallShadowExtend = Math.max(0, floorHalfSize - BOX_HALF_SIZE);
    const count = Math.min(balls.length, MAX_BALLS);
    const eye = camera.position;

    // Farthest ball first, so nearer balls are drawn over farther ones.
    // "Farthest" by the eye's squared distance to the centre minus the
    // radius squared (the eye's "power" with respect to the ball): for balls
    // that don't overlap — and hard balls never do — this gives exactly the
    // order in which they hide each other, whatever their sizes. (The plain
    // distance can put a small ball behind a big one it is in front of.)
    // The WebGPU renderer relies on it (see ballVs in gpu-renderer.js).
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
      const r = balls[i].radius;
      away[i] = dx * dx + dy * dy + dz * dz - r * r;
    }
    for (let i = 1; i < count; i++) {
      const ball = order[i], d = away[ball];
      let j = i - 1;
      while (j >= 0 && away[order[j]] < d) { order[j + 1] = order[j]; j--; }
      order[j + 1] = ball;
    }

    // Fill the ball table (see BALL_LIST in shaders.js), one row per ball.
    // (Written number by number: this runs for every ball in every frame.)
    // A renderer that builds it on the graphics card from the physics' own
    // numbers (the WebGPU one: see makeBallTable) only needs the order.
    const table = this.ballTable, r = this.rotation;
    const tableOnGpu = Boolean(this.buildsBallTable && options.ballNumbers?.length >= count * BALL_NUMBERS);
    const wide = this.canvasIsWide;
    for (let i = 0; i < (tableOnGpu ? 0 : count); i++) {
      const b = balls[i], p = b.position, c = b.color;
      let at = i * BALL_TABLE_COLUMNS * 4;
      b.orientation.toMat3(r);
      table[at++] = p.x; table[at++] = p.y; table[at++] = p.z; table[at++] = b.radius;
      const e = wide && ELEMENTARY_IN_P3.get(c);
      if (e) { table[at++] = e[0]; table[at++] = e[1]; table[at++] = e[2]; } else {
        table[at++] = ((c >> 16) & 255) / 255; table[at++] = ((c >> 8) & 255) / 255; table[at++] = (c & 255) / 255;
      }
      table[at++] = b.squares;
      for (let k = 0; k < 9; k += 3) { table[at++] = r[k]; table[at++] = r[k + 1]; table[at++] = r[k + 2]; table[at++] = 0; }
      table[at++] = order[i]; table[at++] = 0; table[at++] = 0; table[at++] = 0;
    }

    // Work out which balls can cast shadows where.
    // Without shadows the grid is simply left empty ("no ball can shadow
    // anything"), so every shadow test finishes at once.
    // (A renderer that builds the grid on the graphics card — the WebGPU one
    // — only needs its range from here.)
    const listed = !showShadows ? this.emptyShadowGrid()
      : this.buildsShadowGrid ? (this.measureShadowRange(balls, count, lamp), 0)
      : this.fillShadowGrid(balls, count, lamp);
    shadowRange = this.shadowRange;

    // How shadows are painted on the floor and walls (see uShadowColor in
    // shaders.js). Plain backdrop: the grey's own shadowed shade, opaque.
    // Copper bars: see-through black that darkens the bars by as much as
    // a shadow darkens the grey.
    const litGrey = srgbToLinear(BACKGROUND[0]);
    const shadowedGrey = srgbToLinear(BACKGROUND[0] * (1 - SHADOW_STRENGTH));
    const shadowColor = options.copper ? NO_COLOR : SHADOWED_BACKGROUND;
    const shadowOpacity = options.copper ? 1 - shadowedGrey / litGrey : 1;

    // A wall is in the way when the camera is on its outside, so only the
    // walls seen from the inside are shown.
    // (The lists below are made once and filled in afresh every frame: no
    // new objects for the same few numbers.)
    const visible = this.wallVisible ??= this.walls.map(() => false);
    for (let i = 0; i < this.walls.length; i++) visible[i] = eye.dot(this.walls[i].normal) <= BOX_HALF_SIZE;

    // Shadows fall on the four side walls and on the ceiling (which a lamp
    // tilted to the front can reach). The bottom of the box lies on the
    // floor, which shows them already. Wall 0 in the list is the bottom,
    // wall 1 the ceiling.
    const catchesShadows = (index) => index >= 1;
    const walls = this.wallFrames ??= this.walls.map((wall) => ({
      wall, shown: false, catchesShadows: false,
      extend: wall.neighbours.map(() => 0), drawEdge: wall.neighbours.map(() => 0),
    }));
    for (let index = 0; index < walls.length; index++) {
      const w = walls[index], neighbours = w.wall.neighbours;
      w.shown = visible[index];
      w.catchesShadows = showShadows && catchesShadows(index);
      for (let k = 0; k < neighbours.length; k++) {
        const other = neighbours[k];
        // Shadows are caught on the wall, and a good way past each edge where
        // the next such wall is hidden. (At the bottom they reach the hair's
        // breadth down to where the floor is drawn, so that wall and floor
        // meet exactly.)
        w.extend[k] = !catchesShadows(index) ? 0 : other === 0 ? FLOOR_GAP
          : catchesShadows(other) && !visible[other] ? wallShadowExtend : 0;
        // Each edge of the box is shared by two walls. If both walls drew
        // the line along it, it would be blended twice and look darker than
        // the other lines. So it is drawn by just one of them: the one that
        // comes first in the list, unless the other wall is hidden.
        w.drawEdge[k] = !visible[other] || index < other ? 1 : 0;
      }
    }
    // Walls 2…5 in the WALL_NORMALS list are left, right, back and front.
    const wallShown = this.wallShown ??= [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) wallShown[k] = showGrid && visible[k + 2] ? 1 : 0;

    return {
      tableOnGpu, showGrid, strength, showShadows, edgeWidth, floorY, light, forward, side, up,
      floorHalfSize, count, eye, listed, shadowRange, shadowColor, shadowOpacity,
      walls, wallShown, shadowReach: lamp.reach,
      glint: (options.glints ?? 0) * (this.hdr ? 1 + GLINT * strength : 1),
      shine: this.hdr ? HDR_SHINE * strength : 0,
      textGlow: TEXT_GLOW * strength,
      lineWidth: Math.max(1, GRID_LINE_WIDTH * this.pixelRatio),   // never thinner than a pixel
      trailWidth: Math.max(1, TRAIL_WIDTH * this.pixelRatio),
    };
  }

  // The Kefrens bars (see kefrens in shaders.js), worked out once per
  // picture here instead of again for every pixel: for each row of pixels,
  // counted from the top, where its bar's middle is (in Amiga units) and
  // how fast that changes from row to row (its slope). Into kefrensData,
  // two numbers per row; returns how many rows.
  kefrensRows(width, height, time) {
    const unit = 256 / height, reach = 0.5 * width * unit - 20;
    const rows = height, room = 2 * Math.ceil(rows / Shaders.KEFRENS_ROWS_WIDE) * Shaders.KEFRENS_ROWS_WIDE;
    if (!this.kefrensData || this.kefrensData.length < room) this.kefrensData = new Float32Array(room);
    const d = this.kefrensData, middle = 0.5 * width * unit;
    // (The two waves' angles grow by the same step from row to row, so each
    // row's sine and cosine follow from the last row's by one small turn —
    // a few multiplications instead of four sines and cosines a row: on an
    // 8K screen, 4320 rows, at 480 pictures a second.)
    let a = 0.5 * unit * 0.055 + 1.3 * time, b = 0.5 * unit * 0.023 - 0.8 * time + 1;
    let sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b);
    const sda = Math.sin(0.055 * unit), cda = Math.cos(0.055 * unit), sdb = Math.sin(0.023 * unit), cdb = Math.cos(0.023 * unit);
    for (let i = 0; i < rows; i++) {
      d[2 * i] = middle + reach * (0.6 * sa + 0.4 * sb);
      d[2 * i + 1] = reach * (0.6 * 0.055 * ca + 0.4 * 0.023 * cb);
      const sa2 = sa * cda + ca * sda, sb2 = sb * cdb + cb * sdb;
      ca = ca * cda - sa * sda; sa = sa2;
      cb = cb * cdb - sb * sdb; sb = sb2;
    }
    return rows;
  }

  // The glowing letters (HDR): where the scroller's picture lies on the
  // canvas (in the canvas's own pixels, counted from the bottom left), or
  // null when it isn't shown.
  // (Measuring where things are on the page makes the browser lay it out
  // first, so the answer is kept until the window or the picture changes
  // size: the strip only moves then.)
  textRect(text, width, height) {
    if (!text) return null;
    const key = `${innerWidth} ${innerHeight} ${width} ${height} ${text.style.height}`;
    if (this.textRectKey !== key) {
      const box = this.view.getBoundingClientRect();
      const strip = text.getBoundingClientRect();
      const sx = width / box.width, sy = height / box.height;
      this.textRectKey = key;
      this.textRectValue = [(strip.left - box.left) * sx, (box.bottom - strip.bottom) * sy, strip.width * sx, strip.height * sy];
    }
    return this.textRectValue;
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
      this.trailRoomGrown();
    }
    const out = this.trailPieces;
    const most = out.length / TRAIL_PIECE_NUMBERS;
    let pieces = 0;
    const wide = this.canvasIsWide;

    for (let i = 0; i < count; i++) {
      const trail = balls[i].trail;   // x, y, z, time, x, y, z, time, ...
      // A point fades with its age, over the trail's whole length: `seconds`,
      // or longer for a ball with a longer trail (see trailScale in
      // physics.js), whose oldest point is then older than that.
      const span = trail.length >= 4 ? Math.max(seconds, Math.abs(now - trail[3])) : seconds;
      // (A longer trail stays strong for most of its length and fades only
      // towards its end: its whole wandering should show.)
      // The more it outgrows the setting, the longer it stays strong: twice
      // as long already fades only in its last fifth. (1 for an ordinary
      // trail: an even fade.) Brownian's big ball has one, and its whole
      // wandering should be easy to follow.
      const power = trailPower(span, seconds);
      const fade = (time) => TRAIL_OPACITY * (1 - Math.min(1, Math.abs(now - time) / span) ** power);
      const [r, g, b] = ballRgb(balls[i].color, wide);
      // (The trail's head, its last point, follows the ball: it ends where
      // the ball is drawn, which may be a little past the step the trail
      // came with — see showNext in physics-client.js.)
      const head = balls[i].trailHead ? trail.length - 8 : -1, p = balls[i].position;
      for (let k = 0; k + 7 < trail.length && pieces < most; k += 4) {
        let at = pieces * TRAIL_PIECE_NUMBERS;
        out[at++] = trail[k];     out[at++] = trail[k + 1]; out[at++] = trail[k + 2];   // start
        if (k === head) { out[at++] = p.x; out[at++] = p.y; out[at++] = p.z; }           // end
        else { out[at++] = trail[k + 4]; out[at++] = trail[k + 5]; out[at++] = trail[k + 6]; }
        out[at++] = r; out[at++] = g; out[at++] = b;
        out[at++] = fade(trail[k + 3]);
        out[at++] = fade(trail[k + 7]);
        pieces++;
      }
    }
    return pieces;
  }

  // How much of the lamp's view the shadow grid must cover (shadowRange),
  // from where the balls are. (Also used alone by the WebGPU renderer, which
  // builds the grid itself, on the graphics card: see gpu-renderer.js.)
  measureShadowRange(balls, count, lamp) {
    // Where each ball is in the lamp's view: the lowest and highest
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

    return range;
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
    const range = this.measureShadowRange(balls, count, lamp);
    const seen = this.shadowSeen;
    const L = lamp.position, F = lamp.forward, S = lamp.side, U = lamp.up;

    const cellsPerUnit = SHADOW_GRID / (2 * range);
    const cellSize = 1 / cellsPerUnit;
    const toCell = (v) => Math.floor((v + range) * cellsPerUnit);
    const clamp = (c) => Math.min(SHADOW_GRID - 1, Math.max(0, c));

    // ... then which cells each ball can shade. Not every cell of the square
    // around its outline: only those whose view from the lamp passes
    // through the ball's cone — the cone from the lamp around the ball —
    // widened by a margin for the half-diagonal of a cell, and for the soft
    // shadow edges (lamp.reach, seen from the lamp). For the small balls of
    // Gas that is a fraction of the square, so each pixel has that many
    // fewer balls to check.
    // Row by row, where the cone starts and ends is worked out directly: a
    // direction v = (sx, sy, 1) (sideways, up, ahead) is inside it when
    // c·v ≥ cos(angle) |c| |v|, with c the ball's direction — squared, a
    // quadratic in sx. (The margin uses the cells' size as an angle as seen
    // straight ahead, the largest it can be.)
    // A ball whose square reaches the grid's border (seen at a grazing angle,
    // see above) keeps the whole square: the outermost cells stand for
    // everything beyond.
    // The cells each ball can shade, row by row (first and last row, then
    // a first and last cell for each row; an empty row has first > last),
    // are kept, to count and then fill the lists.
    let spans = 0;
    let span = this.shadowSpans ?? (this.shadowSpans = new Int16Array(16384));
    const ballSpans = this.ballSpans?.length >= 3 * count ? this.ballSpans : (this.ballSpans = new Int32Array(3 * MAX_BALLS));
    const counts = this.shadowCount;
    counts.fill(0);
    const halfDiagonal = 0.75 * cellSize;
    // (How near each ball comes to the lamp, ahead: each cell's list is
    // filled nearest first, see shadowAt in shaders.js.)
    // (Sorted as whole numbers, the fastest way: how near, in steps of
    // SHADOW_ORDER_STEP, times 8192, plus the ball's number. A list may so
    // be out of order by less than a step: shadowAt allows for that.)
    const order = this.shadowOrder ??= new Float64Array(MAX_BALLS);
    for (let i = 0; i < count; i++) {
      ballSpans[3 * i] = 0; ballSpans[3 * i + 1] = -1;
      order[i] = 2 ** 52 + i;   // (no shadow: last)
      if (Number.isNaN(seen[4 * i])) continue;
      const x0 = clamp(toCell(seen[4 * i]) - 1), x1 = clamp(toCell(seen[4 * i + 1]) + 1);
      const z0 = clamp(toCell(seen[4 * i + 2]) - 1), z1 = clamp(toCell(seen[4 * i + 3]) + 1);
      const whole = x0 === 0 || z0 === 0 || x1 === SHADOW_GRID - 1 || z1 === SHADOW_GRID - 1;
      // The ball's direction from the lamp, c = (side, up, below), and the
      // cosine of the cone's half-angle plus the margin, k.
      const r = balls[i].radius, p = balls[i].position;
      const fx = p.x - L.x, fy = p.y - L.y, fz = p.z - L.z;
      const side = fx * S.x + fy * S.y + fz * S.z, up = fx * U.x + fy * U.y + fz * U.z;
      const below = fx * F.x + fy * F.y + fz * F.z;
      order[i] = Math.max(0, Math.min(2 ** 38, Math.floor((below - r) / Shaders.SHADOW_ORDER_STEP + 2 ** 20))) * 8192 + i;
      const cc = side * side + up * up + below * below, distance = Math.sqrt(cc);
      const angle = Math.asin(Math.min(1, r / distance)) + halfDiagonal + lamp.reach / distance;
      const k2cc = angle < Math.PI / 2 ? Math.cos(angle) ** 2 * cc : 0;
      // (a sx + e)² ≥ k²|c|² (sx² + sy² + 1), e = up·sy + below:
      // A sx² + B sx + C ≥ 0 with A = side² − k²|c|² (below 0 for a cone
      // narrower than a right angle), B = 2 side e, C = e² − k²|c|² (sy² + 1).
      const A = side * side - k2cc;
      if (2 * (spans + z1 - z0 + 1) > span.length) {
        const more = new Int16Array(Math.max(2 * span.length, 2 * (spans + z1 - z0 + 1)));
        more.set(span);
        span = this.shadowSpans = more;
      }
      ballSpans[3 * i] = z0; ballSpans[3 * i + 1] = z1; ballSpans[3 * i + 2] = spans;
      for (let z = z0; z <= z1; z++, spans++) {
        let from = x0, to = x1;
        if (!whole && A < 0) {
          const sy = (z + 0.5) * cellSize - range;
          const e = up * sy + below;
          const B = 2 * side * e, C = e * e - k2cc * (sy * sy + 1);
          const disc = B * B - 4 * A * C;
          if (disc < 0) { span[2 * spans] = 1; span[2 * spans + 1] = 0; continue; }   // (the cone misses this row)
          const root = Math.sqrt(disc);
          // (A < 0: the inside lies between the roots. Cells whose middle,
          // at (x + 0.5) × size − range, lies there.)
          const low = (-B + root) / (2 * A), high = (-B - root) / (2 * A);
          from = Math.max(x0, Math.ceil((low + range) * cellsPerUnit - 0.5));
          to = Math.min(x1, Math.floor((high + range) * cellsPerUnit - 0.5));
          // (Only the half of the double cone in front of the lamp.)
          if (from <= to && side * (((from + to) / 2 + 0.5) * cellSize - range) + e <= 0) { from = 1; to = 0; }
        }
        span[2 * spans] = from; span[2 * spans + 1] = to;
        for (let x = from; x <= to; x++) counts[z * SHADOW_GRID + x]++;
      }
    }
    let total = 0;
    const MOST = 1048575;   // (the start must fit in 20 bits; far more than any scene needs)
    for (let c = 0; c < counts.length; c++) {
      if (total + counts[c] > MOST) counts[c] = Math.max(0, MOST - total);
      this.shadowCells[c] = total * 4096 + Math.min(counts[c], 4095);
      total += counts[c];
    }
    this.makeShadowListRoom(total);

    // ... and finally write the ball numbers into the lists, nearest to the
    // lamp first (so each list comes out in that order).
    const next = this.shadowNext?.length === counts.length ? this.shadowNext : (this.shadowNext = new Uint32Array(counts.length));
    for (let c = 0; c < counts.length; c++) next[c] = Math.floor(this.shadowCells[c] / 4096);
    order.subarray(0, count).sort();
    for (let n = 0; n < count; n++) {
      const i = order[n] % 8192;
      const z0 = ballSpans[3 * i], z1 = ballSpans[3 * i + 1];
      for (let z = z0, k = ballSpans[3 * i + 2]; z <= z1; z++, k++) {
        for (let x = span[2 * k]; x <= span[2 * k + 1]; x++) {
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
  // numbers (in whole rows of SHADOW_LIST_WIDTH), making it bigger if not.
  makeShadowListRoom(entries) {
    const rows = Math.max(1, Math.ceil(entries / SHADOW_LIST_WIDTH));
    if (this.shadowList && this.shadowList.length >= rows * SHADOW_LIST_WIDTH) return;
    let size = this.shadowList ? this.shadowList.length / SHADOW_LIST_WIDTH : 64;
    while (size < rows) size *= 2;
    this.shadowList = new Uint16Array(size * SHADOW_LIST_WIDTH);
    this.shadowListGrown(size);
  }
}

export class Renderer extends SceneRenderer {
  // canvas: what to draw on (also the element whose size and place it takes).
  constructor(canvas, view = canvas) {
    super(view);
    this.canvas = canvas;

    // antialias: false — the shaders smooth every edge themselves, so the
    // graphics card's own (multi-sample) smoothing isn't needed.
    // depth: false — the canvas itself needs no depth buffer; the off-screen
    // picture has its own.
    // (We leave the canvas see-through-capable, the default, even though every
    // pixel we draw is fully opaque: in testing, an opaque-only canvas made
    // Chrome show garbage where the settings panel overlaps the scene.)
    // Drawn straight into the canvas where the browser lets the canvas
    // keep linear light itself (drawingBufferStorage with SRGB8_ALPHA8:
    // Chrome and Edge): it then turns the light into screen colours as it
    // is written, and blends in linear light, just as the off-screen
    // picture below does. No picture to copy over at the end: a whole
    // screenful less to read and write every frame. The canvas then needs
    // a depth buffer of its own. (Elsewhere, or with
    // boing.noDirectWebGl = true before the page starts drawing: the
    // off-screen picture, copied over at the end.)
    const direct = typeof WebGL2RenderingContext.prototype.drawingBufferStorage === 'function' && !globalThis.boing?.noDirectWebGl;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: direct });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.direct = direct;
    // (The largest picture it can draw: see measure.)
    this.maxPictureSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    // The off-screen picture keeps light as 16-bit floating-point numbers
    // where the graphics card can draw into those (almost everywhere), so
    // it can hold light brighter than white (see createLinearTarget below).
    this.floatTarget = !!gl.getExtension('EXT_color_buffer_float');

    // Compile the shader programs.
    this.floorProgram = createProgram(gl, Shaders.FLOOR_VERTEX_SHADER, Shaders.FLOOR_FRAGMENT_SHADER);
    this.wallProgram = createProgram(gl, Shaders.WALL_VERTEX_SHADER, Shaders.WALL_FRAGMENT_SHADER);
    this.ballProgram = createProgram(gl, Shaders.BALL_VERTEX_SHADER, Shaders.BALL_FRAGMENT_SHADER);
    this.ballDepthProgram = createProgram(gl, Shaders.BALL_VERTEX_SHADER, Shaders.BALL_DEPTH_FRAGMENT_SHADER);
    this.trailProgram = createProgram(gl, Shaders.TRAIL_VERTEX_SHADER, Shaders.TRAIL_FRAGMENT_SHADER);
    // The copper bars fill the whole picture, like the copy-to-screen step,
    // so they share its vertex shader.
    // (One program per backdrop: see copperFragmentShader. The effects'
    // pictures share one.)
    this.copperPrograms = [1, 2, 3, 4].map((kind) => createProgram(gl, Shaders.PRESENT_VERTEX_SHADER, Shaders.copperFragmentShader(kind)));
    this.copperRowsProgram = createProgram(gl, Shaders.COPPER_ROWS_VERTEX_SHADER, Shaders.COPPER_ROWS_FRAGMENT_SHADER);
    this.presentProgram = createProgram(gl, Shaders.PRESENT_VERTEX_SHADER, Shaders.PRESENT_FRAGMENT_SHADER);
    this.textProgram = createProgram(gl, Shaders.PRESENT_VERTEX_SHADER, Shaders.TEXT_FRAGMENT_SHADER);
    this.programs = [this.floorProgram, this.wallProgram, this.ballProgram, this.ballDepthProgram,
      this.trailProgram, ...this.copperPrograms, this.copperRowsProgram, this.presentProgram, this.textProgram];
    // Make sure of them now, so that a broken shader shows at once.
    for (const program of this.programs) void program.uniforms;

    // Upload the shapes. Walls and balls are both drawn as flat squares.
    this.square = createSquare(gl);
    this.emptyVao = gl.createVertexArray();   // for the copy-to-screen step
    this.trails = createTrailMesh(gl);

    // The ball table (see SceneRenderer), in a texture of 32-bit
    // floating-point numbers on texture unit 3.
    this.ballTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ballTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, BALL_TABLE_COLUMNS, MAX_BALLS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);

    // The shadow grid (see SceneRenderer), sent as textures of whole
    // numbers: the cells on unit 1, the lists on unit 4.
    this.shadowCellTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowCellTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, SHADOW_GRID, SHADOW_GRID);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    this.shadowListTexture = null;
    this.makeShadowListRoom(64 * SHADOW_LIST_WIDTH);
    this.target = null;   // the off-screen picture, made in resize()

    // Measuring how long the graphics card works on each frame (for the
    // Info page). Only some browsers offer this (Chrome and Edge on
    // desktop do); elsewhere gpuTimer is null and the time shows as "n/a".
    // The card works in the background, so each measurement only becomes
    // available a few frames later: unfinished ones wait in a queue.
    this.gpuTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuQueue = [];
  }

  // Match the drawing size to the canvas's size on screen.
  resize() {
    const gl = this.gl;
    const { width, height } = this.measure();
    if (this.target && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.target) this.target.dispose();
    if (this.direct && !this.keepLinear(width, height)) this.direct = false;   // (refused: the picture after all)
    this.target = createLinearTarget(gl, width, height, this.floatTarget, this.direct);
    // (Should the card turn the float picture down after all, use 8 bits.)
    if (!this.target.complete && this.floatTarget) {
      this.target.dispose();
      this.floatTarget = false;
      this.target = createLinearTarget(gl, width, height, false);
    }
  }

  // The canvas as linear light (see direct in the constructor), sized to
  // the picture: again after every change of size or colour space, which
  // give it a fresh drawing buffer. False if the browser says no.
  keepLinear(width, height) {
    const gl = this.gl;
    try {
      while (gl.getError()) { /* (old errors) */ }
      gl.drawingBufferStorage(gl.SRGB8_ALPHA8, width, height);
      if (gl.getError() !== gl.NO_ERROR || gl.drawingBufferFormat !== gl.SRGB8_ALPHA8) return false;
    } catch {
      return false;
    }
    return this.blendsLinear();
  }

  // Does the canvas really blend in linear light? (Not every browser and
  // graphics driver does, for the canvas itself: some mix the stored
  // screen colours instead, which makes every smoothed edge too light.)
  // Tried on one pixel: half white over 20 % grey must give 60 % grey,
  // 203 as a screen colour; mixing screen colours would give 221.
  blendsLinear() {
    const gl = this.gl;
    this.blendTestProgram ??= createProgram(gl, Shaders.PRESENT_VERTEX_SHADER,
      '#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0, 1.0, 1.0, 0.5); }');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 1, 1);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    gl.clearColor(0.2, 0.2, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.blendTestProgram.handle);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Math.abs(pixel[0] - 203) <= 3;
  }

  // Give the graphics memory back.
  dispose() {
    this.target?.dispose();
    this.pictureDrawer?.dispose();
    this.dropPicturePlace();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // An effect as the backdrop: drawn each frame, first of all, with this
  // renderer's own WebGL, into a picture as large as the scene's (see
  // sharedPicture), which the backdrop shader then reads on unit 6. (No
  // copying it over from another canvas: WebGPU too draws it straight
  // into a picture.) Without one, unit 6 still holds a small texture: see
  // uKefrensRows.
  drawPicture(options, wide) {
    const name = options.copper && pictureBackdrop(options) ? options.backdrop : null;
    // (Made anew for another effect, or none any more, and when big pixels
    // come or go: then it draws sharp, see sharpen in twist.js; and when
    // boing.smoothEffects is switched.)
    if (name !== this.pictureOf || effectLook() !== this.pictureLook) {
      this.pictureLook = effectLook();
      this.pictureDrawer?.dispose();
      this.pictureOf = name;
      this.gl.activeTexture(this.gl.TEXTURE0);   // (what a drawer makes, it makes on unit 0)
      this.pictureDrawer = name ? options.effect.gl(this.sharedPicture()) : null;
      if (!name) this.dropPicturePlace();   // (its memory back)
    }
    if (!this.pictureDrawer) return;
    this.pictureDrawer.setLook(Boolean(wide), false);
    this.pictureDrawer.draw(options.backdropTime ?? 0, this.target.width, this.target.height, 0);
  }

  // The effect's picture on unit 6, for the backdrop shader.
  bindPicture() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE6);
    if (!this.pictureTexture) this.pictureTexture = makePictureTexture(gl, 1, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTexture);
    gl.activeTexture(gl.TEXTURE0);
  }

  // What an effect's drawer is handed in place of a canvas (see glBase in
  // effects.js and createDrawer in twist.js): this WebGL, and where to
  // draw. begin(width, height, smooth) makes the picture that size and
  // draws into it, with four samples a pixel for smoothed edges (then
  // end() averages them into the picture); end() hands WebGL back.
  sharedPicture() {
    const gl = this.gl;
    const it = this.picturePlace ??= { width: 0, height: 0, smooth: false };
    return {
      shared: {
        gl,
        begin: (width, height, smooth) => {
          if (it.width !== width || it.height !== height || it.smooth !== smooth) {
            this.dropPicturePlace();
            Object.assign(it, { width, height, smooth });
            gl.activeTexture(gl.TEXTURE6);
            this.pictureTexture = makePictureTexture(gl, width, height);
            gl.activeTexture(gl.TEXTURE0);
            it.framebuffer = gl.createFramebuffer();
            it.depth = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, it.depth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, it.framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pictureTexture, 0);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, it.depth);
            if (smooth) {
              const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
              it.multi = gl.createFramebuffer();
              it.multiColor = gl.createRenderbuffer();
              gl.bindRenderbuffer(gl.RENDERBUFFER, it.multiColor);
              gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
              it.multiDepth = gl.createRenderbuffer();
              gl.bindRenderbuffer(gl.RENDERBUFFER, it.multiDepth);
              gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
              gl.bindFramebuffer(gl.FRAMEBUFFER, it.multi);
              gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, it.multiColor);
              gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, it.multiDepth);
            }
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, smooth ? it.multi : it.framebuffer);
          gl.viewport(0, 0, width, height);
        },
        end: () => {
          if (it.smooth) {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, it.multi);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, it.framebuffer);
            gl.blitFramebuffer(0, 0, it.width, it.height, 0, 0, it.width, it.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.bindVertexArray(null);
          gl.useProgram(null);
          gl.activeTexture(gl.TEXTURE0);
        },
      },
    };
  }

  dropPicturePlace() {
    const gl = this.gl, it = this.picturePlace;
    if (!it?.framebuffer) return;
    gl.deleteFramebuffer(it.framebuffer);
    gl.deleteRenderbuffer(it.depth);
    if (it.multi) {
      gl.deleteFramebuffer(it.multi);
      gl.deleteRenderbuffer(it.multiColor);
      gl.deleteRenderbuffer(it.multiDepth);
    }
    gl.deleteTexture(this.pictureTexture);
    this.pictureTexture = null;
    Object.assign(it, { width: 0, height: 0, framebuffer: null, multi: null });
  }

  // Can the canvas show colours in the wider Display P3 range? (Most
  // phones, Macs and newer laptops have such screens.)
  get wideColorSupported() {
    return 'drawingBufferColorSpace' in this.gl;
  }

  applyColorSpace() {
    const space = this.wideColor ? 'display-p3' : 'srgb';
    if (this.wideColorSupported && this.gl.drawingBufferColorSpace !== space) {
      this.gl.drawingBufferColorSpace = space;
      // (A new colour space gives the canvas a new drawing buffer: linear
      // again. If it won't be, back to the off-screen picture.)
      if (this.direct && this.target && !this.keepLinear(this.canvas.width, this.canvas.height)) {
        this.direct = false;
        this.target.dispose();
        this.target = createLinearTarget(this.gl, this.canvas.width, this.canvas.height, this.floatTarget, false);
      }
    }
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
  draw(camera, balls, options = {}) {
    const frame = this.prepare(camera, balls, options);
    const { count, eye, light, forward, side, up, edgeWidth, shadowColor, shadowOpacity } = frame;
    const gl = this.gl;
    const timer = this.measureGpu ? this.gpuTimer : null;
    let query = null;
    if (timer) {
      this.collectGpuTimes();
      query = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    }

    // Send the ball table to the graphics card (one upload for all
    // shaders), only the rows that are in use.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ballTexture);
    if (count > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BALL_TABLE_COLUMNS, count, gl.RGBA, gl.FLOAT, this.ballTable);
    }

    // And the shadow grid.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowCellTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_GRID, SHADOW_GRID, gl.RED_INTEGER, gl.UNSIGNED_INT, this.shadowCells);
    const rows = Math.ceil(frame.listed / SHADOW_LIST_WIDTH);
    if (rows > 0) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowListTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADOW_LIST_WIDTH, rows, gl.RED_INTEGER, gl.UNSIGNED_SHORT, this.shadowList);
    }
    gl.activeTexture(gl.TEXTURE0);

    // Colours to the canvas as Display P3? (see SRGB_TO_P3)
    const wide = this.canvasIsWide ? 1 : 0;
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
      gl.uniform1f(u.uShadowRange, frame.shadowRange);
      gl.uniform1f(u.uShadowStrength, SHADOW_STRENGTH);
      gl.uniform3f(u.uShadowColor, ...shadowColor);
      gl.uniform1f(u.uShadowOpacity, shadowOpacity);
      gl.uniform1f(u.uEdgeWidth, edgeWidth);
      gl.uniform1f(u.uWide, wide);
      gl.uniform1i(u.uShadowCells, 1);  // the shadow grid is on texture units 1 and 4
      gl.uniform1i(u.uShadowList, 4);
      gl.uniform1i(u.uFrontDepth, 2);   // the front-depth picture is on unit 2
      gl.uniform1i(u.uBallData, 3);     // the ball table is on unit 3
      return u;
    };

    // ---- Step 0: an effect as the backdrop, into its own picture (first,
    // as it uses WebGL in its own way: see sharedPicture).
    this.drawPicture(options, wide);

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

    const placeWall = (u, { wall, extend }) => {
      gl.uniform4f(u.uExtend, ...extend);
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
    // (alpha = coverage; the picture's own alpha stays 1: drawn straight
    // into the canvas, see direct, anything less would let the page show through)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

    // --- 0. Backdrop: copper bars over the whole picture, if switched on.
    if (options.copper) {
      gl.disable(gl.DEPTH_TEST);   // it is behind everything
      // (The copper bars row by row, see COPPER_ROWS_VERTEX_SHADER; the
      // others pixel by pixel.)
      const bars = (options.backdrop ?? 'bars') === 'bars';
      const kind = BACKDROPS.indexOf(options.backdrop ?? 'bars');
      const program = bars ? this.copperRowsProgram : this.copperPrograms[Math.min(kind, 4) - 1], u = program.uniforms;
      gl.useProgram(program.handle);
      gl.uniform1f(u.uTime, backdropTime(options));
      gl.uniform1f(u.uHeight, this.target.height);
      gl.uniform1f(u.uWidth, this.target.width);
      // On an HDR screen the bars' white highlights shine brighter than white.
      gl.uniform1f(u.uShine, frame.shine);
      gl.uniform1f(u.uWide, wide);
      // (The Kefrens bars' rows, on texture unit 5: see kefrensRows. The
      // shader names the texture whichever backdrop it draws, and a name
      // left on unit 0, where the picture being drawn into can be, would
      // stop the drawing: so unit 5 always, with at least a small texture.)
      gl.uniform1i(u.uKefrensRows, 5);
      // (And the effect's picture on unit 6, in the same way.)
      gl.uniform1i(u.uPicture, 6);
      this.bindPicture();
      if (!this.kefrensTexture) {
        this.kefrensTexture = gl.createTexture();
        this.kefrensTextureHigh = 1;
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.kefrensTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, Shaders.KEFRENS_ROWS_WIDE, 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.activeTexture(gl.TEXTURE0);
      }
      if (options.backdrop === 'kefrens') {
        const rows = this.kefrensRows(this.target.width, this.target.height, backdropTime(options));
        const high = Math.ceil(rows / Shaders.KEFRENS_ROWS_WIDE);
        gl.activeTexture(gl.TEXTURE5);
        if (this.kefrensTextureHigh < high) {
          gl.deleteTexture(this.kefrensTexture);
          this.kefrensTexture = gl.createTexture();
          this.kefrensTextureHigh = high;
          gl.bindTexture(gl.TEXTURE_2D, this.kefrensTexture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, Shaders.KEFRENS_ROWS_WIDE, high);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.kefrensTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Shaders.KEFRENS_ROWS_WIDE, high, gl.RG, gl.FLOAT, this.kefrensData);
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.bindVertexArray(this.emptyVao);
      if (bars) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.target.height);
      else gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.DEPTH_TEST);   // nearer things hide farther things
    gl.enable(gl.BLEND);        // shadows and smoothed edges blend over what's behind


    // --- 1. Floor shadows (only from above; like the original, the floor
    //     has no back side).
    if (frame.showShadows && eye.y > frame.floorY) {
      const u = setShared(this.floorProgram);
      gl.uniform1f(u.uFloorY, frame.floorY);
      gl.uniform1f(u.uFloorHalfSize, frame.floorHalfSize);
      gl.uniform1f(u.uHalfSize, BOX_HALF_SIZE);
      gl.uniform4f(u.uWallShown, ...frame.wallShown);
      gl.depthMask(false);
      gl.bindVertexArray(this.square.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true);
    }

    // --- 2. Walls. They are always behind the balls (we hide the walls
    //     between the camera and the box), so they go next. They don't
    //     write depth, so they never hide each other.
    if (frame.showGrid) {
      const u = setShared(this.wallProgram);
      // Over plain grey the lines are drawn solid, in the shade that 60 %
      // purple over that grey gives. Over the copper bars they really are
      // 60 % see-through purple.
      const look = gridLook(options);
      gl.uniform3f(u.uColor, ...look.color);
      gl.uniform1f(u.uLineOpacity, look.opacity);
      gl.uniform1f(u.uLineWidth, frame.lineWidth);
      gl.uniform1f(u.uEdgeUnits, this.edgeUnits);
      gl.uniform1f(u.uHalfSize, BOX_HALF_SIZE);
      gl.depthMask(false);
      gl.bindVertexArray(this.square.vao);

      for (const wall of frame.walls) {
        if (!wall.shown) continue;
        gl.uniform1f(u.uCatchShadows, wall.catchesShadows ? 1 : 0);
        placeWall(u, wall);
        gl.uniform4f(u.uDrawEdge, ...wall.drawEdge);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.depthMask(true);
    }

    // --- 3. Balls: one square each, all in a single instanced draw call,
    //     farthest first. Their smoothed outlines blend over what's behind.
    {
      const u = setShared(this.ballProgram);
      gl.uniform1f(u.uGlint, frame.glint);
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
        gl.uniform1f(u.uWidth, frame.trailWidth);
        gl.uniform1f(u.uEdgeWidth, edgeWidth);
        gl.uniform1f(u.uWide, wide);
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
    // (Not when drawn straight into the canvas: it is there already.)
    if (!this.direct) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.presentProgram.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.target.texture);
      gl.uniform1i(this.presentProgram.uniforms.uScene, 0);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- Step 4: the scroller (see scroller.js), laid over the picture.
    const textRect = options.scroller ? this.textRect(options.scroller.strip, this.canvas.width, this.canvas.height) : null;
    if (textRect) {
      const scroller = options.scroller;
      const u = this.textProgram.uniforms;
      const placed = scroller.place(textRect[2] / textRect[3]);
      gl.useProgram(this.textProgram.handle);
      gl.activeTexture(gl.TEXTURE0 + 7);
      this.sendScroller(scroller);
      gl.uniform1i(u.uWords, 7);
      gl.uniform4fv(u.uScroll, placed);
      gl.uniform4f(u.uScrollText, scroller.letterNumbers.length, scroller.glyphRows.length, 0, 0);
      gl.uniform4fv(u.uTextRect, textRect);
      gl.uniform1f(u.uHeight, this.canvas.height);
      gl.uniform1f(u.uWide, wide);
      gl.uniform1f(u.uLinear, this.direct ? 1 : 0);   // (a canvas of linear light: see direct)
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);   // (the canvas stays opaque)
      // (Over the whole picture, but only the strip's pixels are drawn: the
      // rest would only be blended with nothing.)
      gl.enable(gl.SCISSOR_TEST);
      const left = Math.max(0, Math.floor(textRect[0])), bottom = Math.max(0, Math.floor(textRect[1]));
      gl.scissor(left, bottom, Math.ceil(textRect[0] + textRect[2]) - left, Math.ceil(textRect[1] + textRect[3]) - bottom);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      this.gpuQueue.push(query);
    }
  }

  // The scroller's font and text (scroller.words), as a texture of whole
  // numbers, TEXT_WORDS_PER_ROW to a row: made when the text is new, and
  // bound to the texture unit now chosen.
  sendScroller(scroller) {
    const gl = this.gl;
    if (this.scrollerSent === scroller.message) { gl.bindTexture(gl.TEXTURE_2D, this.scrollerTexture); return; }
    const per = Shaders.TEXT_WORDS_PER_ROW, words = scroller.words;
    const rows = Math.ceil(words.length / per);
    const padded = new Uint32Array(rows * per);
    padded.set(words);
    if (this.scrollerTexture) gl.deleteTexture(this.scrollerTexture);
    this.scrollerTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.scrollerTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, per, rows);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, per, rows, gl.RED_INTEGER, gl.UNSIGNED_INT, padded);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.scrollerSent = scroller.message;
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

  // More room for the trails (see fillTrails): the graphics card's copy too.
  trailRoomGrown() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trails.pieceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.trailPieces.byteLength, gl.DYNAMIC_DRAW);
  }

  // More room for the shadow lists (see makeShadowListRoom): a bigger texture.
  shadowListGrown(rows) {
    const gl = this.gl;
    if (this.shadowListTexture) gl.deleteTexture(this.shadowListTexture);
    this.shadowListTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowListTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, SHADOW_LIST_WIDTH, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
  }
}

// =============================================================================
// Helpers for building shapes and shader programs.
// =============================================================================

// 0xRRGGBB → [r, g, b] with each part between 0 and 1.
// The backdrops' time: the balls' own time (so they pause and rewind with
// them), from 0 again after each BACKDROP_PERIOD, after which they look the
// same anyway (see shaders.js). Worked out here, in the main processor's
// precise numbers.
export function backdropTime(options) {
  const t = options.backdropTime ?? 0, period = Shaders.BACKDROP_PERIOD;
  return ((t % period) + period) % period;
}

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// Screen colour (sRGB) → linear light. Same formula as toLinear() in shaders.js.
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// The off-screen picture the scene is drawn into. It holds linear light:
// the shaders write it, and blending — mixing a new colour with the one
// already there — happens in linear light, as it should.
//
// Its colour format is RGBA16F: 16-bit floating-point numbers, so it can
// keep light brighter than white (above 1), which only an HDR screen can
// show (with WebGPU: see gpu-renderer.js). On an ordinary screen the copy to the canvas cuts
// everything at white, which looks exactly as before. Where the graphics
// card can't draw into floats, the older SRGB8_ALPHA8 is used: 8 bits per
// channel stored as screen colours, which is enough for everything up to
// white. (Both blend without any extension; a 16-bit float picture takes
// twice the memory traffic, which these simple shaders hardly notice.)
// A depth buffer next to it remembers how far away each pixel's surface is.
// (direct: the canvas itself is the picture, see the constructor: then only
// the depth-only picture below is made, and framebuffer is null, the canvas.)
function createLinearTarget(gl, width, height, float, direct = false) {
  const front = createFrontDepth(gl, width, height);
  if (direct) {
    return {
      framebuffer: null, texture: null, ...front, width, height, complete: true,
      dispose() { front.dispose(); },
    };
  }
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    framebuffer, texture, ...front, width, height, complete,
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteRenderbuffer(depth);
      front.dispose();
    },
  };
}

// A second, depth-only picture for the cheap first pass: how far away the
// nearest ball is at each pixel. It is a texture, so the main pass can read it.
function createFrontDepth(gl, width, height) {
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
    frontFramebuffer, frontDepth,
    dispose() {
      gl.deleteFramebuffer(frontFramebuffer);
      gl.deleteTexture(frontDepth);
    },
  };
}

// A plain picture of 8-bit screen colours, for an effect to draw into (see
// sharedPicture), read pixel by pixel.
function makePictureTexture(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

// Compile a vertex + fragment shader pair and link them into a program.
// Also looks up where every uniform lives, so later we can simply write
// program.uniforms.uColor instead of calling gl.getUniformLocation each time.
//
// The compiling may happen in the background (the browser's
// KHR_parallel_shader_compile): nothing here waits
// for it. Only the first look at the program's uniforms — on its first use —
// checks that it worked, waiting for it if it isn't done yet.
function createProgram(gl, vertexSource, fragmentSource) {
  const shader = (type, source) => {
    const it = gl.createShader(type);
    gl.shaderSource(it, source);
    gl.compileShader(it);
    return it;
  };
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
  const handle = gl.createProgram();
  gl.attachShader(handle, vertex);
  gl.attachShader(handle, fragment);
  gl.linkProgram(handle);

  let uniforms = null;
  const lookUp = () => {
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      for (const it of [vertex, fragment]) {
        if (!gl.getShaderParameter(it, gl.COMPILE_STATUS)) throw new Error('Shader compile error:\n' + gl.getShaderInfoLog(it));
      }
      throw new Error('Shader link error:\n' + gl.getProgramInfoLog(handle));
    }
    const found = {};
    const total = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < total; i++) {
      const name = gl.getActiveUniform(handle, i).name.replace(/\[0\]$/, '');  // "uBalls[0]" → "uBalls"
      found[name] = gl.getUniformLocation(handle, name);
    }
    return found;
  };
  return {
    handle,
    get uniforms() { return (uniforms ??= lookUp()); },
    // Done compiling? (Without background compiling, always: it is done when asked.)
    done(parallel) { return !parallel || gl.getProgramParameter(handle, parallel.COMPLETION_STATUS_KHR); },
  };
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
