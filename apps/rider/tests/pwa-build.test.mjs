import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname, basename} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const app = resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mishwar-rider-pwa-'));
  for (const name of ['scripts', 'worker', 'public', '.openai', 'package.json', 'vercel.json']) cpSync(join(app, name), join(root, name), {recursive: true});
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('mishwar-rider-pwa-'));
    rmSync(root, {recursive: true, force: true});
  });
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

test('Vercel and Worker publish the same rendered service worker and omit private artifacts', async t => {
  const f = fixture(t);
  const privateFiles = ['rider-auth.js.backup', '.env', '.env.production', 'private.bak.js', 'backup/leak.js', '.hidden/leak.js', 'database.sql',
    'rider-auth.js.backup-esbuild.js', 'rider-auth.js.before-otp.js', 'app.old.js', 'app.orig.js', 'app.save.js', 'app~.js',
    'backup-2026/leak.js', 'env.json', 'production.env.js', 'secrets.json', 'credentials.json', 'secret-config.js'];
  for (const file of privateFiles) {
    mkdirSync(dirname(join(f.root, 'public', file)), {recursive: true});
    writeFileSync(join(f.root, 'public', file), 'private fixture: must never publish');
  }
  const version = f.build();
  assert.match(version, /^v-[a-f\d]{12}$/);
  assert.equal(JSON.parse(f.read('vercel.json')).outputDirectory, 'dist/public');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(f.read('dist/server/index.js')).toString('base64'))).default;
  const get = path => worker.fetch(new Request('https://rider.test' + path), {});
  for (const file of privateFiles) {
    assert.ok(existsSync(join(f.root, 'public', file)), file + ' remains in source');
    assert.equal(existsSync(join(f.root, 'dist/public', file)), false, file + ' is absent from Vercel output');
    assert.equal((await get('/' + file)).status, 404, file + ' is absent from Worker');
  }
  for (const file of ['sw.js', 'version.json', 'index.html', 'account-context.js', 'app.js']) {
    const response = await get('/' + file);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), f.read('dist/public/' + file));
  }
  const response = await get('/sw.js');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('service-worker-allowed'), '/');
  const config = JSON.parse(f.read('vercel.json'));
  for (const path of ['/sw.js', '/version.json', '/']) assert.ok(config.headers.find(row => row.source === path)?.headers.some(h => h.key === 'Cache-Control' && h.value === 'no-store'));
  assert.doesNotMatch(f.read('dist/public/sw.js'), /__MISHWAR_(VERSION|ASSETS)__/);
  assert.equal(f.read('public/sw.js'), f.read('dist/public/sw.js'));
});

test('repeat builds keep the same version while published sources and the SW template invalidate it', t => {
  const f = fixture(t);
  const first = f.build();
  const sw = f.read('dist/public/sw.js');
  assert.equal(f.build(), first);
  assert.equal(f.read('dist/public/sw.js'), sw);
  writeFileSync(join(f.root, 'public/rider-auth.js.backup'), 'changed backup only');
  assert.equal(f.build(), first, 'private artifacts are not version inputs');
  const style = f.read('public/style.css');
  writeFileSync(join(f.root, 'public/style.css'), style.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  assert.equal(f.build(), first, 'line ending conversion does not invalidate a build');
  writeFileSync(join(f.root, 'public/style.css'), style + '\n/* new release */\n');
  const second = f.build();
  assert.notEqual(second, first);
  writeFileSync(join(f.root, 'scripts/sw.template.js'), f.read('scripts/sw.template.js') + '\n// changed worker template\n');
  assert.notEqual(f.build(), second);
});

test('generated service worker installs shell assets, leaves APIs on the network and waits for update consent', async t => {
  const f = fixture(t);
  f.build();
  const handlers = {}, puts = [], requests = [], deleted = [];
  let skipped = 0, claimed = 0;
  const cache = {put: async path => puts.push(path), match: async () => new Response('cached shell')};
  const sandbox = {
    URL, console,
    caches: {open: async () => cache, keys: async () => ['mishwar-shell-old', 'unrelated-cache'], delete: async key => deleted.push(key)},
    fetch: async path => {
      requests.push(path);
      return new Response('static fixture', {headers: {'content-type': String(path).endsWith('.js') ? 'text/javascript' : String(path).endsWith('.css') ? 'text/css' : 'text/html'}});
    },
    self: {
      location: {origin: 'https://rider.test'},
      addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: {claim: async () => { claimed++; }},
      skipWaiting() { skipped++; },
    },
  };
  vm.runInNewContext(f.read('dist/public/sw.js'), sandbox, {filename: 'published-sw.js'});
  assert.equal(skipped, 0);
  let pending;
  handlers.install({waitUntil: promise => { pending = promise; }});
  await pending;
  assert.ok(puts.includes('/account-context.js'));
  assert.ok(puts.includes('/'));
  assert.ok(requests.every(path => !String(path).startsWith('/api/') && !String(path).includes('backup')));
  for (const [url, method] of [['/api/live', 'GET'], ['/api/auth/session', 'GET'], ['/api/background', 'GET'], ['/api/live', 'POST'], ['/version.json', 'GET'], ['https://other.test/app.js', 'GET']]) {
    let intercepted = false;
    handlers.fetch({request: new Request(new URL(url, 'https://rider.test'), {method}), respondWith() { intercepted = true; }});
    assert.equal(intercepted, false, method + ' ' + url + ' must bypass cache');
  }
  let cached;
  handlers.fetch({request: new Request('https://rider.test/style.css'), respondWith: promise => { cached = promise; }});
  assert.equal(await (await cached).text(), 'cached shell');
  handlers.message({data: {type: 'unrelated'}});
  assert.equal(skipped, 0);
  handlers.message({data: {type: 'ACTIVATE_UPDATE'}});
  assert.equal(skipped, 1);
  handlers.activate({waitUntil: promise => { pending = promise; }});
  await pending;
  assert.deepEqual(deleted, ['mishwar-shell-old']);
  assert.equal(claimed, 1);
});
