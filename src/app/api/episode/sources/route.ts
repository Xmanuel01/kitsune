import { getAniwatchScraper } from "@/lib/aniwatch";
import { getCachedValue, setCachedValue } from "@/lib/hot-cache";
import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60 * 30;
const SOURCE_CACHE_VERSION = "v4";

type EpisodeCategory = "sub" | "dub" | "raw";

const makeKey = (episodeId: string, category: string, server: string) =>
  `${SOURCE_CACHE_VERSION}::${episodeId}::${category}::${server}`;

function isCachedIframeFallback(data: any) {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.iframeUrl &&
      data.provider === "megaplay",
  );
}

const sanitize = (raw?: string | null) => {
  if (!raw) {
    return null;
  }

  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore decode errors
  }

  const match = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!match) {
    return decoded.split("?")[0];
  }

  return match[1] + (match[3] ? `?ep=${match[3]}` : "");
};

function extractEpisodeParam(episodeId: string) {
  const queryMatch = episodeId.match(/[?&]ep=(\d+)/i);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  const pathMatch = episodeId.match(/episode-(\d+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  return null;
}

function buildMegaplayFallbackUrl(episodeId: string, category: EpisodeCategory) {
  const epParam = extractEpisodeParam(episodeId);
  if (!epParam) {
    return null;
  }

  const normalizedCategory = category === "raw" ? "sub" : category;
  return `https://megaplay.buzz/stream/s-2/${epParam}/${normalizedCategory}`;
}

function createMegaplayFallbackData(options: {
  episodeId: string;
  category: EpisodeCategory;
  fallbackFromServer: string;
  fallbackReason: string;
}) {
  const iframeUrl = buildMegaplayFallbackUrl(options.episodeId, options.category);
  if (!iframeUrl) {
    return null;
  }

  return {
    headers: {
      Referer: "https://megaplay.buzz/",
    },
    tracks: [],
    intro: { start: 0, end: 0 },
    outro: { start: 0, end: 0 },
    sources: [],
    anilistID: 0,
    malID: 0,
    provider: "megaplay" as const,
    iframeUrl,
    fallbackFromServer: options.fallbackFromServer,
    fallbackReason: options.fallbackReason,
  };
}

async function getSupabaseCachedRecord(compositeKey: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("episode_sources")
      .select("*")
      .eq("compositeKey", compositeKey)
      .maybeSingle();

    if (error) {
      console.warn(
        "[EPISODE_SOURCES] Supabase select error:",
        error.message || error,
      );
      return null;
    }

    return data;
  } catch (error) {
    console.warn("[EPISODE_SOURCES] Supabase cache read failed:", error);
    return null;
  }
}

async function persistSourceRecord(recordPayload: any) {
  try {
    const { error } = await supabaseAdmin
      .from("episode_sources")
      .upsert(recordPayload, { onConflict: "compositeKey" });

    if (error) {
      console.warn(
        "[EPISODE_SOURCES] Supabase upsert error:",
        error.message || error,
      );
      return;
    }

    console.debug("[EPISODE_SOURCES] cache upserted:", recordPayload.compositeKey);
  } catch (error) {
    console.error(
      "[EPISODE_SOURCES] Failed to upsert episode_sources into Supabase:",
      error,
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const episodeId = sanitize(url.searchParams.get("animeEpisodeId"));
    const category = (url.searchParams.get("category") as EpisodeCategory | null) || "sub";
    const server = url.searchParams.get("server") || "hd-1";

    if (!episodeId) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 },
      );
    }

    const compositeKey = makeKey(episodeId, category, server);
    const hotCacheKey = `episode-source:${SOURCE_CACHE_VERSION}:${compositeKey}`;
    const hotCached = await getCachedValue<any>({ key: hotCacheKey });
    if (hotCached && !isCachedIframeFallback(hotCached)) {
      return Response.json({ data: hotCached, fromCache: true, tier: "hot" });
    }

    const cached = await getSupabaseCachedRecord(compositeKey);
    const now = Date.now();
    if (cached?.data) {
      const fetchedAtMs = cached.fetchedAt
        ? new Date(cached.fetchedAt).getTime()
        : 0;
      const ageSeconds = (now - fetchedAtMs) / 1000;

      if (ageSeconds < CACHE_TTL_SECONDS && !isCachedIframeFallback(cached.data)) {
        await setCachedValue(
          {
            key: hotCacheKey,
            ttlSeconds: CACHE_TTL_SECONDS,
          },
          cached.data,
        );
        return Response.json({ data: cached.data, fromCache: true });
      }
    }

    let data: any = null;
    let shouldPersistToCache = true;
    const scraper = await getAniwatchScraper();
    if (!scraper) {
      return Response.json({ error: "scraper unavailable" }, { status: 503 });
    }

    try {
      data = await scraper.getEpisodeSources(episodeId, server, category);
    } catch (aniwatchError: any) {
      console.error("[EPISODE_SOURCES] aniwatch source error:", {
        episodeId,
        category,
        server,
        message: aniwatchError?.message,
        stack: aniwatchError?.stack,
      });

      const megaplayFallback = createMegaplayFallbackData({
        episodeId,
        category,
        fallbackFromServer: server,
        fallbackReason: aniwatchError?.message || "aniwatch scrape failed",
      });

      if (!megaplayFallback) {
        return Response.json(
          { error: aniwatchError?.message || "scrape failed" },
          { status: 502 },
        );
      }

      shouldPersistToCache = false;
      data = megaplayFallback;
    }

    if (!data?.iframeUrl && (!Array.isArray(data?.sources) || !data.sources.length)) {
      const megaplayFallback = createMegaplayFallbackData({
        episodeId,
        category,
        fallbackFromServer: server,
        fallbackReason: "aniwatch returned no playable sources",
      });

      if (!megaplayFallback) {
        return Response.json(
          { error: "No playable sources were found for this episode" },
          { status: 502 },
        );
      }

      shouldPersistToCache = false;
      data = megaplayFallback;
    }

    const recordPayload = {
      compositeKey,
      animeEpisodeId: episodeId,
      category,
      server,
      data,
      fetchedAt: new Date().toISOString(),
    };

    if (shouldPersistToCache) {
      await persistSourceRecord(recordPayload);
    }

    if (!isCachedIframeFallback(data)) {
      await setCachedValue(
        {
          key: hotCacheKey,
          ttlSeconds: CACHE_TTL_SECONDS,
        },
        data,
      );
    }

    return Response.json({ data, fromCache: false });
  } catch (error: any) {
    console.error("[EPISODE_SOURCES] API Error:", {
      message: error?.message,
      stack: error?.stack,
    });
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
