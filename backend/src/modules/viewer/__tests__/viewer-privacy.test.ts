import request from "supertest";
import express from "express";

const app = express();
app.use(express.json());

// Mock Services
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
  },
}));

// Mock Prisma
const mockPrisma = {
  viewer: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  privacyAuditLog: {
    create: jest.fn(),
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
};

jest.mock("../../../db/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock other controllers used in viewer.routes.ts to avoid real instantiation matching issues
jest.mock("../viewer.controller", () => ({
  ViewerController: jest.fn().mockImplementation(() => ({
    consent: jest.fn(),
    getChannelStats: jest.fn(),
    getChannels: jest.fn(),
  })),
}));

jest.mock("../viewer-message-stats.controller", () => ({
  ViewerMessageStatsController: jest.fn().mockImplementation(() => ({
    getMessageStats: jest.fn(),
  })),
}));

jest.mock("../viewer-lifetime-stats.controller", () => ({
  viewerLifetimeStatsController: {
    getLifetimeStats: jest.fn(),
  },
}));

jest.mock("../dashboard-layout.controller", () => ({
  dashboardLayoutController: {
    saveLayout: jest.fn(),
    getLayout: jest.fn(),
    resetLayout: jest.fn(),
  },
}));

// Mock Auth Middleware
jest.mock("../../auth/auth.middleware", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { twitchUserId: "test-twitch-id", role: "viewer" };
    next();
  },
}));

// Mock the routes to avoid import issues for now, OR import them if they work.
// Since we suspect viewer.routes.ts has issues, let's TRY to import them now that we mocked controllers.
// If it fails, we will revert to using a mocked router for the test file to pass (proving test structure is good).
// But we want to test the ROUTES. So check if real routes load.
// If not, we found a bug in routes.

// import { viewerApiRoutes } from "../viewer.routes";
// app.use("/api/viewer", viewerApiRoutes);

// For now, let's Mock viewer.routes to ensure the test file ITSELF is valid
// And allow unit testing of CONTROLLER logic via our own router if needed,
// OR just trust the controller unit tests?
// No, this is an integration test for ROUTES.
// Let's try to import the real routes again.
// If it fails, I will investigate viewer.routes.ts again.

// RE-ENABLING REAL ROUTES IMPORT CHECK
import { viewerApiRoutes } from "../viewer.routes";
app.use("/api/viewer", viewerApiRoutes);

import { privacyConsentService } from "../../../services/privacy-consent.service";
import { accountDeletionService } from "../../../services/account-deletion.service";
import { dataExportService } from "../../../services/data-export.service";

describe("Viewer Privacy Routes", () => {
  const mockViewer = {
    id: "viewer-1",
    twitchUserId: "test-twitch-id",
    displayName: "Test User",
    consentedAt: new Date(),
    isAnonymized: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.viewer.findUnique as jest.Mock).mockResolvedValue(mockViewer);
  });

  describe("GET /privacy/consent", () => {
    it("should return consent settings", async () => {
      const mockSettings = { collectDailyWatchTime: true };
      (
        privacyConsentService.getAllConsentStatus as jest.Mock
      ).mockResolvedValue(mockSettings);

      const res = await request(app).get("/api/viewer/privacy/consent");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings).toEqual(mockSettings);
      expect(res.body.hasConsent).toBe(true);
    });
  });

  describe("PATCH /privacy/consent", () => {
    it("should update consent settings", async () => {
      const updatePayload = { collectDailyWatchTime: false };
      const updatedSettings = { collectDailyWatchTime: false };

      (privacyConsentService.updateConsent as jest.Mock).mockResolvedValue(
        updatedSettings
      );

      const res = await request(app)
        .patch("/api/viewer/privacy/consent")
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings).toEqual(updatedSettings);
    });
  });

  describe("POST /privacy/consent/accept-all", () => {
    it("should accept all consents", async () => {
      const mockConsent = { consentVersion: 1 };
      (
        privacyConsentService.createDefaultConsent as jest.Mock
      ).mockResolvedValue(mockConsent);

      const res = await request(app).post(
        "/api/viewer/privacy/consent/accept-all"
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /privacy/export", () => {
    it("should request data export", async () => {
      (dataExportService.createExportJob as jest.Mock).mockResolvedValue({
        success: true,
        message: "Export started",
        job: { id: "job-1", status: "pending" },
      });

      const res = await request(app).post("/api/viewer/privacy/export");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBe("job-1");
    });
  });

  describe("GET /privacy/export/:jobId", () => {
    it("should return export status", async () => {
      (dataExportService.getExportJob as jest.Mock).mockResolvedValue({
        id: "job-1",
        viewerId: mockViewer.id,
        status: "completed",
        downloadPath: "/tmp/file.zip",
      });

      const res = await request(app).get("/api/viewer/privacy/export/job-1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.job.downloadReady).toBe(true);
    });
  });

  describe("GET /privacy/data-summary", () => {
    it("should return data summary", async () => {
      (mockPrisma.viewerChannelMessage.count as jest.Mock).mockResolvedValue(
        100
      );
      (
        mockPrisma.viewerChannelMessageDailyAgg.count as jest.Mock
      ).mockResolvedValue(10);
      (mockPrisma.viewerChannelMessage.groupBy as jest.Mock).mockResolvedValue([
        { channelId: "c1" },
      ]);
      (mockPrisma.viewerChannelMessage.findFirst as jest.Mock)
        .mockResolvedValueOnce({ timestamp: new Date() })
        .mockResolvedValueOnce({ timestamp: new Date() });

      const res = await request(app).get("/api/viewer/privacy/data-summary");

      expect(res.status).toBe(200);
      expect(res.body.totalMessages).toBe(100);
    });
  });

  describe("POST /privacy/delete-account", () => {
    it("should request account deletion", async () => {
      (accountDeletionService.requestDeletion as jest.Mock).mockResolvedValue({
        success: true,
        message: "Deletion scheduled",
        scheduledAt: new Date(),
      });

      const res = await request(app).post("/api/viewer/privacy/delete-account");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /privacy/cancel-deletion", () => {
    it("should cancel account deletion", async () => {
      (accountDeletionService.cancelDeletion as jest.Mock).mockResolvedValue({
        success: true,
        message: "Deletion cancelled",
      });

      const res = await request(app).post(
        "/api/viewer/privacy/cancel-deletion"
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
