import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960;
const H = 540;
const NAMES = ["girl", "carrot", "wateringcan", "chicken", "barn"];
const GOAL = 12;
const DUR = 3900; // 65 seconds until sunset
const ROW_Y = [318, 398, 478];
const CARROT_X = [430, 430, 430]; // one cycling carrot per row, x fixed per row offset below
const ROW_CARROT_X = [400, 470, 540];

interface CarrotState { stage: number; pop: number; delay: number }
interface Chicken { x: number; row: number; vx: number; ruffle: number; cluckedBeat: number }
interface Flyer { x0: number; y0: number; t: number; row: number }

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  girlRow: number; girlY: number; hop: number; pour: number;
  score: number; combo: number; maxCombo: number;
  elapsed: number; beatPhase: number; beatCount: number;
  carrots: CarrotState[];
  chickens: Chicken[];
  flyers: Flyer[];
  pulse: number; barnWiggle: number; drum: number;
  grownSteps: number;
  lastCluckFrame: number; chickenTimer: number;
  j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  girlRow: 1, girlY: ROW_Y[1]!, hop: 0, pour: 0,
  score: 0, combo: 0, maxCombo: 0,
  elapsed: 0, beatPhase: 0, beatCount: 0,
  carrots: [{ stage: 0, pop: 0, delay: 0 }, { stage: 1, pop: 0, delay: 0 }, { stage: 0, pop: 0, delay: 0 }],
  chickens: [], flyers: [],
  pulse: 0, barnWiggle: 0, drum: 0, grownSteps: 0, lastCluckFrame: -999, chickenTimer: 500,
  j: juice(),
});

