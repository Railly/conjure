import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import { createWorld, spawn } from "dotframe/src/ecs";
import { createRenderer, type Renderer } from "dotframe/src/render";
import { box } from "dotframe/src/shapes";
import type { MeshData } from "dotframe/src/gltf";
import { vec3 } from "dotframe/src/math";
import type { World } from "dotframe/src/ecs";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["car", "flag", "palm", "cactus", "sun"];
const FPS = 60;

// ---------- Track (Catmull-Rom through desert control points) ----------
const CTRL = [[0,0],[0,-45],[18,-90],[42,-125],[36,-175],[2,-205],[-42,-225],[-62,-275],[-38,-325],[12,-350],[52,-385],[38,-435],[0,-475]].map(p=>[p[0]*1.7,p[1]*1.7]);
interface Samp { x:number; z:number; tx:number; tz:number; cum:number }
const SAMPLES: Samp[] = [];
{
  const P = CTRL;
  for (let i=0;i<P.length-1;i++){
    const p0=P[Math.max(0,i-1)], p1=P[i], p2=P[i+1], p3=P[Math.min(P.length-1,i+2)];
    for (let j=0;j<20;j++){
      const t=j/20, t2=t*t, t3=t2*t;
      const x=0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3);
      const z=0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
      SAMPLES.push({x,z,tx:0,tz:-1,cum:0});
    }
  }
  SAMPLES.push({x:P[P.length-1][0],z:P[P.length-1][1],tx:0,tz:-1,cum:0});
  let cum=0;
  for (let i=0;i<SAMPLES.length;i++){
    const a=SAMPLES[i], b=SAMPLES[Math.min(SAMPLES.length-1,i+1)], c=SAMPLES[Math.max(0,i-1)];
    let dx=b.x-c.x, dz=b.z-c.z; const l=Math.hypot(dx,dz)||1; a.tx=dx/l; a.tz=dz/l;
    if(i>0) cum+=Math.hypot(a.x-SAMPLES[i-1].x,a.z-SAMPLES[i-1].z);
    a.cum=cum;
  }
}
const TRACK_LEN = SAMPLES[SAMPLES.length-1].cum;
function posAt(s:number, lat:number){
  const sc=Math.max(0,Math.min(TRACK_LEN,s));
  let lo=0, hi=SAMPLES.length-1;
  while(lo<hi){ const m=(lo+hi)>>1; if(SAMPLES[m].cum<sc) lo=m+1; else hi=m; }
  const a=SAMPLES[Math.max(0,lo-1)], b=SAMPLES[lo];
  const span=(b.cum-a.cum)||1, t=Math.max(0,Math.min(1,(sc-a.cum)/span));
  const x=a.x+(b.x-a.x)*t, z=a.z+(b.z-a.z)*t;
  let tx=a.tx+(b.tx-a.tx)*t, tz=a.tz+(b.tz-a.tz)*t; const l=Math.hypot(tx,tz)||1; tx/=l; tz/=l;
  // lateral normal (right of travel)
  const nx=-tz, nz=tx;
  return { x:x+nx*lat, z:z+nz*lat, tx, tz, nx, nz, yaw:Math.atan2(tx,tz) };
}

// ---------- Object layout ----------
const SUN_DEF: {s:number;lat:number}[] = [];
for(let i=0;i<22;i++) SUN_DEF.push({s:TRACK_LEN*(0.04+i*0.043), lat:[-3,2.5,0,-2.5,3][i%5]});
const PALM_DEF: {s:number;side:number;shadeLat:number}[] = [];
for(let i=0;i<16;i++){ const side=i%2?1:-1; PALM_DEF.push({s:TRACK_LEN*(0.05+i*0.058), side, shadeLat:side*2.2}); }
const CACTUS_DEF: {s:number;lat:number}[] = [
  {s:TRACK_LEN*0.13,lat:5.6},{s:TRACK_LEN*0.24,lat:-5.6},{s:TRACK_LEN*0.36,lat:5.8},{s:TRACK_LEN*0.47,lat:-5.4},
  {s:TRACK_LEN*0.58,lat:5.6},{s:TRACK_LEN*0.69,lat:-5.8},{s:TRACK_LEN*0.80,lat:5.4},{s:TRACK_LEN*0.90,lat:-5.6}];
const CHECKS = [0.25,0.5,0.75];

interface Game {
  scene: Scene; sceneFrames:number; frame:number; prev:number; r:{s:number};
  s:number; lat:number; latVel:number; speed:number; steerVis:number;
  heat:number; energy:number; timeLeft:number; elapsed:number;
  spin:number; squashT:number; boosting:boolean; inShade:boolean; wasShade:boolean;
  suns:boolean[]; cactusCd:number[]; checks:boolean[]; splitTimer:number; splitText:string;
  finishedSplits:number; j:Juice;
}
const fresh=(seed:number,scene:Scene="title"):Game=>({
  scene,sceneFrames:0,frame:0,prev:0,r:rng(seed),
  s:2,lat:0,latVel:0,speed:0,steerVis:0, heat:10,energy:55,timeLeft:90*FPS,elapsed:0,
  spin:0,squashT:0,boosting:false,inShade:false,wasShade:false,
  suns:SUN_DEF.map(()=>false), cactusCd:CACTUS_DEF.map(()=>0), checks:CHECKS.map(()=>false),
  splitTimer:0,splitText:"",finishedSplits:0,j:juice(),
});

