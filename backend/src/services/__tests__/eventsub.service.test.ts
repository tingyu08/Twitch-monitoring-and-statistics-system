import { eventSubService } from "../eventsub.service";
import { prisma } from "../../db/prisma";

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: {
      findUnique: jest.fn(),
    },
    streamSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

describe("EventSubService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleStreamOnline", () => {
    it("should create a stream session if channel exists", async () => {
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

    it("should skip if channel not found", async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);
      await eventSubService.handleStreamOnline({
        broadcaster_user_id: "999",
      } as any);
      expect(prisma.streamSession.create).not.toHaveBeenCalled();
    });
  });

  describe("handleStreamOffline", () => {
    it("should end session if exists", async () => {
      const mockEvent = {
        broadcaster_user_id: "123",
        broadcaster_user_name: "User",
      } as any;
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "c1" });
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
  });

  describe("handleChannelUpdate", () => {
    it("should update session title if exists", async () => {
      const mockEvent = {
        broadcaster_user_id: "123",
        title: "New Title",
        category_name: "Scary Games",
      } as any;
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: "c1" });
      (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
        id: "s1",
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
  });
});
