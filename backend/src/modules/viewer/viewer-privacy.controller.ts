/**
 * Viewer Privacy Controller
 * 處理觀眾隱私相關的 API
 *
 * Story 2.5: 觀眾隱私與授權控制 (GDPR 合規)
 */

import { Request, Response } from "express";
import { prisma } from "../../db/prisma";
import {
  privacyConsentService,
  type PrivacySettingsUpdate,
} from "../../services/privacy-consent.service";
import { accountDeletionService } from "../../services/account-deletion.service";
import { dataExportService } from "../../services/data-export.service";
import { dataExportQueue } from "../../utils/data-export-queue";
import { logger } from "../../utils/logger";
import { getViewerAuthSnapshotByTwitchUserId } from "./viewer-auth-snapshot.service";
import * as fs from "fs";
import * as path from "path";

// Helper: 從 request 獲取 viewerId
const getViewerFromRequest = async (req: Request) => {
  const twitchUserId = (req as { user?: { twitchUserId?: string } }).user?.twitchUserId;

  if (!twitchUserId) {
    return null;
  }

  return getViewerAuthSnapshotByTwitchUserId(twitchUserId);
};

export class ViewerPrivacyController {
  private static exportQueueInitialized = false;

  constructor() {
    if (!ViewerPrivacyController.exportQueueInitialized) {
      dataExportQueue.process(async ({ exportJobId }) => {
        await dataExportService.processExportJob(exportJobId);
      });
      ViewerPrivacyController.exportQueueInitialized = true;
    }
  }

  // ==================== 細粒度隱私設定 ====================

  /**
   * 獲取細粒度隱私同意設定
   * GET /api/viewer/privacy/consent
   */
  async getConsentSettings(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const settings = await privacyConsentService.getAllConsentStatus(viewer.id);

      res.json({
        success: true,
        settings,
        hasConsent: !!viewer.consentedAt,
        consentGivenAt: viewer.consentedAt,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "獲取隱私同意設定失敗:", error);
      res.status(500).json({ error: "獲取隱私同意設定失敗" });
    }
  }

