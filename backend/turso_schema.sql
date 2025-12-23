-- CreateTable
CREATE TABLE "streamers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "viewers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isAnonymized" BOOLEAN NOT NULL DEFAULT false,
    "anonymizedAt" DATETIME
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "twitchChannelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channels_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stream_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "twitchStreamId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER,
    "title" TEXT,
    "category" TEXT,
    "avgViewers" INTEGER,
    "peakViewers" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "stream_sessions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "streamSeconds" INTEGER NOT NULL DEFAULT 0,
    "streamCount" INTEGER NOT NULL DEFAULT 0,
    "avgViewers" INTEGER,
    "peakViewers" INTEGER,
    "subsTotal" INTEGER,
    "subsDelta" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channel_daily_stats_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "viewer_channel_daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "watchSeconds" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "emoteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "viewer_channel_daily_stats_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "viewer_channel_daily_stats_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "twitch_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "streamerId" TEXT,
    "viewerId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "twitch_tokens_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "twitch_tokens_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "streamers_twitchUserId_key" ON "streamers"("twitchUserId");

-- CreateIndex
CREATE UNIQUE INDEX "viewers_twitchUserId_key" ON "viewers"("twitchUserId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_twitchChannelId_key" ON "channels"("twitchChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "stream_sessions_twitchStreamId_key" ON "stream_sessions"("twitchStreamId");

-- CreateIndex
CREATE INDEX "stream_sessions_channelId_startedAt_idx" ON "stream_sessions"("channelId", "startedAt");

-- CreateIndex
CREATE INDEX "channel_daily_stats_channelId_date_idx" ON "channel_daily_stats"("channelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "channel_daily_stats_channelId_date_key" ON "channel_daily_stats"("channelId", "date");

-- CreateIndex
CREATE INDEX "viewer_channel_daily_stats_viewerId_channelId_date_idx" ON "viewer_channel_daily_stats"("viewerId", "channelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "viewer_channel_daily_stats_viewerId_channelId_date_key" ON "viewer_channel_daily_stats"("viewerId", "channelId", "date");

-- CreateIndex
CREATE INDEX "twitch_tokens_ownerType_idx" ON "twitch_tokens"("ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");
-- Add consent tracking columns for viewers
PRAGMA foreign_keys=OFF;

ALTER TABLE "viewers" ADD COLUMN "consentedAt" DATETIME;
ALTER TABLE "viewers" ADD COLUMN "consentVersion" INTEGER;

PRAGMA foreign_keys=ON;
-- CreateTable
CREATE TABLE "viewer_channel_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "badges" TEXT,
    "emotesUsed" TEXT,
    "bitsAmount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viewer_channel_messages_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "viewer_channel_messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "viewer_channel_message_daily_aggs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "chatMessages" INTEGER NOT NULL DEFAULT 0,
    "subscriptions" INTEGER NOT NULL DEFAULT 0,
    "cheers" INTEGER NOT NULL DEFAULT 0,
    "giftSubs" INTEGER NOT NULL DEFAULT 0,
    "raids" INTEGER NOT NULL DEFAULT 0,
    "totalBits" INTEGER DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "viewer_channel_message_daily_aggs_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "viewer_channel_message_daily_aggs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "viewer_channel_messages_viewerId_channelId_timestamp_idx" ON "viewer_channel_messages"("viewerId", "channelId", "timestamp");

-- CreateIndex
CREATE INDEX "viewer_channel_message_daily_aggs_viewerId_idx" ON "viewer_channel_message_daily_aggs"("viewerId");

-- CreateIndex
CREATE INDEX "viewer_channel_message_daily_aggs_channelId_idx" ON "viewer_channel_message_daily_aggs"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "viewer_channel_message_daily_aggs_viewerId_channelId_date_key" ON "viewer_channel_message_daily_aggs"("viewerId", "channelId", "date");
-- CreateTable
CREATE TABLE "listener_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "channelCount" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeat" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "channel_listener_locks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "lastHeartbeat" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "viewer_channel_lifetime_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "totalWatchTimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "avgSessionMinutes" INTEGER NOT NULL DEFAULT 0,
    "firstWatchedAt" DATETIME,
    "lastWatchedAt" DATETIME,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "totalChatMessages" INTEGER NOT NULL DEFAULT 0,
    "totalSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "totalCheers" INTEGER NOT NULL DEFAULT 0,
    "totalBits" INTEGER NOT NULL DEFAULT 0,
    "trackingStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackingDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreakDays" INTEGER NOT NULL DEFAULT 0,
    "currentStreakDays" INTEGER NOT NULL DEFAULT 0,
    "activeDaysLast30" INTEGER NOT NULL DEFAULT 0,
    "activeDaysLast90" INTEGER NOT NULL DEFAULT 0,
    "mostActiveMonth" TEXT,
    "mostActiveMonthCount" INTEGER NOT NULL DEFAULT 0,
    "watchTimePercentile" REAL,
    "messagePercentile" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "viewer_channel_lifetime_stats_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "viewer_channel_lifetime_stats_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "viewer_dashboard_layouts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "viewer_dashboard_layouts_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "viewer_dashboard_layouts_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "listener_instances_instanceId_key" ON "listener_instances"("instanceId");

-- CreateIndex
CREATE INDEX "listener_instances_lastHeartbeat_idx" ON "listener_instances"("lastHeartbeat");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listener_locks_channelId_key" ON "channel_listener_locks"("channelId");

-- CreateIndex
CREATE INDEX "channel_listener_locks_instanceId_idx" ON "channel_listener_locks"("instanceId");

-- CreateIndex
CREATE INDEX "channel_listener_locks_lastHeartbeat_idx" ON "channel_listener_locks"("lastHeartbeat");

-- CreateIndex
CREATE INDEX "viewer_channel_lifetime_stats_viewerId_idx" ON "viewer_channel_lifetime_stats"("viewerId");

-- CreateIndex
CREATE INDEX "viewer_channel_lifetime_stats_channelId_idx" ON "viewer_channel_lifetime_stats"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "viewer_channel_lifetime_stats_viewerId_channelId_key" ON "viewer_channel_lifetime_stats"("viewerId", "channelId");

-- CreateIndex
CREATE INDEX "viewer_dashboard_layouts_viewerId_idx" ON "viewer_dashboard_layouts"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "viewer_dashboard_layouts_viewerId_channelId_key" ON "viewer_dashboard_layouts"("viewerId", "channelId");
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
