// =============================================================================
// gui.js — the little settings panel in the top-right corner.
// (Replaces the dat.gui library.)
//
// It is styled as an AmigaOS 2.0 Workbench window: a light blue title bar,
// raised buttons, and sunken slider tracks with a raised knob. The colours
// and bevels live in the <style> block of index.html.
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

// Wide colour (Display P3), as in the scene: the same numbers as the hex
// colour '#rrggbb', but taken as Display P3, so they come out deeper on a
// wide-colour screen. (A plain hex colour is converted to look exactly as in
// sRGB.) Where the browser doesn't know P3 colours, the hex colour itself.
const P3_COLORS = globalThis.CSS?.supports?.('color', 'color(display-p3 1 0 0)') ?? false;
export function wide(hex) {
  if (!P3_COLORS) return hex;
  const n = parseInt(hex.slice(1), 16);
  const part = (shift) => (((n >> shift) & 255) / 255).toFixed(4);
  return `color(display-p3 ${part(16)} ${part(8)} ${part(0)})`;
}

export class Panel {
  constructor(parent) {
    this.root = element('div', 'panel closed');   // closed by default, like before

    // Closed: just a button. Open: a window with a title bar, the controls
    // and a Close button.
    const openButton = element('button', 'raised panel-open', 'Open Controls');
    const window = element('div', 'panel-window raised');
    const title = element('div', 'panel-title', 'Controls');
    this.rows = element('div', 'panel-rows');
    this.pageOfRow = new Map();   // row → the page it belongs to (see addTabs)
    this.addingTo = null;         // the page that new rows are being added to
    const closeArea = element('div', 'panel-close');
    const closeButton = element('button', 'raised', 'Close');
    closeArea.append(closeButton);
    window.append(title, this.rows, closeArea);
    this.root.append(openButton, window);
    parent.append(this.root);

    this.isOpen = false;   // is the panel showing its controls right now?
    const setOpen = (open) => {
      this.isOpen = open;
      this.root.classList.toggle('closed', !open);
      openButton.style.display = open ? 'none' : '';
    };
    openButton.addEventListener('click', () => setOpen(true));
    closeButton.addEventListener('click', () => setOpen(false));
  }

