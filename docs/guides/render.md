# Install on Render

Render runs Boopity for you, so you do not need to install Docker or use a terminal
on your computer. You own the Render account and pay Render directly. This is an
optional installation path; you can still [use another host](self-hosting.md).

## Before you start

Budget **about US$7.25/month** for one 512 MB web service ($7) and a 1 GB disk
($0.25) on Render's free Hobby workspace. Prices checked October 5, 2026; taxes,
extra usage, email delivery, off-site backups and a custom domain are not included.
Review the price Render shows before approving. Do not select the free web service:
it cannot keep Boopity's database on a persistent disk.

You will need a Render account, a payment method and an email service for sign-in
codes. You can connect email inside Boopity's setup wizard. Google and Stripe can
wait until later. There is no separate database to buy or connection string to enter.

Use this for a **new installation**, not to upgrade or replace an existing one.
If Render proposes changing an existing service, stop and use a new, empty
workspace instead. Never delete an existing installation's disk to start over.

## 1. Create your website

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/artwork-not-final/boopity)

1. Select **Deploy to Render** and sign in. Render may ask you to connect a GitHub
   account so it can read the public template; you do not need to clone the repo
   or create a container-registry token.
2. Review the proposed **boopity** web service and its **1 GB disk**. The template
   selects the published Boopity 1.0.0 image and supplies its website address
   automatically. Keep one instance and the disk at `/data`.
3. Check the monthly cost, then select **Deploy Blueprint**. Wait until the service
   shows **Live**. If you are asked to select a region, choose one near your clients.
4. Open the Blueprint's **Settings** and set **Auto Sync** to **No**. This keeps
   future changes to our template from changing your installation. Image updates
   remain your choice, not something Boopity pushes to your account.

The included `onrender.com` website address has HTTPS. You do not need to purchase
a domain to try Boopity.

## 2. Open setup

1. Open the **boopity** service in Render, then select **Logs**.
2. Find **Finish setup** and open the private link directly below it. If it is not
   clickable, copy the complete link into your browser's address bar.
3. Select **Start setup**, then follow the wizard. The
   [email guide](email-setup.md) helps you connect your email service.

Treat this link like a password. Do not share it or post startup logs in support
messages. It works once and expires after 30 minutes. You do not need to create a
setup password or generate authentication keys.

If the link expires before you start, restart the service from Render's menu and
use the newest **Finish setup** link. Once you have started, return in the same
browser; restarting does not erase your saved details or replace a valid setup
session. If you lose that browser session before email is connected, your installer
can use Render's **Shell** to run `node dist/server/manage.mjs setup-link`.
Do not share the resulting link. See [returning to setup](getting-started.md#come-back-later).

After setup, bookmark your website address. You will sign in with email codes or
Google, not with the private setup link.

## 3. Check before inviting clients

- Save a test service and confirm it is still there after restarting the service.
- Sign out and sign back in using a code delivered to your inbox.
- Set opening hours, offer a service in the portal, and try a client booking.
- Arrange a recoverable backup of the complete data directory and its private keys.
  Render's daily disk snapshots do not replace a tested, database-consistent,
  off-site backup. Follow the [backup guide](operations.md#backup-contract);
  get technical help if you cannot stop the writers and export the disk safely.

## Adding your own domain later

Start with Render's included address. When ready, follow
[Render's custom-domain instructions](https://render.com/docs/custom-domains).
Before changing it, keep Blueprint **Auto Sync** off and arrange a maintenance
window. Set `APP_URL` in the service's **Environment** settings to the exact new
HTTPS address, without a path, and redeploy. Update Google callbacks and Stripe
webhook URLs if you use them.

Use one canonical hostname. Render's HTTP health checks can choose any verified
custom domain, but Boopity accepts only its configured hostname. Multiple verified
domains (including an automatically added `www` alias) need an installer to review
the health-check and redirect configuration before you rely on them. Do not
disable Boopity's hostname checks or switch to an always-successful health check.

## Updates and keeping your data safe

The template pins a reviewed image digest. It does not automatically pull new
Boopity releases. Keep Blueprint **Auto Sync** off. Before updating the image in
Render, back up the full data directory, save the current image digest, and follow
the release's [upgrade instructions](operations.md#upgrades-and-rollback).

Keep the existing disk attached. Never delete it, change its mount path, switch to
the free service, or create multiple instances as an update method. A disk-backed
Render service has a brief interruption during deployments. Rolling back an image
alone is not a database rollback; restore its matching backup if needed.

## Validation and support

The template keeps the image's non-root user and uses `/api/ready` to check
database-backed readiness. It does not guess trusted proxy IPs. Without a reviewed
proxy configuration, clients can share an IP-based rate-limit budget. Do not add
wildcards or trust arbitrary forwarded headers to work around this.

The published image has local Docker/HTTPS validation. This new Blueprint still
needs a live Render acceptance check: disk permissions, setup link, email login,
restart persistence, proxy behavior and backup/restore. Static checks are not a
claim that a live Render installation has passed. Render does not apply our Compose
file; its runtime restrictions must be checked separately. Boopity provides
[best-effort community help](../../SUPPORT.md), not managed hosting or a support SLA.

Provider references: [pricing](https://render.com/pricing),
[image deployment](https://render.com/docs/deploying-an-image),
[persistent disks](https://render.com/docs/disks),
[Blueprints and Auto Sync](https://render.com/docs/infrastructure-as-code),
[environment references](https://render.com/docs/blueprint-spec#referencing-service-properties),
and [health checks](https://render.com/docs/health-checks).
