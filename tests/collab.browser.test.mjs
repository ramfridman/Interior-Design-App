// Live collaboration in real browsers against the dev server (dev/collab-server.mjs):
//   node tests/collab.browser.test.mjs
// Runs the shared scenario in tests/collab-scenario.mjs (the same one tests/collab.worker.test.mjs runs against the
// Cloudflare Worker). Identity: `?as=` in the page address, `X-Dev-User` for REST calls.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCollabScenario } from './collab-scenario.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5000 + Math.floor(Math.random() * 400) + 600;
const BASE = `http://localhost:${PORT}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-collab-test-'));
const server = spawn(process.execPath, [path.join(root, 'dev', 'collab-server.mjs'), String(PORT), '--data', data], { stdio: 'ignore' });
const shots = path.join(root, 'dev', 'screens');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* not yet */ } await sleep(200); }
  const browser = await chromium.launch();
  try {
    await runCollabScenario({ BASE, browser, check, shots,
      pageUrl: (email, query) => `${BASE}/?as=${encodeURIComponent(email)}${query}`,
      restHeaders: (email) => ({ 'x-dev-user': email }) });
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e); failed++; }).finally(() => { server.kill(); fs.rmSync(data, { recursive: true, force: true }); console.log(failed ? `\n${failed} check(s) failed` : '\nALL OK'); process.exit(failed ? 1 : 0); });
