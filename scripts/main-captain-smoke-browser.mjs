import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,extname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// MAIN-only browser smoke. Source UI files are real; every API response and GPS
// measurement is an explicit synthetic fixture. This is not backend, field GPS,
// provider, payment or production acceptance.
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=resolve(option('--public','apps/hub/public')),output=resolve(option('--output','.local-verification/main-captain-browser'));
mkdirSync(join(output,'screens'),{recursive:true});
const at=new Date().toISOString(),point=(name,lat,lng)=>({name,lat,lng});
const trip={id:'main-captain-synthetic-trip',rider_id:'synthetic-rider',driver_id:'synthetic-captain',status:'matching',rider_name:'راكب اختبار صناعي',pickup:point('نقطة انطلاق صناعية',24.7136,46.6753),destination:point('وجهة صناعية',24.72,46.68),fare_halalas:2500,discount_halalas:0,cash_due_halalas:2500,commission_bps:1000,method:'cash',payment_status:'cash_due',category:'economy',pinRequired:false,created_at:at,updated_at:at,offerExpiresAt:new Date(Date.now()+180000).toISOString(),route:{distanceMeters:2400,durationSeconds:480,provider:'fixture',geometry:{type:'LineString',coordinates:[[46.6753,24.7136],[46.68,24.72]]}},ratings:{byRider:null,byCaptain:null}};
const state={authenticated:true,available:true,current:null,requests:[trip],history:[],walletBalance:10000,api:[],locations:[],transitions:[],watchFailures:0,unauthorized:false};
const result={scope:'MAIN-only captain UI smoke',results:[],exceptions:[],consoleErrors:[],unexpectedExternal:[],neutralExternal:[],missingAssets:[],limitations:['API endpoints are declared local stubs; backend authorization/SQL/settlement is covered by separate backend tests, not this runner.','GPS values are synthetic callback fixtures, not real hardware measurements.','Headless desktop Edge with emulated 320/390/mobile viewports; no physical device, field GPS, route provider or commercial acceptance.','Fonts and map tiles are local neutral responses; every external request is intercepted before network.']};
const captain={id:'synthetic-captain',name:'كابتن اختبار صناعي',phone:'+966500000071',email:'captain-smoke@example.test',personal:{birthDate:'1990-01-01',identityNumber:'0000000000'}};
const payments={cash:true,wallet:true,card:false,applepay:false};
const session=()=>({captain,available:state.available,current:state.current,requests:state.requests,wallet:{balance:state.walletBalance,entries:[]},destinations:[],withdrawals:[],payments,suspended:false});
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  if(path.startsWith('/api/')){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Synthetic request too large')}
   let body={};try{body=raw?JSON.parse(raw):{}}catch{}
   state.api.push({path,action:body.action||null,at:Date.now()});
   if(path==='/api/auth/session')return json(res,{authenticated:state.authenticated,phoneVerified:state.authenticated,application:state.authenticated?{status:'active'}:null,profile:state.authenticated?captain:null});
   if(path==='/api/auth/logout'){state.authenticated=false;return json(res,{ok:true})}
   if(path==='/api/map-config')return json(res,{browserKey:null});
   if(path==='/api/background')return json(res,body.action==='ack'?{ok:true}:{configured:false,notifications:[]});
   if(path==='/api/service-status')return json(res,{features:[]});
   if(path==='/api/application')return json(res,{application:state.authenticated?{status:'active'}:null});
   if(path!=='/api/driver')return json(res,{error:'Unknown synthetic endpoint'},404);
   if(['session','watch'].includes(body.action)&&state.unauthorized){state.authenticated=false;return json(res,{error:'Synthetic session expired'},401)}
   if(body.action==='watch'&&state.watchFailures){state.watchFailures--;return json(res,{error:'Synthetic connection failure'},503)}
   if(body.action==='session')return json(res,session());
   if(body.action==='watch')return json(res,{current:state.current,requests:state.requests,available:state.available,walletBalance:state.walletBalance,suspended:false});
   if(body.action==='realtime_token')return json(res,{configured:false});
   if(body.action==='location'){state.locations.push({...body,receivedAt:Date.now()});return json(res,{ok:true})}
   if(body.action==='available'){state.available=body.available===true;return json(res,{ok:true,available:state.available})}
   if(body.action==='history')return json(res,{trips:state.history,nextOffset:null});
   if(body.action==='accept'){
    if(body.tripId!==trip.id||!state.requests.length)return json(res,{error:'Synthetic offer unavailable'},400);
    state.current={...trip,status:'arriving'};state.requests=[];state.transitions.push('arriving');return json(res,{ok:true,trip:state.current});
   }
   if(body.action==='trip_stop'){
    const progress=state.current?.stopProgress,stop=progress?.stops[body.stopIndex];
    if(!state.current||state.current.status!=='riding'||body.tripId!==state.current.id||!stop||progress.nextIndex!==body.stopIndex||!['arrived','departed'].includes(body.phase))return json(res,{error:'Invalid synthetic stop'},409);
    if(body.phase==='arrived'&&stop.status!=='pending'||body.phase==='departed'&&stop.status!=='arrived')return json(res,{error:'Invalid synthetic stop sequence'},409);
    stop.status=body.phase;stop[body.phase==='arrived'?'arrivedAt':'departedAt']=new Date().toISOString();
    const next=progress.stops.findIndex(item=>item.status!=='departed');progress.nextIndex=next<0?null:next;progress.allDeparted=next<0;
    return json(res,{ok:true,stopProgress:progress});
   }
   if(body.action==='trip_status'){
    const allowed={arriving:'arrived',arrived:'riding',riding:'completed'};
    if(!state.current||body.tripId!==state.current.id||allowed[state.current.status]!==body.status)return json(res,{error:'Invalid synthetic transition'},400);
    if(body.status==='completed'&&state.current.stopProgress&&!state.current.stopProgress.allDeparted)return json(res,{error:'Synthetic stops remain'},409);
    if(body.status==='completed'&&!body.cashReceived)return json(res,{error:'Confirm synthetic cash collection'},400);
    state.current={...state.current,status:body.status,updated_at:new Date().toISOString()};state.transitions.push(body.status);
    if(body.status==='completed'){state.history.push({...state.current,captainMovement:-250});state.current=null}
    return json(res,{ok:true});
   }
   return json(res,{error:'Unsupported synthetic action'},400);
  }
  const pathName=['/dashboard','/dashboard.html'].includes(path)?'/dashboard.html':path==='/launch'||path==='/'?'/index.html':path;
  const file=resolve(root,'.'+decodeURIComponent(pathName)),inside=relative(root,file);
  if(inside.startsWith('..')||isAbsolute(inside))return json(res,{error:'Outside local static root'},403);
  try{const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes)}catch{result.missingAssets.push(path);res.writeHead(404);res.end()}
 }catch{res.writeHead(500);res.end('Local captain fixture failed')}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);assert.ok(edge,'Local Edge/Chromium required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-main-captain-'));
