import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../platform/node/runtime";
import { PaymentService } from "../platform/payments/service";
import { alice, bob, manual, owner, paymentFixture } from "./payment-fixture";

const fixtures: ReturnType<typeof paymentFixture>[] = [];
function fixture() {
  const f = paymentFixture();
  fixtures.push(f);
  return f;
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("External network blocked");
    }),
  ),
);
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const refund = (amountCents = 1000) => ({
  requestId: crypto.randomUUID(),
  amountCents,
  note: "PRIVATE REFUND REASON",
  confirm: true,
});
const balance = async (
  f: ReturnType<typeof fixture>,
  mode: "live" | "test" = "live",
) =>
  (await f.service.view("booking-a", owner)).balances.find(
    (b) => b.mode === mode,
  )!;

describe("provider-independent ledger", () => {
  it("reverses mistaken credits once without rewriting history and reopens review for late manual receipts", async () => {
    const f = fixture();
    await f.service.credit("booking-a", owner, {
      requestId: crypto.randomUUID(),
      amountCents: 1000,
      mode: "live",
      note: "Mistaken credit",
    });
    const original = (await f.service.view("booking-a", owner)).history[0];
    expect(original.reversible).toBe(true);
    await expect(
      f.service.reverseCredit(original.id, alice, "forbidden"),
    ).rejects.toThrow("Only the sitter");
    await f.service.reverseCredit(original.id, owner, "Corrected amount");
    await f.service.reverseCredit(original.id, owner, "Repeated");
    expect(await balance(f)).toMatchObject({
      creditCents: 0,
      outstandingCents: 3000,
    });
    const history = (await f.service.view("booking-a", owner)).history;
    expect(history).toHaveLength(2);
    expect(history.every((h) => !h.reversible)).toBe(true);
    expect(history.find((h) => h.id === original.id)?.cents).toBe(1000);
    await f.db
      .prepare("UPDATE bookings SET status='cancelled' WHERE id='booking-a'")
      .run();
    await f.db
      .prepare(
        "INSERT INTO booking_financial_followups(booking_id,reason,created_at,resolved_at,resolution) VALUES('booking-a','Old review',1,2,'Reviewed')",
      )
      .run();
    await f.service.manual("booking-a", owner, manual());
    expect(
      await f.db
        .prepare("SELECT resolved_at FROM booking_financial_followups")
        .first(),
    ).toEqual({ resolved_at: null });
  });
  it("keeps partial payments partial, replays safely, and refuses overpayments", async () => {
    const f = fixture(),
      input = manual();
    const id = await f.service.manual("booking-a", owner, input);
    expect(await f.service.manual("booking-a", owner, input)).toBe(id);
    expect(await balance(f)).toMatchObject({
      receivedCents: 1000,
      outstandingCents: 2000,
      status: "partial",
    });
    await expect(
      f.service.manual("booking-a", owner, { ...input, amountCents: 1500 }),
    ).rejects.toThrow("different payment");
    await expect(
      f.service.manual("booking-a", owner, manual(2001)),
    ).rejects.toThrow("exceeds");
    await f.service.manual("booking-a", owner, manual(2000));
    expect(await balance(f)).toMatchObject({
      outstandingCents: 0,
      status: "paid",
    });
    expect(
      (await f.db.prepare("SELECT * FROM payment_allocations").all()).results,
    ).toHaveLength(2);
  });
  it("supports manual-only use, immutable void history, credits, and no implicit refund on cancellation", async () => {
    const f = fixture();
    f.map.clear();
    const id = await f.service.manual("booking-a", owner, manual(3000));
    await f.service.voidManual(id, owner, "Incorrect entry");
    await f.service.voidManual(id, owner, "Repeated");
    expect(await balance(f)).toMatchObject({
      receivedCents: 0,
      status: "unpaid",
    });
    const next = await f.service.manual("booking-a", owner, manual(3000));
    const input = refund(1000);
    await f.service.refund(next, owner, input);
    await f.service.refund(next, owner, input);
    expect(await balance(f)).toMatchObject({
      refundedCents: 1000,
      outstandingCents: 1000,
      status: "partial",
    });
    await f.db
      .prepare("UPDATE bookings SET status='cancelled' WHERE id='booking-a'")
      .run();
    expect((await balance(f)).refundedCents).toBe(1000);
    const credit = {
      requestId: crypto.randomUUID(),
      amountCents: 1000,
      note: "Agreed cancellation adjustment",
      mode: "live",
    };
    await f.service.credit("booking-a", owner, credit);
    await f.service.credit("booking-a", owner, credit);
    expect(await balance(f)).toMatchObject({
      outstandingCents: 0,
      creditCents: 1000,
      status: "paid",
    });
    await expect(
      f.service.credit("booking-a", owner, { ...credit, amountCents: 2000 }),
    ).rejects.toThrow("another credit");
    await expect(
      f.db.prepare("DELETE FROM payment_allocations").run(),
    ).rejects.toThrow("immutable");
    await expect(
      f.db.prepare("UPDATE payment_audit SET event='forged'").run(),
    ).rejects.toThrow("immutable");
  });
  it("isolates clients, private accounting notes, original currencies and owner-only money actions", async () => {
    const f = fixture(),
      id = await f.service.manual("booking-a", owner, manual());
    expect(
      JSON.stringify(await f.service.view("booking-a", alice)),
    ).not.toMatch(/PRIVATE|request_digest|actor_id|provider_ref|checkout_url/);
    await expect(f.service.view("booking-a", bob)).rejects.toThrow("not found");
    await expect(
      f.service.manual("booking-a", alice, manual()),
    ).rejects.toThrow("Only the sitter");
    await expect(f.service.refund(id, alice, refund())).rejects.toThrow(
      "Only the sitter",
    );
    await f.db.prepare("UPDATE installation SET currency='EUR'").run();
    expect((await balance(f)).currency).toBe("USD");
    expect((await f.service.view("booking-b", bob)).balances[0].currency).toBe(
      "EUR",
    );
  });
  it("serializes money writes across database connections and rolls back a lost lease", async () => {
    const f = fixture(),
      peer = createRuntime(f.config, {});
    try {
      const service = new PaymentService(
        peer.db,
        peer.env.BETTER_AUTH_SECRET,
        f.integrations,
        f.config.appUrl,
      );
      const race = await Promise.allSettled([
        f.service.manual("booking-a", owner, manual(2000)),
        service.manual("booking-a", owner, manual(2000)),
      ]);
      expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await balance(f)).receivedCents).toBe(2000);
      await expect(
        f.service.withLock("booking-a", async (commit) => {
          await peer.db
            .prepare(
              "UPDATE payment_locks SET token='changed' WHERE id='booking-a'",
            )
            .run();
          await commit([
            f.db.prepare(
              "UPDATE bookings SET total_amount_cents=1 WHERE id='booking-a'",
            ),
          ]);
        }),
      ).rejects.toThrow();
      expect((await balance(f)).chargeCents).toBe(3000);
      expect(
        (await service.view("booking-a", owner)).balances[0].receivedCents,
      ).toBe(2000);
    } finally {
      peer.close();
    }
  });
});
describe("checkout and provider lifecycle", () => {
  it("returns checkout to the booking's named Payments path", async () => {
    const f = fixture();
    const create = vi.spyOn(f.test, "createCheckout");
    await f.service.checkout("booking-a", alice, crypto.randomUUID());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: "http://localhost:3000/app/bookings/booking-a/payments",
      }),
    );
  });
  it("honors provider capabilities and does not return a payable URL after cancellation during creation", async () => {
    const f = fixture();
    f.test.capabilities.checkout = false;
    expect((await f.service.view("booking-a", alice)).onlineAvailable).toBe(
      false,
    );
    await expect(
      f.service.checkout("booking-a", alice, crypto.randomUUID()),
    ).rejects.toThrow("not ready");
    expect(f.test.calls.create).toBe(0);
    f.test.capabilities.checkout = true;
    f.test.afterCreate = async () => {
      await f.db
        .prepare("UPDATE bookings SET status='cancelled' WHERE id='booking-a'")
        .run();
    };
    expect(
      await f.service.checkout("booking-a", alice, crypto.randomUUID()),
    ).toMatchObject({ status: "expired", url: null });
    expect(f.test.calls.expire).toBe(1);
  });
  it("reserves one checkout per booking, reuses it, and separates sandbox from real balances", async () => {
    const f = fixture(),
      key = crypto.randomUUID(),
      first = await f.service.checkout("booking-a", alice, key);
    expect(
      (await f.service.checkout("booking-a", alice, crypto.randomUUID())).id,
    ).toBe(first.id);
    expect(f.test.calls.create).toBe(1);
    f.test.paid();
    await f.service.sync(first.id, alice);
    expect(await balance(f, "test")).toMatchObject({
      receivedCents: 3000,
      status: "paid",
    });
    expect(await balance(f)).toMatchObject({
      receivedCents: 0,
      status: "unpaid",
    });
    await f.service.manual("booking-a", owner, manual(1000));
    await f.db.prepare("UPDATE payment_settings SET mode='live'").run();
    const live = await f.service.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    expect([...f.live.sessions.values()][0].amountCents).toBe(2000);
    await expect(
      f.service.manual("booking-a", owner, manual(2000)),
    ).rejects.toThrow("online payment");
    f.live.paid();
    await f.service.sync(live.id, owner);
    expect((await balance(f)).status).toBe("paid");
  });
  it("does not trust processing, stale events or a client return URL as payment proof", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID()),
      state = [...f.test.sessions.values()][0];
    state.status = "processing";
    await f.service.sync(a.id, alice);
    expect((await balance(f, "test")).receivedCents).toBe(0);
    state.status = "failed";
    await f.service.sync(a.id, alice);
    expect((await balance(f, "test")).receivedCents).toBe(0);
    f.test.paid();
    const event = {
      id: "evt_same",
      type: "checkout.session.expired",
      mode: "test",
      checkoutRef: state.id,
    };
    await f.service.webhook("test", JSON.stringify(event), "local-verified");
    await f.service.webhook("test", JSON.stringify(event), "local-verified");
    expect((await balance(f, "test")).receivedCents).toBe(3000);
    expect(
      (await f.db.prepare("SELECT * FROM payment_webhook_events").all())
        .results,
    ).toHaveLength(1);
    expect(
      (
        await f.db
          .prepare("SELECT * FROM payment_allocations WHERE kind='receipt'")
          .all()
      ).results,
    ).toHaveLength(1);
  });
  it("reconciles a lost checkout response from its signed event without creating a replacement", async () => {
    const f = fixture();
    f.test.loseCreateResponse = true;
    await expect(
      f.service.checkout("booking-a", alice, crypto.randomUUID()),
    ).rejects.toThrow("not yet confirmed");
    const state = f.test.paid();
    await f.service.webhook(
      "test",
      JSON.stringify({
        id: "evt_early",
        type: "checkout.session.completed",
        mode: "test",
        checkoutRef: state.id,
        localAttemptId: state.attemptId,
      }),
      "local-verified",
    );
    expect((await balance(f, "test")).receivedCents).toBe(3000);
    expect(f.test.calls.create).toBe(1);
  });
  it("retries identical checkout parameters only inside their safe window and keeps old unknown outcomes held", async () => {
    const f = fixture();
    f.test.loseCreateResponse = true;
    const key = crypto.randomUUID();
    await expect(f.service.checkout("booking-a", alice, key)).rejects.toThrow();
    f.test.loseCreateResponse = false;
    await f.service.checkout("booking-a", alice, key);
    expect(f.test.sessions.size).toBe(1);
    await f.db
      .prepare(
        "UPDATE payment_attempts SET provider_ref=NULL,status='creating',expires_at=1 WHERE booking_id='booking-a'",
      )
      .run();
    const before = f.test.calls.create;
    const retry = await f.service.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    expect(retry.status).toBe("review");
    expect(f.test.calls.create).toBe(before);
    expect(
      (await f.db.prepare("SELECT * FROM booking_financial_followups").all())
        .results,
    ).toHaveLength(1);
  });
  it("expires cancelled open checkouts and records late payments for financial review without refunds", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID());
    await f.db
      .prepare("UPDATE bookings SET status='cancelled' WHERE id='booking-a'")
      .run();
    await f.service.sync(a.id, owner);
    expect(f.test.calls.expire).toBe(1);
    f.test.paid();
    await f.service.sync(a.id, owner);
    expect((await balance(f, "test")).receivedCents).toBe(3000);
    expect(f.test.calls.refund).toBe(0);
    expect(
      await f.db
        .prepare("SELECT resolved_at FROM booking_financial_followups")
        .first(),
    ).toEqual({ resolved_at: null });
  });
  it("rejects altered provider amount, currency, mode, metadata, account and signatures", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID()),
      state = f.test.paid();
    for (const patch of [
      { amountCents: 1 },
      { currency: "EUR" },
      { mode: "live" },
      { attemptId: "other" },
      { integrationId: "other" },
    ]) {
      const prior = structuredClone(state);
      Object.assign(state, patch);
      await expect(f.service.sync(a.id, owner)).rejects.toThrow();
      Object.assign(state, prior);
      expect((await balance(f, "test")).receivedCents).toBe(0);
    }
    await expect(
      f.service.webhook(
        "test",
        JSON.stringify({ id: "evt", mode: "live" }),
        "local-verified",
      ),
    ).rejects.toThrow("mismatch");
    await expect(
      f.service.webhook(
        "test",
        JSON.stringify({ id: "evt", mode: "test", account: "acct_other" }),
        "local-verified",
      ),
    ).rejects.toThrow("mismatch");
    await expect(f.service.webhook("test", "{}", "bad")).rejects.toThrow(
      "signature",
    );
  });
  it("tracks partial pending/successful/failed refunds with compensating immutable entries", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID());
    f.test.paid();
    await f.service.sync(a.id, owner);
    const request = refund(1000),
      id = await f.service.refund(a.id, owner, request);
    await f.service.refund(a.id, owner, request);
    expect(f.test.calls.refund).toBe(1);
    expect((await balance(f, "test")).refundedCents).toBe(0);
    const r = [...f.test.sessions.values()][0].refunds[0];
    r.status = "succeeded";
    await f.service.sync(a.id, owner);
    expect((await balance(f, "test")).refundedCents).toBe(1000);
    await f.service.sync(a.id, owner);
    expect((await balance(f, "test")).refundedCents).toBe(1000);
    r.status = "failed";
    await f.service.sync(a.id, owner);
    expect((await balance(f, "test")).refundedCents).toBe(0);
    expect(
      (
        await f.db
          .prepare(
            "SELECT kind,cents FROM payment_allocations WHERE refund_id=?1 ORDER BY created_at,id",
          )
          .bind(id)
          .all()
      ).results,
    ).toEqual(
      expect.arrayContaining([
        { kind: "refund", cents: -1000 },
        { kind: "refund-reversal", cents: 1000 },
      ]),
    );
    expect(
      (await f.db.prepare("SELECT * FROM booking_financial_followups").all())
        .results,
    ).toHaveLength(1);
  });
  it("reserves pending refunds, prevents duplicate/over refunds and reconciles a lost refund response", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID());
    f.test.paid();
    await f.service.sync(a.id, owner);
    f.test.loseRefundResponse = true;
    const input = refund(2000);
    await expect(f.service.refund(a.id, owner, input)).rejects.toThrow(
      "unconfirmed",
    );
    f.test.loseRefundResponse = false;
    await f.service.refund(a.id, owner, input);
    expect(f.test.calls.refund).toBe(1);
    await expect(f.service.refund(a.id, owner, refund(1001))).rejects.toThrow(
      "exceed",
    );
    await expect(
      f.service.refund(a.id, owner, { ...input, amountCents: 1500 }),
    ).rejects.toThrow("another refund");
    expect([...f.test.sessions.values()][0].refunds).toHaveLength(1);
  });
  it("retries the same refund after refresh, and refuses aged ambiguous refund retries", async () => {
    const f = fixture(),
      a = await f.service.checkout("booking-a", alice, crypto.randomUUID());
    f.test.paid();
    await f.service.sync(a.id, owner);
    f.test.failBeforeRefund = true;
    await expect(f.service.refund(a.id, owner, refund())).rejects.toThrow();
    const row = (await f.db
      .prepare("SELECT id FROM payment_refunds")
      .first<{ id: string }>())!;
    f.test.failBeforeRefund = false;
    await f.service.retryRefund(row.id, owner);
    expect([...f.test.sessions.values()][0].refunds).toHaveLength(1);
    f.test.failBeforeRefund = true;
    await expect(f.service.refund(a.id, owner, refund())).rejects.toThrow();
    await f.db
      .prepare(
        "UPDATE payment_refunds SET created_at=0 WHERE status='creating'",
      )
      .run();
    const old = (await f.db
      .prepare("SELECT id FROM payment_refunds WHERE status='creating'")
      .first<{ id: string }>())!;
    const calls = f.test.calls.refund;
    await f.service.retryRefund(old.id, owner);
    expect(f.test.calls.refund).toBe(calls);
    expect(
      await f.db
        .prepare("SELECT status FROM payment_refunds WHERE id=?1")
        .bind(old.id)
        .first(),
    ).toEqual({ status: "review" });
  });
});
