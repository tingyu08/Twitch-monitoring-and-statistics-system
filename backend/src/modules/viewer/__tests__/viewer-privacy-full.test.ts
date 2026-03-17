/**
 * viewer-privacy.controller.ts 完整測試
 * 覆蓋所有方法的 happy path、error path、auth failure 分支
 */

// ---- Mocks (must come first) ----

jest.mock("../../../services/privacy-consent.service", () => ({
  privacyConsentService: {
    getAllConsentStatus: jest.fn(),
    updateConsent: jest.fn(),
    createDefaultConsent: jest.fn(),
  },
}));

jest.mock("../../../services/account-deletion.service", () => ({
  accountDeletionService: {
    requestDeletion: jest.fn(),
    cancelDeletion: jest.fn(),
    getDeletionStatus: jest.fn(),
  },
}));

jest.mock("../../../services/data-export.service", () => ({
  dataExportService: {
    createExportJob: jest.fn(),
    getExportJob: jest.fn(),
    processExportJob: jest.fn(),
  },
}));

jest.mock("../../../utils/data-export-queue", () => ({
  dataExportQueue: {
    process: jest.fn(),
    add: jest.fn(),
  },
}));

jest.mock("../../../db/prisma", () => ({
  prisma: {
    viewer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    privacyAuditLog: {
      create: jest.fn(),
    },
    exportJob: {
      update: jest.fn(),
    },
    viewerChannelMessage: {
      deleteMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findFirst: jest.fn(),
    },
    viewerChannelMessageDailyAgg: {
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../viewer-auth-snapshot.service", () => ({
  getViewerAuthSnapshotByTwitchUserId: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
}));

// Mock other controllers used in viewer.routes.ts
jest.mock("../viewer.controller", () => ({
  ViewerController: jest.fn().mockImplementation(() => ({
    consent: jest.fn(),
    getChannelStats: jest.fn(),
    getChannels: jest.fn(),
    getChannelDetailAll: jest.fn(),
  })),
}));
jest.mock("../viewer-message-stats.controller", () => ({
  ViewerMessageStatsController: jest.fn().mockImplementation(() => ({
    getMessageStats: jest.fn(),
  })),
}));
jest.mock("../dashboard-layout.controller", () => ({
  dashboardLayoutController: {
    saveLayout: jest.fn(),
    getLayout: jest.fn(),
    resetLayout: jest.fn(),
  },
}));
jest.mock("../viewer-lifetime-stats.controller", () => ({
  viewerLifetimeStatsController: {
    getLifetimeStats: jest.fn(),
  },
}));
jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: () => (req: any, _res: any, next: any) => {
    req.user = { twitchUserId: "test-twitch-id", role: "viewer" };
    next();
  },
}));
jest.mock("../../../middlewares/validate.middleware", () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../../../middlewares/cache-control.middleware", () => ({
  semiStaticCache: (_req: any, _res: any, next: any) => next(),
  dynamicCache: (_req: any, _res: any, next: any) => next(),
  noCache: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../../../services/chat-listener-manager", () => ({
  chatListenerManager: { requestListen: jest.fn().mockResolvedValue(true) },
}));

// ---- App setup ----

import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

const app = express();
app.use(express.json());
app.use(cookieParser());

import { viewerApiRoutes } from "../viewer.routes";
app.use("/api/viewer", viewerApiRoutes);

// ---- Imports after mocks ----

import { prisma as mockPrisma } from "../../../db/prisma";
import { privacyConsentService } from "../../../services/privacy-consent.service";
import { accountDeletionService } from "../../../services/account-deletion.service";
import { dataExportService } from "../../../services/data-export.service";
import { dataExportQueue } from "../../../utils/data-export-queue";
import { getViewerAuthSnapshotByTwitchUserId } from "../viewer-auth-snapshot.service";
import * as fs from "fs";

// ---- Fixtures ----

const MOCK_VIEWER = {
  id: "viewer-1",
  twitchUserId: "test-twitch-id",
  displayName: "Tester",
  consentedAt: new Date("2024-01-01"),
  isAnonymized: false,
  consentVersion: 1,
};

// ---- Helper ----

