import { parseInput } from "../http-input";
import type { SqlDatabase } from "../contracts";
import {
  PaymentLedger,
  error,
  type Attempt,
  type Bill,
  type Commit,
  type PaymentActor,
  type Refund,
} from "./ledger";
import type {
  CheckoutInput,
  CheckoutState,
  Integration,
  PaymentIntegrations,
} from "./provider";
import {
  creditSchema,
  manualPaymentSchema,
  refundSchema,
  paymentViewQuery,
  type RefundPage,
  type RefundView,
  type PaymentMode,
  type PaymentView,
} from "../../src/shared/payments";
import { pageOffset, pageInfo, PAGE_SIZE } from "../../src/shared/pagination";

export class PaymentService extends PaymentLedger {
  constructor(
    db: SqlDatabase,
    secret: string,
    readonly integrations: PaymentIntegrations,
    readonly origin: string,
  ) {
    super(db, secret);
  }
  async mode() {
    return (await this.db
      .prepare("SELECT mode FROM payment_settings WHERE id=1")
      .first<{ mode: PaymentMode }>())!.mode;
  }
  async view(
    bookingId: string,
    actor: PaymentActor,
    query: unknown = {},
  ): Promise<PaymentView> {
    const input = parseInput(paymentViewQuery, query);
    const bill = await this.bill(bookingId, actor),
      mode = await this.mode(),
      integration = await this.integrations.get(mode);
    const attempts = await this.db
      .prepare(
        "SELECT * FROM payment_attempts WHERE booking_id=?1 ORDER BY created_at DESC,id DESC LIMIT ?2 OFFSET ?3",
      )
      .bind(bill.id, PAGE_SIZE + 1, input.attemptOffset)
      .all<Attempt>();
    const history = await this.db
      .prepare(
        `SELECT p.id,p.kind,p.cents,p.mode,p.created_at AS createdAt,p.note,
          (p.kind='credit' AND p.cents>0 AND NOT EXISTS(SELECT 1 FROM payment_allocations r WHERE r.source_key='credit-reversal:'||p.id)) AS reversible
          FROM payment_allocations p WHERE p.booking_id=?1 ORDER BY p.created_at,p.id LIMIT ?2 OFFSET ?3`,
      )
      .bind(bill.id, PAGE_SIZE + 1, input.historyOffset)
      .all<{
        id: string;
        kind: string;
        cents: number;
        mode: PaymentMode;
        createdAt: number;
        note?: string;
        reversible: number;
      }>();
    const page = attempts.results.slice(0, PAGE_SIZE);
    type RefundRow = RefundView & { attemptId: string; total: number };
    const refundRows = page.length
      ? await this.db
          .prepare(
            `SELECT * FROM (
      SELECT id,attempt_id AS attemptId,amount_cents AS amountCents,status,note,
      count(*) OVER(PARTITION BY attempt_id) AS total,
      row_number() OVER(PARTITION BY attempt_id ORDER BY created_at,id) AS position
      FROM payment_refunds WHERE attempt_id IN (${page.map((_, i) => `?${i + 1}`).join(",")})
      ) WHERE position<=${PAGE_SIZE + 1} ORDER BY attemptId,position`,
          )
          .bind(...page.map((a) => a.id))
          .all<RefundRow>()
      : { results: [] };
    const refundsByAttempt = new Map<string, RefundRow[]>();
    for (const row of refundRows.results) {
      const group = refundsByAttempt.get(row.attemptId) ?? [];
      group.push(row);
      refundsByAttempt.set(row.attemptId, group);
    }
    return {
      bookingId,
      bookingStatus: bill.status,
      activeMode: mode,
      pagination: {
        attempts: pageInfo(input.attemptOffset, attempts.results.length),
        history: pageInfo(input.historyOffset, history.results.length),
      },
      balances: await Promise.all(
        (["live", "test"] as const).map((m) => this.balance(bill, m)),
      ),
      onlineAvailable: Boolean(
        integration?.enabled &&
        integration.verified &&
        integration.webhookVerified &&
        integration.adapter.capabilities.checkout &&
        ["active", "completed"].includes(bill.status),
      ),
      attempts: page.map((a) => ({
        id: a.id,
        provider: a.provider,
        mode: a.mode,
        amountCents: a.amount_cents,
        currency: a.currency,
        status: a.status,
        method: a.method,
        createdAt: a.created_at,
        ...(actor.role === "owner" ? { note: a.note } : {}),
        refundCount: refundsByAttempt.get(a.id)?.[0]?.total ?? 0,
        refundPagination: pageInfo(
          0,
          (refundsByAttempt.get(a.id) ?? []).length,
        ),
        refunds: (refundsByAttempt.get(a.id) ?? [])
          .slice(0, PAGE_SIZE)
          .map((r) => ({
            id: r.id,
            amountCents: r.amountCents,
            status: r.status,
            ...(actor.role === "owner" ? { note: r.note } : {}),
          })),
      })),
      history: history.results.slice(0, PAGE_SIZE).map((h) => {
        if (actor.role !== "owner") delete h.note;
        return {
          ...h,
          reversible: actor.role === "owner" && Boolean(h.reversible),
        };
      }),
    };
  }
  async refundPage(
    attemptId: string,
    actor: PaymentActor,
    requestedOffset: unknown = 0,
  ): Promise<RefundPage> {
    const offset = parseInput(pageOffset, requestedOffset),
      attempt = await this.attempt(attemptId);
    await this.bill(attempt.booking_id, actor);
    const rows = await this.db
      .prepare(
        "SELECT id,amount_cents AS amountCents,status,note FROM payment_refunds WHERE attempt_id=?1 ORDER BY created_at,id LIMIT ?2 OFFSET ?3",
      )
      .bind(attempt.id, PAGE_SIZE + 1, offset)
      .all<RefundView>();
    return {
      refunds: rows.results.slice(0, PAGE_SIZE).map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        status: r.status,
        ...(actor.role === "owner" ? { note: r.note } : {}),
      })),
      pagination: pageInfo(offset, rows.results.length),
    };
  }
  private async replay(
    actor: string,
    requestId: string,
    digest: string,
    bookingId: string,
  ) {
    const prior = await this.db
      .prepare(
        "SELECT * FROM payment_attempts WHERE actor_id=?1 AND request_key=?2",
      )
      .bind(actor, requestId)
      .first<Attempt>();
    if (
      prior &&
      (prior.request_digest !== digest || prior.booking_id !== bookingId)
    )
      error("This request ID was used for a different payment.");
    return prior;
  }
  async manual(bookingId: string, actor: PaymentActor, body: unknown) {
    if (actor.role !== "owner")
      error("Only the sitter can record a payment.", 403);
    const input = parseInput(manualPaymentSchema, body),
      digest = await this.hash({ kind: "manual", bookingId, ...input });
    return this.withLock(bookingId, async (commit) => {
      const bill = await this.bill(bookingId, actor);
      await this.checkActor(actor, bookingId);
      const prior = await this.replay(
        actor.id,
        input.requestId,
        digest,
        bookingId,
      );
      if (prior) return prior.id;
      if (await this.active(bookingId, "live"))
        error(
          "Resolve or expire the open online payment before recording money manually.",
        );
      const balance = await this.balance(bill, "live");
      if (input.amountCents > balance.outstandingCents)
        error(
          "The amount exceeds the outstanding balance. Review existing payments first.",
        );
      const id = crypto.randomUUID(),
        now = Date.now();
      await commit([
        this.db
          .prepare(
            `INSERT INTO payment_attempts(id,booking_id,provider,mode,amount_cents,currency,status,request_payload,request_key,request_digest,actor_id,method,note,created_at,updated_at)
          VALUES(?1,?2,'manual','live',?3,?4,'succeeded','{}',?5,?6,?7,?8,?9,?10,?10)`,
          )
          .bind(
            id,
            bookingId,
            input.amountCents,
            bill.currency,
            input.requestId,
            digest,
            actor.id,
            input.method,
            input.note,
            now,
          ),
        this.entry({
          bill,
          mode: "live",
          kind: "receipt",
          cents: input.amountCents,
          source: `receipt:${id}`,
          attemptId: id,
          actor: actor.id,
          note: input.note,
        }),
        this.audit(bookingId, id, "manual-payment-recorded", actor.id),
        ...(!["active", "completed"].includes(bill.status)
          ? [
              this.review(
                bookingId,
                "A manual payment was recorded for an unconfirmed or canceled booking. Review it; no refund was issued.",
              ),
            ]
          : []),
      ]);
      return id;
    });
  }
  async credit(bookingId: string, actor: PaymentActor, body: unknown) {
    if (actor.role !== "owner")
      error("Only the sitter can reduce a booking charge.", 403);
    const input = parseInput(creditSchema, body),
      source = `credit:${actor.id}:${input.requestId}`,
      digest = await this.hash({ bookingId, ...input });
    return this.withLock(bookingId, async (commit) => {
      const bill = await this.bill(bookingId, actor);
      await this.checkActor(actor, bookingId);
      const prior = await this.db
        .prepare(
          "SELECT cents,note,booking_id,mode FROM payment_allocations WHERE source_key=?1",
        )
        .bind(source)
        .first<{
          cents: number;
          note: string;
          booking_id: string;
          mode: string;
        }>();
      if (prior) {
        if (
          prior.cents !== input.amountCents ||
          prior.note !== input.note ||
          prior.booking_id !== bookingId ||
          prior.mode !== input.mode
        )
          error("This request ID was already used for another credit.");
        return;
      }
      if (await this.active(bookingId, input.mode))
        error("Resolve the online payment before changing the amount due.");
      const balance = await this.balance(bill, input.mode);
      if (input.amountCents > balance.chargeCents - balance.creditCents)
        error("A credit cannot exceed the remaining booking charge.");
      await commit([
        this.entry({
          bill,
          mode: input.mode,
          kind: "credit",
          cents: input.amountCents,
          source,
          actor: actor.id,
          note: input.note,
        }),
        this.audit(bookingId, null, `booking-credit:${digest}`, actor.id),
        ...(balance.netCents >
        balance.chargeCents - balance.creditCents - input.amountCents
          ? [
              this.review(
                bookingId,
                "A booking credit created an overpayment. Review whether a separate refund is needed.",
              ),
            ]
          : []),
      ]);
    });
  }
  async reverseCredit(id: string, actor: PaymentActor, note: string) {
    if (actor.role !== "owner")
      error("Only the sitter can reverse a booking credit.", 403);
    const row = await this.db
      .prepare(
        "SELECT * FROM payment_allocations WHERE id=?1 AND kind='credit' AND cents>0",
      )
      .bind(id)
      .first<{ booking_id: string; mode: PaymentMode; cents: number }>();
    if (!row) error("Booking credit not found.", 404);
    await this.bill(row.booking_id, actor);
    return this.withLock(row.booking_id, async (commit) => {
      const bill = await this.bill(row.booking_id, actor);
      await this.checkActor(actor, bill.id);
      const source = `credit-reversal:${id}`;
      if (
        await this.db
          .prepare("SELECT 1 FROM payment_allocations WHERE source_key=?1")
          .bind(source)
          .first()
      )
        return;
      if (await this.active(bill.id, row.mode))
        error("Resolve the online payment before changing the amount due.");
      await commit([
        this.entry({
          bill,
          mode: row.mode,
          kind: "credit",
          cents: -row.cents,
          source,
          actor: actor.id,
          note,
        }),
        this.audit(
          bill.id,
          null,
          "booking-credit-reversed-no-money-moved",
          actor.id,
        ),
      ]);
    });
  }
  async voidManual(id: string, actor: PaymentActor, note: string) {
    if (actor.role !== "owner")
      error("Only the sitter can void a manual record.", 403);
    const first = await this.attempt(id);
    await this.bill(first.booking_id, actor);
    return this.withLock(first.booking_id, async (commit) => {
      const a = await this.attempt(id),
        bill = await this.bill(a.booking_id, actor);
      await this.checkActor(actor, bill.id);
      if (a.provider !== "manual")
        error(
          "Online payments cannot be voided in the ledger. Use a provider refund.",
        );
      if (
        await this.db
          .prepare("SELECT 1 FROM payment_allocations WHERE source_key=?1")
          .bind(`void:${id}`)
          .first()
      )
        return;
      if (
        await this.db
          .prepare("SELECT 1 FROM payment_refunds WHERE attempt_id=?1")
          .bind(id)
          .first()
      )
        error("A refunded payment cannot be voided.");
      if (await this.active(bill.id, "live"))
        error("Resolve the online payment before changing the ledger.");
      await commit([
        this.entry({
          bill,
          mode: "live",
          kind: "void",
          cents: -a.amount_cents,
          source: `void:${id}`,
          attemptId: id,
          actor: actor.id,
          note,
        }),
        this.db
          .prepare(
            "UPDATE payment_attempts SET status='failed',updated_at=?2 WHERE id=?1",
          )
          .bind(id, Date.now()),
        this.audit(
          bill.id,
          id,
          "manual-record-voided-no-money-moved",
          actor.id,
        ),
      ]);
    });
  }
  private async provider(a: Attempt): Promise<Integration> {
    const integration = await this.integrations.get(a.mode);
    if (
      !integration ||
      integration.id !== a.integration_id ||
      !integration.verified ||
      !integration.accountId
    )
      error("The original payment account must be verified before continuing.");
    return integration;
  }
  async checkout(bookingId: string, actor: PaymentActor, requestId: string) {
    const digest = await this.hash({ kind: "checkout", bookingId, requestId });
    return this.withLock(bookingId, async (commit) => {
      const bill = await this.bill(bookingId, actor);
      await this.checkActor(actor, bookingId);
      let a = await this.replay(actor.id, requestId, digest, bookingId);
      if (!a) {
        if (!["active", "completed"].includes(bill.status))
          error("Only confirmed or completed bookings can be paid online.");
        const mode = await this.mode(),
          integration = await this.integrations.get(mode);
        if (
          !integration?.enabled ||
          !integration.verified ||
          !integration.webhookVerified ||
          !integration.adapter.capabilities.checkout
        )
          error("Online payment is not ready. Contact your sitter.");
        // Reuse the existing attempt for this household, even from another browser/request ID.
        const active = await this.active(bookingId, mode);
        if (active) a = await this.attempt(String(active.id));
        else {
          const balance = await this.balance(bill, mode);
          if (balance.outstandingCents < 50)
            error(
              "Online checkout requires at least 0.50 in the booking currency. Contact the sitter for another method.",
            );
          const id = crypto.randomUUID(),
            now = Date.now();
          const input: CheckoutInput = {
            attemptId: id,
            integrationId: integration.id,
            amountCents: balance.outstandingCents,
            currency: bill.currency,
            name: bill.service_name,
            returnUrl: `${this.origin}/app/bookings/${encodeURIComponent(bookingId)}/payments`,
            expiresAt: now + 3_600_000,
            integrationLabel: `boopity_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (v) => String.fromCharCode(97 + (v % 26))).join("")}`,
          };
          await commit([
            this.db
              .prepare(
                `INSERT INTO payment_attempts(id,booking_id,provider,integration_id,mode,amount_cents,currency,status,request_payload,request_key,request_digest,actor_id,method,created_at,updated_at,expires_at)
            VALUES(?1,?2,?13,?3,?4,?5,?6,'creating',?7,?8,?9,?10,'online',?11,?11,?12)`,
              )
              .bind(
                id,
                bookingId,
                integration.id,
                mode,
                balance.outstandingCents,
                bill.currency,
                JSON.stringify(input),
                requestId,
                digest,
                actor.id,
                now,
                input.expiresAt,
                integration.provider,
              ),
            this.audit(bookingId, id, "checkout-requested", actor.id),
          ]);
          a = await this.attempt(id);
        }
      }
      await this.syncLocked(a, bill, commit);
      const current = await this.attempt(a.id);
      if (current.status !== "open" || !current.checkout_url)
        return {
          id: a.id,
          status: current.status,
          url: null,
          mode: current.mode,
        };
      // Never return a payable link after cancellation, revocation or pause while a provider call was in flight.
      await this.checkActor(actor, bookingId);
      const latest = await this.bill(bookingId),
        integration = await this.provider(current);
      if (
        !["active", "completed"].includes(latest.status) ||
        !integration.enabled ||
        (await this.mode()) !== current.mode
      )
        error(
          "Checkout was paused or the booking changed. Refresh before continuing.",
        );
      return {
        id: current.id,
        status: current.status,
        url: current.checkout_url,
        mode: current.mode,
      };
    });
  }
  private async apply(
    a: Attempt,
    bill: Bill,
    snapshot: CheckoutState,
    commit: Commit,
  ) {
    if (
      snapshot.attemptId !== a.id ||
      snapshot.integrationId !== a.integration_id ||
      snapshot.mode !== a.mode ||
      snapshot.amountCents !== a.amount_cents ||
      snapshot.currency !== a.currency ||
      (a.provider_ref && snapshot.id !== a.provider_ref) ||
      (a.payment_ref && snapshot.paymentRef !== a.payment_ref)
    )
      error(
        "Provider payment details do not match the saved request. Review the account.",
      );
    const statements = [
      this.db
        .prepare(
          `UPDATE payment_attempts SET provider_ref=?2,payment_ref=coalesce(?3,payment_ref),checkout_url=?4,
      status=CASE WHEN status='succeeded' THEN status ELSE ?5 END,updated_at=?6,last_checked_at=?6 WHERE id=?1`,
        )
        .bind(
          a.id,
          snapshot.id,
          snapshot.paymentRef,
          snapshot.url,
          snapshot.status,
          Date.now(),
        ),
    ];
    if (snapshot.status === "succeeded") {
      if (!snapshot.paymentRef)
        error("Successful checkout is missing its payment reference.");
      statements.push(
        this.entry({
          bill,
          mode: a.mode,
          kind: "receipt",
          cents: a.amount_cents,
          source: `receipt:${a.id}`,
          attemptId: a.id,
        }),
      );
      if (a.status !== "succeeded")
        statements.push(
          this.audit(bill.id, a.id, "provider-payment-confirmed", "provider"),
        );
      const before = await this.balance(bill, a.mode);
      if (
        a.status !== "succeeded" &&
        (!["active", "completed"].includes(bill.status) ||
          a.amount_cents > before.outstandingCents)
      )
        statements.push(
          this.review(
            bill.id,
            "A payment arrived after cancellation or created an overpayment. Review it; no automatic refund was issued.",
          ),
        );
      if (snapshot.disputed)
        statements.push(
          this.review(
            bill.id,
            "Stripe reports a disputed payment. Resolve the dispute in Stripe; this is not an automatic refund.",
          ),
        );
    }
    const seen = new Set<string>();
    for (const r of snapshot.refunds) {
      if (
        !Number.isSafeInteger(r.amountCents) ||
        r.amountCents <= 0 ||
        r.amountCents > a.amount_cents ||
        seen.has(r.id)
      )
        error("Invalid refund reconciliation.");
      seen.add(r.id);
      let row = await this.db
        .prepare(
          "SELECT * FROM payment_refunds WHERE integration_id=?1 AND provider_ref=?2",
        )
        .bind(a.integration_id, r.id)
        .first<Refund>();
      if (!row && r.localId)
        row = await this.db
          .prepare(
            "SELECT * FROM payment_refunds WHERE id=?1 AND attempt_id=?2",
          )
          .bind(r.localId, a.id)
          .first<Refund>();
      if (
        row &&
        (row.attempt_id !== a.id ||
          row.amount_cents !== r.amountCents ||
          (row.provider_ref && row.provider_ref !== r.id))
      )
        error("Refund does not match its original payment.");
      const id = row?.id ?? crypto.randomUUID(),
        previous = row?.applied_cents ?? 0,
        next = r.status === "succeeded" ? r.amountCents : 0,
        delta = previous - next,
        version = (row?.version ?? 0) + 1;
      if (!row)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO payment_refunds(id,attempt_id,integration_id,provider_ref,amount_cents,status,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?7)`,
            )
            .bind(
              id,
              a.id,
              a.integration_id,
              r.id,
              r.amountCents,
              r.status,
              Date.now(),
            ),
        );
      if (!row || row.status !== r.status || !row.provider_ref) {
        statements.push(
          this.db
            .prepare(
              "UPDATE payment_refunds SET provider_ref=?2,status=?3,applied_cents=?4,version=?5,updated_at=?6 WHERE id=?1",
            )
            .bind(id, r.id, r.status, next, version, Date.now()),
          this.audit(bill.id, a.id, `provider-refund-${r.status}`, "provider"),
        );
        if (delta)
          statements.push(
            this.entry({
              bill,
              mode: a.mode,
              kind: delta < 0 ? "refund" : "refund-reversal",
              cents: delta,
              source: `refund:${id}:${version}`,
              attemptId: a.id,
              refundId: id,
            }),
          );
        if (["failed", "canceled", "requires_action"].includes(r.status))
          statements.push(
            this.review(
              bill.id,
              "A provider refund failed, was canceled or needs action. Review the original payment in Stripe.",
            ),
          );
      }
    }
    await commit(statements);
  }
  private async syncLocked(a: Attempt, bill: Bill, commit: Commit) {
    const integration = await this.provider(a);
    try {
      let snapshot: CheckoutState;
      if (a.provider_ref)
        snapshot = await integration.adapter.inspectCheckout(a.provider_ref);
      else {
        if (
          a.status !== "creating" ||
          !integration.enabled ||
          Date.now() >= (a.expires_at ?? 0) - 300_000 ||
          !["active", "completed"].includes(bill.status)
        ) {
          await commit([
            this.db
              .prepare(
                "UPDATE payment_attempts SET status='review',last_checked_at=?2 WHERE id=?1",
              )
              .bind(a.id, Date.now()),
            this.review(
              bill.id,
              "An online payment request has an unknown outcome. Reconcile it with the original account; do not create another charge.",
            ),
          ]);
          return;
        }
        snapshot = await integration.adapter.createCheckout(
          JSON.parse(a.request_payload) as CheckoutInput,
        );
      }
      if (
        snapshot.status === "open" &&
        (!(await this.provider(a)).enabled ||
          !["active", "completed"].includes(
            (await this.bill(bill.id)).status,
          ) ||
          (await this.mode()) !== a.mode)
      ) {
        if (!integration.adapter.capabilities.expire)
          error(
            "This provider cannot expire checkout. Reconcile it with the original account.",
          );
        await integration.adapter.expireCheckout(
          snapshot.id,
          `boopity:expire:${a.id}`,
        );
        snapshot = await integration.adapter.inspectCheckout(snapshot.id);
      }
      await this.apply(a, await this.bill(bill.id), snapshot, commit);
    } catch {
      // Do not release the reservation on a network error: money may already be in flight.
      await commit([
        this.db
          .prepare("UPDATE payment_attempts SET last_checked_at=?2 WHERE id=?1")
          .bind(a.id, Date.now()),
      ]);
      error(
        "The provider outcome is not yet confirmed. Refresh or reconcile the same payment; do not create a replacement.",
        503,
      );
    }
  }
  async sync(id: string, actor?: PaymentActor) {
    const a = await this.attempt(id);
    const bill = await this.bill(a.booking_id, actor);
    if (a.provider === "manual") return;
    return this.withLock(bill.id, async (commit) =>
      this.syncLocked(await this.attempt(id), await this.bill(bill.id), commit),
    );
  }
  async expire(id: string, actor: PaymentActor) {
    if (actor.role !== "owner")
      error("Only the sitter can close an online checkout.", 403);
    const a = await this.attempt(id),
      bill = await this.bill(a.booking_id, actor);
    return this.withLock(bill.id, async (commit) => {
      await this.checkActor(actor, bill.id);
      await this.syncLocked(await this.attempt(id), bill, commit);
      const current = await this.attempt(id),
        integration = await this.provider(current);
      if (current.status !== "open" || !current.provider_ref)
        error(
          "Only an open checkout can expire. Processing or unknown payments require reconciliation.",
        );
      if (!integration.adapter.capabilities.expire)
        error("This provider does not support expiring checkout.");
      await integration.adapter.expireCheckout(
        current.provider_ref,
        `boopity:expire:${current.id}`,
      );
      await this.apply(
        current,
        bill,
        await integration.adapter.inspectCheckout(current.provider_ref),
        commit,
      );
      await commit([
        this.audit(bill.id, id, "checkout-expired-by-owner", actor.id),
      ]);
    });
  }
  async refund(id: string, actor: PaymentActor, body: unknown) {
    if (actor.role !== "owner")
      error("Only the sitter can issue or record refunds.", 403);
    const input = parseInput(refundSchema, body),
      first = await this.attempt(id),
      bill = await this.bill(first.booking_id, actor),
      digest = await this.hash({ attemptId: id, ...input });
    return this.withLock(bill.id, async (commit) => {
      await this.checkActor(actor, bill.id);
      let a = await this.attempt(id);
      if (a.provider !== "manual") {
        if (!(await this.provider(a)).adapter.capabilities.refunds)
          error("This provider does not support refunds from Boopity.");
        await this.syncLocked(a, bill, commit);
        a = await this.attempt(id);
      }
      let row = await this.db
        .prepare(
          "SELECT * FROM payment_refunds WHERE actor_id=?1 AND request_key=?2",
        )
        .bind(actor.id, input.requestId)
        .first<Refund>();
      if (row && (row.attempt_id !== id || row.request_digest !== digest))
        error("This request ID was already used for another refund.");
      if (!row) {
        if (a.status !== "succeeded")
          error("Only a received payment can be refunded.");
        const held = (await this.db
          .prepare(
            "SELECT coalesce(sum(amount_cents),0) AS n FROM payment_refunds WHERE attempt_id=?1 AND status NOT IN ('failed','canceled')",
          )
          .bind(id)
          .first<{ n: number }>())!.n;
        if (input.amountCents + held > a.amount_cents)
          error(
            "Refunds cannot exceed the original payment, including pending refunds.",
          );
        const refundId = crypto.randomUUID(),
          now = Date.now();
        await commit([
          this.db
            .prepare(
              `INSERT INTO payment_refunds(id,attempt_id,integration_id,amount_cents,status,applied_cents,request_key,request_digest,actor_id,note,created_at,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)`,
            )
            .bind(
              refundId,
              id,
              a.integration_id,
              input.amountCents,
              a.provider === "manual" ? "succeeded" : "creating",
              a.provider === "manual" ? input.amountCents : 0,
              input.requestId,
              digest,
              actor.id,
              input.note,
              now,
            ),
          this.audit(
            bill.id,
            id,
            a.provider === "manual"
              ? "manual-refund-recorded"
              : "provider-refund-requested",
            actor.id,
          ),
          ...(a.provider === "manual"
            ? [
                this.entry({
                  bill,
                  mode: a.mode,
                  kind: "refund",
                  cents: -input.amountCents,
                  source: `refund:${refundId}:manual`,
                  attemptId: id,
                  refundId,
                  actor: actor.id,
                  note: input.note,
                }),
              ]
            : []),
        ]);
        row = (await this.db
          .prepare("SELECT * FROM payment_refunds WHERE id=?1")
          .bind(refundId)
          .first<Refund>())!;
      }
      if (a.provider === "manual" || row.status !== "creating") return row.id;
      if (Date.now() > row.created_at + 23 * 3_600_000) {
        await commit([
          this.db
            .prepare("UPDATE payment_refunds SET status='review' WHERE id=?1")
            .bind(row.id),
          this.review(
            bill.id,
            "A refund request has an unknown outcome outside the safe retry window. Reconcile it with the provider before any further refund.",
          ),
        ]);
        return row.id;
      }
      const integration = await this.provider(a);
      if (!a.payment_ref)
        error("The received payment is missing its provider reference.");
      try {
        await integration.adapter.refund(
          a.payment_ref,
          row.amount_cents,
          row.id,
        );
      } catch {
        error(
          "Refund outcome is unconfirmed. Reconcile or retry this exact request; no replacement refund should be issued.",
          503,
        );
      }
      await this.syncLocked(a, bill, commit);
      return row.id;
    });
  }
  async retryRefund(id: string, actor: PaymentActor) {
    if (actor.role !== "owner")
      error("Only the sitter can retry a refund.", 403);
    const row = await this.db
      .prepare("SELECT * FROM payment_refunds WHERE id=?1 AND actor_id=?2")
      .bind(id, actor.id)
      .first<Refund>();
    if (!row?.request_key) error("Refund request not found.", 404);
    return this.refund(row.attempt_id, actor, {
      requestId: row.request_key,
      amountCents: row.amount_cents,
      note: row.note,
      confirm: true,
    });
  }
  async webhook(mode: PaymentMode, raw: string, signature: string) {
    const integration = await this.integrations.get(mode);
    if (!integration) error("This webhook is not configured.", 400);
    let event;
    try {
      event = await integration.adapter.verifyEvent(raw, signature);
    } catch {
      error("Invalid webhook signature.", 400);
    }
    if (
      event.mode !== mode ||
      (event.account && event.account !== integration.accountId)
    )
      error("Webhook mode or account mismatch.", 400);
    await this.integrations.webhookSeen(mode, integration.version);
    if (
      await this.db
        .prepare(
          "SELECT 1 FROM payment_webhook_events WHERE integration_id=?1 AND event_id=?2",
        )
        .bind(integration.id, event.id)
        .first()
    )
      return;
    let a: Attempt | null = null;
    if (event.checkoutRef)
      a = await this.db
        .prepare(
          "SELECT * FROM payment_attempts WHERE integration_id=?1 AND (provider_ref=?2 OR id=?3)",
        )
        .bind(integration.id, event.checkoutRef, event.localAttemptId ?? "")
        .first<Attempt>();
    else if (event.paymentRef) {
      a = await this.db
        .prepare(
          "SELECT * FROM payment_attempts WHERE integration_id=?1 AND payment_ref=?2",
        )
        .bind(integration.id, event.paymentRef)
        .first<Attempt>();
      if (!a && integration.verified) {
        const local = await integration.adapter.findAttempt(event.paymentRef);
        if (local)
          a = await this.db
            .prepare(
              "SELECT * FROM payment_attempts WHERE integration_id=?1 AND id=?2",
            )
            .bind(integration.id, local)
            .first<Attempt>();
      }
    }
    if (a)
      await this.withLock(a.booking_id, async (commit) => {
        const current = await this.attempt(a!.id),
          bill = await this.bill(a!.booking_id);
        if (event.checkoutRef && !current.provider_ref) {
          // A signed event can arrive before the create response. Reconcile the provider object, not the return URL.
          const provider = await this.provider(current);
          await this.apply(
            current,
            bill,
            await provider.adapter.inspectCheckout(event.checkoutRef),
            commit,
          );
        } else {
          if (!current.provider_ref)
            error("Awaiting the checkout reference. Retry this event.", 503);
          await this.syncLocked(current, bill, commit);
        }
      });
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO payment_webhook_events VALUES(?1,?2,?3,?4)",
      )
      .bind(integration.id, event.id, event.type, Date.now())
      .run();
  }
  async reconcile(limit = 10) {
    const rows = await this.db
      .prepare(
        `SELECT id FROM payment_attempts WHERE provider<>'manual'
      AND (status IN ('creating','open','processing','review') OR status='succeeded' AND created_at>?1)
      AND last_checked_at<?2 ORDER BY last_checked_at,created_at LIMIT ?3`,
      )
      .bind(Date.now() - 90 * 86_400_000, Date.now() - 60_000, limit)
      .all<{ id: string }>();
    for (const row of rows.results) {
      try {
        await this.sync(row.id);
      } catch {
        /* Keep unresolved funds held; next scheduled pass retries safely. */
      }
    }
  }
}
