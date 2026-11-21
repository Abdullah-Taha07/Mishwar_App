/* RDEV-003: display only a bounded, server-verified driving estimate. */
(() => {
  const active = new Set(['arriving', 'arrived', 'riding']);
  const maxAge = 30000, future = 5000;
  let trip = null, ticket = null, timer = null, interruptedAt = null, hidden = false;
  const ended = new Set(), phase = {arriving:1,arrived:2,riding:3};
  const context = () => window.MishwarAccountContext;
  const owned = () => !!ticket?.accountKey && context()?.isCurrent(ticket) && context().snapshot().status === 'ready' && context().snapshot().verified;
  const language = () => window.MishwarLang?.get() === 'en' ? 'en' : 'ar';
  const text = {
    ar: {pickup:'وقت وصول الكابتن إليك',destination:'الوقت المتوقع للوصول إلى الوجهة',minute:'دقيقة تقريبًا',arrived:'وصل الكابتن',connected:'التتبع متصل',waiting:'بانتظار قياس موقع حديث',offline:'الاتصال منقطع',unknown:'وقت الوصول غير متاح حاليًا',route:'جارٍ تحديث مسار القيادة',traffic:'تقدير قيادة يشمل بيانات المرور المتاحة',noTraffic:'تقدير قيادة دون بيانات مرور لحظية',stops:'التقدير غير متاح حتى تتحدد المحطات المتبقية',age:n=>'حُسب قبل '+n+' ثانية',gpsAge:n=>'آخر قياس منذ '+n+' ثانية'},
    en: {pickup:'Captain arrival at pickup',destination:'Estimated arrival at destination',minute:'min approximately',arrived:'Captain has arrived',connected:'Tracking connected',waiting:'Waiting for a fresh location',offline:'Connection lost',unknown:'Arrival estimate is currently unavailable',route:'Updating the driving route',traffic:'Driving estimate includes available traffic data',noTraffic:'Driving estimate without live traffic data',stops:'Estimate unavailable until remaining stops are confirmed',age:n=>'Calculated '+n+' seconds ago',gpsAge:n=>'Last measurement '+n+' seconds ago'},
  };
  const point = value => !!value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180 && Number.isFinite(value.accuracy) && value.accuracy >= 0 && value.accuracy <= 150;
  const stamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const online = () => navigator.onLine !== false;
  function presentation(value) {
    const t = text[language()], now = Date.now(), target = value.status === 'riding' ? 'destination' : 'pickup';
    const loc = value.driverLocation, at = stamp(loc?.at), eta = value.eta;
    const fresh = online() && !hidden && interruptedAt === null && point(loc) && loc.fresh === true && Number.isFinite(at) && at <= now + future && now - at < maxAge && (!loc.tripId || loc.tripId === value.id);
    const base = {target,title:t[target],minutes:'—',unit:'',state:fresh?'unavailable':'stale',connection:online()?(fresh?t.connected:t.waiting):t.offline,note:t.unknown,age:Number.isFinite(at)&&at<=now?t.gpsAge(Math.floor((now-at)/1000)):''};
    if (!fresh) return base;
    if (value.status === 'arrived' && eta?.status === 'arrived' && eta.tripId === value.id && eta.target === 'pickup') return {...base,state:'arrived',minutes:t.arrived,note:'',age:base.age};
    if (eta?.status === 'unavailable') return {...base,note:eta.reason==='stops_progress_unavailable'?t.stops:eta.reason==='route_refresh_pending'?t.route:t.unknown};
    if (eta?.status !== 'available' || eta.tripId !== value.id || eta.target !== target) return base;
    const calculated = stamp(eta.calculatedAt), expires = stamp(eta.expiresAt), locationAt = stamp(eta.locationAt);
    const valid = Number.isFinite(calculated) && Number.isFinite(expires) && Number.isFinite(locationAt) && calculated <= now + future && calculated >= now - maxAge && expires > now && expires <= calculated + maxAge && expires <= locationAt + maxAge && locationAt <= at && at - locationAt < maxAge && locationAt <= now + future && now - locationAt < maxAge;
    const metrics = Number.isFinite(eta.durationSeconds) && eta.durationSeconds > 0 && eta.durationSeconds <= 604800 && Number.isFinite(eta.distanceMeters) && eta.distanceMeters > 0 && eta.distanceMeters <= 10000000 && eta.minutes === Math.max(1,Math.ceil(eta.durationSeconds/60)) && Number.isFinite(eta.trafficDelaySeconds) && eta.trafficDelaySeconds >= 0 && eta.trafficDelaySeconds <= eta.durationSeconds;
    if (!valid || !metrics || !['TomTom','OSRM'].includes(eta.provider) || eta.trafficAware === true && eta.provider !== 'TomTom') return base;
    return {...base,state:'available',minutes:String(eta.minutes),unit:t.minute,note:eta.trafficAware===true?t.traffic:t.noTraffic,age:t.age(Math.max(0,Math.floor((now-calculated)/1000)))};
  }
  function html(value) {
    if (!value || !active.has(value.status) || !value.driver_id || !context()?.snapshot().verified) return '';
    const p = presentation(value);
    // All interpolated strings are static translations or checked numeric data.
    return '<section class="live-eta" data-live-eta data-state="'+p.state+'"><span data-eta-target="'+p.target+'">'+p.title+'</span><div class="live-eta-number"><strong data-eta-minutes aria-live="polite">'+p.minutes+'</strong><small data-eta-unit>'+p.unit+'</small></div><p data-eta-connection role="status">'+p.connection+'</p><p data-eta-note>'+p.note+'</p><small data-eta-age>'+p.age+'</small></section>';
  }
  function paint() {
    const node = document.querySelector('[data-live-eta]');
    if (!trip || !owned()) { if(node){node.textContent='';node.hidden=true} return; }
    if (!node) return;
    const p = presentation(trip);node.hidden=false;node.setAttribute('data-state',p.state);
    for(const [name,value] of Object.entries({target:p.title,minutes:p.minutes,unit:p.unit,connection:p.connection,note:p.note,age:p.age})){
      const child=node.querySelector('[data-eta-'+name+']');if(child&&child.textContent!==value)child.textContent=value;
    }
    node.querySelector('[data-eta-target]')?.setAttribute('data-eta-target',p.target);
  }
  function stopTimer(){if(timer!==null)clearInterval(timer);timer=null}
  function startTimer(){if(timer===null&&trip&&!hidden)timer=setInterval(paint,1000)}
  function clear(){stopTimer();trip=null;ticket=null;interruptedAt=null;paint()}
  function update(value) {
    const account=context()?.snapshot();
    if(value?.id&&['completed','cancelled'].includes(value.status)){ended.add(value.id);if(ended.size>10)ended.delete(ended.values().next().value)}
    if(value?.id&&ended.has(value.id)){clear();return}
    if(!value||!active.has(value.status)||!value.driver_id||account?.status!=='ready'||!account.verified){clear();return}
    if(trip&&trip.id===value.id&&trip.driver_id===value.driver_id&&owned()){
      const before=stamp(trip.driverLocation?.at),after=stamp(value.driverLocation?.at);
      if(phase[value.status]<phase[trip.status]||Number.isFinite(before)&&Number.isFinite(after)&&(after<before||after===before&&(value.driverLocation.lat!==trip.driverLocation.lat||value.driverLocation.lng!==trip.driverLocation.lng)))return;
    }
    if(!trip||trip.id!==value.id||trip.driver_id!==value.driver_id||!owned())interruptedAt=null;
    ticket=context().capture();
    if(interruptedAt!==null&&stamp(value.driverLocation?.at)>interruptedAt&&value.driverLocation?.fresh===true)interruptedAt=null;
    trip=value;startTimer();paint();
  }
  function markStale(){if(trip){interruptedAt=Number.isFinite(stamp(trip.driverLocation?.at))?stamp(trip.driverLocation.at):-Infinity;paint()}}
  window.MishwarEta=Object.freeze({html,update,clear,markStale});
  window.addEventListener('mishwar-trip-updated',event=>update(event.detail));
  window.addEventListener('mishwar-account-reset',()=>{ended.clear();clear()});
  window.addEventListener('offline',markStale);
  window.addEventListener('online',paint);
  window.addEventListener('pagehide',()=>{hidden=true;markStale();stopTimer()});
  window.addEventListener('pageshow',()=>{hidden=false;startTimer();paint()});
  document.addEventListener('visibilitychange',()=>{hidden=document.hidden;if(hidden){markStale();stopTimer()}else{startTimer();paint()}});
  window.addEventListener('mishwar-language-changed',paint);
})();
