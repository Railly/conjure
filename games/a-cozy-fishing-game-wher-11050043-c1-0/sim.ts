import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, squash, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["boat", "whale", "octopus", "lighthouse", "jellyfish"];
const TX = 632, TW = 292, TTOP = 258, TIERH = 84, TFLOOR = TTOP + TIERH * 3; // 510
type Kind = "whale" | "octopus" | "jellyfish";
type Phase = "ready" | "swing" | "fall" | "settle";
interface FriendDef { kind: Kind; tier: number; label: string }
const QUEUE: FriendDef[] = [
  { kind: "jellyfish", tier: 2, label: "JELLY · TOP" },
  { kind: "octopus", tier: 1, label: "OCTOPUS · MIDDLE" },
  { kind: "whale", tier: 0, label: "WHALE · BOTTOM" },
  { kind: "octopus", tier: 1, label: "OCTOPUS · MIDDLE" },
  { kind: "jellyfish", tier: 2, label: "JELLY · TOP" },
  { kind: "whale", tier: 0, label: "WHALE · BOTTOM" },
];
const HEIGHT: Record<Kind, number> = { whale: 68, octopus: 62, jellyfish: 58 };
const WEIGHT: Record<Kind, number> = { whale: 3, octopus: 2, jellyfish: 0.6 };
const TIERNAME = ["BOTTOM", "MIDDLE", "TOP"];

interface Housed { kind: Kind; tier: number; slot: number; born: number }
interface Proj { kind: Kind; tier: number; x: number; y: number; vx: number; vy: number; rot: number; perfect: boolean }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  boatX: number; boatVx: number; lineLen: number;
  phase: Phase; qIndex: number; theta: number; omega: number; stretch: number; stretchV: number;
  proj: Proj | null; settleT: number; settleFriend: Housed | null; settleGood: boolean;
  housed: Housed[]; drops: number; hard: number; score: number; combo: number;
  tip: number; octSteadied: boolean; loseReason: string;
  gustIn: number; gustReady: boolean; gustUsedWind: boolean; j: Juice;
}
const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  boatX: 300, boatVx: 0, lineLen: 110, phase: "ready", qIndex: 0, theta: 0.25, omega: 0, stretch: 0, stretchV: 0,
  proj: null, settleT: 0, settleFriend: null, settleGood: false, housed: [], drops: 0, hard: 0, score: 0, combo: 0,
  tip: 0, octSteadied: false, loseReason: "", gustIn: 520, gustReady: false, gustUsedWind: false, j: juice(),
});
const cur = (g: Game) => QUEUE[Math.min(g.qIndex, QUEUE.length - 1)]!;
const effLen = (g: Game) => g.lineLen + (cur(g).kind === "octopus" ? g.stretch : 0);
const friendPos = (g: Game) => {
  const L = effLen(g);
  return { x: g.boatX + dsin(g.theta) * L, y: 92 + dcos(g.theta) * L, L };
};

