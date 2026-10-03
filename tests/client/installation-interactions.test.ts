// @vitest-environment happy-dom
import {
  act,
  createElement,
  StrictMode,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/client/app/App";
import { Appearance } from "../../src/client/features/settings/Appearance";
import { EmailSettings } from "../../src/client/features/settings/EmailSettings";
import { GoogleSettings } from "../../src/client/features/settings/GoogleSettings";
import { Identity } from "../../src/client/features/setup/Identity";
import { Login } from "../../src/client/features/auth/Login";
import { GuidedClaim } from "../../src/client/features/setup/GuidedClaim";
import type {
  PaymentSettingsData,
  PublicInfo,
  SetupState,
} from "../../src/shared/api-responses";
import {
  brandingVariables,
  defaultBranding,
  themePresets,
} from "../../src/shared/branding";
import { emptyProviders } from "../../src/shared/setup";
import { saveAndRefresh } from "../../src/client/lib/navigation/setup-flow";
import type { ActionFeedback } from "../../src/client/lib/types/action-feedback";

// Keep the actual installation coordinator/forms; workspace data is outside
// this boundary. No requests may reach a server or an email/payment provider.
vi.mock("../../src/client/app/Workspace", () => ({
  Workspace: ({ settings }: { settings?: { content: ReactNode } }) =>
    settings?.content ?? createElement("p", null, "Test workspace"),
}));

const roots: Root[] = [];
let container: HTMLDivElement;
let errors: unknown[];
let requests: { url: string; init?: RequestInit }[];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/login");
  window.sessionStorage.clear();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  errors = [];
  requests = [];
  respond = () => Response.json({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(respond(url, init));
    }),
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function state(ready = false): SetupState {
  return {
    actor: ready ? "owner" : "setup",
    owner: ready
      ? { name: "Test sitter", email: "owner@example.test", verified: true }
      : null,
    setupPasswordSet: true,
    pending: {
      name: "Test sitter",
      email: "owner@example.test",
      mailVerifiedAt: ready ? 1 : null,
    },
    state: ready ? "ready" : "unconfigured",
    branding: { ...defaultBranding, businessName: "Test pet care" },
    version: 1,
    timeZone: "America/New_York",
    currency: "USD",
    providers: {
      version: 3,
      managed: { email: false, google: false },
      email: {
        ...emptyProviders.email,
        provider: "resend",
        from: "hello@example.test",
        hasPassword: false,
        hasApiKey: true,
      },
      google: {
        ...emptyProviders.google,
        enabled: true,
        clientId: "test-client",
        hasSecret: true,
      },
    },
    readiness: {
      database: true,
      privateStorage: true,
      email: true,
      google: true,
      https: false,
      origin: "http://localhost:3000",
      googleCallback: "http://localhost:3000/api/auth/callback/google",
    },
  };
}
function info(ready = false): PublicInfo {
  return {
    branding: state().branding,
    version: 1,
    setupRequired: !ready,
    ownerClaimed: ready,
    login: { email: true, google: true },
  };
}
function action(refresh = async () => {}) {
  return async (
    work: () => Promise<unknown>,
    _message?: ActionFeedback,
    after?: () => void,
  ) => {
    try {
      await saveAndRefresh(work, refresh, after);
    } catch (error) {
      errors.push(error);
    }
  };
}
async function mount(page: ReactElement) {
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(page));
  // App pages are lazy boundaries; wait for the real module loading rather than
  // asserting against the transient Suspense status or mocking pages away.
  await act(async () => vi.dynamicImportSettled());
  return root;
}
function input(label: string) {
  const element = [...container.querySelectorAll("label")].find(
    (item) => item.textContent === label,
  );
  expect(element, label).toBeDefined();
  return document.getElementById(element!.htmlFor) as HTMLInputElement;
}
function button(label: string) {
  const element = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(element, label).toBeDefined();
  return element!;
}
async function enter(label: string, value: string) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function submit() {
  await act(async () => container.querySelector("form")!.requestSubmit());
}
function body(index: number) {
  return JSON.parse(requests[index].init!.body as string);
}
function deferredResponse() {
  let resolve!: (value: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function installation(
  current: SetupState | null,
  ready = false,
  started = Boolean(current?.pending.email),
) {
  respond = (url) => {
    if (url === "/api/installation") return Response.json(info(ready));
    if (url === "/api/setup/entry")
      return Response.json({ mode: "password", started });
    if (url === "/api/portal/session")
      return Response.json({
        user: { name: "Test sitter", email: "owner@example.test" },
        role: "owner",
      });
    if (url === "/api/portal/invitation")
      return Response.json({ invitation: null });
    if (url === "/api/setup/status")
      return current
        ? Response.json(current)
        : Response.json({}, { status: 401 });
    throw new Error(`Unexpected request: ${url}`);
  };
}

it("focuses the initial setup heading after the lazy wizard loads without stealing focus on refresh", async () => {
  window.history.replaceState(null, "", "/setup/account");
  installation(state());
  await mount(createElement(App));
  const heading = container.querySelector("#setup-content");
  expect(heading?.textContent).toBe("Your account");
  expect(document.activeElement).toBe(heading);
  const name = input("Your name");
  name.focus();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.activeElement).toBe(name);
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it.each(["/api/installation", "/api/setup/status"])(
  "ignores an older refresh delayed at %s without remounting the latest draft",
  async (endpoint) => {
    window.history.replaceState(null, "", "/setup/business");
    let current = state();
    installation(current);
    const healthy = respond;
    respond = (url, init) => {
      if (url === "/api/installation")
        return Response.json({
          ...info(),
          version: current.version,
          branding: current.branding,
        });
      if (url === "/api/setup/status") return Response.json(current);
      return healthy(url, init);
    };
    // Strict Mode must still complete the initial load and restore navigation.
    await mount(createElement(StrictMode, null, createElement(App)));
    expect(input("Business name").value).toBe("Test pet care");
    const latest = respond;
    const older = deferredResponse();
    const oldResponse = await latest(endpoint);
    respond = (url, init) =>
      url === endpoint ? older.promise : latest(url, init);
    await act(async () => window.dispatchEvent(new Event("focus")));
    current = {
      ...current,
      version: 2,
      branding: { ...current.branding, businessName: "Updated pet care" },
    };
    respond = latest;
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(input("Business name").value).toBe("Updated pet care");
    await enter("Business name", "Unsaved business name");
    await act(async () => older.resolve(oldResponse));
    expect(container.querySelector("header")?.textContent).toContain(
      "Updated pet care",
    );
    expect(input("Business name").value).toBe("Unsaved business name");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(window.location.pathname).toBe("/setup/business");
  },
);

it("applies public branding and private settings together after the full refresh succeeds", async () => {
  window.history.replaceState(null, "", "/setup/business");
  installation(state());
  await mount(createElement(App));
  const healthy = respond;
  const pending = deferredResponse();
  const next = {
    ...state(),
    version: 2,
    branding: { ...state().branding, businessName: "Updated pet care" },
  };
  respond = (url, init) => {
    if (url === "/api/installation")
      return Response.json({ ...info(), version: 2, branding: next.branding });
    if (url === "/api/setup/status") return pending.promise;
    return healthy(url, init);
  };
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.querySelector("header")?.textContent).toContain(
    "Test pet care",
  );
  expect(input("Business name").value).toBe("Test pet care");
  await act(async () => pending.resolve(Response.json(next)));
  expect(container.querySelector("header")?.textContent).toContain(
    "Updated pet care",
  );
  expect(input("Business name").value).toBe("Updated pet care");
});

it("ignores a late refresh failure after a newer refresh recovers", async () => {
  window.history.replaceState(null, "", "/setup/account");
  installation(state());
  await mount(createElement(App));
  const healthy = respond;
  const older = deferredResponse();
  respond = (url, init) =>
    url === "/api/setup/status" ? older.promise : healthy(url, init);
  await act(async () => window.dispatchEvent(new Event("focus")));
  respond = healthy;
  await act(async () => window.dispatchEvent(new Event("online")));
  await act(async () => older.reject(new TypeError("Old connection failure")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(input("Your name").value).toBe("Test sitter");
});

it.each([false, true])(
  "keeps the latest refresh error when an older request finishes (failure=%s)",
  async (failure) => {
    window.history.replaceState(null, "", "/setup/account");
    installation(state());
    await mount(createElement(App));
    const healthy = respond;
    const older = deferredResponse();
    respond = (url, init) =>
      url === "/api/setup/status" ? older.promise : healthy(url, init);
    await act(async () => window.dispatchEvent(new Event("focus")));
    respond = () =>
      Response.json({ error: "Latest refresh unavailable" }, { status: 503 });
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Latest refresh unavailable",
    );
    await act(async () => {
      if (failure) older.reject(new TypeError("Old connection failure"));
      else older.resolve(Response.json(state()));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Latest refresh unavailable",
    );
  },
);

it.each([false, true])(
  "waits for a superseding refresh before advancing a saved wizard step (failure=%s)",
  async (failure) => {
    window.history.replaceState(null, "", "/setup/account");
    installation(state());
    await mount(createElement(App));
    const healthy = respond;
    const afterSave = deferredResponse();
    const latest = deferredResponse();
    respond = (url, init) => {
      if (url === "/api/setup/identity") return Response.json({ ok: true });
      if (url === "/api/setup/status") return afterSave.promise;
      return healthy(url, init);
    };
    await submit();
    respond = (url, init) =>
      url === "/api/setup/status" ? latest.promise : healthy(url, init);
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => afterSave.resolve(Response.json(state())));
    expect(window.location.pathname).toBe("/setup/account");
    expect(button("Save and continue").disabled).toBe(true);
    await act(async () => {
      if (failure) latest.reject(new TypeError("Latest refresh failed"));
      else latest.resolve(Response.json(state()));
    });
    expect(window.location.pathname).toBe(
      failure ? "/setup/account" : "/setup/email",
    );
    if (failure) {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Latest refresh failed",
      );
      expect(button("Save and continue").disabled).toBe(false);
    }
  },
);

it("does not restore owner access from a refresh that finishes after signing out", async () => {
  window.history.replaceState(null, "", "/app/bookings");
  installation(state(true), true);
  await mount(createElement(App));
  const healthy = respond;
  const older = deferredResponse();
  respond = (url, init) =>
    url === "/api/setup/status" ? older.promise : healthy(url, init);
  await act(async () => window.dispatchEvent(new Event("focus")));
  respond = (url, init) => {
    if (["/api/auth/sign-out", "/api/setup/lock"].includes(url))
      return Response.json({ ok: true });
    if (["/api/portal/session", "/api/setup/status"].includes(url))
      return Response.json({}, { status: 401 });
    return healthy(url, init);
  };
  await click("Sign out");
  await act(async () => older.resolve(Response.json(state(true))));
  expect(container.textContent).not.toContain("Test workspace");
  expect(input("Email")).toBeDefined();
  expect(window.location.pathname).toBe("/login");
});

it.each([
  { step: "account", next: "email", endpoint: "/api/setup/identity" },
  { step: "email", next: "business", endpoint: "/api/setup/providers" },
  { step: "business", next: "verify", endpoint: "/api/setup/appearance" },
  { step: "google", next: "review", endpoint: "/api/setup/providers" },
])(
  "advances from $step without a redundant saved banner",
  async ({ step, next, endpoint }) => {
    window.history.replaceState(null, "", `/setup/${step}`);
    installation(state());
    const healthy = respond;
    respond = (url, init) =>
      url === endpoint ? Response.json({ ok: true }) : healthy(url, init);
    await mount(createElement(App));
    await submit();
    expect(requests.filter(({ url }) => url === endpoint)).toHaveLength(1);
    expect(window.location.pathname).toBe(`/setup/${next}`);
    expect(document.activeElement).toBe(
      container.querySelector("#setup-content"),
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  },
);

it("keeps the email-code delivery notice without carrying verification feedback into the next step", async () => {
  window.history.replaceState(null, "", "/setup/verify");
  installation(state());
  const healthy = respond;
  respond = (url, init) =>
    [
      "/api/auth/email-otp/send-verification-otp",
      "/api/auth/sign-in/email-otp",
      "/api/setup/owner",
    ].includes(url)
      ? Response.json({ ok: true })
      : healthy(url, init);
  await mount(createElement(App));
  await click("Send sign-in code");
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Check your inbox for a code.",
  );
  await enter("Six-digit code", "123456");
  await submit();
  expect(window.location.pathname).toBe("/setup/google");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("keeps settings confirmation beside Save through a refreshed form, but not subsequent edits or errors", async () => {
  window.history.replaceState(null, "", "/app/settings/email");
  const current = state(true);
  installation(current, true);
  const healthy = respond;
  respond = (url, init) => {
    if (url !== "/api/setup/providers") return healthy(url, init);
    current.providers.version += 1;
    return Response.json({ ok: true });
  };
  await mount(createElement(App));
  await submit();
  expect(window.location.pathname).toBe("/app/settings/email");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved");
  expect(
    button("Save changes").parentElement?.querySelector('[role="status"]')
      ?.textContent,
  ).toBe("Saved");
  expect(
    container.querySelector('[aria-label="Dismiss confirmation"]'),
  ).toBeNull();
  await enter("Sender email", "new-sender@example.test");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  respond = (url, init) =>
    url === "/api/setup/providers"
      ? Response.json({ error: "Save unavailable" }, { status: 503 })
      : healthy(url, init);
  await submit();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Save unavailable",
  );
  await enter("Sender email", "another-sender@example.test");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Save unavailable",
  );
});

it("clears a background connection error on recovery without changing the current page", async () => {
  window.history.replaceState(null, "", "/app/rates");
  installation(state(true), true);
  const healthy = respond;
  await mount(createElement(App));
  respond = () => {
    throw new TypeError("Failed to fetch");
  };
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain(
    "We couldn’t connect to Boopity. Please try again.",
  );
  expect(container.textContent).not.toContain("Failed to fetch");
  expect(container.textContent).toContain("Test workspace");
  expect(button("Retry connection").disabled).toBe(false);
  respond = healthy;
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(window.location.pathname).toBe("/app/rates");
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("lets the user retry a connection without replaying a write", async () => {
  window.history.replaceState(null, "", "/app/rates");
  installation(state(true), true);
  const healthy = respond;
  await mount(createElement(App));
  respond = () => {
    throw new TypeError("Load failed");
  };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await click("Retry connection");
  expect(container.textContent).toContain(
    "We couldn’t connect to Boopity. Please try again.",
  );
  expect(container.textContent).not.toContain("Load failed");
  respond = healthy;
  await click("Retry connection");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("does not clear form errors or unsaved input during a successful background refresh", async () => {
  window.history.replaceState(null, "", "/setup/account");
  installation(state());
  const healthy = respond;
  respond = (url, init) =>
    url === "/api/setup/identity"
      ? Response.json({ error: "Please check your details." }, { status: 400 })
      : healthy(url, init);
  await mount(createElement(App));
  await enter("Your name", "Unsaved sitter name");
  await submit();
  expect(container.textContent).toContain("Please check your details.");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Please check your details.");
  expect(input("Your name").value).toBe("Unsaved sitter name");
  expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(
    1,
  );
});

it("sends and verifies OTP only on request, claims an unfinished owner, then advances after refresh", async () => {
  const refresh = vi.fn(async () => {}),
    after = vi.fn();
  await mount(
    createElement(Login, {
      info: info(),
      state: state(),
      busy: false,
      run: action(refresh),
      after,
    }),
  );
  expect(requests).toHaveLength(0);
  expect(input("Email address").readOnly).toBe(true);
  await click("Send sign-in code");
  expect(body(0)).toEqual({ email: "owner@example.test", type: "sign-in" });
  expect(document.activeElement).toBe(input("Six-digit code"));
  await enter("Six-digit code", "12a3456");
  expect(input("Six-digit code").value).toBe("123456");
  await submit();
  expect(requests.map(({ url }) => url)).toEqual([
    "/api/auth/email-otp/send-verification-otp",
    "/api/auth/sign-in/email-otp",
    "/api/setup/owner",
  ]);
  expect(body(1)).toEqual({
    email: "owner@example.test",
    otp: "123456",
    name: "Test sitter",
  });
  expect(input("Six-digit code").value).toBe("");
  expect(after).toHaveBeenCalledOnce();
  expect(refresh.mock.invocationCallOrder.at(-1)).toBeLessThan(
    after.mock.invocationCallOrder[0],
  );
});

it.each([false, true])(
  "focuses a sent code after busy clears, including resend, but not failed sends or unrelated refreshes (resume=%s)",
  async (resumeSetup) => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    let finishRefresh!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    let setBusy!: (value: boolean) => void;
    function Harness() {
      const [busy, updateBusy] = useState(false);
      useEffect(() => {
        setBusy = updateBusy;
      }, []);
      return createElement(Login, {
        info: info(true),
        resumeSetup,
        busy,
        suggestedEmail: "owner@example.test",
        after: () => {},
        run: async (work) => {
          updateBusy(true);
          try {
            await work();
            await refreshing;
          } catch (error) {
            errors.push(error);
          } finally {
            updateBusy(false);
          }
        },
      });
    }
    await mount(createElement(Harness));
    const sendLabel = "Send sign-in code";
    await click(sendLabel);
    expect(input("Six-digit code").disabled).toBe(true);
    expect(document.activeElement).not.toBe(input("Six-digit code"));
    await act(async () => finishRefresh());
    expect(document.activeElement).toBe(input("Six-digit code"));

    // Unrelated busy cycles must not steal focus from someone reading/editing.
    input("Email address").focus();
    await act(async () => setBusy(true));
    await act(async () => setBusy(false));
    expect(document.activeElement).not.toBe(input("Six-digit code"));

    const resendLabel = resumeSetup ? "Send another code" : sendLabel;
    await act(async () => vi.advanceTimersByTime(60_000));
    await click(resendLabel);
    expect(document.activeElement).toBe(input("Six-digit code"));
    input("Email address").focus();
    respond = () =>
      Response.json({ error: "Test send failure" }, { status: 503 });
    await act(async () => vi.advanceTimersByTime(60_000));
    await click(resendLabel);
    expect(errors).toHaveLength(1);
    expect(document.activeElement).not.toBe(input("Six-digit code"));
  },
);

it("counts down a server send limit, keeps verification available, and recovers after sleep without sending", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  respond = (url) =>
    url.endsWith("send-verification-otp")
      ? Response.json(
          { message: "Too many requests" },
          { status: 429, headers: { "Retry-After": "339" } },
        )
      : Response.json({ ok: true });
  await mount(
    createElement(Login, {
      info: info(true),
      busy: false,
      run: action(),
      after: () => {},
      standalone: true,
    }),
  );
  await enter("Email", "client@example.test");
  await click("Send code");
  expect(button("Try again in 5:39").disabled).toBe(true);
  expect(errors[0]).toMatchObject({
    message: "Please wait before requesting another code.",
    status: 429,
  });
  await click("Try again in 5:39");
  expect(requests).toHaveLength(1);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(button("Try again in 5:38").disabled).toBe(true);
  await enter("6-digit code", "123456");
  expect(button("Sign in").disabled).toBe(false);
  await submit();
  expect(requests).toHaveLength(2);
  vi.setSystemTime(Date.now() + 600_000);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(button("Send code").disabled).toBe(false);
  expect(requests).toHaveLength(2);
});

it("pauses repeat sends after success without blocking sign-in or automatically resending", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  await mount(
    createElement(Login, {
      info: info(true),
      busy: false,
      run: action(),
      after: () => {},
      standalone: true,
    }),
  );
  await enter("Email", "client@example.test");
  await click("Send code");
  expect(button("Try again in 1:00").disabled).toBe(true);
  await enter("6-digit code", "123456");
  expect(button("Sign in").disabled).toBe(false);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(button("Resend code").disabled).toBe(false);
  expect(requests).toHaveLength(1);
});

it("keeps limits with the normalized email and separates send from verify limits", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  respond = () =>
    Response.json(
      { message: "Wait" },
      { status: 429, headers: { "Retry-After": "120" } },
    );
  await mount(
    createElement(Login, {
      info: info(true),
      busy: false,
      run: action(),
      after: () => {},
      standalone: true,
    }),
  );
  await enter("Email", "client@example.test");
  await enter("6-digit code", "123456");
  await submit();
  expect(button("Try again in 2:00").disabled).toBe(true);
  expect(button("Send code").disabled).toBe(false);
  await submit(); // Even a direct form submission cannot call the API again.
  expect(requests).toHaveLength(1);
  await enter("Email", "another@example.test");
  expect(button("Sign in").disabled).toBe(false);
  await enter("Email", "CLIENT@example.test");
  expect(button("Try again in 2:00").disabled).toBe(true);
});

it.each([undefined, "invalid"])(
  "uses a brief pause when Retry-After is missing or invalid (%s)",
  async (header) => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    respond = () =>
      Response.json(
        {},
        { status: 429, headers: header ? { "Retry-After": header } : {} },
      );
    await mount(
      createElement(Login, {
        info: info(true),
        busy: false,
        run: action(),
        after: () => {},
        resumeSetup: true,
      }),
    );
    await enter("Email address", "owner@example.test");
    await click("Send sign-in code");
    expect(button("Try again in 1:00").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(button("Send sign-in code").disabled).toBe(false);
    expect(requests).toHaveLength(1);
  },
);

it("locks guided setup fields during requests and focuses codes only after successful sends finish", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  let finishSend!: (response: Response) => void;
  const sending = new Promise<Response>((resolve) => {
    finishSend = resolve;
  });
  let finishRefresh!: () => void;
  const refreshing = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  let setBusy!: (value: boolean) => void;
  function Harness() {
    const [busy, updateBusy] = useState(false);
    useEffect(() => {
      setBusy = updateBusy;
    }, []);
    return createElement(GuidedClaim, {
      busy,
      after: () => {},
      run: async (work) => {
        updateBusy(true);
        try {
          await work();
          await refreshing;
        } catch (error) {
          errors.push(error);
        } finally {
          updateBusy(false);
        }
      },
    });
  }
  await mount(createElement(Harness));
  await enter("Your name", "Test owner");
  await enter("Your email", "owner@example.test");
  respond = () => sending;
  await submit();
  expect(input("Your name").disabled).toBe(true);
  expect(input("Your email").disabled).toBe(true);
  expect(body(0)).toEqual({ email: "owner@example.test", type: "sign-in" });
  await act(async () => finishSend(Response.json({ ok: true })));
  expect(input("Six-digit email code").disabled).toBe(true);
  expect(document.activeElement).not.toBe(input("Six-digit email code"));
  await act(async () => finishRefresh());
  expect(input("Your email").value).toBe("owner@example.test");
  expect(input("Your email").readOnly).toBe(true);
  expect(document.activeElement).toBe(input("Six-digit email code"));
  input("Your name").focus();
  await act(async () => setBusy(true));
  await act(async () => setBusy(false));
  expect(document.activeElement).not.toBe(input("Six-digit email code"));
  respond = () => Response.json({ ok: true });
  await act(async () => vi.advanceTimersByTime(60_000));
  await click("Send a new code");
  expect(document.activeElement).toBe(input("Six-digit email code"));
  input("Your name").focus();
  respond = () =>
    Response.json({ error: "Test send failure" }, { status: 503 });
  await act(async () => vi.advanceTimersByTime(60_000));
  await click("Send a new code");
  expect(errors).toHaveLength(1);
  expect(document.activeElement).not.toBe(input("Six-digit email code"));
  expect(requests).toHaveLength(3);
});

it("gives guided setup the same countdown, including verification limits", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  await mount(
    createElement(GuidedClaim, { busy: false, run: action(), after: () => {} }),
  );
  await enter("Your name", "Test owner");
  await enter("Your email", "owner@example.test");
  respond = () =>
    Response.json({}, { status: 429, headers: { "Retry-After": "90" } });
  await submit();
  expect(button("Try again in 1:30").disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(90_000));
  respond = () => Response.json({ ok: true });
  await submit();
  expect(button("Try again in 1:00").disabled).toBe(true);
  await enter("Six-digit email code", "123456");
  respond = () =>
    Response.json({}, { status: 429, headers: { "Retry-After": "120" } });
  await submit();
  expect(button("Try again in 2:00").disabled).toBe(true);
  expect(requests).toHaveLength(3);
  expect(requests.some(({ url }) => url === "/api/setup/owner")).toBe(false);
});

