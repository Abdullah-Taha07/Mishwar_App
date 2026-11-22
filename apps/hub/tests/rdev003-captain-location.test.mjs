import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=()=>readFileSync(new URL('../public/driver-services.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve()};
function harness({available=true,trip=null}={}){
 let now=Date.parse('2026-11-21T12:00:00Z'),sequence=0;const timers=new Map(),events=new Map(),watches=[],cleared=[],requests=[],states=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const on=(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn)};
 const state={handler:null};
 const c={Date:Clock,Number,Math,Map,Set,Promise,Error,AbortController,URLSearchParams,
  captainAuthBlocked:false,data:{captain:{id:'captain-A'},available,current:trip},tab:'requests',location:{search:'',origin:'https://captain.local.test',pathname:'/dashboard'},
  navigator:{onLine:true,geolocation:{watchPosition(ok,fail){const id=watches.length;watches.push({ok,fail});return id},clearWatch:id=>cleared.push(id)}},
  document:{hidden:false,querySelector:()=>null,addEventListener:(name,fn)=>on('document:'+name,fn)},
  addEventListener:on,dispatchEvent(event){if(event.type==='mishwar-captain-location-state')states.push(event.detail.state);for(const fn of events.get(event.type)||[])fn(event)},
  CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,at:now+ms,interval:0});return id},clearTimeout:id=>timers.delete(id),
  setInterval(fn,ms){const id=++sequence;timers.set(id,{fn,at:now+ms,interval:ms});return id},clearInterval:id=>timers.delete(id),
  api:async(body,options)=>{requests.push({body,options});return state.handler?state.handler(body,options):{ok:true}},
  updateCaptainLiveMap(){},escapeHtml:String,toast(){},refresh(){},
 };
 c.window=c;vm.createContext(c);vm.runInContext(source(),c);
 const sample=(extra={})=>({timestamp:now,coords:{latitude:24.7,longitude:46.6,accuracy:7,heading:80,speed:8,...extra.coords},...Object.fromEntries(Object.entries(extra).filter(([name])=>name!=='coords'))});
 return{c,state,timers,watches,cleared,requests,states,sample,emit:(type,detail)=>c.dispatchEvent({type,detail}),send:p=>watches.at(-1).ok(p),get now(){return now},async advance(ms){const end=now+ms;for(let count=0;count<1000;count++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const[id,t]=next;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();await flush()}now=end;await flush()}};
}

test('RDEV-003 the complete captain service script compiles with one publisher',()=>{
 assert.doesNotThrow(()=>new vm.Script(source()));
 assert.equal((source().match(/window\.publishCaptainLocation\s*=/g)||[]).length,1);
});

test('RDEV-003 GPS keeps the sensor time and publishes the assigned trip with heading and abort signal',async()=>{
 const h=harness({trip:{id:'trip-A',status:'arriving'}}),at=h.now-2000;h.send(h.sample({timestamp:at}));await flush();
 assert.equal(h.c.captainGPS.at,at);assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].body.tripId,'trip-A');assert.equal(h.requests[0].body.observedAt,new Date(at).toISOString());
 assert.equal(h.requests[0].body.heading,80);assert.ok(h.requests[0].options.signal instanceof AbortSignal);
 h.send(h.sample({timestamp:at,coords:{latitude:24.8}}));h.send(h.sample({timestamp:at-1000}));await flush();
 assert.equal(h.c.captainGPS.lat,24.7);assert.equal(h.requests.length,1);
});

test('RDEV-003 captain precision retains the existing 150m policy and invalid/stale fixes never publish',async()=>{
 const h=harness();
 for(const patch of [{timestamp:h.now-31000},{timestamp:h.now+6000},{coords:{latitude:91}},{coords:{longitude:181}},{coords:{accuracy:NaN}},{coords:{accuracy:-1}},{coords:{accuracy:151}}])h.send(h.sample(patch));
 assert.equal(h.requests.length,0);assert.equal(h.c.captainGPS,null);
 h.send(h.sample({coords:{accuracy:150}}));await flush();assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.accuracy,150);
});

test('RDEV-003 GPS recovery drops impossible jumps and invalid headings without inventing a measurement',async()=>{
 const h=harness();h.send(h.sample());await flush();await h.advance(1000);
 h.send(h.sample({coords:{latitude:26,longitude:48}}));assert.equal(h.c.captainGPS.lat,24.7);assert.equal(h.c.captainLocationState,'gps-jump-rejected');
 await h.advance(8000);h.send(h.sample({coords:{latitude:24.7001,heading:999}}));await flush();assert.equal(h.requests.length,2);assert.equal(h.requests[1].body.heading,null);
});

