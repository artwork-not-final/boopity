# Contributing

Boopity is preparing its first self-hosted release. The application is
licensed under [MIT](LICENSE), copyright (c) 2026 Artwork Not Final LLC.
Contributions to this application should be compatible with that license; preserve
third-party notices and identify any copied code or assets. This license decision
does not announce a public release or change the legacy .NET application's license.

## Development

Use Node 24.21.0 (see `.nvmrc`) and the committed npm lockfile. From the source directory:

```sh
npm ci
npm run dev:server
```

In a second terminal run `npm run dev`, then use `http://localhost:5173`.
Follow [first-run setup](docs/guides/self-hosting.md); keep credentials in the ignored
`.env.self-hosted`, never `VITE_` variables. The provider-free local browser
harnesses are documented there. Never use real client records in fixtures.

Before proposing a change:

```sh
npm run verify
npm run release:audit
```

`npm run typecheck` checks application code, TypeScript tests, and the local
TypeScript browser harnesses without running them. It is also the first step of
`npm run verify` and CI. The production build remains independent of test files
so the Docker build can exclude tests and private local fixtures.

Verification uses temporary SQLite databases and intercepted email/payment APIs.
Real provider testing is separate, opt-in work and is not part of verification or CI.

CI also builds the image and runs `tests/integration/compose-container-local.mjs`
through the prebuilt Compose definition with fresh, offline volumes. It checks
runtime restrictions, native image processing, synthetic OTP/Google login,
management, container replacement and stopped backup/new-volume restoration.
The runtime fixture uses production dependencies without Vite, Vitest or npm in
the image. Keep these checks when changing deployment or dependency installation.
Required runtime peers must be declared dependencies; Docker alone uses
`--legacy-peer-deps` to avoid auto-installing Better Auth's optional test tooling.
Native optional dependencies must remain available. Development installs still
use the unmodified lockfile and normal peer resolution.

The [route inventory](docs/development/api-routes.md) lists the mounted Node API and access boundaries.
Update it alongside route changes; `tests/tooling/api-route-surface.test.ts` detects drift.
Paginated CRM reads live in `server/business/lists.ts`; the routers in
`server/business/client-routes.ts`, `server/business/pet-routes.ts`, and `server/business/service-routes.ts` provide owner
mutations and pet detail. Do not reintroduce duplicate list handlers or mount a
deferred prototype to reuse one of its helpers.

## Code checks and formatting

`npm run verify` runs type-checking, linting, a read-only formatting check, tests,
the production build, and isolated startup/recovery checks. CI uses the same command.

```sh
npm run lint          # Code checks; warnings also fail
npm run lint:fix      # Apply available safe fixes; review the diff
npm run format:check  # Check formatting without changing files
npm run format       # Apply formatting
```

We use [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) for JavaScript,
TypeScript, and React correctness checks, including Rules of Hooks and effect
dependencies. It does not replace `tsc` or enable experimental type-aware linting.
Oxlint is pinned in the lockfile; no compiler downgrade or parallel TypeScript
installation is needed. The current [typescript-eslint support range](https://typescript-eslint.io/users/dependency-versions/)
does not include this project's TypeScript 7 compiler.

The React Compiler-specific `refs`, `purity`, and `set-state-in-effect` checks are
deliberately deferred to the UI refactoring work; this app does not use React
Compiler. The non-JSX `.ts` tests may pass `children` through `createElement` props
to satisfy required-child types. Other correctness and Hook checks still apply
to those files. Avoid broad lint suppressions; document any narrow exception.

[Prettier](https://prettier.io/docs/configuration) and `.editorconfig` define two-space
indentation, double quotes, semicolons, trailing commas, and LF line endings.
Formatting preserves Markdown prose wrapping and does not rewrite code embedded
in strings. Format before opening a PR, and keep broad formatting changes separate
from behavior changes. Do not hand-format to satisfy the linter.

Checks exclude dependencies, generated output, private installation data, backups,
and legacy checkout archives. Formatting also leaves generated lockfiles, immutable
migrations, and third-party license texts untouched. These exclusions are not
permission to commit private files; run `npm run release:audit` before sharing a patch.

## Scope and review

Start with [the architecture guide](docs/development/architecture.md) for folder ownership,
dependency direction and test locations. Architecture checks run with `npm test`.

Keep workspace features in their own modules. `src/client/features/services/` owns the
service list, editor, availability controls, and service types.
`src/client/features/clients/` owns client and pet lists/editors, invitation controls,
the read-only household pet page, and their types. Invitation state remains
client-scoped in the Clients coordinator; detail components keep their existing
keys and mounting rules.

`App` coordinates installation/session refresh and top-level navigation.
`src/client/features/setup/` owns installer access and the setup wizard; `auth/Login` owns
email-code and Google sign-in; `src/client/features/settings/` owns the settings page and
business/email/Google forms shared with setup. These modules must not import
`App`. Keep the installation mutation runner's save → refresh → optional
continue ordering, and preserve versioned form keys. The shared `Field` component
retains field accessibility; `lib/http/installation-api` retains JSON/file request
behavior.

`src/client/features/payments/` owns booking payment controls, business-wide activity,
refund/correction controls, and payment settings. Keep draft and retry-key state
in the coordinators that own it; list/history components receive data and actions.
Settings retain their own recovery and retry handling. A retry after a failed read
must not replay a payment, refund, or credential mutation. Keep actual and sandbox
balances, explicit refund/live-mode consent, provider verification, and signed
webhook readiness separate. No payment component should import a workspace or
installation shell.

The workspace shell supplies only the settings and actions a feature needs,
such as portal availability, currency, refresh revision, busy state, and its
mutation runner. Feature components must not import the shell. Reuse
`components/forms` and `components/Panel` for existing field/section markup instead
of copying it into each feature. Pure navigation helpers belong in
`lib/navigation`, not page components.

During extractions, preserve component keys, mounted drafts, URL behavior, and
request ordering. Cover interactions through the workspace as well as testing
the extracted components directly. Refactoring is not a visual redesign or an
opportunity to change API contracts.

One installation belongs to one sitter business. New logins cannot become owners.
Keep client queries household-scoped, private notes private, and all authorization,
booking conflicts, prices and cancellation deadlines enforced on the server.
Keep the existing "Powered by Boopity" footer in upstream UI changes.

Prefer small changes with tests. Explain schema, auth, payment, accessibility and
backup impacts. Add new immutable migrations; never edit an already-applied SQL
file. Test upgrading a populated fixture as well as a fresh install. A downgrade
is a restore of the old snapshot plus its matching code, not a reverse migration.

Provider adapters must use the common payment lifecycle. A browser return URL,
booking cancellation or provider timeout is not evidence that money moved. Keep
external operations out of ordinary test runs. Do not add a central payment
account, SaaS limits or a mandatory hosting-provider dependency. Deployment stays
provider-neutral: Docker/Node, explicit `APP_URL` and persistent local storage.

UI changes use Tailwind and the existing shadcn-derived primitives. Verify visible
keyboard focus, labeled controls, mobile overflow, contrast for custom colors and
server-side logo validation. Add third-party notices for copied code/assets.

Do not include databases, backups, `.env`/`.dev.vars`, logs, real emails, cookies,
one-time links or provider object exports in patches. Report vulnerabilities
privately under [SECURITY.md](SECURITY.md), not in a public issue or pull request.
