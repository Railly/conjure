import { createChecksum } from "dotframe/src/checksum";
import { dcos, dsin } from "dotframe/src/detmath";
import type { Draw2D } from "dotframe/src/draw2d";
import { createWorld, spawn, type World } from "dotframe/src/ecs";
import type { Texture } from "dotframe/src/gpu";
import { vec3, type Vec3 } from "dotframe/src/math";
import { createRenderer, type Environment, type Renderer } from "dotframe/src/render";
import { box } from "dotframe/src/shapes";
import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";

// Malcriadazo: Zarpa a Tiempo — rhythm/timing hunt on a 3D tiled patio.
const W = 960, H = 540;
const LEFT = 1, RIGHT = 2, SPACE = 4, ENTER = 8;
const TILE_COLS = 7, TILE_ROWS = 3;
const WORD = "MALCRIADAZO";

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; kind: number }
interface Floater { x: number; y: number; z: number; life: number; kind: number }
interface Mouse { active: number; kind: number; x: number; row: number; feinted: number; hop: number }
interface G {
  frame: number; phase: number; // 0 title 1 play 2 won 3 lost
  playFrame: number; rng: number; baseSeed: number; restarts: number;
  prev: number; caught: number; gold: number; misses: number; escapes: number;
  combo: number; bestCombo: number; score: number;
  charge: number; charging: number; holdMax: number; aimSel: number; aimRow: number;
  pawTimer: number; pawResolved: number; pawCharge: number; pawCol: number; pawRow: number;
  freeze: number; shake: number; bell: number; ring: number;
  flipCol: number; flipRow: number; flipTimer: number;
  spawnTimer: number; spawnCount: number; mouse: Mouse;
  particles: Particle[]; floaters: Floater[];
}

function rngNext(g: G): number { g.rng = (Math.imul(g.rng ^ 0x9e3779b9, 1664525) + 1013904223) >>> 0; return g.rng / 4294967296; }
function makeParticles(): Particle[] { const a: Particle[] = []; for (let i = 0; i < 140; i++) a.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, kind: 0 }); return a; }
function makeFloaters(): Floater[] { const a: Floater[] = []; for (let i = 0; i < 10; i++) a.push({ x: 0, y: 0, z: 0, life: 0, kind: 0 }); return a; }
function createGame(seed: number): G {
  return {
    frame: 0, phase: 0, playFrame: 0, rng: (seed * 2654435761) >>> 0 || 12345, baseSeed: seed >>> 0, restarts: 0,
    prev: 0, caught: 0, gold: 0, misses: 0, escapes: 0, combo: 0, bestCombo: 0, score: 0,
    charge: 0, charging: 0, holdMax: 0, aimSel: 0, aimRow: 1,
    pawTimer: 0, pawResolved: 1, pawCharge: 0, pawCol: 3, pawRow: 1,
    freeze: 0, shake: 0, bell: 0, ring: 0, flipCol: -1, flipRow: -1, flipTimer: 0,
    spawnTimer: 20, spawnCount: 0,
    mouse: { active: 1, kind: 0, x: -1, row: 1, feinted: 0, hop: 0 },
    particles: makeParticles(), floaters: makeFloaters(),
  };
}
function resetPlay(g: G): void {
  g.phase = 1; g.playFrame = 0; g.caught = 0; g.gold = 0; g.misses = 0; g.escapes = 0;
  g.combo = 0; g.bestCombo = 0; g.score = 0; g.charge = 0; g.charging = 0; g.holdMax = 0;
  g.aimSel = 0; g.aimRow = 1; g.pawTimer = 0; g.pawResolved = 1; g.freeze = 0; g.shake = 0;
  g.ring = 0; g.flipTimer = 0; g.spawnTimer = 12; g.spawnCount = 0;
  g.mouse.active = 0; g.mouse.x = -1; g.mouse.feinted = 0;
  for (const p of g.particles) p.life = 0;
  for (const f of g.floaters) f.life = 0;
}
function stageOf(g: G): number { return Math.min(3, Math.floor(g.playFrame / 900)); }
function beatFrames(g: G): number { return [40, 36, 32, 28][stageOf(g)]; }
function perfectWindow(g: G): number { return [0.30, 0.24, 0.18, 0.12][stageOf(g)]; }
function tileX(col: number): number { return (col - 3) * 1.35; }
function rowZ(row: number): number { return [-2.3, -0.65, 1.0][Math.max(0, Math.min(2, row))]; }

