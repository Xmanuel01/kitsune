// src/app/api/episode/sources/route.ts

import { getAniwatchScraper } from "@/lib/aniwatch";
import { getGogoanimeEpisodeSource } from "@/lib/gogoanime";
import { isGogoBackupServerName } from "@/lib/provider-constants";
import { getCachedValue, setCachedValue } from "@/lib/hot-cache";
import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs"; // important: aniwatch uses worker_threads, needs Node runtime
export const dynamic = "force-dynamic";

// Cache TTL: 30 minutes
const CACHE_TTL_SECONDS = 60 * 30;

const makeKey = (episodeId: string, category: string, server: string) =>
  `${episodeId}::${category}::${server}`;

const sanitize = (raw?: string | null) => {
  if (!raw) return null;

  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore decode errors (already decoded or malformed)
  }

  // Keep base id + optional ?ep=123; strip anything else
  const m = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!m) return decoded.split("?")[0];
  return m[1] + (m[3] ? `?ep=${m[3]}` : "");
};

const isDirectGogoEpisodeId = (value: string) =>
  /^https?:\/\/[^/]*gogoanime\.by\//i.test(value) && !/\/series\//i.test(value);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const episodeIdRaw = url.searchParams.get("animeEpisodeId");
    const categoryParam = url.searchParams.get("category") as
      | "sub"
      | "dub"
      | "raw"
      | null;
    const serverParam = url.searchParams.get("server");
    const episodeNumberParam = url.searchParams.get("episodeNumber");

    const episodeId = sanitize(episodeIdRaw);
    const category: "sub" | "dub" | "raw" = categoryParam || "sub";
    const server = serverParam || "hd-1";
    const episodeNumber = episodeNumberParam ? Number(episodeNumberParam) : NaN;
    const isGogoRequest = isGogoBackupServerName(server);

    console.debug("[EPISODE_SOURCES] incoming params:", {
      episodeIdRaw,
      episodeId,
      category,
      server,
      episodeNumber,
    });

    if (!episodeId) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 },
      );
    }

    const compositeKey = makeKey(episodeId, category, server);
    const now = Date.now();
    const hotCacheKey = `episode-source:v1:${compositeKey}`;

    const hotCached = await getCachedValue<any>({
      key: hotCacheKey,
    });
    if (hotCached) {
      console.debug("[EPISODE_SOURCES] returning hot cached data", compositeKey);
      return Response.json({ data: hotCached, fromCache: true, tier: "hot" });
    }

    // 1) Try Supabase cache (table: episode_sources) using compositeKey
    let cached: any = null;
    try {
      const { data: existing, error } = await supabaseAdmin
        .from("episode_sources")
        .select("*")
        .eq("compositeKey", compositeKey)
        .maybeSingle();

      if (error) {
        console.warn(
          "[EPISODE_SOURCES] Supabase select error:",
          error.message || error,
        );
      } else if (existing) {
        cached = existing;
      }
    } catch (err) {
      console.warn("[EPISODE_SOURCES] Supabase cache read failed:", err);
    }

    if (cached && cached.data) {
      const fetchedAtMs = cached.fetchedAt
        ? new Date(cached.fetchedAt).getTime()
        : 0;
      const ageSeconds = (now - fetchedAtMs) / 1000;

      if (ageSeconds < CACHE_TTL_SECONDS) {
        await setCachedValue(
          {
            key: hotCacheKey,
            ttlSeconds: CACHE_TTL_SECONDS,
          },
          cached.data,
        );
        console.debug(
          "[EPISODE_SOURCES] returning cached data",
          compositeKey,
          `age=${ageSeconds}s`,
        );
        return Response.json({ data: cached.data, fromCache: true });
      } else {
        console.debug(
          "[EPISODE_SOURCES] cache expired, refetching",
          compositeKey,
          `age=${ageSeconds}s`,
        );
      }
    }

    // 2) Scrape fresh data
    let data: any;
    let shouldPersistToCache = true;

    if (isGogoRequest) {
      const gogoEpisodeUrl = isDirectGogoEpisodeId(episodeId) ? episodeId : undefined;
      if (!gogoEpisodeUrl && (!Number.isFinite(episodeNumber) || episodeNumber <= 0)) {
        return Response.json(
          { error: "episodeNumber is required for the gogoanime backup provider" },
          { status: 400 },
        );
      }

      const resolved = await getGogoanimeEpisodeSource({
        primaryAnimeId: episodeId.split("?")[0],
        episodeNumber,
        category,
        episodePageUrl: gogoEpisodeUrl,
      });

      data = {
        headers: {
          Referer: resolved.episodePageUrl,
        },
        tracks: [],
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
        sources: [],
        anilistID: 0,
        malID: 0,
        provider: resolved.provider,
        iframeUrl: resolved.iframeUrl,
      };
    } else {
      const scraper = await getAniwatchScraper();
      if (!scraper) {
        console.error("[EPISODE_SOURCES] Aniwatch scraper unavailable");
        return Response.json({ error: "scraper unavailable" }, { status: 503 });
      }

      try {
        // IMPORTANT: pass server + category to match aniwatch signature:
        // getEpisodeSources(id, server?, category?)
        data = await scraper.getEpisodeSources(episodeId, server, category);
      } catch (scrapeErr: any) {
        console.error("[EPISODE_SOURCES] scraper.getEpisodeSources error:", {
          episodeId,
          category,
          server,
          message: scrapeErr?.message,
          stack: scrapeErr?.stack,
        });

        if (Number.isFinite(episodeNumber) && episodeNumber > 0) {
          try {
            const resolved = await getGogoanimeEpisodeSource({
              primaryAnimeId: episodeId.split("?")[0],
              episodeNumber,
              category,
              episodePageUrl: isDirectGogoEpisodeId(episodeId) ? episodeId : undefined,
            });

            shouldPersistToCache = false;
            data = {
              headers: {
                Referer: resolved.episodePageUrl,
              },
              tracks: [],
              intro: { start: 0, end: 0 },
              outro: { start: 0, end: 0 },
              sources: [],
              anilistID: 0,
              malID: 0,
              provider: resolved.provider,
              iframeUrl: resolved.iframeUrl,
              fallbackFromServer: server,
              fallbackReason: scrapeErr?.message || "aniwatch scrape failed",
            };
          } catch (gogoErr: any) {
            console.error("[EPISODE_SOURCES] gogo fallback error:", {
              episodeId,
              category,
              server,
              message: gogoErr?.message,
              stack: gogoErr?.stack,
            });
            const message = scrapeErr?.message || "scrape failed";
            return Response.json(
              { error: `scraper error: ${message}` },
              { status: 502 },
            );
          }
        } else {
          const message = scrapeErr?.message || "scrape failed";
          return Response.json(
            { error: `scraper error: ${message}` },
            { status: 502 },
          );
        }
      }

      if (!data?.iframeUrl && (!Array.isArray(data?.sources) || !data.sources.length)) {
        if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
          return Response.json(
            { error: "No playable sources were found for this episode" },
            { status: 502 },
          );
        }

        const resolved = await getGogoanimeEpisodeSource({
          primaryAnimeId: episodeId.split("?")[0],
          episodeNumber,
          category,
          episodePageUrl: isDirectGogoEpisodeId(episodeId) ? episodeId : undefined,
        });

        shouldPersistToCache = false;
        data = {
          headers: {
            Referer: resolved.episodePageUrl,
          },
          tracks: [],
          intro: { start: 0, end: 0 },
          outro: { start: 0, end: 0 },
          sources: [],
          anilistID: 0,
          malID: 0,
          provider: resolved.provider,
          iframeUrl: resolved.iframeUrl,
          fallbackFromServer: server,
          fallbackReason: "aniwatch returned no playable sources",
        };
      }
    }

    // 3) Upsert into Supabase `episode_sources` table using compositeKey as unique key
    const recordPayload = {
      compositeKey,
      animeEpisodeId: episodeId,
      category,
      server,
      data,
      fetchedAt: new Date().toISOString(),
    };

    if (shouldPersistToCache) {
      try {
        const { error } = await supabaseAdmin
          .from("episode_sources")
          .upsert(recordPayload, { onConflict: "compositeKey" });

        if (error) {
          console.warn(
            "[EPISODE_SOURCES] Supabase upsert error:",
            error.message || error,
          );
        } else {
          console.debug("[EPISODE_SOURCES] cache upserted:", compositeKey);
        }
      } catch (err) {
        console.error(
          "[EPISODE_SOURCES] Failed to upsert episode_sources into Supabase:",
          err,
        );
        // Still return data even if cache save fails
      }
    }

    await setCachedValue(
      {
        key: hotCacheKey,
        ttlSeconds: CACHE_TTL_SECONDS,
      },
      data,
    );

    return Response.json({ data, fromCache: false });
  } catch (err: any) {
    console.error("[EPISODE_SOURCES] API Error:", {
      message: err?.message,
      stack: err?.stack,
    });
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
