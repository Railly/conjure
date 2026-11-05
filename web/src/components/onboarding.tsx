"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DotframeLink, Models } from "./logos";

const TOUR_KEY = "conjure.tour.v1";

const readSeen = () => {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
};
const writeSeen = () => {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {}
};

/* Hackathon badge: attribution of the event in the top bar. Host marks are the official files under /public/hosts, never redrawn. */
export function HackathonBadge() {
  return (
    <span className="group relative hidden items-center sm:inline-flex">
      <span className="inline-flex h-7 cursor-default items-center gap-2 rounded-full border border-line py-0.5 pr-2.5 pl-1 transition-colors group-hover:border-line-2" aria-describedby="hackathon-tip">
        <span className="flex items-center">
          {/* biome-ignore lint/performance/noImgElement: static svg */}
          <img src="/hosts/meta.svg" alt="Meta" className="relative z-10 size-[18px] rounded-full bg-white object-contain p-[3px] ring-[1.5px] ring-paper" />
          {/* biome-ignore lint/performance/noImgElement: static svg */}
          <img src="/hosts/cerebral-valley.svg" alt="Cerebral Valley" className="-ml-1.5 size-[18px] rounded-full bg-white object-contain p-[3px] ring-[1.5px] ring-paper" />
        </span>
        <span className="text-[12px] leading-none text-ink-2 group-hover:text-ink">
          Meta Global AI Hackathon <span className="text-ink-3">· Indie</span>
        </span>
      </span>
      <span
        id="hackathon-tip"
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-50 mt-2 w-max max-w-[300px] -translate-x-1/2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] leading-snug text-ink-2 opacity-0 shadow-[0_8px_24px_-12px_rgba(0,0,0,.25)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        Hecho para el Meta Global AI Developer Hackathon, organizado por Meta y Cerebral Valley
      </span>
    </span>
  );
}

const STEPS = [
  { n: 1, text: "Recorta tus dibujos", model: "Muse Spark + SAM 3.1" },
  { n: 2, text: "Propone 3 juegos", model: "Muse Wonder" },
  { n: 3, text: "3 agentes construyen en paralelo, gana el que pasa el playtester", model: "Muse Wonder" },
  { n: 4, text: "Cámbialo mientras juegas", model: "Muse Spark + Muse Image" },
];

