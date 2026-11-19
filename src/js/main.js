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

import { Physics, COLLISION_TYPES, BOX_HALF_SIZE, boxRoom } from './physics.js';
import { EVENT_NUMBERS, SPEED_BARS, SPEED_RANGE } from './physics-host.js';
import { Renderer, maxLampTilt } from './renderer.js';
import { GpuRenderer } from './gpu-renderer.js';
import { OrbitCamera } from './camera.js';
import { Sounds } from './audio.js';
import { Panel, showRequester, closeFrontWindow, addSpeedBar, addPresetBar, wide } from './gui.js';
import { Vec3, raySphere } from './math.js';
import { openTwistWindow, twistOptions, createDrawer, createGpuDrawer } from './twist.js';
import { EFFECTS, effectDrawers } from './effects.js';
import { Music, TRACKS } from './music.js';
import { Scroller } from './scroller.js';
import { PRESETS, PRESET_DEFAULTS } from './presets.js';
import { DRIFTING, LOST } from './rewindcheck.js';
import { PhysicsClient } from './physics-client.js';
import { MAX_BALLS } from './shaders.js';

// Running now: should the page have said meanwhile that it is still
// starting (index.html), the credit line comes back (before the scroller,
// which begins with it, reads it).
{
  const info = document.getElementById('info');
  if (info.dataset.credit) { info.innerHTML = info.dataset.credit; delete info.dataset.credit; }
}

// Values the settings panel can change.
const settings = {
  fps: 0,          // measured frames per second (display only)
  energy: 1,       // total energy per ball; 1 = the classic start (see below)
  balls: 4,        // how many balls (1 … 4000)
  ballSize: 1,     // how big the balls are (1 = the usual size)
  sizes: 1,        // how many times bigger the biggest ball is than the smallest (1 … 4)
  gravity: 0.1,    // 0 = floating, 0.5 = heavy
  speed: 1,        // 1 = normal, 0 = paused, negative = time runs backwards!
  digits: 16,          // how many digits the physics computes with: 16, 32 or 64 (see precise.js)
  sound: true,
  soundVolume: 0.5,    // how loud the boings are (0 … 1)
  music: false,        // play the chiptune
  musicVolume: 0.5,    // how loud the music is (0 … 1)
  wallSound: false,    // also boing when a ball hits a wall
  shadows: true,       // the balls cast shadows
  rewindEstimate: false, // estimate how well a rewind would work (costs some time)
  fpsEvery: 1,         // Max FPS: a picture on every this many refreshes of the screen (1 = all of them)
  glints: 0.5,         // a glint where each ball mirrors the lamp (0 = none, 1 = white; brighter with HDR)
  tilt: false,         // tilt the phone or tablet to tilt gravity
  hdrStrength: 0,      // HDR: how bright light brighter than white gets (0 = off, as it starts; WebGPU only, see gpu-renderer.js)
  grid: true,          // show the box (off: the window is the room)
  pixelSize: 1,        // 1 = sharp; more = big square pixels and 4096 colours
  lamp: 21,            // how far away the lamp is (it makes the shadows)
  lampTilt: 0,         // where it is: 0° = straight above … 90° = right in front
  track: 'jump',       // which tune the music plays (see TRACKS in music.js)
  autoCamera: false,   // let the camera circle and zoom by itself
  camMove: 'orbit',    // ... how: 'orbit' (all the way round), 'swing' (side to side in front), or 'rise' (round, and up and down): the Auto cam choice

  preset: 'four',      // which ready-made scene was last chosen (see PRESETS)
  ballType: 'rough',   // how balls bounce off each other (see COLLISION_TYPES
  wallType: 'smooth',  //   in physics.js) and off the walls
  trails: 0,           // how many seconds long the fading line behind every ball is (0 = none)
  copper: false,       // a backdrop instead of the plain room ...
  backdrop: 'bars',    // ... which: 'bars' (copper bars), 'stars', 'plasma' or 'kefrens' (Kefrens bars)
  scroller: false,     // a scrolling text along the bottom
  credits: true,       // the credit line at the very bottom
};

// --- Set up ------------------------------------------------------------------

const canvas = document.getElementById('scene');

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
function webGlRenderer() {
  if (screenRenderer) return screenRenderer;
  try {
    screenRenderer = new Renderer(canvas);
  } catch (error) {
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
  if (measuring) { measuring.physicsMs += snapshot.ms; measuring.steps++; }
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
// height), per ball, measured in "classic starts": 1.0 is how much energy
// each ball has in the classic four-ball start. Because nothing in the box
// loses energy, the value stays put by itself; clicks add energy and
// gravity changes alter the height part. Dragging the slider makes all balls
// faster or slower to reach the chosen energy.
const ENERGY_UNIT = new Physics(4, 0).totalEnergy(0.1) / 4;
const energyPerBall = () =>
  physics.totalEnergy(settings.gravity) / (Math.max(1, physics.balls.length) * ENERGY_UNIT);

// ---- The settings panel ------------------------------------------------------
const panel = new Panel(document.body);

// The panel's rows are spread over four pages, chosen with the tabs at the
// top. The numbers on the Info page take a little work to produce, so they
// are only worked out while that page is shown.
const PAGES = ['Scene', 'Look', 'Sound', 'Info'];
// (And only while the panel is open: otherwise nobody can see them.)
const infoShown = () => panel.isOpen && panel.page === 'Info';
const sceneShown = () => panel.isOpen && panel.page === 'Scene';
panel.addTabs(PAGES);

// FPS: how many frames the demo actually drew last second. The bar is full at
// your screen's refresh rate (the most a browser will ever draw). While
// paused with nothing changing, nothing needs drawing, so it shows 0. On the
// Info page, at its top.
panel.startPage('Info');
const fpsDisplay = panel.addSlider('FPS', settings, 'fps', { min: 0, max: 60, step: 1, readOnly: true });
panel.startPage(null);

// ---- Presets: ready-made scenes (see presets.js) ------------------------------
// `keep`: settings to keep as they are instead (see restartPreset).
function applyPreset(name, keep = {}) {
  const preset = PRESETS[name];
  speedSamples = 0;   // (the speed histogram starts again)
  physics.newScene();   // (the old scene's last bounces stay silent)
  Object.assign(settings, PRESET_DEFAULTS, preset.settings, keep);
  graph.clear();   // (the Info graph starts again)
  camera.lookFromFront();
  if (preset.lookDown) {
    camera.polar = ((90 - preset.lookDown) * Math.PI) / 180;
    camera.update();
  }
  physics.room = settings.grid ? boxRoom() : screenRoom();   // before the balls are placed in it
  wantedTilt = settings.lampTilt;
  limitLampTilt();
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
  // HDR (the Copper demo turns it on): only where it can really be seen,
  // WebGPU drawing on a screen that shows HDR; elsewhere it quietly stays
  // off (no requester for a preset).
  const hdrVisible = renderer.isWebGpu && renderer.canShowHdr !== false && matchMedia('(dynamic-range: high)').matches;
  if (settings.hdrStrength > 0 && !hdrVisible) settings.hdrStrength = 0;
  hdrSlider?.refresh();
  syncHdr();
}

// Say on screen what time is doing, as a video recorder does (see #rewind
// in index.html): "◀◀ REWIND" blinking while it runs backwards ("❚◀ SLOW
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

const PIXEL_SIZE_MAX = 6;   // the biggest Pixel size

// Make everything follow `settings` after a preset changed several at once.
function applySettings() {
  physics.ballBounce = COLLISION_TYPES[settings.ballType];
  physics.wallBounce = COLLISION_TYPES[settings.wallType];
  physics.precise = PARTS[settings.digits];
  physics.trailSeconds = settings.trails;
  physics.clearTrails();
  physics.changed();
  camera.locked = !settings.grid;
  showCopper(settings.copper);
  scroller.setShown(settings.scroller);
  showPixels(settings.pixelSize);
  showTextGlow();
  showCredits(settings.credits);
  music.setTrack(settings.track);
  music.setPlaying(settings.music);
  for (const control of controls) control.refresh();
  needsRedraw = true;
}

const controls = [];   // everything applySettings() has to redraw
// The presets are not in the panel but in the preset bar, which is always
// on screen (top-left, below the speed bar). Restart (also the R key)
// starts the chosen preset again from its beginning. It keeps the Precision
// setting: choose a preset, set Precision, press R, and the whole scene runs
// with those digits.
const restartPreset = () => applyPreset(settings.preset, { digits: settings.digits });
controls.push(addPresetBar(document.body, settings, 'preset',
  Object.entries(PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
  (name) => applyPreset(name), restartPreset));

// If the box is too full for the number asked for, the slider shows how
// many balls actually fit.
// (The number is taken over after the physics' next step: see tookSnapshot.)
const showBallCount = () => {
  needsRedraw = true;
};
panel.startPage('Scene');
// A change to the balls or the room by hand (here, or a push, Energy,
// Gravity, another kind of bounce): running time backwards can no longer
// undo that, so the rewind test says so ("lost (by hand)"). (Its hidden twin
// first takes on the new balls, so that it stays a copy of the scene.)
function changedByHand() {
  rewindCheck.noticeNewBalls();
  rewindCheck.markChanged();
}
const ballSlider = panel.addSlider('Balls', settings, 'balls', {
  min: 1, max: MAX_BALLS, step: 1, log: true,
  onChange: (count) => { physics.setBallCount(count); showBallCount(); changedByHand(); },
});
// Size mix: 1.0 = all balls equal; 4.0 = the biggest ball is four times as
// wide as the smallest (from half to double the standard size).
// Ball size: 1.0 = the usual size; the Classic 1984 ball is 2.0.
controls.push(panel.addSlider('Ball size', settings, 'ballSize', {
  min: 0.25, max: 2.5, step: 0.05,
  onChange: (size) => { physics.setBallSize(size); showBallCount(); changedByHand(); },
}));
controls.push(ballSlider, panel.addSlider('Size mix', settings, 'sizes', {
  min: 1, max: 4, step: 0.1,
  onChange: (ratio) => { physics.setSizeMix(sizeMix(ratio)); showBallCount(); changedByHand(); },
}));
const ENERGY_SLIDER_MAX = 5;
const energySlider = panel.addSlider('Energy', settings, 'energy', {
  min: 0, max: ENERGY_SLIDER_MAX, step: 0.1,
  onChange: (value) => {
    physics.setTotalEnergy(value * physics.balls.length * ENERGY_UNIT, settings.gravity);
    rewindCheck.markChanged();
  },
});
const gravitySlider = panel.addSlider('Gravity', settings, 'gravity', { min: 0, max: 0.5, step: 0.01,
  onChange: () => rewindCheck.markChanged() });
controls.push(gravitySlider);

// Tilt (phones and tablets): gravity pulls the way the device is tilted, so
// the balls roll "downhill". The tilt sensor (the deviceorientation event)
// tells how the device is turned: beta is the tilt forwards and backwards,
// gamma the tilt to the side. Shown only on touch screens; off by default.
// (Some browsers, such as Safari on the iPhone, ask for permission first.)
const DOWN = new Vec3(0, -1, 0);
let tiltDown = null;      // which way is down, seen from the screen (x right, y up, z towards you)
let tiltSent = DOWN;      // the direction last given to the physics
function readTilt(e) {
  if (e.beta === null || e.gamma === null) return;
  const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
  // Down in the device's own directions (x to its right edge, y to its top
  // edge, z out of its screen)...
  const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
  // ...and turned with the screen, if it shows the picture sideways.
  const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
  tiltDown = new Vec3(dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a), dz);
}
// Every frame: down as seen from the screen, turned into the room's own
// directions (the camera may look from anywhere), for the physics.
function applyTilt() {
  let down = DOWN;
  if (settings.tilt && tiltDown) {
    const forward = camera.forward;
    let right = forward.cross(new Vec3(0, 1, 0));
    right = right.lengthSq() > 1e-9 ? right.normalize() : new Vec3(1, 0, 0);
    const up = right.cross(forward);
    down = right.scale(tiltDown.x).add(up.scale(tiltDown.y)).sub(forward.scale(tiltDown.z)).normalize();
  }
  if (down.sub(tiltSent).length() < 0.002) return;   // (no change worth passing on)
  tiltSent = down;
  physics.down = down;
  rewindCheck.markChanged();   // (no rewind can undo a turning gravity)
}
if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
  const tiltBox = panel.addCheckbox('Tilt', settings, 'tilt', async (on) => {
    if (!on) return;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' &&
          await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('not allowed');
    } catch {
      settings.tilt = false;
      tiltBox.refresh();
      showRequester('Tilt', ['Tilt needs permission to use the motion sensor.']);
      return;
    }
    addEventListener('deviceorientation', readTilt);
    if (settings.gravity === 0) { settings.gravity = 0.1; gravitySlider.refresh(); }   // (without gravity, tilting does nothing)
    setTimeout(() => {
      if (settings.tilt && !tiltDown) {
        settings.tilt = false;
        tiltBox.refresh();
        showRequester('Tilt', ['This device doesn\'t report how it is tilted.']);
      }
    }, 1500);
  });
  controls.push(tiltBox);
}
// The speed of time is not in the panel but in the speed bar, which is
// always on screen (top-left): below zero, time runs backwards.
let speedBeforePause = 1;    // the speed to carry on at after a pause
const setSpeed = (speed) => { settings.speed = speed; speedSlider.refresh(); };
const togglePause = () => {
  if (settings.speed !== 0) {
    speedBeforePause = settings.speed;
    setSpeed(0);
  } else {
    setSpeed(speedBeforePause || 1);
  }
};
const speedSlider = addSpeedBar(document.body, settings, 'speed', { min: -5, max: 5, step: 0.1 }, [
  ['<<', () => setSpeed(-1)],     // run backwards
  ['||', togglePause],            // pause, or carry on
  ['>', () => setSpeed(1)],       // run forwards
]);
controls.push(speedSlider);
// (The three buttons show the same solid symbols as the video-recorder text
// in the corner, drawn in the font's pixels: see vcrSymbol.)
// (So do the preset bar's previous and next buttons.)
const symbolButton = (button, symbol, name) => {
  button.replaceChildren(vcrSymbol(VCR_SYMBOLS[symbol]));
  button.setAttribute('aria-label', name);
  button.title = name;
};
[['◀◀', 'Rewind'], ['❚❚', 'Pause'], ['▶', 'Play']].forEach(([symbol, name], k) => {
  symbolButton(document.querySelectorAll('.speed-bar > button')[k], symbol, name);
});
{
  const [back, , forward] = document.querySelectorAll('.preset-bar > button');
  symbolButton(back, '◀', 'Previous preset');
  symbolButton(forward, '▶', 'Next preset');
}
fitVcrSymbols();
// While the Twist is full screen nothing of the scene can be seen, so the
// balls pause meanwhile (which also spares the computer): the animation runs
// at speed 0, whatever the Speed setting says, and carries on at that speed
// when the Twist comes back. (Also after a preset was chosen meanwhile.)
let twistFull = false;
twistOptions.onFullScreen = (on) => { twistFull = on; needsRedraw = true; };

