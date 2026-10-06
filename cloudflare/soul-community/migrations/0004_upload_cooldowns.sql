CREATE TABLE IF NOT EXISTS community_upload_cooldowns (
  owner_hash TEXT PRIMARY KEY NOT NULL,
  next_upload_at INTEGER NOT NULL,
  request_id TEXT NOT NULL
);
