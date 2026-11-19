import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync} from 'node:fs';
import {resolve, join, extname, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// All account data belongs to this loopback fixture. No production API is used.
const args=process.argv.slice(2);
const root=resolve(args.find(arg=>!arg.startsWith('--'))||'apps/rider/public');
const artifact=resolve(args.find(arg=>arg.startsWith('--artifacts='))?.slice(12)||'artifacts/rider-repairs-2026-11-15/navigation-'+Date.now());
const expectFailure=args.includes('--expect-failure');
const quick=args.includes('--quick');
mkdirSync(artifact,{recursive:true});
const fixtures={owner:null,gateAuth:false,authReleases:[],holdLive:false,liveReleases:[],authRequests:0,authResponses:0,liveResponses:0,documents:0,requests:[],missing:[],blocked:[],exceptions:[],consoleErrors:[],results:[]};
const keys={a:'a'.repeat(64),b:'b'.repeat(64)};
const profile=owner=>({name:owner==='a'?'Navigation Rider Alpha':'Navigation Rider Beta',phone:owner==='a'?'+966500000001':'+966500000002',email:owner+'@example.test'});
const auth=owner=>({authenticated:!!owner,phoneVerified:!!owner,accountKey:owner?keys[owner]:null,profile:owner?profile(owner):null});
const session=owner=>({guest:!owner,verified:!!owner,accountKey:owner?keys[owner]:null,profile:owner?profile(owner):null,trip:null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:owner==='a'?12100:owner==='b'?23200:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false}});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const releaseAuth=()=>{fixtures.gateAuth=false;for(const release of fixtures.authReleases.splice(0))release();};
const releaseLive=()=>{fixtures.holdLive=false;for(const release of fixtures.liveReleases.splice(0))release();};
const readActions=new Set(['live_session','live_watch','live_capabilities','live_reservations','live_history','live_contacts','live_referral','live_cases','live_realtime_token']);
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path==='/')fixtures.documents++;
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req)raw+=chunk;
  let body={};try{body=JSON.parse(raw)}catch{}
  const owner=fixtures.owner;
  fixtures.requests.push({path,action:body.action,owner});
  let data;
  if(path==='/api/auth/session'){
   fixtures.authRequests++;
   if(fixtures.gateAuth)await new Promise(resolve=>fixtures.authReleases.push(resolve));
   data=auth(owner);fixtures.authResponses++;
  }else if(path==='/api/map-config')data={searchConfigured:false};
  else if(path==='/api/service-status')data={features:[]};
  else if(path==='/api/background')data={configured:false,notifications:[]};
  else if(path==='/api/live'&&readActions.has(body.action)){
   if(['live_session','live_watch'].includes(body.action)){
    if(fixtures.holdLive)await new Promise(resolve=>fixtures.liveReleases.push(resolve));
    data=session(owner);fixtures.liveResponses++;
   }else if(body.action==='live_realtime_token'){res.statusCode=503;data={error:'Realtime is intentionally unavailable in the loopback fixture'};}
   else if(body.action==='live_history')data={trips:[],ratings:{average:0,receivedCount:0},nextOffset:null};
   else if(body.action==='live_referral')data={enabled:false,notice:'Local fixture only',code:'OFFLINE',reward:0,stats:{invited:0,rewards:0},linked:false};
   else if(body.action==='live_reservations')data={schedulerConfigured:false,items:[]};
   else data={items:[],features:[]};
  }else{res.statusCode=503;data={error:'This navigation fixture permits reads only'};}
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));return;
 }
 try{
  const file=resolve(root,'.'+(path==='/'?'/index.html':path)),inside=relative(root,file);
  if(inside.startsWith('..')||isAbsolute(inside))throw Error('outside fixture');
  const bytes=readFileSync(file);
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(bytes);
 }catch{fixtures.missing.push(path);res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert.ok(browserPath,'A local Chromium browser is required');
const browserProfile=mkdtempSync(join(tmpdir(),'mishwar-navigation-browser-'));
const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,command,evaluate;
const timeout=setTimeout(()=>{browser.kill();console.error('Navigation browser timed out');process.exit(2)},180000);timeout.unref();
const record=async(name,fn)=>{
 const row={name,passed:false};fixtures.results.push(row);
 try{await fn(row);row.passed=true;console.log('PASS '+name);}catch(error){row.error=error.message;console.error('FAIL '+name+': '+error.message);try{await screenshot('FAIL-'+name)}catch{}}
};
const screenshot=async name=>{
 const shot=await command('Page.captureScreenshot',{format:'png'});
 writeFileSync(join(artifact,name.replace(/[^a-z0-9_-]/gi,'-')+'.png'),Buffer.from(shot.data,'base64'));
};
try{
 let port;for(let i=0;i<80;i++){try{port=readFileSync(join(browserProfile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch(error){if(!['ENOENT','EBUSY','EACCES'].includes(error.code))throw error;}await wait(100);}
 assert.ok(/^\d+$/.test(port||''),'Browser debugging endpoint must start');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)})).json();
 ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;setTimeout(()=>reject(Error('Debug socket timeout')),5000).unref()});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);
  pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}));
 });
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const pendingCall=pending.get(message.id);pending.delete(message.id);message.error?pendingCall?.reject(Error(JSON.stringify(message.error))):pendingCall?.resolve(message.result);}
  else if(message.method==='Runtime.exceptionThrown')fixtures.exceptions.push(message.params.exceptionDetails);
  else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')fixtures.consoleErrors.push(message.params.args.map(arg=>arg.value||arg.description||'').join(' '));
  else if(message.method==='Fetch.requestPaused'){
   const paused=message.params,url=new URL(paused.request.url);
   if(url.hostname!=='127.0.0.1'){fixtures.blocked.push(paused.request.url);void command('Fetch.failRequest',{requestId:paused.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
   else void command('Fetch.continueRequest',{requestId:paused.requestId}).catch(()=>{});
  }
 };
 evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const waitFor=async(expression,message)=>{const deadline=Date.now()+6500;while(Date.now()<deadline){if(await evaluate(expression))return;await wait(40);}throw Error(message);};
 const waitNode=async selector=>waitFor(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing '+selector);
 const click=async selector=>{
  await waitNode(selector);
  const visibleElement=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})`;
  await evaluate(`(${visibleElement})?.scrollIntoView({block:'center',inline:'nearest'})`);await wait(25);
  const target=await evaluate(`(()=>{const el=${visibleElement};if(!el)return {width:0,height:0,clickable:false,reason:'No visible matching element'};const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,clickable:!!hit&&(hit===el||el.contains(hit)),hit:hit?.outerHTML.slice(0,220)}})()`);
  assert.ok(target.width>0&&target.height>0&&target.clickable,'User cannot click '+selector+': '+JSON.stringify(target));
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
 };
 const closeView=async()=>{
  if(await evaluate("!!document.querySelector('#launch-dialog[open]')"))await click('#launch-dialog [data-launch-back]');
  if(await evaluate("!document.querySelector('#search-sheet').hidden"))await click('#search-sheet [data-search-close]');
  if(await evaluate("document.querySelector('#modal').open"))await click('#modal [data-action="close"]');
  if(await evaluate("document.querySelector('#drawer').open"))await click('#drawer [data-feature="drawer-close"]');
 };
 const openSection=async(section,width)=>{
  await closeView();
  if(section==='search'){await click(width<701?'.booking-sheet-handle':'[data-address="destination"]');return;}
  if(section==='notifications'){await click('#notifications-button');return;}
  if(['reservations','cases','readiness','referral'].includes(section)){await click('#panel .launch-home-tools [data-launch="'+section+'"]');return;}
  if(width<701){await click('[data-open-menu]');await waitFor("document.querySelector('#drawer').open",'Mobile drawer must open');await click('#drawer [data-section="'+section+'"]');}
  else await click('.rail [data-section="'+section+'"]');
 };
 const viewState=()=>evaluate("({title:document.querySelector('#modal .modal-head h2')?.textContent.trim(),modal:document.querySelector('#modal').open,launch:!!document.querySelector('#launch-dialog[open]'),launchTitle:document.querySelector('#launch-dialog .launch-head h2')?.textContent.trim(),search:!document.querySelector('#search-sheet').hidden,drawer:document.querySelector('#drawer').open,owner:window.MishwarAccountContext.snapshot().accountKey,documentMark:window.navigationFixtureMark,text:document.querySelector('#modal-content')?.innerText.slice(0,600)})");
 const expected=(section,state,settledOwner)=>{
  if(section==='search')assert.equal(state.search,true,'Search screen must stay open');
  else if(['reservations','cases','readiness','referral'].includes(section)){
   assert.equal(state.launch,true,section+' screen must stay open');
   assert.equal(state.launchTitle,({reservations:'الحجوزات المسبقة',cases:'طلباتي لدى الدعم',readiness:'خدمات مشوار',referral:'دعوة صديق'})[section]);
  }
  else{
   assert.equal(state.modal,true,section+' screen must stay open');
   const titles={settings:['الإعدادات'],help:['مساعدة'],profile:typeof settledOwner==='string'?['ملفي الشخصي']:['ملفي الشخصي','أهلًا بك في مشوار'],wallet:['محفظة مشوار'],trips:['رحلاتي'],notifications:['الإشعارات']};
   assert.ok(titles[section].includes(state.title),'Expected '+section+' title, got '+state.title);
   if(section==='profile'&&settledOwner)assert.ok(state.text.includes(profile(settledOwner).name),'Signed-in account must replace the temporary login view with its own profile');
  }
  assert.equal(state.drawer,false,'The selected screen must replace the drawer');
 };
 const navigate=async(owner,gate)=>{
  releaseAuth();releaseLive();fixtures.owner=owner;fixtures.gateAuth=gate;
  const before=await evaluate('window.navigationFixtureMark');
  await command('Page.navigate',{url:origin+'/?navigation='+Date.now()});
  await waitFor(`window.navigationFixtureMark!==${JSON.stringify(before)}&&document.readyState==='complete'&&!!window.MishwarAccountContext`,'Application document must load');
  if(!gate)await waitFor("window.MishwarAccountContext.snapshot().status==='ready'",'Account bootstrap must finish');
  return evaluate('window.navigationFixtureMark');
 };
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
 await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"window.navigationFixtureMark=crypto.randomUUID();try{localStorage.setItem('mishwar-permissions-onboarded-v2','true')}catch{}"});
 const sections=quick?['settings','profile','search']:['settings','help','profile','wallet','trips','search','reservations','cases','readiness','referral','notifications'];
 const viewports=quick?[['desktop',1440,1000]]:[['desktop',1440,1000],['mobile',390,844],['short-mobile',390,640]];
 for(const [viewport,width,height]of viewports){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<701});
  for(const owner of quick?[null]:[null,'a']){
   const actor=owner?'signed-in':'guest';
   for(const section of sections){
    await record(viewport+'-'+actor+'-bootstrap-'+section,async row=>{
     const mark=await navigate(owner,true);await openSection(section,width);await wait(50);
     row.before=await viewState();expected(section,row.before);
     const liveBefore=fixtures.liveResponses;releaseAuth();
     await waitFor("window.MishwarAccountContext.snapshot().status==='ready'",'Delayed account reply must finish');
     const deadline=Date.now()+2000;while(fixtures.liveResponses<=liveBefore&&Date.now()<deadline)await wait(20);
     await wait(100);row.after=await viewState();
     assert.equal(row.after.documentMark,mark,'Navigation must not reload the document');
     expected(section,row.after,owner);
     await screenshot(row.name);
    });
    releaseAuth();releaseLive();
   }
   // Settled navigation is checked separately so a bootstrap failure does not hide it.
   await navigate(owner,false);
   for(const section of sections)await record(viewport+'-'+actor+'-live-refresh-'+section,async row=>{
    const mark=await evaluate('window.navigationFixtureMark');
    await openSection(section,width);await wait(50);row.before=await viewState();expected(section,row.before,owner);
    const before=fixtures.liveResponses;await evaluate('window.refreshMishwarTrip(true)');
    assert.ok(fixtures.liveResponses>before,'The real live read must receive a fixture response');
    await wait(50);row.after=await viewState();
    assert.equal(row.after.documentMark,mark,'Live refresh must not reload the document');expected(section,row.after,owner);
   });
   // This waits for the actual source interval instead of invoking a refresh helper.
   await record(viewport+'-'+actor+'-periodic-poll-settings',async row=>{
    await openSection('settings',width);const mark=await evaluate('window.navigationFixtureMark'),before=fixtures.liveResponses;
    fixtures.holdLive=true;
    const deadline=Date.now()+5000;while(!fixtures.liveReleases.length&&Date.now()<deadline)await wait(40);
    assert.ok(fixtures.liveReleases.length,'A real periodic live poll must start');
    row.pending=await viewState();expected('settings',row.pending);releaseLive();
    const finish=Date.now()+1500;while(fixtures.liveResponses<=before&&Date.now()<finish)await wait(20);
    await wait(70);row.after=await viewState();assert.equal(row.after.documentMark,mark);expected('settings',row.after);
   });
   releaseLive();
  }
 }
 await record('owner-change-clears-old-profile-and-wallet',async row=>{
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate('a',false);await openSection('profile',390);
  await waitFor("document.querySelector('#modal-content')?.innerText.includes('Navigation Rider Alpha')",'Owner A profile must appear');
  fixtures.owner='b';await evaluate('window.refreshMishwarRiderAccount()');await wait(100);
  assert.equal(await evaluate("document.body.innerText.includes('Navigation Rider Alpha')"),false,'Changing owner must remove the old profile');
  await openSection('profile',390);
  await waitFor("document.querySelector('#modal-content')?.innerText.includes('Navigation Rider Beta')",'Owner B profile must appear');
  await openSection('wallet',390);
  assert.ok(await evaluate("document.querySelector('#modal-content').innerText.includes('232.00')"),'Owner B wallet must use B fixture balance');
  assert.equal(await evaluate("document.querySelector('#modal-content').innerText.includes('121.00')"),false,'Owner A balance must not leak');
  row.after=await viewState();await screenshot(row.name);
 });
 await record('runtime-and-assets',async()=>{
  assert.deepEqual(fixtures.exceptions,[],'No uncaught JavaScript exception');
  assert.deepEqual([...new Set(fixtures.missing)].filter(path=>path!=='/favicon.ico'),[],'All local entry-point assets must exist');
  assert.ok(fixtures.requests.every(request=>request.path!=='/api/live'||readActions.has(request.action)),'Navigation must not issue a financial or booking mutation');
 });
 const passed=fixtures.results.filter(result=>result.passed).length,failed=fixtures.results.length-passed;
 fixtures.summary={status:failed?'FAIL':'PASS',passed,failed,total:fixtures.results.length,quick,root,artifact,externalNetwork:'blocked',productionVerified:false};
 console.log(JSON.stringify(fixtures.summary,null,2));
 process.exitCode=expectFailure?(failed?0:1):(failed?1:0);
}finally{
 clearTimeout(timeout);releaseAuth();releaseLive();
 writeFileSync(join(artifact,'observations.json'),JSON.stringify(fixtures,null,2));
 ws?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
