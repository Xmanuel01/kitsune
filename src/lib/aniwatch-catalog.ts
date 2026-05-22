import { getAniwatchScraper } from "@/lib/aniwatch";
import { IAnime, IAnimeData, IAnimeSearch, ISuggestionAnime, LatestCompletedAnime, SearchAnimeParams, SpotlightAnime, Top10Animes, TopUpcomingAnime, Type } from "@/types/anime";
import { IAnimeDetails, RecommendedAnime, RelatedAnime, Season } from "@/types/anime-details";
import { IAnimeSchedule } from "@/types/anime-schedule";
import { Episode, IEpisodes } from "@/types/episodes";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function normalizeEpisodes(episodes?: { sub?: number | null; dub?: number | null }) {
  return {
    sub: episodes?.sub ?? null,
    dub: episodes?.dub ?? null,
  };
}

function normalizeEpisodesStrict(episodes?: { sub?: number | null; dub?: number | null }) {
  return {
    sub: episodes?.sub ?? 0,
    dub: episodes?.dub ?? 0,
  };
}

function normalizeType(value?: string | null) {
  const normalized = normalizeText(value).trim().toUpperCase();
  if (normalized === "TV") return Type.Tv;
  if (normalized === "MOVIE") return Type.Movie;
  if (normalized === "ONA") return Type.Ona;
  return (value as Type | undefined) || undefined;
}

function mapAnimeCard(anime: any): IAnime {
  return {
    id: normalizeText(anime?.id),
    name: normalizeText(anime?.name),
    jname: normalizeText(anime?.jname || anime?.name),
    poster: normalizeText(anime?.poster),
    episodes: normalizeEpisodes(anime?.episodes),
    type: normalizeType(anime?.type),
    rank: typeof anime?.rank === "number" ? anime.rank : undefined,
  };
}

function mapLatestAnime(anime: any): LatestCompletedAnime {
  return {
    ...mapAnimeCard(anime),
    duration: normalizeText(anime?.duration) || undefined,
    rating: anime?.rating == null ? null : normalizeText(anime?.rating),
    episodeId: normalizeText(anime?.episodeId) || undefined,
  };
}

function mapSpotlightAnime(anime: any): SpotlightAnime {
  const base = mapAnimeCard(anime);
  return {
    ...base,
    rank: typeof anime?.rank === "number" ? anime.rank : 0,
    description: normalizeText(anime?.description),
    type: base.type || Type.Tv,
    otherInfo: Array.isArray(anime?.otherInfo)
      ? anime.otherInfo.map((entry: unknown) => normalizeText(entry)).filter(Boolean)
      : [],
  };
}

function mapTopUpcomingAnime(anime: any): TopUpcomingAnime {
  return {
    ...mapAnimeCard(anime),
    duration: normalizeText(anime?.duration),
    type: normalizeText(anime?.type),
    rating: anime?.rating == null ? null : normalizeText(anime?.rating),
  };
}

function mapRecommendedAnime(anime: any): RecommendedAnime {
  return {
    id: normalizeText(anime?.id),
    name: normalizeText(anime?.name),
    jname: normalizeText(anime?.jname || anime?.name),
    poster: normalizeText(anime?.poster),
    episodes: normalizeEpisodesStrict(anime?.episodes),
    duration: normalizeText(anime?.duration),
    type: normalizeText(anime?.type),
    rating: anime?.rating == null ? "" : normalizeText(anime?.rating),
  };
}

function mapRelatedAnime(anime: any): RelatedAnime {
  return {
    id: normalizeText(anime?.id),
    name: normalizeText(anime?.name),
    jname: normalizeText(anime?.jname || anime?.name),
    poster: normalizeText(anime?.poster),
    episodes: normalizeEpisodesStrict(anime?.episodes),
    type: normalizeText(anime?.type),
  };
}

function mapMostPopularDetailAnime(anime: any) {
  return {
    id: normalizeText(anime?.id),
    name: normalizeText(anime?.name),
    jname: normalizeText(anime?.jname || anime?.name),
    poster: normalizeText(anime?.poster),
    episodes: normalizeEpisodesStrict(anime?.episodes),
    type: normalizeText(anime?.type),
  };
}

