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
const fixtures={owner:null,chat:[],requests:[],missing:[],blocked:[],exceptions:[],results:[],notifications:[],notificationAcks:[],sharedFailures:0,pauseLive:false,liveReleases:[],liveResponses:0,cases:[],supportLoseResponse:true,accountChange:null,accountPhones:{}};
const keys={a:'a'.repeat(64),b:'b'.repeat(64)};
const point=(name,lat=24.7,lng=46.6)=>({name,lat,lng,area:'Offline fixture'});
const profile=owner=>({name:owner==='a'?'أحمد الاختبار':'Rider Beta',phone:fixtures.accountPhones[owner]||(owner==='a'?'+966500000001':'+966500000002'),email:owner+'@example.test'});
const trip=owner=>({id:owner+'-offline-trip',status:'riding',rider_id:'fixture:'+owner,driver_id:'offline-driver',pickup:point(owner+' private pickup'),destination:point(owner+' private destination',24.71,46.61),driver_name:'Offline Captain',driver_make:'Offline',driver_model:'Car',driver_plate:'TEST',driver_color:'white',fare_halalas:1000,discount_halalas:0,method:'cash',payment_status:'cash_due',created_at:new Date().toISOString(),options:{stops:[]},driverLocation:{lat:24.705,lng:46.605,at:new Date().toISOString(),fresh:true}});
const payments={cash:true,wallet:true,card:false,applepay:false};
function session(owner){return {guest:!owner,verified:!!owner,accountKey:owner?keys[owner]:null,profile:owner?profile(owner):null,trip:owner==='a'?trip(owner):null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:owner==='a'?98765:0,entries:[]},payments};}
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw)}catch{}
  fixtures.requests.push({path,action:body.action,owner:fixtures.owner,hasMessage:!!body.body,clientRequestId:body.clientRequestId});
  let data={};
  if(path==='/api/auth/password-login'){fixtures.owner=String(body.phone).includes('2')?'b':'a';data={authenticated:true,profile:profile(fixtures.owner)};}
  else if(path==='/api/auth/logout'){fixtures.owner=null;data={ok:true};}
  else if(path==='/api/auth/session')data={authenticated:!!fixtures.owner,phoneVerified:!!fixtures.owner,accountKey:fixtures.owner?keys[fixtures.owner]:null,profile:fixtures.owner?profile(fixtures.owner):null};
  else if(path==='/api/auth/change-start'){fixtures.accountChange={id:'local-change-fixture',kind:body.kind,stage:'old',mode:'sms',phone:profile(fixtures.owner).phone,newPhone:body.value,expiresAt:new Date(Date.now()+900000).toISOString()};data=fixtures.accountChange;}
  else if(path==='/api/auth/change-check'){const change=fixtures.accountChange;change.stage=change.kind==='phone'&&change.stage==='old'?'new':'approved';if(change.stage==='new')change.phone='+966'+change.newPhone.slice(1);data=change;}
  else if(path==='/api/auth/change-finish'){if(fixtures.accountChange.kind==='phone')fixtures.accountPhones[fixtures.owner]=fixtures.accountChange.phone;data={ok:true};}
  else if(path==='/api/auth/change-cancel'){fixtures.accountChange=null;data={ok:true};}
  else if(path==='/api/auth/change-status')data=fixtures.accountChange;
  else if(path==='/api/map-config')data={searchConfigured:false};
  else if(path==='/api/service-status')data={features:[]};
  else if(path==='/api/background'){
   if(body.action==='ack'){fixtures.notificationAcks.push({owner:fixtures.owner,ids:body.ids});data={ok:true};}
   else data={configured:false,notifications:fixtures.notifications};
  }
  else if(path==='/api/shared-trip'){
   if(fixtures.sharedFailures>0){fixtures.sharedFailures--;res.statusCode=503;data={error:'Transient offline fixture'};}
   else data={status:'riding',pickup:point('<img src="/offline-xss-probe" onerror="window.offlineAuditXss=true">'),destination:point('Offline destination',24.71,46.61),driver:'Offline Captain',location:null};
  }
  else if(body.action==='live_session'||body.action==='live_watch'){
   if(fixtures.pauseLive)await new Promise(resolve=>fixtures.liveReleases.push(resolve));
   data=session(fixtures.owner);fixtures.liveResponses++;
  }
  else if(body.action==='live_capabilities')data={features:[]};
  else if(body.action==='live_realtime_token'){res.statusCode=503;data={error:'Offline provider is intentionally disabled'};}
  else if(body.action==='live_reservations')data={schedulerConfigured:false,items:[]};
  else if(body.action==='live_history')data={trips:[],ratings:{average:0,receivedCount:0},nextOffset:null};
  else if(body.action==='live_cases')data={items:fixtures.cases.filter(row=>row.owner===fixtures.owner)};
  else if(body.action==='live_case_create'){
   let item=fixtures.cases.find(row=>row.owner===fixtures.owner&&row.clientRequestId===body.clientRequestId);
   if(!item){item={id:'offline-case-'+fixtures.cases.length,owner:fixtures.owner,clientRequestId:body.clientRequestId,kind:body.kind,description:body.description,status:'open',messages:[{role:'rider',body:body.description},{role:'admin',body:'Local support response'}]};fixtures.cases.push(item);}
   data={id:item.id,ok:true};if(fixtures.supportLoseResponse){fixtures.supportLoseResponse=false;res.statusCode=503;data={error:'لم يصل تأكيد الإرسال. أعد المحاولة بنفس النص.'};}
  }
  else if(body.action==='live_case_messages'){
   const item=fixtures.cases.find(row=>row.owner===fixtures.owner&&row.id===body.caseId);
   if(!item){res.statusCode=404;data={error:'الطلب غير موجود'};}
   else{if(body.body&&!item.messages.some(row=>row.clientRequestId===body.clientRequestId))item.messages.push({role:'rider',body:body.body,clientRequestId:body.clientRequestId});data={case:item,messages:item.messages};}
  }
  else if(body.action==='live_contacts')data={items:[]};
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
 const englishAudit=async(name,selector)=>{
  await evaluate("window.MishwarLang.set('en')");await wait(40);
  const missing=await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)})||document.body,missing=[];const skip=el=>!el||el.closest('script,style,textarea,[data-no-translate],.leaflet-pane,.leaflet-control-attribution,[data-inline-language],#mishwar-language');const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const value=node.nodeValue.trim();if(/[\u0600-\u06ff]/.test(value)&&!skip(node.parentElement)&&visible(node.parentElement))missing.push(value)}for(const el of root.querySelectorAll('[placeholder],[title],[aria-label]'))if(!skip(el)&&visible(el))for(const key of ['placeholder','title','aria-label']){const value=el.getAttribute(key)||'';if(/[\u0600-\u06ff]/.test(value))missing.push(key+': '+value)}return [...new Set(missing)]})()`);
  fixtures.results.push({name:'english-'+name,passed:missing.length===0,untranslated:missing});
  assert.deepEqual(missing,[],name+' English UI must contain no untranslated system labels');
  await evaluate("window.MishwarLang.set('ar')");
 };
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
 await command('Network.setBlockedURLs',{urls:['https://*']});await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"try{localStorage.setItem('mishwar-permissions-onboarded-v2','true')}catch{}"});
 for(const [name,width,height]of[['desktop',1440,1000],['mobile',390,844],['short-mobile',390,640]]){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await navigate(origin);await waitFor("window.MishwarAccountContext?.snapshot().status==='ready'&&document.querySelectorAll('.launch-home-tools button').length===4",name+' home and account must finish rendering');
  const home=await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.launch-home-tools button')].map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e}})})");
  assert.equal(home.scroll,home.width);assert.equal(home.buttons.length,4);assert.ok(home.buttons.every(b=>b.clickable));
  const background=await evaluate("(()=>{const button=document.querySelector('#background-notifications-button'),rect=button?.getBoundingClientRect();return {visible:!!rect&&rect.width>0&&rect.height>0&&getComputedStyle(button).display!=='none',clickable:!!rect&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('button')===button}})()");
  assert.equal(background.visible,true,name+' background activation entry must be visible');assert.equal(background.clickable,true,name+' background activation entry must be clickable');
  fixtures.results.push({name,home});
  await evaluate('showHelp()');await wait(50);assert.ok(await evaluate("document.querySelector('#modal').open"));await evaluate("document.querySelector('#modal').close();showSettings()");await wait(50);assert.ok(await evaluate("document.querySelector('#modal').open"));await evaluate("document.querySelector('#modal').close();window.MishwarLang.set('en')");await wait(50);assert.equal(await evaluate('document.documentElement.dir'),'ltr');await evaluate("window.MishwarLang.set('ar')");assert.equal(await evaluate('document.documentElement.dir'),'rtl');
  await evaluate("document.querySelector('#modal').close();document.querySelector('#background-notifications-button').click()");
  await waitFor("!!document.querySelector('.background-notifications-dialog[open]')",'Guest activation must explain that sign-in is required');
  assert.equal(await evaluate("document.querySelector('#background-notifications-button').disabled"),false);
  await evaluate("document.querySelector('.background-notifications-dialog').close()");
  if(name==='desktop'){
   await evaluate('showSettings()');await englishAudit('settings','#modal');await evaluate("document.querySelector('#modal').close();showHelp()");await englishAudit('help','#modal');await evaluate("document.querySelector('#modal').close();window.showRiderLogin()");await englishAudit('login','#modal');await evaluate("document.querySelector('#modal').close()");
  }
  const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifact,name+'.png'),Buffer.from(shot.data,'base64'));
 }
 // Authentication is simulated only by this loopback server. No real account is created.
 fixtures.owner='a';await navigate(origin);await waitFor("document.querySelector('#panel')?.innerText.includes('a-offline-trip'.slice(0,8))",'Account A trip must finish restoring');
 assert.ok(await evaluate("document.querySelector('#panel').innerText.includes('a-offline-trip'.slice(0,8))"),'Account A trip is restored');
 const originalAccountKey=await evaluate('window.MishwarAccountContext.snapshot().accountKey');
 await evaluate('showAccount()');await waitFor("!!document.querySelector('[data-rider-account-settings]')",'Account security must be reachable from the profile');
 await englishAudit('profile','#modal');assert.ok(await evaluate("document.querySelector('#modal').innerText.includes('أحمد الاختبار')"),'Arabic user names must remain unchanged');
 await evaluate("document.querySelector('[data-rider-account-settings]').click()");
 await waitFor("!!document.querySelector('#rider-account-change')",'Account settings form must render');
 await englishAudit('account-security','#modal');
 await evaluate("(()=>{const form=document.querySelector('#rider-account-change');form.elements.kind.value='phone';form.elements.kind.dispatchEvent(new Event('change'));form.elements.oldPassword.value='local-old-password';form.elements.value.value='0500000020';form.requestSubmit()})()");
 await waitFor("!!document.querySelector('#rider-account-code')",'Current phone verification must be required');
 assert.equal(fixtures.accountChange.stage,'old');
 await englishAudit('account-otp','#modal');
 for(const expected of ['new','approved']){
  await evaluate("(()=>{const form=document.querySelector('#rider-account-code');form.elements.code.value='1234';form.requestSubmit()})()");
  await waitFor(expected==='new'?"document.querySelector('[data-rider-security-view]')?.textContent.includes('تحقق الآن من رقم الجوال الجديد.')":"!!document.querySelector('[data-finish-account-change]')",'Phone proof must advance to '+expected);
  assert.equal(fixtures.accountChange.stage,expected);
 }
 await evaluate("document.querySelector('[data-finish-account-change]').click()");
 await waitFor("!!document.querySelector('.rider-account-card')",'Saved account change must refresh the profile');
 assert.equal(await evaluate('window.MishwarAccountContext.snapshot().accountKey'),originalAccountKey,'Changing a phone must preserve the immutable account namespace');
 await evaluate("document.querySelector('#modal').close()");
 fixtures.results.push({name:'account-phone-proof-and-stable-identity',passed:true});
 // A response can be lost after the server has saved a support request.
 await evaluate('window.MishwarSupport.open()');
 await waitFor("!!document.querySelector('[data-support-create]')",'The real help action must open account support');
 await englishAudit('support-create','#rider-support-dialog');
 await evaluate("(()=>{const form=document.querySelector('[data-support-create]');form.elements.description.value='Offline support draft that must survive a lost response';form.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit()})()");
 await waitFor("!!document.querySelector('[data-support-error]')?.textContent",'A failed confirmation must keep the support form');
 await englishAudit('support-error','#rider-support-dialog');
 assert.equal(await evaluate("document.querySelector('[data-support-create]').elements.description.value"),'Offline support draft that must survive a lost response');
 await evaluate("document.querySelector('[data-support-create]').requestSubmit()");
 await waitFor("document.querySelector('#rider-support-dialog')?.innerText.includes('Local support response')",'A confirmed request must expose the existing support conversation');
 await englishAudit('support-conversation','#rider-support-dialog');
 assert.equal(fixtures.cases.length,1,'Retrying a lost confirmation must not create a second case');
 const attempts=fixtures.requests.filter(row=>row.action==='live_case_create');assert.equal(attempts.length,2);assert.ok(attempts[0].clientRequestId&&attempts[0].clientRequestId===attempts[1].clientRequestId);
 await evaluate("document.querySelector('#rider-support-dialog').close()");
 fixtures.results.push({name:'support-draft-loss-and-idempotent-retry',passed:true});
 // Real layout matters: a short phone cannot expose every card at once.
 fixtures.notifications=Array.from({length:5},(_,i)=>({id:'offline-notification-'+i,title:'إشعار اختبار '+(i+1),body:'رسالة محلية للتحقق من ظهور الإشعار قبل تأكيد قراءته. '.repeat(3)}));
 const localUnreadBefore=await evaluate("document.querySelector('#notification-count').hidden?0:Number(document.querySelector('#notification-count').textContent)");
 assert.ok(localUnreadBefore>0,'The restored trip must create a local unread update');
 await evaluate("document.querySelector('#notifications-button').click()");
 await waitFor("document.querySelectorAll('[data-notification-id]').length===5",'Server notifications must finish rendering');
 // The inner scrollport must fit inside the actual dialog content box. A body
 // taller than its clipped parent makes the last notice impossible to read even
 // at maximum scrollTop; do not bypass the visible-only acknowledgement guard.
 fixtures.notificationBounds=await evaluate("(()=>{const modal=document.querySelector('#modal'),body=modal.querySelector('.dialog-body'),m=modal.getBoundingClientRect(),b=body.getBoundingClientRect(),s=getComputedStyle(modal),top=m.top+parseFloat(s.borderTopWidth)+parseFloat(s.paddingTop),bottom=m.bottom-parseFloat(s.borderBottomWidth)-parseFloat(s.paddingBottom);return {bodyTop:b.top,bodyBottom:b.bottom,contentTop:top,contentBottom:bottom,viewportHeight:innerHeight,fits:b.top>=Math.max(0,top)-1&&b.bottom<=Math.min(innerHeight,bottom)+1}})()");
 assert.equal(fixtures.notificationBounds.fits,true,'Notification scrollport must fit inside its dialog and viewport: '+JSON.stringify(fixtures.notificationBounds));
 for(let i=0;i<50&&!fixtures.notificationAcks.length;i++)await wait(100);
 assert.ok(fixtures.notificationAcks.length,'A painted visible notification must be acknowledged');
 const exposed=await evaluate("(()=>{const body=document.querySelector('#modal .dialog-body'),bounds=body.getBoundingClientRect();return [...document.querySelectorAll('[data-notification-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.top>=Math.max(bounds.top,0)&&r.bottom<=Math.min(bounds.bottom,innerHeight)}).map(e=>e.dataset.notificationId)})()");
 const acknowledged=[...new Set(fixtures.notificationAcks.flatMap(row=>row.ids))];
 assert.ok(acknowledged.length>0&&acknowledged.length<fixtures.notifications.length,'Offscreen notifications must remain unread');
 assert.ok(acknowledged.every(id=>exposed.includes(id)),'Only cards actually exposed in the dialog viewport may be acknowledged');
 await evaluate("(()=>{const body=document.querySelector('#modal .dialog-body');body.scrollTop=body.scrollHeight})()");
 for(let i=0;i<50&&!fixtures.notificationAcks.some(row=>row.ids.includes('offline-notification-4'));i++)await wait(100);
 assert.ok(fixtures.notificationAcks.some(row=>row.ids.includes('offline-notification-4')),'Scrolling must acknowledge newly displayed cards');
 assert.equal(await evaluate("document.querySelector('#notification-count').hidden?0:Number(document.querySelector('#notification-count').textContent)"),localUnreadBefore,'Showing unrelated server notices must not clear an unseen local trip update');
 await evaluate("document.querySelector('#modal').close()");
 const closedCount=fixtures.notificationAcks.length;await wait(100);
 assert.equal(fixtures.notificationAcks.length,closedCount,'Closing the notification view must stop display acknowledgements');
 fixtures.results.push({name:'notifications-visible-only',passed:true,shown:exposed.length,acknowledged:acknowledged.length,total:fixtures.notifications.length});
 fixtures.notifications=[];
 await evaluate("document.querySelector('#notifications-button').click()");
 await waitFor("document.querySelectorAll('[data-notification-id]').length>0&&document.querySelector('#notification-count').hidden",'Showing the local trip update must clear its own unread badge');
 assert.equal(fixtures.notificationAcks.length,closedCount,'Local updates must not be acknowledged as server notification IDs');
 await evaluate("document.querySelector('#modal').close()");
 fixtures.results.push({name:'notifications-local-badge-ownership',passed:true});
 // Age a real rendered marker while every subsequent live response is withheld.
 fixtures.pauseLive=true;
 const completedBeforeAging=fixtures.liveResponses;
 await evaluate("window.offlineOriginalDateNow=Date.now;Date.now=()=>window.offlineOriginalDateNow()+120001");
 try{
  await waitFor("document.querySelector('.captain-location-state')?.textContent.includes('آخر موقع')&&!!document.querySelector('.captain-car-marker.location-stale')",'The existing GPS sample must become stale without a new response');
  assert.equal(fixtures.liveResponses,completedBeforeAging,'Staleness must be computed locally');
 }finally{
  await evaluate('Date.now=window.offlineOriginalDateNow;delete window.offlineOriginalDateNow');
  fixtures.pauseLive=false;for(const release of fixtures.liveReleases.splice(0))release();
 }
 await evaluate('window.refreshMishwarTrip()');
 await waitFor("document.querySelector('.captain-location-state')?.textContent==='موقع الكابتن المباشر'",'A fresh response must restore live GPS state');
 fixtures.results.push({name:'gps-local-expiry-and-recovery',passed:true});
 await evaluate('showAccount()');await wait(50);await evaluate("document.querySelector('#rider-logout').click()");await wait(500);
 assert.equal(await evaluate('window.mishwarTripActive'),false);
 assert.equal(await evaluate("document.body.innerText.includes('a private pickup')"),false);
 await evaluate('window.showRiderLogin()');await wait(50);await evaluate("(()=>{const f=document.querySelector('#rider-password-form');f.phone.value='0500000002';f.password.value='offline-password';f.requestSubmit()})()");await wait(600);
 assert.equal(await evaluate('window.MishwarAccountContext.snapshot().accountKey'),keys.b);
 assert.equal(await evaluate('window.mishwarTripActive'),false);
 assert.equal(await evaluate("document.body.innerText.includes('a private pickup')"),false);
 fixtures.results.push({name:'account-switch',passed:true});
 fixtures.sharedFailures=1;
 const sharedCallsBefore=fixtures.requests.filter(row=>row.path==='/api/shared-trip').length;
 await navigate(origin+'/track.html#'+'a'.repeat(64));await waitFor("!!document.querySelector('.leaflet-marker-icon')",'Shared trip markers must recover after a temporary HTTP failure');
 assert.ok(fixtures.requests.filter(row=>row.path==='/api/shared-trip').length-sharedCallsBefore>=2,'A temporary shared tracking error must be retried');
 fixtures.results.push({name:'shared-tracking-transient-recovery',passed:true});
 await evaluate("document.querySelectorAll('.leaflet-marker-icon').forEach(e=>e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})))");await wait(150);
 assert.equal(await evaluate('window.offlineAuditXss===true'),false);
 assert.ok(await evaluate("document.querySelector('.leaflet-tooltip')?.textContent.includes('<img')"),'Untrusted tooltip content is visible as text');
 fixtures.results.push({name:'shared-tooltip-text-only',passed:true});
 if(pwaRequired){
  const images=await evaluate("Promise.all(['layers.png','layers-2x.png','marker-icon.png','marker-icon-2x.png','marker-shadow.png'].map(async name=>{const image=new Image();image.src='/vendor/images/'+name;await image.decode();return {name,width:image.naturalWidth,height:image.naturalHeight}}))");
  assert.deepEqual(images,[{name:'layers.png',width:26,height:26},{name:'layers-2x.png',width:52,height:52},{name:'marker-icon.png',width:25,height:41},{name:'marker-icon-2x.png',width:50,height:82},{name:'marker-shadow.png',width:41,height:41}]);
  fixtures.results.push({name:'leaflet-official-images',passed:true,images});
  await navigate(origin);await waitFor("navigator.serviceWorker.getRegistration().then(r=>!!r?.active)",'Published service worker must become active');fixtures.results.push({name:'service-worker-active',passed:true});
 }
 const allowed=new Set(['/favicon.ico']);
 const missing=[...new Set(fixtures.missing)].filter(x=>!allowed.has(x));
 assert.deepEqual(missing,[],'No unintended missing local assets');assert.deepEqual(fixtures.exceptions,[],'No uncaught JavaScript exceptions');
 console.log(JSON.stringify({passed:true,artifact,results:fixtures.results,missing:[...new Set(fixtures.missing)]},null,2));
}catch(error){fixtures.failure=error.stack;console.error(error.stack);process.exitCode=1;}
finally{clearTimeout(timeout);writeFileSync(join(artifact,'observations.json'),JSON.stringify(fixtures,null,2));ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
