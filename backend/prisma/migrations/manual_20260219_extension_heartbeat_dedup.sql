CREATE TABLE IF NOT EXISTS "extension_heartbeat_dedups" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dedupKey" TEXT NOT NULL,
  "viewerId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "heartbeatTimestamp" DATETIME NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extension_heartbeat_dedups_viewerId_fkey"
    FOREIGN KEY ("viewerId") REFERENCES "viewers" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "extension_heartbeat_dedups_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "extension_heartbeat_dedups_dedupKey_key"
  ON "extension_heartbeat_dedups"("dedupKey");

CREATE INDEX IF NOT EXISTS "extension_heartbeat_dedups_viewerId_channelId_idx"
  ON "extension_heartbeat_dedups"("viewerId", "channelId");

CREATE INDEX IF NOT EXISTS "extension_heartbeat_dedups_createdAt_idx"
  ON "extension_heartbeat_dedups"("createdAt");
