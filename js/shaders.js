import{MAX_BALLS as d}from"./settings.js?v=2.04-325";import{toGlsl as o,SQUARE_WAVE as h}from"./shade.js?v=2.04-325";import{SCROLLER_SHADER as f}from"./scroller.js?v=2.04-325";const t=`
uniform float uWide;
vec3 toLinear(vec3 c) {
vec3 a = abs(c);
return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a));
}
vec3 toCanvas(vec3 c) {
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
vec3 l = toLinear(c);
return uWide > 0.5 ? SRGB_TO_P3 * l : l;
}
`,e=200*Math.PI,a=1024,v=.001,l=192,n=2048,i=`
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
`,r=`
${i}
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
${t}
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
ivec2 cell = clamp(ivec2(floor((seen / (2.0 * uShadowRange) + 0.5) * ${l}.0)), ivec2(0), ivec2(${l} - 1));
float shadow = 0.0;
uint packed = texelFetch(uShadowCells, cell, 0).r;
uvec2 list = uvec2(packed >> 12u, packed & 4095u);
float reachAhead = ahead + pixelReach + ${v};
for (uint k = 0u; k < list.y; k++) {
uint entry = list.x + k;
int i = int(texelFetch(uShadowList, ivec2(int(entry % ${n}u), int(entry / ${n}u)), 0).r);
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
`,w=`#version 300 es
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
`,y=`#version 300 es
precision highp float;
precision highp int;
${r}
uniform float uHalfSize;
uniform vec4 uWallShown;
in vec3 vWorld;
out vec4 outColor;
void main() {
vec3 stepX, stepY;
pixelSteps(vWorld, stepX, stepY);
if (hiddenBehindBall(gl_FragCoord.z)) discard;
if ((vWorld.x < -uHalfSize && uWallShown.x > 0.5) || (vWorld.x > uHalfSize && uWallShown.y > 0.5) ||
(vWorld.z < -uHalfSize && uWallShown.z > 0.5) || (vWorld.z > uHalfSize && uWallShown.w > 0.5)) discard;
float shadow = shadowAt(vWorld, stepX, stepY, -1);
if (shadow <= 0.0) discard;
outColor = vec4(uShadowColor, shadow * uShadowOpacity);
}
`,b=`#version 300 es
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
`,S=`#version 300 es
precision highp float;
precision highp int;
${r}
uniform vec3 uColor;
uniform float uLineOpacity;
uniform float uCatchShadows;
uniform float uLineWidth;
uniform float uEdgeUnits;
uniform float uHalfSize;
uniform vec4 uDrawEdge;
uniform vec4 uExtend;
in vec2 vGrid;
in vec3 vWorld;
out vec4 outColor;
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
vec4 pastCatch = vec4(vGrid.x - uHalfSize - uExtend.x, -vGrid.x - uHalfSize - uExtend.y,
vGrid.y - uHalfSize - uExtend.z, -vGrid.y - uHalfSize - uExtend.w) / unitsPerPixel.xxyy;
vec4 inside = step(pastCatch, vec4(0.1));
float onWall = uCatchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));
vec3 stepX, stepY;
pixelSteps(vWorld, stepX, stepY);
if ((coverage <= 0.0 && onWall <= 0.0) || hiddenBehindBall(gl_FragCoord.z)) discard;
float shadow = shadowAt(vWorld, stepX, stepY, -1);
float lineLayer = coverage * uLineOpacity;
float shadowLayer = onWall * shadow * uShadowOpacity * (1.0 - lineLayer);
float opacity = lineLayer + shadowLayer;
if (opacity <= 0.0) discard;
vec3 color = (shade(uColor, shadow) * lineLayer + uShadowColor * shadowLayer) / opacity;
outColor = vec4(color, opacity);
}
`,C=`#version 300 es
precision highp float;
precision highp int;
${i}
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
`,E=`#version 300 es
precision highp float;
precision highp int;
${r}
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform float uGlint;
in vec3 vWorld;
flat in int vBall;
out vec4 outColor;
const float PI = 3.14159265359;
${o(h)}
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
`,D=`#version 300 es
precision highp float;
precision highp int;
${i}
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
`,R=`#version 300 es
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
`,_=`#version 300 es
precision highp float;
uniform float uWidth;
uniform float uEdgeWidth;
in vec3 vColor;
in float vFade;
in float vSide;
out vec4 outColor;
${t}
void main() {
float coverage = clamp((0.5 * uWidth - abs(vSide)) / uEdgeWidth + 0.5, 0.0, 1.0);
outColor = vec4(toCanvas(vColor), coverage * vFade);
}
`,p=`
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
  // of them hold a star somewhere inside: a soft round dot.
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
      // (How many squares the layer glides by in one BACKDROP_${e}: a
      // whole number, and the stars repeat after that many squares, so the
      // field is the same again after each period: see BACKDROP_${e}.)
      let lap: f32 = select(select(1813.0, 2480.0, k < 1.5), 2827.0, k < 0.5);
      let q: vec2f = vec2f(p.x / cell + $time * lap / ${e}, p.y / cell);
      var square: vec2f = floor(q);
      square.x = square.x - lap * floor(square.x / lap);
      let dice: u32 = mixBits(u32(square.x) + mixBits(u32(square.y) * 4u + u32(layer) + 1u));
      if ((dice & 1023u) >= 410u) { continue; }   // (no star in four squares of ten)
      let spot: vec2f = 0.2 + 0.6 / 255.0 * vec2f(f32((dice >> 10u) & 255u), f32((dice >> 18u) & 255u));
      let pixels: f32 = length(fract(q) - spot) * cell * $height;
      let size: f32 = (1.6 - 0.4 * k) * grow;
      if (pixels > 4.0 * size) { continue; }   // (far from it: nothing of it shows)
      let bright: f32 = (1.0 - 0.3 * k) * exp(-pixels * pixels / (size * size));
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
    let around: f32 = fract(v * 0.25 + 38.0 * $time / ${e}) * 4.0;   // 0 \u2026 4: yellow, red, blue, green (round 38 times a period)
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
`,s=`
precision highp float;
uniform float uTime;
uniform float uHeight;
uniform float uWidth;
uniform float uShine;
uniform sampler2D uPicture;
float shine = 0.0;
${t}
vec3 backdropColor(float i) {
bool wide = uWide > 0.5;
return i < 0.5 ? (wide ? vec3( 0.8242, -0.1608, 0.1756) : vec3(0.769, 0.008, 0.200))
: i < 1.5 ? (wide ? vec3( 1.0176, 0.8609, -0.3058) : vec3(1.000, 0.827, 0.000))
: i < 2.5 ? (wide ? vec3(-0.2504, 0.5236, 0.7784) : vec3(0.000, 0.529, 0.741))
: (wide ? vec3(-0.3157, 0.6472, 0.3911) : vec3(0.000, 0.624, 0.420));
}
uniform highp sampler2D uKefrensRows;
vec2 kefrensRow(int i) { return texelFetch(uKefrensRows, ivec2(i % ${a}, i / ${a}), 0).xy; }
${o(p,{time:"uTime",height:"uHeight",width:"uWidth"})}
`,A=u=>`#version 300 es
${s}
const float uKind = ${u}.0;
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
`,W=`#version 300 es
${s}
flat out vec4 vColor;
void main() {
vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
float row = float(gl_InstanceID);
vec3 color = copperBars((row + 0.5) / uHeight);
vColor = vec4(toCanvas(min(color, 1.0)) * (1.0 + uShine * shine), 1.0);
gl_Position = vec4(corner.x * 2.0 - 1.0, (row + corner.y) / uHeight * 2.0 - 1.0, 0.0, 1.0);
}
`,P=`#version 300 es
precision highp float;
flat in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }
`,L=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,B=`#version 300 es
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
`,c=1024,k=`#version 300 es
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
return texelFetch(uWords, ivec2(int(i) % ${c}, int(i) / ${c}), 0).r;
}
vec3 toCanvas(vec3 c) {
if (uWide < 0.5) return c;
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
vec3 light = SRGB_TO_P3 * mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
vec3 a = abs(light);
return sign(light) * mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, a));
}
${o(f,{scroll:"uScroll",scrollText:"uScrollText",textRect:"uTextRect",height:"uHeight",textGlow:"0.0"})}
void main() {
outColor = scrollerColor(vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y));
if (uLinear > 0.5) {
vec3 a = abs(outColor.rgb);
outColor.rgb = sign(outColor.rgb) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a));
}
}
`;export{p as BACKDROP_MATHS,e as BACKDROP_PERIOD,D as BALL_DEPTH_FRAGMENT_SHADER,E as BALL_FRAGMENT_SHADER,C as BALL_VERTEX_SHADER,P as COPPER_ROWS_FRAGMENT_SHADER,W as COPPER_ROWS_VERTEX_SHADER,y as FLOOR_FRAGMENT_SHADER,w as FLOOR_VERTEX_SHADER,a as KEFRENS_ROWS_WIDE,d as MAX_BALLS,B as PRESENT_FRAGMENT_SHADER,L as PRESENT_VERTEX_SHADER,l as SHADOW_GRID,n as SHADOW_LIST_WIDTH,v as SHADOW_ORDER_STEP,k as TEXT_FRAGMENT_SHADER,c as TEXT_WORDS_PER_ROW,_ as TRAIL_FRAGMENT_SHADER,R as TRAIL_VERTEX_SHADER,S as WALL_FRAGMENT_SHADER,b as WALL_VERTEX_SHADER,A as copperFragmentShader};
