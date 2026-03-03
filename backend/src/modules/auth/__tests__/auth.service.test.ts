import {
  handleStreamerTwitchCallback,
  getStreamerById,
  getStreamerByTwitchId,
  warmupFollowedChannelsCache,
  reinitializeChatServiceAfterLogin,
} from "../auth.service";
import { prisma } from "../../../db/prisma";
import { logger } from "../../../utils/logger";
import { retryDatabaseOperation } from "../../../utils/db-retry";
import { triggerFollowSyncForUser } from "../../../jobs/sync-user-follows.job";
import { exchangeCodeForToken, fetchTwitchUser } from "../twitch-oauth.client";
import { signAccessToken, signRefreshToken } from "../jwt.utils";
import { encryptToken } from "../../../utils/crypto.utils";

jest.mock("../../../config/env", () => ({
  env: {
    twitchRedirectUri: "https://default.example.com/callback",
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../../utils/db-retry", () => ({
  retryDatabaseOperation: jest.fn(),
}));

jest.mock("../../../utils/crypto.utils", () => ({
  encryptToken: jest.fn((token: string) => `enc:${token}`),
}));

jest.mock("../jwt.utils", () => ({
  signAccessToken: jest.fn(() => "signed-access"),
  signRefreshToken: jest.fn(() => "signed-refresh"),
}));

jest.mock("../twitch-oauth.client", () => ({
  exchangeCodeForToken: jest.fn(),
  fetchTwitchUser: jest.fn(),
}));

jest.mock("../../../jobs/sync-user-follows.job", () => ({
  triggerFollowSyncForUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../viewer/viewer.service", () => ({
  getFollowedChannels: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../../services/twitch-chat.service", () => ({
  twurpleChatService: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../../db/prisma", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    streamer: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    viewer: {
      upsert: jest.fn(),
    },
    channel: {
      upsert: jest.fn(),
    },
    twitchToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
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

describe("auth.service", () => {
  const tokenResponse = {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
  };

  const twitchUser = {
    id: "tu-1",
    login: "channel_login",
    display_name: "Channel Display",
    profile_image_url: "https://cdn.example.com/avatar.png",
    email: "streamer@example.com",
  };

  const streamerRecord = {
    id: "streamer-1",
    twitchUserId: "tu-1",
    displayName: "Channel Display",
    avatarUrl: "https://cdn.example.com/avatar.png",
  };

  const viewerRecord = {
    id: "viewer-1",
    twitchUserId: "tu-1",
    displayName: "Channel Display",
    avatarUrl: "https://cdn.example.com/avatar.png",
    consentedAt: new Date("2024-01-02T03:04:05.000Z"),
    consentVersion: 1,
    tokenVersion: 7,
  };

  let nodeEnvSnapshot: string | undefined;

  beforeEach(() => {
    nodeEnvSnapshot = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    jest.clearAllMocks();

    (exchangeCodeForToken as jest.Mock).mockResolvedValue(tokenResponse);
    (fetchTwitchUser as jest.Mock).mockResolvedValue(twitchUser);
    (prisma.streamer.upsert as jest.Mock).mockResolvedValue(streamerRecord);
    (prisma.viewer.upsert as jest.Mock).mockResolvedValue(viewerRecord);
    (prisma.twitchToken.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.twitchToken.create as jest.Mock).mockResolvedValue({ id: "token-1" });
    (prisma.channel.upsert as jest.Mock).mockResolvedValue({ id: "channel-1" });
    (retryDatabaseOperation as jest.Mock).mockImplementation(async (fn: () => Promise<unknown>) =>
      fn()
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = nodeEnvSnapshot;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("handleStreamerTwitchCallback", () => {
    it("returns mapped streamer and deterministic JWTs", async () => {
      const result = await handleStreamerTwitchCallback("oauth-code");

      expect(result).toEqual({
        streamer: {
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Channel Display",
          avatarUrl: "https://cdn.example.com/avatar.png",
          channelUrl: "https://www.twitch.tv/channel_login",
        },
        accessToken: "signed-access",
        refreshToken: "signed-refresh",
      });

      expect(exchangeCodeForToken).toHaveBeenCalledWith("oauth-code", {
        redirectUri: "https://default.example.com/callback",
      });
      expect(fetchTwitchUser).toHaveBeenCalledWith("access-token");
      expect(signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          streamerId: "streamer-1",
          viewerId: "viewer-1",
          role: "streamer",
          consentedAt: "2024-01-02T03:04:05.000Z",
          consentVersion: 1,
          tokenVersion: 7,
        })
      );
      expect(signRefreshToken).toHaveBeenCalledWith(expect.any(Object));
    });

    it("uses provided redirect URI", async () => {
      await handleStreamerTwitchCallback("oauth-code", "https://custom.example.com/callback");

      expect(exchangeCodeForToken).toHaveBeenCalledWith("oauth-code", {
        redirectUri: "https://custom.example.com/callback",
      });
    });

    it("stores encrypted access and refresh tokens with computed expiry", async () => {
      await handleStreamerTwitchCallback("oauth-code");

      expect(encryptToken).toHaveBeenCalledWith("access-token");
      expect(encryptToken).toHaveBeenCalledWith("refresh-token");
      expect(prisma.$transaction).toHaveBeenCalledWith([expect.any(Promise), expect.any(Promise)]);
      expect(prisma.twitchToken.deleteMany).toHaveBeenCalledWith({
        where: {
          streamerId: "streamer-1",
          ownerType: "streamer",
        },
      });
      expect(prisma.twitchToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerType: "streamer",
          streamerId: "streamer-1",
          viewerId: "viewer-1",
          accessToken: "enc:access-token",
          refreshToken: "enc:refresh-token",
          status: "active",
          failureCount: 0,
          expiresAt: new Date("2025-01-01T01:00:00.000Z"),
          scopes: expect.any(String),
        }),
      });
    });

    it("handles null refresh token and null expires_in", async () => {
      (exchangeCodeForToken as jest.Mock).mockResolvedValue({
        access_token: "access-token",
        refresh_token: null,
        expires_in: null,
      });

      await handleStreamerTwitchCallback("oauth-code");

      expect(encryptToken).toHaveBeenCalledTimes(1);
      expect(prisma.twitchToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          refreshToken: null,
          expiresAt: null,
        }),
      });
    });

    it("maps avatar and consent fields when DB records are nullable", async () => {
      (prisma.streamer.upsert as jest.Mock).mockResolvedValue({
        ...streamerRecord,
        avatarUrl: null,
      });
      (prisma.viewer.upsert as jest.Mock).mockResolvedValue({
        ...viewerRecord,
        consentedAt: null,
        consentVersion: null,
      });

      const result = await handleStreamerTwitchCallback("oauth-code");

      expect(result.streamer.avatarUrl).toBe("");
      expect(signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ consentedAt: null, consentVersion: null })
      );
    });

    it("stores null email when Twitch profile email is missing", async () => {
      (fetchTwitchUser as jest.Mock).mockResolvedValueOnce({
        ...twitchUser,
        email: undefined,
      });

      await handleStreamerTwitchCallback("oauth-code");

      expect(prisma.streamer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ email: null }),
          create: expect.objectContaining({ email: null }),
        })
      );
    });

    it("builds channel URL from fallback display_name then twitch-id", async () => {
      (fetchTwitchUser as jest.Mock)
        .mockResolvedValueOnce({
          ...twitchUser,
          login: undefined,
          display_name: "DisplayFallback",
        })
        .mockResolvedValueOnce({
          ...twitchUser,
          id: "tu-999",
          login: undefined,
          display_name: undefined,
        });

      const fromDisplay = await handleStreamerTwitchCallback("oauth-code-1");
      const fromId = await handleStreamerTwitchCallback("oauth-code-2");

      expect(fromDisplay.streamer.channelUrl).toBe("https://www.twitch.tv/DisplayFallback");
      expect(fromId.streamer.channelUrl).toBe("https://www.twitch.tv/twitch-tu-999");
    });

    it("propagates token exchange, user fetch, upsert and transaction failures", async () => {
      (exchangeCodeForToken as jest.Mock).mockRejectedValueOnce(new Error("oauth failed"));
      await expect(handleStreamerTwitchCallback("oauth-code")).rejects.toThrow("oauth failed");

      (exchangeCodeForToken as jest.Mock).mockResolvedValueOnce(tokenResponse);
      (fetchTwitchUser as jest.Mock).mockRejectedValueOnce(new Error("user failed"));
      await expect(handleStreamerTwitchCallback("oauth-code")).rejects.toThrow("user failed");

      (fetchTwitchUser as jest.Mock).mockResolvedValueOnce(twitchUser);
      (prisma.streamer.upsert as jest.Mock).mockRejectedValueOnce(new Error("upsert failed"));
      await expect(handleStreamerTwitchCallback("oauth-code")).rejects.toThrow("upsert failed");

      (prisma.streamer.upsert as jest.Mock).mockResolvedValueOnce(streamerRecord);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error("transaction failed"));
      await expect(handleStreamerTwitchCallback("oauth-code")).rejects.toThrow(
        "transaction failed"
      );
    });

    it("retries channel upsert and then succeeds", async () => {
      (prisma.channel.upsert as jest.Mock)
        .mockRejectedValueOnce(new Error("database is locked"))
        .mockRejectedValueOnce(new Error("busy"))
        .mockResolvedValueOnce({ id: "channel-1" });

      await handleStreamerTwitchCallback("oauth-code");
      await jest.runAllTimersAsync();

      expect(prisma.channel.upsert).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Auth",
        "Channel upserted for Channel Display (attempt 3/5)"
      );
    });

    it("logs permanent error when channel upsert keeps failing", async () => {
      (prisma.channel.upsert as jest.Mock).mockRejectedValue(new Error("timeout"));

      await handleStreamerTwitchCallback("oauth-code");
      await jest.runAllTimersAsync();

      expect(prisma.channel.upsert).toHaveBeenCalledTimes(5);
      expect(logger.error).toHaveBeenCalledWith(
        "Auth",
        "Channel upsert permanently failed after 5 attempts",
        expect.any(Error)
      );
    });

    it("passes lock-contention classifier to retry utility", async () => {
      (retryDatabaseOperation as jest.Mock).mockImplementationOnce(
        async (fn: () => Promise<unknown>, options: { shouldRetry: (e: unknown) => boolean }) => {
          expect(options.shouldRetry(new Error("database is locked"))).toBe(true);
          expect(options.shouldRetry(new Error("busy"))).toBe(true);
          expect(options.shouldRetry(new Error("timeout"))).toBe(true);
          expect(options.shouldRetry(new Error("P2028"))).toBe(true);
          expect(options.shouldRetry(new Error("transaction not found"))).toBe(true);
          expect(options.shouldRetry(new Error("other message"))).toBe(false);
          expect(options.shouldRetry("non-error value")).toBe(false);
          return fn();
        }
      );

      await handleStreamerTwitchCallback("oauth-code");
      await jest.runAllTimersAsync();
    });

    // Keep follow-sync and chat-reinit assertions in separate tests to avoid timer-order flakiness.
    it("maps follow sync failure to logger.error in non-test mode", async () => {
      process.env.NODE_ENV = "production";
      (triggerFollowSyncForUser as jest.Mock).mockRejectedValueOnce(new Error("follow failed"));

      await handleStreamerTwitchCallback("oauth-code");
      await jest.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      expect(triggerFollowSyncForUser).toHaveBeenCalledWith("viewer-1", "access-token");
      expect(logger.error).toHaveBeenCalledWith(
        "Auth",
        "Follow sync failed after login",
        expect.any(Error)
      );
    });

    it("logs chat reinit failure when initialize rejects", async () => {
      const initialize = jest.fn().mockRejectedValue(new Error("chat failed"));

      reinitializeChatServiceAfterLogin(async () => ({
        twurpleChatService: {
          initialize,
        },
      }));

      await Promise.resolve();
      await Promise.resolve();

      expect(initialize).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Auth",
        "Chat service reinit failed after login",
        expect.any(Error)
      );
    });

    it("logs loader-throw failures for warmup and chat reinit branches", async () => {
      warmupFollowedChannelsCache("viewer-1", () => {
        throw new Error("viewer require failed");
      });

      reinitializeChatServiceAfterLogin(() => {
        throw new Error("chat require failed");
      });

      await jest.runAllTimersAsync();

      expect(logger.error).toHaveBeenCalledWith(
        "Auth",
        "Cache warmup failed after login",
        expect.objectContaining({ message: "viewer require failed" })
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Auth",
        "Chat service reinit failed after login",
        expect.objectContaining({ message: "chat require failed" })
      );
    });
  });

  describe("getStreamerById", () => {
    it("returns null when streamer does not exist", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getStreamerById("missing-id")).resolves.toBeNull();
      expect(prisma.streamer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "missing-id" } })
      );
    });

    it("returns DB channel URL when present", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "streamer-1",
        twitchUserId: "tu-1",
        displayName: "Display",
        avatarUrl: "https://cdn.example.com/avatar.png",
        channels: [{ channelUrl: "https://www.twitch.tv/db-url", channelName: "ignored" }],
      });

      const result = await getStreamerById("streamer-1");
      expect(result?.channelUrl).toBe("https://www.twitch.tv/db-url");
    });

    it("falls back to channelName and empty avatar/url values", async () => {
      (prisma.streamer.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Display",
          avatarUrl: null,
          channels: [{ channelUrl: null, channelName: "fallback-name" }],
        })
        .mockResolvedValueOnce({
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Display",
          avatarUrl: null,
          channels: [],
        });

      const fromChannelName = await getStreamerById("streamer-1");
      const noChannel = await getStreamerById("streamer-1");

      expect(fromChannelName?.avatarUrl).toBe("");
      expect(fromChannelName?.channelUrl).toBe("https://www.twitch.tv/fallback-name");
      expect(noChannel?.channelUrl).toBe("https://www.twitch.tv/");
    });
  });

  describe("getStreamerByTwitchId", () => {
    it("returns null when streamer does not exist", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getStreamerByTwitchId("missing-twitch-id")).resolves.toBeNull();
      expect(prisma.streamer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { twitchUserId: "missing-twitch-id" } })
      );
    });

    it("returns DB channel URL and falls back to channelName or empty URL", async () => {
      (prisma.streamer.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Display",
          avatarUrl: "https://cdn.example.com/avatar.png",
          channels: [{ channelUrl: "https://www.twitch.tv/db-url", channelName: "ignored" }],
        })
        .mockResolvedValueOnce({
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Display",
          avatarUrl: null,
          channels: [{ channelName: "fallback-name" }],
        })
        .mockResolvedValueOnce({
          id: "streamer-1",
          twitchUserId: "tu-1",
          displayName: "Display",
          avatarUrl: null,
          channels: [],
        });

      const withDbUrl = await getStreamerByTwitchId("tu-1");
      const withFallback = await getStreamerByTwitchId("tu-1");
      const withEmptyChannel = await getStreamerByTwitchId("tu-1");

      expect(withDbUrl?.channelUrl).toBe("https://www.twitch.tv/db-url");
      expect(withFallback?.channelUrl).toBe("https://www.twitch.tv/fallback-name");
      expect(withFallback?.avatarUrl).toBe("");
      expect(withEmptyChannel?.channelUrl).toBe("https://www.twitch.tv/");
    });
  });
});
