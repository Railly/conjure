import { defineSim, type SimPlatform } from "dotframe/src/sim";
import { createChecksum } from "dotframe/src/checksum";
import { dsin } from "dotframe/src/detmath";
import { stepBodies, FIXED_STEP, type Body, type Solid } from "dotframe/src/physics";
import type { Texture } from "dotframe/src/gpu";

// Penguin Ice: push ice blocks into water holes, then waddle to the igloo.
// Physics coordinates are y-up (0..540). Screen coordinates are y-down;
// render flips with sy = H - y.

const W = 960;
const H = 540;
const GROUND = 140; // top of the ice floor (physics y)
const PIT_BOTTOM = 92; // floor inside a hole (depth = one block, 48)
const BLOCK = 48;
const GRAV = -1600;
const SPEED = 235;
const PENGUIN_SCALE = 2.5; // el pinguino es gigante

const BIT_LEFT = 1;
const BIT_RIGHT = 2;
const BIT_ACTION = 4;
const BIT_RESTART = 8;

interface Hitbox { width: number; height: number; parts: Solid[]; }
interface BlockState { x: number; y: number; vy: number; filled: boolean; onGround: boolean; sinking: boolean; sinkX: number; }
interface FishState { x: number; y: number; taken: boolean; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: number; }
interface LevelDef {
  spawn: number;
  pits: { x: number; w: number }[];
  blocks: number[];
  fishes: { x: number; y: number }[];
  iglooX: number;
}

const LEVELS: LevelDef[] = [
  {
    spawn: 90,
    pits: [{ x: 408, w: 48 }, { x: 624, w: 48 }],
    blocks: [250, 520],
    fishes: [{ x: 432, y: 232 }, { x: 648, y: 232 }, { x: 760, y: 196 }],
    iglooX: 872,
  },
  {
    spawn: 92,
    pits: [{ x: 288, w: 48 }, { x: 480, w: 48 }, { x: 696, w: 48 }],
    blocks: [170, 384, 592],
    fishes: [{ x: 312, y: 232 }, { x: 504, y: 232 }, { x: 720, y: 232 }, { x: 800, y: 196 }],
    iglooX: 872,
  },
  {
    spawn: 64,
    pits: [{ x: 240, w: 48 }, { x: 408, w: 48 }, { x: 576, w: 48 }, { x: 744, w: 48 }],
    blocks: [150, 340, 508, 676],
    fishes: [{ x: 264, y: 232 }, { x: 432, y: 232 }, { x: 600, y: 232 }, { x: 768, y: 232 }],
    iglooX: 878,
  },
];

interface Game {
  frame: number;
  rng: number;
  level: number;
  score: number;
  levelScoreStart: number;
  lives: number;
  phase: string; // play | clear | win | over
  phaseTimer: number;
  px: number; py: number; pvx: number; pvy: number;
  onGround: boolean;
  face: number;
  moving: number;
  blocks: BlockState[];
  fishes: FishState[];
  particles: Particle[];
  prevInput: number;
  falls: number;
  filledCount: number;
}

function createGame(seed: number): Game {
  const g: Game = {
    frame: 0, rng: seed >>> 0 || 12345, level: 0, score: 0, levelScoreStart: 0,
    lives: 3, phase: "play", phaseTimer: 0,
    px: 122, py: 200, pvx: 0, pvy: 0, onGround: false, face: 1, moving: 0,
    blocks: [], fishes: [], particles: [], prevInput: 0, falls: 0, filledCount: 0,
  };
  loadLevel(g, 0, true);
  return g;
}

