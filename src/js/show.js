// =============================================================================
// show.js — the timeline: what is shown, part after part.
//
// Everything the Preset button offers is a show. Most have one part that
// never ends: a scene of balls. The Megademo (see presets.js) has many,
// each for some seconds, with a black curtain drawn for a moment between
// them; after the last it starts again.
//
// A part:
//   seconds   – how long it is shown (none: for ever)
//   settings, setup, lookDown – as for a preset, on top of the show's own
//               settings (an effect is a backdrop like any other: see
//               BACKDROPS in renderer.js)
//   cues      – [{ at, set }]: `at` seconds into the part, these settings
//               change (only ones that need no new balls: see CUE_SETTINGS)
//
// The show's time is the demo's own: Speed makes it faster, and it waits
// while paused.
//
// (No page here. main.js gives the Show what it works with:
//   scene(part, keep)  – set up a part; `keep`: settings to keep
//   change(settings)   – change settings in the running scene (a cue)
//   curtain(drawn)     – draw the black curtain, or open it
//   speed()            – the Speed setting now)
// =============================================================================

export const CURTAIN_SECONDS = 0.5;   // (the curtain closes this long before a part ends)

// What a cue may change: the look and the sound, gravity and the kinds of
// bounce. (Not the number or size of the balls, nor the room: those need a
// new scene, which is a new part.)
export const CUE_SETTINGS = ['gravity', 'ballType', 'wallType', 'trails', 'copper', 'backdrop', 'scroller', 'credits', 'lampOn', 'shadows',
  'autoCamera', 'camMove', 'lamp', 'lampTilt', 'sound', 'wallSound', 'music', 'track'];

export class Show {
  constructor(page) {
    this.page = page;
    this.parts = null;      // of the show that is on (null: none yet)
    this.settings = {};     // ... and the settings all its parts share
    this.index = 0;         // which part is on
    this.time = 0;          // seconds into it
    this.cuesDone = 0;      // how many of its cues have happened
  }

  // Does the show change by itself (more than one part)?
  get moves() { return this.parts !== null && this.parts.length > 1; }

  // Start a show: a preset. `keep`: settings to keep as they are (for a
  // show of one part: see restartPreset in main.js).
  start(preset, keep = {}) {
    this.end();
    this.parts = preset.parts ?? [preset];
    this.settings = preset.parts ? (preset.settings ?? {}) : {};
    this.showPart(0, keep);
  }

  // End it: the curtain open. (The scene stays.)
  end() {
    if (!this.parts) return;
    this.parts = null;
    this.page.curtain(false);
  }

  showPart(index, keep = {}) {
    const part = this.parts[index];
    this.index = index;
    this.time = 0;
    this.cuesDone = 0;
    this.page.scene(this.parts.length > 1 ? { ...part, settings: { ...this.settings, ...part.settings } } : part, keep);
  }

  // The show's time since part `index` began (null before it): for what
  // runs along with the show from that part on, the Megademo's tune.
  timeSince(index) {
    if (!this.moves || this.index < index) return null;
    let seconds = this.time;
    for (let k = index; k < this.index; k++) seconds += this.parts[k].seconds;
    return seconds;
  }

  // So many seconds of the show's time have passed.
  tick(seconds) {
    if (!this.moves) return;
    this.time += seconds;
    let part = this.parts[this.index];
    if (this.time >= (part.seconds ?? Infinity)) {
      // (The Speed set meanwhile stays: the show is one piece.)
      this.showPart((this.index + 1) % this.parts.length, { speed: this.page.speed() });
      part = this.parts[this.index];
    }
    const cues = part.cues ?? [];
    while (this.cuesDone < cues.length && this.time >= cues[this.cuesDone].at) {
      this.page.change(cues[this.cuesDone].set);
      this.cuesDone++;
    }
    this.page.curtain(this.time >= (part.seconds ?? Infinity) - CURTAIN_SECONDS);
  }
}
