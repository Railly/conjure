import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, shake, shakeOffset, sky, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["penguin", "cube", "igloo", "fish", "snowflake"];
const COLS = 10, ROWS = 8, CELL = 52;
const BW = COLS * CELL, BH = ROWS * CELL;
const OX = (W - BW) / 2, OY = 78;
const RESTART = 64;

type Pt = { x: number; y: number };
interface Cube { id: number; gx: number; gy: number; px: number; py: number; alive: boolean; rot: number }
interface Seg { who: string; path: Pt[]; i: number; t: number; fall: boolean; shatter: boolean; spins: number[] }
interface LevelDef { name: string; hint: string; rows: string[] }

const LEVELS: LevelDef[] = [
  { name: "Floe 1 · First Brake", hint: "Slide RIGHT — stop on the fish, not past it!", rows: [
    "..........","..##......","..........",".P...FC...","..........","....##....","..........",".........."] },
  { name: "Floe 2 · Park the Brake", hint: "Park the cube, then come back for supper", rows: [
    "..........",".#.....#..","......F...","..........",".......C..","#.........",".P......#.",".........."] },
  { name: "Floe 3 · Spin Supper", hint: "Snowflakes turn you 90° clockwise!", rows: [
    "..........",".P...*....","..........","..#.......",".....F....",".....C..#.","..........",".........."] },
  { name: "Floe 4 · Cube Curl", hint: "Push the cube round the corner first", rows: [
    "..........","..........",".PC...*...","..........","......F...","..........","......#...",".........."] },
  { name: "Floe 5 · Double Curl Feast", hint: "Two spins for the cube, two for you!", rows: [
    ".....#....","...#......",".PC....*..","..........","..........","....F.....","...#...*..",".........."] },
];

interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  level: number; moves: number; totalMoves: number;
  peng: { gx: number; gy: number; px: number; py: number; rot: number; dirX: number; dirY: number };
  cubes: Cube[]; walls: Set<string>; spins: Set<string>; fish: Pt;
  segs: Seg[]; active: Seg | null;
  celebrate: number; loseMsg: string; wonLevel: boolean; waddle: number; squashT: number; feetT: number;
  j: Juice;
}
const key = (x: number, y: number) => `${x},${y}`;
const fresh = (seed: number, scene: Scene = "title"): Game => ({
  scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed), level: 0, moves: 0, totalMoves: 0,
  peng: { gx: 1, gy: 3, px: 1, py: 3, rot: 0, dirX: 1, dirY: 0 }, cubes: [], walls: new Set(), spins: new Set(), fish: { x: 5, y: 3 },
  segs: [], active: null, celebrate: 0, loseMsg: "", wonLevel: false, waddle: 0, squashT: 0, feetT: 0, j: juice(),
});
function loadLevel(g: Game, idx: number) {
  const def = LEVELS[idx]!; g.level = idx; g.moves = 0; g.segs = []; g.active = null; g.celebrate = 0; g.wonLevel = false;
  g.walls = new Set(); g.spins = new Set(); g.cubes = []; let id = 1;
  def.rows.forEach((row, y) => { [...row].forEach((ch, x) => {
    if (ch === "#") g.walls.add(key(x, y));
    if (ch === "*") g.spins.add(key(x, y));
    if (ch === "F") g.fish = { x, y };
    if (ch === "P") { g.peng.gx = x; g.peng.gy = y; g.peng.px = x; g.peng.py = y; g.peng.rot = 0; }
    if (ch === "C") g.cubes.push({ id: id++, gx: x, gy: y, px: x, py: y, alive: true, rot: 0 });
  }); });
}

const cw = (d: Pt): Pt => d.x === 1 ? { x: 0, y: 1 } : d.y === 1 ? { x: -1, y: 0 } : d.x === -1 ? { x: 0, y: -1 } : { x: 1, y: 0 };

