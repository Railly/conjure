import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dsin, dcos } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960; const H = 540;
const NAMES = ["dog", "hydrant", "bone", "cat", "fence", "sign"];
const GROUND = 460; const GOAL_M = 600; const PX_M = 18; const GOAL_PX = GOAL_M * PX_M;
const DOG_X = 190;

type Kind = "hydrant" | "cat";
interface Ob { wx: number; kind: Kind; base: number; hit: boolean; counted: boolean }
interface Bone { wx: number; y: number; taken: boolean }
interface Fence { wx: number; len: number }
interface SignE { wx: number; m: number; big: boolean; wig: number }

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  j: Juice; world: number; speed: number;
  feet: number; vy: number; grounded: boolean; duck: boolean;
  charge: number; charging: boolean; wasAir: boolean; airBoost: number; chargeAtLaunch: number;
  lives: number; invuln: number; streak: number; bonesTotal: number; perfects: number;
  obs: Ob[]; bones: Bone[]; fences: Fence[]; signs: SignE[];
  nextWx: number; banner: number; bannerText: string; clearedPending: boolean; landFlash: number;
  runFrames: number; chargeTime: number;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed), j: juice(),
  world: 0, speed: 4.6, feet: GROUND, vy: 0, grounded: true, duck: false,
  charge: 0, charging: false, wasAir: false, airBoost: 0, chargeAtLaunch: 0,
  lives: 3, invuln: 0, streak: 0, bonesTotal: 0, perfects: 0,
  obs: [], bones: [], fences: [], signs: [150,300,450].map(m=>({wx:m*PX_M,m,big:false,wig:0})).concat([{wx:GOAL_PX,m:600,big:true,wig:0}]),
  nextWx: 750, banner: 0, bannerText: "", clearedPending: false, landFlash: 0, runFrames: 0, chargeTime: 0,
});

function surfaceAt(g: Game, wx: number): number {
  for (const f of g.fences) if (wx >= f.wx - 10 && wx <= f.wx + f.len) return GROUND - 58;
  return GROUND;
}

function spawn(g: Game) {
  while (g.nextWx < g.world + 1400 && g.nextWx < GOAL_PX - 500) {
    const wx = g.nextWx;
    const roll = range(g.r, 0, 1);
    const diff = Math.min(1, wx / GOAL_PX); // ramp
    if (roll < 0.22) {
      // fence platform with bone line, sometimes hydrant on top
      const len = range(g.r, 220, 320);
      g.fences.push({ wx, len });
      for (let i = 0; i < 4; i++) g.bones.push({ wx: wx + 40 + i * 60, y: GROUND - 58 - 95, taken: false });
      if (range(g.r,0,1) < 0.55) g.obs.push({ wx: wx + len - 70, kind: "hydrant", base: GROUND - 58, hit: false, counted: false });
      g.nextWx += len + range(g.r, 300, 420);
    } else if (roll < 0.48) {
      // hydrant(s) with bone arc
      g.obs.push({ wx, kind: "hydrant", base: GROUND, hit: false, counted: false });
      if (diff > 0.35 && range(g.r,0,1) < 0.45) g.obs.push({ wx: wx + 95, kind: "hydrant", base: GROUND, hit: false, counted: false });
      for (let i = 0; i < 5; i++) {
        const t = i / 4; g.bones.push({ wx: wx - 80 + i * 55, y: GROUND - 70 - Math.sin(t * Math.PI) * 95, taken: false });
      }
      g.nextWx += range(g.r, 360, 520) - diff * 60;
    } else if (roll < 0.72) {
      // cat: duck or short hop; low bones reward ducking
      g.obs.push({ wx, kind: "cat", base: GROUND, hit: false, counted: false });
      for (let i = 0; i < 3; i++) g.bones.push({ wx: wx - 60 + i * 60, y: GROUND - 42, taken: false });
      g.nextWx += range(g.r, 380, 540) - diff * 60;
    } else {
      // plain bone trail + single hydrant further
      for (let i = 0; i < 4; i++) g.bones.push({ wx: wx + i * 55, y: GROUND - 85 - dsin(i*1.2)*25, taken: false });
      g.obs.push({ wx: wx + 300, kind: "hydrant", base: GROUND, hit: false, counted: false });
      g.nextWx += range(g.r, 560, 700);
    }
  }
}