function land(g: Game, tier: number, speed: number) {
  const def = cur(g); const kind = def.kind; const entryGood = tier === def.tier; const good = true;
  const isHard = speed >= 10.5;
  const p = g.proj!;
  const homeTier = def.tier;
  g.settleFriend = { kind, tier: homeTier, slot: g.housed.filter(h => h.tier === homeTier).length, born: g.frame };
  g.settleGood = good; g.phase = "settle"; g.settleT = 55;
  const fx = TX + 70 + g.settleFriend.slot * 68, fy = TTOP + TIERH * (2 - homeTier) + TIERH - 30;
  if (isHard) {
    g.hard++; g.combo = 0; g.tip = Math.min(120, g.tip + 16);
    burst(g.j, g.r, fx, fy, 26, "#ff5a5a", 6, 7); shake(g.j, 13);
    floatText(g.j, fx, fy - 55, "TOO HARD!", "#ff6b6b");
  } else {
    const slot = g.housed.filter(h => h.tier === homeTier).length;
    g.housed.push({ kind, tier: homeTier, slot, born: g.frame }); g.qIndex++;
    burst(g.j, g.r, fx, fy, 22, "#ff9ecb", 4, 6); burst(g.j, g.r, fx, fy, 12, "#8fd8ff", 3, 5);
    if (!entryGood) g.tip = Math.min(120, g.tip + (kind === "whale" ? 14 : 6));
    if (p.perfect && entryGood) { g.combo++; const pts = 100 + g.combo * 50; g.score += pts; floatText(g.j, fx, fy - 70, `SPLASH-FREE! COMBO x${g.combo + 2}`, "#ffd23f"); burst(g.j, g.r, fx, fy - 20, 18, "#ffd23f", 5, 5); }
    else { g.combo = 0; g.score += 100; floatText(g.j, fx, fy - 60, entryGood ? "SOFT LANDING! +100" : (kind === "whale" ? "WHALE SINKS HOME! +100" : kind === "jellyfish" ? "JELLY FLOATS HOME! +100" : "OCTOPUS SETTLES! +100"), "#7dff9a"); }
    if (kind === "whale" && entryGood) g.tip = Math.max(0, g.tip - 12);
    if (kind === "octopus" && !g.octSteadied && g.tip > 12) { g.octSteadied = true; g.tip = Math.max(0, g.tip - 32); floatText(g.j, fx, fy - 95, "OCTOPUS STEADIES THE TANK!", "#ffb3b3"); }
  }
  g.proj = null;
  if (g.tip >= 100) { g.loseReason = "THE TANK TIPPED! TRY AGAIN."; }
}

