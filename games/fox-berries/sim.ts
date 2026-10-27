import { defineSim, type SimPlatform } from "dotframe/src/sim";
import type { Draw2D } from "dotframe/src/draw2d";
import type { Texture } from "dotframe/src/gpu";
import { Body, FIXED_STEP, stepBodies, type Solid } from "dotframe/src/physics";
import { createChecksum } from "dotframe/src/checksum";
import { dsin } from "dotframe/src/detmath";

// Fox & Berries: hop between rocks, collect 12 berries before night (60 s).
const W = 960;
const H = 540;
const TOTAL_FRAMES = 3600;
const GRAVITY = -2000;
const SPEED = 275;
const JUMP = 880;
const LEFT = 1;
const RIGHT = 2;
const JUMP_BIT = 4;
const RESTART = 8;

const FOX_W = 84;
const FOX_H = 65;
const BERRY_W = 36;
const BERRY_H = 32;
const PEBBLE_W = 38;
const PEBBLE_H = 28;

// Physics solids: y is UP, (x, y) is the centre. Tops are the landing surfaces.
const ROCKS: Solid[] = [
  { x: 110, y: 70, halfWidth: 115, halfHeight: 32 },
  { x: 275, y: 118, halfWidth: 72, halfHeight: 26 },
  { x: 420, y: 172, halfWidth: 68, halfHeight: 24 },
  { x: 555, y: 122, halfWidth: 62, halfHeight: 24 },
  { x: 685, y: 190, halfWidth: 72, halfHeight: 26 },
  { x: 835, y: 148, halfWidth: 78, halfHeight: 26 },
  { x: 790, y: 272, halfWidth: 62, halfHeight: 22 },
  { x: 630, y: 338, halfWidth: 58, halfHeight: 20 },
  { x: 465, y: 300, halfWidth: 62, halfHeight: 22 },
  { x: 315, y: 368, halfWidth: 56, halfHeight: 20 },
  { x: 165, y: 330, halfWidth: 66, halfHeight: 22 },
];
const BERRY_SPOTS: { x: number; y: number }[] = [
  { x: 110, y: 142 }, { x: 275, y: 184 }, { x: 420, y: 236 }, { x: 555, y: 186 },
  { x: 685, y: 256 }, { x: 835, y: 214 }, { x: 790, y: 334 }, { x: 630, y: 398 },
  { x: 465, y: 362 }, { x: 315, y: 428 }, { x: 165, y: 392 }, { x: 890, y: 262 },
];

interface Berry { x: number; y: number; taken: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number }
interface Game {
  seed: number; rng: number; frame: number; held: number; facing: number;
  phase: string; loseReason: string; score: number;
  fox: Body; pebble: Body; berries: Berry[]; sparks: Spark[];
}

interface Hitbox { width: number; height: number; parts: Solid[] }
interface Sprite { tex: Texture | null; w: number; h: number; hitbox: Hitbox | null }

function scaledParts(hb: Hitbox | null, drawnW: number, drawnH: number): Solid[] {
  if (!hb) return [];
  return hb.parts.map((p) => ({
    x: (p.x * drawnW) / hb.width,
    y: (p.y * drawnH) / hb.height,
    halfWidth: Math.max(2, (p.halfWidth * drawnW) / hb.width),
    halfHeight: Math.max(2, (p.halfHeight * drawnH) / hb.height),
  }));
}
function bounds(parts: Solid[], fallback: number): number {
  let m = fallback;
  for (const p of parts) m = Math.max(m, Math.abs(p.y) + p.halfHeight, Math.abs(p.x) + p.halfWidth);
  return m;
}

function nextRand(g: Game): number {
  g.rng = (Math.imul(g.rng, 1664525) + 1013904223) | 0;
  return ((g.rng >>> 0) % 10000) / 10000;
}

function makeBody(x: number, y: number, parts: Solid[], hw: number, hh: number, pushable: boolean): Body {
  return { position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, halfWidth: hw, halfHeight: hh, onGround: false, parts, pushable };
}

function createGame(seed: number, foxParts: Solid[], rockParts: Solid[]): Game {
  const foxHH = bounds(foxParts, FOX_H / 2);
  const pebHH = bounds(rockParts, PEBBLE_H / 2);
  const g: Game = {
    seed, rng: (seed * 2654435761) | 0 || 12345, frame: 0, held: 0, facing: 1,
    phase: "play", loseReason: "", score: 0,
    fox: makeBody(110, ROCKS[0].y + ROCKS[0].halfHeight + foxHH, foxParts, FOX_W / 2, foxHH, false),
    pebble: makeBody(660, ROCKS[4].y + ROCKS[4].halfHeight + pebHH, rockParts, PEBBLE_W / 2, pebHH, true),
    berries: BERRY_SPOTS.map((b) => ({ x: b.x, y: b.y, taken: false })),
    sparks: [],
  };
  return g;
}

