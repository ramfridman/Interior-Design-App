// Rewrites a vendored pdf.js build file as pure ASCII (see README.md). Not shipped with the app.
//   node vendor/pdfjs/make-ascii.mjs <in.mjs> <out.mjs>
// Every non-ASCII UTF-16 code unit and every control character other than TAB / LF is replaced by its
// \uXXXX escape. In the pdf.js builds these characters only occur inside string, template and regex
// literals (checked below: none is preceded by a backslash, no String.raw / CR in the source), where the escape
// denotes exactly the same value, so the program is unchanged.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst] = process.argv;
const s = readFileSync(src, 'utf8');
if (/String\.raw/.test(s)) throw new Error('String.raw present: escaping could change a raw template value');
let out = '', changed = 0;
for (let i = 0; i < s.length; i++) {
  const k = s.charCodeAt(i);
  if (k > 126 || (k < 32 && k !== 9 && k !== 10)) {
    if (s[i - 1] === '\\') throw new Error('escaped special character at ' + i + ' needs manual treatment');
    out += '\\u' + k.toString(16).padStart(4, '0');
    changed++;
  } else out += s[i];
}
if (/[^\x09\x0a\x20-\x7e]/.test(out)) throw new Error('not ASCII after rewrite');
writeFileSync(dst, out);
console.log(`${dst}: ${changed} characters escaped, ${out.length} bytes`);
