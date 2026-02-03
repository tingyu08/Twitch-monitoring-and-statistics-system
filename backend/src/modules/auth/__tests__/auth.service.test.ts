import {
  handleStreamerTwitchCallback,
  getStreamerById,
  getStreamerByTwitchId,
} from "../auth.service";
import * as twitchOAuthClient from "../twitch-oauth.client";
import { prisma } from "../../../db/prisma";

// Mock dependencies
jest.mock("../twitch-oauth.client");
jest.mock("../../../db/prisma", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    streamer: { upsert: jest.fn(), findUnique: jest.fn() },
    channel: { upsert: jest.fn() },
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
    profile_image_url: "url",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleStreamerTwitchCallback", () => {
    it("should handle streamer callback and return tokens", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(mockTokenResponse);
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(mockTwitchUser);

      (prisma.streamer.upsert as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t123",
        displayName: "User One",
      });
      (prisma.viewer.upsert as jest.Mock).mockResolvedValue({
        id: "v1",
        consentedAt: new Date(),
      });
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await handleStreamerTwitchCallback("code");

      expect(res.streamer.id).toBe("s1");
      expect(prisma.twitchToken.create).toHaveBeenCalled();
    });

    it("should update token if already exists", async () => {
      (twitchOAuthClient.exchangeCodeForToken as jest.Mock).mockResolvedValue(mockTokenResponse);
      (twitchOAuthClient.fetchTwitchUser as jest.Mock).mockResolvedValue(mockTwitchUser);
      (prisma.streamer.upsert as jest.Mock).mockResolvedValue({ id: "s1" });
      (prisma.viewer.upsert as jest.Mock).mockResolvedValue({ id: "v1" });
      (prisma.twitchToken.findFirst as jest.Mock).mockResolvedValue({
        id: "token1",
      });

      await handleStreamerTwitchCallback("code");
      expect(prisma.twitchToken.deleteMany).toHaveBeenCalled();
      expect(prisma.twitchToken.create).toHaveBeenCalled();
    });
  });

  describe("getStreamerById", () => {
    it("should return streamer if found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        channels: [{ channelUrl: "url" }],
      });
      const res = await getStreamerById("s1");
      expect(res?.id).toBe("s1");
    });

    it("should return null if not found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerById("s1");
      expect(res).toBeNull();
    });
  });

  describe("getStreamerByTwitchId", () => {
    it("should return streamer if found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        channels: [],
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.channelUrl).toContain("twitch.tv");
    });

    it("should return null if not found", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue(null);
      const res = await getStreamerByTwitchId("t1");
      expect(res).toBeNull();
    });

    it("should handle missing channel url and fallback to generated url", async () => {
      (prisma.streamer.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        twitchUserId: "t1",
        displayName: "D",
        channels: [{ channelName: "user1" }], // channelUrl is missing
      });
      const res = await getStreamerByTwitchId("t1");
      expect(res?.channelUrl).toBe("https://www.twitch.tv/user1");
    });
  });
});
