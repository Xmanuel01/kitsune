import { load } from "cheerio";
import { Element } from "domhandler";
import { IAnimeSearch, ISuggestionAnime, SearchAnimeParams, Type } from "@/types/anime";
import { IEpisodeServers, IEpisodeSource, IEpisodes } from "@/types/episodes";

const ANIKAI_BASE_URL = (process.env.ANIKAI_SOURCE_URL || "https://anikai.to").replace(/\/$/, "");

type EpisodeCategory = "sub" | "dub" | "raw";

type AnikaiEpisodeRef = {
  animeId: string;
  number: number;
  token?: string;
};

type AnikaiServerRef = {
  name: string;
  category: EpisodeCategory;
  lid: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function headers(referer = `${ANIKAI_BASE_URL}/`, isAjax = true) {
  return {
    Accept: "application/json,text/html,*/*",
    Referer: referer,
    "User-Agent": "Mozilla/5.0",
    ...(isAjax ? { "X-Requested-With": "XMLHttpRequest" } : {}),
  };
}

async function fetchText(url: string, referer?: string) {
  const response = await fetch(url, {
    headers: headers(referer, false),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`AnimeKai request failed: ${response.status} ${url}`);
  }
  return response.text();
}

async function fetchJson<T>(url: string, referer?: string): Promise<T> {
  const response = await fetch(url, {
    headers: headers(referer),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`AnimeKai API request failed: ${response.status} ${url}`);
  }
  return response.json() as Promise<T>;
}

function rc4(key: string, data: string) {
  const s = Array.from({ length: 256 }, (_, index) => index);
  const keyCodes = Array.from(key, (char) => char.charCodeAt(0));
  let j = 0;

  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + keyCodes[i % keyCodes.length]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }

  let i = 0;
  j = 0;
  let result = "";
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    const k = s[(s[i] + s[j]) % 256];
    result += String.fromCharCode((data.charCodeAt(index) ^ k) & 0xff);
  }

  return result;
}

function reverse(input: string) {
  return Array.from(input).reverse().join("");
}

function replaceChars(input: string, searchChars: string, replaceCharsValue: string) {
  const replacement = new Map<string, string>();
  Array.from(searchChars).forEach((char, index) => {
    replacement.set(char, replaceCharsValue[index]);
  });
  return Array.from(input, (char) => replacement.get(char) || char).join("");
}

function base64UrlEncode(input: string) {
  const bytes = Uint8Array.from(Array.from(input, (char) => char.charCodeAt(0) & 0xff));
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("latin1");
}

function normalizeType(value?: string | null) {
  const normalized = text(value).toUpperCase();
  if (normalized.includes("MOVIE")) return Type.Movie;
  if (normalized.includes("ONA")) return Type.Ona;
  return Type.Tv;
}

