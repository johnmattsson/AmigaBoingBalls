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

// --- Scene layout ------------------------------------------------------------

export const BOX_HALF_SIZE = 6;    // walls are at x, y, z = ±6
export const BALL_RADIUS = 1;

// --- Tunable values ---------------------------------------------------------
// The original ran its physics once per screen refresh, so it ran twice as
// fast on a 120 Hz screen. These values are the original ones converted to
// "per second" so the demo behaves the same on every screen.

// At Gravity = 1 the balls fall with 36 units/s² (the slider default is 0.1).
export const GRAVITY_SCALE = 36;

// How hard a mouse click pushes a ball (change of speed in units/s).
export const CLICK_IMPULSE = 6;

// Safety limit: never handle more collisions than this in one frame (only
// matters if something extreme happens, like balls jammed into a corner).
const MAX_COLLISIONS_PER_FRAME = 1000;

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

// The four classic colours (red, green, blue, yellow). The second colour of
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
class Ball {
  constructor(index, position, velocity, radius = BALL_RADIUS) {
    this.position = position;
    this.velocity = velocity;

    // The path the ball has just flown, for drawing trails: a flat list of
    // numbers, four per point (x, y, z and the time it was there).
    this.trail = [];

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
    // are about the same size on every ball.
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
    // (Written out with plain numbers: this runs very often, and creating
    // fewer temporary Vec3 objects saves the browser clean-up work.)
    const p = this.position, v = this.velocity, h = 0.5 * dt * dt;
    this.position = new Vec3(p.x + v.x * dt + gravity.x * h, p.y + v.y * dt + gravity.y * h, p.z + v.z * dt + gravity.z * h);
    this.velocity = new Vec3(v.x + gravity.x * dt, v.y + gravity.y * dt, v.z + gravity.z * dt);

    // The rotation is caught up later (see catchUpRotation): between
    // collisions a ball spins at a constant rate, so turning it once by the
    // total time gives the same result as turning it after every step.
    this.unturnedTime += dt;
  }

