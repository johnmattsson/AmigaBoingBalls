const te=8;import{BOX_HALF_SIZE as re}from"./physics.js?v=2.04-251";import{SceneRenderer as ie,BACKDROPS as ae,BACKGROUND as se,gridLook as le,backdropTime as Y,SHADOW_STRENGTH as H,BALL_TABLE_COLUMNS as q,BALL_NUMBERS as M,TRAIL_OPACITY as oe,srgbToLinear as U,ballRgb as ne,toCanvasLight as X,onRec2020Screen as fe}from"./renderer.js?v=2.04-251";import{MAX_BALLS as C,SHADOW_GRID as D,BACKDROP_PERIOD as j}from"./shaders.js?v=2.04-251";const L=D*D,$=1048575,V="rgba16float",K="depth32float",Q=8,T=12,F=16,ce=4096,Z=1<<20,J=84,W=256;class ee extends ie{static async create(i,{onLost:t}={}){if(!navigator.gpu)return{error:"this browser has no WebGPU"};let a;try{const e=await navigator.gpu.requestAdapter();if(!e)return{error:"WebGPU found no graphics card"};const r=e.features.has("timestamp-query");a=await e.requestDevice({requiredFeatures:r?["timestamp-query"]:[]});const n=e.info??null,s=document.createElement("canvas");s.className="scene-hdr",Object.assign(s.style,{position:"absolute",top:"0",left:"0",width:"100%",height:"100%",pointerEvents:"none"});const l=new ee(i,s,a);l.adapterInfo=n,await l.makePipelines(),l.configure("extended");const f=l.context.getConfiguration?.()?.toneMapping?.mode;l.canShowHdr=f===void 0||f==="extended";try{l.configure("standard","srgb-linear"),l.linearCanvas=l.context.getConfiguration?.()?.colorSpace==="srgb-linear"}catch{l.linearCanvas=!1}return l.shownAs=null,l.configure(),i.before(s),a.lost.then(g=>{l.disposed||t?.(g.message)}),{renderer:l}}catch(e){return a?.destroy(),{error:e.message}}}constructor(i,t,a){super(i),this.canvas=t,this.device=a,this.context=t.getContext("webgpu"),this.floatTarget=!0,this.disposed=!1,this.shownOnce=!1,this.isWebGpu=!0,this.earlyDepth=!0,this.canShowHdr=!1,this.linearCanvas=!1,this.timer=a.features.has("timestamp-query")?new de(a):null,this.gpuTimer=this.timer,this.shownAs=null,this.maxPictureSize=a.limits.maxTextureDimension2D;const e=(r,n)=>a.createBuffer({size:r,usage:n|GPUBufferUsage.COPY_DST});this.frameData=new Float32Array(J),this.frameWords=new Uint32Array(this.frameData.buffer),this.frameBuffer=e(J*4,GPUBufferUsage.UNIFORM),this.wallData=new Float32Array(6*W/4),this.wallBuffer=e(6*W,GPUBufferUsage.UNIFORM),this.ballBuffer=e(C*q*16,GPUBufferUsage.STORAGE),this.buildsBallTable=!0,this.numberBuffer=e(C*M*4,GPUBufferUsage.STORAGE),this.orderBuffer=e(C*4,GPUBufferUsage.STORAGE),this.buildsShadowGrid=!0,this.cellBuffer=e(L*4,GPUBufferUsage.STORAGE),this.listBuffer=e($*16,GPUBufferUsage.STORAGE),this.countBuffer=e(L*4,GPUBufferUsage.STORAGE),this.blockBuffer=e(L/256*4,GPUBufferUsage.STORAGE),this.trail={room:0,written:0,owner:null,generation:null,index:null,sentGeneration:new Int32Array(C).fill(-1),sentUpTo:new Float64Array(C),staging:new Float32Array(1024*T),balls:new Float32Array(C*F)},this.trailBallBuffer=e(C*F*4,GPUBufferUsage.STORAGE),this.trailRingBuffer=null,this.growTrailRing(ce),this.layouts=pe(a),this.sharedGroup=a.createBindGroup({layout:this.layouts.shared,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.ballBuffer}},{binding:2,resource:{buffer:this.cellBuffer}},{binding:3,resource:{buffer:this.listBuffer}}]}),this.gridGroup=a.createBindGroup({layout:this.layouts.grid,entries:[this.frameBuffer,this.ballBuffer,this.cellBuffer,this.listBuffer,this.countBuffer,this.blockBuffer].map((r,n)=>({binding:n,resource:{buffer:r}}))}),this.tableGroup=a.createBindGroup({layout:this.layouts.table,entries:[this.frameBuffer,this.numberBuffer,this.orderBuffer,this.ballBuffer].map((r,n)=>({binding:n,resource:{buffer:r}}))}),this.wallGroup=a.createBindGroup({layout:this.layouts.wall,entries:[{binding:0,resource:{buffer:this.wallBuffer,size:80}}]}),this.scrollerText=null,this.scrollerBuffer=e(16,GPUBufferUsage.STORAGE),this.kefrensBuffer=e(16,GPUBufferUsage.STORAGE),this.target=null}async makePipelines(){const i=this.device,t=this.layouts,a=i.createShaderModule({code:ge}),e={color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"}},r=(l,f,g,{blended:d=!0,depthWrite:k=!1,depthTest:u="always",color:c=!0,depthFormat:h=K,strip:S=!0,buffers:B=[],writeMask:R}={})=>i.createRenderPipelineAsync({layout:l,vertex:{module:a,entryPoint:f,buffers:B},fragment:g?{module:a,entryPoint:g,targets:c?[{format:V,blend:d?e:void 0,writeMask:R}]:[]}:void 0,primitive:{topology:S?"triangle-strip":"triangle-list"},depthStencil:h?{format:h,depthWriteEnabled:k,depthCompare:u}:void 0});[this.copperPipeline,this.floorPipeline,this.wallPipeline,this.ballPipeline,this.trailPipeline,this.trailHeadPipeline,this.presentPipeline,this.textPipeline,this.ballLatePipeline,this.ballCoreInPassPipeline,this.ballDepthInPassPipeline]=await Promise.all([r(t.scene,"fullVs","copperFs",{blended:!1,strip:!1}),r(t.scene,"floorVs","floorFs",{depthTest:"less"}),r(t.scene,"wallVs","wallFs",{depthTest:"less"}),r(t.scene,"ballVs","ballFs",{depthTest:"less-equal"}),r(t.scene,"trailVs","trailFs",{depthTest:"less"}),r(t.scene,"trailHeadVs","trailFs",{depthTest:"less"}),r(t.present,"fullVs","presentFs",{blended:!1,depthFormat:null,strip:!1}),r(t.scene,"textVs","textFs"),r(t.scene,"ballVs","ballFs"),r(t.front,"ballCoreVs","noColorFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"}),r(t.front,"ballVs","ballDepthInPassFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"})]);const n=i.createShaderModule({code:me}),s=l=>i.createComputePipelineAsync({layout:t.gridPipelines,compute:{module:n,entryPoint:l}});[this.countPipeline,this.sumBlocksPipeline,this.sumOverBlocksPipeline,this.startListsPipeline,this.fillPipeline]=await Promise.all(["countCells","sumBlocks","sumOverBlocks","startLists","fillLists"].map(s)),this.tablePipeline=await i.createComputePipelineAsync({layout:t.tablePipeline,compute:{module:i.createShaderModule({code:we}),entryPoint:"makeBallTable"}})}configure(i=this.testToneMapping??(this.hdr?"extended":"standard"),t=(this.wideColor?"display-p3":"srgb")+(this.linearCanvas&&!this.pixelated?"-linear":"")){if(!(this.disposed||this.shownAs===t+i)){this.shownAs=t+i;try{this.context.configure({device:this.device,format:V,colorSpace:t,toneMapping:{mode:i},alphaMode:"opaque"})}catch(a){if(!t.endsWith("-linear"))throw a;this.linearCanvas=!1,this.shownAs=null,this.configure(i)}}}setHdr(i){return i&&!this.canShowHdr?!1:(this.hdr=i?{get screenIsHdr(){return matchMedia("(dynamic-range: high)").matches}}:null,this.configure(),!0)}applyColorSpace(){this.configure()}get colourLevel(){return this.canvasIsWide?this.hdr&&fe()?2:1:0}async whenReady(){}waitUntilDone(){}resize(){const{width:i,height:t}=this.measure();this.canvas.style.imageRendering=this.view.style.imageRendering,!(this.target&&this.canvas.width===i&&this.canvas.height===t)&&(this.canvas.width=i,this.canvas.height=t,this.target?.dispose(),this.target=he(this.device,i,t),this.makePresentGroup())}makePresentGroup(){this.target&&(this.frontGroup=this.device.createBindGroup({layout:this.layouts.letters,entries:[{binding:2,resource:{buffer:this.scrollerBuffer}},{binding:4,resource:{buffer:this.trailRingBuffer}},{binding:5,resource:{buffer:this.trailBallBuffer}},{binding:6,resource:{buffer:this.kefrensBuffer}}]}),this.presentGroup=this.device.createBindGroup({layout:this.layouts.presentInputs,entries:[{binding:1,resource:this.target.sceneView},{binding:2,resource:{buffer:this.scrollerBuffer}}]}))}scrollerNumbers(i,t){if(this.scrollerText!==i.message){this.scrollerText=i.message;const s=i.glyphRows,l=i.letterNumbers,f=new Uint32Array(s.length+l.length);f.set(s,0),f.set(l,s.length),this.scrollerBuffer.destroy(),this.scrollerBuffer=this.device.createBuffer({size:f.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.scrollerBuffer,0,f),this.makePresentGroup()}const{scrolled:a,phase:e,width:r,textWidth:n}=i.place(t[2]/t[3]);return[a,e,r,n,i.letterNumbers.length,i.glyphRows.length,0,0]}dispose(){this.disposed||(this.disposed=!0,this.canvas.remove(),this.view.style.opacity="",this.device.destroy())}draw(i,t,a={}){if(this.disposed)return;this.target||this.resize();const e=this.prepare(i,t,a),{count:r,eye:n}=e,s=this.device,l=s.queue,{width:f,height:g}=this.target,d=this.frameData;ue(i.viewProjection,d),d.set([n.x,n.y,n.z],16),this.frameWords[19]=r,d.set([e.light.x,e.light.y,e.light.z,e.shadowRange],20),d.set([e.forward.x,e.forward.y,e.forward.z,H],24),d.set([e.side.x,e.side.y,e.side.z,e.edgeWidth],28),d.set([e.up.x,e.up.y,e.up.z,e.shadowOpacity],32),d.set([...e.shadowColor,e.glint],36),d.set([e.floorY,e.floorHalfSize,re,e.lineWidth],40),d.set(e.wallShown,44);const k=le(a);d.set([...k.color,k.opacity],48),d.set([f,g,e.trailWidth,Y(a)],52),d.set([g,e.shine,e.colorLevels,this.hdr?e.textGlow:0],56);const u=a.scroller,c=u?this.textRect(u.canvas,f,g):null;d.set(c??[0,0,0,0],60),c&&d.set(this.scrollerNumbers(u,c),76);const h=k.color;d.set([this.hdr?te:0,U(1-H),e.shadowReach,ae.indexOf(a.backdrop??"bars")],64);const S=this.canvasIsWide;d.set([...X(h.map(U),S),this.colourLevel],68),d.set([...X(h.map(o=>U(o*(1-H))),S),0],72),l.writeBuffer(this.frameBuffer,0,d);const B=this.wallData;e.walls.forEach(({wall:o,extend:y,drawEdge:P,catchesShadows:v},x)=>{const G=x*W/4;B.set(y,G),B.set(P,G+4),B.set([o.center.x,o.center.y,o.center.z,v?1:0],G+8),B.set([o.axisU.x,o.axisU.y,o.axisU.z,0],G+12),B.set([o.axisV.x,o.axisV.y,o.axisV.z,0],G+16)}),l.writeBuffer(this.wallBuffer,0,B),r>0&&e.tableOnGpu?(l.writeBuffer(this.numberBuffer,0,a.ballNumbers,0,r*M),l.writeBuffer(this.orderBuffer,0,this.drawOrder,0,r)):r>0&&l.writeBuffer(this.ballBuffer,0,this.ballTable,0,r*q*4);const R=a.trailSeconds>0?this.sendTrails(t,r,a.trailTime??0,a.trailSeconds):0;if(a.copper&&a.backdrop==="kefrens"){const o=this.kefrensRows(f,g,Y(a));this.kefrensBuffer.size<o*8&&(this.kefrensBuffer.destroy(),this.kefrensBuffer=s.createBuffer({size:o*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()),l.writeBuffer(this.kefrensBuffer,0,this.kefrensData,0,o*2)}this.configure();const z=this.linearCanvas&&!this.pixelated,m=this.context.getCurrentTexture().createView(),w=z?m:this.target.sceneView,_=this.measureGpu&&this.timer?this.timer.start():null,E=s.createCommandEncoder();this.buildShadowGrid(E,r,e.showShadows,_,e.tableOnGpu);const I=(o,y)=>E.beginRenderPass({...y,timestampWrites:_?_.writes(o):void 0}),O=R>0,p=I("scene",{colorAttachments:[{view:w,loadOp:"clear",storeOp:"store",clearValue:[...se.map(U),1]}],depthStencilAttachment:{view:this.target.frontDepthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});if(p.setBindGroup(0,this.sharedGroup),p.setBindGroup(1,this.frontGroup),p.setBindGroup(2,this.wallGroup,[0]),r>0&&(p.setPipeline(O?this.ballDepthInPassPipeline:this.ballCoreInPassPipeline),p.draw(Q,r)),a.copper&&(p.setPipeline(this.copperPipeline),p.draw(3)),e.showShadows&&n.y>e.floorY&&(p.setPipeline(this.floorPipeline),p.draw(4)),e.showGrid&&(p.setPipeline(this.wallPipeline),e.walls.forEach((o,y)=>{o.shown&&(p.setBindGroup(2,this.wallGroup,[y*W]),p.draw(4))})),r>0&&(p.setPipeline(this.earlyDepth?this.ballPipeline:this.ballLatePipeline),p.draw(Q,r)),R>0&&(this.trail.written>0&&(p.setPipeline(this.trailPipeline),p.draw(4,Math.min(this.trail.written,this.trail.room))),p.setPipeline(this.trailHeadPipeline),p.draw(4,r)),z&&c&&(p.setPipeline(this.textPipeline),p.draw(4)),p.end(),!z){const o=I("copy",{colorAttachments:[{view:m,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});o.setPipeline(this.presentPipeline),o.setBindGroup(0,this.sharedGroup),o.setBindGroup(1,this.presentGroup),o.draw(3),o.end()}_?.finish(E),l.submit([E.finish()]),_?.read((o,y)=>{this.gpuTotalMs+=y,this.gpuFrames++;const P=this.gpuParts??={};for(const v in o)P[v]=(P[v]??0)+o[v]}),this.drewDirect=z,this.shownOnce||(this.shownOnce=!0,this.view.style.opacity="0")}trailRoomGrown(){}growTrailRing(i){const t=this.trail;t.room=i,t.written=0,t.owner=new Int32Array(i).fill(-1),t.generation=new Int32Array(i),t.index=new Float64Array(i),t.sentGeneration.fill(-1),this.trailRingBuffer?.destroy(),this.trailRingBuffer=this.device.createBuffer({size:i*T*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()}sendTrails(i,t,a,e){const r=this.trail,n=this.device.queue,s=this.colourLevel;let l=0,f=0,g=r.written;const d=()=>{if(f===0)return;const u=g%r.room,c=Math.min(f,r.room-u);n.writeBuffer(this.trailRingBuffer,u*T*4,r.staging,0,c*T),f>c&&n.writeBuffer(this.trailRingBuffer,0,r.staging,c*T,(f-c)*T),g+=f,f=0},k=u=>{const c=r.owner[u];if(c<0||c>=t)return!1;const h=i[c];return r.generation[u]===h.trailGeneration&&r.index[u]>=h.trailBase};for(let u=0;u<t;u++){const c=i[u],h=c.trail,S=c.trailBase,B=h.length/4,R=B-(c.trailHead?1:0);r.sentGeneration[u]!==c.trailGeneration&&(r.sentGeneration[u]=c.trailGeneration,r.sentUpTo[u]=S);const z=S+R-1;for(let o=Math.max(r.sentUpTo[u],S);o<z;o++){const y=(g+f)%r.room;if(k(y)&&r.room<Z)return this.growTrailRing(Math.min(Z,r.room*2)),this.sendTrails(i,t,a,e);f*T>=r.staging.length&&(d(),r.staging.length<65536*T&&(r.staging=new Float32Array(r.staging.length*2)));const P=(o-S)*4,v=f*T,x=r.staging;x[v]=h[P],x[v+1]=h[P+1],x[v+2]=h[P+2],x[v+3]=h[P+3],x[v+4]=h[P+4],x[v+5]=h[P+5],x[v+6]=h[P+6],x[v+7]=h[P+7],x[v+8]=u,x[v+9]=c.trailGeneration,x[v+10]=o,x[v+11]=0;const G=(g+f)%r.room;r.owner[G]=u,r.generation[G]=c.trailGeneration,r.index[G]=o,f++,r.written++}r.sentUpTo[u]=Math.max(r.sentUpTo[u],z);const m=u*F,w=r.balls,[_,E,I]=ne(c.color,s),O=B>0?Math.max(e,Math.abs(a-h[3])):e;w[m]=_,w[m+1]=E,w[m+2]=I,w[m+3]=O,w[m+4]=c.trailGeneration,w[m+5]=S,w[m+6]=a;const p=c.trailHead&&R>=1;if(w[m+7]=Math.min(3,O/e)*(p?1:-1),p){const o=(R-1)*4,y=c.position;w[m+8]=h[o],w[m+9]=h[o+1],w[m+10]=h[o+2],w[m+11]=h[o+3],w[m+12]=y.x,w[m+13]=y.y,w[m+14]=y.z,w[m+15]=h[h.length-1]}B>1&&l++}return d(),t>0&&n.writeBuffer(this.trailBallBuffer,0,r.balls,0,t*F),l}shadowListGrown(){}buildShadowGrid(i,t,a,e,r){const n=a&&t>0;if(n||i.clearBuffer(this.cellBuffer),!n&&!(r&&t>0))return;n&&i.clearBuffer(this.countBuffer);const s=i.beginComputePass({timestampWrites:e?e.writes("shadows"):void 0});if(r&&t>0&&(s.setBindGroup(0,this.tableGroup),s.setPipeline(this.tablePipeline),s.dispatchWorkgroups(Math.ceil(t/64))),!n){s.end();return}s.setBindGroup(0,this.gridGroup),s.setPipeline(this.countPipeline),s.dispatchWorkgroups(t),s.setPipeline(this.sumBlocksPipeline),s.dispatchWorkgroups(L/256),s.setPipeline(this.sumOverBlocksPipeline),s.dispatchWorkgroups(1),s.setPipeline(this.startListsPipeline),s.dispatchWorkgroups(L/256),s.setPipeline(this.fillPipeline),s.dispatchWorkgroups(t),s.end()}}const A=["shadows","scene","copy"];class de{constructor(i){this.device=i,this.querySet=i.createQuerySet({type:"timestamp",count:2*A.length}),this.resolved=i.createBuffer({size:16*A.length,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.free=[],this.made=0}start(){let i=this.free.pop();if(!i&&this.made<4&&(this.made++,i=this.device.createBuffer({size:16*A.length,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})),!i)return null;const t=new Set,{querySet:a,resolved:e,free:r}=this;return{writes(n){const s=A.indexOf(n);return t.add(s),{querySet:a,beginningOfPassWriteIndex:2*s,endOfPassWriteIndex:2*s+1}},finish(n){n.resolveQuerySet(a,0,2*A.length,e,0),n.copyBufferToBuffer(e,0,i,0,16*A.length)},read(n){i.mapAsync(GPUMapMode.READ).then(()=>{const s=new BigInt64Array(i.getMappedRange()),l=[...t].sort((u,c)=>u-c),f={},g=s[2*l[0]];let d=g;for(const u of l){const c=s[2*u+1];f[A[u]]=Math.max(0,Number(c-d)/1e6),c>d&&(d=c)}const k=Math.max(0,Number(d-g)/1e6);i.unmap(),r.push(i),n(f,k)},()=>{})}}}}function ue(b,i){i.set(b,0);for(let t=0;t<4;t++)i[t*4+2]=.5*b[t*4+2]+.5*b[t*4+3]}function he(b,i,t){const a=(l,f)=>b.createTexture({size:[i,t],format:l,usage:f}),e=GPUTextureUsage.RENDER_ATTACHMENT,r=GPUTextureUsage.TEXTURE_BINDING,n=a(V,e|r),s=a(K,e);return{width:i,height:t,sceneView:n.createView(),frontDepthView:s.createView(),dispose(){n.destroy(),s.destroy()}}}function pe(b){const i=GPUShaderStage.VERTEX,t=GPUShaderStage.FRAGMENT,a=b.createBindGroupLayout({entries:[{binding:0,visibility:i|t,buffer:{type:"uniform"}},{binding:1,visibility:i|t,buffer:{type:"read-only-storage"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:3,visibility:t,buffer:{type:"read-only-storage"}}]}),e=b.createBindGroupLayout({entries:[{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:4,visibility:i,buffer:{type:"read-only-storage"}},{binding:5,visibility:i,buffer:{type:"read-only-storage"}},{binding:6,visibility:t,buffer:{type:"read-only-storage"}}]}),r=b.createBindGroupLayout({entries:[{binding:0,visibility:i|t,buffer:{type:"uniform",hasDynamicOffset:!0}}]}),n=b.createBindGroupLayout({entries:[{binding:1,visibility:t,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}}]}),s=GPUShaderStage.COMPUTE,l=b.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{type:"uniform"}},{binding:1,visibility:s,buffer:{type:"read-only-storage"}},...[2,3,4,5].map(d=>({binding:d,visibility:s,buffer:{type:"storage"}}))]}),f=b.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{type:"uniform"}},{binding:1,visibility:s,buffer:{type:"read-only-storage"}},{binding:2,visibility:s,buffer:{type:"read-only-storage"}},{binding:3,visibility:s,buffer:{type:"storage"}}]}),g=d=>b.createPipelineLayout({bindGroupLayouts:d});return{shared:a,letters:e,wall:r,presentInputs:n,grid:l,gridPipelines:g([l]),table:f,tablePipeline:g([f]),front:g([a]),scene:g([a,e,r]),present:g([a,n])}}const N=`
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
hdrRange: f32, whiteInShadow: f32, shadowReach: f32, backdrop: f32,
gridLit: vec3f, wide: f32,
gridInShadow: vec3f,
scroll: vec4f,
scrollText: vec4f,
}
`,ge=`
${N}
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
@group(0) @binding(3) var<storage, read> shadowList: array<vec4f>;
@group(1) @binding(1) var scene: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> scrollerText: array<u32>;
@group(1) @binding(4) var<storage, read> trailRing: array<vec4f>;
@group(1) @binding(5) var<storage, read> trailBalls: array<vec4f>;
@group(1) @binding(6) var<storage, read> kefrensRows: array<vec2f>;
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
let a = abs(c);
return sign(c) * select(pow((a + 0.055) / 1.055, vec3f(2.4)), a / 12.92, a < vec3f(0.04045));
}
fn toCanvas(c: vec3f) -> vec3f {
const SRGB_TO_P3 = mat3x3f(0.8224620, 0.0331942, 0.0170826,
0.1775380, 0.9668058, 0.0723974,
0.0, 0.0, 0.9105199);
let l = toLinear(c);
return select(l, SRGB_TO_P3 * l, frame.wide > 0.5);
}
fn toScreen(c: vec3f) -> vec3f {
let a = abs(c);
return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));
}
fn smoothEdge(pixelsInside: f32) -> f32 {
return clamp(pixelsInside / frame.edgeWidth + 0.5, 0.0, 1.0);
}
const NO_BALL = vec3f(3.0e38);
fn shadowAt(p: vec3f, stepX: vec3f, stepY: vec3f, skip: vec3f) -> f32 {
let pixelReach = (length(stepX) + length(stepY)) * frame.edgeWidth;
let toLight = frame.lightPosition - p;
let lightDist = length(toLight);
let lightDir = toLight / lightDist;
let ahead = -dot(toLight, frame.lightForward);
if (ahead <= 0.0) { return 0.0; }
let seen = -vec2f(dot(toLight, frame.lightSide), dot(toLight, frame.lightUp)) / ahead;
let cell = clamp(vec2i(floor((seen / (2.0 * frame.shadowRange) + 0.5) * ${D}.0)),
vec2i(0), vec2i(${D} - 1));
var shadow = 0.0;
let cellEntry = shadowCells[cell.y * ${D} + cell.x];
let first = cellEntry >> 12u;
let listed = cellEntry & 4095u;
for (var k = 0u; k < listed; k++) {
let sphere = shadowList[first + k];
if (all(sphere.xyz == skip)) { continue; }
let toBall = sphere.xyz - p;
let radius = sphere.w;
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
let h = frame.halfSize;
let shown = frame.wallShown;
if ((s.world.x < -h && shown.x > 0.5) || (s.world.x > h && shown.y > 0.5) ||
(s.world.z < -h && shown.z > 0.5) || (s.world.z > h && shown.w > 0.5)) { return vec4f(0.0); }
let shadow = shadowAt(s.world, stepX, stepY, NO_BALL);
if (shadow <= 0.0) { return vec4f(0.0); }
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
fn lineCoverage(pixelsAway: f32, width: f32) -> f32 { return smoothEdge(0.5 * width - pixelsAway); }
const EDGE_UNITS = 0.05;
@fragment fn wallFs(s: WallPoint) -> @location(0) vec4f {
let h = frame.halfSize;
let slopeX = dpdxFine(s.grid);
let slopeY = dpdyFine(s.grid);
let unitsPerPixel = sqrt(slopeX * slopeX + slopeY * slopeY);
let nearestLine = floor(s.grid + 0.5);
let toLine = abs((s.grid - nearestLine) / unitsPerPixel + 0.03);
let pastEdge = (abs(s.grid) - h) / min(unitsPerPixel, vec2f(EDGE_UNITS));
let width = vec2f(frame.lineWidth);
let packedLines = width * unitsPerPixel;
let fade = 1.0 - smoothstep(vec2f(0.25), vec2f(0.6), packedLines);
let inner = select(vec2f(1.0), vec2f(0.0), abs(nearestLine) >= vec2f(h));
let ends = vec2f(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
let innerAlongY = lineCoverage(toLine.x, width.x) * inner.x * fade.x * ends.x;
let innerAlongX = lineCoverage(toLine.y, width.y) * inner.y * fade.y * ends.y;
let toEdge = abs(abs(s.grid) - h) / unitsPerPixel;
let drawsEdge = vec2f(select(wall.drawEdge.y, wall.drawEdge.x, s.grid.x > 0.0),
select(wall.drawEdge.w, wall.drawEdge.z, s.grid.y > 0.0));
let edgeAlongY = lineCoverage(toEdge.x, width.x) * drawsEdge.x * smoothEdge(0.5 * width.x - pastEdge.x) * ends.x;
let edgeAlongX = lineCoverage(toEdge.y, width.y) * drawsEdge.y * smoothEdge(0.5 * width.y - pastEdge.y) * ends.y;
let coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
let e = wall.extend;
let pastCatch = vec4f(s.grid.x - h - e.x, -s.grid.x - h - e.y,
s.grid.y - h - e.z, -s.grid.y - h - e.w) / unitsPerPixel.xxyy;
let inside = select(vec4f(0.0), vec4f(1.0), pastCatch <= vec4f(0.1));
let onWall = wall.catchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));
let stepX = dpdxFine(s.world);
let stepY = dpdyFine(s.world);
if (coverage <= 0.0 && onWall <= 0.0) { return vec4f(0.0); }
let shadow = shadowAt(s.world, stepX, stepY, NO_BALL);
let lineLayer = coverage * frame.lineOpacity;
let shadowLayer = onWall * shadow * frame.shadowOpacity * (1.0 - lineLayer);
let opacity = lineLayer + shadowLayer;
if (opacity <= 0.0) { return vec4f(0.0); }
let line = mix(frame.gridLit, frame.gridInShadow, shadow);
let color = (line * lineLayer + frame.shadowColor * shadowLayer) / opacity;
return vec4f(color, opacity);
}
struct BallPoint {
@builtin(position) at: vec4f,
@location(0) world: vec3f,
@location(1) @interpolate(flat) ball: i32,
@location(2) @interpolate(flat) lit: vec3f,
@location(3) @interpolate(flat) inShadow: vec3f,
}
@vertex fn ballVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> BallPoint {
let i = ballDrawnAs(i32(k));
var o: BallPoint;
o.ball = i;
o.lit = toCanvas(ballColor(i).rgb);
o.inShadow = toCanvas(ballColor(i).rgb * (1.0 - frame.shadowStrength));
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
let outline = radius * distance / sqrt(distance * distance - radius * radius);
let middle = frame.viewProjection * vec4f(center, 1.0);
let side = frame.viewProjection * vec4f(center + right * outline, 1.0);
var halfSize = outline * 1.1;
if (middle.w > 1e-3 && side.w > 1e-3) {
let pixels = length((side.xy / side.w - middle.xy / middle.w) * frame.viewport * 0.5);
halfSize = outline * min(1.1, 1.0 + (3.0 + frame.edgeWidth) / max(pixels, 1e-3));
}
let corner = octagonCorner(v);
o.world = center + (right * corner.x + up * corner.y) * halfSize;
o.at = frame.viewProjection * vec4f(o.world, 1.0);
let m = frame.viewProjection;
let nearest = m * vec4f(center - normalize(vec3f(m[0].w, m[1].w, m[2].w)) * radius * 1.01, 1.0);
let nearestDepth = select(0.0, clamp(nearest.z / nearest.w, 0.0, 1.0), nearest.w > 1e-4);
o.at.z = nearestDepth * o.at.w;
return o;
}
@vertex fn ballCoreVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> @builtin(position) vec4f {
let i = ballDrawnAs(i32(k));
let center = ballSphere(i).xyz;
let radius = ballSphere(i).w;
let toBall = center - frame.cameraPosition;
let distance = length(toBall);
let middle = frame.viewProjection * vec4f(center, 1.0);
if (distance <= radius * 1.001 || middle.w < 1e-3) { return vec4f(2.0, 2.0, 2.0, 1.0); }
let forward = toBall / distance;
let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(forward.y) < 0.99);
let right = normalize(cross(forward, helper));
let up = cross(right, forward);
let outline = radius * distance / sqrt(distance * distance - radius * radius);
let side = frame.viewProjection * vec4f(center + right * outline, 1.0);
let pixels = length((side.xy / side.w - middle.xy / middle.w) * frame.viewport * 0.5);
let inside = max(0.0, 1.0 - 1.5 / max(pixels, 1e-3));
let corner = octagonCorner(v) * cos(PI / 8.0) * inside;
let at = frame.viewProjection * vec4f(center + (right * corner.x + up * corner.y) * outline, 1.0);
return vec4f(at.xy, clamp(middle.z / middle.w, 0.0, 1.0) * at.w, at.w);
}
fn octagonCorner(v: u32) -> vec2f {
var order = array<u32, 8>(0u, 1u, 7u, 2u, 6u, 3u, 5u, 4u);
let angle = (f32(order[v]) + 0.5) * PI / 4.0;
return vec2f(cos(angle), sin(angle)) / cos(PI / 8.0);
}
fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
fn squareWave(x: f32, blur0: f32) -> f32 {
let blur = max(blur0, 1e-4);
return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
}
@fragment fn ballFs(s: BallPoint) -> @location(0) vec4f {
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
let n = transpose(ballRotation(s.ball)) * normal;
let nX = dpdxFine(n);
let nY = dpdyFine(n);
let stepX = dpdxFine(surface);
let stepY = dpdyFine(surface);
if (coverage <= 0.0) { return vec4f(0.0); }
let squaresDown = ballColor(s.ball).a;
let squaresAround = 2.0 * squaresDown;
let around = atan2(n.z, n.x) / (2.0 * PI) + 0.5;
let down = acos(clamp(n.y, -1.0, 1.0)) / PI;
let square = vec2f(around * squaresAround, down * squaresDown);
let flat = max(n.x * n.x + n.z * n.z, 1e-12);
let aroundX = (n.x * nX.z - n.z * nX.x) / flat;
let aroundY = (n.x * nY.z - n.z * nY.x) / flat;
let downPer = 1.0 / sqrt(flat);
let blur = vec2f((abs(aroundX) + abs(aroundY)) * squaresAround / (2.0 * PI),
(abs(nX.y) + abs(nY.y)) * downPer * squaresDown / PI) * frame.edgeWidth;
let checker = 0.5 + 0.5 * squareWave(square.x, blur.x) * squareWave(square.y, blur.y);
let shadow = shadowAt(surface, stepX, stepY, center);
var color = mix(vec3f(mix(1.0, frame.whiteInShadow, shadow)), mix(s.lit, s.inShadow, shadow), checker);
if (frame.glint > 0.0) {
let toLamp = normalize(frame.lightPosition - surface);
let halfway = normalize(toLamp - rayDir);
color += vec3f(frame.glint * pow(max(dot(normal, halfway), 0.0), 120.0) * (1.0 - shadow));
}
return vec4f(color, coverage);
}
@fragment fn noColorFs() -> @location(0) vec4f { return vec4f(0.0); }
struct DepthOnly { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn ballDepthInPassFs(s: BallPoint) -> DepthOnly {
let depth = ballSurfaceDepth(s);
if (depth < 0.0) { discard; }
var o: DepthOnly;
o.color = vec4f(0.0);
o.depth = depth;
return o;
}
fn ballSurfaceDepth(s: BallPoint) -> f32 {
let center = ballSphere(s.ball).xyz;
let radius = ballSphere(s.ball).w;
let rayDir = normalize(s.world - frame.cameraPosition);
let toCenter = center - frame.cameraPosition;
let along = dot(toCenter, rayDir);
let missDist = sqrt(max(0.0, dot(toCenter, toCenter) - along * along));
let pixelsInside = (radius - missDist) / max(fwidthFine(missDist), 1e-6);
if (pixelsInside < 0.5 * frame.edgeWidth + 0.1) { return -1.0; }
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
fn trailFade(ball: u32, time: f32) -> f32 {
let look = trailBalls[ball * 4u];
let now = trailBalls[ball * 4u + 1u].z;
let power = abs(trailBalls[ball * 4u + 1u].w);
return ${oe} * (1.0 - pow(min(1.0, abs(now - time) / look.w), power));
}
const HIDDEN = vec4f(2.0, 2.0, 2.0, 1.0);
@vertex fn trailVs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> TrailPoint {
let start = trailRing[k * 3u];
let end = trailRing[k * 3u + 1u];
let id = trailRing[k * 3u + 2u];
let ball = u32(id.x);
if (ball >= frame.ballCount) { var o: TrailPoint; o.at = HIDDEN; return o; }
let now = trailBalls[ball * 4u + 1u];
if (id.y != now.x || id.z < now.y) { var o: TrailPoint; o.at = HIDDEN; return o; }
return trailPiece(v, start.xyz, end.xyz, trailBalls[ball * 4u].rgb,
vec2f(trailFade(ball, start.w), trailFade(ball, end.w)));
}
@vertex fn trailHeadVs(@builtin(vertex_index) v: u32, @builtin(instance_index) ball: u32) -> TrailPoint {
if (trailBalls[ball * 4u + 1u].w < 0.5) { var o: TrailPoint; o.at = HIDDEN; return o; }
let last = trailBalls[ball * 4u + 2u];
let head = trailBalls[ball * 4u + 3u];
return trailPiece(v, last.xyz, head.xyz, trailBalls[ball * 4u].rgb,
vec2f(trailFade(ball, last.w), trailFade(ball, head.w)));
}
fn trailPiece(v: u32, startAt: vec3f, endAt: vec3f, color: vec3f, fades: vec2f) -> TrailPoint {
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
return vec4f(toCanvas(s.color), coverage * s.fade);
}
var<private> shine: f32 = 0.0;
fn backdropColor(i: f32) -> vec3f {
let wide = frame.wide > 0.5;
let wider = frame.wide > 1.5;
if (i < 0.5) { return select(select(vec3f(0.769, 0.008, 0.200), vec3f( 0.8242, -0.1608, 0.1756), wide), vec3f( 0.9059, -0.2723, 0.1406), wider); }
if (i < 1.5) { return select(select(vec3f(1.000, 0.827, 0.000), vec3f( 1.0176, 0.8609, -0.3058), wide), vec3f( 1.0212, 0.8716, -0.3339), wider); }
if (i < 2.5) { return select(select(vec3f(0.000, 0.529, 0.741), vec3f(-0.2504, 0.5236, 0.7784), wide), vec3f(-0.4457, 0.5113, 0.8618), wider); }
return select(select(vec3f(0.000, 0.624, 0.420), vec3f(-0.3157, 0.6472, 0.3911), wide), vec3f(-0.5210, 0.6906, 0.3214), wider);
}
fn sky(y: f32) -> vec3f { return mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y); }
fn addBar(color: vec3f, y: f32, center: f32, barColor: vec3f) -> vec3f {
let d = (y - center) / 0.055;
let edge = 1.0 / (0.055 * frame.height);
if (abs(d) >= 1.0 + edge) { return color; }
let normal = vec3f(0.0, clamp(d, -1.0, 1.0), sqrt(max(0.0, 1.0 - d * d)));
let toLamp = normalize(vec3f(0.0, 0.45, 1.0));
let highlight = pow(max(0.0, dot(normal, normalize(toLamp + vec3f(0.0, 0.0, 1.0)))), 30.0);
shine = max(shine, highlight);
let tube = mix(toLinear(barColor) * (0.1 + 0.9 * max(0.0, dot(normal, toLamp))), vec3f(1.0), 0.8 * highlight);
return mix(color, toSrgb(tube), clamp((1.0 - abs(d)) / edge + 0.5, 0.0, 1.0));
}
fn toSrgb(c: vec3f) -> vec3f {
let a = abs(c);
return sign(c) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a < vec3f(0.0031308));
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn stars(at: vec2f) -> vec3f {
let p = at / frame.height;
var color = mix(vec3f(0.0, 0.0, 0.13), vec3f(0.0), p.y);
for (var layer = 0; layer < 3; layer++) {
let k = f32(layer);
let cell = 0.05 - 0.012 * k;
let lap = select(select(1813.0, 2480.0, k < 1.5), 2827.0, k < 0.5);
let q = vec2f(p.x / cell + frame.time * lap / ${j}, p.y / cell);
var square = floor(q);
square.x = square.x - lap * floor(square.x / lap);
if (hash(square + 7.0 * k) > 0.4) { continue; }
let spot = 0.2 + 0.6 * vec2f(hash(square + 1.3 + k), hash(square + 2.9 + k));
let pixels = length(fract(q) - spot) * cell * frame.height;
let size = (1.6 - 0.4 * k) * max(1.0, frame.height / 900.0);
let bright = (1.0 - 0.3 * k) * exp(-pixels * pixels / (size * size));
let tint = mix(vec3f(1.0), backdropColor(floor(hash(square + 4.1 + k) * 4.0)), 0.45 * step(0.4, hash(square + 5.7 + k)));
color = max(color, tint * bright);
shine = max(shine, bright);
}
return color;
}
fn plasma(p: vec2f) -> vec3f {
let t = frame.time * 0.6;
let v = sin(p.x * 7.0 + t) + sin(p.y * 9.0 - t * 1.3) + sin((p.x + p.y) * 5.0 + t * 0.7)
+ sin(length(p - vec2f(0.8 + 0.4 * sin(t * 0.5), 0.5 + 0.3 * cos(t * 0.4))) * 11.0 - t);
let around = fract(v * 0.25 + 38.0 * frame.time / ${j}) * 4.0;
let part = floor(around);
let f = smoothstep(0.0, 1.0, around - part);
let first = select(select(select(3.0, 2.0, part < 2.5), 0.0, part < 1.5), 1.0, part < 0.5);
let second = select(select(select(1.0, 3.0, part < 2.5), 2.0, part < 1.5), 0.0, part < 0.5);
var color = mix(backdropColor(first), backdropColor(second), f);
color = mix(color, vec3f(1.0), 0.25 * sin(3.14159 * f));
shine = 0.5 * pow(1.0 - sin(3.14159 * f), 4.0);
return color;
}
fn kefrens(at: vec2f) -> vec3f {
let unit = 256.0 / frame.height;
let x = at.x * unit;
let reach = 0.5 * frame.viewport.x * unit - 20.0;
let bend = max(1e-6, reach * (0.6 * 0.055 * 0.055 + 0.4 * 0.023 * 0.023));
var i = i32(frame.height - at.y);
let top = i32(ceil(24.0 / unit - 0.5));
var color = vec3f(0.0);
var left = 1.0;
for (var n = 0; n < 400; n++) {
if (i < top) { break; }
let row = kefrensRows[i];
let off = abs(x - row.x) - 8.0;
if (off < 0.5 * unit) {
let o = clamp((x - row.x) / 8.0, -1.0, 1.0);
let shade = 1.0 - o * o;
let band = floor((f32(i) + 0.5) * unit / 16.0);
let bar = backdropColor(band - 4.0 * floor(band / 4.0));
let lit = bar * (0.65 + 0.35 * shade) + vec3f(0.45) * pow(shade, 8.0);
shine = max(shine, pow(shade, 10.0) * left);
let cover = clamp(0.5 - off / unit, 0.0, 1.0);
color += left * cover * lit;
left *= 1.0 - cover;
if (left < 0.01) { return color; }
i -= 1;
continue;
}
let s = abs(row.y);
let gap = off - 0.5 * unit;
let lines = (sqrt(s * s + 2.0 * bend * gap) - s) / bend;
i -= max(1, i32(lines / unit));
}
return color + left * sky(at.y / frame.height);
}
@fragment fn copperFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
let at = vec2f(at0.x, frame.height - at0.y);
var color: vec3f;
if (frame.backdrop > 2.5) { color = kefrens(at); }
else if (frame.backdrop > 1.5) { color = plasma(at / frame.height); }
else if (frame.backdrop > 0.5) { color = stars(at); }
else {
let y = at.y / frame.height;
let t = frame.time;
color = sky(y);
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9), backdropColor(0.0));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 0.7), backdropColor(3.0));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 1.4), backdropColor(2.0));
color = addBar(color, y, 0.5 + 0.40 * sin(t * 0.9 + 2.1), backdropColor(1.0));
}
return vec4f(toCanvas(min(color, vec3f(1.0))) * (1.0 + frame.shine * shine), 1.0);
}
struct Letter { @builtin(position) at: vec4f, @location(0) t: vec2f }
@vertex fn textVs(@builtin(vertex_index) v: u32) -> Letter {
let corner = squareCorner(v) * 0.5 + 0.5;
let fromBottom = frame.textRect.xy + corner * frame.textRect.zw;
var o: Letter;
o.t = corner;
o.at = vec4f(fromBottom / vec2f(frame.viewport.x, frame.height) * 2.0 - 1.0, 0.0, 1.0);
return o;
}
@fragment fn textFs(s: Letter) -> @location(0) vec4f {
return scrollerColor(s.at.xy);
}
const S_HEIGHT = 130.0; const S_SQUARE = 6.0; const S_STRIP = 2.0;
const S_WAVE_HEIGHT = 26.0; const S_WAVE_LENGTH = 460.0; const S_SHADOW = 4.0;
const S_LETTER_WIDTH = 36.0; const S_LETTER_HEIGHT = 42.0;
fn scrollerInk(x0: f32, y0: f32, offset: f32, zoom: f32) -> f32 {
let x = x0 - offset;
let strip = floor(x / S_STRIP) * S_STRIP;
if (strip < 0.0 || strip >= frame.scroll.z) { return 0.0; }
let inText = strip + frame.scroll.x - frame.scroll.z;
if (inText < 0.0 || inText >= frame.scroll.w) { return 0.0; }
let index = u32(inText / S_LETTER_WIDTH);
let letter = scrollerText[u32(frame.scrollText.y) + index];
if (letter == 255u) { return 0.0; }
let wave = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5
+ S_WAVE_HEIGHT * sin(strip / S_WAVE_LENGTH * 2.0 * PI + frame.scroll.y);
let top = round(wave * zoom) / zoom + offset;
let column = (inText - f32(index) * S_LETTER_WIDTH + (x - strip)) / S_SQUARE;
let row = (y0 - top) / S_SQUARE;
if (column < 0.0 || column >= 5.0 || row < 0.0 || row >= 7.0) { return 0.0; }
let bits = scrollerText[letter * 7u + u32(row)];
return f32((bits >> (4u - u32(column))) & 1u);
}
fn scrollerBand(y: f32) -> vec3f {
var colors = array<vec3f, 9>(
vec3f(1.0, 1.0, 1.0), vec3f(1.0, 1.0, 0.5333), vec3f(1.0, 0.8667, 0.0), vec3f(1.0, 0.5333, 0.0),
vec3f(1.0, 0.1333, 0.0),
vec3f(1.0, 0.5333, 0.0), vec3f(1.0, 0.8667, 0.0), vec3f(1.0, 1.0, 0.5333), vec3f(1.0, 1.0, 1.0));
let t = clamp(y / S_HEIGHT, 0.0, 1.0) * 8.0;
let k = min(u32(t), 7u);
return mix(colors[k], colors[k + 1u], t - f32(k));
}
fn scrollerColor(at: vec2f) -> vec4f {
let rect = frame.textRect;
let fromBottom = frame.height - at.y;
if (rect.z <= 0.0 || at.x < rect.x || at.x >= rect.x + rect.z || fromBottom < rect.y || fromBottom >= rect.y + rect.w) {
return vec4f(0.0);
}
let zoom = rect.w / S_HEIGHT;
let x = (at.x - rect.x) / zoom;
let y = (rect.y + rect.w - fromBottom) / zoom;
let middle = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5;
if (y < middle - S_WAVE_HEIGHT - 2.0 || y > middle + S_WAVE_HEIGHT + S_LETTER_HEIGHT + S_SHADOW + 2.0) {
return vec4f(0.0);
}
var ink = 0.0; var shade = 0.0;
for (var i = 0; i < 4; i++) {
for (var j = 0; j < 4; j++) {
let p = vec2f(x, y) + (vec2f(f32(i), f32(j)) - 1.5) * 0.25 / zoom;
ink += scrollerInk(p.x, p.y, 0.0, zoom);
shade += scrollerInk(p.x, p.y, S_SHADOW, zoom);
}
}
ink /= 16.0; shade /= 16.0;
let alpha = ink + shade * (1.0 - ink);
if (alpha <= 0.0) { return vec4f(0.0); }
let letter = toCanvas(scrollerBand(y)) * (1.0 + frame.textGlow);
let shadow = toCanvas(vec3f(0.0, 0.0, 0.2));
return vec4f((letter * ink + shadow * shade * (1.0 - ink)) / alpha, alpha);
}
@fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let read = textureLoad(scene, vec2i(at.xy), 0).rgb;
var linear = select(max(read, vec3f(0.0)), read, frame.wide > 1.5);
let letter = scrollerColor(at.xy);
linear = mix(linear, letter.rgb, letter.a);
var color = toScreen(min(linear, vec3f(1.0)));
if (frame.colorLevels > 0.0) { color = floor(color * frame.colorLevels + 0.5) / frame.colorLevels; }
if (frame.hdrRange > 0.0) {
let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
color = select(color, bright, linear > vec3f(1.0));
}
return vec4f(color, 1.0);
}
`,me=`
${N}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> cells: array<u32>;
@group(0) @binding(3) var<storage, read_write> lists: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> blocks: array<u32>;
const GRID = ${D};
const LIST_ROOM = ${$}u;
const BLOCKS = ${L/256}u;
struct Shadow {
x0: i32, x1: i32, z0: i32, z1: i32,
whole: bool,
toBall: vec3f,
distance: f32,
sinCone: f32, cosCone: f32,
}
fn toCell(v: f32) -> i32 {
return i32(floor((v + frame.shadowRange) * f32(GRID) / (2.0 * frame.shadowRange)));
}
fn shadowOf(i: u32, s: ptr<function, Shadow>) -> bool {
let sphere = ballData[i * 6u];
let r = sphere.w;
let f = sphere.xyz - frame.lightPosition;
let below = dot(f, frame.lightForward);
if (below - r <= 0.0) { return false; }
let side = dot(f, frame.lightSide);
let up = dot(f, frame.lightUp);
let near = 1.0 / (below - r);
let far = 1.0 / (below + r);
let a = min((side - r) * near, (side - r) * far);
let b = max((side + r) * near, (side + r) * far);
let c = min((up - r) * near, (up - r) * far);
let d = max((up + r) * near, (up + r) * far);
(*s).x0 = clamp(toCell(a) - 1, 0, GRID - 1);
(*s).x1 = clamp(toCell(b) + 1, 0, GRID - 1);
(*s).z0 = clamp(toCell(c) - 1, 0, GRID - 1);
(*s).z1 = clamp(toCell(d) + 1, 0, GRID - 1);
(*s).whole = (*s).x0 == 0 || (*s).z0 == 0 || (*s).x1 == GRID - 1 || (*s).z1 == GRID - 1;
(*s).toBall = vec3f(side, up, below);
(*s).distance = length((*s).toBall);
(*s).sinCone = min(1.0, r / (*s).distance);
(*s).cosCone = sqrt(1.0 - (*s).sinCone * (*s).sinCone);
return true;
}
fn reaches(s: Shadow, x: i32, z: i32) -> bool {
if (s.whole) { return true; }
let cellSize = 2.0 * frame.shadowRange / f32(GRID);
let sx = (f32(x) + 0.5) * cellSize - frame.shadowRange;
let sy = (f32(z) + 0.5) * cellSize - frame.shadowRange;
let length = sqrt(sx * sx + sy * sy + 1.0);
let cosAngle = dot(vec3f(sx, sy, 1.0), s.toBall) / (length * s.distance);
let m = min(1.0, 0.75 * cellSize / length + frame.shadowReach / s.distance);
let cosM = sqrt(1.0 - m * m);
return cosAngle >= s.cosCone * cosM - s.sinCone * m;
}
@compute @workgroup_size(64)
fn countCells(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) t: u32) {
var s: Shadow;
if (group.x >= frame.ballCount || !shadowOf(group.x, &s)) { return; }
let width = s.x1 - s.x0 + 1;
let all = width * (s.z1 - s.z0 + 1);
for (var k = i32(t); k < all; k += 64) {
let x = s.x0 + k % width;
let z = s.z0 + k / width;
if (reaches(s, x, z)) { atomicAdd(&counts[z * GRID + x], 1u); }
}
}
var<workgroup> sums: array<u32, 256>;
fn runningSum(t: u32) {
for (var back = 1u; back < 256u; back <<= 1u) {
var add = 0u;
if (t >= back) { add = sums[t - back]; }
workgroupBarrier();
sums[t] += add;
workgroupBarrier();
}
}
@compute @workgroup_size(256)
fn sumBlocks(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) t: u32,
@builtin(workgroup_id) group: vec3u) {
let count = atomicLoad(&counts[id.x]);
sums[t] = count;
workgroupBarrier();
runningSum(t);
cells[id.x] = sums[t] - count;
if (t == 255u) { blocks[group.x] = sums[255]; }
}
@compute @workgroup_size(256)
fn sumOverBlocks(@builtin(local_invocation_index) t: u32) {
var total = 0u;
if (t < BLOCKS) { total = blocks[t]; }
sums[t] = total;
workgroupBarrier();
runningSum(t);
if (t < BLOCKS) { blocks[t] = sums[t] - total; }
}
@compute @workgroup_size(256)
fn startLists(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) group: vec3u) {
let start = cells[id.x] + blocks[group.x];
let count = atomicLoad(&counts[id.x]);
let first = min(start, LIST_ROOM);
cells[id.x] = first * 4096u + min(min(count, 4095u), LIST_ROOM - first);
atomicStore(&counts[id.x], start);
}
@compute @workgroup_size(64)
fn fillLists(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) t: u32) {
var s: Shadow;
if (group.x >= frame.ballCount || !shadowOf(group.x, &s)) { return; }
let width = s.x1 - s.x0 + 1;
let all = width * (s.z1 - s.z0 + 1);
for (var k = i32(t); k < all; k += 64) {
let x = s.x0 + k % width;
let z = s.z0 + k / width;
if (reaches(s, x, z)) {
let place = atomicAdd(&counts[z * GRID + x], 1u);
if (place < LIST_ROOM) { lists[place] = ballData[group.x * 6u]; }
}
}
}
`,we=`
${N}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> numbers: array<f32>;
@group(0) @binding(2) var<storage, read> order: array<u32>;
@group(0) @binding(3) var<storage, read_write> table: array<vec4f>;
@compute @workgroup_size(64)
fn makeBallTable(@builtin(global_invocation_id) id: vec3u) {
let i = id.x;
if (i >= frame.ballCount) { return; }
let a = i * ${M}u;
let x = numbers[a + 3u]; let y = numbers[a + 4u]; let z = numbers[a + 5u]; let w = numbers[a + 6u];
let color = u32(numbers[a + 8u]);
let row = i * ${q}u;
table[row] = vec4f(numbers[a], numbers[a + 1u], numbers[a + 2u], numbers[a + 7u]);
var rgb = vec3f(f32((color >> 16u) & 255u), f32((color >> 8u) & 255u), f32(color & 255u)) / 255.0;
if (frame.wide > 1.5) {
switch color {
case 0xc40233u: { rgb = vec3f( 0.9059, -0.2723, 0.1406); }
case 0xffd300u: { rgb = vec3f( 1.0212, 0.8716, -0.3339); }
case 0x0087bdu: { rgb = vec3f(-0.4457, 0.5113, 0.8618); }
case 0x009f6bu: { rgb = vec3f(-0.5210, 0.6906, 0.3214); }
default: {}
}
} else if (frame.wide > 0.5) {
switch color {
case 0xc40233u: { rgb = vec3f( 0.8242, -0.1608, 0.1756); }
case 0xffd300u: { rgb = vec3f( 1.0176, 0.8609, -0.3058); }
case 0x0087bdu: { rgb = vec3f(-0.2504, 0.5236, 0.7784); }
case 0x009f6bu: { rgb = vec3f(-0.3157, 0.6472, 0.3911); }
default: {}
}
}
table[row + 1u] = vec4f(rgb, numbers[a + 9u]);
table[row + 2u] = vec4f(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w), 0.0);
table[row + 3u] = vec4f(2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w), 0.0);
table[row + 4u] = vec4f(2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y), 0.0);
table[row + 5u] = vec4f(f32(order[i]), 0.0, 0.0, 0.0);
}
`;export{ee as GpuRenderer,te as HDR_RANGE};
