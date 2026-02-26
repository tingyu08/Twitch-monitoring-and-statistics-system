jest.mock("axios", () => {
  const mockGetFn = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({ get: mockGetFn })),
    },
    __mockGet: mockGetFn,
  };
});

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { logger } from "../../utils/logger";
import { decApiService } from "../decapi.service";

const mockGet = (jest.requireMock("axios") as { __mockGet: jest.Mock }).__mockGet;

describe("DecApiService", () => {
  beforeEach(() => {
    mockGet.mockReset();
    decApiService.clearCache();
    jest.clearAllMocks();
  });

  // ─── getFollowage ──────────────────────────────────────────────────────────

  describe("getFollowage", () => {
    it("returns following:true with duration and followedAt on success", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "2 years, 3 months" })
        .mockResolvedValueOnce({ data: "2022-01-15 10:30:00" });

      const result = await decApiService.getFollowage("channelA", "userA");

      expect(result).toEqual({
        isFollowing: true,
        duration: "2 years, 3 months",
        followedAt: "2022-01-15 10:30:00",
      });
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it("returns isFollowing:false when duration contains 'not following'", async () => {
      mockGet.mockResolvedValueOnce({ data: "userA is not following channelA" });

      const result = await decApiService.getFollowage("channelA", "userA");

      expect(result).toEqual({ isFollowing: false });
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("returns isFollowing:false when duration contains 'does not follow'", async () => {
      mockGet.mockResolvedValueOnce({ data: "userA does not follow channelA" });

      const result = await decApiService.getFollowage("channelA", "userA");

      expect(result).toEqual({ isFollowing: false });
    });

    it("returns cached result on second call without hitting API", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "1 year" })
        .mockResolvedValueOnce({ data: "2023-01-01 00:00:00" });

      await decApiService.getFollowage("channelB", "userB");
      const result = await decApiService.getFollowage("channelB", "userB");

      expect(mockGet).toHaveBeenCalledTimes(2); // only first call hits API
      expect(result.isFollowing).toBe(true);
    });

    it("returns error result and logs when API throws", async () => {
      mockGet.mockRejectedValueOnce(new Error("network error"));

      const result = await decApiService.getFollowage("channelC", "userC");

      expect(result).toEqual({ isFollowing: false, error: "查詢失敗" });
      expect(logger.error).toHaveBeenCalledWith(
        "DecAPI",
        "Failed to get followage: channelC/userC",
        expect.any(Error)
      );
    });
  });

  // ─── getAccountAge ─────────────────────────────────────────────────────────

  describe("getAccountAge", () => {
    it("returns age and createdAt on success", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "5 years, 2 months" })
        .mockResolvedValueOnce({ data: "2019-03-10 12:00:00" });

      const result = await decApiService.getAccountAge("userX");

      expect(result).toEqual({
        age: "5 years, 2 months",
        createdAt: "2019-03-10 12:00:00",
      });
    });

    it("returns cached result on second call", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "3 years" })
        .mockResolvedValueOnce({ data: "2021-05-01 00:00:00" });

      await decApiService.getAccountAge("userY");
      const result = await decApiService.getAccountAge("userY");

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result?.age).toBe("3 years");
    });

    it("returns null and logs error when API throws", async () => {
      mockGet.mockRejectedValueOnce(new Error("timeout"));

      const result = await decApiService.getAccountAge("userZ");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "DecAPI",
        "Failed to get account age: userZ",
        expect.any(Error)
      );
    });
  });

  // ─── clearCache ────────────────────────────────────────────────────────────

  describe("clearCache", () => {
    it("clears cache and logs info", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "1 year" })
        .mockResolvedValueOnce({ data: "2023-01-01" });
      await decApiService.getFollowage("ch", "user");

      decApiService.clearCache();

      expect(logger.info).toHaveBeenCalledWith("DecAPI", "Cache cleared");

      // After clearing, API should be called again on next request
      mockGet
        .mockResolvedValueOnce({ data: "1 year" })
        .mockResolvedValueOnce({ data: "2023-01-01" });
      await decApiService.getFollowage("ch", "user");
      expect(mockGet).toHaveBeenCalledTimes(4); // 2 + 2
    });
  });

  // ─── getCacheStats ─────────────────────────────────────────────────────────

  describe("getCacheStats", () => {
    it("returns stats with valid entries after population", async () => {
      mockGet
        .mockResolvedValueOnce({ data: "1 year" })
        .mockResolvedValueOnce({ data: "2023-01-01" });
      await decApiService.getFollowage("ch1", "user1");

      const stats = decApiService.getCacheStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.validEntries).toBe(1);
      expect(stats.expiredEntries).toBe(0);
    });

    it("returns empty stats after clearCache", () => {
      decApiService.clearCache();
      const stats = decApiService.getCacheStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.validEntries).toBe(0);
    });
  });

  // ─── pruneCache ──────────────────────────────────────────────────────────

  describe("cache pruning on overflow", () => {
    it("prunes cache when size exceeds MAX_CACHE_SIZE by adding many entries", async () => {
      const service = decApiService as unknown as {
        cache: Map<string, { data: unknown; expiresAt: number }>;
        pruneCache: () => void;
      };

      // Fill cache to max
      for (let i = 0; i < 1000; i++) {
        service.cache.set(`key-${i}`, { data: i, expiresAt: Date.now() + 10000 });
      }

      // Adding one more should trigger prune via setCache
      mockGet.mockResolvedValueOnce({ data: "not following userX" });
      await decApiService.getFollowage("newChannel", "newUser");

      // Cache should have been pruned (size < 1000)
      expect(service.cache.size).toBeLessThan(1000);
    });

    it("prunes expired entries first during overflow", () => {
      const service = decApiService as unknown as {
        cache: Map<string, { data: unknown; expiresAt: number }>;
        pruneCache: () => void;
      };

      // Fill with expired entries
      for (let i = 0; i < 1000; i++) {
        service.cache.set(`expired-${i}`, { data: i, expiresAt: Date.now() - 1000 });
      }

      // Trigger prune directly
      service.pruneCache();

      // All expired entries should be removed
      expect(service.cache.size).toBe(0);
    });
  });
});
