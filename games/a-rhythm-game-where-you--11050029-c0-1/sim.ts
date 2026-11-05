import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["guitar", "note", "drum", "pair", "tone", "frog"];
const SONG = 5400; // 90 seconds at 60fps
const BEAT = 30;   // frog lands every 30 frames (120 BPM)
const HIT_Y = 428;
const LANE_X = [262, 698];
const G_BIT = 1, D_BIT = 2, STOMP_BIT = 16, START_BIT = 32;

type Kind = "note" | "pair" | "tone" | "stomp";
interface Note { hit: number; lane: 0 | 1; kind: Kind; dur: number; travel: number; done: boolean; gotL: boolean; gotR: boolean; firstDt: number; holding: boolean; pressPos: 0 | 1; startGrade: number; heldFrames: number; }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  play: number; score: number; combo: number; best: number; streak: number; misses: number; perfects: number;
  notes: Note[]; j: Juice; mirror: number; slip: number; squashT: number; ringT: number; glowT: number;
  guitarWob: number; drumWob: number; frogSquash: number; lastGrade: string; finale: number; heldOk: number;
}

function makeChart(r: { s: number }): Note[] {
  const notes: Note[] = [];
  // deterministic-ish rand from seed stored in r
  const rnd = () => { r.s = (Math.imul(r.s, 1664525) + 1013904223) >>> 0; return r.s / 4294967296; };
  for (let beat = 6; beat < 176; beat++) {
    const t = beat / 176;
    if (beat < 36 && beat % 2 !== 0) continue;
    if (beat >= 36 && beat < 90 && rnd() < 0.18) continue;
    if (beat >= 90 && rnd() < 0.10) continue;
    if (beat >= 150 && beat % 7 === 3) { /* breath before finale */ continue; }
    const roll = rnd();
    let kind: Kind = "note";
    if (beat > 30 && roll < 0.08) kind = "stomp";
    else if (beat > 24 && roll < 0.20) kind = "pair";
    else if (beat > 18 && roll < 0.36) kind = "tone";
    const travel = Math.round(126 - t * 34); // notes arrive a little faster late
    notes.push({ hit: beat * BEAT, lane: rnd() < 0.5 ? 0 : 1, kind, dur: kind === "tone" ? 48 : 0, travel, done: false, gotL: false, gotR: false, firstDt: 0, holding: false, pressPos: 0, startGrade: 0, heldFrames: 0 });
  }
  return notes;
}
const fresh = (seed: number, scene: Scene = "title"): Game => {
  const r = rng(seed);
  const notes = makeChart(r);
  return { scene, sceneFrames: 0, frame: 0, prev: 0, r, play: 0, score: 0, combo: 0, best: 0, streak: 0, misses: 0, perfects: 0, notes, j: juice(), mirror: 0, slip: 0, squashT: 0, ringT: 0, glowT: 0, guitarWob: 0, drumWob: 0, frogSquash: 0, lastGrade: "", finale: 0, heldOk: 0 };
};

function encode(input: unknown): number {
  if (typeof input === "number") return input | 0;
  const i = (input ?? {}) as Record<string, boolean>;
  return ((i.a || i.k || i.left || i.KeyA || i.KeyK ? G_BIT : 0) | (i.s || i.l || i.right || i.down || i.KeyS || i.KeyL ? D_BIT : 0) | (i.space || i.action || i.jump ? STOMP_BIT : 0) | (i.enter || i.start ? START_BIT : 0));
}
const randomKeys = (next: () => number) => (next() < 0.45 ? G_BIT : 0) | (next() < 0.45 ? D_BIT : 0) | (next() < 0.3 ? STOMP_BIT : 0) | (next() < 0.05 ? START_BIT : 0);

