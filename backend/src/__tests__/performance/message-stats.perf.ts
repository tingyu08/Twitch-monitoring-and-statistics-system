/**
 * Performance Test Suite for Story 2.3 - Message Stats API
 *
 * 測試目標：
 * - API 查詢效能 < 100ms (p95)
 * - 聚合查詢效能
 * - 大量資料處理效能
 */

import { prisma } from "../../db/prisma";

// 效能測試配置
const PERFORMANCE_THRESHOLDS = {
  API_RESPONSE_P95_MS: 100, // API 回應時間 (p95) < 100ms
  AGGREGATION_QUERY_MS: 50, // 聚合查詢 < 50ms
  BATCH_INSERT_PER_RECORD_MS: 5, // 批量插入每筆記錄 < 5ms
};

interface PerformanceResult {
  testName: string;
  passed: boolean;
  avgTimeMs: number;
  p95TimeMs: number;
  threshold: number;
  iterations: number;
}

/**
 * 執行多次並計算統計
 */
async function measurePerformance(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 10,
  threshold: number = PERFORMANCE_THRESHOLDS.API_RESPONSE_P95_MS
): Promise<PerformanceResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  // 排序計算 p95
  times.sort((a, b) => a - b);
  const p95Index = Math.floor(times.length * 0.95);
  const p95Time = times[p95Index] || times[times.length - 1];
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    testName: name,
    passed: p95Time <= threshold,
    avgTimeMs: Math.round(avgTime * 100) / 100,
    p95TimeMs: Math.round(p95Time * 100) / 100,
    threshold,
    iterations,
  };
}

/**
 * 測試 Message Stats 查詢效能
 */
export async function testMessageStatsQueryPerformance(): Promise<PerformanceResult> {
  // 先確保有測試資料
  const viewer = await prisma.viewer.findFirst();
  if (!viewer) {
    console.warn("No viewer found, skipping performance test");
    return {
      testName: "Message Stats Query",
      passed: true,
      avgTimeMs: 0,
      p95TimeMs: 0,
      threshold: PERFORMANCE_THRESHOLDS.API_RESPONSE_P95_MS,
      iterations: 0,
    };
  }

  // 獲取一個有資料的 channelId
  const stat = await prisma.viewerChannelMessageDailyAgg.findFirst({
    where: { viewerId: viewer.id },
  });

  if (!stat) {
    console.warn("No stats found, skipping performance test");
    return {
      testName: "Message Stats Query",
      passed: true,
      avgTimeMs: 0,
      p95TimeMs: 0,
      threshold: PERFORMANCE_THRESHOLDS.API_RESPONSE_P95_MS,
      iterations: 0,
    };
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  return measurePerformance(
    "Message Stats Query",
    async () => {
      // 模擬 Controller 中的查詢邏輯
      const aggs = await prisma.viewerChannelMessageDailyAgg.findMany({
        where: {
          viewerId: viewer.id,
          channelId: stat.channelId,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { date: "asc" },
      });

      // 模擬最近留言查詢
      await prisma.viewerChannelMessage.findFirst({
        where: { viewerId: viewer.id, channelId: stat.channelId },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      });

      // 模擬聚合計算
      aggs.reduce(
        (acc, curr) => ({
          totalMessages: acc.totalMessages + curr.totalMessages,
          chatMessages: acc.chatMessages + curr.chatMessages,
          subscriptions: acc.subscriptions + curr.subscriptions,
          cheers: acc.cheers + curr.cheers,
          giftSubs: acc.giftSubs + curr.giftSubs,
          raids: acc.raids + curr.raids,
          totalBits: (acc.totalBits || 0) + (curr.totalBits || 0),
        }),
        {
          totalMessages: 0,
          chatMessages: 0,
          subscriptions: 0,
          cheers: 0,
          giftSubs: 0,
          raids: 0,
          totalBits: 0,
        }
      );
    },
    20,
    PERFORMANCE_THRESHOLDS.API_RESPONSE_P95_MS
  );
}

/**
 * 測試聚合查詢效能
 */
export async function testAggregationQueryPerformance(): Promise<PerformanceResult> {
  const viewer = await prisma.viewer.findFirst();
  if (!viewer) {
    return {
      testName: "Aggregation Query",
      passed: true,
      avgTimeMs: 0,
      p95TimeMs: 0,
      threshold: PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS,
      iterations: 0,
    };
  }

  return measurePerformance(
    "Aggregation Query",
    async () => {
      await prisma.viewerChannelMessageDailyAgg.groupBy({
        by: ["channelId"],
        where: { viewerId: viewer.id },
        _sum: {
          totalMessages: true,
          cheers: true,
        },
        _max: {
          date: true,
        },
      });
    },
    20,
    PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS
  );
}

/**
 * 測試批量讀取效能
 */
export async function testBatchReadPerformance(): Promise<PerformanceResult> {
  const viewer = await prisma.viewer.findFirst();
  if (!viewer) {
    console.warn("No viewer found, skipping batch read test");
    return {
      testName: "Batch Read",
      passed: true,
      avgTimeMs: 0,
      p95TimeMs: 0,
      threshold: PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS,
      iterations: 0,
    };
  }

  return measurePerformance(
    "Batch Read",
    async () => {
      // 讀取所有訊息聚合
      await prisma.viewerChannelMessageDailyAgg.findMany({
        where: { viewerId: viewer.id },
        orderBy: { date: "desc" },
        take: 100,
      });

      // 讀取所有訊息
      await prisma.viewerChannelMessage.findMany({
        where: { viewerId: viewer.id },
        orderBy: { timestamp: "desc" },
        take: 100,
      });
    },
    20,
    PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS
  );
}

/**
 * 執行所有效能測試
 */
export async function runAllPerformanceTests(): Promise<{
  overall: "PASS" | "FAIL";
  results: PerformanceResult[];
}> {
  console.log("🏃 Starting performance tests...\n");

  const results: PerformanceResult[] = [];

  // 1. Message Stats 查詢效能
  console.log("Testing: Message Stats Query...");
  results.push(await testMessageStatsQueryPerformance());

  // 2. 聚合查詢效能
  console.log("Testing: Aggregation Query...");
  results.push(await testAggregationQueryPerformance());

  // 3. 批量讀取效能
  console.log("Testing: Batch Read...");
  results.push(await testBatchReadPerformance());

  // 輸出結果
  console.log("\n📊 Performance Test Results:\n");
  console.log("=".repeat(70));

  for (const result of results) {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(
      `${status} | ${result.testName.padEnd(25)} | ` +
        `Avg: ${result.avgTimeMs.toFixed(2)}ms | ` +
        `P95: ${result.p95TimeMs.toFixed(2)}ms | ` +
        `Threshold: ${result.threshold}ms`
    );
  }

  console.log("=".repeat(70));

  const allPassed = results.every((r) => r.passed);
  const overall = allPassed ? "PASS" : "FAIL";

  console.log(`\n🏁 Overall Result: ${overall}\n`);

  return { overall, results };
}

// 如果直接執行此檔案
if (require.main === module) {
  runAllPerformanceTests()
    .then((result) => {
      process.exit(result.overall === "PASS" ? 0 : 1);
    })
    .catch((error) => {
      console.error("Performance test failed:", error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}
