/**
 * Tests for syncVideosJob
 * Covers: cron schedule, isRunning guard, streamer sync, viewer channel sync,
 *         error handling, pagination, timeout guard
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
  },
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    streamer: { findMany: jest.fn() },
    channel: { findMany: jest.fn() },
  },
}));

jest.mock("../../services/twitch-video.service", () => ({
  twurpleVideoService: {
    syncVideos: jest.fn(),
    syncClips: jest.fn(),
    syncViewerVideos: jest.fn(),
    syncViewerClips: jest.fn(),
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

jest.mock("../../utils/memory-thresholds", () => ({
  MEMORY_THRESHOLDS: { MAX_MB: 9999 }, // effectively unlimited – skips memory-pressure logic
}));

jest.mock("../job-error-tracker", () => ({
  captureJobError: jest.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { twurpleVideoService } from "../../services/twitch-video.service";
import { logger } from "../../utils/logger";
import { captureJobError } from "../job-error-tracker";

// Import the job – this triggers cron.schedule() and registers the handler
import "../sync-videos.job";

// ── Capture the cron handler and expression before resetAllMocks wipes mock.calls ─────

let jobHandler: () => Promise<void>;
let capturedCronExpression: string;

beforeAll(() => {
  const mockSchedule = cron.schedule as jest.Mock;
  capturedCronExpression = mockSchedule.mock.calls[0][0] as string;
  jobHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run the job handler and drain all fake timers so setTimeout delays are instant */
async function run(): Promise<void> {
  const p = jobHandler();
  await jest.runAllTimersAsync();
  await p;
}

function makeStreamer(id: string) {
  return { id, twitchUserId: `twitch-${id}`, displayName: `Streamer ${id}` };
}