function step(g:Game, keys:number):void{
  const edge=pressed(keys,g.prev); g.prev=keys; g.frame++; juiceStep(g.j);
  if(sceneStep(g,edge)) Object.assign(g,fresh(g.r.s,"play"),{prev:keys});
  if(g.scene!=="play") return;
  g.elapsed++; if(g.splitTimer>0)g.splitTimer--;
  for(let i=0;i<g.cactusCd.length;i++) if(g.cactusCd[i]>0)g.cactusCd[i]--;
  if(g.squashT>0)g.squashT--;

  const steer=(keys&KEY.right?1:0)-(keys&KEY.left?1:0);
  const up=!!(keys&KEY.up), down=!!(keys&KEY.down);
  g.inShade=PALM_DEF.some(p=>Math.abs(g.s-p.s)<11 && Math.abs(g.lat-p.shadeLat)<4.9);
  if(g.inShade && !g.wasShade){ floatText(g.j,W/2,300,"ahhh~ COOL!","#7dd7ff"); burst(g.j,g.r,W/2,390,14,"#7dd7ff",3,5); }
  g.wasShade=g.inShade;

  // Heat / boost cooking
  const wantBoost=!!(keys&KEY.action) && g.energy>0 && g.spin<=0;
  g.boosting=wantBoost;
  const ramp=1+g.s/TRACK_LEN*0.55;
  if(wantBoost){
    g.energy=Math.max(0,g.energy-20/FPS);
    g.heat+=24*ramp/FPS;
    if(g.frame%3===0) burst(g.j,g.r,W/2+range(g.r,-30,30),452,2,"#ff8a2a",2.5,7);
    if(g.frame%5===0) burst(g.j,g.r,W/2+range(g.r,-24,24),452,1,"#ffd23f",2,5);
  } else {
    g.heat-= (g.inShade?2:6)/FPS*10*0.6; // ~6/s coast, faster below
    g.heat-= 3/FPS;
  }
  if(g.inShade) g.heat-=46/FPS;
  if(!wantBoost && !g.inShade) g.heat-=4/FPS;
  g.heat=Math.max(0,g.heat);

  if(g.spin>0){
    g.spin--; g.speed*=0.92;
  } else {
    // Grip fades when very hot; shade snaps it back
    const grip=g.inShade?1: g.heat>75?0.45: g.heat>55?0.75:1;
    g.latVel+=steer*0.055*grip*(g.speed>2?1:0.3);
    g.latVel*=0.86;
    const maxLat=10.5;
    g.lat+=g.latVel*Math.max(0.35,g.speed/16);
    if(g.lat>maxLat){g.lat=maxLat;g.latVel*=-0.3;} if(g.lat<-maxLat){g.lat=-maxLat;g.latVel*=-0.3;}
    const offroad=Math.abs(g.lat)>7.2;
    const targetMax=wantBoost?27: up?17.5:0;
    if(up||wantBoost){
      const accel=wantBoost?22:11;
      if(g.speed<targetMax) g.speed=Math.min(targetMax,g.speed+accel/FPS);
    } else g.speed*=0.985;
    if(down) g.speed=Math.max(0,g.speed-18/FPS);
    if(offroad) g.speed*=0.992;
    if(g.heat>=100){
      g.spin=85; g.heat=42; g.energy*=0.5; shake(g.j,16);
      floatText(g.j,W/2,220,"OVERHEATED! SPIN OUT!","#ff5a3c");
      burst(g.j,g.r,W/2,360,30,"#ff5a3c",6,8); burst(g.j,g.r,W/2,360,18,"#ffd23f",5,7);
    }
  }
  g.steerVis+= ((steer*0.45)-g.steerVis)*0.18;
  g.s+=g.speed/FPS;

  // Suns
  for(let i=0;i<SUN_DEF.length;i++){
    if(g.suns[i]) continue; const d=SUN_DEF[i];
    if(Math.abs(g.s-d.s)<2.4 && Math.abs(g.lat-d.lat)<2.2){
      g.suns[i]=true; g.energy=Math.min(100,g.energy+34);
      burst(g.j,g.r,W/2,330,20,"#ffd23f",5,7); burst(g.j,g.r,W/2,330,10,"#fff3a0",4,5);
      floatText(g.j,W/2,250,"+BOOST!","#ffd23f");
    }
  }
  // Cacti bumpers
  for(let i=0;i<CACTUS_DEF.length;i++){
    const d=CACTUS_DEF[i]; if(g.cactusCd[i]>0) continue;
    if(Math.abs(g.s-d.s)<2.0 && Math.abs(g.lat-d.lat)<1.7){
      g.cactusCd[i]=70; g.squashT=10; shake(g.j,9);
      g.latVel=(g.lat<d.lat?-1:1)*-0.0 + (d.lat>0?-0.55:0.55); // bounce toward centre / opposite side
      if(Math.abs(g.lat-d.lat)<0.2) g.latVel=d.lat>0?-0.55:0.55;
      g.speed=Math.min(29,g.speed+4.5);
      floatText(g.j,W/2,260,"BOING!","#7ee787"); burst(g.j,g.r,W/2,380,16,"#3fae4a",5,6);
    }
  }
  // Checkpoints
  for(let i=0;i<CHECKS.length;i++){
    if(!g.checks[i] && g.s>=TRACK_LEN*CHECKS[i]){
      g.checks[i]=true; g.finishedSplits++; g.timeLeft+=4*FPS;
      const secs=(g.elapsed/FPS).toFixed(1);
      g.splitText=`CHECKPOINT ${i+1}  ${secs}s  +4s TIME!`; g.splitTimer=150;
      for(let k=0;k<26;k++) burst(g.j,g.r,range(g.r,200,W-200),range(g.r,140,260),1,k%2?"#111111":"#ffffff",3,7);
      burst(g.j,g.r,W/2,220,22,"#ffffff",4,7); burst(g.j,g.r,W/2,220,22,"#111111",4,7);
      floatText(g.j,W/2,180,`FLAG ${i+1}! +4s`,"#ffffff");
    }
  }
  g.timeLeft--;
  if(g.s>=TRACK_LEN-3){ endRun(g,true); return; }
  if(g.timeLeft<=0){ endRun(g,false); return; }
}

