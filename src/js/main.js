// =============================================================================
// main.js — starts everything and runs the animation loop.
//
//   physics.js  – moves and bounces the balls
//   renderer.js – draws them with WebGL2 (shaders in shaders.js)
//   camera.js   – lets you orbit / zoom with mouse or touch
//   audio.js    – plays the boing sounds
//   music.js    – plays the chiptunes
//   gui.js      – the settings panel and the windows
//   presets.js  – the ready-made scenes
//   scroller.js – the scrolling text
//   twist.js    – the Twist window (and the windows of effects.js)
//   effects.js  – more demo effects: vector bobs, tunnel
// =============================================================================

import { Physics, COLLISION_TYPES, BALL_RADIUS, boxRoom } from './physics.js';
import { EVENT_NUMBERS } from './physics-host.js';
import { Renderer } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { Sounds } from './audio.js';
import { Panel, showRequester, closeFrontWindow, addPresetBar } from './gui.js';
import { Vec3, raySphere } from './math.js';
import { openTwistWindow, twistOptions, effectGlow, createDrawer, createGpuDrawer } from './twist.js';
import { EFFECTS, effectDrawers } from './effects.js';
import { Music, TRACKS, MUSIC_LEAD } from './music.js';
import { Scroller } from './scroller.js';
import { PRESETS } from './presets.js';
import { PRESET_DEFAULTS, startSettings, PAGES, SETTINGS } from './settings.js';
import { toSaved, fromSaved, ownSettings } from './state.js';
import { ABOUT } from './about.js';
import { makeMeasure, measuring } from './measure.js';
import { Show } from './show.js';
import { fullScreenElement, canFullScreen, toggleFullScreen, startFullScreen, fadeIdleControls, keepScreenAwake } from './page.js';
import { PhysicsClient } from './physics-client.js';
import * as infoPart from './info.js';
import { app, start } from './app.js';
import * as roomPart from './room.js';
import * as hdrPart from './hdr.js';
import * as scenePart from './scene.js';
import * as drawingPart from './drawing.js';

// ---- What the parts may reach (see app.js) ---------------------------------------
// The things of this file that the parts in the other files use, by name:
// always the value of the moment (and those that change can be set).
Object.defineProperties(app, {
  ENERGY_UNIT: { get: () => ENERGY_UNIT },
  VCR_SYMBOLS: { get: () => VCR_SYMBOLS },
  camera: { get: () => camera },
  canvas: { get: () => canvas },
  controls: { get: () => controls },
  energyPerBall: { get: () => energyPerBall },
  fitVcrSymbols: { get: () => fitVcrSymbols },
  halt: { get: () => halt },
  loadingScreen: { get: () => loadingScreen, set: (value) => { loadingScreen = value; } },
  lookHooks: { get: () => lookHooks },
  needsRedraw: { get: () => needsRedraw, set: (value) => { needsRedraw = value; } },
  panel: { get: () => panel },
  physics: { get: () => physics },
  renderer: { get: () => renderer, set: (value) => { renderer = value; } },
  resize: { get: () => resize },
  restored: { get: () => restored },
  rewindCheck: { get: () => rewindCheck },
  scenePage: { get: () => scenePage },
  screenRenderer: { get: () => screenRenderer, set: (value) => { screenRenderer = value; } },
  settings: { get: () => settings },
  showBallCount: { get: () => showBallCount },
  showGuru: { get: () => showGuru },
  sizeMix: { get: () => sizeMix },
  totalWeight: { get: () => totalWeight },
  vcrSymbol: { get: () => vcrSymbol },
  webGlRenderer: { get: () => webGlRenderer },
});

// Running now: should the page have said meanwhile that it is still
// starting (index.html), the credit line comes back (before the scroller,
// which begins with it, reads it).
{
  const info = document.getElementById('info');
  if (info.dataset.credit) { info.innerHTML = info.dataset.credit; delete info.dataset.credit; }
}

// Values the settings panel can change: each is described in settings.js.
const settings = startSettings();

// Your own settings (loudness, Glints, HDR) and the Controls' page
// come back as they were left last time; the scene does not: the page
// always starts with Four balls. (See state.js. Where the browser keeps
// nothing, a private window say, the page simply starts afresh.)
const SAVED_AS = 'amiga-boing-balls';
const restored = (() => {
  let saved = null;
  try { saved = fromSaved(localStorage.getItem(SAVED_AS)); } catch { /* (nothing kept) */ }
  return { own: {}, page: null, ...saved };
})();
Object.assign(settings, restored.own);
let soundWoken = false;   // has there been a click, tap or key yet? (Browsers allow no sound before.)
let lastSaved = '';
function saveState() {
  if (measuring.on) return;   // (boing.measure goes through scenes of its own)
  const state = toSaved(settings, panel.page);
  if (state === lastSaved) return;
  lastSaved = state;
  try { localStorage.setItem(SAVED_AS, state); } catch { /* (not allowed here: nothing is kept) */ }
}

// --- Set up ------------------------------------------------------------------

const canvas = document.getElementById('scene');
// (Who draws: see drawing.js. Set up this early because the page asks for
// a new picture, showTextGlow, from its first moments.)
start(drawingPart);

// Who draws: WebGPU where the browser has it, else WebGL (see startWebGpu
// below). WebGL is only set up when it is needed: without WebGPU, when
// WebGPU fails to start, or when it stops. Until one of them is ready,
// behind the loading screen, a stand-in keeps the settings and draws
// nothing.
const noRenderer = {
  isWebGpu: false, hdr: null, pixelSize: 1, wideColor: false, measureGpu: false,
  setWideColor(on) { this.wideColor = on; },
  resize() {}, applyColorSpace() {}, draw() {}, dispose() {}, waitUntilDone() {},
};
// The WebGL renderer, made the first time it's asked for. If WebGL2
// doesn't work either, the Guru says so, and the demo stops.
let screenRenderer = null;
// (quiet: if WebGL can't be had just now, return null instead of stopping
// the demo: see fallBackToWebGl in drawing.js.)
function webGlRenderer(quiet = false) {
  if (screenRenderer) return screenRenderer;
  try {
    screenRenderer = new Renderer(canvas);
  } catch (error) {
    if (quiet) return null;
    document.getElementById('info').textContent = 'Sorry, this demo needs WebGPU or WebGL2. ' + error.message;
    document.getElementById('loading')?.remove();
    showGuru(['Software Failure.   This demo needs WebGPU or WebGL2.', 'Guru Meditation #8000000B.0000AAC0'], false);
    halt();
    throw error;
  }
  return screenRenderer;
}
let renderer = noRenderer;
if (!navigator.gpu) renderer = webGlRenderer();

