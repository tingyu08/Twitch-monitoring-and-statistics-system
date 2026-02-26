jest.mock("../../db/prisma", () => ({
  prisma: {
    streamSession: {
      findFirst: jest.fn(),
    },
    viewerChannelMessage: {
      findMany: jest.fn(),
    },
    viewerChannelDailyStat: {
      upsert: jest.fn(),
    },
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

import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { updateViewerWatchTime } from "../watch-time.service";

describe("watch-time.service updateViewerWatchTime", () => {
  const viewerId = "viewer-1";
  const channelId = "channel-1";
  const day = new Date("2026-02-26T10:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns early in single-writer mode without hitting DB", async () => {
    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: false });

    expect(prisma.streamSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.viewerChannelMessage.findMany).not.toHaveBeenCalled();
    expect(prisma.viewerChannelDailyStat.upsert).not.toHaveBeenCalled();
  });

  it("recalculates and upserts when allowOverwrite is true", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-02-26T09:00:00.000Z"),
      endedAt: new Date("2026-02-26T12:00:00.000Z"),
    });
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([
      { timestamp: new Date("2026-02-26T10:00:00.000Z") },
      { timestamp: new Date("2026-02-26T10:10:00.000Z") },
    ]);
    (prisma.viewerChannelDailyStat.upsert as jest.Mock).mockResolvedValue({});

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.streamSession.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.viewerChannelMessage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          viewerId_channelId_date: expect.objectContaining({
            viewerId,
            channelId,
          }),
        },
        create: expect.objectContaining({
          viewerId,
          channelId,
          messageCount: 2,
        }),
      })
    );
  });

  it("does not upsert when no messages found", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([]);

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.streamSession.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.viewerChannelMessage.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.viewerChannelDailyStat.upsert).not.toHaveBeenCalled();
  });

  it("splits sessions when message gap exceeds post buffer", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([
      { timestamp: new Date("2026-02-26T10:00:00.000Z") },
      { timestamp: new Date("2026-02-26T11:00:00.000Z") },
    ]);

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          watchSeconds: 4800,
          messageCount: 2,
        }),
        update: expect.objectContaining({
          watchSeconds: 4800,
        }),
      })
    );
  });

  it("clips final session end time by stream end", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-02-26T09:00:00.000Z"),
      endedAt: new Date("2026-02-26T09:20:00.000Z"),
    });
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([
      { timestamp: new Date("2026-02-26T09:05:00.000Z") },
      { timestamp: new Date("2026-02-26T09:06:00.000Z") },
    ]);

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          // start clipped to 09:00, end clipped to 09:20 => 1200 seconds
          watchSeconds: 1200,
        }),
        update: expect.objectContaining({
          watchSeconds: 1200,
        }),
      })
    );
  });

  it("handles query failures without throwing", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockRejectedValue(new Error("db down"));

    await expect(
      updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true })
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "WatchTime",
      "Failed to update watch time",
      expect.any(Error)
    );
    expect(prisma.viewerChannelDailyStat.upsert).not.toHaveBeenCalled();
  });

  it("clips split-session previous end by stream end", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-02-26T08:00:00.000Z"),
      endedAt: new Date("2026-02-26T09:20:00.000Z"),
    });
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([
      { timestamp: new Date("2026-02-26T09:00:00.000Z") },
      { timestamp: new Date("2026-02-26T09:40:00.000Z") },
    ]);

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          // first segment: 08:50 -> clipped end 09:20 => 1800 sec
          watchSeconds: 1800,
        }),
      })
    );
  });

  it("clips split-session next start by stream start", async () => {
    (prisma.streamSession.findFirst as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-02-26T10:00:00.000Z"),
      endedAt: null,
    });
    (prisma.viewerChannelMessage.findMany as jest.Mock).mockResolvedValue([
      { timestamp: new Date("2026-02-26T09:00:00.000Z") },
      { timestamp: new Date("2026-02-26T09:40:00.000Z") },
    ]);

    await updateViewerWatchTime(viewerId, channelId, day, { allowOverwrite: true });

    expect(prisma.viewerChannelDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          // first segment is 0 after clipping; second segment: 10:00 -> 10:10 => 600 sec
          watchSeconds: 600,
        }),
      })
    );
  });
});
