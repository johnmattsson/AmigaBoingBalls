// =============================================================================
// gpu-renderer.js — the scene drawn with WebGPU.
//
// Where the browser has WebGPU (Chrome and Edge, for now), the scene is drawn
// by this renderer; the WebGL one (renderer.js) is used where it hasn't, and
// draws the first frames while this one gets ready (see startWebGpu in
// main.js). WebGPU can also draw straight into a canvas of 16-bit
// floating-point numbers that may go brighter than white (toneMapping
// "extended", Chrome and Edge 129 and later): HDR (the HDR slider above 0),
// with the picture going directly to the screen.
//
// It draws exactly the same scene as the WebGL renderer, in the same steps,
// with the same shaders translated into WGSL (WebGPU's shader language):
// see renderer.js and shaders.js for how everything works. Everything worked
// out on the main processor each frame (the lamp, the drawing order, the
// shadow grid, ...) is shared: see SceneRenderer in renderer.js.
//
// Differences that come from WebGPU itself:
//   - Its depth runs from 0 to 1, WebGL's from −1 to 1: the camera's matrix
//     is adjusted for that (see toWebGpuDepth).
//   - Its pixels are counted from the top, WebGL's from the bottom: the
//     copper bars and the glowing letters, which care, count from the
//     bottom as before.
//   - The ball table, shadow grid and shadow lists are "storage buffers"
//     (plain lists of numbers) instead of textures.
//
// The WebGL renderer stays for browsers without WebGPU (Safari, Firefox),
// and takes over should this one fail.
// =============================================================================

// With HDR, light up to this many times white is shown (as much as the HDR
// slider at its highest asks for; a screen shows what it can of it).
export const HDR_RANGE = 8;
import { BOX_HALF_SIZE } from './physics.js';
import {
  SceneRenderer, BACKDROPS, pictureBackdrop, BACKGROUND, gridLook, backdropTime, SHADOW_STRENGTH,
  BALL_TABLE_COLUMNS, BALL_NUMBERS, TRAIL_OPACITY, trailPower, srgbToLinear, ballRgb, toCanvasLight, onRec2020Screen,
} from './renderer.js';
import { MAX_BALLS, SHADOW_GRID, BACKDROP_MATHS, TILE_CLICKS, TILE_CLICK_MATHS, PAINT_WORDS, wallKey } from './shaders.js';
import { NO_TILE_CLICKS, NO_PAINT } from './renderer.js';
import { ELEMENTARY_COLOR_MATHS, ELEMENTARY_IN_P3, ELEMENTARY_IN_2020, srgbToP3Matrix } from './colors.js';
import { toWgsl, SQUARE_WAVE } from './shade.js';
import { SCROLLER_SHADER } from './scroller.js';
import { effectLook } from './effect-options.js';

const CELLS = SHADOW_GRID * SHADOW_GRID;   // the shadow grid's cells (a multiple of 256)
const LIST_ROOM = 1048575;                 // room in the shadow lists: a cell's start must fit in 20 bits

const FORMAT = 'rgba16float';            // the canvas and the off-screen picture: light as 16-bit floats
const DEPTH_FORMAT = 'depth32float';   // the depth of the nearest ball (see Step 2 in draw)
const BALL_CORNERS = 8;                // each ball is drawn as an octagon (see ballVs)
const TRAIL_RING_NUMBERS = 12;          // per trail piece in the ring (see sendTrails)
const TRAIL_BALL_NUMBERS = 16;          // per ball, for its trail
const FIRST_TRAIL_RING = 4096;          // pieces; made bigger as needed ...
const MAX_TRAIL_RING = 1 << 20;         // ... up to this many (48 MB)
// (The shadow lists are sorted, nearest the lamp first, from this many
// balls: below, sorting costs more than it saves. See sortLists. Measured on
// an Apple Mac at 3338 × 2410 in 2.04-329: from 32 to 48 balls sorting or
// not makes no difference; at 1000 sorting saves 0.2–0.4 ms a frame, at
// 4000 0.6–1.5 ms.)
const SORT_FROM = 48;
const FRAME_FLOATS = 96 + 4 * TILE_CLICKS;   // the Frame uniform below, in numbers
const WALL_SIZE = 160;                   // bytes of one wall's uniforms (Wall below)
const WALL_STRIDE = 256;                 // bytes between the walls' uniforms (WebGPU's alignment)

// Four numbers into a block of numbers at `at` (no list made for them).
function put4(block, at, a, b, c, d) { block[at] = a; block[at + 1] = b; block[at + 2] = c; block[at + 3] = d; }

// (See skipParts in draw.)
const NOTHING_SKIPPED = new Set();

