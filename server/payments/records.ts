import { parseInput } from "../core/http-input";
import type { SqlDatabase } from "../core/contracts";
import { error, type PaymentActor } from "./ledger";
import {
  paymentRecordsQuery,
  type PaymentRecordsView,
} from "../../src/shared/payment-records";
import { searchPattern } from "../../src/shared/pagination";
import { addDays, zonedDateTimeToEpoch } from "../business/scheduling";

const LIMIT = 10;

/** Read-only cash activity. Credits change a booking charge, not money received. */
export async function paymentRecords(
  db: SqlDatabase,
  actor: PaymentActor,
  query: unknown = {},
): Promise<PaymentRecordsView> {
  if (actor.role !== "owner") error("Owner access required.", 403);
  const input = parseInput(paymentRecordsQuery, query);
  const business = await db
    .prepare(
      `SELECT sp.time_zone AS timeZone
    FROM sitter_profiles sp JOIN business_memberships m ON m.user_id=sp.user_id
    JOIN user u ON u.id=m.user_id
    WHERE sp.id=?1 AND m.user_id=?2 AND m.role='owner' AND m.revoked_at IS NULL
      AND u.email_verified=1 AND (SELECT setup_state FROM installation WHERE id=1)='ready'`,
    )
    .bind(actor.sitterId, actor.id)
    .first<{ timeZone: string }>();
  if (!business) error("Your access changed. Sign in again.", 403);
  let from: number | null = null,
    to: number | null = null;
  try {
    if (input.from)
      from = zonedDateTimeToEpoch(input.from, "00:00", business.timeZone);
    if (input.to)
      to = zonedDateTimeToEpoch(
        addDays(input.to, 1),
        "00:00",
        business.timeZone,
      );
  } catch {
    error(
      "These dates could not be read in your business time zone. Choose another date range.",
      400,
    );
  }
  // The page and all-page totals share one statement/snapshot. Receipts and
  // corrections use their ledger timestamps; unsettled/failed checkouts never
  // contribute money. Neither provider calls nor ledger writes happen here.
  const result = await db
    .prepare(
      `WITH activity AS (
    SELECT 'entry:'||p.id AS id,p.booking_id AS bookingId,p.kind,p.cents AS amountCents,
      p.currency,p.created_at AS createdAt,a.method,a.provider,
      CASE p.kind WHEN 'receipt' THEN 'received' WHEN 'refund' THEN 'refunded' ELSE 'corrected' END AS status
    FROM payment_allocations p JOIN payment_attempts a ON a.id=p.attempt_id
    JOIN bookings b ON b.id=p.booking_id
    WHERE b.sitter_id=?1 AND p.mode=?2 AND p.kind<>'credit'
    UNION ALL
    SELECT 'attempt:'||a.id,a.booking_id,'checkout',a.amount_cents,a.currency,a.created_at,a.method,a.provider,
      CASE a.status WHEN 'failed' THEN 'failed' WHEN 'expired' THEN 'expired'
        WHEN 'review' THEN 'review' WHEN 'succeeded' THEN 'review' ELSE 'pending' END
    FROM payment_attempts a JOIN bookings b ON b.id=a.booking_id
    WHERE b.sitter_id=?1 AND a.mode=?2
      AND NOT EXISTS(SELECT 1 FROM payment_allocations p WHERE p.source_key='receipt:'||a.id)
  ), filtered AS (
    SELECT a.*,trim(c.first_name||' '||c.last_name) AS clientName,
      b.service_name AS serviceName,b.start_date AS startDate,b.end_date AS endDate
    FROM activity a JOIN bookings b ON b.id=a.bookingId JOIN clients c ON c.id=b.client_id
    WHERE (?3='all' OR a.method=?3) AND (?4='all' OR a.status=?4)
      AND (?5 IS NULL OR a.createdAt>=?5) AND (?6 IS NULL OR a.createdAt<?6)
      AND (?7='%%' OR lower(c.first_name||' '||c.last_name||' '||c.email||' '||b.service_name) LIKE ?7 ESCAPE '\\')
  ), page AS (SELECT * FROM filtered ORDER BY createdAt DESC,id DESC LIMIT ?8 OFFSET ?9),
  totals AS (
    SELECT currency,
      SUM(CASE WHEN kind IN ('receipt','void') THEN amountCents ELSE 0 END) AS receivedCents,
      -SUM(CASE WHEN kind IN ('refund','refund-reversal') THEN amountCents ELSE 0 END) AS refundedCents
    FROM filtered WHERE kind<>'checkout' GROUP BY currency
  ) SELECT json_object('records',json((SELECT coalesce(json_group_array(json_object(
    'id',id,'bookingId',bookingId,'clientName',clientName,'serviceName',serviceName,
    'startDate',startDate,'endDate',endDate,'kind',kind,'status',status,'method',method,'provider',provider,
    'amountCents',amountCents,'currency',currency,'createdAt',createdAt)), '[]') FROM page)),
    'totals',json((SELECT coalesce(json_group_array(json_object('currency',currency,
      'receivedCents',receivedCents,'refundedCents',refundedCents,'netCents',receivedCents-refundedCents)), '[]')
      FROM (SELECT * FROM totals ORDER BY currency)))) AS result`,
    )
    .bind(
      actor.sitterId,
      input.mode,
      input.method,
      input.status,
      from,
      to,
      searchPattern(input.search),
      LIMIT + 1,
      input.offset,
    )
    .first<{ result: string }>();
  const view = JSON.parse(result!.result) as Pick<
    PaymentRecordsView,
    "records" | "totals"
  >;
  return {
    records: view.records.slice(0, LIMIT),
    totals: view.totals,
    pagination: {
      offset: input.offset,
      limit: LIMIT,
      hasMore: view.records.length > LIMIT,
    },
    timeZone: business.timeZone,
  };
}
