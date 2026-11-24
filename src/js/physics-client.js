// =============================================================================
// physics-client.js — the page's side of the physics.
//
// The physics runs in a worker, a thread of its own (physics-worker.js), so
// that a slow physics step never holds up the drawing. This is what the rest
// of the page sees instead: an object with the same methods and settings as
// Physics (physics.js) that passes every change on to the worker, and a copy
// of the balls as they were after the last step, for drawing, for clicking
// on, and for the numbers on the Info page.
//
// Every frame the page asks for the next step (step()) and shows the balls
// as they are a fixed way behind (showNext()). It keeps one finished step
// in hand: so the balls are drawn about two frames behind the physics,
// always the same, which the eye doesn't see, and an answer that comes a
// little late (the worker's thread was woken a moment later, as browsers do
// after the tab was in the background) is simply the one in hand next time.
//
// What is shown is not simply the next step, but the balls at the moment
// that is due: each frame moves the shown moment on by the frame's own
// time. Normally that is exactly the next step. But after a frame that came
// late (a dropped frame), the steps asked for before it are a frame's time
// each, while the shown moment must move on by two: then it moves on two
// steps, and the frames after it show the moments between the late frame's
// own longer step (the balls between two steps are worked out from both:
// see between). So the balls move as far from each picture to the next as
// the time between the pictures, always. (Showing simply the next step, a
// dropped frame meant first a picture with too little motion and then, two
// frames later, one with too much.) When the worker can't keep up at all,
// the time is saved up and added to a later step.
//
// Where a worker can't be started (an old browser, or the page opened as a
// file), the same PhysicsHost runs on the page itself, as it always did.
// =============================================================================

import { PhysicsHost, BALL_NUMBERS } from './physics-host.js';
import { COLLISION_TYPES, boxRoom } from './physics.js';
import { Vec3, Quat } from './math.js';

const WORKER_START_SECONDS = 4;   // how long to wait for the worker to start
const MAX_IN_FLIGHT = 3;   // steps asked for at a time, at most
const MAX_OWED = 0.5;      // simulated seconds saved up, at most (speed 5 × a 0.1 s frame)

// Trail generations are never reused, not even by the balls of a new
// scene: the WebGPU renderer keeps old trail pieces until they are
// overwritten and tells them apart only by ball number and generation, so
// a new ball starting again at 0 would bring back the old scene's trails.
let trailGenerations = 0;
const newTrailGeneration = () => ++trailGenerations;

// The page's copy of a ball: what drawing and clicking need.
class BallCopy {
  constructor(index) {
    this.index = index;
    this.position = new Vec3();
    this.orientation = new Quat(0, 0, 0, 1);
    this.radius = 1;
    this.color = 0;
    this.squares = 6;
    this.id = 0;              // the ball's own number (see Ball.id in physics.js)
    this.trail = [];          // x, y, z, time, ...: its fixed points, then its head
    this.trailBase = 0;       // how many points have been dropped from the trail's start
    this.trailHead = false;   // does the trail end in a head (the point that still moves)?
    this.trailGeneration = newTrailGeneration(); // a new number each time the trail starts afresh (for the WebGPU renderer's copy of it)
  }

  // Bring the trail up to date from a snapshot (see PhysicsHost.snapshot);
  // `at` is where this ball's part starts. Returns where the next one starts.
  updateTrail(d, at) {
    const t = this.trail;
    const fresh = d[at++], dropped = d[at++], count = d[at++];
    if (fresh) { t.length = 0; this.trailBase = dropped; this.trailHead = false; this.trailGeneration = newTrailGeneration(); }
    if (this.trailHead) t.length -= 4;   // (the old head goes; the new one comes last)
    if (dropped > this.trailBase) {
      t.splice(0, Math.min(t.length, (dropped - this.trailBase) * 4));
      this.trailBase = dropped;
    }
    for (let k = 0; k < count * 4; k++) t.push(d[at++]);
    this.trailHead = d[at++] === 1;
    if (this.trailHead) t.push(d[at++], d[at++], d[at++], d[at++]);
    return at;
  }
}

