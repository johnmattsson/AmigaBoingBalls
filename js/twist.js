import{showWindow as M}from"./gui.js?v=2.04-119";import{createHdrPresenter as W,HDR_RANGE as O}from"./hdr.js?v=2.04-119";const v={hdr:!1,glow:!0,strength:1,wide:!0,onFullScreen:null},q=2.5,x=240,U=4*x*6,k=340,N=440,V=.5,$=.4,K=`
vec3 pack(vec3 light, float range) {
vec3 color = toScreen(min(light, 1.0));
if (range <= 0.0) return color;
vec3 above = clamp((light - 1.0) / (range - 1.0), 0.0, 1.0);
return mix(color * 0.8, 0.8 + 0.2 * above, vec3(greaterThan(light, vec3(1.0))));
}
`,X=`#version 300 es
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
const float SLICES =${x}.0;
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
int corner = gl_VertexID % 6;
int piece = gl_VertexID / 6;
int slice = piece %${x};
vSide = piece /${x};
bool right = corner == 1 || corner == 2 || corner == 4;
bool top = corner == 2 || corner == 4 || corner == 5;
float y = (float(slice + int(top)) / SLICES) * 2.0 - 1.0;
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
`,Z=`#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vPattern;
flat in int vSide;
out vec4 outColor;
uniform int uColorTurn;
uniform float uGlow;
uniform float uHdrRange;
const vec3 SIDE_COLORS[4] = vec3[4](
vec3(0.769, 0.008, 0.200),
vec3(0.000, 0.624, 0.420),
vec3(0.000, 0.529, 0.741),
vec3(1.000, 0.827, 0.000));
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toScreen(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
${K}
float zigzag(float x) { return 2.0 * abs(fract(x * 0.5) - 0.5); }
float squareWave(float x, float blur) {
blur = max(blur, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
void main() {
vec2 square = vec2(vPattern.x * 2.0, (vPattern.y * 0.5 + 0.5) * 9.0);
vec2 blur = fwidth(square);
float checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
vec3 color = mix(vec3(1.0), SIDE_COLORS[(vSide + uColorTurn) % 4], checker);
vec3 normal = normalize(vNormal);
vec3 toCamera = normalize(vec3(0.0, 0.0, 4.4) - vPosition);
if (dot(normal, toCamera) < 0.0) normal = -normal;
vec3 toLamp = normalize(vec3(-0.5, 0.7, 0.9));
float facing = max(0.0, dot(normal, toLamp));
vec3 halfway = normalize(toLamp + toCamera);
float shine = pow(max(0.0, dot(normal, halfway)), 48.0);
vec3 lit = toLinear(color) * (0.25 + 0.85 * facing) + vec3(0.45 + uGlow) * shine;
outColor = vec4(pack(lit, uHdrRange), 1.0);
}
`,Y=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,j=`#version 300 es
precision highp float;
uniform float uHeight;
uniform float uHdrRange;
out vec4 outColor;
void main() {
float y = (floor(gl_FragCoord.y / uHeight * 256.0) + 0.5) / 256.0;
vec3 color = mix(vec3(0.33, 0.40, 0.60), vec3(0.0, 0.0, 0.2), y);
color = floor(color * 15.0 + 0.5) / 15.0;
outColor = vec4(uHdrRange > 0.0 ? color * 0.8 : color, 1.0);
}
`;let P=!1;function ee(){if(P)return;P=!0;const t=document.createElement("canvas");t.className="twist-canvas";const e=document.createElement("div");e.className="twist-frame",e.append(t);const i=z(t);if(!i){P=!1;return}let r=null,n=null,g=!1,a=!1;const p=()=>{r?.dispose(),n?.dispose(),r=n=null},S=()=>v.wide?"display-p3":"srgb",C=()=>{if(i.setColorSpace(S()),r?.setColorSpace(S()),v.hdr||(a=!1),!(v.hdr===!!r||g||a)){if(!v.hdr){p();return}g=!0,W(t,O,{onLost:()=>{p(),a=!0}}).then(({presenter:o})=>{if(g=!1,!o){a=!0;return}if(!w||!v.hdr){o.dispose();return}if(n=typeof OffscreenCanvas>"u"?null:z(new OffscreenCanvas(1,1)),!n){o.dispose(),a=!0;return}r=o,r.setColorSpace(S())})}},s=(o,E)=>{const R=Math.min(window.devicePixelRatio||1,2);t.style.width=`${o}px`,t.style.height=`${E}px`,t.width=Math.round(o*R),t.height=Math.round(E*R)};s(k,N);let w=!0;const D=performance.now();function A(o){if(!w)return;C();const E=(o-D)/1e3;if(r){const R=v.glow?q*v.strength:0;n.draw(E,t.width,t.height,O,R),r.present(n.surface,t)}else i.draw(E,t.width,t.height,0,0);requestAnimationFrame(A)}requestAnimationFrame(A);const l=()=>document.fullscreenElement??document.webkitFullscreenElement,u=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);let f=[k,N],c=null,y=!1;const d=o=>{o!==y&&(y=o,v.onFullScreen?.(o))};let h=null,m=0;const _=()=>e.closest(".window"),B=()=>{const o=_();h=o?{left:o.style.left,top:o.style.top}:null},b=()=>{const o=_();!o||!h||(o.style.left=h.left,o.style.top=h.top)},I=()=>{b(),m=performance.now()+1500},H=o=>{o?(c={parent:e.parentNode,next:e.nextSibling},document.body.append(e),e.classList.add("twist-cover"),s(innerWidth,innerHeight),d(!0)):(c.parent.insertBefore(e,c.next),c=null,e.classList.remove("twist-cover"),s(...f),I(),d(!1))},L=()=>{if(c){H(!1);return}if(l()===e){(document.exitFullscreen??document.webkitExitFullscreen).call(document);return}if(f=[parseFloat(t.style.width),parseFloat(t.style.height)],B(),l()){H(!0);return}(e.requestFullscreen??e.webkitRequestFullscreen).call(e)?.catch?.(()=>{})},T=()=>{if(c){l()||H(!1);return}l()===e?(s(screen.width,screen.height),d(!0)):(s(...f),I(),d(!1))},F=()=>{c?s(innerWidth,innerHeight):performance.now()<m&&b()};u&&(document.addEventListener("fullscreenchange",T),document.addEventListener("webkitfullscreenchange",T),addEventListener("resize",F),t.addEventListener("dblclick",L)),M("Twist v4",e,()=>{P=!1,w=!1,document.removeEventListener("fullscreenchange",T),document.removeEventListener("webkitfullscreenchange",T),removeEventListener("resize",F),c&&e.remove(),d(!1),l()===e&&(document.exitFullscreen??document.webkitExitFullscreen).call(document),p(),i.dispose()},s,u?L:null)}function z(t){const e=t.getContext("webgl2",{antialias:!0});if(!e)return null;const i=G(e,X,Z),r=G(e,Y,j),n=(l,u)=>e.getUniformLocation(l,u),g=n(i,"uTime"),a=n(i,"uAspect"),p=n(i,"uShift"),S=n(i,"uDelay"),C=n(i,"uColorTurn"),s=n(i,"uGlow"),w=n(i,"uHdrRange"),D=n(r,"uHeight"),A=n(r,"uHdrRange");return e.bindVertexArray(e.createVertexArray()),{surface:t,setColorSpace(l){"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==l&&(e.drawingBufferColorSpace=l)},draw(l,u,f,c,y){(t.width!==u||t.height!==f)&&(t.width=u,t.height=f),e.viewport(0,0,u,f),e.disable(e.DEPTH_TEST),e.useProgram(r),e.uniform1f(D,f),e.uniform1f(A,c),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(i);const d=u/f;e.uniform1f(g,l),e.uniform1f(a,d),e.uniform1f(s,y),e.uniform1f(w,c);const h=Math.max(1,Math.floor(d/V));for(let m=0;m<h;m++)e.uniform1f(p,(m+.5)/h*2-1),e.uniform1f(S,m*$),e.uniform1i(C,m%4),e.drawArrays(e.TRIANGLES,0,U)},dispose(){e.getExtension("WEBGL_lose_context")?.loseContext()}}}function G(t,e,i){const r=t.createProgram();for(const[n,g]of[[t.VERTEX_SHADER,e],[t.FRAGMENT_SHADER,i]]){const a=t.createShader(n);if(t.shaderSource(a,g),t.compileShader(a),!t.getShaderParameter(a,t.COMPILE_STATUS))throw new Error(`Shader compile error:
`+t.getShaderInfoLog(a));t.attachShader(r,a)}if(t.linkProgram(r),!t.getProgramParameter(r,t.LINK_STATUS))throw new Error(`Shader link error:
`+t.getProgramInfoLog(r));return r}export{z as createDrawer,ee as openTwistWindow,v as twistOptions};
