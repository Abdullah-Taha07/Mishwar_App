import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const A='a'.repeat(64),B='b'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function clock(){
  let now=Date.parse('2026-11-16T09:00:00Z'),sequence=0;
  const timers=new Map();
  const set=(fn,delay,interval=0)=>{const id=++sequence;timers.set(id,{fn,at:now+delay,interval});return id};
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  return {
    get now(){return now},Date:ClockDate,timers,
    setTimeout:(fn,delay=0)=>set(fn,delay),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>set(fn,delay,delay),clearInterval:id=>timers.delete(id),
    requestAnimationFrame:fn=>set(()=>fn(now),16),cancelAnimationFrame:id=>timers.delete(id),
    async advance(ms){const end=now+ms;let iterations=0;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next||next[1].at>end)break;assert.ok(++iterations<3000,'bounded fake timer work');const[id,timer]=next;now=timer.at;if(timer.interval)timer.at+=timer.interval;else timers.delete(id);timer.fn();await flush()}now=end;await flush()},
  };
}
function base(){
  const time=clock(),listeners=new Map(),elements=new Map(),markers=[],controls=[],pans=[];
  function node(selector){
    if(elements.has(selector))return elements.get(selector);
    const classes=new Set(),handlers=new Map();
    const value={selector,open:false,textContent:'',innerHTML:'',style:{},classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)},add(name){classes.add(name)},remove(name){classes.delete(name)},contains:name=>classes.has(name)},setAttribute(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn)},close(){this.open=false;for(const fn of handlers.get('close')||[])fn()},insertAdjacentHTML(_,html){this.innerHTML+=html},append(){},prepend(){},remove(){},scrollTo(){}};
    elements.set(selector,value);return value;
  }
  const on=(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)};
  const map={setView(){return this},fitBounds(bounds){pans.push({kind:'fit',bounds})},panInside(point){pans.push({kind:'follow',point})},panTo(point){pans.push({kind:'manual',point})},invalidateSize(){},getSize:()=>({y:600}),on(){}};
  const sandbox={
    console:{warn(){},error(){}},AbortController,URLSearchParams,Date:time.Date,JSON,Math,Map,Set,Promise,
    setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,setInterval:time.setInterval,clearInterval:time.clearInterval,
    requestAnimationFrame:time.requestAnimationFrame,cancelAnimationFrame:time.cancelAnimationFrame,performance:{now:()=>time.now},
    navigator:{onLine:true},location:{hash:'#'+A,origin:'https://rider.test',pathname:'/',search:''},history:{replaceState(){}},
    Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},
    addEventListener:on,dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);return true},
    document:{hidden:false,querySelector:node,querySelectorAll:()=>[],createElement:()=>node('new-'+elements.size),addEventListener:(name,fn)=>on('document:'+name,fn)},
    L:{
      map:()=>map,tileLayer:()=>({addTo(){return this}}),divIcon:options=>options,
      marker(point,options={}){const element=node('marker-'+markers.length),rotation=node('rotation-'+markers.length);element.querySelector=()=>rotation;const marker={point:{lat:point[0],lng:point[1]},options,removed:false,opacity:1,element,addTo(){return this},bindTooltip(content){this.tooltip=content;return this},getLatLng(){return this.point},setLatLng(next){this.point={lat:next[0],lng:next[1]}},getElement:()=>element,setOpacity(value){this.opacity=value},remove(){this.removed=true}};markers.push(marker);return marker},
      control(){const control={onAdd:null,addTo(){this.element=this.onAdd();controls.push(this);return this},remove(){this.removed=true}};return control},
      DomUtil:{create(){const element=node('control-'+controls.length);element.querySelector=selector=>selector==='button'?node('.captain-follow'):null;return element}},DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},
    },liveMap:map,validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),
  };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  return {c:sandbox,time,node,listeners,markers,controls,pans,emit:(name,detail)=>sandbox.dispatchEvent({type:name,detail}),documentEvent:name=>{for(const fn of listeners.get('document:'+name)||[])fn()}};
}
const response=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:{get:name=>headers[name]??null},json:async()=>data});
const shared=(time,extra={})=>({status:'riding',pickup:{name:'Private pickup',lat:24.7,lng:46.6},destination:{name:'Private destination',lat:24.71,lng:46.61},location:{lat:24.705,lng:46.605,at:new Date(time.now).toISOString(),fresh:true},...extra});
function shareHarness(fetcher){const h=base();h.calls=[];h.c.fetch=async(url,options)=>{h.calls.push({url,options});return fetcher(h,h.calls.length)};vm.runInContext(file('shared-tracking.js'),h.c);return h}
function captainHarness(){const h=base();vm.runInContext(file('captain-tracking.js'),h.c);h.trip=(extra={})=>({id:'trip-A',driver_id:'captain-A',status:'riding',pickup:{lat:24.7,lng:46.6},destination:{lat:24.71,lng:46.61},driverLocation:{lat:24.705,lng:46.605,at:new Date(h.time.now).toISOString(),fresh:true},...extra});return h}

