import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";
import { createChecksum } from "dotframe/src/checksum";
import { dsin, dcos, datan2, dhypot } from "dotframe/src/detmath";
import type { Texture } from "dotframe/src/gpu";

const W = 960, H = 540, GROUND = 474, DT = 1 / 60;
const B_LEFT = 1, B_RIGHT = 2, B_UP = 4, B_DOWN = 8, B_SPACE = 16, B_ENTER = 32;

type Phase = "title" | "aiming" | "flying" | "clear" | "won" | "lost";
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; star: boolean }
interface FloatText { x: number; y: number; life: number; text: string; color: string; size: number }
interface Hitbox { width: number; height: number; parts: { x: number; y: number; halfWidth: number; halfHeight: number }[] }
interface Level { sunX: number; sunY: number; treeX: number; treeLift: number; canopyR: number; carX: number; houseX: number; hint: string }

const LEVELS: Level[] = [
  { sunX: 470, sunY: 132, treeX: 665, treeLift: 0, canopyR: 52, carX: 355, houseX: 852, hint: "Mantén ESPACIO en vuelo para orbitar el SOL" },
  { sunX: 545, sunY: 102, treeX: 610, treeLift: 30, canopyR: 54, carX: 285, houseX: 855, hint: "El SOL está alto: suelta tarde y caerás en picado" },
  { sunX: 395, sunY: 92, treeX: 525, treeLift: 48, canopyR: 56, carX: 700, houseX: 858, hint: "El COCHE está tras el ÁRBOL. Rebota en la copa" },
  { sunX: 625, sunY: 78, treeX: 465, treeLift: 20, canopyR: 58, carX: 330, houseX: 855, hint: "Orbita lejos, rebota y entra por la ventana" },
];
const COLORS = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#eab308", "#ec4899"];

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }

