import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// UI laboratory: all data are synthetic, every connection is loopback or a
// resource fulfilled in-process. This does not verify real services or devices.
const args=process.argv.slice(2),value=(flag,fallback)=>{const n=args.indexOf(flag);return n<0?fallback:args[n+1]};
const root=resolve(args[0]&&!args[0].startsWith('--')?args[0]:'apps/rider/dist/public');
const phase=value('--phase','after'),baseline=value('--baseline',null);
const only=value('--only',null),enabled=name=>!only||new RegExp(only).test(name);
assert.ok(['before','after'].includes(phase),'--phase must be before or after');
const artifact=resolve(value('--output','.local-verification/rider-012-browser/'+phase+'-'+Date.now()));
mkdirSync(join(artifact,'screens'),{recursive:true});
assert.ok(existsSync(join(root,'index.html')),'Build or supply a preserved rider public directory first');
const fixture={signed:true,active:null,requests:[],exceptions:[],consoleErrors:[],missing:[],unexpectedExternal:[],results:[],screens:[],audits:[],performance:[],visualDiffs:[],bookings:0};
const accountKey='c'.repeat(64),at='2026-11-20T09:00:00.000Z';
const point=(name,lat=24.7136,lng=46.6753)=>({name,area:'Synthetic local fixture',lat,lng});
const pickup=point('نقطة الانطلاق التجريبية'),destination=point('الوجهة التجريبية',24.721,46.684);
const route={distanceMeters:7200,durationSeconds:900,trafficAware:false,provider:'OSRM',demoProvider:false,geometry:{type:'LineString',coordinates:[[pickup.lng,pickup.lat],[46.68,24.718],[destination.lng,destination.lat]]}};
const profile={name:'راكب التجربة',phone:'+966500000011',email:'readiness@example.test'};
const payments={cash:true,wallet:true,card:false,applepay:false};
const completed={id:'fixture-completed-ride',status:'completed',rider_id:'rider:fixture',driver_id:'fixture-captain',pickup,destination,fare_halalas:1450,discount_halalas:0,cash_due_halalas:1450,method:'cash',payment_status:'cash_collected',driver_name:'كابتن التجربة',driver_make:'مركبة',driver_model:'تجريبية',driver_plate:'TEST',category:'economy',created_at:at,updated_at:at,route,ratings:{byRider:null,byCaptain:{score:5,comment:'Synthetic fixture',at}},options:{stops:[]}};
const session=()=>({guest:!fixture.signed,verified:fixture.signed,accountKey:fixture.signed?accountKey:null,profile:fixture.signed?profile:null,trip:fixture.active&&!['completed','cancelled'].includes(fixture.active.status)?fixture.active:null,recentTrip:fixture.active&&['completed','cancelled'].includes(fixture.active.status)?fixture.active:null,ratings:{average:5,receivedCount:1,givenCount:0},wallet:{balance:12500,entries:[{amount_halalas:12500,kind:'topup',reference:'local-topup',created_at:at}]},payments});
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  if(path.startsWith('/api/')){
   let raw='';for await(const part of req){raw+=part;if(raw.length>32768){json(res,{error:'Fixture request too large'},413);return;}}
   let b={};try{b=raw?JSON.parse(raw):{}}catch{}
   fixture.requests.push({path,action:b.action||null,method:req.method});
   if(path==='/api/auth/session'){json(res,{authenticated:fixture.signed,phoneVerified:fixture.signed,accountKey:fixture.signed?accountKey:null,profile:fixture.signed?profile:null});return;}
   if(path==='/api/auth/logout'){fixture.signed=false;json(res,{ok:true});return;}
   if(path==='/api/map-config'){json(res,{searchConfigured:true,searchProvider:'TomTom',browserKey:null});return;}
   if(path==='/api/places'||path==='/api/places/reverse'){json(res,{provider:'TomTom',features:[{type:'Feature',geometry:{type:'Point',coordinates:[destination.lng,destination.lat]},properties:{name:'نتيجة بحث تجريبية',city:'الرياض',country:'السعودية'}}]});return;}
   if(path==='/api/service-status'){json(res,{features:[]});return;}
   if(path==='/api/background'){json(res,b.action==='ack'?{ok:true}:{configured:false,notifications:[{id:'fixture-notification',title:'تحديث مشوار',body:'إشعار محلي لاختبار الواجهة',created_at:at}]});return;}
   if(['live_session','live_watch'].includes(b.action)){json(res,session());return;}
   if(['live_quote','estimate'].includes(b.action)){
    const category=b.category||'economy',amount={economy:1450,comfort:1958,vip:2683}[category]||1450;
    await new Promise(r=>setTimeout(r,80));
    json(res,{id:'fixture-quote-'+category,route,...route,category,minimum:1000,fare:amount,payable:amount,discount:0,custom:false,expiresAt:'2030-01-01T00:00:00.000Z',offers:[['economy',1450],['comfort',1958],['vip',2683]].map(([id,fare])=>({category:id,fare,payable:fare,discount:0})),breakdown:{baseHalalas:300,distanceHalalas:648,timeHalalas:150,minimumAdjustmentHalalas:0},smartPickups:[]});return;
   }
   if(b.action==='live_book'){
    fixture.bookings++;await new Promise(r=>setTimeout(r,150));fixture.active={...completed,id:'fixture-new-ride',status:'matching',payment_status:'cash_due',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),driver_id:null};json(res,{trip:fixture.active},201);return;
   }
   if(b.action==='live_history'){json(res,{trips:[completed],ratings:{average:5,receivedCount:1,givenCount:0},nextOffset:null});return;}
   if(b.action==='live_capabilities'){json(res,{features:[]});return;}
   if(b.action==='live_realtime_token'){json(res,{error:'Realtime intentionally disabled in local UI fixture'},503);return;}
   if(b.action==='live_reservations'){json(res,{items:[],schedulerConfigured:false});return;}
   if(['live_cases','live_contacts','live_refunds'].includes(b.action)){json(res,{items:[]});return;}
   if(b.action==='live_referral'){json(res,{enabled:false,notice:'Local fixture',code:'FIXTURE',stats:{invited:0,rewards:0}});return;}
   json(res,{error:'This operation is intentionally unavailable in the UI-only fixture'},503);return;
  }
  const file=resolve(root,'.'+(path==='/'?'/index.html':path)),inside=relative(root,file);
  if(inside.startsWith('..')||isAbsolute(inside))throw Error('Outside fixture root');
  const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch{fixture.missing.push(new URL(req.url,'http://127.0.0.1').pathname);res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browserPath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(browserPath,'A Chromium browser is required');
const browserProfile=mkdtempSync(join(tmpdir(),'mishwar-rider-readiness-'));
const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+browserProfile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,command,evaluate;const wait=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>{browser.kill();console.error('Readiness browser deadline exceeded');process.exit(2)},300000);timeout.unref();
const record=async(name,fn)=>{if(!enabled(name))return;const row={name,passed:false};fixture.results.push(row);try{await fn(row);row.passed=true;console.log('PASS '+name);}catch(e){row.error=e.message;console.error('FAIL '+name+': '+e.message);try{const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifact,'screens','FAIL-'+name+'.png'),Buffer.from(shot.data,'base64'));await evaluate("document.querySelector('#modal')?.close();document.querySelector('#drawer')?.close();if(typeof closeAddressEditor==='function')closeAddressEditor();if(typeof state!=='undefined'){state.stage='home';state.destination=null;render()}");}catch{}}};
const observerScript=`try{localStorage.setItem('mishwar-permissions-onboarded-v2','true');localStorage.setItem('mishwar-location-follow','false');localStorage.setItem('mishwar-language',new URL(location.href).searchParams.get('language')==='en'?'en':'ar')}catch{}
 window.__readinessDocument=crypto.randomUUID();
 window.__readinessMetrics={lcp:[],shifts:[],events:[],frames:[]};
 for(const [type,key] of [['largest-contentful-paint','lcp'],['layout-shift','shifts'],['event','events']])try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__readinessMetrics[key].push(type==='layout-shift'?{value:e.value,startTime:e.startTime,hadRecentInput:e.hadRecentInput,sources:(e.sources||[]).map(s=>({node:s.node?.outerHTML?.slice(0,220),previous:{x:s.previousRect.x,y:s.previousRect.y,width:s.previousRect.width,height:s.previousRect.height},current:{x:s.currentRect.x,y:s.currentRect.y,width:s.currentRect.width,height:s.currentRect.height}}))}:type==='event'?{name:e.name,duration:e.duration,interactionId:e.interactionId,startTime:e.startTime}:{startTime:e.startTime,size:e.size,node:e.element?.outerHTML?.slice(0,220)})}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})})}catch{}
 let previous=0,count=0;function sample(t){if(previous)window.__readinessMetrics.frames.push(t-previous);previous=t;if(++count<90)requestAnimationFrame(sample)}requestAnimationFrame(sample);`;

