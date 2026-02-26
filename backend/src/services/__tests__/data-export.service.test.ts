jest.mock("../../db/prisma", () => ({
  prisma: {
    viewer: {
      findUnique: jest.fn(),
    },
    exportJob: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    privacyAuditLog: {
      create: jest.fn(),
    },
    viewerChannelLifetimeStats: {
      findMany: jest.fn(),
    },
    viewerChannelDailyStat: {
      findMany: jest.fn(),
    },
    viewerChannelMessageDailyAgg: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("archiver", () => jest.fn());

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as fs from "fs";
import archiver from "archiver";
import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";

import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { DataExportService } from "../data-export.service";

type MockWritable = fs.WriteStream & {
  getContents: () => string;
  emitEvent: (event: string, ...args: unknown[]) => void;
};

function createMockWritable(options?: { writeReturnValues?: boolean[] }): MockWritable {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  const writeReturnValues = options?.writeReturnValues ?? [];
  let writeIndex = 0;

  const stream = {
    write: jest.fn((content: string) => {
      chunks.push(content);
      const value = writeReturnValues[writeIndex];
      writeIndex += 1;
      return value ?? true;
    }),
    end: jest.fn((callback?: () => void) => {
      if (callback) callback();
      return undefined;
    }),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
      return stream;
    }),
    once: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.once(event, handler);
      return stream;
    }),
    getContents: () => chunks.join(""),
    emitEvent: (event: string, ...args: unknown[]) => {
      emitter.emit(event, ...args);
    },
  } as unknown as MockWritable;

  return stream;
}

