// Collision parts from a cutout mask: the mask is cut into horizontal bands and each band becomes the box spanning
// its covered columns, so a tail or a canopy is not solid air under one bounding box.
export interface Part {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

// Parts in pixels, relative to the image center, y up (dotframe physics convention).
export function partsFromMask(mask: Uint8Array, width: number, height: number, bands: number): Part[] {
  const parts: Part[] = [];
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor((b * height) / bands);
    const y1 = Math.floor(((b + 1) * height) / bands);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < width; x++)
        if (mask[y * width + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX < 0) continue;
    const cx = (minX + maxX + 1) / 2;
    const cy = (minY + maxY + 1) / 2;
    parts.push({ x: cx - width / 2, y: height / 2 - cy, halfWidth: (maxX + 1 - minX) / 2, halfHeight: (maxY + 1 - minY) / 2 });
  }
  return parts;
}
