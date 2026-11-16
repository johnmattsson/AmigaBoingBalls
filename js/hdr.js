// =============================================================================
// hdr.js — showing the picture on an HDR screen (the HDR switch).
//
// The scene is drawn into an off-screen picture that can hold light brighter
// than white (see createLinearTarget in renderer.js). An ordinary canvas
// can't show that: whatever is drawn into it, white is as bright as it gets.
// So far only WebGPU can do better, in Chrome (and Edge) 129 and later: a
// WebGPU canvas of 16-bit floats with toneMapping "extended" may go above
// white, as far as the screen allows.
//
// The scene itself is still drawn with WebGL. Its last step packs the light
// into the WebGL canvas's 8 bits (see PRESENT_FRAGMENT_SHADER in shaders.js):
// 0 … 0.8 holds the usual screen colours up to white, 0.8 … 1 the light from
// white up to HDR_RANGE times white. This file copies that canvas into
// WebGPU every frame, unpacks it, and shows it on its own canvas, which lies
// under the page's (now invisible) canvas — the "view". That one stays on
// top, so clicks still reach it.
//
// For the main scene, the WebGL drawing then happens on an OffscreenCanvas
// that is never shown (see setHdr in main.js): if two canvases on the page
// both changed every frame, the browser could show them out of step, and
// the motion would stutter. (The Twist window simply uses its own canvas.)
//
// Switched on with HDR on the Look page. On a screen without HDR it looks
// as usual. What is brighter than white: see the top of renderer.js.
// =============================================================================

// The packing: light up to HDR_RANGE times white fits in the canvas's 8 bits,
// with SDR_SHARE of them for everything up to white (as in
// PRESENT_FRAGMENT_SHADER in shaders.js and the Twist's shaders).
export const HDR_RANGE = 8;   // (enough for the Strength setting at its highest)
const SDR_SHARE = 0.8;

// Make a presenter that shows its pictures in place of `view` (a canvas on
// the page), or explain why not. Returns { presenter } or { error }.
export async function createHdrPresenter(view, range, { onLost } = {}) {
  if (!navigator.gpu) return { error: 'this browser has no WebGPU' };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { error: 'WebGPU found no graphics card' };
  const device = await adapter.requestDevice();

  const canvas = document.createElement('canvas');
  canvas.className = 'scene-hdr';
  Object.assign(canvas.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    pointerEvents: 'none',
  });
  const context = canvas.getContext('webgpu');
  const presenter = new HdrPresenter(view, canvas, context, device, range);
  presenter.configure('srgb');
  // Did the browser accept "extended"? (Older ones ignore what they don't know.)
  const mode = context.getConfiguration?.()?.toneMapping?.mode;
  if (mode !== undefined && mode !== 'extended') {
    device.destroy();
    return { error: 'this browser can\'t show HDR in a canvas (try Chrome 129 or later)' };
  }
  view.before(canvas);
  view.style.opacity = '0';
  device.lost.then((info) => {
    if (!presenter.disposed) onLost?.(info.message);
  });
  return { presenter };
}

class HdrPresenter {
  constructor(view, canvas, context, device, range) {
    this.view = view;
    this.canvas = canvas;
    this.context = context;
    this.device = device;
    this.colorSpace = 'srgb';
    this.disposed = false;
    this.texture = null;   // the copy of the WebGL canvas, made in present()

    const module = device.createShaderModule({ code: unpackShader(range) });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  // Does the screen say it can show HDR? (If not, it looks as usual.)
  get screenIsHdr() {
    return matchMedia('(dynamic-range: high)').matches;
  }

  configure(colorSpace) {
    this.colorSpace = colorSpace;
    this.context.configure({
      device: this.device,
      format: 'rgba16float',
      colorSpace,
      toneMapping: { mode: 'extended' },
      alphaMode: 'opaque',
    });
  }

  // 'srgb' or 'display-p3' (the Wide colour setting).
  setColorSpace(space) {
    if (space !== this.colorSpace && !this.disposed) this.configure(space);
  }

  // Copy the WebGL canvas `source`, just drawn, and show it unpacked. (This
  // must run in the same task as the drawing: after that the browser may
  // clear it.) `view`: the page's canvas, for its look (big pixels).
  present(source, view = this.view) {
    if (this.disposed) return;
    const { width, height } = source;
    if (this.canvas.width !== width || this.canvas.height !== height || !this.texture) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.texture?.destroy();
      this.texture = this.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.texture.createView() }],
      });
    }
    if (this.canvas.style.imageRendering !== view.style.imageRendering) {
      this.canvas.style.imageRendering = view.style.imageRendering;   // big pixels stay crisp
    }

    const queue = this.device.queue;
    // From an OffscreenCanvas, the frame is handed over as an ImageBitmap
    // (the usual way to take a frame from one); from a canvas on the page
    // (the Twist window), it is copied directly.
    if (source.transferToImageBitmap) {
      const frame = source.transferToImageBitmap();
      queue.copyExternalImageToTexture({ source: frame }, { texture: this.texture }, [width, height]);
      frame.close();
    } else {
      queue.copyExternalImageToTexture({ source }, { texture: this.texture }, [width, height]);
    }
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    queue.submit([encoder.finish()]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.remove();
    this.view.style.opacity = '';
    this.texture?.destroy();
    this.device.destroy();
  }
}

// Unpack what PRESENT_FRAGMENT_SHADER packed. A WebGPU canvas of floats in
// the colour space "srgb" takes screen colours (not linear light), where 1
// is white and more is brighter: the usual sRGB curve, carried on above 1.
export function unpackShader(range) {
  const f = (x) => x.toFixed(6);
  return /* wgsl */ `
    @group(0) @binding(0) var packed: texture_2d<f32>;

    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let corner = vec2f(f32((i << 1u) & 2u), f32(i & 2u));   // (0,0) (2,0) (0,2)
      return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
    }

    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      let e = textureLoad(packed, vec2i(p.xy), 0).rgb;
      // Up to white: the screen colours, as they were.
      let usual = e / ${f(SDR_SHARE)};
      // Above white: linear light from 1 to the range, then the sRGB curve.
      let light = 1.0 + max(e - ${f(SDR_SHARE)}, vec3f(0.0)) / ${f(1 - SDR_SHARE)} * ${f(range - 1)};
      let bright = 1.055 * pow(light, vec3f(1.0 / 2.4)) - 0.055;
      // (Half a step above 0.8, so that white itself — 204 of 255 — stays white.)
      return vec4f(select(usual, bright, e > vec3f(${f(SDR_SHARE + 0.5 / 255)})), 1.0);
    }
  `;
}
