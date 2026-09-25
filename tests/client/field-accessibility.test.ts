// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Field } from "../../src/client/components/forms/Field";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

for (const kind of ["default", "emphasized", "plain"] as const) {
  it.each([undefined, "Keep this link private."])(
    `${kind} fields preserve descriptions and connect optional help: %s`,
    async (hint) => {
      const control = (id?: string) =>
        createElement("input", { id, "aria-describedby": "existing-help" });
      await act(async () =>
        root.render(
          createElement(
            "div",
            null,
            createElement("p", { id: "existing-help" }, "Existing help"),
            createElement(Field, {
              label: "Test field",
              hint,
              appearance: kind,
              children: kind === "emphasized" ? control() : control,
            }),
          ),
        ),
      );
      const input = container.querySelector("input")!;
      expect(container.querySelector("label")!.htmlFor).toBe(input.id);
      const descriptions = input.getAttribute("aria-describedby")!.split(" ");
      expect(descriptions).toContain("existing-help");
      expect(descriptions).toHaveLength(hint ? 2 : 1);
      if (hint) {
        expect(
          descriptions.map((id) => document.getElementById(id)?.textContent),
        ).toContain(hint);
      }
    },
  );
}

it("preserves datalist identity while labeling the actual input", async () => {
  await act(async () =>
    root.render(
      createElement(Field, {
        label: "Time zone",
        appearance: "emphasized",
        children: [
          createElement("input", { key: "input", list: "zones" }),
          createElement(
            "datalist",
            { key: "choices", id: "zones" },
            createElement("option", { value: "Europe/London" }),
          ),
        ],
      }),
    ),
  );
  const input = container.querySelector("input")!;
  expect(container.querySelector("label")!.htmlFor).toBe(input.id);
  expect(container.querySelector("datalist")!.id).toBe(input.list!.id);
  expect(input.id).not.toBe("zones");
});
