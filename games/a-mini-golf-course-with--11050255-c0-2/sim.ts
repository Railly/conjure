import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["ball", "flag", "pond", "windmill", "bridge"];
const HOLE = { x: 852, y: 132 };
const TEE = { x: 118, y: 405 };
const POND = { x: 482, y: 286 };

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  bx: number; by: number; vx: number; vy: number; aim: number;
  phase: "aim" | "roll"; charging: boolean; power: number; powerDir: number;
  strokes: number; round: number; totalStrokes: number;
  lastX: number; lastY: number; millAngle: number; sandTimer: number;
  reason: string; squashT: number; onBridge: boolean; inSand: boolean; j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  bx: TEE.x, by: TEE.y, vx: 0, vy: 0, aim: -0.36,
  phase: "aim", charging: false, power: 0, powerDir: 1,
  strokes: 0, round: 1, totalStrokes: 0, lastX: TEE.x, lastY: TEE.y,
  millAngle: 0, sandTimer: 0, reason: "", squashT: 0, onBridge: false, inSand: false, j: juice(),
});

const pondRX = (g: Game) => 148 + g.strokes * 7;
const pondRY = (g: Game) => 66 + g.strokes * 2;
const millSpeed = (g: Game) => 0.022 + g.strokes * 0.009 + Math.min(0.03, g.frame / 4000);
const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
const SANDS = [{ x: 282, y: 132, rx: 78, ry: 38 }, { x: 648, y: 408, rx: 88, ry: 42 }];
const WALLS: { x: number; y: number; w: number; h: number }[] = [];

