# Boopity

Self-hosted pet-sitting software. One installation, one business—no Boopity
subscription or central account.

**Developer preview:** ready for controlled testing, not yet a supported production
release. See the [remaining release checks](docs/releases/releasing.md).

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
Select **Start setup**, then add your name, email and a setup password in **Your account**.
The wizard walks you through email delivery and your business settings.

If you already supplied a setup password in your hosting settings, open `/setup`
and enter it instead. You will not be asked to choose another password.
Keep setup links, passwords and provider credentials private. See the
[setup guide](docs/guides/getting-started.md) for returning later or getting help.

For development with live reload, see [Contributing](CONTRIBUTING.md).

## Run with Docker

```sh
docker compose up --build
```

Open **Finish setup** in the output, or open `http://localhost:3000/setup` if you
supplied a private setup password. The Compose file keeps data in a persistent
volume and binds the app to localhost. For a hosted installation, configure HTTPS
and follow [Use your own hosting provider](docs/guides/self-hosting.md#use-your-own-hosting-provider).
This builds locally; a reviewed public image is not available yet. Boopity does
not create hosting accounts or manage deployments for you.

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
