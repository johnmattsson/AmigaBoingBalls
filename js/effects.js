import{openEffectWindow as ce,twistOptions as I,createProgram as L,GPU_FORMAT as w,effectTime as G,sharpen as ue,samples as M,colorTarget as fe}from"./twist.js?v=2.04-397";import{toGlsl as k,toWgsl as S,SQUARE_WAVE as D,COLOR_CURVES as F,MODULO as $}from"./shade.js?v=2.04-397";import{ELEMENTARY_COLOR_MATHS as V,srgbToP3Matrix as W}from"./colors.js?v=2.04-397";import{HDR_RANGE as pe}from"./gpu-renderer.js?v=2.04-397";import{onP3Screen as H,onRec2020Screen as de}from"./renderer.js?v=2.04-397";const he=400,me=300,q=`
  fn sky(p: vec2f) -> vec3f {
    return light(mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), p.y / $size.y));
  }`,X=`
  fn cube(i: f32) -> vec3f {
    let face: f32 = floor(i / 36.0);
    let j: f32 = i - 36.0 * face;
    let a: f32 = (fmod(j, 6.0) + 0.5) / 3.0 - 1.0;
    let b: f32 = (floor(j / 6.0) + 0.5) / 3.0 - 1.0;
    let s: f32 = select(1.0, -1.0, fmod(face, 2.0) > 0.5);
    let axis: f32 = floor(face / 2.0);   // 0, 1 or 2: which pair of faces
    let third: vec3f = mix(vec3f(a, s, b), vec3f(a, b, s), step(1.5, axis));
    return 0.8 * mix(vec3f(s, a, b), third, step(0.5, axis));
  }
  fn sphere(i: f32) -> vec3f {
    let y: f32 = 1.0 - 2.0 * (i + 0.5) / $count;
    let r: f32 = sqrt(1.0 - y * y);
    let a: f32 = i * 2.39996323;
    return 1.05 * vec3f(cos(a) * r, y, sin(a) * r);
  }`,P=`
uniform float uTime, uAspect, uGlow, uHdrRange, uWide, uRadius;
uniform vec2 uSize;
const float PI = 3.14159265359;
${k(F)}
vec3 light(vec3 c) {
const mat3 SRGB_TO_P3 = ${W("glsl")};
vec3 l = toLinear(c);
return uWide > 0.5 ? SRGB_TO_P3 * l : l;
}
${k(V)}
vec3 ballColor(int i) { return elementaryColor(float(i), uWide); }
${k(q,{size:"uSize"})}
${k(D).trim()}
${k($)}
vec3 finish(vec3 c) { return toScreen(clamp(c, 0.0, max(1.0, uHdrRange))); }
`,j=`
struct Look { time: f32, aspect: f32, glow: f32, hdrRange: f32, size: vec2f, wide: f32, radius: f32, linear: f32, _b: f32, _c: f32, _d: f32 }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
${S(F)}
fn light(c: vec3f) -> vec3f {
const SRGB_TO_P3 = ${W("wgsl")};
let l = toLinear(c);
return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
}
${S(V)}
fn ballColor(i: i32) -> vec3f { return elementaryColor(f32(i), look.wide); }
${S(q,{size:"look.size"})}
${S(D).trim()}
${S($)}
fn finish(c: vec3f) -> vec4f {
let clamped = clamp(c, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)));
return vec4f(select(toScreen(clamped), clamped, look.linear > 0.5), 1.0);
}
@vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn skyFs(@builtin(position) at: vec4f) -> @location(0) vec4f { return finish(sky(vec2f(at.x, look.size.y - at.y))); }
`,ve=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,v=96,ge=8,N=4,E=48,xe=(v-4)*N,Y=xe*E*6,R=.05,B=120,be=`#version 300 es
precision highp float;
${P}
uniform highp sampler2D uTrack;
vec3 trackAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${v-1}), 0), 0).xyz; }
vec3 upAt(int k) { return texelFetch(uTrack, ivec2(clamp(k, 0, ${v-1}) + ${v}, 0), 0).xyz; }
vec4 extra() { return texelFetch(uTrack, ivec2(${2*v}, 0), 0); }
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
int ring = quad / ${E}, j = quad - ${E} * ring;
float u = 1.0 + (float(ring) + corner.y) / ${N}.0;
float around = (float(j) + corner.x) / ${E}.0;
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
float depth = ${B}.0 * (v.z - ${R}) / (${B}.0 - ${R});
gl_Position = vec4(1.2 * v.x / uAspect, 1.2 * v.y, 2.0 * depth - v.z, v.z);
vSeen = seen;
vWall = vec2(16.0 * around, u + e.y);
}
`,ye=`#version 300 es
precision highp float;
${P}
in vec3 vSeen;
in vec2 vWall;
out vec4 outColor;
void main() {
float t = length(vSeen);
vec2 blur = 1.5 * SOFTNESS * fwidth(vWall);
float checker = 0.5 + 0.5 * squareWave(vWall.x, blur.x) * squareWave(vWall.y, blur.y);
vec3 ring = mix(light(ballColor(int(fmod(floor(vWall.y / 4.0), 4.0)))),
0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
smoothstep(15.0, 35.0, t));
vec3 color = mix(vec3(1.0), ring, checker);
float fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
outColor = vec4(finish(color * fog * (1.0 + uGlow * 0.3 * fog * fog * fog)), 1.0);
}
`,Te=`
${j}
@group(0) @binding(1) var<uniform> track: array<vec4f, ${2*v+1}>;
fn trackAt(k: i32) -> vec3f { return track[clamp(k, 0, ${v-1})].xyz; }
fn upAt(k: i32) -> vec3f { return track[clamp(k, 0, ${v-1}) + ${v}].xyz; }
fn extra() -> vec4f { return track[${2*v}]; }
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
let ring = quad / ${E}u;
let j = quad - ${E}u * ring;
let u = 1.0 + (f32(ring) + corner.y) / ${N}.0;
let around = (f32(j) + corner.x) / ${E}.0;
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
o.at = vec4f(1.2 * v.x / look.aspect, 1.2 * v.y, ${B}.0 * (v.z - ${R}) / (${B}.0 - ${R}), v.z);
o.seen = seen;
o.wall = vec2f(16.0 * around, u + e.y);
return o;
}
@fragment fn tunnelFs(w: Wall) -> @location(0) vec4f {
let t = length(w.seen);
let blur = 1.5 * SOFTNESS * fwidth(w.wall);
let checker = 0.5 + 0.5 * squareWave(w.wall.x, blur.x) * squareWave(w.wall.y, blur.y);
let ring = mix(light(ballColor(i32(fmod(floor(w.wall.y / 4.0), 4.0)))),
0.25 * (light(ballColor(0)) + light(ballColor(1)) + light(ballColor(2)) + light(ballColor(3))),
smoothstep(15.0, 35.0, t));
let color = mix(vec3f(1.0), ring, checker);
let fog = exp(-0.06 * t) * smoothstep(50.0, 35.0, t);
return finish(color * fog * (1.0 + look.glow * 0.3 * fog * fog * fog));
}
`,u={add:(o,t)=>[o[0]+t[0],o[1]+t[1],o[2]+t[2]],scale:(o,t)=>[o[0]*t,o[1]*t,o[2]*t],dot:(o,t)=>o[0]*t[0]+o[1]*t[1]+o[2]*t[2],cross:(o,t)=>[o[1]*t[2]-o[2]*t[1],o[2]*t[0]-o[0]*t[2],o[0]*t[1]-o[1]*t[0]],norm:o=>u.scale(o,1/Math.hypot(o[0],o[1],o[2])),turn:(o,t,r)=>{const e=Math.cos(r),s=Math.sin(r);return u.add(u.add(u.scale(o,e),u.scale(u.cross(t,o),s)),u.scale(t,u.dot(t,o)*(1-e)))}},K=2.4,ke=12;class C{constructor(){for(this.points=[],this.first=0,this.recent=[],this.state={at:[0,0,0],heading:[0,0,1],up:[0,1,0],rates:[0,0,0]},this.piece={rates:[0,0,0],left:12};this.points.length<v;)this.grow()}pick(){const t=Math.random,r=t()<.5?-1:1,e=[()=>({rates:[0,0,0],left:6+10*t()}),()=>({rates:[r*(.12+.14*t()),0,r*.03],left:8+12*t()}),()=>({rates:[0,.1+.06*t(),0],left:7+5*t(),then:{rates:[0,-.15,0],left:9}}),()=>({rates:[0,-(.1+.06*t()),0],left:7+5*t(),then:{rates:[0,.15,0],left:9}}),()=>({rates:[0,.26,0],left:2*Math.PI/.26,shift:r*.2}),()=>({rates:[r*.06,0,r*.25],left:2*Math.PI/.25})];return e[Math.floor(t()*e.length)]()}static advance(t,r){const e=[...r.rates];if(e[0]===0&&e[1]===0&&e[2]===0){e[1]=-.15*t.heading[1];const n=u.norm(u.cross(t.heading,[0,1,0]));e[2]=.2*u.dot(t.up,n)}for(let n=0;n<3;n++)t.rates[n]+=(e[n]-t.rates[n])*.35;const p=u.cross(t.heading,t.up);t.heading=u.turn(t.heading,t.up,-t.rates[0]),t.heading=u.turn(t.heading,p,t.rates[1]),t.up=u.norm(u.turn(u.turn(t.up,p,t.rates[1]),t.heading,t.rates[2])),t.heading=u.norm(t.heading),t.up=u.norm(u.add(t.up,u.scale(t.heading,-u.dot(t.up,t.heading)))),t.at=u.add(t.at,t.heading),r.shift&&(r.side??=u.cross(t.heading,t.up),r.total??=r.left+1,t.at=u.add(t.at,u.scale(r.side,r.shift*Math.sin(Math.PI*(1-(r.left+.5)/r.total)))))}pickClear(){let t=null,r=-1;for(let e=0;e<30;e++){const s=this.pick(),p={at:this.state.at,heading:this.state.heading,up:this.state.up,rates:[...this.state.rates]},n=[];let a={...s};for(let l=0;l<60&&(a.left<=0&&(a=a.then?{...a.then}:null),!!a);l++)a.left--,C.advance(p,a),n.push(p.at);const i={rates:[0,0,0]};for(let l=0;l<10;l++)C.advance(p,i),n.push(p.at);const c=this.recent,f=c.length,m=l=>l<f?c[l]:n[l-f];let h=1/0;for(let l=f;l<f+n.length&&h>r;l++){const d=m(l);for(let b=Math.max(0,l-v);b<=l-ke;b++){const x=m(b),g=d[0]-x[0],y=d[1]-x[1],_=d[2]-x[2];h=Math.min(h,g*g+y*y+_*_)}}if(h>=K*K)return s;h>r&&(t=s,r=h)}return t}grow(){this.piece.left<=0&&(this.piece=this.piece.then??this.pickClear()),this.piece.left--,C.advance(this.state,this.piece),this.points.push({at:this.state.at,up:this.state.up}),this.recent.push(this.state.at),this.recent.length>v&&this.recent.shift()}moveTo(t){for(;this.first<t;)this.points.shift(),this.first++;for(;this.points.length<v;)this.grow()}}function A(){const o=new C,t=new Float32Array(4*(2*v+1));let r=2,e=8,s=null;return{data:t,update(p){const n=s===null?0:Math.min(.1,Math.max(0,p-s));s=p;const a=Math.floor(r)-o.first,i=u.norm(u.add(o.points[a+1].at,u.scale(o.points[a].at,-1)));e=Math.min(16,Math.max(5,e+(-9*i[1]-.3*(e-8))*n)),r+=e*n,o.moveTo(Math.floor(r)-ge);const c=o.points[0].at;o.points.forEach(({at:f,up:m},h)=>{const l=4*h,d=4*(v+h);t[l]=f[0]-c[0],t[l+1]=f[1]-c[1],t[l+2]=f[2]-c[2],t[d]=m[0],t[d+1]=m[1],t[d+2]=m[2]}),t[8*v]=r-o.first,t[8*v+1]=o.first%16}}}const T=216,Q=2*Math.PI,z=.75,Z=1.5,O=8,J=o=>Math.min(O,Math.max(1,Math.floor(o/z))),Ee=`#version 300 es
  precision highp float;
  uniform float uTime, uAspect, uRadius;
  out vec2 vCorner;
  flat out int vColor;
  const float PI = 3.14159265359;
  ${k($)}
  ${k(X,{count:T+".0"})}
  void main() {
    vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float copies = min(${O}.0, max(1.0, floor(uAspect / ${z})));
    float copy = floor(float(gl_InstanceID) / ${T}.0), i = float(gl_InstanceID) - ${T}.0 * copy;
    float time = uTime - ${Z} * copy;
    float phase = time / ${Q};
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
`,Se=`#version 300 es
  precision highp float;
  ${P}
  in vec2 vCorner;
  flat in int vColor;
  out vec4 outColor;
  void main() {
    float r = length(vCorner);
    float alpha = clamp((1.0 - r) / max(fwidth(r) * SOFTNESS, 1e-4) + 0.5, 0.0, 1.0);
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
`,_e=`#version 300 es
  precision highp float;
  ${P}
  out vec4 outColor;
  void main() { outColor = vec4(finish(sky(gl_FragCoord.xy)), 1.0); }
`,we=`
struct Bob { @builtin(position) at: vec4f, @location(0) corner: vec2f, @location(1) @interpolate(flat) color: i32 }
struct BobOut { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn bobFs(b: Bob) -> BobOut {
let r = length(b.corner);
let alpha = clamp((1.0 - r) / max(fwidth(r) * SOFTNESS, 1e-4) + 0.5, 0.0, 1.0);
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
`,Ae=`
${j}
${S(X,{count:T+".0"})}
@vertex fn bobVs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Bob {
let corner = vec2f(f32(vertex & 1u), f32(vertex >> 1u)) * 2.0 - 1.0;
let copies = min(${O}.0, max(1.0, floor(look.aspect / ${z})));
let copy = floor(f32(instance) / ${T}.0);
let i = f32(instance) - ${T}.0 * copy;
let time = look.time - ${Z} * copy;
let phase = time / ${Q};
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
${we}
`,ee={radius:0};function te(o,t){const r=o.shared,e=r?r.gl:o.getContext("webgl2",{antialias:t});if(!e)return null;let s=0;const p=new Map,n=[];return{gl:e,owned:n,setLook(a){const i=a?"display-p3":"srgb";!r&&"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==i&&(e.drawingBufferColorSpace=i),s=a&&"drawingBufferColorSpace"in e&&H()?1:0},setUniforms(a,i,c,f,m=ee){const h=p.get(a)??p.set(a,new Map).get(a),l=d=>h.get(d)??h.set(d,e.getUniformLocation(a,d)).get(d);e.uniform1f(l("uTime"),G(i)),e.uniform1f(l("uAspect"),c/f),e.uniform2f(l("uSize"),c,f),e.uniform1f(l("uGlow"),0),e.uniform1f(l("uHdrRange"),1),e.uniform1f(l("uWide"),s),e.uniform1f(l("uRadius"),m.radius)},size(a,i){r?r.begin(a,i,t):(o.width!==a||o.height!==i)&&(o.width=a,o.height=i),e.viewport(0,0,a,i)},done(){r&&(e.disable(e.DEPTH_TEST),e.disable(e.BLEND),r.end())},dispose(){if(!r){e.getExtension("WEBGL_lose_context")?.loseContext();return}for(const[a,i]of n)e[a](i)}}}function oe(o,t){const r=te(o,M()>1);if(!r)return null;const{gl:e}=r,s=L(e,be,ye),p=e.createVertexArray(),n=e.createTexture();return r.owned.push(["deleteProgram",s],["deleteVertexArray",p],["deleteTexture",n]),e.bindTexture(e.TEXTURE_2D,n),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA32F,t.data.length/4,1),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),{setLook:r.setLook,dispose:r.dispose,draw(a,i,c){r.size(i,c),e.bindVertexArray(p),e.enable(e.DEPTH_TEST),e.clearColor(0,0,0,1),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.useProgram(s),r.setUniforms(s,a,i,c),t.update(a),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,n),e.texSubImage2D(e.TEXTURE_2D,0,0,0,t.data.length/4,1,e.RGBA,e.FLOAT,t.data),e.uniform1i(e.getUniformLocation(s,"uTrack"),0),e.drawArrays(e.TRIANGLES,0,Y),r.done()}}}function re(o,t){const r=te(o,!1);if(!r)return null;const{gl:e}=r,s=L(e,ve,_e),p=L(e,Ee,Se),n=e.createVertexArray();return r.owned.push(["deleteProgram",s],["deleteProgram",p],["deleteVertexArray",n]),{setLook:r.setLook,dispose:r.dispose,draw(a,i,c){r.size(i,c),e.bindVertexArray(n),e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE),e.disable(e.DEPTH_TEST),e.disable(e.BLEND),e.useProgram(s),r.setUniforms(s,a,i,c),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.enable(e.BLEND),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(p),r.setUniforms(p,a,i,c,t),e.drawArraysInstanced(e.TRIANGLE_STRIP,0,4,T*J(i/c)),r.done()}}}function ne(o,t,r,e=null){const s=o.getContext("webgpu");if(!s)return null;const p=t.createShaderModule({code:ue(r)}),n=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,a=t.createBuffer({size:48,usage:n}),i=e&&t.createBuffer({size:e.data.byteLength,usage:n}),c=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,f=t.createBindGroupLayout({entries:[{binding:0,visibility:c,buffer:{}},...e?[{binding:1,visibility:c,buffer:{}}]:[]]}),m=t.createBindGroup({layout:f,entries:[{binding:0,resource:{buffer:a}},...e?[{binding:1,resource:{buffer:i}}]:[]]}),h=new Float32Array(12);let l=null,d=0;const b=(x,g)=>{const y=`${x} ${g}`;y!==l&&(l=y,s.configure({device:t,format:w,alphaMode:"opaque",colorSpace:x?"display-p3":"srgb",toneMapping:{mode:g?"extended":"standard"}}))};return{context:s,module:p,group:m,pipelineLayout:t.createPipelineLayout({bindGroupLayouts:[f]}),setLook(x,g){b(x,g),d=x&&H()?g&&de()?2:1:0},begin(x,g,y,_,se=ee){l||b(!0,!1),(o.width!==g||o.height!==y)&&(o.width=g,o.height=y),h.set([G(x),g/y,_,_>0?pe:1,g,y,d,se.radius,o.linear?1:0,0,0,0]),t.queue.writeBuffer(a,0,h),e&&(e.update(x),t.queue.writeBuffer(i,0,e.data))},dispose(){a.destroy(),i?.destroy(),s.unconfigure()}}}function ae(o,t,r){const e=ne(o,t,Te,r);if(!e)return null;const s=M(),p=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"tunnelVs"},fragment:{module:e.module,entryPoint:"tunnelFs",targets:[{format:w}]},depthStencil:{format:"depth24plus",depthCompare:"less",depthWriteEnabled:!0},multisample:{count:s}});let n=null;const a=()=>{n?.color?.destroy(),n?.depth.destroy(),n=null};return{setLook:e.setLook,dispose(){a(),e.dispose()},draw(i,c,f,m){if(e.begin(i,c,f,m),!n||n.width!==c||n.height!==f){a();const d=b=>t.createTexture({size:[c,f],format:b,sampleCount:s,usage:GPUTextureUsage.RENDER_ATTACHMENT});n={width:c,height:f,color:s>1?d(w):null,depth:d("depth24plus")},n.colorView=n.color?.createView(),n.depthView=n.depth.createView()}const h=t.createCommandEncoder(),l=h.beginRenderPass({colorAttachments:[fe(n.colorView,e.context.getCurrentTexture().createView())],depthStencilAttachment:{view:n.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});l.setBindGroup(0,e.group),l.setPipeline(p),l.draw(Y),l.end(),t.queue.submit([h.finish()])}}}function le(o,t,r){const e=ne(o,t,Ae);if(!e)return null;const s=(c,f)=>({format:"depth24plus",depthCompare:c,depthWriteEnabled:f}),p=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"fullVs"},fragment:{module:e.module,entryPoint:"skyFs",targets:[{format:w}]},depthStencil:s("always",!1)}),n={srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},a=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"bobVs"},fragment:{module:e.module,entryPoint:"bobFs",targets:[{format:w,blend:{color:n,alpha:n}}]},primitive:{topology:"triangle-strip"},depthStencil:s("less",!0)});let i=null;return{setLook:e.setLook,dispose(){i?.texture.destroy(),e.dispose()},draw(c,f,m,h){if(e.begin(c,f,m,h,r),!i||i.width!==f||i.height!==m){i?.texture.destroy();const b=t.createTexture({size:[f,m],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});i={width:f,height:m,texture:b,view:b.createView()}}const l=t.createCommandEncoder(),d=l.beginRenderPass({colorAttachments:[{view:e.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}],depthStencilAttachment:{view:i.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});d.setBindGroup(0,e.group),d.setPipeline(p),d.draw(3),d.setPipeline(a),d.draw(4,T*J(f/m)),d.end(),t.queue.submit([l.finish()])}}}const ie=(o,t,r)=>()=>ce(o,he,me,e=>I.device&&t(e,I.device)||r(e)),U={radius:.05},Ce=(o,t)=>ie(o,(r,e)=>le(r,e,t),r=>re(r,t)),Ne=[{label:"Vector Bobs",short:"Bobs",open:Ce("Vector Bobs",U)},{label:"Tunnel",open:ie("Tunnel",(o,t)=>ae(o,t,A()),o=>oe(o,A()))}],ze={bobs:{gpu:(o,t)=>le(o,t,U),gl:o=>re(o,U)},tunnel:{gpu:(o,t)=>ae(o,t,A()),gl:o=>oe(o,A())},tunnelRide:A};export{Ne as EFFECTS,ze as effectDrawers};
