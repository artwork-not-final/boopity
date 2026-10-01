CREATE TABLE booking_policy (
  id INTEGER PRIMARY KEY CHECK (id=1),
  config TEXT NOT NULL CHECK(json_valid(config)),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO booking_policy VALUES (1,'{"portalEnabled":false,"approvalMode":"request","leadHours":24,"horizonDays":90,"cancelHours":24,"requestHoldHours":24,"weekly":[],"blockedDates":[]}',1);

CREATE TABLE client_invitations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  email TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT REFERENCES user(id),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX pending_invitation_email ON client_invitations(email) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitation_client ON client_invitations(client_id);

ALTER TABLE services ADD portal_visible INTEGER NOT NULL DEFAULT 0 CHECK(portal_visible IN (0,1));
ALTER TABLE bookings ADD policy_snapshot TEXT CHECK(policy_snapshot IS NULL OR json_valid(policy_snapshot));
ALTER TABLE bookings ADD price_snapshot TEXT CHECK(price_snapshot IS NULL OR json_valid(price_snapshot));
ALTER TABLE bookings ADD request_expires_at INTEGER;
ALTER TABLE bookings ADD created_by TEXT REFERENCES user(id);
ALTER TABLE bookings ADD request_key TEXT;
ALTER TABLE bookings ADD request_digest TEXT;
ALTER TABLE bookings ADD version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD client_request TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD client_update TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX booking_request_key ON bookings(created_by,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX booking_capacity ON bookings(sitter_id,status,start_at,end_at);

CREATE TABLE booking_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  actor_id TEXT REFERENCES user(id),
  actor_role TEXT NOT NULL,
  event TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX booking_history_time ON booking_history(booking_id,created_at);
CREATE TABLE booking_financial_followups (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT NOT NULL DEFAULT ''
);

-- A changed/archived CRM contact must not silently transfer access or revive an old login.
CREATE TRIGGER revoke_client_access AFTER UPDATE OF email,status ON clients
WHEN lower(OLD.email)<>lower(NEW.email) OR (OLD.status<>'archived' AND NEW.status='archived')
BEGIN
  DELETE FROM session WHERE user_id IN (SELECT user_id FROM business_memberships WHERE client_id=NEW.id AND role='client');
  UPDATE business_memberships SET revoked_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE client_id=NEW.id AND role='client';
  UPDATE client_invitations SET revoked_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE client_id=NEW.id AND consumed_at IS NULL AND revoked_at IS NULL;
END;
