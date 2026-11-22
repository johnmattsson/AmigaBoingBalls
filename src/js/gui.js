// =============================================================================
// gui.js — the little settings panel in the top-right corner.
// (Replaces the dat.gui library.)
//
// It is styled as an AmigaOS 2.0 Workbench window: a light blue title bar,
// raised buttons, and sunken slider tracks with a raised knob. The colours
// and bevels live in style.css.
//
// Usage:
//   const panel = new Panel(document.body);
//   panel.addSlider('Speed', settings, 'speed', { min: -2, max: 2, step: 0.1 });
//
// The slider reads and writes settings.speed directly.
//
// Also here: showRequester(), a pop-up window with a text and an OK button
// (the Amiga called these "requesters"), and showWindow(), a window you can
// drag around by its title bar, for any content.
// =============================================================================

// Colours for the page, as in the scene (see SRGB_TO_P3 in renderer.js):
// every colour looks the same on every screen (a hex colour is sRGB, and the
// browser converts it exactly), except the four NCS elementary colours of
// the balls, which a wide-colour (Display P3) screen shows truer than sRGB
// can (see ELEMENTARY_IN_P3 in renderer.js).
import { SETTINGS, rangeOf, choicesOf, settingsOn } from './settings.js';

const ELEMENTARY_P3 = {
  '#c40233': 'color(display-p3 0.7529 0 0.2)',
  '#ffd300': 'color(display-p3 0.9922 0.8667 0)',
  '#0087bd': 'color(display-p3 0 0.5137 0.7569)',
  '#009f6b': 'color(display-p3 0 0.6353 0.4118)',
};
const P3_COLORS = globalThis.CSS?.supports?.('color', 'color(display-p3 1 0 0)') ?? false;
const p3Screen = globalThis.matchMedia?.('(color-gamut: p3)');
export function wide(hex) {
  return (P3_COLORS && p3Screen?.matches && ELEMENTARY_P3[hex.toLowerCase()]) || hex;
}


