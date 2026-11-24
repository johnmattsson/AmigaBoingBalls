// -----------------------------------------------------------------------------
// shell-pieces.js — a ball bursting (see countdown.js): its shell comes apart
// into the very squares it is made of, which fly out through the room, fall
// as the balls do (the Gravity setting), bounce off the walls and the balls
// still there, and land on the floor, where they are painted into a picture
// of it that stays until the scene starts again (see bake).
//
// Up to PIECES_MOST of them at once, every frame: so each
// piece is kept as plain numbers, changed in place (no new objects a
// frame), and the colour is only set where it changes (see draw). Those on
// the floor are only in its picture, which costs nothing however many there
// are. Without gravity they come to rest in mid-air; once all are still,
// they aren't drawn again until the camera moves (see moving, and draw in
// countdown.js).
// -----------------------------------------------------------------------------
import { Vec3 } from './math.js';
import { canvasColor, elementaryIndex } from './colors.js';

const STILL = 0.02;                // slower than this, moving and turning, a piece lies still
const LOSS = 0.6;                  // what is left of a piece's speed after a bounce (light: they hardly bounce)
const AIR = 0.6;                   // how fast the air slows them (a share of their speed, a second, about)
const PIECES_MOST = 20000;         // pieces in all, at most (more: the oldest go)
const FLOOR_TEXELS = 1024;         // the floor's picture of the pieces on it (see floorFor): this many squares along its longer side
const GRID_CUBES_MOST = 1 << 18;  // the balls' grid (see ballsNear): at most this many cubes
const LANDING_SPEED = 1.5;         // slower than this against the floor: it lands (box units a second)

export class ShellPieces {
  constructor() {
    this.pieces = [];
    this.moving = 0;   // how many are still moving (see step)
    this.most = PIECES_MOST;   // how many pieces there may be in all
    // The pieces lying on the floor, as a picture of it (see floorFor and
    // bake): drawn by the renderer, as part of the floor (see options.floor
    // Pieces in renderer.js), and no more one by one here.
    this.floor = null;
  }

  get count() { return this.pieces.length; }
  clear() { this.pieces = []; this.moving = 0; this.floor = null; }

