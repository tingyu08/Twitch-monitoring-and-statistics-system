import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "../src/db/prisma";

type EndpointResult = {
  path: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  successRate: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
};

type TableCount = {
  table: string;
  count: number;
};

type Snapshot = {
  label: string;
  capturedAt: string;
  baseUrl: string;
  durationSeconds: number;
  requestCountPerEndpoint: number;
  concurrency: number;
  endpoints: EndpointResult[];
  backendStats: {
    api: {
      averageResponseTime: number;
      p95: number;
      p99: number;
      totalRequests: number;
      slowRequests: number;
    } | null;
    dbQueries: {
      count: number;
      averageMs: number;
      p95Ms: number;
      maxMs: number;
    } | null;
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      external: number;
      unit: string;
    } | null;
  };
  tableCounts: TableCount[];
};

const DEFAULT_BASE_URL = process.env.PERF_BASE_URL || "http://localhost:4000";
const DEFAULT_ENDPOINTS = [
  "/api/streamer/me/summary?range=30d",
  "/api/streamer/me/time-series?range=30d&granularity=day",
  "/api/streamer/me/heatmap?range=30d",
  "/api/viewer/channels",
];
const DEFAULT_REQUESTS = Number(process.env.PERF_REQUESTS || 50);
const DEFAULT_CONCURRENCY = Number(process.env.PERF_CONCURRENCY || 5);

const TRACKED_TABLES = [
  "viewer_channel_messages",
  "viewer_channel_message_daily_aggs",
  "viewer_channel_daily_stats",
  "viewer_channel_lifetime_stats",
  "stream_metrics",
  "viewer_channel_summary",
  "viewer_channel_videos",
  "viewer_channel_clips",
  "stream_sessions",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || "capture";

  const getArgValue = (name: string): string | undefined => {
    const index = args.findIndex((arg) => arg === `--${name}`);
    if (index === -1) return undefined;
    return args[index + 1];
  };

  return {
    command,
    label: getArgValue("label") || "snapshot",
    before: getArgValue("before"),
    after: getArgValue("after"),
    baseUrl: getArgValue("base-url") || DEFAULT_BASE_URL,
    requests: Number(getArgValue("requests") || DEFAULT_REQUESTS),
    concurrency: Number(getArgValue("concurrency") || DEFAULT_CONCURRENCY),
    endpoints: (getArgValue("endpoints") || process.env.PERF_ENDPOINTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cookie: getArgValue("cookie") || process.env.PERF_COOKIE || "",
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

async function runEndpointLoad(
  baseUrl: string,
  endpoint: string,
  requestCount: number,
  concurrency: number,
  cookie: string
): Promise<EndpointResult> {
  const latencies: number[] = [];
  const statuses: number[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < requestCount) {
      const current = cursor;
      cursor += 1;
      if (current >= requestCount) break;

      const start = performance.now();
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: cookie ? { cookie } : undefined,
        });
        statuses.push(response.status);
        await response.arrayBuffer();
      } catch {
        statuses.push(0);
      } finally {
        const duration = performance.now() - start;
        latencies.push(duration);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );

  const successRequests = statuses.filter((code) => code >= 200 && code < 400).length;
  const failedRequests = statuses.length - successRequests;
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    path: endpoint,
    totalRequests: statuses.length,
    successRequests,
    failedRequests,
    successRate: statuses.length > 0 ? Math.round((successRequests / statuses.length) * 10000) / 100 : 0,
    averageMs: average(latencies),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    minMs: Math.round((sorted[0] || 0) * 100) / 100,
    maxMs: Math.round((sorted[sorted.length - 1] || 0) * 100) / 100,
  };
}

async function fetchBackendStats(baseUrl: string, cookie: string) {
  try {
    const response = await fetch(`${baseUrl}/api/admin/performance/stats`, {
      headers: cookie ? { cookie } : undefined,
    });
    if (!response.ok) {
      return {
        api: null,
        dbQueries: null,
        memory: null,
      };
    }

    const body = (await response.json()) as {
      data?: {
        api?: {
          averageResponseTime?: number;
          p95?: number;
          p99?: number;
          totalRequests?: number;
          slowRequests?: number;
          dbQueries?: {
            count: number;
            averageMs: number;
            p95Ms: number;
            maxMs: number;
          };
        };
        memory?: {
          heapUsed: number;
          heapTotal: number;
          rss: number;
          external: number;
          unit: string;
        };
      };
    };

    return {
      api: body.data?.api
        ? {
            averageResponseTime: body.data.api.averageResponseTime || 0,
            p95: body.data.api.p95 || 0,
            p99: body.data.api.p99 || 0,
            totalRequests: body.data.api.totalRequests || 0,
            slowRequests: body.data.api.slowRequests || 0,
          }
        : null,
      dbQueries: body.data?.api?.dbQueries || null,
      memory: body.data?.memory || null,
    };
  } catch {
    return {
      api: null,
      dbQueries: null,
      memory: null,
    };
  }
}

