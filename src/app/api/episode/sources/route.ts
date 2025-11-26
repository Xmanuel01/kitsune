// src/app/api/episode/sources/route.ts
import { getHiAnimeScraper } from "@/lib/hianime";
import PocketBase from "pocketbase";

const PB_BASE_URL =
  process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;

if (!PB_BASE_URL) {
  // Hard fail at startup if misconfigured
  console.error(
    "PocketBase misconfigured: set POCKETBASE_URL or NEXT_PUBLIC_POCKETBASE_URL",
  );
  throw new Error(
    "PocketBase URL not configured (POCKETBASE_URL or NEXT_PUBLIC_POCKETBASE_URL)",
  );
}

const pb = new PocketBase(PB_BASE_URL);

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

    console.debug("GET /api/episode/sources params:", {
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

    // --- ADMIN AUTH WITH SAFETY CHECKS ---
    const adminEmail = process.env.PB_ADMIN_EMAIL;
    const adminPassword = process.env.PB_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.error("PocketBase admin env missing", {
        hasEmail: !!adminEmail,
        hasPassword: !!adminPassword,
      });
      return Response.json(
        { error: "PocketBase admin credentials not configured" },
        { status: 500 },
      );
    }

    if (!pb.authStore.isValid) {
      try {
        await pb.admins.authWithPassword(adminEmail, adminPassword);
      } catch (authErr: any) {
        console.error("PocketBase admin auth failed", {
          baseUrl: PB_BASE_URL,
          identity: adminEmail,
          message: authErr?.message,
          status: authErr?.status,
          response: authErr?.response ?? authErr?.data,
        });
        return Response.json(
          { error: "PocketBase authentication failed" },
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
        return Response.json({ data: cached.data, fromCache: true });
      }
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
    } catch (scrapeErr: any) {
      console.error("Error during scraper.getEpisodeSources:", {
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
        await pb.collection("episode_sources").update(cached.id, recordPayload);
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
