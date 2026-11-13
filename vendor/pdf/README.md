# Vendored PDF libraries

- `pdf-lib.esm.min.js` — pdf-lib 1.17.1 (MIT), self-contained ES module build.
- `fontkit.esm.js` — @pdf-lib/fontkit 1.1.1 (MIT), UMD build wrapped as an ES module.

One mechanical change was made to both files: raw control characters that appeared inside
string literals (for example a literal ESC byte) were rewritten as `\xNN` escapes, which is
the same string value in JavaScript. Some hosts refuse to serve text files that contain raw
control bytes.
