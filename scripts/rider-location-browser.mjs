import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,extname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// RIDER-007: real Chromium document and pointer events, loopback APIs only.
// CDP emulates GPS hardware for native permission tests. Separately labelled
// synthetic callbacks exercise timestamps and responses after cancellation.
// This does not certify physical GPS, Android/iOS permissions or production.
const args=process.argv.slice(2);
const root=resolve(args.find(a=>!a.startsWith('--'))||'apps/rider/dist/public');
const artifacts=resolve(args.find(a=>a.startsWith('--artifacts='))?.slice(12)||'.local-verification/rider-007-browser/'+Date.now());
mkdirSync(artifacts,{recursive:true});
assert.ok(existsSync(join(root,'index.html')),'Build apps/rider before running RIDER-007 browser tests');
const observations={tests:[],api:[],missing:[],blockedExternal:[],stubbedExternal:[],exceptions:[],consoleErrors:[],reverseStarted:0,reverseCompleted:0,productionVerified:false,physicalGpsVerified:false};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const pendingReverse=new Set();
let holdReverse=false;
function releaseReverse(){holdReverse=false;for(const done of pendingReverse)done();pendingReverse.clear();}
const guest=()=>({guest:true,verified:false,accountKey:null,trip:null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false}});
const readActions=new Set(['live_session','live_watch','live_history','live_capabilities','live_reservations','live_contacts','live_cases','live_referral','live_realtime_token','live_refunds']);
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function reverseFeature(url){return {features:[{geometry:{type:'Point',coordinates:[Number(url.searchParams.get('lon')),Number(url.searchParams.get('lat'))]},properties:{name:'Browser fixture GPS pickup',city:'Riyadh',country:'Saudi Arabia'}}]};}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000){json(res,{error:'Fixture request too large'},413);return;}}
  let body={};try{body=JSON.parse(raw||'{}')}catch{}
  observations.api.push({path,method:req.method,action:body.action||null});
  if(path==='/api/auth/session'){json(res,{authenticated:false,phoneVerified:false,accountKey:null,profile:null});return;}
  if(path==='/api/map-config'){json(res,{searchConfigured:true});return;}
  if(path==='/api/places/reverse'){
   observations.reverseStarted++;
   if(holdReverse)await new Promise(done=>pendingReverse.add(done));
   observations.reverseCompleted++;json(res,reverseFeature(url));return;
  }
  if(path==='/api/places'){json(res,{features:[]});return;}
  if(path==='/api/service-status'){json(res,{features:[],ready:false});return;}
  if(path==='/api/background'){json(res,{configured:false,notifications:[]});return;}
  if(path==='/api/live'&&readActions.has(body.action)){
   if(['live_session','live_watch'].includes(body.action)){json(res,guest());return;}
   if(body.action==='live_history'){json(res,{trips:[],ratings:{average:0,receivedCount:0},nextOffset:null});return;}
   if(body.action==='live_realtime_token'){json(res,{error:'Offline realtime intentionally disabled'},503);return;}
   json(res,{items:[],features:[],schedulerConfigured:false});return;
  }
  // Quotes and writes are deliberately NOT fabricated as successful.
  json(res,{error:'Location fixture permits configured read actions only'},403);return;
 }
 try{
  const file=resolve(root,'.'+(path==='/'?'/index.html':path)),inside=relative(root,file);
  if(inside.startsWith('..')||isAbsolute(inside))throw Error('outside fixture');
  const bytes=readFileSync(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes);
 }catch{observations.missing.push(path);res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const executable=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(executable,'A local Chromium browser is required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-location-browser-'));