  // A ball bursts (its copy as drawn: position, orientation, radius, color,
  // squares), turning as it was (spin: see spinOf in countdown.js). Its
  // squares are as the ball shows them (see the checker pattern in
  // shaders.js): N from pole to pole (ball.squares), 2N around, the ones at
  // the poles triangles; coloured where the two counts add up to an even
  // number, else white, the same on both sides. Each flies out the way it
  // faces, and sideways the way the ball's spin was carrying it (spin × where
  // it is), and goes on turning as the ball did. (balls: how many burst in
  // all, so that together they make no more than `most` pieces: with
  // many, some squares are left out, by chance.)
  burst(ball, spin, balls) {
    const rate = spin.length();
    const r = ball.radius, down = Math.round(ball.squares), around = 2 * down;
    const keep = Math.min(1, this.most / Math.max(1, balls * around * down));
    const m = new Float32Array(9);
    ball.orientation.toMat3(m);   // (the ball's own directions in the world, column by column)
    const turned = (x, y, z) => new Vec3(m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z);
    // A point of the ball's own sphere, by how far around (0 … 1) and down
    // (0 … 1, from the top pole), as in shaders.js.
    const onBall = (a, d) => {
      const phi = (a - 0.5) * 2 * Math.PI, theta = d * Math.PI;
      return turned(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    };
    for (let i = 0; i < around; i++) {
      for (let j = 0; j < down; j++) {
        if (Math.random() >= keep) continue;
        const a0 = i / around, a1 = (i + 1) / around, d0 = j / down, d1 = (j + 1) / down;
        const out = onBall((a0 + a1) / 2, (d0 + d1) / 2);   // its middle: which way it faces
        // Its corners (three at a pole, where two meet), from its middle.
        let corners = [onBall(a0, d0), onBall(a1, d0), onBall(a1, d1), onBall(a0, d1)];
        if (j === 0) corners = [corners[0], corners[2], corners[3]];
        if (j === down - 1) corners = [corners[0], corners[1], corners[2]];
        const middle = corners.reduce((sum, c) => sum.add(c), new Vec3()).scale(r / corners.length);
        const speed = (3 + 4 * Math.random()) * Math.sqrt(Math.max(0.3, r));
        const v = out.scale(speed).add(spin.cross(middle));
        // It goes on turning as the ball did, about the same axis, with a
        // little wobble of its own (a ball hardly spinning: by chance).
        const z = 2 * Math.random() - 1, t = 2 * Math.PI * Math.random(), s = Math.sqrt(1 - z * z);
        const wobble = new Vec3(s * Math.cos(t), z, s * Math.sin(t));
        const turning = rate > 0.5 ? spin.add(wobble.scale(0.25 * rate)) : wobble.scale(5 + 9 * Math.random());
        const axis = turning.normalize(), at = ball.position.add(middle);
        this.pieces.push({
          x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z,
          ax: axis.x, ay: axis.y, az: axis.z, spin: turning.length(),
          corners: corners.flatMap((c) => { const k = c.scale(r).sub(middle); return [k.x, k.y, k.z]; }),   // x, y, z, … from its middle
          hex: (i + j) % 2 === 0 ? ball.color & 0xffffff : 0xffffff,
        });
      }
    }
    if (this.pieces.length > this.most) this.pieces.splice(0, this.pieces.length - this.most);
    this.moving = this.pieces.length;
  }

  // On by dt seconds: flying through the room (walls: see boxRoom in
  // physics.js), slowed a little by the air, falling the way the balls do
  // (gravity: how strongly, straight down, as in physics.js), tumbling about
  // its axis, bouncing off the walls and the balls (losing most of their
  // speed), and landing on the floor, lying flat, where it is painted into
  // the floor's picture (see bake) and leaves the list. The air slows their
  // turning too, so that without gravity they come to rest in mid-air.
  // balls: those still there, as drawn ({ id, position, radius }); how they
  // move is worked out from frame to frame.
  step(dt, walls, gravity = 14, balls = []) {
    const drag = Math.exp(-AIR * dt);
    const near = this.ballsNear(balls, dt);
    const floor = this.floorFor(walls);
    const pieces = this.pieces;
    let moving = 0, kept = 0;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      let landed = false;
      if (dt > 0) {
        p.spin *= drag;
        p.vx *= drag; p.vy = p.vy * drag - gravity * dt; p.vz *= drag;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        // Tumbling: its corners turned a little about its axis (Rodrigues' formula).
        const angle = p.spin * dt, cos = Math.cos(angle), sin = Math.sin(angle), k = p.corners;
        for (let c = 0; c < k.length; c += 3) {
          const x = k[c], y = k[c + 1], z = k[c + 2];
          const along = (p.ax * x + p.ay * y + p.az * z) * (1 - cos);
          k[c] = x * cos + (p.ay * z - p.az * y) * sin + p.ax * along;
          k[c + 1] = y * cos + (p.az * x - p.ax * z) * sin + p.ay * along;
          k[c + 2] = z * cos + (p.ax * y - p.ay * x) * sin + p.az * along;
        }
        for (const wall of walls) {
          const n = wall.normal, beyond = p.x * n.x + p.y * n.y + p.z * n.z - wall.offset;
          if (beyond <= 0) continue;
          p.x -= n.x * beyond; p.y -= n.y * beyond; p.z -= n.z * beyond;
          const into = p.vx * n.x + p.vy * n.y + p.vz * n.z;
          if (into > 0) {
            p.vx = (p.vx - 1.35 * into * n.x) * LOSS;
            p.vy = (p.vy - 1.35 * into * n.y) * LOSS;
            p.vz = (p.vz - 1.35 * into * n.z) * LOSS;
          }
          // On the floor, slow: it lands, tipped over to lie flat (see
          // layFlat), is painted into the floor's picture, and is gone from
          // the list (nothing moves it any more: see bake).
          if (floor && gravity > 0 && n.y < -0.9 && Math.hypot(p.vx, p.vy, p.vz) < LANDING_SPEED) {
            layFlat(k, n);
            // (Lying flat it may reach through a wall beside it: moved in.)
            for (const side of walls) {
              const m = side.normal;
              let most = 0;
              for (let c = 0; c < k.length; c += 3) {
                most = Math.max(most, (p.x + k[c]) * m.x + (p.y + k[c + 1]) * m.y + (p.z + k[c + 2]) * m.z - side.offset);
              }
              p.x -= m.x * most; p.y -= m.y * most; p.z -= m.z * most;
            }
            this.bake(p, floor);
            landed = true;
            break;
          }
        }
        if (landed) continue;   // (gone from the list: see below)
        if (near) this.offBalls(p, near);
      }
      pieces[kept++] = p;
      if (gravity > 0 || Math.hypot(p.vx, p.vy, p.vz) > STILL || p.spin > STILL) moving++;
    }
    pieces.length = kept;
    if (dt > 0) this.moving = moving;
  }

