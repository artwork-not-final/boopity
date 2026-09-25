// Offline build-time notices. Missing license text must fail, not silently vanish.
import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const supplements = {
  "react-remove-scroll-bar@2.3.8": "react-remove-scroll-bar.txt",
  "@better-auth/utils@0.4.2": "better-auth-utils.txt",
  "@better-auth/utils@0.5.0": "better-auth-utils.txt",
  "drizzle-orm@0.45.2": "drizzle-orm.txt",
};

export function packageNotices(root, directory) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        !entry.name.startsWith(".")
      )
        walk(join(path, entry.name));
      else if (
        entry.isFile() &&
        /^(?:licen[sc]e|copying|notice|copyright)(?:[._-].*)?$/i.test(
          entry.name,
        )
      )
        files.push(join(path, entry.name));
    }
  }
  walk(directory);
  const key = `${pkg.name}@${pkg.version}`;
  let text = files
    .sort()
    .map((file) => readFileSync(file, "utf8").trim())
    .filter(Boolean)
    .join("\n\n");
  if (supplements[key])
    text +=
      "\n\n" +
      readFileSync(join(root, "licenses", supplements[key]), "utf8").trim();
  if (
    /^@img\/sharp-libvips-linux-(?:arm64|x64)$/.test(pkg.name) &&
    pkg.version === "1.3.3"
  ) {
    text += "\n\n" + readFileSync(join(directory, "README.md"), "utf8").trim();
    text +=
      "\n\n" +
      readFileSync(
        join(root, "licenses", "sharp-libvips-LGPL.txt"),
        "utf8",
      ).trim();
    text +=
      "\n\n" +
      readFileSync(join(root, "licenses", "GPL-3.0.txt"), "utf8").trim();
  }
  if (!text.trim()) throw new Error(`Missing license text: ${key}`);
  return {
    name: pkg.name,
    version: pkg.version,
    identifier: pkg.license,
    text: text.trim(),
  };
}

export function browserNotices(entries, root) {
  if (!Array.isArray(entries) || !entries.length)
    throw new Error("Missing browser inventory");
  const notices = entries.map((entry) => {
    if (!entry.name || !entry.version)
      throw new Error("Invalid browser inventory");
    if (entry.text?.trim()) return entry;
    const file = supplements[`${entry.name}@${entry.version}`];
    if (!file)
      throw new Error(`Missing license text: ${entry.name}@${entry.version}`);
    return {
      ...entry,
      text: readFileSync(join(root, "licenses", file), "utf8").trim(),
    };
  });
  // CSS imports are assets and are not included in Vite's JS-module inventory.
  for (const name of ["tailwindcss", "tw-animate-css"])
    notices.push(packageNotices(root, join(root, "node_modules", name)));
  return renderNotices(notices, root);
}

function renderNotices(entries, root) {
  const packages = [
    ...new Map(
      entries.map((entry) => [`${entry.name}@${entry.version}`, entry]),
    ).values(),
  ];
  return (
    readFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "utf8") +
    "\n\n# Included package notices\n\n" +
    packages
      .sort((a, b) =>
        `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
      )
      .map(
        (entry) =>
          `## ${entry.name}@${entry.version} (${entry.identifier ?? "see license text"})\n\n${entry.text}\n`,
      )
      .join("\n")
  );
}

export function runtimeNotices(root) {
  const entries = [];
  function modules(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const directory = join(path, entry.name);
      if (entry.name.startsWith("@")) modules(directory);
      else {
        entries.push(packageNotices(root, directory));
        if (existsSync(join(directory, "node_modules")))
          modules(join(directory, "node_modules"));
      }
    }
  }
  modules(join(root, "node_modules"));
  return renderNotices(entries, root);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(".");
  if (process.argv[2] === "browser") {
    const directory = join(root, "dist/self-hosted");
    const entries = JSON.parse(
      readFileSync(join(directory, ".vite/licenses.json"), "utf8"),
    );
    writeFileSync(
      join(directory, "third-party-licenses.txt"),
      browserNotices(entries, root),
    );
  } else if (process.argv[2] === "runtime") {
    writeFileSync(join(root, "RUNTIME-NOTICES.txt"), runtimeNotices(root));
  } else throw new Error("Use browser or runtime");
}
