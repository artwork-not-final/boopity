// Offline, allowlisted installer packaging. Does not pull, run or publish images.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSource } from "./release-source.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const project = "boopity-quick-start";

export function quickStartFiles(root, version, image) {
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(version ?? ""))
    throw new Error(
      "Supply a release version such as 0.1.0-preview.4 (without v).",
    );
  if (
    !/^ghcr\.io\/artwork-not-final\/boopity@sha256:[a-f0-9]{64}$/.test(
      image ?? "",
    )
  )
    throw new Error(
      "Supply the reviewed Boopity registry image digest, not a mutable tag.",
    );
  const read = (path) => readSource(root, path).bytes.toString("utf8");
  const compose = read("compose.image.yaml")
    .replace(/^#.*\n/gm, "")
    .replace(
      "${BOOPITY_IMAGE:?Set BOOPITY_IMAGE to the reviewed registry image digest}",
      image,
    )
    .replace("${APP_URL:-http://localhost:3000}", "http://localhost:3000")
    .replace(
      "      BOOPITY_SETUP_PASSWORD: ${BOOPITY_SETUP_PASSWORD:-}",
      "      BOOPITY_SETUP_LINK: manual",
    )
    .replace(
      "    restart: unless-stopped",
      '    restart: unless-stopped\n    labels:\n      org.boopity.quick-start: "1"',
    )
    .replace(
      /  boopity-data:\s*$/,
      '  boopity-data:\n    labels:\n      org.boopity.quick-start: "1"\n',
    );
  if (
    compose.includes("${") ||
    !compose.includes("BOOPITY_SETUP_LINK: manual") ||
    !compose.includes(`image: ${image}`)
  )
    throw new Error(
      "The Compose template changed; review the Quick Start generator.",
    );
  const files = [
    {
      path: "Start Boopity.command",
      content: read("scripts/install/quick-start.command"),
      executable: true,
    },
    {
      path: "Read Me.txt",
      content: read("scripts/install/quick-start-readme.txt")
        .replaceAll("__VERSION__", version)
        .replaceAll("__IMAGE__", image),
    },
    {
      path: "compose.image.yaml",
      content: `# Local Quick Start; image selection is part of the reviewed release.\nname: ${project}\n${compose}`,
    },
    { path: "LICENSE", content: read("LICENSE") },
    ...[
      "scripts/start-docker.sh",
      "scripts/install/setup-entry.mjs",
      "scripts/install/quick-start-checks.sh",
    ].map((path) => ({ path, content: read(path) })),
  ];
  const manifest = {
    schemaVersion: 1,
    platform: "macos",
    applicationVersion: version,
    image,
    composeProject: project,
    files: files.map(({ path, content, executable }) => ({
      path,
      sha256: hash(content),
      executable: Boolean(executable),
    })),
  };
  return [
    ...files,
    { path: "BUNDLE.json", content: JSON.stringify(manifest, null, 2) + "\n" },
  ];
}

export function packageQuickStart(root, parent, version, image) {
  const files = quickStartFiles(root, version, image); // Validate before creating output.
  const destination = mkdtempSync(join(realpathSync(parent), "quick-start-"));
  const folder = "Boopity Quick Start";
  for (const file of files) {
    const path = join(destination, folder, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, {
      flag: "wx",
      mode: file.executable ? 0o755 : 0o644,
    });
  }
  const name = `boopity-${version}-quick-start-macos.zip`;
  const archive = join(destination, name);
  execFileSync(
    "zip",
    ["-X", "-q", archive, ...files.map(({ path }) => `${folder}/${path}`)],
    {
      cwd: destination,
      // No .env, ZIPOPT, shell expansions, or Finder metadata in a release archive.
      env: { PATH: process.env.PATH, COPYFILE_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    },
  );
  const sha256 = hash(readFileSync(archive));
  writeFileSync(archive + ".sha256", `${sha256}  ${name}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  return { destination, archive, sha256, files: files.length, image, version };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--version" || args[2] !== "--image")
      throw new Error(
        "Usage: npm run release:quick-start -- --version VERSION --image ghcr.io/artwork-not-final/boopity@sha256:DIGEST",
      );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const parent = join(root, ".release-candidates");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    console.log(
      JSON.stringify(
        packageQuickStart(root, parent, args[1], args[3]),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      "Quick Start packaging failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  }
}
