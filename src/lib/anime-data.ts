import { readThroughCache } from "@/lib/hot-cache";
import {
  getAniwatchAnimeDetails,
  getAniwatchAnimeEpisodes,
  getAniwatchAnimeSchedule,
  getAniwatchHomePageData,
  getAniwatchSearchSuggestions,
  searchAniwatchAnime,
} from "@/lib/aniwatch-wp";
import { IAnimeData, SearchAnimeParams } from "@/types/anime";
import { IAnimeDetails } from "@/types/anime-details";
import { IAnimeSchedule } from "@/types/anime-schedule";
import { IEpisodes } from "@/types/episodes";

type AnimeBanner = {
  Media: {
    id: number;
    bannerImage: string | null;
  };
};

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

function isAniwatchHomePageUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("getHomePage: fetchError") ||
    message.includes("Aniwatch scraper is unavailable")
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export async function getCachedHomePageData() {
  try {
    return await readThroughCache<IAnimeData>(
      {
        key: "home-page:v6",
        ttlSeconds: 60 * 5,
      },
      () => getAniwatchHomePageData(),
    );
  } catch (error) {
    if (!isAniwatchHomePageUnavailable(error)) {
      throw error;
    }

    console.warn(
      "[HOME_PAGE] Falling back to an empty home payload after scraper failure:",
      error,
    );
    return createEmptyAnimeData();
  }
}

export async function getCachedAnimeDetails(animeId: string) {
  return readThroughCache<IAnimeDetails>(
    {
      key: `anime-details:v4:${animeId}`,
      ttlSeconds: 60 * 30,
    },
    () => getAniwatchAnimeDetails(animeId),
  );
}

export async function getCachedAnimeEpisodes(animeId: string) {
  return readThroughCache<IEpisodes>(
    {
      key: `anime-episodes:v4:${animeId}`,
      ttlSeconds: 60 * 30,
    },
    () => getAniwatchAnimeEpisodes(animeId),
  );
}

export async function getCachedSearchResults(params: SearchAnimeParams) {
  const key = `anime-search:v4:${stableStringify(params)}`;
  return readThroughCache(
    {
      key,
      ttlSeconds: 60 * 5,
    },
    () => searchAniwatchAnime(params),
  );
}

export async function getCachedSearchSuggestions(query: string) {
  return readThroughCache(
    {
      key: `anime-search-suggestions:v4:${query.trim().toLowerCase()}`,
      ttlSeconds: 60 * 5,
    },
    () => getAniwatchSearchSuggestions(query),
  );
}

export async function getCachedAnimeSchedule(date?: string) {
  return readThroughCache<IAnimeSchedule>(
    {
      key: `anime-schedule:v4:${date || "today"}`,
      ttlSeconds: 60 * 10,
    },
    () => getAniwatchAnimeSchedule(date),
  );
}

export async function getCachedAnimeBanner(anilistId: number) {
  try {
    return await readThroughCache<AnimeBanner>(
      {
        key: `anime-banner:v1:${anilistId}`,
        ttlSeconds: 60 * 60 * 24,
      },
      async () => {
        const response = await fetch("https://graphql.anilist.co/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: `
              query ($id: Int) {
                Media(id: $id, type: ANIME) {
                  id
                  bannerImage
                }
              }
            `,
            variables: {
              id: anilistId,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`AniList banner request failed: ${response.status}`);
        }

        const payload = await response.json();
        return payload.data as AnimeBanner;
      },
    );
  } catch (error) {
    console.warn(`Failed to load AniList banner for id ${anilistId}:`, error);
    return {
      Media: {
        id: anilistId,
        bannerImage: null,
      },
    };
  }
}
