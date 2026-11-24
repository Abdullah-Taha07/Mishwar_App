/* Reacquire only consented foreground GPS at entry and return to foreground.
 * Existing rider/captain watchPosition controllers own continuous tracking and dispatch.
 * Never store coordinates or transmit location while a captain is off duty. */
(() => {
  'use strict';
  const rider = !!document.querySelector('.mobile-nav');
  const mapId = rider ? 'map' : 'driver-map';
  if (!document.getElementById(mapId)) return;
  let lastRequest = 0, requestNumber = 0;
  const status = document.createElement('span');
  status.className = 'mishwar-gps-entry-status';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  (document.querySelector(rider ? '.map-status' : '.driver-map') || document.body).append(status);
  async function refresh() {
    if (document.hidden || !navigator.geolocation || window.isSecureContext === false) return;
    const now = Date.now(); if (now - lastRequest < 20000) return;
    let permission;
    try { permission = await navigator.permissions?.query?.({name:'geolocation'}); } catch {}
    if (!permission) status.textContent = 'استخدم زر تحديد موقعي لتحديث الموقع على هذا المتصفح';
    if (permission?.state !== 'granted' || document.hidden) return; // No surprise permission dialogs.
    lastRequest = now; const generation = ++requestNumber;
    status.textContent = 'جارٍ تحديث موقعك…';
    navigator.geolocation.getCurrentPosition(position => {
      if (generation !== requestNumber || document.hidden) return;
      const c = position.coords,at = position.timestamp;
      if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude)>90 || Math.abs(c.longitude)>180 || !Number.isFinite(c.accuracy) || c.accuracy > 150 || at > Date.now()+5000 || Date.now()-at>30000) {status.textContent='الموقع غير دقيق أو قديم';return;}
      status.textContent = 'تم تحديث موقع الجهاز';
      window.dispatchEvent(new CustomEvent('mishwar-entry-position',{detail:{lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,observedAt:at}}));
      // Display only: booking pickup remains owned by existing geo controller.
      const leaflet = rider ? (typeof liveMap !== 'undefined' ? liveMap : null) : (typeof map !== 'undefined' ? map : null);
      if (leaflet && (rider ? (!globalThis.mishwarTripActive && (typeof pickupPoint === 'undefined' || pickupPoint?.source !== 'manual')) : !globalThis.captainGPS)) leaflet.setView([c.latitude,c.longitude],Math.max(leaflet.getZoom?.()||13,14),{animate:false});
    }, error => {
      if (generation !== requestNumber || document.hidden) return;
      status.textContent = error?.code===1 ? 'إذن الموقع غير متاح' : 'تعذر تحديث الموقع، جرّب زر تحديد الموقع';
    },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){requestNumber++;status.textContent='';}else void refresh()});
  window.addEventListener('pageshow',()=>void refresh());
  window.addEventListener('pagehide',()=>{requestNumber++});
  void refresh();
})();