describe("DataExportService", () => {
  let service: DataExportService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    service = new DataExportService();
  });

  describe("createExportJob", () => {
    it("returns failure when viewer does not exist", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.createExportJob("viewer-missing");

      expect(result).toEqual({
        success: false,
        message: "找不到觀眾記錄",
      });
      expect(prisma.exportJob.findFirst).not.toHaveBeenCalled();
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it("returns existing active job instead of creating a new one", async () => {
      const existingJob = {
        id: "job-existing",
        viewerId: "viewer-1",
        status: "completed",
      } as any;

      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({ id: "viewer-1" });
      (prisma.exportJob.findFirst as jest.Mock).mockResolvedValueOnce(existingJob);

      const result = await service.createExportJob("viewer-1");

      expect(result).toEqual({
        success: true,
        message: "已有可用的匯出任務",
        job: existingJob,
        queued: false,
      });
      expect(prisma.exportJob.create).not.toHaveBeenCalled();
    });

    it("creates a new processing job when no reusable job exists", async () => {
      const createdJob = {
        id: "job-new",
        viewerId: "viewer-1",
        status: "processing",
      } as any;

      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({ id: "viewer-1" });
      (prisma.exportJob.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prisma.exportJob.create as jest.Mock).mockResolvedValueOnce(createdJob);

      const result = await service.createExportJob("viewer-1");

      expect(result).toEqual({
        success: true,
        message: "資料匯出任務已建立",
        job: createdJob,
        queued: true,
      });
      expect(prisma.exportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            viewerId: "viewer-1",
            status: "processing",
            expiresAt: expect.any(Date),
          }),
        })
      );
    });

    it("initializes export directory only once per service instance", async () => {
      const accessSpy = jest
        .spyOn(fs.promises, "access")
        .mockRejectedValueOnce(new Error("missing dir"));
      const mkdirSpy = jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValue({ id: "viewer-1" });
      (prisma.exportJob.findFirst as jest.Mock).mockResolvedValue({
        id: "job-existing",
        viewerId: "viewer-1",
        status: "processing",
      });

      await service.createExportJob("viewer-1");
      await service.createExportJob("viewer-1");

      expect(accessSpy).toHaveBeenCalledTimes(1);
      expect(mkdirSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("processExportJob", () => {
    it("returns early and logs when job cannot be found", async () => {
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await service.processExportJob("job-missing");

      expect(logger.warn).toHaveBeenCalledWith("DataExport", "Job not found: job-missing");
      expect(prisma.exportJob.update).not.toHaveBeenCalled();
    });

    it("returns early for completed and expired jobs", async () => {
      (prisma.exportJob.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: "job-1", status: "completed" })
        .mockResolvedValueOnce({ id: "job-2", status: "expired" });

      await service.processExportJob("job-1");
      await service.processExportJob("job-2");

      expect(prisma.exportJob.update).not.toHaveBeenCalled();
      expect(prisma.privacyAuditLog.create).not.toHaveBeenCalled();
    });

    it("marks job completed and writes audit log on successful export", async () => {
      const job = {
        id: "job-1",
        viewerId: "viewer-1",
        status: "processing",
        expiresAt: new Date("2026-02-26T00:00:00.000Z"),
      } as any;

      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(job);
      jest
        .spyOn(service as any, "generateExport")
        .mockResolvedValueOnce("./exports/viewer-data-export-viewer-1.zip");

      await service.processExportJob("job-1");

      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: {
          status: "completed",
          downloadPath: "./exports/viewer-data-export-viewer-1.zip",
          errorMessage: null,
        },
      });
      expect(prisma.privacyAuditLog.create).toHaveBeenCalledWith({
        data: {
          viewerId: "viewer-1",
          action: "data_exported",
          details: JSON.stringify({
            jobId: "job-1",
            expiresAt: job.expiresAt.toISOString(),
          }),
        },
      });
    });

    it("marks job failed and rethrows errors from export generation", async () => {
      const job = {
        id: "job-1",
        viewerId: "viewer-1",
        status: "processing",
        expiresAt: new Date("2026-02-26T00:00:00.000Z"),
      } as any;

      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValue(job);

      const standardError = new Error("zip failed");
      jest.spyOn(service as any, "generateExport").mockRejectedValueOnce(standardError);

      await expect(service.processExportJob("job-1")).rejects.toThrow("zip failed");

      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: {
          status: "failed",
          errorMessage: "zip failed",
        },
      });
    });

    it("uses fallback unknown error message for non-Error throw values", async () => {
      const job = {
        id: "job-1",
        viewerId: "viewer-1",
        status: "processing",
        expiresAt: new Date("2026-02-26T00:00:00.000Z"),
      } as any;

      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValue(job);
      jest.spyOn(service as any, "generateExport").mockRejectedValueOnce("boom");

      await expect(service.processExportJob("job-1")).rejects.toBe("boom");

      expect(prisma.exportJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: {
          status: "failed",
          errorMessage: "未知錯誤",
        },
      });
    });
  });

  describe("cleanupExpiredExports", () => {
    it("returns 0 when there are no expired completed exports", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce([]);

      const cleaned = await service.cleanupExpiredExports();

      expect(cleaned).toBe(0);
      expect(prisma.exportJob.updateMany).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("cleans existing files, handles missing/delete failures, and expires all jobs", async () => {
      const expiredJobs = [
        { id: "job-a", downloadPath: "/tmp/a.zip" },
        { id: "job-b", downloadPath: "/tmp/b.zip" },
        { id: "job-c", downloadPath: "/tmp/c.zip" },
      ] as any;

      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce(expiredJobs);
      (prisma.exportJob.updateMany as jest.Mock).mockResolvedValueOnce({ count: 3 });

      const accessSpy = jest.spyOn(fs.promises, "access").mockImplementation(async (targetPath) => {
        if (targetPath === "/tmp/b.zip") {
          throw new Error("ENOENT");
        }
      });

      const unlinkSpy = jest.spyOn(fs.promises, "unlink").mockImplementation(async (targetPath) => {
        if (targetPath === "/tmp/c.zip") {
          throw new Error("unlink denied");
        }
      });

      const cleaned = await service.cleanupExpiredExports();

      expect(cleaned).toBe(1);
      expect(accessSpy).toHaveBeenCalledTimes(3);
      expect(unlinkSpy).toHaveBeenCalledTimes(2);
      expect(prisma.exportJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["job-a", "job-b", "job-c"] } },
        data: {
          downloadPath: null,
          status: "expired",
        },
      });
      expect(logger.error).toHaveBeenCalledWith(
        "DataExport",
        "清理匯出檔案失敗",
        expect.any(Error)
      );
      expect(logger.info).toHaveBeenCalledWith("DataExport", "已清理 1 個過期的匯出檔案");
    });
  });

  describe("export generation internals", () => {
    it("writes profile only when privacy consent is absent", async () => {
      const writeFileSpy = jest.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined);

      await (service as any).generateJsonFiles("/tmp/export", {
        viewer: {
          id: "viewer-1",
          twitchUserId: "tw-1",
          displayName: "Viewer One",
          createdAt: new Date("2026-02-20T00:00:00.000Z"),
          updatedAt: new Date("2026-02-21T00:00:00.000Z"),
          privacyConsent: null,
        },
      });

      expect(writeFileSpy).toHaveBeenCalledTimes(1);
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("profile.json"),
        expect.stringContaining("\"twitchUserId\": \"tw-1\"")
      );
    });

    it("writes profile and privacy settings when privacy consent exists", async () => {
      const writeFileSpy = jest.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined);

      await (service as any).generateJsonFiles("/tmp/export", {
        viewer: {
          id: "viewer-1",
          twitchUserId: "tw-1",
          displayName: "Viewer One",
          createdAt: new Date("2026-02-20T00:00:00.000Z"),
          updatedAt: new Date("2026-02-21T00:00:00.000Z"),
          privacyConsent: {
            consentVersion: "v1",
            consentGivenAt: new Date("2026-02-20T00:00:00.000Z"),
            collectDailyWatchTime: true,
            collectWatchTimeDistribution: true,
            collectMonthlyAggregates: true,
            collectChatMessages: true,
            collectInteractions: true,
            collectInteractionFrequency: true,
            collectBadgeProgress: true,
            collectFootprintData: true,
            collectRankings: true,
            collectRadarAnalysis: true,
            updatedAt: new Date("2026-02-21T00:00:00.000Z"),
          },
        },
      });

      expect(writeFileSpy).toHaveBeenCalledTimes(2);
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("privacy-settings.json"),
        expect.stringContaining("\"consentVersion\": \"v1\"")
      );
    });

    it("writes lifetime stats as empty JSON array when no rows exist", async () => {
      const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "export-empty-"));
      await fs.promises.mkdir(path.join(exportDir, "json"), { recursive: true });
      (prisma.viewerChannelLifetimeStats.findMany as jest.Mock).mockResolvedValueOnce([]);

      await (service as any).generateLifetimeStatsJson(exportDir, "viewer-1");

      expect(prisma.viewerChannelLifetimeStats.findMany).toHaveBeenCalledTimes(1);
      const json = await fs.promises.readFile(path.join(exportDir, "json", "lifetime-stats.json"), "utf8");
      expect(json).toContain("[\n");
      expect(json).toContain("\n]\n");

      await fs.promises.rm(exportDir, { recursive: true, force: true });
    });

    it("writes lifetime stats across paged batches and uses cursor", async () => {
      const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "export-life-"));
      await fs.promises.mkdir(path.join(exportDir, "json"), { recursive: true });

      const firstBatch = Array.from({ length: 200 }, (_, index) => ({
        id: `life-${index + 1}`,
        channel: { channelName: `ch-${index + 1}` },
        totalWatchTimeMinutes: 10,
        totalSessions: 1,
        totalMessages: 2,
        totalChatMessages: 3,
        totalSubscriptions: 0,
        totalCheers: 0,
        totalBits: 0,
        trackingDays: 1,
        longestStreakDays: 1,
        firstWatchedAt: new Date("2026-02-20T00:00:00.000Z"),
        lastWatchedAt: new Date("2026-02-20T01:00:00.000Z"),
      }));

      (prisma.viewerChannelLifetimeStats.findMany as jest.Mock)
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([
          {
            id: "life-201",
            channel: null,
            totalWatchTimeMinutes: 5,
            totalSessions: 1,
            totalMessages: 1,
            totalChatMessages: 1,
            totalSubscriptions: 0,
            totalCheers: 0,
            totalBits: 0,
            trackingDays: 1,
            longestStreakDays: 1,
            firstWatchedAt: new Date("2026-02-21T00:00:00.000Z"),
            lastWatchedAt: new Date("2026-02-21T01:00:00.000Z"),
          },
        ]);

      await (service as any).generateLifetimeStatsJson(exportDir, "viewer-1");

      expect(prisma.viewerChannelLifetimeStats.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.viewerChannelLifetimeStats.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: "life-200" },
          skip: 1,
        })
      );
      const json = await fs.promises.readFile(path.join(exportDir, "json", "lifetime-stats.json"), "utf8");
      expect(json).toContain('"channelName": "ch-1"');
      expect(json).toContain('"totalWatchTimeMinutes": 5');

      await fs.promises.rm(exportDir, { recursive: true, force: true });
    });

    it("handles write backpressure by waiting for drain", async () => {
      const drainingStream = createMockWritable({ writeReturnValues: [false] });
      const linePromise = (service as any).writeLine(drainingStream, "line");
      setImmediate(() => drainingStream.emitEvent("drain"));

      await expect(linePromise).resolves.toBeUndefined();
      expect(drainingStream.write).toHaveBeenCalledWith("line");
    });

    it("writes daily stats JSON/CSV with cursor and empty-channel branches", async () => {
      const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "export-daily-"));
      await fs.promises.mkdir(path.join(exportDir, "json"), { recursive: true });
      await fs.promises.mkdir(path.join(exportDir, "csv"), { recursive: true });

      (prisma.viewerChannelDailyStat.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: "daily-1",
            date: new Date("2026-02-22T00:00:00.000Z"),
            channel: null,
            watchSeconds: 125,
            messageCount: 4,
            emoteCount: 1,
          },
        ])
        .mockResolvedValueOnce([]);

      await (service as any).generateDailyStatsFiles(exportDir, "viewer-1");

      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.viewerChannelDailyStat.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: "daily-1" },
          skip: 1,
        })
      );
      const csv = await fs.promises.readFile(path.join(exportDir, "csv", "watch-time-daily.csv"), "utf8");
      const json = await fs.promises.readFile(path.join(exportDir, "json", "watch-time-stats.json"), "utf8");
      expect(csv).toContain("\ufeff日期,頻道,觀看秒數,觀看分鐘,留言數,表情數");
      expect(csv).toContain("2026-02-22,,125,2,4,1");
      expect(json).toContain('"watchSeconds": 125');

      await fs.promises.rm(exportDir, { recursive: true, force: true });
    });

    it("writes message aggregates JSON/CSV and defaults null bits to 0", async () => {
      const exportDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "export-msg-"));
      await fs.promises.mkdir(path.join(exportDir, "json"), { recursive: true });
      await fs.promises.mkdir(path.join(exportDir, "csv"), { recursive: true });

      (prisma.viewerChannelMessageDailyAgg.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: "msg-1",
            date: new Date("2026-02-23T00:00:00.000Z"),
            channel: null,
            totalMessages: 6,
            chatMessages: 5,
            subscriptions: 0,
            cheers: 1,
            giftSubs: 0,
            raids: 0,
            totalBits: null,
          },
        ])
        .mockResolvedValueOnce([]);

      await (service as any).generateMessageAggFiles(exportDir, "viewer-1");

      expect(prisma.viewerChannelMessageDailyAgg.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.viewerChannelMessageDailyAgg.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: "msg-1" },
          skip: 1,
        })
      );
      const csv = await fs.promises.readFile(path.join(exportDir, "csv", "messages-daily.csv"), "utf8");
      const json = await fs.promises.readFile(path.join(exportDir, "json", "message-stats.json"), "utf8");
      expect(csv).toContain(",6,5,0,1,0,0,0\n");
      expect(json).toContain('"totalBits": null');

      await fs.promises.rm(exportDir, { recursive: true, force: true });
    });

    it("generates export archive and removes temp directory on success", async () => {
      const mkdirSpy = jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      const rmSpy = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "viewer-12345678",
        twitchUserId: "tw-1",
        displayName: "Viewer One",
        createdAt: new Date("2026-02-20T00:00:00.000Z"),
        updatedAt: new Date("2026-02-21T00:00:00.000Z"),
        privacyConsent: null,
      });

      const jsonSpy = jest.spyOn(service as any, "generateJsonFiles").mockResolvedValue(undefined);
      const lifetimeSpy = jest
        .spyOn(service as any, "generateLifetimeStatsJson")
        .mockResolvedValue(undefined);
      const dailySpy = jest
        .spyOn(service as any, "generateDailyStatsFiles")
        .mockResolvedValue(undefined);
      const messageSpy = jest
        .spyOn(service as any, "generateMessageAggFiles")
        .mockResolvedValue(undefined);
      const readmeSpy = jest.spyOn(service as any, "generateReadme").mockResolvedValue(undefined);
      const zipSpy = jest.spyOn(service as any, "createZipArchive").mockResolvedValue(undefined);

      const zipPath = await (service as any).generateExport("viewer-12345678", "job-1");

      expect(mkdirSpy).toHaveBeenCalledTimes(3);
      expect(jsonSpy).toHaveBeenCalledTimes(1);
      expect(lifetimeSpy).toHaveBeenCalledTimes(1);
      expect(dailySpy).toHaveBeenCalledTimes(1);
      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(readmeSpy).toHaveBeenCalledTimes(1);
      expect(zipSpy).toHaveBeenCalledTimes(1);
      expect(rmSpy).toHaveBeenCalledTimes(1);
      expect(zipPath).toContain("viewer-data-export-viewer-1");
      expect(zipPath).toMatch(/\.zip$/);
    });

    it("cleans temp directory and rethrows when export generation fails and temp exists", async () => {
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      const rmSpy = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
      const accessSpy = jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect((service as any).generateExport("viewer-12345678", "job-1")).rejects.toThrow(
        "找不到觀眾記錄"
      );

      expect(accessSpy).toHaveBeenCalled();
      expect(rmSpy).toHaveBeenCalledTimes(1);
    });

    it("rethrows export failure without cleanup when temp directory does not exist", async () => {
      jest.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
      const rmSpy = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("ENOENT"));

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect((service as any).generateExport("viewer-12345678", "job-1")).rejects.toThrow(
        "找不到觀眾記錄"
      );

      expect(rmSpy).not.toHaveBeenCalled();
    });

    it("rejects createZipArchive on archive error event", async () => {
      jest.spyOn(fs, "createWriteStream").mockReturnValue(createMockWritable());

      let errorHandler: ((error: Error) => void) | null = null;
      const archive = {
        on: jest.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error") errorHandler = handler;
          return archive;
        }),
        pipe: jest.fn(),
        directory: jest.fn(),
        finalize: jest.fn(() => errorHandler?.(new Error("archive failed"))),
      };

      (archiver as unknown as jest.Mock).mockReturnValue(archive);

      await expect((service as any).createZipArchive("/tmp/source", "/tmp/out.zip")).rejects.toThrow(
        "archive failed"
      );
    });
  });

  describe("query helpers", () => {
    it("returns export job by id", async () => {
      const job = { id: "job-1" } as any;
      (prisma.exportJob.findUnique as jest.Mock).mockResolvedValueOnce(job);

      const result = await service.getExportJob("job-1");

      expect(result).toBe(job);
      expect(prisma.exportJob.findUnique).toHaveBeenCalledWith({ where: { id: "job-1" } });
    });

    it("returns recent export jobs with fixed ordering and limit", async () => {
      const jobs = [{ id: "job-2" }, { id: "job-1" }] as any;
      (prisma.exportJob.findMany as jest.Mock).mockResolvedValueOnce(jobs);

      const result = await service.getRecentExportJobs("viewer-1");

      expect(result).toBe(jobs);
      expect(prisma.exportJob.findMany).toHaveBeenCalledWith({
        where: { viewerId: "viewer-1" },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
    });
  });
});
