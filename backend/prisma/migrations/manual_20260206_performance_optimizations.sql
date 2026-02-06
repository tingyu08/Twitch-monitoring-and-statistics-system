-- Performance optimizations (P1/P5/P6)
-- 1) Materialized viewer-channel summary table
-- 2) Heatmap pre-aggregation table
-- 3) cheeredDate column + index for revenue queries

PRAGMA foreign_keys = ON;

-- P1: viewer_channel_summary
CREATE TABLE IF NOT EXISTS viewer_channel_summary (
  viewerId TEXT NOT NULL,
  channelId TEXT NOT NULL,
  channelName TEXT NOT NULL,
  displayName TEXT NOT NULL,
  avatarUrl TEXT NOT NULL,
  category TEXT,
  isLive INTEGER NOT NULL,
  viewerCount INTEGER,
  streamStartedAt DATETIME,
  lastWatched DATETIME,
  totalWatchMin INTEGER NOT NULL DEFAULT 0,
  messageCount INTEGER NOT NULL DEFAULT 0,
  isExternal INTEGER NOT NULL DEFAULT 0,
  followedAt DATETIME,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (viewerId, channelId),
  FOREIGN KEY (viewerId) REFERENCES viewers(id) ON DELETE CASCADE,
  FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_viewer_channel_summary_viewer_live
  ON viewer_channel_summary(viewerId, isLive);
CREATE INDEX IF NOT EXISTS idx_viewer_channel_summary_channel
  ON viewer_channel_summary(channelId);

-- P6: channel_hourly_stats
CREATE TABLE IF NOT EXISTS channel_hourly_stats (
  channelId TEXT NOT NULL,
  dayOfWeek INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  totalHours REAL NOT NULL,
  range TEXT NOT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channelId, dayOfWeek, hour, range),
  FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_hourly_stats_channel_range
  ON channel_hourly_stats(channelId, range);

-- P5: cheer_events.cheeredDate
ALTER TABLE cheer_events ADD COLUMN cheeredDate DATETIME;

UPDATE cheer_events
SET cheeredDate = DATE(cheeredAt)
WHERE cheeredDate IS NULL;

CREATE INDEX IF NOT EXISTS idx_cheer_events_streamer_cheeredDate
  ON cheer_events(streamerId, cheeredDate);

CREATE TRIGGER IF NOT EXISTS trg_cheer_events_set_cheeredDate_insert
AFTER INSERT ON cheer_events
FOR EACH ROW
WHEN NEW.cheeredDate IS NULL
BEGIN
  UPDATE cheer_events
  SET cheeredDate = DATE(NEW.cheeredAt)
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_cheer_events_set_cheeredDate_update
AFTER UPDATE OF cheeredAt ON cheer_events
FOR EACH ROW
BEGIN
  UPDATE cheer_events
  SET cheeredDate = DATE(NEW.cheeredAt)
  WHERE id = NEW.id;
END;
