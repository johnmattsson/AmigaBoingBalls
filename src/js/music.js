// =============================================================================
// music.js — chiptunes, played by code.
//
// Amiga music was made with "trackers": programs in which a tune is a table
// of notes for four sound channels, stepped through at a steady pace. This
// file does the same. Each tune below is written as lists of notes, and a
// small player steps through them and makes every sound from scratch with
// the browser's Web Audio API — there are no music files.
//
// The tunes are original, each in a style the Amiga was loved for:
//   Jump'n'run  – bouncy platform-game music
//   Anthem      – a slow, soaring demo tune over big held chords
//   Funk        – a syncopated tracker groove with a plucked bass
//   Chip intro  – fast, bright and all square waves, like a "cracktro"
//
// Every tune uses the same four channels:
//   bass     – low notes
//   chords   – the harmony: held chords, short stabs, or the chord's notes
//              played one after another (an "arpeggio": the classic trick
//              for getting a chord out of a channel that can only play one
//              note at a time)
//   melody   – the tune itself, with an echo
//   drums    – kick, snare and hi-hat, made from a falling tone and hiss
//
// Notes are written as MIDI numbers: 69 is the A above middle C, and each
// step of 1 is one key on a piano (so +12 is one octave up). A bar has 16
// steps; in the step lists, 1 = play and 0 = don't.
// =============================================================================

const STEPS_PER_BAR = 16;
const FULL_VOLUME = 0.3;   // how loud the music is with its volume at 1

// ---- Chords: the bass note, and the notes of the chord ---------------------------
const chord = (bass, ...notes) => ({ bass, notes });
const A_MINOR  = chord(33, 57, 60, 64);
const A_MAJOR  = chord(33, 57, 61, 64);
const A_MINOR7 = chord(33, 57, 60, 64, 67);
const B_MINOR  = chord(35, 59, 62, 66);
const B_MAJOR  = chord(35, 59, 63, 66);
const B_FLAT   = chord(34, 58, 62, 65);
const C_MAJOR  = chord(36, 60, 64, 67);
const D_MINOR  = chord(38, 62, 65, 69);
const D_MINOR7 = chord(38, 60, 62, 65, 69);
const D_MAJOR  = chord(38, 62, 66, 69);
const E_MINOR  = chord(40, 64, 67, 71);
const F_MAJOR  = chord(29, 60, 65, 69);
const G_MAJOR  = chord(31, 59, 62, 67);
const G_MINOR  = chord(31, 58, 62, 67);