export class PhysicsClient {
  // onSnapshot(snapshot): called after every step's result has arrived.
  // onError(message): the worker stopped with an error; the physics then
  // starts afresh on the page itself (the scene must be set up again).
  constructor(ballCount, sizeMix, { onSnapshot, onError, version = '' } = {}) {
    this.onSnapshot = onSnapshot;
    this.onError = onError;
    this.startWith = { ballCount, sizeMix };
    this.balls = [];
    // The shown step's ball numbers as they came (BALL_NUMBERS per ball, see
    // snapshot in physics-host.js), in the graphics card's 32-bit numbers:
    // the WebGPU renderer sends them over as they are and builds its ball
    // table from them on the graphics card (see makeBallTable).
    this.numbers = new Float32Array(0);
    this.time = 0;
    this.info = { motion: 0, total: 0, spin: 0, momentum: 0, angular: 0 };
    // The settings, as last set (the worker has its own copy).
    this.values = { sizeMix, ballSize: 1, room: boxRoom(), precise: 0, trailSeconds: 0,
      ballBounce: COLLISION_TYPES.rough, wallBounce: COLLISION_TYPES.smooth };
    this.inFlight = 0;        // steps asked for, not answered yet
    this.owed = 0;            // simulated seconds asked for while too many were in flight
    this.ready = [];          // finished steps, not shown yet
    // The steps in one line: how far each takes the balls, in seconds
    // (forwards or backwards alike), from the very first. (See showNext.)
    this.sent = 0;            // ... after the last step asked for
    this.progressOf = new Map();   // seq → how far, for steps on their way
    this.shownAt = null;      // ... the moment shown now (null: none yet)
    this.base = null;         // the last step taken over: its ball numbers (Float64), how far, version
    this.started = false;     // has a step been shown yet? (Waiting for the first is no stutter.)
    this.seq = 0;             // numbers the steps
    this.changeSeq = 0;       // the first step whose answer includes the last change sent
    this.sceneSeq = 0;        // the first step of the scene now set up (see newScene)
    this.shownSeq = 0;        // the step shown last
    this.version = -1;
    this.rewind = new RewindClient(this);
    this.inWorker = false;

    // Start the worker. Until it says it is ready, messages wait here; if it
    // fails to start, they go to a PhysicsHost on the page instead.
    this.waiting = [];
    try {
      const worker = new Worker(new URL(`./physics-worker.js${version}`, import.meta.url), { type: 'module' });
      worker.onmessage = (event) => this.receive(event.data);
      worker.onerror = (event) => {
        event.preventDefault?.();
        if (!this.inWorker) { this.runHere(); return; }
        // It stopped while running: carry on without it, on the page.
        console.error('The physics worker stopped:', event.message, `(${event.filename}:${event.lineno}:${event.colno})`);
        this.inWorker = false;
        this.ready = [];
        this.inFlight = 0;
        this.shownAt = null;
        this.base = null;
        this.waiting = [];
        this.speedsWanted = undefined;   // (asked for again: the new host doesn't know)
        this.runHere();
        this.send({ op: 'init', balls: this.startWith.ballCount, sizeMix: this.values.sizeMix });
        this.onError?.(event.message);
      };
      this.worker = worker;
      // A worker that neither starts nor fails (it happens: a browser can
      // leave it hanging after a quick reload) would leave the balls
      // waiting for ever; after a few seconds, carry on without it.
      setTimeout(() => {
        if (!this.inWorker && !this.host) {
          console.warn('The physics worker did not start; the physics runs on the page instead.');
          this.runHere();
        }
      }, WORKER_START_SECONDS * 1000);
    } catch {
      this.runHere();
    }
    this.send({ op: 'init', balls: ballCount, sizeMix });
  }

  // Run the physics on the page itself (no worker).
  runHere() {
    if (this.host) return;
    this.worker?.terminate();
    this.worker = null;
    this.host = new PhysicsHost();
    const waiting = this.waiting;
    this.waiting = null;
    for (const message of waiting) this.deliver(message);
  }

  send(message) {
    if (message.op === 'set' || message.op === 'call') this.changeSeq = this.seq + 1;
    if (this.waiting) this.waiting.push(message);
    else this.deliver(message);
  }

  deliver(message) {
    if (this.worker) { this.worker.postMessage(message); return; }
    const snapshot = this.host.handle(message);
    if (snapshot) this.receive(snapshot);
  }

  receive(message) {
    if (message.op === 'ready') {
      this.inWorker = true;
      const waiting = this.waiting;
      this.waiting = null;
      for (const m of waiting) this.deliver(m);
      return;
    }
    // A finished step: kept until it is shown (see showNext).
    this.inFlight--;
    message.progress = this.progressOf.get(message.seq) ?? this.sent;
    this.progressOf.delete(message.seq);
    this.ready.push(message);
  }

