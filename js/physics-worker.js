import{PhysicsHost as o,transferables as a}from"./physics-host.js?v=2.04-119";const t=new o;self.onmessage=e=>{const s=t.handle(e.data);s&&self.postMessage(s,a(s))},self.postMessage({op:"ready"});