export class GpuRenderer extends SceneRenderer {
  // Make one, showing its pictures in place of `view` (the page's canvas),
  // or explain why not. Returns { renderer } or { error }.
  // onLost: called if the graphics card is lost (then the caller switches back).
  // (Its canvas is put on the page, under the view, but only shows once it
  // has drawn its first picture.)
  static async create(view, { onLost } = {}) {
    if (!navigator.gpu) return { error: 'this browser has no WebGPU' };
    let device;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { error: 'WebGPU found no graphics card' };
      // (Timing the graphics card's work, for the Info page, where offered.)
      const canTime = adapter.features.has('timestamp-query');
      device = await adapter.requestDevice({ requiredFeatures: canTime ? ['timestamp-query'] : [] });
      const adapterInfo = adapter.info ?? null;   // (which graphics card: for boing.measure in main.js)
      const canvas = document.createElement('canvas');
      canvas.className = 'scene-hdr';
      Object.assign(canvas.style, {
        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
        pointerEvents: 'none',
      });
      const renderer = new GpuRenderer(view, canvas, device);
      renderer.adapterInfo = adapterInfo;
      // (The pipelines are made in the background, so the page keeps going.)
      await renderer.makePipelines();
      // Can it show light brighter than white? (Browsers that don't know
      // "extended" ignore it.)
      renderer.configure('extended');
      const mode = renderer.context.getConfiguration?.()?.toneMapping?.mode;
      renderer.canShowHdr = mode === undefined || mode === 'extended';
      // Can the canvas take linear light (Chrome 155 and later)? Then the
      // scene is drawn straight into it (see draw).
      try {
        renderer.configure('standard', 'srgb-linear');
        renderer.linearCanvas = renderer.context.getConfiguration?.()?.colorSpace === 'srgb-linear';
      } catch {
        renderer.linearCanvas = false;
      }
      renderer.shownAs = null;
      renderer.configure();
      view.before(canvas);   // (the view is hidden at the first picture: see draw)
      device.lost.then((info) => {
        if (!renderer.disposed) onLost?.(info.message);
      });
      return { renderer };
    } catch (e) {
      device?.destroy();
      return { error: e.message };
    }
  }

  constructor(view, canvas, device) {
    super(view);
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext('webgpu');
    this.floatTarget = true;
    this.disposed = false;
    this.shownOnce = false;
    this.isWebGpu = true;
    // Skip ball pixels behind a nearer ball before shading them (see ballVs).
    // (boing.renderer.earlyDepth = false, in the console, to compare: the
    // picture is the same, as the balls are drawn from far to near anyway.)
    this.earlyDepth = true;
    this.canShowHdr = false;   // found out by create()
    this.linearCanvas = false; // found out by create()
    this.timer = device.features.has('timestamp-query') ? new GpuTimer(device) : null;
    this.gpuTimer = this.timer;   // (main.js: the graphics card's time can be shown)
    this.shownAs = null;       // how the canvas is configured (see configure)

    this.maxPictureSize = device.limits.maxTextureDimension2D;   // (the largest picture it can draw: see measure in renderer.js)
    const buffer = (size, usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
    this.frameData = new Float32Array(FRAME_FLOATS);
    this.frameWords = new Uint32Array(this.frameData.buffer);
    this.frameBuffer = buffer(FRAME_FLOATS * 4, GPUBufferUsage.UNIFORM);
    this.wallData = new Float32Array(6 * WALL_STRIDE / 4);
    this.wallWords = new Uint32Array(this.wallData.buffer);   // (the same numbers: for the paint)
    this.wallBuffer = buffer(6 * WALL_STRIDE, GPUBufferUsage.UNIFORM);
    this.ballBuffer = buffer(MAX_BALLS * BALL_TABLE_COLUMNS * 16, GPUBufferUsage.STORAGE);
    // The ball table is built here, on the graphics card, from the physics'
    // own numbers and the drawing order (see makeBallTable): the main
    // processor only sends those over, as they are.
    this.buildsBallTable = true;   // (see prepare in renderer.js)
    this.numberBuffer = buffer(MAX_BALLS * BALL_NUMBERS * 4, GPUBufferUsage.STORAGE);
    this.orderBuffer = buffer(MAX_BALLS * 4, GPUBufferUsage.STORAGE);
    // The shadow grid and its lists (see "Shadows" in shaders.js), built
    // right here on the graphics card each frame (see buildShadowGrid), so
    // the main processor needn't. The lists hold up to LIST_ROOM ball numbers
    // in all (32 bits each), far more than any scene needs.
    this.buildsShadowGrid = true;   // (see prepare in renderer.js)
    this.cellBuffer = buffer(CELLS * 4, GPUBufferUsage.STORAGE);
    this.listBuffer = buffer(LIST_ROOM * 16, GPUBufferUsage.STORAGE);   // (each: the ball's middle and radius)
    this.countBuffer = buffer(CELLS * 4, GPUBufferUsage.STORAGE);       // (each cell's count, then its next free place)
    this.blockBuffer = buffer(CELLS / 256 * 4, GPUBufferUsage.STORAGE); // (the running sum's blocks)
    // The trails, kept here on the graphics card (see sendTrails): each
    // straight piece is sent once, when the physics lays it down, into a
    // ring of pieces; each frame only a few numbers per ball follow (its
    // colour, how far back its trail now reaches, and the piece from its
    // last point to the ball). The fading with age is worked out here too.
    this.trail = {
      room: 0, written: 0,            // pieces the ring holds; pieces written so far, all told
      owner: null, generation: null, index: null,   // per place in the ring: whose piece, and which
      sentGeneration: new Int32Array(MAX_BALLS).fill(-1),   // per ball: its trail as last seen ...
      sentUpTo: new Float64Array(MAX_BALLS),                // ... and its pieces sent so far
      staging: new Float32Array(1024 * TRAIL_RING_NUMBERS),
      balls: new Float32Array(MAX_BALLS * TRAIL_BALL_NUMBERS),
    };
    this.trailBallBuffer = buffer(MAX_BALLS * TRAIL_BALL_NUMBERS * 4, GPUBufferUsage.STORAGE);
    this.trailRingBuffer = null;
    this.growTrailRing(FIRST_TRAIL_RING);

    this.layouts = makeLayouts(device);
    this.sharedGroup = device.createBindGroup({
      layout: this.layouts.shared,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.ballBuffer } },
        { binding: 2, resource: { buffer: this.cellBuffer } },
        { binding: 3, resource: { buffer: this.listBuffer } },
      ],
    });
    this.gridGroup = device.createBindGroup({
      layout: this.layouts.grid,
      entries: [this.frameBuffer, this.ballBuffer, this.cellBuffer, this.listBuffer, this.countBuffer, this.blockBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.tableGroup = device.createBindGroup({
      layout: this.layouts.table,
      entries: [this.frameBuffer, this.numberBuffer, this.orderBuffer, this.ballBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.wallGroup = device.createBindGroup({
      layout: this.layouts.wall,
      entries: [{ binding: 0, resource: { buffer: this.wallBuffer, size: WALL_SIZE } }],
    });

    // The scroller's font and text (see scrollerColor in the shaders), sent
    // once, when first shown.
    this.scrollerText = null;
    this.scrollerBuffer = buffer(16, GPUBufferUsage.STORAGE);
    this.kefrensBuffer = buffer(16, GPUBufferUsage.STORAGE);   // (made bigger when the Kefrens bars are shown: see draw)
    this.picture = device.createTexture({ size: [1, 1], format: FORMAT,   // (an effect as the backdrop: see drawPicture)
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    // The pieces of burst balls (see countdown.js): their picture, from a 2D
    // canvas, laid over the scene under the scroller (see sendPieces).
    this.piecesTexture = this.emptyPieces();
    this.piecesSent = -1;
    // Those lying on the floor: its picture (see sendFloorPieces).
    this.floorPiecesTexture = this.device.createTexture({ size: [1, 1], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.floorPiecesSent = null;
    this.target = null;   // the off-screen pictures, made in resize()
  }

  async makePipelines() {
    const device = this.device, L = this.layouts;
    const module = device.createShaderModule({ code: SHADER });
    const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' } };
    // (depthTest: 'less' and so on — the depth of the nearest ball, which
    // the main pass reads only; see Step 2 in draw.)
    const make = (layout, vertex, fragment, { blended = true, depthWrite = false, depthTest = 'always',
      color = true, depthFormat = DEPTH_FORMAT, strip = true, buffers = [], writeMask } = {}) =>
      device.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: vertex, buffers },
        // (No fragment shader at all: depth only.)
        fragment: fragment ? { module, entryPoint: fragment, targets: color ? [{ format: FORMAT, blend: blended ? blend : undefined, writeMask }] : [] } : undefined,
        primitive: { topology: strip ? 'triangle-strip' : 'triangle-list' },
        depthStencil: depthFormat ? {
          format: depthFormat, depthWriteEnabled: depthWrite, depthCompare: depthTest,
        } : undefined,
      });
    [this.starsPipeline, this.plasmaPipeline, this.kefrensPipeline, this.copperRowsPipeline, this.floorPipeline, this.wallPipeline, this.wallTilesPipeline,
      this.ballPipeline, this.trailPipeline, this.trailHeadPipeline, this.presentPipeline, this.textPipeline,
      this.ballLatePipeline, this.ballCoreInPassPipeline, this.ballDepthInPassPipeline, this.piecesPipeline] = await Promise.all([
      make(L.scene, 'fullVs', 'starsFs', { blended: false, strip: false }),
      make(L.scene, 'fullVs', 'plasmaFs', { blended: false, strip: false }),
      make(L.scene, 'fullVs', 'kefrensFs', { blended: false, strip: false }),
      make(L.scene, 'copperRowsVs', 'copperRowsFs', { blended: false }),
      make(L.scene, 'floorVs', 'floorFs', { depthTest: 'less' }),
      make(L.scene, 'wallVs', 'wallFs', { depthTest: 'less' }),
      make(L.scene, 'wallVs', 'wallTilesFs', { depthTest: 'less' }),
      make(L.scene, 'ballVs', 'ballFs', { depthTest: 'less-equal' }),
      make(L.scene, 'trailVs', 'trailFs', { depthTest: 'less' }),
      make(L.scene, 'trailHeadVs', 'trailFs', { depthTest: 'less' }),
      make(L.present, 'fullVs', 'presentFs', { blended: false, depthFormat: null, strip: false }),
      make(L.scene, 'textVs', 'textFs'),
      // (Without the early depth test: see earlyDepth.)
      make(L.scene, 'ballVs', 'ballFs'),
      // The balls' depth, drawn first in the scene's pass (depth only, no
      // colour): the quick way, and the exact one for trails (see draw).
      make(L.front, 'ballCoreVs', 'noColorFs', { blended: false, writeMask: 0, depthWrite: true, depthTest: 'less' }),
      make(L.front, 'ballVs', 'ballDepthInPassFs', { blended: false, writeMask: 0, depthWrite: true, depthTest: 'less' }),
      make(L.scene, 'fullVs', 'piecesFs', { strip: false }),
    ]);
    const gridModule = device.createShaderModule({ code: GRID_SHADER });
    const compute = (entryPoint) => device.createComputePipelineAsync({
      layout: L.gridPipelines, compute: { module: gridModule, entryPoint },
    });
    [this.countPipeline, this.sumBlocksPipeline, this.sumOverBlocksPipeline, this.startListsPipeline, this.fillPipeline, this.sortPipeline] =
      await Promise.all(['countCells', 'sumBlocks', 'sumOverBlocks', 'startLists', 'fillLists', 'sortLists'].map(compute));
    this.kefrensColumnsPipeline = await device.createComputePipelineAsync({
      layout: L.kefrensPipeline, compute: { module: device.createShaderModule({ code: KEFRENS_SHADER }), entryPoint: 'kefrensColumns' },
    });
    this.tablePipeline = await device.createComputePipelineAsync({
      layout: L.tablePipeline, compute: { module: device.createShaderModule({ code: TABLE_SHADER }), entryPoint: 'makeBallTable' },
    });
  }

  // The canvas: its colour space (Wide colour) and whether it may show light
  // brighter than white (HDR: toneMapping "extended"; else "standard", which
  // cuts it at white, as an ordinary canvas does).
  // Where the browser can, the canvas takes linear light ("-linear"), so the
  // scene can be drawn straight into it (see draw).
  // (boing.renderer.testToneMapping = 'standard', in the console: HDR stays
  // on in every other way, to measure what the screen's HDR mode costs.)
  configure(mode = this.testToneMapping ?? (this.hdr ? 'extended' : 'standard'),
    colorSpace = (this.wideColor ? 'display-p3' : 'srgb') + (this.linearCanvas ? '-linear' : '')) {
    if (this.disposed || this.shownAs === colorSpace + mode) return;
    this.shownAs = colorSpace + mode;
    try {
      this.context.configure({
        device: this.device,
        format: FORMAT,
        colorSpace,
        toneMapping: { mode },
        alphaMode: 'opaque',
      });
    } catch (e) {
      // (Only "srgb-linear" was tried at the start: should the wide-colour
      // "display-p3-linear" be refused, draw by way of the last step instead.)
      if (!colorSpace.endsWith('-linear')) throw e;
      this.linearCanvas = false;
      this.shownAs = null;
      this.configure(mode);
    }
  }

  // HDR on or off (see setHdr in main.js). Returns false if it can't be on.
  setHdr(on) {
    if (on && !this.canShowHdr) return false;
    // (renderer.hdr says that HDR is on; see also SceneRenderer.prepare.)
    this.hdr = on ? { get screenIsHdr() { return matchMedia('(dynamic-range: high)').matches; } } : null;
    this.configure();
    return true;
  }

  applyColorSpace() { this.configure(); }

  // The ball colours go as far as Rec. 2020 (see ELEMENTARY_IN_2020 in
  // renderer.js) where the screen says it shows about that much, and HDR is
  // on: the canvas then takes colours beyond Display P3 (below 0 there),
  // which the screen shows as far as it can. Without HDR the canvas stops at
  // P3, so they would be cut off there, hue and all.
  get colourLevel() {
    if (!this.canvasIsWide) return 0;
    return this.hdr && onRec2020Screen() ? 2 : 1;
  }

  // (Nothing to wait for: see main.js, which only asks without HDR.)
  waitUntilDone() {}

  resize() {
    const { width, height } = this.measure();
    this.canvas.style.imageRendering = this.view.style.imageRendering;   // big pixels stay crisp
    if (this.target && this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.target?.dispose();
    this.target = makeTarget(this.device, width, height);
    this.makePresentGroup();
  }

  // An effect as the backdrop (see BACKDROPS in renderer.js): its own drawer
  // (see twist.js and effects.js) draws it each frame straight into the
  // scene's own picture (or the canvas, when the scene is drawn straight
  // into it), in linear light, before the scene, which is then drawn over
  // it. The drawer thinks it draws on a canvas; this one hands it the
  // scene's picture instead (canvas.linear: in light, not screen colours).
  // this.picture is for the Kefrens bars (see KEFRENS_SHADER); otherwise it
  // is one pixel. True if an effect was drawn.
  // (Drawing the effects inside the scene's own pass instead was tried in
  // 2.04-326: slower on an Apple Mac, see gpuTunnelDrawer in effects.js.)
  // (timing: the frame's, while it is timed: the effect's pass is timed as
  // the backdrop.)
  drawPicture(options, into, timing = null) {
    const name = pictureBackdrop(options) ? options.backdrop : null;
    // (Made anew for another effect, or none any more, and when big pixels
    // come or go: then it draws sharp, see sharpen in twist.js; and when
    // boing.smoothEffects is switched.)
    if (name !== this.pictureOf || effectLook() !== this.pictureLook) {
      this.pictureLook = effectLook();
      this.pictureDrawer?.dispose();
      this.pictureOf = name;
      this.pictureDrawer = name ? options.effect.gpu({
        width: 1, height: 1, linear: true,
        getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => this.pictureInto }),
      }, this.device) : null;
    }
    // (The Kefrens bars are worked out into this.picture: see kefrensColumns.)
    const whole = options.copper && options.backdrop === 'kefrens';
    const width = whole ? this.target.width : 1, height = whole ? this.target.height : 1;
    if (this.picture.width !== width || this.picture.height !== height) {
      this.picture.destroy();
      this.picture = this.device.createTexture({ size: [width, height], format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
      this.makePresentGroup();
    }
    if (!this.pictureDrawer) return false;
    this.pictureInto = into;
    this.pictureDrawer.setLook(this.canvasIsWide, Boolean(this.hdr));
    this.pictureDrawer.timestampWrites = timing ? timing.writes('backdrop') : undefined;
    this.pictureDrawer.draw(options.backdropTime ?? 0, this.target.width, this.target.height, this.hdr ? (options.effect.glow ?? 0) : 0);
    return true;
  }

  // The pictures the shaders read (made anew when one of them is).
  makePresentGroup() {
    if (!this.target) return;
    this.kefrensGroup = this.device.createBindGroup({
      layout: this.layouts.kefrens,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.kefrensBuffer } },
        { binding: 2, resource: this.picture.createView() },
      ],
    });
    this.frontGroup = this.device.createBindGroup({
      layout: this.layouts.letters,
      entries: [
        { binding: 2, resource: { buffer: this.scrollerBuffer } },
        { binding: 4, resource: { buffer: this.trailRingBuffer } },
        { binding: 5, resource: { buffer: this.trailBallBuffer } },
        { binding: 6, resource: { buffer: this.kefrensBuffer } },
        { binding: 7, resource: this.picture.createView() },
        { binding: 8, resource: this.piecesTexture.createView() },
        { binding: 9, resource: this.floorPiecesTexture.createView() },
      ],
    });
    this.presentGroup = this.device.createBindGroup({
      layout: this.layouts.presentInputs,
      entries: [
        { binding: 1, resource: this.target.sceneView },
        { binding: 2, resource: { buffer: this.scrollerBuffer } },
        { binding: 3, resource: this.piecesTexture.createView() },
      ],
    });
  }

  // The pieces of burst balls lying on the floor: its picture (see bake in
  // shell-pieces.js), a colour code a square, sent when it has changed.
  sendFloorPieces(floor) {
    if (!floor || (this.floorPiecesSent?.floor === floor && this.floorPiecesSent.version === floor.version)) return;
    if (this.floorPiecesTexture.width !== floor.width || this.floorPiecesTexture.height !== floor.height) {
      this.floorPiecesTexture.destroy();
      this.floorPiecesTexture = this.device.createTexture({ size: [floor.width, floor.height], format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.makePresentGroup();
    }
    this.device.queue.writeTexture({ texture: this.floorPiecesTexture }, floor.codes,
      { bytesPerRow: floor.width }, [floor.width, floor.height]);
    this.floorPiecesSent = { floor, version: floor.version };
  }

  // The pieces' picture: nothing (one see-through pixel) ...
  emptyPieces() {
    return this.device.createTexture({ size: [1, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  }

  // ... or the pieces (image: see piecesImage in countdown.js), copied over
  // when they have changed, in the scene's colours (Display P3 on a
  // wide-colour screen, else sRGB: see toCanvas).
  sendPieces(image) {
    if (!image) {
      if (this.piecesSent === -1) return;
      this.piecesTexture.destroy();
      this.piecesTexture = this.emptyPieces();
      this.piecesSent = -1;
      this.makePresentGroup();
      return;
    }
    if (image.version === this.piecesSent) return;
    const { width, height } = image.canvas;
    if (this.piecesTexture.width !== width || this.piecesTexture.height !== height) {
      this.piecesTexture.destroy();
      this.piecesTexture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.makePresentGroup();
    }
    this.device.queue.copyExternalImageToTexture({ source: image.canvas },
      { texture: this.piecesTexture, colorSpace: this.canvasIsWide ? 'display-p3' : 'srgb', premultipliedAlpha: false }, [width, height]);
    this.piecesSent = image.version;
  }

  // The scroller (see scroller.js), drawn here, by the graphics card, rather
  // than on its own canvas: no picture is drawn on the main processor and
  // copied over each frame, and the letters can shine brighter than white
  // with HDR. Its font and text are sent once; each frame only how far the
  // text has scrolled and where the wave is: those numbers (the Frame's
  // scroll and scrollText), put into f at `at`.
  scrollerNumbers(scroller, rect, f, at) {
    if (this.scrollerText !== scroller.message) {
      this.scrollerText = scroller.message;
      const words = scroller.words;
      this.scrollerBuffer.destroy();
      this.scrollerBuffer = this.device.createBuffer({ size: words.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(this.scrollerBuffer, 0, words);
      this.makePresentGroup();
    }
    f.set(scroller.place(rect, this.pixelated), at);
    put4(f, at + 4, scroller.letterNumbers.length, scroller.glyphRows.length, this.pixelated ? 1 : 0, 0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pictureDrawer?.dispose();
    this.canvas.remove();
    this.view.style.opacity = '';
    this.device.destroy();
  }

  draw(camera, balls, options = {}) {
    if (this.disposed) return;
    if (!this.target) this.resize();
    const frame = this.prepare(camera, balls, options);
    const { count, eye } = frame;
    const device = this.device, queue = device.queue;
    const { width, height } = this.target;

    // ---- Send this frame's numbers.
    const f = this.frameData;
    toWebGpuDepth(camera.viewProjection, f);
    // (Number by number, into the same block every frame: no new lists.)
    put4(f, 16, eye.x, eye.y, eye.z, 0); this.frameWords[19] = count;
    put4(f, 20, frame.light.x, frame.light.y, frame.light.z, frame.shadowRange);
    put4(f, 24, frame.forward.x, frame.forward.y, frame.forward.z, SHADOW_STRENGTH);
    put4(f, 28, frame.side.x, frame.side.y, frame.side.z, frame.edgeWidth);
    put4(f, 32, frame.up.x, frame.up.y, frame.up.z, frame.shadowOpacity);
    const sc = frame.shadowColor;
    put4(f, 36, sc[0], sc[1], sc[2], frame.glint);
    put4(f, 40, frame.floorY, frame.floorHalfSize, BOX_HALF_SIZE, frame.lineWidth);
    f.set(frame.wallShown, 44);
    const gridLooks = gridLook(options), gc = gridLooks.color;
    put4(f, 48, gc[0], gc[1], gc[2], gridLooks.opacity);
    put4(f, 52, width, height, frame.trailWidth, backdropTime(options));
    put4(f, 56, height, frame.shine, this.edgeUnits, this.hdr ? frame.textGlow : 0);
    const scroller = options.scroller;
    const textRect = scroller ? this.textRect(scroller.strip, width, height) : null;
    if (textRect) f.set(textRect, 60); else put4(f, 60, 0, 0, 0, 0);
    if (textRect) this.scrollerNumbers(scroller, textRect, f, 76);
    // (Tile clicks: see tileClicksNow in tile-clicks.js. And the grid's colour as
    // it is on the screen, for the edges of squares turning and shrinking.)
    const clicks = options.tileClicks ?? NO_TILE_CLICKS;
    f.set(clicks.tiles, 96);
    // (The pieces of burst balls lying on the floor: where its picture lies,
    // see floorPieceAt; and whether there are shadows on the floor.)
    const floor = options.floorPieces ?? null;
    if (floor) put4(f, 88, floor.x0, floor.z0, 1 / floor.across, 1 / floor.deep); else put4(f, 88, 0, 0, 0, 0);
    put4(f, 92, frame.showShadows ? 1 : 0, 0, 0, 0);
    // (Colours used for every pixel, in linear light, worked out once here
    // rather than for each pixel: the grid's lit and in shadow, and white in
    // shadow. See shade in the shaders.)
    const grid = gridLooks.color;
    put4(f, 64, this.hdr ? HDR_RANGE : 0, srgbToLinear(1 - SHADOW_STRENGTH), frame.shadowReach, BACKDROPS.indexOf(options.backdrop ?? 'bars'));
    const wide = this.canvasIsWide;
    // (Worked out again only when the grid's colour or the canvas changes.)
    const key = this.gridColorKey ??= [NaN, NaN, NaN, null];
    if (key[0] !== grid[0] || key[1] !== grid[1] || key[2] !== grid[2] || key[3] !== wide) {
      key[0] = grid[0]; key[1] = grid[1]; key[2] = grid[2]; key[3] = wide;
      this.gridLit = toCanvasLight(grid.map(srgbToLinear), wide);
      this.gridShadowed = toCanvasLight(grid.map((c) => srgbToLinear(c * (1 - SHADOW_STRENGTH))), wide);
    }
    put4(f, 68, this.gridLit[0], this.gridLit[1], this.gridLit[2], this.colourLevel);
    put4(f, 72, this.gridShadowed[0], this.gridShadowed[1], this.gridShadowed[2], count >= SORT_FROM ? 1 : 0);
    put4(f, 84, grid[0], grid[1], grid[2], 0);
    queue.writeBuffer(this.frameBuffer, 0, f);

    const w = this.wallData;
    for (let index = 0; index < frame.walls.length; index++) {
      const { wall, extend, drawEdge, catchesShadows } = frame.walls[index];
      const at = index * WALL_STRIDE / 4;
      w.set(extend, at);
      w.set(drawEdge, at + 4);
      put4(w, at + 8, wall.center.x, wall.center.y, wall.center.z, catchesShadows ? 1 : 0);
      const paint = clicks.paint.get(wallKey(wall.center)) ?? NO_PAINT;
      put4(w, at + 12, wall.axisU.x, wall.axisU.y, wall.axisU.z, paint.some((word) => word !== 0) ? 1 : 0);
      put4(w, at + 16, wall.axisV.x, wall.axisV.y, wall.axisV.z, 0);
      this.wallWords.set(paint, at + 20);
    }
    queue.writeBuffer(this.wallBuffer, 0, w);

    if (count > 0 && frame.tableOnGpu) {
      queue.writeBuffer(this.numberBuffer, 0, options.ballNumbers, 0, count * BALL_NUMBERS);
      queue.writeBuffer(this.orderBuffer, 0, this.drawOrder, 0, count);
    } else if (count > 0) {
      queue.writeBuffer(this.ballBuffer, 0, this.ballTable, 0, count * BALL_TABLE_COLUMNS * 4);
    }

    const pieces = options.trailSeconds > 0 ? this.sendTrails(balls, count, options.trailTime ?? 0, options.trailSeconds) : 0;
    if (options.copper && options.backdrop === 'kefrens') {
      const rows = this.kefrensRows(width, height, backdropTime(options));
      if (this.kefrensBuffer.size < rows * 8) {
        this.kefrensBuffer.destroy();
        this.kefrensBuffer = device.createBuffer({ size: rows * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.makePresentGroup();
      }
      queue.writeBuffer(this.kefrensBuffer, 0, this.kefrensData, 0, rows * 2);
    }


    // Straight into the canvas, where it takes linear light (see configure),
    // so no last copy is needed. (That copy cost 1.2–1.7 ms a frame, measured
    // on an Apple Mac at 3338 × 2410 in 2.04-329.)
    this.configure();   // (first: it may find that the canvas can't take linear light after all)
    const direct = this.linearCanvas;
    this.sendPieces(options.pieces ?? null);
    this.sendFloorPieces(options.floorPieces ?? null);
    const canvasView = this.context.getCurrentTexture().createView();
    const sceneView = direct ? canvasView : this.target.sceneView;
    // While the Info page is shown, the graphics card times the frame (see
    // GpuTimer).
    const timing = this.measureGpu && this.timer ? this.timer.start() : null;
    // (boing.measure({ parts: true }) leaves parts out, one at a time, to see
    // what each costs: see measure.js. Otherwise this is empty.)
    const skip = this.skipParts ?? NOTHING_SKIPPED;
    // An effect as the backdrop, first, straight into the scene's picture
    // (see drawPicture): the scene is then drawn over it.
    const effectDrawn = !skip.has('backdrop') &&
      this.drawPicture(options, direct ? this.context.getCurrentTexture() : this.target.scene, timing);

    const encoder = device.createCommandEncoder();
    // First the ball table (see makeBallTable), then the shadow grid, for this frame's balls (see buildShadowGrid).
    this.buildShadowGrid(encoder, count, frame.showShadows, timing, frame.tableOnGpu);
    // The Kefrens bars, into the picture, column by column (see KEFRENS_SHADER).
    if (options.copper && options.backdrop === 'kefrens' && !skip.has('backdrop')) {
      const pass = encoder.beginComputePass({ timestampWrites: timing ? timing.writes('backdrop') : undefined });
      pass.setBindGroup(0, this.kefrensGroup);
      pass.setPipeline(this.kefrensColumnsPipeline);
      pass.dispatchWorkgroups(Math.ceil(width / 64));
      pass.end();
    }
    const passFor = (part, attachments) => encoder.beginRenderPass({
      ...attachments,
      timestampWrites: timing ? timing.writes(part) : undefined,
    });

    // The depth of the nearest ball, for skipping hidden pixels (see Step 2).
    // Normally the quick way: an octagon inside each ball's outline at the
    // depth of its middle, which needs no work per pixel (see ballCoreVs).
    // With trails, the exact depth of each ball's surface: a trail may start
    // inside the front half of its ball, where the quick depth wouldn't hide it.
    const exactDepth = pieces > 0;

    // ---- Step 2: the scene, in linear light, all in one pass: first the
    // balls' depth (only depth, no colour), then everything else, which is
    // tested against it, so the graphics card skips pixels behind the
    // nearest ball before working on them at all. In one pass, the depth
    // never leaves the graphics card's own fast memory (Apple's cards keep a
    // whole tile of the picture on the chip.)
    const pass = passFor('scene', {
      colorAttachments: [{
        view: sceneView, loadOp: effectDrawn ? 'load' : 'clear', storeOp: 'store',
        clearValue: [...BACKGROUND.map(srgbToLinear), 1],
      }],
      depthStencilAttachment: {
        view: this.target.frontDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard',
      },
    });
    pass.setBindGroup(0, this.sharedGroup);
    pass.setBindGroup(1, this.frontGroup);
    pass.setBindGroup(2, this.wallGroup, [0]);
    // (Measured on an Apple Mac at 3338 × 2410 in 2.04-329: without this,
    // relying on the graphics card's own skipping of hidden pixels, 1000
    // balls took 1.5–3 ms a frame longer and 4000 almost twice as long; with
    // four balls it made no difference worth having.)
    if (count > 0 && !skip.has('balls')) {
      pass.setPipeline(exactDepth ? this.ballDepthInPassPipeline : this.ballCoreInPassPipeline);
      pass.draw(BALL_CORNERS, count);
    }
    if (skip.has('backdrop')) {
      // (left out)
    } else if (options.copper && (options.backdrop ?? 'bars') === 'bars') {
      pass.setPipeline(this.copperRowsPipeline);   // (row by row: see copperRowsVs)
      pass.draw(4, height);
    } else if (options.copper && !effectDrawn) {   // (an effect: already there, see drawPicture)
      const kind = BACKDROPS.indexOf(options.backdrop);
      pass.setPipeline([this.starsPipeline, this.plasmaPipeline, this.kefrensPipeline][kind - 1]);
      pass.draw(3);
    }
    if ((frame.showShadows || options.floorPieces) && eye.y > frame.floorY && !skip.has('floor')) {
      pass.setPipeline(this.floorPipeline);
      pass.draw(4);
    }
    if (frame.showGrid && !skip.has('walls')) {
      pass.setPipeline((options.tileClicks ?? NO_TILE_CLICKS).tiles[3] >= 0 ? this.wallTilesPipeline : this.wallPipeline);
      frame.walls.forEach((wall, index) => {
        if (!wall.shown) return;
        pass.setBindGroup(2, this.wallGroup, [index * WALL_STRIDE]);
        pass.draw(4);
      });
    }
    if (count > 0 && !skip.has('balls')) {
      pass.setPipeline(this.earlyDepth ? this.ballPipeline : this.ballLatePipeline);
      pass.draw(BALL_CORNERS, count);
    }
    if (pieces > 0 && !skip.has('trails')) {
      if (this.trail.written > 0) {
        pass.setPipeline(this.trailPipeline);
        pass.draw(4, Math.min(this.trail.written, this.trail.room));
      }
      pass.setPipeline(this.trailHeadPipeline);
      pass.draw(4, count);
    }
    // The pieces of burst balls, then the scroller, laid over the scene
    // (drawn straight in: else in the last step).
    if (direct && options.pieces) {
      pass.setPipeline(this.piecesPipeline);
      pass.draw(3);
    }
    if (direct && textRect && !skip.has('scroller')) {
      pass.setPipeline(this.textPipeline);
      pass.draw(4);
    }
    pass.end();

    // ---- Step 3: to the canvas, as screen colours (brighter than white
    // where the light is). (Only when not drawn straight in.)
    if (!direct) {
      const pass = passFor('copy', {
        colorAttachments: [{ view: canvasView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.sharedGroup);
      pass.setBindGroup(1, this.presentGroup);
      pass.draw(3);
      pass.end();
    }
    timing?.finish(encoder);
    queue.submit([encoder.finish()]);
    timing?.read((ms, all) => {
      this.gpuTotalMs += all;
      this.gpuFrames++;
      // (Each part's time too, for boing.measure in main.js.)
      const parts = this.gpuParts ??= {};
      for (const part in ms) parts[part] = (parts[part] ?? 0) + ms[part];
    });
    this.drewDirect = direct;   // (for boing.measure: straight into the canvas, or by way of the last step)

    // The first picture is on its way: from now on this canvas shows the
    // scene, and the page's own canvas (under the pointer) is invisible.
    if (!this.shownOnce) {
      this.shownOnce = true;
      this.view.style.opacity = '0';
    }
  }

  // (The WebGL renderer's trails: not used here, see sendTrails.)
  trailRoomGrown() {}

  // The ring of trail pieces, made anew with room for `room` pieces (and
  // empty: sendTrails then sends every piece again).
  growTrailRing(room) {
    const t = this.trail;
    t.room = room;
    t.written = 0;
    t.owner = new Int32Array(room).fill(-1);
    t.generation = new Int32Array(room);
    t.index = new Float64Array(room);
    t.sentGeneration.fill(-1);
    this.trailRingBuffer?.destroy();
    this.trailRingBuffer = this.device.createBuffer({
      size: room * TRAIL_RING_NUMBERS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.makePresentGroup();
  }

  // Bring the trails on the graphics card up to date (see the constructor):
  // the pieces laid down since last time go into the ring, after the last
  // one written, where the oldest were; and for every ball, the few numbers
  // of the frame. Returns how many balls have a trail (0: draw none).
  //
  // A piece is known by its ball, the ball's trail's "generation" (it goes
  // up each time the trail starts afresh) and its place along the trail
  // counted from the very start (trailBase in physics-client.js counts the
  // points dropped since): the shader shows it only while all three still
  // fit, so dropped and old pieces simply vanish. Should the ring be about
  // to overwrite a piece that still shows, it is made twice as big and
  // filled afresh.
  sendTrails(balls, count, now, seconds) {
    const t = this.trail, queue = this.device.queue, wide = this.colourLevel;
    let withTrails = 0, staged = 0, stageStart = t.written;
    const flush = () => {
      if (staged === 0) return;
      // (In one or two parts: the ring may wrap round in between.)
      const first = stageStart % t.room, firstPart = Math.min(staged, t.room - first);
      queue.writeBuffer(this.trailRingBuffer, first * TRAIL_RING_NUMBERS * 4, t.staging, 0, firstPart * TRAIL_RING_NUMBERS);
      if (staged > firstPart) queue.writeBuffer(this.trailRingBuffer, 0, t.staging, firstPart * TRAIL_RING_NUMBERS, (staged - firstPart) * TRAIL_RING_NUMBERS);
      stageStart += staged;
      staged = 0;
    };
    const isShown = (place) => {
      const ball = t.owner[place];
      if (ball < 0 || ball >= count) return false;
      const b = balls[ball];
      return t.generation[place] === b.trailGeneration && t.index[place] >= b.trailBase;
    };
    for (let i = 0; i < count; i++) {
      const b = balls[i], trail = b.trail, base = b.trailBase;
      const points = trail.length / 4, fixed = points - (b.trailHead ? 1 : 0);
      if (t.sentGeneration[i] !== b.trailGeneration) {
        t.sentGeneration[i] = b.trailGeneration;
        t.sentUpTo[i] = base;
      }
      // The new pieces: from point a to a + 1, both laid down for good.
      const end = base + fixed - 1;
      for (let a = Math.max(t.sentUpTo[i], base); a < end; a++) {
        const place = (stageStart + staged) % t.room;
        if (isShown(place)) {
          // (Full: twice the room, and everything sent again, from scratch.)
          if (t.room < MAX_TRAIL_RING) {
            this.growTrailRing(Math.min(MAX_TRAIL_RING, t.room * 2));
            return this.sendTrails(balls, count, now, seconds);
          }
        }
        if (staged * TRAIL_RING_NUMBERS >= t.staging.length) {
          flush();
          if (t.staging.length < 65536 * TRAIL_RING_NUMBERS) t.staging = new Float32Array(t.staging.length * 2);
        }
        const k = (a - base) * 4, s = staged * TRAIL_RING_NUMBERS, out = t.staging;
        out[s] = trail[k]; out[s + 1] = trail[k + 1]; out[s + 2] = trail[k + 2]; out[s + 3] = trail[k + 3];
        out[s + 4] = trail[k + 4]; out[s + 5] = trail[k + 5]; out[s + 6] = trail[k + 6]; out[s + 7] = trail[k + 7];
        out[s + 8] = i; out[s + 9] = b.trailGeneration; out[s + 10] = a; out[s + 11] = 0;
        const at = (stageStart + staged) % t.room;
        t.owner[at] = i; t.generation[at] = b.trailGeneration; t.index[at] = a;
        staged++;
        t.written++;
      }
      t.sentUpTo[i] = Math.max(t.sentUpTo[i], end);
      // The ball's own numbers: colour and how long its trail fades over
      // (Trails, or longer for a ball with a longer trail: see fillTrails in
      // renderer.js), which pieces still show, and the piece from its last
      // point to the ball as drawn.
      const o = i * TRAIL_BALL_NUMBERS, out = t.balls;
      const [r, g, bl] = ballRgb(b.color, wide);
      const span = points > 0 ? Math.max(seconds, Math.abs(now - trail[3])) : seconds;
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = span;
      out[o + 4] = b.trailGeneration; out[o + 5] = base; out[o + 6] = now;
      // (The fade's power, 1 … 8: see trailPower; below 0 for a ball without a head piece.)
      const withHead = b.trailHead && fixed >= 1;
      out[o + 7] = trailPower(span, seconds) * (withHead ? 1 : -1);
      if (withHead) {
        const k = (fixed - 1) * 4, p = b.position;
        out[o + 8] = trail[k]; out[o + 9] = trail[k + 1]; out[o + 10] = trail[k + 2]; out[o + 11] = trail[k + 3];
        out[o + 12] = p.x; out[o + 13] = p.y; out[o + 14] = p.z; out[o + 15] = trail[trail.length - 1];
      }
      if (points > 1) withTrails++;
    }
    flush();
    if (count > 0) queue.writeBuffer(this.trailBallBuffer, 0, t.balls, 0, count * TRAIL_BALL_NUMBERS);
    return withTrails;
  }

  // (The shadow lists are built here, at their full size from the start:
  // see the constructor. Nothing to do when the main processor's would grow.)
  shadowListGrown() {}

  // ---- The shadow grid, built on the graphics card (see GRID_SHADER) ----
  // Each step runs as many small programs side by side as there is work:
  //   1. count: for each ball, 64 at once go over the cells of the square
  //      around its shadow, and count it in each cell its shadow cone
  //      reaches (the same test as fillShadowGrid in renderer.js);
  //   2. a running sum of the counts, in blocks of 256 cells and then over
  //      the blocks, says where each cell's list starts;
  //   3. fill: the same test again, now writing each ball (its middle and
  //      radius) into the lists. (In any order: a pixel's shadow doesn't depend on it.)
  // Without shadows, the grid is simply left empty.
  // (The ball table is built in the same pass, first: one small program per
  // ball.)
  buildShadowGrid(encoder, count, showShadows, timing, makeTable) {
    const grid = showShadows && count > 0;
    if (!grid) encoder.clearBuffer(this.cellBuffer);
    if (!grid && !(makeTable && count > 0)) return;
    if (grid) encoder.clearBuffer(this.countBuffer);
    const pass = encoder.beginComputePass({ timestampWrites: timing ? timing.writes('shadows') : undefined });
    if (makeTable && count > 0) {
      pass.setBindGroup(0, this.tableGroup);
      pass.setPipeline(this.tablePipeline);
      pass.dispatchWorkgroups(Math.ceil(count / 64));
    }
    if (!grid) { pass.end(); return; }
    pass.setBindGroup(0, this.gridGroup);
    pass.setPipeline(this.countPipeline);
    pass.dispatchWorkgroups(count);
    pass.setPipeline(this.sumBlocksPipeline);
    pass.dispatchWorkgroups(CELLS / 256);
    pass.setPipeline(this.sumOverBlocksPipeline);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.startListsPipeline);
    pass.dispatchWorkgroups(CELLS / 256);
    pass.setPipeline(this.fillPipeline);
    pass.dispatchWorkgroups(count);
    if (count >= SORT_FROM) {
      pass.setPipeline(this.sortPipeline);
      pass.dispatchWorkgroups(CELLS / 64);
    }
    pass.end();
  }
}

// Timing the graphics card's work (for the Info page): it writes the time at
// the start and end of each part ("pass") into a query set, which is copied
// into a buffer to be read back a frame or two later. A few such buffers
// take turns; when all are still waiting, a frame goes untimed.
// (Browsers round these times to a tenth of a millisecond or so; summed
// over a second they still come out right.)
// Each part's time is counted from the end of the part before, not from its
// own start: Apple's graphics cards begin the parts all at once and finish
// them one after another, so the start stamps all say "the frame began".
// (Elsewhere the two ways agree.)
// (backdrop: an effect drawn as the backdrop, in a pass of its own before
// the others (see drawPicture), or the Kefrens bars' columns.)
const PARTS = ['backdrop', 'shadows', 'scene', 'copy'];   // (the passes, in order)
class GpuTimer {
  constructor(device) {
    this.device = device;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 * PARTS.length });
    this.resolved = device.createBuffer({
      size: 16 * PARTS.length, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.free = [];
    this.made = 0;
  }

  start() {
    let readBack = this.free.pop();
    if (!readBack && this.made < 4) {
      this.made++;
      readBack = this.device.createBuffer({
        size: 16 * PARTS.length, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }
    if (!readBack) return null;
    const used = new Set();
    const { querySet, resolved, free } = this;
    return {
      writes(part) {
        const k = PARTS.indexOf(part);
        used.add(k);
        return { querySet, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 };
      },
      finish(encoder) {
        encoder.resolveQuerySet(querySet, 0, 2 * PARTS.length, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, readBack, 0, 16 * PARTS.length);
      },
      // Calls back with ({ part: milliseconds }, all milliseconds) once the
      // card has finished.
      read(callback) {
        readBack.mapAsync(GPUMapMode.READ).then(() => {
          const times = new BigInt64Array(readBack.getMappedRange());
          const order = [...used].sort((a, b) => a - b);
          const ms = {};
          const start = times[2 * order[0]];
          let before = start;
          for (const k of order) {
            const end = times[2 * k + 1];
            ms[PARTS[k]] = Math.max(0, Number(end - before) / 1e6);
            if (end > before) before = end;
          }
          const all = Math.max(0, Number(before - start) / 1e6);
          readBack.unmap();
          free.push(readBack);
          callback(ms, all);
        }, () => {});   // (the card was lost meanwhile)
      },
    };
  }
}

// WebGL's depth runs from −1 (near) to 1 (far), WebGPU's from 0 to 1: the
// same matrix, with depth halved and moved up by a half. (So a point's
// WebGPU depth is the very number WebGL wrote into its depth buffer.)
function toWebGpuDepth(m, out) {
  out.set(m, 0);
  for (let column = 0; column < 4; column++) {
    out[column * 4 + 2] = 0.5 * m[column * 4 + 2] + 0.5 * m[column * 4 + 3];
  }
}

// The off-screen pictures: the scene in linear light (when not drawn
// straight into the canvas), and the first pass's front depth (also used by
// the main pass).
function makeTarget(device, width, height) {
  const texture = (format, usage) => device.createTexture({ size: [width, height], format, usage });
  const A = GPUTextureUsage.RENDER_ATTACHMENT, T = GPUTextureUsage.TEXTURE_BINDING;
  const scene = texture(FORMAT, A | T);
  const frontDepth = texture(DEPTH_FORMAT, A);
  return {
    width, height, scene,
    sceneView: scene.createView(),
    frontDepthView: frontDepth.createView(),
    dispose() { scene.destroy(); frontDepth.destroy(); },
  };
}

// What the shaders are given, in four groups:
//   0 (shared): the frame's numbers, the ball table, the shadow grid and lists
//   1: the letters (main pass) — or the scene and the letters (last step)
//   2: the wall being drawn
function makeLayouts(device) {
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const shared = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: V | F, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: F, buffer: { type: 'read-only-storage' } },
  ] });
  const letters = device.createBindGroupLayout({ entries: [
    { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },   // (the scroller's font and text)
    { binding: 4, visibility: V, buffer: { type: 'read-only-storage' } },   // (the trails' ring of pieces ...
    { binding: 5, visibility: V, buffer: { type: 'read-only-storage' } },   // ... and each ball's numbers: see sendTrails)
    { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },   // (the Kefrens bars' rows: see kefrensRows in renderer.js)
    { binding: 7, visibility: F, texture: { sampleType: 'float' } },        // (an effect's picture, as the backdrop: see drawPicture)
    { binding: 8, visibility: F, texture: { sampleType: 'float' } },        // (the pieces of burst balls: see sendPieces)
    { binding: 9, visibility: F, texture: { sampleType: 'float' } },        // (and those lying on the floor: see sendFloorPieces)
  ] });
  const wall = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
  ] });
  const presentInputs = device.createBindGroupLayout({ entries: [
    { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: F, texture: { sampleType: 'float' } },        // (the pieces of burst balls: see sendPieces)
  ] });
  // (For building the shadow grid: see GRID_SHADER.)
  const C = GPUShaderStage.COMPUTE;
  const grid = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    ...[2, 3, 4, 5].map((binding) => ({ binding, visibility: C, buffer: { type: 'storage' } })),
  ] });
  const table = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: C, buffer: { type: 'storage' } },
  ] });
  // (For the Kefrens bars, column by column: see KEFRENS_SHADER.)
  const kefrens = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: FORMAT } },
  ] });
  const pipelineLayout = (groups) => device.createPipelineLayout({ bindGroupLayouts: groups });
  return {
    kefrens, kefrensPipeline: pipelineLayout([kefrens]),
    shared, letters, wall, presentInputs, grid, gridPipelines: pipelineLayout([grid]),
    table, tablePipeline: pipelineLayout([table]),
    front: pipelineLayout([shared]),
    scene: pipelineLayout([shared, letters, wall]),
    present: pipelineLayout([shared, presentInputs]),
  };
}