function cloneBody(b: Body): Body {
  return {
    position: { x: b.position.x, y: b.position.y, z: b.position.z },
    velocity: { x: b.velocity.x, y: b.velocity.y, z: b.velocity.z },
    halfWidth: b.halfWidth, halfHeight: b.halfHeight, onGround: b.onGround,
    parts: b.parts ? b.parts.map((p) => ({ x: p.x, y: p.y, halfWidth: p.halfWidth, halfHeight: p.halfHeight })) : undefined,
    pushable: b.pushable,
  };
}
function snapshot(g: Game): Game {
  return {
    seed: g.seed, rng: g.rng, frame: g.frame, held: g.held, facing: g.facing,
    phase: g.phase, loseReason: g.loseReason, score: g.score,
    fox: cloneBody(g.fox), pebble: cloneBody(g.pebble),
    berries: g.berries.map((b) => ({ x: b.x, y: b.y, taken: b.taken })),
    sparks: g.sparks.map((s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, life: s.life })),
  };
}
function restoreInto(g: Game, s: Game): void {
  const c = snapshot(s);
  g.seed = c.seed; g.rng = c.rng; g.frame = c.frame; g.held = c.held; g.facing = c.facing;
  g.phase = c.phase; g.loseReason = c.loseReason; g.score = c.score;
  g.fox = c.fox; g.pebble = c.pebble; g.berries = c.berries; g.sparks = c.sparks;
}

function encode(input: unknown): number {
  if (typeof input === "number") return input | 0;
  const i = (input ?? {}) as { left?: boolean; right?: boolean; jump?: boolean; restart?: boolean };
  return (i.left ? LEFT : 0) | (i.right ? RIGHT : 0) | (i.jump ? JUMP_BIT : 0) | (i.restart ? RESTART : 0);
}
function randomInput(next: () => number): number {
  const r = next();
  return (r < 0.4 ? LEFT : r < 0.8 ? RIGHT : 0) | (next() < 0.35 ? JUMP_BIT : 0) | (next() < 0.03 ? RESTART : 0);
}