// The Amiga's famous last words: when a program crashed badly, the screen
// went black with a blinking red box, "Guru Meditation" and two numbers.
// Shown for real when the demo can't start, and for fun with the G key and
// the window's close gadget
// (then a click or a key takes it away again, as the left mouse button did).
// While it is shown, the demo stands still and draws nothing (it is hidden
// anyway): no work for the computer, as on the Amiga.
let guruShown = false;
function showGuru(lines, canClose = true) {
  if (document.getElementById('guru')) return;
  guruShown = true;
  const screen = document.createElement('div');
  screen.id = 'guru';
  const box = document.createElement('div');
  box.className = 'guru-box';
  for (const line of lines) box.append(Object.assign(document.createElement('div'), { textContent: line }));
  screen.append(box);
  document.body.append(screen);
  if (!canClose) return;
  const close = (e) => {
    e.preventDefault(); e.stopPropagation();
    screen.remove();
    removeEventListener('pointerdown', close, true);
    removeEventListener('keydown', close, true);
    guruShown = false;
    lastTime = performance.now();   // (the time away doesn't count)
    requestFrame();
  };
  // (From the next moment on: not by the very key press that opened it.)
  setTimeout(() => { addEventListener('pointerdown', close, true); addEventListener('keydown', close, true); }, 0);
}

const camera = new OrbitCamera(canvas);
// No pinch-zooming of the page itself, anywhere on it (over the controls
// too): it magnifies the whole page, the demo can't undo that, and the
// scene then shows only a corner. (A pinch over the scene zooms the camera
// instead; see camera.js. Once magnified, pinches pass, to zoom back out.
// Cmd + and Cmd − still zoom the page, as the browser's own choice.)
const pageMagnified = () => (window.visualViewport?.scale ?? 1) > 1.01;
addEventListener('wheel', (e) => { if (e.ctrlKey && !pageMagnified()) e.preventDefault(); }, { passive: false });
for (const type of ['gesturestart', 'gesturechange']) {   // (Safari's own pinch events)
  addEventListener(type, (e) => { if (!pageMagnified()) e.preventDefault(); }, { passive: false });
}
// The Size mix setting says how many times bigger the biggest ball is than the
// smallest. The physics wants a "size mix" instead: radii are spread from
// 2^-mix to 2^+mix times the standard size, so biggest ÷ smallest = 4^mix.
const sizeMix = (ratio) => Math.log2(ratio) / 2;

// Add the same "?v=<version>" that index.html gave this script, so new
// sound files (and the physics worker) aren't held back by the browser's
// cache either.
const version = new URL(import.meta.url).search;
// The physics runs in a worker, a thread of its own, so that a slow physics
// step never holds up the drawing (see physics-client.js). `physics` is the
// page's side of it: the same methods as Physics, and a copy of the balls
// as they were after the last step.
const physics = new PhysicsClient(settings.balls, sizeMix(settings.sizes), {
  version,
  onSnapshot: (snapshot, changed) => tookSnapshot(snapshot, changed),
  // (Should the worker ever stop with an error, the physics carries on on
  // the page: set the scene up again, and say so.)
  onError: (message) => {
    restartPreset();
    showRequester('Physics', [`The physics stopped with an error (${message}) and was started again.`]);
  },
});
const sounds = new Sounds();
// The sounds are fetched only once the page has loaded: no sound can play
// before the first click or key press anyway (browsers don't allow it), so
// they needn't hold up the start. (They are small, and ready long before.)
function loadSounds() {
  sounds.load('bounce', `static/bounce1.ogg${version}`);
  sounds.load('click', `static/bounce2.ogg${version}`);
}
if (document.readyState === 'complete') setTimeout(loadSounds, 0);
else addEventListener('load', () => setTimeout(loadSounds, 0), { once: true });

// A boing whenever two balls hit each other, coming from the side of the
// screen where they touch, and louder the harder they hit.
const FULL_VOLUME_SPEED = 8;   // impact speed (units/s) that gives full volume
let hitsCounted = 0;   // for the "Hits/s" detail row
// After every physics step: what was hit (for the boings), and the balls'
// number. Each hit is kind (0 = two balls, 1 = a wall), where (x, y, z) and
// how hard (see EVENT_NUMBERS in physics-host.js).
const where = new Vec3();
function tookSnapshot(snapshot, changed) {
  hitsCounted += snapshot.hits;
  counts.physicsMs += snapshot.ms;
  if (measuring.on) { measuring.on.physicsMs += snapshot.ms; measuring.on.steps++; }
  counts.steps++;
  if (changed) needsRedraw = true;
  if (physics.upToDate && snapshot.count !== settings.balls) {   // (fewer fit, or a preset placed its own)
    settings.balls = snapshot.count;
    ballSlider.refresh();
  }
  // (No boings: nothing more to work out. Nor from a scene just left.)
  if (!settings.sound || !physics.sceneCurrent) return;
  const e = snapshot.events;
  for (let at = 0; at < e.length; at += EVENT_NUMBERS) {
    if (e[at] === 1 && !settings.wallSound) continue;
    where.x = e[at + 1]; where.y = e[at + 2]; where.z = e[at + 3];
    // Our ears hear loudness roughly logarithmically, so the volume rises
    // quickly for soft hits and levels off for hard ones. Even the gentlest
    // touch stays faintly audible. (With "Wall sound" on, the same boing
    // when a ball hits a wall, as in the original demo.)
    const volume = Math.max(0.08, Math.min(1, e[at + 4] / FULL_VOLUME_SPEED) ** 0.7);
    sounds.play('bounce', camera.screenX(where), volume);
  }
}

// Clicking (or tapping) a ball gives it a push.
camera.onClick = (x, y) => {
  const ray = camera.rayThroughPixel(x, y);
  let nearest = null;
  let nearestDistance = Infinity;
  for (const ball of physics.balls) {
    const distance = raySphere(ray.origin, ray.dir, ball.position, ball.radius);
    if (distance < nearestDistance) {
      nearest = ball;
      nearestDistance = distance;
    }
  }
  if (nearest) {
    physics.push(nearest, ray.origin, ray.dir);
    rewindCheck.markChanged();   // (no rewind can undo a push)
    sounds.play('click', camera.screenX(nearest.position));
  }
};

// ---- Energy -------------------------------------------------------------------
// The Energy slider shows the total energy of the balls (movement + spin +
// height) for their weight, measured in "classic starts": 1.0 is how much
// energy the balls have in the classic four-ball start. For their weight,
// not per ball: a ball twice as wide weighs four times as much (see Ball in
// physics.js), and would otherwise show four times the energy at the same
// speed and height, and tiny balls next to none. Because nothing in the box
// loses energy, the value stays put by itself; clicks add energy and
// gravity changes alter the height part. Dragging the slider makes all balls
// faster or slower to reach the chosen energy. (The Info page shows the
// same number, with more digits.)
const ENERGY_UNIT = new Physics(4, 0).totalEnergy(1) / 4;   // (four balls of weight 1 each)
const totalWeight = () => {
  let weight = 0;
  for (const ball of physics.balls) weight += (ball.radius / BALL_RADIUS) ** 2;
  return weight;
};
const energyPerBall = () => physics.totalEnergy(settings.gravity) / (Math.max(1e-9, totalWeight()) * ENERGY_UNIT);

