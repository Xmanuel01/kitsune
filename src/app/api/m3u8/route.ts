import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Comprehensive list of media and subtitle formats
const MEDIA_EXTENSIONS = [
  // Video segments
  ".ts",
  ".m4s",
  ".mp4",
  ".m4v",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  // Audio
  ".aac",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  // Playlists
  ".m3u8",
  ".m3u",
  ".mpd",
  // Subtitles
  ".vtt",
  ".srt",
  ".ass",
  ".ssa",
  ".ttml",
  ".dfxp",
  ".sbv",
  ".sub",
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  // Other
  ".xml",
  ".json",
  ".txt",
];

const MEDIA_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/dash+xml",
  "video/mp2t",
  "video/mp4",
  "video/webm",
  "video/x-flv",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "text/vtt",
  "application/x-subrip",
  "application/ttml+xml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/octet-stream",
];

function shouldProxyByExtension(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function shouldProxyContent(contentType: string | null, url: URL): boolean {
  if (!contentType) {
    return shouldProxyByExtension(url);
  }

  const ct = contentType.toLowerCase().split(";")[0];

  if (MEDIA_CONTENT_TYPES.some((mediaType) => ct.includes(mediaType))) {
    return true;
  }

  if (ct.startsWith("text/")) {
    return true;
  }

  if (
    ct.includes("application/") ||
    ct.includes("video/") ||
    ct.includes("audio/") ||
    ct.includes("image/")
  ) {
    return true;
  }

  return shouldProxyByExtension(url);
}

/**
 * Decide if we should treat upstream as text (so we can rewrite it).
 * This is where we fix the "application/octet-stream" playlist issue.
 */
function isTextBasedContent(contentType: string | null, url: URL): boolean {
  const pathname = url.pathname.toLowerCase();

  // Extension-based detection first (covers mislabelled content-type)
  if (
    pathname.endsWith(".m3u8") ||
    pathname.endsWith(".m3u") ||
    pathname.endsWith(".vtt") ||
    pathname.endsWith(".srt") ||
    pathname.endsWith(".xml") ||
    pathname.endsWith(".mpd") ||
    pathname.endsWith(".json") ||
    pathname.endsWith(".txt")
  ) {
    return true;
  }

  if (!contentType) return false;

  const ct = contentType.toLowerCase();

  return (
    ct.startsWith("text/") ||
    ct.includes("application/vnd.apple.mpegurl") ||
    ct.includes("application/x-mpegurl") ||
    ct.includes("application/dash+xml") ||
    ct.includes("application/xml") ||
    ct.includes("application/json") ||
    ct.includes("text/vtt") ||
    ct.includes("application/x-subrip") ||
    ct.includes("application/ttml+xml")
  );
}

function rewriteM3U8(body: string, targetUrl: URL, refEncoded: string): string {
  const lines = body.split("\n");

  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      return line;
    }

    // Absolute URLs
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const encoded = encodeURIComponent(trimmed);
      return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
    }

    // Protocol-relative URLs (//example.com/path)
    if (trimmed.startsWith("//")) {
      try {
        const absolute = new URL(targetUrl.protocol + trimmed).toString();
        const encoded = encodeURIComponent(absolute);
        return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
      } catch {
        return line;
      }
    }

    // Absolute paths (/path/to/file)
    if (trimmed.startsWith("/")) {
      try {
        const absolute = new URL(trimmed, targetUrl.origin).toString();
        const encoded = encodeURIComponent(absolute);
        return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
      } catch {
        return line;
      }
    }

    // Relative paths (segments, other playlists, etc.)
    if (!trimmed.includes("://") && !trimmed.startsWith("#")) {
      try {
        const absolute = new URL(trimmed, targetUrl).toString();
        const encoded = encodeURIComponent(absolute);
        return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
      } catch {
        return line;
      }
    }

    return line;
  });

  return rewrittenLines.join("\n");
}

