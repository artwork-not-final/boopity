BOOPITY QUICK START FOR MAC

1. Open Docker Desktop and wait until it is running.
2. Keep this extracted folder somewhere convenient, such as Documents.
3. Double-click Start Boopity.command.
4. Your browser opens Boopity. Follow the setup wizard.

You do not need Node, a setup password, or a database connection string.
You will need your own email-service settings to finish setup and receive
sign-in codes. Saving email settings does not send mail automatically.

The first start downloads the released image and may take a few minutes.
A Terminal window shows progress; you do not need to type any commands.
If it displays a private setup link instead of opening a browser, open the
link yourself. Never share the link, your sign-in codes, or your API keys.

COMING BACK

With Docker running, visit http://localhost:3000 or double-click Start Boopity.
Before ownership is verified, opening the launcher issues a new private setup
link and ends earlier setup sessions. Your saved details stay. Once the owner
is verified, it opens normal sign-in instead. You can close the Terminal window;
Boopity keeps running. Stop or restart it from Docker Desktop when needed.

YOUR DATA AND UPDATES

Your data is in Docker's boopity-quick-start_boopity-data volume, not this folder.
Do not delete that volume or use Docker's delete-data/reset options. Keep backups.
Moving or downloading another copy of this folder uses the same Quick Start
installation on this computer. The launcher does not upgrade, downgrade,
recreate, or reset an existing container. Updates are a separate operation.
If only the saved-data volume remains, the launcher stops rather than guessing
which image should open it. Follow the recovery guide below.

ALREADY HAVE BOOPITY?

Keep using your existing launcher. Quick Start does not import other installations.
If port 3000 is occupied, it stops with a message rather than replacing anything.
Do not delete your existing installation to make room for this download.

IF YOUR MAC BLOCKS THE DOWNLOAD

Only use a bundle from Boopity's official GitHub release. This shell launcher
is not a signed/notarized Mac app, and macOS may ask for approval or block it.
Follow Apple's guidance for software you trust; do not disable system security.
https://support.apple.com/en-us/102445

LOCAL COMPUTER ONLY

This bundle runs on this computer at http://localhost:3000. It does not publish
a website for clients or configure hosting, HTTPS, or off-computer backups.
Remote Docker connections and SSH sessions are not supported by this launcher.
Windows users should use the documented manual Docker installation for now.

GUIDES

Setup: https://github.com/artwork-not-final/boopity/blob/main/docs/guides/getting-started.md
Email: https://github.com/artwork-not-final/boopity/blob/main/docs/guides/email-setup.md
Backups, updates and recovery: https://github.com/artwork-not-final/boopity/blob/main/docs/guides/operations.md
Hosting: https://github.com/artwork-not-final/boopity/blob/main/docs/guides/self-hosting.md

RELEASE

Application: __VERSION__ (developer preview, not a supported production release)
Image: __IMAGE__
Source, security notes, licenses and companion source materials:
https://github.com/artwork-not-final/boopity/releases/tag/v__VERSION__

This download contains only the launcher and its configuration, not the
application or its dependencies. BUNDLE.json records the included file hashes
and pinned application image. LICENSE applies to Boopity's original code.
