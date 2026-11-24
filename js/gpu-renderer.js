const ve=8;import{BOX_HALF_SIZE as be}from"./physics.js?v=2.04-397";import{SceneRenderer as xe,BACKDROPS as re,pictureBackdrop as ye,BACKGROUND as Pe,gridLook as Te,backdropTime as ie,SHADOW_STRENGTH as Q,BALL_TABLE_COLUMNS as Z,BALL_NUMBERS as J,TRAIL_OPACITY as Be,trailPower as Se,srgbToLinear as X,ballRgb as ke,toCanvasLight as se,onRec2020Screen as Re}from"./renderer.js?v=2.04-397";import{MAX_BALLS as E,SHADOW_GRID as F,BACKDROP_MATHS as Ge,TILE_CLICKS as ee,TILE_CLICK_MATHS as Ce,PAINT_WORDS as Le,wallKey as Ae}from"./shaders.js?v=2.04-397";import{NO_TILE_CLICKS as ae,NO_PAINT as De}from"./renderer.js?v=2.04-397";import{ELEMENTARY_COLOR_MATHS as le,ELEMENTARY_IN_P3 as ze,ELEMENTARY_IN_2020 as _e,srgbToP3Matrix as Ee}from"./colors.js?v=2.04-397";import{toWgsl as N,SQUARE_WAVE as Ue}from"./shade.js?v=2.04-397";import{SCROLLER_SHADER as Ie}from"./scroller.js?v=2.04-397";import{effectLook as ne}from"./effect-options.js?v=2.04-397";const _=F*F,oe=1048575,U="rgba16float",fe="depth32float",ce=8,L=12,$=16,Oe=4096,ue=1<<20,de=48,he=96+4*ee,Fe=160,j=256;function m(w,e,t,s,i,r){w[e]=t,w[e+1]=s,w[e+2]=i,w[e+3]=r}const Ne=new Set;class ge extends xe{static async create(e,{onLost:t}={}){if(!navigator.gpu)return{error:"this browser has no WebGPU"};let s;try{const i=await navigator.gpu.requestAdapter();if(!i)return{error:"WebGPU found no graphics card"};const r=i.features.has("timestamp-query");s=await i.requestDevice({requiredFeatures:r?["timestamp-query"]:[]});const n=i.info??null,a=document.createElement("canvas");a.className="scene-hdr",Object.assign(a.style,{position:"absolute",top:"0",left:"0",width:"100%",height:"100%",pointerEvents:"none"});const o=new ge(e,a,s);o.adapterInfo=n,await o.makePipelines(),o.configure("extended");const d=o.context.getConfiguration?.()?.toneMapping?.mode;o.canShowHdr=d===void 0||d==="extended";try{o.configure("standard","srgb-linear"),o.linearCanvas=o.context.getConfiguration?.()?.colorSpace==="srgb-linear"}catch{o.linearCanvas=!1}return o.shownAs=null,o.configure(),e.before(a),s.lost.then(v=>{o.disposed||t?.(v.message)}),{renderer:o}}catch(i){return s?.destroy(),{error:i.message}}}constructor(e,t,s){super(e),this.canvas=t,this.device=s,this.context=t.getContext("webgpu"),this.floatTarget=!0,this.disposed=!1,this.shownOnce=!1,this.isWebGpu=!0,this.earlyDepth=!0,this.canShowHdr=!1,this.linearCanvas=!1,this.timer=s.features.has("timestamp-query")?new We(s):null,this.gpuTimer=this.timer,this.shownAs=null,this.maxPictureSize=s.limits.maxTextureDimension2D;const i=(r,n)=>s.createBuffer({size:r,usage:n|GPUBufferUsage.COPY_DST});this.frameData=new Float32Array(he),this.frameWords=new Uint32Array(this.frameData.buffer),this.frameBuffer=i(he*4,GPUBufferUsage.UNIFORM),this.wallData=new Float32Array(6*j/4),this.wallWords=new Uint32Array(this.wallData.buffer),this.wallBuffer=i(6*j,GPUBufferUsage.UNIFORM),this.ballBuffer=i(E*Z*16,GPUBufferUsage.STORAGE),this.buildsBallTable=!0,this.numberBuffer=i(E*J*4,GPUBufferUsage.STORAGE),this.orderBuffer=i(E*4,GPUBufferUsage.STORAGE),this.buildsShadowGrid=!0,this.cellBuffer=i(_*4,GPUBufferUsage.STORAGE),this.listBuffer=i(oe*16,GPUBufferUsage.STORAGE),this.countBuffer=i(_*4,GPUBufferUsage.STORAGE),this.blockBuffer=i(_/256*4,GPUBufferUsage.STORAGE),this.trail={room:0,written:0,owner:null,generation:null,index:null,sentGeneration:new Int32Array(E).fill(-1),sentUpTo:new Float64Array(E),staging:new Float32Array(1024*L),balls:new Float32Array(E*$)},this.trailBallBuffer=i(E*$*4,GPUBufferUsage.STORAGE),this.trailRingBuffer=null,this.growTrailRing(Oe),this.layouts=qe(s),this.sharedGroup=s.createBindGroup({layout:this.layouts.shared,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.ballBuffer}},{binding:2,resource:{buffer:this.cellBuffer}},{binding:3,resource:{buffer:this.listBuffer}}]}),this.gridGroup=s.createBindGroup({layout:this.layouts.grid,entries:[this.frameBuffer,this.ballBuffer,this.cellBuffer,this.listBuffer,this.countBuffer,this.blockBuffer].map((r,n)=>({binding:n,resource:{buffer:r}}))}),this.tableGroup=s.createBindGroup({layout:this.layouts.table,entries:[this.frameBuffer,this.numberBuffer,this.orderBuffer,this.ballBuffer].map((r,n)=>({binding:n,resource:{buffer:r}}))}),this.wallGroup=s.createBindGroup({layout:this.layouts.wall,entries:[{binding:0,resource:{buffer:this.wallBuffer,size:Fe}}]}),this.scrollerText=null,this.scrollerBuffer=i(16,GPUBufferUsage.STORAGE),this.kefrensBuffer=i(16,GPUBufferUsage.STORAGE),this.picture=s.createTexture({size:[1,1],format:U,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),this.piecesTexture=this.emptyPieces(),this.piecesSent=-1,this.floorPiecesTexture=this.device.createTexture({size:[1,1],format:"r8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.floorPiecesSent=null,this.target=null}async makePipelines(){const e=this.device,t=this.layouts,s=e.createShaderModule({code:Ye}),i={color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"}},r=(o,d,v,{blended:l=!0,depthWrite:k=!1,depthTest:c="always",color:f=!0,depthFormat:h=fe,strip:R=!0,buffers:A=[],writeMask:G}={})=>e.createRenderPipelineAsync({layout:o,vertex:{module:s,entryPoint:d,buffers:A},fragment:v?{module:s,entryPoint:v,targets:f?[{format:U,blend:l?i:void 0,writeMask:G}]:[]}:void 0,primitive:{topology:R?"triangle-strip":"triangle-list"},depthStencil:h?{format:h,depthWriteEnabled:k,depthCompare:c}:void 0});[this.starsPipeline,this.plasmaPipeline,this.kefrensPipeline,this.copperRowsPipeline,this.floorPipeline,this.wallPipeline,this.wallTilesPipeline,this.ballPipeline,this.trailPipeline,this.trailHeadPipeline,this.presentPipeline,this.textPipeline,this.ballLatePipeline,this.ballCoreInPassPipeline,this.ballDepthInPassPipeline,this.piecesPipeline]=await Promise.all([r(t.scene,"fullVs","starsFs",{blended:!1,strip:!1}),r(t.scene,"fullVs","plasmaFs",{blended:!1,strip:!1}),r(t.scene,"fullVs","kefrensFs",{blended:!1,strip:!1}),r(t.scene,"copperRowsVs","copperRowsFs",{blended:!1}),r(t.scene,"floorVs","floorFs",{depthTest:"less"}),r(t.scene,"wallVs","wallFs",{depthTest:"less"}),r(t.scene,"wallVs","wallTilesFs",{depthTest:"less"}),r(t.scene,"ballVs","ballFs",{depthTest:"less-equal"}),r(t.scene,"trailVs","trailFs",{depthTest:"less"}),r(t.scene,"trailHeadVs","trailFs",{depthTest:"less"}),r(t.present,"fullVs","presentFs",{blended:!1,depthFormat:null,strip:!1}),r(t.scene,"textVs","textFs"),r(t.scene,"ballVs","ballFs"),r(t.front,"ballCoreVs","noColorFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"}),r(t.front,"ballVs","ballDepthInPassFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"}),r(t.scene,"fullVs","piecesFs",{strip:!1})]);const n=e.createShaderModule({code:He}),a=o=>e.createComputePipelineAsync({layout:t.gridPipelines,compute:{module:n,entryPoint:o}});[this.countPipeline,this.sumBlocksPipeline,this.sumOverBlocksPipeline,this.startListsPipeline,this.fillPipeline,this.sortPipeline]=await Promise.all(["countCells","sumBlocks","sumOverBlocks","startLists","fillLists","sortLists"].map(a)),this.kefrensColumnsPipeline=await e.createComputePipelineAsync({layout:t.kefrensPipeline,compute:{module:e.createShaderModule({code:Xe}),entryPoint:"kefrensColumns"}}),this.tablePipeline=await e.createComputePipelineAsync({layout:t.tablePipeline,compute:{module:e.createShaderModule({code:$e}),entryPoint:"makeBallTable"}})}configure(e=this.testToneMapping??(this.hdr?"extended":"standard"),t=(this.wideColor?"display-p3":"srgb")+(this.linearCanvas?"-linear":"")){if(!(this.disposed||this.shownAs===t+e)){this.shownAs=t+e;try{this.context.configure({device:this.device,format:U,colorSpace:t,toneMapping:{mode:e},alphaMode:"opaque"})}catch(s){if(!t.endsWith("-linear"))throw s;this.linearCanvas=!1,this.shownAs=null,this.configure(e)}}}setHdr(e){return e&&!this.canShowHdr?!1:(this.hdr=e?{get screenIsHdr(){return matchMedia("(dynamic-range: high)").matches}}:null,this.configure(),!0)}applyColorSpace(){this.configure()}get colourLevel(){return this.canvasIsWide?this.hdr&&Re()?2:1:0}waitUntilDone(){}resize(){const{width:e,height:t}=this.measure();this.canvas.style.imageRendering=this.view.style.imageRendering,!(this.target&&this.canvas.width===e&&this.canvas.height===t)&&(this.canvas.width=e,this.canvas.height=t,this.target?.dispose(),this.target=Ve(this.device,e,t),this.makePresentGroup())}drawPicture(e,t,s=null){const i=ye(e)?e.backdrop:null;(i!==this.pictureOf||ne()!==this.pictureLook)&&(this.pictureLook=ne(),this.pictureDrawer?.dispose(),this.pictureOf=i,this.pictureDrawer=i?e.effect.gpu({width:1,height:1,linear:!0,getContext:()=>({configure(){},unconfigure(){},getCurrentTexture:()=>this.pictureInto})},this.device):null);const r=e.copper&&e.backdrop==="kefrens",n=r?this.target.width:1,a=r?this.target.height:1;return(this.picture.width!==n||this.picture.height!==a)&&(this.picture.destroy(),this.picture=this.device.createTexture({size:[n,a],format:U,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),this.makePresentGroup()),this.pictureDrawer?(this.pictureInto=t,this.pictureDrawer.setLook(this.canvasIsWide,!!this.hdr),this.pictureDrawer.timestampWrites=s?s.writes("backdrop"):void 0,this.pictureDrawer.draw(e.backdropTime??0,this.target.width,this.target.height,this.hdr?e.effect.glow??0:0),!0):!1}makePresentGroup(){this.target&&(this.kefrensGroup=this.device.createBindGroup({layout:this.layouts.kefrens,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.kefrensBuffer}},{binding:2,resource:this.picture.createView()}]}),this.frontGroup=this.device.createBindGroup({layout:this.layouts.letters,entries:[{binding:2,resource:{buffer:this.scrollerBuffer}},{binding:4,resource:{buffer:this.trailRingBuffer}},{binding:5,resource:{buffer:this.trailBallBuffer}},{binding:6,resource:{buffer:this.kefrensBuffer}},{binding:7,resource:this.picture.createView()},{binding:8,resource:this.piecesTexture.createView()},{binding:9,resource:this.floorPiecesTexture.createView()}]}),this.presentGroup=this.device.createBindGroup({layout:this.layouts.presentInputs,entries:[{binding:1,resource:this.target.sceneView},{binding:2,resource:{buffer:this.scrollerBuffer}},{binding:3,resource:this.piecesTexture.createView()}]}))}sendFloorPieces(e){!e||this.floorPiecesSent?.floor===e&&this.floorPiecesSent.version===e.version||((this.floorPiecesTexture.width!==e.width||this.floorPiecesTexture.height!==e.height)&&(this.floorPiecesTexture.destroy(),this.floorPiecesTexture=this.device.createTexture({size:[e.width,e.height],format:"r8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.makePresentGroup()),this.device.queue.writeTexture({texture:this.floorPiecesTexture},e.codes,{bytesPerRow:e.width},[e.width,e.height]),this.floorPiecesSent={floor:e,version:e.version})}emptyPieces(){return this.device.createTexture({size:[1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT})}sendPieces(e){if(!e){if(this.piecesSent===-1)return;this.piecesTexture.destroy(),this.piecesTexture=this.emptyPieces(),this.piecesSent=-1,this.makePresentGroup();return}if(e.version===this.piecesSent)return;const{width:t,height:s}=e.canvas;(this.piecesTexture.width!==t||this.piecesTexture.height!==s)&&(this.piecesTexture.destroy(),this.piecesTexture=this.device.createTexture({size:[t,s],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.makePresentGroup()),this.device.queue.copyExternalImageToTexture({source:e.canvas},{texture:this.piecesTexture,colorSpace:this.canvasIsWide?"display-p3":"srgb",premultipliedAlpha:!1},[t,s]),this.piecesSent=e.version}scrollerNumbers(e,t,s,i){if(this.scrollerText!==e.message){this.scrollerText=e.message;const r=e.words;this.scrollerBuffer.destroy(),this.scrollerBuffer=this.device.createBuffer({size:r.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.scrollerBuffer,0,r),this.makePresentGroup()}s.set(e.place(t,this.pixelated),i),m(s,i+4,e.letterNumbers.length,e.glyphRows.length,this.pixelated?1:0,0)}dispose(){this.disposed||(this.disposed=!0,this.pictureDrawer?.dispose(),this.canvas.remove(),this.view.style.opacity="",this.device.destroy())}draw(e,t,s={}){if(this.disposed)return;this.target||this.resize();const i=this.prepare(e,t,s),{count:r,eye:n}=i,a=this.device,o=a.queue,{width:d,height:v}=this.target,l=this.frameData;Me(e.viewProjection,l),m(l,16,n.x,n.y,n.z,0),this.frameWords[19]=r,m(l,20,i.light.x,i.light.y,i.light.z,i.shadowRange),m(l,24,i.forward.x,i.forward.y,i.forward.z,Q),m(l,28,i.side.x,i.side.y,i.side.z,i.edgeWidth),m(l,32,i.up.x,i.up.y,i.up.z,i.shadowOpacity);const k=i.shadowColor;m(l,36,k[0],k[1],k[2],i.glint),m(l,40,i.floorY,i.floorHalfSize,be,i.lineWidth),l.set(i.wallShown,44);const c=Te(s),f=c.color;m(l,48,f[0],f[1],f[2],c.opacity),m(l,52,d,v,i.trailWidth,ie(s)),m(l,56,v,i.shine,this.edgeUnits,this.hdr?i.textGlow:0);const h=s.scroller,R=h?this.textRect(h.strip,d,v):null;R?l.set(R,60):m(l,60,0,0,0,0),R&&this.scrollerNumbers(h,R,l,76);const A=s.tileClicks??ae;l.set(A.tiles,96);const G=s.floorPieces??null;G?m(l,88,G.x0,G.z0,1/G.across,1/G.deep):m(l,88,0,0,0,0),m(l,92,i.showShadows?1:0,0,0,0);const S=c.color;m(l,64,this.hdr?ve:0,X(1-Q),i.shadowReach,re.indexOf(s.backdrop??"bars"));const b=this.canvasIsWide,p=this.gridColorKey??=[NaN,NaN,NaN,null];(p[0]!==S[0]||p[1]!==S[1]||p[2]!==S[2]||p[3]!==b)&&(p[0]=S[0],p[1]=S[1],p[2]=S[2],p[3]=b,this.gridLit=se(S.map(X),b),this.gridShadowed=se(S.map(u=>X(u*(1-Q))),b)),m(l,68,this.gridLit[0],this.gridLit[1],this.gridLit[2],this.colourLevel),m(l,72,this.gridShadowed[0],this.gridShadowed[1],this.gridShadowed[2],r>=de?1:0),m(l,84,S[0],S[1],S[2],0),o.writeBuffer(this.frameBuffer,0,l);const D=this.wallData;for(let u=0;u<i.walls.length;u++){const{wall:P,extend:H,drawEdge:V,catchesShadows:we}=i.walls[u],O=u*j/4;D.set(H,O),D.set(V,O+4),m(D,O+8,P.center.x,P.center.y,P.center.z,we?1:0);const te=A.paint.get(Ae(P.center))??De;m(D,O+12,P.axisU.x,P.axisU.y,P.axisU.z,te.some(me=>me!==0)?1:0),m(D,O+16,P.axisV.x,P.axisV.y,P.axisV.z,0),this.wallWords.set(te,O+20)}o.writeBuffer(this.wallBuffer,0,D),r>0&&i.tableOnGpu?(o.writeBuffer(this.numberBuffer,0,s.ballNumbers,0,r*J),o.writeBuffer(this.orderBuffer,0,this.drawOrder,0,r)):r>0&&o.writeBuffer(this.ballBuffer,0,this.ballTable,0,r*Z*4);const q=s.trailSeconds>0?this.sendTrails(t,r,s.trailTime??0,s.trailSeconds):0;if(s.copper&&s.backdrop==="kefrens"){const u=this.kefrensRows(d,v,ie(s));this.kefrensBuffer.size<u*8&&(this.kefrensBuffer.destroy(),this.kefrensBuffer=a.createBuffer({size:u*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()),o.writeBuffer(this.kefrensBuffer,0,this.kefrensData,0,u*2)}this.configure();const z=this.linearCanvas;this.sendPieces(s.pieces??null),this.sendFloorPieces(s.floorPieces??null);const W=this.context.getCurrentTexture().createView(),Y=z?W:this.target.sceneView,x=this.measureGpu&&this.timer?this.timer.start():null,T=this.skipParts??Ne,C=!T.has("backdrop")&&this.drawPicture(s,z?this.context.getCurrentTexture():this.target.scene,x),y=a.createCommandEncoder();if(this.buildShadowGrid(y,r,i.showShadows,x,i.tableOnGpu),s.copper&&s.backdrop==="kefrens"&&!T.has("backdrop")){const u=y.beginComputePass({timestampWrites:x?x.writes("backdrop"):void 0});u.setBindGroup(0,this.kefrensGroup),u.setPipeline(this.kefrensColumnsPipeline),u.dispatchWorkgroups(Math.ceil(d/64)),u.end()}const B=(u,P)=>y.beginRenderPass({...P,timestampWrites:x?x.writes(u):void 0}),M=q>0,g=B("scene",{colorAttachments:[{view:Y,loadOp:C?"load":"clear",storeOp:"store",clearValue:[...Pe.map(X),1]}],depthStencilAttachment:{view:this.target.frontDepthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});if(g.setBindGroup(0,this.sharedGroup),g.setBindGroup(1,this.frontGroup),g.setBindGroup(2,this.wallGroup,[0]),r>0&&!T.has("balls")&&(g.setPipeline(M?this.ballDepthInPassPipeline:this.ballCoreInPassPipeline),g.draw(ce,r)),!T.has("backdrop")){if(s.copper&&(s.backdrop??"bars")==="bars")g.setPipeline(this.copperRowsPipeline),g.draw(4,v);else if(s.copper&&!C){const u=re.indexOf(s.backdrop);g.setPipeline([this.starsPipeline,this.plasmaPipeline,this.kefrensPipeline][u-1]),g.draw(3)}}if((i.showShadows||s.floorPieces)&&n.y>i.floorY&&!T.has("floor")&&(g.setPipeline(this.floorPipeline),g.draw(4)),i.showGrid&&!T.has("walls")&&(g.setPipeline((s.tileClicks??ae).tiles[3]>=0?this.wallTilesPipeline:this.wallPipeline),i.walls.forEach((u,P)=>{u.shown&&(g.setBindGroup(2,this.wallGroup,[P*j]),g.draw(4))})),r>0&&!T.has("balls")&&(g.setPipeline(this.earlyDepth?this.ballPipeline:this.ballLatePipeline),g.draw(ce,r)),q>0&&!T.has("trails")&&(this.trail.written>0&&(g.setPipeline(this.trailPipeline),g.draw(4,Math.min(this.trail.written,this.trail.room))),g.setPipeline(this.trailHeadPipeline),g.draw(4,r)),z&&s.pieces&&(g.setPipeline(this.piecesPipeline),g.draw(3)),z&&R&&!T.has("scroller")&&(g.setPipeline(this.textPipeline),g.draw(4)),g.end(),!z){const u=B("copy",{colorAttachments:[{view:W,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});u.setPipeline(this.presentPipeline),u.setBindGroup(0,this.sharedGroup),u.setBindGroup(1,this.presentGroup),u.draw(3),u.end()}x?.finish(y),o.submit([y.finish()]),x?.read((u,P)=>{this.gpuTotalMs+=P,this.gpuFrames++;const H=this.gpuParts??={};for(const V in u)H[V]=(H[V]??0)+u[V]}),this.drewDirect=z,this.shownOnce||(this.shownOnce=!0,this.view.style.opacity="0")}trailRoomGrown(){}growTrailRing(e){const t=this.trail;t.room=e,t.written=0,t.owner=new Int32Array(e).fill(-1),t.generation=new Int32Array(e),t.index=new Float64Array(e),t.sentGeneration.fill(-1),this.trailRingBuffer?.destroy(),this.trailRingBuffer=this.device.createBuffer({size:e*L*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()}sendTrails(e,t,s,i){const r=this.trail,n=this.device.queue,a=this.colourLevel;let o=0,d=0,v=r.written;const l=()=>{if(d===0)return;const c=v%r.room,f=Math.min(d,r.room-c);n.writeBuffer(this.trailRingBuffer,c*L*4,r.staging,0,f*L),d>f&&n.writeBuffer(this.trailRingBuffer,0,r.staging,f*L,(d-f)*L),v+=d,d=0},k=c=>{const f=r.owner[c];if(f<0||f>=t)return!1;const h=e[f];return r.generation[c]===h.trailGeneration&&r.index[c]>=h.trailBase};for(let c=0;c<t;c++){const f=e[c],h=f.trail,R=f.trailBase,A=h.length/4,G=A-(f.trailHead?1:0);r.sentGeneration[c]!==f.trailGeneration&&(r.sentGeneration[c]=f.trailGeneration,r.sentUpTo[c]=R);const S=R+G-1;for(let x=Math.max(r.sentUpTo[c],R);x<S;x++){const T=(v+d)%r.room;if(k(T)&&r.room<ue)return this.growTrailRing(Math.min(ue,r.room*2)),this.sendTrails(e,t,s,i);d*L>=r.staging.length&&(l(),r.staging.length<65536*L&&(r.staging=new Float32Array(r.staging.length*2)));const C=(x-R)*4,y=d*L,B=r.staging;B[y]=h[C],B[y+1]=h[C+1],B[y+2]=h[C+2],B[y+3]=h[C+3],B[y+4]=h[C+4],B[y+5]=h[C+5],B[y+6]=h[C+6],B[y+7]=h[C+7],B[y+8]=c,B[y+9]=f.trailGeneration,B[y+10]=x,B[y+11]=0;const M=(v+d)%r.room;r.owner[M]=c,r.generation[M]=f.trailGeneration,r.index[M]=x,d++,r.written++}r.sentUpTo[c]=Math.max(r.sentUpTo[c],S);const b=c*$,p=r.balls,[D,q,z]=ke(f.color,a),W=A>0?Math.max(i,Math.abs(s-h[3])):i;p[b]=D,p[b+1]=q,p[b+2]=z,p[b+3]=W,p[b+4]=f.trailGeneration,p[b+5]=R,p[b+6]=s;const Y=f.trailHead&&G>=1;if(p[b+7]=Se(W,i)*(Y?1:-1),Y){const x=(G-1)*4,T=f.position;p[b+8]=h[x],p[b+9]=h[x+1],p[b+10]=h[x+2],p[b+11]=h[x+3],p[b+12]=T.x,p[b+13]=T.y,p[b+14]=T.z,p[b+15]=h[h.length-1]}A>1&&o++}return l(),t>0&&n.writeBuffer(this.trailBallBuffer,0,r.balls,0,t*$),o}shadowListGrown(){}buildShadowGrid(e,t,s,i,r){const n=s&&t>0;if(n||e.clearBuffer(this.cellBuffer),!n&&!(r&&t>0))return;n&&e.clearBuffer(this.countBuffer);const a=e.beginComputePass({timestampWrites:i?i.writes("shadows"):void 0});if(r&&t>0&&(a.setBindGroup(0,this.tableGroup),a.setPipeline(this.tablePipeline),a.dispatchWorkgroups(Math.ceil(t/64))),!n){a.end();return}a.setBindGroup(0,this.gridGroup),a.setPipeline(this.countPipeline),a.dispatchWorkgroups(t),a.setPipeline(this.sumBlocksPipeline),a.dispatchWorkgroups(_/256),a.setPipeline(this.sumOverBlocksPipeline),a.dispatchWorkgroups(1),a.setPipeline(this.startListsPipeline),a.dispatchWorkgroups(_/256),a.setPipeline(this.fillPipeline),a.dispatchWorkgroups(t),t>=de&&(a.setPipeline(this.sortPipeline),a.dispatchWorkgroups(_/64)),a.end()}}const I=["backdrop","shadows","scene","copy"];class We{constructor(e){this.device=e,this.querySet=e.createQuerySet({type:"timestamp",count:2*I.length}),this.resolved=e.createBuffer({size:16*I.length,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.free=[],this.made=0}start(){let e=this.free.pop();if(!e&&this.made<4&&(this.made++,e=this.device.createBuffer({size:16*I.length,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})),!e)return null;const t=new Set,{querySet:s,resolved:i,free:r}=this;return{writes(n){const a=I.indexOf(n);return t.add(a),{querySet:s,beginningOfPassWriteIndex:2*a,endOfPassWriteIndex:2*a+1}},finish(n){n.resolveQuerySet(s,0,2*I.length,i,0),n.copyBufferToBuffer(i,0,e,0,16*I.length)},read(n){e.mapAsync(GPUMapMode.READ).then(()=>{const a=new BigInt64Array(e.getMappedRange()),o=[...t].sort((c,f)=>c-f),d={},v=a[2*o[0]];let l=v;for(const c of o){const f=a[2*c+1];d[I[c]]=Math.max(0,Number(f-l)/1e6),f>l&&(l=f)}const k=Math.max(0,Number(l-v)/1e6);e.unmap(),r.push(e),n(d,k)},()=>{})}}}}function Me(w,e){e.set(w,0);for(let t=0;t<4;t++)e[t*4+2]=.5*w[t*4+2]+.5*w[t*4+3]}function Ve(w,e,t){const s=(o,d)=>w.createTexture({size:[e,t],format:o,usage:d}),i=GPUTextureUsage.RENDER_ATTACHMENT,r=GPUTextureUsage.TEXTURE_BINDING,n=s(U,i|r),a=s(fe,i);return{width:e,height:t,scene:n,sceneView:n.createView(),frontDepthView:a.createView(),dispose(){n.destroy(),a.destroy()}}}function qe(w){const e=GPUShaderStage.VERTEX,t=GPUShaderStage.FRAGMENT,s=w.createBindGroupLayout({entries:[{binding:0,visibility:e|t,buffer:{type:"uniform"}},{binding:1,visibility:e|t,buffer:{type:"read-only-storage"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:3,visibility:t,buffer:{type:"read-only-storage"}}]}),i=w.createBindGroupLayout({entries:[{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:4,visibility:e,buffer:{type:"read-only-storage"}},{binding:5,visibility:e,buffer:{type:"read-only-storage"}},{binding:6,visibility:t,buffer:{type:"read-only-storage"}},{binding:7,visibility:t,texture:{sampleType:"float"}},{binding:8,visibility:t,texture:{sampleType:"float"}},{binding:9,visibility:t,texture:{sampleType:"float"}}]}),r=w.createBindGroupLayout({entries:[{binding:0,visibility:e|t,buffer:{type:"uniform",hasDynamicOffset:!0}}]}),n=w.createBindGroupLayout({entries:[{binding:1,visibility:t,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:3,visibility:t,texture:{sampleType:"float"}}]}),a=GPUShaderStage.COMPUTE,o=w.createBindGroupLayout({entries:[{binding:0,visibility:a,buffer:{type:"uniform"}},{binding:1,visibility:a,buffer:{type:"read-only-storage"}},...[2,3,4,5].map(k=>({binding:k,visibility:a,buffer:{type:"storage"}}))]}),d=w.createBindGroupLayout({entries:[{binding:0,visibility:a,buffer:{type:"uniform"}},{binding:1,visibility:a,buffer:{type:"read-only-storage"}},{binding:2,visibility:a,buffer:{type:"read-only-storage"}},{binding:3,visibility:a,buffer:{type:"storage"}}]}),v=w.createBindGroupLayout({entries:[{binding:0,visibility:a,buffer:{type:"uniform"}},{binding:1,visibility:a,buffer:{type:"read-only-storage"}},{binding:2,visibility:a,storageTexture:{access:"write-only",format:U}}]}),l=k=>w.createPipelineLayout({bindGroupLayouts:k});return{kefrens:v,kefrensPipeline:l([v]),shared:s,letters:i,wall:r,presentInputs:n,grid:o,gridPipelines:l([o]),table:d,tablePipeline:l([d]),front:l([s]),scene:l([s,i,r]),present:l([s,n])}}const K=`
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
height: f32, shine: f32, edgeUnits: f32, textGlow: f32,
textRect: vec4f,
hdrRange: f32, whiteInShadow: f32, shadowReach: f32, backdrop: f32,
gridLit: vec3f, wide: f32,
gridInShadow: vec3f, listsInOrder: f32,
scroll: vec4f,
scrollText: vec4f,
gridScreen: vec4f,
floorPieces: vec4f,
floorShadows: vec4f,
tiles: array<vec4f, ${ee}>,
}
`,Ye=`
${K}
struct Wall {
extend: vec4f,
drawEdge: vec4f,
center: vec3f, catchShadows: f32,
axisU: vec3f, painted: f32,
axisV: vec3f,
paint: array<vec4u, ${Le/4}>,
}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
@group(0) @binding(2) var<storage, read> shadowCells: array<u32>;
@group(0) @binding(3) var<storage, read> shadowList: array<vec4f>;
@group(1) @binding(1) var scene: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> scrollerText: array<u32>;
@group(1) @binding(4) var<storage, read> trailRing: array<vec4f>;
@group(1) @binding(5) var<storage, read> trailBalls: array<vec4f>;
@group(1) @binding(7) var picture: texture_2d<f32>;
@group(1) @binding(8) var piecesInScene: texture_2d<f32>;
@group(1) @binding(3) var piecesInLastStep: texture_2d<f32>;
@group(1) @binding(9) var floorPiecesPicture: texture_2d<f32>;
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
const SRGB_TO_P3 = ${Ee("wgsl")};
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
let cell = clamp(vec2i(floor((seen / (2.0 * frame.shadowRange) + 0.5) * ${F}.0)),
vec2i(0), vec2i(${F} - 1));
var shadow = 0.0;
let cellEntry = shadowCells[cell.y * ${F} + cell.x];
let first = cellEntry >> 12u;
let listed = cellEntry & 4095u;
let reachAhead = ahead + pixelReach;
for (var k = 0u; k < listed; k++) {
let sphere = shadowList[first + k];
if (frame.listsInOrder > 0.5 && dot(sphere.xyz - frame.lightPosition, frame.lightForward) - sphere.w > reachAhead) { break; }
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
fn floorPieceAt(p: vec3f) -> vec4f {
let area = frame.floorPieces;
if (area.z <= 0.0) { return vec4f(0.0); }
let uv = vec2f((p.x - area.x) * area.z, (p.z - area.y) * area.w);
if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) { return vec4f(0.0); }
let size = textureDimensions(floorPiecesPicture);
let code = floor(textureLoad(floorPiecesPicture, vec2u(uv * vec2f(size)), 0).r * 255.0 + 0.5);
if (code < 0.5) { return vec4f(0.0); }
return vec4f(select(elementaryColor(code - 1.0, frame.wide), vec3f(1.0), code > 4.5), 1.0);
}
fn floorPiecesIn(p: vec3f, stepX: vec3f, stepY: vec3f) -> vec4f {
if (frame.floorPieces.z <= 0.0) { return vec4f(0.0); }
if (frame.edgeWidth < 0.5) { return floorPieceAt(p); }
var sum = vec4f(0.0);
for (var k = 0u; k < 4u; k++) {
let o = vec2f(f32(k % 2u), f32(k / 2u)) * 0.5 - 0.25;
let c = floorPieceAt(p + stepX * o.x + stepY * o.y);
sum += vec4f(c.rgb * c.a, c.a);
}
if (sum.a <= 0.0) { return vec4f(0.0); }
return vec4f(sum.rgb / sum.a, sum.a * 0.25);
}
@fragment fn floorFs(s: Surface) -> @location(0) vec4f {
let stepX = dpdxFine(s.world);
let stepY = dpdyFine(s.world);
let h = frame.halfSize;
let shown = frame.wallShown;
let piece = floorPiecesIn(s.world, stepX, stepY);
var shadow = 0.0;
if (frame.floorShadows.x > 0.5) { shadow = shadowAt(s.world, stepX, stepY, NO_BALL); }
if (piece.a > 0.0) {
let lit = mix(toLinear(piece.rgb), toLinear(piece.rgb * (1.0 - frame.shadowStrength)), shadow);
let under = (1.0 - piece.a) * shadow * frame.shadowOpacity;
let a = piece.a + under;
return vec4f((lit * piece.a + frame.shadowColor * under) / a, a);
}
if ((s.world.x < -h && shown.x > 0.5) || (s.world.x > h && shown.y > 0.5) ||
(s.world.z < -h && shown.z > 0.5) || (s.world.z > h && shown.w > 0.5)) { return vec4f(0.0); }
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
fn shadeWall(c: vec3f, shadow: f32) -> vec3f { return mix(toCanvas(c), toCanvas(c * (1.0 - frame.shadowStrength)), shadow); }
fn shadeElementary(c: vec3f, shadow: f32) -> vec3f { return mix(toLinear(c), toLinear(c * (1.0 - frame.shadowStrength)), shadow); }
fn paintOf(square: f32) -> f32 {
if (square < 0.0) { return 0.0; }
let i = u32(square);
let word = wall.paint[i / 32u][(i / 8u) % 4u];
return f32((word >> (4u * (i % 8u))) & 15u);
}
${N(Ce)}
@fragment fn wallFs(s: WallPoint) -> @location(0) vec4f { return wallColor(s, false); }
@fragment fn wallTilesFs(s: WallPoint) -> @location(0) vec4f { return wallColor(s, true); }
fn wallColor(s: WallPoint, withTiles: bool) -> vec4f {
let h = frame.halfSize;
let slopeX = dpdxFine(s.grid);
let slopeY = dpdyFine(s.grid);
let unitsPerPixel = sqrt(slopeX * slopeX + slopeY * slopeY);
let nearestLine = floor(s.grid + 0.5);
let toLine = abs((s.grid - nearestLine) / unitsPerPixel + 0.03);
let toEdge = abs(abs(s.grid) - h) / unitsPerPixel;
var coverage = 0.0;
if (min(min(toLine.x, toLine.y), min(toEdge.x, toEdge.y)) < 0.5 * frame.lineWidth + frame.edgeWidth) {
let pastEdge = (abs(s.grid) - h) / min(unitsPerPixel, vec2f(frame.edgeUnits));
let width = vec2f(frame.lineWidth);
let packedLines = width * unitsPerPixel;
let fade = 1.0 - smoothstep(vec2f(0.25), vec2f(0.6), packedLines);
let inner = select(vec2f(1.0), vec2f(0.0), abs(nearestLine) >= vec2f(h));
let ends = vec2f(smoothEdge(-pastEdge.y), smoothEdge(-pastEdge.x));
let innerAlongY = lineCoverage(toLine.x, width.x) * inner.x * fade.x * ends.x;
let innerAlongX = lineCoverage(toLine.y, width.y) * inner.y * fade.y * ends.y;
let drawsEdge = vec2f(select(wall.drawEdge.y, wall.drawEdge.x, s.grid.x > 0.0),
select(wall.drawEdge.w, wall.drawEdge.z, s.grid.y > 0.0));
let edgeAlongY = lineCoverage(toEdge.x, width.x) * drawsEdge.x * smoothEdge(0.5 * width.x - pastEdge.x) * ends.x;
let edgeAlongX = lineCoverage(toEdge.y, width.y) * drawsEdge.y * smoothEdge(0.5 * width.y - pastEdge.y) * ends.y;
coverage = max(max(innerAlongY, innerAlongX), max(edgeAlongY, edgeAlongX));
}
var tile = vec4f(0.0);
if (withTiles) {
let square = floor(s.grid) + 0.5;
let squareMiddle = s.world + wall.axisU * (square.x - s.grid.x) + wall.axisV * (square.y - s.grid.y);
var here = -1;
for (var i = 0; i < ${ee}; i++) {
if (frame.tiles[i].w < 0.0) { break; }
if (distance(squareMiddle, frame.tiles[i].xyz) < 0.25) { here = i; }
}
if (here >= 0) { tile = tileAt(s.grid, s.world, wall.axisU, wall.axisV, frame.tiles[here], unitsPerPixel, frame.lineWidth, frame.gridScreen.rgb, vec2f(s.at.x, frame.height - s.at.y)); }
}
var paint = vec4f(0.0);
if (wall.painted > 0.5) { paint = paintColor(paintOf(paintSquare(s.grid, s.world, wall.axisU, wall.axisV, h)), frame.wide); }
let floorStepX = dpdxFine(s.world);
let floorStepY = dpdyFine(s.world);
if (wall.axisU.y == 0.0 && wall.axisV.y == 0.0 && s.world.y < 0.0) {
let under = 1.0 - floorPiecesIn(s.world, floorStepX, floorStepY).a;
coverage *= under; tile.a *= under; paint.a *= under;
}
let e = wall.extend;
let pastCatch = vec4f(s.grid.x - h - e.x, -s.grid.x - h - e.y,
s.grid.y - h - e.z, -s.grid.y - h - e.w) / unitsPerPixel.xxyy;
let inside = select(vec4f(0.0), vec4f(1.0), pastCatch <= vec4f(0.1));
let onWall = wall.catchShadows * min(min(inside.x, inside.y), min(inside.z, inside.w));
let stepX = dpdxFine(s.world);
let stepY = dpdyFine(s.world);
if (coverage <= 0.0 && onWall <= 0.0 && tile.a <= 0.0 && paint.a <= 0.0) { return vec4f(0.0); }
let shadow = shadowAt(s.world, stepX, stepY, NO_BALL);
let lineLayer = coverage * frame.lineOpacity;
let tileLayer = tile.a * (1.0 - lineLayer);
let paintLayer = paint.a * (1.0 - lineLayer - tileLayer);
let shadowLayer = onWall * shadow * frame.shadowOpacity * (1.0 - lineLayer - tileLayer - paintLayer);
let opacity = lineLayer + tileLayer + paintLayer + shadowLayer;
if (opacity <= 0.0) { return vec4f(0.0); }
let gridColor = mix(frame.gridLit, frame.gridInShadow, shadow);
var color = gridColor * lineLayer + frame.shadowColor * shadowLayer;
if (tileLayer > 0.0) { color += shadeWall(tile.rgb, shadow) * tileLayer; }
if (paintLayer > 0.0) { color += shadeElementary(paint.rgb, shadow) * paintLayer; }
color /= opacity;
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
${N(Ue)}
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
return ${Be} * (1.0 - pow(min(1.0, abs(now - time) / look.w), power));
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
${N(le)}
fn backdropColor(i: f32) -> vec3f { return elementaryColor(i, frame.wide); }
fn kefrensRow(i: i32) -> vec2f { return kefrensRows[i]; }
${N(Ge,{time:"frame.time",height:"frame.height",width:"frame.viewport.x",hard:"select(0.0, 1.0, frame.edgeWidth < 0.5)"})}
fn copperOut(color: vec3f) -> vec4f {
return vec4f(toCanvas(min(color, vec3f(1.0))) * (1.0 + frame.shine * shine), 1.0);
}
@fragment fn starsFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
return copperOut(stars(vec2f(at0.x, frame.height - at0.y)));
}
@fragment fn plasmaFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
return copperOut(plasma(vec2f(at0.x, frame.height - at0.y) / frame.height));
}
@fragment fn kefrensFs(@builtin(position) at0: vec4f) -> @location(0) vec4f {
let worked = textureLoad(picture, vec2i(at0.xy), 0);
shine = worked.a;
return copperOut(worked.rgb);
}
struct CopperRow { @builtin(position) at: vec4f, @location(0) @interpolate(flat) color: vec4f }
@vertex fn copperRowsVs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> CopperRow {
let corner = vec2f(f32(v & 1u), f32(v >> 1u));
let row = f32(i);
let color = copperBars((row + 0.5) / frame.height);
var o: CopperRow;
o.color = vec4f(toCanvas(min(color, vec3f(1.0))) * (1.0 + frame.shine * shine), 1.0);
o.at = vec4f(corner.x * 2.0 - 1.0, (row + corner.y) / frame.height * 2.0 - 1.0, 0.0, 1.0);
return o;
}
@fragment fn copperRowsFs(row: CopperRow) -> @location(0) vec4f { return row.color; }
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
fn piecesAt(pieces: texture_2d<f32>, at: vec2f) -> vec4f {
let size = textureDimensions(pieces);
let p = vec2u(at);
if (p.x >= size.x || p.y >= size.y) { return vec4f(0.0); }
let c = textureLoad(pieces, p, 0);
return vec4f(toLinear(c.rgb), c.a);
}
@fragment fn piecesFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
return piecesAt(piecesInScene, at.xy);
}
fn scrollerWord(i: u32) -> u32 { return scrollerText[i]; }
${N(Ie,{scroll:"frame.scroll",scrollText:"frame.scrollText",textRect:"frame.textRect",height:"frame.height",textGlow:"frame.textGlow"})}
@fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let read = textureLoad(scene, vec2i(at.xy), 0).rgb;
var linear = select(max(read, vec3f(0.0)), read, frame.wide > 1.5);
let piece = piecesAt(piecesInLastStep, at.xy);
linear = mix(linear, piece.rgb, piece.a);
let letter = scrollerColor(at.xy);
linear = mix(linear, letter.rgb, letter.a);
var color = toScreen(min(linear, vec3f(1.0)));
if (frame.hdrRange > 0.0) {
let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
color = select(color, bright, linear > vec3f(1.0));
}
return vec4f(color, 1.0);
}
`,He=`
${K}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> cells: array<u32>;
@group(0) @binding(3) var<storage, read_write> lists: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> blocks: array<u32>;
const GRID = ${F};
const LIST_ROOM = ${oe}u;
const BLOCKS = ${_/256}u;
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
fn nearness(v: vec4f) -> f32 { return dot(v.xyz - frame.lightPosition, frame.lightForward) - v.w; }
@compute @workgroup_size(64)
fn sortLists(@builtin(global_invocation_id) id: vec3u) {
if (id.x >= ${_}u) { return; }
let entry = cells[id.x];
let first = entry >> 12u;
let n = entry & 4095u;
if (n < 2u) { return; }
var gaps = array<u32, 8>(701u, 301u, 132u, 57u, 23u, 10u, 4u, 1u);
for (var g = 0; g < 8; g++) {
let gap = gaps[g];
if (gap >= n) { continue; }
for (var i = gap; i < n; i++) {
let v = lists[first + i];
let near = nearness(v);
var j = i;
loop {
if (j < gap) { break; }
let w = lists[first + j - gap];
if (nearness(w) <= near) { break; }
lists[first + j] = w;
j -= gap;
}
lists[first + j] = v;
}
}
}
`,Xe=`
${K}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> kefrensRows: array<vec2f>;
@group(0) @binding(2) var picture: texture_storage_2d<${U}, write>;
${N(le)}
fn backdropColor(i: f32) -> vec3f { return elementaryColor(i, frame.wide); }
fn sky(y: f32) -> vec3f { return mix(vec3f(0.4, 0.53, 0.73), vec3f(0.0, 0.0, 0.27), y); }
@compute @workgroup_size(64)
fn kefrensColumns(@builtin(global_invocation_id) id: vec3u) {
let size = textureDimensions(picture);
if (id.x >= size.x) { return; }
let height = i32(size.y);
let unit = 256.0 / frame.height;
let x = (f32(id.x) + 0.5) * unit;
let top = i32(ceil(24.0 / unit - 0.5));
var color = vec3f(0.0);
var left = 1.0;
var glow = 0.0;
for (var i = 0; i < height; i++) {
if (i >= top) {
let row = kefrensRows[i];
let off = abs(x - row.x) - 8.0;
if (off < 0.5 * unit) {
let o = clamp((x - row.x) / 8.0, -1.0, 1.0);
let shade = 1.0 - o * o;
let band = floor((f32(i) + 0.5) * unit / 16.0);
let bar = backdropColor(band - 4.0 * floor(band / 4.0));
let lit = bar * (0.65 + 0.35 * shade) + vec3f(0.45) * pow(shade, 8.0);
let cover = clamp(0.5 - off / unit, 0.0, 1.0);
color = cover * lit + (1.0 - cover) * color;
glow = max(pow(shade, 10.0), (1.0 - cover) * glow);
left *= 1.0 - cover;
}
}
let y = (frame.height - (f32(i) + 0.5)) / frame.height;
textureStore(picture, vec2i(i32(id.x), i), vec4f(color + left * sky(y), glow));
}
}
`,pe=w=>[...w].map(([e,t])=>`        case 0x${e.toString(16).padStart(6,"0")}u: { rgb = vec3f(${t.join(", ")}); }`).join(`
`),$e=`
${K}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> numbers: array<f32>;
@group(0) @binding(2) var<storage, read> order: array<u32>;
@group(0) @binding(3) var<storage, read_write> table: array<vec4f>;
@compute @workgroup_size(64)
fn makeBallTable(@builtin(global_invocation_id) id: vec3u) {
let i = id.x;
if (i >= frame.ballCount) { return; }
let a = i * ${J}u;
let x = numbers[a + 3u]; let y = numbers[a + 4u]; let z = numbers[a + 5u]; let w = numbers[a + 6u];
let color = u32(numbers[a + 8u]);
let row = i * ${Z}u;
table[row] = vec4f(numbers[a], numbers[a + 1u], numbers[a + 2u], numbers[a + 7u]);
var rgb = vec3f(f32((color >> 16u) & 255u), f32((color >> 8u) & 255u), f32(color & 255u)) / 255.0;
if (frame.wide > 1.5) {
switch color {
${pe(_e)}
default: {}
}
} else if (frame.wide > 0.5) {
switch color {
${pe(ze)}
default: {}
}
}
table[row + 1u] = vec4f(rgb, numbers[a + 9u]);
table[row + 2u] = vec4f(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w), 0.0);
table[row + 3u] = vec4f(2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w), 0.0);
table[row + 4u] = vec4f(2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y), 0.0);
table[row + 5u] = vec4f(f32(order[i]), 0.0, 0.0, 0.0);
}
`;export{ge as GpuRenderer,ve as HDR_RANGE};
