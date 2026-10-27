// Spike V1: a tileable material sheet from Muse Image for textured meshes (a cutout's transparent border shows when
// it is tiled over a box). Writes out/<name>-material.png and out/<name>-material-tiled.png (2x2, to eyeball seams).
import OpenAI from "openai";
import sharp from "sharp";

const OUT = new URL("./out/", import.meta.url).pathname;
const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });

const name = process.argv[2] || "crate";
const prompt =
  process.argv[3] ||
  "Seamless tileable texture of hand-painted watercolor wooden planks, matching a watercolor game art style, flat top-down view filling the whole frame edge to edge, even lighting, no border, no frame, no objects, no text.";

const t = performance.now();
const gen = await client.images.generate({
  model: "muse-image-1.0",
  prompt,
  n: 1,
  size: "1024x1024",
  // @ts-expect-error Meta extensions
  reasoning_strength: "low",
  tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
});
const ms = Math.round(performance.now() - t);
const png = await sharp(Buffer.from(gen.data?.[0]?.b64_json ?? "", "base64")).resize(512, 512).png().toBuffer();
await Bun.write(`${OUT}${name}-material.png`, png);
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#000" } })
  .composite([0, 1, 2, 3].map((k) => ({ input: png, left: (k % 2) * 512, top: (k >> 1) * 512 })))
  .png()
  .toFile(`${OUT}${name}-material-tiled.png`);
console.log(JSON.stringify({ name, ms, cost_usd: 0.01 }));
