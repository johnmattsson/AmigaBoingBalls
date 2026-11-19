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
  trails: 0, copper: false, backdrop: 'bars', scroller: false, credits: true, shadows: true, pixelSize: 1,
  grid: true, autoCamera: false, camMove: 'orbit', lamp: 21, lampTilt: 0, digits: 16,
  hdrStrength: 0,   // (off; the Copper demo turns it on, where the screen shows HDR)
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
    settings: { ballSize: 2, gravity: 0.25, wallType: 'classic', wallSound: true, lamp: 37, lampTilt: 78, camMove: 'swing' },
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
                copper: true, scroller: true, credits: false, grid: false, lamp: 45, hdrStrength: 0.5 },
  },

  // ---- The rest are little physics experiments. ----

  // The famous super ball trick: thrown under a table, the ball bounces off
  // the floor, then the underside of the table, then the floor again — and
  // comes back to the thrower. Here the floor and ceiling of the box play
  // floor and table. It only works with grippy walls: the first bounce makes
  // the ball spin, and that spin throws it backwards at the second.
  table: {
    label: 'Under table',
    // (The lamp in front, as in Classic 1984: the ball moves in one upright
    // plane facing the camera, so its shadow on the back wall draws the
    // whole trick; seen from above it would be a line on the floor.)
    settings: { gravity: 0, wallType: 'garwin', trails: 4, wallSound: true, lamp: 37, lampTilt: 78, camMove: 'swing' },
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
    // (The lamp in front, for the same reason as Under table: the break
    // plays out again as shadows on the back wall.)
    settings: { ballSize: 0.6, gravity: 0, trails: 3, lamp: 37, lampTilt: 78, camMove: 'swing' },
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
    settings: { balls: 1000, ballSize: 0.25, gravity: 0, sound: false, camMove: 'rise' },
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

  // The stacked drop: a small ball resting on a big one, dropped together.
  // The big ball bounces off the floor and meets the small one still on its
  // way down; being 25 times heavier, it throws it up at almost three times
  // the speed, so it climbs some eight times as high as it fell. (A trick
  // from physics lessons, with a basketball and a tennis ball.) Everything
  // is in one straight line up and down, so the lamp stands in front, and
  // the shadows bob up and down the back wall.
  stacked: {
    label: 'Stacked drop',
    settings: { gravity: 0.25, trails: 0.5, wallSound: true, lamp: 37, lampTilt: 78, autoCamera: true },
    setup: (physics) => {
      const big = 2, small = 0.4;
      const bottom = -BOX_HALF_SIZE + big + 0.8;   // dropped from 0.8 above the floor (the small ball then just misses the ceiling)
      physics.setBalls([
        { position: new Vec3(0, bottom, 0), velocity: AT_REST, spin: NO_SPIN, radius: big, color: 0xc40233 },
        // (A hair apart, so the two bounces come one after the other.)
        // (Spinning like a top, about the line the two fall along. That
        // changes nothing about how high it is thrown; with grippy balls
        // each hit on the big one turns the spin the other way round.)
        { position: new Vec3(0, bottom + big + small + 0.01, 0), velocity: AT_REST, spin: new Vec3(0, 4, 0), radius: small, color: 0xffd300 },
      ]);
    },
  },

  // Newton's cradle without the strings: five balls in a row, a hair apart,
  // and a sixth fired into one end. Each hit passes all of its motion on to
  // the next ball and stops dead (equal balls, head on), so only the far
  // end flies off. Nothing pulls them back here, but the walls do: the ball
  // that flew off comes back and knocks the first one out the other side,
  // and it goes on like that for ever, as no energy is ever lost.
  cradle: {
    label: 'Cradle',
    settings: { ballSize: 0.7, gravity: 0, wallSound: true, lamp: 37, lampTilt: 78, camMove: 'swing' },
    setup: (physics) => {
      const radius = 0.7, gap = 2 * radius + 0.02;
      const COLORS = [0xc40233, 0x009f6b, 0x0087bd, 0xc40233, 0x009f6b];
      const balls = [{ position: new Vec3(-5, 0, 0), velocity: new Vec3(4, 0, 0), spin: NO_SPIN, radius, color: 0xffd300 }];
      COLORS.forEach((color, i) => balls.push({
        position: new Vec3((i - 1) * gap, 0, 0), velocity: AT_REST, spin: NO_SPIN, radius, color,
      }));
      physics.setBalls(balls);
    },
  },

  // Rain: 144 small balls let go at different heights near the ceiling.
  // They fall, splash off the floor and each other, and as nothing loses
  // energy they never come to rest: they end up as a little atmosphere,
  // thickest at the bottom and thinning out towards the top, much as the
  // air does with height.
  rain: {
    label: 'Rain',
    settings: { balls: 144, ballSize: 0.25, gravity: 0.3, sound: false, camMove: 'rise' },
    setup: (physics) => {
      const radius = 0.25, spacing = 0.9;
      const balls = [];
      for (let x = 0; x < 12; x++) {
        for (let z = 0; z < 12; z++) {
          balls.push({
            position: new Vec3((x - 5.5) * spacing, 1 + Math.random() * 4.5, (z - 5.5) * spacing),
            // (A slight drift sideways, or each would fall and bounce in a
            // column of its own for ever.)
            velocity: new Vec3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6),
            spin: NO_SPIN, radius,
          });
        }
      }
      physics.setBalls(balls);
    },
  },
  // Brownian motion: one big ball among five hundred tiny ones, which are
  // 36 times lighter. The tiny ones hit it from all sides, never
  // quite evenly, so it wanders about at random, slowly, as a speck of
  // pollen does in water (seen under a microscope by Robert Brown in 1827;
  // Einstein explained it in 1905 as the hits of molecules, and the
  // measurements of it convinced the last doubters that atoms are real).
  // Only the big ball leaves a trail, and a long one: two minutes (twelve
  // times Trails, in the demo's own time: at speed 1, real minutes), so its whole wandering shows. (Auto cam, if switched on,
  // circles all the way round.)
  brownian: {
    label: 'Brownian',
    settings: { gravity: 0, sound: false, trails: 10 },
    setup: (physics) => {
      const big = 1.2, small = 0.2, spacing = 1.1;
      const balls = [{ position: new Vec3(0, 0, 0), velocity: AT_REST, spin: NO_SPIN, radius: big, color: 0xc40233, trailScale: 12 }];
      const spots = [];
      for (let x = -5; x <= 5; x++) {
        for (let y = -5; y <= 5; y++) {
          for (let z = -5; z <= 5; z++) {
            const position = new Vec3(x * spacing, y * spacing, z * spacing);
            if (position.length() > big + small + 0.8) spots.push(position);
          }
        }
      }
      // (500 of the spots, picked at random, each moved a little at random
      // within its cell, never so far that two touch; each ball heading off
      // its own way, at its own speed: a new start every time.)
      const jitter = () => (Math.random() - 0.5) * (spacing - 2 * small - 0.1);
      for (let k = 0; k < 500; k++) {
        const [spot] = spots.splice(Math.floor(Math.random() * spots.length), 1);
        const position = spot.add(new Vec3(jitter(), jitter(), jitter()));
        let heading;
        do heading = new Vec3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        while (heading.length() > 1 || heading.length() < 0.1);
        balls.push({ position, velocity: heading.normalize().scale(3 + 4 * Math.random()), spin: NO_SPIN, radius: small, noTrail: true });
      }
      physics.setBalls(balls);
    },
  },
};
