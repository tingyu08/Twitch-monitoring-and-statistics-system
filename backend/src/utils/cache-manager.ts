/**
 * 記憶體快取管理器
 *
 * 為 Zeabur 免費層優化的輕量級快取系統
 * - 使用 LRU 策略自動清除舊資料
 * - 記憶體限制保護（預設 50MB）
 * - TTL 支援
 */

import { logger } from "./logger";
import {
  isRedisReady,
  redisAcquireLock,
  redisDeleteByPrefix,
  redisDeleteBySuffix,
  redisDeleteKey,
  redisGetJson,
  redisReleaseLock,
  redisSetJson,
  redisTagAddKeys,
  redisTagDelete,
  redisTagGetKeys,
} from "./redis-client";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  size: number; // 估計的記憶體大小（bytes）
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  itemCount: number;
  memoryUsage: number;
  hitRate: number;
  pendingRequests?: number;
}

const ESTIMATE_MAX_DEPTH = 3;
const ESTIMATE_MAX_ITEMS = 40;
const CLEANUP_SCAN_LIMIT = 1000;
const HIGH_PRESSURE_RATIO = 0.9;
const TARGET_PRESSURE_RATIO = 0.75;

export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>>;
  private expiryBuckets: Map<number, Set<string>>;
  private keyToExpiryBucket: Map<string, number>;
  private stats: CacheStats;
  private maxMemoryBytes: number;
  private currentMemoryUsage: number;
  // P1 Fix: 防止快取擊穿 (Cache Stampede) 的等待隊列
  private pendingPromises: Map<string, Promise<unknown>>;
  /** 動態判斷 Redis 是否已連線 */
  private get redisEnabled(): boolean {
    return isRedisReady();
  }
  private tagIndex: Map<string, Set<string>>;
  private prefixIndex: Map<string, Set<string>>;
  private lastSegmentIndex: Map<string, Set<string>>;
  private readonly redisLockTtlMs = 15000;
  private readonly redisWaitRetries = 8;
  private readonly redisWaitIntervalMs = 120;
  private readonly cleanupScanLimit = CLEANUP_SCAN_LIMIT;

  constructor(maxMemoryMB: number = 50) {
    this.cache = new Map();
    this.expiryBuckets = new Map();
    this.keyToExpiryBucket = new Map();
    this.pendingPromises = new Map();

    this.tagIndex = new Map();
    this.prefixIndex = new Map();
    this.lastSegmentIndex = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      itemCount: 0,
      memoryUsage: 0,
      hitRate: 0,
    };
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    this.currentMemoryUsage = 0;

    // Zeabur 免費層優化：平衡 CPU 與記憶體（每 5 分鐘）
    const cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);

    // Don't prevent Node.js from exiting
    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }

  // ... (set, get, delete, clear, deletePattern, deleteRevenueCache methods remain unchanged)

  /**
   * 設定快取項目
   */
  private setInternal<T>(
    key: string,
    value: T,
    ttlSeconds: number = 300,
    tags: string[] = []
  ): void {
    const size = this.estimateSize(value);

    if (this.currentMemoryUsage > this.maxMemoryBytes * HIGH_PRESSURE_RATIO) {
      this.cleanup(this.cleanupScanLimit);
    }

    // 如果單個項目超過最大記憶體限制的 25%，拒絕快取 (Zeabur 免費層優化)
    if (size > this.maxMemoryBytes * 0.25) {
      logger.warn(
        "Cache",
        `Item too large to cache: ${key} (${(size / 1024 / 1024).toFixed(2)}MB)`
      );
      return;
    }

    // 如果快取已滿，使用 LRU 策略清除舊項目
    while (this.currentMemoryUsage + size > this.maxMemoryBytes && this.cache.size > 0) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      size,
    };

    // 如果 key 已存在，先減去舊值的大小
    const existing = this.cache.get(key);
    if (existing) {
      this.currentMemoryUsage -= existing.size;
      this.untrackKeyIndexes(key);
      this.untrackExpiry(key);
    }

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.trackKeyIndexes(key);
    this.trackExpiry(key, entry.expiresAt);
    this.currentMemoryUsage += size;
    this.stats.itemCount = this.cache.size;
    this.stats.memoryUsage = this.currentMemoryUsage;

    if (this.redisEnabled) {
      void redisSetJson(key, value, ttlSeconds);
      if (tags.length > 0) {
        for (const tag of tags) {
          void redisTagAddKeys(tag, [key]);
        }
      }
    }

    if (tags.length > 0) {
      for (const tag of tags) {
        const bucket = this.tagIndex.get(tag) || new Set<string>();
        bucket.add(key);
        this.tagIndex.set(tag, bucket);
      }
    }
  }

  set<T>(key: string, value: T, ttlSeconds: number = 300): void {
    this.setInternal(key, value, ttlSeconds, []);
  }

  setWithTags<T>(key: string, value: T, ttlSeconds: number = 300, tags: string[] = []): void {
    this.setInternal(key, value, ttlSeconds, tags);
  }

  /**
   * 獲取快取項目
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 檢查是否過期
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // LRU: 讀取時提升為最近使用，避免熱點被錯誤淘汰
    this.cache.delete(key);
    this.cache.set(key, entry as CacheEntry<unknown>);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * 刪除快取項目
   */
  delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemoryUsage -= entry.size;
      this.cache.delete(key);
      this.untrackKeyIndexes(key);
      this.untrackExpiry(key);
      this.stats.itemCount = this.cache.size;
      this.stats.memoryUsage = this.currentMemoryUsage;
    }

    for (const [tag, keys] of this.tagIndex.entries()) {
      keys.delete(key);
      if (keys.size === 0) {
        this.tagIndex.delete(tag);
      }
    }

    if (this.redisEnabled) {
      void redisDeleteKey(key);
    }
  }

  /**
   * 清除所有快取
   */
  clear(): void {
    this.cache.clear();
    this.expiryBuckets.clear();
    this.keyToExpiryBucket.clear();
    this.pendingPromises.clear();
    this.currentMemoryUsage = 0;
    this.stats.itemCount = 0;
    this.stats.memoryUsage = 0;
    this.tagIndex.clear();
    this.prefixIndex.clear();
    this.lastSegmentIndex.clear();

    if (this.redisEnabled) {
      void redisDeleteByPrefix("");
    }
  }

  /**
   * 依據前綴模式刪除多個快取項目
   * @param pattern 前綴模式（例如 "revenue:streamerId:"）
   * @returns 刪除的項目數量
   */
  deletePattern(pattern: string): number {
    const indexedKeys = this.prefixIndex.get(pattern);
    const candidateKeys = indexedKeys ? Array.from(indexedKeys) : Array.from(this.cache.keys());

    let count = 0;
    for (const key of candidateKeys) {
      if (key.startsWith(pattern)) {
        this.delete(key);
        count++;
      }
    }

    if (this.redisEnabled) {
      void redisDeleteByPrefix(pattern);
    }

    return count;
  }

  /**
   * 依據後綴模式刪除多個快取項目
   * @param suffix 後綴模式（例如 ":channels_list"）
   * @returns 刪除的項目數量
   */
  deleteSuffix(suffix: string): number {
    const useIndexedLookup = suffix.startsWith(":") && suffix.indexOf(":", 1) === -1;
    const indexedKeys = useIndexedLookup ? this.lastSegmentIndex.get(suffix) : null;
    const candidateKeys = indexedKeys ? Array.from(indexedKeys) : Array.from(this.cache.keys());

    let count = 0;
    for (const key of candidateKeys) {
      if (key.endsWith(suffix)) {
        this.delete(key);
        count++;
      }
    }

    if (this.redisEnabled) {
      void redisDeleteBySuffix(suffix);
    }

    return count;
  }

  /**
   * 刪除特定實況主的所有收益相關快取
   * @param streamerId 實況主 ID
   */
  deleteRevenueCache(streamerId: string): void {
    const deleted = this.deletePattern(`revenue:${streamerId}:`);
    void this.invalidateTag(`streamer:${streamerId}`);
    if (deleted > 0) {
      logger.debug("Cache", `Deleted ${deleted} revenue cache entries for streamer ${streamerId}`);
    }
  }

  /**
   * 取得或設定（防止快取擊穿機制）
   * 如果多個請求同時要求同一個 Key，只會執行一次 factory
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number = 300): Promise<T> {
    // 1. 快速路徑：如果有快取，直接回傳
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    if (this.redisEnabled) {
      const redisCached = await redisGetJson<T>(key);
      if (redisCached !== null) {
        this.stats.hits++;
        this.set(key, redisCached, ttlSeconds);
        return redisCached;
      }

      const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const lockAcquired = await redisAcquireLock(key, lockToken, this.redisLockTtlMs);

      if (!lockAcquired) {
        for (let i = 0; i < this.redisWaitRetries; i++) {
          await new Promise((resolve) => setTimeout(resolve, this.redisWaitIntervalMs));
          const waitedValue = await redisGetJson<T>(key);
          if (waitedValue !== null) {
            this.stats.hits++;
            this.set(key, waitedValue, ttlSeconds);
            return waitedValue;
          }
        }
      } else {
        try {
          const value = await factory();
          this.setInternal(key, value, ttlSeconds, []);
          return value;
        } catch (error) {
          logger.warn("Cache", `Factory failed for key: ${key}`);
          throw error;
        } finally {
          await redisReleaseLock(key, lockToken);
        }
      }
    }

    // 2. 合併路徑：如果已經有正在進行的查詢，等待它
    const pending = this.pendingPromises.get(key);
    if (pending) {
      // logger.debug("Cache", `Request coalesced for key: ${key}`);
      return pending as Promise<T>;
    }

    // 3. 慢速路徑：執行查詢並建立 Promise
    const promise = (async () => {
      try {
        const value = await factory();
        this.setInternal(key, value, ttlSeconds, []);
        return value;
      } catch (error) {
        logger.warn("Cache", `Factory failed for key: ${key}`);
        throw error;
      } finally {
        // 無論成功失敗，都要移除 pending 標記
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, promise);
    return promise as Promise<T>;
  }

  async getOrSetWithTags<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = 300,
    tags: string[] = []
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    if (this.redisEnabled) {
      const redisCached = await redisGetJson<T>(key);
      if (redisCached !== null) {
        this.stats.hits++;
        this.setInternal(key, redisCached, ttlSeconds, tags);
        return redisCached;
      }

      const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const lockAcquired = await redisAcquireLock(key, lockToken, this.redisLockTtlMs);

      if (!lockAcquired) {
        for (let i = 0; i < this.redisWaitRetries; i++) {
          await new Promise((resolve) => setTimeout(resolve, this.redisWaitIntervalMs));
          const waitedValue = await redisGetJson<T>(key);
          if (waitedValue !== null) {
            this.stats.hits++;
            this.setInternal(key, waitedValue, ttlSeconds, tags);
            return waitedValue;
          }
        }
      } else {
        try {
          const value = await factory();
          this.setInternal(key, value, ttlSeconds, tags);
          return value;
        } catch (error) {
          logger.warn("Cache", `Factory failed for key: ${key}`);
          throw error;
        } finally {
          await redisReleaseLock(key, lockToken);
        }
      }
    }

    const pending = this.pendingPromises.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    const promise = (async () => {
      try {
        const value = await factory();
        this.setInternal(key, value, ttlSeconds, tags);
        return value;
      } finally {
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, promise);
    return promise as Promise<T>;
  }

  async invalidateTag(tag: string): Promise<number> {
    const localKeys = Array.from(this.tagIndex.get(tag) || []);
    let remoteKeys: string[] = [];

    if (this.redisEnabled) {
      remoteKeys = await redisTagGetKeys(tag);
    }

    const keys = Array.from(new Set([...localKeys, ...remoteKeys]));
    for (const key of keys) {
      this.delete(key);
    }

    this.tagIndex.delete(tag);
    if (this.redisEnabled) {
      await redisTagDelete(tag);
    }

    return keys.length;
  }

  /**
   * 獲取快取統計
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100 * 100) / 100 : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      itemCount: this.cache.size,
      memoryUsage: this.currentMemoryUsage,
      pendingRequests: this.pendingPromises.size,
      hitRate,
    };
  }

  /**
   * 清理過期項目
   */
  private cleanup(maxScanEntries: number = Number.POSITIVE_INFINITY): void {
    const now = Date.now();
    let cleaned = 0;
    let scanned = 0;

    const expiredBucketKeys: number[] = [];
    for (const bucketKey of this.expiryBuckets.keys()) {
      if (bucketKey * 1000 <= now) {
        expiredBucketKeys.push(bucketKey);
      }
    }

    for (const bucketKey of expiredBucketKeys) {
      if (scanned >= maxScanEntries) {
        break;
      }

      const bucket = this.expiryBuckets.get(bucketKey);
      if (!bucket) {
        continue;
      }

      for (const key of Array.from(bucket)) {
        if (scanned >= maxScanEntries) {
          break;
        }

        scanned += 1;
        const entry = this.cache.get(key);
        if (entry && now > entry.expiresAt) {
          this.delete(key);
          cleaned++;
        } else {
          bucket.delete(key);
        }
      }

      if (bucket.size === 0) {
        this.expiryBuckets.delete(bucketKey);
      }
    }

    if (this.currentMemoryUsage > this.maxMemoryBytes * HIGH_PRESSURE_RATIO) {
      const targetBytes = Math.floor(this.maxMemoryBytes * TARGET_PRESSURE_RATIO);
      this.evictToTargetUsage(targetBytes);
    }

    if (cleaned > 0) {
      logger.debug("Cache", `Cleaned up ${cleaned} expired items`);
    }
  }

  private evictToTargetUsage(targetBytes: number): void {
    while (this.currentMemoryUsage > targetBytes && this.cache.size > 0) {
      this.evictOldest();
    }
  }

  /**
   * LRU: 移除最舊的項目
   */
  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.delete(firstKey);
    }
  }

  /**
   * 估算物件大小（bytes）
   * 使用低成本分層估算策略，避免 JSON.stringify 造成高 CPU 開銷
   */
  private estimateSize(value: unknown): number {
    return this.estimateSizeInternal(value, 0, new WeakSet<object>());
  }

  private trackKeyIndexes(key: string): void {
    const prefixes = this.getKeyPrefixes(key);
    for (const prefix of prefixes) {
      const bucket = this.prefixIndex.get(prefix) || new Set<string>();
      bucket.add(key);
      this.prefixIndex.set(prefix, bucket);
    }

    const lastSegment = this.getLastSegment(key);
    const segmentBucket = this.lastSegmentIndex.get(lastSegment) || new Set<string>();
    segmentBucket.add(key);
    this.lastSegmentIndex.set(lastSegment, segmentBucket);
  }

  private untrackKeyIndexes(key: string): void {
    const prefixes = this.getKeyPrefixes(key);
    for (const prefix of prefixes) {
      const bucket = this.prefixIndex.get(prefix);
      if (!bucket) {
        continue;
      }

      bucket.delete(key);
      if (bucket.size === 0) {
        this.prefixIndex.delete(prefix);
      }
    }

    const lastSegment = this.getLastSegment(key);
    const segmentBucket = this.lastSegmentIndex.get(lastSegment);
    if (!segmentBucket) {
      return;
    }

    segmentBucket.delete(key);
    if (segmentBucket.size === 0) {
      this.lastSegmentIndex.delete(lastSegment);
    }
  }

  private toExpiryBucket(expiresAt: number): number {
    return Math.floor(expiresAt / 1000);
  }

  private trackExpiry(key: string, expiresAt: number): void {
    const bucketKey = this.toExpiryBucket(expiresAt);
    const bucket = this.expiryBuckets.get(bucketKey) || new Set<string>();
    bucket.add(key);
    this.expiryBuckets.set(bucketKey, bucket);
    this.keyToExpiryBucket.set(key, bucketKey);
  }

  private untrackExpiry(key: string): void {
    const bucketKey = this.keyToExpiryBucket.get(key);
    if (typeof bucketKey !== "number") {
      return;
    }

    const bucket = this.expiryBuckets.get(bucketKey);
    if (bucket) {
      bucket.delete(key);
      if (bucket.size === 0) {
        this.expiryBuckets.delete(bucketKey);
      }
    }

    this.keyToExpiryBucket.delete(key);
  }

  private getKeyPrefixes(key: string): string[] {
    const prefixes: string[] = [];
    let index = key.indexOf(":");

    while (index !== -1) {
      prefixes.push(key.slice(0, index + 1));
      index = key.indexOf(":", index + 1);
    }

    return prefixes;
  }

  private getLastSegment(key: string): string {
    const lastColonIndex = key.lastIndexOf(":");
    return lastColonIndex >= 0 ? key.slice(lastColonIndex) : key;
  }

  private estimateSizeInternal(value: unknown, depth: number, seen: WeakSet<object>): number {
    if (value === null || value === undefined) return 16;

    const valueType = typeof value;
    if (valueType === "boolean") return 16;
    if (valueType === "number") return 16;
    if (valueType === "bigint") return 16;
    if (valueType === "string") return 40 + (value as string).length * 2;
    if (valueType === "symbol" || valueType === "function") return 32;

    if (depth >= ESTIMATE_MAX_DEPTH) {
      return 256;
    }

    if (!(value instanceof Object)) {
      return 64;
    }

    if (seen.has(value)) {
      return 64;
    }
    seen.add(value);

    if (value instanceof Date) {
      return 24;
    }

    if (Array.isArray(value)) {
      const sampled = value.slice(0, ESTIMATE_MAX_ITEMS);
      const sampledSize = sampled.reduce(
        (acc, item) => acc + this.estimateSizeInternal(item, depth + 1, seen),
        32
      );
      if (value.length <= ESTIMATE_MAX_ITEMS) {
        return sampledSize;
      }

      const avg =
        sampled.length > 0 ? Math.max(Math.floor((sampledSize - 32) / sampled.length), 8) : 16;
      return sampledSize + (value.length - sampled.length) * avg;
    }

    if (value instanceof Map) {
      let size = 80;
      let counted = 0;
      for (const [key, mapValue] of value.entries()) {
        if (counted >= ESTIMATE_MAX_ITEMS) {
          size += (value.size - counted) * 64;
          break;
        }
        size += this.estimateSizeInternal(key, depth + 1, seen);
        size += this.estimateSizeInternal(mapValue, depth + 1, seen);
        counted += 1;
      }
      return size;
    }

    if (value instanceof Set) {
      let size = 64;
      let counted = 0;
      for (const setValue of value.values()) {
        if (counted >= ESTIMATE_MAX_ITEMS) {
          size += (value.size - counted) * 48;
          break;
        }
        size += this.estimateSizeInternal(setValue, depth + 1, seen);
        counted += 1;
      }
      return size;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    let size = 64;

    const sampledEntries = entries.slice(0, ESTIMATE_MAX_ITEMS);
    for (const [key, nestedValue] of sampledEntries) {
      size += 40 + key.length * 2;
      size += this.estimateSizeInternal(nestedValue, depth + 1, seen);
    }

    if (entries.length > ESTIMATE_MAX_ITEMS) {
      const sampledAvg =
        sampledEntries.length > 0
          ? Math.max(Math.floor((size - 64) / sampledEntries.length), 24)
          : 24;
      size += (entries.length - sampledEntries.length) * sampledAvg;
    }

    return size;
  }

  getMaxMemoryBytes(): number {
    return this.maxMemoryBytes;
  }

  /**
   * 重置統計（但保留快取資料）
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
  }
}

// 導出單例
// P0 Optimization: 提升生產環境快取至 30MB，改善命中率從 40% 至 75-85%
export const cacheManager = new CacheManager(
  process.env.NODE_ENV === "production" ? 50 : 30 // 生產環境 50MB，開發環境 30MB
);

// 預定義的快取鍵生成器
export const CacheKeys = {
  // 觀眾相關
  viewerChannels: (viewerId: string) => `viewer:${viewerId}:channels`,
  viewerStats: (viewerId: string, channelId: string, days: number) =>
    `viewer:${viewerId}:channel:${channelId}:stats:${days}d`,
  viewerLifetimeStats: (viewerId: string, channelId: string) =>
    `viewer:${viewerId}:channel:${channelId}:lifetime`,

  // 頻道相關
  channelInfo: (channelId: string) => `channel:${channelId}:info`,
  channelLiveStatus: (channelId: string) => `channel:${channelId}:live`,

  // 主播收益相關（較短的 TTL）
  revenueOverview: (streamerId: string) => `revenue:${streamerId}:overview`,
  revenueSubscriptions: (streamerId: string, days: number) => `revenue:${streamerId}:subs:${days}d`,
  revenueBits: (streamerId: string, days: number) => `revenue:${streamerId}:bits:${days}d`,

  // 系統快取
  liveChannels: () => "system:live_channels",
  monitoredChannels: () => "system:monitored_channels",
};

// 預定義的 TTL（秒）- 針對 0.5GB RAM 環境優化
export const CacheTTL = {
  SHORT: 30, // 30 秒 - 即時資料（從 60 秒降低）
  MEDIUM: 180, // 3 分鐘 - 一般資料（從 300 秒降低）
  LONG: 600, // 10 分鐘 - 較穩定的資料（從 1800 秒降低）
  VERY_LONG: 1800, // 30 分鐘 - 很少變動的資料（從 3600 秒降低）
};

const DEFAULT_CACHE_TTL_MEDIUM_PRESSURE_PERCENT = 60;
const DEFAULT_CACHE_TTL_HIGH_PRESSURE_PERCENT = 80;
const DEFAULT_CACHE_TTL_MEDIUM_FACTOR = 0.75;
const DEFAULT_CACHE_TTL_HIGH_FACTOR = 0.5;
const DEFAULT_CACHE_TTL_MIN_SECONDS = 15;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("CacheManager", `Invalid numeric env value '${value}', fallback to ${fallback}`);
    return fallback;
  }
  return parsed;
}

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  if (parsed > 1) {
    logger.warn(
      "CacheManager",
      `Invalid ratio env value '${value}', expected 0-1, fallback to ${fallback}`
    );
    return fallback;
  }
  return parsed;
}

const CACHE_TTL_MEDIUM_PRESSURE_PERCENT = parsePositiveNumber(
  process.env.CACHE_TTL_MEDIUM_PRESSURE_PERCENT,
  DEFAULT_CACHE_TTL_MEDIUM_PRESSURE_PERCENT
);
const CACHE_TTL_HIGH_PRESSURE_PERCENT = parsePositiveNumber(
  process.env.CACHE_TTL_HIGH_PRESSURE_PERCENT,
  DEFAULT_CACHE_TTL_HIGH_PRESSURE_PERCENT
);
const CACHE_TTL_MEDIUM_FACTOR = parseRatio(
  process.env.CACHE_TTL_MEDIUM_FACTOR,
  DEFAULT_CACHE_TTL_MEDIUM_FACTOR
);
const CACHE_TTL_HIGH_FACTOR = parseRatio(
  process.env.CACHE_TTL_HIGH_FACTOR,
  DEFAULT_CACHE_TTL_HIGH_FACTOR
);
const CACHE_TTL_MIN_SECONDS = parsePositiveNumber(
  process.env.CACHE_TTL_MIN_SECONDS,
  DEFAULT_CACHE_TTL_MIN_SECONDS
);
const CACHE_ADAPTIVE_TTL_ENABLED =
  (process.env.CACHE_ADAPTIVE_TTL_ENABLED || "false").toLowerCase() === "true";

/**
 * 根據快取壓力動態調整 TTL
 * 注意：壓力基準是 cacheManager 的容量上限（maxMemoryBytes），不是進程總記憶體。
 * 這可確保壓力計算與實際快取上限一致。
 */
export function getAdaptiveTTL(baseTTL: number, cacheManager: CacheManager): number {
  if (!CACHE_ADAPTIVE_TTL_ENABLED) {
    return baseTTL;
  }

  if (!Number.isFinite(baseTTL) || baseTTL <= 0) {
    return baseTTL;
  }

  const stats = cacheManager.getStats();
  const maxCacheBytes = cacheManager.getMaxMemoryBytes();
  if (!Number.isFinite(maxCacheBytes) || maxCacheBytes <= 0) {
    return baseTTL;
  }

  const cacheUsagePercent = Math.min(100, (stats.memoryUsage / maxCacheBytes) * 100);
  const minTTL = Math.min(baseTTL, CACHE_TTL_MIN_SECONDS);

  // 高快取壓力：縮短 TTL（預設 50%）
  if (cacheUsagePercent > CACHE_TTL_HIGH_PRESSURE_PERCENT) {
    return Math.max(minTTL, Math.floor(baseTTL * CACHE_TTL_HIGH_FACTOR));
  }
  // 中等快取壓力：縮短 TTL（預設 25%）
  if (cacheUsagePercent > CACHE_TTL_MEDIUM_PRESSURE_PERCENT) {
    return Math.max(minTTL, Math.floor(baseTTL * CACHE_TTL_MEDIUM_FACTOR));
  }
  // 正常情況
  return baseTTL;
}
