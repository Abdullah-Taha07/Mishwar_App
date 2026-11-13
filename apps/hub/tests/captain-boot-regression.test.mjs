import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
test('captain verified OTP continues onboarding without automatic page reload', () => {
  const auth = read('public/captain-auth.js');
  const poll = auth.match(/function pollCaptainVerification\(\)\{[\s\S]*?function pending\(/)?.[0];
  assert.ok(poll, 'verification polling exists');
  assert.match(poll, /mishwar-captain-verified/);
  assert.doesNotMatch(poll, /location\.reload\(/);
  assert.match(read('public/onboarding.js'), /addEventListener\('mishwar-captain-verified'/);
});
test('captain boot has a visible failure fallback and session fetch is bounded', () => {
  assert.match(read('public/index.html'), /MISHWAR_CAPTAIN_BOOT_FIX_20261113/);
  assert.match(read('public/captain-auth.js'), /AbortSignal\.timeout\(12000\)/);
  assert.match(read('public/onboarding.js'), /captainBootRunning/);
});
test('Vercel build generates a versioned service worker from a persistent template', () => {
  const build = read('scripts/build.mjs');
  const template = read('scripts/sw.template.js');
  assert.match(build, /writeFileSync\('public\/sw\.js',sw\)/);
  assert.match(build, /hash\.update\(readFileSync\('scripts\/sw\.template\.js'\)\)/);
  assert.match(template, /const BUILD='__MISHWAR_VERSION__'/);
  assert.match(template, /const SHELL=__MISHWAR_ASSETS__/);
  assert.match(template, /cache:'no-store'/);
});
