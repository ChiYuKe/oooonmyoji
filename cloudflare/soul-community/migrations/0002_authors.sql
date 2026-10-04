CREATE TABLE community_authors (
  owner_hash TEXT PRIMARY KEY,
  author_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
