import { StreamStatusJob } from "../stream-status.job";
import { prisma } from "../../db/prisma";
import { unifiedTwitchService } from "../../services/unified-twitch.service";
import { shouldSkipForCircuitBreaker } from "../../utils/job-circuit-breaker";

jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(() => ({ stop: jest.fn(), start: jest.fn(), destroy: jest.fn() })),
  },
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    channel: { findMany: jest.fn() },
    streamSession: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    streamMetric: { create: jest.fn() },
  },
}));

jest.mock("../../services/unified-twitch.service", () => ({
  unifiedTwitchService: {
    getStreamsByUserIds: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../../utils/memory-monitor", () => ({
  memoryMonitor: {
    isOverLimit: jest.fn().mockReturnValue(false),
    isNearLimit: jest.fn().mockReturnValue(false),
  },
}));

jest.mock("../job-error-tracker", () => ({ captureJobError: jest.fn() }));
jest.mock("../job-write-guard", () => ({
  runWithWriteGuard: jest.fn(async (_k: string, op: () => Promise<unknown>) => op()),
}));
jest.mock("../../services/chat-listener-manager", () => ({
  chatListenerManager: { stopListening: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../../config/session-write-authority", () => ({
  getSessionWriteAuthority: jest.fn().mockReturnValue("job"),
}));
jest.mock("../../constants", () => ({
  WriteGuardKeys: {
    STREAM_SESSION_CREATE: "a",
    STREAM_SESSION_UPDATE: "b",
    STREAM_SESSION_END: "c",
  },
}));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../utils/job-circuit-breaker", () => ({
  shouldSkipForCircuitBreaker: jest.fn().mockReturnValue(false),
  recordJobSuccess: jest.fn(),
  recordJobFailure: jest.fn(),
}));

describe("StreamStatusJob resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(false);
    (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.streamSession.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.streamSession.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.streamSession.upsert as jest.Mock).mockResolvedValue({ id: "session-1" });
    (prisma.streamMetric.create as jest.Mock).mockResolvedValue({});
    (unifiedTwitchService.getStreamsByUserIds as jest.Mock).mockResolvedValue([]);
  });

  it("skips execution when circuit breaker is active", async () => {
    const job = new StreamStatusJob();
    (shouldSkipForCircuitBreaker as jest.Mock).mockReturnValue(true);

    const result = await job.execute();

    expect(result).toEqual({
      checked: 0,
      online: 0,
      offline: 0,
      newSessions: 0,
      endedSessions: 0,
    });
    expect(prisma.channel.findMany).not.toHaveBeenCalled();
  });

  it("reuses recent channel snapshots before calling Twitch API", async () => {
    const job = new StreamStatusJob();
    const startedAt = new Date("2026-03-11T10:00:00.000Z");
    (prisma.channel.findMany as jest.Mock).mockResolvedValue([
      {
        id: "c1",
        twitchChannelId: "t1",
        channelName: "demo",
        isLive: true,
        lastLiveCheckAt: new Date(),
        currentViewerCount: 42,
        currentTitle: "Live now",
        currentGameName: "Game",
        currentStreamStartedAt: startedAt,
      },
    ]);

    await job.execute();

    expect(unifiedTwitchService.getStreamsByUserIds).not.toHaveBeenCalled();
    expect(prisma.streamSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          channelId: "c1",
          title: "Live now",
          category: "Game",
          avgViewers: 42,
          peakViewers: 42,
          startedAt,
        }),
      })
    );
  });
});
