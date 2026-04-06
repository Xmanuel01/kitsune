import { getCached, setCached } from "@/lib/redis";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

declare global {
  // eslint-disable-next-line no-var
  var __kitsuneHotCache: Map<string, CacheEntry<unknown>> | undefined;
}

const memoryCache =
  globalThis.__kitsuneHotCache ?? (globalThis.__kitsuneHotCache = new Map());

export type CacheOptions = {
  key: string;
  ttlSeconds: number;
  memoryOnly?: boolean;
};

function getMemoryEntry<T>(key: string) {
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value;
}

function setMemoryEntry<T>(key: string, value: T, ttlSeconds: number) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function getCachedValue<T>({
  key,
  memoryOnly = false,
}: Pick<CacheOptions, "key" | "memoryOnly">) {
  const inMemory = getMemoryEntry<T>(key);
  if (inMemory !== null) {
    return inMemory;
  }

  if (memoryOnly) {
    return null;
  }

  const distributed = await getCached<T>(key);
  if (distributed !== null) {
    setMemoryEntry(key, distributed, 30);
  }
  return distributed;
}

export async function setCachedValue<T>({
  key,
  ttlSeconds,
  memoryOnly = false,
}: CacheOptions, value: T) {
  setMemoryEntry(key, value, ttlSeconds);

  if (!memoryOnly) {
    await setCached(key, value, ttlSeconds);
  }
}

export async function readThroughCache<T>(
  options: CacheOptions,
  loader: () => Promise<T>,
) {
  const cached = await getCachedValue<T>(options);
  if (cached !== null) {
    return cached;
  }

  const value = await loader();
  await setCachedValue(options, value);
  return value;
}
