import { getAniwatchScraper } from "@/lib/aniwatch";
import {
  getAnikaiEpisodeSource,
  isAnikaiEpisodeId,
} from "@/lib/anikai";
import {
  getAniwatchWpEpisodeSource,
  isAniwatchWpEpisodeId,
} from "@/lib/aniwatch-wp";
import { getCachedValue, setCachedValue } from "@/lib/hot-cache";
import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 60 * 30;
const SOURCE_CACHE_VERSION = "v7";

type EpisodeCategory = "sub" | "dub" | "raw";

const makeKey = (episodeId: string, category: string, server: string) =>
  `${SOURCE_CACHE_VERSION}::${episodeId}::${category}::${server}`;

function isCachedIframeFallback(data: any) {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.iframeUrl &&
      (data.provider === "megaplay" || data.provider === "anikai"),
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

export async function resolveEpisodeSources(options: {
  animeEpisodeId?: string | null;
  category?: EpisodeCategory | null;
  server?: string | null;
}) {
  const episodeId = sanitize(options.animeEpisodeId);
  const category = options.category || "sub";
  const server = options.server || "hd-1";

  if (!episodeId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "animeEpisodeId is required" },
    };
  }

  const compositeKey = makeKey(episodeId, category, server);
  const hotCacheKey = `episode-source:${SOURCE_CACHE_VERSION}:${compositeKey}`;
  const hotCached = await getCachedValue<any>({ key: hotCacheKey });
  if (hotCached && !isCachedIframeFallback(hotCached)) {
    return {
      ok: true as const,
      status: 200,
      body: { data: hotCached, fromCache: true, tier: "hot" },
    };
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
      return {
        ok: true as const,
        status: 200,
        body: { data: cached.data, fromCache: true },
      };
    }
  }

  let lastError: any = null;
  if (isAniwatchWpEpisodeId(episodeId)) {
    try {
      const data = await getAniwatchWpEpisodeSource(episodeId, server, category);
      const recordPayload = {
        compositeKey,
        animeEpisodeId: episodeId,
        category,
        server,
        data,
        fetchedAt: new Date().toISOString(),
      };
      await persistSourceRecord(recordPayload);
      await setCachedValue(
        {
          key: hotCacheKey,
          ttlSeconds: CACHE_TTL_SECONDS,
        },
        data,
      );
      return {
        ok: true as const,
        status: 200,
        body: { data, fromCache: false },
      };
    } catch (aniwatchWpError: any) {
      lastError = aniwatchWpError;
      console.error("[EPISODE_SOURCES] aniwatch.co.at source error:", {
        episodeId,
        category,
        server,
        message: aniwatchWpError?.message,
        stack: aniwatchWpError?.stack,
      });
    }
  }

  const scraper = await getAniwatchScraper();
  if (scraper) {
    try {
      const data = await scraper.getEpisodeSources(episodeId, server, category);
      if (!data?.iframeUrl && (!Array.isArray(data?.sources) || !data.sources.length)) {
        throw new Error("aniwatch returned no playable sources");
      }
      const recordPayload = {
        compositeKey,
        animeEpisodeId: episodeId,
        category,
        server,
        data,
        fetchedAt: new Date().toISOString(),
      };
      await persistSourceRecord(recordPayload);
      if (!isCachedIframeFallback(data)) {
        await setCachedValue(
          {
            key: hotCacheKey,
            ttlSeconds: CACHE_TTL_SECONDS,
          },
          data,
        );
      }
      return {
        ok: true as const,
        status: 200,
        body: { data, fromCache: false },
      };
    } catch (aniwatchError: any) {
      lastError = aniwatchError;
      console.error("[EPISODE_SOURCES] aniwatch source error:", {
        episodeId,
        category,
        server,
        message: aniwatchError?.message,
        stack: aniwatchError?.stack,
      });
    }
  } else {
    console.error("[EPISODE_SOURCES] Aniwatch scraper unavailable");
  }

  const anikaiEpisodeId = isAnikaiEpisodeId(episodeId)
    ? episodeId
    : null;
  if (anikaiEpisodeId) {
    try {
      const data = await getAnikaiEpisodeSource(anikaiEpisodeId, server, category);
      return {
        ok: true as const,
        status: 200,
        body: { data, fromCache: false },
      };
    } catch (anikaiError: any) {
      lastError = anikaiError;
      console.error("[EPISODE_SOURCES] AnimeKai source error:", {
        episodeId,
        anikaiEpisodeId,
        category,
        server,
        message: anikaiError?.message,
        stack: anikaiError?.stack,
      });
    }
  }

  const megaplayFallback = createMegaplayFallbackData({
    episodeId,
    category,
    fallbackFromServer: server,
    fallbackReason: lastError?.message || "Aniwatch providers failed",
  });
  if (megaplayFallback) {
    return {
      ok: true as const,
      status: 200,
      body: { data: megaplayFallback, fromCache: false },
    };
  }

  const message = lastError?.message || (scraper ? "No playable sources were found for this episode" : "scraper unavailable");
  return {
    ok: false as const,
    status: scraper ? 502 : 503,
    body: { error: message },
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const result = await resolveEpisodeSources({
      animeEpisodeId: url.searchParams.get("animeEpisodeId"),
      category: (url.searchParams.get("category") as EpisodeCategory | null) || "sub",
      server: url.searchParams.get("server"),
    });

    return Response.json(result.body, { status: result.status });
  } catch (error: any) {
    console.error("[EPISODE_SOURCES] API Error:", {
      message: error?.message,
      stack: error?.stack,
    });
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
