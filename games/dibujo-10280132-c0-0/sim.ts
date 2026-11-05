import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf, overlay,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["cat", "sun", "tree", "house", "car"];
const GROUND = 472;
const TREE_X = 292;
const CAR_START = 352;
const HOUSE_X = 826;
const GOAL_X = 762;
const TIME_LIMIT = 90 * 60;

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  sunX: number; sunVX: number; burstT: number; burstCD: number;
  treeA: number; treeAV: number; treeLen: number; growth: number; growthT: number; sway: number;
  carX: number; carVX: number; carBounce: number; carBV: number; carTilt: number; carTV: number; lastCarVX: number;
  catOff: number; catVel: number; sleep: number; wheel: number;
  timeLeft: number; contact: number; perfect: boolean; j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  sunX: 620, sunVX: 0, burstT: 0, burstCD: 0,
  treeA: 0.25, treeAV: 0, treeLen: 252, growth: 0, growthT: 0, sway: 0,
  carX: CAR_START, carVX: 0, carBounce: 0, carBV: 0, carTilt: 0, carTV: 0, lastCarVX: 0,
  catOff: 0, catVel: 0, sleep: 100, wheel: 0,
  timeLeft: TIME_LIMIT, contact: 0, perfect: false, j: juice(),
});

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function copaPos(g: Game) {
  return { x: TREE_X + dsin(g.treeA) * g.treeLen, y: GROUND - dcos(g.treeA) * g.treeLen, r: 86 + g.growth * 7 };
}

