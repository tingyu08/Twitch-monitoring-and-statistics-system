import type { Response } from "express";
import { recordConsent, getChannelStats, getFollowedChannels } from "./viewer.service";
import type { AuthRequest } from "../auth/auth.middleware";
import { logger } from "../../utils/logger";
import { cacheManager, CacheTTL, getAdaptiveTTL } from "../../utils/cache-manager";
import { CacheTags } from "../../constants";
import { getSingleStringValue, getStringWithDefault } from "../../utils/request-values";
import { getChannelGameStatsAndViewerTrends } from "../streamer/streamer.service";
import { getViewerMessageStats } from "./viewer-message-stats.service";

// Turso 雲端基準延遲約 800-1500ms，BFF 慢查詢門檻調高以減少誤報
const BFF_SLOW_QUERY_THRESHOLD_MS = Number(process.env.BFF_SLOW_QUERY_THRESHOLD_MS || 2000);

export class ViewerController {
  private readonly BFF_TIMEOUT_MS = 10000;
  public consent = async (req: AuthRequest, res: Response) => {
    if (!req.user || req.user.role !== "viewer" || !req.user.viewerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { consented, consentVersion } = (req.body ?? {}) as {
      consented?: boolean;
      consentVersion?: number;
    };

    if (!consented) {
      return res.status(400).json({ error: "consent is required" });
    }

    const updated = await recordConsent(req.user.viewerId, consentVersion ?? 1);
    return res.json({
      viewerId: updated.id,
      consentedAt: updated.consentedAt,
      consentVersion: updated.consentVersion,
    });
  };

  public getChannelStats = async (req: AuthRequest, res: Response) => {
    const requestStart = Date.now(); // 效能監控起點

    // 只要有 viewerId 即可 (Auth Middleware 已經檢查過權限了)
    if (!req.user || !req.user.viewerId) {
      return res.status(403).json({ error: "Forbidden: No viewer profile" });
    }

    const channelId = getSingleStringValue(req.params.channelId);

    if (!channelId) {
      return res.status(400).json({ error: "Channel ID is required" });
    }

    // 解析時間參數：優先使用 startDate/endDate，否則使用 days
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    let days: number | undefined;

    const startDateQuery = getSingleStringValue(req.query.startDate);
    const endDateQuery = getSingleStringValue(req.query.endDate);

    if (startDateQuery && endDateQuery) {
      startDate = new Date(startDateQuery);
      endDate = new Date(endDateQuery);

      // 驗證日期
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ error: "startDate must be before endDate" });
      }
    } else {
      days = parseInt(getStringWithDefault(req.query.days, "30"), 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: "days must be between 1 and 365" });
      }
    }

    try {
      const stats = await getChannelStats(req.user.viewerId, channelId, days, startDate, endDate);

      // 效能監控：僅記錄慢查詢 (> 200ms)
      const duration = Date.now() - requestStart;
      if (duration > 200) {
        logger.warn("ViewerAPI", `查詢偏慢：頻道 ${channelId} 耗時 ${duration}ms`);
      }

      return res.json(stats);
    } catch (err) {
      logger.error("ViewerAPI", "取得觀眾統計失敗", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  public getChannels = async (req: AuthRequest, res: Response) => {
    if (!req.user || !req.user.viewerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      // 獲取用戶追蹤的頻道 (真實資料)
      const channels = await getFollowedChannels(req.user.viewerId);
      return res.json(channels);
    } catch (err) {
      logger.error("ViewerAPI", "取得觀眾頻道列表失敗", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  /**
   * P0 BFF Endpoint: 聚合詳細頁所需的所有資料
   * 一次 API 呼叫返回：channelStats + messageStats + gameStats + viewerTrends
   */
  public getChannelDetailAll = async (req: AuthRequest, res: Response) => {
    const requestStart = Date.now();

    if (!req.user?.viewerId) {
      return res.status(403).json({ error: "Forbidden: No viewer profile" });
    }

    const channelId = getSingleStringValue(req.params.channelId);
    if (!channelId) {
      return res.status(400).json({ error: "Channel ID is required" });
    }

    // 解析查詢參數
    const days = parseInt(getStringWithDefault(req.query.days, "30"), 10);
    const rangeKey = days === 7 ? "7d" : days === 90 ? "90d" : "30d";

    if (isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: "days must be between 1 and 365" });
    }

    const viewerId = req.user.viewerId;

    // 使用快取
    const cacheKey = `channel-detail-all:${viewerId}:${channelId}:${days}d`;
    const ttl = getAdaptiveTTL(CacheTTL.MEDIUM, cacheManager);

    try {
      const result = await cacheManager.getOrSetWithTags(
        cacheKey,
        async () => {
          // 計算日期範圍
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(endDate.getDate() - days);

          // 並行查詢所有資料源，使用 Promise.allSettled 避免單點失敗
          const queryPromise = Promise.allSettled([
            getChannelStats(viewerId, channelId, days),
            getViewerMessageStats(viewerId, channelId, startDate.toISOString(), endDate.toISOString()),
            getChannelGameStatsAndViewerTrends(channelId, rangeKey),
          ]);

          let timeoutId: NodeJS.Timeout | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("BFF_TIMEOUT")), this.BFF_TIMEOUT_MS);
            timeoutId.unref?.();
          });

          const [channelStatsResult, messageStatsResult, analyticsResult] = await Promise.race([
            queryPromise,
            timeoutPromise,
          ]).finally(() => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          });

          // 提取成功的結果
          const channelStats =
            channelStatsResult.status === "fulfilled" ? channelStatsResult.value : null;
          const messageStats =
            messageStatsResult.status === "fulfilled" ? messageStatsResult.value : null;
          const gameStats =
            analyticsResult.status === "fulfilled" ? analyticsResult.value.gameStats : null;
          const viewerTrends =
            analyticsResult.status === "fulfilled" ? analyticsResult.value.viewerTrends : null;

          // 記錄失敗的請求
          if (channelStatsResult.status === "rejected") {
            logger.warn("BFF", "取得頻道統計失敗", channelStatsResult.reason);
          }
          if (messageStatsResult.status === "rejected") {
            logger.warn("BFF", "取得訊息統計失敗", messageStatsResult.reason);
          }
          if (analyticsResult.status === "rejected") {
            logger.warn("BFF", "取得頻道分析資料失敗", analyticsResult.reason);
          }

          return {
            channelStats,
            messageStats,
            gameStats,
            viewerTrends,
          };
        },
        ttl,
        [`viewer:${viewerId}`, `channel:${channelId}`, CacheTags.VIEWER_BFF]
      );

      const duration = Date.now() - requestStart;
      if (duration > BFF_SLOW_QUERY_THRESHOLD_MS) {
        logger.warn("BFF", `BFF 查詢偏慢：頻道 ${channelId} 耗時 ${duration}ms`);
      }

      return res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === "BFF_TIMEOUT") {
        logger.error("BFF", `BFF 查詢逾時（${this.BFF_TIMEOUT_MS}ms）：頻道 ${channelId}`);
        return res.status(504).json({ error: "Gateway Timeout" });
      }
      logger.error("BFF", "取得頻道詳細聚合資料失敗", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

}
