import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  adjacentSetupStep,
  saveAndRefresh,
  saveAppearanceDraft,
  savedSiteName,
  readSetupStep,
  rememberSetupStep,
  restoredSetupStep,
  setupPasswordError,
  installerAccess,
  setupAccessView,
  type SetupEntryMode,
} from "../src/client/lib/navigation/setup-flow";
import { Appearance } from "../src/client/features/settings/Appearance";
import { EmailSettings } from "../src/client/features/settings/EmailSettings";
import { GoogleSettings } from "../src/client/features/settings/GoogleSettings";
import { Identity } from "../src/client/features/setup/Identity";
import { Login } from "../src/client/features/auth/Login";
import { Unlock } from "../src/client/features/setup/Unlock";
import { SetupPasswordLogin } from "../src/client/features/setup/SetupPasswordLogin";
import { SetupPasswordHelp } from "../src/client/features/setup/SetupPasswordHelp";
import { SetupAccess } from "../src/client/features/setup/SetupAccess";
import { HostingSetupHelp } from "../src/client/features/setup/HostingSetupHelp";
import { SetupNavigation } from "../src/client/features/setup/SetupNavigation";
import type { SetupState } from "../src/shared/api-responses";
import { defaultBranding } from "../src/shared/branding";
import { emptyProviders } from "../src/shared/setup";

const readClient = (file: string) =>
  readFileSync(new URL(`../src/client/${file}.tsx`, import.meta.url), "utf8");

describe("returning to unfinished setup", () => {
  it("offers a short password form without email, commands or automatic sign-in", () => {
    const run = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SetupPasswordLogin, { busy: false, run, returning: true }),
    );
    expect(html).toContain("Setup password");
    expect(html).toContain("Continue setup");
    expect(html).toContain("Welcome back!");
    expect(html).toContain("Your progress is saved.");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/npm|terminal|setup-link|Email me/);
    expect(run).not.toHaveBeenCalled();
  });
  it("requires a confirmed first password, but offers no password change when one is already set", () => {
    expect(setupPasswordError("", "", true)).toBeTruthy();
    expect(setupPasswordError("", "", false)).toBeNull();
    expect(
      setupPasswordError("synthetic password", "different password", true),
    ).toContain("don’t match");
    expect(
      setupPasswordError(" ".repeat(15), " ".repeat(15), true),
    ).toBeTruthy();
    expect(
      setupPasswordError("a".repeat(129), "a".repeat(129), true),
    ).toBeTruthy();
    expect(
      setupPasswordError("synthetic password", "synthetic password", true),
    ).toBeNull();
    expect(setupPasswordError("synthetic password", "", false)).toBeTruthy();
    const html = renderToStaticMarkup(
      createElement(Identity, { state: state(), busy: false, run: vi.fn() }),
    );
    expect(html).toContain("Confirm setup password");
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).not.toContain("Change setup password");
    const existing = renderToStaticMarkup(
      createElement(Identity, {
        state: { ...state(), setupPasswordSet: true },
        busy: false,
        run: vi.fn(),
      }),
    );
    expect(existing.match(/<input\b/g)).toHaveLength(2);
    expect(existing).toContain("Your name");
    expect(existing).toContain("Your email");
    expect(existing).not.toMatch(
      /Owner email|Change setup password|Confirm setup password|new-password|<details/,
    );
  });
  it("remembers only a valid step name, never form values or access credentials", () => {
    const storage = {
      getItem: vi.fn(() => "email"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(readSetupStep(storage)).toBe("email");
    rememberSetupStep("appearance", storage);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      "boopity.setup.step",
      "appearance",
    );
    rememberSetupStep(null, storage);
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(
      "boopity.setup.step",
    );
    storage.getItem.mockReturnValue("not-a-step");
    expect(readSetupStep(storage)).toBeNull();
  });
  it("still works when browser storage is unavailable", () => {
    const denied = () => {
      throw new Error("Storage disabled");
    };
    expect(readSetupStep({ getItem: denied })).toBeNull();
    expect(() =>
      rememberSetupStep("email", { setItem: denied, removeItem: denied }),
    ).not.toThrow();
    expect(() =>
      rememberSetupStep(null, { setItem: denied, removeItem: denied }),
    ).not.toThrow();
  });
  it("restores navigation after refresh, with saved-progress fallbacks for older browsers", () => {
    const current = state();
    expect(restoredSetupStep(current, "appearance")).toBe("appearance");
    expect(restoredSetupStep(current, null)).toBe("email");
    expect(
      restoredSetupStep({ ...current, setupPasswordSet: false }, "email"),
    ).toBe("identity");
    current.readiness.email = true;
    current.branding = { ...defaultBranding };
    expect(restoredSetupStep(current, null)).toBe("appearance");
    current.branding.businessName = "Maple & Paws";
    expect(restoredSetupStep(current, null)).toBe("verify");
    current.owner = {
      name: "Owner",
      email: "owner@example.test",
      verified: true,
    };
    expect(restoredSetupStep(current, null)).toBe("google");
    current.owner = null;
    current.pending.email = null;
    expect(restoredSetupStep(current, "review")).toBe("identity");
  });
  it("offers a concise email resume form without requesting codes automatically", () => {
    const run = vi.fn();
    const html = renderToStaticMarkup(
      createElement(Login, {
        info: {
          branding: defaultBranding,
          version: 1,
          setupRequired: true,
          ownerClaimed: false,
          login: { email: true, google: false },
        },
        busy: false,
        run,
        after: () => {},
        resumeSetup: true,
      }),
    );
    expect(html).toContain("Welcome back");
    expect(html).toContain("Enter the email you saved during setup");
    expect(html).toContain("Send sign-in code");
    expect(html).not.toContain("Six-digit code");
    expect(html).not.toContain("terminal");
    expect(html).not.toContain("owner@example.test");
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps the private-link handoff short and puts installer instructions elsewhere", () => {
    const props = {
      recovery: false,
      returning: true,
      busy: false,
      run: async () => {},
      clearLink: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(Unlock, { ...props, linkToken: null }),
    );
    expect(html).toContain("Finish your installation");
    expect(html).not.toContain("npm run manage");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Welcome to Boopity");
    const linked = renderToStaticMarkup(
      createElement(Unlock, { ...props, linkToken: "synthetic-private-link" }),
    );
    expect(linked).toContain("Continue setup");
    expect(linked).not.toContain("synthetic-private-link");
  });
});

