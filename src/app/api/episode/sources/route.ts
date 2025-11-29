// src/app/api/episode/sources/route.ts

import { getHiAnimeScraper } from "@/lib/hianime";
import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs"; // important: aniwatch uses worker_threads, needs Node runtime

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

    const episodeId = sanitize(episodeIdRaw);
    const category: "sub" | "dub" | "raw" = categoryParam || "sub";
    const server = serverParam || "hd-1";

    console.debug("[EPISODE_SOURCES] incoming params:", {
      episodeIdRaw,
      episodeId,
      category,
      server,
    });

    if (!episodeId) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 },
      );
    }

    const compositeKey = makeKey(episodeId, category, server);
    const now = Date.now();

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
    const scraper = await getHiAnimeScraper();
    if (!scraper) {
      console.error("[EPISODE_SOURCES] HiAnime scraper unavailable");
      return Response.json({ error: "scraper unavailable" }, { status: 503 });
    }

    let data: any;
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
      const message = scrapeErr?.message || "scrape failed";
      return Response.json(
        { error: `scraper error: ${message}` },
        { status: 502 },
      );
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

    return Response.json({ data, fromCache: false });
  } catch (err: any) {
    console.error("[EPISODE_SOURCES] API Error:", {
      message: err?.message,
      stack: err?.stack,
    });
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