export class Panel {
  constructor(parent) {
    this.root = element('div', 'panel closed');   // closed by default, like before

    // Closed: just a button. Open: a window with a title bar (whose close
    // gadget closes it, as every window's) and the controls.
    const openButton = element('button', 'raised panel-open', 'Controls');
    const window = element('div', 'panel-window raised');
    // Its title bar, like every window's: a close gadget on the left, then
    // the title.
    const title = element('div', 'panel-title window-bar');
    const closeGadget = element('button', 'window-close raised');
    closeGadget.setAttribute('aria-label', 'Close');
    closeGadget.title = 'Close';
    title.append(closeGadget, element('span', '', 'Controls'), depthGadget(() => this.root));
    this.rows = element('div', 'panel-rows');
    this.pageOfRow = new Map();   // row → the page it belongs to (see addTabs)
    this.addingTo = null;         // the page that new rows are being added to
    window.append(title, this.rows);
    this.root.append(openButton, window);
    parent.append(this.root);

    this.isOpen = false;   // is the panel showing its controls right now?
    const setOpen = (open) => {
      this.isOpen = open;
      this.root.classList.toggle('closed', !open);
      openButton.style.display = open ? 'none' : '';
      if (open && this.place) this.moveTo(this.place.left, this.place.top);
      if (open) bringToFront(this.root); else activateFront();
    };
    openButton.addEventListener('click', () => setOpen(true));
    closeGadget.addEventListener('click', () => setOpen(false));

    // Like every window, it can be dragged by its title bar (not resized:
    // it is as tall as its rows, and they scroll if the screen is shorter),
    // and clicking it brings it in front of the other windows. It opens
    // top-right until it has been moved; then where it was put, until the
    // page is loaded again (`place`). When the
    // browser window gets smaller it is pulled back into view, as the other
    // windows are (see keepInView).
    // (Not on touch screens: there the panel is drawn larger and fills
    // most of the screen anyway; see style.css.)
    this.window = window;
    this.place = null;      // { left, top } once moved, else null (top-right)
    this.onMove = null;
    const touch = matchMedia('(pointer: coarse)');
    window.addEventListener('pointerdown', () => bringToFront(this.root));
    let grab = null;
    title.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || touch.matches) return;
      title.setPointerCapture(e.pointerId);
      const box = window.getBoundingClientRect();
      grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    });
    title.addEventListener('pointermove', (e) => {
      if (!grab) return;
      this.moveTo(inViewLeft(window, e.clientX - grab.x), inViewTop(e.clientY - grab.y));
    });
    title.addEventListener('lostpointercapture', () => {
      if (grab && this.place) this.onMove?.(this.place);
      grab = null;
    });
    addEventListener('resize', () => { if (this.place && this.isOpen) keepInView(window); });
  }

  // Put the panel's window at this place on the page (and remember it), or,
  // with null, back in the top-right corner.
  moveTo(left, top) {
    const w = this.window;
    if (left === null || matchMedia('(pointer: coarse)').matches) {
      this.place = null;
      w.classList.remove('moved');
      w.style.left = w.style.top = '';
      delete w.dataset.left; delete w.dataset.top;
      return;
    }
    this.place = { left, top };
    w.classList.add('moved');
    placeWindow(w, left, top);
    keepInView(w);   // (a place kept from a bigger window: pulled into view)
  }

  // Pages. To keep the panel short, its rows can be spread over several
  // pages, with a row of tabs at the top to switch between them:
  //
  //   panel.addTabs(['Scene', 'Show']);
  //   panel.startPage('Scene');   // rows added from here on are on "Scene"
  //   panel.startPage(null);      // rows added from here on are always shown
  //
  // onChange(name) is called whenever another page is shown.
  addTabs(names, onChange) {
    const row = element('div', 'panel-row panel-tabs');
    this.tabs = names.map((name) => {
      const tab = element('button', 'raised', name);
      tab.title = `The ${name} page`;
      tab.addEventListener('click', () => { this.showPage(name); onChange?.(name); });
      row.append(tab);
      return tab;
    });
    this.rows.append(row);
    this.page = names[0];
  }

  startPage(name) {
    this.addingTo = name;
  }

  showPage(name) {
    this.page = name;
    for (const tab of this.tabs) {
      tab.classList.toggle('chosen', tab.textContent === name);
      tab.setAttribute('aria-pressed', String(tab.textContent === name));   // (for screen readers)
    }
    for (const [row, page] of this.pageOfRow) row.style.display = page === name ? '' : 'none';
  }

  // A slider for a number between min and max.
  //   readOnly: true  → just displays the value as a filled gauge (used for FPS)
  //   onChange(value) → optional callback after the user changes it
  // Returns controls for main.js: refresh() redraws it after the value was
  // changed elsewhere, setMax() changes the range, `dragging` tells whether
  // the user is holding it right now, and `row` is its row in the panel.
  addSlider(label, target, key, options = {}) {
    const row = this.addRow(label);
    // The knob's width is only known once the panel is visible, so redraw
    // whenever it is clicked open.
    return { row, ...slider(row, target, key, options, this.root) };
  }

  // A row that just shows a piece of text, e.g. "1.23 ms".
  addReadout(label) {
    const row = this.addRow(label);
    const box = element('div', 'readout sunken');
    row.append(box);
    // (Only a real change touches the page: writing to it, even the same
    // text, can make the browser lay the panel out again.)
    let shown = null;
    return { row, box, set: (text) => { if (text !== shown) { shown = text; setNumberText(box, text); } } };
  }

  // An on/off box for a true/false value: shows a tick when on.
  // (The browser's own checkbox, painted as the Workbench's: see
  // input.checkbox in style.css. So the keyboard, touch and screen readers
  // work with it as with any checkbox.)
  //   onChange(value) → optional callback after it is switched
  addCheckbox(label, target, key, onChange) {
    const row = this.addRow(label);
    const box = element('input', 'checkbox raised');
    box.type = 'checkbox';
    box.setAttribute('aria-label', label);   // (its name, for screen readers)
    const show = () => { box.checked = Boolean(target[key]); };
    box.addEventListener('change', () => {
      target[key] = box.checked;
      onChange?.(target[key]);
    });
    row.append(box);
    show();
    return { row, refresh: show };
  }

  // A choice button: shows the choice made, and opens a Workbench
  // pull-down menu of all of them (see pullDown), as the preset's name does.
  //   choices: a list of { value, label }
  //   onChange(value) → optional callback after the user picks another
  // Returns `refresh()` to redraw it after the value was changed elsewhere.
  addCycle(label, target, key, choices, onChange) {
    const row = this.addRow(label);
    const button = element('button', 'choice raised');
    row.append(button);
    const menu = pullDown(button, () => button.closest('.panel-window') ?? row, choices, {
      current: () => Math.max(0, choices.findIndex((choice) => choice.value === target[key])),
      choose: (value) => { target[key] = value; onChange?.(target[key]); },
      shown: (choice) => {
        button.textContent = choice.label;
        button.setAttribute('aria-label', `${label}: ${choice.label}`);
      },
      title: label,
    });
    return { row, refresh: menu.show };
  }

  // Small buttons side by side on one row, sharing its width: [[label, onClick, title], …].
  addButtons(buttons) {
    const row = element('div', 'panel-row panel-buttons');
    for (const [label, onClick, title] of buttons) {
      const button = element('button', 'raised', label);
      if (title) button.title = title;
      button.addEventListener('click', onClick);
      row.append(button);
    }
    this.rows.append(row);
    if (this.addingTo) this.pageOfRow.set(row, this.addingTo);
    return { row };
  }

  // The rows of a page, made from the list of settings (see settings.js):
  // for each setting on it, in that order, a slider, a checkbox or a choice button (with its menu)
  // gadget, as its description says. `hooks` gives what the list can't
  // know, setting by setting: a function (called after the value changed),
  // or { onChange, when, choices, labels, step } (when: false leaves the row out,
  // where the setting means nothing on this device; choices and labels:
  // made by main.js).
  // Returns the controls by setting: { balls: …, gravity: … } (see addSlider
  // and the others for what each can do).
  addPage(page, target, hooks = {}) {
    this.startPage(page);
    const made = {};
    for (const key of settingsOn(page)) {
      const hook = typeof hooks[key] === 'function' ? { onChange: hooks[key] } : hooks[key] ?? {};
      if (hook.when === false) continue;
      if (SETTINGS[key].lineBefore) this.addLine();   // (a groove: a new group of rows)
      made[key] = this.addSetting(key, target, hook);
    }
    this.startPage(null);
    return made;
  }

  // One setting's row (on the page being added to). Any change through it,
  // and any refresh (after a change elsewhere), also updates which rows are
  // ghosted (see ghostRows).
  addSetting(key, target, { onChange, choices, labels, step } = {}) {
    const control = this.makeSetting(key, target, {
      onChange: (value) => { onChange?.(value); this.ghostRows(); }, choices, labels, step });
    const refresh = control.refresh;
    control.refresh = (...args) => { refresh(...args); this.ghostRows(); };
    const test = SETTINGS[key].ghostUnless;
    if (test) {
      (this.ghostTests ??= []).push({ row: control.row, live: () => test(target) });
      this.ghostRows();
    }
    return control;
  }

  // Ghosting, as the Workbench did with a gadget that can't be used just
  // now: dotted over in the window's grey, and switched off (for the mouse,
  // the keyboard and screen readers), but left in its place, so the rows
  // don't jump about. (Which rows, and when: ghostUnless in settings.js.)
  ghostRows() {
    for (const { row, live } of this.ghostTests ?? []) {
      const ghosted = !live();
      if (row.classList.contains('ghosted') === ghosted) continue;
      row.classList.toggle('ghosted', ghosted);
      for (const gadget of row.querySelectorAll('input, button')) gadget.disabled = ghosted;
    }
  }

  makeSetting(key, target, { onChange, choices, labels, step }) {
    const about = SETTINGS[key];
    if (about.levels) {
      // One row for several settings: each choice sets them all one way.
      // (Shown: the first whose settings all hold.)
      const holds = (level) => Object.entries(level.set).every(([k, v]) => target[k] === v);
      const all = {
        get value() { return Math.max(0, about.levels.findIndex(holds)); },
        set value(i) { Object.assign(target, about.levels[i].set); },
      };
      return this.addCycle(about.label, all, 'value',
        about.levels.map((level, i) => ({ value: i, label: level.label })), onChange && (() => onChange(target[key])));
    }
    if (about.offWith) {
      // One row for two settings: the first choice turns `offWith` off,
      // the others turn it on and set this one. (null stands for off.)
      const both = {
        get value() { return target[about.offWith] ? target[key] : null; },
        set value(value) {
          target[about.offWith] = value !== null;
          if (value !== null) target[key] = value;
        },
      };
      return this.addCycle(about.label, both, 'value',
        [{ value: null, label: about.offLabel }, ...choicesOf(key, labels ?? about.labels)], onChange);
    }
    if (about.choices) {
      return this.addCycle(about.label, target, key, choices ?? choicesOf(key, labels ?? about.labels), onChange);
    }
    if (typeof about.start === 'boolean') return this.addCheckbox(about.label, target, key, onChange);
    // (step: another step than the list's, where the device calls for one.)
    return this.addSlider(about.label, target, key, { ...rangeOf(key), ...(step ? { step } : {}), log: about.log, readOnly: about.gauge, onChange });
  }

  // A thin groove between groups of rows (on the page being added to).
  addLine() {
    const line = element('div', 'panel-line');
    this.rows.append(line);
    if (this.addingTo) this.pageOfRow.set(line, this.addingTo);
    return line;
  }

  addRow(label) {
    const row = element('div', 'panel-row');
    row.append(element('span', 'panel-label', label));
    this.rows.append(row);
    if (this.addingTo) this.pageOfRow.set(row, this.addingTo);
    return row;
  }
}

