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
//   twist.js    – the Twist window
// =============================================================================

import { Physics, COLLISION_TYPES, BOX_HALF_SIZE, boxRoom } from './physics.js';
import { Renderer, maxLampTilt } from './renderer.js';
import { createHdrPresenter, HDR_RANGE } from './hdr.js';
import { OrbitCamera } from './camera.js';
import { Sounds } from './audio.js';
import { Panel, showRequester, closeFrontWindow, addSpeedBar, addPresetBar, wide } from './gui.js';
import { Vec3, raySphere } from './math.js';
import { openTwistWindow, twistOptions } from './twist.js';
import { Music, TRACKS } from './music.js';
import { Scroller } from './scroller.js';
import { PRESETS, PRESET_DEFAULTS } from './presets.js';
import { DRIFTING, LOST } from './rewindcheck.js';
import { PhysicsClient } from './physics-client.js';

// Values the settings panel can change.
const settings = {
  fps: 0,          // measured frames per second (display only)
  energy: 1,       // total energy per ball; 1 = the classic start (see below)
  balls: 4,        // how many balls (1 … 1000)
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
  pixelSize: 1,        // 1 = sharp; more = big square pixels and 4096 colours
  glints: 0.5,         // a glint where each ball mirrors the lamp (0 = none, 1 = white; brighter with HDR)
  tilt: false,         // tilt the phone or tablet to tilt gravity
  hdrStrength: 0,      // HDR: how bright light brighter than white gets (0 = off; see hdr.js)
  grid: true,          // show the box (off: the window is the room)
  lamp: 21,            // how far away the lamp is (it makes the shadows)
  lampTilt: 0,         // where it is: 0° = straight above … 90° = right in front
  track: 'jump',       // which tune the music plays (see TRACKS in music.js)
  autoCamera: false,   // let the camera circle and zoom by itself

  preset: 'four',      // which ready-made scene was last chosen (see PRESETS)
  ballType: 'rough',   // how balls bounce off each other (see COLLISION_TYPES
  wallType: 'smooth',  //   in physics.js) and off the walls
  trails: 0,           // how many seconds long the fading line behind every ball is (0 = none)
  copper: false,       // copper bars as the backdrop
  scroller: false,     // a scrolling text along the bottom
  credits: true,       // the credit line at the very bottom
  spinShare: 0,        // % of the motion energy that is in spin (display only)
};

// --- Set up ------------------------------------------------------------------

const canvas = document.getElementById('scene');

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (error) {
  document.getElementById('info').textContent = 'Sorry, this demo needs WebGL2. ' + error.message;
  throw error;
}

