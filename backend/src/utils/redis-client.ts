import Redis, { type RedisOptions } from "ioredis";
import { logger } from "./logger";

const CACHE_PREFIX = "bmad:cache:";

let redisClient: Redis | null = null;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isRedisEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export function getRedisClient(): Redis | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redisClient.on("error", (error: unknown) => {
    logger.warn("Redis", "Redis client error", error);
  });

  redisClient
    .connect()
    .then(() => logger.info("Redis", "Redis connected"))
    .catch((error: unknown) => logger.warn("Redis", "Redis connect failed", error));

  return redisClient;
}

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const data = await client.get(cacheKey(key));
    return data ? (JSON.parse(data) as T) : null;
  } catch (error) {
    logger.warn("Redis", `Redis get failed for key=${key}`, error);
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.set(cacheKey(key), JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
  } catch (error) {
    logger.warn("Redis", `Redis set failed for key=${key}`, error);
  }
}

export async function redisDeleteKey(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  try {
    await client.del(cacheKey(key));
  } catch (error) {
    logger.warn("Redis", `Redis del failed for key=${key}`, error);
  }
}

async function scanDelete(pattern: string): Promise<number> {
  const client = getRedisClient();
  if (!client) return 0;

  let cursor = "0";
  let deleted = 0;

  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    logger.warn("Redis", `Redis scan delete failed pattern=${pattern}`, error);
  }

  return deleted;
}

export async function redisDeleteByPrefix(prefix: string): Promise<number> {
  return scanDelete(`${CACHE_PREFIX}${prefix}*`);
}

export async function redisDeleteBySuffix(suffix: string): Promise<number> {
  return scanDelete(`${CACHE_PREFIX}*${suffix}`);
}

export function getBullMQConnectionOptions(): RedisOptions | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  } catch {
    logger.warn("Redis", "Invalid REDIS_URL for BullMQ, fallback to memory queue");
    return null;
  }
}
