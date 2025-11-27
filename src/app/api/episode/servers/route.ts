// src/app/api/episode/servers/route.ts

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const animeEpisodeIdRaw = searchParams.get("animeEpisodeId");

    if (!animeEpisodeIdRaw) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 }
      );
    }

    // Sanitize incoming id: decode if needed and only allow base + optional '?ep=digits'
    const sanitize = (raw?: string | null) => {
      if (!raw) return null;
      let decoded = String(raw);
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        // ignore bad encodings
      }
      const m = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
      if (!m) return decoded.split("?")[0];
      return m[1] + (m[3] ? `?ep=${m[3]}` : "");
    };

    const animeEpisodeId = sanitize(animeEpisodeIdRaw)!;

    const mod = await import("@/lib/hianime");
    const { hianime } = mod;

    if (!hianime) {
      console.error("[EPISODE_SERVERS] HiAnime scraper unavailable");
      return Response.json(
        { error: "scraper unavailable" },
        { status: 503 }
      );
    }

    const data = await hianime.getEpisodeServers(animeEpisodeId);

    return Response.json({ data });
  } catch (err: any) {
    console.error("[EPISODE_SERVERS] API Error:", {
      message: err?.message,
      stack: err?.stack,
    });
    return Response.json(
      { error: "something went wrong" },
      { status: 500 }
    );
  }
}