interface SlideRes { path: Pt[]; outcome: "stop" | "off" | "shatter"; blockerId: number; spun: boolean }
function slidePath(g: Game, start: Pt, dir: Pt, excludeId: string, pengPos: Pt): SlideRes {
  let cur = { ...start }, d = { ...dir }; const path: Pt[] = []; const visited = new Set<string>([`${cur.x},${cur.y},${d.x},${d.y}`]);
  let spun = false, justSpun = false;
  for (let n = 0; n < 80; n++) {
    const nx = cur.x + d.x, ny = cur.y + d.y;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { path.push({ x: nx, y: ny }); return { path, outcome: "off", blockerId: 0, spun }; }
    if (g.walls.has(key(nx, ny))) {
      if (justSpun && excludeId.startsWith("c")) return { path, outcome: "shatter", blockerId: 0, spun };
      return { path, outcome: "stop", blockerId: 0, spun };
    }
    // blockers
    if (excludeId !== "p" && pengPos.x === nx && pengPos.y === ny) return { path, outcome: "stop", blockerId: -1, spun };
    const cube = g.cubes.find(c => c.alive && `c${c.id}` !== excludeId && c.gx === nx && c.gy === ny);
    if (cube) return { path, outcome: "stop", blockerId: cube.id, spun };
    cur = { x: nx, y: ny }; path.push({ ...cur }); justSpun = false;
    if (g.spins.has(key(nx, ny))) {
      d = cw(d); spun = true; justSpun = true;
      const vk = `${cur.x},${cur.y},${d.x},${d.y}`;
      if (visited.has(vk)) return { path, outcome: "stop", blockerId: 0, spun };
      visited.add(vk);
    }
  }
  return { path, outcome: "stop", blockerId: 0, spun };
}

// Plan a cube slide (recursive chain) into segments, mutating logical positions.
function planCube(g: Game, cube: Cube, dir: Pt, pengPos: Pt, segs: Seg[], depth: number) {
  const res = slidePath(g, { x: cube.gx, y: cube.gy }, dir, `c${cube.id}`, pengPos);
  const spinIdx: number[] = []; res.path.forEach((p, i) => { if (g.spins.has(key(p.x, p.y))) spinIdx.push(i); });
  if (res.blockerId > 0 && depth < 4) {
    const other = g.cubes.find(c => c.id === res.blockerId)!;
    // other will be planned after this cube reaches it (visually)
    if (res.path.length) { cube.gx = res.path[res.path.length - 1]!.x; cube.gy = res.path[res.path.length - 1]!.y; }
    segs.push({ who: `c${cube.id}`, path: res.path, i: 0, t: 0, fall: false, shatter: false, spins: spinIdx });
    planCube(g, other, dir, pengPos, segs, depth + 1);
    return;
  }
  const fall = res.outcome === "off", shatter = res.outcome === "shatter";
  if (!fall && res.path.length) { cube.gx = res.path[res.path.length - 1]!.x; cube.gy = res.path[res.path.length - 1]!.y; }
  if (fall && res.path.length) { cube.gx = res.path[res.path.length - 1]!.x; cube.gy = res.path[res.path.length - 1]!.y; }
  segs.push({ who: `c${cube.id}`, path: res.path, i: 0, t: 0, fall, shatter, spins: spinIdx });
}

function startPenguinSlide(g: Game, dir: Pt) {
  if (g.active || g.segs.length || g.celebrate) return;
  g.moves++; g.totalMoves++; g.waddle = 5; g.peng.dirX = dir.x; g.peng.dirY = dir.y;
  const res = slidePath(g, { x: g.peng.gx, y: g.peng.gy }, dir, "p", { x: -99, y: -99 });
  const spinIdx: number[] = []; res.path.forEach((p, i) => { if (g.spins.has(key(p.x, p.y))) spinIdx.push(i); });
  const fall = res.outcome === "off";
  const stopPos = res.path.length ? res.path[res.path.length - 1]! : { x: g.peng.gx, y: g.peng.gy };
  const segs: Seg[] = [];
  segs.push({ who: "p", path: res.path, i: 0, t: 0, fall, shatter: false, spins: spinIdx });
  // logical penguin stop (before blocker)
  if (!fall) { g.peng.gx = stopPos.x; g.peng.gy = stopPos.y; }
  if (res.blockerId > 0) {
    const cube = g.cubes.find(c => c.id === res.blockerId)!;
    // cube direction is penguin's direction at contact: if penguin spun, recompute dir by last step
    let cdir = dir;
    if (res.path.length >= 1) {
      const last = res.path[res.path.length - 1]!; const prevP = res.path.length >= 2 ? res.path[res.path.length - 2]! : null;
      const from = prevP ?? { x: g.peng.px, y: g.peng.py };
      // direction from penguin stop toward cube original position is cube-before minus stop; cube still at original
      cdir = { x: Math.sign(cube.gx - stopPos.x), y: Math.sign(cube.gy - stopPos.y) };
      if (cdir.x === 0 && cdir.y === 0) cdir = { x: Math.sign(cube.gx - from.x), y: Math.sign(cube.gy - from.y) };
    }
    planCube(g, cube, cdir, stopPos, segs, 0);
  }
  // If penguin didn't move and no cube pushed, refund move
  if (!res.path.length && !res.blockerId) { g.moves--; g.totalMoves--; return; }
  g.segs = segs;
}

