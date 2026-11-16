(()=>{let sheetHeight=92,wasSelecting=false,drag=null,suppressHandleClick=false;const sheet=$('.booking'),sheetStage=()=>['select','matching','arriving','arrived','riding','complete','cancelled'].includes(state.stage),mobile=matchMedia('(max-width:700px)');
window.addEventListener('mishwar-sheet-height',e=>{sheetHeight=e.detail;applySheet()});function applySheet(){document.body.classList.toggle('rider-select',sheetStage());sheet.style.setProperty('--ride-sheet-height',sheetHeight+'%');const handle=document.querySelector('[data-ride-expand]');if(handle){handle.onclick=e=>{e.stopPropagation();if(suppressHandleClick){suppressHandleClick=false;return}sheetHeight=sheetHeight>=80?44:92;applySheet()};handle.setAttribute('aria-expanded',String(sheetHeight>=80));handle.setAttribute('aria-label',sheetHeight>=80?'تنزيل لوحة المشوار':'رفع لوحة المشوار')}requestAnimationFrame(()=>liveMap?.invalidateSize())}
const oldRender=render;render=function(){const selecting=sheetStage(),scroll=wasSelecting?document.querySelector('.ride-scroll')?.scrollTop||0:0;if(selecting&&!wasSelecting)sheetHeight=92;oldRender();wasSelecting=selecting;applySheet();if(selecting&&scroll)document.querySelector('.ride-scroll')?.scrollTo(0,scroll)};
function beginSheet(e,y){if(!mobile.matches||!sheetStage()||!e.target.closest('.ride-heading')||e.target.closest('button:not([data-ride-expand])'))return;drag={y,height:sheet.getBoundingClientRect().height,parent:sheet.parentElement.getBoundingClientRect().height,last:y,moved:false};suppressHandleClick=false}
function moveSheet(e,y){if(!drag)return;drag.last=y;if(!drag.moved&&Math.abs(y-drag.y)<6)return;drag.moved=true;e.preventDefault();sheet.classList.add('ride-sheet-dragging');sheetHeight=Math.max(44,Math.min(94,(drag.height+drag.y-y)/drag.parent*100));applySheet()}
function finishSheet(){if(!drag)return;const moved=drag.moved;drag=null;sheet.classList.remove('ride-sheet-dragging');if(!moved)return;suppressHandleClick=true;sheetHeight=[44,70,92].reduce((a,b)=>Math.abs(b-sheetHeight)<Math.abs(a-sheetHeight)?b:a);applySheet();setTimeout(()=>{suppressHandleClick=false},250)}
sheet.addEventListener('mousedown',e=>{if(e.button===0)beginSheet(e,e.clientY)});document.addEventListener('mousemove',e=>moveSheet(e,e.clientY));document.addEventListener('mouseup',finishSheet);
sheet.addEventListener('touchstart',e=>{if(e.touches.length===1)beginSheet(e,e.touches[0].clientY)},{passive:true});sheet.addEventListener('touchmove',e=>{if(e.touches.length===1)moveSheet(e,e.touches[0].clientY)},{passive:false});sheet.addEventListener('touchend',finishSheet);sheet.addEventListener('touchcancel',finishSheet);
sheet.addEventListener('keydown',e=>{if(!e.target.closest('[data-ride-expand]'))return;if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();sheetHeight=['ArrowUp','Home'].includes(e.key)?92:44;applySheet()}});
const oldFit=fitDialog;fitDialog=function(){if($('#modal').open){const inner=$('#modal .dialog-inner');if(inner)inner.style.zoom='1';return}oldFit()};
const oldSettings=showSettings;showSettings=function(){oldSettings();const root=$('#modal .dialog-inner')||$('#modal-content');const controls=document.createElement('section');controls.className='device-settings';controls.innerHTML='<h3>أذونات الجهاز</h3><button class="secondary" data-device-setup>إدارة إذن الموقع والإشعارات والصوت</button><button class="secondary" data-stop-follow>إيقاف متابعة الموقع</button>';root.append(controls);controls.querySelector('[data-device-setup]').onclick=()=>window.showMishwarPermissions?.();controls.querySelector('[data-stop-follow]').onclick=()=>window.stopMishwarLocation?.()};
const oldSearch=openSearchSheet;openSearchSheet=function(target){oldSearch(target);const title=searchSheet.querySelector('.search-header strong');if(title)title.textContent='خطّط لمشوارك';if(!searchSheet.querySelector('.search-trip-context')){const chip=document.createElement('div');chip.className='search-trip-context';chip.innerHTML='<span>◷ الانطلاق الآن</span><span>♙ رحلة شخصية</span>';searchSheet.querySelector('.search-header').after(chip)}};
const bell=$('#notifications-button'),badge=$('#notification-count');let rows=[],seen=new Set(),unreadIds=new Set(),notificationView=null,notificationSequence=0;try{rows=JSON.parse(sessionStorage.getItem('mishwar-notifications')||'[]');if(!Array.isArray(rows))rows=[];seen=new Set(rows.map(r=>r.id))}catch{}const storeRows=()=>{try{sessionStorage.setItem('mishwar-notifications',JSON.stringify(rows.slice(0,30)))}catch{}};
function updateBadge(){if(!badge)return;const unread=unreadIds.size;badge.hidden=!unread;badge.textContent=unread>9?'٩+':String(unread)}
function stopNotificationView(){
 const view=notificationView;if(!view)return;notificationView=null;
 cancelAnimationFrame(view.frame);view.read.controller.abort();view.ackRead?.controller.abort();
 view.modal.removeEventListener('close',view.stop);
 document.removeEventListener('scroll',view.schedule,true);document.removeEventListener('visibilitychange',view.schedule);window.removeEventListener('resize',view.schedule);
}
window.addEventListener('mishwar-trip-updated',e=>{const t=e.detail,id=t.id+':'+t.status+':'+t.payment_status;if(seen.has(id))return;seen.add(id);const title=({matching:'تم إرسال طلبك',arriving:'الكابتن في الطريق',arrived:'وصل الكابتن',riding:'بدأت الرحلة',completed:'انتهت الرحلة',cancelled:'تم إلغاء الرحلة'})[t.status];if(!title)return;rows.unshift({id,title,body:t.status==='completed'&&['paid','cash_collected'].includes(t.payment_status)?'تم الدفع بنجاح. شكرًا لاستخدامك مشوار.':'افتح تفاصيل الرحلة لمتابعة مشوارك.'});rows=rows.slice(0,30);unreadIds.add(id);storeRows();updateBadge()});
window.addEventListener('mishwar-account-reset',()=>{stopNotificationView();rows=[];seen.clear();unreadIds.clear();storeRows();updateBadge()});
if(bell)bell.onclick=async()=>{
 stopNotificationView();
 const context=window.MishwarAccountContext,ticket=context.capture();
 if(context.snapshot().status!=='ready'||!context.snapshot().verified){sectionModal('الإشعارات','<p class="feature-intro">سجّل حسابك وفعّل رقمك لتتابع إشعارات رحلاتك.</p>');return}
 const sequence=++notificationSequence,read=context.readController(),modal=$('#modal');
 sectionModal('الإشعارات','<div data-notifications-view="'+sequence+'"><p class="feature-intro">جارٍ تحميل إشعاراتك…</p></div>');
 const marker=$('#modal-content').querySelector('[data-notifications-view="'+sequence+'"]');
 const view={modal,marker,read,frame:0,ackRead:null,inFlight:false,acked:new Set()};
 notificationView=view;
 const current=()=>notificationView===view&&context.isCurrent(ticket)&&modal.open&&marker?.isConnected;
 view.stop=()=>{if(notificationView===view)stopNotificationView()};
 // A node in the DOM is not proof of display: clipped rows stay unread until scrolled into view.
 const visible=card=>{
  if(document.hidden||!current()||!card.isConnected)return false;
  if(card.checkVisibility&&!card.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
  const rect=card.getBoundingClientRect(),clip=(marker.closest('.dialog-body')||modal).getBoundingClientRect();
  const top=Math.max(0,clip.top),bottom=Math.min(window.innerHeight,clip.bottom),left=Math.max(0,clip.left),right=Math.min(window.innerWidth,clip.right);
  return rect.width>0&&rect.height>0&&rect.top>=top-1&&rect.bottom<=bottom+1&&rect.left>=left-1&&rect.right<=right+1;
 };
 let notifications=[],serverIds=new Set();
 const acknowledge=async()=>{
  if(!current()){view.stop();return}if(document.hidden||view.inFlight)return;
  const displayed=[...marker.querySelectorAll('[data-notification-index]')].filter(visible);
  // Server notices and local trip events have different IDs. Showing one cannot
  // clear an unrelated local badge, including events that arrive during this view.
  for(const card of displayed)unreadIds.delete(card.dataset.notificationId);
  updateBadge();
  const ids=[...new Set(displayed.map(card=>card.dataset.notificationId))].filter(id=>serverIds.has(id)&&!view.acked.has(id)).slice(0,5);
  if(!ids.length)return;
  const ackRead=context.readController();view.ackRead=ackRead;view.inFlight=true;let succeeded=false;
  try{
   if(!current()||document.hidden)return;
   const response=await fetch('/api/background',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',signal:ackRead.controller.signal,body:JSON.stringify({action:'ack',ids})});
   if(response.ok&&current()){for(const id of ids)view.acked.add(id);succeeded=true}
  }catch{}finally{ackRead.release();view.ackRead=null;view.inFlight=false}
  if(succeeded)view.schedule();
 };
 // Two frames allow the inserted content to paint before any read acknowledgement.
 view.schedule=()=>{if(view.frame)return;view.frame=requestAnimationFrame(()=>{view.frame=requestAnimationFrame(()=>{view.frame=0;acknowledge()})})};
 modal.addEventListener('close',view.stop);
 document.addEventListener('scroll',view.schedule,true);document.addEventListener('visibilitychange',view.schedule);window.addEventListener('resize',view.schedule);
 notifications=rows.slice();
 try{
  const response=await fetch('/api/background',{credentials:'same-origin',cache:'no-store',signal:read.controller.signal});
  if(!current()){view.stop();return}
  if(response.ok){const data=await response.json();if(!current()){view.stop();return}if(Array.isArray(data.notifications)&&data.notifications.length){notifications=data.notifications;serverIds=new Set(notifications.filter(n=>typeof n.id==='string'&&n.id).map(n=>n.id))}}
 }catch(error){if(context.ignored(error)){view.stop();return}}finally{read.release()}
 if(!current()){view.stop();return}
 marker.innerHTML=notifications.length?`<div class="notifications-list">${notifications.map((n,index)=>`<article data-notification-index="${index}" data-notification-id="${esc(String(n.id))}"><span>♧</span><div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></div></article>`).join('')}</div>`:`<div class="notifications-empty"><span>♧</span><h3>لا توجد إشعارات حاليًا</h3><p>${window.mishwarRiderVerified?'تظهر هنا تحديثات طلبك ورحلتك.':'سجّل حسابك وفعّل رقمك لتتابع إشعارات رحلاتك.'}</p></div>`;
 view.schedule();
};
render();
})();
