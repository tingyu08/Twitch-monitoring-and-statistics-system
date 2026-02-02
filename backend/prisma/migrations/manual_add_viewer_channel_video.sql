-- Migration: Add ViewerChannelVideo table for viewer dashboard optimization
-- Date: 2025-01-XX
-- Description: Creates a separate table for viewer followed channels videos (max 6 per channel)

-- CreateTable
CREATE TABLE IF NOT EXISTS "viewer_channel_videos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchVideoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL,
    "duration" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viewer_channel_videos_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "viewer_channel_videos_twitchVideoId_key" ON "viewer_channel_videos"("twitchVideoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viewer_channel_videos_channelId_idx" ON "viewer_channel_videos"("channelId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viewer_channel_videos_publishedAt_idx" ON "viewer_channel_videos"("publishedAt");
