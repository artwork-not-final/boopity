import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paymentRecords } from "../../server/payments/records";
import { paymentRecordsQuery } from "../../src/shared/payment-records";
import {
  alice,
  manual,
  owner,
  paymentFixture,
} from "../support/payment-fixture";

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
const refund = (amountCents: number) => ({
  requestId: crypto.randomUUID(),
  amountCents,
  note: "PRIVATE refund note",
  confirm: true,
});

describe("business payment activity", () => {
  it("defaults to actual money, separates historical currencies, and omits sensitive fields", async () => {
    const f = fixture();
    await f.service.manual("booking-a", owner, manual(1000));
    await f.service.manual("booking-b", owner, {
      ...manual(2000),
      method: "bank-transfer",
    });
    const checkout = await f.service.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    f.test.paid();
    await f.service.sync(checkout.id, owner);
    const actual = await paymentRecords(f.db, owner);
    expect(actual.records).toHaveLength(2);
    expect(
      actual.records.find((r) => r.clientName === "Alice Able"),
    ).toMatchObject({
      kind: "receipt",
      status: "received",
      method: "cash",
      amountCents: 1000,
      bookingId: "booking-a",
      serviceName: "Dog visit",
    });
    expect(actual.totals).toEqual([
      {
        currency: "EUR",
        receivedCents: 2000,
        refundedCents: 0,
        netCents: 2000,
      },
      {
        currency: "USD",
        receivedCents: 1000,
        refundedCents: 0,
        netCents: 1000,
      },
    ]);
    const sandbox = await paymentRecords(f.db, owner, { mode: "test" });
    expect(sandbox.records).toHaveLength(1);
    expect(sandbox.totals[0]).toMatchObject({ receivedCents: 3000 });
    expect(JSON.stringify(actual)).not.toMatch(
      /PRIVATE|request_key|provider_ref|payment_ref|checkout_url|ciphertext|@example/,
    );
  });
  it("reports refunds and corrections on their own recorded dates, excluding credits", async () => {
    const f = fixture(),
      clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(Date.parse("2026-08-31T16:00:00Z"));
    const receipt = await f.service.manual("booking-a", owner, manual(1000));
    const voided = await f.service.manual("booking-a", owner, manual(500));
    clock.mockReturnValue(Date.parse("2026-09-01T16:00:00Z"));
    await f.service.refund(receipt, owner, refund(400));
    await f.service.voidManual(voided, owner, "PRIVATE incorrect record");
    await f.service.credit("booking-a", owner, {
      requestId: crypto.randomUUID(),
      amountCents: 200,
      mode: "live",
      note: "PRIVATE charge credit",
    });
    const september = await paymentRecords(f.db, owner, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(september.records.map((r) => r.kind).sort()).toEqual([
      "refund",
      "void",
    ]);
    expect(september.totals).toEqual([
      {
        currency: "USD",
        receivedCents: -500,
        refundedCents: 400,
        netCents: -900,
      },
    ]);
    const august = await paymentRecords(f.db, owner, { to: "2026-08-31" });
    expect(august.totals[0]).toMatchObject({
      receivedCents: 1500,
      refundedCents: 0,
      netCents: 1500,
    });
    const all = await paymentRecords(f.db, owner);
    expect(all.records).toHaveLength(4);
    expect(all.totals[0]).toMatchObject({
      receivedCents: 1000,
      refundedCents: 400,
      netCents: 600,
    });
    expect(
      (await paymentRecords(f.db, owner, { status: "corrected" })).records[0]
        .kind,
    ).toBe("void");
    expect(
      (await paymentRecords(f.db, owner, { status: "refunded" })).totals[0]
        .netCents,
    ).toBe(-400);
  });
  it("does not count open, failed, expired, review or pending refund requests as money", async () => {
    const f = fixture();
    const checkout = await f.service.checkout(
      "booking-a",
      alice,
      crypto.randomUUID(),
    );
    for (const status of [
      "open",
      "processing",
      "failed",
      "expired",
      "review",
    ]) {
      await f.db
        .prepare("UPDATE payment_attempts SET status=?1 WHERE id=?2")
        .bind(status, checkout.id)
        .run();
      const page = await paymentRecords(f.db, owner, { mode: "test" });
      expect(page.records).toHaveLength(1);
      expect(page.records[0].status).toBe(
        ["open", "processing"].includes(status) ? "pending" : status,
      );
      expect(page.totals).toEqual([]);
    }
    await f.db
      .prepare("UPDATE payment_attempts SET status='open' WHERE id=?1")
      .bind(checkout.id)
      .run();
    f.test.paid();
    await f.service.sync(checkout.id, owner);
    await f.service.refund(checkout.id, owner, refund(600));
    expect(
      (await paymentRecords(f.db, owner, { mode: "test" })).totals[0],
    ).toMatchObject({ receivedCents: 3000, refundedCents: 0 });
    const state = [...f.test.sessions.values()][0];
    state.refunds[0].status = "succeeded";
    await f.service.sync(checkout.id, owner);
    expect(
      (await paymentRecords(f.db, owner, { mode: "test" })).totals[0]
        .refundedCents,
    ).toBe(600);
    state.refunds[0].status = "failed";
    await f.service.sync(checkout.id, owner);
    const reversed = await paymentRecords(f.db, owner, { mode: "test" });
    expect(
      reversed.records.some(
        (r) => r.kind === "refund-reversal" && r.amountCents === 600,
      ),
    ).toBe(true);
    expect(reversed.totals[0]).toMatchObject({
      refundedCents: 0,
      netCents: 3000,
    });
  });
  it("uses the business date, including the full 23-hour DST day and an inclusive end date", async () => {
    const f = fixture(),
      clock = vi.spyOn(Date, "now");
    for (const timestamp of [
      "2026-03-08T04:59:59Z",
      "2026-03-08T05:00:00Z",
      "2026-03-09T03:59:59Z",
      "2026-03-09T04:00:00Z",
    ]) {
      clock.mockReturnValue(Date.parse(timestamp));
      await f.service.manual("booking-a", owner, manual(100));
    }
    const day = await paymentRecords(f.db, owner, {
      from: "2026-03-08",
      to: "2026-03-08",
    });
    expect(day.records).toHaveLength(2);
    expect(day.timeZone).toBe("America/New_York");
    expect(day.totals[0].receivedCents).toBe(200);
  });
  it("searches client names, email and saved service names literally, including archived clients", async () => {
    const f = fixture();
    await f.service.manual("booking-a", owner, manual());
    await f.service.manual("booking-b", owner, {
      ...manual(),
      method: "zelle",
    });
    await f.db
      .prepare("UPDATE clients SET status='archived' WHERE id='a'")
      .run();
    for (const search of ["ALICE ABLE", "alice@example", "dog visit"]) {
      const page = await paymentRecords(f.db, owner, { search });
      expect(page.records).toHaveLength(1);
      expect(page.records[0].bookingId).toBe("booking-a");
      expect(page.totals[0].receivedCents).toBe(1000);
    }
    for (const search of ["%", "_", "' OR 1=1 --"])
      expect((await paymentRecords(f.db, owner, { search })).records).toEqual(
        [],
      );
    expect(
      (await paymentRecords(f.db, owner, { method: "zelle" })).records[0]
        .clientName,
    ).toBe("Bob Baker");
    expect(
      (await paymentRecords(f.db, owner, { method: "online" })).records,
    ).toEqual([]);
  });
  it("paginates tied timestamps without duplication and calculates totals over every matching page", async () => {
    const f = fixture();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-14T14:00:00Z"));
    for (let i = 0; i < 23; i++)
      await f.service.manual("booking-a", owner, manual(10));
    const ids: string[] = [];
    for (const offset of [0, 10, 20]) {
      const page = await paymentRecords(f.db, owner, { offset });
      expect(page.pagination).toEqual({
        offset,
        limit: 10,
        hasMore: offset < 20,
      });
      expect(page.totals[0].receivedCents).toBe(230);
      ids.push(...page.records.map((r) => r.id));
    }
    expect(new Set(ids).size).toBe(23);
    const end = await paymentRecords(f.db, owner, { offset: 30 });
    expect(end.records).toEqual([]);
    expect(end.totals[0].receivedCents).toBe(230);
  });
  it("is read-only, does not contact providers, and validates owner membership and business scope", async () => {
    const f = fixture();
    await f.service.manual("booking-a", owner, manual());
    const before = f.db.connection.prepare("SELECT total_changes() AS n").get();
    const get = vi.spyOn(f.integrations, "get");
    await paymentRecords(f.db, owner);
    expect(get).not.toHaveBeenCalled();
    expect(
      f.db.connection.prepare("SELECT total_changes() AS n").get(),
    ).toEqual(before);
    await expect(paymentRecords(f.db, alice)).rejects.toThrow(
      "Owner access required",
    );
    await expect(
      paymentRecords(f.db, { ...owner, sitterId: "other" }),
    ).rejects.toThrow("access changed");
    await f.db
      .prepare(
        "UPDATE business_memberships SET revoked_at=1 WHERE user_id='owner'",
      )
      .run();
    await expect(paymentRecords(f.db, owner)).rejects.toThrow("access changed");
  });
  it("protects the new endpoint against anonymous/client access and invalid filters", async () => {
    const f = fixture(),
      a = f.browser(),
      o = f.browser();
    const path = "/api/business/payments/records";
    expect((await f.browser().req(path)).status).toBe(401);
    await a.login("alice@example.test");
    expect((await a.req(path)).status).toBe(403);
    await o.login("owner@example.test");
    expect((await o.req(path)).status).toBe(200);
    for (const query of [
      "mode=bad",
      "method=wire",
      "status=bad",
      "offset=-1",
      "from=2026-02-30",
      "from=2026-09-02&to=2026-09-01",
      `search=${"a".repeat(101)}`,
    ])
      expect((await o.req(`${path}?${query}`)).status).toBe(400);
  });
  it("validates dates and bounded query inputs", () => {
    expect(paymentRecordsQuery.parse({})).toMatchObject({
      offset: 0,
      mode: "live",
      method: "all",
      status: "all",
      search: "",
    });
    for (const query of [
      { from: "1969-01-01" },
      { to: "9999-01-01" },
      { offset: 0.5 },
      { from: "" },
    ])
      expect(paymentRecordsQuery.safeParse(query).success).toBe(false);
  });
});