test('shared tracking retries transient HTTP and network failures, then recovers without losing the route',async()=>{
  const h=shareHarness((h,n)=>n===1?response({},503):n===2?Promise.reject(Error('offline fixture')):response(shared(h.time)));
  await flush();assert.equal(h.calls.length,1);
  await h.time.advance(2500);assert.equal(h.calls.length,2);
  await h.time.advance(4999);assert.equal(h.calls.length,2);
  await h.time.advance(1);assert.equal(h.calls.length,3);
  assert.equal(h.node('#share-status').textContent,'الرحلة جارية');
  assert.equal(h.node('#tracking-error').textContent,'');
  assert.equal(h.markers.length,3);
});

test('shared tracking respects a bounded rate-limit delay instead of stopping permanently',async()=>{
  const h=shareHarness((h,n)=>n===1?response({},429,{'retry-after':'3'}):response(shared(h.time)));
  await flush();await h.time.advance(2999);assert.equal(h.calls.length,1);
  await h.time.advance(1);assert.equal(h.calls.length,2);
  assert.equal(h.node('#tracking-error').textContent,'');
});

test('hung shared fetch or JSON is bounded and an old response cannot overwrite recovered tracking',async()=>{
  for(const bodyHung of [false,true]){
    const old=deferred();
    const h=shareHarness((h,n)=>n===1?(bodyHung?{ok:true,json:()=>old.promise}:old.promise):response(shared(h.time,{status:'arrived'})));
    await flush();await h.time.advance(10000);
    assert.equal(h.calls[0].options.signal.aborted,true);
    await h.time.advance(2500);assert.equal(h.calls.length,2);
    assert.equal(h.node('#share-status').textContent,'وصل الكابتن');
    old.resolve(bodyHung?shared(h.time,{status:'matching'}):response(shared(h.time,{status:'matching'})));
    await flush();assert.equal(h.node('#share-status').textContent,'وصل الكابتن');
  }
});

test('invalid or revoked shares and ended trips stop retries and remove their location markers',async()=>{
  for(const terminal of [response({},404),response({},410),response({ended:true})]){
    const h=shareHarness((h,n)=>n===1?response(shared(h.time)):terminal);
    await flush();assert.equal(h.markers.length,3);
    await h.time.advance(2500);assert.ok(h.markers.every(marker=>marker.removed));
    const calls=h.calls.length;h.emit('online');h.documentEvent('visibilitychange');await h.time.advance(60000);
    assert.equal(h.calls.length,calls);
  }
});

