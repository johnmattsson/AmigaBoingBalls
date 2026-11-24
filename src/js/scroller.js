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
//     own font: fat round letters on a grid of 9 × 10 squares (see GLYPHS).
//   - The wave bends the letters themselves: the text is drawn in thin
//     upright strips, each a little higher or lower than the one before.
//   - The colours: each letter painted from white at its top through yellow
//     and orange to red, with a shine, a darker side and a dark outline.
//
// The graphics card draws it, over the bottom of the scene: this file holds
// the text, the font, where the text is at each moment, and the drawing
// itself, written once for both renderers (SCROLLER_SHADER).
// =============================================================================

// The text. It opens with the credit line from the bottom of the page (put
// in front by the Scroller below), so that line can be switched off while
// the scroller runs.
// (The font has only A-Z, 0-9, ẞ and . , ! - ' : so anything else, such as
// brackets, would scroll past as a blank.)
const MESSAGE =
  ' ... A TRIBUTE TO THE DEMO THAT INTRODUCED THE AMIGA IN JANUARY 1984 ... ' +
  'GREETINGS TO DALE LUCK AND R. J. MICAL WHO WROTE THE ORIGINAL ... ' +
  'AND A VERY SPECIAL GREETING TO MY UNCLE ANDREAS ABELSSON, ALIAS KING GRUB, ' +
  'WHO INTRODUCED ME TO THE AMIGA ... ' +
  'AND THANKS TO MY BROTHER AND MY SIX CHILDREN, WHO ALWAYS THOUGHT MY DEMOS WERE COOL ... ' +
  'AND TO MY WONDERFUL WIFE, FOR HER LOVE AND ENDLESS PATIENCE ... ' +
  'EVERY BALL IS A PERFECT SPHERE, NOT A SINGLE TRIANGLE IN SIGHT ... ' +
  'EVERY BOUNCE IS WORKED OUT EXACTLY AND IS REVERSIBLE: RUN TIME BACKWARDS AND EVERY COLLISION UNDOES ITSELF ... ' +
  'ENERGY, MOMENTUM AND ANGULAR MOMENTUM ARE CONSERVED ... ' +
  'CLICK A BALL TO GIVE IT A PUSH ...          ';

export const HEIGHT = 130;  // of the strip, in CSS pixels
const SQUARE = 4;    // size of one square of a letter, in CSS pixels
const SPEED = 440;        // how fast the text glides, in pixels per second
const WAVE_HEIGHT = 36;   // how far the text rides up and down (at most 37: the letters, 40, their outline, 4 above and below, and their shadow, 4, stay inside the strip)
const WAVE_LENGTH = 340;  // pixels from one wave crest to the next
const WAVE_TURNS = 5;            // how fast the wave runs along the text, in radians per second
const STRIP = 2;            // width of the upright strips the text is drawn in
export const SHADOW = 4;    // how far the shadow is offset, right and down
const NARROW_SCREEN = 600;  // narrower than this (in CSS pixels), the scroller is drawn smaller

