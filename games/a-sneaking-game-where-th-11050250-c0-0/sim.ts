import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["mouse", "lamp", "cat", "text", "cheese", "rug"];
const HOLE = { x: 72, y: 462 };
const CHEESE = { x: 862, y: 448 };

interface Mote { x: number; y: number; s: number; p: number }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  x: number; y: number; vx: number; vy: number; face: number; stepPh: number;
  rugX: number; rugY: number; under: boolean; wasUnder: boolean;
  wake: number; delivered: number; carrying: boolean; playFrames: number;
  titleX: number; squeakT: number; catShakeT: number; flash: number;
  motes: Mote[]; j: Juice;
}
const fresh = (seed: number, scene: Scene = "title"): Game => {
  const r = rng(seed);
  const motes: Mote[] = [];
  for (let i = 0; i < 36; i++) motes.push({ x: range(r, 80, 880), y: range(r, 120, 500), s: range(r, 1.5, 3.5), p: range(r, 0, 6.28) });
  return {
    scene, sceneFrames: 0, frame: 0, prev: 0, r,
    x: 120, y: 455, vx: 0, vy: 0, face: 1, stepPh: 0,
    rugX: 155, rugY: 438, under: false, wasUnder: false,
    wake: 0, delivered: 0, carrying: false, playFrames: 0,
    titleX: 80, squeakT: 0, catShakeT: 0, flash: 0, motes, j: juice(),
  };
};

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++;
  juiceStep(g.j); if (g.flash > 0) g.flash--;
  // title rug-lump creep on arrows
  if (g.scene === "title") {
    if (keys & KEY.right) g.titleX += 1.6; if (keys & KEY.left) g.titleX -= 1.6;
    g.titleX += 0.35; if (g.titleX > W + 80) g.titleX = -80;
  }
  if (sceneStep(g, edge)) Object.assign(g, fresh(g.r.s, "play"), { prev: keys });
  if (g.scene !== "play") return;
  g.playFrames++;

  const level = Math.min(4, Math.floor(g.playFrames / 1200)); // every 20s
  const dx = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const dy = (keys & KEY.down ? 1 : 0) - (keys & KEY.up ? 1 : 0);
  const moving = dx !== 0 || dy !== 0;
  const nearRug = Math.hypot(g.x - g.rugX, g.y - g.rugY) < 105;
  const wantUnder = (keys & KEY.action) !== 0;
  g.under = wantUnder && (g.under || nearRug);
  if (wantUnder && !g.under && (edge & KEY.action)) floatText(g.j, g.x, g.y - 55, "NEED THE RUG!", "#ffd9a0");
  if (g.under && !g.wasUnder) { burst(g.j, g.r, g.x, g.y + 10, 12, "#d8c8b0", 2.5, 5); g.x = g.rugX; g.y = g.rugY; }
  if (!g.under && g.wasUnder) burst(g.j, g.r, g.x, g.y, 10, "#e8b4b8", 2.5, 5);
  g.wasUnder = g.under;

  const carryBoost = g.carrying ? 1 + 0.3 * (g.delivered + 1) * 0.5 + 0.15 * g.delivered : 1; // carrying: faster each trip
  // clearer: first carry 1.3x roughly, scaling
  const speedMult = g.carrying ? (1.15 + 0.3 * (g.delivered + 1) * 0.5) : 1;
  void carryBoost;
  const baseSpeed = g.under ? 2.05 : 3.6 * speedMult;
  let mx = dx, my = dy;
  if (moving) { const l = Math.hypot(mx, my); mx /= l; my /= l; if (dx) g.face = dx > 0 ? 1 : -1; }
  g.vx = mx * baseSpeed; g.vy = my * baseSpeed;
  g.x = Math.max(38, Math.min(W - 38, g.x + g.vx));
  g.y = Math.max(118, Math.min(502, g.y + g.vy));
  if (g.under) { g.rugX = g.x; g.rugY = g.y; }
  if (moving) g.stepPh += g.under ? 0.12 : 0.22;

  // Lamp light
  const t = g.playFrames / 60;
  const amp = 130 + level * 28, spd = 0.55 + level * 0.14;
  const lx = 480 + dsin(t * spd) * amp, ly = 292 + dcos(t * spd * 0.72) * 46;
  const lightR = 165 + level * 8;
  const inLight = Math.hypot(g.x - lx, g.y - ly) < lightR;
  const exposed = moving && inLight && !g.under;

  if (exposed) {
    const fillMult = (g.carrying ? 1.3 + 0.3 * g.delivered : 1) * (1 + level * 0.16);
    g.wake += 0.22 * fillMult;
    g.squeakT++;
    if (g.squeakT % 18 === 0) { burst(g.j, g.r, g.x, g.y + 18, 5, "#ffe94a", 3, 6); floatText(g.j, g.x + range(g.r, -18, 18), g.y - 42, "squeak!", "#ffe94a"); }
    if (g.wake > 65 && g.frame % 24 === 0) shake(g.j, 3);
  } else {
    g.wake -= g.under ? 0.22 : moving ? 0.14 : 0.20;
    if (moving && g.frame % 16 === 0) burst(g.j, g.r, g.x, g.y + 20, 2, g.under ? "#cbb79a" : "#9a8a76", 1.2, 4);
  }
  g.wake = Math.max(0, Math.min(100, g.wake));

  // Cheese pickup: must pop out
  if (!g.carrying && !g.under && Math.hypot(g.x - CHEESE.x, g.y - CHEESE.y) < 78) {
    g.carrying = true; burst(g.j, g.r, CHEESE.x, CHEESE.y - 20, 20, "#ffd23f", 5, 7);
    floatText(g.j, g.x, g.y - 60, "GOT A BITE!", "#ffd23f"); shake(g.j, 4);
  }
  if (g.carrying && Math.hypot(g.x - HOLE.x, g.y - HOLE.y) < 74) {
    g.carrying = false; g.delivered++;
    burst(g.j, g.r, HOLE.x + 20, HOLE.y - 20, 24, "#ffd23f", 5, 7);
    floatText(g.j, HOLE.x + 55, HOLE.y - 70, "+1 BITE!", "#ffd23f"); shake(g.j, 6);
    if (g.delivered >= 3) { endRun(g, true); return; }
    else floatText(g.j, W / 2, 110, `NEXT BITE: FASTER & RISKIER!`, "#ffb3a0");
  }
  if (g.wake >= 100) { g.flash = 18; shake(g.j, 22); burst(g.j, g.r, g.x, g.y, 30, "#ffffff", 7, 8); endRun(g, false); }
}

