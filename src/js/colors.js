// =============================================================================
// colors.js — the Boing Ball colours, written down once. Everything that
// shows them takes them from here: the physics (which colour a new ball
// gets), both renderers' ball tables, the backdrops, the effects, the
// Twist and the paint on the walls (see the shaders that are written out
// from here, below).
// =============================================================================

// The four "elementary" colours of the balls (sRGB, as 0xRRGGBB).
export const RED = 0xc40233;
export const GREEN = 0x009f6b;
export const BLUE = 0x0087bd;
export const YELLOW = 0xffd300;

// The order new balls take them (see Ball in physics.js).
export const BALL_COLORS = [RED, GREEN, BLUE, YELLOW];
// "Colour i" in the shaders (see elementaryColor below): red, yellow, blue,
// green.
const ELEMENTARY = [RED, YELLOW, BLUE, GREEN];

// They are the NCS elementary colours, which sRGB can only approximate. A
// P3 screen can come closer, so there they move from the sRGB colour
// straight towards the true NCS colour (in CIELAB), as far as P3 reaches;
// the hue stays:
//   red    #C40233 → P3 (192, 0, 51)     yellow #FFD300 → P3 (253, 221, 0)
//   blue   #0087BD → P3 (0, 131, 193)    green  #009F6B → P3 (0, 162, 105)
// They are given here as the sRGB numbers that make those P3 colours (some
// below 0 or above 1: outside what sRGB can show), so the scene can treat
// them as any other colour.
export const ELEMENTARY_IN_P3 = new Map([
  [RED, [0.8242, -0.1608, 0.1756]],
  [YELLOW, [1.0176, 0.8609, -0.3058]],
  [BLUE, [-0.2504, 0.5236, 0.7784]],
  [GREEN, [-0.3157, 0.6472, 0.3911]],
]);
// On a screen that shows even more, close to Rec. 2020 (TV's wide colour),
// they go on along the same line as far as Rec. 2020 reaches: about a third
// more colourful again (green and blue the most). Only with WebGPU and HDR
// on: then the canvas takes colours beyond P3, and the screen shows what it
// can of them (see colourLevel in gpu-renderer.js):
//   red    → Rec. 2020 (185, 0, 42)     yellow → Rec. 2020 (243, 224, 0)
//   blue   → Rec. 2020 (0, 124, 212)    green  → Rec. 2020 (0, 167, 93)
export const ELEMENTARY_IN_2020 = new Map([
  [RED, [0.9059, -0.2723, 0.1406]],
  [YELLOW, [1.0212, 0.8716, -0.3339]],
  [BLUE, [-0.4457, 0.5113, 0.8618]],
  [GREEN, [-0.5210, 0.6906, 0.3214]],
]);

// 0xRRGGBB → [r, g, b], each 0 … 1.
export function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// A ball's colour, as the scene uses it: sRGB numbers between 0 and 1, or on
// a wide-colour screen, for the four elementary colours, the numbers above.
// (level: 0 or false = sRGB, 1 or true = Display P3, 2 = Rec. 2020.)
export function ballRgb(hex, level) {
  const table = level === 2 ? ELEMENTARY_IN_2020 : level ? ELEMENTARY_IN_P3 : null;
  return table?.get(hex) || hexToRgb(hex);
}

// Linear sRGB light → linear Display P3 light (its rows): how every colour
// is converted for a wide-colour canvas (see renderer.js). Grey and white
// stay as they are.
export const SRGB_TO_P3 = [
  [0.8224620, 0.1775380, 0],
  [0.0331942, 0.9668058, 0],
  [0.0170826, 0.0723974, 0.9105199],
];

// Which of the elementary colours (in the order of elementaryColor, below)
// a colour is, or -1: none of them.
export const elementaryIndex = (hex) => ELEMENTARY.indexOf(hex & 0xffffff);

// A ball's colour as a CSS colour for a 2D canvas: sRGB, or on a wide-colour
// canvas ("display-p3"), the same colour as the scene shows it there (see
// ballRgb), in Display P3 numbers. (For the pieces of a burst ball: see
// shell-pieces.js.) Also as [r, g, b], each 0 … 255.
export function canvasColor(hex, wide) {
  if (!wide) return { css: `rgb(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255})`, rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] };
  const toLinear = (c) => Math.sign(c) * (Math.abs(c) <= 0.04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
  const toScreen = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const light = ballRgb(hex, 1).map(toLinear);
  const p3 = SRGB_TO_P3.map((row) => toScreen(Math.min(1, Math.max(0, row[0] * light[0] + row[1] * light[1] + row[2] * light[2]))));
  return { css: `color(display-p3 ${p3.map((c) => c.toFixed(4)).join(' ')})`, rgb: p3.map((c) => Math.round(255 * c)) };
}

// ---- For the shaders ---------------------------------------------------------
// SRGB_TO_P3 as a shader's matrix (given by columns). (lang: 'glsl' or 'wgsl'.)
export function srgbToP3Matrix(lang) {
  const columns = [0, 1, 2].map((k) => SRGB_TO_P3.map((row) => (row[k] === 0 ? '0.0' : row[k].toFixed(7))).join(', '));
  return `${lang === 'glsl' ? 'mat3' : 'mat3x3f'}(${columns.join(', ')})`;
}
// An elementary colour as a shader writes it: sRGB with three decimals (as
// they have always been written there), the wide numbers as they are.
// (lang: 'glsl' or 'wgsl'.)
function colorCode(hex, level, lang) {
  const c = level ? ballRgb(hex, level) : hexToRgb(hex).map((v) => Number(v.toFixed(3)));
  const n = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return `${lang === 'glsl' ? 'vec3' : 'vec3f'}(${c.map(n).join(', ')})`;
}
// A list of them, in an order (e.g. BALL_COLORS), for an array in a shader.
export const colorList = (order, level, lang) => order.map((hex) => colorCode(hex, level, lang)).join(', ');

// Colour i (0 … 3: see ELEMENTARY) as a screen colour: sRGB, or on a wide
// screen (wide 1: P3; 2: as far as Rec. 2020) the numbers above. In the
// notation of shade.js, for both kinds of shader.
const elementaryCase = (hex) => `
      if (wide > 1.5) { return ${colorCode(hex, 2, 'wgsl')}; }
      if (wide > 0.5) { return ${colorCode(hex, 1, 'wgsl')}; }
      return ${colorCode(hex, 0, 'wgsl')};`;
export const ELEMENTARY_COLOR_MATHS = `
  fn elementaryColor(i: f32, wide: f32) -> vec3f {
${ELEMENTARY.slice(0, 3).map((hex, k) => `    if (i < ${k + 0.5}) {${elementaryCase(hex)}
    }`).join('\n')}${elementaryCase(ELEMENTARY[3])}
  }
`;
