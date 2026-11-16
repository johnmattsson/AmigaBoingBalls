// =============================================================================
// physics-worker.js — the physics on a thread of its own.
//
// Started by physics-client.js. Every message goes to the PhysicsHost (see
// physics-host.js); a step is answered with a snapshot.
// =============================================================================

import { PhysicsHost, transferables } from './physics-host.js';

const host = new PhysicsHost();
self.onmessage = (event) => {
  const snapshot = host.handle(event.data);
  if (snapshot) self.postMessage(snapshot, transferables(snapshot));
};
self.postMessage({ op: 'ready' });