// ---- The settings panel ------------------------------------------------------
const panel = new Panel(document.body);

// The panel's rows are spread over four pages (PAGES in settings.js), chosen with the tabs at the
// top. The numbers on the Info page take a little work to produce, so they
// are only worked out while that page is shown.
// (And only while the panel is open: otherwise nobody can see them.)
const infoShown = () => panel.isOpen && panel.page === 'Info';
const sceneShown = () => panel.isOpen && panel.page === 'Scene';
panel.addTabs(PAGES);

// FPS: how many frames the demo actually drew last second. The bar is full at
// your screen's refresh rate (the most a browser will ever draw). While
// paused with nothing changing, nothing needs drawing, so it shows 0. On the
// Info page, at its top.
panel.startPage('Info');
const fpsDisplay = panel.addSetting('fps', settings);
// Right under it, what changes most how fast the scene is drawn: Pixel
// size.
// (A big pixel is a whole number of the screen's own: half steps only
// exist where the screen has two or more of its pixels to a CSS pixel, as
// most laptops and phones. Elsewhere 1.5 would look just as 2.)
const pixelSlider = panel.addSetting('pixelSize', settings, {
  step: devicePixelRatio >= 1.5 ? 0.5 : 1, onChange: (size) => app.showPixels(size) });
panel.startPage(null);

// ---- Presets: ready-made scenes (see presets.js) ------------------------------
// `keep`: settings to keep as they are instead (see restartPreset).
// (Each is a show: see show.js. Most have one part, a scene of balls.)
function applyPreset(name, keep = {}) {
  scroller.clock = 0;   // (the scrolling text starts from its beginning: also on Restart)
  show.start(PRESETS[name], keep);
}
function applyScene(preset, keep = {}) {
  app.speedSamples = 0;   // (the speed histogram starts again)
  physics.newScene();   // (the old scene's last bounces stay silent)
  // (HDR is not among the presets' settings: it stays as it is.)
  Object.assign(settings, PRESET_DEFAULTS, preset.settings, keep);
  app.graph.clear();   // (the Info graph starts again)
  camera.lookFromFront();
  if (preset.lookDown) {
    camera.polar = ((90 - preset.lookDown) * Math.PI) / 180;
    camera.update();
  }
  physics.room = settings.grid ? boxRoom() : app.screenRoom();   // before the balls are placed in it
  app.wantedTilt = settings.lampTilt;
  app.limitLampTilt();
  physics.ballSize = settings.ballSize;
  // (Also for presets that place their own balls: balls added later with
  // the Balls slider follow the Size mix shown.)
  physics.sizeMix = sizeMix(settings.sizes);
  if (preset.setup) {
    preset.setup(physics);
  } else {
    // Start over with fresh balls of the chosen number and size mix.
    physics.clearBalls();
    physics.sizeMix = sizeMix(settings.sizes);
    physics.setBallCount(settings.balls);
  }
  applySettings();
}

// ---- The show (see show.js): the parts of a preset, one after another ---------
// Here is what it works with on this page: a scene is set up as above, and
// the curtain is a black sheet over everything but the title bar and the
// Controls.
const curtain = document.createElement('div');
curtain.className = 'demo-curtain';
document.body.append(curtain);
const show = new Show({
  scene: applyScene,
  change: (changes) => { Object.assign(settings, changes); applySettings(false); },
  curtain: (drawn) => curtain.classList.toggle('drawn', drawn),
  speed: () => settings.speed,
});
// The demo effects as backdrops (see BACKDROPS in renderer.js): what draws
// each, for whichever renderer draws the scene.
const backdropEffects = {
  twist: { gl: createDrawer, gpu: createGpuDrawer },
  bobs: effectDrawers.bobs,
  tunnel: effectDrawers.tunnel,
};

// Say on screen what time is doing, as a video recorder does (see #rewind
// in style.css): "◀◀ REWIND" blinking while it runs backwards ("❚◀ SLOW
// REWIND", steady, when slower than −1), "PAUSE ❚❚"
// while it stands still, "SLOW ▶❚" while it runs slower than normal (also
// when the physics slows itself down), "FAST FORWARD ▶▶" while faster, and
// "PLAY ▶" for a few seconds when it runs normally again.
let vcrShown = null, vcrSpeed = null, playShownUntil = 0;
const PLAY_SHOWN_MS = 3000;
const vcrBox = document.getElementById('rewind');
// The symbols, drawn in the font's own square pixels (the Amiga font has no
// triangles): each a picture 7 pixels tall, as tall as the capitals, sitting
// on the line like a letter; '#' is a lit pixel. Solid, as on a real video
// recorder's screen.
// (The triangles step one pixel per row, as on a real video recorder's
// display: 1, 2, 3, 4, 3, 2, 1 pixels wide.)
const PLAY_ROWS = ['#   ', '##  ', '### ', '####', '### ', '##  ', '#   '];
const BACK_ROWS = PLAY_ROWS.map((row) => [...row].reverse().join(''));
const VCR_SYMBOLS = {
  '▶': PLAY_ROWS,
  '◀': BACK_ROWS,
  '◀◀': BACK_ROWS.map((row) => `${row} ${row}`),
  '❚◀': BACK_ROWS.map((row) => `## ${row}`),
  '▶▶': PLAY_ROWS.map((row) => `${row} ${row}`),
  '❚❚': PLAY_ROWS.map(() => '## ##'),
  '▶❚': PLAY_ROWS.map((row) => `${row} ##`),
};
const FONT_PIXEL = 0.125;   // em: the font is 8 of its pixels per em
function vcrSymbol(rows) {
  const width = rows[0].length, svg = 'http://www.w3.org/2000/svg';
  const picture = document.createElementNS(svg, 'svg');
  picture.setAttribute('viewBox', `0 0 ${width} 7`);
  picture.setAttribute('class', 'vcr-symbol');
  picture.dataset.columns = width;
  picture.style.width = `${width * FONT_PIXEL}em`;
  rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== '#') return;
    const square = document.createElementNS(svg, 'rect');
    square.setAttribute('x', x); square.setAttribute('y', y); square.setAttribute('width', 1); square.setAttribute('height', 1);
    picture.append(square);
  }));
  return picture;
}
// Make each of a symbol's pixels a whole number of the screen's pixels, so
// that every pixel comes out the same size (both bars of ❚❚ alike, the
// triangles' steps even). Called once the symbols are on the page, and
// again when the window or the screen's pixel size changes.
function fitVcrSymbols(within = document) {
  const ratio = window.devicePixelRatio || 1;
  for (const picture of within.querySelectorAll('.vcr-symbol')) {
    const fontSize = parseFloat(getComputedStyle(picture.parentElement).fontSize) || 16;
    const pixel = Math.max(1, Math.round(fontSize * FONT_PIXEL * ratio)) / ratio;
    picture.style.width = `${picture.dataset.columns * pixel}px`;
    picture.style.height = `${7 * pixel}px`;
  }
}
addEventListener('resize', () => fitVcrSymbols());
function showVcr(now) {
  const speed = settings.speed;
  if (speed !== vcrSpeed) {
    if (speed === 1 && vcrSpeed !== null) playShownUntil = now + PLAY_SHOWN_MS;
    vcrSpeed = speed;
  }
  // What the balls are seen doing: the speed chosen, times the share of it
  // the physics manages when it slows down by itself (too many collisions
  // for its time budget). Slower than normal, also when fast forward is
  // slowed below normal, is SLOW. (At speed 1, SLOW is held a moment after
  // the physics catches up, so it doesn't flicker.)
  // Backwards the same: slower than −1 is SLOW REWIND, −1 and faster REWIND.
  const seen = Math.abs(speed) * (physics.slowedDown ? physics.paceShare ?? 1 : 1);
  const slow = speed !== 0 && (seen < 1 || (Math.abs(speed) === 1 && physics.slowedDown));
  const text = speed < 0 ? (slow ? '❚◀ SLOW REWIND' : '◀◀ REWIND') : speed === 0 ? 'PAUSE ❚❚' : slow ? 'SLOW ▶❚'
    : speed > 1 ? 'FAST FORWARD ▶▶' : now < playShownUntil ? 'PLAY ▶' : '';
  if (text === vcrShown) return;
  vcrShown = text;
  vcrBox.replaceChildren(...text.split(/(▶❚|❚◀|▶▶|◀◀|❚❚|▶)/).filter(Boolean).map((part) => VCR_SYMBOLS[part] ? vcrSymbol(VCR_SYMBOLS[part]) : part));
  fitVcrSymbols(vcrBox);
  const blinking = text.startsWith('◀◀') || text.startsWith('FAST');   // (REWIND and FAST FORWARD blink)
  document.body.classList.toggle('rewinding', blinking);
  document.body.classList.toggle('vcr', text !== '' && !blinking);
}   // is "<< REWIND" on screen?

