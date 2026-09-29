# Security

## Release status

This policy covers the self-hosted Boopity project under Artwork Not Final LLC
at [artwork-not-final/boopity](https://github.com/artwork-not-final/boopity).
There is no supported production release yet. The current self-hosted application
is a developer preview. The preserved .NET application and Cloudflare preview are
separate deployments, not supported self-hosted release channels.

Security reports about the current preview are welcome. After the first release,
any maintenance will target the latest self-hosted release. Older versions, custom
forks and legacy deployments have no promised security backports or support window.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for
[Boopity security advisories](https://github.com/artwork-not-final/boopity/security/advisories):
choose **Report a vulnerability** and submit a private report to the maintainers.
This is the security-reporting channel, not public Issues, Discussions or pull
requests. Do not post exploit details or affected customer information publicly.
If the private form is unavailable, ask where to report without disclosing the
vulnerability itself.

Share the affected version/runtime, a minimal synthetic reproduction, impact and
any proposed fix. Never send credentials, cookies, OTPs, private client records,
database backups or unredacted request bodies. Test only on installations you own
or are authorized to assess, using synthetic data. Please coordinate disclosure
privately so an issue can be assessed before details are published.

Reports are handled on a best-effort basis. Artwork Not Final LLC does not offer
a response deadline, security bounty, guaranteed fix or patch schedule. Filing a
report does not create a support agreement. See [SUPPORT.md](SUPPORT.md).

Maintainers should keep this repository's security-alert notifications enabled
and review incoming private reports. GitHub delivery preferences determine whether
notifications arrive on GitHub, by email or both; enabling reporting is not proof
that an email was delivered.

## Operator responsibilities

Use HTTPS and a restricted direct application port. Keep one Node process and a
private persistent local disk. Preserve installation keys with the database;
encrypt off-host backups and restrict who can restore them. Anyone with host
console access can recover owner settings and must be treated as an administrator.

Keep the runtime and dependencies patched. Configure the sitter's own providers
with minimal permissions. Monitor disk space, application health and provider
failures. A successful dependency audit or local test is not a penetration test.
Restore exercises must be network-isolated: copied credentials and pending work
can still affect the original email/payment account if the clone is started.

See [Operations](docs/guides/operations.md) for proxy, backup and recovery boundaries.