function loadLevel(g: Game, idx: number, resetScore: boolean): void {
  const def = LEVELS[idx];
  g.level = idx;
  if (resetScore) { g.score = 0; g.lives = 3; g.falls = 0; }
  g.levelScoreStart = g.score;
  g.phase = "play";
  g.phaseTimer = 0;
  g.px = def.spawn; g.py = GROUND + 34 * PENGUIN_SCALE; g.pvx = 0; g.pvy = 0; g.face = 1; g.moving = 0;
  g.blocks = def.blocks.map((x) => ({ x, y: GROUND + BLOCK / 2, vy: 0, filled: false, onGround: false, sinking: false, sinkX: x }));
  g.fishes = def.fishes.map((f) => ({ x: f.x, y: f.y, taken: false }));
  g.filledCount = 0;
  g.particles = [];
}

function nextRand(g: Game): number {
  g.rng = (Math.imul(g.rng, 1664525) + 1013904223) >>> 0;
  return g.rng / 4294967296;
}

function spawnParticles(g: Game, x: number, y: number, kind: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = nextRand(g) * 6.283;
    const sp = 40 + nextRand(g) * 130;
    g.particles.push({
      x, y,
      vx: dsin(a) * sp, vy: 60 + nextRand(g) * 140,
      life: 0, max: 34 + Math.floor(nextRand(g) * 26), kind,
    });
  }
  if (g.particles.length > 220) g.particles.splice(0, g.particles.length - 220);
}

function scaledParts(hb: Hitbox | null, drawW: number, drawH: number): Solid[] {
  if (!hb || hb.width <= 0) return [{ x: 0, y: 0, halfWidth: drawW / 2, halfHeight: drawH / 2 }];
  const sx = drawW / hb.width;
  const sy = drawH / hb.height;
  return hb.parts.map((p) => ({ x: p.x * sx, y: p.y * sy, halfWidth: p.halfWidth * sx, halfHeight: p.halfHeight * sy }));
}
function bounds(parts: Solid[]): { hw: number; hh: number } {
  let hw = 4, hh = 4;
  for (const p of parts) {
    hw = Math.max(hw, Math.abs(p.x) + p.halfWidth);
    hh = Math.max(hh, Math.abs(p.y) + p.halfHeight);
  }
  return { hw, hh };
}

function solidsFor(g: Game): Solid[] {
  const def = LEVELS[g.level];
  const solids: Solid[] = [
    { x: -24, y: H / 2, halfWidth: 24, halfHeight: H / 2 + 40 },
    { x: W + 24, y: H / 2, halfWidth: 24, halfHeight: H / 2 + 40 },
    { x: W / 2, y: -30, halfWidth: W / 2 + 40, halfHeight: 30 },
  ];
  // land segments between pits
  let cursor = 0;
  const sorted = [...def.pits].sort((a, b) => a.x - b.x);
  for (const pit of sorted) {
    if (pit.x > cursor) {
      const len = pit.x - cursor;
      solids.push({ x: cursor + len / 2, y: GROUND / 2, halfWidth: len / 2, halfHeight: GROUND / 2 });
    }
    solids.push({ x: pit.x + pit.w / 2, y: PIT_BOTTOM / 2, halfWidth: pit.w / 2, halfHeight: PIT_BOTTOM / 2 });
    cursor = pit.x + pit.w;
  }
  if (cursor < W) {
    const len = W - cursor;
    solids.push({ x: cursor + len / 2, y: GROUND / 2, halfWidth: len / 2, halfHeight: GROUND / 2 });
  }
  for (const b of g.blocks) if (b.filled) solids.push({ x: b.x, y: b.y, halfWidth: BLOCK / 2, halfHeight: BLOCK / 2 });
  return solids;
}

function overUnfilledPit(g: Game, x: number): boolean {
  const def = LEVELS[g.level];
  for (const pit of def.pits) {
    if (x > pit.x + 6 && x < pit.x + pit.w - 6) {
      let covered = false;
      for (const b of g.blocks) if (b.filled && Math.abs(b.x - x) < BLOCK / 2 + 4) covered = true;
      if (!covered) return true;
    }
  }
  return false;
}

interface Assets {
  penguin: Texture | null; iceblock: Texture | null; igloo: Texture | null; fish: Texture | null; seal: Texture | null;
  penguinParts: Solid[]; blockParts: Solid[]; penguinHW: number; penguinHH: number; blockHW: number; blockHH: number;
}