const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,command,evaluate,syntheticScript;
const timeout=setTimeout(()=>{browser.kill();console.error('LOCATION_BROWSER_TIMEOUT');process.exit(2)},180000);timeout.unref();
const pointExpression="(()=>{const p=window.getMishwarPickup?.()??pickupPoint;return p?JSON.parse(JSON.stringify(p)):null})()";
const syntheticSource=`(()=>{
 const records=[];let sequence=0;
 window.__locationSynthetic={kind:'synthetic-callbacks-only',records,
  emit({latitude=24.7131,longitude=46.6731,accuracy=10,timestamp=Date.now(),includeCleared=false}={}){for(const r of [...records])if(includeCleared||!r.cleared){window.__gpsCallbacks++;r.success({coords:{latitude,longitude,accuracy},timestamp})}},
  error(code){for(const r of [...records])if(!r.cleared)r.error?.({code,message:'Synthetic geolocation error'})}};
 const add=(success,error,options,once)=>{const id=++sequence;window.__gpsRequests++;records.push({id,success,error,options,once,cleared:false});return id};
 Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
  watchPosition:(success,error,options)=>add(success,error,options,false),
  getCurrentPosition:(success,error,options)=>{add(success,error,options,true)},
  clearWatch:id=>{const r=records.find(r=>r.id===id);if(r)r.cleared=true;window.__gpsClears++}
 }});
})();`;
const baseSource=`window.__gpsRequests=0;window.__gpsCallbacks=0;window.__gpsClears=0;window.__locationDocument=crypto.randomUUID();
 try{localStorage.setItem('mishwar-permissions-onboarded-v2','true');localStorage.removeItem('mishwar-location-follow');sessionStorage.removeItem('mishwar-manual-pickup')}catch{}
 if(navigator.geolocation){for(const method of ['getCurrentPosition','watchPosition']){const native=navigator.geolocation[method].bind(navigator.geolocation);navigator.geolocation[method]=(success,error,options)=>{window.__gpsRequests++;return native(position=>{window.__gpsCallbacks++;success(position)},error,options)}}const clear=navigator.geolocation.clearWatch.bind(navigator.geolocation);navigator.geolocation.clearWatch=id=>{window.__gpsClears++;return clear(id)}}`;

