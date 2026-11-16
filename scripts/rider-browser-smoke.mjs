import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const root=resolve(process.argv[2]||'apps/rider/public');
const pwaRequired=process.argv.includes('--pwa');
const artifact=resolve('artifacts/rider-repairs-2026-11-15/browser-'+Date.now());
mkdirSync(artifact,{recursive:true});
const fixtures={owner:null,chat:[],requests:[],missing:[],blocked:[],exceptions:[],results:[]};
const keys={a:'a'.repeat(64),b:'b'.repeat(64)};
const point=(name,lat=24.7,lng=46.6)=>({name,lat,lng,area:'Offline fixture'});
const profile=owner=>({name:owner==='a'?'Rider Alpha':'Rider Beta',phone:owner==='a'?'+966500000001':'+966500000002',email:owner+'@example.test'});
const trip=owner=>({id:owner+'-offline-trip',status:'riding',rider_id:'fixture:'+owner,driver_id:'offline-driver',pickup:point(owner+' private pickup'),destination:point(owner+' private destination',24.71,46.61),driver_name:'Offline Captain',driver_make:'Offline',driver_model:'Car',driver_plate:'TEST',driver_color:'white',fare_halalas:1000,discount_halalas:0,method:'cash',payment_status:'cash_due',created_at:new Date().toISOString(),options:{stops:[]},driverLocation:{lat:24.705,lng:46.605,at:new Date().toISOString(),fresh:true}});
const payments={cash:true,wallet:true,card:false,applepay:false};
function session(owner){return {guest:!owner,verified:!!owner,accountKey:owner?keys[owner]:null,profile:owner?profile(owner):null,trip:owner==='a'?trip(owner):null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:owner==='a'?98765:0,entries:[]},payments};}
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw)}catch{}
  fixtures.requests.push({path,action:body.action,owner:fixtures.owner,hasMessage:!!body.body});
  let data={};
  if(path==='/api/auth/password-login'){fixtures.owner=String(body.phone).includes('2')?'b':'a';data={authenticated:true,profile:profile(fixtures.owner)};}
  else if(path==='/api/auth/logout'){fixtures.owner=null;data={ok:true};}
  else if(path==='/api/auth/session')data={authenticated:!!fixtures.owner,phoneVerified:!!fixtures.owner,accountKey:fixtures.owner?keys[fixtures.owner]:null,profile:fixtures.owner?profile(fixtures.owner):null};
  else if(path==='/api/map-config')data={searchConfigured:false};
  else if(path==='/api/service-status')data={features:[]};
  else if(path==='/api/background')data={configured:false,notifications:[]};
  else if(path==='/api/shared-trip')data={status:'riding',pickup:point('<img src="/offline-xss-probe" onerror="window.offlineAuditXss=true">'),destination:point('Offline destination',24.71,46.61),driver:'Offline Captain',location:null};
  else if(body.action==='live_session'||body.action==='live_watch')data=session(fixtures.owner);
  else if(body.action==='live_capabilities')data={features:[]};
  else if(body.action==='live_realtime_token'){res.statusCode=503;data={error:'Offline provider is intentionally disabled'};}
  else if(body.action==='live_reservations')data={schedulerConfigured:false,items:[]};
  else if(body.action==='live_history')data={trips:[],ratings:{average:0,receivedCount:0},nextOffset:null};
  else if(body.action==='live_cases'||body.action==='live_contacts')data={items:[]};
  else if(body.action==='live_payment_status')data={items:[]};
  else if(body.action==='live_referral')data={enabled:false,notice:'Offline program is not enabled',code:'OFFLINE',reward:0,stats:{invited:0,rewards:0},linked:false};
  else if(body.action==='live_chat'){
   if(body.body)fixtures.chat.push({id:fixtures.chat.length+1,body:body.body,role:'rider',created_at:new Date().toISOString()});
   else await new Promise(r=>setTimeout(r,150));
   data={messages:fixtures.chat.filter(m=>m.id>(body.after||0))};
  }else{res.statusCode=503;data={error:'Feature is unavailable in the offline fixture'};}
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));return;
 }
 try{
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'\\'))throw Error('outside fixture root');
  const bytes=readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(bytes);
 }catch{fixtures.missing.push(path);res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if(!browserPath)throw Error('A local Chromium browser is required for the offline smoke test');
const browserProfile=mkdtempSync(join(tmpdir(),'mishwar-repair-browser-'));
const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws;const wait=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>{browser.kill();console.error('Offline browser smoke timed out');process.exit(2)},60000);timeout.unref();
try{
 let port;for(let i=0;i<80;i++){try{port=readFileSync(join(browserProfile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch(error){if(!['ENOENT','EBUSY','EACCES'].includes(error.code))throw error;}await wait(100);}assert.ok(/^\d+$/.test(port||''),'Chromium debugging endpoint must start');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)})).json();
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;setTimeout(()=>j(Error('Debug socket timeout')),5000).unref()});
 let sequence=0;const pending=new Map();
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},8000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')fixtures.exceptions.push(m.params.exceptionDetails);else if(m.method==='Fetch.requestPaused'){const r=m.params,u=new URL(r.request.url);if(u.hostname!=='127.0.0.1'){fixtures.blocked.push(r.request.url);command('Fetch.failRequest',{requestId:r.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}else command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{});}};
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const waitFor=async(expression,message)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(expression))return;await wait(100);}throw Error(message);};
 const navigate=async url=>{const mark='leaving-'+Date.now();await evaluate(`document.documentElement.dataset.offlineNavigation=${JSON.stringify(mark)}`);await command('Page.navigate',{url});await waitFor(`document.documentElement?.dataset.offlineNavigation!==${JSON.stringify(mark)}&&document.readyState==='complete'`,'New document must finish loading');};
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
 await command('Network.setBlockedURLs',{urls:['https://*']});await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"try{localStorage.setItem('mishwar-permissions-onboarded-v2','true')}catch{}"});
 for(const [name,width,height]of[['desktop',1440,1000],['mobile',390,844],['short-mobile',390,640]]){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await navigate(origin);await waitFor("window.MishwarAccountContext?.snapshot().status==='ready'&&document.querySelectorAll('.launch-home-tools button').length===4",name+' home and account must finish rendering');
  const home=await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.launch-home-tools button')].map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e}})})");
  assert.equal(home.scroll,home.width);assert.equal(home.buttons.length,4);assert.ok(home.buttons.every(b=>b.clickable));
  fixtures.results.push({name,home});
  await evaluate('showHelp()');await wait(50);assert.ok(await evaluate("document.querySelector('#modal').open"));await evaluate("document.querySelector('#modal').close();showSettings()");await wait(50);assert.ok(await evaluate("document.querySelector('#modal').open"));await evaluate("document.querySelector('#modal').close();window.MishwarLang.set('en')");await wait(50);assert.equal(await evaluate('document.documentElement.dir'),'ltr');await evaluate("window.MishwarLang.set('ar')");assert.equal(await evaluate('document.documentElement.dir'),'rtl');
  const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifact,name+'.png'),Buffer.from(shot.data,'base64'));
 }
 // Authentication is simulated only by this loopback server. No real account is created.
 fixtures.owner='a';await navigate(origin);await waitFor("document.querySelector('#panel')?.innerText.includes('a-offline-trip'.slice(0,8))",'Account A trip must finish restoring');
 assert.ok(await evaluate("document.querySelector('#panel').innerText.includes('a-offline-trip'.slice(0,8))"),'Account A trip is restored');
 await evaluate('showAccount()');await wait(50);await evaluate("document.querySelector('#rider-logout').click()");await wait(500);
 assert.equal(await evaluate('window.mishwarTripActive'),false);
 assert.equal(await evaluate("document.body.innerText.includes('a private pickup')"),false);
 await evaluate('window.showRiderLogin()');await wait(50);await evaluate("(()=>{const f=document.querySelector('#rider-password-form');f.phone.value='0500000002';f.password.value='offline-password';f.requestSubmit()})()");await wait(600);
 assert.equal(await evaluate('window.MishwarAccountContext.snapshot().accountKey'),keys.b);
 assert.equal(await evaluate('window.mishwarTripActive'),false);
 assert.equal(await evaluate("document.body.innerText.includes('a private pickup')"),false);
 fixtures.results.push({name:'account-switch',passed:true});
 await navigate(origin+'/track.html#'+'a'.repeat(64));await waitFor("!!document.querySelector('.leaflet-marker-icon')",'Shared trip markers must render');
 await evaluate("document.querySelectorAll('.leaflet-marker-icon').forEach(e=>e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})))");await wait(150);
 assert.equal(await evaluate('window.offlineAuditXss===true'),false);
 assert.ok(await evaluate("document.querySelector('.leaflet-tooltip')?.textContent.includes('<img')"),'Untrusted tooltip content is visible as text');
 fixtures.results.push({name:'shared-tooltip-text-only',passed:true});
 if(pwaRequired){await navigate(origin);await waitFor("navigator.serviceWorker.getRegistration().then(r=>!!r?.active)",'Published service worker must become active');fixtures.results.push({name:'service-worker-active',passed:true});}
 // R15 remains a known asset gap in the basic smoke; --pwa requires every image.
 const allowed=pwaRequired?new Set(['/favicon.ico']):new Set(['/favicon.ico','/vendor/images/marker-icon.png','/vendor/images/marker-icon-2x.png','/vendor/images/marker-shadow.png']);
 const missing=[...new Set(fixtures.missing)].filter(x=>!allowed.has(x));
 assert.deepEqual(missing,[],'No unintended missing local assets');assert.deepEqual(fixtures.exceptions,[],'No uncaught JavaScript exceptions');
 console.log(JSON.stringify({passed:true,artifact,results:fixtures.results,missing:[...new Set(fixtures.missing)]},null,2));
}catch(error){fixtures.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally{clearTimeout(timeout);writeFileSync(join(artifact,'observations.json'),JSON.stringify(fixtures,null,2));ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
