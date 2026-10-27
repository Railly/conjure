// A new sprite drawn in the style of the game's existing art: Muse Image gets up to three of the game's cutouts as
// style references and draws one new object alone on white paper; the paper's foreground gives SAM a box, and the
// cutout lands next to the others as <name>.png and <name>.hitbox.json.
//   bun spike/v1-sprite.ts <assets dir> <name> "<what to draw>"
import { readdirSync } from "node:fs";
import OpenAI from "openai";
import sharp from "sharp";
import { SAM_USD, samBox, writeSticker } from "./cutout";

const IMAGE_USD = 0.01;
const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const [assetsArg, rawName, what] = process.argv.slice(2);
if (!assetsArg || !rawName || !what) throw new Error('usage: v1-sprite.ts <assets dir> <name> "<what to draw>"');
const assets = `${assetsArg.replace(/\/$/, "")}/`;
const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });
const timings: Record<string, number> = {};
const time = async <T>(label: string, fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  timings[label] = Math.round(performance.now() - t);
  return r;
};

// Style references: the game's existing sprites (cutouts with a hitbox), flattened on white.
const refs = readdirSync(assets)
  .filter((f) => f.endsWith(".hitbox.json"))
  .map((f) => f.replace(/\.hitbox\.json$/, ".png"))
  .filter((f) => f !== `${name}.png`)
  .slice(0, 3);
const images = await Promise.all(
  refs.map(async (f) => ({
    image_url: `data:image/png;base64,${(await sharp(`${assets}${f}`).flatten({ background: "#ffffff" }).resize(512, 512, { fit: "inside" }).png().toBuffer()).toString("base64")}`,
  })),
);

const res = await time("muse-image", async () => {
  const r = await fetch("https://api.meta.ai/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "muse-image-1.0",
      prompt: `The attached images are drawings from one game, by the same hand. Use them only as a style reference. Draw a NEW picture of ${what}, in exactly that style: the same medium, stroke width, texture, colors and level of skill, as if the same person drew it on the same paper. One single object, centered, alone on plain white paper, nothing else, no background, no shadow, no text, no border.`,
      images,
      n: 1,
      reasoning_strength: "low",
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    }),
  });
  if (!r.ok) throw new Error(`images/edits ${r.status}: ${await r.text()}`);
  return (await r.json()) as { data: { b64_json: string }[] };
});
const drawn = await sharp(Buffer.from(res.data[0]!.b64_json, "base64")).removeAlpha().resize(1024, 1024, { fit: "inside" }).png().toBuffer();
const { width: W = 0, height: H = 0 } = await sharp(drawn).metadata();
const rgb = await sharp(drawn).raw().toBuffer();
await Bun.write(`${assets}${name}.source.png`, drawn);

// The drawing's box: pixels that are not paper (white), ignoring a thin frame at the image edge.
const EDGE = 8;
let box = { x1: W, y1: H, x2: -1, y2: -1 };
for (let y = EDGE; y < H - EDGE; y++)
  for (let x = EDGE; x < W - EDGE; x++) {
    const i = (y * W + x) * 3;
    if (Math.min(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) < 200) {
      if (x < box.x1) box.x1 = x;
      if (x > box.x2) box.x2 = x;
      if (y < box.y1) box.y1 = y;
      if (y > box.y2) box.y2 = y;
    }
  }
if (box.x2 < 0) box = { x1: 0, y1: 0, x2: W - 1, y2: H - 1 };
const dataUrl = `data:image/png;base64,${drawn.toString("base64")}`;
const alpha = await time("sam", () => samBox(client, dataUrl, W, H, box));
if (!alpha) throw new Error("SAM found nothing in the drawn sprite");
const sticker = await writeSticker(assets, name, rgb, W, H, alpha);
console.log(JSON.stringify({ name, refs, timings_ms: timings, cost_usd: IMAGE_USD + SAM_USD, sticker }));
