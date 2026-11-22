import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {startJourneyServer} from './fixtures/rider-journey-server.mjs';

// RIDER-013: reach a persisted ride and rating through the rider UI. No client
// setPickup/choose/setStage, authenticated-state injection, or API mocks in CDP.
// Counterpart captain, SMS and mapping providers are explicit local fixtures.
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const publicRoot = resolve(option('--public', 'apps/rider/dist/public'));
const output = resolve(option('--output', '.local-verification/rider-013-' + Date.now()));
const only = option('--only', '');
const scenarioNames = ['new-granted', 'new-denied', 'returning-granted', 'returning-denied'];
const expectedScenarios = scenarioNames.filter(name => !only || new RegExp(only).test(name)).length;
mkdirSync(join(output, 'screens'), {recursive: true});
assert.ok(existsSync(join(publicRoot, 'index.html')), 'Build the rider application before running this test');
const nativeFetch = globalThis.fetch;
const lab = await startJourneyServer({publicRoot});
const observations = {
  phase: 'RIDER-013', results: [], externalBlocked: [], exceptions: [], consoleErrors: [],
  limitations: [
    'Headless Chromium mobile viewport; no physical phone or Safari claim.',
    'Real application gateways and Worker with independent in-memory SQLite.',
    'Synthetic SMS, mapping and captain fixtures; no real provider, customer or payment.',
    'Counts include trusted application clicks only. Native permission dialogs and typing keystrokes are not measured.',
    'No client state, route, pickup or destination is injected by the browser runner.',
  ],
};
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(edge, 'Edge or Chromium is required');
const profile = mkdtempSync(join(tmpdir(), 'mishwar-rider013-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: 'ignore', windowsHide: true});
const wait = ms => new Promise(done => setTimeout(done, ms));
let ws, command, evaluate, current = null;
const timeout = setTimeout(() => { console.error('RIDER013_BROWSER_TIMEOUT'); browser.kill(); process.exit(2); }, 300000);
timeout.unref();
const observer = `(() => {
  window.__journeyDocument = Date.now() + ':' + Math.random();
  window.__journeyClicks = [];
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const node = event.target.closest('button,a,input,select,summary');
    if (!node) return;
    window.__journeyClicks.push({
      time: performance.now(), id: node.id || null, tag: node.tagName,
      action: node.getAttribute('data-action') || node.getAttribute('data-section') || node.getAttribute('data-search-select') || node.getAttribute('data-tier') || null,
      label: (node.getAttribute('aria-label') || (node.tagName === 'INPUT' ? node.name : node.textContent) || '').trim().slice(0, 100),
    });
  }, true);
})();`;

try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (/^\d+$/.test(port)) break; } catch {}
    await wait(100);
  }
  assert.match(port || '', /^\d+$/, 'Browser CDP launch failed');
  // The fixture installs a strict fetch guard. This saved native transport is
  // used only to connect to the local browser, never to an external service.
  const targets = await nativeFetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; setTimeout(() => fail(Error('CDP websocket deadline')), 8000).unref(); });
  let sequence = 0;
  const pending = new Map();
  command = (method, params = {}) => new Promise((done, fail) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); fail(Error('CDP deadline: ' + method)); }, 12000);
    pending.set(id, {done: value => { clearTimeout(timer); done(value); }, fail: error => { clearTimeout(timer); fail(error); }});
    ws.send(JSON.stringify({id, method, params}));
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id); pending.delete(message.id);
      message.error ? p?.fail(Error(JSON.stringify(message.error))) : p?.done(message.result); return;
    }
    if (message.method === 'Runtime.exceptionThrown') observations.exceptions.push({scenario: current?.name, text: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text});
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') observations.consoleErrors.push({scenario: current?.name, text: message.params.args.map(x => x.value || x.description).join(' ')});
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params, url = new URL(request.request.url);
      const fulfill = (mime, text) => command('Fetch.fulfillRequest', {requestId: request.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: mime}], body: Buffer.from(text).toString('base64')});
      if (url.origin === lab.origin) void command('Fetch.continueRequest', {requestId: request.requestId}).catch(() => {});
      else if (url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2') void fulfill('text/css', '/* Local system fonts. */').catch(() => {});
      else if (url.hostname === 'tile.openstreetmap.org' && url.pathname.endsWith('.png')) void fulfill('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/><path d="M0 128H256M128 0V256" stroke="white" stroke-width="12"/></svg>').catch(() => {});
      else { observations.externalBlocked.push({scenario: current?.name, origin: url.origin, path: url.pathname}); void command('Fetch.failRequest', {requestId: request.requestId, errorReason: 'BlockedByClient'}).catch(() => {}); }
    }
  };
  evaluate = async expression => {
    const result = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label) => {
    const end = Date.now() + 16000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await wait(80); }
    throw Error(label);
  };
  const settle = () => evaluate(`Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))`);
  const visibleExpression = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true})&&e.getClientRects().length)`;
  const click = async selector => {
    await settle();
    await evaluate(`(${visibleExpression(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
    await wait(60);
    const point = await evaluate(`(()=>{const e=${visibleExpression(selector)};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,clickable:!e.disabled&&!!h&&(e===h||e.contains(h)),hit:h?.outerHTML.slice(0,140)}})()`);
    assert.ok(point?.clickable, 'Blocked UI target ' + selector + ': ' + JSON.stringify(point));
    await command('Input.dispatchMouseEvent', {type: 'mouseMoved', x: point.x, y: point.y});
    await command('Input.dispatchMouseEvent', {type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1});
    await command('Input.dispatchMouseEvent', {type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1});
    await wait(70); await settle();
  };
  const fill = async (selector, value) => {
    await click(selector);
    await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2});
    await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2});
    await command('Input.insertText', {text: String(value)});
  };
  const shot = async name => {
    const data = await command('Page.captureScreenshot', {format: 'png'});
    writeFileSync(join(output, 'screens', current.name + '-' + name + '.png'), Buffer.from(data.data, 'base64'));
  };
  const checkpoint = async name => {
    const clicks = await evaluate('window.__journeyClicks');
    current.steps.push({name, trustedClicks: clicks.length, elapsedMs: Date.now() - current.startedAt});
    await shot(name);
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  await command('Fetch.enable', {patterns: [{urlPattern: '*'}]});
  await command('Page.addScriptToEvaluateOnNewDocument', {source: observer});
  await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});

  scenarios: for (const returning of [false, true]) for (const permission of ['granted', 'denied']) {
    const name = (returning ? 'returning' : 'new') + '-' + permission;
    if (only && !new RegExp(only).test(name)) continue;
    current = {name, returning, geolocationPermission: permission, passed: false, steps: [], startedAt: Date.now()};
    observations.results.push(current);
    try {
      await command('Page.navigate', {url: 'about:blank'});
      await command('Network.clearBrowserCookies');
      await command('Storage.clearDataForOrigin', {origin: lab.origin, storageTypes: 'all'});
      const f = await lab.resetFixture({returning, scenarioId: name});
      const before = await lab.snapshot();
      assert.equal(before.tripCount, 0, 'No trip is prepared for the browser');
      assert.equal(before.counts.quotes, 0, 'No quote or route is prepared for the browser');
      assert.equal(before.counts.riderAccounts, returning ? 1 : 0);
      await command('Browser.resetPermissions');
      await command('Browser.setPermission', {origin: lab.origin, permission: {name: 'geolocation'}, setting: permission});
      await command('Emulation.setGeolocationOverride', f.gps);
      await command('Page.navigate', {url: lab.origin + '/?journey=' + name});
      await until("document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'", 'Initial real session must resolve');
      await checkpoint('home');
      await click('.mobile-nav [data-open-menu]');
      await click('#drawer [data-section="profile"]');
      await until("!!document.querySelector('#rider-password-form')", 'Account entry opens');
      if (!returning) { await click('#switch-rider-auth'); await fill('#rider-password-form [name="name"]', f.credentials.name); }
      await fill('#rider-password-form [name="phone"]', f.credentials.phone);
      await fill('#rider-password-form [name="password"]', f.credentials.password);
      if (!returning) await fill('#rider-password-form [name="email"]', f.credentials.email);
      await click('#rider-password-form [type="submit"]');
      await until("!!document.querySelector('.rider-account-card')", 'Real login or registration must reach profile');
      if (!returning) {
        await click('#rider-send-otp');
        await until("document.querySelector('#rider-otp-status')?.textContent.includes('تم طلب إرسال الرمز')", 'Synthetic SMS request confirms while the resend cooldown stays active');
        await fill('#rider-otp-form [name="code"]', f.otp);
        await click('#rider-otp-form button');
      }
      await until("!!document.querySelector('.profile-state.verified')", 'Real Worker verifies this account');
      await click('#modal [data-action="close"]');
      await checkpoint('authenticated');

      await click('#locate');
      if (await evaluate("!!document.querySelector('#onboarding-allow')")) await click('#onboarding-allow');
      if (permission === 'granted') await until("document.querySelector('#locate')?.dataset.locationState==='live'", 'Browser geolocation must be accepted');
      else await until("document.querySelector('#locate')?.dataset.locationState==='denied'", 'Denied geolocation is explicit');
      // Optional notifications/sound onboarding is dismissed through its UI.
      for (let n = 0; n < 3 && await evaluate("!!document.querySelector('#onboarding-skip')"); n++) await click('#onboarding-skip');
      await checkpoint('location-' + permission);
      await click('.mw-destination-entry');
      await until("!document.querySelector('#search-sheet').hidden", 'Destination search opens');
      if (permission === 'denied') {
        await fill('#search-pickup', f.places.pickup.name);
        await until("[...document.querySelectorAll('[data-search-select]')].some(e=>e.textContent.includes(" + JSON.stringify(f.places.pickup.name) + '))', 'Manual pickup search returns a provider result');
        await click('#search-results-list [data-search-select]');
        await until("document.querySelector('#search-destination')===document.activeElement", 'Manual pickup selection advances to destination');
      }
      await fill('#search-destination', f.places.destination.name);
      await until("[...document.querySelectorAll('[data-search-select]')].some(e=>e.textContent.includes(" + JSON.stringify(f.places.destination.name) + '))', 'Destination search returns a provider result');
      await click('#search-results-list [data-search-select]');
      await until("!!document.querySelector('.ride-categories [data-tier=comfort]')&&!document.querySelector('[data-action=book]')?.disabled&&document.querySelector('.ride-categories')?.getAttribute('aria-busy')==='false'", 'Real route and prices resolve');
      await click('.ride-categories [data-tier="comfort"]');
      await until("document.querySelector('[data-tier=comfort]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-action=book]')?.disabled&&document.querySelector('.ride-categories')?.getAttribute('aria-busy')==='false'", 'Selected category reprices');
      current.displayedPrice = await evaluate("document.querySelector('.ride-category.selected .ride-price').innerText");
      const digits = current.displayedPrice.replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit)).replace('٫', '.');
      const amount = digits.match(/\d+(?:\.\d{1,2})?/);
      assert.ok(amount, 'Selected card must show a readable price before confirmation');
      current.displayedHalalas = Math.round(Number(amount[0]) * 100);
      await checkpoint('priced');
      await click('#panel [data-action="book"]');
      await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('بانتظار قبول الكابتن')", 'A single UI confirmation creates a real matching trip');
      await checkpoint('matching');
      await lab.advanceTrip('accept');
      await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('الكابتن في الطريق')", 'Rider receives captain acceptance');
      await checkpoint('arriving');
      await lab.advanceTrip('arrived');
      await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('الكابتن وصل')", 'Rider receives arrival');
      await checkpoint('arrived');
      const pin = await evaluate("document.querySelector('.trip-pin-card strong')?.textContent.trim()||''");
      await lab.advanceTrip('start', {pin});
      await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('رحلتك جارية')", 'Rider receives trip start');
      await checkpoint('riding');
      await lab.advanceTrip('complete');
      await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('وصلتم بالسلامة')", 'Rider receives completed trip');
      await click('#panel footer [data-trip-feedback][data-rating-available="true"]');
      await until("!!document.querySelector('#rate-trip')", 'Completed trip offers rating');
      await click('#rate-trip button');
      await until("document.querySelector('#feedback-result')?.textContent.includes('تم حفظ تقييمك')", 'Rating is confirmed by real Worker');
      await checkpoint('rated');
      current.clicks = await evaluate('window.__journeyClicks');
      current.receipt = await lab.snapshot();
      assert.equal(current.receipt.tripCount, 1, 'Exactly one trip is persisted');
      assert.equal(current.receipt.status, 'completed');
      assert.equal(current.receipt.ratingCount, 1, 'Rating is persisted once for this trip and rider');
      assert.equal(current.receipt.ratingScore, 5);
      assert.equal(current.receipt.liveBookCount, 1, 'One booking command is submitted');
      assert.equal(current.receipt.category, 'comfort', 'The persisted ride has the UI-selected category');
      assert.equal(current.receipt.payable, current.displayedHalalas, 'The price shown before confirmation is persisted');
      assert.equal(current.receipt.counts.settlements, 1, 'Cash settlement is persisted once');
      assert.equal(current.receipt.ledgerTotal, 0, 'The local settlement ledger remains balanced');
      assert.equal(current.receipt.trip.method, 'cash');
      assert.equal(current.receipt.trip.payment_status, 'cash_collected');
      assert.ok(current.receipt.route.distanceMeters > 0, 'The Worker persists the provider route');
      assert.equal(current.receipt.trip.pickup.lat, f.places.pickup.lat);
      assert.equal(current.receipt.trip.pickup.lng, f.places.pickup.lng);
      assert.equal(current.receipt.trip.destination.lat, f.places.destination.lat);
      assert.equal(current.receipt.trip.destination.lng, f.places.destination.lng);
      assert.equal(current.receipt.externalNetworkCalls, 0);
      current.totalTrustedClicks = current.clicks.length;
      current.passed = true;
      console.log('PASS ' + name + ' clicks=' + current.totalTrustedClicks);
    } catch (error) {
      current.error = error.message;
      current.clicks = await evaluate('window.__journeyClicks||[]').catch(() => []);
      current.dom = await evaluate('document.body.innerText.slice(0,14000)').catch(() => '');
      current.receipt = await lab.snapshot().catch(() => null);
      await shot('FAIL').catch(() => {});
      console.error('FAIL ' + name + ': ' + error.message);
      // Diagnose the first failed journey before running identical subsequent paths.
      break scenarios;
    } finally { current.durationMs = Date.now() - current.startedAt; }
  }
  observations.audit = lab.audit;
  assert.ok(expectedScenarios > 0, 'The selected filter must match a scenario');
  assert.equal(observations.results.length, expectedScenarios, 'Every selected scenario must run');
  assert.equal(observations.externalBlocked.length, 0, 'Unexpected external browser traffic');
  assert.equal(observations.exceptions.length, 0, 'No uncaught application exception');
  assert.equal(observations.consoleErrors.length, 0, 'No browser console error');
  assert.equal(lab.audit.errors.length, 0, 'No local gateway or Worker error');
} catch (error) {
  observations.fatalError = error.message;
  console.error('RIDER013_FATAL: ' + error.message);
} finally {
  clearTimeout(timeout);
  ws?.close(); browser.kill();
  await lab.close();
  observations.completedAt = new Date().toISOString();
  const failed = observations.results.filter(r => !r.passed).length;
  const accepted = !failed && !observations.fatalError && observations.results.length === expectedScenarios && expectedScenarios > 0;
  const summary = {phase: 'RIDER-013', status: accepted ? 'PASS' : 'FAIL', subset: Boolean(only), expectedScenarios, total: observations.results.length, passed: observations.results.filter(r => r.passed).length, failed, fatalError: observations.fatalError || null, output, limitations: observations.limitations};
  writeFileSync(join(output, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (!accepted) process.exitCode = 1;
}
