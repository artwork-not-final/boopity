CREATE TABLE operator_token_history (
  digest TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO operator_token_history(digest,created_at)
  SELECT digest,0 FROM operator_tokens;
