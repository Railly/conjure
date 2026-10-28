// One build as a process: reads the concept and drawing names from <dir>/job.json, runs buildGame, and prints every
// event as one JSON line on stdout (the remote runner streams them back). Used inside Vercel Sandboxes.
//   bun studio/build-cli.ts <game dir>
import { join } from "node:path";
import { buildGame } from "./build";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build-cli.ts <game dir>");
const job = (await Bun.file(join(dir, "job.json")).json()) as { slug: string; concept: never; drawings: string[] };
const r = await buildGame({ dir, slug: job.slug, concept: job.concept, drawings: job.drawings, emit: (e) => console.log(JSON.stringify({ ...e, t: Date.now() })) });
console.log(JSON.stringify({ stage: "result", message: r.verdict, data: r, t: Date.now() }));
