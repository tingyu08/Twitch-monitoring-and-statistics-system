/**
 * Centralized string constants for cache tags and write-guard keys.
 *
 * Keeping these in one file avoids typos, makes renaming trivial,
 * and lets grep find every usage site via the constant name.
 */

// ---------------------------------------------------------------------------
// Cache Tags — used with getOrSetWithTags / invalidateByTag
// ---------------------------------------------------------------------------

export const CacheTags = {
  // Revenue
  REVENUE_BITS_AGG: "revenue:bits-agg",
  REVENUE_SUBSCRIPTIONS: "revenue:subscriptions",
  REVENUE_BITS: "revenue:bits",
  REVENUE_OVERVIEW: "revenue:overview",

  // Streamer public stats
  STREAMER_PUBLIC_GAME_STATS: "streamer:public-game-stats",
  STREAMER_PUBLIC_VIEWER_TRENDS: "streamer:public-viewer-trends",
  STREAMER_PUBLIC_STREAM_HOURLY: "streamer:public-stream-hourly",

  // Auth
  AUTH_TOKEN_VERSION: "auth:token-version",

  // Viewer
  VIEWER_STATS: "viewer:stats",
  VIEWER_CHANNELS: "viewer:channels",
  VIEWER_BFF: "viewer:bff",
  VIEWER_MESSAGE_STATS: "viewer:message-stats",
  VIEWER_AUTH_SNAPSHOT: "viewer-auth-snapshot",
} as const;

// ---------------------------------------------------------------------------
// Write Guard Keys — used with runWithWriteGuard (keyed mode)
// ---------------------------------------------------------------------------

export const WriteGuardKeys = {
  // Stream session lifecycle
  STREAM_SESSION_CREATE: "stream-session:create-session",
  STREAM_SESSION_END: "stream-session:end-session",
  STREAM_SESSION_UPDATE: "stream-session:update-session",

  // Cleanup / retention
  CLEANUP_HEARTBEAT_DEDUP: "cleanup-heartbeat-dedup:delete",
  DATA_RETENTION_DELETE: "data-retention:delete-messages",

  // Watch time increment
  WATCH_TIME_DAILY_UPSERT: "watch-time-increment:daily-stats-upsert",
  WATCH_TIME_LIFETIME_UPSERT: "watch-time-increment:lifetime-stats-upsert",

  // Live status updates
  LIVE_STATUS_CHECK_TIME: "update-live-status:check-time-only",
  LIVE_STATUS_BATCH_UPDATE: "update-live-status:batch-channel-update",
  LIVE_STATUS_UNCHANGED_CHECK: "update-live-status:unchanged-check-time",

  // Channel stats sync
  CHANNEL_STATS_RENAME: "channel-stats-sync:rename-channel",
  CHANNEL_STATS_DAILY_UPSERT: "channel-stats-sync:daily-stats-upsert",

  // Video sync
  SYNC_VIDEOS_UPSERT: "sync-videos:videos-upsert",
  SYNC_CLIPS_UPSERT: "sync-videos:clips-upsert",
  SYNC_VIDEOS_CLEANUP: "sync-videos:videos-cleanup",
  SYNC_VIEWER_VIDEOS: "sync-videos:viewer-videos",
  SYNC_VIEWER_CLIPS: "sync-videos:viewer-clips",
} as const;