// The numbers for the frame, as the shaders see them (see draw: the Frame
// uniform, FRAME_FLOATS numbers).
const FRAME_STRUCT = /* wgsl */ `
  struct Frame {
    viewProjection: mat4x4f,
    cameraPosition: vec3f, ballCount: u32,
    lightPosition: vec3f, shadowRange: f32,
    lightForward: vec3f, shadowStrength: f32,
    lightSide: vec3f, edgeWidth: f32,
    lightUp: vec3f, shadowOpacity: f32,
    shadowColor: vec3f, glint: f32,
    floorY: f32, floorHalfSize: f32, halfSize: f32, lineWidth: f32,
    wallShown: vec4f,
    gridColor: vec3f, lineOpacity: f32,
    viewport: vec2f, trailWidth: f32, time: f32,
    height: f32, shine: f32, edgeUnits: f32, textGlow: f32,
    textRect: vec4f,
    hdrRange: f32, whiteInShadow: f32, shadowReach: f32, backdrop: f32,
    gridLit: vec3f, wide: f32,   // wide: 1 = colours go to the canvas as Display P3 (see SRGB_TO_P3 in renderer.js); 2 = and the ball colours as far as Rec. 2020
    gridInShadow: vec3f, listsInOrder: f32,   // listsInOrder: 1 = each cell's shadow list nearest the lamp first (see sortLists)
    scroll: vec4f,       // the scroller: how far scrolled, the wave's phase, its width and the text's (see scrollerColor)
    scrollText: vec4f,   // how many letters, and where they start in scrollerText
    gridScreen: vec4f,   // the grid's colour on the screen (sRGB)
    floorPieces: vec4f,  // where the floor's picture of the pieces on it lies (see floorPieceAt)
    floorShadows: vec4f, // x: 1 = shadows (the floor may also be drawn only for the pieces on it)
    tiles: array<vec4f, ${TILE_CLICKS}>,   // clicks on the room (see TILE_CLICK_MATHS in shaders.js)
  }
`;

