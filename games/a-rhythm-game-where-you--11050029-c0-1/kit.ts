// Conjure game kit: the parts every polished small game needs, so the agent writes only what makes its game unique.
// Copied into each game as kit.ts. Simulation helpers change only the state they are given (call them from step);
// draw helpers only read (call them from render). Deterministic: no Math.random, no Date, detmath for trig.
import type { Draw2D } from "dotframe/src/draw2d";
import type { Texture } from "dotframe/src/gpu";
import type { SimPlatform } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";

// ---------- Assets ----------

export interface Sprite {
  name: string;
  w: number;
  h: number;
  // Collision parts in image pixels, relative to the image center, y up (physics convention).
  parts: { x: number; y: number; halfWidth: number; halfHeight: number }[];
  // Absent in headless runs.
  tex?: Texture;
}

// Loads assets/<name>.png and <name>.hitbox.json for each name, plus the bundled font. Works headless.
export async function loadKit(platform: SimPlatform, names: string[]): Promise<Record<string, Sprite>> {
  const sprites: Record<string, Sprite> = {};
  for (const name of names) {
    const png = await platform.load(`assets/${name}.png`);
    const v = new DataView(png.buffer, png.byteOffset);
    let parts: Sprite["parts"] = [];
    try {
      parts = JSON.parse(new TextDecoder().decode(await platform.load(`assets/${name}.hitbox.json`))).parts;
    } catch {}
    sprites[name] = { name, w: v.getUint32(16), h: v.getUint32(20), parts, tex: platform.image ? await platform.image(png, true) : undefined };
  }
  if (platform.draw && platform.image) {
    const atlas = await platform.image(await platform.load("assets/fonts/archivo-black.png"), true);
    platform.draw.addFont(["archivo black", "sans-serif"], atlas, new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json")));
    const bangers = await platform.image(await platform.load("assets/fonts/bangers.png"), true);
    platform.draw.addFont(["bangers"], bangers, new TextDecoder().decode(await platform.load("assets/fonts/bangers.json")));
  }
  return sprites;
}

// Collision parts scaled to a sprite drawn `height` pixels tall (for dotframe/src/physics Body.parts).
export function partsAt(sprite: Sprite, height: number): Sprite["parts"] {
  const s = height / sprite.h;
  return sprite.parts.map((p) => ({ x: p.x * s, y: p.y * s, halfWidth: p.halfWidth * s, halfHeight: p.halfHeight * s }));
}

// ---------- Randomness ----------

// Seeded generator; keep the returned object in the state so save/restore capture it.
export const rng = (seed: number) => ({ s: seed >>> 0 || 1 });
export function rand(r: { s: number }): number {
  r.s = (Math.imul(r.s, 1664525) + 1013904223) >>> 0;
  return r.s / 4294967296;
}
export const range = (r: { s: number }, a: number, b: number) => a + rand(r) * (b - a);

// ---------- Input ----------

// Bit layout used by encodeKeys; games may extend it.
export const KEY = { left: 1, right: 2, up: 4, down: 8, action: 16, start: 32 } as const;
// Turns the JSON input the CLI and the browser shell send ({left, right, up, down, jump, space, enter, ...}) into bits.
export function encodeKeys(input: unknown): number {
  if (typeof input === "number") return input | 0;
  const i = (input ?? {}) as Record<string, boolean>;
  return (
    (i.left || i.a ? KEY.left : 0) |
    (i.right || i.d ? KEY.right : 0) |
    (i.up || i.w ? KEY.up : 0) |
    (i.down || i.s ? KEY.down : 0) |
    (i.action || i.space || i.jump || i.fire ? KEY.action : 0) |
    (i.enter || i.start ? KEY.start : 0)
  );
}
// Random input for mashing; start pressed rarely so mashes reach play.
export const randomKeys = (next: () => number) => (next() < 0.35 ? KEY.left : 0) | (next() < 0.45 ? KEY.right : 0) | (next() < 0.25 ? KEY.up : 0) | (next() < 0.15 ? KEY.down : 0) | (next() < 0.3 ? KEY.action : 0) | (next() < 0.05 ? KEY.start : 0);

// Edge detection: keys pressed this step and not the last. Keep `prev` in the state.
export function pressed(keys: number, prev: number): number {
  return keys & ~prev;
}

// ---------- Scenes ----------

export type Scene = "title" | "play" | "won" | "lost";
// Title -> play on start (or action); won/lost -> play again on start. Returns the next scene and whether a new run
// begins (reset the game state when it does). Also counts frames in the scene for animations.
export function sceneStep(s: { scene: Scene; sceneFrames: number }, edge: number): boolean {
  s.sceneFrames++;
  const go = (edge & (KEY.start | KEY.action)) !== 0;
  if (s.scene !== "play" && go && s.sceneFrames > 20) {
    s.scene = "play";
    s.sceneFrames = 0;
    return true;
  }
  return false;
}
export function endRun(s: { scene: Scene; sceneFrames: number }, won: boolean): void {
  s.scene = won ? "won" : "lost";
  s.sceneFrames = 0;
}
// The verifier's view: outcome and progress (0..1) for state().
export const outcomeOf = (scene: Scene) => (scene === "won" ? "won" : scene === "lost" ? "lost" : "playing");

// ---------- Juice: particles, shake, floating text ----------

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}
export interface Juice {
  particles: Particle[];
  shake: number;
  texts: { x: number; y: number; text: string; life: number; color: string }[];
}
export const juice = (): Juice => ({ particles: [], shake: 0, texts: [] });

