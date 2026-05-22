import { getCachedHomePageData } from "@/lib/anime-data";
import { IAnimeData } from "@/types/anime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createEmptyAnimeData(): IAnimeData {
  return {
    spotlightAnimes: [],
    trendingAnimes: [],
    latestEpisodeAnimes: [],
    topUpcomingAnimes: [],
    top10Animes: {
      today: [],
      week: [],
      month: [],
    },
    topAiringAnimes: [],
    mostPopularAnimes: [],
    mostFavoriteAnimes: [],
    latestCompletedAnimes: [],
    genres: [],
  };
}

export async function GET() {
  try {
    const data = await getCachedHomePageData();
    return Response.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch (err) {
    console.error("[HOME_API] Returning empty home payload after failure:", err);
    return Response.json(
      { data: createEmptyAnimeData(), degraded: true },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }
}
