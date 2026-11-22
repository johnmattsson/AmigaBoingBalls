// =============================================================================
// physics.js — moving, spinning and bouncing the balls.
//
// Each ball is a "rigid body": it has a position and velocity like a point,
// but also an orientation and a spin. Spin matters because when two spinning
// balls rub against each other, friction turns some spin into sideways motion
// (and some motion into spin) — that's what makes the bounces look lively.
//
// Units: lengths are in "box units" (the box is 12 units wide, a ball has
// radius 1) and time is in seconds.
//
// HOW TIME MOVES ("event-driven" simulation)
// Between collisions every ball flies along a perfectly predictable curve:
// a straight line bent by gravity. So instead of moving in small steps and
// checking for overlaps afterwards (which notices a collision a little too
// late), we calculate exactly WHEN the next collision happens, move every
// ball precisely to that moment, bounce, and repeat. Balls never sink into
// each other or the walls, and the result doesn't depend on step sizes.
//
// It also makes running time backwards accurate: the reversed motion meets
// the same collisions at the same moments. (It cannot stay perfect forever:
// computers round every number to about 16 digits, and bouncing balls are
// "chaotic", so a tiny rounding difference slowly grows with each collision.)
//
// The collision model is the same as in the original Boing Balls release:
// every collision is an instant "kick" (an impulse) computed from three
// coefficients of restitution (how much of a motion survives a bounce):
//
//   normal      e_n : bouncing straight back.     1 = perfectly bouncy.
//   tangential  e_t : sliding along the surface.  1 = sliding reverses
//                                                  (very grippy, "super ball"),
//                                                  0 = sliding stops,
//                                                 -1 = no friction at all.
//   angular     e_a : twisting around the contact normal. Same scale as e_t.
// =============================================================================

import { Vec3, Quat } from './math.js';
import { stepPrecisely } from './precise.js';

// --- Scene layout ------------------------------------------------------------

export const BOX_HALF_SIZE = 6;    // walls are at x, y, z = ±6
export const BALL_RADIUS = 1;
const DOWN = new Vec3(0, -1, 0);

// --- Tunable values ---------------------------------------------------------
// The original ran its physics once per screen refresh, so it ran twice as
// fast on a 120 Hz screen. These values are the original ones converted to
// "per second" so the demo behaves the same on every screen.

// At Gravity = 1, the slider's start, the balls fall with 3.6 units/s².
const GRAVITY_SCALE = 3.6;

// How hard a mouse click pushes a ball (change of speed in units/s).
const CLICK_IMPULSE = 6;

// Safety limit: never handle more collisions than this in one frame (only
// matters if something extreme happens, like balls jammed into a corner).
const MAX_COLLISIONS_PER_FRAME = 50000;

// How far ahead a collision plan looks, in seconds (or a whole frame, if
// that is longer). Further ahead means making plans less often, but each
// plan has to consider more pairs of balls (those that could meet within
// that time). See CollisionPlan. (A time, not a number of frames: on a fast
// screen, at 480 frames a second, plans of four frames each would be made
// four times as often as at 120, and Gas cost three times as much.)
const PLAN_AHEAD = 1 / 30;
// ... and never so far that a typical ball could fly more than PLAN_REACH
// of the balls' average radius in the time: with many fast small balls
// (4000 of them with the Energy turned up) a plan four frames long would
// have each ball consider a thousand others, and one frame take half a
// minute. Then a plan covers less than a frame, and several are made in it.
const PLAN_REACH = 3;

// Kinds of bounce: the three coefficients explained at the top of the file.
// These are the only four combinations that lose no energy at all (each
// coefficient must be +1 or -1, and a bounce needs normal = 1). Anything in
// between would turn some motion into heat at every bounce, and the balls
// would slowly come to rest.
export const COLLISION_TYPES = {
  rough:  { normal: 1, tangential: 1,  angular: 1 },    // grippy rubber: everything reverses
  garwin: { normal: 1, tangential: 1,  angular: -1 },   // the ideal "super ball"
  smooth: { normal: 1, tangential: -1, angular: -1 },   // slippery glass: spin is ignored
  twist:  { normal: 1, tangential: -1, angular: 1 },    // slippery, but twisting reverses

  // For walls only, and not real physics: slippery like "smooth", but the
  // ball turns the other way round after every bounce off a side wall, as
  // in the 1984 demo. (A real ball wouldn't; it is just how that animation
  // was made. The energy stays the same; the angular momentum does not.)
  classic: { normal: 1, tangential: -1, angular: -1, flipSpinAtSides: true },
};

// Trails (see recordTrail): how far apart in time the points along a
// ball's trail are, and the most points one trail may have.
const TRAIL_STEP = 1 / 30;
const MAX_TRAIL_POINTS = 400;   // per ball, however often it bounces

// The four classic colours (red, green, blue, yellow): exactly the base
// colours of the Swedish Natural Color System (NCS), the four hues that look pure. The second colour of
// each ball's checker pattern is always white.
const BALL_COLORS = [0xc40233, 0x009f6b, 0x0087bd, 0xffd300];

// The six walls of the box, each described by the direction pointing OUT of
// the box. A ball touches a wall when its centre is within one radius of it.
export const WALL_NORMALS = [
  new Vec3(0, -1, 0),   // floor
  new Vec3(0, 1, 0),    // ceiling
  new Vec3(-1, 0, 0),   // left
  new Vec3(1, 0, 0),    // right
  new Vec3(0, 0, -1),   // back
  new Vec3(0, 0, 1),    // front
];

// A "room" is what the balls bounce around in. It is described by
//   walls  – a list of flat walls. Each has a direction pointing out of the
//            room (`normal`) and a distance (`offset`): a point is inside
//            when (normal · point) is at most `offset`. Walls may be slanted.
//   floorY – the height of the floor (for the height energy and the shadows)
//   min, max – a box that the whole room fits in (for finding free spots)
// The standard room is the box. main.js makes a second one that fits the
// window when the grid is switched off.
export function boxRoom() {
  const s = BOX_HALF_SIZE;
  return {
    walls: WALL_NORMALS.map((normal) => ({ normal, offset: s })),
    floorY: -s,
    min: new Vec3(-s, -s, -s),
    max: new Vec3(s, s, s),
  };
}


// -----------------------------------------------------------------------------
// A single ball.
// -----------------------------------------------------------------------------
// (See Ball.move.)
const MOVED = {};