test('shared tracking resumes immediately after offline or hidden suspension and ages its last GPS sample locally',async()=>{
  let data;
  const h=shareHarness(h=>response(data??=shared(h.time)));
  await flush();const car=h.markers.at(-1);assert.equal(car.opacity,1);
  h.c.navigator.onLine=false;h.emit('offline');assert.equal(car.opacity,.5);
  const calls=h.calls.length;await h.time.advance(121000);assert.equal(h.calls.length,calls);
  assert.match(h.node('#tracking-error').textContent,/آخر موقع قديم/);
  data=shared(h.time);h.c.navigator.onLine=true;h.emit('online');assert.equal(car.opacity,.5,'reconnection alone does not revalidate the last GPS sample');await h.time.advance(0);
  assert.equal(h.calls.length,calls+1);assert.equal(car.opacity,1);
  h.c.document.hidden=true;h.documentEvent('visibilitychange');const hiddenCalls=h.calls.length;await h.time.advance(5000);assert.equal(h.calls.length,hiddenCalls);
  h.c.document.hidden=false;h.documentEvent('visibilitychange');await h.time.advance(0);assert.equal(h.calls.length,hiddenCalls+1);
});

test('shared location freshness expires without a new response and rejects future GPS timestamps',async()=>{
  const sampleTime=Date.parse('2026-11-16T09:00:00Z');
  const h=shareHarness(h=>response(shared(h.time,{location:{lat:24.7,lng:46.6,at:new Date(sampleTime).toISOString(),fresh:true}})));
  await flush();const car=h.markers.at(-1);
  h.c.document.hidden=true;h.documentEvent('visibilitychange');await h.time.advance(120000);
  assert.equal(car.opacity,.5);assert.match(h.node('#tracking-error').textContent,/آخر موقع قديم/);
  const future=shareHarness(h=>response(shared(h.time,{location:{lat:24.7,lng:46.6,at:new Date(h.time.now+600000).toISOString(),fresh:true}})));
  await flush();assert.equal(future.markers.length,2,'future location must not create a live car');
});

test('captain marker becomes stale by age and never automatically follows stale samples',async()=>{
  const h=captainHarness();h.c.MishwarTracking.update(h.trip());
  assert.equal(h.node('.captain-location-state').textContent,'موقع الكابتن المباشر');
  const follows=h.pans.filter(p=>p.kind==='follow').length;
  await h.time.advance(120000);
  assert.equal(h.node('.captain-location-state').textContent,'آخر موقع — الاتصال غير حديث');
  assert.equal(h.markers[0].element.classList.contains('location-stale'),true);
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:24.8,lng:46.7,at:new Date(h.time.now-120000).toISOString(),fresh:true}}));
  h.node('.captain-follow').onclick();
  assert.equal(h.pans.filter(p=>p.kind==='follow').length,follows);
  assert.equal(h.pans.filter(p=>p.kind==='manual').length,0);
});

test('captain tracking requires an online refresh after disconnection and clears the previous trip before missing GPS',()=>{
  const h=captainHarness();const t=h.trip();h.c.MishwarTracking.update(t);
  h.c.navigator.onLine=false;h.emit('offline');assert.match(h.node('.captain-location-state').textContent,/آخر موقع/);
  h.c.navigator.onLine=true;h.emit('online');assert.match(h.node('.captain-location-state').textContent,/آخر موقع/);
  h.c.MishwarTracking.update(t);assert.match(h.node('.captain-location-state').textContent,/آخر موقع/,'A repeated pre-disconnection GPS measurement is not a new live observation');
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,at:new Date(h.time.now+1000).toISOString()}});assert.equal(h.node('.captain-location-state').textContent,'موقع الكابتن المباشر');
  h.c.MishwarTracking.update(h.trip({id:'trip-B',driver_id:'captain-B',driverLocation:null}));
  assert.equal(h.markers[0].removed,true);assert.equal(h.controls[0].removed,true);
  assert.equal([...h.time.timers.values()].filter(timer=>timer.interval).length,0);
});

test('RDEV-003 equivalent timestamp formats and conflicting equal-time samples never replace the measured marker',()=>{
  const h=captainHarness(),t=h.trip();h.c.MishwarTracking.update(t);const pans=h.pans.length;
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,at:t.driverLocation.at.replace('.000Z','Z')}});
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,lat:25.5,lng:47.5}});
  h.node('.captain-follow').onclick();assert.equal(h.pans.length,pans+1);
  assert.deepEqual(h.pans.at(-1).point,{lat:t.driverLocation.lat,lng:t.driverLocation.lng});
});

