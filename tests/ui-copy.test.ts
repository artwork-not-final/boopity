import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Copy contracts: shortening the interface must not erase consequences from
// money, access and privacy controls. Provider behavior is tested separately.
const read = (file: string) =>
  readFileSync(
    new URL(`../src/client/${file}.tsx`, import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");

const paymentCopy = () =>
  [
    "BookingPayments",
    "BookingPaymentList",
    "AccountingHistory",
    "PaymentAttempt",
    "RefundHistory",
    "ReverseCredit",
    "PaymentBalanceSummary",
    "PaymentSettings",
    "IntegrationSettings",
    "PaymentFields",
    "PaymentRecords",
    "PaymentActivityList",
    "PaymentActivityTotals",
  ]
    .map((file) => read(`payments/${file}`))
    .join(" ");

describe("concise self-hosted copy", () => {
  it("explains which booking fields each role can search", () => {
    const copy = read("Bookings");
    expect(copy).toContain("Search by client, pet, or service");
    expect(copy).toContain("Search by pet or service");
    expect(copy).not.toContain('label="Find a booking"');
  });
  it("removes promotional payment headings and setup narration", () => {
    const copy =
      [
        "SelfHostedApp",
        "InstallationFields",
        "setup/SetupAccess",
        "setup/SetupWizard",
        "setup/SetupNavigation",
        "setup/HostingSetupHelp",
        "setup/GuidedClaim",
        "setup/Unlock",
        "setup/Identity",
        "setup/SetupPasswordLogin",
        "setup/SetupPasswordHelp",
        "auth/Login",
        "settings/Appearance",
        "settings/EmailSettings",
        "settings/GoogleSettings",
        "settings/SettingsPage",
      ]
        .map(read)
        .join(" ") +
      paymentCopy() +
      read("Workspace") +
      read("Bookings") +
      read("NewBooking") +
      read("Rules") +
      read("clients/Clients") +
      read("clients/ClientPortalAccess") +
      read("clients/PetCareForm");
    for (const removed of [
      "Payments, clearly recorded.",
      "Your business. Your payments.",
      "One last step:",
      "Let’s personalize your business.",
      "First-run setup",
      "Your sitter’s confirmed visits and your requests will appear here.",
    ])
      expect(copy).not.toContain(removed);
  });
  it("keeps payment consequences and explicit real-refund consent", () => {
    const copy = paymentCopy();
    for (const required of [
      "Sandbox payments do not settle real balances.",
      "Cancelling does not refund payments or waive charges.",
      "Refunds return money; credits reduce charges.",
      "I authorize this real refund to the original payment method.",
      "I already returned this money outside Boopity.",
      "Saving credentials disables new checkout until you re-enable it.",
      "Connection instructions",
      "Do not use a full-access key.",
      "Public webhooks require HTTPS.",
    ])
      expect(copy).toContain(required);
  });
  it("keeps access, privacy and cancellation guidance at the relevant controls", () => {
    const workspace =
      read("Workspace") +
      read("Rules") +
      read("BookingDetail") +
      read("clients/ClientPortalAccess") +
      read("clients/PetCareForm");
    for (const required of [
      "Client cancellation deadline:",
      "Cancelling does not issue a refund.",
      "Private sitter notes",
      "Never shown to clients.",
      "Client-visible visit update",
      "Shared with the client.",
      "expires in seven days and is not emailed automatically.",
      "The client must use the email saved in their contact details.",
      "Shown once. Copy and send privately to the client.",
      "Turning this off signs clients out.",
    ])
      expect(workspace).toContain(required);
    expect(read("setup/Unlock")).toContain("expires after 30 minutes.");
    expect(read("setup/SetupWizard")).toContain("Recovery access");
    expect(read("setup/Identity")).toContain(
      "You’ll verify this email to finish setting up your account.",
    );
  });
});
