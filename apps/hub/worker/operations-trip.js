import {destinationState} from './destination-change.js';
import {tripStopProgress} from './stop-progress.js';
import {captainLocationForTrip,riderTrackingView} from './live-tracking.js';

// Read behind the existing administration authorization boundary. Keep the
// same stop and tracking contracts as the rider, including freshness checks.
export async function operationsTrip(env,id){
 const row=await env.DB.prepare(`SELECT t.*,r.name AS rider_name,r.phone AS rider_phone,
  o.stops_json,o.guest_name,o.business_note,c.method,c.cash_due_halalas,
  p.latitude AS driver_lat,p.longitude AS driver_lng,p.accuracy AS driver_accuracy,p.location_at AS driver_location_at
  FROM trips t LEFT JOIN riders r ON r.id=t.rider_id
  LEFT JOIN trip_options o ON o.trip_id=t.id LEFT JOIN trip_commerce c ON c.trip_id=t.id
  LEFT JOIN captain_presence p ON p.application_id=t.driver_id WHERE t.id=?`).bind(id).first();
 if(!row)return null;
 const events=(await env.DB.prepare('SELECT source,action,created_at,details_json FROM operation_events WHERE entity_id=? ORDER BY created_at,id').bind(id).all()).results;
 const trip={...row,...await destinationState(env,id),
  pickup:JSON.parse(row.pickup_json),destination:JSON.parse(row.destination_json),
  options:{stops:JSON.parse(row.stops_json||'[]'),guestName:row.guest_name||'',businessNote:row.business_note||''},
  stopProgress:await tripStopProgress(env,row),driverLocation:await captainLocationForTrip(env,row),events};
 return riderTrackingView(env,trip);
}
