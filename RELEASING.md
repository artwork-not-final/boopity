# Release checklist

Boopity is a self-hosted developer preview. Passing local tests does not establish
that an unattended installation is production-ready for nontechnical sitters.
Publishing source, distributing an image and deploying an installation are
separate decisions.

## Verified baseline

The source promoted to the repository root passed 600 self-hosted tests, a fresh
locked install, type-checking, a production build and compiled startup/management
checks. The earlier packaged candidate also passed protected setup, email-code and
Google sign-in, client invitation acceptance, sandbox Checkout and a full refund.
An isolated stopped-volume backup/restore passed on the same application version.

These are bounded checks, not a security certification. Re-run verification for
each candidate; earlier image results do not certify a newly built image.

The later cleanup adds test type-checking, lint/format gates, API/error recovery,
feature-level UI modules and keyboard regressions. Use the current verification
output for its test count; the promotion results above are historical, not the
current candidate's certification. The [route inventory](API-ROUTES.md) is checked
against registered Node handlers. Prototype-only tests do not make deferred
uploads, background notifications or legacy auth runtimes supported features.

```sh
npm ci
npm run verify
npm run release:audit
npm audit
```

For a disposable, network-isolated same-image container recovery check:

```sh
docker build --tag boopity-local-qa .
BOOPITY_CONTAINER_QA=phase5-disposable node tests/integration/recovery-container-local.mjs boopity-local-qa
```

This uses only newly generated, labelled volumes and removes them afterward. It
does not touch business volumes or publish an image. Passing it does not replace
the release-to-release upgrade or hosted checks below.

For production dependency and authentication checks against the matching source:

```sh
BOOPITY_CONTAINER_QA=runtime-disposable node tests/integration/runtime-container-local.mjs boopity-local-qa .
```

This creates a fresh labelled volume, disables networking, checks native image
processing and uses synthetic email/Google responses. It also checks non-root
execution, read-only application files, absence of package managers/build tools,
and the shipped management command. It does not test live provider delivery.

CI also exercises the actual prebuilt Compose definition:

```sh
BOOPITY_CONTAINER_QA=compose-disposable node tests/integration/compose-container-local.mjs boopity-local-qa .
```

This checks runtime restrictions, synthetic setup/sign-in, compiled startup and
management, replacement, and stopped backup/new-volume restoration. It disables
networking and does not publish the service port. It creates and removes only
its own labelled containers/volumes; never supply a real installation or secrets.

For a release rebuild, use `docker build --pull --no-cache` with the chosen tag and
source snapshot. Base-image digests and Node are pinned, but Debian security
updates are intentionally resolved during the build. A cached OS-install layer
does not pick up newer patches. Record the final image digest/package inventory
and rescan that exact image; source identity alone is not binary reproducibility.

The test-only GitHub workflow uses synthetic records and no provider credentials.
It builds locally on the runner; it does not publish an image or deploy a site.
Real provider tests and browser harnesses remain opt-in.

The provider-neutral hosting contract has a separate offline container check:

```sh
BOOPITY_CONTAINER_QA=hosting-disposable node tests/integration/hosting-container-local.mjs boopity-local-qa
```

It uses explicit `APP_URL` configuration to check the canonical host, secure setup
cookies, repeated readiness probes and persisted access after container replacement.
It runs the shipped server on a private container loopback, not a public TLS endpoint.
It creates and removes only its own labelled resources, makes no external provider
calls and does not certify a hosting service. CI runs it alongside the Compose check.

## Populated upgrade rehearsal

The local cleanup candidate passed an offline `linux/arm64` rehearsal from the
root-promotion commit `08d0511815389593374f2e48c1e56e11cdae6250`. It retained
owner/client memberships, client/pet/service/booking records, private notes,
receipt/refund history, branding, uploads, authentication/settings keys and
decryptable email/Google configuration. The candidate restarted successfully;
restoring the stopped baseline backup into a new volume with the baseline image
discarded a deliberate post-upgrade edit. Both SQLite integrity checks passed.

This is a commit-to-candidate check, not an upgrade from a tagged supported
release. Both sources have package version `0.1.0` and the same 16 migrations;
no new schema migration was introduced. Existing unit tests separately exercise
upgrading the pre-payment schema. Repeat this rehearsal for each release pair.

To reproduce, export each source version and build each image from its matching
export. Pass local image tags and those source directories to the harness:

