import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["house", "tree", "sun", "car", "cat"];
const GROUND = 472;
const TIME_LIMIT = 90 * 60;
const DOOR_X = 838, DOOR_Y = 382;

interface Branch { x: number; y: number; len: number; target: number; thick: number; growing: boolean; angle: number }
interface Ray { x1: number; y1: number; x2: number; y2: number; life: number; hit: string }
interface Popup { x: number; y: number; text: string; life: number; max: number }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  sunX: number; sunY: number; aim: number; // aim deg from vertical, -55..65
  catX: number; catY: number; catVX: number; catVY: number; catRot: number; onGround: boolean; catHitCd: number; meowCd: number;
  carX: number; carVX: number; carHeat: number;
  branches: Branch[]; rays: Ray[]; popups: Popup[];
  lives: number; timeLeft: number; cooldown: number; j: Juice; doorOpen: number; smokeCd: number; shots: number;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  sunX: 170, sunY: 128, aim: 25,
  catX: 352, catY: GROUND - 26, catVX: 0, catVY: 0, catRot: 0, onGround: true, catHitCd: 0, meowCd: 0,
  carX: 520, carVX: 0, carHeat: 0,
  branches: [], rays: [], popups: [], lives: 3, timeLeft: TIME_LIMIT, cooldown: 0, j: juice(), doorOpen: 0, smokeCd: 0, shots: 0,
});

function solids(g: Game) {
  const s: { x: number; y: number; w: number; h: number; vx?: number }[] = [];
  for (const b of g.branches) s.push({ x: b.x, y: b.y, w: b.len, h: b.thick });
  // car as platform (top)
  s.push({ x: g.carX - 58, y: GROUND - 52, w: 116, h: 52, vx: g.carVX });
  // porch steps to house door
  s.push({ x: 742, y: 432, w: 58, h: 40 });
  s.push({ x: 788, y: DOOR_Y + 18, w: 154, h: 72 }); // porch top at 400
  return s;
}

