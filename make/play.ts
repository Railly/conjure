// Play a generated game in the browser, and change it while you play: type what you want ("que llueva", "el gato
// vuela") and a Muse agent edits the game's code; the page swaps in the new sim and restores the running match, so
// the game changes without starting over. Assets load over HTTP from the game directory, as in snap.
//   bun --env-file=.env make/play.ts <slug> [--port 5180] [--model muse-spark-1.3]
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { costOf, runAgent } from "./agent";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const slug = process.argv[2];
if (!slug) throw new Error("usage: play.ts <slug> [--port 5180] [--model muse-spark-1.3]");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const port = Number(arg("--port", "5180"));
const model = arg("--model", "muse-spark-1.3");
const dir = `${ROOT}/games/${slug}`;
const engine = `${dir}/node_modules/dotframe/src`;
const CLI = `${dir}/node_modules/dotframe/cli/bin.cjs`;
const work = join(dir, ".play");
mkdirSync(work, { recursive: true });

// The shell owns the canvas, input and the 60 Hz loop; the sim is a separate module it can replace mid-match.
const shell = `import { createDraw2D } from ${JSON.stringify(`${engine}/draw2d`)};
import { Key } from ${JSON.stringify(`${engine}/input`)};
import { loadBytes, run } from ${JSON.stringify(`${engine}/web/run`)};
const STEP = 1 / 60;
// A computed URL, so the bundler leaves the import to the browser.
const loadSim = async (v) => (await import(location.origin + "/sim.js?v=" + v)).default;
let sim = await loadSim(0);
const ui = document.createElement("div");
ui.innerHTML = '<form id="f"><input id="t" placeholder="Cambia el juego mientras juegas: que llueva, el gato vuela..." autocomplete="off"><button id="u" type="button">Deshacer</button></form><div id="s"></div>';
ui.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;font:15px system-ui;z-index:9";
document.body.appendChild(ui);
const st = document.createElement("style");
st.textContent = "#f{display:flex;gap:8px}#t{flex:1;padding:12px 14px;border-radius:10px;border:0;font:inherit;background:rgba(255,255,255,.92)}#u{padding:0 14px;border-radius:10px;border:0;font:inherit;background:rgba(255,255,255,.6)}#s{margin-top:6px;color:#fff;text-shadow:0 1px 2px #000;min-height:1.2em}";
document.head.appendChild(st);
const status = (s) => (document.getElementById("s").textContent = s);
const typing = () => document.activeElement === document.getElementById("t");
await run(sim.window, (p) => {
  const draw = createDraw2D(p.gpu, sim.window.width, sim.window.height);
  const platform = { gpu: p.gpu, load: loadBytes, headless: false, draw, image: p.gpu.createImage };
  let game = sim.create(platform);
  let ready = false;
  game.ready.then(() => { game.start(Math.floor(Math.random() * 1e9), { ...sim.options }); ready = true; });
  // Swap: build the new sim, start it, then move the running match into it. A snapshot it cannot read starts fresh.
  const swap = async (v) => {
    const next = await loadSim(v);
    const fresh = next.create(platform);
    await fresh.ready;
    fresh.start(Math.floor(Math.random() * 1e9), { ...next.options });
    let kept = true;
    try { fresh.restore(structuredClone(game.save())); fresh.state(); } catch (e) { kept = false; fresh.start(1, { ...next.options }); }
    sim = next; game = fresh;
    return kept;
  };
  const events = new EventSource("/events");
  events.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.status) status(m.status);
    if (m.version !== undefined) status((await swap(m.version)) ? m.done + " (la partida sigue)" : m.done + " (partida nueva: el estado cambio de forma)");
  };
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const t = document.getElementById("t");
    const text = t.value.trim();
    if (!text) return;
    t.value = ""; t.blur();
    await fetch("/edit", { method: "POST", body: JSON.stringify({ text }) });
  };
  // The engine's window key handler cancels Enter and arrows; typed keys must not reach it, or Enter never submits.
  document.getElementById("t").addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); document.getElementById("f").requestSubmit(); }
  });
  document.getElementById("u").onclick = () => fetch("/undo", { method: "POST" });
  const keys = () => {
    if (typing()) return {};
    const d = (k) => p.input.down(k);
    const left = d(Key.Left) || d(Key.A), right = d(Key.Right) || d(Key.D), up = d(Key.Up) || d(Key.W), down = d(Key.Down) || d(Key.S);
    const space = d(Key.Space), enter = d(Key.Enter), r = d(Key.R);
    return { left, right, up, down, a: d(Key.A), d: d(Key.D), w: d(Key.W), s: d(Key.S), jump: up || space, action: space || enter, fire: space, space, enter, restart: r, r };
  };
  let simulated = -1;
  return (time) => {
    if (!ready) return true;
    if (simulated < 0) simulated = time;
    for (let n = 0; simulated + STEP <= time && n < 5; n++) {
      const input = sim.encode(keys());
      game.step(Array.from({ length: sim.players }, (_, i) => (i === 0 ? input : sim.neutral)));
      simulated += STEP;
    }
    if (simulated + STEP <= time) simulated = time;
    draw.begin();
    if (game.render) game.render(draw);
    draw.end(sim.clear ?? { r: 0, g: 0, b: 0 });
    return true;
  };
}, { fit: "window" });
`;

