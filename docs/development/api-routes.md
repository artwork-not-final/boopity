# Application route inventory

This is Boopity's internal application API, not a versioned third-party
integration contract. `server/runtime/app.ts` is the entry point. The route-surface
test compares the registered methods/paths below with the application so this
inventory must change deliberately when a route is added or removed.

## Access boundaries

- Every request uses the configured origin and request limits. State-changing
  browser requests require same-origin JSON, except the validated logo upload.
  Signed payment webhooks have their own narrowly scoped origin exemption.
- Setup writes require an installation-bound operator session or verified owner,
  depending on the step. After setup, the owner uses these endpoints for settings;
  their `/setup/` name does not reopen first-time ownership claims.
- `/api/auth/*` below is a dispatcher, not unrestricted Better Auth access. Its
  allowlist in `server/auth/routes.ts` permits session lookup (GET/POST), sign-out,
  sending/verifying sign-in email codes, Google redirect sign-in and its callback.
  Password registration/reset, Better Auth's generic email-change endpoints and
  raw OTP lookup remain closed. Failed Google browser callbacks return to the
  same-origin sign-in page with an allowlisted error code, never raw provider JSON.
- `/api/account/email` is owner-only after setup. A session-bound request sends
  distinct five-minute codes to the current and proposed inboxes. Both proofs,
  current ownership, session validity and target-email availability are checked
  before a transactional update. Digests are keyed, attempts are bounded, resends
  rotate the challenge without resetting the shared attempt budget, and failed
  delivery invalidates the request. Changes preserve the owner's ID and business
  records, revoke owner sessions and Google links, and invalidate operator access.
  The supported single-process SQLite runtime serializes auth writes and account
  mutations before loading bindings so in-flight callbacks cannot recreate revoked
  sessions or provider links. This is not a multi-process deployment guarantee.
- `/api/business/*` requires a verified, active owner or admitted client and a
  completed installation. `/owner/*` adds an owner check. Shared booking/payment
  handlers enforce role and household ownership within the handler/service.
- Invitation acceptance requires a matching verified identity and an active,
  unexpired invitation. Merely signing in does not grant client or owner access.
- Unknown or unmounted APIs return JSON 404 `NOT_FOUND` after applicable guards;
  they never return the React shell. Authentication/setup guards can reject a
  request earlier. Unsupported auth operations use their own 404 response.

## Registered methods and paths

`:id` and `:clientId` are scoped record identifiers. Payment `:mode` is validated
as `test` or `live`. Normal Hono GET handling also supports HEAD; the readiness
probe registers HEAD explicitly.

### Public metadata and probes

```text
GET /api/branding/logo
GET /api/health
GET /api/installation
GET /api/ready
HEAD /api/ready
```

### Setup, owner settings and authentication

```text
DELETE /api/account/email
DELETE /api/setup/logo
GET /api/account/email
GET /api/auth/*
GET /api/owner/session
GET /api/setup/entry
GET /api/setup/status
POST /api/auth/*
POST /api/account/email
POST /api/account/email/confirm
POST /api/setup/complete
POST /api/setup/identity
POST /api/setup/lock
POST /api/setup/logo
POST /api/setup/owner
POST /api/setup/password/unlock
POST /api/setup/unlock
PUT /api/setup/appearance
PUT /api/setup/providers
```

### Invitation admission

```text
GET /api/portal/invitation
GET /api/portal/session
POST /api/portal/invitation/accept
POST /api/portal/invitation/open
```

### Owner CRM and business rules

```text
GET /api/business/owner/access
GET /api/business/owner/clients
GET /api/business/owner/clients/:id
GET /api/business/owner/financial-followups
GET /api/business/owner/financial-followups/:id
GET /api/business/owner/first-booking
GET /api/business/owner/pets
GET /api/business/owner/pets/:id
GET /api/business/owner/services
GET /api/business/owner/services/:id
POST /api/business/owner/clients
POST /api/business/owner/clients/:id/archive
POST /api/business/owner/clients/:id/invitation
POST /api/business/owner/clients/:id/reactivate
POST /api/business/owner/clients/:id/revoke
POST /api/business/owner/financial-followups/:id/resolve
POST /api/business/owner/pets/:id/archive
POST /api/business/owner/pets/:id/reactivate
POST /api/business/owner/pets/clients/:clientId
POST /api/business/owner/services
POST /api/business/owner/services/:id/archive
POST /api/business/owner/services/:id/reactivate
PUT /api/business/owner/clients/:id
PUT /api/business/owner/pets/:id
PUT /api/business/owner/pets/:id/notes
PUT /api/business/owner/policy
PUT /api/business/owner/services/:id
PUT /api/business/owner/services/:id/visibility
```