  // Show the balls as they are `advance` seconds (of the balls' own time,
  // forwards or backwards alike) after the moment shown last: take over
  // every finished step up to that moment, and if it falls between that one
  // and the next, the balls between the two. Called once a frame, with the
  // frame's own time (as asked for in step). Returns false if nothing new
  // could be shown (the picture stays as it was: a repeat).
  showNext(advance = 0) {
    const ready = this.ready;
    if (this.shownAt === null) {
      // (From the worker: wait for one more to keep in hand. On the page
      // itself, answers come at once.)
      if (ready.length < (this.inWorker ? 2 : 1)) return false;
      this.shownAt = ready[0].progress;
    } else {
      // Never past the last finished step: should the worker fall behind,
      // the picture waits for it rather than racing ahead and leaving no
      // step in hand afterwards. (Nor past the last step asked for: time
      // that was never asked for, as when the time saved up was capped,
      // can't be shown.)
      const newest = ready.length > 0 ? ready[ready.length - 1].progress : this.base?.progress ?? this.shownAt;
      this.shownAt = Math.min(this.shownAt + advance, this.sent, newest);
    }
    // Should finished steps pile up (the drawing fell behind), catch up
    // rather than stay further behind: the balls leap ahead.
    if (ready.length > 4) this.shownAt = Math.max(this.shownAt, ready[ready.length - 2].progress);
    let shown = false;
    // (A hair of leeway: the moments are sums of many frame times, and a
    // rounding error must not leave a step just short of being taken over.)
    const due = this.shownAt + 1e-9;
    while (ready.length > 0 && ready[0].progress <= due) {
      const s = ready.shift();
      const last = ready.length === 0 || ready[0].progress > due;
      this.apply(s, last);
      shown = true;
    }
    // Between the last one taken over and the next.
    const next = ready[0], base = this.base;
    if (next && base && next.version === base.version && next.count === this.balls.length && next.progress > base.progress) {
      const f = (this.shownAt - base.progress) / (next.progress - base.progress);
      if (f > 0) { this.between(base.data, next.data, Math.min(1, f)); shown = true; }
    }
    if (shown) this.started = true;
    return shown;
  }

  // The balls part of the way (f, 0 … 1) from one step's ball numbers (a)
  // to the next one's (b): moved along the straight line between, and
  // turned part of the way. (Only for a fraction of a frame's time, so the
  // short straight line can't be told from the true path.)
  between(a, b, f) {
    const numbers = this.numbers;
    for (let i = 0; i < this.balls.length; i++) {
      const at = i * BALL_NUMBERS, ball = this.balls[i];
      const x = a[at] + (b[at] - a[at]) * f;
      const y = a[at + 1] + (b[at + 1] - a[at + 1]) * f;
      const z = a[at + 2] + (b[at + 2] - a[at + 2]) * f;
      // (The turn: the same turn can be written two ways, q and −q; take
      // the one nearer, then blend and make it a pure turn again.)
      const sign = a[at + 3] * b[at + 3] + a[at + 4] * b[at + 4] + a[at + 5] * b[at + 5] + a[at + 6] * b[at + 6] < 0 ? -1 : 1;
      let qx = a[at + 3] + (sign * b[at + 3] - a[at + 3]) * f;
      let qy = a[at + 4] + (sign * b[at + 4] - a[at + 4]) * f;
      let qz = a[at + 5] + (sign * b[at + 5] - a[at + 5]) * f;
      let qw = a[at + 6] + (sign * b[at + 6] - a[at + 6]) * f;
      const length = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
      qx /= length; qy /= length; qz /= length; qw /= length;
      ball.position.x = x; ball.position.y = y; ball.position.z = z;
      ball.orientation.x = qx; ball.orientation.y = qy; ball.orientation.z = qz; ball.orientation.w = qw;
      numbers[at] = x; numbers[at + 1] = y; numbers[at + 2] = z;
      numbers[at + 3] = qx; numbers[at + 4] = qy; numbers[at + 5] = qz; numbers[at + 6] = qw;
    }
  }