// Show a requester: a window with a title, some paragraphs of text and an
// OK button that closes it. Like every window it can be dragged and has a
// close gadget. Returns the window (see showWindow).
//   paragraphs: a list of strings; one starting with "# " becomes a heading.
//
// `paragraphs` can also be a list of parts, [{ name, paragraphs }, ...]: the
// requester then has a tab for each part at the top, and shows one at a time.
export function showRequester(title, paragraphs, onClose) {
  const content = element('div', 'requester');
  const body = element('div', 'requester-body');
  const show = (list) => {
    body.replaceChildren();
    for (const paragraph of list) {
      const isHeading = paragraph.startsWith('# ');
      body.append(element('p', isHeading ? 'requester-heading' : '', isHeading ? paragraph.slice(2) : paragraph));
    }
    body.scrollTop = 0;
  };
  const buttons = element('div', 'requester-buttons');
  const ok = element('button', 'raised', 'OK');
  buttons.append(ok);
  if (typeof paragraphs[0] === 'object') {
    const tabs = element('div', 'requester-tabs');
    const tabButtons = paragraphs.map((part, i) => {
      const tab = element('button', 'raised', part.name);
      tab.addEventListener('click', () => choose(i));
      return tab;
    });
    const choose = (i) => {
      tabButtons.forEach((tab, k) => tab.classList.toggle('chosen', k === i));
      show(paragraphs[i].paragraphs);
    };
    tabs.append(...tabButtons);
    body.classList.add('in-parts');   // (the same height for every part)
    content.append(tabs, body, buttons);
    choose(0);
  } else {
    show(paragraphs);
    content.append(body, buttons);
  }

  const shown = showWindow(title, content, onClose);
  ok.addEventListener('click', shown.close);
  return shown;
}

