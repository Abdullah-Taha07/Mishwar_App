import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {startJourneyServer} from './fixtures/rider-journey-server.mjs';
import {createSearchMapsProvider, MAP_PLACES as P, MAP_QUERIES} from './fixtures/rider-search-maps-provider.mjs';

// RIDER-014 acceptance: real built rider, source gateways/Worker and SQLite.
// No direct browser state/location/quote/route seeding. Only provider facts,
// SMS/account fixture setup and map images/fonts are synthetic local fixtures.
// This cannot prove real TomTom, isolated Staging, physical GPS or traffic.
const args = process.argv.slice(2), option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const output = resolve(option('--output', '.local-verification/rider-014-browser-' + Date.now()));
const publicRoot = resolve(option('--public', 'apps/rider/dist/public'));
const provider = createSearchMapsProvider();
const lab = await startJourneyServer({publicRoot, tomtomFixture: provider.fetch});
const fixture = await lab.resetFixture({returning: true, scenarioId: 'rider014-search-maps-route'});
const audit = {
  stage: 'RIDER-014', tests: [], exceptions: [], consoleErrors: [], unexpectedExternal: [], canceledSearches: [],
  isolation: 'Loopback browser/API only; real rider source gateway/shared Worker; migration-backed isolated in-memory SQLite; only synthetic accounts and deliberately fake provider credentials.',
  providerDisclosure: 'Invented Arabic/English POIs, road geometry, 4850 meters, 650 seconds and 85 traffic-delay seconds. All TomTom calls fulfilled inside Node before native fetch. Neutral map images and system fonts.',
  limitations: ['Real TomTom accuracy/availability/key/traffic NOT verified.', 'Staging runtime and D1/R2/secrets isolation NOT established by this test.', 'Chromium viewport emulation only; no physical Android/iPhone/GPS/Safari claim.'],
  stageComplete: false, realTomTomVerified: false,
};
mkdirSync(join(output, 'screens'), {recursive: true});
const executable = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
assert.ok(executable, 'A locally installed Chromium browser is required');
const profile = mkdtempSync(join(tmpdir(), 'mishwar-rider014-'));
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: 'ignore', windowsHide: true});
const wait = ms => new Promise(done => setTimeout(done, ms));
let ws, command, evaluate;
const deadline = setTimeout(() => {console.error('RIDER014_BROWSER_TIMEOUT'); browser.kill(); process.exit(2);}, 240000); deadline.unref();
try {
  let port;
  for (let n = 0; n < 100; n++) {try {port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; if (/^\d+$/.test(port)) break;} catch {} await wait(100);}
  assert.match(port || '', /^\d+$/, 'CDP did not start');
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => {ws.onopen = done; ws.onerror = fail; setTimeout(() => fail(Error('CDP websocket deadline')), 8000).unref();});
  let sequence = 0; const pending = new Map(), network = new Map();
  command = (method, params = {}) => new Promise((done, fail) => {
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); fail(Error('CDP deadline ' + method));}, 15000);
    pending.set(id, {done: result => {clearTimeout(timer); done(result);}, fail: error => {clearTimeout(timer); fail(error);}});
    ws.send(JSON.stringify({id, method, params}));
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {const p = pending.get(message.id); pending.delete(message.id); message.error ? p?.fail(Error(JSON.stringify(message.error))) : p?.done(message.result); return;}
    if (message.method === 'Runtime.exceptionThrown') audit.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') audit.consoleErrors.push(message.params.args.map(a => a.value || a.description).join(' '));
    if (message.method === 'Network.requestWillBeSent') {const u = new URL(message.params.request.url); if (u.origin === lab.origin) network.set(message.params.requestId, {path: u.pathname, query: u.searchParams.get('q')});}
    if (message.method === 'Network.loadingFailed' && message.params.canceled && network.get(message.params.requestId)?.path === '/api/places') audit.canceledSearches.push(network.get(message.params.requestId));
    if (message.method !== 'Fetch.requestPaused') return;
    const request = message.params, url = new URL(request.request.url);
    const fulfill = (mime, body) => command('Fetch.fulfillRequest', {requestId: request.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: mime}], body: Buffer.from(body).toString('base64')});
    if (url.origin === lab.origin) void command('Fetch.continueRequest', {requestId: request.requestId}).catch(() => {});
    else if (url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2') void fulfill('text/css', '/* Local system fonts. */').catch(() => {});
    else if (url.hostname === 'tile.openstreetmap.org' && url.pathname.endsWith('.png')) void fulfill('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/><path d="M0 128H256M128 0V256" stroke="#d9dfdb"/></svg>').catch(() => {});
    else {audit.unexpectedExternal.push({origin: url.origin, path: url.pathname}); void command('Fetch.failRequest', {requestId: request.requestId, errorReason: 'BlockedByClient'}).catch(() => {});}
  };
  evaluate = async expression => {const result = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value;};
  const until = async (expression, label, timeout = 12000) => {const end = Date.now() + timeout; while (Date.now() < end) {if (await evaluate(expression)) return; await wait(60);} throw Error(label);};
  const untilNode = async (condition, label, timeout = 12000) => {const end = Date.now() + timeout; while (Date.now() < end) {if (condition()) return; await wait(35);} throw Error(label);};
  const settle = () => evaluate(`Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))`);
  const click = async selector => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`, 'Missing control ' + selector);
    await settle(); await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await wait(45);
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,ok:r.width>0&&r.height>0&&!e.disabled&&!!h&&(h===e||e.contains(h)),hit:h?.outerHTML.slice(0,150)}})()`);
    assert.ok(p.ok, 'Obstructed pointer control ' + selector + ': ' + JSON.stringify(p));
    await command('Input.dispatchMouseEvent', {type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1});
    await command('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1}); await wait(55);
  };
  const enter = async () => {await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13}); await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});};
  const fill = async (selector, value, submit = true) => {
    await click(selector); await command('Input.dispatchKeyEvent', {type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2}); await command('Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2}); await command('Input.insertText', {text: value}); if (submit) await enter();
  };
  const shot = async name => {await settle(); const image = await command('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(output, 'screens', name + '.png'), Buffer.from(image.data, 'base64'));};
  const resultNames = () => evaluate("[...document.querySelectorAll('[data-search-select] strong')].map(e=>e.textContent)");
  const hasResult = name => `[...document.querySelectorAll('[data-search-select] strong')].some(e=>e.textContent===${JSON.stringify(name)})`;
  const openSearch = async target => {
    if (await evaluate("document.querySelector('#search-sheet').hidden")) {
      const selector = await evaluate("document.querySelector('[data-edit-route]')?'[data-edit-route]':document.querySelector('.mw-destination-entry')?'.mw-destination-entry':'[data-action=search],[data-action=pickup]'");
      await click(selector); await until("!document.querySelector('#search-sheet').hidden", 'Search sheet opens');
    }
    await click('#search-' + target);
  };
  const search = async (target, query, expected) => {await openSearch(target); await fill('#search-' + target, query); if (expected) await until(hasResult(expected), 'Search fixture result ' + expected);};
  const pick = async (target, query, place, index = 0) => {await search(target, query, place.name); await click('[data-search-select="' + index + '"]');};
  const quoteReady = async () => {await until("state.stage==='select'&&!!window.__readRiderRoute()&&!!document.querySelector('[data-action=book]:not(:disabled)')", 'Trusted local quote and geometry become ready');await until("!liveMap._animatingZoom&&!(liveMap._panAnim&&liveMap._panAnim._inProgress)", 'Initial route fitting settles before stationary-map checks');};
  const point = target => evaluate(`(()=>{const p=${target === 'pickup' ? 'pickupPoint' : 'state.destination'};return p?{name:p.name,lat:p.lat,lng:p.lng}:null})()`);
  const expectedPoint = p => ({name: p.name, lat: p.lat, lng: p.lng});
  const record = async (name, fn) => {
    const row = {name, passed: false, scope: 'local-real-Chromium-gateway-Worker-SQLite-with-declared-provider-fixtures'}; audit.tests.push(row);
    try {await fn(row); row.passed = true; console.log('PASS ' + name);} catch (error) {row.error = error.message; console.error('FAIL ' + name + ': ' + error.message); try {await shot('FAIL-' + name);} catch {} throw error;}
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable'); await command('Fetch.enable', {patterns: [{urlPattern: '*'}]});
  await command('Page.addScriptToEvaluateOnNewDocument', {source: "try{localStorage.setItem('mishwar-permissions-onboarded-v2','true');localStorage.setItem('mishwar-language','ar')}catch{}"});
  await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await command('Browser.setPermission', {origin: lab.origin, permission: {name: 'geolocation'}, setting: 'denied'});
  await command('Page.navigate', {url: lab.origin + '/?rider014=declared-local-fixtures'});
  await until("document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'&&mapConfig.searchProvider==='TomTom'", 'Built rider bootstrap and real local map config');
  await click('.mobile-nav [data-open-menu]'); await click('#drawer [data-section="profile"]');
  await until("!!document.querySelector('#rider-password-form')", 'Fixture login opens');
  await fill('#rider-password-form [name="phone"]', fixture.credentials.phone, false); await fill('#rider-password-form [name="password"]', fixture.credentials.password, false); await click('#rider-password-form [type="submit"]');
  await until("!!document.querySelector('.profile-state.verified')", 'Verified synthetic rider logs in through real local Worker'); await click('#modal [data-action="close"]');

  // Observe the real rendered Leaflet route without reaching into an IIFE's private variable.
  await evaluate("window.__readRiderRoute=()=>{let found=null;liveMap.eachLayer(layer=>{if(layer instanceof L.GeoJSON)found=layer});return found}");
  await record('arabic-english-streets-districts-landmarks-and-valid-coordinates', async row => {
    row.queries = [];
    for (const item of MAP_QUERIES) {
      await search('pickup', item.query, P[item.place].name);
      const results = await evaluate('editor.visibleResults.map(({name,lat,lng})=>({name,lat,lng}))');
      assert.deepEqual(results, [expectedPoint(P[item.place])]); row.queries.push({...item, results});
      assert.equal(await evaluate("document.querySelector('#search-results-list').getAttribute('aria-busy')"), 'false');
    }
    provider.setSearch('إحداثيات تجربة', {points: [P.street, {...P.a, lat: 120}, {...P.a, lat: 21.5, lng: 39.2}, {...P.a, lat: undefined}]});
    await search('pickup', 'إحداثيات تجربة', P.street.name);
    assert.deepEqual(await resultNames(), [P.street.name], 'Malformed/outside-region positions never appear as biased coordinates');
    assert.equal((await lab.snapshot()).tripCount, 0); assert.equal(lab.audit.requests.some(r => ['live_quote', 'live_book', 'estimate'].includes(r.action)), false);
  });
  await record('out-of-order-search-cancellation-and-short-query', async row => {
    provider.setSearch('متأخر تجربة', {points: [P.other], mode: 'hold'});
    await search('pickup', 'متأخر تجربة'); await untilNode(() => provider.held.some(r => r.operation === 'search'), 'Old TomTom provider response is actually held');
    await search('pickup', 'King Fixture Road', P.street.name); provider.releaseHeld('search'); await wait(180);
    assert.deepEqual(await resultNames(), [P.street.name]);
    assert.equal(await evaluate("[...geoCache.values()].flat().some(p=>p.name==='متحف مشوار التجريبي')"), false, 'An ignored response cannot repopulate geoCache');
    const before = provider.audit.filter(r => r.operation === 'search').length;
    await fill('#search-pickup', 'x'); await wait(750);
    assert.equal(provider.audit.filter(r => r.operation === 'search').length, before, 'Enter on a short query does not call a provider');
    assert.deepEqual(await resultNames(), []); assert.ok(audit.canceledSearches.length > 0, 'The superseded browser search must be canceled'); row.canceledSearches = audit.canceledSearches;
  });
  await record('empty-provider-failure-offline-and-safe-retry', async row => {
    await search('pickup', 'لا نتائج تجربة'); await until("!editor.loading&&!!document.querySelector('.search-empty')", 'No-result message is visible'); assert.deepEqual(await resultNames(), []);
    provider.setSearch('تعطل تجربة', {mode: 'fail'}); await search('pickup', 'تعطل تجربة');
    await until("!editor.loading&&!!editor.error", 'Provider failure is visible and does not freeze search'); assert.deepEqual(await resultNames(), []);
    row.providerError = await evaluate('editor.error'); provider.setSearch('تعطل تجربة', {points: [P.district]}); await enter(); await until(hasResult(P.district.name), 'Retry after provider failure succeeds');
    provider.setSearch('offline fixture', {points: [P.landmark]});
    await command('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0});
    await search('pickup', 'offline fixture'); await until("!editor.loading&&!!editor.error", 'Offline search reports failure');
    assert.deepEqual(await resultNames(), []); row.offlineError = await evaluate('editor.error');
    await command('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1}); await enter(); await until(hasResult(P.landmark.name), 'Retry after reconnect succeeds');
    await shot('search-reconnected-mobile-ar');
  });
  await record('denied-gps-manual-pickup-favorite-identity-recent-and-saved-place', async row => {
    await click('[data-search-location]'); await until('!locating', 'Denied geolocation returns control');
    assert.equal(await evaluate("navigator.permissions.query({name:'geolocation'}).then(p=>p.state)"), 'denied');
    await search('pickup', P.a.name, P.a.name); await until("document.querySelectorAll('[data-search-select]').length===2", 'Both same-name/different-longitude places survive normalization');
    await click('[data-search-favorite="0"]'); await click('[data-search-favorite="1"]');
    assert.deepEqual((await evaluate('savedAddresses().map(p=>p.lng)')).sort(), [P.a.lng, P.b.lng]);
    await click('[data-search-favorite="1"]'); await click('[data-search-close]');
    await search('pickup', P.a.name, P.a.name);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-search-favorite]')].map(e=>e.classList.contains('saved'))"), [true, false]);
    await click('[data-search-select="1"]'); assert.deepEqual(await point('pickup'), expectedPoint(P.b));
    assert.ok(await evaluate(`recentAddresses().some(p=>p.lat===${P.b.lat}&&p.lng===${P.b.lng})`));
    await click('[data-search-close]'); await click('[data-action="saved-home"]'); await click('[data-favorite-current="home"]');
    await click('[data-action="saved-home"]');
    assert.equal(await evaluate(`document.querySelector('[data-favorite-use="home"]')!==null`), true, 'A named saved place can be retrieved');
    row.savedPlaceName = await evaluate("document.querySelector('#modal .feature-intro').textContent"); assert.equal(row.savedPlaceName, P.b.name);
    await click('#modal [data-action="close"]');
    assert.equal((await lab.snapshot()).tripCount, 0); assert.equal(lab.audit.requests.some(r => r.action === 'live_book'), false);
  });
  await record('selected-A-B-provider-route-pricing-geometry-bounds-and-stationary-markers', async row => {
    await pick('destination', P.landmark.name, P.landmark); await quoteReady();
    assert.deepEqual(await point('pickup'), expectedPoint(P.b)); assert.deepEqual(await point('destination'), expectedPoint(P.landmark));
    const quote = await evaluate('window.getMishwarBookingQuote()');
    assert.equal(quote.route.provider, 'TomTom'); assert.equal(quote.route.distanceMeters, 4850); assert.equal(quote.route.durationSeconds, 650); assert.equal(quote.route.trafficDelaySeconds, 85); assert.equal(quote.route.trafficAware, true);
    const stored = lab.env.db.prepare('SELECT pickup_json,destination_json,route_json,fare_halalas FROM ride_quotes WHERE id=?').get(quote.id);
    assert.equal(JSON.parse(stored.pickup_json).lng, P.b.lng); assert.equal(JSON.parse(stored.destination_json).lat, P.landmark.lat);
    assert.equal(stored.fare_halalas, quote.fare); assert.equal(quote.breakdown.distanceHalalas, Math.round(4850 * 90 / 1000)); assert.equal(quote.breakdown.timeHalalas, Math.round(650 * 10 / 60));
    const geometry = await evaluate('window.__readRiderRoute().toGeoJSON(false).features[0].geometry'); assert.deepEqual(geometry, quote.route.geometry);
    assert.deepEqual(geometry.coordinates[0], [P.b.lng, P.b.lat]); assert.deepEqual(geometry.coordinates.at(-1), [P.landmark.lng, P.landmark.lat]);
    assert.equal(await evaluate('liveMap.getBounds().contains(window.__readRiderRoute().getBounds())'), true, 'Map bounds include the provider route');
    const visible = await evaluate("document.querySelector('.ride-metrics').textContent"); assert.match(visible, /4\.8|4\.9/); assert.match(visible, /11/);
    const stable = await evaluate(`(()=>{const before={pickupId:pickupMarker._leaflet_id,destinationId:destinationMarker._leaflet_id,center:liveMap.getCenter(),zoom:liveMap.getZoom()},events={markerMoves:0,mapMoves:0};const marker=()=>events.markerMoves++,move=()=>events.mapMoves++;pickupMarker.on('move',marker);destinationMarker.on('move',marker);liveMap.on('movestart',move);for(let i=0;i<4;i++){syncMapPoints();render()}pickupMarker.off('move',marker);destinationMarker.off('move',marker);liveMap.off('movestart',move);return{before,after:{pickupId:pickupMarker._leaflet_id,destinationId:destinationMarker._leaflet_id,center:liveMap.getCenter(),zoom:liveMap.getZoom()},events}})()`);
    assert.deepEqual(stable.after, stable.before); assert.deepEqual(stable.events, {markerMoves: 0, mapMoves: 0});
    row.quote = {route: quote.route, fare: quote.fare, breakdown: quote.breakdown}; row.stationary = {...stable, scope: 'Repeated same-coordinate render synchronization; not physical GPS.'}; await shot('route-mobile-ar');
  });
  await record('editing-destination-and-pickup-clears-old-route-price-and-late-quote', async row => {
    provider.setRouteMode('hold'); await pick('destination', P.other.name, P.other);
    await untilNode(() => provider.held.some(r => r.operation === 'route'), 'A superseded route calculation is actually held');
    await openSearch('destination'); await fill('#search-destination', 'Fixture District');
    assert.equal(await evaluate('state.destination===null&&window.__readRiderRoute()===null'), true, 'Editing clears the old endpoint and route immediately');
    assert.equal(await evaluate("!!document.querySelector('.road-details')||!!document.querySelector('[data-action=book]:not(:disabled)')"), false, 'Old price cannot be confirmed');
    provider.setRouteMode('success'); await until(hasResult(P.district.name), 'Replacement destination search'); await click('[data-search-select="0"]'); await quoteReady();
    provider.releaseHeld('route'); await wait(200);
    assert.deepEqual(await point('destination'), expectedPoint(P.district));
    assert.deepEqual(await evaluate('window.__readRiderRoute().toGeoJSON(false).features[0].geometry.coordinates.at(-1)'), [P.district.lng, P.district.lat]);
    await openSearch('pickup'); await fill('#search-pickup', 'King Fixture Road');
    assert.equal(await evaluate('pickupPoint===null&&window.__readRiderRoute()===null'), true, 'Editing pickup clears route immediately');
    await until(hasResult(P.street.name), 'Replacement pickup search'); await click('[data-search-select="0"]'); await quoteReady();
    assert.deepEqual(await point('pickup'), expectedPoint(P.street));
    const quote = await evaluate('window.getMishwarBookingQuote()');
    assert.deepEqual(quote.route.geometry.coordinates[0], [P.street.lng, P.street.lat]); assert.deepEqual(quote.route.geometry.coordinates.at(-1), [P.district.lng, P.district.lat]);
    row.finalInputs = lab.audit.requests.filter(r => r.action === 'live_quote').at(-1).routeInputs; await shot('route-replaced-mobile-ar');
  });
  await record('provider-route-failure-wrong-endpoints-timeout-and-safe-retry', async row => {
    row.failures = [];
    for (const mode of ['fail', 'wrong-route', 'timeout']) {
      provider.setRouteMode(mode); await pick('destination', P.other.name, P.other);
      await until("!!document.querySelector('[data-refresh-quote]')", mode + ' must expose a retry without invented route/price', mode === 'timeout' ? 14000 : 12000);
      assert.equal(await evaluate('window.__readRiderRoute()===null'), true); assert.equal(await evaluate("!!document.querySelector('[data-action=book]:not(:disabled)')"), false);
      const text = await evaluate("document.querySelector('.ride-metrics').textContent"); assert.doesNotMatch(text, /4\.8|4\.9|11\s*(دقيقة|min)/);
      row.failures.push({mode, message: await evaluate("document.querySelector('.ride-error').textContent")});
      provider.setRouteMode('success'); await click('[data-refresh-quote]'); await quoteReady();
      assert.deepEqual(await evaluate('window.__readRiderRoute().toGeoJSON(false).features[0].geometry.coordinates.at(-1)'), [P.other.lng, P.other.lat]);
    }
    await shot('provider-failure-recovered');
  });
  await record('mobile-arabic-RTL-english-and-search-remain-responsive', async row => {
    row.viewports = [];
    for (const [width, height, language] of [[320, 568, 'ar'], [390, 844, 'en']]) {
      await command('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: true});
      const currentLanguage = await evaluate('window.MishwarLang.get()'); if (currentLanguage !== language) await click('#mishwar-language');
      await openSearch('destination'); await fill('#search-destination', language === 'ar' ? 'برج مشوار التجريبي' : 'Mishwar Fixture Tower'); await until(hasResult(P.landmark.name), 'Search remains responsive after viewport/language change');
      const layout = await evaluate(`(()=>{const e=document.querySelector('#search-destination'),r=e.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dir:document.documentElement.dir,overflow:document.documentElement.scrollWidth>innerWidth+1,inputVisible:r.left>=-1&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight}})()`);
      assert.equal(layout.dir, language === 'ar' ? 'rtl' : 'ltr'); assert.equal(layout.overflow, false); assert.equal(layout.inputVisible, true); row.viewports.push({...layout, language});
      await shot('search-' + width + '-' + language); await click('[data-search-close]');
    }
  });
  await record('search-route-comparison-has-no-booking-or-financial-side-effects', async row => {
    row.database = await lab.snapshot(); assert.equal(row.database.tripCount, 0); assert.equal(row.database.liveBookCount, 0); assert.equal(row.database.counts.walletEntries, 0); assert.equal(row.database.counts.settlements, 0);
    assert.equal(lab.audit.requests.some(r => ['live_book', 'live_reserve', 'live_payment_init', 'live_payment_verify', 'live_recharge'].includes(r.action)), false);
    assert.deepEqual(audit.exceptions, []); assert.deepEqual(audit.unexpectedExternal, []); assert.deepEqual(lab.audit.errors, []); assert.deepEqual(lab.audit.externalBlocked, []);
    assert.ok(provider.audit.every(r => r.synthetic)); row.providerRequests = provider.audit.length;
  });
} catch (error) {
  if (!audit.tests.some(row => !row.passed)) audit.tests.push({name: 'runner', passed: false, error: error.message});
  console.error(error.stack); if (command) try {const data = await command('Page.captureScreenshot', {format: 'png'}); writeFileSync(join(output, 'screens', 'FAIL-runner.png'), Buffer.from(data.data, 'base64'));} catch {}
} finally {
  clearTimeout(deadline); provider.releaseHeld(); ws?.close(); browser.kill(); audit.provider = provider.audit; audit.server = lab.audit; await lab.close();
  const failed = audit.tests.filter(row => !row.passed).length;
  const summary = {stage: 'RIDER-014', status: failed ? 'FAIL' : 'LOCAL_PASS_EXTERNAL_BLOCKED', total: audit.tests.length, passed: audit.tests.length - failed, failed, stageComplete: false, realTomTomVerified: false, output, publicRoot, limitations: audit.limitations};
  writeFileSync(join(output, 'observations.json'), JSON.stringify(audit, null, 2) + '\n'); writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary)); if (failed) process.exitCode = 1;
}
