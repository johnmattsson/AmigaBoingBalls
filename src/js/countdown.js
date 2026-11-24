// -----------------------------------------------------------------------------
// The N key, in memory of a certain game about small green-haired
// creatures from 1991: a 5, 4, 3, 2, 1 counts down above every ball, and
// then they burst, one after another, each when its own count runs out (the
// counts start a moment apart, as there), after an "Oh no!" (see nuke).
// R (or any preset) brings them back.
//
// At 0 a ball stops dead: it is taken out of the physics at once (as if it
// had never been there: nothing can hit it any more), and for a moment
// (LAST_MOMENT) it swells and shudders where it stopped, as a hollow ball
// would before it bursts; it keeps turning as it was (see spinOf). Then it
// bursts into pieces of its shell, which fly out through the room (and
// sideways, the way its spin was carrying them), fall, bounce off the walls
// and land on the floor, painted into a picture of it that stays until the
// scene starts again.
//
// The numbers are drawn on a plain 2D canvas over the scene. The pieces are
// drawn on another, as large as the scene's picture, which the renderer
// takes into its picture (see options.pieces in renderer.js): under the
// scroller, which is drawn last. So it works the same with either renderer.
// The stopped balls are drawn by the renderer, as the other balls (see
// drawn). Each ball is known by its id (see Ball.id in physics.js), as the
// places in the list change. All of it is brought up to date by the page's
// own frame (see update), just before the scene is drawn.
// -----------------------------------------------------------------------------
import { Vec3, Quat } from './math.js';
import { ShellPieces } from './shell-pieces.js';
import { GRAVITY_SCALE } from './physics.js';

const COUNT_FROM = 5;          // seconds
const STAGGER = 0.12;          // seconds between one ball's count starting and the next's ...
const STAGGER_ALL = 2.5;       // ... but all started within this
const LAST_MOMENT = 0.33;      // seconds a ball swells and shudders at 0, before it bursts

