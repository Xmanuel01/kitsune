import { load } from "cheerio";
import { resolveGogoSeriesUrlFromId } from "@/lib/gogoanime-catalog";

type EpisodeCategory = "sub" | "dub" | "raw";

type GogoSeriesCandidate = {
  title: string;
  url: string;
  score: number;
};

type GogoPlayerOption = {
  label: string;
  type: string;
  encryptedUrl1?: string;
  encryptedUrl2?: string;
  encryptedUrl3?: string;
  subtitleUrl?: string;
  key?: string;
  plainUrl?: string;
};

type GogoResolvedSource = {
  iframeUrl: string;
  serverLabel: string;
  episodePageUrl: string;
  provider: "gogoanime";
};

const GOGO_BASE_URL = "https://gogoanime.by";
const GOGO_PLAYER_URL =
  "https://9animetv.be/wp-content/plugins/video-player/includes/player/player.php";
const HTML_CACHE_TTL_MS = 15 * 60 * 1000;
const RESOLUTION_CACHE_TTL_MS = 15 * 60 * 1000;
const DIRECT_PLAYER_TYPES = new Set(["embed", "kiwi"]);
const htmlCache = new Map<string, { expiresAt: number; value: string }>();
const resolutionCache = new Map<
  string,
  { expiresAt: number; value: GogoResolvedSource }
>();

function now() {
  return Date.now();
}

function getCachedValue<T>(
  cache: Map<string, { expiresAt: number; value: T }>,
  key: string,
) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedValue<T>(
  cache: Map<string, { expiresAt: number; value: T }>,
  key: string,
  value: T,
  ttlMs: number,
) {
  cache.set(key, {
    expiresAt: now() + ttlMs,
    value,
  });
}

async function fetchHtml(url: string) {
  const cached = getCachedValue(htmlCache, url);
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
    throw new Error(`Gogoanime request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  setCachedValue(htmlCache, url, html, HTML_CACHE_TTL_MS);
  return html;
}

function normalizeTitle(input: string) {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(gogoanime|watch|online|subbed|english subbed)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugToTitle(slug: string) {
  return slug
    .replace(/-\d+$/, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(
  candidateTitle: string,
  queryTitle: string,
  category: EpisodeCategory,
) {
  const rawCandidate = candidateTitle.toLowerCase();
  const candidate = normalizeTitle(candidateTitle);
  const query = normalizeTitle(queryTitle);

  if (!candidate || !query) return 0;

  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const queryTokens = new Set(query.split(" ").filter(Boolean));

  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  let score = overlap * 5;

  if (candidate === query) score += 120;
  if (candidate.startsWith(query)) score += 40;
  if (candidate.includes(query)) score += 25;
  if (query.startsWith(candidate)) score += 10;

  const containsDubMarker = /\b(dub|dubbed|english dubbed)\b/.test(rawCandidate);
  if (category === "dub") {
    score += containsDubMarker ? 35 : -20;
  } else if (containsDubMarker) {
    score -= 25;
  }

  score -= Math.max(0, candidateTokens.size - queryTokens.size);

  return score;
}

function parseSearchResults(html: string, query: string, category: EpisodeCategory) {
  const $ = load(html);
  const seen = new Set<string>();
  const candidates: GogoSeriesCandidate[] = [];

  $('a.series[href*="/series/"]').each((_, element) => {
    const href = $(element).attr("href");
    const title = $(element).text().trim();

    if (!href || !title) return;

    const absoluteUrl = href.startsWith("http") ? href : new URL(href, GOGO_BASE_URL).href;
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);

    candidates.push({
      title,
      url: absoluteUrl,
      score: scoreCandidate(title, query, category),
    });
  });

  return candidates.sort((a, b) => b.score - a.score);
}

async function resolveSeriesUrl(
  primaryAnimeId: string,
  category: EpisodeCategory,
) {
  if (/^https?:\/\/[^/]+\/series\//i.test(primaryAnimeId)) {
    return {
      title: slugToTitle(primaryAnimeId),
      url: await resolveGogoSeriesUrlFromId(primaryAnimeId),
      score: 999,
    };
  }

  const fallbackTitle = slugToTitle(primaryAnimeId.replace(/^https?:\/\/[^/]+\//i, ""));
  const queries =
    category === "dub"
      ? [
          `${fallbackTitle} english dubbed`,
          fallbackTitle,
        ]
      : [fallbackTitle];

  const dedupedQueries = Array.from(
    new Set(queries.filter((value): value is string => Boolean(value && value.trim()))),
  );

  const aggregated = new Map<string, GogoSeriesCandidate>();

  for (const query of dedupedQueries) {
    const html = await fetchHtml(`${GOGO_BASE_URL}/?s=${encodeURIComponent(query)}`);
    for (const candidate of parseSearchResults(html, query, category)) {
      const existing = aggregated.get(candidate.url);
      if (!existing || candidate.score > existing.score) {
        aggregated.set(candidate.url, candidate);
      }
    }
  }

  const ranked = Array.from(aggregated.values()).sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

function parseEpisodePageUrl(seriesHtml: string, episodeNumber: number) {
  const $ = load(seriesHtml);
  const target = String(episodeNumber);
  const item = $(`.episode-item[data-episode-number="${target}"] a`).first();

  if (item.length) {
    const href = item.attr("href");
    if (href) {
      return href.startsWith("http") ? href : new URL(href, GOGO_BASE_URL).href;
    }
  }

  let fallbackUrl: string | null = null;
  $(".episode-item a").each((_, element) => {
    if (fallbackUrl) return;
    const text = $(element).text().trim();
    if (!text) return;
    const match = text.match(/episode\s+(\d+)/i);
    if (!match || Number(match[1]) !== episodeNumber) return;
    const href = $(element).attr("href");
    if (!href) return;
    fallbackUrl = href.startsWith("http") ? href : new URL(href, GOGO_BASE_URL).href;
  });

  return fallbackUrl;
}

function parsePlayerOptions(
  episodeHtml: string,
  category: EpisodeCategory,
) {
  const $ = load(episodeHtml);
  const serverType = category === "dub" ? "dub" : "sub";
  const options: GogoPlayerOption[] = [];

  $(`#w-servers .type[data-type="${serverType}"] .player-type-link`).each(
    (_, element) => {
      const node = $(element);
      const label = node.text().trim();
      if (!label) return;

      options.push({
        label,
        type: String(node.attr("data-type") || "").trim(),
        encryptedUrl1: node.attr("data-encrypted-url1") || undefined,
        encryptedUrl2: node.attr("data-encrypted-url2") || undefined,
        encryptedUrl3: node.attr("data-encrypted-url3") || undefined,
        subtitleUrl: node.attr("data-subtitle") || undefined,
        key: node.attr("data-key") || undefined,
        plainUrl: node.attr("data-plain-url") || undefined,
      });
    },
  );

  const featureImage =
    $('meta[property="og:image"]').attr("content")?.trim() || "";
  const postIdMatch = episodeHtml.match(/const defaultPostId\s*=\s*"([^"]+)"/);

  return {
    featureImage,
    options,
    postId: postIdMatch?.[1] || "",
  };
}