const camera = new OrbitCamera(canvas);
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
// how hard.
const where = new Vec3();
function tookSnapshot(snapshot, changed) {
  hitsCounted += snapshot.hits;
  counts.physicsMs += snapshot.ms;
  counts.steps++;
  if (changed) needsRedraw = true;
  if (physics.upToDate && snapshot.count !== settings.balls) {   // (fewer fit, or a preset placed its own)
    settings.balls = snapshot.count;
    ballSlider.refresh();
  }
  if (!settings.sound) return;   // (no boings: nothing more to work out)
  const e = snapshot.events;
  for (let at = 0; at < e.length; at += 5) {
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

}

let showingRewind = false;   // is "<< REWIND" on screen?

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
  showPixels(settings.pixelSize);
  scroller.setShown(settings.scroller);
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
// starts the chosen preset again from its beginning. It keeps the Digits
// setting: choose a preset, set Digits, press R, and the whole scene runs
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
  min: 1, max: 1000, step: 1,
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
    const forward = camera.position.scale(-1).normalize();   // the camera looks at the middle
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
controls.push(panel.addCycle('Digits', settings, 'digits',
  [{ value: 16, label: '16' }, { value: 32, label: '32 (slower)' }, { value: 64, label: '64 (slowest)' }],
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
controls.push(panel.addCheckbox('Copper', settings, 'copper', showCopper));
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
function stage() {
  const room = physics.room;
  return {
    floorY: room.floorY,
    lightHeight: settings.lamp,
    lightTilt: settings.lampTilt,
    reach: Math.max(room.max.x, room.max.z),
    top: room.max.y,
    windowRoom: !settings.grid,   // (the lamp then can't tilt all the way: see maxLampTilt)
  };
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
// Wide colour: the colours go to the screen as Display P3 wherever the
// browser can, so red, green, blue and yellow come out deeper on a
// wide-colour screen, as most phones and Macs have (see renderer.js).
renderer.setWideColor(true);

// Glints: a shiny spot on each ball where it mirrors the lamp (not in
// shadow). 0 = none, as in the original; 1 = white; 0.5 to begin with. With HDR on, the spot
// shines brighter than white (see GLINT in renderer.js).
controls.push(panel.addSlider('Glints', settings, 'glints', {
  min: 0, max: 1, step: 0.1,
  onChange: () => { needsRedraw = true; },
}));

// ---- Light brighter than white --------------------------------------------
// HDR: on an HDR screen, light brighter than white really shines (see
// hdr.js; needs WebGPU, so for now Chrome or Edge). The slider says how
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
// Auto cam: the camera circles the box by itself. It only works with the
// grid (and its movable camera), so switching it on switches that on too.
const autoCamBox = panel.addCheckbox('Auto cam', settings, 'autoCamera', (on) => {
  if (on && !settings.grid) {
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
  energy: panel.addReadout('All energy'),    // all energy, in "classic starts"
  momentum: panel.addReadout('Momentum'),    // size of the total momentum
  angular: panel.addReadout('Ang. mom.'),    // size of the total angular momentum
  spin: panel.addSlider('Spin share', settings, 'spinShare', { min: 0, max: 100, step: 1, readOnly: true }),
};

// The rewind test: runs a slightly nudged copy of the scene alongside (see
// rewindcheck.js) and shows, as it goes, how far from the start a rewind
// would bring the balls, in ball radii: "ok", "drift" (it will visibly miss)
// or "lost" (it can no longer find its way back). Switching it on starts it
// afresh, measuring how well a rewind would get back to that moment, and
// starts the graph again; Restart measures from the start of the preset.
controls.push(panel.addCheckbox('Rewind test', settings, 'rewindEstimate', (on) => {
  rewindCheck.setEnabled(on);
  if (on) graph.clear();
  showRewindTest();
}));
const rewindReadout = panel.addReadout('Rewind');

// A small graph on the Info page. It keeps its last `samples` values of a
// few lines, taken only while the Info page is shown, and draws them from
// left (oldest) to right (newest).
//   lines:   [{ color, y }], y(value) giving 0 (bottom) … 1 (top); a value
//            of null leaves a gap
//   guides:  heights (0 … 1) of dotted lines
function addGraph(samples, { lines, guides = [] }) {
  const row = panel.addRow('');
  row.classList.add('panel-graph');
  row.firstChild.remove();   // (no label: the graph takes the whole row)
  const canvas = document.createElement('canvas');
  canvas.className = 'sunken';
  row.append(canvas);
  const values = lines.map(() => []);
  return {
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
    },
  };
}

// The first graph shows the last 20 seconds or so: the spin share (blue,
// 0 at the bottom, 100 % at the top) and, with the rewind test on, how far a
// rewind would miss (orange, on a logarithmic scale from 1e-16 at the
// bottom to 1e+4 ball radii at the top; the dotted line is 1, where a
// rewind is lost). Sampled a few times a second; started again with every
// preset.
const logMiss = (e) => (Math.log10(Math.max(1e-16, Math.min(1e4, e))) + 16) / 20;
const graph = addGraph(160, {
  lines: [{ color: '#0055aa', y: (share) => share / 100 }, { color: '#ff8800', y: logMiss }],
  guides: [logMiss(1)],
});
let rewindShown = '';
function showRewindTest() {
  let text = 'off', look = '';
  if (rewindCheck.enabled) {
    const estimate = rewindCheck.estimate();
    if (rewindCheck.changedByHand) { text = 'lost (by hand)'; look = 'lost'; }
    else if (estimate >= LOST) { text = 'lost'; look = 'lost'; }
    else if (estimate >= DRIFTING) { text = `drift ${estimate.toExponential(0)}`; look = 'drifting'; }
    else { text = `ok ${estimate.toExponential(0)}`; }
  }
  if (text + look === rewindShown) return;   // (only touch the page when it changes)
  rewindShown = text + look;
  rewindReadout.set(text);
  rewindReadout.box.className = `readout sunken ${look}`;
}

// The totals:
//  - All energy only changes when you click a ball or move
//    Energy or Gravity.
//  - Momentum and angular momentum are passed between balls when they hit
//    each other but never lost; only the walls and gravity change the totals.
//  - Spin share: how much of the motion energy is in spinning. With rough balls
//    the collisions share energy out evenly, and it hovers around 50 %.
function showTotals() {
  const motion = physics.motionEnergy();
  physicsInfo.energy.set((physics.totalEnergy(settings.gravity) / ENERGY_UNIT).toFixed(4));
  physicsInfo.momentum.set(physics.totalMomentum().length().toFixed(3));
  physicsInfo.angular.set(physics.totalAngularMomentum().length().toFixed(3));
  settings.spinShare = motion > 0 ? Math.round((100 * physics.spinEnergy()) / motion) : 0;
  physicsInfo.spin.refresh();
}

// Then performance numbers, updated once a second.
const details = {
  physics: panel.addReadout('Physics'),    // time spent moving the balls, per frame
  graphics: panel.addReadout('Graphics'),  // graphics card time per drawn frame
  maxFps: panel.addReadout('Max FPS'),     // how fast it could go without a screen limit
  hits: panel.addReadout('Hits/s'),        // ball-on-ball collisions per second
  // Frames that came late: more than 1.5 screen refreshes after the one
  // before, so one picture stayed on screen twice and the motion jerks.
  // (The FPS above can still say 60 then: it counts a whole second.)
  late: panel.addReadout('Late frames'),
};
// The late frames of the last two minutes, one bar a second, counted all the
// time (also with the Controls closed), so any stutter shows up afterwards:
// nothing at the bottom line means none; one late frame already makes a
// clear spike, and the height grows (logarithmically) up to a whole second
// of them.
// In blue, the same way: frames in which the balls didn't move evenly
// although the frame came on time — a repeat (the physics had no new step
// ready, so the balls stood still for a frame) or a jump (they leapt ahead
// by more than a frame's worth). See physics-client.js.
let infoWasShown = false;
let lateInAll = 0;   // since the page was opened
const spike = (count) => (count === 0 ? 0 : 0.3 + 0.7 * Math.min(1, Math.log(count) / Math.log(60)));
const lateGraph = addGraph(120, {
  lines: [{ color: '#0055aa', y: spike }, { color: '#c40233', y: spike }],
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

// ---- Twist: a classic demo effect in a window of its own (see twist.js) ---------
panel.addButton('Twist v4...', openTwistWindow);

// ---- About ---------------------------------------------------------------------
let aboutIsOpen = false;
panel.addButton('About...', () => {
  if (aboutIsOpen) return;   // one is enough
  aboutIsOpen = true;
  showRequester('About Amiga Boing Balls', [
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
      '# Twist v4',
      'The twister is another demo classic. Twist v4 is a nod to Twist v3, a red-and-white checkered twister ' +
      'in Christophe R\u00e9sign\u00e9\'s Amiga Workbench for the browser (Chipbench, 2009).',
      '# Why 2.04?',
      'Release 2.04 of the Amiga\'s operating system (Kickstart 37.175, autumn 1991) was the first version 2 ' +
      'that most Amiga owners got, built into the Amiga 500 Plus. It brought the grey, 3D-shaded Workbench ' +
      'look that this demo\'s windows and gadgets imitate.',
      '# Thanks',
      'To my uncle Andreas Abelsson, alias King Grub, who introduced me to the Amiga, and who had endless ' +
      'patience with me, a brat in the Bart Simpson mould.',
    ] },
    { name: 'This demo', paragraphs: [
      '# Balls in a box',
      'Up to 1000 balls in a box. Every ball is a perfect sphere, worked out for each pixel it covers. The balls ' +
      'are hollow shells, they spin, and every collision happens at exactly the right moment and place.',
      '# Running time backwards',
      'Because every collision is exact, time can also run backwards (the << button, or Speed below zero). ' +
      'While it does, "<< REWIND" blinks in the corner. It cannot stay perfect forever: bouncing balls are ' +
      'chaotic, and every collision makes the computer\'s rounding errors (in the 16th digit) several times ' +
      'bigger. After some twenty collisions per ball the balls are on a different path.',
      'Digits on the Scene page sets how many digits the physics computes with: 16 (the computer\'s usual), ' +
      '32 or 64. More digits are slower, but the rewind lasts much longer: the Gas preset puts itself together ' +
      'again from about 4 seconds with 16 digits, 12 with 32 and over 30 with 64. (Press R after changing it, ' +
      'so the whole scene runs with the new digits.) Rewind test, on the Info page, runs a slightly nudged ' +
      'copy of the scene alongside and shows as it goes how close to the start running backwards would bring ' +
      'the balls: ok, drift (yellow) or lost (red; also after any change by hand, from a push to a slider ' +
      'on the Scene page). It only runs while the Controls are open. Switching it on, opening the Controls ' +
      'again, or changing Digits starts it afresh from that moment, ' +
      'and Restart measures from the start of the preset.',
      '# The presets',
      'The first four are showpieces: Four balls, Classic 1984, Carousel and Copper demo. The rest are little ' +
      'physics experiments. Under table: throw a super ball under a table and it comes back, because the first ' +
      'bounce makes it spin and the spin throws it backwards at the second. Break shot: billiards in mid-air, ' +
      'a yellow ball fired into a triangle of fifteen. Press << once they are well mixed, and watch the triangle ' +
      'put itself together again. Gas: a thousand tiny balls packed in a corner, without spin, spreading out to ' +
      'fill the box; watch "Spin share" on the Info page climb towards 50 %. Press << after a few seconds to see ' +
      'them pack themselves back into the corner.',
      '# The sound',
      'The boings are recordings from the original 1984 demo, restored: the two stereo channels lined up, ' +
      'rumble and hiss removed, and a gentle lift around 2 kHz so that they carry on small speakers. Each ' +
      'boing comes from the side of the screen where the bounce happens, and the harder the hit, the louder ' +
      'it is; clicking a ball plays the demo\'s other boing. The four chiptunes on the Sound page are not ' +
      'recordings: they are made from scratch in code, note by note.',
      '# The colours',
      'The four ball colours are exactly the base colours of the Natural Color System (NCS), a Swedish ' +
      'colour standard built on how we see colour: red #C40233, yellow #FFD300, green #009F6B and blue ' +
      '#0087BD. NCS rests on three pairs of opposite elementary colours, white and black, red and green, ' +
      'yellow and blue, and red, yellow, green and blue are the four hues that look pure, not like a mix of ' +
      'others. So the balls come in the four pure hues of human colour vision, by a Swedish standard. ' +
      'Even the Swedish flag is defined in it: its yellow is NCS 0580-Y10R and its blue NCS 4055-R95B.',
    ] },
    { name: 'Controls', paragraphs: [
      '# In the scene',
      'Drag to look around, scroll or pinch to zoom, and click a ball to give it a push.',
      '# The title bar',
      'The close gadget (left) puts the window away; move the mouse to bring it back. Then the speed of time ' +
      '(<<, || and >, and a slider), the presets (< and > step through them, as does clicking the name; ' +
      'Restart starts again), Open Controls, and the zoom gadget (right) for the full screen. ' +
      'After a few seconds without the mouse, everything fades away, the mouse pointer too, and leaves ' +
      'just the scene.',
      '# Keys',
      'Space: pause, or carry on at the speed it had. R: start the preset again. F: full screen on or off. ' +
      'Escape: leave full screen, or else close the window in front (a second Escape closes the next one). ' +
      '1 to 7: the presets, in order: 1 Four balls, 2 Classic 1984, 3 Carousel, 4 Copper demo, ' +
      '5 Under table, 6 Break shot, 7 Gas.',
      '# More with the mouse',
      'Shift-click or right-click on a button like the preset name steps backwards. Windows can be dragged ' +
      'by their title bars, and the Twist v4 window resized with its corner gadget (a wider window has room ' +
      'for more twists); a double-click on the twist shows it on the full screen.',
      '# The control pages',
      'Scene: how many balls, how big, how lively, gravity, how things bounce, and digits. On a phone or ' +
      'tablet, Tilt lets gravity pull the way you tilt it, so the balls roll downhill. ' +
      'Look: trails, copper bars, the scrolling text, shadows, big Amiga-style pixels, the lamp and the camera, ' +
      'and HDR (on an HDR screen, in browsers with WebGPU): a slider for how bright light brighter than white ' +
      'gets (0 = off): the copper bars, the glints, the scroller\'s letters and the twist then shine. ' +
      'Glints puts a shiny spot on each ball, where it mirrors the lamp; with HDR it shines brighter than white. ' +
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
      'only walls and gravity change them. "All energy" is all the energy there is; it only changes when you ' +
      'click a ball or move Energy or Gravity. "Spin share" is the share of the motion energy that is in ' +
      'spinning; rough balls end up near 50 %. "Rewind" is the rewind test (see This demo). The graph ' +
      'shows the last 20 seconds or so: the spin share in blue (0 to 100 %), and with the rewind test on, how ' +
      'far a rewind would miss in orange (on a log scale; above the dotted line it is lost). ' +
      'Below that: the time spent on physics and on drawing each ' +
      'frame, the highest frame rate your computer could manage, ball-on-ball hits per second, late frames ' +
      '(a picture shown twice, which makes the motion jerk, even when FPS says 60; in brackets, since the page ' +
      'was opened). The first graph only records while the Info page is shown; the graph below records all ' +
      'the time, the last two minutes: late frames in red, and in blue frames in which the balls didn\'t move ' +
      'evenly although the frame came on time (the physics had no new step ready, or showed two at once). ' +
      'The physics runs on a thread of its own, so a slow physics step never holds up the drawing, and the ' +
      'screen is kept from dimming while the demo runs.',
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
let awayUntil = 0;   // after the close gadget: stay away a moment, even if the mouse moves
function wakeControls(e) {
  if (e?.type === 'pointermove' && performance.now() < awayUntil) return;
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
// The close gadget at the left end of the title bar puts the window away at
// once (a web page can't close itself, and the show should go on). Moving
// the mouse again, after a moment, brings it back. In full screen it goes
// back to the window instead.
document.querySelector('.app-bar .window-close').addEventListener('click', () => {
  // In full screen, closing means leaving full screen, back to the window.
  if (fullScreenElement()) { toggleFullScreen(); return; }
  clearTimeout(idleTimer);
  document.body.classList.add('idle');
  awayUntil = performance.now() + 1500;
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

// HDR screens (the HDR slider on the Look page; see hdr.js). The scene is
// then drawn by a second renderer, on an OffscreenCanvas that never shows
// on the page, and WebGPU shows it; the page's canvas stays as it was,
// invisible, and still takes the clicks. With HDR off again, the page's
// own renderer takes over once more.
let screenRenderer = renderer;

// The browser can take the graphics card away from the page ("context
// lost"): when the graphics driver restarts, or when there are too many 3D
// pictures at once — which Safari can do on a quick reload, before the old
// page has given its own back. Everything drawn is then gone. Asking for
// it back (preventDefault), the page's renderer is made anew when it comes.
canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
canvas.addEventListener('webglcontextrestored', () => {
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
  needsRedraw = true;
}
async function setHdr(on) {
  twistOptions.hdr = on;
  if (!on) {
    if (renderer !== screenRenderer) useRenderer(screenRenderer);
    return 'HDR off';
  }
  if (renderer.hdr) return 'HDR is already on';
  if (!renderer.floatTarget) { twistOptions.hdr = false; return 'HDR not possible: this graphics card can\'t draw in floating point.'; }
  if (typeof OffscreenCanvas === 'undefined') { twistOptions.hdr = false; return 'HDR not possible: this browser has no OffscreenCanvas.'; }
  const { presenter, error } = await createHdrPresenter(canvas, HDR_RANGE, {
    onLost: (why) => {
      useRenderer(screenRenderer);
      settings.hdrStrength = 0;
      hdrSlider?.refresh();
      hdrChanged();
      console.warn('HDR switched off: WebGPU stopped (' + why + ')');
    },
  });
  if (error) { twistOptions.hdr = false; return 'HDR not possible: ' + error + '.'; }
  // (Its shaders are compiled in the background meanwhile, where the browser
  // can: the page keeps drawing as before until they are ready, rather than
  // stopping for a quarter of a second on the first HDR frame.)
  let hdrRenderer;
  try {
    hdrRenderer = new Renderer(new OffscreenCanvas(1, 1), canvas, { inBackground: true });
    await hdrRenderer.whenReady();
  } catch (e) {
    hdrRenderer?.dispose();
    presenter.dispose();
    twistOptions.hdr = false;
    return 'HDR not possible: ' + e.message;
  }
  hdrRenderer.hdr = presenter;
  useRenderer(hdrRenderer);
  return presenter.screenIsHdr
    ? 'HDR on'
    : 'HDR on, but this screen says it shows no HDR (on a Mac or in Windows, HDR may need switching on)';
}

// With HDR, the scroller's letters are drawn into the scene (see the
// copy-to-screen step in shaders.js), so they can be brighter than white;
// its own canvas stays, invisible, as the source of the picture.
function textGlowShown() { return scroller.shown && hdrOn(); }
function showTextGlow() {
  scroller.canvas.style.opacity = textGlowShown() ? '0' : '';
  needsRedraw = true;
}
let textVersion = 0;   // counts the scroller's pictures, so each is sent to the graphics card once
scroller.onDraw = () => { textVersion++; if (textGlowShown()) needsRedraw = true; };

window.boing = { physics, camera, settings, sounds, scroller, rewindCheck, applyRoom, showGrid, hdr: setHdr,
  tinker: (code) => physics.tinker(code) };   // (for trying things in the console)
Object.defineProperty(window.boing, 'renderer', { get: () => renderer });   // (whichever draws now)

// If the graphics driver resets (rare, e.g. after the computer sleeps),
// the simplest robust recovery is to reload the page.
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());


// --- Animation loop ----------------------------------------------------------
// The browser calls frame() before every screen refresh (60 times a second on
// most screens, 120+ on some). We measure how much real time has passed and
// advance the physics by exactly that much, so the speed is the same
// everywhere.

let lastTime = performance.now();

// Counted over one second, then shown and reset.
const counts = { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, late: 0, repeats: 0, jumps: 0, since: lastTime };

// The screen's refresh rate. The browser calls frame() once per refresh,
// but only if the previous frame is done, so when the demo can't keep up it
// is called less often. The highest rate ever seen is therefore the
// screen's real rate.
let screenRate = 1;

// While the page is hidden (another tab is in front, or the browser is
// minimised), everything stops: no physics, no drawing, and audio.js
// freezes the sound. Nothing is asked of the computer until you come back.
let frameRequested = false;
function requestFrame() {
  if (frameRequested) return;   // one is already on its way
  frameRequested = true;
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  lastTime = performance.now();   // the time away doesn't count
  requestFrame();
});

// The computer's time per frame: with the physics in its worker, it works
// side by side with the drawing, so the slower of the two counts.
const cpuMs = (physicsMs, drawMs) => (physics.inWorker ? Math.max(physicsMs, drawMs) : physicsMs + drawMs);

function frame(now) {
  frameRequested = false;
  if (document.hidden) return;   // stop here; started again when the page is shown

  // Seconds since the last frame. Capped, so that coming back to a tab that
  // was hidden for a minute doesn't make everything jump.
  const elapsed = Math.min((now - lastTime) / 1000, 0.1);
  // (A late frame: see details.late. Longer gaps than 0.1 s are pauses,
  // such as a hidden tab, not stutter.)
  if (screenRate > 0 && elapsed < 0.1 && now - lastTime > 1500 / screenRate) counts.late++;
  lastTime = now;

  sounds.enabled = settings.sound;
  renderer.measureGpu = infoShown();

  scroller.rate = settings.speed;   // the scrolling text pauses and rewinds with the balls
  // Say so on screen while time runs backwards ("<< REWIND", see index.html).
  if ((settings.speed < 0) !== showingRewind) {
    showingRewind = settings.speed < 0;
    document.body.classList.toggle('rewinding', showingRewind);
  }
  if (settings.autoCamera && !camera.locked) camera.autoMove(elapsed);
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
  physics.step(elapsed * settings.speed, settings.gravity, (0.8 * 1000) / Math.max(screenRate, 30));
  // ...and show the next finished one. None ready while the balls move: the
  // same picture of them twice, a stutter (see physics-client.js).
  // And a shown step that moves the balls further than one frame's worth
  // (steps that piled up, or time saved up while the physics was busy)
  // makes them leap ahead: a jump.
  const started = physics.started;   // (waiting for the very first step is no stutter)
  if (!physics.showNext() && settings.speed !== 0 && started) counts.repeats++;
  if (settings.speed !== 0) counts.jumps += physics.jumps;   // (see physics-client.js)
  physics.jumps = 0;

  if (settings.speed !== 0 || camera.changed || needsRedraw) {
    start = performance.now();
    renderer.draw(camera, physics.balls, {
      hdrStrength: settings.hdrStrength,
      glints: settings.glints,
      text: textGlowShown() ? scroller.canvas : null,
      textVersion,
      copper: settings.copper,
      backdropTime: physics.time,   // so the bars pause and rewind with the balls
      trailSeconds: settings.trails,
      trailTime: physics.time,
      grid: settings.grid,
      shadows: settings.shadows,
      stage: stage(),
    });
    // Without the graphics card's own timer, wait for it to finish this frame
    // (only while the Info page is shown, as waiting costs a little speed), so
    // that the measured time includes the card's work.
    // (Not with HDR: then WebGPU still has to show the frame, and making the
    // computer wait for the graphics card every frame makes the motion jerky.)
    if (infoShown() && !renderer.gpuTimer && !renderer.hdr) renderer.waitUntilDone();
    counts.drawMs += performance.now() - start;
    counts.drawn++;
    camera.changed = false;
    needsRedraw = false;
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
    const motion = physics.motionEnergy();
    const share = motion > 0 ? (100 * physics.spinEnergy()) / motion : 0;
    graph.sample(share, rewindCheck.enabled && !rewindCheck.changedByHand ? rewindCheck.estimate() : null);
    showTotals();
    graph.draw();
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
  screenRate = Math.max(screenRate, Math.round(counts.refreshes / seconds));
  settings.fps = Math.round(counts.drawn / seconds);
  fpsDisplay.setMax(screenRate);   // the bar is full at the screen's own rate

  if (infoShown()) {
    const physicsMs = counts.steps ? counts.physicsMs / counts.steps : 0;
    const drawMs = counts.drawn ? counts.drawMs / counts.drawn : 0;
    details.physics.set(`${physicsMs.toFixed(2)} ms`);
    details.hits.set(String(Math.round(hitsCounted / seconds)));
    details.late.set(`${Math.round(counts.late / seconds)}/s (${lateInAll})`);   // (in brackets: since the page was opened)
    lateGraph.draw();

    if (!counts.drawn) {
      details.graphics.set('–');   // nothing was drawn (paused)
      details.maxFps.set('–');
    } else if (renderer.gpuTimer) {
      // Measured by the graphics card itself. The computer and the card work
      // side by side, so a frame takes as long as the slower of the two.
      const gpuMs = renderer.gpuFrames ? renderer.gpuTotalMs / renderer.gpuFrames : 0;
      details.graphics.set(`${gpuMs.toFixed(2)} ms`);
      details.maxFps.set(String(Math.round(1000 / Math.max(cpuMs(physicsMs, drawMs), gpuMs))));
    } else {
      // Measured by waiting for the card: close, but slightly pessimistic,
      // because the computer and the card then take turns instead of
      // working side by side. Hence the "≈".
      // (Not with HDR: then the wait is skipped, as it would make the motion
      // jerky, so there is no measurement.)
      details.graphics.set(renderer.hdr ? '–' : `≈ ${drawMs.toFixed(2)} ms`);
      details.maxFps.set(renderer.hdr ? '–' : `≈ ${Math.round(1000 / cpuMs(physicsMs, drawMs))}`);
    }
  }

  renderer.gpuTotalMs = 0;
  renderer.gpuFrames = 0;
  hitsCounted = 0;
  Object.assign(counts, { refreshes: 0, drawn: 0, steps: 0, physicsMs: 0, drawMs: 0, late: 0, repeats: 0, jumps: 0, since: now });
}
