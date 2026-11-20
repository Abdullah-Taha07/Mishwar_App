import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {startJourneyServer} from './fixtures/rider-journey-server.mjs';

// RIDER-014.001: actual search UI, owner-scoped storage and pointer selection.
// Two normalized search results are fulfilled locally. This is NOT a live
// TomTom accuracy test. Authentication/Worker/SQLite use the isolated helper.
const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const output = resolve(option('--output', '.local-verification/rider-014001-' + Date.now()));
const nativeFetch = globalThis.fetch;
const lab = await startJourneyServer({publicRoot: resolve(option('--public', 'apps/rider/dist/public'))});
const f = await lab.resetFixture({returning: true, scenarioId: 'same-name-different-longitude'});
const placeA = {name: 'فرع تجربة مشوار', area: 'فرع الاختبار الغربي', lat: 24.7136, lng: 46.6753};
const placeB = {...placeA, area: 'فرع الاختبار الشرقي', lng: 46.8753};
const features = [placeA, placeB].map(p => ({type: 'Feature', geometry: {type: 'Point', coordinates: [p.lng, p.lat]}, properties: {name: p.name, district: p.area, city: 'Riyadh', country: 'Saudi Arabia'}}));
const audit = {stage: 'RIDER-014.001', passed: false, checks: [], searches: [], exceptions: [], consoleErrors: [], unexpectedExternal: [],
  isolation: 'Loopback only; new in-memory SQLite; synthetic SMS/captain; normalized search results fulfilled in-process. No production configuration or key is read.',
  limitations: 'Headless Chromium viewport 390x844 and CDP pointer. Not real TomTom, Staging, physical phone, route or traffic acceptance.'};
