import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { dcos, dsin } from "dotframe/src/detmath";
import {
  burst, drawJuice, drawSprite, encodeKeys, endRun, floatText, juice, juiceStep, KEY, loadKit, outcomeOf,
  panel, pressed, randomKeys, range, rng, sceneStep, shake, shakeOffset, type Juice, type Scene, type Sprite, text,
} from "./kit";

const W = 960, H = 540;
const NAMES = ["car", "racecar", "trophy", "cone", "pylon", "marker", "flag"];
const CX = 480, CY = 278, RX = 335, RY = 158, TRACK_HALF = 62;
const TOTAL = Math.PI * 2 * 3;

interface CarState { x: number; y: number; a: number; speed: number; theta: number; prog: number; lap: number; squashT: number; boostT: number; gateCd: number; }
interface Ink { x: number; y: number; life: number; max: number; }
interface Skid { x: number; y: number; life: number; blue: boolean; }
interface Cone { x: number; y: number; theta: number; vx: number; vy: number; rot: number; vr: number; hit: boolean; }
interface Marker { x: number; y: number; theta: number; taken: boolean; respawn: number; }
interface Game {
  scene: Scene; sceneFrames: number; frame: number; prev: number; r: { s: number };
  p: CarState; b: CarState; ink: number; holding: boolean; holdCount: number;
  inks: Ink[]; skids: Skid[]; cones: Cone[]; markers: Marker[];
  announce: string; announceT: number; flagWave: number; bumpCd: number;
  blueInkCd: number; started: boolean; finishOrder: number; j: Juice;
}

