import { readThroughCache } from "@/lib/hot-cache";
import { IAnimeData, SearchAnimeParams } from "@/types/anime";
import { IAnimeDetails } from "@/types/anime-details";
import { IEpisodes } from "@/types/episodes";

type AnimeBanner = {
  Media: {
    id: number;
    bannerImage: string | null;
  };
};

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

async function getHiAnime() {
  const mod = await import("@/lib/hianime");
  if (!mod?.getHiAnimeScraper) {
    throw new Error("hianime module unavailable");
  }
  const scraper = await mod.getHiAnimeScraper();
  if (!scraper) {
    throw new Error("hianime scraper unavailable");
  }
  return scraper;
}

export async function getCachedHomePageData() {
  return readThroughCache<IAnimeData>(
    {
      key: "home-page:v1",
      ttlSeconds: 60 * 5,
    },
    async () => {
      const hianime = await getHiAnime();
      return hianime.getHomePage();
    },
  );
}

export async function getCachedAnimeDetails(animeId: string) {
  return readThroughCache<IAnimeDetails>(
    {
      key: `anime-details:v1:${animeId}`,
      ttlSeconds: 60 * 30,
    },
    async () => {
      const hianime = await getHiAnime();
      return hianime.getInfo(animeId);
    },
  );
}

export async function getCachedAnimeEpisodes(animeId: string) {
  return readThroughCache<IEpisodes>(
    {
      key: `anime-episodes:v1:${animeId}`,
      ttlSeconds: 60 * 30,
    },
    async () => {
      const hianime = await getHiAnime();
      return hianime.getEpisodes(animeId);
    },
  );
}

export async function getCachedSearchResults(params: SearchAnimeParams) {
  const key = `anime-search:v1:${stableStringify(params)}`;
  return readThroughCache(
    {
      key,
      ttlSeconds: 60 * 5,
    },
    async () => {
      const hianime = await getHiAnime();
      return hianime.search(params.q, params.page, {
        type: params.type,
        status: params.status,
        rated: params.rated,
        season: params.season,
        language: params.language,
        sort: params.sort,
        genres: params.genres,
      });
    },
  );
}

export async function getCachedSearchSuggestions(query: string) {
  return readThroughCache(
    {
      key: `anime-search-suggestions:v1:${query.trim().toLowerCase()}`,
      ttlSeconds: 60 * 5,
    },
    async () => {
      const hianime = await getHiAnime();
      return hianime.searchSuggestions(query);
    },
  );
}

export async function getCachedAnimeBanner(anilistId: number) {
  return readThroughCache<AnimeBanner>(
    {
      key: `anime-banner:v1:${anilistId}`,
      ttlSeconds: 60 * 60 * 24,
    },
    async () => {
      const response = await fetch("https://graphql.anilist.co", {
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
}
