/**
 * Streamer Middleware
 *
 * 提供 Streamer 身份驗證中介層，避免重複的驗證邏輯
 */

import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth/auth.middleware";

/**
 * 要求請求者必須是 Streamer
 *
 * 使用方式：
 * router.get('/revenue/overview', requireStreamer, revenueController.getOverview);
 */
export const requireStreamer = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const streamerId = req.user?.streamerId;

  if (!streamerId) {
    res.status(403).json({ error: "Not a streamer" });
    return;
  }

  next();
};

/**
 * 要求請求者必須是 Streamer（異步版本）
 * 適用於需要進行資料庫查詢的驗證場景
 */
export const requireStreamerAsync = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const streamerId = req.user?.streamerId;

  if (!streamerId) {
    res.status(403).json({ error: "Not a streamer" });
    return;
  }

  // 如果需要額外的資料庫驗證，可以在這裡添加
  // 例如：檢查 streamer 是否被停用

  next();
};
