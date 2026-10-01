CREATE TABLE payment_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL DEFAULT 'test' CHECK(mode IN ('test','live')),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO payment_settings(id) VALUES(1);
CREATE TABLE payment_integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  account_id TEXT,
  verified_fingerprint TEXT,
  webhook_fingerprint TEXT,
  webhook_seen_at INTEGER,
  UNIQUE(provider,mode)
);
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  provider TEXT NOT NULL,
  integration_id TEXT REFERENCES payment_integrations(id),
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0 AND amount_cents<=99999999),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('creating','open','processing','succeeded','failed','expired','review')),
  provider_ref TEXT,
  payment_ref TEXT,
  checkout_url TEXT,
  request_payload TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  actor_id TEXT REFERENCES user(id),
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  UNIQUE(actor_id,request_key),
  UNIQUE(integration_id,provider_ref),
  UNIQUE(integration_id,payment_ref)
);
CREATE UNIQUE INDEX one_unsettled_checkout ON payment_attempts(booking_id,mode)
  WHERE provider<>'manual' AND status IN ('creating','open','processing','review');
CREATE TABLE payment_refunds (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id),
  integration_id TEXT REFERENCES payment_integrations(id),
  provider_ref TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0 AND amount_cents<=99999999),
  status TEXT NOT NULL CHECK(status IN ('creating','pending','requires_action','succeeded','failed','canceled','review')),
  applied_cents INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  request_key TEXT,
  request_digest TEXT,
  actor_id TEXT REFERENCES user(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(integration_id,provider_ref),
  UNIQUE(actor_id,request_key)
);
-- Each journal entry is allocated to one booking in v1. Other adapters reuse this lifecycle.
CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  attempt_id TEXT REFERENCES payment_attempts(id),
  refund_id TEXT REFERENCES payment_refunds(id),
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  kind TEXT NOT NULL CHECK(kind IN ('receipt','refund','refund-reversal','void','credit')),
  cents INTEGER NOT NULL CHECK(cents<>0 AND abs(cents)<=99999999),
  currency TEXT NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  actor_id TEXT REFERENCES user(id),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX payment_allocation_booking ON payment_allocations(booking_id,mode);
CREATE TRIGGER immutable_payment_allocation_update BEFORE UPDATE ON payment_allocations BEGIN SELECT RAISE(ABORT,'Payment history is immutable'); END;
CREATE TRIGGER immutable_payment_allocation_delete BEFORE DELETE ON payment_allocations BEGIN SELECT RAISE(ABORT,'Payment history is immutable'); END;
CREATE TABLE payment_audit (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  attempt_id TEXT REFERENCES payment_attempts(id),
  event TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER immutable_payment_audit_update BEFORE UPDATE ON payment_audit BEGIN SELECT RAISE(ABORT,'Payment audit is immutable'); END;
CREATE TRIGGER immutable_payment_audit_delete BEFORE DELETE ON payment_audit BEGIN SELECT RAISE(ABORT,'Payment audit is immutable'); END;
CREATE TABLE payment_webhook_events (
  integration_id TEXT NOT NULL REFERENCES payment_integrations(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(integration_id,event_id)
);
CREATE TABLE payment_locks (id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL CHECK(expires_at>0));