function miss(g: Game, hardHit: boolean, msg: string) {
  if (hardHit) { g.hard++; g.tip = Math.min(120, g.tip + 14); shake(g.j, 12); floatText(g.j, Math.max(80, Math.min(880, g.proj?.x ?? 400)), 420, "TOO HARD!", "#ff6b6b"); }
  else floatText(g.j, Math.max(80, Math.min(880, g.proj?.x ?? 400)), 300, msg, "#ffffff");
  if (g.proj) burst(g.j, g.r, g.proj.x, Math.min(500, g.proj.y), 18, "#8fd8ff", 4, 6);
  g.combo = 0; g.proj = null; g.phase = "settle"; g.settleT = 42; g.settleFriend = null;
  if (g.tip >= 100) g.loseReason = "THE TANK TIPPED! TRY AGAIN.";
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") return;
  // wind warning cycle
  if (!g.gustReady) { g.gustIn--; if (g.gustIn <= 0) { g.gustReady = true; floatText(g.j, 150, 210, "WIND GUST NEXT DROP!", "#ff5a5a"); } }
  g.tip = Math.max(0, g.tip - 0.008);

  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const prevVx = g.boatVx;
  g.boatVx += dir * 0.55; g.boatVx *= 0.86; g.boatX = Math.max(70, Math.min(890, g.boatX + g.boatVx));
  const boatAcc = g.boatVx - prevVx;
  if (keys & KEY.up) g.lineLen = Math.max(62, g.lineLen - 1.6);
  if (keys & KEY.down) g.lineLen = Math.min(372, g.lineLen + 2.2);

  if (g.phase === "ready" && (edge & KEY.action)) {
    g.phase = "swing"; g.theta = 0.28; g.omega = 0.01; g.stretch = 0; g.stretchV = 0;
    floatText(g.j, g.boatX, 150, cur(g).kind === "whale" ? "HEAVY SWING!" : cur(g).kind === "octopus" ? "STRETCHY LINE!" : "FLOATY!", "#ffffff");
  } else if (g.phase === "swing") {
    const kind = cur(g).kind; const L = effLen(g);
    const grav = kind === "jellyfish" ? 0.28 : kind === "whale" ? 0.52 : 0.42;
    const damp = kind === "whale" ? 0.999 : kind === "jellyfish" ? 0.992 : 0.996;
    let alpha = -(grav / L) * dsin(g.theta) - boatAcc * dcos(g.theta) / Math.max(40, L) * (kind === "whale" ? 0.55 : 1);
    if (g.gustReady) alpha += 0.00035 * dsin(g.frame * 0.07);
    g.omega = (g.omega + alpha) * damp; g.theta += g.omega;
    if (kind === "octopus") { g.stretchV += (-g.stretch * 0.012 - g.stretchV * 0.06 + Math.abs(g.omega) * 22); g.stretchV *= 0.96; g.stretch = Math.max(-18, Math.min(42, g.stretch + g.stretchV)); }
    if (edge & KEY.action) {
      const fp = friendPos(g); const L2 = effLen(g);
      const vx = g.boatVx + g.omega * L2 * dcos(g.theta) * 0.92;
      const vy = -g.omega * L2 * dsin(g.theta) * 0.92 + (kind === "jellyfish" ? -1.2 : 0.4);
      const perfect = Math.abs(g.omega) < 0.018 && Math.abs(g.theta) > 0.32;
      g.proj = { kind, tier: cur(g).tier, x: fp.x, y: fp.y, vx, vy, rot: g.theta, perfect };
      g.phase = "fall"; g.drops++; g.gustUsedWind = g.gustReady; g.gustReady = false; g.gustIn = Math.max(340, 760 - g.housed.length * 65 + Math.round(range(g.r, -60, 80)));
      burst(g.j, g.r, fp.x, fp.y, 8, "#ffffff", 2, 4);
    }
  } else if (g.phase === "fall" && g.proj) {
    const p = g.proj; const px = p.x, py = p.y;
    if (g.gustUsedWind) p.vx += 0.055;
    // Friends wiggle toward home once close to the tank: a kind aim-assist, not autopilot.
    if (p.x > 440 && p.y > 120) {
      const tx = TX + 145, ty = tierFloor(p.tier) - 36;
      p.vx += Math.max(-0.12, Math.min(0.12, (tx - p.x) * 0.0012));
      p.vy += Math.max(-0.10, Math.min(0.10, (ty - p.y) * 0.001));
    }
    p.vy += p.kind === "jellyfish" ? -0.085 : p.kind === "whale" ? 0.46 : 0.36;
    if (p.kind === "jellyfish") p.vy = Math.max(-4.2, p.vy);
    p.vx *= 0.995; p.x += p.vx; p.y += p.vy; p.rot += p.vx * 0.01;
    const speed = Math.hypot(p.vx, p.vy);
    const insideTank = p.x > TX + 8 && p.x < TX + TW - 4 && p.y > TTOP + 6 && p.y < TFLOOR - 2;
    const enteredSide = px < TX + 6 && p.x >= TX + 6 && p.y > TTOP && p.y < TFLOOR;
    const enteredTop = py < TTOP + 4 && p.y >= TTOP + 4 && p.x > TX && p.x < TX + TW && p.vy > 0;
    if (insideTank || enteredSide || enteredTop) {
      const tier = p.y < TTOP + TIERH ? 2 : p.y < TTOP + TIERH * 2 ? 1 : 0;
      land(g, tier, speed);
    } else if (p.y > 518) miss(g, p.vy > 8, "SPLASH! MISSED THE TANK!");
    else if (p.y < -50) miss(g, false, "DRIFTED AWAY!");
    else if (p.x > 985 || p.x < -25) miss(g, false, "SAILED AWAY!");
  } else if (g.phase === "settle") {
    g.settleT--;
    if (g.settleT <= 0) {
      g.settleFriend = null;
      if (g.loseReason) { endRun(g, false); return; }
      if (g.housed.length >= 6) { g.score += Math.max(0, (12 - g.drops)) * 50; endRun(g, true); return; }
      if (g.hard >= 3) { g.loseReason = "THE TANK TIPPED! TRY AGAIN."; endRun(g, false); return; }
      if (g.drops >= 12) { g.loseReason = "THE TANK TIPPED! TRY AGAIN."; endRun(g, false); return; }
      g.phase = "ready";
    }
  }
  // immediate checks after settle triggered this frame? handled in settle countdown; also hard limit check in settle
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];
function tierFloor(tier: number) { return TTOP + TIERH * (2 - tier) + TIERH; }

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [250, 246, 235], [186, 226, 242]);
  // clouds / sun / sea depth
  draw.setFillStyle("#fff3b0"); draw.beginPath(); draw.arc(875, 62, 34, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("rgba(255,255,255,0.85)");
  for (const [cx, cy, sc] of [[180, 70, 1], [520, 48, 0.7], [720, 95, 0.8]] as const) { draw.beginPath(); draw.arc(cx, cy, 22 * sc, 0, Math.PI * 2, false); draw.arc(cx + 24 * sc, cy + 3, 16 * sc, 0, Math.PI * 2, false); draw.fill(); }
  draw.setFillStyle("#8fd0e8"); draw.fillRect(0, 468, W, 72);
  draw.setFillStyle("#6fb9d8"); for (let x = 0; x < W; x += 46) draw.fillRect(x + dsin(g.frame * 0.03 + x) * 6, 492 + ((x * 7) % 22), 28, 4);
  draw.setFillStyle("#f7e3b0"); draw.fillRect(0, 452, 210, 24);

  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);
  // lighthouse + beam
  const warn = g.scene === "play" && (g.gustReady || g.gustIn < 180);
  const beamCol = g.gustReady || (g.scene === "play" && g.gustIn < 85) ? "rgba(255,70,70,0.30)" : "rgba(255,210,50,0.28)";
  if (g.scene === "play" || g.scene === "title") { draw.setFillStyle(beamCol); draw.beginPath(); draw.moveTo(92, 292); draw.lineTo(560, 250 + dsin(g.frame * 0.02) * 28); draw.lineTo(560, 330 + dsin(g.frame * 0.02) * 28); draw.closePath(); draw.fill(); }
  drawSprite(draw, s.lighthouse!, 92, 382, 190);
  if (warn) text(draw, g.gustReady ? "GUST!" : "WIND...", 92, 260, 18, g.gustReady ? "#ff4040" : "#e6a800", "center");

  // tank (rocking)
  const tilt = dsin(g.frame * 0.08) * (g.tip / 100) * 0.14 + (g.tip / 100) * 0.08;
  draw.save(); draw.translate(TX + TW / 2, TFLOOR); draw.rotate(tilt); draw.translate(-(TX + TW / 2), -TFLOOR);
  draw.setFillStyle("rgba(180,235,255,0.35)"); draw.fillRect(TX, TTOP, TW, TIERH * 3);
  draw.setStrokeStyle("#3a7ca5"); (draw as any).lineWidth = 4; draw.strokeRect(TX, TTOP, TW, TIERH * 3);
  (draw as any).lineWidth = 2; for (let i = 1; i < 3; i++) { draw.beginPath(); draw.moveTo(TX, TTOP + i * TIERH); draw.lineTo(TX + TW, TTOP + i * TIERH); draw.stroke(); }
  text(draw, "TOP · JELLY", TX + 10, TTOP + 16, 13, "#3a7ca5"); text(draw, "MIDDLE · OCTOPUS", TX + 10, TTOP + TIERH + 16, 13, "#3a7ca5"); text(draw, "BOTTOM · WHALE", TX + 10, TTOP + TIERH * 2 + 16, 13, "#3a7ca5");
  // water in tiers
  draw.setFillStyle("rgba(120,200,240,0.25)"); for (let i = 0; i < 3; i++) draw.fillRect(TX + 4, TTOP + i * TIERH + TIERH - 22, TW - 8, 18);
  const drawHoused = (h: Housed) => { const hx = TX + 78 + h.slot * 76, hy = tierFloor(h.tier) - HEIGHT[h.kind] / 2 + 4; const age = g.frame - h.born; const sq = age < 18 ? { sx: 1.25, sy: 0.7 } : { sx: 1, sy: 1 }; drawSprite(draw, s[h.kind]!, hx, hy + dsin(g.frame * 0.06 + hx) * 2, HEIGHT[h.kind], { ...sq, rot: dsin(g.frame * 0.04 + hx) * 0.05 }); };
  for (const h of g.housed) drawHoused(h);
  if (g.settleFriend && !g.settleGood) drawHoused(g.settleFriend);
  draw.restore();
  if (g.tip > 45) text(draw, "TANK ROCKING!", TX + TW / 2, TTOP - 16, 20, "#ff4040", "center");

  // title dangling whale sways title (also boat in play)
  const isTitle = g.scene !== "play";
  const boatY = 78, sway = dsin(g.frame * 0.025) * 0.55;
  const bx = isTitle ? W / 2 : g.boatX;
  // line + friend in swing / title
  if (isTitle) {
    const ax = bx, ay = boatY + 18, L = 120, th = sway;
    draw.setStrokeStyle("#333"); (draw as any).lineWidth = 3; draw.beginPath(); draw.moveTo(ax, ay); draw.lineTo(ax + dsin(th) * L, ay + dcos(th) * L); draw.stroke();
    drawSprite(draw, s.whale!, ax + dsin(th) * L, ay + dcos(th) * L + 24, 92, { rot: th * 0.7, sx: 1 + dsin(g.frame * 0.1) * 0.04, sy: 1 - dsin(g.frame * 0.1) * 0.04 });
  } else if (g.phase === "swing") {
    const fp = friendPos(g);
    draw.setStrokeStyle("#333"); (draw as any).lineWidth = 3; draw.beginPath(); draw.moveTo(g.boatX, boatY + 16);
    // wavy line for octopus stretch
    if (cur(g).kind === "octopus") { for (let i = 1; i <= 6; i++) { const t = i / 6; draw.lineTo(g.boatX + (fp.x - g.boatX) * t + dsin(t * 9 + g.frame * 0.2) * 4, boatY + 16 + (fp.y - boatY - 16) * t); } } else draw.lineTo(fp.x, fp.y);
    draw.stroke();
    const sq = squash(g.omega * effLen(g) * 0.02, 0.3);
    drawSprite(draw, s[cur(g).kind]!, fp.x, fp.y, HEIGHT[cur(g).kind], { rot: g.theta * 0.65, ...sq });
    // predicted hint dots
    draw.setFillStyle("rgba(0,0,0,0.25)"); draw.beginPath(); draw.arc(fp.x, fp.y, 4, 0, Math.PI * 2, false); draw.fill();
  }
  // boat
  drawSprite(draw, s.boat!, bx, boatY, 92, { rot: isTitle ? sway * 0.12 : g.boatVx * 0.018, flip: g.boatVx < -0.6 });
  if (!isTitle && g.phase === "ready") {
    const k = cur(g).kind; drawSprite(draw, s[k]!, bx + 34, boatY - 28, HEIGHT[k] * 0.85, { rot: dsin(g.frame * 0.08) * 0.08 });
    text(draw, "SPACE: DROP HOOK", bx, boatY - 78, 17, "#225", "center");
  }
  if (!isTitle && g.phase === "swing") text(draw, "SPACE: RELEASE!  ↑↓ LINE", bx, 32, 16, "#225", "center");
  // falling friend
  if (g.proj) { const sq = squash(g.proj.vy); drawSprite(draw, s[g.proj.kind]!, g.proj.x, g.proj.y, HEIGHT[g.proj.kind], { rot: g.proj.rot, ...sq }); if (g.proj.perfect) { draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(g.proj.x - g.proj.vx * 3, g.proj.y - g.proj.vy * 3, 4, 0, Math.PI * 2, false); draw.fill(); } }
  // settle splash friend handled in tank; bubbles
  drawJuice(draw, g.j); draw.restore();

  if (g.scene === "play") {
    panel(draw, 14, 12, 470, 58, "rgba(255,255,255,0.75)");
    text(draw, `DROPS ${g.drops}/12   HOME ${g.housed.length}/6   SCORE ${g.score}`, 28, 32, 18, "#123");
    text(draw, `NEXT: ${QUEUE[Math.min(g.qIndex, 5)]!.label}   HARD ${g.hard}/3   TIP ${Math.round(g.tip)}%`, 28, 55, 15, g.tip > 55 ? "#d00" : "#345");
    panel(draw, 620, 12, 326, 42, "rgba(255,255,255,0.7)");
    text(draw, "ARROWS MOVE - WS LINE - ARC IN FROM LEFT!", 783, 33, 14, "#123", "center");
    // progress bar
    draw.setFillStyle("#ddd"); draw.fillRect(14, 76, 200, 10); draw.setFillStyle("#ff6b9d"); draw.fillRect(14, 76, 200 * g.housed.length / 6, 10);
  }
  if (g.scene === "title") {
    const swayT = dsin(g.frame * 0.025) * 6;
    text(draw, "WHALE-WEIGHT AQUARIUM", W / 2 + swayT, 150, 62, "#123a5a", "center", "bangers");
    text(draw, "Swing each friend home - heavy low, jelly high!", W / 2, 205, 19, "#234");
    text(draw, "AD/ARROWS move boat - WS line - SPACE drop + release", W / 2, 470, 17, "#123", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "PRESS ENTER TO START", W / 2, 505, 26, "#d33", "center", "bangers");
  } else if (g.scene === "won") {
    panel(draw, 190, 150, 580, 240, "rgba(10,40,70,0.82)");
    text(draw, "EVERYONE'S HOME!", W / 2, 215, 48, "#ffd23f", "center", "bangers");
    text(draw, "BEAUTIFULLY BALANCED.", W / 2, 265, 26, "#fff", "center", "bangers");
    text(draw, `Score ${g.score} · Drops ${g.drops}/12`, W / 2, 315, 22, "#fff", "center");
    if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "ENTER TO PLAY AGAIN", W / 2, 360, 22, "#fff", "center");
  } else if (g.scene === "lost") {
    panel(draw, 190, 150, 580, 240, "rgba(70,10,10,0.85)");
    text(draw, g.loseReason || "THE TANK TIPPED! TRY AGAIN.", W / 2, 230, 34, "#ff9a9a", "center", "bangers");
    text(draw, `Home ${g.housed.length}/6 · Score ${g.score} · Drops ${g.drops}/12`, W / 2, 295, 20, "#fff", "center");
    if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "ENTER TO TRY AGAIN", W / 2, 350, 22, "#fff", "center");
  }
}

export default defineSim({
  players: 1, window: { width: W, height: H, title: "Whale-Weight Aquarium" }, clear: { r: 0.98, g: 0.96, b: 0.92 }, options: {}, neutral: 0, encode: encodeKeys, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {}; const ready = loadKit(platform, NAMES).then(s => { sprites = s; });
    return {
      ready, start: (seed) => { g = fresh(seed); }, step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => { let h = g.frame * 31 + g.score * 7 + g.drops * 13 + g.housed.length * 101 + Math.round(g.boatX * 10) + Math.round(g.theta * 1000); if (g.proj) h ^= Math.round(g.proj.x * 10) + Math.round(g.proj.y); return h >>> 0; },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.housed.length / 6, scene: g.scene, score: g.score, drops: g.drops, housed: g.housed.length, hard: g.hard, tip: Math.round(g.tip) }),
      over: () => false, save: () => structuredClone(g), restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; }, inspect: () => g, render: (draw) => render(g, draw, sprites),
    };
  },
});
