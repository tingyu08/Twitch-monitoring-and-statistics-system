-- Add dedup key for raw chat messages and enforce uniqueness.

ALTER TABLE viewer_channel_messages
  ADD COLUMN messageDedupKey TEXT;

-- Backfill existing rows with stable legacy key to satisfy NOT NULL + UNIQUE constraint.
UPDATE viewer_channel_messages
SET messageDedupKey = 'legacy:' || id
WHERE messageDedupKey IS NULL;

-- Enforce non-null and unique behavior for future inserts.
CREATE UNIQUE INDEX IF NOT EXISTS viewer_channel_messages_messageDedupKey_key
  ON viewer_channel_messages(messageDedupKey);
