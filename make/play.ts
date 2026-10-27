// Play a generated game in the browser: bundles a generic web entry around the game's sim.ts and serves the game
// directory (assets load over HTTP, as in snap). Keys feed a JSON input every game's encode() can read.
//   bun make/play.ts <slug> [--port 5180]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const slug = process.argv[2];
if (!slug) throw new Error("usage: play.ts <slug> [--port 5180]");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 5180;
const dir = `${ROOT}/games/${slug}`;
const engine = `${dir}/node_modules/dotframe/src`;

// Runs the sim at a fixed 60 Hz with keyboard input, the same contract the CLI drives headless.
const entry = `import sim from ${JSON.stringify(`${dir}/sim.ts`)};
import { createDraw2D } from ${JSON.stringify(`${engine}/draw2d`)};
import { Key } from ${JSON.stringify(`${engine}/input`)};
import { loadBytes, run } from ${JSON.stringify(`${engine}/web/run`)};
const STEP = 1 / 60;
await run(sim.window, (p) => {
  const draw = createDraw2D(p.gpu, sim.window.width, sim.window.height);
  const game = sim.create({ gpu: p.gpu, load: loadBytes, headless: false, draw, image: p.gpu.createImage });
  let ready = false;
  game.ready.then(() => {
    game.start(Math.floor(Math.random() * 1e9), { ...sim.options });
    ready = true;
  });
  const keys = () => {
    const d = (k) => p.input.down(k);
    const left = d(Key.Left) || d(Key.A);
    const right = d(Key.Right) || d(Key.D);
    const up = d(Key.Up) || d(Key.W);
    const down = d(Key.Down) || d(Key.S);
    const space = d(Key.Space);
    const enter = d(Key.Enter);
    const r = d(Key.R);
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

const work = join(dir, ".play");
mkdirSync(work, { recursive: true });
writeFileSync(join(work, "entry.js"), entry);
const built = await Bun.build({ entrypoints: [join(work, "entry.js")], target: "browser" });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const bundle = await built.outputs[0].text();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${slug}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000}</style></head><body><script type="module" src="/main.js"></script></body></html>`;

Bun.serve({
  port,
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "content-type": "text/html" } });
    if (path === "/main.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    // Only the game's own assets are served.
    if (path.startsWith("/assets/") && !path.includes("..")) {
      const file = Bun.file(join(dir, path));
      if (await file.exists()) return new Response(file);
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`http://localhost:${port}/  (${slug}: arrows or WASD, Space, Enter, R)`);
