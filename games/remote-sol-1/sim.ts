import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, squash, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["house", "tree", "sun", "car", "cat"];
const GROUND = 478, PORCH_Y = 412, PORCH_X = 724;
const HOUSE_X = 810, HOUSE_H = 198; // fully inside the screen with margin
const TIME_LIMIT = 5400; // 90s

interface Branch { x: number; y: number; w: number; ang: number; grow: number }
interface Ray { x1: number; y1: number; x2: number; y2: number; life: number }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  sunX: number; sunY: number; aim: number; // aim tilt -0.9..0.9 rad from straight down
  catX: number; catY: number; catVX: number; catVY: number; catRot: number; grounded: boolean; onCar: boolean; meowCd: number;
  carX: number; carVX: number; heat: number;
  branches: Branch[]; cooldown: number; ray: Ray | null;
  whiskers: number; elapsed: number; hitFlash: number; doorOpen: number; smoke: number;
  j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  sunX: 260, sunY: 82, aim: 0.25,
  catX: 168, catY: GROUND - 26, catVX: 0, catVY: 0, catRot: 0, grounded: true, onCar: false, meowCd: 0,
  carX: 585, carVX: 0, heat: 0,
  branches: [], cooldown: 0, ray: null,
  whiskers: 3, elapsed: 0, hitFlash: 0, doorOpen: 0, smoke: 0,
  j: juice(),
});

const branchDefs = [
  { x: 382, y: 440 }, { x: 478, y: 402 }, { x: 574, y: 366 }, { x: 664, y: 336 }, { x: 742, y: 356 },
];

