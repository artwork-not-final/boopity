import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Login } from "../../src/client/features/auth/Login";
import { InvitationWelcome } from "../../src/client/features/auth/InvitationWelcome";
import { SetupPasswordLogin } from "../../src/client/features/setup/SetupPasswordLogin";
import { defaultBranding } from "../../src/shared/branding";
import { BrandLayout } from "../../src/client/app/BrandLayout";

const info = {
  branding: { ...defaultBranding, businessName: "Maple Paws" },
  version: 1,
  setupRequired: false,
  ownerClaimed: true,
  login: { email: true, google: true },
};
function render(props: Partial<ComponentProps<typeof Login>> = {}) {
  return renderToStaticMarkup(
    createElement(Login, {
      info,
      standalone: true,
      busy: false,
      run: vi.fn(),
      after: vi.fn(),
      ...props,
    }),
  );
}

describe("standalone sign-in layout", () => {
  it("matches the invitation card width, spacing and centered heading", () => {
    const login = render();
    const invitation = renderToStaticMarkup(
      createElement(InvitationWelcome, {
        businessName: "Maple Paws",
        signedInEmail: "alex@example.test",
        invitedEmail: "alex@example.test",
        busy: false,
        onAccept: vi.fn(),
        onSwitchAccount: vi.fn(),
      }),
    );
    for (const slot of ["card", "card-content"]) {
      const classes = new RegExp(`data-slot="${slot}" class="([^"]+)"`);
      expect(login.match(classes)![1]).toBe(invitation.match(classes)![1]);
    }
    expect(login).toContain("mx-auto w-full max-w-md gap-0");
    expect(login).toContain("p-6 text-center sm:p-8");
    expect(login.match(/<h1\b/g)).toHaveLength(1);
    expect(login).not.toContain("Email sign-in");
    expect(login).toContain("space-y-5 text-left");
  });

  it("keeps labeled email and code inputs with full-width, touch-sized actions", () => {
    const html = render();
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]{6}"');
    expect(html).toContain('maxLength="6"');
    expect(html.match(/min-h-11 w-full/g)).toHaveLength(3);
    expect(html).toContain("Send code");
    expect(html).toContain("6-digit code");
    expect(html).toContain("Sign in");
    expect(html).toContain("Continue with Google");
    for (const [, id] of html.matchAll(/<label for="([^"]+)"/g))
      expect(html).toContain(`id="${id}"`);
  });

  it.each([false, true])(
    "matches the setup password card width and spacing to sign-in (returning: %s)",
    (returning) => {
      const login = render();
      const setup = renderToStaticMarkup(
        createElement(SetupPasswordLogin, {
          returning,
          busy: false,
          run: vi.fn(),
        }),
      );
      for (const slot of ["card", "card-content"]) {
        const classes = new RegExp(`data-slot="${slot}" class="([^"]+)"`);
        expect(setup.match(classes)![1]).toBe(login.match(classes)![1]);
      }
      expect(setup).toContain("space-y-5 text-left");
      expect(setup).toContain("min-h-11 w-full");
    },
  );

  it("keeps errors and status messages inside the card and escapes their text", () => {
    const html = render({
      error: "Try again. <script>example</script>",
      message: "Check your inbox for a code.",
    });
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("&lt;script&gt;example&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html.indexOf('data-slot="card-content"')).toBeLessThan(
      html.indexOf('role="alert"'),
    );
    expect(html.indexOf('role="status"')).toBeLessThan(
      html.indexOf(">Email</label>"),
    );
  });

  it("respects the configured providers and preserves an invited email", () => {
    const html = render({
      info: { ...info, login: { email: true, google: false } },
      suggestedEmail: "alex@example.test",
    });
    expect(html).not.toContain("Google");
    expect(html).toContain('value="alex@example.test"');
    expect(html).toContain('readOnly=""');
    expect(html).not.toContain("Use your owner email");
  });

  it("keeps the initial sign-in page to its heading, labels and actions", () => {
    const html = render();
    expect(html).not.toContain("Use an email code or continue with Google");
    expect(html).not.toContain("email you a sign-in code");
    expect(html).not.toContain("Use your owner email");
    expect(html).not.toContain("Use the latest email code");
    expect(html).not.toMatch(/<p\b/);
  });

  it("keeps unavailable-email feedback short without showing setup instructions", () => {
    const html = render({
      info: { ...info, login: { email: false, google: true } },
    });
    expect(html).toContain("Email sign-in is unavailable.");
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain("server recovery");
    expect(html).not.toContain("Email delivery step");
  });

  it("disables inputs and actions while busy without starting sign-in on render", () => {
    const run = vi.fn(),
      after = vi.fn();
    const html = render({ busy: true, run, after });
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(2);
    expect(run).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("leaves the existing setup-resume presentation separate", () => {
    const html = render({ standalone: false, resumeSetup: true });
    expect(html).toContain("Welcome back");
    expect(html).toContain("Enter the email you saved during setup");
    expect(html).not.toContain("max-w-md");
    expect(html).not.toContain("Six-digit code");
  });

  it("uses the same centered page shell and footer for sign-in, invitations and setup entry", () => {
    const source = readFileSync(
      new URL("../../src/client/app/App.tsx", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(source).toContain(
      "const showingAccountPage = showingInvitation || showingSignIn;",
    );
    expect(source).toContain(
      "const centeredEntryPage = showingAccountPage || showingSetupEntry;",
    );
    const html = renderToStaticMarkup(
      createElement(BrandLayout, {
        active: defaultBranding,
        siteName: "Boopity",
        centeredEntryPage: true,
        skipTarget: "main-content",
        showSignOut: false,
        busy: false,
        onSignOut: vi.fn(),
        children: "Sign in",
      }),
    );
    expect(html).toContain('class="flex min-h-svh flex-col"');
    expect(html).toMatch(
      /<main\b[^>]*class="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center/,
    );
    expect(html).toContain(
      '<footer class="mx-auto flex w-full max-w-7xl justify-center',
    );
    expect(source).toContain("!inWorkspace && !setup && !showingAccountPage");
    expect(source).toContain(
      '<Login standalone error={displayedError} message={typeof message === "string" ? message : undefined}',
    );
  });
});
