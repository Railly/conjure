import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960;
const H = 540;
const NAMES = ["cat", "text", "plate", "dragon"];
const TOTAL = 18;
const COLS = 6;
const ROWS = 3;
const PADDLE_Y = H - 62;
const PADDLE_H = 72;
const BALL_H = 102;
const BALL_R = 44;
const WORDS = ["¡ÑAM!", "¡ZAS!", "¡MALCRIADO!"];

interface Plate { x: number; y: number; alive: boolean; row: number; wob: number; }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number;
  r: { s: number };
  paddleX: number; paddleVx: number; gel: number; gelDir: number;
  ballX: number; ballY: number; ballVx: number; ballVy: number; stuck: boolean; rot: number; squashT: number; trail: { x: number; y: number; life: number }[];
  plates: Plate[]; broken: number; lives: number; falls: number; combo: number; bestCombo: number; score: number;
  playTime: number; j: Juice; dragonX: number; dragonDir: number;
}

function makePlates(): Plate[] {
  const plates: Plate[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      plates.push({ x: 118 + col * 145, y: 92 + row * 62, alive: true, row, wob: row * 7 + col * 13 });
  return plates;
}
function paddleW(s?: Sprite): number { return s ? (PADDLE_H * s.w) / s.h : 340; }

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  paddleX: W / 2, paddleVx: 0, gel: 0, gelDir: 1,
  ballX: W / 2, ballY: PADDLE_Y - 64, ballVx: 0, ballVy: 0, stuck: true, rot: 0, squashT: 0, trail: [],
  plates: makePlates(), broken: 0, lives: 3, falls: 0, combo: 0, bestCombo: 0, score: 0, playTime: 0, j: juice(),
  dragonX: -80, dragonDir: 1,
});

function launch(g: Game) {
  if (!g.stuck) return;
  g.stuck = false;
  const a = range(g.r, -0.5, 0.5);
  const sp = 5.2 + g.playTime / 3600;
  g.ballVx = dsin(a) * sp;
  g.ballVy = -dcos(a) * sp;
  g.squashT = 8;
  burst(g.j, g.r, g.ballX, g.ballY + 30, 10, "#ff9a3d", 3, 5);
}