test('RDEV-003 location age is bounded by30 seconds even if no network event arrives',async()=>{
  const h=captainHarness();h.c.MishwarTracking.update(h.trip());await h.time.advance(30000);
  assert.equal(h.markers[0].opacity,.5);assert.match(h.node('.captain-location-state').textContent,/آخر موقع/);
});

test('RDEV-003 impossible GPS jumps do not animate or alter the last accepted position',async()=>{
  const h=captainHarness(),t=h.trip();h.c.MishwarTracking.update(t);await h.time.advance(1000);
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,lat:26,lng:48,at:new Date(h.time.now).toISOString()}});
  await h.time.advance(1200);assert.equal(h.markers[0].point.lat,t.driverLocation.lat);assert.equal(h.markers[0].point.lng,t.driverLocation.lng);assert.equal(h.markers[0].opacity,.5);
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,lat:t.driverLocation.lat+.0001,at:new Date(h.time.now).toISOString()}});
  await h.time.advance(1100);assert.equal(h.markers[0].point.lat,t.driverLocation.lat+.0001);assert.equal(h.markers[0].opacity,1);
});

test('RDEV-003 valid heading includes zero and reduced motion uses the actual sample directly',()=>{
  const h=captainHarness(),t=h.trip();h.c.document.body=h.node('body');h.c.document.body.classList.add('no-animation');
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,heading:270}});
  assert.match(h.node('rotation-0').style.transform,/-90deg|270deg/);
  h.c.MishwarTracking.update({...t,driverLocation:{...t.driverLocation,heading:0,lat:t.driverLocation.lat+.0001,at:new Date(h.time.now+1000).toISOString()}});
  assert.match(h.node('rotation-0').style.transform,/0deg|360deg/);assert.equal(h.markers[0].point.lat,t.driverLocation.lat+.0001);assert.equal(h.node('rotation-0').style.transition,'none');
});

test('RDEV-003 terminal/account reset cancels every animation and aging timer immediately',()=>{
  const h=captainHarness();h.c.MishwarTracking.update(h.trip());h.emit('mishwar-account-reset');
  assert.equal(h.time.timers.size,0);assert.equal(h.markers[0].removed,true);assert.equal(h.controls[0].removed,true);
  h.c.MishwarTracking.update(h.trip());h.c.MishwarTracking.update(h.trip({status:'completed',driverLocation:null}));assert.equal(h.time.timers.size,0);assert.equal(h.markers.at(-1).removed,true);
});

test('captain tracking ignores old GPS, invalid dates and late frames after account reset',async()=>{
  const h=captainHarness();const t=h.trip();h.c.MishwarTracking.update(t);
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:25,lng:47,at:new Date(h.time.now-1000).toISOString(),fresh:true}}));
  assert.equal(h.markers[0].point.lat,t.driverLocation.lat);
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:25,lng:47,at:'invalid',fresh:true}}));
  assert.match(h.node('.captain-location-state').textContent,/آخر موقع/);
  h.emit('mishwar-account-reset');await h.time.advance(1000);
  assert.equal(h.markers[0].removed,true);assert.equal(h.pans.filter(p=>p.kind==='fit').length,0);
  assert.equal(h.time.timers.size,0);
});

test('equal-time conflicting captain coordinates cannot replace the measured follow target',()=>{
  const h=captainHarness(),t=h.trip();h.c.MishwarTracking.update(t);
  h.c.MishwarTracking.update(h.trip({driverLocation:{...t.driverLocation,lat:25,lng:47}}));
  h.node('.captain-follow').onclick();
  const followed=h.pans.filter(p=>p.kind==='manual').at(-1).point;
  assert.equal(followed.lat,t.driverLocation.lat);assert.equal(followed.lng,t.driverLocation.lng);
  assert.equal(h.markers[0].point.lat,t.driverLocation.lat);
});