// The font, drawn by hand: fat round letters, 10 rows of 9 squares each, the
// strokes three squares thick; '#' = filled.
const GLYPHS = {
  A: [
    '..#####..',
    '.#######.',
    '###...###',
    '###...###',
    '###...###',
    '#########',
    '#########',
    '###...###',
    '###...###',
    '###...###',
  ],
  B: [
    '#######..',
    '########.',
    '###...###',
    '###...###',
    '########.',
    '########.',
    '###...###',
    '###...###',
    '########.',
    '#######..',
  ],
  C: [
    '..######.',
    '.########',
    '###...###',
    '###......',
    '###......',
    '###......',
    '###......',
    '###...###',
    '.########',
    '..######.',
  ],
  D: [
    '#######..',
    '########.',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '########.',
    '#######..',
  ],
  E: [
    '#########',
    '#########',
    '###......',
    '###......',
    '#######..',
    '#######..',
    '###......',
    '###......',
    '#########',
    '#########',
  ],
  F: [
    '#########',
    '#########',
    '###......',
    '###......',
    '#######..',
    '#######..',
    '###......',
    '###......',
    '###......',
    '###......',
  ],
  G: [
    '..######.',
    '.########',
    '###...###',
    '###......',
    '###......',
    '###.#####',
    '###.#####',
    '###...###',
    '.########',
    '..######.',
  ],
  H: [
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '#########',
    '#########',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
  ],
  I: [
    '.#######.',
    '.#######.',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '.#######.',
    '.#######.',
  ],
  J: [
    '....#####',
    '....#####',
    '......###',
    '......###',
    '......###',
    '......###',
    '###...###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  K: [
    '###...###',
    '###..###.',
    '###.###..',
    '######...',
    '#####....',
    '#####....',
    '######...',
    '###.###..',
    '###..###.',
    '###...###',
  ],
  L: [
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '#########',
    '#########',
  ],
  M: [
    '###...###',
    '####.####',
    '#########',
    '#########',
    '###.#.###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
  ],
  N: [
    '###...###',
    '####..###',
    '#####.###',
    '#########',
    '#########',
    '###.#####',
    '###..####',
    '###...###',
    '###...###',
    '###...###',
  ],
  O: [
    '..#####..',
    '.#######.',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  P: [
    '#######..',
    '########.',
    '###...###',
    '###...###',
    '########.',
    '#######..',
    '###......',
    '###......',
    '###......',
    '###......',
  ],
  Q: [
    '..#####..',
    '.#######.',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###.#.###',
    '###..###.',
    '.#######.',
    '..###.###',
  ],
  R: [
    '#######..',
    '########.',
    '###...###',
    '###...###',
    '########.',
    '#######..',
    '###.###..',
    '###..###.',
    '###...###',
    '###...###',
  ],
  S: [
    '..######.',
    '.########',
    '###...###',
    '###......',
    '.######..',
    '..######.',
    '......###',
    '###...###',
    '########.',
    '.######..',
  ],
  T: [
    '#########',
    '#########',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
  ],
  U: [
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  V: [
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '.###.###.',
    '.###.###.',
    '..#####..',
    '...###...',
  ],
  W: [
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###...###',
    '###.#.###',
    '#########',
    '#########',
    '####.####',
    '###...###',
  ],
  X: [
    '###...###',
    '###...###',
    '.###.###.',
    '..#####..',
    '...###...',
    '...###...',
    '..#####..',
    '.###.###.',
    '###...###',
    '###...###',
  ],
  Y: [
    '###...###',
    '###...###',
    '###...###',
    '.###.###.',
    '..#####..',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
  ],
  Z: [
    '#########',
    '#########',
    '.....####',
    '....####.',
    '...####..',
    '..####...',
    '.####....',
    '####.....',
    '#########',
    '#########',
  ],
  0: [
    '..#####..',
    '.#######.',
    '###...###',
    '###..####',
    '###.#####',
    '#####.###',
    '####..###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  1: [
    '...###...',
    '..####...',
    '.#####...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '.#######.',
    '.#######.',
  ],
  2: [
    '..#####..',
    '.#######.',
    '###...###',
    '......###',
    '.....###.',
    '...####..',
    '..###....',
    '.###.....',
    '#########',
    '#########',
  ],
  3: [
    '.######..',
    '########.',
    '......###',
    '......###',
    '..#####..',
    '..#####..',
    '......###',
    '......###',
    '########.',
    '.######..',
  ],
  4: [
    '....####.',
    '...#####.',
    '..######.',
    '.###.###.',
    '###..###.',
    '#########',
    '#########',
    '.....###.',
    '.....###.',
    '.....###.',
  ],
  5: [
    '#########',
    '#########',
    '###......',
    '###......',
    '#######..',
    '########.',
    '......###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  6: [
    '..#####..',
    '.#######.',
    '###......',
    '###......',
    '#######..',
    '########.',
    '###...###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  7: [
    '#########',
    '#########',
    '......###',
    '.....###.',
    '....###..',
    '...###...',
    '...###...',
    '..###....',
    '..###....',
    '..###....',
  ],
  8: [
    '..#####..',
    '.#######.',
    '###...###',
    '###...###',
    '.#######.',
    '.#######.',
    '###...###',
    '###...###',
    '.#######.',
    '..#####..',
  ],
  9: [
    '..#####..',
    '.#######.',
    '###...###',
    '###...###',
    '.########',
    '..#######',
    '......###',
    '......###',
    '.#######.',
    '..#####..',
  ],
  '.': [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '...###...',
    '...###...',
    '...###...',
  ],
  ',': [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '...###...',
    '...###...',
    '...###...',
    '..###....',
  ],
  '!': [
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '...###...',
    '.........',
    '...###...',
    '...###...',
    '...###...',
  ],
  '-': [
    '.........',
    '.........',
    '.........',
    '.........',
    '.#######.',
    '.#######.',
    '.........',
    '.........',
    '.........',
    '.........',
  ],
  "'": [
    '...###...',
    '...###...',
    '...###...',
    '..###....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ],
  'ẞ': [
    '..#####..',
    '.#######.',
    '###...###',
    '###..###.',
    '###.###..',
    '###.####.',
    '###...###',
    '###...###',
    '###.####.',
    '###.###..',
  ],   // the capital of ß
  ':': [
    '.........',
    '.........',
    '...###...',
    '...###...',
    '...###...',
    '.........',
    '...###...',
    '...###...',
    '...###...',
    '.........',
  ],
};
const ROWS = 10, COLS = 9;
// A letter takes its 9 squares plus one on either side for its outline (so
// the outlines of two letters just meet).
const CELL = COLS + 2;
const LETTER_WIDTH = CELL * SQUARE;
const LETTER_HEIGHT = ROWS * SQUARE;
// The colours of a letter, as demo fonts were painted: down the letter from
// white through yellow and orange to red; the squares along its lower and
// right edges darker, those along its upper and left edges lit (a shine),
// and a dark outline all round. (The same in scrollerPaint in
// gpu-renderer.js, which takes these numbers from here.)
const LETTER_RAMP = [[255, 255, 255], [255, 255, 136], [255, 221, 0], [255, 136, 0], [255, 34, 0]];
const LETTER_DARK = [120, 20, 0], DARK_SHARE = 0.45, SHINE_SHARE = 0.6;
const OUTLINE_COLOR = [20, 10, 40];
const SHADOW_COLOR = [0, 0, 51];
// ---- The drawing, for the graphics card ----
// Written once, in the notation of shade.js, and used by both renderers
// (the text shader in shaders.js, the scene's shaders in gpu-renderer.js).
// Each of them gives, under these names:
//   $scroll      – how far scrolled, the wave's phase, the strip's width and
//                  the text's, in the scroller's units (see place, below)
//   $scrollText  – (in y) where the letters of the message start among the
//                  numbers handed over: after the font; (in z) 1 with big
//                  pixels (Pixel size), else 0: see hard below
//   $textRect    – the strip's place in the picture, in pixels from the
//                  bottom left: x, y, width, height
//   $height      – the picture's height in pixels
//   $textGlow    – how much brighter than white the letters shine (HDR)
// and the functions scrollerWord(i), number i of those handed over (first
// the font, glyphRows, then the message, letterNumbers), and toCanvas(c), a
// screen colour as the picture takes it.
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const rgb = (c) => `vec3f(${c.map((v) => (v / 255).toFixed(4)).join(', ')})`;
export const SCROLLER_SHADER = /* wgsl */ `
  const S_HEIGHT: f32 = ${f(HEIGHT)}; const S_SQUARE: f32 = ${f(SQUARE)}; const S_STRIP: f32 = ${f(STRIP)};
  const S_WAVE_HEIGHT: f32 = ${f(WAVE_HEIGHT)}; const S_WAVE_LENGTH: f32 = ${f(WAVE_LENGTH)}; const S_SHADOW: f32 = ${f(SHADOW)};
  const S_LETTER_WIDTH: f32 = ${f(LETTER_WIDTH)}; const S_LETTER_HEIGHT: f32 = ${f(LETTER_HEIGHT)};
  const S_ROWS: i32 = ${ROWS}; const S_COLS: i32 = ${COLS};
  const S_TURN: f32 = 6.2831853;

  // One row of a letter of the font, as bits (0 outside the letter), and
  // whether a square of it is filled.
  fn scrollerRow(letter: u32, row: i32) -> u32 {
    if (row < 0 || row >= S_ROWS) { return 0u; }
    return scrollerWord(letter * u32(S_ROWS) + u32(row));
  }
  fn filled(bits: u32, column: i32) -> bool {
    return column >= 0 && column < S_COLS && ((bits >> u32(S_COLS - 1 - column)) & 1u) == 1u;
  }
  // Down a letter (t: 0 at its top … 1 at its bottom): from white through
  // yellow and orange to red.
  fn letterRamp(t: f32) -> vec3f {
    let at: f32 = t * 4.0;
    var color: vec3f = mix(${rgb(LETTER_RAMP[0])}, ${rgb(LETTER_RAMP[1])}, clamp(at, 0.0, 1.0));
    color = mix(color, ${rgb(LETTER_RAMP[2])}, clamp(at - 1.0, 0.0, 1.0));
    color = mix(color, ${rgb(LETTER_RAMP[3])}, clamp(at - 2.0, 0.0, 1.0));
    return mix(color, ${rgb(LETTER_RAMP[4])}, clamp(at - 3.0, 0.0, 1.0));
  }

  // What the text shows at (x, y), in the scroller's units from its top
  // left: rgb, a screen colour, and in w what it is: 2 a square of a letter,
  // 1 its outline, 0 nothing. (offset: the shadow's, which is the same text
  // moved right and down; of the shadow only w matters: 2 where a letter's
  // square is.)
  // The text is drawn in upright strips, each riding the wave at its own
  // height, rounded to whole pixels so that the squares stay crisp.
  fn scrollerPaint(x0: f32, y0: f32, offset: f32, zoom: f32) -> vec4f {
    let x: f32 = x0 - offset;
    let strip: f32 = floor(x / S_STRIP) * S_STRIP;
    if (strip < 0.0 || strip >= $scroll.z) { return vec4f(0.0); }
    let inText: f32 = strip + $scroll.x - $scroll.z;
    if (inText < 0.0 || inText >= $scroll.w) { return vec4f(0.0); }
    let index: u32 = u32(inText / S_LETTER_WIDTH);
    let letter: u32 = scrollerWord(u32($scrollText.y) + index);
    if (letter == 255u) { return vec4f(0.0); }   // a space
    let wave: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5
                  + S_WAVE_HEIGHT * sin(strip / S_WAVE_LENGTH * S_TURN + $scroll.y);
    let top: f32 = round(wave * zoom) / zoom + offset;
    // (A letter has a square of room on either side and above and below,
    // for its outline: column and row -1 and one past the last.)
    let column: i32 = i32(floor((inText - f32(index) * S_LETTER_WIDTH + (x - strip)) / S_SQUARE)) - 1;
    let row: i32 = i32(floor((y0 - top) / S_SQUARE));
    if (column < -1 || column > S_COLS || row < -1 || row > S_ROWS) { return vec4f(0.0); }
    let here: u32 = scrollerRow(letter, row);
    if (offset > 0.0) { return vec4f(0.0, 0.0, 0.0, select(0.0, 2.0, filled(here, column))); }
    let above: u32 = scrollerRow(letter, row - 1);
    let below: u32 = scrollerRow(letter, row + 1);
    if (filled(here, column)) {
      // Darker along the letter's lower and right edges, lit along its
      // upper and left ones.
      var color: vec3f = letterRamp(f32(row) / f32(S_ROWS - 1));
      if (!filled(below, column) || !filled(here, column + 1)) {
        color = mix(color, ${rgb(LETTER_DARK)}, ${f(DARK_SHARE)});
      } else if (!filled(above, column) || !filled(here, column - 1)) {
        color = mix(color, vec3f(1.0), ${f(SHINE_SHARE)});
      }
      return vec4f(color, 2.0);
    }
    let close: bool = filled(here, column - 1) || filled(here, column + 1)
                   || filled(above, column - 1) || filled(above, column) || filled(above, column + 1)
                   || filled(below, column - 1) || filled(below, column) || filled(below, column + 1);
    return vec4f(${rgb(OUTLINE_COLOR)}, select(0.0, 1.0, close));
  }

  // The scroller's colour at a pixel of the picture (place: from the top
  // left), as the picture takes colours, not premultiplied; 0 outside it.
  // A pixel shows each square of a letter it overlaps as much as it
  // overlaps it, so moving edges stay smooth. Everything scrollerPaint
  // shows is the same all over one square of the text (or of the space
  // around it), and the squares are boxes: so the pixel is cut into the
  // few pieces that lie in one square each, and each piece is painted
  // once, at its middle, for its share of the pixel. (The cuts: upright
  // ones where the strips meet, every S_STRIP, and where the squares'
  // columns do, every S_SQUARE; across, where the rows do, which differ
  // from strip to strip, as the wave lifts each strip on its own.)
  fn scrollerColor(place: vec2f) -> vec4f {
    let fromBottom: f32 = $height - place.y;
    if ($textRect.z <= 0.0 || place.x < $textRect.x || place.x >= $textRect.x + $textRect.z
        || fromBottom < $textRect.y || fromBottom >= $textRect.y + $textRect.w) {
      return vec4f(0.0);
    }
    // Big pixels (hard): each square of a letter a whole number of pixels
    // (the strip is made to fit: see layout), and each pixel the colour at
    // its middle, with no smoothed edges, as the rest of the scene.
    let hard: bool = $scrollText.z > 0.5;
    let zoom: f32 = select($textRect.w / S_HEIGHT, max(1.0, round(S_SQUARE * $textRect.w / S_HEIGHT)) / S_SQUARE, hard);   // pixels per unit
    let x: f32 = (place.x - $textRect.x) / zoom;
    let y: f32 = ($textRect.y + $textRect.w - fromBottom) / zoom;
    // (Nowhere near the text's band: nothing to do.)
    let middle: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5;
    if (y < middle - S_WAVE_HEIGHT - S_SQUARE - 2.0 || y > middle + S_WAVE_HEIGHT + S_LETTER_HEIGHT + S_SQUARE + S_SHADOW + 2.0) {
      return vec4f(0.0);
    }
    let reach: f32 = select(0.5, 0.001, hard) / zoom;   // (reach a pixel, in the scroller's units: with big pixels, just its middle)
    // (Where the columns' cuts fall: see column in scrollerPaint.)
    let shift: f32 = $scroll.x - $scroll.z;
    var ink: f32 = 0.0; var inked: vec3f = vec3f(0.0); var rim: f32 = 0.0; var shadowed: f32 = 0.0;
    // The text, then its shadow: the same text, moved right and down.
    for (var layer: i32 = 0; layer < 2; layer++) {
      let offset: f32 = f32(layer) * S_SHADOW;
      // Upright cuts first (x in the text's own place, as scrollerPaint's x).
      var left: f32 = x - reach - offset;
      let right: f32 = x + reach - offset;
      for (var across: i32 = 0; across < 6; across++) {
        if (left >= right) { break; }
        let nextStrip: f32 = (floor(left / S_STRIP) + 1.0) * S_STRIP;
        let nextColumn: f32 = (floor((left + shift) / S_SQUARE) + 1.0) * S_SQUARE - shift;
        let end: f32 = min(right, min(nextStrip, nextColumn));
        let wide: f32 = end - left;
        let mid: f32 = (left + end) * 0.5;
        // This piece's strip, and so where its rows' cuts lie.
        let strip: f32 = floor(mid / S_STRIP) * S_STRIP;
        let wave: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5
                      + S_WAVE_HEIGHT * sin(strip / S_WAVE_LENGTH * S_TURN + $scroll.y);
        let top: f32 = round(wave * zoom) / zoom + offset;
        var upper: f32 = y - reach;
        let lower: f32 = y + reach;
        for (var down: i32 = 0; down < 4; down++) {
          if (upper >= lower) { break; }
          let bottom: f32 = min(lower, top + (floor((upper - top) / S_SQUARE) + 1.0) * S_SQUARE);
          let share: f32 = wide * (bottom - upper);
          let paint: vec4f = scrollerPaint(mid + offset, (upper + bottom) * 0.5, offset, zoom);
          if (layer == 0) {
            if (paint.w > 1.5) { ink += share; inked += paint.rgb * share; } else if (paint.w > 0.5) { rim += share; }
          } else {
            shadowed += paint.w * 0.5 * share;
          }
          upper = bottom;
        }
        left = end;
      }
    }
    let whole: f32 = 4.0 * reach * reach;
    let lettered: vec3f = toCanvas(inked / max(ink, 1e-9)) * (1.0 + $textGlow);   // (only the letters shine with HDR, not their outlines)
    ink /= whole; rim /= whole; shadowed /= whole;
    let covered: f32 = min(ink + rim, 1.0);
    let alpha: f32 = covered + shadowed * (1.0 - covered);
    if (alpha <= 0.0) { return vec4f(0.0); }
    return vec4f((lettered * ink + toCanvas(${rgb(OUTLINE_COLOR)}) * rim
                + toCanvas(${rgb(SHADOW_COLOR)}) * shadowed * (1.0 - covered)) / alpha, alpha);
  }
`;

export class Scroller {
  constructor() {
    // Its place on the page: an empty strip along the bottom, which the
    // renderers measure (see textRect in renderer.js) and draw the text in.
    this.strip = document.createElement('div');
    this.strip.className = 'scroller';
    this.strip.style.display = 'none';
    document.body.append(this.strip);
    this.shown = false;
    // How fast its clock runs: 1 = normal, 0 = frozen, negative = backwards.
    // main.js sets this to the Speed setting, so the scroller pauses and
    // rewinds together with the balls.
    this.rate = 1;
    this.clock = 0;        // the scroller's own time, in seconds

    // The whole text: the page's credit line, then MESSAGE. The font only
    // has capitals; anything it doesn't have becomes a space. (The German
    // ß needs a hand: its capital is ẞ, but browsers turn it into SS.)
    const credit = document.getElementById('info')?.textContent ?? '';
    this.message = (credit + MESSAGE).replaceAll('ß', 'ẞ').toUpperCase();
    // For the graphics card: each letter of the message as its number in
    // the font (255 = a space), and the font as ROWS rows of COLS bits per
    // letter (the leftmost square in the highest bit).
    const names = Object.keys(GLYPHS);
    this.letterNumbers = Uint32Array.from([...this.message], (letter) => {
      const k = names.indexOf(letter);
      return k < 0 ? 255 : k;
    });
    this.glyphRows = Uint32Array.from(names.flatMap((name) =>
      GLYPHS[name].map((row) => [...row].reduce((bits, square) => bits * 2 + (square === '#' ? 1 : 0), 0))));
  }

  // The font and then the message, as the numbers the shader reads with
  // scrollerWord (see SCROLLER_SHADER).
  get words() {
    const words = new Uint32Array(this.glyphRows.length + this.letterNumbers.length);
    words.set(this.glyphRows, 0);
    words.set(this.letterNumbers, this.glyphRows.length);
    return words;
  }

  // The strip's height on the page: less tall on a narrow screen (a phone
  // held upright). (Only written when it changes: writing a style, even the
  // same one, can make the browser lay the page out again.)
  // With big pixels (bigPixel: CSS pixels to one, see Pixel size), as tall
  // as makes each square of a letter a whole number of them, at least one
  // (see hard in SCROLLER_SHADER): taller when a big pixel is bigger than a
  // square, so that the letters still fit.
  layout(bigPixel = this.bigPixel ?? 0) {
    this.bigPixel = bigPixel;
    const narrow = innerWidth < NARROW_SCREEN ? 0.6 : 1;
    const squarePixels = Math.max(1, Math.round(SQUARE * narrow / bigPixel));
    const height = bigPixel > 0 ? `${Math.round(HEIGHT / SQUARE * squarePixels) * bigPixel}px` : `${HEIGHT * narrow}px`;
    if (this.strip.style.height !== height) this.strip.style.height = height;
  }

  // Where the text is now, for the shader ($scroll in SCROLLER_SHADER),
  // given the strip's width / height on screen: how far it has scrolled,
  // the wave's phase (in radians, kept small so the graphics card's shorter
  // numbers stay exact), the strip's width and the text's, in the
  // scroller's units (CSS pixels, before it is drawn smaller on a narrow
  // screen). (Into the same four numbers every frame: no new object.)
  // rect: where the strip is in the picture (see $textRect); hard: big
  // pixels, so the text moves on by whole pixels (see hard in the shader).
  place(rect, hard = false) {
    const zoom = hard ? Math.max(1, Math.round(SQUARE * rect[3] / HEIGHT)) / SQUARE : rect[3] / HEIGHT;   // (as in the shader)
    const width = rect[2] / zoom;
    const textWidth = this.message.length * LETTER_WIDTH;
    const lap = textWidth + width;
    let scrolled = (((this.clock * SPEED) % lap) + lap) % lap;
    if (hard) scrolled = Math.floor(scrolled * zoom) / zoom;
    const turn = 2 * Math.PI;
    const phase = (((this.clock * WAVE_TURNS) % turn) + turn) % turn;
    const placed = this.placed ??= new Float32Array(4);
    placed[0] = scrolled; placed[1] = phase; placed[2] = width; placed[3] = textWidth;
    return placed;
  }

  // Show or hide the scroller.
  setShown(shown) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.strip.style.display = shown ? '' : 'none';
    // Switched off, it starts again from the beginning of its text next time.
    if (!shown) this.clock = 0;
  }

  // Move on by `seconds` (times the rate): called by main.js once per
  // frame, just before the scene is drawn, so the text moves in step with
  // the balls.
  tick(seconds) {
    if (!this.shown) return;
    this.clock += seconds * this.rate;
    this.layout();
  }
}
