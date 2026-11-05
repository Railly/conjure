# Conjure

Take a photo of a drawing and play it as a real game a few minutes later. Conjure turns a kid's drawing (or a one-line idea) into a game with physics, rules, a win condition and a verified build. Then you change it while you play, by asking.

Built for the Meta Global AI Developer Hackathon, Indie track.

## Who it is for

People who draw but don't code: kids, parents, teachers, artists. Today they can only consume games. With Conjure the drawing is the world: their characters are cut out, keep their own style, and collide, jump and score on a real engine.

## How it works

1. **Photo to pieces.** Muse Spark reads the photo and names each figure. SAM 3.1 cuts each one out by box prompt, and the paper is cleaned to white.
2. **Three concepts.** Muse Wonder proposes three game concepts in different genres. The player picks one.
3. **Build race.** Each concept is built in parallel Vercel Sandboxes by an agent loop on Muse Wonder that writes the game on dotframe. The first build that passes both checks wins.
4. **Independent verification.** The agent's word is never the verdict. A playtester runs the game headless with simple policies plus a save/restore search for a win, and a visual QA pass reviews rendered frames by severity. Blockers go to a fixer for up to two rounds.
5. **Live edits.** While playing, the player asks for changes ("make it night", "add a dragon"). Muse Spark edits the code, and Muse Image draws new sprites in the style of the original drawing. Each edit is checked server side (bundle plus headless sim) with one repair round, or it is undone.

## Measured numbers (single runs, not averages)

| Step | Time | Cost |
|---|---|---|
| Photo to three concepts | 77 s | |
| Pick to playable game (race of 3 sandboxes) | 160 s | US$1.0-1.5 per build |
| Live edit, code only | 11 s | US$0.07 |
| Live edit with a new sprite | 33 s | US$0.14 |
| New sprite in the drawing's style | 11.7 s | US$0.0125 |

The game kit cut build time from 13 minutes to about 5 locally, and the sandbox race brought it to 160 s.

## Meta models

- **Muse Spark 1.3**: reads the drawing, names and places each figure, live edits.
- **Muse Wonder 1.0**: game concepts, the build agent and the fixer.
- **Muse Image 1.0**: new sprites in the style of the player's drawing.
- **SAM 3.1**: cuts every figure out of the photo.

## Prior work

Conjure runs on [dotframe](https://github.com/crafter-games/dotframe), our open-source game engine, which existed before the hackathon. The prior work cutoff is dotframe tag `pre-hackathon` (2037a05). Everything in this repo was built during the hackathon (first commit 2026-10-27). Engine fixes that Conjure forced during the week landed in dotframe as #51 (compound bodies, side contact fix, shadows), #52 (warning for text without a font, snap warnings) and #53 (browser shortcuts during play).

The intro and the "dreamed" comparison shots in the demo video are generated b-roll. Every product shot is a real screen recording.

## Repo map

- `web/`: the Studio (Next.js 16).
- `studio/`: the engine server (Bun): concepts, build, race, events over SSE.
- `sandbox/`: snapshot and remote builds in Vercel Sandbox.
- `kit/`: game kit (sprites, fonts, title, win and lose scenes, input, particles, HUD).
- `make/`: agent loop, playtester, play with live edits and undo.
- `spike/`: photo cutout, sprite in style, hitboxes.
- `games/`: games built during the week.

## Run it

```
bun install
bun --env-file=.env studio/server.ts --port 5171
cd web && NEXT_PUBLIC_ENGINE_URL=http://localhost:5171 bun run dev
```

`.env` needs `MODEL_API_KEY` (Meta Model API). With a Vercel OIDC token and `CONJURE_SNAPSHOT_ID` the engine races builds in sandboxes; without them it builds locally.
