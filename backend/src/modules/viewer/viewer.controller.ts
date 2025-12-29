import type { Response } from "express";
import {
  recordConsent,
  getChannelStats,
  getFollowedChannels,
} from "./viewer.service";
import type { AuthRequest } from "../auth/auth.middleware";

export class ViewerController {
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

    const { channelId } = req.params;

    if (!channelId) {
      return res.status(400).json({ error: "Channel ID is required" });
    }

    // 解析時間參數：優先使用 startDate/endDate，否則使用 days
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    let days: number | undefined;

    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate as string);
      endDate = new Date(req.query.endDate as string);

      // 驗證日期
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      if (startDate > endDate) {
        return res
          .status(400)
          .json({ error: "startDate must be before endDate" });
      }
    } else {
      days = parseInt((req.query.days as string) || "30");
      if (isNaN(days) || days < 1 || days > 365) {
        return res
          .status(400)
          .json({ error: "days must be between 1 and 365" });
      }
    }

    try {
      const stats = await getChannelStats(
        req.user.viewerId,
        channelId,
        days,
        startDate,
        endDate
      );

      // 效能監控：僅記錄慢查詢 (> 200ms)
      const duration = Date.now() - requestStart;
      if (duration > 200) {
        console.warn(
          `[API Performance Warning] Slow query: ${duration}ms for channel ${channelId}`
        );
      }

      return res.json(stats);
    } catch (err) {
      console.error("Error getting viewer stats:", err);
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
      console.error("Error getting viewer channels:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
