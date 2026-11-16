// =============================================================================
// rewindcheck.js — would running time backwards still bring the balls
// back to where the scene started?
//
// When time runs backwards, the balls retrace their paths, but not for
// ever. Bouncing balls are chaotic: each collision makes the computer's
// tiny rounding errors several times bigger, and after some twenty
// collisions per ball (more with Digits: 32 or 64) the balls are on a
// different path and will not get back to the start.
//
// While time runs forwards, this estimates how far off such a rewind would
// end up. (It can only be estimated: the only way to know for sure is to
// try it.) For that, a hidden "twin" of the scene runs along: a copy in
// which every ball starts a tiny distance (10⁻¹² radii) away from the real
// one. How fast the twin drifts away from the real scene measures how
// strongly this scene magnifies small errors. (When the distance grows to
// 10⁻⁶ radii, the twin is pulled back in and the growth so far is noted,
// so the measurement can go on for as long as needed.) A rewind's miss at
// the start is then about the rounding error of one number (10⁻¹⁶ with 16
// digits, 10⁻³² with 32, 10⁻⁶⁴ with 64) times that growth. Tried against
// real rewinds on many scenes, this lands within a factor of about 1–1000
// of the real miss; it is multiplied by 50, so that it rather warns a
// little early than late.
// =============================================================================

import { Physics } from './physics.js';
import { Vec3, Quat } from './math.js';

export const DRIFTING = 1e-3;         // off by more than this many radii: "will drift"
export const LOST = 1;                // off by more than a whole radius: "not possible"

const TWIN_START = 1e-12;             // the twin's balls start this far off (in radii) ...
const TWIN_PULL_BACK = 1e-6;          // ... and are pulled back in when they are this far off
const ROUNDING = { 0: 1e-16, 2: 1e-32, 4: 1e-64 };   // by Physics.precise (16, 32, 64 digits)
const SAFETY = 50;                    // see the top of the file
const NOTE_EVERY = 0.5;               // seconds of simulated time between notes of the growth

// The twin: a copy of the scene, a tiny distance away (see above).
class Twin {
  constructor(physics, growth = 0) {
    this.real = physics;
    this.copy = new Physics(0, 0);
    this.copy.turnBalls = false;   // (nobody sees it)
    const o = (ball) => new Quat(ball.orientation.x, ball.orientation.y, ball.orientation.z, ball.orientation.w);
    this.copy.balls = physics.balls.map((ball) =>
      Object.assign(Object.create(Object.getPrototypeOf(ball)), ball, { trail: [], precise: null, orientation: o(ball) }));
    this.copy.time = physics.time;
    this.growth = growth;           // the growth so far, as a natural logarithm
    this.pullBack(0);
  }

  // Put every twin ball at the real one plus `scale` × how far off it was
  // (scale 0: plus a fresh tiny random step).
  pullBack(scale) {
    this.copy.balls.forEach((twin, i) => {
      const real = this.real.balls[i];
      if (scale === 0) {
        const step = new Vec3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        twin.position = real.position.add(step.normalize().scale(TWIN_START * real.radius));
        twin.velocity = real.velocity;
        twin.spin = real.spin;
      } else {
        twin.position = real.position.add(twin.position.sub(real.position).scale(scale));
        twin.velocity = real.velocity.add(twin.velocity.sub(real.velocity).scale(scale));
        twin.spin = real.spin.add(twin.spin.sub(real.spin).scale(scale));
      }
    });
    this.copy.changed();
  }

  // How far the twin is from the real scene: the largest distance between
  // a ball and its twin, in radii.
  distance() {
    let most = 0;
    this.copy.balls.forEach((twin, i) => {
      most = Math.max(most, twin.position.sub(this.real.balls[i].position).length() / twin.radius);
    });
    return most;
  }

