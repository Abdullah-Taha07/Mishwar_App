import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// UI acceptance only: real portal code and real user clicks, explicit synthetic
// read-only API responses. Shared Worker/SQLite integration is tested separately.
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=resolve(option('--public','apps/admin/public')),output=resolve(option('--output','.local-verification/stage3-admin-browser-'+Date.now()));
mkdirSync(output,{recursive:true});
const audit={disclosure:'Actual admin portal with synthetic authentication, trip, GPS and route responses on loopback. This does not prove Worker auth, GPS sensors, external routes, production or physical devices.',results:[],exceptions:[],missing:[],blocked:[],requests:[],protocol:[],detailReads:0};
const fixture={status:'riding',departed:false,fail:false,hold:false,releases:[]};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
function trip(){
 const at=new Date().toISOString(),active=fixture.status==='riding';
 return {id:'stage3-local-trip',status:fixture.status,is_demo:0,rider_name:'Local fixture rider',driver_name:'Local fixture captain',pickup:{name:'Synthetic pickup'},destination:{name:'Synthetic destination'},fare_halalas:2400,commission_bps:1000,payment_status:active?'cash_due':'cash_collected',created_at:at,updated_at:at,events:[{action:'trip_stop_arrived',created_at:at,source:'captain'}],stopProgress:{stops:[{index:0,point:{name:'First <img src=x onerror="window.adminUiProbe=true">'},status:'departed',arrivedAt:at,departedAt:at,waitSeconds:45},{index:1,point:{name:'Second fixture stop'},status:fixture.departed?'departed':'pending',arrivedAt:fixture.departed?at:null,departedAt:fixture.departed?at:null,waitSeconds:fixture.departed?30:0}]},driverLocation:active?{lat:24.7,lng:46.6,at,accuracy:5,fresh:true}:null,eta:active?(fixture.departed?{status:'available',tripId:'stage3-local-trip',target:'destination',provider:'TomTom',durationSeconds:182,distanceMeters:1400,trafficAware:true,locationAt:at,calculatedAt:at,expiresAt:new Date(Date.parse(at)+30000).toISOString()}:{status:'unavailable',reason:'stops_progress_unavailable',tripId:'stage3-local-trip',target:'destination'}):null};
}
const release=()=>{fixture.hold=false;for(const resolve of fixture.releases.splice(0))resolve()};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')){
  audit.requests.push({path:url.pathname,method:req.method});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'This UI fixture only permits reads'}));return}
  let value;
  if(url.pathname==='/api/admin-auth/session')value={authenticated:true};
  else if(url.pathname==='/api/admin/notifications')value={items:[],total:0};
  else if(url.pathname==='/api/admin/launch/realtime')value={configured:false};
  else if(url.pathname==='/api/admin/trip-extras')value={ratings:[],offers:[],context:null};
  else if(url.pathname==='/api/admin/operations/trips'){
   if(url.searchParams.has('id')){
    audit.detailReads++;if(fixture.hold)await new Promise(resolve=>fixture.releases.push(resolve));
    if(fixture.fail){res.statusCode=503;value={error:'Declared local disconnection'}}else value=trip();
   }else value={items:[trip()],total:1};
  }else{res.statusCode=503;value={error:'Unconfigured UI fixture route'}}
  res.end(JSON.stringify(value));return;
 }
 try{
  const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname)),path=relative(root,file);
  if(path.startsWith('..')||isAbsolute(path))throw Error('Outside fixture root');
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 }catch{audit.missing.push(url.pathname);res.statusCode=404;res.end()}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(browserPath,'Local Chromium required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-admin-trip-'));
const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,command,evaluate;
const timeout=setTimeout(()=>{browser.kill();console.error('Admin trip browser deadline');process.exit(2)},90000);timeout.unref();
const step=async(name,run)=>{const result={name,passed:false};audit.results.push(result);try{await run();result.passed=true;console.log('PASS '+name)}catch(error){result.error=error.message;throw error}};
try{
 let port;for(let n=0;n<80;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}
 assert.match(port||'',/^\d+$/);
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((done,fail)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP deadline '+method))},10000);pending.set(id,{done:value=>{clearTimeout(timer);done(value)},fail:error=>{clearTimeout(timer);fail(error)}});ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=event=>{
 const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.fail(Error(JSON.stringify(message.error))):p?.done(message.result);return}
  if(['Fetch.requestPaused','Page.frameNavigated'].includes(message.method))audit.protocol.push({method:message.method,url:message.params.request?.url||message.params.frame?.url});
  if(message.method==='Runtime.exceptionThrown')audit.exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
  if(message.method==='Fetch.requestPaused'){
   const p=message.params,url=new URL(p.request.url);
   if(url.origin===origin)void command('Fetch.continueRequest',{requestId:p.requestId}).catch(()=>{});
   else{audit.blocked.push(url.origin+url.pathname);void command('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
  }
 };
 evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const until=async(expression,label,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expression))return;await wait(60)}throw Error(label)};
 const click=async selector=>{
  await until(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing '+selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);await wait(60);
  const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,ok:r.width>0&&r.height>0&&!el.disabled&&(hit===el||el.contains(hit))}})()`);
  assert.ok(point.ok,'Control is clickable '+selector);for(const [type,extra]of [['mouseMoved',{}],['mousePressed',{button:'left',clickCount:1}],['mouseReleased',{button:'left',clickCount:1}]])await command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,...extra});
 };
 const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(r.data,'base64'))};
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');await command('Network.setBypassServiceWorker',{bypass:true});await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"try{delete Navigator.prototype.serviceWorker}catch{}"});
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await command('Page.navigate',{url:origin+'/#trips'});
 await until("!!document.querySelector('[data-trip]')",'Trip list must render from the declared local fixture');
 await step('desktop-actual-click-opens-safe-stops-and-route-facts',async()=>{
  await click('[data-trip]');await until("document.querySelector('[data-admin-trip-view]')?.innerText.includes('وقت الوصول للمحطات غير متاح')",'Detail must render unavailable stop ETA');
  assert.equal(await evaluate('window.adminUiProbe===true'),false);
  assert.ok(await evaluate("document.querySelector('[data-admin-trip-view]').innerText.includes('<img src=x')"));
  await evaluate("window.savedTripRoot=document.querySelector('[data-admin-trip-view]')");await shot('desktop-live');
 });
 await step('open-detail-polls-new-stop-evidence-without-replacing-view',async()=>{
  fixture.departed=true;const reads=audit.detailReads;
  await until("document.querySelector('[data-admin-trip-view]')?.innerText.includes('٣٠ ثانية')",'The real 8-second timer must show the new second-stop evidence',18000);
  assert.ok(audit.detailReads>reads);assert.ok(await evaluate("document.querySelector('[data-admin-trip-tracking]').innerText.includes('TomTom')"));assert.equal(await evaluate("window.savedTripRoot===document.querySelector('[data-admin-trip-view]')"),true);
 });
 await step('read-failure-removes-live-eta-and-allows-read-only-retry',async()=>{
  fixture.fail=true;await click('[data-admin-trip-refresh]');
  await until("document.querySelector('[data-admin-trip-tracking]')?.innerText.includes('أوقفنا عرض وقت الوصول')",'Failed reads must remove live ETA');
  assert.equal(await evaluate("document.querySelector('[data-admin-trip-tracking]').innerText.includes('قياس GPS حديث')"),false);
  fixture.fail=false;await click('[data-admin-trip-refresh]');await until("document.querySelector('[data-admin-trip-tracking]')?.innerText.includes('TomTom')",'Retry must restore declared route facts');
 });
 await step('completed-trip-removes-tracking-facts-from-open-detail',async()=>{
  fixture.status='completed';await click('[data-admin-trip-refresh]');await until("document.querySelector('[data-admin-trip-tracking]')?.innerText.includes('التتبع مغلق')",'Completion must clear GPS/ETA');await shot('desktop-completed');
  assert.equal(await evaluate("document.querySelector('[data-admin-trip-tracking]').innerText.includes('24.7')"),false);
 });
 await step('closing-inflight-detail-cancels-its-refresh-and-polling',async()=>{
  fixture.hold=true;await click('[data-admin-trip-refresh]');for(let n=0;n<50&&!fixture.releases.length;n++)await wait(50);assert.ok(fixture.releases.length);
  await click('#close-info');release();await wait(100);const reads=audit.detailReads;await wait(8400);
  assert.equal(await evaluate("document.querySelector('#info-dialog').open"),false);assert.equal(audit.detailReads,reads,'Closed details must stop polling');
 });
 await step('mobile-opens-completed-detail-and-owner-change-retires-it',async()=>{
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await click('[data-trip]');
  await until("document.querySelector('[data-admin-trip-tracking]')?.innerText.includes('التتبع مغلق')",'Mobile completed detail must be reachable');await shot('mobile-completed');
  // Explicit failure injection for the owner guard; this is not an admin login.
  await evaluate("window.mishwarStaffSession={staff:{id:'local-owner-change-fixture'}}");await until("!document.querySelector('#info-dialog').open",'Owner change must close the old private view');
  assert.ok(await evaluate("document.querySelector('[data-admin-trip-view]').innerText.includes('تغير حساب الإدارة')"));
 });
 await step('runtime-assets-and-read-only-network',async()=>{
  assert.deepEqual(audit.exceptions,[]);assert.deepEqual([...new Set(audit.missing)].filter(path=>path!=='/favicon.ico'),[]);assert.ok(audit.requests.every(request=>request.method==='GET'));
 });
 audit.summary={result:'PASS',passed:audit.results.length,failed:0,externalNetwork:'blocked',output};console.log(JSON.stringify(audit.summary));
}catch(error){audit.summary={result:'FAIL',passed:audit.results.filter(row=>row.passed).length,failed:audit.results.filter(row=>!row.passed).length,error:error.message};console.error(error.message);process.exitCode=1;
}finally{
 clearTimeout(timeout);release();writeFileSync(join(output,'observations.json'),JSON.stringify(audit,null,2));ws?.close();browser.kill();server.closeAllConnections();await new Promise(done=>server.close(done));
}
