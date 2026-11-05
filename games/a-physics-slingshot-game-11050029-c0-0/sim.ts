import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540, GROUND = 472;
const NAMES = ["cloud", "knight", "catapult", "tower", "dragon", "chest"];

interface Block { x:number;y:number;vx:number;vy:number;rot:number;vr:number; mode:"stack"|"fall"|"rest"; hp:number; hitCd:number }
interface Game {
  scene:Scene; sceneFrames:number; frame:number; prev:number; r:{s:number};
  knightsLeft:number; angle:number; power:number; charging:boolean; chargeDir:number;
  phase:"aim"|"fly"|"wait"; waitT:number;
  kx:number; ky:number; kvx:number; kvy:number; krot:number; dropped:boolean; smashes:number; bounceCd:number; spin:number;
  cloudX:number; cloudDir:number; cloudSquish:number;
  blocks:Block[];
  dx:number; dy:number; dvx:number; dvy:number; drot:number; dvr:number; dragonGrounded:boolean; dragonHit:boolean;
  chestOpen:number; j:Juice; shakeT:number; trail:{x:number;y:number;life:number}[];
  bannerT:number; wind:number;
}

function makeBlocks():Block[]{
  const b:Block[]=[];
  for(let i=0;i<6;i++) b.push({x:748,y:GROUND-27-i*52,vx:0,vy:0,rot:0,vr:0,mode:"stack",hp:2,hitCd:0});
  return b;
}
const fresh=(seed:number,scene:Scene="title"):Game=>({
  scene,sceneFrames:0,frame:0,prev:0,r:rng(seed),
  knightsLeft:5,angle:48,power:0,charging:false,chargeDir:1,
  phase:"aim",waitT:0,kx:148,ky:GROUND-78,kvx:0,kvy:0,krot:0,dropped:false,smashes:0,bounceCd:0,spin:0,
  cloudX:470,cloudDir:1,cloudSquish:0,blocks:makeBlocks(),
  dx:748,dy:GROUND-27-6*52-42,dvx:0,dvy:0,drot:0,dvr:0,dragonGrounded:false,dragonHit:false,
  chestOpen:0,j:juice(),shakeT:0,trail:[],bannerT:0,wind:0,
});
function topOfTower(g:Game):number{
  let top=GROUND;
  for(const b of g.blocks) if(b.mode==="stack") top=Math.min(top,b.y-26);
  return top;
}
function resetKnight(g:Game){
  g.phase="aim"; g.kx=148; g.ky=GROUND-78; g.kvx=0; g.kvy=0; g.krot=0; g.dropped=false; g.smashes=0; g.power=0; g.charging=false; g.trail=[];
}
function looseBlock(g:Game,b:Block,vx:number,vy:number,msg:string){
  if(b.mode!=="stack") return;
  b.mode="fall"; b.vx=vx; b.vy=vy; b.vr=vx*0.02+range(g.r,-.06,.06);
  burst(g.j,g.r,b.x,b.y,14,"#b07a3f",5,6); burst(g.j,g.r,b.x,b.y,8,"#ffd23f",3,4);
  floatText(g.j,b.x,b.y-40,msg,msg==="TIMBER!"?"#ff8a3c":"#ffffff"); shake(g.j,7);
}

