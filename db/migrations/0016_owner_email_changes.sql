CREATE TABLE owner_email_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  current_digest TEXT NOT NULL,
  new_digest TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX owner_email_changes_expiry ON owner_email_changes(expires_at);
