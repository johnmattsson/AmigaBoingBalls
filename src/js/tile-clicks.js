// =============================================================================
// tile-clicks.js — Tile clicks: a click (or tap) that hits no ball
// does something to the square of the grid it lands on (Tile clicks, under
// Backdrop on the Look page): Tricks, or Paint.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { Vec3 } from './math.js';
import { BOX_HALF_SIZE } from './physics.js';
import { TILE_CLICKS, TILE_EFFECTS, PAINT_WORDS, wallKey, squareIndex } from './shaders.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'tileClicks';
export const needs = ['needsRedraw', 'physics', 'settings'];
export const gives = ['clearPaint', 'clickTile', 'tileClicksNow'];

export function setup(page) {
  // A click (or tap) that hits no ball lands on the room: on the wall or the
  // floor seen through the open front of the box. What it does to the square
  // of the grid there, Tile clicks on the Look page chooses: Tricks, a
  // flip, a turn or a shrink by chance (see TILE_EFFECTS in shaders.js), or
  // Paint, which stays until the scene starts again. The walls' shaders draw
  // them (see TILE_CLICK_MATHS), from where and when each was clicked; up to
  // TILE_CLICKS tricks at a time, the oldest making way.
  const tiles = [];        // { at (a Vec3), start (in ms), seconds, code }
  const paint = new Map(); // wall (see wallKey) → its paint, 4 bits a square
  let lastTrick = null;    // (not the same twice running)

  // Where a ray from the camera leaves the room: the room is the space
  // inside all its walls (each a plane, its normal pointing out), so the
  // ray is inside from where it has entered through every wall facing it
  // until it leaves through the first wall facing away; the wall seen there
  // is the one clicked. Null if the ray misses the room. (Also which wall,
  // by its normal.)
  function whereLeaving(ray) {
    let enter = 0, leave = Infinity, through = null;
    for (const { normal, offset } of page.physics.room.walls) {
      const towards = normal.dot(ray.dir);
      const room = offset - normal.dot(ray.origin);   // how far inside this wall the camera is (below 0: outside)
      if (Math.abs(towards) < 1e-12) {
        if (room < 0) return null;   // running alongside, outside it
      } else if (towards > 0) {
        if (room / towards < leave) { leave = room / towards; through = normal; }
      } else {
        enter = Math.max(enter, room / towards);
      }
    }
    if (!through || enter > leave) return null;
    return { at: ray.origin.add(ray.dir.scale(leave)), normal: through };
  }

  // Returns what was done ('paint', or the trick), and where, or null if nothing
  // (off, or the room missed, or no grid, or a backdrop: see tileClicks in
  // settings.js).
  function clickTile(ray) {
    const kind = page.settings.tileClicks;
    if (kind === 'off' || !page.settings.grid || page.settings.copper) return null;
    const hit = whereLeaving(ray);
    if (!hit) return null;
    if (kind === 'paint') {
      // The next colour, after the last none again: red, yellow, blue, green.
      const square = squareIndex(hit.at, hit.normal, BOX_HALF_SIZE);
      if (square < 0) return null;
      const key = wallKey(hit.normal);
      if (!paint.has(key)) paint.set(key, new Uint32Array(PAINT_WORDS));
      const words = paint.get(key), word = square >> 3, shift = (square & 7) * 4;
      const next = (((words[word] >>> shift) & 15) + 1) % 5;
      words[word] = (words[word] & ~(15 << shift)) | (next << shift);
      page.needsRedraw = true;
      return { kind, at: hit.at };
    }
    const start = performance.now();
    // The square's middle: the grid has a line at every whole number,
    // across the wall (in the box, whose walls line up with the axes).
    const middle = (value, across) => (Math.abs(across) > 0.5 ? value : Math.floor(value) + 0.5);
    const n = hit.normal;
    const at = new Vec3(middle(hit.at.x, n.x), middle(hit.at.y, n.y), middle(hit.at.z, n.z));
    // (Clicked again while something happens to it: that carries on.)
    if (tiles.some((t) => t.at.sub(at).length() < 0.25 && start - t.start < t.seconds * 1000)) return null;
    // A trick by chance (not the last one again), and which way (see tileAt).
    const tricks = Object.keys(TILE_EFFECTS).filter((name) => name !== lastTrick);
    const trick = tricks[Math.floor(Math.random() * tricks.length)];
    lastTrick = trick;
    const { code, seconds, ways } = TILE_EFFECTS[trick];
    const variant = Math.floor(Math.random() * ways);
    tiles.push({ at, start, seconds, code: code + 16 * variant });
    if (tiles.length > TILE_CLICKS) tiles.shift();
    page.needsRedraw = true;
    return { kind: trick, at: hit.at };
  }

  // This frame's clicks, for the renderer (see TILE_CLICK_MATHS): the
  // effects under way, where, which and how many seconds ago (those over,
  // gone), and the paint. (While an effect is under way, the picture is
  // drawn every frame, even paused.) With a backdrop, none of it (the paint
  // kept for when there is none again).
  const clicks = { tiles: new Float32Array(4 * TILE_CLICKS).fill(-1), paint };
  const none = { tiles: new Float32Array(4 * TILE_CLICKS).fill(-1), paint: new Map() };
  function tileClicksNow() {
    if (page.settings.copper) { tiles.length = 0; return none; }
    const now = performance.now();
    for (let k = tiles.length - 1; k >= 0; k--) if (now - tiles[k].start >= tiles[k].seconds * 1000) tiles.splice(k, 1);
    clicks.tiles.fill(-1);
    tiles.forEach(({ at, start, code }, k) => clicks.tiles.set([at.x, at.y, at.z, code * 10 + (now - start) / 1000], 4 * k));
    if (tiles.length > 0) page.needsRedraw = true;
    return clicks;
  }
  // A new scene: the walls clean again.
  function clearPaint() {
    if (paint.size > 0) page.needsRedraw = true;
    paint.clear();
  }

  // (For the rest of the page.)
  Object.assign(page, { clearPaint, clickTile, tileClicksNow });
}
