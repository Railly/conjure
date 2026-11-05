import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { createChecksum } from "dotframe/src/checksum";
import { dsin, dcos } from "dotframe/src/detmath";
import { stepBodies, FIXED_STEP, type Body, type Solid } from "dotframe/src/physics";
import type { Texture } from "dotframe/src/gpu";

const W = 960, H = 540;
const GROUND = 80, HILL_TOP = 170, HILL_X = 790;
const TREE_X = 250;
const DOOR_X = 862;
const GAME_FRAMES = 90 * 60;

const L = 1, R = 2, U = 4, D = 8, FIRE = 16, ENTER = 32;

interface HB { width: number; height: number; parts: { x: number; y: number; halfWidth: number; halfHeight: number }[] }
interface Img { tex: Texture | null; w: number; h: number }
interface Branch { y: number; dir: number; len: number; target: number; age: number; id: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; kind: number } //0 leaf 1 dust 2 heat 3 smoke 4 spark
interface FloatText { x: number; y: number; life: number; text: string; color: string }

interface State {
  phase: "title" | "playing" | "won" | "lost";
  frame: number; playFrame: number; rng: number; held: number;
  sunX: number; sunY: number; angle: number; // radians from vertical, + right
  cooldown: number; holdTime: number; rayT: number; rayX: number; rayY: number; rayKind: number;
  lives: number; branchesGrown: number; branchId: number; heat: number; heatT: number; carRollT: number;
  shake: number; flash: number; catRot: number; catSquash: number; meowT: number; climbT: number;
  score: number; loseReason: string; winFrame: number; smokeT: number;
  branches: Branch[]; particles: Particle[]; texts: FloatText[];
  cat: Body; car: Body;
}