  apply(s, shown) {
    if (this.balls.length !== s.count) {
      // Fewer or more: each copy stays with its ball (by id), with its trail;
      // the places of those after a ball taken away move up (see removeBalls).
      const byId = new Map(this.balls.map((ball) => [ball.id, ball]));
      this.balls = Array.from({ length: s.count }, (_, i) => {
        const ball = byId.get(s.data[i * BALL_NUMBERS + 10]) ?? new BallCopy(i);
        ball.index = i;
        return ball;
      });
    }
    if (shown) {
      if (this.numbers.length !== s.data.length) this.numbers = new Float32Array(s.data.length);
      this.numbers.set(s.data);   // (one quick copy, without going ball by ball)
    }
    let trailAt = 0;
    for (let i = 0; i < s.count; i++) {
      const b = this.balls[i], d = s.data, at = i * BALL_NUMBERS;
      b.position.x = d[at]; b.position.y = d[at + 1]; b.position.z = d[at + 2];
      b.orientation.x = d[at + 3]; b.orientation.y = d[at + 4]; b.orientation.z = d[at + 5]; b.orientation.w = d[at + 6];
      b.radius = d[at + 7]; b.color = d[at + 8]; b.squares = d[at + 9]; b.id = d[at + 10];
      if (s.trails) trailAt = b.updateTrail(s.trails, trailAt);
      else if (b.trail.length) { b.trail.length = 0; b.trailHead = false; b.trailGeneration = newTrailGeneration(); }
    }
    // The shown step's ball numbers are kept as they are (not copied), for
    // showing the balls between this step and the next (see showNext); the
    // ones kept before are done with. Done with, the buffer of ball numbers
    // goes back to the physics, to be used again (see snapshot in
    // physics-host.js).
    let done = s.data;
    if (shown) {
      done = this.base?.data ?? null;
      this.base = { data: s.data, progress: s.progress, version: s.version };
    }
    if (done) this.recycle(done);
    this.time = s.time;
    this.info = s.info;
    this.slowed = s.slowed;
    this.paceShare = s.paceShare;   // (1 = at full pace; see physics-host.js)
    if (s.slowed) this.slowedAt = performance.now();
    this.shownSeq = s.seq;
    this.rewind.take(s.rewind, s.seq);
    if (s.speeds) { this.speeds = s.speeds; this.spins = s.spins; }
    const changed = s.version !== this.version;
    this.version = s.version;
    this.onSnapshot?.(s, changed || !shown);
  }

  recycle(data) {
    if (data.buffer.byteLength === 0) return;   // (already handed over)
    if (this.worker) this.worker.postMessage({ op: 'recycle', buffer: data.buffer }, [data.buffer]);
    else if (this.host) this.host.spare = data.buffer;
  }

  // Does the step shown include every change sent? (Until then, its number
  // of balls and its energy are from before a change, and a slider being
  // set from them would jump back for a moment.)
  get upToDate() { return this.shownSeq >= this.changeSeq; }

  // The speed histogram (see speedHistogram in physics-host.js): worked out
  // with every step while asked for, else not at all. Its last bars are in
  // `speeds`.
  wantSpeeds(on) {
    if (on === this.speedsWanted) return;
    this.speedsWanted = on;
    if (!on) { this.speeds = null; this.spins = null; }
    this.send({ op: 'speeds', on });
  }

  // A new scene is being set up (a preset): steps still on their way from
  // the old one must not be heard (their bounces), only seen until then.
  newScene() { this.sceneSeq = this.seq + 1; }
  // Is the step shown last from the scene now set up?
  get sceneCurrent() { return this.shownSeq >= this.sceneSeq; }

  // Move on by `seconds` (negative = backwards). The result arrives later
  // (see onSnapshot); meanwhile, time asked for is saved up.
  step(seconds, gravityStrength, budget) {
    // (Time saved up while the worker was busy is capped, like a frame's own
    // time, so that a long pause doesn't make the balls leap ahead.)
    this.owed = Math.max(-MAX_OWED, Math.min(MAX_OWED, this.owed + seconds));
    if (this.inFlight >= MAX_IN_FLIGHT) return;
    this.inFlight++;
    const owed = this.owed;
    this.owed = 0;
    this.sent += Math.abs(owed);
    this.progressOf.set(this.seq + 1, this.sent);
    this.send({ op: 'step', seconds: owed, gravity: gravityStrength, budget, seq: ++this.seq });
  }

