import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, rand, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["tower", "snail", "mollusk", "gastropod", "cannon", "mushroom", "flag"];
const DURATION = 5400; // 90 seconds
const LANES = [285, 375, 465];

type Kind = "snail" | "mollusk" | "gastropod";
interface Snail { x: number; y: number; kind: Kind; hp: number; maxHp: number; speed: number; phase: number; chew: boolean; squashT: number; slimeT: number; dead: boolean }
interface Cannon { x: number; y: number; vx: number; vy: number; reload: number; combo: number; comboT: number; flash: number; rot: number }
interface Shell { x: number; y: number; vx: number; dead: boolean; trailT: number }
interface Mush { x: number; y: number; alive: boolean; respawn: number; wob: number }
interface Corpse { x: number; y: number; kind: Kind; t: number }
interface Ring { x: number; y: number; r: number; life: number }
interface Slime { x: number; y: number; life: number }

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  flagX: number; flagY: number; towerHp: number; playT: number; spawnT: number; kills: number;
  placeCd: number; snails: Snail[]; cannons: Cannon[]; shells: Shell[]; mush: Mush[]; corpses: Corpse[]; rings: Ring[]; slimes: Slime[];
  j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed),
  flagX: 520, flagY: 375, towerHp: 100, playT: 0, spawnT: 30, kills: 0, placeCd: 0,
  snails: [], cannons: [
    { x: 680, y: LANES[1]!, vx: 0, vy: 0, reload: 0, combo: 0, comboT: 0, flash: 0, rot: 0 },
    { x: 620, y: LANES[0]!, vx: 0, vy: 0, reload: 20, combo: 0, comboT: 0, flash: 0, rot: 0 },
  ],
  shells: [], mush: [
    { x: 300, y: LANES[0]! - 28, alive: true, respawn: 0, wob: 0 },
    { x: 430, y: LANES[1]! - 28, alive: true, respawn: 0, wob: 2 },
    { x: 250, y: LANES[2]! - 28, alive: true, respawn: 0, wob: 4 },
  ],
  corpses: [], rings: [], slimes: [], j: juice(),
});

