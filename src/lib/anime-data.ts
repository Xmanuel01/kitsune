import { readThroughCache } from "@/lib/hot-cache";
import { getAnikaiSearchSuggestions, searchAnikaiAnime } from "@/lib/anikai";
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

function titleFromSlug(slug: string) {
  return slug
    .split("?")[0]
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createFallbackAnimeDetails(animeId: string): IAnimeDetails {
  const title = titleFromSlug(animeId) || "Anime";
  return {
    anime: {
      info: {
        id: animeId,
        anilistId: 0,
        malId: 0,
        name: title,
        poster: "/icon.png",
        description:
          "Details are temporarily unavailable because the upstream anime source blocked this request. Please try again later.",
        stats: {
          rating: "",
          quality: "",
          episodes: {
            sub: 0,
            dub: 0,
          },
          type: "",
          duration: "",
        },
        promotionalVideos: [],
        charactersVoiceActors: [],
      },
      moreInfo: {
        japanese: "",
        synonyms: "",
        aired: "",
        premiered: "",
        duration: "",
        status: "",
        malscore: "",
        genres: [],
        studios: "",
        producers: [],
      },
    },
    seasons: [],
    mostPopularAnimes: [],
    relatedAnimes: [],
    recommendedAnimes: [],
  };
}

function createEmptyEpisodes(): IEpisodes {
  return {
    totalEpisodes: 0,
    episodes: [],
  };
}

function isAniwatchHomePageUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("getHomePage: fetchError") ||
    message.includes("Aniwatch scraper is unavailable") ||
    message.includes("Aniwatch request failed") ||
    message.includes("Aniwatch API request failed") ||
    message.includes("fetch failed") ||
    message.includes("ConnectTimeoutError") ||
    message.includes("UND_ERR_CONNECT_TIMEOUT")
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
        key: "home-page:v7",
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
  try {
    return await readThroughCache<IAnimeDetails>(
      {
        key: `anime-details:v4:${animeId}`,
        ttlSeconds: 60 * 30,
      },
      () => getAniwatchAnimeDetails(animeId),
    );
  } catch (error) {
    if (!isAniwatchHomePageUnavailable(error)) {
      throw error;
    }

    console.warn(
      `[ANIME_DETAILS] Falling back to minimal details for ${animeId}:`,
      error,
    );
    return createFallbackAnimeDetails(animeId);
  }
}

export async function getCachedAnimeEpisodes(animeId: string) {
  try {
    return await readThroughCache<IEpisodes>(
      {
        key: `anime-episodes:v6:${animeId}`,
        ttlSeconds: 60 * 30,
      },
      () => getAniwatchAnimeEpisodes(animeId),
    );
  } catch (error) {
    if (!isAniwatchHomePageUnavailable(error)) {
      throw error;
    }

    console.warn(
      `[ANIME_EPISODES] Falling back to empty episodes for ${animeId}:`,
      error,
    );
    return createEmptyEpisodes();
  }
}

export async function getCachedSearchResults(params: SearchAnimeParams) {
  const key = `anime-search:v4:${stableStringify(params)}`;
  return readThroughCache(
    {
      key,
      ttlSeconds: 60 * 5,
    },
    async () => {
      try {
        return await searchAnikaiAnime(params);
      } catch (error) {
        console.warn("[ANIME_SEARCH] AnimeKai search failed; falling back to Aniwatch:", error);
        return searchAniwatchAnime(params);
      }
    },
  );
}

export async function getCachedSearchSuggestions(query: string) {
  return readThroughCache(
    {
      key: `anime-search-suggestions:v4:${query.trim().toLowerCase()}`,
      ttlSeconds: 60 * 5,
    },
    async () => {
      try {
        return await getAnikaiSearchSuggestions(query);
      } catch (error) {
        console.warn(
          "[ANIME_SEARCH_SUGGESTIONS] AnimeKai suggestions failed; falling back to Aniwatch:",
          error,
        );
        return getAniwatchSearchSuggestions(query);
      }
    },
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
