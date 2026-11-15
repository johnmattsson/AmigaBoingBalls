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
import { Renderer } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { Sounds } from './audio.js';
import { Panel, showRequester, closeFrontWindow } from './gui.js';
import { Vec3, raySphere } from './math.js';
import { openTwistWindow } from './twist.js';
import { Music, TRACKS } from './music.js';
import { Scroller } from './scroller.js';
import { PRESETS, PRESET_DEFAULTS } from './presets.js';

// Values the settings panel can change.
const settings = {
  fps: 0,          // measured frames per second (display only)
  energy: 1,       // total energy per ball; 1 = the classic start (see below)
  balls: 4,        // how many balls (1 … 100)
  ballSize: 1,     // how big the balls are (1 = the usual size)
  sizes: 1,        // how many times bigger the biggest ball is than the smallest (1 … 4)
  gravity: 0.1,    // 0 = floating, 0.5 = heavy
  speed: 1,        // 1 = normal, 0 = paused, negative = time runs backwards!
  sound: true,
  soundVolume: 1,      // how loud the boings are (0 … 1)
  music: false,        // play the chiptune
  musicVolume: 0.5,    // how loud the music is (0 … 1)
  wallSound: false,    // also boing when a ball hits a wall
  shadows: true,       // the balls cast shadows
  pixelSize: 1,        // 1 = sharp; more = big square pixels and 4096 colours
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

const physics = new Physics(settings.balls, sizeMix(settings.sizes));
const sounds = new Sounds();
// Add the same "?v=<version>" that index.html gave this script, so new
// sound files aren't held back by the browser's cache either.
const version = new URL(import.meta.url).search;
sounds.load('bounce', `static/bounce1.ogg${version}`);
sounds.load('click', `static/bounce2.ogg${version}`);

// A boing whenever two balls hit each other, coming from the side of the
// screen where they touch, and louder the harder they hit.
const FULL_VOLUME_SPEED = 8;   // impact speed (units/s) that gives full volume
let hitsCounted = 0;   // for the "Hits/s" detail row
physics.onBallCollision = (a, b, impactSpeed) => {
  hitsCounted++;
  const contact = a.position.add(b.position).scale(0.5);
  // Our ears hear loudness roughly logarithmically, so the volume rises
  // quickly for soft hits and levels off for hard ones. Even the gentlest
  // touch stays faintly audible.
  const volume = Math.max(0.08, Math.min(1, impactSpeed / FULL_VOLUME_SPEED) ** 0.7);
  sounds.play('bounce', camera.screenX(contact), volume);
};

// With "Wall sound" on, the same boing when a ball hits a wall, as in the
// original demo, coming from where the ball is on screen.
physics.onWallCollision = (ball, wallDirection, impactSpeed) => {
  if (!settings.wallSound) return;
  const volume = Math.max(0.08, Math.min(1, impactSpeed / FULL_VOLUME_SPEED) ** 0.7);
  sounds.play('bounce', camera.screenX(ball.position), volume);
};

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
  physics.totalEnergy(settings.gravity) / (physics.balls.length * ENERGY_UNIT);

// ---- The settings panel ------------------------------------------------------
const panel = new Panel(document.body);

// The panel's rows are spread over four pages, chosen with the tabs at the
// top. The numbers on the Info page take a little work to produce, so they
// are only worked out while that page is shown.
const PAGES = ['Scene', 'Look', 'Sound', 'Info'];
// (And only while the panel is open: otherwise nobody can see them.)
const infoShown = () => panel.isOpen && panel.page === 'Info';
panel.addTabs(PAGES);

// FPS: how many frames the demo actually drew last second. The bar is full at
// your screen's refresh rate (the most a browser will ever draw). While
// paused with nothing changing, nothing needs drawing, so it shows 0.
const fpsDisplay = panel.addSlider('FPS', settings, 'fps', { min: 0, max: 60, step: 1, readOnly: true });

// ---- Presets: ready-made scenes (see presets.js) ------------------------------
function applyPreset(name) {
  const preset = PRESETS[name];
  Object.assign(settings, PRESET_DEFAULTS, preset.settings);
  // 'amiga' = the size that gives an Amiga screen's 256 lines. It keeps
  // following the window's size until you move the Pixel size slider.
  pixelsFollowWindow = settings.pixelSize === 'amiga';
  if (pixelsFollowWindow) settings.pixelSize = amigaPixelSize();
  camera.lookFromFront();
  if (preset.lookDown) {
    camera.polar = ((90 - preset.lookDown) * Math.PI) / 180;
    camera.update();
  }
  physics.room = settings.grid ? boxRoom() : screenRoom();   // before the balls are placed in it
  physics.ballSize = settings.ballSize;
  if (preset.setup) {
    preset.setup(physics);
  } else {
    // Start over with fresh balls of the chosen number and size mix.
    physics.balls = [];
    physics.sizeMix = sizeMix(settings.sizes);
    physics.setBallCount(settings.balls);
  }
  applySettings();
  if (preset.page) panel.showPage(preset.page);

  // A preset with `rewindAfter` runs forwards that many seconds, then
  // backwards to where it started, pauses, and begins again (see rewindStep).
  rewind = preset.rewindAfter
    ? { after: preset.rewindAfter, startTime: physics.time, phase: 'forwards', pauseLeft: 0, restart: preset.setup }
    : null;
}

// ---- The Rewind preset's back-and-forth ------------------------------------------
// While `rewind` is set, time is steered from here instead of simply
// following the Speed setting: forwards for `after` seconds, backwards to
// the exact start, a pause, and again. The Speed setting still says how
// fast (and Space still pauses); its sign shows which way time is running.
let rewind = null;
const REWIND_PAUSE = 2;   // seconds of standing still before starting over

// How far the physics should move during a frame that took `elapsed` seconds.
function rewindStep(elapsed) {
  const pace = Math.abs(settings.speed);
  const played = physics.time - rewind.startTime;   // how far into the run we are
  const showDirection = (sign) => { settings.speed = sign * pace; speedSlider.refresh(); };

  if (rewind.phase === 'pause') {
    rewind.pauseLeft -= elapsed;
    if (rewind.pauseLeft <= 0) rewind.phase = 'forwards';
    return 0;
  }
  if (rewind.phase === 'forwards') {
    // Never go past the turning point: the last step ends exactly on it.
    const step = Math.min(elapsed * pace, rewind.after - played);
    if (pace > 0 && played + step >= rewind.after - 1e-9) {
      rewind.phase = 'backwards';
      showDirection(-1);
    }
    return step;
  }
  // Backwards: the last step ends exactly at the start.
  const step = -Math.min(elapsed * pace, played);
  if (pace > 0 && played + step <= 1e-9) {
    rewind.phase = 'pause';
    rewind.pauseLeft = REWIND_PAUSE;
    showDirection(1);
    // Rounding leaves the balls a hair's breadth (millionths of a unit)
    // from where they began. Putting them back exactly keeps that from
    // adding up over many rounds.
    rewind.restart?.(physics);
    rewind.startTime = physics.time;
  }
  return step;
}

// The pixel size that gives the 256 lines of a (European) Amiga screen in
// this window, to the nearest half.
function amigaPixelSize() {
  return Math.min(PIXEL_SIZE_MAX, Math.max(1.5, Math.round((canvas.clientHeight / 256) * 2) / 2));
}
const PIXEL_SIZE_MAX = 6;
let pixelsFollowWindow = false;

// Make everything follow `settings` after a preset changed several at once.
function applySettings() {
  settings.balls = physics.balls.length;
  physics.ballBounce = COLLISION_TYPES[settings.ballType];
  physics.wallBounce = COLLISION_TYPES[settings.wallType];
  physics.trailSeconds = settings.trails;
  physics.clearTrails();
  physics.changed();
  camera.locked = !settings.grid;
  showCopper(settings.copper);
  showPixels(settings.pixelSize);
  scroller.setShown(settings.scroller);
  showCredits(settings.credits);
  music.setTrack(settings.track);
  music.setPlaying(settings.music);
  for (const control of controls) control.refresh();
  needsRedraw = true;
}

const controls = [];   // everything applySettings() has to redraw
controls.push(panel.addCycle('Preset', settings, 'preset',
  Object.entries(PRESETS).map(([value, preset]) => ({ value, label: preset.label })), applyPreset));

// If the box is too full for the number asked for, the slider shows how
// many balls actually fit.
const showBallCount = () => {
  settings.balls = physics.balls.length;
  ballSlider.refresh();
  needsRedraw = true;
};
panel.startPage('Scene');
const ballSlider = panel.addSlider('Balls', settings, 'balls', {
  min: 1, max: 100, step: 1,
  onChange: (count) => { rewind = null; physics.setBallCount(count); showBallCount(); },
});
// Size mix: 1.0 = all balls equal; 4.0 = the biggest ball is four times as
// wide as the smallest (from half to double the standard size).
// Ball size: 1.0 = the usual size; the Classic 1984 ball is 2.0.
controls.push(panel.addSlider('Ball size', settings, 'ballSize', {
  min: 0.5, max: 2.5, step: 0.1,
  onChange: (size) => { rewind = null; physics.setBallSize(size); showBallCount(); },
}));
controls.push(ballSlider, panel.addSlider('Size mix', settings, 'sizes', {
  min: 1, max: 4, step: 0.1,
  onChange: (ratio) => { rewind = null; physics.setSizeMix(sizeMix(ratio)); showBallCount(); },
}));
const ENERGY_SLIDER_MAX = 5;
const energySlider = panel.addSlider('Energy', settings, 'energy', {
  min: 0, max: ENERGY_SLIDER_MAX, step: 0.1,
  onChange: (value) => physics.setTotalEnergy(value * physics.balls.length * ENERGY_UNIT, settings.gravity),
});
controls.push(panel.addSlider('Gravity', settings, 'gravity', { min: 0, max: 0.5, step: 0.01 }));
const speedSlider = panel.addSlider('Speed', settings, 'speed', {
  min: -2, max: 2, step: 0.1,
  // (Setting the speed by hand ends the Rewind preset's back-and-forth, as
  // does changing the balls: otherwise its next round would undo your change.)
  onChange: () => { rewind = null; },
});
controls.push(speedSlider);

// How things bounce (explained in physics.js and in the About window).
const BOUNCE_CHOICES = [
  { value: 'rough', label: 'Rough' },     // (1, 1, 1)
  { value: 'garwin', label: 'Garwin' },   // (1, 1, -1)
  { value: 'smooth', label: 'Smooth' },   // (1, -1, -1)
  { value: 'twist', label: 'Twist' },     // (1, -1, 1)
];
controls.push(panel.addCycle('Ball hits', settings, 'ballType', BOUNCE_CHOICES,
  (type) => { physics.ballBounce = COLLISION_TYPES[type]; }));
// Walls have one more choice, "1984": slippery, and the ball turns the
// other way after every bounce off a side wall, as in the original demo.
// (Not real physics: see COLLISION_TYPES.classic in physics.js.)
controls.push(panel.addCycle('Wall hits', settings, 'wallType',
  [...BOUNCE_CHOICES, { value: 'classic', label: '1984' }],
  (type) => { physics.wallBounce = COLLISION_TYPES[type]; }));

panel.startPage('Sound');
// The boings, their loudness, and whether walls boing too.
controls.push(panel.addCheckbox('Boings', settings, 'sound'));
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
controls.push(panel.addCheckbox('Scroller', settings, 'scroller', (on) => scroller.setShown(on)));
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
  };
}

