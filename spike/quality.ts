// Cutout check: compares SAM's mask with an independent foreground estimate from the sheet itself (pixels that
// differ from the paper), so a mask that drops part of the object shows up as missed foreground.
export interface Quality {
  iou: number;
  missed: number; // share of estimated foreground outside the mask
  extra: number; // share of the mask the estimate calls paper
  threshold: number;
}

// Otsu's threshold over 0..255 values: the split that best separates two classes, taken from the data.
function otsu(values: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// rgb: the crop around the object (3 channels); mask: SAM's mask on the same crop; paper: the sheet's paper color.
export function checkCutout(rgb: Uint8Array, mask: Uint8Array, paper: [number, number, number]): { quality: Quality; foreground: Uint8Array } {
  const n = mask.length;
  const dist = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dr = rgb[i * 3] - paper[0];
    const dg = rgb[i * 3 + 1] - paper[1];
    const db = rgb[i * 3 + 2] - paper[2];
    dist[i] = Math.min(255, Math.round(Math.sqrt(dr * dr + dg * dg + db * db)));
  }
  const threshold = otsu(dist);
  const foreground = new Uint8Array(n);
  let inter = 0;
  let union = 0;
  let fg = 0;
  let m = 0;
  let missed = 0;
  let extra = 0;
  for (let i = 0; i < n; i++) {
    const f = dist[i] > threshold ? 1 : 0;
    const k = mask[i] ? 1 : 0;
    foreground[i] = f;
    fg += f;
    m += k;
    if (f && k) inter++;
    if (f || k) union++;
    if (f && !k) missed++;
    if (k && !f) extra++;
  }
  return {
    quality: { iou: +(inter / union).toFixed(3), missed: +(missed / fg).toFixed(3), extra: +(extra / m).toFixed(3), threshold },
    foreground,
  };
}

// The sheet's paper color: the per-channel median of a frame of pixels along the image border.
export function paperColor(rgb: Uint8Array, width: number, height: number, frame: number): [number, number, number] {
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x >= frame && x < width - frame && y >= frame && y < height - frame) continue;
      const i = (y * width + x) * 3;
      ch[0].push(rgb[i]);
      ch[1].push(rgb[i + 1]);
      ch[2].push(rgb[i + 2]);
    }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]) as [number, number, number];
}
