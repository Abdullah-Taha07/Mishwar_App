/* Optional Google Maps visualization for Mishwar.
 * Leaflet remains the authoritative booking/driver map and a safe offline fallback.
 * This file never determines fares, routes, identity or server GPS writes. */
(() => {
  'use strict';
  const rider = !!document.querySelector('.mobile-nav');
  const mapElement = document.getElementById(rider ? 'map' : 'driver-map');
  if (!mapElement) return;
  const parent = rider ? mapElement : (mapElement.parentElement || mapElement);
  const validKey = s => typeof s === 'string' && /^AIza[A-Za-z0-9_-]{25,80}$/.test(s);
  let apiKey = '', googleMap = null, layer = null, loading = null, enabled = false;
  let circles = [], polyline = null, syncTimer = null, routeGeometry = null, followDevice = true;
  const leaflet = () => rider ? (typeof liveMap !== 'undefined' ? liveMap : null) : (typeof map !== 'undefined' ? map : null);
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const note = message => { const status = document.getElementById('mishwar-google-map-status'); if (status) status.textContent = message; };
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'mishwar-map-provider'; button.hidden = true;
  button.className = 'mishwar-map-provider'; button.textContent = 'Google Maps';
  button.setAttribute('aria-label', 'التبديل بين خرائط Google والخريطة الحالية');
  const status = document.createElement('span'); status.id = 'mishwar-google-map-status'; status.className = 'mishwar-map-provider-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'mishwar-map-provider-controls';
  controls.append(button, status); parent.append(controls);
  const getCurrent = () => {
    const source = leaflet(); const center = source?.getCenter?.();
    return center && valid(center) ? {lat: center.lat, lng: center.lng} : {lat: 24.7136, lng: 46.6753};
  };
  function loadGoogle() {
    if (globalThis.google?.maps?.Map) return Promise.resolve(globalThis.google.maps);
    if (loading) return loading;
    if (!validKey(apiKey)) return Promise.reject(Error('GOOGLE_KEY_MISSING'));
    loading = new Promise((resolve, reject) => {
      const callback = '__mishwarGoogleReady_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let settled = false;
      const finish = (error) => {
        if (settled) return; settled = true; clearTimeout(timer); delete globalThis[callback];
        if (error) { script.remove(); reject(error); } else resolve(globalThis.google.maps);
      };
      const timer = setTimeout(() => finish(Error('GOOGLE_MAPS_TIMEOUT')), 15000);
      globalThis[callback] = () => finish(globalThis.google?.maps?.Map ? null : Error('GOOGLE_MAPS_UNAVAILABLE'));
      script.onerror = () => finish(Error('GOOGLE_MAPS_LOAD_FAILED'));
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({key: apiKey, v: 'weekly', loading: 'async', callback});
      document.head.append(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  function markers() {
    for (const circle of circles) circle.setMap(null); circles = [];
    if (polyline) { polyline.setMap(null); polyline = null; }
    const googleMaps = globalThis.google?.maps;
    if (!enabled || !googleMaps || !googleMap) return;
    const riderPickup = typeof pickupPoint !== 'undefined' ? pickupPoint : null;
    const destination = rider ? (typeof state !== 'undefined' ? state?.destination : null) : (typeof data !== 'undefined' ? data?.current?.destination : null);
    const captain = !rider && globalThis.captainGPS ? globalThis.captainGPS : null;
    const points = rider ? [{p:riderPickup,color:'#06b6d4'},{p:destination,color:'#083344'}] : [{p:captain,color:'#06b6d4'},{p:destination,color:'#083344'}];
    for (const {p,color} of points) if (valid(p)) {
      const circle = new googleMaps.Circle({map:googleMap,center:{lat:p.lat,lng:p.lng},radius:14,strokeColor:'#ffffff',strokeWeight:3,strokeOpacity:1,fillColor:color,fillOpacity:1,clickable:false});
      circles.push(circle);
    }
    const coordinates = routeGeometry?.type === 'LineString' ? routeGeometry.coordinates : null;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const path = coordinates.slice(0,2000).map(v => ({lat:v?.[1],lng:v?.[0]})).filter(valid);
      if (path.length >= 2) polyline = new googleMaps.Polyline({map:googleMap,path,strokeColor:'#06b6d4',strokeOpacity:.9,strokeWeight:5,clickable:false});
    }
  }
  let previousShape = '';
  function sync() {
    if (!enabled || document.hidden || !googleMap) return;
    const trip = !rider && typeof data !== 'undefined' ? data?.current : null;
    const candidate = rider ? [typeof pickupPoint !== 'undefined' ? pickupPoint : null,typeof state !== 'undefined' ? state?.destination : null,routeGeometry] : [globalThis.captainGPS || null,trip?.destination || null,routeGeometry];
    const shape = JSON.stringify(candidate);
    if (shape !== previousShape) {previousShape = shape;markers();}
  }
  async function enable() {
    button.disabled = true; note('جارٍ تحميل خرائط Google…');
    try {
      const maps = await loadGoogle();
      if (!layer) { layer = document.createElement('div'); layer.className = 'mishwar-google-map-layer'; parent.append(layer); }
      const current = getCurrent();
      if (!googleMap) {
        googleMap = new maps.Map(layer, {center:current,zoom:leaflet()?.getZoom?.() || 13,gestureHandling:'greedy',mapTypeControl:false,streetViewControl:false,fullscreenControl:false,zoomControl:true,clickableIcons:false});
        googleMap.addListener('dragstart',() => { followDevice = false; });
        googleMap.addListener('click',event => {
          if (!rider || !event.latLng || !leaflet() || typeof L === 'undefined') return;
          leaflet().fire('click',{latlng:L.latLng(event.latLng.lat(),event.latLng.lng())});
        });
      } else {googleMap.setCenter(current);googleMap.setZoom(leaflet()?.getZoom?.() || 13);}
      layer.hidden = false; enabled = true;
      const original = rider ? document.getElementById('live-map') : mapElement;
      if (original) original.style.visibility = 'hidden';
      button.textContent = 'الخريطة الأصلية'; button.setAttribute('aria-pressed','true');
      note('Google Maps'); previousShape = ''; sync();
      if (!syncTimer) syncTimer = setInterval(sync,1500);
    } catch { note('تعذر تحميل Google Maps؛ الخريطة الحالية ما زالت متاحة'); disable(); }
    finally { button.disabled = false; }
  }
  function disable() {
    enabled = false; if (layer) layer.hidden = true;
    const original = rider ? document.getElementById('live-map') : mapElement;
    if (original) original.style.visibility = '';
    if (googleMap && leaflet()) {const c=googleMap.getCenter();if (c) leaflet().setView([c.lat(),c.lng()],googleMap.getZoom(),{animate:false});leaflet().invalidateSize?.();}
    button.textContent = 'Google Maps';button.setAttribute('aria-pressed','false');
    if (syncTimer !== null) {clearInterval(syncTimer);syncTimer = null;}
  }
  button.addEventListener('click',() => { if (enabled) {disable();note('الخريطة الأصلية');} else void enable(); });
  const oldDraw = window.drawMishwarRoute;
  if (rider && typeof oldDraw === 'function') window.drawMishwarRoute = function(route) {routeGeometry = route?.geometry || null;const out=oldDraw.apply(this,arguments);sync();return out;};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(syncTimer!==null){clearInterval(syncTimer);syncTimer=null}}else if(enabled){sync();syncTimer ??= setInterval(sync,1500)}});
  window.addEventListener('pagehide',()=>{if(syncTimer!==null){clearInterval(syncTimer);syncTimer=null}});
  window.addEventListener('mishwar-entry-position',event => {
    const p = event.detail; if (enabled && followDevice && valid(p) && googleMap) googleMap.setCenter({lat:p.lat,lng:p.lng});
  });
  document.addEventListener('click',event => { if (event.target.closest?.('#locate,#driver-location')) followDevice = true; });
  fetch('/api/map-config',{credentials:'same-origin',cache:'no-store'})
    .then(r => r.ok ? r.json() : null).then(value => {
      if (!validKey(value?.googleMapsBrowserKey)) return;
      apiKey = value.googleMapsBrowserKey; button.hidden = false; note('Google Maps متاحة');
    }).catch(()=>{});
})();
