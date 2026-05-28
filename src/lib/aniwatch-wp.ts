import { load } from "cheerio";
import {
  getAnikaiAnimeDescription,
  getAnikaiEpisodeList,
  getAnikaiSchedule,
} from "@/lib/anikai";
import { IAnime, IAnimeData, IAnimeSearch, ISuggestionAnime, LatestCompletedAnime, SearchAnimeParams, SpotlightAnime, TopUpcomingAnime, Type } from "@/types/anime";
import { IAnimeDetails, RecommendedAnime, RelatedAnime, Season } from "@/types/anime-details";
import { IAnimeSchedule } from "@/types/anime-schedule";
import { IEpisodeServers, IEpisodeSource, IEpisodes } from "@/types/episodes";

const BASE_URL = process.env.ANIWATCH_SOURCE_URL || "https://aniwaves.ru";
const API_BASE_URL = `${BASE_URL.replace(/\/$/, "")}/wp-json/hianime/v1`;
const ANIKAI_BASE_URL = process.env.ANIKAI_SOURCE_URL || "https://anikai.to";
const IS_ANIWAVES_SOURCE = new URL(BASE_URL).hostname.includes("aniwaves");

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanUrl(value?: string | null, baseUrl = BASE_URL) {
  const url = text(value).replace(/&amp;/g, "&");
  if (!url) return "";
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function backgroundImageFromStyle(style?: string | null) {
  return text(style).match(/background-image:\s*url\((['"]?)(.*?)\1\)/i)?.[2] || "";
}

function numberFromText(value?: string | null) {
  return Number(text(value).match(/\d+/)?.[0]) || null;
}

function titleFromId(value: string) {
  return value
    .split("?")[0]
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labeledMetric($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>, label: string) {
  const item = root
    .find(".mics > div")
    .toArray()
    .find((el) => text($(el).find("div").first().text()).toLowerCase() === label.toLowerCase());
  return item ? text($(item).find("span").first().text()) : "";
}

function slugFromHref(href?: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, BASE_URL);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "anime" && parts[1]) return parts[1];
    return parts[parts.length - 1] || "";
  } catch {
    return href.replace(/^\/+|\/+$/g, "").split("/").pop() || "";
  }
}

function slugFromHrefWithBase(href: string | null | undefined, baseUrl: string) {
  if (!href) return "";
  try {
    const url = new URL(href, baseUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if ((parts[0] === "anime" || parts[0] === "watch") && parts[1]) {
      return parts[1];
    }
    return parts[parts.length - 1] || "";
  } catch {
    return href.replace(/^\/+|\/+$/g, "").split("/").pop()?.split(/[?#]/)[0] || "";
  }
}

function episodeSlugFromHref(href?: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, BASE_URL);
    return url.pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return href.replace(/^\/+|\/+$/g, "").split("/").pop() || "";
  }
}

function animeNumericIdFromSlug(animeId: string) {
  return animeId.split("?")[0].match(/-(\d+)$/)?.[1] || (/^\d+$/.test(animeId) ? animeId : "");
}

function parseAniwavesEpisodeId(episodeId: string) {
  const [animeId, query = ""] = episodeId.split("?");
  const episode = new URLSearchParams(query).get("ep") || episodeId.match(/ep-(\d+(?:\.\d+)?)/i)?.[1] || "";
  const numericId = animeNumericIdFromSlug(animeId);
  if (!numericId || !episode) {
    throw new Error(`Aniwaves episode id is invalid: ${episodeId}`);
  }
  return { animeId, numericId, episode };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Aniwatch request failed: ${response.status} ${url}`);
  }
  return response.text();
}

async function fetchAnimeOrEpisodePage(slug: string) {
  try {
    return await fetchText(`${BASE_URL}/anime/${slug}/`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404")) {
      throw error;
    }
    return fetchText(`${BASE_URL}/${slug}/`);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,*/*",
      Referer: `${BASE_URL}/`,
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Aniwatch API request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<T>;
}

function normalizeType(value?: string | null) {
  const normalized = text(value).toUpperCase();
  if (normalized.includes("MOVIE")) return Type.Movie;
  if (normalized.includes("ONA")) return Type.Ona;
  return Type.Tv;
}

function cardFromElement($: ReturnType<typeof load>, el: any): IAnime {
  const root = $(el);
  const href =
    root.find(".film-name a").attr("href") ||
    root.find("a").first().attr("href") ||
    root.attr("href");
  const name =
    text(root.find(".film-name a").first().text()) ||
    text(root.find(".film-name").first().text()) ||
    text(root.attr("title"));
  const poster =
    text(root.find(".film-poster-img").attr("data-src")) ||
    text(root.find(".film-poster-img").attr("src")) ||
    text(root.find("img").first().attr("data-src")) ||
    text(root.find("img").first().attr("src"));
  const info = root.find(".fd-infor, .film-infor").text();
  const epNumbers = [...info.matchAll(/Ep\s*(\d+)/gi)].map((match) => Number(match[1]) || 0);
  const hasDub = /\bDub\b/i.test(info);

  return {
    id: slugFromHref(href),
    name,
    jname: text(root.find(".dynamic-name").attr("data-jname")) || name,
    poster,
    episodes: {
      sub: epNumbers[0] || null,
      dub: hasDub ? epNumbers[epNumbers.length - 1] || epNumbers[0] || null : null,
    },
    type: normalizeType(info),
  };
}

function latestFromCard(card: IAnime, el?: any, $?: ReturnType<typeof load>): LatestCompletedAnime {
  const href = $ && el ? $(el).find(".film-detail .film-name a, .film-name a, a").first().attr("href") : undefined;
  return {
    ...card,
    duration: "",
    rating: null,
    episodeId: episodeSlugFromHref(href),
  };
}

function extractCards($: ReturnType<typeof load>, selector: string, limit = 24) {
  return $(selector)
    .toArray()
    .map((el) => cardFromElement($, el))
    .filter((anime) => anime.id && anime.name)
    .slice(0, limit);
}

function episodeIdFromAnikaiHref(href?: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, ANIKAI_BASE_URL);
    const id = slugFromHrefWithBase(href, ANIKAI_BASE_URL);
    const episode = url.hash.match(/ep=(\d+)/i)?.[1] || url.searchParams.get("ep");
    return id && episode ? `${id}?ep=${episode}` : id;
  } catch {
    const [path, hash = ""] = href.split("#");
    const id = slugFromHrefWithBase(path, ANIKAI_BASE_URL);
    const episode = hash.match(/ep=(\d+)/i)?.[1];
    return id && episode ? `${id}?ep=${episode}` : id;
  }
}

function typeFromAnikaiInfo($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>) {
  const typeLabel = root
    .find(".info b")
    .toArray()
    .map((el) => text($(el).text()).toUpperCase())
    .find((value) => ["TV", "MOVIE", "ONA", "OVA", "SPECIAL"].includes(value));
  return normalizeType(typeLabel || root.find(".info").text());
}

function cardFromAnikaiElement($: ReturnType<typeof load>, el: any): IAnime {
  const root = $(el);
  const href =
    root.attr("href") ||
    root.find("a.poster[href], a[href*='/watch/']").first().attr("href");
  const titleElement = root.find(".title").first();
  const name =
    text(titleElement.text()) ||
    text(root.attr("title")) ||
    text(titleElement.attr("title"));
  const poster =
    text(root.find(".poster img").first().attr("data-src")) ||
    text(root.find(".poster img").first().attr("src")) ||
    text(root.find("img").first().attr("data-src")) ||
    text(root.find("img").first().attr("src"));

  return {
    id: slugFromHrefWithBase(href, ANIKAI_BASE_URL),
    name,
    jname: text(titleElement.attr("data-jp")) || name,
    poster: cleanUrl(poster, ANIKAI_BASE_URL),
    episodes: {
      sub: numberFromText(root.find(".info .sub").first().text()),
      dub: numberFromText(root.find(".info .dub").first().text()),
    },
    type: typeFromAnikaiInfo($, root),
  };
}

function uniqueAnime<T extends IAnime>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function extractAnikaiCardElements($: ReturnType<typeof load>, elements: any[], limit = 60) {
  return uniqueAnime(
    elements
      .map((el) => cardFromAnikaiElement($, el))
      .filter((anime) => anime.id && anime.name && anime.poster),
  ).slice(0, limit);
}

function extractAnikaiCards($: ReturnType<typeof load>, selector = ".aitem", limit = 60) {
  return extractAnikaiCardElements($, $(selector).toArray(), limit);
}

function extractAnikaiSectionCards($: ReturnType<typeof load>, title: string, limit = 24) {
  const normalizedTitle = title.toLowerCase();
  const section = $(".swiper-slide, section")
    .toArray()
    .find((el) => text($(el).find(".stitle").first().text()).toLowerCase() === normalizedTitle);

  return section ? extractAnikaiCardElements($, $(section).find(".aitem").toArray(), limit) : [];
}

function latestFromAnikaiElement($: ReturnType<typeof load>, el: any): LatestCompletedAnime {
  const root = $(el);
  const href =
    root.attr("href") ||
    root.find("a.poster[href], a[href*='/watch/']").first().attr("href");
  return {
    ...cardFromAnikaiElement($, el),
    duration: "",
    rating: null,
    episodeId: episodeIdFromAnikaiHref(href),
  };
}

function latestFromAnikaiElements($: ReturnType<typeof load>, elements: any[], limit = 60) {
  return uniqueAnime(
    elements
      .map((el) => latestFromAnikaiElement($, el))
      .filter((anime) => anime.id && anime.name && anime.poster),
  ).slice(0, limit);
}

function latestFromAnikaiSection($: ReturnType<typeof load>, title: string, limit = 24) {
  const normalizedTitle = title.toLowerCase();
  const section = $(".swiper-slide, section")
    .toArray()
    .find((el) => text($(el).find(".stitle").first().text()).toLowerCase() === normalizedTitle);

  if (!section) return [];

  return latestFromAnikaiElements($, $(section).find(".aitem").toArray(), limit);
}

function buildSpotlight(card: IAnime, index: number): SpotlightAnime {
  return {
    ...card,
    rank: index + 1,
    description: "",
    type: card.type || Type.Tv,
    otherInfo: [],
  };
}

function extractAniwatchSpotlight($: ReturnType<typeof load>): SpotlightAnime[] {
  return $(".deslide-item")
    .toArray()
    .map((el, index) => {
      const root = $(el);
      const detailHref =
        root.find(".desi-buttons a[href*='/anime/']").attr("href") ||
        root.find("a[href*='/anime/']").first().attr("href");
      const bannerImage = cleanUrl(
        root.find(".deslide-cover-img img").attr("data-src") ||
          root.find(".deslide-cover-img img").attr("src"),
      );
      const name =
        text(root.find(".desi-head-title").first().text()) ||
        text(root.find(".deslide-cover-img img").attr("alt"));
      const detailText = root.find(".sc-detail").text();
      const sub = numberFromText(root.find(".tick-item.tick-eps").first().text());

      return {
        rank: index + 1,
        id: slugFromHref(detailHref),
        name,
        description: text(root.find(".desi-description").first().text()),
        poster: bannerImage,
        bannerImage,
        jname: text(root.find(".desi-head-title").first().attr("data-jname")) || name,
        episodes: {
          sub,
          dub: null,
        },
        type: normalizeType(detailText),
        otherInfo: root
          .find(".scd-item")
          .toArray()
          .map((item) => text($(item).text()))
          .filter(Boolean),
        rating: null,
        release: null,
        quality: text(root.find(".quality").first().text()) || null,
        genres: [],
      } satisfies SpotlightAnime;
    })
    .filter((anime) => anime.id && anime.name && anime.bannerImage);
}

function extractAnikaiSpotlight($: ReturnType<typeof load>): SpotlightAnime[] {
  return $("#featured .swiper-slide")
    .toArray()
    .map((el, index) => {
      const root = $(el);
      const href = root.find(".watch-btn[href], a[href*='/watch/']").first().attr("href");
      const bannerImage = cleanUrl(backgroundImageFromStyle(root.attr("style")), ANIKAI_BASE_URL);
      const name = text(root.find(".detail .title").first().text());
      const infoText = root.find(".info").text();
      const genres = root
        .find(".info span")
        .toArray()
        .filter((item) => !$(item).hasClass("sub") && !$(item).hasClass("dub") && !$(item).find("b").length)
        .flatMap((item) => text($(item).text()).split(","))
        .map((genre) => genre.trim())
        .filter(Boolean);
      const rating = labeledMetric($, root, "Rating") || null;
      const release = labeledMetric($, root, "Release") || null;
      const quality = labeledMetric($, root, "Quality") || null;

      return {
        rank: index + 1,
        id: slugFromHref(href),
        name,
        description: text(root.find(".desc").first().text()),
        poster: bannerImage,
        bannerImage,
        jname: text(root.find(".detail .title").first().attr("data-jp")) || name,
        episodes: {
          sub: numberFromText(root.find(".info .sub").first().text()),
          dub: numberFromText(root.find(".info .dub").first().text()),
        },
        type: normalizeType(text(root.find(".info b").first().text()) || infoText),
        otherInfo: [text(root.find(".info b").first().text()), ...genres].filter(Boolean),
        rating,
        release,
        quality,
        genres,
      } satisfies SpotlightAnime;
    })
    .filter((anime) => anime.id && anime.name && anime.bannerImage);
}

function cardFromAniwavesElement($: ReturnType<typeof load>, el: any): IAnime {
  const root = $(el);
  const href =
    root.find("a.name[href], .poster a[href], a[href*='/watch/']").first().attr("href") ||
    root.attr("href");
  const name =
    text(root.find(".name.d-title, .name, .title.d-title, .title").first().text()) ||
    text(root.find("img").first().attr("alt")).replace(/\s+Japanese english subbed$/i, "");
  const poster =
    text(root.find(".poster img, img").first().attr("data-src")) ||
    text(root.find(".poster img, img").first().attr("src"));

  return {
    id: slugFromHrefWithBase(href, BASE_URL),
    name,
    jname: text(root.find(".d-title").first().attr("data-jp")) || name,
    poster: cleanUrl(poster, BASE_URL),
    episodes: {
      sub: numberFromText(root.find(".ep-status.sub span").first().text()),
      dub: numberFromText(root.find(".ep-status.dub span").first().text()),
    },
    type: normalizeType(
      text(root.find(".meta .right").first().text()) ||
        text(root.find(".meta .dot").last().text()) ||
        text(root.find(".m-item").filter((_, item) => !$(item).find("i").length).last().find("span").text()),
    ),
  };
}

function extractAniwavesCards($: ReturnType<typeof load>, selector = ".ani.items > .item, a.item[class*='rank']", limit = 60) {
  return uniqueAnime(
    $(selector)
      .toArray()
      .map((el) => cardFromAniwavesElement($, el))
      .filter((anime) => anime.id && anime.name && anime.poster),
  ).slice(0, limit);
}

function extractAniwavesSpotlight($: ReturnType<typeof load>): SpotlightAnime[] {
  return $("#hotest .swiper-slide.item")
    .toArray()
    .map((el, index) => {
      const root = $(el);
      const href = root.find("a[href*='/watch/']").first().attr("href");
      const bannerImage = cleanUrl(backgroundImageFromStyle(root.find(".image div").first().attr("style")), BASE_URL);
      const name = text(root.find(".title.d-title, .title").first().text());
      const info = root.find(".meta").text();

      return {
        rank: index + 1,
        id: slugFromHrefWithBase(href, BASE_URL),
        name,
        description: text(root.find(".synopsis").first().text()),
        poster: bannerImage,
        bannerImage,
        jname: text(root.find(".title.d-title").first().attr("data-jp")) || name,
        episodes: {
          sub: null,
          dub: null,
        },
        type: normalizeType(info),
        otherInfo: root
          .find(".meta i")
          .toArray()
          .map((item) => text($(item).text()))
          .filter(Boolean),
        rating: text(root.find(".rating").first().text()) || null,
        release: null,
        quality: text(root.find(".quality").first().text()) || null,
        genres: [],
      } satisfies SpotlightAnime;
    })
    .filter((anime) => anime.id && anime.name && anime.bannerImage);
}

function latestFromAniwavesCard(card: IAnime): LatestCompletedAnime {
  return {
    ...card,
    duration: "",
    rating: null,
    episodeId: card.episodes.sub ? `${card.id}?ep=${card.episodes.sub}` : undefined,
  };
}

async function getAniwavesJson<T>(path: string): Promise<T> {
  return fetchJson<T>(`${BASE_URL.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`);
}

async function getAnikaiHomeFallback() {
  try {
    const html = await fetchText(`${ANIKAI_BASE_URL.replace(/\/$/, "")}/home`);
    const $ = load(html);
    return {
      spotlight: extractAnikaiSpotlight($).slice(0, 10),
      cards: extractAnikaiCards($, ".aitem", 60),
      latestCards: latestFromAnikaiElements($, $(".aitem").toArray(), 60),
      newReleases: latestFromAnikaiSection($, "New Releases", 24),
      upcoming: extractAnikaiSectionCards($, "Upcoming", 12),
      completed: latestFromAnikaiSection($, "Completed", 24),
      genres: $(".nav-menu a[href^='/genres/']")
        .toArray()
        .map((el) => text($(el).text()))
        .filter(Boolean),
    };
  } catch (error) {
    console.warn("[HOME_PAGE] AnimeKai home fallback failed:", error);
    return {
      spotlight: [] as SpotlightAnime[],
      cards: [] as IAnime[],
      latestCards: [] as LatestCompletedAnime[],
      newReleases: [] as LatestCompletedAnime[],
      upcoming: [] as IAnime[],
      completed: [] as LatestCompletedAnime[],
      genres: [] as string[],
    };
  }
}

export async function getAniwatchHomePageData(): Promise<IAnimeData> {
  if (IS_ANIWAVES_SOURCE) {
    const html = await fetchText(`${BASE_URL.replace(/\/$/, "")}/home`);
    const $ = load(html);
    const cards = extractAniwavesCards($);
    const latest = cards.map(latestFromAniwavesCard);
    let spotlight = extractAniwavesSpotlight($).slice(0, 10);
    if (!spotlight.length) {
      spotlight = cards.slice(0, 8).map(buildSpotlight);
    }

    return {
      spotlightAnimes: spotlight,
      trendingAnimes: cards.slice(0, 12),
      latestEpisodeAnimes: latest.slice(0, 24),
      topUpcomingAnimes: cards.slice(0, 12).map((anime) => ({
        ...anime,
        duration: "",
        type: anime.type || "",
        rating: null,
      } satisfies TopUpcomingAnime)),
      top10Animes: {
        today: latest.slice(0, 10),
        week: cards.slice(10, 20),
        month: latest.slice(20, 30),
      },
      topAiringAnimes: latest.slice(0, 12),
      mostPopularAnimes: cards.slice(0, 24),
      mostFavoriteAnimes: cards.slice(12, 36),
      latestCompletedAnimes: latest.slice(0, 24),
      genres: $("#menu a[href^='/genre/'], .genre a[href^='/genre/']")
        .toArray()
        .map((el) => text($(el).text()))
        .filter(Boolean)
        .filter((genre, index, genres) => genres.indexOf(genre) === index),
    };
  }

  const anikaiFallback = await getAnikaiHomeFallback();
  let spotlight = anikaiFallback.spotlight;
  let html = "";
  try {
    html = await fetchText(`${BASE_URL}/`);
  } catch (error) {
    if (!spotlight.length) {
      throw error;
    }
    console.warn("[HOME_PAGE] Aniwatch homepage failed; using AnimeKai home fallback:", error);
  }

  const $ = load(html);
  const aniwatchCards = extractCards($, ".flw-item", 60);
  const cards = aniwatchCards.length ? aniwatchCards : anikaiFallback.cards;
  const latest = aniwatchCards.length
    ? aniwatchCards.map((card) => latestFromCard(card))
    : anikaiFallback.newReleases.length >= 12
      ? anikaiFallback.newReleases
      : anikaiFallback.latestCards.length
        ? anikaiFallback.latestCards
        : cards.map((card) => ({ ...card, duration: "", rating: null }));
  const upcoming = aniwatchCards.length
    ? aniwatchCards.slice(0, 12)
    : anikaiFallback.upcoming.length
      ? anikaiFallback.upcoming
      : cards.slice(0, 12);
  const completed = aniwatchCards.length
    ? latest.slice(0, 24)
    : anikaiFallback.completed.length
      ? anikaiFallback.completed
      : latest.slice(0, 24);
  if (!spotlight.length) {
    spotlight = extractAniwatchSpotlight($).slice(0, 10);
  }
  if (!spotlight.length) {
    spotlight = cards.slice(0, 8).map(buildSpotlight);
  }

  return {
    spotlightAnimes: spotlight,
    trendingAnimes: cards.slice(0, 12),
    latestEpisodeAnimes: latest.slice(0, 24),
    topUpcomingAnimes: upcoming.map((anime) => ({
      ...anime,
      duration: "",
      type: anime.type || "",
      rating: null,
    } satisfies TopUpcomingAnime)),
    top10Animes: {
      today: latest.slice(0, 10),
      week: cards.slice(10, 20),
      month: latest.slice(20, 30),
    },
    topAiringAnimes: latest.slice(0, 12),
    mostPopularAnimes: cards.slice(0, 24),
    mostFavoriteAnimes: cards.slice(12, 36),
    latestCompletedAnimes: completed,
    genres: $(".sb-genre-list a, .ulclear li a")
      .toArray()
      .map((el) => text($(el).text()))
      .filter(Boolean)
      .concat(anikaiFallback.genres)
      .filter((genre, index, genres) => genres.indexOf(genre) === index),
  };
}

function detailListValue($: ReturnType<typeof load>, label: string) {
  const item = $(".item, .anisc-info .item").toArray().find((el) =>
    text($(el).find(".item-head, .item-title, strong").first().text()).toLowerCase().includes(label),
  );
  return item ? text($(item).text().replace(/^[^:]+:\s*/, "")) : "";
}

export async function getAniwatchAnimeDetails(animeId: string): Promise<IAnimeDetails> {
  if (IS_ANIWAVES_SOURCE) {
    const html = await fetchText(`${BASE_URL.replace(/\/$/, "")}/watch/${animeId}`);
    const $ = load(html);
    const name =
      text($("h1, .info .title, .name.d-title, .title.d-title").first().text()) ||
      text($('meta[property="og:title"]').attr("content")).replace(/\s+-\s+Aniwave.*$/i, "") ||
      titleFromId(animeId);
    const poster =
      text($(".poster img, img[itemprop='image']").first().attr("src")) ||
      text($('meta[property="og:image"]').attr("content")) ||
      cleanUrl(backgroundImageFromStyle($("#player").attr("style")), BASE_URL);
    const description =
      text($(".synopsis, .description, [itemprop='description']").first().text()) ||
      text($('meta[name="description"]').attr("content"));
    const related = extractAniwavesCards($, "section .ani.items > .item, .block-ranking a.item", 24).map((anime) => ({
      ...anime,
      episodes: { sub: anime.episodes.sub ?? 0, dub: anime.episodes.dub ?? 0 },
      type: anime.type || "",
    } satisfies RelatedAnime));

    return {
      anime: {
        info: {
          id: animeId,
          anilistId: 0,
          malId: 0,
          name,
          poster,
          description,
          stats: {
            rating: text($(".rating").first().text()),
            quality: text($(".quality").first().text()),
            episodes: {
              sub: 0,
              dub: 0,
            },
            type: detailListValue($, "type") || "",
            duration: detailListValue($, "duration"),
          },
          promotionalVideos: [],
          charactersVoiceActors: [],
        },
        moreInfo: {
          japanese: text($(".d-title").first().attr("data-jp")),
          synonyms: "",
          aired: detailListValue($, "aired"),
          premiered: "",
          duration: detailListValue($, "duration"),
          status: detailListValue($, "status"),
          malscore: detailListValue($, "score"),
          genres: $(".genre a[href^='/genre/'], a[href^='/genre/']")
            .toArray()
            .map((el) => text($(el).text()))
            .filter(Boolean),
          studios: "",
          producers: [],
        },
      },
      seasons: [] as Season[],
      mostPopularAnimes: related,
      relatedAnimes: related,
      recommendedAnimes: related.map((anime) => ({
        ...anime,
        duration: "",
        rating: "",
      } satisfies RecommendedAnime)),
    };
  }

  const html = await fetchAnimeOrEpisodePage(animeId);
  const $ = load(html);
  const name =
    text($("h1").first().text()) ||
    text($(".film-name.dynamic-name").first().text()) ||
    animeId;
  const poster =
    text($(".film-poster-img").first().attr("data-src")) ||
    text($(".film-poster-img").first().attr("src")) ||
    text($('meta[property="og:image"]').attr("content"));
  const description =
    text($(".description, .film-description, .text").first().text()) ||
    text($('meta[name="description"]').attr("content"));
  let resolvedDescription = description;
  if (!resolvedDescription) {
    try {
      resolvedDescription = await getAnikaiAnimeDescription(animeId);
    } catch (error) {
      console.warn(`[ANIME_DETAILS] AnimeKai description fallback failed for ${animeId}:`, error);
    }
  }
  const totalEpisodes = Number($(".ss-list a").length) || 0;
  const related = extractCards($, ".flw-item", 24).map((anime) => ({
    ...anime,
    episodes: { sub: anime.episodes.sub ?? 0, dub: anime.episodes.dub ?? 0 },
    type: anime.type || "",
  } satisfies RelatedAnime));

  return {
    anime: {
      info: {
        id: animeId,
        anilistId: 0,
        malId: 0,
        name,
        poster,
        description: resolvedDescription,
        stats: {
          rating: detailListValue($, "rating"),
          quality: "",
          episodes: {
            sub: totalEpisodes,
            dub: totalEpisodes,
          },
          type: detailListValue($, "type") || "TV",
          duration: detailListValue($, "duration"),
        },
        promotionalVideos: [],
        charactersVoiceActors: [],
      },
      moreInfo: {
        japanese: "",
        synonyms: "",
        aired: detailListValue($, "aired"),
        premiered: "",
        duration: detailListValue($, "duration"),
        status: detailListValue($, "status"),
        malscore: detailListValue($, "score"),
        genres: $(".genre, a[href*='/genre/']")
          .toArray()
          .map((el) => text($(el).text()))
          .filter(Boolean),
        studios: "",
        producers: [],
      },
    },
    seasons: [] as Season[],
    mostPopularAnimes: related,
    relatedAnimes: related,
    recommendedAnimes: related.map((anime) => ({
      ...anime,
      duration: "",
      rating: "",
    } satisfies RecommendedAnime)),
  };
}

async function getAnimeNumericId(animeId: string) {
  if (IS_ANIWAVES_SOURCE) {
    const idFromSlug = animeNumericIdFromSlug(animeId);
    if (idFromSlug) return idFromSlug;
  }

  const html = await fetchAnimeOrEpisodePage(animeId);
  const $ = load(html);
  const shortlink = $("link[rel='shortlink']").attr("href") || "";
  const id =
    $("#ani_detail").attr("data-anime-id") ||
    $("[data-anime-id]").first().attr("data-anime-id") ||
    new URL(shortlink || BASE_URL, BASE_URL).searchParams.get("p");
  if (!id) throw new Error(`Aniwatch anime id was not found for ${animeId}`);
  return id;
}

export async function getAniwatchAnimeEpisodes(animeId: string): Promise<IEpisodes> {
  if (IS_ANIWAVES_SOURCE) {
    const numericId = await getAnimeNumericId(animeId);
    const payload = await getAniwavesJson<{ status?: number; result?: string }>(
      `/ajax/episode/list/${numericId}`,
    );
    const $ = load(payload.result || "");
    const episodes = $(".episodes a[data-num], .ep-range a[data-num]")
      .toArray()
      .map((el) => {
        const number = text($(el).attr("data-num"));
        return {
          title: `Episode ${number}`,
          episodeId: `${animeId}?ep=${text($(el).attr("data-slug")) || number}`,
          number: Number(number) || 0,
          isFiller: false,
        };
      })
      .filter((episode) => episode.episodeId && episode.number);

    return {
      totalEpisodes: episodes.length,
      episodes,
    };
  }

  try {
    const numericId = await getAnimeNumericId(animeId);
    const payload = await fetchJson<{ status?: boolean; success?: boolean; html?: string }>(
      `${API_BASE_URL}/episode/list/${numericId}`,
    );
    const $ = load(payload.html || "");
    const episodes = $(".ss-list a")
      .toArray()
      .map((el) => ({
        title: text($(el).attr("title")) || text($(el).text()),
        episodeId: episodeSlugFromHref($(el).attr("href")),
        number: Number($(el).attr("data-number")) || 0,
        isFiller: $(el).hasClass("ssl-item-filler"),
      }))
      .filter((episode) => episode.episodeId);

    if (episodes.length) {
      return {
        totalEpisodes: episodes.length,
        episodes,
      };
    }
  } catch (error) {
    console.warn(`[ANIME_EPISODES] Aniwatch episodes failed for ${animeId}; trying AnimeKai fallback:`, error);
  }

  return getAnikaiEpisodeList(animeId);
}

export async function searchAniwatchAnime(params: SearchAnimeParams): Promise<IAnimeSearch> {
  if (IS_ANIWAVES_SOURCE) {
    const url = new URL("/filter", BASE_URL);
    url.searchParams.set("keyword", params.q);
    if (params.page) url.searchParams.set("page", String(params.page));
    const html = await fetchText(url.href);
    const $ = load(html);
    const animes = extractAniwavesCards($, ".ani.items > .item, .film_list-wrap .item", 48);
    return {
      animes,
      totalPages: 1,
      hasNextPage: false,
      currentPage: params.page || 1,
    };
  }

  const url = new URL("/", BASE_URL);
  url.searchParams.set("s", params.q);
  const html = await fetchText(url.href);
  const $ = load(html);
  const animes = extractCards($, ".flw-item", 48);
  return {
    animes,
    totalPages: 1,
    hasNextPage: false,
    currentPage: params.page || 1,
  };
}

export async function getAniwatchSearchSuggestions(query: string) {
  if (IS_ANIWAVES_SOURCE) {
    const data = await searchAniwatchAnime({ q: query, page: 1 });
    return {
      suggestions: data.animes.slice(0, 8).map((anime) => ({
        ...anime,
        moreInfo: [anime.type, anime.episodes.sub ? `Ep ${anime.episodes.sub}` : ""].filter(Boolean).map(String),
      } satisfies ISuggestionAnime)),
    };
  }

  const payload = await fetchJson<{ success?: boolean; html?: string }>(
    `${API_BASE_URL}/search/suggestions?keyword=${encodeURIComponent(query)}`,
  );
  const $ = load(payload.html || "");
  return {
    suggestions: $(".nav-item")
      .toArray()
      .map((el) => {
        const card = cardFromElement($, el);
        return {
          ...card,
          moreInfo: $(el)
            .find(".film-infor")
            .contents()
            .toArray()
            .map((entry) => text($(entry).text()))
            .filter(Boolean),
        } satisfies ISuggestionAnime;
      })
      .filter((anime) => anime.id && anime.name),
  };
}

export async function getAniwatchAnimeSchedule(date?: string): Promise<IAnimeSchedule> {
  if (IS_ANIWAVES_SOURCE) {
    return getAnikaiSchedule(date || new Date().toISOString().slice(0, 10));
  }

  const targetDate = date || new Date().toISOString().slice(0, 10);
  try {
    const payload = await fetchJson<{ success?: boolean; html?: string }>(
      `${API_BASE_URL}/schedule/day?date=${encodeURIComponent(targetDate)}`,
    );
    const $ = load(payload.html || "");
    const scheduledAnimes = $("li")
      .toArray()
      .map((el) => {
        const href = $(el).find("a").attr("href");
        const timeValue = text($(el).find(".time").text());
        const airingTimestamp = timeValue ? new Date(`${targetDate}T${timeValue}:00`).getTime() : 0;
        return {
          id: slugFromHref(href),
          name: text($(el).find(".film-name, .dynamic-name").first().text()),
          jname: text($(el).find(".dynamic-name").first().attr("data-jname")),
          time: timeValue,
          airingTimestamp,
          secondsUntilAiring: airingTimestamp ? Math.floor((airingTimestamp - Date.now()) / 1000) : 0,
          episode: Number(text($(el).find("button").text()).match(/\d+/)?.[0]) || 0,
        };
      })
      .filter((item) => item.id && item.name);

    if (scheduledAnimes.length) {
      return { scheduledAnimes };
    }
  } catch (error) {
    console.warn("[ANIME_SCHEDULE] Aniwatch schedule fetch failed, using AnimeKai fallback:", error);
  }

  return getAnikaiSchedule(targetDate);
}

function decodeServerUrl(hash?: string | null) {
  if (!hash) return "";
  try {
    return Buffer.from(hash, "base64").toString("utf8");
  } catch {
    return "";
  }
}

async function getEpisodePage(episodeId: string) {
  const cleanId = episodeId.replace(/^\/+|\/+$/g, "");
  return load(await fetchText(`${BASE_URL}/${cleanId}/`));
}

export async function getAniwatchWpEpisodeServers(episodeId: string): Promise<IEpisodeServers> {
  if (IS_ANIWAVES_SOURCE) {
    const { numericId, episode } = parseAniwavesEpisodeId(episodeId);
    const payload = await getAniwavesJson<{ status?: number; result?: string }>(
      `/ajax/server/list?servers=${numericId}&eps=${encodeURIComponent(episode)}`,
    );
    const $ = load(payload.result || "");
    const result: IEpisodeServers = {
      episodeId,
      episodeNo: episode,
      sub: [],
      dub: [],
      raw: [],
    };

    $(".servers .type").each((_, typeEl) => {
      const sourceType = text($(typeEl).attr("data-type")).toLowerCase();
      const category = sourceType === "dub" ? "dub" : sourceType === "ssub" ? "raw" : "sub";
      $(typeEl)
        .find("li[data-link-id]")
        .each((_, serverEl) => {
          result[category].push({
            serverId: Number($(serverEl).attr("data-sv-id")) || result[category].length + 1,
            serverName: text($(serverEl).text()).toLowerCase(),
          });
        });
    });

    return result;
  }

  const $ = await getEpisodePage(episodeId);
  const result: IEpisodeServers = {
    episodeId,
    episodeNo: text($("body").text()).match(/episode\s+(\d+)/i)?.[1] || "0",
    sub: [],
    dub: [],
    raw: [],
  };

  $(".server-item").each((index, el) => {
    const category = text($(el).attr("data-type")) as "sub" | "dub" | "raw";
    const serverName = text($(el).attr("data-server-name")).toLowerCase();
    if (!category || !serverName || !result[category]) return;
    result[category].push({
      serverId: index + 1,
      serverName,
    });
  });

  return result;
}

export async function getAniwatchWpEpisodeSource(
  episodeId: string,
  serverName: string,
  category: "sub" | "dub" | "raw",
): Promise<IEpisodeSource> {
  if (IS_ANIWAVES_SOURCE) {
    const { numericId, episode } = parseAniwavesEpisodeId(episodeId);
    const payload = await getAniwavesJson<{ status?: number; result?: string }>(
      `/ajax/server/list?servers=${numericId}&eps=${encodeURIComponent(episode)}`,
    );
    const $ = load(payload.result || "");
    const targetType = category === "raw" ? "ssub" : category;
    const normalizedServer = serverName.toLowerCase();
    const server =
      $(`.servers .type[data-type='${targetType}'] li[data-link-id]`)
        .toArray()
        .find((el) => text($(el).text()).toLowerCase() === normalizedServer) ||
      $(`.servers .type[data-type='${targetType}'] li[data-link-id]`).first().get(0) ||
      $(".servers li[data-link-id]").first().get(0);
    const linkId = text($(server).attr("data-link-id"));
    if (!linkId) throw new Error(`Aniwaves stream server was not found for ${episodeId}`);

    const sourcePayload = await getAniwavesJson<{
      status?: number;
      result?: {
        url?: string;
        skip_data?: { intro?: [number, number]; outro?: [number, number] };
        sources?: IEpisodeSource["sources"];
        tracks?: IEpisodeSource["tracks"];
      };
    }>(`/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`);
    const source = sourcePayload.result;
    if (!source?.url) throw new Error(`Aniwaves stream was not found for ${episodeId}`);

    return {
      headers: {
        Referer: `${BASE_URL.replace(/\/$/, "")}/`,
      },
      tracks: source.tracks || [],
      intro: {
        start: source.skip_data?.intro?.[0] || 0,
        end: source.skip_data?.intro?.[1] || 0,
      },
      outro: {
        start: source.skip_data?.outro?.[0] || 0,
        end: source.skip_data?.outro?.[1] || 0,
      },
      sources: source.sources || [],
      anilistID: 0,
      malID: 0,
      provider: "aniwaves",
      iframeUrl: source.url,
    };
  }

  const $ = await getEpisodePage(episodeId);
  const normalizedCategory = category === "raw" ? "sub" : category;
  const normalizedServer = serverName.toLowerCase();
  const server =
    $(".server-item")
      .toArray()
      .find((el) => {
        const itemCategory = text($(el).attr("data-type")).toLowerCase();
        const itemServer = text($(el).attr("data-server-name")).toLowerCase();
        return itemCategory === normalizedCategory && itemServer === normalizedServer;
      }) ||
    $(".server-item")
      .toArray()
      .find((el) => text($(el).attr("data-type")).toLowerCase() === normalizedCategory) ||
    $(".server-item").first().get(0);
  const iframeUrl = decodeServerUrl($(server).attr("data-hash"));
  if (!iframeUrl) throw new Error(`Aniwatch stream was not found for ${episodeId}`);

  return {
    headers: {
      Referer: `${BASE_URL}/`,
    },
    tracks: [],
    intro: { start: 0, end: 0 },
    outro: { start: 0, end: 0 },
    sources: [],
    anilistID: 0,
    malID: 0,
    provider: "aniwatch",
    iframeUrl,
  };
}

export function isAniwatchWpEpisodeId(episodeId?: string | null) {
  return Boolean(episodeId && (IS_ANIWAVES_SOURCE || !episodeId.includes("?ep=")));
}
