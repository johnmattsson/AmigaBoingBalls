// =============================================================================
// gpu-renderer.js — the scene drawn with WebGPU, for HDR screens.
//
// With the HDR slider above 0, the scene is drawn by this renderer instead of
// the WebGL one (renderer.js). WebGPU can draw straight into a canvas of
// 16-bit floating-point numbers that may go brighter than white
// (toneMapping "extended", Chrome and Edge 129 and later), so the picture
// goes directly to the screen. (Before, WebGL drew it, packed the light
// above white into 8 bits, and WebGPU copied, unpacked and showed it every
// frame: that hand-over cost time, and on a fast screen frames.)
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
// The WebGL renderer stays for everything else: HDR off, and browsers
// without WebGPU (Safari, Firefox) — and should this one fail, HDR falls
// back to the old way (see setHdr in main.js).
// =============================================================================

import { HDR_RANGE } from './hdr.js';
import { BOX_HALF_SIZE } from './physics.js';
import {
  SceneRenderer, BACKGROUND, GRID_COLOR, GRID_OPACITY, GRID_SHADE, SHADOW_STRENGTH,
  BALL_TABLE_COLUMNS, TRAIL_PIECE_NUMBERS, srgbToLinear,
} from './renderer.js';
import { MAX_BALLS, SHADOW_GRID, SHADOW_LIST_WIDTH } from './shaders.js';

const FORMAT = 'rgba16float';            // the canvas and the off-screen picture: light as 16-bit floats
const DEPTH_FORMAT = 'depth24plus';
const FRONT_DEPTH_FORMAT = 'depth32float';
const FRAME_FLOATS = 68;                 // the Frame uniform below, in numbers
const WALL_STRIDE = 256;                 // bytes between the walls' uniforms (WebGPU's alignment)

export class GpuRenderer extends SceneRenderer {
  // Make one, showing its pictures in place of `view` (the page's canvas),
  // or explain why not. Returns { renderer } or { error }.
  // onLost: called if the graphics card is lost (then the caller switches back).
  static async create(view, { onLost } = {}) {
    if (!navigator.gpu) return { error: 'this browser has no WebGPU' };
    let device;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { error: 'WebGPU found no graphics card' };
      device = await adapter.requestDevice();
      const canvas = document.createElement('canvas');
      canvas.className = 'scene-hdr';
      Object.assign(canvas.style, {
        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
        pointerEvents: 'none',
      });
      const renderer = new GpuRenderer(view, canvas, device);
      // (The pipelines are made in the background, so the page keeps going.)
      await renderer.makePipelines();
      renderer.configure();
      // Did the browser accept "extended"? (Older ones ignore what they don't know.)
      const mode = renderer.context.getConfiguration?.()?.toneMapping?.mode;
      if (mode !== undefined && mode !== 'extended') {
        device.destroy();
        return { error: 'this browser can\'t show HDR in a canvas (try Chrome 129 or later)' };
      }
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
    this.colorSpace = null;   // the canvas's, once configured
    // Marks this renderer as showing HDR (main.js asks renderer.hdr).
    this.hdr = {
      get screenIsHdr() { return matchMedia('(dynamic-range: high)').matches; },
    };

    const buffer = (size, usage) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
    this.frameData = new Float32Array(FRAME_FLOATS);
    this.frameWords = new Uint32Array(this.frameData.buffer);
    this.frameBuffer = buffer(FRAME_FLOATS * 4, GPUBufferUsage.UNIFORM);
    this.wallData = new Float32Array(6 * WALL_STRIDE / 4);
    this.wallBuffer = buffer(6 * WALL_STRIDE, GPUBufferUsage.UNIFORM);
    this.ballBuffer = buffer(MAX_BALLS * BALL_TABLE_COLUMNS * 16, GPUBufferUsage.STORAGE);
    this.cellBuffer = buffer(SHADOW_GRID * SHADOW_GRID * 4, GPUBufferUsage.STORAGE);
    this.listBuffer = null;    // made by shadowListGrown()
    this.trailBuffer = null;   // made by trailRoomGrown()
    this.trailRoomGrown();

    this.layouts = makeLayouts(device);
    this.makeShadowListRoom(64 * SHADOW_LIST_WIDTH);   // (also makes the shared bind group)
    this.wallGroup = device.createBindGroup({
      layout: this.layouts.wall,
      entries: [{ binding: 0, resource: { buffer: this.wallBuffer, size: 80 } }],
    });

    // The scroller's picture, for its glowing letters (made the right size
    // when first shown).
    this.textVersion = null;
    this.textTexture = null;
    this.makeTextTexture(1, 1);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.target = null;   // the off-screen pictures, made in resize()
  }