  // Pages. To keep the panel short, its rows can be spread over several
  // pages, with a row of tabs at the top to switch between them:
  //
  //   panel.addTabs(['Scene', 'Look']);
  //   panel.startPage('Scene');   // rows added from here on are on "Scene"
  //   panel.startPage(null);      // rows added from here on are always shown
  //
  // onChange(name) is called whenever another page is shown.
  addTabs(names, onChange) {
    const row = element('div', 'panel-row panel-tabs');
    this.tabs = names.map((name) => {
      const tab = element('button', 'raised', name);
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
    for (const tab of this.tabs) tab.classList.toggle('chosen', tab.textContent === name);
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
    return { row, box, set: (text) => { box.textContent = text; } };
  }

  // An on/off box for a true/false value: shows a tick when on.
  //   onChange(value) → optional callback after it is switched
  addCheckbox(label, target, key, onChange) {
    const row = this.addRow(label);
    const box = element('button', 'checkbox raised');
    box.setAttribute('role', 'checkbox');
    const show = () => {
      box.textContent = target[key] ? '✔' : '';
      box.setAttribute('aria-checked', String(target[key]));
    };
    box.addEventListener('click', () => {
      target[key] = !target[key];
      show();
      onChange?.(target[key]);
    });
    row.append(box);
    show();
    return { row, refresh: show };
  }

  // A "cycle gadget": a button that shows one of several choices and steps
  // to the next one each time it is clicked — the Amiga's space-saving
  // answer to the drop-down menu. Shift-click or right-click steps backwards.
  //   choices: a list of { value, label }
  //   onChange(value) → optional callback after the user picks another
  // Returns `refresh()` to redraw it after the value was changed elsewhere.
  addCycle(label, target, key, choices, onChange) {
    const row = this.addRow(label);
    const button = element('button', 'cycle raised');
    const mark = element('span', 'cycle-mark', '\u21bb');   // ↻
    const text = element('span', 'cycle-text');
    button.append(mark, text);
    const current = () => Math.max(0, choices.findIndex((choice) => choice.value === target[key]));
    const show = () => { text.textContent = choices[current()].label; };
    const step = (by) => {
      target[key] = choices[(current() + by + choices.length) % choices.length].value;
      show();
      onChange?.(target[key]);
    };
    button.addEventListener('click', (e) => step(e.shiftKey ? -1 : 1));
    button.addEventListener('contextmenu', (e) => { e.preventDefault(); step(-1); });
    row.append(button);
    show();
    return { row, refresh: show };
  }

  // A plain button across the whole panel.
  addButton(label, onClick) {
    const row = element('div', 'panel-row');
    const button = element('button', 'raised', label);
    button.addEventListener('click', onClick);
    row.append(button);
    this.rows.append(row);
    if (this.addingTo) this.pageOfRow.set(row, this.addingTo);
    return { row };
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

// When the browser window gets smaller, pull every window back so that at
// least its title bar stays in view.
addEventListener('resize', () => {
  for (const { element: w } of openWindows) {
    w.style.left = `${Math.max(0, Math.min(innerWidth - 60, w.offsetLeft))}px`;
    w.style.top = `${Math.max(0, Math.min(innerHeight - 16, w.offsetTop))}px`;
  }
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
  window.append(bar, content);
  document.body.append(window);

  // Start in the middle of the screen.
  window.style.left = `${Math.max(0, (innerWidth - window.offsetWidth) / 2)}px`;
  window.style.top = `${Math.max(0, (innerHeight - window.offsetHeight) / 2)}px`;

  const entry = { element: window };
  const close = () => {
    window.remove();
    openWindows.splice(openWindows.indexOf(entry), 1);
    onClose?.();
  };
  entry.close = close;
  openWindows.push(entry);
  closeGadget.addEventListener('click', close);
  const toFront = () => { window.style.zIndex = ++frontLayer; };
  window.addEventListener('pointerdown', toFront);
  toFront();

  // Dragging: while the title bar is held, the window follows the pointer.
  let grab = null;   // where on the window the pointer took hold
  bar.addEventListener('pointerdown', (e) => {
    if (e.target === closeGadget || e.target === zoomGadget) return;
    bar.setPointerCapture(e.pointerId);
    grab = { x: e.clientX - window.offsetLeft, y: e.clientY - window.offsetTop };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!grab) return;
    // Keep at least the title bar on screen.
    window.style.left = `${Math.min(innerWidth - 40, Math.max(40 - window.offsetWidth, e.clientX - grab.x))}px`;
    window.style.top = `${Math.min(innerHeight - 16, Math.max(0, e.clientY - grab.y))}px`;
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
function element(tag, className, text = '') {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

// A slider added to `row`: a sunken track with a raised knob (or, if
// readOnly, a gauge that fills up), and the number next to it. It reads and
// writes target[key]. Shared by the panel and the speed bar.
function slider(row, target, key, { min, max, step = 0.01, readOnly = false, onChange } = {}, redrawOn = null) {
    const track = element('div', 'slider sunken');
    // Read-only values are shown as a gauge that fills up; adjustable ones
    // get a knob you can drag, like an Amiga "proportional gadget".
    const marker = element('div', readOnly ? 'slider-fill' : 'slider-knob raised');
    track.append(marker);
    const number = element('div', 'slider-number sunken');
    row.append(track, number);

    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    let held = false;   // is the user holding this slider right now?
    const show = () => {
      const value = target[key];
      const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));
      if (readOnly) {
        marker.style.width = `${fraction * 100}%`;
      } else {
        // The knob moves from the left end to the right end of the track,
        // so its left edge travels across (100 % − knob width).
        marker.style.left = `calc(${fraction} * (100% - ${marker.offsetWidth || 0}px))`;
      }
      number.textContent = value.toFixed(decimals);
    };

    if (!readOnly) {
      // Turn a mouse/finger position on the track into a value.
      const setFromPointer = (e) => {
        const rect = track.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const value = Number((Math.round((min + fraction * (max - min)) / step) * step).toFixed(decimals));
        if (value === target[key]) return;   // only react to real changes
        target[key] = value;
        show();
        onChange?.(value);
      };
      track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId);
        held = true;
        setFromPointer(e);
      });
      track.addEventListener('lostpointercapture', () => { held = false; });
      track.addEventListener('pointermove', (e) => {
        if (track.hasPointerCapture(e.pointerId)) setFromPointer(e);
      });
    }

    redrawOn?.addEventListener('click', show);
    show();
    return {
      refresh: show,
      setMax: (newMax) => { max = newMax; show(); },
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
// bar: < and > step through them, the name in the middle steps on too
// (shift-click or right-click: back), and Restart starts the scene again.
export function addPresetBar(parent, target, key, choices, onChange, onRestart) {
  const bar = element('div', 'preset-bar raised');
  const back = element('button', 'raised', '<');
  const name = element('button', 'raised preset-name');
  const forward = element('button', 'raised', '>');
  const restart = element('button', 'raised preset-restart', 'Restart');
  const current = () => Math.max(0, choices.findIndex((choice) => choice.value === target[key]));
  const show = () => { name.textContent = choices[current()].label; };
  const step = (by) => {
    target[key] = choices[(current() + by + choices.length) % choices.length].value;
    show();
    onChange(target[key]);
  };
  back.addEventListener('click', () => step(-1));
  forward.addEventListener('click', () => step(1));
  name.addEventListener('click', (e) => step(e.shiftKey ? -1 : 1));
  name.addEventListener('contextmenu', (e) => { e.preventDefault(); step(-1); });
  restart.addEventListener('click', onRestart);
  bar.append(back, name, forward, restart);
  parent.append(bar);
  show();
  return { refresh: show };
}