function applyRoom() {
  physics.setRoom(settings.grid ? boxRoom() : screenRoom());
  showBallCount();   // balls that no longer fit were removed
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
  onChange: (size) => { pixelsFollowWindow = false; showPixels(size); },
});
controls.push(pixelSlider);

// The lamp's usual height: 21 over the box, as always. Over the much wider
// window-sized room it hangs higher, so that the shadows stay close to
// under the balls.
const LAMP_OVER_BOX = 21;
const LAMP_OVER_WINDOW = 45;

// "Grid+cam": with the grid you also get the camera you can turn; without
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
const gridBox = panel.addCheckbox('Grid+cam', settings, 'grid', showGrid);
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
  onChange: () => { needsRedraw = true; },
});
controls.push(lampSlider);
controls.push(panel.addSlider('Lamp tilt', settings, 'lampTilt', {
  min: 0, max: 90, step: 1,
  onChange: () => { needsRedraw = true; },
}));

// ---- The Info page ---------------------------------------------------------------
// First the conservation laws at work, updated a few times a second.
panel.startPage('Info');
const physicsInfo = {
  energy: panel.addReadout('E total'),    // all energy, in "classic starts"
  momentum: panel.addReadout('Momentum'),    // size of the total momentum
  angular: panel.addReadout('Ang.mom.'),    // size of the total angular momentum
  spin: panel.addSlider('Spin %', settings, 'spinShare', { min: 0, max: 100, step: 1, readOnly: true }),
};

