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
- `spike/quality.ts`: foreground estimate from the sheet (distance from the paper color, Otsu threshold). `out/<name>.check.png`: blue is foreground the mask missed, red is mask the estimate calls paper ("extra" is noisy on white parts, so `missed` is the signal).
- Second opinion per object: SAM again with a box around the paper's connected region for that object; the mask that misses less of the region wins (text wins ties). Same sheet: text vs box missed fox 2.4% vs 1.4%, tree 1.8% vs 1.5%, rock 31% vs 1.7%, crate 2.1% vs 0.8%. Box won all four and fixed the rock.
- Cost per sheet with the second opinion: $0.01 image + 8 x $0.0025 SAM = $0.03.

## Materials
- `spike/v1-material.ts`: a tileable material from Muse Image (7.9 s, $0.01) for meshes that tile a texture. The crate box in `drop3d` uses it instead of the cutout. `out/crate-material-tiled.png` shows the seams: plank ends repeat every tile, which reads as plank joints.

## dotframe dogfood ([crafter-games/dotframe#51](https://github.com/crafter-games/dotframe/pull/51))
- Fixed: a body stopped against an equal-height body fell through the floor (float-rounding overlap resolved vertically). In `stepBody` on main.
- Fixed: alpha-cut meshes cast rectangular shadows.
- Added: `Body.parts` (compound shapes), `stepBodies` (bodies collide), `Body.pushable` (a walker shoves it, one level deep).
- `spike/drop2d` and `spike/drop3d` depend on the PR branch (`github:crafter-games/dotframe#railly/body-collisions`) until it is released. Replays: `fox-meets-tree`, `mash-1200`, `push-crate` (drop2d), `idle-120` (drop3d).

## Still open
- Chained pushes: a pushed body does not push a third.
- Native (scriptc) build of the cutout shadow pipeline is not run on this machine.
