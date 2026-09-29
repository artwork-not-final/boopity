# Third-party notices

## Vendored UI components

`src/client/components/ui/{button,card,input,badge}.tsx` are adapted from the
shadcn/ui `new-york-v4` registry, retrieved 2026-09-08. Imports use the equivalent
local class merger and individual Radix Slot package. Upstream: https://ui.shadcn.com

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The notice above covers the vendored components only; their shadcn copyright
notice is preserved. Boopity's original application code is separately licensed
under [MIT](LICENSE), copyright (c) 2026 Artwork Not Final LLC.

## Installed dependencies and native binaries

The exact dependency/version/license metadata is in `package-lock.json`; each
installed package retains its own license/notice files. These are not relicensed
by the notice above or by Boopity's project license.

Browser notices are generated at `/third-party-licenses.txt`, including the CSS
imports and vendored UI notices. The image includes `/app/RUNTIME-NOTICES.txt`,
`/app/licenses/native-notices.txt`, Node's combined `/usr/local/LICENSE`, Debian
copyright files in `/usr/share/doc` and texts in `/usr/share/common-licenses`.
No npm package manager, Vite, Vitest or Lightning CSS binary is included in the
current runtime image.

Sharp declares Apache-2.0. Its native libvips bundle and dependencies include LGPL,
MPL, permissive and patent notices. LGPLv3 and its incorporated GPLv3 text are
included separately from the Apache license of the **build scripts**. Generated
native notices conservatively include source-only tools/tests; that does not
relicense the application. See [notice provenance](licenses/README.md).

Distribute the exact-image companion source archive alongside the image, with its
checksum and a clear download link. [Third-party sources](THIRD-PARTY-SOURCES.md)
describes its contents, modifications, rebuild/replacement instructions and the
publication gate. Local preparation is not public source availability or legal
certification. Do not publish an image based solely on package metadata.

## Lucide icons and release favicon

The release-only favicon uses the PawPrint geometry from the locked
`lucide-react@1.42.0` package, with a purple background and padding. It retains an
inline ISC notice. The unmodified upstream package license, including its notices
for Feather-derived icons, is in [licenses/lucide.txt](licenses/lucide.txt).
The application also imports icons through the installed `lucide-react` package.
See [Lucide's license](https://lucide.dev/license) and the exact reviewed source
hashes in [source provenance](docs/releases/source-review.md).

Historical dashboard/marketing images, the legacy favicon and imported legal
copy are excluded from the self-hosted release candidate. They have not been
cleared for later inclusion. See [the release checklist](docs/releases/releasing.md).