function mapSeason(anime: any): Season {
  return {
    id: normalizeText(anime?.id),
    name: normalizeText(anime?.name),
    title: normalizeText(anime?.title),
    poster: normalizeText(anime?.poster),
    isCurrent: Boolean(anime?.isCurrent),
  };
}

async function getScraper() {
  const scraper = await getAniwatchScraper();
  if (!scraper) {
    throw new Error("Aniwatch scraper is unavailable");
  }
  return scraper;
}

export async function getAniwatchHomePageData(): Promise<IAnimeData> {
  const scraper = await getScraper();
  const data = await scraper.getHomePage();

  const top10Animes: Top10Animes = {
    today: data.top10Animes.today.map(mapLatestAnime),
    week: data.top10Animes.week.map(mapAnimeCard),
    month: data.top10Animes.month.map(mapLatestAnime),
  };

  return {
    spotlightAnimes: data.spotlightAnimes.map(mapSpotlightAnime),
    trendingAnimes: data.trendingAnimes.map(mapAnimeCard),
    latestEpisodeAnimes: data.latestEpisodeAnimes.map(mapLatestAnime),
    topUpcomingAnimes: data.topUpcomingAnimes.map(mapTopUpcomingAnime),
    top10Animes,
    topAiringAnimes: data.topAiringAnimes.map(mapLatestAnime),
    mostPopularAnimes: data.mostPopularAnimes.map(mapAnimeCard),
    mostFavoriteAnimes: data.mostFavoriteAnimes.map(mapAnimeCard),
    latestCompletedAnimes: data.latestCompletedAnimes.map(mapLatestAnime),
    genres: Array.isArray(data.genres)
      ? data.genres.map((genre: unknown) => normalizeText(genre)).filter(Boolean)
      : [],
  };
}

export async function getAniwatchAnimeDetails(animeId: string): Promise<IAnimeDetails> {
  const scraper = await getScraper();
  const data = await scraper.getInfo(animeId);

  return {
    anime: {
      info: {
        id: normalizeText(data.anime.info.id),
        anilistId: data.anime.info.anilistId ?? 0,
        malId: data.anime.info.malId ?? 0,
        name: normalizeText(data.anime.info.name),
        poster: normalizeText(data.anime.info.poster),
        description: normalizeText(data.anime.info.description),
        stats: {
          rating: normalizeText(data.anime.info.stats.rating),
          quality: normalizeText(data.anime.info.stats.quality),
          episodes: normalizeEpisodesStrict(data.anime.info.stats.episodes),
          type: normalizeText(data.anime.info.stats.type),
          duration: normalizeText(data.anime.info.stats.duration),
        },
        promotionalVideos: Array.isArray(data.anime.info.promotionalVideos)
          ? data.anime.info.promotionalVideos.map((video: any) => ({
              title: normalizeText(video.title),
              source: normalizeText(video.source),
              thumbnail: normalizeText(video.thumbnail),
            }))
          : [],
        charactersVoiceActors: Array.isArray(data.anime.info.charactersVoiceActors)
          ? data.anime.info.charactersVoiceActors.map((entry: any) => ({
              character: {
                id: normalizeText(entry.character.id),
                poster: normalizeText(entry.character.poster),
                name: normalizeText(entry.character.name),
                cast: normalizeText(entry.character.cast),
              },
              voiceActor: {
                id: normalizeText(entry.voiceActor.id),
                poster: normalizeText(entry.voiceActor.poster),
                name: normalizeText(entry.voiceActor.name),
                cast: normalizeText(entry.voiceActor.cast),
              },
            }))
          : [],
      },
      moreInfo: {
        japanese: normalizeText(data.anime.moreInfo.japanese),
        synonyms: normalizeText(data.anime.moreInfo.synonyms),
        aired: normalizeText(data.anime.moreInfo.aired),
        premiered: normalizeText(data.anime.moreInfo.premiered),
        duration: normalizeText(data.anime.moreInfo.duration),
        status: normalizeText(data.anime.moreInfo.status),
        malscore: normalizeText(data.anime.moreInfo.malscore),
        genres: Array.isArray(data.anime.moreInfo.genres)
          ? data.anime.moreInfo.genres
              .map((genre: unknown) => normalizeText(genre))
              .filter(Boolean)
          : [],
        studios: normalizeText(data.anime.moreInfo.studios),
        producers: Array.isArray(data.anime.moreInfo.producers)
          ? data.anime.moreInfo.producers
              .map((producer: unknown) => normalizeText(producer))
              .filter(Boolean)
          : [],
      },
    },
    seasons: Array.isArray(data.seasons) ? data.seasons.map(mapSeason) : [],
    mostPopularAnimes: Array.isArray(data.mostPopularAnimes)
      ? data.mostPopularAnimes.map(mapMostPopularDetailAnime)
      : [],
    relatedAnimes: Array.isArray(data.relatedAnimes)
      ? data.relatedAnimes.map(mapRelatedAnime)
      : [],
    recommendedAnimes: Array.isArray(data.recommendedAnimes)
      ? data.recommendedAnimes.map(mapRecommendedAnime)
      : [],
  };
}

