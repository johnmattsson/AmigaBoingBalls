import{showWindow as ce,keepInView as fe}from"./gui.js?v=2.04-397";import{twistOptions as p,samples as H,effectLook as W}from"./effect-options.js?v=2.04-397";const ue={ms:0};import{toGlsl as U,toWgsl as V,SQUARE_WAVE as j,COLOR_CURVES as $}from"./shade.js?v=2.04-397";import{BALL_COLORS as F,colorList as D,srgbToP3Matrix as z}from"./colors.js?v=2.04-397";import{HDR_RANGE as de}from"./gpu-renderer.js?v=2.04-397";import{onP3Screen as J,onRec2020Screen as me}from"./renderer.js?v=2.04-397";const q=200*Math.PI,pe=3840*2160,ee=8192,te=t=>(t%q+q)%q,oe=`
  fn angleAt(y: f32, t: f32) -> f32 {
    return 0.6 * t
         + 2.4 * sin(0.53 * t) * y
         + 0.7 * sin(2.6 * y + 1.3 * t);
  }
  fn swayAt(y: f32, t: f32) -> f32 { return 0.16 * sin(1.7 * y + 0.9 * t); }
  fn angleSlopeAt(y: f32, t: f32) -> f32 { return 2.4 * sin(0.53 * t) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * t); }
  fn swaySlopeAt(y: f32, t: f32) -> f32 { return 0.16 * 1.7 * cos(1.7 * y + 0.9 * t); }`,ge=2.5;let N=1;const X=new Set;function ke(t){if(t!==N){N=t,p.sharp=t>1;for(const n of X)n()}}const ne=t=>t.replaceAll("SOFTNESS",p.sharp?"0.001":"1.0"),ve=(t,n)=>t?{view:t,resolveTarget:n,loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,1]}:{view:n,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]},Se=()=>p.hdr&&p.glow?ge*p.strength:0,B=960,k=2*(B+1),Y=4*B*6;function re(){const t=new Uint32Array(Y);let n=0;for(let u=0;u<4;u++)for(let e=0;e<B;e++){const o=u*k+2*e,i=o+1,a=o+2,w=o+3;t.set([o,i,w,o,w,a],n),n+=6}return t}const he=340,Ee=440,ie=.5,ae=.4,we=`#version 300 es
precision highp float;
uniform float uTime;
uniform float uAspect;
uniform float uShift;
uniform float uDelay;
float time;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vPattern;
flat out int vSide;
const float PI = 3.14159265359;
const float SLICES = ${B}.0;
const float HALF_HEIGHT = 1.45;
const float RADIUS = 0.46;
${U(oe)}
void edgeAt(float y, int edge, out vec3 position, out vec3 direction) {
float angle = PI / 4.0 + float(edge) * PI / 2.0 + angleAt(y, time);
position = vec3(RADIUS * cos(angle) + swayAt(y, time), y * HALF_HEIGHT, RADIUS * sin(angle));
direction = vec3(-RADIUS * sin(angle) * angleSlopeAt(y, time) + swaySlopeAt(y, time), HALF_HEIGHT,
RADIUS * cos(angle) * angleSlopeAt(y, time));
}
void main() {
time = uTime - uDelay;
vSide = gl_VertexID / ${k};
int along = gl_VertexID - vSide * ${k};
bool right = (along & 1) == 1;
float y = (float(along >> 1) / SLICES) * 2.0 - 1.0;
vec3 leftEdge, leftDirection, rightEdge, rightDirection;
edgeAt(y, vSide, leftEdge, leftDirection);
edgeAt(y, vSide + 1, rightEdge, rightDirection);
vPosition = right ? rightEdge : leftEdge;
vPattern = vec2(float(right), y);
vNormal = cross(right ? rightDirection : leftDirection, rightEdge - leftEdge);
const float CAMERA_DISTANCE = 4.4;
const float ZOOM = 2.6;
float distance = CAMERA_DISTANCE - vPosition.z;
gl_Position = vec4(vPosition.x * ZOOM / uAspect + uShift * distance, vPosition.y * ZOOM,
(vPosition.z * -0.2) * distance,
distance);
}
`,Ae=`#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vPattern;
flat in int vSide;
out vec4 outColor;
uniform int uColorTurn;
const vec3 SIDE_COLORS[4] = vec3[4](${D(F,0,"glsl")});
const vec3 SIDE_COLORS_P3[4] = vec3[4](${D(F,1,"glsl")});
uniform float uWide;
${U($)}
vec3 toCanvas(vec3 linear) {
const mat3 SRGB_TO_P3 = ${z("glsl")};
return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
}
${U(j)}
void main() {
vec2 square = vec2(vPattern.x * 2.0, (vPattern.y * 0.5 + 0.5) * 9.0);
vec2 blur = fwidth(square) * SOFTNESS;
float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
int side = (vSide + uColorTurn) % 4;
vec3 color = mix(vec3(1.0), uWide > 0.5 ? SIDE_COLORS_P3[side] : SIDE_COLORS[side], checker);
vec3 normal = normalize(vNormal);
vec3 toCamera = normalize(vec3(0.0, 0.0, 4.4) - vPosition);
if (dot(normal, toCamera) < 0.0) normal = -normal;
vec3 toLamp = normalize(vec3(-0.5, 0.7, 0.9));
float facing = max(0.0, dot(normal, toLamp));
vec3 halfway = normalize(toLamp + toCamera);
float shine = pow(max(0.0, dot(normal, halfway)), 48.0);
vec3 lit = toCanvas(toLinear(color)) * (0.25 + 0.85 * facing) + vec3(0.45) * shine;
outColor = vec4(toScreen(clamp(lit, 0.0, 1.0)), 1.0);
}
`,ye=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,xe=`#version 300 es
precision highp float;
uniform float uHeight;
out vec4 outColor;
uniform float uWide;
${U($)}
vec3 toCanvas(vec3 linear) {
const mat3 SRGB_TO_P3 = ${z("glsl")};
return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
}
void main() {
vec3 color = mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), gl_FragCoord.y / uHeight);
outColor = vec4(uWide > 0.5 ? toScreen(max(toCanvas(toLinear(color)), 0.0)) : color, 1.0);
}
`,Te=()=>document.getElementById("guru")!==null;function Oe(){_e("Twist v4",he,Ee,t=>p.device&&Re(t,p.device)||be(t))}function _e(t,n,u,e){let o=document.createElement("canvas");o.className="twist-canvas";const i=document.createElement("div");i.className="twist-frame",i.append(o);let a=e(o);if(!a)return;let w=p.device,A=W(),_=[n,u];const g=(r,v)=>{_=[r,v];const C=window.devicePixelRatio||1,I=N>1?Math.max(1,Math.round(N*C))/C:0,Q=Math.min(I?1/I:C,2,Math.sqrt(pe/Math.max(1,r*v)),ee/Math.max(1,r),ee/Math.max(1,v));o.style.imageRendering=I?"pixelated":"",o.style.width=`${r}px`,o.style.height=`${v}px`,o.width=Math.max(1,Math.round(r*Q)),o.height=Math.max(1,Math.round(v*Q))};g(n,u);const P=()=>g(..._);X.add(P);const R=()=>{a.dispose();const r=document.createElement("canvas");r.className=o.className,r.style.cssText=o.style.cssText,r.width=o.width,r.height=o.height,o.replaceWith(r),o=r,w=p.device,A=W(),a=e(o)??{setLook(){},draw(){},dispose(){}}};let y=!0;const b="IntersectionObserver"in window?new IntersectionObserver(r=>{y=r[r.length-1].isIntersecting}):null;b?.observe(i);let h=!0;const f=performance.now();function x(r){if(!h||(requestAnimationFrame(x),Te()||!y))return;(p.device!==w||W()!==A)&&R();const v=(r-f)/1e3;a.setLook(p.wide,p.hdr);const C=Se(),I=performance.now();a.draw(v,o.width,o.height,C),ue.ms+=performance.now()-I}requestAnimationFrame(x);const d=()=>document.fullscreenElement??document.webkitFullscreenElement,c=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);let s=[n,u],l=null,S=!1;const m=r=>{r!==S&&(S=r,p.onFullScreen?.(r))};let T=null;const O=()=>{const r=i.closest(".window");T=r?{left:parseFloat(r.style.left)||r.offsetLeft,top:parseFloat(r.style.top)||r.offsetTop}:null},E=()=>{const r=i.closest(".window");if(!r)return;T&&(r.dataset.left=T.left,r.dataset.top=T.top,T=null);const v=()=>{!i.isConnected||S||(document.scrollingElement?.scrollTo(0,0),fe(r))};v(),requestAnimationFrame(v),setTimeout(v,250),setTimeout(v,1e3)},L=r=>{r?(l={parent:i.parentNode,next:i.nextSibling},document.body.append(i),i.classList.add("twist-cover"),g(innerWidth,innerHeight),m(!0)):(l.parent.insertBefore(i,l.next),l=null,i.classList.remove("twist-cover"),g(...s),m(!1),E())},M=()=>{if(l){L(!1);return}if(d()===i){(document.exitFullscreen??document.webkitExitFullscreen).call(document);return}if(s=[parseFloat(o.style.width),parseFloat(o.style.height)],O(),d()){L(!0);return}(i.requestFullscreen??i.webkitRequestFullscreen).call(i)?.catch?.(()=>{})},G=()=>{if(l){d()||L(!1);return}d()===i?(g(screen.width,screen.height),m(!0)):(g(...s),m(!1),E())},Z=()=>{l&&g(innerWidth,innerHeight)};c&&(document.addEventListener("fullscreenchange",G),document.addEventListener("webkitfullscreenchange",G),addEventListener("resize",Z),i.addEventListener("dblclick",M)),ce(t,i,()=>{h=!1,X.delete(P),document.removeEventListener("fullscreenchange",G),document.removeEventListener("webkitfullscreenchange",G),removeEventListener("resize",Z),b?.disconnect(),l&&i.remove(),m(!1),d()===i&&(document.exitFullscreen??document.webkitExitFullscreen).call(document),a.dispose()},g,c?M:null)}function be(t){const n=t.shared,u=H()>1,e=n?n.gl:t.getContext("webgl2",{antialias:u});if(!e)return null;const o=se(e,we,Ae),i=se(e,ye,xe),a=(d,c)=>e.getUniformLocation(d,c),w=a(o,"uTime"),A=a(o,"uAspect"),_=a(o,"uShift"),g=a(o,"uDelay"),P=a(o,"uColorTurn"),R=a(i,"uHeight"),y=a(o,"uWide"),b=a(i,"uWide");let h=0;const f=e.createVertexArray(),x=e.createBuffer();return e.bindVertexArray(f),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,x),e.bufferData(e.ELEMENT_ARRAY_BUFFER,re(),e.STATIC_DRAW),e.bindVertexArray(null),{setLook(d){const c=d?"display-p3":"srgb";!n&&"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==c&&(e.drawingBufferColorSpace=c),h=d&&"drawingBufferColorSpace"in e&&J()?1:0},draw(d,c,s){n?n.begin(c,s,u):(t.width!==c||t.height!==s)&&(t.width=c,t.height=s),e.viewport(0,0,c,s),e.bindVertexArray(f),e.frontFace(e.CW),e.disable(e.DEPTH_TEST),e.useProgram(i),e.uniform1f(R,s),e.uniform1f(b,h),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.enable(e.CULL_FACE),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(o),e.uniform1f(y,h);const l=c/s;e.uniform1f(w,te(d)),e.uniform1f(A,l);const S=Math.min(le,Math.max(1,Math.floor(l/ie)));for(let m=0;m<S;m++)e.uniform1f(_,(m+.5)/S*2-1),e.uniform1f(g,m*ae),e.uniform1i(P,m%4),e.drawElements(e.TRIANGLES,Y,e.UNSIGNED_INT,0);e.disable(e.CULL_FACE),e.frontFace(e.CCW),n&&n.end()},dispose(){if(!n){e.getExtension("WEBGL_lose_context")?.loseContext();return}for(const d of[o,i])e.deleteProgram(d);e.deleteVertexArray(f),e.deleteBuffer(x)}}}function se(t,n,u){const e=t.createProgram();for(const[o,i]of[[t.VERTEX_SHADER,n],[t.FRAGMENT_SHADER,u]]){const a=t.createShader(o);if(t.shaderSource(a,ne(i)),t.compileShader(a),!t.getShaderParameter(a,t.COMPILE_STATUS))throw new Error(`Shader compile error:
`+t.getShaderInfoLog(a));t.attachShader(e,a)}if(t.linkProgram(e),!t.getProgramParameter(e,t.LINK_STATUS))throw new Error(`Shader link error:
`+t.getProgramInfoLog(e));return e}const K="rgba16float",le=16,Pe=`
struct Look { time: f32, aspect: f32, count: f32, glow: f32, height: f32, hdrRange: f32, wide: f32, linear: f32 }
fn shown(c: vec3f) -> vec3f { return select(toScreen(c), c, look.linear > 0.5); }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
const SLICES = ${B}u;
const HALF_HEIGHT = 1.45;
const RADIUS = 0.46;
${V(oe)}
struct Edge { position: vec3f, direction: vec3f }
fn edgeAt(y: f32, edge: u32, t: f32) -> Edge {
let angle = PI / 4.0 + f32(edge) * PI / 2.0 + angleAt(y, t);
var e: Edge;
e.position = vec3f(RADIUS * cos(angle) + swayAt(y, t), y * HALF_HEIGHT, RADIUS * sin(angle));
e.direction = vec3f(-RADIUS * sin(angle) * angleSlopeAt(y, t) + swaySlopeAt(y, t), HALF_HEIGHT,
RADIUS * cos(angle) * angleSlopeAt(y, t));
return e;
}
struct Bar {
@builtin(position) at: vec4f,
@location(0) position: vec3f,
@location(1) normal: vec3f,
@location(2) pattern: vec2f,
@location(3) @interpolate(flat) side: u32,
}
@vertex fn barVs(@builtin(vertex_index) v: u32, @builtin(instance_index) twist: u32) -> Bar {
let shift = ((f32(twist) + 0.5) / look.count) * 2.0 - 1.0;
let t = look.time - f32(twist) * ${ae};
let side = v / ${k}u;
let along = v - side * ${k}u;
var o: Bar;
o.side = (side + twist) % 4u;
let right = (along & 1u) == 1u;
let y = (f32(along >> 1u) / f32(SLICES)) * 2.0 - 1.0;
let left = edgeAt(y, side, t);
let rightEdge = edgeAt(y, side + 1u, t);
o.position = select(left.position, rightEdge.position, right);
o.pattern = vec2f(select(0.0, 1.0, right), y);
o.normal = cross(select(left.direction, rightEdge.direction, right), rightEdge.position - left.position);
let distance = 4.4 - o.position.z;
o.at = vec4f(o.position.x * 2.6 / look.aspect + shift * distance, o.position.y * 2.6,
(0.5 - 0.1 * o.position.z) * distance, distance);
return o;
}
${V($)}
fn toCanvas(l: vec3f) -> vec3f {
const SRGB_TO_P3 = ${z("wgsl")};
return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
}
${V(j).trim()}
@fragment fn barFs(b: Bar) -> @location(0) vec4f {
var colors = array<vec3f, 4>(${D(F,0,"wgsl")});
if (look.wide > 1.5) {
colors = array<vec3f, 4>(${D(F,2,"wgsl")});
} else if (look.wide > 0.5) {
colors = array<vec3f, 4>(${D(F,1,"wgsl")});
}
let square = vec2f(b.pattern.x * 2.0, (b.pattern.y * 0.5 + 0.5) * 9.0);
let blur = fwidth(square) * SOFTNESS;
let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
let color = mix(vec3f(1.0), colors[b.side], checker);
var normal = normalize(b.normal);
let toCamera = normalize(vec3f(0.0, 0.0, 4.4) - b.position);
if (dot(normal, toCamera) < 0.0) { normal = -normal; }
let toLamp = normalize(vec3f(-0.5, 0.7, 0.9));
let facing = max(0.0, dot(normal, toLamp));
let halfway = normalize(toLamp + toCamera);
let shine = pow(max(0.0, dot(normal, halfway)), 48.0);
let lit = toCanvas(toLinear(color)) * (0.25 + 0.85 * facing) + vec3f(0.45 + look.glow) * shine;
return vec4f(shown(clamp(lit, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)))), 1.0);
}
@vertex fn backdropVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 1.0, 1.0);
}
@fragment fn backdropFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let color = mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), (look.height - at.y) / look.height);
if (look.linear > 0.5) { return vec4f(max(toCanvas(toLinear(color)), vec3f(0.0)), 1.0); }
return vec4f(select(color, toScreen(max(toCanvas(toLinear(color)), vec3f(0.0))), look.wide > 0.5), 1.0);
}
`;function Re(t,n){const u=t.getContext("webgpu");if(!u)return null;const e=n.createShaderModule({code:ne(Pe)}),o=n.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),i=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}}]}),a=n.createBindGroup({layout:i,entries:[{binding:0,resource:{buffer:o}}]}),w=n.createPipelineLayout({bindGroupLayouts:[i]}),A=H(),_=(c,s,l,S,m={})=>n.createRenderPipeline({layout:w,vertex:{module:e,entryPoint:c},fragment:{module:e,entryPoint:s,targets:[{format:K}]},depthStencil:{format:"depth24plus",depthCompare:l,depthWriteEnabled:S},multisample:{count:A},primitive:m}),g=_("backdropVs","backdropFs","always",!1),P=_("barVs","barFs","less",!0,{cullMode:"back",frontFace:"cw"}),R=re(),y=n.createBuffer({size:R.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});n.queue.writeBuffer(y,0,R);const b=new Float32Array(8);let h=null,f=null,x=0;const d=(c,s)=>{const l=`${c} ${s}`;l!==h&&(h=l,u.configure({device:n,format:K,alphaMode:"opaque",colorSpace:c?"display-p3":"srgb",toneMapping:{mode:s?"extended":"standard"}}))};return{setLook(c,s){d(c,s),x=c&&J()?s&&me()?2:1:0},draw(c,s,l,S){if(h||d(!0,!1),(t.width!==s||t.height!==l)&&(t.width=s,t.height=l),!f||f.width!==s||f.height!==l){f?.color?.destroy(),f?.depth.destroy();const L=M=>n.createTexture({size:[s,l],format:M,sampleCount:A,usage:GPUTextureUsage.RENDER_ATTACHMENT});f={width:s,height:l,color:A>1?L(K):null,depth:L("depth24plus")},f.colorView=f.color?.createView(),f.depthView=f.depth.createView()}const m=s/l,T=Math.min(le,Math.max(1,Math.floor(m/ie)));b.set([te(c),m,T,S,l,S>0?de:1,x,t.linear?1:0]),n.queue.writeBuffer(o,0,b);const O=n.createCommandEncoder(),E=O.beginRenderPass({colorAttachments:[ve(f.colorView,u.getCurrentTexture().createView())],depthStencilAttachment:{view:f.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});E.setBindGroup(0,a),E.setPipeline(g),E.draw(3),E.setPipeline(P),E.setIndexBuffer(y,"uint32"),E.drawIndexed(Y,T),E.end(),n.queue.submit([O.finish()])},dispose(){f?.color?.destroy(),f?.depth.destroy(),o.destroy(),y.destroy(),u.unconfigure()}}}export{q as EFFECT_PERIOD,K as GPU_FORMAT,ve as colorTarget,be as createDrawer,Re as createGpuDrawer,se as createProgram,Se as effectGlow,W as effectLook,te as effectTime,ue as effectWindowsTime,_e as openEffectWindow,Oe as openTwistWindow,H as samples,ke as setEffectPixelSize,ne as sharpen,p as twistOptions};
