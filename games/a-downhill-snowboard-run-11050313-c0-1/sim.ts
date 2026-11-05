import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dsin, dcos } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, floatText, juice, juiceStep, KEY, loadKit,
  endRun, outcomeOf, panel, pressed, rand, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky,
  type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["snowboarder", "tree", "snowman", "flag", "yeti"];
const RUN = 17500;
const PLAYER_Y = 350;

interface Ob { x: number; y: number; kind: "tree" | "snowman" | "flag"; id: number; hit: boolean; wob: number; gateId: number; gateX: number }
interface Trail { x: number; y: number; life: number }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  x: number; vx: number; tilt: number; dist: number; speed: number;
  air: boolean; airY: number; vy: number; rot: number; spinVel: number; spinTotal: number; squashT: number;
  yetiDist: number; blind: number; sprayPower: number; lives: number; invuln: number;
  score: number; combo: number; bestCombo: number; gateStreak: number;
  obs: Ob[]; trail: Trail[]; spawnT: number; gateId: number; loseKind: string; carveDir: number; lastDir: number;
  j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  x: W / 2, vx: 0, tilt: 0, dist: 0, speed: 6.5,
  air: false, airY: 0, vy: 0, rot: 0, spinVel: 0, spinTotal: 0, squashT: 0,
  yetiDist: 72, blind: 0, sprayPower: 0, lives: 3, invuln: 0,
  score: 0, combo: 0, bestCombo: 0, gateStreak: 0,
  obs: [], trail: [], spawnT: 40, gateId: 0, loseKind: "", carveDir: 0, lastDir: 0, j: juice(),
});