// Colour helpers (render only).
function mix(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t), g = Math.round(a[1] + (b[1] - a[1]) * t), bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
const toY = (py: number): number => H - py;

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Fox & Berries — Zorro y Bayas" },
  options: {},
  neutral: 0,
  rollbackWindow: 20,
  encode,
  random: randomInput,
  create: (platform: SimPlatform) => {
    const sprites: Record<string, Sprite> = {
      fox: { tex: null, w: 0, h: 0, hitbox: null },
      berry: { tex: null, w: 0, h: 0, hitbox: null },
      rock: { tex: null, w: 0, h: 0, hitbox: null },
      tree: { tex: null, w: 0, h: 0, hitbox: null },
    };
    let foxParts: Solid[] = [];
    let rockParts: Solid[] = [];
    let game: Game = createGame(1, foxParts, rockParts);

    const applyParts = (): void => {
      // Rebuild bodies preserving position so late asset load does not move gameplay.
      const fx = game.fox.position, fvx = game.fox.velocity;
      game.fox.parts = foxParts;
      game.fox.halfHeight = bounds(foxParts, FOX_H / 2);
      game.fox.halfWidth = FOX_W / 2;
      game.fox.position = fx; game.fox.velocity = fvx;
      const px = game.pebble.position, pvx = game.pebble.velocity;
      game.pebble.parts = rockParts;
      game.pebble.halfHeight = bounds(rockParts, PEBBLE_H / 2);
      game.pebble.halfWidth = PEBBLE_W / 2;
      game.pebble.position = px; game.pebble.velocity = pvx;
    };

    const ready = (async (): Promise<void> => {
      const names = ["fox", "berry", "rock", "tree"];
      for (const name of names) {
        try {
          const hbBytes = await platform.load(`assets/${name}.hitbox.json`);
          sprites[name].hitbox = JSON.parse(new TextDecoder().decode(hbBytes)) as Hitbox;
        } catch { /* keep null hitbox */ }
        if (platform.image) {
          try {
            const bytes = await platform.load(`assets/${name}.png`);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            sprites[name].w = view.getUint32(16, false);
            sprites[name].h = view.getUint32(20, false);
            sprites[name].tex = await platform.image(bytes, true);
          } catch { /* keep null texture */ }
        }
      }
      if (sprites.fox.hitbox) foxParts = scaledParts(sprites.fox.hitbox, FOX_W, FOX_H);
      if (sprites.rock.hitbox) rockParts = scaledParts(sprites.rock.hitbox, PEBBLE_W, PEBBLE_H);
      applyParts();
    })();

    const step = (inputs: number[]): void => {
      const bits = inputs[0] ?? 0;
      if (game.phase !== "play") {
        if (bits & RESTART) {
          const fresh = createGame(game.seed, foxParts, rockParts);
          restoreInto(game, fresh);
        }
        game.held = bits;
        return;
      }
      game.frame += 1;
      const pressed = bits & ~game.held;
      game.held = bits;

      const dir = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0);
      if (dir !== 0) game.facing = dir;
      game.fox.velocity = { x: dir * SPEED, y: game.fox.velocity.y, z: 0 };
      if ((pressed & JUMP_BIT) && game.fox.onGround) game.fox.velocity = { x: game.fox.velocity.x, y: JUMP, z: 0 };

      stepBodies([game.fox, game.pebble], ROCKS, GRAVITY, FIXED_STEP);

      // Keep everything inside the world.
      for (const b of [game.fox, game.pebble]) {
        const hw = b.halfWidth;
        if (b.position.x < hw) { b.position = { x: hw, y: b.position.y, z: 0 }; b.velocity = { x: 0, y: b.velocity.y, z: 0 }; }
        if (b.position.x > W - hw) { b.position = { x: W - hw, y: b.position.y, z: 0 }; b.velocity = { x: 0, y: b.velocity.y, z: 0 }; }
        if (b.position.y > H - 20) { b.position = { x: b.position.x, y: H - 20, z: 0 }; b.velocity = { x: b.velocity.x, y: Math.min(b.velocity.y, 0), z: 0 }; }
      }
      if (game.pebble.onGround) game.pebble.velocity = { x: game.pebble.velocity.x * 0.8, y: game.pebble.velocity.y, z: 0 };
      if (game.pebble.position.y < 30) {
        const pebHH = bounds(rockParts, PEBBLE_H / 2);
        game.pebble.position = { x: 660, y: ROCKS[4].y + ROCKS[4].halfHeight + pebHH, z: 0 };
        game.pebble.velocity = { x: 0, y: 0, z: 0 };
      }

      // Berries.
      for (const b of game.berries) {
        if (b.taken) continue;
        const dx = game.fox.position.x - b.x, dy = game.fox.position.y - b.y;
        if (dx * dx + dy * dy < 52 * 52) {
          b.taken = true; game.score += 1;
          for (let i = 0; i < 6; i++) {
            const r1 = nextRand(game), r2 = nextRand(game);
            game.sparks.push({ x: b.x, y: b.y, vx: (r1 - 0.5) * 220, vy: 60 + r2 * 180, life: 28 });
          }
        }
      }
      for (const s of game.sparks) { s.x += s.vx * FIXED_STEP; s.y += s.vy * FIXED_STEP; s.vy -= 500 * FIXED_STEP; s.life -= 1; }
      game.sparks = game.sparks.filter((s) => s.life > 0);

      if (game.score >= game.berries.length) { game.phase = "won"; return; }
      if (game.fox.position.y < 34) { game.phase = "lost"; game.loseReason = "pond"; return; }
      if (game.frame >= TOTAL_FRAMES) { game.phase = "lost"; game.loseReason = "night"; }
    };

    const render = (draw: Draw2D): void => {
      const p = Math.min(1, game.frame / TOTAL_FRAMES); // 0 day -> 1 night
      // Sky bands: sunset orange to deep night blue.
      const top = mix([255, 150, 90], [12, 16, 54], p);
      const mid = mix([255, 195, 120], [38, 34, 86], p);
      const low = mix([255, 225, 170], [70, 52, 110], p);
      draw.setFillStyle(top); draw.fillRect(0, 0, W, 180);
      draw.setFillStyle(mid); draw.fillRect(0, 180, W, 180);
      draw.setFillStyle(low); draw.fillRect(0, 360, W, 180);

      // Stars fade in.
      if (p > 0.35) {
        draw.setGlobalAlpha((p - 0.35) * 1.4);
        draw.setFillStyle("#ffffff");
        for (let i = 0; i < 36; i++) {
          const sx = (i * 167 + 40) % W, sy = (i * 89 + 20) % 260;
          draw.fillRect(sx, sy, 3, 3);
        }
        draw.setGlobalAlpha(1);
      }
      // Sun sinking, moon rising.
      const sunY = 90 + p * 330;
      draw.setFillStyle("#ffdf6b"); draw.beginPath(); draw.arc(810, sunY, 34, 0, Math.PI * 2, false); draw.fill();
      draw.setFillStyle("#fff3b0"); draw.beginPath(); draw.arc(810, sunY, 24, 0, Math.PI * 2, false); draw.fill();
      const moonY = 430 - p * 340;
      draw.setFillStyle("#f4f1de"); draw.beginPath(); draw.arc(130, moonY, 22, 0, Math.PI * 2, false); draw.fill();
      draw.setFillStyle(mix([255, 195, 120], [38, 34, 86], p)); draw.beginPath(); draw.arc(142, moonY - 6, 18, 0, Math.PI * 2, false); draw.fill();

      // Distant hills.
      draw.setFillStyle(mix([90, 140, 90], [18, 34, 44], p));
      draw.beginPath(); draw.moveTo(0, 470); draw.lineTo(180, 390); draw.lineTo(380, 470); draw.lineTo(560, 400); draw.lineTo(760, 470); draw.lineTo(960, 410); draw.lineTo(960, 540); draw.lineTo(0, 540); draw.closePath(); draw.fill();

      // Pond.
      draw.setFillStyle(mix([70, 160, 200], [16, 40, 84], p)); draw.fillRect(0, H - 36, W, 36);
      draw.setFillStyle("rgba(255,255,255,0.5)");
      for (let i = 0; i < 8; i++) draw.fillRect(40 + i * 115 + ((game.frame / 2 + i * 20) % 30), H - 24 + (i % 2) * 10, 34, 3);

      // Trees on a few rocks (decor).
      const treeTex = sprites.tree.tex;
      const treeSpots = [{ x: 55, top: 102 }, { x: 875, top: 174 }, { x: 420, top: 322 }];
      for (const t of treeSpots) {
        if (treeTex && sprites.tree.w > 0) draw.drawImage(treeTex, 0, 0, sprites.tree.w, sprites.tree.h, t.x - 22, toY(t.top) - 72, 44, 76);
        else { draw.setFillStyle("#2e7d32"); draw.fillRect(t.x - 14, toY(t.top) - 60, 28, 60); }
      }

      // Rocks (sprites stretched to each platform, with a drawn fallback).
      const rockTex = sprites.rock.tex;
      for (const r of ROCKS) {
        const dx = r.x - r.halfWidth, dy = toY(r.y + r.halfHeight), w = r.halfWidth * 2, h = r.halfHeight * 2 + 14;
        if (rockTex && sprites.rock.w > 0) draw.drawImage(rockTex, 0, 0, sprites.rock.w, sprites.rock.h, dx, dy - 6, w, h);
        else { draw.setFillStyle("#8a8f98"); draw.fillRect(dx, dy, w, h); draw.setFillStyle("#6f757f"); draw.fillRect(dx, dy + h - 10, w, 10); }
        draw.setFillStyle("rgba(90,160,80,0.85)"); draw.fillRect(dx + 4, dy - 2, w - 8, 6);
      }

      // Pebble (pushable).
      const peb = game.pebble;
      if (rockTex && sprites.rock.w > 0) draw.drawImage(rockTex, 0, 0, sprites.rock.w, sprites.rock.h, peb.position.x - PEBBLE_W / 2, toY(peb.position.y) - PEBBLE_H / 2, PEBBLE_W, PEBBLE_H);
      else { draw.setFillStyle("#9aa0a8"); draw.fillRect(peb.position.x - PEBBLE_W / 2, toY(peb.position.y) - PEBBLE_H / 2, PEBBLE_W, PEBBLE_H); }

      // Berries.
      const berryTex = sprites.berry.tex;
      game.berries.forEach((b, i) => {
        if (b.taken) return;
        const bob = dsin(game.frame * 0.07 + i * 1.3) * 4;
        const cx = b.x, cy = toY(b.y) + bob;
        if (berryTex && sprites.berry.w > 0) draw.drawImage(berryTex, 0, 0, sprites.berry.w, sprites.berry.h, cx - BERRY_W / 2, cy - BERRY_H / 2, BERRY_W, BERRY_H);
        else { draw.setFillStyle("#e53935"); draw.beginPath(); draw.arc(cx, cy, 11, 0, Math.PI * 2, false); draw.fill(); }
      });

      // Sparks.
      draw.setFillStyle("#ffe66d");
      for (const s of game.sparks) draw.fillRect(s.x - 3, toY(s.y) - 3, 6, 6);

      // Fox (flip when facing left).
      const foxTex = sprites.fox.tex;
      const fx = game.fox.position.x, fy = toY(game.fox.position.y);
      if (foxTex && sprites.fox.w > 0) {
        if (game.facing < 0) {
          draw.save(); draw.translate(fx, fy); draw.scale(-1, 1);
          draw.drawImage(foxTex, 0, 0, sprites.fox.w, sprites.fox.h, -FOX_W / 2, -FOX_H / 2, FOX_W, FOX_H);
          draw.restore();
        } else {
          draw.drawImage(foxTex, 0, 0, sprites.fox.w, sprites.fox.h, fx - FOX_W / 2, fy - FOX_H / 2, FOX_W, FOX_H);
        }
      } else { draw.setFillStyle("#ef7d1a"); draw.fillRect(fx - FOX_W / 2, fy - FOX_H / 2, FOX_W, FOX_H); }

      // HUD.
      draw.setFillStyle("rgba(20,16,40,0.55)"); draw.fillRect(0, 0, W, 52);
      draw.setFillStyle("#ffffff"); draw.setFont("bold 20px sans-serif"); draw.setTextAlign("left"); draw.setTextBaseline("middle");
      draw.fillText(`🫐 Bayas: ${game.score}/${game.berries.length}`, 16, 27);
      const secs = Math.max(0, Math.ceil((TOTAL_FRAMES - game.frame) / 60));
      draw.setTextAlign("right"); draw.fillText(`🌙 Noche en: ${secs}s`, W - 16, 27); draw.setTextAlign("left");
      // Night progress bar.
      draw.setFillStyle("rgba(255,255,255,0.35)"); draw.fillRect(330, 20, 300, 12);
      draw.setFillStyle(p > 0.75 ? "#b388ff" : "#ffb74d"); draw.fillRect(330, 20, 300 * p, 12);
      draw.setFillStyle("rgba(255,255,255,0.85)"); draw.setFont("15px sans-serif");
      draw.fillText("← → mover · ESPACIO saltar · Empuja la piedrita", 16, H - 52);

      if (game.phase !== "play") {
        draw.setGlobalAlpha(0.78); draw.setFillStyle("#14102c"); draw.fillRect(0, 0, W, H); draw.setGlobalAlpha(1);
        draw.setFillStyle("#ffffff"); draw.setTextAlign("center");
        draw.setFont("bold 42px sans-serif");
        if (game.phase === "won") {
          draw.fillText("¡Lo lograste! 🎉", W / 2, 220);
          draw.setFont("22px sans-serif");
          draw.fillText(`Recogiste todas las bayas antes de la noche (quedaban ${secs}s)`, W / 2, 265);
        } else {
          draw.fillText(game.loseReason === "pond" ? "¡El zorro se mojó! 💦" : "Cayó la noche… 🌙", W / 2, 220);
          draw.setFont("22px sans-serif");
          draw.fillText(`Bayas recogidas: ${game.score}/${game.berries.length}`, W / 2, 265);
        }
        draw.setFont("20px sans-serif"); draw.fillText("Pulsa R o Enter para jugar otra vez", W / 2, 315);
        draw.setTextAlign("left");
      }
    };

    return {
      ready,
      start: (seed: number): void => { game = createGame(seed, foxParts, rockParts); },
      step,
      checksum: (): number => {
        const c = createChecksum();
        c.add(game.frame).add(game.score).add(game.rng).add(game.facing);
        c.add(game.fox.position.x).add(game.fox.position.y).add(game.fox.velocity.x).add(game.fox.velocity.y);
        c.add(game.pebble.position.x).add(game.pebble.position.y);
        c.add(game.phase === "won" ? 2 : game.phase === "lost" ? 1 : 0);
        for (const b of game.berries) c.add(b.taken ? 1 : 0);
        for (const s of game.sparks) c.add(s.x).add(s.y).add(s.life);
        return c.value();
      },
      state: (): unknown => ({
        frame: game.frame, phase: game.phase, loseReason: game.loseReason,
        berries: game.score, of: game.berries.length,
        secondsLeft: Math.max(0, Math.ceil((TOTAL_FRAMES - game.frame) / 60)),
        fox: { x: Math.round(game.fox.position.x), y: Math.round(game.fox.position.y), onGround: game.fox.onGround },
        pebble: { x: Math.round(game.pebble.position.x), y: Math.round(game.pebble.position.y) },
        facing: game.facing,
      }),
      over: (): boolean => game.phase !== "play",
      save: (): unknown => snapshot(game),
      restore: (saved: unknown): void => restoreInto(game, saved as Game),
      inspect: (): unknown => game,
      render,
    };
  },
});
