// =============================================================================
// math.js — the small amount of 3D math this demo needs.
//
// three.js ships hundreds of math helpers. We only need four things:
//
//   1. Vec3   – a point or direction in 3D space (x, y, z).
//   2. Quat   – a quaternion, a compact way to store how an object is rotated.
//   3. Mat4   – 4x4 matrices that the GPU uses to turn 3D points into pixels.
//   4. A ray–sphere intersection test, used to find which ball the mouse hits.
//
// Coordinate system (same as three.js / OpenGL):
//   +X points right, +Y points up, +Z points out of the screen towards you.
// =============================================================================


// -----------------------------------------------------------------------------
// Vec3
//
// Every operation returns a NEW vector and never changes the original. That
// costs a tiny bit of speed, but makes the physics code read like the maths:
//
//     const contactVelocity = ball.velocity.add(ball.spin.cross(lever));
//
// With only a handful of balls the extra memory allocations are irrelevant.
// -----------------------------------------------------------------------------
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(v)      { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v)      { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s)    { return new Vec3(this.x * s, this.y * s, this.z * s); }
  negate()    { return this.scale(-1); }

  // Dot product: how much two vectors point in the same direction.
  // For a unit vector n, v.dot(n) is "the length of v along n".
  dot(v)      { return this.x * v.x + this.y * v.y + this.z * v.z; }

  // Cross product: a vector perpendicular to both inputs. In physics it turns
  // a spin plus a lever arm into a velocity (spin × arm), and a force plus a
  // lever arm into a twist / torque (arm × force).
  cross(v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  lengthSq()  { return this.dot(this); }
  length()    { return Math.sqrt(this.lengthSq()); }

  // Same direction, length 1. (A zero vector stays zero instead of NaN.)
  normalize() {
    const len = this.length();
    return len > 0 ? this.scale(1 / len) : new Vec3();
  }

  distanceSq(v) { return this.sub(v).lengthSq(); }
}


// -----------------------------------------------------------------------------
// Quat — quaternion rotations.
//
// A quaternion (x, y, z, w) describes "rotate by some angle around some axis".
// We use them for the balls' orientation because they can be combined over and
// over (thousands of tiny rotations per minute) without slowly drifting out of
// shape, which can happen with rotation matrices.
//
// You never need to look inside one: create it from an axis + angle, multiply
// two together to chain rotations, and convert to a matrix for the GPU.
// -----------------------------------------------------------------------------
export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) {   // default = "no rotation"
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  // Rotation of `angle` radians around the unit vector `axis`.
  static fromAxisAngle(axis, angle) {
    const s = Math.sin(angle / 2);
    return new Quat(axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2));
  }

  // a.multiply(b) means "first rotate by b, then by a".
  multiply(b) {
    const a = this;
    return new Quat(
      a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    );
  }

  // Rescale to length 1. Tiny rounding errors accumulate when you multiply
  // thousands of rotations together; normalizing removes them.
  normalize() {
    const len = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return new Quat(this.x / len, this.y / len, this.z / len, this.w / len);
  }

  // Convert to a 3x3 rotation matrix, written into `out` (9 numbers,
  // column by column — the order WebGL expects).
  toMat3(out, offset = 0) {
    const { x, y, z, w } = this;
    out[offset + 0] = 1 - 2 * (y * y + z * z);
    out[offset + 1] = 2 * (x * y + z * w);
    out[offset + 2] = 2 * (x * z - y * w);
    out[offset + 3] = 2 * (x * y - z * w);
    out[offset + 4] = 1 - 2 * (x * x + z * z);
    out[offset + 5] = 2 * (y * z + x * w);
    out[offset + 6] = 2 * (x * z + y * w);
    out[offset + 7] = 2 * (y * z - x * w);
    out[offset + 8] = 1 - 2 * (x * x + y * y);
  }
}


// -----------------------------------------------------------------------------
// Mat4 — 4x4 matrices for the camera.
//
// The GPU turns a 3D point into a pixel position in two steps:
//   view matrix       : moves the world so the camera sits at the origin,
//                       looking down -Z.
//   projection matrix : squashes that view into the screen with perspective
//                       (far things become smaller).
//
// Matrices are stored as Float32Array(16) in column-major order, which is
// what WebGL's uniformMatrix4fv() wants.
// -----------------------------------------------------------------------------
export const Mat4 = {
  // Perspective projection.
  //   fovY   – vertical field of view in radians
  //   aspect – canvas width / height
  //   near, far – closest / farthest visible distance
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  // A camera at `eye`, looking at `target`, with `up` roughly pointing up.
  lookAt(eye, target, up) {
    const zAxis = eye.sub(target).normalize();      // camera looks down -Z
    const xAxis = up.cross(zAxis).normalize();      // camera's right
    const yAxis = zAxis.cross(xAxis);               // camera's true up
    return new Float32Array([
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      -xAxis.dot(eye), -yAxis.dot(eye), -zAxis.dot(eye), 1,
    ]);
  },

  // a × b (apply b first, then a).
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  },
};


// -----------------------------------------------------------------------------
// Ray–sphere intersection.
//
// A ray starts at `origin` and travels along the unit vector `dir`.
// Returns the distance along the ray to the first hit, or Infinity on a miss.
//
// The idea: find the point on the ray closest to the sphere's centre. If that
// point is farther from the centre than the radius, the ray misses. Otherwise
// Pythagoras tells us how far before that closest point the ray enters.
// -----------------------------------------------------------------------------
export function raySphere(origin, dir, center, radius) {
  const toCenter = center.sub(origin);
  const along = toCenter.dot(dir);                    // closest approach
  const missDistSq = toCenter.lengthSq() - along * along;
  const r2 = radius * radius;
  if (missDistSq > r2) return Infinity;               // passes beside it
  const halfChord = Math.sqrt(r2 - missDistSq);
  const t = along - halfChord;                        // entry point
  return t >= 0 ? t : Infinity;                       // behind us = miss
}
