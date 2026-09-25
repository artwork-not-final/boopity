# Application structure

Boopity is one package with a React client and a Hono server. Vite builds the
client; the Node server serves its static files and API. Clean page URLs use the
existing client router and server fallback, not SSR. One installation belongs to
one pet-care business.

## Client

```text
src/client/
  main.tsx               Browser bootstrap and error boundary
  app/                   Application composition, branded shell, session lifecycle
  features/
    auth/                Email-code and Google sign-in, invitation acceptance
    setup/               First-run access and setup wizard
    bookings/            List/calendar, editor, visit details, cancellations
    clients/             Client records, pets, and portal access
    services/            Services and rates
    payments/            Payment activity, booking payments, provider settings
    rules/               Client portal and availability rules
    settings/            Business, email, Google, and settings composition
  components/
    ui/                  Customized shadcn-derived primitives
    forms/               Field, Choice, search and form sections
    feedback/            Shared notices and hints
    navigation/          Skip link and page controls
  hooks/                 Cross-feature hooks, currently paginated reads
  lib/                   HTTP, navigation, formatting and client-only types
  styles/theme.css       Tailwind imports, semantic tokens and global accessibility
src/shared/              Browser-safe API contracts, schemas and shared rules
```

`App` coordinates installation/session access and route-level rendering. It does
not implement feature forms. `BrandLayout` owns the header, footer, theme and
entry-page centering. Installation reads and startup/resume effects have separate
hooks. `Workspace` composes role-appropriate pages and owns its refresh/mutation
feedback. Authorization remains on the server; hiding a page is not access control.

Feature files stay together, including their types, formatting and hooks when
only that feature needs them. Shared code moves down to `components`, `hooks` or
`lib` only when there is a real second consumer. Do not introduce catch-all barrel
files that eagerly import every feature or expose a shell as a utility module.

Dependency direction is **app → features → shared client modules → shared
contracts**. Shared modules must not import features or app composition. Features
must not import an app shell. The architecture tests enforce this, including
type-only imports and re-exports, and check for browser runtime cycles.

There are a few explicit cross-feature composition points:

- Bookings use client/pet and service types, the species label, and booking payments.
- Setup uses the sign-in flow and the business/email/Google settings forms.
- Settings compose sign-in recovery and payment settings.

The allowlist in `tests/tooling/architecture.test.ts` documents exact modules.
Review new dependencies rather than broadening the rule to allow entire folders.
General-purpose date formatting belongs in `lib/format`, not a calendar page.

## State and requests

URL state belongs in `lib/navigation`; navigation functions must not import JSX
pages. Keep browser Back/Forward, refresh, detail tabs and role-safe paths covered
by interaction tests. There is no requirement to add a routing framework merely
to support nested paths.

Drafts and idempotency/retry keys stay in their owning feature coordinator.
Preserve component keys and mounting rules when extracting UI. In particular,
booking notes survive payment refreshes, and the payment tab stays mounted after
it is opened. Installation saves must retain save → refresh → optional continue
ordering. Resume, retry and lazy-loading boundaries must never replay a mutation.

The installation and workspace HTTP wrappers share response handling but retain
their distinct request behavior. Runtime-validated shared response schemas stay
browser-safe; do not import a server implementation to reuse its types. Provider
credentials never belong in `VITE_` variables or browser modules.

## Styling and components

Tailwind v4 uses the CSS-first configuration in `styles/theme.css`; no legacy
Tailwind JavaScript configuration is needed. Explicit source scanning covers the
client tree only. Brand previews use semantic CSS variables on the existing theme
root, including portalled controls. Keep the default white field surfaces and
visible, subtle keyboard focus treatment.

`components.json` points shadcn tooling at the existing primitives. Treat generated
output as a starting point: do not overwrite accessibility or branding
customizations. `components/forms/Field` is the single label/help association
implementation; its presentation variants preserve existing form typography.
Keep payment-specific amount validation in the payment feature.

## Server and build tools

```text
server/
  index.ts, manage.ts, healthcheck.ts   Production entry points
  startup.ts                          Startup guidance and local browser opening
  runtime/                            Node application, configuration and adapters
  auth/                               Better Auth, email and endpoint policy
  business/                           Client/pet/service routes and booking rules
  payments/                           Provider-independent lifecycle and adapters
  core/                               Host contracts, installation and HTTP utilities
  db/                                 Database schema and auth adapter
  experimental/                       Retained, unmounted prototypes; not runtime code
drizzle/, db/self-hosted/              Immutable migration history, applied in order
```

Production entry points do not import `experimental`, including for types.
Keeping a prototype's tests is not permission to mount it. The API route inventory
remains the contract for the supported application. All persistence paths,
configuration variable names, SQL and migration ordering stay stable during
structural refactors.

`vite.config.ts` builds the browser, `tsconfig.app.json` checks it, and
`tsconfig.server.json` checks the Node server without Vite browser globals.
`tsconfig.node.json` covers build-tool configuration. Use `npm run dev`,
`npm run build`, and `npm run verify`; historical self-hosted script aliases are
not needed. The installed asset directory remains `dist/self-hosted` to preserve
the server/container artifact contract, independently of configuration filenames.

Workspace, setup wizard and settings entry points load with React `lazy`.
Declarations stay at module scope. Suspense shows a status inside the branded
shell, and the existing error boundary provides an explicit reload if a chunk
fails. Splitting code is not authorization: server guards are unchanged. Measure
the production manifest and initial dependency closure before adding more splits.

## Verification layout

```text
tests/client/            Rendered UI, navigation and browser-state interactions
tests/server/            API, authorization, persistence and provider simulations
tests/shared/            Runtime-neutral shared behavior
tests/tooling/           Architecture, configuration, source/release checks
tests/support/           Synthetic fixtures and database helpers
tests/integration/       Explicit local/browser/container harnesses
```

`npm test` runs all `*.test.ts` files. Integration harnesses run only through their
explicit scripts; real-provider work is opt-in. `npm run typecheck` checks all
TypeScript tests and harnesses, while production build projects exclude tests.
Use disposable data and intercepted providers. Never use customer records or
real credentials as fixtures.

Prefer rendered and interaction checks over source-text assertions. Keep focused
copy contracts for payment consequences, privacy and access warnings. Moving code
must not weaken those protections or silently remove tests.
