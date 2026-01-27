/**
 * Account Deletion Service
 * 管理帳號刪除流程與匿名化
 *
 * Story 2.5: 觀眾隱私與授權控制
 */

import { prisma } from "../db/prisma";
import type { DeletionRequest } from "@prisma/client";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger";

// 冷靜期天數
const COOLING_PERIOD_DAYS = 7;

export interface DeletionRequestResult {
  success: boolean;
  message: string;
  deletionRequest?: DeletionRequest;
  scheduledAt?: Date;
}

export interface AnonymizationResult {
  success: boolean;
  message: string;
  deletedCounts?: {
    messages: number;
    dashboardLayouts: number;
    privacyConsent: boolean;
  };
}

export class AccountDeletionService {
  /**
   * 請求刪除帳號（開始 7 天冷靜期）
   */
  async requestDeletion(viewerId: string): Promise<DeletionRequestResult> {
    // 檢查觀眾是否存在
    const viewer = await prisma.viewer.findUnique({
      where: { id: viewerId },
      include: { deletionRequest: true },
    });

    if (!viewer) {
      return {
        success: false,
        message: "找不到觀眾記錄",
      };
    }

    // 檢查是否已有待處理的刪除請求
    if (viewer.deletionRequest) {
      if (viewer.deletionRequest.status === "pending") {
        return {
          success: false,
          message: "已有待處理的刪除請求",
          deletionRequest: viewer.deletionRequest,
          scheduledAt: viewer.deletionRequest.executionScheduledAt,
        };
      }

      // 如果之前的請求已取消，允許重新建立
      if (viewer.deletionRequest.status === "cancelled") {
        await prisma.deletionRequest.delete({
          where: { id: viewer.deletionRequest.id },
        });
      }
    }

    // 計算執行時間 (7 天後)
    const executionScheduledAt = new Date();
    executionScheduledAt.setDate(executionScheduledAt.getDate() + COOLING_PERIOD_DAYS);

    // 建立刪除請求
    const deletionRequest = await prisma.deletionRequest.create({
      data: {
        viewerId,
        executionScheduledAt,
        status: "pending",
      },
    });

    // 記錄審計日誌
    await prisma.privacyAuditLog.create({
      data: {
        viewerId,
        action: "deletion_requested",
        details: JSON.stringify({
          scheduledAt: executionScheduledAt.toISOString(),
          coolingPeriodDays: COOLING_PERIOD_DAYS,
        }),
      },
    });

    // 記錄保留日誌
    await prisma.dataRetentionLog.create({
      data: {
        viewerId,
        action: "user_delete",
        reason: "使用者請求刪除帳號",
      },
    });

    return {
      success: true,
      message: `帳號刪除請求已建立，將在 ${COOLING_PERIOD_DAYS} 天後執行`,
      deletionRequest,
      scheduledAt: executionScheduledAt,
    };
  }

  /**
   * 撤銷刪除請求（冷靜期內有效）
   */
  async cancelDeletion(viewerId: string): Promise<DeletionRequestResult> {
    const deletionRequest = await prisma.deletionRequest.findUnique({
      where: { viewerId },
    });

    if (!deletionRequest) {
      return {
        success: false,
        message: "找不到刪除請求",
      };
    }

    if (deletionRequest.status !== "pending") {
      return {
        success: false,
        message: `無法撤銷，刪除請求狀態為: ${deletionRequest.status}`,
      };
    }

    // 更新狀態為已取消
    const updated = await prisma.deletionRequest.update({
      where: { viewerId },
      data: { status: "cancelled" },
    });

    // 記錄審計日誌
    await prisma.privacyAuditLog.create({
      data: {
        viewerId,
        action: "deletion_cancelled",
        details: JSON.stringify({
          cancelledAt: new Date().toISOString(),
          originalScheduledAt: deletionRequest.executionScheduledAt.toISOString(),
        }),
      },
    });

    // 記錄保留日誌
    await prisma.dataRetentionLog.create({
      data: {
        viewerId,
        action: "user_cancel",
        reason: "使用者撤銷刪除請求",
      },
    });

    return {
      success: true,
      message: "刪除請求已撤銷",
      deletionRequest: updated,
    };
  }