it("keeps ordinary sign-in separate from owner creation and preserves the requested Google destination", async () => {
  window.history.replaceState(null, "", "/app/settings/google");
  const after = vi.fn();
  await mount(
    createElement(Login, {
      info: info(true),
      busy: false,
      run: action(),
      after,
      standalone: true,
    }),
  );
  await enter("Email", "client@example.test");
  await enter("6-digit code", "123456");
  await submit();
  expect(requests.map(({ url }) => url)).toEqual([
    "/api/auth/sign-in/email-otp",
  ]);
  expect(after).toHaveBeenCalledOnce();
  respond = () =>
    Response.json({ url: "https://unexpected.example.test/sign-in" });
  await click("Continue with Google");
  expect(body(1)).toEqual({
    provider: "google",
    callbackURL: "/app/settings/google",
    errorCallbackURL: "/login",
  });
  expect(String(errors[0])).toContain("Unexpected Google sign-in address");
  expect(window.location.pathname).toBe("/app/settings/google");
});

it("retains identity after a rejected save and advances only after a successful save and refresh", async () => {
  const after = vi.fn(),
    refresh = vi.fn(async () => {});
  await mount(
    createElement(Identity, {
      state: state(),
      busy: false,
      run: action(refresh),
      onContinue: after,
    }),
  );
  await enter("Your name", "New sitter name");
  await enter("Your email", "new-owner@example.test");
  expect(container.querySelectorAll("input")).toHaveLength(2);
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(container.querySelector("details")).toBeNull();
  respond = () => Response.json({ error: "Try again" }, { status: 503 });
  await submit();
  expect(input("Your name").value).toBe("New sitter name");
  expect(after).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  respond = () => Response.json({ ok: true });
  await submit();
  expect(body(1)).toEqual({
    name: "New sitter name",
    email: "new-owner@example.test",
  });
  expect(after).toHaveBeenCalledOnce();
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
    after.mock.invocationCallOrder[0],
  );
});

