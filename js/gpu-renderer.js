const ce=8;import{BOX_HALF_SIZE as ue}from"./physics.js?v=2.04-325";import{SceneRenderer as de,BACKDROPS as Z,pictureBackdrop as he,BACKGROUND as pe,gridLook as ge,backdropTime as J,SHADOW_STRENGTH as j,BALL_TABLE_COLUMNS as $,BALL_NUMBERS as K,TRAIL_OPACITY as we,trailPower as me,srgbToLinear as V,ballRgb as ve,toCanvasLight as ee,onRec2020Screen as be}from"./renderer.js?v=2.04-325";import{MAX_BALLS as E,SHADOW_GRID as I,BACKDROP_MATHS as xe}from"./shaders.js?v=2.04-325";import{toWgsl as Q,SQUARE_WAVE as ye}from"./shade.js?v=2.04-325";import{SCROLLER_SHADER as Pe}from"./scroller.js?v=2.04-325";import{effectLook as te}from"./effect-options.js?v=2.04-325";const L=I*I,re=1048575,O="rgba16float",ie="depth32float",ae=8,A=12,q=16,Be=4096,se=1<<20,le=48,ne=84,H=256;function b(m,e,t,a,i,r){m[e]=t,m[e+1]=a,m[e+2]=i,m[e+3]=r}const ke=new Set;class oe extends de{static async create(e,{onLost:t}={}){if(!navigator.gpu)return{error:"this browser has no WebGPU"};let a;try{const i=await navigator.gpu.requestAdapter();if(!i)return{error:"WebGPU found no graphics card"};const r=i.features.has("timestamp-query");a=await i.requestDevice({requiredFeatures:r?["timestamp-query"]:[]});const l=i.info??null,s=document.createElement("canvas");s.className="scene-hdr",Object.assign(s.style,{position:"absolute",top:"0",left:"0",width:"100%",height:"100%",pointerEvents:"none"});const n=new oe(e,s,a);n.adapterInfo=l,await n.makePipelines(),n.configure("extended");const h=n.context.getConfiguration?.()?.toneMapping?.mode;n.canShowHdr=h===void 0||h==="extended";try{n.configure("standard","srgb-linear"),n.linearCanvas=n.context.getConfiguration?.()?.colorSpace==="srgb-linear"}catch{n.linearCanvas=!1}return n.shownAs=null,n.configure(),e.before(s),a.lost.then(w=>{n.disposed||t?.(w.message)}),{renderer:n}}catch(i){return a?.destroy(),{error:i.message}}}constructor(e,t,a){super(e),this.canvas=t,this.device=a,this.context=t.getContext("webgpu"),this.floatTarget=!0,this.disposed=!1,this.shownOnce=!1,this.isWebGpu=!0,this.earlyDepth=!0,this.canShowHdr=!1,this.linearCanvas=!1,this.timer=a.features.has("timestamp-query")?new Se(a):null,this.gpuTimer=this.timer,this.shownAs=null,this.maxPictureSize=a.limits.maxTextureDimension2D;const i=(r,l)=>a.createBuffer({size:r,usage:l|GPUBufferUsage.COPY_DST});this.frameData=new Float32Array(ne),this.frameWords=new Uint32Array(this.frameData.buffer),this.frameBuffer=i(ne*4,GPUBufferUsage.UNIFORM),this.wallData=new Float32Array(6*H/4),this.wallBuffer=i(6*H,GPUBufferUsage.UNIFORM),this.ballBuffer=i(E*$*16,GPUBufferUsage.STORAGE),this.buildsBallTable=!0,this.numberBuffer=i(E*K*4,GPUBufferUsage.STORAGE),this.orderBuffer=i(E*4,GPUBufferUsage.STORAGE),this.buildsShadowGrid=!0,this.cellBuffer=i(L*4,GPUBufferUsage.STORAGE),this.listBuffer=i(re*16,GPUBufferUsage.STORAGE),this.countBuffer=i(L*4,GPUBufferUsage.STORAGE),this.blockBuffer=i(L/256*4,GPUBufferUsage.STORAGE),this.trail={room:0,written:0,owner:null,generation:null,index:null,sentGeneration:new Int32Array(E).fill(-1),sentUpTo:new Float64Array(E),staging:new Float32Array(1024*A),balls:new Float32Array(E*q)},this.trailBallBuffer=i(E*q*4,GPUBufferUsage.STORAGE),this.trailRingBuffer=null,this.growTrailRing(Be),this.layouts=Te(a),this.sharedGroup=a.createBindGroup({layout:this.layouts.shared,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.ballBuffer}},{binding:2,resource:{buffer:this.cellBuffer}},{binding:3,resource:{buffer:this.listBuffer}}]}),this.gridGroup=a.createBindGroup({layout:this.layouts.grid,entries:[this.frameBuffer,this.ballBuffer,this.cellBuffer,this.listBuffer,this.countBuffer,this.blockBuffer].map((r,l)=>({binding:l,resource:{buffer:r}}))}),this.tableGroup=a.createBindGroup({layout:this.layouts.table,entries:[this.frameBuffer,this.numberBuffer,this.orderBuffer,this.ballBuffer].map((r,l)=>({binding:l,resource:{buffer:r}}))}),this.wallGroup=a.createBindGroup({layout:this.layouts.wall,entries:[{binding:0,resource:{buffer:this.wallBuffer,size:80}}]}),this.scrollerText=null,this.scrollerBuffer=i(16,GPUBufferUsage.STORAGE),this.kefrensBuffer=i(16,GPUBufferUsage.STORAGE),this.picture=a.createTexture({size:[1,1],format:O,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),this.target=null}async makePipelines(){const e=this.device,t=this.layouts,a=e.createShaderModule({code:Ce}),i={color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"}},r=(n,h,w,{blended:o=!0,depthWrite:B=!1,depthTest:d="always",color:u=!0,depthFormat:p=ie,strip:k=!0,buffers:y=[],writeMask:z}={})=>e.createRenderPipelineAsync({layout:n,vertex:{module:a,entryPoint:h,buffers:y},fragment:w?{module:a,entryPoint:w,targets:u?[{format:O,blend:o?i:void 0,writeMask:z}]:[]}:void 0,primitive:{topology:k?"triangle-strip":"triangle-list"},depthStencil:p?{format:p,depthWriteEnabled:B,depthCompare:d}:void 0});[this.starsPipeline,this.plasmaPipeline,this.kefrensPipeline,this.copperRowsPipeline,this.floorPipeline,this.wallPipeline,this.ballPipeline,this.trailPipeline,this.trailHeadPipeline,this.presentPipeline,this.textPipeline,this.ballLatePipeline,this.ballCoreInPassPipeline,this.ballDepthInPassPipeline]=await Promise.all([r(t.scene,"fullVs","starsFs",{blended:!1,strip:!1}),r(t.scene,"fullVs","plasmaFs",{blended:!1,strip:!1}),r(t.scene,"fullVs","kefrensFs",{blended:!1,strip:!1}),r(t.scene,"copperRowsVs","copperRowsFs",{blended:!1}),r(t.scene,"floorVs","floorFs",{depthTest:"less"}),r(t.scene,"wallVs","wallFs",{depthTest:"less"}),r(t.scene,"ballVs","ballFs",{depthTest:"less-equal"}),r(t.scene,"trailVs","trailFs",{depthTest:"less"}),r(t.scene,"trailHeadVs","trailFs",{depthTest:"less"}),r(t.present,"fullVs","presentFs",{blended:!1,depthFormat:null,strip:!1}),r(t.scene,"textVs","textFs"),r(t.scene,"ballVs","ballFs"),r(t.front,"ballCoreVs","noColorFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"}),r(t.front,"ballVs","ballDepthInPassFs",{blended:!1,writeMask:0,depthWrite:!0,depthTest:"less"})]);const l=e.createShaderModule({code:De}),s=n=>e.createComputePipelineAsync({layout:t.gridPipelines,compute:{module:l,entryPoint:n}});[this.countPipeline,this.sumBlocksPipeline,this.sumOverBlocksPipeline,this.startListsPipeline,this.fillPipeline,this.sortPipeline]=await Promise.all(["countCells","sumBlocks","sumOverBlocks","startLists","fillLists","sortLists"].map(s)),this.kefrensColumnsPipeline=await e.createComputePipelineAsync({layout:t.kefrensPipeline,compute:{module:e.createShaderModule({code:ze}),entryPoint:"kefrensColumns"}}),this.tablePipeline=await e.createComputePipelineAsync({layout:t.tablePipeline,compute:{module:e.createShaderModule({code:Ae}),entryPoint:"makeBallTable"}})}configure(e=this.testToneMapping??(this.hdr?"extended":"standard"),t=(this.wideColor?"display-p3":"srgb")+(this.linearCanvas?"-linear":"")){if(!(this.disposed||this.shownAs===t+e)){this.shownAs=t+e;try{this.context.configure({device:this.device,format:O,colorSpace:t,toneMapping:{mode:e},alphaMode:"opaque"})}catch(a){if(!t.endsWith("-linear"))throw a;this.linearCanvas=!1,this.shownAs=null,this.configure(e)}}}setHdr(e){return e&&!this.canShowHdr?!1:(this.hdr=e?{get screenIsHdr(){return matchMedia("(dynamic-range: high)").matches}}:null,this.configure(),!0)}applyColorSpace(){this.configure()}get colourLevel(){return this.canvasIsWide?this.hdr&&be()?2:1:0}waitUntilDone(){}resize(){const{width:e,height:t}=this.measure();this.canvas.style.imageRendering=this.view.style.imageRendering,!(this.target&&this.canvas.width===e&&this.canvas.height===t)&&(this.canvas.width=e,this.canvas.height=t,this.target?.dispose(),this.target=Ge(this.device,e,t),this.makePresentGroup())}drawPicture(e,t,a=null){const i=he(e)?e.backdrop:null;(i!==this.pictureOf||te()!==this.pictureLook)&&(this.pictureLook=te(),this.pictureDrawer?.dispose(),this.pictureOf=i,this.pictureDrawer=i?e.effect.gpu({width:1,height:1,linear:!0,getContext:()=>({configure(){},unconfigure(){},getCurrentTexture:()=>this.pictureInto})},this.device):null);const r=e.copper&&e.backdrop==="kefrens",l=r?this.target.width:1,s=r?this.target.height:1;return(this.picture.width!==l||this.picture.height!==s)&&(this.picture.destroy(),this.picture=this.device.createTexture({size:[l,s],format:O,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),this.makePresentGroup()),this.pictureDrawer?(this.pictureInto=t,this.pictureDrawer.setLook(this.canvasIsWide,!!this.hdr),this.pictureDrawer.timestampWrites=a?a.writes("backdrop"):void 0,this.pictureDrawer.draw(e.backdropTime??0,this.target.width,this.target.height,this.hdr?e.effect.glow??0:0),!0):!1}makePresentGroup(){this.target&&(this.kefrensGroup=this.device.createBindGroup({layout:this.layouts.kefrens,entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.kefrensBuffer}},{binding:2,resource:this.picture.createView()}]}),this.frontGroup=this.device.createBindGroup({layout:this.layouts.letters,entries:[{binding:2,resource:{buffer:this.scrollerBuffer}},{binding:4,resource:{buffer:this.trailRingBuffer}},{binding:5,resource:{buffer:this.trailBallBuffer}},{binding:6,resource:{buffer:this.kefrensBuffer}},{binding:7,resource:this.picture.createView()}]}),this.presentGroup=this.device.createBindGroup({layout:this.layouts.presentInputs,entries:[{binding:1,resource:this.target.sceneView},{binding:2,resource:{buffer:this.scrollerBuffer}}]}))}scrollerNumbers(e,t,a,i){if(this.scrollerText!==e.message){this.scrollerText=e.message;const r=e.words;this.scrollerBuffer.destroy(),this.scrollerBuffer=this.device.createBuffer({size:r.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.scrollerBuffer,0,r),this.makePresentGroup()}a.set(e.place(t[2]/t[3]),i),b(a,i+4,e.letterNumbers.length,e.glyphRows.length,0,0)}dispose(){this.disposed||(this.disposed=!0,this.pictureDrawer?.dispose(),this.canvas.remove(),this.view.style.opacity="",this.device.destroy())}draw(e,t,a={}){if(this.disposed)return;this.target||this.resize();const i=this.prepare(e,t,a),{count:r,eye:l}=i,s=this.device,n=s.queue,{width:h,height:w}=this.target,o=this.frameData;Re(e.viewProjection,o),b(o,16,l.x,l.y,l.z,0),this.frameWords[19]=r,b(o,20,i.light.x,i.light.y,i.light.z,i.shadowRange),b(o,24,i.forward.x,i.forward.y,i.forward.z,j),b(o,28,i.side.x,i.side.y,i.side.z,i.edgeWidth),b(o,32,i.up.x,i.up.y,i.up.z,i.shadowOpacity);const B=i.shadowColor;b(o,36,B[0],B[1],B[2],i.glint),b(o,40,i.floorY,i.floorHalfSize,ue,i.lineWidth),o.set(i.wallShown,44);const d=ge(a),u=d.color;b(o,48,u[0],u[1],u[2],d.opacity),b(o,52,h,w,i.trailWidth,J(a)),b(o,56,w,i.shine,this.edgeUnits,this.hdr?i.textGlow:0);const p=a.scroller,k=p?this.textRect(p.strip,h,w):null;k?o.set(k,60):b(o,60,0,0,0,0),k&&this.scrollerNumbers(p,k,o,76);const y=d.color;b(o,64,this.hdr?ce:0,V(1-j),i.shadowReach,Z.indexOf(a.backdrop??"bars"));const z=this.canvasIsWide,G=this.gridColorKey??=[NaN,NaN,NaN,null];(G[0]!==y[0]||G[1]!==y[1]||G[2]!==y[2]||G[3]!==z)&&(G[0]=y[0],G[1]=y[1],G[2]=y[2],G[3]=z,this.gridLit=ee(y.map(V),z),this.gridShadowed=ee(y.map(c=>V(c*(1-j))),z)),b(o,68,this.gridLit[0],this.gridLit[1],this.gridLit[2],this.colourLevel),b(o,72,this.gridShadowed[0],this.gridShadowed[1],this.gridShadowed[2],r>=le?1:0),n.writeBuffer(this.frameBuffer,0,o);const g=this.wallData;for(let c=0;c<i.walls.length;c++){const{wall:x,extend:N,drawEdge:F,catchesShadows:fe}=i.walls[c],W=c*H/4;g.set(N,W),g.set(F,W+4),b(g,W+8,x.center.x,x.center.y,x.center.z,fe?1:0),b(g,W+12,x.axisU.x,x.axisU.y,x.axisU.z,0),b(g,W+16,x.axisV.x,x.axisV.y,x.axisV.z,0)}n.writeBuffer(this.wallBuffer,0,g),r>0&&i.tableOnGpu?(n.writeBuffer(this.numberBuffer,0,a.ballNumbers,0,r*K),n.writeBuffer(this.orderBuffer,0,this.drawOrder,0,r)):r>0&&n.writeBuffer(this.ballBuffer,0,this.ballTable,0,r*$*4);const v=a.trailSeconds>0?this.sendTrails(t,r,a.trailTime??0,a.trailSeconds):0;if(a.copper&&a.backdrop==="kefrens"){const c=this.kefrensRows(h,w,J(a));this.kefrensBuffer.size<c*8&&(this.kefrensBuffer.destroy(),this.kefrensBuffer=s.createBuffer({size:c*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()),n.writeBuffer(this.kefrensBuffer,0,this.kefrensData,0,c*2)}this.configure();const _=this.linearCanvas,M=this.context.getCurrentTexture().createView(),X=_?M:this.target.sceneView,T=this.measureGpu&&this.timer?this.timer.start():null,R=this.skipParts??ke,S=!R.has("backdrop")&&this.drawPicture(a,_?this.context.getCurrentTexture():this.target.scene,T),C=s.createCommandEncoder();if(this.buildShadowGrid(C,r,i.showShadows,T,i.tableOnGpu),a.copper&&a.backdrop==="kefrens"&&!R.has("backdrop")){const c=C.beginComputePass({timestampWrites:T?T.writes("backdrop"):void 0});c.setBindGroup(0,this.kefrensGroup),c.setPipeline(this.kefrensColumnsPipeline),c.dispatchWorkgroups(Math.ceil(h/64)),c.end()}const D=(c,x)=>C.beginRenderPass({...x,timestampWrites:T?T.writes(c):void 0}),P=v>0,f=D("scene",{colorAttachments:[{view:X,loadOp:S?"load":"clear",storeOp:"store",clearValue:[...pe.map(V),1]}],depthStencilAttachment:{view:this.target.frontDepthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});if(f.setBindGroup(0,this.sharedGroup),f.setBindGroup(1,this.frontGroup),f.setBindGroup(2,this.wallGroup,[0]),r>0&&!R.has("balls")&&(f.setPipeline(P?this.ballDepthInPassPipeline:this.ballCoreInPassPipeline),f.draw(ae,r)),!R.has("backdrop")){if(a.copper&&(a.backdrop??"bars")==="bars")f.setPipeline(this.copperRowsPipeline),f.draw(4,w);else if(a.copper&&!S){const c=Z.indexOf(a.backdrop);f.setPipeline([this.starsPipeline,this.plasmaPipeline,this.kefrensPipeline][c-1]),f.draw(3)}}if(i.showShadows&&l.y>i.floorY&&!R.has("floor")&&(f.setPipeline(this.floorPipeline),f.draw(4)),i.showGrid&&!R.has("walls")&&(f.setPipeline(this.wallPipeline),i.walls.forEach((c,x)=>{c.shown&&(f.setBindGroup(2,this.wallGroup,[x*H]),f.draw(4))})),r>0&&!R.has("balls")&&(f.setPipeline(this.earlyDepth?this.ballPipeline:this.ballLatePipeline),f.draw(ae,r)),v>0&&!R.has("trails")&&(this.trail.written>0&&(f.setPipeline(this.trailPipeline),f.draw(4,Math.min(this.trail.written,this.trail.room))),f.setPipeline(this.trailHeadPipeline),f.draw(4,r)),_&&k&&!R.has("scroller")&&(f.setPipeline(this.textPipeline),f.draw(4)),f.end(),!_){const c=D("copy",{colorAttachments:[{view:M,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,1]}]});c.setPipeline(this.presentPipeline),c.setBindGroup(0,this.sharedGroup),c.setBindGroup(1,this.presentGroup),c.draw(3),c.end()}T?.finish(C),n.submit([C.finish()]),T?.read((c,x)=>{this.gpuTotalMs+=x,this.gpuFrames++;const N=this.gpuParts??={};for(const F in c)N[F]=(N[F]??0)+c[F]}),this.drewDirect=_,this.shownOnce||(this.shownOnce=!0,this.view.style.opacity="0")}trailRoomGrown(){}growTrailRing(e){const t=this.trail;t.room=e,t.written=0,t.owner=new Int32Array(e).fill(-1),t.generation=new Int32Array(e),t.index=new Float64Array(e),t.sentGeneration.fill(-1),this.trailRingBuffer?.destroy(),this.trailRingBuffer=this.device.createBuffer({size:e*A*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.makePresentGroup()}sendTrails(e,t,a,i){const r=this.trail,l=this.device.queue,s=this.colourLevel;let n=0,h=0,w=r.written;const o=()=>{if(h===0)return;const d=w%r.room,u=Math.min(h,r.room-d);l.writeBuffer(this.trailRingBuffer,d*A*4,r.staging,0,u*A),h>u&&l.writeBuffer(this.trailRingBuffer,0,r.staging,u*A,(h-u)*A),w+=h,h=0},B=d=>{const u=r.owner[d];if(u<0||u>=t)return!1;const p=e[u];return r.generation[d]===p.trailGeneration&&r.index[d]>=p.trailBase};for(let d=0;d<t;d++){const u=e[d],p=u.trail,k=u.trailBase,y=p.length/4,z=y-(u.trailHead?1:0);r.sentGeneration[d]!==u.trailGeneration&&(r.sentGeneration[d]=u.trailGeneration,r.sentUpTo[d]=k);const G=k+z-1;for(let S=Math.max(r.sentUpTo[d],k);S<G;S++){const C=(w+h)%r.room;if(B(C)&&r.room<se)return this.growTrailRing(Math.min(se,r.room*2)),this.sendTrails(e,t,a,i);h*A>=r.staging.length&&(o(),r.staging.length<65536*A&&(r.staging=new Float32Array(r.staging.length*2)));const D=(S-k)*4,P=h*A,f=r.staging;f[P]=p[D],f[P+1]=p[D+1],f[P+2]=p[D+2],f[P+3]=p[D+3],f[P+4]=p[D+4],f[P+5]=p[D+5],f[P+6]=p[D+6],f[P+7]=p[D+7],f[P+8]=d,f[P+9]=u.trailGeneration,f[P+10]=S,f[P+11]=0;const c=(w+h)%r.room;r.owner[c]=d,r.generation[c]=u.trailGeneration,r.index[c]=S,h++,r.written++}r.sentUpTo[d]=Math.max(r.sentUpTo[d],G);const g=d*q,v=r.balls,[_,M,X]=ve(u.color,s),T=y>0?Math.max(i,Math.abs(a-p[3])):i;v[g]=_,v[g+1]=M,v[g+2]=X,v[g+3]=T,v[g+4]=u.trailGeneration,v[g+5]=k,v[g+6]=a;const R=u.trailHead&&z>=1;if(v[g+7]=me(T,i)*(R?1:-1),R){const S=(z-1)*4,C=u.position;v[g+8]=p[S],v[g+9]=p[S+1],v[g+10]=p[S+2],v[g+11]=p[S+3],v[g+12]=C.x,v[g+13]=C.y,v[g+14]=C.z,v[g+15]=p[p.length-1]}y>1&&n++}return o(),t>0&&l.writeBuffer(this.trailBallBuffer,0,r.balls,0,t*q),n}shadowListGrown(){}buildShadowGrid(e,t,a,i,r){const l=a&&t>0;if(l||e.clearBuffer(this.cellBuffer),!l&&!(r&&t>0))return;l&&e.clearBuffer(this.countBuffer);const s=e.beginComputePass({timestampWrites:i?i.writes("shadows"):void 0});if(r&&t>0&&(s.setBindGroup(0,this.tableGroup),s.setPipeline(this.tablePipeline),s.dispatchWorkgroups(Math.ceil(t/64))),!l){s.end();return}s.setBindGroup(0,this.gridGroup),s.setPipeline(this.countPipeline),s.dispatchWorkgroups(t),s.setPipeline(this.sumBlocksPipeline),s.dispatchWorkgroups(L/256),s.setPipeline(this.sumOverBlocksPipeline),s.dispatchWorkgroups(1),s.setPipeline(this.startListsPipeline),s.dispatchWorkgroups(L/256),s.setPipeline(this.fillPipeline),s.dispatchWorkgroups(t),t>=le&&(s.setPipeline(this.sortPipeline),s.dispatchWorkgroups(L/64)),s.end()}}const U=["backdrop","shadows","scene","copy"];class Se{constructor(e){this.device=e,this.querySet=e.createQuerySet({type:"timestamp",count:2*U.length}),this.resolved=e.createBuffer({size:16*U.length,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),this.free=[],this.made=0}start(){let e=this.free.pop();if(!e&&this.made<4&&(this.made++,e=this.device.createBuffer({size:16*U.length,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})),!e)return null;const t=new Set,{querySet:a,resolved:i,free:r}=this;return{writes(l){const s=U.indexOf(l);return t.add(s),{querySet:a,beginningOfPassWriteIndex:2*s,endOfPassWriteIndex:2*s+1}},finish(l){l.resolveQuerySet(a,0,2*U.length,i,0),l.copyBufferToBuffer(i,0,e,0,16*U.length)},read(l){e.mapAsync(GPUMapMode.READ).then(()=>{const s=new BigInt64Array(e.getMappedRange()),n=[...t].sort((d,u)=>d-u),h={},w=s[2*n[0]];let o=w;for(const d of n){const u=s[2*d+1];h[U[d]]=Math.max(0,Number(u-o)/1e6),u>o&&(o=u)}const B=Math.max(0,Number(o-w)/1e6);e.unmap(),r.push(e),l(h,B)},()=>{})}}}}function Re(m,e){e.set(m,0);for(let t=0;t<4;t++)e[t*4+2]=.5*m[t*4+2]+.5*m[t*4+3]}function Ge(m,e,t){const a=(n,h)=>m.createTexture({size:[e,t],format:n,usage:h}),i=GPUTextureUsage.RENDER_ATTACHMENT,r=GPUTextureUsage.TEXTURE_BINDING,l=a(O,i|r),s=a(ie,i);return{width:e,height:t,scene:l,sceneView:l.createView(),frontDepthView:s.createView(),dispose(){l.destroy(),s.destroy()}}}function Te(m){const e=GPUShaderStage.VERTEX,t=GPUShaderStage.FRAGMENT,a=m.createBindGroupLayout({entries:[{binding:0,visibility:e|t,buffer:{type:"uniform"}},{binding:1,visibility:e|t,buffer:{type:"read-only-storage"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:3,visibility:t,buffer:{type:"read-only-storage"}}]}),i=m.createBindGroupLayout({entries:[{binding:2,visibility:t,buffer:{type:"read-only-storage"}},{binding:4,visibility:e,buffer:{type:"read-only-storage"}},{binding:5,visibility:e,buffer:{type:"read-only-storage"}},{binding:6,visibility:t,buffer:{type:"read-only-storage"}},{binding:7,visibility:t,texture:{sampleType:"float"}}]}),r=m.createBindGroupLayout({entries:[{binding:0,visibility:e|t,buffer:{type:"uniform",hasDynamicOffset:!0}}]}),l=m.createBindGroupLayout({entries:[{binding:1,visibility:t,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:t,buffer:{type:"read-only-storage"}}]}),s=GPUShaderStage.COMPUTE,n=m.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{type:"uniform"}},{binding:1,visibility:s,buffer:{type:"read-only-storage"}},...[2,3,4,5].map(B=>({binding:B,visibility:s,buffer:{type:"storage"}}))]}),h=m.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{type:"uniform"}},{binding:1,visibility:s,buffer:{type:"read-only-storage"}},{binding:2,visibility:s,buffer:{type:"read-only-storage"}},{binding:3,visibility:s,buffer:{type:"storage"}}]}),w=m.createBindGroupLayout({entries:[{binding:0,visibility:s,buffer:{type:"uniform"}},{binding:1,visibility:s,buffer:{type:"read-only-storage"}},{binding:2,visibility:s,storageTexture:{access:"write-only",format:O}}]}),o=B=>m.createPipelineLayout({bindGroupLayouts:B});return{kefrens:w,kefrensPipeline:o([w]),shared:a,letters:i,wall:r,presentInputs:l,grid:n,gridPipelines:o([n]),table:h,tablePipeline:o([h]),front:o([a]),scene:o([a,i,r]),present:o([a,l])}}const Y=`
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
}
`,Ce=`
${Y}
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
@group(1) @binding(7) var picture: texture_2d<f32>;
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
let cell = clamp(vec2i(floor((seen / (2.0 * frame.shadowRange) + 0.5) * ${I}.0)),
vec2i(0), vec2i(${I} - 1));
var shadow = 0.0;
let cellEntry = shadowCells[cell.y * ${I} + cell.x];
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
@fragment fn wallFs(s: WallPoint) -> @location(0) vec4f {
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
${Q(ye)}
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
return ${we} * (1.0 - pow(min(1.0, abs(now - time) / look.w), power));
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
fn kefrensRow(i: i32) -> vec2f { return kefrensRows[i]; }
${Q(xe,{time:"frame.time",height:"frame.height",width:"frame.viewport.x"})}
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
fn scrollerWord(i: u32) -> u32 { return scrollerText[i]; }
${Q(Pe,{scroll:"frame.scroll",scrollText:"frame.scrollText",textRect:"frame.textRect",height:"frame.height",textGlow:"frame.textGlow"})}
@fragment fn presentFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
let read = textureLoad(scene, vec2i(at.xy), 0).rgb;
var linear = select(max(read, vec3f(0.0)), read, frame.wide > 1.5);
let letter = scrollerColor(at.xy);
linear = mix(linear, letter.rgb, letter.a);
var color = toScreen(min(linear, vec3f(1.0)));
if (frame.hdrRange > 0.0) {
let bright = 1.055 * pow(min(linear, vec3f(frame.hdrRange)), vec3f(1.0 / 2.4)) - 0.055;
color = select(color, bright, linear > vec3f(1.0));
}
return vec4f(color, 1.0);
}
`,De=`
${Y}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> ballData: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> cells: array<u32>;
@group(0) @binding(3) var<storage, read_write> lists: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> blocks: array<u32>;
const GRID = ${I};
const LIST_ROOM = ${re}u;
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
fn nearness(v: vec4f) -> f32 { return dot(v.xyz - frame.lightPosition, frame.lightForward) - v.w; }
@compute @workgroup_size(64)
fn sortLists(@builtin(global_invocation_id) id: vec3u) {
if (id.x >= ${L}u) { return; }
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
`,ze=`
${Y}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> kefrensRows: array<vec2f>;
@group(0) @binding(2) var picture: texture_storage_2d<${O}, write>;
fn backdropColor(i: f32) -> vec3f {
let wide = frame.wide > 0.5;
let wider = frame.wide > 1.5;
if (i < 0.5) { return select(select(vec3f(0.769, 0.008, 0.200), vec3f( 0.8242, -0.1608, 0.1756), wide), vec3f( 0.9059, -0.2723, 0.1406), wider); }
if (i < 1.5) { return select(select(vec3f(1.000, 0.827, 0.000), vec3f( 1.0176, 0.8609, -0.3058), wide), vec3f( 1.0212, 0.8716, -0.3339), wider); }
if (i < 2.5) { return select(select(vec3f(0.000, 0.529, 0.741), vec3f(-0.2504, 0.5236, 0.7784), wide), vec3f(-0.4457, 0.5113, 0.8618), wider); }
return select(select(vec3f(0.000, 0.624, 0.420), vec3f(-0.3157, 0.6472, 0.3911), wide), vec3f(-0.5210, 0.6906, 0.3214), wider);
}
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
`,Ae=`
${Y}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> numbers: array<f32>;
@group(0) @binding(2) var<storage, read> order: array<u32>;
@group(0) @binding(3) var<storage, read_write> table: array<vec4f>;
@compute @workgroup_size(64)
fn makeBallTable(@builtin(global_invocation_id) id: vec3u) {
let i = id.x;
if (i >= frame.ballCount) { return; }
let a = i * ${K}u;
let x = numbers[a + 3u]; let y = numbers[a + 4u]; let z = numbers[a + 5u]; let w = numbers[a + 6u];
let color = u32(numbers[a + 8u]);
let row = i * ${$}u;
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
`;export{oe as GpuRenderer,ce as HDR_RANGE};
