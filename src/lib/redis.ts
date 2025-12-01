// lib/redis.ts
// Using Upstash REST API - more reliable for serverless
import { Redis } from '@upstash/redis';

let redisInstance: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisInstance) {
    return redisInstance;
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('⚠️ Upstash REST credentials not configured - caching disabled');
    return null;
  }

  try {
    redisInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      // Add retry and timeout settings
      retry: {
        retries: 3,
        backoff: (retryCount) => Math.min(retryCount * 100, 3000),
      },
    });

    console.log('✅ Upstash REST Redis initialized');
    return redisInstance;
  } catch (error) {
    console.error('❌ Failed to initialize Upstash Redis:', error);
    return null;
  }
}

export const redis = getRedisClient();

// Helper functions with improved error handling
export async function getCached(key: string): Promise<string | null> {
  if (!redis) return null;
  
  try {
    const data = await redis.get<string>(key);
    return data;
  } catch (error: any) {
    // Silent fail for cache misses
    return null;
  }
}

export async function getCachedBuffer(key: string): Promise<Buffer | null> {
  if (!redis) return null;
  
  try {
    // Upstash stores as string, retrieve and convert
    const data = await redis.get<string>(key);
    if (!data) return null;
    
    // Data is stored as base64
    return Buffer.from(data, 'base64');
  } catch (error: any) {
    return null;
  }
}

export async function setCached(
  key: string,
  value: string | Buffer,
  ttl: number
): Promise<boolean> {
  if (!redis) return false;
  
  try {
    // Convert Buffer to base64 string for storage
    const dataToStore = Buffer.isBuffer(value) 
      ? value.toString('base64') 
      : value;
    
    // Use SET with EX (seconds) option
    await redis.set(key, dataToStore, { ex: ttl });
    return true;
  } catch (error: any) {
    console.error(`Redis SET error (${key.substring(0, 30)}):`, error.message);
    return false;
  }
}

export async function deleteCached(key: string): Promise<boolean> {
  if (!redis) return false;
  
  try {
    await redis.del(key);
    return true;
  } catch (error: any) {
    return false;
  }
}

// Get Redis instance (for compatibility)
export const getRedis = () => redis;