test('equivalent timestamp encodings cannot restart motion or introduce a conflicting sample',()=>{
  const h=captainHarness(),t=h.trip();h.c.MishwarTracking.update(t);
  const before=h.pans.filter(p=>p.kind==='follow').length;
  h.c.MishwarTracking.update(h.trip({driverLocation:{...t.driverLocation,at:t.driverLocation.at.replace('.000Z','Z')}}));
  assert.equal(h.pans.filter(p=>p.kind==='follow').length,before);
  h.c.MishwarTracking.update(h.trip({driverLocation:{...t.driverLocation,at:t.driverLocation.at.replace('.000Z','Z'),lat:25}}));
  h.node('.captain-follow').onclick();assert.equal(h.pans.filter(p=>p.kind==='manual').at(-1).point.lat,t.driverLocation.lat);
});

function liveHarness(fetcher,{full=false}={}){
  const h=base(),storage=new Map();h.calls=[];
  h.c.fetch=(url,options)=>{const body=JSON.parse(options.body);h.calls.push({url,body,options});return fetcher(h,body,h.calls.length)};
  h.c.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  vm.runInContext(file('account-context.js'),h.c);
  const context=h.c.MishwarAccountContext;
  context.applyAuth({authenticated:true,phoneVerified:true,accountKey:A},context.beginAuthRead());
  Object.assign(h.c,{accountContext:context,profile:{name:'Local rider',phone:'+966500000001'},$:h.c.document.querySelector});
  if(full){
    Object.assign(h.c,{state:{stage:'home',destination:null,tier:'economy'},pickupPoint:null,searchNote:'',timer:null,render(){},setStage(){},getDemoFare:()=>({price:24}),esc:String,icon:()=>'',toast(){},closeAddressEditor(){},drawMishwarRoute(){},matchMedia:()=>({matches:false,addEventListener(){}}),queueMicrotask,sectionModal(){},fitLocations(){},setRiderRatings(){}});
    vm.runInContext(file('live-booking.js'),h.c);
  }else{
    const source=file('live-booking.js'),start=source.indexOf('let trackingRead=null;'),end=source.indexOf('function resumeTracking()');
    assert.ok(start>=0&&end>start);
    vm.runInContext(source.slice(start,end)+'\nglobalThis.callLive=api;',h.c);
  }
  return h;
}
const liveData=()=>({accountKey:A,verified:true,trip:null,recentTrip:null,wallet:{balance:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false}});

test('a hung live refresh releases its poll lock at the read deadline and recovers on the next refresh',async()=>{
  const old=deferred();
  const h=liveHarness((h,body,n)=>n===1?old.promise:Promise.resolve(response(liveData())),{full:true});
  await flush();assert.equal(h.calls.length,1);
  await h.time.advance(10000);assert.equal(h.calls[0].options.signal.aborted,true);
  const resumed=h.c.refreshMishwarTrip(true);await flush();assert.equal(await resumed,true);assert.equal(h.calls.length,2);
  old.resolve(response({accountKey:B,verified:true,trip:null}));await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,A);
});

test('live read deadlines include JSON and late data cannot invalidate the current owner',async()=>{
  const old=deferred();
  const h=liveHarness(()=>Promise.resolve({ok:true,json:()=>old.promise}));
  const pending=h.c.callLive({action:'live_watch'});
  const settled=pending.then(()=>null,error=>error);
  await flush();await h.time.advance(10000);
  assert.equal((await settled).name,'TimeoutError');
  old.resolve({accountKey:B});await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,A);
});

test('booking and payment mutations remain one attempt without a tracking timeout or automatic replay',async()=>{
  for(const action of ['live_book','live_payment_init','live_payment_verify']){
    const reply=deferred(),h=liveHarness(()=>reply.promise);let done=false;
    const pending=h.c.callLive({action}).then(data=>{done=true;return data});
    await flush();await h.time.advance(30000);
    assert.equal(h.calls.length,1);assert.equal(done,false);assert.equal(h.calls[0].options.signal,undefined);
    reply.resolve(response({ok:true,accountKey:A}));await pending;assert.equal(done,true);
  }
});
