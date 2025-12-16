/**
 * Viewer Privacy Controller
 * 處理觀眾隱私相關的 API，包括暫停收集和清除資料
 */

import { Request, Response } from "express";
import { prisma } from "../../db/prisma";

export class ViewerPrivacyController {
  /**
   * 更新隱私設定（暫停/恢復資料收集）
   * PUT /api/viewer/privacy/settings
   */
  async updatePrivacySettings(req: Request, res: Response): Promise<void> {
    try {
      const twitchUserId = (req as { user?: { twitchUserId?: string } }).user
        ?.twitchUserId;

      if (!twitchUserId) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const { pauseCollection } = req.body;

      if (typeof pauseCollection !== "boolean") {
        res.status(400).json({ error: "pauseCollection 必須是布林值" });
        return;
      }

      // 查找觀眾記錄
      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId },
      });

      if (!viewer) {
        res.status(404).json({ error: "找不到觀眾記錄" });
        return;
      }

      // 更新隱私設定
      // 使用 isAnonymized 欄位來控制（true = 暫停收集，false = 允許收集）
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
      console.error("更新隱私設定失敗:", error);
      res.status(500).json({ error: "更新隱私設定失敗" });
    }
  }

  /**
   * 獲取當前隱私設定
   * GET /api/viewer/privacy/settings
   */
  async getPrivacySettings(req: Request, res: Response): Promise<void> {
    try {
      const twitchUserId = (req as { user?: { twitchUserId?: string } }).user
        ?.twitchUserId;

      if (!twitchUserId) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId },
      });

      if (!viewer) {
        res.status(404).json({ error: "找不到觀眾記錄" });
        return;
      }

      res.json({
        pauseCollection: viewer.isAnonymized,
        consentGivenAt: viewer.consentedAt,
      });
    } catch (error) {
      console.error("獲取隱私設定失敗:", error);
      res.status(500).json({ error: "獲取隱私設定失敗" });
    }
  }

  /**
   * 清除所有訊息資料
   * DELETE /api/viewer/privacy/messages
   */
  async clearAllMessages(req: Request, res: Response): Promise<void> {
    try {
      const twitchUserId = (req as { user?: { twitchUserId?: string } }).user
        ?.twitchUserId;

      if (!twitchUserId) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId },
      });

      if (!viewer) {
        res.status(404).json({ error: "找不到觀眾記錄" });
        return;
      }

      // 刪除詳細訊息記錄
      const deletedMessages = await prisma.viewerChannelMessage.deleteMany({
        where: { viewerId: viewer.id },
      });

      // 刪除聚合記錄
      const deletedAggs = await prisma.viewerChannelMessageDailyAgg.deleteMany({
        where: { viewerId: viewer.id },
      });

      console.log(
        `🗑️ 已清除觀眾 ${viewer.id} 的資料: ${deletedMessages.count} 則訊息, ${deletedAggs.count} 筆聚合記錄`
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
      console.error("清除訊息資料失敗:", error);
      res.status(500).json({ error: "清除訊息資料失敗" });
    }
  }

  /**
   * 清除特定頻道的訊息資料
   * DELETE /api/viewer/privacy/messages/:channelId
   */
  async clearChannelMessages(req: Request, res: Response): Promise<void> {
    try {
      const twitchUserId = (req as { user?: { twitchUserId?: string } }).user
        ?.twitchUserId;
      const { channelId } = req.params;

      if (!twitchUserId) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      if (!channelId) {
        res.status(400).json({ error: "channelId 為必填" });
        return;
      }

      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId },
      });

      if (!viewer) {
        res.status(404).json({ error: "找不到觀眾記錄" });
        return;
      }

      // 刪除該頻道的詳細訊息記錄
      const deletedMessages = await prisma.viewerChannelMessage.deleteMany({
        where: {
          viewerId: viewer.id,
          channelId,
        },
      });

      // 刪除該頻道的聚合記錄
      const deletedAggs = await prisma.viewerChannelMessageDailyAgg.deleteMany({
        where: {
          viewerId: viewer.id,
          channelId,
        },
      });

      console.log(
        `🗑️ 已清除觀眾 ${viewer.id} 在頻道 ${channelId} 的資料: ${deletedMessages.count} 則訊息, ${deletedAggs.count} 筆聚合記錄`
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
      console.error("清除頻道訊息資料失敗:", error);
      res.status(500).json({ error: "清除頻道訊息資料失敗" });
    }
  }

  /**
   * 獲取資料統計（用於顯示將被刪除的資料量）
   * GET /api/viewer/privacy/data-summary
   */
  async getDataSummary(req: Request, res: Response): Promise<void> {
    try {
      const twitchUserId = (req as { user?: { twitchUserId?: string } }).user
        ?.twitchUserId;

      if (!twitchUserId) {
        res.status(401).json({ error: "未授權" });
        return;
      }

      const viewer = await prisma.viewer.findUnique({
        where: { twitchUserId },
      });

      if (!viewer) {
        res.status(404).json({ error: "找不到觀眾記錄" });
        return;
      }

      // 統計訊息數量
      const messageCount = await prisma.viewerChannelMessage.count({
        where: { viewerId: viewer.id },
      });

      // 統計聚合記錄數量
      const aggCount = await prisma.viewerChannelMessageDailyAgg.count({
        where: { viewerId: viewer.id },
      });

      // 統計涉及的頻道數量
      const channelCount = await prisma.viewerChannelMessage.groupBy({
        by: ["channelId"],
        where: { viewerId: viewer.id },
      });

      // 獲取最早和最近的記錄時間
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
      console.error("獲取資料統計失敗:", error);
      res.status(500).json({ error: "獲取資料統計失敗" });
    }
  }
}