function beatInterval(g: Game): number {
  const t = Math.min(1, g.elapsed / DUR);
  return 50 - 22 * t; // 50 -> 28 frames
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j);
  if (sceneStep(g, edge)) { Object.assign(g, fresh(g.r.s, "play"), { prev: keys }); return; }
  if (g.scene !== "play") {
    // title idle beat for bouncing carrot
    return;
  }

  const interval = beatInterval(g);
  g.elapsed++;
  g.beatPhase++;
  g.drum = Math.max(0, g.drum - 0.06);
  g.pulse = Math.max(0, g.pulse - 0.05);
  g.barnWiggle = Math.max(0, g.barnWiggle - 1);
  g.pour = Math.max(0, g.pour - 1);
  g.hop = Math.max(0, g.hop - 1);
  for (const c of g.carrots) { c.pop = Math.max(0, c.pop - 1); if (c.delay > 0) c.delay--; }

  if (g.beatPhase >= interval) {
    g.beatPhase -= interval;
    g.beatCount++;
    g.drum = 1;
    // soft thump particles at barn door
    burst(g.j, g.r, 835, 265, 4, "#ffd23f", 1.6, 4);
  }

  // Movement between rows
  if (edge & KEY.up) { if (g.girlRow > 0) { g.girlRow--; g.hop = 10; } }
  if (edge & KEY.down) { if (g.girlRow < 2) { g.girlRow++; g.hop = 10; } }
  const targetY = ROW_Y[g.girlRow]!;
  g.girlY += (targetY - g.girlY) * 0.35;
  if (Math.abs(targetY - g.girlY) < 1) g.girlY = targetY;

  // Chickens
  g.chickenTimer--;
  const maxChickens = g.elapsed < 900 ? 1 : g.elapsed < 2200 ? 2 : 3;
  if (g.chickenTimer <= 0 && g.chickens.length < maxChickens) {
    const fromLeft = rand01(g) < 0.5;
    const row = Math.floor(range(g.r, 0, 3)) % 3;
    g.chickens.push({ x: fromLeft ? -50 : W + 50, row, vx: (fromLeft ? 1 : -1) * range(g.r, 1.1, 1.9), ruffle: 0, cluckedBeat: -1 });
    g.chickenTimer = Math.round(range(g.r, 420, 760));
  }
  // Chicken fake cluck: shortly BEFORE the real beat (outside good window)
  const untilBeat = interval - g.beatPhase;
  for (const ch of g.chickens) {
    ch.x += ch.vx;
    ch.ruffle = Math.max(0, ch.ruffle - 1);
    if (untilBeat > 12 && untilBeat < 16 && ch.cluckedBeat !== g.beatCount && ch.x > 60 && ch.x < W - 60) {
      ch.cluckedBeat = g.beatCount;
      ch.ruffle = 16;
      g.lastCluckFrame = g.frame;
      floatText(g.j, ch.x, ROW_Y[ch.row]! - 62, "BAWK!", "#ffffff");
      burst(g.j, g.r, ch.x, ROW_Y[ch.row]! - 30, 6, "#ffffff", 2.2, 4);
    }
  }
  g.chickens = g.chickens.filter((c) => c.x > -80 && c.x < W + 80);

  // Flyers to barn
  for (const f of g.flyers) {
    f.t += 0.028;
    if (f.t >= 1 && f.t < 1.04) {
      g.barnWiggle = 18;
      burst(g.j, g.r, 835, 250, 16, "#ffd23f", 3.5, 5);
      burst(g.j, g.r, 835, 250, 10, "#ff9ec6", 3, 5);
    }
  }
  g.flyers = g.flyers.filter((f) => f.t < 1.05);

  // Action: pour / harvest on the beat
  if (edge & KEY.action) {
    g.pour = 16;
    const dist = Math.min(g.beatPhase, interval - g.beatPhase);
    const perfect = dist <= 6;
    const good = dist <= 11;
    const cx = ROW_CARROT_X[g.girlRow]!;
    const cy = ROW_Y[g.girlRow]!;
    const carrot = g.carrots[g.girlRow]!;
    const girlX = 215;

    if (!perfect && !good) {
      g.combo = 0;
      floatText(g.j, girlX + 70, cy - 95, "MISS", "#bfe8ff");
      // splash on boots
      burst(g.j, g.r, girlX + 38, cy + 38, 14, "#7ec8ff", 3, 5);
      shake(g.j, 3);
      if (g.frame - g.lastCluckFrame < 22) {
        // chicken nearly fooled you
        for (const ch of g.chickens) ch.ruffle = 16;
        floatText(g.j, girlX + 70, cy - 125, "Don't trust the chicken!", "#ffe28a");
      }
    } else if (carrot.delay > 0) {
      // empty soil: splash but no growth, keep combo (small mercy)
      burst(g.j, g.r, cx, cy - 6, 10, "#7ec8ff", 3, 5);
      floatText(g.j, cx, cy - 70, perfect ? "PERFECT!" : "GOOD", perfect ? "#ffd23f" : "#ffffff");
    } else if (carrot.stage >= 3) {
      // Harvest!
      g.score++;
      g.combo++;
      g.maxCombo = Math.max(g.maxCombo, g.combo);
      carrot.stage = 0; carrot.delay = 300; carrot.pop = 0; // soil must rest: rotate rows!
      g.grownSteps++;
      g.flyers.push({ x0: cx, y0: cy - 30, t: 0, row: g.girlRow });
      floatText(g.j, cx, cy - 105, perfect ? "PERFECT!" : "GOOD", perfect ? "#ffd23f" : "#ffffff");
      floatText(g.j, cx + 10, cy - 135, `Combo x${g.combo}!`, "#ff9ec6");
      floatText(g.j, cx, cy - 160, "Soil resting — switch rows!", "#ffe28a");
      burst(g.j, g.r, cx, cy - 30, 16, "#ffb347", 3.5, 6);
      burst(g.j, g.r, cx, cy - 30, 10, "#8be26a", 3, 5);
      if (perfect) { g.pulse = 1; shake(g.j, 5); }
    } else {
      const before = carrot.stage;
      carrot.stage = Math.min(3, carrot.stage + (perfect ? 2 : 1));
      g.grownSteps += carrot.stage - before;
      carrot.pop = 14;
      g.combo++;
      g.maxCombo = Math.max(g.maxCombo, g.combo);
      floatText(g.j, cx, cy - 95, perfect ? "PERFECT!" : "GOOD", perfect ? "#ffd23f" : "#ffffff");
      if (g.combo >= 4 && g.combo % 4 === 0) floatText(g.j, cx, cy - 125, `Combo x${g.combo}!`, "#ff9ec6");
      // water droplets burst in time
      burst(g.j, g.r, cx, cy - 20, perfect ? 20 : 12, "#7ec8ff", 3.5, 5);
      burst(g.j, g.r, cx, cy - 20, 10, "#8be26a", 2.5, 5);
      if (carrot.stage >= 3) floatText(g.j, cx, cy - 60, "RIPE! Tap again!", "#ffd23f");
      if (perfect) { g.pulse = 1; shake(g.j, 4); }
    }
  }

  if (g.score >= GOAL) { burst(g.j, g.r, 835, 240, 40, "#ffd23f", 6, 7); endRun(g, true); }
  else if (g.elapsed >= DUR) endRun(g, false);
}

