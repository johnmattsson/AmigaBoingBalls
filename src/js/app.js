// =============================================================================
// app.js — how the parts of the page reach each other.
//
// main.js starts the demo and runs its frames. The parts around it, each in
// a file of its own (the Info page in info.js, the room in room.js ...),
// need things of each other: the settings, the physics, whoever draws, a
// few functions. Each part says so in its first lines:
//
//     export const needs = ['settings', 'physics', 'showBallCount'];
//     export const gives = ['applyRoom', 'stage'];
//     export function setup(page) { … page.settings.gravity … }
//
// and main.js starts it with start(part). The `page` a part is handed lets
// it read (and where they change, set) exactly the things it needs, by
// name, and takes what it gives; anything else is an error on the spot. So
// a file's first lines tell what it depends on, and they are true.
//
// Everything shared is kept in `app`: main.js puts its own things there
// (see "What the parts may reach" there: always the value of the moment, so
// a part that asks for the renderer gets whoever draws now), and uses what
// the parts give by the same names.
// =============================================================================

export const app = {};

// Start a part of the page (a file with needs, gives and setup: see above).
export function start(part) {
  const allowed = new Set([...part.needs, ...part.gives]);
  const check = (name) => {
    if (!allowed.has(name)) throw new Error(`${part.name}.js reaches for "${String(name)}", which is not among its needs or gives`);
  };
  const page = new Proxy({}, {
    get(nothing, name) { check(name); return app[name]; },
    set(nothing, name, value) { check(name); app[name] = value; return true; },
  });
  part.setup(page);
  for (const name of part.gives) {
    if (!(name in app)) throw new Error(`${part.name}.js does not give "${name}", as it says`);
  }
}
