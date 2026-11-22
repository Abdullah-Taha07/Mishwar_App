// RDEV-005: keep stop arrival/departure evidence in the existing append-only
// operations ledger. Never recalculate the booked fare or alter any wallet.
import {realtimeTrip} from './realtime.js';

const stopId = (tripId, index, phase) => `trip-stop:${tripId}:${index}:${phase}`;
const error = (code, text, status=409) => Object.assign(new Error(text), {code, status});
const parsedStops = trip => {
  if(Array.isArray(trip.options?.stops))return trip.options.stops;
  try{const value=JSON.parse(trip.stops_json||'[]');return Array.isArray(value)?value:[]}catch{return []}
};

export function stopSnapshot(trip, events=[]) {
  const stops=parsedStops(trip).slice(0,2).map((point,index)=>({index,point,status:'pending',arrivedAt:null,departedAt:null,waitSeconds:0}));
  if(!stops.length)return null;
  const known=new Map(events.map(row=>[row.id,row.created_at]));
  for(const stop of stops){
    stop.arrivedAt=known.get(stopId(trip.id,stop.index,'arrived'))||null;
    stop.departedAt=known.get(stopId(trip.id,stop.index,'departed'))||null;
    stop.status=stop.departedAt?'departed':stop.arrivedAt?'arrived':'pending';
    if(stop.arrivedAt){const start=Date.parse(stop.arrivedAt),end=stop.departedAt?Date.parse(stop.departedAt):Date.now();stop.waitSeconds=Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)):0}
  }
  const nextIndex=stops.findIndex(stop=>stop.status!=='departed');
  return {stops,nextIndex:nextIndex<0?null:nextIndex,allDeparted:nextIndex<0};
}
export async function tripStopProgress(env,trip){
  if(!parsedStops(trip).length)return null;
  const rows=(await env.DB.prepare("SELECT id,created_at FROM operation_events WHERE entity_id=? AND source='captain' AND action IN ('trip_stop_arrived','trip_stop_departed')").bind(trip.id).all()).results;
  return stopSnapshot(trip,rows);
}
export async function captainStopAction(env,captain,b){
  const tripId=typeof b.tripId==='string'?b.tripId.trim():'';
  const index=b.stopIndex,phase=b.phase;
  if(!tripId||tripId.length>100||!Number.isInteger(index)||index<0||index>1||!['arrived','departed'].includes(phase))throw error('STOP_INVALID','اختر محطة وإجراء صحيحين.',400);
  const trip=await env.DB.prepare('SELECT t.id,t.driver_id,t.status,t.is_demo,o.stops_json FROM trips t LEFT JOIN trip_options o ON o.trip_id=t.id WHERE t.id=?').bind(tripId).first();
  if(!trip||trip.driver_id!==captain)throw error('STOP_FORBIDDEN','الرحلة ليست مسندة إلى حسابك.',403);
  if(trip.is_demo||trip.status!=='riding')throw error('STOP_TRIP_CHANGED','لا يمكن تحديث محطة خارج رحلة جارية.');
  const stops=parsedStops(trip);
  if(index>=stops.length)throw error('STOP_INVALID','المحطة غير موجودة في الحجز.',400);
  const before=await tripStopProgress(env,trip);
  const current=before.stops[index];
  // A repeated event is safe to acknowledge. Do not allow skipping a stop,
  // departing before arrival or going backwards after a later stop.
  if(phase==='arrived'&&current.arrivedAt||phase==='departed'&&current.departedAt)return {ok:true,idempotent:true,stopProgress:before};
  if(before.nextIndex!==index||phase==='departed'&&current.status!=='arrived'||phase==='arrived'&&current.status!=='pending')throw error('STOP_SEQUENCE_CONFLICT','ترتيب المحطات تغيّر؛ حدّث الرحلة وأعد المحاولة.');
  const id=stopId(tripId,index,phase),at=new Date().toISOString();
  const prev=index?stopId(tripId,index-1,'departed'):null;
  const arrived=stopId(tripId,index,'arrived');
  const sql="INSERT INTO operation_events(id,source,action,actor_id,entity_id,details_json,created_at) SELECT ?,'captain',?, ?,t.id,?,? FROM trips t JOIN trip_options o ON o.trip_id=t.id WHERE t.id=? AND t.driver_id=? AND t.status='riding' AND t.is_demo=0 AND json_array_length(o.stops_json)>? AND NOT EXISTS(SELECT 1 FROM operation_events WHERE id=?) AND (?=0 OR EXISTS(SELECT 1 FROM operation_events WHERE id=?)) AND (?='arrived' OR EXISTS(SELECT 1 FROM operation_events WHERE id=?))";
  const result=await env.DB.prepare(sql).bind(id,'trip_stop_'+phase,captain,JSON.stringify({stopIndex:index,name:stops[index].name}),at,tripId,captain,index,id,index,prev,phase,arrived).run();
  const after=await tripStopProgress(env,trip);
  if(!result.meta?.changes){
    if(after.stops[index][phase==='arrived'?'arrivedAt':'departedAt'])return {ok:true,idempotent:true,stopProgress:after};
    throw error('STOP_TRIP_CHANGED','تغيرت الرحلة أثناء تسجيل المحطة؛ حدّث البيانات.');
  }
  await realtimeTrip(env,tripId,'trip_stop_'+phase).catch(()=>{});
  return {ok:true,stopProgress:after};
}