// =============================================================================
// The shaders, in WGSL: shaders.js translated line by line (the comments
// there explain them).
// =============================================================================
const SHADER = /* wgsl */ `
  ${FRAME_STRUCT}
  struct Wall {
    extend: vec4f,
    drawEdge: vec4f,
    center: vec3f, catchShadows: f32,
    axisU: vec3f, painted: f32,   // painted: 1 = any of its paint (below) is on
    axisV: vec3f,
    paint: array<vec4u, ${PAINT_WORDS / 4}>,   // its paint, 4 bits a square (see TILE_CLICK_MATHS in shaders.js)
  }

  @group(0) @binding(0) var<uniform> frame: Frame;
  @group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
  @group(0) @binding(2) var<storage, read> shadowCells: array<u32>;
  @group(0) @binding(3) var<storage, read> shadowList: array<vec4f>;   // (the balls' middles and radii)
  @group(1) @binding(1) var scene: texture_2d<f32>;
  @group(1) @binding(2) var<storage, read> scrollerText: array<u32>;
  @group(1) @binding(4) var<storage, read> trailRing: array<vec4f>;    // per piece: start and its time, end and its time, (ball, generation, place)
  @group(1) @binding(5) var<storage, read> trailBalls: array<vec4f>;   // per ball: see sendTrails
  @group(1) @binding(7) var picture: texture_2d<f32>;                  // an effect as the backdrop: see drawPicture
  @group(1) @binding(8) var piecesInScene: texture_2d<f32>;            // the pieces of burst balls (see sendPieces): drawn straight in ...
  @group(1) @binding(3) var piecesInLastStep: texture_2d<f32>;         // ... or in the last step
  @group(1) @binding(9) var floorPiecesPicture: texture_2d<f32>;       // those lying on the floor (see sendFloorPieces)
  @group(1) @binding(6) var<storage, read> kefrensRows: array<vec2f>;  // the Kefrens bars, per row of pixels from the top: see kefrensRows in renderer.js
  @group(2) @binding(0) var<uniform> wall: Wall;

  const PI = 3.14159265359;

  // ---- The ball table ----
  fn ballSphere(i: i32) -> vec4f { return ballData[i * 6]; }
  fn ballColor(i: i32) -> vec4f { return ballData[i * 6 + 1]; }
  fn ballRotation(i: i32) -> mat3x3f {
    return mat3x3f(ballData[i * 6 + 2].xyz, ballData[i * 6 + 3].xyz, ballData[i * 6 + 4].xyz);
  }
  fn ballDrawnAs(k: i32) -> i32 { return i32(ballData[k * 6 + 5].x); }

  // ---- Shapes: corners made up from the vertex number ----
  // A square from (-1,-1) to (1,1), in triangle-strip order.
  fn squareCorner(v: u32) -> vec2f { return vec2f(f32(v >> 1u), f32(v & 1u)) * 2.0 - 1.0; }
  // One triangle that covers the whole picture.
  @vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
    let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  }

  // ---- Colour ----
  // Screen colour (sRGB) → linear light, for numbers below 0 too (the ball
  // colours on a wide-colour screen: see ELEMENTARY_IN_P3 in colors.js).
  fn toLinear(c: vec3f) -> vec3f {
    let a = abs(c);
    return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a < vec3f(0.04045));
  }
  // That light as the canvas takes it: Display P3 on a wide-colour screen,
  // so every colour looks exactly as in sRGB (see SRGB_TO_P3 in renderer.js).
  fn toCanvas(c: vec3f) -> vec3f {
    const SRGB_TO_P3 = ${srgbToP3Matrix('wgsl')};
    let l = toLinear(c);
    return select(l, SRGB_TO_P3 * l, frame.wide > 0.5);
  }
  fn toScreen(c: vec3f) -> vec3f {
    let a = abs(c);   // (mirrored below 0: see presentFs)
    return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));
  }

  // ---- Edges ----
  fn smoothEdge(pixelsInside: f32) -> f32 {
    return clamp(pixelsInside / frame.edgeWidth + 0.5, 0.0, 1.0);
  }

  // ---- Skipping hidden pixels ----
  // (The shaders of the main pass never "discard" a pixel: where there is
  // nothing to draw they give it a fully see-through colour instead, which
  // blends to exactly nothing. A shader that may discard can stop some
  // graphics cards — Apple's among them — from skipping hidden pixels before
  // running it.)
  // (Done by the graphics card's depth test, against the first pass's
  // depth of the nearest ball: see Step 2 in draw, and ballVs.)

  // ---- Shadows ----
  // (skip: the middle of the ball whose own surface this is, which casts no
  // shadow on itself; NO_BALL for the floor and walls. Each list holds the
  // balls themselves, middle and radius, one after another: read straight
  // through, rather than looked up one by one in the ball table.)
  const NO_BALL = vec3f(3.0e38);
  fn shadowAt(p: vec3f, stepX: vec3f, stepY: vec3f, skip: vec3f) -> f32 {
    let pixelReach = (length(stepX) + length(stepY)) * frame.edgeWidth;
    let toLight = frame.lightPosition - p;
    let lightDist = length(toLight);
    let lightDir = toLight / lightDist;

    let ahead = -dot(toLight, frame.lightForward);
    if (ahead <= 0.0) { return 0.0; }
    let seen = -vec2f(dot(toLight, frame.lightSide), dot(toLight, frame.lightUp)) / ahead;
    let cell = clamp(vec2i(floor((seen / (2.0 * frame.shadowRange) + 0.5) * ${SHADOW_GRID}.0)),
                     vec2i(0), vec2i(${SHADOW_GRID} - 1));

    var shadow = 0.0;
    let cellEntry = shadowCells[cell.y * ${SHADOW_GRID} + cell.x];
    let first = cellEntry >> 12u;
    let listed = cellEntry & 4095u;
    // (Nearest the lamp first, so the rest is skipped once a ball lies
    // wholly farther ahead: see shadowAt in shaders.js, and sortLists.)
    let reachAhead = ahead + pixelReach;
    for (var k = 0u; k < listed; k++) {
      let sphere = shadowList[first + k];
      if (frame.listsInOrder > 0.5 && dot(sphere.xyz - frame.lightPosition, frame.lightForward) - sphere.w > reachAhead) { break; }
      if (all(sphere.xyz == skip)) { continue; }

      let toBall = sphere.xyz - p;
      let radius = sphere.w;
      let along = dot(toBall, lightDir);
      if (along <= 0.0 || along >= lightDist) { continue; }
      let miss = toBall - lightDir * along;
      let missSq = dot(miss, miss);
      if (missSq > (radius + pixelReach) * (radius + pixelReach)) { continue; }

      let missDist = sqrt(missSq);
      let away = miss / max(missDist, 1e-6);
      let perPixel = abs(dot(away, stepX)) + abs(dot(away, stepY));
      shadow = max(shadow, smoothEdge((radius - missDist) / max(perPixel, 1e-6)));
      if (shadow >= 1.0) { break; }
    }
    return shadow;
  }

  // ---- 1. Floor ----
  struct Surface { @builtin(position) at: vec4f, @location(0) world: vec3f }

  @vertex fn floorVs(@builtin(vertex_index) v: u32) -> Surface {
    let corner = squareCorner(v);
    var o: Surface;
    o.world = vec3f(corner.x * frame.floorHalfSize, frame.floorY, corner.y * frame.floorHalfSize);
    o.at = frame.viewProjection * vec4f(o.world, 1.0);
    return o;
  }

  // The pieces of burst balls lying on the floor (see FLOOR_PIECES in
  // shaders.js): the colour of the one at p (a = 1), or none.
  fn floorPieceAt(p: vec3f) -> vec4f {
    let area = frame.floorPieces;
    if (area.z <= 0.0) { return vec4f(0.0); }
    let uv = vec2f((p.x - area.x) * area.z, (p.z - area.y) * area.w);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) { return vec4f(0.0); }
    let size = textureDimensions(floorPiecesPicture);
    let code = floor(textureLoad(floorPiecesPicture, vec2u(uv * vec2f(size)), 0).r * 255.0 + 0.5);
    if (code < 0.5) { return vec4f(0.0); }
    return vec4f(select(elementaryColor(code - 1.0, frame.wide), vec3f(1.0), code > 4.5), 1.0);
  }
  // The same, smoothed (see floorPiecesIn in shaders.js).
  fn floorPiecesIn(p: vec3f, stepX: vec3f, stepY: vec3f) -> vec4f {
    if (frame.floorPieces.z <= 0.0) { return vec4f(0.0); }
    if (frame.edgeWidth < 0.5) { return floorPieceAt(p); }
    var sum = vec4f(0.0);
    for (var k = 0u; k < 4u; k++) {
      let o = vec2f(f32(k % 2u), f32(k / 2u)) * 0.5 - 0.25;
      let c = floorPieceAt(p + stepX * o.x + stepY * o.y);
      sum += vec4f(c.rgb * c.a, c.a);
    }
    if (sum.a <= 0.0) { return vec4f(0.0); }
    return vec4f(sum.rgb / sum.a, sum.a * 0.25);
  }

  @fragment fn floorFs(s: Surface) -> @location(0) vec4f {
    let stepX = dpdxFine(s.world);
    let stepY = dpdyFine(s.world);
    let h = frame.halfSize;
    let shown = frame.wallShown;
    // (The pieces lying here: in the light and shadow there.)
    let piece = floorPiecesIn(s.world, stepX, stepY);
    var shadow = 0.0;
    if (frame.floorShadows.x > 0.5) { shadow = shadowAt(s.world, stepX, stepY, NO_BALL); }
    if (piece.a > 0.0) {
      let lit = mix(toLinear(piece.rgb), toLinear(piece.rgb * (1.0 - frame.shadowStrength)), shadow);
      let under = (1.0 - piece.a) * shadow * frame.shadowOpacity;
      let a = piece.a + under;
      return vec4f((lit * piece.a + frame.shadowColor * under) / a, a);
    }
    if ((s.world.x < -h && shown.x > 0.5) || (s.world.x > h && shown.y > 0.5) ||
        (s.world.z < -h && shown.z > 0.5) || (s.world.z > h && shown.w > 0.5)) { return vec4f(0.0); }
    if (shadow <= 0.0) { return vec4f(0.0); }
    return vec4f(frame.shadowColor, shadow * frame.shadowOpacity);
  }

  // ---- 2. Walls ----
  struct WallPoint { @builtin(position) at: vec4f, @location(0) grid: vec2f, @location(1) world: vec3f }

  const MARGIN = 0.25;
  @vertex fn wallVs(@builtin(vertex_index) v: u32) -> WallPoint {
    let corner = squareCorner(v);
    let high = frame.halfSize + MARGIN + wall.extend.xz;
    let low = frame.halfSize + MARGIN + wall.extend.yw;
    var o: WallPoint;
    o.grid = mix(-low, high, corner * 0.5 + 0.5);
    o.world = wall.center + wall.axisU * o.grid.x + wall.axisV * o.grid.y;
    o.at = frame.viewProjection * vec4f(o.world, 1.0);
    return o;
  }

  fn lineCoverage(pixelsAway: f32, width: f32) -> f32 { return smoothEdge(0.5 * width - pixelsAway); }
  // A screen colour (sRGB) on the wall, lit or in shadow (as shade in shaders.js).
  fn shadeWall(c: vec3f, shadow: f32) -> vec3f { return mix(toCanvas(c), toCanvas(c * (1.0 - frame.shadowStrength)), shadow); }
  // An elementary colour (see colors.js) on the wall: as shadeWall, but on a
  // wide-colour screen it is a P3 colour already.
  fn shadeElementary(c: vec3f, shadow: f32) -> vec3f { return mix(toLinear(c), toLinear(c * (1.0 - frame.shadowStrength)), shadow); }
  // A square's paint (see TILE_CLICK_MATHS in shaders.js): its four bits.
  fn paintOf(square: f32) -> f32 {
    if (square < 0.0) { return 0.0; }
    let i = u32(square);
    let word = wall.paint[i / 32u][(i / 8u) % 4u];
    return f32((word >> (4u * (i % 8u))) & 15u);
  }
  ${toWgsl(TILE_CLICK_MATHS)}


  // (Two programs: the clicked squares' effects only in the one for while
  // one is under way, see renderer.js.)
  @fragment fn wallFs(s: WallPoint) -> @location(0) vec4f { return wallColor(s, false); }
  @fragment fn wallTilesFs(s: WallPoint) -> @location(0) vec4f { return wallColor(s, true); }
  fn wallColor(s: WallPoint, withTiles: bool) -> vec4f {
    let h = frame.halfSize;
    // (The true length of the slope, not fwidth's sum of the two: see
    // shaders.js, which explains it.)
    let slopeX = dpdxFine(s.grid);
    let slopeY = dpdyFine(s.grid);
    let unitsPerPixel = sqrt(slopeX * slopeX + slopeY * slopeY);
    let nearestLine = floor(s.grid + 0.5);
    let toLine = abs((s.grid - nearestLine) / unitsPerPixel + 0.03);
    let toEdge = abs(abs(s.grid) - h) / unitsPerPixel;
    // (Nowhere near a line, as most pixels: skipped. See shaders.js.)
    var coverage = 0.0;
    if (min(min(toLine.x, toLine.y), min(toEdge.x, toEdge.y)) < 0.5 * frame.lineWidth + frame.edgeWidth) {
    let pastEdge = (abs(s.grid) - h) / min(unitsPerPixel, vec2f(frame.edgeUnits));
    let width = vec2f(frame.lineWidth);
    let packedLines = width * unitsPerPixel;
    let fade = 1.0 - smoothstep(vec2f(0.25), vec2f(0.6), packedLines);
    let inner = select(vec2f(1.0), vec2f(0.0), abs(nearestLine) >= vec2f(h));
    let ends = vec2f(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
    let innerAlongY = lineCoverage(toLine.x, width.x) * inner.x * fade.x * ends.x;
    let innerAlongX = lineCoverage(toLine.y, width.y) * inner.y * fade.y * ends.y;
    let drawsEdge = vec2f(select(wall.drawEdge.y, wall.drawEdge.x, s.grid.x > 0.0),
                          select(wall.drawEdge.w, wall.drawEdge.z, s.grid.y > 0.0));
    let edgeAlongY = lineCoverage(toEdge.x, width.x) * drawsEdge.x * smoothEdge(0.5 * width.x - pastEdge.x) * ends.x;
    let edgeAlongX = lineCoverage(toEdge.y, width.y) * drawsEdge.y * smoothEdge(0.5 * width.y - pastEdge.y) * ends.y;
    coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
    }
    // (Tile clicks: see shaders.js.)
    // (First only which one, if any, is at this square: see shaders.js.)
    var tile = vec4f(0.0);
    if (withTiles) {
    let square = floor(s.grid) + 0.5;
    let squareMiddle = s.world + wall.axisU * (square.x - s.grid.x) + wall.axisV * (square.y - s.grid.y);
    var here = -1;
    for (var i = 0; i < ${TILE_CLICKS}; i++) {
      if (frame.tiles[i].w < 0.0) { break; }   // (the rest are empty too: see tileClicksNow in tile-clicks.js)
      if (distance(squareMiddle, frame.tiles[i].xyz) < 0.25) { here = i; }
    }
    if (here >= 0) { tile = tileAt(s.grid, s.world, wall.axisU, wall.axisV, frame.tiles[here], unitsPerPixel, frame.lineWidth, frame.gridScreen.rgb, vec2f(s.at.x, frame.height - s.at.y)); }
    }
    var paint = vec4f(0.0);
    if (wall.painted > 0.5) { paint = paintColor(paintOf(paintSquare(s.grid, s.world, wall.axisU, wall.axisV, h)), frame.wide); }
    // (On the floor, where a piece of a burst ball lies: nothing of the
    // wall over it. See shaders.js.)
    let floorStepX = dpdxFine(s.world);   // (out here: as all such steps, outside any if)
    let floorStepY = dpdyFine(s.world);
    if (wall.axisU.y == 0.0 && wall.axisV.y == 0.0 && s.world.y < 0.0) {
      let under = 1.0 - floorPiecesIn(s.world, floorStepX, floorStepY).a;
      coverage *= under; tile.a *= under; paint.a *= under;
    }

    let e = wall.extend;
    let pastCatch = vec4f(s.grid.x - h - e.x, -s.grid.x - h - e.y,
                          s.grid.y - h - e.z, -s.grid.y - h - e.w) / unitsPerPixel.xxyy;
    let inside = select(vec4f(0.0), vec4f(1.0), pastCatch <= vec4f(0.1));
    let onWall = wall.catchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));

    let stepX = dpdxFine(s.world);
    let stepY = dpdyFine(s.world);
    if (coverage <= 0.0 && onWall <= 0.0 && tile.a <= 0.0 && paint.a <= 0.0) { return vec4f(0.0); }

    let shadow = shadowAt(s.world, stepX, stepY, NO_BALL);
    let lineLayer = coverage * frame.lineOpacity;
    let tileLayer = tile.a * (1.0 - lineLayer);
    let paintLayer = paint.a * (1.0 - lineLayer - tileLayer);
    let shadowLayer = onWall * shadow * frame.shadowOpacity * (1.0 - lineLayer - tileLayer - paintLayer);
    let opacity = lineLayer + tileLayer + paintLayer + shadowLayer;
    if (opacity <= 0.0) { return vec4f(0.0); }
    let gridColor = mix(frame.gridLit, frame.gridInShadow, shadow);
    var color = gridColor * lineLayer + frame.shadowColor * shadowLayer;
    if (tileLayer > 0.0) { color += shadeWall(tile.rgb, shadow) * tileLayer; }      // (only where there is
    if (paintLayer > 0.0) { color += shadeElementary(paint.rgb, shadow) * paintLayer; }   // one: see shaders.js)
    color /= opacity;
    return vec4f(color, opacity);
  }

  // ---- 3. Balls ----
  struct BallPoint {
    @builtin(position) at: vec4f,
    @location(0) world: vec3f,
    @location(1) @interpolate(flat) ball: i32,
    // The ball's colour in linear light, lit and in shadow (worked out once
    // per corner here, rather than for each pixel: see shade).
    @location(2) @interpolate(flat) lit: vec3f,
    @location(3) @interpolate(flat) inShadow: vec3f,
  }

  @vertex fn ballVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> BallPoint {
    let i = ballDrawnAs(i32(k));
    var o: BallPoint;
    o.ball = i;
    o.lit = toCanvas(ballColor(i).rgb);
    o.inShadow = toCanvas(ballColor(i).rgb * (1.0 - frame.shadowStrength));
    let center = ballSphere(i).xyz;
    let radius = ballSphere(i).w;
    let toBall = center - frame.cameraPosition;
    let distance = length(toBall);
    if (distance <= radius * 1.001) {
      o.world = center;
      o.at = vec4f(2.0, 2.0, 2.0, 1.0);
      return o;
    }
    let forward = toBall / distance;
    let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(forward.y) < 0.99);
    let right = normalize(cross(forward, helper));
    let up = cross(right, forward);
    // The outline's radius, at the ball's middle (the cone from the eye
    // that just touches the ball, cut there), and a few pixels more for the
    // soft edge. (A fixed share more, as before, made a big ball near the
    // camera run its shader for a wide ring of pixels around it in vain.)
    let outline = radius * distance / sqrt(distance * distance - radius * radius);
    let middle = frame.viewProjection * vec4f(center, 1.0);
    let side = frame.viewProjection * vec4f(center + right * outline, 1.0);
    var halfSize = outline * 1.1;
    if (middle.w > 1e-3 && side.w > 1e-3) {
      let pixels = length((side.xy / side.w - middle.xy / middle.w) * frame.viewport * 0.5);
      halfSize = outline * min(1.1, 1.0 + (3.0 + frame.edgeWidth) / max(pixels, 1e-3));
    }
    let corner = octagonCorner(v);
    o.world = center + (right * corner.x + up * corner.y) * halfSize;
    o.at = frame.viewProjection * vec4f(o.world, 1.0);
    // The whole octagon at the depth of the ball's nearest point (no point
    // of the ball is nearer), so that the graphics card can skip pixels
    // where another ball is surely in front, before any work on them. (The
    // camera looks along the gradient of clip w: the matrix's last row.)
    // A hair nearer still (1 % of the radius): where the ball faces the
    // camera, its surface is at almost exactly that depth, and the first
    // pass's depth there could come out a rounding error nearer — which
    // would skip that pixel, leaving a dot.
    let m = frame.viewProjection;
    let nearest = m * vec4f(center - normalize(vec3f(m[0].w, m[1].w, m[2].w)) * radius * 1.01, 1.0);
    let nearestDepth = select(0.0, clamp(nearest.z / nearest.w, 0.0, 1.0), nearest.w > 1e-4);
    o.at.z = nearestDepth * o.at.w;
    return o;
  }

  // The quick first pass: each ball as an octagon inside its outline, a
  // pixel and a half in from the edge (where the ball doesn't cover the
  // whole pixel), all at the depth of the ball's middle. Everything behind
  // that is behind the ball's front surface, so hidden: the main pass skips
  // it (see Step 2 in draw). Only the depth is written, with no work per
  // pixel at all.
  @vertex fn ballCoreVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> @builtin(position) vec4f {
    let i = ballDrawnAs(i32(k));
    let center = ballSphere(i).xyz;
    let radius = ballSphere(i).w;
    let toBall = center - frame.cameraPosition;
    let distance = length(toBall);
    let middle = frame.viewProjection * vec4f(center, 1.0);
    if (distance <= radius * 1.001 || middle.w < 1e-3) { return vec4f(2.0, 2.0, 2.0, 1.0); }
    let forward = toBall / distance;
    let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(forward.y) < 0.99);
    let right = normalize(cross(forward, helper));
    let up = cross(right, forward);
    // The outline's radius, at the ball's middle, in world units and pixels.
    let outline = radius * distance / sqrt(distance * distance - radius * radius);
    let side = frame.viewProjection * vec4f(center + right * outline, 1.0);
    let pixels = length((side.xy / side.w - middle.xy / middle.w) * frame.viewport * 0.5);
    let inside = max(0.0, 1.0 - 1.5 / max(pixels, 1e-3));
    // (octagonCorner is around the circle; times cos 22.5°, inside it.)
    let corner = octagonCorner(v) * cos(PI / 8.0) * inside;
    let at = frame.viewProjection * vec4f(center + (right * corner.x + up * corner.y) * outline, 1.0);
    return vec4f(at.xy, clamp(middle.z / middle.w, 0.0, 1.0) * at.w, at.w);
  }

  // An octagon around the circle of radius 1, in triangle-strip order:
  // 17 % fewer pixels than a square (each ball's corners are pure waste).
  fn octagonCorner(v: u32) -> vec2f {
    var order = array<u32, 8>(0u, 1u, 7u, 2u, 6u, 3u, 5u, 4u);
    let angle = (f32(order[v]) + 0.5) * PI / 4.0;
    return vec2f(cos(angle), sin(angle)) / cos(PI / 8.0);
  }

  // (The checks: see SQUARE_WAVE in shade.js.)${toWgsl(SQUARE_WAVE)}

  // (It doesn't set its own depth: the graphics card's depth test, which
  // skips hidden pixels before this runs, uses the ball's nearest point —
  // see ballVs. Balls are drawn from far to near, so nearer ones end up on
  // top anyway.)
  @fragment fn ballFs(s: BallPoint) -> @location(0) vec4f {
    let center = ballSphere(s.ball).xyz;
    let radius = ballSphere(s.ball).w;
    let rayDir = normalize(s.world - frame.cameraPosition);
    let toCenter = center - frame.cameraPosition;
    let along = dot(toCenter, rayDir);
    let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
    let inside = radius - missDist;
    let coverage = smoothEdge(inside / max(fwidthFine(inside), 1e-6));

    let halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
    let hit = frame.cameraPosition + rayDir * (along - halfChord);
    let normal = normalize(hit - center);
    let surface = center + normal * radius;

    // The ball's own direction to this point (turned with the ball), and how
    // it changes from one pixel to the next. All the changes from pixel to
    // pixel are taken here, before the pixels outside the ball's outline
    // leave (a pixel's neighbours must all still be there to compare with);
    // the checkers' squares are then worked out only for pixels on the ball.
    let n = transpose(ballRotation(s.ball)) * normal;
    let nX = dpdxFine(n);
    let nY = dpdyFine(n);
    let stepX = dpdxFine(surface);
    let stepY = dpdyFine(surface);
    if (coverage <= 0.0) { return vec4f(0.0); }

    // Where on the checkers: around (longitude) and down (latitude), in
    // squares, and how much they change from one pixel to the next (by the
    // chain rule, from the change in n: smooth all round, also across the
    // seam where "around" starts again at 0).
    let squaresDown = ballColor(s.ball).a;
    let squaresAround = 2.0 * squaresDown;
    let around = atan2(n.z, n.x) / (2.0 * PI) + 0.5;
    let down = acos(clamp(n.y, -1.0, 1.0)) / PI;
    let square = vec2f(around * squaresAround, down * squaresDown);
    let flat = max(n.x * n.x + n.z * n.z, 1e-12);
    let aroundX = (n.x * nX.z - n.z * nX.x) / flat;
    let aroundY = (n.x * nY.z - n.z * nY.x) / flat;
    let downPer = 1.0 / sqrt(flat);   // (−d acos(y) = dy / sqrt(1 − y²), and 1 − y² = x² + z²)
    let blur = vec2f((abs(aroundX) + abs(aroundY)) * squaresAround / (2.0 * PI),
                     (abs(nX.y) + abs(nY.y)) * downPer * squaresDown / PI) * frame.edgeWidth;
    let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);

    let shadow = shadowAt(surface, stepX, stepY, center);
    var color = mix(vec3f(mix(1.0, frame.whiteInShadow, shadow)), mix(s.lit, s.inShadow, shadow), checker);
    if (frame.glint > 0.0) {
      let toLamp = normalize(frame.lightPosition - surface);
      let halfway = normalize(toLamp - rayDir);
      color += vec3f(frame.glint * pow(max(dot(normal, halfway), 0.0), 120.0) * (1.0 - shadow));
    }
    return vec4f(color, coverage);
  }

  // (For drawing only depth in a pass that has a picture too.)
  @fragment fn noColorFs() -> @location(0) vec4f { return vec4f(0.0); }
  struct DepthOnly { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
  @fragment fn ballDepthInPassFs(s: BallPoint) -> DepthOnly {
    let depth = ballSurfaceDepth(s);
    if (depth < 0.0) { discard; }
    var o: DepthOnly;
    o.color = vec4f(0.0);
    o.depth = depth;
    return o;
  }
  // The exact depth of the ball's surface at this pixel, or −1 off its
  // outline (and its soft edge).
  fn ballSurfaceDepth(s: BallPoint) -> f32 {
    let center = ballSphere(s.ball).xyz;
    let radius = ballSphere(s.ball).w;
    let rayDir = normalize(s.world - frame.cameraPosition);
    let toCenter = center - frame.cameraPosition;
    let along = dot(toCenter, rayDir);
    let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
    let pixelsInside = (radius - missDist) / max(fwidthFine(missDist), 1e-6);
    if (pixelsInside < 0.5 * frame.edgeWidth + 0.1) { return -1.0; }
    let halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
    let clip = frame.viewProjection * vec4f(frame.cameraPosition + rayDir * (along - halfChord), 1.0);
    return clip.z / clip.w;
  }

  // ---- 3b. Trails ----
  struct TrailPoint {
    @builtin(position) at: vec4f,
    @location(0) color: vec3f,
    @location(1) fade: f32,
    @location(2) side: f32,
  }

  // A point of a trail fades with its age, over the trail's length.
  fn trailFade(ball: u32, time: f32) -> f32 {
    let look = trailBalls[ball * 4u];
    let now = trailBalls[ball * 4u + 1u].z;
    // (A longer trail fades only towards its end, by a power above 1: see
    // fillTrails in renderer.js.)
    let power = abs(trailBalls[ball * 4u + 1u].w);
    return ${TRAIL_OPACITY} * (1.0 - pow(min(1.0, abs(now - time) / look.w), power));
  }
  const HIDDEN = vec4f(2.0, 2.0, 2.0, 1.0);

  // A piece from the ring: shown only while it is still part of its ball's
  // trail (see sendTrails).
  @vertex fn trailVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> TrailPoint {
    let start = trailRing[k * 3u];
    let end = trailRing[k * 3u + 1u];
    let id = trailRing[k * 3u + 2u];
    let ball = u32(id.x);
    // (A piece of a ball that is gone — one past the balls there are now —
    // is hidden: that ball's numbers in trailBalls are old, not written this
    // frame, and could still match.)
    if (ball >= frame.ballCount) { var o: TrailPoint; o.at = HIDDEN; return o; }
    let now = trailBalls[ball * 4u + 1u];
    if (id.y != now.x || id.z < now.y) { var o: TrailPoint; o.at = HIDDEN; return o; }
    return trailPiece(v, start.xyz, end.xyz, trailBalls[ball * 4u].rgb,
                      vec2f(trailFade(ball, start.w), trailFade(ball, end.w)));
  }
  // The piece from a ball's last point to the ball itself.
  @vertex fn trailHeadVs(@builtin(vertex_index) v: u32, @builtin(instance_index) ball: u32) -> TrailPoint {
    if (trailBalls[ball * 4u + 1u].w < 0.5) { var o: TrailPoint; o.at = HIDDEN; return o; }
    let last = trailBalls[ball * 4u + 2u];
    let head = trailBalls[ball * 4u + 3u];
    return trailPiece(v, last.xyz, head.xyz, trailBalls[ball * 4u].rgb,
                      vec2f(trailFade(ball, last.w), trailFade(ball, head.w)));
  }

  fn trailPiece(v: u32, startAt: vec3f, endAt: vec3f, color: vec3f, fades: vec2f) -> TrailPoint {
    var o: TrailPoint;
    let start = frame.viewProjection * vec4f(startAt, 1.0);
    let end = frame.viewProjection * vec4f(endAt, 1.0);
    if (start.w < 0.05 || end.w < 0.05) {
      o.at = vec4f(2.0, 2.0, 2.0, 1.0);
      return o;
    }
    let halfView = frame.viewport * 0.5;
    let a = start.xy / start.w * halfView;
    let b = end.xy / end.w * halfView;
    var along = b - a;
    let len = length(along);
    along = select(vec2f(1.0, 0.0), along / len, len > 1e-4);
    let across = vec2f(-along.y, along.x);
    let corner = squareCorner(v);
    let t = corner.x * 0.5 + 0.5;
    o.side = corner.y * (0.5 * frame.trailWidth + 1.0);
    o.fade = mix(fades.x, fades.y, t);
    o.color = color;
    var p = mix(start, end, t);
    p = vec4f(p.xy + across * o.side / halfView * p.w, p.zw);
    o.at = p;
    return o;
  }

  @fragment fn trailFs(s: TrailPoint) -> @location(0) vec4f {
    let coverage = clamp((0.5 * frame.trailWidth - abs(s.side)) / frame.edgeWidth + 0.5, 0.0, 1.0);
    return vec4f(toCanvas(s.color), coverage * s.fade);
  }

  // ---- 0. The backdrops (see shaders.js) ----
  var<private> shine: f32 = 0.0;

  // (Ball colour i, as the balls show it: see colors.js.)
  ${toWgsl(ELEMENTARY_COLOR_MATHS)}
  fn backdropColor(i: f32) -> vec3f { return elementaryColor(i, frame.wide); }
  // (The backdrops' maths itself is written once, for WebGL and WebGPU: see
  // BACKDROP_MATHS in shaders.js, and shade.js.)
  fn kefrensRow(i: i32) -> vec2f { return kefrensRows[i]; }
  ${toWgsl(BACKDROP_MATHS, { time: 'frame.time', height: 'frame.height', width: 'frame.viewport.x', hard: 'select(0.0, 1.0, frame.edgeWidth < 0.5)' })}

  // One entry per backdrop (and one for the effects' pictures), so each
  // pipeline holds only its own backdrop's code: a graphics card runs a
  // small program much faster than one holding all of them. (The copper
  // bars: copperRowsVs, below.)
  fn copperOut(color: vec3f) -> vec4f {
    return vec4f(toCanvas(min(color, vec3f(1.0))) * (1.0 + frame.shine * shine), 1.0);
  }
  @fragment fn starsFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
    return copperOut(stars(vec2f(at0.x, frame.height - at0.y)));   // (from the bottom left, as in WebGL)
  }
  @fragment fn plasmaFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
    return copperOut(plasma(vec2f(at0.x, frame.height - at0.y) / frame.height));
  }
  @fragment fn kefrensFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
    let worked = textureLoad(picture, vec2i(at0.xy), 0);   // (see KEFRENS_SHADER)
    shine = worked.a;
    return copperOut(worked.rgb);
  }
  // The copper bars row by row: one long, thin square per row of pixels
  // (counted from the bottom), its colour worked out once, for its corners
  // (see COPPER_ROWS_VERTEX_SHADER in shaders.js).
  struct CopperRow { @builtin(position) at: vec4f, @location(0) @interpolate(flat) color: vec4f }
  @vertex fn copperRowsVs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> CopperRow {
    let corner = vec2f(f32(v & 1u), f32(v >> 1u));
    let row = f32(i);
    let color = copperBars((row + 0.5) / frame.height);
    var o: CopperRow;
    o.color = vec4f(toCanvas(min(color, vec3f(1.0))) * (1.0 + frame.shine * shine), 1.0);
    o.at = vec4f(corner.x * 2.0 - 1.0, (row + corner.y) / frame.height * 2.0 - 1.0, 0.0, 1.0);
    return o;
  }
  @fragment fn copperRowsFs(row: CopperRow) -> @location(0) vec4f { return row.color; }

  // ---- 3c. The glowing letters, drawn straight into the canvas ----
  // (As in the last step below: a square over the scroller's place.)
  struct Letter { @builtin(position) at: vec4f, @location(0) t: vec2f }
  @vertex fn textVs(@builtin(vertex_index) v: u32) -> Letter {
    let corner = squareCorner(v) * 0.5 + 0.5;
    let fromBottom = frame.textRect.xy + corner * frame.textRect.zw;
    var o: Letter;
    o.t = corner;
    o.at = vec4f(fromBottom / vec2f(frame.viewport.x, frame.height) * 2.0 - 1.0, 0.0, 1.0);
    return o;
  }
  @fragment fn textFs(s: Letter) -> @location(0) vec4f {
    return scrollerColor(s.at.xy);
  }

  // ---- 3c'. The pieces of burst balls (see sendPieces): their picture, in
  // screen colours as the canvas takes them, as light; nothing outside it.
  fn piecesAt(pieces: texture_2d<f32>, at: vec2f) -> vec4f {
    let size = textureDimensions(pieces);
    let p = vec2u(at);
    if (p.x >= size.x || p.y >= size.y) { return vec4f(0.0); }
    let c = textureLoad(pieces, p, 0);
    return vec4f(toLinear(c.rgb), c.a);
  }
  @fragment fn piecesFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return piecesAt(piecesInScene, at.xy);
  }

  // ---- 3d. The scroller (its drawing is written once, for both renderers,
  // in scroller.js: SCROLLER_SHADER) ----
  fn scrollerWord(i: u32) -> u32 { return scrollerText[i]; }
  ${toWgsl(SCROLLER_SHADER, { scroll: 'frame.scroll', scrollText: 'frame.scrollText', textRect: 'frame.textRect', height: 'frame.height', textGlow: 'frame.textGlow' })}

  // ---- 4. To the canvas ----
  // A WebGPU canvas of floats in the colour space "srgb" takes screen
  // colours, where 1 is white and more is brighter (with HDR): the usual
  // sRGB curve, carried on above 1 (up to HDR_RANGE times white).
  @fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    // (Below 0 only with the ball colours beyond P3, Rec. 2020: those stay,
    // the curve mirrored, as the canvas takes them. Else nothing is.)
    let read = textureLoad(scene, vec2i(at.xy), 0).rgb;
    var linear = select(max(read, vec3f(0.0)), read, frame.wide > 1.5);
    let piece = piecesAt(piecesInLastStep, at.xy);
    linear = mix(linear, piece.rgb, piece.a);
    let letter = scrollerColor(at.xy);
    linear = mix(linear, letter.rgb, letter.a);
    var color = toScreen(min(linear, vec3f(1.0)));
    if (frame.hdrRange > 0.0) {
      let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
      color = select(color, bright, linear > vec3f(1.0));
    }
    return vec4f(color, 1.0);
  }
`;


