// Offline integrity verification only: not a license, provenance or security certification.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifyMaterials(directory) {
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw new Error("Unsafe materials directory");
  const root = realpathSync(directory);
  if (
    !lstatSync(join(root, "manifest.json")).isFile() ||
    lstatSync(join(root, "manifest.json")).isSymbolicLink()
  )
    throw new Error("Unsafe manifest");
  const bytes = readFileSync(join(root, "manifest.json"));
  const manifest = JSON.parse(bytes);
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error("Invalid manifest");
  const expected = new Map();
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !/^[A-Za-z0-9@+~:._/-]+$/.test(file.path) ||
      file.path.split("/").some((p) => !p || p === "." || p === "..") ||
      file.path === "manifest.json" ||
      expected.has(file.path.toLowerCase()) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw new Error("Unsafe manifest entry");
    expected.set(file.path.toLowerCase(), file);
  }
  let count = 0;
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Symlink in materials");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        if (path === "manifest.json") continue;
        const expectedFile = expected.get(path.toLowerCase());
        if (!expectedFile || expectedFile.path !== path)
          throw new Error("Unlisted materials file");
        const stat = lstatSync(join(root, path));
        if (stat.size !== expectedFile.bytes)
          throw new Error(`Size mismatch: ${path}`);
        const sha = createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex");
        if (sha !== expectedFile.sha256)
          throw new Error(`Checksum mismatch: ${path}`);
        count++;
      } else throw new Error("Non-regular materials file");
    }
  }
  visit("");
  if (count !== expected.size) throw new Error("Missing materials file");
  return {
    files: count,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3) throw new Error("Supply materials directory");
  console.log(
    JSON.stringify(verifyMaterials(resolve(process.argv[2])), null, 2),
  );
}
