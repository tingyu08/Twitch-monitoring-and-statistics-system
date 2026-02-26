import { twurpleHelixService } from "../twitch-helix.service";
import * as esmImportUtils from "../../utils/esm-import";
import { logger } from "../../utils/logger";
import { prisma } from "../../db/prisma";
import { encryptToken } from "../../utils/crypto.utils";

const mockUsersApi = {
  getUserByName: jest.fn(),
  getUserById: jest.fn(),
  getUsersByIds: jest.fn(),
};

const mockChannelsApi = {
  getChannelInfoById: jest.fn(),
  getChannelFollowerCount: jest.fn(),
  getFollowedChannelsPaginated: jest.fn(),
};

const mockStreamsApi = {
  getStreamByUserId: jest.fn(),
  getStreamsByUserIds: jest.fn(),
};

const mockHelixApiClientInstance = {
  users: mockUsersApi,
  channels: mockChannelsApi,
  streams: mockStreamsApi,
};

jest.mock("../../utils/esm-import", () => ({
  importTwurpleApi: jest.fn(),
  importTwurpleAuth: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    twitchToken: {
      update: jest.fn(),
    },
  },
}));

jest.mock("../../utils/crypto.utils", () => ({
  encryptToken: jest.fn((value: string) => `enc:${value}`),
}));

jest.mock("../twurple-auth.service", () => ({
  twurpleAuthService: {
    getAppAuthProvider: jest.fn().mockReturnValue({}),
    getStatus: jest.fn().mockReturnValue({ status: "ok" }),
    getClientId: jest.fn().mockReturnValue("client-id"),
    getClientSecret: jest.fn().mockReturnValue("client-secret"),
  },
}));

