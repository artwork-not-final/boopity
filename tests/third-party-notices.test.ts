import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Standalone offline build tool has no runtime dependencies.
import { browserNotices, packageNotices } from "../scripts/build-notices.mjs";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "boopity-notices-"));
  roots.push(root);
  writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "Vendored UI notices\n");
  for (const name of ["tailwindcss", "tw-animate-css"]) {
    const path = join(root, "node_modules", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({ name, version: "1.0.0", license: "MIT" }),
    );
    writeFileSync(join(path, "LICENSE"), `License text for ${name}`);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("distribution notices", () => {
  it("retains JS, CSS and vendored notices without silently dropping packages", () => {
    const result = browserNotices(
      [
        {
          name: "example",
          version: "1.0.0",
          identifier: "MIT",
          text: "Original copyright and license",
        },
      ],
      fixture(),
    );
    for (const text of [
      "example@1.0.0",
      "Original copyright and license",
      "License text for tailwindcss",
      "License text for tw-animate-css",
      "Vendored UI notices",
    ])
      expect(result).toContain(text);
  });
  it("fails on missing inventories or unknown missing-license versions", () => {
    const root = fixture();
    expect(() => browserNotices([], root)).toThrow("Missing browser inventory");
    expect(() =>
      browserNotices(
        [{ name: "react-remove-scroll-bar", version: "99.0.0" }],
        root,
      ),
    ).toThrow("Missing license text");
    const path = join(root, "node_modules", "unknown");
    mkdirSync(path);
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({ name: "unknown", version: "1" }),
    );
    expect(() => packageNotices(root, path)).toThrow("Missing license text");
  });
  it("uses the explicit supplement only for the reviewed package version", () => {
    const root = fixture();
    mkdirSync(join(root, "licenses"));
    writeFileSync(
      join(root, "licenses", "react-remove-scroll-bar.txt"),
      "Reviewed upstream MIT notice",
    );
    expect(
      browserNotices(
        [
          {
            name: "react-remove-scroll-bar",
            version: "2.3.8",
            identifier: "MIT",
          },
        ],
        root,
      ),
    ).toContain("Reviewed upstream MIT notice");
  });
  it("keeps complete GPL and LGPL texts distinct from the build-script license", () => {
    const text = (name: string) =>
      readFileSync(new URL(`../licenses/${name}`, import.meta.url), "utf8");
    expect(text("GPL-3.0.txt")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(text("sharp-libvips-LGPL.txt")).toContain(
      "GNU LESSER GENERAL PUBLIC LICENSE",
    );
    expect(text("sharp-libvips-build.txt")).toContain("Apache License");
  });
});
