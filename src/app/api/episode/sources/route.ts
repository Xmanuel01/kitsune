import { getHiAnimeScraper } from "@/lib/hianime";
import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL!);

// Cache TTL: 30 minutes (change if you want)
const CACHE_TTL_SECONDS = 60 * 30;

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

    // Helpful debug logging for incoming requests (shows raw and sanitized IDs)
    console.debug("GET /api/episode/sources params:", {
      episodeIdRaw,
      episodeId,
      category,
      server,
    });

    if (!episodeId) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 }
      );
    }

    const compositeKey = makeKey(episodeId, category, server);
    const now = Date.now();

    // Authenticate once as admin (reuse token while valid)
    if (!pb.authStore.isValid) {
      try {
        await pb.admins.authWithPassword(
          process.env.PB_ADMIN_EMAIL!,
          process.env.PB_ADMIN_PASSWORD!
        );
      } catch (authErr) {
        // Log detailed auth error for debugging, but avoid leaking secrets in responses
        console.error('PocketBase admin auth failed', {
          message: (authErr as any)?.message,
          response: (authErr as any)?.response?.data ?? (authErr as any)?.response,
        });
        return Response.json(
          { error: 'PocketBase authentication failed' },
          { status: 503 },
        );
      }
    }

    // 1) Try PocketBase cache
    let cached: any = null;
    try {
      cached = await pb
        .collection("episode_sources")
        .getFirstListItem(`compositeKey="${compositeKey}"`);
    } catch {
      // not found is fine → fall through to scrape
    }

    if (cached && cached.data) {
      const fetchedAtMs = cached.fetchedAt
        ? new Date(cached.fetchedAt).getTime()
        : 0;
      const ageSeconds = (now - fetchedAtMs) / 1000;

      if (ageSeconds < CACHE_TTL_SECONDS) {
        // fresh cache hit
        return Response.json({ data: cached.data, fromCache: true });
      }
      // else → stale, rescrape below
    }

    // 2) Scrape fresh data
    const scraper = await getHiAnimeScraper();
    if (!scraper) {
      console.error("HiAnime scraper unavailable");
      return Response.json({ error: "scraper unavailable" }, { status: 503 });
    }

    let data: any;
    try {
      data = await scraper.getEpisodeSources(episodeId, undefined, category);
    } catch (scrapeErr) {
      // Log the full error for debugging and return a useful message/status
      console.error("Error during scraper.getEpisodeSources:", {
        episodeId,
        category,
        server,
        message: (scrapeErr as Error).message,
        stack: (scrapeErr as Error).stack,
      });
      const message = (scrapeErr as any)?.message || "scrape failed";
      return Response.json({ error: `scraper error: ${message}` }, { status: 502 });
    }

    // 3) Upsert into PocketBase
    const recordPayload = {
      compositeKey,
      animeEpisodeId: episodeId,
      category,
      server,
      data,
      fetchedAt: new Date().toISOString(),
    };

    try {
      if (cached) {
        await pb
          .collection("episode_sources")
          .update(cached.id, recordPayload);
      } else {
        await pb.collection("episode_sources").create(recordPayload);
      }
    } catch (err) {
      console.error("Failed to upsert episode_sources:", err);
      // still return data to the client even if cache save fails
    }

    return Response.json({ data, fromCache: false });
  } catch (err) {
    console.error("EPISODE SOURCE ERROR:", err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