it("saves identity and continues without choosing a setup password", async () => {
  const after = vi.fn();
  await mount(
    createElement(Identity, {
      state: { ...state(), setupPasswordSet: false },
      busy: false,
      run: action(),
      onContinue: after,
    }),
  );
  expect(container.querySelectorAll("input")).toHaveLength(2);
  expect(container.querySelector('input[type="password"]')).toBeNull();
  await submit();
  expect(errors).toHaveLength(0);
  expect(body(0)).toEqual({
    name: "Test sitter",
    email: "owner@example.test",
  });
  expect(after).toHaveBeenCalledOnce();
});

it("keeps identity editing independent of the installer's password setting", async () => {
  const props = { busy: false, run: action() };
  const root = await mount(
    createElement(Identity, {
      ...props,
      state: { ...state(), setupPasswordSet: false },
    }),
  );
  expect(container.querySelector('input[type="password"]')).toBeNull();
  // A newer server state can arrive after another authorized setup session saves.
  await act(async () =>
    root.render(createElement(Identity, { ...props, state: state() })),
  );
  expect(container.querySelectorAll("input")).toHaveLength(2);
  await submit();
  expect(errors).toHaveLength(0);
  expect(body(0)).toEqual({ name: "Test sitter", email: "owner@example.test" });
});

