import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["boat", "whale", "octopus", "jellyfish", "lighthouse"];
const GOAL = 8, TIME = 90 * 60;
const WATER = 228, DOCK_X = 792;

type Kind = "jellyfish" | "octopus" | "whale";
interface Swimmer { x: number; y: number; vx: number; kind: Kind; ph: number; }
interface ChainItem { kind: Kind; wig: number; }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  boatX: number; vx: number; theta: number; thetaV: number; len: number;
  chain: ChainItem[]; swimmers: Swimmer[]; deliveredKinds: Kind[];
  delivered: number; lost: number; timer: number; invuln: number; spawnT: number;
  wasUnder: boolean; catchPop: number; perfects: number; j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  boatX: 380, vx: 0, theta: 0.25, thetaV: 0, len: 46,
  chain: [], swimmers: [], deliveredKinds: [], delivered: 0, lost: 0, timer: TIME, invuln: 0, spawnT: 0, wasUnder: false, catchPop: 0, perfects: 0, j: juice(),
});
const weight = (k: Kind) => k === "whale" ? 2 : 1;
const massOf = (c: ChainItem[]) => c.reduce((a, i) => a + (i.kind === "whale" ? 4 : i.kind === "octopus" ? 1.2 : 0.35), 0);
const ROCKS = [{ x: 190, y: 492, r: 38 }, { x: 468, y: 508, r: 48 }, { x: 660, y: 452, r: 30 }];