  // The floor's picture (see bake), for the room's walls: over the whole
  // floor, FLOOR_TEXELS squares along its longer side; a new, empty one if
  // the room has changed ("In a box"). null: no floor. (The floor is what
  // the upright walls leave of the plane at its height: in the box a square,
  // in the window-sized room a wider shape, its side walls slanting to fit
  // the view. The picture covers all of it, a rectangle round it.)
  floorFor(walls) {
    const below = walls.find((w) => w.normal.y < -0.999);
    if (!below) return null;
    const key = walls.map((w) => `${w.normal.x} ${w.normal.y} ${w.normal.z} ${w.offset}`).join(' ');
    if (this.floor?.key !== key) {
      let shape = [[-1e4, -1e4], [1e4, -1e4], [1e4, 1e4], [-1e4, 1e4]];   // (x, z: far bigger than any room)
      for (const w of walls) {
        if (Math.abs(w.normal.y) > 1e-6) continue;   // (the floor and the ceiling)
        shape = cutBy(shape, w.normal.x, w.normal.z, w.offset);
      }
      if (shape.length < 3) return null;
      const xs = shape.map((p) => p[0]), zs = shape.map((p) => p[1]);
      const x0 = Math.min(...xs), z0 = Math.min(...zs), across = Math.max(...xs) - x0, deep = Math.max(...zs) - z0;
      if (!(across > 0 && deep > 0)) return null;
      const longer = Math.max(across, deep);
      const width = Math.max(1, Math.round(FLOOR_TEXELS * across / longer)), height = Math.max(1, Math.round(FLOOR_TEXELS * deep / longer));
      this.floor = { key, y: -below.offset, x0, z0, across, deep, width, height,
        codes: new Uint8Array(width * height), any: false, version: 0 };
    }
    return this.floor;
  }

