// V2: one prompt in, one playable dotframe game out. Muse Wonder drives a Claude Agent SDK loop inside a fresh game
// directory: it writes a spec, makes the art with the cutout pipeline, writes sim.ts, and checks its own work with the
// dotframe CLI. Afterwards this script re-runs the checks itself, so the verdict never rests on the agent's word.
//   bun --env-file=.env make/make.ts "<game idea>" [--slug name]
//
// The agent runs unattended, so every Write, Edit and Bash call goes through guard(): files only inside the game
// directory (reads too, so .env and the rest of the machine stay out of reach), and Bash only for the dotframe CLI,
// the cutout pipeline, tsc, and listing.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CanUseTool, query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DOTFRAME_REF =
	"github:crafter-games/dotframe#a1cdfb193838e7821a98068dae159d163afce51a";
// Muse Wonder list prices per million tokens (dev.meta.ai/docs/pricing-rate-limits).
const PRICE = { input: 4, cachedInput: 0.2, output: 20 };

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const idea = process.argv[2];
if (!idea) throw new Error('usage: make.ts "<game idea>" [--slug name]');
const slugArg = process.argv.indexOf("--slug");
const slug =
	slugArg > 0
		? process.argv[slugArg + 1]
		: idea
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 40);
const dir = `${ROOT}/games/${slug}`;
// --verify-only re-runs the independent checks on an existing game without calling the agent.
const verifyOnly = process.argv.includes("--verify-only");

