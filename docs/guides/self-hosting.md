# Self-hosted installation — developer preview

Owner setup, OTP/optional Google login, recovery, branding, sitter CRM and invitation-only client
bookings, manual payment accounting and optional sitter-owned Stripe Checkout are implemented.
This is **not yet a production release**: Phase 4 sandbox validation passed, but Phase 5
public packaging and deployment validation remain open. The new application is
licensed under [MIT](../../LICENSE), copyright (c) 2026 Artwork Not Final LLC. Use synthetic data while
the remaining [release checks](../releases/releasing.md) are open. Retired application
installations are separate; these instructions do not modify or import them.

## Reference requirements

See [Operations](operations.md) for runtime requirements, a reverse-proxy example,
stopped-volume backup/restore, upgrade boundaries and troubleshooting.

- Node 24.21.0 (see `.nvmrc`), or Docker with Compose v2.
- One always-running application process, with a persistent local disk/volume.
- SQLite database, private uploads and generated private keys in `DATA_DIR`.
- SMTP or optional Resend for email codes; Google and Stripe are optional.

Ephemeral/serverless filesystems, multiple replicas, network-mounted SQLite and scale-to-zero
hosts are not supported by this reference. PostgreSQL, S3 and alternate runtime adapters are
extension points, not implemented drivers. The runtime is pinned and covered by integration tests.

## Use your own hosting provider

Choose a host you already use or one that meets the requirements above. Boopity
does not require a particular provider, provision servers or include provider-specific
deployment templates. You manage the hosting account; Boopity's wizard handles
your business, email delivery, appearance and sign-in settings.

1. Deploy the repository's `Dockerfile`, or build and run the Node app as shown below.
   If using a prebuilt image, use a reviewed release image pinned by digest with
   `compose.image.yaml`; no public image is available yet.
2. Attach persistent **local** storage before the first start. For Docker, mount it
   at `/data` and keep the image's non-root user (UID/GID 1000). Never store the
   database, uploads or installation keys on an ephemeral container filesystem.
3. Configure the settings below privately, then connect HTTPS and start one instance.
4. Open your website, enter the setup password and follow the wizard. Email, Google
   and online payments can be connected afterward.

| Setting                  | Hosted configuration                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | Your exact public HTTPS origin, such as `https://care.example.com`; no path. Host-supplied URLs are not auto-detected. |
| `BOOPITY_SETUP_PASSWORD` | A private password of 15–128 characters for initial setup. Remove the setting after owner verification.                |
| `DATA_DIR`               | The persistent storage path; `/data` in the Docker image.                                                              |
| `HOST` / `PORT`          | The private listening interface and port. The image uses `0.0.0.0:3000`; native Node defaults to `127.0.0.1:3000`.     |
| `NODE_ENV`               | `production`; already set in the Docker image.                                                                         |