// ---------- 3D meshes ----------
function quadMesh():MeshData{
  // Two faces (front/back), XY plane, UVs
  const positions=new Float32Array([-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0,  -0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0]);
  const normals=new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1, 0,0,-1,0,0,-1,0,0,-1,0,0,-1]);
  const uvs=new Float32Array([0,1,1,1,1,0,0,0, 1,1,0,1,0,0,1,0]);
  const indices=new Uint32Array([0,1,2,0,2,3, 4,6,5,4,7,6]);
  return {positions,normals,indices,uvs};
}
function carBoxMesh():MeshData{
  const b=box(); const uvs=new Float32Array(24*2);
  for(let f=0;f<6;f++){ const o=f*8; uvs[o]=0;uvs[o+1]=1;uvs[o+2]=1;uvs[o+3]=1;uvs[o+4]=1;uvs[o+5]=0;uvs[o+6]=0;uvs[o+7]=0; }
  return {positions:b.positions,normals:b.normals,indices:b.indices,uvs};
}

interface Ctx { renderer:Renderer; world:World; kart:number; wheels:number[]; sunE:number[]; palmE:number[]; cactusE:number[]; flagE:number[]; bannerE:number[] }
let ctx:Ctx|null=null;
let debug3d="not-built";
function buildCtx(platform:SimPlatform, sprites:Record<string,Sprite>):Ctx|null{
  if(!platform.gpu || platform.headless || (platform.gpu as any).canvas2d) { debug3d=`fallback headless=${platform.headless} gpu=${!!platform.gpu} canvas2d=${!!(platform.gpu as any)?.canvas2d}`; return null; }
  try{
    const renderer=createRenderer(platform.gpu);
    const boxM=renderer.addMesh(box()); const quadM=renderer.addMesh(quadMesh()); const carM=renderer.addMesh(carBoxMesh());
    const world=createWorld();
    const add=(px:number,py:number,pz:number,ry:number,sx:number,sy:number,sz:number,mesh:number,col:[number,number,number],tex?:any,cut=0,rx=0,rz=0)=>{
      const e=spawn(world); world.transforms.set(e,{position:vec3(px,py,pz),rotation:vec3(rx,ry,rz),scale:vec3(sx,sy,sz)});
      world.meshes.set(e,{mesh,color:vec3(col[0],col[1],col[2]),texture:tex,alphaCutoff:cut}); return e;
    };
    // ground
    add(0,-0.4,-650,0,500,0.5,1500,boxM,[0.92,0.76,0.52]);
    // mesas / dunes: two-tiered plateaus sunk into the ground so they read as rock, not cards
    let seed=12345; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;};
    for(let i=0;i<26;i++){ const x=(rnd()-0.5)*260, z=-rnd()*1250+40; if(Math.abs(x)<28) continue;
      const w=18+rnd()*30, h=5+rnd()*7, d=14+rnd()*20;
      const c:[number,number,number]= i%3?[0.82,0.55,0.34]:[0.88,0.66,0.42];
      const top:[number,number,number]=[Math.min(1,c[0]+0.10),Math.min(1,c[1]+0.08),Math.min(1,c[2]+0.05)];
      add(x,h/2-0.3,z,rnd()*0.8,w,h,d,boxM,c);
      add(x,h+0.6,z,rnd()*0.8,w*0.72,1.6,d*0.72,boxM,top); }
    // road segments
    for(let i=0;i<SAMPLES.length-4;i+=4){
      const a=SAMPLES[i], b=SAMPLES[i+4]; const mx=(a.x+b.x)/2,mz=(a.z+b.z)/2; const len=Math.hypot(b.x-a.x,b.z-a.z)+1.2; const yaw=Math.atan2(b.x-a.x,b.z-a.z);
      add(mx,0.02,mz,yaw,14,0.18,len,boxM,[0.98,0.84,0.58]);
      // curbs
      const idx=Math.floor(i/4);
      const cCol:[number,number,number]= idx%2? [0.9,0.2,0.15]:[1,1,1];
      const nx=b.z-a.z, nz=-(b.x-a.x); const nl=Math.hypot(nx,nz)||1;
      add(mx+nx/nl*7.4,0.08,mz+nz/nl*7.4,yaw,0.9,0.22,len,boxM,cCol);
      add(mx-nx/nl*7.4,0.08,mz-nz/nl*7.4,yaw,0.9,0.22,len,boxM,cCol);
    }
    // palm shade shadows (dark slabs on road)
    const palmE:number[]=[];
    for(const p of PALM_DEF){
      const shade=posAt(p.s,p.shadeLat); add(shade.x,0.14,shade.z,shade.yaw,9,0.06,24,boxM,[0.45,0.38,0.28]);
      const pos=posAt(p.s,p.side*11.5); palmE.push(add(pos.x,4.8,pos.z,pos.yaw,9,9.6,1,quadM,[1,1,1],sprites.palm?.tex,0.45));
    }
    const cactusE:number[]=[];
    for(const c of CACTUS_DEF){ const pos=posAt(c.s,c.lat); cactusE.push(add(pos.x,1.7,pos.z,pos.yaw,3.4,3.4,1,quadM,[1,1,1],sprites.cactus?.tex,0.45)); }
    const sunE:number[]=[];
    for(const s of SUN_DEF){ const pos=posAt(s.s,s.lat); sunE.push(add(pos.x,2.0,pos.z,pos.yaw,2.6,2.6,1,quadM,[1,1,1],sprites.sun?.tex,0.45)); }
    // flag arches + finish
    const flagE:number[]=[], bannerE:number[]=[];
    const arch=(frac:number,scale:number)=>{
      const s=TRACK_LEN*frac; const L=posAt(s,-8.5), R=posAt(s,8.5), C=posAt(s,0);
      add(L.x,3.5,L.z,L.yaw,0.5,7,0.5,boxM,[0.1,0.1,0.1]); add(R.x,3.5,R.z,R.yaw,0.5,7,0.5,boxM,[0.1,0.1,0.1]);
      flagE.push(add(L.x,6.2,L.z,L.yaw,5*scale,4*scale,1,quadM,[1,1,1],sprites.flag?.tex,0.4));
      flagE.push(add(R.x,6.2,R.z,R.yaw,5*scale,4*scale,1,quadM,[1,1,1],sprites.flag?.tex,0.4));
      bannerE.push(add(C.x,7.6,C.z,C.yaw,17,3.2,1,quadM,[1,1,1],sprites.flag?.tex,0.4));
      // finish/check line
      for(let k=-3;k<4;k++){ const p=posAt(s,k*1.8); add(p.x,0.16,p.z,p.yaw,1.7,0.08,2.2,boxM, (k%2===0)?[0.05,0.05,0.05]:[1,1,1]); }
    };
    CHECKS.forEach(f=>arch(f,1)); arch(1,1.5); arch(0.001,1.2);
    // kart + wheels
    const kart=add(0,1,0,0,2.6,1.15,3.4,carM,[1,1,1],sprites.car?.tex,0);
    const wheels:number[]=[];
    for(let i=0;i<4;i++) wheels.push(add(0,0.35,0,0,0.55,0.7,0.55,boxM,[0.08,0.08,0.1]));
    debug3d="ok";
    return {renderer,world,kart,wheels,sunE,palmE,cactusE,flagE,bannerE};
  }catch(e){ debug3d="fail:"+String(e); console.error("buildCtx failed", e); return null; }
}

