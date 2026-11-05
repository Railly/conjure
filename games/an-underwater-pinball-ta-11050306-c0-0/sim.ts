import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960; const H = 540;
const NAMES = ["octopus","starfish","shell","map","bubbles"];
const LEFT=200, RIGHT=760, TOP=46;
const POCKET={x:480,y:82,r:30};

interface Star{ x:number;y:number;homeX:number;homeY:number;lit:boolean;spin:number;spinV:number;flash:number;crawl:number }
interface Game{
 scene:Scene;sceneFrames:number;frame:number;prev:number;r:{s:number};
 bx:number;by:number;vx:number;vy:number; launched:boolean; charge:number; charging:boolean; boost:boolean;
 lives:number; lit:number; stars:Star[]; j:Juice; flipL:number; flipR:number; flipLV:number; flipRV:number;
 combo:number; comboT:number; squash:number; eyeSquash:number; trailT:number; score:number; time:number;
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

function makeStars():Star[]{
 const pts:[number,number][]=[[315,155],[408,185],[552,185],[645,155],[352,268],[480,242],[608,268],[480,345]];
 return pts.map(([x,y])=>({x,y,homeX:x,homeY:y,lit:false,spin:0,spinV:0,flash:0,crawl:0}));
}
const fresh=(seed:number,scene:Scene="title"):Game=>({
 scene,sceneFrames:0,frame:0,prev:0,r:rng(seed),
 bx:700,by:455,vx:0,vy:0,launched:false,charge:0,charging:false,boost:true,
 lives:3,lit:0,stars:makeStars(),j:juice(),flipL:0,flipR:0,flipLV:0,flipRV:0,
 combo:0,comboT:0,squash:0,eyeSquash:0,trailT:0,score:0,time:0,
});

function segCollide(g:Game,x1:number,y1:number,x2:number,y2:number,rest:number,kickX=0,kickY=0):boolean{
 const dx=x2-x1, dy=y2-y1; const len2=dx*dx+dy*dy||1;
 let t=((g.bx-x1)*dx+(g.by-y1)*dy)/len2; t=Math.max(0,Math.min(1,t));
 const cx=x1+dx*t, cy=y1+dy*t; let nx=g.bx-cx, ny=g.by-cy; const d=Math.hypot(nx,ny); const R=17;
 if(d>=R||d===0) return false;
 nx/=d; ny/=d; g.bx=cx+nx*R; g.by=cy+ny*R;
 const vn=g.vx*nx+g.vy*ny;
 if(vn<0){ g.vx-=(1+rest)*vn*nx; g.vy-=(1+rest)*vn*ny; g.vx+=kickX; g.vy+=kickY; g.squash=4; return true;}
 return false;
}

function step(g:Game,keys:number):void{
 const edge=pressed(keys,g.prev); g.prev=keys; g.frame++; juiceStep(g.j);
 if(sceneStep(g,edge)) Object.assign(g,fresh(g.r.s,"play"),{prev:keys});
 if(g.scene!=="play") return;
 g.time++;
 // flippers targets
 const lDown=(keys&KEY.left)!==0, rDown=(keys&KEY.right)!==0;
 const prevL=g.flipL, prevR=g.flipR;
 g.flipL += ((lDown?1:0)-g.flipL)*0.45; g.flipR += ((rDown?1:0)-g.flipR)*0.45;
 g.flipLV=(g.flipL-prevL); g.flipRV=(g.flipR-prevR);
 if(edge&KEY.left) { /* swing sound via particles later */ }
 if(g.comboT>0){g.comboT--; if(g.comboT===0) g.combo=0;}
 if(g.squash>0)g.squash--; if(g.eyeSquash>0)g.eyeSquash--;
 for(const s of g.stars){ s.spin+=s.spinV; s.spinV*=0.92; if(s.flash>0)s.flash--; }

 // Launch / boost
 if(!g.launched){
   g.bx=700; g.by=455 - Math.abs(dsin(g.frame*0.08))*4; g.vx=0; g.vy=0;
   if(keys&KEY.action){ g.charging=true; g.charge=Math.min(1,g.charge+0.025); }
   else if(g.charging){
     const p=13+g.charge*5.5;
     g.launched=true; g.charging=false; g.vy=-p; g.vx=-1.2-g.charge*1.5; g.boost=true;
     burst(g.j,g.r,g.bx,g.by+10,16,"#7ef4ff",3,5); floatText(g.j,g.bx-20,g.by-35,g.charge>0.6?"POWER LAUNCH!":"LAUNCH!","#aefcff");
     g.charge=0;
   }
   // also Enter launches instantly
   if(edge&KEY.start){ g.launched=true; g.vy=-14; g.vx=-1.5; g.boost=true; }
 } else {
   if((edge&KEY.action)&&g.boost){
     const sp=Math.hypot(g.vx,g.vy)||1; const boostP=3.2;
     g.vx += (g.vx/sp)*boostP; g.vy += (g.vy/sp)*boostP -1.2;
     g.boost=false; burst(g.j,g.r,g.bx,g.by,22,"#7ef4ff",4,6); floatText(g.j,g.bx,g.by-28,"POP! BOOST!","#aefcff"); shake(g.j,3);
   }
   // physics substeps
   const ramp=Math.min(1,g.time/3600);
   if(g.lit>=8){
     // lit starfish swim to the side walls, clearing the run to the pocket
     for(const s of g.stars){ s.x += ((s.homeX<480?238:722)-s.x)*0.03; s.y += (150-s.y)*0.01; }
     const dx=POCKET.x-g.bx, dy=POCKET.y-g.by; const dd=Math.hypot(dx,dy);
     if(dd<230 && dd>1){ g.vx+=dx/dd*0.3; g.vy+=dy/dd*0.3; if(g.frame%8===0) burst(g.j,g.r,g.bx,g.by,1,"#ffd23f",0.5,4); }
   }
   for(let sub=0;sub<2;sub++){
     g.vy+=0.115+ramp*0.025;
     g.vx+= dsin(g.frame*0.02 + g.by*0.01)*(0.012+ramp*0.02); // current drift
     g.vx*=0.999; g.vy*=0.999;
     // cap
     const sp=Math.hypot(g.vx,g.vy); if(sp>16){g.vx*=16/sp; g.vy*=16/sp;}
     g.bx+=g.vx/2; g.by+=g.vy/2; // Wait substep halves? Actually vx per step/2? we applied twice? We'll move full/ ? Keep: positions below doubled? No: loop 2 with /? Let's: bx already /2 each -> total vx
     // walls
     if(g.bx<LEFT+17){g.bx=LEFT+17; g.vx=Math.abs(g.vx)*0.92; g.squash=3;}
     if(g.bx>RIGHT-17){g.bx=RIGHT-17; g.vx=-Math.abs(g.vx)*0.92; g.squash=3;}
     if(g.by<TOP+17){g.by=TOP+17; g.vy=Math.abs(g.vy)*0.92; g.squash=3;}
     // guides (one-way funnels: only catch a falling shell, a launching shell passes up through)
     if(g.vy>0){ segCollide(g,LEFT,385,408,472,0.85); segCollide(g,RIGHT,385,552,472,0.85); }
     // flippers as segments
     const ly=478, lx1=408, lx2=552;
     // left flipper tip
     const la=0.55 - g.flipL*1.05; // rest down, flipped up
     const ltx=lx1+Math.cos(la)*78, lty=ly+Math.sin(la)*78;
     const ra=Math.PI-0.55 + g.flipR*1.05;
     const rtx=lx2+Math.cos(ra)*78, rty=ly+Math.sin(ra)*78;
     const lKick = g.flipL>0.5 ? -5.5 : 0;
     const rKick = g.flipR>0.5 ? -5.5 : 0;
     if(segCollide(g,lx1,ly,ltx,lty,0.9, g.flipLV*8, lKick)){
        if(g.flipL>0.4){ g.vy=Math.min(g.vy,-9); g.vx+=1.2; g.boost=true; if(Math.abs(g.vy)>3){g.eyeSquash=12; shake(g.j,5); floatText(g.j,g.bx,g.by-30,"SMACK!","#ffd23f");} burst(g.j,g.r,g.bx,g.by,8,"#ffffff",2,4);}
     }
     if(segCollide(g,lx2,ly,rtx,rty,0.9, -g.flipRV*8, rKick)){
        if(g.flipR>0.4){ g.vy=Math.min(g.vy,-9); g.vx-=1.2; g.boost=true; if(Math.abs(g.vy)>3){g.eyeSquash=12; shake(g.j,5); floatText(g.j,g.bx,g.by-30,"SMACK!","#ffd23f");} burst(g.j,g.r,g.bx,g.by,8,"#ffffff",2,4);}
     }
     // starfish
     for(const s of g.stars){
       const dx=g.bx-s.x, dy=g.by-s.y; const d=Math.hypot(dx,dy);
       if(d<17+34 && d>0){
         const nx=dx/d, ny=dy/d; g.bx=s.x+nx*51; g.by=s.y+ny*51;
         const vn=g.vx*nx+g.vy*ny; if(vn<0){g.vx-=(1.85)*vn*nx; g.vy-=(1.85)*vn*ny;}
         g.vx+=nx*1.6; g.vy+=ny*1.6-0.4; g.squash=5;
         if(s.flash<=0){
           s.flash=18; s.spinV=range(g.r,0.35,0.6)*(range(g.r,0,1)<0.5?-1:1);
           g.combo++; g.comboT=140;
           // crawl one step down
           s.crawl++; s.y=Math.min(415, s.y+20); s.x+= Math.max(-18,Math.min(18,(480-s.x)*0.04)) + range(g.r,-6,6);
           burst(g.j,g.r,s.x,s.y,20,"#ffd23f",4,6); burst(g.j,g.r,s.x,s.y,10,"#7ef4ff",3,5);
           shake(g.j,4);
           if(!s.lit){ s.lit=true; g.lit++; g.score+=100; floatText(g.j,s.x,s.y-38, g.combo>=3?`COMBO x${g.combo}!`:(g.lit%2?"BING!":"BOING!"),"#ffd23f"); }
           else { g.score+=25; floatText(g.j,s.x,s.y-38, g.combo>=3?`COMBO x${g.combo}!`:"BOING!","#ffb35c"); }
           if(g.lit>=8) floatText(g.j,480,120,"POCKET OPEN!","#7ef4ff");
         }
       }
     }
     // pocket
     const pd=Math.hypot(g.bx-POCKET.x,g.by-POCKET.y);
     if(pd<(g.lit>=8?44:POCKET.r)){
       if(g.lit>=8){ g.score+=500; burst(g.j,g.r,POCKET.x,POCKET.y,40,"#ffd23f",6,7); endRun(g,true); return; }
       else { // bounce off closed pocket
         const nx=(g.bx-POCKET.x)/(pd||1), ny=(g.by-POCKET.y)/(pd||1); g.vx=nx*7; g.vy=ny*7+2; g.bx=POCKET.x+nx*(POCKET.r+2); g.by=POCKET.y+ny*(POCKET.r+2);
         if(g.frame%30===0) floatText(g.j,POCKET.x,POCKET.y+45,`NEED ${8-g.lit} MORE ⭐`,"#ffffff");
       }
     }
   }
   // bubble trail
   g.trailT++; if(g.trailT%6===0) burst(g.j,g.r,g.bx+range(g.r,-6,6),g.by+10,1,"#aefcff",0.6,4);
   // drain
   if(g.by>H+20){
     g.lives--; burst(g.j,g.r,g.bx,H-20,24,"#ff8a8a",5,6); shake(g.j,10);
     if(g.lives<=0){ endRun(g,false); return; }
     floatText(g.j,480,300,"SHELL LOST! HOLD SPACE = POWER","#ffcfcf");
     g.launched=false; g.charge=0; g.charging=false; g.combo=0; g.boost=true; g.bx=700; g.by=455; g.vx=0; g.vy=0;
     // starfish creep back a little to give chance
     for(const s of g.stars){ s.y=Math.max(s.homeY, s.y-10); }
   }
 }
 // ambient auto-crawl difficulty: every ~9 sec a random lit? Actually all creep tiny
 if(g.time>0 && g.time%540===0){
   for(const s of g.stars) if(s.lit) s.y=Math.min(415,s.y+8);
   floatText(g.j,480,150,"THE STARFISH ARE CRAWLING!","#ffb35c");
 }
}

function render(g:Game,draw:Draw2DLike,s:Record<string,Sprite>):void{
 sky(draw,W,H,[8,90,110],[235,205,160]);
 // deep water sides
 draw.setFillStyle("#063f52"); draw.fillRect(0,0,180,H); draw.fillRect(780,0,180,H);
 // sandy table
 draw.setFillStyle("#e8c99a"); draw.fillRect(LEFT,TOP,RIGHT-LEFT,H-TOP);
 // map as back wall
 if(s.map) drawSprite(draw,s.map,480,270,470,{alpha:0.38});
 // table border
 draw.setFillStyle("#0b6b7d"); draw.fillRect(LEFT-12,TOP-12,RIGHT-LEFT+24,12); draw.fillRect(LEFT-12,TOP,12,H-TOP); draw.fillRect(RIGHT,TOP,12,H-TOP);
 // pocket
 const open=g.lit>=8;
 const pulse=1+dsin(g.frame*0.12)*0.08;
 draw.setFillStyle(open?"#ffd23f":"rgba(90,70,40,0.55)"); draw.beginPath(); draw.arc(POCKET.x,POCKET.y,POCKET.r*pulse,0,Math.PI*2,false); draw.fill();
 draw.setFillStyle(open?"#fff3a0":"rgba(255,255,255,0.35)"); draw.beginPath(); draw.arc(POCKET.x,POCKET.y,(POCKET.r-10)*pulse,0,Math.PI*2,false); draw.fill();
 text(draw,"X",POCKET.x,POCKET.y,28,open?"#7a4a00":"#5a4630","center","bangers");
 if(open) text(draw,"TREASURE!",POCKET.x,POCKET.y+48,16,"#ffd23f","center");

 const o=shakeOffset(g.j,g.frame); draw.save(); draw.translate(o.x,o.y);
 // guides
 draw.setStrokeStyle("#0b6b7d"); (draw as any).lineWidth=10; draw.beginPath(); draw.moveTo(LEFT,385); draw.lineTo(408,472); draw.stroke(); draw.beginPath(); draw.moveTo(RIGHT,385); draw.lineTo(552,472); draw.stroke();

 // starfish
 for(const st of g.stars){
   if(st.lit){ draw.setFillStyle(`rgba(255,210,63,${0.25+0.15*dsin(g.frame*0.2)})`); draw.beginPath(); draw.arc(st.x,st.y,38,0,Math.PI*2,false); draw.fill(); }
   const sc=st.flash>0?1.25:1;
   if(s.starfish) drawSprite(draw,s.starfish,st.x,st.y,62,{rot:st.spin,sx:sc,sy:sc,alpha: st.lit?1:0.92});
   if(!st.lit){ draw.setFillStyle("rgba(0,0,0,0.25)"); draw.beginPath(); draw.arc(st.x,st.y,7,0,Math.PI*2,false); draw.fill(); }
   else { text(draw,"★",st.x,st.y-34,16,"#ffd23f","center"); }
 }

 // octopus keeper behind flippers
 const eyeS=g.eyeSquash>0?0.6:1;
 if(s.octopus) drawSprite(draw,s.octopus,480,492,170,{sy: eyeS<1?0.96:1, sx: eyeS<1?1.04:1});
 // flippers (tentacles) as thick segments with circles
 const ly=478;
 const la=0.55 - g.flipL*1.05; const ltx=408+Math.cos(la)*78, lty=ly+Math.sin(la)*78;
 const ra=Math.PI-0.55 + g.flipR*1.05; const rtx=552+Math.cos(ra)*78, rty=ly+Math.sin(ra)*78;
 const drawFlipper=(x1:number,y1:number,x2:number,y2:number)=>{
   draw.setStrokeStyle("#8b5cf6"); (draw as any).lineWidth=22; draw.beginPath(); draw.moveTo(x1,y1); draw.lineTo(x2,y2); draw.stroke();
   draw.setFillStyle("#a78bfa"); draw.beginPath(); draw.arc(x2,y2,14,0,Math.PI*2,false); draw.fill();
   draw.setFillStyle("#c4b5fd"); draw.beginPath(); draw.arc(x2,y2,6,0,Math.PI*2,false); draw.fill();
 };
 drawFlipper(408,ly,ltx,lty); drawFlipper(552,ly,rtx,rty);

 // boost bubble trailing
 if(g.launched && g.boost && s.bubbles) drawSprite(draw,s.bubbles,g.bx - g.vx*3 -14, g.by - g.vy*3 +8, 34,{alpha:0.9});
 // shell
 if(g.scene==="play" || g.scene==="title"){
   let sx=1,sy=1; if(g.squash>0){sx=1.3;sy=0.65;}
   const sq = g.launched? {sx,sy}: {sx:1,sy:1};
   if(s.shell) drawSprite(draw,s.shell,g.bx,g.by,42,{rot: g.launched? g.frame*0.05:0, ...sq});
 }
 drawJuice(draw,g.j);
 draw.restore();

 // side decorations bubbles
 if(s.bubbles){ drawSprite(draw,s.bubbles,90,120+dsin(g.frame*0.03)*10,60,{alpha:0.7}); drawSprite(draw,s.bubbles,870,180+dsin(g.frame*0.04+2)*10,70,{alpha:0.7}); drawSprite(draw,s.bubbles,95,380,44,{alpha:0.5}); }

 // HUD
 if(g.scene==="play"){
   panel(draw,16,12,340,58);
   text(draw,`⭐ ${g.lit}/8  SHELLS ${g.lives}`,32,34,20,"#ffd23f");
   text(draw,`SCORE ${g.score}`,32,56,15,"#ffffff");
   panel(draw,620,12,324,58);
   text(draw,g.lit>=8?"SINK IT IN THE X!":"LIGHT ALL 8 STARFISH!",936,34,16,"#aefcff","right");
   text(draw,g.boost?"SPACE: BUBBLE BOOST READY":"BOOST: HIT A FLIPPER",936,56,13,g.boost?"#7ef4ff":"#cccccc","right");
   if(!g.launched){
     panel(draw,330,110,300,64);
     text(draw,"HOLD SPACE, RELEASE TO LAUNCH!",480,130,15,"#ffffff","center");
     // charge bar
     draw.setFillStyle("rgba(0,0,0,0.5)"); draw.fillRect(380,148,200,12);
     draw.setFillStyle("#7ef4ff"); draw.fillRect(380,148,200*g.charge,12);
   }
   if(g.combo>=2) text(draw,`COMBO x${g.combo}`,480,95,22,"#ffd23f","center","bangers");
 }

 // Title / end overlays custom English
 if(g.scene!=="play"){
   draw.setFillStyle(g.scene==="title"?"rgba(3,40,55,0.55)":"rgba(3,20,35,0.68)"); draw.fillRect(0,0,W,H);
   if(g.scene==="title"){
     // juggling octopus
     if(s.octopus) drawSprite(draw,s.octopus,480,285+dsin(g.frame*0.06)*6,260);
     const jx=480+dcos(g.frame*0.07)*110, jy=210 - Math.abs(dsin(g.frame*0.07))*70;
     if(s.shell) drawSprite(draw,s.shell,jx,jy,54,{rot:g.frame*0.08});
     if(s.starfish) drawSprite(draw,s.starfish,300,360,70,{rot:g.frame*0.03}); if(s.starfish) drawSprite(draw,s.starfish,660,360,70,{rot:-g.frame*0.03});
     text(draw,"STARFISH PINBALL PANIC",480,92,52,"#ffd23f","center","bangers");
     text(draw,"Light all 8 starfish, then sink the shell in the X!",480,140,19,"#aefcff","center");
     text(draw,"LEFT / RIGHT or A D  Flippers   -   SPACE Launch + Bubble Boost",480,455,17,"#ffffff","center");
     if(Math.floor(g.frame/28)%2===0) text(draw,"PRESS ENTER",480,492,28,"#ffffff","center","bangers");
   } else if(g.scene==="won"){
     if(s.map) drawSprite(draw,s.map,480,230,220);
     text(draw,"TREASURE FOUND!",480,150,58,"#ffd23f","center","bangers");
     text(draw,`You lit all 8 starfish!  Score: ${g.score}`,480,300,22,"#ffffff","center");
     if(Math.floor(g.frame/28)%2===0) text(draw,"ENTER TO PLAY AGAIN",480,380,24,"#ffffff","center","bangers");
   } else {
     text(draw,"THE SHELL DRAINED AWAY!",480,170,48,"#ff8a8a","center","bangers");
     text(draw,`Starfish lit: ${g.lit}/8   Score: ${g.score}`,480,260,22,"#ffffff","center");
     if(Math.floor(g.frame/28)%2===0) text(draw,"ENTER TO PLAY AGAIN",480,350,24,"#ffffff","center","bangers");
   }
 }
}

export default defineSim({
 players:1, window:{width:W,height:H,title:"Starfish Pinball Panic"}, clear:{r:0.02,g:0.25,b:0.32}, options:{}, neutral:0, encode:encodeKeys, random:randomKeys,
 create:(platform:SimPlatform):SimRun=>{
   let g=fresh(1); let sprites:Record<string,Sprite>={}; const ready=loadKit(platform,NAMES).then(s=>{sprites=s;});
   return { ready, start:(seed)=>{g=fresh(seed);}, step:(inputs)=>step(g,inputs[0]??0),
     checksum:()=>{ let h=g.frame*31+g.score*7+g.lives*13+g.lit*101+Math.round(g.bx*10)+Math.round(g.by*10); for(const st of g.stars) h=(Math.imul(h,16777619)^Math.round(st.y*10)^(st.lit?1:0))>>>0; return h>>>0; },
     state:()=>({outcome:outcomeOf(g.scene), progress: g.scene==="won"?1:(g.lit/8)*0.92, scene:g.scene, score:g.score, lives:g.lives, lit:g.lit}),
     over:()=>false, save:()=>structuredClone(g), restore:(saved)=>{g={...fresh(1),...structuredClone(saved as Game)};}, inspect:()=>g, render:(draw)=>render(g,draw,sprites) };
 },
});
