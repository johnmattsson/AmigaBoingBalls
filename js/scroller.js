const _=" ... A TRIBUTE TO THE DEMO THAT INTRODUCED THE AMIGA IN JANUARY 1984 ... GREETINGS TO DALE LUCK AND R. J. MICAL WHO WROTE THE ORIGINAL ... AND A VERY SPECIAL GREETING TO MY UNCLE ANDREAS ABELSSON, ALIAS KING GRUB, WHO INTRODUCED ME TO THE AMIGA ... AND THANKS TO MY BROTHER AND MY SIX CHILDREN, WHO ALWAYS THOUGHT MY DEMOS WERE COOL ... AND TO MY WONDERFUL WIFE, FOR HER LOVE AND ENDLESS PATIENCE ... EVERY BALL IS A PERFECT SPHERE, NOT A SINGLE TRIANGLE IN SIGHT ... EVERY BOUNCE IS WORKED OUT EXACTLY AND IS REVERSIBLE: RUN TIME BACKWARDS AND EVERY COLLISION UNDOES ITSELF ... ENERGY, MOMENTUM AND ANGULAR MOMENTUM ARE CONSERVED ... CLICK A BALL TO GIVE IT A PUSH ...          ",O=130,N=4,L=440,v=36,G=340,$=5,U=2,W=4,D=600,R={A:["..#####..",".#######.","###...###","###...###","###...###","#########","#########","###...###","###...###","###...###"],B:["#######..","########.","###...###","###...###","########.","########.","###...###","###...###","########.","#######.."],C:["..######.",".########","###...###","###......","###......","###......","###......","###...###",".########","..######."],D:["#######..","########.","###...###","###...###","###...###","###...###","###...###","###...###","########.","#######.."],E:["#########","#########","###......","###......","#######..","#######..","###......","###......","#########","#########"],F:["#########","#########","###......","###......","#######..","#######..","###......","###......","###......","###......"],G:["..######.",".########","###...###","###......","###......","###.#####","###.#####","###...###",".########","..######."],H:["###...###","###...###","###...###","###...###","#########","#########","###...###","###...###","###...###","###...###"],I:[".#######.",".#######.","...###...","...###...","...###...","...###...","...###...","...###...",".#######.",".#######."],J:["....#####","....#####","......###","......###","......###","......###","###...###","###...###",".#######.","..#####.."],K:["###...###","###..###.","###.###..","######...","#####....","#####....","######...","###.###..","###..###.","###...###"],L:["###......","###......","###......","###......","###......","###......","###......","###......","#########","#########"],M:["###...###","####.####","#########","#########","###.#.###","###...###","###...###","###...###","###...###","###...###"],N:["###...###","####..###","#####.###","#########","#########","###.#####","###..####","###...###","###...###","###...###"],O:["..#####..",".#######.","###...###","###...###","###...###","###...###","###...###","###...###",".#######.","..#####.."],P:["#######..","########.","###...###","###...###","########.","#######..","###......","###......","###......","###......"],Q:["..#####..",".#######.","###...###","###...###","###...###","###...###","###.#.###","###..###.",".#######.","..###.###"],R:["#######..","########.","###...###","###...###","########.","#######..","###.###..","###..###.","###...###","###...###"],S:["..######.",".########","###...###","###......",".######..","..######.","......###","###...###","########.",".######.."],T:["#########","#########","...###...","...###...","...###...","...###...","...###...","...###...","...###...","...###..."],U:["###...###","###...###","###...###","###...###","###...###","###...###","###...###","###...###",".#######.","..#####.."],V:["###...###","###...###","###...###","###...###","###...###","###...###",".###.###.",".###.###.","..#####..","...###..."],W:["###...###","###...###","###...###","###...###","###...###","###.#.###","#########","#########","####.####","###...###"],X:["###...###","###...###",".###.###.","..#####..","...###...","...###...","..#####..",".###.###.","###...###","###...###"],Y:["###...###","###...###","###...###",".###.###.","..#####..","...###...","...###...","...###...","...###...","...###..."],Z:["#########","#########",".....####","....####.","...####..","..####...",".####....","####.....","#########","#########"],0:["..#####..",".#######.","###...###","###..####","###.#####","#####.###","####..###","###...###",".#######.","..#####.."],1:["...###...","..####...",".#####...","...###...","...###...","...###...","...###...","...###...",".#######.",".#######."],2:["..#####..",".#######.","###...###","......###",".....###.","...####..","..###....",".###.....","#########","#########"],3:[".######..","########.","......###","......###","..#####..","..#####..","......###","......###","########.",".######.."],4:["....####.","...#####.","..######.",".###.###.","###..###.","#########","#########",".....###.",".....###.",".....###."],5:["#########","#########","###......","###......","#######..","########.","......###","###...###",".#######.","..#####.."],6:["..#####..",".#######.","###......","###......","#######..","########.","###...###","###...###",".#######.","..#####.."],7:["#########","#########","......###",".....###.","....###..","...###...","...###...","..###....","..###....","..###...."],8:["..#####..",".#######.","###...###","###...###",".#######.",".#######.","###...###","###...###",".#######.","..#####.."],9:["..#####..",".#######.","###...###","###...###",".########","..#######","......###","......###",".#######.","..#####.."],".":[".........",".........",".........",".........",".........",".........",".........","...###...","...###...","...###..."],",":[".........",".........",".........",".........",".........",".........","...###...","...###...","...###...","..###...."],"!":["...###...","...###...","...###...","...###...","...###...","...###...",".........","...###...","...###...","...###..."],"-":[".........",".........",".........",".........",".#######.",".#######.",".........",".........",".........","........."],"'":["...###...","...###...","...###...","..###....",".........",".........",".........",".........",".........","........."],"\u1E9E":["..#####..",".#######.","###...###","###..###.","###.###..","###.####.","###...###","###...###","###.####.","###.###.."],":":[".........",".........","...###...","...###...","...###...",".........","...###...","...###...","...###...","........."]},T=10,h=9,d=h+2,A=d*4,u=T*4,f=[[255,255,255],[255,255,136],[255,221,0],[255,136,0],[255,34,0]],p=[120,20,0],I=.45,w=.6,m=[20,10,40],x=[0,0,51],o=c=>Number.isInteger(c)?c.toFixed(1):String(c),r=c=>`vec3f(${c.map(e=>(e/255).toFixed(4)).join(", ")})`,y=`
const S_HEIGHT: f32 = ${o(130)}; const S_SQUARE: f32 = ${o(4)}; const S_STRIP: f32 = ${o(2)};
const S_WAVE_HEIGHT: f32 = ${o(36)}; const S_WAVE_LENGTH: f32 = ${o(340)}; const S_SHADOW: f32 = ${o(4)};
const S_LETTER_WIDTH: f32 = ${o(A)}; const S_LETTER_HEIGHT: f32 = ${o(u)};
const S_ROWS: i32 = ${T}; const S_COLS: i32 = ${h};
const S_TURN: f32 = 6.2831853;
fn scrollerRow(letter: u32, row: i32) -> u32 {
if (row < 0 || row >= S_ROWS) { return 0u; }
return scrollerWord(letter * u32(S_ROWS) + u32(row));
}
fn filled(bits: u32, column: i32) -> bool {
return column >= 0 && column < S_COLS && ((bits >> u32(S_COLS - 1 - column)) & 1u) == 1u;
}
fn letterRamp(t: f32) -> vec3f {
let at: f32 = t * 4.0;
var color: vec3f = mix(${r(f[0])}, ${r(f[1])}, clamp(at, 0.0, 1.0));
color = mix(color, ${r(f[2])}, clamp(at - 1.0, 0.0, 1.0));
color = mix(color, ${r(f[3])}, clamp(at - 2.0, 0.0, 1.0));
return mix(color, ${r(f[4])}, clamp(at - 3.0, 0.0, 1.0));
}
fn scrollerPaint(x0: f32, y0: f32, offset: f32, zoom: f32) -> vec4f {
let x: f32 = x0 - offset;
let strip: f32 = floor(x / S_STRIP) * S_STRIP;
if (strip < 0.0 || strip >= $scroll.z) { return vec4f(0.0); }
let inText: f32 = strip + $scroll.x - $scroll.z;
if (inText < 0.0 || inText >= $scroll.w) { return vec4f(0.0); }
let index: u32 = u32(inText / S_LETTER_WIDTH);
let letter: u32 = scrollerWord(u32($scrollText.y) + index);
if (letter == 255u) { return vec4f(0.0); }
let wave: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5
+ S_WAVE_HEIGHT * sin(strip / S_WAVE_LENGTH * S_TURN + $scroll.y);
let top: f32 = round(wave * zoom) / zoom + offset;
let column: i32 = i32(floor((inText - f32(index) * S_LETTER_WIDTH + (x - strip)) / S_SQUARE)) - 1;
let row: i32 = i32(floor((y0 - top) / S_SQUARE));
if (column < -1 || column > S_COLS || row < -1 || row > S_ROWS) { return vec4f(0.0); }
let here: u32 = scrollerRow(letter, row);
if (offset > 0.0) { return vec4f(0.0, 0.0, 0.0, select(0.0, 2.0, filled(here, column))); }
let above: u32 = scrollerRow(letter, row - 1);
let below: u32 = scrollerRow(letter, row + 1);
if (filled(here, column)) {
var color: vec3f = letterRamp(f32(row) / f32(S_ROWS - 1));
if (!filled(below, column) || !filled(here, column + 1)) {
color = mix(color, ${r(p)}, ${o(I)});
} else if (!filled(above, column) || !filled(here, column - 1)) {
color = mix(color, vec3f(1.0), ${o(w)});
}
return vec4f(color, 2.0);
}
let close: bool = filled(here, column - 1) || filled(here, column + 1)
|| filled(above, column - 1) || filled(above, column) || filled(above, column + 1)
|| filled(below, column - 1) || filled(below, column) || filled(below, column + 1);
return vec4f(${r(m)}, select(0.0, 1.0, close));
}
fn scrollerColor(place: vec2f) -> vec4f {
let fromBottom: f32 = $height - place.y;
if ($textRect.z <= 0.0 || place.x < $textRect.x || place.x >= $textRect.x + $textRect.z
|| fromBottom < $textRect.y || fromBottom >= $textRect.y + $textRect.w) {
return vec4f(0.0);
}
let hard: bool = $scrollText.z > 0.5;
let zoom: f32 = select($textRect.w / S_HEIGHT, max(1.0, round(S_SQUARE * $textRect.w / S_HEIGHT)) / S_SQUARE, hard);
let x: f32 = (place.x - $textRect.x) / zoom;
let y: f32 = ($textRect.y + $textRect.w - fromBottom) / zoom;
let middle: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5;
if (y < middle - S_WAVE_HEIGHT - S_SQUARE - 2.0 || y > middle + S_WAVE_HEIGHT + S_LETTER_HEIGHT + S_SQUARE + S_SHADOW + 2.0) {
return vec4f(0.0);
}
let reach: f32 = select(0.5, 0.001, hard) / zoom;
let shift: f32 = $scroll.x - $scroll.z;
var ink: f32 = 0.0; var inked: vec3f = vec3f(0.0); var rim: f32 = 0.0; var shadowed: f32 = 0.0;
for (var layer: i32 = 0; layer < 2; layer++) {
let offset: f32 = f32(layer) * S_SHADOW;
var left: f32 = x - reach - offset;
let right: f32 = x + reach - offset;
for (var across: i32 = 0; across < 6; across++) {
if (left >= right) { break; }
let nextStrip: f32 = (floor(left / S_STRIP) + 1.0) * S_STRIP;
let nextColumn: f32 = (floor((left + shift) / S_SQUARE) + 1.0) * S_SQUARE - shift;
let end: f32 = min(right, min(nextStrip, nextColumn));
let wide: f32 = end - left;
let mid: f32 = (left + end) * 0.5;
let strip: f32 = floor(mid / S_STRIP) * S_STRIP;
let wave: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5
+ S_WAVE_HEIGHT * sin(strip / S_WAVE_LENGTH * S_TURN + $scroll.y);
let top: f32 = round(wave * zoom) / zoom + offset;
var upper: f32 = y - reach;
let lower: f32 = y + reach;
for (var down: i32 = 0; down < 4; down++) {
if (upper >= lower) { break; }
let bottom: f32 = min(lower, top + (floor((upper - top) / S_SQUARE) + 1.0) * S_SQUARE);
let share: f32 = wide * (bottom - upper);
let paint: vec4f = scrollerPaint(mid + offset, (upper + bottom) * 0.5, offset, zoom);
if (layer == 0) {
if (paint.w > 1.5) { ink += share; inked += paint.rgb * share; } else if (paint.w > 0.5) { rim += share; }
} else {
shadowed += paint.w * 0.5 * share;
}
upper = bottom;
}
left = end;
}
}
let whole: f32 = 4.0 * reach * reach;
let lettered: vec3f = toCanvas(inked / max(ink, 1e-9)) * (1.0 + $textGlow);
ink /= whole; rim /= whole; shadowed /= whole;
let covered: f32 = min(ink + rim, 1.0);
let alpha: f32 = covered + shadowed * (1.0 - covered);
if (alpha <= 0.0) { return vec4f(0.0); }
return vec4f((lettered * ink + toCanvas(${r(m)}) * rim
+ toCanvas(${r(x)}) * shadowed * (1.0 - covered)) / alpha, alpha);
}
`;class C{constructor(){this.strip=document.createElement("div"),this.strip.className="scroller",this.strip.style.display="none",document.body.append(this.strip),this.shown=!1,this.rate=1,this.clock=0;const e=document.getElementById("info")?.textContent??"";this.message=(e+_).replaceAll("\xDF","\u1E9E").toUpperCase();const s=Object.keys(R);this.letterNumbers=Uint32Array.from([...this.message],l=>{const t=s.indexOf(l);return t<0?255:t}),this.glyphRows=Uint32Array.from(s.flatMap(l=>R[l].map(t=>[...t].reduce((E,n)=>E*2+(n==="#"?1:0),0))))}get words(){const e=new Uint32Array(this.glyphRows.length+this.letterNumbers.length);return e.set(this.glyphRows,0),e.set(this.letterNumbers,this.glyphRows.length),e}layout(e=this.bigPixel??0){this.bigPixel=e;const s=innerWidth<600?.6:1,l=Math.max(1,Math.round(4*s/e)),t=e>0?`${Math.round(130/4*l)*e}px`:`${130*s}px`;this.strip.style.height!==t&&(this.strip.style.height=t)}place(e,s=!1){const l=s?Math.max(1,Math.round(4*e[3]/130))/4:e[3]/130,t=e[2]/l,E=this.message.length*A,n=E+t;let S=(this.clock*440%n+n)%n;s&&(S=Math.floor(S*l)/l);const a=2*Math.PI,H=(this.clock*5%a+a)%a,i=this.placed??=new Float32Array(4);return i[0]=S,i[1]=H,i[2]=t,i[3]=E,i}setShown(e){e!==this.shown&&(this.shown=e,this.strip.style.display=e?"":"none",e||(this.clock=0))}tick(e){this.shown&&(this.clock+=e*this.rate,this.layout())}}export{O as HEIGHT,y as SCROLLER_SHADER,W as SHADOW,C as Scroller};
