-- Migration: Add ViewerChannelClip table for viewer dashboard optimization
-- Date: 2025-01-XX
-- Description: Creates a separate table for viewer followed channels clips (top 6 by view count)

-- CreateTable
CREATE TABLE IF NOT EXISTS "viewer_channel_clips" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchClipId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorName" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL,
    "duration" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viewer_channel_clips_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "viewer_channel_clips_twitchClipId_key" ON "viewer_channel_clips"("twitchClipId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "viewer_channel_clips_channelId_idx" ON "viewer_channel_clips"("channelId");

-- CreateIndex (viewCount DESC for top clips query optimization)
CREATE INDEX IF NOT EXISTS "viewer_channel_clips_viewCount_idx" ON "viewer_channel_clips"("viewCount" DESC);
