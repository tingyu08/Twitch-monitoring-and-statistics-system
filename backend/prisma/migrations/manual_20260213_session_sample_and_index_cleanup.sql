-- Drop redundant indexes covered by composite indexes
DROP INDEX IF EXISTS channels_isMonitored_idx;
DROP INDEX IF EXISTS viewer_channel_daily_stats_updatedAt_idx;
DROP INDEX IF EXISTS viewer_channel_message_daily_aggs_updatedAt_idx;
