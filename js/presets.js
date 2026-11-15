// =============================================================================
// presets.js — the ready-made scenes of the Preset button.
//
// Choosing a preset puts every option back to its usual value
// (PRESET_DEFAULTS), then applies the preset's own `settings` on top, and
// turns the camera to the front. Only the two volume sliders are left
// alone: how loud you like it has nothing to do with the scene.
//
// Besides `settings`, a preset may have:
//   setup(physics)  – place the balls by hand instead of the usual start
//   lookDown        – tilt the camera down by this many degrees
//   page            – show this page of the panel (e.g. 'Info')
//   rewindAfter     – run forwards for this many seconds, then backwards to
//                     the start, pause a moment, and begin again
//
// The settings' names are those of `settings` in main.js. One special
// value: pixelSize 'amiga' means "whatever gives the 256 lines of an Amiga
// screen in this window".
// =============================================================================

import { Vec3 } from './math.js';

export const PRESET_DEFAULTS = {
  balls: 4, ballSize: 1, sizes: 1, gravity: 0.1, speed: 1,
  ballType: 'rough', wallType: 'smooth',
  sound: true, wallSound: false, music: false, track: 'jump',
  trails: 0, copper: false, scroller: false, credits: true, shadows: true, pixelSize: 1,
  grid: true, autoCamera: false, lamp: 21, lampTilt: 0,
};

const NO_SPIN = new Vec3(0, 0, 0);
const AT_REST = new Vec3(0, 0, 0);

// The first four are the showpieces; the others are more about the physics.
export const PRESETS = {
  four: {
    label: 'Four balls',
    settings: {},
  },

  // One big red-and-white ball bouncing from side to side: the demo that
  // introduced the Amiga in 1984. A double-sized ball; the lamp stands
  // almost in front, so the shadow falls on the back wall; and the ball
  // turns the other way after each side wall (Wall hits "1984").
  classic: {
    label: 'Classic 1984',
    settings: { ballSize: 2, gravity: 0.25, wallType: 'classic', wallSound: true, lamp: 37, lampTilt: 78 },
    setup: (physics) => physics.setBalls([{
      position: new Vec3(-3, 0, 0),
      velocity: new Vec3(2.5, 0, 0),
      radius: 2,    // (the same as Ball size 2.0)
      squares: 8,   // the original ball had 8 squares from pole to pole
      // Spinning around its own tilted axis, like a globe.
      spin: new Vec3(-Math.sin(Math.PI / 8), Math.cos(Math.PI / 8), 0).scale(2.4),
    }]),
  },

  // Many balls in the box, with the camera circling by itself. It looks
  // down from a little higher up, which puts it above the ceiling, so the
  // ceiling is out of the way.
  carousel: {
    label: 'Carousel',
    settings: { balls: 48, sizes: 2, sound: false, music: true, track: 'funk', autoCamera: true },
    lookDown: 28,
  },

  // A showpiece: balls of all sizes filling the whole window, over the
  // copper bars, in Amiga-sized pixels. (No boings: this many balls boing
  // almost without a break. Music instead.)
  demo: {
    label: 'Copper demo',
    settings: { balls: 32, sizes: 3, gravity: 0.04, sound: false, music: true, track: 'chip',
                copper: true, scroller: true, credits: false, pixelSize: 'amiga', grid: false, lamp: 45 },
  },

  // ---- The rest are little physics experiments. ----

  // The famous super ball trick: thrown under a table, the ball bounces off
  // the floor, then the underside of the table, then the floor again — and
  // comes back to the thrower. Here the floor and ceiling of the box play
  // floor and table. It only works with grippy walls: the first bounce makes
  // the ball spin, and that spin throws it backwards at the second.
  table: {
    label: 'Under table',
    settings: { gravity: 0, wallType: 'garwin', trails: 4, wallSound: true },
    setup: (physics) => physics.setBalls([{
      position: new Vec3(-4.5, 2, 0),
      velocity: new Vec3(3, -4, 0),
      spin: NO_SPIN,
    }]),
  },

  // Billiards without a table: a triangle of ten balls at rest, floating in
  // mid-air, and one fast ball fired into it. Everything starts in one flat
  // layer and has no reason to leave it, so it stays flat, like a game seen
  // from above. (The cue ball is aimed a hair off-centre: dead centre, the
  // break would come out perfectly mirrored.)
  breakShot: {
    label: 'Break shot',
    settings: { ballSize: 0.7, gravity: 0, trails: 6 },
    setup: (physics) => {
      const radius = 0.7;
      const gap = 2 * radius + 0.02;               // centre to centre, just not touching
      const balls = [{ position: new Vec3(-4.6, 0.06, 0), velocity: new Vec3(9, 0, 0), spin: NO_SPIN, radius }];
      for (let row = 0; row < 4; row++) {          // rows of 1, 2, 3 and 4 balls
        for (let i = 0; i <= row; i++) {
          const position = new Vec3(0.3 + row * gap * Math.sqrt(3) / 2, (i - row / 2) * gap, 0);
          balls.push({ position, velocity: AT_REST, spin: NO_SPIN, radius });
        }
      }
      physics.setBalls(balls);
    },
  },

  // One huge ball among forty tiny ones, weightless. The tiny ones keep
  // bumping into the giant from all sides and jostle it about — which is
  // how a speck of dust dances in still air ("Brownian motion").
  giant: {
    label: 'Giant+dwarfs',
    settings: { ballSize: 0.5, gravity: 0 },
    setup: (physics) => {
      physics.setBalls([{ position: new Vec3(0, 0, 0), velocity: AT_REST, spin: NO_SPIN, radius: 2.5 }]);
      physics.addRandomBalls(40, 0.5, 6);
    },
  },

  // Sixty small weightless balls: a model of a gas. The panel opens on the
  // Info page, where "Spin %" shows the collisions sharing the energy out
  // between moving and spinning until each has about half.
  gas: {
    label: 'Gas',
    settings: { balls: 60, ballSize: 0.6, gravity: 0 },
    page: 'Info',
  },

  // Order, chaos, and back again. 27 weightless balls float at rest in a
  // tidy block, and one ball is shot into them from above. For eight
  // seconds they scatter and collide. Then time runs backwards: every
  // collision un-happens, the block puts itself together again and the
  // ball flies back up. A short pause, and it starts over.
  // (Nothing is recorded: the same physics simply runs in reverse.)
  rewind: {
    label: 'Rewind',
    settings: { ballSize: 0.8, gravity: 0 },
    rewindAfter: 8,
    setup: (physics) => {
      const radius = 0.8;
      const gap = 2 * radius + 0.25;   // centre to centre
      const balls = [];
      for (let x = -1; x <= 1; x++) {
        for (let y = 0; y <= 2; y++) {
          for (let z = -1; z <= 1; z++) {
            balls.push({ position: new Vec3(x * gap, -4 + y * gap, z * gap), velocity: AT_REST, spin: NO_SPIN, radius });
          }
        }
      }
      // The shot: from the top, a little off-centre so the block bursts unevenly.
      balls.push({ position: new Vec3(0.21, 4.6, 0.13), velocity: new Vec3(1, -20, 0.5), spin: NO_SPIN, radius });
      physics.setBalls(balls);
    },
  },
};
