import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Read-only replay of a game's engine events (games/<slug>/events.jsonl), so a refresh or a permalink restores the
// Studio even when the engine no longer holds the session. Games built before events were persisted get their
// events rebuilt from build.json and verify.json. A finished game always gets a fresh play URL from the engine.
const GAMES = join(process.cwd(), "..", "games");
const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:5171";

type Ev = { stage: string; message: string; data?: unknown; t?: number };

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8").catch(() => "null")) as Record<string, unknown> | null;

async function rebuild(dir: string): Promise<Ev[] | null> {
  const build = await readJson(join(dir, "build.json"));
  if (!build?.concept) return null;
  const verify = await readJson(join(dir, "verify.json"));
  const files = await readdir(join(dir, "assets")).catch(() => [] as string[]);
  const drawings = files.filter((f) => f.endsWith(".png") && !f.includes(".source") && f !== "photo.png").map((f) => f.replace(/\.png$/, ""));
  const t = Date.now();
  const qa = build.qa as { ok?: boolean } | undefined;
  return [
    { stage: "art", message: `${drawings.length} drawings cut out`, data: { drawings }, t },
    { stage: "concepts", message: "Pick your game", data: { concepts: [build.concept] }, t },
    { stage: "build", message: "Building", data: { concept: build.concept }, t },
    ...(verify ? [{ stage: "check", message: `Playtester: ${verify.verdict}`, data: verify, t }] : []),
    ...(qa ? [{ stage: "check", message: qa.ok ? "Visual QA: ok" : "Visual QA: issues", data: qa, t }] : []),
    { stage: "done", message: "Done", data: { verdict: build.verdict, cost: build.cost_usd, ms: build.ms }, t },
  ];
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!/^[\w-]+$/.test(slug)) return Response.json({ error: "bad slug" }, { status: 400 });
  const dir = join(GAMES, slug);
  const text = await readFile(join(dir, "events.jsonl"), "utf8").catch(() => null);
  let events: Ev[] | null =
    text === null
      ? null
      : (text
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l) as Ev;
            } catch {
              return null;
            }
          })
          .filter(Boolean) as Ev[]);
  if (!events?.some((e) => e.stage === "done")) events = (await rebuild(dir)) ?? events;
  if (!events) return Response.json({ error: "unknown game" }, { status: 404 });

  // The play server recorded in the events may be gone: ask the engine for a live one (it resolves a raced build
  // to the winning sandbox's folder).
  if (events.some((e) => e.stage === "done")) {
    const open = await fetch(`${ENGINE}/api/open`, { method: "POST", body: JSON.stringify({ slug }) })
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string }>) : null))
      .catch(() => null);
    if (open?.url) events = [...events.filter((e) => e.stage !== "play"), { stage: "play", message: "Play", data: { url: open.url }, t: Date.now() }];
  }
  return Response.json(events);
}
