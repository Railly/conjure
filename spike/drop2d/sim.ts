// Spike V1: painted cutouts (Muse Image + SAM) as dotframe physics bodies.
import { createChecksum } from "dotframe/src/checksum";
import type { Draw2D } from "dotframe/src/draw2d";
import type { Texture } from "dotframe/src/gpu";
import { type Body, FIXED_STEP, type Solid, stepBodies } from "dotframe/src/physics";
import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";

const WINDOW = { width: 960, height: 540, title: "drop2d" };
const NAMES = ["fox", "tree", "rock", "crate"];
const HEIGHT = 140;
const GRAVITY = -1800;
const GROUND: Solid = { x: WINDOW.width / 2, y: 20, halfWidth: WINDOW.width / 2, halfHeight: 20 };
const WALLS: Solid[] = [
  { x: -20, y: 270, halfWidth: 20, halfHeight: 400 },
  { x: WINDOW.width + 20, y: 270, halfWidth: 20, halfHeight: 400 },
];

interface Sprite {
  name: string;
  body: Body;
}

interface Game {
  frame: number;
  sprites: Sprite[];
}

const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset);
  return { w: v.getUint32(16), h: v.getUint32(20) };
};

interface Hitbox {
  width: number;
  height: number;
  parts: Solid[];
}

function createGame(sizes: { w: number; h: number }[], hitboxes: Hitbox[]): Game {
  return {
    frame: 0,
    sprites: NAMES.map((name, i) => {
      const scale = HEIGHT / sizes[i].h;
      return {
        name,
        body: {
          position: { x: 160 + i * 210, y: 420 + i * 90, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          halfWidth: (sizes[i].w * scale) / 2,
          halfHeight: HEIGHT / 2,
          onGround: false,
          parts: hitboxes[i].parts.map((p) => ({
            x: p.x * scale,
            y: p.y * scale,
            halfWidth: p.halfWidth * scale,
            halfHeight: p.halfHeight * scale,
          })),
        },
      };
    }),
  };
}

// Input bits: 1 left, 2 right, 4 jump. Player 0 drives the fox.
function step(game: Game, inputs: number[]): void {
  const bits = inputs[0] ?? 0;
  const fox = game.sprites[0].body;
  fox.velocity = { x: (bits & 2 ? 260 : 0) - (bits & 1 ? 260 : 0), y: fox.velocity.y, z: 0 };
  if (bits & 4 && fox.onGround) fox.velocity = { x: fox.velocity.x, y: 820, z: 0 };
  stepBodies(
    game.sprites.map((s) => s.body),
    [GROUND, ...WALLS],
    GRAVITY,
    FIXED_STEP,
  );
  game.frame++;
}

export default defineSim({
  players: 1,
  window: WINDOW,
  clear: { r: 0.62, g: 0.8, b: 0.9, a: 1 },
  // hitboxes: draw each body's collision parts over its sprite.
  options: { hitboxes: false },
  neutral: 0,
  rollbackWindow: 20,
  encode: (input: unknown): number => {
    const i = (input ?? {}) as { left?: boolean; right?: boolean; jump?: boolean };
    return (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.jump ? 4 : 0);
  },
  random: (next) => Math.floor(next() * 8),
  create: (platform: SimPlatform): SimRun => {
    let sizes: { w: number; h: number }[] = [];
    let hitboxes: Hitbox[] = [];
    let showHitboxes = false;
    const textures: Texture[] = [];
    let game: Game = { frame: 0, sprites: [] };
    const ready = (async () => {
      const bytes = await Promise.all(NAMES.map((n) => platform.load(`assets/${n}.png`)));
      sizes = bytes.map(pngSize);
      hitboxes = await Promise.all(
        NAMES.map(async (n) => JSON.parse(new TextDecoder().decode(await platform.load(`assets/${n}.hitbox.json`))) as Hitbox),
      );
      if (platform.image) for (const b of bytes) textures.push(await platform.image(b, true));
      game = createGame(sizes, hitboxes);
    })();
    return {
      ready,
      start: (_seed, options) => {
        showHitboxes = options.hitboxes === true;
        game = createGame(sizes, hitboxes);
      },
      step: (inputs) => step(game, inputs),
      checksum: () => {
        const c = createChecksum().add(game.frame);
        for (const s of game.sprites) c.add(s.body.position.x).add(s.body.position.y).add(s.body.velocity.x).add(s.body.velocity.y);
        return c.value();
      },
      state: () => ({
        frame: game.frame,
        sprites: game.sprites.map((s) => ({
          name: s.name,
          x: Math.round(s.body.position.x),
          y: Math.round(s.body.position.y),
          onGround: s.body.onGround,
        })),
      }),
      over: () => false,
      save: () => structuredClone(game),
      restore: (saved) => {
        game = structuredClone(saved as Game);
      },
      inspect: () => game,
      render: (draw: Draw2D) => {
        draw.setFillStyle("#9ccbe6");
        draw.fillRect(0, 0, WINDOW.width, WINDOW.height);
        draw.setFillStyle("#6b8f4e");
        draw.fillRect(0, WINDOW.height - 40, WINDOW.width, 40);
        game.sprites.forEach((s, i) => {
          const b = s.body;
          const x = b.position.x - b.halfWidth;
          const y = WINDOW.height - (b.position.y + b.halfHeight);
          const t = textures[i];
          if (t) draw.drawImage(t, 0, 0, sizes[i].w, sizes[i].h, x, y, b.halfWidth * 2, b.halfHeight * 2);
          else {
            draw.setFillStyle("#c33");
            draw.fillRect(x, y, b.halfWidth * 2, b.halfHeight * 2);
          }
        });
        if (!showHitboxes) return;
        draw.setStrokeStyle("#ff2d55");
        draw.setLineWidth(2);
        for (const s of game.sprites)
          for (const p of s.body.parts ?? []) {
            const x = s.body.position.x + p.x - p.halfWidth;
            const y = WINDOW.height - (s.body.position.y + p.y + p.halfHeight);
            draw.strokeRect(x, y, p.halfWidth * 2, p.halfHeight * 2);
          }
      },
    };
  },
});
