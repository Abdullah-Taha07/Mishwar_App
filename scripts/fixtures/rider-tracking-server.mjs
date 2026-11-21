import assert from 'node:assert/strict';
import {startJourneyServer} from './rider-journey-server.mjs';

// RDEV-003 uses the actual rider gateway, authenticated captain API, shared
// Worker and fresh in-memory SQLite. Only provider/sensor facts are synthetic.
const PICKUP={name:'انطلاق تجربة مشوار',area:'موقع اصطناعي للاختبار',lat:24.7136,lng:46.6753};
const DESTINATION={name:'وجهة تجربة مشوار',area:'موقع اصطناعي للاختبار',lat:24.721,lng:46.684};
const nearby=(a,b)=>Math.abs(a.lat-b.lat)+Math.abs(a.lng-b.lng)<.000001;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});

export async function startTrackingServer(options={}){
  const controls={routeMode:'ready',routeCalls:0,releases:[],facts:[]};
  async function provider({url,operation}){
    if(operation==='search'){
      const query=decodeURIComponent(url.pathname.slice('/search/2/search/'.length).replace(/\.json$/,''));
      const p=/انطلاق|pickup/i.test(query)?PICKUP:DESTINATION;
      return json({results:[{type:'POI',poi:{name:p.name},position:{lat:p.lat,lon:p.lng},address:{freeformAddress:p.name,municipality:'الرياض',municipalitySubdivision:p.area}}]});
    }
    if(operation==='reverse'){
      const [lat,lng]=url.pathname.slice('/search/2/reverseGeocode/'.length).replace(/\.json$/,'').split(',').map(Number);
      assert.ok(Number.isFinite(lat)&&Number.isFinite(lng));
      const p=Math.hypot(lat-PICKUP.lat,lng-PICKUP.lng)<Math.hypot(lat-DESTINATION.lat,lng-DESTINATION.lng)?PICKUP:DESTINATION;
      return json({addresses:[{position:lat+','+lng,address:{freeformAddress:p.name,streetName:p.name,municipality:'الرياض',municipalitySubdivision:p.area}}]});
    }
    assert.equal(operation,'route');
    const raw=url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/,'');
    const points=raw.split(':').map(pair=>{const [lat,lng]=pair.split(',').map(Number);return {lat,lng}});
    assert.ok(points.length>=2&&points.length<=4&&points.every(p=>p.lat>=24&&p.lat<=25&&p.lng>=46&&p.lng<=47),'Synthetic routes stay within declared test coordinates');
    controls.routeCalls++;
    const isQuote=nearby(points[0],PICKUP)&&nearby(points.at(-1),DESTINATION),isPickup=nearby(points.at(-1),PICKUP);
    const facts=isQuote?{distanceMeters:2400,durationSeconds:480,trafficDelaySeconds:0}:isPickup?{distanceMeters:1000,durationSeconds:240,trafficDelaySeconds:35}:{distanceMeters:2200,durationSeconds:420,trafficDelaySeconds:40};
    controls.facts.push({...facts,isQuote,target:isPickup?'pickup':'destination',synthetic:true});
    if(controls.routeMode==='failure')return json({error:'Declared synthetic road outage'},503);
    if(controls.routeMode==='hold')await new Promise(resolve=>controls.releases.push(resolve));
    return json({routes:[{summary:{lengthInMeters:facts.distanceMeters,travelTimeInSeconds:facts.durationSeconds,trafficDelayInSeconds:facts.trafficDelaySeconds},legs:points.slice(1).map((end,i)=>({points:[points[i],end].map(p=>({latitude:p.lat,longitude:p.lng}))}))}]});
  }
  const lab=await startJourneyServer({...options,tomtomFixture:provider});
  const gps=async(point,extra={})=>{
    const trip=(await lab.snapshot()).trip;
    const previous=lab.env.db.prepare('SELECT location_at FROM captain_presence WHERE application_id=?').get(trip?.driver_id||lab.env.db.prepare('SELECT id FROM captain_applications LIMIT 1').get().id);
    const observedAt=new Date(Math.max(Date.now(),Date.parse(previous?.location_at||'')+1||0)).toISOString();
    return lab.captainCommand({action:'location',lat:point.lat,lng:point.lng,accuracy:8,heading:90,observedAt,...(trip&&['arriving','arrived','riding'].includes(trip.status)?{tripId:trip.id}:{}),...extra});
  };
  const originalClose=lab.close;
  return {...lab,get env(){return lab.env},get fixture(){return lab.fixture},controls,gps,
    releaseRoutes(){for(const release of controls.releases.splice(0))release()},
    invalidateEtaCache(){lab.env.db.prepare("DELETE FROM road_route_cache WHERE cache_key LIKE 'live-eta:%'").run()},
    ageGpsForFixture(){
      const trip=lab.env.db.prepare("SELECT driver_id FROM trips WHERE status IN ('arriving','arrived','riding') LIMIT 1").get();assert.ok(trip?.driver_id);
      // Explicit stale-sensor failure injection into isolated test DB only.
      const at=new Date(Date.now()-35000).toISOString();
      lab.env.db.prepare('UPDATE captain_presence SET location_at=? WHERE application_id=?').run(at,trip.driver_id);
      const row=lab.env.db.prepare('SELECT value FROM platform_settings WHERE key=?').get('tracking-captain:'+trip.driver_id);
      if(row){const metadata=JSON.parse(row.value);metadata.at=at;lab.env.db.prepare('UPDATE platform_settings SET value=? WHERE key=?').run(JSON.stringify(metadata),'tracking-captain:'+trip.driver_id)}
    },
    async close(){for(const release of controls.releases.splice(0))release();await originalClose()},
    disclosure:'Real local rider/captain gateways, Worker, authentication and migration-backed SQLite; seeded eligible captain/documents and synthetic SMS/TomTom/GPS facts. No real provider or customer.'};
}