function nextRand(s: State): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
function pngSize(b: Uint8Array): { w: number; h: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}
function scaledParts(hb: HB, drawW: number): Solid[] {
  const s = drawW / hb.width;
  return hb.parts.map(p => ({ x: p.x * s, y: p.y * s, halfWidth: p.halfWidth * s, halfHeight: p.halfHeight * s }));
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "El Sol Empuja al Gato a Casa" },
  options: {},
  neutral: 0,
  rollbackWindow: 20,
  encode: (input: unknown): number => {
    const i = input as { left?: boolean; right?: boolean; up?: boolean; down?: boolean; space?: boolean; fire?: boolean; enter?: boolean; a?: boolean; d?: boolean; w?: boolean; s?: boolean };
    return (i.left || i.a ? L : 0) | (i.right || i.d ? R : 0) | (i.up || i.w ? U : 0) | (i.down || i.s ? D : 0) | (i.space || i.fire ? FIRE : 0) | (i.enter ? ENTER : 0);
  },
  random: (next: () => number): number => {
    let b = 0;
    const v = next();
    if (v < 0.3) b |= L; else if (v < 0.6) b |= R;
    if (next() < 0.25) b |= U; else if (next() < 0.2) b |= D;
    if (next() < 0.45) b |= FIRE;
    if (next() < 0.08) b |= ENTER;
    return b;
  },
  create: (platform: SimPlatform): SimRun => {
    const images: Record<string, Img> = {};
    const hitboxes: Record<string, HB> = {};
    let catParts: Solid[] = [], carParts: Solid[] = [];

    const ready = (async () => {
      const names = ["cat", "sun", "tree", "house", "car"];
      for (const n of names) {
        const hbBytes = await platform.load(`assets/${n}.hitbox.json`);
        hitboxes[n] = JSON.parse(new TextDecoder().decode(hbBytes)) as HB;
        const bytes = await platform.load(`assets/${n}.png`);
        const size = pngSize(bytes);
        let tex: Texture | null = null;
        if (platform.image) tex = await platform.image(bytes, true);
        images[n] = { tex, w: size.w, h: size.h };
      }
      catParts = scaledParts(hitboxes.cat, 84);
      carParts = scaledParts(hitboxes.car, 150);
      if (platform.draw && platform.image) {
        platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json")));
        platform.draw.addFont(["bangers", "sans-serif"], await platform.image(await platform.load("assets/fonts/bangers.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/bangers.json")));
      }
    })();

    function makeBody(x: number, y: number, hw: number, hh: number, parts: Solid[], pushable: boolean): Body {
      return { position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, halfWidth: hw, halfHeight: hh, onGround: false, parts, pushable };
    }
    function fresh(seed: number): State {
      const s: State = {
        phase: "title", frame: 0, playFrame: 0, rng: (seed >>> 0) || 12345, held: 0,
        sunX: 240, sunY: 462, angle: 0.15, cooldown: 0, holdTime: 0, rayT: 0, rayX: 240, rayY: 100, rayKind: 0,
        lives: 3, branchesGrown: 0, branchId: 1, heat: 0, heatT: 0, carRollT: 0,
        shake: 0, flash: 0, catRot: 0, catSquash: 0, meowT: 0, climbT: 0, score: 0, loseReason: "", winFrame: 0, smokeT: 0,
        branches: [], particles: [], texts: [],
        cat: makeBody(335, GROUND + 31, 42, 31, catParts, true),
        car: makeBody(565, GROUND + 45, 75, 45, carParts, true),
      };
      return s;
    }
    let g: State = fresh(1);

    function addText(x: number, y: number, text: string, color: string) {
      // Same message alive nearby = refresh it instead of stacking a ghost copy.
      for (const ft of g.texts) {
        if (ft.text === text && Math.abs(ft.x - x) < 120 && Math.abs(ft.y - y) < 70) {
          ft.life = 70; ft.x = x; ft.y = y; return;
        }
      }
      g.texts.push({ x, y, life: 70, text, color });
      if (g.texts.length > 8) g.texts.shift();
    }
    function burst(x: number, y: number, n: number, kind: number, speed: number) {
      for (let i = 0; i < n; i++) {
        const a = nextRand(g) * 6.283; const sp = speed * (0.3 + nextRand(g) * 0.9);
        g.particles.push({ x, y, vx: dcos(a) * sp, vy: Math.abs(dsin(a) * sp) * (kind === 3 ? 1 : 0.7) + (kind === 3 ? 35 : 20), life: 0, max: 35 + nextRand(g) * 45, size: 3 + nextRand(g) * 6, kind });
      }
      if (g.particles.length > 260) g.particles.splice(0, g.particles.length - 260);
    }
    function solids(): Solid[] {
      const list: Solid[] = [
        { x: W / 2, y: GROUND / 2, halfWidth: W / 2, halfHeight: GROUND / 2 },
        { x: (HILL_X + W) / 2, y: HILL_TOP / 2, halfWidth: (W - HILL_X) / 2, halfHeight: HILL_TOP / 2 },
        { x: TREE_X, y: 105, halfWidth: 16, halfHeight: 25 },
      ];
      // Branches are sweeps that shove (impulse at sprout), not platforms: listing them as solids trapped the cat between branch and car.
      return list;
    }

    function fireRay() {
      g.cooldown = 44;
      const power = clamp(0.65 + g.holdTime / 70, 0.65, 1.35);
      const jitter = g.playFrame > 1800 ? (nextRand(g) - 0.5) * 0.08 : 0;
      const a = g.angle + jitter;
      const dx = dsin(a), dy = -dcos(a);
      // step along ray, first hit wins
      let hitKind = 0, hx = g.sunX + dx * 620, hy = g.sunY + dy * 620;
      for (let t = 8; t < 640; t += 4) {
        const x = g.sunX + dx * t, y = g.sunY + dy * t;
        let k = 0;
        const cdx = (x - g.cat.position.x) / 40, cdy = (y - g.cat.position.y) / 34;
        if (cdx * cdx + cdy * cdy < 1) k = 1;
        else if (Math.abs(x - g.car.position.x) < 74 && Math.abs(y - g.car.position.y) < 46) k = 3;
        else if (Math.abs(x - TREE_X) < 64 && y > 82 && y < 292) k = 2;
        else if (y <= GROUND || (x >= HILL_X && y <= HILL_TOP)) k = 4;
        if (k) { hitKind = k; hx = x; hy = y; break; }
        hx = x; hy = y;
      }
      g.rayT = 16; g.rayX = hx; g.rayY = hy; g.rayKind = hitKind;
      burst(hx, hy, 5, 2, 55);
      if (hitKind === 1) {
        g.lives--; g.flash = 14; g.shake = Math.max(g.shake, 7); g.catSquash = 12;
        g.cat.velocity = { x: g.cat.velocity.x - 90, y: 360, z: 0 };
        burst(g.cat.position.x, g.cat.position.y + 20, 14, 4, 130);
        addText(g.cat.position.x, g.cat.position.y + 62, "AY! NO AL GATO!", "#c22e00");
        if (g.lives <= 0) { g.phase = "lost"; g.loseReason = "El gato se erizo tres veces"; }
      } else if (hitKind === 2) {
        const dir = dx >= -0.05 ? 1 : -1;
        // Branches sprout in a readable low -> mid -> high cycle, so every shot at the tree visibly helps.
        const heights = [108, 154, 198, 128, 174, 222];
        const by = heights[g.branchesGrown % heights.length] + (nextRand(g) - 0.5) * 10;
        let target = (175 + nextRand(g) * 125) * power;
        // A sprout grows until it reaches the cat (when he is in front of it), so a tree shot always visibly shoves him.
        if (dir > 0 && g.cat.position.x > TREE_X) target = Math.max(target, Math.min(g.cat.position.x - TREE_X + 55, 445));
        if (dir < 0 && g.cat.position.x < TREE_X) target = Math.max(target, Math.min(TREE_X - g.cat.position.x + 55, 445));
        g.branches.push({ y: by, dir, len: 8, target, age: 0, id: g.branchId++ });
        if (g.branches.length > 6) g.branches.shift();
        g.branchesGrown++;
        burst(TREE_X + dir * 30, by, 16, 0, 110);
        addText(TREE_X + dir * 60, by + 34, "POP! RAMA!", "#2e7d1e");
        if (target > 210) g.shake = Math.max(g.shake, 3.5);
        // the growing sweep nudges a cat caught in its path
        const tip = TREE_X + dir * target;
        const inX = dir > 0 ? (g.cat.position.x > TREE_X - 20 && g.cat.position.x < tip + 30) : (g.cat.position.x < TREE_X + 20 && g.cat.position.x > tip - 30);
        if (inX && Math.abs(g.cat.position.y - by) < 118) {
          g.cat.velocity = { x: dir * Math.max(Math.abs(g.cat.velocity.x), 230 * power), y: Math.max(g.cat.velocity.y, by > 150 ? 260 : 185), z: 0 };
          g.meowT = 50;
        }
      } else if (hitKind === 3) {
        g.heat = Math.min(3, g.heat + 1); g.heatT = 720;
        burst(g.car.position.x, g.car.position.y + 42, 10, 2, 80);
        const catOnCar = Math.abs(g.cat.position.x - g.car.position.x) < 82 && Math.abs((g.cat.position.y - 31) - (g.car.position.y + 45)) < 24;
        if (catOnCar) {
          g.cat.velocity = { x: g.cat.velocity.x + 200, y: 505, z: 0 }; g.meowT = 55; g.shake = Math.max(g.shake, 4);
          addText(g.car.position.x, g.car.position.y + 86, "BOING! TRAMPOLIN!", "#b34700");
        } else if (g.heat >= 2) {
          if (g.carRollT <= 0) addText(g.car.position.x, g.car.position.y + 84, "COCHE CALIENTE!", "#b34700");
          g.carRollT = 95;
        } else {
          addText(g.car.position.x, g.car.position.y + 84, "CALENTANDO...", "#b34700");
        }
      } else if (hitKind === 4) {
        burst(hx, hy, 6, 1, 60);
      }
    }

    function stepPlaying(bits: number) {
      g.playFrame++;
      const t = g.playFrame / GAME_FRAMES;
      // sun drift toward sunset, faster late
      const drift = 5 + t * t * 46;
      g.sunX += drift * FIXED_STEP;
      g.sunY = 462 - t * 118;
      if (bits & L) g.sunX -= 275 * FIXED_STEP;
      if (bits & R) g.sunX += 275 * FIXED_STEP;
      g.sunX = clamp(g.sunX, 55, 905);
      if (bits & U) g.angle = clamp(g.angle - 1.7 * FIXED_STEP, -0.96, 0.96);
      if (bits & D) g.angle = clamp(g.angle + 1.7 * FIXED_STEP, -0.96, 0.96);
      if (g.cooldown > 0) g.cooldown--;
      if (bits & FIRE) { g.holdTime = Math.min(90, g.holdTime + 1); if (g.cooldown <= 0) fireRay(); }
      else g.holdTime = 0;

      // branches grow
      for (const b of g.branches) { b.age++; if (b.len < b.target) b.len = Math.min(b.target, b.len + 330 * FIXED_STEP); }
      g.branches = g.branches.filter(b => b.age < 60 * 16);

      // car heat / rolling
      if (g.heatT > 0) { g.heatT--; if (g.heatT === 0) g.heat = 0; }
      const carPrevX = g.car.position.x;
      if (g.carRollT > 0) { g.carRollT--; g.car.velocity = { x: 175, y: g.car.velocity.y, z: 0 }; }
      else if (g.car.onGround) g.car.velocity = { x: g.car.velocity.x * (1 - 3 * FIXED_STEP), y: g.car.velocity.y, z: 0 };
      // cat rolling friction
      if (g.cat.onGround) g.cat.velocity = { x: g.cat.velocity.x * (1 - 1.15 * FIXED_STEP), y: g.cat.velocity.y, z: 0 };

      const preVx = g.cat.velocity.x;
      stepBodies([g.cat, g.car], solids(), -900, FIXED_STEP);
      // A fast-rolling cat scrabbles up onto the hot car bonnet instead of stopping dead against it.
      if (g.climbT > 0) g.climbT--;
      const dxCar = g.car.position.x - g.cat.position.x;
      if (g.climbT === 0 && g.heat >= 2 && dxCar > 45 && dxCar < 125 && g.cat.position.y < g.car.position.y + 55 && preVx > 110) {
        g.cat.velocity = { x: g.cat.velocity.x * 0.82, y: 405, z: 0 }; g.climbT = 45; g.meowT = 45;
        burst(g.cat.position.x + 30, g.cat.position.y - 20, 6, 1, 60); addText(g.cat.position.x, g.cat.position.y + 62, "TREPA!", "#7a4a12");
      }
      // car hitting hill / wall = crayon dust
      if (Math.abs(g.car.velocity.x) < 4 && g.carRollT > 55 && g.car.position.x > HILL_X - 90) { /* stopped */ }
      if (g.car.position.x > HILL_X - 78 && carPrevX <= HILL_X - 78) { burst(g.car.position.x + 70, GROUND + 8, 12, 1, 90); g.shake = Math.max(g.shake, 4); addText(g.car.position.x, g.car.position.y + 80, "PUF! RAMPA LISTA!", "#7a4a12"); g.carRollT = 0; }
      g.car.position = { x: clamp(g.car.position.x, 80, HILL_X - 76), y: clamp(g.car.position.y, 40, 400), z: 0 };
      if (g.car.position.x >= HILL_X - 77) g.car.velocity = { x: 0, y: g.car.velocity.y, z: 0 };
      g.cat.position = { x: clamp(g.cat.position.x, 34, 928), y: clamp(g.cat.position.y, 45, 500), z: 0 };
      if (g.cat.position.y < 60) g.cat.position = { x: g.cat.position.x, y: 115, z: 0 };
      g.catRot += g.cat.velocity.x * FIXED_STEP / 34;
      if (g.catSquash > 0) g.catSquash--;
      if (g.meowT > 0) g.meowT--;
      const speed = Math.sqrt(g.cat.velocity.x * g.cat.velocity.x + g.cat.velocity.y * g.cat.velocity.y);
      if (speed > 330 && g.cat.onGround && g.playFrame % 50 === 0) addText(g.cat.position.x, g.cat.position.y + 58, "MIAU!", "#7a2d8a");

      // win: gentle arrival at the door, on the hill
      if (g.cat.onGround && g.cat.position.x > 818 && g.cat.position.y > HILL_TOP - 6 && g.cat.position.y < HILL_TOP + 95) {
        if (speed < 360) {
          g.phase = "won"; g.winFrame = g.playFrame;
          g.score = 1000 + Math.round((1 - t) * 900) + g.lives * 150 + g.branchesGrown * 10;
          burst(DOOR_X, HILL_TOP + 70, 22, 4, 120);
        } else if (g.cat.velocity.x > 0) {
          g.cat.velocity = { x: -Math.abs(g.cat.velocity.x) * 0.45, y: 180, z: 0 };
          addText(DOOR_X - 40, HILL_TOP + 105, "SUAVE...!", "#c22e00"); g.shake = Math.max(g.shake, 3);
        }
      }
      if (g.playFrame >= GAME_FRAMES && g.phase === "playing") { g.phase = "lost"; g.loseReason = "Cayo el ocaso"; }
      g.score = Math.max(g.score, Math.round(clamp((g.cat.position.x - 300) / (DOOR_X - 300), 0, 1) * 500) + g.branchesGrown * 10);
    }

    function stepCommon() {
      if (g.rayT > 0) g.rayT--;
      if (g.flash > 0) g.flash--;
      g.shake *= 0.88; if (g.shake < 0.05) g.shake = 0;
      for (const p of g.particles) { p.life++; p.x += p.vx * FIXED_STEP; p.y += p.vy * FIXED_STEP; p.vy -= (p.kind === 3 ? -12 : 130) * FIXED_STEP; if (p.kind === 3) p.vy = 42; }
      g.particles = g.particles.filter(p => p.life < p.max);
      for (const ft of g.texts) { ft.life--; ft.y += 22 * FIXED_STEP; }
      g.texts = g.texts.filter(ft => ft.life > 0);
      if (g.phase === "won") {
        g.smokeT++;
        if (g.smokeT % 9 === 0) g.particles.push({ x: 905, y: 302, vx: (nextRand(g) - 0.5) * 14, vy: 48, life: 0, max: 80, size: 6 + nextRand(g) * 7, kind: 3 });
      }
    }

    function startGame() { const f = g.frame; g = fresh(g.rng); g.frame = f; g.phase = "playing"; }

    // ---------- render ----------
    function drawImg(draw: any, name: string, cx: number, cyWorld: number, w: number, h: number, rot = 0, sx = 1, sy = 1, alpha = 1) {
      const im = images[name]; if (!im || !im.tex) { draw.setFillStyle("#f2b705"); draw.fillRect(cx - w / 2, H - cyWorld - h / 2, w, h); return; }
      draw.save(); draw.translate(cx, H - cyWorld); draw.rotate(rot); draw.scale(sx, sy); draw.setGlobalAlpha(alpha);
      draw.drawImage(im.tex, 0, 0, im.w, im.h, -w / 2, -h / 2, w, h);
      draw.setGlobalAlpha(1); draw.restore();
    }
    function text(draw: any, s: string, x: number, y: number, size: number, color: string, align = "center", font = "archivo black") {
      draw.setFont(`${size}px "${font}", sans-serif`); draw.setTextAlign(align); draw.setTextBaseline("middle"); draw.setFillStyle(color); draw.fillText(s, x, y);
    }
    function render(draw: any) {
      const t = g.phase === "title" ? 0 : clamp(g.playFrame / GAME_FRAMES, 0, 1);
      const shX = g.shake ? dsin(g.frame * 1.7) * g.shake : 0, shY = g.shake ? dcos(g.frame * 2.3) * g.shake * 0.6 : 0;
      draw.save(); draw.translate(shX, shY);
      // notebook sky, yellow palette darkening to sunset
      const bands = ["#fff3a6", "#ffe97a", "#ffdf52", "#ffd23e", "#ffb52e", "#ff8f3d"];
      const bi = Math.min(bands.length - 1, Math.floor(t * bands.length));
      draw.setFillStyle(bands[bi]); draw.fillRect(-10, -10, W + 20, H + 20);
      draw.setFillStyle("#fff8cf"); draw.fillRect(-10, -10, W + 20, 120 - t * 60);
      // ruled notebook lines + margin
      draw.setStrokeStyle("rgba(90,140,200,0.20)"); draw.setLineWidth(1);
      for (let y = 42; y < H; y += 30) { draw.beginPath(); draw.moveTo(0, y); draw.lineTo(W, y); draw.stroke(); }
      draw.setStrokeStyle("rgba(230,80,80,0.28)"); draw.beginPath(); draw.moveTo(46, 0); draw.lineTo(46, H); draw.stroke();
      // distant hills (parallax layers, static crayon shapes)
      draw.setFillStyle("rgba(245,197,66,0.55)");
      draw.beginPath(); draw.ellipse(170, 468, 260, 62, 0, 0, 6.29, false); draw.fill();
      draw.beginPath(); draw.ellipse(760, 478, 300, 72, 0, 0, 6.29, false); draw.fill();
      draw.setFillStyle("#e9b949");
      draw.beginPath(); draw.ellipse(430, 492, 330, 58, 0, 0, 6.29, false); draw.fill();
      // ground & hill
      draw.setFillStyle("#d99a26"); draw.fillRect(-10, H - GROUND, W + 20, GROUND + 10);
      draw.setFillStyle("#c6861a"); draw.fillRect(HILL_X, H - HILL_TOP, W - HILL_X + 10, HILL_TOP - GROUND);
      draw.setStrokeStyle("#8a5a10"); draw.setLineWidth(3); draw.beginPath(); draw.moveTo(0, H - GROUND); draw.lineTo(W, H - GROUND); draw.stroke();
      draw.beginPath(); draw.moveTo(HILL_X, H - HILL_TOP); draw.lineTo(W, H - HILL_TOP); draw.stroke();
      draw.setStrokeStyle("rgba(120,70,10,0.5)"); draw.setLineWidth(2);
      for (let x = 20; x < W; x += 46) { draw.beginPath(); draw.moveTo(x, H - GROUND + 18); draw.lineTo(x + 18, H - GROUND + 18); draw.stroke(); }
      // arrow hint to door
      if (g.phase === "playing" && g.playFrame < 700) {
        draw.setFillStyle("rgba(140,70,0,0.75)"); text(draw, "LA PUERTA ->", 692, 252, 15, "rgba(140,70,0,0.85)");
      }

      // branches: crayon limbs, tapered with wavy edges, hatch grain, scribble leaf tufts
      for (const b of g.branches) {
        const grow = clamp(b.len / Math.max(b.target, 1), 0, 1);
        const tipX = TREE_X + b.dir * b.len;
        const cy = H - b.y;
        const SEG = 9;
        const wob = (i: number, side: number) => dsin(i * 2.4 + b.id * 1.7 + side * 2.1) * 2.2;
        const half = (f: number) => 9.5 * (1 - f) + 3.5 * f;
        // soft crayon shadow under the limb
        draw.setFillStyle("rgba(120,70,10,0.18)");
        draw.beginPath();
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy + 4 + (half(f) + 2);
          if (i === 0) draw.moveTo(x, y); else draw.lineTo(x, y);
        }
        for (let i = SEG; i >= 0; i--) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy + 4 - (half(f) + 2);
          draw.lineTo(x, y);
        }
        draw.fill();
        // bark body
        draw.setFillStyle("#8f5c26");
        draw.beginPath();
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy + half(f) + wob(i, 0);
          if (i === 0) draw.moveTo(x, y); else draw.lineTo(x, y);
        }
        for (let i = SEG; i >= 0; i--) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy - half(f) + wob(i, 1);
          draw.lineTo(x, y);
        }
        draw.fill();
        // round growing tip
        draw.setFillStyle("#8f5c26");
        draw.beginPath(); draw.arc(tipX, cy, half(1) + 1.5, 0, 6.29, false); draw.fill();
        // crayon grain: short diagonal hatch strokes along the limb
        for (let i = 0; i < 12; i++) {
          const f = 0.06 + (i / 12) * 0.88;
          const jx = dsin(b.id * 12.9 + i * 7.3) * half(f) * 0.55;
          const x = TREE_X + b.dir * b.len * f, y = cy + jx;
          draw.setStrokeStyle(i % 2 ? "rgba(107,66,26,0.65)" : "rgba(200,150,85,0.6)");
          draw.setLineWidth(1.6);
          draw.beginPath(); draw.moveTo(x - b.dir * 3, y - 4); draw.lineTo(x + b.dir * 3, y + 4); draw.stroke();
        }
        // wavy bark outline, top and bottom
        draw.setStrokeStyle("rgba(90,52,16,0.85)"); draw.setLineWidth(2);
        draw.beginPath();
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy + half(f) + wob(i, 0);
          if (i === 0) draw.moveTo(x, y); else draw.lineTo(x, y);
        }
        draw.stroke();
        draw.beginPath();
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG, x = TREE_X + b.dir * b.len * f, y = cy - half(f) + wob(i, 1);
          if (i === 0) draw.moveTo(x, y); else draw.lineTo(x, y);
        }
        draw.stroke();
        // scribble leaf tuft at the tip + small buds along the limb
        if (grow > 0.25) {
          const tuft = clamp((grow - 0.25) / 0.5, 0, 1);
          const leafAt = (lx: number, ly: number, r: number, col: string) => {
            draw.setStrokeStyle(col); draw.setLineWidth(2.2);
            draw.beginPath(); draw.arc(lx, ly, r * tuft, 0, 6.29, false); draw.stroke();
            draw.beginPath(); draw.arc(lx, ly, r * 0.55 * tuft, 0, 6.29, false); draw.stroke();
          };
          leafAt(tipX, cy - 12, 12, "#2e9e4a");
          leafAt(tipX - b.dir * 13, cy + 7, 9, "#57c46a");
          leafAt(tipX + b.dir * 9, cy + 9, 7, "#2e9e4a");
          const budF = 0.45 + (b.id % 3) * 0.16;
          const bx = TREE_X + b.dir * b.len * budF;
          draw.setFillStyle("#57c46a");
          draw.beginPath(); draw.arc(bx, cy - half(budF) - 5, 5, 0, 6.29, false); draw.fill();
          draw.setStrokeStyle("#2e7d3a"); draw.setLineWidth(1.6);
          draw.beginPath(); draw.arc(bx, cy - half(budF) - 5, 5, 0, 6.29, false); draw.stroke();
        }
      }
      // tree, house, car
      drawImg(draw, "tree", TREE_X, GROUND + 66, 132, 148);
      // house door state
      drawImg(draw, "house", 868, HILL_TOP + 72, 148, 155);
      if (g.phase === "won") {
        draw.setFillStyle("#5a3410"); draw.fillRect(838, H - HILL_TOP - 62, 30, 62);
        draw.setFillStyle("#ffd94d"); draw.beginPath(); draw.arc(866, H - HILL_TOP - 32, 4, 0, 6.29, false); draw.fill();
        // cat face in window
        drawImg(draw, "cat", 838, HILL_TOP + 60, 52, 40);
      }
      // car with layered heat glow + rising shimmer wisps
      if (g.heat > 0 && g.phase === "playing") {
        const pulse = 1 + dsin(g.frame * 0.3) * 0.08;
        draw.setFillStyle("rgba(255,110,20,0.10)"); draw.beginPath(); draw.ellipse(g.car.position.x, H - g.car.position.y, 92 * pulse, 58 * pulse, 0, 0, 6.29, false); draw.fill();
        draw.setFillStyle("rgba(255,135,30,0.13)"); draw.beginPath(); draw.ellipse(g.car.position.x, H - g.car.position.y, 68 * pulse, 43 * pulse, 0, 0, 6.29, false); draw.fill();
        draw.setFillStyle("rgba(255,185,70,0.15)"); draw.beginPath(); draw.ellipse(g.car.position.x, H - g.car.position.y, 46 * pulse, 29 * pulse, 0, 0, 6.29, false); draw.fill();
        draw.setStrokeStyle("rgba(255,120,20,0.55)"); draw.setLineWidth(2);
        for (let i = 0; i < 3; i++) {
          const wx = g.car.position.x - 34 + i * 34 + dsin(g.frame * 0.25 + i * 2.1) * 4;
          const wy = H - g.car.position.y - 52 - (i % 2) * 6;
          draw.beginPath(); draw.moveTo(wx, wy);
          draw.lineTo(wx + dsin(g.frame * 0.4 + i) * 4, wy - 8);
          draw.lineTo(wx + dsin(g.frame * 0.4 + i + 1) * 4, wy - 16);
          draw.stroke();
        }
      }
      const carBounce = g.carRollT > 0 ? dsin(g.frame * 0.9) * 2 : 0;
      drawImg(draw, "car", g.car.position.x, g.car.position.y + carBounce, 150, 92, 0, 1, 1);

      // cat (hidden inside on win)
      if (g.phase !== "won") {
        const sp = Math.abs(g.cat.velocity.x);
        const sq = clamp(sp / 500, 0, 0.28) + (g.catSquash > 0 ? 0.18 : 0);
        const flashA = g.flash > 0 && (g.frame % 6 < 3) ? 0.45 : 1;
        drawImg(draw, "cat", g.cat.position.x, g.cat.position.y, 88, 66, dsin(g.catRot) * 0.38, 1 + sq, 1 - sq * 0.7, flashA);
        if (g.meowT > 25) text(draw, "MIAU!", g.cat.position.x + 34, H - g.cat.position.y - 48, 16, "#7a2d8a", "left", "bangers");
      }

      // aim guide + sun
      const sunBlink = g.phase === "title" ? 1 + dsin(g.frame * 0.08) * 0.06 : 1;
      const sleepy = g.phase === "lost";
      const sunDrawY = sleepy ? 150 : g.sunY;
      if (g.phase === "playing") {
        const dx = dsin(g.angle), dy = -dcos(g.angle);
        draw.setFillStyle("rgba(190,100,0,0.45)");
        for (let d = 30; d <= 210; d += 24) {
          const r = 4.6 * (1 - d / 270);
          draw.beginPath(); draw.arc(g.sunX + dx * d, H - (g.sunY + dy * d), r, 0, 6.29, false); draw.fill();
        }
      }
      if (g.rayT > 0) {
        const dx = g.rayX - g.sunX, dy = g.rayY - g.sunY; const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const off = (f: number, amp: number) => dsin(f * 9.0 - g.frame * 0.55) * amp;
        // soft outer halo, straight
        draw.setStrokeStyle("rgba(255,140,0,0.26)"); draw.setLineWidth(17);
        draw.beginPath(); draw.moveTo(g.sunX, H - g.sunY); draw.lineTo(g.rayX, H - g.rayY); draw.stroke();
        draw.setFillStyle("rgba(255,140,0,0.26)");
        draw.beginPath(); draw.arc(g.sunX, H - g.sunY, 8.5, 0, 6.29, false); draw.fill();
        draw.beginPath(); draw.arc(g.rayX, H - g.rayY, 8.5, 0, 6.29, false); draw.fill();
        // mid beam, gentle single-wave wobble
        draw.setStrokeStyle("#ff9d00"); draw.setLineWidth(8);
        draw.beginPath();
        for (let i = 0; i <= 8; i++) {
          const f = i / 8, x = g.sunX + dx * f + nx * off(f, 2.6), y = g.sunY + dy * f + ny * off(f, 2.6);
          if (i === 0) draw.moveTo(x, H - y); else draw.lineTo(x, H - y);
        }
        draw.stroke();
        // white-hot core, its own path
        draw.setStrokeStyle("#fff6c8"); draw.setLineWidth(3);
        draw.beginPath();
        for (let i = 0; i <= 8; i++) {
          const f = i / 8, x = g.sunX + dx * f + nx * off(f, 2.0), y = g.sunY + dy * f + ny * off(f, 2.0);
          if (i === 0) draw.moveTo(x, H - y); else draw.lineTo(x, H - y);
        }
        draw.stroke();
        // impact bloom at the hit point
        const pulse = 1 + dsin(g.frame * 0.5) * 0.15;
        const fade = clamp(g.rayT / 16, 0, 1);
        draw.setGlobalAlpha(fade);
        draw.setFillStyle("rgba(255,150,20,0.30)"); draw.beginPath(); draw.arc(g.rayX, H - g.rayY, 24 * pulse, 0, 6.29, false); draw.fill();
        draw.setFillStyle("rgba(255,190,70,0.45)"); draw.beginPath(); draw.arc(g.rayX, H - g.rayY, 14 * pulse, 0, 6.29, false); draw.fill();
        draw.setFillStyle("#fff3c0"); draw.beginPath(); draw.arc(g.rayX, H - g.rayY, 6 * pulse, 0, 6.29, false); draw.fill();
        draw.setGlobalAlpha(1);
      }
      const sunDrawX = g.phase === "title" ? 112 : g.sunX;
      drawImg(draw, "sun", sunDrawX, sunDrawY, 112 * sunBlink, 100 * sunBlink, sleepy ? 0.25 : dsin(g.frame * 0.02) * 0.05);
      if (sleepy) text(draw, "Z z z", sunDrawX + 56, H - sunDrawY - 42, 22, "#6b4a00", "left", "bangers");

      // particles
      for (const p of g.particles) {
        const a = clamp(1 - p.life / p.max, 0, 1); draw.setGlobalAlpha(a);
        if (p.kind === 0) { draw.setFillStyle("#35a745"); draw.beginPath(); draw.ellipse(p.x, H - p.y, p.size, p.size * 0.55, p.life * 0.1, 0, 6.29, false); draw.fill(); }
        else if (p.kind === 3) { draw.setFillStyle("#ffffff"); draw.beginPath(); draw.arc(p.x, H - p.y, p.size + p.life * 0.12, 0, 6.29, false); draw.fill(); }
        else if (p.kind === 2) { draw.setFillStyle("#ff8a00"); draw.beginPath(); draw.arc(p.x, H - p.y, p.size * 0.7, 0, 6.29, false); draw.fill(); }
        else if (p.kind === 4) { draw.setFillStyle("#ffcf2e"); draw.fillRect(p.x - p.size / 2, H - p.y - p.size / 2, p.size, p.size); }
        else { draw.setFillStyle("#b07a2a"); draw.beginPath(); draw.arc(p.x, H - p.y, p.size * 0.6, 0, 6.29, false); draw.fill(); }
      }
      draw.setGlobalAlpha(1);
      for (const ft of g.texts) {
        draw.setGlobalAlpha(clamp(ft.life / 40, 0, 1));
        draw.setFont(`17px "bangers", sans-serif`); draw.setTextAlign("center"); draw.setTextBaseline("middle");
        draw.setStrokeStyle("rgba(255,250,220,0.9)"); draw.setLineWidth(4); draw.strokeText(ft.text, ft.x, H - ft.y);
        draw.setFillStyle(ft.color); draw.fillText(ft.text, ft.x, H - ft.y);
      }
      draw.setGlobalAlpha(1);
      draw.restore();

      if (g.flash > 0) { draw.setFillStyle("rgba(255,60,0,0.14)"); draw.fillRect(0, 0, W, H); }

      // HUD
      if (g.phase === "playing" || g.phase === "won") {
        draw.setFillStyle("rgba(255,248,200,0.92)"); draw.fillRect(12, 10, 348, 70);
        draw.setStrokeStyle("#8a5a10"); draw.setLineWidth(2); draw.strokeRect(12, 10, 348, 70);
        text(draw, "BIGOTES", 24, 27, 13, "#6b3d00", "left");
        for (let i = 0; i < 3; i++) {
          const x = 124 + i * 66, y = 21, on = i < g.lives;
          draw.setStrokeStyle(on ? "#222222" : "rgba(0,0,0,0.18)"); draw.setLineWidth(2.5);
          draw.beginPath(); draw.moveTo(x, y); draw.lineTo(x + 34, y - 6); draw.stroke();
          draw.beginPath(); draw.moveTo(x, y + 6); draw.lineTo(x + 34, y + 6); draw.stroke();
          draw.beginPath(); draw.moveTo(x, y + 12); draw.lineTo(x + 34, y + 17); draw.stroke();
        }
        text(draw, `RAMAS ${g.branchesGrown}    CALOR ${g.heat}/3`, 24, 60, 13, "#6b3d00", "left");
        // sunset bar
        const remain = clamp(1 - g.playFrame / GAME_FRAMES, 0, 1);
        draw.setFillStyle("rgba(255,248,200,0.92)"); draw.fillRect(648, 10, 300, 54); draw.setStrokeStyle("#8a5a10"); draw.strokeRect(648, 10, 300, 54);
        text(draw, "OCASO", 660, 26, 13, "#6b3d00", "left");
        draw.setFillStyle("#5a3200"); draw.fillRect(660, 40, 276, 12);
        draw.setFillStyle(remain > 0.3 ? "#ffd21a" : "#ff6a1a"); draw.fillRect(660, 40, 276 * remain, 12);
        text(draw, `${Math.ceil(remain * 90)}s`, 936, 26, 14, "#6b3d00", "right");
        text(draw, "A/D mueve sol  ARRIBA/ABAJO angulo  ESPACIO rayo", W / 2, H - 14, 13, "rgba(90,50,0,0.85)");
        if (g.phase === "playing") {
          const hint = g.cat.position.x < 470 ? "RAYO AL ARBOL: BROTA Y EMPUJA" : g.car.position.x < HILL_X - 110 ? "RAYO AL COCHE 2 VECES: RUEDA A LA CASA" : g.cat.position.x < 790 ? "GATO JUNTO AL COCHE? RAYO AL COCHE: BOING!" : "ENTRA SUAVE POR LA PUERTA";
          draw.setFillStyle("rgba(255,248,200,0.88)"); draw.fillRect(W / 2 - 190, 72, 380, 26);
          text(draw, hint, W / 2, 85, 13, "#7a3c00");
        }
      }

      if (g.phase === "title") {
        draw.setFillStyle("rgba(255,246,170,0.45)"); draw.fillRect(0, 0, W, H);
        text(draw, "EL SOL EMPUJA", W / 2, 92, 46, "#8a4d00");
        text(draw, "AL GATO A CASA", W / 2, 140, 46, "#b34700");
        text(draw, "Haz crecer ramas del arbol y calienta el coche.", W / 2, 188, 17, "#5a3200");
        text(draw, "No toques al gato con el rayo: solo 3 bigotes!", W / 2, 214, 17, "#8a2d00");
        if (g.frame % 76 < 48) text(draw, "TOCA ENTER", W / 2, 470, 30, "#8a4d00", "center", "bangers");
        text(draw, "Flechas / A D mover - Arriba Abajo angulo - Espacio rayo", W / 2, 506, 14, "#5a3200");
      }
      if (g.phase === "won") {
        draw.setFillStyle("rgba(255,240,150,0.78)"); draw.fillRect(190, 120, 580, 250);
        draw.setStrokeStyle("#8a5a10"); draw.setLineWidth(3); draw.strokeRect(190, 120, 580, 250);
        text(draw, "EL GATO YA ESTA EN CASA!", W / 2, 180, 30, "#7a3c00");
        text(draw, `PUNTOS ${g.score}`, W / 2, 232, 24, "#b34700", "center", "bangers");
        text(draw, `Tiempo ${Math.round(g.winFrame / 60)}s - Ramas ${g.branchesGrown} - Bigotes ${g.lives}/3`, W / 2, 272, 16, "#5a3200");
        text(draw, "Mira la ventana: esta sonriendo", W / 2, 302, 15, "#5a3200");
        if (g.frame % 76 < 48) text(draw, "ENTER PARA JUGAR DE NUEVO", W / 2, 342, 18, "#8a4d00", "center", "bangers");
      }
      if (g.phase === "lost") {
        draw.setFillStyle("rgba(70,45,90,0.42)"); draw.fillRect(0, 0, W, H);
        draw.setFillStyle("rgba(255,244,190,0.94)"); draw.fillRect(200, 130, 560, 240);
        draw.setStrokeStyle("#5a3200"); draw.setLineWidth(3); draw.strokeRect(200, 130, 560, 240);
        text(draw, "SE HIZO DE NOCHE...", W / 2, 185, 30, "#4a2a6b");
        text(draw, g.loseReason, W / 2, 232, 17, "#6b2d00");
        text(draw, `PUNTOS ${g.score} - Ramas ${g.branchesGrown}`, W / 2, 268, 17, "#5a3200");
        text(draw, "El sol duerme y el gato mira la puerta cerrada", W / 2, 298, 14, "#5a3200");
        if (g.frame % 76 < 48) text(draw, "ENTER PARA JUGAR DE NUEVO", W / 2, 338, 18, "#4a2a6b", "center", "bangers");
      }
    }

    return {
      ready,
      start: (seed: number) => { g = fresh(seed); },
      step: (inputs: number[]) => {
        const bits = inputs[0] ?? 0;
        const pressed = bits & ~g.held; g.held = bits; g.frame++;
        if (g.phase === "title") { if (pressed & ENTER) startGame(); }
        else if (g.phase === "playing") stepPlaying(bits);
        else if ((g.phase === "won" || g.phase === "lost") && (pressed & ENTER)) startGame();
        stepCommon();
      },
      checksum: () => {
        const c = createChecksum();
        c.add(g.frame).add(g.playFrame).add(g.sunX).add(g.sunY).add(g.angle).add(g.lives).add(g.branchesGrown).add(g.heat).add(g.score);
        c.add(g.cat.position.x).add(g.cat.position.y).add(g.cat.velocity.x).add(g.cat.velocity.y);
        c.add(g.car.position.x).add(g.car.position.y).add(g.car.velocity.x);
        for (const b of g.branches) c.add(b.y).add(b.len).add(b.dir);
        c.add(g.particles.length).add(g.rng);
        return c.value();
      },
      state: () => ({
        outcome: g.phase === "won" ? "won" : g.phase === "lost" ? "lost" : "playing",
        progress: g.phase === "won" ? 1 : clamp(0.60 * clamp((g.cat.position.x - 300) / (DOOR_X - 300), 0, 1) + 0.22 * clamp((g.car.position.x - 565) / 149, 0, 1) + 0.07 * clamp(g.branchesGrown / 4, 0, 1) + 0.04 * (g.heat / 3) + (g.cat.position.y > HILL_TOP - 6 && g.cat.position.x > 700 ? 0.07 : 0), 0, 0.99),
        phase: g.phase, frame: g.frame, timeLeft: Math.max(0, Math.ceil(90 - g.playFrame / 60)),
        lives: g.lives, branches: g.branchesGrown, heat: g.heat, score: g.score,
        cat: { x: Math.round(g.cat.position.x), y: Math.round(g.cat.position.y) },
        car: { x: Math.round(g.car.position.x) }, sun: { x: Math.round(g.sunX), angle: Math.round(g.angle * 100) / 100 },
      }),
      over: () => g.phase === "won" || g.phase === "lost",
      save: () => JSON.parse(JSON.stringify(g)),
      restore: (saved: unknown) => { const s = JSON.parse(JSON.stringify(saved)) as State; g = s; },
      inspect: () => g,
      render: (draw) => render(draw),
    };
  },
});
