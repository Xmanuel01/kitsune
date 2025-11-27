// src/app/api/episode/prewarm/route.ts
import { getHiAnimeScraper } from "@/lib/hianime";
import { supabaseAdmin } from "@/lib/supabaseClient";

// reuse same TTL as your /episode/sources route
const CACHE_TTL_SECONDS = 60 * 30; // 30 minutes

// same compositeKey logic you used when defining episode_sources
const makeKey = (episodeId: string, category: string, server: string) =>
  `${episodeId}::${category}::${server}`;

const sanitize = (raw?: string | null) => {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
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
      console.error("HiAnime scraper unavailable for prewarm");
      return;
    }

    // Using Supabase Admin client (service role) — no admin email/pass required

    const now = Date.now();

    for (const rawId of episodeIds) {
      const episodeId = sanitize(rawId);
      if (!episodeId) continue;

      const key = makeKey(episodeId, category, server);

      // 1) check Supabase cache
      let cached = null;
      try {
        const { data: existing, error } = await supabaseAdmin
          .from('episode_sources')
          .select('*')
          .eq('compositeKey', key)
          .maybeSingle();
        if (error) console.warn('Supabase select error', error.message || error);
        cached = existing || null;
      } catch (e) {
        console.warn('Supabase cache read failed', e);
      }

      if (cached) {
        const fetchedAtMs = cached.fetchedAt
          ? new Date(cached.fetchedAt).getTime()
          : 0;
        const ageSeconds = (now - fetchedAtMs) / 1000;
        if (ageSeconds < CACHE_TTL_SECONDS && cached.data) {
          // still fresh, skip
          continue;
        }
      }

      // 2) fetch from scraper
      console.log(`[prewarm] scraping ${episodeId} (${category}, ${server})`);

      const data = await scraper.getEpisodeSources(episodeId, server, category);

      const recordPayload = {
        compositeKey: key,
        animeEpisodeId: episodeId,
        category,
        server,
        data,
        fetchedAt: new Date().toISOString(),
      };

      // 3) upsert in Supabase
      try {
        const { error } = await supabaseAdmin.from('episode_sources').upsert(recordPayload, { onConflict: 'compositeKey' });
        if (error) console.warn('Supabase upsert error', error.message || error);
      } catch (e) {
        console.error('Supabase upsert failed', e);
      }
    }
  } catch (err) {
    console.error("Error in prewarmEpisodes:", err);
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
    prewarmEpisodes(episodeIds, category, server).catch(console.error);

    return Response.json({ status: "scheduled", count: episodeIds.length });
  } catch (err) {
    console.error("prewarm route error:", err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