// ---- The tunes -------------------------------------------------------------------
// Each tune:
//   tempo   – beats per minute (a beat is 4 steps)
//   bars    – one chord per bar; the whole list repeats
//   melody  – one list of 16 notes per bar; 0 = no new note
//   lead    – the melody's sound: 'square' (hollow, with a wobble on long
//             notes), 'saw' (bright and singing) or 'chip' (short and plain)
//   bass    – its sound ('triangle' soft, 'pluck' snappy, 'square' hollow)
//             and, per step, what to add to the chord's bass note (-1 = rest)
//   chords  – how the harmony is played: 'arpeggio' (very fast, warbling),
//             'broken' (one chord note per step), 'pad' (held for the whole
//             bar) or 'stab' (short hits on the steps listed)
//   kick, snare, hat – the drums' steps; roll = the snare's steps in every 8th bar
//   intro   – how many bars pass before the melody comes in, the first time
export const TRACKS = {
  jump: {
    name: "Jump'n'run",
    tempo: 140, lead: 'square', intro: 4,
    bars: [
      D_MINOR, B_FLAT, C_MAJOR, A_MINOR,   D_MINOR, B_FLAT, C_MAJOR, A_MAJOR,
      F_MAJOR, C_MAJOR, G_MINOR, A_MAJOR,  F_MAJOR, C_MAJOR, G_MINOR, A_MAJOR,
    ],
    melody: [
      [74, 0, 0, 77, 0, 0, 81, 0, 79, 0, 77, 0, 74, 0, 77, 0],
      [77, 0, 0, 74, 0, 0, 70, 0, 72, 0, 74, 0, 77, 0, 0, 0],
      [76, 0, 0, 79, 0, 0, 84, 0, 79, 0, 76, 0, 72, 0, 76, 0],
      [76, 0, 0, 72, 0, 0, 69, 0, 72, 0, 76, 0, 81, 0, 79, 77],
      [74, 0, 77, 0, 81, 0, 0, 86, 0, 0, 84, 0, 81, 0, 77, 0],
      [82, 0, 0, 77, 0, 0, 74, 0, 77, 0, 82, 0, 81, 0, 77, 0],
      [79, 0, 0, 76, 0, 0, 72, 0, 76, 0, 79, 0, 84, 0, 0, 0],
      [85, 0, 0, 81, 0, 0, 76, 0, 81, 0, 85, 0, 88, 0, 0, 0],
      [81, 0, 81, 0, 84, 0, 81, 0, 77, 0, 0, 81, 0, 0, 77, 0],
      [79, 0, 79, 0, 84, 0, 79, 0, 76, 0, 0, 79, 0, 0, 76, 0],
      [82, 0, 82, 0, 86, 0, 82, 0, 79, 0, 0, 82, 0, 0, 79, 0],
      [81, 0, 0, 0, 85, 0, 0, 0, 88, 0, 85, 0, 81, 0, 0, 0],
      [84, 0, 81, 0, 77, 0, 81, 0, 84, 0, 0, 89, 0, 0, 84, 0],
      [84, 0, 79, 0, 76, 0, 79, 0, 84, 0, 0, 88, 0, 0, 84, 0],
      [86, 0, 82, 0, 79, 0, 82, 0, 86, 0, 0, 91, 0, 0, 86, 0],
      [88, 0, 85, 0, 81, 0, 85, 0, 88, 0, 0, 0, 93, 0, 0, 0],
    ],
    bass: { sound: 'triangle', steps: [0, -1, 12, 0, -1, 12, 0, 12, 0, -1, 12, 0, 7, -1, 12, 7] },
    chords: { style: 'arpeggio' },
    kick:  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1],
    roll:  [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1],
  },

  anthem: {
    name: 'Anthem',
    tempo: 108, lead: 'saw', intro: 4,
    bars: [
      E_MINOR, E_MINOR, C_MAJOR, C_MAJOR,  D_MAJOR, D_MAJOR, B_MINOR, B_MAJOR,
      G_MAJOR, D_MAJOR, E_MINOR, C_MAJOR,  G_MAJOR, D_MAJOR, B_MAJOR, B_MAJOR,
    ],
    melody: [
      [83, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0],
      [78, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0, 0, 0, 74, 0],
      [76, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 84, 0, 0, 0],
      [83, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0, 0, 0, 0, 0],
      [81, 0, 0, 0, 0, 0, 0, 0, 78, 0, 0, 0, 74, 0, 0, 0],
      [78, 0, 0, 0, 81, 0, 0, 0, 86, 0, 0, 0, 0, 0, 81, 0],
      [83, 0, 0, 0, 0, 0, 0, 0, 78, 0, 0, 0, 74, 0, 0, 0],
      [75, 0, 0, 0, 78, 0, 0, 0, 83, 0, 0, 0, 87, 0, 0, 0],
      [86, 0, 0, 0, 0, 0, 83, 0, 0, 0, 79, 0, 0, 0, 0, 0],
      [81, 0, 0, 0, 0, 0, 78, 0, 0, 0, 74, 0, 0, 0, 0, 0],
      [79, 0, 0, 0, 0, 0, 76, 0, 0, 0, 71, 0, 76, 0, 79, 0],
      [84, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0],
      [86, 0, 0, 0, 0, 0, 83, 0, 0, 0, 79, 0, 83, 0, 86, 0],
      [90, 0, 0, 0, 0, 0, 86, 0, 0, 0, 81, 0, 0, 0, 0, 0],
      [87, 0, 0, 0, 0, 0, 83, 0, 0, 0, 78, 0, 75, 0, 0, 0],
      [78, 0, 0, 0, 0, 0, 0, 0, 83, 0, 0, 0, 0, 0, 0, 0],
    ],
    bass: { sound: 'pluck', steps: [0, -1, 0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 0, -1, 7, -1] },
    chords: { style: 'pad', alsoBroken: true },
    kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    roll:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
  },

  funk: {
    name: 'Funk',
    tempo: 118, lead: 'square', intro: 2,
    bars: [A_MINOR7, A_MINOR7, D_MINOR7, D_MINOR7, A_MINOR7, A_MINOR7, F_MAJOR, G_MAJOR],
    melody: [
      [0, 0, 76, 0, 79, 0, 81, 0, 0, 79, 0, 76, 0, 0, 72, 0],
      [74, 0, 0, 76, 0, 0, 72, 0, 69, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 77, 0, 81, 0, 84, 0, 0, 81, 0, 77, 0, 0, 74, 0],
      [76, 0, 0, 77, 0, 0, 74, 0, 72, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 76, 0, 79, 0, 81, 0, 0, 84, 0, 81, 0, 0, 79, 0],
      [81, 0, 0, 79, 0, 0, 76, 0, 72, 0, 74, 0, 76, 0, 0, 0],
      [0, 0, 77, 0, 81, 0, 84, 0, 0, 81, 0, 77, 0, 0, 72, 0],
      [0, 0, 79, 0, 83, 0, 86, 0, 0, 83, 0, 86, 0, 0, 88, 0],
    ],
    bass: { sound: 'pluck', steps: [0, -1, -1, 0, -1, -1, 12, -1, 0, -1, 10, 12, -1, 7, -1, 10] },
    chords: { style: 'stab', steps: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1] },
    kick:  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat:   [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
    roll:  [0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1],
  },

  chip: {
    name: 'Chip intro',
    tempo: 150, lead: 'chip', intro: 2,
    bars: [C_MAJOR, G_MAJOR, A_MINOR, F_MAJOR, C_MAJOR, G_MAJOR, F_MAJOR, G_MAJOR],
    melody: [
      [84, 0, 79, 0, 76, 0, 79, 0, 84, 0, 79, 0, 76, 0, 72, 0],
      [83, 0, 79, 0, 74, 0, 79, 0, 83, 0, 86, 0, 83, 0, 79, 0],
      [81, 0, 76, 0, 72, 0, 76, 0, 81, 0, 84, 0, 81, 0, 76, 0],
      [81, 0, 77, 0, 72, 0, 77, 0, 81, 0, 0, 0, 84, 0, 0, 0],
      [88, 0, 0, 84, 0, 0, 79, 0, 84, 0, 0, 88, 0, 0, 84, 0],
      [86, 0, 0, 83, 0, 0, 79, 0, 83, 0, 0, 86, 0, 0, 83, 0],
      [84, 0, 0, 81, 0, 0, 77, 0, 81, 0, 84, 0, 89, 0, 84, 0],
      [86, 0, 83, 0, 79, 0, 83, 0, 86, 0, 91, 0, 0, 0, 0, 0],
    ],
    bass: { sound: 'square', steps: [0, -1, 12, -1, 0, -1, 12, -1, 0, -1, 12, -1, 0, -1, 12, 12] },
    chords: { style: 'arpeggio' },
    kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    roll:  [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1],
  },
};

