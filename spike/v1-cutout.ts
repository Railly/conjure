// Spike V1: Muse Image sheet -> SAM masks -> bordered cutouts, with time and cost per step.
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import OpenAI from "openai";
import sharp from "sharp";
import { partsFromMask } from "./hitbox";
import { checkCutout, paperColor } from "./quality";

const OUT = new URL("./out/", import.meta.url).pathname;
const IMAGE_USD = 0.01;
const SAM_USD = 2.5 / 1000;

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });

const prompt =
  process.argv[2] ||
  "A sheet of hand-painted watercolor game sprites on plain white paper, evenly spaced, not touching: a red fox, a pine tree, a mossy rock, a wooden crate. Flat front view, no shadows, no text.";
const objects = (process.argv[3] || "fox,tree,rock,crate").split(",");
// --reuse keeps out/sheet.png and only re-runs SAM and the cutout steps.
const reuse = process.argv.includes("--reuse");
// Horizontal bands per hitbox: the collision shape's vertical resolution.
const BANDS = 8;

const timings: Record<string, number> = {};
const time = async <T>(label: string, fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  timings[label] = Math.round(performance.now() - t);
  return r;
};

let sheetPng: Buffer;
if (reuse) sheetPng = Buffer.from(await Bun.file(`${OUT}sheet.png`).arrayBuffer());
else {
  const gen = await time("muse-image", () =>
    client.images.generate({
      model: "muse-image-1.0",
      prompt,
      n: 1,
      // @ts-expect-error Meta extensions
      reasoning_strength: "low",
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    }),
  );
  sheetPng = await sharp(Buffer.from(gen.data?.[0]?.b64_json ?? "", "base64")).png().toBuffer();
  await Bun.write(`${OUT}sheet.png`, sheetPng);
}
const { width: W = 0, height: H = 0 } = await sharp(sheetPng).metadata();
const sheetRgb = await sharp(sheetPng).removeAlpha().raw().toBuffer();
const paper = paperColor(sheetRgb, W, H, 24);
const dataUrl = `data:image/png;base64,${sheetPng.toString("base64")}`;

let samCalls = 0;
const report: Record<string, unknown>[] = [];
for (const name of objects) {
  samCalls++;
  const events = await time(`sam:${name}`, async () => {
    const stream = await client.responses.create({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: name },
            { type: "input_image", image_url: dataUrl, detail: "auto" },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit" },
    });
    return (await parseImageStream(stream as never).finalResult).records;
  });
  const masks = recordsOfKind(events, "mask");
  if (!masks.length) {
    report.push({ name, found: 0 });
    continue;
  }
  const { mask, bounds, confidence } = masks[0];
  const raster = decodeMaskToRaster(mask);
  const bw = bounds.right - bounds.left;
  const bh = bounds.bottom - bounds.top;
  // Raster covers the half-open bounds; nearest-sample it onto the full frame.
  const alpha = Buffer.alloc(W * H);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const mx = Math.floor((x * mask.width) / bw);
      const my = Math.floor((y * mask.height) / bh);
      if (raster[my * mask.width + mx]) alpha[(bounds.top + y) * W + bounds.left + x] = 255;
    }
  const b = { x1: bounds.left, y1: bounds.top, x2: bounds.right, y2: bounds.bottom };

  const pad = 16;
  const left = Math.max(0, b.x1 - pad);
  const top = Math.max(0, b.y1 - pad);
  const cw = Math.min(W, b.x2 + pad) - left;
  const ch = Math.min(H, b.y2 + pad) - top;
  const cutAlpha = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) cutAlpha[y * cw + x] = alpha[(top + y) * W + left + x];
  // Sticker border: dilate the mask by a disc of radius R.
  const R = 8;
  const border = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      if (!cutAlpha[y * cw + x]) continue;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (dx * dx + dy * dy <= R * R && nx >= 0 && ny >= 0 && nx < cw && ny < ch) border[ny * cw + nx] = 1;
        }
    }
  const { data: rgb, info } = await sharp(sheetPng)
    .extract({ left, top, width: cw, height: ch })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected 3 channels, got ${info.channels}`);
  const out = Buffer.alloc(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) {
    const inside = cutAlpha[i] > 0;
    const edge = border[i] > 0;
    out[i * 4] = inside ? rgb[i * 3] : 255;
    out[i * 4 + 1] = inside ? rgb[i * 3 + 1] : 255;
    out[i * 4 + 2] = inside ? rgb[i * 3 + 2] : 255;
    out[i * 4 + 3] = inside || edge ? 255 : 0;
  }
  await sharp(out, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(`${OUT}${name}.png`);
  const { quality, foreground } = checkCutout(rgb, cutAlpha, paper);
  // Review overlay: mask kept as is, foreground SAM missed in blue, mask the estimate calls paper in red.
  const overlay = Buffer.alloc(cw * ch * 3);
  for (let i = 0; i < cw * ch; i++) {
    const k = cutAlpha[i] > 0;
    const f = foreground[i] > 0;
    const c = f && !k ? [40, 90, 255] : k && !f ? [255, 50, 50] : [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    const dim = k || f ? 1 : 0.35;
    overlay[i * 3] = c[0] * dim;
    overlay[i * 3 + 1] = c[1] * dim;
    overlay[i * 3 + 2] = c[2] * dim;
  }
  await sharp(overlay, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(`${OUT}${name}.check.png`);
  const parts = partsFromMask(Uint8Array.from(out.filter((_, i) => i % 4 === 3), (a) => (a ? 1 : 0)), cw, ch, BANDS);
  await Bun.write(`${OUT}${name}.hitbox.json`, JSON.stringify({ width: cw, height: ch, parts }));
  report.push({ name, found: masks.length, confidence, box: b, mask: [mask.height, mask.width], quality, parts: parts.length });
}

const result = {
  sheet: { width: W, height: H },
  timings_ms: timings,
  cost_usd: +((reuse ? 0 : IMAGE_USD) + samCalls * SAM_USD).toFixed(4),
  paper,
  objects: report,
};
await Bun.write(`${OUT}report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
