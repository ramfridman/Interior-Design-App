// Turns the npm build of Javascript Clipper (clipper-lib 6.4.2, file clipper.js) into the vendored ES module
// (see README.md). Not shipped with the app.
//   node vendor/clipper/make-esm.mjs <package>/clipper.js vendor/clipper/clipper.js
// Every change is an exact text replacement that must match once; anything unexpected throws.
//   1. The UMD header (module.exports / define / window / self) and the navigator sniffing are replaced by fixed
//      values, so the module touches no global and runs the same code paths in every browser, worker and Node.
//   2. The write `Number.toInteger = null` (a global side effect, only read on a Firefox-only branch) is removed.
//   3. The IIFE returns the library; the file ends with `export default ClipperLib` and a named export.
//   4. Every non-ASCII character and every control character other than TAB / LF is written as \uXXXX (in this
//      build they only occur in // comments, checked below), so the file is pure ASCII.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst] = process.argv;
let s = readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
const once = (from, to) => {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one match (found ${n}) for: ${from.slice(0, 80)}`);
  s = s.replace(from, () => to);
};

once(`(function ()
{
	"use strict";
	var ClipperLib = {};`, `const ClipperLib = (function ()
{
	"use strict";
	var ClipperLib = {};`);

once(`	var isNode = false;
	if (typeof module !== 'undefined' && module.exports)
	{
		module.exports = ClipperLib;
		isNode = true;
	}
	else
	{
		if (typeof define === 'function' && define.amd) {
			define(ClipperLib);
		}
		if (typeof (document) !== "undefined") window.ClipperLib = ClipperLib;
		else self['ClipperLib'] = ClipperLib;
	}
	var navigator_appName;
	if (!isNode)
	{
		var nav = navigator.userAgent.toString().toLowerCase();
		navigator_appName = navigator.appName;
	}
	else
	{
		var nav = "chrome"; // Node.js uses Chrome's V8 engine
		navigator_appName = "Netscape"; // Firefox, Chrome and Safari returns "Netscape", so Node.js should also
	}`, `	// [vendored ES module] no UMD export and no browser sniffing: the same code paths everywhere (see README.md).
	var nav = "chrome";
	var navigator_appName = "Netscape";`);

once(`	if (typeof Number.toInteger === "undefined")
		Number.toInteger = null;
`, `	// [vendored ES module] removed: a global write \`Number.toInteger = null\` (only read on a Firefox-only branch).
`);

// The full licence texts travel inside the shipped file (Boost: "must be included in all copies ... in source form";
// JSBN: "all redistributions must retain an intact copy of this copyright notice"), as // comments.
const here = new URL('.', import.meta.url);
const asComment = (file) => readFileSync(new URL(file, here), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').map((l) => ('// ' + l).trimEnd()).join('\n');
s = `// Javascript Clipper 6.4.2 (clipper-lib 6.4.2 from the npm registry) as an ES module for E7 House Designer.
// Changes from the published file: see vendor/clipper/README.md (made by vendor/clipper/make-esm.mjs).
//
// ---- Licence of Clipper (Angus Johnson) and its Javascript translation (Timo): vendor/clipper/LICENSE-Boost.txt
${asComment('LICENSE-Boost.txt')}
//
// ---- Licence of the JSBN big-integer code it contains (Tom Wu): vendor/clipper/LICENSE-jsbn.txt
${asComment('LICENSE-jsbn.txt')}
` + s;

const tail = s.lastIndexOf('})();');
if (tail < 0 || s.slice(tail + 5).trim() !== '') throw new Error('unexpected end of file');
s = s.slice(0, tail) + `	return ClipperLib;
})();

export default ClipperLib;
export { ClipperLib };
`;

// ASCII: only allowed inside // line comments in this build.
let out = '', changed = 0;
for (let i = 0; i < s.length; i++) {
  const k = s.charCodeAt(i);
  if (k > 126 || (k < 32 && k !== 9 && k !== 10)) {
    const line = s.slice(s.lastIndexOf('\n', i) + 1, i);
    if (!line.includes('//') && !/^\s*\*/.test(line)) throw new Error('special character outside a comment at ' + i);
    out += '\\u' + k.toString(16).padStart(4, '0');
    changed++;
  } else out += s[i];
}
if (/[^\x09\x0a\x20-\x7e]/.test(out)) throw new Error('not ASCII after rewrite');
const code = out.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
for (const bad of [/\beval\s*\(/, /new\s+Function\b/, /\bFunction\s*\(/, /\bwindow\b/, /\bself\b/, /\bnavigator\b/, /\bdocument\b/, /\bmodule\b/, /\bdefine\b/, /\bglobalThis\b/]) {
  if (bad.test(code)) throw new Error('forbidden construct left in code: ' + bad);
}
writeFileSync(dst, out);
console.log(`${dst}: ${changed} characters escaped, ${out.length} bytes`);
