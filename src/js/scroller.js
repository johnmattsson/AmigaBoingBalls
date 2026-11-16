// =============================================================================
// scroller.js — a "sine scroller": text gliding across the bottom of the
// screen, bent into a travelling wave.
//
// Next to copper bars, this was THE signature effect of Amiga demos: every
// demo had a scrolling text with greetings and boasts. Three things make it
// look the part:
//
//   - The font. Demos didn't use the computer's own text font; each had big,
//     chunky letters drawn by hand, pixel by pixel. So this file brings its
//     own little font: every letter is a grid of 5 × 7 squares (see GLYPHS).
//   - The wave bends the letters themselves: the text is drawn in thin
//     upright strips, each a little higher or lower than the one before.
//   - The colours come the copper way: a letter's colour depends on how
//     high on the screen it is, so it changes as the letter rides the wave.
//
// It is drawn on a see-through 2D canvas laid over the bottom of the scene,
// and only runs while it is shown.
// =============================================================================

import { wide } from './gui.js';

// The text. It opens with the credit line from the bottom of the page (put
// in front by the Scroller below), so that line can be switched off while
// the scroller runs.
// (The font has only A-Z, 0-9, ẞ, É and . , ! - ' : so anything else, such as
// brackets, would scroll past as a blank.)
const MESSAGE =
  ' ... A TRIBUTE TO THE DEMO THAT INTRODUCED THE AMIGA IN JANUARY 1984 ... ' +
  'GREETINGS TO DALE LUCK AND R. J. MICAL WHO WROTE THE ORIGINAL ... ' +
  'AND A VERY SPECIAL GREETING TO MY UNCLE ANDREAS ABELSSON, ALIAS KING GRUB, ' +
  'WHO INTRODUCED ME TO THE AMIGA ... ' +
  'THANKS TO CHRISTOPHE RÉSIGNÉ, WHOSE CHECKERED TWIST V3 INSPIRED TWIST V4 ... ' +
  'AND THANKS TO MY SIX CHILDREN, WHO ALWAYS THOUGHT MY DEMOS WERE COOL ... ' +
  'EVERY BALL IS A PERFECT SPHERE, NOT A SINGLE TRIANGLE IN SIGHT ... ' +
  'EVERY BOUNCE IS WORKED OUT EXACTLY AND IS REVERSIBLE: RUN TIME BACKWARDS AND EVERY COLLISION UNDOES ITSELF ... ' +
  'ENERGY, MOMENTUM AND ANGULAR MOMENTUM ARE CONSERVED ... ' +
  'CLICK A BALL TO GIVE IT A PUSH ... TRY THE PRESETS AND THE TWIST WINDOW ... ' +
  'NO LIBRARIES WERE HARMED IN THE MAKING OF THIS DEMO ...          ';

const HEIGHT = 130;         // of the strip, in CSS pixels
const SQUARE = 6;           // size of one square of a letter, in CSS pixels
const SPEED = 240;          // how fast the text glides, in pixels per second
const WAVE_HEIGHT = 26;     // how far the text rides up and down
const WAVE_LENGTH = 460;    // pixels from one wave crest to the next
const STRIP = 2;            // width of the upright strips the text is drawn in
const SHADOW = 4;           // how far the shadow is offset, right and down
const NARROW_SCREEN = 600;  // narrower than this (in CSS pixels), the scroller is drawn smaller

// The font: 7 rows of 5 squares per letter; '#' = filled.
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'É': ['..#..', '#####', '#....', '####.', '#....', '#....', '#####'],   // E with an accent (for Résigné)
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  'ẞ': ['.####', '#...#', '#..#.', '#.##.', '#...#', '#...#', '#.##.'],   // the capital of ß
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
};
const ROWS = 7;
const CELL = 6;   // a letter takes 5 squares plus 1 square of space before the next
const LETTER_WIDTH = CELL * SQUARE;
const LETTER_HEIGHT = ROWS * SQUARE;
// On the letter sheets (see drawLetters) every letter has an empty square
// on either side, so that a strip copied from the edge of one letter can
// never pick up a sliver of its neighbour on the sheet.
const SHEET_PAD = 1;
const SHEET_CELL = CELL + 2 * SHEET_PAD;

export class Scroller {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scroller';
    this.canvas.style.display = 'none';
    document.body.append(this.canvas);
    // Wide colour, like the scene (see setWideColor in renderer.js): the
    // colours are taken as Display P3 where the browser can.
    this.draw2d = this.canvas.getContext('2d', { colorSpace: 'display-p3' }) ?? this.canvas.getContext('2d');
    this.shown = false;
    this.letters = null;   // the letter sheets, made by drawLetters()
    // How fast its clock runs: 1 = normal, 0 = frozen, negative = backwards.
    // main.js sets this to the Speed setting, so the scroller pauses and
    // rewinds together with the balls.
    this.rate = 1;
    this.clock = 0;        // the scroller's own time, in seconds
    this.onDraw = null;    // called after each new picture (main.js: for its glowing letters with HDR)

