-- Add FK relation for cheer_daily_agg.streamerId -> streamers.id
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS cheer_daily_agg_new (
  streamerId TEXT NOT NULL,
  date TEXT NOT NULL,
  totalBits INTEGER NOT NULL DEFAULT 0,
  eventCount INTEGER NOT NULL DEFAULT 0,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (streamerId, date),
  CONSTRAINT cheer_daily_agg_streamer_fk
    FOREIGN KEY (streamerId)
    REFERENCES streamers(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT INTO cheer_daily_agg_new (streamerId, date, totalBits, eventCount, updatedAt)
SELECT c.streamerId, c.date, c.totalBits, c.eventCount, c.updatedAt
FROM cheer_daily_agg c
JOIN streamers s ON s.id = c.streamerId;

DROP TABLE cheer_daily_agg;
ALTER TABLE cheer_daily_agg_new RENAME TO cheer_daily_agg;

CREATE INDEX IF NOT EXISTS cheer_daily_agg_streamerId_idx ON cheer_daily_agg(streamerId);

PRAGMA foreign_keys=ON;