class Ball {
  constructor(index, position, velocity, radius = BALL_RADIUS) {
    // (Its own copies: move changes them in place, and the values handed in
    // may be shared, such as a preset's AT_REST for many balls.)
    this.position = new Vec3(position.x, position.y, position.z);
    this.velocity = new Vec3(velocity.x, velocity.y, velocity.z);

    // The path the ball has just flown, for drawing trails: a flat list of
    // numbers, four per point (x, y, z and the time it was there).
    this.trail = [];
    // (Counted for physics-host.js, which passes only the trails' new points
    // on to the page: how many points were dropped from the start of the
    // trail, and how often it was cleared.)
    this.trailDropped = 0;
    this.trailCleared = 0;

    // Tilt each ball a little (like the original Amiga ball) and spin
    // neighbouring balls in opposite directions around the vertical axis.
    // `spin` is the angular velocity: its direction is the axis, its
    // length is the speed in radians per second.
    this.orientation = Quat.fromAxisAngle(new Vec3(0, 0, 1), Math.PI / 8);
    this.unturnedTime = 0;   // time moved but not yet turned (see catchUpRotation)
    this.spin = new Vec3(0, index % 2 ? 2.4 : -2.4, 0);

    // Balls are hollow shells, so their weight grows with their surface
    // area (radius²): a ball twice as wide is four times as heavy. A ball
    // of the standard size weighs 1.
    this.radius = radius;
    // The checker pattern: how many squares from pole to pole (there are
    // twice as many around the equator). A standard ball has 6; bigger
    // balls get more and smaller ones fewer, so that the squares themselves
    // are about the same size on every ball. The smallest balls (radius
    // under 0.42) get the fewest possible: 2 from pole to pole and 4 around,
    // so 8 pieces in all, 4 coloured and 4 white.
    this.squares = Math.max(2, Math.round(6 * radius / BALL_RADIUS));
    this.mass = (radius / BALL_RADIUS) ** 2;
    this.color = BALL_COLORS[index % BALL_COLORS.length];

    // How hard the ball is to spin up ("moment of inertia"). A hollow shell
    // like a beach ball has I = 2/3 · m · r².
    const shellFactor = 2 / 3;
    this.inertia = shellFactor * this.mass * this.radius ** 2;

    // When a ball skids on a surface, friction both slows it down and spins
    // it up. This combined "effective mass" for sliding contact comes out of
    // the maths for a sphere: k·m / (1 + k).
    this.slideMass = (shellFactor * this.mass) / (1 + shellFactor);
  }

  // Apply an instant kick `impulse` at the point `lever` (measured from the
  // ball's centre), plus an extra pure twist `twist`.
  //   - The impulse changes the velocity:  Δv = impulse / mass
  //   - Hitting off-centre also spins it:  Δspin = (lever × impulse) / inertia
  applyImpulse(lever, impulse, twist = new Vec3()) {
    this.catchUpRotation();   // finish turning at the old spin first
    this.velocity = this.velocity.add(impulse.scale(1 / this.mass));
    this.spin = this.spin.add(lever.cross(impulse).add(twist).scale(1 / this.inertia));
  }

  // Velocity of the point on the surface at `lever` from the centre:
  // the ball's own motion plus the motion caused by spinning.
  surfaceVelocity(lever) {
    return this.velocity.add(this.spin.cross(lever));
  }

  // Move forward in time by dt seconds (dt may be negative = rewinding!).
  move(dt, gravity) {
    // Exact formula for motion under constant gravity:
    //   position += velocity·dt + ½·gravity·dt²
    //   velocity += gravity·dt
    // Because it is exact, running time backwards retraces the same path.
    // (Written out with plain numbers, changing the ball's own position and
    // velocity in place: this runs for every ball many times per frame, and
    // new Vec3s each time, about 8 MB a frame with 4000 balls, kept the
    // browser busy cleaning up. Hence a ball owns its Vec3s: see the
    // constructor, and nothing else may hold on to them.)
    const p = this.position, v = this.velocity, h = 0.5 * dt * dt;
    // (Added up in the same order as always, so the rounding is the same too.)
    p.x = p.x + v.x * dt + gravity.x * h; p.y = p.y + v.y * dt + gravity.y * h; p.z = p.z + v.z * dt + gravity.z * h;
    v.x = v.x + gravity.x * dt; v.y = v.y + gravity.y * dt; v.z = v.z + gravity.z * dt;
    // (precise.js sees a change from outside by a new position or velocity;
    // changed in place, it is told so here.)
    if (this.precise) this.precise.was = MOVED;

    // The rotation is caught up later (see catchUpRotation): between
    // collisions a ball spins at a constant rate, so turning it once by the
    // total time gives the same result as turning it after every step.
    this.unturnedTime += dt;
  }

  // Turn the ball by (spin speed × time) around its spin axis, for all the
  // time it has moved since the last turn. Needed before its spin changes,
  // and once per frame for drawing.
  catchUpRotation() {
    const { x: sx, y: sy, z: sz } = this.spin;
    const speed = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (speed > 0 && this.unturnedTime !== 0) {
      // The turn, as a quaternion (ax, ay, az, c): a rotation by
      // speed × time around the spin axis. Then orientation = turn × orientation,
      // made length 1 again. (Written out with plain numbers, changing the
      // orientation in place: this runs for every ball in every frame.)
      const half = 0.5 * speed * this.unturnedTime, s = Math.sin(half) / speed, c = Math.cos(half);
      const ax = sx * s, ay = sy * s, az = sz * s, o = this.orientation;
      const x = c * o.x + ax * o.w + ay * o.z - az * o.y;
      const y = c * o.y - ax * o.z + ay * o.w + az * o.x;
      const z = c * o.z + ax * o.y - ay * o.x + az * o.w;
      const w = c * o.w - ax * o.x - ay * o.y - az * o.z;
      const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
      o.x = x / length; o.y = y / length; o.z = z / length; o.w = w / length;
    }
    this.unturnedTime = 0;
  }
}


// -----------------------------------------------------------------------------
// The whole simulation.
// -----------------------------------------------------------------------------
export class Physics {
  constructor(ballCount, sizeMix = 0) {
    this.balls = [];
    this.sizeMix = sizeMix;
    this.ballSize = 1;   // the standard ball's radius; all sizes are multiples of it
    this.room = boxRoom();

    // How balls bounce off each other and off the walls. Change these with
    // e.g. physics.ballBounce = COLLISION_TYPES.smooth.
    this.ballBounce = COLLISION_TYPES.rough;    // grippy rubber balls
    this.wallBounce = COLLISION_TYPES.smooth;   // slippery glass walls

    this.time = 0;             // simulated time so far (goes down when rewinding)
    // Which way gravity pulls: straight down, unless the Tilt setting turns
    // it with a phone or tablet (see main.js). A unit vector.
    this.down = DOWN;
    // Compute with more digits than the usual 16 (see precise.js)? 0 = no;
    // 2 = about 32 digits; 4 = about 64. Slower, but running time backwards
    // then retraces the paths for many more collisions.
    this.precise = 0;
    // Turn the balls for drawing them? (Not needed for an unseen copy.)
    this.turnBalls = true;
    // Trails: how many seconds of its flight each ball remembers, for
    // drawing a line behind it. 0 = none.
    this.trailSeconds = 0;

    this.setBallCount(ballCount);

    // Called whenever two balls collide, or a ball hits a wall, with how
    // hard they hit (main.js plays a sound, louder for harder hits).
    this.onBallCollision = () => {};
    this.onWallCollision = () => {};
  }

  // ---- Setting up the balls ----------------------------------------------------

  // Call after changing balls from outside (e.g. in the browser console), so
  // the collision plan is worked out again. (It is also made afresh every
  // frame anyway.)
  changed() {
    this.plan = null;
  }

  // Replace all balls with a hand-made set (used by the presets in main.js).
  // Each entry: { position, velocity, radius, spin, color, squares } — only
  // position and velocity are required.
  setBalls(list) {
    this.balls = list.map((item, index) => {
      const ball = new Ball(index, item.position, item.velocity, item.radius ?? BALL_RADIUS);
      if (item.spin) ball.spin = item.spin;
      if (item.color !== undefined) ball.color = item.color;
      if (item.squares) ball.squares = item.squares;
      if (item.orientation) ball.orientation = item.orientation;   // (turned at the start, else upright)
      if (item.noTrail) ball.noTrail = true;
      if (item.trailScale) ball.trailScale = item.trailScale;   // (a trail this many times longer than the others)   // (no trail even with Trails on: for the many small balls around one that has one)
      return ball;
    });
    this.fitBallsInside();
    this.changed();
  }