it.each([
  {
    component: EmailSettings,
    label: "Resend API key",
    target: "email",
    secret: "apiKey",
  },
  {
    component: GoogleSettings,
    label: "Google client secret",
    target: "google",
    secret: "clientSecret",
  },
] as const)(
  "keeps $target credential drafts on failure and sends only writable, versioned provider fields",
  async ({ component, label, target, secret }) => {
    await mount(
      createElement(component, {
        state: state(true),
        busy: false,
        run: action(),
      }),
    );
    expect(requests).toHaveLength(0);
    await submit();
    expect(body(0)).toEqual({
      version: 3,
      email: {
        ...emptyProviders.email,
        provider: "resend",
        from: "hello@example.test",
      },
      google: {
        ...emptyProviders.google,
        enabled: true,
        clientId: "test-client",
      },
    });
    await enter(label, "synthetic-unsaved-credential");
    respond = () => Response.json({ error: "Try again" }, { status: 503 });
    await submit();
    expect(input(label).value).toBe("synthetic-unsaved-credential");
    expect(body(1)[target][secret]).toBe("synthetic-unsaved-credential");
    expect(
      requests.every(
        ({ url, init }) =>
          url === "/api/setup/providers" && init?.method === "PUT",
      ),
    ).toBe(true);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  },
);

