import {distanceKm} from './dispatch.js';
import {drivingItinerary} from './routing.js';
import {checkedRouteSnapshot} from './road-data.js';

export const TRACKING_POLICY = Object.freeze({maxAgeMs:30000,futureMs:5000,maxAccuracy:150,maxSpeed:80,jumpAllowance:250,ratePerMinute:30,etaAgeMs:30000,minRouteMs:15000,routeMoveMeters:50});
const activeStatuses = new Set(['arriving','arrived','riding']);
const etaStates = new WeakMap();
function stateFor(env){let state=etaStates.get(env);if(!state){state={inFlight:new Map(),cleanupMinute:null};etaStates.set(env,state)}return state}
const failure=(message,status=400)=>Object.assign(Error(message),{status});
const validPoint=p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
function instant(value){const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)&&at>=0?at:NaN}
export function checkedCaptainMeasurement(body,clock=Date.now()){
 if(!validPoint(body)||!Number.isFinite(body.accuracy)||body.accuracy<0||body.accuracy>TRACKING_POLICY.maxAccuracy)throw failure('موقع غير دقيق. يلزم قياس GPS بدقة ١٥٠ متر أو أفضل.');
 const at=instant(body.observedAt);
 if(!Number.isFinite(at)||at<clock-TRACKING_POLICY.maxAgeMs||at>clock+TRACKING_POLICY.futureMs)throw failure('قياس الموقع قديم أو وقته غير صحيح. حدّث GPS وتحقق من ساعة الجهاز.');
 const heading=Number.isFinite(body.heading)&&body.heading>=0&&body.heading<360?body.heading:null;
 const speed=Number.isFinite(body.speed)&&body.speed>=0&&body.speed<=100?body.speed:null;
 return {lat:body.lat,lng:body.lng,accuracy:body.accuracy,at:new Date(at).toISOString(),heading,speed};
}
async function trackingCleanup(env,clock){
 const state=stateFor(env),minute=Math.floor(clock/60000);if(state.cleanupMinute===minute)return;
 await env.DB.batch([
  env.DB.prepare("DELETE FROM road_route_cache WHERE cache_key LIKE 'live-eta:%' AND expires_at<=?").bind(new Date(clock).toISOString()),
  env.DB.prepare("DELETE FROM access_rate_limits WHERE bucket LIKE 'captain-location:%' AND bucket NOT LIKE ?").bind('%:'+minute),
 ]);
 state.cleanupMinute=minute;
}
export async function writeCaptainLocation(env,captain,body,{available=false,beforeWrite}={}){
 const clock=Date.now();await trackingCleanup(env,clock);
 const rate=await env.DB.prepare('INSERT INTO access_rate_limits(bucket,n) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind('captain-location:'+captain+':'+Math.floor(clock/60000)).first();
 if(rate.n>TRACKING_POLICY.ratePerMinute)throw failure('تحديثات الموقع كثيرة. انتظر قليلًا ثم أعد المحاولة.',429);
 const point=checkedCaptainMeasurement(body,clock);
 const current=await env.DB.prepare("SELECT id,status FROM trips WHERE driver_id=? AND is_demo=0 AND status IN ('arriving','arrived','riding') ORDER BY created_at DESC LIMIT 1").bind(captain).first();
 if((current&&body.tripId!==current.id)||(body.tripId!==undefined&&body.tripId!==null&&(!current||body.tripId!==current.id)))throw failure('تحديث الموقع ليس لرحلتك النشطة.',403);
 const previous=await env.DB.prepare('SELECT available,latitude,longitude,accuracy,location_at FROM captain_presence WHERE application_id=?').bind(captain).first();
 if(!available&&!current&&!previous?.available)throw failure('التتبع متاح للرحلة النشطة أو عند تفعيل التوفر فقط.',403);
 const oldAt=instant(previous?.location_at),at=Date.parse(point.at);
 // Recheck the assignment inside the write itself: completion/reassignment may race an awaited read.
 const authorization="((? IS NULL AND NOT EXISTS(SELECT 1 FROM trips WHERE driver_id=? AND is_demo=0 AND status IN ('arriving','arrived','riding'))) OR EXISTS(SELECT 1 FROM trips WHERE id=? AND driver_id=? AND is_demo=0 AND status=?))";
 const authorizationArgs=[current?.id||null,captain,current?.id||null,captain,current?.status||null];
 if(Number.isFinite(oldAt)&&at<=oldAt){
  if(at===oldAt&&point.lat===previous.latitude&&point.lng===previous.longitude&&point.accuracy===previous.accuracy){
   if(available){const enabled=await env.DB.prepare('UPDATE captain_presence SET available=1,last_seen=? WHERE application_id=? AND location_at=? AND latitude=? AND longitude=? AND '+authorization).bind(new Date(clock).toISOString(),captain,point.at,point.lat,point.lng,...authorizationArgs).run();if(!enabled.meta?.changes)throw failure('تغيرت الرحلة أو وصل موقع أحدث. حدّث الحالة مجددًا.',409)}
   return {ok:true,accepted:false,duplicate:true,locationAt:point.at};
  }
  throw failure('تجاهلنا قياس موقع أقدم أو مكررًا ببيانات مختلفة.',409);
 }
 if(Number.isFinite(oldAt)&&clock-oldAt<=120000&&validPoint({lat:previous?.latitude,lng:previous?.longitude})){
  const meters=distanceKm({lat:previous.latitude,lng:previous.longitude},point)*1000;
  if(meters>TRACKING_POLICY.jumpAllowance+TRACKING_POLICY.maxSpeed*(at-oldAt)/1000)throw failure('قفزة GPS غير موثوقة. انتظر قياسًا صحيحًا أو أعد تفعيل الموقع.',409);
 }
 const receivedAt=new Date(clock).toISOString(),metadata=JSON.stringify({at:point.at,receivedAt,heading:point.heading,speed:point.speed});
 if(beforeWrite)await beforeWrite();
 const result=await env.DB.batch([
  env.DB.prepare('INSERT INTO captain_presence(application_id,available,last_seen,latitude,longitude,accuracy,location_at) SELECT ?,?,?,?,?,?,? WHERE '+authorization+' AND (?=1 OR ? IS NOT NULL OR EXISTS(SELECT 1 FROM captain_presence WHERE application_id=? AND available=1)) ON CONFLICT(application_id) DO UPDATE SET available=CASE WHEN ?=1 THEN 1 ELSE captain_presence.available END,last_seen=excluded.last_seen,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,location_at=excluded.location_at WHERE captain_presence.location_at IS NULL OR captain_presence.location_at<excluded.location_at').bind(captain,available?1:0,receivedAt,point.lat,point.lng,point.accuracy,point.at,...authorizationArgs,available?1:0,current?.id||null,captain,available?1:0),
  env.DB.prepare("INSERT INTO platform_settings(key,value,updated_at,updated_by) SELECT ?,?,?,? FROM captain_presence WHERE application_id=? AND location_at=? AND latitude=? AND longitude=? ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE json_extract(platform_settings.value,'$.at') IS NULL OR json_extract(platform_settings.value,'$.at')<json_extract(excluded.value,'$.at')").bind('tracking-captain:'+captain,metadata,receivedAt,'tracking',captain,point.at,point.lat,point.lng),
 ]);
 if(!result[0]?.meta?.changes)throw failure('وصل قياس أحدث أثناء التحديث. حدّث الموقع مجددًا.',409);
 return {ok:true,accepted:true,locationAt:point.at};
}
export async function clearTripTracking(env,tripId){await env.DB.prepare('DELETE FROM road_route_cache WHERE cache_key=?').bind('live-eta:'+tripId).run()}
export async function captainLocationForTrip(env,trip){
 if(!trip||trip.is_demo||!trip.driver_id||!activeStatuses.has(trip.status))return null;
 const point={lat:trip.driver_lat,lng:trip.driver_lng},at=instant(trip.driver_location_at),clock=Date.now();
 if(!validPoint(point)||!Number.isFinite(trip.driver_accuracy)||trip.driver_accuracy<0||trip.driver_accuracy>TRACKING_POLICY.maxAccuracy||!Number.isFinite(at))return null;
 const row=await env.DB.prepare('SELECT value FROM platform_settings WHERE key=?').bind('tracking-captain:'+trip.driver_id).first();let metadata;
 try{metadata=JSON.parse(row?.value||'null')}catch{}
 const heading=metadata?.at===trip.driver_location_at&&Number.isFinite(metadata.heading)&&metadata.heading>=0&&metadata.heading<360?metadata.heading:null;
 return {...point,accuracy:trip.driver_accuracy,at:new Date(at).toISOString(),observedAt:new Date(at).toISOString(),heading,tripId:trip.id,phase:trip.status,fresh:at>=clock-TRACKING_POLICY.maxAgeMs&&at<=clock+TRACKING_POLICY.futureMs};
}
function unavailable(trip,target,reason){return {status:'unavailable',tripId:trip.id,target,reason}}
export function withoutRawTracking(trip){
 if(!trip)return trip;
 const {driver_lat,driver_lng,driver_accuracy,driver_location_at,...safe}=trip;
 return safe;
}
function locationFresh(location,clock=Date.now()){
 const at=instant(location?.at);
 return validPoint(location)&&Number.isFinite(at)&&at>=clock-TRACKING_POLICY.maxAgeMs&&at<=clock+TRACKING_POLICY.futureMs;
}
function cacheCurrent(value,trip,target,clock){
 const age=clock-instant(value?.calculatedAt),expiry=instant(value?.expiresAt);
 return !!value&&value.tripId===trip.id&&value.driverId===trip.driver_id&&value.phase===trip.status&&value.target===target&&value.destinationJson===(trip.destination_json||JSON.stringify(trip.destination))&&validPoint(value.origin)&&Number.isFinite(age)&&age>=0&&Number.isFinite(expiry)&&expiry>clock&&expiry-instant(value.calculatedAt)<=TRACKING_POLICY.etaAgeMs;
}
async function currentTracking(env,id){
 return env.DB.prepare('SELECT t.status,t.driver_id,t.rider_id,t.destination_json,t.pickup_json,p.latitude,p.longitude,p.accuracy,p.location_at FROM trips t LEFT JOIN captain_presence p ON p.application_id=t.driver_id WHERE t.id=?').bind(id).first();
}
function sameTrip(current,trip){return current&&current.status===trip.status&&current.driver_id===trip.driver_id&&current.rider_id===trip.rider_id&&current.destination_json===(trip.destination_json||JSON.stringify(trip.destination))}
function sameLocation(current,location){return current&&current.location_at===location.at&&current.latitude===location.lat&&current.longitude===location.lng&&current.accuracy===location.accuracy}
function approvedRoad(env){
 return env.TOMTOM_ENABLED==='true'&&typeof env.TOMTOM_API_KEY==='string'&&!!env.TOMTOM_API_KEY.trim()||typeof env.OSRM_BASE_URL==='string'&&!!env.OSRM_BASE_URL.trim();
}
async function calculateEta(env,trip){
 if(!trip||trip.is_demo||!activeStatuses.has(trip.status)||!trip.driver_id)return null;
 const target=trip.status==='riding'?'destination':'pickup';
 if(trip.status==='arrived')return {status:'arrived',tripId:trip.id,target};
 const location=trip.driverLocation;
 if(!location)return unavailable(trip,target,'location_unavailable');
 if(!locationFresh(location))return unavailable(trip,target,'location_stale');
 if(target==='destination'&&trip.options?.stops?.length)return unavailable(trip,target,'stops_progress_unavailable');
 const destination=trip[target];if(!validPoint(destination))return unavailable(trip,target,'route_unavailable');
 const clock=Date.now();await trackingCleanup(env,clock);
 const key='live-eta:'+trip.id,cached=await env.DB.prepare('SELECT route_json FROM road_route_cache WHERE cache_key=? AND expires_at>?').bind(key,new Date(clock).toISOString()).first();let record;
 try{record=JSON.parse(cached?.route_json||'null')}catch{}
 if(cacheCurrent(record,trip,target,clock)){
  const age=clock-instant(record.calculatedAt),movement=distanceKm(record.origin,location)*1000;
  if(movement<TRACKING_POLICY.routeMoveMeters&&(record.result?.status==='available'||age<TRACKING_POLICY.minRouteMs))return record.result;
  if(age<TRACKING_POLICY.minRouteMs)return unavailable(trip,target,'route_refresh_pending');
 }
 // Live passenger GPS must never be sent to the public demo fallback, even if quoting permits it.
 if(!approvedRoad(env))return unavailable(trip,target,'route_untrusted');
 const state=stateFor(env),requestKey=trip.id+':'+trip.status+':'+(trip.destination_json||JSON.stringify(trip.destination));
 const running=state.inFlight.get(requestKey);
 if(running)return running.locationAt===location.at?running.promise:unavailable(trip,target,'location_changed');
 const work=(async()=>{
  const calculatedAt=new Date(clock).toISOString(),expiresAt=new Date(Math.min(clock+TRACKING_POLICY.etaAgeMs,Date.parse(location.at)+TRACKING_POLICY.maxAgeMs)).toISOString();
  let result;
  try{
   const route=checkedRouteSnapshot(await drivingItinerary(env,location,destination,[],{cache:false,requireTrusted:true}));
   if(route.stale||route.demoProvider||!['OSRM','TomTom'].includes(route.provider)||route.provider==='OSRM'&&!env.OSRM_BASE_URL)throw failure('UNTRUSTED_ETA_ROUTE');
   if(route.durationSeconds<=0||route.distanceMeters<=0)throw failure('ETA_ROUTE_METRICS_UNAVAILABLE');
   result={status:'available',tripId:trip.id,target,durationSeconds:route.durationSeconds,minutes:Math.max(1,Math.ceil(route.durationSeconds/60)),distanceMeters:route.distanceMeters,trafficAware:route.trafficAware===true,trafficDelaySeconds:route.trafficAware===true?route.trafficDelaySeconds||0:0,provider:route.provider,calculatedAt,expiresAt,locationAt:location.at};
  }catch(error){result=unavailable(trip,target,error.message==='UNTRUSTED_ETA_ROUTE'?'route_untrusted':'route_unavailable')}
  const fresh=await currentTracking(env,trip.id);
  if(!sameTrip(fresh,trip))return unavailable(trip,target,'trip_changed');
  if(!sameLocation(fresh,location))return unavailable(trip,target,'location_changed');
  if(!locationFresh(location)||Date.now()>=Date.parse(expiresAt))return unavailable(trip,target,'location_stale');
  const cache={tripId:trip.id,driverId:trip.driver_id,phase:trip.status,target,destinationJson:trip.destination_json||JSON.stringify(trip.destination),origin:{lat:location.lat,lng:location.lng},calculatedAt,expiresAt,result};
  // One short-lived record per trip, never a persisted history of every GPS origin.
  const saved=await env.DB.prepare('INSERT INTO road_route_cache(cache_key,route_json,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM trips t JOIN captain_presence p ON p.application_id=t.driver_id WHERE t.id=? AND t.status=? AND t.driver_id=? AND t.rider_id=? AND t.destination_json=? AND p.location_at=? AND p.latitude=? AND p.longitude=? AND p.accuracy=?) ON CONFLICT(cache_key) DO UPDATE SET route_json=excluded.route_json,expires_at=excluded.expires_at').bind(key,JSON.stringify(cache),expiresAt,trip.id,trip.status,trip.driver_id,trip.rider_id,trip.destination_json||JSON.stringify(trip.destination),location.at,location.lat,location.lng,location.accuracy).run();
  if(!saved.meta?.changes)return unavailable(trip,target,'trip_changed');
  return result;
 })();
 state.inFlight.set(requestKey,{locationAt:location.at,promise:work});try{return await work}finally{state.inFlight.delete(requestKey)}
}
export async function riderTrackingView(env,trip){
 if(!trip)return trip;
 const safe=withoutRawTracking(trip);
 if(!activeStatuses.has(trip.status)||trip.is_demo){await clearTripTracking(env,trip.id);return {...safe,driverLocation:null,eta:null}}
 const eta=await calculateEta(env,trip),fresh=await currentTracking(env,trip.id);
 if(!fresh||fresh.driver_id!==trip.driver_id||fresh.rider_id!==trip.rider_id||!activeStatuses.has(fresh.status)){
  await clearTripTracking(env,trip.id);return {...safe,status:fresh?.status||trip.status,driverLocation:null,eta:null};
 }
 const driverLocation=await captainLocationForTrip(env,{...trip,status:fresh.status,driver_lat:fresh.latitude,driver_lng:fresh.longitude,driver_accuracy:fresh.accuracy,driver_location_at:fresh.location_at});
 if(fresh.destination_json!==(trip.destination_json||JSON.stringify(trip.destination)))return {...safe,driverLocation,eta:unavailable(trip,fresh.status==='riding'?'destination':'pickup','trip_changed')};
 if(fresh.status!==trip.status)return {...safe,status:fresh.status,driverLocation,eta:unavailable(trip,fresh.status==='riding'?'destination':'pickup','trip_changed')};
 const reason=!driverLocation?'location_unavailable':!driverLocation.fresh?'location_stale':trip.driverLocation&&!sameLocation(fresh,trip.driverLocation)?'location_changed':null;
 return {...safe,driverLocation,eta:reason&&eta?.status==='available'?unavailable(trip,eta.target,reason):eta};
}
