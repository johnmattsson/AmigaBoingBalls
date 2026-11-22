// =============================================================================
// page.js — the page around the demo: full screen, the controls that fade
// away when nothing is touched, and the screen kept awake.
//
// None of this knows about the balls: main.js starts each part and tells it
// the little it needs.
// =============================================================================

// ---- Full screen ----
// The zoom gadget at the right end of the title bar (or the F key) puts the
// scene on the whole screen, without title bar or frame; again (or Escape)
// goes back to the window. Only where the browser can do that (not on
// iPhones). (body.fullscreen switches the look, see style.css.)
export const fullScreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
export const canFullScreen = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export function toggleFullScreen() {
  if (fullScreenElement()) {
    (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
  } else {
    const page = document.documentElement;
    (page.requestFullscreen ?? page.webkitRequestFullscreen).call(page)?.catch?.(() => {});
  }
}
// Start it: the zoom gadget on the title bar, and `changed` called whenever
// the page goes to full screen or back (after the look was switched).
export function startFullScreen(changed) {
  if (canFullScreen) {
    const gadget = document.createElement('button');
    gadget.className = 'raised zoom-gadget';
    gadget.setAttribute('aria-label', 'Full screen');
    gadget.title = 'Full screen (F)';
    gadget.addEventListener('click', toggleFullScreen);
    document.querySelector('.app-bar').append(gadget);
  }
  function fullScreenChanged() {
    // (Only the page itself: the Twist window can be full screen on its own.)
    // With a mouse and room enough the title bar stays as it is in the window
    // (body.fullbar); on touch and narrow screens there is no bar in full
    // screen, only the controls (body.fullscreen: see style.css).
    const full = fullScreenElement() === document.documentElement;
    const keepBar = matchMedia('(min-width: 641px) and (pointer: fine)').matches;
    document.body.classList.toggle('fullscreen', full && !keepBar);
    document.body.classList.toggle('fullbar', full && keepBar);
    changed();
  }
  document.addEventListener('fullscreenchange', fullScreenChanged);
  document.addEventListener('webkitfullscreenchange', fullScreenChanged);
}

// ---- Fading the controls ----
// After a few seconds without the mouse moving, a touch or a key, the bars in
// the top-left corner and the Controls button fade away (the CSS of
// body.idle in style.css), leaving the scene alone, and any movement brings
// them back. Not while the pointer rests on them. (The open Controls window
// stays, like the other windows; the bar fades all the same.)
const IDLE_SECONDS = 3;
export function fadeIdleControls() {
  let idleTimer = 0;
  function wakeControls() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        const inUse = document.querySelector('.speed-bar:hover, .preset-bar:hover, .panel:hover');
        if (inUse) wakeControls(); else document.body.classList.add('idle');
      }, IDLE_SECONDS * 1000);
  }
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(type, wakeControls, { passive: true });
  }
  wakeControls();
}

// ---- The screen kept awake ----
// Keep the screen awake while the demo is shown (the Screen Wake Lock API,
// where the browser has it): a demo is for watching, so the screen should
// not dim or lock meanwhile. The browser lets go of the lock when the page
// is hidden; it is asked for again when the page comes back. (Some browsers
// only grant it after a click or a tap, so it is asked for then too.)
// While paused for more than a minute, the lock is let go (so a forgotten,
// paused demo doesn't keep the screen on), and taken again when it runs.
// Returns the check to call once a second: check(now, paused).
const PAUSED_AWAKE_SECONDS = 60;
export function keepScreenAwake() {
  let wakeLock = null, pausedSince = null, letGo = false;
  function checkPausedAwake(now, paused) {
    if (!paused) {
      pausedSince = null;
      if (letGo) { letGo = false; keepAwake(); }
    } else {
      pausedSince ??= now;
      if (wakeLock && now - pausedSince > PAUSED_AWAKE_SECONDS * 1000) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
        letGo = true;
      }
    }
  }
  let asking = false;
  async function keepAwake() {
    if (!navigator.wakeLock || document.hidden || wakeLock || asking) return;
    if (letGo) return;   // (paused for long: see checkPausedAwake)
    asking = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      // Not granted (low battery, say): the screen dims as usual.
    }
    asking = false;
  }
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  addEventListener('pointerdown', keepAwake);
  return checkPausedAwake;
}