function resetBall(g: Game) {
  g.bx = TEE.x; g.by = TEE.y; g.vx = 0; g.vy = 0; g.aim = -0.36; g.phase = "aim";
  g.charging = false; g.power = 0; g.lastX = TEE.x; g.lastY = TEE.y; g.sandTimer = 0;
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  const released = (g.prev & KEY.action) !== 0 && (keys & KEY.action) === 0;
  g.prev = keys; g.frame++; juiceStep(g.j);
  const wasScene = g.scene;
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); return; }
  if (g.scene !== "play") { g.millAngle += 0.02; return; }
  void wasScene;

  g.millAngle += millSpeed(g);
  if (g.squashT > 0) g.squashT--;

  // Undo (Enter) during play: pull ball back to before the last putt.
  if ((edge & KEY.start) !== 0 && g.phase === "roll") {
    g.bx = g.lastX; g.by = g.lastY; g.vx = 0; g.vy = 0; g.phase = "aim"; g.sandTimer = 0;
    floatText(g.j, g.bx, g.by - 34, "UNDO!", "#ffffff"); burst(g.j, g.r, g.bx, g.by, 10, "#ffffff", 3, 4);
    return;
  }

  if (g.phase === "aim") {
    if (keys & KEY.left) g.aim -= 0.045;
    if (keys & KEY.right) g.aim += 0.045;
    if (keys & KEY.up) g.aim -= 0.018;
    if (keys & KEY.down) g.aim += 0.018;
    g.aim = Math.max(-0.88, Math.min(0.12, g.aim));
    if (keys & KEY.action) {
      g.charging = true;
      g.power += g.powerDir * 2.4;
      if (g.power >= 100) { g.power = 100; g.powerDir = -1; }
      if (g.power <= 0) { g.power = 0; g.powerDir = 1; }
    } else if (released && g.charging) {
      g.lastX = g.bx; g.lastY = g.by;
      const sp = 4 + g.power * 0.17;
      g.vx = dcos(g.aim) * sp; g.vy = dsin(g.aim) * sp;
      g.strokes++; g.totalStrokes++; g.phase = "roll"; g.charging = false;
      g.squashT = 8; burst(g.j, g.r, g.bx, g.by, 12, "#ffffff", 3, 4);
      floatText(g.j, g.bx, g.by - 30, `STROKE ${g.strokes}`, "#ffd23f");
      g.power = 0; g.powerDir = 1;
    }
    if (!keys || !(keys & KEY.action)) { if (!g.charging) g.power = 0; }
  } else {
    // Steering: tilt the whole course. Faster windmill = stronger tilt.
    const tiltPower = 0.16 + millSpeed(g) * 5.2;
    const tx = ((keys & KEY.right) ? 1 : 0) - ((keys & KEY.left) ? 1 : 0);
    const ty = ((keys & KEY.down) ? 1 : 0) - ((keys & KEY.up) ? 1 : 0);
    g.onBridge = Math.abs(g.bx - POND.x) < 132 && Math.abs(g.by - POND.y) < 50;
    if (!g.onBridge && (tx || ty)) {
      g.vx += tx * tiltPower; g.vy += ty * tiltPower;
      if (g.frame % 7 === 0) g.j.particles.push({ x: g.bx - tx * 22 + range(g.r, -8, 8), y: g.by - ty * 22 + range(g.r, -8, 8), vx: tx * 1.5, vy: ty * 1.5, life: 14, max: 14, size: 3, color: "#bfefff" });
    }
  }

  if (g.phase === "roll") {
    // Gentle course slope curves the ball toward the cup; player steering is much stronger.
    const sdx = HOLE.x - g.bx, sdy = HOLE.y - g.by, sd = Math.hypot(sdx, sdy) || 1;
    g.vx += (sdx / sd) * 0.028; g.vy += (sdy / sd) * 0.028;
    g.bx += g.vx; g.by += g.vy;
    g.inSand = SANDS.some(s => inEllipse(g.bx, g.by, s.x, s.y, s.rx, s.ry));
    const fric = g.inSand ? 0.90 : g.onBridge ? 0.985 : 0.982;
    g.vx *= fric; g.vy *= fric;

    // Hedge walls
    for (const w of WALLS) {
      if (g.bx > w.x - 12 && g.bx < w.x + w.w + 12 && g.by > w.y - 12 && g.by < w.y + w.h + 12) {
        const left = Math.abs(g.bx - (w.x - 12)), right = Math.abs(g.bx - (w.x + w.w + 12));
        if (left < right) { g.bx = w.x - 12; g.vx = -Math.abs(g.vx) * 0.72; } else { g.bx = w.x + w.w + 12; g.vx = Math.abs(g.vx) * 0.72; }
        g.squashT = 7; shake(g.j, 5); burst(g.j, g.r, g.bx, g.by, 7, "#7cc47f", 3, 4);
      }
    }

    // Windmill blades: rotating arms knock the ball
    const mx = 680, my = 88, dx = g.bx - mx, dy = g.by - my, dist = Math.hypot(dx, dy);
    if (dist < 78 && dist > 8) {
      const ang = Math.atan2(dy, dx);
      let diff = Math.abs(((ang - g.millAngle) % (Math.PI / 2) + Math.PI * 2) % (Math.PI / 2));
      if (diff > Math.PI / 4) diff = Math.PI / 2 - diff;
      if (diff < 0.32) {
        const push = 4.2 + millSpeed(g) * 55;
        g.vx = (dx / dist) * push + -dy / dist * 2.2; g.vy = (dy / dist) * push + dx / dist * 2.2;
        g.squashT = 9; shake(g.j, 9); burst(g.j, g.r, g.bx, g.by, 16, "#7ec8ff", 4, 5);
        floatText(g.j, g.bx, g.by - 28, "BLADE BONK!", "#bfefff");
      }
    }

    // Pond (bridge is safe)
    g.onBridge = Math.abs(g.bx - POND.x) < 132 && Math.abs(g.by - POND.y) < 50;
    if (!g.onBridge && inEllipse(g.bx, g.by, POND.x, POND.y, pondRX(g), pondRY(g))) {
      burst(g.j, g.r, g.bx, g.by, 26, "#39a7ff", 5, 6); shake(g.j, 10);
      g.strokes++; g.totalStrokes++;
      floatText(g.j, g.bx, g.by - 30, "SPLASH! +1 STROKE", "#7ec8ff");
      g.bx = g.lastX; g.by = g.lastY; g.vx = 0; g.vy = 0; g.phase = "aim"; g.sandTimer = 0;
      if (g.strokes > 5) { g.reason = "Too many strokes after the splash!"; endRun(g, false); }
      return;
    }

    // Sand timer: sitting in sand for 3 seconds loses
    if (g.inSand) {
      g.sandTimer++;
      if (g.sandTimer === 90) floatText(g.j, g.bx, g.by - 34, "SAND! MOVE!", "#ffe08a");
      if (g.sandTimer >= 180) { g.reason = "Stuck in the sand for 3 seconds!"; burst(g.j, g.r, g.bx, g.by, 22, "#e8c87a", 4, 5); endRun(g, false); return; }
    } else g.sandTimer = Math.max(0, g.sandTimer - 3);

    // Out of bounds / rough
    if (g.bx < 48 || g.bx > 912 || g.by < 58 || g.by > 498) {
      g.reason = "Out of Bounds — into the rough!"; shake(g.j, 12); burst(g.j, g.r, Math.max(60, Math.min(900, g.bx)), Math.max(70, Math.min(490, g.by)), 20, "#ff8a8a", 5, 5); endRun(g, false); return;
    }

    // Hole
    const hd = Math.hypot(g.bx - HOLE.x, g.by - HOLE.y), speed = Math.hypot(g.vx, g.vy);
    if (hd < 140 && hd > 1) { g.vx += (HOLE.x - g.bx) / hd * 0.12; g.vy += (HOLE.y - g.by) / hd * 0.12; }
    if (hd < 46) {
      burst(g.j, g.r, HOLE.x, HOLE.y, 34, "#ffd23f", 6, 6); burst(g.j, g.r, HOLE.x, HOLE.y, 20, "#ff5a5a", 5, 5); shake(g.j, 7);
      g.reason = `Holed in ${g.totalStrokes} stroke${g.totalStrokes === 1 ? "" : "s"}!`; endRun(g, true);
      return;
    }
    if (hd < 24 && speed >= 6.5 && g.frame % 20 === 0) floatText(g.j, HOLE.x, HOLE.y - 34, "TOO FAST!", "#ffffff");

    if (speed < 0.18) {
      g.vx = 0; g.vy = 0; g.phase = "aim"; g.aim = Math.atan2(HOLE.y - g.by, HOLE.x - g.bx);
      if (g.strokes >= 5) { g.reason = "Out of strokes — par was 5!"; endRun(g, false); }
    }
  }
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [38, 92, 48], [22, 62, 34]);
  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // Rough + fairway with mowing stripes
  draw.setFillStyle("#2e6b35"); draw.fillRect(34, 44, 892, 468);
  for (let i = 0; i < 11; i++) { draw.setFillStyle(i % 2 ? "#57a84f" : "#62b957"); draw.fillRect(54 + i * 78, 64, 78, 428); }
  draw.setFillStyle("#57a84f"); draw.fillRect(54, 64, 852, 428);
  for (let i = 0; i < 11; i++) { draw.setFillStyle(i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"); draw.fillRect(54 + i * 78, 64, 78, 428); }
  // Fairway border
  draw.setStrokeStyle("#e8f5d8"); draw.setLineWidth(4); draw.strokeRect(54, 64, 852, 428);

  // Sand traps
  for (const sd of SANDS) {
    draw.setFillStyle("#e8c87a"); draw.beginPath(); draw.ellipse(sd.x, sd.y, sd.rx, sd.ry, 0, 0, Math.PI * 2, false); draw.fill();
    draw.setFillStyle("rgba(160,120,50,0.35)");
    for (let i = 0; i < 7; i++) { draw.beginPath(); draw.arc(sd.x - sd.rx / 2 + i * 18, sd.y + dsin(i * 2.1 + sd.x) * 12, 4, 0, Math.PI * 2, false); draw.fill(); }
  }
  text(draw, "SAND", SANDS[0]!.x, SANDS[0]!.y, 15, "rgba(120,85,20,0.7)", "center");
  text(draw, "SAND", SANDS[1]!.x, SANDS[1]!.y, 15, "rgba(120,85,20,0.7)", "center");

  // Pond + bridge (the only safe crossing)
  if (s.pond) drawSprite(draw, s.pond, POND.x, POND.y, pondRY(g) * 2.25, {});
  if (s.bridge) drawSprite(draw, s.bridge, POND.x, POND.y - 4, 92, {});
  text(draw, "BRIDGE = SAFE", POND.x, POND.y + 62, 13, "#dff4ff", "center");

  // Hedges
  for (const w of WALLS) { draw.setFillStyle("#27632d"); draw.fillRect(w.x, w.y, w.w, w.h); draw.setFillStyle("#3f9142"); draw.fillRect(w.x + 3, w.y + 4, w.w - 6, w.h - 8); }

  // Hole + flag
  draw.setFillStyle("#173d1e"); draw.beginPath(); draw.arc(HOLE.x, HOLE.y, 17, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("#000000"); draw.beginPath(); draw.arc(HOLE.x, HOLE.y, 11, 0, Math.PI * 2, false); draw.fill();
  if (s.flag) drawSprite(draw, s.flag, HOLE.x + 16, HOLE.y - 34, 92, { rot: dsin(g.frame * 0.06) * 0.06 });

  // Windmill (photo star) + spinning blade overlay
  if (s.windmill) drawSprite(draw, s.windmill, 680, 118, 178, {});
  draw.save(); draw.translate(680, 88); draw.rotate(g.millAngle);
  draw.setFillStyle("rgba(126,200,255,0.85)");
  for (let i = 0; i < 4; i++) { draw.save(); draw.rotate(i * Math.PI / 2); draw.fillRect(6, -7, 58, 14); draw.restore(); }
  draw.restore();
  draw.setFillStyle("#5a3a1a"); draw.beginPath(); draw.arc(680, 88, 8, 0, Math.PI * 2, false); draw.fill();

  // Aim arrow + power guide
  if (g.scene === "play" && g.phase === "aim") {
    const len = 52 + g.power * 0.7;
    draw.setStrokeStyle(g.charging ? "#ffd23f" : "#ffffff"); draw.setLineWidth(5);
    draw.beginPath(); draw.moveTo(g.bx, g.by); draw.lineTo(g.bx + dcos(g.aim) * len, g.by + dsin(g.aim) * len); draw.stroke();
    draw.setFillStyle(g.charging ? "#ffd23f" : "#ffffff");
    draw.beginPath(); draw.arc(g.bx + dcos(g.aim) * (len + 10), g.by + dsin(g.aim) * (len + 10), 7, 0, Math.PI * 2, false); draw.fill();
    // dotted preview
    draw.setFillStyle("rgba(255,255,255,0.55)");
    for (let i = 1; i < 6; i++) { draw.beginPath(); draw.arc(g.bx + dcos(g.aim) * (28 + i * 18), g.by + dsin(g.aim) * (28 + i * 18), 3, 0, Math.PI * 2, false); draw.fill(); }
  }

  // Tilt indicator while rolling
  if (g.scene === "play" && g.phase === "roll") {
    text(draw, g.onBridge ? "ON BRIDGE — NO WIND!" : "STEER! ARROWS / WASD TILT THE COURSE", W / 2, 92, 16, "#bfefff", "center");
  }

  // Ball with squash & stretch
  const speed = Math.hypot(g.vx, g.vy);
  const stretch = Math.min(0.3, speed * 0.022) + (g.squashT > 0 ? 0.12 : 0);
  const ballRot = speed > 0.3 ? Math.atan2(g.vy, g.vx) : 0;
  draw.setFillStyle("rgba(0,0,0,0.25)"); draw.beginPath(); draw.ellipse(g.bx + 3, g.by + 10, 15, 6, 0, 0, Math.PI * 2, false); draw.fill();
  if (s.ball) drawSprite(draw, s.ball, g.bx, g.by, 38, { rot: ballRot, sx: 1 + stretch, sy: 1 - stretch * 0.6 });

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 54);
    text(draw, `HOLE 1`, 30, 32, 20, "#ffd23f");
    text(draw, `STROKES ${g.strokes}/5`, 190, 32, 20, "#ffffff");
    text(draw, `WINDMILL ${Math.round(millSpeed(g) * 100)}`, 330, 32, 15, "#bfefff");
    text(draw, g.phase === "aim" ? "Aim: Arrows/WASD • Hold SPACE to charge" : "ENTER = Undo", 30, 54, 13, "#dff4d8");
    // Power bar
    if (g.charging || g.phase === "aim") {
      panel(draw, W - 244, 12, 230, 54);
      text(draw, "POWER", W - 228, 30, 14, "#ffffff");
      draw.setFillStyle("#333"); draw.fillRect(W - 228, 42, 198, 14);
      draw.setFillStyle(g.power > 80 ? "#ff5a5a" : "#ffd23f"); draw.fillRect(W - 228, 42, 198 * g.power / 100, 14);
    }
    if (g.sandTimer > 20) {
      panel(draw, W / 2 - 120, H - 58, 240, 42, "rgba(120,60,0,0.75)");
      text(draw, `SAND ESCAPE: ${(3 - g.sandTimer / 60).toFixed(1)}s`, W / 2, H - 37, 17, "#ffe08a", "center");
    }
  }

  // Overlays (English)
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.55)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.sceneFrames * 0.05) * 6;
    const head = g.scene === "title" ? "WINDMILL STEERING GOLF" : g.scene === "won" ? "YOU WIN!" : "OUT OF BOUNDS!";
    text(draw, head, W / 2, H * 0.30 + bob, g.scene === "title" ? 52 : 58, g.scene === "lost" ? "#ff8a8a" : "#ffd23f", "center", "bangers");
    if (g.scene === "title") {
      text(draw, "Putt, then tilt the whole course to steer your ball!", W / 2, H * 0.44, 21, "#ffffff", "center");
      text(draw, "Cross the pond on the bridge. Dodge sand & windmill blades.", W / 2, H * 0.50, 17, "#dff4d8", "center");
      text(draw, "Sink the hole in 5 strokes or fewer. Windmill speeds up each stroke!", W / 2, H * 0.56, 17, "#dff4d8", "center");
    } else {
      text(draw, g.reason || (g.scene === "won" ? "Holed!" : "Try again!"), W / 2, H * 0.46, 22, "#ffffff", "center");
      text(draw, `Strokes used: ${g.totalStrokes} / 5`, W / 2, H * 0.53, 18, "#dff4d8", "center");
    }
    if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "PRESS ENTER TO PLAY", W / 2, H * 0.70, 26, "#ffffff", "center");
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Windmill Steering Golf" },
  clear: { r: 0.12, g: 0.35, b: 0.18 },
  options: {}, neutral: 0, encode: encodeKeys, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then(s => { sprites = s; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => { let h = g.frame * 31 + g.strokes * 101 + g.round * 7 + Math.round(g.bx * 100) + Math.round(g.by * 10); return (h >>> 0); },
      state: () => {
        const d0 = Math.hypot(HOLE.x - TEE.x, HOLE.y - TEE.y), d = Math.hypot(HOLE.x - g.bx, HOLE.y - g.by);
        const holeProg = Math.max(0, Math.min(1, 1 - d / d0));
        return { outcome: outcomeOf(g.scene), progress: g.scene === "won" ? 1 : holeProg, scene: g.scene, score: g.totalStrokes, strokes: g.strokes, round: g.round };
      },
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
