// =============================================================================
// room.js — the room the balls are in: the box or the whole window, the lamp and where it may stand, big pixels, and the camera that moves by itself.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { OrbitCamera } from './camera.js';
import { Vec3 } from './math.js';
import { setEffectPixelSize } from './twist.js';
import { BOX_HALF_SIZE, boxRoom } from './physics.js';
import { maxLampTilt } from './renderer.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'room';
export const needs = [
  'camera', 'changedByHand', 'lookHooks', 'needsRedraw', 'physics', 'renderer', 'resize',
  'settings', 'showBallCount',
];
export const gives = [
  'applyRoom', 'limitLampTilt', 'screenRoom', 'showPixels', 'stage', 'tiltSlider', 'wantedTilt',
];

export function setup(page) {
  // ---- The room -------------------------------------------------------------------
  // With the grid on, the balls live in the box. With it off, the window
  // itself is the room: seen from the starting view, the balls bounce off the
  // left, right and top edges of the window, whatever its shape. Those three
  // walls are slanted, because things further away look smaller: each one
  // runs from the camera's eye along the edge of what it sees. The floor
  // stays level (at the height where the window's bottom edge meets the front
  // of the room), and front and back are where the box's were.
  //
  // The room is fixed in the world: you can still turn and zoom the camera,
  // and then you see it from another angle.
  function screenRoom() {
    const eyeDistance = OrbitCamera.START_DISTANCE;
    const depth = BOX_HALF_SIZE;   // front and back walls at z = ±6
    const near = page.camera.frontViewAt(eyeDistance - depth);   // what is seen at the front wall
    const far = page.camera.frontViewAt(eyeDistance + depth);    // ... and at the back wall

    // A wall through the eye (at z = eyeDistance) that leans outwards by
    // `slope` units for every unit away from the camera.
    const slanted = (x, y, slope) => {
      const normal = new Vec3(x, y, slope).normalize();
      return { normal, offset: normal.z * eyeDistance };
    };
    const sideSlope = near.halfWidth / (eyeDistance - depth);
    const topSlope = near.halfHeight / (eyeDistance - depth);

    return {
      walls: [
        { normal: new Vec3(0, -1, 0), offset: near.halfHeight },   // floor
        slanted(0, 1, topSlope),                                   // top edge of the window
        slanted(-1, 0, sideSlope),                                 // left edge
        slanted(1, 0, sideSlope),                                  // right edge
        { normal: new Vec3(0, 0, -1), offset: depth },             // back
        { normal: new Vec3(0, 0, 1), offset: depth },              // front
      ],
      floorY: -near.halfHeight,
      min: new Vec3(-far.halfWidth, -near.halfHeight, -depth),
      max: new Vec3(far.halfWidth, far.halfHeight, depth),
    };
  }

  // What the renderer needs to know about the room: where the floor and the
  // lamp are, and how far sideways and how high the balls can get.
  // (One object, filled in afresh each time: it is asked for every frame.)
  const stageNow = {};
  function stage() {
    const room = page.physics.room, s = stageNow;
    s.floorY = room.floorY;
    s.lightHeight = page.settings.lamp;
    s.lightTilt = page.settings.lampTilt;
    s.reach = Math.max(room.max.x, room.max.z);
    s.top = room.max.y;
    s.windowRoom = !page.settings.grid;   // (the lamp then can't tilt all the way: see maxLampTilt)
    return s;
  }

  // The Lamp tilt slider only goes as far as the lamp may tilt in this room
  // (all the way in the box; less with the grid off, see maxLampTilt).
  // The tilt you chose comes back when the limit is lifted again.
  page.tiltSlider = null;
  page.wantedTilt = 0;
  function limitLampTilt() {
    const most = maxLampTilt(stage());
    page.settings.lampTilt = Math.min(page.wantedTilt, most);
    if (!page.tiltSlider) return;
    page.tiltSlider.setMax(most);
    page.tiltSlider.refresh();
  }

  function applyRoom() {
    const size = (room) => room ? JSON.stringify([room.min, room.max,
      room.walls.map((w) => [w.normal.x, w.normal.y, w.normal.z, w.offset])]) : '';
    const before = size(page.physics.room);
    page.physics.setRoom(page.settings.grid ? boxRoom() : screenRoom());
    page.showBallCount();   // balls that no longer fit were removed
    limitLampTilt();
    // (A resize that leaves the room as it was changes nothing for the balls.)
    if (size(page.physics.room) !== before) page.changedByHand();
  }

  page.lookHooks.shadows = () => { page.needsRedraw = true; };
  page.lookHooks.lampOn = () => { page.needsRedraw = true; };
  // Pixel size (on the Info page): 1 = as sharp as your screen allows.
  // Anything more draws the scene the way an old computer would have: in
  // big square pixels of that size, with hard edges (see renderer.js).
  // Around 3 gives about
  // as many lines as an Amiga screen had. The effect windows too (see
  // setEffectPixelSize in twist.js).
  function showPixels(size) {
    page.renderer.pixelSize = size;
    page.resize();
    setEffectPixelSize(size);
  }

  // Wide colour: the canvas is Display P3 wherever the browser can. Every
  // colour still looks exactly as in sRGB, except the balls' four NCS
  // elementary colours: on a wide-colour screen, as most phones and Macs
  // have, they come out truer than sRGB can show (see ELEMENTARY_IN_P3 in
  // renderer.js).
  page.renderer.setWideColor(true);

  // Glints: a shiny spot on each ball where it mirrors the lamp (not in
  // shadow). 0 = none, as in the original; 1 = white; 0.5 to begin with. With HDR on, the spot
  // shines brighter than white (see GLINT in renderer.js).
  page.lookHooks.glints = () => { page.needsRedraw = true; };
  // (For the rest of the page.)
  Object.assign(page, { applyRoom, limitLampTilt, screenRoom, showPixels, stage });
}