// =============================================================================
// Building the shadow grid on the graphics card (see buildShadowGrid). The
// same grid and lists as fillShadowGrid in renderer.js builds on the main
// processor for WebGL: for each cell of the lamp's view, the balls whose
// shadow cone reaches it.
// =============================================================================
const GRID_SHADER = /* wgsl */ `
  ${FRAME_STRUCT}
  @group(0) @binding(0) var<uniform> frame: Frame;
  @group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
  @group(0) @binding(2) var<storage, read_write> cells: array<u32>;   // start × 4096 + count
  @group(0) @binding(3) var<storage, read_write> lists: array<vec4f>;
  @group(0) @binding(4) var<storage, read_write> counts: array<atomic<u32>>;
  @group(0) @binding(5) var<storage, read_write> blocks: array<u32>;

  const GRID = ${SHADOW_GRID};
  const LIST_ROOM = ${LIST_ROOM}u;
  const BLOCKS = ${CELLS / 256}u;

  // One ball's shadow, as the lamp sees it: the square of cells around it
  // (with a cell to spare all round), and its cone.
  struct Shadow {
    x0: i32, x1: i32, z0: i32, z1: i32,
    whole: bool,          // the square reaches the grid's border: take it all
    toBall: vec3f,        // (sideways, up, ahead) from the lamp
    distance: f32,
    sinCone: f32, cosCone: f32,
  }

  fn toCell(v: f32) -> i32 {
    return i32(floor((v + frame.shadowRange) * f32(GRID) / (2.0 * frame.shadowRange)));
  }

  // False if the ball is at or behind the lamp: no shadow.
  fn shadowOf(i: u32, s: ptr<function, Shadow>) -> bool {
    let sphere = ballData[i * 6u];
    let r = sphere.w;
    let f = sphere.xyz - frame.lightPosition;
    let below = dot(f, frame.lightForward);
    if (below - r <= 0.0) { return false; }
    let side = dot(f, frame.lightSide);
    let up = dot(f, frame.lightUp);
    let near = 1.0 / (below - r);
    let far = 1.0 / (below + r);
    let a = min((side - r) * near, (side - r) * far);
    let b = max((side + r) * near, (side + r) * far);
    let c = min((up - r) * near, (up - r) * far);
    let d = max((up + r) * near, (up + r) * far);
    (*s).x0 = clamp(toCell(a) - 1, 0, GRID - 1);
    (*s).x1 = clamp(toCell(b) + 1, 0, GRID - 1);
    (*s).z0 = clamp(toCell(c) - 1, 0, GRID - 1);
    (*s).z1 = clamp(toCell(d) + 1, 0, GRID - 1);
    (*s).whole = (*s).x0 == 0 || (*s).z0 == 0 || (*s).x1 == GRID - 1 || (*s).z1 == GRID - 1;
    (*s).toBall = vec3f(side, up, below);
    (*s).distance = length((*s).toBall);
    (*s).sinCone = min(1.0, r / (*s).distance);
    (*s).cosCone = sqrt(1.0 - (*s).sinCone * (*s).sinCone);
    return true;
  }

  // Does the ball's shadow cone reach this cell? Its middle, seen from the
  // lamp, is the direction (sx, sy, 1): within the cone's half-angle plus a
  // margin — the cell's half-diagonal (over the direction's length, at least
  // the angle it spans) and the soft edges' reach (over the ball's distance)?
  fn reaches(s: Shadow, x: i32, z: i32) -> bool {
    if (s.whole) { return true; }
    let cellSize = 2.0 * frame.shadowRange / f32(GRID);
    let sx = (f32(x) + 0.5) * cellSize - frame.shadowRange;
    let sy = (f32(z) + 0.5) * cellSize - frame.shadowRange;
    let length = sqrt(sx * sx + sy * sy + 1.0);
    let cosAngle = dot(vec3f(sx, sy, 1.0), s.toBall) / (length * s.distance);
    let m = min(1.0, 0.75 * cellSize / length + frame.shadowReach / s.distance);
    let cosM = sqrt(1.0 - m * m);
    return cosAngle >= s.cosCone * cosM - s.sinCone * m;
  }

  // 1. Count each ball in the cells it can shade: one group of 64 per ball.
  @compute @workgroup_size(64)
  fn countCells(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) t: u32) {
    var s: Shadow;
    if (group.x >= frame.ballCount || !shadowOf(group.x, &s)) { return; }
    let width = s.x1 - s.x0 + 1;
    let all = width * (s.z1 - s.z0 + 1);
    for (var k = i32(t); k < all; k += 64) {
      let x = s.x0 + k % width;
      let z = s.z0 + k / width;
      if (reaches(s, x, z)) { atomicAdd(&counts[z * GRID + x], 1u); }
    }
  }

  // 2. Where each cell's list starts: a running sum of the counts. First
  // within blocks of 256 cells (side by side) ...
  var<workgroup> sums: array<u32, 256>;
  fn runningSum(t: u32) {
    // (Each step adds the value 1, 2, 4, ... places back: after 8 steps,
    // each place holds the sum of all up to and including itself.)
    for (var back = 1u; back < 256u; back <<= 1u) {
      var add = 0u;
      if (t >= back) { add = sums[t - back]; }
      workgroupBarrier();
      sums[t] += add;
      workgroupBarrier();
    }
  }
  @compute @workgroup_size(256)
  fn sumBlocks(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) t: u32,
               @builtin(workgroup_id) group: vec3u) {
    let count = atomicLoad(&counts[id.x]);
    sums[t] = count;
    workgroupBarrier();
    runningSum(t);
    cells[id.x] = sums[t] - count;                    // (the start within the block, for now)
    if (t == 255u) { blocks[group.x] = sums[255]; }    // (the block's total)
  }
  // ... then over the blocks' totals ...
  @compute @workgroup_size(256)
  fn sumOverBlocks(@builtin(local_invocation_index) t: u32) {
    var total = 0u;
    if (t < BLOCKS) { total = blocks[t]; }
    sums[t] = total;
    workgroupBarrier();
    runningSum(t);
    if (t < BLOCKS) { blocks[t] = sums[t] - total; }   // (where each block starts)
  }
  // ... and together: each cell's start and count, and its first free place.
  @compute @workgroup_size(256)
  fn startLists(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) group: vec3u) {
    let start = cells[id.x] + blocks[group.x];
    let count = atomicLoad(&counts[id.x]);
    let first = min(start, LIST_ROOM);
    cells[id.x] = first * 4096u + min(min(count, 4095u), LIST_ROOM - first);
    atomicStore(&counts[id.x], start);
  }

  // 3. Write each ball's number into the lists of the cells it can shade.
  @compute @workgroup_size(64)
  fn fillLists(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) t: u32) {
    var s: Shadow;
    if (group.x >= frame.ballCount || !shadowOf(group.x, &s)) { return; }
    let width = s.x1 - s.x0 + 1;
    let all = width * (s.z1 - s.z0 + 1);
    for (var k = i32(t); k < all; k += 64) {
      let x = s.x0 + k % width;
      let z = s.z0 + k / width;
      if (reaches(s, x, z)) {
        let place = atomicAdd(&counts[z * GRID + x], 1u);
        if (place < LIST_ROOM) { lists[place] = ballData[group.x * 6u]; }
      }
    }
  }

  // 4. Each cell's list in order, nearest the lamp first (how near a ball
  // comes, ahead), so a pixel can stop at the first ball wholly beyond it:
  // see shadowAt. One cell each; Shell's sort, in place.
  fn nearness(v: vec4f) -> f32 { return dot(v.xyz - frame.lightPosition, frame.lightForward) - v.w; }
  @compute @workgroup_size(64)
  fn sortLists(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= ${CELLS}u) { return; }
    let entry = cells[id.x];
    let first = entry >> 12u;
    let n = entry & 4095u;
    if (n < 2u) { return; }
    var gaps = array<u32, 8>(701u, 301u, 132u, 57u, 23u, 10u, 4u, 1u);
    for (var g = 0; g < 8; g++) {
      let gap = gaps[g];
      if (gap >= n) { continue; }
      for (var i = gap; i < n; i++) {
        let v = lists[first + i];
        let near = nearness(v);
        var j = i;
        loop {
          if (j < gap) { break; }
          let w = lists[first + j - gap];
          if (nearness(w) <= near) { break; }
          lists[first + j] = w;
          j -= gap;
        }
        lists[first + j] = v;
      }
    }
  }
`;


