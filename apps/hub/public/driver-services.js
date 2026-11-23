(()=>{
/* RDEV-003 captain location controller. Sensor timestamps are never manufactured. */
let watch=null,watchEpoch=0,waiting=[],lastAccuracy=null,ownerKey='',pageInactive=false,sessionBlocked=false,permissionDenied=false,retryAt=0;
let publishing=null,lastAttempt=0,lastCapturedAt=0,lastPublishedAt=0,previous=null,locationState='idle';
window.captainGPS=null;
const activeTrip=()=>data?.current&&['arriving','arrived','riding'].includes(data.current.status)?data.current:null;
const eligible=()=>!!data?.captain?.id&&!captainAuthBlocked&&!pageInactive&&!sessionBlocked&&(!!activeTrip()||data.available===true);
const sampleFresh=p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=150&&Number.isFinite(p.at)&&p.at<=Date.now()+5000&&Date.now()-p.at<30000;
const setLocationState=state=>{if(locationState===state)return;locationState=state;window.captainLocationState=state;window.dispatchEvent(new CustomEvent('mishwar-captain-location-state',{detail:{state}}))};
const meters=(a,b)=>{const rad=n=>n*Math.PI/180,dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng),h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))))};
function stopGPS(reason='idle'){
 watchEpoch++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;
 if(publishing){publishing.controller.abort();publishing=null}
 window.captainGPS=null;
 for(const task of waiting.splice(0)){clearTimeout(task.timer);task.reject(Error('توقف تحديد الموقع. أعد المحاولة عند تفعيل الرحلة أو التوفر.'))}
 setLocationState(reason);
}
function gpsFailure(error){
 const message=error?.code===1?'اسمح بإذن الموقع من إعدادات المتصفح ثم حاول مجددًا':error?.code===3?'انتهت مهلة تحديد الموقع. تحرك لمكان مفتوح ثم حاول مجددًا':'تعذر تحديد موقعك. تأكد من تفعيل GPS ثم حاول مجددًا';
 permissionDenied=error?.code===1;retryAt=Date.now()+5000;
 watchEpoch++;if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;window.captainGPS=null;
 if(publishing){publishing.controller.abort();publishing=null}
 for(const task of waiting.splice(0)){clearTimeout(task.timer);task.reject(Error(message))}
 setLocationState(permissionDenied?'permission-denied':'gps-unavailable');
}
function startWatch(){
 if(watch!==null||pageInactive||sessionBlocked||captainAuthBlocked||permissionDenied||Date.now()<retryAt)return;
 if(!navigator.geolocation){gpsFailure({code:2});return}
 const epoch=++watchEpoch;
 try{watch=navigator.geolocation.watchPosition(position=>{
  if(epoch!==watchEpoch||pageInactive||sessionBlocked||captainAuthBlocked)return;
  const c=position?.coords,at=position?.timestamp;lastAccuracy=c?.accuracy;
  if(!c||!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||!Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>150||!Number.isFinite(at)||at>Date.now()+5000||Date.now()-at>30000||at<=lastCapturedAt){setLocationState('waiting-for-valid-gps');return}
  const next={lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,at,observedAt:new Date(at).toISOString(),heading:Number.isFinite(c.heading)&&c.heading>=0&&c.heading<360?c.heading:null,speed:Number.isFinite(c.speed)&&c.speed>=0&&c.speed<=100?c.speed:null};
  if(previous&&at>previous.at&&at-previous.at<=120000&&meters(previous,next)>250+80*(at-previous.at)/1000){setLocationState('gps-jump-rejected');return}
  previous=next;lastCapturedAt=at;window.captainGPS=next;
  window.updateCaptainLiveMap?.(data?.current);setLocationState(navigator.onLine===false?'offline':'gps-ready');
  for(const task of waiting.splice(0)){clearTimeout(task.timer);task.resolve(next)}
  void window.publishCaptainLocation();
 },error=>{if(epoch===watchEpoch)gpsFailure(error)},{enableHighAccuracy:true,timeout:15000,maximumAge:5000})}catch(error){gpsFailure(error)}
}
function syncGPS(fromSession=false){
 const owner=String(data?.captain?.id||'');
 if(owner!==ownerKey){stopGPS('account-changed');ownerKey=owner;lastAttempt=0;lastCapturedAt=0;lastPublishedAt=0;previous=null;permissionDenied=false}
 if(fromSession&&owner&&!captainAuthBlocked)sessionBlocked=false;
 if(eligible()){startWatch();return}
 if(!waiting.length)stopGPS('idle');
}
window.syncCaptainGPS=()=>syncGPS(true);
window.startCaptainGPS=()=>new Promise((resolve,reject)=>{
 if(pageInactive||sessionBlocked||captainAuthBlocked){reject(Error('الجلسة غير جاهزة لتحديد الموقع. حدّث تسجيل الدخول.'));return}
 permissionDenied=false;retryAt=0;
 if(sampleFresh(window.captainGPS)){resolve(window.captainGPS);return}
 if(!navigator.geolocation){reject(Error('الموقع غير مدعوم على الجهاز'));return}
 const task={resolve,reject,timer:null};waiting.push(task);
 task.timer=setTimeout(()=>{const index=waiting.indexOf(task);if(index<0)return;waiting.splice(index,1);reject(Error(Number.isFinite(lastAccuracy)&&lastAccuracy>150?'دقة موقعك '+Math.round(lastAccuracy)+' متر؛ المطلوب 150 متر أو أفضل. افتح GPS وانتقل لمكان مفتوح.':'لم نحصل على موقع حديث ودقيق. اسمح بالموقع وجرب في مكان مفتوح.'));if(!eligible()&&!waiting.length)stopGPS('gps-unavailable')},18000);
 startWatch();
});
window.publishCaptainLocation=async()=>{
 const p=window.captainGPS;
 if(publishing||navigator.onLine===false||!eligible()||!sampleFresh(p)||p.at<=lastPublishedAt||Date.now()-lastAttempt<8000)return;
 const controller=new AbortController(),token={controller,owner:ownerKey,epoch:watchEpoch};publishing=token;lastAttempt=Date.now();let timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Location upload timeout'))},8000)});
  const reply=await Promise.race([api({action:'location',lat:p.lat,lng:p.lng,accuracy:p.accuracy,observedAt:p.observedAt,heading:p.heading,speed:p.speed,tripId:activeTrip()?.id||null},{signal:controller.signal}),timeout]);
  if(publishing!==token||ownerKey!==token.owner||watchEpoch!==token.epoch||!eligible())return;
  if(reply.ok!==true)throw Error('Location upload failed');
  lastPublishedAt=Math.max(lastPublishedAt,p.at);setLocationState('published');
 }catch{if(publishing===token&&eligible())setLocationState(navigator.onLine===false?'offline':'upload-unavailable')}
 finally{clearTimeout(timer);if(publishing===token)publishing=null}
};
window.addEventListener('online',()=>{syncGPS();void window.publishCaptainLocation()});
window.addEventListener('offline',()=>{if(publishing){publishing.controller.abort();publishing=null}setLocationState('offline')});
window.addEventListener('mishwar-captain-auth-required',()=>{sessionBlocked=true;stopGPS('session-expired')});
window.addEventListener('mishwar-auth-changed',()=>{sessionBlocked=true;stopGPS('account-changed')});
window.addEventListener('pagehide',()=>{pageInactive=true;stopGPS('suspended')});
window.addEventListener('pageshow',()=>{pageInactive=false;syncGPS()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncGPS();void window.publishCaptainLocation()}});
setInterval(()=>{syncGPS();void window.publishCaptainLocation()},3000);
syncGPS();
/* End RDEV-003 captain location controller. */
window.captainServiceDialog=dialog;function dialog(title,html){document.querySelector('#driver-services-dialog')?.remove();const d=document.createElement('dialog');d.id='driver-services-dialog';d.className='driver-service-modal';d.style.cssText='font:inherit;border:0;border-radius:20px;padding:22px;max-width:500px;width:calc(100% - 32px);max-height:85dvh;overflow:auto;color:#083344';d.innerHTML='<h2><button class="account-arrow" id="close-driver-service" aria-label="رجوع">→</button>'+escapeHtml(title)+'</h2>'+html;document.body.append(d);d.querySelector('#close-driver-service').onclick=()=>{d.close();d.remove()};d.showModal();return d}
let cachedHistory=null,historyLoading=false,historyAt=0;window.invalidateDriverHistory=()=>{historyAt=0};
window.loadDriverHistoryPage=async function(offset=0,previous=[]){const target=document.querySelector('#driver-history-page');if(!target)return;if(cachedHistory&&offset===0){if(!target.dataset.loaded)renderHistory(target,cachedHistory);if(Date.now()-historyAt<5000)return}if(historyLoading)return;historyLoading=true;try{const result=await api({action:'history',offset});result.trips=[...previous,...result.trips];cachedHistory=result;historyAt=Date.now();if(document.querySelector('#driver-history-page')===target)renderHistory(target,result)}catch(e){if(document.querySelector('#driver-history-page')===target){target.innerHTML='<p class="arrival-note" role="alert">خدمة سجل الرحلات غير متاحة مؤقتًا. حاول لاحقًا أو تواصل مع الدعم.</p><button type="button" class="secondary" data-history-refresh>إعادة المحاولة</button>';}}finally{historyLoading=false}};
function renderHistory(target,result){const signature=JSON.stringify(result);if(target.historySignature===signature)return;target.historySignature=signature;const open=[...target.querySelectorAll('details[open]')].map(x=>x.dataset.trip),scroll=target.parentElement.scrollTop;target.dataset.loaded='yes';target.innerHTML=result.trips.map(t=>`<details class="history-trip" data-trip="${escapeHtml(t.id)}"><summary><span>${escapeHtml(t.destination.name)}<small>${new Date(t.created_at).toLocaleString(window.MishwarLang?.get()==='en'?'en-SA':'ar-SA')}</small>${t.status==='completed'?window.tripRatingStars?.(t.ratings?.byRider)||'':''}</span><strong class="${t.captainMovement<0?'movement-debit':'movement-credit'}">${t.captainMovement>0?'+':''}${money(t.captainMovement)}<small>${t.captainMovement<0?'عمولة مخصومة':'صافي حركة رصيدك'}</small></strong></summary>${route(t)}${t.cancellation?`<p class="trip-note">سبب الإلغاء: ${escapeHtml(window.cancellationLabel(t.cancellation.reason))}${t.cancellation.detail?' · '+escapeHtml(t.cancellation.detail):''}</p>`:''}<div class="receipt-grid"><div><span>إجمالي أجرة الرحلة</span><b>${money(t.fare_halalas)}</b></div><div><span>رقم الرحلة</span><b>${escapeHtml(t.id.slice(0,8))}</b></div><div><span>الحالة</span><b>${escapeHtml(({completed:'مكتملة',cancelled:'ملغاة',riding:'جارية'})[t.status]||t.status)}</b></div><div><span>طريقة الدفع</span><b>${methods[t.method]||t.method}</b></div><div><span>عمولة التطبيق</span><b>${money(Math.round(t.fare_halalas*t.commission_bps/10000))}</b></div></div>${t.route?'<p class="hint">'+(t.route.distanceMeters/1000).toFixed(1)+' كم · '+Math.ceil(t.route.durationSeconds/60)+' دقيقة تقريبًا</p>':''}<div class="launch-trip-tools">${t.status==='completed'?`<button data-launch="receipt" data-trip-id="${escapeHtml(t.id)}">الإيصال</button>`:''}<button data-launch="case" data-trip-id="${escapeHtml(t.id)}">الدعم والمفقودات</button></div><button class="secondary" data-driver-feedback="${t.id}" data-rating-available="${t.status==='completed'}">تقييم أو الإبلاغ عن مشكلة</button></details>`).join('')||'<div class="history-empty"><span>◷</span><h2>أول مشوار ينتظرك</h2><p>ستظهر رحلاتك وتفاصيل مستحقاتك هنا.</p></div>';if(result.nextOffset!==null){const more=document.createElement('button');more.className='secondary';more.textContent='تحميل رحلات أقدم';more.onclick=()=>window.loadDriverHistoryPage(result.nextOffset,result.trips);target.append(more)}for(const id of open){const item=[...target.querySelectorAll('details')].find(x=>x.dataset.trip===id);if(item)item.open=true}target.parentElement.scrollTop=scroll}
document.addEventListener('click',e=>{if(e.target.closest('[data-history-refresh]')){cachedHistory=null;window.loadDriverHistoryPage()}});
async function library(){if(window.Moyasar)return;await new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.3.0/dist/moyasar.css';document.head.append(css);const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/moyasar-payment-form@2.3.0/dist/moyasar.umd.min.js';script.onload=resolve;script.onerror=reject;document.head.append(script)})}
function topup(settle=false){const amount=settle?Math.min(1000,Math.max(1,-data.wallet.balance/100)).toFixed(2):'';const d=dialog(settle?'سداد العمولة':'شحن محفظة الكابتن',`<p class="hint">رصيدك الحالي ${money(data.wallet.balance)}. يضاف الشحن بعد تأكيده من الخادم.</p>${window.walletFundingForm(data.payments,amount)}<div id="driver-checkout"></div>`);window.bindWalletFunding(d,{redeem:code=>api({action:'recharge',code}),done:async result=>{toast('تمت إضافة '+money(result.amount));d.close();d.remove();await refresh(true)},pay:async f=>{const intent=await api({action:'topup_init',amount:f.amount,method:f.method==='applepay'?'applepay':'card'});await library();f.form.hidden=true;Moyasar.init({element:'#driver-checkout',amount:intent.amount,currency:'SAR',description:intent.description,publishable_api_key:intent.publishableKey,metadata:intent.metadata,methods:[intent.method==='applepay'?'applepay':'creditcard'],supported_networks:['mada','visa','mastercard'].includes(f.method)?[f.method]:['mada','visa','mastercard'],callback_url:location.origin+'/dashboard?driver_intent='+intent.id,apple_pay:{country:'SA',label:'كابتن مشوار',validate_merchant_url:'https://api.moyasar.com/v1/applepay/initiate'},on_completed:async p=>{if(p.status!=='paid')return;try{await api({action:'topup_verify',intentId:intent.id,paymentId:p.id});toast('تم تأكيد الشحن');d.close();d.remove();await refresh(true)}catch(err){d.querySelector('.funding-error').textContent=err.message;f.form.hidden=false}}})}})}
document.addEventListener('click',e=>{const topupButton=e.target.closest('[data-driver-topup]');if(topupButton)topup(topupButton.dataset.driverTopup==='settle')});setInterval(()=>{if(!document.hidden&&tab==='history')window.loadDriverHistoryPage()},3000);const parameters=new URLSearchParams(location.search);if(parameters.get('driver_intent')&&parameters.get('id'))api({action:'topup_verify',intentId:parameters.get('driver_intent'),paymentId:parameters.get('id')}).then(()=>{window.history.replaceState(null,'',location.pathname);toast('تم تأكيد الشحن');refresh()}).catch(e=>toast(e.message));
})();
