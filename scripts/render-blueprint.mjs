// Maintainer tooling: renders YAML-compatible JSON, without network access,
// secrets, account changes or file writes. An actual released image is required.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function renderBlueprint(image) {
  if (
    typeof image !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[a-f0-9]{64}$/.test(
      image,
    ) ||
    /@sha256:([a-f0-9])\1{63}$/.test(image)
  ) {
    throw new Error(
      "Supply a registry image pinned by its reviewed sha256 digest, not a tag or placeholder.",
    );
  }
  return {
    services: [
      {
        type: "web",
        name: "boopity",
        runtime: "image",
        plan: "0.5c-512mb",
        image: { url: image },
        region: "virginia",
        numInstances: 1,
        healthCheckPath: "/api/ready",
        maxShutdownDelaySeconds: 30,
        disk: { name: "boopity-data", mountPath: "/data", sizeGB: 1 },
        envVars: [
          { key: "BOOPITY_HOSTING", value: "render" },
          { key: "NODE_ENV", value: "production" },
          { key: "HOST", value: "0.0.0.0" },
          { key: "PORT", value: "3000" },
          { key: "DATA_DIR", value: "/data" },
          { key: "BOOPITY_SETUP_PASSWORD", sync: false },
        ],
      },
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [image, ...extra] = process.argv.slice(2);
    if (extra.length)
      throw new Error(
        "Usage: node scripts/render-blueprint.mjs REGISTRY_IMAGE@sha256:DIGEST",
      );
    process.stdout.write(
      JSON.stringify(renderBlueprint(image), null, 2) + "\n",
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
