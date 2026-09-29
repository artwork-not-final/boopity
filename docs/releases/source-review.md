# Source provenance and distribution scope

Initial attribution review: 2026-09-08. Source-tree transition: 2026-09-16.
This is a bounded inventory and attribution review, not a legal opinion, security
certification or independent proof of authorship for every line.

## Included source

Boopity-specific TypeScript, SQL, styles, configuration, guides and synthetic tests
are distributed under the owner-approved [MIT license](../../LICENSE), copyright (c)
2026 Artwork Not Final LLC. That project license decision is the basis for their
inclusion; it does not relicense copied third-party material or dependencies.
The known copied UI code and icon geometry are separately attributed below.

The self-hosted source is maintained directly at the repository root. The earlier
export's snapshot manifest is not a live inventory of this changing checkout;
release archives need their own exact file list, hashes and secret scan. Git tracks
the source and the npm lockfile records package versions and integrity hashes.
All 16 SQL migrations are preserved, not edited to remove legacy schema names.
Portable helpers and the Node runtime now live under `server/`; unmounted
prototypes are isolated in `server/experimental/`. There is no requirement to host
on Cloudflare. Application behavior is covered separately by the retained tests;
this review does not claim a new line-by-line security audit of every handler.

## Copied UI components

The initial four `src/client/components/ui/` components were based on the official
shadcn/ui `new-york-v4` registry. They have since received local styling changes;
the table below describes the initially inspected upstream content, not today's
local files. Additional Select, Popover and Command primitives are shadcn-derived
adaptations using Radix UI and cmdk. The complete shadcn MIT notice is retained in
[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md), checked against the
[upstream license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

Registry source and SHA-256 of each retrieved component's content:

| Component | Registry source                                                             | Content SHA-256                                                    |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Button    | [Official registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json) | `79dd6f75f8136394442202d6b8b922fb269eaad0a5dba579397c9d5b41f893bb` |
| Card      | [Official registry](https://ui.shadcn.com/r/styles/new-york-v4/card.json)   | `ef8305b12c3112dab42a4708b41b1ebcc042fa5ab4c20f039da8d45b09ed5059` |
| Input     | [Official registry](https://ui.shadcn.com/r/styles/new-york-v4/input.json)  | `0c9457181f6ddc80969bcf854e92c362903a55b6e889fbef3fd85343ecc4af5b` |
| Badge     | [Official registry](https://ui.shadcn.com/r/styles/new-york-v4/badge.json)  | `13a9380dfff853ee730c14a52df49f22aecd31f40f2998d7c1e7ec458b6e1650` |

The registry URLs can change. These hashes identify the inspected content, not a
promise that future registry downloads will remain identical. Review the actual
adapted files and dependency notices when preparing each release.

## Images, icons and fonts

The only shipped static image is `public/favicon.svg`. Its paw geometry is copied
from the already-locked `lucide-react@1.42.0` PawPrint icon used in the application's
React UI. A plain purple background and padding adapt it for a browser tab. Its
inline ISC notice travels with the SVG; the complete installed Lucide/Feather
license is also retained in [licenses/lucide.txt](../../licenses/lucide.txt).

- Upstream package: [lucide-react](https://www.npmjs.com/package/lucide-react/v/1.42.0).
- Inspected `dist/esm/icons/paw-print.mjs` SHA-256:
  `64344557800af461c2365386777e77901d383e51dd96f3923aaad8b587b9f1b9`.
- Unmodified package LICENSE SHA-256:
  `b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57`.
- [Upstream license explanation](https://lucide.dev/license).

The previous legacy favicon is excluded from this candidate. There are no shipped
photographs, customer logos/screenshots, stock illustrations, embedded raster data,
font files or downloaded web fonts. CSS uses names of locally available/system
fonts; it does not redistribute those fonts. Sitter uploads are runtime data, not
release assets. Neither source review nor icon attribution is trademark clearance.

## Installed dependencies versus source distribution

The committed `package-lock.json` records dependencies across supported package
platforms, including their license metadata. Generate a fresh dependency inventory
for each distribution instead of relying on the earlier export's snapshot. Resolved
tarballs retain their integrity hashes; bundled entries are identified separately.
The inventory includes permissive licenses as well as MPL and LGPL expressions.
Dependencies are installed by the operator, not vendored in this source archive.
Their own license and notice files must be retained; Boopity's MIT license does not
replace them.

No prebuilt application bundle, native library or container layer is included.
The Dockerfile is source for a local build, not a reviewed binary distribution.
Redistributing built images or application bundles requires a separate review of
their exact included dependencies, notices and applicable corresponding-source
materials. In particular, Sharp/libvips and base-image native components are not
cleared by this source-only review. See [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

## Excluded material and release boundary

The legacy .NET application, old SaaS client/marketing entry point, imported legal
copy, historical screenshots, Cloudflare deployment configuration, operational
notes and provider exports are excluded. So are `.git`, installed dependencies,
build output, private environment files, database/uploads/keys, backups and logs.
Blank configuration examples and synthetic QA fixtures are intentionally included.
Legacy code is preserved separately for recovery, without relicensing it. Local
maintenance branches may retain that old history; replacing the current source
tree does not erase history. The initial public import must use clean history.

Recheck the exact release file list and secret scan after any change. Review any new copied
code/asset and preserve its notices before adding it. Publication remains separate
from this review; [the release checklist](releasing.md) lists the operational gates.
