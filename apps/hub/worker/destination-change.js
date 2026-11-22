import {drivingItinerary} from './routing.js';
import {assertPriceableRoute} from './road-data.js';
import {cityMarket} from './expansion.js';
import {distanceKm} from './dispatch.js';
import {logEvent} from './operations.js';
import {realtimeTrip} from './realtime.js';

const active = new Set(['arriving','arrived','riding']);
const now = () => new Date(Date.now()).toISOString();
const fail = (code,ar,en,status=409) => Object.assign(Error(ar),{code,errorEn:en,status});
const changed = () => fail('DESTINATION_TRIP_CHANGED','تغيرت الرحلة أو انتهت صلاحية الطلب. حدّث الحالة.','The trip changed or the request expired. Refresh the trip.');
const conflict = () => fail('DESTINATION_REQUEST_CONFLICT','يوجد طلب وجهة مفتوح أو تمت معالجة هذا الطلب. حدّث الحالة.','A destination request is already open or was already decided. Refresh the trip.');

export function destinationError(error) {
 if(error.code?.startsWith('DESTINATION_'))return error;
 if(/DESTINATION_|one_open_destination_change|UNIQUE constraint failed: trip_destination_changes/.test(error.message||''))return changed();
 return error;
}
function destinationPoint(point) {
 if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180||typeof point.name!=='string'||!point.name.trim()||point.name.length>150)
  throw fail('DESTINATION_INVALID','اختر وجهة صحيحة من الخريطة.','Choose a valid destination on the map.',400);
 return {name:point.name.trim(),area:typeof point.area==='string'?point.area.trim().slice(0,150):'',lat:point.lat,lng:point.lng};
}
function publicChange(row) {
 if(!row)return null;
 return {id:row.id,tripId:row.trip_id,status:row.status,destination:JSON.parse(row.destination_json),oldDestination:JSON.parse(row.old_destination_json),
  oldFare:row.old_fare_halalas,newFare:row.new_fare_halalas,fareDifference:row.new_fare_halalas-row.old_fare_halalas,
  oldCashDue:row.old_cash_due_halalas,newCashDue:row.new_cash_due_halalas,route:JSON.parse(row.route_json),
  fareBasis:'original_pickup_to_new_destination',createdAt:row.created_at,expiresAt:row.expires_at,consentedAt:row.consented_at,decidedAt:row.decided_at};
}
async function expire(env,tripId) {
 await env.DB.prepare("UPDATE trip_destination_changes SET status='expired',decided_at=? WHERE trip_id=? AND status IN ('quoted','pending') AND expires_at<=?").bind(now(),tripId,now()).run();
}
export async function destinationChanges(env,tripId) {
 await expire(env,tripId);
 return (await env.DB.prepare('SELECT * FROM trip_destination_changes WHERE trip_id=? ORDER BY rowid DESC LIMIT 30').bind(tripId).all()).results.map(publicChange);
}
export async function destinationState(env,tripId) {
 await expire(env,tripId);
 const latest=await env.DB.prepare('SELECT * FROM trip_destination_changes WHERE trip_id=? ORDER BY rowid DESC LIMIT 1').bind(tripId).first();
 const accepted=await env.DB.prepare("SELECT id FROM trip_destination_changes WHERE trip_id=? AND status='accepted' ORDER BY rowid DESC LIMIT 1").bind(tripId).first();
 return {destinationChange:publicChange(latest),destinationRevision:accepted?.id||null};
}
async function tripFor(env,role,actor,tripId) {
 const t=await env.DB.prepare("SELECT t.*,c.method,c.discount_halalas,c.cash_due_halalas,c.coupon,c.quote_id,q.category,opt.stops_json,EXISTS(SELECT 1 FROM trip_negotiations WHERE trip_id=t.id) AS negotiated FROM trips t JOIN trip_commerce c ON c.trip_id=t.id JOIN ride_quotes q ON q.id=c.quote_id LEFT JOIN trip_options opt ON opt.trip_id=t.id WHERE t.id=?").bind(typeof tripId==='string'?tripId:'').first();
 if(!t||(role==='rider'?t.rider_id!==actor:t.driver_id!==actor))throw fail('DESTINATION_TRIP_CHANGED','الرحلة ليست مرتبطة بحسابك.','This trip does not belong to your account.',403);
 if(t.is_demo||!t.driver_id||!active.has(t.status))throw changed();
 await expire(env,t.id);
 return t;
}
function eligible(t) {
 if(t.method!=='cash'||t.payment_status!=='cash_due'||t.discount_halalas||t.coupon||t.negotiated||JSON.parse(t.stops_json||'[]').length||t.cash_due_halalas!==t.fare_halalas)
  throw fail('DESTINATION_POLICY_UNSUPPORTED','تغيير الوجهة متاح حاليًا للرحلات النقدية بالسعر التلقائي دون قسيمة أو محطات. تبقى وجهتك والمبلغ الحاليان محفوظين.','Destination changes currently support cash trips with automatic pricing, no coupon and no stops. Your current destination and total remain unchanged.');
}
async function announce(env,id) {await realtimeTrip(env,id,'destination_change').catch(()=>{});}
export async function riderDestinationAction(env,rider,b) {
 const t=await tripFor(env,'rider',rider,b.tripId);
 if(b.action==='live_destination_quote') {
  eligible(t);
  const destination=destinationPoint(b.destination),pickup=JSON.parse(t.pickup_json),old=JSON.parse(t.destination_json);
  if(distanceKm(destination,old)<0.01)throw fail('DESTINATION_INVALID','اختر وجهة مختلفة عن الوجهة الحالية.','Choose a destination different from the current one.',400);
  if(await env.DB.prepare("SELECT id FROM trip_destination_changes WHERE trip_id=? AND status IN ('quoted','pending')").bind(t.id).first())throw conflict();
  const bucket='destination-quote:'+rider+':'+Math.floor(Date.now()/60000);
  const count=await env.DB.prepare('INSERT INTO access_rate_limits(bucket,n) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket).first();
  if(count.n>6)throw fail('DESTINATION_RATE_LIMIT','طلبات كثيرة. انتظر دقيقة قبل إعادة حساب الوجهة.','Too many requests. Wait a minute before trying again.',429);
  await env.DB.prepare("DELETE FROM access_rate_limits WHERE bucket LIKE 'destination-quote:%' AND bucket NOT LIKE ?").bind('%:'+Math.floor(Date.now()/60000)).run();
  let route;
  try {
   const approved=env.TOMTOM_ENABLED==='true'&&!!env.TOMTOM_API_KEY?.trim()||!!env.OSRM_BASE_URL?.trim();
   if(!approved)throw Error('PROVIDER_UNAVAILABLE');
   route=assertPriceableRoute(env,await drivingItinerary(env,pickup,destination,[],{cache:false,requireTrusted:true}));
   if(route.demoProvider||route.stale||!route.geometry)throw Error('PROVIDER_UNAVAILABLE');
   const coords=route.geometry.coordinates,first=coords[0],last=coords.at(-1);
   if(distanceKm(pickup,{lng:first[0],lat:first[1]})>2||distanceKm(destination,{lng:last[0],lat:last[1]})>2)throw Error('PROVIDER_ITINERARY_MISMATCH');
  } catch {
   await logEvent(env,'rider','destination_change_unavailable',rider,t.id,{reason:'route_unavailable',destination});
   return {change:{id:null,tripId:t.id,status:'unavailable',reason:'route_unavailable',destination,oldFare:t.fare_halalas,newFare:null,fareDifference:null,oldCashDue:t.cash_due_halalas,newCashDue:null,route:null},message:'تعذر تأكيد الطريق والسعر. لم تتغير الرحلة.',messageEn:'Route and fare could not be verified. The trip is unchanged.'};
  }
  const priced=await cityMarket(env,pickup,route,t.category);
  if(!Number.isSafeInteger(priced.fare)||priced.fare<1000||priced.fare>10000000)throw changed();
  const id=crypto.randomUUID(),quote=crypto.randomUUID(),at=now(),expiresAt=new Date(Date.now()+120000).toISOString();
  const snapshot=JSON.stringify({...route,city:priced.city.id,market:{multiplier:priced.multiplier,demand:priced.demand,supply:priced.supply},breakdown:priced.breakdown});
  try {await env.DB.batch([
   env.DB.prepare('INSERT INTO ride_quotes(id,rider_id,pickup_json,destination_json,category,fare_halalas,discount_halalas,coupon,commission_bps,expires_at,route_json) VALUES(?,?,?,?,?,?,0,NULL,?,?,?)').bind(quote,rider,t.pickup_json,JSON.stringify(destination),t.category,priced.fare,t.commission_bps,expiresAt,snapshot),
   env.DB.prepare("INSERT INTO trip_destination_changes(id,trip_id,rider_id,captain_id,status,pickup_json,old_destination_json,destination_json,old_fare_halalas,new_fare_halalas,old_cash_due_halalas,new_cash_due_halalas,old_quote_id,quote_id,route_json,category,commission_bps,created_at,expires_at) VALUES(?,?,?,?,'quoted',?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,t.id,rider,t.driver_id,t.pickup_json,t.destination_json,JSON.stringify(destination),t.fare_halalas,priced.fare,t.cash_due_halalas,priced.fare,t.quote_id,quote,snapshot,t.category,t.commission_bps,at,expiresAt),
  ])}catch(e){throw destinationError(e)}
  await announce(env,t.id);
  return {change:publicChange(await env.DB.prepare('SELECT * FROM trip_destination_changes WHERE id=?').bind(id).first())};
 }
 const row=await env.DB.prepare('SELECT * FROM trip_destination_changes WHERE id=? AND trip_id=? AND rider_id=?').bind(typeof b.changeId==='string'?b.changeId:'',t.id,rider).first();
 if(!row)throw changed();
 let status;
 if(b.action==='live_destination_request') {
  eligible(t);
  if(b.consent!==true)throw fail('DESTINATION_CONSENT_REQUIRED','راجع الوجهة والسعر الإجمالي والفرق وأكد موافقتك صراحة.','Review the destination, new total and fare difference, then explicitly consent.',400);
  if(row.status!=='quoted')throw conflict();
  // Only the immutable change ID is accepted. Client prices and destinations
  // cannot replace the facts which the rider just reviewed.
  if(['destination','newFare','fare','quoteId'].some(key=>b[key]!==undefined))throw changed();
  status='pending';
 } else if(b.action==='live_destination_withdraw') {
  if(!['quoted','pending'].includes(row.status))throw conflict();
  status='withdrawn';
 } else throw changed();
 let result;
 try {result=await env.DB.prepare('UPDATE trip_destination_changes SET status=?,consented_at=?,decided_at=? WHERE id=? AND status=? RETURNING id').bind(status,status==='pending'?now():row.consented_at,status==='withdrawn'?now():null,row.id,row.status).first()}catch(e){throw destinationError(e)}
 if(!result)throw conflict();
 await announce(env,t.id);
 return {ok:true,change:(await destinationState(env,t.id)).destinationChange};
}
export async function captainDestinationAction(env,captain,b) {
 const t=await tripFor(env,'captain',captain,b.tripId);
 if(typeof b.accept!=='boolean')throw fail('DESTINATION_INVALID','اختر قبول الطلب أو رفضه صراحة.','Explicitly accept or reject the request.',400);
 const row=await env.DB.prepare("SELECT * FROM trip_destination_changes WHERE id=? AND trip_id=? AND captain_id=? AND status='pending'").bind(typeof b.changeId==='string'?b.changeId:'',t.id,captain).first();
 if(!row)throw conflict();
 if(b.accept)eligible(t);
 let result;
 try {result=await env.DB.prepare("UPDATE trip_destination_changes SET status=?,decided_at=? WHERE id=? AND status='pending' RETURNING id").bind(b.accept?'accepted':'rejected',now(),row.id).first()}catch(e){throw destinationError(e)}
 if(!result)throw conflict();
 await announce(env,t.id);
 return {ok:true,change:(await destinationState(env,t.id)).destinationChange};
}