function step(g:Game,keys:number):void{
  const edge=pressed(keys,g.prev); g.prev=keys; g.frame++; juiceStep(g.j);
  if(sceneStep(g,edge)){ const s=g.r.s; Object.assign(g,fresh(s,"play")); g.prev=keys; return; }
  // ambient cloud always drifts (title too)
  const speedBase = g.scene==="play" ? 0.7 + (5-g.knightsLeft)*0.28 : 0.7;
  g.cloudX += g.cloudDir*speedBase;
  if(g.cloudX>600){g.cloudX=600;g.cloudDir=-1} if(g.cloudX<330){g.cloudX=330;g.cloudDir=1}
  if(g.cloudSquish>0)g.cloudSquish--;
  if(g.scene!=="play") return;
  if(g.chestOpen>0 && g.chestOpen<90) g.chestOpen++;

  // Dragon physics/support
  const towerTop=topOfTower(g);
  const overTower = Math.abs(g.dx-748)<95;
  const supportY = overTower ? towerTop-42 : GROUND-42;
  if(!g.dragonGrounded){
    g.dvy+=0.45; g.dx+=g.dvx; g.dy+=g.dvy; g.drot+=g.dvr; g.dvx*=0.99;
    if(g.dy>=supportY){
      g.dy=supportY;
      if(Math.abs(g.dvy)>4){ burst(g.j,g.r,g.dx,g.dy+30,16,"#c9a0ff",4,6); shake(g.j,6); }
      g.dvy=0; g.dvr*=0.4;
      if(supportY>=GROUND-42){ g.dragonGrounded=true; }
      else { g.drot*=0.8; if(Math.abs(g.drot)>0.6) g.drot*=0.9; }
    }
    if(g.dx>880){g.dx=880;g.dvx*=-0.4}
  } else {
    g.drot += (1.35-g.drot)*0.08; // tipped over on ground
  }

  // Blocks falling physics
  for(const b of g.blocks){
    if(b.hitCd>0)b.hitCd--;
    if(b.mode==="fall"){
      b.vy+=0.45; b.x+=b.vx; b.y+=b.vy; b.rot+=b.vr; b.vx*=0.99;
      if(b.y>=GROUND-26){ b.y=GROUND-26; b.vy*=-0.25; b.vx*=0.7; b.vr*=0.5; if(Math.abs(b.vy)<1.2){b.mode="rest"; b.vy=0;} burst(g.j,g.r,b.x,GROUND-4,5,"#d9b380",2,4); }
      if(b.x<20||b.x>W-20){b.vx*=-0.5; b.x=Math.max(20,Math.min(W-20,b.x));}
    }
  }
  // If a stacked block has no support (block below gone/falling), it topples
  // Check from bottom up: support is ground or a stacked block directly below
  for(let i=0;i<g.blocks.length;i++){
    const b=g.blocks[i]!; if(b.mode!=="stack") continue;
    // expected y if supported: count stacked blocks below with similar x
    // Simple: if any gap below - look for stacked block whose top is near b bottom
    let supported = Math.abs(b.y-(GROUND-27))<2;
    if(!supported) for(const o of g.blocks) if(o!==b && o.mode==="stack" && Math.abs(o.x-b.x)<50 && Math.abs((o.y-26)-(b.y+26))<8) supported=true;
    if(!supported && g.frame%6===0 && b.y<GROUND-30){
      // begin creeping fall rather than instant teleport - convert lower unsupported first only occasionally
      // Find lowest unsupported
      // handled below
    }
  }
  // Make lowest unsupported stacked block fall (one per check gives wobbly cascade)
  {
    let candidate:Block|null=null;
    for(const b of g.blocks){ if(b.mode!=="stack")continue; let sup=Math.abs(b.y-(GROUND-27))<2; if(!sup) for(const o of g.blocks) if(o!==b&&o.mode==="stack"&&Math.abs(o.x-b.x)<50&&Math.abs((o.y-26)-(b.y+26))<8) sup=true; if(!sup && (!candidate||b.y>candidate.y)) candidate=b; }
    if(candidate) looseBlock(g,candidate, range(g.r,-1.2,1.2), 0.5, "TIMBER!");
  }

  if(g.dragonGrounded && g.scene==="play"){
    g.bannerT++;
    if(g.bannerT===1){ burst(g.j,g.r,862,GROUND-60,40,"#ffd23f",7,7); burst(g.j,g.r,g.dx,g.dy,30,"#c084fc",6,6); burst(g.j,g.r,862,GROUND-80,30,"#fff3a0",5,5); shake(g.j,12); g.chestOpen=1; floatText(g.j,g.dx,g.dy-70,"DRAGON DOWN!","#ffd23f"); }
    if(g.bannerT>70){ endRun(g,true); return; }
  }

  // Trail decay
  for(const t of g.trail) t.life--; g.trail=g.trail.filter(t=>t.life>0);

  if(g.phase==="aim"){
    if(keys&KEY.up) g.angle=Math.min(72,g.angle+0.9);
    if(keys&KEY.down) g.angle=Math.max(22,g.angle-0.9);
    if(edge&KEY.action){ g.charging=true; g.power=0.15; g.chargeDir=1; }
    if(g.charging && (keys&KEY.action)){
      g.power += 0.018*g.chargeDir; if(g.power>=1){g.power=1;g.chargeDir=-1} if(g.power<=0.15){g.power=0.15;g.chargeDir=1}
    }
    if(g.charging && !(keys&KEY.action)){
      // release -> launch
      const sp=9+g.power*12.5; const a=g.angle*Math.PI/180;
      g.kvx=dcos(a)*sp; g.kvy=-dsin(a)*sp; g.phase="fly"; g.charging=false; g.dropped=false; g.smashes=0; g.spin=0;
      burst(g.j,g.r,g.kx,g.ky,16,"#ffffff",4,5); floatText(g.j,g.kx+30,g.ky-50,"WHEEE!","#ffffff"); shake(g.j,3);
    }
    // also allow Enter? no
    g.kx=148; g.ky=GROUND-78 + dsin(g.frame*0.08)*2;
  } else if(g.phase==="fly"){
    // Shield drop
    if((edge&KEY.action) && !g.dropped){
      g.dropped=true; g.kvx=0; g.kvy=15; g.krot=0;
      burst(g.j,g.r,g.kx,g.ky-20,12,"#aee6ff",3,5); floatText(g.j,g.kx,g.ky-46,"SHIELD DROP!","#7dd3fc"); shake(g.j,4);
    }
    g.kvy+=0.42; g.kx+=g.kvx; g.ky+=g.kvy; g.spin+= g.dropped?0: g.kvx*0.012;
    g.krot = g.dropped ? 0 : g.spin;
    if(g.bounceCd>0)g.bounceCd--;
    g.trail.push({x:g.kx,y:g.ky,life:g.dropped?18:12});
    if(g.trail.length>28)g.trail.shift();

    // Cloud bounce
    const cloudY=218;
    if(g.bounceCd===0 && g.kvy>0 && Math.abs(g.kx-g.cloudX)<92 && Math.abs(g.ky-cloudY)<38 && g.ky<cloudY+20){
      g.kvy=-12.5; g.kvx*=1.02; g.ky=cloudY-36; g.cloudSquish=14; g.bounceCd=20; g.dropped=false; g.smashes=0;
      burst(g.j,g.r,g.kx,cloudY,14,"#7cc7ff",3,5); floatText(g.j,g.kx,cloudY-44,"BOING!","#38bdf8"); shake(g.j,3);
    }

    // Dragon direct hit
    if(Math.abs(g.kx-g.dx)<62 && Math.abs(g.ky-g.dy)<58){
      g.dragonHit=true; g.dvx += g.kvx*0.55 + (g.dropped?3:0); g.dvy = g.dropped?2:-6; g.dvr=0.12;
      burst(g.j,g.r,g.dx,g.dy,22,"#c084fc",6,6); floatText(g.j,g.dx,g.dy-66,"BONK!","#e9d5ff"); shake(g.j,10);
      g.kvx*=-0.35; g.kvy=-6; g.dropped=false;
    }

    // Block collisions
    for(const b of g.blocks){
      if(b.mode!=="stack"||b.hitCd>0) continue;
      if(Math.abs(g.kx-b.x)<62 && Math.abs(g.ky-b.y)<48){
        b.hitCd=12;
        if(g.dropped){
          g.smashes++;
          looseBlock(g,b, range(g.r,-2,2), -1, g.smashes===1?"CRACK!":"SMASH!");
          burst(g.j,g.r,b.x,b.y,22,"#92400e",6,7);
          if(g.smashes>=2){ // shield spent, deflect
            g.dropped=false; g.kvx=-4; g.kvy=-5; floatText(g.j,g.kx,g.ky-40,"CLANG!","#fde68a");
          } else { g.kvy=11; } // keep plunging
        } else if(Math.hypot(g.kvx,g.kvy)>9){
          b.hp--;
          if(b.hp<=0) looseBlock(g,b, g.kvx*0.35, -2, "CRACK!");
          else { floatText(g.j,b.x,b.y-42,"THUD!","#ffffff"); burst(g.j,g.r,b.x,b.y,10,"#b07a3f",4,5); }
          shake(g.j,8);
          g.kvx*=-0.3; g.kvy=-6;
        } else {
          g.kvx*=-0.4; g.kvy=-5; floatText(g.j,g.kx,g.ky-36,"BONK!","#ffffff");
        }
        break;
      }
    }

    // Ground / out
    if(g.ky>=GROUND-28){
      g.ky=GROUND-28;
      burst(g.j,g.r,g.kx,GROUND-6, g.dropped?26:14, "#d9b380", g.dropped?6:4,6);
      if(g.dropped) { shake(g.j,11); floatText(g.j,g.kx,g.ky-48,"WHAM!","#fde68a"); }
      g.phase="wait"; g.waitT=0;
    }
    if(g.kx>W+40||g.kx<-40){ g.phase="wait"; g.waitT=40; }
  } else if(g.phase==="wait"){
    g.waitT++;
    if(g.waitT>55){
      if(g.dragonGrounded) return;
      g.knightsLeft--;
      if(g.knightsLeft<=0){ endRun(g,false); return; }
      resetKnight(g);
    }
  }
  g.wind = dsin(g.frame*0.01)*0.2;
}

