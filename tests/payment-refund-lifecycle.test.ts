// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BookingPayments } from "../src/client/payments/BookingPayments";
import { PaymentAttempt } from "../src/client/payments/PaymentAttempt";
import { manual, owner, paymentFixture } from "./payment-fixture";

it("starts a new checkout after the previous attempt is confirmed expired", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = paymentFixture();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    fixture.test.afterCreate = async () => {
      for (const session of fixture.test.sessions.values()) {
        await fixture.test.expireCheckout(session.id);
      }
    };
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        expect(path).toBe("/api/business/payments/bookings/booking-a/checkout");
        const result = await fixture.service.checkout(
          "booking-a",
          owner,
          JSON.parse(String(options.body)).requestId,
        );
        return new Response(JSON.stringify(result));
      }
      expect(
        path.startsWith("/api/business/payments/bookings/booking-a?"),
      ).toBe(true);
      return new Response(
        JSON.stringify(await fixture.service.view("booking-a", owner)),
      );
    });
    let pending: Promise<unknown> = Promise.resolve();
    const errors: unknown[] = [];
    await act(async () =>
      root.render(
        createElement(BookingPayments, {
          bookingId: "booking-a",
          owner: true,
          busy: false,
          onError: async (error) => {
            errors.push(error);
          },
          run: async (work) => {
            pending = work();
            await pending;
          },
        }),
      ),
    );
    async function checkout() {
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "Open sandbox checkout",
      );
      expect(button).toBeDefined();
      await act(async () => {
        button!.click();
        await pending;
      });
    }
    await checkout();
    expect(fixture.test.calls.create).toBe(1);
    await checkout();
    expect(fixture.test.calls.create).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    fixture.close();
    vi.unstubAllGlobals();
  }
});

it("retries an uncertain refund once, then records a second identical refund as new money", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", () => {
    throw new Error("External requests blocked");
  });
  const fixture = paymentFixture();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const id = await fixture.service.manual("booking-a", owner, manual(3000));
    const attempt = (
      await fixture.service.view("booking-a", owner)
    ).attempts.find((item) => item.id === id)!;
    let loseResponse = true;
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      expect(path).toBe(`/api/business/payments/attempts/${id}/refund`);
      // Exercise the real ledger/idempotency boundary; authentication and Hono
      // ingress are covered separately by payment-api.test.ts.
      const refundId = await fixture.service.refund(
        id,
        owner,
        JSON.parse(String(options?.body)),
      );
      const response = new Response(JSON.stringify({ id: refundId }));
      if (response.ok && loseResponse) {
        loseResponse = false;
        throw new Error("Synthetic lost response after commit");
      }
      return response;
    });
    let pending: Promise<void> = Promise.resolve();
    const errors: unknown[] = [];
    await act(async () =>
      root.render(
        createElement(PaymentAttempt, {
          attempt,
          owner: true,
          busy: false,
          run: (work) =>
            (pending = work().then(
              () => {},
              (error) => {
                errors.push(error);
              },
            )),
        }),
      ),
    );
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Refund or correct record",
    )!;
    await act(async () => button.click());
    const form = container.querySelector("form")!;
    const amount = form.querySelector("input[inputmode=decimal]")!;
    const note = form.querySelector("textarea")!;
    const confirmation = form.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    )!;
    async function fill(element: Element, value: string) {
      await act(async () => {
        const prototype =
          element.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          element,
          value,
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    async function submit() {
      await act(async () => {
        form.requestSubmit();
        await pending;
      });
    }
    await fill(amount, "5.00");
    await fill(note, "Returned cash");
    await act(async () => confirmation.click());
    await submit();
    expect(errors).toHaveLength(1);
    expect((amount as HTMLInputElement).value).toBe("5.00");
    await submit();
    expect(errors).toHaveLength(1);
    expect(
      (await fixture.service.view("booking-a", owner)).balances[0]
        .refundedCents,
    ).toBe(500);
    // A new deliberate refund has the same amount and reason, not the same intent.
    await fill(amount, "5.00");
    await act(async () => confirmation.click());
    await submit();
    expect(errors).toHaveLength(1);
    const result = await fixture.service.view("booking-a", owner);
    expect(result.balances[0].refundedCents).toBe(1000);
    expect(result.attempts[0].refundCount).toBe(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    fixture.close();
    vi.unstubAllGlobals();
  }
});
