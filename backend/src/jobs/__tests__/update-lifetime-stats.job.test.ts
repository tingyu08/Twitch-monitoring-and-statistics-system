import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { lifetimeStatsAggregator } from "../../services/lifetime-stats-aggregator.service";
import { refreshViewerChannelSummaryForViewer } from "../../modules/viewer/viewer.service";
import { captureJobError } from "../job-error-tracker";

jest.mock("../../db/prisma", () => ({
  prisma: {
    viewerChannelDailyStat: {
      findMany: jest.fn(),
    },
    viewerChannelMessageDailyAgg: {
      findMany: jest.fn(),
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

jest.mock("../../services/lifetime-stats-aggregator.service", () => ({
  lifetimeStatsAggregator: {
    aggregateStats: jest.fn().mockResolvedValue(undefined),
    updatePercentileRankings: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../modules/viewer/viewer.service", () => ({
  refreshViewerChannelSummaryForViewer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../job-error-tracker", () => ({
  captureJobError: jest.fn(),
}));

jest.mock("node-cron", () => ({
  __esModule: true,
  default: {
    schedule: jest.fn(() => ({ stop: jest.fn() })),
  },
}));

// TARGET_QUERY_BATCH_SIZE inside the job is 2000
const TARGET_QUERY_BATCH_SIZE = 2000;

// Helper to build fake findMany rows
function makeRows(count: number, prefix = "row") {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    viewerId: `viewer-${prefix}-${i}`,
    channelId: `channel-${prefix}-${i}`,
  }));
}

describe("update-lifetime-stats.job", () => {
  let runLifetimeStatsUpdate: (fullUpdate?: boolean) => Promise<void>;
  let updateLifetimeStatsJob: () => void;

  beforeAll(() => {
    // Import after mocks are set up (module cache is shared across tests)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../update-lifetime-stats.job");
    runLifetimeStatsUpdate = mod.runLifetimeStatsUpdate;
    updateLifetimeStatsJob = mod.updateLifetimeStatsJob;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default: both findMany return empty arrays (no targets)
    (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([]);

    // Re-setup aggregateStats/updatePercentileRankings/refreshViewerChannelSummaryForViewer
    // as clearAllMocks resets call history but not implementations from jest.mock factory
    (lifetimeStatsAggregator.aggregateStats as jest.Mock).mockResolvedValue(undefined);
    (lifetimeStatsAggregator.updatePercentileRankings as jest.Mock).mockResolvedValue(undefined);
    (refreshViewerChannelSummaryForViewer as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Run the job and drain all fake timers so setTimeouts don't stall tests */
  async function run(fullUpdate = false): Promise<void> {
    const p = runLifetimeStatsUpdate(fullUpdate);
    await jest.runAllTimersAsync();
    return p;
  }

  // -------------------------------------------------------------------------
  // updateLifetimeStatsJob (cron scheduling)
  // -------------------------------------------------------------------------
  describe("updateLifetimeStatsJob", () => {
    it("schedules a cron job with the correct expression '0 2 * * *'", () => {
      updateLifetimeStatsJob();

      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect(cron.schedule).toHaveBeenCalledWith("0 2 * * *", expect.any(Function));
    });
  });

  // -------------------------------------------------------------------------
  // runLifetimeStatsUpdate – guard against concurrent execution
  // -------------------------------------------------------------------------
  describe("concurrent execution guard", () => {
    it("skips execution when job is already running and logs a warning", async () => {
      let resolve!: () => void;
      const stall = new Promise<void>((r) => {
        resolve = r;
      });

      // Stall the first call so isRunning stays true while second call is made
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockImplementationOnce(async () => {
        await stall;
        return [];
      });

      // Start first run (blocked at findMany - stall is not a timer, so fake timers won't interfere)
      const first = runLifetimeStatsUpdate(false);

      // Second call should detect isRunning=true and return immediately
      await run(false);

      // findMany was only called once (from the first, still-running call)
      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalledTimes(1);

      // Unblock first run and wait for cleanup
      resolve();
      await jest.runAllTimersAsync();
      await first;
    });
  });

  // -------------------------------------------------------------------------
  // runLifetimeStatsUpdate – incremental update (fullUpdate = false)
  // -------------------------------------------------------------------------
  describe("incremental update (fullUpdate=false)", () => {
    it("does not call aggregateStats when no targets are found", async () => {
      await run(false);

      expect(lifetimeStatsAggregator.aggregateStats).not.toHaveBeenCalled();
      expect(lifetimeStatsAggregator.updatePercentileRankings).not.toHaveBeenCalled();
      expect(refreshViewerChannelSummaryForViewer).not.toHaveBeenCalled();
    });

    it("calls aggregateStats for each unique target pair found", async () => {
      // Provide 3 unique pairs via dailyStat; messageAgg returns empty
      const rows = makeRows(3, "inc");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledTimes(3);
    });

    it("passes preventDecreases=true for incremental update", async () => {
      const rows = makeRows(1, "inc");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { preventDecreases: true }
      );
    });

    it("calls updatePercentileRankings and refreshViewerChannelSummaryForViewer after processing", async () => {
      const rows = makeRows(1, "inc");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(lifetimeStatsAggregator.updatePercentileRankings).toHaveBeenCalledWith(
        rows[0].channelId
      );
      expect(refreshViewerChannelSummaryForViewer).toHaveBeenCalledWith(rows[0].viewerId);
    });

    it("deduplicates duplicate viewer-channel pairs from both sources", async () => {
      const sharedRows = [{ id: "1", viewerId: "v1", channelId: "ch1" }];

      // Both sources return the same pair
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(sharedRows);
      (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValueOnce(sharedRows);

      await run(false);

      // Set deduplication → only 1 aggregateStats call
      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledTimes(1);
    });

    it("calls captureJobError when aggregateStats throws (propagates through Promise.all)", async () => {
      const rows = makeRows(3, "inc");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      // p-limit propagates the rejection up through Promise.all to the outer catch
      (lifetimeStatsAggregator.aggregateStats as jest.Mock).mockRejectedValueOnce(
        new Error("DB error")
      );

      await run(false);

      expect(captureJobError).toHaveBeenCalledWith("update-lifetime-stats", expect.any(Error), {
        fullUpdate: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // runLifetimeStatsUpdate – full update (fullUpdate = true)
  // -------------------------------------------------------------------------
  describe("full update (fullUpdate=true)", () => {
    it("queries viewerChannelDailyStat without an updatedAt time filter", async () => {
      await run(true);

      // The first findMany call on dailyStat should not have a where clause with updatedAt
      const calls = (prisma.viewerChannelDailyStat.findMany as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][0].where).toBeUndefined();
    });

    it("queries viewerChannelMessageDailyAgg without an updatedAt time filter", async () => {
      await run(true);

      const calls = (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][0].where).toBeUndefined();
    });

    it("passes preventDecreases=false for full update", async () => {
      const rows = makeRows(1, "full");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce(rows)
        .mockResolvedValue([]);

      await run(true);

      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { preventDecreases: false }
      );
    });

    it("collects from both sources and processes combined unique targets", async () => {
      const dailyRows = makeRows(2, "daily");
      const aggRows = makeRows(2, "agg");

      // fullUpdate runs them sequentially (not Promise.all), so ordering is deterministic
      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce(dailyRows)
        .mockResolvedValue([]);
      (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock)
        .mockResolvedValueOnce(aggRows)
        .mockResolvedValue([]);

      await run(true);

      // 4 unique pairs (different prefixes → different viewerIds)
      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledTimes(4);
    });

    it("calls captureJobError with fullUpdate=true when an error occurs", async () => {
      const boom = new Error("full update crash");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockRejectedValueOnce(boom);

      await run(true);

      expect(captureJobError).toHaveBeenCalledWith("update-lifetime-stats", boom, {
        fullUpdate: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Pagination: cursor-based multi-page fetching
  // -------------------------------------------------------------------------
  describe("pagination", () => {
    it("stops fetching viewerChannelDailyStat after a short (< BATCH_SIZE) page", async () => {
      // Short page (< 2000) signals end of data
      const shortPage = makeRows(500, "short");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(shortPage);

      await run(false);

      // Only 1 call since short page terminates the loop
      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalledTimes(1);
    });

    it("fetches additional pages when a full page (= BATCH_SIZE) is returned", async () => {
      // Full page triggers another fetch; second call returns short page → stop
      const fullPage = makeRows(TARGET_QUERY_BATCH_SIZE, "full");
      const shortPage = makeRows(10, "short");

      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce(shortPage);

      await run(false);

      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalledTimes(2);
    });

    it("uses cursor-based pagination: second page includes cursor and skip=1", async () => {
      const page1 = makeRows(TARGET_QUERY_BATCH_SIZE, "pg1");

      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValue([]); // second call returns empty → stop

      await run(false);

      const calls = (prisma.viewerChannelDailyStat.findMany as jest.Mock).mock.calls;
      // Second call should include cursor pointing to last row of page1
      expect(calls[1][0].cursor).toEqual({ id: page1[page1.length - 1].id });
      expect(calls[1][0].skip).toBe(1);
    });

    it("fetches multiple pages from viewerChannelMessageDailyAgg until short page", async () => {
      const page1 = makeRows(TARGET_QUERY_BATCH_SIZE, "ma1");
      const page2 = makeRows(100, "ma2"); // short page → stop

      (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      await run(false);

      expect(prisma.viewerChannelMessageDailyAgg.findMany).toHaveBeenCalledTimes(2);
    });

    it("fetches 3 pages when first two are full and third is empty", async () => {
      const page1 = makeRows(TARGET_QUERY_BATCH_SIZE, "p1");
      const page2 = makeRows(TARGET_QUERY_BATCH_SIZE, "p2");

      // fullUpdate=true: sequential collection, so daily stat is fully consumed first
      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce([]); // third call: empty → stop

      await run(true);

      // 3 calls: page1 (full), page2 (full), page3 (empty)
      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("calls captureJobError with the thrown error and context", async () => {
      const boom = new Error("unexpected failure");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockRejectedValueOnce(boom);

      await run(false);

      expect(captureJobError).toHaveBeenCalledWith("update-lifetime-stats", boom, {
        fullUpdate: false,
      });
    });

    it("resets isRunning to false after an error so the next run can proceed", async () => {
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockRejectedValueOnce(
        new Error("crash")
      );

      await run(false);

      // Reset mocks so next run gets clean defaults
      jest.clearAllMocks();
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock).mockResolvedValue([]);

      // Should not skip (isRunning was reset in finally)
      await run(false);

      // findMany must have been called again (not skipped)
      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Batch processing: per-viewer and per-channel post-processing
  // -------------------------------------------------------------------------
  describe("batch processing", () => {
    it("processes all 120 targets across 3 batches of 50", async () => {
      const rows = makeRows(120, "batch");
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(lifetimeStatsAggregator.aggregateStats).toHaveBeenCalledTimes(120);
    });

    it("calls updatePercentileRankings once per unique channelId", async () => {
      const rows = [
        { id: "1", viewerId: "v1", channelId: "ch1" },
        { id: "2", viewerId: "v2", channelId: "ch1" },
        { id: "3", viewerId: "v3", channelId: "ch2" },
        { id: "4", viewerId: "v4", channelId: "ch2" },
        { id: "5", viewerId: "v5", channelId: "ch3" },
      ];
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(lifetimeStatsAggregator.updatePercentileRankings).toHaveBeenCalledTimes(3);
      expect(lifetimeStatsAggregator.updatePercentileRankings).toHaveBeenCalledWith("ch1");
      expect(lifetimeStatsAggregator.updatePercentileRankings).toHaveBeenCalledWith("ch2");
      expect(lifetimeStatsAggregator.updatePercentileRankings).toHaveBeenCalledWith("ch3");
    });

    it("calls refreshViewerChannelSummaryForViewer once per unique viewerId", async () => {
      const rows = [
        { id: "1", viewerId: "vA", channelId: "ch1" },
        { id: "2", viewerId: "vA", channelId: "ch2" }, // same viewer, different channel
        { id: "3", viewerId: "vB", channelId: "ch1" },
      ];
      (prisma.viewerChannelDailyStat.findMany as jest.Mock).mockResolvedValueOnce(rows);

      await run(false);

      expect(refreshViewerChannelSummaryForViewer).toHaveBeenCalledTimes(2);
      expect(refreshViewerChannelSummaryForViewer).toHaveBeenCalledWith("vA");
      expect(refreshViewerChannelSummaryForViewer).toHaveBeenCalledWith("vB");
    });
  });
});
