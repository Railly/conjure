// One remote build of an existing session's concept, to check the sandbox path end to end.
//   bun --env-file=.env --env-file=.env.local bench/remote-one.ts <source slug> <concept title substring> <new slug>
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildRemote, codeTarball } from "../sandbox/remote";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const [src, match, slug] = process.argv.slice(2);
if (!src || !match || !slug) throw new Error("usage: remote-one.ts <source slug> <concept title substring> <new slug>");
const from = join(ROOT, "games", src);
const dir = join(ROOT, "games", slug);
const concept = ((await Bun.file(join(from, "concepts.json")).json()).concepts as { title: string }[]).find((c) => c.title.includes(match));
if (!concept) throw new Error(`no concept matching ${match}`);
mkdirSync(join(dir, "assets"), { recursive: true });
cpSync(join(from, "assets"), join(dir, "assets"), { recursive: true });
const drawings = readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".hitbox.json")).map((f) => f.replace(".hitbox.json", ""));
const t0 = performance.now();
const r = await buildRemote({ slug, localDir: dir, concept: concept as never, drawings, code: await codeTarball(), emit: (e) => console.log(`${Math.round((performance.now() - t0) / 1000)}s ${e.stage}: ${e.message.slice(0, 100)}`) });
console.log(JSON.stringify({ ...r, total_s: Math.round((performance.now() - t0) / 1000) }));
