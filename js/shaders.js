const e=`
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
`,n=4e3,i=200*Math.PI,a=1024,l=192,r=2048,o=`
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
`,t=`
${o}
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
${e}
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
for (uint k = 0u; k < list.y; k++) {
uint entry = list.x + k;
int i = int(texelFetch(uShadowList, ivec2(int(entry % ${r}u), int(entry / ${r}u)), 0).r);
if (i == skipBall) continue;
vec3 toBall = ballSphere(i).xyz - p;
float radius = ballSphere(i).w;
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
`,c=`#version 300 es
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
`,s=`#version 300 es
precision highp float;
precision highp int;
${t}
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
`,u=`#version 300 es
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
`,d=`#version 300 es
precision highp float;
precision highp int;
${t}
uniform vec3 uColor;
uniform float uLineOpacity;
uniform float uCatchShadows;
uniform float uLineWidth;
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
const float EDGE_UNITS = 0.05;
vec2 pastEdge = (abs(vGrid) - uHalfSize) / min(unitsPerPixel, vec2(EDGE_UNITS));
vec2 width = vec2(uLineWidth);
vec2 packed = width * unitsPerPixel;
vec2 fade = 1.0 - smoothstep(0.25, 0.6, packed);
vec2 inner = 1.0 - step(uHalfSize, abs(nearestLine));
vec2 ends = vec2(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
float innerAlongY = lineCoverage(toLine.x, width.x) * inner.x * fade.x * ends.x;
float innerAlongX = lineCoverage(toLine.y, width.y) * inner.y * fade.y * ends.y;
vec2 toEdge = abs(abs(vGrid) - uHalfSize) / unitsPerPixel;
vec2 drawsEdge = vec2(vGrid.x > 0.0 ? uDrawEdge.x : uDrawEdge.y, vGrid.y > 0.0 ? uDrawEdge.z : uDrawEdge.w);
float edgeAlongY = lineCoverage(toEdge.x, width.x) * drawsEdge.x * smoothEdge(0.5 * width.x - pastEdge.x) * ends.x;
float edgeAlongX = lineCoverage(toEdge.y, width.y) * drawsEdge.y * smoothEdge(0.5 * width.y - pastEdge.y) * ends.y;
float coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
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
`,v=`#version 300 es
precision highp float;
precision highp int;
${o}
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
`,f=`#version 300 es
precision highp float;
precision highp int;
${t}
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform float uGlint;
in vec3 vWorld;
flat in int vBall;
out vec4 outColor;
const float PI = 3.14159265359;
float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
float squareWave(float x, float blur) {
blur = max(blur, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
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
`,h=`#version 300 es
precision highp float;
precision highp int;
${o}
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
`,p=`#version 300 es
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
`,m=`#version 300 es
precision highp float;
uniform float uWidth;
uniform float uEdgeWidth;
in vec3 vColor;
in float vFade;
in float vSide;
out vec4 outColor;
${e}
void main() {
float coverage = clamp((0.5 * uWidth - abs(vSide)) / uEdgeWidth + 0.5, 0.0, 1.0);
outColor = vec4(toCanvas(vColor), coverage * vFade);
}
`,g=`#version 300 es
precision highp float;
uniform float uTime;
uniform float uHeight;
uniform float uWidth;
uniform float uShine;
uniform float uKind;
out vec4 outColor;
float shine = 0.0;
${e}
vec3 ballColor(float i) {
bool wide = uWide > 0.5;
return i < 0.5 ? (wide ? vec3( 0.8242, -0.1608, 0.1756) : vec3(0.769, 0.008, 0.200))
: i < 1.5 ? (wide ? vec3( 1.0176, 0.8609, -0.3058) : vec3(1.000, 0.827, 0.000))
: i < 2.5 ? (wide ? vec3(-0.2504, 0.5236, 0.7784) : vec3(0.000, 0.529, 0.741))
: (wide ? vec3(-0.3157, 0.6472, 0.3911) : vec3(0.000, 0.624, 0.420));
}
vec3 sky(float y) { return mix(vec3(0.4, 0.53, 0.73), vec3(0.0, 0.0, 0.27), y); }
vec3 toSrgb(vec3 c) {
vec3 a = abs(c);
return sign(c) * mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, a));
}
vec3 addBar(vec3 color, float y, float center, vec3 barColor) {
float d = (y - center) / 0.055;
float edge = 1.0 / (0.055 * uHeight);
if (abs(d) >= 1.0 + edge) return color;
vec3 normal = vec3(0.0, clamp(d, -1.0, 1.0), sqrt(max(0.0, 1.0 - d * d)));
vec3 toLamp = normalize(vec3(0.0, 0.45, 1.0));
float highlight = pow(max(0.0, dot(normal, normalize(toLamp + vec3(0.0, 0.0, 1.0)))), 30.0);
shine = max(shine, highlight);
vec3 tube = mix(toLinear(barColor) * (0.1 + 0.9 * max(0.0, dot(normal, toLamp))), vec3(1.0), 0.8 * highlight);
return mix(color, toSrgb(tube), clamp((1.0 - abs(d)) / edge + 0.5, 0.0, 1.0));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 stars(vec2 at) {
vec2 p = at / uHeight;
vec3 color = mix(vec3(0.0, 0.0, 0.13), vec3(0.0), p.y);
for (int layer = 0; layer < 3; layer++) {
float k = float(layer);
float cell = 0.05 - 0.012 * k;
float lap = k < 0.5 ? 2827.0 : k < 1.5 ? 2480.0 : 1813.0;
vec2 q = vec2(p.x / cell + uTime * lap / ${i}, p.y / cell);
vec2 square = floor(q);
square.x = mod(square.x, lap);
if (hash(square + 7.0 * k) > 0.4) continue;
vec2 spot = 0.2 + 0.6 * vec2(hash(square + 1.3 + k), hash(square + 2.9 + k));
float pixels = length(fract(q) - spot) * cell * uHeight;
float size = (1.6 - 0.4 * k) * max(1.0, uHeight / 900.0);
float bright = (1.0 - 0.3 * k) * exp(-pixels * pixels / (size * size));
vec3 tint = mix(vec3(1.0), ballColor(floor(hash(square + 4.1 + k) * 4.0)), 0.45 * step(0.4, hash(square + 5.7 + k)));
color = max(color, tint * bright);
shine = max(shine, bright);
}
return color;
}
vec3 plasma(vec2 p) {
float t = uTime * 0.6;
float v = sin(p.x * 7.0 + t) + sin(p.y * 9.0 - t * 1.3) + sin((p.x + p.y) * 5.0 + t * 0.7)
+ sin(length(p - vec2(0.8 + 0.4 * sin(t * 0.5), 0.5 + 0.3 * cos(t * 0.4))) * 11.0 - t);
float around = fract(v * 0.25 + 38.0 * uTime / ${i}) * 4.0;
float part = floor(around), f = smoothstep(0.0, 1.0, around - part);
float first = part < 0.5 ? 1.0 : part < 1.5 ? 0.0 : part < 2.5 ? 2.0 : 3.0;
float second = part < 0.5 ? 0.0 : part < 1.5 ? 2.0 : part < 2.5 ? 3.0 : 1.0;
vec3 color = mix(ballColor(first), ballColor(second), f);
color = mix(color, vec3(1.0), 0.25 * sin(3.14159 * f));
shine = 0.5 * pow(1.0 - sin(3.14159 * f), 4.0);
return color;
}
uniform highp sampler2D uKefrensRows;
vec2 kefrensRow(int i) { return texelFetch(uKefrensRows, ivec2(i % ${a}, i / ${a}), 0).xy; }
vec3 kefrens(vec2 at) {
float unit = 256.0 / uHeight;
float x = at.x * unit;
float reach = 0.5 * uWidth * unit - 20.0;
float bend = max(1e-6, reach * (0.6 * 0.055 * 0.055 + 0.4 * 0.023 * 0.023));
int i = int(uHeight - at.y);
int top = int(ceil(24.0 / unit - 0.5));
vec3 color = vec3(0.0);
float left = 1.0;
for (int n = 0; n < 400; n++) {
if (i < top) break;
vec2 row = kefrensRow(i);
float off = abs(x - row.x) - 8.0;
if (off < 0.5 * unit) {
float o = clamp((x - row.x) / 8.0, -1.0, 1.0);
float shade = 1.0 - o * o;
vec3 bar = ballColor(mod(floor((float(i) + 0.5) * unit / 16.0), 4.0));
vec3 lit = bar * (0.65 + 0.35 * shade) + vec3(0.45) * pow(shade, 8.0);
shine = max(shine, pow(shade, 10.0) * left);
float cover = clamp(0.5 - off / unit, 0.0, 1.0);
color += left * cover * lit;
left *= 1.0 - cover;
if (left < 0.01) return color;
i -= 1;
continue;
}
float s = abs(row.y), gap = off - 0.5 * unit;
float lines = (sqrt(s * s + 2.0 * bend * gap) - s) / bend;
i -= max(1, int(lines / unit));
}
return color + left * sky(at.y / uHeight);
}
void main() {
vec2 at = gl_FragCoord.xy;
vec3 color;
if (uKind > 2.5) color = kefrens(at);
else if (uKind > 1.5) color = plasma(at / uHeight);
else if (uKind > 0.5) color = stars(at);
else {
float y = at.y / uHeight;
color = sky(y);
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9), ballColor(0.0));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 0.7), ballColor(3.0));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 1.4), ballColor(2.0));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 2.1), ballColor(1.0));
}
outColor = vec4(toCanvas(min(color, 1.0)) * (1.0 + uShine * shine), 1.0);
}
`,x=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,w=`#version 300 es
precision highp float;
uniform highp sampler2D uScene;
uniform float uColorLevels;
out vec4 outColor;
vec3 toScreen(vec3 c) {
return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
vec3 linear = max(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb, 0.0);
vec3 color = toScreen(min(linear, 1.0));
if (uColorLevels > 0.0) color = floor(color * uColorLevels + 0.5) / uColorLevels;
outColor = vec4(color, 1.0);
}
`;export{i as BACKDROP_PERIOD,h as BALL_DEPTH_FRAGMENT_SHADER,f as BALL_FRAGMENT_SHADER,v as BALL_VERTEX_SHADER,g as COPPER_FRAGMENT_SHADER,s as FLOOR_FRAGMENT_SHADER,c as FLOOR_VERTEX_SHADER,a as KEFRENS_ROWS_WIDE,n as MAX_BALLS,w as PRESENT_FRAGMENT_SHADER,x as PRESENT_VERTEX_SHADER,l as SHADOW_GRID,r as SHADOW_LIST_WIDTH,m as TRAIL_FRAGMENT_SHADER,p as TRAIL_VERTEX_SHADER,d as WALL_FRAGMENT_SHADER,u as WALL_VERTEX_SHADER};
