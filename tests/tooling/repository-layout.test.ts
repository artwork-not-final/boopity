import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("self-hosted repository root", () => {
  it("uses the self-hosted client and Node server by default", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.dev).toBe("vite");
    expect(pkg.scripts.build).toContain("tsc -b && vite build");
    expect(
      Object.keys(pkg.scripts).some((name) => name.endsWith(":self-hosted")),
    ).toBe(false);
    expect(pkg.scripts.start).toContain("dist/server/index.mjs");
    expect(read("src/client/main.tsx")).toContain("App");
    expect(read("Dockerfile")).toMatch(/^FROM node:24\./);
    expect(read("Dockerfile")).not.toMatch(/dotnet|mcr\.microsoft/);
  });

  it("does not install retired Cloudflare or SaaS frontend tooling", () => {
    const lock = JSON.parse(read("package-lock.json"));
    for (const name of [
      "@cloudflare/vite-plugin",
      "@cloudflare/workers-types",
      "wrangler",
      "miniflare",
      "react-router-dom",
      "@tanstack/react-query",
    ]) {
      expect(
        Object.keys(lock.packages).some(
          (path) =>
            path === `node_modules/${name}` ||
            path.endsWith(`/node_modules/${name}`),
        ),
        name,
      ).toBe(false);
    }
  });

  it("pins a matching Node toolchain and separates installation from the runtime", () => {
    const version = read(".nvmrc").trim();
    const docker = read("Dockerfile");
    for (const guide of ["README.md", "SELF-HOSTING.md", "CONTRIBUTING.md"])
      expect(read(guide), guide).toContain(`Node ${version}`);
    expect(docker).toContain(`FROM node:${version}-trixie-slim@sha256:`);
    expect(docker).toMatch(
      /FROM debian:trixie-slim@sha256:[a-f0-9]{64} AS runtime/,
    );
    expect(docker).toContain(
      "npm ci --omit=dev --legacy-peer-deps --ignore-scripts",
    );
    expect(docker).not.toContain("--omit=optional");
    const runtime = docker.split(" AS runtime\n")[1];
    expect(runtime).not.toMatch(/RUN npm|COPY --from=node \/usr\/local\s/);
    expect(runtime).toContain(
      "COPY --from=node /usr/local/LICENSE /usr/local/LICENSE",
    );
    expect(runtime).toContain("COPY --from=dependencies /app ./");
    expect(docker).toContain("RUN chmod -R u=rwX,go=rX /app");
    expect(docker).toContain(
      "find /usr -xdev -type f -perm /6000 -exec chmod a-s {} +",
    );
    expect(docker).toContain("RUN node scripts/build-notices.mjs runtime");
    expect(runtime).toContain("USER node");
    expect(read(".github/workflows/verify.yml")).toContain(
      "node-version-file: .nvmrc",
    );
  });

  it.each(["compose.yaml", "compose.image.yaml"])(
    "%s preserves the hardened runtime and writable installation data",
    (file) => {
      const compose = read(file);
      for (const setting of [
        "read_only: true",
        "cap_drop: [ALL]",
        "security_opt: [no-new-privileges:true]",
        "/tmp:rw,noexec,nosuid,size=64m",
        "boopity-data:/data",
        '"127.0.0.1:3000:3000"',
      ])
        expect(compose, file).toContain(setting);
      expect(compose).not.toMatch(/^\s*(?:privileged|cap_add|user):/m);
    },
  );

  it("keeps retained local installations and archives out of Git and Docker", () => {
    const git = read(".gitignore").split(/\r?\n/);
    const docker = read(".dockerignore").split(/\r?\n/);
    expect(docker).toContain("!THIRD-PARTY-SOURCES.md");
    expect(docker).toContain("!licenses/README.md");
    for (const path of ["web", "Boopity"]) {
      expect(git).toContain(`/${path}/`);
      expect(docker).toContain(`/${path}`);
    }
    expect(git).toContain("/.release-candidates/");
    for (const path of [
      ".release-candidates",
      ".boopity",
      ".env*",
      "backups",
    ]) {
      expect(docker).toContain(path);
    }
  });

  it("runs verification from the root without deployment credentials", () => {
    const workflow = read(".github/workflows/verify.yml");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("docker build --tag boopity-ci .");
    expect(workflow).toContain("BOOPITY_CONTAINER_QA: compose-disposable");
    expect(workflow).toContain(
      "node tests/integration/compose-container-local.mjs boopity-ci .",
    );
    expect(workflow).toContain("BOOPITY_CONTAINER_QA: hosting-disposable");
    expect(workflow).toContain(
      "node tests/integration/hosting-container-local.mjs boopity-ci",
    );
    expect(workflow).not.toMatch(
      /secrets\.|pull_request_target|docker push|git push/,
    );
  });
});
