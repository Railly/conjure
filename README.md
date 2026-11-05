# Conjure

**What only Conjure does:** the kid's cutout drawing becomes the physics bodies, three agents race in sandboxes, and a playtester written in code (14 policies must lose, a search must win) plus a per-edit bundle and headless check gate everything. See `make/verify.ts` and `games/*/events.jsonl`.

**Live showcase: https://conjure.crafter.run**

**Demo video:** https://youtu.be/ZngyVBDTdkA

Take a photo of a kid's drawing and play it as a real game a few minutes later. The characters keep their crayon style and become bodies with physics on a real engine. Then you change the game while you play, by asking.

Built for the Meta Global AI Developer Hackathon, Indie track. First commit 2026-10-27.

## Play it now

Eight games built with Conjure this week, published from the Studio with one click. Each one started as a drawing.

| Game | Genre | Play |
|---|---|---|
| Knight Flight: Dragon Down! | physics puzzle | https://conjure-a-physics-slingshot-game-11.vercel.app |
| Froggy Finale | rhythm or timing | https://conjure-a-rhythm-game-where-you-110.vercel.app |
| Malcriadazo Rebota | breakout-like | https://conjure-dibujo-11042304.vercel.app |
| Recoil Rocket | shoot 'em up | https://conjure-a-space-shooter-where-my-11.vercel.app |
| Slide & Supper | Sokoban-like grid puzzle | https://conjure-a-push-the-ice-block-puz-11.vercel.app |
| Sunburn Speedway | racing | https://conjure-a-3d-kart-race-on-a-dese-11.vercel.app |
| Bounce Bot: Cloud Key Quest | platformer | https://conjure-a-platformer-where-the-r-11.vercel.app |
| Malcriadazo: Zarpa a Tiempo | rhythm or timing | https://conjure-un-gato-que-recolecte-ra-10.vercel.app |

What is live and what is not: https://conjure.crafter.run is a showcase of published games with their original drawings, OG cards and share links. Creating a new game (photo, concepts, build race, live edits) runs locally from this repo with a Meta Model API key, see "Run it" below. The Studio is not hosted.

## Who it is for

People who draw but don't code: kids, parents, teachers, artists. Today they can only consume games. With Conjure the drawing is the world: their characters are cut out, keep their own style, and collide, jump and score on a real engine.

## How it works

1. **Photo to pieces.** Muse Spark reads the photo and names each figure. SAM 3.1 cuts each one out by box prompt, and the paper is cleaned to white.
2. **Three concepts.** Muse Wonder proposes three game concepts in different genres. The player picks one.
3. **Build race.** Each concept is built in parallel Vercel Sandboxes by an agent loop on Muse Wonder that writes the game on dotframe. The first build that passes both checks wins.
4. **Independent verification.** The agent's word is never the verdict. A playtester runs the game headless with simple policies plus a save/restore search for a win, and a visual QA pass reviews rendered frames by severity. Blockers go to a fixer for up to two rounds.
5. **Live edits.** While playing, the player asks for changes ("make it night", "add a dragon"). Muse Spark edits the code, and Muse Image draws new sprites in the style of the original drawing. Each edit is checked server side (bundle plus headless sim) with one repair round, or it is undone.

## Verification

Two kinds of checks, kept separate on purpose.

**Code checks (no model involved)**, `make/verify.ts`, run by the playtester inside the sandbox:
- Headless simulation for up to 7,200 frames (2 minutes at 60 Hz) per policy.
- Fourteen simple policies: idle, hold-right, hold-left, hold-right-jump, hold-everything, tap-action, and eight seeded random mashers. None of them may win. If one does, the game is too easy and the build fails.
- A search player over 20-frame input segments, 12 tries per segment, that keeps the segments that raise progress and restores state when a segment loses. A win it finds is proof the game is winnable; no win within the budget is reported as a warning.
- On every live edit (`make/play.ts`): the edit must bundle and run headless. One repair round with the error, else the edit is undone.

**Model check**, `studio/build.ts`:
- Visual QA: one Muse Spark call reviews two rendered frames (frame 30 and frame 600) with a strict JSON schema and grades each issue as blocker or minor. Only blockers send the game to the fixer.