const centerAt = (t: number) => ({ x: CX + RX * dcos(t), y: CY + RY * dsin(t) });
const thetaOf = (x: number, y: number) => Math.atan2((y - CY) / RY, (x - CX) / RX);
function wrapDelta(d: number) { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function makeCar(x: number, y: number, t: number): CarState { return { x, y, a: 0, speed: 0, theta: t, prog: 0, lap: 1, squashT: 0, boostT: 0, gateCd: 0 }; }

function fresh(seed: number, scene: Scene = "title"): Game {
  // start on top straight, heading east (-pi/2 theta)
  const ps = centerAt(-Math.PI / 2 - 0.12); const bs = centerAt(-Math.PI / 2 - 0.38);
  const p = makeCar(ps.x - 18, ps.y + 18, -Math.PI / 2 - 0.12); p.a = 0;
  const b = makeCar(bs.x - 18, bs.y - 22, -Math.PI / 2 - 0.38); b.a = 0;
  const cones: Cone[] = [];
  const coneThetas = [-0.2, 0.7, 1.4, 2.2, 3.0, 3.9, 4.7, 5.5];
  for (let i = 0; i < coneThetas.length; i++) { const c = centerAt(coneThetas[i]! + (i % 2 ? 0.18 : -0.15)); cones.push({ x: c.x, y: c.y, theta: coneThetas[i]!, vx: 0, vy: 0, rot: 0, vr: 0, hit: false }); }
  const markers: Marker[] = [];
  for (let i = 0; i < 5; i++) { const t = 0.4 + i * 1.25; const c = centerAt(t); markers.push({ x: c.x, y: c.y + (i % 2 ? 18 : -18), theta: t, taken: false, respawn: 0 }); }
  return { scene, sceneFrames: 0, frame: 0, prev: 0, r: rng(seed), p, b, ink: 75, holding: false, holdCount: 0, inks: [], skids: [], cones, markers, announce: "3 LAPS VS BLUE!", announceT: 150, flagWave: 0, bumpCd: 0, blueInkCd: 0, started: false, finishOrder: 0, j: juice() };
}

function updateProg(c: CarState) {
  const t = thetaOf(c.x, c.y); const d = wrapDelta(t - c.theta); c.theta = t;
  // only count forward progress meaningfully (clamp wild)
  if (Math.abs(d) < 0.2) c.prog += d;
  const newLap = Math.min(3, Math.floor(Math.max(0, c.prog) / (Math.PI * 2)) + 1);
  return newLap;
}
function distToTrack(x: number, y: number) { const t = thetaOf(x, y); const c = centerAt(t); return Math.hypot(x - c.x, y - c.y); }

function stepCarTrack(c: CarState, g: Game, isPlayer: boolean) {
  const d = distToTrack(c.x, c.y);
  if (d > TRACK_HALF) {
    // push back toward centreline, slow, squash
    const t = thetaOf(c.x, c.y); const cp = centerAt(t); const over = d - TRACK_HALF;
    const nx = (c.x - cp.x) / (d || 1), ny = (c.y - cp.y) / (d || 1);
    c.x -= nx * over * 0.55; c.y -= ny * over * 0.55; c.speed *= 0.94; if (c.squashT <= 0) c.squashT = 10;
    if (g.frame % 6 === 0) burst(g.j, g.r, c.x, c.y, 2, "#b8a888", 2, 4);
  } else if (d > TRACK_HALF - 10) c.speed *= 0.995;
  return d;
}

function step(g: Game, keys: number): void {
  const edge = pressed(keys, g.prev); const prevKeys = g.prev; g.prev = keys; g.frame++; juiceStep(g.j);
  if (sceneStep(g, edge)) { const seed = g.r.s; Object.assign(g, fresh(seed, "play"), { prev: keys }); floatText(g.j, W/2, 120, "GO!", "#e53935"); }
  if (g.scene !== "play") return;
  if (g.announceT > 0) g.announceT--;
  if (g.bumpCd > 0) g.bumpCd--; if (g.blueInkCd > 0) g.blueInkCd--; if (g.flagWave > 0) g.flagWave--;
  for (const c of [g.p, g.b]) { if (c.squashT > 0) c.squashT--; if (c.boostT > 0) c.boostT--; if (c.gateCd > 0) c.gateCd--; }

  const lapBefore = g.p.lap;
  // ---- Player driving ----
  const steer = (keys & KEY.right ? 1 : 0) - (keys & KEY.left ? 1 : 0);
  const gas = (keys & KEY.up) !== 0, brake = (keys & KEY.down) !== 0;
  const maxSpeed = g.p.boostT > 0 ? 9.2 : 6.4;
  if (gas) g.p.speed += g.p.boostT > 0 ? 0.32 : 0.22;
  if (brake) g.p.speed -= 0.28;
  if (!gas && !brake) g.p.speed *= 0.985;
  g.p.speed *= g.p.boostT > 0 ? 0.995 : 0.99;
  g.p.speed = Math.max(-2.2, Math.min(maxSpeed, g.p.speed));
  // steering scaled by speed
  g.p.a += steer * 0.045 * Math.max(-1, Math.min(1, g.p.speed / 3.2));
  g.p.x += dcos(g.p.a) * g.p.speed; g.p.y += dsin(g.p.a) * g.p.speed;

  // ---- Ink mechanic ----
  const spaceHeld = (keys & KEY.action) !== 0;
  const drain = g.p.lap >= 3 ? 0.75 : g.p.lap >= 2 ? 0.5 : 0.34;
  if (spaceHeld && g.ink > 0 && Math.abs(g.p.speed) > 0.8) {
    if (!g.holding) { g.holding = true; g.holdCount = 0; }
    g.ink = Math.max(0, g.ink - drain); g.holdCount++;
    const bx = g.p.x - dcos(g.p.a) * 28, by = g.p.y - dsin(g.p.a) * 28;
    if (g.frame % 2 === 0) { g.inks.push({ x: bx, y: by, life: 300, max: 300 }); if (g.inks.length > 220) g.inks.shift(); }
    if (g.frame % 5 === 0) burst(g.j, g.r, bx, by, 3, "#e53935", 2.2, 5);
  } else if (g.holding && !spaceHeld) {
    // release: boost if on fresh ink (just laid)
    const onInk = g.inks.some((pt) => Math.hypot(pt.x - g.p.x, pt.y - g.p.y) < 52 && pt.life > 120);
    if (onInk && g.holdCount >= 8) {
      const power = Math.min(1, g.holdCount / 45);
      g.p.boostT = Math.round(35 + power * 55); g.p.speed = Math.min(9.2, Math.abs(g.p.speed) + 2.2 + power * 2.5) * (g.p.speed < 0 ? -1 : 1);
      burst(g.j, g.r, g.p.x, g.p.y, 22, "#ffd23f", 5, 6); burst(g.j, g.r, g.p.x, g.p.y, 14, "#e53935", 4, 5);
      floatText(g.j, g.p.x, g.p.y - 42, "BOOST!", "#e53935"); shake(g.j, 5);
    } else if (g.holdCount >= 4) floatText(g.j, g.p.x, g.p.y - 36, "TOO SHORT!", "#888888");
    g.holding = false; g.holdCount = 0;
  } else if (!spaceHeld) { g.holding = false; g.holdCount = 0; }
  // slow ink regen tiny, markers main
  g.ink = Math.min(100, g.ink + 0.02);

  // skids
  if (Math.abs(g.p.speed) > 2 && g.frame % 3 === 0) g.skids.push({ x: g.p.x - dcos(g.p.a) * 20, y: g.p.y - dsin(g.p.a) * 20, life: 140, blue: false });
  stepCarTrack(g.p, g, true);
  const pLap = updateProg(g.p); g.p.lap = pLap;
  if (pLap !== lapBefore && g.p.prog > 0.3) {
    g.flagWave = 70; burst(g.j, g.r, 480, 110, 24, "#ffd23f", 5, 6);
    if (pLap === 2) { g.announce = "LAP 2!"; g.announceT = 140; floatText(g.j, W/2, 150, "LAP 2!", "#e53935"); }
    if (pLap === 3) { g.announce = "FINAL LAP!"; g.announceT = 140; floatText(g.j, W/2, 150, "FINAL LAP!", "#e53935"); }
  }

  // ---- Blue AI ----
  const b = g.b;
  const blap = Math.max(1, b.lap);
  // target ahead on centreline, with lane offset; lap3 shortcuts cut inside
  let lane = dsin(b.theta * 2.1) * 18;
  if (blap >= 3) lane = -22 + dsin(b.theta * 3) * 10; // risky inside line
  else if (blap >= 2) lane = dsin(b.theta * 1.7) * 22;
  // steal ink: if ink near ahead, aim for it
  let targetTheta = b.theta + 0.38;
  if (blap >= 2) { const nearInk = g.inks.find((pt) => pt.life > 80 && Math.hypot(pt.x - b.x, pt.y - b.y) < 120); if (nearInk) { targetTheta = thetaOf(nearInk.x, nearInk.y) + 0.12; } }
  const tp = centerAt(targetTheta);
  // offset perpendicular approx toward centre
  const toC = { x: CX - tp.x, y: CY - tp.y }; const cl = Math.hypot(toC.x, toC.y) || 1;
  const tx = tp.x + (toC.x / cl) * (-lane), ty = tp.y + (toC.y / cl) * (-lane);
  const desired = Math.atan2(ty - b.y, tx - b.x);
  let da = wrapDelta(desired - b.a); b.a += Math.max(-0.055, Math.min(0.055, da));
  // speed with rubber-banding but winnable
  const gap = g.p.prog - b.prog;
  let bMax = 5.15 + (blap - 1) * 0.32 + Math.max(-0.45, Math.min(0.65, gap * 0.18));
  // ink steal boost
  const onInkB = g.inks.some((pt) => Math.hypot(pt.x - b.x, pt.y - b.y) < 34 && pt.life > 60);
  if (blap >= 2 && onInkB && g.blueInkCd <= 0) { b.boostT = 32; g.blueInkCd = 120; burst(g.j, g.r, b.x, b.y, 12, "#3a7bd5", 4, 5); floatText(g.j, b.x, b.y - 36, "BLUE STEALS INK!", "#3a7bd5"); }
  if (b.boostT > 0) bMax += 2.4;
  b.speed += b.speed < bMax ? 0.18 : -0.25; b.speed = Math.min(bMax + 1, Math.max(0, b.speed));
  b.x += dcos(b.a) * b.speed; b.y += dsin(b.a) * b.speed;
  if (Math.abs(b.speed) > 2 && g.frame % 3 === 0) g.skids.push({ x: b.x - dcos(b.a) * 20, y: b.y - dsin(b.a) * 20, life: 140, blue: true });
  stepCarTrack(b, g, false);
  const bLapBefore = b.lap; const nbLap = updateProg(b); b.lap = nbLap;
  if (nbLap !== bLapBefore) { g.flagWave = 70; floatText(g.j, b.x, b.y - 40, nbLap === 3 ? "BLUE FINAL LAP!" : `BLUE LAP ${nbLap}!`, "#3a7bd5"); }

  // ---- Cones (lap>=2 active) ----
  if (g.p.lap >= 2 || b.lap >= 2) {
    for (const cone of g.cones) {
      cone.x += cone.vx; cone.y += cone.vy; cone.vx *= 0.92; cone.vy *= 0.92; cone.rot += cone.vr; cone.vr *= 0.92;
      for (const c of [g.p, b]) {
        if (!cone.hit || Math.hypot(cone.vx, cone.vy) > 0.5) {}
        if (Math.hypot(cone.x - c.x, cone.y - c.y) < 34 && Math.abs(c.speed) > 1) {
          if (Math.hypot(cone.vx, cone.vy) < 1.2) {
            cone.vx = dcos(c.a) * 4 + range(g.r, -1, 1); cone.vy = dsin(c.a) * 4 + range(g.r, -1, 1); cone.vr = range(g.r, -0.3, 0.3); cone.hit = true;
            c.speed *= 0.62; burst(g.j, g.r, cone.x, cone.y, 12, "#ff8c1a", 4, 5); shake(g.j, 5); floatText(g.j, cone.x, cone.y - 26, "CONE!", "#ff8c1a");
          }
        }
      }
    }
  }
  // ---- Markers ----
  for (const m of g.markers) {
    if (m.taken) { if (--m.respawn <= 0) m.taken = false; continue; }
    if (Math.hypot(m.x - g.p.x, m.y - g.p.y) < 42) { m.taken = true; m.respawn = 420; g.ink = Math.min(100, g.ink + 42); burst(g.j, g.r, m.x, m.y, 16, "#e53935", 4, 5); floatText(g.j, m.x, m.y - 30, "+INK!", "#e53935"); }
    if (Math.hypot(m.x - b.x, m.y - b.y) < 36) { m.taken = true; m.respawn = 420; }
  }
  // ---- Pylon gate ----
  // gate at east side theta=0, centre point
  const gateC = centerAt(0); const gateW = g.p.lap >= 3 ? 46 : g.p.lap >= 2 ? 68 : 92;
  for (const c of [g.p, b]) {
    if (c.gateCd <= 0 && Math.hypot(c.x - gateC.x, c.y - gateC.y) < gateW / 2 + 12) {
      c.gateCd = 300; c.boostT = Math.max(c.boostT, 45); c.speed = Math.min(9.2, Math.abs(c.speed) + 1.8);
      burst(g.j, g.r, c.x, c.y, 20, "#ffd23f", 5, 7); floatText(g.j, c.x, c.y - 42, "GATE BOOST!", "#d99a00");
    }
  }
  // ---- Car bump ----
  const dd = Math.hypot(g.p.x - b.x, g.p.y - b.y);
  if (dd < 52 && dd > 0 && g.bumpCd <= 0) {
    g.bumpCd = 22; const nx = (g.p.x - b.x) / dd, ny = (g.p.y - b.y) / dd;
    g.p.x += nx * 14; g.p.y += ny * 14; b.x -= nx * 14; b.y -= ny * 14; g.p.speed *= 0.82; b.speed *= 0.82;
    shake(g.j, 9); burst(g.j, g.r, (g.p.x + b.x) / 2, (g.p.y + b.y) / 2, 18, "#ffd23f", 5, 6); floatText(g.j, g.p.x, g.p.y - 46, "BUMP!", "#333333");
  }
  // fading
  for (const pt of g.inks) pt.life--; g.inks = g.inks.filter((p) => p.life > 0);
  for (const s of g.skids) s.life--; g.skids = g.skids.filter((s) => s.life > 0);
  if (g.skids.length > 260) g.skids.splice(0, g.skids.length - 260);

  // ---- Finish ----
  if (g.p.prog >= TOTAL) { endRun(g, true); return; }
  if (b.prog >= TOTAL) { endRun(g, false); return; }
}

type Draw2DLike = Parameters<NonNullable<SimRun["render"]>>[0];
function render(g: Game, draw: Draw2DLike, s: Record<string, Sprite>): void {
  // paper
  draw.setFillStyle("#fffaf0"); draw.fillRect(0, 0, W, H);
  draw.setFillStyle("rgba(120,170,255,0.18)");
  for (let y = 36; y < H; y += 28) draw.fillRect(0, y, W, 2);
  draw.setFillStyle("rgba(255,100,100,0.25)"); draw.fillRect(64, 0, 2, H);
  const o = shakeOffset(g.j, g.frame); draw.save(); draw.translate(o.x, o.y);

  // track oval: thick grey stroke via ellipses
  draw.setStrokeStyle("#5a5a5a"); draw.setLineWidth(TRACK_HALF * 2 + 18); draw.beginPath(); draw.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2, false); draw.stroke();
  draw.setStrokeStyle("#fdfdf8"); draw.setLineWidth(TRACK_HALF * 2); draw.beginPath(); draw.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2, false); draw.stroke();
  // edge dashes
  draw.setStrokeStyle("#e53935"); draw.setLineWidth(4);
  for (let i = 0; i < 28; i++) { const t0 = (i / 28) * Math.PI * 2; const a = centerAt(t0); const b2 = { x: CX + (RX) * dcos(t0 + 0.08), y: CY + (RY) * dsin(t0 + 0.08) }; draw.beginPath(); draw.moveTo(a.x, a.y); draw.lineTo(b2.x, b2.y); draw.stroke(); }
  // start line checkers at top
  const sc = centerAt(-Math.PI / 2);
  for (let i = -3; i < 4; i++) for (let j = 0; j < 3; j++) { draw.setFillStyle((i + j) % 2 ? "#222" : "#fff"); draw.fillRect(sc.x + i * 13, sc.y - 20 + j * 13, 12, 12); }
  // flag + trophy center
  if (s.flag) drawSprite(draw, s.flag, sc.x + 58, sc.y - 28, 54, { rot: dsin(g.frame * (g.flagWave > 0 ? 0.35 : 0.08)) * 0.25 });
  if (s.trophy) drawSprite(draw, s.trophy, CX, CY - 8, 118 + dsin(g.frame * 0.06) * 6, { rot: dsin(g.frame * 0.04) * 0.06 });
  text(draw, "PAPER GRAND PRIX", CX, CY + 62, 18, "#8a6d3b", "center", "bangers");

  // gate pylons at east
  const gateC = centerAt(0); const gateW = g.p.lap >= 3 ? 46 : g.p.lap >= 2 ? 68 : 92;
  // perpendicular at east is vertical
  if (s.pylon) { drawSprite(draw, s.pylon, gateC.x, gateC.y - gateW / 2, 52, {}); drawSprite(draw, s.pylon, gateC.x, gateC.y + gateW / 2, 52, {}); }
  draw.setFillStyle("rgba(255,210,63,0.35)"); draw.fillRect(gateC.x - 5, gateC.y - gateW / 2, 10, gateW);

  // ink trail
  for (const pt of g.inks) { draw.setGlobalAlpha(Math.max(0.08, Math.min(0.85, pt.life / pt.max))); draw.setFillStyle("#e53935"); draw.beginPath(); draw.arc(pt.x, pt.y, 15, 0, Math.PI * 2, false); draw.fill(); }
  draw.setGlobalAlpha(1);
  // skids
  for (const sk of g.skids) { draw.setGlobalAlpha(Math.min(0.5, sk.life / 200)); draw.setFillStyle(sk.blue ? "#3a7bd5" : "#e57373"); draw.beginPath(); draw.arc(sk.x, sk.y, 6, 0, Math.PI * 2, false); draw.fill(); }
  draw.setGlobalAlpha(1);
  // markers
  for (const m of g.markers) if (!m.taken && s.marker) drawSprite(draw, s.marker, m.x, m.y, 44, { rot: dsin(g.frame * 0.1 + m.theta) * 0.3 });
  // cones lap2+
  if (g.scene === "play" && (g.p.lap >= 2 || g.b.lap >= 2) && s.cone) for (const c of g.cones) drawSprite(draw, s.cone, c.x, c.y, 38, { rot: c.rot });
  // speed lines when boosting player
  if (g.p.boostT > 0) { draw.setStrokeStyle("rgba(229,57,53,0.6)"); draw.setLineWidth(3); for (let i = 0; i < 6; i++) { const yy = g.p.y - 45 + i * 16; draw.beginPath(); draw.moveTo(g.p.x - dcos(g.p.a) * 40, yy); draw.lineTo(g.p.x - dcos(g.p.a) * 85, yy); draw.stroke(); } }

  // cars: sprite image likely points? Assume car front to right; rotate by a, adjust? Draw with rot = a + pi/2 if image vertical? Check orientation unknown - use a (common top-down cars side?) We'll use rot = a + Math.PI/2 if sprite tall. Sprite w/h will decide in code? Keep rot = g.p.a + Math.PI/2 when h>w else a.
  const pRot = (s.car && s.car.h >= s.car.w) ? g.p.a + Math.PI / 2 : g.p.a;
  const bRot = (s.racecar && s.racecar.h >= s.racecar.w) ? g.b.a + Math.PI / 2 : g.b.a;
  const pSq = g.p.squashT > 0 ? { sx: 1.25, sy: 0.78 } : g.p.boostT > 0 ? { sx: 1.12, sy: 0.92 } : { sx: 1, sy: 1 };
  const bSq = g.b.squashT > 0 ? { sx: 1.25, sy: 0.78 } : { sx: 1, sy: 1 };
  if (s.racecar) drawSprite(draw, s.racecar, g.b.x, g.b.y, 62, { rot: bRot, ...bSq });
  if (s.car) drawSprite(draw, s.car, g.p.x, g.p.y, 72, { rot: pRot, ...pSq });
  text(draw, "5", g.p.x, g.p.y - 34, 14, "#e53935", "center", "bangers");
  text(draw, "8", g.b.x, g.b.y - 34, 14, "#3a7bd5", "center", "bangers");
  drawJuice(draw, g.j);
  draw.restore();

  // HUD
  if (g.scene === "play") {
    panel(draw, 12, 10, 360, 58, "rgba(255,255,255,0.88)");
    text(draw, `LAP ${Math.min(3, g.p.lap)}/3  YOU`, 24, 30, 20, "#e53935");
    text(draw, `BLUE LAP ${Math.min(3, g.b.lap)}/3`, 24, 54, 16, "#3a7bd5");
    const pos = g.p.prog >= g.b.prog ? "1st!" : "2nd - CATCH BLUE!";
    text(draw, pos, 356, 38, 18, "#333333", "right");
    // ink meter
    panel(draw, 620, 10, 328, 58, "rgba(255,255,255,0.88)");
    text(draw, "INK", 634, 30, 16, "#333333");
    draw.setFillStyle("#ddd"); draw.fillRect(634, 42, 220, 14);
    draw.setFillStyle(g.ink < 20 ? "#ff8c1a" : "#e53935"); draw.fillRect(634, 42, 220 * g.ink / 100, 14);
    text(draw, g.holding ? "DRAWING..." : "SPACE!", 934, 38, 15, "#e53935", "right");
    if (g.frame < 320) { panel(draw, 230, 78, 500, 52, "rgba(0,0,0,0.55)"); text(draw, g.frame < 170 ? "3 LAPS VS BLUE!" : "HOLD SPACE TO DRAW YOUR BOOST!", W/2, 104, 21, "#ffffff", "center"); }
    if (g.announceT > 40) { const sc2 = 1 + Math.min(0.4, (140 - g.announceT) * 0.02); text(draw, g.announce, W/2, 150, Math.round(44 * sc2), "#ffd23f", "center", "bangers"); }
    // progress bar
    draw.setFillStyle("rgba(0,0,0,0.25)"); draw.fillRect(230, 516, 500, 10);
    draw.setFillStyle("#e53935"); draw.fillRect(230, 516, 500 * Math.min(1, Math.max(0, g.p.prog / TOTAL)), 10);
    draw.setFillStyle("#3a7bd5"); draw.fillRect(230, 505, 500 * Math.min(1, Math.max(0, g.b.prog / TOTAL)), 8);
  }
  // overlays custom (need exact win/lose texts)
  if (g.scene !== "play") {
    draw.setFillStyle(g.scene === "title" ? "rgba(255,250,240,0.55)" : "rgba(0,0,0,0.55)"); draw.fillRect(0, 0, W, H);
    const bob = dsin(g.frame * 0.05) * 6;
    if (g.scene === "title") {
      text(draw, "PAPER GRAND PRIX", W/2, 150 + bob, 64, "#e53935", "center", "bangers");
      text(draw, "3 LAPS VS BLUE!", W/2, 215, 26, "#3a7bd5", "center");
      text(draw, "HOLD SPACE TO DRAW YOUR BOOST!", W/2, 252, 20, "#333333", "center");
      text(draw, "Arrows/WASD drive  •  SPACE hold & release = BOOST  •  Grab markers for ink", W/2, 292, 17, "#555555", "center");
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "PRESS ENTER TO START", W/2, 452, 24, "#e53935", "center", "bangers");
    } else if (g.scene === "won") {
      text(draw, "YOU WIN THE TROPHY!", W/2, 200 + bob, 56, "#ffd23f", "center", "bangers");
      if (s.trophy) drawSprite(draw, s.trophy, W/2, 320, 150, { rot: dsin(g.frame*0.06)*0.1 });
      text(draw, "You beat Blue over 3 laps!", W/2, 420, 20, "#ffffff", "center");
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER TO RACE AGAIN", W/2, 472, 22, "#ffffff", "center");
    } else {
      text(draw, "BLUE WINS! TRY AGAIN!", W/2, 200 + bob, 52, "#7fb3ff", "center", "bangers");
      if (s.racecar) drawSprite(draw, s.racecar, W/2, 320, 110, { rot: dsin(g.frame*0.06)*0.2 });
      text(draw, "Blue finished 3 laps first!", W/2, 420, 20, "#ffffff", "center");
      if (Math.floor(g.frame / 30) % 2 === 0) text(draw, "ENTER TO RACE AGAIN", W/2, 472, 22, "#ffffff", "center");
    }
  }
}

