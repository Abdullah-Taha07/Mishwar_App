import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {handleLiveRider} from '../worker/commerce.js';
import {routeEstimate,routeFare,RIDE_CATEGORIES} from '../worker/routing.js';
import {cityMarket,priceCityMarket} from '../worker/expansion.js';

const pickup={lat:24.7,lng:46.6,name:'Synthetic pickup'},destination={lat:24.71,lng:46.61,name:'Synthetic destination'};
const route={distanceMeters:2400,durationSeconds:480,provider:'OSRM',trafficAware:false,demoProvider:true,geometry:{type:'LineString',coordinates:[[46.6,24.7],[46.61,24.71]]}};
function setup(){
 const env=makeEnv();
 env.db.prepare('UPDATE operating_cities SET surge_enabled=1,surge_cap_bps=15000,commission_bps=1000 WHERE id=?').run('riyadh');
 env.db.prepare('INSERT INTO road_route_cache VALUES(?,?,?)').run('osrm:https://router.project-osrm.org:46.60000,24.70000,46.61000,24.71000',JSON.stringify(route),'2030-01-01T00:00:00Z');
 return env;
}
function addCompetingDemand(env){
 const at=new Date().toISOString();
 for(let index=0;index<3;index++){
  const actor='synthetic-competing-'+index;
  env.db.prepare('INSERT INTO riders VALUES(?,?,?,?,?,?,?)').run(actor,'Synthetic rider','+96650000100'+index,'','active',at,at);
  env.db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('competing-trip-'+index,actor,null,'matching',JSON.stringify(pickup),JSON.stringify(destination),1000,0,'cash_due',0,at,at);
 }
}
function intercept(env,when,inject=()=>addCompetingDemand(env)){
 const prepare=env.DB.prepare.bind(env.DB),counts={demand:0,supply:0,injected:false};
 env.DB.prepare=sql=>{
  function wrap(statement){return {...statement,
   bind(...values){return wrap(statement.bind(...values))},
   async all(){
    const value=await statement.all();
    if(sql.startsWith('SELECT pickup_json FROM trips'))counts.demand++;
    if(sql.startsWith('SELECT p.latitude AS lat,p.longitude AS lng FROM captain_presence')){
     counts.supply++;
     if(when==='after-supply'&&!counts.injected){counts.injected=true;inject()}
    }
    return value;
   },
   async run(){
    const value=await statement.run();
    if(when==='after-quote-market'&&sql.startsWith('INSERT INTO quote_market')&&!counts.injected){counts.injected=true;inject()}
    return value;
   },
  }}
  return wrap(prepare(sql));
 };
 return counts;
}
function quote(env,body={}){
 const request=new Request('https://hub.offline.test/internal/live-rider',{method:'POST',headers:{'Content-Type':'application/json','x-mishwar-key':env.RIDER_SERVICE_KEY},body:JSON.stringify({action:'live_quote',sessionToken:env.verifiedToken('snapshot-owner'),pickup,destination,...body})});
 return handleLiveRider(request,env);
}

for(const category of ['economy','comfort','vip'])test('RIDER-012 '+category+' quote, coupon and stored fare share one market snapshot under concurrent demand',async()=>{
 const env=setup();try{
  env.db.prepare('INSERT INTO coupons VALUES(?,?,?,?,?,?)').run('SNAPSHOT10','percent',1000,100,1,'2030-01-01T00:00:00Z');
  const counts=intercept(env,'after-quote-market'),response=await quote(env,{category,coupon:'SNAPSHOT10'}),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(counts.injected,true);
  assert.equal(env.db.prepare("SELECT count(*) AS n FROM trips WHERE status='matching'").get().n,3,'A real SQLite change simulates competing clients between quote persistence and offer construction');
  assert.deepEqual({demand:counts.demand,supply:counts.supply},{demand:1,supply:1});
  const selected=data.offers.find(offer=>offer.category===category),stored=env.db.prepare('SELECT fare_halalas,discount_halalas,commission_bps,route_json FROM ride_quotes WHERE id=?').get(data.id);
  assert.equal(selected.fare,data.fare);assert.equal(selected.discount,data.discount);assert.equal(selected.payable,data.payable);
  assert.equal(stored.fare_halalas,data.fare);assert.equal(stored.discount_halalas,data.discount);assert.equal(stored.commission_bps,1000);
  assert.equal(stored.fare_halalas-stored.discount_halalas,selected.payable);assert.equal(data.market.multiplier,10000);
  assert.equal(JSON.parse(stored.route_json).market.multiplier,10000);
  assert.deepEqual(data.offers.map(offer=>offer.fare),[1000,1350,1850]);
  assert.ok(data.offers.every(offer=>offer.breakdown.surgeHalalas===0));
 }finally{env.db.close()}
});

