import {
  handleStreamerTwitchCallback,
  getStreamerById,
  getStreamerByTwitchId,
} from "../auth.service";
import * as twitchOAuthClient from "../twitch-oauth.client";
import { prisma } from "../../../db/prisma";

// Mock heavy side-effect modules
jest.mock("../../../jobs/sync-user-follows.job", () => ({
  triggerFollowSyncForUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn().mockImplementation((fn: () => unknown) => fn()),
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../../utils/crypto.utils", () => ({
  encryptToken: jest.fn().mockReturnValue("encrypted_token"),
  decryptToken: jest.fn().mockReturnValue("decrypted_token"),
}));

// Mock dependencies
jest.mock("../twitch-oauth.client");
jest.mock("../../../db/prisma", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    streamer: { upsert: jest.fn(), findUnique: jest.fn() },
    channel: { upsert: jest.fn(), findFirst: jest.fn() },
    viewer: { upsert: jest.fn(), findUnique: jest.fn() },
    twitchToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  mockPrisma.$transaction.mockImplementation((arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    if (typeof arg === "function") {
      return arg(mockPrisma);
    }
    return Promise.resolve(arg);
  });
  return { prisma: mockPrisma };
});

describe("Auth Service", () => {
  const mockTokenResponse = {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
  };

  const mockTwitchUser = {
    id: "t123",
    login: "user1",
    display_name: "User One",
    profile_image_url: "http://example.com/avatar.png",
    email: "user@example.com",
  };

  const mockStreamerRecord = {
    id: "s1",
    twitchUserId: "t123",
    displayName: "User One",
    avatarUrl: "http://example.com/avatar.png",
  };

  const mockViewerRecord = {
    id: "v1",
    twitchUserId: "t123",
    consentedAt: new Date("2024-01-01"),
    consentVersion: 1,
    tokenVersion: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default happy path mocks
    (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(mockTokenResponse);
    (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(mockTwitchUser);
    (prisma.streamer.upsert as jest.Mock).mockResolvedValue(mockStreamerRecord);
    (prisma.viewer.upsert as jest.Mock).mockResolvedValue(mockViewerRecord);
    (prisma.twitchToken.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.twitchToken.create as jest.Mock).mockResolvedValue({ id: "tok1" });
    (prisma.channel.upsert as jest.Mock).mockResolvedValue({ id: "ch1" });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("handleStreamerTwitchCallback", () => {
    it("should handle streamer callback and return tokens with correct shape", async () => {
      const res = await handleStreamerTwitchCallback("auth_code");

      expect(res).toHaveProperty("streamer");
      expect(res).toHaveProperty("accessToken");
      expect(res).toHaveProperty("refreshToken");
      expect(res.streamer.id).toBe("s1");
      expect(res.streamer.twitchUserId).toBe("t123");
      expect(res.streamer.displayName).toBe("User One");
    });

    it("should call exchangeCodeForToken with provided code", async () => {
      await handleStreamerTwitchCallback("test_code");
      expect(twitchOAuthClient.exchangeCodeForToken).toHaveBeenCalledWith(
        "test_code",
        expect.any(Object)
      );
    });

    it("should call exchangeCodeForToken with custom redirectUri when provided", async () => {
      await handleStreamerTwitchCallback("test_code", "https://custom.example.com/callback");
      expect(twitchOAuthClient.exchangeCodeForToken).toHaveBeenCalledWith(
        "test_code",
        expect.objectContaining({ redirectUri: "https://custom.example.com/callback" })
      );
    });

    it("should upsert both streamer and viewer records", async () => {
      await handleStreamerTwitchCallback("code");
      expect(prisma.streamer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { twitchUserId: "t123" },
          create: expect.objectContaining({ displayName: "User One" }),
          update: expect.objectContaining({ displayName: "User One" }),
        })
      );
      expect(prisma.viewer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { twitchUserId: "t123" },
        })
      );
    });

    it("should encrypt tokens before storing them", async () => {
      const { encryptToken } = jest.requireMock("../../../utils/crypto.utils");
      await handleStreamerTwitchCallback("code");
      expect(encryptToken).toHaveBeenCalledWith("at"); // access_token
      expect(encryptToken).toHaveBeenCalledWith("rt"); // refresh_token
    });

    it("should delete old tokens and create new one via $transaction", async () => {
      await handleStreamerTwitchCallback("code");
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.twitchToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            streamerId: "s1",
            ownerType: "streamer",
          }),
        })
      );
      expect(prisma.twitchToken.create).toHaveBeenCalled();
    });

    it("should compute channelUrl from user.login", async () => {
      const res = await handleStreamerTwitchCallback("code");
      expect(res.streamer.channelUrl).toBe("https://www.twitch.tv/user1");
    });

    it("should fallback channelUrl to display_name when login is missing", async () => {
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue({
        ...mockTwitchUser,
        login: undefined,
        display_name: "FallbackUser",
      });
      const res = await handleStreamerTwitchCallback("code");
      expect(res.streamer.channelUrl).toBe("https://www.twitch.tv/FallbackUser");
    });

    it("should fallback channelUrl to twitch-{id} when both login and display_name are missing", async () => {
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue({
        id: "t999",
        login: undefined,
        display_name: undefined,
        profile_image_url: "",
      });
      const res = await handleStreamerTwitchCallback("code");
      expect(res.streamer.channelUrl).toContain("twitch-t999");
    });

    it("should handle null refresh_token (no refresh token in response)", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue({
        access_token: "at",
        refresh_token: null,
        expires_in: 3600,
      });
      const { encryptToken } = jest.requireMock("../../../utils/crypto.utils");
      await handleStreamerTwitchCallback("code");
      // encryptToken should only be called once for access_token
      expect(encryptToken).toHaveBeenCalledTimes(1);
    });

    it("should handle missing expires_in (null expiresAt)", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue({
        access_token: "at",
        refresh_token: "rt",
        expires_in: null,
      });
      // Should not throw
      const res = await handleStreamerTwitchCallback("code");
      expect(res.streamer.id).toBe("s1");
    });

    it("should handle viewer with null consentedAt", async () => {
      (prisma.viewer.upsert as jest.Mock).mockResolvedValue({
        id: "v1",
        consentedAt: null,
        consentVersion: null,
        tokenVersion: 1,
      });
      const res = await handleStreamerTwitchCallback("code");
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
    });

    it("should return empty avatarUrl when avatarUrl is null in streamer record", async () => {
      (prisma.streamer.upsert as jest.Mock).mockResolvedValue({
        ...mockStreamerRecord,
        avatarUrl: null,
      });
      const res = await handleStreamerTwitchCallback("code");
      expect(res.streamer.avatarUrl).toBe("");
    });

    it("should throw if exchangeCodeForToken fails", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockRejectedValue(
        new Error("Twitch API error")
      );
      await expect(handleStreamerTwitchCallback("code")).rejects.toThrow("Twitch API error");
    });

    it("should throw if fetchTwitchUser fails", async () => {
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockRejectedValue(
        new Error("User fetch failed")
      );
      await expect(handleStreamerTwitchCallback("code")).rejects.toThrow("User fetch failed");
    });

    it("should throw if prisma streamer upsert fails", async () => {
      (prisma.streamer.upsert as jest.Mock).mockRejectedValue(new Error("DB error"));
      await expect(handleStreamerTwitchCallback("code")).rejects.toThrow("DB error");
    });

    it("should schedule setImmediate for channel upsert without blocking response", async () => {
      const setImmediateSpy = jest.spyOn(global, "setImmediate");
      await handleStreamerTwitchCallback("code");
      expect(setImmediateSpy).toHaveBeenCalled();
      setImmediateSpy.mockRestore();
    });
  });

  describe("getStreamerById", () => {
    it("should return streamer with channelUrl when channel exists", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "Display",
        avatarUrl: "http://avatar.url",
        channels: [{ channelUrl: "https://www.twitch.tv/user1", channelName: "user1" }],
      });
      const res = await getStreamerById("s1");
      expect(res?.id).toBe("s1");
      expect(res?.channelUrl).toBe("https://www.twitch.tv/user1");
    });

    it("should return null if streamer not found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerById("nonexistent");
      expect(res).toBeNull();
    });

    it("should return empty string for avatarUrl when null", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [{ channelUrl: "https://www.twitch.tv/user1" }],
      });
      const res = await getStreamerById("s1");
      expect(res?.avatarUrl).toBe("");
    });

    it("should fallback channelUrl using channelName when channelUrl is missing", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [{ channelUrl: null, channelName: "mystreamer" }],
      });
      const res = await getStreamerById("s1");
      expect(res?.channelUrl).toBe("https://www.twitch.tv/mystreamer");
    });

    it("should produce empty channelUrl when channel list is empty", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [],
      });
      const res = await getStreamerById("s1");
      // channel is undefined -> channelUrl should fall back gracefully
      expect(res?.channelUrl).toBeDefined();
    });

    it("should call findUnique with correct streamerId", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      await getStreamerById("specific-id");
      expect(prisma.streamer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "specific-id" } })
      );
    });
  });

  describe("getStreamerByTwitchId", () => {
    it("should return streamer with channelUrl when channel exists", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: "http://avatar.url",
        channels: [{ channelUrl: "https://www.twitch.tv/streamer" }],
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.channelUrl).toBe("https://www.twitch.tv/streamer");
    });

    it("should return null if not found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerByTwitchId("t_unknown");
      expect(res).toBeNull();
    });

    it("should fallback channelUrl using channelName when channelUrl is missing", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [{ channelName: "user1" }],
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.channelUrl).toBe("https://www.twitch.tv/user1");
    });

    it("should generate fallback url when no channels present", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [],
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.channelUrl).toContain("twitch.tv");
    });

    it("should return empty string for avatarUrl when null", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        avatarUrl: null,
        channels: [],
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.avatarUrl).toBe("");
    });

    it("should call findUnique with correct twitchUserId", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      await getStreamerByTwitchId("twitch-999");
      expect(prisma.streamer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { twitchUserId: "twitch-999" } })
      );
    });
  });
});