// Show a Workbench-style window with `content` (any element) inside. It has
// a close gadget in the top-left corner, like on the Amiga, and can be
// dragged by its title bar; clicking it brings it in front of other windows.
// onClose() is called when it is closed. Returns { close } to close it
// from code.
//
// With `onResize`, the window also gets a sizing gadget in its bottom-right
// corner. Dragging it calls onResize(width, height) with the size the
// content should take (in CSS pixels); the content resizes itself.
//
// With `onZoom`, the title bar also gets a zoom gadget at its right end (as
// on the Amiga: a box in a box), which calls onZoom().
//
// Returns { close, element }. Setting onEscape on it lets Escape do
// something else first: if onEscape() returns true, the window stays open.
let frontLayer = 10;   // each window that comes to the front gets the next layer
const layered = new Set();   // every window that has been given a layer
// (The window brought to the front is the active one: see --bar in style.css.)
const bringToFront = (element) => {
  layered.add(element);
  element.style.zIndex = ++frontLayer;
  for (const other of layered) other.classList.toggle('active', other === element);
};
// Behind all the others: it stays where it is in the layers, and every
// other window (still there) comes in front of it, in the order they were in.
function sendToBack(element) {
  bringToFront(element);
  const others = [...layered].filter((other) => other !== element && other.isConnected)
    .sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex));
  for (const other of others) bringToFront(other);   // (the last, the one now in front, is the active one)
}
// After a window closed: the one now in front (and still shown) is the
// active one.
function activateFront() {
  const shown = [...layered].filter((w) => w.isConnected && !w.classList.contains('closed'));
  const front = shown.reduce((a, b) => (a && Number(a.style.zIndex) > Number(b.style.zIndex) ? a : b), null);
  for (const other of layered) other.classList.toggle('active', other === front);
}
// A window's depth gadget (see .window-depth in style.css).
function depthGadget(of) {
  const gadget = element('button', 'window-depth');
  gadget.setAttribute('aria-label', 'To back');
  gadget.title = 'Behind the other windows';
  // (After the click has brought the window to the front, as any click on it does.)
  gadget.addEventListener('click', () => setTimeout(() => sendToBack(of()), 0));
  return gadget;
}
const openWindows = [];   // every window that is open: { element, close }