// ---- Full screen ------------------------------------------------------------------
// The zoom gadget at the right end of the title bar (or the F key) puts the
// scene on the whole screen, without title bar or frame; again (or Escape)
// goes back to the window. Only where the browser can do that (not on
// iPhones). (body.fullscreen switches the look, see index.html.)
const fullScreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
const canFullScreen = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullScreen() {
  if (fullScreenElement()) {
    (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
  } else {
    const page = document.documentElement;
    (page.requestFullscreen ?? page.webkitRequestFullscreen).call(page)?.catch?.(() => {});
  }
}
if (canFullScreen) {
  const gadget = document.createElement('button');
  gadget.className = 'raised zoom-gadget';
  gadget.setAttribute('aria-label', 'Full screen');
  gadget.title = 'Full screen (F)';
  gadget.addEventListener('click', toggleFullScreen);
  document.querySelector('.app-bar').append(gadget);
}
function fullScreenChanged() {
  // (Only the page itself: the Twist window can be full screen on its own.)
  document.body.classList.toggle('fullscreen', fullScreenElement() === document.documentElement);
  resize();
}
document.addEventListener('fullscreenchange', fullScreenChanged);
document.addEventListener('webkitfullscreenchange', fullScreenChanged);

// How things bounce (explained in physics.js and in the About window).
const BOUNCE_CHOICES = [
  { value: 'rough', label: 'Rough' },     // (1, 1, 1)
  { value: 'garwin', label: 'Garwin' },   // (1, 1, -1)
  { value: 'smooth', label: 'Smooth' },   // (1, -1, -1)
  { value: 'twist', label: 'Twist' },     // (1, -1, 1)
];
controls.push(panel.addCycle('Ball hits', settings, 'ballType', BOUNCE_CHOICES,
  (type) => { physics.ballBounce = COLLISION_TYPES[type]; rewindCheck.markChanged(); }));
// Walls have one more choice, "1984": slippery, and the ball turns the
// other way after every bounce off a side wall, as in the original demo.
// (Not real physics: see COLLISION_TYPES.classic in physics.js.)
controls.push(panel.addCycle('Wall hits', settings, 'wallType',
  [...BOUNCE_CHOICES, { value: 'classic', label: '1984' }],
  (type) => { physics.wallBounce = COLLISION_TYPES[type]; rewindCheck.markChanged(); }));
// How many digits the physics computes with (see precise.js). More digits
// are slower, but running time backwards retraces the paths for longer.
// (For the whole scene to run with them, choose them and press R.)
const PARTS = { 16: 0, 32: 2, 64: 4 };   // ordinary numbers per precise number (0 = the usual physics)
// Named after the standard number sizes they come closest to: Double is
// the computer's ordinary 64-bit number (about 16 digits). Quadruple is
// two doubles together (a "double-double", about 32 digits; true 128-bit
// quadruple has 34) and Octuple four (a "quad-double", about 64 digits;
// true 256-bit octuple has 71).
controls.push(panel.addCycle('Precision', settings, 'digits',
  [{ value: 16, label: 'Double' }, { value: 32, label: 'Quadruple' }, { value: 64, label: 'Octuple' }],
  (digits) => {
    physics.precise = PARTS[digits];
    // From here on the scene runs with other digits: the rewind test (if on)
    // and the graph start again from this moment.
    if (rewindCheck.enabled) rewindCheck.setEnabled(true);
    graph.clear();
    showRewindTest();
  }));

panel.startPage('Sound');
// The boings, their loudness, and whether walls boing too.
controls.push(panel.addCheckbox('Boings', settings, 'sound'));
sounds.volume = settings.soundVolume;
panel.addSlider('Boing vol', settings, 'soundVolume', {
  min: 0, max: 1, step: 0.05,
  onChange: (volume) => { sounds.volume = volume; },
});
controls.push(panel.addCheckbox('Wall sound', settings, 'wallSound'));
// The chiptune (see music.js) and its loudness.
const music = new Music(sounds);
music.setVolume(settings.musicVolume);
controls.push(panel.addCheckbox('Music', settings, 'music', (on) => music.setPlaying(on)));
controls.push(panel.addCycle('Track', settings, 'track',
  Object.entries(TRACKS).map(([value, track]) => ({ value, label: track.name })),
  (name) => music.setTrack(name)));
panel.addSlider('Music vol', settings, 'musicVolume', {
  min: 0, max: 1, step: 0.05,
  onChange: (volume) => music.setVolume(volume),
});

panel.startPage('Look');
// Trails: a fading line behind every ball, showing where it has been
// during the last so many seconds. 0 = no trails.
controls.push(panel.addSlider('Trails', settings, 'trails', {
  min: 0, max: 10, step: 0.5,
  onChange: (seconds) => {
    physics.trailSeconds = seconds;
    if (seconds === 0) physics.clearTrails();
    needsRedraw = true;
  },
}));
// Copper bars as the backdrop.
function showCopper(on) {
  document.body.classList.toggle('copper', on);   // (white credit text over the dark bars)
  needsRedraw = true;
}
// (One button for both settings: None, or one of the backdrops.)
const backdropChoice = {
  get kind() { return settings.copper ? settings.backdrop : 'none'; },
  set kind(kind) {
    settings.copper = kind !== 'none';
    if (settings.copper) settings.backdrop = kind;
  },
};
controls.push(panel.addCycle('Backdrop', backdropChoice, 'kind',
  [{ value: 'none', label: 'None' }, { value: 'bars', label: 'Copper' }, { value: 'stars', label: 'Stars' }, { value: 'plasma', label: 'Plasma' },
   { value: 'kefrens', label: 'Kefrens' }],
  () => showCopper(settings.copper)));
// The other demo classic: a scrolling text along the bottom (see scroller.js).
const scroller = new Scroller();
controls.push(panel.addCheckbox('Scroller', settings, 'scroller', (on) => { scroller.setShown(on); showTextGlow(); }));
// The credit line at the very bottom. (The scroller's text starts with it,
// so it isn't lost when switched off here.)
function showCredits(on) {
  document.getElementById('info').style.display = on ? '' : 'none';
}
controls.push(panel.addCheckbox('Credits', settings, 'credits', showCredits));
// ---- The room -------------------------------------------------------------------
// With the grid on, the balls live in the box. With it off, the window
// itself is the room: seen from the starting view, the balls bounce off the
// left, right and top edges of the window, whatever its shape. Those three
// walls are slanted, because things further away look smaller: each one
// runs from the camera's eye along the edge of what it sees. The floor
// stays level (at the height where the window's bottom edge meets the front
// of the room), and front and back are where the box's were.
//
// The room is fixed in the world: you can still turn and zoom the camera,
// and then you see it from another angle.
function screenRoom() {
  const eyeDistance = OrbitCamera.START_DISTANCE;
  const depth = BOX_HALF_SIZE;   // front and back walls at z = ±6
  const near = camera.frontViewAt(eyeDistance - depth);   // what is seen at the front wall
  const far = camera.frontViewAt(eyeDistance + depth);    // ... and at the back wall

  // A wall through the eye (at z = eyeDistance) that leans outwards by
  // `slope` units for every unit away from the camera.
  const slanted = (x, y, slope) => {
    const normal = new Vec3(x, y, slope).normalize();
    return { normal, offset: normal.z * eyeDistance };
  };
  const sideSlope = near.halfWidth / (eyeDistance - depth);
  const topSlope = near.halfHeight / (eyeDistance - depth);

  return {
    walls: [
      { normal: new Vec3(0, -1, 0), offset: near.halfHeight },   // floor
      slanted(0, 1, topSlope),                                   // top edge of the window
      slanted(-1, 0, sideSlope),                                 // left edge
      slanted(1, 0, sideSlope),                                  // right edge
      { normal: new Vec3(0, 0, -1), offset: depth },             // back
      { normal: new Vec3(0, 0, 1), offset: depth },              // front
    ],
    floorY: -near.halfHeight,
    min: new Vec3(-far.halfWidth, -near.halfHeight, -depth),
    max: new Vec3(far.halfWidth, far.halfHeight, depth),
  };
}

// What the renderer needs to know about the room: where the floor and the
// lamp are, and how far sideways and how high the balls can get.
// (One object, filled in afresh each time: it is asked for every frame.)
const stageNow = {};
function stage() {
  const room = physics.room, s = stageNow;
  s.floorY = room.floorY;
  s.lightHeight = settings.lamp;
  s.lightTilt = settings.lampTilt;
  s.reach = Math.max(room.max.x, room.max.z);
  s.top = room.max.y;
  s.windowRoom = !settings.grid;   // (the lamp then can't tilt all the way: see maxLampTilt)
  return s;
}

// The Lamp tilt slider only goes as far as the lamp may tilt in this room
// (all the way in the box; less with the grid off, see maxLampTilt).
// The tilt you chose comes back when the limit is lifted again.
let tiltSlider = null;
let wantedTilt = 0;
function limitLampTilt() {
  const most = maxLampTilt(stage());
  settings.lampTilt = Math.min(wantedTilt, most);
  if (!tiltSlider) return;
  tiltSlider.setMax(most);
  tiltSlider.refresh();
}

function applyRoom() {
  const size = (room) => room ? JSON.stringify([room.min, room.max,
    room.walls.map((w) => [w.normal.x, w.normal.y, w.normal.z, w.offset])]) : '';
  const before = size(physics.room);
  physics.setRoom(settings.grid ? boxRoom() : screenRoom());
  showBallCount();   // balls that no longer fit were removed
  limitLampTilt();
  // (A resize that leaves the room as it was changes nothing for the balls.)
  if (size(physics.room) !== before) changedByHand();
}

controls.push(panel.addCheckbox('Shadows', settings, 'shadows', () => { needsRedraw = true; }));
// Pixel size: 1 = as sharp as your screen allows. Anything more draws the
// scene the way an old computer would have: in big square pixels of that
// size, with hard edges and 4096 colours (see renderer.js). Around 3 gives
// about as many lines as an Amiga screen had.
function showPixels(size) {
  renderer.pixelSize = size;
  resize();
}
const pixelSlider = panel.addSlider('Pixel size', settings, 'pixelSize', {
  min: 1, max: PIXEL_SIZE_MAX, step: 0.5,
  onChange: (size) => { showPixels(size); },
});
controls.push(pixelSlider);
// At most this many pictures a second (Max FPS): fewer on a fast screen
// (240 or 480 Hz) saves a lot of energy. A picture is drawn on every 2nd,
// 3rd, 4th ... refresh, so the motion stays even (see frame): the choices
// are therefore the screen's own rate divided by a whole number, never
// below 30 (on a 144 Hz screen 72, 48 and 36; on a 60 Hz one only 30).
// They are made anew when the screen's rate is known (see showCounts).
const fpsChoices = [{ value: 1, label: 'Screen' }];
const fpsCycle = panel.addCycle('Max FPS', settings, 'fpsEvery', fpsChoices, (every) => { recentGaps.length = 0; twistOptions.fpsEvery = every; });
controls.push(fpsCycle);
let fpsChoicesFor = 0;
function offerFpsChoices(rate) {
  if (rate === fpsChoicesFor) return;
  fpsChoicesFor = rate;
  fpsChoices.length = 1;
  for (const every of [2, 3, 4, 6, 8]) {
    if (rate / every >= 30) fpsChoices.push({ value: every, label: String(Math.round(rate / every)) });
  }
  if (!fpsChoices.some((choice) => choice.value === settings.fpsEvery)) settings.fpsEvery = 1;
  twistOptions.fpsEvery = settings.fpsEvery;   // (the effect windows draw as often)
  fpsCycle.refresh();
}
// Wide colour: the canvas is Display P3 wherever the browser can. Every
// colour still looks exactly as in sRGB, except the balls' four NCS
// elementary colours: on a wide-colour screen, as most phones and Macs
// have, they come out truer than sRGB can show (see ELEMENTARY_IN_P3 in
// renderer.js).
renderer.setWideColor(true);

// Glints: a shiny spot on each ball where it mirrors the lamp (not in
// shadow). 0 = none, as in the original; 1 = white; 0.5 to begin with. With HDR on, the spot
// shines brighter than white (see GLINT in renderer.js).
controls.push(panel.addSlider('Glints', settings, 'glints', {
  min: 0, max: 1, step: 0.1,
  onChange: () => { needsRedraw = true; },
}));

// ---- Light brighter than white --------------------------------------------
// HDR: on an HDR screen, light brighter than white really shines (needs
// WebGPU: see gpu-renderer.js). The slider says how
// bright that light gets: 0 = none (and no WebGPU at all), 1 = the full
// design. Above 0, everything that can shine does: the copper bars'
// highlights, the glints (if Glints is on), the scroller's letters and the
// Twist's highlight (see the top of renderer.js).
const hdrOn = () => Boolean(renderer.hdr);
let hdrSlider = null;
function hdrChanged() {
  twistOptions.hdr = hdrOn();
  twistOptions.strength = settings.hdrStrength;
  showTextGlow();
  needsRedraw = true;
}
// Start or stop HDR to match the slider. (Starting takes a moment; if the
// slider moves meanwhile, it catches up afterwards.)
let hdrBusy = false, hdrWarned = false;
async function syncHdr() {
  hdrChanged();
  const wanted = settings.hdrStrength > 0;
  if (hdrBusy || wanted === hdrOn()) return;
  hdrBusy = true;
  const message = await setHdr(wanted);
  hdrBusy = false;
  if (wanted && !renderer.hdr) {   // it didn't work out
    settings.hdrStrength = 0;
    hdrSlider.refresh();
    showRequester('HDR', [message]);
  } else if (wanted && !renderer.hdr.screenIsHdr && !hdrWarned) {
    hdrWarned = true;
    showRequester('HDR', [
      'HDR is on, but this screen says it can\'t show HDR, so everything brighter than white still looks white. ' +
      'On a Mac or in Windows, HDR may have to be switched on in the display settings.']);
  }
  syncHdr();
}
if (navigator.gpu) {
  hdrSlider = panel.addSlider('HDR', settings, 'hdrStrength', {
    min: 0, max: 2, step: 0.1,
    onChange: syncHdr,
  });
  controls.push(hdrSlider);
}
// The HDR slider is only there while WebGPU draws, in a browser whose canvas
// can go brighter than white: with WebGL there is no HDR (see setHdr).
function showHdrControl() {
  hdrSlider?.row.classList.toggle('unavailable', !renderer.isWebGpu || renderer.canShowHdr === false);
}
showHdrControl();

// The lamp's usual height: 21 over the box, as always. Over the much wider
// window-sized room it hangs higher, so that the shadows stay close to
// under the balls.
const LAMP_OVER_BOX = 21;
const LAMP_OVER_WINDOW = 45;

// "In a box": with the grid you also get the camera you can turn; without
// it, the window is the room and the camera stays put.
function showGrid(on) {
  // The window-sized room is made for the starting view, so the camera
  // goes back there and stays put while the grid is off — and Auto cam,
  // which needs a camera that can move, goes off with it.
  if (!on) {
    camera.lookFromFront();
    settings.autoCamera = false;
    autoCamBox.refresh();
  }
  camera.locked = !on;
  // The lamp moves to its usual distance for the new room, unless you have
  // moved it yourself: then it stays where you put it.
  const [usualBefore, usualNow] = on ? [LAMP_OVER_WINDOW, LAMP_OVER_BOX] : [LAMP_OVER_BOX, LAMP_OVER_WINDOW];
  if (settings.lamp === usualBefore) settings.lamp = usualNow;
  lampSlider.refresh();
  applyRoom();
}
const gridBox = panel.addCheckbox('In a box', settings, 'grid', showGrid);
// Auto cam: the camera moves by itself, in the way chosen: Off, Round (all
// the way round the box), Swing (side to side in front, never round the
// back: for scenes whose shadows fall on the back wall) or Rise (round, and
// up to look down from above and back). Presets that start with it on pick
// their own way. It only works with the box (and its movable camera), so
// switching it on switches that on too.
const autoCamChoice = {
  get way() { return settings.autoCamera ? settings.camMove : 'off'; },
  set way(way) {
    settings.autoCamera = way !== 'off';
    if (way !== 'off') settings.camMove = way;
  },
};
const autoCamBox = panel.addCycle('Auto cam', autoCamChoice, 'way', [
  { value: 'off', label: 'Off' }, { value: 'orbit', label: 'Round' }, { value: 'swing', label: 'Swing' }, { value: 'rise', label: 'Rise' },
], (way) => {
  if (way !== 'off' && !settings.grid) {
    settings.grid = true;
    gridBox.refresh();
    showGrid(true);
  }
});
controls.push(gridBox, autoCamBox);
// The lamp. "Lamp dist" is how far away it is: a near lamp throws long,
// spreading shadows, a far one keeps them the size of the balls. (It never
// comes closer than a little outside the room.) "Lamp tilt" swings it from
// straight above (0°: shadows on the floor) to right in front (90°: shadows
// on the back wall, as in the original demo).
const lampSlider = panel.addSlider('Lamp dist', settings, 'lamp', {
  min: 10, max: 80, step: 1,
  onChange: () => { needsRedraw = true; limitLampTilt(); },
});
controls.push(lampSlider);
tiltSlider = panel.addSlider('Lamp tilt', settings, 'lampTilt', {
  min: 0, max: 90, step: 1,
  onChange: () => { needsRedraw = true; wantedTilt = settings.lampTilt; },
});
controls.push(tiltSlider);
wantedTilt = settings.lampTilt;
limitLampTilt();

// ---- The Info page ---------------------------------------------------------------
// First the conservation laws at work, updated a few times a second.
panel.startPage('Info');
const physicsInfo = {
  energy: panel.addReadout('Energy'),        // all energy, in "classic starts"
  momentum: panel.addReadout('Momentum'),    // size of the total momentum
  angular: panel.addReadout('Ang. mom.'),    // size of the total angular momentum
};

// The rewind test: runs a slightly nudged copy of the scene alongside (see
// rewindcheck.js) and shows, as it goes, how far from the start a rewind
// would bring the balls, in ball radii: "ok", "drift" (it will visibly miss)
// or "lost" (it can no longer find its way back). Switching it on starts it
// afresh, measuring how well a rewind would get back to that moment, and
// starts the graph again; Restart measures from the start of the preset.
const rewindTest = panel.addCheckbox('Rewind test', settings, 'rewindEstimate', (on) => {
  rewindCheck.setEnabled(on);
  if (on) graph.clear();
  showRewindTest();
  if (on) graph.draw();
});
controls.push(rewindTest);
const rewindTestRow = rewindTest.row;
// (Its result in the same row, beside the box, and only while it runs.)
const rewindReadout = panel.addReadout('Rewind');
rewindReadout.row.remove();
rewindTestRow.append(rewindReadout.box);
rewindReadout.box.style.marginLeft = '3px';

// A small graph on the Info page. It keeps its last `samples` values of a
// few lines, taken only while the Info page is shown, and draws them from
// left (oldest) to right (newest).
//   lines:   [{ color, y }], y(value) giving 0 (bottom) … 1 (top); a value
//            of null leaves a gap
//   guides:  heights (0 … 1) of dotted lines
//   key:     [[name, color]]: what the lines are, top right, one under the other
function addGraph(samples, { lines, guides = [], key = [] }) {
  const row = panel.addRow('');
  row.classList.add('panel-graph');
  row.firstChild.remove();   // (no label: the graph takes the whole row)
  const canvas = document.createElement('canvas');
  canvas.className = 'sunken';
  row.append(canvas);
  const values = lines.map(() => []);
  return {
    row,
    clear() { for (const list of values) list.length = 0; },
    sample(...now) {
      now.forEach((v, k) => values[k].push(v));
      if (values[0].length > samples) for (const list of values) list.shift();
    },
    draw() {
      const ratio = Math.min(2, devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
      const g = canvas.getContext('2d', { colorSpace: 'display-p3' });   // wide colour
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, w, h);
      const x = (i) => (i / (samples - 1)) * (w - 2) + 1;
      const y = (fraction) => h - 1 - Math.max(0, Math.min(1, fraction)) * (h - 2);
      g.strokeStyle = wide('#555555'); g.setLineDash([2, 3]); g.lineWidth = 1;
      for (const f of guides) {
        g.beginPath(); g.moveTo(0, y(f)); g.lineTo(w, y(f)); g.stroke();
      }
      g.setLineDash([]);
      lines.forEach((line, k) => {
        g.strokeStyle = wide(line.color); g.lineWidth = 1.5; g.beginPath();
        let started = false;
        values[k].forEach((v, i) => {
          const f = v === null ? null : line.y(v);
          if (f === null) { started = false; return; }
          if (started) g.lineTo(x(i), y(f)); else g.moveTo(x(i), y(f));
          started = true;
        });
        g.stroke();
      });
      g.font = '8px Amiga, monospace'; g.textBaseline = 'top';
      key.forEach(([name, color], k) => {
        g.fillStyle = wide(color);
        g.fillText(name, w - 4 - g.measureText(name).width, 3 + 9 * k);
      });
    },
  };
}

// The rewind test's graph, shown only while the test runs: the last 20
// seconds or so of how far a rewind would miss (on a logarithmic scale from
// 1e-16 at the bottom to 1e+4 ball radii at the top; the dotted line is 1,
// where a rewind is lost). Sampled a few times a second; started again with
// every preset.
const logMiss = (e) => (Math.log10(Math.max(1e-16, Math.min(1e4, e))) + 16) / 20;
const graph = addGraph(160, {
  lines: [{ color: '#ff8800', y: logMiss }],
  guides: [logMiss(1)],
  key: [['Rewind miss', '#ff8800']],
});
graph.row.classList.add('switched-off');   // (until the test runs: see showRewindTest)
let rewindShown = '';
function showRewindTest() {
  let text = 'off', look = '';
  if (rewindCheck.enabled) {
    const estimate = rewindCheck.estimate();
    if (rewindCheck.changedByHand) { text = 'lost'; look = 'lost'; }
    else if (estimate >= LOST) { text = 'lost'; look = 'lost'; }
    // (Only the number: the colour tells drift from ok, and the row is narrow.)
    else if (estimate >= DRIFTING) { text = estimate.toExponential(0); look = 'drifting'; }
    else { text = estimate.toExponential(0); }
  }
  if (text + look === rewindShown) return;   // (only touch the page when it changes)
  rewindShown = text + look;
  rewindReadout.set(text);
  rewindReadout.box.className = `readout sunken ${look}`;
  rewindReadout.box.style.visibility = rewindCheck.enabled ? '' : 'hidden';
  graph.row.classList.toggle('switched-off', !rewindCheck.enabled);
}

// The totals:
//  - Energy only changes when you click a ball or move
//    Energy or Gravity.
//  - Momentum and angular momentum are passed between balls when they hit
//    each other but never lost; only the walls and gravity change the totals.
function showTotals() {
  physicsInfo.energy.set((physics.totalEnergy(settings.gravity) / ENERGY_UNIT).toFixed(4));
  physicsInfo.momentum.set(physics.totalMomentum().length().toFixed(3));
  physicsInfo.angular.set(physics.totalAngularMomentum().length().toFixed(3));
}

// The speeds of the balls, as bars, and in red the curve they settle to
// after enough collisions: the Maxwell–Boltzmann distribution, which
// James Clerk Maxwell worked out in 1860 for the molecules of a gas. (See
// speedHistogram in physics-host.js: the speeds are measured against the
// typical one, the root mean square.) Start Gas: every ball starts at the
// same speed, a single spike, and within a few seconds of collisions the
// bars spread out into the curve. Beside each blue bar a green one: how
// fast the balls spin, which (but with Smooth bounces, which never change a
// spin) settles into the same curve, as Gas shows, its balls starting
// without any spin at all. Averaged over the last few seconds, so it
// settles even with few balls.
// A graph row of its own on the Info page (as addGraph's): returns a
// function that gets the canvas ready and gives its 2D drawing, width and
// height (in CSS pixels), or null while it can't be seen.
function addCanvasRow() {
  const row = panel.addRow('');
  row.classList.add('panel-graph');
  row.firstChild.remove();
  const canvas = document.createElement('canvas');
  canvas.className = 'sunken';
  row.append(canvas);
  return () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    }
    const g = canvas.getContext('2d', { colorSpace: 'display-p3' });
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '8px Amiga, monospace'; g.textBaseline = 'top';
    return { g, w, h };
  };
}
const speedCanvas = addCanvasRow();
const speedAverage = new Float64Array(SPEED_BARS), spinAverage = new Float64Array(SPEED_BARS);
let speedSamples = 0;
// The curve: with u the speed ÷ the typical speed, f(u) = 3√6/√π u² e^(−3u²/2).
const maxwell = (u) => (3 * Math.sqrt(6) / Math.sqrt(Math.PI)) * u * u * Math.exp(-1.5 * u * u);
function sampleSpeeds() {
  const bars = physics.speeds;
  if (!bars) return;
  const keep = speedSamples < 12 ? speedSamples / (speedSamples + 1) : 0.92;   // (quick at first, then a few seconds' memory)
  const spins = physics.spins;
  for (let k = 0; k < SPEED_BARS; k++) {
    speedAverage[k] = keep * speedAverage[k] + (1 - keep) * bars[k];
    spinAverage[k] = keep * spinAverage[k] + (1 - keep) * (spins ? spins[k] : 0);
  }
  speedSamples++;
}
function drawSpeeds() {
  const c = speedCanvas();
  if (!c) return;
  const { g, w, h } = c;
  const TOP = 1.25;   // (the curve's peak is at about 1.02: room above it)
  const x = (u) => 1 + (u / SPEED_RANGE) * (w - 2);
  const y = (f) => h - 1 - Math.min(1, f / TOP) * (h - 4);
  const barWidth = SPEED_RANGE / SPEED_BARS;
  // (Each stretch of speeds: the flight's bar on the left, the spin's on the right.)
  for (const [averages, color, side] of [[speedAverage, '#0087bd', 0], [spinAverage, '#009f6b', 1]]) {
    g.fillStyle = wide(color);
    for (let k = 0; k < SPEED_BARS; k++) {
      const left = x(k * barWidth), half = (x((k + 1) * barWidth) - left) / 2, top = y(averages[k]);
      g.fillRect(left + side * half + 0.5, top, half - 0.5, h - 1 - top);
    }
  }
  g.strokeStyle = wide('#c40233'); g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i <= 120; i++) {
    const u = (i / 120) * SPEED_RANGE;
    if (i === 0) g.moveTo(x(u), y(maxwell(u))); else g.lineTo(x(u), y(maxwell(u)));
  }
  g.stroke();
  // (The key, top right: the curve, then the two kinds of bar under it.)
  [['Maxwell', '#c40233'], ['Speed', '#0087bd'], ['Spin', '#009f6b']].forEach(([name, color], k) => {
    g.fillStyle = wide(color);
    g.fillText(name, w - 4 - g.measureText(name).width, 3 + 9 * k);
  });
}