describe("handleStreamerTwitchCallback - additional error paths", () => {
  const twitchOAuth = jest.requireMock("../twitch-oauth.client") as {
    exchangeCodeForToken: jest.Mock;
    fetchTwitchUser: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === "function") return (arg as (p: unknown) => unknown)(prisma);
      return Promise.resolve();
    });
    (prisma.streamer.upsert as jest.Mock).mockResolvedValue({
      id: "s1", twitchUserId: "t1", displayName: "Test", avatarUrl: null,
      channels: [{ channelUrl: "https://www.twitch.tv/test" }],
    });
    (prisma.viewer.upsert as jest.Mock).mockResolvedValue({ id: "v1", twitchUserId: "t1" });
    (prisma.channel.upsert as jest.Mock).mockResolvedValue({ id: "c1" });
    (prisma.channel.findFirst as jest.Mock).mockResolvedValue({ id: "c1" });
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.twitchToken.create as jest.Mock).mockResolvedValue({});
    (prisma.twitchToken.update as jest.Mock).mockResolvedValue({});
    (prisma.twitchToken.deleteMany as jest.Mock).mockResolvedValue({});
  });

  it("should throw if exchangeCodeForToken fails", async () => {
    twitchOAuth.exchangeCodeForToken.mockRejectedValue(new Error("OAuth failed"));
    await expect(handleStreamerTwitchCallback("bad-code")).rejects.toThrow("OAuth failed");
  });

  it("should throw if fetchTwitchUser fails", async () => {
    twitchOAuth.exchangeCodeForToken.mockResolvedValue({
      access_token: "at", refresh_token: "rt", expires_in: 3600,
    });
    twitchOAuth.fetchTwitchUser.mockRejectedValue(new Error("User fetch failed"));
    await expect(handleStreamerTwitchCallback("code")).rejects.toThrow("User fetch failed");
  });

  it("should use custom redirectUri when provided", async () => {
    twitchOAuth.exchangeCodeForToken.mockResolvedValue({
      access_token: "at", refresh_token: "rt", expires_in: 3600,
    });
    twitchOAuth.fetchTwitchUser.mockResolvedValue({
      id: "t1", login: "testuser", display_name: "Test", email: "test@test.com",
    });
    (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({ id: "tok1" });

    await handleStreamerTwitchCallback("code", "https://custom.redirect/callback");

    expect(twitchOAuth.exchangeCodeForToken).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ redirectUri: "https://custom.redirect/callback" })
    );
  });
});
