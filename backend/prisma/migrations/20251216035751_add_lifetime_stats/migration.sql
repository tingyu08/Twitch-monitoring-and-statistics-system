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
