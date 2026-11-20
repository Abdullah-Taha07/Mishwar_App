import assert from 'node:assert/strict';

// RIDER-014: deliberately invented places/road facts at the provider boundary.
// These fixtures prove adapter/UI behavior, never TomTom's real-world accuracy.
export const MAP_PLACES = Object.freeze({
  a: {name: 'فرع تجربة مشوار', area: 'فرع غربي اصطناعي', lat: 24.7136, lng: 46.6753},
  b: {name: 'فرع تجربة مشوار', area: 'فرع شرقي اصطناعي', lat: 24.7136, lng: 46.6953},
  street: {name: 'شارع الملك التجريبي', area: 'شارع اصطناعي', lat: 24.718, lng: 46.681},
  district: {name: 'حي التجربة', area: 'حي اصطناعي', lat: 24.725, lng: 46.689},
  landmark: {name: 'برج مشوار التجريبي', area: 'معلم اصطناعي', lat: 24.737, lng: 46.705},
  other: {name: 'متحف مشوار التجريبي', area: 'معلم بديل اصطناعي', lat: 24.749, lng: 46.717},
});
export const MAP_QUERIES = Object.freeze([
  {language: 'ar', kind: 'street', query: 'شارع الملك التجريبي', place: 'street'},
  {language: 'en', kind: 'street', query: 'King Fixture Road', place: 'street'},
  {language: 'ar', kind: 'district', query: 'حي التجربة', place: 'district'},
  {language: 'en', kind: 'district', query: 'Fixture District', place: 'district'},
  {language: 'ar', kind: 'landmark', query: 'برج مشوار التجريبي', place: 'landmark'},
  {language: 'en', kind: 'landmark', query: 'Mishwar Fixture Tower', place: 'landmark'},
]);
const normalize = value => String(value).trim().toLowerCase().replace(/^(حي|شارع|طريق)\s+/, '').replace(/،?\s+الرياض$/, '');
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const pointValid = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= 24.3 && point.lat <= 25.1 && point.lng >= 46.3 && point.lng <= 47.1;
const providerPoint = point => ({type: 'POI', poi: {name: point.name}, position: {lat: point.lat, lon: point.lng}, address: {freeformAddress: point.name, municipality: 'الرياض', municipalitySubdivision: point.area}});

export function createSearchMapsProvider() {
  const searches = new Map(), held = [], audit = [];
  for (const row of MAP_QUERIES) searches.set(normalize(row.query), {points: [MAP_PLACES[row.place]], mode: 'success'});
  searches.set(normalize(MAP_PLACES.a.name), {points: [MAP_PLACES.a, MAP_PLACES.b], mode: 'success'});
  searches.set(normalize(MAP_PLACES.other.name), {points: [MAP_PLACES.other], mode: 'success'});
  let routeMode = 'success';
  async function controlled(row, mode, makeResponse, signal) {
    row.mode = mode;
    if (mode === 'fail') {row.status = 503; return json({error: 'Declared local provider failure'}, 503);}
    if (mode === 'disconnect') {row.disconnected = true; throw Error('Declared local provider connection failure');}
    if (mode === 'hold' || mode === 'timeout') {
      row.held = true;
      return new Promise((resolve, reject) => {
        const entry = {row, release: () => {row.released = true; row.status = 200; resolve(makeResponse());}, reject};
        held.push(entry);
        signal?.addEventListener('abort', () => {row.aborted = true; reject(signal.reason || new DOMException('Aborted', 'AbortError'));}, {once: true});
      });
    }
    row.status = 200;
    return makeResponse();
  }
  async function fetchFixture({request, url, body, operation, scenarioId}) {
    assert.ok(request instanceof Request && url instanceof URL, 'Use the actual provider-boundary request and URL');
    assert.equal(request.method, 'GET');
    assert.equal(body, null);
    assert.equal(url.origin, 'https://api.tomtom.com');
    assert.equal(new URL(request.url).href, url.href);
    assert.equal(url.searchParams.get('key'), 'offline-journey-tomtom-only', 'Only the deliberately fake helper key is accepted');
    const row = {scenarioId, operation, synthetic: true}; audit.push(row);
    if (operation === 'search') {
      assert.match(url.pathname, /^\/search\/2\/search\/.+\.json$/);
      const query = decodeURIComponent(url.pathname.slice('/search/2/search/'.length).replace(/\.json$/, ''));
      row.query = query;
      const spec = searches.get(normalize(query)) || {points: [], mode: 'success'};
      return controlled(row, spec.mode, () => json({results: spec.points.map(providerPoint)}), request.signal);
    }
    if (operation === 'reverse') {
      assert.match(url.pathname, /^\/search\/2\/reverseGeocode\//);
      const [lat, lng] = url.pathname.slice('/search/2/reverseGeocode/'.length).replace(/\.json$/, '').split(',').map(Number);
      assert.ok(pointValid({lat, lng}), 'Reverse only accepts invented Riyadh fixture coordinates');
      row.point = {lat, lng}; row.mode = 'success'; row.status = 200;
      return json({addresses: [{position: lat + ',' + lng, address: {freeformAddress: 'عنوان عكسي اصطناعي', municipality: 'الرياض', municipalitySubdivision: 'محاكاة محلية'}}]});
    }
    assert.equal(operation, 'route', 'Unknown providers and operations cannot escape into native fetch');
    assert.match(url.pathname, /^\/routing\/1\/calculateRoute\/.+\/json$/);
    const points = url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/, '').split(':').map(part => {const [lat, lng] = part.split(',').map(Number); return {lat, lng};});
    assert.ok(points.length >= 2 && points.length <= 4 && points.every(pointValid));
    assert.equal(url.searchParams.get('traffic'), 'true'); assert.equal(url.searchParams.get('travelMode'), 'car');
    row.points = points; row.trafficRequested = true;
    const mode = routeMode;
    const distanceMeters = 4850, durationSeconds = 650, trafficDelaySeconds = 85;
    row.metrics = {distanceMeters, durationSeconds, trafficDelaySeconds};
    return controlled(row, mode, () => {
      const shift = mode === 'wrong-route' ? .3 : 0;
      return json({routes: [{summary: {lengthInMeters: distanceMeters, travelTimeInSeconds: durationSeconds, trafficDelayInSeconds: trafficDelaySeconds}, legs: points.slice(1).map((point, i) => ({points: [points[i], {lat: (points[i].lat + point.lat) / 2 + .003, lng: (points[i].lng + point.lng) / 2 - .003}, point].map(p => ({latitude: p.lat + shift, longitude: p.lng + shift}))}))}]});
    }, request.signal);
  }
  return {
    fetch: fetchFixture, audit,
    setSearch(query, {points = [], mode = 'success'} = {}) {searches.set(normalize(query), {points, mode});},
    setRouteMode(mode = 'success') {assert.ok(['success', 'fail', 'disconnect', 'hold', 'timeout', 'wrong-route'].includes(mode)); routeMode = mode;},
    get held() {return held.filter(entry => !entry.row.released && !entry.row.aborted).map(entry => entry.row);},
    releaseHeld(operation) {for (const entry of held) if (!entry.row.released && !entry.row.aborted && (!operation || entry.row.operation === operation)) entry.release();},
  };
}