function slugFromHref(href?: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, ANIKAI_BASE_URL);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch" && parts[1]) return parts[1];
    return parts[parts.length - 1] || "";
  } catch {
    return href.replace(/^\/+|\/+$/g, "").split("/").pop()?.split(/[?#]/)[0] || "";
  }
}

function numberFromText(value?: string | null) {
  const match = text(value).match(/\d+/)?.[0];
  return typeof match === "string" ? Number(match) : null;
}

function cardFromAnikaiElement($: ReturnType<typeof load>, el: Element) {
  const root = $(el);
  const href =
    root.attr("href") ||
    root.find("a[href*='/watch/']").first().attr("href") ||
    root.find(".inner > a").first().attr("href");
  const titleElement = root.find(".title").first();
  const infoNodes = root
    .find(".info")
    .children()
    .toArray()
    .map((entry) => $(entry).text().trim());
  const infoText = infoNodes.join(" ");

  return {
    id: slugFromHref(href),
    name: text(titleElement.text()) || text(root.attr("title")),
    jname: text(titleElement.attr("data-jp")) || text(titleElement.text()) || text(root.attr("title")),
    poster:
      text(root.find(".poster img").first().attr("data-src")) ||
      text(root.find(".poster img").first().attr("src")) ||
      text(root.find("img").first().attr("data-src")) ||
      text(root.find("img").first().attr("src")),
    episodes: {
      sub: numberFromText(root.find(".info .sub").first().text()),
      dub: numberFromText(root.find(".info .dub").first().text()),
    },
    type: normalizeType(infoNodes[infoNodes.length - 1] || infoText),
  };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function parseTotalPages($: ReturnType<typeof load>) {
  const pages = $("ul.pagination a.page-link, ul.pagination .page-link")
    .toArray()
    .map((el) => Number(text($(el).text())))
    .filter((value) => Number.isFinite(value) && value > 0);
  return pages.length ? Math.max(...pages) : 1;
}

function normalizeSearchKeyword(query: string) {
  return text(query).replace(/[\W_]+/g, "+").replace(/\++/g, "+").replace(/^\+|\+$/g, "");
}

function animekaiEncrypt(input: string) {
  const encoded = encodeURIComponent(input);
  return base64UrlEncode(
    replaceChars(
      base64UrlEncode(
        rc4(
          "sXmH96C4vhRrgi8",
          reverse(
            reverse(
              base64UrlEncode(
                rc4(
                  "kOCJnByYmfI",
                  replaceChars(
                    replaceChars(
                      reverse(base64UrlEncode(rc4("0DU8ksIVlFcia2", encoded))),
                      "1wctXeHqb2",
                      "1tecHq2Xbw",
                    ),
                    "48KbrZx1ml",
                    "Km8Zb4lxr1",
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      "hTn79AMjduR5",
      "djn5uT7AMR9h",
    ),
  );
}

function animekaiDecrypt(input: string) {
  const decrypted = rc4(
    "0DU8ksIVlFcia2",
    base64UrlDecode(
      reverse(
        replaceChars(
          replaceChars(
            rc4(
              "kOCJnByYmfI",
              base64UrlDecode(
                reverse(
                  reverse(
                    rc4(
                      "sXmH96C4vhRrgi8",
                      base64UrlDecode(
                        replaceChars(base64UrlDecode(input), "djn5uT7AMR9h", "hTn79AMjduR5"),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            "Km8Zb4lxr1",
            "48KbrZx1ml",
          ),
          "1tecHq2Xbw",
          "1wctXeHqb2",
        ),
      ),
    ),
  );
  return decodeURIComponent(decrypted);
}

function makeAnikaiEpisodeId(animeId: string, number: number, token: string) {
  return `anikai:${animeId}:${number}:${token}`;
}

function makeAnikaiPageEpisodeId(animeId: string, number: number) {
  return `anikai-page:${animeId}:${number}`;
}

export function isAnikaiEpisodeId(episodeId?: string | null) {
  return Boolean(
    episodeId?.startsWith("anikai:") ||
      episodeId?.startsWith("anikai-page:"),
  );
}

export function toAnikaiPageEpisodeId(episodeId?: string | null) {
  if (!episodeId) return null;
  if (isAnikaiEpisodeId(episodeId)) return episodeId;
  const match = episodeId.match(/^([^?]+)\?ep=(\d+)$/i);
  if (!match) return null;
  return makeAnikaiPageEpisodeId(match[1], Number(match[2]) || 0);
}

function parseAnikaiEpisodeId(episodeId: string): AnikaiEpisodeRef | null {
  if (episodeId.startsWith("anikai-page:")) {
    const [, animeId, number] = episodeId.split(":");
    if (!animeId || !number) return null;
    return {
      animeId,
      number: Number(number) || 0,
    };
  }

  if (episodeId.startsWith("anikai:")) {
    const [, animeId, number, ...tokenParts] = episodeId.split(":");
    const token = tokenParts.join(":");
    if (!animeId || !number) return null;
    return {
      animeId,
      number: Number(number) || 0,
      token: token || undefined,
    };
  }

  const match = episodeId.match(/^([^?]+)\?ep=(\d+)/i);
  if (!match) return null;
  return {
    animeId: match[1],
    number: Number(match[2]) || 0,
  };
}

async function getBookmarkId(animeId: string) {
  const watchUrl = `${ANIKAI_BASE_URL}/watch/${animeId}`;
  const html = await fetchText(watchUrl, `${ANIKAI_BASE_URL}/home`);
  const $ = load(html);
  const bookmarkId =
    $(".user-bookmark").first().attr("data-id") ||
    $("[data-id][data-al]").first().attr("data-id") ||
    $("[data-id]").toArray().map((el) => text($(el).attr("data-id"))).find((id) => /^\d+$/.test(id));

  if (!bookmarkId) {
    throw new Error(`AnimeKai title id was not found for ${animeId}`);
  }

  return bookmarkId;
}

async function getPageEpisodeList(animeId: string): Promise<IEpisodes> {
  const html = await fetchText(`${ANIKAI_BASE_URL}/watch/${animeId}`, `${ANIKAI_BASE_URL}/home`);
  const $ = load(html);
  const subCount = Number(text($(".main-entity .info .sub, .entity-section .info .sub").first().text()).match(/\d+/)?.[0]) || 0;
  const dubCount = Number(text($(".main-entity .info .dub, .entity-section .info .dub").first().text()).match(/\d+/)?.[0]) || 0;
  const totalFromDetails =
    Number(
      $(".detail div")
        .toArray()
        .map((el) => text($(el).text()).match(/^Episodes:\s*(\d+)/i)?.[1])
        .find(Boolean),
    ) || 0;
  const totalEpisodes = Math.max(subCount, dubCount, totalFromDetails);
  const episodes = Array.from({ length: totalEpisodes }, (_, index) => {
    const number = index + 1;
    return {
      title: `Episode ${number}`,
      episodeId: makeAnikaiPageEpisodeId(animeId, number),
      number,
      isFiller: false,
    };
  });

  return {
    totalEpisodes: episodes.length,
    episodes,
  };
}

async function getEpisodeToken(ref: AnikaiEpisodeRef) {
  if (ref.token) return ref.token;
  const episodes = await getAnikaiEpisodeList(ref.animeId);
  return episodes.episodes.find((episode) => episode.number === ref.number)?.episodeId.split(":").pop() || "";
}

export async function getAnikaiEpisodeList(animeId: string): Promise<IEpisodes> {
  try {
    const bookmarkId = await getBookmarkId(animeId);
    const encryptedId = animekaiEncrypt(bookmarkId);
    const payload = await fetchJson<{ result?: string }>(
      `${ANIKAI_BASE_URL}/ajax/episodes/list?ani_id=${encodeURIComponent(bookmarkId)}&_=${encodeURIComponent(encryptedId)}`,
      `${ANIKAI_BASE_URL}/watch/${animeId}`,
    );
    const $ = load(payload.result || "");
    const episodes = $("a")
      .toArray()
      .map((el) => {
        const root = $(el);
        const number = Number(root.attr("num")) || Number(text(root.text()).match(/\d+/)?.[0]) || 0;
        const token = text(root.attr("token"));
        return {
          title: text(root.find("span").first().text()) || `Episode ${number}`,
          episodeId: token ? makeAnikaiEpisodeId(animeId, number, token) : "",
          number,
          isFiller: false,
        };
      })
      .filter((episode) => episode.episodeId && episode.number)
      .sort((a, b) => a.number - b.number);

    if (episodes.length) {
      return {
        totalEpisodes: episodes.length,
        episodes,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ANIKAI_EPISODES] Ajax episode list failed for ${animeId}; using watch-page fallback: ${message}`,
    );
  }

  return getPageEpisodeList(animeId);
}

async function getAnikaiServers(episodeId: string) {
  const ref = parseAnikaiEpisodeId(episodeId);
  if (!ref) {
    throw new Error(`Invalid AnimeKai episode id: ${episodeId}`);
  }

  const token = await getEpisodeToken(ref);
  if (!token) {
    throw new Error(`AnimeKai episode token was not found for ${episodeId}`);
  }

  const encryptedToken = animekaiEncrypt(token);
  const payload = await fetchJson<{ result?: string }>(
    `${ANIKAI_BASE_URL}/ajax/links/list?token=${encodeURIComponent(token)}&_=${encodeURIComponent(encryptedToken)}`,
    `${ANIKAI_BASE_URL}/watch/${ref.animeId}`,
  );
  const $ = load(payload.result || "");
  const servers: AnikaiServerRef[] = [];

  $(".server").each((_, el) => {
    const root = $(el);
    const parent = root.parent();
    const categoryRaw = text(parent.attr("data-id")).toLowerCase();
    const category: EpisodeCategory =
      categoryRaw === "dub" ? "dub" : categoryRaw === "raw" ? "raw" : "sub";
    const lid = text(root.attr("data-lid"));
    const name = text(root.text());
    if (!lid) return;
    servers.push({ name, category, lid });
  });

  if (!servers.length) {
    throw new Error(`AnimeKai servers were not found for ${episodeId}`);
  }

  return { ref, servers };
}

export async function getAnikaiEpisodeServers(episodeId: string): Promise<IEpisodeServers> {
  const pageRef = parseAnikaiEpisodeId(episodeId);
  if (episodeId.startsWith("anikai-page:") && pageRef) {
    return {
      episodeId,
      episodeNo: String(pageRef.number || 0),
      sub: [{ serverId: 1, serverName: "hd-1" }],
      dub: [{ serverId: 1, serverName: "hd-1" }],
      raw: [],
    };
  }

  const { ref, servers } = await getAnikaiServers(episodeId);
  const result: IEpisodeServers = {
    episodeId,
    episodeNo: String(ref.number || 0),
    sub: [],
    dub: [],
    raw: [],
  };
  const counters: Record<EpisodeCategory, number> = { sub: 0, dub: 0, raw: 0 };

  servers.forEach((server) => {
    counters[server.category] += 1;
    result[server.category].push({
      serverId: counters[server.category],
      serverName: counters[server.category] === 1 ? "hd-1" : "hd-2",
    });
  });

  return result;
}

export async function getAnikaiEpisodeSource(
  episodeId: string,
  serverName: string,
  category: EpisodeCategory,
): Promise<IEpisodeSource> {
  const pageRef = parseAnikaiEpisodeId(episodeId);
  if (episodeId.startsWith("anikai-page:") && pageRef) {
    return {
      headers: {
        Referer: `${ANIKAI_BASE_URL}/`,
      },
      tracks: [],
      intro: { start: 0, end: 0 },
      outro: { start: 0, end: 0 },
      sources: [],
      anilistID: 0,
      malID: 0,
      provider: "anikai",
      iframeUrl: `${ANIKAI_BASE_URL}/watch/${pageRef.animeId}#ep=${pageRef.number}`,
      fallbackFromServer: "AnimeKai",
      fallbackReason: "AnimeKai ajax stream endpoint blocked server-side resolution",
    };
  }

  const { ref, servers } = await getAnikaiServers(episodeId);
  const normalizedCategory = category === "raw" ? "sub" : category;
  const categoryServers = servers.filter((server) => server.category === normalizedCategory);
  const fallbackServers = servers.filter((server) => server.category === "sub");
  const serverIndex = serverName === "hd-2" ? 1 : 0;
  const selected = categoryServers[serverIndex] || categoryServers[0] || fallbackServers[0] || servers[0];

  if (!selected?.lid) {
    throw new Error(`AnimeKai playable server was not found for ${episodeId}`);
  }

  const encryptedLid = animekaiEncrypt(selected.lid);
  const payload = await fetchJson<{ result?: string }>(
    `${ANIKAI_BASE_URL}/ajax/links/view?id=${encodeURIComponent(selected.lid)}&_=${encodeURIComponent(encryptedLid)}`,
    `${ANIKAI_BASE_URL}/watch/${ref.animeId}`,
  );
  if (!payload.result) {
    throw new Error(`AnimeKai stream link was not found for ${episodeId}`);
  }

  const decrypted = JSON.parse(animekaiDecrypt(payload.result)) as {
    url?: string;
    skip?: { intro?: [number, number]; outro?: [number, number] };
  };
  if (!decrypted.url) {
    throw new Error(`AnimeKai stream url was not found for ${episodeId}`);
  }

  return {
    headers: {
      Referer: `${ANIKAI_BASE_URL}/`,
    },
    tracks: [],
    intro: {
      start: decrypted.skip?.intro?.[0] || 0,
      end: decrypted.skip?.intro?.[1] || 0,
    },
    outro: {
      start: decrypted.skip?.outro?.[0] || 0,
      end: decrypted.skip?.outro?.[1] || 0,
    },
    sources: [],
    anilistID: 0,
    malID: 0,
    provider: "anikai",
    iframeUrl: decrypted.url,
    fallbackFromServer: selected.name,
  };
}

export async function searchAnikaiAnime(params: SearchAnimeParams): Promise<IAnimeSearch> {
  const query = normalizeSearchKeyword(params.q);
  const page = Math.max(1, Number(params.page) || 1);
  const url = new URL("/browser", ANIKAI_BASE_URL);
  url.searchParams.set("keyword", query);
  url.searchParams.set("page", String(page));

  const html = await fetchText(url.href, `${ANIKAI_BASE_URL}/home`);
  const $ = load(html);
  const animes = uniqueById(
    $(".aitem")
      .toArray()
      .map((el) => cardFromAnikaiElement($, el))
      .filter((anime) => anime.id && anime.name && anime.poster),
  );
  const totalPages = parseTotalPages($);

  return {
    animes,
    totalPages,
    hasNextPage: page < totalPages,
    currentPage: page,
  };
}

export async function getAnikaiSearchSuggestions(query: string) {
  const payload = await fetchJson<{ result?: { html?: string } | string }>(
    `${ANIKAI_BASE_URL}/ajax/anime/search?keyword=${encodeURIComponent(normalizeSearchKeyword(query))}`,
    `${ANIKAI_BASE_URL}/browser`,
  );
  const html =
    typeof payload.result === "string"
      ? payload.result
      : typeof payload.result?.html === "string"
        ? payload.result.html
        : "";
  const $ = load(html);

  return {
    suggestions: uniqueById(
      $("a.aitem")
        .toArray()
        .map((el) => {
          const card = cardFromAnikaiElement($, el);
          return {
            ...card,
            moreInfo: $(el)
              .find(".info")
              .children()
              .toArray()
              .map((entry) => $(entry).text().trim())
              .filter(Boolean),
          } satisfies ISuggestionAnime;
        })
        .filter((anime) => anime.id && anime.name),
    ),
  };
}
