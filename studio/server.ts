// Conjure Studio: one page from a drawing (or an idea) to a game you play and change.
// Drop a photo or type an idea -> your drawings, cut out -> three concepts in different genres -> watch it being
// built -> play it, and keep changing it while you play.
//   bun --env-file=.env studio/server.ts [--port 5170]
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGame, cutPhoto, scaffold } from "./build";
import { type Concept, proposeConcepts } from "./concepts";

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
}
const sessions = new Map<string, Session>();
let nextPlayPort = 5190;

const emit = (s: Session, e: { stage: string; message: string; data?: unknown }) => {
  const ev = { ...e, t: Date.now() };
  s.events.push(ev);
  // Every event also lands on disk, so a session can be replayed and measured later.
  appendFileSync(join(s.dir, "events.jsonl"), `${JSON.stringify(ev)}\n`);
  for (const c of s.listeners) c.enqueue(`data: ${JSON.stringify(ev)}\n\n`);
};

const newSession = (idea: string): Session => {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  const base = (idea || "dibujo").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "juego";
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
            emit(s, { stage: "art", message: "Encontrando tus dibujos" });
            await installing;
            s.drawings = await cutPhoto(s.dir, file);
            emit(s, { stage: "art", message: `${s.drawings.length} dibujos recortados`, data: { drawings: s.drawings } });
          } else await installing;
          emit(s, { stage: "concepts", message: "Muse Wonder esta imaginando tres juegos" });
          const r = await proposeConcepts({ idea, drawings: s.drawings.map((n) => ({ name: n, png: join(s.dir, "assets", `${n}.png`) })) });
          s.concepts = r.concepts;
          writeFileSync(join(s.dir, "concepts.json"), JSON.stringify(r, null, 2));
          emit(s, { stage: "concepts", message: "Elige tu juego", data: { concepts: r.concepts, ms: r.ms } });
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
      emit(s, { stage: "build", message: `Construyendo "${concept.title}"`, data: { concept } });
      (async () => {
        try {
          await buildGame({ dir: s.dir, slug: s.slug, concept, drawings: s.drawings, emit: (e) => emit(s, e) });
          // Several Studio servers can run at once: take the next port nothing listens on.
          let candidate = nextPlayPort++;
          while (await fetch(`http://localhost:${candidate}/`).then(() => true, () => false)) candidate = nextPlayPort++;
          s.playPort = candidate;
          Bun.spawn(["bun", join(ROOT, "make/play.ts"), s.slug, "--port", String(s.playPort)], { cwd: ROOT, env: process.env, stdout: "ignore", stderr: "ignore" });
          for (let i = 0; i < 60; i++) {
            if (await fetch(`http://localhost:${s.playPort}/`).then((r) => r.ok, () => false)) break;
            await Bun.sleep(500);
          }
          emit(s, { stage: "play", message: "A jugar", data: { url: `http://localhost:${s.playPort}/` } });
        } catch (e) {
          emit(s, { stage: "error", message: String(e).slice(0, 300) });
        }
      })();
      return json({ ok: true });
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