function burst(g: G, x: number, y: number, z: number, kind: number, n: number, speed: number): void {
  let done = 0;
  for (const p of g.particles) {
    if (p.life > 0) continue;
    const a = rngNext(g) * 6.28318, r = (0.3 + rngNext(g) * 0.7) * speed;
    p.x = x; p.y = y; p.z = z; p.vx = dcos(a) * r; p.vz = dsin(a) * r * 0.7; p.vy = 1.2 + rngNext(g) * 2.4;
    p.max = 26 + Math.floor(rngNext(g) * 22); p.life = p.max; p.kind = kind;
    if (++done >= n) break;
  }
}
function floater(g: G, x: number, y: number, z: number, kind: number): void {
  for (const f of g.floaters) if (f.life <= 0) { f.x = x; f.y = y; f.z = z; f.life = 70; f.kind = kind; return; }
}
function spawnMouse(g: G): void {
  const pat = [0, 1, 0, 0, 2, 0, 1, 0, 2, 0, 1, 0];
  g.mouse.kind = pat[g.spawnCount % pat.length];
  g.spawnCount++;
  g.mouse.active = 1; g.mouse.x = -0.2; g.mouse.feinted = 0;
  g.mouse.row = Math.floor(rngNext(g) * 3);
  if (g.mouse.row > 2) g.mouse.row = 2;
  g.aimRow = g.mouse.row;
}
function updateParticles(g: G): void {
  for (const p of g.particles) if (p.life > 0) { p.life--; p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.z += p.vz * 0.016; p.vy -= 0.09; if (p.y < 0.06) { p.y = 0.06; p.vy = 0; } }
  for (const f of g.floaters) if (f.life > 0) f.life--;
  if (g.shake > 0) g.shake = Math.max(0, g.shake - 0.7);
  if (g.bell > 0) g.bell--;
  if (g.ring > 0) g.ring--;
  if (g.flipTimer > 0) g.flipTimer--;
}
function resolvePaw(g: G): void {
  const m = g.mouse;
  const wx = tileX(g.pawCol), wz = rowZ(g.pawRow);
  if (!m.active) { burst(g, wx, 0.3, wz, 2, 8, 1.4); g.flipCol = g.pawCol; g.flipRow = g.pawRow; g.flipTimer = 14; return; }
  const mcol = Math.floor(m.x + 0.5);
  const radius = 0.70 + g.pawCharge * 1.9; // more charge: farther, wider paw
  const exact = mcol === g.pawCol && m.row === g.pawRow;
  const inArea = Math.abs(m.x - g.pawCol) <= radius && (m.row === g.pawRow || (g.pawCharge >= 0.55 && Math.abs(m.row - g.pawRow) === 1 && Math.abs(m.x - g.pawCol) <= radius * 0.8));
  if (!inArea) {
    // a paw while the mouse is still far from the hunting zone is just a whiff in the air, not one of the 5 misses
    if (m.x < 1.8 || m.x > 5.8) { burst(g, wx, 0.3, wz, 2, 8, 1.4); g.flipCol = g.pawCol; g.flipRow = g.pawRow; g.flipTimer = 14; floater(g, wx, 1.5, wz, 2); return; }
    registerMiss(g, wx, wz); return;
  }
  if (m.kind === 2) { // plush decoy: breaks the combo, but is not one of the 5 misses
    g.combo = 0; g.shake = 7; burst(g, wx, 0.4, wz, 3, 22, 2.4); floater(g, wx, 1.6, wz, 4);
    m.active = 0; g.spawnTimer = 34; return;
  }
  if (m.kind === 1 && g.pawCharge < 0.85) { // golden needs max charge: it slips away
    floater(g, wx, 1.7, wz, 5); burst(g, wx, 0.5, wz, 1, 14, 2); m.x += 1.4; g.shake = 3; return;
  }
  const frac = Math.abs(m.x - mcol);
  const perfect = exact && frac <= perfectWindow(g);
  g.caught++; if (m.kind === 1) g.gold++;
  g.combo++; g.bestCombo = Math.max(g.bestCombo, g.combo);
  g.score += perfect ? 300 : 150; if (m.kind === 1) g.score += 250;
  if (perfect) { g.freeze = 5; g.score += 0; floater(g, wx, 1.9, wz, 0); } else floater(g, wx, 1.7, wz, m.kind === 1 ? 3 : 1);
  g.shake = perfect ? 8 : 5;
  burst(g, wx, 0.45, wz, m.kind === 1 ? 1 : 0, perfect ? 34 : 22, perfect ? 3.4 : 2.4);
  if (g.combo >= 5) { g.ring = 34; burst(g, wx, 0.5, wz, 1, 18, 1.6); }
  m.active = 0; g.spawnTimer = 14;
  if (g.caught >= 15 && g.gold >= 2) g.phase = 2;
}
function registerMiss(g: G, wx: number, wz: number): void {
  g.misses++; g.combo = 0; g.shake = 6; g.flipCol = g.pawCol; g.flipRow = g.pawRow; g.flipTimer = 22;
  burst(g, wx, 0.3, wz, 2, 16, 2); floater(g, wx, 1.6, wz, 2); checkLose(g);
}
function checkLose(g: G): void { if (g.phase === 1 && (g.misses >= 5 || g.escapes >= 8)) g.phase = 3; }

