import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {startTrackingServer} from './fixtures/rider-tracking-server.mjs';

// RDEV-003: browser acceptance against actual application gateways, auth,
// captain handlers and migrated SQLite. Only SMS, road, map tiles and GPS are
// declared local fixtures. The browser enters addresses and books through UI.
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const publicRoot=resolve(option('--public','apps/rider/dist/public'));
const output=resolve(option('--output','.local-verification/rdev003-browser-'+Date.now()));
mkdirSync(join(output,'screens'),{recursive:true});
assert.ok(existsSync(join(publicRoot,'index.html')),'Build rider first');
const nativeFetch=globalThis.fetch,lab=await startTrackingServer({publicRoot});
const observations={phase:'RDEV-003',results:[],externalBlocked:[],exceptions:[],consoleErrors:[],limitations:[
  'Headless Edge mobile viewport; no physical device or Safari test.',
  lab.disclosure,
  'GPS aging, route-cache invalidation and held route replies are explicit failure injections into this local fixture only.',
  'No real TomTom request, payment, production or Staging resource is used.',
]};
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(edge,'Edge or Chromium required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-rdev003-'));
const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let ws,command,evaluate,current=null;
const timeout=setTimeout(()=>{console.error('RDEV003_BROWSER_TIMEOUT');browser.kill();process.exit(2)},300000);timeout.unref();
try{
  let port;
  for(let n=0;n<100;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}
  assert.match(port||'',/^\d+$/,'CDP launch failed');
  const targets=await nativeFetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  const page=targets.find(t=>t.type==='page'&&t.url==='about:blank');assert.ok(page,'Use only our new blank target');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail;setTimeout(()=>fail(Error('CDP websocket deadline')),8000).unref()});
  let sequence=0;const pending=new Map();
  command=(method,params={})=>new Promise((done,fail)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP deadline: '+method))},12000);pending.set(id,{done:value=>{clearTimeout(timer);done(value)},fail:error=>{clearTimeout(timer);fail(error)}});ws.send(JSON.stringify({id,method,params}))});
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.fail(Error(JSON.stringify(message.error))):p?.done(message.result);return}
    if(message.method==='Runtime.exceptionThrown')observations.exceptions.push({scenario:current?.name,text:message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text});
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')observations.consoleErrors.push({scenario:current?.name,text:message.params.args.map(x=>x.value||x.description).join(' ')});
    if(message.method==='Fetch.requestPaused'){
      const request=message.params,url=new URL(request.request.url);
      const fulfill=(mime,text)=>command('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:mime}],body:Buffer.from(text).toString('base64')});
      if(url.origin===lab.origin)void command('Fetch.continueRequest',{requestId:request.requestId}).catch(()=>{});
      else if(url.hostname==='fonts.googleapis.com'&&url.pathname==='/css2')void fulfill('text/css','/* Local system fonts. */').catch(()=>{});
      else if(url.hostname==='tile.openstreetmap.org'&&url.pathname.endsWith('.png'))void fulfill('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/><path d="M0 128H256M128 0V256" stroke="white" stroke-width="12"/></svg>').catch(()=>{});
      else{observations.externalBlocked.push({scenario:current?.name,origin:url.origin,path:url.pathname});void command('Fetch.failRequest',{requestId:request.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
    }
  };
  evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async(expression,label,ms=18000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expression))return;await wait(100)}throw Error(label)};
  const untilLocal=async(test,label,ms=18000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await wait(100)}throw Error(label)};
  const settle=()=>evaluate("Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))");
  const visible=selector=>`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true})&&e.getClientRects().length)`;
  const click=async selector=>{await settle();await evaluate(`(${visible(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await wait(60);const p=await evaluate(`(()=>{const e=${visible(selector)};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,clickable:!e.disabled&&!!h&&(e===h||e.contains(h)),hit:h?.outerHTML.slice(0,160)}})()`);assert.ok(p?.clickable,'Blocked UI '+selector+': '+JSON.stringify(p));for(const[type,extra]of[['mouseMoved',{}],['mousePressed',{button:'left',clickCount:1}],['mouseReleased',{button:'left',clickCount:1}]])await command('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,...extra});await wait(80);await settle()};
  const fill=async(selector,value)=>{await click(selector);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.insertText',{text:String(value)})};
  const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'screens',name+'.png'),Buffer.from(r.data,'base64'))};
  const check=async(name,run)=>{current={name,passed:false,startedAt:Date.now()};observations.results.push(current);try{await run();current.passed=true;console.log('PASS '+name)}catch(error){current.error=error.message;current.dom=await evaluate('document.body.innerText.slice(0,16000)').catch(()=>'');current.snapshot=await lab.snapshot().catch(()=>null);await shot('FAIL-'+name).catch(()=>{});throw error}finally{current.durationMs=Date.now()-current.startedAt}};
  const live=()=>evaluate("fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'live_session'})}).then(async r=>({status:r.status,data:await r.json()}))");
  const etaAvailable=minutes=>`document.querySelector('[data-live-eta]')?.dataset.state==='available'&&document.querySelector('[data-eta-minutes]')?.textContent===${JSON.stringify(String(minutes))}`;
  const noEtaNumber="document.querySelector('[data-eta-minutes]')?.textContent==='—'";
  const markerCount="document.querySelectorAll('.captain-car-marker').length";
  await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:"window.__rdev003Document=Date.now()+':'+Math.random()"});
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const f=await lab.resetFixture({returning:true,scenarioId:'rdev003-tracking'});
  await command('Browser.setPermission',{origin:lab.origin,permission:{name:'geolocation'},setting:'denied'});
  await command('Page.navigate',{url:lab.origin+'/?tracking-test=rdev003'});
  await until("window.MishwarAccountContext?.snapshot().status==='ready'&&!!document.querySelector('.mobile-nav [data-open-menu]')",'Actual app/session ready');
  const initialDocument=await evaluate('window.__rdev003Document');

  await check('authenticated-ui-booking',async()=>{
    assert.equal((await lab.snapshot()).tripCount,0);
    await click('.mobile-nav [data-open-menu]');await click('#drawer [data-section="profile"]');
    await until("!!document.querySelector('#rider-password-form')",'Login form');
    await fill('#rider-password-form [name="phone"]',f.credentials.phone);await fill('#rider-password-form [name="password"]',f.credentials.password);await click('#rider-password-form [type="submit"]');
    await until("!!document.querySelector('.profile-state.verified')",'Actual verified login');await click('#modal [data-action="close"]');
    await click('#locate');if(await evaluate("!!document.querySelector('#onboarding-allow')"))await click('#onboarding-allow');
    await until("document.querySelector('#locate')?.dataset.locationState==='denied'",'Permission denied shows manual option');
    for(let n=0;n<3&&await evaluate("!!document.querySelector('#onboarding-skip')");n++)await click('#onboarding-skip');
    await click('.mw-destination-entry');await until("!document.querySelector('#search-sheet').hidden",'Search opens');
    await fill('#search-pickup',f.places.pickup.name);await until("[...document.querySelectorAll('[data-search-select]')].some(e=>e.textContent.includes("+JSON.stringify(f.places.pickup.name)+'))','Synthetic provider pickup');await click('#search-results-list [data-search-select]');
    await until("document.querySelector('#search-destination')===document.activeElement",'Destination focus');
    await fill('#search-destination',f.places.destination.name);await until("[...document.querySelectorAll('[data-search-select]')].some(e=>e.textContent.includes("+JSON.stringify(f.places.destination.name)+'))','Synthetic provider destination');await click('#search-results-list [data-search-select]');
    await until("!!document.querySelector('.ride-categories [data-tier=comfort]')&&!document.querySelector('[data-action=book]')?.disabled&&document.querySelector('.ride-categories')?.getAttribute('aria-busy')==='false'",'Actual route and price');
    await click('.ride-categories [data-tier="comfort"]');await until("document.querySelector('[data-tier=comfort]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-action=book]')?.disabled&&document.querySelector('.ride-categories')?.getAttribute('aria-busy')==='false'",'Selected category reprice');
    await click('#panel [data-action="book"]');await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('بانتظار قبول الكابتن')",'Actual booking matching');
    assert.equal((await lab.snapshot()).tripCount,1);assert.equal((await lab.snapshot()).liveBookCount,1);
    await lab.advanceTrip('accept');await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('الكابتن في الطريق')",'Captain API acceptance reaches rider');
  });
  await check('authenticated-gps-road-eta',async()=>{
    assert.equal((await lab.gps({lat:24.7127,lng:46.6744})).status,200);lab.invalidateEtaCache();
    await until(etaAvailable(4),'Road ETA is four synthetic minutes');await until(markerCount+'>0','Live captain marker');
    const session=await live();assert.equal(session.status,200);assert.equal(session.data.trip.eta.provider,'TomTom');assert.equal(session.data.trip.eta.distanceMeters,1000);assert.equal(session.data.trip.eta.trafficDelaySeconds,35);assert.equal(session.data.trip.eta.target,'pickup');
    current.roadFacts=session.data.trip.eta;await shot('pickup-eta-390');await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});await wait(200);await shot('pickup-eta-320');await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  });
  await check('reject-inaccurate-old-and-other-trip-gps',async()=>{
    const before=(await live()).data.trip.driverLocation;
    assert.equal((await lab.gps({lat:24.711,lng:46.673},{accuracy:151})).status,400);
    assert.equal((await lab.gps({lat:24.711,lng:46.673},{observedAt:new Date(Date.now()-60000).toISOString()})).status,400);
    assert.equal((await lab.gps({lat:24.711,lng:46.673},{tripId:'00000000-0000-4000-8000-000000000099'})).status,403);
    assert.deepEqual((await live()).data.trip.driverLocation,before);
    const unauth=await nativeFetch(lab.origin+'/api/live',{method:'POST',headers:{'Content-Type':'application/json',Origin:lab.origin},body:JSON.stringify({action:'live_session',tripId:(await lab.snapshot()).trip.id})});
    const data=await unauth.json();assert.ok(!data.trip,'Unauthenticated request gets no private trip');assert.ok(!JSON.stringify(data).includes('driverLocation'));
  });
  await check('poll-keeps-open-profile-and-document',async()=>{
    await click('#panel [data-live-home]');await until("!!document.querySelector('#panel [data-resume-trip]')&&!document.body.classList.contains('rider-select')",'Trip safely minimized');await click('.mobile-nav [data-open-menu]');await click('#drawer [data-section="profile"]');await until("!!document.querySelector('.rider-account-card')",'Profile stays open during live polling');
    const expected=(await lab.snapshot()).trip.id;
    assert.equal((await lab.gps({lat:24.7128,lng:46.6745})).status,200);await wait(4000);
    assert.ok(await evaluate("!!document.querySelector('.rider-account-card')"),'Polling must preserve open modal');assert.equal(await evaluate('window.__rdev003Document'),initialDocument);assert.equal((await lab.snapshot()).trip.id,expected);
    await click('#modal [data-action="close"]');await click('#panel [data-resume-trip]');await until("!!document.querySelector('#panel .live-trip')",'Live trip resumed');
  });
  await check('stale-gps-hides-live-estimate',async()=>{
    lab.ageGpsForFixture();await until(noEtaNumber,'Old GPS cannot retain numeric ETA',45000);await until("document.querySelector('[data-live-eta]')?.dataset.state==='stale'",'Old GPS is visibly stale');
    const data=(await live()).data.trip;assert.equal(data.driverLocation.fresh,false);assert.equal(data.eta.status,'unavailable');await shot('stale-gps');
  });
  await check('offline-reconnect-requires-fresh-sample',async()=>{
    lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7129,lng:46.6746})).status,200);await until(etaAvailable(4),'Fresh sample restores road ETA');
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await until("navigator.onLine===false&&document.querySelector('[data-live-eta]')?.dataset.state==='stale'&&"+noEtaNumber,'Offline immediately removes numeric estimate');await shot('offline');
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await until('navigator.onLine===true','Network restored');lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.713,lng:46.6747})).status,200);await until(etaAvailable(4),'A newer sample restores tracking after reconnect');
    assert.equal(await evaluate('window.__rdev003Document'),initialDocument);
  });
  await check('provider-failure-does-not-fabricate-eta',async()=>{
    lab.controls.routeMode='failure';lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7131,lng:46.6748})).status,200);
    await until(noEtaNumber,'Provider outage hides ETA');const session=await live();assert.equal(session.data.trip.eta.status,'unavailable');
    lab.controls.routeMode='ready';lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7132,lng:46.6749})).status,200);await until(etaAvailable(4),'Provider recovery restores genuine fixture road result');
  });
  await check('late-route-response-discarded',async()=>{
    lab.controls.routeMode='hold';lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7133,lng:46.675})).status,200);
    await untilLocal(()=>lab.controls.releases.length>0,'Actual poll reaches held road provider');
    assert.equal((await lab.gps({lat:24.7134,lng:46.6751})).status,200);lab.controls.routeMode='ready';lab.releaseRoutes();
    await until(noEtaNumber,'Delayed route for old GPS is not displayed as current');
    const data=(await live()).data.trip;assert.equal(data.driverLocation.lat,24.7134);assert.ok(data.eta.status!=='available'||data.eta.locationAt===data.driverLocation.at,'Only current-location route can be shown');
    lab.invalidateEtaCache();await until(etaAvailable(4),'Subsequent current-location route recovers');
  });
  await check('arrived-and-driving-destination-eta',async()=>{
    await lab.advanceTrip('arrived');await until("document.querySelector('[data-live-eta]')?.dataset.state==='arrived'",'Arrival is explicit without invented zero ETA');
    const pin=await evaluate("document.querySelector('.trip-pin-card strong')?.textContent.trim()||''");await lab.advanceTrip('start',{pin});lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.714,lng:46.676})).status,200);
    await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('رحلتك جارية')&&"+etaAvailable(7),'Driving route ETA seven minutes');
    assert.equal(await evaluate("document.querySelector('[data-eta-target]')?.getAttribute('data-eta-target')"),'destination');assert.equal((await live()).data.trip.eta.distanceMeters,2200);await shot('destination-eta');
  });
  await check('reduced-motion-captain-marker',async()=>{
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal((await lab.gps({lat:24.7142,lng:46.6762})).status,200);
    await until(markerCount+'>0','Captain marker remains available with reduced motion');assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),true);await shot('reduced-motion');
  });
  await check('completed-trip-stops-private-tracking',async()=>{
    await lab.advanceTrip('complete');await until("document.querySelector('#panel .live-trip h2')?.textContent.includes('وصلتم بالسلامة')",'Trip completes through actual captain API');
    await until(markerCount+"===0&&!document.querySelector('[data-live-eta]')",'Terminal trip removes private marker and ETA');
    const data=await evaluate("fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'live_session',tripId:"+JSON.stringify((await lab.snapshot()).trip.id)+"})}).then(async r=>({status:r.status,data:await r.json()}))"),trip=data.data.trip||data.data.recentTrip;assert.equal(data.status,200);assert.ok(trip,'Completed trip not returned to its owner');assert.equal(trip.status,'completed');assert.equal(trip.driverLocation,null);assert.ok(trip.eta==null);assert.ok(!Object.keys(trip).some(k=>/^driver_(lat|lng|accuracy|location_at)$/.test(k)));assert.equal(await evaluate('window.__rdev003Document'),initialDocument);
    const final=await lab.snapshot();assert.equal(final.tripCount,1);assert.equal(final.counts.settlements,1);assert.equal(final.ledgerTotal,0);assert.equal(final.externalNetworkCalls,0);current.snapshot=final;await shot('completed');
  });
  observations.audit=lab.audit;observations.providerFacts=lab.controls.facts;
  assert.equal(observations.externalBlocked.length,0,'No unexpected browser network');assert.equal(observations.exceptions.length,0,'No uncaught browser exception');assert.equal(observations.consoleErrors.length,0,'No browser console error');assert.equal(lab.audit.errors.length,0,'No fixture request error');
}catch(error){observations.fatalError=error.message;observations.audit=lab.audit;observations.providerFacts=lab.controls.facts;console.error('RDEV003_FATAL: '+error.message)}finally{
  clearTimeout(timeout);ws?.close();browser.kill();lab.releaseRoutes();await lab.close();observations.completedAt=new Date().toISOString();
  const passed=observations.results.filter(r=>r.passed).length,failed=observations.results.length-passed,status=!failed&&!observations.fatalError&&passed===11?'PASS':'FAIL';
  const summary={phase:'RDEV-003',status,total:observations.results.length,passed,failed,fatalError:observations.fatalError||null,output,limitations:observations.limitations};writeFileSync(join(output,'observations.json'),JSON.stringify(observations,null,2)+'\n');writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));if(status!=='PASS')process.exitCode=1;
}
