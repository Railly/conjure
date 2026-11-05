import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, squash, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960;
const H = 540;
const NAMES = ["robot", "cloud", "key", "door", "hedgehog"];
const WORLD = 2680;
const GRAV = 0.55;

interface CloudT { x: number; y: number; w: number; baseY: number; phase: number; sink: number; sinkV: number; popped: boolean; popT: number; cycle: number; hogOff: number; hogDir: number; hogSpeed: number; }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  x: number; y: number; vx: number; vy: number; face: number; grounded: boolean; coyote: number; buffer: number;
  jumpHeld: boolean; hearts: number; hasKey: boolean; invuln: number; lastCloud: number; camX: number;
  clouds: CloudT[]; keyX: number; keyY: number; keyTaken: boolean; doorOpen: number; combo: number; landT: number;
  trail: { x: number; y: number; a: number }[]; j: Juice; falls: number; hogHits: number; sparkleT: number;
}

// x, topY, width, popCycle (0 = never pops), hogSpeed (0 = no hog)
const LAYOUT: [number, number, number, number, number][] = [
  [130, 390, 210, 0, 0],
  [330, 350, 170, 0, 0],
  [510, 300, 160, 0, 0.7],
  [680, 340, 180, 0, 0],
  [875, 285, 165, 520, 0],
  [1045, 235, 170, 0, 0.55], // key cloud (high)
  [1225, 300, 180, 0, 0],
  [1415, 350, 175, 520, 0.6],
  [1600, 295, 170, 0, 0],
  [1775, 245, 160, 560, 0.65],
  [1940, 305, 185, 0, 0],
  [2135, 350, 175, 520, 0.7],
  [2320, 300, 170, 0, 0],
  [2510, 330, 230, 0, 0], // door cloud
];
const KEY_CLOUD = 5;
const DOOR_X = 2560;

function makeClouds(): CloudT[] {
  return LAYOUT.map(([x, y, w, cycle, hog], i) => ({
    x, y, w, baseY: y, phase: i * 1.37, sink: 0, sinkV: 0, popped: false, popT: cycle ? 140 + i * 37 : 0, cycle,
    hogOff: 0, hogDir: 1, hogSpeed: hog,
  }));
}
const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  x: 130, y: 390 - 34, vx: 0, vy: 0, face: 1, grounded: true, coyote: 0, buffer: 0, jumpHeld: false,
  hearts: 3, hasKey: false, invuln: 0, lastCloud: 0, camX: 0, clouds: makeClouds(),
  keyX: LAYOUT[KEY_CLOUD]![0], keyY: LAYOUT[KEY_CLOUD]![1] - 62, keyTaken: false, doorOpen: 0, combo: 0, landT: 0,
  trail: [], j: juice(), falls: 0, hogHits: 0, sparkleT: 0,
});

