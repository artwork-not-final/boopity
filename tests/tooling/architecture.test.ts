import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceFiles = (directory: string): string[] =>
  readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(
    (item) => {
      const path = `${directory}/${item.name}`;
      return item.isDirectory()
        ? sourceFiles(path)
        : /\.tsx?$/.test(path)
          ? [path]
          : [];
    },
  );

// These are deliberate composition points, not a general cross-feature escape
// hatch. New dependencies must be reviewed here alongside docs/development/architecture.md.
const featureDependencies: Record<string, string[]> = {
  bookings: [
    "clients/types",
    "clients/species-label",
    "services/types",
    "payments/BookingPayments",
  ],
  setup: [
    "auth/Login",
    "auth/useEmailCodeCooldown",
    "settings/Appearance",
    "settings/EmailSettings",
    "settings/GoogleSettings",
  ],
  settings: [
    "auth/Login",
    "auth/useEmailCodeCooldown",
    "payments/PaymentSettings",
  ],
};

function boundaryError(from: string, target: string): string | null {
  const backend = /^(server|platform|worker|db)\//.test(target);
  const serverPackage =
    /^(node:|hono(?:\/|$)|drizzle-orm(?:\/|$)|stripe$|nodemailer$|sharp$|better-auth$|@hono\/)/.test(
      target,
    );
  if (
    from.startsWith("src/shared/") &&
    (backend || serverPackage || target.startsWith("src/client/"))
  )
    return "Shared contracts cannot depend on a runtime or UI";
  if (!from.startsWith("src/client/")) return null;
  if (backend || serverPackage)
    return "Browser code cannot import server implementation";
  if (
    /^src\/client\/(components|hooks|lib)\//.test(from) &&
    /^src\/client\/(features|app)\//.test(target)
  )
    return "Shared client modules cannot depend on pages or application composition";
  const feature = from.match(/^src\/client\/features\/([^/]+)\//)?.[1];
  if (!feature) return null;
  if (target.startsWith("src/client/app/"))
    return "Features cannot import the application shell";
  const dependency = target.match(/^src\/client\/features\/(.+)\.[^.]+$/)?.[1];
  if (
    dependency &&
    !dependency.startsWith(feature + "/") &&
    !featureDependencies[feature]?.includes(dependency)
  )
    return "Undeclared cross-feature dependency";
  return null;
}

// Include type-only imports and re-exports, which bundlers intentionally erase.
function declaredImports(text: string) {
  return [
    ...text.matchAll(
      /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^;"'`]*?\s+from\s*)?|\bimport\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

describe("architecture boundaries", () => {
  it("enforces dependency direction including type-only imports and re-exports", () => {
    const files = [...sourceFiles("src/client"), ...sourceFiles("src/shared")];
    const known = new Set(files);
    const findings: string[] = [];
    for (const file of files) {
      for (const specifier of declaredImports(
        readFileSync(resolve(root, file), "utf8"),
      )) {
        const local = specifier.startsWith(".")
          ? relative(root, resolve(root, dirname(file), specifier))
          : specifier.startsWith("@/")
            ? `src/${specifier.slice(2)}`
            : specifier;
        const target =
          [local, local + ".ts", local + ".tsx"].find((path) =>
            known.has(path),
          ) ?? local;
        const problem = boundaryError(file, target);
        if (problem) findings.push(`${file} → ${target}: ${problem}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it("detects forbidden imports rather than only blessing the current tree", () => {
    expect(
      declaredImports(
        'import type { X } from "../app/App"; export { Y } from "../features/bookings/Bookings"; const page = import("../server/app");',
      ),
    ).toEqual(["../app/App", "../features/bookings/Bookings", "../server/app"]);
    for (const [from, to] of [
      [
        "src/client/features/bookings/Bookings.tsx",
        "src/client/app/Workspace.tsx",
      ],
      [
        "src/client/components/forms/Field.tsx",
        "src/client/features/setup/Identity.tsx",
      ],
      ["src/client/hooks/usePage.ts", "server/runtime/app.ts"],
      ["src/shared/contracts.ts", "src/client/app/App.tsx"],
      ["src/shared/contracts.ts", "node:crypto"],
      [
        "src/client/features/clients/Clients.tsx",
        "src/client/features/payments/PaymentAttempt.tsx",
      ],
      ["src/client/app/App.tsx", "node:fs"],
    ])
      expect(boundaryError(from, to), `${from} → ${to}`).not.toBeNull();
    expect(
      boundaryError(
        "src/client/features/bookings/Bookings.tsx",
        "src/client/components/forms/Field.tsx",
      ),
    ).toBeNull();
  });

  it("keeps the browser runtime graph server-free and acyclic", async () => {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["src/client/main.tsx"],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const inputs = result.metafile!.inputs;
    const firstParty = Object.keys(inputs).filter(
      (file) => !file.startsWith("node_modules/"),
    );
    expect(
      firstParty.filter(
        (file) =>
          !file.startsWith("src/client/") && !file.startsWith("src/shared/"),
      ),
    ).toEqual([]);
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (file: string, trail: string[]) => {
      if (visiting.has(file))
        throw new Error(
          `Runtime dependency cycle: ${[...trail, file].join(" → ")}`,
        );
      if (visited.has(file)) return;
      visiting.add(file);
      for (const dependency of inputs[file]?.imports ?? [])
        if (!dependency.external && firstParty.includes(dependency.path))
          visit(dependency.path, [...trail, file]);
      visiting.delete(file);
      visited.add(file);
    };
    for (const file of firstParty) visit(file, []);
  });

  it("keeps Tailwind scanning the client tree and shadcn aligned with its primitives", () => {
    const theme = readFileSync(
      resolve(root, "src/client/styles/theme.css"),
      "utf8",
    );
    expect(theme).toContain('@import "tailwindcss" source(none);');
    expect(theme).toContain('@source "../";');
    const components = JSON.parse(
      readFileSync(resolve(root, "components.json"), "utf8"),
    );
    expect(components).toMatchObject({
      rsc: false,
      tsx: true,
      tailwind: {
        config: "",
        css: "src/client/styles/theme.css",
        cssVariables: true,
      },
      aliases: { ui: "@/client/components/ui", utils: "@/client/lib/utils" },
    });
  });

  it("keeps retained prototypes outside production server entry graphs and contracts", async () => {
    const files = sourceFiles("server");
    const active = files.filter(
      (file) => !file.startsWith("server/experimental/"),
    );
    const findings: string[] = [];
    for (const file of active) {
      for (const specifier of declaredImports(
        readFileSync(resolve(root, file), "utf8"),
      )) {
        if (!specifier.startsWith(".")) continue;
        const target = relative(root, resolve(root, dirname(file), specifier));
        if (target.startsWith("server/experimental/"))
          findings.push(`${file} → ${target}`);
      }
    }
    expect(findings).toEqual([]);
    const result = await build({
      absWorkingDir: root,
      entryPoints: [
        "server/index.ts",
        "server/manage.ts",
        "server/healthcheck.ts",
      ],
      outdir: "dist/architecture-check",
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "node",
      packages: "external",
      logLevel: "silent",
    });
    expect(
      Object.keys(result.metafile!.inputs).filter(
        (file) =>
          file.startsWith("server/experimental/") ||
          file.startsWith("src/client/"),
      ),
    ).toEqual([]);
  });

  it("uses separate browser, server and build-tool configurations", () => {
    const read = (file: string) => readFileSync(resolve(root, file), "utf8");
    const server = JSON.parse(read("tsconfig.server.json"));
    expect(server.include).toEqual(["server", "src/shared"]);
    expect(server.compilerOptions.types).toEqual(["node"]);
    expect(server.compilerOptions.lib).not.toContain("WebWorker");
    const tooling = JSON.parse(read("tsconfig.node.json"));
    expect(tooling.include).toContain("vite.config.ts");
    const vite = read("vite.config.ts");
    expect(vite).toContain('fileURLToPath(new URL("./src", import.meta.url))');
    expect(vite).not.toContain(".pathname");
    expect(vite).not.toContain("VITE_SELF_HOSTED");
  });
});