// The totals:
//  - E total (all energy) only changes when you click a ball or move
//    Energy or Gravity.
//  - Momentum and angular momentum are passed between balls when they hit
//    each other but never lost; only the walls and gravity change the totals.
//  - Spin %: how much of the motion energy is in spinning. With rough balls
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
};

// Below the pages, always shown: the two windows.
panel.startPage(null);
panel.showPage(PAGES[0]);

// ---- Keyboard shortcuts ----------------------------------------------------------
//   Space   pause, and carry on at the speed it had
//   Escape  close the window in front
//   1 … 9, 0  the presets (0 would be a tenth)
let speedBeforePause = 1;
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave the browser's own shortcuts alone
  const presetNames = Object.keys(PRESETS);
  if (e.code === 'Space') {
    // (Stops the page scrolling. Space would also press whichever button
    // was clicked last, so that is stopped too, on keyup below.)
    e.preventDefault();
    if (e.repeat) return;
    if (settings.speed !== 0) {
      speedBeforePause = settings.speed;
      settings.speed = 0;
    } else {
      settings.speed = speedBeforePause;
    }
    speedSlider.refresh();
  } else if (e.key === 'Escape') {
    closeFrontWindow();
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
panel.addButton('Twist...', openTwistWindow);

// ---- About ---------------------------------------------------------------------
let aboutIsOpen = false;
panel.addButton('About...', () => {
  if (aboutIsOpen) return;   // one is enough
  aboutIsOpen = true;
  showRequester('About Amiga Boing Balls', [
  '# The original',
  'The Boing Ball was the star of the Amiga\'s first public showing: a red-and-white checkered ball, ' +
  'spinning, bouncing and booming in stereo. Dale Luck and R. J. Mical wrote the demo in January 1984, at the ' +
  'Consumer Electronics Show, for the prototype computer code-named Lorraine. The ball became the symbol of ' +
  'the Amiga. Pick the preset "Classic 1984" for a reminder.',
  '# This version',
  'Up to 100 balls in a box. Drag to look around, scroll or pinch to zoom, and click a ball to give it a push. ' +
  'Every ball is a perfect sphere, worked out for each pixel it covers. The balls are hollow shells, and ' +
  'every collision happens at exactly the right moment and place, so time can also run backwards ' +
  '(Speed below zero, or the preset "Rewind").',
  'Keys: Space pauses, Escape closes the window in front, and 1 to 9 choose a preset. ' +
  'Shift-click or right-click the Preset button (or any button like it) to step backwards.',
  '# The controls',
  'Scene: how many balls, how big, how lively, gravity, the speed of time, and how things bounce. ' +
  'Look: trails, copper bars, the scrolling text, shadows, big Amiga-style pixels, the lamp, and the camera. ' +
  'Turn "Grid+cam" off and the window itself becomes the room. ' +
  'Sound: the boings, and four chiptunes made from scratch in code. ' +
  'Info: the physics at work, and how fast your computer draws it all.',
  '# The presets',
  'The first four are showpieces: Four balls, Classic 1984, Carousel and Copper demo. The rest are little ' +
  'physics experiments. Under table: throw a super ball under a table and it comes back, because the first ' +
  'bounce makes it spin and the spin throws it backwards at the second. Break shot: billiards in mid-air. ' +
  'Giant+dwarfs: one huge ball jostled about by forty tiny ones, like a speck of dust in the air. ' +
  'Gas: watch "Spin %" on the Info page settle near 50. Rewind: a tidy block blown apart, and put back ' +
  'together by running time backwards.',
  '# How things bounce',
  'A bounce is described by three numbers: what happens to the speed straight into the surface, to the ' +
  'sliding along it, and to the twisting against it. 1 means it is reversed, -1 that it carries on untouched.',
  'Rough (1, 1, 1): everything reverses. Garwin (1, 1, -1): the ideal super ball. Smooth (1, -1, -1): ' +
  'slippery, spin is ignored. Twist (1, -1, 1): slippery, but twisting reverses. ' +
  'These are the only four kinds of bounce that lose no energy. Walls can also be "1984": slippery, and ' +
  'the ball turns the other way after each side wall, as in the original demo (a real ball would not).',
  '# The Info page',
  'When balls hit each other they pass on momentum and angular momentum, but the totals stay the same; ' +
  'only walls and gravity change them. "E total" is all the energy there is; it only changes when you ' +
  'click a ball or move Energy or Gravity. "Spin %" is the share of the motion energy that is in spinning; ' +
  'rough balls end up near 50. Below that: the time spent on physics and on drawing each frame, the highest ' +
  'frame rate your computer could manage, and ball-on-ball hits per second.',
  '# Thanks',
  'To my uncle Andreas Abelsson, alias King Grub, who introduced me to the Amiga.',
  ], () => { aboutIsOpen = false; });
});

// The picture only needs redrawing when something changed: the balls move,
// the camera moves, the window is resized or a ball is added or removed.
// While paused with nothing happening we skip drawing, which saves battery.
let needsRedraw = true;

// Keep the picture sharp and undistorted when the window changes size.
function resize() {
  if (pixelsFollowWindow && settings.pixelSize !== amigaPixelSize()) {
    settings.pixelSize = amigaPixelSize();
    renderer.pixelSize = settings.pixelSize;
    pixelSlider.refresh();
  }
  renderer.resize();
  camera.resize(canvas.clientWidth, canvas.clientHeight);
  if (!settings.grid) applyRoom();   // the window-sized room follows the window
  needsRedraw = true;
}
addEventListener('resize', resize);
resize();

// Handy for experimenting: type `boing.physics.balls[0]` in the browser's
// developer console to inspect or change a ball while the demo runs.
window.boing = { physics, camera, settings, sounds, renderer, get rewind() { return rewind; } };

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
const counts = { refreshes: 0, drawn: 0, physicsMs: 0, drawMs: 0, since: lastTime };

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

function frame(now) {
  frameRequested = false;
  if (document.hidden) return;   // stop here; started again when the page is shown

  // Seconds since the last frame. Capped, so that coming back to a tab that
  // was hidden for a minute doesn't make everything jump.
  const elapsed = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  sounds.enabled = settings.sound;
  renderer.measureGpu = infoShown();

  scroller.rate = settings.speed;   // the scrolling text pauses and rewinds with the balls
  if (settings.autoCamera && !camera.locked) camera.autoMove(elapsed);
  let start = performance.now();
  physics.update(rewind ? rewindStep(elapsed) : elapsed * settings.speed, settings.gravity);
  counts.physicsMs += performance.now() - start;

  if (settings.speed !== 0 || camera.changed || needsRedraw) {
    start = performance.now();
    renderer.draw(camera, physics.balls, {
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
    if (infoShown() && !renderer.gpuTimer) renderer.waitUntilDone();
    counts.drawMs += performance.now() - start;
    counts.drawn++;
    camera.changed = false;
    needsRedraw = false;
  }

  // Keep the Energy slider showing the current energy (unless you're dragging it).
  const energy = Math.round(energyPerBall() * 10) / 10;
  if (!energySlider.dragging && energy !== settings.energy) {
    settings.energy = energy;
    // Big or fast balls can have more energy than the slider usually goes
    // to: then its range grows to fit.
    energySlider.setMax(Math.max(ENERGY_SLIDER_MAX, Math.ceil(energy)));
    energySlider.refresh();
  }

  // The totals on the Info page: a few times a second is plenty for reading numbers.
  if (infoShown() && counts.refreshes % 8 === 0) showTotals();

  counts.refreshes++;
  if (now - counts.since >= 1000) showCounts(now);

  requestFrame();
}
requestFrame();

// Once a second: update FPS and the performance rows on the Info page.
function showCounts(now) {
  const seconds = (now - counts.since) / 1000;
  screenRate = Math.max(screenRate, Math.round(counts.refreshes / seconds));
  settings.fps = Math.round(counts.drawn / seconds);
  fpsDisplay.setMax(screenRate);   // the bar is full at the screen's own rate

  if (infoShown()) {
    const physicsMs = counts.physicsMs / counts.refreshes;
    const drawMs = counts.drawn ? counts.drawMs / counts.drawn : 0;
    details.physics.set(`${physicsMs.toFixed(2)} ms`);
    details.hits.set(String(Math.round(hitsCounted / seconds)));

    if (!counts.drawn) {
      details.graphics.set('–');   // nothing was drawn (paused)
      details.maxFps.set('–');
    } else if (renderer.gpuTimer) {
      // Measured by the graphics card itself. The computer and the card work
      // side by side, so a frame takes as long as the slower of the two.
      const gpuMs = renderer.gpuFrames ? renderer.gpuTotalMs / renderer.gpuFrames : 0;
      details.graphics.set(`${gpuMs.toFixed(2)} ms`);
      details.maxFps.set(String(Math.round(1000 / Math.max(physicsMs + drawMs, gpuMs))));
    } else {
      // Measured by waiting for the card: close, but slightly pessimistic,
      // because the computer and the card then take turns instead of
      // working side by side. Hence the "≈".
      details.graphics.set(`≈ ${drawMs.toFixed(2)} ms`);
      details.maxFps.set(`≈ ${Math.round(1000 / (physicsMs + drawMs))}`);
    }
  }

  renderer.gpuTotalMs = 0;
  renderer.gpuFrames = 0;
  hitsCounted = 0;
  Object.assign(counts, { refreshes: 0, drawn: 0, physicsMs: 0, drawMs: 0, since: now });
}
