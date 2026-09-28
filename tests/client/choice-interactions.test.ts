// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Choice } from "../../src/client/components/forms/Choice";

const options = [
  { value: "dog", label: "Dog" },
  { value: "bird", label: "Bird", disabled: true },
  { value: "cat", label: "Cat" },
];
let root: Root;
let container: HTMLDivElement;
let changed = vi.fn<(value: string) => void>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  // Radix defers returning focus until the closing popup has unmounted.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
async function mount(props: Partial<ComponentProps<typeof Choice>> = {}) {
  function Harness() {
    const [value, setValue] = useState("dog");
    return createElement(Choice, {
      "aria-label": "Species",
      searchLabel: "Find species",
      value,
      options,
      onValueChange: (next) => {
        changed(next);
        setValue(next);
      },
      ...props,
    });
  }
  await act(async () => root.render(createElement(Harness)));
}
function trigger() {
  return container.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
}
function search() {
  return document.querySelector<HTMLInputElement>("[cmdk-input]")!;
}
async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}
async function type(value: string) {
  await act(async () => {
    const input = search();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

it("opens a searchable choice with arrows, filters by label and selects with Enter", async () => {
  await mount({ searchable: true });
  trigger().focus();
  await key(trigger(), "ArrowDown");
  expect(document.activeElement).toBe(search());
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  await type("Cat");
  const activeId = search().getAttribute("aria-activedescendant")!;
  expect(document.getElementById(activeId)?.textContent).toBe("Cat");
  await key(search(), "Enter");
  expect(changed).toHaveBeenCalledExactlyOnceWith("cat");
  expect(trigger().textContent).toContain("Cat");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger());
});

it("moves through enabled choices with arrows and restores focus on Escape without selecting", async () => {
  await mount({ searchable: true });
  trigger().focus();
  await key(trigger(), "ArrowUp");
  await key(search(), "ArrowDown");
  expect(
    document.getElementById(search().getAttribute("aria-activedescendant")!)
      ?.textContent,
  ).toBe("Cat");
  await key(search(), "Escape");
  expect(changed).not.toHaveBeenCalled();
  expect(trigger().textContent).toContain("Dog");
  expect(document.activeElement).toBe(trigger());
});

it("does not select a disabled or missing match", async () => {
  await mount({ searchable: true });
  await key(trigger(), "ArrowDown");
  await type("Bird");
  expect(
    document.querySelector('[role="option"][aria-disabled="true"]')
      ?.textContent,
  ).toBe("Bird");
  await key(search(), "Enter");
  await type("No such species");
  expect(document.body.textContent).toContain("No matches found.");
  expect(search().getAttribute("aria-activedescendant")).toBeNull();
  await key(search(), "Enter");
  expect(changed).not.toHaveBeenCalled();
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
});

it("announces loading and prevents selection while remote results are pending", async () => {
  await mount({ searchable: true, loading: true, onSearchChange: vi.fn() });
  await key(trigger(), "ArrowDown");
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Loading…",
  );
  expect(
    document.querySelector('[role="listbox"]')?.getAttribute("aria-busy"),
  ).toBe("true");
  expect(search().getAttribute("aria-activedescendant")).toBeNull();
  await key(search(), "Enter");
  expect(changed).not.toHaveBeenCalled();
  await key(search(), "Escape");
  expect(document.activeElement).toBe(trigger());
});

it.each([false, true])(
  "keeps required errors associated with the visible choice (searchable=%s)",
  async (searchable) => {
    await mount({
      value: "",
      required: true,
      searchable,
      "aria-describedby": "species-help",
    });
    await act(async () =>
      container
        .querySelector("select")!
        .dispatchEvent(new Event("invalid", { cancelable: true })),
    );
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-invalid")).toBe("true");
    const descriptions = trigger().getAttribute("aria-describedby")!.split(" ");
    expect(descriptions).toContain("species-help");
    expect(document.getElementById(descriptions[1])?.textContent).toBe(
      "Choose an option.",
    );
    expect(document.querySelector('[role="alert"]')?.id).toBe(descriptions[1]);
  },
);

it.each([false, true])(
  "cannot open a disabled choice (searchable=%s)",
  async (searchable) => {
    await mount({ disabled: true, searchable });
    expect(trigger().disabled).toBe(true);
    await key(trigger(), "ArrowDown");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(changed).not.toHaveBeenCalled();
  },
);

it("supports arrows, Escape and Enter in a standard select, skipping disabled options", async () => {
  await mount();
  trigger().focus();
  await key(trigger(), "Enter");
  expect(document.activeElement?.textContent).toBe("Dog");
  await key(document.activeElement as HTMLElement, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Cat");
  await key(document.activeElement as HTMLElement, "Escape");
  expect(changed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger());
  await key(trigger(), "Enter");
  await key(document.activeElement as HTMLElement, "ArrowDown");
  await key(document.activeElement as HTMLElement, "Enter");
  expect(changed).toHaveBeenCalledExactlyOnceWith("cat");
  expect(document.activeElement).toBe(trigger());
});

it.each([false, true])(
  "keeps dropdown highlights inside the sitter's branded theme (searchable=%s)",
  async (searchable) => {
    container.setAttribute("data-boopity-theme", "");
    container.style.setProperty("--brand-soft-hover", "#e9eff2");
    await mount({ searchable });
    await key(trigger(), searchable ? "ArrowDown" : "Enter");
    const popup = document.querySelector('[data-slot="choice-popup"]')!;
    expect(popup.closest("[data-boopity-theme]")).toBe(container);
    const items = Array.from(popup.querySelectorAll('[role="option"]'));
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.classList).toContain(
        searchable
          ? "data-[selected=true]:bg-brand-soft-hover"
          : "data-[highlighted]:bg-brand-soft-hover",
      );
      expect(item.className).not.toContain(":bg-muted");
    }
    await key(
      searchable ? search() : (document.activeElement as HTMLElement),
      "Escape",
    );
    expect(changed).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "keeps one identified native control, raw submitted values and autofill inside forms (searchable=%s)",
  async (searchable) => {
    function Form() {
      const [value, setValue] = useState("");
      return createElement(
        "form",
        null,
        createElement("label", { htmlFor: "pet-species" }, "Species"),
        createElement(Choice, {
          id: "pet-species",
          name: "species",
          value,
          onValueChange: setValue,
          options,
          required: true,
          searchable,
        }),
      );
    }
    await act(async () => root.render(createElement(Form)));
    const form = container.querySelector("form")!;
    expect(form.querySelectorAll("select")).toHaveLength(1);
    const native = form.querySelector("select")!;
    expect(native.id).toBe("pet-species-native");
    expect(native.tabIndex).toBe(-1);
    expect(native.checkValidity()).toBe(false);
    expect(form.querySelector("label")!.htmlFor).toBe(trigger().id);

    // Browser autofill changes the native field; the visible control must follow.
    await act(async () => {
      native.value = "cat";
      native.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(trigger().textContent).toContain("Cat");
    expect(native.checkValidity()).toBe(true);
    expect(Array.from(new FormData(form).entries())).toEqual([
      ["species", "cat"],
    ]);
    expect(form.querySelectorAll("select")).toHaveLength(1);
  },
);
