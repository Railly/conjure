// Rebuilds an existing session's concept in a fresh directory, to compare build time and cost across builder versions.
//   bun --env-file=.env bench/rebuild.ts <source slug> <concept title substring> <new slug>
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildGame, scaffold } from "../studio/build";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const [src, match, slug] = process.argv.slice(2);
if (!src || !match || !slug) throw new Error("usage: rebuild.ts <source slug> <concept title substring> <new slug>");
const from = join(ROOT, "games", src);
const dir = join(ROOT, "games", slug);
const concepts = (await Bun.file(join(from, "concepts.json")).json()).concepts as { title: string }[];
const concept = concepts.find((c) => c.title.includes(match));
if (!concept) throw new Error(`no concept matching ${match}`);
mkdirSync(dir, { recursive: true });
const t0 = performance.now();
await scaffold(dir, slug);
const drawings = readdirSync(join(from, "assets")).filter((f) => f.endsWith(".hitbox.json")).map((f) => f.replace(".hitbox.json", ""));
for (const d of drawings) for (const ext of [".png", ".hitbox.json"]) cpSync(join(from, "assets", d + ext), join(dir, "assets", d + ext));
const r = await buildGame({ dir, slug, concept: concept as never, drawings, emit: (e) => console.log(`${Math.round((performance.now() - t0) / 1000)}s ${e.stage}: ${e.message.slice(0, 100)}`) });
console.log(JSON.stringify({ ...r, total_s: Math.round((performance.now() - t0) / 1000) }));