function explode(g: Game, m: Mush) {
  m.alive = false; m.respawn = 700;
  shake(g.j, 16); burst(g.j, g.r, m.x, m.y, 42, "#e23b3b", 7, 8); burst(g.j, g.r, m.x, m.y, 26, "#ffd23f", 5, 6); burst(g.j, g.r, m.x, m.y, 18, "#7ac74f", 4, 5);
  floatText(g.j, m.x, m.y - 55, "BOOM!", "#ff5a3c");
  for (const s of g.snails) if (!s.dead && Math.hypot(s.x - m.x, s.y - m.y) < 125) { s.dead = true; g.kills++; g.corpses.push({ x: s.x, y: s.y, kind: s.kind, t: 28 }); burst(g.j, g.r, s.x, s.y, 10, "#b8e986", 4, 5); }
}
function killSnail(g: Game, s: Snail, ram: boolean, cannon?: Cannon) {
  if (s.dead) return; s.dead = true; g.kills++;
  g.corpses.push({ x: s.x, y: s.y, kind: s.kind, t: 30 });
  burst(g.j, g.r, s.x, s.y, ram ? 20 : 16, "#c9a86a", 5, 6);
  burst(g.j, g.r, s.x, s.y, 10, "#7ac74f", 4, 4);
  if (ram && cannon) {
    cannon.combo++; cannon.comboT = 90;
    floatText(g.j, s.x, s.y - 42, cannon.combo >= 2 ? `RAM! x${cannon.combo}` : "RAM!", "#ffd23f");
    shake(g.j, Math.min(10, 4 + cannon.combo));
  } else floatText(g.j, s.x, s.y - 38, "+1 SNAIL", "#ffffff");
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j, 0.08);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  if (g.scene !== "play") return;
  g.playT++; g.placeCd = Math.max(0, g.placeCd - 1);

  const sliding = g.cannons.some(c => Math.hypot(c.vx, c.vy) > 0.9);
  const dx = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const dy = (keys & KEY.down ? 1 : 0) - (keys & KEY.up ? 1 : 0);

  if (sliding) {
    for (const c of g.cannons) if (Math.hypot(c.vx, c.vy) > 0.5) { c.vx += dx * 0.42; c.vy += dy * 0.42; }
  } else {
    g.flagX = Math.max(70, Math.min(770, g.flagX + dx * 6));
    g.flagY = Math.max(210, Math.min(500, g.flagY + dy * 5));
  }

  // Place cannon
  if ((edge & KEY.start) && g.placeCd <= 0) {
    if (g.cannons.length >= 6) { floatText(g.j, g.flagX, g.flagY - 50, "MAX CANNONS!", "#ffd23f"); g.placeCd = 30; }
    else {
      g.cannons.push({ x: g.flagX, y: g.flagY, vx: 0, vy: 0, reload: 10, combo: 0, comboT: 0, flash: 0, rot: 0 });
      g.placeCd = 75; burst(g.j, g.r, g.flagX, g.flagY, 16, "#f4c542", 3, 5); floatText(g.j, g.flagX, g.flagY - 52, "CANNON PLANTED!", "#ffd23f"); shake(g.j, 3);
    }
  }

  // Fire all
  if ((edge & KEY.action)) {
    let fired = 0;
    for (const c of g.cannons) {
      if (c.reload > 0) continue;
      c.reload = 48; c.flash = 10; fired++;
      g.shells.push({ x: c.x - 42, y: c.y - 8, vx: -10.5, dead: false, trailT: 0 });
      c.vx += 7.2; c.vy = 0; // recoil straight back — only player steering changes lanes
      g.rings.push({ x: c.x - 48, y: c.y - 8, r: 6, life: 18 });
      burst(g.j, g.r, c.x - 48, c.y - 8, 8, "#7fb3d5", 3, 5);
    }
    if (fired) { shake(g.j, 6); floatText(g.j, W / 2, 118, fired > 1 ? `VOLLEY x${fired}! STEER THE SKID!` : "BOOM! STEER THE SKID!", "#2a7ab8"); }
    else if (g.cannons.length) floatText(g.j, g.cannons[0]!.x, g.cannons[0]!.y - 55, "RELOADING...", "#ffffff");
  }

  // Spawning with ramp
  const t = g.playT / DURATION;
  g.spawnT--;
  if (g.spawnT <= 0 && g.playT < DURATION - 120) {
    g.spawnT = Math.max(26, Math.round(80 - t * 50 + range(g.r, -8, 8)));
    const roll = rand(g.r);
    const kind: Kind = g.playT < 700 ? "snail" : roll < 0.48 ? "snail" : roll < 0.76 ? "gastropod" : "mollusk";
    const lane = LANES[Math.floor(rand(g.r) * 3)]!;
    const hp = kind === "mollusk" ? 3 : kind === "gastropod" ? 2 : 1;
    g.snails.push({ x: -40 - range(g.r, 0, 60), y: lane + range(g.r, -8, 8), kind, hp, maxHp: hp, speed: range(g.r, 0.36, 0.52) + t * 0.26, phase: range(g.r, 0, 6), chew: false, squashT: 0, slimeT: 0, dead: false });
    // Late parade sends a second snail in another lane — one fixed cannon line cannot hold all three lanes.
    if (g.playT > 1600 && rand(g.r) < 0.45 + t * 0.3) {
      const lane2 = LANES[Math.floor(rand(g.r) * 3)]!;
      const k2: Kind = rand(g.r) < 0.6 ? "snail" : "gastropod";
      g.snails.push({ x: -70 - range(g.r, 0, 40), y: lane2, kind: k2, hp: k2 === "gastropod" ? 2 : 1, maxHp: k2 === "gastropod" ? 2 : 1, speed: range(g.r, 0.38, 0.54) + t * 0.26, phase: range(g.r, 0, 6), chew: false, squashT: 0, slimeT: 0, dead: false });
    }
  }

  // Cannons physics
  for (const c of g.cannons) {
    c.reload = Math.max(0, c.reload - 1); c.flash = Math.max(0, c.flash - 1);
    if (c.comboT > 0) { c.comboT--; if (!c.comboT) c.combo = 0; }
    const onSlime = g.slimes.some(s => Math.abs(s.x - c.x) < 42 && Math.abs(s.y - c.y) < 26);
    c.x += c.vx; c.y += c.vy;
    const fr = onSlime ? 0.995 : 0.965;
    c.vx *= fr; c.vy *= fr;
    if (Math.abs(c.vx) < 0.04) c.vx = 0; if (Math.abs(c.vy) < 0.04) c.vy = 0;
    if (c.x < 55) { c.x = 55; c.vx = Math.abs(c.vx) * 0.55; } if (c.x > 815) { c.x = 815; c.vx = -Math.abs(c.vx) * 0.55; }
    if (c.y < 205) { c.y = 205; c.vy = Math.abs(c.vy) * 0.55; } if (c.y > 505) { c.y = 505; c.vy = -Math.abs(c.vy) * 0.55; }
    c.rot = Math.max(-0.25, Math.min(0.25, c.vx * 0.018));
    // pile-up collisions
    for (const o of g.cannons) if (o !== c && Math.hypot(o.x - c.x, o.y - c.y) < 62) { const push = (62 - Math.hypot(o.x - c.x, o.y - c.y)) * 0.04 + 0.4; const a = Math.atan2(c.y - o.y, c.x - o.x); c.vx += dcos(a) * push * 0.3; c.vy += dsin(a) * push * 0.3; }
    // ram snails
    const speed = Math.hypot(c.vx, c.vy);
    if (speed > 1.6) for (const s of g.snails) if (!s.dead && Math.abs(s.x - c.x) < 52 && Math.abs(s.y - c.y) < 42) {
      if (s.hp > 1 && speed < 4) { s.hp--; s.x -= 18; burst(g.j, g.r, s.x, s.y, 10, "#c9a86a", 4, 5); floatText(g.j, s.x, s.y - 40, "CRACK!", "#ffd23f"); c.vx *= 0.5; }
      else killSnail(g, s, true, c);
    }
    // ram mushroom
    for (const m of g.mush) if (m.alive && speed > 1.4 && Math.hypot(m.x - c.x, m.y - c.y) < 55) explode(g, m);
  }

  // Shells
  for (const sh of g.shells) {
    sh.x += sh.vx; sh.trailT++;
    if (sh.trailT % 3 === 0) g.j.particles.push({ x: sh.x + 10, y: sh.y, vx: 0.4, vy: 0, life: 16, max: 16, size: 3, color: "#7fb3d5" });
    if (sh.x < -20) sh.dead = true;
    for (const m of g.mush) if (m.alive && !sh.dead && Math.hypot(m.x - sh.x, m.y - sh.y) < 38) { sh.dead = true; explode(g, m); }
    for (const s of g.snails) if (!s.dead && !sh.dead && Math.abs(s.x - sh.x) < 38 && Math.abs(s.y - sh.y) < 34) {
      sh.dead = true; s.hp--;
      burst(g.j, g.r, s.x, s.y, 14, "#c9a86a", 5, 6);
      if (s.hp <= 0) killSnail(g, s, false); else { s.x -= 14; floatText(g.j, s.x, s.y - 38, "CRACK!", "#ffd23f"); }
    }
  }
  g.shells = g.shells.filter(s => !s.dead);

  // Snails
  let chewing = 0;
  for (const s of g.snails) {
    if (s.dead) continue;
    s.phase += 0.08;
    let sp = s.speed;
    if (s.kind === "gastropod") sp = (Math.floor(g.playT / 45 + s.phase) % 3 === 0) ? s.speed * 2.6 : s.speed * 0.45;
    if (s.x >= 792) { s.chew = true; chewing++; g.towerHp -= 0.075; if (g.frame % 28 === 0) { shake(g.j, 7); burst(g.j, g.r, 812, s.y, 6, "#9a9a9a", 3, 4); } }
    else s.x += sp;
    if (s.kind === "mollusk") { s.slimeT++; if (s.slimeT > 42) { s.slimeT = 0; g.slimes.push({ x: s.x - 18, y: s.y + 14, life: 320 }); } }
  }
  if (chewing && g.frame % 50 === 0) floatText(g.j, 835, 150, "THEY'RE CHEWING!", "#ff8a8a");
  g.snails = g.snails.filter(s => !s.dead);
  for (const s of g.slimes) s.life--; g.slimes = g.slimes.filter(s => s.life > 0);
  for (const c of g.corpses) c.t--; g.corpses = g.corpses.filter(c => c.t > 0);
  for (const r of g.rings) { r.r += 2.2; r.life--; } g.rings = g.rings.filter(r => r.life > 0);
  for (const m of g.mush) { m.wob += 0.05; if (!m.alive) { m.respawn--; if (m.respawn <= 0) { m.alive = true; burst(g.j, g.r, m.x, m.y, 10, "#e23b3b", 2, 4); } } }

  if (g.towerHp <= 0) { g.towerHp = 0; shake(g.j, 22); endRun(g, false); }
  else if (g.playT >= DURATION) endRun(g, true);
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [135, 185, 225], [250, 243, 214]);
  // clouds & hills
  draw.setFillStyle("rgba(255,255,255,0.85)");
  for (let i = 0; i < 5; i++) { const x = ((i * 230 + g.frame * 0.25) % (W + 120)) - 60; const y = 48 + (i % 3) * 28; draw.beginPath(); draw.arc(x, y, 24, 0, Math.PI * 2, false); draw.arc(x + 24, y + 4, 18, 0, Math.PI * 2, false); draw.fill(); }
  draw.setFillStyle("#a8c686"); draw.fillRect(0, 190, W, 350);
  draw.setFillStyle("#8fb573");
  for (const y of LANES) draw.fillRect(0, y - 34, W, 68);
  // lanes dashed path
  draw.setFillStyle("rgba(255,250,220,0.55)");
  for (const y of LANES) for (let x = 8; x < 820; x += 42) draw.fillRect(x, y + 26, 22, 5);
  // slime
  for (const sl of g.slimes) { draw.setGlobalAlpha(Math.min(0.65, sl.life / 120)); draw.setFillStyle("#69c24a"); draw.beginPath(); draw.ellipse(sl.x, sl.y, 30, 9, 0, 0, Math.PI * 2, false); draw.fill(); }
  draw.setGlobalAlpha(1);

  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);

  // tower (tilts as damaged)
  const dmg = 1 - g.towerHp / 100;
  const tremble = g.scene === "title" ? dsin(g.frame * 0.35) * 0.012 : (g.snails.some(x => x.chew) ? dsin(g.frame * 0.6) * 0.01 : 0);
  drawSprite(draw, s.tower!, 882, 315, 330, { rot: -dmg * 0.07 + tremble, sy: 1 - dmg * 0.06 });
  // tower HP stones visual: cracks text
  if (dmg > 0.35) text(draw, "CRACK!", 868, 210, 18, "#5a4a3a", "center");

  // mushrooms
  for (const m of g.mush) if (m.alive) drawSprite(draw, s.mushroom!, m.x, m.y, 58, { sy: 1 + dsin(m.wob) * 0.05, sx: 1 - dsin(m.wob) * 0.03 });

  // flag marker
  const danger = g.snails.length ? Math.max(...g.snails.map(x => x.x)) / 800 : 0;
  const wave = 4 + danger * 14;
  if (g.scene === "play") {
    draw.setStrokeStyle("#f4c542"); draw.setLineWidth(3); draw.beginPath(); draw.ellipse(g.flagX, g.flagY + 18, 34, 10, 0, 0, Math.PI * 2, false); draw.stroke();
    drawSprite(draw, s.flag!, g.flagX, g.flagY - 18, 72, { rot: dsin(g.frame * 0.02 * wave) * 0.14 });
  }

  // corpses (squash & boing back)
  for (const c of g.corpses) { const p = c.t / 30; const spr = s[c.kind]!; drawSprite(draw, spr, c.x, c.y + 8, 52, { sx: 1.6 - p * 0.4, sy: 0.25 + (1 - p) * 0.5, alpha: Math.min(1, p * 1.5) }); }

  // snails
  for (const sn of g.snails) {
    const spr = s[sn.kind]!;
    const stretch = sn.kind === "gastropod" ? 1 + dsin(sn.phase * 2) * 0.12 : 1;
    const h = sn.kind === "mollusk" ? 62 : 54;
    drawSprite(draw, spr, sn.x, sn.y, h, { sx: stretch, sy: 1 / Math.sqrt(stretch), flip: false });
    if (sn.maxHp > 1) { draw.setFillStyle("rgba(0,0,0,0.45)"); draw.fillRect(sn.x - 22, sn.y - 38, 44, 7); draw.setFillStyle(sn.hp === sn.maxHp ? "#7ac74f" : "#ff8a5a"); draw.fillRect(sn.x - 22, sn.y - 38, 44 * sn.hp / sn.maxHp, 7); }
    if (sn.chew) text(draw, "nom", sn.x - 6, sn.y - 42, 14, "#5a3a2a", "center");
  }

  // shells
  for (const sh of g.shells) { draw.setFillStyle("#2f3a45"); draw.beginPath(); draw.arc(sh.x, sh.y, 9, 0, Math.PI * 2, false); draw.fill(); draw.setFillStyle("#dfeeff"); draw.beginPath(); draw.arc(sh.x - 3, sh.y - 3, 3, 0, Math.PI * 2, false); draw.fill(); }
  // rings (smoke)
  for (const r of g.rings) { draw.setGlobalAlpha(r.life / 24); draw.setStrokeStyle("#a8c8e8"); draw.setLineWidth(3); draw.beginPath(); draw.arc(r.x, r.y, r.r, 0, Math.PI * 2, false); draw.stroke(); }
  draw.setGlobalAlpha(1);

  // cannons
  for (const c of g.cannons) {
    const spd = Math.hypot(c.vx, c.vy);
    drawSprite(draw, s.cannon!, c.x, c.y, 74, { rot: c.rot, sx: 1 + Math.min(0.18, spd * 0.02), sy: 1 - Math.min(0.12, spd * 0.015) });
    if (c.flash > 0) { draw.setFillStyle("#ffd23f"); draw.beginPath(); draw.arc(c.x - 50, c.y - 8, 10 + (10 - c.flash), 0, Math.PI * 2, false); draw.fill(); }
    if (c.reload > 0 && g.scene === "play") { draw.setFillStyle("rgba(0,0,0,0.4)"); draw.fillRect(c.x - 24, c.y - 52, 48, 6); draw.setFillStyle("#7fb3d5"); draw.fillRect(c.x - 24, c.y - 52, 48 * (1 - c.reload / 48), 6); }
    else if (g.scene === "play") text(draw, "READY!", c.x, c.y - 52, 13, "#2e7d32", "center");
  }

  // title decorative snails
  if (g.scene === "title") for (let i = 0; i < 5; i++) { const x = ((g.frame * 0.45 + i * 190) % (W + 100)) - 50; drawSprite(draw, s[i % 2 ? "gastropod" : "snail"]!, x, 505, 48, {}); }

  drawJuice(draw, g.j); draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 470, 58, "rgba(30,35,45,0.72)");
    const remain = Math.max(0, Math.ceil((DURATION - g.playT) / 60));
    text(draw, `⏱ ${remain}s`, 30, 32, 22, "#ffd23f");
    text(draw, `🐌 KOs ${g.kills}`, 145, 32, 20, "#ffffff");
    text(draw, `Cannons ${g.cannons.length}/6`, 285, 32, 18, "#ffffff");
    text(draw, g.placeCd <= 0 ? "ENTER: plant!" : `plant in ${Math.ceil(g.placeCd / 60 * 10) / 10}s`, 30, 56, 14, g.placeCd <= 0 ? "#8be28b" : "#cccccc");
    text(draw, "SPACE fire • steer skid with arrows!", 250, 56, 13, "#a8d8ff");
    // tower hp
    panel(draw, 650, 12, 296, 58, "rgba(30,35,45,0.72)");
    text(draw, "🏰 CASTLE", 666, 32, 18, "#ffffff");
    draw.setFillStyle("#333"); draw.fillRect(666, 46, 264, 14);
    draw.setFillStyle(g.towerHp > 50 ? "#7ac74f" : g.towerHp > 25 ? "#ffd23f" : "#ff5a5a"); draw.fillRect(666, 46, 264 * g.towerHp / 100, 14);
    text(draw, `${Math.ceil(g.towerHp)}`, 798, 53, 14, "#111111", "center");
    // progress bar
    draw.setFillStyle("rgba(0,0,0,0.4)"); draw.fillRect(14, H - 16, W - 28, 8);
    draw.setFillStyle("#ffd23f"); draw.fillRect(14, H - 16, (W - 28) * (g.playT / DURATION), 8);
  }

  // Overlays (English, custom)
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(20,25,35,0.38)" : "rgba(20,25,35,0.62)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.sceneFrames * 0.05) * 6;
    if (g.scene === "title") {
      text(draw, "RECOIL RAMPART", W / 2, 92 + bob, 68, "#ffd23f", "center", "bangers");
      panel(draw, W / 2 - 330, 128, 660, 64, "rgba(180,40,40,0.88)");
      text(draw, "HOLD THE CASTLE!", W / 2, 161, 42, "#ffffff", "center", "bangers");
      panel(draw, W / 2 - 360, 208, 720, 150, "rgba(0,0,0,0.55)");
      text(draw, "Arrows / WASD: move the gold flag  •  ENTER: plant a cannon", W / 2, 238, 19, "#ffffff", "center");
      text(draw, "SPACE: fire ALL cannons — recoil blasts them backwards!", W / 2, 268, 19, "#a8d8ff", "center");
      text(draw, "Steer the sliding cannons with arrows to RAM snails flat!", W / 2, 298, 19, "#8be28b", "center");
      text(draw, "Hit mushrooms for a BOOM • Survive 90 seconds!", W / 2, 328, 19, "#ffd9a0", "center");
      if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "PRESS ENTER TO DEFEND!", W / 2, 405, 28, "#ffd23f", "center", "bangers");
    } else if (g.scene === "won") {
      text(draw, "CASTLE HELD!", W / 2, 170 + bob, 68, "#ffd23f", "center", "bangers");
      text(draw, `The snail parade is over!  KOs: ${g.kills}  •  Castle: ${Math.ceil(g.towerHp)} HP left`, W / 2, 250, 22, "#ffffff", "center");
      text(draw, "Your sliding cannon pile-up saved every stone!", W / 2, 285, 19, "#8be28b", "center");
      if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "ENTER: PLAY AGAIN", W / 2, 370, 26, "#ffffff", "center");
    } else {
      text(draw, "CASTLE NIBBLED!", W / 2, 170 + bob, 64, "#ff8a8a", "center", "bangers");
      text(draw, `The snails chewed it to rubble...  KOs: ${g.kills}  •  Survived ${Math.floor(g.playT / 60)}s / 90s`, W / 2, 250, 22, "#ffffff", "center");
      text(draw, "Tip: fire, then steer the recoil skid back INTO the horde!", W / 2, 285, 19, "#ffd9a0", "center");
      if (Math.floor(g.sceneFrames / 30) % 2 === 0) text(draw, "ENTER: TRY AGAIN", W / 2, 370, 26, "#ffffff", "center");
    }
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Recoil Rampart" },
  clear: { r: 0.85, g: 0.92, b: 0.98 },
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
      checksum: () => { let h = g.frame * 31 + g.kills * 7 + Math.round(g.towerHp * 10) + Math.round(g.flagX); for (const sn of g.snails) h = (Math.imul(h, 16777619) ^ Math.round(sn.x * 10 + sn.hp)) >>> 0; for (const c of g.cannons) h = (Math.imul(h, 31) ^ Math.round(c.x * 10)) >>> 0; return h >>> 0; },
      state: () => ({ outcome: outcomeOf(g.scene), progress: Math.min(1, g.playT / DURATION), scene: g.scene, score: g.kills, lives: Math.ceil(g.towerHp) }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