  // Change the room the balls are in (see boxRoom above).
  setRoom(room) {
    this.room = room;
    this.fitBallsInside();
    this.clearTrails();
    this.changed();
  }

  // Is a ball of `radius` at `spot` completely inside the room, with
  // `margin` to spare?
  isInside(spot, radius, margin = 0) {
    return this.room.walls.every((wall) => wall.normal.dot(spot) + radius + margin <= wall.offset);
  }

  // After the room changed, some balls may be left outside it. Each of
  // those is moved to a free spot inside (keeping its speed), or removed if
  // there is no room left.
  fitBallsInside() {
    // A ball that has just bounced touches its wall exactly, so allow a hair.
    const isOut = (ball) => !this.isInside(ball.position, ball.radius, -1e-6);
    const outside = this.balls.filter(isOut);
    if (!outside.length) return;
    this.balls = this.balls.filter((ball) => !isOut(ball));
    const spots = new FreeSpots(this);
    for (const ball of outside) {
      const spot = this.findFreeSpot(ball.radius, spots);
      if (!spot) continue;
      ball.position = spot;
      ball.trail.length = 0;
      this.balls.push(ball);
      spots.add(ball);
    }
  }

  // Add or remove balls until there are `count` (or as many as fit).
  setBallCount(count) {
    this.changed();
    while (this.balls.length > count) this.balls.pop();
    const spots = new FreeSpots(this);
    while (this.balls.length < count) {
      const index = this.balls.length;
      if (index < 4 && this.sizeMix === 0 && this.ballSize <= 1.5) {
        // The classic start: four equal balls along the box's diagonal,
        // drifting sideways. (Bigger balls than 1.5 would overlap there.)
        const d = 2.5 * (3 - index) - 3.75;       // 3.75, 1.25, -1.25, -3.75
        this.balls.push(new Ball(index, new Vec3(d, d, d), new Vec3(1.8, 0, 0), BALL_RADIUS * this.ballSize));
        spots.add(this.balls[index]);
        continue;
      }
      // Other balls get a size from the size mix and appear in a free spot,
      // heading off in a random direction. In a crowded box a big ball may
      // not fit anywhere, so try a few other sizes, ending with the smallest.
      let radius, spot = null;
      // (Only the last, smallest size gets the slow thorough search.)
      for (let attempt = 0; attempt < 6 && !spot; attempt++) {
        radius = attempt < 5 ? this.randomRadius() : BALL_RADIUS * this.ballSize * 2 ** -this.sizeMix;
        spot = this.findFreeSpot(radius, spots, { thorough: attempt === 5 });
      }
      if (!spot) break;   // the box is full
      const direction = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.balls.push(new Ball(index, spot, direction.normalize().scale(3), radius));
      spots.add(this.balls[index]);
    }
  }

  // How different the sizes are: 0 = all equal, 1 = from half to double
  // the standard size. Changing it starts over with new balls.
  setSizeMix(mix) {
    this.changed();
    const count = this.balls.length;
    this.sizeMix = mix;
    this.balls = [];
    this.setBallCount(count);
  }

  // How big the standard ball is (1 = radius 1). Changing it starts over
  // with new balls, as many as still fit.
  setBallSize(size) {
    this.changed();
    const count = this.balls.length;
    this.ballSize = size;
    this.balls = [];
    this.setBallCount(count);
  }

  // A random size: the standard size times 2^(−mix … +mix). Spreading the
  // sizes this way gives as many balls smaller than standard as larger.
  randomRadius() {
    return BALL_RADIUS * this.ballSize * 2 ** (this.sizeMix * (Math.random() * 2 - 1));
  }

  // A random spot inside the box where a ball of `radius` touches nothing,
  // or null if there is no room left.
  // A random spot where a ball of `radius` fits without touching the walls
  // or any other ball, or null if there is none. When placing many balls,
  // pass the same `spots` (a FreeSpots, see below) every time and tell it
  // about each ball placed, so it does not start from scratch every time.
  findFreeSpot(radius, spots = new FreeSpots(this), { thorough = true } = {}) {
    if (spots.isFull(radius)) return null;
    const { min, max } = this.room;
    const between = (low, high) => low + Math.random() * (high - low);

    // Usually a few random tries are enough...
    for (let attempt = 0; attempt < 200; attempt++) {
      const spot = new Vec3(between(min.x, max.x), between(min.y, max.y), between(min.z, max.z));
      if (spots.isClear(spot, radius)) return spot;
    }
    // ...but in a crowded room, random tries keep missing the few gaps left.
    // Then (unless only a quick look was asked for) check a grid of spots.
    return thorough ? spots.searchEverywhere(radius) : null;
  }



  // ---- Energy ------------------------------------------------------------------
  // Every ball has three kinds of energy:
  //   movement  ½ · mass · speed²
  //   spin      ½ · inertia · spin speed²
  //   height    mass · gravity · height above the floor
  // Nothing in this box loses energy (all bounces are perfectly bouncy), so
  // the total stays the same until you click a ball or change gravity.

  // The two parts that come from moving: movement and spin.
  motionEnergy() {
    return this.balls.reduce((sum, b) =>
      sum + 0.5 * b.mass * b.velocity.lengthSq() + 0.5 * b.inertia * b.spin.lengthSq(), 0);
  }

  heightEnergy(gravityStrength) {
    const g = GRAVITY_SCALE * gravityStrength;
    const down = this.down;
    if (down === DOWN) {
      return this.balls.reduce((sum, b) =>
        sum + b.mass * g * (b.position.y - b.radius - this.room.floorY), 0);
    }
    // Tilted: height is measured upwards along the pull, from the room's
    // lowest corner (the one farthest in the direction of `down`).
    const { min, max } = this.room;
    const lowest = Math.max(down.x * min.x, down.x * max.x) + Math.max(down.y * min.y, down.y * max.y)
                 + Math.max(down.z * min.z, down.z * max.z);
    return this.balls.reduce((sum, b) =>
      sum + b.mass * g * (lowest - down.dot(b.position) - b.radius), 0);
  }

  totalEnergy(gravityStrength) {
    return this.motionEnergy() + this.heightEnergy(gravityStrength);
  }

