const u=12845619,R=40811,x=34749,b=16765696,g=[12845619,40811,34749,16765696],c=[12845619,16765696,34749,40811],l=new Map([[12845619,[.8242,-.1608,.1756]],[16765696,[1.0176,.8609,-.3058]],[34749,[-.2504,.5236,.7784]],[40811,[-.3157,.6472,.3911]]]),m=new Map([[12845619,[.9059,-.2723,.1406]],[16765696,[1.0212,.8716,-.3339]],[34749,[-.4457,.5113,.8618]],[40811,[-.521,.6906,.3214]]]);function i(t){return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}function p(t,o){return(o===2?m:o?l:null)?.get(t)||i(t)}const f=[[.822462,.177538,0],[.0331942,.9668058,0],[.0170826,.0723974,.9105199]],M=t=>c.indexOf(t&16777215);function $(t,o){if(!o)return{css:`rgb(${t>>16&255}, ${t>>8&255}, ${t&255})`,rgb:[t>>16&255,t>>8&255,t&255]};const r=n=>Math.sign(n)*(Math.abs(n)<=.04045?Math.abs(n)/12.92:((Math.abs(n)+.055)/1.055)**2.4),e=n=>n<=.0031308?12.92*n:1.055*n**(1/2.4)-.055,a=p(t,1).map(r),s=f.map(n=>e(Math.min(1,Math.max(0,n[0]*a[0]+n[1]*a[1]+n[2]*a[2]))));return{css:`color(display-p3 ${s.map(n=>n.toFixed(4)).join(" ")})`,rgb:s.map(n=>Math.round(255*n))}}function d(t){const o=[0,1,2].map(r=>f.map(e=>e[r]===0?"0.0":e[r].toFixed(7)).join(", "));return`${t==="glsl"?"mat3":"mat3x3f"}(${o.join(", ")})`}function E(t,o,r){const e=o?p(t,o):i(t).map(s=>Number(s.toFixed(3))),a=s=>Number.isInteger(s)?s.toFixed(1):String(s);return`${r==="glsl"?"vec3":"vec3f"}(${e.map(a).join(", ")})`}const N=(t,o,r)=>t.map(e=>E(e,o,r)).join(", "),L=t=>`
      if (wide > 1.5) { return ${E(t,2,"wgsl")}; }
      if (wide > 0.5) { return ${E(t,1,"wgsl")}; }
      return ${E(t,0,"wgsl")};`,O=`
  fn elementaryColor(i: f32, wide: f32) -> vec3f {
${c.slice(0,3).map((t,o)=>`    if (i < ${o+.5}) {${L(t)}
    }`).join(`
`)}${L(c[3])}
  }
`;export{g as BALL_COLORS,x as BLUE,O as ELEMENTARY_COLOR_MATHS,m as ELEMENTARY_IN_2020,l as ELEMENTARY_IN_P3,R as GREEN,u as RED,f as SRGB_TO_P3,b as YELLOW,p as ballRgb,$ as canvasColor,N as colorList,M as elementaryIndex,i as hexToRgb,d as srgbToP3Matrix};