// Then the numbers for this computer, updated once a second. (Only what
// differs from one visitor to the next and shows nowhere else; what the
// demo always does is told in the About window.)
const details = {
  screen: panel.addReadout('Screen'),      // the pixels drawn, and its refresh rate (the FPS bar is full at it)
  colours: panel.addReadout('Colours'),    // wide colour (Display P3) where the screen has it, else sRGB; and HDR
  drawnWith: panel.addReadout('Drawn with'), // WebGPU, or WebGL where there's none (see gpu-renderer.js)
  physics: panel.addReadout('Physics'),    // time spent moving the balls, per frame
  graphics: panel.addReadout('Graphics'),  // graphics card time per drawn frame
  hits: panel.addReadout('Hits/s'),        // ball-on-ball collisions per second
  // Dropped frames: frames that came late, more than 1.5 times the usual
  // time after the one before, so one picture stayed on screen twice and the
  // motion jerked. (The FPS above can still say 60 then: it counts a whole
  // second.)
  late: panel.addReadout('Dropped'),
};
// (The Screen line holds more than the others: its name takes less room.)
details.screen.row.querySelector('.panel-label').style.width = '64px';
const wideColourScreen = () => renderer.wideColor && matchMedia('(color-gamut: p3)').matches;
// The late frames of the last two minutes, one bar a second, counted all the
// time (also with the Controls closed), so any stutter shows up afterwards:
// nothing at the bottom line means none; one late frame already makes a
// clear spike, and the height grows (logarithmically) up to a whole second
// of them.
// In blue, the same way: frames in which the balls didn't move evenly
// although the frame came on time — a repeat (the physics had no new step
// ready, so the balls stood still for a frame) or a jump (finished steps had
// piled up, and the balls leapt ahead to catch up). See physics-client.js.
let infoWasShown = false;
let lateInAll = 0;   // since the page was opened
const spike = (count) => (count === 0 ? 0 : 0.3 + 0.7 * Math.min(1, Math.log(count) / Math.log(60)));
const lateGraph = addGraph(120, {
  lines: [{ color: '#0055aa', y: spike }, { color: '#c40233', y: spike }],
  key: [['Dropped', '#c40233'], ['Uneven', '#0055aa']],
});