  step(seconds, gravityStrength) {
    const copy = this.copy, real = this.real;
    copy.room = real.room;
    copy.ballBounce = real.ballBounce;
    copy.wallBounce = real.wallBounce;
    copy.down = real.down;
    copy.update(seconds, gravityStrength);
    const distance = this.distance();
    // Pull back, but not while a ball and its twin are on either side of a
    // collision (one has bounced, the other not quite yet): their speeds
    // then differ by a lot, which is not a small error. That passes within
    // a frame.
    const straddling = copy.balls.some((twin, i) =>
      twin.velocity.sub(real.balls[i].velocity).length() > 1e3 * TWIN_PULL_BACK * twin.radius);
    if (distance > TWIN_PULL_BACK && !straddling) {
      this.growth += Math.log(distance / TWIN_START);
      this.pullBack(TWIN_START / distance);
    }
  }

  // The total growth so far (natural logarithm).
  total() { return this.growth + Math.log(Math.max(this.distance(), TWIN_START) / TWIN_START); }
}

export class RewindCheck {
  constructor(physics) {
    this.physics = physics;
    this.balls = null;            // the balls of the scene being watched
    this.ballCount = 0;
    this.twin = null;
    this.direction = 1;
    // The growth so far, noted every half second of simulated time (mark
    // number k = time k·NOTE_EVERY), so that after running backwards for a
    // while and then forwards again, the estimate carries on from there.
    this.notes = new Map();
    // Has the scene been changed by hand (a click, a slider) since it
    // started? Then no rewind can bring it back to the start.
    this.changedByHand = false;
    // Off by default: the twin costs about as much time as the physics.
    this.enabled = false;
  }

  // Switch the estimate on or off. Switched on, it starts afresh from here:
  // a new twin, and nothing that was changed by hand before counts.
  setEnabled(on) {
    this.enabled = on;
    if (on) this.changedByHand = false;
    this.notes.clear();
    this.direction = 1;
    this.twin = on && this.balls ? new Twin(this.physics) : null;
  }

  // Call when the balls are changed by hand: a push, more energy, other
  // gravity, another kind of bounce.
  markChanged() { this.changedByHand = true; }

  // About how far off would a rewind to the start be (in radii)? Infinity
  // if it cannot be done at all.
  estimate() {
    if (!this.enabled) return 0;
    if (this.changedByHand) return Infinity;
    if (!this.twin) return 0;
    return SAFETY * ROUNDING[this.physics.precise] * Math.exp(this.twin.total());
  }

  // Move the physics on by `seconds` (negative = backwards), and the twin too.
  advance(seconds, gravityStrength) {
    const physics = this.physics;
    const direction = Math.sign(seconds);
    if (direction === 0) return;
    this.noticeNewBalls();
    if (!this.enabled) { physics.update(seconds, gravityStrength); return; }
    if (direction !== this.direction) {
      this.direction = direction;
      // Turning forwards again: the twin starts again from here, with the
      // growth noted at the last mark before now.
      if (direction > 0) {
        const here = Math.floor(physics.time / NOTE_EVERY + 1e-9);
        for (const k of [...this.notes.keys()]) if (k > here) this.notes.delete(k);
        const before = [...this.notes.keys()];
        this.twin = new Twin(physics, before.length ? this.notes.get(Math.max(...before)) : 0);
      }
    }
    // Once a rewind is clearly lost (or the scene was changed by hand), it
    // can only stay so: the twin can rest. (Checked before anything moves:
    // in between, the real scene would be a frame ahead of its twin.)
    const resting = this.changedByHand || this.estimate() > 1000 * LOST;
    const markBefore = Math.floor(physics.time / NOTE_EVERY);
    physics.update(seconds, gravityStrength);
    if (direction < 0 || resting || !this.twin) return;
    this.twin.step(seconds, gravityStrength);
    const mark = Math.floor(physics.time / NOTE_EVERY);
    if (mark > markBefore) this.notes.set(mark, this.twin.total());
  }

  // A different set of balls (another preset, more balls, ...): start again.
  noticeNewBalls() {
    const balls = this.physics.balls;
    if (balls === this.balls && balls.length === this.ballCount) return;
    this.balls = balls;
    this.ballCount = balls.length;
    this.notes.clear();
    this.changedByHand = false;
    this.twin = this.enabled ? new Twin(this.physics) : null;
  }
}