function resetInto(g: Game, seedLike: number) {
  const f = fresh(seedLike, "play");
  Object.assign(g, f, { prev: g.prev });
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j, 0.12);
  const started = sceneStep(g, edge);
  if (started) { resetInto(g, g.r.s); return; }
  if (g.scene !== "play") return;

  const left = (keys & KEY.left) !== 0, right = (keys & KEY.right) !== 0;
  const dir = (right ? 1 : 0) - (left ? 1 : 0);
  g.carveDir = dir;
  const progressT = g.dist / RUN;
  const difficulty = 1 + progressT * 0.9;

  // --- Air / spin ---
  if (g.air) {
    g.vy += 0.55;
    g.airY += g.vy;
    // Left+Right together = spin trick
    if (left && right) { g.spinVel = Math.min(0.32, g.spinVel + 0.035); }
    else g.spinVel *= 0.96;
    g.rot += g.spinVel;
    g.spinTotal += Math.abs(g.spinVel);
    if (g.airY >= 0) {
      g.airY = 0; g.air = false;
      const spins = Math.floor(g.spinTotal / (Math.PI * 2) + 0.15);
      g.squashT = 12;
      if (spins >= 1) {
        const pts = spins * 300 * Math.max(1, g.combo);
        g.score += pts; g.combo++; g.bestCombo = Math.max(g.bestCombo, g.combo);
        floatText(g.j, g.x, PLAYER_Y - 120, `${spins * 360}! +${pts}`, "#ffd23f");
        burst(g.j, g.r, g.x, PLAYER_Y + 20, 42, "#ffffff", 7, 7);
        burst(g.j, g.r, g.x, PLAYER_Y + 10, 18, "#bfe8ff", 5, 5);
        g.yetiDist = Math.min(100, g.yetiDist + 16 + spins * 5);
        g.blind = Math.min(90, g.blind + 45);
        shake(g.j, 6);
      } else {
        floatText(g.j, g.x, PLAYER_Y - 100, "CLEAN LANDING!", "#bfe8ff");
        burst(g.j, g.r, g.x, PLAYER_Y + 20, 20, "#ffffff", 5, 6);
        g.yetiDist = Math.min(100, g.yetiDist + 6);
      }
      g.rot = 0; g.spinVel = 0; g.spinTotal = 0;
    }
  } else {
    // Grounded carving
    g.vx += dir * 1.15;
    g.vx *= dir !== 0 ? 0.86 : 0.78;
    g.x = Math.max(70, Math.min(W - 70, g.x + g.vx));
    g.tilt += ((g.vx * 0.028) - g.tilt) * 0.25;
    if ((edge & KEY.action) !== 0) {
      // Small ollie — useful to hop, snowmen give the big launch
      g.air = true; g.vy = -9; g.airY = -2; g.spinTotal = 0; g.rot = 0;
      burst(g.j, g.r, g.x, PLAYER_Y + 30, 12, "#ffffff", 4, 5);
    }
  }
  if (g.air) { // steer in air a bit
    g.x = Math.max(70, Math.min(W - 70, g.x + dir * 3.2 + g.vx * 0.25));
    g.tilt *= 0.95;
  }
  if (g.squashT > 0) g.squashT--;
  if (g.invuln > 0) g.invuln--;

  // Detect direction flip = hard carve (big spray, slower)
  const hardCarve = !g.air && dir !== 0 && Math.abs(g.vx) > 3.2;
  const flipping = !g.air && dir !== 0 && g.lastDir !== 0 && dir !== g.lastDir && Math.abs(g.vx) > 1.5;
  if (dir !== 0) g.lastDir = dir;

  // Speed: straight is fast, hard carve scrubs speed
  const targetSpeed = flipping ? 4.2 : hardCarve ? 5.0 : 7.4;
  g.speed += (targetSpeed - g.speed) * 0.06;
  if (g.air) g.speed = Math.max(g.speed, 6.8);
  g.dist += g.speed * (g.air ? 1.05 : 1);
  const scroll = g.speed;

  // --- Spray ---
  g.sprayPower = 0;
  if (!g.air && dir !== 0) {
    g.sprayPower = flipping ? 1.6 : hardCarve ? 1.0 : 0.45;
    // particles arc up/back (toward yeti at top)
    const n = flipping ? 4 : hardCarve ? 3 : 1;
    for (let i = 0; i < n; i++) {
      g.j.particles.push({
        x: g.x - dir * 28 + range(g.r, -8, 8), y: PLAYER_Y + 34,
        vx: -dir * range(g.r, 1, 3.5) + range(g.r, -0.6, 0.6), vy: -range(g.r, 2.5, 5.5),
        life: Math.round(range(g.r, 22, 42)), max: 42, size: range(g.r, 3, 7), color: i % 3 === 0 ? "#dff4ff" : "#ffffff",
      });
    }
    if (g.j.particles.length > 420) g.j.particles.splice(0, g.j.particles.length - 420);
    // trench trail
    g.trail.push({ x: g.x - dir * 18, y: PLAYER_Y + 38, life: 55 });
  } else if (!g.air && g.frame % 3 === 0) {
    g.trail.push({ x: g.x, y: PLAYER_Y + 38, life: 40 });
  }
  if (g.trail.length > 130) g.trail.splice(0, g.trail.length - 130);
  for (const t of g.trail) { t.y -= scroll; t.life--; }
  g.trail = g.trail.filter(t => t.life > 0);

  // --- Yeti ---
  if (g.blind > 0) g.blind--;
  const blinded = g.blind > 8;
  if (g.sprayPower > 0) {
    g.yetiDist = Math.min(100, g.yetiDist + g.sprayPower * 0.34);
    if (g.sprayPower >= 1 && g.frame % 6 === 0) g.blind = Math.min(80, g.blind + 14);
    if (flipping && g.frame % 4 === 0) {
      // splash on yeti face (top of screen)
      burst(g.j, g.r, W / 2 + range(g.r, -50, 50), 92, 6, "#ffffff", 3.5, 6);
    }
  }
  if (!blinded) {
    // Yeti gains when you ride clean; faster later, faster if you just go straight & fast
    const gain = (0.020 + progressT * 0.022) + (g.sprayPower === 0 ? 0.010 : 0);
    g.yetiDist -= gain;
    // gentle rubber-band so good play stays tense but winnable
    if (g.yetiDist > 85) g.yetiDist -= 0.04;
  } else {
    g.yetiDist = Math.min(100, g.yetiDist + 0.045);
  }

  // --- Spawning ---
  g.spawnT -= scroll;
  if (g.spawnT <= 0 && g.dist < RUN - 900) {
    g.spawnT = range(g.r, 190, 300) / difficulty;
    const roll = rand(g.r);
    if (roll < 0.38) {
      // flag gate pair
      const gx = range(g.r, 220, W - 220); g.gateId++;
      g.obs.push({ x: gx - 95, y: H + 70, kind: "flag", id: g.gateId * 2, hit: false, wob: 0, gateId: g.gateId, gateX: gx });
      g.obs.push({ x: gx + 95, y: H + 70, kind: "flag", id: g.gateId * 2 + 1, hit: false, wob: 0, gateId: g.gateId, gateX: gx });
    } else if (roll < 0.68) {
      g.obs.push({ x: range(g.r, 90, W - 90), y: H + 80, kind: "snowman", id: Math.floor(range(g.r, 0, 1e9)), hit: false, wob: 0, gateId: 0, gateX: 0 });
    } else {
      const n = rand(g.r) < 0.18 ? 2 : 1;
      for (let i = 0; i < n; i++) g.obs.push({ x: range(g.r, 80, W - 80), y: H + 80 + i * 30, kind: "tree", id: Math.floor(range(g.r, 0, 1e9)), hit: false, wob: 0, gateId: 0, gateX: 0 });
    }
  }

  // Move obstacles up (world scrolls)
  for (const o of g.obs) { o.y -= scroll; if (o.wob > 0) o.wob--; }

  // Collisions / gates (grounded or low)
  const py = PLAYER_Y + g.airY;
  for (const o of g.obs) {
    if (o.kind === "flag") {
      if (!o.hit && o.y < PLAYER_Y + 10 && o.y > PLAYER_Y - 24) {
        // check gate only once per pair — use left flag
        if (o.x < o.gateX) {
          o.hit = true;
          if (Math.abs(g.x - o.gateX) < 88 && !g.air) {
            g.gateStreak++; g.combo = Math.max(g.combo, Math.min(g.gateStreak, 5));
            const pts = 100 + g.gateStreak * 25; g.score += pts;
            floatText(g.j, o.gateX, PLAYER_Y - 90, `GATE +${pts}`, "#ff5a5a");
            burst(g.j, g.r, o.gateX, PLAYER_Y - 20, 14, "#ff8a8a", 4, 5);
            g.speed = Math.min(9, g.speed + 0.8);
          } else if (!g.air) { g.gateStreak = 0; }
        }
      }
      continue;
    }
    if (o.hit) continue;
    const dx = Math.abs(o.x - g.x), dy = Math.abs(o.y - py);
    if (o.kind === "snowman" && !g.air && dx < 62 && dy < 62) {
      o.hit = true; o.wob = 70;
      g.air = true; g.vy = -15.5; g.airY = -4; g.spinTotal = 0; g.rot = 0; g.spinVel = 0;
      burst(g.j, g.r, o.x, o.y, 24, "#ffffff", 6, 6);
      floatText(g.j, o.x, o.y - 80, "BOING!", "#7cc47f");
      shake(g.j, 4);
    } else if (o.kind === "tree" && dx < 48 && dy < 58 && g.airY > -70) {
      // trees only crash if not flying high over them
      if (!g.air || g.airY > -70) {
        o.hit = true;
        if (g.invuln <= 0) {
          g.lives--; g.invuln = 170; g.combo = 0; g.gateStreak = 0;
          g.yetiDist = Math.max(10, g.yetiDist - 7);
          burst(g.j, g.r, g.x, py - 20, 22, "#2f9e44", 6, 6);
          burst(g.j, g.r, g.x, py - 20, 16, "#ffffff", 5, 6);
          shake(g.j, 13);
          floatText(g.j, g.x, py - 110, g.lives > 0 ? "CRASH! GOGGLES CRACKED!" : "WIPEOUT!", "#ff8a8a");
          if (g.air) { g.air = false; g.airY = 0; g.vy = 0; g.rot = 0; }
          if (g.lives <= 0) { g.loseKind = "wipeout"; endRun(g, false); return; }
        }
      }
    }
  }
  g.obs = g.obs.filter(o => o.y > -120);

  // --- Finish / Catch ---
  if (g.dist >= RUN) { g.score += Math.round(g.yetiDist) * 5; endRun(g, true); return; }
  if (g.yetiDist <= 0) {
    g.yetiDist = 0; g.loseKind = "yeti"; shake(g.j, 18); endRun(g, false); return;
  }
  // tiny passive score for distance
  if (g.frame % 12 === 0) g.score += 2;
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [135, 200, 245], [235, 248, 255]);
  // distant mountains (parallax bands)
  draw.setFillStyle("#cfe8f7");
  for (let i = 0; i < 7; i++) { const x = ((i * 170 - (g.dist * 0.08) % 170) + W) % (W + 170) - 85; draw.beginPath(); draw.moveTo(x - 95, 190); draw.lineTo(x, 70 + (i % 3) * 18); draw.lineTo(x + 95, 190); draw.closePath(); draw.fill(); }
  draw.setFillStyle("#eaf6ff");
  for (let i = 0; i < 6; i++) { const x = ((i * 210 - (g.dist * 0.18) % 210) + W) % (W + 210) - 105; draw.beginPath(); draw.moveTo(x - 115, 250); draw.lineTo(x, 120 + (i % 2) * 24); draw.lineTo(x + 115, 250); draw.closePath(); draw.fill(); }
  // snow slope
  draw.setFillStyle("#ffffff"); draw.fillRect(0, 210, W, H - 210);
  draw.setFillStyle("#e6f3fc");
  for (let i = 0; i < 8; i++) { const y = 230 + ((i * 53 + g.dist * 1.0) % 330); draw.fillRect(0, y, W, 5); }
  // side sparkle dots scrolling
  draw.setFillStyle("#d7ecfa");
  for (let i = 0; i < 22; i++) { const x = (i * 173) % W; const y = 220 + ((i * 97 + g.dist * 1.2) % 320); draw.beginPath(); draw.arc(x, y, 3, 0, Math.PI * 2, false); draw.fill(); }

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // trench trail
  for (const t of g.trail) { draw.setGlobalAlpha(Math.max(0, t.life / 55) * 0.45); draw.setFillStyle("#bfe0f2"); draw.beginPath(); draw.arc(t.x, t.y, 7, 0, Math.PI * 2, false); draw.fill(); }
  draw.setGlobalAlpha(1);

  const inTitle = g.scene === "title";
  // YETI looming at top — closer = bigger & lower
  const closeness = 1 - g.yetiDist / 100; // 0 far, 1 catch
  const yetiH = g.scene === "lost" && g.loseKind === "yeti" ? 620 : 120 + closeness * 150;
  const yetiY = g.scene === "lost" && g.loseKind === "yeti" ? H / 2 : 62 + closeness * 78 + dsin(g.frame * 0.08) * 4;
  const yetiX = W / 2 + dsin(g.frame * 0.02) * 14 + (g.x - W / 2) * 0.12 * closeness;
  if (!inTitle && s.yeti) drawSprite(draw, s.yeti, yetiX, yetiY, yetiH, { sx: 1 + dsin(g.frame * 0.15) * 0.02, sy: 1 - dsin(g.frame * 0.15) * 0.02 });
  // blind splash on face
  if (g.blind > 8 && s.yeti && !inTitle) {
    draw.setGlobalAlpha(Math.min(0.9, g.blind / 50));
    draw.setFillStyle("#ffffff");
    for (let i = 0; i < 7; i++) { draw.beginPath(); draw.arc(yetiX + dcos(i * 2.4) * yetiH * 0.16, yetiY - yetiH * 0.18 + dsin(i * 3.1) * yetiH * 0.1, yetiH * 0.09, 0, Math.PI * 2, false); draw.fill(); }
    draw.setGlobalAlpha(1);
    text(draw, "CAN'T SEE!", yetiX + yetiH * 0.42, yetiY - yetiH * 0.28, 17, "#3aa0d8", "left");
  }
  if (closeness > 0.72 && g.scene === "play") text(draw, "HE'S RIGHT BEHIND YOU!", W / 2, 168 + closeness * 50, 20, "#e33", "center");

  // obstacles sorted by y
  const sorted = inTitle ? [] : [...g.obs].sort((a, b) => a.y - b.y);
  for (const ob of sorted) {
    if (ob.kind === "tree") drawSprite(draw, s.tree!, ob.x, ob.y, 118, { rot: ob.hit ? 0.5 : dsin(g.frame * 0.03 + ob.x) * 0.02 });
    else if (ob.kind === "snowman") {
      const wob = ob.wob > 0 ? dsin(ob.wob * 0.5) * 0.18 * (ob.wob / 70) : 0;
      drawSprite(draw, s.snowman!, ob.x, ob.y, 112, { rot: wob, sy: ob.wob > 0 ? 0.9 : 1 });
      if (ob.wob > 0) text(draw, "★", ob.x + 34, ob.y - 58, 20, "#ff8c1a", "center"); // carrot popped off
    } else drawSprite(draw, s.flag!, ob.x, ob.y, 96, { rot: dsin(g.frame * 0.08 + ob.x * 0.1) * 0.06 });
  }

  // finish flags row when near end
  if (!inTitle && g.dist > RUN - 900) {
    const fy = PLAYER_Y + (RUN - g.dist); // approaches player line
    if (fy > -80 && fy < H + 80) {
      for (let i = 0; i < 9; i++) {
        const fx = 60 + i * 105;
        drawSprite(draw, s.flag!, fx, fy, 100, {});
        if (i % 2 === 0) { draw.setFillStyle(i % 4 === 0 ? "#111" : "#fff"); draw.fillRect(fx - 52, fy - 78, 104, 16); }
      }
      text(draw, "FINISH!", W / 2, fy - 100, 30, "#e33", "center", "bangers");
    }
  }

  // PLAYER
  const py = PLAYER_Y + g.airY;
  const squashAmt = g.squashT > 0 ? 0.22 : 0;
  const blink = g.invuln > 0 && Math.floor(g.frame / 5) % 2 === 0;
  if (!blink && !inTitle) {
    const rot = g.air ? g.rot : g.tilt;
    drawSprite(draw, s.snowboarder!, g.x, py, 138, {
      rot, flip: !g.air && g.vx < -1,
      sx: 1 + squashAmt, sy: 1 - squashAmt + (g.air ? 0.06 : 0),
    });
  }
  // shadow
  if (!inTitle) { draw.setGlobalAlpha(0.18); draw.setFillStyle("#7fb6d9"); draw.beginPath(); draw.arc(g.x, PLAYER_Y + 44, 42 - Math.max(0, -g.airY) * 0.12, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1); }

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play" || g.scene === "won" || g.scene === "lost") {
    panel(draw, 14, 12, 330, 58, "rgba(10,40,70,0.55)");
    text(draw, `SCORE ${g.score}`, 30, 32, 21, "#ffd23f");
    text(draw, `BEST COMBO x${Math.max(1, g.bestCombo)}`, 30, 56, 14, "#fff");
    // goggles / lives
    for (let i = 0; i < 3; i++) {
      const cx = 760 + i * 58, cy = 38;
      draw.setFillStyle(i < g.lives ? "#8fd8ff" : "rgba(255,255,255,0.25)");
      draw.beginPath(); draw.arc(cx - 12, cy, 13, 0, Math.PI * 2, false); draw.arc(cx + 12, cy, 13, 0, Math.PI * 2, false); draw.fill();
      draw.setFillStyle("#164a6b"); draw.fillRect(cx - 4, cy - 3, 8, 5);
      if (i >= g.lives) { draw.setStrokeStyle("#e33"); draw.setLineWidth(3); draw.beginPath(); draw.moveTo(cx - 20, cy - 10); draw.lineTo(cx + 18, cy + 10); draw.moveTo(cx + 16, cy - 12); draw.lineTo(cx - 8, cy + 12); draw.stroke(); }
    }
    text(draw, "GOGGLES", 818, 66, 11, "#fff", "center");
    // progress bar
    panel(draw, 14, H - 42, W - 28, 26, "rgba(10,40,70,0.5)");
    draw.setFillStyle("#ff5a5a"); draw.fillRect(24, H - 34, (W - 48) * Math.min(1, g.dist / RUN), 10);
    text(draw, `${Math.round(Math.min(1, g.dist / RUN) * 100)}%  TO FINISH!`, W / 2, H - 29, 13, "#fff", "center");
    // yeti meter
    panel(draw, W - 250, 78, 236, 34, "rgba(10,40,70,0.5)");
    text(draw, "YETI", W - 238, 95, 13, "#fff");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(W - 182, 90, 158, 10);
    draw.setFillStyle(g.yetiDist < 30 ? "#ff4040" : "#8fd8ff"); draw.fillRect(W - 182, 90, 158 * (g.yetiDist / 100), 10);
  }

  // Overlays (English, custom)
  if (g.scene === "title") {
    draw.setFillStyle("rgba(10,50,90,0.28)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.frame * 0.05) * 6;
    if (s.snowboarder) drawSprite(draw, s.snowboarder, W / 2, 205 + bob, 170, { rot: dsin(g.frame * 0.04) * 0.06 });
    if (s.yeti) drawSprite(draw, s.yeti, W - 130, 120, 130, { rot: 0.08 });
    text(draw, "POWDER PANIC!", W / 2, 330, 68, "#ffd23f", "center", "bangers");
    text(draw, "Race to the finish flags — don't let the yeti grab you!", W / 2, 378, 19, "#fff", "center");
    text(draw, "LEFT / RIGHT or A / D: Carve and spray snow in his face!", W / 2, 408, 16, "#dff4ff", "center");
    text(draw, "SPACE Jump - Hold LEFT+RIGHT in air to SPIN - Hit snowmen to fly!", W / 2, 432, 15, "#dff4ff", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "Press Enter — Don't Let Him Wipe His Face!", W / 2, 478, 24, "#fff", "center");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(10,60,30,0.45)"); draw.fillRect(0, 0, W, H);
    text(draw, "YOU MADE IT DOWN!", W / 2, 190, 58, "#ffd23f", "center", "bangers");
    if (s.snowboarder) drawSprite(draw, s.snowboarder, W / 2, 300, 150, { rot: dsin(g.frame * 0.06) * 0.1 });
    text(draw, `Trick Score: ${g.score}    Best Combo: x${Math.max(1, g.bestCombo)}`, W / 2, 390, 22, "#fff", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER to ride again", W / 2, 450, 22, "#fff", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(20,20,50,0.45)"); draw.fillRect(0, 0, W, H);
    if (g.loseKind === "wipeout") {
      text(draw, "WIPEOUT!", W / 2, 180, 64, "#ff8a8a", "center", "bangers");
      text(draw, "Three cracked goggles — the trees win this time.", W / 2, 240, 19, "#fff", "center");
      if (s.snowboarder) drawSprite(draw, s.snowboarder, W / 2, 330, 150, { rot: 0.9, sy: 0.85 });
    } else {
      // yeti already drawn huge in world; add GOTCHA
      text(draw, "GOTCHA!", W / 2, 150, 72, "#ff4040", "center", "bangers");
      text(draw, "The yeti caught you! Spray more snow in his face next run.", W / 2, 440, 18, "#fff", "center");
    }
    text(draw, `Score: ${g.score}    Best Combo: x${Math.max(1, g.bestCombo)}`, W / 2, 475, 20, "#ffd23f", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER to try again", W / 2, 505, 20, "#fff", "center");
  }
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Powder Panic!" },
  clear: { r: 0.85, g: 0.94, b: 1 },
  options: {},
  neutral: 0,
  encode: encodeKeys,
  random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1);
    let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((st) => { sprites = st; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => {
        let h = (g.frame * 31 + g.score * 7 + g.lives * 131 + Math.round(g.x * 10) + Math.round(g.dist)) >>> 0;
        for (const ob of g.obs) h = (Math.imul(h, 16777619) ^ Math.round(ob.y * 10 + ob.x)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: Math.min(1, g.dist / RUN), scene: g.scene, score: g.score, lives: g.lives, yetiDist: Math.round(g.yetiDist) }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
