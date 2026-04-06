// src/app/api/m3u8/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseClient';

const DEFAULT_TIMEOUT_MS = 12000;
const CACHE_TABLE = 'm3u8_cache';
const PLAYLIST_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

type CacheRow = {
  cacheKey: string;
  content: string;
  isBinary: boolean;
  encoding?: string | null;
  fetchedAt?: string | null;
};

async function getCachedPlaylist(cacheKey: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .select('content, isBinary, encoding, fetchedAt')
      .eq('cacheKey', cacheKey)
      .maybeSingle();

    if (error) {
      console.warn('[M3U8_CACHE] read error', error.message || error);
      return null;
    }
    if (!data) return null;

    const ageMs = data.fetchedAt ? Date.now() - new Date(data.fetchedAt).getTime() : Infinity;
    if (ageMs > PLAYLIST_CACHE_TTL_MS) {
      return null;
    }
    return data.content;
  } catch (err) {
    console.warn('[M3U8_CACHE] failed to read', err);
    return null;
  }
}

async function setCachedPlaylist(cacheKey: string, content: string): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .upsert({
        cacheKey,
        content,
        isBinary: false,
        encoding: 'utf-8',
        fetchedAt: new Date().toISOString(),
      });
    if (error) {
      console.warn('[M3U8_CACHE] write error', error.message || error);
    }
  } catch (err) {
    console.warn('[M3U8_CACHE] failed to write', err);
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true;
  }
  // Block common private IPv4 ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [ , a, b, c, d ] = ipv4Match.map(Number);
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // Block common local domain names
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  // Block unique local and link-local IPv6 addresses
  if (host.startsWith('fc00') || host.startsWith('fd00') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Infer content type based on file extension (fallback if upstream doesn't send Content-Type).
 */
function inferContentType(ext: string | undefined): string {
  switch (ext) {
    case 'm3u8':
    case 'm3u':
      return 'application/vnd.apple.mpegurl';
    case 'mpd':
      return 'application/dash+xml';
    case 'ts':
      return 'video/mp2t';
    case 'm4s':
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
      return 'audio/mp4';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Rewrite all media URIs in an M3U8 playlist to proxy through this API.
 */
function rewritePlaylist(content: string, baseUrl: URL, referer?: string | null): string {
  const lines = content.split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Comment or empty line, leave unchanged
      return line;
    }
    try {
      // Resolve relative URIs against the playlist's base URL
      const absoluteUrl = new URL(trimmed, baseUrl);
      // Replace with proxied API URL (encoded original URL as query param)
      const refParam = referer ? `&ref=${encodeURIComponent(referer)}` : '';
      return `/api/m3u8?url=${encodeURIComponent(absoluteUrl.href)}${refParam}`;
    } catch {
      // If URL resolution fails (malformed URI), leave it unchanged
      return line;
    }
  }).join('\n');
}

// CORS preflight handler (OPTIONS request)
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrlParam = searchParams.get('url');
  const refParam = searchParams.get('ref');
  if (!targetUrlParam) {
    return NextResponse.json({ error: 'Missing "url" query parameter' }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlParam);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  // Basic SSRF protections: only allow http/https and block private/internal addresses
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Unsupported protocol' }, { status: 400 });
  }
  if (isBlockedHost(targetUrl.hostname)) {
    console.warn('Blocked SSRF attempt to host:', targetUrl.hostname);
    return NextResponse.json({ error: 'Forbidden host' }, { status: 403 });
  }

  const ext = targetUrl.pathname.split('.').pop()?.toLowerCase();
  const isPlaylist = ext === 'm3u8' || ext === 'm3u';
  const rangeHeader = request.headers.get('range');

  // Only enable caching in production when Supabase envs are present
  const cacheEnabled = process.env.NODE_ENV === 'production' && Boolean(supabaseAdmin);
  const cacheKey = refParam ? `${targetUrl.href}::ref=${refParam}` : targetUrl.href;

  // Avoid caching ranged/partial requests to prevent storing truncated blobs
  const allowCache = cacheEnabled && !rangeHeader;

  if (allowCache) {
    try {
      if (isPlaylist) {
        const cachedContent = await getCachedPlaylist(cacheKey);
        if (cachedContent !== null) {
          console.log(`Cache hit (playlist): ${cacheKey}`);
          return new NextResponse(cachedContent, {
            status: 200,
            headers: {
              'Content-Type': inferContentType(ext),
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-cache'
            }
          });
        }
      }
    } catch (err) {
      console.error('Cache lookup error, proceeding to fetch:', err);
    }
  }

  // If not cached, fetch the resource from the target URL
  let upstreamRes: Response;
  try {
    // keep fetches from stalling forever; players can retry quickly on timeout
    const timeoutMs = isPlaylist ? 8000 : 12000;
    // If a referer was passed, forward it (and origin if parsable)
    const forwardHeaders: Record<string, string> = {};
    if (refParam) {
      forwardHeaders['Referer'] = refParam;
      try {
        forwardHeaders['Origin'] = new URL(refParam).origin;
      } catch {
        // ignore invalid origin
      }
    }
    upstreamRes = await fetchWithTimeout(targetUrl.href, {
      method: 'GET',
      headers: {
        // Set a user agent and accept header for upstream request
        'User-Agent': 'Mozilla/5.0 (Node.js fetch)',
        'Accept': '*/*',
        ...(rangeHeader ? { Range: rangeHeader } : {}),
        ...forwardHeaders
      }
    }, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to fetch upstream URL:', err);
    const status = message.includes('timed out') ? 504 : 502;
    return NextResponse.json({ error: 'Failed to fetch the resource', details: message }, { status });
  }

  if (!upstreamRes.ok) {
    // Forward the upstream error status (without exposing full response body for safety)
    return NextResponse.json(
      { error: `Upstream error: ${upstreamRes.status} ${upstreamRes.statusText}` },
      { status: upstreamRes.status }
    );
  }

  const contentType = upstreamRes.headers.get('Content-Type') || inferContentType(ext);

  if (isPlaylist) {
    // Handle playlist files (.m3u8) as text
    let playlistText: string;
    try {
      playlistText = await upstreamRes.text();
    } catch (err) {
      console.error('Error reading playlist text:', err);
      return NextResponse.json({ error: 'Error reading upstream content' }, { status: 500 });
    }
    // Rewrite URLs in the playlist to proxy through this API
    const rewrittenPlaylist = rewritePlaylist(playlistText, targetUrl, refParam);
    if (allowCache) {
      // Cache the rewritten playlist content for future requests
      try {
        await setCachedPlaylist(cacheKey, rewrittenPlaylist);
      } catch (err) {
        console.error('Failed to cache playlist content:', err);
      }
    }
    return new NextResponse(rewrittenPlaylist, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    });
  } else {
    // Handle segment or other binary file
    const upstreamBody = upstreamRes.body;
    if (!upstreamBody) {
      return NextResponse.json({ error: 'No content in upstream response' }, { status: 500 });
    }
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    };

    // Forward range-related headers when present
    const upstreamRange = upstreamRes.headers.get('Content-Range');
    const upstreamAcceptRanges = upstreamRes.headers.get('Accept-Ranges');
    const upstreamLength = upstreamRes.headers.get('Content-Length');
    if (upstreamRange) responseHeaders['Content-Range'] = upstreamRange;
    if (upstreamAcceptRanges) responseHeaders['Accept-Ranges'] = upstreamAcceptRanges;
    if (upstreamLength) responseHeaders['Content-Length'] = upstreamLength;

    // Set caching headers only for full-body responses
    if (!rangeHeader) {
      responseHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    // Stream the upstream response directly to the client (segments not cached in Supabase)
    return new NextResponse(upstreamBody, {
      status: upstreamRes.status,
      headers: responseHeaders
    });
  }
}