function finishMove(g: Game) {
  if (g.peng.gx === g.fish.x && g.peng.gy === g.fish.y) {
    g.wonLevel = true; g.celebrate = 80; g.feetT = 70; g.squashT = 12;
    const cx = OX + (g.fish.x + .5) * CELL, cy = OY + (g.fish.y + .5) * CELL;
    burst(g.j, g.r, cx, cy, 34, "#ff8c2e", 6, 7); burst(g.j, g.r, cx, cy, 20, "#ffd23f", 5, 5);
    floatText(g.j, cx, cy - 42, "YUM!", "#ff8c2e"); shake(g.j, 5);
    return;
  }
  if (!g.cubes.some(c => c.alive)) {
    g.loseMsg = "OUT OF BRAKES!"; g.scene = "lost"; g.sceneFrames = 0;
    const cx = OX + (g.peng.px + .5) * CELL, cy = OY + (g.peng.py + .5) * CELL;
    floatText(g.j, cx, cy - 40, "OUT OF BRAKES!", "#ff8a8a"); shake(g.j, 10);
  }
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); g.prev = keys; g.frame++; juiceStep(g.j);
  if (g.squashT > 0) g.squashT--; if (g.feetT > 0) g.feetT--; if (g.waddle > 0) g.waddle--;
  // scene transitions
  if (g.scene !== "play") {
    g.sceneFrames++;
    if ((edge & (KEY.start | KEY.action)) && g.sceneFrames > 20) {
      const wasLost = g.scene === "lost";
      const lvl = g.level;
      if (wasLost) { const keepTotal = g.totalMoves; loadLevel(g, lvl); g.totalMoves = keepTotal; }
      else { loadLevel(g, 0); g.totalMoves = 0; }
      g.scene = "play"; g.sceneFrames = 0;
    }
    return;
  }
  if (edge & RESTART) { loadLevel(g, g.level); floatText(g.j, W/2, 64, "RESTART!", "#ffffff"); return; }
  // celebration -> next level / final win
  if (g.celebrate > 0) {
    g.celebrate--;
    if (g.celebrate === 0) {
      if (g.level >= LEVELS.length - 1) { g.scene = "won"; g.sceneFrames = 0; }
      else loadLevel(g, g.level + 1);
    }
    return;
  }
  // animation
  if (!g.active && g.segs.length) g.active = g.segs.shift()!;
  if (g.active) {
    const seg = g.active;
    const ent = seg.who === "p" ? g.peng : g.cubes.find(c => `c${c.id}` === seg.who)!;
    if (seg.path.length === 0) {
      // instant bump (penguin adjacent to cube) - still trigger cube next
      g.active = null;
      if (!g.segs.length) finishMove(g);
      return;
    }
    const target = seg.path[seg.i]!;
    const speed = 0.42;
    ent.px += Math.sign(target.x - ent.px) * Math.min(speed, Math.abs(target.x - ent.px) || 0);
    ent.py += Math.sign(target.y - ent.py) * Math.min(speed, Math.abs(target.y - ent.py) || 0);
    // smoother: snap approach
    if (Math.abs(ent.px - target.x) < 0.45 && Math.abs(ent.py - target.y) < 0.45) {
      ent.px = target.x; ent.py = target.y;
      const cx = OX + (target.x + .5) * CELL, cy = OY + (target.y + .5) * CELL;
      if (seg.spins.includes(seg.i)) {
        burst(g.j, g.r, cx, cy, 16, "#bdeaff", 4, 5); floatText(g.j, cx, cy - 30, "SPIN!", "#7dd7ff");
        if (seg.who === "p") g.peng.rot += Math.PI / 2; else { const c = ent as Cube; c.rot += Math.PI / 2; }
      } else if (seg.who !== "p") {
        // frosty trail
        g.j.particles.push({ x: cx + range(g.r, -12, 12), y: cy + 16, vx: range(g.r, -0.4, 0.4), vy: range(g.r, -0.3, 0.1), life: 18, max: 18, size: 4, color: "#dff6ff" });
      }
      seg.i++;
      if (seg.i >= seg.path.length) {
        // segment done
        if (seg.who === "p") { g.peng.gx = ent.px; g.peng.gy = ent.py; g.squashT = 10; }
        if (seg.fall) {
          if (seg.who === "p") {
            burst(g.j, g.r, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL, 30, "#7dd7ff", 6, 7);
            shake(g.j, 12); g.loseMsg = "SPLASH!"; g.scene = "lost"; g.sceneFrames = 0;
          } else { (ent as Cube).alive = false; burst(g.j, g.r, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL, 22, "#7dd7ff", 5, 6); floatText(g.j, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL - 20, "SPLASH!", "#7dd7ff"); }
        } else if (seg.shatter) {
          (ent as Cube).alive = false; burst(g.j, g.r, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL, 28, "#ffffff", 6, 6); shake(g.j, 12); floatText(g.j, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL - 24, "SHATTER!", "#ffffff");
        } else if (seg.who !== "p") {
          // impact thud if stopped near wall/cube (always small)
          burst(g.j, g.r, OX + (ent.px + .5) * CELL, OY + (ent.py + .5) * CELL, 8, "#ffffff", 3, 4); shake(g.j, 3);
          const c = ent as Cube; c.gx = c.px; c.gy = c.py;
        }
        g.active = null;
        if (g.scene === "play" && !g.segs.length) finishMove(g);
      }
    }
    return;
  }
  // input
  let dir: Pt | null = null;
  if (edge & KEY.left) dir = { x: -1, y: 0 }; else if (edge & KEY.right) dir = { x: 1, y: 0 };
  else if (edge & KEY.up) dir = { x: 0, y: -1 }; else if (edge & KEY.down) dir = { x: 0, y: 1 };
  if (dir) startPenguinSlide(g, dir);
}

