const i={f32:"float",i32:"int",u32:"uint",bool:"bool",vec2f:"vec2",vec3f:"vec3",vec4f:"vec4",vec2i:"ivec2",vec3i:"ivec3",mat2x2f:"mat2",mat3x3f:"mat3",mat4x4f:"mat4"},p={select:"mix",atan2:"atan",dpdx:"dFdx",dpdy:"dFdy",inverseSqrt:"inversesqrt"},v=(n,r)=>n.replace(/\$(\w+)/g,(o,t)=>{if(!(t in r))throw new Error(`shade.js: no name given for $${t}`);return r[t]});function w(n,r={}){return v(n,r)}function b(n,r={}){const o=e=>{if(!(e in i))throw new Error(`shade.js: no type "${e}" in the notation`);return i[e]};let t=v(n,r);if(t=t.replace(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+)\s*)?\{/g,(e,s,f,c)=>{const u=f.split(",").map(a=>a.trim()).filter(Boolean).map(a=>{const[,l,x]=a.match(/^(\w+)\s*:\s*(\w+)$/)??[];if(!l)throw new Error(`shade.js: "${a}" in ${s}(...) is no "name: type"`);return`${o(x)} ${l}`});return`${c?o(c):"void"} ${s}(${u.join(", ")}) {`}),t=t.replace(/\b(let|var|const)\s+(\w+)\s*:\s*(\w+)/g,(e,s,f,c)=>`${s==="const"?"const ":""}${o(c)} ${f}`),/\b(let|var)\s+\w+\s*=/.test(t))throw new Error("shade.js: a let or var without its type");return t=t.replace(/\b(\w+)(?=\s*\()/g,e=>i[e]??p[e]??e),t}const d=`
  fn zigzag(x: f32) -> f32 { return 2.0 * abs(fract(x * 0.5) - 0.5); }
  fn squareWave(x: f32, blur0: f32) -> f32 {
    let blur: f32 = max(blur0, 1e-4);
    return (zigzag(x - 0.5 * blur) - zigzag(x + 0.5 * blur)) / blur;
  }`,$=`
  fn toLinear(c: vec3f) -> vec3f {
    let a: vec3f = abs(c);
    return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), a));
  }
  fn toScreen(c: vec3f) -> vec3f {
    let a: vec3f = abs(c);
    return sign(c) * mix(a * 12.92, 1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), a));
  }`,g=`
  fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }`;export{$ as COLOR_CURVES,g as MODULO,d as SQUARE_WAVE,b as toGlsl,w as toWgsl};