// Close the window that is in front of the others. Returns false if no
// window is open. (Used for the Escape key.)
export function closeFrontWindow() {
  if (!openWindows.length) return false;
  const layer = (entry) => Number(entry.element.style.zIndex);
  const front = openWindows.reduce((front, entry) => (layer(entry) > layer(front) ? entry : front));
  if (!front.onEscape?.()) front.close();
  return true;
}

// Each window remembers where it was put (data-left, data-top: where it
// was opened, or dragged to). When the browser window gets smaller, it is
// pulled back so that at least its title bar stays in view; when it grows
// again, the window goes back towards its own place. So however the size
// jumps about meanwhile (going in and out of full screen, say, which
// animates), every window ends up where the final size allows.
// (The same limits as for dragging, so a window put partly off the left
// edge, say, comes back exactly there.)
const inViewLeft = (w, left) => Math.min(innerWidth - 40, Math.max(40 - w.offsetWidth, left));
const inViewTop = (top) => Math.min(innerHeight - 16, Math.max(0, top));
export function keepInView(w) {
  const left = Number(w.dataset.left ?? w.offsetLeft), top = Number(w.dataset.top ?? w.offsetTop);
  w.style.left = `${inViewLeft(w, left)}px`;
  w.style.top = `${inViewTop(top)}px`;
}
// (Put a window somewhere, and remember that as its place.)
function placeWindow(w, left, top) {
  w.dataset.left = left;
  w.dataset.top = top;
  w.style.left = `${left}px`;
  w.style.top = `${top}px`;
}
addEventListener('resize', () => {
  for (const { element: w } of openWindows) keepInView(w);
});

export function showWindow(title, content, onClose, onResize, onZoom) {
  const window = element('div', 'window raised');
  const bar = element('div', 'panel-title window-bar');
  const closeGadget = element('button', 'window-close raised');
  closeGadget.setAttribute('aria-label', 'Close');
  bar.append(closeGadget, element('span', '', title));
  let zoomGadget = null;
  if (onZoom) {
    zoomGadget = element('button', 'window-zoom zoom-gadget raised');
    zoomGadget.setAttribute('aria-label', 'Full screen');
    zoomGadget.title = 'Full screen';
    zoomGadget.addEventListener('click', onZoom);
    bar.append(zoomGadget);
  }
  bar.append(depthGadget(() => window));
  window.append(bar, content);
  document.body.append(window);

  // Start in the middle of the screen; where another window already sits
  // there, a little down and to the right of it (as many times as needed),
  // so each new window shows its title bar.
  let left = Math.max(0, (innerWidth - window.offsetWidth) / 2), top = Math.max(0, (innerHeight - window.offsetHeight) / 2);
  const taken = (x, y) => openWindows.some(({ element: other }) =>
    Math.abs(other.offsetLeft - x) < 4 && Math.abs(other.offsetTop - y) < 4);
  for (let tries = 0; tries < 20 && taken(left, top); tries++) {
    left = Math.min(left + 24, Math.max(0, innerWidth - window.offsetWidth));
    top = Math.min(top + 24, Math.max(0, innerHeight - window.offsetHeight));
  }
  placeWindow(window, left, top);

  const entry = { element: window };
  const close = () => {
    window.remove();
    openWindows.splice(openWindows.indexOf(entry), 1);
    layered.delete(window);
    activateFront();
    onClose?.();
  };
  entry.close = close;
  openWindows.push(entry);
  closeGadget.addEventListener('click', close);
  const toFront = () => bringToFront(window);
  window.addEventListener('pointerdown', toFront);
  toFront();

  // Dragging: while the title bar is held, the window follows the pointer.
  let grab = null;   // where on the window the pointer took hold
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    bar.setPointerCapture(e.pointerId);
    grab = { x: e.clientX - window.offsetLeft, y: e.clientY - window.offsetTop };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!grab) return;
    // Keep at least the title bar on screen.
    placeWindow(window, inViewLeft(window, e.clientX - grab.x), inViewTop(e.clientY - grab.y));
  });
  bar.addEventListener('lostpointercapture', () => { grab = null; });

  // Resizing: while the sizing gadget is held, the content grows or shrinks
  // by as much as the pointer has moved.
  if (onResize) {
    const sizeGadget = element('div', 'window-size');
    window.append(sizeGadget);
    let held = null;   // pointer position and content size when the gadget was grabbed
    sizeGadget.addEventListener('pointerdown', (e) => {
      sizeGadget.setPointerCapture(e.pointerId);
      held = { x: e.clientX, y: e.clientY, width: content.offsetWidth, height: content.offsetHeight };
    });
    sizeGadget.addEventListener('pointermove', (e) => {
      if (held) onResize(Math.max(120, held.width + e.clientX - held.x), Math.max(120, held.height + e.clientY - held.y));
    });
    sizeGadget.addEventListener('lostpointercapture', () => { held = null; });
  }

  entry.element = window;
  return entry;
}

