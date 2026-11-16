import{HDR_RANGE as z}from"./hdr.js?v=2.04-119";import{BOX_HALF_SIZE as V}from"./physics.js?v=2.04-119";import{SceneRenderer as U,BACKGROUND as F,GRID_COLOR as O,GRID_OPACITY as _,GRID_SHADE as W,SHADOW_STRENGTH as I,BALL_TABLE_COLUMNS as L,TRAIL_PIECE_NUMBERS as D,srgbToLinear as q}from"./renderer.js?v=2.04-119";import{MAX_BALLS as k,SHADOW_GRID as v,SHADOW_LIST_WIDTH as y}from"./shaders.js?v=2.04-119";const S="rgba16float",E="depth24plus",T="depth32float",G=68,b=256;class A extends U{static async create(a,{onLost:r}={}){if(!navigator.gpu)return{error:"this browser has no WebGPU"};let i;try{const e=await navigator.gpu.requestAdapter();if(!e)return{error:"WebGPU found no graphics card"};i=await e.requestDevice();const s=document.createElement("canvas");s.className="scene-hdr",Object.assign(s.style,{position:"absolute",top:"0",left:"0",width:"100%",height:"100%",pointerEvents:"none"});const o=new A(a,s,i);await o.makePipelines(),o.configure();const f=o.context.getConfiguration?.()?.toneMapping?.mode;return f!==void 0&&f!=="extended"?(i.destroy(),{error:"this browser can't show HDR in a canvas (try Chrome 129 or later)"}):(a.before(s),i.lost.then(l=>{o.disposed||r?.(l.message)}),{renderer:o})}catch(e){return i?.destroy(),{error:e.message}}}constructor(a,r,i){super(a),this.canvas=r,this.device=i,this.context=r.getContext("webgpu"),this.floatTarget=!0,this.disposed=!1,this.shownOnce=!1,this.colorSpace=null,this.hdr={get screenIsHdr(){return matchMedia("(dynamic-range: high)").matches}};const e=(s,o)=>i.createBuffer({size:s,usage:o|GPUBufferUsage.COPY_DST});this.frameData=new Float32Array(G),this.frameWords=new Uint32Array(this.frameData.buffer),this.frameBuffer=e(G*4,GPUBufferUsage.UNIFORM),this.wallData=new Float32Array(6*b/4),this.wallBuffer=e(6*b,GPUBufferUsage.UNIFORM),this.ballBuffer=e(k*L*16,GPUBufferUsage.STORAGE),this.cellBuffer=e(v*v*4,GPUBufferUsage.STORAGE),this.listBuffer=null,this.trailBuffer=null,this.trailRoomGrown(),this.layouts=Y(i),this.makeShadowListRoom(64*y),this.wallGroup=i.createBindGroup({layout:this.layouts.wall,entries:[{binding:0,resource:{buffer:this.wallBuffer,size:80}}]}),this.textVersion=null,this.textTexture=null,this.makeTextTexture(1,1),this.sampler=i.createSampler({magFilter:"linear",minFilter:"linear"}),this.target=null}async makePipelines(){const a=this.device,r=this.layouts,i=a.createShaderModule({code:H}),e={color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"}},s=(f,l,p,{blended:h=!0,depthWrite:n=!1,depthTest:x=!0,color:d=!0,depthFormat:m=E,strip:u=!0,buffers:g=[]}={})=>a.createRenderPipelineAsync({layout:f,vertex:{module:i,entryPoint:l,buffers:g},fragment:{module:i,entryPoint:p,targets:d?[{format:S,blend:h?e:void 0}]:[]},primitive:{topology:u?"triangle-strip":"triangle-list"},depthStencil:m?{format:m,depthWriteEnabled:n,depthCompare:x?"less":"always"}:void 0}),o=[{arrayStride:D*4,stepMode:"instance",attributes:[{shaderLocation:1,offset:0,format:"float32x3"},{shaderLocation:2,offset:12,format:"float32x3"},{shaderLocation:3,offset:24,format:"float32x3"},{shaderLocation:4,offset:36,format:"float32x2"}]}];[this.ballDepthPipeline,this.copperPipeline,this.floorPipeline,this.wallPipeline,this.ballPipeline,this.trailPipeline,this.presentPipeline]=await Promise.all([s(r.front,"ballVs","ballDepthFs",{color:!1,depthWrite:!0,depthFormat:T}),s(r.scene,"fullVs","copperFs",{blended:!1,depthTest:!1,strip:!1}),s(r.scene,"floorVs","floorFs"),s(r.scene,"wallVs","wallFs"),s(r.scene,"ballVs","ballFs",{depthWrite:!0}),s(r.scene,"trailVs","trailFs",{buffers:o}),s(r.present,"fullVs","presentFs",{blended:!1,depthFormat:null,strip:!1})])}configure(){const a=this.wideColor?"display-p3":"srgb";a===this.colorSpace||this.disposed||(this.colorSpace=a,this.context.configure({device:this.device,format:S,colorSpace:a,toneMapping:{mode:"extended"},alphaMode:"opaque"}))}applyColorSpace(){this.configure()}async whenReady(){}waitUntilDone(){}resize(){const{width:a,height:r}=this.measure();this.canvas.style.imageRendering=this.view.style.imageRendering,!(this.target&&this.canvas.width===a&&this.canvas.height===r)&&(this.canvas.width=a,this.canvas.height=r,this.target?.dispose(),this.target=M(this.device,a,r),this.frontGroup=this.device.createBindGroup({layout:this.layouts.frontDepth,entries:[{binding:0,resource:this.target.frontDepthView}]}),this.makePresentGroup())}makePresentGroup(){this.target&&(this.presentGroup=this.device.createBindGroup({layout:this.layouts.presentInputs,entries:[{binding:1,resource:this.target.sceneView},{binding:2,resource:this.textTexture.createView()},{binding:3,resource:this.sampler}]}))}makeTextTexture(a,r){this.textTexture?.destroy(),this.textTexture=this.device.createTexture({size:[a,r],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.makePresentGroup()}dispose(){this.disposed||(this.disposed=!0,this.canvas.remove(),this.view.style.opacity="",this.device.destroy())}draw(a,r,i={}){if(this.disposed)return;this.target||this.resize();const e=this.prepare(a,r,i),{count:s,eye:o}=e,f=this.device,l=f.queue,{width:p,height:h}=this.target,n=this.frameData;N(a.viewProjection,n),n.set([o.x,o.y,o.z],16),this.frameWords[19]=s,n.set([e.light.x,e.light.y,e.light.z,e.shadowRange],20),n.set([e.forward.x,e.forward.y,e.forward.z,I],24),n.set([e.side.x,e.side.y,e.side.z,e.edgeWidth],28),n.set([e.up.x,e.up.y,e.up.z,e.shadowOpacity],32),n.set([...e.shadowColor,e.glint],36),n.set([e.floorY,e.floorHalfSize,V,e.lineWidth],40),n.set(e.wallShown,44),n.set([...i.copper?O:W,i.copper?_:1],48),n.set([p,h,e.trailWidth,i.backdropTime??0],52),n.set([h,e.shine,e.colorLevels,e.textGlow],56);const x=this.textRect(i.text,p,h);n.set(x??[0,0,0,0],60),n.set([z,0,0,0],64),l.writeBuffer(this.frameBuffer,0,n);const d=this.wallData;e.walls.forEach(({wall:t,extend:P,drawEdge:B,catchesShadows:C},R)=>{const w=R*b/4;d.set(P,w),d.set(B,w+4),d.set([t.center.x,t.center.y,t.center.z,C?1:0],w+8),d.set([t.axisU.x,t.axisU.y,t.axisU.z,0],w+12),d.set([t.axisV.x,t.axisV.y,t.axisV.z,0],w+16)}),l.writeBuffer(this.wallBuffer,0,d),s>0&&l.writeBuffer(this.ballBuffer,0,this.ballTable,0,s*L*4),l.writeBuffer(this.cellBuffer,0,this.shadowCells);const m=Math.ceil(e.listed/y);m>0&&l.writeBuffer(this.listBuffer,0,this.shadowList,0,m*y);let u=0;if(i.trailSeconds>0&&(u=this.fillTrails(r,s,i.trailTime??0,i.trailSeconds),u>0&&l.writeBuffer(this.trailBuffer,0,this.trailPieces,0,u*D)),x){const t=i.text;i.textVersion!==this.textVersion&&(this.textVersion=i.textVersion,(this.textTexture.width!==t.width||this.textTexture.height!==t.height)&&this.makeTextTexture(t.width,t.height),l.copyExternalImageToTexture({source:t},{texture:this.textTexture},[t.width,t.height]))}else this.textVersion=null;const g=f.createCommandEncoder();{const t=g.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.target.frontDepthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});s>0&&(t.setPipeline(this.ballDepthPipeline),t.setBindGroup(0,this.sharedGroup),t.draw(4,s)),t.end()}{const t=g.beginRenderPass({colorAttachments:[{view:this.target.sceneView,loadOp:"clear",storeOp:"store",clearValue:[...F.map(q),1]}],depthStencilAttachment:{view:this.target.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});t.setBindGroup(0,this.sharedGroup),t.setBindGroup(1,this.frontGroup),t.setBindGroup(2,this.wallGroup,[0]),i.copper&&(t.setPipeline(this.copperPipeline),t.draw(3)),e.showShadows&&o.y>e.floorY&&(t.setPipeline(this.floorPipeline),t.draw(4)),e.showGrid&&(t.setPipeline(this.wallPipeline),e.walls.forEach((P,B)=>{P.shown&&(t.setBindGroup(2,this.wallGroup,[B*b]),t.draw(4))})),s>0&&(t.setPipeline(this.ballPipeline),t.draw(4,s)),u>0&&(t.setPipeline(this.trailPipeline),t.setVertexBuffer(0,this.trailBuffer),t.draw(4,u)),t.end()}{const t=g.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});t.setPipeline(this.presentPipeline),t.setBindGroup(0,this.sharedGroup),t.setBindGroup(1,this.presentGroup),t.draw(3),t.end()}l.submit([g.finish()]),this.shownOnce||(this.shownOnce=!0,this.view.style.opacity="0")}trailRoomGrown(){this.trailBuffer?.destroy(),this.trailBuffer=this.device.createBuffer({size:this.trailPieces.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST})}shadowListGrown(a){this.listBuffer?.destroy(),this.listBuffer=this.device.createBuffer({size:a*y*2,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.layouts&&(this.sharedGroup=this.device.createBindGroup({layout:this.layouts.shared,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.ballBuffer}},{binding:2,resource:{buffer:this.cellBuffer}},{binding:3,resource:{buffer:this.listBuffer}}]}))}}function N(c,a){a.set(c,0);for(let r=0;r<4;r++)a[r*4+2]=.5*c[r*4+2]+.5*c[r*4+3]}function M(c,a,r){const i=(p,h)=>c.createTexture({size:[a,r],format:p,usage:h}),e=GPUTextureUsage.RENDER_ATTACHMENT,s=GPUTextureUsage.TEXTURE_BINDING,o=i(S,e|s),f=i(E,e),l=i(T,e|s);return{width:a,height:r,sceneView:o.createView(),depthView:f.createView(),frontDepthView:l.createView(),dispose(){o.destroy(),f.destroy(),l.destroy()}}}function Y(c){const a=GPUShaderStage.VERTEX,r=GPUShaderStage.FRAGMENT,i=c.createBindGroupLayout({entries:[{binding:0,visibility:a|r,buffer:{type:"uniform"}},{binding:1,visibility:a|r,buffer:{type:"read-only-storage"}},{binding:2,visibility:r,buffer:{type:"read-only-storage"}},{binding:3,visibility:r,buffer:{type:"read-only-storage"}}]}),e=c.createBindGroupLayout({entries:[{binding:0,visibility:r,texture:{sampleType:"depth"}}]}),s=c.createBindGroupLayout({entries:[{binding:0,visibility:a|r,buffer:{type:"uniform",hasDynamicOffset:!0}}]}),o=c.createBindGroupLayout({entries:[{binding:1,visibility:r,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:r,texture:{sampleType:"float"}},{binding:3,visibility:r,sampler:{type:"filtering"}}]}),f=l=>c.createPipelineLayout({bindGroupLayouts:l});return{shared:i,frontDepth:e,wall:s,presentInputs:o,front:f([i]),scene:f([i,e,s]),present:f([i,o])}}const H=`
struct Frame {
viewProjection: mat4x4f,
cameraPosition: vec3f, ballCount: u32,
lightPosition: vec3f, shadowRange: f32,
lightForward: vec3f, shadowStrength: f32,
lightSide: vec3f, edgeWidth: f32,
lightUp: vec3f, shadowOpacity: f32,
shadowColor: vec3f, glint: f32,
floorY: f32, floorHalfSize: f32, halfSize: f32, lineWidth: f32,
wallShown: vec4f,
gridColor: vec3f, lineOpacity: f32,
viewport: vec2f, trailWidth: f32, time: f32,
height: f32, shine: f32, colorLevels: f32, textGlow: f32,
textRect: vec4f,
hdrRange: f32,
}
struct Wall {
extend: vec4f,
drawEdge: vec4f,
center: vec3f, catchShadows: f32,
axisU: vec3f,
axisV: vec3f,
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
@group(0) @binding(2) var<storage, read> shadowCells: array<u32>;
@group(0) @binding(3) var<storage, read> shadowList: array<u32>;
@group(1) @binding(0) var frontDepth: texture_depth_2d;
@group(1) @binding(1) var scene: texture_2d<f32>;
@group(1) @binding(2) var textPicture: texture_2d<f32>;
@group(1) @binding(3) var textSampler: sampler;
@group(2) @binding(0) var<uniform> wall: Wall;
const PI = 3.14159265359;
fn ballSphere(i: i32) -> vec4f { return ballData[i * 6]; }
fn ballColor(i: i32) -> vec4f { return ballData[i * 6 + 1]; }
fn ballRotation(i: i32) -> mat3x3f {
return mat3x3f(ballData[i * 6 + 2].xyz, ballData[i * 6 + 3].xyz, ballData[i * 6 + 4].xyz);
}
fn ballDrawnAs(k: i32) -> i32 { return i32(ballData[k * 6 + 5].x); }
fn squareCorner(v: u32) -> vec2f { return vec2f(f32(v >> 1u), f32(v & 1u)) * 2.0 - 1.0; }
@vertex fn fullVs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
let corner = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}
fn toLinear(c: vec3f) -> vec3f {
return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c < vec3f(0.04045));
}
fn toScreen(c: vec3f) -> vec3f {
return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308));
}
fn shade(color: vec3f, shadow: f32) -> vec3f {
return mix(toLinear(color), toLinear(color * (1.0 - frame.shadowStrength)), shadow);
}
fn smoothEdge(pixelsInside: f32) -> f32 {
return clamp(pixelsInside / frame.edgeWidth + 0.5, 0.0, 1.0);
}
fn hiddenBehindBall(at: vec4f, depth: f32) -> bool {
let front = textureLoad(frontDepth, vec2i(at.xy), 0);
return depth > front + 1e-5;
}
fn shadowAt(p: vec3f, stepX: vec3f, stepY: vec3f, skipBall: i32) -> f32 {
let pixelReach = (length(stepX) + length(stepY)) * frame.edgeWidth;
let toLight = frame.lightPosition - p;
let lightDist = length(toLight);
let lightDir = toLight / lightDist;
let ahead = -dot(toLight, frame.lightForward);
if (ahead <= 0.0) { return 0.0; }
let seen = -vec2f(dot(toLight, frame.lightSide), dot(toLight, frame.lightUp)) / ahead;
let cell = clamp(vec2i(floor((seen / (2.0 * frame.shadowRange) + 0.5) *${v}.0)),
vec2i(0), vec2i(${v}- 1));
var shadow = 0.0;
let cellEntry = shadowCells[cell.y *${v}+ cell.x];
let first = cellEntry >> 12u;
let listed = cellEntry & 4095u;
for (var k = 0u; k < listed; k++) {
let entry = first + k;
let i = i32((shadowList[entry >> 1u] >> ((entry & 1u) * 16u)) & 65535u);
if (i == skipBall) { continue; }
let toBall = ballSphere(i).xyz - p;
let radius = ballSphere(i).w;
let along = dot(toBall, lightDir);
if (along <= 0.0 || along >= lightDist) { continue; }
let miss = toBall - lightDir * along;
let missSq = dot(miss, miss);
if (missSq > (radius + pixelReach) * (radius + pixelReach)) { continue; }
let missDist = sqrt(missSq);
let away = miss / max(missDist, 1e-6);
let perPixel = abs(dot(away, stepX)) + abs(dot(away, stepY));
shadow = max(shadow, smoothEdge((radius - missDist) / max(perPixel, 1e-6)));
if (shadow >= 1.0) { break; }
}
return shadow;
}
struct Surface { @builtin(position) at: vec4f, @location(0) world: vec3f }
@vertex fn floorVs(@builtin(vertex_index) v: u32) -> Surface {
let corner = squareCorner(v);
var o: Surface;
o.world = vec3f(corner.x * frame.floorHalfSize, frame.floorY, corner.y * frame.floorHalfSize);
o.at = frame.viewProjection * vec4f(o.world, 1.0);
return o;
}
@fragment fn floorFs(s: Surface) -> @location(0) vec4f {
let stepX = dpdxFine(s.world);
let stepY = dpdyFine(s.world);
if (hiddenBehindBall(s.at, s.at.z)) { discard; }
let h = frame.halfSize;
let shown = frame.wallShown;
if ((s.world.x < -h && shown.x > 0.5) || (s.world.x > h && shown.y > 0.5) ||
(s.world.z < -h && shown.z > 0.5) || (s.world.z > h && shown.w > 0.5)) { discard; }
let shadow = shadowAt(s.world, stepX, stepY, -1);
if (shadow <= 0.0) { discard; }
return vec4f(frame.shadowColor, shadow * frame.shadowOpacity);
}
struct WallPoint { @builtin(position) at: vec4f, @location(0) grid: vec2f, @location(1) world: vec3f }
const MARGIN = 0.25;
@vertex fn wallVs(@builtin(vertex_index) v: u32) -> WallPoint {
let corner = squareCorner(v);
let high = frame.halfSize + MARGIN + wall.extend.xz;
let low = frame.halfSize + MARGIN + wall.extend.yw;
var o: WallPoint;
o.grid = mix(-low, high, corner * 0.5 + 0.5);
o.world = wall.center + wall.axisU * o.grid.x + wall.axisV * o.grid.y;
o.at = frame.viewProjection * vec4f(o.world, 1.0);
return o;
}
fn lineCoverage(pixelsAway: f32) -> f32 { return smoothEdge(0.5 * frame.lineWidth - pixelsAway); }
const EDGE_UNITS = 0.05;
@fragment fn wallFs(s: WallPoint) -> @location(0) vec4f {
let h = frame.halfSize;
let unitsPerPixel = fwidthFine(s.grid);
let nearestLine = floor(s.grid + 0.5);
let toLine = abs((s.grid - nearestLine) / unitsPerPixel + 0.03);
let pastEdge = (abs(s.grid) - h) / min(unitsPerPixel, vec2f(EDGE_UNITS));
let packedLines = frame.lineWidth * unitsPerPixel;
let fade = 1.0 - smoothstep(vec2f(0.25), vec2f(0.6), packedLines);
let inner = select(vec2f(1.0), vec2f(0.0), abs(nearestLine) >= vec2f(h));
let ends = vec2f(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
let innerAlongY = lineCoverage(toLine.x) * inner.x * fade.x * ends.x;
let innerAlongX = lineCoverage(toLine.y) * inner.y * fade.y * ends.y;
let toEdge = abs(abs(s.grid) - h) / unitsPerPixel;
let drawsEdge = vec2f(select(wall.drawEdge.y, wall.drawEdge.x, s.grid.x > 0.0),
select(wall.drawEdge.w, wall.drawEdge.z, s.grid.y > 0.0));
let edgeAlongY = lineCoverage(toEdge.x) * drawsEdge.x * lineCoverage(pastEdge.x) * ends.x;
let edgeAlongX = lineCoverage(toEdge.y) * drawsEdge.y * lineCoverage(pastEdge.y) * ends.y;
let coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
let e = wall.extend;
let pastCatch = vec4f(s.grid.x - h - e.x, -s.grid.x - h - e.y,
s.grid.y - h - e.z, -s.grid.y - h - e.w) / unitsPerPixel.xxyy;
let inside = select(vec4f(0.0), vec4f(1.0), pastCatch <= vec4f(0.1));
let onWall = wall.catchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));
let stepX = dpdxFine(s.world);
let stepY = dpdyFine(s.world);
if ((coverage <= 0.0 && onWall <= 0.0) || hiddenBehindBall(s.at, s.at.z)) { discard; }
let shadow = shadowAt(s.world, stepX, stepY, -1);
let lineLayer = coverage * frame.lineOpacity;
let shadowLayer = onWall * shadow * frame.shadowOpacity * (1.0 - lineLayer);
let opacity = lineLayer + shadowLayer;
if (opacity <= 0.0) { discard; }
let color = (shade(frame.gridColor, shadow) * lineLayer + frame.shadowColor * shadowLayer) / opacity;
return vec4f(color, opacity);
}
struct BallPoint {
@builtin(position) at: vec4f,
@location(0) world: vec3f,
@location(1) @interpolate(flat) ball: i32,
}
@vertex fn ballVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> BallPoint {
let i = ballDrawnAs(i32(k));
var o: BallPoint;
o.ball = i;
let center = ballSphere(i).xyz;
let radius = ballSphere(i).w;
let toBall = center - frame.cameraPosition;
let distance = length(toBall);
if (distance <= radius * 1.001) {
o.world = center;
o.at = vec4f(2.0, 2.0, 2.0, 1.0);
return o;
}
let forward = toBall / distance;
let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(forward.y) < 0.99);
let right = normalize(cross(forward, helper));
let up = cross(right, forward);
let halfSize = radius * distance / sqrt(distance * distance - radius * radius) * 1.1;
let corner = squareCorner(v);
o.world = center + (right * corner.x + up * corner.y) * halfSize;
o.at = frame.viewProjection * vec4f(o.world, 1.0);
return o;
}
fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
fn squareWave(x: f32, blur0: f32) -> f32 {
let blur = max(blur0, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
struct BallColor { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn ballFs(s: BallPoint) -> BallColor {
let center = ballSphere(s.ball).xyz;
let radius = ballSphere(s.ball).w;
let rayDir = normalize(s.world - frame.cameraPosition);
let toCenter = center - frame.cameraPosition;
let along = dot(toCenter, rayDir);
let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
let inside = radius - missDist;
let coverage = smoothEdge(inside / max(fwidthFine(inside), 1e-6));
let halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
let hit = frame.cameraPosition + rayDir * (along - halfChord);
let normal = normalize(hit - center);
let surface = center + normal * radius;
let clip = frame.viewProjection * vec4f(surface, 1.0);
let depth = clip.z / clip.w;
let squaresDown = ballColor(s.ball).a;
let squaresAround = 2.0 * squaresDown;
let n = transpose(ballRotation(s.ball)) * normal;
let around = atan2(n.z, n.x) / (2.0 * PI) + 0.5;
let down = acos(clamp(n.y, -1.0, 1.0)) / PI;
let square = vec2f(around * squaresAround, down * squaresDown);
var blur = fwidthFine(square);
blur.x = min(blur.x, fwidthFine(fract(around + 0.5) * squaresAround));
blur *= frame.edgeWidth;
let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
let stepX = dpdxFine(surface);
let stepY = dpdyFine(surface);
if (coverage <= 0.0 || hiddenBehindBall(s.at, depth)) { discard; }
let shadow = shadowAt(surface, stepX, stepY, s.ball);
var color = mix(shade(vec3f(1.0), shadow), shade(ballColor(s.ball).rgb, shadow), checker);
if (frame.glint > 0.0) {
let toLamp = normalize(frame.lightPosition - surface);
let halfway = normalize(toLamp - rayDir);
color += vec3f(frame.glint * pow(max(dot(normal, halfway), 0.0), 120.0) * (1.0 - shadow));
}
var o: BallColor;
o.color = vec4f(color, coverage);
o.depth = depth;
return o;
}
@fragment fn ballDepthFs(s: BallPoint) -> @builtin(frag_depth) f32 {
let center = ballSphere(s.ball).xyz;
let radius = ballSphere(s.ball).w;
let rayDir = normalize(s.world - frame.cameraPosition);
let toCenter = center - frame.cameraPosition;
let along = dot(toCenter, rayDir);
let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
let pixelsInside = (radius - missDist) / max(fwidthFine(missDist), 1e-6);
if (pixelsInside < 0.5 * frame.edgeWidth + 0.1) { discard; }
let halfChord = sqrt(max(0.0, radius * radius - missDist * missDist));
let clip = frame.viewProjection * vec4f(frame.cameraPosition + rayDir * (along - halfChord), 1.0);
return clip.z / clip.w;
}
struct TrailPoint {
@builtin(position) at: vec4f,
@location(0) color: vec3f,
@location(1) fade: f32,
@location(2) side: f32,
}
@vertex fn trailVs(@builtin(vertex_index) v: u32, @location(1) startAt: vec3f, @location(2) endAt: vec3f,
@location(3) color: vec3f, @location(4) fades: vec2f) -> TrailPoint {
var o: TrailPoint;
let start = frame.viewProjection * vec4f(startAt, 1.0);
let end = frame.viewProjection * vec4f(endAt, 1.0);
if (start.w < 0.05 || end.w < 0.05) {
o.at = vec4f(2.0, 2.0, 2.0, 1.0);
return o;
}
let halfView = frame.viewport * 0.5;
let a = start.xy / start.w * halfView;
let b = end.xy / end.w * halfView;
var along = b - a;
let len = length(along);
along = select(vec2f(1.0, 0.0), along / len, len > 1e-4);
let across = vec2f(-along.y, along.x);
let corner = squareCorner(v);
let t = corner.x * 0.5 + 0.5;
o.side = corner.y * (0.5 * frame.trailWidth + 1.0);
o.fade = mix(fades.x, fades.y, t);
o.color = color;
var p = mix(start, end, t);
p = vec4f(p.xy + across * o.side / halfView * p.w, p.zw);
o.at = p;
return o;
}
@fragment fn trailFs(s: TrailPoint) -> @location(0) vec4f {
let coverage = clamp((0.5 * frame.trailWidth - abs(s.side)) / frame.edgeWidth + 0.5, 0.0, 1.0);
return vec4f(toLinear(s.color), coverage * s.fade);
}
var<private> shine: f32 = 0.0;
const LINES = 256.0;
const LEVELS = 15.0;
fn addBar(color: vec3f, y: f32, center: f32, barColor: vec3f) -> vec3f {
let d = abs(y - center) / 0.055;
if (d >= 1.0) { return color; }
let glow = 1.0 - d * d;
let highlight = pow(glow, 6.0);
shine = max(shine, highlight);
return barColor * glow + vec3f(0.6) * highlight;
}
@fragment fn copperFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let y = (floor((frame.height - at.y) / frame.height * LINES) + 0.5) / LINES;
let t = frame.time;
var color = mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y);
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9), vec3f(0.769, 0.008, 0.200));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 0.7), vec3f(0.000, 0.624, 0.420));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 1.4), vec3f(0.000, 0.529, 0.741));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 2.1), vec3f(1.000, 0.827, 0.000));
color = floor(min(color, vec3f(1.0)) * LEVELS + 0.5) / LEVELS;
let boost = 1.0 + frame.shine * floor(shine * LEVELS + 0.5) / LEVELS;
return vec4f(toLinear(color) * boost, 1.0);
}
@fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
var linear = max(textureLoad(scene, vec2i(at.xy), 0).rgb, vec3f(0.0));
if (frame.textRect.z > 0.0) {
let fromBottom = vec2f(at.x, frame.height - at.y);
let t = (fromBottom - frame.textRect.xy) / frame.textRect.zw;
if (all(t >= vec2f(0.0)) && all(t < vec2f(1.0))) {
let letter = textureSampleLevel(textPicture, textSampler, vec2f(t.x, 1.0 - t.y), 0.0);
linear = mix(linear, toLinear(letter.rgb) * (1.0 + frame.textGlow), letter.a);
}
}
var color = toScreen(min(linear, vec3f(1.0)));
if (frame.colorLevels > 0.0) { color = floor(color * frame.colorLevels + 0.5) / frame.colorLevels; }
let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
color = select(color, bright, linear > vec3f(1.0));
return vec4f(color, 1.0);
}
`;export{A as GpuRenderer};
