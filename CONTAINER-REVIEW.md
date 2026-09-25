# Container release review

Reviewed 2026-09-17. Status: **Trixie runtime hardened; residual High findings
reviewed; companion source materials prepared locally. Publication is not cleared**.
This is a technical inventory and release checklist, not legal
advice or a claim that every dependency is safe or every license obligation is met.

## Current candidate: Debian Trixie

The maintained Dockerfile uses Node 24.21.0 and Debian Trixie, both digest-pinned,
and installs available Debian updates during build. It removes all setuid/setgid
bits while retaining ordinary non-root shell/tar recovery commands. Compose adds
a read-only root filesystem, dropped capabilities, no-new-privileges and a bounded
temporary filesystem. No migration or application dependency version changed in
this hardening step.

Both architectures contain 84 application npm manifests, no base-image package
managers and 81 Debian packages representing 56 source/version pairs. The same
pinned offline scanner/database described below reports:

| Critical | High | Medium | Low | Unknown | Unique advisory IDs |
| -------- | ---- | ------ | --- | ------- | ------------------- |
| 0        | 43   | 47     | 56  | 1       | 64                  |

All 147 package/advisory matches are Debian matches; none are npm matches. No
High/Critical match has a fixed version recorded for the installed Trixie package.
There are **no ignores, severity filters or VEX suppressions**. The table is not
a count of demonstrated application exploits, and absence of a recorded fix is
not proof of safety. Native components and Node's embedded dependencies are not
completely covered by this scan.

### Disposition of the eight remaining High advisory IDs

These cover all 43 High matches, including repeated matches against binary
packages from one source. The assessment is conditional on the supplied
non-root image and documented hosting restrictions; it does not mark vulnerable
package versions as patched.

| Advisory / matches                                                              | Shipped component and disposition                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642), 9 | util-linux mount helper/post-hook privilege handling. Boopity never invokes mount helpers; the image has no setuid programs and runs as UID 1000. Privileged mount workflows remain outside this assessment.    |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408), 9 | util-linux `nsenter --join-cgroup` requires a privileged operator. Boopity does not invoke it or join host namespaces. Root/privileged execution is not covered.                                                |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409), 9 | util-linux `X-mount.subdir` path handling. The supplied fstab has no mounts and the app has no mount workflow or privileges. Do not add authorized privileged mounts.                                           |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410), 9 | util-linux restricted bind-mount authorization. No setuid mount executable or configured fstab mount remains in the image. This removes the described privileged path, not the underlying code.                 |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369), 1 | libacl privileged pathname-based ACL handling. No application ACL call path; documented archive operations run non-root on stopped data. Privileged ACL restoration is not covered.                             |
| [CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742), 2 | Scanner matches libsystemd/libudev source packages; the affected systemd-homed daemon is not installed. Absence is checked in both runtime fixtures.                                                            |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720), 3 | ncurses `infocmp` input handling. The utility is present but never invoked by Boopity. Manually passing hostile terminal data to it is outside the application assessment; it is not claimed patched or absent. |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538), 1   | Perl Archive::Tar resource exhaustion. Minimal perl-base is present, but Archive::Tar is absent; a module-import check is part of the runtime fixture.                                                          |

The current vendor tracker records fixes for some of these in Debian unstable,
not Trixie. Do not mix unstable packages into this image to silence a scanner.
Rebuild with available supported updates and repeat this assessment for each
release; changing the runtime privileges or invoking these utilities changes it.
Medium/Low findings remain in the unsuppressed report and are not individually
cleared by the High-priority disposition above.

### Validation and distribution record

ARM64 and emulated AMD64 pass compiled HTTP/security/notices checks, native PNG
processing, synthetic OTP/Google authentication and session revocation, uninvited
user rejection, shipped management, and populated Bookworm-to-Trixie
upgrade/rollback. The 512 MiB / 0.5 CPU AMD64 setup/restart simulation also passes.
These are isolated local tests, not real provider or hosted certification.