function domAudit(){
 const activeDialog=document.querySelector('dialog[open]')||[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find(el=>!el.hidden&&getComputedStyle(el).display!=='none');
 const visible=el=>{if(activeDialog&&!activeDialog.contains(el))return false;if(typeof el.checkVisibility==='function'&&!el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))return false;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&![...p.children].find(c=>c.tagName==='SUMMARY')?.contains(el))return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[inert],[aria-hidden="true"]');};
 const name=el=>(el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||el.getAttribute('title')||el.innerText||el.textContent||el.querySelector('img')?.alt||el.querySelector('svg title')?.textContent||'').trim();
 const controls=[...document.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(visible);
 const small=controls.filter(el=>!el.matches('a')).map(el=>{const area=el.matches('input[type="checkbox"],input[type="radio"]')&&el.labels?.[0]?el.labels[0]:el;return {name:name(el).slice(0,80),tag:el.tagName,width:area.getBoundingClientRect().width,height:area.getBoundingClientRect().height};}).filter(r=>r.width<44||r.height<44);
 const unnamed=controls.filter(el=>el.matches('button,[role="button"]')&&!name(el)).map(el=>el.outerHTML.slice(0,200));
 const unlabelled=controls.filter(el=>el.matches('input:not([type="hidden"]),select,textarea')&&!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>({id:el.id,type:el.type,placeholder:el.getAttribute('placeholder')}));
 const centerOccluded=controls.filter(el=>el.matches('button,a[href]')&&!el.matches(':disabled')&&!el.closest('[aria-disabled="true"]')).map(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||y<0||x>innerWidth||y>innerHeight)return null;const hit=document.elementFromPoint(x,y);return hit&&(hit===el||el.contains(hit))?null:{name:name(el).slice(0,80),selector:el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+String(el.className||'').trim().replaceAll(' ','.'),hit:hit?.outerHTML.slice(0,150)};}).filter(Boolean);
 const englishArabicCandidates=[];
 if(document.documentElement.lang==='en'){
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let textNode;
  while(textNode=walker.nextNode()){
   const el=textNode.parentElement,value=textNode.nodeValue.trim();
   if(/[\u0600-\u06ff]/.test(value)&&visible(el)&&!el.closest('script,style,textarea,[data-no-translate],.leaflet-pane,.leaflet-control-attribution,.recent,.search-result-row'))englishArabicCandidates.push({text:value.slice(0,160),container:el.tagName.toLowerCase()+'.'+String(el.className||'').trim().replaceAll(' ','.'),classification:'Manual triage required: may include names, original addresses or branding.'});
  }
 }
 const parse=value=>{const n=value.match(/[\d.]+/g)?.map(Number);return n&&n.length>=3?[n[0],n[1],n[2],n[3]??1]:null;};
 const blend=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [0,1,2].map(i=>(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/(alpha||1)).concat(alpha);};
 function background(el){let c=[0,0,0,0],unknown=false;for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.backgroundImage!=='none')unknown=true;const b=parse(s.backgroundColor);if(b)c=blend(c,b);if(c[3]>=.999)break;}return {color:blend(c,[255,255,255,1]),unknown};}
 const luminance=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=[];
 for(const el of document.querySelectorAll('button,p,label,h1,h2,h3,strong,small,a,summary')){
  if(!visible(el)||el.matches(':disabled')||el.closest('[aria-disabled="true"]')||!el.textContent.trim()||el.closest('.leaflet-pane,.leaflet-control-attribution'))continue;
  const s=getComputedStyle(el),fg=parse(s.color),bg=background(el);if(!fg||bg.unknown||Number(s.opacity)<1||fg[3]<1)continue;
  const l=[luminance(fg),luminance(bg.color)],ratio=(Math.max(...l)+.05)/(Math.min(...l)+.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&parseInt(s.fontWeight)>=700),minimum=large?3:4.5;
  if(ratio+.01<minimum)contrast.push({text:el.textContent.trim().slice(0,70),ratio:Math.round(ratio*100)/100,minimum,color:s.color,background:bg.color.slice(0,3),tag:el.tagName});
 }
 return {viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,visibleControlCount:controls.length,unnamedButtons:unnamed,unlabelledInputs:unlabelled,touchTargetsBelow44:small,touchTargetsBelow24:small.filter(x=>x.width<24||x.height<24),centerOccluded,englishArabicCandidates:englishArabicCandidates.slice(0,50),contrastFailures:contrast.slice(0,60),contrastLimitations:'Computed solid backgrounds only; gradients/images/opacity and overlaps require manual inspection.',dir:document.documentElement.dir,lang:document.documentElement.lang,focused:document.activeElement?.outerHTML.slice(0,200)};
}

