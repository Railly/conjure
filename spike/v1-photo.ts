// Spike V1b: a phone photo of a hand drawing to game sprites. Muse Spark names each drawn object and boxes it, SAM
// cuts each box out, holes inside an outline are filled (a drawn cat is the whole face, not just its strokes), and
// the paper is flat-fielded to white so shadows and uneven light vanish. Same outputs as v1-cutout:
// <out>/<name>.png, <name>.hitbox.json and report.json.
//   CONJURE_OUT=dir bun spike/v1-photo.ts <photo.jpg>
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import OpenAI from "openai";
import sharp from "sharp";
import { partsFromMask } from "./hitbox";

const OUT = `${(process.env.CONJURE_OUT ?? new URL("./photo/out", import.meta.url).pathname).replace(/\/$/, "")}/`;
const SAM_USD = 2.5 / 1000;
// Horizontal bands per hitbox, as in v1-cutout.
const BANDS = 8;
// Longest side the photo is worked at: phone photos are larger than SAM or the game need.
const MAX_SIDE = 1600;

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const photoPath = process.argv[2];
if (!photoPath) throw new Error("usage: v1-photo.ts <photo>");
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });

const timings: Record<string, number> = {};
const time = async <T>(label: string, fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  timings[label] = Math.round(performance.now() - t);
  return r;
};

const photo = await sharp(photoPath).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside" }).removeAlpha().png().toBuffer();
const { width: W = 0, height: H = 0 } = await sharp(photo).metadata();
const rgb = await sharp(photo).raw().toBuffer();
await Bun.write(`${OUT}photo.png`, photo);
const dataUrl = `data:image/png;base64,${photo.toString("base64")}`;

// 1. Muse Spark: what is drawn, and where.
interface Found {
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const listed = await time("spark", () =>
  client.chat.completions.create({
    model: "muse-spark-1.3",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This photo (${W}x${H} pixels) shows hand-drawn objects on paper. List every separate drawn object, each once. name: one short lowercase English noun, unique across the list. Box: the tight pixel box around all of that drawing's strokes (x1,y1 top-left, x2,y2 bottom-right, in this image's pixels). Ignore the paper, the table, shadows and anything not drawn.`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "drawing",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["objects"],
          properties: {
            objects: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "x1", "y1", "x2", "y2"],
                properties: {
                  name: { type: "string" },
                  x1: { type: "integer" },
                  y1: { type: "integer" },
                  x2: { type: "integer" },
                  y2: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
  }),
);
const found: Found[] = JSON.parse(listed.choices[0]?.message?.content ?? '{"objects":[]}').objects;

// 2. The paper's own light: a heavily blurred copy, so dividing by it turns paper white and keeps strokes.
const SMALL = 48;
const background = await sharp(photo)
  .resize(SMALL, Math.max(1, Math.round((SMALL * H) / W)), { kernel: "cubic" })
  .median(5)
  .resize(W, H, { kernel: "cubic" })
  .blur(8)
  .raw()
  .toBuffer();
const flat = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i++) flat[i] = Math.min(255, Math.round((rgb[i] * 255) / Math.max(1, background[i])));

let samCalls = 0;
async function samBox(o: Found): Promise<Uint8Array | null> {
  samCalls++;
  const x1 = Math.max(0, Math.min(W - 1, o.x1));
  const y1 = Math.max(0, Math.min(H - 1, o.y1));
  const x2 = Math.max(x1, Math.min(W - 1, o.x2));
  const y2 = Math.max(y1, Math.min(H - 1, o.y2));
  const stream = await client.responses.create({
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: `<0f>1<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${W};h=${H}|>` },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
    stream: true,
    metadata: { mask_encoding: "one_bit" },
  });
  const masks = recordsOfKind((await parseImageStream(stream as never).finalResult).records, "mask");
  if (!masks.length) return null;
  const { mask, bounds } = masks[0];
  const raster = decodeMaskToRaster(mask);
  const bw = bounds.right - bounds.left;
  const bh = bounds.bottom - bounds.top;
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if (raster[Math.floor((y * mask.height) / bh) * mask.width + Math.floor((x * mask.width) / bw)]) alpha[(bounds.top + y) * W + bounds.left + x] = 1;
  return alpha;
}

// Paper enclosed by a drawing's strokes belongs to it: flood the outside from the crop border, keep the rest.
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const queue: number[] = [];
  const seed = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

const report: Record<string, unknown>[] = [];
for (const o of found) {
  const name = o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const alpha = await time(`sam:${name}`, () => samBox(o));
  if (!alpha) {
    report.push({ name, found: 0 });
    continue;
  }
  let x1 = W;
  let y1 = H;
  let x2 = -1;
  let y2 = -1;
  for (let i = 0; i < W * H; i++)
    if (alpha[i]) {
      const x = i % W;
      const y = (i - x) / W;
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  const pad = 16;
  const left = Math.max(0, x1 - pad);
  const top = Math.max(0, y1 - pad);
  const cw = Math.min(W, x2 + 1 + pad) - left;
  const ch = Math.min(H, y2 + 1 + pad) - top;
  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = alpha[(top + y) * W + left + x];
  const mask = fillHoles(crop, cw, ch);
  // Sticker border: dilate the mask by a disc of radius R.
  const R = 8;
  const border = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      if (!mask[y * cw + x]) continue;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (dx * dx + dy * dy <= R * R && nx >= 0 && ny >= 0 && nx < cw && ny < ch) border[ny * cw + nx] = 1;
        }
    }
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      const s = ((top + y) * W + left + x) * 3;
      const inside = mask[i] === 1;
      out[i * 4] = inside ? flat[s] : 255;
      out[i * 4 + 1] = inside ? flat[s + 1] : 255;
      out[i * 4 + 2] = inside ? flat[s + 2] : 255;
      out[i * 4 + 3] = inside || border[i] ? 255 : 0;
    }
  await sharp(out, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(`${OUT}${name}.png`);
  const parts = partsFromMask(Uint8Array.from(out.filter((_, i) => i % 4 === 3), (a) => (a ? 1 : 0)), cw, ch, BANDS);
  await Bun.write(`${OUT}${name}.hitbox.json`, JSON.stringify({ width: cw, height: ch, parts }));
  report.push({ name, spark_box: [o.x1, o.y1, o.x2, o.y2], box: [x1, y1, x2 + 1, y2 + 1], parts: parts.length });
}

const result = {
  photo: { width: W, height: H },
  timings_ms: timings,
  // Muse Spark is billed per token; its usage is reported, not priced here.
  spark_usage: listed.usage,
  sam_cost_usd: +(samCalls * SAM_USD).toFixed(4),
  objects: report,
};
await Bun.write(`${OUT}report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