  // A piece lying on the floor, painted into its picture: each little square
  // whose middle it covers gets its colour, as a code (0: none; 1 … 4 the
  // elementary colours, in the order of elementaryColor in colors.js; 5
  // white), the last landed on top, as they lie. (The renderer turns the
  // codes into colours, on wide-colour screens too.)
  bake(p, floor) {
    const index = elementaryIndex(p.hex);
    const code = index >= 0 ? index + 1 : 5;
    const k = p.corners, n = k.length / 3;
    const u = new Float64Array(n), v = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      u[c] = (p.x + k[3 * c] - floor.x0) / floor.across * floor.width;
      v[c] = (p.z + k[3 * c + 2] - floor.z0) / floor.deep * floor.height;
    }
    fillConvex(u, v, floor.width, floor.height, (row, from, to) => floor.codes.fill(code, row * floor.width + from, row * floor.width + to + 1));
    floor.any = true;
    floor.version++;
  }

  // The balls, for the pieces to bounce off (see offBalls): each with how
  // fast it moves (from where it was the frame before), in a grid of cubes
  // at least as big across as the biggest ball, over the space the balls
  // are in, so each piece looks only at those near it: for each cube, its
  // first ball, and for each ball, the next in its cube. (None: null.)
  ballsNear(balls, dt) {
    const was = this.ballsWere ??= new Map(), now = new Map();
    if (balls.length === 0 || this.pieces.length === 0) { was.clear(); return null; }
    let size = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of balls) {
      const at = b.position;
      if (2 * b.radius > size) size = 2 * b.radius;
      if (at.x < x0) x0 = at.x;
      if (at.y < y0) y0 = at.y;
      if (at.z < z0) z0 = at.z;
      if (at.x > x1) x1 = at.x;
      if (at.y > y1) y1 = at.y;
      if (at.z > z1) z1 = at.z;
    }
    const low = [x0, y0, z0], span = [x1 - x0, y1 - y0, z1 - z0];
    size = Math.max(size, Math.cbrt((span[0] + size) * (span[1] + size) * (span[2] + size) / GRID_CUBES_MOST));
    const across = span.map((s) => Math.floor(s / size) + 1);
    const cubes = across[0] * across[1] * across[2];
    const first = this.firstInCube?.length >= cubes ? this.firstInCube : (this.firstInCube = new Int32Array(Math.max(cubes, 4096)));
    first.fill(-1, 0, cubes);
    const next = new Int32Array(balls.length);
    const numbers = new Float64Array(7 * balls.length);   // x, y, z, radius, vx, vy, vz, …
    balls.forEach((b, i) => {
      const at = b.position, before = was.get(b.id), n = 7 * i;
      numbers[n] = at.x; numbers[n + 1] = at.y; numbers[n + 2] = at.z; numbers[n + 3] = b.radius;
      if (before && dt > 0) {
        numbers[n + 4] = (at.x - before[0]) / dt; numbers[n + 5] = (at.y - before[1]) / dt; numbers[n + 6] = (at.z - before[2]) / dt;
      }
      now.set(b.id, [at.x, at.y, at.z]);
      const cube = (Math.floor((at.x - low[0]) / size) * across[1] + Math.floor((at.y - low[1]) / size)) * across[2] + Math.floor((at.z - low[2]) / size);
      next[i] = first[cube];
      first[cube] = i;
    });
    this.ballsWere = now;
    return { first, next, numbers, low, size, across };
  }

  // A piece inside a ball: put back on its surface, and bounced off it as
  // off a wall, the way the ball was moving. (A ball touching the piece has
  // its middle at most half a cube away: in the piece's cube, or the next
  // one on its nearer side, on each axis: 8 cubes.)
  offBalls(p, { first, next, numbers: m, low, size, across }) {
    const fx = (p.x - low[0]) / size, fy = (p.y - low[1]) / size, fz = (p.z - low[2]) / size;
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    const sx = fx - cx < 0.5 ? -1 : 1, sy = fy - cy < 0.5 ? -1 : 1, sz = fz - cz < 0.5 ? -1 : 1;
    for (let corner = 0; corner < 8; corner++) {
      const x = cx + (corner & 1 ? sx : 0), y = cy + (corner & 2 ? sy : 0), z = cz + (corner & 4 ? sz : 0);
      if (x < 0 || y < 0 || z < 0 || x >= across[0] || y >= across[1] || z >= across[2]) continue;
      for (let i = first[(x * across[1] + y) * across[2] + z]; i >= 0; i = next[i]) {
        const n = 7 * i;
        const dx = p.x - m[n], dy = p.y - m[n + 1], dz = p.z - m[n + 2], r = m[n + 3], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        const rx = p.vx - m[n + 4], ry = p.vy - m[n + 5], rz = p.vz - m[n + 6];
        const into = rx * nx + ry * ny + rz * nz;
        p.x = m[n] + nx * r; p.y = m[n + 1] + ny * r; p.z = m[n + 2] + nz * r;
        if (into < 0) {
          p.vx = m[n + 4] + (rx - 1.35 * into * nx) * LOSS;
          p.vy = m[n + 5] + (ry - 1.35 * into * ny) * LOSS;
          p.vz = m[n + 6] + (rz - 1.35 * into * nz) * LOSS;
        }
      }
    }
  }

  // Draw them on a 2D canvas (c: as many pixels as the scene's picture,
  // which takes it in: see countdown.js), for a scene of width × height CSS
  // pixels, as the camera sees them: the farthest first, so that nearer
  // pieces cover them (and, as a ball bursts, the front of its shell its
  // back). The colour is set only where it changes: each piece is filled
  // on its own (one shape of thousands was slower, measured). hard: big
  // pixels (see Pixel size), with hard edges as the scene's (see hardFill).
  // wide: the canvas is Display P3 (see canvasColor in colors.js).
  // balls: those drawn in the scene ({ position, radius }), which the
  // pieces are drawn on top of: so each ball, taken in its turn by how far
  // away it is, cuts its outline (a disc) out of the pieces behind it.
  draw(c, camera, width, height, hard = false, wide = false, balls = []) {
    const colors = this.colors ??= new Map();
    if (this.colorsWide !== wide) { colors.clear(); this.colorsWide = wide; }
    const m = camera.viewProjection;
    // Each piece on the screen: its corners, and how far away (w).
    const seen = this.seen ??= [];
    seen.length = 0;
    for (const p of this.pieces) {
      const k = p.corners, points = p.points ??= [];
      points.length = 0;
      let w = 0, ok = true;
      for (let j = 0; j < k.length; j += 3) {
        const x = p.x + k[j], y = p.y + k[j + 1], z = p.z + k[j + 2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0.01) { ok = false; break; }   // (behind the camera)
        points.push(((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) / 2 * width,
                    (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) / 2 * height);
        w += cw;
      }
      if (!ok) continue;
      p.w = w / (k.length / 3);   // (its corners' average)
      p.color = colors.get(p.hex) ?? colors.set(p.hex, canvasColor(p.hex, wide)).get(p.hex);
      seen.push(p);
    }
    // The balls' discs: middle, radius on the screen, how far away.
    const discs = this.discs ??= [], focal = camera.projection[5] * height / 2;
    let d = 0;
    if (seen.length > 0) {
      for (const b of balls) {
        const { x, y, z } = b.position;
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0.01) continue;
        const disc = discs[d++] ??= { disc: true };
        disc.x = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) / 2 * width;
        disc.y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) / 2 * height;
        disc.radius = b.radius * focal / cw;
        disc.w = cw;
        seen.push(disc);
      }
    }
    // The farthest first. (A ball hides whatever lies inside its outline on
    // the screen: the floor there is behind it.)
    seen.sort((a, b) => b.w - a.w);
    if (hard) { this.hardFill(c, seen, width, height, wide); return; }
    const g = c;
    g.setTransform(c.canvas.width / width, 0, 0, c.canvas.height / height, 0, 0);
    g.clearRect(0, 0, width, height);
    let color = null;
    for (const p of seen) {
      if (p.disc) {
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        g.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
        g.fill();
        g.globalCompositeOperation = 'source-over';
        continue;
      }
      if (p.color !== color) g.fillStyle = (color = p.color).css;
      const o = p.points;
      g.beginPath();
      g.moveTo(o[0], o[1]);
      for (let j = 2; j < o.length; j += 2) g.lineTo(o[j], o[j + 1]);
      g.fill();
    }
  }

  // Draw the pieces seen (farthest first) with hard edges: each pixel of
  // the canvas (with big pixels, as big as the scene's) the piece's or not,
  // by whether its middle is inside it (as the graphics card decides for the
  // scene: no smoothed edges, which a 2D canvas always gives its shapes).
  hardFill(c, seen, width, height, wide) {
    const w = c.canvas.width, h = c.canvas.height;
    if (this.image?.width !== w || this.image?.height !== h || this.imageWide !== wide) {
      this.image = wide ? new ImageData(w, h, { colorSpace: 'display-p3' }) : new ImageData(w, h);
      this.imageWide = wide;
    }
    const bytes = this.image.data;
    bytes.fill(0);
    const sx = w / width, sy = h / height;
    for (const p of seen) {
      if (p.disc) {
        // A ball's disc: the pixels whose middles are in it, cleared.
        const cx = p.x * sx, cy = p.y * sy, r = p.radius * sy;
        for (let y = Math.max(0, Math.ceil(cy - r - 0.5)), last = Math.min(h - 1, Math.ceil(cy + r - 0.5) - 1); y <= last; y++) {
          const half = Math.sqrt(Math.max(0, r * r - (y + 0.5 - cy) ** 2));
          const from = Math.max(0, Math.ceil(cx - half - 0.5)), to = Math.min(w - 1, Math.ceil(cx + half - 0.5) - 1);
          for (let x = from, at = (y * w + from) * 4; x <= to; x++, at += 4) bytes[at + 3] = 0;
        }
        continue;
      }
      const o = p.points, n = o.length;
      let top = Infinity, bottom = -Infinity;
      for (let j = 1; j < n; j += 2) { top = Math.min(top, o[j] * sy); bottom = Math.max(bottom, o[j] * sy); }
      const [r, gr, b] = p.color.rgb;
      // Each row whose middle (y + 0.5) the piece crosses: from where its
      // edges cross that line, the pixels whose middles lie between. (The
      // pieces are convex: one stretch a row.)
      for (let y = Math.max(0, Math.ceil(top - 0.5)), last = Math.min(h - 1, Math.ceil(bottom - 0.5) - 1); y <= last; y++) {
        const yc = y + 0.5;
        let left = Infinity, right = -Infinity;
        for (let j = 0; j < n; j += 2) {
          const k = (j + 2) % n;
          const x0 = o[j] * sx, y0 = o[j + 1] * sy, x1 = o[k] * sx, y1 = o[k + 1] * sy;
          if ((y0 <= yc) === (y1 <= yc)) continue;   // (this edge doesn't cross the line)
          const x = x0 + (yc - y0) / (y1 - y0) * (x1 - x0);
          if (x < left) left = x;
          if (x > right) right = x;
        }
        const from = Math.max(0, Math.ceil(left - 0.5)), to = Math.min(w - 1, Math.ceil(right - 0.5) - 1);
        for (let x = from, at = (y * w + from) * 4; x <= to; x++, at += 4) {
          bytes[at] = r; bytes[at + 1] = gr; bytes[at + 2] = b; bytes[at + 3] = 255;
        }
      }
    }
    c.putImageData(this.image, 0, 0);
  }
}

