import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["rocket", "alien", "planet", "star", "asteroid"];
const TOTAL = 90 * 60;
const PLANET_X = W / 2, PLANET_Y = 508;

interface Bullet { x: number; y: number; vx: number; vy: number; life: number; bounces: number; pierce: boolean; hitCd: number }
interface Alien { x: number; y: number; vx: number; vy: number; t: number; hp: number; special: boolean; dive: boolean; seed: number }
interface Ast { x: number; y: number; r: number; rot: number; vr: number; vx: number; vy: number }
interface Pickup { x: number; y: number; vy: number; t: number }
interface Casing { x: number; y: number; vx: number; vy: number; life: number; rot: number }

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  j: Juice;
  x: number; y: number; vx: number; vy: number; rot: number;
  cooldown: number; recoilT: number; invuln: number; glow: number;
  lastDx: number; lastDy: number;
  score: number; planetHits: number; crashes: number; kills: number;
  elapsed: number; spawnT: number; specialT: number;
  bullets: Bullet[]; aliens: Alien[]; asts: Ast[]; pickups: Pickup[]; casings: Casing[];
  hasStar: boolean; titleFire: number; shakeDirX: number; shakeDirY: number;
}

function makeAsts(r: { s: number }): Ast[] {
  const pts: Ast[] = [];
  const fixed = [
    { x: 170, y: 150 }, { x: 790, y: 140 }, { x: 480, y: 190 }, { x: 250, y: 330 }, { x: 710, y: 330 },
  ];
  for (const p of fixed) pts.push({ x: p.x + range(r, -20, 20), y: p.y + range(r, -15, 15), r: range(r, 34, 46), rot: range(r, 0, 6), vr: range(r, -0.008, 0.008), vx: range(r, -0.25, 0.25), vy: range(r, -0.15, 0.15) });
  return pts;
}

const fresh = (seed: number, scene: Scene = "title"): Game => {
  const r = rng(seed);
  return {
    scene, sceneFrames: 0, frame: 0, prev: 0, r, j: juice(),
    x: W / 2, y: 300, vx: 0, vy: 0, rot: 0,
    cooldown: 0, recoilT: 0, invuln: 0, glow: 0,
    lastDx: 0, lastDy: -1, score: 0, planetHits: 0, crashes: 0, kills: 0,
    elapsed: 0, spawnT: 40, specialT: 0,
    bullets: [], aliens: [], asts: makeAsts(r), pickups: [], casings: [],
    hasStar: false, titleFire: 0, shakeDirX: 0, shakeDirY: 0,
  };
};

function fire(g: Game, dx: number, dy: number, pierce: boolean) {
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  g.lastDx = dx; g.lastDy = dy;
  const speed = pierce ? 14 : 11;
  g.bullets.push({ x: g.x + dx * 34, y: g.y + dy * 34, vx: dx * speed, vy: dy * speed, life: pierce ? 110 : 95, bounces: 0, pierce, hitCd: 0 });
  const kick = pierce ? 9 : 5.6;
  g.vx -= dx * kick; g.vy -= dy * kick;
  g.cooldown = pierce ? 20 : 9;
  g.recoilT = 10;
  g.shakeDirX = -dx; g.shakeDirY = -dy;
  shake(g.j, pierce ? 9 : 3.5);
  // huge flame at muzzle opposite? flame behind bullet origin opposite direction of travel? Actually muzzle flame along shot
  burst(g.j, g.r, g.x + dx * 38, g.y + dy * 38, pierce ? 22 : 12, pierce ? "#ffd23f" : "#ff9f43", pierce ? 6 : 4, pierce ? 9 : 6);
  burst(g.j, g.r, g.x - dx * 28, g.y - dy * 28, 8, "#fff3b0", 3, 5);
  // shell casing drifting
  for (let i = 0; i < 2; i++) g.casings.push({ x: g.x - dx * 18, y: g.y - dy * 18, vx: -dx * 1.5 + range(g.r, -1.2, 1.2), vy: -dy * 1.5 + range(g.r, -1, 1), life: 50, rot: range(g.r, 0, 6) });
  if (pierce) floatText(g.j, g.x, g.y - 52, "STAR CANNON!", "#ffd23f");
}