/* "Cómo funciona" ghost button + popover. onTour replays the guided tour. */
export function HowItWorks({ onTour }: { onTour?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-tour="how"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-accent-soft/60 hover:text-ink"
      >
        Cómo funciona
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Cómo funciona"
            initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
            transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute top-full right-0 z-50 mt-2 w-[360px] rounded-xl border border-line bg-raised p-1 shadow-[0_1px_2px_rgba(0,0,0,.04),0_16px_40px_-16px_rgba(0,0,0,.25)]"
          >
            <ol className="flex flex-col">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-start gap-3 rounded-lg px-3 py-2.5">
                  <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[10px] text-ink-2">{s.n}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-snug text-ink">{s.text}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-3">
                      <Models text={s.model} />
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mx-1 mt-1 flex items-center justify-between gap-3 border-t border-line px-2 pt-2.5 pb-1.5">
              <p className="font-mono text-[10.5px] leading-snug text-ink-3">Verificado por código, no por el modelo. Corre sobre <DotframeLink />.
              </p>
              {onTour && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onTour();
                  }}
                  className="shrink-0 rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
                >
                  Ver el tour
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type TourStep = { target: string; text: string; place: "below" | "above" | "left" };

const TOUR: TourStep[] = [
  { target: "composer", text: "Sube la foto de un dibujo o describe un juego", place: "below" },
  { target: "gallery", text: "O abre un juego ya hecho", place: "below" },
  { target: "how", text: "Así lo construyen los agentes", place: "below" },
];

/* Decides whether the tour auto-starts. Never on ?game= or ?demo=; ?tour=1 forces it. */
export function useTour(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const q = new URLSearchParams(location.search);
    if (q.get("tour") === "1") {
      setOpen(true);
      return;
    }
    if (q.has("game") || q.has("demo")) return;
    if (!readSeen()) setOpen(true);
  }, [enabled]);
  const start = useCallback(() => setOpen(true), []);
  const stop = useCallback(() => {
    writeSeen();
    setOpen(false);
  }, []);
  return { open, start, stop };
}

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const reduce = useReducedMotion();
  const step = TOUR[i] ?? TOUR[0]!;

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom > innerHeight || r.top < 48) el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      const pad = step.target === "how" ? 4 : 8;
      setRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };
    measure();
    // A short settle after scrollIntoView so the ring lands on the final position.
    const t = setTimeout(measure, 320);
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure, true);
    };
  }, [open, step, reduce]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const last = i === TOUR.length - 1;
  const next = () => (last ? onClose() : setI((v) => v + 1));

  const cardW = 300;
  const cardStyle = (() => {
    if (typeof window === "undefined") return { top: 0, left: 0 };
    if (!rect) return { top: innerHeight / 2 - 60, left: innerWidth / 2 - cardW / 2 };
    const left = step.target === "how" ? Math.min(rect.left + rect.width - cardW, innerWidth - cardW - 16) : Math.max(16, rect.left + rect.width / 2 - cardW / 2);
    return { top: rect.top + rect.height + 12, left: Math.min(left, innerWidth - cardW - 16) };
  })();

  const t = { duration: reduce ? 0 : 0.2, ease: [0.2, 0, 0, 1] as const };

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" className="fixed inset-0 z-[90]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t} role="dialog" aria-label="Tour">
          {/* Backdrop click closes. The spotlight is drawn by the ring's outer shadow so the target stays crisp. */}
          <button type="button" aria-label="Cerrar tour" onClick={onClose} className="absolute inset-0 cursor-default" />
          {/* Four dim panes around the target plus a 1px ring. Plain CSS transitions on purpose: one huge shadowed layer drops out in Chrome. */}
          {(() => {
            const r = rect ?? { top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 };
            const ease = reduce ? "none" : "all 200ms cubic-bezier(.2,0,0,1)";
            const pane = "pointer-events-none absolute bg-black/40 dark:bg-black/60";
            const dim = {};
            return (
              <>
                <div aria-hidden="true" className={pane} style={{ ...dim, top: 0, left: 0, right: 0, height: Math.max(0, r.top), transition: ease }} />
                <div aria-hidden="true" className={pane} style={{ ...dim, top: r.top + r.height, left: 0, right: 0, bottom: 0, transition: ease }} />
                <div aria-hidden="true" className={pane} style={{ ...dim, top: r.top, left: 0, width: Math.max(0, r.left), height: r.height, transition: ease }} />
                <div aria-hidden="true" className={pane} style={{ ...dim, top: r.top, left: r.left + r.width, right: 0, height: r.height, transition: ease }} />
                <div aria-hidden="true" className="pointer-events-none absolute rounded-xl ring-1 ring-accent" style={{ top: r.top, left: r.left, width: r.width, height: r.height, opacity: rect ? 1 : 0, transition: ease }} />
              </>
            );
          })()}
          <motion.div
            key={i}
            className="absolute flex flex-col gap-3 rounded-xl border border-line bg-raised p-3.5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_16px_40px_-16px_rgba(0,0,0,.3)]"
            style={{ width: cardW }}
            initial={{ opacity: 0, y: reduce ? 0 : 6, top: cardStyle.top, left: cardStyle.left }}
            animate={{ opacity: 1, y: 0, top: cardStyle.top, left: cardStyle.left }}
            exit={{ opacity: 0 }}
            transition={t}
          >
            <p className="text-[13.5px] leading-snug text-ink">{step.text}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5" role="group" aria-label={`Paso ${i + 1} de ${TOUR.length}`}>
                {TOUR.map((s, k) => (
                  <span key={s.target} className={`size-1.5 rounded-full transition-colors duration-200 ${k === i ? "bg-accent" : "bg-line-2"}`} />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={onClose} className="h-7 rounded-md px-2 text-[12px] text-ink-3 transition-colors hover:text-ink">
                  Saltar
                </button>
                <button type="button" onClick={next} className="btn-primary h-7 rounded-md px-2.5 text-[12px] font-medium">
                  {last ? "Listo" : "Siguiente"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