function rand01(g: Game): number { return range(g.r, 0, 1); }

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  const sunT = g.scene === "play" || g.scene === "won" || g.scene === "lost" ? Math.min(1, g.elapsed / DUR) : 0.12;
  // sunset sky darkens as sun sinks
  const top: [number, number, number] = [Math.round(255 - 90 * sunT), Math.round(150 - 60 * sunT), Math.round(170 - 70 * sunT)];
  const bot: [number, number, number] = [Math.round(255 - 40 * sunT), Math.round(190 - 70 * sunT), Math.round(110 - 50 * sunT)];
  sky(draw, W, H, top, bot);

  // Sun descending
  const sunX = 120 + sunT * 120;
  const sunY = 70 + sunT * 210;
  draw.setFillStyle("#fff3a6"); draw.beginPath(); draw.arc(sunX, sunY, 52, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(sunX, sunY, 40, 0, Math.PI * 2, false); draw.fill();

  // PERFECT screen pulse
  if (g.pulse > 0) { draw.setFillStyle(`rgba(255,210,63,${(g.pulse * 0.12).toFixed(3)})`); draw.fillRect(0, 0, W, H); }

  const o = shakeOffset(g.j, g.frame);
  draw.save();
  draw.translate(o.x, o.y);

  // Distant hills
  draw.setFillStyle("#e88a6a"); draw.fillRect(0, 285, W, 30);
  draw.setFillStyle("#c96a4a");
  draw.beginPath(); draw.arc(180, 315, 190, Math.PI, 0, false); draw.fill();
  draw.beginPath(); draw.arc(760, 315, 230, Math.PI, 0, false); draw.fill();

  // Barn on the right (stage & goal) with beat ring around it
  const interval = beatInterval(g);
  const frac = g.scene === "play" ? g.beatPhase / interval : (g.frame % 50) / 50;
  // converging beat ring: shrinks to barn as beat approaches
  const ringR = 70 + (1 - frac) * 90;
  draw.setStrokeStyle(frac > 0.82 ? "#ffd23f" : "rgba(255,255,255,0.75)");
  draw.setLineWidth(frac > 0.82 ? 6 : 3);
  draw.beginPath(); draw.arc(835, 205, ringR, 0, Math.PI * 2, false); draw.stroke();
  // drum pulse ring on beat
  if (g.drum > 0) {
    draw.setStrokeStyle(`rgba(255,210,63,${g.drum.toFixed(3)})`);
    draw.setLineWidth(5);
    draw.beginPath(); draw.arc(835, 205, 70 + (1 - g.drum) * 60, 0, Math.PI * 2, false); draw.stroke();
  }
  const barnWig = g.barnWiggle > 0 ? dsin(g.barnWiggle * 0.7) * 0.04 : 0;
  const barnScale = 1 + g.drum * 0.03;
  if (s.barn) drawSprite(draw, s.barn, 835, 215, 230, { rot: barnWig, sx: barnScale, sy: barnScale });

  // Ground
  draw.setFillStyle("#8a5a34"); draw.fillRect(0, 300, W, 240);
  draw.setFillStyle("#7a4e2c"); draw.fillRect(0, 300, W, 10);

  // Soil rows
  for (let r = 0; r < 3; r++) {
    const y = ROW_Y[r]!;
    draw.setFillStyle(g.girlRow === r && g.scene === "play" ? "#6e4525" : "#5d3a20");
    // rounded row
    draw.beginPath();
    draw.moveTo(90, y - 22); draw.lineTo(720, y - 22); draw.arc(720, y, 22, -Math.PI / 2, Math.PI / 2, false); draw.lineTo(90, y + 22); draw.arc(90, y, 22, Math.PI / 2, Math.PI * 1.5, false); draw.closePath(); draw.fill();
    draw.setStrokeStyle("rgba(0,0,0,0.25)"); draw.setLineWidth(3);
    for (let i = 0; i < 5; i++) { draw.beginPath(); draw.moveTo(140 + i * 110, y - 10); draw.lineTo(180 + i * 110, y - 10); draw.stroke(); draw.beginPath(); draw.moveTo(140 + i * 110, y + 10); draw.lineTo(180 + i * 110, y + 10); draw.stroke(); }
    if (g.girlRow === r && g.scene === "play") { draw.setStrokeStyle("#ffd23f"); draw.setLineWidth(3); draw.beginPath(); draw.arc(ROW_CARROT_X[r]!, y - 6, 34 + dsin(g.frame * 0.15) * 3, 0, Math.PI * 2, false); draw.stroke(); }
  }

  // Carrots per row
  for (let r = 0; r < 3; r++) {
    const c = g.carrots[r]!;
    const x = ROW_CARROT_X[r]!, y = ROW_Y[r]!;
    if (c.delay > 0) {
      // soil mound waiting
      draw.setFillStyle("#4a2f18"); draw.beginPath(); draw.arc(x, y + 6, 20, Math.PI, 0, false); draw.fill();
      text(draw, "···", x, y - 6, 18, "#d8b48a", "center");
      continue;
    }
    const pop = c.pop > 0 ? 1 + dsin((c.pop / 14) * Math.PI) * 0.25 : 1;
    const squashY = c.pop > 6 ? 0.78 : pop;
    const hgt = [26, 44, 66, 92][c.stage]!;
    if (c.stage >= 3) { draw.setFillStyle("rgba(255,210,63,0.35)"); draw.beginPath(); draw.arc(x, y - 24, 46 + dsin(g.frame * 0.12) * 5, 0, Math.PI * 2, false); draw.fill(); }
    if (s.carrot) drawSprite(draw, s.carrot, x, y - hgt / 2 + 8, hgt, { sx: pop, sy: squashY, rot: dsin(g.frame * 0.06 + r * 2) * (c.stage >= 3 ? 0.09 : 0.03) });
    // stage pips
    for (let i = 0; i < 3; i++) { draw.setFillStyle(i < c.stage ? "#8be26a" : "rgba(255,255,255,0.35)"); draw.beginPath(); draw.arc(x - 16 + i * 16, y + 20, 5, 0, Math.PI * 2, false); draw.fill(); }
    if (c.stage >= 3) text(draw, "RIPE!", x, y - 82, 16, "#ffd23f", "center");
  }

  // Chickens (draw before girl if behind? simple order)
  for (const ch of g.chickens) {
    const y = ROW_Y[ch.row]! - 6;
    const ruf = ch.ruffle > 0 ? 1 + dsin(ch.ruffle * 0.8) * 0.12 : 1;
    const bob = Math.abs(dsin(g.frame * 0.22 + ch.x * 0.05)) * 4;
    if (s.chicken) drawSprite(draw, s.chicken, ch.x, y - 18 - bob, 68, { flip: ch.vx < 0, sx: ruf, sy: 1 / ruf, rot: dsin(g.frame * 0.2 + ch.x) * 0.05 });
  }

  // Flyers arcing to barn
  for (const f of g.flyers) {
    const t = Math.min(1, f.t);
    const x = f.x0 + (835 - f.x0) * t;
    const y = f.y0 + (235 - f.y0) * t - dsin(t * Math.PI) * 150;
    if (s.carrot) drawSprite(draw, s.carrot, x, y, 58, { rot: t * 5 });
    draw.setFillStyle("#ffd23f");
    for (let i = 0; i < 3; i++) { draw.beginPath(); draw.arc(x - 18 - i * 12, y + 10 + dsin(g.frame * 0.3 + i) * 6, 3, 0, Math.PI * 2, false); draw.fill(); }
  }

  // Girl + watering can
  const isTitle = g.scene === "title";
  const girlX = isTitle ? W / 2 - 130 : 215;
  const girlY = isTitle ? 360 : g.girlY - 28;
  const hopY = g.hop > 0 ? -dsin((g.hop / 10) * Math.PI) * 16 : 0;
  const beatBob = dsin(g.frame * 0.1) * 3;
  if (s.girl) drawSprite(draw, s.girl, girlX, girlY + hopY + beatBob, 132, { sx: 1 + Math.abs(beatBob) * 0.01, sy: 1 - Math.abs(beatBob) * 0.01 });
  // watering can in front
  const canRot = g.pour > 0 ? -0.65 + dsin(g.pour * 0.6) * 0.12 : -0.08;
  if (s.wateringcan) drawSprite(draw, s.wateringcan, girlX + 62, girlY - 18 + hopY, 68, { rot: canRot });
  if (g.pour > 0 && g.scene === "play") {
    // water arc droplets (visual, particles also burst on hit)
    draw.setFillStyle("rgba(126,200,255,0.9)");
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const dx = girlX + 92 + t * (ROW_CARROT_X[g.girlRow]! - girlX - 92);
      const dy = girlY - 28 + t * t * 58 + dsin(g.frame * 0.5 + i) * 2;
      draw.beginPath(); draw.arc(dx, dy, 4, 0, Math.PI * 2, false); draw.fill();
    }
  }

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 470, 58);
    if (s.carrot) drawSprite(draw, s.carrot, 42, 41, 38, { rot: -0.3 });
    text(draw, `${g.score} / ${GOAL} carrots`, 68, 41, 22, "#ffd23f");
    text(draw, g.combo > 1 ? `Combo x${g.combo}` : "Space on beat!", 292, 41, 16, g.combo > 1 ? "#ff9ec6" : "#ffffff");
    // sunset timer bar
    panel(draw, 560, 12, 386, 58);
    text(draw, "SUNSET", 578, 30, 15, "#ffb347");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(578, 46, 350, 12);
    draw.setFillStyle(sunT > 0.8 ? "#ff5a5a" : "#ffd23f"); draw.fillRect(578, 46, 350 * (1 - sunT), 12);
    // beat indicator
    const beatFrac = g.beatPhase / beatInterval(g);
    panel(draw, 14, 478, 560, 50, "rgba(0,0,0,0.35)");
    text(draw, "Up/Down or W/S: move row   SPACE: pour / harvest!", 28, 503, 17, "#ffffff");
    // beat dots
    const bx = 830, by = 503;
    draw.setStrokeStyle("#ffffff"); draw.setLineWidth(3); draw.beginPath(); draw.arc(bx, by, 10 + (1 - beatFrac) * 14, 0, Math.PI * 2, false); draw.stroke();
    draw.setFillStyle(beatFrac > 0.82 || beatFrac < 0.12 ? "#ffd23f" : "#ffffff"); draw.beginPath(); draw.arc(bx, by, 7, 0, Math.PI * 2, false); draw.fill();
    text(draw, "BEAT", bx + 34, by, 16, "#ffd23f");
  }

  // Overlays (English, custom)
  if (g.scene === "title") {
    draw.setFillStyle("rgba(60,20,10,0.28)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.frame * 0.05) * 6;
    text(draw, "SUNSET BEAT FARM", W / 2, 108 + bob, 62, "#ffd23f", "center", "bangers");
    text(draw, "Water on the drumbeat. Harvest on the drumbeat.", W / 2, 168, 21, "#ffffff", "center");
    text(draw, "Don't let the chickens cluck you off tempo!", W / 2, 196, 19, "#ffe28a", "center");
    // bouncing carrot on title beat
    const tb = Math.abs(dsin(g.frame * 0.12)) * 22;
    if (s.carrot) drawSprite(draw, s.carrot, W / 2 + 150, 352 - tb, 84, { rot: dsin(g.frame * 0.12) * 0.2, sy: 1 - Math.abs(dsin(g.frame * 0.12)) * 0.12, sx: 1 + Math.abs(dsin(g.frame * 0.12)) * 0.12 });
    panel(draw, 250, 408, 460, 78);
    text(draw, "Up/Down move  •  SPACE pour/harvest", W / 2, 432, 19, "#ffffff", "center");
    text(draw, "Deliver 12 ripe carrots before sunset!", W / 2, 460, 18, "#ffd23f", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "Press Enter to Play", W / 2, 512, 26, "#ffffff", "center");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(40,20,0,0.45)"); draw.fillRect(0, 0, W, H);
    if (s.barn) drawSprite(draw, s.barn, W / 2, 180, 150, { rot: dsin(g.frame * 0.15) * 0.03 });
    text(draw, "Harvest Complete!", W / 2, 300, 52, "#ffd23f", "center", "bangers");
    text(draw, "Great Timing, Farmer!", W / 2, 352, 30, "#ffffff", "center", "bangers");
    text(draw, `Combo best x${g.maxCombo}  •  12 carrots delivered!`, W / 2, 398, 20, "#ffe28a", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "Press Enter to Play Again", W / 2, 460, 24, "#ffffff", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(10,10,40,0.62)"); draw.fillRect(0, 0, W, H);
    text(draw, "Sunset!", W / 2, 210, 60, "#ff9ec6", "center", "bangers");
    text(draw, `You delivered ${g.score} of 12 carrots.`, W / 2, 285, 26, "#ffffff", "center");
    text(draw, "Press Enter to Try Again", W / 2, 360, 24, "#ffd23f", "center");
    text(draw, "Trust the drum, not the chicken!", W / 2, 410, 19, "#ffe28a", "center");
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Sunset Beat Farm" },
  clear: { r: 1, g: 0.75, b: 0.55 },
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
        let h = g.frame * 31 + g.score * 131 + g.combo * 7 + g.elapsed + Math.round(g.girlY * 10) + g.beatCount * 17;
        for (const c of g.carrots) h = (Math.imul(h, 16777619) ^ (c.stage * 100 + c.delay)) >>> 0;
        for (const ch of g.chickens) h = (Math.imul(h, 16777619) ^ Math.round(ch.x * 10)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.scene === "won" ? 1 : Math.min(0.99, g.grownSteps / 48), scene: g.scene, score: g.score, combo: g.combo }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
