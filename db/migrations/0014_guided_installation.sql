-- The deployment-selected inbox is immutable; public requests cannot select an owner.
CREATE TABLE guided_installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