### Booking and household workspace

```text
GET /api/business/availability
GET /api/business/bookings
GET /api/business/bookings/:id
GET /api/business/household
GET /api/business/pets
GET /api/business/policy
GET /api/business/services
POST /api/business/bookings
POST /api/business/bookings/:id/transition
PUT /api/business/bookings/:id/notes
```

Future bookings follow the saved opening hours and minimum notice for both roles.
Only owners may send `overrides: { outsideHours: true, waiveNotice: true }` when
creating a booking; either flag may be used independently. Availability previews
accept the matching optional `outsideHours=true` and `waiveNotice=true` query
parameters. Clients cannot use these exceptions. Applied exceptions are saved in
the policy snapshot and booking history without changing the business rules.
Unavailable dates, the advance-booking limit and future booking conflicts still
apply. Owners can record fully ended visits separately as completed past bookings.

### Payment routes

```text
GET /api/business/payments/attempts/:id/refunds
GET /api/business/payments/bookings/:id
GET /api/business/payments/integrations
GET /api/business/payments/records
POST /api/business/payments/attempts/:id/expire
POST /api/business/payments/attempts/:id/reconcile
POST /api/business/payments/attempts/:id/refund
POST /api/business/payments/attempts/:id/void
POST /api/business/payments/bookings/:id/checkout
POST /api/business/payments/bookings/:id/credit
POST /api/business/payments/bookings/:id/manual
POST /api/business/payments/credits/:id/reverse
POST /api/business/payments/integrations/stripe/:mode/verify
POST /api/business/payments/refunds/:id/retry
POST /api/payments/webhooks/stripe/:mode
PUT /api/business/payments/integrations/stripe/:mode
PUT /api/business/payments/integrations/stripe/:mode/enabled
PUT /api/business/payments/mode
```

## Deliberately not mounted

- Old top-level CRM paths such as `/api/clients`, `/api/pets` and `/api/services`.
- Document/generic upload APIs, pet-photo APIs (including the owner namespace),
  background booking notifications and SaaS subscription/billing APIs.
- The old Cloudflare auth gateway/service and legacy sitter auto-provisioning
  middleware. Node uses `setupRoutes`, `businessIdentity` and `requireBusiness`.

Photo and document prototypes retain isolated unit tests, but those tests do not
establish a supported feature. Pet detail responses use `photoUrl: null`; existing
object keys/files and all applied migrations are preserved. Enabling uploads needs
an explicit feature review covering UI, routing, body limits, validation, private
access and backup behavior. Do not attach an old router merely to expose a helper.

Active authentication, CRM and runtime modules live under `server/`. Retained,
unmounted prototypes live under `server/experimental/`; production entry points
must not import them. Architecture tests enforce that separation.

## Browser pages

The frontend is a client-rendered React application; path-based navigation does
not require SSR. The server serves the shell for setup and workspace deep links.
The client validates the page path and access role:

- `/login`, `/setup`, and setup steps `/setup/account`, `/setup/email`,
  `/setup/business`, `/setup/verify`, `/setup/google`, `/setup/review`.
  `/setup/password-help`, `/setup/hosting-help`, `/setup/code` and
  `/setup/recovery` are setup help/installer access; recovery step paths use
  `/setup/recovery/:step` and do not bypass operator checks.
- `/app/bookings`, `/app/bookings/new`, `/app/bookings/:id`, with
  `/payments` and `/history` detail tabs.
- `/app/clients`, `/app/clients/new`, `/app/clients/:id`, with `/pets`
  and `/portal` tabs; pet editors use `/app/clients/:id/pets/:petId`.
- `/app/rates`, `/app/rates/new`, `/app/rates/:id`, `/app/rules`,
  `/app/cancellations`, `/app/cancellations/:id`, and `/app/payments`.
- `/app/pets` is the client's household view. Owner-only navigation is not
  authorization; the server separately enforces roles.
- `/app/settings/appearance`, `/app/settings/email`,
  `/app/settings/google`, and `/app/settings/payments`.

`/app` opens bookings; `/` and `/register` are entry paths, not public registration.
Only calendar view/date state belongs in query parameters. Old `?section=...`
links are not preserved. No drafts, credentials or private record content belong
in page URLs. Unknown workspace paths show a client-side not-found screen;
unrecognized setup steps fall back to the resumable setup flow. Shell responses
are HTTP 200, not server-rendered 404 pages.
