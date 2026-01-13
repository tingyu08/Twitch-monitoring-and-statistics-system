/**
 * Stats Worker - 統計計算用的 Web Worker
 * 將複雜計算移到背景執行緒，避免阻塞主執行緒
 */

// 定義 Worker 可接收的訊息類型
interface WorkerMessage {
  type: "CALCULATE_RETENTION" | "AGGREGATE_STATS" | "SORT_LEADERBOARD";
  payload: unknown;
  requestId: string;
}

// 監聽來自主執行緒的訊息
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, requestId } = event.data;

  try {
    let result: unknown;

    switch (type) {
      case "CALCULATE_RETENTION":
        result = calculateRetention(payload as RetentionPayload);
        break;
      case "AGGREGATE_STATS":
        result = aggregateStats(payload as StatsPayload);
        break;
      case "SORT_LEADERBOARD":
        result = sortLeaderboard(payload as LeaderboardPayload);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // 回傳計算結果
    self.postMessage({ requestId, success: true, result });
  } catch (error) {
    self.postMessage({
      requestId,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ============ 計算函數 ============

interface RetentionPayload {
  sessions: { startTime: number; endTime: number; viewerCount: number }[];
  intervalMinutes: number;
}

function calculateRetention(payload: RetentionPayload) {
  const { sessions, intervalMinutes } = payload;
  const intervalMs = intervalMinutes * 60 * 1000;

  // 計算每個時間區間的平均觀眾數
  const buckets: Map<number, { total: number; count: number }> = new Map();

  for (const session of sessions) {
    const bucketStart = Math.floor(session.startTime / intervalMs) * intervalMs;
    const existing = buckets.get(bucketStart) || { total: 0, count: 0 };
    existing.total += session.viewerCount;
    existing.count += 1;
    buckets.set(bucketStart, existing);
  }

  // 轉換為陣列格式
  return Array.from(buckets.entries())
    .map(([time, data]) => ({
      time,
      averageViewers: Math.round(data.total / data.count),
    }))
    .sort((a, b) => a.time - b.time);
}

interface StatsPayload {
  data: { value: number; timestamp: number }[];
}

function aggregateStats(payload: StatsPayload) {
  const { data } = payload;

  if (data.length === 0) {
    return { sum: 0, average: 0, min: 0, max: 0, count: 0 };
  }

  let sum = 0;
  let min = data[0].value;
  let max = data[0].value;

  for (const item of data) {
    sum += item.value;
    if (item.value < min) min = item.value;
    if (item.value > max) max = item.value;
  }

  return {
    sum,
    average: sum / data.length,
    min,
    max,
    count: data.length,
  };
}

interface LeaderboardPayload {
  items: { id: string; score: number; [key: string]: unknown }[];
  sortBy: "score";
  order: "asc" | "desc";
  limit?: number;
}

function sortLeaderboard(payload: LeaderboardPayload) {
  const { items, order, limit } = payload;

  const sorted = [...items].sort((a, b) =>
    order === "desc" ? b.score - a.score : a.score - b.score
  );

  return limit ? sorted.slice(0, limit) : sorted;
}

export {};
