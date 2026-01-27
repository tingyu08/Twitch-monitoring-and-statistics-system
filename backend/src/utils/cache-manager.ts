/**
 * 記憶體快取管理器
 *
 * 為 Render Free Tier 優化的輕量級快取系統
 * - 使用 LRU 策略自動清除舊資料
 * - 記憶體限制保護（預設 50MB）
 * - TTL 支援
 */

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
}

export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>>;
  private stats: CacheStats;
  private maxMemoryBytes: number;
  private currentMemoryUsage: number;

  constructor(maxMemoryMB: number = 50) {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      itemCount: 0,
      memoryUsage: 0,
    };
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
    this.currentMemoryUsage = 0;

    // 定期清理過期項目（每 5 分鐘）
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * 設定快取項目
   */
  set<T>(key: string, value: T, ttlSeconds: number = 300): void {
    const size = this.estimateSize(value);

    // 如果單個項目超過最大記憶體限制的 50%，拒絕快取
    if (size > this.maxMemoryBytes * 0.5) {
      console.warn(`[Cache] Item too large to cache: ${key} (${(size / 1024 / 1024).toFixed(2)}MB)`);
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
    }

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.currentMemoryUsage += size;
    this.stats.itemCount = this.cache.size;
    this.stats.memoryUsage = this.currentMemoryUsage;
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
      this.stats.itemCount = this.cache.size;
      this.stats.memoryUsage = this.currentMemoryUsage;
    }
  }

  /**
   * 清除所有快取
   */
  clear(): void {
    this.cache.clear();
    this.currentMemoryUsage = 0;
    this.stats.itemCount = 0;
    this.stats.memoryUsage = 0;
  }

  /**
   * 取得或設定（如果不存在則執行 factory 函數）
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * 獲取快取統計
   */
  getStats(): CacheStats {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      itemCount: this.cache.size,
      memoryUsage: this.currentMemoryUsage,
      ...({ hitRate: Math.round(hitRate * 100) / 100 } as Record<string, unknown>),
    } as CacheStats;
  }

  /**
   * 清理過期項目
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired items`);
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
   */
  private estimateSize(value: unknown): number {
    // 簡化的大小估算
    const json = JSON.stringify(value);
    return json.length * 2; // UTF-16 characters = 2 bytes each
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
export const cacheManager = new CacheManager(
  process.env.NODE_ENV === "production" ? 30 : 50 // 生產環境限制 30MB
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
  revenueSubscriptions: (streamerId: string, days: number) =>
    `revenue:${streamerId}:subs:${days}d`,
  revenueBits: (streamerId: string, days: number) =>
    `revenue:${streamerId}:bits:${days}d`,

  // 系統快取
  liveChannels: () => "system:live_channels",
  monitoredChannels: () => "system:monitored_channels",
};

// 預定義的 TTL（秒）
export const CacheTTL = {
  SHORT: 60,           // 1 分鐘 - 即時資料
  MEDIUM: 300,         // 5 分鐘 - 一般資料
  LONG: 1800,          // 30 分鐘 - 較穩定的資料
  VERY_LONG: 3600,     // 1 小時 - 很少變動的資料
};