function render(g:Game,draw:Draw2DLike,s:Record<string,Sprite>):void{
  sky(draw,W,H,[86,170,240],[195,232,255]);
  // sun
  draw.setFillStyle("#fff3a0"); draw.beginPath(); draw.arc(66,58,30,0,Math.PI*2,false); draw.fill();
  // distant puffy clouds (shapes)
  draw.setFillStyle("rgba(255,255,255,0.75)");
  for(const [cx,cy,sc] of [[180,90,1],[560,70,0.8],[820,110,1.1],[360,130,0.6]] as const){
    draw.beginPath(); draw.arc(cx+dsin(g.frame*0.005+cx)*8,cy,22*sc,0,Math.PI*2,false); draw.arc(cx+24*sc,cy+4,16*sc,0,Math.PI*2,false); draw.arc(cx-24*sc,cy+5,15*sc,0,Math.PI*2,false); draw.fill();
  }
  // hills
  draw.setFillStyle("#8fd07a"); draw.beginPath(); draw.arc(120,540,260,Math.PI,0,false); draw.fill();
  draw.setFillStyle("#6fbf5f"); draw.beginPath(); draw.arc(860,560,300,Math.PI,0,false); draw.fill();
  draw.setFillStyle("#5da84e"); draw.fillRect(0,GROUND,W,H-GROUND);
  draw.setFillStyle("#f7e8c3"); draw.fillRect(0,GROUND,W,10);
  // crayon ground speckles
  draw.setFillStyle("rgba(0,0,0,0.12)"); for(let i=0;i<12;i++) draw.fillRect(30+i*78,GROUND+28+((i*37)%36),18,3);

  const o=shakeOffset(g.j,g.frame); draw.save(); draw.translate(o.x,o.y);

  // Title sway: whole tower sways behind title
  const sway = g.scene==="title" ? dsin(g.frame*0.02)*0.03 : dsin(g.frame*0.015)*0.006;

  // Aim trajectory (dotted)
  if(g.scene==="play" && g.phase==="aim"){
    const sp=9+(g.charging?g.power:0.45)*12.5; const a=g.angle*Math.PI/180;
    let px=148,py=GROUND-78,vx=dcos(a)*sp,vy=-dsin(a)*sp;
    draw.setFillStyle("rgba(255,255,255,0.85)");
    for(let i=0;i<18;i++){ vy+=0.42; px+=vx; py+=vy; if(i%2===0){ draw.beginPath(); draw.arc(px,py,4,0,Math.PI*2,false); draw.fill(); } if(py>GROUND) break; }
    text(draw,`${Math.round(g.angle)}°`,196,GROUND-118,18,"#ffffff","center");
  }

  // Tower blocks (tower sprite as each block)
  draw.save(); if(g.scene==="title"){ draw.translate(748,GROUND); draw.rotate(sway); draw.translate(-748,-GROUND); }
  for(const b of g.blocks){
    drawSprite(draw,s.tower!,b.x,b.y,58,{rot:b.rot, sx:3.4*(b.mode==="stack"?1+dsin(g.frame*0.03+b.y*0.05)*0.01:1)});
  }
  // Dragon
  const dragonSquash = g.dragonGrounded? {sx:1.15,sy:0.82} : {sx:1,sy:1};
  drawSprite(draw,s.dragon!,g.dx,g.dy,92,{rot:g.drot, ...dragonSquash, flip:g.dvx<-0.5});
  // Chest beside tower on ground
  const chestY=GROUND-30, chestBounce=g.chestOpen? Math.abs(dsin(g.chestOpen*0.3))*8:0;
  drawSprite(draw,s.chest!,866,chestY-chestBounce,64,{rot:g.chestOpen? dsin(g.chestOpen*0.2)*0.08:0, sx:g.chestOpen?1.1:1, sy:g.chestOpen?1.1:1});
  if(g.chestOpen>0){ draw.setFillStyle("#ffd23f"); for(let i=0;i<8;i++){ const ax=866+dsin(g.frame*0.2+i)*26, ay=chestY-44-dcos(g.frame*0.15+i*1.7)*14; draw.beginPath(); draw.arc(ax,ay,4,0,Math.PI*2,false); draw.fill(); } }
  draw.restore();

  // Cloud trampoline
  const cloudY=218;
  const csq = g.cloudSquish>0 ? dsin((g.cloudSquish/14)*Math.PI) : 0;
  drawSprite(draw,s.cloud!,g.cloudX,cloudY,86,{sx:1+csq*0.18, sy:1-csq*0.28});
  text(draw,"BOUNCE!",g.cloudX,cloudY+34,13,"#0369a1","center");

  // Catapult
  const stretch = g.charging? g.power : 0;
  drawSprite(draw,s.catapult!,118,GROUND-46,104,{sx:1+stretch*0.12, sy:1-stretch*0.08, rot:-stretch*0.06});
  // power bar
  if(g.scene==="play" && g.phase==="aim"){
    panel(draw,28,GROUND-168,170,22,"rgba(0,0,0,0.45)",8);
    draw.setFillStyle(g.power>0.75?"#ef4444":g.power>0.4?"#f59e0b":"#7dd3fc");
    if(g.charging) draw.fillRect(32,GROUND-164,162*g.power,14);
    else { draw.setFillStyle("rgba(255,255,255,0.5)"); draw.fillRect(32,GROUND-164,40,14); }
  }

  // Knight trail
  for(const t of g.trail){ draw.setGlobalAlpha(Math.max(0,t.life/18)*0.5); draw.setFillStyle(g.dropped?"#7dd3fc":"#ffffff"); draw.beginPath(); draw.arc(t.x,t.y,g.dropped?10:7,0,Math.PI*2,false); draw.fill(); }
  draw.setGlobalAlpha(1);
  if(g.dropped && g.phase==="fly"){ draw.setFillStyle("rgba(125,211,252,0.6)"); draw.fillRect(g.kx-5,g.ky-70,10,54); }

  // Knight (hide spare? show in catapult / flying)
  if(!(g.scene!=="play" && false)){
    const flying=g.phase==="fly";
    const sq = flying? {sx:0.9,sy:1.12} : {sx:1,sy:1};
    // On title, knight sits by catapult heroically
    drawSprite(draw,s.knight!,g.kx,g.ky,86,{rot:g.phase==="fly"?g.krot:dsin(g.frame*0.06)*0.04, ...sq});
  }

  drawJuice(draw,g.j);
  draw.restore();

  // HUD
  if(g.scene==="play"){
    panel(draw,14,12,330,54);
    text(draw,`KNIGHTS LEFT: ${g.knightsLeft} / 5`,30,40,20,"#ffd23f");
    panel(draw,650,12,296,54);
    const prog=Math.max(0,Math.min(1,(g.dy-(GROUND-27-6*52-42))/((GROUND-42)-(GROUND-27-6*52-42))));
    text(draw,`DRAGON DOWN ${Math.round(prog*100)}%`,666,32,15,"#e9d5ff");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(666,44,264,10);
    draw.setFillStyle("#c084fc"); draw.fillRect(666,44,264*prog,10);
    panel(draw,14,H-42,620,30);
    const hint = g.phase==="aim" ? (g.charging?"Release SPACE to LAUNCH!":"UP/DOWN Aim  •  HOLD SPACE to charge") : g.phase==="fly" ? (g.dropped?"SHIELD DOWN!":"SPACE = Shield Drop  •  Bounce the cloud!") : "Here comes the next knight...";
    text(draw,hint,26,H-27,16,"#ffffff");
  }

  // Overlays English, custom (kit overlay is Spanish placeholder)
  if(g.scene!=="play"){
    draw.setFillStyle(g.scene==="title"?"rgba(20,40,80,0.28)":"rgba(0,0,0,0.55)"); draw.fillRect(0,0,W,H);
    const bob=dsin(g.frame*0.05)*6;
    if(g.scene==="title"){
      text(draw,"KNIGHT FLIGHT",W/2,150+bob,74,"#ffd23f","center","bangers");
      text(draw,"Dragon Down!",W/2,205+bob,34,"#ffffff","center","bangers");
      panel(draw,W/2-300,236,600,92,"rgba(0,0,0,0.5)");
      text(draw,"Aim with UP / DOWN  •  Hold & release SPACE to launch",W/2,262,18,"#ffffff","center");
      text(draw,"In mid-air press SPACE for SHIELD DROP!",W/2,288,18,"#7dd3fc","center");
      text(draw,"Bounce off the cloud • Smash the tower • Drop the dragon!",W/2,312,15,"#fde68a","center");
      if(Math.floor(g.frame/30)%2===0) text(draw,"Press Enter to Launch!",W/2,382,28,"#ffffff","center","bangers");
      text(draw,"5 knights • Knock the purple dragon to the ground!",W/2,424,16,"#ffffff","center");
    } else if(g.scene==="won"){
      // confetti shapes
      for(let i=0;i<28;i++){ draw.setFillStyle(["#ffd23f","#f472b6","#7dd3fc","#86efac"][i%4]!); draw.fillRect(40+((i*97+g.frame*(1+i%3))%880), 60+((i*61+g.frame)%360),8,5); }
      text(draw,"DRAGON DOWN!",W/2,170+bob,72,"#ffd23f","center","bangers");
      text(draw,"You Got the Treasure!",W/2,235,30,"#ffffff","center","bangers");
      drawSprite(draw,s.chest!,W/2,310,90,{sx:1.1,sy:1.1});
      if(Math.floor(g.frame/30)%2===0) text(draw,"ENTER to play again",W/2,400,24,"#ffffff","center");
    } else {
      text(draw,"OUT OF KNIGHTS!",W/2,170+bob,64,"#ff8a8a","center","bangers");
      text(draw,"The Dragon Keeps the Gold!",W/2,235,28,"#ffffff","center","bangers");
      drawSprite(draw,s.dragon!,W/2,320,100,{rot:dsin(g.frame*0.04)*0.08});
      if(Math.floor(g.frame/30)%2===0) text(draw,"ENTER to try again",W/2,410,24,"#ffffff","center");
    }
  }
  if(g.scene==="play" && g.dragonGrounded){
    text(draw,"DRAGON DOWN!",W/2,130+dsin(g.frame*0.1)*4,56,"#ffd23f","center","bangers");
  }
}
type Draw2DLike=Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players:1, window:{width:W,height:H,title:"Knight Flight: Dragon Down!"}, clear:{r:0.53,g:0.78,b:0.96}, options:{}, neutral:0, encode:encodeKeys, random:randomKeys,
  create:(platform:SimPlatform):SimRun=>{
    let g=fresh(1); let sprites:Record<string,Sprite>={};
    const ready=loadKit(platform,NAMES).then(s=>{sprites=s});
    return {
      ready, start:(seed)=>{g=fresh(seed)},
      step:(inputs)=>step(g,inputs[0]??0),
      checksum:()=>{ let h=g.frame*31+g.knightsLeft*101+Math.round(g.kx)+Math.round(g.dy*10); for(const b of g.blocks) h=(Math.imul(h,16777619)^Math.round(b.y*10+b.x))>>>0; return h>>>0; },
      state:()=>({ outcome:outcomeOf(g.scene), progress:Math.max(0,Math.min(1,(g.dy-(GROUND-27-6*52-42))/((GROUND-42)-(GROUND-27-6*52-42)))), scene:g.scene, knightsLeft:g.knightsLeft, phase:g.phase }),
      over:()=>false, save:()=>structuredClone(g), restore:(saved)=>{g={...fresh(1),...structuredClone(saved as Game)}}, inspect:()=>g, render:(draw)=>render(g,draw,sprites),
    };
  },
});