function hookPos(g: Game) { return { x: g.boatX + dsin(g.theta) * g.len, y: 205 + dcos(g.theta) * g.len }; }
function chainPos(g: Game, i: number) {
  const h = hookPos(g);
  const wob = dsin(g.frame * 0.12 - i * 0.9) * (6 + i * 3);
  const dirx = dsin(g.theta), diry = dcos(g.theta);
  const d = 28 + i * 50;
  return { x: h.x + dirx * d + -diry * wob * 0.3, y: h.y + diry * d + Math.abs(wob) * 0.15 };
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j);
  if (sceneStep(g, edge)) Object.assign(g, fresh(g.r.s, "play"), { prev: keys });
  if (g.scene !== "play") return;
  g.timer--; if (g.invuln > 0) g.invuln--; if (g.catchPop > 0) g.catchPop--;
  if (g.timer <= 0) { endRun(g, g.delivered >= GOAL); return; }

  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const prevVx = g.vx;
  g.vx += dir * 0.9; g.vx *= 0.86;
  g.boatX = Math.max(70, Math.min(DOCK_X - 95, g.boatX + g.vx));
  const boatAcc = g.vx - prevVx;

  // pendulum
  const mass = massOf(g.chain);
  const hasJelly = g.chain.some(c => c.kind === "jellyfish");
  const effLen = g.len + mass * 9;
  const grav = hasJelly ? 0.0016 : 0.0028;
  g.thetaV += (-grav * (160 / Math.max(60, effLen)) * dsin(g.theta) * 8 - boatAcc * 0.0035 * dcos(g.theta)) ;
  g.thetaV *= mass >= 4 ? 0.995 : 0.988;
  g.theta += g.thetaV;
  g.theta = Math.max(-1.35, Math.min(1.35, g.theta));
  if (g.theta === -1.35 || g.theta === 1.35) g.thetaV *= 0.6;

  // hook lower / reel
  const holding = (keys & KEY.action) !== 0;
  const reelSpeed = g.chain.some(c => c.kind === "whale") ? 2.0 : hasJelly ? 4.2 : 3.2;
  if (holding) g.len = Math.min(285, g.len + 3.4); else g.len = Math.max(42, g.len - reelSpeed);

  const hp = hookPos(g);
  const under = hp.y > WATER;
  if (under && !g.wasUnder) { burst(g.j, g.r, hp.x, WATER + 4, 10, "#bfefff", 3, 5); }
  if (!under && g.wasUnder && g.chain.length) { burst(g.j, g.r, hp.x, WATER + 4, 16, "#ffffff", 3.5, 6); floatText(g.j, hp.x, WATER - 18, "Splash!", "#bfefff"); }
  g.wasUnder = under;
  if (under && g.frame % 5 === 0) g.j.particles.push({ x: hp.x + range(g.r, -4, 4), y: hp.y, vx: range(g.r, -0.3, 0.3), vy: -range(g.r, 0.5, 1.4), life: 30, max: 30, size: range(g.r, 2, 5), color: "#dff7ff" });

  // swimmers
  g.spawnT--;
  const maxSwim = g.delivered + g.chain.length >= 6 ? 5 : 6;
  if (g.spawnT <= 0 && g.swimmers.length < maxSwim) {
    g.spawnT = Math.max(28, 62 - Math.floor((TIME - g.timer) / 60) * 1);
    const fromLeft = rand01(g) < 0.5;
    const roll = rand01(g);
    const kind: Kind = roll < 0.18 ? "whale" : roll < 0.52 ? "octopus" : "jellyfish";
    g.swimmers.push({ x: fromLeft ? -50 : W + 50, y: kind === "whale" ? range(g.r, 400, 470) : range(g.r, 315, 475), vx: (fromLeft ? 1 : -1) * (kind === "whale" ? range(g.r, 0.5, 0.8) : range(g.r, 0.8, 1.6)), kind, ph: range(g.r, 0, 6) });
  }
  for (const s of g.swimmers) { s.x += s.vx; s.y += dsin(g.frame * 0.03 + s.ph) * 0.35; }
  g.swimmers = g.swimmers.filter(s => s.x > -90 && s.x < W + 90);

  // catching: hook + chain tip + octopus tentacle radius
  const hasOcto = g.chain.some(c => c.kind === "octopus");
  const grabR = hasOcto ? 78 : 48;
  const tip = g.chain.length ? chainPos(g, g.chain.length - 1) : hp;
  for (const s of [...g.swimmers]) {
    const nearHook = Math.hypot(s.x - hp.x, s.y - hp.y) < grabR;
    const nearTip = Math.hypot(s.x - tip.x, s.y - tip.y) < grabR;
    if ((nearHook || nearTip) && g.chain.length < 4) {
      g.swimmers = g.swimmers.filter(x => x !== s);
      const double = g.chain.length > 0;
      g.chain.push({ kind: s.kind, wig: 18 });
      g.catchPop = 14;
      burst(g.j, g.r, s.x, s.y, s.kind === "whale" ? 28 : 16, s.kind === "whale" ? "#ffd23f" : "#ff9ecb", 4, 6);
      if (s.kind === "whale") { shake(g.j, 9); floatText(g.j, s.x, s.y - 34, "WHALE! Gotcha!", "#ffd23f"); }
      else floatText(g.j, s.x, s.y - 30, double ? "Two in one tow!" : "Gotcha!", "#ffffff");
      // octopus extra grab: immediately snag nearest other within reach
      if (s.kind === "octopus" || hasOcto) {
        const extra = g.swimmers.find(x => Math.hypot(x.x - s.x, x.y - s.y) < 85);
        if (extra && g.chain.length < 4) { g.swimmers = g.swimmers.filter(x => x !== extra); g.chain.push({ kind: extra.kind, wig: 18 }); floatText(g.j, extra.x, extra.y - 30, "Tentacle grab!", "#ffb3d9"); burst(g.j, g.r, extra.x, extra.y, 14, "#ffb3d9", 3, 5); }
      }
    }
  }
  for (const c of g.chain) if (c.wig > 0) c.wig--;

  // bonks
  const speed = Math.abs(g.thetaV) * g.len + Math.abs(g.vx);
  if (g.invuln <= 0 && g.chain.length && speed > 3.9) {
    let bonk = false;
    for (let i = 0; i < g.chain.length; i++) {
      const p = chainPos(g, i);
      for (const r of ROCKS) if (Math.hypot(p.x - r.x, p.y - r.y) < r.r + 18) bonk = true;
      if (p.x > 862 && p.y < 235 && p.y > 105) bonk = true; // lighthouse base
    }
    if (bonk) {
      const lostItem = g.chain.pop()!;
      g.lost++; g.invuln = 75; shake(g.j, 13);
      const p = hp; burst(g.j, g.r, p.x, p.y, 22, "#ff6b6b", 5, 6);
      floatText(g.j, p.x, Math.max(90, p.y - 36), "Bonk! Lost one!", "#ff8a8a");
      g.swimmers.push({ x: p.x, y: Math.min(460, p.y + 30), vx: g.vx >= 0 ? -1.2 : 1.2, kind: lostItem.kind, ph: range(g.r, 0, 6) });
      if (g.lost >= 5) { endRun(g, false); return; }
    }
  }

  // delivery at tank on dock
  if (g.chain.length && g.len < 100 && g.boatX > 545) {
    const p = chainPos(g, 0);
    if (true) {
      const beam = dcos(g.frame * 0.012);
      const perfect = beam < -0.55;
      let gained = 0;
      for (const c of g.chain) { gained += weight(c.kind); g.deliveredKinds.push(c.kind); }
      g.delivered = Math.min(GOAL, g.delivered + gained);
      if (perfect) { g.perfects++; g.timer = Math.min(TIME, g.timer + 180); floatText(g.j, 830, 105, "Perfect Drop! +3s", "#ffd23f"); burst(g.j, g.r, 830, 165, 30, "#8be28b", 4, 6); burst(g.j, g.r, 830, 165, 20, "#ffd23f", 3, 5); }
      else { floatText(g.j, 830, 105, `Delivered +${gained}!`, "#ffffff"); burst(g.j, g.r, 830, 170, 20, "#bfefff", 4, 6); }
      if (g.chain.some(c => c.kind === "whale")) shake(g.j, 8);
      g.chain = [];
      if (g.delivered >= GOAL) { endRun(g, true); return; }
    }
  }
}
function rand01(g: Game) { g.r.s = (Math.imul(g.r.s, 1664525) + 1013904223) >>> 0; return g.r.s / 4294967296; }