// ---- The rewind check (see rewindcheck.js) -----------------------------------
// While time runs forwards, a box below the preset bar appears once running
// time backwards would no longer bring the balls back to the start: "will
// drift" (yellow, an estimate), or "not possible" (red).
const rewindCheck = physics.rewind;   // (the rewind test runs next to the physics)


// Make everything follow `settings` after a preset changed several at once.
// (fresh: a new scene, so the trails start anew. Not for a change in the
// running scene: a cue of the show.)
function applySettings(fresh = true) {
  physics.ballBounce = COLLISION_TYPES[settings.ballType];
  physics.wallBounce = COLLISION_TYPES[settings.wallType];
  physics.precise = PARTS[settings.digits];
  physics.trailSeconds = settings.trails;
  if (fresh || settings.trails === 0) physics.clearTrails();
  physics.changed();
  camera.locked = !settings.grid;
  showCopper(settings.copper);
  scroller.setShown(settings.scroller);
  app.showPixels(settings.pixelSize);
  app.showTextGlow();
  showCredits(settings.credits);
  music.setTrack(settings.track);
  music.setPlaying(settings.music && soundWoken);   // (see soundWoken)
  for (const control of controls) control.refresh();
  needsRedraw = true;
}

const controls = [];   // everything applySettings() has to redraw
controls.push(pixelSlider);
// The presets are not in the panel but in the preset bar, which is always
// on screen (top-left, below the speed bar). Restart (also the R key)
// starts the chosen preset again from its beginning. It keeps the Precision
// setting: choose a preset, set Precision, press R, and the whole scene runs
// with those digits.
const restartPreset = () => applyPreset(settings.preset, { digits: settings.digits });
const presetBar = addPresetBar(document.body, settings, 'preset',
  // (A line in the menu after the showpieces, before the physics experiments.)
  Object.entries(PRESETS).map(([value, preset]) => ({ value, label: preset.label, lineAfter: value === 'megademo' })),
  (name) => applyPreset(name), restartPreset);
controls.push(presetBar);

// If the box is too full for the number asked for, the slider shows how
// many balls actually fit.
// (The number is taken over after the physics' next step: see tookSnapshot.)
const showBallCount = () => {
  needsRedraw = true;
};
start(scenePart);

// ---- Full screen, the fading controls, the screen kept awake (see page.js) -------
startFullScreen(() => resize());

// How things bounce (explained in physics.js and in the About window).
app.sceneHooks.ballType = (type) => { physics.ballBounce = COLLISION_TYPES[type]; rewindCheck.markChanged(); };
// Walls have one more choice, "1984": slippery, and the ball turns the
// other way after every bounce off a side wall, as in the original demo.
// (Not real physics: see COLLISION_TYPES.classic in physics.js.)
app.sceneHooks.wallType = (type) => { physics.wallBounce = COLLISION_TYPES[type]; rewindCheck.markChanged(); };
// How many digits the physics computes with (see precise.js). More digits
// are slower, but running time backwards retraces the paths for longer.
// (For the whole scene to run with them, choose them and press R.)
const PARTS = { 16: 0, 32: 2, 64: 4 };   // ordinary numbers per precise number (0 = the usual physics)
// Named after the standard number sizes they come closest to: Double is
// the computer's ordinary 64-bit number (about 16 digits). Quadruple is
// two doubles together (a "double-double", about 32 digits; true 128-bit
// quadruple has 34) and Octuple four (a "quad-double", about 64 digits;
// true 256-bit octuple has 71).
app.sceneHooks.digits = (digits) => {
  physics.precise = PARTS[digits];
  // From here on the scene runs with other digits: the rewind test (if on)
  // and the graph start again from this moment.
  if (rewindCheck.enabled) rewindCheck.setEnabled(true);
  app.graph.clear();
  app.showRewindTest();
};
const scenePage = panel.addPage('Scene', settings, app.sceneHooks);
const { balls: ballSlider, energy: energySlider } = scenePage;
controls.push(...Object.values(scenePage));

// ---- The sound (on the Show page) ------------------------------------------------
// The boings (off, or for the balls, or for the walls too) and their
// loudness; the chiptune (see music.js): off or which tune, and its loudness.
sounds.volume = settings.soundVolume;
const music = new Music(sounds);
music.setVolume(settings.musicVolume);

