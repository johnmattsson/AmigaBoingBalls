// =============================================================================
// physics-host.js — the physics, run apart from the drawing.
//
// The physics (physics.js, with precise.js for 32 and 64 digits) and the
// rewind test (rewindcheck.js) run in a "worker": a second thread, so that a
// slow physics step (1000 balls packed in a corner, computed with 64 digits)
// never holds up the drawing. See physics-worker.js and physics-client.js.
//
// The page talks to it with messages (see PhysicsHost.handle below):
//   { op: 'init', balls, sizeMix }        – start with this many random balls
//   { op: 'set', key, value }             – room, ballSize, sizeMix, precise,
//                                           trailSeconds, ballBounce/wallBounce
//                                           (by name), balls (only [])
//   { op: 'call', name, args }            – setBallCount, setBallSize,
//                                           setSizeMix, setRoom, setTotalEnergy,
//                                           clearTrails, changed, setBalls,
//                                           push (ball number, ray point, direction)
//   { op: 'rewind', name, args }          – the rewind test: setEnabled,
//                                           markChanged, noticeNewBalls
//   { op: 'tinker', code }                – run code from the console with `physics`
//   { op: 'step', seconds, gravity }      – move on; answered with a snapshot
//
// The snapshot holds what the page needs to draw and show: every ball's
// position, orientation, size and colour, the trails (only while they are
// shown), what was hit (for the boings), and the numbers on the Info page.
// Numbers travel as Float64Arrays, which are handed over without copying.
// =============================================================================

import { Physics, COLLISION_TYPES } from './physics.js';
import { RewindCheck } from './rewindcheck.js';
import { Vec3, Quat } from './math.js';

export const BALL_NUMBERS = 11;   // per ball in a snapshot: x y z, orientation (4), radius, colour, squares, id
export const EVENT_NUMBERS = 5;   // per hit in a snapshot: kind (0 two balls, 1 a wall), where (x, y, z), how hard
// The speed histograms (the Info page, see speedHistogram): how many bars,
// over speeds from 0 to SPEED_RANGE times the typical speed.
export const SPEED_BARS = 30;
export const SPEED_RANGE = 3;

// A time budget for the physics. Very many collisions in one step (1000 balls
// packed in a corner, computed with 64 digits) can take long, and a slow step
// makes the next one cover more time, with even more collisions. So when a
// step takes more than its budget, the next steps simulate less time: the
// balls run in slow motion. (Only the pace changes; the physics stays exact.)
// It picks up speed again by itself when the work gets lighter. With the
// physics in a worker, the drawing stays smooth either way.
// (The page sends a budget that fits its screen: most of a frame, as the
// physics runs side by side with the drawing. This is the most.)
const PHYSICS_BUDGET = 25;     // milliseconds per step

// Messages turn Vec3s into plain { x, y, z } (and Quats, turns, into
// { x, y, z, w }): turn them back.
function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 3 && 'x' in value && 'y' in value && 'z' in value) return new Vec3(value.x, value.y, value.z);
    if (keys.length === 4 && 'x' in value && 'y' in value && 'z' in value && 'w' in value) return new Quat(value.x, value.y, value.z, value.w);
    const out = {};
    for (const key of keys) out[key] = revive(value[key]);
    return out;
  }
  return value;
}

export class PhysicsHost {
  constructor() {
    this.physics = null;
    this.version = 0;        // counts changes, so the page knows when to draw anew
    this.events = [];        // what was hit during the step: kind (0 ball, 1 wall), x, y, z, impact speed (see EVENT_NUMBERS)
    this.hits = 0;           // ball-on-ball hits during the step
    this.pace = Infinity;    // the most simulated seconds per step for now (see PHYSICS_BUDGET)
    this.trailsSent = new WeakMap();   // per ball: how much of its trail the page has (see snapshot)
  }

  start(ballCount, sizeMix) {
    const physics = this.physics = new Physics(ballCount, sizeMix);
    physics.onBallCollision = (a, b, impactSpeed) => {
      this.hits++;
      const share = a.radius / (a.radius + b.radius);   // where they touch
      const p = a.position, q = b.position;
      this.events.push(0, p.x + (q.x - p.x) * share, p.y + (q.y - p.y) * share, p.z + (q.z - p.z) * share, impactSpeed);
    };
    physics.onWallCollision = (ball, wallDirection, impactSpeed) => {
      // (Where it touches the wall.)
      const p = ball.position, n = wallDirection, r = ball.radius;
      this.events.push(1, p.x + n.x * r, p.y + n.y * r, p.z + n.z * r, impactSpeed);
    };
    this.rewind = new RewindCheck(physics);
  }