  // All the totals at once, for the numbers sent with every step (see
  // snapshot in physics-host.js): the same as motionEnergy, spinEnergy,
  // totalEnergy and the lengths of totalMomentum and totalAngularMomentum,
  // in one pass over the balls and without making a single vector (this
  // runs after every step, up to 240 times a second, with up to 4000 balls).
  totals(gravityStrength) {
    const g = GRAVITY_SCALE * gravityStrength, down = this.down;
    let lowest = 0;
    if (down !== DOWN) {
      const { min, max } = this.room;
      lowest = Math.max(down.x * min.x, down.x * max.x) + Math.max(down.y * min.y, down.y * max.y)
             + Math.max(down.z * min.z, down.z * max.z);
    }
    let motion = 0, spin = 0, height = 0, mx = 0, my = 0, mz = 0, ax = 0, ay = 0, az = 0;
    for (const b of this.balls) {
      const v = b.velocity, w = b.spin, p = b.position, m = b.mass, I = b.inertia;
      const spinPart = 0.5 * I * (w.x * w.x + w.y * w.y + w.z * w.z);
      motion += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z) + spinPart;
      spin += spinPart;
      height += down === DOWN ? m * g * (p.y - b.radius - this.room.floorY)
                              : m * g * (lowest - (down.x * p.x + down.y * p.y + down.z * p.z) - b.radius);
      mx += m * v.x; my += m * v.y; mz += m * v.z;
      // (Angular momentum: position × (mass × velocity), plus inertia × spin.)
      ax += m * (p.y * v.z - p.z * v.y) + I * w.x;
      ay += m * (p.z * v.x - p.x * v.z) + I * w.y;
      az += m * (p.x * v.y - p.y * v.x) + I * w.z;
    }
    return { motion, spin, total: motion + height, momentum: Math.hypot(mx, my, mz), angular: Math.hypot(ax, ay, az) };
  }

  // Just the spin part of the motion energy.
  spinEnergy() {
    return this.balls.reduce((sum, b) => sum + 0.5 * b.inertia * b.spin.lengthSq(), 0);
  }

  // ---- Momentum ----------------------------------------------------------------
  // Momentum (mass × velocity, added up over all balls) says how much
  // "push" the balls carry in total. Angular momentum is the same idea for
  // turning: every ball's own spin, plus its circling around the middle of
  // the box. When two balls collide, both totals stay exactly the same —
  // the balls only pass momentum to each other. Walls and gravity are
  // outside influences, so they do change the totals.

  totalMomentum() {
    return this.balls.reduce((sum, b) => sum.add(b.velocity.scale(b.mass)), new Vec3());
  }

  totalAngularMomentum() {
    return this.balls.reduce((sum, b) => sum.add(angularMomentum(b)), new Vec3());
  }

  // Change the total energy to `target` by making every ball move and spin
  // faster or slower (same directions). Height energy can't be changed this
  // way, so the lowest possible total is when every ball stands still.
  setTotalEnergy(target, gravityStrength) {
    const motion = this.motionEnergy();
    if (motion < 1e-12) return;   // nothing is moving, so nothing to scale
    const wanted = Math.max(0, target - this.heightEnergy(gravityStrength));
    // Energy grows with speed², so speeds change by the square root.
    // Never quite stop: keep 1 % of the speed, so that the balls still have
    // a direction and can be sped up again later.
    const factor = Math.max(0.01, Math.sqrt(wanted / motion));
    for (const b of this.balls) {
      b.catchUpRotation();
      b.velocity = b.velocity.scale(factor);
      b.spin = b.spin.scale(factor);
    }
    this.changed();
  }

  // ---- Moving --------------------------------------------------------------------

  // Advance the simulation by `seconds` (negative = backwards in time).
  // gravityStrength: the Gravity setting (0 … 5).
  update(seconds, gravityStrength) {
    const direction = Math.sign(seconds);   // +1 forwards, -1 backwards
    if (direction === 0) return;
    // A trail shows where a ball came from, so it starts afresh when time
    // changes direction.
    if (direction !== this.lastDirection) this.clearTrails();
    this.lastDirection = direction;
    const gravity = this.down.scale(GRAVITY_SCALE * gravityStrength);
    let timeLeft = Math.abs(seconds);

    if (this.precise) {
      // With 32 digits instead of 16: the same steps, in precise.js.
      stepPrecisely(this, direction * timeLeft, gravity, this.precise);
    } else {
      // Balls are only moved when they are needed. Moving all of them to
      // every single collision would take most of the time with many balls,
      // and most of them are just flying straight on. Instead each ball
      // remembers up to which moment it has been moved (`movedTo`, counted
      // from when the collision plan was made), and is brought up to date
      // just before it collides or a prediction looks at it. The path
      // between collisions is a parabola, so moving in one step or in many
      // gives the same result. At the end of every frame all are moved.
      //
      // The collision plan (see CollisionPlan below) looks a few frames
      // ahead, so it is only made afresh now and then: when it runs out, or
      // when something changed it.
      let plan = this.plan;
      let clock = plan ? plan.clock : 0;            // the present moment, counted from when the plan was made
      const bringUpToDate = (ball) => {
        if (ball.movedTo !== clock) {
          ball.move(clock - ball.movedTo, gravity);
          ball.movedTo = clock;
        }
      };
      const bringAllUpToDate = () => { for (const ball of this.balls) bringUpToDate(ball); };
      const makePlan = () => {
        // (Here every ball is up to date: the new plan starts from now.)
        clock = 0;
        for (const ball of this.balls) ball.movedTo = 0;
        const ahead = Math.min(Math.max(timeLeft, PLAN_AHEAD), this.planReachTime());
        return this.plan = new CollisionPlan(this.balls, this.room.walls, direction, gravity, gravityStrength, ahead, bringUpToDate);
      };
      const usable = plan && plan.balls === this.balls && plan.ballCount === this.balls.length &&
        plan.walls === this.room.walls && plan.direction === direction &&
        plan.gravityStrength === gravityStrength && plan.gravity.x === gravity.x && plan.gravity.y === gravity.y &&
        plan.gravity.z === gravity.z && plan.now < plan.horizon;   // (a plan that ends within this frame is followed by the next: see below)
      if (!usable) plan = makePlan();
      plan.bringUpToDate = bringUpToDate;

      for (let count = 0; count < MAX_COLLISIONS_PER_FRAME; count++) {
        // When is the next collision, and what is it?
        const next = plan.earliest();
        const planLeft = plan.horizon - plan.now;   // (how much longer the plan can be trusted)
        if (next.time > timeLeft && timeLeft <= planLeft) break;   // nothing more happens this frame
        if (next.time > planLeft) {
          // The plan ends before the next collision it knows of (it may not
          // know them all beyond its end): go to its end, and make the next.
          clock += direction * planLeft;
          this.time += direction * planLeft;
          timeLeft -= planLeft;
          plan.timePassed(planLeft);
          bringAllUpToDate();
          plan = makePlan();
          plan.bringUpToDate = bringUpToDate;
          continue;
        }

        // Go to that moment, bring the two up to date, and bounce.
        clock += direction * next.time;
        this.time += direction * next.time;
        timeLeft -= next.time;
        plan.timePassed(next.time);
        const ball = this.balls[next.ball], other = next.wall ? null : this.balls[next.other];
        bringUpToDate(ball);
        if (other) bringUpToDate(other);
        if (next.wall) this.collideWithWall(ball, next.wall);
        else this.collideBalls(ball, other);

        // A bounce is a corner in the path: note it in the trails.
        if (this.trailSeconds > 0) {
          this.recordTrail(ball, true);
          if (other) this.recordTrail(other, true);
        }

        // Only the balls that just bounced change course, so only their
        // predictions need redoing (unless one of them is now faster than the
        // plan allowed for: then make a new plan for the rest of the frame).
        const changed = next.wall ? [next.ball] : [next.ball, next.other];
        if (plan.tooFast(changed)) {
          bringAllUpToDate();
          plan = makePlan();
        } else {
          plan.update(changed);
        }
      }

      clock += direction * timeLeft;
      this.time += direction * timeLeft;
      plan.timePassed(timeLeft);
      bringAllUpToDate();
      plan.clock = clock;
    }

    // Bring every ball's rotation up to date for drawing.
    if (this.turnBalls) for (const ball of this.balls) ball.catchUpRotation();
    if (this.trailSeconds > 0) for (const ball of this.balls) this.recordTrail(ball);
  }


  // How long a collision plan may look ahead (see PLAN_REACH): the time in
  // which a typical ball (as nearbyPairs counts it) flies PLAN_REACH average
  // radii.
  planReachTime() {
    const n = this.balls.length;
    if (n === 0) return Infinity;
    let fastest = 0, squares = 0, radii = 0;
    for (const b of this.balls) {
      const v = b.velocity.lengthSq();
      fastest = Math.max(fastest, v);
      squares += v;
      radii += b.radius;
    }
    const typical = Math.min(Math.sqrt(fastest), TYPICAL_SPEEDS * Math.sqrt(squares / n));
    return typical > 0 ? Math.max(1e-4, (PLAN_REACH * radii / n) / (2 * SPEED_MARGIN * typical)) : Infinity;
  }

  // ---- Trails --------------------------------------------------------------------

  // Bring the ball's trail up to date, and forget the points that are older
  // than trailSeconds.
  //
  // The last point of a trail is its "head", which follows the ball. To keep
  // the trail from growing a new point every frame, the head is simply moved
  // along, until it is TRAIL_STEP away (in time) from the point before it;
  // then it stays and a new head starts. A bounce is a corner in the path
  // (isCorner), so the head stays exactly there too.
  recordTrail(ball, isCorner = false) {
    if (ball.noTrail) return;   // (a ball set up without one: see setBalls)
    const trail = ball.trail;
    const n = trail.length;
    const headIsFree = n >= 8 && !ball.trailCorner && Math.abs(this.time - trail[n - 5]) < TRAIL_STEP;
    if (headIsFree) trail.length = n - 4;   // move the head: drop it, add it again below
    trail.push(ball.position.x, ball.position.y, ball.position.z, this.time);
    ball.trailCorner = isCorner;
    // (A ball set up with a longer trail keeps it that many times longer.)
    const scale = ball.trailScale ?? 1;
    let old = Math.max(0, trail.length - 4 * MAX_TRAIL_POINTS * scale);
    while (old < trail.length && Math.abs(this.time - trail[old + 3]) > this.trailSeconds * scale) old += 4;
    if (old) {
      trail.splice(0, old);
      ball.trailDropped += old / 4;
    }
  }

  clearTrails() {
    for (const ball of this.balls) {
      ball.trail.length = 0;
      ball.trailDropped = 0;
      ball.trailCleared++;
    }
  }

  // A ball hits a wall whose outward direction is `n`.
  collideWithWall(ball, n) {
    const lever = n.scale(ball.radius);                // centre → contact point
    const contactVel = ball.surfaceVelocity(lever);
    const normalVel = n.scale(n.dot(contactVel));      // part going into the wall
    const slideVel = contactVel.sub(normalVel);        // part sliding along it

    // How hard it hit: its speed into the wall (for the sound).
    const impactSpeed = Math.abs(n.dot(ball.velocity));

    // Kick that reverses the "into the wall" motion...
    const WALL = this.wallBounce;
    const bounce = normalVel.scale(-(1 + WALL.normal) * ball.mass);
    // ...plus friction acting against the sliding.
    const friction = slideVel.scale(-(1 + WALL.tangential) * ball.slideMass);
    // ...plus friction against twisting around the contact normal.
    const twist = n.scale(-n.dot(ball.spin) * (1 + WALL.angular) * ball.inertia);

    ball.applyImpulse(lever, bounce.add(friction), twist);
    if (WALL.flipSpinAtSides && n.x !== 0) ball.spin = ball.spin.negate();
    this.onWallCollision(ball, n, impactSpeed);
  }

  // Two balls touch. Same idea as the wall, but now both balls move and spin,
  // so we use their RELATIVE motion and give them equal and opposite kicks.
  collideBalls(a, b) {
    const n = b.position.sub(a.position).normalize();  // from a towards b
    const leverA = n.scale(a.radius);
    const leverB = n.scale(-b.radius);

    const velA = a.surfaceVelocity(leverA);
    const velB = b.surfaceVelocity(leverB);
    const normalA = n.scale(n.dot(velA));
    const normalB = n.scale(n.dot(velB));

    // How hard they hit: their speed towards each other (for the sound).
    const impactSpeed = Math.abs(n.dot(b.velocity.sub(a.velocity)));

    // "Reduced" masses: how heavy the pair feels in a collision.
    const pair = (p, q) => (p * q) / (p + q);
    const mass = pair(a.mass, b.mass);
    const slideMass = pair(a.slideMass, b.slideMass);
    const inertia = pair(a.inertia, b.inertia);

    const BALL = this.ballBounce;

    const bounce = normalB.sub(normalA).scale((1 + BALL.normal) * mass);
    const slideA = velA.sub(normalA);
    const slideB = velB.sub(normalB);
    const friction = slideB.sub(slideA).scale((1 + BALL.tangential) * slideMass);
    const twist = n.scale((n.dot(b.spin) - n.dot(a.spin)) * (1 + BALL.angular) * inertia);

    const impulse = bounce.add(friction);
    a.applyImpulse(leverA, impulse, twist);
    b.applyImpulse(leverB, impulse.negate(), twist.negate());

    this.onBallCollision(a, b, impactSpeed);
  }

  // The mouse clicked `ball` with a ray travelling along `rayDir` that passed
  // through `rayPoint`. Push the ball along the ray; an off-centre click also
  // makes it spin, just like flicking a real ball.
  push(ball, rayPoint, rayDir) {
    // The point on the ray closest to the ball's centre tells us how far
    // off-centre the click was. Scale it out to the ball's surface.
    const toCenter = ball.position.sub(rayPoint);
    const closest = rayPoint.add(rayDir.scale(toCenter.dot(rayDir)));
    let lever = closest.sub(ball.position);
    lever = lever.lengthSq() > 1e-12
      ? lever.normalize().scale(ball.radius)
      : rayDir.scale(-ball.radius);   // dead-centre hit: no spin

    ball.applyImpulse(lever, rayDir.scale(CLICK_IMPULSE));
    this.changed();
  }
}