mkdirSync(join(output, 'screens'), {recursive: true});
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(edge, 'Edge or Chromium is required');
const profile = mkdtempSync(join(tmpdir(), 'mishwar-rider014001-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: 'ignore', windowsHide: true});
const wait = ms => new Promise(done => setTimeout(done, ms));
let ws, command, evaluate;
const deadline = setTimeout(() => { console.error('RIDER014001_BROWSER_TIMEOUT'); browser.kill(); process.exit(2); }, 120000);
deadline.unref();
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (/^\d+$/.test(port)) break; } catch {} await wait(100); }
  assert.match(port || '', /^\d+$/, 'CDP did not start');
  const targets = await nativeFetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; setTimeout(() => fail(Error('CDP websocket deadline')), 8000).unref(); });
  let sequence = 0; const pending = new Map();
  command = (method, params = {}) => new Promise((done, fail) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); fail(Error('CDP deadline ' + method)); }, 10000);
    pending.set(id, {done: result => { clearTimeout(timer); done(result); }, fail: error => { clearTimeout(timer); fail(error); }});
    ws.send(JSON.stringify({id, method, params}));
  });
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.fail(Error(JSON.stringify(m.error))) : p?.done(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') audit.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') audit.consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method !== 'Fetch.requestPaused') return;
    const request = m.params, url = new URL(request.request.url);
    const fulfill = (mime, body) => command('Fetch.fulfillRequest', {requestId: request.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: mime}], body: Buffer.from(body).toString('base64')});
    if (url.origin === lab.origin && url.pathname === '/api/places') {
      audit.searches.push({query: url.searchParams.get('q'), fixture: 'two same-name points with distinct longitude'});
      void fulfill('application/json; charset=utf-8', JSON.stringify({provider: 'Declared local search fixture', features})).catch(() => {});
    } else if (url.origin === lab.origin) void command('Fetch.continueRequest', {requestId: request.requestId}).catch(() => {});
    else if (url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2') void fulfill('text/css', '/* Local system fonts. */').catch(() => {});
    else if (url.hostname === 'tile.openstreetmap.org' && url.pathname.endsWith('.png')) void fulfill('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/></svg>').catch(() => {});
    else { audit.unexpectedExternal.push({origin: url.origin, path: url.pathname}); void command('Fetch.failRequest', {requestId: request.requestId, errorReason: 'BlockedByClient'}).catch(() => {}); }
  };
  evaluate = async expression => { const result = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const until = async (expression, label) => { const end = Date.now() + 12000; while (Date.now() < end) { if (await evaluate(expression)) return; await wait(70); } throw Error(label); };
  const settle = () => evaluate(`Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))`);
  const click = async selector => {
    await settle(); await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`); await wait(60);
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,ok:!e.disabled&&!!h&&(h===e||e.contains(h)),hit:h?.outerHTML.slice(0,120)}})()`);
    assert.ok(p?.ok, 'Blocked target ' + selector + ': ' + JSON.stringify(p));
    await command('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1});
    await command('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1}); await wait(80); await settle();
  };
  const fill = async (selector, text) => { await click(selector); await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2}); await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2}); await command('Input.insertText', {text}); };
  const shot = async name => { const data = await command('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(output, 'screens', name + '.png'), Buffer.from(data.data, 'base64')); };
  const favorites = () => evaluate('savedAddresses().map(({name,lat,lng})=>({name,lat,lng}))');
  const markers = () => evaluate("[...document.querySelectorAll('[data-search-favorite]')].map(e=>e.classList.contains('saved'))");
  const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); audit.checks.push({name, passed: true}); };

  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable'); await command('Fetch.enable', {patterns: [{urlPattern: '*'}]});
  await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await command('Browser.setPermission', {origin: lab.origin, permission: {name: 'geolocation'}, setting: 'denied'});
  await command('Page.navigate', {url: lab.origin + '/?rider014001=local-fixture'});
  await until("document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'", 'Rider bootstrap');
  await click('.mobile-nav [data-open-menu]'); await click('#drawer [data-section="profile"]');
  await until("!!document.querySelector('#rider-password-form')", 'Login opens');
  await fill('#rider-password-form [name="phone"]', f.credentials.phone); await fill('#rider-password-form [name="password"]', f.credentials.password); await click('#rider-password-form [type="submit"]');
  await until("!!document.querySelector('.profile-state.verified')", 'Synthetic account authenticates through real Worker'); await click('#modal [data-action="close"]');
  await click('.mw-destination-entry'); await fill('#search-pickup', placeA.name);
  await until("document.querySelectorAll('[data-search-select]').length===2", 'Both normalized provider results appear');
  check('initial results are separate', await markers(), [false, false]);
  await click('[data-search-favorite="0"]'); await shot('saved-A');
  check('saving A does not mark B as saved', await markers(), [true, false]);
  check('A is stored with both coordinates', await favorites(), [(( {name, lat, lng}) => ({name, lat, lng}))(placeA)]);
  await click('[data-search-favorite="1"]'); await shot('saved-both');
  check('both hearts can be saved independently', await markers(), [true, true]);
  check('both longitudes persist', (await favorites()).map(p => p.lng).sort(), [placeA.lng, placeB.lng]);
  await click('[data-search-favorite="1"]');
  check('removing B keeps A', await favorites(), [(({name, lat, lng}) => ({name, lat, lng}))(placeA)]);
  await click('[data-search-close]'); await click('.mw-destination-entry'); await fill('#search-pickup', placeA.name);
  await until("document.querySelectorAll('[data-search-select]').length===2", 'Search reopens with the same two results');
  check('saved identity survives reopening', await markers(), [true, false]);
  await click('[data-search-select="1"]');
  await until("document.querySelector('#search-destination')===document.activeElement", 'Selecting pickup advances to destination');
  const selected = await evaluate('({name:pickupPoint.name,lat:pickupPoint.lat,lng:pickupPoint.lng})');
  check('the selected B coordinate pair is preserved', selected, (({name, lat, lng}) => ({name, lat, lng}))(placeB));
  await shot('selected-B'); audit.selected = selected; audit.favorites = await favorites();
  check('no route or duration is invented for this search-only scenario', lab.audit.requests.filter(r => ['live_quote', 'live_book'].includes(r.action)).length, 0);
  check('browser has no uncaught error', audit.exceptions, []); check('browser has no console error', audit.consoleErrors, []);
  check('no unexpected external browser request', audit.unexpectedExternal, []); check('local server has no error', lab.audit.errors, []);
  audit.passed = true; console.log('PASS RIDER-014.001 independent favorite identities and selected coordinates');
} catch (error) {
  audit.error = error.message; console.error('FAIL RIDER-014.001: ' + error.message);
  if (command) try { const data = await command('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(output, 'screens', 'FAIL.png'), Buffer.from(data.data, 'base64')); } catch {}
} finally {
  clearTimeout(deadline); ws?.close(); browser.kill(); audit.server = lab.audit; await lab.close();
  const summary = {stage: 'RIDER-014.001', status: audit.passed ? 'PASS' : 'FAIL', scenarios: 1, passed: audit.passed ? 1 : 0, failed: audit.passed ? 0 : 1, checks: audit.checks.length, error: audit.error || null, output, limitations: audit.limitations};
  writeFileSync(join(output, 'observations.json'), JSON.stringify(audit, null, 2) + '\n'); writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary)); if (!audit.passed) process.exitCode = 1;
}