describe("TwurpleHelixService", () => {
  let mockApiClientCtor: jest.Mock;
  let mockRefreshingAuthProviderCtor: jest.Mock;
  let mockStaticAuthProviderCtor: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    (twurpleHelixService as any).apiClient = null;
    (twurpleHelixService as any).userApiClients.clear();

    mockApiClientCtor = jest.fn().mockImplementation(() => mockHelixApiClientInstance);

    mockRefreshingAuthProviderCtor = jest.fn().mockImplementation(() => ({
      onRefresh: jest.fn(),
      addUserForToken: jest.fn().mockResolvedValue(undefined),
    }));

    mockStaticAuthProviderCtor = jest.fn().mockImplementation(() => ({}));

    (esmImportUtils.importTwurpleApi as jest.Mock).mockResolvedValue({
      ApiClient: mockApiClientCtor,
    });

    (esmImportUtils.importTwurpleAuth as jest.Mock).mockResolvedValue({
      StaticAuthProvider: mockStaticAuthProviderCtor,
      RefreshingAuthProvider: mockRefreshingAuthProviderCtor,
    });

    mockChannelsApi.getFollowedChannelsPaginated.mockImplementation(async function* () {
      return;
    });

    (prisma.twitchToken.update as jest.Mock).mockResolvedValue(undefined);
    (encryptToken as jest.Mock).mockImplementation((value: string) => `enc:${value}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("user APIs", () => {
    it("maps getUserByLogin response", async () => {
      const creationDate = new Date();
      mockUsersApi.getUserByName.mockResolvedValue({
        id: "1",
        name: "alice",
        displayName: "Alice",
        type: "",
        broadcasterType: "",
        description: "desc",
        profilePictureUrl: "profile",
        offlinePlaceholderUrl: "offline",
        creationDate,
      });

      const result = await twurpleHelixService.getUserByLogin("alice");

      expect(result).toEqual({
        id: "1",
        login: "alice",
        displayName: "Alice",
        type: "",
        broadcasterType: "",
        description: "desc",
        profileImageUrl: "profile",
        offlineImageUrl: "offline",
        createdAt: creationDate,
      });
    });

    it("returns null when getUserByLogin does not find user", async () => {
      mockUsersApi.getUserByName.mockResolvedValue(null);

      const result = await twurpleHelixService.getUserByLogin("missing");

      expect(result).toBeNull();
    });

    it("returns null when getUserByLogin throws", async () => {
      mockUsersApi.getUserByName.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getUserByLogin("broken");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns null when getUserById does not find user", async () => {
      mockUsersApi.getUserById.mockResolvedValue(null);

      const result = await twurpleHelixService.getUserById("missing-id");

      expect(result).toBeNull();
    });

    it("maps getUserById response", async () => {
      const creationDate = new Date();
      mockUsersApi.getUserById.mockResolvedValue({
        id: "2",
        name: "bob",
        displayName: "Bob",
        type: "",
        broadcasterType: "affiliate",
        description: "desc-bob",
        profilePictureUrl: "profile-bob",
        offlinePlaceholderUrl: "offline-bob",
        creationDate,
      });

      const result = await twurpleHelixService.getUserById("2");

      expect(result).toEqual({
        id: "2",
        login: "bob",
        displayName: "Bob",
        type: "",
        broadcasterType: "affiliate",
        description: "desc-bob",
        profileImageUrl: "profile-bob",
        offlineImageUrl: "offline-bob",
        createdAt: creationDate,
      });
    });

    it("returns null when getUserById throws", async () => {
      mockUsersApi.getUserById.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getUserById("broken-id");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("returns users array", async () => {
      mockUsersApi.getUsersByIds.mockResolvedValue([
        {
          id: "1",
          name: "a",
          displayName: "A",
          type: "",
          broadcasterType: "",
          description: "",
          profilePictureUrl: "",
          offlinePlaceholderUrl: "",
          creationDate: new Date(),
        },
      ]);

      const result = await twurpleHelixService.getUsersByIds(["1"]);

      expect(result).toHaveLength(1);
    });

    it("returns empty array when ids are empty", async () => {
      const result = await twurpleHelixService.getUsersByIds([]);

      expect(result).toEqual([]);
      expect(mockUsersApi.getUsersByIds).not.toHaveBeenCalled();
    });

    it("truncates getUsersByIds input when > 100", async () => {
      const ids = Array.from({ length: 120 }, (_, index) => `${index + 1}`);
      mockUsersApi.getUsersByIds.mockResolvedValue([]);

      await twurpleHelixService.getUsersByIds(ids);

      expect(mockUsersApi.getUsersByIds).toHaveBeenCalledWith(ids.slice(0, 100));
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns empty array on getUsersByIds exception", async () => {
      mockUsersApi.getUsersByIds.mockRejectedValue(new Error("Fail"));

      const result = await twurpleHelixService.getUsersByIds(["1"]);

      expect(result).toEqual([]);
    });
  });

  describe("channel and stream APIs", () => {
    it("getChannelInfo returns info", async () => {
      mockChannelsApi.getChannelInfoById.mockResolvedValue({
        id: "1",
        name: "a",
        displayName: "A",
        language: "en",
        gameId: "g1",
        gameName: "G",
        title: "T",
      });

      const result = await twurpleHelixService.getChannelInfo("1");

      expect(result?.broadcasterId).toBe("1");
    });

    it("getChannelInfo returns null when channel missing", async () => {
      mockChannelsApi.getChannelInfoById.mockResolvedValue(null);

      const result = await twurpleHelixService.getChannelInfo("404");

      expect(result).toBeNull();
    });

    it("getChannelInfo returns null on exception", async () => {
      mockChannelsApi.getChannelInfoById.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getChannelInfo("1");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("getStream returns info", async () => {
      mockStreamsApi.getStreamByUserId.mockResolvedValue({
        id: "s1",
        userId: "1",
        userName: "a",
        userDisplayName: "A",
        gameId: "g1",
        gameName: "G",
        type: "live",
        title: "T",
        viewers: 10,
        startDate: new Date(),
        language: "en",
        thumbnailUrl: "url",
        isMature: false,
      });

      const result = await twurpleHelixService.getStream("1");

      expect(result?.id).toBe("s1");
    });

    it("getStream returns null when stream missing", async () => {
      mockStreamsApi.getStreamByUserId.mockResolvedValue(null);

      const result = await twurpleHelixService.getStream("offline");

      expect(result).toBeNull();
    });

    it("getStream returns null on exception", async () => {
      mockStreamsApi.getStreamByUserId.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getStream("broken");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it("getStreamsByUserIds returns empty when ids are empty", async () => {
      const result = await twurpleHelixService.getStreamsByUserIds([]);

      expect(result).toEqual([]);
      expect(mockStreamsApi.getStreamsByUserIds).not.toHaveBeenCalled();
    });

    it("getStreamsByUserIds chunks ids > 100", async () => {
      mockStreamsApi.getStreamsByUserIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({
            id: `stream-${id}`,
            userId: id,
            userName: `user-${id}`,
            userDisplayName: `User ${id}`,
            gameId: "1",
            gameName: "Game",
            type: "live",
            title: `Title ${id}`,
            viewers: 100,
            startDate: new Date(),
            language: "en",
            thumbnailUrl: "",
            isMature: false,
          }))
        )
      );

      const ids = Array.from({ length: 120 }, (_, index) => `${index + 1}`);
      const result = await twurpleHelixService.getStreamsByUserIds(ids);

      expect(mockStreamsApi.getStreamsByUserIds).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(120);
    });

    it("getStreamsByUserIds returns empty on exception", async () => {
      mockStreamsApi.getStreamsByUserIds.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getStreamsByUserIds(["1"]);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it("isChannelLive returns true only for live stream type", async () => {
      mockStreamsApi.getStreamByUserId.mockResolvedValueOnce({
        id: "s1",
        userId: "1",
        userName: "a",
        userDisplayName: "A",
        gameId: "g1",
        gameName: "G",
        type: "live",
        title: "T",
        viewers: 10,
        startDate: new Date(),
        language: "en",
        thumbnailUrl: "url",
        isMature: false,
      });
      mockStreamsApi.getStreamByUserId.mockResolvedValueOnce({
        id: "s2",
        userId: "2",
        userName: "b",
        userDisplayName: "B",
        gameId: "g1",
        gameName: "G",
        type: "rerun",
        title: "T",
        viewers: 10,
        startDate: new Date(),
        language: "en",
        thumbnailUrl: "url",
        isMature: false,
      });
      mockStreamsApi.getStreamByUserId.mockResolvedValueOnce(null);

      await expect(twurpleHelixService.isChannelLive("1")).resolves.toBe(true);
      await expect(twurpleHelixService.isChannelLive("2")).resolves.toBe(false);
      await expect(twurpleHelixService.isChannelLive("3")).resolves.toBe(false);
    });

    it("getFollowerCount returns fallback 0 on exception", async () => {
      mockChannelsApi.getChannelFollowerCount.mockRejectedValue(new Error("boom"));

      const result = await twurpleHelixService.getFollowerCount("1");

      expect(result).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it("getFollowerCount returns count on success", async () => {
      mockChannelsApi.getChannelFollowerCount.mockResolvedValue(777);

      const result = await twurpleHelixService.getFollowerCount("1");

      expect(result).toBe(777);
    });
  });

  describe("getFollowedChannels", () => {
    it("uses tokenInfo branch and reuses cached RefreshingAuthProvider client", async () => {
      const tokenInfo = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 60_000),
        tokenId: "token-1",
      };

      const follows = [
        {
          broadcasterId: "1",
          broadcasterName: "StreamerOne",
          broadcasterDisplayName: "Streamer One",
          followDate: new Date(),
        },
      ];

      mockChannelsApi.getFollowedChannelsPaginated.mockImplementation(async function* () {
        yield* follows;
      });

      const firstResult = await twurpleHelixService.getFollowedChannels("user-1", undefined, tokenInfo);
      const secondResult = await twurpleHelixService.getFollowedChannels(
        "user-1",
        undefined,
        tokenInfo
      );

      expect(firstResult).toHaveLength(1);
      expect(secondResult).toHaveLength(1);
      expect(mockRefreshingAuthProviderCtor).toHaveBeenCalledTimes(1);
      expect(mockApiClientCtor).toHaveBeenCalledTimes(1);
    });

    it("executes onRefresh callback path for tokenInfo client", async () => {
      const tokenInfo = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(Date.now() + 120_000),
        tokenId: "token-refresh-success",
      };

      await twurpleHelixService.getFollowedChannels("user-refresh", undefined, tokenInfo);

      const authProvider = mockRefreshingAuthProviderCtor.mock.results[0].value as {
        onRefresh: jest.Mock;
      };
      const onRefreshCallback = authProvider.onRefresh.mock.calls[0][0] as (
        userId: string,
        tokenData: { accessToken: string; refreshToken?: string; expiresIn?: number }
      ) => Promise<void>;

      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      await onRefreshCallback("ignored-user", {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 120,
      });
      nowSpy.mockRestore();

      expect(logger.info).toHaveBeenCalledWith(
        "Twurple Helix",
        expect.stringContaining("Token 已自動刷新")
      );
    });

    it("logs error when onRefresh callback fails to update DB", async () => {
      const tokenInfo = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: null,
        tokenId: "token-refresh-error",
      };

      await twurpleHelixService.getFollowedChannels("user-refresh-error", undefined, tokenInfo);

      const authProvider = mockRefreshingAuthProviderCtor.mock.results[0].value as {
        onRefresh: jest.Mock;
      };
      const onRefreshCallback = authProvider.onRefresh.mock.calls[0][0] as (
        userId: string,
        tokenData: { accessToken: string; refreshToken?: string; expiresIn?: number }
      ) => Promise<void>;

      (prisma.twitchToken.update as jest.Mock).mockRejectedValue(new Error("db-failed"));

      await onRefreshCallback("ignored-user", {
        accessToken: "new-access-no-refresh",
      });

      const refreshDbErrorCall = (logger.error as jest.Mock).mock.calls.find(
        (call) => call[1] === "Token 刷新後更新資料庫失敗"
      );
      expect(refreshDbErrorCall).toBeDefined();
      expect(refreshDbErrorCall?.[0]).toBe("Twurple Helix");
      expect(refreshDbErrorCall?.[2]).toBeTruthy();
    });

    it("uses legacy userAccessToken branch and caches by token prefix", async () => {
      const accessToken = "1234567890abcdefXYZ";

      await twurpleHelixService.getFollowedChannels("user-legacy", accessToken);
      await twurpleHelixService.getFollowedChannels("user-legacy", accessToken);

      expect(mockStaticAuthProviderCtor).toHaveBeenCalledTimes(1);
      expect(mockApiClientCtor).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalled();
    });

    it("evicts oldest cached user api client when cache limit exceeded", async () => {
      for (let i = 0; i <= 50; i += 1) {
        await twurpleHelixService.getFollowedChannels("legacy-user", `token-prefix-${i}-abcdefghijkl`);
      }

      expect(mockApiClientCtor).toHaveBeenCalledTimes(51);

      await twurpleHelixService.getFollowedChannels("legacy-user", "token-prefix-0-abcdefghijkl");

      expect(mockApiClientCtor).toHaveBeenCalledTimes(52);
    });

    it("falls back to app client when no user token is provided", async () => {
      await twurpleHelixService.getFollowedChannels("user-app");

      expect((esmImportUtils.importTwurpleApi as jest.Mock).mock.calls.length).toBeGreaterThan(0);
      expect(mockApiClientCtor).toHaveBeenCalled();
    });

    it("stops reading follows when MAX_FOLLOWS is reached", async () => {
      mockChannelsApi.getFollowedChannelsPaginated.mockImplementation(async function* () {
        for (let i = 0; i < 2100; i += 1) {
          yield {
            broadcasterId: `${i}`,
            broadcasterName: `streamer${i}`,
            broadcasterDisplayName: `Streamer ${i}`,
            followDate: new Date(),
          };
        }
      });

      const result = await twurpleHelixService.getFollowedChannels("user-max", "legacy-token-1234567890123456");

      expect(result).toHaveLength(2000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns empty array when paginator creation throws", async () => {
      mockChannelsApi.getFollowedChannelsPaginated.mockImplementation(() => {
        throw new Error("paginator-failed");
      });

      const result = await twurpleHelixService.getFollowedChannels("user-fail", "legacy-token-1234");

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getChannelSnapshotsByIds", () => {
    it("returns empty for empty input", async () => {
      const result = await twurpleHelixService.getChannelSnapshotsByIds([]);

      expect(result).toEqual([]);
      expect(mockUsersApi.getUsersByIds).not.toHaveBeenCalled();
      expect(mockStreamsApi.getStreamsByUserIds).not.toHaveBeenCalled();
    });

    it("fetches snapshots in chunks when ids exceed 100", async () => {
      mockUsersApi.getUsersByIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({
            id,
            name: `user-${id}`,
            displayName: `User ${id}`,
            type: "",
            broadcasterType: "",
            description: "",
            profilePictureUrl: "",
            offlinePlaceholderUrl: "",
            creationDate: new Date(),
          }))
        )
      );

      mockStreamsApi.getStreamsByUserIds.mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids.slice(0, 2).map((id) => ({
            id: `stream-${id}`,
            userId: id,
            userName: `user-${id}`,
            userDisplayName: `User ${id}`,
            gameId: "1",
            gameName: "Game",
            type: "live",
            title: `Title ${id}`,
            viewers: 100,
            startDate: new Date(),
            language: "zh",
            thumbnailUrl: "",
            isMature: false,
          }))
        )
      );

      const ids = [
        ...Array.from({ length: 120 }, (_, index) => `${index + 1}`),
        "1",
        "",
        "2",
      ];
      const result = await twurpleHelixService.getChannelSnapshotsByIds(ids);

      expect(mockUsersApi.getUsersByIds).toHaveBeenCalledTimes(2);
      expect(mockStreamsApi.getStreamsByUserIds).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(120);
      expect(result[0].broadcasterId).toBe("1");
    });

    it("returns empty array on snapshots exception", async () => {
      jest.spyOn(twurpleHelixService, "getUsersByIds").mockRejectedValueOnce(new Error("boom"));

      const result = await twurpleHelixService.getChannelSnapshotsByIds(["1", "2"]);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("health and status", () => {
    it("healthCheck returns false when getUserByLogin throws", async () => {
      jest.spyOn(twurpleHelixService, "getUserByLogin").mockRejectedValueOnce(new Error("boom"));

      await expect(twurpleHelixService.healthCheck()).resolves.toBe(false);
    });

    it("getStatus reflects api client initialization", async () => {
      const before = twurpleHelixService.getStatus();
      expect(before.initialized).toBe(false);

      mockUsersApi.getUserByName.mockResolvedValue(null);
      await twurpleHelixService.getUserByLogin("twitch");

      const after = twurpleHelixService.getStatus();
      expect(after.initialized).toBe(true);
    });
  });
});