```sh
BOOPITY_CONTAINER_QA=upgrade-disposable node tests/integration/upgrade-container-local.mjs OLD_IMAGE NEW_IMAGE OLD_SOURCE NEW_SOURCE
```

The harness resolves immutable local image IDs, requires different images, bundles
the same fixture against each source and exercises the shipped management binary.
Only synthetic data and newly created, labelled volumes are used; containers have
no networking or published ports. It verifies 22 tables, keys, encrypted settings
and stored bytes. It removes its disposable volumes and backup afterward. Build
the image/source pairs together; this is not a tool for upgrading a business volume.

## Prepare a source-only candidate

```sh
npm run release:source
# Optional baseline snapshot (full commit ID required):
npm run release:source -- --commit FULL_COMMIT_ID
```

The exporter reads tracked and non-ignored new source, includes working-tree edits
and omits deleted files. It rejects private paths, symlinks (including parents),
binary/invalid UTF-8 input and heuristic secret findings. It does not edit source,
install dependencies, copy `.git`, create commits or publish anything. Review new
untracked files before exporting; exclusion rules are not a privacy certification.

Output is a new private `.release-candidates/source-*/source` directory with an
adjacent `manifest.json` recording every file's size, executable flag and SHA-256.
The printed manifest digest identifies this snapshot. Build/test this exact source
and scan it with a dedicated secret scanner before packaging. Repeat export and
scanning after any edit. Only the `source` directory is application source; private
QA reports, backups and neighboring candidates must never enter the public import.

## Before a supported production release

### Image notices and companion sources

The build generates browser notices at `/third-party-licenses.txt` and installed
runtime notices at `/app/RUNTIME-NOTICES.txt`. The image also carries `licenses/`,
including full native notices. Missing package notices fail the build; versioned
supplements must be reviewed when upgrading dependencies.

Prepare the matching [companion source materials](THIRD-PARTY-SOURCES.md) from the
final image inventories, then verify their manifest:

```sh
node scripts/verify-materials.mjs MATERIALS_DIRECTORY
```

Record the source-manifest digest, both immutable image IDs, companion-manifest
digest and archive SHA-256. Publish that archive with the approved image release;
a private archive or upstream links alone are not public source availability.
Archive integrity is not legal clearance or evidence of a native rebuild. Do not
include neighboring QA reports, credentials, installation data or backups.

### Remaining release gates

The [container review](CONTAINER-REVIEW.md) records local AMD64/ARM64 checks and
open runtime, dependency and binary-distribution findings. Passing architecture
tests does not clear the current image for publication.

- Rehearse the exact populated release-to-release upgrade and rollback. Retain records,
  uploads, keys, encrypted provider settings and payment history. A same-version
  restore is not an upgrade rehearsal.
- Validate the exact image on each advertised architecture and a representative
  deployment using the documented Docker/Node contract:
  persistent disk, HTTPS, cookies, callbacks, webhook retries and off-host recovery.
  Include client booking requests, sitter approval and allowed/late cancellation.
- Keep installation guidance provider-neutral. Operators choose their own host
  and must validate their proxy, persistent storage and backup configuration;
  no named-host certification or account provisioning is part of the release.
- Have a nontechnical sitter complete setup, DIY email, first bookings and the
  backup/update instructions without developer assistance. Check the current UI
  on mobile and Safari, with keyboard navigation and custom branding.
- Review the exact distributed image's dependencies, base layers, notices and
  corresponding-source obligations, including Sharp/libvips. A source license
  review does not clear container distribution.
- Re-scan the final source archive and any published history with a dedicated
  secret scanner. Review new copied code/assets and preserve their notices.
- Confirm publication scope, destination and any connected auto-deploy settings
  before pushing. Never publish installation data, private operational reports,
  provider exports or backups. The first public source import must not inherit
  the retired mixed repository's history or legacy recovery tags.

Use the approved [MIT license](LICENSE), [security policy](SECURITY.md) and
[best-effort community support policy](SUPPORT.md). Verify private vulnerability
reporting at the destination. There is no guaranteed response time or support SLA.

Preserve applied SQL migrations byte-for-byte. Add new migrations for schema
changes; rollback restores a stopped backup with its matching application version.
See [Operations](OPERATIONS.md) and [source provenance](SOURCE-REVIEW.md).
