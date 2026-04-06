import {
  IAnime,
  IAnimeData,
  IAnimeSearch,
  ISuggestionAnime,
  LatestCompletedAnime,
  SearchAnimeParams,
  SpotlightAnime,
  Top10Animes,
  Type,
} from "@/types/anime";
import { IAnimeDetails, RecommendedAnime, RelatedAnime } from "@/types/anime-details";
import { IAnimeSchedule, IAnimeScheduleItem } from "@/types/anime-schedule";
import { Episode, IEpisodes } from "@/types/episodes";

const GOGO_BASE_URL = "https://gogoanime.by";
const HTML_CACHE_TTL_MS = 15 * 60 * 1000;

type HtmlCacheEntry = {
  expiresAt: number;
  value: string;
};

const htmlCache = new Map<string, HtmlCacheEntry>();

function now() {
  return Date.now();
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function getCachedHtml(url: string) {
  const cached = htmlCache.get(url);
  if (!cached) return null;
  if (cached.expiresAt <= now()) {
    htmlCache.delete(url);
    return null;
  }
  return cached.value;
}

function setCachedHtml(url: string, value: string) {
  htmlCache.set(url, {
    value,
    expiresAt: now() + HTML_CACHE_TTL_MS,
  });
}

async function fetchHtml(url: string) {
  const cached = getCachedHtml(url);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(
      `Gogoanime request failed: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  setCachedHtml(url, html);
  return html;
}

function toAbsoluteUrl(href?: string | null) {
  if (!href) return "";
  return href.startsWith("http") ? href : new URL(href, GOGO_BASE_URL).href;
}

function stripHtml(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeType(value?: string | null) {
  const normalized = stripHtml(String(value || ""));
  if (!normalized) return undefined;
  if (/tv show/i.test(normalized)) return Type.Tv;
  if (/movie/i.test(normalized)) return Type.Movie;
  if (/ona/i.test(normalized)) return Type.Ona;
  return normalized as Type | string;
}

function extractSeriesSlug(input: string) {
  const match = input.match(/\/series\/([^/?#]+)/i);
  if (match?.[1]) return match[1];
  return input
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^series\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .split("?")[0]
    .split("#")[0];
}

function isSeriesUrl(value: string) {
  return /\/series\//i.test(value);
}

function isEpisodeUrl(value: string) {
  return /^https?:\/\//i.test(value) && !isSeriesUrl(value);
}

function buildSeriesUrlFromSlug(slug: string) {
  return `${GOGO_BASE_URL}/series/${slug.replace(/^\/+|\/+$/g, "")}/`;
}

async function resolveSeriesUrlFromEpisodeUrl(episodeUrl: string) {
  const html = await fetchHtml(episodeUrl);
  const allEpisodesMatch = html.match(
    /href="(https:\/\/gogoanime\.by\/series\/[^"]+)"[^>]*>\s*All Episodes\s*</i,
  );

  if (allEpisodesMatch?.[1]) {
    return allEpisodesMatch[1];
  }

  const categoryMatch = html.match(
    /href="(https:\/\/gogoanime\.by\/category\/[^"]+)"/i,
  );
  if (categoryMatch?.[1]) {
    const categorySlug = categoryMatch[1]
      .replace(/^https?:\/\/[^/]+\/category\//i, "")
      .replace(/^\/+|\/+$/g, "");
    return buildSeriesUrlFromSlug(categorySlug);
  }

  throw new Error("Unable to resolve series URL from gogo episode page");
}

export async function resolveGogoSeriesUrlFromId(id: string) {
  if (!id) {
    throw new Error("anime id is required");
  }

  if (isSeriesUrl(id)) {
    return toAbsoluteUrl(id);
  }

  if (isEpisodeUrl(id)) {
    return resolveSeriesUrlFromEpisodeUrl(id);
  }

  return buildSeriesUrlFromSlug(id);
}

async function resolveGogoSeriesSlugFromId(id: string) {
  return extractSeriesSlug(await resolveGogoSeriesUrlFromId(id));
}

function getPosterFromElement(root: any, selectorSet: string[]) {
  for (const selector of selectorSet) {
    const element = root.find(selector).first();
    const value =
      element.attr("src") ||
      element.attr("data-src") ||
      element.attr("data-lazy-src") ||
      element.attr("content");
    if (value) {
      return toAbsoluteUrl(value);
    }
  }
  return "";
}

function parseEpisodeNumber(value?: string | null) {
  const match = String(value || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function episodeCount(sub: number | null = null, dub: number | null = null) {
  return {
    sub,
    dub,
  };
}

function createSeriesAnime(options: {
  id: string;
  name: string;
  poster: string;
  type?: string;
  rank?: number;
  sub?: number | null;
  dub?: number | null;
  jname?: string;
}): IAnime {
  return {
    id: options.id,
    name: options.name,
    jname: options.jname || options.name,
    poster: options.poster,
    episodes: episodeCount(options.sub ?? null, options.dub ?? null),
    type: normalizeType(options.type) as Type | undefined,
    rank: options.rank,
  };
}

function createLatestEpisodeAnime(options: {
  id: string;
  episodeId: string;
  name: string;
  poster: string;
  type?: string;
  sub?: number | null;
  dub?: number | null;
}): LatestCompletedAnime & { episodeId: string } {
  return {
    id: options.id,
    episodeId: options.episodeId,
    name: options.name,
    jname: options.name,
    poster: options.poster,
    episodes: episodeCount(options.sub ?? null, options.dub ?? null),
    type: normalizeType(options.type) as Type | undefined,
  };
}

function parseSeriesList($: any, selector: string): IAnime[] {
  return $(selector)
    .find("li")
    .map((index: number, element: any) => {
      const root = $(element);
      const href = toAbsoluteUrl(root.find("a.series").first().attr("href"));
      const name = stripHtml(root.find(".leftseries h3, .tt").first().text());
      const rank = Number(root.find(".ctr").first().text().trim()) || index + 1;
      const poster = getPosterFromElement(root, ["img"]);
      return createSeriesAnime({
        id: extractSeriesSlug(href),
        name,
        poster,
        rank,
      });
    })
    .get()
    .filter((anime: IAnime) => anime.id && anime.name);
}

function parseSpotlightAnime($: any): SpotlightAnime[] {
  return $(".slide-item.full")
    .map((index: number, element: any) => {
      const root = $(element);
      const href = toAbsoluteUrl(root.find(".title a").first().attr("href"));
      const name = stripHtml(root.find(".title a").first().text());
      const description = stripHtml(root.find(".excerpt").first().text());
      const poster = getPosterFromElement(root, [".poster img", "img"]);
      const categories = root
        .find(".extra-category a")
        .map((_: number, anchor: any) => stripHtml($(anchor).text()))
        .get()
        .filter(Boolean);

      return {
        rank: index + 1,
        id: extractSeriesSlug(href),
        name,
        description,
        poster,
        jname: name,
        episodes: episodeCount(null, null),
        type: Type.Tv,
        otherInfo: categories,
      } satisfies SpotlightAnime;
    })
    .get()
    .filter((anime: SpotlightAnime) => anime.id && anime.name);
}

function parseLatestEpisodes($: any) {
  return $(".listupd .bs")
    .map((_: number, element: any) => {
      const root = $(element);
      const episodeUrl = toAbsoluteUrl(root.find("a.tip").first().attr("href"));
      const headline = stripHtml(
        root.find("h2[itemprop='headline'], .tt h2").first().text(),
      );
      const name = stripHtml(
        root
          .find(".tt")
          .first()
          .clone()
          .children()
          .remove()
          .end()
          .text(),
      );
      const poster = getPosterFromElement(root, ["img"]);
      const type = stripHtml(root.find(".typez").first().text());
      const episodeNumber = parseEpisodeNumber(root.find(".epx").first().text());
      const subLabel = stripHtml(root.find(".sb").first().text()).toLowerCase();

      return createLatestEpisodeAnime({
        id: episodeUrl,
        episodeId: episodeUrl,
        name: name || headline.replace(/\s+episode\s+\d+.*$/i, ""),
        poster,
        type,
        sub: subLabel.includes("sub") ? episodeNumber : null,
        dub: subLabel.includes("dub") ? episodeNumber : null,
      });
    })
    .get()
    .filter((anime: LatestCompletedAnime & { episodeId: string }) => anime.id && anime.name);
}

function parseGenres($: any) {
  const genres = $('a[href*="genre"], a[href*="/action"], a[href*="/adventure"]')
    .map((_: number, element: any) => stripHtml($(element).text()))
    .get()
    .filter((genre: string) =>
      Boolean(genre) &&
      genre.length > 2 &&
      !/home|schedule|bookmark|view all|all/i.test(genre),
    );

  return unique(genres as string[]).slice(0, 40);
}

function sortAnimeList(animes: IAnime[], sort?: string) {
  const list = [...animes];

  if (!sort) return list;
  if (/a-z/i.test(sort)) {
    return list.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (/z-a/i.test(sort)) {
    return list.sort((left, right) => right.name.localeCompare(left.name));
  }
  return list;
}

function filterAnimeList(animes: IAnime[], params: SearchAnimeParams) {
  return animes.filter((anime) => {
    if (params.type && anime.type && String(anime.type) !== params.type) {
      return false;
    }
    return true;
  });
}

function parseSearchCards($: any) {
  return $(".listupd .bs, .serieslist.pop li")
    .map((index: number, element: any) => {
      const root = $(element);
      const href =
        toAbsoluteUrl(root.find("a.series").first().attr("href")) ||
        toAbsoluteUrl(root.find("a.tip").first().attr("href"));
      const seriesHref = isSeriesUrl(href)
        ? href
        : root.find("a.series").first().attr("href")
          ? toAbsoluteUrl(root.find("a.series").first().attr("href"))
          : "";
      const title =
        stripHtml(root.find(".tt, .leftseries h3").first().text()) ||
        stripHtml(root.find("a.series").last().text());
      const poster = getPosterFromElement(root, ["img"]);
      const type = stripHtml(root.find(".typez").first().text());
      const episodeNumber = parseEpisodeNumber(root.find(".epx, .year").first().text());
      const id = extractSeriesSlug(seriesHref || href);

      if (!id || !title) return null;

      return {
        id,
        name: title.replace(/\s+episode\s+\d+.*$/i, "").trim(),
        jname: title.replace(/\s+episode\s+\d+.*$/i, "").trim(),
        poster,
        episodes: episodeCount(episodeNumber, null),
        type: normalizeType(type) as Type | undefined,
        rank: index + 1,
        moreInfo: unique(
          [type, root.find(".sb").first().text()]
            .map((value) => stripHtml(String(value || "")))
            .filter(Boolean),
        ),
      } satisfies ISuggestionAnime;
    })
    .get()
    .filter(Boolean) as ISuggestionAnime[];
}

function parseInfoLabel(text: string, label: string) {
  const match = text.match(new RegExp(`${label}:\\s*([^:]+?)(?=\\s+[A-Z][a-z]+:|$)`, "i"));
  return match?.[1]?.trim() || "";
}

function parseEpisodeList($: any): Episode[] {
  const episodes = $(".episode-item")
    .map((_: number, element: any) => {
      const root = $(element);
      const href = toAbsoluteUrl(root.find("a").first().attr("href"));
      const number =
        Number(root.attr("data-episode-number")) ||
        parseEpisodeNumber(root.text()) ||
        0;

      return {
        title: `Episode ${number}`,
        episodeId: href,
        number,
        isFiller: false,
      } satisfies Episode;
    })
    .get()
    .filter((episode: Episode) => episode.episodeId && episode.number > 0);

  return episodes.sort((left: Episode, right: Episode) => left.number - right.number);
}

function parseRecommendations($: any): RecommendedAnime[] {
  let cards: any[] = [];

  $(".bixbox").each((_: number, element: any) => {
    const root = $(element);
    const heading = stripHtml(root.find("h1, h2, h3, h4").first().text());
    if (/recommended series/i.test(heading)) {
      cards = root.find(".listupd .bs").toArray();
    }
  });

  return cards
    .map((element, index) => {
      const root = $(element);
      const href = toAbsoluteUrl(root.find("a.tip").first().attr("href"));
      const title = stripHtml(root.find(".tt").first().text());
      const poster = getPosterFromElement(root, ["img"]);

      return {
        id: extractSeriesSlug(href),
        name: title,
        jname: title,
        poster,
        episodes: {
          sub: 0,
          dub: 0,
        },
        duration: "",
        rating: "",
        type: "",
      } satisfies RecommendedAnime;
    })
    .filter((anime) => anime.id && anime.name);
}

function buildRelatedFromRecommendations(recommended: RecommendedAnime[]): RelatedAnime[] {
  return recommended.map((anime) => ({
    id: anime.id,
    name: anime.name,
    jname: anime.jname,
    poster: anime.poster,
    episodes: anime.episodes,
    type: String(anime.type || ""),
  }));
}

function parsePromotionalVideos($: any) {
  const href = $('a[href*="youtube.com"], a[href*="youtu.be"]').first().attr("href");
  if (!href) return [];
  return [
    {
      title: "Trailer",
      source: href,
      thumbnail: "",
    },
  ];
}

export async function getGogoHomePageData(): Promise<IAnimeData> {
  const cheerio = await import("cheerio");
  const html = await fetchHtml(`${GOGO_BASE_URL}/`);
  const $ = cheerio.load(html);

  const weekly = parseSeriesList($, ".serieslist.pop.wpop-weekly");
  const monthly = parseSeriesList($, ".serieslist.pop.wpop-monthly");
  const allTime = parseSeriesList($, ".serieslist.pop.wpop-alltime");
  const spotlight = parseSpotlightAnime($).slice(0, 8);
  const latest = parseLatestEpisodes($).slice(0, 24);
  const top10: Top10Animes = {
    today: weekly.slice(0, 10) as LatestCompletedAnime[],
    week: monthly.slice(0, 10),
    month: allTime.slice(0, 10) as LatestCompletedAnime[],
  };

  return {
    spotlightAnimes: spotlight,
    trendingAnimes: allTime.slice(0, 14),
    latestEpisodeAnimes: latest,
    topUpcomingAnimes: monthly.slice(0, 14) as any,
    top10Animes: top10,
    topAiringAnimes: weekly.slice(0, 10) as LatestCompletedAnime[],
    mostPopularAnimes: allTime.slice(0, 10),
    mostFavoriteAnimes: monthly.slice(0, 10),
    latestCompletedAnimes: weekly.slice(0, 10) as LatestCompletedAnime[],
    genres: parseGenres($),
  };
}

export async function getGogoAnimeDetails(id: string): Promise<IAnimeDetails> {
  const cheerio = await import("cheerio");
  const seriesUrl = await resolveGogoSeriesUrlFromId(id);
  const seriesSlug = extractSeriesSlug(seriesUrl);
  const html = await fetchHtml(seriesUrl);
  const $ = cheerio.load(html);

  const title = stripHtml($("h1").first().text());
  const description = stripHtml($(".infox .ninfo, .ninfo, .infox").first().text());
  const detailsText = stripHtml($(".spe").first().text());
  const episodes = parseEpisodeList($);
  const recommendations = parseRecommendations($);
  const related = buildRelatedFromRecommendations(recommendations);

  const released = parseInfoLabel(detailsText, "Released");
  const status = parseInfoLabel(detailsText, "Status");
  const studios = parseInfoLabel(detailsText, "Studio");
  const duration = parseInfoLabel(detailsText, "Duration");
  const type = parseInfoLabel(detailsText, "Type");
  const genres = unique(
    $(".infox a, .spe a")
      .map((_: number, element: any) => stripHtml($(element).text()))
      .get()
      .filter((genre: string) => !/trailer|9anime|bookmark/i.test(genre)),
  );

  return {
    anime: {
      info: {
        id: seriesSlug,
        anilistId: 0,
        malId: 0,
        name: title,
        poster: getPosterFromElement($("body"), [
          '.animefull img',
          'meta[property="og:image"]',
          '.thumb img',
        ]),
        description,
        stats: {
          rating: "",
          quality: "HD",
          episodes: {
            sub: episodes.length,
            dub: 0,
          },
          type: type || "TV Show",
          duration,
        },
        promotionalVideos: parsePromotionalVideos($),
        charactersVoiceActors: [],
      },
      moreInfo: {
        japanese: title,
        synonyms: "",
        aired: released,
        premiered: released,
        duration,
        status,
        malscore: "",
        genres,
        studios,
        producers: [],
      },
    },
    seasons: [],
    mostPopularAnimes: [],
    relatedAnimes: related,
    recommendedAnimes: recommendations,
  };
}

export async function getGogoAnimeEpisodes(id: string): Promise<IEpisodes> {
  const cheerio = await import("cheerio");
  const seriesUrl = await resolveGogoSeriesUrlFromId(id);
  const html = await fetchHtml(seriesUrl);
  const $ = cheerio.load(html);
  const episodes = parseEpisodeList($);

  return {
    totalEpisodes: episodes.length,
    episodes,
  };
}

export async function searchGogoAnime(
  params: SearchAnimeParams,
): Promise<IAnimeSearch> {
  const cheerio = await import("cheerio");
  const url = params.q.trim()
    ? `${GOGO_BASE_URL}/?s=${encodeURIComponent(params.q.trim())}`
    : `${GOGO_BASE_URL}/series/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const parsed = parseSearchCards($);
  const deduped = Array.from(
    new Map(parsed.map((anime) => [anime.id, anime])),
  ).map(([, anime]) => anime);
  const filtered = filterAnimeList(deduped, params);
  const sorted = sortAnimeList(filtered, params.sort);

  return {
    animes: sorted,
    totalPages: 1,
    hasNextPage: false,
    currentPage: 1,
  };
}

export async function getGogoSearchSuggestions(query: string) {
  if (!query.trim()) {
    return { suggestions: [] as ISuggestionAnime[] };
  }

  const results = await searchGogoAnime({
    q: query,
    page: 1,
  });

  return {
    suggestions: results.animes.slice(0, 8).map((anime, index) => ({
      ...anime,
      rank: anime.rank || index + 1,
      moreInfo: [
        anime.type ? String(anime.type) : "",
        anime.episodes.sub ? `Sub ${anime.episodes.sub}` : "",
      ].filter(Boolean),
    })),
  };
}

function weekdayClassFromDate(dateString?: string) {
  const date = dateString ? new Date(dateString) : new Date();
  const weekday = date
    .toLocaleString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
  return `sch_${weekday}`;
}

function buildTimestamp(dateString: string | undefined, timeValue: string) {
  const base = dateString ? new Date(dateString) : new Date();
  const [hours, minutes] = timeValue.split(":").map((value) => Number(value));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  base.setUTCHours(hours, minutes, 0, 0);
  return Math.floor(base.getTime() / 1000);
}

export async function getGogoAnimeSchedule(date?: string): Promise<IAnimeSchedule> {
  const cheerio = await import("cheerio");
  const html = await fetchHtml(`${GOGO_BASE_URL}/schedule/`);
  const $ = cheerio.load(html);
  const className = weekdayClassFromDate(date);
  const items: IAnimeScheduleItem[] = [];

  $(`.bixbox.schedulepage.${className} .bs`).each((_: number, element: any) => {
    const root = $(element);
    const href = toAbsoluteUrl(root.find("a").first().attr("href"));
    const name = stripHtml(root.find(".tt").first().text());
    const time = stripHtml(root.find(".epx").first().text());
    const episode = Number(root.find(".sb").first().text().trim()) || 0;
    const airingTimestamp = buildTimestamp(date, time);

    items.push({
      id: extractSeriesSlug(href),
      name,
      jname: name,
      time,
      airingTimestamp,
      secondsUntilAiring: airingTimestamp
        ? Math.max(0, airingTimestamp - Math.floor(Date.now() / 1000))
        : 0,
      episode,
    });
  });

  return {
    scheduledAnimes: items,
  };
}