function rewriteVTT(body: string, targetUrl: URL, refEncoded: string): string {
  return body.replace(
    /(https?:\/\/[^\s\r\n\)]+|\.\.?\/[^\s\r\n\)]+)/g,
    (match: string) => {
      try {
        let absolute: string;

        if (match.startsWith("http")) {
          absolute = match;
        } else {
          absolute = new URL(match, targetUrl).toString();
        }

        const encoded = encodeURIComponent(absolute);
        return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
      } catch {
        return match;
      }
    }
  );
}

function rewriteXML(body: string, targetUrl: URL, refEncoded: string): string {
  return body.replace(
    /<([^>]+)>(https?:\/\/[^<]+|\.\.?\/[^<]+)<\/[^>]+>/gi,
    (match: string, tag: string, url: string) => {
      try {
        let absolute: string;

        if (url.startsWith("http")) {
          absolute = url;
        } else {
          absolute = new URL(url, targetUrl).toString();
        }

        const encoded = encodeURIComponent(absolute);
        return `<${tag}>/api/m3u8?url=${encoded}&ref=${refEncoded}</${tag}>`;
      } catch {
        return match;
      }
    }
  );
}

function rewriteContent(
  body: string,
  targetUrl: URL,
  ref: string,
  contentType: string | null
): string {
  const refEncoded = encodeURIComponent(ref);
  const lowerPath = targetUrl.pathname.toLowerCase();

  if (contentType?.includes("vtt") || lowerPath.endsWith(".vtt")) {
    return rewriteVTT(body, targetUrl, refEncoded);
  }

  if (
    contentType?.includes("xml") ||
    lowerPath.endsWith(".xml") ||
    lowerPath.endsWith(".mpd")
  ) {
    return rewriteXML(body, targetUrl, refEncoded);
  }

  // Default: treat as M3U8/playlist
  return rewriteM3U8(body, targetUrl, refEncoded);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get("url");
  const ref = searchParams.get("ref") || "https://your-anime-site.com/";

  if (!urlParam) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return new NextResponse("Invalid URL format", { status: 400 });
  }

  // Security: Prevent proxy loops and access to local resources
  const hostHeader = req.headers.get("host")?.split(":")[0];
  if (
    target.hostname === "localhost" ||
    target.hostname === "127.0.0.1" ||
    target.hostname === hostHeader
  ) {
    return new NextResponse("Access to local resources is not allowed", {
      status: 403,
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds

    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: ref,
        Origin: new URL(ref).origin,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Sec-Fetch-Mode": "cors",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!upstream.ok) {
      return new NextResponse(
        `Upstream error: ${upstream.status} ${upstream.statusText}`,
        {
          status: upstream.status,
          statusText: upstream.statusText,
        }
      );
    }

    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");

    const headers = new Headers();

    // CORS
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Range, User-Agent"
    );

    if (contentType) headers.set("Content-Type", contentType);

    // Cache headers
    if (contentType?.includes("video") || contentType?.includes("audio")) {
      headers.set("Cache-Control", "public, max-age=7200");
    } else if (contentType?.includes("image")) {
      headers.set("Cache-Control", "public, max-age=86400");
    } else {
      headers.set("Cache-Control", "public, max-age=300");
    }

    const treatAsText = isTextBasedContent(contentType, target);

    // Text path: playlists, subtitles, XML manifests, etc – we rewrite URLs.
    if (treatAsText && shouldProxyContent(contentType, target)) {
      const text = await upstream.text();

      if (!text) {
        return new NextResponse("Empty content", { status: 500 });
      }

      const rewritten = rewriteContent(text, target, ref, contentType);
      // IMPORTANT: do NOT forward upstream Content-Length here,
      // because the rewritten body is a different size.
      return new NextResponse(rewritten, { status: 200, headers });
    }

    // Binary path: segments, video, audio, images… we just pipe through.
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, { status: 200, headers });
  } catch (error: any) {
    console.error("Proxy error:", error);

    if (error?.name === "AbortError") {
      return new NextResponse("Upstream timeout", { status: 504 });
    }

    return new NextResponse(error?.message || "Internal server error", {
      status: 500,
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range, User-Agent",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function HEAD(req: NextRequest) {
  // Reuse GET logic to compute headers, then drop the body.
  const res = await GET(req);
  return new NextResponse(null, {
    status: res.status,
    headers: res.headers,
  });
}