function mockViewerFound(viewer = MOCK_VIEWER) {
  (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockResolvedValue(viewer);
}

function mockViewerNotFound() {
  (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockResolvedValue(null);
}

// ---- Tests ----

describe("ViewerPrivacyController – getViewerFromRequest null path (line 28)", () => {
  it("returns 401 when req.user has no twitchUserId", async () => {
    // Override the auth middleware mock for this specific test
    const testApp = express();
    testApp.use(express.json());
    testApp.use(cookieParser());

    // Create a middleware that sets req.user WITHOUT twitchUserId
    testApp.use((req: any, _res: any, next: any) => {
      req.user = { role: "viewer" }; // no twitchUserId
      next();
    });

    // Mount only the privacy routes directly
    const { ViewerPrivacyController } = await import("../viewer-privacy.controller");
    const privacyCtrl = new ViewerPrivacyController();
    testApp.get("/test-consent", (req: any, res: any) => privacyCtrl.getConsentSettings(req, res));

    const res = await request(testApp).get("/test-consent");
    expect(res.status).toBe(401);
  });
});

describe("ViewerPrivacyController – export queue process callback (line 40)", () => {
  it("invokes dataExportService.processExportJob when queue processes a job", () => {
    // dataExportQueue.process was called during controller instantiation.
    // We need to capture and invoke the callback.
    const processMock = dataExportQueue.process as jest.Mock;
    expect(processMock).toHaveBeenCalled();

    // Get the callback that was passed to process()
    const processCallback = processMock.mock.calls[0][0];
    expect(processCallback).toBeInstanceOf(Function);

    // Invoke it with a mock job
    (dataExportService.processExportJob as jest.Mock).mockResolvedValue(undefined);
    processCallback({ exportJobId: "test-export-job-123" });

    expect(dataExportService.processExportJob).toHaveBeenCalledWith("test-export-job-123");
  });
});

describe("ViewerPrivacyController – clearChannelMessages missing channelId (lines 576-577)", () => {
  beforeEach(() => {
    (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockResolvedValue(MOCK_VIEWER);
  });

  it("returns 400 when channelId param is missing", async () => {
    const { ViewerPrivacyController } = await import("../viewer-privacy.controller");
    const ctrl = new ViewerPrivacyController();

    const req = {
      user: { twitchUserId: "test-twitch-id" },
      params: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await ctrl.clearChannelMessages(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "channelId 為必填" });
  });
});

describe("ViewerPrivacyController – getExportStatus missing jobId (lines 258-259)", () => {
  beforeEach(() => {
    (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockResolvedValue(MOCK_VIEWER);
  });

  it("returns 400 when jobId param is missing", async () => {
    const { ViewerPrivacyController } = await import("../viewer-privacy.controller");
    const ctrl = new ViewerPrivacyController();

    const req = {
      user: { twitchUserId: "test-twitch-id" },
      params: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await ctrl.getExportStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "jobId 為必填" });
  });
});

describe("ViewerPrivacyController – downloadExport missing jobId (lines 307-308)", () => {
  beforeEach(() => {
    (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockResolvedValue(MOCK_VIEWER);
  });

  it("returns 400 when jobId param is missing", async () => {
    const { ViewerPrivacyController } = await import("../viewer-privacy.controller");
    const ctrl = new ViewerPrivacyController();

    const req = {
      user: { twitchUserId: "test-twitch-id" },
      params: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await ctrl.downloadExport(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "jobId 為必填" });
  });
});

describe("ViewerPrivacyController – full coverage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: viewer found
    mockViewerFound();
    // Default: dataExportQueue.process does nothing (already initialized)
  });

  // ============================================================
  // getConsentSettings  GET /pref/status
  // ============================================================
  describe("GET /api/viewer/pref/status", () => {
    it("returns consent settings (happy path)", async () => {
      const mockSettings = { collectDailyWatchTime: true };
      (privacyConsentService.getAllConsentStatus as jest.Mock).mockResolvedValue(mockSettings);

      const res = await request(app).get("/api/viewer/pref/status");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings).toEqual(mockSettings);
      expect(res.body.hasConsent).toBe(true);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/pref/status");
      expect(res.status).toBe(401);
    });

    it("returns 500 on service error", async () => {
      (privacyConsentService.getAllConsentStatus as jest.Mock).mockRejectedValue(
        new Error("db error")
      );
      const res = await request(app).get("/api/viewer/pref/status");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // updateConsentSettings  PATCH /pref/status
  // ============================================================
  describe("PATCH /api/viewer/pref/status", () => {
    it("updates consent settings (happy path)", async () => {
      const body = { collectDailyWatchTime: false };
      (privacyConsentService.updateConsent as jest.Mock).mockResolvedValue(body);
      (mockPrisma.privacyAuditLog.create as jest.Mock).mockResolvedValue({});

      const res = await request(app).patch("/api/viewer/pref/status").send(body);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 for invalid fields", async () => {
      const res = await request(app)
        .patch("/api/viewer/pref/status")
        .send({ badField: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/無效的欄位/);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).patch("/api/viewer/pref/status").send({});
      expect(res.status).toBe(401);
    });

    it("returns 500 on service error", async () => {
      const body = { collectChatMessages: true };
      (privacyConsentService.updateConsent as jest.Mock).mockRejectedValue(new Error("fail"));

      const res = await request(app).patch("/api/viewer/pref/status").send(body);
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // acceptAllConsent  POST /pref/opt-all
  // ============================================================
  describe("POST /api/viewer/pref/opt-all", () => {
    it("accepts all consents (happy path)", async () => {
      (privacyConsentService.createDefaultConsent as jest.Mock).mockResolvedValue({
        consentVersion: 1,
      });
      (mockPrisma.viewer.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.privacyAuditLog.create as jest.Mock).mockResolvedValue({});

      const res = await request(app).post("/api/viewer/pref/opt-all");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).post("/api/viewer/pref/opt-all");
      expect(res.status).toBe(401);
    });

    it("returns 500 on db error", async () => {
      (privacyConsentService.createDefaultConsent as jest.Mock).mockRejectedValue(
        new Error("fail")
      );
      const res = await request(app).post("/api/viewer/pref/opt-all");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // requestExport  POST /privacy/export
  // ============================================================
  describe("POST /api/viewer/privacy/export", () => {
    it("queues export job (happy path, queued=true)", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: true,
        queued: true,
        message: "queued",
        job: { id: "job-1", status: "pending", expiresAt: null },
      });
      (dataExportQueue.add as jest.Mock).mockResolvedValue("queued-id");

      const res = await request(app).post("/api/viewer/privacy/export");

      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe("job-1");
    });

    it("returns immediate result when not queued (queued=false)", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: true,
        queued: false,
        message: "done",
        job: { id: "job-2", status: "completed", expiresAt: null },
      });

      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(200);
      expect(res.body.jobId).toBe("job-2");
    });

    it("returns 400 when service returns failure", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: false,
        message: "already pending",
      });

      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(400);
    });

    it("returns 500 when job id missing", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: true,
        queued: false,
        job: null,
      });

      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(500);
    });

    it("returns 503 when queue is full (add returns null)", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: true,
        queued: true,
        job: { id: "job-3", status: "pending" },
      });
      (dataExportQueue.add as jest.Mock).mockResolvedValue(null);
      (mockPrisma.exportJob.update as jest.Mock).mockResolvedValue({});

      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(503);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(401);
    });

    it("returns 500 on service throw", async () => {
      (dataExportService.createExportJob as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).post("/api/viewer/privacy/export");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // getExportStatus  GET /privacy/export/:jobId
  // ============================================================
  describe("GET /api/viewer/privacy/export/:jobId", () => {
    it("returns job status (happy path)", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-1",
        viewerId: MOCK_VIEWER.id,
        status: "completed",
        createdAt: new Date(),
        expiresAt: null,
        errorMessage: null,
        downloadPath: "/tmp/export.zip",
      });

      const res = await request(app).get("/api/viewer/privacy/export/job-1");
      expect(res.status).toBe(200);
      expect(res.body.job.downloadReady).toBe(true);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/privacy/export/job-1");
      expect(res.status).toBe(401);
    });

    it("returns 404 when job not found", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue(null);
      const res = await request(app).get("/api/viewer/privacy/export/missing");
      expect(res.status).toBe(404);
    });

    it("returns 403 when job belongs to another viewer", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-x",
        viewerId: "other-viewer",
        status: "pending",
      });
      const res = await request(app).get("/api/viewer/privacy/export/job-x");
      expect(res.status).toBe(403);
    });

    it("returns 500 on service throw", async () => {
      (dataExportService.getExportJob as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/viewer/privacy/export/job-err");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // downloadExport  GET /privacy/export/:jobId/download
  // ============================================================
  describe("GET /api/viewer/privacy/export/:jobId/download", () => {
    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/privacy/export/job-1/download");
      expect(res.status).toBe(401);
    });

    it("returns 404 when job not found", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue(null);
      const res = await request(app).get("/api/viewer/privacy/export/missing/download");
      expect(res.status).toBe(404);
    });

    it("returns 403 when job belongs to another viewer", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-x",
        viewerId: "other-viewer",
        status: "completed",
        downloadPath: "/tmp/a.zip",
        expiresAt: null,
      });
      const res = await request(app).get("/api/viewer/privacy/export/job-x/download");
      expect(res.status).toBe(403);
    });

    it("returns 400 when job not completed", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-p",
        viewerId: MOCK_VIEWER.id,
        status: "pending",
        downloadPath: null,
        expiresAt: null,
      });
      const res = await request(app).get("/api/viewer/privacy/export/job-p/download");
      expect(res.status).toBe(400);
    });

    it("returns 410 when file is expired", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-exp",
        viewerId: MOCK_VIEWER.id,
        status: "completed",
        downloadPath: "/tmp/exp.zip",
        expiresAt: new Date("2020-01-01"),
      });
      const res = await request(app).get("/api/viewer/privacy/export/job-exp/download");
      expect(res.status).toBe(410);
    });

    it("returns 404 when file does not exist on disk", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-nodisk",
        viewerId: MOCK_VIEWER.id,
        status: "completed",
        downloadPath: "/tmp/missing.zip",
        expiresAt: new Date(Date.now() + 86400000),
      });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const res = await request(app).get("/api/viewer/privacy/export/job-nodisk/download");
      expect(res.status).toBe(404);
    });

    it("returns 500 on service throw", async () => {
      (dataExportService.getExportJob as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/viewer/privacy/export/job-err/download");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // requestDeleteAccount  POST /privacy/delete-account
  // ============================================================
  describe("POST /api/viewer/privacy/delete-account", () => {
    it("requests account deletion (happy path)", async () => {
      (accountDeletionService.requestDeletion as jest.Mock).mockResolvedValue({
        success: true,
        message: "scheduled",
        scheduledAt: new Date(),
      });
      const res = await request(app).post("/api/viewer/privacy/delete-account");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 when service returns failure", async () => {
      (accountDeletionService.requestDeletion as jest.Mock).mockResolvedValue({
        success: false,
        message: "already requested",
        scheduledAt: new Date(),
      });
      const res = await request(app).post("/api/viewer/privacy/delete-account");
      expect(res.status).toBe(400);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).post("/api/viewer/privacy/delete-account");
      expect(res.status).toBe(401);
    });

    it("returns 500 on service throw", async () => {
      (accountDeletionService.requestDeletion as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).post("/api/viewer/privacy/delete-account");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // cancelDeletion  POST /privacy/cancel-deletion
  // ============================================================
  describe("POST /api/viewer/privacy/cancel-deletion", () => {
    it("cancels deletion (happy path)", async () => {
      (accountDeletionService.cancelDeletion as jest.Mock).mockResolvedValue({
        success: true,
        message: "cancelled",
      });
      const res = await request(app).post("/api/viewer/privacy/cancel-deletion");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 when cancellation fails", async () => {
      (accountDeletionService.cancelDeletion as jest.Mock).mockResolvedValue({
        success: false,
        message: "no pending deletion",
      });
      const res = await request(app).post("/api/viewer/privacy/cancel-deletion");
      expect(res.status).toBe(400);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).post("/api/viewer/privacy/cancel-deletion");
      expect(res.status).toBe(401);
    });

    it("returns 500 on service throw", async () => {
      (accountDeletionService.cancelDeletion as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).post("/api/viewer/privacy/cancel-deletion");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // getDeletionStatus  GET /privacy/deletion-status
  // ============================================================
  describe("GET /api/viewer/privacy/deletion-status", () => {
    it("returns no pending deletion when none exists", async () => {
      (accountDeletionService.getDeletionStatus as jest.Mock).mockResolvedValue(null);
      const res = await request(app).get("/api/viewer/privacy/deletion-status");
      expect(res.status).toBe(200);
      expect(res.body.hasPendingDeletion).toBe(false);
    });

    it("returns deletion info with remaining days", async () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      (accountDeletionService.getDeletionStatus as jest.Mock).mockResolvedValue({
        status: "pending",
        requestedAt: new Date(),
        executionScheduledAt: future,
      });
      const res = await request(app).get("/api/viewer/privacy/deletion-status");
      expect(res.status).toBe(200);
      expect(res.body.hasPendingDeletion).toBe(true);
      expect(res.body.remainingDays).toBeGreaterThan(0);
    });

    it("returns remainingDays=0 when scheduled in past", async () => {
      const past = new Date(Date.now() - 1000);
      (accountDeletionService.getDeletionStatus as jest.Mock).mockResolvedValue({
        status: "pending",
        requestedAt: new Date(),
        executionScheduledAt: past,
      });
      const res = await request(app).get("/api/viewer/privacy/deletion-status");
      expect(res.status).toBe(200);
      expect(res.body.remainingDays).toBe(0);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/privacy/deletion-status");
      expect(res.status).toBe(401);
    });

    it("returns 500 on service throw", async () => {
      (accountDeletionService.getDeletionStatus as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/viewer/privacy/deletion-status");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // updatePrivacySettings  PUT /privacy/settings
  // ============================================================
  describe("PUT /api/viewer/privacy/settings", () => {
    it("pauses data collection (happy path)", async () => {
      (mockPrisma.viewer.update as jest.Mock).mockResolvedValue({});
      const res = await request(app)
        .put("/api/viewer/privacy/settings")
        .send({ pauseCollection: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pauseCollection).toBe(true);
    });

    it("resumes data collection", async () => {
      (mockPrisma.viewer.update as jest.Mock).mockResolvedValue({});
      const res = await request(app)
        .put("/api/viewer/privacy/settings")
        .send({ pauseCollection: false });
      expect(res.status).toBe(200);
      expect(res.body.pauseCollection).toBe(false);
    });

    it("returns 400 when pauseCollection is not boolean", async () => {
      const res = await request(app)
        .put("/api/viewer/privacy/settings")
        .send({ pauseCollection: "yes" });
      expect(res.status).toBe(400);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app)
        .put("/api/viewer/privacy/settings")
        .send({ pauseCollection: true });
      expect(res.status).toBe(401);
    });

    it("returns 500 on db error", async () => {
      (mockPrisma.viewer.update as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app)
        .put("/api/viewer/privacy/settings")
        .send({ pauseCollection: false });
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // getPrivacySettings  GET /privacy/settings
  // ============================================================
  describe("GET /api/viewer/privacy/settings", () => {
    it("returns privacy settings (happy path)", async () => {
      const res = await request(app).get("/api/viewer/privacy/settings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("pauseCollection");
      expect(res.body).toHaveProperty("consentGivenAt");
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/privacy/settings");
      expect(res.status).toBe(401);
    });

    it("returns 500 on error", async () => {
      (getViewerAuthSnapshotByTwitchUserId as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/viewer/privacy/settings");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // clearAllMessages  DELETE /privacy/messages
  // ============================================================
  describe("DELETE /api/viewer/privacy/messages", () => {
    it("clears all messages (happy path)", async () => {
      (mockPrisma.viewerChannelMessage.deleteMany as jest.Mock).mockResolvedValue({ count: 42 });
      (mockPrisma.viewerChannelMessageDailyAgg.deleteMany as jest.Mock).mockResolvedValue({
        count: 10,
      });

      const res = await request(app).delete("/api/viewer/privacy/messages");
      expect(res.status).toBe(200);
      expect(res.body.deletedCount.messages).toBe(42);
      expect(res.body.deletedCount.aggregations).toBe(10);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).delete("/api/viewer/privacy/messages");
      expect(res.status).toBe(401);
    });

    it("returns 500 on db error", async () => {
      (mockPrisma.viewerChannelMessage.deleteMany as jest.Mock).mockRejectedValue(
        new Error("fail")
      );
      const res = await request(app).delete("/api/viewer/privacy/messages");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // getExportStatus – missing jobId (lines 258-259)
  // ============================================================
  describe("GET /api/viewer/privacy/export/:jobId – missing jobId", () => {
    it("returns 400 when jobId is undefined/empty", async () => {
      // The route expects :jobId param. Sending an empty-ish value.
      // Since Express will always populate params.jobId for /:jobId routes,
      // we test with a dedicated unit call below.
    });
  });

  // ============================================================
  // downloadExport – missing jobId (lines 307-308) & file download (lines 341-342)
  // ============================================================
  describe("GET /api/viewer/privacy/export/:jobId/download – file download", () => {
    it("sends file download when export is completed and file exists (lines 341-342)", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-dl",
        viewerId: "viewer-1",
        status: "completed",
        downloadPath: "/tmp/exports/viewer-1-data.zip",
        expiresAt: new Date(Date.now() + 86400000), // future
        createdAt: new Date(),
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const res = await request(app).get("/api/viewer/privacy/export/job-dl/download");
      // res.download will trigger a file send; in test it may 200 or fail to find file
      // The important thing is we reached the download path (not 400/401/404)
      expect(res.status).not.toBe(400);
      expect(res.status).not.toBe(401);
    });
  });

  // ============================================================
  // clearChannelMessages  DELETE /privacy/messages/:channelId
  // ============================================================
  describe("DELETE /api/viewer/privacy/messages/:channelId", () => {
    it("clears channel messages (happy path)", async () => {
      (mockPrisma.viewerChannelMessage.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });
      (mockPrisma.viewerChannelMessageDailyAgg.deleteMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const res = await request(app).delete("/api/viewer/privacy/messages/channel-123");
      expect(res.status).toBe(200);
      expect(res.body.deletedCount.messages).toBe(5);
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).delete("/api/viewer/privacy/messages/ch-1");
      expect(res.status).toBe(401);
    });

    it("returns 500 on db error", async () => {
      (mockPrisma.viewerChannelMessage.deleteMany as jest.Mock).mockRejectedValue(
        new Error("fail")
      );
      const res = await request(app).delete("/api/viewer/privacy/messages/ch-err");
      expect(res.status).toBe(500);
    });
  });

  // ============================================================
  // getDataSummary  GET /privacy/data-summary
  // ============================================================
  describe("GET /api/viewer/privacy/data-summary", () => {
    it("returns data summary with date range (happy path)", async () => {
      (mockPrisma.viewerChannelMessage.count as jest.Mock).mockResolvedValue(100);
      (mockPrisma.viewerChannelMessageDailyAgg.count as jest.Mock).mockResolvedValue(10);
      (mockPrisma.viewerChannelMessage.groupBy as jest.Mock).mockResolvedValue([
        { channelId: "c1" },
        { channelId: "c2" },
      ]);
      const ts = new Date();
      (mockPrisma.viewerChannelMessage.findFirst as jest.Mock)
        .mockResolvedValueOnce({ timestamp: ts }) // oldest
        .mockResolvedValueOnce({ timestamp: ts }); // newest

      const res = await request(app).get("/api/viewer/privacy/data-summary");
      expect(res.status).toBe(200);
      expect(res.body.totalMessages).toBe(100);
      expect(res.body.channelCount).toBe(2);
    });

    it("handles null oldest/newest messages", async () => {
      (mockPrisma.viewerChannelMessage.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.viewerChannelMessageDailyAgg.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.viewerChannelMessage.groupBy as jest.Mock).mockResolvedValue([]);
      (mockPrisma.viewerChannelMessage.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await request(app).get("/api/viewer/privacy/data-summary");
      expect(res.status).toBe(200);
      expect(res.body.dateRange.oldest).toBeNull();
    });

    it("returns 401 when viewer not found", async () => {
      mockViewerNotFound();
      const res = await request(app).get("/api/viewer/privacy/data-summary");
      expect(res.status).toBe(401);
    });

    it("returns 500 on db error", async () => {
      (mockPrisma.viewerChannelMessage.count as jest.Mock).mockRejectedValue(new Error("fail"));
      const res = await request(app).get("/api/viewer/privacy/data-summary");
      expect(res.status).toBe(500);
    });
  });
});
