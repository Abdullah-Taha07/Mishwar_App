import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const app = resolve(import.meta.dirname, '..');
const checkout = resolve(app, '../..');
const fixtureParent = join(checkout, 'node_modules/.cache/mishwar-r26');
const bundler = dirname(dirname(fileURLToPath(import.meta.resolve('esbuild'))));
function fixture(t) {
  // esbuild inspects parent package directories. Keep these disposable copies
  // inside the checkout instead of depending on access to system-temp parents.
  assert.equal(resolve(fixtureParent, '../../..'), checkout);
  mkdirSync(fixtureParent, {recursive: true});
  const root = mkdtempSync(join(fixtureParent, 'captain-package-'));
  t.after(() => {
    assert.equal(dirname(root), fixtureParent);
    assert.ok(basename(root).startsWith('captain-package-'));
    rmSync(root, {recursive: true, force: true});
  });
  for (const name of ['scripts', 'worker', 'public', '.openai', 'package.json', 'vercel.json']) cpSync(join(app, name), join(root, name), {recursive: true});
  // Copy only the already-installed bundler and its platform binary; no install
  // or registry request is needed to exercise a real build in this temp app.
  cpSync(bundler, join(root, 'node_modules/esbuild'), {recursive: true});
  cpSync(resolve(bundler, '../@esbuild'), join(root, 'node_modules/@esbuild'), {recursive: true});
  return {
    root,
    read: name => readFileSync(join(root, name), 'utf8'),
    build() {
      const run = spawnSync(process.execPath, ['scripts/build.mjs'], {cwd: root, encoding: 'utf8', windowsHide: true});
      assert.equal(run.status, 0, run.stdout + run.stderr);
      return JSON.parse(readFileSync(join(root, 'dist/public/version.json'), 'utf8')).version;
    },
  };
}

test('captain Vercel and Worker exclude private artifacts without removing source or APK downloads', async t => {
  const f = fixture(t);
  const privateFiles = [
    'captain-auth.js.backup', 'private.bak.js', 'private.backup-esbuild.js',
    'captain-auth.before-otp.js', 'private.orig.css', 'captain-auth.js~',
    'backup-2026/leak.js', 'backups/leak.json', '.hidden/leak.js',
    '.env', '.dev.vars', 'env.json', 'secret-config.js', 'credentials.json',
    'node_modules/leak.js', 'database.sql', 'source.js.map',
  ];
  for (const file of privateFiles) {
    mkdirSync(dirname(join(f.root, 'public', file)), {recursive: true});
    writeFileSync(join(f.root, 'public', file), 'private local fixture: must never publish');
  }
  f.build();
  const vercel = JSON.parse(f.read('vercel.json'));
  assert.equal(vercel.outputDirectory, 'dist/public');
  assert.deepEqual(vercel.rewrites, [
    {source: '/api/:path*', destination: 'https://mishwar-api.abduuallah3.workers.dev/api/:path*'},
    {source: '/dashboard', destination: '/dashboard.html'},
    {source: '/(.*)', destination: '/index.html'},
  ]);
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(f.read('dist/server/index.js')).toString('base64'))).default;
  const get = path => worker.fetch(new Request('https://captain.test' + path), {}, {});
  for (const file of privateFiles) {
    assert.ok(existsSync(join(f.root, 'public', file)), file + ' stays in source');
    assert.equal(existsSync(join(f.root, 'dist/public', file)), false, file + ' is absent from Vercel output');
    assert.equal((await get('/' + file)).status, 404, file + ' is absent from Worker assets');
  }
  for (const file of ['captain-auth.js', 'validation.js', 'sw.js', 'version.json', 'manifest.webmanifest', 'index.html']) {
    const response = await get('/' + file);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), f.read('dist/public/' + file));
  }
  assert.equal(await (await get('/launch')).text(), f.read('dist/public/index.html'));
  assert.equal((await get('/dashboard')).status, 302, 'captain dashboard still requires a verified session');
  assert.equal((await get('/dashboard')).headers.get('location'), 'https://captain.test/launch?login=1#login');
  const apk = 'downloads/mishwar-captain.apk';
  assert.deepEqual(readFileSync(join(f.root, 'dist/public', apk)), readFileSync(join(f.root, 'public', apk)));
  const download = await get('/' + apk);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), readFileSync(join(f.root, 'public', apk)));
  const sw = await get('/sw.js');
  assert.equal(sw.headers.get('cache-control'), 'no-store');
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
  assert.equal(f.read('public/sw.js'), f.read('dist/public/sw.js'));
  assert.doesNotMatch(f.read('dist/public/sw.js'), /__MISHWAR_VERSION__|const SHELL=__MISHWAR_ASSETS__/);
});

test('captain versions stay deterministic while published source and SW template changes invalidate them', t => {
  const f = fixture(t);
  const first = f.build();
  const sw = f.read('dist/public/sw.js');
  assert.equal(f.build(), first);
  assert.equal(f.read('dist/public/sw.js'), sw);
  writeFileSync(join(f.root, 'public/captain-auth.js.backup'), 'changed private source');
  assert.equal(f.build(), first, 'private files are not version inputs');
  const style = f.read('public/driver.css');
  writeFileSync(join(f.root, 'public/driver.css'), style.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  assert.equal(f.build(), first, 'checkout line endings do not change the version');
  writeFileSync(join(f.root, 'public/driver.css'), style + '\n/* published style change */\n');
  const second = f.build();
  assert.notEqual(second, first);
  writeFileSync(join(f.root, 'scripts/sw.template.js'), f.read('scripts/sw.template.js') + '\n// template release change\n');
  assert.notEqual(f.build(), second);
});

test('captain cache contains safe static shell only and never intercepts navigation or API requests', async t => {
  const f = fixture(t);
  f.build();
  const handlers = new Map(), requests = [], stored = [];
  const sandbox = {
    URL, Response,
    caches: {open: async () => ({put: async path => stored.push(path)})},
    fetch: async path => {
      requests.push(path);
      return new Response('safe static fixture', {headers: {'content-type': String(path).endsWith('.js') ? 'text/javascript' : String(path).endsWith('.css') ? 'text/css' : 'image/png'}});
    },
    self: {
      location: {origin: 'https://captain.test'},
      addEventListener(name, handler) {if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler);},
      skipWaiting() {},
    },
  };
  vm.runInNewContext(f.read('dist/public/sw.js'), sandbox, {filename: 'captain-published-sw.js'});
  const pending = [];
  for (const install of handlers.get('install')) install({waitUntil: promise => pending.push(promise)});
  await Promise.all(pending);
  assert.ok(stored.includes('/captain-auth.js'));
  assert.ok(stored.every(path => !/backup|\.html$|\.apk$|\/api\/|^\/$/.test(path)));
  for (const request of [
    {url: 'https://captain.test/dashboard', method: 'GET', mode: 'navigate', destination: 'document'},
    {url: 'https://captain.test/index.html', method: 'GET', destination: 'document'},
    new Request('https://captain.test/api/driver'),
    new Request('https://captain.test/api/background'),
    new Request('https://captain.test/api/auth/session'),
    new Request('https://captain.test/version.json'),
  ]) {
    let intercepted = false;
    for (const fetchHandler of handlers.get('fetch')) fetchHandler({request, respondWith() {intercepted = true;}});
    assert.equal(intercepted, false, request.url + ' must stay on the network');
  }
});
