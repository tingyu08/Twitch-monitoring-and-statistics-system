-- P3-1: Add source column to viewer_channel_daily_stats
-- Tracks which writer (chat job vs extension) provided the watchSeconds value.
-- When extension data exists for a day, it takes priority over chat-inferred watch time.
--
-- Values: 'chat' (default, from watch-time-increment job) | 'extension' (from browser extension heartbeats)
-- Default 'chat' ensures backward compatibility with existing rows.

ALTER TABLE viewer_channel_daily_stats ADD COLUMN source TEXT NOT NULL DEFAULT 'chat';
