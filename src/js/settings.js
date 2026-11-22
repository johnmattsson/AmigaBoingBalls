// =============================================================================
// settings.js — every setting of the demo, described once.
//
// For each setting: the value it starts with, what it may be, whom it
// belongs to, and how it shows in the Controls. From this one list come the
// settings themselves (see main.js), what a preset puts back
// (PRESET_DEFAULTS, below), the Controls' rows (Panel.addPage in gui.js),
// and the check of values read back from the browser (see clean).
//
//   start    – its value when the page opens
//   min, max, step – a number in that range (a slider)
//   choices  – one of these values (a choice button, with a menu of them)
//   (neither: a switch, true or false: a checkbox)
//   own      – true: it belongs to you or your screen (loudness, Glints,
//              HDR), not to the scene. A preset leaves
//              it alone. All the others a preset puts back to `start`
//              before applying its own.
//   shown    – only shown, never kept (the measured frame rate, the energy)
//   forgotten – not kept for the next visit (see state.js): the page always
//              starts running forwards, with Tilt and the Rewind test off
//
// And for the Controls (settings without a page are elsewhere: Speed on the
// speed bar, the preset in the preset menu, or are part of another's row):
//   page     – the page of the Controls it is on; the rows of a page come
//              in the order of this list
//   label    – its name there
//   labels   – the names of its choices
//   log      – a slider whose steps multiply the value (see slider in gui.js)
//   gauge    – a slider that only shows the value, filling up (FPS)
//   offWith  – this row also switches that setting: its first choice
//              (offLabel) turns that one off, the others turn it on.
//              (Backdrop: None or one of the backdrops; Auto cam: Off or a
//              way to move. Kept apart because a preset can choose the way
//              the camera will move without starting it.)
//   levels   – this row sets several settings at once, one of a few ways:
//              [{ label, set }]; it shows the first whose `set` all hold
//              (Boings: Off, for the balls, or for the walls too)
//   ghostUnless – the row is ghosted (dotted over and switched off, as the
//              Workbench did) unless this holds: when it would change
//              nothing just now (Music vol with the music off, say)
//   lineBefore – a thin groove above the row: a new group of rows begins
//
// (No imports: the physics' worker reads this too, by way of presets.js.)
// =============================================================================

export const MAX_BALLS = 4000;        // (also the room in the graphics card's tables: see shaders.js)
const PIXEL_SIZE_MAX = 6;      // the biggest Pixel size

// How things bounce (explained in physics.js and in the About window).
const BOUNCES = { rough: 'Rough', garwin: 'Garwin', smooth: 'Smooth', twist: 'Twist', classic: '1984' };