// ---- The Show and Room pages -----------------------------------------------------
// (Its rows, made from the list in settings.js, are added at the end of
// this part: see lookPage. Here what they do.)
// Trails: a fading line behind every ball, showing where it has been
// during the last so many seconds. 0 = no trails.
const lookHooks = {
  trails: (seconds) => {
    physics.trailSeconds = seconds;
    if (seconds === 0) physics.clearTrails();
    needsRedraw = true;
  },
  // The sound, at the end of the Show page.
  soundVolume: (volume) => { sounds.volume = volume; },
  track: {
    labels: Object.fromEntries(Object.entries(TRACKS).map(([value, track]) => [value, track.name])),
    onChange: () => { music.setTrack(settings.track); music.setPlaying(settings.music); },
  },
  musicVolume: (volume) => music.setVolume(volume),
};
// Copper bars as the backdrop.
function showCopper(on) {
  document.body.classList.toggle('copper', on);   // (white credit text over the dark bars)
  needsRedraw = true;
}
// (One row for both settings: None, or one of the backdrops.)
lookHooks.backdrop = () => showCopper(settings.copper);
// The other demo classic: a scrolling text along the bottom (see scroller.js).
const scroller = new Scroller();
lookHooks.scroller = (on) => { scroller.setShown(on); app.showTextGlow(); };
// The credit line at the very bottom. (The scroller's text starts with it,
// so it isn't lost when switched off here.)
function showCredits(on) {
  document.getElementById('info').style.display = on ? '' : 'none';
}
lookHooks.credits = showCredits;
start(roomPart);

start(hdrPart);

start(infoPart);

// ---- Keyboard shortcuts ----------------------------------------------------------
//   Space   pause, and carry on at the speed it had
//   Escape  close the window in front
//   1 … 9, 0  the presets (0 would be a tenth)
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave the browser's own shortcuts alone
  if (e.code === 'Space') {
    // (Stops the page scrolling. Space would also press whichever button
    // was clicked last, so that is stopped too, on keyup below.)
    e.preventDefault();
    if (e.repeat) return;
    app.togglePause();
  } else if (e.key === 'Escape') {
    if (document.fullscreenElement ?? document.webkitFullscreenElement) return;   // (that Escape only leaves full screen)
    closeFrontWindow();
  } else if (e.code === 'KeyF' && !e.repeat) {
    if (canFullScreen) toggleFullScreen();
  } else if (e.code === 'KeyG' && !e.repeat) {
    showGuru(['Software Failure.   Press left mouse button to continue.', 'Guru Meditation #00000004.0000AAC0']);
  } else if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    restartPreset();
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') e.preventDefault(); });

// ---- Demo classics, each in a window of its own ----------------------------------
// The Twist (see twist.js) and the others (see effects.js): small buttons on
// one row, each named short (its window's title as the tooltip).
panel.addLine();   // (a groove above the buttons, on every page)
panel.addButtons([['Twist', openTwistWindow, 'Twist v4'],
  ...EFFECTS.map((effect) => [effect.short ?? effect.label, effect.open, effect.label])]);

// ---- About ---------------------------------------------------------------------
// The version (as in index.html), from this script's own address (main.js?v=…).
const VERSION = new URL(import.meta.url).searchParams.get('v') ?? 'unknown';
let aboutIsOpen = false;
const openAbout = () => {
  if (aboutIsOpen) return;   // one is enough
  aboutIsOpen = true;
  // (The release, without the build number after the dash: that one only
  // makes browsers fetch the new files; see index.html. boing.measure()
  // reports it in full.)
  showRequester(`About Amiga Boing Balls (version ${VERSION.split('-')[0]})`, ABOUT, () => { aboutIsOpen = false; });
};
// Defaults: the settings back: your own as on the very first visit
// (loudness, Glints, HDR: those no preset changes), the look, the room and
// the sound as the preset has them, and the Controls back in the top-right
// corner. The balls carry on as they are.
function restoreDefaults() {
  Object.assign(settings, ownSettings(startSettings()));
  panel.moveTo(null);
  sounds.volume = settings.soundVolume;
  music.setVolume(settings.musicVolume);
  // (HDR only where WebGPU draws: see noHdrWithoutWebGpu.)
  if (renderer.isWebGpu) app.syncHdr(); else app.noHdrWithoutWebGpu();
  // The look, the room and the sound back as the preset has them (in a
  // show, as its part now has them): Pixel size, trails, backdrop, the lamp,
  // the music ... But not the balls themselves: what the Scene page sets
  // (how many, how big, gravity, how they bounce) and Precision stay as
  // they are, so the scene runs on undisturbed, and so does time.
  const scene = { ...PRESET_DEFAULTS, ...show.settings, ...show.parts[show.index]?.settings };
  for (const [key, value] of Object.entries(scene)) {
    const page = SETTINGS[key]?.page;
    if (page === 'Scene' || page === 'Info' || key === 'speed' || settings[key] === value) continue;
    settings[key] = value;
    const hook = lookHooks[key];
    if (key !== 'camMove' && key !== 'backdrop') (hook?.onChange ?? hook)?.(value);
  }
  applySettings(false);
}
panel.addButtons([['About...', openAbout, 'About this demo'],
  ['Defaults', restoreDefaults, 'The look, the room and the sound back as the preset has them, your own settings (loudness, Glints, Pixel size, HDR) as at first, and the Controls in their corner; the balls carry on']]);

// The picture only needs redrawing when something changed: the balls move,
// the camera moves, the window is resized or a ball is added or removed.
// While paused with nothing happening we skip drawing, which saves battery.
let needsRedraw = true;

// Keep the picture sharp and undistorted when the window changes size.
function resize() {
  renderer.resize();
  camera.resize(canvas.clientWidth, canvas.clientHeight);
  if (!settings.grid) app.applyRoom();   // the window-sized room follows the window
  needsRedraw = true;
}
addEventListener('resize', resize);
// Moved to a screen with other pixels (from a Retina screen to an ordinary
// one, say), the window can keep its size, and then no "resize" comes: the
// picture would stay drawn for the old screen's pixels. So that too is
// watched for (a new watch each time, for the new screen's pixels).
function watchPixelRatio() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => {
    resize();
    fitVcrSymbols();
    needsRedraw = true;
    watchPixelRatio();
  }, { once: true });
}
watchPixelRatio();
resize();

// Start with the first preset, Four balls.
applyPreset(settings.preset);
addEventListener('pagehide', saveState);

// Browsers allow no sound before the first click, tap or key press. A
// preset with music (Carousel, Copper demo) starts it then.
// (The page may now start with such a preset, as it was left: until then
// the tune isn't even set going, which browsers would only warn about.)
for (const event of ['pointerdown', 'keydown']) {
  addEventListener(event, () => { soundWoken = true; music.setPlaying(settings.music && !document.hidden); });
}

// Handy for experimenting: type `boing.physics.balls[0]` in the browser's
// developer console to inspect or change a ball while the demo runs.
fadeIdleControls();
// The close gadget at the left end of the title bar: a web page can't close
// itself, and the show should go on, so the "program" crashes instead, as
// Amiga programs so often did: the Guru Meditation, until a click or a key.
// In full screen it goes back to the window instead.
document.querySelector('.app-bar .window-close').addEventListener('click', () => {
  // In full screen, closing means leaving full screen, back to the window.
  if (fullScreenElement()) { toggleFullScreen(); return; }
  showGuru(['Software Failure.   Press left mouse button to continue.', 'Guru Meditation #00000004.0000AAC0']);
});

const checkPausedAwake = keepScreenAwake();


