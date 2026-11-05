"use client";

import { ArrowUp, Car, Cat, Check, ChevronDown, ExternalLink, Globe, ImagePlus, Link2, Loader2, Maximize2, Plus, RotateCcw, Snowflake, Undo2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Models, VercelMark } from "./logos";
import { HackathonBadge, HowItWorks, Tour, useTour } from "./onboarding";
import { ThemeToggle } from "./theme-toggle";

// The Bun engine (studio/server.ts) does the work; this page only talks to it.
const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:5170";

interface Concept {
  title: string;
  genre: string;
  pitch: string;
  core_mechanic: string;
  controls: string;
}
interface EngineEvent {
  stage: string;
  message: string;
  t: number;
  data?: {
    drawings?: string[];
    concepts?: Concept[];
    url?: string;
    verdict?: string;
    cost?: number;
    ms?: number;
    attempt?: number;
    search?: { outcome: string; frames: number };
    too_easy_by?: string[];
    policies?: Record<string, unknown>;
    ok?: boolean;
    issues?: string[];
    play?: Playtest;
    concept?: Concept;
    qa?: { ok: boolean; issues: string[] };
  };
}
interface Playtest {
  verdict?: string;
  search?: { outcome: string; frames: number };
  too_easy_by?: string[];
  policies?: Record<string, unknown>;
}
interface GameCard {
  slug: string;
  title: string;
  genre: string;
  verdict: string | null;
  mtime: number;
  photo: boolean;
  cover: string | null;
  shot: string | null;
}
type Phase = "idle" | "cutting" | "choosing" | "building" | "playing";

const GENRE_LABEL: Record<string, string> = {
  "physics puzzle": "Puzzle de física",
  racing: "Carreras",
  "rhythm or timing": "Ritmo",
  "endless runner": "Runner",
  "shoot 'em up": "Shoot 'em up",
  "sokoban-like grid puzzle": "Puzzle de grilla",
  "tower or base defense": "Defensa",
  stealth: "Sigilo",
  "breakout-like": "Breakout",
  sports: "Deportes",
  survival: "Supervivencia",
  "3d explorer or 3d arena": "Aventura 3D",
  "3d explorer": "Aventura 3D",
  "3d arena": "Arena 3D",
  platformer: "Plataformas",
  puzzle: "Puzzle",
  "top-down adventure": "Aventura",
};
const genreLabel = (g: string) => GENRE_LABEL[g.toLowerCase()] ?? (/3d/i.test(g) ? "Juego 3D" : g.split(/ or |,/)[0]!.trim().replace(/^./, (c) => c.toUpperCase()));

const SUGGESTIONS = [
  { text: "Un pingüino que empuja hielo", Icon: Snowflake },
  { text: "Un gato que junta soles", Icon: Cat },
  { text: "Carrera de autos de cartón", Icon: Car },
];
const thumbOf = (g: GameCard) => (g.photo ? `/api/asset?slug=${g.slug}&n=photo-input` : g.cover ? `/api/asset?slug=${g.slug}&n=${encodeURIComponent(g.cover)}` : null);

function useGames() {
  const [games, setGames] = useState<GameCard[]>([]);
  useEffect(() => {
    fetch("/api/games")
      .then((r) => (r.ok ? (r.json() as Promise<GameCard[]>) : []))
      .then(setGames)
      .catch(() => {});
  }, []);
  return games;
}

