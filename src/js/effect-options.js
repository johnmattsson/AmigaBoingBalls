// =============================================================================
// effect-options.js — how the effects (the Twist, the Bobs, the Tunnel) are
// drawn, shared by twist.js, effects.js and the renderers. (Its own file, with
// no imports, so the renderers can read it without importing twist.js, which
// imports them.)
// =============================================================================

export const twistOptions = { device: null, hdr: false, glow: true, strength: 1, wide: true, sharp: false, smooth: true, onFullScreen: null };
export const samples = () => (twistOptions.sharp || !twistOptions.smooth ? 1 : 4);
// (twistOptions.smooth = false: the edges of the Twist's bars and the
// Tunnel's walls not smoothed by drawing each pixel four times, to compare
// how they look and how fast they are: boing.smoothEffects in the console.
// What a drawer is made with, as one string: a drawer is made anew when it
// changes.)
export const effectLook = () => `${twistOptions.sharp} ${twistOptions.smooth}`;