// Small helper: create an element with a class name and optional text.
// Text with numbers in it, for the readouts and sliders. In the Amiga font
// the digits are not all equally wide (a 1 is narrower, a 4 wider), so a
// right-aligned number would shift sideways as its digits change. Each
// digit gets a box of the same width (that of a 0), as on an Amiga screen.
function setNumberText(target, text) {
  if (!/[0-9]/.test(text)) { target.textContent = text; return; }
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  target.innerHTML = safe.replace(/[0-9]/g, '<span class="digit">$&</span>');
}

function element(tag, className, text = '') {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

// A slider added to `row`: a sunken track with a raised knob (or, if
// readOnly, a gauge that fills up), and the number next to it. It reads and
// writes target[key]. Shared by the panel and the speed bar.
// (log: the knob's place goes with the value's logarithm, so each step along
// the track multiplies the value: for a range like 1 … 4000, where 1 to 10
// matters as much as 400 to 4000. Values above 100 are rounded to two
// figures.)
//
// The slider is the browser's own (an <input type="range">), painted as the
// Workbench's proportional gadget (see input.slider in style.css), so that
// dragging, touch and screen readers work as with any slider. It runs from
// 0 to KNOB_STEPS along the track; the value is worked out from there, and
// the knob then sits where that value is (so it moves in the setting's own
// steps). The keys move it as before: the arrows a step (a hundredth of
// the way at least), Page Up/Down a tenth of the way, Home and End to the
// ends.
const KNOB_STEPS = 1000;
const ZERO_PART = 0.05;
function slider(row, target, key, { min, max, step = 0.01, readOnly = false, log = false, onChange } = {}, redrawOn = null) {
    // (A log track that starts at 0, as Balls does: 0 has no logarithm, so
    // the first ZERO_PART of the track is 0, and the steps that multiply
    // begin after it, at the first step.)
    const zero = log && min <= 0 ? ZERO_PART : 0;
    const low = log && min <= 0 ? step : min;
    const toFraction = (value) => {
      if (!log) return (value - min) / (max - min);
      if (value < low) return 0;
      return zero + (1 - zero) * Math.log(value / low) / Math.log(max / low);
    };
    const toValue = (fraction) => {
      if (!log) return min + fraction * (max - min);
      if (zero && fraction < zero / 2) return 0;
      const value = low * (max / low) ** Math.max(0, (fraction - zero) / (1 - zero));
      const round = value > 100 ? 10 ** (Math.floor(Math.log10(value)) - 1) : 1;
      return Math.min(max, Math.round(value / round) * round);
    };
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const onSteps = (value) => Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(decimals));

    // Read-only values are shown as a gauge that fills up.
    let track, marker = null;
    if (readOnly) {
      track = element('div', 'slider sunken');
      marker = element('div', 'slider-fill');
      track.append(marker);
    } else {
      track = element('input', 'slider sunken');
      track.type = 'range';
      track.min = '0';
      track.max = String(KNOB_STEPS);
      track.step = '1';
      track.setAttribute('aria-label', row.querySelector('.panel-label, .speed-label')?.textContent ?? '');
    }
    const number = element('div', 'slider-number sunken');
    row.append(track, number);

    let held = false;   // is the user holding this slider right now?
    // (As with readouts: only real changes touch the page. Measuring the
    // track's width makes the browser lay the page out first, so that too
    // is only done when needed.)
    let shownFraction = null, shownText = null;
    const show = (force) => {
      const value = target[key];
      const fraction = Math.min(1, Math.max(0, toFraction(value)));
      if (fraction !== shownFraction || force === true) {
        shownFraction = fraction;
        if (readOnly) {
          marker.style.width = `${fraction * 100}%`;
        } else {
          track.value = String(Math.round(fraction * KNOB_STEPS));
          // The knob is a fifth or so of the track, as on the Amiga (the
          // browser's knob can't be sized in % of its track, so in pixels).
          if (track.clientWidth) track.style.setProperty('--knob', `${Math.round(track.clientWidth * 0.22) + 4}px`);
        }
      }
      const text = value.toFixed(decimals);
      if (text !== shownText) {
        shownText = text;
        setNumberText(number, text);
        if (!readOnly) track.setAttribute('aria-valuetext', text);   // (for screen readers: the value, not the knob's place)
      }
    };

    if (!readOnly) {
      const set = (value) => {
        if (value === target[key]) { show(true); return; }   // (the knob back on the value's place)
        target[key] = value;
        show();
        onChange?.(value);
      };
      track.addEventListener('input', () => set(onSteps(toValue(Number(track.value) / KNOB_STEPS))));
      track.addEventListener('pointerdown', () => { held = true; });
      addEventListener('pointerup', () => { held = false; });
      addEventListener('pointercancel', () => { held = false; });
      track.addEventListener('keydown', (e) => {
        const at = toFraction(target[key]);
        const nudge = (by) => toValue(Math.min(1, Math.max(0, at + by)));
        const small = Math.max(step, log ? 0 : (max - min) / 100);
        // (On a log track a hundredth of the way, but always at least a step.)
        const up = log ? Math.max(nudge(0.01), target[key] + step) : target[key] + small;
        const down = log ? Math.min(nudge(-0.01), target[key] - step) : target[key] - small;
        const value = {
          ArrowRight: up, ArrowUp: up, ArrowLeft: down, ArrowDown: down,
          PageUp: nudge(0.1), PageDown: nudge(-0.1), Home: min, End: max,
        }[e.key];
        if (value === undefined) return;
        e.preventDefault();
        set(onSteps(value));
      });
    }

    redrawOn?.addEventListener('click', () => show(true));   // (the track's width is known now)
    show();
    return {
      refresh: show,
      setMax: (newMax) => { if (newMax !== max) { max = newMax; show(); } },
      get dragging() { return held; },
    };
}

