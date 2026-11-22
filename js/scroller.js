const m=" ... A TRIBUTE TO THE DEMO THAT INTRODUCED THE AMIGA IN JANUARY 1984 ... GREETINGS TO DALE LUCK AND R. J. MICAL WHO WROTE THE ORIGINAL ... AND A VERY SPECIAL GREETING TO MY UNCLE ANDREAS ABELSSON, ALIAS KING GRUB, WHO INTRODUCED ME TO THE AMIGA ... AND THANKS TO MY BROTHER AND MY SIX CHILDREN, WHO ALWAYS THOUGHT MY DEMOS WERE COOL ... AND TO MY WONDERFUL WIFE, FOR HER LOVE AND ENDLESS PATIENCE ... EVERY BALL IS A PERFECT SPHERE, NOT A SINGLE TRIANGLE IN SIGHT ... EVERY BOUNCE IS WORKED OUT EXACTLY AND IS REVERSIBLE: RUN TIME BACKWARDS AND EVERY COLLISION UNDOES ITSELF ... ENERGY, MOMENTUM AND ANGULAR MOMENTUM ARE CONSERVED ... CLICK A BALL TO GIVE IT A PUSH ...          ",O=130,w=4,N=440,L=36,x=340,v=5,G=2,W=4,$=600,S={A:["..#####..",".#######.","###...###","###...###","###...###","#########","#########","###...###","###...###","###...###"],B:["#######..","########.","###...###","###...###","########.","########.","###...###","###...###","########.","#######.."],C:["..######.",".########","###...###","###......","###......","###......","###......","###...###",".########","..######."],D:["#######..","########.","###...###","###...###","###...###","###...###","###...###","###...###","########.","#######.."],E:["#########","#########","###......","###......","#######..","#######..","###......","###......","#########","#########"],F:["#########","#########","###......","###......","#######..","#######..","###......","###......","###......","###......"],G:["..######.",".########","###...###","###......","###......","###.#####","###.#####","###...###",".########","..######."],H:["###...###","###...###","###...###","###...###","#########","#########","###...###","###...###","###...###","###...###"],I:[".#######.",".#######.","...###...","...###...","...###...","...###...","...###...","...###...",".#######.",".#######."],J:["....#####","....#####","......###","......###","......###","......###","###...###","###...###",".#######.","..#####.."],K:["###...###","###..###.","###.###..","######...","#####....","#####....","######...","###.###..","###..###.","###...###"],L:["###......","###......","###......","###......","###......","###......","###......","###......","#########","#########"],M:["###...###","####.####","#########","#########","###.#.###","###...###","###...###","###...###","###...###","###...###"],N:["###...###","####..###","#####.###","#########","#########","###.#####","###..####","###...###","###...###","###...###"],O:["..#####..",".#######.","###...###","###...###","###...###","###...###","###...###","###...###",".#######.","..#####.."],P:["#######..","########.","###...###","###...###","########.","#######..","###......","###......","###......","###......"],Q:["..#####..",".#######.","###...###","###...###","###...###","###...###","###.#.###","###..###.",".#######.","..###.###"],R:["#######..","########.","###...###","###...###","########.","#######..","###.###..","###..###.","###...###","###...###"],S:["..######.",".########","###...###","###......",".######..","..######.","......###","###...###","########.",".######.."],T:["#########","#########","...###...","...###...","...###...","...###...","...###...","...###...","...###...","...###..."],U:["###...###","###...###","###...###","###...###","###...###","###...###","###...###","###...###",".#######.","..#####.."],V:["###...###","###...###","###...###","###...###","###...###","###...###",".###.###.",".###.###.","..#####..","...###..."],W:["###...###","###...###","###...###","###...###","###...###","###.#.###","#########","#########","####.####","###...###"],X:["###...###","###...###",".###.###.","..#####..","...###...","...###...","..#####..",".###.###.","###...###","###...###"],Y:["###...###","###...###","###...###",".###.###.","..#####..","...###...","...###...","...###...","...###...","...###..."],Z:["#########","#########",".....####","....####.","...####..","..####...",".####....","####.....","#########","#########"],0:["..#####..",".#######.","###...###","###..####","###.#####","#####.###","####..###","###...###",".#######.","..#####.."],1:["...###...","..####...",".#####...","...###...","...###...","...###...","...###...","...###...",".#######.",".#######."],2:["..#####..",".#######.","###...###","......###",".....###.","...####..","..###....",".###.....","#########","#########"],3:[".######..","########.","......###","......###","..#####..","..#####..","......###","......###","########.",".######.."],4:["....####.","...#####.","..######.",".###.###.","###..###.","#########","#########",".....###.",".....###.",".....###."],5:["#########","#########","###......","###......","#######..","########.","......###","###...###",".#######.","..#####.."],6:["..#####..",".#######.","###......","###......","#######..","########.","###...###","###...###",".#######.","..#####.."],7:["#########","#########","......###",".....###.","....###..","...###...","...###...","..###....","..###....","..###...."],8:["..#####..",".#######.","###...###","###...###",".#######.",".#######.","###...###","###...###",".#######.","..#####.."],9:["..#####..",".#######.","###...###","###...###",".########","..#######","......###","......###",".#######.","..#####.."],".":[".........",".........",".........",".........",".........",".........",".........","...###...","...###...","...###..."],",":[".........",".........",".........",".........",".........",".........","...###...","...###...","...###...","..###...."],"!":["...###...","...###...","...###...","...###...","...###...","...###...",".........","...###...","...###...","...###..."],"-":[".........",".........",".........",".........",".#######.",".#######.",".........",".........",".........","........."],"'":["...###...","...###...","...###...","..###....",".........",".........",".........",".........",".........","........."],"\u1E9E":["..#####..",".#######.","###...###","###..###.","###.###..","###.####.","###...###","###...###","###.####.","###.###.."],":":[".........",".........","...###...","...###...","...###...",".........","...###...","...###...","...###...","........."]},a=10,R=9,_=R+2,T=_*4,H=a*4,f=[[255,255,255],[255,255,136],[255,221,0],[255,136,0],[255,34,0]],d=[120,20,0],u=.45,p=.6,A=[20,10,40],I=[0,0,51],t=r=>Number.isInteger(r)?r.toFixed(1):String(r),o=r=>`vec3f(${r.map(e=>(e/255).toFixed(4)).join(", ")})`,U=`
const S_HEIGHT: f32 = ${t(130)}; const S_SQUARE: f32 = ${t(4)}; const S_STRIP: f32 = ${t(2)};
const S_WAVE_HEIGHT: f32 = ${t(36)}; const S_WAVE_LENGTH: f32 = ${t(340)}; const S_SHADOW: f32 = ${t(4)};
const S_LETTER_WIDTH: f32 = ${t(T)}; const S_LETTER_HEIGHT: f32 = ${t(H)};
const S_ROWS: i32 = ${a}; const S_COLS: i32 = ${R};
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
var color: vec3f = mix(${o(f[0])}, ${o(f[1])}, clamp(at, 0.0, 1.0));
color = mix(color, ${o(f[2])}, clamp(at - 1.0, 0.0, 1.0));
color = mix(color, ${o(f[3])}, clamp(at - 2.0, 0.0, 1.0));
return mix(color, ${o(f[4])}, clamp(at - 3.0, 0.0, 1.0));
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
color = mix(color, ${o(d)}, ${t(u)});
} else if (!filled(above, column) || !filled(here, column - 1)) {
color = mix(color, vec3f(1.0), ${t(p)});
}
return vec4f(color, 2.0);
}
let close: bool = filled(here, column - 1) || filled(here, column + 1)
|| filled(above, column - 1) || filled(above, column) || filled(above, column + 1)
|| filled(below, column - 1) || filled(below, column) || filled(below, column + 1);
return vec4f(${o(A)}, select(0.0, 1.0, close));
}
fn scrollerColor(place: vec2f) -> vec4f {
let fromBottom: f32 = $height - place.y;
if ($textRect.z <= 0.0 || place.x < $textRect.x || place.x >= $textRect.x + $textRect.z
|| fromBottom < $textRect.y || fromBottom >= $textRect.y + $textRect.w) {
return vec4f(0.0);
}
let zoom: f32 = $textRect.w / S_HEIGHT;
let x: f32 = (place.x - $textRect.x) / zoom;
let y: f32 = ($textRect.y + $textRect.w - fromBottom) / zoom;
let middle: f32 = (S_HEIGHT - S_LETTER_HEIGHT) * 0.5;
if (y < middle - S_WAVE_HEIGHT - S_SQUARE - 2.0 || y > middle + S_WAVE_HEIGHT + S_LETTER_HEIGHT + S_SQUARE + S_SHADOW + 2.0) {
return vec4f(0.0);
}
let reach: f32 = 0.5 / zoom;
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
return vec4f((lettered * ink + toCanvas(${o(A)}) * rim
+ toCanvas(${o(I)}) * shadowed * (1.0 - covered)) / alpha, alpha);
}
`;class D{constructor(){this.strip=document.createElement("div"),this.strip.className="scroller",this.strip.style.display="none",document.body.append(this.strip),this.shown=!1,this.rate=1,this.clock=0;const e=document.getElementById("info")?.textContent??"";this.message=(e+m).replaceAll("\xDF","\u1E9E").toUpperCase();const c=Object.keys(S);this.letterNumbers=Uint32Array.from([...this.message],s=>{const l=c.indexOf(s);return l<0?255:l}),this.glyphRows=Uint32Array.from(c.flatMap(s=>S[s].map(l=>[...l].reduce((E,i)=>E*2+(i==="#"?1:0),0))))}get words(){const e=new Uint32Array(this.glyphRows.length+this.letterNumbers.length);return e.set(this.glyphRows,0),e.set(this.letterNumbers,this.glyphRows.length),e}layout(){const e=`${130*(innerWidth<600?.6:1)}px`;this.strip.style.height!==e&&(this.strip.style.height=e)}place(e){const c=e*130,s=this.message.length*T,l=s+c,E=(this.clock*440%l+l)%l,i=2*Math.PI,h=(this.clock*5%i+i)%i,n=this.placed??=new Float32Array(4);return n[0]=E,n[1]=h,n[2]=c,n[3]=s,n}setShown(e){e!==this.shown&&(this.shown=e,this.strip.style.display=e?"":"none",e||(this.clock=0))}tick(e){this.shown&&(this.clock+=e*this.rate,this.layout())}}export{O as HEIGHT,U as SCROLLER_SHADER,W as SHADOW,D as Scroller};