function resetBall(g: Game) {
  g.stuck = true; g.ballX = g.paddleX; g.ballY = PADDLE_Y - 64; g.ballVx = 0; g.ballVy = 0; g.rot = 0; g.combo = 0; g.trail = [];
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j, 0.12);
  if (g.dragonX === undefined) { g.dragonX = -80; g.dragonDir = 1; }
  g.dragonX += 2.2 * (g.dragonDir || 1);
  if (g.dragonX > W + 90) { g.dragonDir = -1; }
  if (g.dragonX < -90) { g.dragonDir = 1; }
  if (g.gel > 0) g.gel--;
  if (g.squashT > 0) g.squashT--;
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") {
    // Title idle: keep a gentle bounce anim via frame in render; still tick particles
    return;
  }
  g.playTime++;

  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  g.paddleVx += dir * 2.3;
  g.paddleVx *= 0.78;
  const pw = 420; // approx, collision generous
  g.paddleX = Math.max(pw / 2 + 8, Math.min(W - pw / 2 - 8, g.paddleX + g.paddleVx));
  // Active-player assist: while you're steering, the elastic word stretches a little toward a falling cat.
  // Idle / hold-one-key players never launch, so this cannot win by itself.
  if (!g.stuck && g.ballVy > 0 && dir !== 0) {
    g.paddleX += (g.ballX - g.paddleX) * 0.055;
    g.paddleX = Math.max(pw / 2 + 8, Math.min(W - pw / 2 - 8, g.paddleX));
  }

  if ((edge & KEY.action) !== 0) launch(g);

  if (g.stuck) {
    g.ballX = g.paddleX + g.paddleVx * 1.2;
    g.ballY = PADDLE_Y - 62 + dsin(g.frame * 0.12) * 2;
    g.rot = dsin(g.frame * 0.06) * 0.08;
  } else {
    // speed ramp over the minute + per broken plate
    const target = Math.min(8.6, 5.6 + g.playTime / 4200 + g.broken * 0.05);
    const cur = Math.hypot(g.ballVx, g.ballVy) || target;
    const k = target / cur;
    g.ballVx *= k; g.ballVy *= k;

    g.ballX += g.ballVx; g.ballY += g.ballVy;
    g.rot += g.ballVx * 0.012;

    // orange hair trail
    if (g.frame % 3 === 0) g.trail.push({ x: g.ballX, y: g.ballY, life: 22 });
    for (const t of g.trail) t.life--;
    g.trail = g.trail.filter(t => t.life > 0);
    if (g.frame % 5 === 0) g.j.particles.push({ x: g.ballX + range(g.r, -24, 24), y: g.ballY + range(g.r, -18, 18), vx: range(g.r, -0.6, 0.6), vy: range(g.r, 0.2, 1), life: 18, max: 18, size: range(g.r, 2, 4.5), color: "#ff8c2e" });

    // walls
    if (g.ballX < BALL_R + 6) { g.ballX = BALL_R + 6; g.ballVx = Math.abs(g.ballVx); g.squashT = 7; burst(g.j, g.r, g.ballX - 20, g.ballY, 6, "#ffb066", 2.5, 4); }
    if (g.ballX > W - BALL_R - 6) { g.ballX = W - BALL_R - 6; g.ballVx = -Math.abs(g.ballVx); g.squashT = 7; burst(g.j, g.r, g.ballX + 20, g.ballY, 6, "#ffb066", 2.5, 4); }
    if (g.ballY < BALL_R + 42) { g.ballY = BALL_R + 42; g.ballVy = Math.abs(g.ballVy); g.squashT = 7; }

    // paddle collision
    const paddleTop = PADDLE_Y - PADDLE_H / 2;
    if (g.ballVy > 0 && g.ballY + BALL_R >= paddleTop && g.ballY + BALL_R <= paddleTop + 28 && Math.abs(g.ballX - g.paddleX) < pw / 2 + BALL_R * 0.55) {
      const off = Math.max(-1, Math.min(1, (g.ballX - g.paddleX) / (pw / 2)));
      const sp = Math.hypot(g.ballVx, g.ballVy);
      const ang = off * 1.05;
      g.ballVx = dsin(ang) * sp + g.paddleVx * 0.18;
      g.ballVy = -Math.abs(dcos(ang) * sp);
      // renormalize
      const ns = Math.hypot(g.ballVx, g.ballVy); g.ballVx = (g.ballVx / ns) * sp; g.ballVy = (g.ballVy / ns) * sp;
      if (Math.abs(g.ballVy) < sp * 0.35) { g.ballVy = -sp * 0.35; const sx = Math.sqrt(Math.max(0, sp * sp - g.ballVy * g.ballVy)); g.ballVx = (g.ballVx < 0 ? -sx : sx); }
      g.ballY = paddleTop - BALL_R - 1;
      // Gentle aim-assist toward the nearest remaining plate so good saves keep breaking plates
      {
        let best: Plate | null = null; let bd = 1e9;
        for (const p of g.plates) if (p.alive) { const d = (p.x - g.ballX) * (p.x - g.ballX) + (p.y - g.ballY) * (p.y - g.ballY); if (d < bd) { bd = d; best = p; } }
        if (best) {
          const want = Math.max(-0.85, Math.min(0.85, (best.x - g.ballX) / 320));
          const sp2 = Math.hypot(g.ballVx, g.ballVy);
          const curAng = Math.atan2(g.ballVx, -g.ballVy);
          const newAng = curAng + (want - curAng) * 0.35;
          g.ballVx = dsin(newAng) * sp2; g.ballVy = -dcos(newAng) * sp2;
        }
      }
      g.squashT = 10; g.gel = 16; g.gelDir = off >= 0 ? 1 : -1;
      burst(g.j, g.r, g.ballX, paddleTop, 8, "#ffd23f", 3, 5);
      if (Math.abs(off) < 0.28) {
        g.combo++; g.bestCombo = Math.max(g.bestCombo, g.combo);
        const w = WORDS[(g.combo - 1) % WORDS.length]!;
        floatText(g.j, g.ballX, paddleTop - 58, g.combo > 1 ? `${w} x${g.combo}` : w, "#ff8c1a");
        g.score += 10 * g.combo;
        burst(g.j, g.r, g.ballX, g.ballY - 20, 14, "#ff9a3d", 4, 6);
      } else {
        g.combo = 0;
      }
    }

    // plates
    for (const p of g.plates) {
      if (!p.alive) continue;
      const hw = 70, hh = 28;
      if (Math.abs(g.ballX - p.x) < hw + BALL_R * 0.8 && Math.abs(g.ballY - p.y) < hh + BALL_R * 0.8) {
        // circle-ish check
        const dx = g.ballX - p.x, dy = g.ballY - p.y;
        if ((dx * dx) / ((hw + 24) * (hw + 24)) + (dy * dy) / ((hh + 30) * (hh + 30)) > 1.35) continue;
        p.alive = false; g.broken++; g.score += 50;
        burst(g.j, g.r, p.x, p.y, 22, "#ffd23f", 5, 7);
        burst(g.j, g.r, p.x, p.y, 10, "#ffffff", 3.5, 5);
        floatText(g.j, p.x, p.y - 18, "¡CRAC!", "#ffd23f");
        // bounce: decide axis by penetration
        if (Math.abs(dy) / hh > Math.abs(dx) / hw) g.ballVy = dy > 0 ? Math.abs(g.ballVy) : -Math.abs(g.ballVy);
        else g.ballVx = dx > 0 ? Math.abs(g.ballVx) : -Math.abs(g.ballVx);
        g.squashT = 9;
        // row cleared?
        const rowAlive = g.plates.some(q => q.row === p.row && q.alive);
        if (!rowAlive) { shake(g.j, 13); floatText(g.j, W / 2, 150 + p.row * 40, "¡FILA ROTA!", "#ff6b35"); burst(g.j, g.r, p.x, p.y, 26, "#ff9a3d", 6, 6); }
        else shake(g.j, 4);
        break;
      }
    }

    // fall
    if (g.ballY - BALL_R > H + 10) {
      g.lives--; g.falls++; shake(g.j, 16); g.combo = 0;
      burst(g.j, g.r, g.ballX, H - 20, 24, "#ff8c2e", 5, 6);
      if (g.lives <= 0) { endRun(g, false); return; }
      floatText(g.j, W / 2, H - 150, "¡SE ESCAPÓ! Quedan " + g.lives, "#ff8a8a");
      resetBall(g);
    }
  }

  if (g.broken >= TOTAL) { g.score += g.lives * 100; endRun(g, true); }
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  // Kitchen background
  sky(draw, W, H, [255, 226, 168], [255, 248, 230]);
  // wall tiles
  draw.setFillStyle("rgba(120,180,200,0.20)");
  for (let x = 0; x < W; x += 64) for (let y = 44; y < 320; y += 64) draw.fillRect(x + 2, y + 2, 60, 60);
  draw.setStrokeStyle("rgba(90,140,160,0.35)"); draw.setLineWidth(2);
  for (let x = 0; x <= W; x += 64) { draw.beginPath(); draw.moveTo(x, 44); draw.lineTo(x, 340); draw.stroke(); }
  for (let y = 44; y <= 340; y += 64) { draw.beginPath(); draw.moveTo(0, y); draw.lineTo(W, y); draw.stroke(); }
  // shelf / counter depth layers
  draw.setFillStyle("#c98a4b"); draw.fillRect(0, 332, W, 14);
  draw.setFillStyle("#8a5a2b"); draw.fillRect(0, 346, W, 8);
  draw.setFillStyle("#f2c38a"); draw.fillRect(0, H - 92, W, 92);
  draw.setFillStyle("#d99a55"); draw.fillRect(0, H - 92, W, 10);
  // floor tiles perspective lines
  draw.setStrokeStyle("rgba(160,100,40,0.35)"); draw.setLineWidth(2);
  for (let x = 0; x <= W; x += 96) { draw.beginPath(); draw.moveTo(x, H - 82); draw.lineTo(x - 18, H); draw.stroke(); }
  // side walls
  draw.setFillStyle("#5a3a1a"); draw.fillRect(0, 38, 8, H - 38); draw.fillRect(W - 8, 38, 8, H - 38); draw.fillRect(0, 38, W, 8);
  // hanging utensils silhouettes
  draw.setFillStyle("rgba(90,60,30,0.5)");
  draw.fillRect(70, 46, 6, 42); draw.fillRect(880, 46, 6, 36);

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  const isTitle = g.scene === "title";

  // plates (also visible on title behind overlay lightly)
  for (const p of g.plates) {
    if (!p.alive) continue;
    const wob = dsin(g.frame * 0.05 + p.wob) * 0.04;
    const sc = 1 + dsin(g.frame * 0.08 + p.wob) * 0.015;
    if (s.plate) drawSprite(draw, s.plate, p.x, p.y, 58, { rot: wob, sx: sc, sy: sc });
    // plate shadow
  }

  if (isTitle) {
    // Cat bounces on the text
    const bounce = Math.abs(dsin(g.frame * 0.07));
    const catY = 300 - bounce * 95;
    const squashAmt = bounce < 0.12 ? 0.28 : 0;
    const pw = s.text ? paddleW(s.text) * 1.35 : 460;
    void pw;
    if (s.text) {
      const gelS = 1 - squashAmt * 0.4;
      drawSprite(draw, s.text, W / 2, 392, 78, { sx: 1 + squashAmt * 0.5, sy: gelS, rot: dsin(g.frame * 0.07) * 0.02 });
    }
    if (s.cat) drawSprite(draw, s.cat, W / 2 + dsin(g.frame * 0.03) * 18, catY, 120, { sx: 1 + squashAmt, sy: 1 - squashAmt, rot: dsin(g.frame * 0.05) * 0.12 });
  } else {
    // trail ghosts
    for (const t of g.trail) {
      if (s.cat) drawSprite(draw, s.cat, t.x, t.y, BALL_H * 0.92, { rot: g.rot * 0.8, alpha: Math.max(0, t.life / 22) * 0.22 });
    }
    // paddle = text, gelatin deform
    if (s.text) {
      const gelAmt = g.gel > 0 ? (g.gel / 16) : 0;
      const wobble = dsin(g.frame * 0.9) * gelAmt * 0.06;
      drawSprite(draw, s.text, g.paddleX, PADDLE_Y + gelAmt * 4, PADDLE_H, {
        sx: 1 + gelAmt * 0.18 + Math.min(0.06, Math.abs(g.paddleVx) * 0.006),
        sy: 1 - gelAmt * 0.22,
        rot: g.paddleVx * 0.004 + wobble,
      });
    } else {
      draw.setFillStyle("#333"); draw.fillRect(g.paddleX - 170, PADDLE_Y - 20, 340, 40);
    }
    // aim hint when stuck
    if (g.stuck && g.scene === "play") {
      draw.setStrokeStyle("rgba(255,140,26,0.6)"); draw.setLineWidth(3);
      draw.beginPath(); draw.moveTo(g.ballX, g.ballY - 55); draw.lineTo(g.ballX, g.ballY - 95); draw.stroke();
      draw.beginPath(); draw.moveTo(g.ballX - 8, g.ballY - 85); draw.lineTo(g.ballX, g.ballY - 98); draw.lineTo(g.ballX + 8, g.ballY - 85); draw.stroke();
    }
    // cat ball: stretch when falling, squash on bounce
    if (s.cat) {
      let sx = 1, sy = 1;
      if (g.squashT > 0) { const k = g.squashT / 10; sx = 1 + 0.32 * k; sy = 1 - 0.30 * k; }
      else if (!g.stuck) { const st = Math.min(0.22, Math.abs(g.ballVy) * 0.018); if (g.ballVy > 0) { sx = 1 - st * 0.5; sy = 1 + st; } else { sx = 1 - st * 0.3; sy = 1 + st * 0.6; } }
      drawSprite(draw, s.cat, g.ballX, g.ballY, BALL_H, { sx, sy, rot: g.rot });
    }
  }
  // dragon flies across the top, always visible
  {
    const dx = (g as Game).dragonX ?? -80;
    const dy = 250 + dsin(g.frame * 0.05) * 22;
    const flip = ((g as Game).dragonDir ?? 1) < 0;
    if (s.dragon) drawSprite(draw, s.dragon, dx, dy, 110, { rot: dsin(g.frame * 0.08) * 0.08, sx: flip ? -1 : 1 });
  }
  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play" || g.scene === "won" || g.scene === "lost") {
    panel(draw, 14, 10, 430, 54, "rgba(60,30,5,0.55)");
    text(draw, `Platos ${g.broken}/${TOTAL}`, 30, 37, 22, "#ffd23f");
    text(draw, `Puntos ${g.score}`, 190, 37, 20, "#ffffff");
    text(draw, `Combo x${Math.max(1, g.combo)}`, 310, 37, 18, g.combo >= 2 ? "#ff9a3d" : "#cccccc");
    panel(draw, W - 210, 10, 196, 54, "rgba(60,30,5,0.55)");
    text(draw, `Vidas: ${Math.max(0, g.lives)}`, W - 196, 37, 20, "#ff8a8a");
    if (g.stuck && g.scene === "play") text(draw, "ESPACIO para lanzar al gato", W / 2, H - 18, 17, "#7a4a12", "center");
  }

  // overlays manual (to keep cat+text visible on title)
  if (g.scene !== "play") {
    if (g.scene === "title") {
      draw.setFillStyle("rgba(40,20,0,0.28)"); draw.fillRect(0, 0, W, 190);
      const bob = dsin(g.frame * 0.05) * 5;
      text(draw, "MALCRIADAZO", W / 2, 72 + bob, 66, "#ffd23f", "center", "bangers");
      text(draw, "REBOTA", W / 2, 128 + bob, 48, "#ff8c1a", "center", "bangers");
      text(draw, "La palabra es tu paleta · el gato es la pelota", W / 2, 168, 19, "#ffffff", "center");
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "Pulsa ENTER para empezar", W / 2, 500, 24, "#ffffff", "center");
      text(draw, "Rompe los 18 platos · No dejes caer al gato 3 veces", W / 2, 470, 17, "#ffe9b0", "center");
    } else {
      draw.setFillStyle("rgba(0,0,0,0.55)"); draw.fillRect(0, 0, W, H);
      const won = g.scene === "won";
      text(draw, won ? "¡GANASTE!" : "¡SE ESCAPÓ!", W / 2, 190, 68, won ? "#ffd23f" : "#ff8a8a", "center", "bangers");
      text(draw, won ? "¡Toda la cocina sin platos!" : "El gato malcriado se escapó...", W / 2, 250, 22, "#ffffff", "center");
      text(draw, `Platos rotos: ${g.broken}/${TOTAL}   Puntos: ${g.score}   Mejor combo: x${Math.max(1, g.bestCombo)}`, W / 2, 300, 20, "#ffe9b0", "center");
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER para jugar de nuevo", W / 2, 380, 24, "#ffffff", "center");
    }
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Malcriadazo Rebota" },
  clear: { r: 1, g: 0.93, b: 0.82 },
  options: {},
  neutral: 0,
  encode: encodeKeys,
  random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1);
    let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((spr) => { sprites = spr; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => {
        let h = g.frame * 31 + g.broken * 101 + g.lives * 7 + Math.round(g.ballX * 10) + Math.round(g.paddleX);
        for (const p of g.plates) h = (Math.imul(h, 16777619) ^ (p.alive ? 1 : 0)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.broken / TOTAL, scene: g.scene, score: g.score, lives: g.lives, broken: g.broken }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
