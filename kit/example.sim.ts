// A complete small game on the Conjure kit: title screen, play, win and lose, sprites with squash and stretch,
// particles, shake, floating text, HUD. A template to read, not to copy: replace the mechanic with the concept's.
// Here: move the hero (first drawing) left and right, catch the falling pickups (second drawing), avoid hazards (third).
import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf, overlay,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960;
const H = 540;
const NAMES = ["hero", "pickup", "hazard"]; // the game's assets/<name>.png files
const GOAL = 10;

interface Faller {
  x: number;
  y: number;
  vy: number;
  kind: "pickup" | "hazard";
}
interface Game {
  scene: Scene;
  sceneFrames: number;
  frame: number;
  prev: number;
  r: { s: number };
  x: number;
  vx: number;
  tilt: number;
  score: number;
  lives: number;
  fallers: Faller[];
  j: Juice;
}

const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed), x: W / 2, vx: 0, tilt: 0, score: 0, lives: 3, fallers: [], j: juice(),
});

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev);
  g.prev = keys;
  g.frame++;
  juiceStep(g.j);
  if (sceneStep(g, edge)) Object.assign(g, fresh(g.r.s, "play"), { prev: keys });
  if (g.scene !== "play") return;

  const dir = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  g.vx += dir * 1.2;
  g.vx *= 0.82;
  g.x = Math.max(60, Math.min(W - 60, g.x + g.vx));
  g.tilt = g.vx * 0.02;

  // Spawns speed up as the score climbs: the difficulty ramp.
  if (g.frame % Math.max(18, 50 - g.score * 3) === 0) g.fallers.push({ x: range(g.r, 60, W - 60), y: -40, vy: range(g.r, 3, 4 + g.score * 0.3), kind: range(g.r, 0, 1) < 0.65 ? "pickup" : "hazard" });
  for (const f of g.fallers) f.y += f.vy;
  for (const f of g.fallers) {
    if (Math.abs(f.x - g.x) < 60 && Math.abs(f.y - (H - 110)) < 50) {
      f.y = H + 100;
      if (f.kind === "pickup") {
        g.score++;
        burst(g.j, g.r, f.x, H - 130, 18, "#ffd23f");
        floatText(g.j, f.x, H - 170, "+1", "#ffd23f");
      } else {
        g.lives--;
        burst(g.j, g.r, g.x, H - 110, 24, "#ff5a5a", 6);
        shake(g.j, 14);
        floatText(g.j, g.x, H - 190, "¡AY!", "#ff8a8a");
      }
    }
  }
  g.fallers = g.fallers.filter((f) => f.y < H + 60);
  if (g.score >= GOAL) endRun(g, true);
  else if (g.lives <= 0) endRun(g, false);
}

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [255, 214, 150], [255, 245, 225]);
  // Depth: two hill layers that drift with the hero for parallax.
  draw.setFillStyle("#f2c38a");
  draw.fillRect(0, H - 120 + dsin(g.frame * 0.01) * 4, W, 120);
  draw.setFillStyle("#7cc47f");
  draw.fillRect(0, H - 60, W, 60);
  const o = shakeOffset(g.j, g.frame);
  draw.save();
  draw.translate(o.x, o.y);
  for (const f of g.fallers) drawSprite(draw, s[f.kind === "pickup" ? "pickup" : "hazard"]!, f.x, f.y, 70, { rot: dsin(g.frame * 0.1 + f.x) * 0.3 });
  const bounce = Math.abs(dsin(g.frame * 0.25)) * Math.min(1, Math.abs(g.vx) / 4);
  drawSprite(draw, s.hero!, g.x, H - 110 - bounce * 12, 120, { rot: g.tilt, sx: 1 + bounce * 0.08, sy: 1 - bounce * 0.08, flip: g.vx < -0.5 });
  drawJuice(draw, g.j);
  draw.restore();
  if (g.scene === "play") {
    panel(draw, 16, 14, 300, 52);
    text(draw, `${g.score}/${GOAL}`, 36, 40, 26, "#ffd23f");
    text(draw, `Vidas ${g.lives}`, 296, 40, 22, "#ffffff", "right");
  }
  overlay(draw, W, H, g.scene, g.sceneFrames, "ATRAPA", "Flechas para moverte", `Puntos: ${g.score}`);
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Example" },
  clear: { r: 1, g: 0.96, b: 0.9 },
  options: {},
  neutral: 0,
  encode: encodeKeys,
  random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1);
    let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((s) => {
      sprites = s;
    });
    return {
      ready,
      start: (seed) => {
        g = fresh(seed);
      },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => {
        let h = g.frame * 31 + g.score * 7 + g.lives + Math.round(g.x * 100);
        for (const f of g.fallers) h = (Math.imul(h, 16777619) ^ Math.round(f.y * 100)) >>> 0;
        return h >>> 0;
      },
      state: () => ({ outcome: outcomeOf(g.scene), progress: g.score / GOAL, scene: g.scene, score: g.score, lives: g.lives }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => {
        g = { ...fresh(1), ...structuredClone(saved as Game) };
      },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
