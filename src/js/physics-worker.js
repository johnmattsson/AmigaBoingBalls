// =============================================================================
// physics-worker.js — the physics on a thread of its own.
//
// Started by physics-client.js. Every message goes to the PhysicsHost (see
// physics-host.js); a step is answered with a snapshot.
// =============================================================================

import { PhysicsHost, transferables } from './physics-host.js';
import { PRESETS, PRESET_DEFAULTS } from './presets.js';

// Warming up, while the page is still loading: each preset is set up on a
// scratch copy of the physics and run for a moment, then thrown away. The
// browser turns the physics into fast machine code only once it has run
// for a while, part by part, and the parts a scene uses differ (1000 balls
// in a crowd, one big ball among small ones, …): without this, the first
// seconds of each scene would run many times slower than the rest, and
// the balls go into slow motion (SLOW) the first time Gas or Brownian is
// opened. At most WARM_UP_MS, and it runs side by side with the page's own
// loading (on this thread of its own), so it adds no waiting.
const WARM_UP_MS = 1200;
function warmUp() {
  const until = performance.now() + WARM_UP_MS;
  // (The heaviest first, the scenes whose first seconds slowed down most:
  // on a slow computer, where the time runs out early, they are done.)
  const first = ['gas', 'brownian'];
  const order = [...first, ...Object.keys(PRESETS).filter((name) => !first.includes(name))];
  for (const preset of order.map((name) => PRESETS[name])) {
    const s = { ...PRESET_DEFAULTS, ...preset.settings };
    const scratch = new PhysicsHost();
    scratch.handle({ op: 'init', balls: 0 });
    for (const [key, value] of [['ballSize', s.ballSize], ['ballBounce', s.ballType], ['wallBounce', s.wallType]]) {
      scratch.handle({ op: 'set', key, value });
    }
    // (The preset sets its scene up with the same calls as on the page.)
    const physics = new Proxy({}, { get: (_, name) => (...args) => scratch.handle({ op: 'call', name, args }) });
    if (preset.setup) preset.setup(physics);
    else physics.setBallCount(s.balls);
    for (let n = 0; n < 120 && performance.now() < until; n++) scratch.handle({ op: 'step', seconds: 1 / 120, gravity: s.gravity, budget: Infinity });
    if (performance.now() >= until) break;
  }
}
try { warmUp(); } catch (error) { console.warn('Physics warm-up:', error); }   // (only a warm-up: the demo runs without it)

const host = new PhysicsHost();
self.onmessage = (event) => {
  const snapshot = host.handle(event.data);
  if (snapshot) self.postMessage(snapshot, transferables(snapshot));
};
self.postMessage({ op: 'ready' });