// A piece landing (its corners k, x, y, z, … from its middle) on the floor
// (n: its normal, out of the room): turned, about its middle, until it lies
// flat on it, so
// it keeps its own shape and size (pressed flat instead, one landing on its
// edge would be squashed into a sliver). (Its corners lie on the ball's
// curved shell, so not quite in one plane: what little is left of them off
// the floor is then taken away.)
function layFlat(k, n) {
  // Which way the piece faces: across its corners (diagonals of a square,
  // or two sides of a triangle), turned towards the floor.
  const a = k.length === 9 ? [k[3] - k[0], k[4] - k[1], k[5] - k[2]] : [k[6] - k[0], k[7] - k[1], k[8] - k[2]];
  const b = k.length === 9 ? [k[6] - k[0], k[7] - k[1], k[8] - k[2]] : [k[9] - k[3], k[10] - k[4], k[11] - k[5]];
  let fx = a[1] * b[2] - a[2] * b[1], fy = a[2] * b[0] - a[0] * b[2], fz = a[0] * b[1] - a[1] * b[0];
  const length = Math.hypot(fx, fy, fz);
  if (length > 1e-12) {
    fx /= length; fy /= length; fz /= length;
    if (fx * n.x + fy * n.y + fz * n.z < 0) { fx = -fx; fy = -fy; fz = -fz; }
    // The turn from that way to the floor's: about the axis across both.
    let ax = fy * n.z - fz * n.y, ay = fz * n.x - fx * n.z, az = fx * n.y - fy * n.x;
    const sin = Math.hypot(ax, ay, az), cos = fx * n.x + fy * n.y + fz * n.z;
    if (sin > 1e-9) {
      ax /= sin; ay /= sin; az /= sin;
      for (let c = 0; c < k.length; c += 3) {   // (Rodrigues' formula, as in step)
        const x = k[c], y = k[c + 1], z = k[c + 2];
        const along = (ax * x + ay * y + az * z) * (1 - cos);
        k[c] = x * cos + (ay * z - az * y) * sin + ax * along;
        k[c + 1] = y * cos + (az * x - ax * z) * sin + ay * along;
        k[c + 2] = z * cos + (ax * y - ay * x) * sin + az * along;
      }
    }
  }
  for (let c = 0; c < k.length; c += 3) {
    const off = k[c] * n.x + k[c + 1] * n.y + k[c + 2] * n.z;
    k[c] -= off * n.x; k[c + 1] -= off * n.y; k[c + 2] -= off * n.z;
  }
}

