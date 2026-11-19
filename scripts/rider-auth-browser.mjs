import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {resolve, join, extname, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {makeEnv} from '../apps/hub/tests/fixtures.mjs';
import {handleRiderAuth, riderAccountKey} from '../apps/hub/worker/rider-auth.js';
import {publicSession} from '../apps/hub/worker/free-auth.js';
import riderGateway from '../apps/rider/worker/index.js';

// Real rider gateway + real shared Worker auth + migration-backed SQLite,
// running ONLY on loopback with fake SMS. Production and external URLs denied.
const root=resolve(process.argv[2]||'apps/rider/dist/public');
const artifacts=resolve('artifacts/rider-auth-browser-'+Date.now());
mkdirSync(artifacts,{recursive:true});
assert.ok(existsSync(join(root,'index.html')),'Build apps/rider first; index.html not found');
const env=makeEnv();
env.AUTHENTICA_API_KEY='fake-offline-otp-key';env.AUTHENTICA_TEMPLATE_ID='91';
const hub='https://hub.offline.test';
const originalFetch=globalThis.fetch;
const observations={tests:[],externalBlocked:[],errors:[],exceptions:[],requests:[],smsSent:0,smsChecked:0,documentLoads:0,rootPrefetchRequests:0,mainFrameNavigations:[]};
const password='rider-browser-offline-only-123';
const phone='0509887766';
const email='browser-rider@example.test';
const name='Browser Rider Tester';
const json=(res,data,status=200,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data))};
let origin='';
const normalizeCookie=header=>String(header||'').match(/__Host-mishwar_sid=([a-f0-9]{64})/)?.[1]||'';
const trustedIp='198.51.100.42';
const guest=()=>({guest:true,verified:false,accountKey:null,trip:null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false}});

globalThis.fetch=async(url,opts={})=>{
 const target=String(url);
 if(target===hub+'/internal/rider-auth'){
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  return handleRiderAuth(new Request(target,{method:'POST',headers:opts.headers,body:opts.body}),env);
 }
 if(target.startsWith('https://api.authentica.sa/api/v2/')){
  assert.equal(opts.headers['X-Authorization'],'fake-offline-otp-key');
  const payload=JSON.parse(opts.body);
  if(target.endsWith('/send-otp')){observations.smsSent++;assert.equal(payload.template_id,91);return Response.json({success:true})}
  if(target.endsWith('/verify-otp')){observations.smsChecked++;return Response.json({verified:payload.otp==='246810'})}
  throw Error('Unexpected fake SMS endpoint');
 }
 throw Error('EXTERNAL_NETWORK_FORBIDDEN: '+target.replace(/\?.*$/,''));
};

