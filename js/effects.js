import{openEffectWindow as Z,twistOptions as $,createProgram as L,GPU_FORMAT as _,effectTime as I}from"./twist.js?v=2.04-251";import{HDR_RANGE as ee}from"./gpu-renderer.js?v=2.04-251";import{onP3Screen as U,onRec2020Screen as te}from"./renderer.js?v=2.04-251";const oe=400,re=300,A=`
uniform float uTime, uAspect, uGlow, uHdrRange, uWide, uRadius;
uniform vec2 uSize;
const float PI = 3.14159265359;
vec3 toLinear(vec3 c) { vec3 a = abs(c); return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a)); }
vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 light(vec3 c) {
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826, 0.1775380, 0.9668058, 0.0723974, 0.0, 0.0, 0.9105199);
vec3 l = toLinear(c);
return uWide > 0.5 ? SRGB_TO_P3 * l : l;
}
vec3 ballColor(int i) {
bool w = uWide > 0.5;
if (i == 0) return w ? vec3( 0.8242, -0.1608, 0.1756) : vec3(0.769, 0.008, 0.200);
if (i == 1) return w ? vec3( 1.0176, 0.8609, -0.3058) : vec3(1.000, 0.827, 0.000);
if (i == 2) return w ? vec3(-0.2504, 0.5236, 0.7784) : vec3(0.000, 0.529, 0.741);
return w ? vec3(-0.3157, 0.6472, 0.3911) : vec3(0.000, 0.624, 0.420);
}
vec3 sky(vec2 p) {
return light(mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), p.y / uSize.y));
}
float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
float squareWave(float x, float blur) { blur = max(blur, 1e-4); return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur; }
float fmod(float x, float y) { return x - y * floor(x / y); }
vec3 finish(vec3 c) { return toScreen(clamp(c, 0.0, max(1.0, uHdrRange))); }
`,G=`
struct Look { time: f32, aspect: f32, glow: f32, hdrRange: f32, size: vec2f, wide: f32, radius: f32, _a: f32, _b: f32, _c: f32, _d: f32 }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
fn toLinear(c: vec3f) -> vec3f { let a = abs(c); return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a < vec3f(0.04045)); }
fn toScreen(c: vec3f) -> vec3f { let a = abs(c); return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308)); }
fn light(c: vec3f) -> vec3f {
const SRGB_TO_P3 = mat3x3f(0.8224620, 0.0331942, 0.0170826, 0.1775380, 0.9668058, 0.0723974, 0.0, 0.0, 0.9105199);
let l = toLinear(c);
return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
}
fn ballColor(i: i32) -> vec3f {
let w = look.wide > 0.5;
let ww = look.wide > 1.5;
if (i == 0) { return select(select(vec3f(0.769, 0.008, 0.200), vec3f( 0.8242, -0.1608, 0.1756), w), vec3f( 0.9059, -0.2723, 0.1406), ww); }
if (i == 1) { return select(select(vec3f(1.000, 0.827, 0.000), vec3f( 1.0176, 0.8609, -0.3058), w), vec3f( 1.0212, 0.8716, -0.3339), ww); }
if (i == 2) { return select(select(vec3f(0.000, 0.529, 0.741), vec3f(-0.2504, 0.5236, 0.7784), w), vec3f(-0.4457, 0.5113, 0.8618), ww); }
return select(select(vec3f(0.000, 0.624, 0.420), vec3f(-0.3157, 0.6472, 0.3911), w), vec3f(-0.5210, 0.6906, 0.3214), ww);
}
fn sky(p: vec2f) -> vec3f {
return light(mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), p.y / look.size.y));
}
fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
fn squareWave(x: f32, blur0: f32) -> f32 { let blur = max(blur0, 1e-4); return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur; }
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn finish(c: vec3f) -> vec4f { return vec4f(toScreen(clamp(c, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)))), 1.0); }
@vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn skyFs(@builtin(position) at: vec4f) -> @location(0) vec4f { return finish(sky(vec2f(at.x, look.size.y - at.y))); }
`,ne=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,m=96,ae=8,P=4,k=48,le=(m-4)*P,O=le*k*6,C=.05,B=120,ce=`#version 300 es
precision highp float;
${A}
uniform highp sampler2D uTrack;
vec3 trackAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${m-1}), 0), 0).xyz; }
vec3 upAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${m-1}) + ${m}, 0), 0).xyz; }
vec4 extra() { return texelFetch(uTrack, ivec2(${2*m}, 0), 0); }
void trackNear(float u, out vec3 middle, out vec3 slope) {
int k = int(floor(u));
float f = u - float(k);
vec3 a = trackAt(k - 1), b = trackAt(k), c = trackAt(k + 1), d = trackAt(k + 2);
vec3 c1 = c - a, c2 = 2.0 * a - 5.0 * b + 4.0 * c - d, c3 = 3.0 * b - a - 3.0 * c + d;
middle = 0.5 * (2.0 * b + (c1 + (c2 + c3 * f) * f) * f);
slope = 0.5 * (c1 + (2.0 * c2 + 3.0 * c3 * f) * f);
}
vec3 upNear(float u, vec3 direction) {
int k = int(floor(u));
vec3 up = mix(upAt(k), upAt(k + 1), u - float(k));
return normalize(up - dot(up, direction) * direction);
}
out vec3 vSeen;
out vec2 vWall;
void main() {
int quad = gl_VertexID / 6, c = gl_VertexID - 6 * quad;
vec2 corner = vec2(float(c == 1 || c == 4 || c == 5), float(c == 2 || c == 3 || c == 5));
int ring = quad / ${k}, j = quad - ${k} * ring;
float u = 1.0 + (float(ring) + corner.y) / ${P}.0;
float around = (float(j) + corner.x) / ${k}.0;
vec3 middle, slope;
trackNear(u, middle, slope);
vec3 direction = normalize(slope), wallUp = upNear(u, direction);
vec3 at = middle + cos(2.0 * PI * around) * wallUp + sin(2.0 * PI * around) * cross(direction, wallUp);
vec4 e = extra();
vec3 eye, there, unused;
trackNear(e.x, eye, unused);
trackNear(e.x + 2.5, there, unused);
vec3 ahead = normalize(there - eye);
vec3 up = upNear(e.x, ahead), right = cross(ahead, up);
vec3 seen = at - eye;
vec3 v = vec3(dot(seen, right), dot(seen, up), dot(seen, ahead));
float depth = ${B}.0 * (v.z - ${C}) / (${B}.0 - ${C});
gl_Position = vec4(1.2 * v.x / uAspect, 1.2 * v.y, 2.0 * depth - v.z, v.z);
vSeen = seen;
vWall = vec2(16.0 * around, u + e.y);
}
`,ie=`#version 300 es
precision highp float;
${A}
in vec3 vSeen;
in vec2 vWall;
out vec4 outColor;
void main() {
float t = length(vSeen);
vec2 blur = 1.5 * fwidth(vWall);
float checker = 0.5 + 0.5 * squareWave(vWall.x, blur.x) * squareWave(vWall.y, blur.y);
vec3 ring = mix(light(ballColor(int(fmod(floor(vWall.y / 4.0), 4.0)))),
0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
smoothstep(15.0, 35.0, t));
vec3 color = mix(vec3(1.0), ring, checker);
float fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
outColor = vec4(finish(color * fog * (1.0 + uGlow * 0.3 * fog * fog * fog)), 1.0);
}
`,se=`
${G}
@group(0) @binding(1) var<uniform> track: array<vec4f, ${2*m+1}>;
fn trackAt(k: i32) -> vec3f { return track[clamp(k, 0, ${m-1})].xyz; }
fn upAt(k: i32) -> vec3f { return track[clamp(k, 0, ${m-1}) + ${m}].xyz; }
fn extra() -> vec4f { return track[${2*m}]; }
fn trackNear(u: f32) -> array<vec3f, 2> {
let k = i32(floor(u));
let f = u - f32(k);
let a = trackAt(k - 1);
let b = trackAt(k);
let c = trackAt(k + 1);
let d = trackAt(k + 2);
let c1 = c - a;
let c2 = 2.0 * a - 5.0 * b + 4.0 * c - d;
let c3 = 3.0 * b - a - 3.0 * c + d;
return array<vec3f, 2>(0.5 * (2.0 * b + (c1 + (c2 + c3 * f) * f) * f), 0.5 * (c1 + (2.0 * c2 + 3.0 * c3 * f) * f));
}
fn upNear(u: f32, direction: vec3f) -> vec3f {
let k = i32(floor(u));
let up = mix(upAt(k), upAt(k + 1), u - f32(k));
return normalize(up - dot(up, direction) * direction);
}
struct Wall { @builtin(position) at: vec4f, @location(0) seen: vec3f, @location(1) wall: vec2f }
@vertex fn tunnelVs(@builtin(vertex_index) vertex: u32) -> Wall {
let quad = vertex / 6u;
let c = vertex - 6u * quad;
let corner = vec2f(select(0.0, 1.0, c == 1u || c == 4u || c == 5u), select(0.0, 1.0, c == 2u || c == 3u || c == 5u));
let ring = quad / ${k}u;
let j = quad - ${k}u * ring;
let u = 1.0 + (f32(ring) + corner.y) / ${P}.0;
let around = (f32(j) + corner.x) / ${k}.0;
let near = trackNear(u);
let direction = normalize(near[1]);
let wallUp = upNear(u, direction);
let at = near[0] + cos(2.0 * PI * around) * wallUp + sin(2.0 * PI * around) * cross(direction, wallUp);
let e = extra();
let eye = trackNear(e.x)[0];
let ahead = normalize(trackNear(e.x + 2.5)[0] - eye);
let up = upNear(e.x, ahead);
let right = cross(ahead, up);
let seen = at - eye;
let v = vec3f(dot(seen, right), dot(seen, up), dot(seen, ahead));
var o: Wall;
o.at = vec4f(1.2 * v.x / look.aspect, 1.2 * v.y, ${B}.0 * (v.z - ${C}) / (${B}.0 - ${C}), v.z);
o.seen = seen;
o.wall = vec2f(16.0 * around, u + e.y);
return o;
}
@fragment fn tunnelFs(w: Wall) -> @location(0) vec4f {
let t = length(w.seen);
let blur = 1.5 * fwidth(w.wall);
let checker = 0.5 + 0.5 * squareWave(w.wall.x, blur.x) * squareWave(w.wall.y, blur.y);
let ring = mix(light(ballColor(i32(fmod(floor(w.wall.y / 4.0), 4.0)))),
0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
smoothstep(15.0, 35.0, t));
let color = mix(vec3f(1.0), ring, checker);
let fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
return finish(color * fog * (1.0 + look.glow * 0.3 * fog * fog * fog));
}
`,s={add:(o,e)=>[o[0]+e[0],o[1]+e[1],o[2]+e[2]],scale:(o,e)=>[o[0]*e,o[1]*e,o[2]*e],dot:(o,e)=>o[0]*e[0]+o[1]*e[1]+o[2]*e[2],cross:(o,e)=>[o[1]*e[2]-o[2]*e[1],o[2]*e[0]-o[0]*e[2],o[0]*e[1]-o[1]*e[0]],norm:o=>s.scale(o,1/Math.hypot(o[0],o[1],o[2])),turn:(o,e,r)=>{const t=Math.cos(r),l=Math.sin(r);return s.add(s.add(s.scale(o,t),s.scale(s.cross(e,o),l)),s.scale(e,s.dot(e,o)*(1-t)))}},M=2.4,fe=12;class S{constructor(){for(this.points=[],this.first=0,this.recent=[],this.state={at:[0,0,0],heading:[0,0,1],up:[0,1,0],rates:[0,0,0]},this.piece={rates:[0,0,0],left:12};this.points.length<m;)this.grow()}pick(){const e=Math.random,r=e()<.5?-1:1,t=[()=>({rates:[0,0,0],left:6+10*e()}),()=>({rates:[r*(.12+.14*e()),0,r*.03],left:8+12*e()}),()=>({rates:[0,.1+.06*e(),0],left:7+5*e(),then:{rates:[0,-.15,0],left:9}}),()=>({rates:[0,-(.1+.06*e()),0],left:7+5*e(),then:{rates:[0,.15,0],left:9}}),()=>({rates:[0,.26,0],left:2*Math.PI/.26,shift:r*.2}),()=>({rates:[r*.06,0,r*.25],left:2*Math.PI/.25})];return t[Math.floor(e()*t.length)]()}static advance(e,r){const t=[...r.rates];if(t[0]===0&&t[1]===0&&t[2]===0){t[1]=-.15*e.heading[1];const n=s.norm(s.cross(e.heading,[0,1,0]));t[2]=.2*s.dot(e.up,n)}for(let n=0;n<3;n++)e.rates[n]+=(t[n]-e.rates[n])*.35;const a=s.cross(e.heading,e.up);e.heading=s.turn(e.heading,e.up,-e.rates[0]),e.heading=s.turn(e.heading,a,e.rates[1]),e.up=s.norm(s.turn(s.turn(e.up,a,e.rates[1]),e.heading,e.rates[2])),e.heading=s.norm(e.heading),e.up=s.norm(s.add(e.up,s.scale(e.heading,-s.dot(e.up,e.heading)))),e.at=s.add(e.at,e.heading),r.shift&&(r.side??=s.cross(e.heading,e.up),r.total??=r.left+1,e.at=s.add(e.at,s.scale(r.side,r.shift*Math.sin(Math.PI*(1-(r.left+.5)/r.total)))))}pickClear(){let e=null,r=-1;for(let t=0;t<30;t++){const l=this.pick(),a={at:this.state.at,heading:this.state.heading,up:this.state.up,rates:[...this.state.rates]},n=[];let i={...l};for(let c=0;c<60&&(i.left<=0&&(i=i.then?{...i.then}:null),!!i);c++)i.left--,S.advance(a,i),n.push(a.at);const f={rates:[0,0,0]};for(let c=0;c<10;c++)S.advance(a,f),n.push(a.at);const v=this.recent,u=v.length,p=c=>c<u?v[c]:n[c-u];let d=1/0;for(let c=u;c<u+n.length&&d>r;c++){const h=p(c);for(let b=Math.max(0,c-m);b<=c-fe;b++){const x=p(b),g=h[0]-x[0],y=h[1]-x[1],T=h[2]-x[2];d=Math.min(d,g*g+y*y+T*T)}}if(d>=M*M)return l;d>r&&(e=l,r=d)}return e}grow(){this.piece.left<=0&&(this.piece=this.piece.then??this.pickClear()),this.piece.left--,S.advance(this.state,this.piece),this.points.push({at:this.state.at,up:this.state.up}),this.recent.push(this.state.at),this.recent.length>m&&this.recent.shift()}moveTo(e){for(;this.first<e;)this.points.shift(),this.first++;for(;this.points.length<m;)this.grow()}}function E(){const o=new S,e=new Float32Array(4*(2*m+1));let r=2,t=8,l=null;return{data:e,update(a){const n=l===null?0:Math.min(.1,Math.max(0,a-l));l=a;const i=Math.floor(r)-o.first,f=s.norm(s.add(o.points[i+1].at,s.scale(o.points[i].at,-1)));t=Math.min(16,Math.max(5,t+(-9*f[1]-.3*(t-8))*n)),r+=t*n,o.moveTo(Math.floor(r)-ae);const v=o.points[0].at;o.points.forEach(({at:u,up:p},d)=>{const c=4*d,h=4*(m+d);e[c]=u[0]-v[0],e[c+1]=u[1]-v[1],e[c+2]=u[2]-v[2],e[h]=p[0],e[h+1]=p[1],e[h+2]=p[2]}),e[8*m]=r-o.first,e[8*m+1]=o.first%16}}}const w=216,D=2*Math.PI,R=.75,F=1.5,z=8,V=o=>Math.min(z,Math.max(1,Math.floor(o/R))),ue=`#version 300 es
  precision highp float;
  uniform float uTime, uAspect, uRadius;
  out vec2 vCorner;
  flat out int vColor;
  const float PI = 3.14159265359;
  float fmod(float x, float y) { return x - y * floor(x / y); }
  vec3 cube(float i) {
    float face = floor(i / 36.0), j = i - 36.0 * face;
    float a = (fmod(j, 6.0) + 0.5) / 3.0 - 1.0, b = (floor(j / 6.0) + 0.5) / 3.0 - 1.0;
    float s = fmod(face, 2.0) > 0.5 ? -1.0 : 1.0, axis = floor(face / 2.0);
    return 0.8 * (axis < 0.5 ? vec3(s, a, b) : axis < 1.5 ? vec3(a, s, b) : vec3(a, b, s));
  }
  vec3 sphere(float i) {
    float y = 1.0 - 2.0 * (i + 0.5) / ${w}.0, r = sqrt(1.0 - y * y), a = i * 2.39996323;
    return 1.05 * vec3(cos(a) * r, y, sin(a) * r);
  }
  void main() {
    vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float copies = min(${z}.0, max(1.0, floor(uAspect / ${R})));
    float copy = floor(float(gl_InstanceID) / ${w}.0), i = float(gl_InstanceID) - ${w}.0 * copy;
    float time = uTime - ${F} * copy;
    float phase = time / ${D};
    float f = smoothstep(0.6, 1.0, fract(phase));
    vec3 scatter = vec3(sin(i * 12.9898), sin(i * 78.233), sin(i * 37.719)) * 0.35 * sin(PI * f);
    vec3 p = fmod(floor(phase), 2.0) < 0.5 ? mix(cube(i), sphere(i), f) : mix(sphere(i), cube(i), f);
    p += scatter;
    float ay = 0.6 * time, ax = 0.3 + 0.4 * sin(0.4 * time);
    p = vec3(cos(ay) * p.x + sin(ay) * p.z, p.y, -sin(ay) * p.x + cos(ay) * p.z);
    p = vec3(p.x, cos(ax) * p.y - sin(ax) * p.z, sin(ax) * p.y + cos(ax) * p.z);
    // (Each group as big as fits its share of the width, at most the whole
    // height; side by side.)
    float size = min(1.0, uAspect / copies / 1.25);
    vec3 v = p * size + vec3(corner * uRadius * size, -3.4);
    float w = -v.z;
    float depth = clamp((w - 1.5) / 4.0, 0.0, 1.0);
    float shift = ((copy + 0.5) / copies * 2.0 - 1.0) * w;
    gl_Position = vec4(v.x * 2.6 / uAspect + shift, v.y * 2.6, (depth * 2.0 - 1.0) * w, w);
    vCorner = corner;
    vColor = int(fmod(i + copy, 4.0));
  }
`,pe=`#version 300 es
  precision highp float;
  ${A}
  in vec2 vCorner;
  flat in int vColor;
  out vec4 outColor;
  void main() {
    float r = length(vCorner);
    float alpha = clamp((1.0 - r) / max(fwidth(r), 1e-4) + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec3 n = vec3(vCorner, sqrt(max(0.0, 1.0 - r * r)));
    vec3 toLamp = normalize(vec3(-0.5, 0.7, 0.9));
    float facing = max(0.0, dot(n, toLamp));
    float shine = pow(max(0.0, dot(n, normalize(toLamp + vec3(0.0, 0.0, 1.0)))), 40.0);
    vec3 c = light(ballColor(vColor)) * (0.25 + 0.85 * facing) + vec3(0.45 + uGlow) * shine;
    outColor = vec4(finish(c), alpha);
    // (The smoothed outline is blended over what is behind; only the ball
    // itself, not its outline, hides the balls behind it.)
    gl_FragDepth = alpha >= 0.5 ? gl_FragCoord.z : 1.0;
  }
`,de=`#version 300 es
  precision highp float;
  ${A}
  out vec4 outColor;
  void main() { outColor = vec4(finish(sky(gl_FragCoord.xy)), 1.0); }
`,ve=`
struct Bob { @builtin(position) at: vec4f, @location(0) corner: vec2f, @location(1) @interpolate(flat) color: i32 }
struct BobOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn bobFs(b: Bob) -> BobOut {
let r = length(b.corner);
let alpha = clamp((1.0 - r) / max(fwidth(r), 1e-4) + 0.5, 0.0, 1.0);
if (alpha <= 0.0) { discard; }
let n = vec3f(b.corner, sqrt(max(0.0, 1.0 - r * r)));
let toLamp = normalize(vec3f(-0.5, 0.7, 0.9));
let facing = max(0.0, dot(n, toLamp));
let shine = pow(max(0.0, dot(n, normalize(toLamp + vec3f(0.0, 0.0, 1.0)))), 40.0);
let c = light(ballColor(b.color)) * (0.25 + 0.85 * facing) + vec3f(0.45 + look.glow) * shine;
var o: BobOut;
o.color = vec4f(finish(c).rgb, alpha);
o.depth = select(1.0, b.at.z, alpha >= 0.5);
return o;
}
`,he=`
${G}
fn cube(i: f32) -> vec3f {
let face = floor(i / 36.0);
let j = i - 36.0 * face;
let a = (fmod(j, 6.0) + 0.5) / 3.0 - 1.0;
let b = (floor(j / 6.0) + 0.5) / 3.0 - 1.0;
let s = select(1.0, -1.0, fmod(face, 2.0) > 0.5);
let axis = floor(face / 2.0);
return 0.8 * select(select(vec3f(a, b, s), vec3f(a, s, b), axis < 1.5), vec3f(s, a, b), axis < 0.5);
}
fn sphere(i: f32) -> vec3f {
let y = 1.0 - 2.0 * (i + 0.5) / ${w}.0;
let r = sqrt(1.0 - y * y);
let a = i * 2.39996323;
return 1.05 * vec3f(cos(a) * r, y, sin(a) * r);
}
@vertex fn bobVs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Bob {
let corner = vec2f(f32(vertex & 1u), f32(vertex >> 1u)) * 2.0 - 1.0;
let copies = min(${z}.0, max(1.0, floor(look.aspect / ${R})));
let copy = floor(f32(instance) / ${w}.0);
let i = f32(instance) - ${w}.0 * copy;
let time = look.time - ${F} * copy;
let phase = time / ${D};
let f = smoothstep(0.6, 1.0, fract(phase));
let scatter = vec3f(sin(i * 12.9898), sin(i * 78.233), sin(i * 37.719)) * 0.35 * sin(PI * f);
var p = select(mix(sphere(i), cube(i), f), mix(cube(i), sphere(i), f), fmod(floor(phase), 2.0) < 0.5) + scatter;
let ay = 0.6 * time;
let ax = 0.3 + 0.4 * sin(0.4 * time);
p = vec3f(cos(ay) * p.x + sin(ay) * p.z, p.y, -sin(ay) * p.x + cos(ay) * p.z);
p = vec3f(p.x, cos(ax) * p.y - sin(ax) * p.z, sin(ax) * p.y + cos(ax) * p.z);
let size = min(1.0, look.aspect / copies / 1.25);
let v = p * size + vec3f(corner * look.radius * size, -3.4);
let w = -v.z;
let depth = clamp((w - 1.5) / 4.0, 0.0, 1.0);
let shift = ((copy + 0.5) / copies * 2.0 - 1.0) * w;
var o: Bob;
o.at = vec4f(v.x * 2.6 / look.aspect + shift, v.y * 2.6, depth * w, w);
o.corner = corner;
o.color = i32(fmod(i + copy, 4.0));
return o;
}
${ve}
`,W={radius:0};function q(o,e){const r=o.getContext("webgl2",{antialias:e});if(!r)return null;let t=0;const l=new Map;return{gl:r,setLook(a){const n=a?"display-p3":"srgb";"drawingBufferColorSpace"in r&&r.drawingBufferColorSpace!==n&&(r.drawingBufferColorSpace=n),t=a&&"drawingBufferColorSpace"in r&&U()?1:0},setUniforms(a,n,i,f,v=W){const u=l.get(a)??l.set(a,new Map).get(a),p=d=>u.get(d)??u.set(d,r.getUniformLocation(a,d)).get(d);r.uniform1f(p("uTime"),I(n)),r.uniform1f(p("uAspect"),i/f),r.uniform2f(p("uSize"),i,f),r.uniform1f(p("uGlow"),0),r.uniform1f(p("uHdrRange"),1),r.uniform1f(p("uWide"),t),r.uniform1f(p("uRadius"),v.radius)},size(a,n){(o.width!==a||o.height!==n)&&(o.width=a,o.height=n),r.viewport(0,0,a,n)},dispose(){r.getExtension("WEBGL_lose_context")?.loseContext()}}}function H(o,e){const r=q(o,!0);if(!r)return null;const{gl:t}=r,l=L(t,ce,ie);t.bindVertexArray(t.createVertexArray());const a=t.createTexture();return t.bindTexture(t.TEXTURE_2D,a),t.texStorage2D(t.TEXTURE_2D,1,t.RGBA32F,e.data.length/4,1),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),{setLook:r.setLook,dispose:r.dispose,draw(n,i,f){r.size(i,f),t.enable(t.DEPTH_TEST),t.clearColor(0,0,0,1),t.clear(t.COLOR_BUFFER_BIT|t.DEPTH_BUFFER_BIT),t.useProgram(l),r.setUniforms(l,n,i,f),e.update(n),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,a),t.texSubImage2D(t.TEXTURE_2D,0,0,0,e.data.length/4,1,t.RGBA,t.FLOAT,e.data),t.uniform1i(t.getUniformLocation(l,"uTrack"),0),t.drawArrays(t.TRIANGLES,0,O)}}}function j(o,e){const r=q(o,!1);if(!r)return null;const{gl:t}=r;t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA);const l=L(t,ne,de),a=L(t,ue,pe);return t.bindVertexArray(t.createVertexArray()),{setLook:r.setLook,dispose:r.dispose,draw(n,i,f){r.size(i,f),t.disable(t.DEPTH_TEST),t.disable(t.BLEND),t.useProgram(l),r.setUniforms(l,n,i,f),t.drawArrays(t.TRIANGLES,0,3),t.enable(t.DEPTH_TEST),t.enable(t.BLEND),t.clear(t.DEPTH_BUFFER_BIT),t.useProgram(a),r.setUniforms(a,n,i,f,e),t.drawArraysInstanced(t.TRIANGLE_STRIP,0,4,w*V(i/f))}}}function X(o,e,r,t=null){const l=o.getContext("webgpu");if(!l)return null;const a=e.createShaderModule({code:r}),n=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,i=e.createBuffer({size:48,usage:n}),f=t&&e.createBuffer({size:t.data.byteLength,usage:n}),v=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,u=e.createBindGroupLayout({entries:[{binding:0,visibility:v,buffer:{}},...t?[{binding:1,visibility:v,buffer:{}}]:[]]}),p=e.createBindGroup({layout:u,entries:[{binding:0,resource:{buffer:i}},...t?[{binding:1,resource:{buffer:f}}]:[]]}),d=new Float32Array(12);let c=null,h=0;const b=(x,g)=>{const y=`${x} ${g}`;y!==c&&(c=y,l.configure({device:e,format:_,alphaMode:"opaque",colorSpace:x?"display-p3":"srgb",toneMapping:{mode:g?"extended":"standard"}}))};return{context:l,module:a,group:p,pipelineLayout:e.createPipelineLayout({bindGroupLayouts:[u]}),setLook(x,g){b(x,g),h=x&&U()?g&&te()?2:1:0},begin(x,g,y,T,Q=W){c||b(!0,!1),(o.width!==g||o.height!==y)&&(o.width=g,o.height=y),d.set([I(x),g/y,T,T>0?ee:1,g,y,h,Q.radius,0,0,0,0]),e.queue.writeBuffer(i,0,d),t&&(t.update(x),e.queue.writeBuffer(f,0,t.data))},dispose(){i.destroy(),f?.destroy(),l.unconfigure()}}}function Y(o,e,r){const t=X(o,e,se,r);if(!t)return null;const l=4,a=e.createRenderPipeline({layout:t.pipelineLayout,vertex:{module:t.module,entryPoint:"tunnelVs"},fragment:{module:t.module,entryPoint:"tunnelFs",targets:[{format:_}]},depthStencil:{format:"depth24plus",depthCompare:"less",depthWriteEnabled:!0},multisample:{count:l}});let n=null;const i=()=>{n?.color.destroy(),n?.depth.destroy(),n=null};return{setLook:t.setLook,dispose(){i(),t.dispose()},draw(f,v,u,p){if(t.begin(f,v,u,p),!n||n.width!==v||n.height!==u){i();const h=b=>e.createTexture({size:[v,u],format:b,sampleCount:l,usage:GPUTextureUsage.RENDER_ATTACHMENT});n={width:v,height:u,color:h(_),depth:h("depth24plus")},n.colorView=n.color.createView(),n.depthView=n.depth.createView()}const d=e.createCommandEncoder(),c=d.beginRenderPass({colorAttachments:[{view:n.colorView,resolveTarget:t.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,1]}],depthStencilAttachment:{view:n.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});c.setBindGroup(0,t.group),c.setPipeline(a),c.draw(O),c.end(),e.queue.submit([d.finish()])}}}function K(o,e,r){const t=X(o,e,he);if(!t)return null;const l=(v,u)=>({format:"depth24plus",depthCompare:v,depthWriteEnabled:u}),a=e.createRenderPipeline({layout:t.pipelineLayout,vertex:{module:t.module,entryPoint:"fullVs"},fragment:{module:t.module,entryPoint:"skyFs",targets:[{format:_}]},depthStencil:l("always",!1)}),n={srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},i=e.createRenderPipeline({layout:t.pipelineLayout,vertex:{module:t.module,entryPoint:"bobVs"},fragment:{module:t.module,entryPoint:"bobFs",targets:[{format:_,blend:{color:n,alpha:n}}]},primitive:{topology:"triangle-strip"},depthStencil:l("less",!0)});let f=null;return{setLook:t.setLook,dispose(){f?.texture.destroy(),t.dispose()},draw(v,u,p,d){if(t.begin(v,u,p,d,r),!f||f.width!==u||f.height!==p){f?.texture.destroy();const b=e.createTexture({size:[u,p],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});f={width:u,height:p,texture:b,view:b.createView()}}const c=e.createCommandEncoder(),h=c.beginRenderPass({colorAttachments:[{view:t.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}],depthStencilAttachment:{view:f.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});h.setBindGroup(0,t.group),h.setPipeline(a),h.draw(3),h.setPipeline(i),h.draw(4,w*V(u/p)),h.end(),e.queue.submit([c.finish()])}}}const J=(o,e,r)=>()=>Z(o,oe,re,t=>$.device&&e(t,$.device)||r(t)),N={radius:.05},me=(o,e)=>J(o,(r,t)=>K(r,t,e),r=>j(r,e)),ye=[{label:"Vector Bobs",short:"Bobs",open:me("Vector Bobs",N)},{label:"Tunnel",open:J("Tunnel",(o,e)=>Y(o,e,E()),o=>H(o,E()))}],we={bobs:{gpu:(o,e)=>K(o,e,N),gl:o=>j(o,N)},tunnel:{gpu:(o,e)=>Y(o,e,E()),gl:o=>H(o,E())},tunnelRide:E};export{ye as EFFECTS,we as effectDrawers};
