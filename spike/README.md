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

## Hitboxes and cutout check
- `spike/hitbox.ts`: each cutout's mask becomes 8 band boxes (`BANDS` in `v1-cutout.ts`, a resolution choice, not measured), written as `out/<name>.hitbox.json` and used as `Body.parts`.
- `spike/quality.ts`: compares SAM's mask with a foreground estimate from the sheet (distance from the paper color, Otsu threshold). Writes `out/<name>.check.png` (blue: foreground SAM missed, red: mask the estimate calls paper).
- Same sheet, `--reuse`: missed foreground fox 2.4%, tree 1.8%, crate 2.1%, rock 28%. The check flags the rock. "Extra" is noisy on white parts (fox chest, tail tip read as paper), so `missed` is the signal.

## dotframe dogfood (branch `railly/body-collisions` in crafter-games/dotframe)
- Fixed: a body stopped against an equal-height body fell through the floor (float-rounding overlap resolved vertically). This was in `stepBody` on main, not only in this spike.
- Added: `Body.parts` (compound shapes) and `stepBodies` (bodies collide with each other).
- `spike/drop2d` depends on that branch via `file:` until it is released. Replays: `fox-meets-tree`, `mash-1200`.

## Still open
- The shadow pass ignores `alphaCutoff`: cards cast rectangular shadows.
- A cutout on a box via triplanar shows the transparent border as white. Box textures need a seamless material sheet, not a cutout.
- Bodies do not push each other: a walker stops at the first contact.
- The rock's SAM miss is detected, not fixed (next: retry with a box prompt from the foreground estimate).
