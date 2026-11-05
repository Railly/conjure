// Conjure Studio: one page from a drawing (or an idea) to a game you play and change.
// Drop a photo or type an idea -> your drawings, cut out -> three concepts in different genres -> watch it being
// built -> play it, and keep changing it while you play.
//   bun --env-file=.env studio/server.ts [--port 5170]
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGame, cutPhoto, scaffold } from "./build";
import { type Concept, proposeConcepts } from "./concepts";
import { Race, remoteReady } from "./race";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 5170;

interface Session {
  slug: string;
  dir: string;
  idea: string;
  drawings: string[];
  concepts: Concept[];
  ready: Promise<void>;
  events: { stage: string; message: string; data?: unknown; t: number }[];
  listeners: Set<ReadableStreamDefaultController>;
  playPort?: number;
  race?: Race;
}
const sessions = new Map<string, Session>();
let nextPlayPort = 5190;
// Built games opened from the gallery: slug -> play server port.
const opened = new Map<string, number>();
// A raced build plays from the winning sandbox's folder (<slug>-cX-Y): the playtester that passed names it.
async function playSlugOf(slug: string): Promise<string> {
  if (!/^[\w-]+$/.test(slug) || (await Bun.file(join(ROOT, "games", slug, "sim.ts")).exists())) return slug;
  const events = await Bun.file(join(ROOT, "games", slug, "events.jsonl")).text().catch(() => "");
  const passed = [...events.matchAll(/"slug":"([\w-]+)","verdict":"ok"/g)].map((m) => m[1]!).filter((s) => s.startsWith(`${slug}-`));
  for (const s of passed) if (await Bun.file(join(ROOT, "games", s, "sim.ts")).exists()) return s;
  return slug;
}
// Social cards for a published game: title and genre from the build concept, the image from the showcase site.
function shareableHtml(html: string, slug: string, gameSlug: string): string {
  const events = [slug, gameSlug].map((d) => { try { return readFileSync(join(ROOT, "games", d, "events.jsonl"), "utf8"); } catch { return ""; } }).join("\n");
  const concept = [...events.matchAll(/"stage":"build".*?"concept":(\{.*?\})\}/g)].map((m) => { try { return JSON.parse(m[1]!) as { title?: string; genre?: string; pitch?: string }; } catch { return null; } }).filter(Boolean).at(-1);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const title = esc(concept?.title ?? slug);
  const genre = concept?.genre ? ` A ${esc(concept.genre)}` : " A game";
  const description = `${genre} built by agents from a kid's drawing. Made with Conjure.`;
  const site = "https://conjure.crafter.run";
  const image = `${site}/og/${encodeURIComponent(slug)}`;
  const head = [
    `<title>${title} · conjure</title>`,
    `<meta name="description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="conjure">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<link rel="icon" href="${site}/icon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${site}/apple-icon.png">`,
    `<meta name="theme-color" content="#0A0A0B">`,
  ].join("");
  return html.replace(/<title>[^<]*<\/title>/, "").replace("</head>", `${head}</head>`);
}

