// Read-only, offline heuristic scan. Reports locations/categories, NEVER matched values.
// This is a release aid, not a substitute for a dedicated scanner or a human review.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function secretCategories(content) {
  const patterns = {
    "stripe-secret": /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    "webhook-secret": /\bwhsec_[A-Za-z0-9]{20,}\b/,
    "google-secret": /\b(?:GOCSPX-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/,
    "github-token":
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    "aws-access-key": /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    "private-key": /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
    "credential-url":
      /\b(?:postgres(?:ql)?|mysql|amqps?|redis(?:s)?)?:\/\/[^\s/:]+:[^\s/@]{8,}@/,
    "resend-key": /\bre_[A-Za-z0-9_]{28,}\b/,
  };
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(content))
    .map(([kind]) => kind);
}

export function privatePath(path) {
  return (
    (/(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|auth-secret|settings-key)$/.test(
      path,
    ) &&
      !path.endsWith(".example")) ||
    /(^|\/)(?:\.boopity|\.wrangler|\.release-candidates|backups|test-results|node_modules|\.idea)\//.test(
      path,
    ) ||
    /\.(?:sqlite(?:-(?:wal|shm))?|db(?:-(?:wal|shm))?|pem|p12|pfx|bundle)$/i.test(
      path,
    )
  );
}

function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function audit(root, history = false) {
  const paths = git(root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  const findings = [],
    skipped = [];
  for (const path of [...new Set(paths)].sort()) {
    if (privatePath(path)) {
      findings.push({
        scope: "working-tree",
        path,
        categories: ["private-file"],
      });
      continue; // Do not read accidental tracked credentials or installation data.
    }
    let stat;
    try {
      stat = lstatSync(join(root, path));
    } catch {
      skipped.push({ path, reason: "missing" });
      continue;
    }
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) {
      skipped.push({ path, reason: "non-regular-or-large-file" });
      continue;
    }
    const content = readFileSync(join(root, path));
    if (content.includes(0)) {
      skipped.push({ path, reason: "binary-asset-needs-review" });
      continue;
    }
    const categories = secretCategories(content.toString());
    if (categories.length)
      findings.push({ scope: "working-tree", path, categories });
  }
  let blobsScanned = 0;
  if (history) {
    // All locally reachable refs, not merely HEAD. No fetch; no remote mutation.
    const objects = git(root, ["rev-list", "--objects", "--all"])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    const names = new Map(
      objects.map((line) => {
        const space = line.indexOf(" ");
        return space === -1
          ? [line, "(unnamed)"]
          : [line.slice(0, space), line.slice(space + 1)];
      }),
    );
    const types = git(
      root,
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      [...names.keys()].join("\n") + "\n",
    ).toString();
    const blobs = types
      .trim()
      .split("\n")
      .filter((line) => line.split(" ")[1] === "blob");
    // Chunk the batch so history size doesn't scale memory to the entire repository.
    for (let index = 0; index < blobs.length; index += 32) {
      const group = blobs.slice(index, index + 32).filter((line) => {
        const [id, , size] = line.split(" ");
        if (Number(size) <= 16 * 1024 * 1024) return true;
        skipped.push({
          object: id,
          path: names.get(id),
          reason: "large-history-blob",
        });
        return false;
      });
      if (!group.length) continue;
      const buffer = git(
        root,
        ["cat-file", "--batch"],
        group.map((line) => line.split(" ")[0]).join("\n") + "\n",
      );
      let offset = 0;
      for (const _line of group) {
        const end = buffer.indexOf(10, offset);
        const [id, type, length] = buffer
          .subarray(offset, end)
          .toString()
          .split(" ");
        if (end < 0 || type !== "blob" || !/^\d+$/.test(length))
          throw new Error("Invalid Git batch response");
        const content = buffer.subarray(end + 1, end + 1 + Number(length));
        offset = end + 2 + Number(length);
        blobsScanned++;
        const path = names.get(id);
        const categories = privatePath(path) ? ["private-file-in-history"] : [];
        if (!content.includes(0))
          categories.push(...secretCategories(content.toString()));
        else
          skipped.push({
            object: id,
            path,
            reason: "binary-history-needs-review",
          });
        if (categories.length)
          findings.push({ scope: "history", object: id, path, categories });
      }
    }
  }
  return {
    heuristicOnly: true,
    historyIncluded: history,
    filesConsidered: paths.length,
    blobsScanned,
    findings,
    skipped,
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--history"))
      throw new Error("Unsupported argument");
    const root = git(resolve(dirname(fileURLToPath(import.meta.url)), ".."), [
      "rev-parse",
      "--show-toplevel",
    ])
      .toString()
      .trim();
    const result = audit(root, args.includes("--history"));
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length) process.exitCode = 1;
  } catch {
    console.error(
      "Release audit failed. Run from a Git checkout; inspect tooling without printing credentials.",
    );
    process.exitCode = 2;
  }
}