function step(g: G, inputs: number[]): void {
  const bits = inputs[0] ?? 0;
  const pressed = bits & ~g.prev;
  g.frame++;
  if (g.freeze > 0) { g.freeze--; updateParticles(g); g.prev = bits; return; }

  if (g.phase === 0) {
    // demo mouse crosses on title
    g.mouse.x += 1 / 38;
    if (g.mouse.x > 7.4) { g.mouse.x = -1.1; g.mouse.row = (g.mouse.row + 1) % 3; }
    if (pressed & ENTER) resetPlay(g);
    updateParticles(g); g.prev = bits; return;
  }
  if (g.phase === 2 || g.phase === 3) {
    if (pressed & ENTER) { g.restarts++; g.rng = ((g.baseSeed + g.restarts * 7919) * 2654435761) >>> 0 || 999; resetPlay(g); }
    updateParticles(g); g.prev = bits; return;
  }

  // playing
  g.playFrame++;
  if (g.playFrame >= 3600) { g.phase = (g.caught >= 15 && g.gold >= 2) ? 2 : 3; g.prev = bits; return; }

  // mouse spawn / movement
  if (!g.mouse.active) { g.spawnTimer--; if (g.spawnTimer <= 0) spawnMouse(g); }
  else {
    if (!g.charging) g.aimRow = g.mouse.row;
    const before = Math.floor(g.mouse.x + 0.5);
    g.mouse.x += 1 / beatFrames(g);
    g.mouse.hop = Math.abs(dsin(Math.min(1, (g.mouse.x - Math.floor(g.mouse.x))) * 3.14159));
    const after = Math.floor(g.mouse.x + 0.5);
    if (after !== before) g.bell = 9;
    if (g.mouse.x > 7.55) {
      if (g.mouse.kind !== 2) { g.escapes++; g.combo = 0; floater(g, tileX(6), 1.5, rowZ(g.mouse.row), 6); checkLose(g); }
      else floater(g, tileX(6), 1.5, rowZ(g.mouse.row), 7);
      g.mouse.active = 0; g.spawnTimer = 34;
    }
  }

  // charge & aim
  if (g.pawTimer <= 0 && (bits & SPACE)) {
    if (!g.charging) { g.charging = 1; g.charge = 0; g.holdMax = 0; if (g.mouse.active) g.aimRow = g.mouse.row; }
    g.charge = Math.min(1, g.charge + 1 / 30);
    if (g.charge >= 1) g.holdMax++; else g.holdMax = 0;
    if (pressed & LEFT) g.aimSel = 0;
    if (pressed & RIGHT) g.aimSel = 1;
    // feint: holding max too long, the mouse smells it and dodges to a neighbour row + forward
    if (g.holdMax === 18 && g.mouse.active && !g.mouse.feinted) {
      g.mouse.feinted = 1;
      g.mouse.row = Math.max(0, Math.min(2, g.mouse.row + (rngNext(g) < 0.5 ? -1 : 1) || 1));
      if (g.mouse.row === g.aimRow) g.mouse.row = (g.mouse.row + 1) % 3;
      g.mouse.x += 0.55;
      floater(g, tileX(Math.floor(g.mouse.x + 0.5)), 1.7, rowZ(g.mouse.row), 8);
      burst(g, tileX(Math.floor(g.mouse.x + 0.5)), 0.4, rowZ(g.mouse.row), 2, 10, 1.6);
    }
  } else if (g.charging && !(bits & SPACE)) {
    // release: launch paw (a too-short tap is just a flinch, no paw and no miss)
    g.charging = 0;
    if (g.charge < 0.30) { g.charge = 0; g.holdMax = 0; }
    else {
      g.pawCharge = g.charge; g.pawCol = 3 + g.aimSel; g.pawRow = g.aimRow;
      g.pawTimer = 14; g.pawResolved = 0; g.charge = 0; g.holdMax = 0;
    }
  } else if (!g.charging && g.pawTimer <= 0) {
    // arrows can pre-aim between the two tiles even before charging (harmless, spec uses them while charging)
    if (pressed & LEFT) g.aimSel = 0;
    if (pressed & RIGHT) g.aimSel = 1;
  }
  if (g.charging && g.mouse.active && g.mouse.feinted === 0) { /* aim row stays locked at charge start */ }

  // paw arc
  if (g.pawTimer > 0) {
    g.pawTimer--;
    if (g.pawTimer === 7 && !g.pawResolved) { g.pawResolved = 1; resolvePaw(g); }
  }
  updateParticles(g);
  g.prev = bits;
}

