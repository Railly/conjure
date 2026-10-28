// Builds the sandbox snapshot every remote build starts from: Bun, agent-browser with Chromium, conjure's
// dependencies, and a game template with dotframe installed. Prints CONJURE_SNAPSHOT_ID for .env. Rebuild only when
// a dependency changes; code is uploaded fresh on every build.
//   bun --env-file=.env sandbox/snapshot.ts
import { Sandbox } from "@vercel/sandbox";
import { DOTFRAME_REF } from "../studio/build";
import { codeTarball, credentials, sh } from "./remote";

const HOME = "/vercel/sandbox";
const APP = `${HOME}/conjure`;
const t0 = performance.now();
const lap = (s: string) => console.log(`${((performance.now() - t0) / 1000).toFixed(0)}s ${s}`);

const sandbox = await Sandbox.create({ ...credentials(), image: "vercel/sandbox/node:24", resources: { vcpus: 4 }, timeout: 30 * 60_000 });
lap(`sandbox ${sandbox.name}`);
try {
  await sandbox.writeFiles([{ path: `${HOME}/code.tgz`, content: await codeTarball() }]);
  await Promise.all([
    sh(sandbox, "curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1").then(() => lap("bun")),
    // The image is Ubuntu: --with-deps installs Chromium's libraries with apt.
    sh(sandbox, "npm i -g agent-browser >/dev/null 2>&1 && agent-browser install --with-deps >/dev/null 2>&1").then(() => lap("agent-browser")),
  ]);
  await sh(sandbox, `mkdir -p ${APP} && cd ${APP} && tar -xzf ${HOME}/code.tgz && bun install >/dev/null 2>&1`);
  lap("conjure deps");
  const tpl = `${APP}/games/_template`;
  const pkg = { name: "game", private: true, type: "module", dependencies: { dotframe: DOTFRAME_REF }, devDependencies: { "@types/bun": "^1.3.0", "@webgpu/types": "^0.1.74", typescript: "^5.9.0" } };
  await sandbox.writeFiles([
    { path: `${tpl}/package.json`, content: JSON.stringify(pkg, null, 2) },
    { path: `${tpl}/tsconfig.json`, content: await Bun.file(new URL("../make/game-tsconfig.json", import.meta.url)).text() },
    { path: `${tpl}/dotframe.json`, content: JSON.stringify({ name: "game", sim: "sim.ts" }) },
  ]);
  await sh(sandbox, `cd ${tpl} && bun install >/dev/null 2>&1 && mkdir -p assets/fonts replays && cp node_modules/dotframe/assets/fonts/archivo-black.* node_modules/dotframe/assets/fonts/bangers.* assets/fonts/`);
  lap("game template");
  // The check that matters before trusting the snapshot: a dotframe frame renders in this sandbox's browser.
  console.log((await sh(sandbox, `cd ${tpl} && agent-browser --version && node node_modules/dotframe/cli/bin.cjs doctor --json | head -c 300`)).slice(0, 400));
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  lap("snapshot");
  console.log(`CONJURE_SNAPSHOT_ID=${snapshot.snapshotId}`);
} catch (e) {
  await sandbox.stop().catch(() => {});
  throw e;
}
