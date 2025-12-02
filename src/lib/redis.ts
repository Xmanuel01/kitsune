// src/lib/redis.ts

const UPSTASH_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) {
      out[key] = value;
    }
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/**
 * Get the raw Redis configuration or instance if needed.
 * Throws an error if Upstash Redis is not configured.
 */
export function getRedis() {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    throw new Error('Upstash Redis is not configured (missing URL or Token)');
  }
  // Return the base URL and token for direct use or client initialization
  return {
    url: UPSTASH_REST_URL,
    token: UPSTASH_REST_TOKEN
  };
}

// Internal helper to perform fetch requests to Upstash with retry logic
async function upstashFetch(path: string, init?: RequestInit, attempt: number = 1): Promise<Response> {
  const { url, token } = getRedis();
  const fullUrl = url + path;
  try {
    const initHeaders = normalizeHeaders(init?.headers);
    let contentType: string | undefined;
    if (init?.body) {
      contentType = initHeaders['Content-Type'] || initHeaders['content-type'] || 'text/plain';
    }

    const res = await fetch(fullUrl, {
      method: init?.method || 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        // If sending a body and no explicit Content-Type, default to text/plain
        ...(init?.body ? { 'Content-Type': contentType } : {}),
        ...initHeaders
      },
      body: init?.body
    });
    if (!res.ok) {
      // Read error message (if any) for logging
      let errorMessage: string;
      try {
        const errText = await res.text();
        errorMessage = errText || res.statusText;
      } catch {
        errorMessage = res.statusText;
      }
      throw new Error(`Upstash request failed with status ${res.status}: ${errorMessage}`);
    }
    return res;
  } catch (err: any) {
    if (attempt < 3) {
      console.warn(`Redis fetch attempt ${attempt} failed: ${err.message}`);
      return upstashFetch(path, init, attempt + 1);
    } else {
      console.error(`Redis fetch failed after ${attempt} attempts: ${err.message}`);
      throw err;
    }
  }
}

/**
 * Retrieve a cached value by key (JSON-parsed if applicable).
 * Returns the stored value (object, array, number, boolean, or string) or null if not found.
 */
export async function getCached<T = any>(key: string): Promise<T | null> {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    // Caching not configured
    return null;
  }
  try {
    const res = await upstashFetch(`/get/${encodeURIComponent(key)}`);
    const data = await res.json();
    if ('result' in data) {
      const result = data.result;
      if (result === null || result === undefined) {
        return null;
      }
      if (typeof result === 'string') {
        // Attempt to parse JSON strings (for stored objects, numbers, booleans)
        try {
          return JSON.parse(result) as T;
        } catch {
          // Return as plain string if not JSON
          return result as unknown as T;
        }
      } else {
        // If result is already a number or boolean
        return result as T;
      }
    } else if ('error' in data) {
      console.warn(`Redis GET error for key "${key}": ${data.error}`);
      return null;
    }
    // Unexpected response structure
    return null;
  } catch (err) {
    console.error(`getCached failed for key "${key}":`, err);
    return null;
  }
}

/**
 * Retrieve a cached binary value by key (expects a base64-encoded string in cache).
 * Returns a Buffer or null if not found.
 */
export async function getCachedBuffer(key: string): Promise<Buffer | null> {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return null;
  }
  try {
    const res = await upstashFetch(`/get/${encodeURIComponent(key)}`);
    const data = await res.json();
    if ('result' in data) {
      const result = data.result;
      if (result === null || result === undefined) {
        return null;
      }
      if (typeof result === 'string') {
        try {
          // Decode base64 string back to a Buffer
          return Buffer.from(result, 'base64');
        } catch (decodeErr) {
          console.error(`Failed to decode base64 for key "${key}":`, decodeErr);
          return null;
        }
      } else {
        console.warn(`getCachedBuffer: Unexpected data type for key "${key}"`);
        return null;
      }
    } else if ('error' in data) {
      console.warn(`Redis GET error for key "${key}": ${data.error}`);
      return null;
    }
    return null;
  } catch (err) {
    console.error(`getCachedBuffer failed for key "${key}":`, err);
    return null;
  }
}

/**
 * Store a value in the cache under the given key.
 * - Automatically stringifies objects/numbers/booleans to JSON.
 * - Encodes Buffers and binary data to base64 strings.
 * - Accepts an optional TTL (expiration in seconds).
 */
export async function setCached(key: string, value: any, ttlSeconds?: number): Promise<void> {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    console.warn('Caching not configured; skipping setCached for key', key);
    return;
  }
  if (value === undefined) {
    console.warn(`setCached called with undefined for key "${key}" - skipping`);
    return;
  }
  let storeValue: string;
  if (value instanceof Buffer) {
    // Binary data (Node.js Buffer)
    storeValue = value.toString('base64');
  } else if (value instanceof Uint8Array && !(value instanceof Buffer)) {
    // Binary data (Uint8Array in edge environments)
    storeValue = Buffer.from(value).toString('base64');
  } else if (value instanceof ArrayBuffer) {
    storeValue = Buffer.from(value).toString('base64');
  } else {
    // For strings, numbers, booleans, objects: store as JSON string
    try {
      storeValue = JSON.stringify(value);
    } catch (serr) {
      console.error('Failed to serialize value for caching:', serr);
      return;
    }
  }
  // Build the Upstash REST API path for SET (with optional expiration)
  let path = `/set/${encodeURIComponent(key)}`;
  if (ttlSeconds && ttlSeconds > 0) {
    path += `?EX=${ttlSeconds}`;
  }
  try {
    const res = await upstashFetch(path, { method: 'POST', body: storeValue });
    const data = await res.json();
    if ('result' in data && data.result !== 'OK') {
      console.warn(`Unexpected Redis response for setCached("${key}"):`, data);
    }
  } catch (err) {
    console.error(`setCached failed for key "${key}":`, err);
  }
}

/**
 * Delete a cached value by key.
 */
export async function deleteCached(key: string): Promise<void> {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return;
  }
  try {
    await upstashFetch(`/del/${encodeURIComponent(key)}`);
    // (We could check the result count, but not necessary for a deletion attempt)
  } catch (err) {
    console.error(`deleteCached failed for key "${key}":`, err);
  }
}
