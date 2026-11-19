import{showWindow as $,keepInView as X}from"./gui.js?v=2.04-251";import{HDR_RANGE as Y}from"./gpu-renderer.js?v=2.04-251";import{onP3Screen as M,onRec2020Screen as K}from"./renderer.js?v=2.04-251";const k=200*Math.PI,Z=3840*2160,H=8192,U=o=>(o%k+k)%k,m={device:null,hdr:!1,glow:!0,strength:1,wide:!0,onFullScreen:null,fpsEvery:1},j=2.5,C=960,D=2*(C+1),O=4*C*6;function N(){const o=new Uint32Array(O);let e=0;for(let c=0;c<4;c++)for(let l=0;l<C;l++){const t=c*D+2*l,n=t+1,s=t+2,w=t+3;o.set([t,n,w,t,w,s],e),e+=6}return o}const J=340,Q=440,W=.5,z=.4,ee=`#version 300 es
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
const float SLICES = ${C}.0;
const float HALF_HEIGHT = 1.45;
const float RADIUS = 0.46;
float angleAt(float y) {
return 0.6 * time
+ 2.4 * sin(0.53 * time) * y
+ 0.7 * sin(2.6 * y + 1.3 * time);
}
float swayAt(float y) {
return 0.16 * sin(1.7 * y + 0.9 * time);
}
float angleSlopeAt(float y) {
return 2.4 * sin(0.53 * time) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * time);
}
float swaySlopeAt(float y) {
return 0.16 * 1.7 * cos(1.7 * y + 0.9 * time);
}
void edgeAt(float y, int edge, out vec3 position, out vec3 direction) {
float angle = PI / 4.0 + float(edge) * PI / 2.0 + angleAt(y);
position = vec3(RADIUS * cos(angle) + swayAt(y), y * HALF_HEIGHT, RADIUS * sin(angle));
direction = vec3(-RADIUS * sin(angle) * angleSlopeAt(y) + swaySlopeAt(y), HALF_HEIGHT,
RADIUS * cos(angle) * angleSlopeAt(y));
}
void main() {
time = uTime - uDelay;
vSide = gl_VertexID / ${D};
int along = gl_VertexID - vSide * ${D};
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
`,te=`#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vPattern;
flat in int vSide;
out vec4 outColor;
uniform int uColorTurn;
const vec3 SIDE_COLORS[4] = vec3[4](
vec3(0.769, 0.008, 0.200),
vec3(0.000, 0.624, 0.420),
vec3(0.000, 0.529, 0.741),
vec3(1.000, 0.827, 0.000));
const vec3 SIDE_COLORS_P3[4] = vec3[4](
vec3( 0.8242, -0.1608, 0.1756),
vec3(-0.3157, 0.6472, 0.3911),
vec3(-0.2504, 0.5236, 0.7784),
vec3( 1.0176, 0.8609, -0.3058));
uniform float uWide;
vec3 toLinear(vec3 c) { vec3 a = abs(c); return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a)); }
vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toCanvas(vec3 linear) {
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
}
float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
float squareWave(float x, float blur) {
blur = max(blur, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
void main() {
vec2 square = vec2(vPattern.x * 2.0, (vPattern.y * 0.5 + 0.5) * 9.0);
vec2 blur = fwidth(square);
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
`,oe=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,re=`#version 300 es
precision highp float;
uniform float uHeight;
out vec4 outColor;
uniform float uWide;
vec3 toLinear(vec3 c) { vec3 a = abs(c); return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a)); }
vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toCanvas(vec3 linear) {
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
}
void main() {
vec3 color = mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), gl_FragCoord.y / uHeight);
outColor = vec4(uWide > 0.5 ? toScreen(max(toCanvas(toLinear(color)), 0.0)) : color, 1.0);
}
`,ne=()=>document.getElementById("guru")!==null;function de(){ae("Twist v4",J,Q,o=>m.device&&le(o,m.device)||ie(o))}function ae(o,e,c,l){let t=document.createElement("canvas");t.className="twist-canvas";const n=document.createElement("div");n.className="twist-frame",n.append(t);let s=l(t);if(!s)return;let w=m.device;const v=(r,p)=>{const B=Math.min(window.devicePixelRatio||1,2,Math.sqrt(Z/Math.max(1,r*p)),H/Math.max(1,r),H/Math.max(1,p));t.style.width=`${r}px`,t.style.height=`${p}px`,t.width=Math.max(1,Math.round(r*B)),t.height=Math.max(1,Math.round(p*B))};v(e,c);const T=()=>{s.dispose();const r=document.createElement("canvas");r.className=t.className,r.style.cssText=t.style.cssText,r.width=t.width,r.height=t.height,t.replaceWith(r),t=r,w=m.device,s=l(t)??{setLook(){},draw(){},dispose(){}}};let _=!0;const P="IntersectionObserver"in window?new IntersectionObserver(r=>{_=r[r.length-1].isIntersecting}):null;P?.observe(n);let x=0,h=!0;const g=performance.now();function d(r){if(!h||(requestAnimationFrame(d),ne()||!_)||++x<(m.fpsEvery??1))return;x=0,m.device!==w&&T();const p=(r-g)/1e3;s.setLook(m.wide,m.hdr);const B=m.hdr&&m.glow?j*m.strength:0;s.draw(p,t.width,t.height,B)}requestAnimationFrame(d);const a=()=>document.fullscreenElement??document.webkitFullscreenElement,A=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);let y=[e,c],i=null,f=!1;const u=r=>{r!==f&&(f=r,m.onFullScreen?.(r))};let S=null;const L=()=>{const r=n.closest(".window");S=r?{left:parseFloat(r.style.left)||r.offsetLeft,top:parseFloat(r.style.top)||r.offsetTop}:null},I=()=>{const r=n.closest(".window");if(!r)return;S&&(r.dataset.left=S.left,r.dataset.top=S.top,S=null);const p=()=>{!n.isConnected||f||(document.scrollingElement?.scrollTo(0,0),X(r))};p(),requestAnimationFrame(p),setTimeout(p,250),setTimeout(p,1e3)},R=r=>{r?(i={parent:n.parentNode,next:n.nextSibling},document.body.append(n),n.classList.add("twist-cover"),v(innerWidth,innerHeight),u(!0)):(i.parent.insertBefore(n,i.next),i=null,n.classList.remove("twist-cover"),v(...y),u(!1),I())},E=()=>{if(i){R(!1);return}if(a()===n){(document.exitFullscreen??document.webkitExitFullscreen).call(document);return}if(y=[parseFloat(t.style.width),parseFloat(t.style.height)],L(),a()){R(!0);return}(n.requestFullscreen??n.webkitRequestFullscreen).call(n)?.catch?.(()=>{})},b=()=>{if(i){a()||R(!1);return}a()===n?(v(screen.width,screen.height),u(!0)):(v(...y),u(!1),I())},F=()=>{i&&v(innerWidth,innerHeight)};A&&(document.addEventListener("fullscreenchange",b),document.addEventListener("webkitfullscreenchange",b),addEventListener("resize",F),n.addEventListener("dblclick",E)),$(o,n,()=>{h=!1,document.removeEventListener("fullscreenchange",b),document.removeEventListener("webkitfullscreenchange",b),removeEventListener("resize",F),P?.disconnect(),i&&n.remove(),u(!1),a()===n&&(document.exitFullscreen??document.webkitExitFullscreen).call(document),s.dispose()},v,A?E:null)}function ie(o){const e=o.getContext("webgl2",{antialias:!0});if(!e)return null;const c=q(e,ee,te),l=q(e,oe,re),t=(g,d)=>e.getUniformLocation(g,d),n=t(c,"uTime"),s=t(c,"uAspect"),w=t(c,"uShift"),v=t(c,"uDelay"),T=t(c,"uColorTurn"),_=t(l,"uHeight"),P=t(c,"uWide"),x=t(l,"uWide");let h=0;return e.bindVertexArray(e.createVertexArray()),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,e.createBuffer()),e.bufferData(e.ELEMENT_ARRAY_BUFFER,N(),e.STATIC_DRAW),e.frontFace(e.CW),{setLook(g){const d=g?"display-p3":"srgb";"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==d&&(e.drawingBufferColorSpace=d),h=g&&"drawingBufferColorSpace"in e&&M()?1:0},draw(g,d,a){(o.width!==d||o.height!==a)&&(o.width=d,o.height=a),e.viewport(0,0,d,a),e.disable(e.DEPTH_TEST),e.useProgram(l),e.uniform1f(_,a),e.uniform1f(x,h),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.enable(e.CULL_FACE),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(c),e.uniform1f(P,h);const A=d/a;e.uniform1f(n,U(g)),e.uniform1f(s,A);const y=Math.min(V,Math.max(1,Math.floor(A/W)));for(let i=0;i<y;i++)e.uniform1f(w,(i+.5)/y*2-1),e.uniform1f(v,i*z),e.uniform1i(T,i%4),e.drawElements(e.TRIANGLES,O,e.UNSIGNED_INT,0);e.disable(e.CULL_FACE)},dispose(){e.getExtension("WEBGL_lose_context")?.loseContext()}}}function q(o,e,c){const l=o.createProgram();for(const[t,n]of[[o.VERTEX_SHADER,e],[o.FRAGMENT_SHADER,c]]){const s=o.createShader(t);if(o.shaderSource(s,n),o.compileShader(s),!o.getShaderParameter(s,o.COMPILE_STATUS))throw new Error(`Shader compile error:
`+o.getShaderInfoLog(s));o.attachShader(l,s)}if(o.linkProgram(l),!o.getProgramParameter(l,o.LINK_STATUS))throw new Error(`Shader link error:
`+o.getProgramInfoLog(l));return l}const G="rgba16float",V=16,ce=`
struct Look { time: f32, aspect: f32, count: f32, glow: f32, height: f32, hdrRange: f32, wide: f32, _b: f32 }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
const SLICES = ${C}u;
const HALF_HEIGHT = 1.45;
const RADIUS = 0.46;
fn angleAt(y: f32, t: f32) -> f32 { return 0.6 * t + 2.4 * sin(0.53 * t) * y + 0.7 * sin(2.6 * y + 1.3 * t); }
fn swayAt(y: f32, t: f32) -> f32 { return 0.16 * sin(1.7 * y + 0.9 * t); }
fn angleSlopeAt(y: f32, t: f32) -> f32 { return 2.4 * sin(0.53 * t) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * t); }
fn swaySlopeAt(y: f32, t: f32) -> f32 { return 0.16 * 1.7 * cos(1.7 * y + 0.9 * t); }
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
let t = look.time - f32(twist) * ${z};
let side = v / ${D}u;
let along = v - side * ${D}u;
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
fn toLinear(c: vec3f) -> vec3f {
let a = abs(c);
return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a < vec3f(0.04045));
}
fn toCanvas(l: vec3f) -> vec3f {
const SRGB_TO_P3 = mat3x3f(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
}
fn toScreen(c: vec3f) -> vec3f { let a = abs(c); return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308)); }
fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
fn squareWave(x: f32, blur0: f32) -> f32 {
let blur = max(blur0, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
@fragment fn barFs(b: Bar) -> @location(0) vec4f {
var colors = array<vec3f, 4>(vec3f(0.769, 0.008, 0.200), vec3f(0.000, 0.624, 0.420),
vec3f(0.000, 0.529, 0.741), vec3f(1.000, 0.827, 0.000));
if (look.wide > 1.5) {
colors = array<vec3f, 4>(vec3f(0.9059, -0.2723, 0.1406), vec3f(-0.5210, 0.6906, 0.3214),
vec3f(-0.4457, 0.5113, 0.8618), vec3f(1.0212, 0.8716, -0.3339));
} else if (look.wide > 0.5) {
colors = array<vec3f, 4>(vec3f(0.8242, -0.1608, 0.1756), vec3f(-0.3157, 0.6472, 0.3911),
vec3f(-0.2504, 0.5236, 0.7784), vec3f(1.0176, 0.8609, -0.3058));
}
let square = vec2f(b.pattern.x * 2.0, (b.pattern.y * 0.5 + 0.5) * 9.0);
let blur = fwidth(square);
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
return vec4f(toScreen(clamp(lit, vec3f(select(0.0, -1.0, look.wide > 1.5)), vec3f(max(1.0, look.hdrRange)))), 1.0);
}
@vertex fn backdropVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 1.0, 1.0);
}
@fragment fn backdropFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let color = mix(vec3f(0.33, 0.40, 0.60), vec3f(0.0, 0.0, 0.2), (look.height - at.y) / look.height);
return vec4f(select(color, toScreen(max(toCanvas(toLinear(color)), vec3f(0.0))), look.wide > 0.5), 1.0);
}
`;function le(o,e){const c=o.getContext("webgpu");if(!c)return null;const l=e.createShaderModule({code:ce}),t=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),n=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}}]}),s=e.createBindGroup({layout:n,entries:[{binding:0,resource:{buffer:t}}]}),w=e.createPipelineLayout({bindGroupLayouts:[n]}),v=4,T=(i,f,u,S,L={})=>e.createRenderPipeline({layout:w,vertex:{module:l,entryPoint:i},fragment:{module:l,entryPoint:f,targets:[{format:G}]},depthStencil:{format:"depth24plus",depthCompare:u,depthWriteEnabled:S},multisample:{count:v},primitive:L}),_=T("backdropVs","backdropFs","always",!1),P=T("barVs","barFs","less",!0,{cullMode:"back",frontFace:"cw"}),x=N(),h=e.createBuffer({size:x.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});e.queue.writeBuffer(h,0,x);const g=new Float32Array(8);let d=null,a=null,A=0;const y=(i,f)=>{const u=`${i} ${f}`;u!==d&&(d=u,c.configure({device:e,format:G,alphaMode:"opaque",colorSpace:i?"display-p3":"srgb",toneMapping:{mode:f?"extended":"standard"}}))};return{setLook(i,f){y(i,f),A=i&&M()?f&&K()?2:1:0},draw(i,f,u,S){if(d||y(!0,!1),(o.width!==f||o.height!==u)&&(o.width=f,o.height=u),!a||a.width!==f||a.height!==u){a?.color.destroy(),a?.depth.destroy();const b=F=>e.createTexture({size:[f,u],format:F,sampleCount:v,usage:GPUTextureUsage.RENDER_ATTACHMENT});a={width:f,height:u,color:b(G),depth:b("depth24plus")},a.colorView=a.color.createView(),a.depthView=a.depth.createView()}const L=f/u,I=Math.min(V,Math.max(1,Math.floor(L/W)));g.set([U(i),L,I,S,u,S>0?Y:1,A,0]),e.queue.writeBuffer(t,0,g);const R=e.createCommandEncoder(),E=R.beginRenderPass({colorAttachments:[{view:a.colorView,resolveTarget:c.getCurrentTexture().createView(),loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,1]}],depthStencilAttachment:{view:a.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});E.setBindGroup(0,s),E.setPipeline(_),E.draw(3),E.setPipeline(P),E.setIndexBuffer(h,"uint32"),E.drawIndexed(O,I),E.end(),e.queue.submit([R.finish()])},dispose(){a?.color.destroy(),a?.depth.destroy(),t.destroy(),h.destroy(),c.unconfigure()}}}export{k as EFFECT_PERIOD,G as GPU_FORMAT,ie as createDrawer,le as createGpuDrawer,q as createProgram,U as effectTime,ae as openEffectWindow,de as openTwistWindow,m as twistOptions};