// A burst of n particles at (x, y), in screen coordinates (y down).
export function burst(j: Juice, r: { s: number }, x: number, y: number, n: number, color: string, speed = 4, size = 6): void {
  for (let i = 0; i < n; i++) {
    const a = range(r, 0, Math.PI * 2);
    const v = range(r, speed * 0.3, speed);
    const life = Math.round(range(r, 20, 40));
    j.particles.push({ x, y, vx: dcos(a) * v, vy: dsin(a) * v - speed * 0.3, life, max: life, size: range(r, size * 0.5, size), color });
  }
}
export const shake = (j: Juice, amount: number) => {
  j.shake = Math.max(j.shake, amount);
};
export const floatText = (j: Juice, x: number, y: number, text: string, color = "#ffffff") => {
  j.texts.push({ x, y, text, life: 50, color });
};
// One step of every effect: call once per step(). gravity in pixels per step squared.
export function juiceStep(j: Juice, gravity = 0.15): void {
  for (const p of j.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += gravity;
    p.vx *= 0.98;
    p.life--;
  }
  j.particles = j.particles.filter((p) => p.life > 0);
  for (const t of j.texts) {
    t.y -= 0.8;
    t.life--;
  }
  j.texts = j.texts.filter((t) => t.life > 0);
  j.shake *= 0.85;
  if (j.shake < 0.2) j.shake = 0;
}

// Screen-shake offset for this frame: translate by it before drawing the world. `frame` keeps it deterministic.
export const shakeOffset = (j: Juice, frame: number) => ({ x: dsin(frame * 1.7) * j.shake, y: dcos(frame * 2.3) * j.shake });

export function drawJuice(draw: Draw2D, j: Juice): void {
  for (const p of j.particles) {
    draw.setGlobalAlpha(Math.max(0, p.life / p.max));
    draw.setFillStyle(p.color);
    draw.beginPath();
    draw.arc(p.x, p.y, p.size * (0.5 + (0.5 * p.life) / p.max), 0, Math.PI * 2, false);
    draw.fill();
  }
  draw.setGlobalAlpha(1);
  for (const t of j.texts) {
    draw.setGlobalAlpha(Math.min(1, t.life / 20));
    text(draw, t.text, t.x, t.y, 26, t.color, "center");
  }
  draw.setGlobalAlpha(1);
}