  /**
   * 執行帳號匿名化
   * 這是不可逆的操作！
   */
  async executeAnonymization(viewerId: string): Promise<AnonymizationResult> {
    const viewer = await prisma.viewer.findUnique({
      where: { id: viewerId },
    });

    if (!viewer) {
      return {
        success: false,
        message: "找不到觀眾記錄",
      };
    }

    if (viewer.isAnonymized) {
      return {
        success: false,
        message: "此帳號已被匿名化",
      };
    }

    // 使用 transaction 確保資料一致性
    const anonymizedUserId = `DELETED_USER_${randomUUID().slice(0, 8)}`;

    const result = await prisma.$transaction(async (tx) => {
      // 1. 匿名化 Viewer 表
      await tx.viewer.update({
        where: { id: viewerId },
        data: {
          twitchUserId: anonymizedUserId,
          displayName: "已刪除用戶",
          avatarUrl: null,
          isAnonymized: true,
          anonymizedAt: new Date(),
          deletedAt: new Date(),
        },
      });

      // 2. 刪除敏感詳細記錄 - 聊天訊息
      const deletedMessages = await tx.viewerChannelMessage.deleteMany({
        where: { viewerId },
      });

      // 3. 刪除儀表板佈局
      const deletedLayouts = await tx.viewerDashboardLayout.deleteMany({
        where: { viewerId },
      });

      // 4. 刪除隱私同意記錄
      const deletedConsent = await tx.viewerPrivacyConsent
        .delete({
          where: { viewerId },
        })
        .catch((): null => null); // 可能不存在

      // 5. 更新刪除請求狀態
      await tx.deletionRequest
        .update({
          where: { viewerId },
          data: { status: "executed" },
        })
        .catch((): null => null); // 可能不存在

      // 6. 記錄審計日誌
      await tx.privacyAuditLog.create({
        data: {
          viewerId,
          action: "account_deleted",
          details: JSON.stringify({
            anonymizedUserId,
            deletedMessages: deletedMessages.count,
            deletedLayouts: deletedLayouts.count,
            executedAt: new Date().toISOString(),
          }),
        },
      });

      return {
        messages: deletedMessages.count,
        dashboardLayouts: deletedLayouts.count,
        privacyConsent: !!deletedConsent,
      };
    });

    logger.info(
      "AccountDeletion",
      `帳號 ${viewerId} 已匿名化: 刪除 ${result.messages} 則訊息, ${result.dashboardLayouts} 個佈局`
    );

    return {
      success: true,
      message: "帳號已成功匿名化",
      deletedCounts: result,
    };
  }

  /**
   * 獲取觀眾的刪除請求狀態
   */
  async getDeletionStatus(viewerId: string): Promise<DeletionRequest | null> {
    return prisma.deletionRequest.findUnique({
      where: { viewerId },
    });
  }

  /**
   * 獲取所有待執行的刪除請求（用於 Cron Job）
   */
  async getPendingDeletions(): Promise<DeletionRequest[]> {
    const now = new Date();

    return prisma.deletionRequest.findMany({
      where: {
        status: "pending",
        executionScheduledAt: {
          lte: now,
        },
      },
    });
  }

  /**
   * 執行所有到期的刪除請求（由 Cron Job 呼叫）
   */
  async executeExpiredDeletions(): Promise<{
    processed: number;
    success: number;
    failed: number;
  }> {
    const pendingDeletions = await this.getPendingDeletions();
    let success = 0;
    let failed = 0;

    for (const deletion of pendingDeletions) {
      const result = await this.executeAnonymization(deletion.viewerId);
      if (result.success) {
        success++;
      } else {
        failed++;
        logger.error("AccountDeletion", `匿名化失敗 (viewerId: ${deletion.viewerId}): ${result.message}`);
      }
    }

    return {
      processed: pendingDeletions.length,
      success,
      failed,
    };
  }
}

// 匯出單例
export const accountDeletionService = new AccountDeletionService();
