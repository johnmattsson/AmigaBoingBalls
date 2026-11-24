// =============================================================================
// drawing.js — who draws: WebGPU where the browser has it, else WebGL; changing between them when WebGPU stops, and HDR switched on and off.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { GpuRenderer } from './gpu-renderer.js';
import { Renderer } from './renderer.js';
import { twistOptions } from './twist.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'drawing';
export const needs = [
  'canvas', 'halt', 'hdrChanged', 'hdrOn', 'hdrSlider', 'loadingScreen', 'needsRedraw',
  'renderer', 'screenRenderer', 'settings', 'showGuru', 'showHdrControl', 'webGlRenderer',
];
export const gives = [
  'drawWith', 'noHdrWithoutWebGpu', 'setHdr', 'showTextGlow', 'startWebGpu', 'useRenderer',
];

export function setup(page) {

  // Who draws. Where the browser has WebGPU, a WebGPU renderer (see
  // gpu-renderer.js): it draws on a canvas of its own, under the page's
  // canvas, which stays as it was, invisible, and still takes the clicks.
  // Should WebGPU fail or stop, a WebGL renderer draws on the page's canvas
  // (see webGlRenderer). (boing.drawWith('webgl') or ('webgpu') switches, to
  // compare.)
  //
  // HDR screens (the HDR slider on the Look page): only with WebGPU, which
  // draws straight onto its canvas, brighter than white. (With WebGL there is
  // no HDR: an older way, WebGL drawing and WebGPU showing each picture, was
  // slower and hid it when WebGPU didn't work.)
  let preferWebGl = false;    // (boing.drawWith('webgl'))
  let webGpuTries = 0;        // WebGPU stopped this many times: after a few, WebGL stays
  const MAX_WEBGPU_TRIES = 3;
  // (HDR starts on where the screen shows it: without WebGPU it quietly goes off.)
  const noHdrWithoutWebGpu = () => {
    if (page.renderer.isWebGpu || page.settings.hdrStrength === 0) return;
    page.settings.hdrStrength = 0;
    page.hdrSlider?.refresh();
  };
  async function startWebGpu() {
    if (!navigator.gpu || preferWebGl || page.renderer.isWebGpu || webGpuTries >= MAX_WEBGPU_TRIES) { noHdrWithoutWebGpu(); return; }
    const { renderer: gpuRenderer, error } = await GpuRenderer.create(page.canvas, { onLost: webGpuLost });
    if (!gpuRenderer) {
      console.warn('Drawing with WebGL: ' + error);
      if (!page.renderer.isWebGpu && page.renderer !== page.screenRenderer) fallBackToWebGl();
      noHdrWithoutWebGpu();
      return;
    }
    if (preferWebGl || page.renderer.isWebGpu) { gpuRenderer.dispose(); return; }   // (changed meanwhile)
    // (HDR, if the slider was moved meanwhile.)
    const hdr = page.settings.hdrStrength > 0 && gpuRenderer.setHdr(true);
    useRenderer(gpuRenderer);
    if (!hdr && page.settings.hdrStrength > 0) { page.settings.hdrStrength = 0; page.hdrSlider?.refresh(); }
    page.hdrChanged();
  }
  // Draw with WebGL instead. When the graphics card has just stopped (its
  // driver restarting, after sleep or an update), WebGL can't be had for a
  // moment either: then it is tried again every second, for a while, before
  // the demo gives up with the Guru Meditation. Returns whether WebGL draws.
  const WEBGL_TRIES = 10;
  let webGlTries = 0;
  function fallBackToWebGl() {
    const gl = page.webGlRenderer(webGlTries < WEBGL_TRIES);   // (the last try is not quiet: the Guru)
    if (!gl) {
      webGlTries++;
      console.warn('WebGL not available yet: trying again');
      setTimeout(() => { if (page.renderer !== page.screenRenderer && !page.renderer.isWebGpu && fallBackToWebGl()) page.hdrChanged(); }, 1000);
      return false;
    }
    webGlTries = 0;
    useRenderer(gl);
    return true;
  }

  function webGpuLost(why) {
    // Once the balls have been shown, WebGPU stopping ends the demo, as a
    // crash on the Amiga did: the Guru Meditation, and nothing more. (Only
    // behind the loading screen does WebGL quietly take over instead.)
    if (!page.loadingScreen) {
      console.warn('WebGPU stopped (' + why + ')');
      page.halt();
      page.showGuru(['Software Failure.   WebGPU stopped.   Reload the page to continue.', 'Guru Meditation #80000022.0000AAC0'], false);
      return;
    }
    webGpuTries++;
    const hadHdr = page.hdrOn();
    if (!fallBackToWebGl()) return;
    if (hadHdr) {   // (HDR needs WebGPU: off)
      page.settings.hdrStrength = 0;
      page.hdrSlider?.refresh();
    }
    page.hdrChanged();
    console.warn('WebGPU stopped (' + why + '): drawing with WebGL');
    // (A graphics driver restart, say: try again in a moment.)
    setTimeout(startWebGpu, 2000);
  }
  async function drawWith(which) {
    preferWebGl = which === 'webgl';
    if (preferWebGl && page.renderer.isWebGpu) {
      useRenderer(page.webGlRenderer());
      page.settings.hdrStrength = 0;
      page.hdrSlider?.refresh();
      page.hdrChanged();
    }
    if (!preferWebGl) { webGpuTries = 0; await startWebGpu(); }
    return page.renderer.isWebGpu ? 'WebGPU' : 'WebGL';
  }

  // The browser can take the graphics card away from the page ("context
  // lost"): when the graphics driver restarts, or when there are too many 3D
  // pictures at once — which Safari can do on a quick reload, before the old
  // page has given its own back. Everything drawn is then gone. Asking for
  // it back (preventDefault), the page's renderer is made anew when it comes.
  page.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  page.canvas.addEventListener('webglcontextrestored', () => {
    if (!page.screenRenderer) return;
    // (The old renderer is simply dropped: its context is the very one that
    // came back, so it must not be "disposed".)
    const fresh = new Renderer(page.canvas);
    fresh.pixelSize = page.screenRenderer.pixelSize;
    fresh.wideColor = page.screenRenderer.wideColor;
    fresh.applyColorSpace();
    if (page.renderer === page.screenRenderer) page.renderer = fresh;   // (with HDR on, it waits until HDR goes off)
    page.screenRenderer = fresh;
    page.renderer.resize();
    page.needsRedraw = true;
  });
  function useRenderer(next) {
    next.pixelSize = page.renderer.pixelSize;
    next.wideColor = page.renderer.wideColor;
    if (page.renderer !== page.screenRenderer) page.renderer.dispose();
    page.renderer = next;
    page.renderer.applyColorSpace();
    page.renderer.resize();
    showTextGlow();
    page.showHdrControl();
    twistOptions.device = page.renderer.isWebGpu ? page.renderer.device : null;   // (the Twist window draws with it too, when opened)
  }
  async function setHdr(on) {
    twistOptions.hdr = on;
    // Drawn with WebGPU: it simply switches.
    if (page.renderer.isWebGpu) {
      if (page.renderer.setHdr(on)) { page.needsRedraw = true; return on ? screenIsHdrMessage(page.renderer.hdr) : 'HDR off'; }
      twistOptions.hdr = false;
      return 'HDR not possible: this browser can\'t show HDR in a canvas (try Chrome 129 or later).';
    }
    // Drawn with WebGL: no HDR.
    twistOptions.hdr = false;
    if (!on) return 'HDR off';
    return 'HDR needs WebGPU, which isn\'t working in this browser right now (the browser\'s console says why).';
  }
  function screenIsHdrMessage(hdr) {
    return hdr.screenIsHdr
      ? 'HDR on'
      : 'HDR on, but this screen says it shows no HDR (on a Mac or in Windows, HDR may need switching on)';
  }

  // (The scroller is drawn by the renderer, over the scene: a new picture is
  // needed when it is switched on or off, or the renderer changes.)
  function showTextGlow() {
    page.needsRedraw = true;
  }
  // (For the rest of the page.)
  Object.assign(page, { drawWith, noHdrWithoutWebGpu, setHdr, showTextGlow, startWebGpu, useRenderer });
}
