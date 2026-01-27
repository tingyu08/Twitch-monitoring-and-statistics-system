-- CreateTable: stream_metrics
CREATE TABLE IF NOT EXISTS "stream_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamSessionId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "chatCount" INTEGER DEFAULT 0,
    CONSTRAINT "stream_metrics_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "stream_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: user_follows
CREATE TABLE IF NOT EXISTS "user_follows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "followedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_follows_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: videos
CREATE TABLE IF NOT EXISTS "videos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchVideoId" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL,
    "duration" TEXT NOT NULL,
    "language" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "videos_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: clips
CREATE TABLE IF NOT EXISTS "clips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchClipId" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "creatorId" TEXT,
    "creatorName" TEXT,
    "videoId" TEXT,
    "gameId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "embedUrl" TEXT,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL,
    "duration" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clips_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: streamer_setting_templates
CREATE TABLE IF NOT EXISTS "streamer_setting_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "title" TEXT,
    "gameId" TEXT,
    "gameName" TEXT,
    "tags" TEXT,
    "language" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "streamer_setting_templates_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: subscription_snapshots
CREATE TABLE IF NOT EXISTS "subscription_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "snapshotDate" DATETIME NOT NULL,
    "tier1Count" INTEGER NOT NULL DEFAULT 0,
    "tier2Count" INTEGER NOT NULL DEFAULT 0,
    "tier3Count" INTEGER NOT NULL DEFAULT 0,
    "totalSubscribers" INTEGER NOT NULL DEFAULT 0,
    "estimatedRevenue" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_snapshots_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: cheer_events
CREATE TABLE IF NOT EXISTS "cheer_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT NOT NULL,
    "twitchUserId" TEXT,
    "userName" TEXT,
    "bits" INTEGER NOT NULL,
    "message" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "cheeredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cheer_events_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex: stream_metrics
CREATE INDEX IF NOT EXISTS "stream_metrics_streamSessionId_timestamp_idx" ON "stream_metrics"("streamSessionId", "timestamp");

-- CreateIndex: user_follows
CREATE INDEX IF NOT EXISTS "user_follows_userId_idx" ON "user_follows"("userId");
CREATE INDEX IF NOT EXISTS "user_follows_channelId_idx" ON "user_follows"("channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "user_follows_userId_channelId_key" ON "user_follows"("userId", "channelId");

-- CreateIndex: videos
CREATE UNIQUE INDEX IF NOT EXISTS "videos_twitchVideoId_key" ON "videos"("twitchVideoId");
CREATE INDEX IF NOT EXISTS "videos_streamerId_idx" ON "videos"("streamerId");
CREATE INDEX IF NOT EXISTS "videos_createdAt_idx" ON "videos"("createdAt");

-- CreateIndex: clips
CREATE UNIQUE INDEX IF NOT EXISTS "clips_twitchClipId_key" ON "clips"("twitchClipId");
CREATE INDEX IF NOT EXISTS "clips_streamerId_idx" ON "clips"("streamerId");
CREATE INDEX IF NOT EXISTS "clips_createdAt_idx" ON "clips"("createdAt");
CREATE INDEX IF NOT EXISTS "clips_viewCount_idx" ON "clips"("viewCount");

-- CreateIndex: streamer_setting_templates
CREATE INDEX IF NOT EXISTS "streamer_setting_templates_streamerId_idx" ON "streamer_setting_templates"("streamerId");

-- CreateIndex: subscription_snapshots
CREATE INDEX IF NOT EXISTS "subscription_snapshots_streamerId_idx" ON "subscription_snapshots"("streamerId");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_snapshots_streamerId_snapshotDate_key" ON "subscription_snapshots"("streamerId", "snapshotDate");

-- CreateIndex: cheer_events
CREATE INDEX IF NOT EXISTS "cheer_events_streamerId_cheeredAt_idx" ON "cheer_events"("streamerId", "cheeredAt");
CREATE INDEX IF NOT EXISTS "cheer_events_streamerId_userName_isAnonymous_idx" ON "cheer_events"("streamerId", "userName", "isAnonymous");