  async makePipelines() {
    const device = this.device, L = this.layouts;
    const module = device.createShaderModule({ code: SHADER });
    const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                    alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' } };
    const make = (layout, vertex, fragment, { blended = true, depthWrite = false, depthTest = true,
      color = true, depthFormat = DEPTH_FORMAT, strip = true, buffers = [] } = {}) =>
      device.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: vertex, buffers },
        fragment: { module, entryPoint: fragment, targets: color ? [{ format: FORMAT, blend: blended ? blend : undefined }] : [] },
        primitive: { topology: strip ? 'triangle-strip' : 'triangle-list' },
        depthStencil: depthFormat ? {
          format: depthFormat, depthWriteEnabled: depthWrite, depthCompare: depthTest ? 'less' : 'always',
        } : undefined,
      });
    const trailBuffers = [{
      arrayStride: TRAIL_PIECE_NUMBERS * 4, stepMode: 'instance',
      attributes: [
        { shaderLocation: 1, offset: 0, format: 'float32x3' },
        { shaderLocation: 2, offset: 12, format: 'float32x3' },
        { shaderLocation: 3, offset: 24, format: 'float32x3' },
        { shaderLocation: 4, offset: 36, format: 'float32x2' },
      ],
    }];
    [this.ballDepthPipeline, this.copperPipeline, this.floorPipeline, this.wallPipeline,
      this.ballPipeline, this.trailPipeline, this.presentPipeline] = await Promise.all([
      make(L.front, 'ballVs', 'ballDepthFs', { color: false, depthWrite: true, depthFormat: FRONT_DEPTH_FORMAT }),
      make(L.scene, 'fullVs', 'copperFs', { blended: false, depthTest: false, strip: false }),
      make(L.scene, 'floorVs', 'floorFs'),
      make(L.scene, 'wallVs', 'wallFs'),
      make(L.scene, 'ballVs', 'ballFs', { depthWrite: true }),
      make(L.scene, 'trailVs', 'trailFs', { buffers: trailBuffers }),
      make(L.present, 'fullVs', 'presentFs', { blended: false, depthFormat: null, strip: false }),
    ]);
  }

  configure() {
    const space = this.wideColor ? 'display-p3' : 'srgb';
    if (space === this.colorSpace || this.disposed) return;
    this.colorSpace = space;
    this.context.configure({
      device: this.device,
      format: FORMAT,
      colorSpace: space,
      toneMapping: { mode: 'extended' },
      alphaMode: 'opaque',
    });
  }

  applyColorSpace() { this.configure(); }

  // Ready at once: the pipelines were made before it was handed over.
  async whenReady() {}

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
    this.frontGroup = this.device.createBindGroup({
      layout: this.layouts.frontDepth,
      entries: [{ binding: 0, resource: this.target.frontDepthView }],
    });
    this.makePresentGroup();
  }

  makePresentGroup() {
    if (!this.target) return;
    this.presentGroup = this.device.createBindGroup({
      layout: this.layouts.presentInputs,
      entries: [
        { binding: 1, resource: this.target.sceneView },
        { binding: 2, resource: this.textTexture.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  makeTextTexture(width, height) {
    this.textTexture?.destroy();
    this.textTexture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.makePresentGroup();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
    f.set([eye.x, eye.y, eye.z], 16); this.frameWords[19] = count;
    f.set([frame.light.x, frame.light.y, frame.light.z, frame.shadowRange], 20);
    f.set([frame.forward.x, frame.forward.y, frame.forward.z, SHADOW_STRENGTH], 24);
    f.set([frame.side.x, frame.side.y, frame.side.z, frame.edgeWidth], 28);
    f.set([frame.up.x, frame.up.y, frame.up.z, frame.shadowOpacity], 32);
    f.set([...frame.shadowColor, frame.glint], 36);
    f.set([frame.floorY, frame.floorHalfSize, BOX_HALF_SIZE, frame.lineWidth], 40);
    f.set(frame.wallShown, 44);
    f.set([...(options.copper ? GRID_COLOR : GRID_SHADE), options.copper ? GRID_OPACITY : 1], 48);
    f.set([width, height, frame.trailWidth, options.backdropTime ?? 0], 52);
    f.set([height, frame.shine, frame.colorLevels, frame.textGlow], 56);
    const textRect = this.textRect(options.text, width, height);
    f.set(textRect ?? [0, 0, 0, 0], 60);
    f.set([HDR_RANGE, 0, 0, 0], 64);
    queue.writeBuffer(this.frameBuffer, 0, f);

    const w = this.wallData;
    frame.walls.forEach(({ wall, extend, drawEdge, catchesShadows }, index) => {
      const at = index * WALL_STRIDE / 4;
      w.set(extend, at);
      w.set(drawEdge, at + 4);
      w.set([wall.center.x, wall.center.y, wall.center.z, catchesShadows ? 1 : 0], at + 8);
      w.set([wall.axisU.x, wall.axisU.y, wall.axisU.z, 0], at + 12);
      w.set([wall.axisV.x, wall.axisV.y, wall.axisV.z, 0], at + 16);
    });
    queue.writeBuffer(this.wallBuffer, 0, w);

    if (count > 0) queue.writeBuffer(this.ballBuffer, 0, this.ballTable, 0, count * BALL_TABLE_COLUMNS * 4);
    queue.writeBuffer(this.cellBuffer, 0, this.shadowCells);
    const rows = Math.ceil(frame.listed / SHADOW_LIST_WIDTH);
    if (rows > 0) queue.writeBuffer(this.listBuffer, 0, this.shadowList, 0, rows * SHADOW_LIST_WIDTH);

    let pieces = 0;
    if (options.trailSeconds > 0) {
      pieces = this.fillTrails(balls, count, options.trailTime ?? 0, options.trailSeconds);
      if (pieces > 0) queue.writeBuffer(this.trailBuffer, 0, this.trailPieces, 0, pieces * TRAIL_PIECE_NUMBERS);
    }

    // The glowing letters: only a new picture is sent.
    if (textRect) {
      const text = options.text;
      if (options.textVersion !== this.textVersion) {
        this.textVersion = options.textVersion;
        if (this.textTexture.width !== text.width || this.textTexture.height !== text.height) {
          this.makeTextTexture(text.width, text.height);
        }
        queue.copyExternalImageToTexture({ source: text }, { texture: this.textTexture }, [text.width, text.height]);
      }
    } else {
      this.textVersion = null;   // (shown again later: send it afresh)
    }

    const encoder = device.createCommandEncoder();

    // ---- Step 1: the cheap first pass: how far the nearest ball is.
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.target.frontDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      if (count > 0) {
        pass.setPipeline(this.ballDepthPipeline);
        pass.setBindGroup(0, this.sharedGroup);
        pass.draw(4, count);
      }
      pass.end();
    }

    // ---- Step 2: the scene, into the off-screen linear-light picture.
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.target.sceneView, loadOp: 'clear', storeOp: 'store',
          clearValue: [...BACKGROUND.map(srgbToLinear), 1],
        }],
        depthStencilAttachment: {
          view: this.target.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard',
        },
      });
      pass.setBindGroup(0, this.sharedGroup);
      pass.setBindGroup(1, this.frontGroup);
      pass.setBindGroup(2, this.wallGroup, [0]);
      if (options.copper) {
        pass.setPipeline(this.copperPipeline);
        pass.draw(3);
      }
      if (frame.showShadows && eye.y > frame.floorY) {
        pass.setPipeline(this.floorPipeline);
        pass.draw(4);
      }
      if (frame.showGrid) {
        pass.setPipeline(this.wallPipeline);
        frame.walls.forEach((wall, index) => {
          if (!wall.shown) return;
          pass.setBindGroup(2, this.wallGroup, [index * WALL_STRIDE]);
          pass.draw(4);
        });
      }
      if (count > 0) {
        pass.setPipeline(this.ballPipeline);
        pass.draw(4, count);
      }
      if (pieces > 0) {
        pass.setPipeline(this.trailPipeline);
        pass.setVertexBuffer(0, this.trailBuffer);
        pass.draw(4, pieces);
      }
      pass.end();
    }

    // ---- Step 3: to the canvas, as screen colours (brighter than white
    // where the light is).
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: [0, 0, 0, 1],
        }],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.sharedGroup);
      pass.setBindGroup(1, this.presentGroup);
      pass.draw(3);
      pass.end();
    }
    queue.submit([encoder.finish()]);

    // The first picture is on its way: from now on this canvas shows the
    // scene, and the page's own canvas (under the pointer) is invisible.
    if (!this.shownOnce) {
      this.shownOnce = true;
      this.view.style.opacity = '0';
    }
  }

  // More room for the trails (see fillTrails in renderer.js).
  trailRoomGrown() {
    this.trailBuffer?.destroy();
    this.trailBuffer = this.device.createBuffer({
      size: this.trailPieces.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  // More room for the shadow lists (see makeShadowListRoom in renderer.js).
  // (Two 16-bit ball numbers per 32-bit number in the shader.)
  shadowListGrown(rows) {
    this.listBuffer?.destroy();
    this.listBuffer = this.device.createBuffer({
      size: rows * SHADOW_LIST_WIDTH * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (!this.layouts) return;   // (the first, from the constructor: made just below)
    this.sharedGroup = this.device.createBindGroup({
      layout: this.layouts.shared,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.ballBuffer } },
        { binding: 2, resource: { buffer: this.cellBuffer } },
        { binding: 3, resource: { buffer: this.listBuffer } },
      ],
    });
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

// The off-screen pictures: the scene in linear light, its depth, and the
// first pass's front depth (also read by the main pass).
function makeTarget(device, width, height) {
  const texture = (format, usage) => device.createTexture({ size: [width, height], format, usage });
  const A = GPUTextureUsage.RENDER_ATTACHMENT, T = GPUTextureUsage.TEXTURE_BINDING;
  const scene = texture(FORMAT, A | T);
  const depth = texture(DEPTH_FORMAT, A);
  const frontDepth = texture(FRONT_DEPTH_FORMAT, A | T);
  return {
    width, height,
    sceneView: scene.createView(),
    depthView: depth.createView(),
    frontDepthView: frontDepth.createView(),
    dispose() { scene.destroy(); depth.destroy(); frontDepth.destroy(); },
  };
}

// What the shaders are given, in four groups:
//   0 (shared): the frame's numbers, the ball table, the shadow grid and lists
//   1: the front depth (main pass) — or the scene and the letters (last step;
//      other binding numbers, so the shader can declare both)
//   2: the wall being drawn
function makeLayouts(device) {
  const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
  const shared = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: V | F, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: F, buffer: { type: 'read-only-storage' } },
  ] });
  const frontDepth = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, texture: { sampleType: 'depth' } },
  ] });
  const wall = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
  ] });
  const presentInputs = device.createBindGroupLayout({ entries: [
    { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: F, texture: { sampleType: 'float' } },
    { binding: 3, visibility: F, sampler: { type: 'filtering' } },
  ] });
  const pipelineLayout = (groups) => device.createPipelineLayout({ bindGroupLayouts: groups });
  return {
    shared, frontDepth, wall, presentInputs,
    front: pipelineLayout([shared]),
    scene: pipelineLayout([shared, frontDepth, wall]),
    present: pipelineLayout([shared, presentInputs]),
  };
}