function cloudTop(c: CloudT, frame: number) { return c.baseY + dsin(frame * 0.018 + c.phase) * 6 + c.sink; }
function respawn(g: Game) {
  const c = g.clouds[g.lastCloud] ?? g.clouds[0]!;
  g.x = c.x; g.y = cloudTop(c, g.frame) - 36; g.vx = 0; g.vy = 0; g.invuln = 90;
}
function loseHeart(g: Game, why: string) {
  g.hearts--;
  shake(g.j, 14);
  burst(g.j, g.r, g.x, g.y, 26, "#ff8a5a", 6, 7);
  burst(g.j, g.r, g.x, g.y, 18, "#9ad7ff", 5, 5);
  floatText(g.j, g.x - g.camX, Math.max(70, g.y - 60), why, "#ff6b6b");
  if (g.hearts <= 0) { endRun(g, false); return; }
  respawn(g);
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j);
  if (sceneStep(g, edge)) Object.assign(g, fresh(g.r.s, "play"), { prev: keys });
  if (g.scene !== "play") return;

  // Clouds drift, sink-spring, and pop cycle
  for (const c of g.clouds) {
    c.sinkV += (0 - c.sink) * 0.12; c.sinkV *= 0.72; c.sink += c.sinkV;
    if (c.cycle > 0) {
      c.popT--;
      if (c.popT === 55 && !c.popped) floatText(g.j, c.x - g.camX, c.baseY - 70, "POP soon!", "#ff9f43");
      if (c.popT <= 0) {
        c.popped = !c.popped;
        c.popT = c.popped ? 75 : c.cycle;
        burst(g.j, g.r, c.x - g.camX, c.baseY + 10, c.popped ? 22 : 14, "#ffffff", 4, 7);
        if (c.popped && g.grounded && g.clouds[g.lastCloud] === c) { g.grounded = false; }
      }
    }
    if (c.hogSpeed) {
      c.hogOff += c.hogDir * c.hogSpeed * (1 + g.frame / 9000);
      const lim = c.w / 2 - 28;
      if (c.hogOff > lim) { c.hogOff = lim; c.hogDir = -1; }
      if (c.hogOff < -lim) { c.hogOff = -lim; c.hogDir = 1; }
    }
  }

  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const jumpKey = (keys & (KEY.action | KEY.up)) !== 0;
  if (dir) g.face = dir;
  const accel = g.grounded ? 0.9 : 0.55;
  g.vx += dir * accel;
  g.vx *= g.grounded ? 0.78 : 0.92;
  g.vx = Math.max(-7.2, Math.min(7.2, g.vx));
  g.x += g.vx;

  if ((edge & (KEY.action | KEY.up)) !== 0) g.buffer = 9;
  else if (g.buffer > 0) g.buffer--;
  if (g.grounded) g.coyote = 9; else if (g.coyote > 0) g.coyote--;

  if (g.buffer > 0 && g.coyote > 0) {
    g.vy = -14.6; g.grounded = false; g.coyote = 0; g.buffer = 0; g.jumpHeld = true;
    burst(g.j, g.r, g.x - g.camX, g.y + 34, 10, "#ffffff", 3, 5);
  }
  if (!jumpKey && g.jumpHeld && g.vy < -5) g.vy = -5; // variable height
  if (!jumpKey) g.jumpHeld = false;

  const prevFeet = g.y + 34;
  g.vy = Math.min(15, g.vy + GRAV);
  g.y += g.vy;
  const wasGrounded = g.grounded;
  g.grounded = false;

  if (g.vy >= 0) {
    for (let i = 0; i < g.clouds.length; i++) {
      const c = g.clouds[i]!;
      if (c.popped) continue;
      const top = cloudTop(c, g.frame);
      const feet = g.y + 34;
      if (Math.abs(g.x - c.x) < c.w / 2 - 6 && prevFeet <= top + 10 && feet >= top) {
        const impact = g.vy;
        g.y = top - 34; g.vy = 0; g.grounded = true; g.lastCloud = i;
        c.sinkV += impact * 0.55; // trampoline sink
        if (!wasGrounded) {
          g.landT = 10; g.combo++;
          burst(g.j, g.r, g.x - g.camX, top + 4, 14, "#ffffff", 3.5, 6);
          burst(g.j, g.r, g.x - g.camX, top + 4, 6, "#bfe8ff", 2.5, 5);
          if (impact > 9) shake(g.j, 4);
          if (g.combo === 3 || g.combo % 6 === 0) floatText(g.j, g.x - g.camX, top - 64, `BOING x${g.combo}!`, "#ffd23f");
        }
        break;
      }
    }
  }
  if (g.grounded) { /* keep combo */ } else if (g.vy < 0) { /* rising */ }
  if (g.landT > 0) g.landT--;
  if (g.invuln > 0) g.invuln--;

  // Trail
  if (Math.abs(g.vx) > 2 || Math.abs(g.vy) > 4) g.trail.push({ x: g.x, y: g.y, a: 0.28 });
  if (g.trail.length > 7) g.trail.shift();
  for (const t of g.trail) t.a -= 0.045;
  g.trail = g.trail.filter((t) => t.a > 0);

  // Key
  if (!g.keyTaken && Math.abs(g.x - g.keyX) < 46 && Math.abs(g.y - g.keyY) < 58) {
    g.keyTaken = true; g.hasKey = true;
    burst(g.j, g.r, g.keyX - g.camX, g.keyY, 30, "#ffd23f", 5, 7);
    burst(g.j, g.r, g.keyX - g.camX, g.keyY, 14, "#fff3a6", 3, 5);
    floatText(g.j, g.x - g.camX, g.y - 70, "GOT THE KEY!", "#ffd23f");
    shake(g.j, 5);
  }
  // Hedgehogs
  if (g.invuln <= 0) {
    for (const c of g.clouds) {
      if (!c.hogSpeed || c.popped) continue;
      const hx = c.x + c.hogOff, hy = cloudTop(c, g.frame) - 22;
      if (Math.abs(g.x - hx) < 34 && Math.abs(g.y - hy) < 40) {
        g.hogHits++;
        burst(g.j, g.r, g.x - g.camX, g.y, 20, "#c9a0ff", 5, 6);
        floatText(g.j, g.x - g.camX, g.y - 66, "POP! -1 HEART", "#ff6b6b");
        loseHeart(g, "OUCH! SPIKY!");
        break;
      }
    }
  }
  if (g.scene !== "play") return;

  // Door
  const doorY = cloudTop(g.clouds[g.clouds.length - 1]!, g.frame);
  if (Math.abs(g.x - DOOR_X) < 48 && Math.abs((g.y + 34) - doorY) < 90) {
    if (g.hasKey) {
      g.doorOpen = Math.min(1, g.doorOpen + 0.03);
      if (Math.abs(g.x - DOOR_X) < 40) {
        burst(g.j, g.r, DOOR_X - g.camX, doorY - 60, 36, "#ffd23f", 6, 7);
        burst(g.j, g.r, DOOR_X - g.camX, doorY - 60, 20, "#ffffff", 4, 6);
        endRun(g, true); return;
      }
    } else if (g.frame % 70 === 0) floatText(g.j, g.x - g.camX, g.y - 72, "LOCKED! GET THE KEY!", "#ffffff");
  }

  // Fall
  if (g.y > H + 140) {
    g.falls++;
    loseHeart(g, "WHEEE... -1 HEART");
    return;
  }
  g.x = Math.max(24, Math.min(WORLD - 20, g.x));

  // Camera with lead
  const target = Math.max(0, Math.min(WORLD - W, g.x - W * 0.42 + g.face * 70));
  g.camX += (target - g.camX) * 0.08;
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [154, 205, 248], [232, 246, 255]);
  // Crayon stars + motes (parallax)
  for (let i = 0; i < 42; i++) {
    const sx = ((i * 173 + 40 - g.camX * 0.25) % (W + 40) + W + 40) % (W + 40) - 20;
    const sy = 30 + (i * 67) % 300;
    const tw = 0.5 + 0.5 * dsin(g.frame * 0.05 + i);
    draw.setGlobalAlpha(0.35 + tw * 0.4); draw.setFillStyle("#ffffff");
    draw.beginPath(); draw.arc(sx, sy, 2 + (i % 3), 0, Math.PI * 2, false); draw.fill();
    draw.setStrokeStyle("rgba(255,210,63,0.7)"); draw.setLineWidth(2);
    draw.beginPath(); draw.moveTo(sx - 7, sy); draw.lineTo(sx + 7, sy); draw.moveTo(sx, sy - 7); draw.lineTo(sx, sy + 7); draw.stroke();
  }
  draw.setGlobalAlpha(1);
  for (let i = 0; i < 18; i++) {
    const mx = ((i * 211 + g.frame * (0.3 + (i % 4) * 0.12) - g.camX * 0.5) % (W + 30) + W + 30) % (W + 30) - 15;
    const my = 60 + (i * 89) % 380 + dsin(g.frame * 0.02 + i * 2) * 8;
    draw.setGlobalAlpha(0.5); draw.setFillStyle(i % 2 ? "#ffd9ec" : "#c8f2ff");
    draw.beginPath(); draw.arc(mx, my, 3, 0, Math.PI * 2, false); draw.fill();
  }
  draw.setGlobalAlpha(1);

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // Far background clouds
  for (let i = 0; i < 8; i++) {
    const bx = ((i * 340 + 80 - g.camX * 0.35) % (W + 260) + W + 260) % (W + 260) - 130;
    if (s.cloud) drawSprite(draw, s.cloud, bx, 90 + (i % 3) * 55, 70, { alpha: 0.35 });
  }

  const doorCloud = g.clouds[g.clouds.length - 1]!;
  const doorTop = cloudTop(doorCloud, g.frame);
  // Door (behind robot)
  if (s.door) {
    const dx = DOOR_X - g.camX;
    if (dx > -140 && dx < W + 140) {
      drawSprite(draw, s.door, dx, doorTop - 52 + g.doorOpen * -2, 118, { rot: g.doorOpen * 0.06, sx: 1 - g.doorOpen * 0.15 });
      if (!g.hasKey) { text(draw, "LOCKED", dx, doorTop - 118, 16, "#e67e22", "center"); }
      else text(draw, "OPEN!", dx, doorTop - 120, 18, "#2fbf71", "center");
    }
  }
  // Key
  if (!g.keyTaken && s.key) {
    const kx = g.keyX - g.camX, ky = g.keyY + dsin(g.frame * 0.07) * 7;
    if (g.frame % 18 === 0) { /* sparkle handled in draw below via alpha */ }
    draw.setGlobalAlpha(0.25 + 0.15 * dsin(g.frame * 0.1)); draw.setFillStyle("#ffd23f");
    draw.beginPath(); draw.arc(kx, ky, 34, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1);
    drawSprite(draw, s.key, kx, ky, 62, { rot: dsin(g.frame * 0.06) * 0.18 });
    text(draw, "KEY!", kx, ky - 48, 16, "#b8860b", "center");
  }

  // Clouds
  for (const c of g.clouds) {
    const sx = c.x - g.camX;
    if (sx < -180 || sx > W + 180) continue;
    const top = cloudTop(c, g.frame);
    if (c.popped) {
      draw.setGlobalAlpha(0.18); draw.setStrokeStyle("#7fb8e8"); draw.setLineWidth(3);
      draw.beginPath(); draw.arc(sx, top + 20, c.w / 3, 0, Math.PI * 2, false); draw.stroke(); draw.setGlobalAlpha(1);
      continue;
    }
    const warn = c.cycle > 0 && !c.popped && c.popT < 55;
    const squashY = 1 - Math.min(0.22, Math.abs(c.sink) * 0.012) + (warn ? dsin(g.frame * 0.6) * 0.03 : 0);
    const ch = c.w * 0.82;
    if (s.cloud) drawSprite(draw, s.cloud, sx, top + ch / 2 - 12, ch, { sy: squashY, sx: 1 + (1 - squashY) * 0.6 });
    if (warn) text(draw, "!", sx, top - 26, 24, "#ff4757", "center");
    // Hedgehog
    if (c.hogSpeed && s.hedgehog) {
      const hx = sx + c.hogOff, hy = top - 20;
      drawSprite(draw, s.hedgehog, hx, hy, 52, { flip: c.hogDir < 0, sy: 1 + dsin(g.frame * 0.3 + c.x) * 0.05 });
    }
  }

  // Trail afterimages
  for (const t of g.trail) if (s.robot) drawSprite(draw, s.robot, t.x - g.camX, t.y, 70, { alpha: t.a * 0.5, flip: g.face < 0 });

  // Robot
  if (s.robot) {
    const sq = g.grounded ? (g.landT > 0 ? { sx: 1.28, sy: 0.72 } : { sx: 1, sy: 1 }) : squash(g.vy, 0.022);
    const blink = g.invuln > 0 && Math.floor(g.frame / 5) % 2 === 0;
    const bob = g.grounded && Math.abs(g.vx) > 1 ? Math.abs(dsin(g.frame * 0.35)) * 4 : 0;
    drawSprite(draw, s.robot, g.x - g.camX, g.y - bob, 72, { sx: sq.sx, sy: sq.sy, flip: g.face < 0, alpha: blink ? 0.35 : 1, rot: g.vx * 0.008 });
    if (g.hasKey && s.key) drawSprite(draw, s.key, g.x - g.camX + g.face * 26, g.y - 34 + dsin(g.frame * 0.1) * 3, 30, { rot: 0.4 });
  }
  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 360, 62, "rgba(30,80,140,0.45)");
    text(draw, `HEARTS: ${Math.max(0, g.hearts)} / 3`, 28, 32, 20, "#ffb3c1");
    text(draw, g.hasKey ? "KEY GOT! GO TO DOOR!" : "Find the KEY!", 28, 56, 16, g.hasKey ? "#ffd23f" : "#ffffff");
    // progress
    draw.setFillStyle("rgba(255,255,255,0.35)"); draw.fillRect(W - 230, 22, 200, 12);
    draw.setFillStyle("#ffd23f"); draw.fillRect(W - 230, 22, 200 * Math.min(1, g.x / DOOR_X), 12);
    text(draw, "DOOR >>", W - 30, 52, 14, "#ffffff", "right");
    if (g.frame < 260 && g.x < 400) {
      panel(draw, W / 2 - 260, H - 56, 520, 40, "rgba(30,80,140,0.5)");
      text(draw, "A/D or Arrows move  -  SPACE / Up bounce-jump!", W / 2, H - 36, 17, "#ffffff", "center");
    }
  }
  // Overlays (English)
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(20,60,110,0.32)" : "rgba(10,30,60,0.55)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.sceneFrames * 0.05) * 6;
    if (g.scene === "title") {
      if (s.robot) drawSprite(draw, s.robot, W / 2, 150 + bob, 110);
      text(draw, "BOUNCE BOT", W / 2, 250 + bob, 68, "#ffd23f", "center", "bangers");
      text(draw, "Cloud Key Quest", W / 2, 300, 28, "#ffffff", "center", "bangers");
      text(draw, "Bounce across drifting clouds, grab the golden Key,", W / 2, 350, 19, "#ffffff", "center");
      text(draw, "dodge spiky Hedgehogs, and unlock the Door!", W / 2, 376, 19, "#ffffff", "center");
      text(draw, "Move: Arrows or A/D    Jump: SPACE / Up (hold = higher)", W / 2, 412, 17, "#cfeeff", "center");
      text(draw, "3 hearts — falling or hedgehogs cost one!", W / 2, 438, 16, "#ffb3c1", "center");
    } else if (g.scene === "won") {
      text(draw, "YOU DID IT!", W / 2, 220 + bob, 64, "#ffd23f", "center", "bangers");
      text(draw, "The Robot bounced through the Door with the Key!", W / 2, 290, 20, "#ffffff", "center");
      text(draw, `Hedgehog bumps: ${g.hogHits}   Falls: ${g.falls}`, W / 2, 330, 18, "#cfeeff", "center");
    } else {
      text(draw, "OH NO! POPPED!", W / 2, 220 + bob, 60, "#ff8a8a", "center", "bangers");
      text(draw, "Bounce Bot ran out of hearts...", W / 2, 290, 20, "#ffffff", "center");
      text(draw, g.hasKey ? "So close — you had the Key!" : "Tip: the Key is on a high cloud in the middle!", W / 2, 330, 18, "#cfeeff", "center");
    }
    if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "Press ENTER or SPACE to play", W / 2, 470, 24, "#ffffff", "center");
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Bounce Bot: Cloud Key Quest" },
  clear: { r: 0.72, g: 0.87, b: 1 },
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
        let h = g.frame * 31 + g.hearts * 7 + Math.round(g.x * 10) + Math.round(g.y * 10) + (g.hasKey ? 999 : 0);
        for (const c of g.clouds) h = (Math.imul(h, 16777619) ^ Math.round((c.sink + c.hogOff) * 100)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: Math.min(1, (g.x / DOOR_X) * 0.85 + (g.hasKey ? 0.1 : 0) + (g.scene === "won" ? 0.05 : 0)), scene: g.scene, hearts: g.hearts, hasKey: g.hasKey, x: Math.round(g.x) }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
