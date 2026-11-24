import{MAX_BALLS as C}from"./settings.js?v=2.04-397";import{toGlsl as i,SQUARE_WAVE as P}from"./shade.js?v=2.04-397";import{ELEMENTARY_COLOR_MATHS as c,srgbToP3Matrix as h}from"./colors.js?v=2.04-397";import{SCROLLER_SHADER as E}from"./scroller.js?v=2.04-397";const u=`
uniform float uWide;
vec3 toLinear(vec3 c) {
vec3 a = abs(c);
return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a));
}
vec3 toCanvas(vec3 c) {
const mat3 SRGB_TO_P3 = ${h("glsl")};
vec3 l = toLinear(c);
return uWide > 0.5 ? SRGB_TO_P3 * l : l;
}
`,r=200*Math.PI,v=1024,A=.001,p=192,g=2048,d=`
uniform highp sampler2D uBallData;
uniform int uBallCount;
vec4 ballSphere(int i) { return texelFetch(uBallData, ivec2(0, i), 0); }
vec4 ballColor(int i) { return texelFetch(uBallData, ivec2(1, i), 0); }
mat3 ballRotation(int i) {
return mat3(texelFetch(uBallData, ivec2(2, i), 0).xyz,
texelFetch(uBallData, ivec2(3, i), 0).xyz,
texelFetch(uBallData, ivec2(4, i), 0).xyz);
}
int ballDrawnAs(int k) { return int(texelFetch(uBallData, ivec2(5, k), 0).x); }
`,f=`
${d}
uniform vec3 uLightPosition;
uniform vec3 uLightForward;
uniform vec3 uLightSide;
uniform vec3 uLightUp;
uniform highp usampler2D uShadowCells;
uniform highp usampler2D uShadowList;
uniform float uShadowRange;
uniform float uShadowStrength;
uniform float uEdgeWidth;
uniform vec3 uShadowColor;
uniform float uShadowOpacity;
${u}
vec3 shade(vec3 color, float shadow) {
vec3 lit = toCanvas(color);
vec3 shadowed = toCanvas(color * (1.0 - uShadowStrength));
return mix(lit, shadowed, shadow);
}
float smoothEdge(float pixelsInside) {
return clamp(pixelsInside / uEdgeWidth + 0.5, 0.0, 1.0);
}
float inPixels(float worldDistance) {
return worldDistance / max(fwidth(worldDistance), 1e-6);
}
uniform highp sampler2D uFrontDepth;
bool hiddenBehindBall(float depth) {
float front = texelFetch(uFrontDepth, ivec2(gl_FragCoord.xy), 0).r;
return depth > front + 1e-5;
}
void pixelSteps(vec3 p, out vec3 stepX, out vec3 stepY) {
stepX = dFdx(p);
stepY = dFdy(p);
}
float shadowAt(vec3 p, vec3 stepX, vec3 stepY, int skipBall) {
float pixelReach = (length(stepX) + length(stepY)) * uEdgeWidth;
vec3 toLight = uLightPosition - p;
float lightDist = length(toLight);
vec3 lightDir = toLight / lightDist;
float ahead = -dot(toLight, uLightForward);
if (ahead <= 0.0) return 0.0;
vec2 seen = -vec2(dot(toLight, uLightSide), dot(toLight, uLightUp)) / ahead;
ivec2 cell = clamp(ivec2(floor((seen / (2.0 * uShadowRange) + 0.5) * ${p}.0)), ivec2(0), ivec2(${p} - 1));
float shadow = 0.0;
uint packed = texelFetch(uShadowCells, cell, 0).r;
uvec2 list = uvec2(packed >> 12u, packed & 4095u);
float reachAhead = ahead + pixelReach + ${A};
for (uint k = 0u; k < list.y; k++) {
uint entry = list.x + k;
int i = int(texelFetch(uShadowList, ivec2(int(entry % ${g}u), int(entry / ${g}u)), 0).r);
vec4 sphere = ballSphere(i);
if (dot(sphere.xyz - uLightPosition, uLightForward) - sphere.w > reachAhead) break;
if (i == skipBall) continue;
vec3 toBall = sphere.xyz - p;
float radius = sphere.w;
float along = dot(toBall, lightDir);
if (along <= 0.0 || along >= lightDist) continue;
vec3 miss = toBall - lightDir * along;
float missSq = dot(miss, miss);
if (missSq > (radius + pixelReach) * (radius + pixelReach)) continue;
float missDist = sqrt(missSq);
vec3 away = miss / max(missDist, 1e-6);
float perPixel = abs(dot(away, stepX)) + abs(dot(away, stepY));
shadow = max(shadow, smoothEdge((radius - missDist) / max(perPixel, 1e-6)));
if (shadow >= 1.0) break;
}
return shadow;
}
`,q=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProjection;
uniform float uFloorY;
uniform float uFloorHalfSize;
out vec3 vWorld;
void main() {
vWorld = vec3(aCorner.x * uFloorHalfSize, uFloorY, aCorner.y * uFloorHalfSize);
gl_Position = uViewProjection * vec4(vWorld, 1.0);
}
`,x=`
uniform highp sampler2D uFloorPieces;
uniform vec4 uFloorPiecesArea;
vec4 floorPieceAt(vec3 p) {
if (uFloorPiecesArea.z <= 0.0) return vec4(0.0);
vec2 uv = vec2((p.x - uFloorPiecesArea.x) * uFloorPiecesArea.z, (p.z - uFloorPiecesArea.y) * uFloorPiecesArea.w);
if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
ivec2 size = textureSize(uFloorPieces, 0);
float code = floor(texelFetch(uFloorPieces, ivec2(uv * vec2(size)), 0).r * 255.0 + 0.5);
if (code < 0.5) return vec4(0.0);
return vec4(code > 4.5 ? vec3(1.0) : elementaryColor(code - 1.0, uWide), 1.0);
}
vec4 floorPiecesIn(vec3 p, vec3 stepX, vec3 stepY) {
if (uFloorPiecesArea.z <= 0.0) return vec4(0.0);
if (uEdgeWidth < 0.5) return floorPieceAt(p);
vec4 sum = vec4(0.0);
for (int k = 0; k < 4; k++) {
vec2 o = vec2(float(k % 2), float(k / 2)) * 0.5 - 0.25;
vec4 c = floorPieceAt(p + stepX * o.x + stepY * o.y);
sum += vec4(c.rgb * c.a, c.a);
}
return sum.a > 0.0 ? vec4(sum.rgb / sum.a, sum.a * 0.25) : vec4(0.0);
}
`,H=`#version 300 es
precision highp float;
precision highp int;
${f}
uniform float uHalfSize;
uniform vec4 uWallShown;
uniform float uShadowsOn;
in vec3 vWorld;
out vec4 outColor;
${i(c)}
${x}
void main() {
vec3 stepX, stepY;
pixelSteps(vWorld, stepX, stepY);
if (hiddenBehindBall(gl_FragCoord.z)) discard;
vec4 piece = floorPiecesIn(vWorld, stepX, stepY);
float shadow = uShadowsOn > 0.5 ? shadowAt(vWorld, stepX, stepY, -1) : 0.0;
if (piece.a > 0.0) {
vec3 lit = mix(toLinear(piece.rgb), toLinear(piece.rgb * (1.0 - uShadowStrength)), shadow);
float under = (1.0 - piece.a) * shadow * uShadowOpacity;
float a = piece.a + under;
outColor = vec4((lit * piece.a + uShadowColor * under) / a, a);
return;
}
if ((vWorld.x < -uHalfSize && uWallShown.x > 0.5) || (vWorld.x > uHalfSize && uWallShown.y > 0.5) ||
(vWorld.z < -uHalfSize && uWallShown.z > 0.5) || (vWorld.z > uHalfSize && uWallShown.w > 0.5)) discard;
if (shadow <= 0.0) discard;
outColor = vec4(uShadowColor, shadow * uShadowOpacity);
}
`,T=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProjection;
uniform vec3 uWallCenter;
uniform vec3 uWallAxisU;
uniform vec3 uWallAxisV;
uniform float uHalfSize;
uniform vec4 uExtend;
out vec2 vGrid;
out vec3 vWorld;
const float MARGIN = 0.25;
void main() {
vec2 high = uHalfSize + MARGIN + uExtend.xz;
vec2 low = uHalfSize + MARGIN + uExtend.yw;
vGrid = mix(-low, high, aCorner * 0.5 + 0.5);
vWorld = uWallCenter + uWallAxisU * vGrid.x + uWallAxisV * vGrid.y;
gl_Position = uViewProjection * vec4(vWorld, 1.0);
}
`,m=8,W={flip:{code:1,seconds:.8,ways:2},diagonal:{code:2,seconds:.8,ways:2},spin:{code:3,seconds:.8,ways:2},shrink:{code:4,seconds:1,ways:1},slide:{code:5,seconds:1,ways:4}},L=20;function $(e){const o=Math.abs(e.x),t=Math.abs(e.y),a=Math.abs(e.z);return o>=t&&o>=a?e.x>0?"x+":"x-":t>=a?e.y>0?"y+":"y-":e.z>0?"z+":"z-"}function O(e,o,t){const a={x:Math.abs(o.x),y:Math.abs(o.y),z:Math.abs(o.z)},[b,S]=a.x>.5?[e.y,e.z]:a.y>.5?[e.x,e.z]:[e.x,e.y],l=Math.floor(b)+t,s=Math.floor(S)+t,n=2*t;return l>=0&&l<n&&s>=0&&s<n?l*n+s:-1}const D=Object.values(W).reverse().reduce((e,{code:o,seconds:t})=>`select(${e}, ${t.toFixed(2)}, kind < ${(o+.5).toFixed(1)})`,"1.0"),R=`
  fn tileSeconds(kind: f32) -> f32 { return ${D}; }
  fn tileModulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

  // Space, seen through the gap a square leaves (see spaceAt): a whole-number
  // hash, as the stars of the backdrop use (see mixBits there).
  fn tileBits(v: u32) -> u32 {
    var x: u32 = v;
    x = x ^ (x >> 16u); x = x * 0x7feb352du;
    x = x ^ (x >> 15u); x = x * 0x846ca68bu;
    return x ^ (x >> 16u);
  }

  // What lies behind a square of the grid: space, blue-black, with stars
  // (at: where on the screen, in pixels; the stars stay put there, so it
  // looks far, far away). In squares of 6 pixels, about one in six holds a
  // star, of one of eight brightnesses, a pixel or so across.
  fn spaceAt(at: vec2f) -> vec3f {
    var color: vec3f = vec3f(0.0, 0.0, 0.07);
    let cell: vec2f = floor(at / 6.0);
    let dice: u32 = tileBits(u32(cell.x + 4096.0) + tileBits(u32(cell.y + 4096.0) + 7u));
    if ((dice & 1023u) < 170u) {
      let spot: vec2f = (cell + 0.25 + 0.5 / 255.0 * vec2f(f32((dice >> 10u) & 255u), f32((dice >> 18u) & 255u))) * 6.0;
      let bright: f32 = (0.5 + 0.5 / 7.0 * f32((dice >> 26u) & 7u)) * clamp(1.6 - length(at - spot), 0.0, 1.0);
      color = max(color, vec3f(bright * 0.9, bright * 0.95, bright));
    }
    return color;
  }

  // As one layer over the wall: a colour (sRGB) covering a share of the
  // pixel (cover), over shade (black, darkening a turning panel), over the
  // gap behind the square (gap: how much of the pixel), where space shows.
  // Its colour, and how much it covers (a).
  fn overGap(gap: f32, shade: f32, cover: f32, color: vec3f, space: vec3f) -> vec4f {
    let alpha: f32 = cover + (1.0 - cover) * (shade + (1.0 - shade) * gap);
    return vec4f((color * cover + space * ((1.0 - cover) * (1.0 - shade) * gap)) / max(alpha, 0.0001), alpha);
  }

  // A square of the grid (a: from its middle, -0.5 \u2026 0.5 each way), turned
  // by 'turn' and scaled to half-width 'reach' inside its frame: the gap
  // beside it (space showing), and its outline in the grid's colour.
  fn squareInFrame(a: vec2f, turn: f32, reach: f32, perPixel: f32, lineWidth: f32, lineColor: vec3f, space: vec3f) -> vec4f {
    let c: f32 = cos(turn);
    let s: f32 = sin(turn);
    let r: vec2f = vec2f(a.x * c + a.y * s, a.y * c - a.x * s);
    let inside: f32 = (reach - max(abs(r.x), abs(r.y))) / perPixel;   // in pixels
    let inSquare: f32 = clamp(inside + 0.5, 0.0, 1.0);
    let outline: f32 = clamp(0.5 * lineWidth + 0.5 - abs(inside), 0.0, 1.0) * step(0.001, reach);
    return overGap(1.0 - inSquare, 0.0, outline, lineColor, space);
  }

  // What a click is doing to its square (f: see above) at p, where the grid's
  // coordinates are grid, on a wall whose directions are u and v. Returns a
  // colour (sRGB) and how much of this pixel it covers (a); nothing outside
  // the square. (Its frame, the grid lines round the square, stays as it is.)
  // at: where on the screen, in pixels from the bottom (for the space behind
  // it: see spaceAt).
  fn tileAt(grid: vec2f, p: vec3f, u: vec3f, v: vec3f, f: vec4f, unitsPerPixel: vec2f, lineWidth: f32, lineColor: vec3f, at: vec2f) -> vec4f {
    if (f.w < 0.0) { return vec4f(0.0); }
    let cell: vec2f = floor(grid) + 0.5;
    let middle: vec3f = p + u * (cell.x - grid.x) + v * (cell.y - grid.y);
    if (distance(middle, f.xyz) > 0.25) { return vec4f(0.0); }
    let code: f32 = floor(f.w / 10.0);
    let age: f32 = f.w - 10.0 * code;
    let variant: f32 = floor(code / 16.0);
    let kind: f32 = code - 16.0 * variant;
    let other: bool = variant > 0.5;   // the other way
    let t: f32 = clamp(age / tileSeconds(kind), 0.0, 1.0);   // 0 \u2026 1 through it
    let eased: f32 = smoothstep(0.0, 1.0, t);
    let a: vec2f = grid - cell;   // -0.5 \u2026 0.5 each way
    let perPixel: f32 = 0.5 * (unitsPerPixel.x + unitsPerPixel.y);   // grid units to a pixel
    let space: vec3f = spaceAt(at);

    // Turning over, about a middle line or a diagonal: the panel narrows to
    // nothing, seen side-on, and widens again, darkening as it turns away
    // from the light; the gap behind it shows space.
    if (kind < 2.5) {
      let across: f32 = abs(cos(3.14159265 * eased));
      // How far outside the panel's edge (above 0), in pixels. About a
      // middle line: its half-width shrinks across it. About a diagonal:
      // along it (d) the square reaches |d| + |e| = 1/\u221A2, and across it (e)
      // shrinks.
      var toSide: f32 = (abs(select(a.x, a.y, other)) - 0.5 * across) / select(unitsPerPixel.x, unitsPerPixel.y, other);
      if (kind > 1.5) {
        let d: f32 = abs(a.x + select(a.y, -a.y, other)) * 0.70710678;
        let e: f32 = abs(a.x - select(a.y, -a.y, other)) * 0.70710678;
        toSide = (across * d + e - across * 0.70710678) / sqrt(across * across + 1.0) / perPixel;
      }
      let inPanel: f32 = clamp(0.5 - toSide, 0.0, 1.0);
      let sideLine: f32 = clamp(0.5 * lineWidth + 0.5 - abs(toSide), 0.0, 1.0);
      return overGap(1.0 - inPanel, inPanel * 0.55 * (1.0 - across), sideLine, lineColor, space);
    }
    // A quarter turn flat on the wall, shrunk to fit inside its frame.
    if (kind < 3.5) {
      let turn: f32 = select(1.0, -1.0, other) * 1.5707963 * eased;
      return squareInFrame(a, turn, 0.5 / (abs(cos(turn)) + abs(sin(turn))), perPixel, lineWidth, lineColor, space);
    }
    // Shrinking to a point and growing back.
    if (kind < 4.5) {
      return squareInFrame(a, 0.0, 0.5 * abs(cos(3.14159265 * eased)), perPixel, lineWidth, lineColor, space);
    }
    // Sliding goes one of four ways: along U or V (variant 0 and 2, or 1
    // and 3), to one side or the other. s: across the square that way,
    // -0.5 \u2026 0.5, towards the side it slides to.
    let alongV: bool = tileModulo(variant, 2.0) > 0.5;
    let s: f32 = select(1.0, -1.0, variant > 1.5) * select(a.x, a.y, alongV);
    let sPerPixel: f32 = select(unitsPerPixel.x, unitsPerPixel.y, alongV);
    // Sliding out under its frame and back: the gap it leaves shows space,
    // and its trailing edge is drawn as a line.
    let behind: f32 = sin(3.14159265 * eased) - 0.5;   // where its trailing edge is
    let toSide: f32 = (behind - s) / sPerPixel;   // behind it (above 0), in pixels
    let inPanel: f32 = clamp(0.5 - toSide, 0.0, 1.0);
    let edge: f32 = clamp(0.5 * lineWidth + 0.5 - abs(toSide), 0.0, 1.0) * step(-0.49, behind);
    return overGap(1.0 - inPanel, 0.0, edge, lineColor, space);
  }

  // Which square of its wall this is, for its paint (see squareIndex
  // above), or -1 off the wall.
  fn paintSquare(grid: vec2f, p: vec3f, u: vec3f, v: vec3f, halfSize: f32) -> f32 {
    let cell: vec2f = floor(grid) + 0.5;
    if (max(abs(cell.x), abs(cell.y)) > halfSize) { return -1.0; }
    let middle: vec3f = p + u * (cell.x - grid.x) + v * (cell.y - grid.y);
    let n: vec3f = abs(cross(u, v));
    var along: vec2f = middle.xy;
    if (n.y > 0.5) { along = middle.xz; }
    if (n.x > 0.5) { along = middle.yz; }
    let ij: vec2f = floor(along) + halfSize;
    return ij.x * 2.0 * halfSize + ij.y;
  }
  // Paint (0 = none, 1 \u2026 4 a ball colour, as the balls show it: see
  // elementaryColor in colors.js, which the shader must have too): colour
  // and cover. (wide: as for the balls; the colour is then P3 already.)
  fn paintColor(paint: f32, wide: f32) -> vec4f {
    if (paint < 0.5) { return vec4f(0.0); }
    return vec4f(elementaryColor(paint - 1.0, wide), 0.85);
  }
`,G=`#version 300 es
precision highp float;
precision highp int;
${f}
uniform vec3 uColor;
uniform float uLineOpacity;
uniform float uCatchShadows;
uniform float uLineWidth;
uniform float uEdgeUnits;
uniform float uHalfSize;
uniform vec4 uDrawEdge;
uniform vec4 uExtend;
uniform vec3 uWallAxisU;
uniform vec3 uWallAxisV;
uniform vec4 uTiles[${m}];
uniform uvec4 uPaint[${L/4}];
uniform float uPainted;
in vec2 vGrid;
in vec3 vWorld;
out vec4 outColor;
${i(c)}
${i(R)}
${x}
vec3 shadeElementary(vec3 c, float shadow) {
return mix(toLinear(c), toLinear(c * (1.0 - uShadowStrength)), shadow);
}
float paintOf(float square) {
if (square < 0.0) return 0.0;
int i = int(square);
uint word = uPaint[i / 32][(i / 8) % 4];
return float((word >> uint(4 * (i % 8))) & 15u);
}
float lineCoverage(float pixelsAway, float width) {
return smoothEdge(0.5 * width - pixelsAway);
}
void main() {
vec2 slopeX = dFdx(vGrid), slopeY = dFdy(vGrid);
vec2 unitsPerPixel = sqrt(slopeX * slopeX + slopeY * slopeY);
vec2 nearestLine = floor(vGrid + 0.5);
vec2 toLine = abs((vGrid - nearestLine) / unitsPerPixel + 0.03);
vec2 toEdge = abs(abs(vGrid) - uHalfSize) / unitsPerPixel;
float coverage = 0.0;
float reach = 0.5 * uLineWidth + uEdgeWidth;
if (min(min(toLine.x, toLine.y), min(toEdge.x, toEdge.y)) < reach) {
vec2 pastEdge = (abs(vGrid) - uHalfSize) / min(unitsPerPixel, vec2(uEdgeUnits));
vec2 width = vec2(uLineWidth);
vec2 packed = width * unitsPerPixel;
vec2 fade = 1.0 - smoothstep(0.25, 0.6, packed);
vec2 inner = 1.0 - step(uHalfSize, abs(nearestLine));
vec2 ends = vec2(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
float innerAlongY = lineCoverage(toLine.x, width.x) * inner.x * fade.x * ends.x;
float innerAlongX = lineCoverage(toLine.y, width.y) * inner.y * fade.y * ends.y;
vec2 drawsEdge = vec2(vGrid.x > 0.0 ? uDrawEdge.x : uDrawEdge.y, vGrid.y > 0.0 ? uDrawEdge.z : uDrawEdge.w);
float edgeAlongY = lineCoverage(toEdge.x, width.x) * drawsEdge.x * smoothEdge(0.5 * width.x - pastEdge.x) * ends.x;
float edgeAlongX = lineCoverage(toEdge.y, width.y) * drawsEdge.y * smoothEdge(0.5 * width.y - pastEdge.y) * ends.y;
coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
}
vec4 tile = vec4(0.0);
#ifdef TILES
vec2 square = floor(vGrid) + 0.5;
vec3 squareMiddle = vWorld + uWallAxisU * (square.x - vGrid.x) + uWallAxisV * (square.y - vGrid.y);
int here = -1;
for (int i = 0; i < ${m}; i++) {
if (uTiles[i].w < 0.0) break;
if (distance(squareMiddle, uTiles[i].xyz) < 0.25) here = i;
}
if (here >= 0) tile = tileAt(vGrid, vWorld, uWallAxisU, uWallAxisV, uTiles[here], unitsPerPixel, uLineWidth, uColor, gl_FragCoord.xy);
#endif
vec4 paint = uPainted > 0.5 ? paintColor(paintOf(paintSquare(vGrid, vWorld, uWallAxisU, uWallAxisV, uHalfSize)), uWide) : vec4(0.0);
vec3 floorStepX, floorStepY;
pixelSteps(vWorld, floorStepX, floorStepY);
if (uWallAxisU.y == 0.0 && uWallAxisV.y == 0.0 && vWorld.y < 0.0) {
float under = 1.0 - floorPiecesIn(vWorld, floorStepX, floorStepY).a;
coverage *= under; tile.a *= under; paint.a *= under;
}
vec4 pastCatch = vec4(vGrid.x - uHalfSize - uExtend.x, -vGrid.x - uHalfSize - uExtend.y,
vGrid.y - uHalfSize - uExtend.z, -vGrid.y - uHalfSize - uExtend.w) / unitsPerPixel.xxyy;
vec4 inside = step(pastCatch, vec4(0.1));
float onWall = uCatchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));
vec3 stepX, stepY;
pixelSteps(vWorld, stepX, stepY);
if ((coverage <= 0.0 && onWall <= 0.0 && tile.a <= 0.0 && paint.a <= 0.0) || hiddenBehindBall(gl_FragCoord.z)) discard;
float shadow = shadowAt(vWorld, stepX, stepY, -1);
float lineLayer = coverage * uLineOpacity;
float tileLayer = tile.a * (1.0 - lineLayer);
float paintLayer = paint.a * (1.0 - lineLayer - tileLayer);
float shadowLayer = onWall * shadow * uShadowOpacity * (1.0 - lineLayer - tileLayer - paintLayer);
float opacity = lineLayer + tileLayer + paintLayer + shadowLayer;
if (opacity <= 0.0) discard;
vec3 color = shade(uColor, shadow) * lineLayer + uShadowColor * shadowLayer;
if (tileLayer > 0.0) color += shade(tile.rgb, shadow) * tileLayer;
if (paintLayer > 0.0) color += shadeElementary(paint.rgb, shadow) * paintLayer;
color /= opacity;
outColor = vec4(color, opacity);
}
`,I=`#version 300 es
precision highp float;
precision highp int;
${d}
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
out vec3 vWorld;
flat out int vBall;
void main() {
int i = ballDrawnAs(gl_InstanceID);
vBall = i;
vec3 center = ballSphere(i).xyz;
float radius = ballSphere(i).w;
vec3 toBall = center - uCameraPosition;
float distance = length(toBall);
if (distance <= radius * 1.001) {
vWorld = center;
gl_Position = vec4(0.0);
return;
}
vec3 forward = toBall / distance;
vec3 helper = abs(forward.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 right = normalize(cross(forward, helper));
vec3 up = cross(right, forward);
float halfSize = radius * distance / sqrt(distance * distance - radius * radius) * 1.1;
vWorld = center + (right * aCorner.x + up * aCorner.y) * halfSize;
gl_Position = uViewProjection * vec4(vWorld, 1.0);
}
`,V=`#version 300 es
precision highp float;
precision highp int;
${f}
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform float uGlint;
in vec3 vWorld;
flat in int vBall;
out vec4 outColor;
const float PI = 3.14159265359;
${i(P)}
void main() {
vec3 center = ballSphere(vBall).xyz;
float radius = ballSphere(vBall).w;
vec3 rayDir = normalize(vWorld - uCameraPosition);
vec3 toCenter = center - uCameraPosition;
float along = dot(toCenter, rayDir);
float missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
float coverage = smoothEdge(inPixels(radius - missDist));
float halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
vec3 hit = uCameraPosition + rayDir * (along - halfChord);
vec3 normal = normalize(hit - center);
vec3 surface = center + normal * radius;
vec4 clip = uViewProjection * vec4(surface, 1.0);
float depth = 0.5 * (clip.z / clip.w) + 0.5;
gl_FragDepth = depth;
float SQUARES_DOWN = ballColor(vBall).a;
float SQUARES_AROUND = 2.0 * SQUARES_DOWN;
vec3 n = transpose(ballRotation(vBall)) * normal;
float around = atan(n.z, n.x) / (2.0 * PI) + 0.5;
float down = acos(clamp(n.y, -1.0, 1.0)) / PI;
vec2 square = vec2(around * SQUARES_AROUND, down * SQUARES_DOWN);
vec2 blur = fwidth(square);
blur.x = min(blur.x, fwidth(fract(around + 0.5) * SQUARES_AROUND));
blur *= uEdgeWidth;
float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
vec3 stepX, stepY;
pixelSteps(surface, stepX, stepY);
if (coverage <= 0.0 || hiddenBehindBall(depth)) discard;
float shadow = shadowAt(surface, stepX, stepY, vBall);
vec3 color = mix(shade(vec3(1.0), shadow), shade(ballColor(vBall).rgb, shadow), checker);
if (uGlint > 0.0) {
vec3 toLamp = normalize(uLightPosition - surface);
vec3 halfway = normalize(toLamp - rayDir);
color += vec3(uGlint * pow(max(dot(normal, halfway), 0.0), 120.0) * (1.0 - shadow));
}
outColor = vec4(color, coverage);
}
`,X=`#version 300 es
precision highp float;
precision highp int;
${d}
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform float uEdgeWidth;
in vec3 vWorld;
flat in int vBall;
void main() {
vec3 center = ballSphere(vBall).xyz;
float radius = ballSphere(vBall).w;
vec3 rayDir = normalize(vWorld - uCameraPosition);
vec3 toCenter = center - uCameraPosition;
float along = dot(toCenter, rayDir);
float missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
float pixelsInside = (radius - missDist) / max(fwidth(missDist), 1e-6);
if (pixelsInside < 0.5 * uEdgeWidth + 0.1) discard;
float halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
vec4 clip = uViewProjection * vec4(uCameraPosition + rayDir * (along - halfChord), 1.0);
gl_FragDepth = 0.5 * (clip.z / clip.w) + 0.5;
}
`,M=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aStart;
layout(location = 2) in vec3 aEnd;
layout(location = 3) in vec3 aColor;
layout(location = 4) in vec2 aFade;
uniform mat4 uViewProjection;
uniform vec2 uViewport;
uniform float uWidth;
out vec3 vColor;
out float vFade;
out float vSide;
void main() {
vec4 start = uViewProjection * vec4(aStart, 1.0);
vec4 end = uViewProjection * vec4(aEnd, 1.0);
if (start.w < 0.05 || end.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
vec2 a = start.xy / start.w * uViewport * 0.5;
vec2 b = end.xy / end.w * uViewport * 0.5;
vec2 along = b - a;
float len = length(along);
along = len > 1e-4 ? along / len : vec2(1.0, 0.0);
vec2 across = vec2(-along.y, along.x);
float t = aCorner.x * 0.5 + 0.5;
vSide = aCorner.y * (0.5 * uWidth + 1.0);
vFade = mix(aFade.x, aFade.y, t);
vColor = aColor;
vec4 p = mix(start, end, t);
p.xy += across * vSide / (uViewport * 0.5) * p.w;
gl_Position = p;
}
`,Y=`#version 300 es
precision highp float;
uniform float uWidth;
uniform float uEdgeWidth;
in vec3 vColor;
in float vFade;
in float vSide;
out vec4 outColor;
${u}
void main() {
float coverage = clamp((0.5 * uWidth - abs(vSide)) / uEdgeWidth + 0.5, 0.0, 1.0);
outColor = vec4(toCanvas(vColor), coverage * vFade);
}
`,_=`
  // The sky behind the bars: Workbench blue at the bottom, dark blue at the top.
  fn sky(y: f32) -> vec3f { return mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y); }

  // Linear light \u2192 screen colour (sRGB), for numbers below 0 too.
  fn toSrgb(c: vec3f) -> vec3f {
    let a: vec3f = abs(c);
    return sign(c) * mix(a * 12.92, 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), a));
  }
  // Lay one bar over the colour so far: a round tube lying across the
  // screen, lit from a little above (dark at its top and bottom edges, with
  // a shine near the top), its edges smoothed over a pixel.
  fn addBar(color: vec3f, y: f32, center: f32, barColor: vec3f) -> vec3f {
    let d: f32 = (y - center) / 0.055;             // -1 at the bottom edge \u2026 1 at the top
    let edge: f32 = 1.0 / (0.055 * $height);       // (a pixel, in the same measure)
    if (abs(d) >= 1.0 + edge) { return color; }
    let normal: vec3f = vec3f(0.0, clamp(d, -1.0, 1.0), sqrt(max(0.0, 1.0 - d * d)));
    let toLamp: vec3f = normalize(vec3f(0.0, 0.45, 1.0));
    let highlight: f32 = pow(max(0.0, dot(normal, normalize(toLamp + vec3f(0.0, 0.0, 1.0)))), 30.0);
    shine = max(shine, highlight);
    // (Lit in linear light, the highlight whitening each colour alike, so
    // the four bars shade the same: no colour clips sooner than another.)
    let tube: vec3f = mix(toLinear(barColor) * (0.1 + 0.9 * max(0.0, dot(normal, toLamp))), vec3f(1.0), 0.8 * highlight);
    return mix(color, toSrgb(tube), clamp((1.0 - abs(d)) / edge + 0.5, 0.0, 1.0));
  }

  // The copper bars: four bars gliding up and down, each a little out of
  // step, in the four colours of the balls (red, green, blue and yellow),
  // over the sky. (Only the height matters: the same all along a row, so
  // worked out once per row, see COPPER_ROWS_VERTEX_SHADER.)
  fn copperBars(y: f32) -> vec3f {
    var color: vec3f = sky(y);
    color = addBar(color, y, 0.5 + 0.40 * sin($time * 0.9),       backdropColor(0.0));
    color = addBar(color, y, 0.5 + 0.40 * sin($time * 0.9 + 0.7), backdropColor(3.0));
    color = addBar(color, y, 0.5 + 0.40 * sin($time * 0.9 + 1.4), backdropColor(2.0));
    return addBar(color, y, 0.5 + 0.40 * sin($time * 0.9 + 2.1), backdropColor(1.0));
  }

  fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

  // A starfield: three layers gliding to the left at three speeds (near
  // stars fast, big and bright). Each layer is cut into squares, and a few
  // of them hold a star somewhere inside: a soft round dot. (With big
  // pixels, $hard: a hard dot, as an Amiga's stars were, its middle on
  // the middle of a pixel, so that it keeps its shape as it glides: one
  // pixel, or for the near stars a little cross of five.)
  // (Stars' dice: one whole-number hash per square and layer, its bits
  // used for whether there is a star, where and which colour. Whole
  // numbers are cheap for a graphics card, and exact everywhere.)
  fn mixBits(v: u32) -> u32 {
    var x: u32 = v;
    x = x ^ (x >> 16u); x = x * 0x7feb352du;
    x = x ^ (x >> 15u); x = x * 0x846ca68bu;
    return x ^ (x >> 16u);
  }

  fn stars(at: vec2f) -> vec3f {
    let p: vec2f = at / $height;
    var color: vec3f = mix(vec3f(0.0, 0.0, 0.13), vec3f(0.0), p.y);
    let grow: f32 = max(1.0, $height / 900.0);
    for (var layer: i32 = 0; layer < 3; layer++) {
      let k: f32 = f32(layer);
      let cell: f32 = 0.05 - 0.012 * k;
      // (How many squares the layer glides by in one BACKDROP_${r}: a
      // whole number, and the stars repeat after that many squares, so the
      // field is the same again after each period: see BACKDROP_${r}.)
      let lap: f32 = select(select(1813.0, 2480.0, k < 1.5), 2827.0, k < 0.5);
      let q: vec2f = vec2f(p.x / cell + $time * lap / ${r}, p.y / cell);
      var square: vec2f = floor(q);
      square.x = square.x - lap * floor(square.x / lap);
      let dice: u32 = mixBits(u32(square.x) + mixBits(u32(square.y) * 4u + u32(layer) + 1u));
      if ((dice & 1023u) >= 410u) { continue; }   // (no star in four squares of ten)
      let spot: vec2f = 0.2 + 0.6 / 255.0 * vec2f(f32((dice >> 10u) & 255u), f32((dice >> 18u) & 255u));
      var pixels: f32 = length(fract(q) - spot) * cell * $height;
      let size: f32 = (1.6 - 0.4 * k) * grow;
      var bright: f32 = 0.0;
      if ($hard > 0.5) {
        let middle: vec2f = (floor(q) + spot - vec2f($time * lap / ${r}, 0.0)) * cell * $height;
        pixels = length(at - (floor(middle) + 0.5));
        if (pixels > select(0.5, 1.1, k < 0.5)) { continue; }
        bright = 1.0 - 0.3 * k;
      } else {
        if (pixels > 4.0 * size) { continue; }   // (far from it: nothing of it shows)
        bright = (1.0 - 0.3 * k) * exp(-pixels * pixels / (size * size));
      }
      // (Each star white, or, six in ten, faintly one of the four ball colours.)
      let hue: u32 = dice >> 26u;   // 0 \u2026 63
      let tint: vec3f = mix(vec3f(1.0), backdropColor(f32(hue & 3u)), 0.45 * step(26.0, f32(hue)));
      color = max(color, tint * bright);
      shine = max(shine, bright);   // (with HDR every star shines, the near ones most)
    }
    return color;
  }

  // A plasma: a few slow waves added up, run round the NCS colour circle of
  // the four ball colours (yellow, red, blue, green, and back to yellow),
  // softened towards white between them.
  fn plasma(p: vec2f) -> vec3f {
    let t: f32 = $time * 0.6;
    let v: f32 = sin(p.x * 7.0 + t) + sin(p.y * 9.0 - t * 1.3) + sin((p.x + p.y) * 5.0 + t * 0.7)
               + sin(length(p - vec2f(0.8 + 0.4 * sin(t * 0.5), 0.5 + 0.3 * cos(t * 0.4))) * 11.0 - t);
    let around: f32 = fract(v * 0.25 + 38.0 * $time / ${r}) * 4.0;   // 0 \u2026 4: yellow, red, blue, green (round 38 times a period)
    let part: f32 = floor(around);
    let f: f32 = smoothstep(0.0, 1.0, around - part);
    // (In circle order: yellow 1, red 0, blue 2, green 3.)
    let first: f32 = select(select(select(3.0, 2.0, part < 2.5), 0.0, part < 1.5), 1.0, part < 0.5);
    let second: f32 = select(select(select(1.0, 3.0, part < 2.5), 2.0, part < 1.5), 0.0, part < 0.5);
    var color: vec3f = mix(backdropColor(first), backdropColor(second), f);
    color = mix(color, vec3f(1.0), 0.25 * sin(3.14159 * f));
    // (With HDR the middles of the colours glow a little.)
    shine = 0.5 * pow(1.0 - sin(3.14159 * f), 4.0);
    return color;
  }

  // Kefrens bars: on the Amiga, one short, shaded bar was drawn into a
  // single line of pixels that was shown on every screen line and never
  // cleared. Each line the bar was drawn a little further along a wave,
  // over what the lines above left there, so the bars pile up into a
  // weaving curtain. Here, every row of pixels is such a line: a pixel
  // shows the bar of the nearest row at or above it whose bar covers it.
  // (Measured in an Amiga screen's units, 256 lines high, so the curtain
  // looks the same at any size. Looking upwards row by row, but skipping
  // the rows whose bar can't reach this pixel yet: a bar moves at most
  // SLOPE units per line.)
  // (Each row's bar is worked out once per picture, on the main processor,
  // rather than for every pixel again: see kefrensRows in renderer.js. Per
  // row of pixels, from the top: where the bar's middle is, and how fast
  // that changes from row to row. kefrensRow(i) reads it.)
  fn kefrens(at: vec2f) -> vec3f {
    let unit: f32 = 256.0 / $height;   // Amiga lines per row of pixels (and Amiga pixels per pixel)
    let x: f32 = at.x * unit;
    let reach: f32 = 0.5 * $width * unit - 20.0;
    // (The most the bar's slope can change from one Amiga line to the next.)
    let bend: f32 = max(1e-6, reach * (0.6 * 0.055 * 0.055 + 0.4 * 0.023 * 0.023));
    var i: i32 = i32($height - at.y);               // this pixel's row, counted from the top
    let top: i32 = i32(ceil(24.0 / unit - 0.5));    // (no bars in the rows above 24 Amiga lines)
    // A bar's edge often runs right through a pixel: it then gets that much
    // of the bar's colour, and the rest from the bar (or sky) behind, so
    // the curtain's edges are smooth, not ragged.
    var color: vec3f = vec3f(0.0);
    var left: f32 = 1.0;   // how much of the pixel is still to fill
    for (var n: i32 = 0; n < 400; n++) {
      if (i < top) { break; }
      let row: vec2f = kefrensRow(i);
      let off: f32 = abs(x - row.x) - 8.0;
      if (off < 0.5 * unit) {
        let o: f32 = clamp((x - row.x) / 8.0, -1.0, 1.0);
        let shade: f32 = 1.0 - o * o;
        let band: f32 = floor((f32(i) + 0.5) * unit / 16.0);
        let bar: vec3f = backdropColor(band - 4.0 * floor(band / 4.0));
        let lit: vec3f = bar * (0.65 + 0.35 * shade) + vec3f(0.45) * pow(shade, 8.0);
        shine = max(shine, pow(shade, 10.0) * left);
        let cover: f32 = clamp(0.5 - off / unit, 0.0, 1.0);
        color += left * cover * lit;
        left *= 1.0 - cover;
        if (left < 0.01) { return color; }
        i -= 1;   // (on to the bar behind, a row up)
        continue;
      }
      // This row's bar misses the pixel by "off": skip the rows above whose
      // bars can't reach it either. Going up D Amiga lines, the bar moves
      // at most |slope| D + bend D\xB2 / 2 sideways, so all rows within D of
      // here are skipped where that is still less than the gap (less half a
      // pixel, the edge's smoothing).
      let s: f32 = abs(row.y);
      let gap: f32 = off - 0.5 * unit;
      let lines: f32 = (sqrt(s * s + 2.0 * bend * gap) - s) / bend;
      i -= max(1, i32(lines / unit));
    }
    return color + left * sky(at.y / $height);
  }
