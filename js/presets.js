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
//
// The settings' names are those of `settings` in main.js.
// =============================================================================

import { Vec3 } from './math.js';
import { BOX_HALF_SIZE } from './physics.js';

export const PRESET_DEFAULTS = {
  balls: 4, ballSize: 1, sizes: 1, gravity: 0.1, speed: 1,
  ballType: 'rough', wallType: 'smooth',
  sound: true, wallSound: false, music: false, track: 'jump',
  trails: 0, copper: false, scroller: false, credits: true, shadows: true, pixelSize: 1,
  grid: true, autoCamera: false, lamp: 21, lampTilt: 0, digits: 16,
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
  // copper bars. (No boings: this many balls boing almost without a break.
  // Music instead.)
  demo: {
    label: 'Copper demo',
    settings: { balls: 32, sizes: 3, gravity: 0.04, sound: false, music: true, track: 'chip',
                copper: true, scroller: true, credits: false, grid: false, lamp: 45 },
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

  // Billiards without a table. A triangle of fifteen red, blue and green
  // balls floats at rest in mid-air, and one fast yellow ball is fired into
  // it. Everything starts in one flat layer and has no reason to leave it,
  // so it stays flat, like a game seen from above. (The yellow ball is aimed
  // a hair off-centre: dead centre, the break would come out perfectly
  // mirrored.) Run time backwards (the << button) after a while, and every
  // collision un-happens until the triangle has put itself together again.
  // (Nothing is recorded: the same physics runs in reverse. After about ten
  // seconds, or ten hits per ball, is about as far as the sixteen digits of
  // the computer's numbers can carry the way back with room to spare; the
  // number of balls, their size and the speed of the shot were chosen for
  // that.)
  breakShot: {
    label: 'Break shot',
    settings: { ballSize: 0.6, gravity: 0, trails: 3 },
    setup: (physics) => {
      const radius = 0.6;
      const gap = 2 * radius + 0.02;               // centre to centre, just not touching
      const YELLOW = 0xffd300, RACK = [0xc40233, 0x0087bd, 0x009f6b];   // red, blue, green
      const balls = [{ position: new Vec3(-4.6, 0.06, 0), velocity: new Vec3(12, 0, 0), spin: NO_SPIN, radius, color: YELLOW }];
      for (let row = 0; row < 5; row++) {          // rows of 1, 2, 3, 4 and 5 balls
        for (let i = 0; i <= row; i++) {
          const position = new Vec3(0.3 + row * gap * Math.sqrt(3) / 2, (i - row / 2) * gap, 0);
          balls.push({ position, velocity: AT_REST, spin: NO_SPIN, radius, color: RACK[(balls.length - 1) % 3] });
        }
      }
      physics.setBalls(balls);
    },
  },

  // A model of a gas: a thousand tiny weightless balls, packed in a
  // 10 × 10 × 10 block in one corner of the box and flying off in all
  // directions. The gas spreads out until it fills the box evenly ("free
  // expansion"). The balls start without spin, and the Info page shows
  // "Spin share" climbing from 0 towards 50 as the collisions share out the
  // energy. Running time backwards packs the block together again from
  // about 4 seconds; with 32 or 64 digits (see precise.js) from about 12
  // and over 30 seconds.
  gas: {
    label: 'Gas',
    settings: { balls: 1000, ballSize: 0.25, gravity: 0, sound: false },
    setup: (physics) => {
      const radius = 0.25;
      const gap = 0.58;                       // centre to centre: just not touching
      const corner = -BOX_HALF_SIZE + radius + 0.05;
      const balls = [];
      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
          for (let z = 0; z < 10; z++) {
            const heading = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            balls.push({
              position: new Vec3(corner + x * gap, corner + y * gap, corner + z * gap),
              velocity: heading.normalize().scale(3),   // the usual starting speed
              spin: NO_SPIN, radius,
            });
          }
        }
      }
      physics.setBalls(balls);
    },
  },
};
