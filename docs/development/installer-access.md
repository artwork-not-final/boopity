# Installer access and recovery

This is the operator reference. The normal flow opens a private setup link, then
asks the sitter for their name and email. There is no required setup password or
database connection string. Do not ask sitters to pick an access method.

## Open setup from the installer

- **Node:** `npm start` opens the initial link from an interactive local terminal.
  To reopen setup, keep the app running and use `npm run setup` in another terminal,
  from the same directory with the same environment and data path.
- **Docker on macOS/Linux:** run `sh scripts/start-docker.sh`. On macOS,
  `scripts/Start-Boopity.command` is also double-clickable. Docker must be running.
  The launcher builds and starts a fresh source installation in the background,
  waits for readiness, and opens its private link. No Node installation is needed
  on the host. For a released image, supply `BOOPITY_IMAGE` and add `--image`.
- **Quick Start for Mac download:** the top-level **Start Boopity.command** uses
  a pinned image and fixed loopback configuration packaged with the release.
  No environment variables or build tools are required. It uses a separate,
  stable `boopity-quick-start` Compose project and checks container/volume labels
  before reopening. A foreign project, occupied port, remote Docker connection,
  or orphaned data volume stops the launcher without resetting data. Unlike the
  general launcher, Quick Start refuses remote execution entirely. See the
  [Quick Start guide](../guides/docker-quick-start.md).
- **Other hosted installations:** retrieve the private startup link from your
  host's private console and give it only to the intended sitter. If needed, use
  the replacement-link commands below. Boopity cannot open a browser on a remote
  sitter's computer or provision an arbitrary hosting account.

Once an owner exists, the launcher opens `/app` for normal sign-in and does not
issue a setup credential. Before ownership, rerunning it replaces earlier setup
links and sessions, without clearing saved settings. These helpers use the existing
protected management commands; there is no public endpoint to mint setup access.

For an existing Docker container, the launcher starts it without rebuilding,
pulling an update or recreating it. It is not an upgrade tool. If you removed the
container but kept its data, follow the [upgrade guide](../guides/operations.md)
before building or selecting a different image. Windows users can use the manual
Compose and private-link commands below; the double-click launcher is macOS-only.

## Optional setup-password fallback

Supply `BOOPITY_SETUP_PASSWORD` privately before startup: 15–128 characters, with
no shared/default value. Use your host's private environment settings. For local Node,
use the gitignored `.env.self-hosted`; Compose uses its own private environment.
Never add a real password to an image, public template or `VITE_` variable.

A deliberately changed host value resets setup access and revokes existing setup
sessions on restart, without deleting saved settings. An unchanged host value does
not overwrite a previously saved setup password. Your account only collects name
and email; it does not create or change a password. Once the owner is established,
the password is permanently disabled and its verifiers are removed. Remove the
hosting setting then. Normal sign-in remains email codes and optional Google.

Public visitors cannot choose the initial password or claim an installation.
Existing passwords from older releases continue to work until owner verification.

## Separate installer forms

Use these paths on the installation's own origin:

- `/setup/code` — legacy host-provided setup codes, before ownership.
- `/setup/recovery` — settings repair after ownership.