// The speed bar: the speed of time, always on screen in the top-left
// corner, with three buttons: run backwards, pause/carry on, run forwards.
// `buttons` is a list of [label, onClick].
export function addSpeedBar(parent, target, key, options, buttons) {
  const bar = element('div', 'speed-bar raised');
  for (const [label, onClick] of buttons) {
    const button = element('button', 'raised', label);
    button.addEventListener('click', onClick);
    bar.append(button);
  }
  bar.append(element('span', 'speed-label', 'Speed'));
  parent.append(bar);
  return slider(bar, target, key, options, null);
}

// The preset bar: the ready-made scenes, always on screen below the speed
// bar: < and > step through them, the name in the middle opens the preset
// menu, and Restart starts the scene again.
//
// The menu is a Workbench pull-down menu: every preset by name, and a tick
// by the one chosen.
// Clicking one chooses it; clicking anywhere else, or Escape, closes it.
// From the keyboard: Enter on the name opens it, the arrow keys (and Home,
// End) go up and down, Enter or Space chooses.
export function addPresetBar(parent, target, key, choices, onChange, onRestart) {
  const bar = element('div', 'preset-bar raised');
  const back = element('button', 'raised', '<');
  const name = element('button', 'raised preset-name');
  const forward = element('button', 'raised', '>');
  const restart = element('button', 'raised preset-restart', 'Restart');
  name.title = 'All the presets';
  const menu = pullDown(name, () => bar, choices, {
    current: () => Math.max(0, choices.findIndex((choice) => choice.value === target[key])),
    choose: (value) => { target[key] = value; onChange(target[key]); },
    shown: (choice) => { name.textContent = choice.label; },
    title: 'Presets',
  });
  const step = (by) => menu.choose(choices[(menu.current() + by + choices.length) % choices.length].value);

  back.addEventListener('click', () => step(-1));
  forward.addEventListener('click', () => step(1));
  restart.addEventListener('click', onRestart);
  bar.append(back, name, forward, restart);
  parent.append(bar);
  menu.show();
  return { refresh: menu.show, close: () => menu.close(false) };
}