test('RIDER-012 guest estimate offers use the same demand snapshot as its selected category',async()=>{
 const env=setup();try{
  const counts=intercept(env,'after-supply'),request=new Request('https://hub.offline.test/internal/route-estimate',{method:'POST',headers:{'Content-Type':'application/json','x-mishwar-key':env.RIDER_SERVICE_KEY},body:JSON.stringify({pickup,destination,category:'vip',clientIp:'198.51.100.49'})});
  const response=await routeEstimate(request,env),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(counts.injected,true);assert.equal(counts.demand,1);assert.equal(counts.supply,1);
  assert.equal(data.fare,data.offers.find(offer=>offer.category==='vip').fare);assert.equal(data.market.multiplier,10000);
  assert.deepEqual(data.offers.map(offer=>offer.fare),[1000,1350,1850]);
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM ride_quotes').get().n,0,'Guest comparison does not create a confirmed quote');
  assert.equal((await cityMarket(env,pickup,route)).multiplier,15000,'The next independent request may legitimately see the new demand');
 }finally{env.db.close()}
});

test('RIDER-012 pure market repricing preserves category policies and never re-reads the database',async()=>{
 const env=setup();try{
  const counts=intercept(env,'none');
  for(const metrics of [{distanceMeters:0,durationSeconds:0},route,{distanceMeters:10000,durationSeconds:1200},{distanceMeters:2000000,durationSeconds:100000}]){
   const snapshot=await cityMarket(env,pickup,metrics),before=JSON.stringify(snapshot),reads={demand:counts.demand,supply:counts.supply};
   for(const category of RIDE_CATEGORIES){const priced=priceCityMarket(snapshot,metrics,category.id);assert.equal(priced.fare,routeFare(metrics.distanceMeters,metrics.durationSeconds,category.id).fare);assert.equal(priced.breakdown.categoryName,category.name)}
   assert.deepEqual({demand:counts.demand,supply:counts.supply},reads);assert.equal(JSON.stringify(snapshot),before);
  }
  env.db.prepare('UPDATE operating_cities SET base_halalas=421,per_km_halalas=125,per_min_halalas=13,minimum_halalas=1200 WHERE id=?').run('riyadh');
  const snapshot=await cityMarket(env,pickup,{distanceMeters:10000,durationSeconds:1200});
  assert.deepEqual(RIDE_CATEGORIES.map(category=>priceCityMarket(snapshot,{distanceMeters:10000,durationSeconds:1200},category.id).fare),[1931,2607,3572]);
  assert.deepEqual(RIDE_CATEGORIES.map(category=>priceCityMarket({...snapshot,multiplier:12500},{distanceMeters:10000,durationSeconds:1200},category.id).fare),[2414,3259,4465]);
 }finally{env.db.close()}
});

test('RIDER-012 negotiated custom fare remains independent of the automatic category comparison',async()=>{
 const env=setup();try{
  intercept(env,'after-quote-market');const response=await quote(env,{category:'economy',customFare:1700}),data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.custom,true);assert.equal(data.fare,1700);assert.equal(data.payable,1700);
  assert.equal(data.offers.find(offer=>offer.category==='economy').fare,1000);assert.equal(data.breakdown,null);
  assert.equal(env.db.prepare('SELECT fare_halalas FROM ride_quotes WHERE id=?').get(data.id).fare_halalas,1700);
 }finally{env.db.close()}
});

test('RIDER-012 selected discount matches its stored quote when coupon settings change during offer construction',async()=>{
 const env=setup();try{
  env.db.prepare('INSERT INTO coupons VALUES(?,?,?,?,?,?)').run('SNAPSHOT10','percent',1000,100,1,'2030-01-01T00:00:00Z');
  const counts=intercept(env,'after-quote-market',()=>env.db.prepare('UPDATE coupons SET value=2000 WHERE code=?').run('SNAPSHOT10'));
  const response=await quote(env,{category:'economy',coupon:'SNAPSHOT10'}),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.equal(counts.injected,true);
  const stored=env.db.prepare('SELECT fare_halalas,discount_halalas FROM ride_quotes WHERE id=?').get(data.id),selected=data.offers.find(offer=>offer.category==='economy');
  assert.equal(data.discount,100);assert.equal(selected.fare,stored.fare_halalas);assert.equal(selected.discount,stored.discount_halalas);assert.equal(selected.payable,data.payable);assert.equal(selected.payable,stored.fare_halalas-stored.discount_halalas);
  const booking=await quote(env,{action:'live_book',quoteId:data.id,method:'cash'}),failure=await booking.json();
  assert.equal(booking.status,400);assert.match(failure.error,/تغيرت القسيمة/,'Booking still revalidates the current coupon and requests a fresh quote');
  assert.equal(env.db.prepare('SELECT count(*) AS n FROM trips').get().n,0);assert.equal(env.db.prepare('SELECT count(*) AS n FROM wallet_entries').get().n,0);
 }finally{env.db.close()}
});