// A ball's angular momentum around the middle of the box: its circling
// (position × mass·velocity) plus its own spin (inertia · spin).
function angularMomentum(ball) {
  return ball.position.cross(ball.velocity.scale(ball.mass)).add(ball.spin.scale(ball.inertia));
}

// -----------------------------------------------------------------------------
// Finding free spots for new balls quickly. Checking a spot against every
// ball is slow when there are hundreds of balls and a crowded room needs
// thousands of tries. So:
//   - the balls are sorted into the cubes of a grid laid over the room, and
//     a spot is only checked against the balls in its own cube and the 26
//     around it (the cubes are wider than any ball, so that is enough);
//   - when random tries no longer find a gap, every spot of a fine grid is
//     checked ONCE, and the free ones are remembered for the next balls
//     (each is checked again when it is used, as a ball may have taken it);
//   - once a size no longer fits anywhere, that is remembered too.
// -----------------------------------------------------------------------------
const GAP = 0.05;   // the least space left between new balls and anything else

class FreeSpots {
  constructor(physics) {
    this.physics = physics;
    this.widest = 0;          // radius of the widest ball sorted in
    this.free = new Map();    // radius → spots found free by searchEverywhere
    this.fullFor = Infinity;  // no ball this big or bigger fits any more
    this.build(0.5);
  }