// Below the pages, always shown: the two windows.
panel.startPage(null);
panel.showPage(PAGES[0]);

// ---- Keyboard shortcuts ----------------------------------------------------------
//   Space   pause, and carry on at the speed it had
//   Escape  close the window in front
//   1 … 9, 0  the presets (0 would be a tenth)
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave the browser's own shortcuts alone
  const presetNames = Object.keys(PRESETS);
  if (e.code === 'Space') {
    // (Stops the page scrolling. Space would also press whichever button
    // was clicked last, so that is stopped too, on keyup below.)
    e.preventDefault();
    if (e.repeat) return;
    togglePause();
  } else if (e.key === 'Escape') {
    if (document.fullscreenElement ?? document.webkitFullscreenElement) return;   // (that Escape only leaves full screen)
    closeFrontWindow();
  } else if (e.code === 'KeyF' && !e.repeat) {
    if (canFullScreen) toggleFullScreen();
  } else if (e.code === 'KeyG' && !e.repeat) {
    showGuru(['Software Failure.   Press left mouse button to continue.', 'Guru Meditation #00000004.0000AAC0']);
  } else if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    restartPreset();
  } else if (e.key >= '0' && e.key <= '9' && !e.repeat) {
    const name = presetNames[(Number(e.key) + 9) % 10];   // keys 1 … 9, then 0
    if (name) {
      settings.preset = name;
      applyPreset(name);
    }
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') e.preventDefault(); });

// ---- Demo classics, each in a window of its own ----------------------------------
// The Twist (see twist.js) and the others (see effects.js): small buttons on
// one row, each named short (its window's title as the tooltip).
panel.addButtons([['Twist', openTwistWindow, 'Twist v4'],
  ...EFFECTS.map((effect) => [effect.short ?? effect.label, effect.open, effect.label])]);

// ---- About ---------------------------------------------------------------------
// The version (as in index.html), from this script's own address (main.js?v=…).
const VERSION = new URL(import.meta.url).searchParams.get('v') ?? 'unknown';
let aboutIsOpen = false;
panel.addButton('About...', () => {
  if (aboutIsOpen) return;   // one is enough
  aboutIsOpen = true;
  showRequester(`About Amiga Boing Balls (version ${VERSION})`, [
    { name: 'Amiga', paragraphs: [
      '# The Boing Ball',
      'The Boing Ball was the star of the Amiga\'s first public showing, at the Consumer Electronics Show in ' +
      'Las Vegas in January 1984. The computer, code-named Lorraine, was still a prototype: its custom chips ' +
      'were racks of hand-wired circuit boards, and its operating system was not ready. So the team showed a ' +
      'demo instead: a big red-and-white checkered ball, spinning, bouncing and booming in stereo, with a ' +
      'shadow on the wall behind it. Few people had seen a home computer do anything like it.',
      'The ball was drawn only once. It spun by colour cycling, rotating the 14 red and white colours it was ' +
      'painted in, and moved by scrolling the picture, so the processor had almost nothing to do. A later ' +
      'version ran on a screen of its own: drag the Workbench screen down, and the ball was still bouncing ' +
      'behind it.',
      'Legend has it that Dale Luck and R. J. Mical wrote it in a single night during the show, that the ' +
      'first version only bounced up and down, and that the two fell asleep on the floor of the booth with it ' +
      'running, so that the morning staff were the first to see it.',
      'More legends: the ball was so fast and smooth that visitors did not believe the prototype was drawing ' +
      'it, and looked around the booth for a hidden computer or video player. The deep, echoing boing and ' +
      'the bouncing from side to side were added only after the show. And the boing itself is said to be ' +
      'Bob Pariseau hitting an aluminium garage door with a foam bat, recorded from inside the garage with ' +
      'an Apple II; every boing in the demo is that one sound, played faster or slower, louder or softer. ' +
      'The team wanted the ball as the Amiga\'s logo, and dozens of Boing Ball logos were made for the ' +
      'launch, but Commodore chose its checkmark instead. The stories vary with the teller, but the ball ' +
      'became the symbol of the Amiga anyway. Pick the preset "Classic 1984" for a reminder.',
      '# Demo classics',
      'The twister is a demo classic. Twist v4 is a nod to Twist v3, a red-and-white checkered twister ' +
      'in Christophe R\u00e9sign\u00e9\'s Amiga Workbench for the browser (Chipbench, 2009), which also ' +
      'inspired this demo\'s windows.',
      'More effects from the Amiga demo scene, each in a window of its own like the Twist, in the ' +
      'balls\' colours. Vector Bobs: "bobs" were the blitter\'s moving objects, and here a few hundred small ' +
      'balls fly together into a cube, then a sphere, and back (a wider window has room for more). ' +
      'Tunnel: a rollercoaster ride through a tube lined with the Boing checker, on a track made up at random as it ' +
      'goes: turns, hills, loops and corkscrews. And one more is a backdrop: Kefrens bars, a single bar drawn once per screen ' +
      'line and never wiped, so the bars pile up into a weaving curtain, named after the demo group Kefrens.',
      'The other backdrops are classics too. Copper bars come from the Amiga\'s Copper, a little co-processor ' +
      'that follows the picture as it is sent to the screen and can change a colour on any line; so bands of ' +
      'colour cost the main processor nothing, and demos piled them up into shining bars. The starfield, layers ' +
      'of stars gliding past at different speeds so the near ones seem closer, opened countless intros. And ' +
      'the plasma is a few waves of colour added together for every pixel, an endlessly flowing pattern that ' +
      'every demo coder of the day had to write once.',
      '# Why 2.04?',
      'Release 2.04 of the Amiga\'s operating system (Kickstart 37.175, autumn 1991) was the first version 2 ' +
      'that most Amiga owners got, built into the Amiga 500 Plus. It brought the grey, 3D-shaded Workbench ' +
      'look that this demo\'s windows and gadgets imitate.',
      '# The Guru Meditation',
      'When an Amiga crashed, a blinking red box said "Guru Meditation" and gave a number. The name is an ' +
      'in-house joke from the Amiga company\'s early days, when it also made a board to stand or sit on, the ' +
      'Joyboard, for games on the Atari 2600. When the prototypes crashed yet again, the developers sat ' +
      'cross-legged on a Joyboard and tried to keep perfectly still, like a meditating guru; move, and you had ' +
      'lost. Here the close gadget, and the G key, give you one.',
      '# Thanks',
      'To my uncle Andreas Abelsson, alias King Grub, who introduced me to the Amiga, and who had endless ' +
      'patience with me, a brat in the Bart Simpson mould. To my parents, who bought me computers when I was ' +
      'a child. To my six children, who always thought my demos were cool. And to my wonderful wife, for her ' +
      'love.',
    ] },
    { name: 'This demo', paragraphs: [
      '# Balls in a box',
      'Up to 4000 balls in a box. Every ball is a perfect sphere, worked out for each pixel it covers. The balls ' +
      'are hollow shells, they spin, and every collision happens at exactly the right moment and place.',
      '# Running time backwards',
      'Because every collision is exact, time can also run backwards (the << button, or Speed below zero). ' +
      'While it does, "<< REWIND" blinks in the corner. It cannot stay perfect forever: bouncing balls are ' +
      'chaotic, and every collision makes the computer\'s rounding errors (in the 16th digit) several times ' +
      'bigger. After some twenty collisions per ball the balls are on a different path.',
      'Precision on the Scene page sets how precise the physics\' numbers are: Double (the computer\'s usual ' +
      '64-bit numbers, about 16 digits), Quadruple (about 32 digits) or Octuple (about 64 digits). The last two ' +
      'are made of two and four ordinary numbers working together, almost as precise as true 128-bit and ' +
      '256-bit numbers. More precise is slower, but the rewind lasts much longer: the Gas preset puts ' +
      'itself together again from about 4 seconds with Double, 12 with Quadruple and over 30 with Octuple. (Press R after changing it, so the whole scene runs with the new precision.) Rewind test, on the Info page, runs a slightly nudged ' +
      'copy of the scene alongside and shows as it goes how close to the start running backwards would bring ' +
      'the balls, in ball sizes, beside its box: white is fine, yellow means a rewind would visibly miss, and ' +
      '"lost" in red that it can no longer find its way back (also after any change by hand, from a push to ' +
      'a slider on the Scene page). It only runs while the Controls are open. Switching it on, opening the Controls ' +
      'again, or changing Precision starts it afresh from that moment, ' +
      'and Restart measures from the start of the preset.',
      '# The presets',
      'The first four are showpieces: Four balls, Classic 1984, Carousel and Copper demo. The rest are little ' +
      'physics experiments. Under table: throw a super ball under a table and it comes back, because the first ' +
      'bounce makes it spin and the spin throws it backwards at the second. Break shot: billiards in mid-air, ' +
      'a yellow ball fired into a triangle of fifteen. Press << once they are well mixed, and watch the triangle ' +
      'put itself together again. Gas: a thousand tiny balls packed in a corner, without spin, spreading out to ' +
      'fill the box; watch the speeds on the Info page spread out into Maxwell\'s curve. Press << after a few seconds to see ' +
      'them pack themselves back into the corner. Stacked drop: a small ball resting on a big one, dropped ' +
      'together; the big one bounces first and throws the small one about eight times as high as it fell. ' +
      'Cradle: Newton\'s cradle without strings; each hit passes all the motion on down the row, and the ' +
      'walls send it back, for ever. Rain: balls let go near the ceiling; as no energy is lost they never ' +
      'settle, and end up as a little atmosphere, thickest at the bottom. Brownian: one big ball among five ' +
      'hundred tiny ones, nudged about at random by their hits, as pollen in water is by molecules (Einstein ' +
      'explained it in 1905). (Keys 1 to 9 and 0 choose the first ten presets.)',
      '# The sound',
      'The boings are recordings from the original 1984 demo, restored: the two stereo channels lined up, ' +
      'rumble and hiss removed, and a gentle lift around 2 kHz so that they carry on small speakers. Each ' +
      'boing comes from the side of the screen where the bounce happens, and the harder the hit, the louder ' +
      'it is; clicking a ball plays the demo\'s other boing. The four chiptunes on the Sound page are not ' +
      'recordings: they are made from scratch in code, note by note.',
      '# Made to run for days',
      'The demo is meant to be left running, for hours or days. The clocks that drive the backdrops and the ' +
      'effect windows go round every ten and a half minutes and start again, so their numbers never grow, and ' +
      'nothing slowly drifts, judders or loses precision, however long it runs. The screen is kept awake ' +
      'meanwhile. The effect windows only draw while they can be seen, and at the rate Max FPS sets, so many ' +
      'open windows cost little, and the physics only works while the balls move.',
      '# The colours',
      'The four ball colours are the elementary colours of the Natural Color System (NCS), a Swedish ' +
      'colour standard built on how we see colour. In sRGB, the colours of the web, they are red #C40233, ' +
      'yellow #FFD300, green #009F6B and blue #0087BD. In NCS notation they are S 1080-R, S 0580-Y, ' +
      'S 2060-G and S 2060-B: S for the standard, then how black and how colourful the sample is, in per ' +
      'cent (10 and 80 for the red), and last its hue, here exactly one of the four pure ones. The white ' +
      'squares are NCS white, W, the elementary white: a white purer than any paint, which a screen shows ' +
      'as its own full white. But the elementary colours themselves, those hues at their most colourful, are ' +
      'deeper than sRGB can show. So on a wide-colour (Display P3) screen the balls come closer to them, as close as P3 ' +
      'reaches, while every other colour looks just as on any other screen. On a screen that shows even ' +
      'more, about as much as Rec. 2020 (the wide colour of HDR television), and with HDR on, they come ' +
      'closer still: about a third more colourful again, green and blue the most. NCS rests on three pairs of opposite elementary colours, white and black, red and green, ' +
      'yellow and blue, and red, yellow, green and blue are the four hues that look pure, not like a mix of ' +
      'others. So the balls come in the four pure hues of human colour vision, by a Swedish standard. ' +
      'Even the Swedish flag is defined in it: its yellow is NCS 0580-Y10R and its blue NCS 4055-R95B.',
    ] },
    { name: 'Controls', paragraphs: [
      '# In the scene',
      'Drag to look around, scroll or pinch to zoom, and click a ball to give it a push.',
      '# The title bar',
      'The close gadget (left) does what closing a program on the Amiga too often did. Then the speed of time ' +
      '(<<, || and >, and a slider), the presets (< and > step through them, as does clicking the name; ' +
      'Restart starts again), Open Controls, and the zoom gadget (right) for the full screen. ' +
      'After a few seconds without the mouse, everything fades away, the mouse pointer too, and leaves ' +
      'just the scene.',
      '# Keys',
      'Space: pause, or carry on at the speed it had. R: start the preset again. F: full screen on or off. ' +
      'Escape: leave full screen, or else close the window in front (a second Escape closes the next one). ' +
      '1 to 9 and 0: the presets, in order: 1 Four balls, 2 Classic 1984, 3 Carousel, 4 Copper demo, ' +
      '5 Under table, 6 Break shot, 7 Gas, 8 Stacked drop, 9 Cradle, 0 Rain (Brownian has no key: step to it ' +
      'with < and >). G: a Guru Meditation.',
      '# More with the mouse',
      'Shift-click or right-click on a button like the preset name steps backwards. The sliders also work ' +
      'with the keyboard: click one (or reach it with Tab), then the arrow keys move it a step, Page Up and ' +
      'Page Down a tenth of the way, Home and End to the ends. Windows can be dragged ' +
      'by their title bars, and the demo effects\' windows (Twist v4 and the others) resized with their ' +
      'corner gadgets (a wider window has room for more twists or more bobs); a double-click on an effect shows ' +
      'it on the full screen. Each button opens another window, as many as you like.',
      '# The control pages',
      'Scene: how many balls, how big, how lively, gravity, how things bounce, and precision. On a phone or ' +
      'tablet, Tilt lets gravity pull the way you tilt it, so the balls roll downhill. ' +
      'Look: trails, backdrops (copper bars, a starfield, a plasma or Kefrens bars; the grid changes colour to ' +
      'suit each), the scrolling text, the credit line at the bottom, shadows, big Amiga-style pixels, the lamp and the camera, ' +
      'and HDR (on an HDR screen, in browsers with WebGPU): a slider for how bright light brighter than white ' +
      'gets (0 = off, as it starts; the Copper demo turns it on): the backdrops (the copper bars, the stars, the plasma\'s crests, the Kefrens bars), the glints, the scroller\'s letters and the twist then shine. ' +
      'Glints puts a shiny spot on each ball, where it mirrors the lamp; with HDR it shines brighter than white. ' +
      'Auto cam moves the camera by itself, in the way you choose: Round (all the way round), Swing (from side to side in front, for scenes whose shadows fall on the back wall) or Rise (round, and up to look down from above). Presets that start with it on pick their own. ' +
      'Max FPS draws fewer pictures a second than a fast screen could show (a half, a third, a quarter … of its rate), which saves a ' +
      'lot of energy on a 240 or 480 Hz screen or a laptop on battery; the motion stays even. ' +
      'Turn "In a box" off and the window itself becomes the room. ' +
      'Sound: the boings, and four chiptunes made from scratch in code. ' +
      'Info: the physics at work, the rewind test, and how fast your computer draws it all.',
    ] },
    { name: 'Physics', paragraphs: [
      '# How things bounce',
      'A bounce is described by three numbers: what happens to the speed straight into the surface, to the ' +
      'sliding along it, and to the twisting against it. 1 means it is reversed, -1 that it carries on untouched.',
      'Rough (1, 1, 1): everything reverses. Garwin (1, 1, -1): the ideal super ball. Smooth (1, -1, -1): ' +
      'slippery, spin is ignored. Twist (1, -1, 1): slippery, but twisting reverses. ' +
      'These are the only four kinds of bounce that lose no energy. Walls can also be "1984": slippery, and ' +
      'the ball turns the other way after each side wall, as in the original demo (a real ball would not).',
      '# The Info page',
      'When balls hit each other they pass on momentum and angular momentum, but the totals stay the same; ' +
      'only walls and gravity change them. "Energy" is all the energy there is; it only changes when you ' +
      'click a ball or move Energy or Gravity. Beside Rewind test, while it runs, its result (see This demo), ' +
      'and below it a graph of the last 20 seconds or so: how far a rewind would miss (on a log scale; above ' +
      'the dotted line it is lost). Then the speeds: how fast the balls fly (blue) and spin (green), against ' +
      'the Maxwell–Boltzmann curve (red) they settle into after enough collisions. Spin settles into a curve of ' +
      'its own: when the bounces can change spin (Rough, say), each collision shares out energy between flying ' +
      'and spinning, and on average every way a ball can move ends up with the same share (equipartition), so ' +
      'the spins, too, follow Maxwell\'s law. With Smooth bounces spin never changes, and its bars stay where ' +
      'they started. ' +
      'Below that, what differs from one computer to the next: how many pixels are drawn and the screen\'s refresh rate, its colours ' +
      '(P3 on a wide-colour screen, else sRGB, then HDR if it is on and the screen shows it, else SDR; or ' +
      'Rec. 2020, see This demo), what draws the picture (WebGPU where the browser has ' +
      'it, else WebGL), the time spent on physics and by the graphics card for each frame, ball-on-ball hits ' +
      'per second, and Dropped: frames dropped since the page was opened (a picture shown twice, which makes the motion jerk, ' +
      'even when FPS says 60). The rewind graph and the speeds only record while the Info page is shown; ' +
      'the graph below records all the time, the last two minutes: frame drops in red, and in blue (Uneven) frames in ' +
      'which the balls didn\'t move evenly although the frame came on time (the physics had no new step ' +
      'ready, or had to leap ahead to catch up).',
      '# Hollow balls',
      'The balls are thin shells, like beach balls, not solid like billiard balls. A shell has its weight far ' +
      'from the middle, so it is harder to set spinning than a solid ball of the same weight (two thirds of ' +
      'mass × radius², against two fifths). That decides how much of a rough bounce goes into spin and how ' +
      'much stays in the flight, and so how far the Under table ball comes back.',
      '# Finding the collisions',
      'Testing every ball against every other ball each frame would mean eight million pairs with 4000 balls. ' +
      'Instead the physics looks only a little ahead, at most a thirtieth of a second, and only at balls that are close enough ' +
      'to meet in that time. For those few pairs it works out the exact moment of each hit, and then moves ' +
      'everything from one hit to the next, in order. So 4000 balls still run smoothly, and each hit happens ' +
      'at exactly the right moment, never a little too late inside another ball.',
      '# How it is made',
      'Plain JavaScript and the browser\'s own graphics, with no libraries. Every ball is a perfect sphere, ' +
      'worked out for each pixel it covers, and so is every shadow; the grid lines are exactly as wide at ' +
      'any angle. With WebGPU (Chrome and Edge) the graphics card also works out which balls can shadow ' +
      'which part of the scene, many small programs side by side, and the scroller is drawn by it too; ' +
      'elsewhere WebGL 2 draws the same picture. The ball colours are wide (Display P3, or even Rec. 2020) where the screen can ' +
      'show them, and with HDR light can be brighter than white. The physics runs on a thread of its own, so a ' +
      'slow physics step never holds up the drawing; its Octuple precision uses WebAssembly. The screen ' +
      'is kept from dimming while the demo runs, and on a phone or tablet, tilting it can tilt gravity.',
    ] },
  ], () => { aboutIsOpen = false; });
});

// The picture only needs redrawing when something changed: the balls move,
// the camera moves, the window is resized or a ball is added or removed.
// While paused with nothing happening we skip drawing, which saves battery.
let needsRedraw = true;

// Keep the picture sharp and undistorted when the window changes size.
function resize() {
  renderer.resize();
  camera.resize(canvas.clientWidth, canvas.clientHeight);
  if (!settings.grid) applyRoom();   // the window-sized room follows the window
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

// Browsers allow no sound before the first click, tap or key press. A
// preset with music (Carousel, Copper demo) starts it then.
for (const event of ['pointerdown', 'keydown']) {
  addEventListener(event, () => music.setPlaying(settings.music && !document.hidden));
}

// Handy for experimenting: type `boing.physics.balls[0]` in the browser's
// developer console to inspect or change a ball while the demo runs.
// ---- Fading the controls -----------------------------------------------------
// After a few seconds without the mouse moving, a touch or a key, the bars in
// the top-left corner and the Open Controls button fade away (the CSS of
// body.idle in index.html), leaving the scene alone, and any movement brings
// them back. Not while the pointer rests on them, nor while the panel is open.
const IDLE_SECONDS = 3;
let idleTimer = 0;
function wakeControls(e) {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const inUse = document.querySelector('.speed-bar:hover, .preset-bar:hover, .panel:hover, .panel:not(.closed)');
    if (inUse) wakeControls(); else document.body.classList.add('idle');
  }, IDLE_SECONDS * 1000);
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
  window.addEventListener(type, wakeControls, { passive: true });
}
wakeControls();
// The close gadget at the left end of the title bar: a web page can't close
// itself, and the show should go on, so the "program" crashes instead, as
// Amiga programs so often did: the Guru Meditation, until a click or a key.
// In full screen it goes back to the window instead.
document.querySelector('.app-bar .window-close').addEventListener('click', () => {
  // In full screen, closing means leaving full screen, back to the window.
  if (fullScreenElement()) { toggleFullScreen(); return; }
  showGuru(['Software Failure.   Press left mouse button to continue.', 'Guru Meditation #00000004.0000AAC0']);
});