export function Studio() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<string[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [chosen, setChosen] = useState(-1);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [result, setResult] = useState<EngineEvent["data"] | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const games = useGames();
  const tour = useTour(phase === "idle");
  // The home gallery only shows games with a real screenshot; /api/games already dedupes by title.
  const gallery = games.filter((g) => g.shot).slice(0, 6);

  const pick = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  };

  // Dev only: ?demo=cutting|choosing|building|playing seeds a recorded session so the build views can be designed and
  // filmed without spending a run. Never active in production builds.
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const mode = new URLSearchParams(location.search).get("demo");
    if (!mode) return;
    if (mode === "cutting") {
      setDemo(true);
      setSlug("demo");
      setPreview(new URLSearchParams(location.search).get("photo"));
      setEvents([{ stage: "art", message: "Encontrando tus dibujos", t: 1_000 }]);
      setPhase("cutting");
      return;
    }
    const d = demoSession(mode);
    setDemo(true);
    setSlug(d.slug);
    setDrawings(d.drawings);
    setConcepts(d.concepts);
    setEvents(d.events);
    setChosen(mode === "choosing" ? -1 : 0);
    if (d.playUrl) setPlayUrl(d.playUrl);
    if (d.result) setResult(d.result);
    setPhase(mode === "choosing" ? "choosing" : mode === "playing" ? "playing" : "building");
  }, []);

  // The session lives in the URL (?game=<slug>): a refresh, Fast Refresh or a shared link replays it instead of
  // dropping back to the hero.
  useEffect(() => {
    const g = new URLSearchParams(location.search).get("game");
    if (g && /^[\w-]+$/.test(g)) {
      setPhase("cutting");
      setSlug(g);
    }
  }, []);
  useEffect(() => {
    if (!slug || demo) return;
    const url = new URL(location.href);
    if (url.searchParams.get("game") !== slug) {
      url.searchParams.set("game", slug);
      history.replaceState(null, "", url);
    }
  }, [slug, demo]);

  useEffect(() => {
    if (!slug || demo) return;
    const seen = new Set<string>();
    const titles: string[] = [];
    const apply = (e: EngineEvent) => {
      const key = `${e.t}-${e.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      setEvents((prev) => [...prev, e]);
      if (e.data?.drawings) setDrawings(e.data.drawings);
      if (e.data?.concepts) {
        titles.splice(0, titles.length, ...e.data.concepts.map((c) => c.title));
        setConcepts(e.data.concepts);
        setPhase((p) => (p === "cutting" ? "choosing" : p));
      }
      if (e.stage === "build" && e.data?.concept) {
        const i = titles.indexOf(e.data.concept.title);
        if (i >= 0) setChosen(i);
        setPhase((p) => (p === "playing" ? p : "building"));
      }
      if (e.stage === "done" && e.data) setResult(e.data);
      if (e.stage === "play" && e.data?.url) {
        setPlayUrl(e.data.url);
        setPhase("playing");
      }
    };
    let live = false;
    const es = new EventSource(`${ENGINE}/api/events?slug=${slug}`);
    es.onopen = () => {
      live = true;
    };
    es.onmessage = (m) => apply(JSON.parse(m.data) as EngineEvent);
    // The engine forgot the session (restart): replay what it wrote to disk.
    es.onerror = () => {
      if (live) return;
      es.close();
      fetch(`/api/replay?slug=${slug}`)
        .then((r) => (r.ok ? (r.json() as Promise<EngineEvent[]>) : []))
        .then((list) => {
          for (const e of list) apply(e);
        })
        .catch(() => {});
    };
    return () => es.close();
  }, [slug, demo]);

  const start = async () => {
    if (!photo && !idea.trim()) return;
    setPhase("cutting");
    const fd = new FormData();
    if (photo) fd.append("photo", photo);
    fd.append("idea", idea.trim());
    const r = await fetch(`${ENGINE}/api/start`, { method: "POST", body: fd });
    setSlug(((await r.json()) as { slug: string }).slug);
  };
  const build = async () => {
    if (chosen < 0 || !slug) return;
    setPhase("building");
    await fetch(`${ENGINE}/api/build`, { method: "POST", body: JSON.stringify({ slug, index: chosen }) });
  };

  const asset = (n: string) => (demo ? `/gallery/${n}.png` : `/api/asset?slug=${slug}&n=${encodeURIComponent(n)}`);
  const t0 = events[0]?.t ?? 0;
  const last = events.at(-1);
  const concept = chosen >= 0 ? (concepts[chosen] ?? null) : null;
  const title = concept?.title ?? (phase === "idle" ? "" : "Nuevo juego");

  // The preview toolbar.
  const [frameKey, setFrameKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // Publishing: one explicit click, never automatic. The engine answers { url } after 20-60 s.
  const [pub, setPub] = useState<{ state: "idle" | "busy" | "done" | "error"; url?: string }>({ state: "idle" });
  const [pubCopied, setPubCopied] = useState(false);
  const publish = async () => {
    if (!slug || pub.state === "busy") return;
    setPub({ state: "busy" });
    try {
      const r = await fetch(`${ENGINE}/api/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
      if (!r.ok) throw new Error(String(r.status));
      const { url } = (await r.json()) as { url: string };
      setPub({ state: "done", url });
    } catch {
      setPub({ state: "error" });
    }
  };
  const copyLink = () => {
    navigator.clipboard?.writeText(pub.url ?? location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className={phase === "idle" ? "flex min-h-dvh flex-col" : "flex h-dvh flex-col overflow-hidden"}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <a href="/" className="flex items-center gap-2 rounded-md px-1" aria-label="conjure">
            <Logo />
          </a>
          <HackathonBadge />
          {phase !== "idle" && (
            <>
              <span className="text-[18px] font-light text-line-2 select-none" aria-hidden="true">
                /
              </span>
              <GameSwitcher title={title} games={games} current={slug} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase !== "idle" && (
            <a href="/" className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-md pr-3 pl-2.5 text-[13px] font-medium">
              <Plus className="size-4" strokeWidth={2.25} />
              Nuevo
            </a>
          )}
          <HowItWorks onTour={phase === "idle" ? tour.start : undefined} />
          <ThemeToggle />
        </div>
      </header>
      {phase === "idle" && <Tour open={tour.open} onClose={tour.stop} />}

      <AnimatePresence mode="wait">
        {phase === "idle" ? (
          <motion.main key="hero" exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex flex-1 flex-col items-center px-6 pb-20">
            <section className="flex w-full flex-col items-center pt-[10vh]">
              <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="text-center text-[clamp(36px,3.3vw,48px)] font-semibold leading-[1.05] tracking-[-0.035em] text-balance">
                ¿Qué quieres jugar?
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05, duration: 0.3 }} className="mt-3 text-center text-[14px] text-ink-2 text-balance">
                Para chicos que dibujan. Cambia el juego hablando, cada cambio se verifica.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.3 }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files[0]);
                }}
                data-tour="composer"
                className={`mt-8 flex w-full max-w-[720px] flex-col rounded-2xl border bg-surface p-3 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_-12px_rgba(0,0,0,.12)] transition-colors focus-within:border-ink-3 ${dragging ? "border-accent bg-accent-soft" : "border-line-2"}`}
              >
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      start();
                    }
                  }}
                  rows={3}
                  placeholder={preview ? "Opcional: cómo te lo imaginas" : "Sube tu dibujo o describe un juego…"}
                  aria-label="Describe tu juego"
                  className="min-h-[76px] w-full resize-none bg-transparent px-2 pt-1.5 text-[15px] leading-snug text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
                />
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-lg border border-line px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
                      aria-label="Subir la foto de tu dibujo"
                      title="Subir la foto de tu dibujo"
                    >
                      {preview ? (
                        // biome-ignore lint/performance/noImgElement: local object URL preview
                        <img src={preview} alt="Tu dibujo" className="size-5 rounded-sm object-cover" />
                      ) : (
                        <ImagePlus className="size-4" strokeWidth={1.75} />
                      )}
                      Foto
                    </button>
                    <span className="inline-flex h-8 items-center rounded-lg px-2 font-mono text-[11px] text-ink-3">
                      <Models text="Muse Wonder · dotframe" />
                    </span>
                  </div>
                  <button type="button" onClick={start} disabled={!photo && !idea.trim()} className="btn-primary inline-flex size-8 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-40" aria-label="Conjurar">
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  </button>
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {SUGGESTIONS.map(({ text, Icon }) => (
                  <button key={text} type="button" onClick={() => setIdea(text)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink">
                    <Icon className="size-3.5 text-ink-3" strokeWidth={1.75} />
                    {text}
                  </button>
                ))}
              </motion.div>
            </section>

            {gallery.length > 0 && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-14 w-full max-w-[1100px]">
                <h2 data-tour="gallery" className="mb-4 inline-block text-[15px] font-medium tracking-[-0.01em]">Hechos con Conjure</h2>
                <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                  {gallery.map((g) => (
                    <a key={g.slug} href={`/?game=${g.slug}`} className="group block">
                      <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-stage transition-colors group-hover:border-line-2">
                        {/* biome-ignore lint/performance/noImgElement: engine-served screenshot */}
                        <img src={`/api/asset?slug=${g.slug}&n=${g.shot}`} alt="" className="size-full object-cover" loading="lazy" />
                      </div>
                      <div className="mt-3 flex items-center gap-2.5">
                        <GameThumb game={g} className="size-7 shrink-0 rounded-full border border-line bg-surface object-cover" />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium tracking-[-0.01em]">{g.title}</p>
                          <p className="truncate font-mono text-[10.5px] text-ink-3">{genreLabel(g.genre || "juego")}</p>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </motion.section>
            )}
          </motion.main>
        ) : (
          <motion.main key="studio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_1fr]">
            <Thread
              phase={phase}
              preview={preview ?? (slug && !demo && drawings.length > 0 ? asset("photo") : null)}
              idea={idea}
              drawings={drawings}
              asset={asset}
              concepts={concepts}
              chosen={chosen}
              setChosen={setChosen}
              build={build}
              concept={concept}
              events={events}
              t0={t0}
              result={result}
              playUrl={playUrl}
            />

            <section className="flex min-h-0 flex-col">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`size-2 shrink-0 rounded-full ${phase === "playing" ? "bg-leaf" : "bg-accent animate-pulse"}`} />
                  <span className="truncate text-[13px] font-medium tracking-[-0.01em]">{title}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{phase === "playing" ? "Jugando" : phase === "choosing" ? "Eligiendo" : "Construyendo"}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ToolButton label="Reiniciar" onClick={() => setFrameKey((k) => k + 1)} disabled={!playUrl}>
                    <RotateCcw className="size-[15px]" strokeWidth={1.75} />
                  </ToolButton>
                  <ToolButton label="Pantalla completa" onClick={() => stageRef.current?.requestFullscreen?.()} disabled={!playUrl}>
                    <Maximize2 className="size-[15px]" strokeWidth={1.75} />
                  </ToolButton>
                  <button type="button" onClick={copyLink} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink">
                    {copied ? <Check className="size-3.5 text-leaf" strokeWidth={2.5} /> : <Link2 className="size-3.5" strokeWidth={1.75} />}
                    {copied ? "Copiado" : "Copiar link"}
                  </button>
                  {pub.state === "done" && pub.url ? (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/40 pl-2 pr-1 text-[12px]">
                      <Globe className="size-3.5 text-accent" strokeWidth={1.75} />
                      <span className="text-ink-2">Publicado</span>
                      <span className="max-w-[180px] truncate font-mono text-[11px] text-ink-3">{pub.url.replace(/^https?:\/\//, "")}</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard?.writeText(pub.url!).then(() => {
                            setPubCopied(true);
                            setTimeout(() => setPubCopied(false), 1600);
                          })
                        }
                        className="rounded px-1.5 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-paper hover:text-ink"
                      >
                        {pubCopied ? "Copiado" : "Copiar"}
                      </button>
                      <a href={pub.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-paper hover:text-ink">
                        Abrir
                        <ExternalLink className="size-3" strokeWidth={1.75} />
                      </a>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {pub.state === "error" && <span className="font-mono text-[10.5px] text-rose">No se pudo publicar</span>}
                      <button
                        type="button"
                        onClick={publish}
                        disabled={!playUrl || !slug || pub.state === "busy"}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent/50 px-2 text-[12px] text-accent transition-colors hover:border-accent hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-50"
                      >
                        {pub.state === "busy" ? <Loader2 className="size-3.5 animate-spin" strokeWidth={2} /> : <Globe className="size-3.5" strokeWidth={1.75} />}
                        {pub.state === "busy" ? "Publicando…" : pub.state === "error" ? "Reintentar" : "Publicar"}
                      </button>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-stage/60 p-4">
                <div ref={stageRef} className="relative w-full overflow-hidden rounded-lg border border-line bg-stage shadow-[0_1px_2px_rgba(0,0,0,.04)]" style={{ aspectRatio: "16 / 9", width: "min(100%, calc((100dvh - 96px) * 16 / 9))" }}>
                  {playUrl ? (
                    <iframe key={frameKey} src={`${playUrl}?embed=1`} title="Tu juego" className="absolute inset-0 size-full" allow="autoplay; fullscreen" />
                  ) : (
                    <Stage
                      drawings={drawings}
                      asset={asset}
                      preview={preview ?? (slug && !demo ? asset("photo") : null)}
                      status={phase === "choosing" ? (chosen < 0 ? "Elige un juego" : "Listo para construir") : phase === "cutting" && drawings.length === 0 ? "Buscando tus dibujos" : humanize(last?.message ?? "")}
                      waiting={phase === "choosing"}
                      lanes={phase === "building" ? lanesOf(events) : []}
                      pick={phase === "choosing" && chosen >= 0 ? (concepts[chosen] ?? null) : null}
                    />
                  )}
                </div>
              </div>
            </section>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid size-7 place-items-center rounded-md border border-line text-ink-2 transition-colors hover:border-line-2 hover:text-ink disabled:opacity-40 disabled:pointer-events-none">
      {children}
    </button>
  );
}

function GameThumb({ game, className }: { game: GameCard; className?: string }) {
  const src = thumbOf(game);
  if (!src) return <div className={`grid place-items-center bg-stage font-mono text-[11px] text-ink-3 ${className ?? ""}`}>{game.title.slice(0, 1)}</div>;
  // biome-ignore lint/performance/noImgElement: engine-served thumbnail, no loader
  return <img src={src} alt="" className={className} />;
}

function GameSwitcher({ title, games, current }: { title: string; games: GameCard[]; current: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-8 max-w-[320px] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium tracking-[-0.01em] text-ink transition-colors hover:bg-paper">
        <span className="truncate">{title}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }} className="absolute top-full left-0 z-30 mt-1 w-[320px] overflow-hidden rounded-xl border border-line-2 bg-surface p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,.25)]">
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">Recientes</p>
            <div className="max-h-[360px] overflow-y-auto">
              {games.slice(0, 8).map((g) => (
                <a key={g.slug} href={`/?game=${g.slug}`} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-paper ${g.slug === current ? "bg-paper" : ""}`}>
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-stage">
                    <GameThumb game={g} className="size-full object-contain p-0.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">{g.title}</span>
                    <span className="block truncate font-mono text-[10.5px] text-ink-3">{genreLabel(g.genre || "juego")}</span>
                  </span>
                  {g.slug === current && <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2.5} />}
                </a>
              ))}
              {games.length === 0 && <p className="px-2.5 py-3 text-[12px] text-ink-3">Todavía no hay juegos</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
// Raw agent tool names leak from the engine feed when a step has no friendlier label; give them verbs.
const TOOL_LABEL: Record<string, string> = {
  Bash: "Corriendo el juego",
  Glob: "Buscando archivos",
  Grep: "Buscando en el código",
  TodoWrite: "Planeando",
  MultiEdit: "Editando el juego",
  WebFetch: "Leyendo la documentación",
};
const humanize = (m: string) => {
  const body = m.replace(/^#\d+\s*/, "");
  return TOOL_LABEL[body] ?? body.replace(/^Leyendo assets\/.+\.png$/, "Mirando tu dibujo").replace(/^Escribiendo sim\.ts$/, "Escribiendo el juego");
};

interface Lane {
  k: number;
  first: EngineEvent;
  last: EngineEvent;
  play: Playtest | null;
  qa: { ok: boolean; issues: string[] } | null;
}
function lanesOf(events: EngineEvent[]): Lane[] {
  const map = new Map<number, Lane>();
  for (const e of events) {
    const k = e.data?.attempt;
    if (typeof k !== "number") continue;
    const lane = map.get(k) ?? { k, first: e, last: e, play: null, qa: null };
    lane.last = e;
    lane.play = playtestOf(e) ?? lane.play;
    lane.qa = qaOf(e) ?? lane.qa;
    map.set(k, lane);
  }
  return [...map.values()].sort((a, b) => a.k - b.k);
}
const modelOfLane = (l: Lane) => (/simulando/i.test(l.last.message) ? "código" : l.last.stage === "fix" || (l.last.stage === "check" && l.last.message.includes("QA")) ? "Muse Spark" : /arte|sprite/i.test(l.last.message) ? "Muse Image" : l.last.stage === "check" ? "código" : "Muse Wonder");

// The build as a timeline: one row per stage, the Muse model doing the job, and the measured gate results.
const STAGES = [
  { id: "art", label: "Recorte", hint: "Encuentra cada dibujo en la foto y lo recorta", model: "Muse Spark + SAM 3.1", gate: false },
  { id: "concepts", label: "Ideas", hint: "Tres juegos posibles con tus dibujos", model: "Muse Wonder", gate: false },
  { id: "race", label: "Sandboxes", hint: "Tres construcciones en paralelo. Gana la primera que pasa los chequeos", model: "Muse Wonder + Muse Image", gate: false },
  { id: "playtest", label: "Playtester", hint: "Simula partidas en código. Tiene que ser ganable y no ganarse sin jugar", model: "código", gate: true },
  { id: "qa", label: "QA visual", hint: "Mira dos capturas del juego", model: "Muse Spark · modelo", gate: false },
] as const;

const reachOf = (e: EngineEvent): number => {
  if (e.stage === "art") return 0;
  if (e.stage === "concepts") return 1;
  if (e.stage === "check" && e.message.includes("QA visual")) return 4;
  if (e.stage === "check") return 3;
  if (e.stage === "build" || e.stage === "code" || e.stage === "fix") return 2;
  if (e.stage === "done" || e.stage === "play") return 5;
  return -1;
};

const playtestOf = (e: EngineEvent): Playtest | null => e.data?.play ?? (e.data?.search || e.data?.too_easy_by ? (e.data as Playtest) : null);
const qaOf = (e: EngineEvent): { ok: boolean; issues: string[] } | null => e.data?.qa ?? (typeof e.data?.ok === "boolean" ? { ok: e.data.ok, issues: e.data.issues ?? [] } : null);

function Pipeline({ events, t0, done }: { events: EngineEvent[]; t0: number; done: boolean }) {
  const reached = Math.max(-1, ...events.map(reachOf));
  const hasArt = events.some((e) => e.stage === "art");
  const concepted = events.some((e) => e.data?.concepts);
  const error = [...events].reverse().find((e) => e.stage === "error");
  const play = [...events].reverse().map(playtestOf).find(Boolean) ?? null;
  const qa = [...events].reverse().map(qaOf).find(Boolean) ?? null;
  const lanes = new Set<number>();
  for (const e of events) if (typeof e.data?.attempt === "number") lanes.add(e.data.attempt);
  const elapsed = Math.round(((events.at(-1)?.t ?? t0) - t0) / 1000);

  return (
    <div>
      <ol className="flex flex-col">
        {STAGES.map((st, i) => {
          const skipped = i === 0 && !hasArt && reached > 0;
          const finished = done || (i < reached && i !== 2) || (i === 1 && concepted);
          const active = !finished && !skipped && (i === reached || (i === 2 && (reached >= 2 || concepted)));
          const waiting = active && i === 2 && reached <= 1;
          const gate = st.id === "playtest" && play ? gateOf(play) : st.id === "qa" && qa ? { pass: qa.ok, fact: qa.ok ? "ok" : `${qa.issues.length} issues` } : null;
          const state = skipped ? "skip" : gate && !done ? (gate.pass ? "done" : "fail") : finished ? "done" : active ? "active" : "todo";
          const detail = skipped ? "Sin foto, el arte se pinta" : waiting ? "Esperando tu elección" : st.id === "race" && lanes.size > 0 ? `${lanes.size} en paralelo` : "";
          return (
            <li key={st.id} className="grid h-8 grid-cols-[16px_1fr_auto] items-center gap-x-2.5" title={`${st.hint}${gate ? ` · ${gate.fact}` : ""}`}>
              <Marker state={state} />
              <div className="flex min-w-0 items-baseline gap-2">
                <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${state === "todo" || state === "skip" ? "text-ink-3" : "text-ink"}`}>
                  {st.id === "race" && <VercelMark className="h-[10px] w-auto" />}
                  {st.label}
                </span>
                <span className="truncate font-mono text-[10.5px] text-ink-3">{detail ? detail : <Models text={st.model} />}</span>
              </div>
              <span className="font-mono text-[10.5px] tabular-nums">
                {gate ? <span className={gate.pass ? "text-leaf" : "text-rose"}>{gate.pass ? "PASS" : "FAIL"}{gate.fact && gate.fact !== "ok" ? ` · ${gate.fact}` : ""}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-mono text-[10.5px] text-ink-3">
        <span className={error ? "truncate text-rose" : ""}>{error ? error.message : done ? "Listo" : "En curso"}</span>
        <time className="shrink-0 tabular-nums">{elapsed}s</time>
      </div>
    </div>
  );
}

function gateOf(p: Playtest): { pass: boolean; fact: string } {
  const fact = p.search ? `${p.search.frames} frames` : p.verdict && p.verdict !== "ok" ? p.verdict : "";
  return { pass: p.verdict === "ok", fact };
}

function Marker({ state }: { state: "done" | "active" | "todo" | "skip" | "fail" }) {
  if (state === "fail")
    return (
      <span className="grid size-4 place-items-center rounded-full bg-rose text-white">
        <X className="size-2.5" strokeWidth={3} />
      </span>
    );
  if (state === "done")
    return (
      <span className="grid size-4 place-items-center rounded-full bg-accent text-white">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  if (state === "active") return <Loader2 className="size-4 animate-spin text-accent" strokeWidth={2.25} />;
  return <span className={`size-4 rounded-full border ${state === "skip" ? "border-dashed border-line-2" : "border-line-2"}`} />;
}

const SPOTS = [
  [8, 12],
  [72, 10],
  [10, 52],
  [74, 50],
  [42, 54],
  [43, 6],
];

function Stage({ drawings, asset, preview, status, waiting, lanes, pick }: { drawings: string[]; asset: (n: string) => string; preview: string | null; status: string; waiting: boolean; lanes: Lane[]; pick: Concept | null }) {
  const racing = lanes.length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!racing) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [racing]);
  return (
    <div className="absolute inset-0">
      {drawings.length === 0 && preview && (
        <div className="absolute inset-0 grid place-items-center p-8">
          <div className="relative h-full max-w-full overflow-hidden rounded-md">
            {/* biome-ignore lint/performance/noImgElement: the player's photo */}
            <img src={preview} alt="Tu foto" className="h-full w-auto max-w-full object-contain" />
            <span className="animate-scan pointer-events-none absolute inset-x-0 h-px bg-accent shadow-[0_0_12px_1px_var(--accent)]" aria-hidden="true" />
          </div>
        </div>
      )}
      {drawings.slice(0, 6).map((d, i) => (
        <motion.img
          key={d}
          src={asset(d)}
          alt=""
          initial={{ scale: 0.5, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: ((i % 3) - 1) * 3, opacity: 1, transition: { type: "spring", stiffness: 220, damping: 18, delay: i * 0.1 } }}
          className="absolute w-[14%] drop-shadow-[0_6px_10px_rgba(0,0,0,.22)]"
          style={{ left: `${SPOTS[i]![0]}%`, top: `${SPOTS[i]![1]! * (racing ? 0.5 : 1)}%` }}
        />
      ))}
      {pick && !racing && (
        <motion.div key={pick.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="absolute inset-x-8 top-[40%] text-center">
          <p className="font-mono text-[11px] text-ink-3">{genreLabel(pick.genre)}</p>
          <p className="mx-auto mt-1 max-w-[70%] text-[clamp(20px,2.6vw,36px)] font-semibold leading-tight tracking-[-0.03em] text-ink text-balance">{pick.title}</p>
        </motion.div>
      )}
      {racing ? (
        <div className="absolute inset-x-4 bottom-4 flex flex-col gap-1.5">
          {lanes.map((l) => {
            const won = l.qa?.ok && l.play?.verdict === "ok";
            const failed = l.last.stage === "error";
            const live = !won && !failed;
            const base = l.last.t > 1e12 ? now : l.last.t;
            const secs = Math.max(0, Math.round((base - l.first.t) / 1000));
            return (
              <div key={l.k} className={`grid h-9 grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-md border bg-surface px-3 ${won ? "border-leaf" : "border-line"}`}>
                <span className="font-mono text-[11px] text-ink-3">{String(l.k + 1).padStart(2, "0")}</span>
                <span className={`flex min-w-0 items-center gap-2 text-[12.5px] ${failed ? "text-rose" : "text-ink"}`}>
                  {live && <Loader2 className="size-3 shrink-0 animate-spin text-accent" />}
                  <span className="truncate">{humanize(l.last.message)}</span>
                  <span className="hidden shrink-0 font-mono text-[10.5px] text-ink-3 md:inline">
                    <Models text={modelOfLane(l)} />
                  </span>
                </span>
                <span className="flex gap-1.5 font-mono text-[10.5px]">
                  <LaneBadge label="play" pass={l.play ? l.play.verdict === "ok" : null} />
                  <LaneBadge label="qa" pass={l.qa ? l.qa.ok : null} />
                </span>
                <time className="w-9 text-right font-mono text-[11px] tabular-nums text-ink-3">{secs}s</time>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`absolute inset-x-0 flex justify-center px-4 ${drawings.length === 0 && !pick ? "inset-y-0 items-center" : "bottom-4"}`}>
          <AnimatePresence mode="wait">
            <motion.div key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line bg-surface px-3 text-[12.5px] text-ink">
              {waiting ? <span className="size-1.5 rounded-full bg-ink-3" /> : drawings.length === 0 && !pick ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" /> : <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />}
              <span className="truncate">{status || "Preparando"}</span>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function LaneBadge({ label, pass }: { label: string; pass: boolean | null }) {
  const tone = pass === null ? "text-ink-3" : pass ? "text-leaf" : "text-rose";
  return (
    <span className={`inline-flex w-14 items-center gap-1 ${tone}`}>
      {pass === null ? <span className="size-1.5 rounded-full border border-current" /> : pass ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
      {label}
    </span>
  );
}

// The conversation: what the player gave, what the agents did, every live edit, and the composer pinned at the bottom.
interface ThreadProps {
  phase: Phase;
  preview: string | null;
  idea: string;
  drawings: string[];
  asset: (n: string) => string;
  concepts: Concept[];
  chosen: number;
  setChosen: (i: number) => void;
  build: () => void;
  concept: Concept | null;
  events: EngineEvent[];
  t0: number;
  result: EngineEvent["data"] | null;
  playUrl: string | null;
}

interface EditItem {
  id: number;
  asked: string;
  status: string;
  mode: "busy" | "done" | "failed" | "undone";
  model: string;
  started: number;
  ended: number;
}

function Thread({ phase, preview, idea, drawings, asset, concepts, chosen, setChosen, build, concept, events, t0, result, playUrl }: ThreadProps) {
  const { edits, send, undo, busy } = useEdits(playUrl);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const done = phase === "playing";
  const [buildOpen, setBuildOpen] = useState(true);
  useEffect(() => {
    if (done) setBuildOpen(true);
  }, [done]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, edits, phase, concepts.length]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy || !playUrl) return;
    setText("");
    send(t);
  };
  const suggestions = ["un dragón amigo", "que llueva", "que sea de noche"];
  const art = events.find((e) => e.stage === "art" && e.data?.drawings);
  const minutes = Math.max(1, Math.round((result?.ms ?? 0) / 60000));

  return (
    <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {/* The player's turn */}
          <div className="flex justify-end">
            {preview ? (
              <div className="overflow-hidden rounded-xl rounded-tr-sm border border-line bg-surface p-1">
                {/* biome-ignore lint/performance/noImgElement: the player's photo */}
                <img src={preview} alt="Tu dibujo" className="h-32 w-auto max-w-[220px] rounded-lg object-cover" />
              </div>
            ) : (
              <p className="max-w-[85%] rounded-xl rounded-tr-sm bg-ink px-3.5 py-2 text-[13.5px] leading-snug text-paper">{idea.trim() || "Mis dibujos"}</p>
            )}
          </div>

          {/* Cutouts */}
          {(art || phase === "cutting") && (
            <Agent>
              {drawings.length > 0 ? (
                <>
                  <p className="text-[13.5px]">Recorté {drawings.length === 1 ? "un dibujo" : `${drawings.length} dibujos`}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {drawings.map((d) => (
                      <span key={d} className="flex h-[76px] min-w-[76px] max-w-[168px] items-center justify-center rounded-lg border border-line bg-surface px-2" title={d}>
                        {/* biome-ignore lint/performance/noImgElement: engine-served cutout */}
                        <img src={asset(d)} alt={d} className="h-[60px] w-auto max-w-[150px] object-contain" />
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
                  <Loader2 className="size-3.5 animate-spin text-accent" /> Buscando tus dibujos
                </p>
              )}
            </Agent>
          )}

          {/* Ideas: pick one, or the chosen one once the build starts */}
          {concepts.length > 0 && phase === "choosing" && (
            <Agent>
              <p className="text-[13.5px]">Se me ocurren tres juegos. Elige uno</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {concepts.map((c, i) => (
                  <button key={c.title} type="button" onClick={() => setChosen(i)} className={`rounded-lg border p-3 text-left transition-colors ${chosen === i ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-2"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] text-ink-3">{genreLabel(c.genre)}</span>
                      {chosen === i && <Check className="size-3.5 text-accent" strokeWidth={2.5} />}
                    </div>
                    <h3 className="mt-0.5 text-[13.5px] font-medium leading-snug tracking-[-0.01em]">{c.title}</h3>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-2">{c.pitch}</p>
                  </button>
                ))}
                <button type="button" onClick={build} disabled={chosen < 0} className="btn-primary mt-1 inline-flex h-9 items-center justify-center rounded-lg text-[13px] font-medium disabled:pointer-events-none">
                  {chosen < 0 ? "Elige un juego" : "Construir"}
                </button>
              </div>
            </Agent>
          )}
          {concept && phase !== "choosing" && (
            <Agent>
              <p className="font-mono text-[10.5px] text-ink-3">{genreLabel(concept.genre)}</p>
              <h2 className="mt-0.5 text-[15px] font-semibold leading-snug tracking-[-0.02em]">{concept.title}</h2>
              <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-2" title={concept.pitch}>
                {concept.pitch}
              </p>
            </Agent>
          )}

          {/* The build, collapsible */}
          {(phase === "building" || phase === "playing") && (
            <Agent>
              <button type="button" onClick={() => setBuildOpen((o) => !o)} aria-expanded={buildOpen} className="flex w-full items-center justify-between gap-2 text-left">
                <span className="flex items-center gap-2 text-[13.5px]">
                  {done ? <Check className="size-3.5 text-leaf" strokeWidth={3} /> : <Loader2 className="size-3.5 animate-spin text-accent" />}
                  {done ? (
                    <span>
                      Construido en {minutes} min <span className="text-ink-3">· US${(result?.cost ?? 0).toFixed(2)}</span>
                    </span>
                  ) : (
                    "Construyendo"
                  )}
                </span>
                <ChevronDown className={`size-3.5 text-ink-3 transition-transform ${buildOpen ? "rotate-180" : ""}`} strokeWidth={2} />
              </button>
              {buildOpen && (
                <div className="mt-2 border-t border-line pt-2">
                  <Pipeline events={events} t0={t0} done={done} />
                </div>
              )}
            </Agent>
          )}

          {/* Live edits */}
          {edits.map((e) => (
            <div key={e.id} className="flex flex-col gap-3">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-xl rounded-tr-sm bg-ink px-3.5 py-2 text-[13.5px] leading-snug text-paper">{e.asked}</p>
              </div>
              <Agent>
                <div className="flex items-start gap-2">
                  {e.mode === "busy" ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" /> : e.mode === "failed" ? <X className="mt-0.5 size-3.5 shrink-0 text-rose" strokeWidth={3} /> : <Check className={`mt-0.5 size-3.5 shrink-0 ${e.mode === "undone" ? "text-ink-3" : "text-leaf"}`} strokeWidth={3} />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13.5px] leading-snug ${e.mode === "undone" ? "text-ink-3 line-through" : ""}`}>{e.status}</p>
                    <p className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-ink-3">
                      {e.mode === "busy" ? (
                        <>
                          <span>
                            <Models text={e.model} />
                          </span>
                          <Timer started={e.started} />
                        </>
                      ) : e.mode === "done" ? (
                        <>
                          <span className="tabular-nums">{Math.max(1, Math.round((e.ended - e.started) / 1000))} s · verificado</span>
                          <button type="button" onClick={() => undo(e.id)} className="inline-flex h-5 items-center gap-1 rounded border border-line px-1.5 font-sans text-[11px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink">
                            <Undo2 className="size-3" /> Deshacer
                          </button>
                        </>
                      ) : e.mode === "undone" ? (
                        <span>deshecho</span>
                      ) : null}
                    </p>
                  </div>
                </div>
              </Agent>
            </div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line p-3">
        {edits.length === 0 && playUrl && !text && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => setText(s)} className="h-7 rounded-full border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        <div className={`flex flex-col rounded-xl border border-line-2 bg-surface transition-colors focus-within:border-accent ${!playUrl ? "opacity-60" : ""}`}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            disabled={!playUrl}
            placeholder={playUrl ? "Pide un cambio…" : "El juego está en camino"}
            aria-label="Pide un cambio"
            style={{ outline: "none" }}
            className="min-h-[56px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13.5px] leading-snug outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="px-1 font-mono text-[10.5px] text-ink-3">{busy ? "Muse trabajando" : <Models text="Muse Spark · Muse Image" />}</span>
            <button type="button" onClick={submit} disabled={!text.trim() || busy || !playUrl} className="btn-primary grid size-7 place-items-center rounded-md" aria-label="Enviar">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.25} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Agent({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0">{children}</div>
  );
}

function Timer({ started }: { started: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return <time className="tabular-nums">{Math.max(0, Math.round((now - started) / 1000))} s</time>;
}

// Live edits against the running game (make/play.ts serves /events, /edit and /undo).
function useEdits(playUrl: string | null) {
  const [edits, setEdits] = useState<EditItem[]>([]);
  const base = playUrl?.replace(/\/$/, "") ?? null;
  const patchLast = useCallback((f: (e: EditItem) => EditItem) => {
    setEdits((prev) => {
      const i = prev.length - 1;
      if (i < 0) return prev;
      const next = prev.slice();
      next[i] = f(prev[i]!);
      return next;
    });
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const m = new URLSearchParams(location.search).get("edit");
    if (m !== "busy" && m !== "done") return;
    setEdits([{ id: 1, asked: "que aparezca un dragón amigo", model: "Muse Image", mode: m, started: Date.now() - 7_000, ended: Date.now() + 5_000, status: m === "busy" ? "Dibujando en el estilo de tu dibujo" : "Apareció un dragón amigo que vuela sobre la cocina." }]);
  }, []);
  useEffect(() => {
    if (!base) return;
    const es = new EventSource(`${base}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as { status?: string; done?: string };
      if (e.status) {
        const s = e.status;
        if (s.startsWith("No pude")) {
          patchLast((x) => ({ ...x, mode: "failed", status: s, ended: Date.now() }));
          return;
        }
        patchLast((x) => (x.mode === "busy" ? { ...x, model: /sprite/i.test(s) ? "Muse Image" : "Muse Spark", status: humanizeEdit(s) } : x));
      }
      if (e.done) {
        const d = e.done;
        patchLast((x) => ({ ...x, mode: "done", status: d, ended: Date.now() }));
      }
    };
    return () => es.close();
  }, [base, patchLast]);
  const send = useCallback(
    (t: string) => {
      if (!base) return;
      setEdits((prev) => [...prev, { id: Date.now(), asked: t, status: "Leyendo el juego", mode: "busy", model: "Muse Spark", started: Date.now(), ended: 0 }]);
      fetch(`${base}/edit`, { method: "POST", body: JSON.stringify({ text: t }) }).catch(() => {});
    },
    [base],
  );
  const undo = useCallback(
    (id: number) => {
      if (!base) return;
      setEdits((prev) => prev.map((e) => (e.id === id ? { ...e, mode: "undone" } : e)));
      fetch(`${base}/undo`, { method: "POST" }).catch(() => {});
    },
    [base],
  );
  const busy = edits.at(-1)?.mode === "busy";
  return { edits, send, undo, busy };
}

const humanizeEdit = (m: string) => {
  const body = m.replace(/^Muse:\s*/, "");
  if (/sprite/i.test(body)) return "Dibujando en el estilo de tu dibujo";
  if (/arreglando/i.test(body)) return "Arreglando un error";
  if (/^(Write|Edit|MultiEdit)\b/.test(body)) return "Cambiando las reglas";
  if (/^Read\b/.test(body)) return "Leyendo el juego";
  if (/^(Bash|ls)\b/.test(body)) return "Probando el cambio";
  return body.replace(/^Muse esta\s*/, "");
};

// Mark: a rounded square with a crayon spark. Wordmark in Geist semibold, lowercase, tight.
function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-5" aria-hidden="true">
        <path d="M15 8H40L56 24V49A7 7 0 0 1 49 56H15A7 7 0 0 1 8 49V15A7 7 0 0 1 15 8Z" className="fill-ink" />
        <path d="M40 8V20A4 4 0 0 0 44 24H56Z" fill="#0866FF" stroke="#0866FF" strokeWidth="2" strokeLinejoin="round" />
        <path d="M26 24.5L42.5 34L26 43.5Z" className="fill-paper stroke-paper" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-ink">conjure</span>
    </span>
  );
}

function demoSession(mode: string) {
  const drawings = ["cat", "car", "house", "sun", "tree", "dragon"];
  const concepts: Concept[] = [
    { title: "La palanca del árbol dormido", genre: "physics puzzle", pitch: "El gato se durmió sobre el auto y solo el árbol puede empujarlo hasta casa. Mueve el sol para doblar el árbol como una palanca viva.", core_mechanic: "", controls: "Flechas para mover el sol, espacio para soltar" },
    { title: "Carrera al atardecer", genre: "racing", pitch: "El auto corre hacia la casa antes de que el sol se ponga, esquivando árboles.", core_mechanic: "", controls: "" },
    { title: "El gato y la casa", genre: "endless runner", pitch: "El gato salta árboles y autos para llegar a casa.", core_mechanic: "", controls: "" },
  ];
  let t = 1_000;
  const ev = (stage: string, message: string, data?: EngineEvent["data"]): EngineEvent => {
    t += 2_400;
    return { stage, message, t, data };
  };
  const events: EngineEvent[] = [
    ev("art", "Encontrando tus dibujos"),
    ev("art", "6 dibujos recortados", { drawings }),
    ev("concepts", "Muse Wonder esta imaginando tres juegos"),
    ev("concepts", "Elige tu juego", { concepts }),
  ];
  if (mode !== "choosing") {
    events.push(
      ev("build", `Construyendo "${concepts[0]!.title}"`),
      ev("build", "3 construcciones en paralelo; gana la primera que pase los chequeos"),
      ev("code", "#1 Escribiendo sim.ts", { attempt: 0 }),
      ev("code", "#2 Compilando", { attempt: 1 }),
      ev("code", "#3 Pintando la hoja de arte", { attempt: 2 }),
      ev("check", "#1 Playtester: ok", { attempt: 0, verdict: "ok", search: { outcome: "won", frames: 3080 }, too_easy_by: [], policies: { idle: 1, "hold-right": 1, "hold-left": 1, "hold-right-jump": 1, "hold-everything": 1, "tap-action": 1 } }),
      ev("code", "#2 Simulando partidas", { attempt: 1 }),
      ev("check", "#1 QA visual: ok", { attempt: 0, ok: true, issues: [] }),
    );
  }
  if (mode === "playing") events.push(ev("done", "Ganó el intento 1", { verdict: "ok", cost: 0.42, ms: 214_000 }), ev("play", "A jugar"));
  return {
    slug: "dibujo-10280132",
    drawings,
    concepts,
    events,
    playUrl: mode === "playing" ? (new URLSearchParams(location.search).get("url") ?? null) : null,
    result: mode === "playing" ? { verdict: "ok", cost: 0.42, ms: 214_000 } : null,
  };
}