// Floating feedback that never overlaps: nudges a new line above any live line near it.
function say(g: Game, x: number, y: number, txt: string, color = "#ffffff"): void {
  let yy = y;
  for (let k = 0; k < 4; k++) {
    let clash = false;
    for (const t of g.j.texts) {
      if (Math.abs(t.x - x) < 110 && Math.abs(t.y - yy) < 30) { clash = true; break; }
    }
    if (!clash) break;
    yy -= 34;
  }
  floatText(g.j, x, yy, txt, color);
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") return;
  g.elapsed++;
  if (g.cooldown > 0) g.cooldown--;
  if (g.hitFlash > 0) g.hitFlash--;
  if (g.meowCd > 0) g.meowCd--;
  if (g.ray) { g.ray.life--; if (g.ray.life <= 0) g.ray = null; }

  // --- Sun: player + auto drift toward sunset, faster over time ---
  const drift = 0.18 + (g.elapsed / TIME_LIMIT) * 0.85;
  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  g.sunX += dir * 3.6 + drift;
  g.sunX = Math.max(55, Math.min(W - 55, g.sunX));
  if (keys & KEY.up) g.aim -= 0.03;
  if (keys & KEY.down) g.aim += 0.03;
  // Late-game wobble: rays go at stranger angles
  const wobble = g.elapsed > 1800 ? dsin(g.frame * 0.07) * 0.08 * ((g.elapsed - 1800) / 3600 + 0.3) : 0;
  g.aim = Math.max(-0.95, Math.min(0.95, g.aim));

  // --- Fire ray (hold allowed, with cooldown) ---
  if ((keys & KEY.action) && g.cooldown <= 0) {
    g.cooldown = 20;
    const a = Math.PI / 2 + g.aim + wobble; // pointing down in screen coords
    const dx = dcos(a), dy = dsin(a);
    // Sample along ray, first hit wins
    let hitKind: "cat" | "tree" | "car" | "ground" | "house" | null = null;
    let hx = g.sunX + dx * 620, hy = g.sunY + dy * 620;
    for (let d = 20; d < 640; d += 7) {
      const px = g.sunX + dx * d, py = g.sunY + dy * d;
      if (Math.hypot(px - g.catX, py - g.catY) < 30) { hitKind = "cat"; hx = px; hy = py; break; }
      if (px > 258 && px < 362 && py > 308 && py < GROUND) { hitKind = "tree"; hx = px; hy = py; break; }
      if (Math.abs(px - g.carX) < 58 && Math.abs(py - (GROUND - 38)) < 40) { hitKind = "car"; hx = px; hy = py; break; }
      if (px > PORCH_X && py > 200 && py < PORCH_Y && Math.abs(px - HOUSE_X) < 95) { hitKind = "house"; hx = px; hy = py; break; }
      if (py >= GROUND) { hitKind = "ground"; hx = px; hy = py; break; }
    }
    g.ray = { x1: g.sunX, y1: g.sunY + 30, x2: hx, y2: hy, life: 14 };
    burst(g.j, g.r, g.sunX, g.sunY + 34, 4, "#ffd23f", 2, 4);

    if (hitKind === "cat") {
      g.whiskers--; g.hitFlash = 30;
      g.catVY = -7; g.catVX += range(g.r, -2, 2);
      burst(g.j, g.r, g.catX, g.catY, 22, "#ff8a5a", 5, 6); shake(g.j, 10);
      say(g, g.catX, g.catY - 50, "¡MIAU! ¡QUEMA!", "#ff5a5a");
      if (g.whiskers <= 0) { endRun(g, false); return; }
    } else if (hitKind === "tree") {
      if (g.branches.length < branchDefs.length) {
        const def = branchDefs[g.branches.length]!;
        const weird = g.elapsed > 2400 ? range(g.r, -14, 14) : range(g.r, -5, 5);
        const b: Branch = { x: def.x, y: def.y + weird, w: 118, ang: range(g.r, -0.16, 0.16), grow: 0 };
        g.branches.push(b);
        burst(g.j, g.r, b.x, b.y, 26, "#5aa843", 5, 7);
        burst(g.j, g.r, hx, hy, 10, "#8b5a2b", 3, 5);
        shake(g.j, 7); say(g, b.x, b.y - 34, "¡POP!", "#2e7d32");
        // Branch pop pushes cat (never the ray directly — the branch does it)
        const dist = Math.hypot(g.catX - b.x, g.catY - b.y);
        if (dist < 230) {
          g.catVX = Math.max(g.catVX, 3.2) + 1.6; g.catVY = -7.6; g.grounded = false;
          say(g, g.catX, g.catY - 46, "¡La rama empuja!", "#ffffff");
        }
      } else {
        burst(g.j, g.r, hx, hy, 14, "#5aa843", 4, 6);
        say(g, hx, hy - 24, "¡Ya no crece más!", "#ffffff");
        // Full tree still nudges cat if close
        if (Math.hypot(g.catX - hx, g.catY - hy) < 190) { g.catVX += 2.4; g.catVY = Math.min(g.catVY, -6); }
      }
    } else if (hitKind === "car") {
      g.heat = Math.min(100, g.heat + 38);
      g.carVX += 3.4;
      burst(g.j, g.r, hx, hy - 10, 18, "#ff9a2a", 4, 6);
      say(g, g.carX - 40, GROUND - 125, g.onCar ? "¡TRAMPOLÍN!" : "¡Chapa caliente!", "#ff7b00");
      if (g.onCar) { // trampoline launch!
        g.catVX = 6.4; g.catVY = -11.5; g.onCar = false; g.grounded = false;
        burst(g.j, g.r, g.catX, g.catY + 20, 20, "#ffd23f", 5, 6); shake(g.j, 8);
      }
    } else if (hitKind === "house") {
      burst(g.j, g.r, hx, hy, 8, "#ffe27a", 3, 5);
      say(g, hx, hy - 20, "La puerta espera al gato…", "#ffffff");
    } else if (hitKind === "ground") {
      burst(g.j, g.r, hx, hy, 8, "#e8c97a", 3, 5);
    }
  }

  for (const b of g.branches) if (b.grow < 1) b.grow = Math.min(1, b.grow + 0.08);

  // --- Car physics ---
  g.heat = Math.max(0, g.heat - 0.25);
  if (g.heat > 25) g.carVX += 0.06;
  g.carVX *= 0.965;
  const carPrevX = g.carX;
  g.carX += g.carVX;
  if (g.carX > 688) { // bump stop before porch
    if (Math.abs(g.carVX) > 2.2) {
      burst(g.j, g.r, g.carX + 55, GROUND - 20, 16, "#d9c9a8", 4, 5); shake(g.j, 6);
      say(g, g.carX + 55, GROUND - 175, "¡PLOC!", "#ffffff");
      if (g.onCar) { g.catVX = 5.8; g.catVY = -10.5; g.onCar = false; g.grounded = false; }
    }
    g.carX = 688; g.carVX = 0;
  }
  if (g.carX < 430) { g.carX = 430; g.carVX = 0; }
  const carDX = g.carX - carPrevX;

  // --- Cat physics (circle vs ground / porch / branches / car) ---
  g.catVY += 0.62;
  g.catX += g.catVX; g.catY += g.catVY;
  if (g.grounded) g.catVX *= 0.985;
  else g.catVX *= 0.999;
  g.catRot += g.catVX * 0.04;
  const R = 26;
  const wasOnCar = g.onCar;
  g.grounded = false; g.onCar = false;

  const land = (top: number) => {
    if (g.catVY >= 0 && g.catY + R > top && g.catY + R < top + 30) { g.catY = top - R; if (g.catVY > 7) { burst(g.j, g.r, g.catX, top, 8, "#e8c97a", 3, 4); } g.catVY = 0; g.grounded = true; return true; }
    return false;
  };
  if (g.catX < PORCH_X - 10) land(GROUND);
  if (g.catX >= PORCH_X - 20) land(PORCH_Y);
  // step between ground and porch: wall at porch edge
  if (g.catX + R > PORCH_X && g.catY + R > PORCH_Y + 6 && g.catY < PORCH_Y) { /* falling past edge ok */ }
  if (g.catX + R > PORCH_X && g.catX < PORCH_X + 20 && g.catY + R > PORCH_Y + 10 && g.catY + R <= GROUND) {
    // hit porch side wall
    if (g.catY + R > PORCH_Y + 14 && g.catVY > -2) { g.catX = PORCH_X - R; g.catVX = -Math.abs(g.catVX) * 0.4; }
  }
  for (const b of g.branches) {
    if (b.grow < 0.6) continue;
    if (Math.abs(g.catX - b.x) < b.w / 2 + 6) land(b.y);
  }
  // car top
  const carTop = GROUND - 76;
  if (Math.abs(g.catX - g.carX) < 62) {
    if (land(carTop)) { g.onCar = true; g.catX += carDX; }
  }
  if (wasOnCar && !g.onCar && g.grounded) g.catX += 0; // noop keep deterministic
  // car side push: rolling cat bumps car slightly
  if (!g.onCar && Math.abs(g.catY - (GROUND - 38)) < 55 && Math.abs(g.catX - g.carX) < 78 && g.catY + R > carTop + 10) {
    const side = g.catX < g.carX ? -1 : 1;
    if (side < 0 && g.catVX > 0) { g.carVX += g.catVX * 0.12; g.catVX *= -0.25; g.catX = g.carX - 78; }
  }
  if (g.catX < R + 4) { g.catX = R + 4; g.catVX = Math.abs(g.catVX) * 0.5; }
  if (g.catX > W - R - 4) { g.catX = W - R - 4; g.catVX = -Math.abs(g.catVX) * 0.5; }
  if (g.catY > GROUND - R && g.catX < PORCH_X) { g.catY = GROUND - R; g.catVY = 0; g.grounded = true; }

  if (Math.abs(g.catVX) > 6.5 && g.meowCd <= 0) { g.meowCd = 90; say(g, g.catX, g.catY - 48, "¡Miauuu!", "#ff9a2a"); burst(g.j, g.r, g.catX, g.catY, 6, "#ffffff", 2, 4); }

  // --- Win: cat enters door (on porch, in door zone, gentle) ---
  const speed = Math.hypot(g.catVX, g.catVY);
  if (g.catX > HOUSE_X - 47 && g.catX < HOUSE_X + 47 && g.catY > PORCH_Y - 95 && g.catY < PORCH_Y + 10 && g.grounded) {
    if (speed < 7.5) {
      g.doorOpen = 1; g.smoke = 1;
      burst(g.j, g.r, HOUSE_X, PORCH_Y - 50, 36, "#ffd23f", 6, 7);
      burst(g.j, g.r, HOUSE_X, 180, 24, "#ffffff", 3, 6);
      say(g, HOUSE_X, 240, "¡A CASA!", "#2e7d32");
      endRun(g, true); return;
    } else if (g.meowCd <= 0) {
      g.meowCd = 60; say(g, g.catX, g.catY - 52, "¡Suave, suave…!", "#ff7b00");
      g.catVX *= 0.5;
    }
  }

  if (g.elapsed >= TIME_LIMIT) { endRun(g, false); return; }
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  const t = g.scene === "play" ? g.elapsed / TIME_LIMIT : 0;
  // Yellow palette sky that warms to sunset orange
  sky(draw, W, H, [255, Math.round(205 - t * 70), Math.round(70 - t * 30)], [255, Math.round(238 - t * 80), Math.round(190 - t * 90)]);
  // notebook lines
  draw.setStrokeStyle("rgba(120,160,220,0.18)"); draw.setLineWidth(1);
  for (let y = 42; y < H; y += 34) { draw.beginPath(); draw.moveTo(0, y); draw.lineTo(W, y); draw.stroke(); }
  draw.setStrokeStyle("rgba(255,90,90,0.25)"); draw.beginPath(); draw.moveTo(54, 0); draw.lineTo(54, H); draw.stroke();
  // sun path arc (dashed)
  draw.setStrokeStyle("rgba(255,150,20,0.5)"); draw.setLineWidth(3);
  draw.beginPath(); for (let x = 40; x <= W - 40; x += 24) { const y = 62 + Math.pow((x - W / 2) / (W / 2), 2) * 40; x === 40 ? draw.moveTo(x, y) : draw.lineTo(x, y); } draw.stroke();
  // distant hills
  draw.setFillStyle("#f7d774"); draw.beginPath(); draw.arc(150, GROUND + 60, 190, Math.PI, 0, false); draw.fill();
  draw.setFillStyle("#bfe08a"); draw.beginPath(); draw.arc(560, GROUND + 80, 240, Math.PI, 0, false); draw.fill();

  const o = shakeOffset(g.j, g.frame);
  draw.save(); draw.translate(o.x, o.y);

  // ground + porch
  draw.setFillStyle("#8fce62"); draw.fillRect(0, GROUND, W, H - GROUND);
  draw.setFillStyle("#69b84a"); for (let x = 8; x < W; x += 46) draw.fillRect(x, GROUND + 12 + ((x * 7) % 18), 22, 5);
  draw.setFillStyle("#c98d54"); draw.fillRect(PORCH_X, PORCH_Y, W - PORCH_X, GROUND - PORCH_Y);
  draw.setFillStyle("#a96f38"); draw.fillRect(PORCH_X, PORCH_Y, W - PORCH_X, 10);
  draw.setFillStyle("#8b5a2b"); draw.fillRect(PORCH_X - 8, PORCH_Y, 12, GROUND - PORCH_Y); // porch post / step edge
  // bump stop for car
  draw.setFillStyle("#777"); draw.fillRect(742, GROUND - 22, 18, 22);

  // house (on porch, fully on screen)
  drawSprite(draw, s.house!, HOUSE_X, PORCH_Y - HOUSE_H / 2, HOUSE_H);
  // door glow / open state
  const doorC = g.scene === "won" ? "#ffe97a" : "#fff3b0";
  draw.setFillStyle(doorC); draw.setGlobalAlpha(g.scene === "won" ? 0.95 : 0.55 + dsin(g.frame * 0.06) * 0.15);
  draw.fillRect(HOUSE_X - 27, PORCH_Y - 82, 54, 82); draw.setGlobalAlpha(1);
  text(draw, "CASA", HOUSE_X, PORCH_Y - 204, 18, "#8b5a2b", "center");
  if (g.scene === "won") { // happy chimney smoke + cat face in window handled by smoke puffs
    for (let i = 0; i < 5; i++) { const yy = 96 - ((g.frame * 1.2 + i * 28) % 110); draw.setFillStyle("rgba(255,255,255,0.75)"); draw.beginPath(); draw.arc(HOUSE_X + 46 + dsin(g.frame * 0.05 + i) * 8, yy, 10 + i * 2, 0, Math.PI * 2, false); draw.fill(); }
  }

  // tree
  drawSprite(draw, s.tree!, 310, GROUND - 84, 176);
  // grown branches: chunky hand-drawn crayon limbs (round blobs, wobbly core, bark ticks, leafy edge)
  for (const b of g.branches) {
    const len = (b.w / 2) * b.grow;
    const ax = 310, ay = GROUND - 118;
    const mx = b.x - len * 0.4, my = b.y + 8;
    const bx = b.x + len, by = b.y;
    const pt = (tt: number): [number, number] => {
      if (tt < 0.5) { const u = tt * 2; return [ax + (mx - ax) * u, ay + (my - ay) * u]; }
      const u = (tt - 0.5) * 2; return [mx + (bx - mx) * u, my + (by - my) * u];
    };
    // limb body: overlapping round crayon dabs, alternating browns
    for (let i = 0; i <= 18; i++) {
      const tt = i / 18;
      const [px, py] = pt(tt);
      const wob = dsin(tt * 9 + b.x * 0.7) * 2.5;
      draw.setFillStyle(i % 2 ? "#9c6a35" : "#7c4f24");
      draw.beginPath(); draw.arc(px, py + wob, 8.5 - tt * 2, 0, Math.PI * 2, false); draw.fill();
    }
    // darker wobbly core squiggle for texture
    draw.setStrokeStyle("rgba(70,42,16,0.55)"); draw.setLineWidth(2);
    draw.beginPath();
    for (let i = 0; i <= 12; i++) {
      const tt = i / 12;
      const [px, py] = pt(tt);
      const wob = dsin(tt * 9 + b.x * 0.7) * 2.5 + dsin(tt * 23 + b.y) * 1.5;
      i === 0 ? draw.moveTo(px, py + wob) : draw.lineTo(px, py + wob);
    }
    draw.stroke();
    // bark ticks: short diagonal darker dabs
    draw.setStrokeStyle("rgba(70,42,16,0.5)"); draw.setLineWidth(2.5);
    for (let i = 1; i < 7; i++) {
      const tt = i / 7;
      const [px, py] = pt(tt);
      const wob = dsin(tt * 9 + b.x * 0.7) * 2.5;
      draw.beginPath(); draw.moveTo(px - 4, py + wob - 5); draw.lineTo(px + 4, py + wob + 5); draw.stroke();
    }
    // crayon leaves with darker hand-drawn ring
    for (let i = 0; i < 5; i++) {
      const lx = b.x - len + (i * len * 2) / 4 + 4, ly = b.y - 11 - (i % 2) * 8;
      draw.setFillStyle(i % 2 ? "#5aa843" : "#79c95e");
      draw.beginPath(); draw.arc(lx, ly, 9, 0, Math.PI * 2, false); draw.fill();
      draw.setStrokeStyle("rgba(46,125,50,0.8)"); draw.setLineWidth(2);
      draw.beginPath(); draw.arc(lx, ly, 9, 0, Math.PI * 2, false); draw.stroke();
    }
    // leafy perch edge (round puffs, never a flat bar)
    for (let i = 0; i <= 8; i++) {
      const tt = i / 8;
      const ex = b.x - b.w / 2 + tt * b.w, ey = b.y - 2 + dsin(tt * 12 + b.x) * 2;
      draw.setFillStyle(i % 2 ? "#79c95e" : "#8fd674");
      draw.beginPath(); draw.arc(ex, ey, 5, 0, Math.PI * 2, false); draw.fill();
    }
  }

  // car (heat glow)
  if (g.heat > 20) { draw.setFillStyle(`rgba(255,110,20,${0.12 + g.heat / 500})`); draw.beginPath(); draw.arc(g.carX, GROUND - 40, 78, 0, Math.PI * 2, false); draw.fill(); }
  drawSprite(draw, s.car!, g.carX, GROUND - 40, 92, { rot: dsin(g.frame * 0.3) * Math.min(0.04, Math.abs(g.carVX) * 0.01) });
  if (g.heat > 30) for (let i = 0; i < 3; i++) { draw.setStrokeStyle("rgba(255,120,20,0.6)"); draw.setLineWidth(2); draw.beginPath(); const wx = g.carX - 30 + i * 30; draw.moveTo(wx, GROUND - 92); draw.lineTo(wx + dsin(g.frame * 0.3 + i) * 5, GROUND - 108); draw.stroke(); }

  // aim guide (dotted)
  if (g.scene === "play") {
    const a = Math.PI / 2 + g.aim;
    draw.setFillStyle("rgba(255,140,0,0.55)");
    for (let d = 60; d < 300; d += 26) { draw.beginPath(); draw.arc(g.sunX + dcos(a) * d, g.sunY + 26 + dsin(a) * d, 4, 0, Math.PI * 2, false); draw.fill(); }
  }
  // ray beam with heat wavy edges
  if (g.ray) {
    const r = g.ray, al = r.life / 14;
    draw.setGlobalAlpha(al); draw.setStrokeStyle("#ffdf3a"); draw.setLineWidth(13);
    draw.beginPath(); draw.moveTo(r.x1, r.y1); draw.lineTo(r.x2, r.y2); draw.stroke();
    draw.setStrokeStyle("#fff7ae"); draw.setLineWidth(5); draw.beginPath(); draw.moveTo(r.x1, r.y1); draw.lineTo(r.x2, r.y2); draw.stroke();
    draw.setStrokeStyle("rgba(255,120,0,0.7)"); draw.setLineWidth(2);
    for (const off of [-11, 11]) { draw.beginPath(); for (let i = 0; i <= 10; i++) { const tt = i / 10, px = r.x1 + (r.x2 - r.x1) * tt + dsin(tt * 18 + g.frame) * off * 0.4 + off * 0.4, py = r.y1 + (r.y2 - r.y1) * tt; i === 0 ? draw.moveTo(px, py) : draw.lineTo(px, py); } draw.stroke(); }
    draw.setGlobalAlpha(1);
  }

  // cat (squash by speed, bristle flash when hit)
  const sq = squash(g.catVY, 0.028);
  const speedSq = Math.min(0.18, Math.abs(g.catVX) * 0.018);
  const bristle = g.hitFlash > 0 ? 1.12 : 1;
  drawSprite(draw, s.cat!, g.catX, g.catY, 62 * bristle, { rot: g.catRot, sx: (sq.sx + speedSq) * bristle, sy: (sq.sy - speedSq * 0.6), flip: g.catVX < -0.6 });
  if (g.hitFlash > 0) text(draw, "¡ERIZADO!", g.catX, g.catY - 56, 18, "#ff5a5a", "center");

  // sun player (heartbeat blink on title, happy in play)
  const beat = 1 + Math.abs(dsin(g.frame * 0.09)) * 0.06;
  drawSprite(draw, s.sun!, g.sunX, g.sunY, 104 * beat, { sx: beat, sy: 1 / beat });
  if (g.scene === "lost") text(draw, "Zzz", g.sunX + 44, g.sunY - 36, 26, "#ffffff", "center");

  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 360, 58, "rgba(90,50,0,0.5)");
    text(draw, "Bigotes", 28, 32, 19, "#ffffff");
    for (let i = 0; i < 3; i++) {
      const on = i < g.whiskers, x = 125 + i * 52, y = 34;
      draw.setStrokeStyle(on ? "#ffffff" : "rgba(255,255,255,0.25)"); draw.setLineWidth(3);
      for (const dy of [-7, 0, 7]) { draw.beginPath(); draw.moveTo(x - 18, y + dy); draw.lineTo(x + 18, y + dy * 1.7); draw.stroke(); }
    }
    text(draw, `Ramas ${g.branches.length}/5`, 28, 58, 16, "#b6ff9a");
    text(draw, `Coche ${Math.round(g.heat)}°`, 190, 58, 16, g.heat > 30 ? "#ffb36b" : "#ffffff");
    // sunset bar
    panel(draw, W - 274, 12, 260, 58, "rgba(90,50,0,0.5)");
    text(draw, `Ocaso ${Math.max(0, Math.ceil((TIME_LIMIT - g.elapsed) / 60))}s`, W - 260, 32, 19, "#ffd23f");
    draw.setFillStyle("rgba(255,255,255,0.25)"); draw.fillRect(W - 260, 50, 232, 10);
    draw.setFillStyle(t > 0.75 ? "#ff5a3a" : "#ffd23f"); draw.fillRect(W - 260, 50, 232 * (1 - t), 10);
    draw.setFillStyle("rgba(60,30,0,0.55)"); draw.fillRect(0, H - 30, W, 30);
    text(draw, "Izq/Der: Sol · Arr/Aba: angulo · ESPACIO: rayo", W / 2, H - 15, 17, "#ffe9a8", "center");
    if (g.elapsed < 300) text(draw, "¡Dispara al ÁRBOL para que una rama empuje al gato! →", W / 2, 92, 21, "#7a4a12", "center");
  }

  // Overlays: notebook title page
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(255,244,180,0.28)" : "rgba(60,25,0,0.52)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.frame * 0.05) * 6;
    if (g.scene === "title") {
      text(draw, "EL SOL EMPUJA", W / 2, 128 + bob, 62, "#ff8a00", "center", "bangers");
      text(draw, "AL GATO A CASA", W / 2, 184 + bob, 62, "#e65100", "center", "bangers");
      text(draw, "Eres el Sol. No toques al gato con tu rayo: ¡quema!", W / 2, 246, 21, "#5d3a00", "center");
      text(draw, "Rayo al árbol: rama que empuja · Rayo al coche: trampolín caliente", W / 2, 278, 19, "#5d3a00", "center");
      text(draw, "Lleva al gato rodando, suave, hasta la puerta antes del ocaso (90s)", W / 2, 308, 19, "#5d3a00", "center");
      text(draw, "Toca ENTER", W / 2, 386 + dsin(g.frame * 0.12) * 4, 36, "#d35400", "center", "bangers");
      // controls strip glued to the very bottom so it never covers the car or cat
      draw.setFillStyle("rgba(60,30,0,0.65)"); draw.fillRect(0, H - 30, W, 30);
      text(draw, "Izq/Der mover Sol · Arr/Aba angulo · ESPACIO disparar", W / 2, H - 15, 18, "#ffffff", "center");
    } else if (g.scene === "won") {
      text(draw, "¡GANASTE! ¡A CASA!", W / 2, 150 + bob, 60, "#ffd23f", "center", "bangers");
      text(draw, "La puerta se abrió, sale humo feliz y el gato sonríe en casa", W / 2, 224, 22, "#ffffff", "center");
      text(draw, `Tiempo: ${Math.round(g.elapsed / 60)}s · Bigotes: ${g.whiskers}/3 · Ramas: ${g.branches.length}`, W / 2, 262, 20, "#ffe9a8", "center");
      if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER para jugar de nuevo", W / 2, 360, 26, "#ffffff", "center");
    } else {
      text(draw, g.whiskers <= 0 ? "¡GATO TOSTADO!" : "¡CAYÓ EL OCASO!", W / 2, 150 + bob, 60, "#ff8a8a", "center", "bangers");
      text(draw, g.whiskers <= 0 ? "Tres rayos directos erizaron al gato…" : "El Sol se durmió y el gato mira la puerta cerrada…", W / 2, 224, 22, "#ffffff", "center");
      text(draw, `El gato llegó al ${Math.round(Math.min(1, g.catX / HOUSE_X) * 100)}% del camino`, W / 2, 262, 20, "#ffe9a8", "center");
      if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER para intentarlo de nuevo", W / 2, 360, 26, "#ffffff", "center");
    }
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "El Sol Empuja al Gato a Casa" },
  clear: { r: 1, g: 0.9, b: 0.55 },
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
        let h = g.frame * 31 + g.whiskers * 7 + g.branches.length * 13 + Math.round(g.catX * 10) + Math.round(g.sunX);
        h = (Math.imul(h, 16777619) ^ Math.round(g.catY * 10) ^ Math.round(g.carX * 10) ^ g.elapsed) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.scene === "won" ? 1 : Math.max(0, Math.min(0.98, (g.catX / HOUSE_X) * 0.8 + g.branches.length * 0.04)), scene: g.scene, whiskers: g.whiskers, branches: g.branches.length, catX: Math.round(g.catX) }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