// =============================================================================
// The Kefrens bars, worked out column by column into the picture (rather
// than by each pixel searching up through the rows above it, as kefrens()
// in shaders.js does, for WebGL): as the Amiga built them, each row is the
// row above with one more bar laid over it. Going down a column, one row
// after the other, what shows is kept: the colour of the bars so far, how
// much of the pixel they leave uncovered, and their shine; at each row the
// sky shows through what is left. One step per pixel. The same as kefrens()
// (which stops once less than 1 % of a pixel is left uncovered).
// =============================================================================
const KEFRENS_SHADER = /* wgsl */ `
  ${FRAME_STRUCT}
  @group(0) @binding(0) var<uniform> frame: Frame;
  @group(0) @binding(1) var<storage, read> kefrensRows: array<vec2f>;
  @group(0) @binding(2) var picture: texture_storage_2d<${FORMAT}, write>;

  // (Ball colour i, as the balls show it: see colors.js.)
  ${toWgsl(ELEMENTARY_COLOR_MATHS)}
  fn backdropColor(i: f32) -> vec3f { return elementaryColor(i, frame.wide); }
  fn sky(y: f32) -> vec3f { return mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y); }

  @compute @workgroup_size(64)
  fn kefrensColumns(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(picture);
    if (id.x >= size.x) { return; }
    let height = i32(size.y);
    let unit = 256.0 / frame.height;   // (as in kefrens())
    let x = (f32(id.x) + 0.5) * unit;
    let top = i32(ceil(24.0 / unit - 0.5));
    var color = vec3f(0.0);   // the bars' colour so far, front to back ...
    var left = 1.0;           // ... how much of the pixel they leave ...
    var glow = 0.0;           // ... and their shine
    for (var i = 0; i < height; i++) {
      if (i >= top) {
        let row = kefrensRows[i];
        let off = abs(x - row.x) - 8.0;
        if (off < 0.5 * unit) {
          // (This row's own bar, in front of those of the rows above.)
          let o = clamp((x - row.x) / 8.0, -1.0, 1.0);
          let shade = 1.0 - o * o;
          let band = floor((f32(i) + 0.5) * unit / 16.0);
          let bar = backdropColor(band - 4.0 * floor(band / 4.0));
          let lit = bar * (0.65 + 0.35 * shade) + vec3f(0.45) * pow(shade, 8.0);
          let cover = clamp(0.5 - off / unit, 0.0, 1.0);
          color = cover * lit + (1.0 - cover) * color;
          glow = max(pow(shade, 10.0), (1.0 - cover) * glow);
          left *= 1.0 - cover;
        }
      }
      let y = (frame.height - (f32(i) + 0.5)) / frame.height;   // (from the bottom, as kefrens()'s at.y)
      textureStore(picture, vec2i(i32(id.x), i), vec4f(color + left * sky(y), glow));
    }
  }
`;