// Keep the screen awake while the demo is shown (the Screen Wake Lock API,
// where the browser has it): a demo is for watching, so the screen should
// not dim or lock meanwhile. The browser lets go of the lock when the page
// is hidden; it is asked for again when the page comes back. (Some browsers
// only grant it after a click or a tap, so it is asked for then too.)
// While paused for more than a minute, the lock is let go (so a forgotten,
// paused demo doesn't keep the screen on), and taken again when it runs.
const PAUSED_AWAKE_SECONDS = 60;
let wakeLock = null, pausedSince = null, letGo = false;
function checkPausedAwake(now) {   // (once a second)
  if (settings.speed !== 0) {
    pausedSince = null;
    if (letGo) { letGo = false; keepAwake(); }
  } else {
    pausedSince ??= now;
    if (wakeLock && now - pausedSince > PAUSED_AWAKE_SECONDS * 1000) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
      letGo = true;
    }
  }
}
let asking = false;
async function keepAwake() {
  if (!navigator.wakeLock || document.hidden || wakeLock || asking) return;
  if (letGo) return;   // (paused for long: see checkPausedAwake)
  asking = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Not granted (low battery, say): the screen dims as usual.
  }
  asking = false;
}
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
addEventListener('pointerdown', keepAwake);

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
async function startWebGpu() {
  if (!navigator.gpu || preferWebGl || renderer.isWebGpu || webGpuTries >= MAX_WEBGPU_TRIES) return;
  const { renderer: gpuRenderer, error } = await GpuRenderer.create(canvas, { onLost: webGpuLost });
  if (!gpuRenderer) {
    console.warn('Drawing with WebGL: ' + error);
    if (!renderer.isWebGpu && renderer !== screenRenderer) useRenderer(webGlRenderer());
    return;
  }
  if (preferWebGl || renderer.isWebGpu) { gpuRenderer.dispose(); return; }   // (changed meanwhile)
  // (HDR, if the slider was moved meanwhile.)
  const hdr = settings.hdrStrength > 0 && gpuRenderer.setHdr(true);
  useRenderer(gpuRenderer);
  if (!hdr && settings.hdrStrength > 0) { settings.hdrStrength = 0; hdrSlider?.refresh(); }
  hdrChanged();
}
function webGpuLost(why) {
  // Once the balls have been shown, WebGPU stopping ends the demo, as a
  // crash on the Amiga did: the Guru Meditation, and nothing more. (Only
  // behind the loading screen does WebGL quietly take over instead.)
  if (!loadingScreen) {
    console.warn('WebGPU stopped (' + why + ')');
    halt();
    showGuru(['Software Failure.   WebGPU stopped.   Reload the page to continue.', 'Guru Meditation #80000022.0000AAC0'], false);
    return;
  }
  webGpuTries++;
  const hadHdr = hdrOn();
  useRenderer(webGlRenderer());
  if (hadHdr) {   // (HDR needs WebGPU: off)
    settings.hdrStrength = 0;
    hdrSlider?.refresh();
  }
  hdrChanged();
  console.warn('WebGPU stopped (' + why + '): drawing with WebGL');
  // (A graphics driver restart, say: try again in a moment.)
  setTimeout(startWebGpu, 2000);
}
async function drawWith(which) {
  preferWebGl = which === 'webgl';
  if (preferWebGl && renderer.isWebGpu) {
    useRenderer(webGlRenderer());
    settings.hdrStrength = 0;
    hdrSlider?.refresh();
    hdrChanged();
  }
  if (!preferWebGl) { webGpuTries = 0; await startWebGpu(); }
  return renderer.isWebGpu ? 'WebGPU' : 'WebGL';
}