  // Handle one message. Returns the snapshot for a step, else nothing.
  handle(message) {
    const physics = this.physics;
    switch (message.op) {
      case 'init':
        this.start(message.balls, message.sizeMix);
        break;
      case 'set': {
        let value = revive(message.value);
        // (A kind of bounce comes by name; one made up in the console as itself.)
        if ((message.key === 'ballBounce' || message.key === 'wallBounce') && typeof value === 'string') value = COLLISION_TYPES[value];
        physics[message.key] = value;
        break;
      }
      case 'call': {
        const args = revive(message.args);
        if (message.name === 'push') {
          const ball = physics.balls[args[0]];
          if (ball) physics.push(ball, args[1], args[2]);
        } else {
          physics[message.name](...args);
        }
        break;
      }
      case 'tinker':   // (from the console, see PhysicsClient.tinker)
        try { new Function('physics', message.code)(physics); } catch (error) { console.error(error); }
        break;
      case 'rewind':
        this.rewind[message.name](...(message.args ?? []));
        break;
      case 'step':
        return { ...this.step(message.seconds, message.gravity, message.budget), seq: message.seq };
      case 'speeds':    // (the speed histogram: only while the Info page shows it)
        this.wantSpeeds = message.on;
        return null;
      case 'recycle':   // (a snapshot's ball numbers, back from the page: see snapshot)
        this.spare = message.buffer;
        return null;      // (changes nothing in the scene)
    }
    this.version++;
  }

  step(seconds, gravity, budget = PHYSICS_BUDGET) {
    budget = Math.min(budget, PHYSICS_BUDGET);
    this.events = [];
    this.hits = 0;
    const start = performance.now();
    const step = Math.sign(seconds) * Math.min(Math.abs(seconds), this.pace);
    this.slowed = Math.abs(step) < Math.abs(seconds) * 0.999;   // (slow motion: the page shows SLOW)
    this.paceShare = seconds !== 0 ? Math.abs(step / seconds) : 1;   // (how much of the time asked for it simulated)
    this.rewind.advance(step, gravity);   // (moves the physics, and the rewind test's twin)
    const ms = performance.now() - start;
    if (ms > budget && step !== 0) this.pace = Math.abs(step) * budget / ms;
    else if (this.pace < Infinity) this.pace = this.pace * 1.1 > 0.1 ? Infinity : this.pace * 1.1;
    if (step !== 0) this.version++;
    return this.snapshot(gravity, ms);
  }