type Draw = Parameters<NonNullable<SimRun["render"]>>[0];
function render(g: Game, draw: Draw, s: Record<string, Sprite>): void {
  sky(draw, W, H, [24, 22, 48], [62, 42, 34]);
  // wall & floor planks
  draw.setFillStyle("#2a2036"); draw.fillRect(0, 0, W, 104);
  draw.setFillStyle("#4a3220"); draw.fillRect(0, 104, W, H - 104);
  draw.setStrokeStyle("rgba(0,0,0,0.25)"); draw.setLineWidth(2);
  for (let i = 0; i < 9; i++) { draw.beginPath(); draw.moveTo(0, 130 + i * 48); draw.lineTo(W, 130 + i * 48); draw.stroke(); }
  for (let i = 0; i < 12; i++) { draw.beginPath(); draw.moveTo(i * 86 + (i % 2) * 30, 104); draw.lineTo(i * 86 + (i % 2) * 30, H); draw.stroke(); }
  // baseboard
  draw.setFillStyle("#6b4a2c"); draw.fillRect(0, 98, W, 10);

  const level = Math.min(4, Math.floor(g.playFrames / 1200));
  const t = g.playFrames / 60;
  const amp = 130 + level * 28, spd = 0.55 + level * 0.14;
  const lx = g.scene === "title" ? 480 + dsin(g.frame * 0.012) * 120 : 480 + dsin(t * spd) * amp;
  const ly = g.scene === "title" ? 292 : 292 + dcos(t * spd * 0.72) * 46;
  const lightR = 165 + level * 8;

  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);

  // lamp light circle
  draw.setGlobalAlpha(0.20); draw.setFillStyle("#ffdf7a"); draw.beginPath(); draw.arc(lx, ly, lightR + 18, 0, Math.PI * 2, false); draw.fill();
  draw.setGlobalAlpha(0.32); draw.beginPath(); draw.arc(lx, ly, lightR, 0, Math.PI * 2, false); draw.fill();
  draw.setGlobalAlpha(1);
  // dust motes in beam
  for (const m of g.motes) {
    if (Math.hypot(m.x - lx, m.y - ly) < lightR) { draw.setGlobalAlpha(0.5 + 0.4 * dsin(g.frame * 0.08 + m.p)); draw.setFillStyle("#fff2a8"); draw.beginPath(); draw.arc(m.x + dsin(g.frame * 0.02 + m.p) * 6, m.y + dcos(g.frame * 0.015 + m.p) * 4, m.s, 0, Math.PI * 2, false); draw.fill(); }
  }
  draw.setGlobalAlpha(1);

  // mouse hole
  draw.setFillStyle("#120d0a"); draw.beginPath(); draw.arc(HOLE.x, HOLE.y + 18, 42, Math.PI, 0, false); draw.lineTo(HOLE.x + 42, HOLE.y + 26); draw.lineTo(HOLE.x - 42, HOLE.y + 26); draw.closePath(); draw.fill();
  draw.setStrokeStyle("#c99a5b"); draw.setLineWidth(5); draw.beginPath(); draw.arc(HOLE.x, HOLE.y + 18, 42, Math.PI, 0, false); draw.stroke();
  text(draw, "HOME", HOLE.x, HOLE.y + 38, 13, "#ffd9a0", "center");

  // cheese (shrinks per bite taken/delivered conceptually: remaining bites)
  const remaining = 3 - g.delivered - (g.carrying ? 1 : 0);
  if (remaining > 0 || g.scene === "title") {
    const chH = 92 + (remaining - 1) * 8;
    drawSprite(draw, s.cheese!, CHEESE.x, CHEESE.y, chH, { rot: dsin(g.frame * 0.03) * 0.04 });
    text(draw, `${Math.max(1, remaining)} BITE${remaining === 1 ? "" : "S"} LEFT`, CHEESE.x, CHEESE.y + 62, 13, "#ffe94a", "center");
  }

  // rug (under or free)
  const rugBob = g.under ? Math.abs(dsin(g.stepPh)) * 5 : 0;
  if (!g.under && g.scene !== "title") drawSprite(draw, s.rug!, g.rugX, g.rugY, 104, { rot: 0.06 });
  // cat
  const catX = 852, catY = 138;
  const breathe = 1 + dsin(g.frame * (0.04 + g.wake * 0.0012)) * 0.035;
  const pounce = g.scene === "lost" ? Math.min(1, g.sceneFrames / 28) : 0;
  const px = catX + (g.x - catX) * pounce * 0.75, py = catY + (g.y - catY) * pounce * 0.75;
  const catH = g.scene === "title" ? 190 : 138 + pounce * 110;
  drawSprite(draw, s.cat!, px, py, catH, { sy: breathe, sx: 2 - breathe, rot: pounce * 0.4 });
  // Zzz (text sprite) above cat
  if (g.scene !== "lost") {
    const zSpeed = 0.02 + g.wake * 0.0009, zSize = 62 - g.wake * 0.28;
    for (let i = 0; i < 3; i++) {
      const ph = ((g.frame * zSpeed + i * 0.33) % 1);
      drawSprite(draw, s.text!, catX - 55 + ph * 28 + i * 8, catY - 72 - ph * 46, Math.max(24, zSize * (0.7 + ph * 0.5)), { alpha: 1 - ph * 0.7, rot: ph * 0.3 });
    }
  } else { text(draw, "POUNCE!", px, py - 90, 34, "#ff8a8a", "center", "bangers"); }

  // lamp fixture
  draw.setStrokeStyle("#1a1420"); draw.setLineWidth(6); draw.beginPath(); draw.moveTo(480, 0); draw.lineTo(480 + dsin(t * spd) * 22, 42); draw.stroke();
  drawSprite(draw, s.lamp!, 480 + dsin((g.scene === "title" ? g.frame * 0.012 : t * spd)) * 22, 58, 104, { rot: dsin((g.scene === "title" ? g.frame * 0.012 : t * spd)) * 0.12 });

  // mouse / rug-lump
  if (g.scene === "play" || g.scene === "won" || g.scene === "lost") {
    if (g.under) {
      drawSprite(draw, s.rug!, g.x, g.y - rugBob, 108, { sx: 1.05, sy: 0.92 + rugBob * 0.01, rot: dsin(g.stepPh) * 0.05 });
      if (g.carrying) drawSprite(draw, s.cheese!, g.x, g.y - 48 - rugBob, 38, {});
      // little feet
      draw.setFillStyle("#e8a0b4");
      draw.beginPath(); draw.arc(g.x - 22, g.y + 30 + rugBob * 0.4, 7, 0, Math.PI * 2, false); draw.fill();
      draw.beginPath(); draw.arc(g.x + 22, g.y + 30 - rugBob * 0.4, 7, 0, Math.PI * 2, false); draw.fill();
    } else if (!(g.scene === "lost" && pounce > 0.6)) {
      const bounce = Math.abs(dsin(g.stepPh)) * (g.vx || g.vy ? 1 : 0);
      drawSprite(draw, s.mouse!, g.x, g.y - bounce * 5, 96, { flip: g.face < 0, sx: 1 + bounce * 0.07, sy: 1 - bounce * 0.07 });
      if (g.carrying) drawSprite(draw, s.cheese!, g.x + g.face * 28, g.y - 38, 44, { rot: dsin(g.frame * 0.15) * 0.15 });
    }
  }
  drawJuice(draw, g.j);
  draw.restore();
  if (g.flash > 0) { draw.setGlobalAlpha(Math.min(0.9, g.flash / 14)); draw.setFillStyle("#ffffff"); draw.fillRect(0, 0, W, H); draw.setGlobalAlpha(1); }

  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 62, "rgba(10,8,20,0.62)");
    text(draw, `🧀 BITES  ${g.delivered} / 3 ${g.carrying ? "• CARRYING!" : ""}`, 30, 32, 20, "#ffd23f");
    // wake bar
    draw.setFillStyle("#222"); draw.fillRect(30, 52, 260, 12);
    draw.setFillStyle(g.wake > 70 ? "#ff5a5a" : g.wake > 40 ? "#ffb347" : "#7ec8ff"); draw.fillRect(30, 52, 260 * g.wake / 100, 12);
    text(draw, `WAKE ${Math.floor(g.wake)}%`, 306, 58, 14, "#fff");
    text(draw, `LAMP Lv${level + 1}  ${g.under ? "HIDDEN 🧶" : "EXPOSED"}`, 30, 88, 15, "#ffd9a0");
    panel(draw, W - 342, 12, 328, 50, "rgba(10,8,20,0.55)");
    text(draw, "ARROWS/WASD move • HOLD SPACE = rug", W - 326, 38, 14, "#ffffff");
  }

  // overlays English custom
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(5,4,18,0.42)" : "rgba(5,4,18,0.62)"); draw.fillRect(0, 0, W, H);
    if (g.scene === "title") {
      // title cat already behind? draw big title
      const bob = dsin(g.frame * 0.05) * 6;
      text(draw, "SQUEAK IN THE DARK", W / 2, 150 + bob, 58, "#ffd23f", "center", "bangers");
      text(draw, "wear the rug!", W / 2, 202 + bob, 30, "#ff9db0", "center", "bangers");
      panel(draw, W / 2 - 330, 238, 660, 118, "rgba(0,0,0,0.55)");
      text(draw, "Hold SPACE on the rug to hide & creep safely through light.", W / 2, 268, 17, "#fff", "center");
      text(draw, "Pop out to grab cheese, carry 3 bites home — don't wake the cat!", W / 2, 296, 17, "#ffe9a0", "center");
      text(draw, "Moving in lamplight fills WAKE. Standing still is safe.", W / 2, 324, 15, "#bcd8ff", "center");
      // rug lump creeping bottom
      drawSprite(draw, s.rug!, g.titleX, 448, 92, { sy: 0.9, rot: dsin(g.frame * 0.2) * 0.04 });
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "PRESS ENTER TO START", W / 2, 400, 26, "#fff", "center");
      text(draw, "← → try it: the rug-lump creeps!", W / 2, 500, 15, "#ffd9a0", "center");
    } else if (g.scene === "won") {
      text(draw, "YOU DID IT, SQUEAK!", W / 2, 190, 56, "#ffd23f", "center", "bangers");
      text(draw, "All 3 cheese bites are safe in the mouse hole! 🧀", W / 2, 260, 22, "#fff", "center");
      drawSprite(draw, s.cheese!, W / 2 - 70, 340, 80, {}); drawSprite(draw, s.mouse!, W / 2 + 70, 340, 100, {});
      if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "PRESS ENTER TO PLAY AGAIN", W / 2, 440, 24, "#fff", "center");
    } else {
      text(draw, "THE CAT WOKE UP!", W / 2, 190, 56, "#ff8a8a", "center", "bangers");
      text(draw, `Caught! You delivered ${g.delivered} / 3 bites.`, W / 2, 260, 22, "#fff", "center");
      if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "PRESS ENTER TO TRY AGAIN", W / 2, 440, 24, "#fff", "center");
    }
  }
}

export default defineSim({
  players: 1, window: { width: W, height: H, title: "Squeak in the Dark (wear the rug!)" },
  clear: { r: 0.08, g: 0.07, b: 0.14 }, options: {}, neutral: 0, encode: encodeKeys, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((s) => { sprites = s; });
    return {
      ready, start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => (Math.imul(g.frame, 31) + Math.round(g.x * 10) + Math.round(g.y) + g.delivered * 997 + Math.round(g.wake * 10) + (g.carrying ? 13 : 0)) >>> 0,
      state: () => {
        const maxD = 820;
        const partial = g.carrying
          ? 0.20 + 0.13 * (1 - Math.min(1, Math.hypot(g.x - HOLE.x, g.y - HOLE.y) / maxD))
          : 0.16 * (1 - Math.min(1, Math.hypot(g.x - CHEESE.x, g.y - CHEESE.y) / maxD));
        return { outcome: outcomeOf(g.scene), progress: Math.min(1, g.delivered / 3 + partial), scene: g.scene, bites: g.delivered, wake: Math.round(g.wake), carrying: g.carrying };
      },
      over: () => false, save: () => structuredClone(g), restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g, render: (draw) => render(g, draw, sprites),
    };
  },
});
