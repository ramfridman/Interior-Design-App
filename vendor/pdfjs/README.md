# Vendored pdf.js (sketch importer)

- `pdf.min.js` — pdf.js display layer, **pdfjs-dist 5.4.624**, file `legacy/build/pdf.min.mjs`.
- `pdf.worker.min.js` — the matching worker, `legacy/build/pdf.worker.min.mjs`.
- `LICENSE.txt` — Apache License 2.0 (Mozilla Foundation), copied from the package.
- Source: the npm registry tarball `pdfjs-dist-5.4.624.tgz` (published 2026-02-01). Only these two files are used:
  no cMaps, standard fonts, wasm decoders or viewer.

Why the legacy build: it is the build pdf.js supports in Node (used by `tests/import.test.mjs`) and it runs as an ES
module in every current browser. Renamed from `.mjs` to `.js` (the repo's `package.json` is `"type": "module"`, so Node
still loads them as ES modules, and every static host serves `.js` as JavaScript).

Used only by `src/import/` and loaded lazily (`src/import/pdfjs-loader.js` does a dynamic `import()` the first time a
sketch is read), so the app's initial load does not change. Options used: `isEvalSupported: false` (no `eval` /
`new Function`), worker from our own origin (`GlobalWorkerOptions.workerSrc` = this folder). In Node, pdf.js runs its
worker in-process and needs a `DOMMatrix` at load time; the loader installs a minimal stand-in (rendering to a canvas
is browser-only). Not shipped, so not available: decoding of JPEG 2000 / JBIG2 images (wasm) and non-embedded
CJK cMaps — such images are skipped in the rendered underlay; vector reading is unaffected.

## ASCII treatment

One mechanical change, made by `make-ascii.mjs` (kept here, not shipped): every non-ASCII UTF-16 code unit and every
control character other than TAB / LF was rewritten as a `\uXXXX` escape (10 characters in `pdf.min.js`, 142 in
`pdf.worker.min.js`, among them raw ESC / STX / … bytes and Unicode tables). In these builds such characters occur
only inside string, template and regular-expression literals (the script checks: none is preceded by a backslash and
there is no `String.raw`), where the escape denotes the same value. Both files are now pure ASCII.

Proof it still works: the operator lists pdf.js produces for both reference drawings are byte-for-byte identical
with the original and the escaped build (SHA-256 of the serialised lists compared), and `tests/import.test.mjs` (Node)
and `tests/import.browser.test.mjs` (headless Chromium, CSP without `unsafe-eval`) run on the escaped files.

To update: download the tarball (`npm pack pdfjs-dist@<version>`), then
`node vendor/pdfjs/make-ascii.mjs <pkg>/legacy/build/pdf.min.mjs vendor/pdfjs/pdf.min.js` and the same for the worker.