// MIDI note number → pitch in Hz (vibrations per second).
const pitch = (note) => 440 * 2 ** ((note - 69) / 12);


export class Music {
  // `sounds` is the Sounds object from audio.js: the music shares its
  // connection to the speakers (which only exists after the first click).
  constructor(sounds) {
    this.sounds = sounds;
    this.playing = false;
    this.volume = 0.5;   // 0 … 1
    this.track = TRACKS.jump;
    this.timer = null;
  }

  // Set the loudness, 0 … 1.
  setVolume(volume) {
    this.volume = volume;
    if (this.playing) this.output.gain.setTargetAtTime(volume * FULL_VOLUME, this.context.currentTime, 0.03);
  }

  // Choose a tune (a name from TRACKS). If music is playing, the new tune
  // starts from its beginning.
  setTrack(name) {
    if (this.track === TRACKS[name]) return;   // already chosen
    this.track = TRACKS[name];
    if (this.playing) {
      this.setPlaying(false);
      this.setPlaying(true);
    }
  }

  // Start or stop the music.
  setPlaying(on) {
    if (on === this.playing) return;
    const context = this.sounds.context;
    if (on && !context) return;   // no click yet, so no speakers: try again later
    this.playing = on;

    if (!on) {
      clearInterval(this.timer);
      // Fade out quickly rather than cutting off with a click.
      this.output.gain.setTargetAtTime(0, context.currentTime, 0.03);
      return;
    }

    if (!this.output) this.connect(context);
    this.output.gain.setTargetAtTime(this.volume * FULL_VOLUME, context.currentTime, 0.03);
    this.stepSeconds = 60 / this.track.tempo / 4;
    this.echo.delayTime.value = 3 * this.stepSeconds;   // the echo answers three steps later
    this.step = 0;
    this.nextStepTime = context.currentTime + 0.15;
    // Notes must start at exact moments, more exact than a browser timer
    // can manage. So a timer only wakes us up often, and each time we line
    // up the notes for the near future on the audio clock, which is exact.
    this.timer = setInterval(() => this.lineUp(), 25);
  }

