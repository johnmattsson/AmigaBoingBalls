// =============================================================================
// scene.js — the Scene page of the Controls and the speed bar: how many balls and how big, their energy, gravity (and tilting the phone to tilt it), and the speed of time.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { addSpeedBar, showRequester } from './gui.js';
import { Vec3 } from './math.js';
import { rangeOf } from './settings.js';
import { twistOptions } from './twist.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'scene';
export const needs = [
  'ENERGY_UNIT', 'VCR_SYMBOLS', 'camera', 'controls', 'fitVcrSymbols', 'needsRedraw',
  'physics', 'rewindCheck', 'scenePage', 'settings', 'showBallCount', 'sizeMix', 'totalWeight',
  'vcrSymbol',
];
export const gives = [
  'ENERGY_SLIDER_MAX', 'applyTilt', 'changedByHand', 'sceneHooks', 'togglePause', 'twistFull',
];

export function setup(page) {
  // ---- The Scene page ------------------------------------------------------------
  // (Its rows, made from the list in settings.js, are added at the end of
  // this part: see scenePage. Here what they do.)
  // A change to the balls or the room by hand (here, or a push, Energy,
  // Gravity, another kind of bounce): running time backwards can no longer
  // undo that, so the rewind test says so ("lost (by hand)"). (Its hidden twin
  // first takes on the new balls, so that it stays a copy of the scene.)
  function changedByHand() {
    page.rewindCheck.noticeNewBalls();
    page.rewindCheck.markChanged();
  }
  // Balls: if the box is too full for the number asked for, the slider shows
  // how many balls actually fit (see showBallCount).
  // Size mix: 1.0 = all balls equal; 4.0 = the biggest ball is four times as
  // wide as the smallest (from half to double the standard size).
  // Ball size: 1.0 = the usual size; the Classic 1984 ball is 2.0.
  // Energy: dragging it makes all balls faster or slower to reach the chosen
  // energy (its range grows if they have more: see frame).
  const ENERGY_SLIDER_MAX = rangeOf('energy').max;
  const sceneHooks = {
    balls: (count) => { page.physics.setBallCount(count); page.showBallCount(); changedByHand(); },
    ballSize: (size) => { page.physics.setBallSize(size); page.showBallCount(); changedByHand(); },
    sizes: (ratio) => { page.physics.setSizeMix(page.sizeMix(ratio)); page.showBallCount(); changedByHand(); },
    energy: (value) => {
      page.physics.setTotalEnergy(value * page.totalWeight() * page.ENERGY_UNIT, page.settings.gravity);
      page.rewindCheck.markChanged();
    },
    gravity: () => page.rewindCheck.markChanged(),
  };

  // Tilt (phones and tablets): gravity pulls the way the device is tilted, so
  // the balls roll "downhill". The tilt sensor (the deviceorientation event)
  // tells how the device is turned: beta is the tilt forwards and backwards,
  // gamma the tilt to the side. Shown only on touch screens; off by default.
  // (Some browsers, such as Safari on the iPhone, ask for permission first.)
  const DOWN = new Vec3(0, -1, 0);
  let tiltDown = null;      // which way is down, seen from the screen (x right, y up, z towards you)
  let tiltSent = DOWN;      // the direction last given to the physics
  function readTilt(e) {
    if (e.beta === null || e.gamma === null) return;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    // Down in the device's own directions (x to its right edge, y to its top
    // edge, z out of its screen)...
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
    // ...and turned with the screen, if it shows the picture sideways.
    const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    tiltDown = new Vec3(dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a), dz);
  }
  // Every frame: down as seen from the screen, turned into the room's own
  // directions (the camera may look from anywhere), for the physics.
  function applyTilt() {
    let down = DOWN;
    if (page.settings.tilt && tiltDown) {
      const forward = page.camera.forward;
      let right = forward.cross(new Vec3(0, 1, 0));
      right = right.lengthSq() > 1e-9 ? right.normalize() : new Vec3(1, 0, 0);
      const up = right.cross(forward);
      down = right.scale(tiltDown.x).add(up.scale(tiltDown.y)).sub(forward.scale(tiltDown.z)).normalize();
    }
    if (down.sub(tiltSent).length() < 0.002) return;   // (no change worth passing on)
    tiltSent = down;
    page.physics.down = down;
    page.rewindCheck.markChanged();   // (no rewind can undo a turning gravity)
  }
  // (Only on touch screens.)
  sceneHooks.tilt = {
    when: 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches,
    onChange: async (on) => {
      if (!on) return;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function' &&
            await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('not allowed');
      } catch {
        page.settings.tilt = false;
        page.scenePage.tilt.refresh();
        showRequester('Tilt', ['Tilt needs permission to use the motion sensor.']);
        return;
      }
      addEventListener('deviceorientation', readTilt);
      if (page.settings.gravity === 0) { page.settings.gravity = 1; page.scenePage.gravity.refresh(); }   // (without gravity, tilting does nothing)
      setTimeout(() => {
        if (page.settings.tilt && !tiltDown) {
          page.settings.tilt = false;
          page.scenePage.tilt.refresh();
          showRequester('Tilt', ['This device doesn\'t report how it is tilted.']);
        }
      }, 1500);
    },
  };
  // The speed of time is not in the panel but in the speed bar, which is
  // always on screen (top-left): below zero, time runs backwards.
  let speedBeforePause = 1;    // the speed to carry on at after a pause
  const setSpeed = (speed) => { page.settings.speed = speed; speedSlider.refresh(); };
  const togglePause = () => {
    if (page.settings.speed !== 0) {
      speedBeforePause = page.settings.speed;
      setSpeed(0);
    } else {
      setSpeed(speedBeforePause || 1);
    }
  };
  const speedSlider = addSpeedBar(document.body, page.settings, 'speed', rangeOf('speed'), [
    ['<<', () => setSpeed(-1)],     // run backwards
    ['||', togglePause],            // pause, or carry on
    ['>', () => setSpeed(1)],       // run forwards
  ]);
  page.controls.push(speedSlider);
  // (The three buttons show the same solid symbols as the video-recorder text
  // in the corner, drawn in the font's pixels: see vcrSymbol.)
  // (So do the preset bar's previous and next buttons.)
  const symbolButton = (button, symbol, name) => {
    button.replaceChildren(page.vcrSymbol(page.VCR_SYMBOLS[symbol]));
    button.setAttribute('aria-label', name);
    button.title = name;
  };
  [['◀◀', 'Rewind'], ['❚❚', 'Pause'], ['▶', 'Play']].forEach(([symbol, name], k) => {
    symbolButton(document.querySelectorAll('.speed-bar > button')[k], symbol, name);
  });
  {
    const [back, , forward] = document.querySelectorAll('.preset-bar > button');
    symbolButton(back, '◀', 'Previous preset');
    symbolButton(forward, '▶', 'Next preset');
  }
  page.fitVcrSymbols();
  // While the Twist is full screen nothing of the scene can be seen, so the
  // balls pause meanwhile (which also spares the computer): the animation runs
  // at speed 0, whatever the Speed setting says, and carries on at that speed
  // when the Twist comes back. (Also after a preset was chosen meanwhile.)
  page.twistFull = false;
  twistOptions.onFullScreen = (on) => { page.twistFull = on; page.needsRedraw = true; };
  // (For the rest of the page.)
  Object.assign(page, { ENERGY_SLIDER_MAX, applyTilt, changedByHand, sceneHooks, togglePause });
}