function buildPlayerUrl(
  option: GogoPlayerOption,
  featureImage: string,
  postId: string,
) {
  if (DIRECT_PLAYER_TYPES.has(option.type) && option.plainUrl) {
    return option.plainUrl.startsWith("http")
      ? option.plainUrl
      : new URL(option.plainUrl, GOGO_BASE_URL).href;
  }

  if (!option.type || !option.encryptedUrl1) {
    throw new Error("Gogoanime player metadata is incomplete");
  }

  const params = new URLSearchParams();
  params.set(option.type, option.encryptedUrl1);

  if (option.encryptedUrl2) params.set("url2", option.encryptedUrl2);
  if (option.encryptedUrl3) params.set("url3", option.encryptedUrl3);
  if (featureImage) params.set("feature_image", featureImage);
  params.set("user_agent", "Mozilla/5.0");
  params.set("ref", "gogoanime.by");
  if (option.subtitleUrl) params.set("subtitle", option.subtitleUrl);
  if (option.key) params.set("key", option.key);
  if (postId) params.set("postId", postId);

  return `${GOGO_PLAYER_URL}?${params.toString()}`;
}

export async function getGogoanimeEpisodeSource(options: {
  primaryAnimeId: string;
  episodeNumber: number;
  category: EpisodeCategory;
  episodePageUrl?: string;
}) {
  const { primaryAnimeId, episodeNumber, category, episodePageUrl } = options;
  const cacheKey = `${episodePageUrl || primaryAnimeId}::${episodeNumber}::${category}`;
  const cached = getCachedValue(resolutionCache, cacheKey);
  if (cached) return cached;

  let resolvedEpisodePageUrl: string | undefined = episodePageUrl;
  if (!resolvedEpisodePageUrl) {
    const series = await resolveSeriesUrl(primaryAnimeId, category);
    if (!series) {
      throw new Error("No matching gogoanime series was found");
    }

    const seriesHtml = await fetchHtml(series.url);
    resolvedEpisodePageUrl =
      parseEpisodePageUrl(seriesHtml, episodeNumber) || undefined;
    if (!resolvedEpisodePageUrl) {
      throw new Error(`Episode ${episodeNumber} was not found on gogoanime`);
    }
  }

  const episodeHtml = await fetchHtml(resolvedEpisodePageUrl);
  const { featureImage, options: playerOptions, postId } = parsePlayerOptions(
    episodeHtml,
    category,
  );

  if (!playerOptions.length) {
    throw new Error("No gogoanime player options were found");
  }

  const preferred =
    playerOptions.find((player) => player.label.toLowerCase() === "hd-1") ||
    playerOptions[0];

  const resolved = {
    iframeUrl: buildPlayerUrl(preferred, featureImage, postId),
    serverLabel: preferred.label,
    episodePageUrl: resolvedEpisodePageUrl,
    provider: "gogoanime" as const,
  };

  setCachedValue(resolutionCache, cacheKey, resolved, RESOLUTION_CACHE_TTL_MS);
  return resolved;
}
