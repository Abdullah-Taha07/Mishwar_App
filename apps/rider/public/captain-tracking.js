(()=>{
  let marker=null,control=null,frame=0,fitFrame=0,ageTimer=null,sample=null,trip='',follow=true,rotation=0,dragBound=false,awaitingLocation=false;
  const freshFor=30000,radians=n=>n*Math.PI/180;
  const motionPreference=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const reducedMotion=()=>motionPreference?.matches===true||typeof document!=='undefined'&&document.body?.classList?.contains?.('no-animation')===true;
  const panMotion=duration=>reducedMotion()?{animate:false}:{animate:true,duration};
  const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;
  const validLocation=p=>validPoint(p)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&(p.accuracy===undefined||Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=150);
  const fresh=p=>validLocation(p)&&p.fresh===true&&!awaitingLocation&&Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)<=Date.now()+5000&&Date.now()-Date.parse(p.at)<freshFor&&online();
  function bearing(a,b){const x=radians(b.lng-a.lng),y=Math.sin(x)*Math.cos(radians(b.lat)),z=Math.cos(radians(a.lat))*Math.sin(radians(b.lat))-Math.sin(radians(a.lat))*Math.cos(radians(b.lat))*Math.cos(x);return(Math.atan2(y,z)*180/Math.PI+360)%360}
  function distance(a,b){const x=Math.sin(radians(b.lat-a.lat)/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(radians(b.lng-a.lng)/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,x)))}
  function lerp(a,b,f){const p=Math.max(0,Math.min(1,f));return{lat:a.lat+(b.lat-a.lat)*p,lng:a.lng+(b.lng-a.lng)*p}}
  const car='<div class="captain-car-body"><svg viewBox="0 0 32 54" aria-hidden="true"><rect x="1" y="10" width="5" height="11" rx="2" fill="#173846"/><rect x="26" y="10" width="5" height="11" rx="2" fill="#173846"/><rect x="1" y="34" width="5" height="11" rx="2" fill="#173846"/><rect x="26" y="34" width="5" height="11" rx="2" fill="#173846"/><rect x="5" y="2" width="22" height="50" rx="9" fill="white" stroke="#1a6576" stroke-width="1.5"/><path d="M9 15l2-7h10l2 7-3 7h-8z" fill="#26778a"/><path d="M9 38l3-5h8l3 5-2 7H11z" fill="#84bac7"/><path d="M8 24v8m16-8v8" stroke="#a7c9d2"/><path d="M9 5h4m6 0h4" stroke="#e2d591" stroke-width="2"/></svg></div>';
  function clear(){
    cancelAnimationFrame(frame);cancelAnimationFrame(fitFrame);frame=0;fitFrame=0;if(ageTimer!==null)clearInterval(ageTimer);ageTimer=null;
    marker?.remove();control?.remove();marker=null;control=null;sample=null;trip='';rotation=0;awaitingLocation=false;
  }
  function paint(){
    const live=fresh(sample),button=document.querySelector('.captain-follow');
    if(button){button.classList.toggle('following',follow&&live);button.setAttribute('aria-pressed',String(follow));button.title=!live?'بانتظار موقع حديث للكابتن':follow?'متابعة موقع الكابتن مفعّلة':'اضغط للعودة لموقع الكابتن'}
    const status=document.querySelector('.captain-location-state');
    if(status)status.textContent=live?'موقع الكابتن المباشر':'آخر موقع — الاتصال غير حديث';
    marker?.getElement()?.classList.toggle('location-stale',!live);
    marker?.setOpacity?.(live?1:.5);
    if(!live)cancelAnimationFrame(frame);
  }
  function startAging(){if(marker&&ageTimer===null)ageTimer=setInterval(paint,1000)}
  function markStale(){awaitingLocation=true;if(marker)paint()}
  function update(t){
    const loc=t?.driverLocation;
    if(!liveMap||!['arriving','arrived','riding'].includes(t?.status)){clear();return}
    // Change identity before validating GPS: a new trip must never retain the old marker.
    const identity=t.id+':'+t.driver_id;
    if(trip!==identity){clear();trip=identity;follow=true}
    const time=Date.parse(loc?.at);
    if(!validLocation(loc)||!Number.isFinite(time)||time>Date.now()+5000){if(sample)sample={...sample,fresh:false};awaitingLocation=true;if(marker)paint();return}
    // Only a newer sensor measurement may restore freshness after a disconnect.
    const previousTime=sample?Date.parse(sample.at):null;
    if(previousTime!==null&&time<=previousTime){paint();return}
    if(sample&&time-previousTime<=120000&&distance(sample,loc)>250+80*(time-previousTime)/1000){markStale();return}
    sample={...loc};awaitingLocation=!online();
    if(!marker){
      marker=L.marker([loc.lat,loc.lng],{icon:L.divIcon({className:'captain-car-marker',html:car,iconSize:[34,54],iconAnchor:[17,27]}),zIndexOffset:1500,title:'موقع الكابتن'}).addTo(liveMap).bindTooltip('موقع الكابتن');
      control=L.control({position:'topright'});
      control.onAdd=()=>{
        const el=L.DomUtil.create('div','captain-map-control');
        el.innerHTML='<button class="captain-follow following" type="button" aria-label="متابعة موقع الكابتن" aria-pressed="true">⌖</button><span class="captain-location-state"></span>';
        L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el);
        el.querySelector('button').onclick=()=>{follow=true;paint();if(fresh(sample))liveMap.panTo(marker.getLatLng(),panMotion(.7))};
        return el;
      };
      control.addTo(liveMap);
      if(!dragBound){liveMap.on('dragstart',()=>{if(marker){follow=false;paint()}});dragBound=true}
      const created=marker;
      const fitCurrentTrip=()=>{
        fitFrame=0;
        if(marker!==created||trip!==identity)return;
        liveMap.invalidateSize();
        const bounds=[t.pickup,t.destination,...(fresh(sample)?[sample]:[])].filter(validPoint).map(p=>[p.lat,p.lng]);
        if(bounds.length)liveMap.fitBounds(bounds,{paddingTopLeft:[35,60],paddingBottomRight:[35,Math.min(230,liveMap.getSize().y*.35)],maxZoom:15,...(reducedMotion()?{animate:false}:{})});
      };
      if(reducedMotion())fitCurrentTrip();else fitFrame=requestAnimationFrame(fitCurrentTrip);
    }
    startAging();paint();
    const from=marker.getLatLng();
    const heading=Number.isFinite(loc.heading)&&loc.heading>=0&&loc.heading<360?loc.heading:null;
    const next=heading??(Math.abs(from.lat-loc.lat)+Math.abs(from.lng-loc.lng)>.00002?bearing(from,loc):null);
    if(next!==null)rotation+=((next-rotation+540)%360)-180;
    const el=marker.getElement()?.querySelector('.captain-car-body');if(el){el.style.transition=reducedMotion()?'none':'';el.style.transform='rotate('+rotation+'deg)'}
    cancelAnimationFrame(frame);
    const start=performance.now(),moving=marker,at=sample.at;
    function animate(now){if(marker!==moving||trip!==identity||sample?.at!==at||!fresh(sample)||reducedMotion())return;const f=(now-start)/1000,p=lerp(from,loc,f);moving.setLatLng([p.lat,p.lng]);if(f<1)frame=requestAnimationFrame(animate)}
    if(fresh(sample)&&!reducedMotion())frame=requestAnimationFrame(animate);else marker.setLatLng([loc.lat,loc.lng]);
    if(follow&&fresh(sample))liveMap.panInside([loc.lat,loc.lng],{paddingTopLeft:[40,65],paddingBottomRight:[40,Math.min(240,liveMap.getSize().y*.4)],...panMotion(.8)});
  }
  const motionChanged=()=>{if(!reducedMotion())return;cancelAnimationFrame(frame);cancelAnimationFrame(fitFrame);frame=0;fitFrame=0;if(typeof liveMap!=='undefined')liveMap?.stop?.();if(marker&&fresh(sample))marker.setLatLng([sample.lat,sample.lng]);const el=marker?.getElement()?.querySelector('.captain-car-body');if(el)el.style.transition='none';if(marker)paint()};
  if(motionPreference?.addEventListener)motionPreference.addEventListener('change',motionChanged);else motionPreference?.addListener?.(motionChanged);
  window.addEventListener('mishwar-motion-changed',motionChanged);
  window.MishwarTracking={update,clear,markStale,bearing,interpolate:lerp};
  window.addEventListener('mishwar-trip-updated',e=>update(e.detail));
  window.addEventListener('mishwar-account-reset',clear);
  window.addEventListener('offline',markStale);
  window.addEventListener('online',()=>{if(marker)paint()});
  window.addEventListener('pagehide',()=>{awaitingLocation=true;cancelAnimationFrame(frame);cancelAnimationFrame(fitFrame);frame=0;fitFrame=0;if(ageTimer!==null)clearInterval(ageTimer);ageTimer=null;if(marker)paint()});
  window.addEventListener('pageshow',()=>{if(marker){startAging();paint()}});
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(marker)paint()});
})();
