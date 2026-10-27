// Three game concepts from an idea and/or the player's drawings, each a different genre with its own core mechanic,
// so the player chooses a game instead of getting the same platformer every time. Muse Wonder with structured output.
import OpenAI from "openai";
import sharp from "sharp";

export interface Concept {
	title: string;
	genre: string;
	pitch: string;
	core_mechanic: string;
	controls: string;
	win: string;
	lose: string;
	// How each drawing (or art object) takes part.
	roles: { object: string; role: string }[];
	// What makes it feel alive: effects, motion, feedback.
	juice: string;
	palette: string;
}

// What dotframe can do today, so concepts stay buildable in one pass.
const CAPABILITIES = `Engine: dotframe, deterministic 2D (Draw2D: shapes, images, SDF text) and 3D (meshes, lights, shadows, sprites as alpha-cut cards) at 60 Hz, keyboard input (arrows/WASD, space, enter), one player, one screen or a scrolling camera, AABB physics with compound bodies (gravity can be off for top-down), particles and screen effects drawn by the game. No network, no mouse aiming, no text input in game.`;

const GENRES =
	"physics puzzle, top-down arena or twin-stick-feel (keyboard), endless runner, rhythm or timing, shoot 'em up, racing, tower or base defense, sokoban-like grid puzzle, stealth, falling-block or match puzzle, breakout-like, sports, survival, 3D explorer or 3D arena";

export async function proposeConcepts(opts: {
	idea: string;
	drawings: { name: string; png: string }[];
	model?: string;
	effort?: "low" | "medium" | "high";
}): Promise<{ concepts: Concept[]; ms: number; usage: unknown }> {
	const client = new OpenAI({
		baseURL: "https://api.meta.ai/v1",
		apiKey: process.env.MODEL_API_KEY,
	});
	const images = await Promise.all(
		opts.drawings.slice(0, 6).map(async (d) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:image/png;base64,${(await sharp(d.png).flatten({ background: "#ffffff" }).resize(384, 384, { fit: "inside" }).png().toBuffer()).toString("base64")}`,
			},
		})),
	);
	const text = `You are a world-class game designer pitching three small games a player can build in one click and play in the browser.
${opts.idea ? `The player's idea: "${opts.idea}".` : "No idea given."}
${opts.drawings.length ? `The player drew these objects by hand (images attached, in this order): ${opts.drawings.map((d) => d.name).join(", ")}. Every concept must use every drawing, in a role that fits what it is, and the drawings must stay the stars.` : "The art will be painted to fit the concept; list 3 to 6 concrete objects in roles."}

${CAPABILITIES}

Rules:
- Three concepts, three DIFFERENT genres, from: ${GENRES}. At most one may be a platformer.
- Each has one surprising core mechanic that is fun in the first 10 seconds and gets harder over a minute. Not "collect items and avoid enemies".
- Small enough to build and finish in one pass: one screen or one scrolling stretch, a minute or two of play, a clear win and a clear loss.
- juice: the concrete effects that make it feel polished (particles on what events, screen shake when, squash and stretch, trails, combo text, title screen idea).
- Write in Spanish with correct spelling and every accent (física, está, árbol) for title, pitch, controls, win, lose; keep the genre in English. Pitch: two sentences at most.`;
	const t = performance.now();
	// Structured output can come back filled with placeholders ("A", "B", one concept): check it, and ask again with
	// more reasoning once before giving up.
	const usable = (cs: Concept[]) =>
		cs.length === 3 &&
		cs.every(
			(c) =>
				c.title.length > 3 &&
				c.pitch.length > 40 &&
				c.core_mechanic.length > 40,
		);
	let usage: unknown = null;
	for (const effort of [opts.effort ?? "low", "medium"] as const) {
		const res = await client.chat.completions.create({
			model: opts.model ?? "muse-wonder-1.0",
			reasoning_effort: effort,
			messages: [
				{ role: "user", content: [{ type: "text", text }, ...images] },
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "concepts",
					strict: true,
					schema: {
						type: "object",
						additionalProperties: false,
						required: ["concepts"],
						properties: {
							concepts: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									required: [
										"title",
										"genre",
										"pitch",
										"core_mechanic",
										"controls",
										"win",
										"lose",
										"roles",
										"juice",
										"palette",
									],
									properties: {
										title: { type: "string" },
										genre: { type: "string" },
										pitch: { type: "string" },
										core_mechanic: { type: "string" },
										controls: { type: "string" },
										win: { type: "string" },
										lose: { type: "string" },
										roles: {
											type: "array",
											items: {
												type: "object",
												additionalProperties: false,
												required: ["object", "role"],
												properties: {
													object: { type: "string" },
													role: { type: "string" },
												},
											},
										},
										juice: { type: "string" },
										palette: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
		});
		usage = res.usage;
		let concepts: Concept[] = [];
		try {
			concepts = (
				JSON.parse(res.choices[0]?.message?.content ?? '{"concepts":[]}') as {
					concepts: Concept[];
				}
			).concepts;
		} catch {}
		if (usable(concepts))
			return { concepts, ms: Math.round(performance.now() - t), usage };
	}
	throw new Error("Muse Wonder did not return three usable concepts");
}