const sh = async (cmd: string[], cwd = dir) => {
	const p = Bun.spawn(cmd, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [out, err] = await Promise.all([
		new Response(p.stdout).text(),
		new Response(p.stderr).text(),
	]);
	return { code: await p.exited, out, err };
};

// Scaffold: an empty game that only knows its engine.
if (!verifyOnly) {
	mkdirSync(`${dir}/assets`, { recursive: true });
	mkdirSync(`${dir}/replays`, { recursive: true });
	writeFileSync(
		`${dir}/package.json`,
		JSON.stringify(
			{
				name: slug,
				private: true,
				type: "module",
				dependencies: { dotframe: DOTFRAME_REF },
				devDependencies: {
					"@types/bun": "^1.3.0",
					"@webgpu/types": "^0.1.74",
					typescript: "^5.9.0",
				},
			},
			null,
			2,
		),
	);
	writeFileSync(
		`${dir}/tsconfig.json`,
		await Bun.file(`${ROOT}/make/game-tsconfig.json`).text(),
	);
	writeFileSync(
		`${dir}/dotframe.json`,
		JSON.stringify({ name: slug, sim: "sim.ts" }, null, 2),
	);
	writeFileSync(`${dir}/IDEA.md`, `${idea}\n`);
	// Public registry on purpose: a machine-level registry mirror must not leak into the game's lockfile.
	const install = await sh(["env", "NPM_CONFIG_REGISTRY=https://registry.npmjs.org", "BUN_CONFIG_REGISTRY=https://registry.npmjs.org", "bun", "install", "--no-cache"], dir);
	if (install.code !== 0) throw new Error(`bun install failed: ${install.err}`);
}
const CLI = `${dir}/node_modules/dotframe/cli/bin.cjs`;
const df = (args: string[]) => sh(["node", CLI, ...args]);
const core = (await df(["skills", "get", "core"])).out;
const design = (await df(["skills", "get", "game-design", "--full"])).out;
const CUTOUT = `CONJURE_OUT=assets bun ${ROOT}/spike/v1-cutout.ts `;
// Draw2D draws text only with a baked SDF font: give every game the engine's bundled ones.
if (!verifyOnly) {
	mkdirSync(`${dir}/assets/fonts`, { recursive: true });
	for (const f of ["archivo-black.png", "archivo-black.json", "bangers.png", "bangers.json"])
		writeFileSync(`${dir}/assets/fonts/${f}`, new Uint8Array(await Bun.file(`${dir}/node_modules/dotframe/assets/fonts/${f}`).arrayBuffer()));
}

const inside = (path: unknown) =>
	typeof path === "string" && resolve(dir, path).startsWith(`${dir}/`);
// One command, no chaining, redirection or substitution. Quotes are allowed for the cutout's sheet prompt.
const plain = (cmd: string) => !/[;&|`<>]|\$\(/.test(cmd);
const BASH_OK = [
	`node ${CLI} `,
	CUTOUT,
	"bunx tsc --noEmit",
	"ls",
	"cat assets/report.json",
];
const guard: CanUseTool = async (tool, input) => {
	if (
		tool === "Read" ||
		tool === "Write" ||
		tool === "Edit" ||
		tool === "Glob" ||
		tool === "Grep"
	) {
		const path = input.file_path ?? input.path ?? dir;
		return inside(path) || resolve(dir, String(path)) === dir
			? { behavior: "allow", updatedInput: input }
			: {
					behavior: "deny",
					message: `Only files inside ${dir} are available.`,
				};
	}
	if (tool === "Bash") {
		const cmd = String(input.command ?? "").trim();
		if (
			plain(cmd) &&
			BASH_OK.some((p) => cmd === p.trim() || cmd.startsWith(p))
		)
			return { behavior: "allow", updatedInput: input };
		return {
			behavior: "deny",
			message: `Bash runs only single commands starting with: ${BASH_OK.join(" | ")}`,
		};
	}
	return { behavior: "deny", message: `${tool} is not available.` };
};

const system = `You build one complete, playable 2D game with the dotframe engine, from the player's idea, in ${dir}. Work alone until it is done; nobody will answer questions.

# Steps
1. Write SPEC.md: the game in a few lines (goal, controls, how you win and lose, what is on screen) and the list of art objects, 3 to 6 short concrete nouns (they become sprites).
2. Make the art. One command paints a watercolor sheet and cuts each object out:
   ${CUTOUT}"<sheet prompt>" "<noun1,noun2,...>"
   The sheet prompt describes one sheet of hand-painted game sprites on plain white paper, evenly spaced, not touching, one of each object, flat front view, no shadows, no text. It writes assets/<noun>.png (cutout with a white sticker border, transparent around it) and assets/<noun>.hitbox.json ({width, height, parts}: collision boxes in pixels, relative to the image center, y up). Then run "cat assets/report.json": every object needs a quality.missed well under 0.1, else run it again with clearer nouns.
3. Write sim.ts (the Sim contract below) and any modules it imports. Load images with platform.load + platform.image (only when platform.image exists; headless runs have none) and read PNG width and height from the header bytes (big-endian uint32 at offsets 16 and 20). Load hitboxes with platform.load + JSON.parse in every run, headless included, since physics needs them.
4. Text: Draw2D draws text only with a registered font. assets/fonts has archivo-black and bangers (atlas .png plus metrics .json). In create(), when platform.draw and platform.image exist: platform.draw.addFont(["archivo black", "sans-serif"], await platform.image(await platform.load("assets/fonts/archivo-black.png"), true), new TextDecoder().decode(await platform.load("assets/fonts/archivo-black.json"))), then setFont('20px "Archivo Black"'). Latin-1 characters only (no emoji).
5. Physics: dotframe/src/physics (Body with parts from the hitbox JSON scaled to the sprite's drawn size, stepBodies, Body.pushable, FIXED_STEP). y is up in physics; flip it when drawing.
6. Verify, and fix until all pass:
   - node ${CLI} doctor --json: no check with ok false unless warn is true.
   - node ${CLI} sim --mash 7 --frames 1800 --json and read state: the game must react to input and nothing may leave the world.
   - node ${CLI} snap --frame 300 --mash 7 --out ${dir}/snap-300.png --json, then Read the PNG and look at it. data.warnings must be absent.
   - bunx tsc --noEmit -p .
   - Record a golden replay: node ${CLI} replay record replays/mash.json --mash 7 --frames 1800 --json
7. Finish with a short summary: what the game is, its controls, and what you verified.

# Rules
- Bash runs single commands only, from this list: ${BASH_OK.join(" | ")}. Write files with the Write and Edit tools.
- Everything in one plain state object; all changes in step; render only reads. No Math.random, no Date: use a seeded generator saved in the state. Use dotframe/src/detmath instead of Math.sin/cos/pow/exp.
- Draw2D uses setters: setFillStyle, setStrokeStyle, setLineWidth, setFont (not property assignment).
- Use the sprites you made; draw the world behind them with Draw2D shapes.
- Keep it small and finished: one screen or a simple scrolling level, a score or a goal, a game over and a restart.

# dotframe core skill
${core}

# dotframe game-design skill
${design}`;

let agent = {
	ms: 0,
	turns: 0,
	usage: { input: 0, cachedInput: 0, output: 0 },
	summary: "",
};
if (verifyOnly) {
	try {
		agent = await Bun.file(`${dir}/agent.json`).json();
	} catch {}
} else {
	const started = performance.now();
	const usage = { input: 0, cachedInput: 0, output: 0 };
	let summary = "";
	let turns = 0;
	const log: string[] = [];
	for await (const m of query({
		prompt: `The player's idea: ${idea}`,
		options: {
			model: "muse-wonder-1.0",
			cwd: dir,
			systemPrompt: system,
			allowedTools: [],
			canUseTool: guard,
			permissionMode: "default",
			settingSources: [],
			env: {
				...process.env,
				ANTHROPIC_BASE_URL: "https://api.meta.ai",
				ANTHROPIC_AUTH_TOKEN: apiKey,
				ANTHROPIC_MODEL: "muse-wonder-1.0",
				ANTHROPIC_DEFAULT_OPUS_MODEL: "muse-wonder-1.0",
				ANTHROPIC_DEFAULT_SONNET_MODEL: "muse-spark-1.3",
				ANTHROPIC_DEFAULT_HAIKU_MODEL: "muse-spark-1.3",
				CLAUDE_CODE_SUBAGENT_MODEL: "muse-spark-1.3",
			},
		},
	})) {
		if (m.type === "assistant") {
			turns++;
			for (const c of m.message.content) {
				if (c.type === "text") log.push(`text: ${c.text}`);
				if (c.type === "tool_use")
					log.push(`tool ${c.name}: ${JSON.stringify(c.input).slice(0, 400)}`);
			}
			process.stdout.write(".");
		} else if (m.type === "result") {
			summary = m.subtype === "success" ? m.result : "";
			usage.input =
				m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0);
			usage.cachedInput = m.usage.cache_read_input_tokens ?? 0;
			usage.output = m.usage.output_tokens;
			log.push(`result ${m.subtype}`);
		}
	}
	const agentMs = Math.round(performance.now() - started);
	writeFileSync(`${dir}/agent.log`, `${log.join("\n")}\n`);
	writeFileSync(
		`${dir}/agent.json`,
		JSON.stringify({ ms: agentMs, turns, usage, summary }, null, 2),
	);
	agent = { ms: agentMs, turns, usage, summary };
}