A build ships only when the code checks pass and the visual QA has no blockers.

## Measured

One run each, read from `games/<slug>/events.jsonl` (the `done` events) and `build.json`. Build is the winning sandbox's own build time; race total runs from the start of the build stage to the final verdict and includes sandbox boot. Cost is Meta Model API spend for the winning build.

| Game | Photo to 3 concepts | Build (winner) | Race total | Cost (USD) | Verdict |
|---|---|---|---|---|---|
| Knight Flight: Dragon Down! | 89 s | 136 s | 174 s | 0.62 | ok |
| Froggy Finale | 72 s | 296 s | 425 s | 1.31 | ok |
| Malcriadazo Rebota | 84 s | 136 s | 150 s | 0.62 | ok |
| Recoil Rocket | 70 s | 237 s | 413 s | 1.19 | ok |
| Slide & Supper | 77 s | 155 s | 374 s | 0.70 | ok |
| Sunburn Speedway | 75 s | 390 s | 639 s | 1.67 | ok |
| Bounce Bot: Cloud Key Quest | 105 s | 123 s | 333 s | 0.66 | ok |

The eighth game, Malcriadazo: Zarpa a Tiempo, was built on Oct 27 locally, before the game kit and the sandbox race: 1,137 s and US$7.04, verdict ok after one fixer round (`games/un-gato-que-recolecte-ra-10272225/fix-1.json`). That gap is what the kit and the race bought.

Earlier single runs, not repeated tonight: live edit with code only 11 s and US$0.07; live edit with a new sprite 33 s and US$0.14; a new sprite in the drawing's style 11.7 s and US$0.0125.

## Meta models

- **Muse Spark 1.3**: reads the drawing, names and places each figure, visual QA, live code edits.
- **Muse Wonder 1.0**: game concepts, the build agent and the fixer.
- **Muse Image 1.0**: new sprites in the style of the player's drawing.
- **SAM 3.1**: cuts every figure out of the photo.
- **Muse Spark Open (open weights)**: wired as the visual QA model on a Modal Shared Endpoint (`studio/build.ts`, `qaTarget`). It runs when `MODAL_SPARK_URL` and `MODAL_PROXY_TOKEN` are set. It was verified with one live call and is disabled right now while hackathon credits land. Without it, visual QA falls back to Muse Spark 1.3.

## Prior work

Conjure runs on [dotframe](https://github.com/crafter-games/dotframe), our open-source game engine, which existed before the hackathon. The prior work cutoff is dotframe tag `pre-hackathon` (2037a05). Everything in this repo was built during the hackathon (first commit 2026-10-27). Engine fixes that Conjure forced during the week landed in dotframe as #51 (compound bodies, side contact fix, shadows), #52 (warning for text without a font, snap warnings) and #53 (browser shortcuts during play).

The family and drawing scenes in the demo video are generated b-roll (Veo 3.1), and the voiceover is the author's own voice through ElevenLabs. Every product shot is a real screen recording of the Studio and of the games.

## Repo map

- `web/`: the Studio (Next.js 16).
- `studio/`: the engine server (Bun): concepts, build, race, events over SSE, publish.
- `sandbox/`: snapshot and remote builds in Vercel Sandbox.
- `kit/`: game kit (sprites, fonts, title, win and lose scenes, input, particles, HUD).
- `make/`: agent loop, playtester, play with live edits and undo.
- `spike/`: photo cutout, sprite in style, hitboxes.
- `games/`: games built during the week, with their `events.jsonl`.

## Run it

```
bun install
bun --env-file=.env studio/server.ts --port 5171
cd web && NEXT_PUBLIC_ENGINE_URL=http://localhost:5171 bun run dev
```

`.env` needs `MODEL_API_KEY` (Meta Model API). With a Vercel OIDC token and `CONJURE_SNAPSHOT_ID` the engine races builds in sandboxes; without them it builds locally. Optional: `MODAL_SPARK_URL` and `MODAL_PROXY_TOKEN` route visual QA to Muse Spark Open on Modal.
