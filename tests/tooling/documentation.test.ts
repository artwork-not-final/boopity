import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const markdownFiles = (directory: string): string[] =>
  readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? markdownFiles(path)
        : entry.name.endsWith(".md")
          ? [path]
          : [];
    },
  );

// The maintained guides use inline links and ATX headings. Code examples are
// deliberately excluded so shell comments and sample links are not references.
function prose(markdown: string) {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .filter((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = undefined;
        return false;
      }
      return !fence;
    })
    .join("\n");
}

function localLinks(markdown: string) {
  return [...prose(markdown).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target));
}

function headingIds(markdown: string) {
  const seen = new Set<string>();
  for (const [, heading] of prose(markdown).matchAll(
    /^#{1,6}\s+(.+?)\s*#*$/gm,
  )) {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    let slug = base;
    for (let suffix = 1; seen.has(slug); suffix++) slug = `${base}-${suffix}`;
    seen.add(slug);
  }
  return seen;
}

describe("documentation layout and links", () => {
  const rootDocs = readdirSync(root).filter((name) => name.endsWith(".md"));
  const guides = markdownFiles("docs");

  it("keeps entry points and policies at the root and indexes the longer guides", () => {
    expect(rootDocs.sort()).toEqual([
      "CONTRIBUTING.md",
      "README.md",
      "SECURITY.md",
      "SUPPORT.md",
      "THIRD-PARTY-NOTICES.md",
      "THIRD-PARTY-SOURCES.md",
    ]);
    const indexed = localLinks(read("docs/README.md")).map((target) =>
      resolve(root, "docs", target),
    );
    for (const file of guides.filter((path) => path !== "docs/README.md")) {
      expect(file).toMatch(
        /^docs\/(guides|development|releases)\/[a-z-]+\.md$/,
      );
      expect(indexed, file).toContain(resolve(root, file));
    }
    expect(localLinks(read("README.md"))).toContain("docs/README.md");
  });

  it("resolves relative documentation links and heading anchors with exact casing", () => {
    const errors: string[] = [];
    for (const file of [...rootDocs, ...guides, "licenses/README.md"]) {
      for (const link of localLinks(read(file))) {
        const [pathname, fragment] = link.split("#");
        const target = pathname
          ? resolve(root, dirname(file), decodeURIComponent(pathname))
          : resolve(root, file);
        const targetPath = relative(root, target);
        if (targetPath.startsWith("..") || !existsSync(target)) {
          errors.push(`${file}: missing local target ${link}`);
          continue;
        }
        let parent = root;
        for (const part of targetPath.split("/")) {
          if (!readdirSync(parent).includes(part))
            errors.push(`${file}: incorrect path casing ${link}`);
          parent = resolve(parent, part);
        }
        if (
          fragment &&
          statSync(target).isFile() &&
          target.endsWith(".md") &&
          !headingIds(readFileSync(target, "utf8")).has(
            decodeURIComponent(fragment),
          )
        )
          errors.push(`${file}: missing heading ${link}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it("ignores fenced examples and external URLs without skipping local fragments", () => {
    const sample = [
      "# Setup",
      "[Guide](guides/getting-started.md) [Section](#setup)",
      "[Website](https://example.test/docs) [Email](mailto:help@example.test)",
      "```sh",
      "# Not a heading",
      "[Not a link](missing.md)",
      "```",
      "## Setup",
    ].join("\n");
    expect(localLinks(sample)).toEqual(["guides/getting-started.md", "#setup"]);
    expect([...headingIds(sample)]).toEqual(["setup", "setup-1"]);
  });
});
