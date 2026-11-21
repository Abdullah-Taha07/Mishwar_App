/* Search provider changes invalidate pending results; location remains rider-controlled. */
let pickupPoint=null,liveMap=null,pickupMarker=null,destinationMarker=null,pickingTarget=null,candidatePoint=null,candidateMarker=null,candidateSequence=0,locating=false;
const geoCache=new Map(),reverseCache=new Map();
const mapConfig={tiles:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',search:'https://photon.komoot.io/api/',reverse:'https://photon.komoot.io/reverse',searchProvider:'Photon'};
let mapProviderRevision=0,mapOwnerRevision=0,baseMapTiles=null,commercialMapTiles=null,mapTileFallback=false;
const reverseRequests=new Set();
function mapSearchCredit(){return mapConfig.searchProvider==='TomTom'?'البحث: TomTom · بيانات TomTom':'البحث: Photon · بيانات OpenStreetMap'}
window.mishwarMapSearchCredit=mapSearchCredit;
const defaultCenter=[24.7136,46.6753];
const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const localCity=s=>({Riyadh:'الرياض',Jeddah:'جدة',Mecca:'مكة المكرمة',Medina:'المدينة المنورة',Dammam:'الدمام','Saudi Arabia':'السعودية'}[s]||s);
const geoText=value=>typeof value==='string'?value.trim():'';
const addressText=p=>geoText(p.name)||[geoText(p.street),geoText(p.housenumber)].filter(Boolean).join(' ')||geoText(p.district)||localCity(geoText(p.city))||'موقع مختار على الخريطة';
function photonPoint(feature){
 const geometry=feature?.geometry,coordinates=geometry?.coordinates;
 if(!Array.isArray(coordinates)||geometry?.type!=='Point')return null;
 const point={lat:coordinates[1],lng:coordinates[0]};if(!validPoint(point))return null;
 const raw=feature.properties&&typeof feature.properties==='object'?feature.properties:{},p=Object.fromEntries(['name','street','housenumber','district','city','state','country'].map(key=>[key,key==='housenumber'&&Number.isFinite(raw[key])?String(raw[key]):geoText(raw[key])]));
 return {...point,name:addressText(p),area:[p.street&&p.street!==addressText(p)?p.street:null,p.district,localCity(p.city),p.state,localCity(p.country)].filter((value,index,list)=>value&&list.indexOf(value)===index).join('، ')};
}
function geoPoints(data){return (Array.isArray(data?.features)?data.features:[]).map(photonPoint).filter(validPoint)}
async function fetchGeo(url,signal=AbortSignal.timeout(10000)){
 let onAbort;const aborted=()=>Object.assign(Error('geo-aborted'),{name:'AbortError'});
 if(signal.aborted)throw aborted();
 const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(aborted());signal.addEventListener('abort',onAbort,{once:true})});
 try{return await Promise.race([(async()=>{const response=await fetch(url,{signal});if(!response.ok)throw Error('geo');return response.json()})(),cancelled])}
 finally{signal.removeEventListener('abort',onAbort)}
}
const unresolvedAddress=point=>({...point,name:'موقع مختار على الخريطة',area:'تعذر جلب اسم العنوان؛ يمكنك تسميته من حقل العنوان.',resolved:false});
async function reverseAddress(point,retry=0){
 if(!validPoint(point))return unresolvedAddress(point);
 const provider=mapConfig.reverse,revision=mapProviderRevision,ownerRevision=mapOwnerRevision,key=provider+'|'+point.lat.toFixed(5)+','+point.lng.toFixed(5);
 if(reverseCache.has(key))return {...point,...reverseCache.get(key)};
 const controller=new AbortController();reverseRequests.add(controller);const timeout=setTimeout(()=>controller.abort(),10000);
 try{const url=new URL(provider);url.search=new URLSearchParams({lat:String(point.lat),lon:String(point.lng),limit:'1',lang:'default'});const data=await fetchGeo(url,controller.signal);
  if(ownerRevision!==mapOwnerRevision)return unresolvedAddress(point);
  if(revision!==mapProviderRevision){if(retry<1)return reverseAddress(point,retry+1)}
  else{const p=geoPoints(data)[0];if(p){const address={name:p.name,area:p.area,resolved:true};reverseCache.set(key,address);return {...point,...address}}}
 }catch{if(ownerRevision===mapOwnerRevision&&revision!==mapProviderRevision&&retry<1)return reverseAddress(point,retry+1)}
 finally{clearTimeout(timeout);reverseRequests.delete(controller)}
 return unresolvedAddress(point);
}
const editor={target:null,query:'',results:[],page:0,sequence:0,controller:null,timer:null,loading:false,error:''};
function addressInput(target){const point=target==='pickup'?pickupPoint:state.destination,label=target==='pickup'?'نقطة الانطلاق':'الوجهة';return `<div class="address-row"><span class="loc-marker ${target==='destination'?'end':''}"></span><label class="address-label" for="${target}-address">${label}<input id="${target}-address" data-address="${target}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="address-results" autocomplete="off" maxlength="150" placeholder="${target==='pickup'?'ابحث عن شارع أو حي أو مكان':'إلى أين تريد الذهاب؟'}" value="${esc(point?.name||'')}"></label><button class="icon-btn" data-geo="${target}-map" aria-label="اختيار ${label} على الخريطة">${icon('pin')}</button>${target==='pickup'?`<button class="icon-btn" data-geo="locate" aria-label="استخدام موقعي الحالي">${icon('target-locate')}</button>`:''}</div>`}
locations=function(){return `<div class="location-card direct-addresses">${addressInput('pickup')}<div class="loc-divider"></div>${addressInput('destination')}</div>`};
const suggestionBox=document.createElement('section');suggestionBox.id='address-suggestions';suggestionBox.hidden=true;suggestionBox.setAttribute('aria-label','اقتراحات العناوين');document.body.append(suggestionBox);
function stopAddressSearch(){clearTimeout(editor.timer);editor.sequence++;editor.controller?.abort();editor.controller=null}
function closeAddressEditor(){stopAddressSearch();document.querySelectorAll('[data-address]').forEach(x=>x.setAttribute('aria-expanded','false'));suggestionBox.hidden=true;editor.target=null;document.body.classList.remove('address-editing')}
function startAddressEditor(input){if(editor.target!==input.dataset.address){stopAddressSearch();editor.results=[];editor.error='';editor.loading=false;editor.page=0}editor.target=input.dataset.address;editor.query=input.value;document.body.classList.add('address-editing');input.setAttribute('aria-expanded','true');drawSuggestions();if(input.value.trim().length>=2)scheduleAddressSearch(input.value)}
function positionSuggestions(){if(suggestionBox.hidden||!editor.target)return;const input=$(`[data-address="${editor.target}"]`);if(!input)return;const rect=input.closest('.location-card').getBoundingClientRect(),height=window.visualViewport?.height||innerHeight,width=window.visualViewport?.width||innerWidth,top=Math.min(rect.bottom+5,Math.max(80,height-155));suggestionBox.style.top=top+'px';suggestionBox.style.left=Math.max(10,Math.min(rect.left,width-260))+'px';suggestionBox.style.width=Math.min(Math.max(rect.width,260),width-20)+'px';suggestionBox.style.setProperty('--suggestion-space',Math.max(100,height-top-12)+'px')}
function suggestionPageSize(){const bottom=$(`[data-address="${editor.target}"]`)?.closest('.location-card').getBoundingClientRect().bottom||150;return Math.max(1,Math.min(3,Math.floor(((window.visualViewport?.height||innerHeight)-bottom-95)/54)))}
function drawSuggestions(){if(!editor.target)return;suggestionBox.hidden=false;const size=suggestionPageSize(),count=Math.max(1,Math.ceil(editor.results.length/size));editor.page=Math.min(editor.page,count-1);const html=editor.results.slice(editor.page*size,(editor.page+1)*size).map((p,i)=>`<button type="button" role="option" data-address-result="${editor.page*size+i}" aria-selected="false">${icon('pin')}<span><strong data-no-translate>${esc(p.name)}</strong><small data-no-translate>${esc(p.area)}</small></span></button>`).join('');suggestionBox.innerHTML=`<div class="suggestion-top"><span>${editor.loading?'جارٍ البحث…':editor.results.length?'أماكن وشوارع وأحياء':'ابحث عن عنوانك'}</span><button type="button" class="icon-btn" data-address-close aria-label="إغلاق الاقتراحات">${icon('close')}</button></div><div id="address-results" role="listbox" aria-label="اقتراحات العناوين">${html||`<p class="suggestion-message">${esc(editor.error||(editor.query.trim().length<2?'اكتب حرفين على الأقل لتظهر الاقتراحات.':editor.loading?'جارٍ تحميل الاقتراحات…':'لا توجد نتائج. جرّب اسم الحي مع المدينة أو اختر من الخريطة.'))}</p>`}</div>${count>1?`<div class="suggestion-pages"><button type="button" data-address-page="-1" ${editor.page===0?'disabled':''}>السابق</button><span>${editor.page+1} / ${count}</span><button type="button" data-address-page="1" ${editor.page===count-1?'disabled':''}>التالي</button></div>`:''}<small class="suggestion-credit">${mapSearchCredit()}</small>`;positionSuggestions()}
function scheduleAddressSearch(query){stopAddressSearch();editor.query=query;editor.page=0;editor.results=[];editor.error='';if(query.trim().length<2){editor.loading=false;drawSuggestions();return}editor.loading=true;drawSuggestions();const sequence=editor.sequence;editor.timer=setTimeout(()=>runAddressSearch(query,sequence),650)}
function searchFocus(){const policy=window.MishwarGeoPolicy,fresh=p=>p?.source!=='gps'||window.MishwarLocation?.inspect(p).ok;return [window.mishwarSearchLocation,pickupPoint,liveMap?.getCenter()].find(p=>policy.inside(p)&&fresh(p))||policy.center}
async function runAddressSearch(query,sequence){
 if(sequence!==editor.sequence||!editor.target)return;
 editor.controller?.abort();editor.controller=null;
 if(typeof query!=='string'||query.trim().length<2){editor.results=[];editor.loading=false;editor.error='';drawSuggestions();return}
 const controller=new AbortController(),provider=mapConfig.search,revision=mapProviderRevision,ownerRevision=mapOwnerRevision,target=editor.target;
 editor.controller=controller;editor.results=[];editor.error='';editor.loading=true;drawSuggestions();
 const current=()=>revision===mapProviderRevision&&ownerRevision===mapOwnerRevision&&sequence===editor.sequence&&target===editor.target&&editor.controller===controller;
 const timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const focus=searchFocus(),key=provider+'|'+query.trim()+'|riyadh|'+focus.lat.toFixed(3)+','+focus.lng.toFixed(3);let points=geoCache.get(key);
  if(!points){
   const term=query.trim().replace(/^(حي|شارع|طريق)\s+/,'').replace(/،?\s+الرياض$/,'');const url=new URL(provider);
   url.search=new URLSearchParams({q:term,limit:'30',lat:String(focus.lat),lon:String(focus.lng),bbox:window.MishwarGeoPolicy.bbox,countrycode:'SA',lang:'default',zoom:'14',location_bias_scale:'0.0'});
   const data=await fetchGeo(url,controller.signal);if(!current()||controller.signal.aborted)return;
   points=window.MishwarGeoPolicy.rank(geoPoints(data),focus);if(Array.isArray(data?.features))geoCache.set(key,points);
  }
  if(!current()||controller.signal.aborted)return;editor.results=points;editor.loading=false;editor.error='';drawSuggestions();
 }catch{if(current()){editor.results=[];editor.error='تعذر تحميل اقتراحات الرياض. تحقق من الإنترنت أو اختر المكان على الخريطة.';editor.loading=false;drawSuggestions()}}
 finally{clearTimeout(timeout);if(editor.controller===controller)editor.controller=null}
}
function mapPin(kind){return L.divIcon({className:'live-pin '+kind,html:'<span></span>',iconSize:[24,24],iconAnchor:[12,12]})}
let mapMotionPreference=null;try{if(typeof matchMedia==='function')mapMotionPreference=matchMedia('(prefers-reduced-motion: reduce)')}catch{}
function mapMotionReduced(){return mapMotionPreference?.matches===true||document.body?.classList?.contains?.('no-animation')===true}
function mapMotionOptions(){return mapMotionReduced()?{animate:false}:{}}
function applyMapMotionPreference(){if(!liveMap)return;const reduced=mapMotionReduced();if(liveMap.options){liveMap.options.zoomAnimation=!reduced;liveMap.options.markerZoomAnimation=!reduced;liveMap.options.fadeAnimation=!reduced;liveMap.options.inertia=!reduced}if(reduced)liveMap.stop?.()}
const mapMarkerViews=new WeakMap();
function mapPointView(point){return validPoint(point)?[point.lat,point.lng,String(point.name||'')]:null}
function syncLocationMarker(marker,point,kind){
 const view=mapPointView(point);if(!view){marker?.remove();return null}
 if(!marker){marker=L.marker([view[0],view[1]],{icon:mapPin(kind),title:view[2]}).addTo(liveMap).bindTooltip(esc(view[2]));mapMarkerViews.set(marker,view);return marker}
 const previous=mapMarkerViews.get(marker);
 if(!previous||previous[0]!==view[0]||previous[1]!==view[1])marker.setLatLng([view[0],view[1]]);
 if(!previous||previous[2]!==view[2]){if(marker.setTooltipContent)marker.setTooltipContent(esc(view[2]));else marker.bindTooltip(esc(view[2]));if(marker.options)marker.options.title=view[2];marker.getElement?.()?.setAttribute?.('title',view[2])}
 mapMarkerViews.set(marker,view);return marker;
}
let lastMapPoints='';function syncMapPoints(){if(!liveMap)return;const pointsKey=JSON.stringify([mapPointView(pickupPoint),mapPointView(state.destination)]);if(pointsKey===lastMapPoints)return;lastMapPoints=pointsKey;pickupMarker=syncLocationMarker(pickupMarker,pickupPoint,'pickup');destinationMarker=syncLocationMarker(destinationMarker,state.destination,'destination')}
function fitLocations(){if(!liveMap)return;const points=[pickupPoint,state.destination].filter(validPoint).map(p=>[p.lat,p.lng]);if(points.length===2)liveMap.fitBounds(points,{padding:[40,40],maxZoom:15,...mapMotionOptions()});else if(points.length)liveMap.setView(points[0],16,mapMotionOptions())}
function setPickup(point){if(!validPoint(point))return;pickupPoint=point;render();fitLocations();toast('تم تحديد نقطة الانطلاق')}
function focusAddress(target){closeAddressEditor();if($('#modal').open)$('#modal').close();if(!['home','select'].includes(state.stage))setStage('home');requestAnimationFrame(()=>{const input=$(`[data-address="${target}"]`);if(input){input.focus({preventScroll:true});input.select()}})}
showSearch=function(){focusAddress('destination')};function showPickupOptions(){focusAddress('pickup')}
async function locatePickup(){if(locating)return;if(!navigator.geolocation){toast('الموقع غير مدعوم. اكتب عنوان الانطلاق أو اختره من الخريطة.');return}closeAddressEditor();document.activeElement?.blur();locating=true;toast('جارٍ تحديد موقعك…');navigator.geolocation.getCurrentPosition(async pos=>{toast('جارٍ جلب اسم العنوان…');const point=await reverseAddress({lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy});locating=false;setPickup(point)},error=>{locating=false;toast(error.code===1?'اسمح بإذن الموقع، أو اكتب عنوانك مباشرة.':'تعذر تحديد الموقع. ابحث عن عنوان أو اختر من الخريطة.')},{enableHighAccuracy:true,timeout:15000,maximumAge:30000})}
function startMapPick(target){if(!liveMap){toast('تعذر تحميل الخريطة. تحقق من الإنترنت.');return}closeAddressEditor();document.activeElement?.blur();$('#modal').close();pickingTarget=target;candidatePoint=null;candidateSequence++;candidateMarker?.remove();candidateMarker=null;document.body.classList.add('map-picking');const bar=document.createElement('div');bar.id='map-pick-bar';bar.innerHTML=`<div class="pick-heading"><strong>${target==='pickup'?'حدد نقطة الانطلاق':'حدد الوجهة'}</strong><button class="icon-btn" data-geo="cancel-pick" aria-label="إلغاء اختيار الموقع">${icon('close')}</button></div><p id="pick-coordinate">اضغط المكان المطلوب لعرض اسمه.</p><div class="pick-actions"><button class="primary" data-geo="confirm-pick" disabled>تأكيد الموقع</button><button class="outline-action" data-geo="center-pick">استخدام منتصف الخريطة</button></div>`;$('.map-wrap').append(bar);requestAnimationFrame(()=>liveMap.invalidateSize())}
async function candidateAt(point){if(!validPoint(point)||!pickingTarget)return;const sequence=++candidateSequence;candidatePoint=null;if(candidateMarker)candidateMarker.setLatLng(point);else candidateMarker=L.marker(point,{icon:mapPin('candidate')}).addTo(liveMap);$('#pick-coordinate').textContent='جارٍ جلب اسم الشارع أو المكان…';$('[data-geo="confirm-pick"]').disabled=true;const named=await reverseAddress({lat:point.lat,lng:point.lng});if(sequence!==candidateSequence||!pickingTarget)return;candidatePoint=named;$('#pick-coordinate').textContent=named.name+(named.area?' · '+named.area:'');$('[data-geo="confirm-pick"]').disabled=false}
function finishMapPick(){pickingTarget=null;candidatePoint=null;candidateSequence++;candidateMarker?.remove();candidateMarker=null;document.body.classList.remove('map-picking');$('#map-pick-bar')?.remove();requestAnimationFrame(()=>{liveMap?.invalidateSize();fitLocations()})}
const renderBeforeMaps=render;render=function(){renderBeforeMaps();syncMapPoints();$('#panel .recent')?.querySelectorAll('.distance').forEach(e=>e.remove());if(state.stage==='home')$('#map-status-text').textContent=pickupPoint?'نقطة انطلاقك جاهزة':'حدد نقطة انطلاقك'};
const fareBeforeMaps=getDemoFare;getDemoFare=function(){return {...fareBeforeMaps(),pickup:pickupPoint?.name||'غير محددة'}};
const chooseBeforeMaps=choose;choose=function(point){if(validPoint(point)){chooseBeforeMaps(point);return}if(!geoText(point?.name))return;focusAddress('destination');requestAnimationFrame(()=>{const input=$('[data-address="destination"]');input.value=point.name;scheduleAddressSearch(point.name)})};
document.addEventListener('focusin',e=>{if(e.target.matches('[data-address]'))startAddressEditor(e.target)});
document.addEventListener('input',e=>{if(!e.target.matches('[data-address]'))return;if(e.target.dataset.address==='pickup')pickupPoint=null;else state.destination=null;syncMapPoints();window.resetMishwarQuote?.();scheduleAddressSearch(e.target.value)});
document.addEventListener('keydown',e=>{if(!e.target.matches('[data-address]'))return;if(e.key==='Escape'){closeAddressEditor();e.target.blur()}if(e.key==='Enter'){e.preventDefault();clearTimeout(editor.timer);runAddressSearch(e.target.value,editor.sequence)}if(e.key==='ArrowDown'){e.preventDefault();suggestionBox.querySelector('[data-address-result]')?.focus()}});
document.addEventListener('pointerdown',e=>{if(!editor.target||e.target.closest('[data-address],#address-suggestions,#search-sheet'))return;if(!e.target.closest('[data-geo]'))closeAddressEditor()});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const action=b.dataset.action;if(b.hasAttribute('data-address-close')||b.dataset.addressPage||b.dataset.addressResult!==undefined){e.preventDefault();e.stopImmediatePropagation();if(b.hasAttribute('data-address-close')){closeAddressEditor();document.activeElement?.blur();return}if(b.dataset.addressPage){editor.page+=Number(b.dataset.addressPage);drawSuggestions();return}const point=editor.results[Number(b.dataset.addressResult)],target=editor.target;if(!point)return;closeAddressEditor();document.activeElement?.blur();if(target==='pickup')setPickup(point);else{choose(point);fitLocations()}return}if(action==='pickup'||action==='search'||action==='next'||action==='book'||b.dataset.geo||b.dataset.place!==undefined){e.preventDefault();e.stopImmediatePropagation();if(action==='pickup'){focusAddress('pickup');return}if(action==='search'){focusAddress('destination');return}if(action==='next'||action==='book'){if(pickupPoint?.source==='gps'&&(!window.MishwarLocation?.inspect(pickupPoint).ok||window.isMishwarGpsPickupCurrent&&!window.isMishwarGpsPickupCurrent(pickupPoint))){toast('الموقع قديم أو غير دقيق. حدّث موقعك أو اختر الانطلاق يدويًا.');return}closeAddressEditor();document.activeElement?.blur();if(!validPoint(pickupPoint)){focusAddress('pickup');return}if(!validPoint(state.destination)){focusAddress('destination');return}if(action==='next')setStage('select');else{if(typeof requestLocalRide==='function')requestLocalRide();else toast('خدمة الحجز غير متاحة حاليًا. أعد تحميل التطبيق وحاول مجددًا؛ لم يتم إرسال أي طلب.')}return}if(b.dataset.place!==undefined){choose({name:places[Number(b.dataset.place)].name+' الرياض'});return}switch(b.dataset.geo){case 'locate':locatePickup();break;case 'pickup-map':startMapPick('pickup');break;case 'destination-map':startMapPick('destination');break;case 'cancel-pick':finishMapPick();break;case 'center-pick':candidateAt(liveMap.getCenter());break;case 'confirm-pick':{if(!candidatePoint)return;const point=candidatePoint,target=pickingTarget;finishMapPick();if(target==='pickup')setPickup(point);else{choose(point);fitLocations()}break}}}},true);
function useCommercialMapTiles(browserKey){
 if(!liveMap||typeof browserKey!=='string'||!browserKey.trim())return;
 const error=$('#map-load-error');mapTileFallback=false;
 if(commercialMapTiles)liveMap.removeLayer(commercialMapTiles);
 if(!liveMap.hasLayer(baseMapTiles))baseMapTiles.addTo(liveMap);
 const tiles=L.tileLayer('https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key='+encodeURIComponent(browserKey),{maxZoom:19,attribution:'© TomTom'});
 commercialMapTiles=tiles;
 tiles.on('tileload',()=>{if(commercialMapTiles!==tiles)return;if(liveMap.hasLayer(baseMapTiles))liveMap.removeLayer(baseMapTiles);error.hidden=true});
 tiles.on('tileerror',()=>{if(commercialMapTiles!==tiles)return;mapTileFallback=true;commercialMapTiles=null;liveMap.removeLayer(tiles);if(!liveMap.hasLayer(baseMapTiles))baseMapTiles.addTo(liveMap);error.textContent='تعذر تحميل خريطة TomTom. نعرض خريطة OpenStreetMap بدلًا منها.';error.hidden=false});
 // Keep the existing map visible until the first commercial tile is delivered.
 tiles.addTo(liveMap);
}
function initLiveMap(){if(typeof L==='undefined'){$('#map-status-text').textContent='تعذر تحميل الخريطة — أعد المحاولة';return}const element=document.createElement('div');element.id='live-map';element.setAttribute('aria-label','خريطة تفاعلية لتحديد الانطلاق والوجهة');$('#map').append(element);liveMap=L.map(element,{zoomControl:false,attributionControl:true,zoomSnap:.5,inertia:!mapMotionReduced(),inertiaDeceleration:2200,wheelDebounceTime:40,zoomAnimation:!mapMotionReduced(),markerZoomAnimation:!mapMotionReduced(),fadeAnimation:!mapMotionReduced()}).setView(defaultCenter,13,mapMotionOptions());const error=document.createElement('div');error.id='map-load-error';error.hidden=true;error.textContent='تعذر تحميل بعض أجزاء الخريطة. تحقق من الإنترنت.';error.setAttribute('role','status');error.setAttribute('aria-live','polite');$('.map-wrap').append(error);baseMapTiles=L.tileLayer(mapConfig.tiles,{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',referrerPolicy:'strict-origin-when-cross-origin'});baseMapTiles.on('tileerror',()=>{error.textContent='تعذر تحميل بعض أجزاء خريطة OpenStreetMap. تحقق من الإنترنت.';error.hidden=false});baseMapTiles.on('tileload',()=>{if(!mapTileFallback)error.hidden=true});baseMapTiles.addTo(liveMap);liveMap.on('click',e=>{if(pickingTarget)candidateAt(e.latlng);else window.onMishwarMapTap?.(e.latlng)});$('#zoom-in').onclick=()=>liveMap.zoomIn(undefined,mapMotionOptions());$('#zoom-out').onclick=()=>liveMap.zoomOut(undefined,mapMotionOptions());$('#locate').onclick=locatePickup;$('.map-badge').innerHTML='<i></i>خريطة تفاعلية';$('.map-bottom').hidden=true;new ResizeObserver(()=>liveMap.invalidateSize()).observe($('.map-wrap'));render()}
initLiveMap();window.addEventListener("mishwar-motion-changed",applyMapMotionPreference);if(mapMotionPreference?.addEventListener)mapMotionPreference.addEventListener("change",applyMapMotionPreference);else mapMotionPreference?.addListener?.(applyMapMotionPreference);

window.searchMishwarPlaces=async(query,retry=0)=>{if(typeof query!=='string'||query.trim().length<2)return [];const focus=searchFocus(),provider=mapConfig.search,revision=mapProviderRevision,ownerRevision=mapOwnerRevision,url=new URL(provider);url.search=new URLSearchParams({q:query.trim(),limit:'30',lat:String(focus.lat),lon:String(focus.lng),bbox:window.MishwarGeoPolicy.bbox,countrycode:'SA',lang:'default'});const result=await fetchGeo(url);if(ownerRevision!==mapOwnerRevision)throw Error('تغير الحساب. أعد البحث.');if(revision!==mapProviderRevision){if(retry<1)return window.searchMishwarPlaces(query,retry+1);throw Error('تغير مصدر البحث. أعد المحاولة.')}return window.MishwarGeoPolicy.rank(geoPoints(result),focus)};
function applyMapProviderConfig(config){
 if(!config)return;
 const search=config.searchConfigured?location.origin+'/api/places':'https://photon.komoot.io/api/',reverse=config.searchConfigured?location.origin+'/api/places/reverse':'https://photon.komoot.io/reverse';
 if(search!==mapConfig.search||reverse!==mapConfig.reverse){
  mapProviderRevision++;mapConfig.search=search;mapConfig.reverse=reverse;mapConfig.searchProvider=config.searchConfigured?'TomTom':'Photon';
  geoCache.clear();reverseCache.clear();for(const controller of reverseRequests)controller.abort();stopAddressSearch();editor.results=[];editor.visibleResults=[];editor.error='';editor.loading=false;
  window.dispatchEvent(new Event('mishwar-map-provider-changed'));
  if(editor.target){if(editor.query.trim().length>=2)scheduleAddressSearch(editor.query);else drawSuggestions()}
 }
 if(config.browserKey)useCommercialMapTiles(config.browserKey);
}
window.addEventListener('mishwar-account-reset',()=>{mapOwnerRevision++;geoCache.clear();reverseCache.clear();for(const controller of reverseRequests)controller.abort();closeAddressEditor();editor.results=[];editor.visibleResults=[];editor.query='';editor.error='';editor.loading=false});
fetch('/api/map-config').then(r=>r.ok?r.json():null).then(applyMapProviderConfig).catch(()=>{});