// ---- Measuring: boing.measure() (see measure.js) --------------------------------
const measure = makeMeasure({
  settings, physics, canvas, applyPreset, wideColourScreen: app.wideColourScreen, version: VERSION,
  renderer: () => renderer, screenRate: () => screenRate,
});

// (Kept: what a test set on window.boing before the page started, as noDirectWebGl.)
window.boing = { ...window.boing, version: VERSION, presets: PRESETS, show, music, physics, camera, settings, sounds, scroller, rewindCheck, applyRoom: () => app.applyRoom(), showGrid: (on) => app.showGrid(on), hdr: (on) => app.setHdr(on), drawWith: (which) => app.drawWith(which), preset: (name, keep) => { settings.preset = name; applyPreset(name, keep); }, measure,
  tinker: (code) => physics.tinker(code) };   // (for trying things in the console)
Object.defineProperty(window.boing, 'renderer', { get: () => renderer });   // (whichever draws now)
// (boing.smoothEffects = false: the Twist and the Tunnel, in windows or as
// backdrops, drawn without smoothing their edges (one sample a pixel instead
// of four), to compare how they look and how fast they are. Not saved.)
Object.defineProperty(window.boing, 'smoothEffects', { get: () => twistOptions.smooth, set: (on) => { twistOptions.smooth = Boolean(on); } });


// --- Animation loop ----------------------------------------------------------
// The browser calls frame() before every screen refresh (60 times a second on
// most screens, 120+ on some). We measure how much real time has passed and
// advance the physics by exactly that much, so the speed is the same
// everywhere.

let lastTime = performance.now();
let clockOwed = 0;   // milliseconds the motion is behind the clock (see frame)

// Counted over one second, then shown and reset.
const counts = { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, sampled: 0, sampledMs: 0, late: 0, since: lastTime };
// (WebGL without the card's timer: one frame in this many is waited for and timed.)
const SAMPLE_EVERY = 20;
let framesSinceSample = SAMPLE_EVERY;   // (so the first frame with the Info page shown is timed)
let lastSampledMs = null;

// The screen's refresh rate. The browser calls frame() once per refresh,
// but only if the previous frame is done, so when the demo can't keep up it
// is called less often. The highest rate ever seen is therefore the
// screen's real rate.
let screenRate = 1;
// Counted over a second, the rate comes out a little off now and then: a
// frame more or less in the count, and with a variable refresh rate (VRR,
// ProMotion) the screen may even come a little early. So it is taken as the
// screen rate it is nearest to, where one is within 4 %.
const SCREEN_RATES = [24, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 180, 200, 240, 280, 300, 360, 480, 500];
function standardRate(measured) {
  const nearest = SCREEN_RATES.reduce((a, b) => (Math.abs(b - measured) < Math.abs(a - measured) ? b : a));
  return Math.abs(nearest - measured) <= 0.04 * nearest ? nearest : Math.round(measured);
}
// The last few times between frames, for telling a late frame (see frame()).
const recentGaps = [];
const sortedGaps = new Float64Array(31);   // (sorted in place: nothing new made every frame)
const usualGap = () => {
  const n = recentGaps.length, sorted = sortedGaps;
  for (let i = 0; i < n; i++) {
    const gap = recentGaps[i];
    let j = i - 1;
    while (j >= 0 && sorted[j] > gap) { sorted[j + 1] = sorted[j]; j--; }
    sorted[j + 1] = gap;
  }
  return sorted[n >> 1];
};

// While the page is hidden (another tab is in front, or the browser is
// minimised), everything stops: no physics, no drawing, and audio.js
// freezes the sound. Nothing is asked of the computer until you come back.
let frameRequested = false;
// Stop everything for good (see webGpuLost): no more frames, no sound.
// (var, and the try: this can come before the rest of the page is set up.)
var halted = false;
function halt() {
  halted = true;
  try { music.setPlaying(false); sounds.halted = true; sounds.context?.suspend(); } catch { /* not set up yet: nothing to stop */ }
}
function requestFrame() {
  if (frameRequested || halted) return;   // one is already on its way (or the demo has stopped)
  frameRequested = true;
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  lastTime = performance.now();   // the time away doesn't count
  requestFrame();
});


let loadingScreen = document.getElementById('loading');   // (see index.html)
const MIN_LOADING_MS = 1500;

// Warming up the effect windows (Twist, Bobs, Tunnel) while the loading
// screen still shows: each is made once, on a small canvas no one sees,
// draws one picture and is thrown away. Making an effect's shaders is the
// slow part of opening its window (it can hold up the page for a moment);
// the browser keeps what it made, so a window opened later starts at once,
// without a hitch in the balls' motion.
let effectsWarm = false;
function warmEffects() {
  effectsWarm = true;
  const device = twistOptions.device;
  const makers = [(canvas) => (device && createGpuDrawer(canvas, device)) || createDrawer(canvas),
    ...[effectDrawers.bobs, effectDrawers.tunnel].map((kind) => (canvas) => (device && kind.gpu(canvas, device)) || kind.gl(canvas))];
  for (const make of makers) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const drawer = make(canvas);
      if (!drawer) continue;
      drawer.setLook(twistOptions.wide, twistOptions.hdr);
      drawer.draw(0, 16, 16, 0);
      drawer.dispose();
    } catch (error) { console.warn('Effect warm-up:', error); }   // (only a warm-up: the windows work without it)
  }
}

const drawOptions = {};     // (see renderer.draw)
// ---- A frame, step by step -----------------------------------------------------
// frame (below) calls these in order, once for every refresh of the screen.

// 1. How much time this frame stands for, in seconds; and the bookkeeping
// of the gaps between frames (late ones are counted).
function frameTime(now) {
  const gap = Math.max(0, now - lastTime);   // (milliseconds since the last frame; never below 0, see visibilitychange)
  // A late frame (see details.late): a gap more than 1.5 times the usual one.
  // "Usual" is the middle value of the last 31 gaps, not the screen's highest
  // rate: a screen can change its rate on the fly (a MacBook in Low Power
  // Mode goes from 120 to 60 Hz, or the window moves to another screen), and
  // evenly slower frames are no stutter. (Long hold-ups count too: the time
  // a tab was hidden doesn't, as lastTime starts afresh when it comes back.)
  const usual = recentGaps.length >= 8 ? usualGap() : gap;
  if (recentGaps.length >= 8 && gap > 1.5 * usual) { counts.late++; if (measuring.on) measuring.on.late++; }
  if (measuring.on) measuring.on.gaps.push(gap);
  recentGaps.push(gap);
  if (recentGaps.length > 31) recentGaps.shift();
  lastTime = now;

  // How far to move everything on: by whole refreshes of the screen. A new
  // picture can only appear at a refresh, so the balls should move the same
  // distance from each picture to the next, but the browser's times for
  // the frames wobble a little (by a few tenths of a millisecond, more in
  // some browsers), and each wobble would show as a slight unevenness. So
  // a gap close to one usual gap (or two, after a dropped frame) counts as
  // exactly that. What this leaves out or adds is kept, and paid back a
  // tenth at a time, so the motion stays in step with the clock.
  // Capped, so that coming back to a tab that was hidden for a minute
  // doesn't make everything jump.
  const refreshes = Math.max(1, Math.round(gap / usual));
  let step = Math.abs(gap - refreshes * usual) < 0.2 * usual ? refreshes * usual : gap;
  clockOwed = Math.max(-usual, Math.min(usual, clockOwed + gap - step));   // (never more than a frame's worth)
  const payBack = clockOwed * 0.1;
  step += payBack;
  clockOwed -= payBack;
  return Math.min(step / 1000, 0.1);
}

