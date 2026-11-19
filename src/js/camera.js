// =============================================================================
// camera.js — an "orbit" camera that circles around the centre of the box.
//
// Instead of storing the camera position as x/y/z, we store it like a point on
// a globe around the box:
//
//   distance – how far from the centre (zoom)
//   azimuth  – the angle around the vertical axis ("longitude")
//   polar    – the angle down from straight above ("latitude", 0 = top)
//
// Dragging changes the two angles, the mouse wheel / pinch changes distance.
// This replaces three.js's OrbitControls.
// =============================================================================

import { Vec3, Mat4 } from './math.js';

const FIELD_OF_VIEW = (45 * Math.PI) / 180;   // vertical, in radians
const NEAR = 0.1;                             // closest visible distance
const FAR = 1000;                             // farthest visible distance (the floor reaches almost to the horizon)

const MIN_DISTANCE = 5;
const MAX_DISTANCE = 30;
const MAX_POLAR = Math.PI / 2 + 0.1;   // may peek slightly below the floor
const MIN_POLAR = 0.001;               // not exactly 0: "up" becomes undefined

// Each scroll event multiplies the distance by this (or divides by it).
// Smaller = faster zooming, e.g. 0.9 zooms twice as fast.
const ZOOM_STEP = 0.95;

// How many pixels a press may move and still count as a click (not a drag).
const CLICK_TOLERANCE = 5;

const ORIGIN = new Vec3(0, 0, 0);

export class OrbitCamera {
  constructor(canvas) {
    this.canvas = canvas;

    // Start straight in front of the box, 22 units away.
    this.distance = 22;
    this.azimuth = 0;
    this.polar = Math.PI / 2;

    this.aspect = 1;          // set by resize()
    this.locked = false;      // true = dragging and zooming do nothing (clicks still work)
    this.onClick = () => {};  // main.js handles clicks on balls

    this.update();
    this.listenToInput();
  }

  // The camera's position in the world.
  get position() { return this.eye; }

  resize(width, height) {
    this.aspect = width / height;
    this.update();
  }

  // The automatic camera: circle slowly around the box while gliding a
  // little closer and further away. Call once per frame with the seconds
  // passed. Dragging and zooming by hand still work at the same time.
  autoMove(seconds, move = 'orbit') {
    const sway = (phase) => 1 + 0.15 * Math.sin(phase);   // ±15 % of the distance
    // Swing: rocking 30 degrees to either side, never round the back (for
    // scenes that play out in one upright plane facing the camera, whose
    // shadows fall on the back wall).
    const swing = (phase) => (Math.PI / 6) * Math.sin(phase * 0.6);
    // Rise: from eye level up to looking down from 30 degrees above, and back.
    const rise = (phase) => -(Math.PI / 6) * (0.5 - 0.5 * Math.cos(phase * 0.6));
    this.autoPhase ??= 0;
    // (What you set by hand: the view now, without the motion's own share.)
    const before = this.autoPhase;
    const chosenDistance = this.distance / sway(before);
    this.autoPhase += seconds * 0.4;
    const now = this.autoPhase;
    this.distance = chosenDistance * sway(now);
    if (move === 'swing') this.azimuth += swing(now) - swing(before);
    else this.azimuth += seconds * 0.25;   // one turn takes about 25 seconds
    if (move === 'rise') this.polar += rise(now) - rise(before);
    this.update();
  }

  // How much of the world the starting view shows: at `distance` in front
  // of the camera you see this far up and down from the middle
  // (`halfHeight`) and this far left and right (`halfWidth`).
  static get START_DISTANCE() { return 22; }
  frontViewAt(distance) {
    const halfHeight = distance * Math.tan(FIELD_OF_VIEW / 2);
    return { halfHeight, halfWidth: halfHeight * this.aspect };
  }

  // Go back to the starting view: straight in front of the box.
  lookFromFront() {
    this.autoPhase = 0;   // (the auto camera starts its motion afresh, from here)
    this.distance = 22;
    this.azimuth = 0;
    this.polar = Math.PI / 2;
    this.update();
  }

  // The direction the camera looks in.
  get forward() { return ORIGIN.sub(this.eye).normalize(); }