function cellCenter(x: number, y: number) { return { x: OX + (x + .5) * CELL, y: OY + (y + .5) * CELL }; }

function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  sky(draw, W, H, [38, 110, 178], [125, 205, 240]);
  // water waves
  draw.setStrokeStyle("rgba(255,255,255,0.35)"); draw.setLineWidth(2);
  for (let i = 0; i < 9; i++) { draw.beginPath(); const y = 30 + i * 58 + dsin(g.frame * 0.02 + i) * 4; draw.moveTo(10 + (i % 3) * 40, y); draw.lineTo(90 + (i % 3) * 40, y); draw.stroke(); }
  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);
  const isTitle = g.scene === "title";
  // floe
  draw.setFillStyle("#dff4ff"); draw.fillRect(OX - 14, OY - 14, BW + 28, BH + 28);
  draw.setFillStyle("#eefaff"); draw.fillRect(OX - 6, OY - 6, BW + 12, BH + 12);
  // grid cracks
  draw.setStrokeStyle("rgba(90,170,220,0.22)"); draw.setLineWidth(1);
  for (let x = 0; x <= COLS; x++) { draw.beginPath(); draw.moveTo(OX + x * CELL, OY); draw.lineTo(OX + x * CELL, OY + BH); draw.stroke(); }
  for (let y = 0; y <= ROWS; y++) { draw.beginPath(); draw.moveTo(OX, OY + y * CELL); draw.lineTo(OX + BW, OY + y * CELL); draw.stroke(); }
  if (isTitle) {
    // scattered decorative scene on floe
    if (s.snowflake) for (const [x, y] of [[2,2],[7,1],[5,5],[8,6]] as const) { const c = cellCenter(x,y); drawSprite(draw, s.snowflake, c.x, c.y, 38, { rot: g.frame*0.01 }); }
    if (s.fish) { const c = cellCenter(7,4); drawSprite(draw, s.fish, c.x, c.y + dsin(g.frame*0.06)*3, 42); }
    if (s.igloo) { const c = cellCenter(8,2); drawSprite(draw, s.igloo, c.x, c.y, 58); const c2 = cellCenter(1,6); drawSprite(draw, s.igloo, c2.x, c2.y, 58); }
    if (s.cube) { const c = cellCenter(2,4); drawSprite(draw, s.cube, c.x, c.y, 50); }
    // penguin slides back and forth between cube and igloo
    const t = (dsin(g.frame * 0.018) + 1) / 2; const px = OX + (2.9 + t * 4.2) * CELL, py = OY + 3.7 * CELL;
    if (s.penguin) drawSprite(draw, s.penguin, px, py, 66, { flip: dcos(g.frame*0.018) < 0, sx: 1.18, sy: 0.9, rot: dsin(g.frame*0.05)*0.04 });
  } else {
    // spins under everything
    for (const k of g.spins) { const [x, y] = k.split(",").map(Number); const c = cellCenter(x!, y!); if (s.snowflake) drawSprite(draw, s.snowflake, c.x, c.y, 44, { rot: g.frame * 0.02, alpha: 0.95 }); }
    // fish
    { const c = cellCenter(g.fish.x, g.fish.y); draw.setFillStyle("rgba(255,140,46,0.25)"); draw.beginPath(); draw.arc(c.x, c.y, 25 + dsin(g.frame*0.08)*3, 0, Math.PI*2, false); draw.fill(); if (s.fish) drawSprite(draw, s.fish, c.x, c.y + dsin(g.frame*0.07)*3, 44, { rot: dsin(g.frame*0.05)*0.15 }); }
    // walls
    for (const k of g.walls) { const [x, y] = k.split(",").map(Number); const c = cellCenter(x!, y!); if (s.igloo) drawSprite(draw, s.igloo, c.x, c.y, 58); }
    // cubes
    for (const cbe of g.cubes) if (cbe.alive) { const c = cellCenter(cbe.px, cbe.py); if (s.cube) drawSprite(draw, s.cube, c.x, c.y, 50, { rot: cbe.rot * 0.15 }); }
    // penguin
    const moving = !!g.active && g.active.who === "p";
    const pc = cellCenter(g.peng.px, g.peng.py);
    const stretch = moving ? 1.28 : 1; const squashAmt = g.squashT > 0 ? 0.22 * (g.squashT/10) : 0;
    const wob = g.waddle > 0 ? dsin(g.frame*0.8)*0.08 : 0;
    const feetWig = g.feetT > 0 ? dsin(g.frame*0.6)*4 : 0;
    if (s.penguin) drawSprite(draw, s.penguin, pc.x, pc.y + feetWig*0.3, 62, { sx: (moving && g.peng.dirX!==0? stretch: 1+squashAmt), sy: (moving && g.peng.dirY!==0? stretch: 1-squashAmt), rot: g.peng.rot + wob, flip: g.peng.dirX < 0 });
    if (g.feetT>0) text(draw, "♪", pc.x+28, pc.y-28, 20, "#ff8c2e", "center");
  }
  drawJuice(draw, g.j);
  draw.restore();
  // HUD
  if (g.scene === "play") {
    panel(draw, 14, 12, 430, 54); text(draw, LEVELS[g.level]!.name, 28, 30, 19, "#ffd23f"); text(draw, LEVELS[g.level]!.hint, 28, 52, 12, "#ffffff");
    panel(draw, 720, 12, 226, 54); text(draw, `FISH ${g.level}/5  CUBES ${g.cubes.filter(c=>c.alive).length}`, 734, 30, 16, "#ffffff"); text(draw, `MOVES ${g.moves}  ·  R RESTART`, 734, 52, 12, "#bdeaff");
    // progress dots
    for (let i=0;i<5;i++){ draw.setFillStyle(i<g.level||g.wonLevel&&i===g.level?"#ff8c2e":"rgba(255,255,255,0.35)"); draw.beginPath(); draw.arc(480+i*22, 525, 7, 0, Math.PI*2, false); draw.fill(); }
  }
  if (g.scene === "title") {
    draw.setFillStyle("rgba(0,30,70,0.35)"); draw.fillRect(0,0,W,H);
    const bob = dsin(g.frame*0.05)*6;
    text(draw, "SLIDE & SUPPER", W/2, 150+bob, 68, "#ffd23f", "center", "bangers");
    text(draw, "You can only slide. Shove cubes, ride the SPIN flakes,", W/2, 205, 19, "#ffffff", "center");
    text(draw, "and stop exactly on the fish — sliding past doesn't count!", W/2, 230, 19, "#ffffff", "center");
    text(draw, "ARROWS / WASD slide  ·  R restart  ·  Don't splash!", W/2, 262, 16, "#bdeaff", "center");
    if (Math.floor(g.frame/30)%2===0) text(draw, "PRESS ENTER TO SLIDE!", W/2, 470, 26, "#ffffff", "center");
  } else if (g.scene === "won") {
    draw.setFillStyle("rgba(0,30,70,0.55)"); draw.fillRect(0,0,W,H);
    if (s.igloo) drawSprite(draw, s.igloo, W/2-110, 300, 110);
    if (s.penguin) drawSprite(draw, s.penguin, W/2+30, 310+dsin(g.frame*0.1)*5, 100, { sx:1+dsin(g.frame*0.2)*0.06, sy:1-dsin(g.frame*0.2)*0.06 });
    if (s.fish) for(let i=0;i<5;i++) drawSprite(draw, s.fish, W/2+95, 350-i*22, 38, { rot: i*0.2 });
    text(draw, "FULL BELLY. NICE SLIDING!", W/2, 150, 48, "#ffd23f", "center", "bangers");
    text(draw, `All 5 fish eaten in ${g.totalMoves} moves!`, W/2, 205, 22, "#ffffff", "center");
    if (Math.floor(g.frame/30)%2===0) text(draw, "ENTER — PLAY AGAIN", W/2, 470, 24, "#ffffff", "center");
  } else if (g.scene === "lost") {
    draw.setFillStyle("rgba(0,20,60,0.5)"); draw.fillRect(0,0,W,H);
    text(draw, g.loseMsg || "SPLASH!", W/2, 180, 64, "#ff8a8a", "center", "bangers");
    text(draw, g.loseMsg.includes("BRAKES") ? "Every cube is gone — nothing can stop you now." : "The penguin slid right into the water!", W/2, 240, 20, "#ffffff", "center");
    text(draw, `${LEVELS[g.level]!.name} — try that floe again`, W/2, 275, 17, "#bdeaff", "center");
    if (Math.floor(g.frame/30)%2===0) text(draw, "ENTER — TRY AGAIN", W/2, 430, 26, "#ffffff", "center");
  }
  if (g.celebrate>0 && g.scene==="play") text(draw, "YUM!", W/2, 120, 44, "#ff8c2e", "center", "bangers");
}
type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Slide & Supper" },
  clear: { r: 0.15, g: 0.43, b: 0.7 },
  options: {},
  neutral: 0,
  encode: (input: unknown) => {
    const base = encodeKeys(input); const i = (input ?? {}) as Record<string, boolean>;
    return base | (i.r || i.restart ? RESTART : 0);
  },
  random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); loadLevel(g, 0);
    let sprites: Record<string, Sprite> = {};
    const ready = loadKit(platform, NAMES).then((s) => { sprites = s; });
    return {
      ready,
      start: (seed) => { g = fresh(seed); loadLevel(g, 0); },
      step: (inputs) => step(g, inputs[0] ?? 0),
      checksum: () => { let h = g.frame * 31 + g.level * 101 + g.moves * 7 + Math.round(g.peng.px * 100) + Math.round(g.peng.py * 10); for (const c of g.cubes) h = (Math.imul(h, 16777619) ^ (Math.round(c.px*100)+ (c.alive?1000:0))) >>> 0; return h >>> 0; },
      state: () => ({ outcome: g.scene==="won" ? "won" : g.scene==="lost" ? "lost" : "playing", progress: (g.level + (g.wonLevel?1:0)) / 5, scene: g.scene, level: g.level, moves: g.moves, cubes: g.cubes.filter(c=>c.alive).length }),
      over: () => false,
      save: () => structuredClone(g),
      restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; },
      inspect: () => g,
      render: (draw) => render(g, draw, sprites),
    };
  },
});