function fireRay(g: Game) {
  if (g.cooldown > 0) return;
  g.cooldown = 22; g.shots++;
  // difficulty: weirder angles as sunset approaches
  const elapsed = 1 - g.timeLeft / TIME_LIMIT;
  const weird = elapsed > 0.35 ? range(g.r, -1, 1) * (elapsed - 0.35) * 28 : 0;
  const ang = (g.aim + weird) * Math.PI / 180;
  const dx = dsin(ang), dy = dcos(ang); // down, tilted
  let hx = g.sunX + dx * 900, hy = g.sunY + dy * 900, hit = "air", dist = 900;
  const stepN = 160;
  for (let i = 1; i <= stepN; i++) {
    const d = i * 6, px = g.sunX + dx * d, py = g.sunY + dy * d;
    // cat direct hit (circle r 26)
    const cdx = px - g.catX, cdy = py - g.catY;
    if (cdx * cdx + cdy * cdy < 28 * 28) { hx = px; hy = py; hit = "cat"; dist = d; break; }
    // tree trunk/canopy zone
    if (px > 205 && px < 325 && py > 210 && py < GROUND) { hx = px; hy = py; hit = "tree"; dist = d; break; }
    // car
    if (px > g.carX - 62 && px < g.carX + 62 && py > GROUND - 62 && py < GROUND) { hx = px; hy = py; hit = "car"; dist = d; break; }
    if (py >= GROUND) { hx = px; hy = GROUND; hit = "ground"; dist = d; break; }
    if (px < 0 || px > W) { hx = px; hy = py; hit = "air"; dist = d; break; }
  }
  g.rays.push({ x1: g.sunX, y1: g.sunY + 20, x2: hx, y2: hy, life: 14, hit });
  // heat wavy particles along ray
  for (let i = 0; i < 8; i++) {
    const t = i / 8, px = g.sunX + (hx - g.sunX) * t, py = g.sunY + (hy - g.sunY) * t;
    g.j.particles.push({ x: px + range(g.r, -6, 6), y: py, vx: range(g.r, -0.5, 0.5), vy: range(g.r, -1, -0.2), life: 18, max: 18, size: range(g.r, 3, 6), color: "#ffb703" });
  }
  if (hit === "cat") {
    if (g.catHitCd <= 0) {
      g.catHitCd = 90; g.lives--;
      burst(g.j, g.r, g.catX, g.catY - 20, 22, "#ff8a5b", 5, 6);
      shake(g.j, 10); floatText(g.j, g.catX, g.catY - 55, "¡MIAU! ¡QUEMA!", "#ff5a3c");
      g.catVY = -7; g.catVX += range(g.r, -2, 2);
      if (g.lives <= 0) { endRun(g, false); return; }
    }
  } else if (hit === "tree") {
    // branch grows from trunk at hit height, clamped
    const by = Math.max(300, Math.min(GROUND - 18, hy));
    if (g.branches.length >= 8) g.branches.shift();
    const target = range(g.r, 210, 300);
    g.branches.push({ x: 272, y: by - 7, len: 8, target, thick: 15, growing: true, angle: range(g.r, -0.06, 0.06) });
    burst(g.j, g.r, 285, by, 20, "#7cc47f", 4, 7);
    burst(g.j, g.r, 285, by, 10, "#ffd23f", 3, 5);
    // POP pill drawn in world space above the branch tip: clear of the canopy, opaque for contrast
    g.popups.push({ x: Math.min(560, 330 + target * 0.5), y: Math.max(170, by - 84), text: "¡POP!", life: 55, max: 55 });
    if (g.popups.length > 4) g.popups.shift();
    shake(g.j, 4);
  } else if (hit === "car") {
    g.carHeat = Math.min(3, g.carHeat + 1);
    g.carVX = 3.6;
    burst(g.j, g.r, hx, hy, 16, "#ffb703", 4, 6);
    floatText(g.j, g.carX, GROUND - 95, "¡CHAPA CALIENTE!", "#e85d04");
  } else if (hit === "ground") {
    burst(g.j, g.r, hx, hy, 8, "#ffd23f", 3, 5);
  }
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys; g.frame++;
  juiceStep(g.j);
  if (sceneStep(g, edge)) Object.assign(g, fresh(g.r.s, "play"), { prev: keys });
  // win smoke even on won scene
  if (g.scene === "won") {
    g.smokeCd--;
    if (g.smokeCd <= 0) { g.smokeCd = 12; g.j.particles.push({ x: 895, y: 215, vx: range(g.r, -0.3, 0.6), vy: -1.6, life: 50, max: 50, size: range(g.r, 8, 14), color: "#fff3d6" }); }
    return;
  }
  if (g.scene !== "play") return;

  g.timeLeft--;
  if (g.timeLeft <= 0) { endRun(g, false); return; }
  if (g.cooldown > 0) g.cooldown--;
  if (g.catHitCd > 0) g.catHitCd--;
  if (g.meowCd > 0) g.meowCd--;

  // Sun movement + auto drift to sunset (faster over time)
  const elapsed = 1 - g.timeLeft / TIME_LIMIT;
  const drift = 0.12 + elapsed * elapsed * 0.9;
  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  g.sunX += dir * 4.2 + drift;
  g.sunX = Math.max(55, Math.min(W - 55, g.sunX));
  g.sunY = 128 + elapsed * 70 + dsin(g.frame * 0.03) * 6;
  if (keys & KEY.up) g.aim -= 1.6;
  if (keys & KEY.down) g.aim += 1.6;
  g.aim = Math.max(-55, Math.min(65, g.aim));
  if (keys & KEY.action) fireRay(g);
  for (const r of g.rays) r.life--;
  g.rays = g.rays.filter(r => r.life > 0);
  for (const p of g.popups) { p.life--; p.y -= 0.35; }
  g.popups = g.popups.filter(p => p.life > 0);

  // Branches grow, push cat/car
  for (const b of g.branches) {
    if (b.growing) {
      b.len += 5;
      const tip = b.x + b.len;
      // push cat if branch at cat height and tip reaches it
      if (g.catY + 20 > b.y && g.catY - 20 < b.y + b.thick && g.catX + 24 > b.x && g.catX - 10 < tip) {
        g.catX = tip + 24; g.catVX = Math.max(g.catVX, 5.6);
        burst(g.j, g.r, tip, b.y, 4, "#7cc47f", 2, 5);
      }
      // push car
      if (b.y + b.thick > GROUND - 60 && tip > g.carX - 60 && tip < g.carX + 60) { g.carVX = Math.max(g.carVX, 3); }
      if (b.len >= b.target) { b.growing = false; if (b.target > 190) shake(g.j, 6); }
    }
  }

  // Car physics
  g.carX += g.carVX; g.carVX *= 0.92;
  if (Math.abs(g.carVX) > 0.4 && g.frame % 6 === 0) g.j.particles.push({ x: g.carX + range(g.r, -40, 40), y: GROUND - 4, vx: range(g.r, -1, 1), vy: range(g.r, -1, 0), life: 20, max: 20, size: 4, color: "#e9c46a" });
  if (g.carX > 700) { if (g.carVX > 1.5) { shake(g.j, 8); burst(g.j, g.r, g.carX + 60, GROUND - 30, 14, "#bc6c25", 4, 6); floatText(g.j, g.carX, GROUND - 100, "¡RAMPA LISTA!", "#bc6c25"); } g.carX = 700; g.carVX = 0; }
  if (g.carX < 360) g.carX = 360;

  // Cat physics (AABB-ish ball)
  const wasGround = g.onGround;
  g.catVY += 0.55;
  g.catX += g.catVX; g.catY += g.catVY;
  g.onGround = false;
  // ground
  if (g.catY + 26 >= GROUND) {
    if (!wasGround && g.catVY > 7) { shake(g.j, 5); burst(g.j, g.r, g.catX, GROUND, 10, "#e9c46a", 3, 5); }
    g.catY = GROUND - 26; if (g.catVY > 3) g.catVY = -g.catVY * 0.25; else g.catVY = 0; g.onGround = true;
  }
  // car body pushes cat when rolling into it
  if (Math.abs(g.carVX) > 0.5 && g.catY > GROUND - 70 && Math.abs(g.catX - g.carX) < 78) {
    g.catX = g.carX + (g.catVX > 0 ? 82 : -82); g.catVX = g.carVX * 1.4;
  }
  // solids landing / side
  for (const s of solids(g)) {
    const left = s.x, right = s.x + s.w, top = s.y;
    if (g.catX + 22 > left && g.catX - 22 < right) {
      const bottom = g.catY + 26;
      // step-up: rolling ball climbs car / steps / branch platforms up to 90px
      if (wasGround && bottom > top + 8 && bottom <= top + 92 && Math.abs(g.catVX) > 0.4) {
        g.catY = top - 26; g.catVY = 0; g.onGround = true; continue;
      }
      if (g.catVY >= 0 && bottom >= top && bottom - g.catVY <= top + 14) {
        // car ramp: slope up to the right when on car (first solid check special)
        g.catY = top - 26; if (g.catVY > 4) g.catVY = -g.catVY * 0.2; else g.catVY = 0; g.onGround = true;
        if (s.vx) g.catX += s.vx;
        // if this is car and car at ramp position, give launch slope bonus: rolling right gets lift at edge handled below
      }
    }
  }
  // Car ramp launch: if cat leaves car right edge moving fast, small hop
  // (handled naturally by falling to porch step)
  if (g.onGround) g.catVX *= 0.995; else g.catVX *= 0.995;
  if (Math.abs(g.catVX) < 0.05 && g.onGround) g.catVX = 0;
  // walls
  if (g.catX < 30) { g.catX = 30; g.catVX = Math.abs(g.catVX) * 0.5; }
  if (g.catX > W - 30) { g.catX = W - 30; g.catVX = -Math.abs(g.catVX) * 0.4; }
  g.catRot += g.catVX * 0.04;
  if (Math.abs(g.catVX) > 6 && g.meowCd <= 0) { g.meowCd = 120; floatText(g.j, g.catX, g.catY - 50, "¡Miauuu!", "#9d4edd"); }

  g.doorOpen = Math.max(0, Math.min(1, g.doorOpen + ((Math.abs(g.catX - DOOR_X) < 170 ? 0.05 : -0.05))));

  // Win: at door, on porch, gentle
  if (g.catX > 800 && g.catY < 410 && g.catY > 320) {
    if (Math.abs(g.catVX) < 4.5 && Math.abs(g.catVY) < 4) {
      burst(g.j, g.r, DOOR_X, DOOR_Y, 30, "#ffd23f", 5, 7);
      floatText(g.j, DOOR_X, DOOR_Y - 60, "¡A CASA!", "#ffd23f");
      endRun(g, true);
    } else if (g.catX > 830) {
      g.catVX = -Math.abs(g.catVX) * 0.6; floatText(g.j, g.catX, g.catY - 55, "¡SUAVE, GATO!", "#ff8a5b");
    }
  }
  // progress hint texts
  if (g.shots === 1 && g.branches.length === 1) { /* first pop already */ }
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  const elapsed = 1 - g.timeLeft / TIME_LIMIT;
  const top: [number, number, number] = [255, Math.round(183 - elapsed * 60), Math.round(3 + elapsed * 20)];
  const bot: [number, number, number] = [255, Math.round(224 - elapsed * 70), Math.round(130 - elapsed * 40)];
  sky(draw, W, H, g.scene === "title" ? [255, 183, 3] : top, g.scene === "title" ? [255, 244, 214] : bot);
  // notebook lines
  draw.setStrokeStyle("rgba(255,255,255,0.35)"); draw.setLineWidth(1);
  for (let y = 40; y < H; y += 36) { draw.beginPath(); draw.moveTo(0, y); draw.lineTo(W, y); draw.stroke(); }
  // distant hills
  draw.setFillStyle("#ffe08a"); draw.beginPath(); draw.arc(180, GROUND, 260, Math.PI, 0, false); draw.fill();
  draw.setFillStyle("#ffcf5c"); draw.beginPath(); draw.arc(780, GROUND, 320, Math.PI, 0, false); draw.fill();
  // ground
  draw.setFillStyle("#8ac926"); draw.fillRect(0, GROUND, W, H - GROUND);
  draw.setFillStyle("#6a994e"); draw.fillRect(0, GROUND, W, 8);
  // crayon ground dashes
  draw.setFillStyle("rgba(0,0,0,0.15)"); for (let x = 20; x < W; x += 48) draw.fillRect(x, GROUND + 28, 22, 4);

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // porch
  draw.setFillStyle("#bc6c25"); draw.fillRect(742, 432, 58, 40); draw.fillRect(788, 400, 154, 72);
  draw.setFillStyle("#dda15e"); draw.fillRect(788, 400, 154, 8);

  // house behind
  drawSprite(draw, s.house!, 862, 330, 270);
  // door indicator (hidden on title so the title card never covers it)
  if (g.scene !== "title") {
    if (g.doorOpen > 0.1) { draw.setFillStyle(`rgba(255,209,63,${0.5 * g.doorOpen})`); draw.fillRect(DOOR_X - 22, DOOR_Y - 28, 44, 56); }
    panel(draw, DOOR_X - 62, 296, 124, 30, "rgba(255,251,220,0.92)");
    text(draw, g.doorOpen > 0.5 ? "ABIERTA" : "PUERTA", DOOR_X, 312, 19, g.doorOpen > 0.5 ? "#2f7d32" : "#5c3d11", "center", "bangers");
  }

  // tree
  drawSprite(draw, s.tree!, 262, 338, 275);
  // branches: hand-drawn crayon limbs — tapered, bark-hatched, scribble leaf tufts
  for (const b of g.branches) {
    draw.save(); draw.translate(b.x, b.y + b.thick / 2); draw.rotate(b.angle);
    const wob = dsin(b.len * 0.05 + b.y) * 2;
    const base = b.thick / 2, tip = Math.max(3, b.thick * 0.28);
    // tapered crayon body (jagged top/bottom edges like a cut-paper strip)
    draw.setFillStyle("#8a5a2e");
    draw.beginPath();
    draw.moveTo(0, -base);
    for (let x = 0; x <= b.len; x += 18) {
      const t = x / Math.max(1, b.len), hh = base + (tip - base) * t;
      draw.lineTo(x, -hh + dsin(x * 0.45 + b.y) * 2);
    }
    for (let x = b.len; x >= 0; x -= 18) {
      const t = x / Math.max(1, b.len), hh = base + (tip - base) * t;
      draw.lineTo(x, hh + dsin(x * 0.5 + b.y * 2) * 2);
    }
    draw.closePath(); draw.fill();
    // dark crayon outline, slightly wobbly
    draw.setStrokeStyle("#4a2c12"); draw.setLineWidth(2.5);
    draw.beginPath(); draw.moveTo(0, -base);
    for (let x = 0; x <= b.len; x += 18) { const t = x / Math.max(1, b.len), hh = base + (tip - base) * t; draw.lineTo(x, -hh + dsin(x * 0.45 + b.y) * 2); }
    draw.stroke();
    draw.beginPath(); draw.moveTo(0, base);
    for (let x = 0; x <= b.len; x += 18) { const t = x / Math.max(1, b.len), hh = base + (tip - base) * t; draw.lineTo(x, hh + dsin(x * 0.5 + b.y * 2) * 2); }
    draw.stroke();
    // bark hatch: diagonal crayon strokes + a knot near the base
    draw.setStrokeStyle("rgba(74,44,18,0.65)"); draw.setLineWidth(2);
    for (let x = 14; x < b.len - 6; x += 20) {
      const t = x / Math.max(1, b.len), hh = (base + (tip - base) * t) * 0.8;
      draw.beginPath(); draw.moveTo(x, -hh); draw.lineTo(x + 8, hh); draw.stroke();
    }
    draw.setStrokeStyle("rgba(255,235,190,0.5)"); draw.setLineWidth(2);
    draw.beginPath(); draw.moveTo(4, -2); draw.lineTo(b.len - 8, wob - 2); draw.stroke();
    draw.setStrokeStyle("#4a2c12"); draw.setLineWidth(2);
    draw.beginPath(); draw.arc(16, 0, 5, 0, Math.PI * 2, false); draw.stroke();
    // leaf tuft: layered crayon scribbles around the tip (no flat circles)
    const lx = b.len, ly = wob;
    const blobs: [number, number, number][] = [[0, -2, 17], [14, -10, 12], [-6, -12, 11], [12, 9, 11], [-10, 7, 9]];
    for (const [ox, oy, rr] of blobs) {
      draw.setFillStyle("#4c9a52");
      draw.beginPath(); draw.arc(lx + ox, ly + oy, rr, 0, Math.PI * 2, false); draw.fill();
    }
    draw.setStrokeStyle("#2f6b2f"); draw.setLineWidth(2.5);
    for (const [ox, oy, rr] of blobs) {
      // scribble ring: two overlapping arcs + cross veins
      draw.beginPath(); draw.arc(lx + ox, ly + oy, rr - 2, 0.3, Math.PI * 1.8, false); draw.stroke();
      draw.beginPath(); draw.arc(lx + ox + 2, ly + oy + 2, rr - 5, Math.PI * 0.9, Math.PI * 2.4, false); draw.stroke();
      draw.beginPath(); draw.moveTo(lx + ox - rr + 3, ly + oy); draw.lineTo(lx + ox + rr - 3, ly + oy + 2); draw.stroke();
      draw.beginPath(); draw.moveTo(lx + ox, ly + oy - rr + 3); draw.lineTo(lx + ox + 2, ly + oy + rr - 3); draw.stroke();
    }
    draw.setFillStyle("#cdebb0");
    draw.beginPath(); draw.arc(lx - 5, ly - 8, 4, 0, Math.PI * 2, false); draw.fill();
    draw.beginPath(); draw.arc(lx + 11, ly - 13, 2.5, 0, Math.PI * 2, false); draw.fill();
    draw.restore();
  }
  // POP pills: opaque cream cards floating above the branch zone, never on the canopy
  for (const p of g.popups) {
    const a = Math.min(1, p.life / 15);
    draw.save(); draw.setGlobalAlpha(a);
    panel(draw, p.x - 52, p.y - 20, 104, 40, "rgba(255,251,220,1)");
    draw.setStrokeStyle("#2f7d32"); draw.setLineWidth(3);
    draw.beginPath(); draw.moveTo(p.x - 8, p.y + 20); draw.lineTo(p.x + 8, p.y + 20); draw.lineTo(p.x, p.y + 30); draw.closePath(); draw.fill();
    text(draw, p.text, p.x, p.y + 1, 24, "#1b5e20", "center", "bangers");
    draw.restore();
  }

  // car (ramp hint: wedge on top when heated/positioned)
  drawSprite(draw, s.car!, g.carX, GROUND - 28, 92, { sx: 1 + g.carHeat * 0.01 });
  if (g.carX > 640) { draw.setFillStyle("rgba(188,108,37,0.9)"); draw.beginPath(); draw.moveTo(g.carX - 55, GROUND - 52); draw.lineTo(g.carX + 58, GROUND - 78); draw.lineTo(g.carX + 58, GROUND - 52); draw.closePath(); draw.fill(); text(draw, "RAMPA→", g.carX, GROUND - 92, 14, "#7f5539", "center"); }
  if (g.carHeat > 0) { draw.setFillStyle("rgba(255,90,0,0.25)"); draw.beginPath(); draw.arc(g.carX, GROUND - 50, 30 + dsin(g.frame * 0.3) * 4, 0, Math.PI * 2, false); draw.fill(); }

  // rays
  for (const r of g.rays) {
    const a = r.life / 14;
    draw.setGlobalAlpha(a); draw.setStrokeStyle("#ffea00"); draw.setLineWidth(7); draw.beginPath(); draw.moveTo(r.x1, r.y1); draw.lineTo(r.x2, r.y2); draw.stroke();
    draw.setStrokeStyle("#ff8500"); draw.setLineWidth(3); draw.beginPath();
    for (let i = 0; i <= 10; i++) { const t = i / 10, px = r.x1 + (r.x2 - r.x1) * t, py = r.y1 + (r.y2 - r.y1) * t + dsin(t * 18 + g.frame * 0.8) * 5; i ? draw.lineTo(px, py) : draw.moveTo(px, py); }
    draw.stroke(); draw.setGlobalAlpha(1);
  }

  // aim guide (dotted)
  if (g.scene === "play") {
    const ang = g.aim * Math.PI / 180, dx = dsin(ang), dy = dcos(ang);
    draw.setFillStyle("rgba(255,120,0,0.55)");
    for (let i = 1; i < 9; i++) { draw.beginPath(); draw.arc(g.sunX + dx * i * 22, g.sunY + 20 + dy * i * 22, 3, 0, Math.PI * 2, false); draw.fill(); }
  }

  // cat with squash/stretch & fluff when hit
  const speed = Math.abs(g.catVX);
  const sq = g.onGround ? { sx: 1 + Math.min(0.25, speed * 0.02), sy: 1 - Math.min(0.18, speed * 0.015) } : { sx: 0.92, sy: 1.12 };
  const fluff = g.catHitCd > 40 ? 1.25 : 1;
  if (g.scene === "won") drawSprite(draw, s.cat!, 862, 300, 58, { sx: 1, sy: 1 }); // face at window-ish
  else drawSprite(draw, s.cat!, g.catX, g.catY, 62 * fluff, { rot: g.catRot, sx: sq.sx, sy: sq.sy, flip: g.catVX < -0.5 });
  if (g.catHitCd > 40) text(draw, "¡ERIZADO!", g.catX, g.catY - 48, 14, "#ff5a3c", "center");

  // sun player (blink on title heartbeat) — fixed safe spot on title so panel/HUD never cover it
  const blink = g.scene === "title" ? 1 + dsin(g.frame * 0.12) * 0.06 : 1;
  const sunDX = g.scene === "title" ? 66 : g.sunX;
  const sunDY = g.scene === "title" ? 62 : g.sunY;
  const sunH = g.scene === "title" ? 84 : 92;
  drawSprite(draw, s.sun!, sunDX, sunDY, sunH * blink, { rot: dsin(g.frame * 0.02) * 0.05 });
  if (g.scene === "lost") text(draw, "💤", g.sunX + 30, g.sunY - 30, 28, "#fff", "center");

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 56, "rgba(120,53,15,0.55)");
    // whisker lives
    text(draw, "Bigotes:", 28, 40, 18, "#fff");
    for (let i = 0; i < 3; i++) { draw.setStrokeStyle(i < g.lives ? "#ffd23f" : "rgba(255,255,255,0.25)"); draw.setLineWidth(3); draw.beginPath(); draw.moveTo(130 + i * 42, 36); draw.lineTo(162 + i * 42, 30); draw.moveTo(130 + i * 42, 44); draw.lineTo(162 + i * 42, 50); draw.stroke(); }
    const secs = Math.max(0, Math.ceil(g.timeLeft / 60));
    text(draw, `☀ Ocaso ${secs}s`, 430, 40, 20, secs < 20 ? "#ff8a8a" : "#ffd23f", "right");
    panel(draw, 14, 76, 560, 34, "rgba(120,53,15,0.4)");
    text(draw, "←→ Sol · ↑↓ Ángulo · ESPACIO Rayo · ¡No toques al gato!", 26, 93, 15, "#fff");
    // sunset + progress bars on their own panel: labels sit above bars, never under them
    panel(draw, W - 250, 12, 236, 84, "rgba(120,53,15,0.55)");
    text(draw, "Ocaso", W - 238, 26, 14, "#ffe08a");
    draw.setFillStyle("rgba(0,0,0,0.4)"); draw.fillRect(W - 238, 36, 212, 12);
    draw.setFillStyle("#ff8500"); draw.fillRect(W - 238, 36, 212 * elapsed, 12);
    text(draw, "Gato → casa", W - 238, 60, 14, "#ffffff");
    draw.setFillStyle("rgba(0,0,0,0.4)"); draw.fillRect(W - 238, 70, 212, 12);
    draw.setFillStyle("#7cc47f"); draw.fillRect(W - 238, 70, 212 * Math.max(0, Math.min(1, g.catX / DOOR_X)), 12);
  }

  if (g.scene === "title") {
    // dim the world first so hand-drawn art can't bleed through the card
    draw.setFillStyle("rgba(60,30,5,0.28)"); draw.fillRect(0, 0, W, H);
    // opaque cream notebook card, kept left of the house so PUERTA stays visible
    const cx = 400, bx = 100, bw = 600, by0 = 84, bh = 248;
    draw.setFillStyle("#fff8dc"); draw.fillRect(bx, by0, bw, bh);
    draw.setStrokeStyle("#e85d04"); draw.setLineWidth(4); draw.strokeRect(bx, by0, bw, bh);
    // red margin line like a notebook page
    draw.setStrokeStyle("rgba(232,93,4,0.35)"); draw.setLineWidth(2);
    draw.beginPath(); draw.moveTo(bx + 34, by0 + 8); draw.lineTo(bx + 34, by0 + bh - 8); draw.stroke();
    text(draw, "EL SOL EMPUJA", cx, 140, 46, "#e85d04", "center", "bangers");
    text(draw, "AL GATO A CASA", cx, 188, 46, "#e85d04", "center", "bangers");
    text(draw, "Dispara al ÁRBOL para que broten ramas que empujen al gato.", cx, 236, 18, "#5c3d11", "center");
    text(draw, "Calienta el COCHE como rampa hasta la puerta alta.", cx, 262, 18, "#5c3d11", "center");
    text(draw, "Si el rayo toca al gato, pierde un bigote (3). ¡90s!", cx, 288, 18, "#b91c1c", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "Toca Enter", cx, 316, 26, "#e85d04", "center", "bangers");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(0,0,0,0.45)"); draw.fillRect(0, 0, W, H);
    text(draw, "¡GANASTE! 🏡", W / 2, 150, 64, "#ffd23f", "center", "bangers");
    text(draw, "El gato asoma sonriendo por la ventana · humo feliz", W / 2, 210, 22, "#fff", "center");
    text(draw, `Tiempo sobrante: ${Math.ceil(g.timeLeft / 60)}s · Bigotes: ${g.lives}/3`, W / 2, 250, 20, "#ffe08a", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER para jugar de nuevo", W / 2, 400, 24, "#fff", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(20,10,40,0.55)"); draw.fillRect(0, 0, W, H);
    text(draw, "¡OCASO! 🌙", W / 2, 150, 64, "#cdb4db", "center", "bangers");
    text(draw, g.lives <= 0 ? "El gato se erizó demasiadas veces…" : "El sol se durmió y la puerta quedó cerrada.", W / 2, 215, 22, "#fff", "center");
    text(draw, `El gato llegó al ${Math.round(Math.max(0, Math.min(1, g.catX / DOOR_X)) * 100)}% del camino`, W / 2, 255, 20, "#ffe08a", "center");
    if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER para jugar de nuevo", W / 2, 400, 24, "#fff", "center");
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "El Sol Empuja al Gato a Casa" },
  clear: { r: 1, g: 0.85, b: 0.4 },
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
        let h = g.frame * 31 + g.lives * 7 + g.branches.length * 13 + Math.round(g.catX * 10) + Math.round(g.sunX);
        for (const b of g.branches) h = (Math.imul(h, 16777619) ^ Math.round(b.len * 10)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: Math.max(0, Math.min(1, g.catX / DOOR_X)), scene: g.scene, lives: g.lives, timeLeft: g.timeLeft, branches: g.branches.length }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
