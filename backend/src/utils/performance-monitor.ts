/**
 * API Performance Monitoring Middleware
 *
 * 提供以下功能：
 * - 追蹤 API 請求執行時間
 * - 記錄慢速查詢 (> 200ms)
 * - 提供效能統計端點
 * - 環境感知的日誌輸出
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

// 效能指標類型
interface PerformanceMetric {
  path: string;
  method: string;
  duration: number;
  statusCode: number;
  timestamp: Date;
}

// 效能統計類型
interface PerformanceStats {
  totalRequests: number;
  averageResponseTime: number;
  slowRequests: number;
  fastRequests: number;
  p50: number;
  p95: number;
  p99: number;
  requestsByPath: Record<
    string,
    {
      count: number;
      avgDuration: number;
      maxDuration: number;
      minDuration: number;
    }
  >;
  memory?: MemorySnapshot; // 記憶體使用情況
}

// 記憶體快照類型
interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  timestamp: Date;
}

// 預設配置
const DEFAULT_CONFIG = {
  slowThreshold: 1000, // 慢速請求閾值 (ms)
  maxMetricsHistory: 100, // Render Free Tier: 減少為 100 以節省記憶體
  enableLogging: false, // 關閉日誌輸出
  memoryWarningThresholdMB: 350, // 0.5GB 環境下的警告閾值
  memoryCheckIntervalMs: 30000, // 每 30 秒檢查記憶體
};

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private config = DEFAULT_CONFIG;
  private memoryCheckInterval?: NodeJS.Timeout;
  private lastMemoryWarning = 0;
  private readonly MEMORY_WARNING_COOLDOWN = 60000; // 1 分鐘只警告一次

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startMemoryMonitoring();
  }

  /**
   * Express 中間件 - 追蹤請求執行時間
   */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = process.hrtime.bigint();
      const startDate = new Date();

      // 在響應結束時記錄效能指標
      res.on("finish", () => {
        const endTime = process.hrtime.bigint();
        const durationNs = Number(endTime - startTime);
        const durationMs = durationNs / 1_000_000;

        const metric: PerformanceMetric = {
          path: req.path,
          method: req.method,
          duration: Math.round(durationMs * 100) / 100, // 保留兩位小數
          statusCode: res.statusCode,
          timestamp: startDate,
        };

        this.recordMetric(metric);
      });

      next();
    };
  }

  /**
   * 記錄效能指標
   */
  private recordMetric(metric: PerformanceMetric): void {
    // 保存指標
    this.metrics.push(metric);

    // 限制歷史記錄數量
    if (this.metrics.length > this.config.maxMetricsHistory) {
      this.metrics.shift();
    }

    // 日誌輸出
    if (this.config.enableLogging) {
      const isSlow = metric.duration > this.config.slowThreshold;
      const logLevel = isSlow ? "warn" : "debug";
      const slowTag = isSlow ? " [SLOW]" : "";

      logger[logLevel](
        "PERFORMANCE",
        `${metric.method} ${metric.path} - ${metric.duration}ms - ${metric.statusCode}${slowTag}`
      );
    }
  }

  /**
   * 取得效能統計
   */
  getStats(): PerformanceStats {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        averageResponseTime: 0,
        slowRequests: 0,
        fastRequests: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        requestsByPath: {},
      };
    }

    const durations = this.metrics.map((m) => m.duration).sort((a, b) => a - b);
    const total = durations.length;

    // 計算百分位數
    const getPercentile = (p: number): number => {
      const index = Math.ceil((p / 100) * total) - 1;
      return durations[Math.max(0, Math.min(index, total - 1))];
    };

    // 計算各路徑統計
    const requestsByPath: PerformanceStats["requestsByPath"] = {};
    for (const metric of this.metrics) {
      const key = `${metric.method} ${metric.path}`;
      if (!requestsByPath[key]) {
        requestsByPath[key] = {
          count: 0,
          avgDuration: 0,
          maxDuration: 0,
          minDuration: Infinity,
        };
      }
      const stats = requestsByPath[key];
      stats.count++;
      stats.avgDuration = (stats.avgDuration * (stats.count - 1) + metric.duration) / stats.count;
      stats.maxDuration = Math.max(stats.maxDuration, metric.duration);
      stats.minDuration = Math.min(stats.minDuration, metric.duration);
    }

    // 修正 minDuration 的 Infinity 值
    for (const key of Object.keys(requestsByPath)) {
      if (requestsByPath[key].minDuration === Infinity) {
        requestsByPath[key].minDuration = 0;
      }
      // 保留兩位小數
      requestsByPath[key].avgDuration = Math.round(requestsByPath[key].avgDuration * 100) / 100;
    }

    const slowRequests = this.metrics.filter((m) => m.duration > this.config.slowThreshold).length;

    return {
      totalRequests: total,
      averageResponseTime: Math.round((durations.reduce((a, b) => a + b, 0) / total) * 100) / 100,
      slowRequests,
      fastRequests: total - slowRequests,
      p50: getPercentile(50),
      p95: getPercentile(95),
      p99: getPercentile(99),
      requestsByPath,
      memory: this.getMemorySnapshot(), // 加入記憶體資訊
    };
  }

  /**
   * 重置效能指標
   */
  reset(): void {
    this.metrics = [];
  }

  /**
   * 取得原始指標 (用於測試)
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * 取得慢速請求列表
   */
  getSlowRequests(): PerformanceMetric[] {
    return this.metrics.filter((m) => m.duration > this.config.slowThreshold);
  }

  /**
   * 啟動記憶體監控（針對 0.5GB RAM 環境）
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.memoryCheckIntervalMs);

    // Don't prevent Node.js from exiting
    if (this.memoryCheckInterval.unref) {
      this.memoryCheckInterval.unref();
    }
  }

  /**
   * 檢查記憶體使用並在必要時發出警告
   */
  private checkMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    const rssMB = memUsage.rss / 1024 / 1024;

    // 如果 RSS 超過閾值且距上次警告超過冷卻時間
    if (
      rssMB > this.config.memoryWarningThresholdMB &&
      Date.now() - this.lastMemoryWarning > this.MEMORY_WARNING_COOLDOWN
    ) {
      logger.warn(
        "PERFORMANCE",
        `⚠️ High memory usage: ${rssMB.toFixed(0)}MB / 512MB (${((rssMB / 512) * 100).toFixed(1)}%)`
      );
      this.lastMemoryWarning = Date.now();

      // 建議觸發 GC（如果可用）
      if (global.gc) {
        logger.info("PERFORMANCE", "🧹 Triggering manual garbage collection");
        global.gc();
      } else {
        logger.info(
          "PERFORMANCE",
          "💡 Tip: Run with --expose-gc to enable manual GC"
        );
      }
    }
  }

  /**
   * 獲取記憶體快照
   */
  getMemorySnapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      timestamp: new Date(),
    };
  }

  /**
   * 停止監控（清理資源）
   */
  stop(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
  }
}

// 導出單例
export const performanceMonitor = new PerformanceMonitor();

// 效能日誌輔助函數
export const performanceLogger = {
  debug: (message: string, ...args: unknown[]) => logger.debug("PERFORMANCE", message, ...args),
  info: (message: string, ...args: unknown[]) => logger.info("PERFORMANCE", message, ...args),
  warn: (message: string, ...args: unknown[]) => logger.warn("PERFORMANCE", message, ...args),
  error: (message: string, ...args: unknown[]) => logger.error("PERFORMANCE", message, ...args),
};

// 導出類型
export type { PerformanceMetric, PerformanceStats, MemorySnapshot };

// 導出類別本身 (用於測試或自訂配置)
export { PerformanceMonitor };