export default defineSim({
  players: 1, window: { width: W, height: H, title: "Paper Grand Prix" }, clear: { r: 1, g: 0.98, b: 0.94 }, options: {}, neutral: 0, encode: encodeKeys, random: randomKeys,
  create: (platform: SimPlatform): SimRun => {
    let g = fresh(1); let sprites: Record<string, Sprite> = {}; const ready = loadKit(platform, NAMES).then((s) => { sprites = s; });
    return { ready, start: (seed) => { g = fresh(seed); }, step: (inputs) => step(g, inputs[0] ?? 0), checksum: () => { let h = g.frame * 31 + Math.round(g.p.x * 10) + Math.round(g.b.x * 7) + Math.round(g.ink * 10); h = (Math.imul(h, 16777619) ^ Math.round(g.p.prog * 1000)) >>> 0; return h >>> 0; }, state: () => ({ outcome: outcomeOf(g.scene), progress: Math.min(1, Math.max(0, g.p.prog / TOTAL)), scene: g.scene, lap: g.p.lap, blueLap: g.b.lap, ink: Math.round(g.ink) }), over: () => false, save: () => structuredClone(g), restore: (saved) => { g = { ...fresh(1), ...structuredClone(saved as Game) }; }, inspect: () => g, render: (draw) => render(g, draw, sprites) };
  },
});
