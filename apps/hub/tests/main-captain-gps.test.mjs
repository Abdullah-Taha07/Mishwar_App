import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const text=readFileSync(new URL('../public/driver-services.js',import.meta.url),'utf8');
const section=text.slice(0,text.indexOf('window.captainServiceDialog='))+'})();';
assert.ok(text.includes('window.captainServiceDialog='),'Expected actual captain GPS module section');
const flush=async()=>{for(let n=0;n<15;n++)await Promise.resolve()};
function harness(){
 let now=Date.parse('2026-11-21T12:00:00Z'),sequence=0,watchId=0;
 let sample,error;const timers=new Map(),listeners=new Map(),sent=[],cleared=[];
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const on=(event,fn)=>{if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(fn)};
 const c={Date:Clock,Number,Math,Map,Set,Promise,Error,AbortController,URLSearchParams,
  captainAuthBlocked:false,data:{captain:{id:'captain-test'},available:true,current:null},
  navigator:{onLine:true,geolocation:{watchPosition(ok,bad){sample=ok;error=bad;return ++watchId},clearWatch:id=>cleared.push(id)}},
  document:{hidden:false,addEventListener:(event,fn)=>on('document:'+event,fn)},
  addEventListener:on,dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,at:now+ms,interval:0});return id},
  clearTimeout:id=>timers.delete(id),setInterval(fn,ms){const id=++sequence;timers.set(id,{fn,at:now+ms,interval:ms});return id},clearInterval:id=>timers.delete(id),
  updateCaptainLiveMap(){},api:async(body)=>{sent.push(body);return{ok:true}}
 };
 c.window=c;vm.createContext(c);vm.runInContext(section,c);
 const p=(patch={})=>({timestamp:now,coords:{latitude:24.7,longitude:46.6,accuracy:8,...patch.coords},...Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='coords'))});
 return {c,sent,cleared,timers,p,now:()=>now,start:()=>c.startCaptainGPS(),sample:point=>sample(point),fail:code=>error({code}),flush,
  async advance(ms){const end=now+ms;for(let count=0;count<500;count++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const[id,t]=next;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();await flush()}now=end;await flush()}}
}

test('MAIN-GPS cached sensor measurements retain their observation time, never a new wall-clock time',async()=>{
 const h=harness(),work=h.start(),at=h.now()-10000;h.sample(h.p({timestamp:at}));const result=await work;await h.flush();
 assert.equal(result.at,at);assert.equal(h.sent.length,1);assert.equal(h.sent[0].observedAt,new Date(at).toISOString());
});

test('MAIN-GPS stale/future/out-of-range/non-finite sensor data cannot become a publishable location',async()=>{
 for(const patch of [{timestamp:Date.parse('2026-11-21T12:00:00Z')-60000},{timestamp:Date.parse('2026-11-21T12:00:00Z')+60000},{timestamp:NaN},{coords:{latitude:91}},{coords:{longitude:181}},{coords:{accuracy:NaN}},{coords:{accuracy:-1}},{coords:{accuracy:151}}]){
  const h=harness(),work=h.start();h.sample(h.p(patch));await h.flush();assert.equal(h.c.captainGPS,null);assert.equal(h.sent.length,0);
  await h.advance(19000);await assert.rejects(work);assert.equal(h.sent.length,0);
 }
});

test('MAIN-GPS equivalent/older measurements cannot replace the current sample or trigger extra publish',async()=>{
 const h=harness(),work=h.start(),at=h.now();h.sample(h.p({timestamp:at}));await work;await h.flush();
 h.sample(h.p({timestamp:at,coords:{latitude:24.8}}));h.sample(h.p({timestamp:at-1000}));await h.flush();
 assert.equal(h.c.captainGPS.lat,24.7);assert.equal(h.c.captainGPS.at,at);assert.equal(h.sent.length,1);
});

test('MAIN-GPS a sensor failure clears the cached point before a retry and releases the first wait timer',async()=>{
 const h=harness(),work=h.start();h.sample(h.p());await work;await h.flush();
 assert.equal([...h.timers.values()].filter(t=>t.interval===0).length,0);
 h.fail(1);assert.equal(h.c.captainGPS,null);assert.deepEqual(h.cleared,[1]);
});

test('MAIN-GPS the existing 150m policy remains accepted and returned without rounding',async()=>{
 const h=harness(),work=h.start();h.sample(h.p({coords:{accuracy:150}}));assert.equal((await work).accuracy,150);await h.flush();assert.equal(h.sent[0]?.accuracy,150);
});
