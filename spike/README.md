# Spike V1: painted sheet to playable sprites

Run: `bun --env-file=.env spike/v1-cutout.ts [prompt] [objects]` writes `spike/out/` (sheet, cutouts, report.json). Then `dotframe snap` in `spike/drop2d` and `spike/drop3d` (cutouts copied to their `assets/`).

## Measured (2026-10-27, 3 runs, 1920x1280 sheet, 4 objects)
- Muse Image (`reasoning_strength: low`, tools off): 8.5 to 9.6 s per sheet.
- SAM 3.1, one text prompt per object: 1.4 to 6.3 s each, sequential. 4/4 objects found in every run.
- Cost per sheet: $0.01 image + 4 x $0.0025 SAM = $0.02.

## Gate results
- SAM cuts the painting cleanly: yes. Masks follow fur, needles and moss; a dilated mask gives the white sticker border.
- 2D: cutouts fall, land on the ground and the fox walks and jumps under input (`dotframe sim` + `snap`, doctor's render purity check passes).
- 3D: cutouts as UV cards with `alphaCutoff` render correctly and cast sun shadows.

## Found (dogfood candidates for dotframe)
- `physics.stepBody` only collides with static solids. Using other bodies as solids, a body walking into a taller one lifts it on top (fox into tree leaves the tree floating). Needs body vs body.
- Bodies are the sprite's bounding box, so the fox's tail is solid air. Needs a hull or a box from the mask.
- The shadow pass ignores `alphaCutoff`: cards cast rectangular shadows.
- A cutout on a box via triplanar shows the transparent border as white. Box textures need a seamless material sheet, not a cutout.
