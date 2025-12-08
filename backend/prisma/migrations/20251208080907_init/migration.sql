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
