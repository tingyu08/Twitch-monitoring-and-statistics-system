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

describe("Message Stats Performance Tests", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should complete Message Stats Query within threshold", async () => {
    const viewer = await prisma.viewer.findFirst();
    if (!viewer) {
      console.warn("No viewer found, skipping performance test");
      return; // Skip if no data
    }

    const stat = await prisma.viewerChannelMessageDailyAgg.findFirst({
      where: { viewerId: viewer.id },
    });

    if (!stat) {
      console.warn("No stats found, skipping performance test");
      return; // Skip if no data
    }

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const result = await measurePerformance(
      "Message Stats Query",
      async () => {
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

        await prisma.viewerChannelMessage.findFirst({
          where: { viewerId: viewer.id, channelId: stat.channelId },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        });

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
      10,
      PERFORMANCE_THRESHOLDS.API_RESPONSE_P95_MS
    );

    console.log(`Message Stats Query: P95=${result.p95TimeMs}ms, Avg=${result.avgTimeMs}ms`);
    expect(result.passed).toBe(true);
  }, 30000);

  it("should complete Aggregation Query within threshold", async () => {
    const viewer = await prisma.viewer.findFirst();
    if (!viewer) {
      console.warn("No viewer found, skipping aggregation test");
      return;
    }

    const result = await measurePerformance(
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
      10,
      PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS
    );

    console.log(`Aggregation Query: P95=${result.p95TimeMs}ms, Avg=${result.avgTimeMs}ms`);
    expect(result.passed).toBe(true);
  }, 30000);

  it("should complete Batch Read within threshold", async () => {
    const viewer = await prisma.viewer.findFirst();
    if (!viewer) {
      console.warn("No viewer found, skipping batch read test");
      return;
    }

    const result = await measurePerformance(
      "Batch Read",
      async () => {
        await prisma.viewerChannelMessageDailyAgg.findMany({
          where: { viewerId: viewer.id },
          orderBy: { date: "desc" },
          take: 100,
        });

        await prisma.viewerChannelMessage.findMany({
          where: { viewerId: viewer.id },
          orderBy: { timestamp: "desc" },
          take: 100,
        });
      },
      10,
      PERFORMANCE_THRESHOLDS.AGGREGATION_QUERY_MS
    );

    console.log(`Batch Read: P95=${result.p95TimeMs}ms, Avg=${result.avgTimeMs}ms`);
    expect(result.passed).toBe(true);
  }, 30000);
});
