// src/app/api/episode/servers/route.ts

import { getHiAnimeScraper } from "@/lib/hianime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sanitize incoming id: decode if needed and only allow base + optional '?ep=digits'
const sanitize = (raw?: string | null) => {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore bad encodings
  }

  // Keep base path + optional ?ep=123, drop anything else
  const m = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!m) return decoded.split("?")[0];
  return m[1] + (m[3] ? `?ep=${m[3]}` : "");
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const animeEpisodeIdRaw = searchParams.get("animeEpisodeId");

    if (!animeEpisodeIdRaw) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 },
      );
    }

    const animeEpisodeId = sanitize(animeEpisodeIdRaw);
    if (!animeEpisodeId) {
      return Response.json(
        { error: "invalid animeEpisodeId" },
        { status: 400 },
      );
    }

    const scraper = await getHiAnimeScraper();
    if (!scraper) {
      console.error("[EPISODE_SERVERS] HiAnime scraper unavailable");
      return Response.json(
        { error: "scraper unavailable" },
        { status: 503 },
      );
    }

    const data = await scraper.getEpisodeServers(animeEpisodeId);

    return Response.json({ data });
  } catch (err: any) {
    console.error("[EPISODE_SERVERS] API Error:", {
      message: err?.message,
      stack: err?.stack,
    });
    return Response.json(
      { error: "something went wrong" },
      { status: 500 },
    );
  }
}