  // Turn the ball by (spin speed × time) around its spin axis, for all the
  // time it has moved since the last turn. Needed before its spin changes,
  // and once per frame for drawing.
  catchUpRotation() {
    const speed = this.spin.length();
    if (speed > 0 && this.unturnedTime !== 0) {
      const turn = Quat.fromAxisAngle(this.spin.scale(1 / speed), speed * this.unturnedTime);
      this.orientation = turn.multiply(this.orientation).normalize();
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
  // the collision plan is worked out again. (It is also redone every second
  // of simulated time anyway, as a safety net.)
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
      return ball;
    });
    this.fitBallsInside();
    this.changed();
  }

  // Add `count` balls of `radius` in free spots, each heading off in a
  // random direction at `speed` (fewer, if the room fills up).
  addRandomBalls(count, radius, speed = 3) {
    for (let i = 0; i < count; i++) {
      const spot = this.findFreeSpot(radius);
      if (!spot) break;
      const direction = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.balls.push(new Ball(this.balls.length, spot, direction.normalize().scale(speed), radius));
    }
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
    for (const ball of outside) {
      const spot = this.findFreeSpot(ball.radius);
      if (!spot) continue;
      ball.position = spot;
      ball.trail.length = 0;
      this.balls.push(ball);
    }
  }

  // Add or remove balls until there are `count` (or as many as fit).
  setBallCount(count) {
    this.changed();
    while (this.balls.length > count) this.balls.pop();
    while (this.balls.length < count) {
      const index = this.balls.length;
      if (index < 4 && this.sizeMix === 0 && this.ballSize <= 1.5) {
        // The classic start: four equal balls along the box's diagonal,
        // drifting sideways. (Bigger balls than 1.5 would overlap there.)
        const d = 2.5 * (3 - index) - 3.75;       // 3.75, 1.25, -1.25, -3.75
        this.balls.push(new Ball(index, new Vec3(d, d, d), new Vec3(1.8, 0, 0), BALL_RADIUS * this.ballSize));
        continue;
      }
      // Other balls get a size from the size mix and appear in a free spot,
      // heading off in a random direction. In a crowded box a big ball may
      // not fit anywhere, so try a few other sizes, ending with the smallest.
      let radius, spot = null;
      for (let attempt = 0; attempt < 6 && !spot; attempt++) {
        radius = attempt < 5 ? this.randomRadius() : BALL_RADIUS * this.ballSize * 2 ** -this.sizeMix;
        spot = this.findFreeSpot(radius);
      }
      if (!spot) break;   // the box is full
      const direction = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.balls.push(new Ball(index, spot, direction.normalize().scale(3), radius));
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
  findFreeSpot(radius) {
    const { min, max } = this.room;
    const isClear = (spot) =>
      this.isInside(spot, radius, 0.05) &&
      this.balls.every((b) => b.position.distanceSq(spot) > (b.radius + radius + 0.05) ** 2);
    const between = (low, high) => low + Math.random() * (high - low);

    // Usually a few random tries are enough...
    for (let attempt = 0; attempt < 200; attempt++) {
      const spot = new Vec3(between(min.x, max.x), between(min.y, max.y), between(min.z, max.z));
      if (isClear(spot)) return spot;
    }

    // ...but in a crowded room, random tries keep missing the few gaps left.
    // Then check a grid of spots every 0.4 units, and pick one of the free ones.
    const free = [];
    for (let x = min.x; x <= max.x; x += 0.4) {
      for (let y = min.y; y <= max.y; y += 0.4) {
        for (let z = min.z; z <= max.z; z += 0.4) {
          const spot = new Vec3(x, y, z);
          if (isClear(spot)) free.push(spot);
        }
      }
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
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
    return this.balls.reduce((sum, b) =>
      sum + b.mass * g * (b.position.y - b.radius - this.room.floorY), 0);
  }

  totalEnergy(gravityStrength) {
    return this.motionEnergy() + this.heightEnergy(gravityStrength);
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
  // gravityStrength: the Gravity setting (0 … 0.5).
  update(seconds, gravityStrength) {
    const direction = Math.sign(seconds);   // +1 forwards, -1 backwards
    if (direction === 0) return;
    // A trail shows where a ball came from, so it starts afresh when time
    // changes direction.
    if (direction !== this.lastDirection) this.clearTrails();
    this.lastDirection = direction;
    const gravity = new Vec3(0, -GRAVITY_SCALE * gravityStrength, 0);
    let timeLeft = Math.abs(seconds);

    // Predict when every ball will hit every wall and every other ball. The
    // predictions stay valid from frame to frame, so this is only redone
    // when something changed them: the direction of time, gravity, a click,
    // the energy or the balls themselves (see changed()), and after one
    // second of simulated time as a safety net.
    let plan = this.plan;
    if (!plan || plan.direction !== direction || plan.gravityStrength !== gravityStrength || plan.now > 1) {
      plan = this.plan = new CollisionPlan(this.balls, this.room.walls, direction, gravity, gravityStrength);
    }

    for (let count = 0; count < MAX_COLLISIONS_PER_FRAME; count++) {
      // When is the next collision, and what is it?
      const next = plan.earliest();
      if (next.time > timeLeft) break;   // nothing more happens this frame

      // Move everybody exactly to that moment, then bounce.
      this.moveAll(direction * next.time, gravity);
      timeLeft -= next.time;
      plan.timePassed(next.time);
      if (next.wall) this.collideWithWall(this.balls[next.ball], next.wall);
      else this.collideBalls(this.balls[next.ball], this.balls[next.other]);

      // A bounce is a corner in the path: note it in the trails.
      if (this.trailSeconds > 0) {
        this.recordTrail(this.balls[next.ball], true);
        if (!next.wall) this.recordTrail(this.balls[next.other], true);
      }

      // Only the balls that just bounced change course, so only their
      // predictions need redoing.
      plan.update(next.wall ? [next.ball] : [next.ball, next.other]);
    }

    this.moveAll(direction * timeLeft, gravity);
    plan.timePassed(timeLeft);

    // Bring every ball's rotation up to date for drawing.
    for (const ball of this.balls) ball.catchUpRotation();
    if (this.trailSeconds > 0) for (const ball of this.balls) this.recordTrail(ball);
  }

  moveAll(dt, gravity) {
    for (const ball of this.balls) ball.move(dt, gravity);
    this.time += dt;
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
    const trail = ball.trail;
    const n = trail.length;
    const headIsFree = n >= 8 && !ball.trailCorner && Math.abs(this.time - trail[n - 5]) < TRAIL_STEP;
    if (headIsFree) trail.length = n - 4;   // move the head: drop it, add it again below
    trail.push(ball.position.x, ball.position.y, ball.position.z, this.time);
    ball.trailCorner = isCorner;
    let old = Math.max(0, trail.length - 4 * MAX_TRAIL_POINTS);
    while (old < trail.length && Math.abs(this.time - trail[old + 3]) > this.trailSeconds) old += 4;
    if (old) trail.splice(0, old);
  }

  clearTrails() {
    for (const ball of this.balls) ball.trail.length = 0;
  }

  // A ball hits a wall whose outward direction is `n`.
  collideWithWall(ball, n) {
    const lever = n.scale(ball.radius);                // centre → contact point
    const contactVel = ball.surfaceVelocity(lever);
    const normalVel = n.scale(n.dot(contactVel));      // part going into the wall
    const slideVel = contactVel.sub(normalVel);        // part sliding along it

    // Kick that reverses the "into the wall" motion...
    const WALL = this.wallBounce;
    const bounce = normalVel.scale(-(1 + WALL.normal) * ball.mass);
    // ...plus friction acting against the sliding.
    const friction = slideVel.scale(-(1 + WALL.tangential) * ball.slideMass);
    // ...plus friction against twisting around the contact normal.
    const twist = n.scale(-n.dot(ball.spin) * (1 + WALL.angular) * ball.inertia);

    // How hard it hit: its speed into the wall (for the sound).
    const impactSpeed = Math.abs(n.dot(ball.velocity));

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
// The collision plan: a "diary" of predicted collisions.
//
// Finding the next collision means checking every ball against every wall and
// every other ball: with 100 balls that is almost 5,000 pairs. Doing that
// after every single bounce would be slow. But a bounce only changes the
// course of the one or two balls involved, and every other prediction stays
// valid. So we predict everything once per frame, and after each bounce
// re-predict only for the balls that bounced.
//
// For each ball we also remember its own earliest event ("best"), so finding
// the overall next collision only means looking at one entry per ball.
// All times are measured from when the plan was made.
// -----------------------------------------------------------------------------
class CollisionPlan {
  constructor(balls, walls, direction, gravity, gravityStrength) {
    this.balls = balls;
    this.walls = walls;
    this.direction = direction;
    this.gravity = gravity;
    this.gravityStrength = gravityStrength;
    this.now = 0;                                   // time passed since made
    const n = balls.length;
    this.pairTime = new Float64Array(n * n).fill(Infinity);   // [i * n + j]
    this.wallTime = new Float64Array(n).fill(Infinity);
    this.wallNormal = new Array(n).fill(null);
    this.best = new Array(n);                       // each ball's earliest event

    for (let i = 0; i < n; i++) {
      this.predictWall(i);
      for (let j = i + 1; j < n; j++) this.predictPair(i, j);
    }
    for (let i = 0; i < n; i++) this.findBest(i);
  }

  // The next collision of all: { time (from now), ball, other or wall }.
  earliest() {
    let next = { time: Infinity };
    for (const event of this.best) if (event.time < next.time) next = event;
    return { ...next, time: next.time - this.now };
  }

  timePassed(t) { this.now += t; }

  // Re-predict everything involving the balls in `changed`.
  update(changed) {
    const n = this.balls.length;
    for (const a of changed) {
      this.predictWall(a);
      for (let k = 0; k < n; k++) if (k !== a) this.predictPair(a, k);
    }
    for (let k = 0; k < n; k++) {
      const best = this.best[k];
      if (changed.includes(k) || changed.includes(best.ball) || changed.includes(best.other)) {
        this.findBest(k);   // its earliest event involved a changed ball: look again
      } else {
        // Otherwise only the new predictions with the changed balls can beat it.
        for (const a of changed) {
          const t = this.pairTime[k * n + a];
          if (t < best.time) this.best[k] = { time: t, ball: k, other: a };
        }
      }
    }
  }

  predictWall(i) {
    let time = Infinity, normal = null;
    for (const wall of this.walls) {
      const t = timeUntilWall(this.balls[i], wall, this.direction, this.gravity);
      if (t < time) { time = t; normal = wall.normal; }
    }
    this.wallTime[i] = this.now + time;
    this.wallNormal[i] = normal;
  }

  predictPair(i, j) {
    const t = this.now + timeUntilBallsTouch(this.balls[i], this.balls[j], this.direction);
    const n = this.balls.length;
    this.pairTime[i * n + j] = t;
    this.pairTime[j * n + i] = t;
  }

  // Ball i's earliest event: its wall hit or its first hit with another ball.
  findBest(i) {
    const n = this.balls.length;
    let best = { time: this.wallTime[i], ball: i, wall: this.wallNormal[i] };
    for (let j = 0; j < n; j++) {
      const t = this.pairTime[i * n + j];
      if (j !== i && t < best.time) best = { time: t, ball: i, other: j };
    }
    this.best[i] = best;
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
  // moving outwards (the gap is growing: 2a·t + b > 0).
  let roots;
  if (Math.abs(a) < 1e-12) {
    roots = b !== 0 ? [-c / b] : [];          // no gravity this way: a straight line
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;            // never reaches the wall
    // This form of the formula avoids losing precision when b is large.
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    roots = [q / a, q !== 0 ? c / q : Infinity];
  }

  let best = Infinity;
  for (const t of roots) {
    if (t >= 0 && 2 * a * t + b > 0 && t < best) best = t;
  }
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
