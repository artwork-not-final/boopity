# Render installation prototype

**Not yet a released installer or a completed hosted validation.** The prebuilt
image must first pass the binary-release review and be available in a registry.
This document describes the candidate path, not a working Deploy button.

Render is the first managed-container target because sitters can use its web
dashboard instead of administering a VPS. The same image and persistent `/data`
directory also work with [Docker Compose](compose.image.yaml) on other hosts.
No central Boopity account, mail relay or subscription is required.

## Cost and limits

The proposed validation uses a Hobby workspace, one `0.5c-512mb` web service
($7/month) and a 1 GB disk ($0.25/month): **$7.25/month base**, before taxes,
bandwidth overages and optional email/domain costs. Recheck the
[current pricing](https://render.com/pricing) and checkout before purchasing.
The free service cannot attach the persistent disk needed by this installation.
The 1 GB disk is a starting trial size, not a promise of unlimited photo storage.

One process and one instance only. Do not add autoscaling, a second replica or
a network/shared SQLite filesystem. Updates have downtime because a disk-backed
service must stop the old instance before starting the next one. See
[persistent disk limitations](https://render.com/docs/disks).

## Intended sitter journey

1. Open the released deployment template and sign in to your own Render account.
2. Choose a setup password (15–128 characters) in the private
   `BOOPITY_SETUP_PASSWORD` field. Save it in your password manager. Review the
   service and disk cost, then approve deployment. Email, Google and payments come later.
3. Open the website URL, enter your setup password and select **Start setup**.
   You do not need a link from runtime logs.
4. Set up your business in the wizard. Follow the [email guide](EMAIL-SETUP.md),
   configure your own provider and verify your inbox before creating the owner.
   Start with manual payments; Google and online payments can be configured later.

The seven-day browser session survives restarts. If it expires or you switch
browsers, enter the same setup password. If forgotten, use an email code once
email is working, or change the private hosting setting and restart. After owner
verification the setup password is deleted; remove its Environment setting and
use normal email-code or Google sign-in. This flow is implemented locally;
the new image is not published and the revised dashboard journey still needs validation.

Existing templates that supply `BOOPITY_SETUP_TOKEN` retain their host-code flow
at the separate [installer access](INSTALLER-ACCESS.md) address. The new template omits that variable. If runtime logs
are shared or exported outside your trusted operators, set `BOOPITY_SETUP_LINK=manual`
and issue a link only in a private console.

## Maintainer preparation

Build and review the clean exported source, not the mixed working checkout. Render
requires a `linux/amd64` image; retain its exact registry digest for updates and
rollback. No application data or credentials belong in an image layer.

`npm run hosting:render -- REGISTRY_IMAGE@sha256:DIGEST` prints a Blueprint as
JSON (also valid YAML). Replace the argument with the actual reviewed registry
reference. Missing values, tags and obvious placeholder digests are rejected.
The tool does not verify registry availability, publish an image, write files or
create a Render resource. A registry reference in generated output is not proof
that an image exists. Save the output as `render.yaml` in the reviewed deployment
repository and validate it with Render before offering a deployment button.

The Blueprint uses `runtime: image` rather than `runtime: docker`: Render pulls
the built image, it does not compile the application. `BOOPITY_SETUP_PASSWORD`
uses `sync: false`, prompting privately during initial Blueprint creation without
embedding a password in the source. Existing services need this variable added
manually in their Environment dashboard; a later sync does not prompt for it.
The template mounts `/data`, sets one instance and checks
`/api/ready`. Database migrations run on application startup against the mounted
disk, never in a pre-deploy job without that disk. See the
[Blueprint reference](https://render.com/docs/blueprint-spec) and
[image deployment requirements](https://render.com/docs/deploying-an-image).

Image-backed services do not automatically pull an updated tag. Nevertheless,
an upstream Blueprint sync can still change their configuration or image digest:
disable automatic Blueprint synchronization for the sitter's installation and
verify this in the dashboard before launch. A release must never silently update
all sitters. Require a consistent backup and an explicit approved update.

`BOOPITY_HOSTING=render` enables the optional adapter. In the absence of `APP_URL`,
it validates Render's documented `RENDER_EXTERNAL_URL` and matching hostname.
The server and loopback health check use the same canonical-origin validation.
Do not set these `RENDER_*` values yourself on a live service. No incoming Host or
forwarding header chooses the canonical origin. Adding a custom domain later
requires verified DNS/TLS, an explicit `APP_URL` and updated OAuth callbacks.

The template deliberately leaves `TRUSTED_PROXY_IPS` unset. Boopity does not trust
unverified forwarded client-IP headers. Until Render's proxy behavior is verified,
visitors behind the same proxy share a conservative rate-limit budget. This is
safe against simple forged-header bypasses but can block legitimate users. It is
a **hosting acceptance blocker**, not a certified production configuration.

## Validation required before recommending to sitters

- Paid checkout/account authorization and an available reviewed image.
- Provider-side Blueprint validation, private setup-password entry and first wizard
  entry from desktop and mobile, including expired sessions and forgotten passwords.
- Non-root persistent disk permissions; preserved settings, photos and private
  keys after restart and after replacement with the same image.
- Canonical HTTPS, host checks, reliable probes and verified client-IP/proxy trust.
- Controlled DIY email delivery and owner claim, with no payment charges.
- Consistent off-host backup, independent restore and failed-update recovery.
  Render disk snapshots alone are not a verified SQLite-and-private-keys backup.
- An actual nontechnical sitter completes the path; record where help is needed.

Until these checks pass, this is a local prototype. Existing VPS installations
and all provider accounts remain independent of it.
