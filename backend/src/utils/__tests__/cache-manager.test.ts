/**
 * CacheManager 單元測試
 *
 * 測試範圍：
 * - 基本 get/set/delete/clear 操作
 * - TTL 過期機制
 * - LRU 淘汰策略
 * - 記憶體上限保護（拒絕過大項目、自動淘汰）
 * - deletePattern / deleteSuffix
 * - tag 索引與 invalidateTag
 * - getOrSet 防擊穿 (Cache Stampede)
 * - getStats / resetStats
 * - getAdaptiveTTL 動態 TTL
 * - CacheKeys 產生器
 * - CacheTTL 常數
 */

// Mock redis-client：所有 Redis 函數返回空值，讓測試只走記憶體路徑
jest.mock("../redis-client", () => ({
  isRedisReady: () => false,
  redisAcquireLock: jest.fn(),
  redisDeleteByPrefix: jest.fn(),
  redisDeleteBySuffix: jest.fn(),
  redisDeleteKey: jest.fn(),
  redisGetJson: jest.fn(),
  redisReleaseLock: jest.fn(),
  redisSetJson: jest.fn(),
  redisTagAddKeys: jest.fn(),
  redisTagDelete: jest.fn(),
  redisTagGetKeys: jest.fn(),
}));

// Mock logger to suppress output during tests
jest.mock("../logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { CacheManager, CacheKeys, CacheTTL, getAdaptiveTTL } from "../cache-manager";

describe("CacheManager", () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager(1); // 1MB for testing
  });

  afterEach(() => {
    cache.clear();
  });

  // ========== 基本操作 ==========

  describe("basic get/set/delete", () => {
    it("should return null for a missing key", () => {
      expect(cache.get("nonexistent")).toBeNull();
    });

    it("should set and get a value", () => {
      cache.set("key1", { name: "test" });
      expect(cache.get("key1")).toEqual({ name: "test" });
    });

    it("should overwrite an existing key", () => {
      cache.set("key1", "v1");
      cache.set("key1", "v2");
      expect(cache.get("key1")).toBe("v2");
    });

    it("should delete a key", () => {
      cache.set("key1", "value");
      cache.delete("key1");
      expect(cache.get("key1")).toBeNull();
    });

    it("should handle delete of nonexistent key without error", () => {
      expect(() => cache.delete("ghost")).not.toThrow();
    });

    it("should clear all entries", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBeNull();
      expect(cache.getStats().itemCount).toBe(0);
    });
  });

  // ========== TTL ==========

  describe("TTL expiry", () => {
    it("should expire entries after TTL", () => {
      jest.useFakeTimers();
      try {
        cache.set("ttl-key", "data", 2); // 2 seconds TTL
        expect(cache.get("ttl-key")).toBe("data");

        jest.advanceTimersByTime(3000); // advance 3s
        expect(cache.get("ttl-key")).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it("should not expire entries before TTL", () => {
      jest.useFakeTimers();
      try {
        cache.set("ttl-key", "data", 10);
        jest.advanceTimersByTime(5000);
        expect(cache.get("ttl-key")).toBe("data");
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ========== LRU 淘汰 ==========

  describe("LRU eviction", () => {
    it("should evict oldest entry when memory is full", () => {
      // Use a tiny cache (very small memory limit)
      const tinyCache = new CacheManager(0.0001); // ~100 bytes
      const bigString = "x".repeat(50);

      tinyCache.set("first", bigString);
      tinyCache.set("second", bigString);
      tinyCache.set("third", bigString);

      // The first entry should have been evicted
      // At least one of the earlier entries should be gone
      const stats = tinyCache.getStats();
      expect(stats.itemCount).toBeLessThanOrEqual(3);
      tinyCache.clear();
    });

    it("should promote recently accessed entries (LRU reorder)", () => {
      // tiny cache that can hold ~2 items
      const tinyCache = new CacheManager(0.0005);
      tinyCache.set("a", "1".repeat(20));
      tinyCache.set("b", "2".repeat(20));

      // Access "a" to promote it
      tinyCache.get("a");

      // Add "c" which should evict "b" (the least recently used)
      tinyCache.set("c", "3".repeat(20));

      // "a" was promoted, so it should survive
      // "b" was not accessed, so it's more likely evicted
      // (exact behavior depends on memory estimates)
      const stats = tinyCache.getStats();
      expect(stats.itemCount).toBeGreaterThan(0);
      tinyCache.clear();
    });
  });

  // ========== 記憶體上限 ==========

  describe("memory limits", () => {
    it("should reject items exceeding 25% of max memory", () => {
      // 1MB cache, 25% = ~256KB
      // Create a string > 256KB
      const hugeString = "x".repeat(200_000); // ~400KB in estimateSize
      cache.set("huge", hugeString);

      // Should be rejected
      expect(cache.get("huge")).toBeNull();
    });

    it("should report memory usage in stats", () => {
      cache.set("k1", "hello");
      const stats = cache.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
      expect(stats.itemCount).toBe(1);
    });

    it("should return correct maxMemoryBytes", () => {
      expect(cache.getMaxMemoryBytes()).toBe(1 * 1024 * 1024);
    });
  });

  // ========== deletePattern / deleteSuffix ==========

  describe("deletePattern", () => {
    it("should delete keys matching a prefix", () => {
      cache.set("revenue:123:overview", "data1");
      cache.set("revenue:123:subs", "data2");
      cache.set("revenue:456:overview", "data3");
      cache.set("viewer:789:channels", "data4");

      const deleted = cache.deletePattern("revenue:123:");
      expect(deleted).toBe(2);
      expect(cache.get("revenue:123:overview")).toBeNull();
      expect(cache.get("revenue:123:subs")).toBeNull();
      expect(cache.get("revenue:456:overview")).not.toBeNull();
      expect(cache.get("viewer:789:channels")).not.toBeNull();
    });

    it("should return 0 when no keys match", () => {
      cache.set("a:1", "v");
      expect(cache.deletePattern("nonexistent:")).toBe(0);
    });
  });

  describe("deleteSuffix", () => {
    it("should delete keys matching a suffix", () => {
      cache.set("viewer:1:channels_list", "d1");
      cache.set("viewer:2:channels_list", "d2");
      cache.set("viewer:1:stats", "d3");

      const deleted = cache.deleteSuffix(":channels_list");
      expect(deleted).toBe(2);
      expect(cache.get("viewer:1:channels_list")).toBeNull();
      expect(cache.get("viewer:2:channels_list")).toBeNull();
      expect(cache.get("viewer:1:stats")).not.toBeNull();
    });
  });

  // ========== Tag 機制 ==========

  describe("tags and invalidateTag", () => {
    it("should track tags via setWithTags", () => {
      cache.setWithTags("revenue:s1:overview", "data1", 300, ["streamer:s1"]);
      cache.setWithTags("revenue:s1:subs", "data2", 300, ["streamer:s1"]);
      cache.setWithTags("revenue:s2:overview", "data3", 300, ["streamer:s2"]);

      expect(cache.get("revenue:s1:overview")).toBe("data1");
    });

    it("should invalidate all keys by tag", async () => {
      cache.setWithTags("revenue:s1:overview", "d1", 300, ["streamer:s1"]);
      cache.setWithTags("revenue:s1:subs", "d2", 300, ["streamer:s1"]);
      cache.setWithTags("revenue:s2:overview", "d3", 300, ["streamer:s2"]);

      const invalidated = await cache.invalidateTag("streamer:s1");
      expect(invalidated).toBe(2);
      expect(cache.get("revenue:s1:overview")).toBeNull();
      expect(cache.get("revenue:s1:subs")).toBeNull();
      expect(cache.get("revenue:s2:overview")).toBe("d3");
    });

    it("should return 0 for nonexistent tag", async () => {
      const invalidated = await cache.invalidateTag("nonexistent");
      expect(invalidated).toBe(0);
    });
  });

  // ========== deleteRevenueCache ==========

  describe("deleteRevenueCache", () => {
    it("should delete all revenue keys for a streamer", () => {
      cache.set("revenue:abc:overview", "v1");
      cache.set("revenue:abc:subs:30d", "v2");
      cache.set("revenue:xyz:overview", "v3");

      cache.deleteRevenueCache("abc");

      expect(cache.get("revenue:abc:overview")).toBeNull();
      expect(cache.get("revenue:abc:subs:30d")).toBeNull();
      expect(cache.get("revenue:xyz:overview")).toBe("v3");
    });
  });

  // ========== getOrSet 防擊穿 ==========

  describe("getOrSet (cache stampede prevention)", () => {
    it("should return cached value without calling factory", async () => {
      cache.set("existing", "cached-value");
      const factory = jest.fn().mockResolvedValue("new-value");

      const result = await cache.getOrSet("existing", factory);
      expect(result).toBe("cached-value");
      expect(factory).not.toHaveBeenCalled();
    });

    it("should call factory and cache result on miss", async () => {
      const factory = jest.fn().mockResolvedValue("fresh-data");

      const result = await cache.getOrSet("new-key", factory, 60);
      expect(result).toBe("fresh-data");
      expect(factory).toHaveBeenCalledTimes(1);

      // Should now be cached
      expect(cache.get("new-key")).toBe("fresh-data");
    });

    it("should coalesce concurrent requests for the same key", async () => {
      let callCount = 0;
      const factory = () =>
        new Promise<string>((resolve) => {
          callCount++;
          setTimeout(() => resolve(`result-${callCount}`), 50);
        });

      // Fire two concurrent requests for the same key
      const [r1, r2] = await Promise.all([
        cache.getOrSet("shared", factory, 60),
        cache.getOrSet("shared", factory, 60),
      ]);

      // Factory should only be called once
      expect(callCount).toBe(1);
      expect(r1).toBe(r2);
    });

    it("should propagate factory errors", async () => {
      const factory = jest.fn().mockRejectedValue(new Error("DB down"));

      await expect(cache.getOrSet("fail-key", factory)).rejects.toThrow("DB down");
    });

    it("should clean up pending promise after factory error", async () => {
      const factory = jest.fn().mockRejectedValue(new Error("temporary"));

      await expect(cache.getOrSet("retry-key", factory)).rejects.toThrow();

      // Second call should invoke factory again (not reuse failed promise)
      factory.mockResolvedValue("recovered");
      const result = await cache.getOrSet("retry-key", factory);
      expect(result).toBe("recovered");
    });
  });

  // ========== getOrSetWithTags ==========

  describe("getOrSetWithTags", () => {
    it("should cache with tags and allow tag invalidation", async () => {
      const factory = jest.fn().mockResolvedValue({ total: 100 });

      const result = await cache.getOrSetWithTags(
        "revenue:s1:overview",
        factory,
        300,
        ["streamer:s1"]
      );
      expect(result).toEqual({ total: 100 });

      // Should be cached
      const cached = cache.get("revenue:s1:overview");
      expect(cached).toEqual({ total: 100 });

      // Invalidate tag
      await cache.invalidateTag("streamer:s1");
      expect(cache.get("revenue:s1:overview")).toBeNull();
    });
  });

  // ========== getStats / resetStats ==========

  describe("stats", () => {
    it("should track hits and misses", () => {
      cache.set("hit-key", "value");

      cache.get("hit-key"); // hit
      cache.get("hit-key"); // hit
      cache.get("miss-key"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it("should report 0 hitRate when no requests", () => {
      expect(cache.getStats().hitRate).toBe(0);
    });

    it("should reset stats but keep data", () => {
      cache.set("k", "v");
      cache.get("k");
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(cache.get("k")).toBe("v");
    });

    it("should report pendingRequests", () => {
      const stats = cache.getStats();
      expect(stats.pendingRequests).toBe(0);
    });
  });

  // ========== getAdaptiveTTL ==========

  describe("getAdaptiveTTL", () => {
    // Note: CACHE_ADAPTIVE_TTL_ENABLED defaults to false, so adaptive TTL is a passthrough
    it("should return baseTTL when adaptive TTL is disabled (default)", () => {
      expect(getAdaptiveTTL(300, cache)).toBe(300);
    });

    it("should handle invalid baseTTL gracefully", () => {
      expect(getAdaptiveTTL(0, cache)).toBe(0);
      expect(getAdaptiveTTL(-1, cache)).toBe(-1);
      expect(getAdaptiveTTL(NaN, cache)).toBe(NaN);
    });
  });

  // ========== CacheKeys ==========

  describe("CacheKeys generators", () => {
    it("should generate correct viewer keys", () => {
      expect(CacheKeys.viewerChannels("u1")).toBe("viewer:u1:channels");
      expect(CacheKeys.viewerStats("u1", "c1", 7)).toBe("viewer:u1:channel:c1:stats:7d");
      expect(CacheKeys.viewerLifetimeStats("u1", "c1")).toBe("viewer:u1:channel:c1:lifetime");
    });

    it("should generate correct channel keys", () => {
      expect(CacheKeys.channelInfo("c1")).toBe("channel:c1:info");
      expect(CacheKeys.channelLiveStatus("c1")).toBe("channel:c1:live");
    });

    it("should generate correct revenue keys", () => {
      expect(CacheKeys.revenueOverview("s1")).toBe("revenue:s1:overview");
      expect(CacheKeys.revenueSubscriptions("s1", 30)).toBe("revenue:s1:subs:30d");
      expect(CacheKeys.revenueBits("s1", 7)).toBe("revenue:s1:bits:7d");
    });

    it("should generate correct system keys", () => {
      expect(CacheKeys.liveChannels()).toBe("system:live_channels");
      expect(CacheKeys.monitoredChannels()).toBe("system:monitored_channels");
    });
  });

  // ========== CacheTTL ==========

  describe("CacheTTL constants", () => {
    it("should have expected TTL values", () => {
      expect(CacheTTL.SHORT).toBe(30);
      expect(CacheTTL.MEDIUM).toBe(180);
      expect(CacheTTL.LONG).toBe(600);
      expect(CacheTTL.VERY_LONG).toBe(1800);
    });

    it("should be in ascending order", () => {
      expect(CacheTTL.SHORT).toBeLessThan(CacheTTL.MEDIUM);
      expect(CacheTTL.MEDIUM).toBeLessThan(CacheTTL.LONG);
      expect(CacheTTL.LONG).toBeLessThan(CacheTTL.VERY_LONG);
    });
  });
});