  // Lay a grid of cubes over the room, wide enough for balls up to
  // `radius`, and sort the balls in.
  build(radius) {
    const { min, max } = this.physics.room;
    this.widest = Math.max(radius, ...this.physics.balls.map((b) => b.radius));
    this.size = 2 * (this.widest + GAP);
    this.min = min;
    this.nx = Math.floor((max.x - min.x) / this.size) + 1;
    this.ny = Math.floor((max.y - min.y) / this.size) + 1;
    this.nz = Math.floor((max.z - min.z) / this.size) + 1;
    this.cubes = Array.from({ length: this.nx * this.ny * this.nz }, () => []);
    for (const ball of this.physics.balls) this.sortIn(ball);
  }

  cell(value, low, count) { return Math.min(count - 1, Math.max(0, Math.floor((value - low) / this.size))); }

  sortIn(ball) {
    const p = ball.position;
    const x = this.cell(p.x, this.min.x, this.nx), y = this.cell(p.y, this.min.y, this.ny), z = this.cell(p.z, this.min.z, this.nz);
    this.cubes[x + this.nx * (y + this.ny * z)].push(ball);
  }

  // A ball has been placed: from now on it is in the way.
  add(ball) {
    if (ball.radius > this.widest) this.build(ball.radius);
    else this.sortIn(ball);
  }

  isFull(radius) { return radius >= this.fullFor; }

  // Does a ball of `radius` fit at `spot`, inside the room and touching nothing?
  isClear(spot, radius) {
    if (radius > this.widest) this.build(radius);
    if (!this.physics.isInside(spot, radius, GAP)) return false;
    const cx = this.cell(spot.x, this.min.x, this.nx), cy = this.cell(spot.y, this.min.y, this.ny), cz = this.cell(spot.z, this.min.z, this.nz);
    for (let z = Math.max(0, cz - 1); z <= Math.min(this.nz - 1, cz + 1); z++) {
      for (let y = Math.max(0, cy - 1); y <= Math.min(this.ny - 1, cy + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(this.nx - 1, cx + 1); x++) {
          for (const b of this.cubes[x + this.nx * (y + this.ny * z)]) {
            const far = b.radius + radius + GAP;
            if (b.position.distanceSq(spot) <= far * far) return false;
          }
        }
      }
    }
    return true;
  }

  // Check a grid of spots 0.4 units apart (once per size), and hand out
  // a random free one; null if there is none left.
  searchEverywhere(radius) {
    let free = this.free.get(radius);
    if (!free) {
      free = [];
      const { min, max } = this.physics.room;
      for (let x = min.x; x <= max.x; x += 0.4) {
        for (let y = min.y; y <= max.y; y += 0.4) {
          for (let z = min.z; z <= max.z; z += 0.4) {
            const spot = new Vec3(x, y, z);
            if (this.isClear(spot, radius)) free.push(spot);
          }
        }
      }
      this.free.set(radius, free);
    }
    while (free.length) {
      const i = Math.floor(Math.random() * free.length);
      const spot = free[i];
      free[i] = free[free.length - 1];   // (remove it from the list either way)
      free.pop();
      if (this.isClear(spot, radius)) return spot;
    }
    this.fullFor = Math.min(this.fullFor, radius);
    return null;
  }
}

// -----------------------------------------------------------------------------
// The collision plan: a "diary" of predicted collisions, made afresh at the
// start of every frame and kept up to date during it.
//
// Finding the next collision means checking every ball against every wall and
// against the other balls. With 1000 balls there are almost 500,000 pairs,
// far too many to check after every bounce, or even once per frame. But in
// one frame a ball only travels a short way, so it can only meet balls that
// are already close by. The plan therefore starts by working out how far
// any ball can possibly travel before the frame is over (`reach`, from the
// fastest ball's speed plus a margin), sorts the balls into the cubes of a
// coarse grid, and lists as "neighbours" only the pairs that are near enough
// to meet within the frame. Pairs that are not listed cannot collide before
// the next plan is made, so nothing is missed: the result is exactly what
// checking all pairs would give, only much faster.
//
// After a bounce only the one or two balls involved change course, so only
// their predictions are redone. Should a bounce make a ball faster than the
// plan allowed it (its own speed limit, see nearbyPairs), the plan says so
// (`tooFast`) and a new one is made.
//
// For each ball we also remember its own earliest event ("best"), so finding
// the overall next collision only means looking at one entry per ball.
// All times are measured from when the plan was made.
// -----------------------------------------------------------------------------
const SPEED_MARGIN = 1.25;   // allow balls to become this much faster than they are now
const TYPICAL_SPEEDS = 3;    // "typical" speeds go up to this many times the average (rms) speed

