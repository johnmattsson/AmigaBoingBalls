import{openEffectWindow as ie,twistOptions as I,createProgram as L,GPU_FORMAT as S,effectTime as G,sharpen as ce,samples as D,colorTarget as se}from"./twist.js?v=2.04-325";import{toGlsl as k,toWgsl as _,SQUARE_WAVE as F,COLOR_CURVES as M,MODULO as $}from"./shade.js?v=2.04-325";import{HDR_RANGE as fe}from"./gpu-renderer.js?v=2.04-325";import{onP3Screen as V,onRec2020Screen as ue}from"./renderer.js?v=2.04-325";const pe=400,de=300,W=`
  fn sky(p: vec2f) -> vec3f {
    return light(mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), p.y / $size.y));
  }`,q=`
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
${k(M)}
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
${k(W,{size:"uSize"})}
${k(F).trim()}
${k($)}
vec3 finish(vec3 c) { return toScreen(clamp(c, 0.0, max(1.0, uHdrRange))); }
`,H=`
struct Look { time: f32, aspect: f32, glow: f32, hdrRange: f32, size: vec2f, wide: f32, radius: f32, linear: f32, _b: f32, _c: f32, _d: f32 }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
${_(M)}
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
${_(W,{size:"look.size"})}
${_(F).trim()}
${_($)}
fn finish(c: vec3f) -> vec4f {
let clamped = clamp(c, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)));
return vec4f(select(toScreen(clamped), clamped, look.linear > 0.5), 1.0);
}
@vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn skyFs(@builtin(position) at: vec4f) -> @location(0) vec4f { return finish(sky(vec2f(at.x, look.size.y - at.y))); }
`,he=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,m=96,ve=8,N=4,T=48,me=(m-4)*N,X=me*T*6,R=.05,B=120,ge=`#version 300 es
precision highp float;
${P}
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
int ring = quad / ${T}, j = quad - ${T} * ring;
float u = 1.0 + (float(ring) + corner.y) / ${N}.0;
float around = (float(j) + corner.x) / ${T}.0;
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
`,xe=`#version 300 es
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
`,be=`
${H}
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
let ring = quad / ${T}u;
let j = quad - ${T}u * ring;
let u = 1.0 + (f32(ring) + corner.y) / ${N}.0;
let around = (f32(j) + corner.x) / ${T}.0;
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
`,f={add:(o,t)=>[o[0]+t[0],o[1]+t[1],o[2]+t[2]],scale:(o,t)=>[o[0]*t,o[1]*t,o[2]*t],dot:(o,t)=>o[0]*t[0]+o[1]*t[1]+o[2]*t[2],cross:(o,t)=>[o[1]*t[2]-o[2]*t[1],o[2]*t[0]-o[0]*t[2],o[0]*t[1]-o[1]*t[0]],norm:o=>f.scale(o,1/Math.hypot(o[0],o[1],o[2])),turn:(o,t,r)=>{const e=Math.cos(r),c=Math.sin(r);return f.add(f.add(f.scale(o,e),f.scale(f.cross(t,o),c)),f.scale(t,f.dot(t,o)*(1-e)))}},j=2.4,ye=12;class C{constructor(){for(this.points=[],this.first=0,this.recent=[],this.state={at:[0,0,0],heading:[0,0,1],up:[0,1,0],rates:[0,0,0]},this.piece={rates:[0,0,0],left:12};this.points.length<m;)this.grow()}pick(){const t=Math.random,r=t()<.5?-1:1,e=[()=>({rates:[0,0,0],left:6+10*t()}),()=>({rates:[r*(.12+.14*t()),0,r*.03],left:8+12*t()}),()=>({rates:[0,.1+.06*t(),0],left:7+5*t(),then:{rates:[0,-.15,0],left:9}}),()=>({rates:[0,-(.1+.06*t()),0],left:7+5*t(),then:{rates:[0,.15,0],left:9}}),()=>({rates:[0,.26,0],left:2*Math.PI/.26,shift:r*.2}),()=>({rates:[r*.06,0,r*.25],left:2*Math.PI/.25})];return e[Math.floor(t()*e.length)]()}static advance(t,r){const e=[...r.rates];if(e[0]===0&&e[1]===0&&e[2]===0){e[1]=-.15*t.heading[1];const n=f.norm(f.cross(t.heading,[0,1,0]));e[2]=.2*f.dot(t.up,n)}for(let n=0;n<3;n++)t.rates[n]+=(e[n]-t.rates[n])*.35;const p=f.cross(t.heading,t.up);t.heading=f.turn(t.heading,t.up,-t.rates[0]),t.heading=f.turn(t.heading,p,t.rates[1]),t.up=f.norm(f.turn(f.turn(t.up,p,t.rates[1]),t.heading,t.rates[2])),t.heading=f.norm(t.heading),t.up=f.norm(f.add(t.up,f.scale(t.heading,-f.dot(t.up,t.heading)))),t.at=f.add(t.at,t.heading),r.shift&&(r.side??=f.cross(t.heading,t.up),r.total??=r.left+1,t.at=f.add(t.at,f.scale(r.side,r.shift*Math.sin(Math.PI*(1-(r.left+.5)/r.total)))))}pickClear(){let t=null,r=-1;for(let e=0;e<30;e++){const c=this.pick(),p={at:this.state.at,heading:this.state.heading,up:this.state.up,rates:[...this.state.rates]},n=[];let a={...c};for(let l=0;l<60&&(a.left<=0&&(a=a.then?{...a.then}:null),!!a);l++)a.left--,C.advance(p,a),n.push(p.at);const i={rates:[0,0,0]};for(let l=0;l<10;l++)C.advance(p,i),n.push(p.at);const s=this.recent,u=s.length,v=l=>l<u?s[l]:n[l-u];let h=1/0;for(let l=u;l<u+n.length&&h>r;l++){const d=v(l);for(let b=Math.max(0,l-m);b<=l-ye;b++){const x=v(b),g=d[0]-x[0],y=d[1]-x[1],E=d[2]-x[2];h=Math.min(h,g*g+y*y+E*E)}}if(h>=j*j)return c;h>r&&(t=c,r=h)}return t}grow(){this.piece.left<=0&&(this.piece=this.piece.then??this.pickClear()),this.piece.left--,C.advance(this.state,this.piece),this.points.push({at:this.state.at,up:this.state.up}),this.recent.push(this.state.at),this.recent.length>m&&this.recent.shift()}moveTo(t){for(;this.first<t;)this.points.shift(),this.first++;for(;this.points.length<m;)this.grow()}}function A(){const o=new C,t=new Float32Array(4*(2*m+1));let r=2,e=8,c=null;return{data:t,update(p){const n=c===null?0:Math.min(.1,Math.max(0,p-c));c=p;const a=Math.floor(r)-o.first,i=f.norm(f.add(o.points[a+1].at,f.scale(o.points[a].at,-1)));e=Math.min(16,Math.max(5,e+(-9*i[1]-.3*(e-8))*n)),r+=e*n,o.moveTo(Math.floor(r)-ve);const s=o.points[0].at;o.points.forEach(({at:u,up:v},h)=>{const l=4*h,d=4*(m+h);t[l]=u[0]-s[0],t[l+1]=u[1]-s[1],t[l+2]=u[2]-s[2],t[d]=v[0],t[d+1]=v[1],t[d+2]=v[2]}),t[8*m]=r-o.first,t[8*m+1]=o.first%16}}}const w=216,Y=2*Math.PI,z=.75,K=1.5,O=8,Q=o=>Math.min(O,Math.max(1,Math.floor(o/z))),we=`#version 300 es
  precision highp float;
  uniform float uTime, uAspect, uRadius;
  out vec2 vCorner;
  flat out int vColor;
  const float PI = 3.14159265359;
  ${k($)}
  ${k(q,{count:w+".0"})}
  void main() {
    vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float copies = min(${O}.0, max(1.0, floor(uAspect / ${z})));
    float copy = floor(float(gl_InstanceID) / ${w}.0), i = float(gl_InstanceID) - ${w}.0 * copy;
    float time = uTime - ${K} * copy;
    float phase = time / ${Y};
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
`,Te=`#version 300 es
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
`,ke=`#version 300 es
  precision highp float;
  ${P}
  out vec4 outColor;
  void main() { outColor = vec4(finish(sky(gl_FragCoord.xy)), 1.0); }
`,Ee=`
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
`,Se=`
${H}
${_(q,{count:w+".0"})}
@vertex fn bobVs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Bob {
let corner = vec2f(f32(vertex & 1u), f32(vertex >> 1u)) * 2.0 - 1.0;
let copies = min(${O}.0, max(1.0, floor(look.aspect / ${z})));
let copy = floor(f32(instance) / ${w}.0);
let i = f32(instance) - ${w}.0 * copy;
let time = look.time - ${K} * copy;
let phase = time / ${Y};
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
${Ee}
`,Z={radius:0};function J(o,t){const r=o.shared,e=r?r.gl:o.getContext("webgl2",{antialias:t});if(!e)return null;let c=0;const p=new Map,n=[];return{gl:e,owned:n,setLook(a){const i=a?"display-p3":"srgb";!r&&"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==i&&(e.drawingBufferColorSpace=i),c=a&&"drawingBufferColorSpace"in e&&V()?1:0},setUniforms(a,i,s,u,v=Z){const h=p.get(a)??p.set(a,new Map).get(a),l=d=>h.get(d)??h.set(d,e.getUniformLocation(a,d)).get(d);e.uniform1f(l("uTime"),G(i)),e.uniform1f(l("uAspect"),s/u),e.uniform2f(l("uSize"),s,u),e.uniform1f(l("uGlow"),0),e.uniform1f(l("uHdrRange"),1),e.uniform1f(l("uWide"),c),e.uniform1f(l("uRadius"),v.radius)},size(a,i){r?r.begin(a,i,t):(o.width!==a||o.height!==i)&&(o.width=a,o.height=i),e.viewport(0,0,a,i)},done(){r&&(e.disable(e.DEPTH_TEST),e.disable(e.BLEND),r.end())},dispose(){if(!r){e.getExtension("WEBGL_lose_context")?.loseContext();return}for(const[a,i]of n)e[a](i)}}}function ee(o,t){const r=J(o,D()>1);if(!r)return null;const{gl:e}=r,c=L(e,ge,xe),p=e.createVertexArray(),n=e.createTexture();return r.owned.push(["deleteProgram",c],["deleteVertexArray",p],["deleteTexture",n]),e.bindTexture(e.TEXTURE_2D,n),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA32F,t.data.length/4,1),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),{setLook:r.setLook,dispose:r.dispose,draw(a,i,s){r.size(i,s),e.bindVertexArray(p),e.enable(e.DEPTH_TEST),e.clearColor(0,0,0,1),e.clear(e.COLOR_BUFFER_BIT|e.DEPTH_BUFFER_BIT),e.useProgram(c),r.setUniforms(c,a,i,s),t.update(a),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,n),e.texSubImage2D(e.TEXTURE_2D,0,0,0,t.data.length/4,1,e.RGBA,e.FLOAT,t.data),e.uniform1i(e.getUniformLocation(c,"uTrack"),0),e.drawArrays(e.TRIANGLES,0,X),r.done()}}}function te(o,t){const r=J(o,!1);if(!r)return null;const{gl:e}=r,c=L(e,he,ke),p=L(e,we,Te),n=e.createVertexArray();return r.owned.push(["deleteProgram",c],["deleteProgram",p],["deleteVertexArray",n]),{setLook:r.setLook,dispose:r.dispose,draw(a,i,s){r.size(i,s),e.bindVertexArray(n),e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE),e.disable(e.DEPTH_TEST),e.disable(e.BLEND),e.useProgram(c),r.setUniforms(c,a,i,s),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.enable(e.BLEND),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(p),r.setUniforms(p,a,i,s,t),e.drawArraysInstanced(e.TRIANGLE_STRIP,0,4,w*Q(i/s)),r.done()}}}function oe(o,t,r,e=null){const c=o.getContext("webgpu");if(!c)return null;const p=t.createShaderModule({code:ce(r)}),n=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,a=t.createBuffer({size:48,usage:n}),i=e&&t.createBuffer({size:e.data.byteLength,usage:n}),s=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,u=t.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{}},...e?[{binding:1,visibility:s,buffer:{}}]:[]]}),v=t.createBindGroup({layout:u,entries:[{binding:0,resource:{buffer:a}},...e?[{binding:1,resource:{buffer:i}}]:[]]}),h=new Float32Array(12);let l=null,d=0;const b=(x,g)=>{const y=`${x} ${g}`;y!==l&&(l=y,c.configure({device:t,format:S,alphaMode:"opaque",colorSpace:x?"display-p3":"srgb",toneMapping:{mode:g?"extended":"standard"}}))};return{context:c,module:p,group:v,pipelineLayout:t.createPipelineLayout({bindGroupLayouts:[u]}),setLook(x,g){b(x,g),d=x&&V()?g&&ue()?2:1:0},begin(x,g,y,E,le=Z){l||b(!0,!1),(o.width!==g||o.height!==y)&&(o.width=g,o.height=y),h.set([G(x),g/y,E,E>0?fe:1,g,y,d,le.radius,o.linear?1:0,0,0,0]),t.queue.writeBuffer(a,0,h),e&&(e.update(x),t.queue.writeBuffer(i,0,e.data))},dispose(){a.destroy(),i?.destroy(),c.unconfigure()}}}function re(o,t,r){const e=oe(o,t,be,r);if(!e)return null;const c=D(),p=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"tunnelVs"},fragment:{module:e.module,entryPoint:"tunnelFs",targets:[{format:S}]},depthStencil:{format:"depth24plus",depthCompare:"less",depthWriteEnabled:!0},multisample:{count:c}});let n=null;const a=()=>{n?.color?.destroy(),n?.depth.destroy(),n=null};return{setLook:e.setLook,dispose(){a(),e.dispose()},draw(i,s,u,v){if(e.begin(i,s,u,v),!n||n.width!==s||n.height!==u){a();const d=b=>t.createTexture({size:[s,u],format:b,sampleCount:c,usage:GPUTextureUsage.RENDER_ATTACHMENT});n={width:s,height:u,color:c>1?d(S):null,depth:d("depth24plus")},n.colorView=n.color?.createView(),n.depthView=n.depth.createView()}const h=t.createCommandEncoder(),l=h.beginRenderPass({colorAttachments:[se(n.colorView,e.context.getCurrentTexture().createView())],depthStencilAttachment:{view:n.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});l.setBindGroup(0,e.group),l.setPipeline(p),l.draw(X),l.end(),t.queue.submit([h.finish()])}}}function ne(o,t,r){const e=oe(o,t,Se);if(!e)return null;const c=(s,u)=>({format:"depth24plus",depthCompare:s,depthWriteEnabled:u}),p=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"fullVs"},fragment:{module:e.module,entryPoint:"skyFs",targets:[{format:S}]},depthStencil:c("always",!1)}),n={srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},a=t.createRenderPipeline({layout:e.pipelineLayout,vertex:{module:e.module,entryPoint:"bobVs"},fragment:{module:e.module,entryPoint:"bobFs",targets:[{format:S,blend:{color:n,alpha:n}}]},primitive:{topology:"triangle-strip"},depthStencil:c("less",!0)});let i=null;return{setLook:e.setLook,dispose(){i?.texture.destroy(),e.dispose()},draw(s,u,v,h){if(e.begin(s,u,v,h,r),!i||i.width!==u||i.height!==v){i?.texture.destroy();const b=t.createTexture({size:[u,v],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});i={width:u,height:v,texture:b,view:b.createView()}}const l=t.createCommandEncoder(),d=l.beginRenderPass({colorAttachments:[{view:e.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}],depthStencilAttachment:{view:i.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});d.setBindGroup(0,e.group),d.setPipeline(p),d.draw(3),d.setPipeline(a),d.draw(4,w*Q(u/v)),d.end(),t.queue.submit([l.finish()])}}}const ae=(o,t,r)=>()=>ie(o,pe,de,e=>I.device&&t(e,I.device)||r(e)),U={radius:.05},_e=(o,t)=>ae(o,(r,e)=>ne(r,e,t),r=>te(r,t)),Be=[{label:"Vector Bobs",short:"Bobs",open:_e("Vector Bobs",U)},{label:"Tunnel",open:ae("Tunnel",(o,t)=>re(o,t,A()),o=>ee(o,A()))}],Le={bobs:{gpu:(o,t)=>ne(o,t,U),gl:o=>te(o,U)},tunnel:{gpu:(o,t)=>re(o,t,A()),gl:o=>ee(o,A())},tunnelRide:A};export{Be as EFFECTS,Le as effectDrawers};
