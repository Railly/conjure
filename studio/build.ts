// Builds one game from a chosen concept, emitting events the Studio shows live: scaffold, art, code (each agent tool
// call), checks, playtester, visual QA, fixes. The verdicts come from independent checks, never from the agent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { costOf, runAgent } from "../make/agent";
import type { Concept } from "./concepts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const DOTFRAME_REF = "github:crafter-games/dotframe#a1cdfb193838e7821a98068dae159d163afce51a";
// Fixer rounds after the playtester and visual QA: this builder's own cap, so a game that cannot be fixed ends.
const FIX_ROUNDS = 2;

export type Emit = (e: { stage: string; message: string; data?: unknown }) => void;

const sh = (cmd: string[], cwd: string) => {
  const r = Bun.spawnSync(cmd, { cwd, env: process.env });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const shAsync = async (cmd: string[], cwd: string, env: Record<string, string> = {}) => {
  const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
};

// An empty game that knows its engine, with the engine's fonts.
export async function scaffold(dir: string, slug: string): Promise<void> {
  mkdirSync(join(dir, "assets/fonts"), { recursive: true });
  mkdirSync(join(dir, "replays"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: slug, private: true, type: "module", dependencies: { dotframe: DOTFRAME_REF }, devDependencies: { "@types/bun": "^1.3.0", "@webgpu/types": "^0.1.74", typescript: "^5.9.0" } }, null, 2),
  );
  writeFileSync(join(dir, "tsconfig.json"), await Bun.file(join(ROOT, "make/game-tsconfig.json")).text());
  writeFileSync(join(dir, "dotframe.json"), JSON.stringify({ name: slug, sim: "sim.ts" }, null, 2));
  // Public registry on purpose: a machine-level registry mirror must not leak into the game's lockfile.
  const install = await shAsync(["bun", "install", "--no-cache"], dir, { NPM_CONFIG_REGISTRY: "https://registry.npmjs.org", BUN_CONFIG_REGISTRY: "https://registry.npmjs.org" });
  if (install.code !== 0) throw new Error(`bun install failed: ${install.err}`);
  for (const f of ["archivo-black.png", "archivo-black.json", "bangers.png", "bangers.json"])
    writeFileSync(join(dir, "assets/fonts", f), new Uint8Array(await Bun.file(join(dir, "node_modules/dotframe/assets/fonts", f)).arrayBuffer()));
}

// Cuts the player's drawings out of a photo into assets/. Returns the drawing names.
export async function cutPhoto(dir: string, photo: string): Promise<string[]> {
  const r = await shAsync(["bun", join(ROOT, "spike/v1-photo.ts"), photo], ROOT, { CONJURE_OUT: join(dir, "assets") });
  if (r.code !== 0) throw new Error(`photo pipeline failed: ${r.err.slice(0, 400)}`);
  const report = await Bun.file(join(dir, "assets/report.json")).json();
  return (report.objects as { name: string; parts?: number }[]).filter((o) => o.parts).map((o) => o.name);
}

const conceptText = (c: Concept) =>
  `Title: ${c.title}\nGenre: ${c.genre}\nPitch: ${c.pitch}\nCore mechanic: ${c.core_mechanic}\nControls: ${c.controls}\nWin: ${c.win}\nLose: ${c.lose}\nRoles: ${c.roles.map((r) => `${r.object}: ${r.role}`).join("; ")}\nJuice: ${c.juice}\nPalette: ${c.palette}`;

