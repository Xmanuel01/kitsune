// src/app/api/episode/prewarm/route.ts
import { getHiAnimeScraper } from "@/lib/hianime";
import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs";
// Optional but nice: always treat this as dynamic
export const dynamic = "force-dynamic";

// Reuse same TTL as /api/episode/sources
const CACHE_TTL_SECONDS = 60 * 30; // 30 minutes

// Same compositeKey logic as in /episode/sources
const makeKey = (episodeId: string, category: string, server: string) =>
  `${episodeId}::${category}::${server}`;

const sanitize = (raw?: string | null) => {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore decode errors
  }
  // Keep base id + optional ?ep=123; strip anything else
  const m = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!m) return decoded.split("?")[0];
  return m[1] + (m[3] ? `?ep=${m[3]}` : "");
};

async function prewarmEpisodes(
  episodeIds: string[],
  category: "sub" | "dub" | "raw",
  server: string,
) {
  try {
    const scraper = await getHiAnimeScraper();
    if (!scraper) {
      console.error("[EPISODE_PREWARM] HiAnime scraper unavailable");
      return;
    }

    const now = Date.now();

    for (const rawId of episodeIds) {
      const episodeId = sanitize(rawId);
      if (!episodeId) continue;

      const key = makeKey(episodeId, category, server);

      // 1) Check Supabase cache
      let cached: any = null;
      try {
        const { data: existing, error } = await supabaseAdmin
          .from("episode_sources")
          .select("*")
          .eq("compositeKey", key)
          .maybeSingle();

        if (error) {
          console.warn(
            "[EPISODE_PREWARM] Supabase select error:",
            error.message || error,
          );
        } else if (existing) {
          cached = existing;
        }
      } catch (e) {
        console.warn("[EPISODE_PREWARM] Supabase cache read failed:", e);
      }

      if (cached && cached.data) {
        const fetchedAtMs = cached.fetchedAt
          ? new Date(cached.fetchedAt).getTime()
          : 0;
        const ageSeconds = (now - fetchedAtMs) / 1000;
        if (ageSeconds < CACHE_TTL_SECONDS) {
          // Still fresh; skip scraping
          console.debug(
            "[EPISODE_PREWARM] cache fresh, skip:",
            key,
            `age=${ageSeconds}s`,
          );
          continue;
        }
      }

      // 2) Fetch from scraper
      console.log(
        `[EPISODE_PREWARM] scraping ${episodeId} (${category}, ${server})`,
      );

      let data: any;
      try {
        // Important: pass server + category to match getEpisodeSources(id, server?, category?)
        data = await scraper.getEpisodeSources(episodeId, server, category);
      } catch (e: any) {
        console.error("[EPISODE_PREWARM] scraper error:", {
          episodeId,
          category,
          server,
          message: e?.message,
          stack: e?.stack,
        });
        continue; // skip this one, move to next
      }

      const recordPayload = {
        compositeKey: key,
        animeEpisodeId: episodeId,
        category,
        server,
        data,
        fetchedAt: new Date().toISOString(),
      };

      // 3) Upsert in Supabase
      try {
        const { error } = await supabaseAdmin
          .from("episode_sources")
          .upsert(recordPayload, { onConflict: "compositeKey" });

        if (error) {
          console.warn(
            "[EPISODE_PREWARM] Supabase upsert error:",
            error.message || error,
          );
        } else {
          console.debug("[EPISODE_PREWARM] cache upserted:", key);
        }
      } catch (e) {
        console.error("[EPISODE_PREWARM] Supabase upsert failed:", e);
      }
    }
  } catch (err) {
    console.error("[EPISODE_PREWARM] Error in prewarmEpisodes:", err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const episodeIds = body.episodeIds as string[] | undefined;
    const category = (body.category as "sub" | "dub" | "raw") ?? "sub";
    const server = (body.server as string) ?? "hd-1";

    if (!Array.isArray(episodeIds) || episodeIds.length === 0) {
      return Response.json(
        { error: "episodeIds must be a non-empty array" },
        { status: 400 },
      );
    }

    // Fire-and-forget: don't block the response while scraping
    prewarmEpisodes(episodeIds, category, server).catch((err) =>
      console.error("[EPISODE_PREWARM] background error:", err),
    );

    return Response.json({ status: "scheduled", count: episodeIds.length });
  } catch (err) {
    console.error("[EPISODE_PREWARM] route error:", err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