Generated browser/runtime notices, complete native license texts and an exact
source companion are described in [THIRD-PARTY-SOURCES.md](THIRD-PARTY-SOURCES.md).
The companion includes Debian, Node, npm, Sharp/libvips sources, patches and Rust
crates, with per-file checksums and architecture inventories. Immutable image IDs,
the exact application source manifest and the final archive checksum travel in
the candidate's release record; the private archive is not yet public availability.
A from-source native rebuild has not been performed and source collection alone
does not establish legal clearance or bit-for-bit reproducibility.

The sections below preserve earlier evidence; their images and counts are
**historical**, not the current Trixie candidate.

## Historical runtime refresh: Bookworm

The Dockerfile now copies Node 24.21.0 from a pinned official Node image into a
pinned Debian Bookworm runtime, applying available Debian updates during build.
Development and CI use the same `.nvmrc`. npm, Corepack, Yarn, headers and install
caches stay outside the final image. Application files are root-owned/readable,
while `/data` retains the existing non-root owner and private-key behavior.

Production installation uses the unchanged lockfile with
`npm ci --omit=dev --legacy-peer-deps --ignore-scripts`. `--omit=peer` alone still
installed Vite/Vitest in the tested npm version; disabling automatic peer installs
removed that optional toolchain without deleting arbitrary package directories.
Required runtime dependencies, including native Sharp packages, remain. The unused
WASM fallback and Lightning CSS also no longer appear in the installed inventory.
Normal development peer resolution is unchanged.

| Measurement                               | Original image | Refreshed image |
| ----------------------------------------- | -------------- | --------------- |
| Application package manifests             | 144            | 84              |
| Base Node-tool package manifests          | 203            | 0               |
| Debian packages                           | 88             | 92              |
| Docker-reported ARM64 size, decimal MB    | 733            | 502             |
| Docker-reported AMD64 size, decimal MB    | 720            | 484             |
| Critical / High scanner matches           | 7 / 86         | 4 / 52          |
| High/Critical matches with a recorded fix | 37             | 0               |
| npm-ecosystem vulnerability matches       | 38             | 0               |

Sizes were recorded after both images were unpacked; they are not registry
download sizes. The additional OS packages provide system CA certificates and
runtime libraries. Debian copyright files and Node's combined notices are retained.
The same offline Trivy version/database described below scanned both refreshed
images with no suppressions. Each returned 234 matches across 105 advisory IDs:
4 Critical, 52 High, 96 Medium, 81 Low and 1 Unknown, all from Debian packages.
No recorded available fix is **not** equivalent to no vulnerability.

Validation passed on ARM64 and emulated AMD64: compiled HTTP/health checks, native
PNG processing, OTP owner claim/session/revocation, synthetic Google callback and
uninvited-user rejection, management, and populated old-image-to-new-image
upgrade/rollback. The constrained AMD64 setup/restart simulation passed again.
The full suite passed on Node 24.21.0: **748 tests in 66 files**, type-checking,
lint, formatting, build, management and startup. CI now includes the offline
production-dependency/authentication smoke, not real provider requests.

Final local image IDs:

- ARM64: `sha256:ad5505b0c10d7fa969f2490369516909667f2fd65a53a482f0f7b2fabb3a3535`
- AMD64: `sha256:0da6c74b8c3678a164d3c9b6aeafe0a9579d31def0eaa61ec475ed3a93696587`

Both were built from a 297-file source snapshot with manifest SHA-256
`5b49e0770402eb9e7237d5c051a5575aa5e0cc1a1d34894962e79768b74e98f9`.
This summary was added after that build and does not change runtime contents.
The preceding 294-file candidate described below was the rollback baseline.
No application logic, package versions in the lockfile, or migrations changed.

### Work remaining at the Bookworm checkpoint (superseded above)

