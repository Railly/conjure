// Playtests a generated game headless, through its Sim, the way a skeptical player would. Two questions:
// 1. Is it too easy? Dumb policies (do nothing, hold one direction, hold everything, mash) must not win.
// 2. Is it winnable? A search player tries input segments, keeps the ones that raise state().progress, and backs up
//    with save/restore when a segment loses. A win it finds is proof; not finding one within the budget is a warning.
// Contract read from state(): outcome ("playing" | "won" | "lost") and progress (0..1 toward winning).
//   bun make/verify.ts <slug> [--json]
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const slug = process.argv[2];
if (!slug) throw new Error("usage: verify.ts <slug> [--json]");
const dir = `${ROOT}/games/${slug}`;

interface Run {
  ready: Promise<void>;
  start: (seed: number, options: Record<string, unknown>) => void;
  step: (inputs: number[]) => void;
  state: () => unknown;
  over: () => boolean;
  save: () => unknown;
  restore: (s: unknown) => void;
}
interface Sim {
  players: number;
  options: Record<string, unknown>;
  neutral: number;
  encode: (input: unknown) => number;
  random: (next: () => number) => number;
  create: (p: unknown) => Run;
}

const sim = (await import(join(dir, "sim.ts"))).default as Sim;
const platform = { gpu: {}, headless: true, load: async (p: string) => new Uint8Array(await Bun.file(join(dir, p)).arrayBuffer()) };
const run = sim.create(platform);
await run.ready;

// Search and playtest budget. These are this verifier's own choices, not measured limits: a game longer than
// MAX_FRAMES (2 minutes at 60 Hz) is reported as not won within the budget, not as unwinnable.
const MAX_FRAMES = 7200;
const SEGMENT = 20;
const TRIES = 12;

const read = () => run.state() as { outcome?: string; progress?: number };
const contract = (() => {
  run.start(1, { ...sim.options });
  const s = read();
  return { outcome: typeof s.outcome === "string", progress: typeof s.progress === "number" };
})();

let seed = 1;
const next = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};
const play = (policy: (frame: number) => number): { outcome: string; frames: number; progress: number } => {
  run.start(1, { ...sim.options });
  let f = 0;
  for (; f < MAX_FRAMES; f++) {
    const s = read();
    if (s.outcome === "won" || s.outcome === "lost") return { outcome: s.outcome, frames: f, progress: s.progress ?? 0 };
    run.step([policy(f), ...Array(sim.players - 1).fill(sim.neutral)]);
  }
  return { outcome: read().outcome ?? "playing", frames: f, progress: read().progress ?? 0 };
};

const keys = ["left", "right", "up", "down", "jump", "action", "fire", "space", "enter"];
const all = Object.fromEntries(keys.map((k) => [k, true]));
const dumb: Record<string, (f: number) => number> = {
  idle: () => sim.neutral,
  "hold-right": () => sim.encode({ right: true, d: true }),
  "hold-left": () => sim.encode({ left: true, a: true }),
  "hold-right-jump": () => sim.encode({ right: true, d: true, jump: true, up: true, space: true }),
  "hold-everything": () => sim.encode(all),
  "tap-action": (f) => (f % 20 < 2 ? sim.encode({ action: true, space: true, enter: true, jump: true, fire: true }) : sim.neutral),
};
const mashSeeds = [1, 2, 3, 4, 5, 6, 7, 8];
const results: Record<string, { outcome: string; frames: number; progress: number }> = {};
for (const [name, policy] of Object.entries(dumb)) results[name] = play(policy);
for (const s of mashSeeds) {
  seed = s;
  let held = sim.neutral;
  results[`mash-${s}`] = play((f) => {
    if (f % 6 === 0) held = sim.random(next);
    return held;
  });
}

// Search: greedy on progress over input segments, with restore to undo a losing or useless segment.
const search = (): { outcome: string; frames: number; progress: number; inputs: number } => {
  run.start(1, { ...sim.options });
  seed = 99;
  let frames = 0;
  let inputs = 0;
  let best = read().progress ?? 0;
  while (frames < MAX_FRAMES) {
    const base = run.save();
    let pick: { snap: unknown; progress: number } | null = null;
    for (let t = 0; t < TRIES; t++) {
      run.restore(structuredClone(base));
      const input = sim.random(next);
      inputs++;
      for (let i = 0; i < SEGMENT; i++) run.step([input, ...Array(sim.players - 1).fill(sim.neutral)]);
      const s = read();
      if (s.outcome === "won") return { outcome: "won", frames: frames + SEGMENT, progress: s.progress ?? 1, inputs };
      if (s.outcome === "lost") continue;
      const p = s.progress ?? 0;
      if (!pick || p > pick.progress) pick = { snap: run.save(), progress: p };
    }
    if (!pick) return { outcome: "lost", frames, progress: best, inputs };
    run.restore(structuredClone(pick.snap));
    best = Math.max(best, pick.progress);
    frames += SEGMENT;
  }
  return { outcome: read().outcome ?? "playing", frames, progress: best, inputs };
};
const searched = contract.outcome ? search() : null;

const easyWins = Object.entries(results)
  .filter(([name, r]) => r.outcome === "won" && !name.startsWith("mash-"))
  .map(([name]) => name);
const verdict = !contract.outcome
  ? "broken"
  : easyWins.length > 0
    ? "too-easy"
    : searched?.outcome === "won"
      ? "ok"
      : "unproven";
const report = {
  slug,
  verdict,
  contract,
  too_easy_by: easyWins,
  search: searched,
  budget: { max_frames: MAX_FRAMES, segment: SEGMENT, tries: TRIES },
  policies: results,
  advice:
    verdict === "broken"
      ? "state() needs outcome (playing|won|lost) and progress (0..1)."
      : verdict === "too-easy"
        ? `These policies win without playing: ${easyWins.join(", ")}. Add a threat, a timing or a choice that each of them fails.`
        : verdict === "unproven"
          ? `The search player did not win within ${MAX_FRAMES} frames (best progress ${searched?.progress.toFixed(2)}). The game may be too hard, or progress may not track how close the player is to winning.`
          : "Winnable, and no dumb policy wins.",
};
await Bun.write(join(dir, "verify.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
