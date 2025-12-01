import { NextRequest, NextResponse } from "next/server";
import { getRedis, getCached, getCachedBuffer, setCached } from "@/lib/redis";
import { createHash } from "crypto";

export const runtime = "nodejs";

const TEXT_EXTENSIONS = [
  ".m3u8", ".m3u", ".vtt", ".srt", ".xml", ".mpd", ".json", ".txt"
];

function isTextContent(contentType: string | null, url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  if (TEXT_EXTENSIONS.some(ext => pathname.endsWith(ext))) return true;
  if (!contentType) return false;
  
  const ct = contentType.toLowerCase();
  return ct.startsWith("text/") || 
         ct.includes("application/vnd.apple.mpegurl") ||
         ct.includes("application/x-mpegurl");
}

function rewriteM3U8(body: string, targetUrl: URL, refEncoded: string): string {
  return body.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return line;

    try {
      let absolute: string;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        absolute = trimmed;
      } else if (trimmed.startsWith("//")) {
        absolute = new URL(targetUrl.protocol + trimmed).toString();
      } else if (trimmed.startsWith("/")) {
        absolute = new URL(trimmed, targetUrl.origin).toString();
      } else {
        absolute = new URL(trimmed, targetUrl).toString();
      }

      const encoded = encodeURIComponent(absolute);
      return `/api/m3u8?url=${encoded}&ref=${refEncoded}`;
    } catch {
      return line;
    }
  }).join("\n");
}

function getCacheKey(url: string): string {
  const hash = createHash('sha256');
  hash.update(url);
  const hashHex = hash.digest('hex');
  return `m3u8:${hashHex.slice(0, 16)}`;
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

  // Security checks
  const hostHeader = req.headers.get("host")?.split(":")[0];
  if (
    target.hostname === "localhost" ||
    target.hostname === "127.0.0.1" ||
    target.hostname === hostHeader
  ) {
    return new NextResponse("Access denied", { status: 403 });
  }

  const lowerPath = target.pathname.toLowerCase();
  const isSegment = lowerPath.endsWith(".ts") || 
                    lowerPath.endsWith(".m4s") ||
                    lowerPath.endsWith(".mp4");
  const isPlaylist = lowerPath.endsWith(".m3u8");

  // Create cache key
  const cacheKey = getCacheKey(urlParam);

  try {
    // Check Redis cache for segments (24h cache)
    if (isSegment) {
      const cached = await getCachedBuffer(cacheKey);
      if (cached) {
        console.log(`✅ [CACHE HIT] ${lowerPath.substring(lowerPath.length - 30)}`);
        return new NextResponse(cached as any, {
          status: 200,
          headers: {
            "Content-Type": "video/mp2t",
            "Cache-Control": "public, max-age=31536000, immutable",
            "CDN-Cache-Control": "public, max-age=31536000",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Length",
            "Content-Length": cached.length.toString(),
          },
        });
      }
    }

    // Check Redis cache for playlists (short cache)
    if (isPlaylist) {
      const cached = await getCached(cacheKey);
      if (cached) {
        console.log(`✅ [CACHE HIT] ${lowerPath}`);
        return new NextResponse(cached, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "public, max-age=10",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    console.log(`❌ [CACHE MISS] Fetching: ${lowerPath.substring(lowerPath.length - 30)}`);

    // Fetch from origin
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const rangeHeader = req.headers.get("range");
    const fetchHeaders: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": ref,
      "Origin": new URL(ref).origin,
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
    };

    if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: fetchHeaders,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
      });
    }

    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");
    
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range");

    if (contentType) headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);

    // Cache headers
    if (isSegment) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("CDN-Cache-Control", "public, max-age=31536000");
    } else if (isPlaylist) {
      headers.set("Cache-Control", "public, max-age=10");
    }

    const treatAsText = isTextContent(contentType, target);

    // Text content (playlists, subtitles)
    if (treatAsText) {
      const text = await upstream.text();
      if (!text) {
        return new NextResponse("Empty content", { status: 500 });
      }

      const refEncoded = encodeURIComponent(ref);
      const rewritten = rewriteM3U8(text, target, refEncoded);

      // Cache playlists in Redis (10 seconds)
      if (isPlaylist) {
        try {
          await setCached(cacheKey, rewritten, 10);
        } catch (cacheError) {
          console.error(`❌ Cache error for playlist ${lowerPath}:`, cacheError);
        }
      }

      return new NextResponse(rewritten, { status: 200, headers });
    }

    // Binary content (segments)
    if (isSegment) {
      const buffer = await upstream.arrayBuffer();

      // Cache segments in Redis (24 hours) if under 10MB
      if (buffer.byteLength < 10 * 1024 * 1024) {
        try {
          await setCached(cacheKey, Buffer.from(buffer), 86400);
          console.log(`💾 [CACHED] ${lowerPath.substring(lowerPath.length - 30)} (${(buffer.byteLength / 1024).toFixed(0)}KB)`);
        } catch (cacheError) {
          console.error(`❌ Cache error for ${lowerPath}:`, cacheError);
        }
      }

      return new NextResponse(buffer, { status: 200, headers });
    }

    // Fallback: stream directly
    if (upstream.body) {
      return new NextResponse(upstream.body as any, {
        status: upstream.status,
        headers,
      });
    }

    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, { status: upstream.status, headers });

  } catch (error: any) {
    console.error("❌ Proxy error:", error);
    
    if (error?.name === "AbortError") {
      return new NextResponse("Request timeout", { status: 504 });
    }

    return new NextResponse(error?.message || "Internal error", {
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
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}