export class Countdown {
  // camera: for where the balls are on the screen; physics: the balls (see
  // physics-client.js), and where stopped ones are taken away; sounds: for
  // the "Oh no!" and the bursts (see audio.js); renderer(): the one drawing
  // now (the pieces are drawn as large as its picture, and with Pixel size
  // as coarsely);
  // onChange(): a ball has been taken away by hand (the picture must be
  // drawn again, and no rewind can undo it); gravity(): the Gravity setting
  // (the pieces fall as the balls do, see shell-pieces.js).
  constructor({ camera, physics, sounds, renderer, onChange, gravity = () => 1 }) {
    this.camera = camera;
    this.gravity = gravity;
    this.renderer = renderer;
    this.physics = physics;
    this.sounds = sounds;
    this.onChange = onChange;
    // Its clock: the seconds the demo has run (see tick), so the count
    // stands still while the balls do: paused, the window or tab hidden, or
    // the Guru shown.
    this.seconds = 0;
    this.anyPopped = false;    // any taken away in this scene (see tookSnapshot in main.js)
    this.started = null;       // when the count began (see seconds), or null
    this.delays = new Map();   // ball id → when its count starts, in seconds after that
    this.popped = new Set();   // the ids of those stopped or burst
    this.stopped = [];         // those swelling at 0: { ball (a copy, drawn), radius, at, since, turn, spin }
    this.turns = new Map();    // ball id → how it was turned, when, and its spin (see spinOf)
    this.stopping = [];        // ids of those stopped this frame, to take out of the physics
    this.pieces = new ShellPieces();   // (see shell-pieces.js)
    // The numbers' canvas, over the scene.
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'countdown';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.getElementById('scene').after(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.numbersShown = false;
    this.piecesVersion = 0;    // one more each time the pieces' picture changes (see piecesImage)
    this.newPiecesCanvas(false);
  }

  // The pieces' canvas (not on the page: the renderer takes it in): on a
  // wide-colour screen, as the scene's picture, Display P3 (so the pieces
  // are the very colours of the ball), if the browser can. (A canvas keeps
  // its colours: a new one when they change.)
  newPiecesCanvas(wide) {
    this.piecesCanvas = document.createElement('canvas');
    this.piecesContext = this.piecesCanvas.getContext('2d', { colorSpace: wide ? 'display-p3' : 'srgb' });
    this.wide = wide;
    this.wideCanvas = wide && this.piecesContext.getContextAttributes?.().colorSpace === 'display-p3';
  }

  // For the renderer: those lying on the floor, as its picture (see bake in
  // shell-pieces.js), or null with none.
  get floorImage() {
    return this.pieces.floor?.any ? this.pieces.floor : null;
  }

  // For the renderer: the pieces' picture (its canvas, whose colours, and
  // how often it has changed), or null with none.
  get piecesImage() {
    if (this.pieces.count === 0) return null;
    const image = this.image ??= {};
    image.canvas = this.piecesCanvas; image.wide = this.wideCanvas; image.version = this.piecesVersion;
    return image;
  }

  get running() { return this.started !== null || this.stopped.length > 0; }
  balls() { return this.physics.balls; }
  clock() { return this.seconds; }
  // The demo has run on by `seconds` (only while the balls move; in slow
  // motion, slower; with time running backwards, on all the same).
  tick(seconds) { this.seconds += seconds; }

  // Start it (N, or the close gadget): with an "Oh no!" (the author's own
  // recording), even with Sound off (see Sounds.say). Returns whether it
  // started (not if already counting, or no balls).
  nuke() {
    if (!this.start()) return false;
    this.sounds.say('ohno');
    return true;
  }

  // Returns whether it started (not if already counting, or no balls).
  start() {
    const count = this.balls().length;
    if (this.running || count === 0) return false;
    // The counts start one after another, in an order by chance.
    const step = Math.min(STAGGER, STAGGER_ALL / count);
    const order = this.balls().map((ball) => ball.id);
    for (let k = count - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    this.delays = new Map(order.map((id, k) => [id, k * step]));
    this.popped.clear();
    this.turns.clear();
    this.started = this.clock();
    return true;
  }

  // A new scene: no count any more, the balls all back, and no pieces
  // left lying about.
  newScene() {
    this.anyPopped = false;
    this.started = null;
    this.stopped = [];
    this.pieces.clear();
    this.turns.clear();
    this.popped.clear();
  }

  // How fast, and about which axis, a ball turns (its spin: radians a
  // second, as a vector along the axis), found from how it has turned since
  // the last frame: the turn between, divided by the time. (The page gets
  // no spin from the physics: only how each ball is turned.) Smoothed a
  // little, as frames come unevenly.
  spinOf(ball, time) {
    const q = ball.orientation, before = this.turns.get(ball.id);
    let spin = before?.spin ?? new Vec3();
    const dt = before ? time - before.time : 0;
    if (before && dt < 1 / 500) return spin;   // (no time has passed: paused, or the same frame)
    if (before) {
      // The turn from then to now, q · (then)⁻¹: as an axis and an angle.
      let turn = q.multiply(new Quat(-before.q.x, -before.q.y, -before.q.z, before.q.w));
      if (turn.w < 0) turn = new Quat(-turn.x, -turn.y, -turn.z, -turn.w);
      const angle = 2 * Math.acos(Math.min(1, turn.w)), sin = Math.sin(angle / 2);
      const now = sin > 1e-6 ? new Vec3(turn.x, turn.y, turn.z).scale(angle / sin / dt) : new Vec3();
      spin = before.spin ? before.spin.scale(0.5).add(now.scale(0.5)) : now;
    }
    this.turns.set(ball.id, { q: new Quat(q.x, q.y, q.z, q.w), time, spin });
    return spin;
  }

  // A ball's count has run out: it stops dead, taken out of the physics at
  // once (as if it had never been there); a copy of it stays, drawn where
  // it stopped, for its last moment (see drawn), still turning as it was
  // (spin, see spinOf).
  stop(ball, spin) {
    this.anyPopped = true;
    this.popped.add(ball.id);
    this.stopping.push(ball.id);   // (taken away together, once a frame: see draw)
    const copy = {
      id: ball.id, position: new Vec3(ball.position.x, ball.position.y, ball.position.z), orientation: new Quat(ball.orientation.x, ball.orientation.y, ball.orientation.z, ball.orientation.w),
      radius: ball.radius, color: ball.color, squares: ball.squares,
      trail: [], trailBase: 0, trailHead: false, trailGeneration: -ball.id,   // (no trail: it has stopped)
    };
    this.stopped.push({ ball: copy, radius: ball.radius, at: new Vec3(ball.position.x, ball.position.y, ball.position.z), since: this.clock(),
      turn: copy.orientation, spin });
  }

  // The balls to click: not those popped. (The physics, in a thread of its
  // own, may still send a ball for a frame or two after it has been taken
  // away.) Returns the very list given if none is left out.
  shown(balls) {
    if (this.popped.size === 0) return balls;
    const shown = balls.filter((ball) => !this.popped.has(ball.id));
    if (shown.length < balls.length) return shown;
    if (!this.running) this.popped.clear();   // (all taken away: nothing more to leave out)
    return balls;
  }

  // The balls to draw: those shown, and those in their last moment.
  drawn(balls) {
    const shown = this.shown(balls);
    if (this.stopped.length === 0) return shown;
    return [...shown, ...this.stopped.map((s) => s.ball)];
  }

  // Where a point of the world is on the screen, in CSS pixels, and how far
  // in front of the camera (w; null: behind it).
  onScreen(p, width, height) {
    const m = this.camera.viewProjection;
    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (w <= 0.01) return null;
    const x = (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w;
    const y = (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w;
    return { x: (x + 1) / 2 * width, y: (1 - y) / 2 * height, w };
  }

  // Up to date for this frame, just before the scene is drawn (see frame in
  // main.js): the count, the last moments, and the pieces. Returns whether
  // the pieces' picture has changed (the scene must be drawn again).
  // (Each only drawn again when something has changed: paused, or every
  // piece at rest in mid-air (no gravity) with no ball to hide them, and the
  // camera still, thousands of pieces would be drawn again for nothing.)
  update() {
    // (Nothing to do, most of the time: no count, nothing shown.)
    if (!this.running && !this.numbersShown && this.pieces.count === 0 && !this.piecesShown) return false;
    const drawing = this.renderer();
    if (!drawing?.canvas) return false;
    const scene = document.getElementById('scene');
    const width = scene.clientWidth, height = scene.clientHeight;
    const time = this.clock();
    const view = this.camera.viewProjection;
    this.stepPieces(time, this.ballsDrawn());
    // (The pieces painted into the floor's picture since: the scene must be
    // drawn again, with the floor.)
    const floor = this.pieces.floor;
    const floorChanged = floor !== this.floorWas || floor?.version !== this.floorVersionWas;
    this.floorWas = floor;
    this.floorVersionWas = floor?.version;

    // The numbers, and the last moments.
    if (this.running) {
      const scale = devicePixelRatio;
      const seen = [time, width, height, scale, ...view];
      if (!sameAs(this.numbersSeen, seen)) {
        this.numbersSeen = seen;
        if (this.canvas.width !== Math.round(width * scale) || this.canvas.height !== Math.round(height * scale)) {
          this.canvas.width = Math.round(width * scale);
          this.canvas.height = Math.round(height * scale);
        }
        const c = this.context;
        c.setTransform(scale, 0, 0, scale, 0, 0);
        c.clearRect(0, 0, width, height);
        if (this.started !== null) this.drawNumbers(c, time, width, height);
        this.lastMoment(time);
        this.numbersShown = true;
      }
    } else if (this.numbersShown) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.numbersShown = false;
      this.numbersSeen = null;
    }

    // The pieces (after the last moments: those burst this frame too).
    if (this.pieces.count === 0) {
      if (this.piecesShown) { this.piecesShown = false; this.piecesSeen = null; return true; }
      return floorChanged;
    }
    if (Boolean(drawing.canvasIsWide) !== this.wide) { this.newPiecesCanvas(Boolean(drawing.canvasIsWide)); this.piecesSeen = null; }
    const balls = this.ballsDrawn();   // (as drawn now: not one that has just burst)
    const moving = this.running || this.pieces.moving > 0 || balls.length > 0;
    const w = drawing.canvas.width, h = drawing.canvas.height;
    const seen = [moving ? time : -1, width, height, w, h, Boolean(drawing.pixelated), this.pieces.count, ...view];
    if (sameAs(this.piecesSeen, seen)) return floorChanged;
    this.piecesSeen = seen;
    const canvas = this.piecesCanvas;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    this.pieces.draw(this.piecesContext, this.camera, width, height, Boolean(drawing.pixelated), this.wideCanvas, balls);
    this.piecesShown = true;
    this.piecesVersion++;
    return true;
  }

  // The balls the scene draws, when there are pieces to hide behind them or
  // bounce off (else none): those not popped, and those swelling.
  ballsDrawn() {
    return this.pieces.count > 0 ? this.drawn(this.balls()) : [];
  }

  // The pieces: on by the time since the last frame (on the countdown's
  // clock: they stand still when the balls do). They fall as the balls do
  // (see update in physics.js), and bounce off the balls drawn.
  stepPieces(time, balls) {
    if (this.pieces.count > 0) {
      this.pieces.step(Math.min(0.05, Math.max(0, time - (this.last ?? time))), this.physics.room?.walls ?? [], GRAVITY_SCALE * this.gravity(), balls);
    }
    this.last = time;
  }

  // The count above each ball counting, and those at 0 stopped (see stop);
  // the count over when none is left counting.
  drawNumbers(c, time, width, height) {
    const seconds = time - this.started;
    // The camera's up, for the spot just above each ball.
    const v = this.camera.view;
    const up = new Vec3(v[1], v[5], v[9]);
    c.font = '16px Amiga, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.strokeStyle = '#000000';
    c.fillStyle = '#ffffff';
    const balls = this.balls();
    for (const ball of balls) {
      if (this.popped.has(ball.id)) continue;
      const delay = this.delays.get(ball.id);
      if (delay === undefined) continue;   // (a ball added since: not counting)
      const left = COUNT_FROM - (seconds - delay);
      if (left > COUNT_FROM) continue;     // (its count not started yet)
      const spin = this.spinOf(ball, time);
      if (left <= 0) { this.stop(ball, spin); continue; }
      const at = this.onScreen(ball.position.add(up.scale(ball.radius * 1.15)), width, height);
      if (!at || at.x < -20 || at.x > width + 20 || at.y < -20 || at.y > height + 40) continue;
      const number = String(Math.ceil(left));
      c.strokeText(number, at.x, at.y);
      c.fillText(number, at.x, at.y);
    }
    // (Those stopped this frame out of the physics together: one message to
    // its thread, and one new plan of the collisions there.)
    if (this.stopping.length > 0) {
      this.physics.removeBalls(this.stopping);
      this.stopping = [];
      this.onChange();
    }
    // None left counting (stopped, or taken away otherwise): the count is over.
    if (!balls.some((ball) => this.delays.has(ball.id) && !this.popped.has(ball.id))) this.started = null;
  }

  // The last moment: each stopped ball swells (faster and faster, a
  // quarter bigger in the end) and shudders, still turning as it was, then
  // bursts.
  lastMoment(time) {
    let kept = 0;
    for (const s of this.stopped) {
      const t = (time - s.since) / LAST_MOMENT;
      const rate = s.spin.length();
      if (rate > 0) s.ball.orientation = Quat.fromAxisAngle(s.spin.scale(1 / rate), rate * (time - s.since)).multiply(s.turn);
      if (t >= 1) { this.burst(s.ball, s.spin); continue; }
      const swell = 1 + 0.25 * t * t;
      const shake = 0.06 * s.radius * t;
      s.ball.radius = s.radius * swell;
      s.ball.position.x = s.at.x + (Math.random() - 0.5) * shake;
      s.ball.position.y = s.at.y + (Math.random() - 0.5) * shake;
      s.ball.position.z = s.at.z + (Math.random() - 0.5) * shake;
      this.stopped[kept++] = s;
    }
    this.stopped.length = kept;
    if (kept > 0) this.onChange();   // (drawn again as it swells)
  }

  // A ball bursts, with a pop from where it was, even with Sound off (see
  // Sounds.pop): its shell comes apart into its squares (see
  // shell-pieces.js).
  burst(ball, spin = new Vec3()) {
    this.sounds.pop('pop', this.camera.screenX(ball.position));
    this.pieces.burst(ball, spin, this.delays.size);
  }
}

// Are these two lists of numbers the same (a is null: no)?
function sameAs(a, b) {
  return a?.length === b.length && a.every((x, i) => x === b[i]);
}