test('RDEV-003 offline and timed-out uploads unlock, preserve the sample, and retry only while authorized',async()=>{
 const h=harness(),old=deferred();h.state.handler=()=>old.promise;h.send(h.sample());await flush();assert.equal(h.requests.length,1);
 h.c.navigator.onLine=false;h.emit('offline');assert.equal(h.requests[0].options.signal.aborted,true);
 h.state.handler=null;h.c.navigator.onLine=true;h.emit('online');await h.advance(9000);
 assert.equal(h.requests.length,2);assert.equal(h.c.captainLocationState,'published');
 h.c.data={captain:{id:'captain-B'},available:false,current:null};h.c.syncCaptainGPS();old.resolve({ok:true});await flush();
 assert.equal(h.c.captainGPS,null);assert.equal(h.c.captainLocationState,'idle');
});

test('RDEV-003 an expired captain session aborts upload and removes the watch without late callbacks',async()=>{
 const h=harness(),old=deferred();h.state.handler=()=>old.promise;h.send(h.sample());await flush();
 h.emit('mishwar-captain-auth-required');assert.equal(h.c.captainGPS,null);assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.c.captainLocationState,'session-expired');
 const before=h.requests.length;h.watches[0].ok(h.sample({timestamp:h.now+1000}));old.resolve({ok:true});await h.advance(9000);
 assert.equal(h.requests.length,before);assert.equal(h.c.captainGPS,null);
});

test('RDEV-003 terminal trips stop private upload unless availability still authorizes dispatch presence',async()=>{
 const h=harness({available:false,trip:{id:'trip-A',status:'riding'}});h.send(h.sample());await flush();
 h.c.data.current={id:'trip-A',status:'completed'};h.c.syncCaptainGPS();assert.equal(h.c.captainGPS,null);assert.equal(h.cleared.length,1);
 await h.advance(9000);assert.equal(h.requests.length,1);
 h.c.data.available=true;h.c.syncCaptainGPS();h.send(h.sample());await flush();assert.equal(h.requests.length,2);assert.equal(h.requests[1].body.tripId,null);
});

test('RDEV-003 explicit availability GPS can be captured while offline without transmitting or orphaning a watch',async()=>{
 const h=harness({available:false});assert.equal(h.watches.length,0);
 const requested=h.c.startCaptainGPS();h.send(h.sample());assert.equal((await requested).lat,24.7);assert.equal(h.requests.length,0);
 await h.advance(3000);assert.equal(h.c.captainGPS,null);assert.equal(h.cleared.length,1);
});

test('RDEV-003 driver API forwards only its optional location abort signal and stops after authorization loss',async()=>{
 const file=readFileSync(new URL('../public/driver.js',import.meta.url),'utf8'),begin=file.indexOf('let captainAuthBlocked=false;'),end=file.indexOf('let lastFullSync=',begin);
 let options;const nodes=new Map(),c={data:null,lastView:'',AbortController,Event:class{},window:{dispatchEvent(){}},by:selector=>{if(!nodes.has(selector))nodes.set(selector,{setAttribute(){}});return nodes.get(selector)},fetch:async(_,init)=>{options=init;return{status:200,ok:true,json:async()=>({ok:true})}}};
 vm.createContext(c);vm.runInContext(file.slice(begin,end),c);const signal=new AbortController().signal;
 await c.api({action:'location'},{signal});assert.equal(options.signal,signal);assert.equal(options.credentials,'same-origin');
});

test('RDEV-003 enabling availability binds its sensor measurement to the active trip only',async()=>{
 const file=readFileSync(new URL('../public/driver.js',import.meta.url),'utf8'),begin=file.indexOf("by('#online').onclick=async()=>{"),end=file.indexOf("};document.addEventListener('click'",begin);
 assert.ok(begin>=0&&end>begin,'Execute the actual captain availability handler');
 for(const status of ['arriving','arrived','riding','completed',null]){
  const button={setAttribute(){},removeAttribute(){}},measurement={lat:24.7,lng:46.6,accuracy:5,observedAt:new Date(1700000000000).toISOString(),heading:0,speed:0};let submitted;
  const c={data:{available:false,current:status?{id:'trip-bound',status}:null},busy:false,availabilitySaving:false,by:()=>button,window:{startCaptainGPS:async()=>measurement},change:async body=>{submitted=body},render(){},toast(message){assert.fail(message)},Promise};
  vm.createContext(c);vm.runInContext(file.slice(begin,end+2),c);await button.onclick();
  assert.equal(submitted.tripId,['arriving','arrived','riding'].includes(status)?'trip-bound':null);assert.equal(submitted.observedAt,measurement.observedAt);assert.equal(submitted.heading,0);
 }
});