export default defineSim({
  players: 1,
  window: { width: W, height: H, title: "Gato Cometa: órbita y a casa" },
  clear: { r: 0.99, g: 0.97, b: 0.90 },
  options: {},
  neutral: 0,
  encode: (input: unknown): number => {
    if (typeof input === "number") return input | 0;
    if (typeof input === "string") { const s = input.toLowerCase(); return s.includes("enter") || s.includes("confirm") || s.includes("start") ? B_ENTER : s.includes("space") || s.includes("jump") || s.includes("action") || s.includes("fire") ? B_SPACE : s.includes("left") ? B_LEFT : s.includes("right") ? B_RIGHT : s.includes("up") ? B_UP : s.includes("down") ? B_DOWN : 0; }
    if (Array.isArray(input)) return 0;
    const o = (input ?? {}) as Record<string, unknown>;
    let n = 0;
    if (o.left || o.ArrowLeft || o.a || o.KeyA) n |= B_LEFT;
    if (o.right || o.ArrowRight || o.d || o.KeyD) n |= B_RIGHT;
    if (o.up || o.ArrowUp || o.w || o.KeyW) n |= B_UP;
    if (o.down || o.ArrowDown || o.s || o.KeyS) n |= B_DOWN;
    if (o.space || o.Space || o.jump || o.action || o.fire || o.shoot || o.launch || o.buttonA || o.A || o.primary) n |= B_SPACE;
    if (o.enter || o.Enter || o.start || o.confirm || o.select || o.restart || o.retry || o.pause || o.menu || o.buttonStart) n |= B_ENTER;
    if (Array.isArray(o.keys)) for (const k of o.keys as string[]) { const s = String(k).toLowerCase(); if (s.includes("enter") || s.includes("confirm")) n |= B_ENTER; if (s.includes("space") || s.includes("jump")) n |= B_SPACE; if (s.includes("left")) n |= B_LEFT; if (s.includes("right")) n |= B_RIGHT; if (s.includes("up")) n |= B_UP; if (s.includes("down")) n |= B_DOWN; }
    return n;
  },
  random: (next: () => number): number => {
    let n = 0;
    if (next() < 0.3) n |= B_LEFT; if (next() < 0.3) n |= B_RIGHT;
    if (next() < 0.3) n |= B_UP; if (next() < 0.3) n |= B_DOWN;
    if (next() < 0.45) n |= B_SPACE; if (next() < 0.08) n |= B_ENTER;
    return n;
  },
  create: (platform: SimPlatform): SimRun => {
    const tex: Record<string, Texture | null> = { cat: null, sun: null, tree: null, house: null, car: null };
    const boxes: Record<string, Hitbox> = {};
    let dims: Record<string, { w: number; h: number }> = { cat: { w: 401, h: 303 }, sun: { w: 299, h: 269 }, tree: { w: 246, h: 278 }, house: { w: 278, h: 291 }, car: { w: 330, h: 213 } };

    const ready = (async () => {
      for (const name of ["cat", "sun", "tree", "house", "car"]) {
        try { const hb = JSON.parse(new TextDecoder().decode(await platform.load(`assets/${name}.hitbox.json`))) as Hitbox; boxes[name] = hb; dims[name] = { w: hb.width, h: hb.height }; } catch { /* keep defaults */ }
      }
      if (platform.image) {
        for (const name of ["cat", "sun", "tree", "house", "car"]) {
          try { const bytes = await platform.load(`assets/${name}.png`); tex[name] = await platform.image(bytes, true); } catch { /* ignore */ }
        }
        if (platform.draw) {
          try {
            platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json")));
            platform.draw.addFont(["bangers", "sans-serif"], await platform.image(await platform.load("assets/fonts/bangers.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/bangers.json")));
          } catch { /* ignore */ }
        }
      }
    })();

    const S: any = {
      phase: "title" as Phase, tick: 0, level: 0, launchesLeft: 5, launchesUsedTotal: 0, levelsDone: 0,
      angle: 58, power: 66, catX: 92, catY: GROUND - 30, catVX: 0, catVY: 0, catRot: 0, catSpin: 0,
      flyingTime: 0, restTime: 0, orbiting: false, onCar: false, carX: LEVELS[0].carX, carVX: 0, carMoved: 0,
      shake: 0, treeSquash: 0, catSquash: 0, carDust: 0, clearTimer: 0, msgTimer: 0, nearMissShown: 0,
      prevSpace: false, prevEnter: false, rng: 1234567, score: 0, lastDist: 9999, minDistThisFlight: 9999, maxXThisFlight: 92,
      particles: [] as Particle[], texts: [] as FloatText[],
    };

    const rand = () => { S.rng = (Math.imul(S.rng ^ (S.rng >>> 15), 2246822519) ^ (S.rng << 13)) >>> 0; S.rng ^= S.rng >>> 17; return (S.rng >>> 0) / 4294967296; };
    const lvl = (): Level => LEVELS[S.level];
    const winPos = () => ({ x: lvl().houseX - 60, y: GROUND - 82 });
    function burst(x: number, y: number, n: number, color: string, speed = 160, star = false) {
      for (let i = 0; i < n && S.particles.length < 240; i++) {
        const a = rand() * Math.PI * 2, sp = (0.3 + rand() * 0.7) * speed;
        S.particles.push({ x, y, vx: dcos(a) * sp, vy: dsin(a) * sp - 40, life: 0, max: 0.45 + rand() * 0.65, size: 2 + rand() * 4, color: star ? COLORS[Math.floor(rand() * COLORS.length)] : color, star: star || rand() < 0.25 });
      }
    }
    function addText(x: number, y: number, text: string, color = "#111827", size = 30) { S.texts.push({ x: clamp(x, 90, 870), y: clamp(y, 70, 430), life: 0, text, color, size }); if (S.texts.length > 5) S.texts.shift(); }
    function resetCatToAim() { const L = lvl(); S.catX = 92; S.catY = GROUND - 30; S.catVX = 0; S.catVY = 0; S.catRot = 0; S.angle = 58; S.power = 66; S.flyingTime = 0; S.restTime = 0; S.orbiting = false; S.onCar = false; S.carX = L.carX; S.carVX = 0; S.phase = "aiming"; }
    function loadLevel(i: number) { S.level = i; S.launchesLeft = 5; resetCatToAim(); }
    function startGame() { S.levelsDone = 0; S.launchesUsedTotal = 0; S.score = 0; S.angle = 58; S.power = 66; S.minDistThisFlight = 9999; S.maxXThisFlight = 92; loadLevel(0); addText(480, 120, "¡A CASA, GATO!", "#dc2626", 34); }
    function miss(reason: string) {
      if (S.phase !== "flying") return;
      const wp = winPos(); const d = dhypot(S.catX - wp.x, S.catY - wp.y);
      if (d < 105 && reason !== "out") addText(S.catX, S.catY - 46, "¡POR POCO!", "#dc2626", 32);
      else if (reason === "out") addText(clamp(S.catX, 120, 840), 110, "¡FUERA!", "#7c3aed", 30);
      else addText(S.catX, S.catY - 44, "¡ZAS!", "#111827", 28);
      S.shake = Math.max(S.shake, 5);
      if (S.launchesLeft <= 0) { S.phase = "lost"; burst(S.catX, clamp(S.catY, 80, 450), 24, "#94a3b8", 170, true); }
      else resetCatToAim();
    }
    function consumeAndLaunch() {
      S.launchesLeft -= 1; S.launchesUsedTotal += 1;
      const a = S.angle * Math.PI / 180, sp = 300 + S.power * 5.6;
      S.catVX = dcos(a) * sp; S.catVY = -dsin(a) * sp; S.catSpin = 5; S.phase = "flying"; S.flyingTime = 0; S.catSquash = 0.35;
      burst(S.catX, S.catY + 18, 12, "#fbbf24", 130, true);
    }
    function winLevel() {
      S.levelsDone = S.level + 1; S.score += 100 + S.launchesLeft * 25; S.phase = "clear"; S.clearTimer = 0; S.catVX = 0; S.catVY = 0;
      const wp = winPos(); burst(wp.x, wp.y, 42, "#f59e0b", 260, true); addText(wp.x - 20, wp.y - 70, "¡EN CASA!", "#15803d", 36);
    }

    return {
      ready,
      start: (seed: number) => { S.rng = (seed * 2654435761) >>> 0 || 1234567; S.phase = "title"; S.tick = 0; S.level = 0; S.levelsDone = 0; S.score = 0; S.launchesLeft = 5; S.launchesUsedTotal = 0; S.particles = []; S.texts = []; S.carX = LEVELS[0].carX; S.carVX = 0; S.catX = 480; S.catY = 180; },
      step: (inputs: number[]) => {
        const inp = inputs[0] ?? 0; S.tick++;
        const space = !!(inp & B_SPACE), enter = !!(inp & B_ENTER);
        const enterEdge = enter && !S.prevEnter, spaceEdge = space && !S.prevSpace;
        // particles & texts always
        for (const p of S.particles) { p.life += DT; p.x += p.vx * DT; p.y += p.vy * DT; p.vy += 260 * DT; p.vx *= 0.99; }
        S.particles = S.particles.filter((p: Particle) => p.life < p.max && p.y < 560);
        for (const t of S.texts) t.life += DT; S.texts = S.texts.filter((t: FloatText) => t.life < 1.35);
        S.shake = Math.max(0, S.shake - DT * 14); S.treeSquash = Math.max(0, S.treeSquash - DT * 3); S.catSquash = Math.max(0, S.catSquash - DT * 3); S.carDust = Math.max(0, S.carDust - DT * 4);

        if (S.phase === "title") {
          const t = S.tick * DT; S.catX = 480 + dcos(t * 1.7) * 118; S.catY = 205 + dsin(t * 1.7) * 72; S.catRot = t * 3;
          if (S.tick % 4 === 0) S.particles.push({ x: S.catX, y: S.catY, vx: -S.catVX * 0.02, vy: 10, life: 0, max: 0.7, size: 3, color: "#f59e0b", star: true });
          if (enterEdge) startGame();
        } else if (S.phase === "won" || S.phase === "lost") {
          if (enterEdge) startGame();
        } else if (S.phase === "clear") {
          S.clearTimer += DT; if (S.tick % 6 === 0) burst(480 + (rand() - 0.5) * 500, 160 + rand() * 120, 6, "#22c55e", 160, true);
          if (S.clearTimer > 0.55) { if (S.level >= 3) S.phase = "won"; else { S.minDistThisFlight = 9999; S.maxXThisFlight = 92; loadLevel(S.level + 1); } }
        } else if (enterEdge && S.phase === "aiming") {
          // retry level (only while aiming, so a stray ENTER never aborts a flight)
          loadLevel(S.level); addText(480, 110, "OTRA VEZ", "#111827", 26);
        } else if (S.phase === "aiming") {
          if (inp & B_LEFT) S.angle = clamp(S.angle - 0.22, 12, 82);
          if (inp & B_RIGHT) S.angle = clamp(S.angle + 0.22, 12, 82);
          if (inp & B_UP) S.power = clamp(S.power + 0.22, 25, 100);
          if (inp & B_DOWN) S.power = clamp(S.power - 0.22, 25, 100);
          S.catX = 92; S.catY = GROUND - 30 + dsin(S.tick * DT * 3) * 2;
          if (spaceEdge) consumeAndLaunch();
        } else if (S.phase === "flying") {
          S.flyingTime += DT;
          const L = lvl();
          // car motion
          if (Math.abs(S.carVX) > 1) { S.carX = clamp(S.carX + S.carVX * DT, 90, 760); S.carVX *= 0.982; if (S.tick % 5 === 0) burst(S.carX - 50, GROUND - 8, 2, "#60a5fa", 60); } else S.carVX = 0;
          // gravity + sun
          let ax = 0, ay = 540;
          S.orbiting = space;
          if (space) {
            const dx = L.sunX - S.catX, dy = L.sunY - S.catY, d = Math.max(42, dhypot(dx, dy));
            const gm = 9500000; const a = gm / (d * d); ax += (dx / d) * a; ay += (dy / d) * a;
            if (S.tick % 2 === 0) S.particles.push({ x: S.catX + (rand() - 0.5) * 18, y: S.catY + (rand() - 0.5) * 18, vx: (rand() - 0.5) * 40, vy: (rand() - 0.5) * 40, life: 0, max: 0.55 + rand() * 0.4, size: 2.5 + rand() * 3, color: rand() < 0.5 ? "#facc15" : "#fff7cc", star: rand() < 0.6 });
          }
          S.catVX += ax * DT; S.catVY += ay * DT;
          // cap speed for stability
          const sp = dhypot(S.catVX, S.catVY); if (sp > 980) { S.catVX *= 980 / sp; S.catVY *= 980 / sp; }
          const prevY = S.catY;
          S.catX += S.catVX * DT; S.catY += S.catVY * DT; S.catRot += S.catSpin * DT; S.catSpin *= 0.995;
          if (S.tick % 3 === 0 && !space) S.particles.push({ x: S.catX, y: S.catY + 10, vx: (rand() - 0.5) * 30, vy: 20, life: 0, max: 0.4, size: 2, color: "#d6c7b2", star: false });

          const wp = winPos(); const dWin = dhypot(S.catX - wp.x, S.catY - wp.y); S.minDistThisFlight = Math.min(S.minDistThisFlight, dWin); S.maxXThisFlight = Math.max(S.maxXThisFlight, S.catX);
          if (dWin < 900 && dWin > 1) { const pull = 2600 * (1 - dWin / 1000) + 300; S.catVX += ((wp.x - S.catX) / dWin) * pull * DT; S.catVY += ((wp.y - S.catY) / dWin) * pull * DT; }
          if (dWin < 70 || (Math.abs(S.catX - wp.x) < 80 && Math.abs(S.catY - wp.y) < 240)) { winLevel(); }
          else {
            // tree canopy elastic circle
            const cx = L.treeX, cy = GROUND - 108 - L.treeLift, cr = L.canopyR;
            const dx = S.catX - cx, dy = S.catY - cy, d = dhypot(dx, dy);
            if (d < cr + 24 && d > 1) {
              const nx = dx / d, ny = dy / d; const dot = S.catVX * nx + S.catVY * ny;
              if (dot < 0) { S.catVX = Math.abs(S.catVX) * 0.85 + 130; S.catVY = -Math.abs(S.catVY) * 0.82 - 60; S.catX = cx + nx * (cr + 25); S.catY = cy + ny * (cr + 25); S.treeSquash = 1; S.catSquash = 0.7; S.shake = Math.max(S.shake, 4); burst(S.catX, S.catY, 14, "#22c55e", 190, true); addText(S.catX, S.catY - 42, "¡BOING!", "#15803d", 24); }
            }
            // trunk
            if (Math.abs(S.catX - L.treeX) < 34 && S.catY > GROUND - 105 - L.treeLift && S.catY < GROUND) { S.catVX = (S.catX < L.treeX ? -1 : 1) * Math.abs(S.catVX) * 0.55; S.catX = L.treeX + (S.catX < L.treeX ? -35 : 35); S.shake = Math.max(S.shake, 3); }
            // car roof
            const carTop = GROUND - 62, carLeft = S.carX - 72, carRight = S.carX + 72;
            const onTopNow = S.catX > carLeft && S.catX < carRight && S.catY + 24 >= carTop && prevY + 24 <= carTop + 18 && S.catVY >= 0;
            if (onTopNow || (S.onCar && S.catX > carLeft && S.catX < carRight && Math.abs(S.catY + 24 - carTop) < 10)) {
              if (!S.onCar && S.catVY > 120) { addText(S.carX, carTop - 42, "¡CLAC!", "#1d4ed8", 26); burst(S.carX - 40, GROUND - 6, 12, "#60a5fa", 130); S.carDust = 1; S.shake = Math.max(S.shake, 3); }
              S.onCar = true; S.catY = carTop - 24; const impact = clamp(S.catVX, -80, 260); if (Math.abs(S.carVX) < 20) S.carVX = clamp(90 + impact * 0.55, 80, 260);
              S.catVY = 0; S.catX += S.carVX * DT;
              // second impulse: after riding, cat gets tossed when car slows or after time - handled by leaving roof / jump
              if (Math.abs(S.carVX) < 55) { S.onCar = false; S.catVY = -310; S.catVX = clamp(S.carVX + 210, 180, 360); burst(S.catX, S.catY, 12, "#93c5fd", 150, true); addText(S.catX, S.catY - 44, "¡IMPULSO!", "#1d4ed8", 22); }
            } else if (S.onCar && (S.catX < carLeft || S.catX > carRight)) S.onCar = false;
            // sides of car
            if (!S.onCar && S.catX > carLeft && S.catX < carRight && S.catY + 20 > carTop + 10 && S.catY < GROUND) { S.catVX *= -0.45; S.catX = S.catVX < 0 ? carLeft - 24 : carRight + 24; }
            // house wall (left side & roof) if not window
            const hx = L.houseX, hLeft = hx - 72, hTop = GROUND - 148;
            if (S.catX + 22 > hLeft && S.catX < hx + 60 && S.catY > hTop && S.catY < GROUND) {
              if (S.catY < hTop + 26 && S.catVY > 0 && S.catX > hx - 8) { S.catY = hTop - 22; S.catVY = -Math.abs(S.catVY) * 0.45; }
              else if (S.catY > hTop + 36 && Math.abs(S.catY - wp.y) > 50) { S.catX = hLeft - 23; S.catVX = -Math.abs(S.catVX) * 0.45; addText(S.catX, S.catY - 36, "¡ZAS!", "#b91c1c", 24); S.shake = Math.max(S.shake, 4); }
            }
            // ground
            if (S.catY + 24 >= GROUND) {
              S.catY = GROUND - 24;
              if (Math.abs(S.catVY) > 190) { burst(S.catX, GROUND - 4, 10, "#d6c7b2", 140); S.shake = Math.max(S.shake, 3); S.catSquash = 0.8; }
              S.catVY = -Math.abs(S.catVY) * 0.42; S.catVX *= 0.78;
              if (Math.abs(S.catVY) < 85) S.catVY = 0;
              if (dhypot(S.catX - wp.x, S.catY - wp.y) < 185) { S.catVY = -275; S.catVX = clamp(S.catVX + (wp.x > S.catX ? 150 : -60), -80, 320); S.restTime = 0; }
              else if (Math.abs(S.catVX) < 45 && S.catVY === 0) { S.restTime += DT; if (S.restTime > 0.55) miss("ground"); } else S.restTime = 0;
            }
            if (S.catX < -45 || S.catX > 1010 || S.catY < -280 || S.catY > 570) miss("out");
            else if (S.flyingTime > 13) miss("time");
          }
        }
        S.prevSpace = space; S.prevEnter = enter;
      },
      checksum: () => { const c = createChecksum(); c.add(S.tick).add(S.level).add(S.launchesLeft).add(S.catX).add(S.catY).add(S.catVX).add(S.catVY).add(S.carX).add(S.angle).add(S.power).add(S.levelsDone).add(S.score); return c.value(); },
      state: () => { const wp2 = winPos(); const cd = (S.phase === "flying" || S.phase === "aiming") ? dhypot(S.catX - wp2.x, S.catY - wp2.y) : 9999; const lvlProg = S.phase === "won" ? 4 : S.phase === "clear" ? S.levelsDone : S.phase === "lost" ? S.levelsDone : S.levelsDone + clamp(1 - cd / 820, 0, 1) * 0.92; return { outcome: S.phase === "won" ? "won" : S.phase === "lost" ? "lost" : "playing", progress: clamp(lvlProg / 4, 0, 1), phase: S.phase, level: S.level + 1, launchesLeft: S.launchesLeft, launchesUsed: S.launchesUsedTotal, score: S.score, cat: { x: Math.round(S.catX), y: Math.round(S.catY) }, angle: Math.round(S.angle), power: Math.round(S.power), orbiting: S.orbiting }; },
      over: () => S.phase === "won" || S.phase === "lost",
      save: () => JSON.parse(JSON.stringify({ ...S, particles: S.particles, texts: S.texts })),
      restore: (snap: unknown) => { const o = snap as any; Object.assign(S, JSON.parse(JSON.stringify(o))); },
      inspect: () => S,
      render: (draw: any) => {
        const L = LEVELS[S.level]; const t = S.tick * DT;
        const sx = S.shake ? dsin(S.tick * 39.7) * S.shake : 0, sy = S.shake ? dcos(S.tick * 47.3) * S.shake : 0;
        draw.begin();
        // paper background
        draw.setFillStyle("#fff7e6"); draw.fillRect(0, 0, W, H);
        draw.setFillStyle("#fef3c7"); draw.fillRect(0, 0, W, 120);
        // crayon hills parallax
        draw.setFillStyle("#dcfce7"); draw.beginPath(); draw.moveTo(0, GROUND); for (let x = 0; x <= W; x += 80) draw.lineTo(x, GROUND - 46 - dsin(x * 0.012 + 1) * 18); draw.lineTo(W, GROUND); draw.closePath(); draw.fill();
        draw.setFillStyle("#bbf7d0"); draw.beginPath(); draw.moveTo(0, GROUND); for (let x = 0; x <= W; x += 80) draw.lineTo(x, GROUND - 18 - dsin(x * 0.02) * 10); draw.lineTo(W, GROUND); draw.closePath(); draw.fill();
        // sun glow
        draw.save(); draw.translate(sx, sy);
        draw.setGlobalAlpha(0.20); draw.setFillStyle("#facc15"); draw.beginPath(); draw.arc(L.sunX, L.sunY, 78 + dsin(t * 2) * 6, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1);
        // orbit guide (ring clamped so it never leaves the screen)
        if (S.phase === "flying" && S.orbiting) {
          const dist = Math.max(34, dhypot(S.catX - L.sunX, S.catY - L.sunY));
          const rMax = Math.max(36, Math.min(L.sunX - 10, W - L.sunX - 10, L.sunY - 8, H - L.sunY - 8, 220));
          const rr = Math.min(dist, rMax);
          draw.setFillStyle("#f59e0b");
          const dots = 44;
          for (let i = 0; i < dots; i++) { const ang = (i / dots) * Math.PI * 2 + t * 0.8; draw.beginPath(); draw.arc(L.sunX + dcos(ang) * rr, L.sunY + dsin(ang) * rr, 3.2, 0, Math.PI * 2, false); draw.fill(); }
          draw.setStrokeStyle("#fbbf24"); draw.setLineWidth(2); draw.beginPath(); draw.moveTo(L.sunX, L.sunY); draw.lineTo(S.catX, S.catY); draw.stroke();
        }
        // ground: crayon meadow with texture speckles
        draw.setFillStyle("#86efac"); draw.fillRect(-10, GROUND, W + 20, H - GROUND);
        draw.setFillStyle("#a7f3c9"); draw.fillRect(-10, GROUND, W + 20, 10);
        draw.setFillStyle("#6ee7a8");
        for (let x = 6; x < W; x += 37) { const wob = dsin(x * 0.35) * 8; draw.beginPath(); draw.arc(x + wob, GROUND + 34 + (x % 74 < 37 ? 8 : -2), 5 + (x % 3), 0, Math.PI * 2, false); draw.fill(); }
        draw.setStrokeStyle("#15803d"); draw.setLineWidth(4); draw.beginPath(); draw.moveTo(0, GROUND); for (let x = 0; x <= W; x += 48) draw.lineTo(x, GROUND + dsin(x * 0.05) * 2); draw.stroke();
        // varied crayon grass: tufts of 3 blades + flowers + pebbles (deterministic)
        for (let x = 14; x < W; x += 34) {
          const k = (x * 2654435761) >>> 0; const h1 = 8 + (k % 9), h2 = 6 + ((k >> 3) % 8), h3 = 8 + ((k >> 6) % 9);
          const gcols = ["#15803d", "#16a34a", "#4d7c0f", "#059669"];
          draw.setLineWidth(2.5);
          draw.setStrokeStyle(gcols[k % 4]); draw.beginPath(); draw.moveTo(x, GROUND + 30); draw.lineTo(x - 3, GROUND + 30 - h1); draw.lineTo(x - 6, GROUND + 30 - h1 - 3); draw.stroke();
          draw.setStrokeStyle(gcols[(k >> 2) % 4]); draw.beginPath(); draw.moveTo(x + 5, GROUND + 30); draw.lineTo(x + 5, GROUND + 30 - h2 - 3); draw.lineTo(x + 8, GROUND + 30 - h2 - 5); draw.stroke();
          draw.setStrokeStyle(gcols[(k >> 4) % 4]); draw.beginPath(); draw.moveTo(x + 10, GROUND + 30); draw.lineTo(x + 13, GROUND + 30 - h3); draw.lineTo(x + 16, GROUND + 30 - h3 - 2); draw.stroke();
          const kind = (k >> 7) % 10;
          if (kind < 2) { // crayon flower
            const fx = x + 5, fy = GROUND + 26; const pc = (k >> 9) % 2 ? "#f472b6" : "#fb923c";
            draw.setFillStyle(pc);
            for (let p = 0; p < 5; p++) { const pa = p * Math.PI * 2 / 5; draw.beginPath(); draw.arc(fx + dcos(pa) * 4, fy + dsin(pa) * 4, 2.6, 0, Math.PI * 2, false); draw.fill(); }
            draw.setFillStyle("#facc15"); draw.beginPath(); draw.arc(fx, fy, 2.6, 0, Math.PI * 2, false); draw.fill();
          } else if (kind < 4) { // pebble
            draw.setFillStyle("#d1d5db"); draw.beginPath(); draw.arc(x + 6, GROUND + 40, 3 + (k % 3), 0, Math.PI * 2, false); draw.fill();
            draw.setStrokeStyle("#9ca3af"); draw.setLineWidth(1.5); draw.stroke();
          }
        }

        const drawSprite = (name: string, cx: number, cy: number, w: number, h: number, rot = 0, squashX = 1, squashY = 1) => {
          const texture = tex[name]; const d = dims[name];
          draw.save(); draw.translate(cx, cy); if (rot) draw.rotate(rot); draw.scale(squashX, squashY);
          if (texture) draw.drawImage(texture, 0, 0, d.w, d.h, -w / 2, -h / 2, w, h);
          else { draw.setFillStyle("#fbbf24"); draw.fillRect(-w / 2, -h / 2, w, h); }
          draw.restore();
        };

        if (S.phase === "title") {
          // crayon doodle clouds
          const clouds: [number, number, number][] = [[150, 150, 1], [800, 130, 0.8], [700, 330, 0.6]];
          for (const [cx0, cy0, cs] of clouds) {
            const cx = cx0 + dsin(t * 0.4 + cx0) * 8;
            draw.setFillStyle("#ffffff"); draw.setStrokeStyle("#93c5fd"); draw.setLineWidth(3);
            draw.beginPath(); draw.ellipse(cx, cy0, 46 * cs, 20 * cs, 0, 0, Math.PI * 2, false); draw.fill(); draw.stroke();
            draw.beginPath(); draw.ellipse(cx - 28 * cs, cy0 + 8 * cs, 24 * cs, 14 * cs, 0, 0, Math.PI * 2, false); draw.fill(); draw.stroke();
            draw.beginPath(); draw.ellipse(cx + 28 * cs, cy0 + 8 * cs, 26 * cs, 15 * cs, 0, 0, Math.PI * 2, false); draw.fill(); draw.stroke();
          }
          // scattered crayon stars
          for (let i = 0; i < 12; i++) { const sx0 = 60 + (i * 173) % 840, sy0 = 130 + (i * 97) % 180; draw.setFillStyle(COLORS[i % COLORS.length]); draw.setGlobalAlpha(0.55); draw.beginPath(); draw.arc(sx0 + dsin(t + i) * 4, sy0, 3 + (i % 3), 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1); }
          // cast on stage: house, tree and car at full color flanking the orbit
          drawSprite("house", 480, 365, 210, 219);
          drawSprite("tree", 165, 400, 130, 146, dsin(t * 1.2) * 0.03);
          drawSprite("car", 795, 432, 150, 97);
          // sun rays behind the orbiting cat
          draw.setStrokeStyle("#fbbf24"); draw.setLineWidth(5);
          for (let i = 0; i < 10; i++) { const ra = t * 0.3 + i * Math.PI * 2 / 10; draw.beginPath(); draw.moveTo(480 + dcos(ra) * 92, 205 + dsin(ra) * 86); draw.lineTo(480 + dcos(ra) * 108, 205 + dsin(ra) * 100); draw.stroke(); }
          drawSprite("sun", 480, 205, 150, 135);
          // dotted orbit path of the title cat (fits on screen)
          draw.setFillStyle("#f59e0b");
          for (let i = 0; i < 40; i++) { const ang = i * Math.PI * 2 / 40; draw.beginPath(); draw.arc(480 + dcos(ang) * 118, 205 + dsin(ang) * 72, 2.8, 0, Math.PI * 2, false); draw.fill(); }
          // orbiting cat
          drawSprite("cat", S.catX, S.catY, 84, 64, S.catRot);
          for (const p of S.particles) { draw.setFillStyle(p.color); draw.beginPath(); draw.arc(p.x, p.y, p.size, 0, Math.PI * 2, false); draw.fill(); }
          draw.setTextAlign("center"); draw.setTextBaseline("middle");
          // title banner card so text never fights the art
          draw.setFillStyle("rgba(255,255,255,0.92)"); draw.fillRect(200, 18, 560, 108); draw.setStrokeStyle("#111827"); draw.setLineWidth(3); draw.strokeRect(200, 18, 560, 108);
          draw.setFont('52px "archivo black", sans-serif'); draw.setStrokeStyle("#111827"); draw.setLineWidth(8); draw.strokeText("GATO COMETA", 480, 62); draw.setFillStyle("#dc2626"); draw.fillText("GATO COMETA", 480, 62);
          draw.setFont('22px "archivo black", sans-serif'); draw.setFillStyle("#111827"); draw.fillText("órbita y a casa", 480, 102);
          draw.setFillStyle("rgba(17,24,39,0.85)"); draw.fillRect(150, 452, 660, 58);
          draw.setFont('15px "archivo black", sans-serif'); draw.setFillStyle("#fef9c3"); draw.fillText("Lanza al gato, orbita el SOL con ESPACIO,", 480, 466); draw.fillText("rebota en el ÁRBOL, súbete al COCHE y entra por la ventana.", 480, 488);
          if (Math.floor(t * 2) % 2 === 0) { draw.setFillStyle("rgba(255,255,255,0.92)"); draw.fillRect(398, 416, 164, 30); draw.setStrokeStyle("#15803d"); draw.setLineWidth(2); draw.strokeRect(398, 416, 164, 30); draw.setFont('24px "bangers", sans-serif'); draw.setFillStyle("#15803d"); draw.fillText("Pulsa ENTER", 480, 432); }
          draw.restore(); draw.end({ r: 0.99, g: 0.97, b: 0.90 }); return;
        }

        // level objects (behind cat)
        drawSprite("sun", L.sunX, L.sunY, 108, 97, dsin(t) * 0.06);
        // tree with squash
        const ts = S.treeSquash; drawSprite("tree", L.treeX, GROUND - 62 - L.treeLift / 2, (112 + L.treeLift * 0.35) * (1 + ts * 0.18), (126 + L.treeLift) * (1 - ts * 0.14));
        // car
        drawSprite("car", S.carX, GROUND - 34 + (S.carDust ? dsin(S.tick * 2.2) * 2 : 0), 148, 96);
        if (Math.abs(S.carVX) > 20) { draw.setFont('15px "archivo black", sans-serif'); draw.setTextAlign("center"); draw.setFillStyle("#1d4ed8"); draw.fillText("¡clac clac!", S.carX, GROUND - 92); }
        // house
        drawSprite("house", L.houseX, GROUND - 76, 152, 159);
        // window target glow
        const wp = winPos(); const pulse = 1 + dsin(t * 5) * 0.12;
        draw.setGlobalAlpha(0.35); draw.setFillStyle("#facc15"); draw.beginPath(); draw.arc(wp.x, wp.y, 42 * pulse, 0, Math.PI * 2, false); draw.fill(); draw.setGlobalAlpha(1);
        draw.setFillStyle("#fef08a"); draw.fillRect(wp.x - 20, wp.y - 22, 40, 44); draw.setStrokeStyle("#b45309"); draw.setLineWidth(4); draw.strokeRect(wp.x - 20, wp.y - 22, 40, 44); draw.beginPath(); draw.moveTo(wp.x, wp.y - 22); draw.lineTo(wp.x, wp.y + 22); draw.stroke();
        draw.setFont('12px "archivo black", sans-serif'); draw.setTextAlign("center"); draw.setFillStyle("#92400e"); draw.fillText("VENTANA", wp.x, wp.y - 34);

        // trajectory dots in aiming
        if (S.phase === "aiming") {
          const a = S.angle * Math.PI / 180, sp = 300 + S.power * 5.6; let px = 92, py = GROUND - 30, vx = dcos(a) * sp, vy = -dsin(a) * sp;
          draw.setFillStyle("#111827");
          for (let i = 0; i < 42; i++) { vy += 540 * DT; px += vx * DT; py += vy * DT; if (py > GROUND) break; if (i % 2 === 0) { draw.setGlobalAlpha(0.75 - i * 0.012); draw.beginPath(); draw.arc(px, py, 4, 0, Math.PI * 2, false); draw.fill(); } }
          draw.setGlobalAlpha(1);
          // launcher arrow
          draw.setStrokeStyle("#dc2626"); draw.setLineWidth(5); draw.beginPath(); draw.moveTo(92, GROUND - 30); draw.lineTo(92 + dcos(a) * 62, GROUND - 30 - dsin(a) * 62); draw.stroke();
        }
        // launch cushion: crayon-striped catapult mound (no flat placeholder rects)
        draw.setFillStyle("#b45309"); draw.beginPath(); draw.ellipse(94, GROUND - 4, 48, 14, 0, 0, Math.PI * 2, false); draw.fill();
        draw.setFillStyle("#fbbf24"); draw.beginPath(); draw.ellipse(94, GROUND - 10, 40, 11, 0, 0, Math.PI * 2, false); draw.fill();
        draw.setStrokeStyle("#92400e"); draw.setLineWidth(3); draw.beginPath(); draw.ellipse(94, GROUND - 10, 40, 11, 0, 0, Math.PI * 2, false); draw.stroke();
        draw.setStrokeStyle("#dc2626"); draw.setLineWidth(3);
        for (let i = -2; i <= 2; i++) { draw.beginPath(); draw.moveTo(94 + i * 14 - 5, GROUND - 18); draw.lineTo(94 + i * 14 + 5, GROUND - 3); draw.stroke(); }
        // tiny crayon flag on the mound
        draw.setStrokeStyle("#111827"); draw.setLineWidth(3); draw.beginPath(); draw.moveTo(132, GROUND - 10); draw.lineTo(132, GROUND - 40); draw.stroke();
        draw.setFillStyle("#dc2626"); draw.beginPath(); draw.moveTo(132, GROUND - 40); draw.lineTo(154, GROUND - 33); draw.lineTo(132, GROUND - 26); draw.closePath(); draw.fill();

        // particles
        for (const p of S.particles) { const al = 1 - p.life / p.max; draw.setGlobalAlpha(al); draw.setFillStyle(p.color); if (p.star) { draw.beginPath(); for (let i = 0; i < 5; i++) { const ang = -Math.PI / 2 + i * (Math.PI * 2 / 5); const ang2 = ang + Math.PI / 5; draw.lineTo(p.x + dcos(ang) * p.size * 1.8, p.y + dsin(ang) * p.size * 1.8); draw.lineTo(p.x + dcos(ang2) * p.size * 0.8, p.y + dsin(ang2) * p.size * 0.8); } draw.closePath(); draw.fill(); } else { draw.beginPath(); draw.arc(p.x, p.y, p.size, 0, Math.PI * 2, false); draw.fill(); } }
        draw.setGlobalAlpha(1);
        // cat with squash
        const sq = S.catSquash; const catScaleX = 1 + sq * 0.25, catScaleY = 1 - sq * 0.18;
        if (S.phase !== "clear") drawSprite("cat", S.catX, S.catY, 76, 58, S.phase === "flying" ? S.catRot : 0, catScaleX, catScaleY);
        else drawSprite("cat", wp.x, wp.y, 62, 47, dsin(t * 6) * 0.2, 1, 1);
        if (S.orbiting && S.phase === "flying") { draw.setFont('15px "archivo black", sans-serif'); draw.setTextAlign("center"); draw.setFillStyle("#b45309"); draw.fillText("¡ORBITANDO!", S.catX, S.catY - 44); }
        // floating texts
        for (const ft of S.texts) { const al = ft.life < 0.15 ? ft.life / 0.15 : 1 - Math.max(0, ft.life - 0.9) / 0.45; draw.setGlobalAlpha(clamp(al, 0, 1)); draw.setFont(`${ft.size}px "bangers", sans-serif`); draw.setTextAlign("center"); draw.setTextBaseline("middle"); draw.setStrokeStyle("#ffffff"); draw.setLineWidth(6); const yy = ft.y - ft.life * 28; draw.strokeText(ft.text, ft.x, yy); draw.setFillStyle(ft.color); draw.fillText(ft.text, ft.x, yy); }
        draw.setGlobalAlpha(1);
        draw.restore();

        // HUD
        draw.setFillStyle("rgba(255,255,255,0.88)"); draw.fillRect(10, 10, 430, 54); draw.setStrokeStyle("#111827"); draw.setLineWidth(2); draw.strokeRect(10, 10, 430, 54);
        draw.setTextAlign("left"); draw.setTextBaseline("middle"); draw.setFont('17px "archivo black", sans-serif'); draw.setFillStyle("#111827"); draw.fillText(`Nivel ${S.level + 1}/4   Puntos ${S.score}`, 22, 30);
        draw.setFont('13px "archivo black", sans-serif'); draw.setFillStyle("#374151"); draw.fillText(`Vuelos restantes: ${Math.max(0, S.launchesLeft)}/5`, 22, 52);
        draw.setTextAlign("right"); draw.fillText(S.phase === "aiming" ? `Ángulo ${Math.round(S.angle)}°  Potencia ${Math.round(S.power)}` : S.orbiting ? "SOL activado" : "En vuelo", 428, 52);
        // hint bar
        draw.setFillStyle("rgba(17,24,39,0.82)"); draw.fillRect(210, 502, 540, 28); draw.setTextAlign("center"); draw.setFont('13px "archivo black", sans-serif'); draw.setFillStyle("#fef9c3"); draw.fillText(S.phase === "aiming" ? "←→ ángulo · ↑↓ potencia · ESPACIO lanzar" : L.hint, 480, 517);
        if (S.phase === "clear") { draw.setTextAlign("center"); draw.setFont('42px "bangers", sans-serif'); draw.setStrokeStyle("#fff"); draw.setLineWidth(8); draw.strokeText("¡NIVEL SUPERADO!", 480, 230); draw.setFillStyle("#15803d"); draw.fillText("¡NIVEL SUPERADO!", 480, 230); }
        if (S.phase === "won") {
          draw.setFillStyle("rgba(255,247,230,0.94)"); draw.fillRect(180, 130, 600, 280); draw.setStrokeStyle("#111827"); draw.setLineWidth(3); draw.strokeRect(180, 130, 600, 280);
          drawSprite("cat", 480, 215, 96, 73, dsin(t * 4) * 0.15); drawSprite("house", 640, 215, 110, 115); drawSprite("sun", 330, 205, 90, 81);
          draw.setTextAlign("center"); draw.setFont('38px "archivo black", sans-serif'); draw.setFillStyle("#15803d"); draw.fillText("¡GATO EN CASA!", 480, 300); draw.setFont('18px "archivo black", sans-serif'); draw.setFillStyle("#111827"); draw.fillText(`Puntos ${S.score} · Vuelos usados ${S.launchesUsedTotal}`, 480, 338); if (Math.floor(t * 2) % 2 === 0) draw.fillText("ENTER para jugar de nuevo", 480, 378);
        }
        if (S.phase === "lost") {
          draw.setFillStyle("rgba(255,247,230,0.94)"); draw.fillRect(200, 150, 560, 240); draw.setStrokeStyle("#111827"); draw.setLineWidth(3); draw.strokeRect(200, 150, 560, 240);
          drawSprite("cat", 480, 225, 84, 64, 0.4);
          draw.setTextAlign("center"); draw.setFont('34px "archivo black", sans-serif'); draw.setFillStyle("#b91c1c"); draw.fillText("SIN VUELOS...", 480, 295); draw.setFont('17px "archivo black", sans-serif'); draw.setFillStyle("#111827"); draw.fillText(`Llegaste al nivel ${S.level + 1} · Puntos ${S.score}`, 480, 330); if (Math.floor(t * 2) % 2 === 0) draw.fillText("ENTER para jugar de nuevo", 480, 365);
        }
        draw.end({ r: 0.99, g: 0.97, b: 0.90 });
      },
    };
  },
});