// A convex shape (corners u, v), filled square by square on a grid of
// width × height: each row's stretch of squares whose middles it covers,
// handed to fill(row, first, last).
function fillConvex(u, v, width, height, fill) {
  const n = u.length;
  let top = Infinity, bottom = -Infinity;
  for (let c = 0; c < n; c++) { top = Math.min(top, v[c]); bottom = Math.max(bottom, v[c]); }
  for (let y = Math.max(0, Math.ceil(top - 0.5)), last = Math.min(height - 1, Math.ceil(bottom - 0.5) - 1); y <= last; y++) {
    const yc = y + 0.5;
    let left = Infinity, right = -Infinity;
    for (let c = 0; c < n; c++) {
      const d = (c + 1) % n;
      if ((v[c] <= yc) === (v[d] <= yc)) continue;
      const x = u[c] + (yc - v[c]) / (v[d] - v[c]) * (u[d] - u[c]);
      if (x < left) left = x;
      if (x > right) right = x;
    }
    const from = Math.max(0, Math.ceil(left - 0.5)), to = Math.min(width - 1, Math.ceil(right - 0.5) - 1);
    if (to >= from) fill(y, from, to);
  }
}

// A shape on the floor (corners x, z), cut by an upright wall (n · p <=
// offset is inside): what is left of it.
function cutBy(shape, nx, nz, offset) {
  const out = [];
  for (let c = 0; c < shape.length; c++) {
    const a = shape[c], b = shape[(c + 1) % shape.length];
    const da = nx * a[0] + nz * a[1] - offset, db = nx * b[0] + nz * b[1] - offset;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
