CREATE TABLE installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  setup_state TEXT NOT NULL DEFAULT 'unconfigured' CHECK (setup_state IN ('unconfigured', 'ready')),
  business_name TEXT NOT NULL DEFAULT 'Your pet-care business',
  primary_color TEXT NOT NULL DEFAULT '#68407a',
  accent_color TEXT NOT NULL DEFAULT '#f5bb62',
  logo_key TEXT,
  logo_type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO installation (id) VALUES (1);

CREATE TABLE business_memberships (
  user_id TEXT PRIMARY KEY REFERENCES user(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'client')),
  client_id TEXT REFERENCES clients(id),
  revoked_at INTEGER,
  CHECK ((role = 'owner' AND client_id IS NULL) OR (role = 'client' AND client_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_owner ON business_memberships(role) WHERE role = 'owner' AND revoked_at IS NULL;

CREATE TABLE job_leases (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  completed_at INTEGER
);
