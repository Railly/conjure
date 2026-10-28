// Builds race in Vercel Sandboxes: one attempt per concept starts as soon as the concepts exist (so the one you pick
// is already under way), and picking a concept adds more attempts of it. The first attempt whose independent checks
// pass wins; the rest are stopped. Without sandbox credentials it falls back to one local build of the chosen concept.
import { cpSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { buildRemote, codeTarball } from "../sandbox/remote";
import { type Emit, scaffold } from "./build";
import type { Concept } from "./concepts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// Attempts of the chosen concept, counting its prebuild: the race's width.
export const ATTEMPTS = Number(process.env.CONJURE_ATTEMPTS ?? 3);

export const remoteReady = () => Boolean((process.env.VERCEL_OIDC_TOKEN || (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID)) && process.env.CONJURE_SNAPSHOT_ID);

interface Attempt {
  concept: number;
  k: number;
  slug: string;
  dir: string;
  ctrl: AbortController;
  done: Promise<{ verdict: string; cost: number; ms: number } | null>;
}

export class Race {
  attempts: Attempt[] = [];
  chosen = -1;
  private code: Promise<Uint8Array> | null = null;
  constructor(
    private session: { slug: string; dir: string; drawings: string[]; concepts: Concept[] },
    private emit: Emit,
  ) {}

  private launch(concept: number, k: number): Attempt {
    const slug = `${this.session.slug}-c${concept}-${k}`;
    const dir = join(ROOT, "games", slug);
    mkdirSync(join(dir, "assets"), { recursive: true });
    cpSync(join(this.session.dir, "assets"), join(dir, "assets"), { recursive: true });
    this.code ??= codeTarball();
    const ctrl = new AbortController();
    // Only the chosen concept's attempts talk to the feed, tagged so parallel lines read apart.
    const emit: Emit = (e) => {
      if (this.chosen === concept) this.emit({ ...e, message: `#${k + 1} ${e.message}`, data: { ...(e.data as object), attempt: k } });
    };
    const done = this.code
      .then((code) => buildRemote({ slug, localDir: dir, concept: this.session.concepts[concept]!, drawings: this.session.drawings, code, emit, signal: ctrl.signal }))
      .then((r) => ({ verdict: r.verdict, cost: r.cost, ms: r.ms }))
      .catch((e) => {
        if (!ctrl.signal.aborted) emit({ stage: "error", message: String(e).slice(0, 200) });
        return null;
      });
    const a = { concept, k, slug, dir, ctrl, done };
    this.attempts.push(a);
    return a;
  }

  // As soon as the concepts exist: one attempt each.
  prebuild(): void {
    this.session.concepts.forEach((_, i) => this.launch(i, 0));
  }

  // The player picked a concept: stop the others, widen this one, and return the first attempt that passes (or the
  // best finisher when none passes).
  async choose(index: number): Promise<{ slug: string; dir: string; verdict: string; cost: number } | null> {
    this.chosen = index;
    for (const a of this.attempts) if (a.concept !== index) a.ctrl.abort();
    const mine = this.attempts.filter((a) => a.concept === index);
    for (let k = mine.length; k < ATTEMPTS; k++) mine.push(this.launch(index, k));
    this.emit({ stage: "build", message: `${mine.length} construcciones en paralelo; gana la primera que pase los chequeos` });
    const finished: { a: Attempt; r: { verdict: string; cost: number; ms: number } }[] = [];
    const winner = await new Promise<Attempt | null>((resolve) => {
      let left = mine.length;
      for (const a of mine)
        a.done.then((r) => {
          if (r) finished.push({ a, r });
          if (r?.verdict === "ok") resolve(a);
          else if (--left === 0) resolve(finished.find((f) => f.r.verdict === "ok-gameplay")?.a ?? finished[0]?.a ?? null);
        });
    });
    for (const a of mine) if (a !== winner) a.ctrl.abort();
    if (!winner) return null;
    await localDeps(winner.dir);
    const r = finished.find((f) => f.a === winner)?.r ?? (await winner.done)!;
    return { slug: winner.slug, dir: winner.dir, verdict: r.verdict, cost: r.cost };
  }
}

// A remote game comes home without node_modules; it shares one local install of the same engine version to play.
let template: Promise<void> | null = null;
async function localDeps(dir: string): Promise<void> {
  if (existsSync(join(dir, "node_modules"))) return;
  const tpl = join(ROOT, "games", "_template");
  template ??= existsSync(join(tpl, "node_modules")) ? Promise.resolve() : (mkdirSync(tpl, { recursive: true }), scaffold(tpl, "_template"));
  await template;
  symlinkSync(join(tpl, "node_modules"), join(dir, "node_modules"));
}
