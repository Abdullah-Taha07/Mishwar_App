import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {startReceiptServer} from './fixtures/rider-receipt-server.mjs';

// RDEV-002: receipt UI only. Data setup is an explicit synthetic fixture; actual
// login/history/receipt requests use the rider gateway, shared Worker and SQLite.
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const output=resolve(option('--output','.local-verification/rdev002-receipts-'+Date.now()));
const publicRoot=resolve(option('--public','apps/rider/dist/public'));
mkdirSync(join(output,'screens'),{recursive:true});mkdirSync(join(output,'downloads'),{recursive:true});
assert.ok(existsSync(join(publicRoot,'trip-receipt.js')),'Build the receipt-enabled rider before browser acceptance');
const nativeFetch=globalThis.fetch,lab=await startReceiptServer({publicRoot});
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(edge,'Edge or Chromium is required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-rdev002-'));
const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const observations={phase:'RDEV-002',results:[],exceptions:[],externalBlocked:[],downloads:[],fixture:lab.fixtureDisclosure,limitations:['Headless desktop Edge with mobile viewport; no physical phone, printer, Safari or native sharing-device claim.','Synthetic persisted trips/accounts and provider responses; real local gateway/Worker/session/history/receipt APIs.','Download and print fault injection affects browser APIs only; no production/provider failure is induced.','PDF contains rasterized Arabic text, not selectable text. Independent Windows.Data.Pdf parser/renderer is used when available.']};
let ws,command,evaluate,scenario='setup',receiptFailures=0;
const deadline=setTimeout(()=>{browser.kill();console.error('RDEV002_BROWSER_TIMEOUT');process.exit(2)},240000);deadline.unref();
try{
 let port;for(let n=0;n<100;n++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break}catch{}await wait(100)}
 assert.match(port||'',/^\d+$/,'Local browser CDP launch failed');
 const targets=await nativeFetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((done,fail)=>{ws.onopen=done;ws.onerror=fail;setTimeout(()=>fail(Error('CDP connection deadline')),8000).unref()});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((done,fail)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout: '+method))},20000);pending.set(id,{done:r=>{clearTimeout(timer);done(r)},fail:e=>{clearTimeout(timer);fail(e)}});ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.fail(Error(JSON.stringify(message.error))):p?.done(message.result);return}
  if(message.method==='Runtime.exceptionThrown')observations.exceptions.push({scenario,text:message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text});
  if(message.method==='Browser.downloadWillBegin')observations.downloads.push({...message.params,scenario,state:'started'});
  if(message.method==='Browser.downloadProgress'){const d=observations.downloads.find(d=>d.guid===message.params.guid);if(d)Object.assign(d,message.params)}
  if(message.method==='Fetch.requestPaused'){
   const paused=message.params,url=new URL(paused.request.url),complete=(mime,text,status=200)=>command('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:mime}],body:Buffer.from(text).toString('base64')});
   if(url.origin===lab.origin){
    let body={};try{body=JSON.parse(paused.request.postData||'{}')}catch{}
    if(body.action==='live_receipt'&&receiptFailures>0){receiptFailures--;void complete('application/json','{"error":"فشل تحميل تجريبي معزول"}',503).catch(()=>{})}
    else void command('Fetch.continueRequest',{requestId:paused.requestId}).catch(()=>{});
   }else if(url.hostname==='fonts.googleapis.com'&&url.pathname==='/css2')void complete('text/css','/* Deterministic local system fonts. */').catch(()=>{});
   else if(url.hostname==='tile.openstreetmap.org'&&url.pathname.endsWith('.png'))void complete('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0ec"/></svg>').catch(()=>{});
   else if(['data:','blob:','about:'].includes(url.protocol))void command('Fetch.continueRequest',{requestId:paused.requestId}).catch(()=>{});
   else{observations.externalBlocked.push({scenario,origin:url.origin,path:url.pathname});void command('Fetch.failRequest',{requestId:paused.requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
  }
 };
 evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const until=async(expression,label)=>{const end=Date.now()+18000;while(Date.now()<end){if(await evaluate(expression))return;await wait(80)}throw Error(label)};
 const settle=()=>evaluate(`Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))`);
 const target=s=>`[...document.querySelectorAll(${JSON.stringify(s)})].find(e=>e.checkVisibility({visibilityProperty:true})&&e.getClientRects().length)`;
 const click=async(selector,{twice=false}={})=>{
  await settle();await evaluate(`(${target(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await wait(40);
  const p=await evaluate(`(()=>{const e=${target(selector)};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,clickable:!e.disabled&&!!h&&(e===h||e.contains(h)),hit:h?.outerHTML.slice(0,150)}})()`);
  assert.ok(p?.clickable,'Blocked target '+selector+': '+JSON.stringify(p));
  for(let n=0;n<(twice?2:1);n++){await command('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:n+1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:n+1})}
  await wait(60);await settle();
 };
 const fill=async(selector,value)=>{await click(selector);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.insertText',{text:String(value)})};
 const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'screens',name+'.png'),Buffer.from(r.data,'base64'))};
 const run=async(name,fn)=>{scenario=name;const r={name,passed:false};observations.results.push(r);try{await fn(r);r.passed=true;console.log('PASS '+name)}catch(e){r.error=e.message;r.dom=await evaluate('document.body.innerText.slice(0,16000)').catch(()=>'');await shot(name+'-FAIL').catch(()=>{});throw e}};
 const login=async account=>{
  await click('.mobile-nav [data-open-menu]');await click('#drawer [data-section="profile"]');
  await until("!!document.querySelector('#rider-password-form')",'Real login form opens');
  await fill('#rider-password-form [name="phone"]',account.phone);await fill('#rider-password-form [name="password"]',account.password);await click('#rider-password-form [type="submit"]');
  await until("!!document.querySelector('.profile-state.verified')",'Real login establishes this verified fixture account');await click('#modal [data-action="close"]');
 };
 const openHistory=async()=>{await click('.mobile-nav [data-page="trips"]');await until("!!document.querySelector('.journey-card')",'Real history loads')};
 const openReceipt=async trip=>{await click(`[data-journey="${trip.id}"] summary`);await click(`[data-journey="${trip.id}"] [data-launch="receipt"]`);await until("!!document.querySelector('#launch-dialog .trip-receipt')",'Receipt must load')};
 const api=body=>evaluate(`fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,cache:r.headers.get('cache-control'),body:await r.json()}))`);
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');
 await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(output,'downloads'),eventsEnabled:true});
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await command('Page.navigate',{url:lab.origin+'/?rdev002=receipts'});
 await until("document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'",'Initial session resolves');
 const before=lab.counts(),first=lab.fixtures[0],second=lab.fixtures[1],cancelled=lab.fixtures[2],other=lab.fixtures[3];
 await run('completed-receipt-data-and-rtl',async r=>{
  await login(lab.accounts[0]);await openHistory();await openReceipt(first);
  const v=await evaluate(`(()=>{const e=document.querySelector('#launch-dialog .trip-receipt');return{text:e.innerText,dir:getComputedStyle(e).direction,html:e.outerHTML}})()`);
  assert.equal(v.dir,'rtl');assert.ok(v.text.includes(first.id));assert.ok(v.text.includes(first.pickup));assert.ok(v.text.includes(first.destination));assert.match(v.text,/45[.٫]00/);assert.match(v.text,/نقد/);assert.match(v.text,/ليس.*فاتورة|ليست.*فاتورة/);
  assert.ok(!v.text.includes(other.pickup));assert.ok(!v.html.includes('<script'));
  r.data=v;await shot('receipt-arabic-rtl');
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate("document.querySelector('#launch-dialog').scrollWidth<=document.querySelector('#launch-dialog').clientWidth+1"),'Receipt fits 320px viewport');
  await shot('receipt-arabic-320');await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 });
 await run('download-pdf-opens-and-renders',async r=>{
  const calls=lab.audit.requests.filter(x=>x.action==='live_receipt').length;
  await click('[data-receipt-download]',{twice:true});
  await until("document.querySelector('[data-receipt-status]')?.textContent.includes('تنزيل')",'Download reports initiation');
  const untilDownload=Date.now()+20000;while(Date.now()<untilDownload&&!observations.downloads.some(d=>d.state==='completed'))await wait(100);
  const downloads=observations.downloads.filter(d=>d.state==='completed');assert.equal(downloads.length,1,'Repeated click starts a single download while busy');
  const path=join(output,'downloads',downloads[0].suggestedFilename);assert.ok(existsSync(path),'Actual download file exists');
  const bytes=readFileSync(path),text=bytes.toString('latin1');assert.ok(bytes.subarray(0,8).toString().startsWith('%PDF-1.'));assert.match(text,/%%EOF\s*$/);assert.match(text,/\/Type\s*\/Catalog/);assert.match(text,/\/Type\s*\/Pages/);assert.match(text,/\/Subtype\s*\/Image/);assert.match(text,/\/Filter\s*\/DCTDecode/);
  const start=Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);assert.ok(Number.isSafeInteger(start)&&text.slice(start,start+4)==='xref','PDF xref offset targets a real table');
  assert.equal(lab.audit.requests.filter(x=>x.action==='live_receipt').length,calls,'PDF generation does not repeat receipt or financial API');
  r.pdf={path,bytes:bytes.length,filename:downloads[0].suggestedFilename};
  if(process.platform==='win32'){
   const directory=join(output,'pdf-render');mkdirSync(directory);
   const verify=spawnSync('powershell',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/fixtures/render-receipt-pdf.ps1'),'-InputPath',path,'-OutputDirectory',directory],{encoding:'utf8',windowsHide:true,timeout:30000});
   assert.equal(verify.status,0,'Independent Windows PDF parser/renderer: '+verify.stderr);r.pdf.renderer=JSON.parse(verify.stdout.trim());assert.equal(r.pdf.renderer.opened,true);assert.ok(r.pdf.renderer.pageCount>=1);
  }else throw Error('Independent PDF renderer not configured on this platform');
 });
 await run('print-receipt-only',async r=>{
  // Inspect the actual print document. Headless acceptance cannot operate a
  // physical printer or assert that the user saved a print-dialog document.
  await evaluate("window.__receiptPrints=[];window.__originalAppend=document.body.append;document.body.append=function(...nodes){for(const frame of nodes)if(frame?.tagName==='IFRAME'){const loaded=frame.onload;frame.onload=function(event){frame.contentWindow.print=()=>window.__receiptPrints.push({html:frame.contentDocument.documentElement.outerHTML,text:frame.contentDocument.body.innerText});return loaded?.call(frame,event)}}return window.__originalAppend.apply(this,nodes)};");
  await click('[data-receipt-print]');
  await wait(500);r.iframes=await evaluate("[...document.querySelectorAll('iframe')].map(f=>({title:f.title,text:f.contentDocument?.body?.innerText||'',html:f.contentDocument?.documentElement?.outerHTML||''}))");
  r.topPrints=await evaluate('window.__receiptPrints');
  // The helper may use an isolated iframe or top-level print styles. Both must
  // retain the correct receipt data and explicitly exclude the rest of the UI.
  assert.ok(r.iframes.some(f=>f.text.includes(first.id))||r.topPrints.some(f=>f.text.includes(first.id)),'Print uses current receipt document');
  assert.ok(r.topPrints.some(f=>!f.html.includes('mobile-nav')&&!f.html.includes('data-receipt-download')),'Print excludes navigation and receipt action buttons');
  await evaluate('document.body.append=window.__originalAppend');
 });
 await run('share-fallback-download',async r=>{
  await evaluate("Object.defineProperty(navigator,'share',{value:undefined,configurable:true});Object.defineProperty(navigator,'canShare',{value:undefined,configurable:true})");
  const count=observations.downloads.length;await click('[data-receipt-share]');
  const end=Date.now()+20000;while(Date.now()<end&&observations.downloads.filter(d=>d.state==='completed').length<=count)await wait(100);
  assert.equal(observations.downloads.filter(d=>d.state==='completed').length,count+1);r.fallback='actual PDF download when Web Share files unavailable';
 });
 await run('share-file-capability-and-cancellation',async r=>{
  // Web Share is absent on headless desktop. This explicitly declared browser
  // API fixture verifies file arguments/cancel handling, not a physical device.
  await evaluate("window.__receiptShares=[];Object.defineProperty(navigator,'canShare',{value:data=>data.files?.length===1&&data.files[0].type==='application/pdf',configurable:true});Object.defineProperty(navigator,'share',{value:async data=>{const f=data.files[0];window.__receiptShares.push({name:f.name,type:f.type,size:f.size,header:await f.slice(0,8).text()})},configurable:true})");
  const downloads=observations.downloads.length;await click('[data-receipt-share]');
  await until("document.querySelector('[data-receipt-status]')?.textContent.includes('اكتملت')",'Supported share API fixture receives PDF file');
  r.apiFixture=await evaluate('window.__receiptShares');assert.equal(r.apiFixture.length,1);assert.equal(r.apiFixture[0].type,'application/pdf');assert.ok(r.apiFixture[0].size>1000);assert.ok(r.apiFixture[0].header.startsWith('%PDF-1.'));assert.equal(observations.downloads.length,downloads);
  await evaluate("Object.defineProperty(navigator,'share',{value:async()=>{throw new DOMException('Synthetic user cancellation','AbortError')},configurable:true})");
  await click('[data-receipt-share]');await until("document.querySelector('[data-receipt-status]')?.textContent.includes('أُلغيت')",'Share cancellation is explicit and retryable');
  assert.equal(observations.downloads.length,downloads,'Cancelling native sharing does not start an unsolicited fallback download');
  assert.ok(await evaluate("!!document.querySelector('#launch-dialog .trip-receipt')&&!document.querySelector('[data-receipt-share]').disabled"));
 });
 await run('download-failure-retains-receipt-and-retries',async r=>{
  await evaluate("window.__receiptCreateUrl=URL.createObjectURL;URL.createObjectURL=()=>{throw Error('Synthetic isolated download failure')}");
  await click('[data-receipt-download]');
  await until("!!document.querySelector('#launch-dialog .trip-receipt')&&!document.querySelector('[data-receipt-download]').disabled",'Failed download retains data and restores controls');
  assert.ok(await evaluate(`document.querySelector('#launch-dialog .trip-receipt').innerText.includes(${JSON.stringify(first.pickup)})`));
  r.status=await evaluate("document.querySelector('[data-receipt-status]')?.textContent||''");assert.ok(r.status.length);
  await evaluate('URL.createObjectURL=window.__receiptCreateUrl');
  const count=observations.downloads.length;await click('[data-receipt-download]');const end=Date.now()+20000;while(Date.now()<end&&observations.downloads.filter(d=>d.state==='completed').length<=count)await wait(100);assert.equal(observations.downloads.filter(d=>d.state==='completed').length,count+1);
 });
 await run('receipt-load-failure-and-retry',async r=>{
  await click('#launch-dialog [data-launch-back]');await click(`[data-journey="${second.id}"] summary`);receiptFailures=1;await click(`[data-journey="${second.id}"] [data-launch="receipt"]`);
  await until("!!document.querySelector('[data-receipt-retry]')",'Load failure offers retry');assert.equal(await evaluate("!!document.querySelector('#launch-dialog .trip-receipt')"),false);
  await click('[data-receipt-retry]');await until("!!document.querySelector('#launch-dialog .trip-receipt')",'Retry retrieves the actual second trip');
  r.text=await evaluate("document.querySelector('#launch-dialog .trip-receipt').innerText");assert.ok(r.text.includes(second.id));assert.ok(r.text.includes(second.pickup));assert.match(r.text,/بطاقة/);assert.ok(!r.text.includes(first.pickup));
 });
 await run('incomplete-and-foreign-trip-rejected',async r=>{
  const a=await api({action:'live_receipt',tripId:cancelled.id}),b=await api({action:'live_receipt',tripId:other.id});
  assert.ok(a.status>=400);assert.ok(b.status>=400);assert.equal(a.body.receipt,undefined);assert.equal(b.body.receipt,undefined);assert.ok(!JSON.stringify(b.body).includes(other.pickup));assert.match(a.cache,/no-store/);assert.match(b.cache,/no-store/);r.statuses={incomplete:a.status,foreign:b.status};
  assert.equal(await evaluate(`!!document.querySelector('[data-journey="${cancelled.id}"] [data-launch="receipt"]')`),false,'Cancelled trip offers no receipt UI');
 });
 await run('account-switch-clears-receipt-and-denies-former-trip',async r=>{
  // Simulate logout in another tab through the real API while the receipt is
  // still visible, then run the application's normal session refresh.
  const logout=await evaluate("fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>({status:r.status}))");assert.equal(logout.status,200);
  await evaluate('window.refreshMishwarRiderAccount()');
  await until("window.MishwarAccountContext.snapshot().status==='ready'&&!window.MishwarAccountContext.snapshot().authenticated",'Logout clears real server session');
  assert.equal(await evaluate("!!document.querySelector('#launch-dialog .trip-receipt')"),false);
  r.resetMethod='Real logout API in another-tab simulation while receipt open, followed by normal session refresh';
  if(await evaluate("!!document.querySelector('#modal[open]')"))await click('#modal [data-action="close"]');
  await login(lab.accounts[1]);await openHistory();
  assert.equal(await evaluate(`!!document.querySelector('[data-journey="${first.id}"]')`),false,'Former account trips absent');
  await openReceipt(other);r.text=await evaluate("document.querySelector('#launch-dialog .trip-receipt').innerText");assert.ok(r.text.includes(other.pickup));assert.match(r.text,/المحفظة/);assert.ok(!r.text.includes(first.pickup));
  const denied=await api({action:'live_receipt',tripId:first.id});assert.ok(denied.status>=400);assert.equal(denied.body.receipt,undefined);assert.ok(!JSON.stringify(denied.body).includes(first.pickup));await shot('second-account-receipt');
 });
 await run('no-duplicate-receipts-or-financial-side-effects',async r=>{
  r.before=before;r.after=lab.counts();assert.equal(r.after.trips,before.trips);assert.equal(r.after.settlements,before.settlements);assert.equal(r.after.walletEntries,before.walletEntries);assert.equal(r.after.receipts,3,'One row for each completed trip viewed, no row for cancelled/denied trips');assert.equal(lab.env.db.prepare('SELECT COUNT(*) n FROM trip_receipts WHERE trip_id=?').get(cancelled.id).n,0);assert.equal(lab.audit.requests.filter(x=>x.action==='live_book').length,0);
 });
 observations.audit=lab.audit;assert.equal(observations.externalBlocked.length,0);assert.equal(observations.exceptions.length,0);assert.equal(lab.audit.errors.length,0);
}catch(error){observations.fatalError=error.message;console.error('RDEV002_BROWSER_FAIL: '+error.message)}finally{
 clearTimeout(deadline);ws?.close();browser.kill();await lab.close();
 observations.completedAt=new Date().toISOString();const failed=observations.results.filter(r=>!r.passed).length;
 const summary={phase:'RDEV-002',status:failed||observations.fatalError?'FAIL':'PASS',total:observations.results.length,passed:observations.results.filter(r=>r.passed).length,failed,fatalError:observations.fatalError||null,output,limitations:observations.limitations};
 writeFileSync(join(output,'observations.json'),JSON.stringify(observations,null,2)+'\n');writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));if(summary.status!=='PASS')process.exitCode=1;
}
