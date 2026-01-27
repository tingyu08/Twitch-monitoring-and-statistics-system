-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "streamerId" TEXT,
    "twitchChannelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelUrl" TEXT,
    "isMonitored" BOOLEAN NOT NULL DEFAULT true,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "currentViewerCount" INTEGER DEFAULT 0,
    "currentStreamStartedAt" DATETIME,
    "currentGameName" TEXT,
    "currentTitle" TEXT,
    "lastLiveCheckAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'platform',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "channels_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_channels" ("channelName", "channelUrl", "createdAt", "id", "streamerId", "twitchChannelId", "updatedAt") SELECT "channelName", "channelUrl", "createdAt", "id", "streamerId", "twitchChannelId", "updatedAt" FROM "channels";
DROP TABLE "channels";
ALTER TABLE "new_channels" RENAME TO "channels";
CREATE UNIQUE INDEX "channels_twitchChannelId_key" ON "channels"("twitchChannelId");
CREATE TABLE "new_twitch_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "streamerId" TEXT,
    "viewerId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastValidatedAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "twitch_tokens_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "twitch_tokens_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "streamers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_twitch_tokens" ("accessToken", "createdAt", "expiresAt", "id", "ownerType", "refreshToken", "scopes", "streamerId", "updatedAt", "viewerId") SELECT "accessToken", "createdAt", "expiresAt", "id", "ownerType", "refreshToken", "scopes", "streamerId", "updatedAt", "viewerId" FROM "twitch_tokens";
DROP TABLE "twitch_tokens";
ALTER TABLE "new_twitch_tokens" RENAME TO "twitch_tokens";
CREATE INDEX "twitch_tokens_ownerType_idx" ON "twitch_tokens"("ownerType");
CREATE INDEX "twitch_tokens_status_idx" ON "twitch_tokens"("status");
CREATE INDEX "twitch_tokens_streamerId_idx" ON "twitch_tokens"("streamerId");
CREATE INDEX "twitch_tokens_viewerId_idx" ON "twitch_tokens"("viewerId");
CREATE TABLE "new_viewers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "twitchUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isAnonymized" BOOLEAN NOT NULL DEFAULT false,
    "anonymizedAt" DATETIME,
    "consentedAt" DATETIME,
    "consentVersion" INTEGER,
    "deletedAt" DATETIME
);
INSERT INTO "new_viewers" ("anonymizedAt", "avatarUrl", "consentVersion", "consentedAt", "createdAt", "deletedAt", "displayName", "id", "isAnonymized", "twitchUserId", "updatedAt") SELECT "anonymizedAt", "avatarUrl", "consentVersion", "consentedAt", "createdAt", "deletedAt", "displayName", "id", "isAnonymized", "twitchUserId", "updatedAt" FROM "viewers";
DROP TABLE "viewers";
ALTER TABLE "new_viewers" RENAME TO "viewers";
CREATE UNIQUE INDEX "viewers_twitchUserId_key" ON "viewers"("twitchUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "stream_sessions_channelId_endedAt_idx" ON "stream_sessions"("channelId", "endedAt");

-- CreateIndex
CREATE INDEX "viewer_channel_messages_timestamp_idx" ON "viewer_channel_messages"("timestamp");

-- CreateIndex
CREATE INDEX "viewer_channel_messages_channelId_timestamp_idx" ON "viewer_channel_messages"("channelId", "timestamp");
