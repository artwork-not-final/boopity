import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasWorkspaceEditor,
  watchWorkspaceResume,
} from "../src/client/workspace-refresh";

const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function fixture(read = vi.fn(async (_signal: AbortSignal) => "latest")) {
  const windowTarget = new EventTarget(),
    documentTarget = new EventTarget();
  const state = {
    visible: true,
    online: true,
    editing: false,
    busy: false,
    key: "bookings:1",
    time: 0,
  };
  const apply = vi.fn(),
    onError = vi.fn();
  const stop = watchWorkspaceResume({
    windowTarget,
    documentTarget,
    isVisible: () => state.visible,
    isOnline: () => state.online,
    canRefresh: () => !state.editing && !state.busy,
    getKey: () => state.key,
    read,
    apply,
    onError,
    now: () => state.time,
  });
  disposals.push(stop);
  const event = (name = "focus") =>
    (name === "visibilitychange" ? documentTarget : windowTarget).dispatchEvent(
      new Event(name),
    );
  return { state, read, apply, onError, stop, event };
}
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, read: vi.fn((_signal: AbortSignal) => promise) };
}

describe("automatic workspace updates", () => {
  it.each(["focus", "visibilitychange", "online", "pageshow"])(
    "refreshes browsing data on %s, without an initial duplicate request",
    async (name) => {
      const f = fixture();
      expect(f.read).not.toHaveBeenCalled();
      f.event(name);
      await settle();
      expect(f.apply).toHaveBeenCalledWith("latest");
    },
  );
  it.each(["hidden", "offline", "editor", "saving"])(
    "does not start a refresh while %s",
    async (condition) => {
      const f = fixture();
      if (condition === "hidden") f.state.visible = false;
      if (condition === "offline") f.state.online = false;
      if (condition === "editor") f.state.editing = true;
      if (condition === "saving") f.state.busy = true;
      f.event();
      f.event("visibilitychange");
      f.event("online");
      await settle();
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it("coalesces browser return events and never overlaps requests", async () => {
    const pending = deferred(),
      f = fixture(pending.read);
    f.event();
    f.event("visibilitychange");
    f.event("online");
    expect(f.read).toHaveBeenCalledTimes(1);
    pending.resolve("latest");
    await settle();
    f.event();
    expect(f.read).toHaveBeenCalledTimes(1);
    f.state.time = 30_000;
    f.event();
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it.each(["editor", "saving", "navigation", "save completed", "hidden"])(
    "ignores a late response after %s",
    async (change) => {
      const pending = deferred(),
        f = fixture(pending.read);
      f.event();
      if (change === "editor") f.state.editing = true;
      if (change === "saving") f.state.busy = true;
      if (change === "navigation") f.state.key = "clients:1";
      if (change === "save completed") f.state.key = "bookings:2";
      if (change === "hidden") f.state.visible = false;
      pending.resolve("old snapshot");
      await settle();
      expect(f.apply).not.toHaveBeenCalled();
    },
  );
  it("allows a later return after editing without consuming the cooldown", async () => {
    const f = fixture();
    f.state.editing = true;
    f.event();
    f.state.editing = false;
    f.event();
    await settle();
    expect(f.apply).toHaveBeenCalledWith("latest");
  });
  it("can retry immediately on reconnect after a failed request", async () => {
    const read = vi.fn(async (_signal: AbortSignal) => "latest");
    read.mockRejectedValueOnce(new Error("Offline"));
    const f = fixture(read);
    f.event();
    await settle();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.apply).not.toHaveBeenCalled();
    f.event("online");
    await settle();
    expect(f.apply).toHaveBeenCalledWith("latest");
  });
  it("does not reset an editor through a late error handler", async () => {
    const pending = deferred(),
      f = fixture(pending.read);
    f.event();
    f.state.editing = true;
    pending.reject(new Error("Request failed"));
    await settle();
    expect(f.onError).not.toHaveBeenCalled();
  });
  it("aborts work and removes all listeners on unmount", async () => {
    const pending = deferred(),
      f = fixture(pending.read);
    f.event();
    f.stop();
    expect(f.read.mock.calls[0][0].aborted).toBe(true);
    pending.resolve("stale");
    await settle();
    f.state.time = 30_000;
    for (const name of ["focus", "online", "pageshow", "visibilitychange"])
      f.event(name);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.apply).not.toHaveBeenCalled();
  });
});

describe("editor protection", () => {
  function root({
    editor = false,
    focusedControl = false,
    containsFocus = true,
  } = {}) {
    return {
      querySelector: vi.fn((selector: string) => {
        expect(selector).toBe("form, [data-refresh-paused]");
        return editor ? {} : null;
      }),
      contains: () => containsFocus,
      ownerDocument: { activeElement: { matches: () => focusedControl } },
    } as unknown as HTMLElement;
  }
  it("protects all mounted forms, including hidden tab drafts, and marked detail views", () => {
    expect(hasWorkspaceEditor(root({ editor: true }))).toBe(true);
  });
  it("protects typing in a search or filter outside a form", () => {
    expect(hasWorkspaceEditor(root({ focusedControl: true }))).toBe(true);
  });
  it("allows ordinary browsing but not an unmounted workspace", () => {
    expect(hasWorkspaceEditor(root())).toBe(false);
    expect(
      hasWorkspaceEditor(root({ focusedControl: true, containsFocus: false })),
    ).toBe(false);
    expect(hasWorkspaceEditor(null)).toBe(true);
  });
});