  // Build the parts that every note passes through on its way out.
  connect(context) {
    this.context = context;
    this.output = new GainNode(context, { gain: 0 });
    // The Amiga's sound output was a little muffled; this takes the harsh
    // top off the raw tones in the same way.
    const muffle = new BiquadFilterNode(context, { type: 'lowpass', frequency: 5000 });
    this.output.connect(muffle).connect(context.destination);

    // The Amiga's four channels were wired two to the left speaker and two
    // to the right. Here they lean left and right instead of going all the way.
    const side = (pan) => {
      const panner = new StereoPannerNode(context, { pan });
      panner.connect(this.output);
      return panner;
    };
    this.left = side(-0.5);
    this.right = side(0.5);

    // An echo for the melody: what goes in comes out again a little later,
    // and a third of that goes round once more, and so on.
    this.echo = new DelayNode(context, { delayTime: 0.3, maxDelayTime: 1 });
    const again = new GainNode(context, { gain: 0.33 });
    this.echo.connect(again).connect(this.echo);
    this.echo.connect(this.left);   // the echo answers from the other side

    // One second of hiss (random numbers), for the drums.
    this.hiss = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.hiss.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  // Line up all steps that start within the next moment. (While the page is
  // hidden, audio.js freezes the audio clock, so nothing new is lined up
  // and the music waits.)
  lineUp() {
    while (this.nextStepTime < this.context.currentTime + 0.2) {
      this.playStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.stepSeconds;
    }
  }

  // Everything that starts on one step.
  playStep(step, time) {
    const track = this.track;
    const stepSeconds = this.stepSeconds;
    const stepInBar = step % STEPS_PER_BAR;
    const barNumber = Math.floor(step / STEPS_PER_BAR);
    const bar = track.bars[barNumber % track.bars.length];
    const lastOfEight = barNumber % 8 === 7;

    // ---- Bass.
    const bassStep = track.bass.steps[stepInBar];
    if (bassStep >= 0) {
      const note = bar.bass + 12 + bassStep;
      if (track.bass.sound === 'pluck') this.pluck(note, time, stepSeconds * 1.8, 0.9, this.left);
      else this.tone(track.bass.sound, [note], time, stepSeconds * 1.6, track.bass.sound === 'square' ? 0.3 : 1.0, this.left);
    }

    // ---- Chords.
    const style = track.chords.style;
    if (style === 'arpeggio' && stepInBar % 2 === 0) {
      // On every other step, the chord's notes in very quick succession,
      // alternately low and an octave higher.
      const lift = stepInBar % 4 === 0 ? 12 : 24;
      this.tone('square', bar.notes.map((note) => note + lift), time, stepSeconds * 1.9, 0.16, this.right);
    }
    if (style === 'pad' && stepInBar === 0) this.pad(bar.notes, time, stepSeconds * STEPS_PER_BAR);
    if (style === 'stab' && track.chords.steps[stepInBar]) this.stab(bar.notes, time);
    if (track.chords.alsoBroken) {
      // One chord note per step, quietly, rising and falling.
      const order = [0, 1, 2, 1];
      const lift = stepInBar % 8 < 4 ? 12 : 24;
      this.tone('square', [bar.notes[order[stepInBar % 4]] + lift], time, stepSeconds * 0.9, 0.07, this.right);
    }

    // ---- Melody.
    const note = track.melody[barNumber % track.melody.length][stepInBar];
    if (note && barNumber >= track.intro) this.lead(track.lead, note, time);

    // ---- Drums.
    if (track.kick[stepInBar]) this.kick(time);
    if ((lastOfEight ? track.roll : track.snare)[stepInBar]) this.noise(time, 0.11, 0.45, 1800);
    if (track.hat[stepInBar]) this.noise(time, 0.03, 0.2, 8000);
  }

  // One sound: a simple wave that starts at once and dies away.
  //   wave: 'square' (hollow, the classic chip sound), 'sawtooth' (bright)
  //         or 'triangle' (soft)
  //   notes: usually one note. Several are played one after another, each
  //          for a 50th of a second, over and over: an arpeggio.
  tone(wave, notes, time, seconds, loudness, output) {
    const oscillator = new OscillatorNode(this.context, { type: wave, frequency: pitch(notes[0]) });
    for (let i = 1; notes.length > 1 && i * 0.02 < seconds; i++) {
      oscillator.frequency.setValueAtTime(pitch(notes[i % notes.length]), time + i * 0.02);
    }
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(loudness, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    oscillator.connect(gain).connect(output);
    oscillator.start(time);
    oscillator.stop(time + seconds);
  }

  // A plucked note (for basses): a bright tone sent through a filter that
  // closes quickly, so it starts with a snap and then turns dull and round.
  pluck(note, time, seconds, loudness, output) {
    const oscillator = new OscillatorNode(this.context, { type: 'sawtooth', frequency: pitch(note) });
    const filter = new BiquadFilterNode(this.context, { type: 'lowpass', Q: 5 });
    filter.frequency.setValueAtTime(2400, time);
    filter.frequency.exponentialRampToValueAtTime(250, time + 0.14);
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(loudness, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    oscillator.connect(filter).connect(gain).connect(output);
    oscillator.start(time);
    oscillator.stop(time + seconds);
  }

  // A held chord ("pad"): every note of it as two slightly out-of-tune
  // bright tones, softened by a filter, swelling in and fading out.
  pad(notes, time, seconds) {
    const filter = new BiquadFilterNode(this.context, { type: 'lowpass', frequency: 1500 });
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.12);            // swell in
    gain.gain.setValueAtTime(0.07, time + seconds - 0.15);
    gain.gain.linearRampToValueAtTime(0, time + seconds + 0.05);     // fade out
    filter.connect(gain).connect(this.output);
    for (const note of notes) {
      for (const detune of [-9, 9]) {
        const oscillator = new OscillatorNode(this.context, { type: 'sawtooth', frequency: pitch(note), detune });
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + seconds + 0.05);
      }
    }
  }

  // A chord played as one short, sharp hit.
  stab(notes, time) {
    for (const note of notes) this.tone('square', [note + 12], time, 0.13, 0.1, this.right);
  }

  // One note of the melody, in one of three sounds (see `lead` above).
  lead(kind, note, time) {
    const stepSeconds = this.stepSeconds;
    const seconds = stepSeconds * (kind === 'saw' ? 9 : kind === 'chip' ? 2.4 : 5);
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(0.2, time);
    gain.gain.setTargetAtTime(0.11, time + 0.03, 0.05);                                // a firm start, then a little softer
    gain.gain.setTargetAtTime(0, time + seconds * 0.4, kind === 'saw' ? 0.25 : 0.1);   // and dying away
    gain.connect(this.right);
    gain.connect(this.echo);

    // The plain chip sound: a single square wave, nothing else.
    if (kind === 'chip') {
      const oscillator = new OscillatorNode(this.context, { type: 'square', frequency: pitch(note) });
      oscillator.connect(gain);
      oscillator.start(time);
      oscillator.stop(time + seconds);
      return;
    }

    // Vibrato: a slow wave (6 times a second) that nudges the pitch up and
    // down. It only sets in after a moment, so short notes stay steady.
    const wobble = new OscillatorNode(this.context, { frequency: 6 });
    const depth = new GainNode(this.context, { gain: 0 });
    depth.gain.setTargetAtTime(pitch(note) * 0.012, time + 0.15, 0.1);
    wobble.connect(depth);

    // The bright 'saw' sound is softened a little by a filter.
    let target = gain;
    if (kind === 'saw') {
      target = new BiquadFilterNode(this.context, { type: 'lowpass', frequency: 3200 });
      target.connect(gain);
    }

    // Two tones a hair apart in pitch (detune is in hundredths of a note)
    // sound fuller than one.
    for (const detune of [-7, 7]) {
      const oscillator = new OscillatorNode(this.context,
        { type: kind === 'saw' ? 'sawtooth' : 'square', frequency: pitch(note), detune });
      depth.connect(oscillator.frequency);
      oscillator.connect(target);
      oscillator.start(time);
      oscillator.stop(time + seconds);
    }
    wobble.start(time);
    wobble.stop(time + seconds);
  }

  // Kick drum: a tone that drops very quickly from high to low.
  kick(time) {
    const oscillator = new OscillatorNode(this.context, { type: 'sine', frequency: 160 });
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.1);
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(1.2, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    oscillator.connect(gain).connect(this.left);
    oscillator.start(time);
    oscillator.stop(time + 0.16);
  }

  // Snare and hi-hat: a short burst of hiss, with everything below
  // `lowestPitch` filtered away (high = thin hi-hat, lower = fuller snare).
  noise(time, seconds, loudness, lowestPitch) {
    const source = new AudioBufferSourceNode(this.context, { buffer: this.hiss });
    const filter = new BiquadFilterNode(this.context, { type: 'highpass', frequency: lowestPitch });
    const gain = new GainNode(this.context, { gain: 0 });
    gain.gain.setValueAtTime(loudness, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
    source.connect(filter).connect(gain).connect(this.left);
    source.start(time, Math.random() * 0.5);   // a different bit of hiss each time
    source.stop(time + seconds);
  }
}
