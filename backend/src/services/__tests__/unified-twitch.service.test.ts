jest.mock("../twitch-chat.service", () => ({
  twurpleChatService: {
    initialize: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ connected: true }),
  },
}));

jest.mock("../twitch-helix.service", () => ({
  twurpleHelixService: {
    healthCheck: jest.fn().mockResolvedValue(true),
    getUserByLogin: jest.fn(),
    getUserById: jest.fn(),
    getStream: jest.fn(),
    getFollowerCount: jest.fn(),
    getChannelSnapshotsByIds: jest.fn().mockResolvedValue([]),
    getStreamsByUserIds: jest.fn().mockResolvedValue([]),
    getStatus: jest.fn().mockReturnValue({ status: "healthy" }),
  },
}));

jest.mock("../decapi.service", () => ({
  decApiService: {
    getFollowage: jest.fn(),
    getAccountAge: jest.fn(),
    getCacheStats: jest.fn().mockReturnValue({ hits: 1 }),
  },
}));

jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    getStatus: jest.fn().mockReturnValue({ status: "healthy" }),
  },
}));

jest.mock("../../jobs/auto-join-live-channels.job", () => ({
  autoJoinLiveChannelsJob: {
    start: jest.fn(),
  },
}));

jest.mock("../../jobs/watch-time-increment.job", () => ({
  watchTimeIncrementJob: {
    start: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { autoJoinLiveChannelsJob } from "../../jobs/auto-join-live-channels.job";
import { watchTimeIncrementJob } from "../../jobs/watch-time-increment.job";
import { logger } from "../../utils/logger";
import { decApiService } from "../decapi.service";
import { twurpleChatService } from "../twitch-chat.service";
import { twurpleHelixService } from "../twitch-helix.service";
import { UnifiedTwitchService } from "../unified-twitch.service";

describe("UnifiedTwitchService", () => {
  let service: UnifiedTwitchService;

  beforeEach(() => {
    service = new UnifiedTwitchService();
    jest.clearAllMocks();
  });

  describe("initialize", () => {
    it("logs healthy helix path and only starts cache cleanup timer once", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");

      await service.initialize();
      await service.initialize();

      expect(logger.info).toHaveBeenCalledWith("Twitch Service", "Helix API 連線正常 (Twurple)");
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      clearInterval((service as any).cacheCleanupTimer);
      (service as any).cacheCleanupTimer = null;
      setIntervalSpy.mockRestore();
    });

    it("starts chat, jobs and logs a warning when helix health check fails", async () => {
      (twurpleHelixService.healthCheck as jest.Mock).mockResolvedValue(false);

      await service.initialize();

      expect(twurpleChatService.initialize).toHaveBeenCalledTimes(1);
      expect(autoJoinLiveChannelsJob.start).toHaveBeenCalledTimes(1);
      expect(watchTimeIncrementJob.start).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "Twitch Service",
        "Helix API 連線失敗 - 部分功能可能無法使用"
      );
    });
  });

  describe("getChannelInfo", () => {
    it("returns null and warns when user does not exist", async () => {
      (twurpleHelixService.getUserByLogin as jest.Mock).mockResolvedValue(null);

      const result = await service.getChannelInfo("ghost");

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith("Twitch Service", "Helix 找不到用戶: ghost");
    });

    it("falls back followerCount to 0 when follower API fails", async () => {
      (twurpleHelixService.getUserByLogin as jest.Mock).mockResolvedValue({
        id: "u1",
        login: "tester",
        displayName: "Tester",
        profileImageUrl: "avatar-url",
      });
      (twurpleHelixService.getStream as jest.Mock).mockResolvedValue({
        type: "offline",
        gameName: "Chess",
        title: "Title",
        viewerCount: 999,
      });
      (twurpleHelixService.getFollowerCount as jest.Mock).mockRejectedValue(new Error("boom"));

      const result = await service.getChannelInfo("tester");

      expect(result).toEqual({
        id: "u1",
        login: "tester",
        displayName: "Tester",
        avatarUrl: "avatar-url",
        isLive: false,
        currentGame: "Chess",
        streamTitle: "Title",
        viewerCount: 999,
        followerCount: 0,
      });
    });

    it("returns null and logs when helix user lookup throws", async () => {
      const err = new Error("helix failure");
      (twurpleHelixService.getUserByLogin as jest.Mock).mockRejectedValue(err);

      const result = await service.getChannelInfo("broken");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Twitch Service",
        "獲取頻道資訊失敗: broken",
        err
      );
    });
  });

  describe("getChannelInfoById", () => {
    it("evicts expired cached value and reloads, with follower fallback to 0", async () => {
      const now = Date.now();
      (service as any).channelInfoByIdCache.set("exp-1", {
        value: {
          id: "exp-1",
          login: "old",
          displayName: "Old",
          avatarUrl: "old-avatar",
          isLive: false,
          followerCount: 1,
        },
        expiresAt: now - 1,
      });

      (twurpleHelixService.getUserById as jest.Mock).mockResolvedValue({
        id: "exp-1",
        login: "new_login",
        displayName: "New Name",
        profileImageUrl: "new-avatar",
      });
      (twurpleHelixService.getStream as jest.Mock).mockResolvedValue({ type: "offline" });
      (twurpleHelixService.getFollowerCount as jest.Mock).mockRejectedValue(new Error("follower down"));

      const result = await service.getChannelInfoById("exp-1");

      expect(twurpleHelixService.getUserById).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: "exp-1",
        login: "new_login",
        displayName: "New Name",
        avatarUrl: "new-avatar",
        isLive: false,
        currentGame: undefined,
        streamTitle: undefined,
        viewerCount: undefined,
        followerCount: 0,
      });
    });

    it("reuses cached value and avoids duplicate provider call", async () => {
      (twurpleHelixService.getUserById as jest.Mock).mockResolvedValue({
        id: "100",
        login: "cache_user",
        displayName: "CacheUser",
        profileImageUrl: "cache-avatar",
      });
      (twurpleHelixService.getStream as jest.Mock).mockResolvedValue({ type: "live" });
      (twurpleHelixService.getFollowerCount as jest.Mock).mockResolvedValue(42);

      const first = await service.getChannelInfoById("100");
      const second = await service.getChannelInfoById("100");

      expect(first).toEqual(second);
      expect(twurpleHelixService.getUserById).toHaveBeenCalledTimes(1);
    });

    it("returns same pending promise for concurrent requests", async () => {
      let release: (value: unknown) => void;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      (twurpleHelixService.getUserById as jest.Mock).mockImplementation(async () => {
        await gate;
        return {
          id: "200",
          login: "pending_user",
          displayName: "PendingUser",
          profileImageUrl: "pending-avatar",
        };
      });
      (twurpleHelixService.getStream as jest.Mock).mockResolvedValue(null);
      (twurpleHelixService.getFollowerCount as jest.Mock).mockResolvedValue(0);

      const firstPromise = service.getChannelInfoById("200");
      const secondPromise = service.getChannelInfoById("200");
      release!(undefined);

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first).toEqual(second);
      expect(twurpleHelixService.getUserById).toHaveBeenCalledTimes(1);
    });

    it("caches null for missing user and uses short TTL cache path", async () => {
      (twurpleHelixService.getUserById as jest.Mock).mockResolvedValue(null);

      const first = await service.getChannelInfoById("404");
      const second = await service.getChannelInfoById("404");

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(twurpleHelixService.getUserById).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        "Twitch Service",
        "Helix 找不到用戶 ID: 404（可能已封禁或刪除）"
      );
    });

    it("returns null and logs when provider throws", async () => {
      const err = new Error("by-id failed");
      (twurpleHelixService.getUserById as jest.Mock).mockRejectedValue(err);

      const result = await service.getChannelInfoById("500");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Twitch Service",
        "透過 ID 獲取頻道資訊失敗: 500",
        err
      );
    });
  });

  describe("getChannelInfoByIds", () => {
    it("returns empty map for empty input", async () => {
      const result = await service.getChannelInfoByIds([]);
      expect(result.size).toBe(0);
      expect(twurpleHelixService.getChannelSnapshotsByIds).not.toHaveBeenCalled();
    });

    it("uses cache, resolves pending entries and transforms snapshot payload", async () => {
      const now = Date.now();
      (service as any).channelInfoByIdCache.set("cache-id", {
        value: {
          id: "cache-id",
          login: "cache_login",
          displayName: "Cache",
          avatarUrl: "a",
          isLive: true,
          followerCount: 1,
        },
        expiresAt: now + 10_000,
      });

      (service as any).channelInfoByIdPending.set(
        "pending-id",
        Promise.resolve({
          id: "pending-id",
          login: "pending_login",
          displayName: "Pending",
          avatarUrl: "p",
          isLive: false,
          followerCount: 2,
        })
      );

      (twurpleHelixService.getChannelSnapshotsByIds as jest.Mock).mockResolvedValue([
        {
          broadcasterId: "missing-id",
          broadcasterLogin: "missing_login",
          broadcasterName: "Missing Name",
          gameName: "Just Chatting",
          title: "Now Live",
          isLive: true,
        },
      ]);

      const result = await service.getChannelInfoByIds([
        "cache-id",
        "pending-id",
        "missing-id",
        "cache-id",
      ]);

      expect(twurpleHelixService.getChannelSnapshotsByIds).toHaveBeenCalledWith(["missing-id"]);
      expect(result.get("cache-id")?.displayName).toBe("Cache");
      expect(result.get("pending-id")?.login).toBe("pending_login");
      expect(result.get("missing-id")).toEqual({
        id: "missing-id",
        login: "missing_login",
        displayName: "Missing Name",
        avatarUrl: "",
        isLive: true,
        currentGame: "Just Chatting",
        streamTitle: "Now Live",
        followerCount: 0,
      });
    });

    it("stores null for ids with missing snapshot and skips them in result", async () => {
      (twurpleHelixService.getChannelSnapshotsByIds as jest.Mock).mockResolvedValue([]);

      const result = await service.getChannelInfoByIds(["no-snapshot"]);
      const cacheEntry = (service as any).channelInfoByIdCache.get("no-snapshot");

      expect(result.has("no-snapshot")).toBe(false);
      expect(cacheEntry?.value).toBeNull();
    });

    it("returns early when all ids are served by cache/pending", async () => {
      const now = Date.now();
      (service as any).channelInfoByIdCache.set("cache-only", {
        value: {
          id: "cache-only",
          login: "cache_only",
          displayName: "Cache Only",
          avatarUrl: "cache-avatar",
          isLive: false,
          followerCount: 9,
        },
        expiresAt: now + 10_000,
      });
      (service as any).channelInfoByIdCache.set("expired-only", {
        value: {
          id: "expired-only",
          login: "expired",
          displayName: "Expired",
          avatarUrl: "expired-avatar",
          isLive: false,
          followerCount: 1,
        },
        expiresAt: now - 1,
      });
      (service as any).channelInfoByIdPending.set(
        "pending-only",
        Promise.resolve({
          id: "pending-only",
          login: "pending_only",
          displayName: "Pending Only",
          avatarUrl: "pending-avatar",
          isLive: true,
          followerCount: 3,
        })
      );

      const result = await service.getChannelInfoByIds(["cache-only", "pending-only"]);

      expect(twurpleHelixService.getChannelSnapshotsByIds).not.toHaveBeenCalled();
      expect(result.get("cache-only")?.displayName).toBe("Cache Only");
      expect(result.get("pending-only")?.displayName).toBe("Pending Only");
    });

    it("evicts expired entry before snapshot fetch", async () => {
      const now = Date.now();
      (service as any).channelInfoByIdCache.set("expired-only", {
        value: {
          id: "expired-only",
          login: "expired",
          displayName: "Expired",
          avatarUrl: "expired-avatar",
          isLive: false,
          followerCount: 1,
        },
        expiresAt: now - 1,
      });

      (twurpleHelixService.getChannelSnapshotsByIds as jest.Mock).mockResolvedValue([]);

      await service.getChannelInfoByIds(["expired-only"]);

      expect(twurpleHelixService.getChannelSnapshotsByIds).toHaveBeenCalledWith(["expired-only"]);
      expect((service as any).channelInfoByIdCache.get("expired-only")?.value).toBeNull();
    });
  });

  describe("getChannelsInfo", () => {
    it("processes in batches and filters null values", async () => {
      const spy = jest
        .spyOn(service, "getChannelInfo")
        .mockImplementation(async (login: string) => (login === "drop" ? null : {
          id: login,
          login,
          displayName: login.toUpperCase(),
          avatarUrl: "x",
          isLive: false,
          followerCount: 0,
        }));

      const logins = Array.from({ length: 21 }, (_, i) => `u${i + 1}`);
      logins[5] = "drop";

      const result = await service.getChannelsInfo(logins);

      expect(spy).toHaveBeenCalledTimes(21);
      expect(result).toHaveLength(20);
      expect(result.some((r) => r.login === "drop")).toBe(false);
    });
  });

  describe("follow and relation", () => {
    it("maps followage payload and handles provider errors", async () => {
      (decApiService.getFollowage as jest.Mock)
        .mockResolvedValueOnce({ isFollowing: true, followedAt: "2024-01-01", duration: "1y" })
        .mockRejectedValueOnce(new Error("decapi down"));

      const ok = await service.getUserFollowInfo("channel", "viewer");
      const fallback = await service.getUserFollowInfo("channel", "viewer");

      expect(ok).toEqual({ isFollowing: true, followedAt: "2024-01-01", followDuration: "1y" });
      expect(fallback).toEqual({ isFollowing: false });
    });

    it("returns null when channel is not available", async () => {
      jest.spyOn(service, "getChannelInfo").mockResolvedValue(null);
      jest.spyOn(service, "getUserFollowInfo").mockResolvedValue({ isFollowing: true });
      (decApiService.getAccountAge as jest.Mock).mockResolvedValue({ age: "5 years" });

      const result = await service.getViewerChannelRelation("channel", "viewer");

      expect(result).toBeNull();
    });

    it("returns full relation with account age mapping on success", async () => {
      jest.spyOn(service, "getChannelInfo").mockResolvedValue({
        id: "c1",
        login: "channel",
        displayName: "Channel",
        avatarUrl: "avatar",
        isLive: true,
        followerCount: 123,
      });
      jest.spyOn(service, "getUserFollowInfo").mockResolvedValue({
        isFollowing: true,
        followedAt: "2020-01-01",
        followDuration: "6 years",
      });
      (decApiService.getAccountAge as jest.Mock).mockResolvedValue({ age: "8 years" });

      const result = await service.getViewerChannelRelation("channel", "viewer");

      expect(result).toEqual({
        channel: {
          id: "c1",
          login: "channel",
          displayName: "Channel",
          avatarUrl: "avatar",
          isLive: true,
          followerCount: 123,
        },
        followInfo: {
          isFollowing: true,
          followedAt: "2020-01-01",
          followDuration: "6 years",
        },
        viewerAccountAge: "8 years",
      });
    });
  
    it("returns null when relation aggregation throws", async () => {
      jest.spyOn(service, "getChannelInfo").mockRejectedValue(new Error("channel crash"));

      const result = await service.getViewerChannelRelation("channel", "viewer");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Twitch Service",
        "獲取觀眾頻道關係失敗",
        expect.any(Error)
      );
    });
  });

  describe("chat and live status", () => {
    it("returns true for start/stop channel listening success", async () => {
      (twurpleChatService.joinChannel as jest.Mock).mockResolvedValue(undefined);
      (twurpleChatService.leaveChannel as jest.Mock).mockResolvedValue(undefined);

      await expect(service.startListeningToChannel("abc")).resolves.toBe(true);
      await expect(service.stopListeningToChannel("abc")).resolves.toBe(true);
    });

    it("returns false for start/stop channel listening failures", async () => {
      (twurpleChatService.joinChannel as jest.Mock).mockRejectedValue(new Error("join failed"));
      (twurpleChatService.leaveChannel as jest.Mock).mockRejectedValue(new Error("leave failed"));

      await expect(service.startListeningToChannel("abc")).resolves.toBe(false);
      await expect(service.stopListeningToChannel("abc")).resolves.toBe(false);
    });

    it("maps live status and falls back to all false on errors", async () => {
      (twurpleHelixService.getStreamsByUserIds as jest.Mock)
        .mockResolvedValueOnce([{ userId: "1" }])
        .mockRejectedValueOnce(new Error("stream failure"));

      const ok = await service.checkLiveStatus(["1", "2"]);
      const fallback = await service.checkLiveStatus(["1", "2"]);

      expect(ok.get("1")).toBe(true);
      expect(ok.get("2")).toBe(false);
      expect(fallback.get("1")).toBe(false);
      expect(fallback.get("2")).toBe(false);
    });

    it("passes through stream batch provider and services status", async () => {
      (twurpleHelixService.getStreamsByUserIds as jest.Mock).mockResolvedValue([{ userId: "10" }]);

      const streams = await service.getStreamsByUserIds(["10"]);
      const status = service.getServicesStatus();

      expect(streams).toEqual([{ userId: "10" }]);
      expect(status).toEqual({
        chat: { connected: true },
        helix: { status: "healthy" },
        auth: { status: "healthy" },
        decapi: { hits: 1 },
      });
    });

    it("periodic cleanup removes expired cache entries", async () => {
      jest.useFakeTimers();

      const localService = new UnifiedTwitchService();
      const now = Date.now();
      (localService as any).channelInfoByIdCache.set("alive", {
        value: {
          id: "alive",
          login: "alive",
          displayName: "Alive",
          avatarUrl: "a",
          isLive: false,
          followerCount: 0,
        },
        expiresAt: now + 120_000,
      });
      (localService as any).channelInfoByIdCache.set("expired", {
        value: null,
        expiresAt: now - 1,
      });

      await localService.initialize();
      jest.advanceTimersByTime(60_000);

      expect((localService as any).channelInfoByIdCache.has("expired")).toBe(false);
      expect((localService as any).channelInfoByIdCache.has("alive")).toBe(true);

      clearInterval((localService as any).cacheCleanupTimer);
      (localService as any).cacheCleanupTimer = null;
      jest.useRealTimers();
    });

    it("forced cleanup trims oversized cache and handles empty-key edge branch", () => {
      const localService = new UnifiedTwitchService();
      const anyService = localService as any;
      const realCache = anyService.channelInfoByIdCache;

      anyService.channelInfoByIdCache = {
        size: 1,
        set: jest.fn(),
        get: jest.fn(),
        has: jest.fn(),
        delete: jest.fn(),
        keys: () => ({ next: () => ({ value: undefined }) }),
        [Symbol.iterator]: function* () {
          yield* [];
        },
      };
      anyService.channelInfoByIdMaxEntries = 0;

      anyService.cleanupChannelInfoCacheIfNeeded(true);

      expect(anyService.channelInfoByIdCache.delete).not.toHaveBeenCalled();

      anyService.channelInfoByIdCache = realCache;
    });

    it("cleanup returns early when under limits and within interval", () => {
      const localService = new UnifiedTwitchService();
      const anyService = localService as any;

      anyService.channelInfoByIdCache.set("soon-expired", {
        value: null,
        expiresAt: Date.now() - 1,
      });
      anyService.lastChannelInfoCleanupAt = Date.now();
      anyService.channelInfoByIdMaxEntries = 2000;

      anyService.cleanupChannelInfoCacheIfNeeded(false);

      expect(anyService.channelInfoByIdCache.has("soon-expired")).toBe(true);
    });

    it("forced cleanup removes expired entries and oldest overflow entry", () => {
      const localService = new UnifiedTwitchService();
      const anyService = localService as any;
      const now = Date.now();

      anyService.channelInfoByIdCache.set("expired-key", {
        value: null,
        expiresAt: now - 1,
      });
      anyService.cleanupChannelInfoCacheIfNeeded(true);
      expect(anyService.channelInfoByIdCache.has("expired-key")).toBe(false);

      anyService.channelInfoByIdMaxEntries = 0;
      anyService.channelInfoByIdCache.set("oldest-key", {
        value: {
          id: "oldest-key",
          login: "oldest",
          displayName: "Oldest",
          avatarUrl: "o",
          isLive: false,
          followerCount: 0,
        },
        expiresAt: now + 30_000,
      });

      anyService.cleanupChannelInfoCacheIfNeeded(true);
      expect(anyService.channelInfoByIdCache.has("oldest-key")).toBe(false);
    });
  });
});
