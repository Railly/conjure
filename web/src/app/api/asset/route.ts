import { readFile } from "node:fs/promises";
import { join } from "node:path";

// A session's cut-out drawings and its input photo, read from disk so they survive engine restarts.
const GAMES = join(process.cwd(), "..", "games");

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("slug") ?? "";
  const name = q.get("n") ?? "";
  if (!/^[\w-]+$/.test(slug) || !/^[\w.-]+$/.test(name)) return new Response("bad request", { status: 400 });
  // Session-root screenshots the home gallery may show; everything else resolves inside assets/.
  const SHOTS = new Set(["shot-play", "qa-600", "shot-title"]);
  const file = name === "photo-input" || SHOTS.has(name) ? join(GAMES, slug, `${name}.png`) : join(GAMES, slug, "assets", `${name}.png`);
  const png = await readFile(file).catch(() => null);
  if (!png) return new Response("not found", { status: 404 });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
}
