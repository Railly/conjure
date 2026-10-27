"use client";

import { ArrowRight, Check, ImagePlus, Loader2, Send, Sparkles, Undo2, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  data?: { drawings?: string[]; concepts?: Concept[]; url?: string; verdict?: string; cost?: number; ms?: number };
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
};
const genreLabel = (g: string) => GENRE_LABEL[g] ?? g.replace(/^./, (c) => c.toUpperCase());

const GALLERY = [
  { src: "/gallery/cat-night.png", title: "El camino del gato", note: "de un dibujo en crayón" },
  { src: "/gallery/penguin.png", title: "Pingüino en el hielo", note: "empuja bloques" },
  { src: "/gallery/fox.png", title: "Zorro y bayas", note: "antes de la noche" },
];

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

  const pick = (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  };

  useEffect(() => {
    if (!slug) return;
    const es = new EventSource(`${ENGINE}/api/events?slug=${slug}`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as EngineEvent;
      setEvents((prev) => (prev.some((p) => p.t === e.t && p.message === e.message) ? prev : [...prev, e]));
      if (e.data?.drawings) setDrawings(e.data.drawings);
      if (e.data?.concepts) {
        setConcepts(e.data.concepts);
        setPhase("choosing");
      }
      if (e.stage === "done" && e.data) setResult(e.data);
      if (e.stage === "play" && e.data?.url) {
        setPlayUrl(e.data.url);
        setPhase("playing");
      }
    };
    return () => es.close();
  }, [slug]);

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

  const asset = (n: string) => `${ENGINE}/games/${slug}/assets/${n}.png`;
  const t0 = events[0]?.t ?? 0;
  const last = events.at(-1);

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-baseline gap-3">
          <Wordmark className="text-[28px]" />
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">Experimento</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink-3 sm:inline">Built on Meta&apos;s Muse models</span>
          <ThemeToggle />
        </div>
      </header>

      <AnimatePresence mode="wait">
        {phase === "idle" ? (
          <motion.main key="hero" exit={{ opacity: 0, y: -12 }} className="relative flex flex-1 flex-col items-center px-6 pb-16">
            <Floaters />
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-[6vh] text-center font-display text-[clamp(48px,9vw,128px)] font-extrabold leading-[0.92] tracking-[-0.04em]"
            >
              Dibuja algo.
              <br />
              <span className="relative inline-block">
                Juégalo.
                <Scribble className="absolute -bottom-3 left-0 w-full text-sun" />
              </span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.15 } }} className="mt-7 max-w-xl text-center text-lg text-ink-2">
              Sacale una foto a tu dibujo. Muse lo convierte en un juego de verdad, con física y todo, y lo cambia mientras juegas.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.25 } }}
              className="relative mt-10 w-full max-w-2xl rounded-[28px] border border-line bg-surface p-3 shadow-[0_30px_80px_-30px_rgba(60,40,0,.35),0_0_0_8px_var(--glow)] dark:shadow-[0_30px_80px_-20px_rgba(0,0,0,.8),0_0_0_8px_var(--glow)]"
            >
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
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
                  className={`group relative grid size-28 shrink-0 place-items-center overflow-hidden rounded-[20px] border-2 border-dashed transition-colors ${dragging ? "border-sun bg-sun/10" : "border-line hover:border-ink-3"}`}
                  aria-label="Subir la foto de tu dibujo"
                >
                  {preview ? (
                    // biome-ignore lint/performance/noImgElement: local object URL preview
                    <img src={preview} alt="Tu dibujo" className="size-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-ink-3 group-hover:text-ink-2">
                      <ImagePlus className="size-6" />
                      <span className="font-hand text-base leading-none">tu dibujo</span>
                    </div>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
                    }}
                    placeholder={preview ? "Opcional: cómo te lo imaginas. «que el gato maneje el auto»" : "Sube tu dibujo, o describe un juego: «un pingüino que empuja hielo»"}
                    className="min-h-20 flex-1 resize-none bg-transparent px-2 pt-2 text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3"
                  />
                  <div className="flex items-center justify-between pl-2">
                    <span className="text-xs text-ink-3">{preview ? photo?.name : "Papel, crayón, birome: todo vale"}</span>
                    <button
                      type="button"
                      onClick={start}
                      disabled={!photo && !idea.trim()}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-paper transition hover:-translate-y-px disabled:pointer-events-none disabled:opacity-30"
                    >
                      Conjurar <ArrowRight className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>

            <section className="relative z-10 mt-20 w-full max-w-5xl">
              <h2 className="mb-5 text-center font-hand text-2xl text-ink-2">hechos con Conjure</h2>
              <div className="grid gap-5 sm:grid-cols-3">
                {GALLERY.map((g, i) => (
                  <motion.figure
                    key={g.src}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.35 + i * 0.08 } }}
                    className="group overflow-hidden rounded-[20px] border border-line bg-surface"
                  >
                    {/* biome-ignore lint/performance/noImgElement: static gallery capture */}
                    <img src={g.src} alt={g.title} className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                    <figcaption className="flex items-baseline justify-between px-4 py-3">
                      <span className="font-display text-[15px] font-semibold">{g.title}</span>
                      <span className="text-xs text-ink-3">{g.note}</span>
                    </figcaption>
                  </motion.figure>
                ))}
              </div>
            </section>
          </motion.main>
        ) : (
          <motion.main key="studio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid flex-1 gap-6 px-6 pb-6 md:px-10 lg:grid-cols-[380px_1fr]">
            <aside className="flex min-h-0 flex-col gap-6">
              {drawings.length > 0 && (
                <Panel title="Tus dibujos">
                  <div className="grid grid-cols-4 gap-2">
                    {drawings.map((d, i) => (
                      <motion.div
                        key={d}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1, transition: { type: "spring", delay: i * 0.06 } }}
                        className="grid aspect-square place-items-center rounded-2xl bg-[#f6f2e7] p-1.5 dark:bg-[#ece7da]"
                      >
                        {/* biome-ignore lint/performance/noImgElement: engine-served cutout */}
                        <img src={asset(d)} alt={d} className="size-full object-contain" />
                      </motion.div>
                    ))}
                  </div>
                </Panel>
              )}

              {concepts.length > 0 && (
                <Panel title={phase === "choosing" ? "Elige tu juego" : "Tu juego"}>
                  <div className="flex flex-col gap-2.5">
                    {concepts.map((c, i) =>
                      phase !== "choosing" && i !== chosen ? null : (
                        <motion.button
                          key={c.title}
                          type="button"
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0, transition: { delay: i * 0.08 } }}
                          disabled={phase !== "choosing"}
                          onClick={() => setChosen(i)}
                          className={`rounded-2xl border p-4 text-left transition ${chosen === i ? "border-ink bg-raised shadow-[0_0_0_3px_var(--glow)]" : "border-line bg-surface hover:border-ink-3"}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="rounded-full bg-sky/12 px-2 py-0.5 text-[11px] font-semibold text-sky">{genreLabel(c.genre)}</span>
                            {chosen === i && <Check className="size-4 text-ink" />}
                          </div>
                          <h3 className="mt-2 font-display text-lg font-semibold leading-tight">{c.title}</h3>
                          <p className="mt-1 line-clamp-3 text-[13.5px] leading-snug text-ink-2">{c.pitch}</p>
                        </motion.button>
                      ),
                    )}
                    {phase === "choosing" && (
                      <button
                        type="button"
                        onClick={build}
                        disabled={chosen < 0}
                        className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-ink py-3 text-sm font-semibold text-paper transition hover:-translate-y-px disabled:opacity-30"
                      >
                        <Wand2 className="size-4" /> Construir este juego
                      </button>
                    )}
                  </div>
                </Panel>
              )}

              {events.length > 0 && (
                <Panel title="En vivo">
                  <Feed events={events} t0={t0} done={phase === "playing"} />
                  {result && (
                    <p className="mt-3 text-xs text-ink-3">
                      {Math.max(1, Math.round((result.ms ?? 0) / 60000))} min · US${(result.cost ?? 0).toFixed(2)} de Muse · playtester: {result.verdict}
                    </p>
                  )}
                </Panel>
              )}
            </aside>

            <section className="relative min-h-[60vh]">
              <div className="sticky top-6 flex flex-col gap-4">
                <div className="relative aspect-video w-full overflow-hidden rounded-[28px] border border-line bg-stage shadow-[0_40px_90px_-40px_rgba(0,0,0,.45)]">
                  {playUrl ? (
                    <iframe src={`${playUrl}?embed=1`} title="Tu juego" className="absolute inset-0 size-full" allow="autoplay" />
                  ) : (
                    <Stage drawings={drawings} asset={asset} preview={preview} status={last?.message ?? ""} />
                  )}
                </div>
                {playUrl && <EditBar playUrl={playUrl} />}
              </div>
            </section>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[24px] border border-line bg-surface/80 p-4 backdrop-blur">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</h2>
      {children}
    </motion.section>
  );
}

const DOT: Record<string, string> = { art: "bg-rose", concepts: "bg-sun", build: "bg-sun", code: "bg-sky", check: "bg-leaf", fix: "bg-rose", done: "bg-leaf", play: "bg-leaf", error: "bg-red-500" };

function Feed({ events, t0, done }: { events: EngineEvent[]; t0: number; done: boolean }) {
  // Consecutive code steps collapse into the latest one, so the feed reads as progress, not a log.
  const rows = events.filter((e, i) => !(e.stage === "code" && events[i + 1]?.stage === "code"));
  return (
    <ol className="flex flex-col gap-2">
      {rows.slice(-9).map((e, i, all) => {
        const live = i === all.length - 1 && !done && e.stage !== "error";
        return (
          <motion.li key={`${e.t}-${e.message}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={`grid grid-cols-[10px_1fr_auto] items-start gap-3 text-[13.5px] ${live ? "text-ink" : "text-ink-2"}`}>
            <span className={`mt-1.5 size-2 rounded-full ${DOT[e.stage] ?? "bg-ink-3"} ${live ? "animate-pulse-dot" : ""}`} />
            <span className="leading-snug">{e.message}</span>
            <time className="text-[11px] tabular-nums text-ink-3">{Math.round((e.t - t0) / 1000)}s</time>
          </motion.li>
        );
      })}
    </ol>
  );
}

