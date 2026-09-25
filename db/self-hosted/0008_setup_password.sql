-- A setup-only credential; never a Better Auth account password.
CREATE TABLE setup_password (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT,
  host_hash TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER
);
INSERT INTO setup_password (id, closed_at)
SELECT 1, CASE WHEN EXISTS (
  SELECT 1 FROM business_memberships WHERE role='owner' AND revoked_at IS NULL
) THEN 0 ELSE NULL END;

-- Ownership permanently closes this credential, including later recovery.
CREATE TRIGGER close_setup_password_on_owner_insert
AFTER INSERT ON business_memberships
WHEN NEW.role='owner' AND NEW.revoked_at IS NULL
BEGIN
  UPDATE setup_password SET password_hash=NULL,host_hash=NULL,
    version=version+1,closed_at=COALESCE(closed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
    WHERE id=1;
END;
CREATE TRIGGER close_setup_password_on_owner_update
AFTER UPDATE OF role, revoked_at ON business_memberships
WHEN NEW.role='owner' AND NEW.revoked_at IS NULL
BEGIN
  UPDATE setup_password SET password_hash=NULL,host_hash=NULL,
    version=version+1,closed_at=COALESCE(closed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
    WHERE id=1;
END;