export async function getAniwatchAnimeEpisodes(animeId: string): Promise<IEpisodes> {
  const scraper = await getScraper();
  const data = await scraper.getEpisodes(animeId);

  return {
    totalEpisodes: data.totalEpisodes ?? 0,
    episodes: Array.isArray(data.episodes)
      ? data.episodes.map((episode: Episode) => ({
          title: normalizeText(episode.title),
          episodeId: normalizeText(episode.episodeId),
          number: Number(episode.number) || 0,
          isFiller: Boolean(episode.isFiller),
        }))
      : [],
  };
}

export async function searchAniwatchAnime(
  params: SearchAnimeParams,
): Promise<IAnimeSearch> {
  const scraper = await getScraper();
  const data = await scraper.search(params.q, params.page || 1, {
    type: params.type,
    status: params.status,
    rated: params.rated,
    season: params.season,
    language: params.language,
    sort: params.sort,
    genres: params.genres,
  });

  return {
    animes: Array.isArray(data.animes) ? data.animes.map(mapAnimeCard) : [],
    totalPages: data.totalPages ?? 1,
    hasNextPage: Boolean(data.hasNextPage),
    currentPage: data.currentPage ?? 1,
  };
}

export async function getAniwatchSearchSuggestions(query: string) {
  const scraper = await getScraper();
  const data = await scraper.searchSuggestions(query);

  return {
    suggestions: Array.isArray(data.suggestions)
      ? data.suggestions.map((anime: any) => ({
          id: normalizeText(anime.id),
          name: normalizeText(anime.name),
          jname: normalizeText(anime.jname || anime.name),
          poster: normalizeText(anime.poster),
          moreInfo: Array.isArray(anime.moreInfo)
            ? anime.moreInfo
                .map((entry: unknown) => normalizeText(entry))
                .filter(Boolean)
            : [],
          episodes: {
            sub: null,
            dub: null,
          },
          type: undefined,
          rank: undefined,
        } satisfies ISuggestionAnime))
      : [],
  };
}

export async function getAniwatchAnimeSchedule(date?: string): Promise<IAnimeSchedule> {
  const scraper = await getScraper();
  const tzOffset = -new Date().getTimezoneOffset();
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const data = await scraper.getEstimatedSchedule(
    targetDate,
    tzOffset,
  );

  return {
    scheduledAnimes: Array.isArray(data.scheduledAnimes)
      ? data.scheduledAnimes.map((anime: any) => ({
          id: normalizeText(anime.id),
          name: normalizeText(anime.name),
          jname: normalizeText(anime.jname || anime.name),
          time: normalizeText(anime.time),
          airingTimestamp: anime.airingTimestamp ?? 0,
          secondsUntilAiring: anime.secondsUntilAiring ?? 0,
          episode: anime.episode ?? 0,
        }))
      : [],
  };
}
