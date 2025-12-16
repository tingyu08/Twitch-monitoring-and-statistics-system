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