// =============================================================================
// The ball table, built on the graphics card (see BALL_LIST in shaders.js and
// prepare in renderer.js, which builds the same on the main processor for
// WebGL): for each ball, from the physics' own numbers — middle, turn (a
// quaternion), radius, colour, squares — its row: middle and radius, colour
// and squares, the turn as three rows of a matrix (as Quat.toMat3 in
// math.js), and which ball is drawn in this place of the drawing order.
// =============================================================================
// (A switch's cases: colour → its numbers on a wide-colour screen.)
const caseList = (table) => [...table].map(([hex, c]) =>
  `        case 0x${hex.toString(16).padStart(6, '0')}u: { rgb = vec3f(${c.join(', ')}); }`).join('\n');
const TABLE_SHADER = /* wgsl */ `
  ${FRAME_STRUCT}
  @group(0) @binding(0) var<uniform> frame: Frame;
  @group(0) @binding(1) var<storage, read> numbers: array<f32>;
  @group(0) @binding(2) var<storage, read> order: array<u32>;
  @group(0) @binding(3) var<storage, read_write> table: array<vec4f>;

  @compute @workgroup_size(64)
  fn makeBallTable(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= frame.ballCount) { return; }
    let a = i * ${BALL_NUMBERS}u;
    let x = numbers[a + 3u]; let y = numbers[a + 4u]; let z = numbers[a + 5u]; let w = numbers[a + 6u];
    let color = u32(numbers[a + 8u]);
    let row = i * ${BALL_TABLE_COLUMNS}u;
    table[row] = vec4f(numbers[a], numbers[a + 1u], numbers[a + 2u], numbers[a + 7u]);
    var rgb = vec3f(f32((color >> 16u) & 255u), f32((color >> 8u) & 255u), f32(color & 255u)) / 255.0;
    // (On a wide-colour screen, the elementary colours as it shows them:
    // see colors.js.)
    if (frame.wide > 1.5) {
      switch color {
${caseList(ELEMENTARY_IN_2020)}
        default: {}
      }
    } else if (frame.wide > 0.5) {
      switch color {
${caseList(ELEMENTARY_IN_P3)}
        default: {}
      }
    }
    table[row + 1u] = vec4f(rgb, numbers[a + 9u]);
    table[row + 2u] = vec4f(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w), 0.0);
    table[row + 3u] = vec4f(2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w), 0.0);
    table[row + 4u] = vec4f(2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y), 0.0);
    table[row + 5u] = vec4f(f32(order[i]), 0.0, 0.0, 0.0);
  }
`;
