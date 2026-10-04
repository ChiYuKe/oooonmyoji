CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  hero_id INTEGER NOT NULL,
  objective TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  delete_hash TEXT NOT NULL
);
CREATE INDEX builds_lookup ON builds (hero_id, objective, created_at DESC, id DESC);