async function fetchTableCounts(): Promise<TableCount[]> {
  const results: TableCount[] = [];

  for (const table of TRACKED_TABLES) {
    try {
      const rows = await prisma.$queryRaw<Array<{ count: number | string }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM ${Prisma.raw(table)}
      `);
      results.push({ table, count: Number(rows[0]?.count || 0) });
    } catch {
      results.push({ table, count: -1 });
    }
  }

  return results;
}

async function writeSnapshotFile(snapshot: Snapshot): Promise<string> {
  const dirPath = path.resolve(process.cwd(), "perf-metrics");
  await fs.mkdir(dirPath, { recursive: true });

  const safeLabel = snapshot.label.replace(/[^a-zA-Z0-9-_]/g, "_");
  const filePath = path.join(dirPath, `${safeLabel}-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return filePath;
}

function compareSnapshots(before: Snapshot, after: Snapshot): string {
  const endpointLines = after.endpoints.map((afterEndpoint) => {
    const beforeEndpoint = before.endpoints.find((e) => e.path === afterEndpoint.path);
    if (!beforeEndpoint) {
      return `- ${afterEndpoint.path}: no baseline`;
    }

    const p95Delta = Math.round((afterEndpoint.p95Ms - beforeEndpoint.p95Ms) * 100) / 100;
    const avgDelta = Math.round((afterEndpoint.averageMs - beforeEndpoint.averageMs) * 100) / 100;
    const successDelta =
      Math.round((afterEndpoint.successRate - beforeEndpoint.successRate) * 100) / 100;

    return `- ${afterEndpoint.path}: p95 ${beforeEndpoint.p95Ms}ms -> ${afterEndpoint.p95Ms}ms (${p95Delta >= 0 ? "+" : ""}${p95Delta}), avg ${beforeEndpoint.averageMs}ms -> ${afterEndpoint.averageMs}ms (${avgDelta >= 0 ? "+" : ""}${avgDelta}), success ${beforeEndpoint.successRate}% -> ${afterEndpoint.successRate}% (${successDelta >= 0 ? "+" : ""}${successDelta})`;
  });

  const dbBefore = before.backendStats.dbQueries;
  const dbAfter = after.backendStats.dbQueries;
  const dbLine = dbBefore && dbAfter
    ? `- DB query p95: ${dbBefore.p95Ms}ms -> ${dbAfter.p95Ms}ms (${Math.round((dbAfter.p95Ms - dbBefore.p95Ms) * 100) / 100 >= 0 ? "+" : ""}${Math.round((dbAfter.p95Ms - dbBefore.p95Ms) * 100) / 100})`
    : "- DB query stats: unavailable (check /api/admin/performance/stats access)";

  const memoryBefore = before.backendStats.memory;
  const memoryAfter = after.backendStats.memory;
  const memoryLine = memoryBefore && memoryAfter
    ? `- Memory RSS: ${memoryBefore.rss}MB -> ${memoryAfter.rss}MB (${memoryAfter.rss - memoryBefore.rss >= 0 ? "+" : ""}${memoryAfter.rss - memoryBefore.rss}MB)`
    : "- Memory stats: unavailable (check /api/admin/performance/stats access)";

  const tableLines = after.tableCounts.map((afterTable) => {
    const beforeTable = before.tableCounts.find((t) => t.table === afterTable.table);
    if (!beforeTable || beforeTable.count < 0 || afterTable.count < 0) {
      return `- ${afterTable.table}: unavailable`;
    }
    const delta = afterTable.count - beforeTable.count;
    return `- ${afterTable.table}: ${beforeTable.count} -> ${afterTable.count} (${delta >= 0 ? "+" : ""}${delta})`;
  });

  return [
    `Before: ${before.label} @ ${before.capturedAt}`,
    `After: ${after.label} @ ${after.capturedAt}`,
    "",
    "Endpoint latency comparison:",
    ...endpointLines,
    "",
    "System metrics:",
    dbLine,
    memoryLine,
    "",
    "DB table growth (proxy for write volume):",
    ...tableLines,
  ].join("\n");
}

async function captureSnapshot(
  label: string,
  baseUrl: string,
  endpoints: string[],
  requests: number,
  concurrency: number,
  cookie: string
): Promise<string> {
  const targetEndpoints = endpoints.length > 0 ? endpoints : DEFAULT_ENDPOINTS;
  const startedAt = Date.now();

  const results: EndpointResult[] = [];
  for (const endpoint of targetEndpoints) {
    console.log(`Running load test: ${endpoint}`);
    const result = await runEndpointLoad(baseUrl, endpoint, requests, concurrency, cookie);
    results.push(result);
  }

  const backendStats = await fetchBackendStats(baseUrl, cookie);
  const tableCounts = await fetchTableCounts();

  const snapshot: Snapshot = {
    label,
    capturedAt: new Date().toISOString(),
    baseUrl,
    durationSeconds: Math.round(((Date.now() - startedAt) / 1000) * 100) / 100,
    requestCountPerEndpoint: requests,
    concurrency,
    endpoints: results,
    backendStats,
    tableCounts,
  };

  const filePath = await writeSnapshotFile(snapshot);
  console.log(`Snapshot saved: ${filePath}`);
  return filePath;
}

async function main() {
  const args = parseArgs();

  try {
    if (args.command === "capture") {
      await captureSnapshot(
        args.label,
        args.baseUrl,
        args.endpoints,
        args.requests,
        args.concurrency,
        args.cookie
      );
      return;
    }

    if (args.command === "compare") {
      if (!args.before || !args.after) {
        throw new Error("compare mode requires --before and --after file paths");
      }

      const beforeRaw = await fs.readFile(path.resolve(process.cwd(), args.before), "utf8");
      const afterRaw = await fs.readFile(path.resolve(process.cwd(), args.after), "utf8");
      const before = JSON.parse(beforeRaw) as Snapshot;
      const after = JSON.parse(afterRaw) as Snapshot;

      const report = compareSnapshots(before, after);
      const reportPath = path.resolve(
        process.cwd(),
        "perf-metrics",
        `comparison-${Date.now()}.txt`
      );
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, report, "utf8");

      console.log(report);
      console.log(`Comparison report saved: ${reportPath}`);
      return;
    }

    throw new Error(`Unknown command: ${args.command}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("perf-compare failed", error);
  process.exit(1);
});