// A Workbench pull-down menu under a button: every choice by name, a tick
// by the one chosen, and (choice.lineAfter) a line after it, as Workbench
// menus had between groups. Clicking the button opens it; clicking a
// choice chooses it; clicking anywhere else, or Escape, closes it. From
// the keyboard: Enter, Space or the down arrow on the button opens it, the
// arrow keys (and Home, End) go up and down, Enter or Space chooses.
//   place() → the element the menu is put in (and placed within): one
//     that doesn't cut off what reaches out of it
//   current() → the index of the choice made; choose(value) after a
//     choice; shown(choice) to show the choice made on the button
let pullDowns = 0;   // (how many menus so far: each its own id)
function pullDown(button, place, choices, { current, choose, shown, title }) {
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const menu = element('div', 'pull-menu raised');
  menu.id = `pull-menu-${++pullDowns}`;
  button.setAttribute('aria-controls', menu.id);   // (which menu is this button's: for screen readers)
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', title);
  const items = choices.map((choice) => {
    const item = element('button', 'pull-item');
    item.setAttribute('role', 'menuitemradio');
    item.tabIndex = -1;
    item.append(element('span', 'pull-item-tick'), element('span', 'pull-item-name', choice.label));
    item.addEventListener('click', () => { close(true); pick(choice.value); });
    item.addEventListener('pointerenter', () => item.focus({ preventScroll: true }));
    return item;
  });
  choices.forEach((choice, i) => {
    menu.append(items[i]);
    if (choice.lineAfter) {
      const line = element('div', 'pull-menu-line');   // (only to look at: the keys pass over it)
      line.setAttribute('role', 'separator');
      menu.append(line);
    }
  });
  const show = () => {
    shown(choices[current()]);
    items.forEach((item, i) => item.setAttribute('aria-checked', String(i === current())));
  };
  const pick = (value) => { choose(value); show(); };

  const isOpen = () => menu.classList.contains('open');
  function open() {
    // Under the button, as wide as it at least: placed within `place`, by
    // the button's own offsets (which a scaled-up bar or panel doesn't
    // change), and above the button instead where there's no room below.
    show();   // (the tick where the choice is now, even if it was changed elsewhere)
    const where = place();
    where.append(menu);
    let left = 0, top = 0;
    for (let at = button; at && at !== where; at = at.offsetParent) { left += at.offsetLeft; top += at.offsetTop; }
    menu.style.minWidth = `${button.offsetWidth}px`;
    menu.style.left = `${left}px`;
    menu.classList.add('open');
    const below = button.getBoundingClientRect().bottom + menu.getBoundingClientRect().height + 4 <= innerHeight;
    menu.style.top = below ? `${top + button.offsetHeight + 1}px` : `${top - menu.offsetHeight - 1}px`;
    button.setAttribute('aria-expanded', 'true');
    items[current()].focus({ preventScroll: true });
    addEventListener('pointerdown', outside, true);
  }
  // (backToButton: where the keyboard goes on from, after a choice or Escape)
  function close(backToButton) {
    if (!isOpen()) return;
    menu.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    if (backToButton) button.focus({ preventScroll: true });
  }
  function outside(e) { if (!menu.contains(e.target) && e.target !== button) close(false); }
  button.addEventListener('click', () => (isOpen() ? close(true) : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !isOpen()) { e.preventDefault(); open(); }
  });
  menu.addEventListener('keydown', (e) => {
    const at = items.indexOf(document.activeElement);
    const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go !== undefined) {
      items[(go + items.length) % items.length].focus({ preventScroll: true });
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close(e.key === 'Escape');
      if (e.key === 'Tab') return;   // (Tab goes on as usual)
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (at >= 0) items[at].click();
    } else {
      return;   // (other keys work as everywhere)
    }
    // (Handled here: not also by the page's own keys, such as Space for
    // pause or Escape for closing a window.)
    e.preventDefault();
    e.stopPropagation();
  });
  return { show, close, current, choose: pick };
}
