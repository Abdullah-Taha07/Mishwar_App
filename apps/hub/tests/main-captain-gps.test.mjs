import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../public/driver-services.js',import.meta.url),'utf8');
const section=text.slice(0,text.indexOf('window.captainServiceDialog='))+'})();';
function harness(){
 let sample,error;const timers=new Map(),map=[],sent=[],cleared=[];let next=0;
 const c={Date,Number,Math,Promise,Error,navigator:{geolocation:{watchPosition(ok,bad){sample=ok;error=bad;return 1},clearWatch:id=>cleared.push(id)}},setTimeout(fn){timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id),data:{current:null},updateCaptainLiveMap:t=>map.push(t),publishCaptainLocation:()=>sent.push(true)};
 c.window=c;vm.createContext(c);vm.runInContext(section,c);
 const p=(patch={})=>({timestamp:Date.now(),coords:{latitude:24.7,longitude:46.6,accuracy:8,...patch.coords},...Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='coords'))});
 return {c,map,sent,cleared,timers,p,start(){const work=c.startCaptainGPS();work.catch(()=>{});return work},sample:point=>sample(point),fail:code=>error({code})};
}

test('MAIN-GPS cached sensor measurements retain their observation time, never a new wall-clock time',async()=>{
 const h=harness(),work=h.start(),at=Date.now()-10000;h.sample(h.p({timestamp:at}));
 const result=await work;assert.equal(result.at,at);assert.equal(h.sent.length,1);
});

test('MAIN-GPS stale/future/out-of-range/non-finite sensor data cannot become a publishable location',async()=>{
 for(const patch of [{timestamp:Date.now()-60000},{timestamp:Date.now()+60000},{timestamp:NaN},{coords:{latitude:91}},{coords:{longitude:181}},{coords:{accuracy:NaN}},{coords:{accuracy:-1}},{coords:{accuracy:151}}]){
  const h=harness(),work=h.start();h.sample(h.p(patch));assert.equal(h.c.captainGPS,null);assert.equal(h.sent.length,0);
  for(const fn of [...h.timers.values()])fn();await assert.rejects(work);
 }
});

test('MAIN-GPS equivalent/older measurements cannot replace the current sample or trigger extra publish',async()=>{
 const h=harness(),work=h.start(),at=Date.now();h.sample(h.p({timestamp:at}));await work;
 h.sample(h.p({timestamp:at,coords:{latitude:24.8}}));h.sample(h.p({timestamp:at-1000}));
 assert.equal(h.c.captainGPS.lat,24.7);assert.equal(h.c.captainGPS.at,at);assert.equal(h.sent.length,1);
});

test('MAIN-GPS a sensor failure clears the cached point before a retry and releases the first wait timer',async()=>{
 const h=harness(),work=h.start();h.sample(h.p());await work;assert.equal(h.timers.size,0);
 h.fail(1);assert.equal(h.c.captainGPS,null);assert.deepEqual(h.cleared,[1]);
});

test('MAIN-GPS the existing 150m policy remains accepted and returned without rounding',async()=>{
 const h=harness(),work=h.start();h.sample(h.p({coords:{accuracy:150}}));assert.equal((await work).accuracy,150);
});