function effPos(g: Game, n: Note): 0 | 1 { return g.mirror > 0 ? (n.lane === 0 ? 1 : 0) : n.lane; }
function gradeOf(dt: number) { const a = Math.abs(dt); return a <= 4 ? 3 : a <= 9 ? 2 : 1; } // 3 perfect 2 great 1 good
function award(g: Game, x: number, y: number, gr: number) {
  g.combo++; g.best = Math.max(g.best, g.combo);
  if (gr === 3) { g.perfects++; g.streak++; } else g.streak = 0;
  g.score += gr === 3 ? 300 : gr === 2 ? 150 : 80;
  const label = gr === 3 ? "PERFECT!" : gr === 2 ? "GREAT!" : "GREAT!";
  g.lastGrade = label;
  floatText(g.j, x, y - 46, label, gr === 3 ? "#ffd23f" : "#a8ffb0");
  if (g.combo > 1 && g.combo % 5 === 0) floatText(g.j, 480, 170, `COMBO x${g.combo}!`, "#ff9ff3");
  burst(g.j, g.r, x, y, gr === 3 ? 18 : 10, gr === 3 ? "#ffd23f" : "#ffffff", 5, 6);
  if (gr === 3) { g.frogSquash = 10; burst(g.j, g.r, x, y, 8, "#7CFC00", 3, 5); }
  if (g.streak >= 10) {
    const cols = ["#ff5a5a", "#ffa94d", "#ffd23f", "#69db7c", "#4dd7ff", "#b197fc"];
    burst(g.j, g.r, 480 + (g.streak % 7 - 3) * 8, 392, 10, cols[g.streak % cols.length]!, 3.5, 7);
  }
}
function registerMiss(g: Game, n: Note, x: number) {
  if (n.done) return; n.done = true;
  g.misses++; g.combo = 0; g.streak = 0; g.mirror = 120; g.slip = 36; g.lastGrade = "MISS...";
  floatText(g.j, x, HIT_Y - 70, "MISS...", "#ff8a8a");
  floatText(g.j, 480, 150, "MIRRORED LANES!", "#ffb0b0");
  burst(g.j, g.r, x, HIT_Y, 12, "#ff5a5a", 4, 6); shake(g.j, 8);
  if (g.misses >= 8) endRun(g, false);
}