// =============================================================================
// The shaders, in WGSL: shaders.js translated line by line (the comments
// there explain them).
// =============================================================================
const SHADER = /* wgsl */ `
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
    height: f32, shine: f32, colorLevels: f32, textGlow: f32,
    textRect: vec4f,
    hdrRange: f32,
  }
  struct Wall {
    extend: vec4f,
    drawEdge: vec4f,
    center: vec3f, catchShadows: f32,
    axisU: vec3f,
    axisV: vec3f,
  }

  @group(0) @binding(0) var<uniform> frame: Frame;
  @group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
  @group(0) @binding(2) var<storage, read> shadowCells: array<u32>;
  @group(0) @binding(3) var<storage, read> shadowList: array<u32>;
  @group(1) @binding(0) var frontDepth: texture_depth_2d;
  @group(1) @binding(1) var scene: texture_2d<f32>;
  @group(1) @binding(2) var textPicture: texture_2d<f32>;
  @group(1) @binding(3) var textSampler: sampler;
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
  fn toLinear(c: vec3f) -> vec3f {
    return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));
  }
  fn toScreen(c: vec3f) -> vec3f {
    return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308));
  }
  fn shade(color: vec3f, shadow: f32) -> vec3f {
    return mix(toLinear(color), toLinear(color * (1.0 - frame.shadowStrength)), shadow);
  }

  // ---- Edges ----
  fn smoothEdge(pixelsInside: f32) -> f32 {
    return clamp(pixelsInside / frame.edgeWidth + 0.5, 0.0, 1.0);
  }

  // ---- Skipping hidden pixels ----
  fn hiddenBehindBall(at: vec4f, depth: f32) -> bool {
    let front = textureLoad(frontDepth, vec2i(at.xy), 0);
    return depth > front + 1e-5;
  }

  // ---- Shadows ----
  fn shadowAt(p: vec3f, stepX: vec3f, stepY: vec3f, skipBall: i32) -> f32 {
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
    for (var k = 0u; k < listed; k++) {
      let entry = first + k;
      let i = i32((shadowList[entry >> 1u] >> ((entry & 1u) * 16u)) & 65535u);
      if (i == skipBall) { continue; }

      let toBall = ballSphere(i).xyz - p;
      let radius = ballSphere(i).w;
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

  @fragment fn floorFs(s: Surface) -> @location(0) vec4f {
    let stepX = dpdxFine(s.world);
    let stepY = dpdyFine(s.world);
    if (hiddenBehindBall(s.at, s.at.z)) { discard; }
    let h = frame.halfSize;
    let shown = frame.wallShown;
    if ((s.world.x < -h && shown.x > 0.5) || (s.world.x > h && shown.y > 0.5) ||
        (s.world.z < -h && shown.z > 0.5) || (s.world.z > h && shown.w > 0.5)) { discard; }
    let shadow = shadowAt(s.world, stepX, stepY, -1);
    if (shadow <= 0.0) { discard; }
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

  fn lineCoverage(pixelsAway: f32) -> f32 { return smoothEdge(0.5 * frame.lineWidth - pixelsAway); }

  const EDGE_UNITS = 0.05;
  @fragment fn wallFs(s: WallPoint) -> @location(0) vec4f {
    let h = frame.halfSize;
    let unitsPerPixel = fwidthFine(s.grid);
    let nearestLine = floor(s.grid + 0.5);
    let toLine = abs((s.grid - nearestLine) / unitsPerPixel + 0.03);

    let pastEdge = (abs(s.grid) - h) / min(unitsPerPixel, vec2f(EDGE_UNITS));
    let packedLines = frame.lineWidth * unitsPerPixel;
    let fade = 1.0 - smoothstep(vec2f(0.25), vec2f(0.6), packedLines);
    let inner = select(vec2f(1.0), vec2f(0.0), abs(nearestLine) >= vec2f(h));
    let ends = vec2f(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
    let innerAlongY = lineCoverage(toLine.x) * inner.x * fade.x * ends.x;
    let innerAlongX = lineCoverage(toLine.y) * inner.y * fade.y * ends.y;
    let toEdge = abs(abs(s.grid) - h) / unitsPerPixel;
    let drawsEdge = vec2f(select(wall.drawEdge.y, wall.drawEdge.x, s.grid.x > 0.0),
                          select(wall.drawEdge.w, wall.drawEdge.z, s.grid.y > 0.0));
    let edgeAlongY = lineCoverage(toEdge.x) * drawsEdge.x * lineCoverage(pastEdge.x) * ends.x;
    let edgeAlongX = lineCoverage(toEdge.y) * drawsEdge.y * lineCoverage(pastEdge.y) * ends.y;
    let coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));

    let e = wall.extend;
    let pastCatch = vec4f(s.grid.x - h - e.x, -s.grid.x - h - e.y,
                          s.grid.y - h - e.z, -s.grid.y - h - e.w) / unitsPerPixel.xxyy;
    let inside = select(vec4f(0.0), vec4f(1.0), pastCatch <= vec4f(0.1));
    let onWall = wall.catchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));

    let stepX = dpdxFine(s.world);
    let stepY = dpdyFine(s.world);
    if ((coverage <= 0.0 && onWall <= 0.0) || hiddenBehindBall(s.at, s.at.z)) { discard; }

    let shadow = shadowAt(s.world, stepX, stepY, -1);
    let lineLayer = coverage * frame.lineOpacity;
    let shadowLayer = onWall * shadow * frame.shadowOpacity * (1.0 - lineLayer);
    let opacity = lineLayer + shadowLayer;
    if (opacity <= 0.0) { discard; }
    let color = (shade(frame.gridColor, shadow) * lineLayer + frame.shadowColor * shadowLayer) / opacity;
    return vec4f(color, opacity);
  }

  // ---- 3. Balls ----
  struct BallPoint {
    @builtin(position) at: vec4f,
    @location(0) world: vec3f,
    @location(1) @interpolate(flat) ball: i32,
  }

  @vertex fn ballVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> BallPoint {
    let i = ballDrawnAs(i32(k));
    var o: BallPoint;
    o.ball = i;
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
    let halfSize = radius * distance / sqrt(distance * distance - radius * radius) * 1.1;
    let corner = squareCorner(v);
    o.world = center + (right * corner.x + up * corner.y) * halfSize;
    o.at = frame.viewProjection * vec4f(o.world, 1.0);
    return o;
  }

  fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
  fn squareWave(x: f32, blur0: f32) -> f32 {
    let blur = max(blur0, 1e-4);
    return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
  }

  struct BallColor { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }

  @fragment fn ballFs(s: BallPoint) -> BallColor {
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
    let clip = frame.viewProjection * vec4f(surface, 1.0);
    let depth = clip.z / clip.w;

    let squaresDown = ballColor(s.ball).a;
    let squaresAround = 2.0 * squaresDown;
    let n = transpose(ballRotation(s.ball)) * normal;
    let around = atan2(n.z, n.x) / (2.0 * PI) + 0.5;
    let down = acos(clamp(n.y, -1.0, 1.0)) / PI;
    let square = vec2f(around * squaresAround, down * squaresDown);
    var blur = fwidthFine(square);
    blur.x = min(blur.x, fwidthFine(fract(around + 0.5) * squaresAround));
    blur *= frame.edgeWidth;
    let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);

    let stepX = dpdxFine(surface);
    let stepY = dpdyFine(surface);
    if (coverage <= 0.0 || hiddenBehindBall(s.at, depth)) { discard; }

    let shadow = shadowAt(surface, stepX, stepY, s.ball);
    var color = mix(shade(vec3f(1.0), shadow), shade(ballColor(s.ball).rgb, shadow), checker);
    if (frame.glint > 0.0) {
      let toLamp = normalize(frame.lightPosition - surface);
      let halfway = normalize(toLamp - rayDir);
      color += vec3f(frame.glint * pow(max(dot(normal, halfway), 0.0), 120.0) * (1.0 - shadow));
    }
    var o: BallColor;
    o.color = vec4f(color, coverage);
    o.depth = depth;
    return o;
  }

  @fragment fn ballDepthFs(s: BallPoint) -> @builtin(frag_depth) f32 {
    let center = ballSphere(s.ball).xyz;
    let radius = ballSphere(s.ball).w;
    let rayDir = normalize(s.world - frame.cameraPosition);
    let toCenter = center - frame.cameraPosition;
    let along = dot(toCenter, rayDir);
    let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
    let pixelsInside = (radius - missDist) / max(fwidthFine(missDist), 1e-6);
    if (pixelsInside < 0.5 * frame.edgeWidth + 0.1) { discard; }
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

  @vertex fn trailVs(@builtin(vertex_index) v: u32, @location(1) startAt: vec3f, @location(2) endAt: vec3f,
                     @location(3) color: vec3f, @location(4) fades: vec2f) -> TrailPoint {
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
    return vec4f(toLinear(s.color), coverage * s.fade);
  }

  // ---- 0. Copper bars ----
  var<private> shine: f32 = 0.0;
  const LINES = 256.0;
  const LEVELS = 15.0;

  fn addBar(color: vec3f, y: f32, center: f32, barColor: vec3f) -> vec3f {
    let d = abs(y - center) / 0.055;
    if (d >= 1.0) { return color; }
    let glow = 1.0 - d * d;
    let highlight = pow(glow, 6.0);
    shine = max(shine, highlight);
    return barColor * glow + vec3f(0.6) * highlight;
  }

  @fragment fn copperFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    // (Counted from the bottom, as in WebGL.)
    let y = (floor((frame.height - at.y) / frame.height * LINES) + 0.5) / LINES;
    let t = frame.time;
    var color = mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y);
    color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9),       vec3f(0.769, 0.008, 0.200));
    color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 0.7), vec3f(0.000, 0.624, 0.420));
    color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 1.4), vec3f(0.000, 0.529, 0.741));
    color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 2.1), vec3f(1.000, 0.827, 0.000));
    color = floor(min(color, vec3f(1.0)) * LEVELS + 0.5) / LEVELS;
    let boost = 1.0 + frame.shine * floor(shine * LEVELS + 0.5) / LEVELS;
    return vec4f(toLinear(color) * boost, 1.0);
  }

  // ---- 4. To the canvas ----
  // A WebGPU canvas of floats in the colour space "srgb" takes screen
  // colours, where 1 is white and more is brighter: the usual sRGB curve,
  // carried on above 1 (up to HDR_RANGE times white).
  @fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    var linear = max(textureLoad(scene, vec2i(at.xy), 0).rgb, vec3f(0.0));
    if (frame.textRect.z > 0.0) {
      let fromBottom = vec2f(at.x, frame.height - at.y);
      let t = (fromBottom - frame.textRect.xy) / frame.textRect.zw;
      if (all(t >= vec2f(0.0)) && all(t < vec2f(1.0))) {
        let letter = textureSampleLevel(textPicture, textSampler, vec2f(t.x, 1.0 - t.y), 0.0);
        linear = mix(linear, toLinear(letter.rgb) * (1.0 + frame.textGlow), letter.a);
      }
    }
    var color = toScreen(min(linear, vec3f(1.0)));
    if (frame.colorLevels > 0.0) { color = floor(color * frame.colorLevels + 0.5) / frame.colorLevels; }
    let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
    color = select(color, bright, linear > vec3f(1.0));
    return vec4f(color, 1.0);
  }
`;
