-- Remaining optimization migration (manual)
-- 1) Composite indexes for high-frequency queries
-- 2) Persisted table for bits daily aggregation

CREATE INDEX IF NOT EXISTS idx_channels_isMonitored_twitchChannelId
  ON channels(isMonitored, twitchChannelId);

CREATE INDEX IF NOT EXISTS idx_viewer_channel_daily_stats_updatedAt_viewerId_channelId
  ON viewer_channel_daily_stats(updatedAt, viewerId, channelId);

CREATE INDEX IF NOT EXISTS idx_viewer_channel_message_daily_aggs_updatedAt_viewerId_channelId
  ON viewer_channel_message_daily_aggs(updatedAt, viewerId, channelId);

CREATE INDEX IF NOT EXISTS idx_user_follows_userId_userType
  ON user_follows(userId, userType);

CREATE INDEX IF NOT EXISTS idx_user_follows_channelId_userType
  ON user_follows(channelId, userType);

CREATE INDEX IF NOT EXISTS idx_viewer_channel_lifetime_stats_channelId_watchTimePercentile
  ON viewer_channel_lifetime_stats(channelId, watchTimePercentile);

CREATE INDEX IF NOT EXISTS idx_viewer_channel_lifetime_stats_channelId_messagePercentile
  ON viewer_channel_lifetime_stats(channelId, messagePercentile);

CREATE TABLE IF NOT EXISTS cheer_daily_agg (
  streamerId TEXT NOT NULL,
  date TEXT NOT NULL,
  totalBits INTEGER NOT NULL DEFAULT 0,
  eventCount INTEGER NOT NULL DEFAULT 0,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (streamerId, date)
);

CREATE INDEX IF NOT EXISTS idx_cheer_daily_agg_streamer_date
  ON cheer_daily_agg(streamerId, date);
