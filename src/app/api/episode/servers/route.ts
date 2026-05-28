// src/app/api/episode/servers/route.ts

import { getAniwatchScraper } from "@/lib/aniwatch";
import {
  getAnikaiEpisodeServers,
  isAnikaiEpisodeId,
} from "@/lib/anikai";
import {
  getAniwatchWpEpisodeServers,
  isAniwatchWpEpisodeId,
} from "@/lib/aniwatch-wp";

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

export async function resolveEpisodeServers(options: {
  animeEpisodeIdRaw?: string | null;
  category?: string | null;
  server?: string | null;
}) {
  const animeEpisodeId = sanitize(options.animeEpisodeIdRaw);
  const category = options.category || "sub";
  const server = options.server || "hd-1";

  if (!options.animeEpisodeIdRaw) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "animeEpisodeId is required" },
    };
  }

  if (!animeEpisodeId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "invalid animeEpisodeId" },
    };
  }

  const cacheKey = `${animeEpisodeId}::${category}::${server}`;
  const cached = memoryCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    console.debug("[EPISODE_SERVERS] returning cached data", cacheKey);
    return {
      ok: true as const,
      status: 200,
      body: {
        data: cached.data,
        fromCache: true,
        fallback: isAnikaiEpisodeId(cached.data?.episodeId),
      },
    };
  }

  let lastError: any = null;

  if (isAniwatchWpEpisodeId(animeEpisodeId)) {
    try {
      const data = await getAniwatchWpEpisodeServers(animeEpisodeId);
      memoryCache.set(cacheKey, { data, fetchedAt: now });
      return {
        ok: true as const,
        status: 200,
        body: { data },
      };
    } catch (scrapeErr: any) {
      lastError = scrapeErr;
      console.error("[EPISODE_SERVERS] aniwatch.co.at episode server error:", {
        animeEpisodeId,
        message: scrapeErr?.message,
        stack: scrapeErr?.stack,
      });
    }
  }

  const scraper = await getAniwatchScraper();
  if (scraper) {
    try {
      const data = await scraper.getEpisodeServers(animeEpisodeId);
      memoryCache.set(cacheKey, { data, fetchedAt: now });
      return {
        ok: true as const,
        status: 200,
        body: { data },
      };
    } catch (scrapeErr: any) {
      lastError = scrapeErr;
      console.error("[EPISODE_SERVERS] scraper.getEpisodeServers error:", {
        animeEpisodeId,
        message: scrapeErr?.message,
        stack: scrapeErr?.stack,
      });
    }
  } else {
    console.error("[EPISODE_SERVERS] Aniwatch scraper unavailable");
  }

  const anikaiEpisodeId = isAnikaiEpisodeId(animeEpisodeId)
    ? animeEpisodeId
    : null;
  if (anikaiEpisodeId) {
    const requestedAnikai = isAnikaiEpisodeId(animeEpisodeId);
    try {
      const data = await getAnikaiEpisodeServers(anikaiEpisodeId);
      memoryCache.set(cacheKey, { data, fetchedAt: now });
      return {
        ok: true as const,
        status: 200,
        body: {
          data,
          fallback: true,
          fallbackReason: requestedAnikai ? undefined : "Aniwatch providers failed",
        },
      };
    } catch (scrapeErr: any) {
      lastError = scrapeErr;
      console.error("[EPISODE_SERVERS] AnimeKai episode server error:", {
        animeEpisodeId,
        anikaiEpisodeId,
        message: scrapeErr?.message,
        stack: scrapeErr?.stack,
      });
    }
  }

  if (cached) {
    console.warn("[EPISODE_SERVERS] using stale cached data after failure", cacheKey);
    return {
      ok: true as const,
      status: 200,
      body: {
        data: cached.data,
        fromCache: true,
        stale: true,
      },
    };
  }

  const message = lastError?.message || (scraper ? "No episode servers found" : "scraper unavailable");
  return {
    ok: false as const,
    status: scraper ? 502 : 503,
    body: { error: message },
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await resolveEpisodeServers({
      animeEpisodeIdRaw: searchParams.get("animeEpisodeId"),
      category: searchParams.get("category"),
      server: searchParams.get("server"),
    });

    return Response.json(result.body, { status: result.status });
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
