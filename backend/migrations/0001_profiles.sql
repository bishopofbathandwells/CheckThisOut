CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  commit_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_chunks (
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  part INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(user_id, revision, part)
);