function makeChannel(id: string) {
  return { id, twitchChannelId: `ch-twitch-${id}`, channelName: `channel-${id}` };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("syncVideosJob", () => {
  beforeEach(() => {
    // resetAllMocks clears mockResolvedValueOnce queues to prevent test pollution
    jest.resetAllMocks();
    jest.useFakeTimers();

    // Default: empty results so handler exits quickly
    (prisma.streamer.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.channel.findMany as jest.Mock).mockResolvedValue([]);
    (twurpleVideoService.syncVideos as jest.Mock).mockResolvedValue(undefined);
    (twurpleVideoService.syncClips as jest.Mock).mockResolvedValue(undefined);
    (twurpleVideoService.syncViewerVideos as jest.Mock).mockResolvedValue(undefined);
    (twurpleVideoService.syncViewerClips as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── cron schedule ──────────────────────────────────────────────────────

  it("schedules cron with expression '0 0 */6 * * *'", () => {
    // capturedCronExpression is saved in beforeAll before resetAllMocks clears mock.calls
    expect(capturedCronExpression).toBe("0 0 */6 * * *");
  });

  // ── isRunning guard ────────────────────────────────────────────────────

  it("skips second invocation when job is already running", async () => {
    // Call handler twice without awaiting – second call sees isRunning=true
    // because isRunning is set synchronously before the first await in the handler
    const first = jobHandler();
    const second = jobHandler();

    await jest.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(logger.warn).toHaveBeenCalledWith(
      "Jobs",
      "Sync Videos Job 正在執行中，跳過此次排程"
    );
  });

  // ── No streamers / no channels ─────────────────────────────────────────

  it("does not call syncVideos or syncClips when no streamers found", async () => {
    await run();

    expect(twurpleVideoService.syncVideos).not.toHaveBeenCalled();
    expect(twurpleVideoService.syncClips).not.toHaveBeenCalled();
  });

  it("does not call syncViewerVideos when no followed channels found", async () => {
    await run();

    expect(twurpleVideoService.syncViewerVideos).not.toHaveBeenCalled();
    expect(twurpleVideoService.syncViewerClips).not.toHaveBeenCalled();
  });

  // ── Streamer sync loop ─────────────────────────────────────────────────

  it("calls syncVideos and syncClips for each streamer", async () => {
    const streamers = [makeStreamer("s1"), makeStreamer("s2")];
    // 2 < ENTITY_QUERY_BATCH_SIZE(200) → loop breaks after first page, no second query needed
    (prisma.streamer.findMany as jest.Mock).mockResolvedValueOnce(streamers);

    await run();

    expect(twurpleVideoService.syncVideos).toHaveBeenCalledTimes(2);
    expect(twurpleVideoService.syncClips).toHaveBeenCalledTimes(2);
    expect(twurpleVideoService.syncVideos).toHaveBeenCalledWith("twitch-s1", "s1");
    expect(twurpleVideoService.syncVideos).toHaveBeenCalledWith("twitch-s2", "s2");
  });

  it("skips streamers with empty twitchUserId", async () => {
    const streamers = [
      { id: "s1", twitchUserId: "", displayName: "NoId" },
      makeStreamer("s2"),
    ];
    (prisma.streamer.findMany as jest.Mock).mockResolvedValueOnce(streamers);

    await run();

    expect(twurpleVideoService.syncVideos).toHaveBeenCalledTimes(1);
    expect(twurpleVideoService.syncVideos).toHaveBeenCalledWith("twitch-s2", "s2");
  });

  it("logs error and continues when syncVideos throws for one streamer", async () => {
    const streamers = [makeStreamer("s1"), makeStreamer("s2")];
    (prisma.streamer.findMany as jest.Mock).mockResolvedValueOnce(streamers);
    (twurpleVideoService.syncVideos as jest.Mock)
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValue(undefined);

    await run();

    expect(logger.error).toHaveBeenCalledWith(
      "Jobs",
      expect.stringContaining("同步失敗"),
      expect.any(Error)
    );
    // s2 should still be processed despite s1 failing
    expect(twurpleVideoService.syncVideos).toHaveBeenCalledWith("twitch-s2", "s2");
  });

  // ── Viewer channel sync loop ───────────────────────────────────────────

  it("calls syncViewerVideos and syncViewerClips for each followed channel", async () => {
    const channels = [makeChannel("c1"), makeChannel("c2")];
    // 2 < BATCH_SIZE(20) → loop breaks after first page
    (prisma.channel.findMany as jest.Mock).mockResolvedValueOnce(channels);

    await run();

    expect(twurpleVideoService.syncViewerVideos).toHaveBeenCalledTimes(2);
    expect(twurpleVideoService.syncViewerClips).toHaveBeenCalledTimes(2);
    expect(twurpleVideoService.syncViewerVideos).toHaveBeenCalledWith("c1", "ch-twitch-c1");
  });

  it("skips channels with empty twitchChannelId", async () => {
    const channels = [
      { id: "c1", twitchChannelId: "", channelName: "NoId" },
      makeChannel("c2"),
    ];
    (prisma.channel.findMany as jest.Mock).mockResolvedValueOnce(channels);

    await run();

    expect(twurpleVideoService.syncViewerVideos).toHaveBeenCalledTimes(1);
    expect(twurpleVideoService.syncViewerVideos).toHaveBeenCalledWith("c2", "ch-twitch-c2");
  });

  it("logs error and continues when syncViewerVideos throws", async () => {
    const channels = [makeChannel("c1"), makeChannel("c2")];
    (prisma.channel.findMany as jest.Mock).mockResolvedValueOnce(channels);
    (twurpleVideoService.syncViewerVideos as jest.Mock)
      .mockRejectedValueOnce(new Error("viewer sync error"))
      .mockResolvedValue(undefined);

    await run();

    expect(logger.error).toHaveBeenCalledWith(
      "Jobs",
      expect.stringContaining("同步觀眾內容失敗"),
      expect.any(Error)
    );
    expect(twurpleVideoService.syncViewerVideos).toHaveBeenCalledWith("c2", "ch-twitch-c2");
  });

  // ── Pagination ─────────────────────────────────────────────────────────

  it("paginates streamers when first page is full (ENTITY_QUERY_BATCH_SIZE=200)", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => makeStreamer(`s${i}`));
    const page2 = [makeStreamer("s200")];

    (prisma.streamer.findMany as jest.Mock)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    await run();

    expect(prisma.streamer.findMany).toHaveBeenCalledTimes(2);
    // Second call should use cursor from last item of page1
    expect(prisma.streamer.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: "s199" }, skip: 1 })
    );
  });

  it("paginates viewer channels when batch is full (BATCH_SIZE=20)", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => makeChannel(`c${i}`));
    const page2 = [makeChannel("c20")];

    (prisma.channel.findMany as jest.Mock)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    await run();

    expect(prisma.channel.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.channel.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: "c19" }, skip: 1 })
    );
  });

  // ── Top-level error handling ───────────────────────────────────────────

  it("calls captureJobError when streamer.findMany throws unexpectedly", async () => {
    (prisma.streamer.findMany as jest.Mock).mockRejectedValueOnce(new Error("DB error"));

    await run();

    expect(captureJobError).toHaveBeenCalledWith("sync-videos", expect.any(Error));
    expect(logger.error).toHaveBeenCalledWith(
      "Jobs",
      "Sync Videos Job 執行失敗",
      expect.any(Error)
    );
  });

  it("logs completion summary with counts after a successful run", async () => {
    const streamers = [makeStreamer("s1")];
    (prisma.streamer.findMany as jest.Mock)
      .mockResolvedValueOnce(streamers)
      .mockResolvedValueOnce([]);

    await run();

    expect(logger.info).toHaveBeenCalledWith(
      "Jobs",
      expect.stringContaining("Sync Videos Job 完成")
    );
  });

  // ── Timeout guard ──────────────────────────────────────────────────────

  it("stops processing when job timeout is triggered", async () => {
    // Return a full page so the loop continues; advance time to trigger timeout
    let firstCall = true;
    (prisma.streamer.findMany as jest.Mock).mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        // Advance fake timers past JOB_TIMEOUT_MS (90 min)
        jest.advanceTimersByTime(90 * 60 * 1000 + 1);
        return Array.from({ length: 200 }, (_, i) => makeStreamer(`s${i}`));
      }
      return [];
    });

    await run();

    expect(logger.warn).toHaveBeenCalledWith(
      "Jobs",
      expect.stringContaining("已達超時上限")
    );
  });
});
