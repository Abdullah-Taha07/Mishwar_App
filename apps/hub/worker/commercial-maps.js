import {boundedRoadJson,checkedRouteSnapshot} from './road-data.js';
import {secretMatches} from './operations.js';

const validPoint = point => !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
const configured = env => env.TOMTOM_ENABLED === 'true' && typeof env.TOMTOM_API_KEY === 'string' && env.TOMTOM_API_KEY.trim().length > 0;
// Match the existing OSRM waypoint-to-road limit in routing.js. Road snapping
// may move an endpoint, but must not turn a different itinerary into this one.
const MAX_ROAD_SNAP_METERS = 2000;
function pointDistanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function checkItineraryLegs(legs, points) {
  if (legs.length !== points.length - 1) throw Error('المسار لا يطابق محطات الرحلة. أعد حساب المسار.');
  for (let index = 0; index < legs.length; index++) {
    const start = legs[index].points[0], end = legs[index].points.at(-1);
    if (pointDistanceMeters(points[index], {lat: start.latitude, lng: start.longitude}) > MAX_ROAD_SNAP_METERS || pointDistanceMeters(points[index + 1], {lat: end.latitude, lng: end.longitude}) > MAX_ROAD_SNAP_METERS) throw Error('المسار لا يطابق نقاط الرحلة. أعد حساب المسار.');
    // A single LineString must not invent a connector between separate legs.
    // Equal endpoints retain the provider's own precision and snapped location.
    const previous = legs[index - 1]?.points.at(-1);
    if (previous && (previous.latitude !== start.latitude || previous.longitude !== start.longitude)) throw Error('أجزاء المسار غير متصلة. أعد حساب المسار.');
  }
}

export async function commercialRoad(env, points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 4 || !points.every(validPoint)) throw Error('حدد الانطلاق والوجهة من الخريطة');
  if (typeof env.TOMTOM_API_KEY !== 'string' || !env.TOMTOM_API_KEY.trim()) throw Error('خدمة المسارات التجارية بانتظار التفعيل');
  const coords = points.map(point => point.lat + ',' + point.lng).join(':');
  const url = new URL('https://api.tomtom.com/routing/1/calculateRoute/' + coords + '/json');
  url.search = new URLSearchParams({key: env.TOMTOM_API_KEY, traffic: 'true', travelMode: 'car', routeType: 'fastest', departAt: 'now', computeTravelTimeFor: 'all', language: 'ar'});
  const body = await boundedRoadJson(url, {}, 10000, env), route = body?.routes?.[0];
  if (!route || !Number.isFinite(route.summary?.lengthInMeters) || !Number.isFinite(route.summary?.travelTimeInSeconds)) throw Error('بيانات المسار التجاري ناقصة');
  if (!Array.isArray(route.legs) || !route.legs.length || route.legs.some(leg => !Array.isArray(leg?.points) || leg.points.length < 2)) throw Error('إحداثيات الطريق غير صحيحة. أعد حساب المسار.');
  const coordinates = route.legs.flatMap(leg => leg.points.map(point => [point?.longitude, point?.latitude]));
  const result = checkedRouteSnapshot({
    distanceMeters: route.summary.lengthInMeters, durationSeconds: route.summary.travelTimeInSeconds,
    trafficDelaySeconds: route.summary.trafficDelayInSeconds === undefined ? 0 : route.summary.trafficDelayInSeconds, trafficAware: true, provider: 'TomTom',
    geometry: {type: 'LineString', coordinates}, demoProvider: false, calculatedAt: new Date().toISOString(),
  });
  checkItineraryLegs(route.legs, points);
  return result;
}

function coordinate(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return NaN;
  return Number(value);
}
function placePosition(item, reverse) {
  // Reverse Geocode v2 returns "latitude,longitude"; Search v2 returns a numeric object.
  const position = item?.position;
  if (reverse && typeof position === 'string') {
    const parts = position.split(',');
    if (parts.length !== 2) return null;
    const point = {lat: coordinate(parts[0]), lng: coordinate(parts[1])};
    return validPoint(point) ? point : null;
  }
  const point = {lat: position?.lat, lng: position?.lon};
  return validPoint(point) ? point : null;
}
const text = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
function feature(item, reverse) {
  const point = placePosition(item, reverse);
  if (!point) return null; // Never manufacture a POI at the query's bias coordinates.
  const address = item?.address || {}, street = text(address.streetName);
  return {
    type: 'Feature', geometry: {type: 'Point', coordinates: [point.lng, point.lat]},
    properties: {name: text(item?.poi?.name) || street || text(address.freeformAddress) || 'موقع مختار',
      street, city: text(address.municipality) || 'الرياض', district: text(address.municipalitySubdivision), country: 'السعودية'},
  };
}

export async function commercialPlaces(request, env) {
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
  if (!await secretMatches(request.headers.get('x-mishwar-key'), env.RIDER_SERVICE_KEY)) return json({error: 'غير مسموح'}, 403);
  const incoming = new URL(request.url);
  if (incoming.pathname.endsWith('/config')) return json({
    provider: env.TOMTOM_MAPS_BROWSER_KEY ? 'TomTom' : 'OpenStreetMap', browserKey: env.TOMTOM_MAPS_BROWSER_KEY || null, googleMapsBrowserKey: env.GOOGLE_MAPS_BROWSER_KEY || null,
    searchConfigured: configured(env), searchProvider: configured(env) ? 'TomTom' : 'Photon',
  });
  if (!configured(env)) return json({error: 'خدمة الأماكن التجارية بانتظار التفعيل'}, 503);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 16384) throw Error();
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
  } catch { return json({error: 'بيانات البحث غير صحيحة'}, 400); }
  const lat = coordinate(body.lat), lng = coordinate(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 23.8 || lat > 25.5 || lng < 45.5 || lng > 48) return json({error: 'حدد موقع البحث داخل الرياض'}, 400);
  const reverse = incoming.pathname.endsWith('/reverse'), query = text(body.q).slice(0, 100);
  if (!reverse && query.length < 2) return json({error: 'اكتب حرفين على الأقل'}, 400);
  try {
    const bucket = 'places:' + String(body.clientIp || '').slice(0, 100) + ':' + Math.floor(Date.now() / 60000);
    const rate = await env.DB.prepare('INSERT INTO access_rate_limits VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket).first();
    if (rate.n > 50) return json({error: 'طلبات كثيرة'}, 429);
    const url = new URL(reverse ? 'https://api.tomtom.com/search/2/reverseGeocode/' + lat + ',' + lng + '.json' : 'https://api.tomtom.com/search/2/search/' + encodeURIComponent(query) + '.json');
    url.search = new URLSearchParams({key: env.TOMTOM_API_KEY, language: 'ar', countrySet: 'SA', lat: String(lat), lon: String(lng), radius: '50000', limit: '30'});
    const data = await boundedRoadJson(url, {}, 8000, env), rows = reverse ? data?.addresses : data?.results;
    if (!Array.isArray(rows)) throw Error('PLACE_RESPONSE_SHAPE');
    return json({provider: 'TomTom', features: rows.map(item => feature(item, reverse)).filter(Boolean)});
  } catch (error) {
    // Do not expose provider URLs, the server key, SQL failures or raw provider bodies.
    return json({error: error?.name === 'TimeoutError' ? 'انتهت مهلة البحث عن الأماكن. أعد المحاولة.' : 'تعذر البحث لدى مزود الأماكن. أعد المحاولة.'}, error?.name === 'TimeoutError' ? 504 : 400);
  }
}
