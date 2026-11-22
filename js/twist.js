import{showWindow as ae,keepInView as ce}from"./gui.js?v=2.04-325";import{twistOptions as v,samples as W,effectLook as O}from"./effect-options.js?v=2.04-325";import{toGlsl as M,toWgsl as N,SQUARE_WAVE as K,COLOR_CURVES as H}from"./shade.js?v=2.04-325";import{HDR_RANGE as se}from"./gpu-renderer.js?v=2.04-325";import{onP3Screen as Z,onRec2020Screen as le}from"./renderer.js?v=2.04-325";const V=200*Math.PI,fe=3840*2160,Q=8192,j=t=>(t%V+V)%V,J=`
  fn angleAt(y: f32, t: f32) -> f32 {
    return 0.6 * t
         + 2.4 * sin(0.53 * t) * y
         + 0.7 * sin(2.6 * y + 1.3 * t);
  }
  fn swayAt(y: f32, t: f32) -> f32 { return 0.16 * sin(1.7 * y + 0.9 * t); }
  fn angleSlopeAt(y: f32, t: f32) -> f32 { return 2.4 * sin(0.53 * t) + 0.7 * 2.6 * cos(2.6 * y + 1.3 * t); }
  fn swaySlopeAt(y: f32, t: f32) -> f32 { return 0.16 * 1.7 * cos(1.7 * y + 0.9 * t); }`,ue=2.5;let G=1;const z=new Set;function Le(t){if(t!==G){G=t,v.sharp=t>1;for(const n of z)n()}}const ee=t=>t.replaceAll("SOFTNESS",v.sharp?"0.001":"1.0"),de=(t,n)=>t?{view:t,resolveTarget:n,loadOp:"clear",storeOp:"discard",clearValue:[0,0,0,1]}:{view:n,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]},me=()=>v.hdr&&v.glow?ue*v.strength:0,I=960,F=2*(I+1),q=4*I*6;function te(){const t=new Uint32Array(q);let n=0;for(let u=0;u<4;u++)for(let e=0;e<I;e++){const o=u*F+2*e,i=o+1,a=o+2,w=o+3;t.set([o,i,w,o,w,a],n),n+=6}return t}const ve=340,pe=440,oe=.5,ne=.4,ge=`#version 300 es
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
const float SLICES = ${I}.0;
const float HALF_HEIGHT = 1.45;
const float RADIUS = 0.46;
${M(J)}
void edgeAt(float y, int edge, out vec3 position, out vec3 direction) {
float angle = PI / 4.0 + float(edge) * PI / 2.0 + angleAt(y, time);
position = vec3(RADIUS * cos(angle) + swayAt(y, time), y * HALF_HEIGHT, RADIUS * sin(angle));
direction = vec3(-RADIUS * sin(angle) * angleSlopeAt(y, time) + swaySlopeAt(y, time), HALF_HEIGHT,
RADIUS * cos(angle) * angleSlopeAt(y, time));
}
void main() {
time = uTime - uDelay;
vSide = gl_VertexID / ${F};
int along = gl_VertexID - vSide * ${F};
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
`,Se=`#version 300 es
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
${M(H)}
vec3 toCanvas(vec3 linear) {
const mat3 SRGB_TO_P3 = mat3(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
return uWide > 0.5 ? SRGB_TO_P3 * linear : linear;
}
${M(K)}
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
`,he=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,Ee=`#version 300 es
precision highp float;
uniform float uHeight;
out vec4 outColor;
uniform float uWide;
${M(H)}
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
`,we=()=>document.getElementById("guru")!==null;function Ie(){Ae("Twist v4",ve,pe,t=>v.device&&Te(t,v.device)||ye(t))}function Ae(t,n,u,e){let o=document.createElement("canvas");o.className="twist-canvas";const i=document.createElement("div");i.className="twist-frame",i.append(o);let a=e(o);if(!a)return;let w=v.device,A=O(),_=[n,u];const p=(r,g)=>{_=[r,g];const L=window.devicePixelRatio||1,U=G>1?Math.max(1,Math.round(G*L))/L:0,Y=Math.min(U?1/U:L,2,Math.sqrt(fe/Math.max(1,r*g)),Q/Math.max(1,r),Q/Math.max(1,g));o.style.imageRendering=U?"pixelated":"",o.style.width=`${r}px`,o.style.height=`${g}px`,o.width=Math.max(1,Math.round(r*Y)),o.height=Math.max(1,Math.round(g*Y))};p(n,u);const P=()=>p(..._);z.add(P);const R=()=>{a.dispose();const r=document.createElement("canvas");r.className=o.className,r.style.cssText=o.style.cssText,r.width=o.width,r.height=o.height,o.replaceWith(r),o=r,w=v.device,A=O(),a=e(o)??{setLook(){},draw(){},dispose(){}}};let y=!0;const b="IntersectionObserver"in window?new IntersectionObserver(r=>{y=r[r.length-1].isIntersecting}):null;b?.observe(i);let h=!0;const f=performance.now();function x(r){if(!h||(requestAnimationFrame(x),we()||!y))return;(v.device!==w||O()!==A)&&R();const g=(r-f)/1e3;a.setLook(v.wide,v.hdr);const L=me();a.draw(g,o.width,o.height,L)}requestAnimationFrame(x);const d=()=>document.fullscreenElement??document.webkitFullscreenElement,l=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);let c=[n,u],s=null,S=!1;const m=r=>{r!==S&&(S=r,v.onFullScreen?.(r))};let T=null;const D=()=>{const r=i.closest(".window");T=r?{left:parseFloat(r.style.left)||r.offsetLeft,top:parseFloat(r.style.top)||r.offsetTop}:null},E=()=>{const r=i.closest(".window");if(!r)return;T&&(r.dataset.left=T.left,r.dataset.top=T.top,T=null);const g=()=>{!i.isConnected||S||(document.scrollingElement?.scrollTo(0,0),ce(r))};g(),requestAnimationFrame(g),setTimeout(g,250),setTimeout(g,1e3)},C=r=>{r?(s={parent:i.parentNode,next:i.nextSibling},document.body.append(i),i.classList.add("twist-cover"),p(innerWidth,innerHeight),m(!0)):(s.parent.insertBefore(i,s.next),s=null,i.classList.remove("twist-cover"),p(...c),m(!1),E())},k=()=>{if(s){C(!1);return}if(d()===i){(document.exitFullscreen??document.webkitExitFullscreen).call(document);return}if(c=[parseFloat(o.style.width),parseFloat(o.style.height)],D(),d()){C(!0);return}(i.requestFullscreen??i.webkitRequestFullscreen).call(i)?.catch?.(()=>{})},B=()=>{if(s){d()||C(!1);return}d()===i?(p(screen.width,screen.height),m(!0)):(p(...c),m(!1),E())},X=()=>{s&&p(innerWidth,innerHeight)};l&&(document.addEventListener("fullscreenchange",B),document.addEventListener("webkitfullscreenchange",B),addEventListener("resize",X),i.addEventListener("dblclick",k)),ae(t,i,()=>{h=!1,z.delete(P),document.removeEventListener("fullscreenchange",B),document.removeEventListener("webkitfullscreenchange",B),removeEventListener("resize",X),b?.disconnect(),s&&i.remove(),m(!1),d()===i&&(document.exitFullscreen??document.webkitExitFullscreen).call(document),a.dispose()},p,l?k:null)}function ye(t){const n=t.shared,u=W()>1,e=n?n.gl:t.getContext("webgl2",{antialias:u});if(!e)return null;const o=re(e,ge,Se),i=re(e,he,Ee),a=(d,l)=>e.getUniformLocation(d,l),w=a(o,"uTime"),A=a(o,"uAspect"),_=a(o,"uShift"),p=a(o,"uDelay"),P=a(o,"uColorTurn"),R=a(i,"uHeight"),y=a(o,"uWide"),b=a(i,"uWide");let h=0;const f=e.createVertexArray(),x=e.createBuffer();return e.bindVertexArray(f),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,x),e.bufferData(e.ELEMENT_ARRAY_BUFFER,te(),e.STATIC_DRAW),e.bindVertexArray(null),{setLook(d){const l=d?"display-p3":"srgb";!n&&"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==l&&(e.drawingBufferColorSpace=l),h=d&&"drawingBufferColorSpace"in e&&Z()?1:0},draw(d,l,c){n?n.begin(l,c,u):(t.width!==l||t.height!==c)&&(t.width=l,t.height=c),e.viewport(0,0,l,c),e.bindVertexArray(f),e.frontFace(e.CW),e.disable(e.DEPTH_TEST),e.useProgram(i),e.uniform1f(R,c),e.uniform1f(b,h),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.enable(e.CULL_FACE),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(o),e.uniform1f(y,h);const s=l/c;e.uniform1f(w,j(d)),e.uniform1f(A,s);const S=Math.min(ie,Math.max(1,Math.floor(s/oe)));for(let m=0;m<S;m++)e.uniform1f(_,(m+.5)/S*2-1),e.uniform1f(p,m*ne),e.uniform1i(P,m%4),e.drawElements(e.TRIANGLES,q,e.UNSIGNED_INT,0);e.disable(e.CULL_FACE),e.frontFace(e.CCW),n&&n.end()},dispose(){if(!n){e.getExtension("WEBGL_lose_context")?.loseContext();return}for(const d of[o,i])e.deleteProgram(d);e.deleteVertexArray(f),e.deleteBuffer(x)}}}function re(t,n,u){const e=t.createProgram();for(const[o,i]of[[t.VERTEX_SHADER,n],[t.FRAGMENT_SHADER,u]]){const a=t.createShader(o);if(t.shaderSource(a,ee(i)),t.compileShader(a),!t.getShaderParameter(a,t.COMPILE_STATUS))throw new Error(`Shader compile error:
`+t.getShaderInfoLog(a));t.attachShader(e,a)}if(t.linkProgram(e),!t.getProgramParameter(e,t.LINK_STATUS))throw new Error(`Shader link error:
`+t.getProgramInfoLog(e));return e}const $="rgba16float",ie=16,xe=`
struct Look { time: f32, aspect: f32, count: f32, glow: f32, height: f32, hdrRange: f32, wide: f32, linear: f32 }
fn shown(c: vec3f) -> vec3f { return select(toScreen(c), c, look.linear > 0.5); }
@group(0) @binding(0) var<uniform> look: Look;
const PI = 3.14159265359;
const SLICES = ${I}u;
const HALF_HEIGHT = 1.45;
const RADIUS = 0.46;
${N(J)}
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
let t = look.time - f32(twist) * ${ne};
let side = v / ${F}u;
let along = v - side * ${F}u;
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
${N(H)}
fn toCanvas(l: vec3f) -> vec3f {
const SRGB_TO_P3 = mat3x3f(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
return select(l, SRGB_TO_P3 * l, look.wide > 0.5);
}
${N(K).trim()}
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
`;function Te(t,n){const u=t.getContext("webgpu");if(!u)return null;const e=n.createShaderModule({code:ee(xe)}),o=n.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),i=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}}]}),a=n.createBindGroup({layout:i,entries:[{binding:0,resource:{buffer:o}}]}),w=n.createPipelineLayout({bindGroupLayouts:[i]}),A=W(),_=(l,c,s,S,m={})=>n.createRenderPipeline({layout:w,vertex:{module:e,entryPoint:l},fragment:{module:e,entryPoint:c,targets:[{format:$}]},depthStencil:{format:"depth24plus",depthCompare:s,depthWriteEnabled:S},multisample:{count:A},primitive:m}),p=_("backdropVs","backdropFs","always",!1),P=_("barVs","barFs","less",!0,{cullMode:"back",frontFace:"cw"}),R=te(),y=n.createBuffer({size:R.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});n.queue.writeBuffer(y,0,R);const b=new Float32Array(8);let h=null,f=null,x=0;const d=(l,c)=>{const s=`${l} ${c}`;s!==h&&(h=s,u.configure({device:n,format:$,alphaMode:"opaque",colorSpace:l?"display-p3":"srgb",toneMapping:{mode:c?"extended":"standard"}}))};return{setLook(l,c){d(l,c),x=l&&Z()?c&&le()?2:1:0},draw(l,c,s,S){if(h||d(!0,!1),(t.width!==c||t.height!==s)&&(t.width=c,t.height=s),!f||f.width!==c||f.height!==s){f?.color?.destroy(),f?.depth.destroy();const C=k=>n.createTexture({size:[c,s],format:k,sampleCount:A,usage:GPUTextureUsage.RENDER_ATTACHMENT});f={width:c,height:s,color:A>1?C($):null,depth:C("depth24plus")},f.colorView=f.color?.createView(),f.depthView=f.depth.createView()}const m=c/s,T=Math.min(ie,Math.max(1,Math.floor(m/oe)));b.set([j(l),m,T,S,s,S>0?se:1,x,t.linear?1:0]),n.queue.writeBuffer(o,0,b);const D=n.createCommandEncoder(),E=D.beginRenderPass({colorAttachments:[de(f.colorView,u.getCurrentTexture().createView())],depthStencilAttachment:{view:f.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"},timestampWrites:this.timestampWrites});E.setBindGroup(0,a),E.setPipeline(p),E.draw(3),E.setPipeline(P),E.setIndexBuffer(y,"uint32"),E.drawIndexed(q,T),E.end(),n.queue.submit([D.finish()])},dispose(){f?.color?.destroy(),f?.depth.destroy(),o.destroy(),y.destroy(),u.unconfigure()}}}export{V as EFFECT_PERIOD,$ as GPU_FORMAT,de as colorTarget,ye as createDrawer,Te as createGpuDrawer,re as createProgram,me as effectGlow,O as effectLook,j as effectTime,Ae as openEffectWindow,Ie as openTwistWindow,W as samples,Le as setEffectPixelSize,ee as sharpen,v as twistOptions};
