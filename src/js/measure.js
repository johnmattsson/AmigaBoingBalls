// =============================================================================
// measure.js — boing.measure(): where the time goes on a particular computer.
//
// Type  await boing.measure()  in the browser's console (with the demo's tab
// in front, and nothing else busy): it runs a row of scenes for a few
// seconds each, measures each, and prints a report to copy and pass on
// (also put on the clipboard, where the browser allows). It takes about a
// minute and a half; afterwards the scene and settings are as before.
// (boing.measure({ seconds: 10 }) measures longer; { only: ['gas'] } some.)
//
// With WebGPU, boing.measure({ parts: true }) also shows where the graphics
// card's time goes within the scene: the backdrop, the floor's shadows, the
// walls, the balls, the trails and the scroller. The whole scene is drawn in
// one pass (see draw in gpu-renderer.js), which the card can only time as
// a whole, so each part is measured by leaving it out for a moment
// (skipParts) and seeing how much less time the frame takes. (Only the
// scenes in PART_CASES, unless `only` names others; about four minutes.)
// =============================================================================

// The numbers being gathered right now (main.js adds to them in every
// frame), or null: measuring.on.
export const measuring = { on: null };

const MEASURE_CASES = [
  { name: 'Four balls', preset: 'four' },
  { name: 'Four, no shadows', preset: 'four', set: { shadows: false } },
  { name: 'Four, grid off', preset: 'four', set: { grid: false } },
  { name: 'Four, no grid/shadow', preset: 'four', set: { grid: false, shadows: false } },
  { name: 'Four, Copper', preset: 'four', set: { copper: true, backdrop: 'bars' } },
  { name: 'Four, Stars', preset: 'four', set: { copper: true, backdrop: 'stars' } },
  { name: 'Four, Plasma', preset: 'four', set: { copper: true, backdrop: 'plasma' } },
  { name: 'Four, Kefrens', preset: 'four', set: { copper: true, backdrop: 'kefrens' } },
  { name: 'Four, Twist', preset: 'four', set: { copper: true, backdrop: 'twist' } },
  { name: 'Four, Bobs', preset: 'four', set: { copper: true, backdrop: 'bobs' } },
  { name: 'Four, Tunnel', preset: 'four', set: { copper: true, backdrop: 'tunnel' } },
  { name: 'Four, trails 10 s', preset: 'four', set: { trails: 10 } },
  { name: 'Four, scroller', preset: 'four', set: { scroller: true } },
  { name: 'Four, pixel size 3', preset: 'four', set: { pixelSize: 3 } },
  { name: 'Classic 1984', preset: 'classic' },
  { name: 'Carousel', preset: 'carousel' },
  { name: 'Copper demo', preset: 'demo' },
  { name: 'Megademo (start)', preset: 'megademo' },
  { name: 'Gas (1000)', preset: 'gas' },
  { name: 'Rain (144)', preset: 'rain' },
  { name: 'Brownian (501)', preset: 'brownian' },
  { name: '4000 balls', preset: 'four', set: { balls: 4000, ballSize: 0.25 } },
];

// The scenes measured part by part (see { parts: true } above), and the
// parts, as gpu-renderer.js names them (see skipParts in draw).
const PART_CASES = ['Four balls', 'Four, Plasma', 'Four, Twist', 'Four, Tunnel', 'Four, trails 10 s', 'Four, scroller', 'Copper demo', '4000 balls'];
const PARTS = ['backdrop', 'floor', 'walls', 'balls', 'trails', 'scroller'];

