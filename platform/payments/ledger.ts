import { HTTPException } from "hono/http-exception";
import type { SqlDatabase, SqlStatement } from "../contracts";
import { authDigest } from "../../worker/auth-policy";
import type { PaymentBalance, PaymentMode } from "../../src/shared/payments";

export type PaymentActor = {
  id: string;
  role: "owner" | "client";
  sitterId: string;
  clientId: string | null;
};
export type Bill = {
  id: string;
  sitter_id: string;
  client_id: string;
  status: string;
  total_amount_cents: number;
  currency: string;
  service_name: string;
  version: number;
};
export type Attempt = {
  id: string;
  booking_id: string;
  provider: string;
  integration_id: string | null;
  mode: PaymentMode;
  amount_cents: number;
  currency: string;
  status: string;
  provider_ref: string | null;
  payment_ref: string | null;
  checkout_url: string | null;
  request_payload: string;
  request_key: string;
  request_digest: string;
  actor_id: string | null;
  method: string;
  note: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
};
export type Refund = {
  id: string;
  attempt_id: string;
  integration_id: string | null;
  provider_ref: string | null;
  amount_cents: number;
  status: string;
  applied_cents: number;
  version: number;
  request_key: string | null;
  request_digest: string | null;
  actor_id: string | null;
  note: string;
  created_at: number;
  updated_at: number;
};
export type Commit = (
  statements: SqlStatement[],
) => ReturnType<SqlDatabase["batch"]>;
export const unsettled = "('creating','open','processing','review')";
export function error(
  message: string,
  status: 400 | 403 | 404 | 409 | 503 = 409,
): never {
  throw new HTTPException(status, { message });
}
export class PaymentLedger {
  constructor(
    readonly db: SqlDatabase,
    readonly secret: string,
  ) {}
  hash(input: unknown) {
    return authDigest(this.secret, `payment:${JSON.stringify(input)}`);
  }
  async bill(id: string, actor?: PaymentActor) {
    const bill = await this.db
      .prepare(
        "SELECT b.*,json_extract(price_snapshot,'$.currency') AS currency FROM bookings b WHERE id=?1",
      )
      .bind(id)
      .first<Bill>();
    if (
      !bill ||
      (actor &&
        (bill.sitter_id !== actor.sitterId ||
          (actor.role === "client" && bill.client_id !== actor.clientId)))
    )
      error("Booking not found.", 404);
    if (!bill.currency)
      error("This booking has no saved currency; contact the owner.");
    return bill;
  }
  async checkActor(actor: PaymentActor, bookingId: string) {
    const member = await this.db
      .prepare(
        `SELECT 1 FROM business_memberships m JOIN user u ON u.id=m.user_id
      JOIN bookings b ON b.id=?2 JOIN clients c ON c.id=b.client_id
      WHERE m.user_id=?1 AND m.revoked_at IS NULL AND u.email_verified=1 AND b.sitter_id=?3
      AND (SELECT setup_state FROM installation WHERE id=1)='ready'
      AND ((?4='owner' AND m.role='owner') OR (?4='client' AND m.role='client' AND m.client_id=b.client_id
        AND c.status='active' AND lower(c.email)=lower(u.email) AND (SELECT json_extract(config,'$.portalEnabled') FROM booking_policy WHERE id=1)=1))`,
      )
      .bind(actor.id, bookingId, actor.sitterId, actor.role)
      .first();
    if (!member) error("Your access changed. Sign in again.", 403);
  }
  async withLock<T>(
    bookingId: string,
    work: (commit: Commit) => Promise<T>,
  ): Promise<T> {
    const token = crypto.randomUUID(),
      now = Date.now();
    const lease = await this.db
      .prepare(
        `INSERT INTO payment_locks(id,token,expires_at) VALUES(?1,?2,?3)
      ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE payment_locks.expires_at<=?4 RETURNING token`,
      )
      .bind(bookingId, token, now + 60_000, now)
      .first();
    if (!lease)
      error(
        "A payment operation is already running. Wait briefly, then refresh.",
      );
    try {
      const commit: Commit = (statements) =>
        this.db.batch([
          // A lost/expired lease violates the CHECK and rolls back this entire transaction.
          this.db
            .prepare(
              "UPDATE payment_locks SET expires_at=CASE WHEN token=?2 AND expires_at>?3 THEN expires_at ELSE 0 END WHERE id=?1",
            )
            .bind(bookingId, token, Date.now()),
          ...statements,
        ]);
      return await work(commit);
    } finally {
      await this.db
        .prepare(
          "UPDATE payment_locks SET expires_at=1 WHERE id=?1 AND token=?2",
        )
        .bind(bookingId, token)
        .run();
    }
  }
  async balance(bill: Bill, mode: PaymentMode): Promise<PaymentBalance> {
    const sums = (await this.db
      .prepare(
        `SELECT
      coalesce(sum(CASE WHEN kind='credit' THEN cents ELSE 0 END),0) AS credit,
      coalesce(sum(CASE WHEN kind IN ('receipt','void') THEN cents ELSE 0 END),0) AS received,
      coalesce(sum(CASE WHEN kind IN ('refund','refund-reversal') THEN -cents ELSE 0 END),0) AS refunded
      FROM payment_allocations WHERE booking_id=?1 AND mode=?2`,
      )
      .bind(bill.id, mode)
      .first<{ credit: number; received: number; refunded: number }>())!;
    const netCents = sums.received - sums.refunded,
      charge = bill.total_amount_cents - sums.credit,
      due = Math.max(0, charge - netCents),
      over = Math.max(0, netCents - charge);
    return {
      mode,
      currency: bill.currency,
      chargeCents: bill.total_amount_cents,
      creditCents: sums.credit,
      receivedCents: sums.received,
      refundedCents: sums.refunded,
      netCents,
      outstandingCents: due,
      overpaymentCents: over,
      status: over
        ? "overpaid"
        : charge === 0 && netCents === 0
          ? "waived"
          : due === 0
            ? "paid"
            : netCents > 0
              ? "partial"
              : sums.refunded > 0
                ? "refunded"
                : "unpaid",
    };
  }
  entry(input: {
    bill: Bill;
    mode: PaymentMode;
    kind: string;
    cents: number;
    source: string;
    attemptId?: string;
    refundId?: string;
    actor?: string;
    note?: string;
  }) {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO payment_allocations(id,booking_id,attempt_id,refund_id,mode,kind,cents,currency,source_key,actor_id,note,created_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
      )
      .bind(
        crypto.randomUUID(),
        input.bill.id,
        input.attemptId ?? null,
        input.refundId ?? null,
        input.mode,
        input.kind,
        input.cents,
        input.bill.currency,
        input.source,
        input.actor ?? null,
        input.note ?? "",
        Date.now(),
      );
  }
  audit(
    billId: string | null,
    attemptId: string | null,
    event: string,
    actor: string,
  ) {
    return this.db
      .prepare("INSERT INTO payment_audit VALUES(?1,?2,?3,?4,?5,?6)")
      .bind(crypto.randomUUID(), billId, attemptId, event, actor, Date.now());
  }
  review(billId: string, reason: string) {
    return this.db
      .prepare(
        `INSERT INTO booking_financial_followups(booking_id,reason,created_at) VALUES(?1,?2,?3)
      ON CONFLICT(booking_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at,resolved_at=NULL,resolution=''`,
      )
      .bind(billId, reason, Date.now());
  }
  async attempt(id: string) {
    const row = await this.db
      .prepare("SELECT * FROM payment_attempts WHERE id=?1")
      .bind(id)
      .first<Attempt>();
    if (!row) error("Payment not found.", 404);
    return row;
  }
  async active(billId: string, mode: PaymentMode) {
    return this.db
      .prepare(
        `SELECT id FROM payment_attempts WHERE booking_id=?1 AND mode=?2 AND provider<>'manual' AND status IN ${unsettled}`,
      )
      .bind(billId, mode)
      .first();
  }
}
