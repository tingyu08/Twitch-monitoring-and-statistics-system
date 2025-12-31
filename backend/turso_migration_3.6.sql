-- Turso Schema Migration: Add missing columns and tables for Story 3.6
-- Run this in Turso Dashboard SQL Editor

-- ========== 1. Add missing columns to channels table ==========
ALTER TABLE "channels" ADD COLUMN "isMonitored" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "channels" ADD COLUMN "isLive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "channels" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'platform';

-- Make streamerId nullable (for external channels)
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
-- WARNING: This will require data migration!

-- ========== 2. Create user_follows table ==========
CREATE TABLE IF NOT EXISTS "user_follows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "followedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_follows_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_follows_userId_channelId_key" ON "user_follows"("userId", "channelId");
CREATE INDEX IF NOT EXISTS "user_follows_userId_idx" ON "user_follows"("userId");
CREATE INDEX IF NOT EXISTS "user_follows_channelId_idx" ON "user_follows"("channelId");

-- ========== 3. Add tokenVersion to viewers (if missing) ==========
-- Check if column exists first, SQLite doesn't have IF NOT EXISTS for columns
-- ALTER TABLE "viewers" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- ========== VERIFICATION ==========
-- After running, verify with:
-- SELECT * FROM channels LIMIT 5;
-- SELECT * FROM user_follows LIMIT 5;