// Which pairs of balls are near enough to meet within the next `horizon`
// seconds, assuming no ball becomes faster than its own speed limit (worked
// out here, with a margin, and returned as `speedLimits`)? Used by the
// collision plans of both the normal physics and the precise one
// (precise.js).
//
// Every ball gets the same limit, a little above the fastest typical speed,
// except a ball that is much faster than the rest (one that was just pushed,
// say): it gets a limit of its own. Two balls can only meet if they are
// closer than the distance both can travel, so only the fast ball looks
// further ahead. (With one limit for all, set by the fastest ball, a single
// push in the Gas preset made every ball look 50 times as many neighbours
// ahead, and the physics took up to a third of a second per frame.)
export function nearbyPairs(balls, gravity, horizon) {
  const n = balls.length;
  // (No balls, no pairs: the grid below needs at least one ball to size it.)
  if (n === 0) return { speedLimits: new Float64Array(0), pairA: new Int32Array(0), pairB: new Int32Array(0), firstPair: new Int32Array(1), pairsOf: new Int32Array(0) };
  // The typical speed: the fastest one, but not more than TYPICAL_SPEEDS
  // times the average (root-mean-square) speed.
  let fastest = 0, biggest = 0, squares = 0;
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    speed[i] = b.velocity.length();
    fastest = Math.max(fastest, speed[i]);
    biggest = Math.max(biggest, b.radius);
    squares += speed[i] * speed[i];
  }
  const typical = Math.min(fastest, TYPICAL_SPEEDS * Math.sqrt(squares / Math.max(1, n)));
  const speedLimits = new Float64Array(n);
  for (let i = 0; i < n; i++) speedLimits[i] = Math.max(speed[i], typical) * SPEED_MARGIN + 1e-9;
  // (Gravity pulls all balls alike, so it does not bring two balls closer;
  // but it can speed up a ball between bounces, hence the extra g · horizon.)
  const g = gravity.length();
  const extra = 2 * g * horizon;
  const reachOf = (limitA, limitB) => (limitA + limitB + extra) * horizon;

  // Sort the balls into grid cubes as wide as the longest distance at
  // which two typical balls can meet; then a typical ball's possible
  // partners are all in its own cube or the 26 around it. A faster ball
  // looks further, as many cubes out as its reach needs. (If the balls are
  // spread over a huge space, the cubes are made bigger so there are not
  // too many.)
  let lowX = Infinity, lowY = Infinity, lowZ = Infinity, highX = -Infinity, highY = -Infinity, highZ = -Infinity;
  for (const b of balls) {
    const p = b.position;
    lowX = Math.min(lowX, p.x); lowY = Math.min(lowY, p.y); lowZ = Math.min(lowZ, p.z);
    highX = Math.max(highX, p.x); highY = Math.max(highY, p.y); highZ = Math.max(highZ, p.z);
  }
  const typicalLimit = typical * SPEED_MARGIN + 1e-9;
  let size = 2 * biggest + reachOf(typicalLimit, typicalLimit), nx, ny, nz;
  for (;;) {
    nx = Math.floor((highX - lowX) / size) + 1;
    ny = Math.floor((highY - lowY) / size) + 1;
    nz = Math.floor((highZ - lowZ) / size) + 1;
    if (nx * ny * nz <= 8 * n + 64) break;
    size *= 1.5;
  }
  const cubeOf = new Int32Array(n);
  const start = new Int32Array(nx * ny * nz + 1);         // balls of cube c: inCube[start[c] … start[c+1])
  for (let i = 0; i < n; i++) {
    const p = balls[i].position;
    const c = Math.floor((p.x - lowX) / size) + nx * (Math.floor((p.y - lowY) / size) + ny * Math.floor((p.z - lowZ) / size));
    cubeOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c];
  const inCube = new Int32Array(n), filled = start.slice(0, nx * ny * nz);
  for (let i = 0; i < n; i++) inCube[filled[cubeOf[i]]++] = i;

  // Each pair is found by the faster of its two balls (or, at equal limits,
  // by the one with the lower number), which looks far enough for both.
  // (Noted in lists kept from one plan to the next, grown when full, rather
  // than in new growing arrays every time: with thousands of balls there are
  // hundreds of thousands of pairs, and cleaning up after them took time.)
  let pairs = 0, pairA = foundA, pairB = foundB;
  for (let i = 0; i < n; i++) {
    const a = balls[i], pa = a.position, limit = speedLimits[i];
    const cubes = Math.ceil((a.radius + biggest + reachOf(limit, limit)) / size);   // how many cubes out
    const c = cubeOf[i], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (let cz = Math.max(0, z - cubes); cz <= Math.min(nz - 1, z + cubes); cz++) {
      for (let cy = Math.max(0, y - cubes); cy <= Math.min(ny - 1, y + cubes); cy++) {
        for (let cx = Math.max(0, x - cubes); cx <= Math.min(nx - 1, x + cubes); cx++) {
          const cube = cx + nx * (cy + ny * cz);
          for (let k = start[cube]; k < start[cube + 1]; k++) {
            const j = inCube[k];
            const other = speedLimits[j];
            if (other > limit || (other === limit && j <= i)) continue;   // the other one finds it
            const b = balls[j], pb = b.position;
            const ox = pb.x - pa.x, oy = pb.y - pa.y, oz = pb.z - pa.z;
            const far = a.radius + b.radius + reachOf(limit, other);
            if (ox * ox + oy * oy + oz * oz < far * far) {
              if (pairs === pairA.length) {
                const grownA = new Int32Array(2 * pairA.length), grownB = new Int32Array(2 * pairA.length);
                grownA.set(pairA); grownB.set(pairB);
                pairA = foundA = grownA; pairB = foundB = grownB;
              }
              pairA[pairs] = i; pairB[pairs] = j; pairs++;
            }
          }
        }
      }
    }
  }

  // The pairs, and for every ball the list of its pairs.
  const firstPair = new Int32Array(n + 1);
  for (let p = 0; p < pairs; p++) { firstPair[pairA[p] + 1]++; firstPair[pairB[p] + 1]++; }
  for (let i = 0; i < n; i++) firstPair[i + 1] += firstPair[i];
  const pairsOf = new Int32Array(2 * pairs);
  const fill = firstPair.slice(0, n);
  for (let p = 0; p < pairs; p++) {
    pairsOf[fill[pairA[p]]++] = p;
    pairsOf[fill[pairB[p]]++] = p;
  }
  return { speedLimits, pairA: pairA.slice(0, pairs), pairB: pairB.slice(0, pairs), firstPair, pairsOf };
}
// (The lists nearbyPairs notes the pairs in, kept for the next time.)
let foundA = new Int32Array(1024), foundB = new Int32Array(1024);

class CollisionPlan {
  // `horizon`: how far ahead (in simulated seconds) the plan must be right.
  // `bringUpToDate(ball)`: moves a ball to the present moment (see
  // Physics.update: balls are only moved when they are needed).
  constructor(balls, walls, direction, gravity, gravityStrength, horizon, bringUpToDate) {
    this.balls = balls;
    this.ballCount = balls.length;
    this.bringUpToDate = bringUpToDate;
    this.walls = walls;
    this.horizon = horizon;
    this.clock = 0;   // (see Physics.update)
    this.direction = direction;
    this.gravity = gravity;
    this.gravityStrength = gravityStrength;
    this.now = 0;                                   // time passed since made
    const n = balls.length;

    // Which pairs of balls are near enough to meet during the plan?
    const near = nearbyPairs(balls, gravity, horizon);
    this.speedLimits = near.speedLimits;
    this.pairA = near.pairA;
    this.pairB = near.pairB;
    this.firstPair = near.firstPair;   // ball i's pairs: pairsOf[firstPair[i] … firstPair[i+1])
    this.pairsOf = near.pairsOf;
    this.pairTime = new Float64Array(this.pairA.length).fill(Infinity);

    this.wallTime = new Float64Array(n).fill(Infinity);
    this.wallNormal = new Array(n).fill(null);
    // Each ball's earliest event: when, and with which other ball (-1: its
    // wall hit, wallNormal). (Two plain lists rather than an object per
    // ball, made anew at every prediction: with thousands of balls, cleaning
    // those up took a tenth of the time.)
    this.bestTime = new Float64Array(n).fill(Infinity);
    this.bestOther = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) this.predictWall(i);
    for (let p = 0; p < this.pairA.length; p++) this.predictPair(p);
    for (let i = 0; i < n; i++) this.findBest(i);