// The browser can take the graphics card away from the page ("context
// lost"): when the graphics driver restarts, or when there are too many 3D
// pictures at once — which Safari can do on a quick reload, before the old
// page has given its own back. Everything drawn is then gone. Asking for
// it back (preventDefault), the page's renderer is made anew when it comes.
canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
canvas.addEventListener('webglcontextrestored', () => {
  if (!screenRenderer) return;
  // (The old renderer is simply dropped: its context is the very one that
  // came back, so it must not be "disposed".)
  const fresh = new Renderer(canvas);
  fresh.pixelSize = screenRenderer.pixelSize;
  fresh.wideColor = screenRenderer.wideColor;
  fresh.applyColorSpace();
  if (renderer === screenRenderer) renderer = fresh;   // (with HDR on, it waits until HDR goes off)
  screenRenderer = fresh;
  renderer.resize();
  needsRedraw = true;
});
function useRenderer(next) {
  next.pixelSize = renderer.pixelSize;
  next.wideColor = renderer.wideColor;
  if (renderer !== screenRenderer) renderer.dispose();
  renderer = next;
  renderer.applyColorSpace();
  renderer.resize();
  showTextGlow();
  showHdrControl();
  twistOptions.device = renderer.isWebGpu ? renderer.device : null;   // (the Twist window draws with it too, when opened)
}
async function setHdr(on) {
  twistOptions.hdr = on;
  // Drawn with WebGPU: it simply switches.
  if (renderer.isWebGpu) {
    if (renderer.setHdr(on)) { needsRedraw = true; return on ? screenIsHdrMessage(renderer.hdr) : 'HDR off'; }
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

// The scroller: with WebGPU it is drawn into the scene, by the graphics card
// (see scrollerColor in gpu-renderer.js), and its own canvas only marks its
// place. With WebGL it draws itself on its own canvas.
// (Nor while nothing draws yet, behind the loading screen: then the
// scroller's own canvas draws nothing either, and its font isn't even made
// unless WebGL ends up drawing.)
function showTextGlow() {
  const elsewhere = Boolean(renderer.isWebGpu) || renderer === noRenderer;
  scroller.drawnElsewhere = elsewhere;
  scroller.canvas.style.opacity = elsewhere ? '0' : '';
  needsRedraw = true;
}
scroller.onDraw = () => { if (scroller.drawnElsewhere) needsRedraw = true; };

window.boing = { physics, camera, settings, sounds, scroller, rewindCheck, applyRoom, showGrid, hdr: setHdr, drawWith, preset: (name) => { settings.preset = name; applyPreset(name); }, measure,
  tinker: (code) => physics.tinker(code) };   // (for trying things in the console)
Object.defineProperty(window.boing, 'renderer', { get: () => renderer });   // (whichever draws now)


// ---- Measuring: boing.measure() -------------------------------------------------
// For finding where the time (and the energy) goes on a particular computer.
// Type  await boing.measure()  in the browser's console (with the demo's tab
// in front, and nothing else busy): it runs a row of scenes for a few
// seconds each, measures each, and prints a report to copy and pass on
// (also put on the clipboard, where the browser allows). It takes about a
// minute and a half; afterwards the scene and settings are as before.
// (boing.measure({ seconds: 10 }) measures longer; { only: ['gas'] } some.)
let measuring = null;   // the numbers being gathered (see frame), or null
const MEASURE_CASES = [
  { name: 'Four balls', preset: 'four' },
  { name: 'Four, no shadows', preset: 'four', set: { shadows: false } },
  { name: 'Four, grid off', preset: 'four', set: { grid: false } },
  { name: 'Four, no grid/shadow', preset: 'four', set: { grid: false, shadows: false } },
  { name: 'Four, Copper', preset: 'four', set: { copper: true, backdrop: 'bars' } },
  { name: 'Four, Stars', preset: 'four', set: { copper: true, backdrop: 'stars' } },
  { name: 'Four, Plasma', preset: 'four', set: { copper: true, backdrop: 'plasma' } },
  { name: 'Four, Kefrens', preset: 'four', set: { copper: true, backdrop: 'kefrens' } },
  { name: 'Four, trails 10 s', preset: 'four', set: { trails: 10 } },
  { name: 'Four, pixel size 3', preset: 'four', set: { pixelSize: 3 } },
  { name: 'Classic 1984', preset: 'classic' },
  { name: 'Carousel', preset: 'carousel' },
  { name: 'Copper demo', preset: 'demo' },
  { name: 'Gas (1000)', preset: 'gas' },
  { name: 'Rain (144)', preset: 'rain' },
  { name: 'Brownian (501)', preset: 'brownian' },
  { name: '4000 balls', preset: 'four', set: { balls: 4000, ballSize: 0.25 } },
];
async function measure({ seconds = 4, warmUp = 1.5, only = null } = {}) {
  if (measuring) return 'Already measuring.';
  const wait = (s) => new Promise((done) => setTimeout(done, s * 1000));
  const saved = { ...settings }, results = [];
  const cases = only ? MEASURE_CASES.filter((c) => only.some((o) => c.name.toLowerCase().includes(o) || c.preset === o)) : MEASURE_CASES;
  console.log(`Measuring ${cases.length} scenes, ${seconds + warmUp} s each: keep this tab in front…`);
  for (const c of cases) {
    applyPreset(c.preset, { speed: 1, fpsEvery: saved.fpsEvery, ...c.set });
    await wait(warmUp);
    renderer.gpuParts = {};
    measuring = { gaps: [], late: 0, drawn: 0, drawMs: 0, gpuMs: 0, gpuFrames: 0, parts: {}, doneMs: 0, doneFrames: 0, physicsMs: 0, steps: 0, hits: 0, start: performance.now() };
    await wait(seconds);
    const m = measuring;
    m.gpuMs += renderer.gpuTotalMs; m.gpuFrames += renderer.gpuFrames;   // (and what showCounts hasn't taken yet)
    for (const part in renderer.gpuParts ?? {}) m.parts[part] = (m.parts[part] ?? 0) + renderer.gpuParts[part];
    const perFrame = (part) => (m.gpuFrames && m.parts[part] !== undefined ? +(m.parts[part] / m.gpuFrames).toFixed(3) : null);
    measuring = null;
    const time = (performance.now() - m.start) / 1000;
    const gaps = m.gaps.slice().sort((a, b) => a - b), at = (q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0;
    results.push({
      scene: c.name, balls: physics.balls.length,
      fps: +(m.drawn / time).toFixed(1),
      frameMs: { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(gaps[gaps.length - 1] ?? 0).toFixed(2) },
      dropped: m.late,
      gpuMs: m.gpuFrames ? +(m.gpuMs / m.gpuFrames).toFixed(3) : null,
      gpuParts: { shadows: perFrame('shadows'), scene: perFrame('scene'), copy: perFrame('copy') },
      direct: renderer.drewDirect ?? null,
      gpuDoneMs: m.doneFrames ? +(m.doneMs / m.doneFrames).toFixed(2) : null,
      cpuDrawMs: m.drawn ? +(m.drawMs / m.drawn).toFixed(3) : null,
      physicsMs: m.steps ? +(m.physicsMs / m.steps).toFixed(3) : null,
      hitsPerSecond: Math.round(m.hits / time),
    });
    console.log(`  ${c.name}: ${results[results.length - 1].fps} fps`);
  }
  applyPreset(saved.preset, saved);   // (everything back as it was)
  // Where it ran.
  let gpu = null;
  if (renderer.isWebGpu) {
    const info = renderer.adapterInfo;
    gpu = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : 'WebGPU (no adapter info)';
  } else if (renderer.gl) {
    const ext = renderer.gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? renderer.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : renderer.gl.getParameter(renderer.gl.RENDERER);
  }
  const report = {
    demo: VERSION, when: new Date().toISOString(),
    browser: navigator.userAgent, cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory ?? null,
    drawnWith: renderer.isWebGpu ? 'WebGPU' : 'WebGL', gpu,
    gpuTimer: renderer.gpuTimer ? 'yes' : 'no',
    screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio, refreshHz: screenRate,
      wideColour: wideColourScreen(), hdrScreen: matchMedia('(dynamic-range: high)').matches },
    window: { width: innerWidth, height: innerHeight, drawnPixels: `${Math.round(canvas.clientWidth * renderer.pixelRatio)} × ${Math.round(canvas.clientHeight * renderer.pixelRatio)}` },
    settings: { maxFps: settings.fpsEvery === 1 ? 'Screen' : Math.round(screenRate / settings.fpsEvery), hdr: settings.hdrStrength },
    measuredSeconds: seconds,
    results,
  };
  const pad = (v, n) => String(v ?? '–').padStart(n);
  const lines = [
    `Amiga Boing Balls ${VERSION} — boing.measure()`,
    `${report.drawnWith}, GPU: ${typeof gpu === 'object' && gpu ? Object.values(gpu).filter(Boolean).join(' / ') : gpu}, GPU timer: ${report.gpuTimer}`,
    `Screen ${screen.width}×${screen.height} @${devicePixelRatio}x, ${screenRate} Hz; window ${innerWidth}×${innerHeight}, drawn ${report.window.drawnPixels}; Max FPS ${report.settings.maxFps}`,
    `${navigator.userAgent}`,
    '',
    `${'scene'.padEnd(20)}${pad('balls', 6)}${pad('fps', 7)}${pad('frame', 8)}${pad('p95', 7)}${pad('max', 7)}${pad('drop', 6)}${pad('gpu', 8)}${pad('shad', 7)}${pad('scene', 7)}${pad('copy', 7)}${pad('gpu≈', 7)}${pad('cpu', 7)}${pad('phys', 7)}`,
    ...results.map((r) => `${r.scene.padEnd(20)}${pad(r.balls, 6)}${pad(r.fps, 7)}${pad(r.frameMs.median, 8)}${pad(r.frameMs.p95, 7)}${pad(r.frameMs.max, 7)}${pad(r.dropped, 6)}${pad(r.gpuMs, 8)}${pad(r.gpuParts.shadows, 7)}${pad(r.gpuParts.scene, 7)}${pad(r.gpuParts.copy, 7)}${pad(r.gpuDoneMs, 7)}${pad(r.cpuDrawMs, 7)}${pad(r.physicsMs, 7)}`),
    '',
    '(ms per frame: frame = time between frames (median, 95th percentile, max); gpu = graphics card time measured by the card,',
    ' and its parts: shad = ball table and shadow grid, scene = the scene, copy = the last step to the canvas (– = drawn straight in);',
    ' gpu≈ = time until the card was done (WebGPU without its timer); cpu = drawing on the main processor; phys = per physics step)',
    '',
    JSON.stringify(report),
  ];
  const text = lines.join('\n');
  console.log(text);
  try { await navigator.clipboard.writeText(text); console.log('(Also copied to the clipboard.)'); } catch { /* (not allowed from here: copy it from the console) */ }
  return report;
}

// --- Animation loop ----------------------------------------------------------
// The browser calls frame() before every screen refresh (60 times a second on
// most screens, 120+ on some). We measure how much real time has passed and
// advance the physics by exactly that much, so the speed is the same
// everywhere.

let lastTime = performance.now();
let clockOwed = 0;   // milliseconds the motion is behind the clock (see frame)

// Counted over one second, then shown and reset.
const counts = { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, late: 0, repeats: 0, jumps: 0, since: lastTime };

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

let refreshesSkipped = 0;   // (Max FPS: refreshes since the last picture)
const drawOptions = {};     // (see renderer.draw)
function frame(now) {
  frameRequested = false;
  if (document.hidden || guruShown) return;   // stop here; started again when the page (or the scene) is shown

  // Max FPS: draw on every 2nd, 3rd, 4th ... refresh only, so the pictures
  // still come evenly; nothing at all is done on the others. (The screen
  // rate keeps being measured from all of them.)
  const every = settings.fpsEvery;
  if (++refreshesSkipped < every) {
    counts.refreshes++;
    if (now - counts.since >= 1000) showCounts(now);
    requestFrame();
    return;
  }
  refreshesSkipped = 0;

  const gap = Math.max(0, now - lastTime);   // (milliseconds since the last frame; never below 0, see visibilitychange)
  // A late frame (see details.late): a gap more than 1.5 times the usual one.
  // "Usual" is the middle value of the last 31 gaps, not the screen's highest
  // rate: a screen can change its rate on the fly (a MacBook in Low Power
  // Mode goes from 120 to 60 Hz, or the window moves to another screen), and
  // evenly slower frames are no stutter. (Long hold-ups count too: the time
  // a tab was hidden doesn't, as lastTime starts afresh when it comes back.)
  const usual = recentGaps.length >= 8 ? usualGap() : gap;
  if (recentGaps.length >= 8 && gap > 1.5 * usual) { counts.late++; if (measuring) measuring.late++; }
  if (measuring) measuring.gaps.push(gap);
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
  const elapsed = Math.min(step / 1000, 0.1);

  sounds.enabled = settings.sound;
  renderer.measureGpu = infoShown() || Boolean(measuring);
  physics.wantSpeeds(infoShown());   // (the speed histogram: only worked out while it can be seen)

  // (Paused while the Twist is full screen: see twistOptions.onFullScreen.
  // And held still behind the loading screen: the balls start when they are
  // shown.)
  const speed = twistFull || loadingScreen ? 0 : settings.speed;
  if (loadingScreen) needsRedraw = true;   // (the picture behind it ready, and the graphics card warmed up)
  scroller.rate = speed;   // the scrolling text pauses and rewinds with the balls
  scroller.tick(elapsed);
  showVcr(now);
  if (settings.autoCamera && !camera.locked) camera.autoMove(elapsed, settings.camMove);
  let start = performance.now();
  // The rewind test only runs while the Controls are open (and it is
  // switched on); closed, its twin costs nothing. Opened again, it starts
  // afresh from that moment, as its twin did not follow the scene meanwhile.
  const testing = settings.rewindEstimate && panel.isOpen;
  if (testing !== rewindCheck.enabled) {
    rewindCheck.setEnabled(testing);
    if (testing) graph.clear();
    showRewindTest();
  }
  applyTilt();
  // The physics' next step, in its worker. (Its time budget, and the slow
  // motion when it is overrun, are in physics-host.js.)
  // Its time budget: most of a frame at this screen's rate (it works side by
  // side with the drawing); overrun, the balls go into slow motion.
  // (Paused, with no change on its way to it, there is nothing for the
  // physics to do: no step is asked for, and it works out no snapshot.)
  if (speed !== 0 || !physics.upToDate || !physics.started || (physics.speedsWanted && !physics.speeds)) {
    physics.step(elapsed * speed, settings.gravity, (0.8 * 1000 * every) / Math.max(screenRate, 30));
  }
  // ...and show the balls this frame's time further on (see showNext in
  // physics-client.js). Nothing new ready while the balls move: the same
  // picture of them twice, a stutter.
  // And a shown step that moves the balls further than one frame's worth
  // (steps that piled up, or time saved up while the physics was busy)
  // makes them leap ahead: a jump.
  const started = physics.started;   // (waiting for the very first step is no stutter)
  if (!physics.showNext(Math.abs(elapsed * speed)) && speed !== 0 && started) counts.repeats++;
  if (speed !== 0) counts.jumps += physics.jumps;   // (see physics-client.js)
  physics.jumps = 0;

  if ((speed !== 0 || camera.changed || needsRedraw) && !(loadingScreen && choosingRenderer)) {
    start = performance.now();
    // (One options object, filled in afresh: nothing new for every frame.)
    const o = drawOptions;
    o.hdrStrength = settings.hdrStrength;
    o.glints = settings.glints;
    o.scroller = scroller.shown ? scroller : null;        // (WebGPU)
    o.ballNumbers = physics.numbers;                      // (WebGPU: see makeBallTable)
    o.copper = settings.copper;
    o.backdrop = settings.backdrop;
    o.backdropTime = physics.time;   // so the bars pause and rewind with the balls
    o.trailSeconds = settings.trails;
    o.trailTime = physics.time;
    o.grid = settings.grid;
    o.shadows = settings.shadows;
    o.stage = stage();
    renderer.draw(camera, physics.balls, o);
    // Without the graphics card's own timer, wait for it to finish this frame
    // (only while the Info page is shown, as waiting costs a little speed), so
    // that the measured time includes the card's work.
    // (Not with HDR: then WebGPU still has to show the frame, and making the
    // computer wait for the graphics card every frame makes the motion jerky.)
    if ((infoShown() || measuring) && !renderer.gpuTimer && !renderer.hdr && !renderer.isWebGpu) renderer.waitUntilDone();
    counts.drawMs += performance.now() - start;
    counts.drawn++;
    if (measuring) {
      measuring.drawn++;
      measuring.drawMs += performance.now() - start;
      // (WebGPU without the card's own timer: how long until the card has
      // done this frame's work, a rough upper bound of its time.)
      if (renderer.isWebGpu && !renderer.gpuTimer) {
        const sent = performance.now(), m = measuring;
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

  // Keep the Energy slider showing the current energy (unless you're
  // dragging it). Only while it can be seen: adding up the energy of all
  // the balls every frame would otherwise be wasted.
  const energy = sceneShown() ? Math.round(energyPerBall() * 10) / 10 : settings.energy;
  if (!energySlider.dragging && physics.upToDate && energy !== settings.energy) {
    settings.energy = energy;
    // Big or fast balls can have more energy than the slider usually goes
    // to: then its range grows to fit.
    energySlider.setMax(Math.max(ENERGY_SLIDER_MAX, Math.ceil(energy)));
    energySlider.refresh();
  }

  // The totals on the Info page: a few times a second is plenty for reading numbers.
  if (infoShown() && counts.refreshes % 8 === 0) {
    graph.sample(rewindCheck.enabled && !rewindCheck.changedByHand ? rewindCheck.estimate() : null);
    showTotals();
    graph.draw();
    sampleSpeeds();
    drawSpeeds();
  }
  if (infoShown()) showRewindTest();
  // (Just shown: draw the graphs now, rather than at their next sample.)
  if (infoShown() !== infoWasShown) {
    infoWasShown = infoShown();
    if (infoWasShown) { graph.draw(); lateGraph.draw(); }
  }

  counts.refreshes++;
  if (now - counts.since >= 1000) showCounts(now);

  requestFrame();
}
requestFrame();

// Once a second: update FPS and the performance rows on the Info page.
function showCounts(now) {
  checkPausedAwake(now);
  const seconds = (now - counts.since) / 1000;
  lateInAll += counts.late;
  lateGraph.sample(counts.repeats + counts.jumps, counts.late);   // (always, also while nobody looks)
  screenRate = Math.max(screenRate, standardRate(counts.refreshes / seconds));
  settings.fps = Math.round(counts.drawn / seconds);
  offerFpsChoices(screenRate);
  fpsDisplay.setMax(screenRate / settings.fpsEvery);   // the bar is full at the screen's own rate (or Max FPS)
  fpsDisplay.refresh();   // (setMax only redraws when the range changes)

  if (infoShown()) {
    const physicsMs = counts.steps ? counts.physicsMs / counts.steps : 0;
    const drawMs = counts.drawn ? counts.drawMs / counts.drawn : 0;
    // (The pixels drawn, which decide most of the graphics card's work, and
    // the screen's refresh rate, on one line.)
    const target = renderer.target;
    details.screen.set(target ? `${target.width}×${target.height} ${screenRate}Hz` : `${screenRate} Hz`);
    // (Short, to fit: P3 = Display P3. Then HDR while it is on and the screen
    // shows it, else SDR. Rec. 2020: the ball colours go further than P3,
    // which needs HDR, so that says it all; see colourLevel in gpu-renderer.js.)
    const hdrNote = renderer.hdr?.screenIsHdr ? ' · HDR' : ' · SDR';
    details.colours.set(renderer.colourLevel === 2 ? 'Rec. 2020' : (wideColourScreen() ? 'P3' : 'sRGB') + hdrNote);
    details.physics.set(`${physicsMs.toFixed(2)} ms`);
    details.hits.set(String(Math.round(hitsCounted / seconds)));
    details.late.set(String(lateInAll));   // (since the page was opened; the graph below shows them second by second)
    lateGraph.draw();

    details.drawnWith.set(renderer.isWebGpu ? 'WebGPU' : 'WebGL');
    if (!counts.drawn) {
      details.graphics.set('–');   // nothing was drawn (paused)
    } else if (renderer.gpuTimer) {
      // Measured by the graphics card itself.
      const gpuMs = renderer.gpuFrames ? renderer.gpuTotalMs / renderer.gpuFrames : 0;
      details.graphics.set(`${gpuMs.toFixed(2)} ms`);
    } else {
      // Measured by waiting for the card: close, but slightly pessimistic,
      // because the computer and the card then take turns instead of
      // working side by side. Hence the "≈".
      // (Not with HDR: then the wait is skipped, as it would make the motion
      // jerky, so there is no measurement.)
      const unmeasured = renderer.hdr || renderer.isWebGpu;   // (the graphics card's time isn't known)
      details.graphics.set(unmeasured ? '–' : `≈ ${drawMs.toFixed(2)} ms`);
    }
  }

  if (measuring) {
    measuring.gpuMs += renderer.gpuTotalMs; measuring.gpuFrames += renderer.gpuFrames; measuring.hits += hitsCounted;
    for (const part in renderer.gpuParts ?? {}) measuring.parts[part] = (measuring.parts[part] ?? 0) + renderer.gpuParts[part];
  }
  renderer.gpuParts = {};
  renderer.gpuTotalMs = 0;
  renderer.gpuFrames = 0;
  hitsCounted = 0;
  Object.assign(counts, { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, late: 0, repeats: 0, jumps: 0, since: now });
}

// WebGPU takes over from WebGL where the browser has it (see startWebGpu).
// At the start, behind the loading screen: the first picture anyone sees is
// already drawn by WebGPU where it works. Until WebGPU is ready (or known not
// to work) nothing is drawn at all, so WebGL doesn't take the graphics card's
// time while WebGPU makes its pipelines. (WebGL isn't even set up: only if
// WebGPU doesn't work or stops, see webGlRenderer.) Should WebGPU take very
// long, the demo starts with WebGL and WebGPU takes over when it comes.
showTextGlow();
let choosingRenderer = Boolean(navigator.gpu);
const MAX_RENDERER_WAIT_MS = 6000;
startWebGpu().finally(() => { choosingRenderer = false; needsRedraw = true; });
setTimeout(() => {
  choosingRenderer = false;
  if (renderer === noRenderer) useRenderer(webGlRenderer());   // (WebGPU takes over when it comes)
}, MAX_RENDERER_WAIT_MS);