// Makes the function, for the page it measures (see main.js):
//   settings, physics, canvas, applyPreset(name, keep), wideColourScreen(),
//   version; renderer() and screenRate() give what they are right now.
export function makeMeasure({ settings, physics, canvas, applyPreset, wideColourScreen, version, renderer, screenRate }) {
  async function measure({ seconds = 4, warmUp = 1.5, only = null, parts = false } = {}) {
    if (measuring.on) return 'Already measuring.';
    const wait = (s) => new Promise((done) => setTimeout(done, s * 1000));
    const saved = { ...settings }, results = [];
    // (Part by part only where the graphics card times itself: WebGPU.)
    const byParts = parts && renderer().isWebGpu && Boolean(renderer().gpuTimer);
    const cases = only ? MEASURE_CASES.filter((c) => only.some((o) => c.name.toLowerCase().includes(o) || c.preset === o))
      : byParts ? MEASURE_CASES.filter((c) => PART_CASES.includes(c.name)) : MEASURE_CASES;
    if (parts && !byParts) console.log('(Part by part only with WebGPU and its timer: measuring the scenes as a whole.)');
    console.log(`Measuring ${cases.length} scenes, ${seconds + warmUp} s each${byParts ? ', and then each part' : ''}: keep this tab in front…`);
    // The graphics card's time per frame over `s` seconds, all of it (only
    // for the part-by-part measuring). (First a moment for the change just
    // made to settle, as the card's times come back a few frames late; then
    // nothing from before counts: main.js adds the renderer's sums in once a
    // second and then empties them, see showCounts.)
    const cardTime = async (s) => {
      await wait(0.3);
      renderer().gpuParts = {};
      renderer().gpuTotalMs = 0;
      renderer().gpuFrames = 0;
      measuring.on = { gaps: [], late: 0, drawn: 0, drawMs: 0, gpuMs: 0, gpuFrames: 0, parts: {}, doneMs: 0, doneFrames: 0, physicsMs: 0, steps: 0, hits: 0, start: performance.now() };
      await wait(s);
      const m = measuring.on;
      measuring.on = null;
      m.gpuMs += renderer().gpuTotalMs; m.gpuFrames += renderer().gpuFrames;
      return m.gpuFrames ? m.gpuMs / m.gpuFrames : null;
    };
    for (const c of cases) {
      // (Pixel size is yours, kept by presets: so set for every scene, or the
      // pixel-size scene would go on into all after it.)
      applyPreset(c.preset, { speed: 1, pixelSize: 1, ...c.set });
      await wait(warmUp);
      renderer().gpuParts = {};
      measuring.on = { gaps: [], late: 0, drawn: 0, drawMs: 0, gpuMs: 0, gpuFrames: 0, parts: {}, doneMs: 0, doneFrames: 0, physicsMs: 0, steps: 0, hits: 0, start: performance.now() };
      await wait(seconds);
      const m = measuring.on;
      m.gpuMs += renderer().gpuTotalMs; m.gpuFrames += renderer().gpuFrames;   // (and what showCounts hasn't taken yet)
      for (const part in renderer().gpuParts ?? {}) m.parts[part] = (m.parts[part] ?? 0) + renderer().gpuParts[part];
      const perFrame = (part) => (m.gpuFrames && m.parts[part] !== undefined ? +(m.parts[part] / m.gpuFrames).toFixed(3) : null);
      measuring.on = null;
      const time = (performance.now() - m.start) / 1000;
      const gaps = m.gaps.slice().sort((a, b) => a - b), at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0;
      results.push({
        scene: c.name, balls: physics.balls.length,
        fps: +(m.drawn / time).toFixed(1),
        frameMs: { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(gaps[gaps.length - 1] ?? 0).toFixed(2) },
        dropped: m.late,
        gpuMs: m.gpuFrames ? +(m.gpuMs / m.gpuFrames).toFixed(3) : null,
        gpuParts: { backdrop: perFrame('backdrop'), shadows: perFrame('shadows'), scene: perFrame('scene'), copy: perFrame('copy') },
        direct: renderer().drewDirect ?? renderer().direct ?? null,   // (WebGPU: this frame; WebGL: see direct in renderer.js)
        gpuDoneMs: m.doneFrames ? +(m.doneMs / m.doneFrames).toFixed(2) : null,
        cpuDrawMs: m.drawn ? +(m.drawMs / m.drawn).toFixed(3) : null,
        physicsMs: m.steps ? +(m.physicsMs / m.steps).toFixed(3) : null,
        hitsPerSecond: Math.round(m.hits / time),
      });
      console.log(`  ${c.name}: ${results[results.length - 1].fps} fps`);
      // Part by part: the whole frame again, then without each part in turn
      // (one after another, so the card's speed, which drifts, is the same
      // for the two being compared). A part's cost: how much less time
      // without it. (Leaving the balls out also saves what their depth
      // saves the parts behind them, so their cost can come out a little
      // low; parts the scene doesn't have are left out.)
      if (byParts) {
        const has = { backdrop: Boolean(settings.copper), floor: Boolean(settings.shadows), walls: Boolean(settings.grid),
          balls: physics.balls.length > 0, trails: settings.trails > 0, scroller: Boolean(settings.scroller) };
        const costs = {};
        for (const part of PARTS.filter((p) => has[p])) {
          const all = await cardTime(seconds / 2);
          renderer().skipParts = new Set([part]);
          const without = await cardTime(seconds / 2);
          renderer().skipParts = null;
          costs[part] = all !== null && without !== null ? +(all - without).toFixed(3) : null;
        }
        const r = results[results.length - 1];
        r.partCosts = costs;
        const known = Object.values(costs).reduce((sum, v) => sum + (v ?? 0), 0);
        r.partRest = r.gpuMs !== null ? +(r.gpuMs - known).toFixed(3) : null;
        console.log(`    by parts: ${Object.entries(costs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      }
    }
    renderer().skipParts = null;
    applyPreset(saved.preset, saved);   // (everything back as it was)
    // Where it ran.
    let gpu = null;
    if (renderer().isWebGpu) {
      const info = renderer().adapterInfo;
      gpu = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : 'WebGPU (no adapter info)';
    } else if (renderer().gl) {
      const ext = renderer().gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? renderer().gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : renderer().gl.getParameter(renderer().gl.RENDERER);
    }
    const report = {
      demo: version, when: new Date().toISOString(),
      browser: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory ?? null,
      drawnWith: renderer().isWebGpu ? 'WebGPU' : 'WebGL', gpu,
      gpuTimer: renderer().gpuTimer ? 'yes' : 'no',
      screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio, refreshHz: screenRate(),
        wideColour: wideColourScreen(), hdrScreen: matchMedia('(dynamic-range: high)').matches },
      window: { width: innerWidth, height: innerHeight, drawnPixels: `${Math.round(canvas.clientWidth * renderer().pixelRatio)} × ${Math.round(canvas.clientHeight * renderer().pixelRatio)}` },
      settings: { hdr: settings.hdrStrength },
      measuredSeconds: seconds,
      results,
    };
    const pad = (v, n) => String(v ?? '–').padStart(n);
    const lines = [
      `Amiga Boing Balls ${version} — boing.measure()`,
      `${report.drawnWith}${results[0]?.direct ? ' (straight into the canvas)' : ''}, GPU: ${typeof gpu === 'object' && gpu ? Object.values(gpu).filter(Boolean).join(' / ') : gpu}, GPU timer: ${report.gpuTimer}`,
      `Screen ${screen.width}×${screen.height} @${devicePixelRatio}x, ${screenRate()} Hz; window ${innerWidth}×${innerHeight}, drawn ${report.window.drawnPixels}`,
      `${navigator.userAgent}`,
      '',
      `${'scene'.padEnd(20)}${pad('balls', 6)}${pad('fps', 7)}${pad('frame', 8)}${pad('p95', 7)}${pad('max', 7)}${pad('drop', 6)}${pad('gpu', 8)}${pad('back', 7)}${pad('shad', 7)}${pad('scene', 7)}${pad('copy', 7)}${pad('gpu≈', 7)}${pad('cpu', 7)}${pad('phys', 7)}`,
      ...results.map((r) => `${r.scene.padEnd(20)}${pad(r.balls, 6)}${pad(r.fps, 7)}${pad(r.frameMs.median, 8)}${pad(r.frameMs.p95, 7)}${pad(r.frameMs.max, 7)}${pad(r.dropped, 6)}${pad(r.gpuMs, 8)}${pad(r.gpuParts.backdrop, 7)}${pad(r.gpuParts.shadows, 7)}${pad(r.gpuParts.scene, 7)}${pad(r.gpuParts.copy, 7)}${pad(r.gpuDoneMs, 7)}${pad(r.cpuDrawMs, 7)}${pad(r.physicsMs, 7)}`),
      ...(byParts ? ['',
        'Where the graphics card\'s time goes (ms per frame; each part measured by leaving it out; rest = the shadow grid, clearing and what is shared):',
        `${'scene'.padEnd(20)}${PARTS.map((p) => pad(p, 10)).join('')}${pad('rest', 8)}`,
        ...results.map((r) => `${r.scene.padEnd(20)}${PARTS.map((p) => pad(r.partCosts?.[p], 10)).join('')}${pad(r.partRest, 8)}`)] : []),
      '',
      '(ms per frame: frame = time between frames (median, 95th percentile, max); gpu = graphics card time measured by the card,',
      ' and its parts: back = an effect or the Kefrens bars as the backdrop (in a pass of its own; – = none or drawn in the scene), shad = ball table and shadow grid,',
      ' scene = the scene, copy = the last step to the canvas (– = drawn straight in);',
      ' gpu≈ = time until the card was done, without its timer (WebGPU; WebGL: one frame in 20); cpu = drawing on the main processor; phys = per physics step)',
      '',
      JSON.stringify(report),
    ];
    const text = lines.join('\n');
    console.log(text);
    try { await navigator.clipboard.writeText(text); console.log('(Also copied to the clipboard.)'); } catch { /* (not allowed from here: copy it from the console) */ }
    return report;
  }
  return measure;
}