These paths select a form only; they are not secrets and grant no access.
Credentials still go through the existing authenticated, rate-limited endpoints.
Never put a code/password in a query string. Both code types are one-use and expire
in 30 minutes. Setup sessions last seven days; recovery sessions last eight hours.
See [owner recovery](../guides/self-hosting.md#recover-access) for issuing a recovery code,
repairing email and handling a lost owner inbox.

## Missing or expired private link

Restart Boopity to get a new link if you have not started setup. Only the newest
link works. Once you have started, restarting preserves your seven-day browser
session instead of replacing it. Continue in the same browser.

If no setup password or email resumption is available and you lost that browser session, request a
replacement with the same data directory and configuration as the running app:

```sh
npm run setup
```

Or run the Docker launcher again. For a private console where automatic opening
is not useful, the underlying command remains:

```sh
npm run manage -- setup-link
```

Docker Compose:

```sh
docker compose exec boopity node dist/server/manage.mjs setup-link
```

The replacement ends earlier setup sessions but does not erase saved business details.
Commands and alternative methods are documented here, not offered on the sitter's
welcome screen. Recovery after owner creation still requires owner sign-in or the
separate recovery command; startup never creates another owner.

## For installers: keep startup output private

Without a setup password, the server prints the private link after it begins listening,
not during a build, health check or management status check. Treat runtime logs as
credentials; do not publish them or attach them to support tickets. If your host
exports logs to an untrusted/shared destination, set `BOOPITY_SETUP_LINK=manual`
before first startup and use the explicit command in a private console instead.

The link uses the configured
`APP_URL`, not a visitor-supplied hostname. The credential is in a URL fragment,
not a query parameter; the browser sends it to the existing same-origin unlock
endpoint only when Start setup is selected. Do not rewrite it into a query string.
Creating another link/code revokes earlier setup sessions, not a saved setup password. It cannot issue setup
access after an owner exists. The `setup-token` and recovery commands still work.

Automatic browser opening applies only in an interactive local terminal on a
matching HTTP loopback address. The Docker launcher additionally requires a local
Unix-socket Docker endpoint and the expected loopback port binding. SSH, CI,
remote Docker contexts and noninteractive runs only print the link. Set
`BOOPITY_OPEN_BROWSER=false` to disable opening. If no browser launcher is available,
the printed link still works. Manual Docker startup also works with
`docker compose up --build`; open its private **Finish setup** link, or use
`docker compose logs boopity` after starting it in the background.

Leave `BOOPITY_OWNER_EMAIL` and host email variables unset for a normal DIY-email
installation. The protected wizard selects the owner and saves email settings.
Only set the optional managed-email shortcut below when an installer deliberately
supplies a working email provider. Boopity does not supply hosting-specific
installation buttons or provision provider accounts.

## Optional shortcut: your installer already connected email

1. Open the website address provided by your hosting setup.
2. Enter your name and the owner email you selected there.
3. Select **Send my verification code**, check your inbox/spam folder, and enter
   the six-digit code. It expires in five minutes; only the newest code works.
4. Select **Verify & set up my business**. You are now the owner.
5. Customize your business name, colors, logo and booking time zone. Google is
   optional. Review and finish; client access stays off until you invite clients.

If you see **Finish your installation**, the hosting/email integration
has not completed. Unknown visitors cannot choose an owner or replace mail settings.
Return to hosting setup or contact whoever installed the site. Startup does not
send verification emails automatically. A private setup link/code can still open
the full wizard; host-managed email settings must be corrected on the host.

Never share email codes, setup tokens or credentials in support tickets. If an
owner already exists, sign in; repeating initial setup cannot replace them.

## Installer-managed email — developers/operators

- Keep Node/SQLite private persistent storage and same-origin HTTPS. See
  [Operations](../guides/operations.md). This shortcut does not configure a proxy or provision hosting.
- Supply `BOOPITY_OWNER_EMAIL` through trusted deployment settings before first
  setup. It is stored privately, never selected by an anonymous browser request.
- Supply the complete host-managed email group in [the installation guide](../guides/self-hosting.md),
  including explicit delivery mode and verified sender. SMTP and Resend are
  supported; there is no Boopity mail relay or shared provider account.
- `GET /api/setup/entry` returns a `mode`: `email`, `waiting`, `token`, `paused`, `resume`,
  `password`, `password-email`, or `owner`, plus a `started` boolean for welcome-screen wording.
  It never returns an inbox, token, credentials or provider configuration.
- `paused` means an identity was saved behind setup access but email is unavailable.
  `resume` permits only the saved inbox to request and verify a fresh, rate-limited
  Better Auth code. Only successful verification with current mail configuration
  can issue a seven-day setup cookie; an existing auth session alone cannot resume.
  Identity, provider changes and ownership are checked again before issuance.
- `email` permits the selected inbox to use the existing rate-limited Better Auth
  email-code endpoints. After verification the session explicitly posts a `name`
  to `/api/setup/owner`. The server atomically checks ownership and mail evidence.
- Missing configuration after pinning stays locked. Restore the original settings
  to resume. Changing the inbox before claim fails at startup, without retargeting.
- Do not enable this on partially configured data. It cannot take over an existing
  installation or serve as recovery. Claim permanently closes the shortcut;
  normal owner sign-in and operator-controlled recovery take over.
- Without a setup password, guided setting or explicit manual mode, fresh installs automatically print a private setup link.
  It uses the same protected one-time-token workflow and does not
  depend on this optional managed-email shortcut.

## Local, synthetic verification

```sh
npm run build
npm run test:setup-browser -- --guided
```

This opt-in fixture binds the app, synthetic SMTP sink and test inbox to loopback.
Open `http://localhost:3310`, use `owner@example.test`, and read the synthetic code
at `http://localhost:3311`. No real mail or credentials are used. Stop the fixture
when done; it removes only its own temporary test data.