function tryLane(g: Game, pos: 0 | 1, limit = 45): boolean {
  if (pos === 0) g.guitarWob = 14; else g.drumWob = 14;
  // closest candidate
  let best: Note | null = null; let bestDt = 999;
  for (const n of g.notes) {
    if (n.done || n.kind === "stomp") continue;
    const dt = g.play - n.hit; if (Math.abs(dt) > limit) continue;
    if (n.kind === "pair") { if ((pos === 0 && n.gotL) || (pos === 1 && n.gotR)) continue; }
    else if (effPos(g, n) !== pos) continue;
    if (n.holding) continue;
    if (Math.abs(dt) < Math.abs(bestDt)) { best = n; bestDt = dt; }
  }
  let wrongLane = false;
  if (!best) {
    // Wrong-lane tap on the beat still keeps the show going, but can never be PERFECT.
    for (const n of g.notes) {
      if (n.done || n.kind === "stomp" || n.kind === "pair" || n.holding) continue;
      const dt = g.play - n.hit; if (Math.abs(dt) > limit) continue;
      if (Math.abs(dt) < Math.abs(bestDt)) { best = n; bestDt = dt; wrongLane = true; }
    }
    if (!best) return false;
  }
  const x = best.kind === "pair" ? (pos === 0 ? LANE_X[0] : LANE_X[1]) : LANE_X[effPos(g, best)];
  if (best.kind === "pair") {
    if (pos === 0) best.gotL = true; else best.gotR = true;
    if (best.gotL && best.gotR) { best.done = true; award(g, 480, HIT_Y, gradeOf(bestDt)); }
    else { best.firstDt = bestDt; burst(g.j, g.r, x, HIT_Y, 6, "#ffd23f", 3, 5); }
    return true;
  }
  if (best.kind === "tone") { best.holding = true; best.pressPos = pos; best.startGrade = wrongLane ? Math.min(2, gradeOf(bestDt)) : gradeOf(bestDt); floatText(g.j, x, HIT_Y - 60, "HOLD...", "#aee2ff"); burst(g.j, g.r, x, HIT_Y, 8, "#aee2ff", 3, 5); return true; }
  best.done = true; if (wrongLane) g.streak = 0; award(g, x, HIT_Y, wrongLane ? Math.min(2, gradeOf(bestDt)) : gradeOf(bestDt)); return true;
}
function tryStomp(g: Game, limit = 45) {
  for (const n of g.notes) {
    if (n.done || n.kind !== "stomp") continue;
    const dt = g.play - n.hit; if (Math.abs(dt) > limit) continue;
    n.done = true; g.glowT = 18; g.frogSquash = 14; shake(g.j, 7); g.ringT = 16;
    award(g, 480, 360, gradeOf(dt)); floatText(g.j, 480, 250, "STOMP!", "#ffd23f"); return;
  }
  // stomp anyway for fun on a beat
  if (g.play % BEAT <= 4 || g.play % BEAT >= BEAT - 4) { g.frogSquash = 10; g.ringT = 12; shake(g.j, 4); burst(g.j, g.r, 480, 400, 10, "#ffd23f", 4, 6); }
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") return;
  g.play++;
  if (g.mirror > 0) g.mirror--;
  if (g.slip > 0) g.slip--; if (g.ringT > 0) g.ringT--; if (g.glowT > 0) g.glowT--; if (g.guitarWob > 0) g.guitarWob--; if (g.drumWob > 0) g.drumWob--; if (g.frogSquash > 0) g.frogSquash--;

  // frog landing on every beat
  if (g.play % BEAT === 0) { g.squashT = 8; g.ringT = Math.max(g.ringT, 10); shake(g.j, 2.5); }

  if (edge & G_BIT) { if (!tryLane(g, 0)) tryStomp(g); }
  if (edge & D_BIT) { if (!tryLane(g, 1)) tryStomp(g); }
  if (edge & STOMP_BIT) tryStomp(g);
  // A lane held through the frog's landing still catches its note (PERFECT needs a sharp tap near the landing).
  if ((keys & G_BIT) && !(edge & G_BIT)) tryLane(g, 0, 7);
  if ((keys & D_BIT) && !(edge & D_BIT)) tryLane(g, 1, 7);
  if ((keys & STOMP_BIT) && !(edge & STOMP_BIT)) tryStomp(g, 7);

  // holds and misses
  for (const n of g.notes) {
    if (n.done) continue;
    if (n.holding) {
      const held = n.pressPos === 0 ? (keys & G_BIT) !== 0 : (keys & D_BIT) !== 0;
      if (held) n.heldFrames++;
      // You may re-grip a hold: it only fails if you barely held it by the time its tail passes.
      if (g.play >= n.hit + n.dur) {
        if (n.heldFrames >= 9) { n.done = true; g.heldOk++; award(g, LANE_X[effPos(g, n)], HIT_Y, n.startGrade); }
        else registerMiss(g, n, LANE_X[effPos(g, n)]);
      }
      continue;
    }
    if (g.play > n.hit + 45) {
      if (n.kind === "pair" && (n.gotL || n.gotR)) { n.done = true; g.streak = 0; award(g, 480, HIT_Y, 1); floatText(g.j, 480, HIT_Y - 90, "PAIR SAVED!", "#a8ffb0"); }
      else registerMiss(g, n, n.kind === "stomp" ? 480 : n.kind === "pair" ? 480 : LANE_X[effPos(g, n)]);
      if (g.scene !== "play") return;
    }
  }
  if (g.play >= SONG) { g.finale = 1; endRun(g, true); }
}

type Draw = Parameters<NonNullable<SimRun["render"]>>[0];
function noteY(g: Game, n: Note) { return HIT_Y - (n.hit - g.play) * (470 / n.travel); }