describe("one sitter-facing setup path", () => {
  function render(
    mode: SetupEntryMode,
    extra: {
      installerCode?: boolean;
      linkToken?: string;
      busy?: boolean;
      started?: boolean;
    } = {},
  ) {
    const run = vi.fn(),
      refresh = vi.fn(),
      clearFeedback = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SetupAccess, {
        mode,
        started: mode !== "token" && mode !== "email" && mode !== "waiting",
        info: {
          branding: defaultBranding,
          version: 1,
          setupRequired: true,
          ownerClaimed: false,
          login: { email: true, google: false },
        },
        busy: false,
        run,
        refresh,
        linkToken: null,
        clearLink: vi.fn(),
        leaveInstaller: vi.fn(),
        afterClaim: vi.fn(),
        clearFeedback,
        ...extra,
      }),
    );
    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    return html;
  }
  it("welcomes a fresh password-protected installation without claiming saved progress", () => {
    const html = render("password", { started: false });
    expect(html).toContain("Welcome to Boopity!");
    expect(html).toContain("Your setup password makes sure only you");
    expect(html).toContain("Start setup");
    expect(html).not.toMatch(
      /Continue setup|Welcome back|Your progress is saved/,
    );
  });
  it.each(["password", "password-email"] as const)(
    "offers only the available recovery path for %s",
    (mode) => {
      const html = render(mode);
      expect(html.match(/<input\b/g)).toHaveLength(1);
      expect(html.match(/<button\b/g)).toHaveLength(2);
      expect(html).toContain("Continue setup");
      expect(html).toContain(
        mode === "password-email"
          ? "Email me a sign-in code"
          : "Help me find my setup password",
      );
      expect(html).not.toContain("Forgot password?");
      if (mode === "password") expect(html).not.toContain("Email me");
      expect(html).not.toMatch(
        /Advanced setup|Installer access|npm|docker|BOOPITY_|expires/,
      );
    },
  );
  it("offers email when ready, password-finding help otherwise, and hosting recovery only when requested", () => {
    for (const mode of ["password", "password-email"] as const) {
      expect(setupAccessView(mode, "none", false, false)).toBe("password");
      expect(setupAccessView(mode, "hosting", false, false)).toBe("hosting");
      expect(setupAccessView(mode, "none", false, false)).toBe("password"); // Back to password.
    }
    expect(setupAccessView("password-email", "forgot", false, false)).toBe(
      "email",
    );
    expect(setupAccessView("password", "forgot", false, false)).toBe(
      "password-help",
    );
    expect(setupAccessView("resume", "none", false, false)).toBe("email");
    expect(setupAccessView("email", "none", false, false)).toBe("guided");
    expect(setupAccessView("password", "hosting", true, false)).toBe("link");
    expect(setupAccessView("password", "none", false, true)).toBe("code");
    expect(setupAccessView("owner", "forgot", true, true)).toBe("owner");
  });
  it.each(["token", "paused", "waiting"] as const)(
    "keeps %s installations closed without a menu of credentials",
    (mode) => {
      const html = render(mode);
      expect(html).toContain("Finish your installation");
      expect(html).toContain("Try again");
      expect(html).not.toMatch(
        /<form|<input|<details|npm|docker|BOOPITY_|host-provided|Other setup options/,
      );
    },
  );
  it("keeps initial private links and explicit legacy forms working without exposing their credentials", () => {
    const linked = render("token", {
      linkToken: "synthetic-private-setup-link",
    });
    expect(linked).toContain("Start setup");
    expect(linked).not.toMatch(
      /synthetic-private-setup-link|<input|Forgot password|Advanced setup|npm/,
    );
    const legacy = render("password", { installerCode: true });
    expect(legacy).toContain("Installer access");
    expect(legacy).toContain("Setup code");
    expect(legacy).toContain("Back to setup");
    expect(legacy).not.toContain("Forgot password");
  });
  it("accepts only documented installer paths, never a credential in the path", () => {
    expect(installerAccess("/setup/code")).toBe("setup-code");
    expect(installerAccess("/setup/recovery")).toBe("recovery");
    for (const path of [
      "/setup",
      "/setup/owner",
      "/setup/synthetic-secret",
      "/setup/code/synthetic-secret",
      "https://evil.example/setup/code",
    ])
      expect(installerAccess(path)).toBeNull();
  });
  it("keeps password-finding help free of hosting instructions or automatic actions", () => {
    const onResetHelp = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SetupPasswordHelp, { busy: true, onResetHelp }),
    );
    expect(html).toContain("Let’s find your password");
    expect(html).toContain("password manager");
    expect(html).toContain("Email recovery isn’t available");
    expect(html).toContain("I still can’t find it");
    expect(html).not.toMatch(
      /hosting|restart|redeploy|BOOPITY_|npm|docker|<form|<input/,
    );
    expect(html).toContain("disabled");
    expect(onResetHelp).not.toHaveBeenCalled();
  });
  it("explains last-resort reset steps without a fake reset form or retry button", () => {
    const check = vi.fn();
    const html = renderToStaticMarkup(
      createElement(HostingSetupHelp, {
        reason: "password",
        busy: false,
        check,
      }),
    );
    expect(html).toContain("Reset through your hosting account");
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("BOOPITY_SETUP_PASSWORD");
    expect(html).toContain("15–128 characters");
    expect(html).toContain("Don’t delete the app or its");
    expect(html).not.toMatch(/<form|<input|<button|Try again|npm|docker/);
    expect(check).not.toHaveBeenCalled();
  });
  it("keeps other hosting help brief and free of commands or environment variable names", () => {
    for (const reason of ["missing", "email"] as const) {
      const check = vi.fn();
      const html = renderToStaticMarkup(
        createElement(HostingSetupHelp, { reason, busy: true, check }),
      );
      expect(html).toContain("hosting dashboard");
      expect(html).not.toMatch(/npm|docker|BOOPITY_|<details|<input/);
      expect(html).toContain("disabled");
      expect(check).not.toHaveBeenCalled();
    }
    expect(
      render("password-email", { busy: true }).match(/<button[^>]*disabled/g),
    ).toHaveLength(2);
  });
  it("moves commands to the included installer guide and keeps the sitter guide focused", () => {
    const guide = readFileSync(
      new URL("../GUIDED-INSTALLATION.md", import.meta.url),
      "utf8",
    );
    const installer = readFileSync(
      new URL("../INSTALLER-ACCESS.md", import.meta.url),
      "utf8",
    );
    const source = [
      "app/App",
      "features/setup/SetupAccess",
      "features/setup/SetupWizard",
      "features/setup/SetupNavigation",
      "features/setup/HostingSetupHelp",
      "features/setup/GuidedClaim",
      "features/setup/Unlock",
      "features/setup/Identity",
      "features/setup/SetupPasswordLogin",
      "features/setup/SetupPasswordHelp",
      "features/auth/Login",
      "features/settings/Appearance",
      "features/settings/EmailSettings",
      "features/settings/GoogleSettings",
      "features/settings/SettingsPage",
    ]
      .map(readClient)
      .join("\n");
    expect(guide).toContain("**Help me find my setup password**");
    expect(guide).toContain("**Email me a sign-in code**");
    expect(guide).toContain("INSTALLER-ACCESS.md");
    expect(guide).not.toMatch(/npm run|docker compose|BOOPITY_|\?installer=/);
    expect(installer).toContain("npm run manage -- setup-link");
    expect(installer).toContain("/setup/code");
    expect(installer).toContain("/setup/recovery");
    expect(source).not.toMatch(
      /npm run|docker compose|Advanced setup|Need server recovery\?|startup console/,
    );
  });
});