// 2. The show, the scroller, the speed gadgets and the camera move on.
function runShow(elapsed, speed, now) {
  // The show's own time (see show.js) moves on as the demo's does. But a
  // show with a tune written for it (the Megademo's: a section for each
  // part, see TRACKS.mega in music.js) follows the tune's clock instead, so
  // that its parts change exactly on the bar lines, also on a computer too
  // slow to draw every frame in time. If the two are far apart (the music
  // only started at the first click, or the show was paused or run at
  // another speed meanwhile), the tune goes to where the show is. (At
  // normal speed only: the tune has just one.)
  let showTime = elapsed * Math.abs(speed);
  if (speed === 1 && show.moves && music.playing && music.track.sections) {
    const since = show.timeSince(show.parts.findIndex((part) => ({ ...show.settings, ...part.settings }).music));
    if (since !== null) {
      const ahead = music.position + MUSIC_LEAD - since;   // (how far the tune is ahead of the show)
      if (Math.abs(ahead) < 1) showTime = Math.max(0, ahead);
      else music.seek(since - MUSIC_LEAD);
    }
  }
  show.tick(showTime);
  if (loadingScreen) needsRedraw = true;   // (the picture behind it ready, and the graphics card warmed up)
  scroller.rate = speed;   // the scrolling text pauses and rewinds with the balls
  scroller.tick(elapsed);
  showVcr(now);
  if (settings.autoCamera && !camera.locked) camera.autoMove(elapsed, settings.camMove);
}

// 3. The physics: the rewind test's twin if wanted, gravity's tilt, and the
// balls' next step.
function runPhysics(elapsed, speed) {
  // The rewind test only runs while the Controls are open (and it is
  // switched on); closed, its twin costs nothing. Opened again, it starts
  // afresh from that moment, as its twin did not follow the scene meanwhile.
  const testing = settings.rewindEstimate && panel.isOpen;
  if (testing !== rewindCheck.enabled) {
    rewindCheck.setEnabled(testing);
    if (testing) app.graph.clear();
    app.showRewindTest();
  }
  app.applyTilt();
  // The physics' next step, in its worker. (Its time budget, and the slow
  // motion when it is overrun, are in physics-host.js.)
  // Its time budget: most of a frame at this screen's rate (it works side by
  // side with the drawing); overrun, the balls go into slow motion.
  // (Paused, with no change on its way to it, there is nothing for the
  // physics to do: no step is asked for, and it works out no snapshot.)
  if (speed !== 0 || !physics.upToDate || !physics.started || (physics.speedsWanted && !physics.speeds)) {
    physics.step(elapsed * speed, settings.gravity, (0.8 * 1000) / Math.max(screenRate, 30));
  }
  // ...and show the balls this frame's time further on (see showNext in
  // physics-client.js).
  physics.showNext(Math.abs(elapsed * speed));
}

// 4. The picture (and how long it took; and the loading screen goes when
// the first one is there).
function drawPicture() {
  let start = performance.now();
  // (One options object, filled in afresh: nothing new for every frame.)
  const o = drawOptions;
  o.hdrStrength = settings.hdrStrength;
  o.glints = settings.lampOn ? settings.glints : 0;   // (no lamp: nothing to mirror, and no shadows)
  o.scroller = scroller.shown ? scroller : null;        // (the renderer draws it)
  o.ballNumbers = physics.numbers;                      // (WebGPU: see makeBallTable)
  o.copper = settings.copper;
  o.backdrop = settings.backdrop;
  // (so the bars pause and rewind with the balls; boing.testBackdropTime: a
  // set moment, for comparing pictures in tests)
  o.backdropTime = window.boing.testBackdropTime ?? physics.time;
  // (an effect as the backdrop; its glow set on it, so no new object every frame)
  const effect = backdropEffects[settings.backdrop] ?? null;
  if (effect) effect.glow = effectGlow();
  o.effect = effect;
  o.trailSeconds = settings.trails;
  o.trailTime = physics.time;
  o.grid = settings.grid;
  o.shadows = settings.shadows && settings.lampOn;
  o.stage = app.stage();
  // Without the graphics card's own timer (WebGL in Firefox and Safari),
  // wait for the card to finish a frame, so that the measured time
  // includes its work. Only one frame in SAMPLE_EVERY, and only while the
  // Info page is shown or boing.measure() runs: waiting stops the computer
  // and the card working side by side, and doing it every frame made
  // frames come late. On that frame, first wait for the work still left
  // from the frame before (not counted), so only this frame is timed.
  // (Not with HDR or WebGPU: there the wait makes the motion jerky.)
  const sample = (infoShown() || measuring.on) && !renderer.gpuTimer && !renderer.hdr && !renderer.isWebGpu
    && ++framesSinceSample >= SAMPLE_EVERY;
  if (sample) {
    framesSinceSample = 0;
    renderer.waitUntilDone();
    start = performance.now();
  }
  renderer.draw(camera, physics.balls, o);
  if (sample) {
    renderer.waitUntilDone();
    const ms = performance.now() - start;
    counts.sampledMs += ms; counts.sampled++;
    if (measuring.on) { measuring.on.doneMs += ms; measuring.on.doneFrames++; }
  }
  counts.drawMs += performance.now() - start;
  counts.drawn++;
  if (measuring.on) {
    measuring.on.drawn++;
    measuring.on.drawMs += performance.now() - start;
    // (WebGPU without the card's own timer: how long until the card has
    // done this frame's work, a rough upper bound of its time.)
    if (renderer.isWebGpu && !renderer.gpuTimer) {
      const sent = performance.now(), m = measuring.on;
      renderer.device.queue.onSubmittedWorkDone().then(() => { m.doneMs += performance.now() - sent; m.doneFrames++; });
    }
  }
  camera.changed = false;
  needsRedraw = false;
  // The first picture with the balls in it is ready: the loading screen
  // fades away (shown for at least MIN_LOADING_MS since the page began,
  // even when everything was there at once), and the balls start moving.
  if (loadingScreen && !effectsWarm && !choosingRenderer) warmEffects();
  if (loadingScreen && physics.started && performance.now() >= MIN_LOADING_MS) {
    loadingScreen.classList.add('gone');
    setTimeout((screen) => screen.remove(), 500, loadingScreen);
    loadingScreen = null;
  }
}

