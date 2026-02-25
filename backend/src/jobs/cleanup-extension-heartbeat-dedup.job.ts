import cron from "node-cron";

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { retryDatabaseOperation } from "../utils/db-retry";
import { runWithWriteGuard } from "./job-write-guard";
import { captureJobError } from "./job-error-tracker";
import { WriteGuardKeys } from "../constants";

const CLEANUP_HEARTBEAT_DEDUP_CRON =
  process.env.CLEANUP_HEARTBEAT_DEDUP_CRON || "20 5 * * *";
const HEARTBEAT_DEDUP_RETENTION_DAYS = Number(process.env.HEARTBEAT_DEDUP_RETENTION_DAYS || 14);
const HEARTBEAT_DEDUP_CLEANUP_BATCH_SIZE = Number(
  process.env.HEARTBEAT_DEDUP_CLEANUP_BATCH_SIZE || 2000
);

export class CleanupExtensionHeartbeatDedupJob {
  private isRunning = false;

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Jobs", "Heartbeat dedup cleanup 正在執行中，跳過...");
      return;
    }

    this.isRunning = true;
    const cutoff = new Date(Date.now() - HEARTBEAT_DEDUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    try {
      let deletedTotal = 0;
      while (true) {
        const deletedCount = await runWithWriteGuard(WriteGuardKeys.CLEANUP_HEARTBEAT_DEDUP, () =>
          retryDatabaseOperation(() =>
            prisma.$executeRaw(
              Prisma.sql`
                DELETE FROM extension_heartbeat_dedups
                WHERE id IN (
                  SELECT id
                  FROM extension_heartbeat_dedups
                  WHERE createdAt < ${cutoff}
                  LIMIT ${HEARTBEAT_DEDUP_CLEANUP_BATCH_SIZE}
                )
              `
            )
          )
        );

        const deletedInBatch = Number(deletedCount);
        deletedTotal += deletedInBatch;

        if (deletedInBatch < HEARTBEAT_DEDUP_CLEANUP_BATCH_SIZE) {
          break;
        }
      }

      if (deletedTotal > 0) {
        logger.info(
          "Jobs",
          `Heartbeat dedup cleanup 完成，刪除 ${deletedTotal} 筆（保留 ${HEARTBEAT_DEDUP_RETENTION_DAYS} 天）`
        );
      }
    } catch (error) {
      logger.error("Jobs", "Heartbeat dedup cleanup 失敗", error);
      captureJobError("cleanup-heartbeat-dedup", error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const cleanupExtensionHeartbeatDedupJobInstance = new CleanupExtensionHeartbeatDedupJob();

export const cleanupExtensionHeartbeatDedupJob = cron.schedule(
  CLEANUP_HEARTBEAT_DEDUP_CRON,
  async () => {
    await cleanupExtensionHeartbeatDedupJobInstance.run();
  }
);

// 向下相容的函數匯出
export async function cleanupExtensionHeartbeatDedupFn(): Promise<void> {
  return cleanupExtensionHeartbeatDedupJobInstance.run();
}