Review remaining Debian findings for the actual distributed components and
runtime use before publication. Initial checks on both architectures found
64-bit Perl and no `Archive::Tar` module. Debian's descriptions for
[CVE-2026-8376](https://security-tracker.debian.org/tracker/CVE-2026-8376) and
[CVE-2026-42496](https://security-tracker.debian.org/tracker/CVE-2026-42496)
concern 32-bit Perl and that archive module respectively; these checks suggest
limited applicability, not blanket clearance for Perl or the image. The other
Critical matches, `CVE-2026-13221` and `CVE-2023-45853`, and the remaining High
matches still need documented disposition. No vulnerability ignores were added.

The native-library notice/corresponding-source work below remains open. Hosted
and nontechnical-user testing also remain separate release gates. Nothing was
published, deployed, or installed globally on the development machine.

## Original candidate and tests (before refresh)

The source-only candidate has 294 files and manifest SHA-256
`6ad13e2cf9300d8a6853208dfff01002937d5d0842d0577395440fb0d182fe99`.
Images were built locally from that source without installation data or Git history.

| Architecture | Local image ID                                                            | Result                                                                                                                 |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Linux ARM64  | `sha256:c514069c21c1f2eeb47ce3f1cfa91afb26c7844bc3ea972a7930b329d756f799` | HTTP and native image-processing smoke pass; populated upgrade/rollback passed in the preceding gate                   |
| Linux AMD64  | `sha256:4bc1fb037c2a14e4281cf31483a6605df6b9dfdddd9a780e49e266866c3493fd` | Build, HTTP, native image processing, setup/restart and populated upgrade/rollback pass under Docker Desktop emulation |

The AMD64 baseline image was built from root-promotion commit
`08d0511815389593374f2e48c1e56e11cdae6250`:
`sha256:f9026f44783cecdfcfcb8cf6cc97f824ddb85c4696c9b21d6aff9fc781a27df6`.
Both versions are `0.1.0` with the same 16 migrations. This is a commit-to-candidate
rehearsal, not compatibility certification for a tagged supported release.

The AMD64 setup simulation used a non-root container limited to 512 MiB and 0.5
CPU: canonical-host rejection, repeated readiness checks, the compiled health
probe, protected setup, secure-cookie attributes and identity/key/session retention
after container replacement passed. No real TLS connection or provider was used.
The upgrade rehearsal checked 22 tables, encrypted settings, files, keys, payment
history and restoration of a stopped backup after a deliberate post-upgrade edit.
All tests used generated, labelled volumes with no networking or host ports.

HTTP smoke checks cover public configuration, locked APIs, private-file denial,
CSP, robots rules and fingerprinted built assets. The smoke script's obsolete
503 expectation for retired APIs was corrected to the current 404 contract.
Sharp generated and decoded a PNG on both architectures. Emulation does not
establish performance, native AMD64 host compatibility, public HTTPS, live-provider
behavior or sufficient capacity for a real business.

## Original runtime dependency inventory

Each image contains 144 application npm packages, 203 package manifests from
base-image Node tools, and 88 Debian packages. The latter all retain a readable
`/usr/share/doc/<package>/copyright`; common license texts are in
`/usr/share/common-licenses`. Node's combined notice is `/usr/local/LICENSE`.
Inventory counts describe installed manifests, not a complete native-component SBOM.

Important retained components:

- Node 24.13.0 and Debian Bookworm; npm, Corepack and Yarn are also present.
- Sharp 0.35.4, the platform-specific native binding, and
  `@img/sharp-libvips-linux-{arm64,x64}` 1.3.3 containing libvips 8.18.6 and its
  bundled native dependencies.
- An additional `@img/sharp-wasm32` binary, even though the native binding works.
- Vite 8.2.2, Vitest 4.1.11, their native toolchain and Lightning CSS. `npm explain`
  traces these through Better Auth's optional Vitest peer. `--omit=dev` alone did
  **not** keep them out of this runtime image.

## Original image vulnerability scan

Trivy 0.74.0 scanned both exported images locally with networking disabled, no
Docker socket, no custom ignores and telemetry disabled. Its vulnerability database
was updated at `2026-09-17T07:06:17Z`. The scanner image was pinned to
`aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969`.
Neither application source nor images were uploaded to a scanning service.

Both architectures returned the same matched package/advisory counts:

| Location         | Critical | High | Medium | Low | Unknown |
| ---------------- | -------- | ---- | ------ | --- | ------- |
| Debian packages  | 6        | 59   | 118    | 81  | 1       |
| Bundled npm tool | 1        | 27   | 8      | 2   | 0       |
| Total            | 7        | 86   | 126    | 83  | 1       |

These 303 matches represent 165 unique advisory IDs, not 303 demonstrated exploits
in Boopity. Thirty-seven High/Critical matches have a fixed version recorded by
the scanner. Examples include `libgnutls30` and npm's bundled `tar`. Some other
matches require vendor/component applicability review; neither deferred fixes nor
scanner severity alone establishes application exploitability.

All 38 npm-ecosystem matches were under
`/usr/local/lib/node_modules/npm/node_modules`, not `/app/node_modules`. This
explains why a clean application-lockfile npm audit did not establish a clean
container. A successful scanner exit means the scan completed, not that it passed
a vulnerability gate.

This scan does not establish complete coverage of Node's embedded components or
Sharp's combined native libraries. Upstream runtime advisories and a complete
native-component inventory still need separate review. Refresh and reduce the
image, then rescan and document remaining findings rather than suppressing them
just to obtain a clean result.

## Original findings and follow-up

### 1. Refresh and pin the runtime/base image — addressed above

The original Dockerfile and `.nvmrc` specified Node 24.13.0. Node's subsequent
[March security release](https://nodejs.org/en/blog/vulnerability/march-2026-security-releases)
and [July security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)
include fixes on the Node 24 line. The currently listed LTS is
[24.21.0](https://nodejs.org/en/blog/release/v24.21.0). Not every advisory applies
to Boopity's usage, but the old runtime cannot be cleared by a clean npm audit.

Use a current supported Node 24 patch and refreshed base layers, record the
multi-architecture digest, align development/CI pins, then rerun tests, image scans
and recovery. Do not silently retag an older reviewed image as the new release.

### 2. Reduce unintended runtime content — addressed above

Keep Vite/Vitest and other build-only packages out of the final image. Evaluate
the dependency/peer installation strategy rather than deleting arbitrary package
directories after installation. Do not omit all optional dependencies: Sharp uses
platform-specific optional packages. Verify image processing and all authentication
paths after changing installation flags. Assess whether npm, Corepack, Yarn and the
unused WASM fallback need to be distributed at all, while preserving the documented
management and recovery commands.

### 3. Complete the binary distribution materials

Boopity's MIT license does not replace third-party terms. Native libvips packages
retain a README license inventory, but that is not the complete corresponding
source and notice bundle for all bundled libraries. The
[versioned upstream notices](https://github.com/lovell/sharp-libvips/blob/v1.3.3/THIRD-PARTY-NOTICES.md)
identify LGPL components, Cairo under MPL-2.0, and additional permissive/patent
notices. The [matching build scripts](https://github.com/lovell/sharp-libvips/blob/v1.3.3/build/posix.sh)
also use patches and statically combine dependencies; merely linking a libvips
homepage is not evidence that the distributed binary can be rebuilt or relinked.

Before publishing, prepare a versioned companion source/notices bundle for the
actual final image: applicable library sources, patches, build instructions,
license texts, copyright notices and any required relinking materials. Review the
WASM binary separately if retained. Also cover distributed Debian programs, Node
and their bundled components—not just application npm packages. See the
[Debian image licensing guidance](https://hub.docker.com/_/debian),
[LGPLv3 terms](https://www.gnu.org/licenses/lgpl-3.0.html) and
[MPL-2.0 executable-distribution terms](https://www.mozilla.org/en-US/MPL/2.0/).

Some installed npm packages have no standalone file with a conventional
LICENSE/COPYING/NOTICE name. Check README, parent-package and upstream-version
coverage before calling these omissions; preserve or supply the applicable notices.
This review has not produced a complete corresponding-source bundle or made a
written source-offer commitment on behalf of the publisher. Get qualified license
review where the obligations for the chosen distribution remain uncertain.

## Release decision

Keep the current images and companion local. The supported-base refresh, runtime
hardening, High-priority applicability review and source-material preparation are
complete; residual scanner matches remain visible. Publish only after separately
confirming destination, version tags, source-companion availability and
deployment side effects. Nothing in this review adds a setup task for sitters.
The remaining hosted and nontechnical-user gates are in [RELEASING.md](RELEASING.md).
