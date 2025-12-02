// src/app/api/episode/servers/route.ts

import { getHiAnimeScraper } from "@/lib/hianime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// simple in-memory cache to avoid hitting flaky upstream on every request
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const memoryCache = new Map<
  string,
  { data: any; fetchedAt: number }
>();

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
    const category = searchParams.get("category") || "sub";
    const server = searchParams.get("server") || "hd-1";

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

    // Reuse fresh data if we already fetched recently
    const cacheKey = `${animeEpisodeId}::${category}::${server}`;
    const cached = memoryCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      console.debug("[EPISODE_SERVERS] returning cached data", cacheKey);
      return Response.json({ data: cached.data, fromCache: true });
    }

    const scraper = await getHiAnimeScraper();
    if (!scraper) {
      console.error("[EPISODE_SERVERS] HiAnime scraper unavailable");
      return Response.json(
        { error: "scraper unavailable" },
        { status: 503 },
      );
    }

    let data: any;
    try {
      data = await scraper.getEpisodeServers(animeEpisodeId);
    } catch (scrapeErr: any) {
      console.error("[EPISODE_SERVERS] scraper.getEpisodeServers error:", {
        animeEpisodeId,
        message: scrapeErr?.message,
        stack: scrapeErr?.stack,
      });
      // fallback to stale cache if available instead of hard failing
      if (cached) {
        console.warn("[EPISODE_SERVERS] using stale cached data after failure", cacheKey);
        return Response.json({ data: cached.data, fromCache: true, stale: true });
      }
      const message = scrapeErr?.message || "scrape failed";
      return Response.json(
        { error: `scraper error: ${message}` },
        { status: 502 },
      );
    }

    // cache freshly fetched data in-memory to reduce upstream pressure
    memoryCache.set(cacheKey, { data, fetchedAt: now });

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