// ---------- rendering helpers ----------
function quadMesh(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array; uvs: Float32Array } {
  return {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  };
}
const FLOATER_TEXT = ["!PERFECTO!", "!ATRAPADO!", "!FALLO!", "!DORADO!", "!PELUCHE!", "!CARGA MAX!", "!SE ESCAPO!", "PELUCHE SE VA", "!AMAGO!"];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Malcriadazo: Zarpa a Tiempo" },
  clear: { r: 0.98, g: 0.55, b: 0.32 },
  options: {},
  neutral: 0,
  rollbackWindow: 20,
  encode: (input: unknown): number => {
    if (typeof input === "number") return input | 0;
    const i = (input ?? {}) as Record<string, unknown>;
    let b = 0;
    if (i.left || i.a || i.A) b |= LEFT;
    if (i.right || i.d) b |= RIGHT;
    if (i.space || i.charge || i.hold) b |= SPACE;
    if (i.enter || i.start) b |= ENTER;
    return b;
  },
  random: (next: () => number): number => {
    let b = 0;
    if (next() < 0.34) b |= SPACE;
    if (next() < 0.18) b |= LEFT;
    if (next() < 0.18) b |= RIGHT;
    if (next() < 0.06) b |= ENTER;
    return b;
  },
  create: (platform: SimPlatform): SimRun => {
    let g = createGame(1);
    const gpuAny = platform.gpu as unknown as { createPipeline?: unknown } | undefined;
    const renderer: Renderer | null = gpuAny && typeof gpuAny.createPipeline === "function" ? createRenderer(platform.gpu) : null;
    const boxMesh = renderer ? renderer.addMesh(box()) : -1;
    const quad = renderer ? renderer.addMesh(quadMesh()) : -1;
    const world: World = createWorld();
    const mk = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Vec3, mesh = boxMesh): number => {
      const e = spawn(world);
      world.transforms.set(e, { position: vec3(x, y, z), rotation: vec3(0, 0, 0), scale: vec3(sx, sy, sz) });
      world.meshes.set(e, { mesh, color: c });
      return e;
    };
    // patio
    mk(0, -0.75, -2, 34, 1, 26, vec3(0.62, 0.30, 0.16)); // terracotta dirt
    mk(-8.6, -0.18, -1, 5.5, 0.25, 13, vec3(0.36, 0.48, 0.20));
    mk(8.6, -0.18, -1, 5.5, 0.25, 13, vec3(0.36, 0.48, 0.20));
    // barn at back
    mk(0, 2.4, -7.2, 16, 5.4, 0.6, vec3(0.55, 0.24, 0.14));
    mk(0, 2.2, -6.8, 4.6, 4.4, 0.35, vec3(0.38, 0.20, 0.12)); // door
    mk(-2.7, 5.25, -7.0, 7.2, 0.45, 1.5, vec3(0.30, 0.16, 0.10));
    mk(2.7, 5.25, -7.0, 7.2, 0.45, 1.5, vec3(0.30, 0.16, 0.10));
    world.transforms.get(world.nextEntity - 2)!.rotation = vec3(0, 0, 0.5);
    world.transforms.get(world.nextEntity - 1)!.rotation = vec3(0, 0, -0.5);
    // fence posts
    for (let i = 0; i < 5; i++) { mk(-7 + i * 3.5, 0.7, -5.6, 0.28, 1.6, 0.28, vec3(0.42, 0.26, 0.14)); }
    mk(0, 1.15, -5.6, 15, 0.22, 0.18, vec3(0.48, 0.30, 0.16));
    // tiles
    const tileE: number[] = [];
    for (let r = 0; r < TILE_ROWS; r++) for (let c = 0; c < TILE_COLS; c++) tileE.push(mk(tileX(c), -0.08, rowZ(r), 1.24, 0.22, 1.5, vec3(0.92, 0.84, 0.66)));
    // cat card + text card (filled with textures when available)
    const catE = mk(-3.5, 1.15, 3.6, 4.6, 2.95, 0.1, vec3(0.98, 0.82, 0.55), quad);
    const textE = mk(0, 2.55, -6.45, 5.6, 0.94, 0.1, vec3(0.12, 0.10, 0.10), quad);
    // paw: pad + toes
    const pawE: number[] = [
      mk(-3, 0.4, 3, 0.9, 0.35, 1.1, vec3(1.0, 0.88, 0.66)),
      mk(-3.35, 0.4, 2.55, 0.34, 0.3, 0.42, vec3(1.0, 0.78, 0.45)),
      mk(-3.0, 0.4, 2.48, 0.34, 0.3, 0.42, vec3(1.0, 0.78, 0.45)),
      mk(-2.65, 0.4, 2.55, 0.34, 0.3, 0.42, vec3(1.0, 0.78, 0.45)),
    ];
    // mouse: hand-drawn sticker on a quad + soft shadow + golden halo
    const mouseShadowE = mk(0, -5, 0, 1.1, 0.06, 0.7, vec3(0.30, 0.15, 0.08));
    const mouseGlowE = mk(0, -5, 0, 1.7, 1.1, 0.1, vec3(1.0, 0.76, 0.25), quad);
    const mouseBodyE = mk(0, -5, 0, 1.35, 0.95, 0.1, vec3(1, 1, 1), quad);
    // cat: ground shadow so the sketch sits in the 3D sunset light
    const catShadowE = mk(0, -5, 0, 3.0, 0.06, 1.4, vec3(0.32, 0.16, 0.09));
    // patio dressing: dirt patches, grass tufts, flowers, stones, clouds, barn trim
    let lcg = 1234567;
    const lnext = (): number => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return lcg / 4294967296; };
    for (let i = 0; i < 12; i++) {
      const px = -8 + lnext() * 16, pz = -5 + lnext() * 10;
      if (Math.abs(px) < 5.4 && pz > -3.6 && pz < 2.4) continue; // keep the tiles clean
      mk(px, -0.22, pz, 1 + lnext() * 2.2, 0.06, 0.8 + lnext() * 1.6, i % 2 ? vec3(0.55, 0.25, 0.13) : vec3(0.70, 0.36, 0.19));
    }
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const px = side * (6.2 + lnext() * 4.4), pz = -5 + lnext() * 10;
      const h = 0.25 + lnext() * 0.4;
      mk(px, 0.02 + h / 2, pz, 0.16, h, 0.16, vec3(0.28 + lnext() * 0.12, 0.44, 0.18));
      mk(px + 0.22 * side, 0.02 + h * 0.6, pz + 0.12, 0.12, h * 0.7, 0.12, vec3(0.32, 0.46, 0.18));
      if (lnext() < 0.35) mk(px + 0.2, 0.12, pz + 0.15, 0.15, 0.15, 0.15, lnext() < 0.5 ? vec3(1.0, 0.85, 0.3) : vec3(0.95, 0.95, 0.9));
    }
    for (let i = 0; i < 4; i++) mk(-10 + i * 6.5 + lnext() * 2, 8.5 + lnext() * 2.5, -15, 3.5 + lnext() * 2.5, 0.9, 0.6, vec3(1.0, 0.82, 0.68));
    for (let i = 0; i < 8; i++) mk(-6 + i * 1.7 + lnext() * 0.5, -0.15, 2.7 + (i % 2) * 0.35, 0.35, 0.18, 0.3, vec3(0.60, 0.55, 0.50));
    mk(0, 4.6, -6.85, 16.6, 0.5, 0.7, vec3(0.34, 0.18, 0.11)); // roof edge beam
    mk(-5.4, 3.1, -6.8, 1.1, 1.1, 0.2, vec3(0.95, 0.85, 0.60)); // barn window
    mk(-5.4, 3.1, -6.72, 0.12, 1.1, 0.22, vec3(0.40, 0.22, 0.13));
    mk(-5.4, 3.1, -6.72, 1.1, 0.12, 0.22, vec3(0.40, 0.22, 0.13));
    mk(0, 0.3, -6.7, 5.2, 0.35, 0.35, vec3(0.42, 0.24, 0.13)); // door step
    mk(-2.5, 2.2, -6.7, 0.25, 4.4, 0.2, vec3(0.46, 0.27, 0.14)); // door beams
    mk(2.5, 2.2, -6.7, 0.25, 4.4, 0.2, vec3(0.46, 0.27, 0.14));
    mk(0, -0.12, -3.35, 10.4, 0.2, 0.3, vec3(0.55, 0.26, 0.14)); // tile border trim
    mk(0, -0.12, 2.05, 10.4, 0.2, 0.3, vec3(0.55, 0.26, 0.14));
    mk(0, 1.15, -5.35, 15, 0.18, 0.14, vec3(0.52, 0.33, 0.17)); // second fence rail
    const lanternE = mk(3.6, 3.4, -6.55, 0.35, 0.5, 0.35, vec3(1.0, 0.60, 0.20));

    let catTex: Texture | null = null, textTex: Texture | null = null, mouseTex: Texture | null = null;
    let catW = 1422, catH = 913, mouseW = 860, mouseH = 630;
    const ready = (async () => {
      try {
        const hb = JSON.parse(new TextDecoder().decode(await platform.load("assets/cat.hitbox.json"))) as { width: number; height: number };
        catW = hb.width; catH = hb.height;
        await platform.load("assets/text.hitbox.json");
        const mhb = JSON.parse(new TextDecoder().decode(await platform.load("assets/mouse.hitbox.json"))) as { width: number; height: number };
        mouseW = mhb.width; mouseH = mhb.height;
      } catch { /* headless tolerant */ }
      if (platform.image) {
        try {
          catTex = await platform.image(await platform.load("assets/cat.png"), true);
          textTex = await platform.image(await platform.load("assets/text.png"), true);
          mouseTex = await platform.image(await platform.load("assets/mouse.png"), true);
        } catch { /* ignore */ }
      }
      if (platform.draw && platform.image) {
        try {
          platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json")));
          platform.draw.addFont(["bangers", "sans-serif"], await platform.image(await platform.load("assets/fonts/bangers.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/bangers.json")));
        } catch { /* ignore */ }
      }
    })();

    const setE = (e: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
      const t = world.transforms.get(e); if (t) { t.position = vec3(x, y, z); t.scale = vec3(sx, sy, sz); t.rotation = vec3(rx, ry, rz); }
    };
    const setColor = (e: number, c: Vec3, mesh = boxMesh, tex?: Texture | null, emissive = 0) => {
      world.meshes.set(e, tex ? { mesh: quad, color: c, texture: tex, alphaCutoff: 0.35, emissive } : { mesh, color: c, emissive });
    };

    return {
      ready,
      start: (seed: number) => { g = createGame(seed); },
      step: (inputs: number[]) => step(g, inputs),
      checksum: () => {
        const c = createChecksum();
        c.add(g.frame).add(g.phase).add(g.playFrame).add(g.caught).add(g.gold).add(g.misses).add(g.escapes).add(g.combo).add(g.charge).add(g.aimSel).add(g.pawTimer).add(g.mouse.x).add(g.mouse.row).add(g.mouse.active).add(g.score).add(g.rng);
        for (const p of g.particles) c.add(p.life).add(p.x);
        return c.value();
      },
      state: () => ({
        outcome: g.phase === 2 ? "won" : g.phase === 3 ? "lost" : "playing",
        progress: Math.round((Math.min(g.caught, 15) / 15 * 0.7 + Math.min(g.gold, 2) / 2 * 0.3) * 100) / 100,
        phase: g.phase, frame: g.frame, caught: g.caught, gold: g.gold, misses: g.misses, escapes: g.escapes,
        combo: g.combo, score: g.score, charge: Math.round(g.charge * 100) / 100,
        timeLeft: Math.max(0, Math.ceil((3600 - g.playFrame) / 60)), aimTile: 3 + g.aimSel,
        mouse: g.mouse.active ? { x: Math.round(g.mouse.x * 10) / 10, row: g.mouse.row, kind: g.mouse.kind } : null,
      }),
      over: () => g.phase === 2 || g.phase === 3,
      save: () => JSON.parse(JSON.stringify(g)) as unknown,
      restore: (s: unknown) => { const v = s as G; g.frame = v.frame; g.phase = v.phase; g.playFrame = v.playFrame; g.rng = v.rng; g.baseSeed = v.baseSeed; g.restarts = v.restarts; g.prev = v.prev; g.caught = v.caught; g.gold = v.gold; g.misses = v.misses; g.escapes = v.escapes; g.combo = v.combo; g.bestCombo = v.bestCombo; g.score = v.score; g.charge = v.charge; g.charging = v.charging; g.holdMax = v.holdMax; g.aimSel = v.aimSel; g.aimRow = v.aimRow; g.pawTimer = v.pawTimer; g.pawResolved = v.pawResolved; g.pawCharge = v.pawCharge; g.pawCol = v.pawCol; g.pawRow = v.pawRow; g.freeze = v.freeze; g.shake = v.shake; g.bell = v.bell; g.ring = v.ring; g.flipCol = v.flipCol; g.flipRow = v.flipRow; g.flipTimer = v.flipTimer; g.spawnTimer = v.spawnTimer; g.spawnCount = v.spawnCount; g.mouse = { active: v.mouse.active, kind: v.mouse.kind, x: v.mouse.x, row: v.mouse.row, feinted: v.mouse.feinted, hop: v.mouse.hop }; g.particles = v.particles.map(p => ({ ...p })); g.floaters = v.floaters.map(f => ({ ...f })); },
      inspect: () => g,
      render: (draw: Draw2D) => {
        // --- update 3D world from state (render-only) ---
        const t = g.frame / 60;
        const stage = stageOf(g);
        for (let r = 0; r < TILE_ROWS; r++) for (let c = 0; c < TILE_COLS; c++) {
          const e = tileE[r * TILE_COLS + c];
          const isAim = g.phase === 1 && (c === 3 || c === 4) && r === (g.mouse.active ? g.aimRow : g.aimRow);
          const isSel = isAim && c === 3 + g.aimSel;
          const flip = g.flipTimer > 0 && c === g.flipCol && r === g.flipRow;
          const pulse = 0.5 + 0.5 * dsin(g.frame * 0.18);
          const j = (((r * 7 + c * 13) % 5) - 2) * 0.014; // sun-baked variation per tile
          let col = (r + c) % 2 === 0 ? vec3(0.93 + j, 0.85 + j, 0.67 + j) : vec3(0.82 + j, 0.68 + j, 0.50 + j);
          let em = 0;
          if (isAim) { col = vec3(0.98, 0.78, 0.30); em = 0.25 + pulse * 0.25; }
          if (isSel) { col = vec3(1.0, 0.62, 0.18); em = 0.55 + pulse * 0.45; }
          if (g.bell > 0 && g.mouse.active && c === Math.floor(g.mouse.x + 0.5) && r === g.mouse.row) { col = vec3(1, 0.92, 0.55); em = 0.5; }
          setE(e, tileX(c), flip ? 0.12 : -0.08, rowZ(r), 1.24, 0.22, 1.5, flip ? -0.55 * (g.flipTimer / 22) : 0, 0, 0);
          world.meshes.set(e, { mesh: boxMesh, color: col, emissive: em });
        }
        // cat: framed fully on screen, sketch lit warm so it sits in the sunset
        const ch = g.charging ? g.charge : 0;
        const idleBob = dsin(t * 2.1) * 0.05;
        const mouseLook = g.mouse.active ? Math.max(-0.6, Math.min(0.6, (g.mouse.x - 3) * 0.12)) : 0;
        const titleMode = g.phase === 0;
        const catBaseW = titleMode ? 3.1 : 3.4, catBaseH = catBaseW * (catH / catW);
        const sx = catBaseW * (1 + ch * 0.16), sy = catBaseH * (1 - ch * 0.24);
        const catX = titleMode ? 2.75 : -1.95, catY = (titleMode ? 1.30 : 1.05) - ch * 0.16 + idleBob, catZ = titleMode ? 3.1 : 4.15;
        setE(catE, catX + mouseLook * 0.25, catY, catZ, sx, sy, 0.1, 0, titleMode ? -0.16 : 0.10 + mouseLook * 0.10, -ch * 0.06 + dsin(t * 1.3) * 0.02);
        setColor(catE, vec3(1, 1, 1), quad, catTex, 0.16);
        setE(catShadowE, catX + mouseLook * 0.25, -0.20, catZ - 0.55, sx * 0.9, 0.06, 1.0);
        // door sign only while playing: the title screen shows the logo once, up top
        if (titleMode) { setE(textE, 0, -6, 0, 0.01, 0.01, 0.01); }
        else {
          setE(textE, 0, 2.55 + (g.combo > 0 && g.shake > 0 ? dsin(g.frame * 2.4) * 0.03 * g.shake * 0.2 : 0), -6.45, 5.6, 0.94, 0.1);
          setColor(textE, vec3(1, 1, 1), quad, textTex, 0.05);
        }
        world.meshes.set(lanternE, { mesh: boxMesh, color: vec3(1.0, 0.60, 0.20), emissive: 0.9 + dsin(g.frame * 0.3) * 0.25 });
        // mouse: the player's drawing as a billboard sticker, tinted per kind
        const m = g.mouse;
        const mvis = m.active ? 1 : 0;
        const mx = tileX(m.x), mz = rowZ(m.row), my = 0.42 + (m.active ? Math.abs(dsin(g.frame * 0.45)) * 0.10 : 0);
        const mw = m.kind === 1 ? 1.7 : 1.45, mh = mw * (mouseH / mouseW);
        const mtint = m.kind === 1 ? vec3(1.0, 0.82, 0.35) : m.kind === 2 ? vec3(1.0, 0.62, 0.72) : vec3(1, 1, 1);
        const mem = m.kind === 1 ? 0.45 : 0.08;
        setE(mouseShadowE, mx, 0.02, mz, mvis ? mw * 0.8 : 0.01, 0.06, 0.55);
        if (m.kind === 1 && mvis) setE(mouseGlowE, mx, my + 0.05, mz - 0.08, mw * 1.3, mh * 1.3, 0.08);
        else setE(mouseGlowE, 0, -6, 0, 0.01, 0.01, 0.01);
        world.meshes.set(mouseGlowE, { mesh: quad, color: vec3(1.0, 0.70, 0.20), texture: mouseTex ?? undefined, alphaCutoff: 0.35, emissive: 0.75 });
        setE(mouseBodyE, mx, mvis ? my : -6, mz + 0.12, mw, mh, 0.1, 0, -0.18, dsin(g.frame * 0.45) * 0.03);
        world.meshes.set(mouseBodyE, { mesh: quad, color: mtint, texture: mouseTex ?? undefined, alphaCutoff: 0.35, emissive: mem });
        // paw arc
        let px = -1.30, py = 0.30, pz = 3.35, pScale = 1;
        if (g.pawTimer > 0) {
          const ph = 1 - g.pawTimer / 14; // 0..1
          const tx = tileX(g.pawCol), tz = rowZ(g.pawRow);
          const arc = ph < 0.5 ? ph * 2 : 1; // move out, then slam stays
          px = -1.30 + (tx + 1.30) * arc; pz = 3.35 + (tz - 3.35) * arc;
          py = 0.30 + dsin(Math.min(1, arc) * 3.14159) * 1.6 - (g.pawTimer <= 7 ? 0.25 : 0);
          pScale = 1.05 + g.pawCharge * 0.95;
          if (g.pawTimer <= 7) py = 0.32;
        } else if (g.charging) { px = -1.30 + dsin(g.frame * 0.8) * 0.05 * g.charge; py = 0.30 - g.charge * 0.12; pScale = 0.95 + g.charge * 0.55; }
        const flat = g.pawTimer > 0 && g.pawTimer <= 7 ? 0.45 : 1;
        setE(pawE[0], px, py, pz, 0.95 * pScale, 0.36 * flat * pScale, 1.15 * pScale);
        setE(pawE[1], px - 0.36 * pScale, py + 0.03, pz - 0.48 * pScale, 0.34 * pScale, 0.3 * flat * pScale, 0.44 * pScale);
        setE(pawE[2], px, py + 0.03, pz - 0.55 * pScale, 0.34 * pScale, 0.3 * flat * pScale, 0.44 * pScale);
        setE(pawE[3], px + 0.36 * pScale, py + 0.03, pz - 0.48 * pScale, 0.34 * pScale, 0.3 * flat * pScale, 0.44 * pScale);

        // particles (glow + dust)
        const parts: number[] = [], glow: number[] = [];
        for (const p of g.particles) if (p.life > 0) {
          const u = p.life / p.max;
          const arr = p.kind === 1 ? glow : parts;
          const colr = p.kind === 1 ? [1, 0.78, 0.25] : p.kind === 3 ? [0.95, 0.55, 0.68] : p.kind === 2 ? [0.75, 0.62, 0.48] : [1, 0.85, 0.55];
          arr.push(p.x, p.y, p.z, 0.16 + (1 - u) * 0.12, colr[0], colr[1], colr[2], Math.min(1, u * 1.6));
        }
        if (g.ring > 0) { // purr concentric rings around cat
          for (let ringI = 0; ringI < 2; ringI++) {
            const rr = (34 - g.ring) * 0.09 + ringI * 0.55;
            for (let i = 0; i < 22; i++) { const a = (i / 22) * 6.28318; glow.push(catX + dcos(a) * rr, catY + dsin(a) * rr * 0.55, catZ - 0.2, 0.18, 1, 0.75, 0.35, Math.max(0, g.ring / 34) * 0.7); }
          }
        }
        const shakeX = g.shake > 0 ? dsin(g.frame * 3.1) * 0.03 * g.shake : 0;
        const shakeY = g.shake > 0 ? dcos(g.frame * 2.7) * 0.02 * g.shake : 0;
        const env: Environment = {
          ambient: vec3(0.55, 0.42, 0.34),
          sun: { direction: vec3(-0.45, 0.75, 0.45), color: vec3(1.0, 0.62, 0.34), shadows: 22 },
          fog: { color: vec3(0.98, 0.55, 0.32), density: 0.012, scatter: 0.6 },
          exposure: 1.05, time: t, particles: parts, glow,
          sky: { zenith: vec3(0.32, 0.28, 0.52), horizon: vec3(0.99, 0.55, 0.30), ground: vec3(0.45, 0.24, 0.16), curve: 0.35, sun: { direction: vec3(-0.45, 0.28, -0.6), color: vec3(1, 0.55, 0.25), size: 0.09 } },
          lights: [{ position: vec3(0, 3.5, 1), color: vec3(1, 0.6, 0.3), range: 14 }],
        };
        if (renderer) draw.scene(renderer.draws(world, { eye: vec3(shakeX, 6.3 + shakeY, 8.6), target: vec3(shakeX * 0.5, 0.2, -1.1), fovY: 0.92 }, env));

        // ---------- HUD ----------
        const tl = Math.max(0, Math.ceil((3600 - g.playFrame) / 60));
        if (g.phase !== 0) {
        draw.setFillStyle("rgba(20,10,8,0.28)"); draw.fillRect(0, 0, W, 58);
        draw.setTextAlign("left"); draw.setTextBaseline("middle");
        draw.setFont('900 21px "archivo black", sans-serif'); draw.setFillStyle("#fff3d6");
        draw.fillText(`TIEMPO ${tl}`, 18, 30);
        // time bar
        draw.setFillStyle("#3a2118"); draw.fillRect(190, 22, 220, 16);
        draw.setFillStyle(tl <= 10 && g.phase === 1 ? "#ff4444" : "#ffb340"); draw.fillRect(192, 24, 216 * (g.phase === 0 ? 1 : tl / 60), 12);
        draw.setFont('900 17px "archivo black", sans-serif'); draw.setFillStyle("#ffe9b8");
        draw.fillText(`RATONES ${g.caught}/15`, 425, 30);
        draw.setFillStyle("#ffd23e"); draw.fillText(`DORADOS ${g.gold}/2`, 575, 30);
        draw.setFillStyle("#ff8a7a"); draw.fillText(`FALLOS ${g.misses}/5`, 715, 30);
        draw.setFillStyle("#cfe8ff"); draw.fillText(`PTS ${g.score}`, 845, 30);
        }
        // combo letters from the drawing, letter by letter
        if (textTex && g.phase === 1) {
          const letters = Math.min(g.combo, WORD.length);
          const lw = 30, total = lw * WORD.length;
          if (letters > 0) { draw.setFillStyle("rgba(255,240,200,0.88)"); draw.fillRect(W / 2 - total / 2 - 6, 60, total + 12, 26); }
          for (let i = 0; i < letters; i++) {
            const sw = textTex.width / WORD.length;
            draw.drawImage(textTex, i * sw, 0, sw, textTex.height, W / 2 - total / 2 + i * lw, 62, lw - 2, 20);
          }
          if (g.combo >= 2) { draw.setFont('900 16px "archivo black", sans-serif'); draw.setTextAlign("center"); draw.setFillStyle("#ffdf7a"); draw.fillText(`COMBO x${g.combo}`, W / 2, 90); draw.setTextAlign("left"); }
        }
        // escapes pips
        if (g.phase === 1) {
          draw.setFont('900 14px "archivo black", sans-serif'); draw.setFillStyle("#ffd9c9");
          draw.fillText(`ESCAPES ${g.escapes}/8`, 18, 76);
          // charge bar
          draw.setFillStyle("rgba(20,10,8,0.45)"); draw.fillRect(W - 246, H - 56, 228, 34);
          draw.setFillStyle("#2a1a12"); draw.fillRect(W - 238, H - 38, 212, 14);
          draw.setFillStyle(g.charge >= 0.85 ? "#ffd23e" : g.charge >= 0.5 ? "#ff9a3c" : "#ffe9b8");
          if (g.charging || g.charge > 0) draw.fillRect(W - 236, H - 36, 208 * g.charge, 10);
          draw.setFont('900 12px "archivo black", sans-serif'); draw.setFillStyle("#fff3d6");
          draw.fillText(g.mouse.active && g.mouse.kind === 1 ? "DORADO: !CARGA MAX!" : g.charging ? "CARGANDO... !SUELTA!" : "MANTEN ESPACIO", W - 238, H - 46);
          draw.setTextAlign("center"); draw.setFillStyle("#ffe9b8"); draw.setFont('900 15px "archivo black", sans-serif');
          draw.fillText(`BALDOSA ${g.aimSel === 0 ? "IZQUIERDA" : "DERECHA"}  <- -> PARA CAMBIAR`, W / 2, H - 24);
          draw.setTextAlign("left");
          if (g.mouse.active && g.mouse.kind === 2) { draw.setTextAlign("center"); draw.setFont('900 17px "bangers", sans-serif'); draw.setFillStyle("#ff9ec4"); draw.fillText("!ES UN PELUCHE! NO LO APLASTES", W / 2, 112); draw.setTextAlign("left"); }
          if (g.mouse.active && g.mouse.kind === 1) { draw.setTextAlign("center"); draw.setFont('900 17px "bangers", sans-serif'); draw.setFillStyle("#ffd23e"); draw.fillText("!RATON DORADO!", W / 2, 112); draw.setTextAlign("left"); }
          void stage;
        }
        // floaters (project roughly: world x/z to screen)
        draw.setTextAlign("center");
        for (const f of g.floaters) if (f.life > 0) {
          const sx2 = W / 2 + f.x * 62, sy2 = 300 - f.z * 34 - (70 - f.life) * 0.8;
          const scale = f.kind === 0 ? 34 : 24;
          draw.setFont(`900 ${scale}px "bangers", sans-serif`);
          draw.setFillStyle("rgba(30,12,6,0.75)"); draw.fillText(FLOATER_TEXT[f.kind], sx2 + 2, sy2 + 2);
          draw.setFillStyle(f.kind === 0 ? "#ffe23e" : f.kind === 2 || f.kind === 4 ? "#ff7a6a" : f.kind === 3 || f.kind === 1 ? "#a8ffb0" : "#ffd9a0");
          draw.fillText(FLOATER_TEXT[f.kind], sx2, sy2);
        }
        draw.setTextAlign("left");
        // screens
        if (g.phase === 0) {
          // slim top logo plate + bottom instructions: the 3D scene stays visible
          draw.setFillStyle("rgba(28,10,18,0.50)"); draw.fillRect(0, 0, W, 118);
          if (textTex) {
            const lw = 440, lh = lw * textTex.height / textTex.width;
            draw.drawImage(textTex, 0, 0, textTex.width, textTex.height, W / 2 - lw / 2, 12, lw, lh);
          } else { draw.setTextAlign("center"); draw.setFont('900 44px "archivo black", sans-serif'); draw.setFillStyle("#ffe9b8"); draw.fillText("MALCRIADAZO", W / 2, 52); }
          draw.setTextAlign("center"); draw.setFont('900 22px "bangers", sans-serif'); draw.setFillStyle("#ffd23e");
          draw.fillText("ZARPA A TIEMPO", W / 2, 100);
          draw.setFillStyle("rgba(28,10,18,0.60)"); draw.fillRect(60, 386, W - 120, 92);
          draw.setFont('900 15px "archivo black", sans-serif'); draw.setFillStyle("#fff3d6");
          draw.fillText("Manten ESPACIO para cargar. Suelta cuando el raton pise tu baldosa.", W / 2, 410);
          draw.fillText("Flechas: elegir baldosa. Dorado = carga maxima. !No aplastes peluches!", W / 2, 434);
          draw.fillText("Caza 15 ratones (2 dorados) en 60s. Fallas 5 o se escapan 8 y pierdes.", W / 2, 458);
          if (Math.floor(g.frame / 30) % 2 === 0) { draw.setFont('900 24px "archivo black", sans-serif'); draw.setFillStyle("#ffffff"); draw.fillText("PULSA ENTER", W / 2, 512); }
          draw.setTextAlign("left");
        }
        if (g.phase === 2 || g.phase === 3) {
          draw.setFillStyle("rgba(20,8,10,0.62)"); draw.fillRect(0, 0, W, H);
          draw.setTextAlign("center");
          draw.setFont('900 52px "bangers", sans-serif'); draw.setFillStyle(g.phase === 2 ? "#ffd23e" : "#ff7a6a");
          draw.fillText(g.phase === 2 ? "!CAZA COMPLETA!" : "!SE ACABO LA CAZA!", W / 2, 190);
          if (catTex && g.phase === 2) draw.drawImage(catTex, 0, 0, catTex.width, catTex.height, W / 2 - 130, 215, 260, 260 * catTex.height / catTex.width);
          draw.setFont('900 22px "archivo black", sans-serif'); draw.setFillStyle("#fff3d6");
          draw.fillText(`Ratones ${g.caught}   Dorados ${g.gold}   Puntos ${g.score}`, W / 2, g.phase === 2 ? 420 : 280);
          draw.fillText(`Mejor combo x${g.bestCombo}   Fallos ${g.misses}   Escapes ${g.escapes}`, W / 2, g.phase === 2 ? 452 : 312);
          if (Math.floor(g.frame / 30) % 2 === 0) draw.fillText("ENTER PARA JUGAR DE NUEVO", W / 2, 500);
          draw.setTextAlign("left");
        }
      },
    };
  },
});
