import Redis, { type RedisOptions } from "ioredis";
import { logger } from "./logger";

const CACHE_PREFIX = "bmad:cache:";
const TAG_PREFIX = "bmad:cache-tag:";

let redisClient: Redis | null = null;
let redisFailureCount = 0;
let redisDisabledUntil = 0;
let redisCircuitOpenedCount = 0;
let redisLastFailureReason: string | null = null;
let redisCircuitState: "closed" | "open" | "half-open" = "closed";
let redisHalfOpenProbeInFlight = false;

const REDIS_FAILURE_THRESHOLD = Number(process.env.REDIS_FAILURE_THRESHOLD || 5);
const REDIS_CIRCUIT_BREAKER_MS = Number(process.env.REDIS_CIRCUIT_BREAKER_MS || 30000);

function getRedisUrl(): string | null {
  // 支援多種環境變數名稱（Zeabur 自動產生 REDIS_URI / REDIS_CONNECTION_STRING）
  const url = (
    process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    process.env.REDIS_CONNECTION_STRING
  )?.trim();
  return url && url.length > 0 ? url : null;
}

let redisReady = false;
let redisInitPromise: Promise<void> | null = null;

export function isRedisEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export function isRedisReady(): boolean {
  return redisReady;
}

export function getRedisClient(): Redis | null {
  if (!redisReady || !redisClient) {
    return null;
  }
  return redisClient;
}

/**
 * 初始化 Redis 連線（嘗試連線，失敗時 graceful fallback）
 * 呼叫多次是安全的，只會初始化一次
 */
export async function initRedis(): Promise<boolean> {
  if (redisReady) return true;
  if (redisInitPromise) {
    await redisInitPromise;
    return redisReady;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) return false;

  redisInitPromise = (async () => {
    try {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true, // 不自動連線，等手動 connect()
        retryStrategy: () => null, // 連不上就放棄，不無限重試
      });

      client.on("error", (error: unknown) => {
        logger.warn("Redis", "Redis client error", error);
      });

      await client.connect();
      redisClient = client;
      redisReady = true;
      logger.info("Redis", "Redis connected");
    } catch (error) {
      logger.warn("Redis", "Redis 無法連線，將使用 In-Memory 模式", error);
      redisClient = null;
      redisReady = false;
    }
  })();

  await redisInitPromise;
  return redisReady;
}

function isRedisCircuitOpen(): boolean {
  return redisCircuitState === "open" && redisDisabledUntil > Date.now();
}

function markRedisSuccess(): void {
  redisFailureCount = 0;
  redisDisabledUntil = 0;
  redisCircuitState = "closed";
  redisHalfOpenProbeInFlight = false;
}

function markRedisFailure(): void {
  if (redisCircuitState === "half-open") {
    redisDisabledUntil = Date.now() + REDIS_CIRCUIT_BREAKER_MS;
    redisCircuitOpenedCount += 1;
    redisCircuitState = "open";
    redisHalfOpenProbeInFlight = false;
    redisFailureCount = 0;
    logger.warn("Redis", `Half-open probe failed, reopen circuit for ${REDIS_CIRCUIT_BREAKER_MS}ms`);
    return;
  }

  redisFailureCount += 1;
  if (redisFailureCount >= REDIS_FAILURE_THRESHOLD) {
    redisDisabledUntil = Date.now() + REDIS_CIRCUIT_BREAKER_MS;
    redisCircuitOpenedCount += 1;
    redisCircuitState = "open";
    redisHalfOpenProbeInFlight = false;
    logger.warn(
      "Redis",
      `Circuit breaker opened for ${REDIS_CIRCUIT_BREAKER_MS}ms after ${redisFailureCount} failures`
    );
    redisFailureCount = 0;
  }
}

function getHealthyRedisClient(): Redis | null {
  const now = Date.now();

  if (redisCircuitState === "open") {
    if (redisDisabledUntil > now) {
      return null;
    }

    redisCircuitState = "half-open";
    redisHalfOpenProbeInFlight = false;
  }

  if (redisCircuitState === "half-open") {
    if (redisHalfOpenProbeInFlight) {
      return null;
    }
    redisHalfOpenProbeInFlight = true;
  }

  const client = getRedisClient();
  if (!client) {
    redisHalfOpenProbeInFlight = false;
    return null;
  }
  return client;
}

export function getRedisCircuitBreakerStats() {
  const now = Date.now();
  return {
    enabled: isRedisEnabled(),
    open: isRedisCircuitOpen(),
    state: redisCircuitState,
    openUntil: redisDisabledUntil > now ? new Date(redisDisabledUntil).toISOString() : null,
    remainingOpenMs: Math.max(0, redisDisabledUntil - now),
    openedCount: redisCircuitOpenedCount,
    lastFailureReason: redisLastFailureReason,
    failureThreshold: REDIS_FAILURE_THRESHOLD,
    breakerWindowMs: REDIS_CIRCUIT_BREAKER_MS,
  };
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
    markRedisFailure();
    logger.warn("Redis", `Redis del failed for key=${key}`, error);
  }
}

export async function redisDeleteKeys(keys: string[]): Promise<number> {
  const client = getHealthyRedisClient();
  if (!client || keys.length === 0) return 0;

  try {
    const cacheKeys = keys.map((key) => cacheKey(key));
    const deleted = await client.del(...cacheKeys);
    markRedisSuccess();
    return deleted;
  } catch (error) {
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
    markRedisFailure();
    logger.warn("Redis", `Redis del batch failed for ${keys.length} keys`, error);
    return 0;
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
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
    redisLastFailureReason = error instanceof Error ? error.message : String(error);
    markRedisFailure();
    logger.warn("Redis", `Redis lock release failed key=${key}`, error);
  }
}

export function getBullMQConnectionOptions(): RedisOptions | null {
  if (!redisReady) return null;

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