export async function buildGame(opts: { dir: string; slug: string; concept: Concept; drawings: string[]; emit: Emit }): Promise<{ verdict: string; cost: number; ms: number }> {
  const { dir, slug, concept, drawings, emit } = opts;
  const started = performance.now();
  const CLI = join(dir, "node_modules/dotframe/cli/bin.cjs");
  const core = sh(["node", CLI, "skills", "get", "core"], dir).out;
  const CUTOUT = `CONJURE_OUT=assets bun ${ROOT}/spike/v1-cutout.ts `;
  const SPRITE = `bun ${ROOT}/spike/v1-sprite.ts ${dir}/assets `;
  const VERIFY = `bun ${ROOT}/make/verify.ts ${slug}`;
  const bashOk = [`node ${CLI} `, CUTOUT, SPRITE, VERIFY, "bunx tsc --noEmit", "ls", "cat assets/report.json"];
  writeFileSync(join(dir, "CONCEPT.md"), `${conceptText(concept)}\n`);

  const art = drawings.length
    ? `The art is the player's own hand drawings, cut out of their photo: ${drawings.map((d) => `assets/${d}.png`).join(", ")}, each with assets/<name>.hitbox.json ({width, height, parts}: collision boxes in pixels, relative to the image center, y up). They are the stars: keep them recognizable, never recolor or replace them. If the concept needs one more object, draw it in their style: ${SPRITE}<name> "<what>".`
    : `Make the art: ${CUTOUT}"<sheet prompt: one sheet of hand-painted game sprites in the concept's palette on plain white paper, evenly spaced, not touching, flat front view, no shadows, no text>" "<noun1,noun2,...>". It writes assets/<noun>.png (sticker cutouts) and assets/<noun>.hitbox.json ({width, height, parts}: collision boxes in pixels, relative to the image center, y up). Check cat assets/report.json: every quality.missed well under 0.1. One more object later in the same style: ${SPRITE}<name> "<what>".`;

  const system = `You are building a small, POLISHED game with the dotframe engine in ${dir}: the concept below, exactly, as a finished product a player would show friends. Work alone until it is done; nobody will answer questions.

# Concept
${conceptText(concept)}

# Art
${art}

# Build
- sim.ts holds the Sim contract (dotframe core skill below). Load images with platform.load + platform.image (only when platform.image exists; headless runs have none); PNG width and height are big-endian uint32 at offsets 16 and 20. Load hitboxes in every run, headless included.
- Text needs a font: in create(), when platform.draw and platform.image exist, platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json"))). bangers is also there. Latin-1 only, no emoji.
- Physics if the concept needs it: dotframe/src/physics (Body with parts from the hitbox JSON scaled to the drawn size, stepBodies, Body.pushable, FIXED_STEP; y up, flip when drawing; gravity 0 for top-down). Grid, rhythm or arena games can skip physics.
- 3D concepts: createRenderer from dotframe/src/render in create(), draw.scene(renderer.draws(...)) then the HUD; drawings as UV cards (alphaCutoff) facing the camera.
- state() must include outcome ("playing" | "won" | "lost") and progress (0 to 1, how close to winning). Winnable, but not by doing nothing or holding one key.
- Everything in one plain state object; changes only in step; render only reads. Seeded randomness in the state, no Math.random or Date. dotframe/src/detmath instead of Math.sin/cos/pow/exp. Draw2D setters: setFillStyle, setStrokeStyle, setLineWidth, setFont.

# Polish (this is what wins: do all of it)
- A title screen: the game's name big, the drawings animated on it, "Pulsa ENTER" blinking. Then play. A win screen and a lose screen with the score and "ENTER para jugar de nuevo".
- The concept's juice, implemented for real: particles (simulated in state) on every important event, screen shake on impacts, squash and stretch when things jump, land or hit (scale the sprite when drawing), floating feedback text, smooth easing, a background with depth (gradient, parallax layers, details in the palette).
- A clean HUD: readable size, strong contrast, aligned, nothing overlapping.
- Difficulty ramps over the minute.

# Verify, and fix until all pass
- node ${CLI} doctor --json: no ok false unless warn is true.
- node ${CLI} sim --mash 7 --frames 1800 --json: reacts to input, nothing leaves the world.
- node ${CLI} snap --frame 30 --out ${dir}/shot-title.png --json and --frame 600 --mash 7 --out ${dir}/shot-play.png: Read both PNGs and look like a picky art director. data.warnings must be absent.
- ${VERIFY}: verdict "ok".
- bunx tsc --noEmit -p .
- node ${CLI} replay record replays/mash.json --mash 7 --frames 1800 --json
Bash runs single commands only, from: ${bashOk.join(" | ")}. Write files with Write and Edit.
Finish with two sentences in Spanish: what the game is and how to play.

# dotframe core skill
${core}`;

  const onTool = (name: string, input: unknown) => {
    const i = input as { file_path?: string; command?: string };
    const cmd = i.command ?? "";
    const message = cmd.includes("v1-cutout") ? "Pintando la hoja de arte" : cmd.includes("v1-sprite") ? "Dibujando un sprite nuevo" : cmd.includes(" snap ") ? "Mirando el juego (captura)" : cmd.includes("verify.ts") ? "Playtester probando el juego" : cmd.includes(" doctor") ? "Chequeando el motor" : cmd.includes(" sim ") ? "Simulando partidas" : cmd.includes("tsc") ? "Compilando" : name === "Write" || name === "Edit" ? `Escribiendo ${String(i.file_path ?? "").replace(`${dir}/`, "")}` : name === "Read" ? `Leyendo ${String(i.file_path ?? "").replace(`${dir}/`, "")}` : name;
    emit({ stage: "code", message, data: { tool: name } });
  };

  emit({ stage: "code", message: "Muse Wonder empieza a construir" });
  const runs = [await runAgent({ dir, model: "muse-wonder-1.0", system, prompt: "Build it.", bashOk, tag: "agent", onTool })];

  // Independent checks: the playtester and a visual QA pass on fresh captures.
  const playtest = () => JSON.parse(sh(["bun", join(ROOT, "make/verify.ts"), slug], ROOT).out || "{}") as { verdict?: string; advice?: string };
  const visual = async (): Promise<{ ok: boolean; issues: string[] }> => {
    const shots = ["30", "600"].map((f) => {
      const out = join(dir, `qa-${f}.png`);
      sh(["node", CLI, "snap", "--frame", f, ...(f === "30" ? [] : ["--mash", "7"]), "--out", out, "--json"], dir);
      return out;
    });
    const images = await Promise.all(shots.map(async (p) => ((await Bun.file(p).exists()) ? `data:image/png;base64,${Buffer.from(await Bun.file(p).arrayBuffer()).toString("base64")}` : null)));
    if (images.some((i) => !i)) return { ok: false, issues: ["a capture failed: the game does not render"] };
    const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey: process.env.MODEL_API_KEY });
    const res = await client.chat.completions.create({
      model: "muse-spark-1.3",
      reasoning_effort: "low",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Two captures of a small game (first: its opening screen, second: mid-play). The concept: ${concept.title}, ${concept.pitch}. Judge it as a picky art director. List only real, visible problems that make it look unfinished: unreadable or overlapping text, an empty or flat screen, missing title screen, sprites cut off or misplaced, ugly placeholder shapes, no visual feedback. ok is true only when it looks like a finished, polished game.` },
            ...images.map((url) => ({ type: "image_url" as const, image_url: { url: url! } })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "qa", strict: true, schema: { type: "object", additionalProperties: false, required: ["ok", "issues"], properties: { ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } } } },
      },
    });
    return JSON.parse(res.choices[0]?.message?.content ?? '{"ok":false,"issues":["no answer"]}');
  };

  emit({ stage: "check", message: "Playtester independiente" });
  let play = playtest();
  emit({ stage: "check", message: `Playtester: ${play.verdict}`, data: play });
  let qa = await visual();
  emit({ stage: "check", message: qa.ok ? "QA visual: ok" : `QA visual: ${qa.issues.length} problemas`, data: qa });
  for (let round = 1; (play.verdict !== "ok" || !qa.ok) && round <= FIX_ROUNDS; round++) {
    emit({ stage: "fix", message: `Arreglando (ronda ${round})` });
    const problems = [play.verdict !== "ok" ? `Playtester verdict ${play.verdict}: ${play.advice}` : "", qa.ok ? "" : `Visual QA: ${qa.issues.join("; ")}`].filter(Boolean).join("\n");
    runs.push(await runAgent({ dir, model: "muse-spark-1.3", system, prompt: `The game is built, but independent checks found problems. Fix them, keep the same game, and re-run the checks:\n${problems}`, bashOk, tag: `fix-${round}`, onTool }));
    play = playtest();
    qa = await visual();
    emit({ stage: "check", message: `Playtester: ${play.verdict}. QA visual: ${qa.ok ? "ok" : `${qa.issues.length} problemas`}`, data: { play, qa } });
  }
  const cost = runs.reduce((s, r) => s + costOf(r), 0);
  const verdict = play.verdict === "ok" && qa.ok ? "ok" : play.verdict === "ok" ? "ok-gameplay" : (play.verdict ?? "unknown");
  const ms = Math.round(performance.now() - started);
  writeFileSync(join(dir, "build.json"), JSON.stringify({ concept, verdict, playtest: play, qa, cost_usd: +cost.toFixed(4), ms, runs }, null, 2));
  emit({ stage: "done", message: runs[0]?.summary ?? "Listo", data: { verdict, cost, ms } });
  return { verdict, cost, ms };
}
