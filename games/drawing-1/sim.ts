import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { createChecksum } from "dotframe/src/checksum";
import { dsin } from "dotframe/src/detmath";
import { stepBodies, FIXED_STEP, type Body, type Solid } from "dotframe/src/physics";
import type { Texture } from "dotframe/src/gpu";
import type { Draw2D } from "dotframe/src/draw2d";

const W = 960, H = 540;
const LEFT = 1, RIGHT = 2, JUMP = 4, ACTION = 8;
const GRAVITY = -2000, SPEED = 265, JUMP_V = 860, TIME_LIMIT = 5400;

interface Hitbox { width: number; height: number; parts: Solid[] }
interface Sprite { tex: Texture | null; w: number; h: number; hb: Hitbox }
type Outcome = "playing" | "won" | "lost";
interface Sun { x: number; y: number; taken: boolean }
interface Game {
  frame: number; seed: number; rng: number; outcome: Outcome; lives: number; held: number;
  invuln: number; knock: number; knockVx: number; facing: number; carDir: number; jumpBuffer: number;
  cat: Body; car: Body; suns: Sun[];
}

const NAMES = ["cat", "sun", "tree", "house", "car", "dragon"] as const;
const DRAW_W: Record<string, number> = { cat: 84, sun: 54, tree: 110, house: 150, car: 124, dragon: 120 };
const FALLBACK: Record<string, Hitbox> = {
  cat: { width: 401, height: 303, parts: [{ x: 0, y: 0, halfWidth: 190, halfHeight: 140 }] },
  sun: { width: 303, height: 270, parts: [{ x: 0, y: 0, halfWidth: 140, halfHeight: 125 }] },
  tree: { width: 246, height: 278, parts: [{ x: 0, y: 60, halfWidth: 110, halfHeight: 70 }] },
  house: { width: 278, height: 293, parts: [{ x: 0, y: 0, halfWidth: 130, halfHeight: 140 }] },
  car: { width: 330, height: 167, parts: [{ x: 0, y: 0, halfWidth: 155, halfHeight: 75 }] },
  dragon: { width: 400, height: 300, parts: [] },
};
// physics positions (y up): tree centers, mounds
const TREES = [
  { x: 220, moundTop: 40 }, { x: 470, moundTop: 145 }, { x: 685, moundTop: 235 },
];
const MOUNDS: Solid[] = [
  { x: 480, y: 20, halfWidth: 480, halfHeight: 20 },
  // Only the grassy tops of the hills are solid (thin slabs): the hills are background, so the car can patrol in front of them along the ground.
  { x: 470, y: 138, halfWidth: 95, halfHeight: 7 },
  { x: 685, y: 228, halfWidth: 80, halfHeight: 7 },
  { x: -30, y: 270, halfWidth: 30, halfHeight: 270 },
  { x: 990, y: 270, halfWidth: 30, halfHeight: 270 },
];

