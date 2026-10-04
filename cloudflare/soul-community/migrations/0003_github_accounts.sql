CREATE TABLE IF NOT EXISTS community_accounts (
  github_id TEXT PRIMARY KEY,
  github_login TEXT NOT NULL,
  owner_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS community_sessions (
  token_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL REFERENCES community_accounts(github_id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_sessions_expiry ON community_sessions(expires_at);
CREATE TABLE IF NOT EXISTS community_login_flows (
  flow_hash TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  legacy_owner_hash TEXT,
  expires_at INTEGER NOT NULL,
  next_poll_at INTEGER NOT NULL,
  interval_seconds INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_legacy_claims (
  legacy_owner_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL REFERENCES community_accounts(github_id)
);
