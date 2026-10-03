# Boopity

Self-hosted pet-sitting software. One installation, one business—no Boopity
subscription or central account.

**Community-supported:** you manage your installation; help and maintenance are
best-effort, with no support SLA. Use a tagged [release](https://github.com/artwork-not-final/boopity/releases)
and follow the [installation and backup guides](docs/README.md).

## What it does

- Manage clients, pets, services, bookings and payment records.
- Invite clients to book and cancel within your rules.
- Record payments manually or connect your own Stripe account.
- Sign in with email codes or Google.
- Set your business name, logo and colors, with a “Powered by Boopity” footer.

Built with React, Vite, Hono, Better Auth, Tailwind CSS and shadcn-derived components.
Bring your own hosting: Boopity runs with Docker or Node on a host you choose.

## Run locally

Use Node 24.21.0 (see `.nvmrc`). Run these commands from the repository root:

```sh
npm ci
npm run build
npm start
```

On a fresh installation, Boopity opens a private **Finish setup** link when started
in an interactive local terminal. If it does not open, use the link in the terminal.
Select **Start setup**, then add your name and email in **Your account**.
The wizard walks you through email delivery and your business settings.

No database connection string or setup password is needed. Boopity creates its
SQLite database and private keys in `.boopity`. Keep that folder safe.
To reopen unfinished setup without your browser session, leave the app running
and use `npm run setup` in another terminal with the same configuration.
Keep setup links and provider credentials private. See the
[setup guide](docs/guides/getting-started.md) for returning later or getting help.

For development with live reload, see [Contributing](CONTRIBUTING.md).

## Run with Docker

**On a Mac:** use the **Quick Start for Mac** ZIP attached to a release, when
available. Unzip it, open Docker Desktop, then double-click **Start Boopity.command**
at the top of the extracted folder. The released image is already selected;
there are no commands or image hashes to copy. See the
[Quick Start guide](docs/guides/docker-quick-start.md) for requirements and limits.

**From a source checkout** (developers and other platforms):

```sh
sh scripts/start-docker.sh
```

On macOS, you can also double-click `scripts/Start-Boopity.command` with Docker
running. The launcher starts Boopity in the background and opens its private setup
link locally. If a browser cannot be opened, it prints the link instead. Run the
launcher again to reopen setup, or to open sign-in after setup is complete.

The Compose file creates a persistent data volume, including the SQLite database;
there is no connection string to enter. It binds the app to localhost. For a hosted installation, configure HTTPS
and follow [Use your own hosting provider](docs/guides/self-hosting.md#use-your-own-hosting-provider).
This command builds the checked-out source. To use a published image, set
`BOOPITY_IMAGE` to the digest from a [release](https://github.com/artwork-not-final/boopity/releases)
and add `--image`. Published images contain that release's UI, not unreleased source changes.
Boopity does not create hosting accounts or manage deployments for you. A private
host-configured setup password remains an optional fallback, not a wizard requirement.

Boopity currently needs one always-running Node process and a persistent local
disk. It uses SQLite and private file storage; ephemeral disks, multiple replicas
and scale-to-zero are not supported. The initial booking model supports one
concurrent booking per business. Other databases, storage systems and payment
providers are extension points, not shipped integrations.

## Guides

Browse the [documentation index](docs/README.md), or go straight to:

- [Installation and configuration](docs/guides/self-hosting.md)
- [Setup access](docs/guides/getting-started.md) and [email setup](docs/guides/email-setup.md)
- [Backups, upgrades and recovery](docs/guides/operations.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md) and [support](SUPPORT.md)
- [Architecture and folder ownership](docs/development/architecture.md)
- [Release checks](docs/releases/releasing.md) and [source provenance](docs/releases/source-review.md)

## License

Boopity's original application code is [MIT licensed](LICENSE), copyright (c) 2026
Artwork Not Final LLC. Preserve the [third-party notices](THIRD-PARTY-NOTICES.md).
The retired .NET application is not part of this source tree and is not relicensed.

Public project: [artwork-not-final/boopity](https://github.com/artwork-not-final/boopity).