    // The balls in a heap by their earliest event, soonest on top (and of
    // two at the same moment, the one with the lower number, as a search
    // through them all in order would find): the next collision of all is
    // then on top, rather than searched for among all the balls at every
    // collision, which with thousands of balls took most of the time. When
    // a ball's earliest event changes, only it moves in the heap (see fix).
    this.heap = new Int32Array(n);
    this.at = new Int32Array(n);                    // where each ball is in the heap
    for (let i = 0; i < n; i++) { this.heap[i] = i; this.at[i] = i; }
    for (let k = (n >> 1) - 1; k >= 0; k--) this.siftDown(k);
  }

  // The next collision of all: { time (from now), ball, other or wall }.
  earliest() {
    if (this.ballCount === 0) return { time: Infinity };
    const ball = this.heap[0], time = this.bestTime[ball], other = this.bestOther[ball];
    if (!(time < Infinity)) return { time: Infinity };
    return other < 0 ? { time: time - this.now, ball, wall: this.wallNormal[ball] } : { time: time - this.now, ball, other };
  }

  // (The heap: is ball i's event before ball j's?)
  sooner(i, j) {
    const a = this.bestTime[i], b = this.bestTime[j];
    return a < b || (a === b && i < j);
  }
  siftDown(k) {
    const heap = this.heap, at = this.at, n = this.ballCount, i = heap[k];
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && this.sooner(heap[c + 1], heap[c])) c++;
      if (!this.sooner(heap[c], i)) break;
      heap[k] = heap[c]; at[heap[k]] = k; k = c;
    }
    heap[k] = i; at[i] = k;
  }
  siftUp(k) {
    const heap = this.heap, at = this.at, i = heap[k];
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.sooner(i, heap[parent])) break;
      heap[k] = heap[parent]; at[heap[k]] = k; k = parent;
    }
    heap[k] = i; at[i] = k;
  }
  // Ball i's earliest event changed: its place in the heap too.
  fix(i) {
    if (!this.heap) return;   // (still being made: the heap is built at the end)
    const k = this.at[i];
    if (k > 0 && this.sooner(i, this.heap[(k - 1) >> 1])) this.siftUp(k);
    else this.siftDown(k);
  }

  timePassed(t) { this.now += t; }

  // Has a bounce made one of these balls faster than the plan allows for?
  // Then the plan could miss a collision, and a new one must be made.
  tooFast(changed) {
    return changed.some((i) => this.balls[i].velocity.length() > this.speedLimits[i]);
  }

  // Re-predict everything involving the balls in `changed`.
  update(changed) {
    // Their own predictions.
    for (const a of changed) {
      this.predictWall(a);
      for (let q = this.firstPair[a]; q < this.firstPair[a + 1]; q++) this.predictPair(this.pairsOf[q]);
    }
    // Only these balls and their neighbours can have a different earliest
    // event now. The changed balls: look again at all of theirs. A
    // neighbour k: if its earliest event was with a changed ball, look again
    // at all of its own; otherwise only its pair with the changed ball (the
    // one just predicted again) can beat it. (Taken straight from the pair
    // that leads to k, rather than by searching through all of k's pairs
    // for the changed balls: with thousands of balls, each with dozens of
    // pairs, that search took most of the time.)
    for (const a of changed) this.findBest(a);
    for (const a of changed) {
      for (let q = this.firstPair[a]; q < this.firstPair[a + 1]; q++) {
        const p = this.pairsOf[q];
        const k = this.pairA[p] === a ? this.pairB[p] : this.pairA[p];
        if (changed.includes(k)) continue;   // (done above)
        const other = this.bestOther[k];
        if (other >= 0 && changed.includes(other)) {
          this.findBest(k);   // its earliest event involved a changed ball: look again
        } else if (this.pairTime[p] < this.bestTime[k]) {
          this.bestTime[k] = this.pairTime[p];
          this.bestOther[k] = a;
          this.fix(k);
        }
      }
    }
  }

  predictWall(i) {
    this.bringUpToDate(this.balls[i]);
    let time = Infinity, normal = null;
    for (const wall of this.walls) {
      const t = timeUntilWall(this.balls[i], wall, this.direction, this.gravity);
      if (t < time) { time = t; normal = wall.normal; }
    }
    this.wallTime[i] = this.now + time;
    this.wallNormal[i] = normal;
  }

  predictPair(p) {
    this.bringUpToDate(this.balls[this.pairA[p]]);
    this.bringUpToDate(this.balls[this.pairB[p]]);
    this.pairTime[p] = this.now + timeUntilBallsTouch(this.balls[this.pairA[p]], this.balls[this.pairB[p]], this.direction);
  }

  // Ball i's earliest event: its wall hit or its first hit with another ball.
  findBest(i) {
    let time = this.wallTime[i], other = -1;
    for (let q = this.firstPair[i]; q < this.firstPair[i + 1]; q++) {
      const p = this.pairsOf[q];
      const t = this.pairTime[p];
      if (t < time) { time = t; other = this.pairA[p] === i ? this.pairB[p] : this.pairA[p]; }
    }
    this.bestTime[i] = time;
    this.bestOther[i] = other;
    this.fix(i);
  }
}


// -----------------------------------------------------------------------------
// When do things collide?
//
// Both questions below come down to a quadratic equation, a·t² + b·t + c = 0,
// the kind solved with the formula t = (−b ± √(b² − 4ac)) / 2a from school.
// -----------------------------------------------------------------------------

// How long until `ball` hits `wall` (outward direction wall.normal, at
// distance wall.offset)?
//
// The ball's distance past the wall changes as
//     gap(t) = c + b·t + a·t²
// with c = how far past the wall it is now (negative = still inside),
//      b = its speed towards the wall, a = half of gravity towards the wall.
// It hits when gap(t) = 0 while moving outwards.
function timeUntilWall(ball, wall, direction, gravity) {
  const n = wall.normal;
  const a = 0.5 * n.dot(gravity);
  const b = direction * n.dot(ball.velocity);
  const c = n.dot(ball.position) + ball.radius - wall.offset;

  if (c >= 0 && b > 0) return 0;   // already touching and moving out: now

  // Possible moments (roots), keeping those in the future where the ball is
  // moving outwards (the gap is growing: 2a·t + b > 0). (Two plain numbers
  // rather than a list of them: this runs for every ball after every bounce.)
  let first, second = Infinity;
  if (Math.abs(a) < 1e-12) {
    first = b !== 0 ? -c / b : Infinity;     // no gravity this way: a straight line
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;            // never reaches the wall
    // This form of the formula avoids losing precision when b is large.
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    first = q / a;
    second = q !== 0 ? c / q : Infinity;
  }

  let best = Infinity;
  if (first >= 0 && 2 * a * first + b > 0) best = first;
  if (second >= 0 && 2 * a * second + b > 0 && second < best) best = second;
  return best;
}

// How long until balls `a` and `b` touch?
//
// Gravity pulls both balls equally, so it doesn't change how they move
// relative to each other: seen from ball a, ball b moves in a straight line.
// They touch when the distance between their centres equals the sum of the
// radii R:   |offset + relativeVelocity·t|² = R²,
// which works out as  A·t² + 2B·t + C = 0  with
//   A = relativeVelocity·relativeVelocity, B = offset·relativeVelocity,
//   C = offset·offset − R².
function timeUntilBallsTouch(a, b, direction) {
  // (Written out with plain numbers rather than Vec3s: this runs for every
  // pair of balls, thousands of times per second.)
  const pa = a.position, pb = b.position, va = a.velocity, vb = b.velocity;
  const ox = pb.x - pa.x, oy = pb.y - pa.y, oz = pb.z - pa.z;                  // offset
  const vx = (vb.x - va.x) * direction, vy = (vb.y - va.y) * direction, vz = (vb.z - va.z) * direction;
  const R = a.radius + b.radius;

  const B = ox * vx + oy * vy + oz * vz;
  if (B >= 0) return Infinity;       // moving apart (or not at all): never
  const C = ox * ox + oy * oy + oz * oz - R * R;
  if (C <= 0) return 0;              // already touching and closing in: now
  const A = vx * vx + vy * vy + vz * vz;
  const disc = B * B - A * C;
  if (disc < 0) return Infinity;     // they pass each other without touching
  // The earlier of the two solutions, (−B − √disc) / A, written in a form
  // that stays precise.
  return C / (-B + Math.sqrt(disc));
}
