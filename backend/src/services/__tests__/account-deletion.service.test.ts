jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomUUID: jest.fn(() => "12345678-1234-1234-1234-123456789abc"),
}));

jest.mock("../../db/prisma", () => ({
  prisma: {
    viewer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deletionRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    privacyAuditLog: {
      create: jest.fn(),
    },
    dataRetentionLog: {
      create: jest.fn(),
    },
    viewerChannelMessage: {
      deleteMany: jest.fn(),
    },
    viewerDashboardLayout: {
      deleteMany: jest.fn(),
    },
    viewerPrivacyConsent: {
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";
import { AccountDeletionService } from "../account-deletion.service";

describe("AccountDeletionService", () => {
  const viewerId = "viewer-1";
  let service: AccountDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-02-26T10:00:00.000Z"));
    service = new AccountDeletionService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("requestDeletion", () => {
    it("returns failure when viewer does not exist", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.requestDeletion(viewerId);

      expect(result).toEqual({
        success: false,
        message: "找不到觀眾記錄",
      });
      expect(prisma.deletionRequest.create).not.toHaveBeenCalled();
    });

    it("returns existing pending request without creating another", async () => {
      const pendingRequest = {
        id: "dr-1",
        viewerId,
        requestedAt: new Date("2026-02-20T00:00:00.000Z"),
        status: "pending",
        executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
      };
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        deletionRequest: pendingRequest,
      });

      const result = await service.requestDeletion(viewerId);

      expect(result).toEqual({
        success: false,
        message: "已有待處理的刪除請求",
        deletionRequest: pendingRequest,
        scheduledAt: pendingRequest.executionScheduledAt,
      });
      expect(prisma.deletionRequest.delete).not.toHaveBeenCalled();
      expect(prisma.deletionRequest.create).not.toHaveBeenCalled();
    });

    it("creates a new request when no previous request exists", async () => {
      const createdRequest = {
        id: "dr-new",
        viewerId,
        requestedAt: new Date("2026-02-26T10:00:00.000Z"),
        status: "pending",
        executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
      };

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        deletionRequest: null,
      });
      (prisma.deletionRequest.create as jest.Mock).mockResolvedValueOnce(createdRequest);

      const result = await service.requestDeletion(viewerId);

      expect(prisma.deletionRequest.delete).not.toHaveBeenCalled();
      expect(prisma.deletionRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            viewerId,
            status: "pending",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.deletionRequest).toEqual(createdRequest);
    });

    it("deletes cancelled request and creates a new pending request", async () => {
      const cancelledRequest = {
        id: "dr-cancelled",
        viewerId,
        requestedAt: new Date("2026-02-01T00:00:00.000Z"),
        status: "cancelled",
        executionScheduledAt: new Date("2026-02-08T00:00:00.000Z"),
      };
      const createdRequest = {
        id: "dr-new",
        viewerId,
        requestedAt: new Date("2026-02-26T10:00:00.000Z"),
        status: "pending",
        executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
      };

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        deletionRequest: cancelledRequest,
      });
      (prisma.deletionRequest.create as jest.Mock).mockResolvedValueOnce(createdRequest);

      const result = await service.requestDeletion(viewerId);

      expect(prisma.deletionRequest.delete).toHaveBeenCalledWith({
        where: { id: "dr-cancelled" },
      });
      expect(prisma.deletionRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            viewerId,
            status: "pending",
            executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
          }),
        })
      );
      expect(prisma.privacyAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ viewerId, action: "deletion_requested" }),
        })
      );
      expect(prisma.dataRetentionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            viewerId,
            action: "user_delete",
            reason: "使用者請求刪除帳號",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.deletionRequest).toEqual(createdRequest);
      expect(result.scheduledAt).toEqual(new Date("2026-03-05T10:00:00.000Z"));
    });

    it("creates new request when previous request is non-pending and non-cancelled", async () => {
      const executedRequest = {
        id: "dr-executed",
        viewerId,
        requestedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "executed",
        executionScheduledAt: new Date("2026-01-08T00:00:00.000Z"),
      };
      const createdRequest = {
        id: "dr-retry",
        viewerId,
        requestedAt: new Date("2026-02-26T10:00:00.000Z"),
        status: "pending",
        executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
      };

      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        deletionRequest: executedRequest,
      });
      (prisma.deletionRequest.create as jest.Mock).mockResolvedValueOnce(createdRequest);

      const result = await service.requestDeletion(viewerId);

      expect(prisma.deletionRequest.delete).not.toHaveBeenCalled();
      expect(prisma.deletionRequest.create).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.deletionRequest).toEqual(createdRequest);
    });
  });

  describe("cancelDeletion", () => {
    it("returns failure when deletion request does not exist", async () => {
      (prisma.deletionRequest.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.cancelDeletion(viewerId);

      expect(result).toEqual({ success: false, message: "找不到刪除請求" });
      expect(prisma.deletionRequest.update).not.toHaveBeenCalled();
    });

    it("returns failure for non-pending request", async () => {
      (prisma.deletionRequest.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "dr-1",
        viewerId,
        status: "executed",
        executionScheduledAt: new Date("2026-02-20T00:00:00.000Z"),
      });

      const result = await service.cancelDeletion(viewerId);

      expect(result).toEqual({
        success: false,
        message: "無法撤銷，刪除請求狀態為: executed",
      });
      expect(prisma.deletionRequest.update).not.toHaveBeenCalled();
    });

    it("cancels pending request and writes audit/retention logs", async () => {
      const request = {
        id: "dr-1",
        viewerId,
        status: "pending",
        executionScheduledAt: new Date("2026-03-05T10:00:00.000Z"),
      };
      const updatedRequest = { ...request, status: "cancelled" };

      (prisma.deletionRequest.findUnique as jest.Mock).mockResolvedValueOnce(request);
      (prisma.deletionRequest.update as jest.Mock).mockResolvedValueOnce(updatedRequest);

      const result = await service.cancelDeletion(viewerId);

      expect(prisma.deletionRequest.update).toHaveBeenCalledWith({
        where: { viewerId },
        data: { status: "cancelled" },
      });
      expect(prisma.privacyAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ viewerId, action: "deletion_cancelled" }),
        })
      );
      expect(prisma.dataRetentionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ viewerId, action: "user_cancel" }),
        })
      );
      expect(result).toEqual({
        success: true,
        message: "刪除請求已撤銷",
        deletionRequest: updatedRequest,
      });
    });
  });

  describe("executeAnonymization", () => {
    it("returns failure when viewer does not exist", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const result = await service.executeAnonymization(viewerId);

      expect(result).toEqual({ success: false, message: "找不到觀眾記錄" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("returns failure when viewer is already anonymized", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        isAnonymized: true,
      });

      const result = await service.executeAnonymization(viewerId);

      expect(result).toEqual({ success: false, message: "此帳號已被匿名化" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("runs full deletion orchestration in a single transaction", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        isAnonymized: false,
      });

      const tx = {
        viewer: { update: jest.fn().mockResolvedValue({}) },
        viewerChannelMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 12 }) },
        viewerDashboardLayout: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
        viewerPrivacyConsent: { delete: jest.fn().mockResolvedValue({ viewerId }) },
        deletionRequest: { update: jest.fn().mockResolvedValue({}) },
        privacyAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
      );

      const result = await service.executeAnonymization(viewerId);

      expect(tx.viewer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: viewerId },
          data: expect.objectContaining({
            twitchUserId: "DELETED_USER_12345678",
            displayName: "已刪除用戶",
            avatarUrl: null,
            isAnonymized: true,
          }),
        })
      );
      expect(tx.viewerChannelMessage.deleteMany).toHaveBeenCalledWith({ where: { viewerId } });
      expect(tx.viewerDashboardLayout.deleteMany).toHaveBeenCalledWith({ where: { viewerId } });
      expect(tx.viewerPrivacyConsent.delete).toHaveBeenCalledWith({ where: { viewerId } });
      expect(tx.deletionRequest.update).toHaveBeenCalledWith({
        where: { viewerId },
        data: { status: "executed" },
      });
      expect(tx.privacyAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ viewerId, action: "account_deleted" }),
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        "AccountDeletion",
        expect.stringContaining("已匿名化")
      );
      expect(result).toEqual({
        success: true,
        message: "帳號已成功匿名化",
        deletedCounts: {
          messages: 12,
          dashboardLayouts: 3,
          privacyConsent: true,
        },
      });
    });

    it("tolerates optional record failures and still succeeds", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        isAnonymized: false,
      });

      const tx = {
        viewer: { update: jest.fn().mockResolvedValue({}) },
        viewerChannelMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
        viewerDashboardLayout: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        viewerPrivacyConsent: { delete: jest.fn().mockRejectedValue(new Error("missing consent")) },
        deletionRequest: { update: jest.fn().mockRejectedValue(new Error("missing request")) },
        privacyAuditLog: { create: jest.fn().mockResolvedValue({}) },
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
      );

      const result = await service.executeAnonymization(viewerId);

      expect(result).toEqual({
        success: true,
        message: "帳號已成功匿名化",
        deletedCounts: {
          messages: 2,
          dashboardLayouts: 1,
          privacyConsent: false,
        },
      });
    });

    it("propagates transaction failures for rollback handling", async () => {
      (prisma.viewer.findUnique as jest.Mock).mockResolvedValueOnce({
        id: viewerId,
        isAnonymized: false,
      });

      const tx = {
        viewer: { update: jest.fn().mockRejectedValue(new Error("update failed")) },
      };

      (prisma.$transaction as jest.Mock).mockImplementationOnce(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
      );

      await expect(service.executeAnonymization(viewerId)).rejects.toThrow("update failed");
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe("status and pending lookups", () => {
    it("getDeletionStatus proxies prisma findUnique", async () => {
      const request = { id: "dr-1", viewerId, status: "pending" };
      (prisma.deletionRequest.findUnique as jest.Mock).mockResolvedValueOnce(request);

      const result = await service.getDeletionStatus(viewerId);

      expect(result).toEqual(request);
      expect(prisma.deletionRequest.findUnique).toHaveBeenCalledWith({ where: { viewerId } });
    });

    it("getPendingDeletions queries pending requests due by now", async () => {
      const pending = [{ id: "dr-1", viewerId, status: "pending" }];
      (prisma.deletionRequest.findMany as jest.Mock).mockResolvedValueOnce(pending);

      const result = await service.getPendingDeletions();

      expect(result).toEqual(pending);
      expect(prisma.deletionRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: "pending",
          executionScheduledAt: { lte: new Date("2026-02-26T10:00:00.000Z") },
        },
      });
    });
  });

  describe("executeExpiredDeletions", () => {
    it("tracks success/failure and reports errors for rejected and failed results", async () => {
      const pending = [
        { id: "dr-1", viewerId: "viewer-1" },
        { id: "dr-2", viewerId: "viewer-2" },
        { id: "dr-3", viewerId: "viewer-3" },
      ];

      jest.spyOn(service, "getPendingDeletions").mockResolvedValueOnce(pending as any);
      jest
        .spyOn(service, "executeAnonymization")
        .mockResolvedValueOnce({ success: true, message: "ok" })
        .mockResolvedValueOnce({ success: false, message: "already anonymized" })
        .mockRejectedValueOnce(new Error("db timeout"));

      const result = await service.executeExpiredDeletions();

      expect(result).toEqual({ processed: 3, success: 1, failed: 2 });
      expect(logger.error).toHaveBeenCalledWith(
        "AccountDeletion",
        "匿名化失敗 (batch rejected)",
        expect.any(Error)
      );
      expect(logger.error).toHaveBeenCalledWith(
        "AccountDeletion",
        "匿名化失敗 (viewerId: viewer-2): already anonymized"
      );
    });
  });
});