export const SETTINGS = {
  // ---- Scene ----
  balls: { start: 4, min: 0, max: MAX_BALLS, step: 1, page: 'Scene', label: 'Balls', log: true },   // how many balls (0: only the backdrop)
  ballSize: { start: 1, min: 0.25, max: 2.5, step: 0.05, page: 'Scene', label: 'Ball size' },         // how big they are (1 = the usual size)
  sizes: { start: 1, min: 1, max: 4, step: 0.1, page: 'Scene', label: 'Size mix', ghostUnless: (s) => s.balls > 1 },   // how many times bigger the biggest is than the smallest
  // energy per ball; 1 = the classic start (set by hand: see the Energy
  // slider in main.js, whose range grows if the balls have more)
  energy: { start: 1, min: 0, max: 5, step: 0.1, shown: true, page: 'Scene', label: 'Energy', ghostUnless: (s) => s.balls > 0 },
  gravity: { start: 1, min: 0, max: 5, step: 0.1, page: 'Scene', label: 'Gravity' },                  // 0 = floating, 1 = the usual, 5 = heavy
  tilt: { start: false, own: true, forgotten: true, page: 'Scene', label: 'Tilt' },                   // tilt the phone or tablet to tilt gravity
  // how balls bounce off each other (see COLLISION_TYPES in physics.js) and off the walls
  ballType: { start: 'rough', choices: ['rough', 'garwin', 'smooth', 'twist'], page: 'Scene', label: 'Ball hits', lineBefore: true, labels: BOUNCES, ghostUnless: (s) => s.balls > 1 },
  wallType: { start: 'smooth', choices: ['rough', 'garwin', 'smooth', 'twist', 'classic'], page: 'Scene', label: 'Wall hits', labels: BOUNCES },
  // how many digits the physics computes with (see precise.js), named after
  // the standard number sizes they come closest to (see main.js). (On the
  // Info page, by the Rewind test: more digits make a rewind last longer.)
  digits: { start: 16, choices: [16, 32, 64], page: 'Info', label: 'Precision', labels: { 16: 'Double', 32: 'Quadruple', 64: 'Octuple' } },
  speed: { start: 1, min: -5, max: 5, step: 0.1, forgotten: true },   // 1 = normal, 0 = paused, negative = time runs backwards! (the speed bar)

  // ---- Show (what you see and hear: the backdrop, the texts, trails; then the sound) ----
  trails: { start: 0, min: 0, max: 10, step: 0.5, page: 'Show', label: 'Trails' },   // how many seconds long the fading line behind every ball is
  copper: { start: false },                                        // a backdrop instead of the plain room ...
  // ... which (bars = copper bars; the last three are the demo effects, behind the balls)
  backdrop: {
    start: 'bars', choices: ['bars', 'stars', 'plasma', 'kefrens', 'twist', 'bobs', 'tunnel'],
    page: 'Show', label: 'Backdrop', offWith: 'copper', offLabel: 'None',
    labels: { bars: 'Copper', stars: 'Stars', plasma: 'Plasma', kefrens: 'Kefrens', twist: 'Twist', bobs: 'Bobs', tunnel: 'Tunnel' },
  },
  scroller: { start: false, page: 'Show', label: 'Scroller' },     // a scrolling text along the bottom
  credits: { start: true, page: 'Show', label: 'Credits' },        // the credit line at the very bottom
  // HDR: how bright light brighter than white gets (0 = off; WebGPU only, see
  // gpu-renderer.js). On from the start, at 0.3, where the screen says it
  // shows HDR; where it can't be done (WebGL, an older browser) it quietly
  // goes to 0.
  hdrStrength: {
    start: typeof matchMedia === 'function' && matchMedia('(dynamic-range: high)').matches ? 0.3 : 0,
    min: 0, max: 2, step: 0.1, own: true, page: 'Info', label: 'HDR',
    // (Always there, ghosted where it would do nothing: see showHdrControl
    // in hdr.js, which sets hdrWorks.)
    ghostUnless: (s) => s.hdrWorks !== false,
  },
  // ---- Room ----
  grid: { start: true, page: 'Room', label: 'In a box' },          // show the box (off: the window is the room)
  autoCamera: { start: false },                                    // let the camera move by itself ...
  // ... how: all the way round, side to side in front, round and up and down, or in and out
  camMove: {
    start: 'orbit', choices: ['orbit', 'swing', 'rise', 'zoom'],
    page: 'Room', label: 'Auto cam', offWith: 'autoCamera', offLabel: 'Off',
    ghostUnless: (s) => s.grid,   // (without the box the camera stays put)
    labels: { orbit: 'Round', swing: 'Swing', rise: 'Rise', zoom: 'Zoom' },
  },
  // The lamp: off, there are neither shadows nor glints (each can also be
  // switched off by itself), and its rows are ghosted.
  lampOn: { start: true, page: 'Room', label: 'Lamp', lineBefore: true },
  shadows: { start: true, page: 'Room', label: 'Shadows', ghostUnless: (s) => s.lampOn },   // the balls cast shadows
  // a glint where each ball mirrors the lamp (0 = none, 1 = white; brighter with HDR)
  glints: { start: 0.5, min: 0, max: 1, step: 0.1, own: true, page: 'Room', label: 'Glints', ghostUnless: (s) => s.lampOn },
  lamp: { start: 21, min: 10, max: 80, step: 1, page: 'Room', label: 'Lamp dist', ghostUnless: (s) => s.lampOn },       // how far away the lamp is (it makes the shadows)
  lampTilt: { start: 0, min: 0, max: 90, step: 1, page: 'Room', label: 'Lamp tilt', ghostUnless: (s) => s.lampOn },     // where it is: 0° = straight above … 90° = right in front

  // ---- Show, the sound ----
  // the boings, and also when a ball hits a wall? (One row: Off, Balls, or
  // Balls and walls.)
  sound: {
    start: true, page: 'Show', label: 'Boings', lineBefore: true,
    levels: [
      { label: 'Off', set: { sound: false } },
      { label: 'Balls', set: { sound: true, wallSound: false } },
      { label: 'And walls', set: { sound: true, wallSound: true } },
    ],
  },
  wallSound: { start: false },
  soundVolume: { start: 0.5, min: 0, max: 1, step: 0.05, own: true, page: 'Show', label: 'Boing vol', ghostUnless: (s) => s.sound },   // how loud they are
  music: { start: false },                                         // play the chiptune ...
  // ... which tune (its name: TRACKS in music.js). (One row: Off, or a tune.)
  track: { start: 'jump', choices: ['jump', 'anthem', 'funk', 'chip', 'mega'], page: 'Show', label: 'Music', offWith: 'music', offLabel: 'Off' },
  musicVolume: { start: 0.5, min: 0, max: 1, step: 0.05, own: true, page: 'Show', label: 'Music vol', ghostUnless: (s) => s.music },   // how loud the music is

  // ---- Info ----
  fps: { start: 0, min: 0, max: 60, step: 1, shown: true, gauge: true, page: 'Info', label: 'FPS' },   // measured frames per second (the bar is full at the screen's rate)
  // How it is drawn, which decides how fast as much as how it looks, so on
  // the Info page and yours (a preset leaves it alone): Pixel size 1 = as
  // sharp as the screen allows; more = big square pixels (see renderer.js).
  pixelSize: { start: 1, min: 1, max: PIXEL_SIZE_MAX, step: 0.5, own: true, page: 'Info', label: 'Pixel size' },
  rewindEstimate: { start: false, own: true, forgotten: true, page: 'Info', label: 'Rewind test' },     // the Rewind test (costs some time)

  // ---- Not in the Controls ----
  preset: { start: 'four', own: true },                            // which ready-made scene was last chosen (see presets.js): the preset menu
};

