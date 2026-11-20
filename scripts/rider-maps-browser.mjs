import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join,extname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

// RIDER-008: real browser UI and Leaflet image events, entirely local fixtures.
// Search/reverse APIs, Photon responses and TomTom tiles are simulated. This
// proves application behavior, not a live TomTom key, traffic feed or device GPS.
const args=process.argv.slice(2),root=resolve(args.find(a=>!a.startsWith('--'))||'apps/rider/dist/public');
const artifacts=resolve(args.find(a=>a.startsWith('--artifacts='))?.slice(12)||'.local-verification/rider-008-browser/'+Date.now());
mkdirSync(artifacts,{recursive:true});assert.ok(existsSync(join(root,'index.html')),'Build the rider before running RIDER-008 browser tests');
const state={tests:[],api:[],missing:[],blockedExternal:[],stubbedExternal:[],exceptions:[],consoleErrors:[],photonSearch:0,photonReverse:0,tomtomSearch:0,tomtomReverse:0,tomtomTileSuccess:0,tomtomTileFailures:0,heldPhotonReleased:0,canceledPhotonReplies:0,productionVerified:false,realTomTomVerified:false,physicalGpsVerified:false};
const fixture={tomtomTiles:'success',holdPhotonSearch:false,heldPhoton:[]};
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function places(provider,url){const reverse=url.pathname.endsWith('/reverse'),query=url.searchParams.get('q')||'address';return{provider,features:[{geometry:{type:'Point',coordinates:[Number(url.searchParams.get('lon'))||46.6753,Number(url.searchParams.get('lat'))||24.7136]},properties:{name:provider+' '+(reverse?'reverse address':query),city:'Riyadh',country:'Saudi Arabia'}}]};}
const readActions=new Set(['live_session','live_watch','live_history','live_capabilities','live_reservations','live_contacts','live_cases','live_referral','live_realtime_token','live_refunds']);
const guest=()=>({guest:true,verified:false,accountKey:null,trip:null,recentTrip:null,ratings:{average:0,receivedCount:0},wallet:{balance:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false}});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
 if(path.startsWith('/api/')){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000){json(res,{error:'Fixture request too large'},413);return;}}
  let body={};try{body=JSON.parse(raw||'{}')}catch{}
  state.api.push({path,method:req.method,action:body.action||null});
  if(path==='/api/auth/session'){json(res,{authenticated:false,phoneVerified:false,accountKey:null,profile:null});return;}
  if(path==='/api/map-config'){json(res,{searchConfigured:false,searchProvider:'Photon',provider:'OpenStreetMap',browserKey:null});return;}
  if(path==='/api/places'){state.tomtomSearch++;json(res,places('TomTom',url));return;}
  if(path==='/api/places/reverse'){state.tomtomReverse++;json(res,places('TomTom',url));return;}
  if(path==='/api/service-status'){json(res,{features:[],ready:false});return;}
  if(path==='/api/background'){json(res,{configured:false,notifications:[]});return;}
  if(path==='/api/live'&&readActions.has(body.action)){
   if(['live_session','live_watch'].includes(body.action)){json(res,guest());return;}
   if(body.action==='live_history'){json(res,{trips:[],ratings:{average:0,receivedCount:0},nextOffset:null});return;}
   if(body.action==='live_realtime_token'){json(res,{error:'Offline realtime intentionally disabled'},503);return;}
   json(res,{items:[],features:[],schedulerConfigured:false});return;
  }
  json(res,{error:'Maps fixture blocks quotes, booking, financial and unknown actions'},403);return;
 }
 try{
  const file=resolve(root,'.'+(path==='/'?'/index.html':path)),inside=relative(root,file);if(inside.startsWith('..')||isAbsolute(inside))throw Error('Outside fixture');
  const bytes=readFileSync(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes);
 }catch{state.missing.push(path);res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const executable=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(existsSync);
assert.ok(executable,'A local Chromium browser is required');
const profile=mkdtempSync(join(tmpdir(),'mishwar-maps-browser-'));
const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-extensions','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,command,evaluate;
const timeout=setTimeout(()=>{browser.kill();console.error('MAPS_BROWSER_TIMEOUT');process.exit(2)},150000);timeout.unref();
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64');
async function releasePhoton(){fixture.holdPhotonSearch=false;for(const pending of fixture.heldPhoton.splice(0)){
 state.heldPhotonReleased++;try{await command('Fetch.fulfillRequest',{requestId:pending.id,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:encode(places('Photon',pending.url))});}catch{state.canceledPhotonReplies++;}
}}
try{
 let port='';for(let i=0;i<100;i++){try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch(error){if(!['ENOENT','EBUSY','EACCES'].includes(error.code))throw error;}await wait(100);}
 assert.match(port,/^\d+$/,'Browser debugging endpoint must start');
 const tabs=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 ws=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise((done,reject)=>{ws.onopen=done;ws.onerror=reject;setTimeout(()=>reject(Error('CDP connection timeout')),5000).unref();});
 let sequence=0;const pending=new Map();
 command=(method,params={})=>new Promise((done,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);pending.set(id,{done:value=>{clearTimeout(timer);done(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry?.reject(Error(JSON.stringify(message.error))):entry?.done(message.result);}
  else if(message.method==='Runtime.exceptionThrown')state.exceptions.push(message.params.exceptionDetails);
  else if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')state.consoleErrors.push(message.params.args.map(a=>a.value||a.description||'').join(' '));
  else if(message.method==='Fetch.requestPaused'){
   const request=message.params,url=new URL(request.request.url),id=request.requestId;
   const fulfill=(body,type='application/json',status=200)=>{void command('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:type},{name:'Access-Control-Allow-Origin',value:'*'}],body}).catch(()=>{});};
   if(url.origin===origin){void command('Fetch.continueRequest',{requestId:id}).catch(()=>{});return;}
   if(url.hostname==='photon.komoot.io'&&['/api/','/reverse'].includes(url.pathname)){
    state.stubbedExternal.push({origin:url.origin,path:url.pathname,type:'Photon fixture'});
    if(url.pathname==='/reverse'){state.photonReverse++;fulfill(encode(places('Photon',url)));}
    else{state.photonSearch++;if(fixture.holdPhotonSearch)fixture.heldPhoton.push({id,url});else fulfill(encode(places('Photon',url)));}
   }else if(url.hostname==='tile.openstreetmap.org'&&/\.png$/.test(url.pathname)){
    state.stubbedExternal.push({origin:url.origin,type:'OSM tile fixture'});fulfill(image,'image/png');
   }else if(url.hostname==='api.tomtom.com'&&/^\/map\/1\/tile\/basic\/main\/\d+\/\d+\/\d+\.png$/.test(url.pathname)){
    if(fixture.tomtomTiles==='fail'){state.tomtomTileFailures++;fulfill(encode({error:'Synthetic tile quota or key failure'}),'application/json',403);}
    else{state.tomtomTileSuccess++;fulfill(image,'image/png');}
    state.stubbedExternal.push({origin:url.origin,type:'TomTom tile fixture',status:fixture.tomtomTiles==='fail'?403:200});
   }else if(url.hostname==='fonts.googleapis.com'&&url.pathname==='/css2'){
    state.stubbedExternal.push({origin:url.origin,type:'empty-font-stylesheet'});fulfill(Buffer.from('/* Offline fixture: system fonts. */').toString('base64'),'text/css');
   }else{
    state.blockedExternal.push({origin:url.origin,path:url.pathname});void command('Fetch.failRequest',{requestId:id,errorReason:'BlockedByClient'}).catch(()=>{});
   }
  }
 };
 evaluate=async expression=>{const reply=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(reply.exceptionDetails)throw Error(JSON.stringify(reply.exceptionDetails));return reply.result.value;};
 const until=async(expression,message,limit=8000)=>{const end=Date.now()+limit;while(Date.now()<end){if(await evaluate(expression))return;await wait(40);}throw Error(message);};
 const screenshot=async name=>{const shot=await command('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name.replace(/[^a-z0-9_-]/gi,'-')+'.png'),Buffer.from(shot.data,'base64'));};
 const click=async selector=>{
  await until(`!!document.querySelector(${JSON.stringify(selector)})`,'Missing '+selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);await wait(30);
  const target=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,w:r.width,h:r.height,clickable:!!h&&(h===e||e.contains(h)),hit:h?.outerHTML.slice(0,150)}})()`);
  assert.ok(target.w>0&&target.h>0&&target.clickable,'Pointer target is obstructed: '+selector+' '+JSON.stringify(target));
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y});await command('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
 };
 const search=async query=>{
  await evaluate("showSearch()");await until("!document.querySelector('#search-sheet').hidden","Search sheet must open");await click('#search-destination');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await command('Input.insertText',{text:query});await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 };
 const resultContains=name=>`[...document.querySelectorAll('[data-search-select]')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`;
 const navigate=async()=>{
  await releasePhoton();fixture.tomtomTiles='success';const previous=await evaluate('window.__mapsDocument');
  await command('Page.navigate',{url:origin+'/?maps='+Date.now()});
  await until(`window.__mapsDocument!==${JSON.stringify(previous)}&&document.readyState==='complete'&&window.MishwarAccountContext?.snapshot().status==='ready'&&!!document.querySelector('#locate')`,'The built rider document must finish bootstrap');
  await until("mapConfig.search==='https://photon.komoot.io/api/'",'Initial fixture provider must be Photon');await wait(60);
 };
 const configure=async browserKey=>evaluate(`applyMapProviderConfig({searchConfigured:true,searchProvider:'TomTom',provider:${JSON.stringify(browserKey?'TomTom':'OpenStreetMap')},browserKey:${JSON.stringify(browserKey||null)}})`);
 const record=async(name,fn)=>{const row={name,passed:false,kind:'real-Chromium-UI-with-synthetic-map-provider'};state.tests.push(row);try{await fn(row);row.passed=true;console.log('PASS '+name);}catch(error){row.error=error.message;console.error('FAIL '+name+': '+error.message);try{await screenshot('FAIL-'+name);}catch{}}finally{await releasePhoton();}};
 await command('Runtime.enable');await command('Page.enable');await command('Network.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await command('Page.addScriptToEvaluateOnNewDocument',{source:"window.__mapsDocument=crypto.randomUUID();try{localStorage.setItem('mishwar-permissions-onboarded-v2','true');localStorage.removeItem('mishwar-location-follow');sessionStorage.removeItem('mishwar-manual-pickup')}catch{}"});

 for(const [viewport,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<701});
  await record(viewport+'-provider-switch-search-reverse-and-live-attribution',async row=>{
   await navigate();
   const initial=await evaluate("reverseAddress({lat:24.7131,lng:46.6731}).then(p=>{setPickup(p);return p})");
   assert.equal(initial.name,'Photon reverse address');assert.equal(await evaluate("document.querySelector('[data-address=pickup]').value"),'Photon reverse address');
   const query='coffee '+viewport;await search(query);await until(resultContains('Photon '+query),'Initial Photon results must be visible');
   assert.match(await evaluate("document.querySelector('#search-sheet .search-source').textContent"),/Photon/);
   const photonBefore=state.photonSearch;await configure();
   await until("document.querySelector('#search-sheet .search-source')?.textContent.includes('TomTom')",'An open search sheet must update attribution');
   await until(resultContains('TomTom '+query),'The same query must be fetched from TomTom after provider switch');
   assert.equal(await evaluate(resultContains('Photon '+query)),false,'Old cached Photon results must be absent');assert.equal(state.photonSearch,photonBefore,'Switching provider must not send the replacement query to Photon');
   assert.ok(await evaluate("[...geoCache.keys()].every(k=>k.startsWith(location.origin+'/api/places|'))"),'Search cache must contain current-provider entries only');
   await click('[data-search-close]');
   const current=await evaluate("reverseAddress({lat:24.7131,lng:46.6731}).then(p=>{setPickup(p);return p})");
   assert.equal(current.name,'TomTom reverse address');assert.equal(current.lat,initial.lat);assert.equal(current.lng,initial.lng);
   assert.equal(await evaluate("document.querySelector('[data-address=pickup]').value"),'TomTom reverse address');
   const callsBefore=state.tomtomReverse;await evaluate('reverseAddress({lat:24.7131,lng:46.6731})');assert.equal(state.tomtomReverse,callsBefore,'The current-provider reverse cache may be reused');
   row.pickup=current;row.searchAttribution=await evaluate('window.mishwarMapSearchCredit()');await screenshot(row.name);
  });
 }
 await record('late-photon-search-response-cannot-replace-tomtom-results',async row=>{
  await navigate();fixture.holdPhotonSearch=true;await search('racecoffee');
  const end=Date.now()+5000;while(!fixture.heldPhoton.length&&Date.now()<end)await wait(30);assert.ok(fixture.heldPhoton.length,'A Photon response must actually be held');
  row.heldResponses=fixture.heldPhoton.length;await configure();await until(resultContains('TomTom racecoffee'),'Configured search must finish before releasing old responses');
  await releasePhoton();await wait(150);assert.equal(await evaluate(resultContains('Photon racecoffee')),false,'A superseded response cannot redraw the search sheet');
  assert.equal(await evaluate(resultContains('TomTom racecoffee')),true);assert.ok(await evaluate("[...geoCache.values()].flat().every(p=>!p.name.startsWith('Photon '))"),'An old result cannot repopulate the new cache');await screenshot(row.name);
 });
 await record('tomtom-tile-load-and-403-fallback-preserve-rider-marker',async row=>{
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate();
  await evaluate("setPickup({lat:24.7131,lng:46.6731,name:'Manual tile fixture pickup'})");
  await until("!!document.querySelector('.live-pin.pickup')",'The rider pickup marker must be rendered');const markerBefore=await evaluate('pickupMarker._leaflet_id');
  const successesBefore=state.tomtomTileSuccess;fixture.tomtomTiles='success';await configure('fake-public-browser-key-success');
  await until('commercialMapTiles&&liveMap.hasLayer(commercialMapTiles)&&!liveMap.hasLayer(baseMapTiles)','Real Leaflet tileload events must activate the simulated TomTom layer');
  assert.ok(state.tomtomTileSuccess>successesBefore,'The browser must receive a locally fulfilled TomTom tile image');assert.equal(await evaluate('pickupMarker._leaflet_id'),markerBefore);
  assert.ok(await evaluate("document.querySelector('.leaflet-control-attribution')?.textContent.includes('TomTom')"),'Visible tile attribution must name TomTom');
  assert.equal(await evaluate("document.querySelector('#map-load-error').hidden"),true);
  fixture.tomtomTiles='fail';const failuresBefore=state.tomtomTileFailures;await configure('fake-public-browser-key-error');
  await until("commercialMapTiles===null&&liveMap.hasLayer(baseMapTiles)&&document.querySelector('#map-load-error').hidden===false",'A real image failure must restore OSM and show the fallback message');
  assert.ok(state.tomtomTileFailures>failuresBefore,'The browser must actually receive a synthetic HTTP403 tile response');
  assert.equal(await evaluate('pickupMarker._leaflet_id'),markerBefore);assert.ok(await evaluate("!!document.querySelector('.live-pin.pickup')"),'Fallback must preserve the pickup marker');
  row.warning=await evaluate("document.querySelector('#map-load-error').textContent");assert.match(row.warning,/TomTom.*OpenStreetMap/);
  assert.ok(await evaluate("document.querySelector('.leaflet-control-attribution')?.textContent.includes('OpenStreetMap')"),'Visible fallback attribution must name OSM');
  await wait(150);assert.equal(await evaluate("document.querySelector('#map-load-error').hidden"),false,'Late image events must not hide the fallback notice');await screenshot(row.name);
 });
 await record('maps-runtime-and-no-unapproved-api-writes',async()=>{
  assert.deepEqual(state.exceptions,[],'No uncaught browser exception');assert.deepEqual([...new Set(state.missing)].filter(p=>p!=='/favicon.ico'),[],'All built rider assets must exist');
  assert.deepEqual(state.blockedExternal,[],'Only explicitly declared local provider fixtures may be requested');
  assert.ok(state.api.every(r=>r.path!=='/api/live'||readActions.has(r.action)),'Map changes must not create quotes, bookings or financial mutations');
  assert.ok(state.tomtomSearch>0&&state.tomtomReverse>0&&state.photonSearch>0&&state.photonReverse>0,'Both fixture providers must actually be exercised');
 });
 const passed=state.tests.filter(t=>t.passed).length,failed=state.tests.length-passed;
 state.summary={status:failed?'FAIL':'PASS',passed,failed,total:state.tests.length,root,artifacts,externalNetwork:'blocked; known maps and fonts fulfilled locally',productionVerified:false,realTomTomVerified:false,physicalGpsVerified:false};
 console.log(JSON.stringify(state.summary,null,2));process.exitCode=failed?1:0;
}finally{
 clearTimeout(timeout);if(command)await releasePhoton();writeFileSync(join(artifacts,'observations.json'),JSON.stringify(state,null,2)+'\n');
 ws?.close();browser.kill();server.closeAllConnections();await new Promise(done=>server.close(done));
}
