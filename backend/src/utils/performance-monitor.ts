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
}

// 預設配置
const DEFAULT_CONFIG = {
  slowThreshold: 1000, // 慢速請求閾值 (ms)
  maxMetricsHistory: 1000, // 最多保存多少個請求記錄
  enableLogging: false, // 關閉日誌輸出
};

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private config = DEFAULT_CONFIG;

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
export type { PerformanceMetric, PerformanceStats };

// 導出類別本身 (用於測試或自訂配置)
export { PerformanceMonitor };
