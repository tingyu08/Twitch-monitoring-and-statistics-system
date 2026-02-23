/**
 * 記憶體監控器
 *
 * Zeabur 免費層有 512MB RAM 限制
 * 此工具提供：
 * - 定期記憶體監控
 * - 記憶體超限警告
 * - 自動觸發 GC（如果可用）
 */

import { MEMORY_THRESHOLDS } from "./memory-thresholds";


interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

export class MemoryMonitor {
  private monitorInterval: NodeJS.Timeout | null = null;
  private warningThresholdMB: number;
  private criticalThresholdMB: number;
  private lastWarningTime: number = 0;
  private warningCooldownMs: number = 60000; // 1 分鐘內不重複警告
  private cachedStats: MemoryStats | null = null;
  private lastCachedAt = 0;
  private readonly CACHE_TTL_MS = 5000;

  constructor(warningThresholdMB: number = 400, criticalThresholdMB: number = 480) {
    this.warningThresholdMB = warningThresholdMB;
    this.criticalThresholdMB = criticalThresholdMB;
  }

  /**
   * 啟動定期監控
   */
  start(intervalMs: number = 30000): void {
    if (this.monitorInterval) {
      return;
    }

    this.monitorInterval = setInterval(() => {
      this.check();
    }, intervalMs);

    // Don't prevent Node.js from exiting
    if (this.monitorInterval.unref) {
      this.monitorInterval.unref();
    }
  }

  /**
   * 停止監控
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * 檢查當前記憶體使用量
   */
  check(): MemoryStats {
    const usage = process.memoryUsage();
    const stats = {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
    };

    // 檢查是否超過閾值
    if (stats.rss >= this.criticalThresholdMB) {
      this.handleCritical(stats);
    } else if (stats.rss >= this.warningThresholdMB) {
      this.handleWarning(stats);
    }

    return stats;
  }

  /**
   * 獲取當前記憶體統計（格式化）
   */
  getStats(): string {
    const stats = this.check();
    return (
      `Heap Used: ${stats.heapUsed}MB / ${stats.heapTotal}MB, ` +
      `RSS: ${stats.rss}MB, External: ${stats.external}MB`
    );
  }

  /**
   * 處理記憶體警告
   */
  private handleWarning(_stats: MemoryStats): void {
    const now = Date.now();

    // 冷卻時間內不重複警告
    if (now - this.lastWarningTime < this.warningCooldownMs) {
      return;
    }

    this.lastWarningTime = now;

    // 嘗試觸發 GC
    this.tryGC();
  }

  /**
   * 處理記憶體危險
   */
  private handleCritical(_stats: MemoryStats): void {
    // 強制觸發 GC（多次）
    this.tryGC();

    // 激進清理：清空快取
    this.clearCaches();
  }

  /**
   * 清空快取以釋放記憶體
   */
  private async clearCaches(): Promise<void> {
    try {
      // 清空快取管理器
      const { cacheManager } = await import("./cache-manager");
      if (cacheManager && typeof cacheManager.clear === "function") {
        cacheManager.clear();
      }
    } catch {
    }
  }

  /**
   * 嘗試觸發 GC
   */
  private tryGC(): void {
    if (global.gc) {
      try {
        global.gc();

        // GC 後再次檢查
        setTimeout(() => {
          this.check();
        }, 1000);
      } catch {
      }
    }
  }

  private getCachedStats(): MemoryStats {
    const now = Date.now();
    if (!this.cachedStats || now - this.lastCachedAt > this.CACHE_TTL_MS) {
      this.cachedStats = this.check();
      this.lastCachedAt = now;
    }
    return this.cachedStats;
  }

  /**
   * 檢查是否接近記憶體限制
   */
  isNearLimit(): boolean {
    return this.getCachedStats().rss >= this.warningThresholdMB;
  }

  /**
   * 檢查是否超過記憶體限制
   */
  isOverLimit(): boolean {
    return this.getCachedStats().rss >= this.criticalThresholdMB;
  }
}

// 導出單例（Zeabur 免費層: 512MB 限制）
// 使用統一的記憶體閾值常數
export const memoryMonitor = new MemoryMonitor(
  MEMORY_THRESHOLDS.WARNING_MB,
  MEMORY_THRESHOLDS.CRITICAL_MB
);

// 自動啟動監控（生產環境）
if (process.env.NODE_ENV === "production") {
  memoryMonitor.start(15000); // 從 30 秒縮短到 15 秒，更頻繁檢查
}