// Independent checks.
const json = async (args: string[]) => {
	try {
		return JSON.parse((await df(args)).out);
	} catch {
		return { ok: false };
	}
};
const doctor = await json(["doctor", "--json"]);
const hard = (doctor.data?.checks ?? [])
	.filter((c: { ok: boolean; warn?: boolean }) => !c.ok && !c.warn)
	.map((c: { check: string }) => c.check);
const mash = await json(["sim", "--mash", "7", "--frames", "1800", "--json"]);
const idle = await json(["sim", "--frames", "1800", "--json"]);
const snap = await json([
	"snap",
	"--frame",
	"300",
	"--mash",
	"7",
	"--out",
	`${dir}/verify-300.png`,
	"--json",
]);
const replay = await json(["replay", "verify", "replays/mash.json", "--json"]);
const tsc = await sh(["bunx", "tsc", "--noEmit", "-p", "."]);
const { usage } = agent;
const cost =
	(usage.input * PRICE.input +
		usage.cachedInput * PRICE.cachedInput +
		usage.output * PRICE.output) /
	1e6;
let artCost = 0;
try {
	artCost = (await Bun.file(`${dir}/assets/report.json`).json()).cost_usd ?? 0;
} catch {}

const result = {
	idea,
	slug,
	agent: {
		ms: agent.ms,
		turns: agent.turns,
		usage,
		cost_usd: +cost.toFixed(4),
	},
	art_cost_usd: artCost,
	checks: {
		doctor_hard_failures: hard,
		sim_ok: mash.ok === true,
		// Input matters when mashing and idling end in different states.
		reacts_to_input:
			mash.ok === true &&
			idle.ok === true &&
			mash.data.checksum !== idle.data.checksum,
		snap_ok: snap.ok === true,
		snap_warnings: snap.data?.warnings ?? [],
		replay_ok: replay.ok === true,
		tsc_ok: tsc.code === 0,
	},
	state_after_mash: mash.data?.state,
	summary: agent.summary,
};
writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2));
console.log(`\n${JSON.stringify(result, null, 2)}`);