  // Recalculate the matrices after anything changed.
  update() {
    this.changed = true;   // tells main.js the picture needs redrawing
    this.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, this.polar));
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance));

    // Globe coordinates → x, y, z.
    const sinPolar = Math.sin(this.polar);
    // (Round the middle of the box, the point looked at.)
    const distance = this.distance;
    this.eye = new Vec3(
      distance * sinPolar * Math.sin(this.azimuth),
      distance * Math.cos(this.polar),
      distance * sinPolar * Math.cos(this.azimuth),
    );

    this.view = Mat4.lookAt(this.eye, ORIGIN, new Vec3(0, 1, 0));
    this.projection = Mat4.perspective(FIELD_OF_VIEW, this.aspect, NEAR, FAR);
    this.viewProjection = Mat4.multiply(this.projection, this.view);
  }

  // Turn a point on the canvas (in CSS pixels) into a ray: a starting point
  // and a direction going "into" the screen through that pixel.
  rayThroughPixel(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    // -1 … +1 across the screen, +1 at the top.
    const sx = (2 * (px - rect.left)) / rect.width - 1;
    const sy = 1 - (2 * (py - rect.top)) / rect.height;

    // The camera's own forward / right / up directions.
    const forward = this.forward;
    const right = forward.cross(new Vec3(0, 1, 0)).normalize();
    const up = right.cross(forward);

    const tanHalf = Math.tan(FIELD_OF_VIEW / 2);
    const dir = forward
      .add(right.scale(sx * tanHalf * this.aspect))
      .add(up.scale(sy * tanHalf))
      .normalize();
    return { origin: this.eye, dir };
  }

  // Where a point in the world appears across the screen, from -1 (left edge)
  // to +1 (right edge). Points outside the view are clamped to -1 or +1.
  // Used to place sounds left or right.
  screenX(point) {
    const forward = this.forward;
    const right = forward.cross(new Vec3(0, 1, 0)).normalize();
    const toPoint = point.sub(this.eye);
    const sideways = toPoint.dot(right);   // how far right of the centre line
    const ahead = toPoint.dot(forward);    // how far in front of the camera
    if (ahead <= 0) return Math.sign(sideways);   // behind us: hard left/right
    // At distance 'ahead', the screen's right edge is this far to the side:
    const halfWidth = ahead * Math.tan(FIELD_OF_VIEW / 2) * this.aspect;
    return Math.max(-1, Math.min(1, sideways / halfWidth));
  }

  // ---------------------------------------------------------------------------
  // Mouse / touch handling. Pointer Events cover mouse, pen and touch alike.
  // ---------------------------------------------------------------------------
  listenToInput() {
    const canvas = this.canvas;
    const pointers = new Map();     // finger/mouse id → last position
    let pressStart = null;          // where a possible click began
    let pinchDistance = 0;

    const pinchLength = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) pressStart = { x: e.clientX, y: e.clientY };
      if (pointers.size === 2) { pinchDistance = pinchLength(); pressStart = null; }
    });

    canvas.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;

      if (this.locked) {
        // The view is fixed: nothing to turn or zoom.
      } else if (pointers.size === 1) {
        // One pointer: rotate. Dragging across the whole canvas turns the
        // camera one full circle (the same feel as three.js OrbitControls).
        this.azimuth -= (dx / canvas.clientWidth) * 2 * Math.PI;
        this.polar -= (dy / canvas.clientHeight) * 2 * Math.PI;
        this.update();
      } else if (pointers.size === 2) {
        // Two fingers: pinch to zoom.
        const now = pinchLength();
        if (now > 0) this.distance *= pinchDistance / now;
        pinchDistance = now;
        this.update();
      }

      if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > CLICK_TOLERANCE) {
        pressStart = null;   // moved too far: this is a drag, not a click
      }
    });

    const release = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (e.type === 'pointerup' && pressStart && pointers.size === 0) {
        this.onClick(e.clientX, e.clientY);
      }
      if (pointers.size === 0) pressStart = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    // Mouse wheel / trackpad: zoom. Like release 1.3, every scroll event
    // moves the camera 5 % closer or farther, however small the scroll.
    // Trackpads send many small events per swipe, so zooming feels fast.
    // A pinch on a trackpad comes as a wheel event with Ctrl held. Should
    // the page itself already be magnified (a pinch that began over the
    // controls, before this was in place), a pinch must reach the browser,
    // or it could never be undone: the page would stay magnified, with
    // every pinch over the scene taken for the camera.
    const pageMagnified = () => (window.visualViewport?.scale ?? 1) > 1.01;
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey && pageMagnified()) return;   // (the browser's: zoom the page back out)
      e.preventDefault();
      if (e.deltaY === 0 || this.locked) return;   // sideways scrolling, or a fixed view: ignore
      this.distance *= e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      this.update();
    }, { passive: false });
  }
}
