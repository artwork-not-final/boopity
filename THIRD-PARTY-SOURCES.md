# Third-party source materials

The self-hosted image includes components under their own licenses. Boopity is
MIT-licensed; that does not replace the terms of Node, Debian, Sharp/libvips or
their dependencies. This document describes the technical release materials, not
a legal opinion or a written source-offer commitment by Artwork Not Final LLC.

## What travels with an image release

Publish a companion archive alongside each immutable image release, with an
explicit link from its release notes and registry description. Keep it available
for recipients of that image; do not substitute links to upstream homepages or a
newer version's sources. A private local archive does not fulfill public source
availability. Publication requires a separate approval and destination check.

The archive must contain:

- The exact Boopity source snapshot, Dockerfile, lockfile, migrations and source
  manifest used to build the images, without Git history or installation data.
- Image IDs, architecture-specific package inventories, native component versions
  and a SHA-256 manifest covering every companion file.
- Original Debian source packages (`.dsc`, upstream archives, Debian patches and
  packaging/build rules) for every installed source/version pair, with the signed
  repository indexes used by APT. Both current architectures use the same 56
  source/version pairs. Installed copyright files and common licenses are retained.
- Node 24.21.0's complete source archive, its upstream checksum list, Node's
  combined notice, and the pinned Docker Node build recipe. Node's embedded
  dependencies and build instructions are in that source archive.
- Lockfile-integrity-verified npm package archives for the union of installed
  ARM64/AMD64 packages and browser/CSS dependencies, plus missing-notice supplements.
  These are upstream packages, not a claim that every npm file is preferred source.
- Sharp 0.35.4 source and sharp-libvips 1.3.3 build scripts, platform toolchain files,
  version inventory, external patches, each native dependency's source archive,
  and the 350 registry crate sources/checksums in librsvg 2.62.91's Cargo.lock.

The native collection includes GLib's bundled GVDB and libvips' bundled libnsgif.
It includes a conservative superset (for example proxy-libintl, which the glibc
Linux recipe does not build, and Rust test/other-platform dependencies).
Do not infer which features are active from the source archive count alone.

## Build and modification record

Boopity does not patch the upstream native binaries installed by the npm lockfile.
The upstream sharp-libvips recipe **does** modify its dependencies: retain its
complete `build/posix.sh`, platform configuration, inline edits and these four
external patches: GLib without GRegex, mozjpeg's pinned commit patch, libultrahdr
PR 383 and the libvips C++ SONAME patch. Preserve the downloaded patch bytes and
checksums rather than relying on a mutable pull-request URL.

The Linux recipe statically combines native dependencies into `libvips-cpp.so`
and dynamically links that combined library to the Sharp addon. It disables many
optional libraries; inspect the recorded recipe rather than building with generic
system defaults. Its toolchain container installs compilers, Meson, CMake, Ninja,
cargo-c and Rust nightly. Their versions are not fully pinned upstream; source
availability is **not** a promise of a bit-for-bit reproducible native binary.

Fontconfig 2.18.3 is the original, unpatched GitLab source archive mirrored inside
Cygwin's checksum-verified source package. Do not apply Cygwin's separate patch.
libtiff 4.7.2 comes from its official OSGeo release archive. These two inputs use
bzip2/xz instead of the recipe's gzip Git archives; adjust the corresponding tar
decompression flags when rebuilding. Download provenance is recorded separately.

To rebuild a library, unpack the relevant source, apply the recorded upstream
patches/edits and use the matching architecture's configuration from sharp-libvips.
For librsvg, use the supplied Cargo.lock and registry archives; apply the upstream
feature edits before resolving the workspace. Verify any resulting lockfile uses
only the recorded dependency versions. Its sources, library API headers and full
application/addon source are supplied; no proprietary object files or keys are
needed. Keep all original license and copyright notices.

For Debian, unpack the matching `.dsc` with `dpkg-source -x`, then use its
`debian/rules` and declared build dependencies in a matching Debian build
environment. For Node, use `BUILDING.md` from its source and the supplied official
Docker Node recipe. For Boopity, follow [RELEASING.md](RELEASING.md) using its
matching snapshot. Use a new image tag when replacing any component and retest.

## Replacing LGPL libraries

Users may modify the LGPL libraries and reverse-engineer the combined work to
debug those modifications as their licenses permit. Boopity adds no restriction
or signature check preventing replacement. Read-only runtime files protect an
installation; they do not prevent building a derivative image.

The shared library is at
`/app/node_modules/@img/sharp-libvips-linux-ARCH/lib/libvips-cpp.so.8.18.6`, where
ARCH is `arm64` or `x64`. Inspect the exact image inventory for the filename.
Rebuild the combined library with the recorded ABI/SONAME, then copy it into a new
image based on the reviewed image. Keep the final `USER node`, ownership and
readability of application files. Alternatively rebuild Sharp against a compatible
system libvips using Sharp's documented source-build procedure. Re-run native PNG,
authentication, HTTP and recovery tests; ABI compatibility remains your responsibility.

The original [LGPLv3](https://www.gnu.org/licenses/lgpl-3.0.html),
[GPLv3](https://www.gnu.org/licenses/gpl-3.0.html) and
[MPL executable-distribution terms](https://www.mozilla.org/en-US/MPL/2.0/)
govern where applicable. Cairo's source retains its original LGPL-2.1/MPL-1.1
choices; sharp-libvips' notice identifies its use under MPL-2.0. Both original
texts and provenance are retained rather than rewriting upstream notices.

## Updating the materials

For every runtime/dependency change, recollect from the **final image**, verify
source/version coverage on both architectures, regenerate native notices with
`node scripts/native-notices.mjs MATERIALS_DIRECTORY licenses/native-notices.txt`,
rebuild and rescan. The ordinary build creates `/third-party-licenses.txt` for the
browser and `/app/RUNTIME-NOTICES.txt` inside the image. Source archives stay out of
the application image and do not add setup steps for sitters.

Verify the assembled companion archive with `node scripts/verify-materials.mjs
MATERIALS_DIRECTORY`. Retain its manifest and archive checksum in the release
record. Source collection is not a substitute for security testing, a native
rebuild/relink exercise, or qualified review of any uncertain license obligations.
