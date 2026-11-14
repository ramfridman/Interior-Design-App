# Vendored Clipper (polygon kernel)

- `clipper.js`: **Javascript Clipper 6.4.2** (Angus Johnson's Clipper 6.4.2, translated to Javascript by Timo,
  build 6.4.2.2), as an ES module: `import ClipperLib from '../../vendor/clipper/clipper.js'` (also a named export
  `ClipperLib`). It is used only through `src/core/polykernel.js`.
- Source: the npm registry tarball `clipper-lib-6.4.2.tgz` (sha256 `634d7d7627939bbe63405f8876c43ba4009b1fec7ef8de153b0bed28e42466ec`,
  repository github.com/junmer/clipper-lib, a mirror of the SourceForge project "jsclipper"). Only `clipper.js` is used.
- Licences: Clipper and its translation are under the **Boost Software License 1.0** (`LICENSE-Boost.txt`). The file
  contains Tom Wu's JSBN big-integer code, under an MIT-style licence (`LICENSE-jsbn.txt`). Both texts are also copied
  into the head of `clipper.js` as `//` comments, because the shipped file is source code (Boost asks for the text in
  every source copy; JSBN asks for its notice in every redistribution).
- Size: 207 KB (45 KB gzipped), unminified. Nothing imports it at app start-up; the build scripts
  (`dev/build-site.mjs`, `dev/build-artifact.mjs`) ship it because they crawl the relative imports of every
  `src/**/*.js` file (checked: both now list `vendor/clipper/clipper.js`). No change to the build scripts was needed.

## Why Clipper 6.4.2

The design (docs/DESIGN-ANGLED-WALLS-AND-FLOORS.md § 3, "Polygon kernel (A0)") recommends it, and nothing on npm is
clearly better for this job:
- it works on **integer** coordinates, so union / difference / offset are exact and robust (no epsilons), which is
  the point of the kernel;
- it has polygon offsetting (mitre / square / round), needed for "too narrow" checks and passages;
- it is plain JavaScript (no WebAssembly, no `eval`), small, and has been stable for years.
Alternatives looked at: `clipper2-js` (a TypeScript port of Clipper2, Boost) is newer but a young, little-used port;
`polygon-clipping` / `martinez` (MIT) work on floating point, which is exactly the robustness risk the kernel exists
to remove, and have no offsetting; `js-angusj-clipper` (MIT, Clipper compiled to WebAssembly) is faster but needs a
wasm loader and `'wasm-unsafe-eval'` in the site's Content-Security-Policy.

## Changes from the published file (all made by `make-esm.mjs`, kept here, not shipped)

Run: `npm pack clipper-lib@6.4.2`, unpack, then `node vendor/clipper/make-esm.mjs <package>/clipper.js vendor/clipper/clipper.js`.
Every change is an exact text replacement that must match once, otherwise the script stops.
1. **Module wrapper.** The UMD header (`module.exports` / `define` / `window.ClipperLib` / `self['ClipperLib']`) is
   removed; the IIFE returns the library and the file ends with `export default ClipperLib`. Loading it defines no
   global.
2. **No browser sniffing.** The original read `navigator.userAgent` / `navigator.appName` to pick among equivalent
   integer-cast and rounding helpers and the big-integer multiply routine; it now uses the fixed values the original
   uses in Node (`"chrome"`, `"Netscape"`), so every browser, worker and Node run the same code paths (deterministic
   output everywhere).
3. **No global write.** `Number.toInteger = null` (a write to a built-in, only read on a Firefox-only branch that can
   no longer be taken) is removed.
4. **Pure ASCII.** The only non-ASCII characters were superscripts in `//` comments (30 characters, 4 lines); they are
   written as `\uXXXX` text. The script checks that each one is inside a comment, that the result is ASCII, and that
   the code (comments removed) contains no `eval`, `new Function`, `Function(`, `window`, `self`, `navigator`,
   `document`, `module`, `define` or `globalThis`.
5. **Licence header** (see above) prepended as `//` comments.

Diff against the original is these five hunks only (`diff` of the unescaped file shows them).

## Limits worth knowing

- Coordinates: the Javascript port is exact on its fast path while |x|, |y| <= 47 453 132 integer units; the kernel
  uses 1000 units per cm, i.e. ±474 m around the plan origin. Beyond that Clipper silently switches to its 128-bit
  (JSBN) path: still exact, much slower.
- Clipper 6 can leave a zero-width "spike" or a ring running both ways along an edge where two input polygons share
  that edge; `polykernel.js` runs every operation in two passes (the operation, then a strictly-simple union of its
  output) and drops collinear / spike vertices, which resolves it (see the comment on `execute`).
