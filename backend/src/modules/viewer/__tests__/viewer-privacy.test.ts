import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

// Mock Services FIRST
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
jest.mock("../../../db/prisma", () => ({
  prisma: {
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
  },
}));

// Import prisma after mock
import { prisma as mockPrismaClient } from "../../../db/prisma";

// Mock Auth Middleware
jest.mock("../../auth/auth.middleware", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { twitchUserId: "test-twitch-id", role: "viewer" };
    next();
  },
}));

// Mock other controllers used in routes
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
jest.mock("../dashboard-layout.controller", () => ({
  dashboardLayoutController: {
    saveLayout: jest.fn(),
    getLayout: jest.fn(),
    resetLayout: jest.fn(),
  },
}));

// NOW import app and routes
const app = express();
app.use(express.json());
app.use(cookieParser());

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
    (mockPrismaClient.viewer.findUnique as jest.Mock).mockResolvedValue(
      mockViewer
    );
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
    });
  });

  describe("PATCH /privacy/consent", () => {
    it("should update consent settings", async () => {
      const updatePayload = { collectDailyWatchTime: false };
      (privacyConsentService.updateConsent as jest.Mock).mockResolvedValue(
        updatePayload
      );
      (mockPrismaClient.privacyAuditLog.create as jest.Mock).mockResolvedValue(
        {}
      );

      const res = await request(app)
        .patch("/api/viewer/privacy/consent")
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /privacy/consent/accept-all", () => {
    it("should accept all consents", async () => {
      (
        privacyConsentService.createDefaultConsent as jest.Mock
      ).mockResolvedValue({ consentVersion: 1 });
      (mockPrismaClient.viewer.update as jest.Mock).mockResolvedValue({});
      (mockPrismaClient.privacyAuditLog.create as jest.Mock).mockResolvedValue(
        {}
      );

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

  describe("GET /privacy/data-summary", () => {
    it("should return data summary", async () => {
      (
        mockPrismaClient.viewerChannelMessage.count as jest.Mock
      ).mockResolvedValue(100);
      (
        mockPrismaClient.viewerChannelMessageDailyAgg.count as jest.Mock
      ).mockResolvedValue(10);
      (
        mockPrismaClient.viewerChannelMessage.groupBy as jest.Mock
      ).mockResolvedValue([{ channelId: "c1" }]);
      (
        mockPrismaClient.viewerChannelMessage.findFirst as jest.Mock
      ).mockResolvedValue({ timestamp: new Date() });

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