async function openGame(requested: string): Promise<string | null> {
  const slug = await playSlugOf(requested);
  if (!/^[\w-]+$/.test(slug) || !(await Bun.file(join(ROOT, "games", slug, "sim.ts")).exists())) return null;
  const known = opened.get(slug);
  if (known && (await fetch(`http://localhost:${known}/`).then((r) => r.ok, () => false))) return `http://localhost:${known}/`;
  let candidate = nextPlayPort++;
  while (await fetch(`http://localhost:${candidate}/`).then(() => true, () => false)) candidate = nextPlayPort++;
  Bun.spawn(["bun", join(ROOT, "make/play.ts"), slug, "--port", String(candidate)], { cwd: ROOT, env: process.env, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://localhost:${candidate}/`).then((r) => r.ok, () => false)) break;
    await Bun.sleep(500);
  }
  opened.set(slug, candidate);
  return `http://localhost:${candidate}/`;
}

const emit = (s: Session, e: { stage: string; message: string; data?: unknown }) => {
  const ev = { ...e, t: Date.now() };
  s.events.push(ev);
  // Every event also lands on disk, so a session can be replayed and measured later.
  appendFileSync(join(s.dir, "events.jsonl"), `${JSON.stringify(ev)}\n`);
  for (const c of s.listeners) c.enqueue(`data: ${JSON.stringify(ev)}\n\n`);
};

const newSession = (idea: string): Session => {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  const base = (idea || "drawing").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "juego";
  const slug = `${base}-${stamp}`;
  const dir = join(ROOT, "games", slug);
  mkdirSync(dir, { recursive: true });
  const s: Session = { slug, dir, idea, drawings: [], concepts: [], ready: Promise.resolve(), events: [], listeners: new Set() };
  sessions.set(slug, s);
  return s;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// The Next.js Studio (web/) calls this engine from another origin in development.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

Bun.serve({
  port,
  idleTimeout: 0,
  fetch: async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const res = await route(req);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  },
});

async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/") return new Response(Bun.file(join(ROOT, "studio/ui.html")));

    // Start: a photo (multipart "photo") and/or an idea. Cuts the drawings, then proposes concepts.
    if (path === "/api/start" && req.method === "POST") {
      const form = await req.formData();
      const idea = String(form.get("idea") ?? "").slice(0, 400);
      const photo = form.get("photo");
      const s = newSession(idea);
      const installing = scaffold(s.dir, s.slug);
      (async () => {
        try {
          if (photo instanceof File && photo.size > 0) {
            const file = join(s.dir, `photo-input${photo.name.match(/\.\w+$/)?.[0] ?? ".jpg"}`);
            writeFileSync(file, new Uint8Array(await photo.arrayBuffer()));
            emit(s, { stage: "art", message: "Finding your drawings" });
            await installing;
            s.drawings = await cutPhoto(s.dir, file);
            emit(s, { stage: "art", message: `${s.drawings.length} drawings cut out`, data: { drawings: s.drawings } });
          } else await installing;
          emit(s, { stage: "concepts", message: "Muse Wonder is imagining three games" });
          const r = await proposeConcepts({ idea, drawings: s.drawings.map((n) => ({ name: n, png: join(s.dir, "assets", `${n}.png`) })) });
          s.concepts = r.concepts;
          writeFileSync(join(s.dir, "concepts.json"), JSON.stringify(r, null, 2));
          emit(s, { stage: "concepts", message: "Pick your game", data: { concepts: r.concepts, ms: r.ms } });
          // With sandboxes, every concept starts building while the player reads them.
          if (remoteReady()) {
            s.race = new Race(s, (e) => emit(s, e));
            s.race.prebuild();
          }
        } catch (e) {
          emit(s, { stage: "error", message: String(e).slice(0, 300) });
        }
      })();
      return json({ slug: s.slug });
    }

    if (path === "/api/build" && req.method === "POST") {
      const { slug, index } = (await req.json()) as { slug: string; index: number };
      const s = sessions.get(slug);
      const concept = s?.concepts[index];
      if (!s || !concept) return json({ error: "unknown session or concept" }, 404);
      emit(s, { stage: "build", message: `Building "${concept.title}"`, data: { concept } });
      (async () => {
        try {
          let playSlug = s.slug;
          if (s.race) {
            const won = await s.race.choose(index);
            if (!won) throw new Error("no build finished");
            playSlug = won.slug;
            emit(s, { stage: "done", message: `Won by ${won.slug.split("-").pop()}: ${won.verdict}`, data: { verdict: won.verdict, cost: won.cost, ms: Date.now() - (s.events.find((x) => x.stage === "build")?.t ?? Date.now()) } });
          } else await buildGame({ dir: s.dir, slug: s.slug, concept, drawings: s.drawings, emit: (e) => emit(s, e) });
          // Several Studio servers can run at once: take the next port nothing listens on.
          let candidate = nextPlayPort++;
          while (await fetch(`http://localhost:${candidate}/`).then(() => true, () => false)) candidate = nextPlayPort++;
          s.playPort = candidate;
          Bun.spawn(["bun", join(ROOT, "make/play.ts"), playSlug, "--port", String(s.playPort)], { cwd: ROOT, env: process.env, stdout: "ignore", stderr: "ignore" });
          for (let i = 0; i < 60; i++) {
            if (await fetch(`http://localhost:${s.playPort}/`).then((r) => r.ok, () => false)) break;
            await Bun.sleep(500);
          }
          emit(s, { stage: "play", message: "Play", data: { url: `http://localhost:${s.playPort}/` } });
        } catch (e) {
          emit(s, { stage: "error", message: String(e).slice(0, 300) });
        }
      })();
      return json({ ok: true });
    }

    // Open an already built game: start (or reuse) its play server and return the URL.
    if (path === "/api/open" && req.method === "POST") {
      const { slug } = (await req.json()) as { slug?: string };
      const url = slug ? await openGame(slug) : null;
      return url ? json({ url }) : json({ error: "unknown game" }, 404);
    }

    // Publish a game as a static site on Vercel (crafter-station) so anyone can play it from a link.
    if (path === "/api/publish" && req.method === "POST") {
      const { slug } = (await req.json()) as { slug?: string };
      const gameSlug = slug ? await playSlugOf(slug) : null;
      const base = gameSlug ? await openGame(gameSlug) : null;
      if (!base || !gameSlug) return json({ error: "unknown game" }, 404);
      const name = `conjure-${(slug ?? "game").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(-40)}`;
      const out = join("/tmp/conjure-publish", name);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(join(out, "assets"), { recursive: true });
      for (const f of ["", "main.js", "sim.js"]) {
        const r = await fetch(base + f);
        if (!r.ok) return json({ error: `could not read ${f || "index"}` }, 500);
        const text = await r.text();
        // A published copy is play-only: ?embed=1 hides the live-edit bar, which needs the local play server.
        writeFileSync(join(out, f || "index.html"), f ? text : shareableHtml(text.replace("<script", `<script>history.replaceState(null,"","?embed=1")</script><script`), slug ?? gameSlug, gameSlug));
      }
      cpSync(join(ROOT, "games", gameSlug, "assets"), join(out, "assets"), { recursive: true, filter: (p) => !p.includes(".source") });
      // One retry: the upload sometimes ends in a transient "fetch failed". The stable alias is printed on stderr.
      let err = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const deploy = Bun.spawnSync(["vercel", "deploy", out, "--prod", "--yes", "--scope", "crafter-station"], { cwd: out, env: process.env });
        const logs = deploy.stderr.toString();
        const alias = logs.match(/Aliased\s+(https:\/\/\S+\.vercel\.app)/)?.[1];
        const live = alias ?? deploy.stdout.toString().match(/https:\/\/\S+\.vercel\.app/)?.[0];
        if (deploy.exitCode === 0 && live) return json({ url: live });
        err = logs.slice(-400);
      }
      return json({ error: err }, 500);
    }

    // Live events for one session, replaying what already happened.
    if (path === "/api/events") {
      const s = sessions.get(url.searchParams.get("slug") ?? "");
      if (!s) return json({ error: "unknown session" }, 404);
      let controller: ReadableStreamDefaultController | null = null;
      return new Response(
        new ReadableStream({
          start: (c) => {
            controller = c;
            for (const e of s.events) c.enqueue(`data: ${JSON.stringify(e)}\n\n`);
            s.listeners.add(c);
          },
          cancel: () => {
            if (controller) s.listeners.delete(controller);
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
      );
    }

    // A session's assets (drawings, captures) for the page.
    const asset = path.match(/^\/games\/([\w-]+)\/((?:assets\/)?[\w.-]+\.png)$/);
    if (asset) {
      const s = sessions.get(asset[1]!);
      if (s) {
        const file = Bun.file(join(s.dir, asset[2]!));
        if (await file.exists()) return new Response(file);
      }
    }
    return new Response("not found", { status: 404 });
}
console.log(`Conjure Studio: http://localhost:${port}/`);