describe("setup identity and headings", () => {
  it("uses Boopity while loading or when the stored name is still the installation placeholder", () => {
    expect(savedSiteName()).toBe("Boopity");
    expect(savedSiteName(defaultBranding.businessName)).toBe("Boopity");
  });
  it("uses a saved business name without renaming or changing its spelling", () => {
    for (const name of ["Maple & Paws", "Boopity", "Jane’s Pet Care"])
      expect(savedSiteName(name)).toBe(name);
    expect(defaultBranding.businessName).toBe("Your pet-care business");
  });
  it("uses server-confirmed branding and gives the wizard only its step heading", () => {
    const source = readFileSync(
      new URL("../src/client/app/App.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("savedSiteName(info?.branding.businessName)");
    expect(source).not.toContain("savedSiteName(active.businessName)");
    expect(source).toContain("!inWorkspace && !setup");
    expect(readClient("features/setup/SetupWizard")).toMatch(
      /<h1\s+ref=\{wizardHeading\}/,
    );
    expect(source).toContain("wizardHeading={wizardHeading}");
    expect(source).not.toContain("Set up your business");
    expect(source).toContain("Powered by");
    expect(readClient("features/setup/SetupWizard")).toContain(
      "Recovery access",
    );
  });
});

describe("responsive setup navigation", () => {
  const options = [
    { id: "identity", label: "Your account" },
    { id: "email", label: "Email delivery" },
    { id: "appearance", label: "Business" },
    { id: "verify", label: "Verify your inbox" },
    { id: "google", label: "Google sign-in" },
    { id: "review", label: "Review & finish" },
  ] as const;
  it("uses a labeled styled step picker on small screens and keeps the desktop sidebar", () => {
    const select = vi.fn();
    const html = renderToStaticMarkup(
      createElement(SetupNavigation, {
        steps: options,
        current: "email",
        busy: false,
        onSelect: select,
      }),
    );
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toContain('class="lg:hidden"');
    expect(html).toContain('class="hidden flex-col gap-2 lg:flex"');
    expect(html).toContain("Step 2 of 6");
    const trigger = html.match(/<button[^>]*role="combobox"[^>]*>/)![0];
    const id = trigger.match(/\bid="([^"]+)"/)![1];
    expect(html).toContain(`for="${id}"`);
    expect(trigger).toContain('data-slot="select-trigger"');
    expect(html).toContain(
      '<option value="email" selected="">Email delivery</option>',
    );
    expect(html.match(/<option value="[^"]+"/g)).toHaveLength(6);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).not.toContain("flex-wrap");
    expect(html).toContain("text-base");
    expect(html).toContain("h-11");
    expect(select).not.toHaveBeenCalled();
  });
  it("uses the visible step count for managed-email installations", () => {
    const html = renderToStaticMarkup(
      createElement(SetupNavigation, {
        steps: [options[2], options[4], options[5]],
        current: "google",
        busy: false,
        onSelect: vi.fn(),
      }),
    );
    expect(html).toContain("Step 2 of 3");
    expect(html.match(/<option value="[^"]+"/g)).toHaveLength(3);
    expect(html).not.toContain("Your account");
    expect(html).toContain(
      '<option value="google" selected="">Google sign-in</option>',
    );
  });
  it("locks both navigation controls while a save is pending", () => {
    const html = renderToStaticMarkup(
      createElement(SetupNavigation, {
        steps: options,
        current: "appearance",
        busy: true,
        onSelect: vi.fn(),
      }),
    );
    expect(html).toMatch(/<select[^>]*disabled/);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(7);
    expect(html).toContain(
      '<option value="appearance" selected="">Business</option>',
    );
  });
  it("avoids a zero step during step-list changes and handles an empty list", () => {
    const props = {
      current: "identity" as const,
      busy: false,
      onSelect: vi.fn(),
    };
    const html = renderToStaticMarkup(
      createElement(SetupNavigation, {
        ...props,
        steps: [options[2], options[4], options[5]],
      }),
    );
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain(
      '<option value="appearance" selected="">Business</option>',
    );
    expect(
      renderToStaticMarkup(
        createElement(SetupNavigation, { ...props, steps: [] }),
      ),
    ).toBe("");
  });
});

function state(): SetupState {
  return {
    actor: "setup",
    owner: null,
    pending: {
      name: "Test sitter",
      email: "owner@example.test",
      mailVerifiedAt: null,
    },
    state: "unconfigured",
    branding: { ...defaultBranding, businessName: "Test pet care" },
    version: 1,
    timeZone: "America/New_York",
    currency: "USD",
    providers: {
      ...structuredClone(emptyProviders),
      version: 1,
      managed: { email: false, google: false },
      email: { ...emptyProviders.email, hasPassword: false, hasApiKey: false },
      google: { ...emptyProviders.google, enabled: true, hasSecret: false },
    },
    readiness: {
      database: true,
      privateStorage: true,
      email: false,
      google: false,
      https: false,
      origin: "http://localhost:3000",
      googleCallback: "http://localhost:3000/api/auth/callback/google",
    },
  };
}

describe("save and continue sequencing", () => {
  it("waits for both the save and refreshed state before advancing", async () => {
    let saved!: () => void, refreshed!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          refreshed = resolve;
        }),
    );
    const advance = vi.fn();
    const pending = saveAndRefresh(save, refresh, advance);
    expect(refresh).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    saved();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(advance).not.toHaveBeenCalled();
    refreshed();
    await pending;
    expect(advance).toHaveBeenCalledOnce();
  });
  it("does not refresh or advance on a rejected save", async () => {
    const refresh = vi.fn(),
      advance = vi.fn();
    await expect(
      saveAndRefresh(
        async () => {
          throw new Error("Invalid owner email");
        },
        refresh,
        advance,
      ),
    ).rejects.toThrow("Invalid owner email");
    expect(refresh).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });
  it("stays on the step when reloading the saved state fails", async () => {
    const advance = vi.fn();
    await expect(
      saveAndRefresh(
        async () => {},
        async () => {
          throw new Error("Connection lost");
        },
        advance,
      ),
    ).rejects.toThrow("Connection lost");
    expect(advance).not.toHaveBeenCalled();
  });
  it("refreshes ordinary settings without a navigation callback", async () => {
    const refresh = vi.fn();
    await saveAndRefresh(async () => {}, refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("appearance and optional logo save", () => {
  it("saves appearance before a selected logo with the next checked revision", async () => {
    const revision = { current: 7 },
      save = vi.fn().mockResolvedValue({ ok: true }),
      logo = vi.fn().mockResolvedValue({ ok: true });
    const order: string[] = [];
    await saveAndRefresh(
      () =>
        saveAppearanceDraft(
          revision,
          async (version) => {
            order.push("appearance");
            await save(version);
          },
          async (version) => {
            order.push("logo");
            await logo(version);
          },
        ),
      async () => {
        order.push("refresh");
      },
      () => {
        order.push("continue");
      },
    );
    expect(save).toHaveBeenCalledWith(7);
    expect(logo).toHaveBeenCalledWith(8);
    expect(revision.current).toBe(9);
    expect(order).toEqual(["appearance", "logo", "refresh", "continue"]);
  });
  it("does not upload a logo or change revision after failed appearance validation", async () => {
    const revision = { current: 7 },
      logo = vi.fn();
    await expect(
      saveAppearanceDraft(
        revision,
        async () => {
          throw new Error("Invalid timezone");
        },
        logo,
      ),
    ).rejects.toThrow("Invalid timezone");
    expect(logo).not.toHaveBeenCalled();
    expect(revision.current).toBe(7);
  });
  it("preserves confirmed progress for retry if the logo fails, without advancing", async () => {
    const revision = { current: 7 },
      refresh = vi.fn(),
      advance = vi.fn();
    await expect(
      saveAndRefresh(
        () =>
          saveAppearanceDraft(
            revision,
            async () => {},
            async () => {
              throw new Error("Invalid image");
            },
          ),
        refresh,
        advance,
      ),
    ).rejects.toThrow("Invalid image");
    expect(revision.current).toBe(8);
    expect(refresh).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    const retryAppearance = vi.fn(),
      retryLogo = vi.fn();
    await saveAndRefresh(
      () => saveAppearanceDraft(revision, retryAppearance, retryLogo),
      refresh,
      advance,
    );
    expect(retryAppearance).toHaveBeenCalledWith(8);
    expect(retryLogo).toHaveBeenCalledWith(9);
    expect(revision.current).toBe(10);
    expect(advance).toHaveBeenCalledOnce();
  });
  it("does not perform an optional logo operation when none was selected", async () => {
    const revision = { current: 7 },
      save = vi.fn();
    await saveAppearanceDraft(revision, save);
    expect(revision.current).toBe(8);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("wizard navigation", () => {
  const full = [
    "identity",
    "email",
    "appearance",
    "verify",
    "google",
    "review",
  ].map((id) => ({ id }));
  const guided = ["appearance", "google", "review"].map((id) => ({ id }));
  it("follows both normal and host-managed step order with no wraparound", () => {
    expect(adjacentSetupStep(full, "identity", 1)).toBe("email");
    expect(adjacentSetupStep(full, "email", 1)).toBe("appearance");
    expect(adjacentSetupStep(full, "appearance", 1)).toBe("verify");
    expect(adjacentSetupStep(guided, "appearance", 1)).toBe("google");
    expect(adjacentSetupStep(guided, "google", 1)).toBe("review");
    expect(adjacentSetupStep(full, "review", 1)).toBeUndefined();
    expect(adjacentSetupStep(full, "identity", -1)).toBeUndefined();
    expect(adjacentSetupStep(guided, "identity", 1)).toBeUndefined();
    expect(adjacentSetupStep(full, "email", -1)).toBe("identity");
    expect(adjacentSetupStep(guided, "google", -1)).toBe("appearance");
  });
  const components = [Identity, EmailSettings, Appearance, GoogleSettings];
  function render(
    component: (typeof components)[number],
    wizard = true,
    current = state(),
    busy = false,
  ) {
    return renderToStaticMarkup(
      createElement(component, {
        state: current,
        busy,
        run: async () => {},
        preview: () => {},
        ...(wizard ? { onContinue: () => {} } : {}),
      }),
    );
  }
  it.each(components)(
    "uses one Save and continue action in %s",
    (component) => {
      const html = render(component);
      expect(html.match(/Save and continue/g)).toHaveLength(1);
      expect(html).not.toContain("Next step");
    },
  );
  it.each(components)(
    "keeps %s as a non-navigating settings form",
    (component) => {
      const html = render(component, false);
      expect(html).toContain("Save changes");
      expect(html).not.toContain("Save and continue");
      expect(html).not.toContain("Next step");
    },
  );
  it("restores saved owner and appearance values when revisiting their steps", () => {
    expect(render(Identity)).toContain('value="Test sitter"');
    expect(render(Identity)).toContain('value="owner@example.test"');
    expect(render(Appearance)).toContain('value="Test pet care"');
    expect(render(Appearance)).toContain('value="America/New_York"');
  });
  it("offers all time zones without filtering out alternatives to the saved zone", () => {
    for (const wizard of [true, false]) {
      const html = render(Appearance, wizard);
      const select = html.match(/<select\b[^>]*>[\s\S]*?<\/select>/)![0];
      expect(select).toContain(
        '<option value="America/New_York" selected="">Eastern Time (New York)</option>',
      );
      expect(select).toContain(
        '<option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>',
      );
      expect(select).toContain(
        '<option value="Asia/Tokyo">Japan Standard Time (Tokyo)</option>',
      );
      expect(select.indexOf("Eastern Time (New York)")).toBeLessThan(
        select.indexOf("Pacific Time (Los Angeles)"),
      );
      for (const zone of [
        "America/Los_Angeles",
        "Europe/London",
        "Asia/Tokyo",
        "Australia/Sydney",
        "UTC",
      ]) {
        expect(select).toContain(`value="${zone}"`);
      }
      expect(html).not.toContain("<datalist");
      expect(html).toContain("Time zone");
    }
  });
  it.each(["UTC", "US/Eastern"])(
    "preserves a saved %s even when it is not listed by the browser",
    (timeZone) => {
      const current = { ...state(), timeZone };
      const html = render(Appearance, true, current);
      expect(html).toContain(`<option value="${timeZone}" selected="">`);
      expect(html.match(new RegExp(`value="${timeZone}"`, "g"))).toHaveLength(
        1,
      );
    },
  );
  it("shows currency names while preserving the selected currency code", () => {
    for (const wizard of [true, false]) {
      const html = render(Appearance, wizard, { ...state(), currency: "CAD" });
      expect(html).toContain(
        '<option value="CAD" selected="">Canadian dollar (CAD)</option>',
      );
      for (const [code, name] of [
        ["USD", "US dollar"],
        ["GBP", "British pound"],
        ["EUR", "Euro"],
        ["AUD", "Australian dollar"],
        ["NZD", "New Zealand dollar"],
      ]) {
        expect(html).toContain(
          `<option value="${code}">${name} (${code})</option>`,
        );
      }
    }
  });
  it("keeps email save behavior and saved-secret hints clear without a technical notice", () => {
    const current = state();
    const html = render(EmailSettings, true, current);
    expect(html).toContain("Saving does not send email.");
    expect(html).not.toContain("Credentials are encrypted on your server");
    current.providers.email.provider = "smtp";
    current.providers.email.hasPassword = true;
    const smtp = render(EmailSettings, true, current);
    expect(smtp).toContain("Leave blank to keep your saved password.");
    expect(smtp).toContain("Connection security");
    current.providers.email.provider = "resend";
    current.providers.email.hasApiKey = true;
    expect(render(EmailSettings, true, current)).toContain(
      "Leave blank to keep your saved key.",
    );
    current.providers.managed.email = true;
    expect(render(EmailSettings, true, current)).toContain(
      "Email is managed in your hosting settings and can’t be changed here.",
    );
  });
  it("places the appearance submit action after the optional logo and associates it with the form", () => {
    const html = render(Appearance);
    expect(html.indexOf("Business logo")).toBeLessThan(
      html.indexOf("Save and continue"),
    );
    const id = html.match(/<form id="([^"]+)"/)![1];
    expect(html).toContain(`type="submit" form="${id}"`);
    expect(html).not.toContain("Save appearance before uploading");
  });
  it("offers Continue for read-only host settings and an explicit no-Google choice", () => {
    const current = state();
    current.providers.managed = { email: true, google: true };
    for (const component of [EmailSettings, GoogleSettings]) {
      expect(render(component, true, current)).toContain(">Continue</button>");
      expect(render(component, true, current)).not.toContain(
        "Save and continue",
      );
    }
    current.providers.managed.google = false;
    current.providers.google.enabled = false;
    expect(render(GoogleSettings, true, current)).toContain(
      "Continue without Google",
    );
  });
  it("disables identity and appearance fields while saving", () => {
    for (const component of [Identity, Appearance])
      expect(render(component, true, state(), true)).toContain(
        '<fieldset disabled=""',
      );
  });
  it("wires completion only to wizard forms and retains explicit verification and Back", () => {
    const source = readFileSync(
      new URL("../src/client/app/App.tsx", import.meta.url),
      "utf8",
    );
    const wizard = readClient("features/setup/SetupWizard");
    expect(wizard.match(/onContinue=\{continueSetup\}/g)).toHaveLength(4);
    const settings = readClient("features/settings/SettingsPage");
    expect(settings).not.toContain("onContinue=");
    expect(source).toContain("saveAndRefresh(run, refresh, afterSave)");
    expect(wizard).toContain("changeSetupStep(previousStep)");
    expect(source + wizard + settings).not.toContain("Next step");
    expect(wizard).toContain(
      "setup.owner?.verified && setup.pending.mailVerifiedAt",
    );
    expect(readClient("features/auth/Login")).toContain("Send sign-in code");
    expect(wizard).toContain("ref={wizardHeading}");
  });
});