const build = async (entry: string): Promise<string> => {
  const built = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  return built.outputs[0]!.text();
};
writeFileSync(join(work, "shell.js"), shell);
const shellJs = await build(join(work, "shell.js"));
let simJs = await build(join(dir, "sim.ts"));
let version = 0;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${slug}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000}</style></head><body><script type="module" src="/main.js"></script></body></html>`;

const listeners = new Set<ReadableStreamDefaultController>();
const send = (m: unknown) => {
  for (const c of listeners) c.enqueue(`data: ${JSON.stringify(m)}\n\n`);
};

const core = (await Bun.$`node ${CLI} skills get core`.quiet()).stdout.toString();
// What the player asked for so far, oldest first: every edit must keep the earlier ones.
const historyFile = join(work, "history.json");
const history: string[] = (await Bun.file(historyFile).exists()) ? await Bun.file(historyFile).json() : [];
const editSystem = (text: string) => `You change a running dotframe game in ${dir} while someone plays it. The player asked: "${text}".

Make the smallest change to sim.ts (and its modules) that does what they asked, visibly, right away. Keep everything else as it is: the drawings in assets/, the controls, the rules that still apply.${history.length ? `

The player already changed the game, in this order, and every one of these must stay in effect: ${history.map((h, i) => `${i + 1}. "${h}"`).join("; ")}. Code that differs from the original game is these changes, not a mistake: never revert it.` : ""}

The page swaps your new sim in mid-match and calls restore() with a snapshot saved by the OLD code, so restore() must accept a snapshot without your new fields: give every new state field a default when it is missing. Keep all state changes in step(), render only reads, randomness from the seeded generator in the state, dotframe/src/detmath instead of Math.sin/cos/pow/exp.

When done, run bunx tsc --noEmit -p . and node ${CLI} sim --mash 7 --frames 600 --json, fix what fails, and reply with one short sentence in Spanish saying what changed. Bash runs single commands only, from: bunx tsc --noEmit | node ${CLI} sim | ls.

# dotframe core skill
${core}`;

let busy = false;
// Continues numbering after edits from an earlier session, so their undo copies are not overwritten.
let edits = (await Array.fromAsync(new Bun.Glob("sim.*.ts").scan(work))).length;
const edit = async (text: string) => {
  if (busy) return send({ status: "Todavia estoy con el cambio anterior." });
  busy = true;
  edits++;
  copyFileSync(join(dir, "sim.ts"), join(work, `sim.${edits}.ts`));
  send({ status: `Muse esta cambiando el juego: "${text}"...` });
  try {
    const run = await runAgent({
      dir,
      model,
      system: editSystem(text),
      prompt: text,
      bashOk: ["bunx tsc --noEmit", `node ${CLI} sim `, "ls"],
      tag: `.play/edit-${edits}`,
      onTool: (name, input) => send({ status: `Muse: ${name} ${String((input as { file_path?: string; command?: string }).file_path ?? (input as { command?: string }).command ?? "").replace(dir, "").slice(0, 60)}` }),
    });
    simJs = await build(join(dir, "sim.ts"));
    version++;
    history.push(text);
    writeFileSync(historyFile, JSON.stringify(history, null, 2));
    const secs = (run.ms / 1000).toFixed(0);
    console.log(`edit ${edits} "${text}": ${secs}s, $${costOf(run).toFixed(3)}`);
    send({ version, done: `${run.summary.trim().split("\n").pop() ?? "Listo"} (${secs}s, $${costOf(run).toFixed(3)})` });
  } catch (e) {
    copyFileSync(join(work, `sim.${edits}.ts`), join(dir, "sim.ts"));
    send({ status: `No pude aplicar el cambio, deje el juego como estaba: ${String(e).slice(0, 120)}` });
  } finally {
    busy = false;
  }
};

Bun.serve({
  port,
  idleTimeout: 0,
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (path === "/main.js") return new Response(shellJs, { headers: { "content-type": "text/javascript" } });
    if (path === "/sim.js") return new Response(simJs, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
    if (path === "/events") {
      let controller: ReadableStreamDefaultController | null = null;
      return new Response(
        new ReadableStream({
          start: (c) => {
            controller = c;
            listeners.add(c);
          },
          cancel: () => {
            if (controller) listeners.delete(controller);
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
      );
    }
    if (path === "/edit" && req.method === "POST") {
      const { text } = (await req.json()) as { text: string };
      void edit(String(text).slice(0, 300));
      return new Response("ok");
    }
    if (path === "/undo" && req.method === "POST") {
      if (busy || edits === 0) return new Response("nothing");
      copyFileSync(join(work, `sim.${edits}.ts`), join(dir, "sim.ts"));
      edits--;
      history.pop();
      writeFileSync(historyFile, JSON.stringify(history, null, 2));
      simJs = await build(join(dir, "sim.ts"));
      version++;
      send({ version, done: "Deshecho" });
      return new Response("ok");
    }
    // Only the game's own assets are served.
    if (path.startsWith("/assets/") && !path.includes("..")) {
      const file = Bun.file(join(dir, path));
      if (await file.exists()) return new Response(file);
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`http://localhost:${port}/  (${slug}: arrows or WASD, Space, Enter, R; type below the game to change it, model ${model})`);
