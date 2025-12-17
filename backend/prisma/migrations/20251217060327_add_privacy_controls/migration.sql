-- AlterTable
ALTER TABLE "viewers" ADD COLUMN "deletedAt" DATETIME;

-- CreateTable
CREATE TABLE "viewer_privacy_consents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "consentGivenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectDailyWatchTime" BOOLEAN NOT NULL DEFAULT true,
    "collectWatchTimeDistribution" BOOLEAN NOT NULL DEFAULT true,
    "collectMonthlyAggregates" BOOLEAN NOT NULL DEFAULT true,
    "collectChatMessages" BOOLEAN NOT NULL DEFAULT true,
    "collectInteractions" BOOLEAN NOT NULL DEFAULT true,
    "collectInteractionFrequency" BOOLEAN NOT NULL DEFAULT true,
    "collectBadgeProgress" BOOLEAN NOT NULL DEFAULT true,
    "collectFootprintData" BOOLEAN NOT NULL DEFAULT true,
    "collectRankings" BOOLEAN NOT NULL DEFAULT true,
    "collectRadarAnalysis" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "viewer_privacy_consents_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executionScheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "deletion_requests_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "downloadPath" TEXT,
    "expiresAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "export_jobs_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_retention_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "privacy_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "viewer_privacy_consents_viewerId_key" ON "viewer_privacy_consents"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_requests_viewerId_key" ON "deletion_requests"("viewerId");

-- CreateIndex
CREATE INDEX "deletion_requests_executionScheduledAt_status_idx" ON "deletion_requests"("executionScheduledAt", "status");

-- CreateIndex
CREATE INDEX "export_jobs_viewerId_idx" ON "export_jobs"("viewerId");

-- CreateIndex
CREATE INDEX "export_jobs_expiresAt_idx" ON "export_jobs"("expiresAt");

-- CreateIndex
CREATE INDEX "data_retention_logs_viewerId_idx" ON "data_retention_logs"("viewerId");

-- CreateIndex
CREATE INDEX "data_retention_logs_executedAt_idx" ON "data_retention_logs"("executedAt");

-- CreateIndex
CREATE INDEX "privacy_audit_logs_viewerId_idx" ON "privacy_audit_logs"("viewerId");

-- CreateIndex
CREATE INDEX "privacy_audit_logs_timestamp_idx" ON "privacy_audit_logs"("timestamp");