// ---------- Drawing ----------

// A sprite centered at (x, y), `height` pixels tall, with squash and stretch (sx, sy around 1) and rotation.
export function drawSprite(draw: Draw2D, sprite: Sprite, x: number, y: number, height: number, opts: { sx?: number; sy?: number; rot?: number; flip?: boolean; alpha?: number } = {}): void {
  const w = (height * sprite.w) / sprite.h;
  draw.save();
  draw.translate(x, y);
  if (opts.rot) draw.rotate(opts.rot);
  draw.scale((opts.flip ? -1 : 1) * (opts.sx ?? 1), opts.sy ?? 1);
  if (opts.alpha !== undefined) draw.setGlobalAlpha(opts.alpha);
  if (sprite.tex) draw.drawImage(sprite.tex, 0, 0, sprite.w, sprite.h, -w / 2, -height / 2, w, height);
  else {
    draw.setFillStyle("#c33");
    draw.fillRect(-w / 2, -height / 2, w, height);
  }
  draw.restore();
}

// Squash and stretch from vertical speed: stretched while moving fast, back to 1 at rest.
export const squash = (vy: number, k = 0.04) => {
  const s = Math.min(0.35, Math.abs(vy) * k);
  return { sx: 1 - s * 0.5, sy: 1 + s };
};

// Text with a soft drop shadow, in the kit's fonts. align: "left" | "center" | "right".
export function text(draw: Draw2D, s: string, x: number, y: number, size: number, color: string, align = "left", font = "archivo black"): void {
  draw.setFont(`${size}px "${font}"`);
  draw.setTextAlign(align);
  draw.setTextBaseline("middle");
  draw.setFillStyle("rgba(0,0,0,0.35)");
  draw.fillText(s, x + 2, y + 3);
  draw.setFillStyle(color);
  draw.fillText(s, x, y);
}

// A vertical gradient sky from `top` to `bottom`, drawn as bands (Draw2D has no gradients).
export function sky(draw: Draw2D, w: number, h: number, top: [number, number, number], bottom: [number, number, number], bands = 24): void {
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const c = top.map((v, k) => Math.round(v + (bottom[k]! - v) * t));
    draw.setFillStyle(`rgb(${c[0]},${c[1]},${c[2]})`);
    draw.fillRect(0, (i * h) / bands, w, h / bands + 1);
  }
}

// Rounded panel for HUDs and overlays.
export function panel(draw: Draw2D, x: number, y: number, w: number, h: number, color = "rgba(0,0,0,0.45)", r = 14): void {
  draw.setFillStyle(color);
  draw.beginPath();
  draw.moveTo(x + r, y);
  draw.lineTo(x + w - r, y);
  draw.arc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  draw.lineTo(x + w, y + h - r);
  draw.arc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  draw.lineTo(x + r, y + h);
  draw.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  draw.lineTo(x, y + r);
  draw.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  draw.closePath();
  draw.fill();
}

// Title, win and lose screens in one call. `frame` drives the blink and the bob.
export function overlay(draw: Draw2D, w: number, h: number, scene: Scene, frame: number, title: string, subtitle: string, score: string): void {
  if (scene === "play") return;
  draw.setFillStyle(scene === "title" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.5)");
  draw.fillRect(0, 0, w, h);
  const bob = dsin(frame * 0.05) * 6;
  const head = scene === "title" ? title : scene === "won" ? "¡GANASTE!" : "¡OH NO!";
  text(draw, head, w / 2, h * 0.32 + bob, scene === "title" ? 72 : 64, scene === "lost" ? "#ff8a8a" : "#ffd23f", "center", "bangers");
  text(draw, scene === "title" ? subtitle : score, w / 2, h * 0.48, 22, "#ffffff", "center");
  if (Math.floor(frame / 30) % 2 === 0) text(draw, scene === "title" ? "Pulsa ENTER" : "ENTER para jugar de nuevo", w / 2, h * 0.7, 26, "#ffffff", "center");
}