function pngSize(bytes: Uint8Array): { w: number; h: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Penguin Ice" },
  clear: { r: 0.62, g: 0.8, b: 0.94 },
  options: {},
  neutral: 0,
  encode: (input: unknown): number => {
    if (typeof input === "number") return input | 0;
    if (input && typeof input === "object") {
      const o = input as Record<string, unknown>;
      let v = 0;
      if (o.left || o.a) v |= BIT_LEFT;
      if (o.right || o.d) v |= BIT_RIGHT;
      if (o.action || o.jump || o.space || o.enter) v |= BIT_ACTION;
      if (o.restart || o.r) v |= BIT_RESTART;
      return v;
    }
    return 0;
  },
  random: (next: () => number): number => {
    let v = 0;
    if (next() < 0.34) v |= BIT_LEFT;
    if (next() < 0.42) v |= BIT_RIGHT;
    if (next() < 0.06) v |= BIT_ACTION;
    if (next() < 0.015) v |= BIT_RESTART;
    return v;
  },
  create: (platform: SimPlatform) => {
    const assets: Assets = {
      penguin: null, iceblock: null, igloo: null, fish: null, seal: null,
      penguinParts: [{ x: 0, y: 0, halfWidth: 26 * PENGUIN_SCALE, halfHeight: 28 * PENGUIN_SCALE }],
      blockParts: [{ x: 0, y: 0, halfWidth: 23, halfHeight: 23 }],
      penguinHW: 26, penguinHH: 28, blockHW: 23, blockHH: 23,
    };

    const ready = (async () => {
      // Hitboxes: needed for physics in every run, headless included.
      const loadHb = async (name: string): Promise<Hitbox | null> => {
        try {
          const bytes = await platform.load(`assets/${name}.hitbox.json`);
          return JSON.parse(new TextDecoder().decode(bytes)) as Hitbox;
        } catch { return null; }
      };
      const penguinHb = await loadHb("penguin");
      const blockHb = await loadHb("iceblock");
      assets.penguinParts = scaledParts(penguinHb, 56 * PENGUIN_SCALE, 58 * PENGUIN_SCALE);
      assets.blockParts = scaledParts(blockHb, BLOCK, BLOCK);
      const pb = bounds(assets.penguinParts);
      assets.penguinHW = pb.hw; assets.penguinHH = pb.hh;
      const bb = bounds(assets.blockParts);
      assets.blockHW = bb.hw; assets.blockHH = bb.hh;

      // Images + font only when frames will be drawn.
      if (platform.image && platform.draw) {
        const loadTex = async (name: string): Promise<Texture | null> => {
          try {
            const bytes = await platform.load(`assets/${name}.png`);
            // Read PNG size from the header (per spec); the decoded texture carries its own size too.
            void pngSize(bytes);
            return await platform.image!(bytes, true);
          } catch { return null; }
        };
        assets.penguin = await loadTex("penguin");
        assets.iceblock = await loadTex("iceblock");
        assets.igloo = await loadTex("igloo");
        assets.fish = await loadTex("fish");
        assets.seal = await loadTex("seal");
        try {
          const atlas = await platform.image(await platform.load("assets/fonts/archivo-black.png"), true);
          const metrics = new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json"));
          platform.draw.addFont(["archivo black", "sans-serif"], atlas, metrics);
        } catch { /* text will warn once if missing */ }
      }
    })();

    let game = createGame(1);

    const stepGame = (input: number): void => {
      const g = game;
      g.frame++;
      const pressed = input & ~g.prevInput;
      g.prevInput = input;

      // particles always tick
      for (const p of g.particles) {
        p.life++;
        p.x += p.vx * FIXED_STEP;
        p.y += p.vy * FIXED_STEP;
        p.vy -= 320 * FIXED_STEP;
      }
      g.particles = g.particles.filter((p) => p.life < p.max && p.y > -20);

      if (g.phase === "clear") {
        g.phaseTimer--;
        if (g.phaseTimer <= 0) {
          const next = Math.min(g.level + 1, LEVELS.length - 1);
          loadLevel(g, next, false);
        }
        return;
      }
      if (g.phase === "win" || g.phase === "over") {
        if (pressed & (BIT_ACTION | BIT_RESTART)) {
          game = createGame((g.rng || 777) + 1);
        }
        return;
      }

      // phase === play
      if (pressed & BIT_RESTART) {
        const sc = g.levelScoreStart;
        const lv = g.level;
        loadLevel(g, lv, false);
        g.score = sc;
        g.lives = 3;
        return;
      }

      const left = (input & BIT_LEFT) !== 0;
      const right = (input & BIT_RIGHT) !== 0;
      g.moving = left === right ? 0 : right ? 1 : -1;
      if (g.moving !== 0) g.face = g.moving;
      const wantVx = g.moving * SPEED;

      // Blocks that have been centred over a hole sink smoothly into it and plug it.
      const def = LEVELS[g.level];
      for (const b of g.blocks) {
        if (!b.sinking) continue;
        b.x += Math.max(-3, Math.min(3, b.sinkX - b.x));
        b.y -= 5;
        if (b.y <= PIT_BOTTOM + BLOCK / 2) {
          b.y = PIT_BOTTOM + BLOCK / 2;
          b.x = b.sinkX;
          b.sinking = false;
          b.filled = true;
          b.vy = 0;
          g.filledCount++;
          g.score += 150;
          spawnParticles(g, b.x, GROUND + 8, 0, 16);
        }
      }

      // Build physics bodies from plain state.
      const penguinBody: Body = {
        position: { x: g.px, y: g.py, z: 0 },
        velocity: { x: wantVx, y: g.pvy, z: 0 },
        halfWidth: assets.penguinHW, halfHeight: assets.penguinHH,
        parts: assets.penguinParts, onGround: g.onGround,
      };
      const bodies: Body[] = [penguinBody];
      const blockBodies: Body[] = [];
      for (const b of g.blocks) {
        if (b.filled || b.sinking) continue;
        const body: Body = {
          position: { x: b.x, y: b.y, z: 0 },
          velocity: { x: 0, y: b.vy, z: 0 },
          halfWidth: assets.blockHW, halfHeight: assets.blockHH,
          parts: assets.blockParts, onGround: b.onGround, pushable: true,
        };
        blockBodies.push(body);
        bodies.push(body);
      }
      stepBodies(bodies, solidsFor(g), GRAV, FIXED_STEP);

      g.px = penguinBody.position.x; g.py = penguinBody.position.y;
      g.pvy = penguinBody.velocity.y; g.pvx = penguinBody.velocity.x;
      g.onGround = penguinBody.onGround;
      let bi = 0;
      for (const b of g.blocks) {
        if (b.filled || b.sinking) continue;
        const body = blockBodies[bi++];
        b.x = body.position.x; b.y = body.position.y; b.vy = body.velocity.y; b.onGround = body.onGround;
        // hard clamp: nothing leaves the world
        b.x = Math.max(BLOCK / 2, Math.min(W - BLOCK / 2, b.x));
        b.y = Math.max(BLOCK / 2, Math.min(H - 10, b.y));
      }
      g.px = Math.max(26 * PENGUIN_SCALE, Math.min(W - 26 * PENGUIN_SCALE, g.px));
      g.py = Math.max(20, Math.min(H - 10, g.py));

      // A block centred over a hole starts sinking into it (see the sink tick above).
      for (const b of g.blocks) {
        if (b.filled || b.sinking || !b.onGround || b.y < GROUND - 4) continue;
        for (const pit of def.pits) {
          const centre = pit.x + pit.w / 2;
          if (Math.abs(b.x - centre) < 15) {
            b.sinking = true;
            b.sinkX = centre;
            b.vy = 0;
            spawnParticles(g, b.x, GROUND + 4, 1, 8);
          }
        }
      }

      // Fish pickup.
      for (const f of g.fishes) {
        if (!f.taken && Math.abs(f.x - g.px) < 40 && Math.abs(f.y - g.py) < 46) {
          f.taken = true;
          g.score += 100;
          spawnParticles(g, f.x, f.y, 2, 10);
        }
      }

      // Falling into open water: over a hole the penguin dips below its normal
      // standing height (GROUND + penguinHH, about 168) before it wedges on the rim.
      if (g.py < GROUND + 25 && overUnfilledPit(g, g.px)) {
        g.lives--;
        g.falls++;
        spawnParticles(g, g.px, PIT_BOTTOM + 30, 1, 18);
        if (g.lives <= 0) {
          g.phase = "over";
          g.phaseTimer = 0;
        } else {
          g.px = def.spawn; g.py = GROUND + 34 * PENGUIN_SCALE; g.pvy = 0;
        }
        return;
      }
      // Safety: fell anywhere below the world -> respawn as a fall.
      if (g.py < 34) {
        g.lives--;
        g.falls++;
        if (g.lives <= 0) { g.phase = "over"; }
        else { g.px = def.spawn; g.py = GROUND + 34 * PENGUIN_SCALE; g.pvy = 0; }
        return;
      }

      // Reach the igloo.
      if (g.px > def.iglooX - 52 && g.onGround) {
        g.score += 500;
        spawnParticles(g, def.iglooX - 40, GROUND + 60, 2, 18);
        if (g.level >= LEVELS.length - 1) g.phase = "win";
        else { g.phase = "clear"; g.phaseTimer = 110; }
      }
    };

    return {
      ready,
      start: (seed: number) => { game = createGame(seed); },
      step: (inputs: number[]) => stepGame(inputs[0] ?? 0),
      checksum: () => {
        const g = game;
        const c = createChecksum();
        c.add(g.frame).add(g.level).add(g.score).add(g.lives).add(g.px).add(g.py).add(g.pvy)
          .add(g.filledCount).add(g.falls).add(g.phase === "play" ? 1 : g.phase === "clear" ? 2 : g.phase === "win" ? 3 : 4);
        for (const b of g.blocks) c.add(b.x).add(b.y).add(b.filled ? 1 : 0);
        for (const f of g.fishes) c.add(f.taken ? 1 : 0);
        c.add(g.particles.length);
        return c.value();
      },
      state: () => {
        const g = game;
        const def = LEVELS[g.level];
        const totalCells = def.pits.reduce((s, p) => s + Math.round(p.w / BLOCK), 0);
        return {
          phase: g.phase, level: g.level + 1, score: g.score, lives: g.lives,
          penguin: { x: Math.round(g.px), y: Math.round(g.py) },
          blocks: g.blocks.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), filled: b.filled })),
          filled: g.filledCount, holesNeeded: totalCells,
          fishTaken: g.fishes.filter((f) => f.taken).length, fishTotal: g.fishes.length,
          falls: g.falls, frame: g.frame,
        };
      },
      over: () => game.phase === "win" || game.phase === "over",
      save: () => JSON.parse(JSON.stringify(game)) as unknown,
      restore: (snap: unknown) => { game = JSON.parse(JSON.stringify(snap)) as Game; },
      inspect: () => game,
      render: (draw) => {
        const g = game;
        const def = LEVELS[g.level];
        const sy = (y: number) => H - y;

        // sky bands
        draw.setFillStyle("#8ec9ee"); draw.fillRect(0, 0, W, 190);
        draw.setFillStyle("#bfe3f7"); draw.fillRect(0, 190, W, 130);
        draw.setFillStyle("#e8f6fd"); draw.fillRect(0, 320, W, 84);
        // distant hills
        draw.setFillStyle("#d7eefb");
        draw.beginPath(); draw.ellipse(170, 404, 240, 62, 0, 0, Math.PI * 2, false); draw.fill();
        draw.beginPath(); draw.ellipse(560, 404, 300, 76, 0, 0, Math.PI * 2, false); draw.fill();
        draw.setFillStyle("#c4e6f8");
        draw.beginPath(); draw.ellipse(860, 404, 220, 54, 0, 0, Math.PI * 2, false); draw.fill();
        // nieve abundante (determinista del frame: visible al instante, sin estado)
        draw.setFillStyle("#ffffff");
        for (let i = 0; i < 220; i++) {
          const baseX = (i * 149) % W;
          const fall = (g.frame * (1 + (i % 3) * 0.4) + i * 89) % (H + 20);
          const x = baseX + dsin(g.frame * 0.02 + i * 1.7) * 12;
          const y = fall - 10;
          draw.beginPath(); draw.arc(x, y, i % 4 === 0 ? 3 : 2, 0, Math.PI * 2, false); draw.fill();
        }
        // lluvia (determinista del frame: visible al instante, sin estado)
        draw.setStrokeStyle("#4a90c4"); draw.setLineWidth(2);
        draw.setGlobalAlpha(0.6);
        for (let i = 0; i < 120; i++) {
          const speed = 9 + (i % 4) * 2.5;
          const fall = (g.frame * speed + i * 137) % (H + 40);
          const baseX = (i * 197) % W;
          const rx = (baseX + fall * 0.18 + dsin(g.frame * 0.05 + i * 1.3) * 4 + W) % W;
          const ry = fall - 20;
          draw.beginPath(); draw.moveTo(rx, ry); draw.lineTo(rx - 5, ry + 16); draw.stroke();
        }
        draw.setGlobalAlpha(1);

        // seal spectator (decoration, behind everything on the ice)
        if (assets.seal) {
          const w = 76, h = 66;
          draw.drawImage(assets.seal, 0, 0, assets.seal.width, assets.seal.height, 8, sy(GROUND) - h + 4, w, h);
        }

        // ice floor: land segments, then holes
        const groundScreenY = sy(GROUND);
        draw.setFillStyle("#a9dcf5"); draw.fillRect(0, groundScreenY, W, H - groundScreenY);
        draw.setFillStyle("#8fd0f2"); draw.fillRect(0, groundScreenY, W, 8);
        draw.setFillStyle("#ffffff"); draw.fillRect(0, groundScreenY, W, 3);
        // cracks on the ice
        draw.setStrokeStyle("#7fc4ea"); draw.setLineWidth(2);
        for (let i = 0; i < 9; i++) {
          const cx = 60 + i * 108;
          draw.beginPath(); draw.moveTo(cx, groundScreenY + 42 + (i % 3) * 22);
          draw.lineTo(cx + 26, groundScreenY + 52 + (i % 3) * 22); draw.stroke();
        }
        for (const pit of def.pits) {
          const filledHere = g.blocks.some((b) => b.filled && b.x > pit.x - 4 && b.x < pit.x + pit.w + 4);
          // pit walls
          draw.setFillStyle("#5aa7d6");
          draw.fillRect(pit.x, groundScreenY, pit.w, sy(PIT_BOTTOM) - groundScreenY);
          // water
          draw.setFillStyle(filledHere ? "#4b96c9" : "#1477b8");
          draw.fillRect(pit.x + 3, groundScreenY + 10, pit.w - 6, sy(PIT_BOTTOM) - groundScreenY - 8);
          draw.setFillStyle("#7cc4ee");
          for (let k = 0; k < Math.max(1, Math.floor(pit.w / 32)); k++) {
            const wx = pit.x + 12 + k * 32 + dsin(g.frame * 0.06 + k * 2 + pit.x) * 3;
            draw.fillRect(wx, groundScreenY + 18 + (k % 2) * 8, 16, 3);
          }
          // rim
          draw.setFillStyle("#eaf8ff"); draw.fillRect(pit.x - 3, groundScreenY - 3, 6, 10); draw.fillRect(pit.x + pit.w - 3, groundScreenY - 3, 6, 10);
        }

        // igloo
        if (assets.igloo) {
          const w = 156, h = 124;
          draw.drawImage(assets.igloo, 0, 0, assets.igloo.width, assets.igloo.height, def.iglooX - w / 2, sy(GROUND) - h + 6, w, h);
        } else {
          draw.setFillStyle("#ffffff"); draw.fillRect(def.iglooX - 60, groundScreenY - 90, 120, 90);
        }
        // chimenea del iglu + humo (determinista del frame: visible al instante, sin estado)
        const chimX = def.iglooX + 18;
        const chimTop = groundScreenY - 118;
        draw.setFillStyle("#6b7280"); draw.fillRect(chimX - 11, chimTop - 22, 22, 26);
        draw.setFillStyle("#4b5563"); draw.fillRect(chimX - 13, chimTop - 26, 26, 6);
        for (let i = 0; i < 5; i++) {
          const t = ((g.frame * 0.9 + i * 22) % 88) / 88;
          const sx = chimX + dsin(g.frame * 0.05 + i * 2.1) * 6 + t * 16;
          const syy = chimTop - 30 - t * 64;
          draw.setGlobalAlpha(0.75 * (1 - t));
          draw.setFillStyle("#e5e7eb");
          draw.beginPath(); draw.arc(sx, syy, 5 + t * 8, 0, Math.PI * 2, false); draw.fill();
        }
        draw.setGlobalAlpha(1);
        // goal flag glow when close
        draw.setFillStyle("#ffb703");
        draw.beginPath(); draw.arc(def.iglooX - 40, sy(GROUND) - 96, 5 + dsin(g.frame * 0.08) * 1.5, 0, Math.PI * 2, false); draw.fill();

        // peces con brillo dorado (determinista del frame: visible al instante, sin estado)
        for (const f of g.fishes) {
          if (f.taken) continue;
          const bob = dsin(g.frame * 0.06 + f.x * 0.05) * 4;
          const fy = sy(f.y) + bob;
          const pulse = 20 + dsin(g.frame * 0.09 + f.x * 0.1) * 3;
          draw.setGlobalAlpha(0.45);
          draw.setFillStyle("#ffd700");
          draw.beginPath(); draw.arc(f.x, fy, pulse, 0, Math.PI * 2, false); draw.fill();
          draw.setGlobalAlpha(0.85);
          draw.setFillStyle("#ffef9e");
          draw.beginPath(); draw.arc(f.x, fy, pulse * 0.55, 0, Math.PI * 2, false); draw.fill();
          draw.setGlobalAlpha(1);
          if (assets.fish) {
            const w = 38, h = 27;
            draw.drawImage(assets.fish, 0, 0, assets.fish.width, assets.fish.height, f.x - w / 2, sy(f.y) - h / 2 + bob, w, h);
          } else {
            draw.setFillStyle("#ff8c42"); draw.beginPath(); draw.ellipse(f.x, sy(f.y) + bob, 14, 8, 0, 0, Math.PI * 2, false); draw.fill();
          }
        }

        // blocks
        for (const b of g.blocks) {
          if (assets.iceblock) {
            draw.drawImage(assets.iceblock, 0, 0, assets.iceblock.width, assets.iceblock.height, b.x - BLOCK / 2 - 3, sy(b.y) - BLOCK / 2 - 3, BLOCK + 6, BLOCK + 6);
          } else {
            draw.setFillStyle(b.filled ? "#bfe9ff" : "#9fd8f7"); draw.fillRect(b.x - 24, sy(b.y) - 24, 48, 48);
          }
          if (b.filled) {
            draw.setFillStyle("rgba(255,255,255,0.55)"); draw.fillRect(b.x - 24, sy(b.y) - 24, 48, 4);
          }
        }

        // penguin (waddle bob while walking)
        const bob = g.moving !== 0 && g.onGround ? Math.abs(dsin(g.frame * 0.32)) * 4 : 0;
        if (assets.penguin) {
          const w = 58 * PENGUIN_SCALE, h = 60 * PENGUIN_SCALE;
          draw.drawImage(assets.penguin, 0, 0, assets.penguin.width, assets.penguin.height, g.px - w / 2, sy(g.py + assets.penguinHH) - bob, w, h);
        } else {
          draw.setFillStyle("#22304a"); draw.beginPath(); draw.ellipse(g.px, sy(g.py), 20 * PENGUIN_SCALE, 24 * PENGUIN_SCALE, 0, 0, Math.PI * 2, false); draw.fill();
        }

        // particles
        for (const p of g.particles) {
          const a = 1 - p.life / p.max;
          draw.setGlobalAlpha(Math.max(0, a));
          draw.setFillStyle(p.kind === 1 ? "#39a7e8" : p.kind === 2 ? "#ffb703" : "#dff6ff");
          draw.beginPath(); draw.arc(p.x, sy(p.y), p.kind === 1 ? 4 : 3, 0, Math.PI * 2, false); draw.fill();
        }
        draw.setGlobalAlpha(1);

        // HUD bar
        draw.setFillStyle("rgba(10,42,67,0.78)"); draw.fillRect(0, 0, W, 52);
        draw.setFillStyle("#ffffff");
        try {
          draw.setFont('20px "Archivo Black"');
          draw.setTextAlign("left"); draw.setTextBaseline("middle");
          const totalCells = def.pits.reduce((s, p) => s + Math.round(p.w / BLOCK), 0);
          draw.fillText(`NIVEL ${g.level + 1}/3`, 16, 27);
          draw.fillText(`PUNTOS ${g.score}`, 190, 27);
          draw.fillText(`AGUJEROS ${g.filledCount}/${totalCells}`, 420, 27);
          draw.fillText(`PECES ${g.fishes.filter((f) => f.taken).length}/${g.fishes.length}`, 650, 27);
          draw.setFillStyle("#ff6b81");
          draw.fillText(`VIDAS ${g.lives}`, 830, 27);
        } catch { /* stub draw in headless purity checks */ }

        if (g.phase === "play" && g.frame < 360 && g.level === 0) {
          draw.setFillStyle("rgba(10,42,67,0.65)"); draw.fillRect(150, H - 44, 660, 32);
          draw.setFillStyle("#ffffff");
          try {
            draw.setFont('16px "Archivo Black"'); draw.setTextAlign("center");
            draw.fillText("FLECHAS PARA CAMINAR Y EMPUJAR - R PARA REINICIAR", W / 2, H - 27);
          } catch { /* ignore */ }
        }

        const banner = (title: string, sub: string) => {
          draw.setFillStyle("rgba(8,38,60,0.72)"); draw.fillRect(180, 190, 600, 150);
          draw.setStrokeStyle("#ffffff"); draw.setLineWidth(3); draw.strokeRect(180, 190, 600, 150);
          draw.setFillStyle("#ffffff");
          try {
            draw.setFont('34px "Archivo Black"'); draw.setTextAlign("center"); draw.setTextBaseline("middle");
            draw.fillText(title, W / 2, 240);
            draw.setFont('17px "Archivo Black"');
            draw.fillText(sub, W / 2, 292);
          } catch { /* ignore */ }
        };
        if (g.phase === "clear") banner("NIVEL COMPLETO!", `PUNTOS ${g.score} - SIGUIENTE NIVEL...`);
        else if (g.phase === "win") banner("LLEGASTE AL IGLU!", `GANASTE - PUNTOS ${g.score} - ESPACIO PARA JUGAR`);
        else if (g.phase === "over") banner("AL AGUA!", `SIN VIDAS - PUNTOS ${g.score} - ESPACIO PARA REINTENTAR`);
      },
    };
  },
});