it.each(themePresets)(
  "previews and saves both $name colors together",
  async ({ name, primaryColor, accentColor }) => {
    const preview = vi.fn();
    await mount(
      createElement(Appearance, {
        state: state(true),
        busy: false,
        run: action(),
        preview,
      }),
    );
    await click(name);
    expect(input("Primary color").value).toBe(primaryColor);
    expect(input("Accent color").value).toBe(accentColor);
    expect(preview).toHaveBeenLastCalledWith({
      ...state(true).branding,
      primaryColor,
      accentColor,
    });
    expect(button(name).getAttribute("aria-pressed")).toBe("true");
    const swatches = button(name).querySelectorAll('[aria-hidden="true"] span');
    expect(swatches).toHaveLength(2);
    expect((swatches[0] as HTMLElement).style.backgroundColor).not.toBe(
      (swatches[1] as HTMLElement).style.backgroundColor,
    );
    respond = () => Response.json({ version: 2 });
    await submit();
    expect(errors).toHaveLength(0);
    expect(requests[0].url).toBe("/api/setup/appearance");
    expect(body(0)).toMatchObject({ primaryColor, accentColor });
  },
);

it("applies the saved accent throughout the layout and restores it after discarding a preview", async () => {
  const current = state();
  current.branding = {
    ...current.branding,
    primaryColor: "#215b79",
    accentColor: "#eddbba",
  };
  window.history.replaceState(null, "", "/setup/business");
  installation(current);
  const response = respond;
  respond = (url, init) =>
    url === "/api/installation"
      ? Response.json({ ...info(), branding: current.branding })
      : response(url, init);
  await mount(createElement(App));
  const theme = () =>
    container.querySelector<HTMLElement>("[data-boopity-theme]")!;
  const saved = brandingVariables(current.branding);
  expect(theme().style.getPropertyValue("--secondary")).toBe(
    saved["--secondary"],
  );
  expect(container.querySelector("header")!.className).toContain(
    "border-t-accent",
  );
  await click("Forest & sage");
  expect(theme().style.getPropertyValue("--primary")).toBe("#285943");
  expect(theme().style.getPropertyValue("--accent")).toBe("#c5dec8");
  expect(theme().style.getPropertyValue("--secondary")).not.toBe(
    saved["--secondary"],
  );
  await click("Discard preview");
  for (const key of [
    "--primary",
    "--accent",
    "--secondary",
    "--brand-soft",
    "--brand-soft-hover",
  ])
    expect(theme().style.getPropertyValue(key)).toBe(saved[key]);
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("retains the appearance draft and advanced version when a queued logo save needs retry", async () => {
  const preview = vi.fn(),
    after = vi.fn();
  const current = state();
  current.branding.logoUrl = "/api/installation/logo?v=1";
  await mount(
    createElement(Appearance, {
      state: current,
      busy: false,
      run: action(),
      preview,
      onContinue: after,
    }),
  );
  await enter("Business name", "Draft business name");
  await click("Remove logo");
  expect(requests).toHaveLength(0);
  respond = (url) =>
    url.endsWith("appearance")
      ? Response.json({ version: 2 })
      : Response.json({ error: "Try logo again" }, { status: 503 });
  await submit();
  expect(body(0).version).toBe(1);
  expect(body(1)).toEqual({ version: 2 });
  expect(input("Business name").value).toBe("Draft business name");
  expect(container.textContent).toContain("Logo will be removed.");
  expect(after).not.toHaveBeenCalled();
  respond = (url) =>
    Response.json({ version: url.endsWith("appearance") ? 3 : 4 });
  await submit();
  expect(body(2).version).toBe(2);
  expect(body(3)).toEqual({ version: 3 });
  expect(preview).toHaveBeenLastCalledWith(null);
  expect(after).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "uses saved progress for the setup welcome (started: %s), not a remembered browser step",
  async (started) => {
    window.history.replaceState(null, "", "/setup");
    window.localStorage.setItem("boopity.setup.step", "email");
    installation(null, false, started);
    await mount(createElement(App));
    expect(container.querySelector("h1")?.textContent).toBe(
      started ? "Continue setting up Boopity" : "Set up Boopity",
    );
    expect(container.textContent).toContain(
      started ? "Welcome back!" : "Welcome to Boopity!",
    );
    expect(button(started ? "Continue setup" : "Start setup").disabled).toBe(
      true,
    );
    expect(input("Setup password").type).toBe("password");
    expect(container.querySelector("main")?.className).toContain(
      "items-center justify-center",
    );
    expect(container.querySelector("footer")?.className).toContain(
      "justify-center",
    );
    expect(container.querySelector("h1")?.parentElement?.className).toContain(
      "w-full max-w-md text-center",
    );
    expect(container.querySelector("header")?.textContent).not.toContain(
      "Self-hosted",
    );
    expect(container.querySelector("footer")?.textContent).toContain(
      "Powered by Boopity",
    );
    expect(requests.map(({ url }) => url)).toEqual([
      "/api/installation",
      "/api/setup/entry",
      "/api/setup/status",
    ]);
    expect(
      requests.every(({ init }) => !init?.method || init.method === "GET"),
    ).toBe(true);
  },
);

it("scrubs a private setup link before bootstrap requests and never unlocks without confirmation", async () => {
  const token = "a".repeat(43);
  window.history.replaceState(null, "", `/setup#setup=${token}`);
  installation(null);
  const handler = respond;
  respond = (url, init) => {
    expect(window.location.hash).toBe("");
    if (url === "/api/setup/unlock") return Response.json({ ok: true });
    return handler(url, init);
  };
  await mount(createElement(App));
  expect(container.textContent).not.toContain(token);
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
  expect(window.localStorage.getItem("boopity.setup.step")).toBeNull();
  await click("Start setup");
  const unlock = requests.filter(({ url }) => url === "/api/setup/unlock");
  expect(unlock).toHaveLength(1);
  expect(JSON.parse(unlock[0].init!.body as string)).toEqual({
    token,
    kind: "setup",
  });
});

it("keeps setup password help and validation feedback in the centered layout", async () => {
  window.history.replaceState(null, "", "/setup");
  installation(null);
  const handler = respond;
  respond = (url, init) =>
    url === "/api/setup/password/unlock"
      ? Response.json({ error: "Check your setup password." }, { status: 401 })
      : handler(url, init);
  await mount(createElement(App));
  await enter("Setup password", "synthetic-incorrect-password");
  await submit();
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Check your setup password.");
  expect(alert?.className).toContain("w-full max-w-md break-words");
  await click("Help me find my setup password");
  expect(window.location.pathname).toBe("/setup/password-help");
  expect(container.textContent).toContain("Let’s find your password");
  expect(container.textContent).not.toMatch(
    /hosting account|BOOPITY_SETUP_PASSWORD|restart/,
  );
  expect(container.querySelector("main")?.className).toContain(
    "items-center justify-center",
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const callsBeforeHelp = requests.length;
  await click("I still can’t find it");
  expect(window.location.pathname).toBe("/setup/hosting-help");
  expect(container.textContent).toContain("Reset through your hosting account");
  expect(container.querySelectorAll("ol li")).toHaveLength(3);
  expect(container.querySelector("form")).toBeNull();
  expect(requests).toHaveLength(callsBeforeHelp);
  await act(async () => {
    window.history.replaceState(null, "", "/setup/password-help");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(container.textContent).toContain("Let’s find your password");
  await click("Back to setup password");
  expect(button("Start setup").disabled).toBe(true);
  expect(container.querySelector("main")?.className).toContain(
    "items-center justify-center",
  );
});

it.each(["/setup/password-help", "/setup/hosting-help"])(
  "opens %s directly without offering email recovery or unlocking setup",
  async (path) => {
    window.history.replaceState(null, "", path);
    installation(null);
    await mount(createElement(App));
    expect(window.location.pathname).toBe(path);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toMatch(
      /Send sign-in code|Email me a sign-in code/,
    );
    expect(container.textContent).toContain(
      path.endsWith("password-help")
        ? "Let’s find your password"
        : "Reset through your hosting account",
    );
    expect(
      requests.every(({ init }) => !init?.method || init.method === "GET"),
    ).toBe(true);
    await click("Back to setup password");
    expect(window.location.pathname).toBe("/setup");
    expect(button("Start setup").disabled).toBe(true);
  },
);

it("resumes with an explicitly requested email code when the server allows recovery", async () => {
  window.history.replaceState(null, "", "/setup");
  installation(null, false, true);
  const handler = respond;
  let unlocked = false;
  respond = (url, init) => {
    if (url === "/api/setup/entry")
      return Response.json({ mode: "password-email", started: true });
    if (url === "/api/auth/email-otp/send-verification-otp")
      return Response.json({ ok: true });
    if (url === "/api/auth/sign-in/email-otp") {
      unlocked = true;
      return Response.json({ ok: true });
    }
    if (url === "/api/setup/status" && unlocked) return Response.json(state());
    return handler(url, init);
  };
  await mount(createElement(App));
  expect(container.textContent).not.toContain("Help me find my setup password");
  await click("Email me a sign-in code");
  expect(window.location.pathname).toBe("/setup/password-help");
  expect(container.textContent).not.toContain("BOOPITY_SETUP_PASSWORD");
  expect(button("Send sign-in code").disabled).toBe(true);
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
  await enter("Email address", "owner@example.test");
  await click("Send sign-in code");
  const sends = requests.filter(({ url }) =>
    url.endsWith("/send-verification-otp"),
  );
  expect(sends).toHaveLength(1);
  expect(JSON.parse(sends[0].init!.body as string)).toEqual({
    email: "owner@example.test",
    type: "sign-in",
  });
  await enter("Six-digit code", "123456");
  await submit();
  expect(unlocked).toBe(true);
  expect(container.querySelector('[aria-label="Setup steps"]')).not.toBeNull();
  expect(
    requests.some(
      ({ url }) =>
        url === "/api/setup/owner" || url === "/api/setup/password/unlock",
    ),
  ).toBe(false);
});

it("keeps direct settings URLs and browser navigation outside the setup wizard", async () => {
  window.history.replaceState(null, "", "/app/settings/email");
  installation(state(true), true);
  const root = await mount(createElement(App));
  expect(window.location.pathname).toBe("/app/settings/email");
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  expect(container.textContent).toContain("Test email delivery");
  expect(container.textContent).not.toContain("Save and continue");
  await enter("Resend API key", "synthetic-unsaved-credential");
  await act(async () => root.render(createElement(App)));
  expect(input("Resend API key").value).toBe("synthetic-unsaved-credential");
  await click("Google sign-in");
  expect(window.location.pathname).toBe("/app/settings/google");
  expect(input("Google client ID").value).toBe("test-client");
  await act(async () => {
    window.history.replaceState(null, "", "/app/settings/email");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(container.querySelector("h2")?.textContent).toBe("Email delivery");
  expect(input("Resend API key").value).toBe("");
  expect(container.querySelector('[aria-label="Setup steps"]')).toBeNull();
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("advances the mounted wizard after saving, keeps Back URLs and focuses the step heading", async () => {
  window.history.replaceState(null, "", "/setup/account");
  installation(state());
  const handler = respond;
  respond = (url, init) =>
    url === "/api/setup/identity"
      ? Response.json({ ok: true })
      : handler(url, init);
  await mount(createElement(App));
  expect(container.querySelector("h1")?.textContent).toBe("Your account");
  expect(container.querySelector("main")?.className).not.toContain(
    "justify-center",
  );
  expect(container.querySelector("footer")?.className).toContain("justify-end");
  await click("Save and continue");
  expect(window.location.pathname).toBe("/setup/email");
  expect(document.activeElement?.textContent).toBe("Email delivery");
  expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(
    1,
  );
  await click("Back");
  expect(window.location.pathname).toBe("/setup/account");
  expect(container.querySelector("h1")?.textContent).toBe("Your account");
});

it("does not let recovery access finish setup even with every readiness check satisfied", async () => {
  const current = state(true);
  current.actor = "recovery";
  window.history.replaceState(null, "", "/setup/recovery/review");
  installation(current, true);
  await mount(createElement(App));
  expect(container.textContent).toContain("Recovery access");
  expect(button("Finish setup").disabled).toBe(true);
  expect(container.textContent).toContain(
    "The verified owner must sign in to finish setup.",
  );
  expect(
    requests.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
});

it("keeps payment settings recovery inside the settings shell without replaying a credential save", async () => {
  const payment: PaymentSettingsData = {
    settings: { mode: "test", version: 1 },
    integrations: [
      {
        id: "",
        mode: "test",
        provider: "stripe",
        version: 0,
        enabled: false,
        managed: false,
        keyPresent: false,
        webhookSecretPresent: false,
        verified: false,
        webhookVerified: false,
        accountId: null,
        webhookUrl: "https://example.test/api/payments/webhooks/stripe/test",
        apiVersion: "test-version",
        capabilities: { checkout: true, refunds: true, expire: true },
      },
    ],
  };
  window.history.replaceState(null, "", "/app/settings/payments");
  installation(state(true), true);
  const handler = respond;
  let loads = 0;
  respond = (url, init) => {
    if (url === "/api/business/payments/integrations") {
      loads++;
      return loads === 2
        ? Response.json({ error: "Temporary outage" }, { status: 503 })
        : Response.json(payment);
    }
    if (
      url === "/api/business/payments/integrations/stripe/test" &&
      init?.method === "PUT"
    )
      return Response.json({ ok: true });
    return handler(url, init);
  };
  await mount(createElement(App));
  expect(container.querySelector("h1")?.textContent).toBe("Settings");
  await enter("Stripe test restricted API key", "synthetic-new-credential");
  await click("Save Stripe credentials");
  expect(container.textContent).toContain("Your change was saved");
  expect(input("Stripe test restricted API key").value).toBe("");
  expect(button("Save Stripe credentials").disabled).toBe(true);
  await click("Retry payment setup");
  expect(button("Save Stripe credentials").disabled).toBe(false);
  expect(
    requests
      .filter(({ url }) => url.startsWith("/api/business/payments"))
      .map(({ init }) => init?.method),
  ).toEqual(["GET", "PUT", "GET", "GET"]);
  expect(
    requests.filter(({ init }) => init?.method && init.method !== "GET"),
  ).toHaveLength(1);
  expect(window.location.pathname).toBe("/app/settings/payments");
});
