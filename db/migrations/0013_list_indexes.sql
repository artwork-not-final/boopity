-- Ordered, bounded lists and per-page child lookups. Existing migrations stay immutable.
CREATE INDEX selfhost_clients_page ON clients(sitter_id,created_at DESC,id DESC);
CREATE INDEX selfhost_pets_page ON pets(client_id,name,id);
CREATE INDEX selfhost_services_page ON services(sitter_id,name,id);
CREATE INDEX selfhost_bookings_page ON bookings(sitter_id,start_at DESC,id);
CREATE INDEX selfhost_client_bookings_page ON bookings(sitter_id,client_id,start_at DESC,id);
CREATE INDEX selfhost_booking_expiry ON bookings(status,request_expires_at);
CREATE INDEX selfhost_followup_page ON booking_financial_followups(created_at DESC,booking_id);
CREATE INDEX selfhost_membership_client ON business_memberships(client_id,role,revoked_at);
CREATE INDEX selfhost_attempt_page ON payment_attempts(booking_id,created_at DESC,id DESC);
CREATE INDEX selfhost_allocation_page ON payment_allocations(booking_id,created_at,id);
CREATE INDEX selfhost_refund_page ON payment_refunds(attempt_id,created_at,id);
CREATE INDEX selfhost_booking_history_page ON booking_history(booking_id,created_at,id);
