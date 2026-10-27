// Shared cutout steps for drawings: SAM from a box, filling the paper an outline encloses, and writing a sticker PNG
// (white border, transparent around it) with its collision parts.
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import type OpenAI from "openai";
import sharp from "sharp";
import { partsFromMask } from "./hitbox";

export const SAM_USD = 2.5 / 1000;
// Horizontal bands per hitbox, as in v1-cutout.
const BANDS = 8;

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// SAM 3.1 from a box prompt (inclusive pixel box); returns a 0/1 mask over the whole W x H image.
export async function samBox(client: OpenAI, dataUrl: string, W: number, H: number, b: Box): Promise<Uint8Array | null> {
  const x1 = Math.max(0, Math.min(W - 1, b.x1));
  const y1 = Math.max(0, Math.min(H - 1, b.y1));
  const x2 = Math.max(x1, Math.min(W - 1, b.x2));
  const y2 = Math.max(y1, Math.min(H - 1, b.y2));
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
  const { mask, bounds } = masks[0]!;
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
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
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
    const i = queue[q]!;
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

// Writes <out>/<name>.png (the mask's pixels from rgb, holes filled, white border) and <name>.hitbox.json.
// Returns the mask's box in the source image, or null for an empty mask.
export async function writeSticker(out: string, name: string, rgb: Uint8Array, W: number, H: number, alpha: Uint8Array): Promise<(Box & { parts: number }) | null> {
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
  if (x2 < 0) return null;
  const pad = 16;
  const left = Math.max(0, x1 - pad);
  const top = Math.max(0, y1 - pad);
  const cw = Math.min(W, x2 + 1 + pad) - left;
  const ch = Math.min(H, y2 + 1 + pad) - top;
  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = alpha[(top + y) * W + left + x]!;
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
  const png = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      const s = ((top + y) * W + left + x) * 3;
      const inside = mask[i] === 1;
      png[i * 4] = inside ? rgb[s]! : 255;
      png[i * 4 + 1] = inside ? rgb[s + 1]! : 255;
      png[i * 4 + 2] = inside ? rgb[s + 2]! : 255;
      png[i * 4 + 3] = inside || border[i] ? 255 : 0;
    }
  await sharp(png, { raw: { width: cw, height: ch, channels: 4 } }).png().toFile(`${out}${name}.png`);
  const parts = partsFromMask(Uint8Array.from(png.filter((_, i) => i % 4 === 3), (a) => (a ? 1 : 0)), cw, ch, BANDS);
  await Bun.write(`${out}${name}.hitbox.json`, JSON.stringify({ width: cw, height: ch, parts }));
  return { x1, y1, x2: x2 + 1, y2: y2 + 1, parts: parts.length };
}