const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(done=>setTimeout(done,ms));let ws,command,evaluate;
const deadline=setTimeout(()=>{browser.kill();console.error('MAIN_CAPTAIN_BROWSER_TIMEOUT');process.exit(2)},120000);deadline.unref();
try{
 let port;for(let n=0;n<100;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}assert.match(port||'',/^\d+$/);
 const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail;setTimeout(()=>fail(Error('CDP connect deadline')),8000).unref()});
 let seq=0;const pending=new Map();command=(method,params={})=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP deadline '+method))},10000);pending.set(id,{done:x=>{clearTimeout(timer);done(x)},fail:e=>{clearTimeout(timer);fail(e)}});ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.fail(Error(JSON.stringify(m.error))):p?.done(m.result)}else if(m.method==='Runtime.exceptionThrown')result.exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')result.consoleErrors.push(m.params.args.map(a=>a.value||a.description||'').join(' '));else if(m.method==='Fetch.requestPaused'){
   const r=m.params,url=new URL(r.request.url);
   if(url.origin===origin)return void command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{});
   const tile=/^(?:[abc]\.)?tile\.openstreetmap\.org$/.test(url.hostname),font=['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
   if(tile||font){result.neutralExternal.push({host:url.hostname,type:tile?'neutral map tile':'system font CSS'});void command('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:tile?'image/png':'text/css'}],body:tile?'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n2sAAAAASUVORK5CYII=':Buffer.from('/* Offline system fonts only. */').toString('base64')}).catch(()=>{})}
   else{result.unexpectedExternal.push({host:url.hostname,path:url.pathname});void command('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{"error":"External network disabled in main captain smoke"}').toString('base64')}).catch(()=>{})}
  }};
 evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const until=async(expression,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await evaluate(expression))return;await wait(80)}throw Error(label)};
 const click=async selector=>{
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);await wait(100);
  const p=await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&!node.disabled});if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert.ok(p,'Visible and clickable '+selector);
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await command('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
 };
 const scenario=async(name,work)=>{await work();result.results.push({name,passed:true});console.log('PASS '+name)};
 await Promise.all([command('Page.enable'),command('Runtime.enable'),command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]}),command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})]);
 const gpsFixture=`(()=>{
  let id=0;const watches=new Map();
  window.__mainCaptainGPS={emit(value){for(const w of watches.values())w.success(value)},fail(code){for(const w of watches.values())w.error({code})},count:()=>watches.size};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
   watchPosition(success,error){const key=++id;watches.set(key,{success,error});return key},
   clearWatch(key){watches.delete(key)},
   getCurrentPosition(success){success({coords:{latitude:24.7136,longitude:46.6753,accuracy:5},timestamp:Date.now()})}
  }});
 })();`;
 new Function(gpsFixture); // Parse the fixture independently before browser use.
 await command('Page.addScriptToEvaluateOnNewDocument',{source:gpsFixture});
 await command('Page.navigate',{url:origin+'/dashboard'});
 await until(`document.readyState==='complete'&&document.querySelector('[data-accept]')&&window.__mainCaptainGPS?.count()>0`,'Captain dashboard boots and offers render');
 await scenario('dashboard-session-watch-and-rtl-390',async()=>{assert.equal(await evaluate(`document.documentElement.dir`),'rtl');assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);assert.ok(state.api.some(a=>a.action==='session'));await until(`!!document.querySelector('[data-accept]')`,'Offer remains usable');writeFileSync(join(output,'screens','dashboard-390.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));});
 await scenario('invalid-stale-and-future-gps-never-publish',async()=>{for(const sample of [{latitude:95,longitude:46.6,accuracy:5,timestamp:Date.now()},{latitude:24.7,longitude:46.6,accuracy:-1,timestamp:Date.now()},{latitude:24.7,longitude:46.6,accuracy:5,timestamp:Date.now()-60000},{latitude:24.7,longitude:46.6,accuracy:5,timestamp:Date.now()+20000}])await evaluate(`window.__mainCaptainGPS.emit({coords:${JSON.stringify(sample)},timestamp:${sample.timestamp}})`);await wait(100);assert.equal(await evaluate(`window.captainGPS`),null);assert.equal(state.locations.length,0)});
 let firstAt;
 await scenario('fresh-gps-preserves-measurement-time-and-publishes-once',async()=>{firstAt=Date.now()-50;await evaluate(`window.__mainCaptainGPS.emit({coords:{latitude:24.7136,longitude:46.6753,accuracy:5},timestamp:${firstAt}})`);await until(`window.captainGPS?.at===${firstAt}`,'Original geolocation timestamp retained');for(let n=0;n<50&&!state.locations.length;n++)await wait(40);assert.equal(state.locations.length,1);assert.equal(state.locations[0].lat,24.7136);assert.equal(state.locations[0].accuracy,5)});
 await scenario('older-and-duplicate-gps-cannot-replace-newer-location',async()=>{for(const timestamp of [firstAt-1000,firstAt])await evaluate(`window.__mainCaptainGPS.emit({coords:{latitude:24.714,longitude:46.676,accuracy:5},timestamp:${timestamp}})`);assert.equal(await evaluate(`window.captainGPS.lat`),24.7136);assert.equal(await evaluate(`window.captainGPS.at`),firstAt);assert.equal(state.locations.length,1)});
 await scenario('captain-trip-buttons-complete-the-declared-fixture-lifecycle',async()=>{await click('[data-accept]');await until(`!!document.querySelector('[data-status="arrived"]')`,'Accepted trip opens');assert.equal(state.current.status,'arriving');await click('[data-status="arrived"]');await until(`!!document.querySelector('[data-status="riding"]')`,'Arrival action applied');await click('[data-status="riding"]');await until(`!!document.querySelector('#cash-received')`,'Start action applied');await click('#cash-received');await click('[data-status="completed"]');await until(`document.querySelector('#driver-panel')?.textContent.includes('لا توجد رحلة نشطة')`,'Completion action applied');assert.deepEqual(state.transitions,['arriving','arrived','riding','completed']);assert.equal(state.history.length,1);assert.equal(state.api.filter(a=>a.action==='accept').length,1)});
 await scenario('completion-button-waits-for-every-booked-stop-departure',async()=>{
  // Server-owned API fixtures exercise the real UI; they do not prove backend
  // stop authorization or settlement, which have separate SQLite E2E tests.
  const stops=[point('محطة اختبار أولى',24.715,46.676),point('محطة اختبار ثانية',24.718,46.678)];
  state.current={...trip,id:'main-captain-synthetic-stop-trip',status:'riding',options:{stops},stopProgress:{stops:stops.map((point,index)=>({index,point,status:'pending',arrivedAt:null,departedAt:null,waitSeconds:0})),nextIndex:0,allDeparted:false}};
  await evaluate('refresh(true)');
  await until(`document.querySelector('[data-stop-action="arrived"][data-stop-index="0"]')&&document.querySelector('[data-status="completed"]')?.disabled`,'Pending stops disable completion');
  assert.equal(await evaluate(`document.querySelector('#driver-panel').textContent.includes('أكمل الوصول والمغادرة لكل محطات المشوار قبل إنهاء الرحلة.')`),true,'The UI explains the required stop progress');
  const completedRequests=state.api.filter(row=>row.action==='trip_status').length;
  const disabled=await evaluate(`(()=>{const button=document.querySelector('[data-status="completed"]');button.scrollIntoView({block:'center',behavior:'instant'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:disabled.x,y:disabled.y,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:disabled.x,y:disabled.y,button:'left',clickCount:1});await wait(100);
  assert.equal(state.api.filter(row=>row.action==='trip_status').length,completedRequests,'Clicking a disabled completion button cannot send a mutation');
  for(const [index,phase]of [[0,'arrived'],[0,'departed'],[1,'arrived'],[1,'departed']]){
   await click('[data-stop-index="'+index+'"][data-stop-action="'+phase+'"]');
   const last=index===1&&phase==='departed';
   await until(last?`document.querySelector('[data-status="completed"]')?.disabled===false`:`!!document.querySelector('[data-stop-index="${phase==='departed'?index+1:index}"][data-stop-action="${phase==='arrived'?'departed':'arrived'}"]')`,'Stop progress renders after '+index+' '+phase);
   assert.equal(await evaluate(`document.querySelector('[data-status="completed"]').disabled`),!last,'Completion is enabled only after the final departure');
  }
  assert.equal(state.api.filter(row=>row.action==='trip_stop').length,4);
  writeFileSync(join(output,'screens','stops-complete-390.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  await click('#cash-received');await click('[data-status="completed"]');
  await until(`document.querySelector('#driver-panel')?.textContent.includes('لا توجد رحلة نشطة')`,'The enabled completion button ends the declared stop fixture');
  assert.equal(state.history.length,2);
 });
 await scenario('history-wallet-profile-and-mobile-320',async()=>{
  await click('[data-tab="history"]');await until(`!!document.querySelector('.history-trip')`,'Synthetic completed history displayed');
  await click('[data-tab="requests"]');await until(`document.body.dataset.driverTab==='requests'`,'Return from full-page history');
  await click('[data-tab="wallet"]');await until(`!!document.querySelector('[data-driver-topup]')`,'Wallet panel displayed');
  await click('[data-tab="requests"]');await until(`document.body.dataset.driverTab==='requests'`,'Return from full-page wallet');
  await click('[data-tab="profile"]');await until(`!!document.querySelector('.captain-account-accordion')`,'Account panel displayed');
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);writeFileSync(join(output,'screens','profile-320.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
 });
 await scenario('transient-watch-failure-recovers-without-clearing-current-ui',async()=>{state.watchFailures=1;const before=state.api.filter(a=>a.action==='watch').length;await evaluate('refresh()');await until(`document.querySelector('#driver-toast')?.textContent.includes('Synthetic connection failure')`,'Failure is shown');assert.equal(await evaluate(`!!document.querySelector('.captain-account-accordion')`),true);await evaluate('refresh()');assert.ok(state.api.filter(a=>a.action==='watch').length>=before+2);assert.equal(await evaluate(`!!document.querySelector('.captain-account-accordion')`),true)});
 await scenario('401-stops-dashboard-polling-and-opens-login',async()=>{state.unauthorized=true;await evaluate('refresh(true)');await until(`location.pathname==='/launch'&&document.readyState==='complete'`,'Expired session returns to login');const previous=state.api.filter(a=>a.path==='/api/driver').length;await wait(1400);assert.equal(state.api.filter(a=>a.path==='/api/driver').length,previous);assert.equal(await evaluate(`!!document.querySelector('.driver-shell')`),false)});
 assert.equal(result.exceptions.length,0,'No unhandled browser exceptions');assert.equal(result.consoleErrors.length,0,'No console.error');assert.equal(result.unexpectedExternal.length,0,'No unexpected external request');assert.equal(result.missingAssets.length,0,'All local source assets load');
 result.status='PASS';result.passed=result.results.length;result.failed=0;
}catch(error){result.status='FAIL';result.failed=1;result.fatalError=error.message;process.exitCode=1;console.error('MAIN_CAPTAIN_SMOKE_FAILED '+error.message);if(evaluate)try{result.failureDOM=await evaluate(`({text:document.body.innerText.slice(0,7000),tab:document.body.dataset.driverTab,buttons:[...document.querySelectorAll('[data-tab]')].map(n=>({tab:n.dataset.tab,rect:n.getBoundingClientRect().toJSON()}))})`);writeFileSync(join(output,'screens','failure.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'))}catch{}}
finally{
 clearTimeout(deadline);result.finishedAt=new Date().toISOString();result.requests=state.api;result.syntheticLocationPublishes=state.locations;result.syntheticTransitions=state.transitions;
 writeFileSync(join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,passed:result.passed||result.results.length,failed:result.failed||0,output,limitations:result.limitations}));ws?.close();browser.kill();server.closeAllConnections();await new Promise(done=>server.close(done));
}
