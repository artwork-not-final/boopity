import { afterEach, expect, it, vi } from "vitest";
import { decodeResponse } from "../../src/client/lib/http/api-response";
import {
  paymentSettingsResponse,
  paymentViewResponse,
  publicInfoResponse,
  sessionResponse,
  setupStateResponse,
} from "../../src/shared/api-responses";
import {
  alice,
  manual,
  owner,
  paymentFixture,
} from "../support/payment-fixture";

afterEach(() => vi.unstubAllGlobals());

it("validates real setup, session, and payment snapshots, including unconfigured providers", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("External network blocked");
  });
  const fixture = paymentFixture();
  try {
    const browser = fixture.browser();
    await browser.login("owner@example.test");
    await expect(
      decodeResponse(
        await browser.req("/api/installation"),
        publicInfoResponse,
      ),
    ).resolves.toMatchObject({ ownerClaimed: true });
    await expect(
      decodeResponse(await browser.req("/api/portal/session"), sessionResponse),
    ).resolves.toMatchObject({ role: "owner" });
    await expect(
      decodeResponse(
        await browser.req("/api/setup/status"),
        setupStateResponse,
      ),
    ).resolves.toMatchObject({ providers: { version: 0 } });
    // Remove only unused synthetic provider rows; exercise the real reader for
    // a fresh install's version-zero integrations without decrypting fake keys.
    fixture.db.connection.exec("DELETE FROM payment_integrations;");
    expect(
      paymentSettingsResponse.safeParse({
        integrations: await fixture.runtime.control.payments.views(),
        settings: { mode: "test", version: 1 },
      }).success,
    ).toBe(true);
    await fixture.service.manual("booking-a", owner, manual());
    for (const actor of [owner, alice]) {
      const view = await fixture.service.view("booking-a", actor);
      expect(paymentViewResponse.safeParse(view).success).toBe(true);
      await expect(
        decodeResponse(
          Response.json({ ...view, balances: [] }),
          paymentViewResponse,
        ),
      ).rejects.toThrow("unexpected response");
    }
  } finally {
    fixture.close();
  }
});

it.each([
  sessionResponse,
  setupStateResponse,
  paymentSettingsResponse,
  paymentViewResponse,
])("rejects incomplete critical responses before rendering", async (schema) => {
  await expect(
    decodeResponse<unknown>(Response.json({ private: "payload" }), schema),
  ).rejects.toThrow("unexpected response");
});
