import { EventSubService, eventSubService, EVENTSUB_TYPES, SUBSCRIPTION_STATUS } from "../eventsub.service";
import { prisma } from "../../db/prisma";

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      findUnique: jest.fn(),
    },
    streamSession: {
      create: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("EventSubService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== constants ==========

  describe("EVENTSUB_TYPES constants", () => {
    it("should have expected event type values", () => {
      expect(EVENTSUB_TYPES.STREAM_ONLINE).toBe("stream.online");
      expect(EVENTSUB_TYPES.STREAM_OFFLINE).toBe("stream.offline");
      expect(EVENTSUB_TYPES.CHANNEL_UPDATE).toBe("channel.update");
      expect(EVENTSUB_TYPES.CHANNEL_FOLLOW).toBe("channel.follow");
      expect(EVENTSUB_TYPES.CHANNEL_SUBSCRIBE).toBe("channel.subscribe");
      expect(EVENTSUB_TYPES.CHANNEL_CHEER).toBe("channel.cheer");
    });
  });

  describe("SUBSCRIPTION_STATUS constants", () => {
    it("should have expected status values", () => {
      expect(SUBSCRIPTION_STATUS.ENABLED).toBe("enabled");
      expect(SUBSCRIPTION_STATUS.PENDING).toBe("webhook_callback_verification_pending");
      expect(SUBSCRIPTION_STATUS.FAILED).toBe("webhook_callback_verification_failed");
      expect(SUBSCRIPTION_STATUS.REVOKED).toBe("authorization_revoked");
      expect(SUBSCRIPTION_STATUS.USER_REMOVED).toBe("user_removed");
    });
  });

  // ========== handleStreamOnline ==========

  describe("handleStreamOnline", () => {
    it("should create a stream session via create when upsert is unavailable", async () => {
      const mockEvent = {
        id: "ev1",
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
        type: "live" as const,
        started_at: "2025-12-18T00:00:00Z",
      };

      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({
        id: "c1",
        channelName: "User",
      });
      // Simulate upsert not being a function (fallback to create)
      (prisma.streamSession as any).upsert = undefined;

      await eventSubService.handleStreamOnline(mockEvent);

      expect(prisma.streamSession.create).toHaveBeenCalledWith({
        data: {
          channelId: "c1",
          startedAt: expect.any(Date),
          title: "",
          category: "",
        },
      });
    });

    it("should use upsert when upsert is available", async () => {
      const mockEvent = {
        id: "ev1",
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
        type: "live" as const,
        started_at: "2025-12-18T00:00:00Z",
      };

      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({
        id: "c1",
        channelName: "User",
      });
      // Restore upsert as a function
      (prisma.streamSession as any).upsert = jest.fn().mockResolvedValue({});

      await eventSubService.handleStreamOnline(mockEvent);

      expect((prisma.streamSession as any).upsert).toHaveBeenCalledWith({
        where: { twitchStreamId: "ev1" },
        create: {
          channelId: "c1",
          twitchStreamId: "ev1",
          startedAt: expect.any(Date),
          title: "",
          category: "",
        },
        update: {
          channelId: "c1",
          startedAt: expect.any(Date),
        },
      });
    });

    it("should skip if channel not found", async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.streamSession as any).upsert = undefined;

      await eventSubService.handleStreamOnline({
        broadcaster_user_id: "999",
        broadcaster_user_name: "Unknown",
      } as any);

      expect(prisma.streamSession.create).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      const mockEvent = {
        id: "ev1",
        broadcaster_user_id: "123",
        broadcaster_user_name: "User",
        type: "live" as const,
        started_at: "2025-12-18T00:00:00Z",
      };

      (prisma.channel.findUnique as jest.Mock).mockRejectedValue(new Error("DB error"));

      // Should not throw - errors are caught internally
      await expect(eventSubService.handleStreamOnline(mockEvent as any)).resolves.not.toThrow();
    });
  });

  // ========== handleStreamOffline ==========

  describe("handleStreamOffline", () => {
    it("should end session if exists", async () => {
      const mockEvent = {
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
      };

      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "c1", channelName: "User" });
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt: new Date(Date.now() - 3600000),
      });

      await eventSubService.handleStreamOffline(mockEvent);

      expect(prisma.streamSession.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: {
          endedAt: expect.any(Date),
          durationSeconds: expect.any(Number),
        },
      });
    });

    it("should skip if channel not found", async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);

      await eventSubService.handleStreamOffline({
        broadcaster_user_id: "999",
        broadcaster_user_login: "unknown",
        broadcaster_user_name: "Unknown",
      });

      expect(prisma.streamSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.streamSession.update).not.toHaveBeenCalled();
    });

    it("should skip if no active session found", async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "c1", channelName: "User" });
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);

      await eventSubService.handleStreamOffline({
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
      });

      expect(prisma.streamSession.update).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      (prisma.channel.findUnique as jest.Mock).mockRejectedValue(new Error("DB error"));

      await expect(
        eventSubService.handleStreamOffline({
          broadcaster_user_id: "123",
          broadcaster_user_login: "user",
          broadcaster_user_name: "User",
        })
      ).resolves.not.toThrow();
    });

    it("should calculate duration correctly", async () => {
      const startedAt = new Date(Date.now() - 7200000); // 2 hours ago

      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "c1", channelName: "User" });
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        startedAt,
      });

      await eventSubService.handleStreamOffline({
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
      });

      const call = (prisma.streamSession.update as jest.Mock).mock.calls[0];
      const durationSeconds = call[0].data.durationSeconds;
      expect(durationSeconds).toBeGreaterThanOrEqual(7100); // approximately 2 hours
    });
  });

  // ========== handleChannelUpdate ==========

  describe("handleChannelUpdate", () => {
    it("should update session title if active session exists", async () => {
      const mockEvent = {
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
        title: "New Title",
        language: "zh",
        category_id: "cat1",
        category_name: "Scary Games",
        content_classification_labels: [],
      };

      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
        channel: { id: "c1", channelName: "User" },
      });

      await eventSubService.handleChannelUpdate(mockEvent);

      expect(prisma.streamSession.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: {
          title: "New Title",
          category: "Scary Games",
        },
      });
    });

    it("should skip if channel not found", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);

      await eventSubService.handleChannelUpdate({
        broadcaster_user_id: "999",
        broadcaster_user_login: "unknown",
        broadcaster_user_name: "Unknown",
        title: "Title",
        language: "en",
        category_id: "cat",
        category_name: "Category",
        content_classification_labels: [],
      });

      expect(prisma.streamSession.findFirst).toHaveBeenCalled();
      expect(prisma.streamSession.update).not.toHaveBeenCalled();
    });

    it("should skip update if no active session", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);

      await eventSubService.handleChannelUpdate({
        broadcaster_user_id: "123",
        broadcaster_user_login: "user",
        broadcaster_user_name: "User",
        title: "Title",
        language: "en",
        category_id: "cat",
        category_name: "Category",
        content_classification_labels: [],
      });

      expect(prisma.streamSession.update).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      (prisma.streamSession.findFirst as jest.Mock).mockRejectedValue(new Error("DB error"));

      await expect(
        eventSubService.handleChannelUpdate({
          broadcaster_user_id: "123",
          broadcaster_user_login: "user",
          broadcaster_user_name: "User",
          title: "Title",
          language: "en",
          category_id: "cat",
          category_name: "Category",
          content_classification_labels: [],
        })
      ).resolves.not.toThrow();
    });
  });

  // ========== handleSubscription ==========

  describe("handleSubscription", () => {
    it("should handle subscription event without throwing", async () => {
      const mockEvent = {
        user_id: "u1",
        user_login: "user1",
        user_name: "User1",
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        tier: "1000" as const,
        is_gift: false,
      };

      await expect(eventSubService.handleSubscription(mockEvent)).resolves.not.toThrow();
    });

    it("should handle gifted subscription", async () => {
      const mockEvent = {
        user_id: "u2",
        user_login: "gifter",
        user_name: "Gifter",
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        tier: "2000" as const,
        is_gift: true,
      };

      await expect(eventSubService.handleSubscription(mockEvent)).resolves.not.toThrow();
    });

    it("should handle Tier 3 subscription", async () => {
      const mockEvent = {
        user_id: "u3",
        user_login: "whale",
        user_name: "Whale",
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        tier: "3000" as const,
        is_gift: false,
      };

      await expect(eventSubService.handleSubscription(mockEvent)).resolves.not.toThrow();
    });
  });

  // ========== handleCheer ==========

  describe("handleCheer", () => {
    it("should handle cheer event from named user without throwing", async () => {
      const mockEvent = {
        is_anonymous: false,
        user_id: "u1",
        user_login: "user1",
        user_name: "User1",
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        message: "Cheer100 awesome stream!",
        bits: 100,
      };

      await expect(eventSubService.handleCheer(mockEvent)).resolves.not.toThrow();
    });

    it("should handle anonymous cheer event", async () => {
      const mockEvent = {
        is_anonymous: true,
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        message: "Cheer500",
        bits: 500,
      };

      await expect(eventSubService.handleCheer(mockEvent)).resolves.not.toThrow();
    });

    it("should handle large cheer (bits)", async () => {
      const mockEvent = {
        is_anonymous: false,
        user_id: "whale1",
        user_login: "whale1",
        user_name: "Whale1",
        broadcaster_user_id: "b1",
        broadcaster_user_login: "broadcaster",
        broadcaster_user_name: "Broadcaster",
        message: "Cheer10000",
        bits: 10000,
      };

      await expect(eventSubService.handleCheer(mockEvent)).resolves.not.toThrow();
    });
  });

  // ========== constructor ==========

  describe("EventSubService constructor", () => {
    it("should warn when EVENTSUB_CALLBACK_URL is not set", () => {
      const { logger } = jest.requireMock("../../utils/logger");
      const original = process.env.EVENTSUB_CALLBACK_URL;
      delete process.env.EVENTSUB_CALLBACK_URL;

      new EventSubService();

      expect(logger.warn).toHaveBeenCalledWith(
        "EventSub",
        "EVENTSUB_CALLBACK_URL 未設定，EventSub 功能將無法使用"
      );

      process.env.EVENTSUB_CALLBACK_URL = original;
    });

    it("should not warn when EVENTSUB_CALLBACK_URL is set", () => {
      const { logger } = jest.requireMock("../../utils/logger");
      process.env.EVENTSUB_CALLBACK_URL = "https://example.com/eventsub";

      new EventSubService();

      expect(logger.warn).not.toHaveBeenCalledWith(
        "EventSub",
        "EVENTSUB_CALLBACK_URL 未設定，EventSub 功能將無法使用"
      );

      delete process.env.EVENTSUB_CALLBACK_URL;
    });
  });

  // ========== singleton export ==========

  describe("eventSubService singleton", () => {
    it("should export a singleton instance", () => {
      expect(eventSubService).toBeInstanceOf(EventSubService);
    });
  });
});
