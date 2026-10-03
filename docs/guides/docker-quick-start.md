# Docker Quick Start for Mac

Run Boopity on your own Mac without typing commands. This is a local installation,
not a public website for clients. Docker Desktop must already be installed.

## Start Boopity

1. Open Docker Desktop and wait until it is running.
2. In the [Boopity releases](https://github.com/artwork-not-final/boopity/releases),
   choose the **Quick Start for Mac** asset, named
   `boopity-VERSION-quick-start-macos.zip`, if that release includes it. You do not
   need the source or source-materials archives to use this launcher.
3. Unzip the download and move **Boopity Quick Start** somewhere convenient,
   such as Documents.
4. Double-click **Start Boopity.command** at the top of that folder.
5. Follow the [setup wizard](getting-started.md) in your browser.

The first launch downloads the release's pinned image. A Terminal window shows
progress; there are no commands to type. If the browser does not open, use the
private link printed there. Keep that link out of screenshots and support messages.

Boopity creates its database and private keys automatically. No setup password,
Node installation, registry login, or database connection string is needed.
You still need your own [email-service settings](email-setup.md) to finish setup.

This is an unsigned shell launcher, not a signed/notarized Mac app. macOS can ask
for approval or block a download. Only use official release assets and follow
[Apple's guidance](https://support.apple.com/en-us/102445) for software you trust.
Do not disable system security. The archive's executable bit is preserved, but
that does not bypass download security checks.

## Come back later

With Docker running, open [Boopity](http://localhost:3000), or double-click
**Start Boopity.command** again. Once your owner account exists, it opens normal
sign-in. Before that, the launcher replaces earlier private setup links and setup
sessions, but keeps your saved business details.

Closing Terminal does not stop Boopity. Use Docker Desktop to stop or restart it.
Your Mac and Docker must stay running while you use this local installation.

## Keep your data

Quick Start uses one stable Docker project, `boopity-quick-start`, and the named
volume `boopity-quick-start_boopity-data`. Moving the extracted folder or downloading
another copy reopens the same installation. Do not delete its Docker volume or
use Docker's reset/delete-data options. Follow the [backup guide](operations.md).

Opening a newer bundle does **not** update an existing container. Updates are an
explicit, backed-up operation using the [update guide](operations.md). If the
container was deleted but its volume remains, the launcher stops rather than
opening saved data with an arbitrary release. Follow the recovery guide.

## Already have an installation?

Keep using its original launcher. Quick Start does not adopt, import or overwrite
an installation created from source, Node, manual Compose, or another host.
If another app is using port 3000, it explains the conflict without stopping it.
It also detects stopped Boopity Compose installations configured for that port.
Do not delete an existing installation to make room for Quick Start.

Quick Start only uses local Docker connections, not SSH or remote Docker contexts.
It ignores nearby `.env` files and Compose override environment variables. Its
packaged configuration is already complete; email and branding belong in the wizard.

## Other computers and public hosting

The first bundle is for macOS. Windows still uses the manual Docker instructions;
there is no tested Windows double-click launcher yet. Linux operators can use the
ordinary image/Compose installation documented in the [hosting guide](self-hosting.md).

For a client-facing website, use your own host, HTTPS and persistent storage.
This launcher does not create hosting accounts, expose the app to the internet,
set up a domain, or arrange off-computer backups.