function renderStage(g: Game, draw: Draw, s: Record<string, Sprite>) {
  sky(draw, W, H, [42, 12, 18], [128, 62, 32]);
  // curtains
  draw.setFillStyle("#7a1622"); draw.fillRect(0, 0, 110, H); draw.fillRect(W - 110, 0, 110, H);
  draw.setFillStyle("#a32633"); for (let i = 0; i < 5; i++) { draw.fillRect(14 + i * 20, 0, 10, H); draw.fillRect(W - 24 - i * 20, 0, 10, H); }
  // backdrop stars / lights
  for (let i = 0; i < 14; i++) { const x = 140 + (i * 61) % 680, y = 56 + (i * 37) % 130; draw.setGlobalAlpha(0.5 + 0.5 * dsin(g.frame * 0.08 + i)); draw.setFillStyle(i % 2 ? "#ffd23f" : "#fff2b0"); draw.beginPath(); draw.arc(x, y, 4, 0, Math.PI * 2, false); draw.fill(); }
  draw.setGlobalAlpha(1);
  // spotlight cone to frog
  draw.setGlobalAlpha(0.16); draw.setFillStyle("#fff7c0"); draw.beginPath(); draw.moveTo(400, 20); draw.lineTo(560, 20); draw.lineTo(640, 470); draw.lineTo(320, 470); draw.closePath(); draw.fill(); draw.setGlobalAlpha(1);
  // floor
  draw.setFillStyle("#5a3420"); draw.fillRect(0, 462, W, 78);
  draw.setFillStyle("#7a4a2a"); draw.fillRect(0, 462, W, 10);
  for (let i = 0; i < 12; i++) draw.fillRect(i * 84, 488, 62, 4);
}

