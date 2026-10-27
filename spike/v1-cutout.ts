// Spike V1: Muse Image sheet -> SAM masks -> bordered cutouts, with time and cost per step.
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import OpenAI from "openai";
import sharp from "sharp";
import { partsFromMask } from "./hitbox";
import { checkCutout, foregroundOf, paperColor } from "./quality";

// CONJURE_OUT: directory for the sheet, cutouts, hitboxes and report (default spike/out/).
const OUT = process.env.CONJURE_OUT ? `${process.env.CONJURE_OUT.replace(/\/$/, "")}/` : new URL("./out/", import.meta.url).pathname;
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
interface Segment {
  alpha: Buffer;
  box: { x1: number; y1: number; x2: number; y2: number };
  confidence?: number;
}

// One SAM call; prompt is a noun phrase or box tokens. Returns the first object's mask on the full frame.
async function sam(prompt: string, label: string): Promise<Segment | null> {
  samCalls++;
  const records = await time(label, async () => {
    const stream = await client.responses.create({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl, detail: "auto" },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit" },
    });
    return (await parseImageStream(stream as never).finalResult).records;
  });
  const masks = recordsOfKind(records, "mask");
  if (!masks.length) return null;
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
  return { alpha, box: { x1: bounds.left, y1: bounds.top, x2: bounds.right, y2: bounds.bottom }, confidence };
}

// Foreground over the whole sheet, for following an object past the edge of SAM's box.
const sheetForeground = foregroundOf(sheetRgb, paper).foreground;

// The connected foreground region that touches the mask: the object as the paper sees it.
function componentBox(alpha: Buffer): { x1: number; y1: number; x2: number; y2: number } {
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++)
    if (alpha[i] && sheetForeground[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  let x1 = W;
  let y1 = H;
  let x2 = -1;
  let y2 = -1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W;
    const y = (i - x) / W;
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
      if (j >= 0 && !seen[j] && sheetForeground[j]) {
        seen[j] = 1;
        queue.push(j);
      }
  }
  return { x1, y1, x2: x2 + 1, y2: y2 + 1 };
}

// Missed foreground of a full-frame mask inside a window, the same window for every candidate.
function missedIn(alpha: Buffer, win: { x1: number; y1: number; x2: number; y2: number }): number {
  let fg = 0;
  let missed = 0;
  for (let y = win.y1; y < win.y2; y++)
    for (let x = win.x1; x < win.x2; x++) {
      const i = y * W + x;
      if (!sheetForeground[i]) continue;
      fg++;
      if (!alpha[i]) missed++;
    }
  return fg ? missed / fg : 0;
}

const report: Record<string, unknown>[] = [];
for (const name of objects) {
  const byText = await sam(name, `sam:${name}`);
  if (!byText) {
    report.push({ name, found: 0 });
    continue;
  }
  // Second opinion: SAM again with a box around the paper's own region for this object. Keep whichever mask misses
  // less of that region; the text mask wins ties.
  const region = componentBox(byText.alpha);
  const boxPrompt = `<0f>1<|box;x1=${region.x1};y1=${region.y1};x2=${region.x2 - 1};y2=${region.y2 - 1};w=${W};h=${H}|>`;
  const byBox = await sam(boxPrompt, `sam-box:${name}`);
  const win = {
    x1: Math.min(region.x1, byText.box.x1, byBox?.box.x1 ?? W),
    y1: Math.min(region.y1, byText.box.y1, byBox?.box.y1 ?? H),
    x2: Math.max(region.x2, byText.box.x2, byBox?.box.x2 ?? 0),
    y2: Math.max(region.y2, byText.box.y2, byBox?.box.y2 ?? 0),
  };
  const missedText = missedIn(byText.alpha, win);
  const missedBox = byBox ? missedIn(byBox.alpha, win) : 1;
  const chosen = byBox && missedBox < missedText ? byBox : byText;
  const { alpha, confidence } = chosen;
  const b = chosen.box;
  const picked = { prompt: chosen === byText ? "text" : "box", missedText: +missedText.toFixed(3), missedBox: +missedBox.toFixed(3) };

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
  report.push({ name, confidence, box: b, picked, quality, parts: parts.length });
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