try{
 let port='';for(let i=0;i<100;i++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch(error){if(!['ENOENT','EBUSY','EACCES'].includes(error.code))throw error;}await wait(100);}
 assert.match(port,/^\d+$/,'Browser debugging endpoint must start');
 const tabs=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 await new Promise((done,reject)=>{ws.onopen=done;ws.onerror=reject;setTimeout(()=>reject(Error('CDP connection timeout')),5000).unref();});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((done,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);pending.set(id,{done:value=>{clearTimeout(timer);done(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry?.reject(Error(JSON.stringify(message.error))):entry?.done(message.result);}
  else if(message.method==='Runtime.exceptionThrown')observations.exceptions.push(message.params.exceptionDetails);
  else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')observations.consoleErrors.push(message.params.args.map(a=>a.value||a.description||'').join(' '));
  else if(message.method==='Fetch.requestPaused'){
   const request=message.params,url=new URL(request.request.url);
   if(url.origin===origin){void command('Fetch.continueRequest',{requestId:request.requestId}).catch(()=>{});return;}
   // Known decorative resources are fulfilled locally; unknown external URLs fail.
   // Empty font CSS intentionally selects system fonts and makes no gstatic request.
   if(url.hostname==='fonts.googleapis.com'&&url.pathname==='/css2'){
    observations.stubbedExternal.push({origin:url.origin,type:'empty-font-stylesheet'});
    void command('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/css; charset=utf-8'}],body:Buffer.from('/* Offline fixture: system fonts only. */').toString('base64')}).catch(()=>{});
   }
   // Transparent fixture tiles are fulfilled locally. No HTTP request reaches a map provider.
   else if(url.hostname==='tile.openstreetmap.org'&&/\.png$/.test(url.pathname)){
    observations.stubbedExternal.push({origin:url.origin,type:'transparent-map-tile'});
    void command('Fetch.fulfillRequest',{requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}).catch(()=>{});
   }else{
    observations.blockedExternal.push({origin:url.origin,path:url.pathname});
    void command('Fetch.failRequest',{requestId:request.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
   }
  }
 };
 evaluate=async expression=>{const reply=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value;};
 const until=async(expression,message,limit=7000)=>{const end=Date.now()+limit;while(Date.now()<end){if(await evaluate(expression))return;await wait(40);}throw Error(message);};
 const screenshot=async name=>{const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name.replace(/[^a-z0-9_-]/gi,'-')+'.png'),Buffer.from(shot.data,'base64'));};
 const click=async selector=>{
  await until(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing '+selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);await wait(30);
  const target=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:r.width,h:r.height,clickable:!!hit&&(hit===e||e.contains(hit)),hit:hit?.outerHTML.slice(0,200)}})()`);
  assert.ok(target.w>0&&target.h>0&&target.clickable,'Pointer target is obstructed: '+selector+' '+JSON.stringify(target));
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
 };
 const record=async(name,kind,fn)=>{const row={name,kind,passed:false};observations.tests.push(row);try{await fn(row);row.passed=true;console.log('PASS '+name);}catch(error){row.error=error.message;console.error('FAIL '+name+': '+error.message);try{await screenshot('FAIL-'+name);}catch{}}finally{releaseReverse();}};
 const nativePermission=setting=>command('Browser.setPermission',{permission:{name:'geolocation'},setting,origin});
 const navigate=async({synthetic=false,permission='granted',latitude=24.7131,longitude=46.6731,accuracy=12}={})=>{
  releaseReverse();
  if(syntheticScript){await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:syntheticScript});syntheticScript=null;}
  if(synthetic)syntheticScript=(await command('Page.addScriptToEvaluateOnNewDocument',{source:syntheticSource})).identifier;
  await nativePermission(permission);
  await command('Emulation.setGeolocationOverride',{latitude,longitude,accuracy});
  const old=await evaluate('window.__locationDocument');
  await command('Page.navigate',{url:origin+'/?location='+Date.now()});
  await until(`window.__locationDocument!==${JSON.stringify(old)}&&document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'&&!!document.querySelector('#locate')`,'Location application must finish bootstrap');
  // Allow map-config to finish before requesting any reverse lookup.
  await until("mapConfig.reverse===location.origin+'/api/places/reverse'",'Map provider fixture must be selected');
  await wait(50);
 };
 const manual=async(name='Manual test pickup')=>{await evaluate(`setPickup({lat:24.72,lng:46.68,name:${JSON.stringify(name)},area:'Local browser fixture'})`);return evaluate(pointExpression);};
 const unchanged=async expected=>assert.deepEqual(await evaluate(pointExpression),expected,'The rider-selected manual pickup must remain unchanged');
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
 await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:baseSource});

 for(const [viewport,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<701});
  await record(viewport+'-native-permission-fresh-fix','native-permission-cdp-hardware-emulation',async row=>{
   await navigate();assert.equal(await evaluate('window.__gpsRequests'),0,'GPS must not start before an explicit request');
   row.permission=await evaluate("navigator.permissions.query({name:'geolocation'}).then(p=>p.state)");assert.equal(row.permission,'granted');
   await click('#locate');
   await until("pickupPoint?.source==='gps'&&pickupPoint.resolved===true",'Fresh accurate native callback must resolve a GPS pickup');
   row.pickup=await evaluate(pointExpression);
   assert.ok(Math.abs(row.pickup.lat-24.7131)<0.000001);assert.ok(Math.abs(row.pickup.lng-46.6731)<0.000001);
   assert.equal(row.pickup.accuracy,12);assert.ok(Number.isFinite(row.pickup.observedAt),'GPS acquisition time must be retained');
   assert.ok(Math.abs(Date.now()-row.pickup.observedAt)<30000,'Accepted coordinate must be current');
   assert.ok((await evaluate('window.__gpsCallbacks'))>0,'A real native Geolocation callback must execute');await screenshot(row.name);
  });
  await record(viewport+'-native-denied-retains-manual','native-permission-cdp-hardware-emulation',async row=>{
   await navigate({permission:'denied'});const selected=await manual();assert.equal(selected.source,'manual');
   row.permission=await evaluate("navigator.permissions.query({name:'geolocation'}).then(p=>p.state)");assert.equal(row.permission,'denied');
   await click('#locate');
   await until("document.querySelector('#locate')?.dataset.locationState==='denied'||document.querySelector('#toast')?.textContent.includes('مرفوض')||document.querySelector('#toast')?.textContent.includes('اسمح')",'Denied location permission must be explained');
   await unchanged(selected);row.pickup=await evaluate(pointExpression);await screenshot(row.name);
  });
  await record(viewport+'-native-denied-then-granted-retry','native-permission-cdp-hardware-emulation',async row=>{
   await navigate({permission:'denied'});const selected=await manual(),documentBefore=await evaluate('window.__locationDocument');
   await click('#locate');
   await until("document.querySelector('#locate')?.dataset.locationState==='denied'",'Initial browser denial must reach the location state');
   await unchanged(selected);
   await nativePermission('granted');
   await command('Emulation.setGeolocationOverride',{latitude:24.7133,longitude:46.6733,accuracy:11});
   assert.equal(await evaluate("navigator.permissions.query({name:'geolocation'}).then(p=>p.state)"),'granted','Permission must actually change in Chromium');
   await click('#locate');
   await until("pickupPoint?.source==='gps'&&pickupPoint.resolved===true",'An explicit retry after granting permission must acquire a fresh fix');
   row.pickup=await evaluate(pointExpression);assert.ok(Math.abs(row.pickup.lat-24.7133)<0.000001);assert.equal(row.pickup.accuracy,11);
   assert.equal(await evaluate('window.__locationDocument'),documentBefore,'Retry must work without reloading the document');
  });
  await record(viewport+'-native-low-accuracy-rejected','native-permission-cdp-hardware-emulation',async row=>{
   await navigate({accuracy:151});const selected=await manual(),reverseBefore=observations.reverseStarted;
   await click('#locate');await until('window.__gpsCallbacks>0','Native low-accuracy sample must be delivered');await wait(100);
   await unchanged(selected);assert.equal(observations.reverseStarted,reverseBefore,'Rejected accuracy must not trigger reverse lookup');row.pickup=await evaluate(pointExpression);
  });
  await record(viewport+'-native-outside-service-area-rejected','native-permission-cdp-hardware-emulation',async row=>{
   await navigate({latitude:21.5,longitude:39.2});const selected=await manual(),reverseBefore=observations.reverseStarted;
   await click('#locate');await until('window.__gpsCallbacks>0','Native out-of-area sample must be delivered');await wait(100);
   await unchanged(selected);assert.equal(observations.reverseStarted,reverseBefore,'Out-of-area fix must not trigger reverse lookup');row.pickup=await evaluate(pointExpression);
  });
 }
 await record('synthetic-stale-and-future-fixes-rejected','synthetic-callback-timestamps',async row=>{
  await navigate({synthetic:true});const selected=await manual(),reverseBefore=observations.reverseStarted;
  await click('#locate');await until('window.__locationSynthetic.records.length>0','Synthetic fixture must capture the explicit location request');
  await evaluate('window.__locationSynthetic.emit({timestamp:Date.now()-30001})');await wait(80);await unchanged(selected);
  await evaluate('window.__locationSynthetic.emit({timestamp:Date.now()+10000})');await wait(80);await unchanged(selected);
  assert.equal(observations.reverseStarted,reverseBefore,'Timestamp failures must not request addresses');row.pickup=await evaluate(pointExpression);
 });
 await record('synthetic-onboarding-invalid-waits-for-fresh-fix','synthetic-callback-and-real-onboarding-pointer',async row=>{
  await navigate({synthetic:true});const selected=await manual('Manual pickup before permission onboarding');
  await evaluate('window.showMishwarPermissions()');
  await until("document.querySelector('#permission-onboarding[open] .onboarding-step')?.textContent.includes('1 من')",'The location onboarding step must open');
  const originalHeading=await evaluate("document.querySelector('#permission-onboarding-title').textContent");
  await click('#onboarding-allow');await until('window.__locationSynthetic.records.length>0','Allow must request location without skipping the location step');
  await evaluate('window.__locationSynthetic.emit({accuracy:151})');
  await until("!!document.querySelector('#onboarding-feedback')?.textContent&&document.querySelector('#onboarding-allow')?.disabled===false",'Invalid GPS must explain the problem and permit a retry');
  assert.equal(await evaluate("document.querySelector('#permission-onboarding-title').textContent"),originalHeading,'An invalid measurement must not advance permission onboarding');
  await unchanged(selected);
  row.invalidFeedback=await evaluate("document.querySelector('#onboarding-feedback').textContent");
  await click('#onboarding-allow');await evaluate('window.__locationSynthetic.emit({accuracy:10})');
  await until("document.querySelector('#permission-onboarding[open] .onboarding-step')?.textContent.includes('2 من')",'Only a fresh valid applied location may advance to notifications');
  row.pickup=await evaluate(pointExpression);assert.equal(row.pickup.source,'gps');assert.equal(row.pickup.accuracy,10);
  assert.ok(await evaluate("document.querySelector('#onboarding-allow').textContent.includes('الإشعارات')"),'The next dialog must be notification permission onboarding');
 });
 await record('synthetic-onboarding-skip-and-cancel-ignore-late-fix','synthetic-callback-after-real-onboarding-dismissal',async row=>{
  row.dismissals=[];
  for(const dismissal of ['skip','cancel']){
   await navigate({synthetic:true});const selected=await manual('Manual pickup preserved after '+dismissal);
   await evaluate('window.showMishwarPermissions()');await click('#onboarding-allow');
   await until('window.__locationSynthetic.records.length>0','Onboarding must hold a location request before '+dismissal);
   if(dismissal==='skip'){
    await click('#onboarding-skip');
    await until("document.querySelector('#permission-onboarding[open] .onboarding-step')?.textContent.includes('2 من')",'Skipping GPS must show the next choice');
   }
   // Escape is a real browser dialog cancellation, including dismissal of the
   // notifications dialog after Skip. A late GPS result must reopen neither.
   await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await until("!document.querySelector('#permission-onboarding[open]')",'Permission onboarding must close after '+dismissal);
   await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(120);
   assert.equal(await evaluate("!!document.querySelector('#permission-onboarding[open]')"),false,'Late location must not reopen a dismissed permission dialog');
   await unchanged(selected);assert.equal(await evaluate('window.mishwarSearchLocation??null'),null,'Dismissal must clear pending GPS search bias');
   assert.ok(await evaluate('window.__gpsClears>0'),'Dismissal must stop the pending watch');
   row.dismissals.push({action:dismissal,manualPickupPreserved:true,lateDialogOpened:false});
  }
 });
 await record('synthetic-late-callback-after-manual-change','synthetic-callback-after-clearWatch',async row=>{
  await navigate({synthetic:true});await click('#locate');await until('window.__locationSynthetic.records.length>0','Capture pending watch');
  const selected=await manual('Manual choice after GPS request');
  await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(100);await unchanged(selected);row.pickup=await evaluate(pointExpression);
 });
 await record('synthetic-storage-blocked-manual-choice','synthetic-storage-denial-and-callback-after-clearWatch',async row=>{
  await navigate({synthetic:true});await click('#locate');await until('window.__locationSynthetic.records.length>0','Capture pending watch before storage denial');
  await evaluate("window.__storageOriginals={getItem:Storage.prototype.getItem,setItem:Storage.prototype.setItem,removeItem:Storage.prototype.removeItem};for(const method of Object.keys(window.__storageOriginals))Storage.prototype[method]=()=>{throw new DOMException('Synthetic storage denial','SecurityError')}");
  try{
   const selected=await manual('Manual choice while device storage is blocked');
   await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(100);await unchanged(selected);
   assert.equal(selected.source,'manual');assert.ok(await evaluate('window.__gpsClears>0'),'In-memory protection must clear the watch even when persistence fails');row.pickup=await evaluate(pointExpression);
  }finally{await evaluate('for(const[method,value]of Object.entries(window.__storageOriginals))Storage.prototype[method]=value;delete window.__storageOriginals');}
 });
 await record('synthetic-storage-blocked-search-clear','synthetic-storage-denial-and-clear-search-click',async row=>{
  await navigate({synthetic:true});await manual('Pickup to clear during pending GPS');await click('#locate');
  await until('window.__locationSynthetic.records.length>0','Capture pending watch before clearing pickup');
  await evaluate("window.__storageOriginals={getItem:Storage.prototype.getItem,setItem:Storage.prototype.setItem,removeItem:Storage.prototype.removeItem};for(const method of Object.keys(window.__storageOriginals))Storage.prototype[method]=()=>{throw new DOMException('Synthetic storage denial','SecurityError')}");
  try{
   // Open the real search UI, then use a genuine pointer click on its clear control.
   await evaluate("openSearchSheet('pickup')");await click('[data-search-clear="pickup"]');
   assert.equal(await evaluate(pointExpression),null,'The clear control must remove the selected pickup');
   await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(100);
   assert.equal(await evaluate(pointExpression),null,'A late GPS callback must not repopulate a cleared pickup');
   assert.equal(await evaluate('window.mishwarSearchLocation??null'),null,'Clearing pickup must also clear GPS search bias');row.pickup=null;
  }finally{await evaluate('for(const[method,value]of Object.entries(window.__storageOriginals))Storage.prototype[method]=value;delete window.__storageOriginals');}
 });
 await record('synthetic-manual-edit-wins-slow-reverse','synthetic-callback-delayed-loopback-reverse',async row=>{
  await navigate({synthetic:true});holdReverse=true;const reverseBefore=observations.reverseStarted;
  await click('#locate');await until('window.__locationSynthetic.records.length>0','Capture explicit watch');
  await evaluate('window.__locationSynthetic.emit({})');
  const end=Date.now()+5000;while(observations.reverseStarted===reverseBefore&&Date.now()<end)await wait(30);
  assert.ok(observations.reverseStarted>reverseBefore,'Fresh GPS must start a pending loopback reverse request');
  const selected=await manual('Manual choice during pending GPS address');releaseReverse();await wait(150);await unchanged(selected);row.pickup=await evaluate(pointExpression);
 });
 await record('synthetic-account-reset-invalidates-pending-reverse','synthetic-callback-delayed-loopback-reverse',async row=>{
  await navigate({synthetic:true});holdReverse=true;const reverseBefore=observations.reverseStarted;
  await click('#locate');await until('window.__locationSynthetic.records.length>0','Capture watch before reset');
  await evaluate('window.__locationSynthetic.emit({})');
  const end=Date.now()+5000;while(observations.reverseStarted===reverseBefore&&Date.now()<end)await wait(30);
  assert.ok(observations.reverseStarted>reverseBefore,'Address resolution must be pending before reset');
  await evaluate("window.dispatchEvent(new CustomEvent('mishwar-account-reset',{detail:{accountKey:null}}))");
  row.immediatelyAfterReset=await evaluate(pointExpression);
  releaseReverse();await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(150);
  assert.deepEqual(await evaluate(pointExpression),row.immediatelyAfterReset,'An old location operation must not repopulate pickup after owner reset');
  assert.equal(await evaluate('window.mishwarSearchLocation??null'),null,'Old GPS search bias must be removed');
  assert.ok(await evaluate('window.__gpsClears>0'),'Reset must clear the native watch');
 });
 for(const action of ['stop','hidden'])await record('synthetic-'+action+'-invalidates-pending-reverse','synthetic-callback-and-'+(action==='hidden'?'document-visibility-event':'explicit-stop'),async row=>{
  await navigate({synthetic:true});holdReverse=true;const reverseBefore=observations.reverseStarted;
  await click('#locate');await until('window.__locationSynthetic.records.length>0','Capture watch before '+action);
  await evaluate('window.__locationSynthetic.emit({})');
  const end=Date.now()+5000;while(observations.reverseStarted===reverseBefore&&Date.now()<end)await wait(30);
  assert.ok(observations.reverseStarted>reverseBefore,'Address resolution must be pending before '+action);
  if(action==='stop')await evaluate('window.stopMishwarLocation()');
  else await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
  row.afterStop=await evaluate(pointExpression);releaseReverse();
  await evaluate('window.__locationSynthetic.emit({includeCleared:true})');await wait(120);
  assert.deepEqual(await evaluate(pointExpression),row.afterStop,'An old callback must not apply after '+action);
  assert.equal(await evaluate('window.mishwarSearchLocation??null'),null,'Stopped location must clear search bias');
  assert.ok(await evaluate('window.__gpsClears>0'),'Stopped location must clear watch');
  if(action==='hidden')await evaluate('delete document.hidden');
 });
 await record('runtime-assets-and-no-unapproved-api-writes','fixture-isolation',async()=>{
  assert.deepEqual(observations.exceptions,[],'No uncaught browser exception');
  assert.deepEqual([...new Set(observations.missing)].filter(p=>p!=='/favicon.ico'),[],'All built entrypoint assets must exist');
  assert.ok(observations.api.every(r=>r.path!=='/api/live'||readActions.has(r.action)),'Location changes must not create quotes, bookings or financial mutations');
  assert.deepEqual(observations.blockedExternal,[],'Only explicitly stubbed map images and font CSS may be requested externally');
 });
 const passed=observations.tests.filter(r=>r.passed).length,failed=observations.tests.length-passed;
 observations.summary={status:failed?'FAIL':'PASS',passed,failed,total:observations.tests.length,root,artifacts,externalNetwork:'blocked; known map tiles and font CSS fulfilled in-process',physicalGpsVerified:false,productionVerified:false};
 console.log(JSON.stringify(observations.summary,null,2));process.exitCode=failed?1:0;
}finally{
 clearTimeout(timeout);releaseReverse();writeFileSync(join(artifacts,'observations.json'),JSON.stringify(observations,null,2)+'\n');
 ws?.close();browser.kill();server.closeAllConnections();await new Promise(done=>server.close(done));
}