type Draw = Parameters<NonNullable<SimRun["render"]>>[0];
function drawTank(draw: Draw, g: Game, s: Record<string, Sprite>) {
  // dock
  draw.setFillStyle("#8a5a33"); draw.fillRect(DOCK_X - 8, WATER, W - DOCK_X + 8, 18);
  draw.setFillStyle("#6e4525"); for (let x = DOCK_X; x < W; x += 28) draw.fillRect(x, WATER + 18, 8, 60);
  // lighthouse
  if (s.lighthouse) drawSprite(draw, s.lighthouse, 918, 128, 225, {});
  // beam
  const beamA = g.frame * 0.012;
  const bx = 918, by = 48;
  draw.save(); draw.setGlobalAlpha(0.20 + 0.08 * dsin(g.frame * 0.05)); draw.setFillStyle("#ffe98a");
  draw.beginPath(); draw.moveTo(bx, by); draw.lineTo(bx + dcos(beamA) * 420, by + dsin(beamA) * 420); draw.lineTo(bx + dcos(beamA + 0.22) * 420, by + dsin(beamA + 0.22) * 420); draw.closePath(); draw.fill(); draw.restore();
  // aquarium tank
  draw.setFillStyle("rgba(140,220,255,0.55)"); draw.fillRect(786, 138, 92, 92);
  draw.setStrokeStyle("#eaf7ff"); draw.setLineWidth(4); draw.strokeRect(786, 138, 92, 92);
  draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(792, 144, 20, 80);
  g.deliveredKinds.slice(0, 8).forEach((k, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = 808 + col * 22 + dsin(g.frame * 0.08 + i) * 2, y = 168 + row * 38;
    if (s[k]) drawSprite(draw, s[k], x, y, k === "whale" ? 30 : 24, { rot: dsin(g.frame * 0.06 + i) * 0.25 });
  });
  text(draw, "AQUARIUM", 832, 122, 13, "#ffffff", "center");
}

