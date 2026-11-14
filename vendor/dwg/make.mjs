// Makes vendor/dwg/libredwg-web.js and libredwg-web.wasm from the npm package (see README.md). Not shipped with the app.
//   npm pack @mlightcad/libredwg-web@0.8.8 && tar xzf mlightcad-libredwg-web-0.8.8.tgz
//   node vendor/dwg/make.mjs package/wasm vendor/dwg
// 1. The JavaScript glue is rewritten so it runs under a Content-Security-Policy without 'unsafe-eval':
// Emscripten's embind builds two kinds of small JavaScript functions at run time with `new Function(...)`
// (craftInvokerFunction: the JS wrapper of every bound C function; __emval_get_method_caller: calls from C into a JS
// method). Both are replaced by closures that do exactly what the generated source does, step by step. Every
// replacement is an exact text match that must occur once, otherwise the script stops.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , srcDir, dstDir] = process.argv;
let s = readFileSync(path.join(srcDir, 'libredwg-web.js'), 'utf8');
const once = (from, to) => {
  const i = s.indexOf(from);
  if (i < 0 || s.indexOf(from, i + 1) >= 0) throw new Error('expected exactly one occurrence of: ' + from.slice(0, 80));
  s = s.slice(0, i) + to + s.slice(i + from.length);
};

// 1. craftInvokerFunction: the generated wrapper converts `this` (methods) and each argument to its wire type,
//    calls the C invoker, runs the destructors, converts the result back.
once(
  'let[args,invokerFnBody]=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);args.push(invokerFnBody);var invokerFn=newFunc(Function,args)(...closureArgs);',
  'var invokerFn=function(...callArgs){var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];' +
  'if(isClassMethodFunc){wired.push(argTypes[1]["toWireType"](destructors,this))}' +
  'for(var i=0;i<argCount-2;++i){wired.push(argTypes[i+2]["toWireType"](destructors,callArgs[i]))}' +
  'var rv=cppInvokerFunc(...wired);' +
  'if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){' +
  'if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(i===1?wired[1]:wired[(isClassMethodFunc?2:1)+i-2])}}}' +
  'if(returns){return argTypes[0]["fromWireType"](rv)}};',
);

// 2. __emval_get_method_caller: read each argument from the argument pack, call the method (kind 0: on `obj`;
//    1: as a constructor; otherwise: the first argument is `this`), hand the result back.
const a = 'var functionBody=`return function (obj, func, destructorsRef, args) {\\n`;';
const b = 'var invokerFunction=newFunc(Function,params)(...args);';
const i = s.indexOf(a), j = s.indexOf(b);
if (i < 0 || j < i || s.indexOf(a, i + 1) >= 0 || s.indexOf(b, j + 1) >= 0) throw new Error('method caller not found as expected');
s = s.slice(0, i) +
  'var invokerFunction=function(obj,func,destructorsRef,args){var offset=0;var list=[];if(kind===0){list.push(obj)}' +
  'for(var i=0;i<argCount;++i){list.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance}' +
  'var rv=kind===1?new func(...list):func.call(...list);' +
  'if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}};' +
  s.slice(j + b.length);

// checks: no run-time code generation left, pure ASCII
const code = s.replace(/\/\*[\s\S]*?\*\//g, '');
if (/newFunc\(Function|new Function|[^.\w$]Function\(|\beval\(/.test(code)) throw new Error('dynamic code generation still present');
if (/[^\x09\x0a\x0d\x20-\x7e]/.test(s)) throw new Error('not ASCII');
writeFileSync(path.join(dstDir, 'libredwg-web.js'), s);
console.log(`libredwg-web.js: ${s.length} bytes, 2 replacements, ASCII`);

// 2. The WebAssembly module asks for 1 GB of memory up front (16384 pages of 64 KB; it may grow to 4 GB). A browser
//    must reserve that much address space before the first byte is read, which fails on phones and small tablets.
//    Its memory section is changed to start at 64 MB (1024 pages) and grow on demand, as the module already allows
//    (its static data ends at 2.1 MB; growth goes through emscripten_resize_heap). One field of the memory section
//    changes; the value is written as a 3-byte LEB128 number like the original, so no offset in the file moves.
const w = readFileSync(path.join(srcDir, 'libredwg-web.wasm'));
let p = 8;
const leb = () => { let r = 0, sh = 0, x; do { x = w[p++]; r += (x & 127) * 2 ** sh; sh += 7; } while (x & 128); return r; };
let patched = false;
while (p < w.length) {
  const id = w[p++], size = leb(), start = p;
  if (id === 5) {
    if (leb() !== 1) throw new Error('expected one memory');
    const flags = w[p++], at = p, min = leb();
    if (flags !== 1 || min !== 16384 || p - at !== 3) throw new Error(`unexpected memory limits (flags ${flags}, min ${min})`);
    w[at] = 0x80; w[at + 1] = 0x88; w[at + 2] = 0x00;          // 1024 = 0b1000_0000000 → 0x80 0x08, padded to 3 bytes
    p = at; if (leb() !== 1024) throw new Error('memory patch failed');
    patched = true;
  }
  p = start + size;
}
if (!patched) throw new Error('memory section not found');
new WebAssembly.Module(w);                                       // still a valid module
writeFileSync(path.join(dstDir, 'libredwg-web.wasm'), w);
console.log(`libredwg-web.wasm: ${w.length} bytes, initial memory 64 MB (was 1 GB)`);
