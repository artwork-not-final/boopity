// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FirstBookingGuide } from "../../src/client/features/bookings/FirstBookingChecklist";
import { BookingPayments } from "../../src/client/features/payments/BookingPayments";
import { BookingCalendar } from "../../src/client/features/bookings/BookingCalendar";
import {
  navigateLocal,
  useWorkspaceLocation,
  type WorkspaceLocation,
} from "../../src/client/lib/navigation/workspace-location";

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/bookings");
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function root() {
  const mounted = createRoot(document.createElement("div"));
  roots.push(mounted);
  return mounted;
}

it.each(["checklist", "payments"] as const)(
  "reports %s load failures to the latest callback without refetching",
  async (page) => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const first = vi.fn(async () => {}),
      latest = vi.fn(async () => {});
    const mounted = root();
    const render = async (onError: (error: unknown) => Promise<void>) => {
      await act(async () =>
        mounted.render(
          page === "checklist"
            ? createElement(FirstBookingGuide, {
                ownerEmail: "owner@example.test",
                revision: 0,
                busy: false,
                onError,
                onChoose: () => {},
                onPayments: () => {},
              })
            : createElement(BookingPayments, {
                bookingId: "synthetic",
                owner: true,
                busy: false,
                run: async () => {},
                onError,
              }),
        ),
      );
    };
    await render(first);
    await render(latest);
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () =>
      finish(Response.json({ error: "Please sign in." }, { status: 401 })),
    );
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("reloads the calendar only when its query changes, not on ordinary rerenders", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      bookings: [],
      pagination: { offset: 0, limit: 50, hasMore: false },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const mounted = root();
  const render = async (anchor: string, busy: boolean) => {
    await act(async () =>
      mounted.render(
        createElement(BookingCalendar, {
          view: "week",
          anchor,
          busy,
          owner: true,
          timeZone: "UTC",
          status: "all",
          search: "",
          revision: 0,
          onAnchor: () => {},
          onSelect: () => {},
        }),
      ),
    );
  };
  await render("2026-09-13", false);
  await render("2026-09-13", true);
  await render("2026-09-13", false);
  expect(fetch).toHaveBeenCalledOnce();
  await render("2026-09-20", false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps the parsed workspace location stable until navigation changes it", async () => {
  const locations: WorkspaceLocation[] = [];
  function Probe({ label }: { label: string }) {
    const location = useWorkspaceLocation();
    useEffect(() => {
      locations.push(location);
    }, [location]);
    return createElement("p", null, label);
  }
  const mounted = root();
  await act(async () =>
    mounted.render(createElement(Probe, { label: "first" })),
  );
  await act(async () =>
    mounted.render(createElement(Probe, { label: "second" })),
  );
  expect(locations).toHaveLength(1);
  await act(async () => navigateLocal("/app/clients"));
  expect(locations).toHaveLength(2);
  expect(locations[1].section).toBe("clients");
});
