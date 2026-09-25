// Source-only local snapshots. Never copies Git history, loads .env, or publishes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath, secretCategories } from "./release-audit.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, args) =>
  execFileSync("git", ["-C", root, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });

export function safeSourcePath(path) {
  const parts = path.split("/");
  if (
    !/^[A-Za-z0-9._/-]+$/.test(path) ||
    parts.some((part) => !part || part === "." || part === "..") ||
    privatePath(path) ||
    parts.some((part) =>
      [
        ".git",
        ".agents",
        ".codex",
        "dist",
        "web",
        "Boopity",
        "release-candidate",
      ].includes(part),
    ) ||
    /\.(?:log|tsbuildinfo|tar|zip|gz)$/i.test(path)
  )
    throw new Error(`Rejected source path: ${path}`);
  return path;
}

export function readSource(root, path) {
  safeSourcePath(path);
  let current = realpathSync(root);
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      throw new Error(`Non-regular source path: ${path}`);
    if (stat.size > 16 * 1024 * 1024)
      throw new Error(`Oversized source: ${path}`);
  }
  return {
    bytes: readFileSync(current),
    executable: Boolean(lstatSync(current).mode & 0o111),
  };
}

function review(path, bytes) {
  if (bytes.includes(0)) throw new Error(`Binary source needs review: ${path}`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const categories = secretCategories(text);
  if (categories.length)
    throw new Error(
      `Source review required: ${path} (${categories.join(", ")})`,
    );
}

export function planSource(root, ref) {
  // A full commit ID only; never implicitly include other refs or historical objects.
  if (ref !== undefined && !/^[a-f0-9]{40}$/.test(ref))
    throw new Error("Use a full commit ID");
  const deleted = new Set(
    ref
      ? []
      : git(root, ["ls-files", "--deleted", "-z"]).toString().split("\0"),
  );
  const entries = ref
    ? git(root, ["ls-tree", "-r", "-z", ref])
        .toString()
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const [metadata, path] = line.split("\t");
          const [mode, type, object] = metadata.split(" ");
          if (type !== "blob" || !["100644", "100755"].includes(mode))
            throw new Error("Non-regular Git source");
          return { path, object, executable: mode === "100755" };
        })
    : [
        ...new Set(
          git(root, [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
          ])
            .toString()
            .split("\0"),
        ),
      ]
        .filter((path) => path && !deleted.has(path))
        .map((path) => ({ path }));
  const names = new Set();
  return entries
    .sort((a, b) => a.path.localeCompare(b.path, "en"))
    .map((entry) => {
      const path = safeSourcePath(entry.path);
      if (names.has(path.toLowerCase()))
        throw new Error("Case-colliding source paths");
      names.add(path.toLowerCase());
      const file = ref
        ? {
            bytes: git(root, ["cat-file", "blob", entry.object]),
            executable: entry.executable,
          }
        : readSource(root, path);
      if (file.bytes.length > 16 * 1024 * 1024)
        throw new Error(`Oversized source: ${path}`);
      review(path, file.bytes);
      return { path, ...file };
    });
}

export function exportSource(root, parent, ref) {
  const files = planSource(root, ref); // Review all inputs before writing anything.
  const destination = mkdtempSync(join(realpathSync(parent), "source-"));
  const source = join(destination, "source");
  mkdirSync(source, { mode: 0o700 });
  for (const file of files) {
    const path = join(source, file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.bytes, {
      flag: "wx",
      mode: file.executable ? 0o700 : 0o600,
    });
  }
  const manifest = {
    schemaVersion: 1,
    historyIncluded: false,
    source: ref ? { commit: ref } : { kind: "working-tree-snapshot" },
    files: files.map(({ path, bytes, executable }) => ({
      path,
      bytes: bytes.length,
      sha256: hash(bytes),
      executable,
    })),
  };
  const json = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(join(destination, "manifest.json"), json, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    destination,
    source,
    files: files.length,
    manifestSha256: hash(json),
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === "--commit"))
      throw new Error("Invalid arguments");
    const parent = join(root, ".release-candidates");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (lstatSync(parent).isSymbolicLink())
      throw new Error("Unsafe export directory");
    console.log(JSON.stringify(exportSource(root, parent, args[1]), null, 2));
  } catch {
    console.error(
      "Source export failed closed. Review source paths and redacted release-audit findings; no publication was attempted.",
    );
    process.exitCode = 1;
  }
}