// 5. What the Controls show of the scene: the Energy slider and the Info page.
function showReadings() {
  // Keep the Energy slider showing the current energy (unless you're
  // dragging it). Only while it can be seen: adding up the energy of all
  // the balls every frame would otherwise be wasted.
  const energy = sceneShown() ? Math.round(energyPerBall() * 10) / 10 : settings.energy;
  if (!energySlider.dragging && physics.upToDate && energy !== settings.energy) {
    settings.energy = energy;
    // Big or fast balls can have more energy than the slider usually goes
    // to: then its range grows to fit.
    energySlider.setMax(Math.max(app.ENERGY_SLIDER_MAX, Math.ceil(energy)));
    energySlider.refresh();
  }

  // The totals on the Info page: a few times a second is plenty for reading numbers.
  if (infoShown() && counts.refreshes % 8 === 0) {
    app.graph.sample(rewindCheck.enabled && !rewindCheck.changedByHand ? rewindCheck.estimate() : null);
    app.showTotals();
    app.graph.draw();
    app.sampleSpeeds();
    app.drawSpeeds();
  }
  if (infoShown()) app.showRewindTest();
  // (Just shown: draw the graphs now, rather than at their next sample.)
  if (infoShown() !== app.infoWasShown) {
    app.infoWasShown = infoShown();
    if (app.infoWasShown) { app.graph.draw(); app.lateGraph.draw(); }
  }
}

function frame(now) {
  frameRequested = false;
  if (document.hidden || guruShown) return;   // stop here; started again when the page (or the scene) is shown

  const elapsed = frameTime(now);
  sounds.enabled = settings.sound;
  renderer.measureGpu = infoShown() || Boolean(measuring.on);
  physics.wantSpeeds(infoShown());   // (the speed histogram: only worked out while it can be seen)

  // (Paused while the Twist is full screen: see twistOptions.onFullScreen.
  // And held still behind the loading screen: the balls start when they are
  // shown.)
  const speed = app.twistFull || loadingScreen ? 0 : settings.speed;
  runShow(elapsed, speed, now);
  runPhysics(elapsed, speed);
  if ((speed !== 0 || camera.changed || needsRedraw) && !(loadingScreen && choosingRenderer)) drawPicture();
  showReadings();

  counts.refreshes++;
  if (now - counts.since >= 1000) showCounts(now);

  requestFrame();
}
requestFrame();

// Once a second: update FPS and the performance rows on the Info page.
function showCounts(now) {
  checkPausedAwake(now, settings.speed === 0);
  saveState();   // (kept for the next visit, if anything changed)
  const seconds = (now - counts.since) / 1000;
  app.lateInAll += counts.late;
  app.lateGraph.sample(counts.late);   // (always, also while nobody looks)
  screenRate = Math.max(screenRate, standardRate(counts.refreshes / seconds));
  settings.fps = Math.round(counts.drawn / seconds);
  fpsDisplay.setMax(screenRate);   // the bar is full at the screen's own rate
  fpsDisplay.refresh();   // (setMax only redraws when the range changes)

  if (infoShown()) {
    const physicsMs = counts.steps ? counts.physicsMs / counts.steps : 0;
    const drawMs = counts.drawn ? counts.drawMs / counts.drawn : 0;
    // (The pixels drawn, which decide most of the graphics card's work, and
    // the screen's refresh rate.)
    const target = renderer.target;
    app.details.pixels.set(target ? `${target.width}×${target.height}` : '–');
    app.details.refresh.set(`${screenRate} Hz`);
    // (Short, to fit: P3 = Display P3. Then HDR while it is on and the screen
    // shows it, else SDR. Rec. 2020: the ball colours go further than P3,
    // which needs HDR, so that says it all; see colourLevel in gpu-renderer.js.)
    const hdrNote = renderer.hdr?.screenIsHdr ? ' · HDR' : ' · SDR';
    app.details.colours.set(renderer.colourLevel === 2 ? 'Rec. 2020' : (app.wideColourScreen() ? 'P3' : 'sRGB') + hdrNote);
    app.details.physics.set(`${physicsMs.toFixed(2)} ms`);
    app.details.hits.set(String(Math.round(hitsCounted / seconds)));
    app.details.late.set(String(app.lateInAll));   // (since the page was opened; the graph below shows them second by second)
    app.lateGraph.draw();

    app.details.drawnWith.set(renderer.isWebGpu ? 'WebGPU' : 'WebGL');
    if (!counts.drawn) {
      app.details.graphics.set('–');   // nothing was drawn (paused)
    } else if (renderer.gpuTimer) {
      // Measured by the graphics card itself.
      const gpuMs = renderer.gpuFrames ? renderer.gpuTotalMs / renderer.gpuFrames : 0;
      app.details.graphics.set(`${gpuMs.toFixed(2)} ms`);
    } else {
      // Measured by waiting for the card on one frame in SAMPLE_EVERY: close,
      // but slightly pessimistic, because on that frame the computer and the
      // card take turns instead of working side by side.
      // (If no frame was timed since the last update, the last time stays.)
      // (Not with HDR or WebGPU: there the wait is skipped, as it would make
      // the motion jerky, so there is no measurement.)
      const unmeasured = renderer.hdr || renderer.isWebGpu;   // (the graphics card's time isn't known)
      if (counts.sampled) lastSampledMs = counts.sampledMs / counts.sampled;
      app.details.graphics.set(unmeasured || lastSampledMs === null ? '–' : `${lastSampledMs.toFixed(2)} ms`);
    }
  }

  if (measuring.on) {
    measuring.on.gpuMs += renderer.gpuTotalMs; measuring.on.gpuFrames += renderer.gpuFrames; measuring.on.hits += hitsCounted;
    for (const part in renderer.gpuParts ?? {}) measuring.on.parts[part] = (measuring.on.parts[part] ?? 0) + renderer.gpuParts[part];
  }
  renderer.gpuParts = {};
  renderer.gpuTotalMs = 0;
  renderer.gpuFrames = 0;
  hitsCounted = 0;
  Object.assign(counts, { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, sampled: 0, sampledMs: 0, late: 0, since: now });
}

// WebGPU takes over from WebGL where the browser has it (see startWebGpu).
// At the start, behind the loading screen: the first picture anyone sees is
// already drawn by WebGPU where it works. Until WebGPU is ready (or known not
// to work) nothing is drawn at all, so WebGL doesn't take the graphics card's
// time while WebGPU makes its pipelines. (WebGL isn't even set up: only if
// WebGPU doesn't work or stops, see webGlRenderer.) Should WebGPU take very
// long, the demo starts with WebGL and WebGPU takes over when it comes.
app.showTextGlow();
let choosingRenderer = Boolean(navigator.gpu);
const MAX_RENDERER_WAIT_MS = 6000;
app.startWebGpu().finally(() => { choosingRenderer = false; needsRedraw = true; });
setTimeout(() => {
  choosingRenderer = false;
  if (renderer === noRenderer) app.useRenderer(webGlRenderer());   // (WebGPU takes over when it comes)
}, MAX_RENDERER_WAIT_MS);
