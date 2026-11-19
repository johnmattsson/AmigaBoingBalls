// =============================================================================
// audio.js — the "boing" sounds, using the browser's built-in Web Audio API.
// (Replaces the howler.js library.)
//
// The sounds were recorded from the original Amiga demo and restored: the
// two stereo channels (the same sound, out of step) were lined up into one,
// low rumble and inaudible high noise removed, and a gentle lift added
// around 2 kHz so the boing carries on small speakers. Each boing is then
// placed left or right in code, depending on where the bounce happens.
//
// WHEN THE SPEAKERS ARE SWITCHED ON
// Browsers don't allow a page to make noise until the visitor has interacted
// with it. We go one step further and don't connect to the speakers at all
// until the first click, tap or key press. Opening an audio connection can
// make some sound drivers click (on Windows especially), and some browsers
// allow sites you visit often to open it right away, on every page load.
// The sound files are loaded and decoded beforehand with an "offline"
// decoder, which never touches the speakers.
// =============================================================================

// With many balls, lots of boings can happen at once. Playing them all would
// pile up into a loud, distorted mess, so at most this many play together;
// extra ones are skipped (nobody can pick them out in the crowd anyway).
const MAX_SOUNDS_AT_ONCE = 8;

export class Sounds {
  constructor() {
    this.enabled = true;
    this.volume = 1;        // overall loudness of the boings, 0 … 1
    this.context = null;    // the speaker connection (see connect below)
    this.output = null;     // where every sound goes: a limiter (see wake below)
    this.playing = 0;       // how many sounds are playing right now
    this.buffers = {};

    // A decoder that works without speakers (1 channel, 1 sample long: it is
    // never used for playing, only for decodeAudioData).
    this.decoder = new OfflineAudioContext(1, 1, 44100);

    // The speaker connection is made at once, while the page loads: opening
    // the computer's sound output can take a moment, which in the middle of
    // the animation (on the first click) would hold up a frame. Browsers let
    // it make no sound before the first click or key press, so it starts
    // asleep; wake() wakes it then.
    const connect = () => {
      if (!this.context) {
        this.context = new AudioContext();
        // A "compressor" works like an automatic volume knob: when several
        // boings together get too loud, it turns them down a little, so the
        // sum never distorts. Quiet moments pass through unchanged.
        this.output = new DynamicsCompressorNode(this.context, {
          threshold: -12,   // start acting 12 dB below full volume
          knee: 6,          // ease in gently
          ratio: 8,         // above that, 8 dB louder in → only 1 dB louder out
          attack: 0.003,    // react within 3 ms, before a boing's first peak
          release: 0.25,    // let go again over a quarter of a second
        });
        this.output.connect(this.context.destination);
      }
    };
    try { connect(); } catch { /* (some browsers only allow it after a click: then wake() makes it) */ }
    this.halted = false;   // (the demo has stopped for good: see halt in main.js)
    const wake = () => {
      connect();
      // (Only if it sleeps: asleep at the start, or after the computer slept.)
      if (this.context.state !== 'running' && !this.halted) this.context.resume().catch(() => {});
    };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);

    // While the page is hidden (another tab is in front, or the browser is
    // minimised) all sound is frozen: boings and music stop mid-note and
    // carry on from the same place when you come back.
    document.addEventListener('visibilitychange', () => {
      if (!this.context) return;
      if (document.hidden) this.context.suspend().catch(() => {});
      else if (!this.halted) this.context.resume().catch(() => {});   // (not after the demo has stopped for good: see halt in main.js)
    });
  }

  // Load a sound file (mono Ogg Vorbis) and keep it, ready to play, under a
  // short name. Decoding it now means playing it later is instant.
  //
  // Ogg works in Chrome, Edge, Firefox, and Safari 18.4 or newer. On older
  // Apple devices loading fails, and the demo simply runs without sound.
  async load(name, url) {
    try {
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      this.buffers[name] = await this.decoder.decodeAudioData(data);
    } catch {
      console.warn(`Could not load sound "${name}" — this browser may not support Ogg audio.`);
    }
  }

  // Play a loaded sound. Several can play over each other.
  //
  // pan: where the sound comes from, -1 = fully left, 0 = centre,
  // +1 = fully right. The sound files are mono, so this is what places
  // each boing on the side of the screen where it happens.
  // volume: 0 = silent … 1 = full volume.
  play(name, pan = 0, volume = 1) {
    const buffer = this.buffers[name];
    if (!this.enabled || !buffer || !this.context || this.context.state !== 'running') return;
    if (this.playing >= MAX_SOUNDS_AT_ONCE) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = new GainNode(this.context, { gain: volume * this.volume });
    const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(gain).connect(panner).connect(this.output);
    this.playing++;
    source.onended = () => this.playing--;
    source.start();
  }
}
