import Redis, { type RedisOptions } from "ioredis";
import { logger } from "./logger";

const CACHE_PREFIX = "bmad:cache:";
const TAG_PREFIX = "bmad:cache-tag:";

let redisClient: Redis | null = null;
let redisFailureCount = 0;
let redisDisabledUntil = 0;

const REDIS_FAILURE_THRESHOLD = Number(process.env.REDIS_FAILURE_THRESHOLD || 5);
const REDIS_CIRCUIT_BREAKER_MS = Number(process.env.REDIS_CIRCUIT_BREAKER_MS || 30000);

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

function isRedisCircuitOpen(): boolean {
  return redisDisabledUntil > Date.now();
}

function markRedisSuccess(): void {
  redisFailureCount = 0;
  redisDisabledUntil = 0;
}

function markRedisFailure(): void {
  redisFailureCount += 1;
  if (redisFailureCount >= REDIS_FAILURE_THRESHOLD) {
    redisDisabledUntil = Date.now() + REDIS_CIRCUIT_BREAKER_MS;
    logger.warn(
      "Redis",
      `Circuit breaker opened for ${REDIS_CIRCUIT_BREAKER_MS}ms after ${redisFailureCount} failures`
    );
    redisFailureCount = 0;
  }
}

function getHealthyRedisClient(): Redis | null {
  if (isRedisCircuitOpen()) {
    return null;
  }

  const client = getRedisClient();
  if (!client) return null;
  return client;
}

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const client = getHealthyRedisClient();
  if (!client) return null;

  try {
    const data = await client.get(cacheKey(key));
    markRedisSuccess();
    return data ? (JSON.parse(data) as T) : null;
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis get failed for key=${key}`, error);
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = getHealthyRedisClient();
  if (!client) return;

  try {
    await client.set(cacheKey(key), JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis set failed for key=${key}`, error);
  }
}

export async function redisDeleteKey(key: string): Promise<void> {
  const client = getHealthyRedisClient();
  if (!client) return;

  try {
    await client.del(cacheKey(key));
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis del failed for key=${key}`, error);
  }
}

async function scanDelete(pattern: string): Promise<number> {
  const client = getHealthyRedisClient();
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
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
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

function tagKey(tag: string): string {
  return `${TAG_PREFIX}${tag}`;
}

export async function redisTagAddKeys(tag: string, keys: string[]): Promise<void> {
  const client = getHealthyRedisClient();
  if (!client || keys.length === 0) return;

  try {
    await client.sadd(tagKey(tag), ...keys.map((key) => cacheKey(key)));
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis sadd failed for tag=${tag}`, error);
  }
}

export async function redisTagGetKeys(tag: string): Promise<string[]> {
  const client = getHealthyRedisClient();
  if (!client) return [];

  try {
    const values = await client.smembers(tagKey(tag));
    markRedisSuccess();
    return values.map((value) => value.replace(CACHE_PREFIX, ""));
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis smembers failed for tag=${tag}`, error);
    return [];
  }
}

export async function redisTagDelete(tag: string): Promise<void> {
  const client = getHealthyRedisClient();
  if (!client) return;

  try {
    await client.del(tagKey(tag));
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis tag delete failed for tag=${tag}`, error);
  }
}

function lockKey(key: string): string {
  return `${CACHE_PREFIX}lock:${key}`;
}

export async function redisAcquireLock(
  key: string,
  token: string,
  ttlMs: number
): Promise<boolean> {
  const client = getHealthyRedisClient();
  if (!client) return false;

  try {
    const result = await client.set(lockKey(key), token, "PX", Math.max(1, ttlMs), "NX");
    markRedisSuccess();
    return result === "OK";
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis lock acquire failed key=${key}`, error);
    return false;
  }
}

export async function redisReleaseLock(key: string, token: string): Promise<void> {
  const client = getHealthyRedisClient();
  if (!client) return;

  try {
    const script =
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    await client.eval(script, 1, lockKey(key), token);
    markRedisSuccess();
  } catch (error) {
    markRedisFailure();
    logger.warn("Redis", `Redis lock release failed key=${key}`, error);
  }
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
