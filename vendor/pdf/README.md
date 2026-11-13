# Vendored PDF libraries

- `pdf-lib.esm.min.js` — pdf-lib 1.17.1 (MIT), self-contained ES module build.
- `fontkit.esm.js` — @pdf-lib/fontkit 1.1.1 (MIT), UMD build wrapped as an ES module.

One mechanical change was made to both files: every raw control character and every non-ASCII
character that appeared inside string / regex literals (encoding tables, a literal ESC byte, U+FFFD…)
was rewritten as a `\xNN` / `\uNNNN` escape, which is the same value in JavaScript. The files are
now pure ASCII. Some hosts refuse to serve text files that contain raw control or replacement characters.