function render(g: Game, draw: Draw, s: Record<string, Sprite>) {
  renderStage(g, draw, s);
  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);

  const inPlay = g.scene === "play";
  const tPlay = inPlay ? g.play : g.frame;
  // lanes
  for (let li = 0; li < 2; li++) {
    const x = LANE_X[li]!;
    const mirrored = inPlay && g.mirror > 0;
    draw.setGlobalAlpha(0.28); draw.setFillStyle(mirrored ? "#ff8a8a" : "#2a160d"); draw.fillRect(x - 52, 84, 104, HIT_Y - 60);
    draw.setGlobalAlpha(1); draw.setStrokeStyle(mirrored ? "#ff8a8a" : "#ffd9a0"); (draw as any).lineWidth = 3; draw.beginPath(); draw.moveTo(x - 52, 84); draw.lineTo(x - 52, HIT_Y + 28); draw.moveTo(x + 52, 84); draw.lineTo(x + 52, HIT_Y + 28); draw.stroke();
    // hit ring
    draw.setStrokeStyle(li === 0 ? "#ffd23f" : "#a8ffb0"); (draw as any).lineWidth = 4; draw.beginPath(); draw.arc(x, HIT_Y, 34 + dsin(g.frame * 0.15 + li) * 3, 0, Math.PI * 2, false); draw.stroke();
    text(draw, li === 0 ? (mirrored ? "DRUM  A/K" : "GUITAR  A/K") : (mirrored ? "GUITAR S/L" : "DRUM  S/L"), x, HIT_Y + 52, 15, "#ffe9b0", "center");
  }
  if (inPlay && g.mirror > 0) text(draw, "⇄ MIRRORED!", 480, 92, 22, "#ff9a9a", "center", "bangers");

  // notes
  if (inPlay) {
    for (const n of g.notes) {
      if (n.done) continue; const y = noteY(g, n); if (y < -90 || y > H + 80) continue;
      if (n.kind === "stomp") {
        const pulse = 1 + dsin(g.frame * 0.3) * 0.12;
        draw.setGlobalAlpha(0.85); draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(480, 360 + (y - HIT_Y) * 0.12, 30 * pulse, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1);
        text(draw, "STOMP!", 480, 360 + (y - HIT_Y) * 0.12, 16, "#5a2d00", "center"); continue;
      }
      if (n.kind === "pair") {
        // beam
        draw.setStrokeStyle("#111"); (draw as any).lineWidth = 6; draw.beginPath(); draw.moveTo(LANE_X[0], y); draw.lineTo(LANE_X[1], y); draw.stroke();
        drawSprite(draw, s.pair!, 480, y, 92, { rot: dsin(g.frame * 0.1) * 0.06 });
        if (n.gotL) { draw.setFillStyle("#69db7c"); draw.beginPath(); draw.arc(LANE_X[0], y, 16, 0, Math.PI * 2, false); draw.fill(); }
        if (n.gotR) { draw.setFillStyle("#69db7c"); draw.beginPath(); draw.arc(LANE_X[1], y, 16, 0, Math.PI * 2, false); draw.fill(); }
        continue;
      }
      const pos = effPos(g, n); const x = LANE_X[pos];
      if (n.kind === "tone") {
        const tailLen = n.dur * (470 / n.travel);
        draw.setFillStyle(n.holding ? "#7ed6ff" : "#3a7ca5"); draw.fillRect(x - 10, y - tailLen, 20, tailLen);
        drawSprite(draw, s.tone!, x, y, 84, { sx: n.holding ? 1.15 : 1, sy: n.holding ? 1.15 : 1 });
      } else drawSprite(draw, s.note!, x, y, 62, { rot: dsin(g.frame * 0.12 + n.hit) * 0.2 });
    }
  }

  // instruments at bases
  const gw = g.guitarWob > 0 ? dsin(g.guitarWob * 0.9) * 0.14 : 0;
  drawSprite(draw, s.guitar!, LANE_X[0], HIT_Y + 6, 138, { rot: -0.22 + gw, sx: g.guitarWob > 0 ? 1.08 : 1 });
  const dw = g.drumWob > 0 ? dsin(g.drumWob * 0.9) * 0.08 : 0;
  drawSprite(draw, s.drum!, LANE_X[1], HIT_Y + 10, 118, { rot: dw, sy: g.drumWob > 0 ? 0.92 : 1 });

  // center big drum + frog (the metronome)
  const beatPhase = (tPlay % BEAT) / BEAT;
  const bounce = dsin(beatPhase * Math.PI); // 0 at landing
  const amp = g.scene === "won" ? 20 : 46 + Math.min(36, g.combo * 1.2);
  let frogY = 382 - bounce * amp;
  if (g.scene === "won") frogY = 300 - Math.abs(dsin(g.sceneFrames * 0.06)) * 120;
  if (g.scene === "lost") frogY = 398;
  const landing = beatPhase < 0.14;
  const sq = g.frogSquash > 0 || landing ? 0.35 : bounce > 0.85 ? -0.12 : 0;
  // ring shockwave on landing
  if (g.ringT > 0 || landing) { const rr = 70 + (12 - Math.max(0, g.ringT)) * 7; draw.setGlobalAlpha(Math.max(0, g.ringT / 14)); draw.setStrokeStyle("#ffd9a0"); (draw as any).lineWidth = 4; draw.beginPath(); draw.arc(480, 438, rr, 0, Math.PI * 2, false); draw.stroke(); draw.setGlobalAlpha(1); }
  drawSprite(draw, s.drum!, 480, 452, 128, { sy: landing ? 0.9 : 1 });
  const danceRot = inPlay ? dsin(g.frame * (0.12 + Math.min(0.18, g.combo * 0.006))) * (g.combo >= 12 ? 0.34 : g.combo >= 5 ? 0.2 : 0.08) : dsin(g.frame * 0.08) * 0.08;
  const slipRot = g.slip > 0 ? dsin(g.slip * 0.8) * 0.4 : 0;
  drawSprite(draw, s.frog!, 480, frogY, g.scene === "title" ? 170 : 142, { rot: danceRot + slipRot, sx: 1 + sq * 0.7, sy: 1 - sq, flip: g.mirror > 0 });
  if (g.streak >= 10 && inPlay) text(draw, "🌈 RAINBOW STREAK!", 480, frogY - 92, 17, "#ffd23f", "center");
  if (g.glowT > 0) { draw.setGlobalAlpha(g.glowT / 20); draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(480, frogY, 86, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1); }

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (inPlay) {
    panel(draw, 14, 12, 360, 58, "rgba(20,8,4,0.62)");
    text(draw, `SCORE ${g.score}`, 28, 32, 22, "#ffd23f"); text(draw, `COMBO x${g.combo}  BEST x${g.best}`, 28, 56, 16, "#fff");
    panel(draw, 610, 12, 336, 58, "rgba(20,8,4,0.62)");
    text(draw, `MISSES ${g.misses}/8`, 928, 32, 20, g.misses >= 6 ? "#ff8a8a" : "#fff", "right");
    text(draw, `${Math.max(0, Math.ceil((SONG - g.play) / 60))}s  PERFECTS ${g.perfects}`, 928, 56, 16, "#ffe9b0", "right");
    // song progress
    draw.setFillStyle("rgba(0,0,0,0.5)"); draw.fillRect(262, 18, 436, 12);
    draw.setFillStyle("#ffd23f"); draw.fillRect(262, 18, 436 * Math.min(1, g.play / SONG), 12);
    text(draw, "♪", 480, 44, 18, "#fff", "center");
    panel(draw, 14, H - 38, 932, 28, "rgba(20,8,4,0.55)");
    text(draw, "A/K Guitar lane  •  S/L Drum lane  •  Hit PAIRS with both  •  HOLD big notes  •  SPACE = Frog Stomp on gold beats", 480, H - 24, 15, "#ffe9b0", "center");
  }

  // overlays (custom, English)
  if (g.scene === "title") {
    draw.setFillStyle("rgba(0,0,0,0.28)"); draw.fillRect(0, 0, W, 210);
    text(draw, "FROGGY FINALE", W / 2, 78 + dsin(g.frame * 0.05) * 5, 68, "#ffd23f", "center", "bangers");
    text(draw, "Press Enter, Feel The Beat!", W / 2, 132, 26, "#a8ffb0", "center");
    text(draw, "Hit notes when the frog LANDS!  A/K = guitar  •  S/L = drum  •  SPACE = stomp", W / 2, 170, 17, "#fff", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "▶  PRESS ENTER  ◀", W / 2, 198, 22, "#fff", "center");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(0,0,0,0.45)"); draw.fillRect(0, 0, W, H);
    text(draw, "BRAVO! What A Dance!", W / 2, 120, 58, "#ffd23f", "center", "bangers");
    text(draw, `Score ${g.score}  •  Best Combo x${g.best}  •  Perfects ${g.perfects}`, W / 2, 180, 22, "#fff", "center");
    text(draw, "The frog pulled off the BIG FINALE LEAP!", W / 2, 216, 20, "#a8ffb0", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER — play again", W / 2, 470, 24, "#fff", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(0,0,0,0.55)"); draw.fillRect(0, 0, W, H);
    text(draw, "The Crowd Went Quiet...", W / 2, 130, 52, "#ff8a8a", "center", "bangers");
    text(draw, `You missed 8 notes — Score ${g.score}  •  Best Combo x${g.best}`, W / 2, 190, 20, "#fff", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER — try again", W / 2, 470, 24, "#fff", "center");
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Froggy Finale" },
  clear: { r: 0.16, g: 0.05, b: 0.07 },
  options: {}, neutral: 0, encode, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((s) => { sprites = s; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => { let h = g.frame * 31 + g.score * 7 + g.misses * 131 + g.combo * 17 + g.play; for (const n of g.notes) if (n.done) h = (Math.imul(h, 16777619) ^ n.hit) >>> 0; return h >>> 0; },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.scene === "won" ? 1 : Math.max(0, Math.min(0.99, (g.play / SONG) * (1 - g.misses * 0.07) + Math.min(0.05, g.perfects * 0.001))), scene: g.scene, score: g.score, combo: g.combo, misses: g.misses, perfects: g.perfects }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
