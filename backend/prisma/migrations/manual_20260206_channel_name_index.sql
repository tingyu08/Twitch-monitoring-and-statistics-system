-- Add index for hot-path channel lookup used by viewer message ingestion.
CREATE INDEX IF NOT EXISTS idx_channels_channel_name
  ON channels(channelName);
