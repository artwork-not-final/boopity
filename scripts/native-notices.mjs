// Assemble reviewable license text from a checksum-pinned native source bundle.
// This reads tar members into memory; it never extracts or executes source code.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !process.argv[3])
  throw new Error("Supply source-materials directory and output file");
const entries = JSON.parse(readFileSync(join(root, "downloads.json"), "utf8"));
const notices = new Map();
for (const entry of entries) {
  if (
    !/^(?:native|rust)\/[A-Za-z0-9._-]+\.(?:tar\.(?:gz|xz|bz2)|crate)$/.test(
      entry.path,
    )
  )
    continue;
  const archive = join(root, entry.path),
    bytes = readFileSync(archive);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error(`Changed source: ${entry.path}`);
  const members = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).split("\n");
  for (const member of members) {
    if (
      member.endsWith("/") ||
      !/^(?:(?:licen[sc]e|copying|copyright|notice|patents?)(?:[._-].*)?|FTL.TXT)$/i.test(
        basename(member),
      )
    )
      continue;
    if (
      member.startsWith("/") ||
      member.startsWith("-") ||
      member.split("/").includes("..")
    )
      throw new Error("Unsafe archive member");
    const text = execFileSync("tar", ["-xOf", archive, member], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
    if (!text || text.includes("\0")) continue;
    const hash = createHash("sha256").update(text).digest("hex");
    const notice = notices.get(hash) ?? { text, sources: [] };
    notice.sources.push(`${entry.path}: ${member}`);
    notices.set(hash, notice);
  }
}
if (!notices.size) throw new Error("No native license texts found");
const header =
  "Native source-archive notices\n\nGenerated from checksum-verified Sharp/libvips and Rust source materials.\nSources are deliberately a superset: build tools, tests and disabled features may\nhave their own licenses; their presence here does not change the application's\nlicense. Original notices and per-file copyright headers remain in each archive.\nSee THIRD-PARTY-SOURCES.md for version mapping, modifications and replacement.\n\n";
writeFileSync(
  resolve(process.argv[3]),
  header +
    [...notices.values()]
      .map((n) => n.sources.join("\n") + "\n\n" + n.text + "\n")
      .join("\n========================================\n\n"),
);
console.log(`${notices.size} distinct native notice texts assembled`);
