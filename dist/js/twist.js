import{showWindow as H}from"./gui.js";import{createHdrPresenter as I,HDR_RANGE as x}from"./hdr.js";const m={hdr:!1,glow:!0,strength:1,wide:!0},b=2.5,A=240,L=4*A*6,C=340,D=440,F=.5,O=.4,k=`
vec3 pack(vec3 light, float range) {
vec3 color = toScreen(min(light, 1.0));
if (range <= 0.0) return color;
vec3 above = clamp((light - 1.0) / (range - 1.0), 0.0, 1.0);
return mix(color * 0.8, 0.8 + 0.2 * above, vec3(greaterThan(light, vec3(1.0))));
}
`,G=`#version 300 es
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
const float SLICES =${A}.0;
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
int slice = piece %${A};
vSide = piece /${A};
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
`,N=`#version 300 es
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
${k}
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
`,z=`#version 300 es
void main() {
vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`,B=`#version 300 es
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
`;let y=!1;function U(){if(y)return;y=!0;const t=document.createElement("canvas");t.className="twist-canvas";const e=document.createElement("div");e.className="twist-frame",e.append(t);const n=P(t);if(!n){y=!1;return}let o=null,r=null,d=!1,i=!1;const h=()=>{o?.dispose(),r?.dispose(),o=r=null},S=()=>m.wide?"display-p3":"srgb",T=()=>{if(n.setColorSpace(S()),o?.setColorSpace(S()),m.hdr||(i=!1),!(m.hdr===!!o||d||i)){if(!m.hdr){h();return}d=!0,I(t,x,{onLost:()=>{h(),i=!0}}).then(({presenter:a})=>{if(d=!1,!a){i=!0;return}if(!p||!m.hdr){a.dispose();return}if(r=typeof OffscreenCanvas>"u"?null:P(new OffscreenCanvas(1,1)),!r){a.dispose(),i=!0;return}o=a,o.setColorSpace(S())})}},v=(a,f)=>{const l=Math.min(window.devicePixelRatio||1,2);t.style.width=`${a}px`,t.style.height=`${f}px`,t.width=Math.round(a*l),t.height=Math.round(f*l)};v(C,D);let p=!0;const R=performance.now();function w(a){if(!p)return;T();const f=(a-R)/1e3;if(o){const l=m.glow?b*m.strength:0;r.draw(f,t.width,t.height,x,l),o.present(r.surface,t)}else n.draw(f,t.width,t.height,0,0);requestAnimationFrame(w)}requestAnimationFrame(w);const c=()=>document.fullscreenElement??document.webkitFullscreenElement,s=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);let u=[C,D];const E=()=>{if(c()===e){(document.exitFullscreen??document.webkitExitFullscreen).call(document);return}u=[parseFloat(t.style.width),parseFloat(t.style.height)],(e.requestFullscreen??e.webkitRequestFullscreen).call(e)?.catch?.(()=>{})},g=()=>{c()===e?v(screen.width,screen.height):v(...u)};s&&(document.addEventListener("fullscreenchange",g),document.addEventListener("webkitfullscreenchange",g),t.addEventListener("dblclick",E)),H("Twist v4",e,()=>{y=!1,p=!1,document.removeEventListener("fullscreenchange",g),document.removeEventListener("webkitfullscreenchange",g),c()===e&&(document.exitFullscreen??document.webkitExitFullscreen).call(document),h(),n.dispose()},v,s?E:null)}function P(t){const e=t.getContext("webgl2",{antialias:!0});if(!e)return null;const n=_(e,G,N),o=_(e,z,B),r=(c,s)=>e.getUniformLocation(c,s),d=r(n,"uTime"),i=r(n,"uAspect"),h=r(n,"uShift"),S=r(n,"uDelay"),T=r(n,"uColorTurn"),v=r(n,"uGlow"),p=r(n,"uHdrRange"),R=r(o,"uHeight"),w=r(o,"uHdrRange");return e.bindVertexArray(e.createVertexArray()),{surface:t,setColorSpace(c){"drawingBufferColorSpace"in e&&e.drawingBufferColorSpace!==c&&(e.drawingBufferColorSpace=c)},draw(c,s,u,E,g){(t.width!==s||t.height!==u)&&(t.width=s,t.height=u),e.viewport(0,0,s,u),e.disable(e.DEPTH_TEST),e.useProgram(o),e.uniform1f(R,u),e.uniform1f(w,E),e.drawArrays(e.TRIANGLES,0,3),e.enable(e.DEPTH_TEST),e.clear(e.DEPTH_BUFFER_BIT),e.useProgram(n);const a=s/u;e.uniform1f(d,c),e.uniform1f(i,a),e.uniform1f(v,g),e.uniform1f(p,E);const f=Math.max(1,Math.floor(a/F));for(let l=0;l<f;l++)e.uniform1f(h,(l+.5)/f*2-1),e.uniform1f(S,l*O),e.uniform1i(T,l%4),e.drawArrays(e.TRIANGLES,0,L)},dispose(){e.getExtension("WEBGL_lose_context")?.loseContext()}}}function _(t,e,n){const o=t.createProgram();for(const[r,d]of[[t.VERTEX_SHADER,e],[t.FRAGMENT_SHADER,n]]){const i=t.createShader(r);if(t.shaderSource(i,d),t.compileShader(i),!t.getShaderParameter(i,t.COMPILE_STATUS))throw new Error(`Shader compile error:
`+t.getShaderInfoLog(i));t.attachShader(o,i)}if(t.linkProgram(o),!t.getProgramParameter(o,t.LINK_STATUS))throw new Error(`Shader link error:
`+t.getProgramInfoLog(o));return o}export{P as createDrawer,U as openTwistWindow,m as twistOptions};