  /**
   * 更新細粒度隱私同意設定
   * PATCH /api/viewer/privacy/consent
   */
  async updateConsentSettings(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const settings: PrivacySettingsUpdate = req.body;

      // 驗證輸入
      const validFields = [
        "collectDailyWatchTime",
        "collectWatchTimeDistribution",
        "collectMonthlyAggregates",
        "collectChatMessages",
        "collectInteractions",
        "collectInteractionFrequency",
        "collectBadgeProgress",
        "collectFootprintData",
        "collectRankings",
        "collectRadarAnalysis",
      ];

      const invalidFields = Object.keys(settings).filter((key) => !validFields.includes(key));

      if (invalidFields.length > 0) {
        res.status(400).json({
          error: `無效的欄位: ${invalidFields.join(", ")}`,
        });
        return;
      }

      // 更新設定
      const updatedConsent = await privacyConsentService.updateConsent(viewer.id, settings);

      // 記錄審計日誌
      await prisma.privacyAuditLog.create({
        data: {
          viewerId: viewer.id,
          action: "consent_updated",
          details: JSON.stringify({
            updatedFields: Object.keys(settings),
            newValues: settings,
          }),
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      });

      res.json({
        success: true,
        message: "隱私設定已更新",
        settings: updatedConsent,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "更新隱私同意設定失敗:", error);
      res.status(500).json({ error: "更新隱私同意設定失敗" });
    }
  }

  /**
   * 接受所有隱私同意（首次登入使用）
   * POST /api/viewer/privacy/consent/accept-all
   */
  async acceptAllConsent(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      // 建立預設同意記錄
      const consent = await privacyConsentService.createDefaultConsent(viewer.id);

      // 更新觀眾的同意時間
      await prisma.viewer.update({
        where: { id: viewer.id },
        data: {
          consentedAt: new Date(),
          consentVersion: 1,
        },
      });

      // 記錄審計日誌
      await prisma.privacyAuditLog.create({
        data: {
          viewerId: viewer.id,
          action: "consent_accepted",
          details: JSON.stringify({
            consentVersion: consent.consentVersion,
            acceptedAll: true,
          }),
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
      });

      res.json({
        success: true,
        message: "已接受所有隱私同意",
        consent,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "接受隱私同意失敗:", error);
      res.status(500).json({ error: "接受隱私同意失敗" });
    }
  }

  // ==================== 資料匯出 ====================

  /**
   * 請求資料匯出
   * POST /api/viewer/privacy/export
   */
  async requestExport(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const result = await dataExportService.createExportJob(viewer.id);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      if (!result.job?.id) {
        res.status(500).json({ error: "匯出任務建立失敗" });
        return;
      }

      if (result.queued) {
        const queuedId = await dataExportQueue.add({ exportJobId: result.job.id }, 5);
        if (!queuedId) {
          await prisma.exportJob.update({
            where: { id: result.job.id },
            data: { status: "failed", errorMessage: "Queue is full" },
          });
          res.status(503).json({ error: "匯出系統繁忙，請稍後再試" });
          return;
        }
      }

      res.json({
        success: true,
        message: result.queued ? "資料匯出任務已排入佇列" : result.message,
        jobId: result.job?.id,
        status: result.job?.status,
        expiresAt: result.job?.expiresAt,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "請求資料匯出失敗:", error);
      res.status(500).json({ error: "請求資料匯出失敗" });
    }
  }

  /**
   * 獲取匯出任務狀態
   * GET /api/viewer/privacy/export/:jobId
   */
  async getExportStatus(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);
      const { jobId } = req.params;

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const job = await dataExportService.getExportJob(jobId);

      if (!job) {
        res.status(404).json({ error: "找不到匯出任務" });
        return;
      }

      // 確認是該觀眾的任務
      if (job.viewerId !== viewer.id) {
        res.status(403).json({ error: "無權存取此匯出任務" });
        return;
      }

      res.json({
        success: true,
        job: {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          expiresAt: job.expiresAt,
          errorMessage: job.errorMessage,
          downloadReady: job.status === "completed" && !!job.downloadPath,
        },
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "獲取匯出狀態失敗:", error);
      res.status(500).json({ error: "獲取匯出狀態失敗" });
    }
  }

  /**
   * 下載匯出檔案
   * GET /api/viewer/privacy/export/:jobId/download
   */
  async downloadExport(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);
      const { jobId } = req.params;

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const job = await dataExportService.getExportJob(jobId);

      if (!job) {
        res.status(404).json({ error: "找不到匯出任務" });
        return;
      }

      if (job.viewerId !== viewer.id) {
        res.status(403).json({ error: "無權存取此匯出任務" });
        return;
      }

      if (job.status !== "completed" || !job.downloadPath) {
        res.status(400).json({ error: "匯出尚未完成或檔案不存在" });
        return;
      }

      // 檢查檔案是否過期
      if (job.expiresAt && new Date() > job.expiresAt) {
        res.status(410).json({ error: "匯出檔案已過期" });
        return;
      }

      // 檢查檔案是否存在
      if (!fs.existsSync(job.downloadPath)) {
        res.status(404).json({ error: "匯出檔案不存在" });
        return;
      }

      // 發送檔案下載
      const fileName = path.basename(job.downloadPath);
      res.download(job.downloadPath, fileName);
    } catch (error) {
      logger.error("ViewerPrivacy", "下載匯出檔案失敗:", error);
      res.status(500).json({ error: "下載匯出檔案失敗" });
    }
  }

  // ==================== 帳號刪除 ====================

  /**
   * 請求刪除帳號
   * POST /api/viewer/privacy/delete-account
   */
  async requestDeleteAccount(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const result = await accountDeletionService.requestDeletion(viewer.id);

      if (!result.success) {
        res.status(400).json({
          error: result.message,
          scheduledAt: result.scheduledAt,
        });
        return;
      }

      res.json({
        success: true,
        message: result.message,
        scheduledAt: result.scheduledAt,
        coolingPeriodDays: 7,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "請求刪除帳號失敗:", error);
      res.status(500).json({ error: "請求刪除帳號失敗" });
    }
  }

  /**
   * 撤銷刪除請求
   * POST /api/viewer/privacy/cancel-deletion
   */
  async cancelDeletion(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const result = await accountDeletionService.cancelDeletion(viewer.id);

      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "撤銷刪除請求失敗:", error);
      res.status(500).json({ error: "撤銷刪除請求失敗" });
    }
  }

  /**
   * 獲取刪除請求狀態
   * GET /api/viewer/privacy/deletion-status
   */
  async getDeletionStatus(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const deletionRequest = await accountDeletionService.getDeletionStatus(viewer.id);

      if (!deletionRequest) {
        res.json({
          hasPendingDeletion: false,
        });
        return;
      }

      // 計算剩餘天數
      const now = new Date();
      const scheduledAt = deletionRequest.executionScheduledAt;
      const remainingMs = scheduledAt.getTime() - now.getTime();
      const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

      res.json({
        hasPendingDeletion: deletionRequest.status === "pending",
        status: deletionRequest.status,
        requestedAt: deletionRequest.requestedAt,
        scheduledAt: deletionRequest.executionScheduledAt,
        remainingDays: remainingDays > 0 ? remainingDays : 0,
        canCancel: deletionRequest.status === "pending",
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "獲取刪除狀態失敗:", error);
      res.status(500).json({ error: "獲取刪除狀態失敗" });
    }
  }

  // ==================== 既有功能（保留兼容性）====================

  /**
   * 更新隱私設定（暫停/恢復資料收集）
   * PUT /api/viewer/privacy/settings
   */
  async updatePrivacySettings(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const { pauseCollection } = req.body;

      if (typeof pauseCollection !== "boolean") {
        res.status(400).json({ error: "pauseCollection 必須是布林值" });
        return;
      }

      await prisma.viewer.update({
        where: { id: viewer.id },
        data: {
          isAnonymized: pauseCollection,
        },
      });

      res.json({
        success: true,
        message: pauseCollection ? "已暫停資料收集" : "已恢復資料收集",
        pauseCollection,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "更新隱私設定失敗:", error);
      res.status(500).json({ error: "更新隱私設定失敗" });
    }
  }

  /**
   * 獲取當前隱私設定
   * GET /api/viewer/privacy/settings
   */
  async getPrivacySettings(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      res.json({
        pauseCollection: viewer.isAnonymized,
        consentGivenAt: viewer.consentedAt,
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "獲取隱私設定失敗:", error);
      res.status(500).json({ error: "獲取隱私設定失敗" });
    }
  }

  /**
   * 清除所有訊息資料
   * DELETE /api/viewer/privacy/messages
   */
  async clearAllMessages(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const deletedMessages = await prisma.viewerChannelMessage.deleteMany({
        where: { viewerId: viewer.id },
      });

      const deletedAggs = await prisma.viewerChannelMessageDailyAgg.deleteMany({
        where: { viewerId: viewer.id },
      });

      logger.info(
        "ViewerPrivacy",
        `已清除觀眾 ${viewer.id} 的資料: ${deletedMessages.count} 則訊息, ${deletedAggs.count} 筆聚合記錄`
      );

      res.json({
        success: true,
        message: "已清除所有訊息資料",
        deletedCount: {
          messages: deletedMessages.count,
          aggregations: deletedAggs.count,
        },
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "清除訊息資料失敗:", error);
      res.status(500).json({ error: "清除訊息資料失敗" });
    }
  }

  /**
   * 清除特定頻道的訊息資料
   * DELETE /api/viewer/privacy/messages/:channelId
   */
  async clearChannelMessages(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);
      const { channelId } = req.params;

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      if (!channelId) {
        res.status(400).json({ error: "channelId 為必填" });
        return;
      }

      const deletedMessages = await prisma.viewerChannelMessage.deleteMany({
        where: {
          viewerId: viewer.id,
          channelId,
        },
      });

      const deletedAggs = await prisma.viewerChannelMessageDailyAgg.deleteMany({
        where: {
          viewerId: viewer.id,
          channelId,
        },
      });

      logger.info(
        "ViewerPrivacy",
        `已清除觀眾 ${viewer.id} 在頻道 ${channelId} 的資料: ${deletedMessages.count} 則訊息, ${deletedAggs.count} 筆聚合記錄`
      );

      res.json({
        success: true,
        message: `已清除頻道 ${channelId} 的訊息資料`,
        deletedCount: {
          messages: deletedMessages.count,
          aggregations: deletedAggs.count,
        },
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "清除頻道訊息資料失敗:", error);
      res.status(500).json({ error: "清除頻道訊息資料失敗" });
    }
  }

  /**
   * 獲取資料統計
   * GET /api/viewer/privacy/data-summary
   */
  async getDataSummary(req: Request, res: Response): Promise<void> {
    try {
      const viewer = await getViewerFromRequest(req);

      if (!viewer) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const messageCount = await prisma.viewerChannelMessage.count({
        where: { viewerId: viewer.id },
      });

      const aggCount = await prisma.viewerChannelMessageDailyAgg.count({
        where: { viewerId: viewer.id },
      });

      const channelCount = await prisma.viewerChannelMessage.groupBy({
        by: ["channelId"],
        where: { viewerId: viewer.id },
      });

      const oldestMessage = await prisma.viewerChannelMessage.findFirst({
        where: { viewerId: viewer.id },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true },
      });

      const newestMessage = await prisma.viewerChannelMessage.findFirst({
        where: { viewerId: viewer.id },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });

      res.json({
        totalMessages: messageCount,
        totalAggregations: aggCount,
        channelCount: channelCount.length,
        dateRange: {
          oldest: oldestMessage?.timestamp || null,
          newest: newestMessage?.timestamp || null,
        },
      });
    } catch (error) {
      logger.error("ViewerPrivacy", "獲取資料統計失敗:", error);
      res.status(500).json({ error: "獲取資料統計失敗" });
    }
  }
}