function Stage({ drawings, asset, preview, status }: { drawings: string[]; asset: (n: string) => string; preview: string | null; status: string }) {
  const spots = [
    [10, 14],
    [70, 10],
    [14, 56],
    [74, 54],
    [42, 62],
    [44, 8],
  ];
  return (
    <div className="absolute inset-0">
      {drawings.length === 0 && preview && (
        // biome-ignore lint/performance/noImgElement: local preview
        <img src={preview} alt="" className="absolute inset-0 size-full object-cover opacity-40 blur-[2px]" />
      )}
      {drawings.slice(0, 6).map((d, i) => (
        <motion.img
          key={d}
          src={asset(d)}
          alt=""
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0, transition: { type: "spring", stiffness: 180, damping: 14, delay: i * 0.1 } }}
          className="animate-float absolute w-[18%] drop-shadow-[0_14px_20px_rgba(0,0,0,.25)]"
          style={{ left: `${spots[i]![0]}%`, top: `${spots[i]![1]}%`, animationDelay: `${i * -1.1}s` }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-6 flex justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/90 px-4 py-2 text-sm text-ink shadow-sm backdrop-blur"
          >
            <Loader2 className="size-3.5 animate-spin text-ink-3" />
            {status || "Preparando"}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function EditBar({ playUrl }: { playUrl: string }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Cambia el juego mientras juegas.");
  const [busy, setBusy] = useState(false);
  const base = playUrl.replace(/\/$/, "");
  useEffect(() => {
    const es = new EventSource(`${base}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as { status?: string; done?: string };
      if (e.status) setStatus(e.status);
      if (e.done) {
        setStatus(e.done);
        setBusy(false);
      }
      if (e.status?.startsWith("No pude")) setBusy(false);
    };
    return () => es.close();
  }, [base]);
  const send = useCallback(async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    await fetch(`${base}/edit`, { method: "POST", body: JSON.stringify({ text: t }) });
  }, [text, busy, base]);
  const suggestions = ["que llueva", "un dragón amigo", "más difícil", "que sea de noche"];
  return (
    <div className="rounded-[24px] border border-line bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <Sparkles className="ml-2 size-4 shrink-0 text-sun" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="«que el gato vuele», «que aparezca un dragón»..."
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] outline-none placeholder:text-ink-3"
        />
        <button type="button" onClick={() => fetch(`${base}/undo`, { method: "POST" })} className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-paper hover:text-ink" title="Deshacer" aria-label="Deshacer">
          <Undo2 className="size-4" />
        </button>
        <button type="button" onClick={send} disabled={!text.trim() || busy} className="grid size-9 place-items-center rounded-full bg-ink text-paper disabled:opacity-30" aria-label="Enviar">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-2 pb-0.5 pt-2">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => setText(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-ink-3 hover:text-ink">
            {s}
          </button>
        ))}
        <span className="ml-auto truncate text-xs text-ink-3">{status}</span>
      </div>
    </div>
  );
}

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-extrabold tracking-[-0.03em] ${className}`}>
      con<span className="text-rose">j</span>ure
    </span>
  );
}

// A crayon underline: a wobbly stroke with a rough edge.
function Scribble({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 24" preserveAspectRatio="none" className={className} aria-hidden="true">
      <filter id="crayon">
        <feTurbulence baseFrequency="0.9" numOctaves="2" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="3" />
      </filter>
      <path d="M4 16 C 80 6, 160 20, 240 10 S 360 6, 396 14" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" filter="url(#crayon)" />
    </svg>
  );
}

// The real drawings from the gallery, drifting around the hero.
function Floaters() {
  const items = [
    { src: "/gallery/cat.png", left: "6%", top: "10%", w: "9vw", d: 0 },
    { src: "/gallery/sun.png", left: "84%", top: "6%", w: "8vw", d: -1.5 },
    { src: "/gallery/tree.png", left: "4%", top: "46%", w: "8vw", d: -3 },
    { src: "/gallery/dragon.png", left: "82%", top: "40%", w: "10vw", d: -2.2 },
    { src: "/gallery/car.png", left: "14%", top: "80%", w: "7vw", d: -4 },
    { src: "/gallery/house.png", left: "84%", top: "78%", w: "6vw", d: -0.8 },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[640px] overflow-hidden md:block" aria-hidden="true">
      {items.map((it) => (
        // biome-ignore lint/performance/noImgElement: decorative drawing
        <img key={it.src} src={it.src} alt="" className="animate-float absolute opacity-90 drop-shadow-[0_12px_18px_rgba(0,0,0,.18)]" style={{ left: it.left, top: it.top, width: it.w, animationDelay: `${it.d}s` }} />
      ))}
    </div>
  );
}
