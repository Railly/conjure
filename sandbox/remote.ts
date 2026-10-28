// Builds games in Vercel Sandboxes (team crafter-station), so several builds run at once, each with its own browser
// for snaps, isolated from this machine. The snapshot holds the toolchain; every build uploads the current code, so
// a fix lands without a new snapshot (as in Makeables' agent sandbox).
//
// Credentials: VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID in .env (an access token scoped to crafter-station).
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import type { Concept } from "../studio/concepts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HOME = "/vercel/sandbox";
const APP = `${HOME}/conjure`;
// A build is a few minutes; the cap keeps a stuck one from billing for hours.
const BUILD_TIMEOUT_MS = 20 * 60_000;

export const credentials = () => {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  if (!token || !teamId || !projectId) throw new Error("VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID must be set (crafter-station)");
  return { token, teamId, projectId };
};

export const sh = async (sandbox: Sandbox, cmd: string, env: Record<string, string> = {}) => {
  const r = await sandbox.runCommand({ cmd: "bash", args: ["-lc", `export PATH=$HOME/.bun/bin:$(npm prefix -g)/bin:$PATH; ${cmd}`], env });
  if (r.exitCode) throw new Error(`${cmd} exited ${r.exitCode}: ${(await r.output("both")).slice(-1500)}`);
  return r.stdout();
};

// The code a build needs, as a tarball: everything but games, the web app, dependencies and secrets.
export async function codeTarball(): Promise<Uint8Array> {
  const p = Bun.spawn(["tar", "-cz", "--exclude=./games", "--exclude=./web", "--exclude=*/node_modules", "--exclude=./node_modules", "--exclude=./.env", "--exclude=./.git", "--exclude=./spike/out", "--exclude=./spike/photo", "-f", "-", "."], { cwd: ROOT, stdout: "pipe" });
  const buf = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  if ((await p.exited) !== 0) throw new Error("tar failed");
  return buf;
}

export interface RemoteBuild {
  verdict: string;
  cost: number;
  ms: number;
  dir: string;
  bootMs: number;
}

// One build in a fresh sandbox. Events stream to emit as they happen; the finished game is copied to localDir.
export async function buildRemote(opts: {
  slug: string;
  localDir: string;
  concept: Concept;
  drawings: string[];
  code: Uint8Array;
  emit: (e: { stage: string; message: string; data?: unknown }) => void;
  signal?: AbortSignal;
}): Promise<RemoteBuild> {
  const snapshotId = process.env.CONJURE_SNAPSHOT_ID?.trim();
  if (!snapshotId) throw new Error("CONJURE_SNAPSHOT_ID is not set: run bun sandbox/snapshot.ts");
  const t0 = performance.now();
  const sandbox = await Sandbox.create({ ...credentials(), source: { type: "snapshot", snapshotId }, resources: { vcpus: 4 }, timeout: BUILD_TIMEOUT_MS });
  const stop = () => sandbox.stop().catch(() => {});
  opts.signal?.addEventListener("abort", stop);
  try {
    const game = `${APP}/games/${opts.slug}`;
    const assets = readdirSync(join(opts.localDir, "assets")).filter((f) => f.endsWith(".png") || f.endsWith(".json"));
    await sandbox.writeFiles([
      { path: `${HOME}/code.tgz`, content: opts.code },
      ...(await Promise.all(assets.map(async (f) => ({ path: `${game}/assets/${f}`, content: new Uint8Array(await Bun.file(join(opts.localDir, "assets", f)).arrayBuffer()) })))),
      { path: `${game}/job.json`, content: JSON.stringify({ slug: opts.slug, concept: opts.concept, drawings: opts.drawings }) },
    ]);
    // Fresh code over the snapshot's; the game reuses the snapshot's installed dotframe.
    await sh(sandbox, `cd ${APP} && tar -xzf ${HOME}/code.tgz && cp -r ${APP}/games/_template/. ${game}/ && cp -r ${APP}/games/_template/assets/fonts ${game}/assets/`);
    const bootMs = Math.round(performance.now() - t0);
    opts.emit({ stage: "code", message: `Sandbox listo (${(bootMs / 1000).toFixed(0)}s)` });
    const cmd = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `export PATH=$HOME/.bun/bin:$(npm prefix -g)/bin:$PATH; cd ${APP} && bun studio/build-cli.ts ${game}`],
      env: { MODEL_API_KEY: process.env.MODEL_API_KEY ?? "" },
      detached: true,
    });
    let result: { verdict: string; cost: number; ms: number } | null = null;
    let buf = "";
    for await (const line of cmd.logs({ signal: opts.signal })) {
      if (line.stream !== "stdout") continue;
      buf += line.data;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const raw of parts) {
        if (!raw.startsWith("{")) continue;
        try {
          const e = JSON.parse(raw);
          if (e.stage === "result") result = e.data;
          else opts.emit(e);
        } catch {}
      }
    }
    const done = await cmd.wait();
    if (!result) throw new Error(`remote build exited ${done.exitCode}: ${(await done.output("stderr")).slice(-800)}`);
    // Bring the game home: its code, captures, reports and any sprite the agent drew.
    const list = (await sh(sandbox, `cd ${game} && find . -maxdepth 2 -type f \\( -name '*.ts' -o -name '*.json' -o -name '*.png' -o -name '*.log' -o -name '*.md' \\) -not -path './node_modules/*'`)).trim().split("\n").filter(Boolean);
    for (const rel of list) {
      const data = await sandbox.readFileToBuffer({ path: `${game}/${rel.replace(/^\.\//, "")}` });
      if (!data) continue;
      const out = join(opts.localDir, rel);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, data);
    }
    return { ...result, dir: opts.localDir, bootMs };
  } finally {
    opts.signal?.removeEventListener("abort", stop);
    await stop();
  }
}