function pngSize(b: Uint8Array): { w: number; h: number } {
  const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
  const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  return { w, h };
}
function nextRand(g: Game): number {
  g.rng = (Math.imul(g.rng ^ (g.rng >>> 15), 2246822519) ^ (g.rng >>> 13)) >>> 0;
  return (g.rng >>> 8) / 16777216;
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Cat's Sunny Way Home" },
  clear: { r: 0.04, g: 0.06, b: 0.16 },
  options: {},
  neutral: 0,
  encode: (input: unknown): number => {
    if (typeof input === "number") return input;
    const i = input as { left?: boolean; right?: boolean; jump?: boolean; action?: boolean; restart?: boolean };
    return (i.left ? LEFT : 0) | (i.right ? RIGHT : 0) | (i.jump ? JUMP : 0) | ((i.action || i.restart) ? ACTION : 0);
  },
  random: (next: () => number): number => {
    const r = next();
    return (r < 0.32 ? LEFT : r < 0.68 ? RIGHT : 0) | (next() < 0.35 ? JUMP : 0) | (next() < 0.06 ? ACTION : 0);
  },
  create: (platform: SimPlatform): SimRun => {
    const sprites: Record<string, Sprite> = {};
    for (const n of NAMES) {
      const hb = FALLBACK[n];
      sprites[n] = { tex: null, w: hb.width, h: hb.height, hb };
    }
    const scaledParts = (name: string): Solid[] => {
      const s = sprites[name]; const k = DRAW_W[name] / s.hb.width;
      return s.hb.parts.map(p => ({ x: p.x * k, y: p.y * k, halfWidth: p.halfWidth * k, halfHeight: p.halfHeight * k }));
    };
    const drawnH = (name: string): number => sprites[name].hb.height * (DRAW_W[name] / sprites[name].hb.width);
    const makeBody = (name: string, x: number, y: number, pushable: boolean): Body => ({
      position: { x, y, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      halfWidth: DRAW_W[name] / 2, halfHeight: drawnH(name) / 2, onGround: false,
      parts: scaledParts(name), pushable,
    });
    const solids = (): Solid[] => {
      const out = MOUNDS.slice();
      // A wide, thin platform hidden in each tree's leafy top: standing in the crown, easy to land on.
      for (const t of TREES) out.push({ x: t.x, y: t.moundTop + drawnH("tree") - 24, halfWidth: 70, halfHeight: 6 });
      return out;
    };
    const makeGame = (seed: number): Game => {
      const g: Game = {
        frame: 0, seed, rng: (seed * 2654435761 + 1013904223) >>> 0, outcome: "playing", lives: 3, held: 0,
        invuln: 0, knock: 0, knockVx: 0, facing: 1, carDir: 1, jumpBuffer: 0,
        cat: makeBody("cat", 75, 75, false), car: makeBody("car", 400, 72, true), suns: [],
      };
      const base = [[95, 120], [220, 205], [470, 305], [685, 395], [825, 285]];
      g.suns = base.map(([x, y]) => ({ x: x + Math.floor(nextRand(g) * 21) - 10, y, taken: false }));
      return g;
    };
    let game: Game = makeGame(1);

    const ready = (async (): Promise<void> => {
      for (const n of NAMES) {
        const bytes = await platform.load(`assets/${n}.hitbox.json`);
        sprites[n].hb = JSON.parse(new TextDecoder().decode(bytes)) as Hitbox;
      }
      if (platform.image) {
        for (const n of NAMES) {
          const bytes = await platform.load(`assets/${n}.png`);
          const size = pngSize(bytes);
          sprites[n].w = size.w; sprites[n].h = size.h;
          sprites[n].tex = await platform.image(bytes, true);
        }
      }
      if (platform.draw && platform.image) {
        platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json")));
        platform.draw.setFont('20px "Archivo Black"');
      }
      game = makeGame(game.seed);
    })();

    const cloneBody = (b: Body): Body => ({
      position: { ...b.position }, velocity: { ...b.velocity }, halfWidth: b.halfWidth, halfHeight: b.halfHeight,
      onGround: b.onGround, pushable: b.pushable, parts: b.parts?.map(p => ({ ...p })),
    });
    const snapshot = (g: Game): Game => ({
      frame: g.frame, seed: g.seed, rng: g.rng, outcome: g.outcome, lives: g.lives, held: g.held,
      invuln: g.invuln, knock: g.knock, knockVx: g.knockVx, facing: g.facing, carDir: g.carDir, jumpBuffer: g.jumpBuffer,
      cat: cloneBody(g.cat), car: cloneBody(g.car), suns: g.suns.map(s => ({ ...s })),
    });

    const sx = (x: number): number => x;
    const sy = (y: number): number => H - y;
    const drawSprite = (draw: Draw2D, name: string, cx: number, cyPhys: number, flip: boolean, alpha: number): void => {
      const s = sprites[name]; const dw = DRAW_W[name]; const dh = s.hb.height * (dw / s.hb.width);
      const cxS = sx(cx), cyS = sy(cyPhys);
      draw.save(); draw.setGlobalAlpha(alpha);
      if (flip) { draw.translate(cxS, cyS); draw.scale(-1, 1); draw.translate(-cxS, -cyS); }
      if (s.tex) draw.drawImage(s.tex, 0, 0, s.w, s.h, cxS - dw / 2, cyS - dh / 2, dw, dh);
      else { draw.setFillStyle("#ff8c42"); draw.fillRect(cxS - dw / 2, cyS - dh / 2, dw, dh); }
      draw.restore(); draw.setGlobalAlpha(1);
    };

    return {
      ready,
      start: (seed: number): void => { game = makeGame(seed); },
      step: (inputs: number[]): void => {
        const bits = inputs[0] ?? 0;
        const pressed = bits & ~game.held;
        if (game.outcome !== "playing") {
          game.held = bits;
          if (pressed !== 0) game = makeGame(game.seed);
          return;
        }
        game.held = bits; game.frame += 1;
        if (game.invuln > 0) game.invuln -= 1;
        if (pressed & JUMP) game.jumpBuffer = 8; else if (game.jumpBuffer > 0) game.jumpBuffer -= 1;
        let vx = 0;
        if (game.knock > 0) { game.knock -= 1; vx = game.knockVx; }
        else {
          vx = ((bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0)) * SPEED;
          if (vx !== 0) game.facing = vx > 0 ? 1 : -1;
          if (game.jumpBuffer > 0 && (game.cat.onGround || game.cat.position.y <= 71)) { game.cat.velocity = { x: vx, y: JUMP_V, z: 0 }; game.jumpBuffer = 0; }
        }
        game.cat.velocity = { x: vx, y: game.cat.velocity.y, z: 0 };
        game.car.velocity = { x: game.carDir * 105, y: game.car.velocity.y, z: 0 };
        stepBodies([game.cat, game.car], solids(), GRAVITY, FIXED_STEP);
        // car patrol bounds
        if (game.car.position.x < 260) { game.car.position.x = 260; game.carDir = 1; }
        if (game.car.position.x > 730) { game.car.position.x = 730; game.carDir = -1; }
        game.cat.position.x = Math.max(46, Math.min(914, game.cat.position.x));
        game.cat.position.y = Math.max(70, Math.min(500, game.cat.position.y));
        game.car.position.y = Math.max(40, Math.min(200, game.car.position.y));
        // suns
        for (const s of game.suns) {
          if (!s.taken && Math.abs(game.cat.position.x - s.x) < 60 && Math.abs(game.cat.position.y - s.y) < 62) s.taken = true;
        }
        // car side hit
        const dx = game.cat.position.x - game.car.position.x;
        const dy = game.cat.position.y - game.car.position.y;
        if (game.invuln === 0 && Math.abs(dx) < 112 && Math.abs(dy) < 42) {
          game.lives -= 1; game.invuln = 110; game.knock = 20; game.knockVx = dx >= 0 ? 280 : -280;
          game.cat.velocity = { x: game.knockVx, y: 380, z: 0 };
          if (game.lives <= 0) game.outcome = "lost";
        }
        const collected = game.suns.filter(s => s.taken).length;
        if (collected === game.suns.length && game.cat.position.x > 825 && game.cat.position.y < 150) game.outcome = "won";
        if (game.frame >= TIME_LIMIT && game.outcome === "playing") game.outcome = "lost";
      },
      checksum: (): number => {
        const c = createChecksum();
        c.add(game.frame).add(game.cat.position.x).add(game.cat.position.y).add(game.car.position.x).add(game.carDir)
          .add(game.lives).add(game.rng).add(game.invuln);
        for (const s of game.suns) c.add(s.taken ? 1 : 0).add(s.x);
        c.add(game.outcome === "won" ? 2 : game.outcome === "lost" ? 1 : 0);
        return c.value();
      },
      state: (): unknown => {
        const collected = game.suns.filter(s => s.taken).length;
        const total = game.suns.length;
        let progress: number;
        if (game.outcome === "won") progress = 1;
        else {
          progress = (collected / total) * 0.85;
          if (collected === total) {
            // all suns gathered: credit for approaching the house door (x > 825, y < 150)
            const dxHouse = Math.max(0, 860 - game.cat.position.x);
            const dyHouse = game.cat.position.y < 150 ? 0 : game.cat.position.y - 150;
            progress += 0.14 * Math.max(0, 1 - (dxHouse + dyHouse) / 900);
          } else {
            // credit for approaching the nearest remaining sun
            let best = 0;
            for (const s of game.suns) {
              if (s.taken) continue;
              const d = Math.abs(game.cat.position.x - s.x) + Math.abs(game.cat.position.y - s.y);
              const c = Math.max(0, 1 - d / 1400);
              if (c > best) best = c;
            }
            progress += 0.05 * best;
          }
          if (progress > 0.99) progress = 0.99;
        }
        progress = Math.round(progress * 10000) / 10000;
        return {
          outcome: game.outcome, frame: game.frame, progress,
          cat: { x: Math.round(game.cat.position.x), y: Math.round(game.cat.position.y) },
          car: { x: Math.round(game.car.position.x), y: Math.round(game.car.position.y) },
          suns: collected, sunsTotal: total,
          score: collected * 100, lives: game.lives,
          timeLeft: Math.max(0, Math.ceil((TIME_LIMIT - game.frame) / 60)),
        };
      },
      over: (): boolean => game.outcome !== "playing",
      save: (): unknown => snapshot(game),
      restore: (saved: unknown): void => { game = snapshot(saved as Game); },
      inspect: (): unknown => game,
      render: (draw: Draw2D): void => {
        draw.setFillStyle("#0b1026"); draw.fillRect(0, 0, W, H);
        // stars (twinkle with seeded frame)
        for (let i = 0; i < 70; i++) {
          const sx2 = (i * 137 + 41) % W;
          const sy2 = (i * 89 + 23) % 380;
          const tw = 0.5 + 0.5 * dsin(game.frame * 0.08 + i * 1.3);
          draw.setGlobalAlpha(0.4 + tw * 0.6);
          draw.setFillStyle("#ffffff");
          const sz = i % 5 === 0 ? 3 : 2;
          draw.fillRect(sx2, sy2, sz, sz);
        }
        draw.setGlobalAlpha(1);
        // moon
        draw.setFillStyle("#f5f0d0");
        draw.beginPath(); draw.ellipse(830, 90, 34, 34, 0, 0, 6.2832, false); draw.fill();
        draw.setFillStyle("#0b1026");
        draw.beginPath(); draw.ellipse(818, 82, 28, 28, 0, 0, 6.2832, false); draw.fill();
        // clouds (shapes behind sprites)
        draw.setFillStyle("#ffffff");
        for (const [cx, cy, r] of [[160, 95, 26], [520, 95, 32], [800, 110, 24]] as const) {
          draw.beginPath(); draw.ellipse(cx, cy, r * 1.7, r, 0, 0, 6.2832, false); draw.fill();
        }
        // big decorative sun rays in sky using sun sprite later? ground & mounds
        draw.setFillStyle("#8a5a33"); draw.fillRect(375, H - 145, 190, 105);
        draw.fillRect(605, H - 235, 160, 195);
        draw.setFillStyle("#57b34a"); draw.fillRect(0, H - 40, W, 40);
        draw.fillRect(375, H - 145, 190, 14); draw.fillRect(605, H - 235, 160, 14);
        draw.setFillStyle("#3e8f36"); draw.fillRect(0, H - 42, W, 5);
        // trees, house
        for (const t of TREES) drawSprite(draw, "tree", t.x, t.moundTop + drawnH("tree") / 2, false, 1);
        drawSprite(draw, "house", 885, 40 + drawnH("house") / 2, false, 1);
        // suns collectibles (spinning)
        game.suns.forEach((s, i) => {
          if (s.taken) return;
          const bob = dsin(game.frame * 0.06 + i * 1.7) * 6;
          const s2 = sprites.sun; const dw = DRAW_W.sun; const dh = s2.hb.height * (dw / s2.hb.width);
          draw.save(); draw.translate(sx(s.x), sy(s.y + bob)); draw.rotate(game.frame * 0.02 + i);
          if (s2.tex) draw.drawImage(s2.tex, 0, 0, s2.w, s2.h, -dw / 2, -dh / 2, dw, dh);
          else { draw.setFillStyle("#ffd23f"); draw.fillRect(-dw / 2, -dh / 2, dw, dh); }
          draw.restore();
        });
        // friendly dragon flying across the sky (decorative, loops forever)
        const dSpan = W + 240;
        const dX = W + 120 - ((game.frame * 2) % dSpan);
        const dY = 430 + dsin(game.frame * 0.04) * 18;
        drawSprite(draw, "dragon", dX, dY, true, 1);
        drawSprite(draw, "car", game.car.position.x, game.car.position.y, game.carDir < 0, 1);
        const blink = game.invuln > 0 && Math.floor(game.frame / 6) % 2 === 0 ? 0.45 : 1;
        drawSprite(draw, "cat", game.cat.position.x, game.cat.position.y, game.facing < 0, blink);
        // HUD
        draw.setGlobalAlpha(0.85); draw.setFillStyle("#14324a"); draw.fillRect(12, 12, 470, 42); draw.setGlobalAlpha(1);
        draw.setFont('20px "Archivo Black"'); draw.setFillStyle("#ffffff"); draw.setTextAlign("left"); draw.setTextBaseline("middle");
        const collected = game.suns.filter(s => s.taken).length;
        draw.fillText(`SUNS ${collected}/5  LIVES ${game.lives}  TIME ${Math.max(0, Math.ceil((TIME_LIMIT - game.frame) / 60))}`, 24, 34);
        draw.setTextAlign("center");
        if (collected < 5) { draw.setFont('16px "Archivo Black"'); draw.setFillStyle("#14324a"); draw.fillText("GET ALL SUNS!", 885, 185); }
        else { draw.setFont('16px "Archivo Black"'); draw.setFillStyle("#1a7a2e"); draw.fillText("GO HOME!", 885, 185); }
        draw.setFont('16px "Archivo Black"'); draw.setFillStyle("#14324a");
        draw.fillText("ARROWS MOVE - SPACE JUMPS - CLIMB TREES", 480, 522);
        if (game.outcome !== "playing") {
          draw.setGlobalAlpha(0.78); draw.setFillStyle("#14324a"); draw.fillRect(230, 180, 500, 170); draw.setGlobalAlpha(1);
          draw.setFont('36px "Archivo Black"'); draw.setFillStyle(game.outcome === "won" ? "#7cff8a" : "#ff8a8a"); draw.setTextAlign("center");
          draw.fillText(game.outcome === "won" ? "YOU ARE HOME!" : "OUT OF TIME!", 480, 240);
          draw.setFont('18px "Archivo Black"'); draw.setFillStyle("#ffffff");
          draw.fillText(game.outcome === "won" ? `SCORE ${collected * 100} - CAT IS HAPPY` : "THE CAT WILL TRY AGAIN", 480, 285);
          draw.fillText("PRESS ANY KEY TO PLAY AGAIN", 480, 320);
        }
      },
    };
  },
});