function resetRun(g: Game, keys: number) {
  const seed = g.r.s;
  Object.assign(g, fresh(seed, "play"), { prev: keys });
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j, 0.12);
  if (sceneStep(g, edge)) { resetRun(g, keys); return; }
  if (g.scene !== "play") {
    // Title demo: sun chases side to side, tree follows, cat sleeps.
    g.sunX = 500 + dsin(g.frame * 0.018) * 310;
    const target = clamp((g.sunX - TREE_X) / 520, -0.7, 0.85);
    g.treeAV += (target - g.treeA) * 0.006 - g.treeAV * 0.04;
    g.treeA += g.treeAV;
    if (g.frame % 90 === 0) g.j.texts.push({ x: g.carX + 30, y: 330, text: "Zzz", life: 50, color: "#7a5cff" });
    return;
  }
  if ((edge & KEY.start) !== 0) { resetRun(g, keys); return; }

  g.timeLeft--;
  if (g.timeLeft <= 0) { floatText(g.j, W/2, 180, "¡SE ACABÓ EL TIEMPO!", "#ff8a8a"); endRun(g, false); return; }

  // --- Sun ---
  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  g.sunVX += dir * 2.0;
  g.sunVX *= 0.78;
  g.sunX = clamp(g.sunX + g.sunVX, 55, 905);
  if (g.burstCD > 0) g.burstCD--;
  if (g.burstT > 0) g.burstT--;
  if ((edge & KEY.action) !== 0 && g.burstCD <= 0) {
    g.burstCD = 110; g.burstT = 22;
    // Light burst: tree thrusts toward sun, pollen explodes
    const target0 = clamp((g.sunX - TREE_X) / 520, -0.85, 0.95);
    g.treeAV += (target0 - g.treeA) * 0.22 + (target0 >= g.treeA ? 0.035 : -0.035);
    burst(g.j, g.r, g.sunX, 92, 26, "#ffd23f", 5, 7);
    burst(g.j, g.r, copaPos(g).x, copaPos(g).y, 18, "#ffe98a", 4, 5);
    floatText(g.j, g.sunX, 150, "¡RÁFAGA DE LUZ!", "#ffb800");
    shake(g.j, 3);
  }

  // --- Growth every 10 seconds ---
  g.growthT++;
  if (g.growthT >= 600 && g.growth < 6) {
    g.growthT = 0; g.growth++;
    g.treeLen += 22;
    const c = copaPos(g);
    burst(g.j, g.r, c.x, c.y, 34, "#ffd76a", 5, 6);
    burst(g.j, g.r, c.x, c.y, 20, "#7cc47f", 4, 6);
    floatText(g.j, c.x, c.y - 80, `¡LA COPA CRECE! x${g.growth + 1}`, "#2e8b3a");
    shake(g.j, 4);
  }
  // Instability grows with copa mass
  g.sway = dsin(g.frame * 0.021) * 0.018 * (1 + g.growth * 0.45) + dsin(g.frame * 0.0073) * 0.012 * g.growth;

  // --- Tree lever physics ---
  const target = clamp((g.sunX - TREE_X) / 340, -0.85, 1.08) + g.sway;
  const stiffness = g.burstT > 0 ? 0.02 : 0.011;
  const damping = 0.95 - g.growth * 0.003; // heavier = more wobbly
  g.treeAV += (target - g.treeA) * stiffness;
  g.treeAV *= damping;
  g.treeA += g.treeAV;
  // pollen while growing / moving fast
  if (Math.abs(g.treeAV) > 0.012 && g.frame % 6 === 0) {
    const c = copaPos(g);
    burst(g.j, g.r, c.x + range(g.r, -30, 30), c.y + range(g.r, -20, 20), 2, "#ffd76a", 1.5, 4);
  }

  // --- Copa velocity ---
  const c = copaPos(g);
  const copaVX = dcos(g.treeA) * g.treeLen * g.treeAV; // px/frame at tip
  const copaVY = dsin(g.treeA) * g.treeLen * g.treeAV;

  // --- Car physics ---
  const prevVX = g.carVX;
  g.carVX *= 0.99; // rolling friction
  if (Math.abs(g.carVX) < 0.02) g.carVX = 0;
  g.carX += g.carVX;
  g.wheel += g.carVX * 0.08;
  // small bumps
  for (const bx of [455, 625]) {
    if (Math.abs(g.carX - bx) < 14 && Math.abs(g.carVX) > 1.2 && Math.abs(g.carBV) < 0.5) {
      g.carBV = -Math.min(3.2, Math.abs(g.carVX) * 0.55);
      g.catVel += g.carVX * 0.06;
      burst(g.j, g.r, g.carX, GROUND - 8, 8, "#b8a07a", 3, 4);
    }
  }
  // suspension
  g.carBV += 0.55; g.carBounce += g.carBV;
  if (g.carBounce > 0) { g.carBounce = 0; g.carBV = 0; }
  // tilt springs from acceleration
  const accel = g.carVX - prevVX;
  g.carTV += (-accel * 0.018 - g.carTilt * 0.09) - g.carTV * 0.12;
  // Actually apply spring damping properly:
  g.carTilt = clamp(g.carTilt + g.carTV, -0.7, 0.7);

  // --- Copa vs car contact ---
  let touching = false;
  {
    const carCY = GROUND - 42 + g.carBounce;
    const closestX = clamp(c.x, g.carX - 88, g.carX + 88);
    const closestY = clamp(c.y, carCY - 36, carCY + 36);
    const dx = c.x - closestX, dy = c.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < c.r) {
      touching = true;
      const pen = c.r - dist;
      const nx = dist > 0.01 ? dx / dist : (c.x < g.carX ? -1 : 1);
      // Push car away from copa centre horizontally, weighted by copa motion
      const mass = 1 + g.growth * 0.28;
      // Lever force runs along the copa's arc tangent (right & down when leaning right).
      const tangentX = dcos(g.treeA);
      const swing = g.treeLen * g.treeAV; // tangential speed of the copa
      const push = clamp((swing * 0.62 * tangentX + pen * 0.02 * tangentX) * mass, -3.6, 4.0);
      if (Math.abs(swing) > 0.8 || pen > 16) {
        g.carVX += push;
        g.carVX = clamp(g.carVX, -5.5, 7.2);
      }
      if (dy < -10) { // copa pressing from above
        g.carBV += pen * 0.03;
        g.catVel += copaVX * 0.045;
      } else {
        g.catVel += -push * 0.10;
      }
      g.carX += (-nx) * pen * 0.18; // separate
      if (g.contact <= 0) {
        g.contact = 14;
        burst(g.j, g.r, closestX, closestY, 14, "#69b96b", 4, 6);
        burst(g.j, g.r, closestX, closestY, 8, "#ffd76a", 3, 5);
        if (Math.abs(push) > 1.2) { shake(g.j, Math.min(9, Math.abs(push) * 3)); floatText(g.j, g.carX, 300, Math.abs(push) > 2.4 ? "¡EMPUJÓN FUERTE!" : "¡EMPUJE!", "#2e8b3a"); }
        else floatText(g.j, g.carX, 300, "roce suave…", "#5a8a4a");
      }
    }
  }
  if (g.contact > 0) g.contact--;
  g.carX = clamp(g.carX, 78, 880);

  // --- Cat balance (inverted pendulum on roof) ---
  const carAccel = g.carVX - g.lastCarVX; g.lastCarVX = g.carVX;
  g.catVel += -g.catOff * 0.0042 - carAccel * 0.16 - g.carTilt * 0.35;
  g.catVel *= 0.90;
  g.catOff += g.catVel;
  // sleep: jolts hurt, calm recovers slowly
  const jolt = Math.abs(carAccel) + Math.abs(g.catVel) * 0.08;
  if (jolt > 1.1 || Math.abs(g.catOff) > 36) g.sleep -= 0.35 + Math.abs(g.catOff) * 0.004;
  else if (Math.abs(g.carVX) < 1.5) g.sleep = Math.min(100, g.sleep + 0.06);
  if (Math.abs(g.catOff) > 34 && g.frame % 3 === 0) shake(g.j, 4); // warning tremble only when about to fall
  if (g.frame % 75 === 0 && Math.abs(g.catOff) < 30) g.j.texts.push({ x: g.carX + g.catOff, y: 302 + g.carBounce, text: "Zzz", life: 55, color: "#7a5cff" });

  // Lose conditions
  if (Math.abs(g.catOff) > 52 || g.sleep <= 0) {
    burst(g.j, g.r, g.carX + g.catOff, 320, 28, "#ff9ecb", 6, 7);
    floatText(g.j, g.carX, 260, "¡EL GATO SE DESPERTÓ!", "#ff5a8a");
    shake(g.j, 14); endRun(g, false); return;
  }
  if (Math.abs(g.carTilt) > 0.62) {
    burst(g.j, g.r, g.carX, 380, 26, "#ff8a8a", 6, 6);
    floatText(g.j, g.carX, 270, "¡EL COCHE VOLCÓ!", "#ff5a5a");
    shake(g.j, 14); endRun(g, false); return;
  }
  // Win: fully into house, reasonably gentle final speed counts as perfect
  if (g.carX >= GOAL_X) {
    g.perfect = Math.abs(g.carVX) < 4.2 && g.sleep > 45;
    burst(g.j, g.r, HOUSE_X, 330, 42, "#7cc47f", 6, 7);
    burst(g.j, g.r, HOUSE_X, 330, 30, "#ffd23f", 6, 6);
    burst(g.j, g.r, g.carX, 320, 24, "#ff9ecb", 5, 6);
    floatText(g.j, W/2, 190, g.perfect ? "¡ENTRADA PERFECTA!" : "¡LLEGÓ A CASA!", "#2e8b3a");
    shake(g.j, 6); endRun(g, true); return;
  }
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [135, 206, 250], [255, 244, 200]);
  // sun glow behind sprite
  const sunY = 88 + dsin(g.frame * 0.03) * 6;
  draw.setFillStyle("rgba(255,210,63,0.25)");
  draw.beginPath(); draw.arc(g.sunX, sunY, 78 + dsin(g.frame*0.08)*6, 0, Math.PI*2, false); draw.fill();
  draw.setFillStyle("rgba(255,210,63,0.16)");
  draw.beginPath(); draw.arc(g.sunX, sunY, 105, 0, Math.PI*2, false); draw.fill();
  // distant hills + clouds
  draw.setFillStyle("#bfe8b0"); draw.fillRect(0, 380, W, 92);
  draw.setFillStyle("#8fd07e");
  for (let i=0;i<5;i++){ const x=(i*230+40)%W; draw.beginPath(); draw.arc(x,392,70,Math.PI,0,false); draw.fill(); }
  draw.setFillStyle("rgba(255,255,255,0.85)");
  for (let i=0;i<4;i++){ const x=((i*280+ g.frame*0.18)%(W+120))-60; draw.beginPath(); draw.arc(x,70+ (i%2)*36,26,0,Math.PI*2,false); draw.arc(x+24,70+(i%2)*36,20,0,Math.PI*2,false); draw.fill(); }
  // road / ground
  draw.setFillStyle("#d9b380"); draw.fillRect(0, GROUND, W, H-GROUND);
  draw.setFillStyle("#c49a68"); draw.fillRect(0, GROUND, W, 8);
  draw.setFillStyle("rgba(120,85,45,0.35)");
  for (let i=0;i<12;i++) draw.fillRect(i*84+20, GROUND+34, 38, 6);
  // bumps
  draw.setFillStyle("#a88a68");
  for (const bx of [455,625]){ draw.beginPath(); draw.arc(bx, GROUND+2, 18, Math.PI, 0, false); draw.fill(); }
  // progress track dotted
  draw.setFillStyle("rgba(255,255,255,0.7)");
  for (let x=CAR_START; x<GOAL_X; x+=36) draw.fillRect(x, GROUND+18, 16, 4);

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // House (behind car so car enters)
  const doorOpen = g.carX > 620;
  drawSprite(draw, s.house!, HOUSE_X, GROUND-98, 235, { sx: 1, sy: 1 });
  if (doorOpen) { draw.setFillStyle("rgba(60,35,10,0.85)"); draw.fillRect(HOUSE_X-24, GROUND-92, 48, 92); draw.setFillStyle("#ffd23f"); draw.fillRect(HOUSE_X-24, GROUND-92, 6, 92); }
  text(draw, doorOpen ? "¡PUERTA ABIERTA!" : "CASA", HOUSE_X, GROUND-228, 16, doorOpen ? "#2e8b3a" : "#8a6a3a", "center");

  // Tree: draw whole sprite pivoted at base by positioning centre along its axis
  const treeH = g.treeLen + 62 + g.growth*4;
  const squashTree = g.burstT>0 ? 1.08 : 1 + clamp(Math.abs(g.treeAV)*1.2,0,0.12);
  const midX = TREE_X + dsin(g.treeA) * (treeH/2 - 18);
  const midY = GROUND - dcos(g.treeA) * (treeH/2 - 18);
  drawSprite(draw, s.tree!, midX, midY, treeH, { rot: g.treeA, sx: 2-squashTree >0? 1/Math.sqrt(squashTree):1, sy: squashTree });
  // copa glow / target guide
  const c = copaPos(g);
  draw.setFillStyle("rgba(124,196,127,0.20)");
  draw.beginPath(); draw.arc(c.x, c.y, c.r+10+dsin(g.frame*0.1)*3, 0, Math.PI*2, false); draw.fill();
  // light beam sun -> copa
  draw.setFillStyle("rgba(255,220,90,0.18)");
  draw.beginPath(); draw.moveTo(g.sunX-18, sunY+20); draw.lineTo(g.sunX+18, sunY+20); draw.lineTo(c.x+24, c.y); draw.lineTo(c.x-24, c.y); draw.closePath(); draw.fill();

  // Car with suspension bounce
  const carY = GROUND - 42 + g.carBounce;
  const moving = Math.abs(g.carVX);
  // speed lines at wheels
  if (moving > 2) {
    draw.setFillStyle("rgba(255,255,255,0.7)");
    for (let i=0;i<3;i++) draw.fillRect(g.carX-95-i*14, carY+18+i*10, 28, 3);
  }
  drawSprite(draw, s.car!, g.carX, carY, 108, { rot: g.carTilt, sx: 1+Math.abs(g.carBounce)*0.01, sy: 1-Math.abs(g.carBounce)*0.012 });
  // wheels hint (rotation tick)
  draw.setFillStyle("rgba(30,60,120,0.8)");
  // Cat on roof, offset by balance
  const catX = g.carX + g.catOff, catY = carY - 72 + dsin(g.frame*0.08)*1.5;
  const catTilt = clamp(g.catOff*0.008 + g.catVel*0.02, -0.5, 0.5);
  const danger = Math.abs(g.catOff) > 34;
  drawSprite(draw, s.cat!, catX, catY, 72, { rot: catTilt, sx: danger?1.05:1, sy: danger?0.95:1 });
  if (danger) text(draw, "¡!", catX+42, catY-28, 30, "#ff3b3b", "center", "bangers");
  // sleep Zzz handled as texts; also small purr
  if (g.scene==="play" && g.frame%100<50) text(draw, "z", catX+34, catY-34-dsin(g.frame*0.1)*3, 18, "#7a5cff", "center");

  // Sun on top layer
  drawSprite(draw, s.sun!, g.sunX, sunY, g.burstT>0?96:82, { rot: dsin(g.frame*0.02)*0.15, sx: g.burstT>0?1.15:1, sy: g.burstT>0?1.15:1 });

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 58);
    const secs = Math.max(0, Math.ceil(g.timeLeft/60));
    text(draw, `${secs}s`, 30, 32, 22, secs<=15?"#ff8a8a":"#ffffff");
    text(draw, `Copa x${g.growth+1}`, 150, 32, 18, "#ffd76a");
    text(draw, g.burstCD<=0 ? "ESPACIO: ¡ráfaga lista!" : `ráfaga ${Math.ceil(g.burstCD/60)}s`, 30, 56, 15, g.burstCD<=0?"#ffe98a":"#cccccc");
    // sleep / balance meter
    panel(draw, 520, 12, 426, 58);
    text(draw, "SUEÑO DEL GATO", 538, 30, 15, "#ffffff");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(538, 46, 260, 12);
    draw.setFillStyle(g.sleep>50?"#7cc47f":g.sleep>25?"#ffd23f":"#ff5a5a"); draw.fillRect(538,46,260*clamp(g.sleep,0,100)/100,12);
    // balance needle
    draw.setFillStyle("#fff"); draw.fillRect(840, 20, 72, 8);
    draw.setFillStyle(Math.abs(g.catOff)>34?"#ff3b3b":"#333"); draw.fillRect(840+36+clamp(g.catOff,-48,48)*0.7-4, 16, 8, 18);
    text(draw, "equilibrio", 876, 52, 12, "#ddd", "center");
    // progress
    panel(draw, 14, H-38, 932, 26, "rgba(0,0,0,0.35)");
    draw.setFillStyle("#ffd23f"); draw.fillRect(22, H-30, 916*clamp((g.carX-CAR_START)/(GOAL_X-CAR_START),0,1), 10);
  } else if (g.scene === "title") {
    text(draw, "Mueve el sol · el árbol empuja · no despiertes al gato", W/2, 118, 20, "#5a3a10", "center");
  }
  const score = `Distancia ${Math.round(clamp((g.carX-CAR_START)/(GOAL_X-CAR_START),0,1)*100)}% · Sueño ${Math.round(clamp(g.sleep,0,100))}% · Copa x${g.growth+1}`;
  overlay(draw, W, H, g.scene, g.sceneFrames, "LA PALANCA DEL ÁRBOL DORMIDO", "Flechas o A/D: el sol - ESPACIO: ráfaga - ENTER: empezar", g.scene==="won" ? (g.perfect?"¡ENTRADA PERFECTA!  "+score:score) : score);
  if (g.scene==="won" && g.perfect) text(draw, "¡ENTRADA PERFECTA!", W/2, H*0.60, 34, "#7cc47f", "center", "bangers");
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "La palanca del árbol dormido" },
  clear: { r: 0.65, g: 0.85, b: 0.98 },
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
        let h = g.frame * 31 + Math.round(g.carX * 100) + Math.round(g.treeA * 1000) + g.growth * 7;
        h = (Math.imul(h, 16777619) ^ Math.round(g.catOff * 100)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: clamp((g.carX - CAR_START) / (GOAL_X - CAR_START), 0, 1), scene: g.scene, sleep: Math.round(g.sleep), carX: Math.round(g.carX), growth: g.growth }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