  // ---- The same settings and methods as Physics, passed on ------------------
  set(key, value) {
    this.values[key] = value;
    this.send({ op: 'set', key, value });
  }
  get room() { return this.values.room; }
  set room(room) { this.set('room', room); }
  get ballSize() { return this.values.ballSize; }
  set ballSize(size) { this.set('ballSize', size); }
  get sizeMix() { return this.values.sizeMix; }
  set sizeMix(mix) { this.set('sizeMix', mix); }
  get precise() { return this.values.precise; }
  set precise(parts) { this.set('precise', parts); }
  get trailSeconds() { return this.values.trailSeconds; }
  set trailSeconds(seconds) { this.set('trailSeconds', seconds); }
  get ballBounce() { return this.values.ballBounce; }
  set ballBounce(type) { this.values.ballBounce = type; this.send({ op: 'set', key: 'ballBounce', value: nameOf(type) ?? { ...type } }); }
  get wallBounce() { return this.values.wallBounce; }
  set wallBounce(type) { this.values.wallBounce = type; this.send({ op: 'set', key: 'wallBounce', value: nameOf(type) ?? { ...type } }); }

  // For trying things in the browser's console: run `code` where the real
  // physics is (in the worker), with `physics` being that Physics. E.g.
  //   boing.tinker('physics.balls[0].velocity.y = 20; physics.changed()')
  tinker(code) { this.send({ op: 'tinker', code }); }
  // No balls at all (before new ones are placed).
  clearBalls() { this.send({ op: 'set', key: 'balls', value: [] }); }
  removeBalls(ids) { this.call('removeBalls', ids); }   // (see Physics.removeBalls)

  call(name, ...args) { this.send({ op: 'call', name, args }); }
  setBallCount(count) { this.call('setBallCount', count); }
  setBallSize(size) { this.values.ballSize = size; this.call('setBallSize', size); }
  setSizeMix(mix) { this.values.sizeMix = mix; this.call('setSizeMix', mix); }
  setRoom(room) { this.values.room = room; this.call('setRoom', room); }
  setTotalEnergy(energy, gravityStrength) { this.call('setTotalEnergy', energy, gravityStrength); }
  setBalls(list) { this.call('setBalls', list); }
  clearTrails() { this.call('clearTrails'); }
  changed() { this.call('changed'); }
  push(ball, rayPoint, rayDir) { this.call('push', ball.index, rayPoint, rayDir); }

  // The numbers, as after the last step.
  // Has the physics been in slow motion of its own lately (too much work
  // for a step: see PHYSICS_BUDGET in physics-host.js)? As the last step
  // said, held a second after it stops, so a sign of it on screen doesn't
  // flicker. (Very slow steps come seldom: until the next, the last holds.)
  get slowedDown() { return Boolean(this.slowed) || performance.now() - (this.slowedAt ?? -Infinity) < 1000; }

  motionEnergy() { return this.info.motion; }
  totalEnergy() { return this.info.total; }
  spinEnergy() { return this.info.spin; }
  totalMomentum() { const v = this.info.momentum; return { length: () => v }; }
  totalAngularMomentum() { const v = this.info.angular; return { length: () => v }; }
}

function nameOf(type) {
  return Object.keys(COLLISION_TYPES).find((name) => COLLISION_TYPES[name] === type);
}

// The rewind test (rewindcheck.js), which runs next to the physics: the
// same methods, passed on, and its answers as after the last step.
class RewindClient {
  constructor(client) {
    this.client = client;
    this.enabled = false;
    this.changedByHand = false;
    this.lastEstimate = 0;
    this.firstSeq = 0;      // the first step whose answer includes the last change made here
  }
  take(state, seq) {
    if (seq < this.firstSeq) return;   // (that answer is older than the change made here)
    this.changedByHand = state.changedByHand;
    this.lastEstimate = state.estimate;
  }
  send(name, ...args) { this.firstSeq = this.client.seq + 1; this.client.send({ op: 'rewind', name, args }); }
  setEnabled(on) { this.enabled = on; if (on) this.changedByHand = false; this.lastEstimate = 0; this.send('setEnabled', on); }
  markChanged() { this.changedByHand = true; this.send('markChanged'); }
  noticeNewBalls() { this.send('noticeNewBalls'); }
  estimate() {
    if (!this.enabled) return 0;
    if (this.changedByHand) return Infinity;
    return this.lastEstimate;
  }
}
