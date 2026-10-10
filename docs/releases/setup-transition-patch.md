# Boopity 1.0.2

## Changes

- Keep the setup loading screen visible until private-link access and session
  refresh finish, avoiding a flash of the missing-link screen.
- Show a neutral loading screen after sign-in instead of installation-check text.
- Update Sharp to 0.35.5, including librsvg 2.63.2, for
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
- Refresh the matching native-library notices and source materials.

## Updating

Back up your complete data directory and hosting settings before upgrading.
Use the versioned `ghcr.io/artwork-not-final/boopity:1.0.2` image, or the immutable
digest listed with the [release downloads](https://github.com/artwork-not-final/boopity/releases/tag/v1.0.2).
Keep your existing data volume and configuration. This patch adds no migrations
and does not require repeating setup.

Updates are an explicit operator action. Publishing this release does not update
existing installations. For rollback, use the previous image with its matching
stopped backup.

The release includes application source, third-party source materials, checksums
and a verification record for the distributed images. Read the attached security
review for known base-image advisories and the limits of the checks performed.