try{
 let port;for(let i=0;i<100;i++){try{port=readFileSync(join(browserProfile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch{}await wait(100);}
 assert.match(port||'',/^\d+$/,'Browser debugging endpoint must start');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)})).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;setTimeout(()=>j(Error('Debug socket deadline')),8000).unref();});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((done,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline '+method));},12000);pending.set(id,{done:v=>{clearTimeout(timer);done(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=event=>{
  const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.done(m.result);return;}
  if(m.method==='Runtime.exceptionThrown')fixture.exceptions.push(m.params.exceptionDetails);
  else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')fixture.consoleErrors.push(m.params.args.map(x=>x.value||x.description||'').join(' '));
  else if(m.method==='Fetch.requestPaused'){
   const r=m.params,u=new URL(r.request.url);
   if(u.origin===origin){void command('Fetch.continueRequest',{requestId:r.requestId}).catch(()=>{});return;}
   if(u.hostname==='fonts.googleapis.com'&&u.pathname==='/css2'){void command('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/css'}],body:Buffer.from('/* Offline UI fixture uses system fonts. */').toString('base64')}).catch(()=>{});return;}
   if(u.hostname==='tile.openstreetmap.org'&&u.pathname.endsWith('.png')){const tile='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#edf0ec"/><rect x="18" y="18" width="72" height="64" rx="12" fill="#dce8db"/><rect x="162" y="166" width="77" height="70" rx="9" fill="#e2e9df"/><g fill="none" stroke="#d9dfda" stroke-width="16"><path d="M0 122H256M126 0V256"/></g><g fill="none" stroke="#fff" stroke-width="12"><path d="M0 122H256M126 0V256"/></g><g fill="none" stroke="#fff" stroke-width="6"><path d="M0 33H256M0 210H256M33 0V256M211 0V256"/></g></svg>';void command('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:Buffer.from(tile).toString('base64')}).catch(()=>{});return;}
   fixture.unexpectedExternal.push({origin:u.origin,path:u.pathname});void command('Fetch.failRequest',{requestId:r.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
  }
 };
 evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+': '+r.exceptionDetails.exception?.description);return r.result.value;};
 const until=async(expression,label)=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await evaluate(expression))return;await wait(70);}throw Error(label);};
 await command('Page.enable');await command('Runtime.enable');await command('Network.enable');await command('Accessibility.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});await command('Page.addScriptToEvaluateOnNewDocument',{source:observerScript});
 const navigate=async(language='ar')=>{fixture.active=null;const previous=await evaluate('window.__readinessDocument||null');await command('Page.navigate',{url:origin+'/?readiness='+Date.now()+'&language='+language});await until(`window.__readinessDocument!==${JSON.stringify(previous)}&&document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'&&typeof window.getMishwarBookingQuote==='function'`,'Rider bootstrap must finish in the new document');await wait(350);};
 const settle=()=>evaluate(`Promise.all(document.getAnimations().filter(a=>{const t=a.effect?.getComputedTiming();return t&&Number.isFinite(t.endTime)&&t.endTime<2000&&a.playState==='running'}).map(a=>a.finished.catch(()=>{})))`);
 const click=async selector=>{
  await settle();
  const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'})`;
  await evaluate(`(${expression})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);await wait(80);
  const p=await evaluate(`(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,clickable:!!h&&(h===e||e.contains(h)),hit:h?.outerHTML.slice(0,100)}})()`);
  assert.ok(p?.clickable,'Pointer target is blocked: '+selector+' '+JSON.stringify(p));
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await command('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await wait(80);await settle();
 };
 const key=async(key,code,virtual,modifiers=0)=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual,modifiers});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual,modifiers});};
 const close=async()=>{if(await evaluate("!document.querySelector('#search-sheet').hidden"))await click('[data-search-close]');if(await evaluate("document.querySelector('#modal').open"))await click('#modal [data-action="close"]');if(await evaluate("document.querySelector('#drawer').open"))await click('#drawer [data-feature="drawer-close"]');};
 const screenshot=async name=>{
  await wait(160);const captured=await command('Page.captureScreenshot',{format:'png'}),file=join(artifact,'screens',name+'.png');writeFileSync(file,Buffer.from(captured.data,'base64'));fixture.screens.push({name,path:file});
  const oldFile=baseline?join(resolve(baseline),'screens',name+'.png'):null;
  if(oldFile&&existsSync(oldFile)){
   const previous=readFileSync(oldFile).toString('base64');
   const diff=await evaluate(`(async()=>{const load=async(data)=>createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}));const a=await load(${JSON.stringify(previous)}),b=await load(${JSON.stringify(captured.data)});if(a.width!==b.width||a.height!==b.height)return {comparable:false,reason:'Image dimensions differ'};const c=document.createElement('canvas');c.width=a.width;c.height=a.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(a,0,0);const ad=x.getImageData(0,0,c.width,c.height);x.clearRect(0,0,c.width,c.height);x.drawImage(b,0,0);const bd=x.getImageData(0,0,c.width,c.height);let changed=0;for(let i=0;i<ad.data.length;i+=4){const difference=Math.max(Math.abs(ad.data[i]-bd.data[i]),Math.abs(ad.data[i+1]-bd.data[i+1]),Math.abs(ad.data[i+2]-bd.data[i+2]));if(difference>20){changed++;bd.data[i]=220;bd.data[i+1]=30;bd.data[i+2]=50;bd.data[i+3]=190;}else{bd.data[i]=bd.data[i+1]=bd.data[i+2]=255;bd.data[i+3]=255;}}x.putImageData(bd,0,0);return {comparable:true,width:c.width,height:c.height,changedPixels:changed,changedRatio:changed/(c.width*c.height),diffPng:c.toDataURL('image/png').split(',')[1]};})()`);
   if(diff.diffPng){writeFileSync(join(artifact,'screens',name+'-diff.png'),Buffer.from(diff.diffPng,'base64'));delete diff.diffPng;}fixture.visualDiffs.push({name,...diff,acceptance:'Changes are measured for review; intentional redesign is not rejected by a pixel-ratio threshold.'});
  }
 };
 const audit=async name=>{
  const a=await evaluate('('+domAudit.toString()+')()');a.name=name;
  const ax=await command('Accessibility.getFullAXTree');a.ax={unignoredNodes:ax.nodes.filter(n=>!n.ignored).length,unnamedInteractive:ax.nodes.filter(n=>!n.ignored&&['button','textbox','combobox'].includes(n.role?.value)&&!String(n.name?.value||'').trim()).map(n=>({role:n.role?.value,nodeId:n.nodeId})).slice(0,20)};
  fixture.audits.push(a);return a;
 };
 const openSection=async(section,width)=>{await close();if(width<701){await click('[data-open-menu]');await click('#drawer [data-section="'+section+'"]');}else await click('.rail [data-section="'+section+'"]');await wait(120);};
 for(const [device,width,height]of[['narrow',320,568],['mobile',390,844],['tablet',768,1024],['desktop',1440,1000]]){
  for(const language of ['ar','en']){
   const name=device+'-'+language;fixture.signed=true;await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<701});await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await navigate(language);await wait(100);
   await record(name+'-home',async row=>{row.audit=await audit(name+'-home');assert.equal(row.audit.dir,language==='ar'?'rtl':'ltr');assert.equal(row.audit.horizontalOverflow,false);await screenshot(name+'-home');});
   const metrics=await evaluate(`(()=>{const m=window.__readinessMetrics,p=performance.getEntriesByType('navigation')[0],shifts=m.shifts.filter(x=>!x.hadRecentInput),frames=m.frames.slice(5).sort((a,b)=>a-b);let cls=0,current=0,start=0,last=0;for(const e of shifts){if(!start||e.startTime-last>1000||e.startTime-start>5000){start=e.startTime;current=0}current+=e.value;last=e.startTime;cls=Math.max(cls,current)}return {lcpMs:m.lcp.at(-1)?.startTime??null,cls,clsRaw:shifts.reduce((n,x)=>n+x.value,0),layoutShifts:m.shifts,frameIntervalP95Ms:frames.length?frames[Math.floor(frames.length*.95)]:null,domContentLoadedMs:p?.domContentLoadedEventEnd??null,transferBytes:performance.getEntriesByType('resource').reduce((n,x)=>n+x.transferSize,0)}})()`);fixture.performance.push({name,...metrics,environment:'Headless Chromium, localhost, system-font/transparent-map fixtures; no real handset or field INP claim.'});
   await record(name+'-search',async row=>{row.entry=phase==='after'&&width<701?'.mw-destination-entry':'[data-action="search"],[data-address="destination"],.booking-sheet-handle';await click(row.entry);await until("!document.querySelector('#search-sheet').hidden",'Search opens from one pointer action');row.audit=await audit(name+'-search');await screenshot(name+'-search');assert.equal(row.audit.horizontalOverflow,false);await click('[data-search-close]');assert.equal(await evaluate("document.querySelector('#search-sheet').hidden"),true);});
   await record(name+'-car-selection',async row=>{
    await evaluate(`setPickup(${JSON.stringify(pickup)});choose(${JSON.stringify(destination)});setStage('select')`);await until("!!document.querySelector('[data-tier="+'"comfort"'+"]')&&!!document.querySelector('[data-action="+'"book"'+"]:not(:disabled)')",'Vehicle prices load');
    await click('[data-tier="comfort"]');await until("document.querySelector('[data-tier="+'"comfort"'+"]')?.getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-action="+'"book"'+"]').disabled",'Category change settles');
    row.audit=await audit(name+'-select');await screenshot(name+'-select');assert.equal(row.audit.horizontalOverflow,false);
    await evaluate("state.stage='home';state.destination=null;render()");
   });
   for(const section of ['wallet','trips','profile'])await record(name+'-'+section,async row=>{await openSection(section,width);assert.equal(await evaluate("document.querySelector('#modal').open"),true);row.audit=await audit(name+'-'+section);await screenshot(name+'-'+section);assert.equal(row.audit.horizontalOverflow,false);await close();});
   await record(name+'-notifications',async row=>{await click('#notifications-button');await until("document.querySelector('#modal').open",'Notifications opens');row.audit=await audit(name+'-notifications');await screenshot(name+'-notifications');await close();});
   Object.assign(fixture.performance.at(-1),await evaluate(`(()=>{const events=new Map();for(const e of window.__readinessMetrics.events)if(e.interactionId)events.set(e.interactionId,Math.max(events.get(e.interactionId)||0,e.duration));const durations=[...events.values()].sort((a,b)=>b-a);return {observedInteractionCount:durations.length,localInteractionDurationMaxMs:durations[0]??null,interactionDurationsMs:durations,interactionLimitations:'Sparse scripted local interactions; not a field INP measurement.'}})()`));
  }
 }
 await record('keyboard-search-focus-containment',async row=>{
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});fixture.signed=true;await navigate();await click('.mw-destination-entry,[data-address="destination"],.booking-sheet-handle');await until("!document.querySelector('#search-sheet').hidden",'Search opens');
  row.focused=[];for(let n=0;n<16;n++){await key('Tab','Tab',9);row.focused.push(await evaluate("({inside:!!document.activeElement?.closest('#search-sheet'),tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim().slice(0,60),outline:getComputedStyle(document.activeElement).outlineStyle})"));}
  row.focusEscaped=row.focused.some(f=>!f.inside);if(phase==='after')assert.equal(row.focusEscaped,false,'aria-modal search should contain keyboard focus');await key('Escape','Escape',27);row.escapeClosed=await evaluate("document.querySelector('#search-sheet').hidden");assert.equal(row.escapeClosed,true,'Escape should close search');
 });
 await record('search-contracted-visual-viewport',async row=>{
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});fixture.signed=true;await navigate();await click('.mw-destination-entry,[data-address="destination"],.booking-sheet-handle');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:360,deviceScaleFactor:1,mobile:true});await wait(180);
  row.audit=await audit('mobile-search-contracted-viewport');row.field=await evaluate(`(()=>{const e=document.querySelector('#search-destination'),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,visibleHeight:window.visualViewport?.height??innerHeight}})()`);
  await screenshot('mobile-search-contracted-viewport');assert.equal(row.audit.horizontalOverflow,false);assert.ok(row.field.top>=0&&row.field.bottom<=row.field.visibleHeight+1,'Destination input stays within the contracted viewport');await click('[data-search-close]');assert.equal(await evaluate("document.querySelector('#search-sheet').hidden"),true);
  row.method='CDP viewport contraction to 390×360; no claim to emulate a native keyboard or Safari.';await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 });
 await record('reduced-motion',async row=>{
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await navigate();await evaluate(`setPickup(${JSON.stringify(pickup)});choose(${JSON.stringify(destination)});setStage('select')`);await wait(300);
  row.motion=await evaluate(`(()=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width&&r.height};const seconds=s=>s.split(',').map(x=>parseFloat(x)*(x.trim().endsWith('ms')?.001:1));return [...document.querySelectorAll('body *')].filter(visible).map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,class:e.className?.baseVal??e.className,animation:s.animationName,animationDuration:s.animationDuration,transition:s.transitionDuration,longestSeconds:Math.max(...seconds(s.animationDuration),...seconds(s.transitionDuration))}}).filter(x=>x.longestSeconds>.016).slice(0,35)})()`);row.respected=row.motion.length===0;if(phase==='after')assert.equal(row.respected,true,'Reduced motion should remove long CSS movement');await screenshot('mobile-reduced-motion');
 });
 await record('text-zoom-200',async row=>{
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await navigate();await evaluate('showSettings()');
  row.fonts=await evaluate(`(()=>{const nodes=[...document.querySelectorAll('body *')].map(el=>({el,before:parseFloat(getComputedStyle(el).fontSize)}));for(const {el,before}of nodes)if(Number.isFinite(before)&&before>0)el.style.setProperty('font-size',before*2+'px','important');const target=document.querySelector('#modal p,#modal label,#modal button');return {method:'Synthetic computed text-only 2x resize; not native OS or browser zoom.',requestedScale:2,exampleAfter:target?getComputedStyle(target).fontSize:null,sampledBefore:nodes.find(n=>n.el===target)?.before??null}})()`);
  await wait(200);row.audit=await audit('mobile-text-200');await screenshot('mobile-text-200');assert.equal(row.audit.horizontalOverflow,false);
 });
 await record('guest-login-registration',async row=>{
  fixture.signed=false;await navigate();await evaluate('window.showRiderLogin()');await until("!!document.querySelector('#rider-password-form')",'Login form exists');row.loginAudit=await audit('mobile-login');await screenshot('mobile-login');await click('#switch-rider-auth');row.registerAudit=await audit('mobile-register');await screenshot('mobile-register');assert.equal(await evaluate("!!document.querySelector('#rider-password-form [name=name]')"),true);await close();
 });
 await record('local-cash-journey-single-book',async row=>{
  fixture.signed=true;await navigate();await evaluate(`setPickup(${JSON.stringify(pickup)});choose(${JSON.stringify(destination)});setStage('select')`);await until("!!document.querySelector('[data-action="+'"book"'+"]:not(:disabled)')",'Booking quote is ready');
  const position=await evaluate(`(()=>{const e=document.querySelector('[data-action="book"]');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const initial=fixture.bookings;
  for(let n=0;n<2;n++){await command('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'left',clickCount:1});}
  await until("state.stage==='matching'",'One booking reaches matching');assert.equal(fixture.bookings-initial,1,'Rapid repeated pointer input must create only one fixture booking');row.bookingRequests=fixture.bookings-initial;row.states=[];await screenshot('mobile-ar-matching');
  for(const status of ['arriving','riding','completed']){
   fixture.active={...fixture.active,status,driver_id:'fixture-captain',driver_name:completed.driver_name,driver_make:completed.driver_make,driver_model:completed.driver_model,driver_plate:'TEST',driverLocation:{lat:24.717,lng:46.679,accuracy:8,at:new Date().toISOString(),fresh:true},payment_status:status==='completed'?'cash_collected':'cash_due'};
   await evaluate('window.refreshMishwarTrip()');await until(`window.mishwarCurrentTripId===${JSON.stringify(fixture.active.id)}&&state.stage===${JSON.stringify(status==='completed'?'complete':status)}`,status+' ride stays current');await wait(180);row.states.push({status,audit:await audit('mobile-ar-'+status)});await screenshot('mobile-ar-'+status);
  }
  row.note='Server status transitions are synthetic loopback fixtures; no captain, payment provider or production system was used.';
 });
 if(args.includes('--touch'))await record('emulated-touch-sheet-drag',async row=>{
  row.trials=[];await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const sheet=()=>evaluate(`(()=>{const e=document.querySelector('.booking'),r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {height:r.height,parentHeight:p.height,top:r.top,bottom:r.bottom,expanded:document.querySelector('[data-ride-expand]')?.getAttribute('aria-expanded')}})()`);
  const gesture=async dy=>{
   await settle();const p=await evaluate(`(()=>{const e=document.querySelector('[data-ride-expand]'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:2,radiusY:2,force:.5}]});
   for(let n=1;n<=8;n++){await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y+dy*n/8,id:1,radiusX:2,radiusY:2,force:.5}]});await wait(18);}
   await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(300);await settle();
  };
  try{
   for(const reduced of [false,true]){
    fixture.signed=true;await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});await navigate();await evaluate(`setPickup(${JSON.stringify(pickup)});choose(${JSON.stringify(destination)});setStage('select')`);await until("!!document.querySelector('[data-action="+'"book"'+"]:not(:disabled)')",'Touch fixture quote is ready');await settle();
    const trial={reducedMotion:reduced,before:await sheet()};
    await gesture(180);trial.lowered=await sheet();assert.ok(trial.lowered.height<trial.before.height-30,'Downward emulated finger drag lowers the booking sheet');
    await screenshot('mobile-touch-'+(reduced?'reduced':'normal')+'-lowered');
    await gesture(-180);trial.raised=await sheet();assert.ok(trial.raised.height>trial.lowered.height+30,'Upward emulated finger drag raises the booking sheet');
    for(const state of [trial.lowered,trial.raised])assert.ok(state.height>=state.parentHeight*.4-4&&state.height<=state.parentHeight*.96+4,'Dragged sheet stays within its parent bounds');
    await screenshot('mobile-touch-'+(reduced?'reduced':'normal')+'-raised');
    await click('[data-ride-expand]');trial.afterButton=await sheet();assert.ok(Math.abs(trial.afterButton.height-trial.raised.height)>30,'Sheet button remains usable after dragging');
    if(trial.afterButton.height<trial.raised.height-30)await click('[data-ride-expand]');
    await click('[data-tier="comfort"]');await until("document.querySelector('[data-tier="+'"comfort"'+"]')?.getAttribute('aria-pressed')==='true'",'Vehicle controls remain usable after touch dragging');
    row.trials.push(trial);
   }
   assert.deepEqual(fixture.exceptions,[]);assert.deepEqual(fixture.unexpectedExternal,[]);row.scope='CDP emulated touch events only; not a physical handset, native keyboard or Safari test.';
  }finally{await command('Emulation.setTouchEmulationEnabled',{enabled:false});}
 });
 await record('no-external-or-duplicate-transaction-effects',async row=>{
  row.unexpectedExternal=fixture.unexpectedExternal;row.exceptionCount=fixture.exceptions.length;row.bookings=fixture.bookings;
  assert.deepEqual(fixture.unexpectedExternal,[]);assert.deepEqual(fixture.exceptions,[]);assert.ok(fixture.bookings<=1,'Only the explicitly tested synthetic booking may be created');assert.equal(fixture.requests.some(r=>['live_payment_init','live_payment_verify','live_recharge'].includes(r.action)),false,'No payment or wallet mutation is allowed in this UI fixture');
 });
 if(args.includes('--strict-a11y'))await record('automated-accessibility-basics',async row=>{
  row.failures=fixture.audits.flatMap(a=>[
   ...a.unlabelledInputs.map(item=>({screen:a.name,kind:'unlabelled-input',item})),
   ...a.ax.unnamedInteractive.map(item=>({screen:a.name,kind:'unnamed-AX-control',item})),
   ...a.touchTargetsBelow24.map(item=>({screen:a.name,kind:'target-below-24px',item})),
   ...a.contrastFailures.map(item=>({screen:a.name,kind:'solid-color-contrast',item})),
  ]);
  assert.deepEqual(row.failures,[],'The sampled automated accessibility contracts must pass; this is not full WCAG certification');
 });
}catch(error){fixture.results.push({name:'runner',passed:false,error:error.message});console.error(error.stack);}
finally{
 clearTimeout(timeout);const failed=fixture.results.filter(x=>!x.passed).length;
 const summary={phase,status:failed?'FAIL':'PASS',passed:fixture.results.length-failed,failed,total:fixture.results.length,artifact,root,baseline:baseline?resolve(baseline):null,only,network:'Loopback only; remote map tiles and fonts fulfilled in-process.',mapFixture:'Synthetic neutral SVG grid v1; not a real map or provider test.',textResize:'Synthetic computed text-only 2x resize; not native browser or OS zoom.',deviceScope:'Chromium viewport emulation only. No physical Android/iPhone or Safari claim.',accessibilityScope:'Automated DOM/AX/solid-color/keyboard checks, not full WCAG certification.',performanceScope:'LCP/CLS observations and limited EventTiming lab samples, not field INP.',commercialReady:false};
 writeFileSync(join(artifact,'observations.json'),JSON.stringify({...summary,...fixture},null,2)+'\n');writeFileSync(join(artifact,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));ws?.close();browser.kill();server.closeAllConnections();await new Promise(r=>server.close(r));if(failed)process.exitCode=1;
}
