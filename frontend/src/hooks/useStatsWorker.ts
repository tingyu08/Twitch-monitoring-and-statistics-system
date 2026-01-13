"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * useStatsWorker - 使用 Web Worker 進行統計計算
 * 將複雜計算移到背景執行緒，不阻塞 UI
 */

interface WorkerResult<T> {
  loading: boolean;
  result: T | null;
  error: string | null;
}

type MessageType =
  | "CALCULATE_RETENTION"
  | "AGGREGATE_STATS"
  | "SORT_LEADERBOARD";

export function useStatsWorker() {
  const workerRef = useRef<Worker | null>(null);
  const callbacksRef = useRef<Map<string, (response: unknown) => void>>(
    new Map()
  );

  // 初始化 Worker
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 動態創建 Worker
    workerRef.current = new Worker(
      new URL("../workers/stats.worker.ts", import.meta.url)
    );

    // 監聽 Worker 回應
    workerRef.current.onmessage = (event) => {
      const { requestId, success, result, error } = event.data;
      const callback = callbacksRef.current.get(requestId);

      if (callback) {
        callback({ success, result, error });
        callbacksRef.current.delete(requestId);
      }
    };

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // 發送計算請求
  const calculate = useCallback(
    <T>(type: MessageType, payload: unknown): Promise<T> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        const requestId = `${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        callbacksRef.current.set(requestId, (response: unknown) => {
          const res = response as {
            success: boolean;
            result: T;
            error: string;
          };
          if (res.success) {
            resolve(res.result);
          } else {
            reject(new Error(res.error));
          }
        });

        workerRef.current.postMessage({ type, payload, requestId });
      });
    },
    []
  );

  // 便捷方法
  const calculateRetention = useCallback(
    (
      sessions: { startTime: number; endTime: number; viewerCount: number }[],
      intervalMinutes: number = 5
    ) => {
      return calculate<{ time: number; averageViewers: number }[]>(
        "CALCULATE_RETENTION",
        { sessions, intervalMinutes }
      );
    },
    [calculate]
  );

  const aggregateStats = useCallback(
    (data: { value: number; timestamp: number }[]) => {
      return calculate<{
        sum: number;
        average: number;
        min: number;
        max: number;
        count: number;
      }>("AGGREGATE_STATS", { data });
    },
    [calculate]
  );

  const sortLeaderboard = useCallback(
    <T extends { id: string; score: number }>(
      items: T[],
      order: "asc" | "desc" = "desc",
      limit?: number
    ) => {
      return calculate<T[]>("SORT_LEADERBOARD", {
        items,
        sortBy: "score",
        order,
        limit,
      });
    },
    [calculate]
  );

  return {
    calculateRetention,
    aggregateStats,
    sortLeaderboard,
    calculate,
  };
}
