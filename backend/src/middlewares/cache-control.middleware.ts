/**
 * Cache-Control Middleware
 * P2 優化：為不同類型的 API 回應設置適當的快取策略
 */

import type { Request, Response, NextFunction } from "express";

/**
 * 為靜態資料設置長時間快取（5 分鐘）
 * 適用於：game-stats, viewer-trends 等變化較慢的資料
 */
export function staticDataCache(req: Request, res: Response, next: NextFunction) {
  // 設置快取 header
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  next();
}

/**
 * 為半靜態資料設置中等時間快取（30 秒）
 * 適用於：channels 列表等定期更新的資料
 */
export function semiStaticCache(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  next();
}

/**
 * 為動態資料設置短時間快取（10 秒）
 * 適用於：即時統計、訊息統計等
 */
export function dynamicCache(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "public, max-age=10, must-revalidate");
  next();
}

/**
 * 禁用快取
 * 適用於：認證相關、個人敏感資料
 */
export function noCache(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}