function render(g:Game, draw:any, s:Record<string,Sprite>):void{
  const kartPos=posAt(g.s,g.lat);
  // Update 3D world from state (presentation only)
  if(ctx){
    const spinA=g.spin>0 ? (85-g.spin)*0.35 : 0;
    const sq=g.squashT>0?0.35:0;
    const t=ctx.world.transforms.get(ctx.kart)!;
    t.position=vec3(kartPos.x,0.95,kartPos.z); t.rotation=vec3(0,kartPos.yaw+g.steerVis*0.6+spinA,g.steerVis*0.12);
    t.scale=vec3(2.6*(1+sq*0.5),1.15*(1-sq),3.4);
    const fwdx=kartPos.tx, fwdz=kartPos.tz, rx=kartPos.nx, rz=kartPos.nz;
    ctx.wheels.forEach((e,i)=>{
      const side=i%2?1:-1, front=i<2?1:-1; const wt=ctx!.world.transforms.get(e)!;
      wt.position=vec3(kartPos.x+rx*side*1.25+fwdx*front*1.25,0.35,kartPos.z+rz*side*1.25+fwdz*front*1.25);
      wt.rotation=vec3(g.frame* g.speed*0.04, kartPos.yaw+g.steerVis,0);
    });
    ctx.sunE.forEach((e,i)=>{ const tr=ctx!.world.transforms.get(e)!; const sc=g.suns[i]?0:2.6+dsin(g.frame*0.08+i)*0.25; tr.scale=vec3(sc,sc,1); tr.rotation=vec3(0,kartPos.yaw,dsin(g.frame*0.06+i*1.3)*0.25); const d=SUN_DEF[i]; const p=posAt(d.s,d.lat); tr.position=vec3(p.x,2+dsin(g.frame*0.07+i)*0.3,p.z); });
    ctx.cactusE.forEach((e,i)=>{ const tr=ctx!.world.transforms.get(e)!; const wob=g.cactusCd[i]>40? dsin(g.frame*0.7)*0.25:0; tr.rotation=vec3(0,posAt(CACTUS_DEF[i].s,CACTUS_DEF[i].lat).yaw,wob); });
    ctx.palmE.forEach((e,i)=>{ const tr=ctx!.world.transforms.get(e)!; tr.rotation=vec3(0,tr.rotation.y,dsin(g.frame*0.03+i*1.7)*0.06); });
    ctx.flagE.forEach((e,i)=>{ const tr=ctx!.world.transforms.get(e)!; tr.rotation=vec3(0,tr.rotation.y,dsin(g.frame*0.18+i*1.4)*0.28); });
    ctx.bannerE.forEach((e,i)=>{ const tr=ctx!.world.transforms.get(e)!; tr.rotation=vec3(dsin(g.frame*0.12+i)*0.08,tr.rotation.y,0); });
    const sh=shakeOffset(g.j,g.frame);
    const camX=kartPos.x-kartPos.tx*11+sh.x*0.08, camZ=kartPos.z-kartPos.tz*11;
    const eye=vec3(camX,5.2+sh.y*0.05,camZ);
    const target=vec3(kartPos.x+kartPos.tx*9,1.6,kartPos.z+kartPos.tz*9);
    const env:any={ ambient:vec3(0.55,0.5,0.45), sun:{direction:vec3(0.4,0.8,0.35),color:vec3(1.2,1.05,0.85),shadows:60},
      fog:{color:vec3(0.98,0.85,0.62),density:0.0035}, time:g.frame/60,
      sky:{zenith:vec3(0.55,0.75,0.95),horizon:vec3(1,0.88,0.66),ground:vec3(0.9,0.7,0.45),sun:{direction:vec3(0.4,0.55,0.3),color:vec3(1,0.85,0.45),size:0.12}} };
    draw.scene(ctx.renderer.draws(ctx.world,{eye,target,fovY:1.05,near:0.1,far:900},env));
  } else {
    // Pseudo-3D desert view for Canvas2D fallback (same track, objects and kart, projected)
    sky(draw,W,H,[140,195,235],[255,226,170]);
    if(s.sun) drawSprite(draw,s.sun,842,74,92,{rot:dsin(g.frame*0.03)*0.1});
    draw.setFillStyle("#d9a05f"); draw.fillRect(0,238,W,302);
    draw.setFillStyle("#c98d4e");
    for(let i=0;i<7;i++){ const x=((i*173+g.s*2)% (W+220))-110; draw.beginPath(); draw.arc(x,252,90+(i%3)*36,Math.PI,0,false); draw.fill(); }
    // Distant mesas: rounded plateaus with sunlit caps + tiny drawing billboards, never bare rectangles
    const mesa=(cx:number,baseY:number,hw:number,hh:number,side:string,cap:string)=>{
      draw.setFillStyle(side);
      draw.beginPath();
      draw.moveTo(cx-hw,baseY);
      draw.lineTo(cx-hw+16,baseY-hh);
      draw.lineTo(cx+hw-16,baseY-hh);
      draw.lineTo(cx+hw,baseY);
      draw.closePath(); draw.fill();
      draw.setFillStyle(cap);
      draw.beginPath(); draw.ellipse(cx,baseY-hh,hw-16,14,0,0,Math.PI*2,false); draw.fill();
      draw.setFillStyle("rgba(255,240,210,0.5)");
      draw.beginPath(); draw.ellipse(cx-10,baseY-hh-2,(hw-16)*0.55,6,0,0,Math.PI*2,false); draw.fill();
    };
    mesa(120+g.s*0.15%40,246,105,52,"#b9773d","#d99a55");
    mesa(855-g.s*0.1%30,238,125,62,"#a86a35","#cf8f4c");
    mesa(620+g.s*0.06%20,244,75,34,"#c07f42","#e0a55e");
    // tiny distant drawing cards on the ridge so the horizon carries art, not blanks
    if(s.cactus) drawSprite(draw,s.cactus,300,232,44,{rot:dsin(g.frame*0.04)*0.06});
    if(s.palm) drawSprite(draw,s.palm,688,226,58,{rot:dsin(g.frame*0.04+2)*0.07});
    const base=posAt(g.s,g.lat);
    const proj=(wx:number,wz:number,wy:number)=>{
      const dx=wx-base.x, dz=wz-base.z; const fwd=dx*base.tx+dz*base.tz; const right=dx*base.nx+dz*base.nz;
      const f=Math.max(1.2,fwd); const sc=380/f;
      return { x:W/2+right*sc, y:268+950/f, sc, fwd };
    };
    const quad=(pts:any[],col:string,alpha=1)=>{ draw.setGlobalAlpha(alpha); draw.setFillStyle(col); draw.beginPath(); draw.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) draw.lineTo(pts[i].x,pts[i].y); draw.closePath(); draw.fill(); draw.setGlobalAlpha(1); };
    // Road strips far-to-near every ~4m
    for(let d=118; d>=0; d-=4){
      const a1=posAt(g.s+d,-7), a2=posAt(g.s+d,7), b1=posAt(g.s+d+4,-7), b2=posAt(g.s+d+4,7);
      const p=[proj(a1.x,a1.z,0),proj(a2.x,a2.z,0),proj(b2.x,b2.z,0),proj(b1.x,b1.z,0)];
      quad(p, Math.floor(d/4)%2? "#f4cf8d":"#eec27f");
      const c1=posAt(g.s+d,-7.6),c2=posAt(g.s+d,-6.9),c3=posAt(g.s+d+4,-6.9),c4=posAt(g.s+d+4,-7.6);
      quad([proj(c1.x,c1.z,0),proj(c2.x,c2.z,0),proj(c3.x,c3.z,0),proj(c4.x,c4.z,0)], Math.floor(d/4)%2?"#e33":"#fff");
      const e1=posAt(g.s+d,7.6),e2=posAt(g.s+d,6.9),e3=posAt(g.s+d+4,6.9),e4=posAt(g.s+d+4,7.6);
      quad([proj(e1.x,e1.z,0),proj(e2.x,e2.z,0),proj(e3.x,e3.z,0),proj(e4.x,e4.z,0)], Math.floor(d/4)%2?"#fff":"#e33");
      // shade slabs
      for(const pm of PALM_DEF){ if(Math.abs((g.s+d)-pm.s)<10){ const s1=posAt(g.s+d,pm.shadeLat-4.5),s2=posAt(g.s+d,pm.shadeLat+4.5),s3=posAt(g.s+d+4,pm.shadeLat+4.5),s4=posAt(g.s+d+4,pm.shadeLat-4.5); quad([proj(s1.x,s1.z,0),proj(s2.x,s2.z,0),proj(s3.x,s3.z,0),proj(s4.x,s4.z,0)],"#5a4632",0.42); } }
    }
    // Objects far-to-near
    type Obj={fwd:number;kind:string;i:number;lat:number;s:number};
    const objs:Obj[]=[];
    SUN_DEF.forEach((d,i)=>{ if(!g.suns[i]) objs.push({fwd:d.s-g.s,kind:"sun",i,lat:d.lat,s:d.s}); });
    PALM_DEF.forEach((d,i)=>objs.push({fwd:d.s-g.s,kind:"palm",i,lat:d.side*11.5,s:d.s}));
    CACTUS_DEF.forEach((d,i)=>objs.push({fwd:d.s-g.s,kind:"cactus",i,lat:d.lat,s:d.s}));
    CHECKS.forEach((c,i)=>objs.push({fwd:TRACK_LEN*c-g.s,kind:"flag",i,lat:0,s:TRACK_LEN*c}));
    objs.push({fwd:TRACK_LEN-g.s,kind:"flag",i:9,lat:0,s:TRACK_LEN});
    objs.filter(o=>o.fwd>3&&o.fwd<120).sort((a,b)=>b.fwd-a.fwd).forEach(o=>{
      const wp=posAt(o.s,o.lat); const p=proj(wp.x,wp.z,0); const worldH=o.kind==="palm"?9.5:o.kind==="flag"?7:o.kind==="sun"?2.6:3.4;
      const hh=Math.max(14,Math.min(360,worldH*p.sc));
      if(o.kind==="palm"&&s.palm) drawSprite(draw,s.palm,p.x,p.y-hh/2,hh,{rot:dsin(g.frame*0.03+o.i)*0.05});
      else if(o.kind==="cactus"&&s.cactus) drawSprite(draw,s.cactus,p.x,p.y-hh/2,hh*0.85,{rot:g.cactusCd[o.i]>40?dsin(g.frame*0.6)*0.2:0});
      else if(o.kind==="sun"&&s.sun) drawSprite(draw,s.sun,p.x,p.y-hh/2,hh,{rot:dsin(g.frame*0.08+o.i)*0.35});
      else if(o.kind==="flag"&&s.flag){
        const wl=posAt(o.s,-8.5), wr=posAt(o.s,8.5); const pl=proj(wl.x,wl.z,0), pr=proj(wr.x,wr.z,0);
        drawSprite(draw,s.flag,pl.x,pl.y-hh/2,hh,{rot:dsin(g.frame*0.15+o.i)*0.2});
        drawSprite(draw,s.flag,pr.x,pr.y-hh/2,hh,{rot:-dsin(g.frame*0.15+o.i)*0.2});
        drawSprite(draw,s.flag,p.x,p.y-hh,hh*0.55,{});
        text(draw,o.i===9?"FINISH":"CHECKPOINT",p.x,p.y-hh*1.25,Math.max(12,hh*0.16),"#111","center");
      }
    });
    // Kart (player drawing) low chase view
    if(s.car){
      const sq=g.squashT>0?0.35:0; const spinR=g.spin>0?(85-g.spin)*0.3:0;
      draw.setGlobalAlpha(0.25); draw.setFillStyle("#7a4a20"); draw.beginPath(); draw.arc(W/2+g.steerVis*30,472,110,0,Math.PI*2,false); draw.fill(); draw.setGlobalAlpha(1);
      drawSprite(draw,s.car,W/2+g.steerVis*36,428,168,{rot:g.steerVis*0.35+spinR,sx:1+sq*0.45,sy:1-sq});
    }
  }
  // Red wobble vignette when hot
  if(g.scene==="play" && g.heat>70){
    draw.setGlobalAlpha((g.heat-70)/30*0.28); draw.setFillStyle("#ff2a00"); draw.fillRect(0,0,W,14); draw.fillRect(0,H-14,W,14); draw.fillRect(0,0,14,H); draw.fillRect(W-14,0,14,H); draw.setGlobalAlpha(1);
  }
  drawJuice(draw,g.j);

  if(g.scene==="play"){
    // Top-left timer + progress
    panel(draw,14,12,330,86,"rgba(60,30,0,0.55)");
    const secs=Math.max(0,g.timeLeft/FPS);
    text(draw,`TIME ${secs.toFixed(1)}`,28,38,26, secs<12?"#ff7a6a":"#ffd23f");
    text(draw,`SPEED ${Math.round(g.speed*3.6)}`,28,70,18,"#ffffff");
    text(draw,g.inShade?"IN SHADE - COOLING!":"",180,70,16,"#7dd7ff");
    // progress bar
    draw.setFillStyle("rgba(0,0,0,0.5)"); draw.fillRect(360,22,360,18);
    draw.setFillStyle("#ffd23f"); draw.fillRect(362,24,356*Math.min(1,g.s/TRACK_LEN),14);
    CHECKS.forEach((c,i)=>{ draw.setFillStyle(g.checks[i]?"#7ee787":"#fff"); draw.fillRect(360+360*c-2,18,4,26); });
    draw.setFillStyle("#fff"); draw.fillRect(716,16,4,30);
    text(draw,"FINISH",724,31,14,"#ffffff");
    // Boost energy bar
    panel(draw,14,H-64,300,48,"rgba(60,30,0,0.55)");
    text(draw,"BOOST",24,H-40,18,"#ff9a3c");
    draw.setFillStyle("#3a2000"); draw.fillRect(110,H-52,190,20);
    draw.setFillStyle("#ff8a2a"); draw.fillRect(112,H-50,186*g.energy/100,16);
    // Heat sun gauge (player drawing, red overlay grows)
    if(s.sun){
      const hx=862,hy=92;
      drawSprite(draw,s.sun,hx,hy,118,{rot:dsin(g.frame*0.04)*0.08});
      draw.setGlobalAlpha(g.heat/100*0.45); draw.setFillStyle("#ff2200"); draw.beginPath(); draw.arc(hx,hy,52*g.heat/100+8,0,Math.PI*2,false); draw.fill(); draw.setGlobalAlpha(1);
      draw.setFillStyle("rgba(0,0,0,0.55)"); draw.fillRect(hx-62,hy+58,124,16);
      draw.setFillStyle(g.heat>75?"#ff3b1f":g.heat>45?"#ff8a2a":"#ffd23f"); draw.fillRect(hx-60,hy+60,120*g.heat/100,12);
      text(draw,"HEAT",hx,hy+92,16,"#ffffff","center");
      if(g.heat>55){ draw.setFillStyle("#7dd7ff"); for(let i=0;i<3;i++){ draw.beginPath(); draw.arc(hx-30+i*28,hy-58+dsin(g.frame*0.2+i)*3,4,0,Math.PI*2,false); draw.fill(); } }
      if(g.boosting) text(draw,"BOOSTING!",hx,hy+112,15,"#ff8a2a","center");
    }
    if(g.splitTimer>0){ panel(draw,W/2-230,118,460,48,"rgba(0,0,0,0.6)"); text(draw,g.splitText,W/2,142,22,"#ffd23f","center"); }
    text(draw,"WASD drive  •  SPACE boost  •  seek palm shade!",W/2,H-18,15,"#fff","center");
  }

  // Overlays (custom, English, exact win/lose lines)
  if(g.scene!=="play"){
    draw.setFillStyle(g.scene==="title"?"rgba(40,15,0,0.28)":"rgba(20,0,0,0.55)"); draw.fillRect(0,0,W,H);
    if(g.scene==="title"){
      if(s.flag) drawSprite(draw,s.flag,W/2,120,190,{rot:dsin(g.frame*0.06)*0.12,sx:1+dsin(g.frame*0.09)*0.06});
      const bob=dsin(g.frame*0.05)*7;
      text(draw,"SUNBURN SPEEDWAY",W/2,238+bob,66,"#ffd23f","center","bangers");
      text(draw,"Grab suns, burn boost, surf palm shade — don't cook!",W/2,300,20,"#ffffff","center");
      text(draw,"WASD / arrows to drive  •  hold SPACE to boost",W/2,338,18,"#ffe9b0","center");
      text(draw,"Cacti bounce you faster. Shade cools your heat!",W/2,368,18,"#bfefff","center");
      if(Math.floor(g.frame/28)%2===0) text(draw,"Press ENTER to race!",W/2,430,30,"#ffffff","center","bangers");
    } else if(g.scene==="won"){
      if(s.flag) drawSprite(draw,s.flag,W/2,150,180,{rot:dsin(g.frame*0.08)*0.15});
      text(draw,"YOU WIN! Desert champion!",W/2,280,44,"#ffd23f","center","bangers");
      text(draw,`Time: ${(g.elapsed/FPS).toFixed(1)}s   Checkpoints: ${g.finishedSplits}/3`,W/2,340,22,"#ffffff","center");
      if(Math.floor(g.frame/28)%2===0) text(draw,"Press ENTER to race again!",W/2,420,26,"#ffffff","center");
    } else {
      if(s.sun) drawSprite(draw,s.sun,W/2,150,170,{rot:dsin(g.frame*0.05)*0.1});
      text(draw,"OUT OF TIME! The sun wins this one.",W/2,280,38,"#ff8a6a","center","bangers");
      text(draw,`You reached ${Math.round(g.s/TRACK_LEN*100)}% of the lap`,W/2,340,22,"#ffffff","center");
      if(Math.floor(g.frame/28)%2===0) text(draw,"Press ENTER to race again!",W/2,420,26,"#ffffff","center");
    }
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players:1, window:{width:W,height:H,title:"Sunburn Speedway"}, clear:{r:0.98,g:0.85,b:0.62}, options:{}, neutral:0, encode:encodeKeys, random:randomKeys,
  create:(platform:SimPlatform):SimRun=>{
    let g=fresh(1); let sprites:Record<string,Sprite>={};
    const ready=loadKit(platform,NAMES).then((sp)=>{ sprites=sp; ctx=buildCtx(platform,sp); });
    return {
      ready,
      start:(seed)=>{ g=fresh(seed); },
      step:(inputs)=>step(g,inputs[0]??0),
      checksum:()=>{ let h=(g.frame*31+Math.round(g.s*10)*7+Math.round(g.lat*100)+Math.round(g.heat*10)+Math.round(g.energy*10)+g.timeLeft)>>>0; for(const v of g.suns) h=(Math.imul(h,16777619)^(v?1:0))>>>0; return h>>>0; },
      state:()=>({outcome:outcomeOf(g.scene),progress:Math.max(0,Math.min(1,g.s/TRACK_LEN)),scene:g.scene,debug3d,speed:Math.round(g.speed),heat:Math.round(g.heat),energy:Math.round(g.energy),timeLeft:+(Math.max(0,g.timeLeft/FPS)).toFixed(1),checkpoints:g.finishedSplits,inShade:g.inShade}),
      over:()=>false,
      save:()=>structuredClone(g),
      restore:(saved)=>{ g={...fresh(1),...structuredClone(saved as Game)}; },
      inspect:()=>g,
      render:(draw)=>render(g,draw as any,sprites),
    };
  },
});
