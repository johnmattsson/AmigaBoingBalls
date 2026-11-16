const i=1e3,t=192,a=2048,e=`
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
`,o=`
${e}
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
vec3 toLinear(vec3 c) {
return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 shade(vec3 color, float shadow) {
vec3 lit = toLinear(color);
vec3 shadowed = toLinear(color * (1.0 - uShadowStrength));
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
ivec2 cell = clamp(ivec2(floor((seen / (2.0 * uShadowRange) + 0.5) *192.0)), ivec2(0), ivec2(192- 1));
float shadow = 0.0;
uint packed = texelFetch(uShadowCells, cell, 0).r;
uvec2 list = uvec2(packed >> 12u, packed & 4095u);
for (uint k = 0u; k < list.y; k++) {
uint entry = list.x + k;
int i = int(texelFetch(uShadowList, ivec2(int(entry %2048u), int(entry /2048u)), 0).r);
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
`,r=`#version 300 es
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
`,l=`#version 300 es
precision highp float;
precision highp int;
${o}
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
`,n=`#version 300 es
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
`,c=`#version 300 es
precision highp float;
precision highp int;
${o}
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
float lineCoverage(float pixelsAway) {
return smoothEdge(0.5 * uLineWidth - pixelsAway);
}
void main() {
vec2 unitsPerPixel = fwidth(vGrid);
vec2 nearestLine = floor(vGrid + 0.5);
vec2 toLine = abs((vGrid - nearestLine) / unitsPerPixel + 0.03);
float keepX = nearestLine.x >= uHalfSize ? uDrawEdge.x : nearestLine.x <= -uHalfSize ? uDrawEdge.y : 1.0;
float keepY = nearestLine.y >= uHalfSize ? uDrawEdge.z : nearestLine.y <= -uHalfSize ? uDrawEdge.w : 1.0;
float coverage = max(lineCoverage(toLine.x) * keepX, lineCoverage(toLine.y) * keepY);
vec2 pastEdge = (abs(vGrid) - uHalfSize) / unitsPerPixel;
coverage *= lineCoverage(max(pastEdge.x, pastEdge.y));
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
`,s=`#version 300 es
precision highp float;
precision highp int;
${e}
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
`,u=`#version 300 es
precision highp float;
precision highp int;
${o}
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
`,d=`#version 300 es
precision highp float;
precision highp int;
${e}
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
`,v=`#version 300 es
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
`,f=`#version 300 es
precision highp float;
uniform float uWidth;
uniform float uEdgeWidth;
in vec3 vColor;
in float vFade;
in float vSide;
out vec4 outColor;
vec3 toLinear(vec3 c) {
return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
float coverage = clamp((0.5 * uWidth - abs(vSide)) / uEdgeWidth + 0.5, 0.0, 1.0);
outColor = vec4(toLinear(vColor), coverage * vFade);
}
`,h=`#version 300 es
precision highp float;
uniform float uTime;
uniform float uHeight;
uniform float uShine;
out vec4 outColor;
float shine = 0.0;
const float LINES = 256.0;
const float LEVELS = 15.0;
vec3 toLinear(vec3 c) {
return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 addBar(vec3 color, float y, float center, vec3 barColor) {
float d = abs(y - center) / 0.055;
if (d >= 1.0) return color;
float glow = 1.0 - d * d;
float highlight = pow(glow, 6.0);
shine = max(shine, highlight);
return barColor * glow + vec3(0.6) * highlight;
}
void main() {
float y = (floor(gl_FragCoord.y / uHeight * LINES) + 0.5) / LINES;
vec3 color = mix(vec3(0.4, 0.53, 0.73), vec3(0.0, 0.0, 0.27), y);
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9), vec3(0.769, 0.008, 0.200));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 0.7), vec3(0.000, 0.624, 0.420));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 1.4), vec3(0.000, 0.529, 0.741));
color = addBar(color, y, 0.5 + 0.40 * sin(uTime * 0.9 + 2.1), vec3(1.000, 0.827, 0.000));
color = floor(min(color, 1.0) * LEVELS + 0.5) / LEVELS;
float boost = 1.0 + uShine * floor(shine * LEVELS + 0.5) / LEVELS;
outColor = vec4(toLinear(color) * boost, 1.0);
}
`,p=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,m=`#version 300 es
precision highp float;
uniform highp sampler2D uScene;
uniform float uColorLevels;
uniform float uHdrRange;
uniform sampler2D uText;
uniform vec4 uTextRect;
uniform float uTextGlow;
out vec4 outColor;
vec3 toScreen(vec3 c) {
return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toLinear(vec3 c) {
return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
const float SDR_SHARE = 0.8;
void main() {
vec3 linear = max(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb, 0.0);
if (uTextRect.z > 0.0) {
vec2 t = (gl_FragCoord.xy - uTextRect.xy) / uTextRect.zw;
if (all(greaterThanEqual(t, vec2(0.0))) && all(lessThan(t, vec2(1.0)))) {
vec4 letter = texture(uText, vec2(t.x, 1.0 - t.y));
linear = mix(linear, toLinear(letter.rgb) * (1.0 + uTextGlow), letter.a);
}
}
vec3 color = toScreen(min(linear, 1.0));
if (uColorLevels > 0.0) color = floor(color * uColorLevels + 0.5) / uColorLevels;
if (uHdrRange > 0.0) {
vec3 above = clamp((linear - 1.0) / (uHdrRange - 1.0), 0.0, 1.0);
color = mix(color * SDR_SHARE, SDR_SHARE + (1.0 - SDR_SHARE) * above, vec3(greaterThan(linear, vec3(1.0))));
}
outColor = vec4(color, 1.0);
}
`;export{d as BALL_DEPTH_FRAGMENT_SHADER,u as BALL_FRAGMENT_SHADER,s as BALL_VERTEX_SHADER,h as COPPER_FRAGMENT_SHADER,l as FLOOR_FRAGMENT_SHADER,r as FLOOR_VERTEX_SHADER,i as MAX_BALLS,m as PRESENT_FRAGMENT_SHADER,p as PRESENT_VERTEX_SHADER,t as SHADOW_GRID,a as SHADOW_LIST_WIDTH,f as TRAIL_FRAGMENT_SHADER,v as TRAIL_VERTEX_SHADER,c as WALL_FRAGMENT_SHADER,n as WALL_VERTEX_SHADER};