    // The whole text: the page's credit line, then MESSAGE. The font only
    // has capitals; anything it doesn't have becomes a space. (The German
    // ß needs a hand: its capital is ẞ, but browsers turn it into SS.)
    const credit = document.getElementById('info')?.textContent ?? '';
    this.message = (credit + MESSAGE).replaceAll('ß', 'ẞ').toUpperCase();
  }

  // Show or hide the scroller.
  setShown(shown) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.canvas.style.display = shown ? '' : 'none';
    // Switched off, it starts again from the beginning of its text next time.
    if (!shown) {
      this.clock = 0;
      return;
    }

    let last = performance.now();
    let drawnClock = null, drawnWidth = 0;   // what the picture on screen shows
    const frame = (now) => {
      if (!this.shown) return;
      this.clock += Math.min(0.1, (now - last) / 1000) * this.rate;
      last = now;
      // Only redraw when something changed: while paused the text stands
      // still, and drawing the same picture again would only waste battery.
      if (this.clock !== drawnClock || this.canvas.clientWidth !== drawnWidth) {
        this.draw(this.clock);
        drawnClock = this.clock;
        drawnWidth = this.canvas.clientWidth;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Draw every letter of the font once, side by side, into a hidden picture
  // (a "sheet") — once in white for the letters and once in dark blue for
  // their shadows. Drawing the scroller then only means copying strips out
  // of these sheets, which is fast and keeps the motion smooth.
  drawLetters(pixelRatio) {
    const names = Object.keys(GLYPHS);
    const size = SQUARE * pixelRatio;   // one square, in real pixels
    const make = (color) => {
      const sheet = document.createElement('canvas');
      sheet.width = Math.ceil(names.length * SHEET_CELL * size);
      sheet.height = Math.ceil(ROWS * size);
      const c = sheet.getContext('2d', { colorSpace: 'display-p3' });
      c.fillStyle = color;
      names.forEach((name, index) => {
        GLYPHS[name].forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] === '#') c.fillRect((index * SHEET_CELL + SHEET_PAD + x) * size, y * size, size, size);
          }
        });
      });
      return sheet;
    };
    this.letters = { pixelRatio, white: make('#ffffff'), shadow: make(wide('#000033')) };
    // Where each letter of the message is on the sheet (-1 = a space).
    this.sheetIndex = [...this.message].map((letter) => names.indexOf(letter));
  }

  draw(seconds) {
    const canvas = this.canvas, c = this.draw2d;

    // On a narrow screen (a phone held upright) everything is drawn at 60 %
    // of its size, so the strip doesn't cover too much of the scene. All the
    // measurements below stay the same: the canvas simply shows more of them.
    const shrink = canvas.clientWidth < NARROW_SCREEN ? 0.6 : 1;
    canvas.style.height = `${HEIGHT * shrink}px`;

    // Match the drawing size to the size on screen (sharp on any display).
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth / shrink;
    if (canvas.width !== Math.round(canvas.clientWidth * pixelRatio)) {
      canvas.width = Math.round(canvas.clientWidth * pixelRatio);
      canvas.height = Math.round(HEIGHT * shrink * pixelRatio);
    }
    if (this.letters?.pixelRatio !== pixelRatio) this.drawLetters(pixelRatio);
    const zoom = pixelRatio * shrink;
    c.setTransform(zoom, 0, 0, zoom, 0, 0);   // from here on: CSS pixels (before shrinking)
    c.clearRect(0, 0, width, HEIGHT);

    // The text starts just off the right edge and glides left; when all of
    // it has passed, it starts over.
    const textWidth = this.message.length * LETTER_WIDTH;
    // (The double "%" keeps the result positive when time runs backwards.)
    const lap = textWidth + width;
    const scrolled = (((seconds * SPEED) % lap) + lap) % lap;

    // Copy the text strip by strip from a letter sheet. For each strip:
    // which part of the text is at this spot, and how high is the wave here?
    const copyStrips = (sheet, offset) => {
      for (let x = 0; x < width; x += STRIP) {
        const inText = x + scrolled - width;   // how far into the text this strip is
        if (inText < 0 || inText >= textWidth) continue;
        const letter = this.sheetIndex[Math.floor(inText / LETTER_WIDTH)];
        if (letter < 0) continue;              // a space
        const inLetter = inText % LETTER_WIDTH;
        const wave = (HEIGHT - LETTER_HEIGHT) / 2
                   + WAVE_HEIGHT * Math.sin((x / WAVE_LENGTH) * 2 * Math.PI + seconds * 3);
        // Each strip sits on a whole pixel, so its squares stay crisp.
        const y = Math.round(wave * zoom) / zoom;
        const onSheet = (letter * SHEET_CELL + SHEET_PAD) * SQUARE + inLetter;
        c.drawImage(sheet,
          onSheet * pixelRatio, 0, STRIP * pixelRatio, LETTER_HEIGHT * pixelRatio,
          x + offset, y + offset, STRIP, LETTER_HEIGHT);
      }
    };

    // 1. The letters, in white.
    copyStrips(this.letters.white, 0);

    // 2. Colour them by height, the copper way: keep the letters' shapes
    //    ("source-in") and fill them with bands of colour, top to bottom.
    c.globalCompositeOperation = 'source-in';
    const bands = c.createLinearGradient(0, 0, 0, HEIGHT);
    const colors = ['#ffffff', '#ffff88', '#ffdd00', '#ff8800', '#ff2200', '#ff8800', '#ffdd00', '#ffff88', '#ffffff'];
    colors.forEach((color, index) => bands.addColorStop(index / (colors.length - 1), wide(color)));
    c.fillStyle = bands;
    c.fillRect(0, 0, width, HEIGHT);

    // 3. Their shadows, slipped in behind them ("destination-over").
    c.globalCompositeOperation = 'destination-over';
    copyStrips(this.letters.shadow, SHADOW);
    c.globalCompositeOperation = 'source-over';
    this.onDraw?.();
  }
}