function killAlien(g: Game, a: Alien, b: Bullet | null) {
  g.kills++;
  let pts = 100;
  let label = "+100";
  if (b && b.pierce) { pts = 250; label = "PIERCED! +250"; }
  else if (b && b.bounces === 1) { pts = 200; label = "PING! +200"; }
  else if (b && b.bounces >= 2) { pts = 350; label = b.bounces >= 3 ? "THROUGH TWO! +350" : "RICOCHET! +350"; }
  if (a.special) { pts += 50; g.pickups.push({ x: a.x, y: a.y, vy: 1.2, t: 0 }); floatText(g.j, a.x, a.y - 34, "STAR DROPPED!", "#ffd23f"); }
  g.score += pts;
  floatText(g.j, a.x, a.y - 18, label, b && b.bounces > 0 ? "#7CFC9A" : "#ffffff");
  burst(g.j, g.r, a.x, a.y, 22, "#7CFC00", 5, 7);
  burst(g.j, g.r, a.x, a.y, 12, "#c8ff7a", 3, 5);
  // green ring approximated by particles already; shake
  shake(g.j, 4);
}

function crash(g: Game, x: number, y: number, why: string) {
  if (g.invuln > 0) return;
  g.crashes++; g.invuln = 240;
  burst(g.j, g.r, x, y, 28, "#ff8a5a", 6, 7);
  burst(g.j, g.r, x, y, 14, "#ffd23f", 4, 5);
  shake(g.j, 14);
  floatText(g.j, g.x, g.y - 54, why, "#ff9a9a");
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j, 0.06);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); }
  // title idle auto-fire
  if (g.scene === "title") {
    g.titleFire--;
    g.x = W / 2 + dsin(g.frame * 0.02) * 120;
    g.y = 330 + dcos(g.frame * 0.03) * 18;
    if (g.titleFire <= 0) {
      g.titleFire = 42;
      const dx = dsin(g.frame * 0.02) > 0 ? -1 : 1;
      // visual bullet-ish particles only
      burst(g.j, g.r, g.x + dx * 36, g.y, 10, "#ff9f43", 4, 6);
      g.vx = 0;
    }
    // move asteroids slowly
    for (const a of g.asts) { a.rot += a.vr; }
    return;
  }
  if (g.scene !== "play") return;

  g.elapsed++;
  const t01 = g.elapsed / TOTAL;
  if (g.elapsed >= TOTAL) { endRun(g, true); return; }

  // firing direction
  const dxIn = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const dyIn = (keys & KEY.down ? 1 : 0) - (keys & KEY.up ? 1 : 0);
  if (g.cooldown > 0) g.cooldown--;
  if (g.recoilT > 0) g.recoilT--;
  if (g.invuln > 0) g.invuln--;
  if (g.glow > 0) g.glow--;

  if ((dxIn !== 0 || dyIn !== 0) && g.cooldown <= 0) fire(g, dxIn, dyIn, false);
  if ((edge & KEY.action) && g.hasStar) {
    const dx = dxIn !== 0 || dyIn !== 0 ? dxIn : g.lastDx;
    const dy = dxIn !== 0 || dyIn !== 0 ? dyIn : g.lastDy;
    fire(g, dx, dy, true);
    g.hasStar = false; g.glow = 0;
  } else if ((edge & KEY.action) && !g.hasStar) {
    // small hint occasionally? no spam
  }

  // rocket physics: drift, damping, slight gravity toward planet? gentle pull down adds challenge
  g.vy += 0.045; // faint gravity toward planet
  g.vx *= 0.97; g.vy *= 0.97;
  // clamp speed
  const sp = Math.hypot(g.vx, g.vy);
  if (sp > 7.6) { g.vx = g.vx / sp * 7.6; g.vy = g.vy / sp * 7.6; }
  g.x += g.vx; g.y += g.vy;
  g.rot = Math.max(-0.55, Math.min(0.55, g.vx * 0.045)) + (g.recoilT > 0 ? -g.lastDx * 0.12 : 0);
  // walls bounce
  if (g.x < 36) { g.x = 36; g.vx = Math.abs(g.vx) * 0.7; }
  if (g.x > W - 36) { g.x = W - 36; g.vx = -Math.abs(g.vx) * 0.7; }
  if (g.y < 70) { g.y = 70; g.vy = Math.abs(g.vy) * 0.7; }
  if (g.y > 430) { // don't crash into planet area; bounce above planet
    // if directly above planet, push up
    if (Math.abs(g.x - PLANET_X) < 120 && g.y > 425) { g.y = 425; g.vy = -Math.abs(g.vy) * 0.6; }
    else if (g.y > 500) { g.y = 500; g.vy = -Math.abs(g.vy) * 0.7; }
  }
  if (g.hasStar && g.frame % 4 === 0) {
    g.j.particles.push({ x: g.x + range(g.r, -22, 22), y: g.y + range(g.r, -18, 22), vx: range(g.r, -0.5, 0.5), vy: range(g.r, -1, -0.2), life: 24, max: 24, size: 4, color: "#ffd23f" });
  }

  // asteroids drift/bounce in region
  for (const a of g.asts) {
    a.x += a.vx; a.y += a.vy; a.rot += a.vr;
    if (a.x < 80 || a.x > W - 80) a.vx *= -1;
    if (a.y < 90 || a.y > 380) a.vy *= -1;
    // rocket collision
    const d = Math.hypot(g.x - a.x, g.y - a.y);
    if (d < a.r + 26) {
      const nx = (g.x - a.x) / (d || 1), ny = (g.y - a.y) / (d || 1);
      const speedInto = Math.hypot(g.vx, g.vy);
      g.x = a.x + nx * (a.r + 27); g.y = a.y + ny * (a.r + 27);
      const dot = g.vx * nx + g.vy * ny;
      const headOn = -dot;
      g.vx -= 2 * dot * nx; g.vy -= 2 * dot * ny;
      g.vx *= 0.55; g.vy *= 0.55;
      burst(g.j, g.r, g.x, g.y, 10, "#ffe9a8", 3, 4);
      floatText(g.j, a.x, a.y - a.r - 10, "CLANG!", "#ffe9a8");
      shake(g.j, 5);
      if (headOn > 7.15) crash(g, g.x, g.y, "CRASH! HULL HIT");
      else g.invuln = Math.max(g.invuln, 12);
    }
  }

  // spawning aliens
  g.spawnT--;
  const spawnInterval = 98;
  if (g.spawnT <= 0) {
    g.spawnT = spawnInterval + Math.floor(range(g.r, 0, 18));
    const special = (g.elapsed > 500 && g.frame % 7 === 0) || range(g.r, 0, 1) < 0.10;
    // Actually deterministic special cadence: every ~9th
    const isSpecial = (g.kills + g.aliens.length + Math.floor(g.elapsed / 60)) % 9 === 4 || special && range(g.r, 0, 1) < 0.3;
    const x = range(g.r, 70, W - 70);
    const speed = 0.48 + range(g.r, 0, 0.22) + t01 * 0.22;
    g.aliens.push({ x, y: -30, vx: 0, vy: speed, t: range(g.r, 0, 100), hp: 1, special: !!isSpecial, dive: false, seed: range(g.r, 0, 10) });
  }

  // aliens move
  for (const a of g.aliens) {
    a.t++;
    const divePhase = t01 > 0.55;
    if (!a.dive && divePhase && a.y > 170 && range(g.r, 0, 1) < 0.0012) a.dive = true;
    if (a.dive) {
      const dx = PLANET_X - a.x, dy = PLANET_Y - a.y; const l = Math.hypot(dx, dy) || 1;
      a.x += (dx / l) * (1.35 + t01 * 0.6); a.y += (dy / l) * (1.35 + t01 * 0.6);
    } else {
      a.y += a.vy;
      a.x += dsin(a.t * 0.07 + a.seed) * (1.1 + t01 * 0.6);
      // slight homing drift toward planet x lower down
      if (a.y > 300) a.x += (PLANET_X - a.x) * 0.0015;
    }
    a.x = Math.max(24, Math.min(W - 24, a.x));
    // hit planet?
    if (a.y > PLANET_Y - 28 && Math.abs(a.x - PLANET_X) < 62) {
      a.y = H + 200;
      g.planetHits++;
      burst(g.j, g.r, a.x, PLANET_Y - 40, 30, "#c99aff", 6, 7);
      burst(g.j, g.r, a.x, PLANET_Y - 40, 16, "#ff8a8a", 5, 6);
      shake(g.j, 15);
      floatText(g.j, PLANET_X, PLANET_Y - 120, "PLANET HIT!", "#ff9a9a");
    }
    // bump into rocket: alien bursts, rocket knocked but no hull crash (asteroids are the crash hazard)
    if (g.invuln <= 0 && Math.hypot(a.x - g.x, a.y - g.y) < 42) {
      a.y = H + 200; killAlienVisualOnly(g, a);
      g.vx += (g.x - a.x) * 0.08; g.vy += (g.y - a.y) * 0.08; g.invuln = 30;
      floatText(g.j, g.x, g.y - 50, "BUMP!", "#ffe9a8");
    }
  }
  g.aliens = g.aliens.filter(a => a.y < H + 80);

  // bullets
  for (const b of g.bullets) {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.hitCd > 0) b.hitCd--;
    // asteroid ricochet
    if (b.hitCd <= 0) {
      for (const a of g.asts) {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < a.r + 6) {
          const nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1);
          const dot = b.vx * nx + b.vy * ny;
          if (dot < 0) {
            b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
            b.x = a.x + nx * (a.r + 8); b.y = a.y + ny * (a.r + 8);
            b.bounces++; b.hitCd = 10;
            burst(g.j, g.r, b.x, b.y, 10, "#ffe9a8", 3.5, 4);
            floatText(g.j, b.x, b.y - 18, "PING!", "#ffe9a8");
            shake(g.j, 2.5);
          }
          break;
        }
      }
    }
    // alien hits
    for (const a of g.aliens) {
      if (Math.hypot(b.x - a.x, b.y - a.y) < (b.pierce ? 46 : 43)) {
        a.hp--;
        if (a.hp <= 0) { killAlien(g, a, b); a.y = H + 200; }
        else { burst(g.j, g.r, a.x, a.y, 8, "#a8ff7a", 3, 4); floatText(g.j, a.x, a.y - 22, "HIT!", "#d0ffb0"); }
        if (!b.pierce) { b.life = 0; }
        break;
      }
    }
  }
  g.bullets = g.bullets.filter(b => b.life > 0 && b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < H + 30);
  g.aliens = g.aliens.filter(a => a.y < H + 80);

  // pickups
  for (const p of g.pickups) {
    p.t++; p.y += p.vy; p.x += dsin(p.t * 0.08) * 0.6;
    if (Math.hypot(p.x - g.x, p.y - g.y) < 48) {
      p.y = H + 200; g.hasStar = true; g.glow = 9999;
      burst(g.j, g.r, g.x, g.y, 26, "#ffd23f", 5, 6);
      floatText(g.j, g.x, g.y - 56, "STAR LOADED! SPACE!", "#ffd23f");
      shake(g.j, 5);
    }
  }
  g.pickups = g.pickups.filter(p => p.y < H + 40);

  // casings
  for (const c of g.casings) { c.x += c.vx; c.y += c.vy; c.vy += 0.03; c.vx *= 0.98; c.life--; c.rot += 0.1; }
  g.casings = g.casings.filter(c => c.life > 0);

  if (g.planetHits >= 3 || g.crashes >= 3) endRun(g, false);
}
function killAlienVisualOnly(g: Game, a: Alien) { burst(g.j, g.r, a.x, a.y, 18, "#7CFC00", 5, 6); }

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  // warm neighborly space: deep plum to warm peach horizon
  sky(draw, W, H, [38, 24, 68], [122, 62, 92]);
  // stars parallax dots deterministic by frame? static pattern using sin hash
  draw.setFillStyle("rgba(255,235,190,0.85)");
  for (let i = 0; i < 70; i++) {
    const x = (i * 137.5) % W; const y = (i * 89.3) % 430;
    const tw = 1 + dsin(g.frame * 0.08 + i) * 0.7;
    draw.fillRect(x, y, tw + 1, tw + 1);
  }
  // distant warm nebula blobs
  draw.setFillStyle("rgba(255,160,110,0.14)"); draw.beginPath(); draw.arc(180, 110, 110, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("rgba(190,120,255,0.13)"); draw.beginPath(); draw.arc(800, 170, 130, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("rgba(255,210,140,0.10)"); draw.beginPath(); draw.arc(480, 60, 90, 0, Math.PI * 2, false); draw.fill();

  const o = shakeOffset(g.j, g.frame);
  // directional screen kick
  const kickX = g.shakeDirX * Math.min(4, g.j.shake * 0.4), kickY = g.shakeDirY * Math.min(4, g.j.shake * 0.4);
  draw.save(); draw.translate(o.x + kickX, o.y + kickY);

  // planet behind
  const planetH = 150;
  const crackAlpha = g.planetHits / 3;
  // soft filled body behind the hand-drawn planet outline so it reads as a world on dark space
  draw.setFillStyle("rgba(139,92,199,0.90)"); draw.beginPath(); draw.arc(PLANET_X, PLANET_Y, 70, 0, Math.PI * 2, false); draw.fill();
  draw.setFillStyle("rgba(196,156,255,0.55)"); draw.beginPath(); draw.arc(PLANET_X - 18, PLANET_Y - 22, 42, 0, Math.PI * 2, false); draw.fill();
  drawSprite(draw, s.planet!, PLANET_X, PLANET_Y, planetH, { sx: 1 + dsin(g.frame * 0.03) * 0.01, sy: 1 });
  if (g.planetHits > 0) {
    draw.setStrokeStyle(`rgba(40,10,50,${0.5 + crackAlpha * 0.4})`); draw.setLineWidth(3); draw.beginPath();
    draw.moveTo(PLANET_X - 30, PLANET_Y - 45); draw.lineTo(PLANET_X - 8, PLANET_Y - 18); draw.lineTo(PLANET_X - 24, PLANET_Y + 8);
    if (g.planetHits > 1) { draw.moveTo(PLANET_X + 34, PLANET_Y - 38); draw.lineTo(PLANET_X + 12, PLANET_Y - 8); draw.lineTo(PLANET_X + 30, PLANET_Y + 22); }
    draw.stroke();
  }
  // planet shield hint arc when alien near?
  // asteroids
  for (const a of g.asts) drawSprite(draw, s.asteroid!, a.x, a.y, a.r * 2.15, { rot: a.rot });
  // pickups
  for (const p of g.pickups) {
    const bob = dsin(p.t * 0.12) * 6;
    draw.setFillStyle("rgba(255,210,63,0.25)"); draw.beginPath(); draw.arc(p.x, p.y + bob, 30 + dsin(p.t * 0.2) * 4, 0, Math.PI * 2, false); draw.fill();
    drawSprite(draw, s.star!, p.x, p.y + bob, 52, { rot: dsin(p.t * 0.06) * 0.3, sx: 1 + dsin(p.t * 0.2) * 0.08, sy: 1 + dcos(p.t * 0.2) * 0.08 });
  }
  // aliens
  for (const a of g.aliens) {
    const wob = dsin(a.t * 0.15 + a.seed) * 0.18;
    const h = a.special ? 62 : 56;
    if (a.special) { draw.setFillStyle("rgba(255,210,63,0.28)"); draw.beginPath(); draw.arc(a.x, a.y, 36, 0, Math.PI * 2, false); draw.fill(); }
    drawSprite(draw, s.alien!, a.x, a.y, h, { rot: wob, sx: 1 + dsin(a.t * 0.2) * 0.06, sy: 1 - dsin(a.t * 0.2) * 0.06 });
    if (a.hp > 1) { draw.setFillStyle("#ff6b6b"); draw.fillRect(a.x - 18, a.y - 38, 36, 5); draw.setFillStyle("#7CFC9A"); draw.fillRect(a.x - 18, a.y - 38, 18 * a.hp, 5); }
    if (a.dive) { draw.setFillStyle("rgba(255,80,80,0.9)"); draw.beginPath(); draw.arc(a.x, a.y - 34, 5 + dsin(g.frame * 0.3) * 1.5, 0, Math.PI * 2, false); draw.fill(); }
  }
  // bullets
  for (const b of g.bullets) {
    if (b.pierce) {
      draw.setStrokeStyle("#ffd23f"); draw.setLineWidth(6); draw.beginPath(); draw.moveTo(b.x - b.vx * 2.2, b.y - b.vy * 2.2); draw.lineTo(b.x, b.y); draw.stroke();
      draw.setFillStyle("#fff7c0"); draw.beginPath(); draw.arc(b.x, b.y, 9, 0, Math.PI * 2, false); draw.fill();
    } else {
      draw.setFillStyle(b.bounces > 0 ? "#ffe9a8" : "#fff3b0"); draw.beginPath(); draw.arc(b.x, b.y, b.bounces > 0 ? 6 : 5, 0, Math.PI * 2, false); draw.fill();
      draw.setStrokeStyle("rgba(255,160,80,0.7)"); draw.setLineWidth(2); draw.beginPath(); draw.moveTo(b.x - b.vx * 1.4, b.y - b.vy * 1.4); draw.lineTo(b.x, b.y); draw.stroke();
    }
  }
  // casings
  for (const c of g.casings) {
    draw.save(); draw.translate(c.x, c.y); draw.rotate(c.rot); draw.setFillStyle("#d9a441"); draw.fillRect(-5, -2, 10, 4); draw.restore();
  }
  // rocket
  const inTitle = g.scene === "title";
  const rx = inTitle ? g.x : g.x, ry = inTitle ? g.y : g.y;
  const squashAmt = g.recoilT > 0 ? g.recoilT / 10 : 0;
  const blink = g.invuln > 0 && Math.floor(g.frame / 4) % 2 === 0;
  if (g.hasStar) { draw.setFillStyle("rgba(255,210,63,0.28)"); draw.beginPath(); draw.arc(rx, ry, 52 + dsin(g.frame * 0.2) * 5, 0, Math.PI * 2, false); draw.fill(); }
  if (!blink) {
    // flame squash behind rocket opposite last shot
    if (g.recoilT > 0 || inTitle && Math.floor(g.frame / 42) % 5 === 0) {
      const fx = rx - g.lastDx * 34, fy = ry - g.lastDy * 34;
      draw.setFillStyle("#ff9f43"); draw.beginPath(); draw.arc(fx, fy, 14 * squashAmt + 6, 0, Math.PI * 2, false); draw.fill();
      draw.setFillStyle("#ffe66d"); draw.beginPath(); draw.arc(fx, fy, 7 * squashAmt + 3, 0, Math.PI * 2, false); draw.fill();
    }
    drawSprite(draw, s.rocket!, rx, ry, 78, { rot: inTitle ? dsin(g.frame * 0.03) * 0.15 : g.rot, sx: 1 + squashAmt * 0.22, sy: 1 - squashAmt * 0.18 });
  }
  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    const remain = Math.max(0, Math.ceil((TOTAL - g.elapsed) / 60));
    panel(draw, 14, 12, 430, 58, "rgba(20,10,35,0.62)");
    text(draw, `TIME ${remain}s`, 30, 32, 22, remain <= 15 ? "#ff9a9a" : "#ffd23f");
    text(draw, `SCORE ${g.score}`, 30, 56, 18, "#ffffff");
    text(draw, `KILLS ${g.kills}`, 250, 56, 16, "#c8ff9a");
    panel(draw, 560, 12, 386, 58, "rgba(20,10,35,0.62)");
    text(draw, `PLANET HP ${Math.max(0, 3 - g.planetHits)}/3`, 576, 32, 18, "#e6b3ff");
    text(draw, `HULL HP ${Math.max(0, 3 - g.crashes)}/3`, 576, 56, 18, "#ffb3a0");
    if (g.hasStar) {
      panel(draw, 330, 78, 300, 36, "rgba(90,60,0,0.75)");
      text(draw, "STAR LOADED - SPACE!", W / 2, 96, 17, "#ffd23f", "center");
    } else {
      text(draw, "Arrows/WASD fire + recoil  •  bounce shots off asteroids", W / 2, 92, 14, "rgba(255,255,255,0.75)", "center");
    }
    // timer bar
    draw.setFillStyle("rgba(255,255,255,0.2)"); draw.fillRect(14, 74, 932, 6);
    draw.setFillStyle("#ffd23f"); draw.fillRect(14, 74, 932 * (g.elapsed / TOTAL), 6);
  }

  if (g.scene === "title") {
    draw.setFillStyle("rgba(10,6,25,0.35)"); draw.fillRect(0, 0, W, H);
    const bounceX = dsin(g.frame * 0.025) * 90;
    text(draw, "RECOIL ROCKET", W / 2 + bounceX * 0.25, 108 + Math.abs(dsin(g.frame * 0.06)) * -10, 68, "#ffd23f", "center", "bangers");
    text(draw, "Your cannon is your engine!", W / 2, 168, 24, "#ffffff", "center");
    panel(draw, 240, 188, 480, 118, "rgba(15,8,30,0.68)");
    text(draw, "Arrows / WASD: fire that way,", W / 2, 214, 19, "#ffe9c0", "center");
    text(draw, "get kicked the opposite way!", W / 2, 240, 19, "#ffe9c0", "center");
    text(draw, "Bounce shots off asteroids • Catch stars", W / 2, 266, 17, "#c8ff9a", "center");
    text(draw, "SPACE: Star Cannon  •  Protect planet 90s", W / 2, 290, 17, "#e6b3ff", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "PRESS ENTER OR SPACE TO LAUNCH", W / 2, 470, 24, "#ffffff", "center");
    text(draw, "3 aliens hitting planet — or 3 crashes — and it's over", W / 2, 505, 15, "#ffb3c0", "center");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(10,20,10,0.55)"); draw.fillRect(0, 0, W, H);
    text(draw, "YOU SAVED THE PLANET!", W / 2, 190, 52, "#7CFC9A", "center", "bangers");
    text(draw, `Score ${g.score}  •  Kills ${g.kills}  •  Planet hits ${g.planetHits}  •  Crashes ${g.crashes}`, W / 2, 260, 22, "#ffffff", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER TO PLAY AGAIN", W / 2, 340, 24, "#ffd23f", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(30,5,15,0.60)"); draw.fillRect(0, 0, W, H);
    text(draw, "THE PLANET WAS", W / 2, 160, 48, "#ff8a8a", "center", "bangers");
    text(draw, "OVERWHELMED.", W / 2, 215, 48, "#ff8a8a", "center", "bangers");
    text(draw, `Score ${g.score}  •  Survived ${Math.floor(g.elapsed / 60)}s  •  Kills ${g.kills}`, W / 2, 285, 22, "#ffffff", "center");
    if (Math.floor(g.frame / 28) % 2 === 0) text(draw, "ENTER TO TRY AGAIN", W / 2, 355, 24, "#ffd23f", "center");
  }
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Recoil Rocket" },
  clear: { r: 0.15, g: 0.09, b: 0.27 },
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
        let h = g.frame * 31 + g.score * 7 + g.crashes * 13 + g.planetHits * 17 + Math.round(g.x * 10) + Math.round(g.y * 10);
        for (const a of g.aliens) h = (Math.imul(h, 16777619) ^ Math.round(a.y * 10 + a.x)) >>> 0;
        for (const b of g.bullets) h = (Math.imul(h, 16777619) ^ Math.round(b.x + b.y * 3)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.scene === "won" ? 1 : Math.max(0, Math.min(0.98, (g.elapsed / TOTAL) * 0.85 + Math.min(0.13, g.kills * 0.004) - g.planetHits * 0.09 - g.crashes * 0.09)), scene: g.scene, score: g.score, lives: 3 - Math.max(g.planetHits, g.crashes), planetHits: g.planetHits, crashes: g.crashes, elapsed: g.elapsed }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
