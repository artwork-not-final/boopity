// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Field as InstallationField } from "../../src/client/components/forms/Field";
import { Field as WorkspaceField } from "../../src/client/components/forms/Field";

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

for (const kind of ["installation", "workspace"] as const) {
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
            kind === "installation"
              ? createElement(InstallationField, {
                  label: "Test field",
                  hint,
                  children: control(),
                })
              : createElement(WorkspaceField, {
                  label: "Test field",
                  hint,
                  children: control,
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