const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1'),path=u.pathname;
 if(path==='/'){
  // The PWA Service Worker intentionally pre-caches '/', making a second GET /.
  // A cache-prefetch request has sec-fetch-dest=empty and MUST NOT be counted as
  // a user-visible document navigation. Validate actual main-frame navigation below.
  const destination=String(req.headers['sec-fetch-dest']||'');
  const mode=String(req.headers['sec-fetch-mode']||'');
  if(destination==='document'||mode==='navigate')observations.documentLoads++;
  else observations.rootPrefetchRequests++;
 }
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000){json(res,{error:'Oversized local fixture'},413);return}}
  let body={};try{body=raw?JSON.parse(raw):{}}catch{}
  observations.requests.push({path,action:body?.action||null,method:req.method});
  if(path.startsWith('/api/auth/')){
   try{
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='GET'?{}:{body:raw})});
    const reply=await riderGateway.fetch(request,{HUB_URL:hub,HUB_SERVICE_KEY:env.RIDER_SERVICE_KEY},{trustedClientIp:trustedIp});
    const bytes=Buffer.from(await reply.arrayBuffer());
    res.writeHead(reply.status,Object.fromEntries(reply.headers.entries()));res.end(bytes);
   }catch(e){observations.errors.push('AUTH_GATEWAY:'+String(e.message));json(res,{error:'Local gateway error'},500)}
   return;
  }
  if(path==='/api/live'){
   const allowed=new Set(['live_session','live_watch','live_history','live_capabilities','live_reservations','live_contacts','live_cases','live_referral','live_realtime_token','live_refunds']);
   if(!allowed.has(body.action)){json(res,{error:'Fixture blocks writes and unknown actions'},403);return}
   const session=await publicSession(env,normalizeCookie(req.headers.cookie),'rider');
   if(['live_session','live_watch'].includes(body.action)){
    if(!session){json(res,guest());return}
    json(res,{...guest(),guest:false,verified:!!session.phoneVerified,accountKey:await riderAccountKey(session.actor),profile:{name:session.name,phone:session.phone,email:session.email}});return;
   }
   if(body.action==='live_history'){json(res,{trips:[],nextOffset:null,ratings:{average:0,receivedCount:0}});return}
   if(body.action==='live_realtime_token'){json(res,{error:'Offline realtime disabled'},503);return}
   json(res,{items:[],features:[],notice:'Offline fixture'});return;
  }
  if(path==='/api/service-status'){json(res,{features:[],ready:false});return}
  if(path==='/api/map-config'){json(res,{searchConfigured:false});return}
  if(path==='/api/background'){json(res,{configured:false,notifications:[]});return}
  json(res,{error:'API not available in offline browser fixture'},503);return;
 }
 const file=resolve(root,'.'+(path==='/'?'/index.html':path));
 const inside=relative(root,file);
 if(inside.startsWith('..')||isAbsolute(inside)){res.writeHead(403);res.end();return}
 try{const bytes=readFileSync(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
origin='http://127.0.0.1:'+server.address().port;
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(edge,'Edge or Chrome is required for real browser auth test');
const browserProfile=mkdtempSync(join(tmpdir(),'mishwar-rider-auth-browser-'));
const browser=spawn(edge,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>{console.error('BROWSER_TIMEOUT');browser.kill();process.exit(2)},180000);timer.unref();
let ws;let command,evaluate;
const attempt=async(name,fn)=>{try{await fn();observations.tests.push({name,status:'PASS'});console.log('PASS '+name)}catch(e){observations.tests.push({name,status:'FAIL',error:String(e.message)});console.error('FAIL '+name+': '+e.message);try{const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name.replace(/[^\w-]/g,'_')+'.png'),Buffer.from(shot.data,'base64'))}catch{}}};
try{
 let port='';for(let i=0;i<90;i++){try{port=readFileSync(join(browserProfile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}
 assert.match(port,/^\d+$/,'Browser CDP did not launch');
 const targets=await originalFetch('http://127.0.0.1:'+port+'/json/list').then(x=>x.json());
 ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;setTimeout(()=>reject(Error('CDP websocket timeout')),5000).unref()});
 let seq=0;const pending=new Map();
 command=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method+' timeout'))},10000);pending.set(id,{resolve:x=>{clearTimeout(t);resolve(x)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result)}else if(m.method==='Fetch.requestPaused'){
  const request=m.params;const url=new URL(request.request.url);
  if(url.hostname!=='127.0.0.1'){observations.externalBlocked.push(url.origin);void command('Fetch.failRequest',{requestId:request.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
  else void command('Fetch.continueRequest',{requestId:request.requestId}).catch(()=>{});
 }else if(m.method==='Runtime.exceptionThrown'){observations.exceptions.push(String(m.params.exceptionDetails?.text||'JavaScript exception'))}
 else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){observations.errors.push(m.params.args.map(x=>x.value||x.description).join(' '))}
  else if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId&&m.params.frame.url.startsWith(origin+'/')){
   observations.mainFrameNavigations.push(m.params.frame.url.replace(/\?.*$/,''));
  }}
 evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value};
 const until=async(expr,msg,ms=9000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expr))return;await wait(50)}throw Error(msg)};
 const click=async selector=>{
  await until(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing button '+selector);
  const visible=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'})`;
  await evaluate(`(${visible})?.scrollIntoView({block:'center'})`);await wait(45);
  const target=await evaluate(`(()=>{const el=${visible};if(!el)return null;const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,ok:!!hit&&(el===hit||el.contains(hit)),found:hit?.tagName}})()`);
  assert.ok(target?.ok,`Button ${selector} not actually clickable: ${JSON.stringify(target)}`);
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
 };
 const type=async(selector,value)=>{await until(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing input '+selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await command('Input.insertText',{text:value})};
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"window.__authTestDocument=crypto.randomUUID();try{localStorage.setItem('mishwar-permissions-onboarded-v2','true')}catch{}"});
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await command('Page.navigate',{url:origin+'/'});
 await until("document.readyState==='complete' && window.MishwarAccountContext?.snapshot().status==='ready'",'Rider guest bootstrap must complete',18000);
 const documentMark=await evaluate('window.__authTestDocument');
  const firstNavigationCount=observations.mainFrameNavigations.length;
  assert.ok(firstNavigationCount>=1,'Browser main-frame navigation was not captured by CDP');
 const profileNav=await evaluate("document.querySelector('[data-open-menu]')?.getBoundingClientRect().width>0");
 const openAccount=async()=>{if(profileNav){await click('[data-open-menu]');await until("document.querySelector('#drawer')?.open",'Drawer not open');await click('#drawer [data-section="profile"]')}else await click('.rail [data-section="profile"]')};
 await attempt('RIDER-002 guest login screen opens by real click',async()=>{
  await openAccount();await until("!!document.querySelector('#rider-password-form')",'Login form failed to open');
  assert.equal(await evaluate('window.__authTestDocument'),documentMark,'UI must not reload');
 });
 await attempt('RIDER-002 register form creates local SQLite account',async()=>{
  await click('#switch-rider-auth');await until("!!document.querySelector('#rider-password-form [name=name]')",'Register form not open');
  await type('#rider-password-form [name=name]',name);await type('#rider-password-form [name=phone]',phone);await type('#rider-password-form [name=password]',password);await type('#rider-password-form [name=email]',email);
  await click('#rider-password-form [type=submit]');
  await until("window.MishwarAccountContext.snapshot().authenticated===true",'Registration did not establish a session',18000);
  await until("!!document.querySelector('#rider-otp-form')",'New rider should be prompted for OTP',18000);
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM public_accounts WHERE role='rider'").get().n,1);
  assert.equal(await evaluate('window.__authTestDocument'),documentMark);
 });
 await attempt('RIDER-003 real UI completes fake SMS challenge',async()=>{
  await click('#rider-send-otp');await until("document.querySelector('#rider-otp-form [name=code]')!=null",'OTP form not available');
  await type('#rider-otp-form [name=code]','246810');await click('#rider-otp-form [type=submit]');
  await until("window.MishwarAccountContext.snapshot().verified===true",'OTP did not verify account',18000);
  assert.equal(observations.smsSent,1,'Exactly one fake SMS should be sent');
   assert.equal(await evaluate('window.__authTestDocument'),documentMark,'OTP must not reload the document');
 });
 await attempt('RIDER-004 real UI logs out and removes private account',async()=>{
  await until("!!document.querySelector('#rider-logout')",'Logout control not visible');await click('#rider-logout');
  await until("(window.MishwarAccountContext.snapshot().status==='ready'&&window.MishwarAccountContext.snapshot().authenticated===false)",'Logout left account authenticated',16000);
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM public_sessions').get().n,0);
  assert.equal(await evaluate('window.__authTestDocument'),documentMark,'Logout must not reload');
 });
 await attempt('RIDER-003 real UI logs in with original password again',async()=>{
  await openAccount();await until("!!document.querySelector('#rider-password-form')",'Login after logout not visible');
  await type('#rider-password-form [name=phone]',phone);await type('#rider-password-form [name=password]',password);await click('#rider-password-form [type=submit]');
  await until("window.MishwarAccountContext.snapshot().authenticated===true",'Re-login failed',18000);
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM public_sessions').get().n,1);
   assert.equal(await evaluate('window.__authTestDocument'),documentMark,'Re-login must not reload the document');
 });
 await attempt('RIDER-003 recovery UI is reachable without replaying actions',async()=>{
  // Logout before testing recovery; recovery must start as a guest action.
  await until("!!document.querySelector('#rider-logout')",'Logout not shown before recovery');await click('#rider-logout');
  await until("(window.MishwarAccountContext.snapshot().status==='ready'&&window.MishwarAccountContext.snapshot().authenticated===false)",'Second logout failed');
  await openAccount();await until("!!document.querySelector('[data-account-recovery]')",'Recovery launch not shown');
  await click('[data-account-recovery]');await until("!!document.querySelector('#start-recovery')",'Recovery screen missing');
  await type('#start-recovery [name=phone]',phone);await click('#start-recovery button');
  await until("!!document.querySelector('#account-recovery-dialog .recovery-status')",'Recovery request not shown',14000);
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM account_recovery WHERE status='pending'").get().n,1);
   assert.equal(await evaluate('window.__authTestDocument'),documentMark,'Recovery must not reload the document');
 });
 await attempt('RIDER-002/004 no production writes, cross-origin requests or document reloads',async()=>{
  // Two GET / requests are normal: one browser document + one SW install pre-cache.
   // A real reload must change the document ID and emit a CDP top-level frame navigation.
   assert.ok(observations.documentLoads<=1,'Browser navigated to root more than once');
   assert.equal(observations.mainFrameNavigations.length,firstNavigationCount,'Main frame unexpectedly navigated again: '+JSON.stringify(observations.mainFrameNavigations));
   assert.equal(await evaluate('window.__authTestDocument'),documentMark,'Document identity changed unexpectedly');
  const mutations=observations.requests.filter(x=>x.path==='/api/live'&&!new Set(['live_session','live_watch','live_history','live_capabilities','live_reservations','live_contacts','live_cases','live_referral','live_realtime_token','live_refunds']).has(x.action));
  assert.deepEqual(mutations,[],'No live bookings or payments can be made from this suite');
  assert.deepEqual(observations.exceptions,[],'No uncaught JavaScript exceptions');
 });
 const total=observations.tests.length,failed=observations.tests.filter(x=>x.status==='FAIL').length;
 console.log('RIDER_AUTH_BROWSER '+JSON.stringify({passed:total-failed,failed,all:total,externalNetwork:'blocked',database:'sqlite-in-memory',documentNavigations:observations.mainFrameNavigations.length,documentRequests:observations.documentLoads,pwaRootPrefetches:observations.rootPrefetchRequests}));
 process.exitCode=failed?1:0;
}finally{
 clearTimeout(timer);writeFileSync(join(artifacts,'results.json'),JSON.stringify(observations,null,2));
 ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));env.db.close();globalThis.fetch=originalFetch;
}
