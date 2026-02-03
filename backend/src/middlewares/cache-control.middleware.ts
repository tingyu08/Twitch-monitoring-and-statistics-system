/**
 * Cache-Control Middleware
 * P2 優化：為不同類型的 API 回應設置適當的快取策略
 */

import type { Request, Response, NextFunction } from "express";

/**
 * 為靜態資料設置長時間快取（5 分鐘）
 * 適用於：game-stats, viewer-trends 等變化較慢的資料
 */
export function staticDataCache(_req: Request, res: Response, next: NextFunction) {
  // 設置快取 header
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  next();
}

/**
 * 為半靜態資料設置中等時間快取（30 秒）
 * 適用於：channels 列表等定期更新的資料
 */
export function semiStaticCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  next();
}

/**
 * 為動態資料設置短時間快取（10 秒）
 * 適用於：即時統計、訊息統計等
 */
export function dynamicCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "public, max-age=10, must-revalidate");
  next();
}

/**
 * P1 Fix: 為認證使用者的私有資料設置短時間快取（30 秒）
 * 適用於：/me/summary, /me/heatmap, /me/time-series 等私有端點
 * 使用 private 確保 CDN 不會快取，只有瀏覽器快取
 */
export function privateDataCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  next();
}

/**
 * P1 Fix: 為認證使用者的私有資料設置較長時間快取（2 分鐘）
 * 適用於：計算密集型的私有端點（如 heatmap）
 * 使用 private 確保 CDN 不會快取，只有瀏覽器快取
 */
export function privateStaticCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, max-age=120, stale-while-revalidate=240");
  next();
}

/**
 * 禁用快取
 * 適用於：認證相關、個人敏感資料
 */
export function noCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}
