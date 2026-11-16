(()=>{
  const token=location.hash.slice(1),freshFor=120000,requestTimeout=10000;
  let map,car,points=[],fitted=false,frame=0,stopped=false,suspended=false;
  let activeRequest=null,retryTimer=null,ageTimer=null,failures=0,sample=null,lastError='',awaitingLocation=false;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const element=selector=>document.querySelector(selector);
  const online=()=>globalThis.navigator?.onLine!==false;
  const validPoint=p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
  const fresh=p=>validPoint(p)&&p.fresh===true&&!awaitingLocation&&Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)<=Date.now()+5000&&Date.now()-Date.parse(p.at)<freshFor&&online();
  if(typeof L!=='undefined'){
    map=L.map('share-map').setView([24.7136,46.6753],12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  }
  function paintLocation(){
    if(stopped)return;
    const live=fresh(sample);
    car?.setOpacity?.(live?1:.5);
    car?.getElement?.()?.classList.toggle('location-stale',!live);
    element('#tracking-error').textContent=lastError||(sample&&!live?'آخر موقع قديم؛ ننتظر تحديث الكابتن.':'');
    if(!live)cancelAnimationFrame(frame);
  }
  function cancelRetry(){if(retryTimer!==null)clearTimeout(retryTimer);retryTimer=null}
  function schedule(delay){
    if(stopped||suspended||document.hidden||!online()||retryTimer!==null)return;
    retryTimer=setTimeout(()=>{retryTimer=null;void update()},delay);
  }
  function stop(message,details=''){
    stopped=true;cancelRetry();activeRequest?.cancel();
    if(ageTimer!==null)globalThis.clearInterval?.(ageTimer);ageTimer=null;
    cancelAnimationFrame(frame);car?.remove();points.forEach(p=>p.remove());car=null;points=[];sample=null;
    element('#share-status').textContent=message;
    element('#share-details').textContent=details;
    element('#tracking-error').textContent='';
  }
  function read(){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let rejectDeadline,timer;
    const request={cancelled:false,cancel(){if(this.cancelled)return;this.cancelled=true;const error=Error('Tracking read cancelled');error.name='AbortError';rejectDeadline(error);controller?.abort()}};
    const deadline=new Promise((_,reject)=>{
      rejectDeadline=reject;
      timer=setTimeout(()=>{request.cancelled=true;const error=Error('انتهت مهلة تحديث المشوار. سنعيد المحاولة.');error.name='TimeoutError';reject(error);controller?.abort()},requestTimeout);
    });
    const work=(async()=>{
      const response=await fetch('/api/shared-trip?token='+encodeURIComponent(token),{cache:'no-store',referrerPolicy:'no-referrer',...(controller?{signal:controller.signal}:{})});
      if(request.cancelled)return null;
      if(!response.ok){
        if([400,401,403,404,410].includes(response.status))return {terminal:true};
        const error=Error('تعذر تحديث المشوار. سنعيد المحاولة عند عودة الاتصال.');
        const seconds=Number(response.headers?.get('retry-after'));
        if(Number.isFinite(seconds)&&seconds>0)error.retryAfter=Math.min(30000,Math.max(2500,seconds*1000));
        throw error;
      }
      const data=await response.json();
      return request.cancelled?null:data;
    })();
    // The deadline settles even if a transport or response body ignores abort.
    request.promise=Promise.race([work,deadline]).finally(()=>clearTimeout(timer));
    return request;
  }
  function show(data){
    element('#share-status').textContent=({matching:'بانتظار كابتن',arriving:'الكابتن في الطريق للراكب',arrived:'وصل الكابتن',riding:'الرحلة جارية'})[data.status]||'تحديث المشوار';
    element('#share-details').innerHTML=`<section><small>الانطلاق</small><p>${esc(data.pickup?.name)}</p><small>الوصول</small><p>${esc(data.destination?.name)}</p></section>${data.driver?`<section><p>الكابتن: ${esc(data.driver)}</p><p>${esc([data.vehicle?.make,data.vehicle?.model,data.vehicle?.color,data.vehicle?.plate].filter(Boolean).join(' · '))}</p></section>`:''}`;
    if(map&&!fitted){
      for(const p of [data.pickup,data.destination].filter(validPoint))points.push(L.marker([p.lat,p.lng]).addTo(map).bindTooltip(Object.assign(document.createElement('span'),{textContent:String(p.name??'')})));
      if(points.length){map.fitBounds(points.map(p=>p.getLatLng()),{padding:[40,40],maxZoom:15});fitted=true}
    }
    const loc=data.location,time=Date.parse(loc?.at);
    if(!validPoint(loc)||!Number.isFinite(time)||time>Date.now()+5000){if(sample)sample={...sample,fresh:false};awaitingLocation=true;paintLocation();return}
    if(sample&&time<Date.parse(sample.at)){paintLocation();return}
    const same=sample?.at===loc.at;
    sample={...loc};awaitingLocation=!online();
    if(map){
      if(!car)car=L.marker([loc.lat,loc.lng],{icon:L.divIcon({className:'share-car',html:'🚘',iconSize:[38,38],iconAnchor:[19,19]}),zIndexOffset:1000}).addTo(map);
      cancelAnimationFrame(frame);
      if(!same){
        const marker=car,from=marker.getLatLng(),start=performance.now(),at=sample.at;
        const move=now=>{if(car!==marker||sample?.at!==at||!fresh(sample))return;const f=Math.min(1,(now-start)/1000);marker.setLatLng([from.lat+(loc.lat-from.lat)*f,from.lng+(loc.lng-from.lng)*f]);if(f<1)frame=requestAnimationFrame(move)};
        if(fresh(sample))frame=requestAnimationFrame(move);else marker.setLatLng([loc.lat,loc.lng]);
      }
    }
    paintLocation();
  }
  async function update(){
    if(activeRequest||stopped||suspended||document.hidden||!online())return;
    cancelRetry();
    const request=read();activeRequest=request;let delay=2500;
    try{
      const data=await request.promise;
      if(activeRequest!==request||request.cancelled||!data)return;
      if(data.terminal){stop('رابط متابعة غير صالح أو انتهت صلاحيته');return}
      if(data.ended){stop('انتهت مشاركة هذا المشوار','لن يعرض الرابط موقعًا جديدًا.');return}
      failures=0;lastError='';show(data);
    }catch(error){
      if(activeRequest!==request)return;
      if(error.name!=='AbortError'){lastError=error.message||'تعذر تحديث المشوار. سنعيد المحاولة.';awaitingLocation=true;failures++;delay=error.retryAfter||Math.min(30000,2500*2**Math.min(failures-1,4));paintLocation()}
    }finally{
      if(activeRequest===request){activeRequest=null;schedule(delay)}
    }
  }
  function pause(){awaitingLocation=true;cancelRetry();activeRequest?.cancel();cancelAnimationFrame(frame);paintLocation()}
  function resume(){if(stopped||suspended)return;failures=0;cancelRetry();activeRequest?.cancel();schedule(0);paintLocation()}
  function startAging(){if(ageTimer===null&&!stopped)ageTimer=setInterval(paintLocation,1000)}
  if(!/^[a-f0-9]{64}$/.test(token)){stop('رابط متابعة غير صالح');return}
  startAging();void update();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else resume()});
  globalThis.addEventListener?.('offline',pause);
  globalThis.addEventListener?.('online',resume);
  globalThis.addEventListener?.('pagehide',()=>{suspended=true;pause();if(ageTimer!==null)globalThis.clearInterval?.(ageTimer);ageTimer=null});
  globalThis.addEventListener?.('pageshow',()=>{suspended=false;startAging();resume()});
})();