`,w=`
precision highp float;
uniform float uTime;
uniform float uHeight;
uniform float uWidth;
uniform float uShine;
uniform float uHard;
uniform sampler2D uPicture;
float shine = 0.0;
${u}
${i(c)}
vec3 backdropColor(float i) { return elementaryColor(i, uWide); }
uniform highp sampler2D uKefrensRows;
vec2 kefrensRow(int i) { return texelFetch(uKefrensRows, ivec2(i % ${v}, i / ${v}), 0).xy; }
${i(_,{time:"uTime",height:"uHeight",width:"uWidth",hard:"uHard"})}
`,N=e=>`#version 300 es
${w}
const float uKind = ${e}.0;
out vec4 outColor;
void main() {
vec2 at = gl_FragCoord.xy;
if (uKind > 3.5) {
vec3 c = texelFetch(uPicture, ivec2(at), 0).rgb;
outColor = vec4(mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045))), 1.0);
return;
}
vec3 color;
if (uKind > 2.5) color = kefrens(at);
else if (uKind > 1.5) color = plasma(at / uHeight);
else if (uKind > 0.5) color = stars(at);
else color = copperBars(at.y / uHeight);
outColor = vec4(toCanvas(min(color, 1.0)) * (1.0 + uShine * shine), 1.0);
}
`,U=`#version 300 es
${w}
flat out vec4 vColor;
void main() {
vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
float row = float(gl_InstanceID);
vec3 color = copperBars((row + 0.5) / uHeight);
vColor = vec4(toCanvas(min(color, 1.0)) * (1.0 + uShine * shine), 1.0);
gl_Position = vec4(corner.x * 2.0 - 1.0, (row + corner.y) / uHeight * 2.0 - 1.0, 0.0, 1.0);
}
`,j=`#version 300 es
precision highp float;
flat in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }
`,K=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,Q=`#version 300 es
precision highp float;
uniform highp sampler2D uScene;
out vec4 outColor;
vec3 toScreen(vec3 c) {
return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
vec3 linear = max(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb, 0.0);
vec3 color = toScreen(min(linear, 1.0));
outColor = vec4(color, 1.0);
}
`,y=1024,J=`#version 300 es
precision highp float;
uniform highp sampler2D uPieces;
uniform float uHeight;
uniform float uLinear;
out vec4 outColor;
void main() {
ivec2 at = ivec2(int(gl_FragCoord.x), int(uHeight - gl_FragCoord.y));
ivec2 size = textureSize(uPieces, 0);
if (at.x >= size.x || at.y < 0 || at.y >= size.y) { outColor = vec4(0.0); return; }
outColor = texelFetch(uPieces, at, 0);
if (uLinear > 0.5) {
vec3 c = outColor.rgb;
outColor.rgb = mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
}
}
`,Z=`#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uWords;
uniform vec4 uScroll;
uniform vec4 uScrollText;
uniform vec4 uTextRect;
uniform float uHeight;
uniform float uWide;
uniform float uLinear;
out vec4 outColor;
uint scrollerWord(uint i) {
return texelFetch(uWords, ivec2(int(i) % ${y}, int(i) / ${y}), 0).r;
}
vec3 toCanvas(vec3 c) {
if (uWide < 0.5) return c;
const mat3 SRGB_TO_P3 = ${h("glsl")};
vec3 light = SRGB_TO_P3 * mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
vec3 a = abs(light);
return sign(light) * mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, a));
}
${i(E,{scroll:"uScroll",scrollText:"uScrollText",textRect:"uTextRect",height:"uHeight",textGlow:"0.0"})}
void main() {
outColor = scrollerColor(vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y));
if (uLinear > 0.5) {
vec3 a = abs(outColor.rgb);
outColor.rgb = sign(outColor.rgb) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a));
}
}
`;export{_ as BACKDROP_MATHS,r as BACKDROP_PERIOD,X as BALL_DEPTH_FRAGMENT_SHADER,V as BALL_FRAGMENT_SHADER,I as BALL_VERTEX_SHADER,j as COPPER_ROWS_FRAGMENT_SHADER,U as COPPER_ROWS_VERTEX_SHADER,H as FLOOR_FRAGMENT_SHADER,q as FLOOR_VERTEX_SHADER,v as KEFRENS_ROWS_WIDE,C as MAX_BALLS,L as PAINT_WORDS,J as PIECES_FRAGMENT_SHADER,Q as PRESENT_FRAGMENT_SHADER,K as PRESENT_VERTEX_SHADER,p as SHADOW_GRID,g as SHADOW_LIST_WIDTH,A as SHADOW_ORDER_STEP,Z as TEXT_FRAGMENT_SHADER,y as TEXT_WORDS_PER_ROW,m as TILE_CLICKS,R as TILE_CLICK_MATHS,W as TILE_EFFECTS,Y as TRAIL_FRAGMENT_SHADER,M as TRAIL_VERTEX_SHADER,G as WALL_FRAGMENT_SHADER,T as WALL_VERTEX_SHADER,N as copperFragmentShader,O as squareIndex,$ as wallKey};
