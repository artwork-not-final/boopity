// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookingPayments } from "../src/client/payments/BookingPayments";
import { PaymentAttempt } from "../src/client/payments/PaymentAttempt";
import { PaymentSettings } from "../src/client/payments/PaymentSettings";
import { PaymentRecords } from "../src/client/payments/PaymentRecords";
import type { PaymentView, IntegrationView } from "../src/shared/payments";
import type { PaymentRecordsView } from "../src/shared/payment-records";
import { SEARCH_DELAY_MS } from "../src/client/live-search";
import { Workspace, type Booking } from "../src/client/Workspace";
import { navigateLocal } from "../src/client/workspace-location";

const page = { offset: 0, limit: 50, hasMore: false };
function view(): PaymentView {
  return {
    bookingId: "visit-a",
    bookingStatus: "confirmed",
    activeMode: "test",
    onlineAvailable: true,
    balances: (["live", "test"] as const).map((mode) => ({
      mode,
      currency: "USD",
      chargeCents: 3000,
      creditCents: 0,
      receivedCents: 1000,
      refundedCents: 0,
      netCents: 1000,
      outstandingCents: 2000,
      overpaymentCents: 0,
      status: "partial",
    })),
    pagination: { attempts: { ...page }, history: { ...page } },
    attempts: [
      {
        id: "receipt-a",
        provider: "manual",
        mode: "live",
        amountCents: 1000,
        currency: "USD",
        status: "succeeded",
        method: "cash",
        createdAt: 1,
        note: "PRIVATE payment note",
        refunds: [],
        refundCount: 0,
        refundPagination: { ...page },
      },
    ],
    history: [
      {
        id: "credit-a",
        kind: "credit",
        cents: 100,
        mode: "live",
        createdAt: 1,
        reversible: true,
        note: "PRIVATE credit reason",
      },
    ],
  };
}
function integration(): IntegrationView {
  return {
    id: "stripe-test",
    provider: "stripe",
    mode: "test",
    version: 4,
    enabled: false,
    managed: false,
    keyPresent: true,
    webhookSecretPresent: true,
    verified: true,
    webhookVerified: true,
    accountId: "synthetic-account",
    webhookUrl: "https://example.test/webhook",
    apiVersion: "test-version",
    capabilities: { checkout: true, refunds: true, expire: true },
  };
}
function records(): PaymentRecordsView {
  return {
    records: [
      {
        id: "entry-a",
        bookingId: "visit-a",
        clientName: "Alice Example",
        serviceName: "Dog visit",
        startDate: "2026-09-16",
        endDate: "2026-09-16",
        kind: "receipt",
        status: "received",
        method: "cash",
        provider: "manual",
        amountCents: 1000,
        currency: "USD",
        createdAt: 1,
      },
    ],
    totals: [
      {
        currency: "USD",
        receivedCents: 1000,
        refundedCents: 0,
        netCents: 1000,
      },
    ],
    pagination: { ...page, hasMore: true },
    timeZone: "America/New_York",
  };
}
type Request = {
  url: URL;
  method: string;
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
};
let container: HTMLDivElement, root: Root;
let requests: Request[], errors: unknown[];
let data: PaymentView, currentIntegration: IntegrationView;
let respond: (request: Request) => Response | Promise<Response> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/app/bookings/visit-a/payments");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  errors = [];
  data = view();
  currentIntegration = integration();
  respond = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const request = {
        url: new URL(path, window.location.origin),
        method: init?.method ?? "GET",
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {},
        signal: init?.signal,
      };
      requests.push(request);
      const response = respond(request);
      if (response) return response;
      if (request.method !== "GET")
        throw new Error(`Unexpected mutation: ${path}`);
      if (request.url.pathname === "/api/business/payments/bookings/visit-a")
        return Response.json(data);
      if (request.url.pathname === "/api/business/payments/integrations")
        return Response.json({
          settings: { mode: "test", version: 2 },
          integrations: [currentIntegration],
        });
      if (request.url.pathname === "/api/business/payments/records")
        return Response.json(records());
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function run(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    errors.push(error);
  }
}
const onError = async (error: unknown) => {
  errors.push(error);
};
async function mount(element: ReactElement) {
  await act(async () => root.render(element));
}
async function booking(owner = true) {
  await mount(
    createElement(BookingPayments, {
      bookingId: "visit-a",
      owner,
      busy: false,
      run,
      onError,
      timeZone: "UTC",
    }),
  );
}
async function settings() {
  await mount(createElement(PaymentSettings, { busy: false, run, onError }));
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
function control(label: string) {
  const found = [...container.querySelectorAll("label")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return (
    found!.htmlFor
      ? document.getElementById(found!.htmlFor)
      : found!.querySelector("input")
  )!;
}
function field(label: string) {
  return control(label) as HTMLInputElement | HTMLTextAreaElement;
}
async function enter(label: string, value: string) {
  await act(async () => {
    const element = field(label);
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function check(label: string) {
  await act(async () => (control(label) as HTMLInputElement).click());
}
async function submit(label: string) {
  await act(async () => control(label).closest("form")!.requestSubmit());
}
async function choose(label: string, value: string) {
  // Choice's native change/autofill handler; popup keyboard behavior is separate.
  await act(async () => {
    const select = control(label).parentElement!.querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function mutations() {
  return requests.filter(({ method }) => method !== "GET");
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps payment and credit drafts separate and retains a manual-payment key after an uncertain response", async () => {
  await booking();
  await enter("Received amount (USD)", "12.34");
  await enter("Private accounting note", "Received elsewhere");
  await choose("Manual payment method", "bank-transfer");
  await click("Adjust charge");
  await enter("Amount to credit", "2.00");
  await enter("Private reason for credit", "Courtesy discount");
  await choose("Credit ledger", "test");
  await click("Record payment");
  expect(field("Received amount (USD)").value).toBe("12.34");
  respond = ({ method }) =>
    method === "POST"
      ? Response.json({ error: "Response uncertain" }, { status: 503 })
      : undefined;
  await submit("Received amount (USD)");
  const first = mutations()[0].body;
  expect(first).toMatchObject({
    amountCents: 1234,
    method: "bank-transfer",
    note: "Received elsewhere",
  });
  expect(field("Received amount (USD)").value).toBe("12.34");
  respond = ({ method }) =>
    method === "POST" ? Response.json({ ok: true }) : undefined;
  await submit("Received amount (USD)");
  expect(mutations()[1].body).toEqual(first);
  expect(field("Received amount (USD)").value).toBe("");
  await enter("Received amount (USD)", "12.34");
  await submit("Received amount (USD)");
  expect(mutations()[2].body.requestId).not.toBe(first.requestId);
  await click("Adjust charge");
  expect(field("Amount to credit").value).toBe("2.00");
  await submit("Amount to credit");
  expect(mutations()[3].body).toMatchObject({
    amountCents: 200,
    mode: "test",
    note: "Courtesy discount",
  });
  expect(mutations()[3].url.pathname).toMatch(/\/credit$/);
});

it("requires a reason to correct a credit and sends no refund or payment command", async () => {
  await booking();
  await click("Correct this booking credit");
  expect(button("Reverse credit and restore charge").disabled).toBe(true);
  await enter("Private reason for reversing this credit", "Wrong booking");
  respond = ({ method }) =>
    method === "POST" ? Response.json({ ok: true }) : undefined;
  await click("Reverse credit and restore charge");
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0]).toMatchObject({
    body: { note: "Wrong booking", confirm: true },
  });
  expect(mutations()[0].url.pathname).toBe(
    "/api/business/payments/credits/credit-a/reverse",
  );
});

it.each([
  "http://checkout.stripe.com/session",
  "https://checkout.stripe.com.evil.test/session",
  "https://u:p@checkout.stripe.com/session",
])(
  "rejects unsafe checkout destination %s while retaining its retry key",
  async (url) => {
    await booking(false);
    respond = ({ method }) =>
      method === "POST" ? Response.json({ url, status: "open" }) : undefined;
    await click("Open sandbox checkout");
    await click("Open sandbox checkout");
    expect(errors.map(String)).toEqual([
      "Error: Unexpected checkout address.",
      "Error: Unexpected checkout address.",
    ]);
    expect(mutations()[1].body.requestId).toBe(mutations()[0].body.requestId);
    expect(window.location.pathname).toBe("/app/bookings/visit-a/payments");
  },
);

it.each(["test", "live"] as const)(
  "requires explicit %s refund consent and retains the draft/key on failure",
  async (mode) => {
    const attempt = {
      ...data.attempts[0],
      provider: "stripe",
      method: "online",
      mode,
    };
    await mount(
      createElement(PaymentAttempt, { attempt, owner: true, busy: false, run }),
    );
    expect(mutations()).toHaveLength(0);
    await click("Refund payment");
    await enter("Refund amount", "3.00");
    await enter("Private refund / correction reason", "Partial return");
    expect(button("Confirm refund").disabled).toBe(true);
    await check(
      mode === "test"
        ? "I confirm this sandbox refund."
        : "I authorize this real refund to the original payment method.",
    );
    respond = () => Response.json({ error: "Try again" }, { status: 503 });
    await click("Confirm refund");
    expect(field("Refund amount").value).toBe("3.00");
    respond = () => Response.json({ ok: true });
    await click("Confirm refund");
    expect(mutations()[1].body).toEqual(mutations()[0].body);
    expect(mutations()[1].body).toMatchObject({
      amountCents: 300,
      note: "Partial return",
      confirm: true,
    });
    expect(field("Refund amount").value).toBe("");
    expect(button("Confirm refund").disabled).toBe(true);
    expect(container.textContent).not.toContain("Void incorrect record");
  },
);

it("keeps an existing refund draft mounted and disabled while accounting history changes page", async () => {
  data.pagination.history.hasMore = true;
  await booking();
  await click("Refund or correct record");
  await enter("Refund amount", "4.00");
  await enter("Private refund / correction reason", "Returned cash");
  await check("I already returned this money outside Boopity.");
  const amount = field("Refund amount"),
    pending = deferred();
  respond = ({ url }) =>
    url.searchParams.get("historyOffset") === "10"
      ? pending.promise
      : undefined;
  await click("Next accounting history page");
  expect(field("Refund amount")).toBe(amount);
  expect(button("Record returned refund").disabled).toBe(true);
  await act(async () => pending.resolve(Response.json(data)));
  expect(field("Refund amount")).toBe(amount);
  expect(amount.value).toBe("4.00");
  expect(button("Record returned refund").disabled).toBe(false);
  expect(requests.at(-1)!.url.searchParams.get("attemptOffset")).toBe("0");
  expect(mutations()).toHaveLength(0);
});

it("keeps refund-page retries read-only and retries only the explicitly selected uncertain refund", async () => {
  const attempt = {
    ...data.attempts[0],
    refundCount: 51,
    refundPagination: { ...page, hasMore: true },
    refunds: [
      {
        id: "refund-a",
        amountCents: 100,
        status: "creating",
        note: "PRIVATE refund note",
      },
    ],
  };
  await mount(
    createElement(PaymentAttempt, { attempt, owner: true, busy: false, run }),
  );
  respond = () => Response.json({ error: "Page unavailable" }, { status: 503 });
  await click("Next refunds page");
  expect(requests[0].url.searchParams.get("offset")).toBe("50");
  respond = () =>
    Response.json({ refunds: [], pagination: { ...page, offset: 50 } });
  await click("Retry list");
  expect(mutations()).toHaveLength(0);
  await click("Previous refunds page");
  respond = () => Response.json({ ok: true });
  await click("Retry same refund");
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.pathname).toBe(
    "/api/business/payments/refunds/refund-a/retry",
  );
  expect(mutations()[0].body).toEqual({ confirm: true });
});

it("hides private accounting notes and sitter-only commands from clients", async () => {
  data.history[0].reversible = false; // Mirrors the server's client-scoped view.
  await booking(false);
  expect(container.textContent).not.toMatch(
    /PRIVATE|Record money|Adjust charge|Refund or correct|Correct this booking credit/,
  );
  expect(container.querySelector("form")).toBeNull();
  expect(mutations()).toHaveLength(0);
});

it("requires consent to enable live mode and sends the current mode version", async () => {
  await settings();
  expect(button("Use live mode").disabled).toBe(true);
  expect(button("Use sandbox mode").disabled).toBe(true);
  await check("I understand live mode lets clients make real payments.");
  respond = ({ method }) =>
    method === "PUT" ? Response.json({ ok: true }) : undefined;
  await click("Use live mode");
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0].url.pathname).toBe("/api/business/payments/mode");
  expect(mutations()[0].body).toEqual({
    mode: "live",
    version: 2,
    confirmLive: true,
  });
});

it("keeps account verification separate from signed-webhook readiness and checkout enablement", async () => {
  currentIntegration.webhookVerified = false;
  await settings();
  expect(button("Enable checkout").disabled).toBe(true);
  respond = ({ method }) =>
    method === "POST" ? Response.json({ ok: true }) : undefined;
  await click("Verify account (read-only)");
  expect(button("Enable checkout").disabled).toBe(true);
  expect(mutations()[0].url.pathname).toBe(
    "/api/business/payments/integrations/stripe/test/verify",
  );
  currentIntegration.webhookVerified = true;
  await click("Refresh payment setup");
  respond = ({ method }) =>
    method === "PUT" ? Response.json({ ok: true }) : undefined;
  await click("Enable checkout");
  expect(mutations()[1].url.pathname).toBe(
    "/api/business/payments/integrations/stripe/test/enabled",
  );
  expect(mutations()[1].body).toEqual({ enabled: true, version: 4 });
});

it("leaves host-managed secrets read-only and initializes without exposing their values", async () => {
  currentIntegration.managed = true;
  await settings();
  expect(
    (control("Stripe test restricted API key") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(
    (control("Stripe test webhook signing secret") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  respond = ({ method }) =>
    method === "PUT" ? Response.json({ ok: true }) : undefined;
  await click("Initialize host-managed integration");
  expect(mutations()[0].body).toEqual({
    version: 4,
    key: "",
    webhookSecret: "",
  });
});

it("resets payment activity pagination on filtering, live search and sandbox changes", async () => {
  vi.useFakeTimers();
  await mount(
    createElement(PaymentRecords, {
      revision: 0,
      timeZone: "UTC",
      currency: "USD",
    }),
  );
  await click("Next payments page");
  expect(requests.at(-1)!.url.searchParams.get("offset")).toBe("50");
  await enter("Search by client or service", "Alice");
  await act(async () => vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 1));
  expect(requests.at(-1)!.url.searchParams.get("search")).toBe("Alice");
  expect(requests.at(-1)!.url.searchParams.get("offset")).toBe("0");
  await choose("Method", "cash-app");
  await choose("Status", "refunded");
  await click("Sandbox");
  const query = requests.at(-1)!.url.searchParams;
  expect(Object.fromEntries(query)).toMatchObject({
    mode: "test",
    method: "cash-app",
    status: "refunded",
    search: "Alice",
    offset: "0",
  });
  expect(container.textContent).toContain(
    "Sandbox totals for matching activity",
  );
  await click("Clear filters");
  expect(field("Search by client or service").value).toBe("");
  expect(Object.fromEntries(requests.at(-1)!.url.searchParams)).toMatchObject({
    mode: "test",
    method: "all",
    status: "all",
    search: "",
    offset: "0",
  });
  expect(mutations()).toHaveLength(0);
});

it("blocks reversed date ranges and links directly to booking payments and payment settings", async () => {
  await mount(
    createElement(PaymentRecords, {
      revision: 0,
      timeZone: "UTC",
      currency: "USD",
    }),
  );
  await enter("From", "2026-09-16");
  const count = requests.length;
  await enter("To", "2026-09-15");
  expect(container.textContent).toContain(
    "Choose an end date on or after the start date.",
  );
  expect(requests).toHaveLength(count);
  expect(control("To").getAttribute("aria-invalid")).toBe("true");
  await enter("To", "2026-09-17");
  const link = container.querySelector<HTMLAnchorElement>(
    '[aria-label="Payment results"] a',
  )!;
  expect(link.getAttribute("href")).toBe("/app/bookings/visit-a/payments");
  window.history.replaceState(null, "", "/app/payments");
  await act(async () => link.click());
  expect(window.location.pathname).toBe("/app/bookings/visit-a/payments");
  await click("Payment settings");
  expect(window.location.pathname).toBe("/app/settings/payments");
  expect(mutations()).toHaveLength(0);
});

it("retains payment drafts across booking tabs in the workspace, but not across different bookings", async () => {
  const saved: Booking = {
    id: "visit-a",
    clientId: "alice",
    clientName: "Alice Example",
    serviceName: "Dog visit",
    status: "confirmed",
    startDate: "2026-09-16",
    endDate: "2026-09-16",
    startTime: null,
    endTime: null,
    startAt: Date.UTC(2026, 8, 16),
    endAt: Date.UTC(2026, 8, 17),
    totalAmountCents: 3000,
    requestExpiresAt: null,
    version: 1,
    canCancel: false,
    clientRequest: "",
    clientUpdate: "",
    pets: [],
    policy: null,
    price: null,
  };
  respond = ({ url }) => {
    if (url.pathname === "/api/business/policy")
      return Response.json({
        policy: {
          version: 1,
          portalEnabled: true,
          approvalMode: "request",
          leadHours: 24,
          horizonDays: 90,
          cancelHours: 24,
          requestHoldHours: 24,
          weekly: [],
          blockedDates: [],
        },
        regional: { timeZone: "UTC", currency: "USD" },
      });
    if (
      /\/bookings\/visit-[ab]$/.test(url.pathname) &&
      !url.pathname.includes("/payments/")
    )
      return Response.json({
        booking: { ...saved, id: url.pathname.split("/").at(-1) },
        history: [],
        pagination: page,
      });
    if (url.pathname === "/api/business/payments/bookings/visit-b")
      return Response.json({ ...data, bookingId: "visit-b" });
    return undefined;
  };
  await mount(
    createElement(Workspace, {
      session: {
        role: "owner",
        user: { name: "Test sitter", email: "owner@example.test" },
      },
      openSettings: () => {},
      recheckAccess: async () => {},
    }),
  );
  await enter("Received amount (USD)", "8.00");
  await click("Refund or correct record");
  await enter("Refund amount", "2.00");
  const amount = field("Received amount (USD)"),
    refund = field("Refund amount");
  await click("Overview");
  await click("History");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Booking sections"] button:nth-child(2)',
      )!
      .click(),
  );
  expect(field("Received amount (USD)")).toBe(amount);
  expect(amount.value).toBe("8.00");
  expect(field("Refund amount")).toBe(refund);
  expect(refund.value).toBe("2.00");
  await act(async () => navigateLocal("/app/bookings/visit-b/payments"));
  expect(field("Received amount (USD)").value).toBe("");
  expect(field("Refund amount").value).toBe("");
  expect(mutations()).toHaveLength(0);
});

it("recovers a malformed initial booking-payment response with a read-only retry", async () => {
  respond = () => Response.json({});
  await booking();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(errors).toHaveLength(1);
  respond = () => undefined;
  await click("Retry payment records");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Payment summary");
  expect(requests).toHaveLength(2);
  expect(mutations()).toHaveLength(0);
});
