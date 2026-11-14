// Rewrites the vendored LibreDWG WebAssembly glue so it runs under a Content-Security-Policy without 'unsafe-eval'
// (see README.md). Not shipped with the app.
//   node vendor/dwg/make-csp-safe.mjs <package>/wasm/libredwg-web.js vendor/dwg/libredwg-web.js
// Emscripten's embind builds two kinds of small JavaScript functions at run time with `new Function(...)`
// (craftInvokerFunction: the JS wrapper of every bound C function; __emval_get_method_caller: calls from C into a JS
// method). Both are replaced by closures that do exactly what the generated source does, step by step. Every
// replacement is an exact text match that must occur once, otherwise the script stops.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , src, dst] = process.argv;
let s = readFileSync(src, 'utf8');
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
writeFileSync(dst, s);
console.log(`${dst}: ${s.length} bytes, 2 replacements`);