Route public HTTPS traffic through a reverse proxy to the application's private
port. If the host asks for a health-check path, use `/api/ready` with the configured
public hostname; see [proxy and security settings](operations.md#public-origin-and-reverse-proxy).
Only set `TRUSTED_PROXY_IPS` after verifying the actual proxy addresses and header
handling. A hosting-provider name never enables proxy trust.

Keep one always-running instance and disable overlapping rolling deployments.
Back up the full data directory and installation keys before updates. Hosting,
HTTPS, backups and account costs remain your responsibility; see [Operations](operations.md).
Compatibility depends on these capabilities, not the provider's name.

If an older deployment automatically supplied its website URL, set `APP_URL`
explicitly before updating. The same configured URL is used for cookies, setup
links, Google callbacks and payment webhooks.

## Start locally

For setup passwords and private initial entry, see [the setup guide](getting-started.md).
Email does not need to be configured before opening the wizard; follow the
[DIY email guide](email-setup.md) inside setup. The commands below install the
application itself; no hosting dashboard or provider integration is needed.

Run in the source directory:

```sh
npm ci
npm run build
npm start
```

The wizard opens automatically from an interactive local terminal. If it does not,
click the **Finish setup** link printed by startup. The canonical origin is checked.
Startup creates `.boopity/boopity.sqlite`, `.boopity/uploads/`, `.boopity/auth-secret` and
`.boopity/settings-key`. Do not copy credentials or databases from retired installations.

Optional configuration goes in private, gitignored `.env.self-hosted`, following
`.env.self-hosted.example`. Start/dev-server/management commands load that file; process
environment takes precedence. Never use `VITE_` variables for secrets.

Open the printed **private setup link** and choose **Start setup**. Do not share it
or startup logs in chat, screenshots or support tickets. It expires in 30 minutes.
Before setup starts, a restart prints a replacement; only the newest link works.
In **Your account**, enter **Your name** and **Your email**. If no setup password
was supplied during installation, choose one here so you can return before email works.
An existing setup password is kept; this step does not ask you to change it.
Your seven-day HttpOnly browser session survives restarts; after expiry or on another
browser, use the password at `/setup`. Email codes are an alternative once delivery
is connected. Saved details survive refresh/restart; unsaved edits do not.
After owner creation the password is deleted; use owner sign-in or server recovery.

Alternatively, set `BOOPITY_SETUP_PASSWORD` privately before startup (15–128 characters).
Then opening `/setup` and entering that password replaces the initial private-link
step. This setting must never be in a public template or client-side variable.

Legacy codes and recovery use separate [installer access](../development/installer-access.md) addresses,
not choices on the welcome screen. Set `BOOPITY_SETUP_LINK=manual` before startup if runtime logs are not private,
and issue links only in a private console. `BOOPITY_OPEN_BROWSER=false` disables browser
opening. See [the setup guide](getting-started.md) for details.

For development, run `npm run dev:server` and `npm run dev` separately, then open exactly
`http://localhost:5173`. The proxy targets `http://localhost:3000` and rewrites only that exact
local Origin; foreign/missing origins remain rejected. Keep the default backend port/origin.
Test Google with the built same-origin app on port 3000.

## Start with Docker Compose

From the source directory:

```sh
docker compose up --build
```

If `BOOPITY_SETUP_PASSWORD` was supplied privately to Compose, open your website
and enter it. Otherwise click **Finish setup** in the output, then choose a password
in **Your account**. For background startup, view that initial link with
`docker compose logs boopity`. A container cannot open your computer's browser.
Compose binds only loopback. The image runs as
non-root `node`; the named `boopity-data` volume holds the installation. The health check
verifies database-backed HTTP readiness, not completion of owner setup or booking/payment phases.

`docker compose stop` / `start` stop/resume the app. `docker compose down` removes the
container/network but retains the volume. **Do not add `--volumes` or `-v`** unless you intend
to delete the installation and have a verified backup. Bind mounts must be writable by the
container's non-root user; a named volume is the simpler reference.

Compose supplies `APP_URL` (default `http://localhost:3000`) and optional
`BOOPITY_SETUP_PASSWORD` from its private environment; it does not load the Node-only
`.env.self-hosted`. Use a private Compose env file or the host's secret manager.
Builds exclude local secrets, runtime data and test files.

### Hosts without an interactive console

Set `BOOPITY_SETUP_PASSWORD` privately in the hosting dashboard before startup.
Open your website and enter it; no email connection or runtime-log link is needed.
If no password was supplied, private startup links remain an installer fallback.

For legacy automation that deliberately supplies its own setup credential:

Generate a strong random value of at least 32 characters (32 random bytes encoded as base64url
is suitable), set `BOOPITY_SETUP_TOKEN` in private host configuration, restart, and unlock
within 30 minutes. Remove the variable after use. For expiry/retry, use a **new** value.
Open `/setup/code` on your installation to enter the code. Supplying `BOOPITY_SETUP_TOKEN` disables
automatic link issuance so startup does not replace the host-managed credential.
Consumed, expired and replaced values are remembered; restarting or reverting an environment
value against the same database cannot reactivate them. Setup tokens never create a second owner.

## Complete the wizard

1. **Your account:** enter your name and email, then select **Save and continue**.
   Choose and confirm a setup password only if one was not supplied during installation.
   This is not public client registration.
2. **Email delivery:** save SMTP or optional Resend settings. Blank secret fields retain saved values;
   indicators replace their values. Saving does not send mail. Open **Using Resend** or
   **Using another provider (SMTP)** for help, or follow [the email setup guide](email-setup.md).
3. **Business:** save business name, time zone, currency and colors. Preview presets,
   discard edits or reset colors. PNG/JPEG/WebP logos are limited to 2 MiB and 4,194,304 pixels,
   decoded and re-encoded as metadata-free PNG at most 512px. SVG, malformed and oversized
   images are rejected. The site/login email uses the business identity and “Powered by Boopity”.
   Button text contrast is automatic; light primary colors get a warning and contrasting focus ring.
4. **Verify your inbox:** explicitly request a code and enter it from the selected inbox. Codes expire in
   five minutes and work once. Provider acceptance alone cannot claim ownership. Changed email
   settings require a fresh delivery and code verification before completing setup.
5. **Google sign-in (optional):** save your own Web application client credentials. Copy the exact origin
   and callback shown in the wizard into Google's client configuration. The callback is
   `APP_URL/api/auth/callback/google`, with no extra slash. Add the owner as a test user when
   Google's app is in Testing. Verify the owner by email first and use that same verified address
   in Google. Skipping Google keeps email-code login available. See the
   [Better Auth Google guide](https://better-auth.com/docs/authentication/google).
6. **Review & finish:** check database, writable private uploads and verified email readiness. Finish as
   the signed-in owner; a recovery token alone cannot finish. Google is optional.

After a code is sent, the resend button pauses for one minute. If the server applies a
longer request or verification limit, the affected button shows a countdown. Boopity
never sends another code automatically; a resend wait does not prevent you from
entering a code you already received.

Finishing setup opens Bookings. Use **Settings** in the workspace to change appearance,
email delivery or Google sign-in; you do not need to reopen the wizard.
Authentication never implicitly creates a sitter/owner. Currency choices in this preview are
USD, CAD, GBP, EUR, AUD and NZD. Saved bookings retain their original currency and timezone.

## Set up your workspace and client portal

1. **Clients & pets:** add each household and its pets. Contact and care records, emergency
   details and sitter notes are owner-only. Clients see pet name/species/breed/active status;
   they contact the sitter for changes. Archiving a client or changing their email revokes
   existing portal access and sessions. Reactivation alone does not restore access.
2. **Services & rates:** create timed visits or daily/date-range stays. Rates are private until
   explicitly offered in the portal. Prices are in the current business currency. An additional
   pet price of zero uses the base rate per pet; a positive value uses base plus that amount for
   each extra pet. Daily services multiply by the number of included local dates.
3. **Portal & rules:** the portal starts off. Set opening days/hours, blocked dates, advance
   notice, booking horizon and client cancellation notice. Approval requests are the default;
   optionally choose instant confirmation. An unanswered request reserves its slot until the
   configured hold expires, never later than the visit start. Expiry is processed by the local
   maintenance job and before business requests; expired holds never block new reservations.
   Without opening hours, no future times are available by default, including for the sitter.
4. **Invite:** enable the portal, select an active client with a valid email, and generate a
   private invitation link. Share it yourself; this version does **not** send invitation emails.
   Links expire after seven days and work once; replacement invalidates the previous link.
   The client opens it, verifies that exact inbox by OTP or Google, then explicitly accepts.
   Google Testing installations must also allow their invited test identities in Google.
   A link alone cannot grant access, and signing in cannot create an owner.
5. **Bookings:** clients request or instantly confirm a service for their own active pets.
   Availability shows only free choices, not another household's reservations. The server
   rechecks ownership, hours, capacity and current rates when saving; a stale slot returns a
   conflict. Review the saved amount and terms after creation. No money is collected.
6. **Approval and cancellation:** the owner reviews requests and approves or declines them.
   Clients may cancel until the saved deadline, inclusive; after it they must contact the sitter.
   The owner can make a documented cancellation exception. Reasons and visit updates are shared;
   the separate private-notes field is never returned to clients. Cancellation creates a financial
   review item, not a refund, charge, credit or payment-status change. Marking it reviewed records
   a note only. Workspace lists refresh when you return to the tab, unless an
   editor is open. Save or close the editor before reloading for other changes.

Turning the portal off ends client sessions and pauses access while keeping the owner's CRM
usable. Unexpired invitations can work again after re-enabling; revoke a client's access to
permanently invalidate their outstanding invitations. Each login belongs to one household.

This preview reserves **one concurrent booking per business**, including pending holds and
all-day stays. It does not yet model multiple staff, boarding capacity or recurring series.
By default, timed visits must fit one opening window and one local date. Date-range stays use inclusive
dates, up to 31 days, and block whole days; each date must be open and not blocked. Ambiguous
or missing DST times and timed visits crossing a clock change are rejected. Rules/rate/timezone
changes apply to new bookings; existing prices, cancellation terms and pending holds stay saved.
Sitters can explicitly waive minimum notice or book outside opening hours for an individual
booking. Applied exceptions appear in its history; unavailable dates, the booking horizon and
future conflicts still apply. Fully ended visits can be recorded as completed, including past
overlaps (with a warning), without recording a payment. Clients cannot use these exceptions
or backdate bookings.
There is no in-place rescheduling; cancel and create a new request to preserve the history.
No document uploads/sharing, pet-photo UI/API or background booking emails yet.
Stored files and migration history are preserved, but the deferred photo/document
routers are not mounted. See the [supported API routes](../development/api-routes.md).
See the [release status](../releases/releasing.md) for preview list limits.

## Payments: start without a provider

The main **Payments** page lists activity across every booking. Search by client or service,
or filter by recorded date, method and status. Dates use the business time zone. Receipts,
refunds and corrections each appear when recorded; totals cover all matching pages and keep
currencies separate. Unpaid checkout attempts and booking credits do not count as received
money. Actual payments are the default; sandbox activity has a separate view. Select a row
to open that booking's Payments tab.

Open a booking's details to see its saved currency, actual balance and separate sandbox balance.
The booking amount is never taken from the browser. A partial receipt remains partial.

- **Record money already received:** cash, check, bank transfer, Venmo, Zelle, PayPal, Cash App
  or other. These are recording labels, not integrations. Enter the amount actually collected;
  this never transfers money. Manual records always affect the actual ledger, even in sandbox mode.
- **Record returned refund:** only after you have returned manual funds outside Boopity.
  The confirmation is required. Pending online refunds do not count as returned money.
- **Void incorrect record:** correct an unrefunded manual receipt; no money moves and its
  original entry remains. Never use this to claim a real payment was refunded.
- **Booking credit:** reduce a charge for an agreed discount or waived cancellation fee.
  This does not return funds. A mistaken credit can be reversed, restoring the charge while
  retaining both entries. Check overpayment warnings before deciding on a separate refund.
- **Cancel / mark reviewed:** changes the booking or follow-up only. It never refunds, waives,
  deletes a payment or changes the original saved price. Late receipts reopen financial review.

Clients see their own balances and payment/refund statuses, without private accounting notes.
Only owners can record manual payments, credits/corrections or refunds. New online checkout is
available only for confirmed/completed bookings and the outstanding amount in the active mode.
Resolve an open/processing/unknown checkout before manually recording money in that same ledger.
**Refresh payments** reloads records; **Reconcile with provider** retrieves the current outcome.

## Optional sitter-owned Stripe

Nothing is sent to a central Boopity payment account. Use your own account; standard provider
fees still apply. The old SaaS `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and recurring price
are deliberately ignored on Node. No publishable key or pre-created recurring price is required.

1. Open **Settings → Payments** as the owner. Leave live credentials empty during testing.
   Start in your own sandbox. Create a restricted `rk_test_` key, not a full-access `sk_` key.
   Store credentials in the host's secrets vault where available; encrypted installation settings
   are the fallback. Never paste keys into chat, commit them or use `VITE_` variables.
2. The implementation calls the following resources. Grant only the necessary access in the
   restricted-key editor. This is the code-derived starting scope, **not yet a real-account
   certified permission preset**; validate all operations in the sandbox and inspect Stripe's
   request logs for missing-permission errors. Do not solve these by switching to a full key.

   | Resource / request                       | Access used                                                         |
   | ---------------------------------------- | ------------------------------------------------------------------- |
   | Own account (`GET /v1/account`), balance | Read: account identity, readiness and test/live proof               |
   | Checkout Sessions                        | Write (includes read): create, retrieve and expire sessions         |
   | Payment Intents, expanded latest Charge  | Read: exact receipt and dispute proof                               |
   | Refunds                                  | Write (includes read): create and enumerate current refund outcomes |

   Checkout uses inline `price_data.product_data`, not a saved catalog. Validate any additional
   scope reported for that operation in sandbox. No code calls payouts, transfers, subscriptions,
   connected accounts or webhook-creation APIs. Leave their write permissions disabled.
   See Stripe's [restricted-key guide](https://docs.stripe.com/keys/restricted-api-keys).

3. Register the exact displayed webhook URL for **your account**, not connected accounts:
   `APP_URL/api/payments/webhooks/stripe/test`. The live destination ends in `/live` instead.
   Use API version `2026-08-26.dahlia` (the installed Stripe SDK is 22.6.1) and subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`,
   `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`,
   `charge.dispute.updated` and `charge.dispute.closed`. A hosted destination requires HTTPS.
   For a local sandbox, use authorized Stripe CLI forwarding instead; its signing secret is
   different from a hosted destination's secret. Never forward live events into QA fixtures.
4. Save the matching restricted key and `whsec_` signing secret for that destination. Blank
   secret fields retain stored values; no saved secret is returned to the UI. Saving disables
   new checkout. **Verify account** makes read-only provider calls and pins its account identity.
   It does not prove all payment permissions or complete the end-to-end gate.
5. Send a signed sandbox test event to this installation, then **Refresh payment setup**. Only
   a valid signature for the current credentials and mode satisfies the webhook-readiness check.
   Enable sandbox checkout explicitly. Complete a controlled synthetic booking/payment/refund
   and inspect both Stripe and the local ledger before considering live use. The return URL
   alone is never receipt evidence. A delayed payment may remain processing after checkout.
6. After validation and deployment approval, configure a **separate** `rk_live_` key and live
   signing secret; verify the live account and signed destination, enable it and explicitly
   confirm live mode. Each mode is pinned to its original account. Rotate keys within that
   account; swapping accounts would strand old payment/refund references and is not supported.

Optional host overrides are whole pairs: `BOOPITY_STRIPE_TEST_KEY` plus
`BOOPITY_STRIPE_TEST_WEBHOOK_SECRET`, and separately `BOOPITY_STRIPE_LIVE_KEY` plus
`BOOPITY_STRIPE_LIVE_WEBHOOK_SECRET`. Either member makes that mode read-only in the UI;
an incomplete pair fails closed. Restart after changing environment. Changing a key invalidates
its account proof; changing the signing secret invalidates webhook proof. Re-verify before use.
Removing overrides restores the underlying encrypted values, subject to fresh verification.

Payment entry is hosted at `checkout.stripe.com`: Boopity never handles card numbers. Local
pages use sitter branding; configure external checkout branding in the sitter's Stripe account.
Payment methods come from Stripe's account configuration (no hard-coded card-only list).
ACH Direct Debit can be enabled there without changing Boopity's code. A completed Checkout
Session is not necessarily a successful bank payment: verification and settlement can remain
pending. Boopity shows the attempt as processing and waits for provider proof before recording
money. For manually entered accounts, clients follow Stripe's microdeposit-verification
instructions; Boopity does not collect bank details or verification codes. In production, confirm
Stripe's mandate/verification email settings as part of the sitter's provider setup. Canceling
a booking does not cancel a submitted bank debit or authorize a refund; review late settlements.
This preview has no custom checkout domains, automatic tax, tips, subscriptions, saved cards,
deposit schedule, invoices or client-selected installment amounts. Partial manual receipts are
supported; checkout collects the remaining balance. Supported currencies have two minor digits.

### Retries, refunds and operational limits

Repeated clicks reuse the existing checkout. An ambiguous response holds that booking's
payment reservation; **do not create a replacement payment or edit the database to clear it**.
Checkout creation reuses its original request for at most 55 minutes of a one-hour session.
After that, reconciliation/provider evidence is required. The server checks a bounded set of
payments each minute; successful payments are polled for 90 days. Signed webhooks and explicit
reconciliation also handle older records. Keep original credentials available for historical refunds.

Online refunds require an explicit owner confirmation and a private reason. The original
payment caps all pending/successful refund requests combined. If the response is lost,
**Retry same refund** reuses the stored request; it does not issue a replacement. Automatic
retry stops before Stripe's idempotency-retention boundary (Boopity uses 23 hours). An older
unknown request stays reserved for operator investigation. Reconcile it in the original account
before any further action; this preview does not offer a force-clear button.

Refund outcomes are retrieved from the provider, including refunds made in Stripe's Dashboard.
A refund that later fails gets a compensating entry, not rewritten history. Disputes create
financial review; dispute evidence, lost-chargeback adjustments, fees and payouts must be handled
in Stripe/accounting software. This is booking-level payment tracking, not a bank or general ledger.
No automatic refund occurs on cancellation or a dispute. Monitor the provider's webhook failures;
this preview has no payment email notifications or monitoring dashboard.

Payment records, accounting history and refunds now use 50-row pages; **totals use
all entries**, not only the displayed rows. The previous 200-attempt/500-entry preview
display caps no longer apply. One attempt is allocated to one booking in v1.
Other adapters can implement the provider/capability lifecycle, but Stripe is the only online
adapter shipped. See [release status](../releases/releasing.md).

Client, pet, service and booking lists have server-backed search and 50-row pages.
Search updates as you type across matching records, not just the current page.
Changing a filter/search starts at page one. Selected booking choices remain
selected across pages. Lists refresh when you return to the tab unless an editor
is open. Offset pages are not snapshots, so concurrent edits/inserts can shift later results.
See [release status](../releases/releasing.md).

## Configuration and security

| Setting                  | Default / behavior                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | `http://localhost:3000`; exact public origin without path/query. Non-local origins require HTTPS.                                                                                               |
| `HOST` / `PORT`          | Node: `127.0.0.1` / `3000`; container: `0.0.0.0` / `3000`.                                                                                                                                      |
| `DATA_DIR`               | Node: `.boopity`; container: `/data`. Persistent and private; never a public assets directory.                                                                                                  |
| `ASSET_DIR`              | `dist/self-hosted`; leave unchanged for the standard build.                                                                                                                                     |
| `BETTER_AUTH_SECRET`     | Optional strong secret, at least 32 characters; otherwise generated once in `DATA_DIR/auth-secret`.                                                                                             |
| `BOOPITY_SETUP_TOKEN`    | Optional one-time deployment-controlled claim, before owner creation only.                                                                                                                      |
| `BOOPITY_SETUP_PASSWORD` | Optional private 15–128 character password for unfinished setup. A changed value resets setup sessions on restart. Permanently disabled when the owner is established; remove the setting then. |
| `BOOPITY_SETUP_LINK`     | `auto` (default) prints a private link at startup; `manual` requires a private console command instead.                                                                                         |
| `BOOPITY_OPEN_BROWSER`   | `false` disables automatic local browser opening. Remote and noninteractive startup never launch a browser.                                                                                     |
| `BOOPITY_RECOVERY_TOKEN` | Optional new one-time settings-repair token for a claimed installation.                                                                                                                         |
| `TRUSTED_PROXY_IPS`      | Empty by default; comma-separated exact socket IPs, no wildcards.                                                                                                                               |

A future public deployment must terminate TLS at its reverse proxy, preserve canonical Host,
restrict direct Node-port access and set the actual HTTPS `APP_URL`. The proxy must replace
`X-Forwarded-For` with a **single validated client address**. Chains/untrusted headers are
ignored. Without a trusted proxy entry, requests share the proxy IP limit. This never bypasses
owner claiming. Production hosting remains a later release gate.

Static serving permits only the built shell, hashed JS/CSS assets and favicon. The sanitized
business logo is intentionally public through a dedicated route. Other uploads, databases,
environment files and keys are never public static files. Public config contains only branding,
readiness and login-availability flags.

UI provider credentials are encrypted with AES-256-GCM using the separate generated
`DATA_DIR/settings-key`. Passwords, API keys and Google client secrets are never returned by
settings APIs. They necessarily exist briefly while entered and in process memory; encryption
does not protect a compromised server. Google is identity-only: account identifiers remain,
but Google access, refresh and ID tokens are not persisted.

### Environment precedence

Overrides apply to **whole groups**, not individual fields:

- Any `SMTP_HOST`, `RESEND_API_KEY` or `EMAIL_FROM` makes email host-managed/read-only in the UI.
  Supply a complete group, including `EMAIL_DELIVERY_MODE=live`, or `restricted` plus
  `EMAIL_TEST_RECIPIENT` for controlled tests. Partial groups fail closed.
- Either `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` makes Google host-managed. Both are needed
  to enable it.
- Underlying UI values remain encrypted and become active again after removing the override
  and restarting. Blank secret inputs preserve values. Disabling a provider does not erase them.

SMTP uses `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for direct TLS), optional
`SMTP_USERNAME` / `SMTP_PASSWORD`, and `EMAIL_FROM`. STARTTLS is required otherwise.
SMTP takes precedence over Resend when both are host-configured. Loopback tests can explicitly
use `SMTP_INSECURE_LOCAL=true`; it never permits plaintext for non-loopback hosts. Leave it
unset on hosted installations.

No provider calls are made at startup. Contact and scheduled email delivery remain disabled.
Development can use a local SMTP sink; use real credentials only for intentional provider tests.
Ambiguous SMTP sends are not blindly retried. SaaS subscriptions/reconciliation never run here;
sitter-owned checkout is a separate Phase 4 integration.

## Recovery, persistence and upgrades

Startup applies immutable, checksummed SQL migrations transactionally and refuses changed
applied migrations. Historical unused SaaS tables remain during transition; they enable neither
subscriptions nor data imports.

Preserve the **whole data directory/volume**, including private uploads, SQLite sidecars,
`auth-secret` and `settings-key`. For a simple consistent backup, stop the app before copying
it. Copying a live `.sqlite` file alone is not a safe backup. Recover host-managed secrets
separately. Losing settings-key makes stored credentials unreadable; losing/changing auth-secret
invalidates login material. Never casually delete or rotate either key. Protect backups like
live data and test restoration into a separate installation.

An existing database missing its original private keys now fails startup instead of generating
replacements. Restore the complete snapshot and original host-managed authentication secret.
Local stopped-copy and prior-schema upgrade regression tests are included, but a supported public
release and deployment validation remain open. Follow the [operations runbook](operations.md).
Container replacement preserves the volume; volume deletion does not. An older image may not
understand a newer schema.

### Recover access

If email or Google configuration is broken, an authorized host operator can run:

```sh
npm run manage -- recovery-token
```

For Compose, use `docker compose exec boopity node dist/server/manage.mjs recovery-token`.
Open `/setup/recovery` on your installation and enter it. This address only
selects the form; it does not grant access. The 30-minute one-time token creates
an eight-hour settings-repair session, **not an owner login**. Repair delivery, then sign in
with a fresh email code. Console-less hosts can set a new `BOOPITY_RECOVERY_TOKEN`, restart
and remove it after use; the same no-reuse rules apply.

If the owner has lost their inbox:

```sh
npm run manage -- set-owner-email replacement@example.com
```

Use the corresponding Compose exec prefix in containers. This preserves owner/business IDs
and records, marks the new inbox unverified, revokes owner sessions, Google links, pending codes
and operator sessions, and reopens setup. It refuses automatic merging with another account.
Verify the new inbox and finish setup again. If email delivery also needs repair, issue a new
recovery token first. `npm run manage -- status` reports claim/setup status without secrets.

## Verification

```sh
npm run verify
node tests/integration/self-hosted-smoke.mjs
```

The smoke test requires a running local app on port 3000; use `SELF_HOSTED_SMOKE_URL` for a
different local port. Remote targets are rejected. It checks health, protected setup/portal,
unauthorized business requests, static assets, headers and private-file boundaries. Verify runs temporary
SQLite/auth tests, the Node build and compiled management-command checks. Mail/Google test
calls are intercepted; no real emails or charges are required.

`npm run test:setup-browser` starts isolated local app/SMTP/inbox servers on 3310/3325/3311.
It has a deliberately fixed test-only token in the test source, no real credentials and no
outbound delivery. Follow its local instructions, then Ctrl-C to stop and remove its temporary
data. Never expose this harness beyond your machine or enter real addresses/secrets.

`npm run test:portal-browser` starts a separate disposable app on port 3330 with synthetic owner,
client and pet records. Its `/__qa_inbox` page captures only synthetic local sign-in codes; no
email leaves the process. Sign in as `owner@example.test`. Use only the harness's `.test`
addresses and Ctrl-C afterwards to remove its generated data. Never expose this harness publicly.

The container fixture requires an explicit disposable-QA marker and is excluded from images.
It is not an installation or migration command. See [release status](../releases/releasing.md),
[release status](../releases/releasing.md)
and the historical [release status](../releases/releasing.md).

## Next phases

Phase 4 payment implementation and controlled sandbox validation are complete. Phase 5 is
preparing sanitization, host/recovery guides, large-list performance and public
packaging. See [the release checklist](../releases/releasing.md). A local build does not authorize
deployment or publication.
