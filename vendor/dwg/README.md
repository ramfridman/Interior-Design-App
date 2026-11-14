# Vendored DWG reader (GNU LibreDWG, WebAssembly)

- `libredwg-web.js` - the Emscripten JavaScript glue of **@mlightcad/libredwg-web 0.8.8**, file `wasm/libredwg-web.js`
  (an ES module; changed as described below).
- `libredwg-web.wasm` - the matching WebAssembly module, file `wasm/libredwg-web.wasm` (11.4 MB; one header field
  changed, see below).
- `LICENSE-GPL-3.0.txt` - the GNU General Public License, version 3 (the full text).
- `make.mjs` - the script that made the two files from the package (kept here, not shipped).

Source: the npm registry tarball `@mlightcad/libredwg-web@0.8.8` (`mlightcad-libredwg-web-0.8.8.tgz`, published
2026-11-10, sha256 `6d568e4a1f09c259d968cc2fa9077b6d377a4744824a9dd265df6f4bed5ab194`, npm shasum
`fd6dd1dda28e863234e67759ce063fc80da5f71e`). Its source code: https://github.com/mlightcad/libredwg-web (a fork of
GNU LibreDWG, https://www.gnu.org/software/libredwg/ , with JavaScript bindings in `bindings/javascript`; the
package's README there says how the WebAssembly is built with Emscripten). Only the two `wasm/` files are used: not the
package's TypeScript wrapper (`dist/`, `lib/`).

## Licence

The package states its licence as **"GPL-3.0"**: the GNU General Public License, version 3 (GNU LibreDWG itself is
released under "GPL version 3 or later"). The full text is `LICENSE-GPL-3.0.txt` in this folder (the canonical text
published by the Free Software Foundation, https://www.gnu.org/licenses/gpl-3.0.txt). The package itself ships no
licence file, so the text was copied from the standard copy of GPL-3 that Ubuntu installs
(`/usr/share/common-licenses/GPL-3`, identical to the FSF text).

Including this component makes this part of the app subject to the terms of the GNU GPL version 3 when the app is
distributed (for example when the site is published for other people to use). Keep `LICENSE-GPL-3.0.txt` and this
README (with the source links above) next to the files; both are shipped with the site and the published artifact.

## How the app uses it

`src/import/dwg-read.js` imports `libredwg-web.js` and fetches `libredwg-web.wasm` (same folder, our own origin) only
when the user chooses a `.dwg` file in "Import a sketch..."; the app's start-up is unchanged. It calls one function,
`dwg_write_dxf(in, out)` - LibreDWG's own DWG -> DXF conversion (the `dwg2dxf` tool) - on files in the module's
in-memory file system, and hands the DXF text to the app's DXF reader (`src/import/dxf-read.js`). Nothing is uploaded.
The module runs in the import worker (`src/ui/import/worker.js`), and on the main thread where workers are not
allowed. Node can load the same two files (the tests do).

DWG file formats read: R13, R14, 2000, 2004, 2007, 2010, 2013, 2018 (`AC1012` ... `AC1032`; AutoCAD 2019 to today
still save the 2018 format). Older formats (R12 and before) are refused with a plain message (LibreDWG's support for
them is experimental). See docs/CONTRACT.md section 11.2 for what was verified.

Browser requirements: WebAssembly, and a Content-Security-Policy that allows WebAssembly compilation
(`script-src ... 'wasm-unsafe-eval'`, set by `dev/build-site.mjs`). No `eval` / `new Function`, no
SharedArrayBuffer, no threads, no other origin.

## Changes from the published files (all made by `make.mjs`)

Run: `npm pack @mlightcad/libredwg-web@0.8.8`, unpack, then `node vendor/dwg/make.mjs package/wasm vendor/dwg`.
Every change is an exact match that must occur once, otherwise the script stops.

1. **No run-time code generation** (`libredwg-web.js`). Emscripten's embind builds two kinds of small wrapper
   functions with `new Function(...)` when the module starts: the JavaScript wrapper of every bound C function
   (`craftInvokerFunction`) and the caller of JavaScript methods from C (`__emval_get_method_caller`). A page whose
   Content-Security-Policy has no `'unsafe-eval'` (ours) refuses that. Both are replaced by plain closures that do
   the same steps as the generated source (convert `this` and each argument to its wire type, call, run the
   destructors, convert the result back; read each argument from the argument pack and call / construct). The
   script then checks that the file contains no `new Function`, `Function(` or `eval(`; the tests run the reader in
   Node with `--disallow-code-generation-from-strings` and in Chromium under the production CSP.
2. **Smaller initial memory** (`libredwg-web.wasm`). The module asked for 1 GB of memory up front (16384 pages;
   growth to 4 GB is allowed). A browser must reserve that before reading anything, which fails on phones and
   small tablets. The minimum in its memory section is now 64 MB (1024 pages); the memory grows on demand as the
   module already allows (its static data ends at 2.1 MB). The number is written with the same 3-byte length, so
   nothing else in the file moves; the script checks the result is a valid module.

The glue was already pure ASCII (no character above 126, no control character other than TAB / LF / CR); the script
checks that it stays so.

## Known limits (measured; see docs/CONTRACT.md section 11.2)

- On the DWG files used in the tests, written by another program (acad-ts), LibreDWG's DWG -> DXF conversion stops
  with a WebAssembly "memory access out of bounds" trap when an R13 / R14 / 2000 format file holds more than about
  4 000 objects (the same drawings in the 2004+ formats convert, up to 130 000 lines tested). The app then shows a
  plain "could not be read - save it as DXF" message. Whether real AutoCAD files of those formats are affected was
  not verified (no such file was available).
- Proxy objects, 3D solids, images and xrefs are handled as in the DXF reader (listed, not drawn).