function crash(g: Game, ob: Ob) {
  ob.hit = true; g.lives--; g.streak = 0; g.invuln = 95; g.clearedPending = false;
  const sx = DOG_X + 40, sy = g.feet - 60;
  if (ob.kind === "hydrant") { burst(g.j, g.r, sx, sy, 28, "#4db8ff", 6, 7); burst(g.j, g.r, sx, sy, 12, "#ffffff", 5, 5); floatText(g.j, sx, sy - 50, "SPLASH! TRIPPED!", "#7fd4ff"); }
  else { burst(g.j, g.r, sx, sy, 24, "#888888", 6, 6); floatText(g.j, sx, sy - 50, "SWIPED! TRIPPED!", "#ff8a8a"); }
  shake(g.j, 13);
  if (g.lives <= 0) endRun(g, false);
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") return;
  g.runFrames++;
  if (g.invuln > 0) g.invuln--;
  if (g.banner > 0) g.banner--;
  if (g.landFlash > 0) g.landFlash--;
  spawn(g);

  const holding = (keys & KEY.action) !== 0;
  g.duck = (keys & KEY.down) !== 0 && g.grounded && !g.charging;

  // charging / stretch
  if (g.grounded && holding && !g.duck) {
    if (!g.charging) { g.charging = true; g.charge = 0; g.chargeTime = 0; }
    g.chargeTime++;
    // longer stretch takes longer to reach full (snap delay feel)
    g.charge = Math.min(1, g.charge + 0.026);
  } else if (g.charging && !holding) {
    // release: snap!
    const c = g.charge;
    g.charging = false; g.grounded = false; g.wasAir = true; g.chargeAtLaunch = c;
    g.vy = -(7.2 + c * 8.2);
    g.airBoost = c * 3.2;
    burst(g.j, g.r, DOG_X - 30, g.feet - 5, 12, "#e8d5b0", 3.5, 5);
    if (c > 0.75) floatText(g.j, DOG_X + 30, g.feet - 140, "BIG LEAP!", "#ffd23f");
    g.charge = 0;
  }
  if (!holding && g.charging) { /* handled above */ }
  // if duck pressed while charging cancel small?

  // speed ramp over distance & time
  const prog = g.world / GOAL_PX;
  g.speed = 5.2 + prog * 2.2 + Math.min(0.6, g.runFrames / 6000);
  const move = g.speed + (!g.grounded ? g.airBoost : 0);
  g.world += move;

  // vertical
  if (!g.grounded) {
    g.vy += 0.48;
    g.feet += g.vy;
    const surf = surfaceAt(g, g.world);
    // land on fence platform if falling onto it, else ground
    if (g.vy >= 0) {
      // check platform first
      let landed = false;
      for (const f of g.fences) {
        const top = GROUND - 58;
        if (g.world >= f.wx && g.world <= f.wx + f.len && g.feet >= top && g.feet - g.vy <= top + 14) { g.feet = top; landed = true; break; }
      }
      if (!landed && g.feet >= GROUND) { g.feet = GROUND; landed = true; }
      if (landed) {
        g.grounded = true; g.vy = 0; g.airBoost = 0;
        burst(g.j, g.r, DOG_X, g.feet - 2, 8, "#d9c49a", 2.5, 4);
        if (g.clearedPending) {
          g.perfects++; g.clearedPending = false; g.landFlash = 20;
          floatText(g.j, DOG_X + 50, g.feet - 150, "PERFECT LANDING!", "#7be495");
          burst(g.j, g.r, DOG_X + 40, g.feet - 80, 14, "#7be495", 4, 5);
        }
        g.wasAir = false;
      }
    }
    if (g.feet > GROUND) g.feet = GROUND;
  } else {
    // grounded: follow surface (step up/down fences)
    const surf = surfaceAt(g, g.world);
    if (surf < g.feet) g.feet = surf; // stepped onto fence (via its start ramp treated as step)
    else if (surf > g.feet) { // walked off fence edge -> fall
      // if difference is fence drop, become airborne
      if (g.feet < GROUND - 20) { g.grounded = false; g.vy = 0.5; }
      else g.feet = surf;
    }
  }

  // signs
  for (const s of g.signs) {
    if (!s.big && s.wig === 0 && g.world >= s.wx) { s.wig = 60; g.banner = 110; g.bannerText = `${s.m} METERS! KEEP GOING!`; burst(g.j, g.r, 700, 180, 18, "#5aa0ff", 4, 5); }
    if (s.big && g.world >= s.wx - 20) { /* win below */ }
  }

  // bones
  const dogCY = g.feet - (g.duck ? 35 : 55);
  for (const b of g.bones) {
    if (b.taken) continue;
    const sx = DOG_X + (b.wx - g.world);
    if (Math.abs(sx - DOG_X) < 58 && Math.abs(b.y - dogCY) < 62) {
      b.taken = true; g.bonesTotal++; g.streak++;
      burst(g.j, g.r, sx, b.y, 12, "#ffffff", 3.5, 5); burst(g.j, g.r, sx, b.y, 8, "#ffd23f", 3, 4);
      if (g.streak >= 5) {
        g.streak = 0;
        if (g.lives < 3) { g.lives++; floatText(g.j, DOG_X + 40, g.feet - 170, "+1 TUMBLE BACK!", "#7be495"); }
        else floatText(g.j, DOG_X + 40, g.feet - 170, "5 BONES! GREAT!", "#ffd23f");
      } else floatText(g.j, sx, b.y - 35, `BONE ${g.streak}/5`, "#ffffff");
    }
  }

  // obstacles
  for (const ob of g.obs) {
    const sx = DOG_X + (ob.wx - g.world);
    if (!ob.counted && sx < DOG_X - 55) {
      ob.counted = true;
      if (!ob.hit && !g.grounded) g.clearedPending = true;
      else if (!ob.hit && ob.kind === "cat" && g.duck) { g.clearedPending = false; floatText(g.j, DOG_X + 40, g.feet - 150, "SNEAKY DUCK!", "#7be495"); g.perfects++; }
    }
    if (ob.hit) continue;
    if (g.invuln > 0) continue;
    // AABB
    const dogHalfW = g.duck ? 52 : 46;
    const dogTop = g.feet - (g.duck ? 55 : 105);
    const dogBot = g.feet - 4;
    if (ob.kind === "hydrant") {
      const oTop = ob.base - 56, oBot = ob.base, oHalf = 20;
      if (Math.abs(sx - DOG_X) < dogHalfW + oHalf - 12 && dogBot > oTop + 8 && dogTop < oBot) {
        // graze check if near top
        crash(g, ob);
      } else if (!ob.counted && Math.abs(sx - DOG_X) < dogHalfW + oHalf + 6 && dogBot > oTop - 14 && dogBot <= oTop + 8) {
        // graze: tiny shake once when passing
        if (Math.abs(sx - DOG_X) < 20) { shake(g.j, 3); }
      }
    } else { // cat
      const oTop = ob.base - 100, oBot = ob.base, oHalf = 24;
      if (Math.abs(sx - DOG_X) < dogHalfW + oHalf - 14) {
        const clearedByJump = dogBot < ob.base - 52;
        const clearedByDuck = g.duck && g.grounded;
        if (!clearedByJump && !clearedByDuck && dogBot > oTop && dogTop < oBot) crash(g, ob);
      }
    }
  }

  // cleanup
  g.obs = g.obs.filter(o => o.wx > g.world - 200);
  g.bones = g.bones.filter(b => !b.taken && b.wx > g.world - 200);
  g.fences = g.fences.filter(f => f.wx + f.len > g.world - 200);

  if (g.world >= GOAL_PX) { burst(g.j, g.r, DOG_X + 200, 200, 40, "#ffd23f", 6, 7); burst(g.j, g.r, DOG_X + 200, 200, 30, "#5aa0ff", 5, 6); endRun(g, true); }
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [255, 226, 170], [255, 248, 225]);
  // sun + clouds parallax
  draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(850, 70, 34, 0, Math.PI*2, false); draw.fill();
  draw.setFillStyle("rgba(255,255,255,0.9)");
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 260 - (g.world * 0.15) % 260) + 260*5) % (W+120) - 60;
    draw.beginPath(); draw.arc(cx, 60 + (i%3)*28, 22, 0, Math.PI*2, false); draw.arc(cx+24, 60+(i%3)*28, 16, 0, Math.PI*2, false); draw.fill();
  }
  // houses layer
  for (let i = 0; i < 8; i++) {
    const hx = i * 150 - (g.world * 0.35 % 150);
    draw.setFillStyle(i%2 ? "#f2c38a" : "#e8b4a0"); draw.fillRect(hx, 300, 110, 110);
    draw.setFillStyle("#b5654a"); draw.beginPath(); draw.moveTo(hx-5,300); draw.lineTo(hx+55,265); draw.lineTo(hx+115,300); draw.closePath(); draw.fill();
    draw.setFillStyle("#fff3d6"); draw.fillRect(hx+18,330,24,28); draw.fillRect(hx+65,330,24,28);
  }
  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // street
  draw.setFillStyle("#f7ead0"); draw.fillRect(0, GROUND, W, H-GROUND);
  draw.setFillStyle("#d9c49a"); draw.fillRect(0, GROUND, W, 8);
  draw.setFillStyle("rgba(120,90,50,0.25)");
  for (let i = 0; i < 10; i++) { const px = i*110 - (g.world % 110); draw.fillRect(px, GROUND+42, 55, 6); }
  // paw trail
  draw.setFillStyle("rgba(140,100,60,0.35)");
  for (let i = 0; i < 12; i++) { const px = i*90 - (g.world % 90); draw.beginPath(); draw.arc(px, GROUND+62 + (i%2)*10, 6, 0, Math.PI*2, false); draw.fill(); }

  // fences (platforms)
  for (const f of g.fences) {
    const sx = DOG_X + (f.wx - g.world); if (sx + f.len < -50 || sx > W+50) continue;
    const top = GROUND - 58;
    // draw repeated fence sprite segments
    const segW = 110;
    for (let x = sx; x < sx + f.len; x += segW) drawSprite(draw, s.fence!, x + segW/2, top + 26, 62);
    draw.setFillStyle("#8a5a2b"); draw.fillRect(sx, top, f.len, 8);
  }

  // signs
  for (const sg of g.signs) {
    const sx = DOG_X + (sg.wx - g.world); if (sx < -120 || sx > W+160) continue;
    const wig = sg.wig > 0 ? dsin(g.frame * 0.35) * 0.08 : 0; if (sg.wig>0 && g.scene==="play") {} // wig decremented visually only
    const hgt = sg.big ? 210 : 125;
    drawSprite(draw, s.sign!, sx, GROUND - hgt/2 + 10, hgt, { rot: wig });
    if (sg.big) { draw.setFillStyle("#2a6fd6"); draw.fillRect(sx-90, GROUND-hgt-28, 180, 34); text(draw, "BUS STOP", sx, GROUND-hgt-11, 22, "#ffffff", "center"); }
    else text(draw, `${sg.m}m`, sx, GROUND - hgt - 6, 16, "#2a6fd6", "center");
  }

  // bones
  for (const b of g.bones) {
    const sx = DOG_X + (b.wx - g.world); if (sx < -40 || sx > W+40) continue;
    drawSprite(draw, s.bone!, sx, b.y + dsin(g.frame*0.08 + b.wx*0.05)*4, 42, { rot: dsin(g.frame*0.06 + b.wx)*0.35 });
  }

  // obstacles
  for (const ob of g.obs) {
    const sx = DOG_X + (ob.wx - g.world); if (sx < -80 || sx > W+80) continue;
    if (ob.kind === "hydrant") drawSprite(draw, s.hydrant!, sx, ob.base - 38, 82, { alpha: ob.hit ? 0.55 : 1 });
    else {
      drawSprite(draw, s.cat!, sx, ob.base - 62, 128);
      // swiping paw indicator
      const pawY = ob.base - 98 + dsin(g.frame*0.12)*6;
      draw.setFillStyle("#444"); draw.beginPath(); draw.arc(sx-42, pawY, 10, 0, Math.PI*2, false); draw.fill();
    }
  }

  // dog
  const invBlink = g.invuln > 0 && Math.floor(g.frame/4)%2===0;
  let sxD = 1, syD = 1, dogH = 118, rot = 0, cxOff = 0;
  if (g.charging) {
    const wob = dsin(g.frame*0.7)*0.04*g.charge;
    sxD = 1 + g.charge*0.95; syD = 1 - g.charge*0.32; rot = wob; cxOff = g.charge*34;
    if (g.chargeTime < 8) { syD = 0.78; sxD = 1.15; } // initial squash
  } else if (g.duck) { syD = 0.62; sxD = 1.18; dogH = 105; }
  else if (!g.grounded) { const st = Math.min(0.3, Math.abs(g.vy)*0.022); sxD = 1+st; syD = 1-st*0.4; rot = Math.max(-0.18, Math.min(0.28, g.vy*0.016)); }
  else { const b = Math.abs(dsin(g.frame*0.28)); syD = 1 - b*0.05; sxD = 1 + b*0.05; }
  const dogCY = g.feet - dogH/2 * syD + (g.duck?12:0);
  // speed lines when airborne fast
  if (!g.grounded && g.chargeAtLaunch > 0.4) {
    draw.setStrokeStyle("rgba(100,80,50,0.45)"); draw.setLineWidth(3);
    for (let i=0;i<4;i++){ draw.beginPath(); draw.moveTo(DOG_X-90-i*12, dogCY-30+i*22); draw.lineTo(DOG_X-45-i*12, dogCY-30+i*22); draw.stroke(); }
  }
  if (g.scene === "play") drawSprite(draw, s.dog!, DOG_X + cxOff, dogCY, dogH, { sx: sxD, sy: syD, rot, alpha: invBlink?0.35:1 });
  // charge meter
  if (g.charging) {
    draw.setFillStyle("rgba(0,0,0,0.45)"); draw.fillRect(DOG_X-55, g.feet-175, 110, 14);
    draw.setFillStyle(g.charge>0.85?"#ff5a5a":g.charge>0.45?"#ffd23f":"#7be495"); draw.fillRect(DOG_X-52, g.feet-172, 104*g.charge, 8);
    text(draw, g.charge>0.85?"MAX!":"STRETCH...", DOG_X, g.feet-190, 15, "#8a5a2b", "center");
  }
  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 58, "rgba(60,35,10,0.55)");
    const m = Math.min(GOAL_M, Math.floor(g.world / PX_M));
    text(draw, `${m} / ${GOAL_M}m`, 30, 42, 24, "#ffd23f");
    // tumbles
    for (let i=0;i<3;i++){ draw.setFillStyle(i<g.lives?"#ff6b6b":"rgba(255,255,255,0.25)"); draw.beginPath(); draw.arc(300+i*34, 41, 11, 0, Math.PI*2, false); draw.fill(); }
    text(draw, "TUMBLES", 285, 20, 10, "#fff", "center");
    // progress bar
    panel(draw, 460, 12, 486, 58, "rgba(60,35,10,0.55)");
    draw.setFillStyle("rgba(255,255,255,0.3)"); draw.fillRect(476, 34, 454, 12);
    draw.setFillStyle("#5aa0ff"); draw.fillRect(476, 34, 454 * Math.min(1, g.world/GOAL_PX), 12);
    for (const mm of [150,300,450,600]) { const px = 476 + 454*mm/600; draw.setFillStyle("#fff"); draw.fillRect(px-2,30,4,20); }
    text(draw, "BUS STOP →", 930, 58, 12, "#fff", "right");
    // bone streak
    panel(draw, 14, 78, 210, 36, "rgba(60,35,10,0.45)");
    text(draw, `STREAK ${g.streak}/5`, 26, 96, 15, "#ffd23f");
    text(draw, `TOTAL ${g.bonesTotal}`, 210, 96, 13, "#fff", "right");
    if (g.banner > 0) {
      panel(draw, W/2-220, 86, 440, 52, "rgba(42,111,214,0.85)");
      text(draw, g.bannerText, W/2, 112, 24, "#ffffff", "center", "bangers");
    }
    if (g.runFrames < 260) {
      panel(draw, W/2-330, H-58, 660, 44, "rgba(0,0,0,0.5)");
      text(draw, "HOLD SPACE to stretch, RELEASE to snap!  ↓ DUCK under cats", W/2, H-36, 17, "#ffffff", "center");
    }
  }

  // overlays English custom
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene==="title"?"rgba(40,20,0,0.28)":"rgba(0,0,0,0.55)"); draw.fillRect(0,0,W,H);
    const bob = dsin(g.frame*0.05)*6;
    if (g.scene === "title") {
      // big dog on title
      drawSprite(draw, s.dog!, W/2, 210+bob, 150, { sx: 1.25, sy: 0.92 });
      text(draw, "LONG DOG DASH", W/2, 330+bob, 68, "#ffd23f", "center", "bangers");
      text(draw, "Catch the bus home at 600 meters!", W/2, 385, 22, "#ffffff", "center");
      text(draw, "HOLD + RELEASE SPACE: stretch & snap  •  DOWN: duck  •  5 bones = tumble back", W/2, 420, 17, "#fff3d6", "center");
      if (Math.floor(g.frame/30)%2===0) text(draw, "PRESS ENTER TO START", W/2, 475, 26, "#ffffff", "center");
    } else if (g.scene === "won") {
      text(draw, "YOU CAUGHT THE BUS!", W/2, 220+bob, 62, "#ffd23f", "center", "bangers");
      drawSprite(draw, s.dog!, W/2, 330, 140, { sx:1.2 });
      drawSprite(draw, s.sign!, W/2+190, 300, 170);
      text(draw, `Bones: ${g.bonesTotal}   Perfect landings: ${g.perfects}   Tumbles left: ${g.lives}`, W/2, 430, 22, "#ffffff", "center");
      if (Math.floor(g.frame/30)%2===0) text(draw, "PRESS ENTER TO PLAY AGAIN", W/2, 480, 24, "#ffffff", "center");
    } else {
      text(draw, "OH NO! TRIPPED UP!", W/2, 220+bob, 62, "#ff8a8a", "center", "bangers");
      drawSprite(draw, s.dog!, W/2, 330, 130, { rot: 0.5, sy: 0.8 });
      text(draw, `You reached ${Math.floor(g.world/PX_M)}m of 600m  •  Bones: ${g.bonesTotal}`, W/2, 430, 22, "#ffffff", "center");
      if (Math.floor(g.frame/30)%2===0) text(draw, "PRESS ENTER TO TRY AGAIN", W/2, 480, 24, "#ffffff", "center");
    }
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Long Dog Dash" },
  clear: { r: 1, g: 0.94, b: 0.84 },
  options: {},
  neutral: 0,
  encode: encodeKeys,
  random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1);
    let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((s) => { sprites = s; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => {
        let h = g.frame * 31 + g.lives * 7 + g.bonesTotal * 13 + Math.round(g.world * 10) + Math.round(g.feet * 10);
        for (const o of g.obs) h = (Math.imul(h, 16777619) ^ Math.round(o.wx)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: Math.min(1, g.world / GOAL_PX), scene: g.scene, lives: g.lives, meters: Math.floor(g.world / PX_M), bones: g.bonesTotal }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