// The settings as the page starts with them.
export const startSettings = () => Object.fromEntries(Object.entries(SETTINGS).map(([key, about]) => [key, about.start]));

// What choosing a preset puts back before applying its own: every setting
// of the scene.
export const PRESET_DEFAULTS = Object.fromEntries(
  Object.entries(SETTINGS).filter(([, about]) => !about.own && !about.shown).map(([key, about]) => [key, about.start]));

// A slider's range: { min, max, step }.
export const rangeOf = (key) => ({ min: SETTINGS[key].min, max: SETTINGS[key].max, step: SETTINGS[key].step });

// A value from outside (a saved state) for this setting: the value
// to use, or undefined if it is none this setting can have. Numbers are
// brought into the range and onto the slider's steps.
export function clean(key, value) {
  const about = SETTINGS[key];
  if (!about || about.shown) return undefined;
  if (about.choices) return about.choices.includes(value) ? value : undefined;
  if (typeof about.start === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (typeof about.start === 'string') return typeof value === 'string' ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const stepped = Math.round(Math.min(about.max, Math.max(about.min, value)) / about.step) * about.step;
  return Number(stepped.toFixed(6));
}

// A choice button's choices, in order, each with its name: [{ value, label }].
export const choicesOf = (key, labels = SETTINGS[key].labels) => SETTINGS[key].choices.map((value) => ({ value, label: labels[value] }));

// The Controls' pages, in order, and the settings on each.
export const PAGES = ['Scene', 'Show', 'Room', 'Info'];
export const settingsOn = (page) => Object.keys(SETTINGS).filter((key) => SETTINGS[key].page === page);
