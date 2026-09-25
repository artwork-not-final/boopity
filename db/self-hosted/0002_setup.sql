ALTER TABLE installation ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE installation ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
CREATE TABLE setup_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_email TEXT,
  owner_name TEXT,
  mail_verified_at INTEGER,
  mail_config_digest TEXT,
  mail_challenge_digest TEXT
);
INSERT INTO setup_progress (id) VALUES (1);
CREATE TABLE operator_tokens (
  kind TEXT PRIMARY KEY CHECK (kind IN ('setup','recovery')),
  digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  session_digest TEXT
);
CREATE TABLE operator_sessions (
  digest TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('setup','recovery')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE installation_secrets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE installation_audit (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