function render(g: Game, draw: Draw, s: Record<string, Sprite>): void {
  const sunset = g.scene === "play" ? 1 - g.timer / TIME : 0.25;
  sky(draw, W, H, [255 - sunset * 70, 170 - sunset * 60, 110], [120, 190, 235]);
  // sun
  draw.setFillStyle("#fff2a8"); draw.beginPath(); draw.arc(120, 72 + sunset * 55, 34, 0, Math.PI * 2, false); draw.fill();
  // clouds / distant hills
  draw.setFillStyle("rgba(255,255,255,0.8)");
  for (const [cx, cy] of [[220, 70], [520, 52], [700, 88]] as const) { for (const [ox, oy, r] of [[-28, 6, 20], [0, 0, 26], [28, 6, 20]] as const) { draw.beginPath(); draw.arc(cx + ox + dsin(g.frame * 0.005 + cx) * 6, cy + oy, r, 0, Math.PI * 2, false); draw.fill(); } }
  // water
  draw.setFillStyle("#2a8fc7"); draw.fillRect(0, WATER, W, H - WATER);
  draw.setFillStyle("#1f78b5"); for (let i = 0; i < 5; i++) draw.fillRect(0, WATER + 46 + i * 55, W, 22);
  draw.setStrokeStyle("rgba(255,255,255,0.5)"); draw.setLineWidth(2);
  for (let i = 0; i < 8; i++) { const y = WATER + 14 + i * 36; draw.beginPath(); for (let x = 0; x <= W; x += 24) { const yy = y + dsin(g.frame * 0.04 + x * 0.02 + i) * 3; x === 0 ? draw.moveTo(x, yy) : draw.lineTo(x, yy); } draw.stroke(); }
  // rocks
  for (const r of ROCKS) { draw.setFillStyle("#5d6b7a"); draw.beginPath(); draw.arc(r.x, r.y, r.r, 0, Math.PI * 2, false); draw.fill(); draw.setFillStyle("#78879a"); draw.beginPath(); draw.arc(r.x - 8, r.y - 8, r.r * 0.55, 0, Math.PI * 2, false); draw.fill(); }
  // seaweed
  draw.setStrokeStyle("#2fae6e"); draw.setLineWidth(5);
  for (const wx of [90, 330, 580, 740]) { draw.beginPath(); draw.moveTo(wx, 535); draw.lineTo(wx + dsin(g.frame * 0.05 + wx) * 14, 490); draw.lineTo(wx + dsin(g.frame * 0.05 + wx) * 22, 452); draw.stroke(); }

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x + dsin(g.frame * 0.02) * 1.5, o.y);
  drawTank(draw, g, s);

  const inTitle = g.scene !== "play";
  const boatX = inTitle ? W / 2 - 90 : g.boatX;
  const bob = dsin(g.frame * 0.045) * 5;
  const theta = inTitle ? dsin(g.frame * 0.03) * 0.45 : g.theta;
  const len = inTitle ? 72 : g.len;
  const pivotY = 205 + bob;
  const hx = boatX + dsin(theta) * len, hy = pivotY + dcos(theta) * len;

  // swimmers
  if (!inTitle) for (const sw of g.swimmers) {
    const spr = s[sw.kind]; if (!spr) continue;
    const hgt = sw.kind === "whale" ? 92 : sw.kind === "octopus" ? 58 : 52;
    drawSprite(draw, spr, sw.x, sw.y + dsin(g.frame * 0.08 + sw.ph) * 4, hgt, { flip: sw.vx < 0, rot: dsin(g.frame * 0.06 + sw.ph) * 0.15, sx: 1 + dsin(g.frame * 0.15 + sw.ph) * 0.05, sy: 1 - dsin(g.frame * 0.15 + sw.ph) * 0.05 });
  }

  // rope + hook
  draw.setStrokeStyle("#3a2a1a"); draw.setLineWidth(3); draw.beginPath(); draw.moveTo(boatX, pivotY - 18); draw.lineTo(hx, hy); draw.stroke();
  // chain friends (title shows preset chain)
  const titleChain: Kind[] = ["whale", "octopus", "jellyfish"];
  const chainKinds: Kind[] = inTitle ? titleChain : g.chain.map(c => c.kind);
  chainKinds.forEach((k, i) => {
    const d = 28 + i * 50;
    const x = hx + dsin(theta) * d + dsin(g.frame * 0.12 - i) * 5;
    const y = hy + dcos(theta) * d;
    const pop = !inTitle && g.chain[i] && g.chain[i]!.wig > 0 ? 1 + g.chain[i]!.wig * 0.012 : 1;
    if (s[k]) drawSprite(draw, s[k], x, y, k === "whale" ? 76 : 50, { rot: theta * 0.5 + dsin(g.frame * 0.1 - i) * 0.2, sx: pop, sy: 2 - pop > 0 ? 1 / pop : 1 });
    if (i > 0 || true) { draw.setStrokeStyle("rgba(58,42,26,0.7)"); draw.setLineWidth(2); draw.beginPath(); draw.moveTo(hx + dsin(theta) * (d - 22), hy + dcos(theta) * (d - 22)); draw.lineTo(x, y); draw.stroke(); }
  });
  // hook
  draw.setStrokeStyle("#ddd"); draw.setLineWidth(4); draw.beginPath(); draw.arc(hx, hy, 9, 0.3, Math.PI * 1.7, false); draw.stroke();
  draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(hx, hy, 4, 0, Math.PI * 2, false); draw.fill();

  // boat
  if (s.boat) drawSprite(draw, s.boat, boatX, 198 + bob, 118, { rot: dsin(g.frame * 0.045) * 0.04 + (inTitle ? 0 : g.vx * 0.018), flip: false });
  if (!inTitle) text(draw, "tank >", Math.min(boatX + 78, 700), 150 + bob, 13, "rgba(255,255,255,0.8)", "center");

  drawJuice(draw, g.j);
  draw.restore();

  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 58, "rgba(10,40,70,0.62)");
    text(draw, `Aquarium ${g.delivered}/${GOAL}`, 28, 32, 20, "#ffd23f");
    // slots
    for (let i = 0; i < GOAL; i++) { draw.setFillStyle(i < g.delivered ? "#ffd23f" : "rgba(255,255,255,0.28)"); draw.beginPath(); draw.arc(36 + i * 22, 56, 7, 0, Math.PI * 2, false); draw.fill(); }
    const secs = Math.max(0, Math.ceil(g.timer / 60));
    text(draw, `${secs}s  Lost ${g.lost}/5  Chain ${g.chain.length}`, 430, 32, 17, secs < 15 ? "#ff9a9a" : "#ffffff", "right");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(220, 50, 210, 8);
    draw.setFillStyle(secs < 15 ? "#ff6b6b" : "#7be495"); draw.fillRect(220, 50, 210 * (g.timer / TIME), 8);
    panel(draw, 14, H - 40, 640, 30, "rgba(10,40,70,0.5)");
    text(draw, "LEFT / RIGHT move   HOLD SPACE lower - release reel   Deliver to tank at dock", 26, H - 25, 14, "#ffffff");
    if (g.chain.length) { panel(draw, W - 250, 84, 236, 34, "rgba(10,40,70,0.55)"); text(draw, "↑ Reel up & sail right to tank!", W - 132, 101, 14, "#bfefff", "center"); }
  } else if (g.scene === "title") {
    draw.setFillStyle("rgba(6,30,55,0.28)"); draw.fillRect(0, 0, W, H);
    const bob2 = dsin(g.frame * 0.05) * 6;
    text(draw, "FRIEND TOW", W / 2, 92 + bob2, 74, "#ffd23f", "center", "bangers");
    text(draw, "Tow your sea friends home before sunset!", W / 2, 148, 21, "#ffffff", "center");
    panel(draw, 250, 398, 460, 96, "rgba(8,35,60,0.68)");
    text(draw, "A / D or Arrow Keys: slide the boat", W / 2, 420, 17, "#ffffff", "center");
    text(draw, "HOLD SPACE to lower · release to reel", W / 2, 444, 17, "#bfefff", "center");
    text(draw, "Fill 8 aquarium spots in 90s · Don't bonk rocks!", W / 2, 468, 15, "#ffd9a8", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "Press ENTER to start", W / 2, 522, 24, "#ffffff", "center");
  } else {
    draw.setFillStyle("rgba(6,25,45,0.55)"); draw.fillRect(0, 0, W, H);
    const won = g.scene === "won";
    text(draw, won ? "AQUARIUM FULL!" : "OH NO!", W / 2, 190, 62, won ? "#ffd23f" : "#ff8a8a", "center", "bangers");
    text(draw, won ? "All your friends are home before sunset!" : g.lost >= 5 ? "Too many friends bonked loose!" : "The sun set before the tank was full...", W / 2, 250, 20, "#ffffff", "center");
    text(draw, `Delivered ${g.delivered}/${GOAL} · Perfect drops ${g.perfects} · Lost ${g.lost}`, W / 2, 292, 20, "#bfefff", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "Press ENTER to play again", W / 2, 360, 24, "#ffffff", "center");
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Friend Tow" },
  clear: { r: 0.35, g: 0.65, b: 0.9 },
  options: {}, neutral: 0, encode: encodeKeys, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then(s => { sprites = s; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => { let h = g.frame * 31 + g.delivered * 101 + g.lost * 17 + Math.round(g.boatX * 10) + g.chain.length; for (const s of g.swimmers) h = (Math.imul(h, 16777619) ^ Math.round(s.x * 10 + s.y)) >>> 0; return h >>> 0; },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.delivered / GOAL, scene: g.scene, score: g.delivered, delivered: g.delivered, lost: g.lost }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