  snapshot(gravity, ms) {
    const physics = this.physics, balls = physics.balls, n = balls.length;
    // The ball numbers go to the page without copying (see transferables),
    // and the page hands the buffer back once it has taken them over. Using
    // it again, instead of a new one for every step, saves the page from
    // clearing away some 10 MB a second of thrown-away buffers (with 1000
    // balls at 120 steps a second) — a clean-up that can hold up a frame.
    const size = n * BALL_NUMBERS * 8;
    const data = new Float64Array(this.spare?.byteLength === size ? this.spare : size / 8);
    this.spare = null;
    for (let i = 0; i < n; i++) {
      const b = balls[i], p = b.position, q = b.orientation, at = i * BALL_NUMBERS;
      data[at] = p.x; data[at + 1] = p.y; data[at + 2] = p.z;
      data[at + 3] = q.x; data[at + 4] = q.y; data[at + 5] = q.z; data[at + 6] = q.w;
      data[at + 7] = b.radius; data[at + 8] = b.color; data[at + 9] = b.squares; data[at + 10] = b.id;
    }
    // The trails: only what changed since the last snapshot, as the page
    // keeps its own copy. (All of them every time came to 13 MB a step with
    // 1000 balls and 10-second trails.) A trail is a list of points
    // (x, y, z, time); all but the last ("head", which still moves along with
    // the ball) stay as they are until they are dropped from the start. Per
    // ball: start afresh? (1 or 0), how many points have been dropped from
    // its start so far, the number of new fixed points and those points,
    // then 1 and the head point, or 0 if the trail is empty.
    let trails = null;
    if (physics.trailSeconds > 0) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const b = balls[i], t = b.trail, dropped = b.trailDropped, total = dropped + t.length / 4;
        let sent = this.trailsSent.get(b), fresh = 0;
        if (!sent || sent.cleared !== b.trailCleared) {
          sent = { cleared: b.trailCleared, fixed: dropped };
          this.trailsSent.set(b, sent);
          fresh = 1;
        }
        const from = Math.max(sent.fixed, dropped), to = Math.max(from, total - 1);
        out.push(fresh, dropped, to - from);
        for (let a = from; a < to; a++) {
          const k = (a - dropped) * 4;
          out.push(t[k], t[k + 1], t[k + 2], t[k + 3]);
        }
        sent.fixed = to;
        if (total > dropped) {
          const k = t.length - 4;
          out.push(1, t[k], t[k + 1], t[k + 2], t[k + 3]);
        } else {
          out.push(0);
        }
      }
      trails = Float64Array.from(out);
    } else {
      this.trailsSent = new WeakMap();   // (shown again later: send them whole)
    }
    const info = physics.totals(gravity);   // (motion, spin and total energy, momentum, angular momentum)
    const rewind = this.rewind;
    return {
      op: 'snapshot',
      version: this.version,
      time: physics.time,
      count: n,
      data, trails,
      events: Float64Array.from(this.events),
      hits: this.hits,
      slowed: Boolean(this.slowed),
      paceShare: this.paceShare ?? 1,
      ms,
      info,
      rewind: { enabled: rewind.enabled, changedByHand: rewind.changedByHand, estimate: rewind.estimate() },
      speeds: this.wantSpeeds ? speedHistogram(balls, 'velocity', 'mass') : null,
      spins: this.wantSpeeds ? speedHistogram(balls, 'spin', 'inertia') : null,
    };
  }
}

// How the balls' speeds are spread (or, the same way, how fast they spin:
// `of` is 'velocity' or 'spin', and `weight` the matching 'mass' or
// 'inertia'): SPEED_BARS bars, each the share of the
// balls in its stretch of speeds, divided by the stretch's width (so the
// bars' area adds up to 1, as the curve they are compared with does).
// Speeds are measured against the typical speed (the root mean square), so
// the picture keeps its scale however lively the scene. Balls of different
// sizes share their energy evenly, not their speeds (a heavy ball moves
// slower): so each ball's speed is first scaled to that of an average-mass
// ball with the same energy, v × √(m / average m). Then, after enough
// collisions, the bars follow the Maxwell–Boltzmann distribution, whatever
// the start. The spin likewise, each ball's spin scaled by its inertia
// (how hard it is to set spinning): a ball spins about three directions as
// it flies along three, and collisions that can pass energy between flying
// and spinning (Rough and Garwin bounces: those that grip) share it out
// evenly between all six, so the spins settle into the very same curve.
// (Smooth and Twist bounces pass none: with Smooth a spin never changes,
// with Twist only twisting passes from ball to ball.)
function speedHistogram(balls, of, weight) {
  const bars = new Float64Array(SPEED_BARS), n = balls.length;
  if (n === 0) return bars;
  let massSum = 0;
  for (const b of balls) massSum += b[weight];
  const averageMass = massSum / n;
  let squares = 0;
  for (const b of balls) squares += b[of].lengthSq() * b[weight] / averageMass;
  const typical = Math.sqrt(squares / n);
  if (!(typical > 0)) return bars;
  const width = SPEED_RANGE / SPEED_BARS;
  for (const b of balls) {
    const u = Math.sqrt(b[of].lengthSq() * b[weight] / averageMass) / typical;
    const bar = Math.floor(u / width);
    if (bar < SPEED_BARS) bars[bar]++;
  }
  for (let k = 0; k < SPEED_BARS; k++) bars[k] /= n * width;
  return bars;
}

// The parts of a snapshot that can be handed over without copying.
export function transferables(snapshot) {
  return [snapshot.data.buffer, snapshot.events.buffer, ...(snapshot.trails ? [snapshot.trails.buffer] : [])];
}
