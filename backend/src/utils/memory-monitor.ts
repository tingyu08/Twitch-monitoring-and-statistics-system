/**
 * 記憶體監控器
 *
 * Render Free Tier 有 512MB RAM 限制
 * 此工具提供：
 * - 定期記憶體監控
 * - 記憶體超限警告
 * - 自動觸發 GC（如果可用）
 */

import { logger } from "./logger";

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

  constructor(
    warningThresholdMB: number = 400,
    criticalThresholdMB: number = 480
  ) {
    this.warningThresholdMB = warningThresholdMB;
    this.criticalThresholdMB = criticalThresholdMB;
  }

  /**
   * 啟動定期監控
   */
  start(intervalMs: number = 30000): void {
    if (this.monitorInterval) {
      logger.warn("MemoryMonitor", "Monitor already started");
      return;
    }

    logger.info(
      "MemoryMonitor",
      `啟動記憶體監控 (警戒: ${this.warningThresholdMB}MB, 危險: ${this.criticalThresholdMB}MB)`
    );

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
      logger.info("MemoryMonitor", "記憶體監控已停止");
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
    if (stats.heapUsed >= this.criticalThresholdMB) {
      this.handleCritical(stats);
    } else if (stats.heapUsed >= this.warningThresholdMB) {
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
  private handleWarning(stats: MemoryStats): void {
    const now = Date.now();

    // 冷卻時間內不重複警告
    if (now - this.lastWarningTime < this.warningCooldownMs) {
      return;
    }

    logger.warn(
      "MemoryMonitor",
      `⚠️ 記憶體使用接近警戒線: ${stats.heapUsed}MB / ${this.warningThresholdMB}MB`
    );

    this.lastWarningTime = now;

    // 嘗試觸發 GC
    this.tryGC();
  }

  /**
   * 處理記憶體危險
   */
  private handleCritical(stats: MemoryStats): void {
    logger.error(
      "MemoryMonitor",
      `🚨 記憶體使用超過危險線: ${stats.heapUsed}MB / ${this.criticalThresholdMB}MB`
    );

    // 強制觸發 GC
    this.tryGC();

    // 可以在這裡添加更激進的清理邏輯
    // 例如：清空快取、中斷長任務等
  }

  /**
   * 嘗試觸發 GC
   */
  private tryGC(): void {
    if (global.gc) {
      try {
        global.gc();
        logger.debug("MemoryMonitor", "已觸發 GC");

        // GC 後再次檢查
        setTimeout(() => {
          const afterGC = this.check();
          logger.debug(
            "MemoryMonitor",
            `GC 後記憶體: ${afterGC.heapUsed}MB`
          );
        }, 1000);
      } catch (error) {
        logger.error("MemoryMonitor", "GC 觸發失敗", error);
      }
    } else {
      logger.warn(
        "MemoryMonitor",
        "GC 不可用。請使用 --expose-gc 啟動 Node.js"
      );
    }
  }

  /**
   * 檢查是否接近記憶體限制
   */
  isNearLimit(): boolean {
    const stats = this.check();
    return stats.heapUsed >= this.warningThresholdMB;
  }

  /**
   * 檢查是否超過記憶體限制
   */
  isOverLimit(): boolean {
    const stats = this.check();
    return stats.heapUsed >= this.criticalThresholdMB;
  }
}

// 導出單例（Render Free Tier: 512MB 限制）
export const memoryMonitor = new MemoryMonitor(
  parseInt(process.env.MEMORY_WARNING_MB || "400"),
  parseInt(process.env.MEMORY_CRITICAL_MB || "480")
);

// 自動啟動監控（生產環境）
if (process.env.NODE_ENV === "production") {
  memoryMonitor.start(30000); // 每 30 秒檢查一次
}
