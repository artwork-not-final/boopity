import { afterEach, describe, expect, it, vi } from "vitest";
import { largeListFixture, key } from "./large-list-fixture";
import {
  listQuery,
  pageOffset,
  searchPattern,
  PAGE_SIZE,
} from "../src/shared/pagination";

const fixtures: ReturnType<typeof largeListFixture>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
async function fixture() {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("No real providers in pagination tests"),
  );
  const f = largeListFixture();
  fixtures.push(f);
  await f.login("owner");
  await f.login("alice");
  await f.login("bob");
  return f;
}
async function get(
  f: Awaited<ReturnType<typeof fixture>>,
  role: string,
  path: string,
  status = 200,
) {
  const response = await f.request(role, "/api/business" + path),
    body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}
describe("bounded self-hosted lists", () => {
  it("validates offsets/search and treats wildcard characters literally", () => {
    for (const value of [-1, 1.5, "Infinity", "bad", 2_147_483_648])
      expect(pageOffset.safeParse(value).success).toBe(false);
    expect(listQuery.safeParse({ search: "a".repeat(101) }).success).toBe(
      false,
    );
    expect(searchPattern("%_\\")).toBe("%\\%\\_\\\\%");
  });
  it("reaches every client beyond the preview cap, with stable ties and no nested portfolio/private data", async () => {
    const f = await fixture(),
      ids: string[] = [];
    for (let offset = 0; offset < f.size.clients; offset += PAGE_SIZE) {
      const body = await get(f, "owner", `/owner/clients?offset=${offset}`);
      expect(body.clients.length).toBeLessThanOrEqual(PAGE_SIZE);
      expect(body.pagination.hasMore).toBe(offset + PAGE_SIZE < f.size.clients);
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE|medical|pets":/);
      ids.push(...body.clients.map((c: { id: string }) => c.id));
    }
    expect(new Set(ids).size).toBe(f.size.clients);
    const match = await get(
      f,
      "owner",
      "/owner/clients?search=alice%40example.test",
    );
    expect(match.clients.map((c: { id: string }) => c.id)).toEqual([
      key("client", 0),
    ]);
    expect(match.clients[0].petCount).toBe(f.size.pets + 1);
    const detail = await get(f, "owner", `/owner/clients/${key("client", 0)}`);
    expect(detail.client.email).toBe("alice@example.test");
    expect(detail.client.notes).toBe("PRIVATE CLIENT NOTE");
    expect(detail.client.pets).toBeUndefined();
    expect(
      (await get(f, "owner", "/owner/clients?offset=1000000")).clients,
    ).toEqual([]);
    await get(f, "owner", "/owner/clients?offset=-1", 400);
    const original = f.runtime.db.connection
      .prepare("SELECT first_name FROM clients WHERE id=?")
      .get(key("client", 0));
    f.runtime.db.connection
      .prepare("UPDATE clients SET first_name='Literal %_\\' WHERE id=?")
      .run(key("client", 0));
    expect(
      (await get(f, "owner", "/owner/clients?search=%25_%5C")).clients,
    ).toHaveLength(1);
    expect(original).toBeTruthy();
  });
  it("paginates pets/services without leaking another household or private service data", async () => {
    const f = await fixture();
    await get(f, "alice", "/owner/clients?offset=500", 403);
    await get(f, "alice", `/pets?clientId=${key("client", 1)}&offset=50`, 403);
    const pets = await get(f, "alice", "/pets?offset=100");
    expect(pets.pets).toHaveLength(21);
    expect(
      pets.pets.every(
        (p: { clientId: string }) => p.clientId === key("client", 0),
      ),
    ).toBe(true);
    expect(JSON.stringify(pets)).not.toContain("PRIVATE");
    expect((await get(f, "bob", "/pets?offset=50")).pets).toEqual([]);
    expect(
      (await get(f, "owner", "/services?offset=500")).services,
    ).toHaveLength(50);
    const visible = await get(f, "alice", "/services?offset=500");
    expect(visible.services.length).toBeGreaterThan(0);
    expect(
      visible.services.every(
        (s: { portalVisible: number }) => s.portalVisible === 1,
      ),
    ).toBe(true);
    expect(JSON.stringify(visible)).not.toContain("PRIVATE");
    expect(
      (await get(f, "alice", "/services?search=Service%20000000")).services,
    ).toEqual([]);
  });
  it("paginates follow-ups, filters resolved records and preserves owner-only access", async () => {
    const f = await fixture();
    const page = await get(
      f,
      "owner",
      "/owner/financial-followups?offset=500&status=open",
    );
    expect(page.followups).toEqual([]);
    const open = await get(
      f,
      "owner",
      "/owner/financial-followups?status=open",
    );
    expect(
      open.followups.every(
        (r: { resolvedAt: unknown }) => r.resolvedAt === null,
      ),
    ).toBe(true);
    expect(
      (await get(f, "owner", "/owner/financial-followups?offset=500"))
        .followups,
    ).toHaveLength(50);
    expect(
      (await get(f, "owner", "/owner/access?offset=500")).clients,
    ).toHaveLength(50);
    await get(f, "alice", "/owner/financial-followups?offset=500", 403);
  });
  it("pages/searches bookings and histories with household scoping and constant per-page pet query count", async () => {
    const f = await fixture(),
      spy = vi.spyOn(f.runtime.db, "prepare");
    const page = await get(f, "owner", "/bookings?offset=500");
    expect(page.bookings).toHaveLength(50);
    expect(
      page.bookings.every((b: { pets: unknown[] }) => b.pets.length === 1),
    ).toBe(true);
    expect(
      spy.mock.calls.filter(([sql]) =>
        sql.includes("SELECT bp.booking_id AS bookingId"),
      ).length,
    ).toBe(1);
    const client = await get(f, "alice", "/bookings?offset=100");
    expect(
      client.bookings.every(
        (b: { clientId: string }) => b.clientId === key("client", 0),
      ),
    ).toBe(true);
    expect(JSON.stringify(client)).not.toContain("PRIVATE");
    expect(
      (await get(f, "alice", "/bookings?search=Companion%20000001")).bookings,
    ).toEqual([]);
    const filtered = await get(
      f,
      "owner",
      "/bookings?status=cancelled&search=Visit%20000000",
    );
    expect(filtered.bookings.map((b: { id: string }) => b.id)).toEqual([
      key("booking", 0),
    ]);
    const history = await get(
      f,
      "alice",
      `/bookings/${key("booking", 0)}?offset=600`,
    );
    expect(history.history).toHaveLength(20);
    expect(history.pagination.hasMore).toBe(false);
    await get(f, "bob", `/bookings/${key("booking", 0)}?offset=600`, 404);
  });
  it("paginates payment/refund history while balances and refund counts use the complete ledger", async () => {
    const f = await fixture();
    const first = await get(
      f,
      "owner",
      `/payments/bookings/${key("booking", 0)}`,
    );
    expect(first.attempts).toHaveLength(50);
    expect(first.history).toHaveLength(50);
    expect(first.attempts[0].refundCount).toBe(75);
    expect(first.attempts[0].refunds).toHaveLength(50);
    expect(first.attempts[0].refundPagination.hasMore).toBe(true);
    const last = await get(
      f,
      "alice",
      `/payments/bookings/${key("booking", 0)}?attemptOffset=600&historyOffset=600`,
    );
    expect(last.attempts).toHaveLength(20);
    expect(last.history).toHaveLength(20);
    expect(last.balances).toEqual(first.balances);
    expect(
      last.balances.find((b: { mode: string }) => b.mode === "live")
        .receivedCents,
    ).toBe(f.size.payments);
    expect(JSON.stringify(last)).not.toMatch(
      /PRIVATE|ciphertext|request_payload|provider_ref/,
    );
    const refunds = await get(
      f,
      "alice",
      `/payments/attempts/${key("attempt", f.size.payments - 1)}/refunds?offset=50`,
    );
    expect(refunds.refunds).toHaveLength(25);
    expect(JSON.stringify(refunds)).not.toContain("PRIVATE");
    await get(
      f,
      "bob",
      `/payments/attempts/${key("attempt", f.size.payments - 1)}/refunds?offset=50`,
      404,
    );
    await get(
      f,
      "owner",
      `/payments/bookings/${key("booking", 0)}?attemptOffset=-1`,
      400,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
