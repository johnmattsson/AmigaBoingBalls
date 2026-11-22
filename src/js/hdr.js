// =============================================================================
// hdr.js — light brighter than white: the HDR slider, and what the page says about the screen when it is used.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { showRequester } from './gui.js';
import { twistOptions } from './twist.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'hdr';
export const needs = [
  'applyRoom', 'camera', 'controls', 'limitLampTilt', 'lookHooks', 'needsRedraw', 'panel',
  'renderer', 'setHdr', 'settings', 'showTextGlow',
];
export const gives = [
  'hdrChanged', 'hdrOn', 'hdrSlider', 'showGrid', 'showHdrControl', 'syncHdr', 'tiltSlider',
  'wantedTilt',
];

export function setup(page) {
  // ---- Light brighter than white --------------------------------------------
  // HDR: on an HDR screen, light brighter than white really shines (needs
  // WebGPU: see gpu-renderer.js). The slider says how
  // bright that light gets: 0 = none (and no WebGPU at all), 1 = the full
  // design. Above 0, everything that can shine does: the copper bars'
  // highlights, the glints (if Glints is on), the scroller's letters and the
  // Twist's highlight (see the top of renderer.js).
  const hdrOn = () => Boolean(page.renderer.hdr);
  page.hdrSlider = null;
  function hdrChanged() {
    twistOptions.hdr = hdrOn();
    twistOptions.strength = page.settings.hdrStrength;
    page.showTextGlow();
    page.needsRedraw = true;
  }
  // Start or stop HDR to match the slider. (Starting takes a moment; if the
  // slider moves meanwhile, it catches up afterwards.)
  let hdrBusy = false, hdrWarned = false;
  async function syncHdr() {
    hdrChanged();
    const wanted = page.settings.hdrStrength > 0;
    if (hdrBusy || wanted === hdrOn()) return;
    hdrBusy = true;
    const message = await page.setHdr(wanted);
    hdrBusy = false;
    if (wanted && !page.renderer.hdr) {   // it didn't work out
      page.settings.hdrStrength = 0;
      page.hdrSlider.refresh();
      showRequester('HDR', [message]);
    } else if (wanted && !page.renderer.hdr.screenIsHdr && !hdrWarned) {
      hdrWarned = true;
      showRequester('HDR', [
        'HDR is on, but this screen says it can\'t show HDR, so everything brighter than white still looks white. ' +
        'On a Mac or in Windows, HDR may have to be switched on in the display settings.']);
    }
    syncHdr();
  }
  // The HDR slider is always there, but ghosted where it would do nothing:
  // unless WebGPU draws (with WebGL, as in Firefox and Safari, there is no
  // HDR: see setHdr), in a browser whose canvas can go brighter than white,
  // on a screen that shows HDR. (A window moved to another screen: see the
  // listener below. hdrWorks is not a setting, and not kept: hidden from
  // anything that goes through the settings.)
  const hdrScreen = typeof matchMedia === 'function' ? matchMedia('(dynamic-range: high)') : null;
  Object.defineProperty(page.settings, 'hdrWorks', { value: true, writable: true, enumerable: false });
  function showHdrControl() {
    page.settings.hdrWorks = Boolean(page.renderer.isWebGpu && page.renderer.canShowHdr !== false && hdrScreen?.matches);
    page.panel.ghostRows();
  }
  hdrScreen?.addEventListener?.('change', showHdrControl);

  // The lamp's usual height: 21 over the box, as always. Over the much wider
  // window-sized room it hangs higher, so that the shadows stay close to
  // under the balls.
  const LAMP_OVER_BOX = 21;
  const LAMP_OVER_WINDOW = 45;

  // "In a box": with the grid you also get the camera you can turn; without
  // it, the window is the room and the camera stays put.
  function showGrid(on) {
    // The window-sized room is made for the starting view, so the camera
    // goes back there and stays put while the grid is off — and Auto cam,
    // which needs a camera that can move, goes off with it.
    if (!on) {
      page.camera.lookFromFront();
      page.settings.autoCamera = false;
      lookPage.camMove.refresh();
    }
    page.camera.locked = !on;
    // The lamp moves to its usual distance for the new room, unless you have
    // moved it yourself: then it stays where you put it.
    const [usualBefore, usualNow] = on ? [LAMP_OVER_WINDOW, LAMP_OVER_BOX] : [LAMP_OVER_BOX, LAMP_OVER_WINDOW];
    if (page.settings.lamp === usualBefore) page.settings.lamp = usualNow;
    lookPage.lamp.refresh();
    page.applyRoom();
  }
  page.lookHooks.grid = showGrid;
  // Auto cam: the camera moves by itself, in the way chosen: Off, Round (all
  // the way round the box), Swing (side to side in front, never round the
  // back: for scenes whose shadows fall on the back wall) or Rise (round, and
  // up to look down from above and back). Presets that start with it on pick
  // their own way. It only works with the box (and its movable camera), so
  // switching it on switches that on too.
  // (null: Off.)
  page.lookHooks.camMove = (way) => {
    if (way !== null && !page.settings.grid) {
      page.settings.grid = true;
      lookPage.grid.refresh();
      showGrid(true);
    }
  };
  // The lamp. "Lamp dist" is how far away it is: a near lamp throws long,
  // spreading shadows, a far one keeps them the size of the balls. (It never
  // comes closer than a little outside the room.) "Lamp tilt" swings it from
  // straight above (0°: shadows on the floor) to right in front (90°: shadows
  // on the back wall, as in the original demo).
  page.lookHooks.lamp = () => { page.needsRedraw = true; page.limitLampTilt(); };
  page.lookHooks.lampTilt = () => { page.needsRedraw = true; page.wantedTilt = page.settings.lampTilt; };

  // (Two pages: the show, what you see and hear, and the room: the box,
  // the camera, the lamp and its shadows.)
  const lookPage = { ...page.panel.addPage('Show', page.settings, page.lookHooks), ...page.panel.addPage('Room', page.settings, page.lookHooks) };
  page.controls.push(...Object.values(lookPage));
  // HDR on the Info page, under Pixel size: it decides
  // how the screen shows the picture, and costs drawing time, more than it
  // is part of the scene.
  page.panel.startPage('Info');
  page.hdrSlider = page.panel.addSetting('hdrStrength', page.settings, { onChange: syncHdr });
  page.panel.startPage(null);
  page.controls.push(page.hdrSlider);
  showHdrControl();
  page.tiltSlider = lookPage.lampTilt;
  page.wantedTilt = page.settings.lampTilt;
  page.limitLampTilt();
  // (For the rest of the page.)
  Object.assign(page, { hdrChanged, hdrOn, showGrid, showHdrControl, syncHdr });
}
