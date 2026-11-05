import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Read-only list of built or shaped sessions in games/, newest first, for the switcher and the home "Recientes" row.
const GAMES = join(process.cwd(), "..", "games");

export interface GameCard {
  slug: string;
  title: string;
  genre: string;
  verdict: string | null;
  mtime: number;
  photo: boolean;
  cover: string | null;
  /** Best available screenshot of the built game (shot-play > qa-600 > shot-title), or null. */
  shot: string | null;
}

interface Concept {
  title?: string;
  genre?: string;
}

const json = async <T,>(p: string): Promise<T | null> =>
  readFile(p, "utf8")
    .then((t) => JSON.parse(t) as T)
    .catch(() => null);

async function card(slug: string): Promise<GameCard | null> {
  const dir = join(GAMES, slug);
  const [build, concepts, events] = await Promise.all([
    json<{ concept?: Concept; verdict?: string }>(join(dir, "build.json")),
    json<{ concepts?: Concept[] }>(join(dir, "concepts.json")),
    readFile(join(dir, "events.jsonl"), "utf8").catch(() => ""),
  ]);
  if (!build && !concepts) return null;
  // The chosen concept lives in the build event; fall back to build.json, then the first idea.
  let chosen: Concept | undefined;
  let verdict: string | null = build?.verdict ?? null;
  for (const line of events.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as { stage?: string; data?: { concept?: Concept; verdict?: string } };
      if (e.stage === "build" && e.data?.concept) chosen = e.data.concept;
      if (e.stage === "done" && e.data?.verdict) verdict = e.data.verdict;
    } catch {}
  }
  const c = chosen ?? build?.concept ?? concepts?.concepts?.[0];
  if (!c?.title || c.title.trim().length < 3) return null;
  const exists = (p: string) => stat(p).then(() => true, () => false);
  const [photo, assets, st, shots] = await Promise.all([
    exists(join(dir, "photo-input.png")),
    readdir(join(dir, "assets")).catch(() => [] as string[]),
    stat(dir),
    Promise.all(["shot-play", "qa-600", "shot-title"].map((n) => exists(join(dir, `${n}.png`)))),
  ]);
  const shot = ["shot-play", "qa-600", "shot-title"][shots.indexOf(true)] ?? null;
  const cover = assets.find((f) => f.endsWith(".png") && !/^photo|\.source\.png$/.test(f))?.replace(/\.png$/, "") ?? null;
  return { slug, title: c.title, genre: c.genre ?? "", verdict, mtime: st.mtimeMs, photo, cover, shot };
}

export async function GET() {
  const names = await readdir(GAMES).catch(() => [] as string[]);
  const slugs = names.filter((n) => /^[\w-]+$/.test(n) && !n.startsWith("_") && !/-c\d+-\d+$/.test(n));
  const cards = (await Promise.all(slugs.map(card))).filter((c): c is GameCard => c !== null);
  cards.sort((a, b) => b.mtime - a.mtime);
  // Reruns of the same concept (benchmarks, remote builds) collapse into the newest one.
  const seen = new Set<string>();
  const unique = cards.filter((c) => (seen.has(c.title) ? false : (seen.add(c.title), true)));
  return Response.json(unique, { headers: { "cache-control": "no-store" } });
}
