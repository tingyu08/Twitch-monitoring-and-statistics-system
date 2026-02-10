-- Index cleanup for redundant / low-value indexes

-- Redundant with UNIQUE(channelId, date)
DROP INDEX IF EXISTS channel_daily_stats_channelId_date_idx;

-- Redundant with UNIQUE(viewerId, channelId, date)
DROP INDEX IF EXISTS viewer_channel_daily_stats_viewerId_channelId_date_idx;

-- Not used by current hot-path queries
DROP INDEX IF EXISTS user_follows_channelId_userType_idx;
DROP INDEX IF EXISTS idx_user_follows_channelId_userType;

-- Not used by current percentile update/read patterns
DROP INDEX IF EXISTS viewer_channel_lifetime_stats_channelId_watchTimePercentile_idx;
DROP INDEX IF EXISTS viewer_channel_lifetime_stats_channelId_messagePercentile_idx;
DROP INDEX IF EXISTS idx_viewer_channel_lifetime_stats_channelId_watchTimePercentile;
DROP INDEX IF EXISTS idx_viewer_channel_lifetime_stats_channelId_messagePercentile;
