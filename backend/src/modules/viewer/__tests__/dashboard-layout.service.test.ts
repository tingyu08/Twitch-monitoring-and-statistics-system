jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewerDashboardLayout: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "../../../db/prisma";
import { DashboardLayoutService } from "../dashboard-layout.service";

describe("DashboardLayoutService", () => {
  const service = new DashboardLayoutService();

  const viewerId = "viewer-1";
  const channelId = "channel-1";

  const validLayout = [
    {
      i: "card-1",
      x: 0,
      y: 0,
      w: 2,
      h: 3,
      minW: 1,
      maxW: 4,
      minH: 1,
      maxH: 6,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getLayout", () => {
    it("returns null when no stored layout exists", async () => {
      (prisma.viewerDashboardLayout.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getLayout(viewerId, channelId);

      expect(prisma.viewerDashboardLayout.findUnique).toHaveBeenCalledWith({
        where: { viewerId_channelId: { viewerId, channelId } },
      });
      expect(result).toBeNull();
    });

    it("returns validated layout when stored JSON is valid", async () => {
      (prisma.viewerDashboardLayout.findUnique as jest.Mock).mockResolvedValue({
        layout: JSON.stringify(validLayout),
      });

      const result = await service.getLayout(viewerId, channelId);

      expect(result).toEqual(validLayout);
    });

    it("returns null when stored JSON cannot be parsed", async () => {
      (prisma.viewerDashboardLayout.findUnique as jest.Mock).mockResolvedValue({
        layout: "{not-json}",
      });

      const result = await service.getLayout(viewerId, channelId);

      expect(result).toBeNull();
    });

    it("returns null when stored layout fails schema validation", async () => {
      (prisma.viewerDashboardLayout.findUnique as jest.Mock).mockResolvedValue({
        layout: JSON.stringify([{ i: "bad", x: 0, y: 0, w: 0, h: 1 }]),
      });

      const result = await service.getLayout(viewerId, channelId);

      expect(result).toBeNull();
    });
  });

  describe("saveLayout", () => {
    it("validates and upserts serialized layout", async () => {
      const persisted = {
        viewerId,
        channelId,
        layout: JSON.stringify(validLayout),
      };
      (prisma.viewerDashboardLayout.upsert as jest.Mock).mockResolvedValue(persisted);

      const result = await service.saveLayout(viewerId, channelId, validLayout);

      expect(prisma.viewerDashboardLayout.upsert).toHaveBeenCalledWith({
        where: { viewerId_channelId: { viewerId, channelId } },
        create: {
          viewerId,
          channelId,
          layout: JSON.stringify(validLayout),
        },
        update: {
          layout: JSON.stringify(validLayout),
        },
      });
      expect(result).toBe(persisted);
    });

    it("strips unknown fields before persisting", async () => {
      const layoutWithExtraField = [
        {
          i: "card-1",
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          extra: "drop-me",
        },
      ];
      (prisma.viewerDashboardLayout.upsert as jest.Mock).mockResolvedValue({ id: "row-1" });

      await service.saveLayout(viewerId, channelId, layoutWithExtraField);

      expect(prisma.viewerDashboardLayout.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            layout: JSON.stringify([{ i: "card-1", x: 1, y: 2, w: 3, h: 4 }]),
          }),
        })
      );
    });

    it("throws when layout payload is invalid", async () => {
      await expect(
        service.saveLayout(viewerId, channelId, [{ i: "bad", x: 0, y: 0, w: 0, h: 1 }])
      ).rejects.toThrow();

      expect(prisma.viewerDashboardLayout.upsert).not.toHaveBeenCalled();
    });
  });

  describe("resetLayout", () => {
    it("deletes saved layout for viewer and channel", async () => {
      const deleted = { viewerId, channelId, layout: "[]" };
      (prisma.viewerDashboardLayout.delete as jest.Mock).mockResolvedValue(deleted);

      const result = await service.resetLayout(viewerId, channelId);

      expect(prisma.viewerDashboardLayout.delete).toHaveBeenCalledWith({
        where: { viewerId_channelId: { viewerId, channelId } },
      });
      expect(result).toBe(deleted);
    });

    it("maps delete failures to a stable error", async () => {
      (prisma.viewerDashboardLayout.delete as jest.Mock).mockRejectedValue(new Error("db fail"));

      await expect(service.resetLayout(viewerId, channelId)).rejects.toThrow("Invalid layout format");
    });
  });
});
